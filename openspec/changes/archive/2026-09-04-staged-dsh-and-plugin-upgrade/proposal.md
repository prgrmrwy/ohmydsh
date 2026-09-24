## Why

本仓库的 DSH pin(`0.1.1-rc.2`)与多个远端插件 pin 已落后于上游,而一次性升级不可行:预检发现 DSH `0.1.2` 线不是版本号推进,而是**客户端插件架构的一次改朝换代**——`@deepseek-ai/dsh-client-runtime` 在 `0.1.2` 线不再存在(npm 版本止于 `0.1.1-rc.2`,`latest` tag 已回落到远古的 `0.0.1-rc.1`),`dsh-web-app@0.1.2-rc.1` 不再依赖它,改为 `dsh-api-session-controller` / `dsh-client-ui-session` / `dsh-client-ui-chat` / `dsh-client-ui-approval`。本仓库 8 个自研 package 中有 7 个 inject 了该包,合计涉及 24 个运行体接口面。

同时,升级项之间存在**单向依赖**:一部分插件升级完全不需要动 host,而另一部分(`dsh-better-sidebar@0.18.0`、`dsh-sidebar-qa@0.5.0`)必须先升 host。把两者混在一次升级里,会让故障无法二分定位。因此需要一个按风险与收益排序、可独立验证与回滚的分阶段方案,而不是一次大爆炸式升级。

本变更**只定义并执行升级本身的编排与验收**,不改变任何插件或自研包的功能语义。

## What Changes

