# startup-autoupdate — Design

## Context

动机见 `proposal.md` — Why。现状:`bin/dsh` 读取 `dsh.yaml` 的 `dshVersion`(唯一版本来源),启动时 `npx -y @deepseek-ai/dsh@<pin> web` 按需拉取运行体,`sync.mjs` 的全部插件操作也走同一 `npx @deepseek-ai/dsh@<pin>`——pin 同时决定运行体与 build 工具链,且**没有全局安装的 dsh 二进制**。因此「更新 dsh」的实质 = 改 pin + 由 npx 拉新包 + 重跑 sync 校准定制。约束:本机 npm 缓存存在环境性 EPERM(与 npm 写入位置无关时也会出现),故检测不得依赖 `npm view`/npx 写缓存;manifest 注释丰富,改 `dsh.yaml` 必须是行级文本替换而非 YAML 往返。

## Goals / Non-Goals

**Goals:**
- 三个入口(`dsh` start / `-b` / `build`)统一前置于「检测 → 按条件升级 → 继续」。
- 升级原子化:改 pin → sync → commit 三步要么成链完成,要么失败即停并保持可恢复,不产生半成品状态遗留与坏 commit。
- 默认启动即检查、fail-open(离线不阻塞),逃生门完备。

**Non-Goals:**
- 不做第三方插件的版本检测/升级(只联动 `@deepseek-ai/dsh-*` 同族)。
- 不做 `dsh.yaml` 之外的仓库文件改写(不在 apply 阶段实现本 change 之外的改动)。
- 不引入守护进程或后台定时检测;检测只发生在用户主动调用的入口。

## Decisions

### D1: 检测逻辑收敛为独立脚本 `scripts/check-update.mjs`,bash 只做分支

与 `sync.mjs` / `plugin-list.mjs` 同构:node 脚本读 manifest、查 registry、semver 比较,输出 JSON(`{status: update|no-update|offline, current, latest, channel, ...}`),`bin/dsh` 按 status 走分支,改用谁执行(改写/build/commit)仍是 bash 主导。

备选:纯 bash 实现检测(内联 node -e + curl)。弃用:版本比较、JSON 解析、错误分支在 bash 里难维护,且与仓库「node 脚本承载逻辑」惯例不符。

### D2: registry 查询走 node https 直连,超时 5s 后判 offline

查询 `GET https://registry.npmjs.org/@deepseek-ai/dsh`(或名称编码后的缩写 dist-tags 端点)取 `dist-tags.<channel>`,用 Node 内置 `https`,网络超时 5s。失败 → `offline` → 警告 + 按当前 pin 继续。

备选:`npm view`。弃用:本机已复现 npm 缓存写入 EPERM(非属主/ACL 问题,是缓存/沙箱环境性故障),不能让启动路径依赖会写缓存/日志的 npm CLI。

### D3: 版本比较新增 `semver` devDependency

`0.1.0-rc.N` 预发布数字序(`rc.9` < `rc.10`)需真正 semver 比较,不能字符串比。仓库已有唯一 devDep `js-yaml`,补 `semver` 一致(`bootstrap.sh` 幂等 `npm install` 会装上)。

备选:手写 ~30 行比较器。弃用:正确性风险高,不如引入经过验证的依赖。

### D4: 工作区检查用整仓 `git status --porcelain` 非空即「脏」

用户已拍板整仓检查(而非只盯 `dsh.yaml`)。脏 → 跳过升级 + 输出说明。干净 → 允许升级。

推论(设计自洽性关键):自动升级会改写 `dsh.yaml` 使工作区变脏,若不 commit,下次启动的整仓检查必挡更新 → 自锁。故「自动 commit」不是可选项,而是「整仓检查 + 自动追赶」唯一自洽解;`autoUpdate` 不提供独立 `commit: false` 开关(会复生死锁),整体逃生门即 `enabled: false` / `DSH_SKIP_UPDATE=1`。

### D5: 同族联动规则 = 名字 `^@deepseek-ai/dsh-` 且 pin 精确等于旧运行体版本

作用位置:顶层 `dependencies` 条目的 spec、`package` 定制条目的 `spec` 与 `version`。改写为「旧运行体 → 新运行体」整版本替换。不匹配名字或 pin ≠ 旧运行体(刻意钉的,如 `rc.8`)一概不动。第三方(如 `dsh-cost-meter@1.5.6`)天然不匹配名字前缀,不受影响。

备选:只升 `dshVersion`、其余交给 sync drift 检测。弃用:sync 的 drift 逻辑会把「用旧 pin 重装」当成正确结果,长不出正确的新版本组合;用户已明确要联动。

### D6: `dsh.yaml` 改写字面级文本替换,`dshVersion` 与同族行分别匹配

