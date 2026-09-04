## ADDED Requirements

### Requirement: The cleaned tombstone records the archive fact as of clean time
写入 cleaned tombstone 时，系统 SHALL 依据该源 Session 在**清理时刻**的真实归档成员资格确定绑定状态：已归档时写入等价于"已清理且在归档集内"的状态，未归档时写入"已清理"。该归档事实 MUST 由受信 Host 提供；维护层 MUST NOT 自行推断，也 MUST NOT 无条件假定未归档。

之所以必须在写入时刻确定：归档与清理是两个独立的持久写入。"先归档再清理"的收尾编排中，归档先于 tombstone 存在而发生，因此归档观察到的是一个尚未清理的 operation，对其无状态可推进；随后 tombstone 若把状态固定为"未归档已清理"，就把已经发生的归档事实覆盖掉了。清理是这两个事件中较晚的一个，它写入时归档成员资格已经确定，因此这里是唯一能同时看到两个事实的位置。

#### Scenario: A Session archived during the finish flow is cleaned as archived
- **WHEN** 收尾编排先归档源 Session，随后对该候选执行真实清理
- **THEN** tombstone SHALL 记录该绑定为已清理且在归档集内，使既有的取消归档释放路径对该记录可达

#### Scenario: A Session archived before cleanup keeps its existing outcome
- **WHEN** 源 Session 在清理发起前即已归档，随后被清理
- **THEN** tombstone SHALL 记录同一"已清理且在归档集内"的状态，与既有行为一致

#### Scenario: A never-archived Session is cleaned as unarchived
- **WHEN** 某个入口在源 Session 未归档时完成清理
- **THEN** tombstone SHALL 记录为"已清理"，且 MUST NOT 伪造任何归档事实

#### Scenario: The archive fact is never inferred by the maintenance layer
- **WHEN** 调用方未提供该源 Session 的归档事实
- **THEN** 系统 SHALL 保持既有"已清理"写入，MUST NOT 通过扫描归档集或其他旁路自行推断

### Requirement: A wedged cleaned binding is released only when prior archiving can be proven
系统 SHALL 修复历史上因清理覆盖归档事实而无法释放的绑定：对当前未归档、状态为"已清理"、且能被证明曾经进入过归档集的记录，SHALL 迁移为 released，使其源 Session 恢复为普通 Session。

无法证明曾经归档时，系统 MUST 保持该记录为"已清理"，MUST NOT 释放。"清理后从未归档"的会话按既有要求本就应停在已清理状态；若仅凭"当前未归档"就释放，会把这两类记录混为一谈，从而破坏既有的重新打开语义。

该迁移 MUST NOT 创建、修改或删除任何 branch、worktree、Workspace、Session 或 Git 资源，MUST NOT 删除 tombstone，且 MUST 与既有 released 单调性一致：已 released 的记录不得回退。

#### Scenario: A binding wedged by the archive-then-clean order is released
- **WHEN** 某记录状态为"已清理"、当前未归档，且存在可证明其曾进入归档集的依据
- **THEN** 系统 SHALL 将其迁移为 released，并让该 Session 以普通会话恢复，同时不创建或删除任何 Git/DSH 资源

#### Scenario: A cleaned-but-never-archived binding is left alone
- **WHEN** 某记录状态为"已清理"、当前未归档，且无法证明其曾进入归档集
- **THEN** 系统 SHALL 保持其"已清理"状态不变，MUST NOT 释放该绑定

#### Scenario: Migration preserves released monotonicity
- **WHEN** 迁移遇到一个已经处于 released 的记录
- **THEN** 系统 SHALL 保持其 released 不变，MUST NOT 回退为任何更早的状态

## MODIFIED Requirements

### Requirement: Cleanup preserves source Workspace history
安全清理 SHALL 只移除已证明可丢弃的 worktree 运行资源和 task branch，并将持久绑定标记为 cleaned；标记时 SHALL 一并记录该源 Session 在清理时刻的归档成员资格，使"归档后取消归档即恢复为普通 Session"这一转换对所有清理路径可达，而不仅对"清理前已归档"的路径可达。系统 MUST 保留原 Session、源 Workspace 归属及可审计的 cleaned operation 历史，且不得将 Session 移动到“未分组”。在 cleaned Session 完成一次归档后取消归档时，系统 SHALL 自动释放其当前 Worktree Session 绑定并将其恢复为普通 Session；该转换 MUST 不创建新的 branch、worktree、Workspace、Session 或 operation，也 MUST 不启用非 blank Session 的 Worktree 启动能力。

#### Scenario: Clean an archived completed Session
- **WHEN** 绑定 Session 已归档、worktree 干净、无活动执行且 task branch 已被普通 Git ancestry 证明合并
- **THEN** 系统 SHALL 删除 worktree 和安全可删的本地 task branch、标记绑定已清理，并保留 Session 在源 Workspace 下的历史记录

#### Scenario: Reopen a cleaned historical Session
- **WHEN** 用户重新打开一个已完成安全清理、但尚未发生归档后取消归档转换的历史 Session
- **THEN** 系统 SHALL 保持 cleaned 历史状态，表明旧执行目录已不存在，并拒绝把旧路径或源仓库主 checkout 当作该绑定的托管执行目录

#### Scenario: Unarchive a cleaned historical Session
- **WHEN** 一个 cleaned Session 已进入归档集，随后用户取消归档并重新打开该 Session
- **THEN** 系统 SHALL 自动释放当前 Worktree Session 绑定、移除其 cleaned 运行约束，并以源 Workspace 中的普通 Session 行为恢复该会话

#### Scenario: Unarchive after an archive-then-clean finish releases the Session
- **WHEN** 一个候选经"确认 → 归档 → 清理"收尾后，用户取消归档并重新打开该源 Session
- **THEN** 系统 SHALL 与"清理前已归档"路径一样自动释放该绑定并恢复为普通 Session，其工具策略 MUST NOT 继续按已清理绑定拒绝调用

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