### 阶段一:零 host 依赖的低风险插件升级
- `dsh-cockpit-bridge` `0.2.0` → `0.2.1`(自有仓库;capability 失效自愈,修复未读绿点被误清)
- `dsh-plugin-subscriptions`:从临时 fork commit tarball 切回 npm `0.6.0`,**移除临时 fork 条目**(上游 PR #40 已于 2026-08-29 合并,`0.6.0` 的 tag commit 主语即 "one build for both dsh 0.1.1-rc.2 and 0.1.2-alpha runtimes")
- `dsh-cost-meter` `1.5.42` → `1.7.10`(需宿主冒烟:`1.7.0`/`1.7.8`/`1.7.9` 曾致启动即崩,`1.7.10` 为该功能线首个稳定版)

### 阶段二:width-tiers 升级并回收手写接线 **BREAKING(部署侧)**
- `dsh-width-tiers` `1.0.3` → `1.0.4`,该版本**新增了自带 `cordis.patch.yml`**,内容与本仓库手写的 `patches/width-tiers-wiring.yml` 完全等价
- 必须与「删除 `width-tiers-wiring` patch 条目、改由 bundle 承载」在**同一步**完成:两份 insert 会按 DSH `applyEntryPatches` 语义产生**两条同 id 的 loader 行**
- 验收利用刚修复的启动清单:该行应从 `[patch]` 标注变为普通 bundle 行

### 阶段三:better-sidebar 升到兼容上界
- `dsh-better-sidebar` `0.16.0` → `0.17.1`(**不是** `0.18.0`)。`0.17.1` 是最后一个 peer 仍接受 `@deepseek-ai/cordis ^4.0.1` 与 `dsh-* ^0.1.0-rc.8` 的版本

### 阶段四:DSH host 迁移到 `0.1.2` 线 —— **已探明,不在本变更执行**

原计划在本变更内完成运行体升级。实际执行到 6.5 时,按 tasks 4.5 的阀门条款**停止并回退**,理由是破坏面超出本变更 Non-Goals 划定的「只做等价接线迁移」范围。已完成并保留的部分:

- ✅ **前置 spike**:`dsh-client-runtime` 的 client 半区接口落点已查清(5 个服务面拆到 4 个包,服务名与 `ctx.<name>` 取用形态不变),见 design S1–S5
- ✅ **前置基线**:`baseline.md` 已建立并在升级前跑通(自动化 951 例 + 人工清单),并在本次失败中**实际发挥归因作用** —— 干净区分「升级导致」与「升级前即存在」
- ⛔ **升级执行**:`dshVersion` → `0.1.2-rc.1` 及 7 包重接线**已回退**,`dshVersion` 保持 `0.1.1-rc.2`
- ⛔ **后置放行**:`better-sidebar@0.18.0` 与 `sidebar-qa@0.5.0` 随之不放行(准入条件已查清,见 design S4)

**停止原因**:spike 只审计了 client 半区,遗漏 host 半区。实测 8 包中 5 包无法构建,破坏点为 `Session.events` 移除、`connection.rpc.handle` 删除 `{authority:'loopback'}` 参数(**安全边界变更,不可机械删参**)、`SubagentRuntime.registerContinuableSetup` 移除。三者均非接线迁移,而是 host 行为面适配。完整结论见 design「阶段四执行结论」。

**后续**:运行体迁移以新题目(「DSH `0.1.2` host 半区 API 适配」)独立立项,本变更的 spike 与基线可直接作为其输入。

### 明确不做(本变更范围外)
- 不升级 `dsh-sidebar-qa` 至 `0.5.0` 直到阶段四完成:`0.5.0` 改用 `ctx.remote.session.*`,而现役运行体的 remote 命名空间实测只有 `commands / goals / dynamicCordisRunner / pluginInventory / fileReferences / sessionReferenceResolver`,**没有 `session`**;其 `engines.dsh` 声明不被 npm/pnpm 执行,升级会装得上但**静默不激活**
- 不升级 `archify-dsh` / `ui-archive-manager` / `open-in-vscode`(均已是各自最新可得版本)
- 不改动任何插件或自研包的功能语义

## Capabilities

### New Capabilities
- `staged-upgrade-execution`: 分阶段升级的编排契约——阶段如何切分、每个阶段的准入与验收条件、升级前后能力基线如何固定与比对、失败如何回滚,以及"接线迁移类升级必须原子完成"这一不变量。

### Modified Capabilities
- `repo-layout`: 「自研 package 的运行体 peer 声明跟随 manifest 版本族」的语义补全——版本族迁移期间该检查失败是**预期前置门槛**而非缺陷(不得通过放宽检查、豁免个别 package 或跳过来消除);`dshVersion` 与 peer 声明必须**同批次**变更;上游在新版本族中**移除或拆分**的运行体包不得被机械改写为同名声明,须改声明为实际承接包或移除。该规则已在阶段四执行中被**实际检验**:`dshVersion` 提到 `0.1.2-rc.1` 后检查如期全量失败,并以「移除上游已删除的 `dsh-client-runtime` + 声明实际承接包」消解、未放宽任何检查(随阶段四回退)。

## Impact

- **配置真相源**:`dsh.yaml`(pin、`enabled`、临时 fork 条目移除)、`patches/width-tiers-wiring.yml`(阶段二删除)
- **自研包**:`packages/` 下 8 个 package 的 `peerDependencies` 在阶段四需同批更新(该批次已实测并回退)
- **运行体**:**保持 `0.1.1-rc.2` 不变**。原计划升到 `0.1.2-rc.1` 已在 4.5 阀门停止并回退;`@deepseek-ai/cordis` 实测本机已是 `4.0.2`(`dsh@0.1.1-rc.2` 依赖 `^4.0.1`,范围自然上浮),并非本变更所致
- **校验**:`tests/local-package-peers.test.mjs` 在版本族迁移期间全量失败是前置门槛而非缺陷(已实测验证);回退后恢复 3 例通过
- **已知覆盖缺口**:`packages/worktree-session/src/index.ts` 的 `agent/session-start` 编排时序(同步跳过 guard + 异步落盘)无独立自动化覆盖,来自 `2026-09-04-release-binding-when-worktree-is-gone` 归档记录;已在 `baseline.md` B2.1 以实施过程证据覆盖
- **开发方式**:阶段四在独立 Worktree Session(隔离 `DSH_HOME`)中进行并已验证隔离有效——升级与回退全程未影响日常 GUI(`~/.dsh` 21 插件、主 checkout `dshVersion` 均未受触碰)
- **顺带纳管**:`dsh-setting-restart@1.0.0`(设置→通用 一键重启)按 `add-dsh-plugin` 流程加入 manifest,启动清单由 20 项增至 21 项
