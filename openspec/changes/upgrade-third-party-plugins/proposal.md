# 第三方插件统一升级 — 评估、计划与实施记录

> 状态：**已实施并独立复验；生产物化待用户批准**（2026-10-10 更新）。
> 评估基线：`dshVersion = 0.2.0-rc.2`（`autoUpdate.enabled: false`，本仓不自升级）、部署 cordis `4.0.4`、profile `web`。
> 证据：远端制品均以 curl 取 npm registry tarball 静态审计（未安装、未执行包代码）；复验证据见 `checking/`。

## 0. 实施状态（2026-10-10）

| 条目 | 变更 | 独立复验 |
| --- | --- | --- |
| `width-tiers` | 1.0.6 → **1.0.7** | 通过 |
| `skin-center` | 0.4.4 → **0.4.5** | 通过（peer 仅 `includePrerelease:true` 下通过，见 §3.3） |
| `llm-subscriptions` | 0.9.7 → **0.9.9** | 通过 |
| `better-sidebar` | 0.24.1 → **0.25.0** | 通过 |
| `archify-dsh` | 0.1.0 → **1.0.0** | 通过 |
| `jev`（`thirdPartyResources`） | 0.6.0 → **0.14.1** | 通过 |
| `cost-meter` | **保持 1.8.4（未动）** | 反向核查通过 |
| `dsh-opencode-session-header` / `experimental-schedule` / `dsh-cockpit-bridge` / `spec-superflow` | 未动 | 反向核查通过 |

- 修订 `dsh.yaml` sha256 `a725bbdff83efeed0cc309711ee6c2edfe713e4226a5b5eef5d84c77f7650bfb`；`git diff` = 20 insertions / 20 deletions（仅这 6 个条目）。
- 独立复验结论见 [`checking/independent-verification.md`](checking/independent-verification.md)：
  11/11 声明 pin 与 live registry 逐字节一致；隔离 `DSH_HOME` 连跑两次幂等（34,092 项快照 0 增 0 删 0 改）；
  装后版本 9/9 正确；`width-tiers` 在 loader 表中**恰好一行**、`better-sidebar` **单实例**；
  `npm test` = 426 tests / 416 pass / 8 fail / 2 skipped，失败集合与改动前**逐一相同**（无新增失败）；`check:artifacts` exit 0。
- 制品级审计报告：[`archify-1.0.0-behavior.md`](checking/archify-1.0.0-behavior.md)、[`jev-0.14.1-supply-chain.md`](checking/jev-0.14.1-supply-chain.md)。
- **未验证**：DSH 宿主启动冒烟（真实运行时未重启）；离线行为（实测 sync 需要网络）。
- **生产物化尚未执行**：需用户批准后合入任务分支 → `dsh build`（连跑两次）→ `dsh restart`。
- 已知环境问题（与本变更无关，复验中第 3 次复现）：在**全新**隔离 home 上 sync 会在
  `pnpm add @deepseek-ai/dsh-experimental-schedule-bundle@0.2.0-rc.2` 处挂起（0 文件写入、无 socket、等不到的事件），
  中断后续跑即通过；已有 home 上不复现。`npm test` 的 8 个失败中 7 个是本 lean worktree 缺 `tsc` 导致的 fixture 构建失败（环境性）。

## 1. 为什么需要一次"评估"而不是直接 `dsh plugin-update`

仓库已有统一升级入口：`dsh plugin-update`（`scripts/plugin-update.mjs`，检测逻辑在 `scripts/lib/plugin-updates.mjs`），
本次按用户要求先不执行。只读检测 `node scripts/check-plugin-updates.mjs` 的输出是：

```
可升级: cost-meter 1.8.4→1.8.20, archify-dsh 0.1.0→1.0.0, width-tiers 1.0.6→1.0.7, skin-center 0.4.4→0.4.5
汇总: up-to-date 1 / upgrade-ready 4 / needs-review 3 / skipped 1
```

**这个清单不能直接照单执行**，原因是三件事同时成立：

1. 清单把 **cost-meter 1.8.20 判为可升级**，而该条目的 `note` 自己写着 1.8.4 是刻意保留的上界（`dsh.yaml:82`）；误升会引入已知的全局 fetch 互递归风险。
2. 检测器**看不到** `thirdPartyResources`（jev / spec-superflow），jev 从 0.6.0 到现在 0.14.1 从未被提示过。
3. 检测器的 peer 判定**不自洽**，会把"没算出来的范围"当作"通过"（见 §3）。

因此正确做法是：先给出一份按信任面与风险分档的清单，再由用户逐档裁决。

## 2. 清点：仓库里的"插件"不止一种形态

`dsh.yaml` 中与本议题相关的定制有五类，只有前两类里的**非自研**条目属于"第三方插件"：

| 形态 | manifest 位置 | 本轮是否属于"三方" |
| --- | --- | --- |
| `type: package` + `source: remote` | `customizations[]` | 是（但 `dsh-cockpit-bridge` 作者是本人，属自研发布） |
| `type: package` + `source: local` | `customizations[]` | 否（自研，源码在 `packages/`） |
| `thirdPartyResources` | `thirdPartyResources[]` | 是（`npm-workflow` / `npm-mcp-server`） |
| `type: patch` | `customizations[]` | 否（本仓组合补丁） |
| `type: skill` | `customizations[]` | 否（已 vendor，升级走人工复核上游 commit） |

**本轮真正的第三方面 = 8 个 remote package（剔除自研与官方可选）+ 2 个 thirdPartyResources。**

## 3. 工具链评估：现役检测器有三个会影响决策的缺陷

### 3.1 漏检 `thirdPartyResources`

`detectRemotePluginUpdates()` 只遍历 `manifest.customizations` 中 `source === 'remote' && type === 'package'` 的条目
（`scripts/lib/plugin-updates.mjs:166-176`）。`thirdPartyResources`（`spec-superflow`、`jev`）不在其中：
**`@jkudish/jev-mcp` 钉在 0.6.0，registry `latest` 已是 0.14.1，而任何一轮 `plugin-update` 都不会提示它。**

### 3.2 `satisfies()` 只认 `^` / `~` / 精确范围，其余一律返回 `null`，而调用方把 `null` 当"通过"