整文件 YAML 解析-写回会销毁注释(本 manifest 注释即真相源的一部分),故不做。规则:
- `dshVersion` 行:首个 `^dshVersion:` 值替换;
- 同族行:仅当该行文本同时满足(含 `@deepseek-ai/dsh-` 与旧版本号),把旧版本号段替换为新版本(对 `dependencies` 的 `@pkg@ver` spec 与 `version: ver` 都命中);
- 改写前写 `dsh.yaml.bak`(与 `sync.mjs` 写 `cordis.patch.yml.bak` 同款风格)。

### D7: 失败语义(用户拍板「硬失败」)

- **sync 失败**:从 `.bak` 恢复 `dsh.yaml`(内容回到 HEAD,工作区自然复净)→ 报错退出,不启动。
- **commit 失败**:报错退出,不启动。此时 `dsh.yaml` 已在新版本、sync 已跑完——不自动回滚(避免把已完成物化再次来回折腾),输出明确告知「手动 `git commit dsh.yaml` 或 `git checkout dsh.yaml` 回滚」;注意此后工作区脏会让后续自动更新暂停,直到手动处理,这是整仓检查 + 硬失败的固有代价,输出已说明。
- **检测失败/离线**:fail-open,警告后继续(fail-open 与「硬失败」并存:只在「更新已确认、开始执行」后硬失败;检测期不确定则放行)。

### D8: 自动 commit 用 `--no-verify` + 固定 message

`git add dsh.yaml && git commit --no-verify -m "chore(dsh): auto-bump <旧> → <新>"`(只 add 本流程改过的 `dsh.yaml`,绝不 `-A`,避免卷走无关文件)。`--no-verify` 因工作区干净前置,本流程不会碰用户其它改动;跳过 pre-commit 钩子避免 lint/测试把启动路径卡住(用户已拍板)。

备选:走 hooks、`git add -A`。弃用:前者把启动变成钩子网关,后者冒卷走未提交工作的风险。

### D9: 触发口径与历史

- start 入口仅当 server 未运行时检测(已运行只开 UI 不检测);`-b` 与 `build` 同样前置检测。
- 升级完成后,`-b`/`start` 不再重复 build(sync 已在升级链跑过)。
- `record_startup` 扩展:autoUpdate 事件单独成行写 `$DSH_HOME/dsh-startup.log`(升级 from→to/channel;跳过 version+原因;离线),`dsh history` 照旧 tail 展示。

## Risks / Trade-offs

- **[自动改写仓库真相源]** → 与「不自动漂移」旧约定冲突:以 `dsh.yaml.bak` + 自动 commit(可回滚)+ 逃生门 `enabled:false` 三件套兜底;每次提交是独立 commit,`git log` 可完全追溯。
- **[同族联动可能生成不兼容组合]** → 若某 rc 运行体与 `dsh-sdk-protocol` 不同步发布,联动可能产出 sync 装不上/握手失败的组合;由 D7 的「sync 失败回滚 + 报错退出」兜底,不会进入坏状态,代价是重试一次。
- **[commit 失败后的脏工作区自锁]** → 硬失败后工作区留「已升级未提交」状态,后续自动更新暂停;输出明确处置路径,属可接受的显式降级。
- **[整仓脏检查误伤]** → 用户在其他地方(如边写代码边跑 `dsh`)有大量未提交改动时,自动更新会被持续跳过;这正是用户选择的保守语义,输出会说明原因避免困惑。
- **[registry 不可达环境的「每次启动」延迟]** → 检测每次启动都直连 registry(约百毫秒),离线时 5s 超时;用户已接受「每次启动都查」。

## Migration Plan

1. 加 `semver` 到 `package.json`(devDependencies),跑一次 `npm install`(或 `./scripts/bootstrap.sh`)。
2. 新增 `scripts/check-update.mjs`,先手动 `node scripts/check-update.mjs` 验证 JSON 输出正确(当前环境应报 `update: rc.6 → latest rc.7` 或按 `--channel next` 报 rc.8)。
3. 改 `bin/dsh` 接入分支;`dsh.yaml` 增加 `autoUpdate: {enabled: true, channel: latest}` 顶层字段。
4. 手工验证各分支:干净工作区升级成功并 commit;脏工作区跳过并说明;断网(或临时改 channel 为不存在的 tag)走 offline;人为让 sync 失败验证回滚;锁定 `dshVersion` 为目标版本后再跑验证 `no-update`。
5. 更新 README 升级约定段落。
6. 回滚预案:`autoUpdate.enabled: false` 或整体 revert 该 commit 即可回到纯手工改 pin 模式;`dsh.yaml.bak` 提供当次升级内容级回滚。

## Open Questions

- 无。探索期遗留的分叉(频道、检查频率、同族联动、commit 钩子与失败语义)均已由用户拍板并落入本设计与 specs;实现期如遇 registry dist-tag 语义变化(如引入 `stable` tag)再单独变更。
