## ADDED Requirements

### Requirement: Unarchived candidates are offered archive-then-clean instead of a bare refusal
仓库级 `ws clean` 遇到源 Session 未归档、但其余全部既有安全门均可通过的候选时，SHALL 通过一次性用户授权通道提出"归档并清理"的确认，而不是直接拒绝。确认信息 MUST 包含该候选的源 Session id、任务分支、worktree 路径，以及已判定的合入与洁净状态，使用户在确认前即可判断收尾是否安全。仅当用户明确确认时，系统 SHALL 先归档该源 Session，再对该候选执行既有清理；未确认时 MUST 保持既有 `not-archived` 拒绝语义，且不得归档、修改或删除任何资源。

#### Scenario: User confirms archive-then-clean for a finished candidate
- **WHEN** 候选的源 Session 未归档，但任务分支已证明合入、worktree 干净、operation 为 prepared 且无活跃占用，用户确认收尾
- **THEN** 系统 SHALL 先归档该源 Session，再执行既有清理，并在汇总中报告该候选已归档并清理

#### Scenario: User declines the archive-then-clean offer
- **WHEN** 系统就未归档候选发起确认，用户拒绝、取消，或无可用应答通道
- **THEN** 系统 SHALL 保持既有 `not-archived` 拒绝并报告原因，且 MUST NOT 归档该 Session 或删除任何 Git 资源

#### Scenario: Confirmation names the exact candidate facts
- **WHEN** 系统就某个未归档候选发起确认
- **THEN** 确认信息 SHALL 包含源 Session id、任务分支、worktree 路径与已判定的合入/洁净状态，且 MUST NOT 以概括表述替代具体候选标识

### Requirement: Archiving is never proposed to mask an unresolved safety gate
系统 SHALL 仅对"除未归档、以及该候选自身源 Session 仍处于加载状态之外，全部既有安全门均可通过"的候选提出归档确认。任务分支未证明合入、worktree dirty、operation 非 prepared、binding 损坏、schema 不受支持，或有活动 Session 的当前工作目录位于该 worktree 之内时，系统 MUST 先按既有原因拒绝该候选，MUST NOT 就其发起归档确认，也 MUST NOT 因归档而弱化上述任何安全门。

"候选自身源 Session 仍加载"之所以不阻塞提议：归档只将 Session 加入归档集，从不卸载它，因此该门在收尾流程中永远不会自行清除；若保持武装，任何 Session 都无法收尾自己的 worktree —— 那是死锁而非防护。该豁免 MUST 严格限定为"用户在本次调用中明确确认收尾的那一个源 Session"，MUST NOT 扩展到其他 Session，更 MUST NOT 豁免"有会话正站在该 worktree 内"这一判定。

#### Scenario: Unmerged or dirty candidate is refused without an offer
- **WHEN** 未归档候选的任务分支未证明合入，或其 worktree 存在未提交修改
- **THEN** 系统 SHALL 按既有原因拒绝该候选，且 MUST NOT 发起归档确认

#### Scenario: A Session may finish its own worktree while still loaded
- **WHEN** 未归档候选的唯一活跃占用是其自身源 Session 仍处于加载状态，且没有任何会话的当前工作目录位于该 worktree 之内
- **THEN** 系统 SHALL 发起归档确认；用户确认后 SHALL 先归档再清理该候选

#### Scenario: An occupant inside the worktree is never waived
- **WHEN** 有活动 DSH Session 的当前工作目录位于该 worktree 之内，或调用方当前执行根即该 worktree
- **THEN** 系统 SHALL 按既有原因拒绝，MUST NOT 发起归档确认，且该判定 MUST NOT 因用户确认收尾而被豁免

#### Scenario: Archiving does not bypass gates re-evaluated at clean time
- **WHEN** 用户确认并完成归档后，清理阶段重新校验时某个安全门不再通过
- **THEN** 系统 SHALL 按该安全门拒绝清理并报告原因，MUST NOT 因已归档而放行

