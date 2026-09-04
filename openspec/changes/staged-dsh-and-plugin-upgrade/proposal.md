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

### 阶段四:DSH host 迁移到 `0.1.2` 线(先 spike,后执行)
- **前置 spike**(只调研、不改代码):查清 `dsh-client-runtime` 的接口在 `0.1.2` 线的落点与接入方式,产出 7 个自研包的逐包改动量评估
- **前置基线**:在升级前固定一套可复跑的能力基线(现有自动化测试 + 一份端到端清单),用于证明升级前后能力稳定
- 升级 `dshVersion` → `0.1.2-rc.1`(连带 cordis `4.0.1` → `4.0.2`)
- 7 个自研包重新接线并同步更新运行体 peer 版本族
- 随后放行 `dsh-better-sidebar@0.18.0` 与 `dsh-sidebar-qa@0.5.0`

### 明确不做(本变更范围外)
- 不升级 `dsh-sidebar-qa` 至 `0.5.0` 直到阶段四完成:`0.5.0` 改用 `ctx.remote.session.*`,而现役运行体的 remote 命名空间实测只有 `commands / goals / dynamicCordisRunner / pluginInventory / fileReferences / sessionReferenceResolver`,**没有 `session`**;其 `engines.dsh` 声明不被 npm/pnpm 执行,升级会装得上但**静默不激活**
- 不升级 `archify-dsh` / `ui-archive-manager` / `open-in-vscode`(均已是各自最新可得版本)
- 不改动任何插件或自研包的功能语义

## Capabilities

### New Capabilities
- `staged-upgrade-execution`: 分阶段升级的编排契约——阶段如何切分、每个阶段的准入与验收条件、升级前后能力基线如何固定与比对、失败如何回滚,以及"接线迁移类升级必须原子完成"这一不变量。

### Modified Capabilities
- `repo-layout`: 「自研 package 的运行体 peer 声明跟随 manifest 版本族」在阶段四被直接触发——`dshVersion` 升级到新版本族后,现有检查会对 8 个 local package 全部失败(实测该检查现为 3 用例通过)。需要明确:版本族迁移期间该检查的语义、`dshVersion` 与 peer 声明必须同批次变更的约束,以及 manifest 中临时 fork 条目回收后的 pin 形态要求。

## Impact

- **配置真相源**:`dsh.yaml`(pin、`enabled`、临时 fork 条目移除)、`patches/width-tiers-wiring.yml`(阶段二删除)
- **自研包**:`packages/` 下 8 个 package 的 `peerDependencies`;其中 7 个(`dsh-pet`、`worktree-session`、`system-clock`、`session-links`、`session-title-copy`、`sidebar-session-provider-icon`、`home-network-model-guard`)在阶段四需重新接线客户端半区
- **运行体**:`dshVersion` `0.1.1-rc.2` → `0.1.2-rc.1`;`@deepseek-ai/cordis` `4.0.1` → `4.0.2`(cordis 自身代码在两版间逐字节相同,仅依赖 bump;唯一实质修复针对 Node 24.0–24.11.1,本机 24.16.0 不受影响——故 cordis 是 host 升级的**结果**而非动因)
- **校验**:`tests/local-package-peers.test.mjs` 在阶段四前会全量失败,是该阶段的前置门槛而非缺陷
- **已知覆盖缺口(阶段四基线输入)**:`packages/worktree-session/src/index.ts` 的 `agent/session-start` 编排时序(同步跳过 guard + 异步落盘)无独立自动化覆盖,来自 `2026-09-04-release-binding-when-worktree-is-gone` 归档记录
- **开发方式**:阶段四在独立 Worktree Session(隔离 `DSH_HOME`)中进行,验收通过后再回主 checkout,避免升级过程影响日常 GUI