- 实现：`scripts/lib/plugin-updates.mjs:48-67`。`^`、`~` 之外全部落到 `const exact = parseVersion(r); return exact ? ... : null`。
- 调用：`peerCompatIssue()`（`:85-97`）只把**明确 `false`** 当作不兼容：`if (ok === false) return '...'`。
- 后果：**比较符范围（`>=x`、`<y`）与 `||` 链根本不会被真正求值**。例如
  `@linxin666/dsh-client-ui-skin-center@0.4.5` 的 peer 是 `@deepseek-ai/dsh: ">=0.1.7-rc.1"` → `parseVersion` 直接不匹配 → `null` → 判为 `upgrade-ready`，**全程没有做过任何 peer 校验**。
- 另注：对 `^a || ^b || ...` 这类链，函数只解析**第一个**备选（`parseVersion` 是前缀匹配），恰好在本轮样本里结论未出错，但这是巧合而非设计。

### 3.3 `deployedCordisVersion()` 的探测路径与本机真实部署形状不符 → 两个"needs-review"是假阳性

- 实现探测三条路径：`~/.dsh/profiles/node_modules/...`、`~/.dsh/profiles/web/node_modules/...`、一个 npx 缓存路径（`:71-83`）。
- 实测：`~/.dsh/profiles/node_modules/@deepseek-ai/` 下有 **249 个悬空符号链接**，全部指向已被回收的 launcher build
  `.../.launcher-builds/9ddd488a...`；`profiles/web/node_modules` 下没有 cordis；npx 路径同样不存在 → 返回 `null`。
- 真实加载路径是 `.../dsh-pet/compat/subagent/.launcher/node_modules`（正在运行的 Host 即从此启动，见 `ps`），
  其中 **cordis = 4.0.4**、`@deepseek-ai/dsh` = 0.2.0-rc.2。
- 更关键：**cordis peer 根本不参与 DSH 的加载判定**。DSH 自己的闸口在
  `@deepseek-ai/dsh-app-boot/lib/index.js:292-300`：只对 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 做
  `semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })`，其余 peer 名直接 `continue`。
  所以"cordis 版本未知"既不该阻塞、也从未阻塞加载。

> 附带结论：因为 DSH 用 `includePrerelease: true`，形如 `>=0.1.7-rc.1` 的范围**是**接受 `0.2.0-rc.2` 的；
> 用默认语义手算会得到相反结论。判断这类 peer 必须以 DSH 闸口语义为准，不能裸用 `semver.satisfies` 默认参数。

### 3.4 结论：不要用 `dsh plugin-update --yes` 跑本轮

`plugin-update` 只对 `upgrade-ready` 行做行级改写，而 cost-meter 正好在 `upgrade-ready` 里。按现役实现，
**全量自动升级会直接把 cost-meter 升到 1.8.20**。本轮必须人工分档改 pin。

## 4. 逐项评估

判定口径：`DSH 闸口` = 用 `includePrerelease: true` 对 `@deepseek-ai/dsh*` peer 实算；`建议` 是本评估的结论。

| # | 条目 | 类型 | 当前 pin | registry latest | 检测器 | DSH 闸口 | 内容审计 | 建议 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `cost-meter` | remote pkg | 1.8.4 | 1.8.20 | upgrade-ready | 通过 | 有风险 | **保持 1.8.4（本轮不动）** |
| 2 | `archify-dsh` | remote pkg | 0.1.0 | 1.0.0 | upgrade-ready | 无 peer | 信任面扩大 | **需用户裁决** |
| 3 | `llm-subscriptions` | remote pkg | 0.9.7 | 0.9.9 | needs-review | 通过 | 无阻断 | **可升级** |
| 4 | `width-tiers` | remote pkg | 1.0.6 | 1.0.7 | upgrade-ready | 无 peer | 无阻断 | **可升级**（有可见行为变化） |
| 5 | `better-sidebar` | remote pkg | 0.24.1 | 0.25.0 | needs-review | 通过 | 无阻断 | **可升级**（须装后复核） |
| 6 | `skin-center` | remote pkg | 0.4.4 | 0.4.5 | upgrade-ready | 通过 | 能力删减 | **可升级**（须改写 note） |
| 7 | `dsh-opencode-session-header` | remote pkg | 0.1.0 | 0.1.0 | up-to-date | — | — | 无新版（上游仅此一版） |
| 8 | `experimental-schedule` | remote pkg（官方可选） | 0.2.0-rc.2 | dist-tag `latest`=0.2.0-rc.1 | needs-review | — | — | **不动**（见 §4.3） |
| 9 | `spec-superflow` | npm-workflow | 2.0.1 | 2.0.1 | 未检测 | — | — | 已最新 |
| 10 | `jev` | npm-mcp-server | 0.6.0 | 0.14.1 | 未检测 | — | 兼容但有两个 flag | **需单独裁决**（见 §4.5） |
| — | `dsh-cockpit-bridge` | remote pkg（自研） | 0.6.4 | 0.6.4（最新 release） | skipped | — | — | 非三方，已最新 |

> `note` 影响：本轮至少 4 条 `note` 在升级后**必须同步改写**，否则 manifest 会留下与制品不符的陈述
> （`skin-center` 的 Wallpaper Engine 能力已被上游删除、`archify-dsh` 的"无网络"不再成立、
> `llm-subscriptions` 的"shim 依赖路由 id"描述不准确、`width-tiers` 的档位宽度变化）。
> 改写受 `tests/manifest-notes.test.mjs` 约束：**`note` ≤ 600 code point、`brief` ≤ 80**；当前余量最大的是
> `archify-dsh`（169/600），最紧的是 `skin-center`（517/600）与 `cost-meter`（510/600）。

### 4.1 `cost-meter`：唯一被明确判定"不能升"的条目

**证据（制品级）**

- `1.8.4`：整包**不存在** `lib/native-search-fetch.js`；对 39 个文件全量 grep
  `observeSearchFetch|native-search-fetch|globalThis.fetch|target.fetch` 命中 **0**。
  代码注释反向印证：`lib/native-search-billing.js:3` 写的是"不替换 fetch"。
- `1.8.5` 起出现 `lib/native-search-fetch.js`，`:3` `const original = target.fetch`、`:33` `target.fetch = wrapped`；
  由 `native-search-billing.js:136` 调用，`fetchTarget` 默认 `globalThis`（`:74`）。
