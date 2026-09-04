## Why

`ws clean` 目前对未归档的候选只能拒绝并返回诊断：`Source Session … is not archived; archive it before cleaning its Worktree Session`。它已经反查出了源 Session id（`maintenance.ts:201`），也已经判定了归档状态，但拒绝之后没有下一步——用户必须离开当前上下文，去 GUI 手动归档，再重新发起清理。

这使 Pet 的 `ws` 能力在最自然的场景下失去意义：一个 Worktree Session 工作已完成、已合入，用户在它里面点 Pet 的 `ws clean` 想做收尾退出，得到的却是一句"请先归档"。收尾退出本就是一个动作，不该被拆成"手动归档 + 重新清理"两步。

## What Changes

- `ws clean` 遇到未归档候选时，不再直接拒绝：汇总该候选的可判定事实（源 Session id、任务分支、是否已证明合入、worktree 是否干净、phase、活跃状态），通过既有一次性授权通道询问用户是否连同归档一起收尾。
- 用户确认后，系统先调用受信 Host 的 `workspaceRegistry.archiveSession(sourceSessionId)` 完成归档，再对该候选执行既有 `wsClean`；未获确认则保持当前拒绝语义，资源不变。
- 归档只在候选**其余全部安全门均可通过**时才提议：未合入、dirty、in-flight、schema 不支持、binding 损坏的候选一律先按既有原因拒绝，绝不通过归档掩盖真实阻塞。
- 归档失败、或归档后清理仍被安全门拒绝时，逐项报告并保留已归档状态（归档本身是幂等且可由用户取消归档回退的），不回滚为伪一致状态。
- 保持逐候选独立：一个候选的询问、归档或清理失败不影响其他候选的判定。
- `dsh-ws` operator CLI 不引入归档能力：它没有可信的用户询问通道，显式路径 operator 恢复语义保持不变。

## Capabilities

### New Capabilities

- （无）

### Modified Capabilities

- `source-workspace-worktree-session`: `ws clean` 对未归档候选从"直接拒绝"改为"交互确认后先归档再清理"，并明确归档提议的前置条件、失败处置与 operator CLI 的例外。

## Impact

- `packages/worktree-session/src/host/maintenance.ts`：`wsCleanRepository` 增加未归档候选的确认与归档编排接缝（归档动作由调用方注入，maintenance 层不直接依赖 DSH registry）。
- `packages/worktree-session/src/host/tool.ts`：从受信 Host 注入 `archiveSession` 与用户确认实现，复用 `authorize-explicit-ws-path` 建立的用户提问（`ctx.userQuestions`）通道。
- `packages/worktree-session/src/wire.ts`：按需补充"因未归档而提议归档"的汇总结果类型。
- `packages/worktree-session/test/`：覆盖确认后归档并清理、拒绝确认、归档失败、归档后仍被安全门拒绝、以及其余候选不受影响。
- `skills/ws/SKILL.md` 与架构文档：同步收尾退出的操作说明。
- 依赖前置 change `authorize-explicit-ws-path`（已实现，端到端待验）提供的一次性授权通道。
- 不改变 operation schema、HTTP route、`dsh-ws` CLI 行为、归档生命周期语义（cleaned → 取消归档 → released 普通会话恢复保持不变）、远端分支与共享缓存策略。
