## Why

一个已完成 Worktree Session 在"确认 → 归档 → 清理"收尾后取消归档，本应恢复为普通会话，实际却仍被当作已清理的 Worktree Session，导致该会话的**全部**工具（含 `bash`）被无条件拒绝，会话事实上不可用。

真实证据（本仓库 `.git/ws/operations/`）：

| 源 Session | 归档时机 | `binding.state` | 结果 |
| --- | --- | --- | --- |
| `session-c2216d5d…` | 清理前已归档 | `cleaned-archived` | 取消归档可正常释放 |
| `session-886cd908…` | 清理中确认归档 | `cleaned` | **卡死，无法释放** |
| `session-9c664b0d…` | — | `released` | 已正确恢复为普通会话 |

当前 spec 的 `Unarchive a cleaned historical Session` 场景要求这一恢复自动发生。该行为由既有 change `restore-cleaned-session-as-ordinary` 建立且实现仍在，但被后来的 `archive-and-clean-finished-worktree` 所引入的"归档并清理"路径绕开——两者从未就状态写入达成一致。归档发生在 tombstone 写入之前，而清理随后把状态硬编码为 `cleaned`，覆盖了归档这一事实。

这不是部署陈旧：`~/.dsh` 中的构建产物与仓库源码逐字节一致。

## What Changes

- 清理写 tombstone 时，`binding.state` SHALL 反映该源 Session 在清理时刻的真实归档成员资格：已归档写 `cleaned-archived`，未归档写 `cleaned`。归档事实由受信 Host 提供，MUST NOT 由维护层自行推断。
- 归档成员资格的真相来源保持不变（仍是 Host 的归档集），因此 operator CLI 与 HTTP 入口的既有 `not-archived` 拒绝语义不受影响。
- 把"是否仍是 Worktree Session"的判定改为依据**托管 worktree 当前是否仍然存在且身份可被证明**，而不再依据归档历史：worktree 还在就保持既有约束，已不在就释放为普通 Session。判定复用既有的托管 worktree 身份校验（`recovery.ts` 的 `identityDiagnostic`），该校验今天对 cleaned 状态被直接短路跳过。
- **BREAKING（行为）**：这会改变既有场景 `Reopen a cleaned historical Session`。此前"已清理但从未归档"的会话永久停留在全工具拒绝状态，此后同样按 worktree 是否存在判定并被释放。这是有意的规范收敛：worktree 是否还在与该会话有没有归档过毫无关系，而旧行为让两个执行目录同样已删除的会话仅因归档历史不同而得到不同归属。存量卡死记录也因此在下次打开时自愈，不需要单独的一次性迁移。
- 补测试覆盖真实顺序：确认 → 归档 → 清理 → 取消归档 → 会话恢复为普通会话且工具不再被拒。

格式层面不是 breaking：状态取值集合、wire 格式、operation schema 版本与 CLI 行为均不变；唯一的破坏性在上述行为收敛，且它只放宽归属判定，不放宽任何清理安全门。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `source-workspace-worktree-session`: 改写"清理保留源 Workspace 历史"这一 requirement——归属判定改由托管 worktree 是否仍然存在决定，不再依赖归档历史；并新增一条 requirement 明确该判定必须复用既有身份校验、不得退化为仅判断路径存在。

## Impact

- `packages/worktree-session/src/host/recovery.ts`：`identityDiagnostic` 当前对 `cleaned`/`cleaned-archived` 直接返回 `undefined`（短路跳过校验），需使其对已清理绑定同样执行 worktree 身份校验。
- `packages/worktree-session/src/index.ts` 与 `host/policy.ts`：将"worktree 已不存在"的判定结果接到释放与 guard 安装决策上。
- `packages/worktree-session/src/host/maintenance.ts`：`wsClean` 的 tombstone 写入与 `wsCleanRepository` 的归档事实传递。
- `packages/worktree-session/test/`：新增覆盖 archive-then-clean → unarchive、以及"从未归档但 worktree 已删除"的回归测试。
- 不涉及：`dsh-pet`、operation schema 版本、HTTP route 契约、CLI 参数、Git 资源处置逻辑与任何清理安全门。
- 受影响的既有卡死记录需由迁移或用户重新归档/取消归档修复；两者都不创建或删除任何 Git 资源。
