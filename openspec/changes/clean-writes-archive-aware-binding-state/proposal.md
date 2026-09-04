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
- 补一次性迁移：对已经处于 `state: 'cleaned'` + `archiveLifecycle: {version: 1}` 且当前未归档、但**能被证明**曾经历过归档的记录，恢复为 `released`。若无法证明曾归档，MUST 保持 `cleaned` 不变——"清理后从未归档"的会话按现有 spec 本就应停在 `cleaned`。
- 补测试覆盖真实顺序：确认 → 归档 → 清理 → 取消归档 → 会话恢复为普通会话且工具不再被拒。

不是 breaking change：状态取值集合、wire 格式、operation schema 版本与 CLI 行为均不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `source-workspace-worktree-session`: 收紧"清理保留源 Workspace 历史"这一 requirement，明确 tombstone 写入必须携带清理时刻的归档事实，使既有的取消归档释放路径对"归档并清理"编排同样可达；并补充一次性迁移在无法证明曾归档时保持保守。

## Impact

- `packages/worktree-session/src/host/maintenance.ts`：`wsClean` 的 tombstone 写入与 `wsCleanRepository` 的归档事实传递。
- `packages/worktree-session/src/host/operation.ts`：`reconcileSourceArchiveLifecycle` 的迁移边。
- `packages/worktree-session/test/`：新增覆盖 archive-then-clean → unarchive 的回归测试。
- 不涉及：`dsh-pet`、operation schema 版本、HTTP route 契约、CLI 参数、Git 资源处置逻辑与任何安全门。
- 受影响的既有卡死记录需由迁移或用户重新归档/取消归档修复；两者都不创建或删除任何 Git 资源。