### Requirement: Archive and clean failures are reported per candidate without false consistency
归档失败时，系统 SHALL 报告该候选的归档失败原因并保持其 Git 资源不变。归档成功但随后清理被拒绝或失败时，系统 SHALL 如实报告清理未完成，并 MUST NOT 把该候选汇报为已清理；已完成的归档 MUST NOT 被伪造回滚，用户可通过既有取消归档路径恢复。每个候选的确认、归档与清理相互独立，任一候选失败 MUST NOT 阻止其他候选被判定。

#### Scenario: Archive fails
- **WHEN** 用户确认后归档调用失败
- **THEN** 系统 SHALL 报告归档失败原因，保持该候选的 worktree、分支与 operation 不变，并继续判定其余候选

#### Scenario: Archived but clean refused
- **WHEN** 归档成功，但随后的清理被安全门拒绝
- **THEN** 系统 SHALL 报告该候选清理未完成及其原因，MUST NOT 汇报为已清理，且保留已归档状态供用户按既有路径处置

#### Scenario: One candidate's failure does not block others
- **WHEN** 同一次调用中一个候选的确认或归档失败，另有候选满足条件
- **THEN** 系统 SHALL 独立完成其余合格候选的判定与清理，并在同一汇总中分别报告

### Requirement: Operator CLI keeps its non-interactive refusal
显式路径 `dsh-ws` operator CLI 与 Skill shell wrapper MUST NOT 获得归档能力：它们没有可信的用户确认通道。这些入口遇到未归档候选时 SHALL 保持既有拒绝与诊断，由 operator 自行决定归档与否。

#### Scenario: Operator CLI encounters an unarchived candidate
- **WHEN** operator 通过 `dsh-ws clean` 处理源 Session 未归档的 operation
- **THEN** 系统 SHALL 按既有 `not-archived` 语义拒绝，MUST NOT 归档该 Session，也 MUST NOT 发起任何确认

## MODIFIED Requirements

### Requirement: Repository cleanup processes all and only archived safe candidates
仓库级 `ws clean` SHALL 枚举当前仓库尚未清理的 schema-v2 source-session operation，并逐项判定。候选 MUST 通过既有 active、dirty、in-flight、调用路径、binding 完整性与普通 Git merge ancestry 安全门，才可删除其 worktree 和本地 task branch 并保留 cleaned tombstone。源 Session 已归档的候选 SHALL 直接进入清理；源 Session 未归档但其余安全门均通过的候选 SHALL 经用户一次性确认后先归档再清理，未确认则保持 `not-archived` 拒绝。一次调用 SHALL 尝试处理全部合格候选；单个候选不合格、无法解析、确认被拒或归档失败时 MUST 保持该候选资源不变，并在汇总结果中报告原因，而不得阻止其他独立合格候选接受判定。

#### Scenario: Multiple archived candidates are safe
- **WHEN** 当前仓库存在多个已归档、无活动执行、worktree 干净、operation 已 prepared 且 task branch 已证明合并的 Worktree Session
- **THEN** 一次 `ws clean` SHALL 清理全部这些候选，并为每项保留 cleaned operation tombstone

#### Scenario: Safe Git state but source Session is not archived
- **WHEN** 候选通过 Git、phase、binding 与活跃状态安全门，但其源 Session 未归档
- **THEN** 系统 SHALL 就该候选发起归档确认；用户确认则先归档再清理，未确认则保留其 worktree、分支和 operation 并在汇总中报告未归档拒绝原因

#### Scenario: Mixed eligible and refused candidates
- **WHEN** 同一仓库同时包含合格候选，以及 dirty、活跃、in-flight、未合并、binding 损坏或 schema 不支持的候选
- **THEN** 系统 SHALL 只处理合格候选，保持所有拒绝候选不变，并分别汇总已清理项和带原因的拒绝项

#### Scenario: No operations are eligible
- **WHEN** 仓库不存在合格候选
- **THEN** 系统 SHALL 成功返回零清理汇总及各拒绝或忽略原因，而不得把“调用 Session 无 binding”作为错误

#### Scenario: Already cleaned history is encountered
- **WHEN** 扫描遇到 phase 已为 cleaned 或 binding 已 released 的审计记录
- **THEN** 系统 SHALL 将其作为已完成历史忽略，不重复删除资源或回退生命周期