- **`1.8.20` 仍在**：`native-search-fetch.js` 与 `native-search-billing.js` 在 1.8.5 与 1.8.20 之间**逐字节相同**；
  安装点未被 config/特性开关包裹（`index.js:3334` 无守卫调用）。1.8.5 是引入点，且 1.8.4→1.8.5 之间无其他版本。

**与 `dsh-opencode-session-header@0.1.0` 的组合风险**

- header 以 accessor 形式 patch `globalThis.fetch`：`lib/index.js:53` 捕获闭包变量、`:55` getter 返 `state.getUnderlyingFetch()`、
  `:95-99` setter 里 `state.setUnderlyingFetch(newFetch)` + 重新 compose（`state.patchedFetch = compose(state)`）。
- 二者可构成**互递归**：cost-meter 冻结了一个**过期的** header composite `P`，而 `P` 仍持有**活的**闭包变量；
  header 的 setter 又把该变量重绑到 cost-meter 的 `wrapped` → `wrapped → P → wrapped → …`。
  用等价转写复现：`header-first` → `RangeError: Maximum call stack size exceeded`（底层 fetch 调用 0 次）；
  `costmeter-first` → 正常返回（1 次）。
- 两个"看起来能兜住"的守卫实际都失效：cost-meter 的 `descriptor?.writable === false` 对 accessor 恒为 `undefined`；
  header 的 accessor 带 setter，所以赋值不抛错。

**但这依赖加载顺序，而生产是安全顺序**

- `scripts/sync.mjs:1630-1639`：bundle 顺序 = 出厂 base 之后按 manifest 顺序。
- 实测**已部署** profile `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles`：
  `dsh-cost-meter` = idx **4**，`dsh-opencode-session-header` = idx **24** → cost-meter 先 → 安全顺序。
- `~/.dsh/dsh-startup.log` 自 2026-09-22 起每次启动的顺序完全一致；
  `~/.dsh/dsh.log`（634 KB）中 `Maximum call stack` 出现 **0 次** → 生产从未触发过该递归。
- 而 `upgrade-dsh-0-2-0-runtime` 的 devbox 候选记录里**确实观测到过**该 `RangeError`
  （`checking/devbox-runtime-continuation.md` F3、`checking/current-main-devbox-regression.md:46`）。
  推测候选环境的应用顺序与服务注入时序不同；candidate 与生产的差异未逐项证明。

**判定**：`dsh.yaml:82` 的"刻意不含 1.8.5 起的全局 fetch observer"作为**纵深防御**成立，且当前生产证据支持"未触发"；
但"header 先加载就会爆栈"已用等价转写证实、且候选环境实测爆过。**在拿到运行时探针证据之前，不应把 cost-meter 升过 1.8.4。**

**顺带记录（1.8.4 → 1.8.20 的其他变化）**

- 新增 `lib/ledger-lock-owner.js:3` `execFileSync`（`getconf CLK_TCK` / `powershell`）→ 新的**同步子进程**面。
- 出站域名集合基本不变（新增的 `docs.mistral.ai` / `docs.z.ai` / `platform.claude.com` 只是价目表 `sourceUrl` 字符串，非请求端点）。
- 凭据读取路径不变（同 4 个文件用 `credentialRef`）。
- 体积 384 KB → 791 KB，`lib/` 32 → 43 个文件。
- **该全局 fetch observer 在任何 README / docs 中都没有写明**；1.8.4 的"不替换 fetch"注释在 1.8.5 被静默改写。

### 4.2 `archify-dsh` 0.1.0 → 1.0.0：不是普通升级，信任面变大

- 类型不变：仍是 skill-only bundle（`cordis.patch.yml`、`lib/index.js` 逐字节相同），
  无 `dependencies` / `peerDependencies`，**连 `scripts` 都没有**（因此不存在 install 钩子），skill 名仍是 `archify`（无重命名，部署副本原地覆盖）。
- **默认路径新增出站 HTTPS**：`SKILL.md:35` 的 `finalize`（快速路径唯一命令）
  → `bin/finalize.mjs:699` `startUpdateCheck(...)` → `bin/delivery-update.mjs:56` spawn 子进程
  → `scripts/check-update.mjs:1394` `fetchImpl(manifestUrl, …)`，目标固定
  `https://tt-a1i.github.io/archify/skill-updates/archify/stable.json`（`scripts/update-contract.mjs:3`，URL 被硬校验不可改指向）。
  0.1.0 全包 `fetch` 调用点为 **0**。逃生门是环境变量 `ARCHIFY_UPDATE_CHECK_DISABLED=1`（`delivery-update.mjs:51`，**SKILL.md 未写明**）。
- **该出站的实际性质（专项审计结论）**：**只是"有没有新版"的匿名查询，不下载不安装**。
  24h TTL（`check-update.mjs:29`），失败退避 6h/24h，4s 硬上限且到点 SIGKILL 子进程（`finalize.mjs:22`、`delivery-update.mjs:68-71`）；
  与各 gate **并行**启动，失败/超时统一归为 `unavailable`，**不影响 exit code 与产物**；
  **上行不携带任何标识** —— 无 User-Agent、无 machine id、无路径、无图内容（`check-update.mjs:1393-1399`，GET + `redirect:'error'`），
  下行是严格白名单键集校验的静态 JSON；有 snooze(7d)/ignore 机制。
  `CHANGELOG` 的 "no telemetry / no automatic updates" 技术成立，但**不等于"无出站请求"**。
- **Chrome 启动的真实行为（专项审计结论，本机 SSH 实测）**：**任何机器上都不会弹窗** ——
  参数固定为 `--headless=new`（`visual-check.mjs:1486`），不需要 `DISPLAY`，**不是 GUI 必需**。
  本会话即 SSH（`SSH_TTY=/dev/ttys002`、`DISPLAY` 未设），而 `/Applications/Google Chrome.app/.../Google Chrome` 存在且可执行，
  正是 `findChrome` 在 darwin 下的第一条固定路径（`visual-check.mjs:1322`）；实测 `--headless=new --dump-dom about:blank` → **exit 0**。
  → **本机 SSH 下 `browser-check` 有条件真通过**，无需 `ARCHIFY_CHROME`。
