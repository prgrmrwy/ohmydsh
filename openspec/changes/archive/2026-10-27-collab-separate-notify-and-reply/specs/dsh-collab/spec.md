## MODIFIED Requirements

### Requirement: 具名工具忠实适配内核

插件 SHALL 恰好提供 11 个常驻协作工具：`collab_status`、`collab_space`（`action: create|close|allow_manager|revoke_manager`）、`collab_invite`、`collab_member`（`action: join|decline|leave|mark_gone|transfer_leader`）、`collab_read`（`view: overview|since|convention`）、`collab_create_item`、`collab_revise_item`、`collab_ack_item`、`collab_send_message`、`collab_set_status`、`collab_advance_request`。`action`/`view` SHALL 为封闭枚举，每个取值静态对应一个具名内核方法；取值所需字段缺失或出现不属于该取值的字段时 MUST 以 `COLLAB_BAD_ARGUMENTS` 拒绝且不调用内核。写操作 SHALL 要求非空 cmdId，创建地址固定为实际调用会话，邀请只接受 agent。`collab_space` 的 `create` SHALL 接受可选 `purpose` 并原样传给内核；`allow_manager` 与 `revoke_manager` SHALL 要求 `channel` 并分别调用内核 `allowManager`、`revokeManager`，`channel` 原样传递，由内核校验。协作工具 MUST NOT 接受 `ext` 与 `mode`。`collab_send_message` SHALL 另提供可选布尔 notify，出现时原样透传且不在插件层补默认值；描述 SHALL 区分 notify 控制唤醒、needsReply 控制要求回复，并注明 notify 未填时沿用 needsReply。`collab_send_message` 与 `collab_create_item` SHALL 提供可选整数参数 `ref`，在出现时原样传给内核；`collab_send_message` 的描述 SHALL 说明"接续同一件事时 ref 填相关消息或条目的 seq，另起一件事不填"。`collab_create_item` 与 `collab_revise_item` 的 schema SHALL 仍接受可选的 `deciders`（不再必填），出现时原样传给内核：本变更之前的调用都带 `deciders`（含空数组），原样传递才能让同 cmdId 同参数的重试命中内核收据、返回原结果；对没有收据的新命令，内核以 `COLLAB_BAD_ITEM`（字段 `deciders`）拒绝。工具描述 MUST NOT 引导模型填写 `deciders`。插件 MUST NOT 自行校验、补全或删改 `ref`、`purpose` 与 `deciders`，非法值由内核拒绝（`COLLAB_BAD_REF`、`COLLAB_BAD_PURPOSE`），超出话题上限由内核以 `COLLAB_THREAD_LIMIT` 拒绝，均原样返回。`collab_create_item` 的工具描述 SHALL 说明 itemId 应使用小写字母、数字与连字符；插件 MUST NOT 在内核之前拒绝其它 itemId，以免挡住旧命令的收据重放。MUST NOT 暴露内核实例、任意事件写入、自由字符串命令分发、内部重置或人类确认工具；命令先交内核执行，内核的收据、CAS 与幂等语义 SHALL 原样保留，同一调用者以相同 cmdId 和参数重试已成功的命令 SHALL 返回原结果。读取不保存已读游标，不自动 ack/join。`collab_status` 的描述 SHALL 说明：写命令返回 `COLLAB_SPACE_UNAVAILABLE` 时结果未知，应稍后用原 cmdId 与相同参数重试；`collab_read` 的描述 SHALL 说明：空间 `lastSeq` 小于自己保存的游标时，应从 0 重读。

#### Scenario: 创建邀请加入与协商闭环
- **WHEN** A 创建空间、邀请 B，B 用 `collab_member` join，A 创建条目且 B 确认指定 revision
- **THEN** 两会话读取同一台账，actor、revision、ack 和状态由内核规则决定

#### Scenario: 相同命令结果未知后重试
- **GIVEN** A 以 cmdId `inv-1` 邀请 B 成功，随后 A 把 Leader 转交给 C
- **WHEN** A 以相同 cmdId 与参数重试邀请
- **THEN** 返回原结果 seq，不产生第二个业务事件或第二次唤醒

#### Scenario: 枚举取值与字段不匹配被拒绝
- **WHEN** 调用 `collab_member` 的 `action: transfer_leader` 但缺少 `member`，或 `action: join` 却携带 `member`
- **THEN** 返回 `COLLAB_BAD_ARGUMENTS`，内核未收到命令，日志字节不变

