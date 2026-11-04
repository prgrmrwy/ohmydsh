## Why

`locus-three-tier-structure` 退役了 Pet 的四个 Locus 源码补丁，长期 Host 兼容运行体只剩 `team-membership.patch`（agent-team roster 在子会话 descriptor 写入前把 subagent 误判为 Lead 的窗口）。2026-11-04 核对官方 `0.2.0-rc.2`、`0.2.1-rc.5`（latest）与 `0.2.2-rc.1`（next）的 `@deepseek-ai/dsh-experimental-agent-team`，`TeamRoster.tryMembership` 与 `subagentDescriptor` 均未改变，官方尚未修复。所有者明确接受去掉该补丁的风险，以便近期升级 DSH 时不再为一处 21 行补丁维护整套源码构建、依赖图发布与版本围栏。

## What Changes

- **BREAKING** 删除 `packages/dsh-pet/compat/`（team-membership 补丁、源码 builder、launcher 依赖图发布、锁、脚本策略、verifier）与只服务于它的测试。
- **BREAKING** 删除 `dsh.yaml` 中 dsh-pet 的 `hostRuntimeCompatibility` 声明，以及 `scripts/lib/dsh-host-runtime.mjs` 和 sync/launcher/`dsh-server-bin` 中的兼容运行体分支；长期 `dsh web` Host 与一次性 CLI 一样使用 manifest 的官方精确 `dshVersion`。`DSH_BIN` 显式覆盖保持不变。
- manifest（公开或 overlay）再声明 `hostRuntimeCompatibility` 时在加载阶段 fail closed 并说明该机制已退役，不静默忽略。
- 所有者接受的残余风险：官方 roster 窗口内普通 subagent 可能短暂被视为 Team Lead（可执行 Lead 专属 Team 工具、在其上运行 provisioning 对账）。Pet locus 子会话另有执行期守卫拒绝 Team 工具。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `dsh-runtime-provisioning`: 移除 Host compatibility runtime 的两条要求，改为长期 Host 只用官方精确运行体。
- `repo-layout`: overlay 同构字段与校验不再包含 `hostRuntimeCompatibility`，该字段改为退役拒绝。
- `pet-compat-minimization`: 记录当前不保留任何 compat seam；重新引入须按既有举证标准另立变更。

## Impact

- 代码：`packages/dsh-pet/compat/`、`scripts/lib/dsh-host-runtime.mjs`、`scripts/sync.mjs`、`scripts/dsh-server-bin.mjs`、`scripts/launcher/*`、`scripts/test.mjs`、相关仓库测试与 `packages/dsh-pet` 构建脚本引用。
- 部署：下次受控重启后 Host 运行体由 `customization-host-runtime (dsh-pet)` 变为官方运行体；Pet 源码不依赖该运行体。
- 依赖：不新增依赖，不改 Pet 状态格式。