- **但 `browser-check` 是 `finalize` 的强制阶段且无关闭开关**：它在阶段循环里无条件执行（`finalize.mjs:726`），
  `--skip-browser-check` / `--no-browser` 全包 grep 无匹配。缺 Chrome 时该阶段**自己 skip**（`visual-check.mjs:2456-2481`，warning 级），
  但 `finalize` 把 skip 判为失败（`:369/840/850`）→ **exit 2、`ok:false`、`status:'skipped'`，而 HTML 已由前序 `deliver` 写好**。
  代价是 agent 会被 `SKILL.md:42`「非零即失败」驱动反复重跑；换机器可 `ARCHIFY_CHROME=/path/to/chrome`。
- **与 cockpit 无关，端口转发方案不成立**：`cockpitBridge.forwards` 发布的是 TCP 端口，而 archify 用
  `--remote-debugging-pipe` 走**子进程 stdio 管道**（`visual-check.mjs:1487/1534/1361-1363`）；
  全包 `remote-debugging-port` 出现 **0 次**，也没有任何 CDP endpoint 环境变量 → **没有可被转发的 socket**。
  任何"本机 Chrome + 端口转发"方案都要求改包内代码（等于自建 fork），不计入"使用官方 1.0.0"。
- 其余新增能力：`brands capture <url>`（带 SSRF 防护）；在工作区外写每用户缓存（macOS `~/Library/Caches/archify-skill`）。
- 上游 README 的自我修正最直白：0.1.0 声称无 **network access**，1.0.0 改为
  "**The bundled Skill has an optional notification-only stable Archify update checker and bounded network access for authored remote brand assets.**"
- 新的再分发面：内置 107 个品牌 mark（含一个 `CC-BY-NC-SA-4.0`）与一份 OFL 字体；许可仍是 MIT，且新增了 `THIRD_PARTY_NOTICES.md`。
- `release.json` 声明 `dshVersion: "0.1.2-rc.1"`，但运行时只读 `skills/archify/skill-release.json`，
  后者**不含主机版本声明** —— 该字段是发布溯源信息，**不是加载闸口**（本包也没有任何 peer gate）。
- **与 0.1.0 的准确差异**：0.1.0 **也有同一套 Chrome 引擎**，但**没有 `finalize` 命令**（验收走 `deliver`，浏览器证据是其后可选一步）。
  所以 1.0.0 的真正变化是把「缺 Chrome ＝ 一条被 skip 的证据」升级为「主命令返回非 0」。

**判定：GO（升级）**。理由：本机 Chrome 已具备且实测 headless 可用，browser-check 不构成障碍；
出站仅匿名版本查询、可 `ARCHIFY_UPDATE_CHECK_DISABLED=1` 关闭；1.0.0 提供单命令 gate 编排，保证更强。
**落地时必须改写 note**（原文声称 skill-only、无网络，已不成立），写明两点：
`finalize` 的 `browser-check` 为强制阶段且**无关闭开关**；出站检查的用途与关闭变量。另需注意 note 里"无网络访问"的旧措辞要一并去掉。

### 4.3 `experimental-schedule`：检测器给出的"新版本"其实是降级

`@deepseek-ai/dsh-experimental-schedule-bundle` 的 dist-tag 为 `latest = 0.2.0-rc.1`、`next = 0.2.0-rc.2`；
本仓按 `dshVersion` **同版本精确 pin** `0.2.0-rc.2`（manifest note 明确"升级 dshVersion 时须同步改本 pin"）。
检测器只读 `dist-tags.latest`，于是把它报成 `0.2.0-rc.2 → 0.2.0-rc.1` 并标 pre-release。
**这是 dist-tag 滞后造成的假更新，本轮必须不动。** 也说明"最新版"应同时看 `next` 与同族 pin 语义。

### 4.4 `dsh-cockpit-bridge`：被 skip 是正常的

spec 是 GitHub release tarball（非 npm），检测器按设计跳过（`:181-184`）。已核对仓库 release 列表，
**`dsh-cockpit-bridge-v0.6.4` 即最新**（2026-10-09）。且该包作者是本仓作者（`note` 记为"自研"），不属于"三方"范围。

### 4.5 内容级审计结论（全部 5 项已完成）

方法：curl 取 npm tarball → 解包静态审计；**6 个候选的 sha512 均从 tarball 字节重算并与 `npm view dist.integrity`
及本仓记录的 pin 三方比对一致**；未安装、未执行任何包代码。

#### 4.5.1 `width-tiers` 1.0.6 → 1.0.7 — 低风险，**GO（但有一处可见行为变化）**

- `package.json` 的 `dsh` 声明、`lib/index.js`、`cordis.patch.yml` **逐字节相同**。patch 仍是**恰好一条带显式 id 的 insert 行**：
  `- insert: [{ id: dsh-width-tiers, name: 'dsh-width-tiers' }]` → `note` 要求的"启动清单恰好出现一次"**静态成立**；
  仓库侧也已确认 `patches/` 下不存在 `width-tiers-wiring.yml`，不会叠加第二条同 id 行。
- 能力面复核通过：1.0.7 仍**零** `fetch(`/`XMLHttpRequest`/`WebSocket`/`child_process`/`fs.`，与 note 的"无网络、无 Host 能力"一致。
- **行为变化（需用户确认）**：`medium` 档 **960px → 1120px**（`tierPx()` 的 `Math.min(960, cap)` → `Math.min(1120, cap)`），
  用户可见地变宽约 160px。`--dsh-chat-content-width` 仍是唯一驱动，名称未变。
- 新增 `window.addEventListener("resize", …)`（帧合并，卸载时正确移除）；菜单/标题改为显示档位在**当前列宽下的实际像素**。
  该显示值**复制了应用侧公式** `clamp(680px, column×0.64, 920px)` —— 纯展示耦合，公式漂移只会让文字不准、不影响生效宽度，
  但值得写进 note 的复核项。
- 附注：1.0.6 的**头注释**声称非标准档会关闭右侧面板，而其代码与体注释早已不是这样；1.0.7 只是改正注释，
  1.0.6→1.0.7 **没有** rightbar 行为变化（易被误读为行为变更）。