#### Scenario: 旧命令的重试不被插件挡住
- **GIVEN** 升级前 A 以 cmdId `c-1` 成功创建 itemId 为 `Old Item` 的条目
- **WHEN** 升级后 A 以相同 cmdId 与参数重试 `collab_create_item`
- **THEN** 返回原结果 seq，日志字节不变

#### Scenario: 工具描述携带重试与重读规则
- **WHEN** 从真实 agent 工具 schema 读取 `collab_status` 与 `collab_read` 的描述
- **THEN** `collab_status` 描述包含"原 cmdId"重试提示，`collab_read` 描述包含"从 0 重读"提示

#### Scenario: 内部与人类能力不出现在工具面
- **WHEN** 从真实 agent 工具 schema 枚举协作工具
- **THEN** 恰好 11 个上述名称；没有 decision、confirm、reset、事件追加、成员接纳或通用 execute 入口；`action`/`view` 的枚举值集合与上文完全相等

#### Scenario: ref 与 purpose 原样传给内核
- **GIVEN** A 在 seq 5 给 B 发了消息
- **WHEN** B 以 `ref:5` 调用 `collab_send_message`，再以 `ref:9999` 调用一次；A 以 `purpose:'接口协作'` 创建空间
- **THEN** 第一次内核收到的输入含 `ref:5` 且提交成功；第二次返回 `{error:{code:'COLLAB_BAD_REF'}}`，日志字节不变；空间总览 `purpose` 为 `接口协作`

#### Scenario: 升级前的创建重试仍命中收据
- **GIVEN** 升级前 A 以 cmdId `c-9`、`deciders:[]` 及其它参数成功调用 `collab_create_item`
- **WHEN** 升级后 A 经已注册的插件工具以完全相同的参数重试；再以 cmdId `c-9`、改动后的 `title` 调用；再以新 cmdId `c-10` 携带 `deciders:[]` 调用
- **THEN** 第一次返回原结果且日志字节不变；第二次返回 `COLLAB_CMD_CONFLICT`；第三次返回 `COLLAB_BAD_ITEM`（字段 `deciders`）且日志字节不变

#### Scenario: 不填 ref 时输入不含该键
- **WHEN** A 不带 `ref` 调用 `collab_send_message` 与 `collab_create_item`
- **THEN** 内核收到的输入对象没有 `ref` 键

#### Scenario: 授权与撤销托管 channel
- **GIVEN** `managedChannels: ['pet-locus']`，A 是空间 S 的 Leader，B 是 active 非 Leader 成员
- **WHEN** A 以 `collab_space` 的 `allow_manager`、`channel:'pet-locus'` 调用；B 以同样参数调用；A 以 `channel:'nope'` 调用；A 以 `revoke_manager`、`channel:'pet-locus'` 调用；A 以 `allow_manager` 但不带 `channel` 调用
- **THEN** 依次返回成功、`COLLAB_FORBIDDEN`、`COLLAB_BAD_CHANNEL`、成功、`COLLAB_BAD_ARGUMENTS`；成功的两个提交都不含 `dispatch/intended`

#### Scenario: 超出话题上限原样返回
- **GIVEN** 某话题已有 20 条唤醒消息
- **WHEN** 成员以该话题中一条消息为 `ref` 发 `needsReply:true` 的消息
- **THEN** 工具返回 `{error:{code:'COLLAB_THREAD_LIMIT'}}`，日志字节不变

#### Scenario: 显式通知原样透传且无需回复
- **WHEN** 调用 collab_send_message(notify:true, needsReply:false)
- **THEN** 内核收到两个独立字段，产生一次 wake；收件人 status 的 pending.replies 不增加

#### Scenario: 缺省通知字段保持缺省
- **WHEN** 未提供 notify 调用消息工具
- **THEN** 内核输入不含 notify 键，旧收据可命中；工具数组序列化长度仍不超过 4200

## ADDED Requirements

### Requirement: 戳投影识别独立通知来源

戳投影 SHALL 以有效通知意图（notify 缺省时兼容 needsReply）关联消息与其投递记录。仅通知的消息对应的 intended/completed 在可见戳内可读，在其它戳中 MUST 隐藏；pending.replies SHALL 只依赖 needsReply，不把通知当成待回复问题。

#### Scenario: 只通知的消息保留投递可见性边界
- **WHEN** 戳 a 向 main 发送 notify:true、needsReply:false 消息并产生投递
- **THEN** 戳 a 能读取对应 intended/completed，兄弟戳 b 不能；main 的待回复不增加
