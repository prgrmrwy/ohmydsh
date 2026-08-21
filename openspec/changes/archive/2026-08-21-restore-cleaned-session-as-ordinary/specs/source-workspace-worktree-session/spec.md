## MODIFIED Requirements

### Requirement: Cleanup preserves source Workspace history
安全清理 SHALL 只移除已证明可丢弃的 worktree 运行资源和 task branch，并将持久绑定标记为 cleaned。系统 MUST 保留原 Session、源 Workspace 归属及可审计的 cleaned operation 历史，且不得将 Session 移动到“未分组”。在 cleaned Session 完成一次归档后取消归档时，系统 SHALL 自动释放其当前 Worktree Session 绑定并将其恢复为普通 Session；该转换 MUST 不创建新的 branch、worktree、Workspace、Session 或 operation，也 MUST 不启用非 blank Session 的 Worktree 启动能力。

#### Scenario: Clean an archived completed Session
- **WHEN** 绑定 Session 已归档、worktree 干净、无活动执行且 task branch 已被普通 Git ancestry 证明合并
- **THEN** 系统 SHALL 删除 worktree 和安全可删的本地 task branch、标记绑定已清理，并保留 Session 在源 Workspace 下的历史记录

#### Scenario: Reopen a cleaned historical Session
- **WHEN** 用户重新打开一个已完成安全清理、但尚未发生归档后取消归档转换的历史 Session
- **THEN** 系统 SHALL 保持 cleaned 历史状态，表明旧执行目录已不存在，并拒绝把旧路径或源仓库主 checkout 当作该绑定的托管执行目录

#### Scenario: Unarchive a cleaned historical Session
- **WHEN** 一个 cleaned Session 已进入归档集，随后用户取消归档并重新打开该 Session
- **THEN** 系统 SHALL 自动释放当前 Worktree Session 绑定、移除其 cleaned 运行约束，并以源 Workspace 中的普通 Session 行为恢复该会话

#### Scenario: Unarchive creates no replacement worktree resources
- **WHEN** cleaned Session 因取消归档恢复为普通 Session
- **THEN** 系统 MUST 不创建 task branch、worktree、Workspace、Session 或 operation，且 MUST 不触发或提供非 blank `ws start`

#### Scenario: Released history remains auditable but is not current
- **WHEN** cleaned Session 已因取消归档释放为普通 Session
- **THEN** 系统 SHALL 保留其 cleaned operation 历史用于审计，但 Session 状态、输入区 UI、运行上下文、工具策略和当前绑定查询 MUST 不再把该 operation 视为当前 Worktree Session 绑定

#### Scenario: Re-archive an already released ordinary Session
- **WHEN** 用户再次归档或取消归档一个已经释放为普通状态的 Session
- **THEN** released 状态 SHALL 保持单调不回退，系统 MUST 不重新恢复旧的 cleaned 绑定

#### Scenario: Upgrade an already-unarchived legacy cleaned Session
- **WHEN** 升级前创建的 schema-v2 cleaned tombstone 仍关联一个当前未归档的源 Session，且缺少本变更新增的归档生命周期标记
- **THEN** 系统 SHALL 将该历史关系迁移为 released，并让 Session 以普通会话恢复，同时不删除 tombstone 或创建任何 Git/DSH 资源

#### Scenario: Cleanup safety cannot be proven
- **WHEN** worktree 当前活跃、dirty、operation in-flight、调用者位于目标 worktree 或合并证明不足
- **THEN** 系统 SHALL 拒绝清理且不得强制删除 Session、worktree 或 branch