- integrity：1.0.7 = `sha512-3cGoklw3tYSSXKBf9GzGduv4k9Vv4UO0IHl/FdKMQi+zdw7H9XapvSol4vuxBWqWjnhCWz3VQQc86yBjVrsHBQ==`（已重算一致）。

#### 4.5.2 `skin-center` 0.4.4 → 0.4.5 — 技术上是**安全改善**，但 note 已失真

- 上游做了一次大重构：`lib/index.js` 9329 → 3710 行。
- **Wallpaper Engine / Steam 库扫描被整体删除**：`steamapps` 命中 10 → 0、`wallpaperPropertyListener` 3 → 0；
  连同 `execFileSync(reg.exe)` 查注册表、Steam/WE 路径扫描、`jpeg-js` 依赖一起移除。
  0.4.5 的 `child_process` 使用为 **0**。改为只探测一个**独立第三方插件** `dsh-plugin-wallpaper-engine`
  （`github.com/elysia395/dsh-wallpaper-engine`）是否被委派安装，并读 `$DSH_WE_DATA_DIR`（默认 `~/.dsh-wallpaper-engine`）配置。
- `hooks.mjs` 执行闸口**三个函数逐字节相同**（`verifyMarketProvenance` / `verifyReviewedLegacyHooks` / `verifySkinIntegrity`），
  驳回路径 `403 hooks-require-review` 未变 → **来源/字节身份校验没有被削弱**。内置 `blue-fantasy/hooks.mjs` 逐字节相同。
- 出站：**没有新增域名**。心跳 `https://dsh-market.com/api/telemetry/event` 仍在（每浏览器每 UTC 日一次，
  `localStorage` 去重、`crypto.randomUUID()` 化名、`keepalive`）；0.4.5 **新增** `if (navigator.webdriver) return`（自动化下不报）。
  新增的 `github.com` 三处只是文档/安装提示链接，非 fetch 目标。
- `scripts` 未变：**无 `preinstall`/`postinstall`**；`prepare: tsdown` 只在 git/目录安装时运行（note 原有提醒仍适用）。
- peer 未变（`@deepseek-ai/dsh >=0.1.7-rc.1`）；`dsh.client.inject` 与 `engines` 未变。
- **必须处理**：`dsh.yaml:310` 的 note 仍在描述"读取本机 Wallpaper Engine/Steam 库并提供同源媒体流"与
  "可选 Wallpaper Engine 本机媒体桥" —— 0.4.5 已把该能力移出本包，**note 与制品不符，须改写**（信任面实际是**缩小**的）。
- integrity：0.4.5 = `sha512-+hGFYDAkaaxjye1xfP2N+Rnm30ugwMZoZrdDZwgxssjlGJT5mHipkpCkKkqvApr1I2t6CksxcON0YwhXVHWxIA==`（已重算一致）。

#### 4.5.3 `llm-subscriptions` 0.9.7 → 0.9.9 — **shim 安全，无内容级阻断**

- **出站域名集合完全相同**（19 个 host，`comm` 双向差集为空）。`child_process` 面**完全相同**（4 处，命令全部硬编码）。
  `lib/auth/store.js` **逐字节相同**；`lib/auth/claude-code-creds.js` **逐字节相同**（凭据路径与 0600 模式未变）。
- `package.json` 仅 `version` 与 `packageManager` 不同：deps/peers/scripts/engines 全同。
  **纠正一处预设**：`undici ^7.0.0` 在 0.9.7 与 0.9.9 中都存在，**不是本次引入的变化**。
  五个 DSH peer 末尾的精确 `0.2.0-rc.2` 与本仓 `dshVersion` 精确匹配。
- **`session-links` 无关；`subscriptions-sandbox-shim` 的真实依赖口径被澄清**：
  shim 通过 `ctx.llm.registration(provider)` + `config.providers`（默认 `['codex','grok']`）按
  **LLM provider route id** 判定，而 `PROVIDER_IDS = ['codex','claude','grok','copilot','antigravity']` **未变**
  ⇒ 升级安全。note 里"路由 id 不变（subscriptions-sandbox-shim 依赖）"的表述不准确，宜一并更正。
- 变化项（不阻断，但属新可达面）：新增两条 Fetch 路由 id `prepareReset` / `consumeReset`（原集合的**超集**）；
  新增对 `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`（及 `/consume`）的**带鉴权请求**
  —— 域名是既有的、复用既有 Codex token，属"既有 host 上的新路径"而非新域名。重置兑换为**手动、单次、60 秒过期**，需周内用量 ≥ 80%，提交前先把账号标 `uncertain` 防盲目重试。
- integrity：0.9.9 = `sha512-eXdAPyCONv4F3o+yfcpeHji7mfIQBr4u2vjUC+Bg6XESASOmwNGc0+Ewmpu5u+5hEBXktP0L/27GMn57mtlPAQ==`（已重算一致）。

#### 4.5.4 `better-sidebar` 0.24.1 → 0.25.0 — 契约兼容，**但有一个装后才能验的闸口**

- **`registerTab` 仍在，且 `TabDescriptor` 只做加法**：签名 `registerTab(descriptor): () => void` 未变，
  新增的 `bottomOnly?` / `rightActions?` 是可选字段；`session-links` 传入的
  `{id,title,icon,order,single,component}` 全部未变 → **`session-links` 无需改动**。
  `TabType = string` 未收窄；`openTab`/`OpenTabSeed` 仅新增可选 `reveal?`。
- 宿主路由路径集合**完全相同**（6 条：`/sidebar/api|upload|archive|file|html|bundle`），无重复前缀风险；
  `cordis.patch.yml` 与 `dsh` bundle 声明相同；`agent-opens.ts` 逐字节相同（`sidebar_open` 工具未变）。
- **peer 从 `^0.2.0-rc.1` 提到 `^0.2.0-rc.2`**（14 个 DSH 包）：0.25.0 的下界**恰好等于**本仓部署的
  `dshVersion: 0.2.0-rc.2`。**纠正一处预设**：cordis `^4.0.4` 在 0.24.1 **也已声明**，不是本次变化。
