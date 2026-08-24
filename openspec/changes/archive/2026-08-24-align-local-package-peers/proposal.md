## Why

运行体在 2026-08-24 升到 `0.1.1-rc.2` 后,仓库自研 package 的 peer 声明全部停留在上一个版本族:`dsh-worktree-session` 有 9 条 `^0.1.0-rc.7` 加两条**精确硬 pin**(`@deepseek-ai/dsh-storage-domain 0.1.0-rc.7`、`@deepseek-ai/dsh-workspace 0.1.0-rc.7`),`dsh-sidebar-session-provider-icon` 有 4 条 `^0.1.0-rc.7`,`dsh-subscriptions-sandbox-shim` 有 1 条 `^0.1.0-rc.5`。用仓库自带 semver 实测,这些范围在严格语义下**均不满足** `0.1.1-rc.2`(预发布版本只匹配同 tuple 且带预发布比较符的范围)。

当前尚无实际损害:实际安装树里 `dsh-storage-domain` / `dsh-workspace` / `dsh-llm` / `dsh-session` / `dsh-agent` 均为单一 `0.1.1-rc.2`,无重复副本,11 个 bundle 全部正常加载。但两条精确硬 pin 是真实隐患——在一次干净安装或换包管理器时,它们可能真的拉入第二份 `0.1.0-rc.7`,造成同一模块的双实例(服务注册、身份判定失效),而这类故障的症状与成因相距很远、极难定位。

成因是流程缺口:autoUpdate 的「联动同族版本」只覆盖 `dsh.yaml` 内的 pin(顶层 `dependencies` 与 `package` 条目的 `spec`/`version`),不涉及 `packages/*/package.json` 的 peer 声明,也没有任何检查会在漂移发生时报错。因此每次运行体升级都会静默扩大这道裂缝。

同时清理一处历史残留:`$DSH_HOME/profiles/web/package.json` 仍声明 `@deepseek-ai/dsh-subagent-codex@0.1.0-rc.6` 与 `@deepseek-ai/dsh-sdk-protocol@0.1.0-rc.6`(pnpm-lock 亦有引用),二者均未安装、不在 bundles 中、manifest 里也已于 `7bf394e` 移除。它们是账本孤儿缺陷(见 `2026-08-24-durable-sync-state-ledger`)的连带损伤:删除 manifest 条目时账本已丢失,sync 不知道自己管过它们,「删除条目即卸载」未能触发。

## What Changes

- 自研 package 的 runtime peer 声明对齐当前版本族,采用上游自身的写法(`^<当前运行体版本>`);消除两条精确硬 pin。
- 新增仓库检查:任一自研 package 的 `@deepseek-ai/*` peer 声明与 `dsh.yaml` 的 `dshVersion` 版本族不一致时,测试失败并指出具体条目。
- 清理 `$DSH_HOME` 部署副本中 `subagent-codex` / `sdk-protocol` 的残留声明,走 manifest 往返而非手改部署目录。
- 明确**不**扩展 autoUpdate 去自动改写自研 package 源码(理由见 design)。
- 非 **BREAKING**:声明层面的对齐,不改变任何运行时行为;当前实际解析结果已经是对齐后的版本。

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
- `repo-layout`: 新增一条要求,规定自研 package 对运行体包的 peer 声明必须跟随 manifest 所 pin 的版本族、不得使用精确 pin,且漂移必须可被仓库检查发现。

## Impact

- `packages/worktree-session/package.json`、`packages/sidebar-session-provider-icon/package.json`、`packages/subscriptions-sandbox-shim/package.json`:`peerDependencies` 中的 `@deepseek-ai/dsh-*` 条目。
- `tests/`:新增自研 package peer 对齐检查。
- `$DSH_HOME/profiles/web/package.json` 与其 `pnpm-lock.yaml`:移除两项残留声明(经 manifest 往返由 sync 完成)。
- 不涉及 `dsh.yaml` 契约、sync 物化语义或 autoUpdate 行为。
