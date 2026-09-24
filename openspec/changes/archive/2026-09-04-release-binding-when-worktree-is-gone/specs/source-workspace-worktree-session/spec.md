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

### Requirement: A binding whose managed worktree no longer exists is released
恢复一个已清理绑定时，系统 SHALL 依据**该托管 worktree 当前是否仍然存在且身份可被证明**来决定其归属：仍存在且身份校验通过时，保持既有 Worktree Session 约束；已不存在或身份无法被证明时，SHALL 释放该绑定并以源 Workspace 中的普通 Session 行为恢复该会话。

判定 SHALL 复用既有的托管 worktree 身份校验（目录存在、位于仓库的 worktree 分配根之内、当前分支等于任务分支、Git common dir 与 operation 元数据一致），MUST NOT 退化为只判断路径是否存在——一个被删除后又以同名重建的目录不构成同一个托管 worktree。

该判定 MUST NOT 依赖该 Session 是否曾经归档：worktree 是否还在与归档历史无关。以归档历史决定归属，会使两个执行目录同样已被删除的会话得到不同结果——其中一个永久停在全工具拒绝状态，而这与其执行目录的真实状态无关。

释放 MUST NOT 创建、修改或删除任何 branch、worktree、Workspace、Session、operation 或其他 Git/DSH 资源，MUST NOT 删除 cleaned tombstone，且 MUST 与既有 released 单调性一致。

#### Scenario: A cleaned binding whose worktree is gone becomes an ordinary Session
- **WHEN** 恢复一个已清理绑定，其托管 worktree 目录已不存在
- **THEN** 系统 SHALL 释放该绑定并以普通 Session 行为恢复该会话，且 MUST NOT 创建或删除任何 Git/DSH 资源

#### Scenario: Release does not depend on archive history
- **WHEN** 两个已清理绑定的托管 worktree 均已被删除，其中一个曾经历归档往返、另一个从未归档
- **THEN** 系统 SHALL 对二者作出相同判定并均释放为普通 Session

#### Scenario: A surviving managed worktree keeps its binding
- **WHEN** 恢复一个绑定，其托管 worktree 仍然存在且通过既有身份校验
- **THEN** 系统 SHALL 保持该 Worktree Session 绑定与其既有执行约束不变

#### Scenario: An unprovable worktree identity is not treated as surviving
- **WHEN** 目标路径存在，但其分支、Git common dir 或分配根不满足既有身份校验
- **THEN** 系统 SHALL 判定该托管 worktree 不复存在并释放该绑定，MUST NOT 把该路径当作托管执行目录

#### Scenario: Released monotonicity is preserved
- **WHEN** 归档生命周期协调遇到一个已经处于 released 的记录
- **THEN** 系统 SHALL 保持其 released 不变，MUST NOT 回退为任何更早的状态

## MODIFIED Requirements

### Requirement: Cleanup preserves source Workspace history
安全清理 SHALL 只移除已证明可丢弃的 worktree 运行资源和 task branch，并将持久绑定标记为 cleaned；标记时 SHALL 一并记录该源 Session 在清理时刻的归档成员资格，使归档生命周期的后续判定不丢失该事实。系统 MUST 保留原 Session、源 Workspace 归属及可审计的 cleaned operation 历史，且不得将 Session 移动到“未分组”。

当一个已清理绑定的托管 worktree 已不复存在时，系统 SHALL 自动释放该绑定并将会话恢复为普通 Session，无论其是否曾经归档；托管 worktree 仍然存在且身份可被证明时，SHALL 保持其既有 Worktree Session 约束。该转换 MUST 不创建新的 branch、worktree、Workspace、Session 或 operation，也 MUST 不启用非 blank Session 的 Worktree 启动能力。

#### Scenario: Clean an archived completed Session
- **WHEN** 绑定 Session 已归档、worktree 干净、无活动执行且 task branch 已被普通 Git ancestry 证明合并
- **THEN** 系统 SHALL 删除 worktree 和安全可删的本地 task branch、标记绑定已清理，并保留 Session 在源 Workspace 下的历史记录

#### Scenario: Reopen a cleaned historical Session whose worktree is gone
- **WHEN** 用户重新打开一个已完成安全清理、且其托管 worktree 已不存在的历史 Session（无论是否曾经归档）
- **THEN** 系统 SHALL 释放该绑定并以普通 Session 恢复该会话，且 MUST NOT 把旧 worktree 路径或源仓库主 checkout 当作该绑定的托管执行目录

#### Scenario: Unarchive a cleaned historical Session
- **WHEN** 一个 cleaned Session 已进入归档集，随后用户取消归档并重新打开该 Session
- **THEN** 系统 SHALL 自动释放当前 Worktree Session 绑定、移除其 cleaned 运行约束，并以源 Workspace 中的普通 Session 行为恢复该会话

#### Scenario: Unarchive after an archive-then-clean finish releases the Session
- **WHEN** 一个候选经"确认 → 归档 → 清理"收尾后，用户取消归档并重新打开该源 Session
- **THEN** 系统 SHALL 与"清理前已归档"路径一样自动释放该绑定并恢复为普通 Session，其工具策略 MUST NOT 继续按已清理绑定拒绝调用

#### Scenario: A never-archived cleaned Session is released all the same
- **WHEN** 一个已清理且从未进入过归档集的 Session 被重新打开，其托管 worktree 已不存在
- **THEN** 系统 SHALL 同样释放该绑定并恢复为普通 Session，MUST NOT 因其缺少归档往返而使其停留在全工具拒绝状态

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