- 出站域名无实际新增（3 处"新增 host"经核查是 xterm 许可注释与文档占位符）；`node-pty` 仍然**不在依赖中**。
- 变化项：新增底部终端 tab（自带 emulator，明确**不持有 PTY**，宿主保留进程生命周期；新增 `@xterm/xterm`、`@xterm/addon-fit` 两个依赖）；
  `child_process` 由 2 处增至 3 处类（新增 `execFileSync('/usr/bin/wslpath')` 与 `rg`/`fd` 搜索探针），
  **全部走 argv 数组、无 `shell:true`**；信任栅栏新增两条窄放宽（bfcache 例外；`dsh-app://app` Electron shell 源），
  在 Host 已把 authority 绑定到 loopback 之后判定 → 对本机 `dsh web` 回环部署**惰性无效**。
- **未决闸口**：仓库既定验收项"`pnpm why` 仅一份实例"**无法静态验证**，必须装后复核。
- 上游 README 自身不一致（称 0.24.1 起下界即为 `0.2.0-rc.2`，但 0.24.1 实际 peer 是 `^0.2.0-rc.1`），且 tarball 不含 CHANGELOG，属文档瑕疵。
- integrity：0.25.0 = `sha512-5dro5VDpkrnWBO5jNff6Kzt8UlniZEWwXFqsl+wptlqnGMC4PrdJQ4Sd3+tLU8LPKYH8dDI00Dd5IC3FtH/erA==`（已重算一致）。

#### 4.5.5 `jev` `@jkudish/jev-mcp` 0.6.0 → 0.14.1 — 关键轴兼容，但新增未受 pin 的供应链面

- **不需要更新 bridge（比"有交集"更强的结论）**：0.14.1 把 MCP SDK 从 `@modelcontextprotocol/sdk ^1.x` 换成
  `@modelcontextprotocol/server ^2.3.1` + `@modelcontextprotocol/node ^2.1.1`（v2 代）；
  本仓已 pin 的 `@deepseek-ai/dsh-mcp-client@0.2.0-rc.2` 依赖 `@modelcontextprotocol/client@2.0.0`（同为 v2 代）。
  两侧 `core` 的协议常量**逐字相同**：`LATEST_PROTOCOL_VERSION="2025-11-25"`、
  `SUPPORTED=[2025-11-25,2025-06-18,2025-03-26,2024-11-05,2024-10-07]`（bridge 侧 core@2.0.0 与 jev 侧 core@2.3.1）。
  launcher 引用的 `<pkg>/dist/index.js` 在 0.14.1 仍存在（`exports` 变化不影响文件路径引用）。
  仍是**强静态推断，非实跑握手**，安装后应以一次真实调用收口。
- **工具集纯加法**：10 → 12，原有 10 个（含 `jev_verify`/`jev_classify`/… 全部）**无改名无删除**，
  新增 `jev_noul`、`jev_audit`。既有 preset / 文档引用不受影响。
- transport 仍**默认 stdio**（HTTP 需显式 `--http` 或 `JEV_MCP_TRANSPORT=http`，launcher 都不传）；
  服务自报名两版均为 `{name:"jev-mcp"}`；`TYPESAFE_API_KEY` 仍是正确凭据变量（`third-party-resources.mjs` 对其另有硬断言）。
- `engines.node` 由 `>=20` 提到 `>=22`；本机 Node v24.16.0 满足。`zod` 3 → 4（`tools/list` 输入 schema 会多出 `propertyNames`，对透传无影响）。
- **供应链面（审计后修正）**：0.14.1 的 5 个运行时依赖**全部是浮动 caret 且全部无 integrity** ——
  `@jkudish/jev-agent-tools ^0.2.0`、`@modelcontextprotocol/node ^2.1.1`、`@modelcontextprotocol/server ^2.3.1`、
  `@typesafe-ai/sdk ^0.6.0`、`zod ^4.6.5`。0.6.0 同样是 5 个浮动，因此"浮动依赖"本身**不是新增性质**；
  **新增的是 provider 选择与 TypeSafe 直连逻辑改由一个浮动包接管**。
  仓库工具**结构性地不可能**发现该漂移：`plugin-updates.mjs:135` 的 `npm view` 投影从不请求 `dependencies`，
  `third-party-resources.mjs` 只校验已声明三元组、不读依赖树与 lockfile。
  缓解事实：部署 profile 里**确有** `~/.dsh/profiles/web/pnpm-lock.yaml`，装后会把传递依赖钉死；
  真实风险因此不是"已装机器静默升级"，而是**跨机器 / 重新 provision 发散**（且该 lockfile 在非版本控制的 `~/.dsh`）。
  审查时 `^0.2.0` 解析结果为 **0.2.0**（integrity `sha512-tFLUeMMiSUsaFyNAXBoQ98k/vN0n/o46BoRL/ygxr81YEkWv4k5VLVWpc9A4wBxrqOXz4dNA32lcYMwmDt32wQ==`）。
- `@jkudish/jev-agent-tools@0.2.0` 能力面**极干净**：零运行时依赖、无 install 钩子、无 `child_process`、无 fs I/O、无模块级副作用；
  出站仅 typesafe/openrouter/cloudflare/vercel 四个真实端点；凭据只从注入 env 读、只发 `Authorization: Bearer`。
  且 launcher 硬编码 `JEV_PROVIDER: 'typesafe'` 且 **spawn 的 env 是替换而非合并** → 本仓形状下**确定**走 TypeSafe。
- **更正先前两处表述**（本文件早期版本有误，以审计为准）：
  (1) 0.14.1 **没有**"取消 0.6.0 的启动期凭据 fail-fast" —— **两版都没有**启动期 fail-fast，
  provider 解析都在调用期执行；本仓真正的启动期 fail-fast 来自 launcher 的 `process.exit(78)`。此条**不是回归**。
  (2) `toolCallTimeoutMs: 30000` 与 jev 内层 `REQUEST_TIMEOUT_MS` 默认 `60000`（含 3 次重试）的预算不一致，
  在 0.6.0 就是同值，**不是本次回归**；可选加固需改 `renderMcpLauncher` 源码，**建议单独立项，不塞进本次改 pin**。
