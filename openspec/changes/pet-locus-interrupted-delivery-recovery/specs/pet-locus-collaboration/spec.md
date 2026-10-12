## ADDED Requirements

### Requirement: 启动恢复结算被中断的投递并不阻塞后续消息

Host 重启可能恰好发生在某条 Delivery 已被 child 认领并开始执行 turn 之后。此时该 turn 已随进程消失，
**永远不会有任何执行者结算这条 Delivery**；而它占据该 locus 的 current 位置，会让同入口后续所有消息
只能停留在 backlog。系统 SHALL 在启动恢复时依据持久证据识别这种投递并立即结算，MUST NOT 让后续消息
等待原投递的完整租约。

判定 SHALL 只用**可证明**的证据：该 Delivery 已绑定 `executionId` 与 `inboxMessageId`，且 child 会话
日志中进入过该 inbox 消息的那个 turn 已经结束（存在 `turn/end`）、其结束原因为 `interrupted`。证据
不足或存在歧义时 SHALL fail closed，保持既有等待语义。

结算 SHALL 是终态且**不重发正文**：内容既已进入 child inbox（持久绑定已提交），按既有"送达即送达"的
策略计为已送达；结算表示"承认不会有回复"，MUST NOT 被实现为重试或重发。结算 SHALL 带上可诊断的原因。

被提升（backlog → current）的 Delivery SHALL 获得不小于最小执行租约的执行窗口，且不超过其 24 小时
硬上限，避免出现"被提升即到期"的循环。

#### Scenario: 重启打断进行中的 turn
- **WHEN** 一条 current Delivery 的绑定 turn 在 child 会话日志中被证明以 `interrupted` 结束
- **THEN** 启动恢复以终态结算该 Delivery（非重发、非重试），并让同入口的 backlog 立即可被派发

#### Scenario: 结算后不再占用 current 位置
- **WHEN** 上述被中断的 Delivery 被结算，而同一 locus 已有 backlog 投递
- **THEN** 该 locus 处于"有 backlog、无 current"，后续投递 SHALL 在启动排空时被提升并派发，MUST NOT 继续等待原投递的租约

#### Scenario: 结算原因是可诊断的
- **WHEN** 查看被中断结算的 Delivery 记录
- **THEN** 其终态带有明确说明"turn 被中断、未重发正文"的原因与启动处置标记，而不是笼统的 deadline 过期

#### Scenario: 证据不足时不结算
- **WHEN** 无法证明中断（该 turn 仍处于打开状态、`turn/end` 原因不是 `interrupted`、inbox 绑定与记录不匹配、或会话日志不可读）
- **THEN** 保持既有等待语义：不提前结算、不重派、不做任何推断

#### Scenario: 被提升的投递获得最小执行租约
- **WHEN** 一条 backlog Delivery 在其自身软租约临近或已经过去时被提升为 current
- **THEN** 它的执行租约至少延长到"提升时刻 + 最小执行租约"，且不超过 24 小时硬上限

#### Scenario: 不重发正文
- **WHEN** 被中断结算的 Delivery 内容此前已进入 child inbox
- **THEN** 系统 MUST NOT 把该消息正文再次投递给 child 或用户；仅结算该条 Delivery
