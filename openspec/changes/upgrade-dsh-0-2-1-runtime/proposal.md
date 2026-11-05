## Why

`@deepseek-ai/dsh` 的 registry `latest` 已是 `0.2.1-rc.5`（2026-10-29），本仓仍钉在 `0.2.0-rc.2`。0.2.1 系列带来几项会影响本仓的变化：Automation 内置到 Web（旧实验 schedule bundle 不再发布）、子代理执行与完成通知统一（工具立即返回 child ID）、Agent Team 消息改为直投 Inbox、第三方插件兼容性优先按 `engines.dsh` 判断。

同时，本仓自研包的运行体声明一直是 `^<dshVersion>`，并由仓库测试强制等于当前 pin。四个已上架商店的自研包（auto-model-routing、magpie-connector、sidebar-session-provider-icon、session-id-copy）因此每次升运行体都要被迫改下界、重新发版，商店用户也被卡在同一个 rc。官方 0.2.1 的兼容检查已经明确为「`engines.dsh` 优先、预发布参与匹配」，可以改成一个显式、稳定的版本区间声明。

## What Changes

按 `staged-upgrade-execution` 分波推进：前置波次在现役 0.2.0-rc.2 上独立上线，运行体依赖项在隔离候选中验收后一次原子切换，商店发版排在切换验收之后。

- **W0 基线**：在 0.2.0-rc.2 上跑通并记录 `npm test`、各 package build/typecheck/test 与人工验收清单。
- **W1 前置（0.2.0-rc.2 上线）**
  - `@michengai/dsh-btw` 从 fork tarball（PR #16 构建）回收为 npm `1.3.2`：PR #16 已于 2026-10-24 合入上游，1.3.2 声明 `>=0.2.0-rc.1 <0.3.0-0`，新旧运行体都满足。
  - 复核 `dsh-width-tiers` 2.0.2（无 DSH peer 声明）是否作为可前置升级。
- **W2 运行体原子批（隔离候选）**
  - **BREAKING** `dshVersion` → `0.2.1-rc.5`。同批改 provider pin（skill-filesystem、mcp-client）、全部 local package 的 devDependencies 到 `^0.2.1-rc.5`。
  - **删除** `dsh-experimental-schedule-bundle` 条目（不是改版本）：该包没有 0.2.1 发布物，Automation 已内置，官方会清理旧选择并保留已有任务。
  - 按 0.2.1 语义适配子代理完成通知（child ID 立即返回）与 Agent Team 直投 Inbox：重点是 dsh-auto-model-routing、dsh-pet、dsh-memex（自检裁判子会话）。
  - 复核 0.2.1 其余破坏项对本仓的影响：invariant 导出移除、子路径插件不再读独立 `package.json`、agent-instructions 去掉 `dshHome` 行配置、工具展示 `both` 模式移除、API Key 读取优先级、connection 405 修复片段是否仍需保留。
  - better-sidebar 升到 0.28.2（peer `^0.2.1-rc.1`）。原判「0.26.1 peer 覆盖 0.2.1、不升级」被候选实测推翻：0.26.1 注入已删除的 `webRuntime`，在 0.2.1 上静默挂起（证据见 `checking/candidate.md`）。0.30.0 只支持 0.2.2，不在本批。
- **W3 运行体兼容声明（随 W2 同批）**
  - **BREAKING（仓库约束）** local package 的运行体兼容声明从「`^<dshVersion>`」改为显式区间：`engines.dsh` 与全部 `@deepseek-ai/dsh-*` peer 使用同一个 `>=<已验证下界> <0.3.0-0` 范围；devDependencies 继续跟 `^<dshVersion>`，保证按 pin 构建。
  - 同步改写 `tests/local-package-peers.test.mjs` 对应的仓库检查。
- **W4 商店包发版（切换验收后）**
  - 对四个商店包逐个判断：代码在 0.2.1 上是否需要改、是否仍能在 0.2.0-rc.2 上工作，据此定下界；需要发版的升 patch/minor 版本，经现有 mirror-release 流程发布 npm 与 GitHub Release，再更新商店条目的固定 tarball。
  - 只改了兼容声明、代码没改的包也发版，让商店索引显示新的 `engines.dsh`。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `repo-layout`：「自研 package 的运行体 peer 声明跟随 manifest 版本族」改为「运行体兼容声明为显式区间」：`engines.dsh` 与 peer 同值、上界必须是下一 minor 的 `-0`、`dshVersion` 必须落在区间内、devDependencies 跟 pin。
- `staged-upgrade-execution`：运行体切换后，已上架商店的自研包必须逐个完成兼容复核；声明的下界必须有实测证据，发版排在运行体切换验收之后。

## Impact

- **真相源**：`dsh.yaml`（dshVersion、provider pin、schedule bundle、btw、better-sidebar、新增 `locus-child` preset）、私有 overlay 中如有相关条目一并核对。
- **local package（15 个有运行体依赖）**：`package.json` 的 engines/peer/devDependencies；代码改动预计集中在 dsh-auto-model-routing、dsh-pet、dsh-memex。
- **仓库测试**：`tests/local-package-peers.test.mjs`；写死 `0.2.0-rc.2` 的脚本与测试。
- **商店**：四个镜像仓（prgrmrwy/dsh-auto-model-routing、dsh-magpie-connector、dsh-sidebar-session-provider-icon、dsh-session-id-copy）的版本与商店固定 tarball。
- **持久数据**：Session、Pet SQLite、Automation 任务（由官方从会话本地投影接管）；切换前完整备份。
- **非目标**：
  - 不升 0.2.2（`next` = 0.2.2-rc.1，需要 Node>=24.9、better-sidebar 0.30.0 及 session projection/tools/PTC 迁移），另开 change。目标冻结在 `0.2.1-rc.5`，中途出新 rc 时停下重新评估。
  - 不启用 0.2.1 新增的实验插件（Claude Code Mods 兼容层、开发者工具组合包等）。
  - 不处理 dsh-cockpit-bridge（独立仓库）的发版，只在候选中验收其激活。