- tarball 新增 `skills/jev/`（面向 agent 的 prompt 内容），本仓不会被自动消费，但属新增载荷。
- **升级三元组（可直接替换三行）**：`spec: '@jkudish/jev-mcp@0.14.1'`、`version: 0.14.1`、
  `integrity: sha512-HGG0NyKGdGBTyIUsrxXdf3Da0rVBk0YM2p8zDRcZXnbAxaa/EOC9vFWgD5/snVz0K0NiSmz1eMh/aahbxPoQ7w==`
  （`npm view` 与本地重算一致，现行 0.6.0 pin 亦已复核未被篡改）。`bridge`/`serverName`/`credentialEnv`/`toolCallTimeoutMs`
  **四字段全部不需要改**。
- ⚠️ **该条目的审查记录不能写进 `dsh.yaml`**：`third-party-resources.mjs:32` 对 `npm-mcp-server` 白名单化字段，
  `noUnknown()` 会以 `unknown field note` 直接拒绝。记录只能落在本 change 文档（即本文件）。
- **判定：GO**，残留 3 条风险：① 未做真实握手（安装后应补一次真实 `jev_classify` 调用）；
  ② `^0.2.0` 未来解析不可知；③ DSH plugin manager 是否每次 sync 尊重 lockfile 未读，故"已装机器保持旧解析"是推断。

## 5. 计划

### 阶段 0 — 前置（不做则后续验收无效）

1. **`ws promote`**：本 Worktree Session 当前 `dependencyMode: lean`。按 Worktree Session 规则，
   "an operation that may install, remove, update, or otherwise mutate dependencies" 之前必须 promote 并验证成功。
   本轮会触发 `sync` 在 profile 中安装/更新插件包，故先 promote。
2. **确认构建落点**：本 worktree 内 `DSH_HOME=/Users/prgrmrwy/.dsh`（生产），而 `bin/dsh:99` 用
   `DSH_HOME="${DSH_HOME:-$HOME/.dsh}"`、`sync.mjs:50` 用 `resolveDshHome(process.env.DSH_HOME)`。
   即**默认会把构建打到生产 `~/.dsh`**。因此隔离验证必须显式
   `DSH_HOME=<worktree 隔离 home> node scripts/sync.mjs`，不得直接 `dsh build`。
   （隔离 home 已存在但为空：`.git/ws/dsh-home/25247700-8aaf-4de4-9e97-56ea04dc8d98`。）
3. 记录基线：当前 `check-plugin-updates` 输出、`~/.dsh/profiles/web/package.json` 依赖快照、启动清单。

### 阶段 1 — 低风险批（建议直接实施）

`width-tiers 1.0.6 → 1.0.7`、`skin-center 0.4.4 → 0.4.5`。

- 两者内容审计均**无阻断项**（§4.5.1 / §4.5.2）。只改 `spec` / `version` / `integrity` 与 `note`，**不动 manifest 顺序**。
- **`width-tiers` 需用户先确认一处可见行为变化**：`medium` 档 960px → 1120px（不是纯内部重构）。
  专属验收（note 已写明）：启动清单中 `dsh-width-tiers` **恰好出现一次**；并确认
  `patches/width-tiers-wiring.yml` **仍然不存在**（本次已核实 `patches/` 仅有 `connection-webserver.yml`），
  否则会与包自带 bundle patch 叠加出两条同 id loader 行。note 宜补记"medium 档变宽 + 显示值复制了应用侧公式"。
- **`skin-center` 的核心工作是改写 note**：能力被上游删减（Steam/WE 扫描移除），
  现有 note 描述已与制品不符。改写后的 note 应说明：不再是本包读本机媒体库，改由可选第三方插件
  `dsh-plugin-wallpaper-engine` 承担；`hooks.mjs` 闸口未削弱；`dsh-market.com` 每日心跳仍在（新增 `navigator.webdriver` 跳过）。
  注意 `skin-center` 现有 note 已占 517/600 code point，**改写时须控制在 600 以内**（`tests/manifest-notes.test.mjs` 强制）。
- 建议同时确认：本部署**没有**安装被委派的 `dsh-plugin-wallpaper-engine`（未安装时读配置缺失 → 安全回落"无壁纸"）。

### 阶段 2 — 中风险批（内容审计已通过，须补一项装后复核）

`llm-subscriptions 0.9.7 → 0.9.9`、`better-sidebar 0.24.1 → 0.25.0`。

- `llm-subscriptions`：出站域名集与 `child_process` 面**完全未变**，shim 真正依赖的
  `PROVIDER_IDS` **逐字节相同** → 无阻断。需在 note 里更正两处旧表述
  （"shim 依赖路由 id"应写明是 **LLM provider route id**；`undici` 并非新引入），
  并记录新增的 `chatgpt.com` reset-credits 两个鉴权路径与 `prepareReset`/`consumeReset` 两个 Fetch 路由（新可达面，非新域名）。
- `better-sidebar`：`registerTab` 契约兼容、`session-links` **无需改动**、路由路径集与 bundle 声明未变。
  peer 下界提升到 `^0.2.0-rc.2`，**恰好等于**本部署的 `dshVersion`；本轮 `dshVersion` 不变，故满足"随运行体同批"。
  **必须补做的验收**：`pnpm why dsh-better-sidebar` 仅一份实例 —— 该闸口**无法静态验证**，只能在安装后复核；
  另需确认新增的 `@xterm/xterm`、`@xterm/addon-fit` 未与本机既有实例冲突。
- note 需记录的信任面变化：新增底部终端 tab（插件不持有 PTY，宿主管进程）、
  `child_process` 新增 `wslpath`/`rg`/`fd` 探针（全 argv、无 `shell:true`）、信任栅栏两条窄放宽（对本机回环部署惰性）。

### 阶段 3 — 已裁决为实施（前置专项审计均已完成并 GO）

两项纳入本轮实施；**`cost-meter` 仍排除**。

- **`archify-dsh` 0.1.0 → 1.0.0**：**GO**（依据见 §4.2）。本机 Chrome 已具备且 SSH 下 headless 实测 exit 0；
  `browser-check` 的强制性与"无关闭开关"是**行为变化而非阻断**（缺 Chrome 时 HTML 仍已生成）；
  出站仅匿名版本查询且可关。落地动作：`spec` → `@tt-a1i/archify-dsh@1.0.0`，
  integrity `sha512-ae5L+SyZngy3EzYnWHHfccAYJCZh5e9MTkEBh7mrwTMfpwpFtkIhiOg2vI5xnluCS8CSb+Ne1hi1kOWRQQtGBQ==`，
  并按 §4.2 末段重写 note（现有 169/600，余量充足）。
  **不**在部署侧设 `ARCHIFY_UPDATE_CHECK_DISABLED=1`；若要关，该变量能否经 DSH skill 子进程环境透传**尚未审计**，需先验证。
