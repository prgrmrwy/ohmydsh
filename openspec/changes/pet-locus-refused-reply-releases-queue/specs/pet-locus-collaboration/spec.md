# Spec Delta

## ADDED Requirements

### Requirement: 回复被拒且本轮未续进的 Delivery 收尾为失败

当 current Delivery 的某个执行轮中，`pet_locus_finish` 因 current Delivery capability 授权而被拒绝，且该轮结束时满足以下全部条件，Host SHALL 将该 Delivery 原子收尾为 `failed`，失败原因 `reply-refused`，并推进队列：
- 该 Delivery 仍为 current，未进入任何终态；
- 同一轮内此后没有成功的 `pet_locus_finish`；
- 同一轮内没有成功的 `pet_locus_wait`。

Host MUST 独立证明被拒调用的精确活跃轮关联该 Delivery，MUST NOT 只凭 child 有 current 推断。收尾 MUST NOT 发送或重试业务正文、放宽授权；SHALL 复用失败控制反馈且反馈失败不阻断收尾。终结 SHALL 与 finish/超时原子竞争且至多一次，MUST NOT 消费后续 Delivery 或新代际。

#### Scenario: 回复被拒后本轮结束
- **WHEN** current Delivery A 的执行轮中 `pet_locus_finish` 以 `mixed-source` 被拒，child 随后结束该轮且未成功 finish 或 wait
- **THEN** A 在该轮结束时收尾为 `failed/reply-refused`，不发送正文，触发消息得到失败反馈，backlog 中的 B 立即成为 current

#### Scenario: 被拒后同轮改正
- **WHEN** 执行轮中 finish 先被拒，同一轮内随后一次 finish 成功
- **THEN** A 按成功回复终结，不再收尾为 `reply-refused`

#### Scenario: 无关联或迟到旧执行不消费新请求
- **WHEN** 纯 GUI 轮、旧 A 已到期后 B 晋升、或多个 Delivery 导致关联不唯一的执行尝试 finish 被拒
- **THEN** Host 只保留拒绝诊断，不得终结 B 或其它 current

#### Scenario: 被拒后声明继续等待
- **WHEN** 执行轮中 finish 被拒，同一轮内 `pet_locus_wait` 成功（先于或晚于拒绝均可）
- **THEN** 该轮结束时 A 保持 current，由期限或后续可证明续进决定其终态

#### Scenario: 未调用 finish 的普通结束不受影响
- **WHEN** current Delivery 的执行轮正常结束，且该轮未出现任何 finish 授权拒绝
- **THEN** A 仍为 current，后续 backlog 不投递，与既有"turn 结束不完成请求"一致

#### Scenario: 收尾与超时竞争
- **WHEN** A 的收尾与 deadline 过期同时发生
- **THEN** A 只终结一次；未获胜的一方不改变 A、不消费 B
