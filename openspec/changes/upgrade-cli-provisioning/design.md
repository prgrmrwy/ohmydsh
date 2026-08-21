# upgrade-cli-provisioning — Design

## Context

现状(见 proposal.md - Why):`scripts/sync.mjs` 的 `dshCli` 每次调用都走 `npx -y @deepseek-ai/dsh@<version> …`。升级链内多次调用同一新版本时,首次 npx 需全新安装(远超 10s),libnpmexec 对同一 npx 缓存 key 持有安装锁,后续调用等锁超时报 `ECOMPROMISED`,sync 失败 → 升级按既有规范回滚。2026-08-21/22 实测还观察到:本机**单独一次** npx 全量安装也可能在依赖解析后卡死(两次复现,原因未定论),因此设计不能假设"单次 npx 一定可靠"。

既有约束:同步脚本是单进程串行的;升级链失败语义由 `startup-autoupdate` spec 钉死(回滚、不启动);`DSH_BIN` 环境变量已是受支持的 CLI 路径覆盖;npx 缓存目录是 DSH 运行体(`npx -y … web`)与 profile 插件 peer 解析的既有锚点,本次不改动。

## Goals / Non-Goals

Goals:

- 升级链内对同一目标版本 CLI 的多次调用,在首次就绪后全部直连执行,机制上消除安装锁竞争。
- 首次就绪提供两级安装通道:标准 npx 通道 + pnpm 直装通道(对本机"单独 npx 也可能卡死"的兜底)。
- 失败语义与现状一致:任一步失败 → `dshCli` 返回失败 → sync 失败 → 升级回滚不启动。
- 保持幂等:重复运行不产生状态文件;就绪检查只做存在性探测。

Non-Goals:

- 不改变 DSH 运行体拉取机制(仍由 npx 拉取并装载运行体)与 profile 插件部署机制。
- 不解决"单次 npx 全量安装在网络/环境问题下卡死"本身(环境问题),只保证升级链不在该路径上叠加竞争,并有 pnpm 兜底。
- 不新增 npm 依赖;不修改 `bin/dsh`、`check-update.mjs` 与既有 spec 语义。

## Decisions

### D1: CLI 实例解析为「bin 路径」,调用统一为 `node <bin> …`

`dshCli` 不再假设"必须经 npx"。每次调用先探测出一个可执行的 bin 路径(`node` 直跑 `lib/bin.js`),spawn `node <binPath> <args…>`,不持有也不等待任何 npm 安装锁。探测顺序:

1. `DSH_BIN`(环境显式指定)→ 直接使用,不做就绪检查(spec Scenario: 显式 CLI 路径);
2. npx 缓存内目标版本 bin(`~/.npm/_npx/<key>/node_modules/@deepseek-ai/dsh/lib/bin.js`)存在 → 直连;
3. 缺失 → 通道 A:单次串行 `npx -y @deepseek-ai/dsh@<version> --version` 安装就绪,完成后重新探测;
4. 通道 A 失败 → 通道 B:pnpm 直装到 `$XDG_CACHE_HOME 或 ~/.cache/ohmydsh/dsh-cli/<version>/`(临时构建目录,`pnpm add` 后取其 `node_modules/@deepseek-ai/dsh/lib/bin.js`),本轮调用直连该路径;后续调用优先复用该路径(存在性探测);
5. 皆失败 → 返回失败(沿用 fail 语义)。

替代方案评估:

- **仅"单次 npx 预热 + 后续 npx 命中"**:改动最小,但本机实测单次 npx 也可能卡死,不可靠,弃。
- **升级链开始前一次性预热(bin/dsh 侧)**:与 D1 互补但非必需(sync 内首次调用即完成就绪,失败即回滚,语义一致),为避免双处改动面,不采纳独立的预热步骤。
- **用 pnpm 替代 npx 作为唯一通道**:改变运行体锚点,牵动 profile peer 解析与既有部署约定,风险大,弃。

### D2: npx 缓存 key 复刻 libnpmexec 目录命名算法

key = `sha512(packages.map(规范化).sort().join('\n')).digest('hex').slice(0,16)`,packages 即 `@deepseek-ai/dsh@<version>` 原文(registry version spec 无需规范化)。算法来源 npm 11 的 `libnpmexec`(注释标明出处与版本约束)。

风险与自愈:若未来 npm 改算法导致 key 错配,探测 miss → 走通道 A(npx 自身会按新算法装到正确位置)→ 随后重新探测仍错配 → 每轮退化为一次 npx 调用,即**现状行为**,不产生错误结果;正确性由通道 A 保证。单测用既有缓存目录名(`2ede61d9d1d3d32e` = rc.7、`1f7e68c57f9c53b8` = rc.1、`de4831d60afe10da` = rc.2)钉住算法。

### D3: 通道 B 用 pnpm 直装 + 缓存目录,不经 npx

`pnpm add @deepseek-ai/dsh@<version>` 到固定目录(registry 显式传 `--registry https://registry.npmjs.org/`,与仓库 .npmrc 一致),复用今日已验证流程(本机 37s 完成)。无 pnpm 时通道 B 跳过。目录归属 `$DSH_HOME` 之外(`~/.cache/ohmydsh/dsh-cli/<version>`),避免污染部署目录;该目录不纳入版本控制、不在 sync 状态文件中记录(存在性探测即状态)。

### D4: 每轮调用先探测、后执行;失败即返回 false

单进程串行下无并发;存在性探测用 `existsSync`(廉价)。执行失败(status ≠ 0)直接返回 false,由调用方 `fail()` 处理,不重试安装(避免重复安装放大故障)。

## Risks / Trade-offs

- **pnpm 可用性**:通道 B 依赖宿主存在 pnpm(本机 fnm 工具链自带);缺失时退化为仅通道 A,即现状可靠性 + 无竞争。
- **libnpmexec 算法耦合**:见 D2 自愈说明;退化 ≠ 错误。
- **bin 直跑的树完整性**:npx 缓存树在就绪后通常静止;若树损坏(人为清理/半装残留),直连执行报错 → 返回 false → 回滚,不会静默错乱;通道 A 的 npx 调用本身具备重装自愈能力。
- **首次就绪期间阻塞**:升级链本就阻塞式;就绪耗时(通道 A 或 B)计入升级耗时,失败即停语义不变。
- **测试边界**:自动化单测覆盖纯函数与决策(kD1 探测顺序、D2 key、通道 B 目录);真实升级链集成验证留作手工回归(拆装缓存目录模拟缺失态)。

## Verification

- `npm test`(新增 `tests/sync-dshcli.test.mjs`):key 算法与既有目录一致、bin 路径解析、DSH_BIN 优先、通道选择分支。
- `node scripts/sync.mjs` 二次运行无变化(幂等,改动不引入状态)。
- 手工集成:清空预热的 rc.2 bin 探测路径(临时改名)→ 跑 `dsh build` 触发升级链 → 首次走安装通道、后续直连、升级成功。
- `npm run check:artifacts`。