- **`jev` 0.6.0 → 0.14.1**：**GO**（依据见 §4.5.5）。只改 `spec` / `version` / `integrity` 三行，
  `bridge` / `serverName` / `credentialEnv` / `toolCallTimeoutMs` 均不动；**不要**顺手改超时（属单独立项）。
  ⚠️ 该条目**不能加 `note`**（`third-party-resources.mjs` 字段白名单会以 `unknown field note` 拒绝），
  审查记录留在本文件。收口动作（安装后）：真实调用一次 `jev_classify`，把静态协议推断升级为运行证据。
- **`cost-meter`**：本轮**不动**，维持 1.8.4。若日后希望放开，须先做运行时探针
  （真实 Host 内同时加载 header 与目标版本，触发一次 fetch，观察是否 `RangeError`），探针通过才可改 pin；
  或在 `dsh-opencode-session-header` 被移除 / 上游发布修复版之后再评估。

### 阶段 4 — 工具链修补（建议与本轮解耦、但尽快做）

否则下一轮"统一升级"还会踩同样的坑：

1. `detectRemotePluginUpdates()` 纳入 `thirdPartyResources`（至少对 `npm-workflow` / `npm-mcp-server` 报版本与 integrity 漂移）。
2. `satisfies()` 换用仓库已依赖的真实 `semver`（`package.json` devDependencies 已有 `semver ^7.8.5`），
   并显式声明 `includePrerelease: true` 以对齐 DSH 闸口；同时把 `null`（无法判定）从"通过"改为**显式 needs-review**。
3. 修正 `deployedCordisVersion()` 的探测路径以匹配 launcher 形状（或直接从正在加载的 DSH 运行时解析），
   并在检测器里注明"cordis peer 不参与 DSH 加载判定"。
4. 增加一条**上界保护**：允许 manifest 条目声明"刻意保持的上界"（如 `pinCeiling`），
   让自动升级不再把有意的 holding pin 判为可升级。

### 阶段 5 — 物化与验收

每个批次都走同一套闸口：

1. 改 `dsh.yaml`：`spec` / `version` / `integrity` 三件套，**并同步改写 `note`**
   （至少 `skin-center`、`llm-subscriptions`、`width-tiers`、`better-sidebar` 四条，见 §4 末注与各批说明）。
   注意 `tests/manifest-notes.test.mjs` 强制 **`note` ≤ 600 code point、`brief` ≤ 80**；
   `tests/manifest-version-drift.test.mjs` 要求 `version` 必须等于包内真实版本（不得带 fork 装饰）。
2. 隔离 home 物化：`DSH_HOME=<隔离 home> node scripts/sync.mjs`，**连跑两次**，第二次必须无变化（幂等）。
3. 根校验：`npm test`、`npm run check:artifacts`；`node scripts/check-plugin-updates.mjs` 复跑确认清单收敛。
4. **装后闸口**（仅阶段 2）：`pnpm why dsh-better-sidebar` 仅一份实例；确认 `@xterm/*` 无重复实例。
5. 生产物化由用户批准后执行 `dsh build`（两次）+ `dsh restart`，随后 GUI 验收：
   宽度档位（含新 `medium` 宽度）、皮肤中心（含壁纸能力已移出后的表现）、订阅登录与 codex 目录、
   better-sidebar 工作台与「文档/资料」tab、底部终端、自动化任务页仍在。
6. 失败回滚：`spec`/`version`/`integrity`（及 `note`）改回上一 pin（git 历史）→ build → restart；必要时 `enabled: false`。
   每条的既定回滚口径已在各自 `note` 中，沿用不改。

## 6. 需要用户裁决的问题

1. **本轮范围**：是否按"阶段 1（width-tiers + skin-center）+ 阶段 2（subscriptions + better-sidebar）"实施？
   `cost-meter` **明确排除**（保持 1.8.4）。
2. **`width-tiers` 的 `medium` 档 960 → 1120px 是否接受**？这是升级里唯一的用户可见行为变化。
3. **`archify-dsh` 1.0.0 怎么处理**：接受新增出站（并改写 note）／升级 + 部署侧
   `ARCHIFY_UPDATE_CHECK_DISABLED=1`／本轮不升？
4. **`jev` 0.6.0 → 0.14.1 是否本轮做**：若做，是否先接受"审计 `@jkudish/jev-agent-tools` + 一次真实调用冒烟"两个前置？
5. **阶段 4 工具链修补是否同期做**（建议做：检测器漏检 `thirdPartyResources`、`satisfies` 把"无法判定"当通过、
   cordis 探测路径失配、以及缺少"刻意上界"保护，四条都会在下一轮重复制造同样的误判）。
6. 是否把本文件补齐为完整 OpenSpec change（补 `design.md` / `specs/` delta / `tasks.md`）后再进入实施？

## 7. 本次评估的边界（未做与不能声称的事）

- **未改动任何 manifest 或部署**：`dsh.yaml`、`~/.dsh` 均未被写入；未执行 `sync` / `dsh build` / `restart`。
- **未安装、未执行任何第三方包代码**：全部结论来自 tarball 静态审计与仓库内证据。
- **`cost-meter` 的加载顺序结论是静态推断**（由 `sync.mjs:1630-1639` 的 bundle 排序规则 +
  已部署 profile 的 `dsh.profile.bundles` 数组 + 启动日志一致性推出），**未做运行时探针**；
  cordis 的 `inject` 调度是否可能改变两者的实际 `apply()` 顺序仍未证明 ——
  这正是"若要放开 1.8.4 上界，必须先探针"的理由。
- **`jev` 与 bridge 的协议兼容是强静态推断**，未实跑握手。
- **`pnpm why` 单一实例无法静态验证**，必须装后复核。
- 采集用的临时目录 `.plugin-audit/` 属未跟踪产物，**不在交付内容内**（收尾时清理）。
