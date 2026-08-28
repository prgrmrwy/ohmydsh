## ADDED Requirements

### Requirement: Repository cleanup is initiated from an ordinary main-checkout Session
模型可见的 `ws clean` SHALL 从调用 Session 的仓库主 checkout 发起仓库级清理，而不是要求调用 Session 自身具有 Worktree Session binding。调用 Session MUST 是 cwd 精确对应仓库主 checkout、且没有当前 Worktree Session binding 的普通 Session。系统 SHALL 只扫描该仓库的 Worktree Session operation，不得接受模型指定任意路径、其他 Session 或其他仓库作为清理目标。`ws status` 与 `ws promote` MUST 继续按当前调用 Session binding 解析目标。

#### Scenario: Ordinary main Session starts repository cleanup
- **WHEN** 一个 cwd 精确对应仓库主 checkout、且没有 Worktree Session binding 的普通 Session 调用 `ws clean`
- **THEN** 系统 SHALL 扫描该仓库的 Worktree Session operation，而不得因调用 Session 没有 binding 报错

#### Scenario: Bound Worktree Session attempts cleanup
- **WHEN** 一个仍具有当前 Worktree Session binding 的 Session 调用 `ws clean`
- **THEN** 系统 SHALL 拒绝清理自身及其他任务，并明确提示用户切换到同仓库的普通主仓 Session 执行清理

#### Scenario: Unbound caller is not at the main checkout
- **WHEN** 一个无 binding Session 的 cwd 不能被证明精确对应仓库主 checkout
- **THEN** 系统 SHALL 拒绝整次清理，且不得扫描或删除任何 Worktree Session 资源

#### Scenario: Status and promote retain binding semantics
- **WHEN** 无 Worktree Session binding 的普通主仓 Session 调用 `ws status` 或 `ws promote`
- **THEN** 系统 SHALL 保持现有无绑定诊断，且不得把这两个动作改为仓库级扫描

### Requirement: Repository cleanup processes all and only archived safe candidates
仓库级 `ws clean` SHALL 枚举当前仓库尚未清理的 schema-v2 source-session operation，并逐项判定。候选的源 Session MUST 已归档，且 MUST 通过既有 active、dirty、in-flight、调用路径、binding 完整性与普通 Git merge ancestry 安全门，才可删除其 worktree 和本地 task branch并保留 cleaned tombstone。一次调用 SHALL 尝试清理全部合格候选；单个候选不合格或无法解析时 MUST 保持该候选资源不变，并在汇总结果中报告其拒绝原因，而不得阻止其他独立合格候选接受判定。

#### Scenario: Multiple archived candidates are safe
- **WHEN** 当前仓库存在多个已归档、无活动执行、worktree 干净、operation 已 prepared 且 task branch 已证明合并的 Worktree Session
- **THEN** 一次 `ws clean` SHALL 清理全部这些候选，并为每项保留 cleaned operation tombstone

#### Scenario: Safe Git state but source Session is not archived
- **WHEN** 候选通过 Git、phase、binding 与活跃状态安全门，但其源 Session 未归档
- **THEN** 系统 SHALL 保留该候选的 worktree、分支和 operation，并在汇总中报告未归档拒绝原因

#### Scenario: Mixed eligible and refused candidates
- **WHEN** 同一仓库同时包含合格候选，以及 dirty、活跃、in-flight、未合并、未归档、binding 损坏或 schema 不支持的候选
- **THEN** 系统 SHALL 只清理合格候选，保持所有拒绝候选不变，并分别汇总已清理项和带原因的拒绝项

#### Scenario: No operations are eligible
- **WHEN** 仓库不存在合格候选
- **THEN** 系统 SHALL 成功返回零清理汇总及各拒绝或忽略原因，而不得把“调用 Session 无 binding”作为错误

#### Scenario: Already cleaned history is encountered
- **WHEN** 扫描遇到 phase 已为 cleaned 或 binding 已 released 的审计记录
- **THEN** 系统 SHALL 将其作为已完成历史忽略，不重复删除资源或回退生命周期

### Requirement: Explicit-path operator maintenance remains compatible
本 change MUST 不改变显式路径 `dsh-ws status|promote|clean` operator CLI 的目标解析和既有安全门；仓库级批量扫描 SHALL 仅适用于模型可见、由受信 Host 调用上下文发起的 `ws clean`。

#### Scenario: Operator invokes explicit-path cleanup
- **WHEN** operator 使用 `dsh-ws clean [--dry-run] <worktree-path>`
- **THEN** 系统 SHALL 按既有单 operation 路径语义和安全门处理，不自动扫描仓库中的其他 Worktree Session
