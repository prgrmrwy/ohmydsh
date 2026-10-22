## ADDED Requirements

### Requirement: 消息与条目可引用先前记录

`sendMessage` 与 `createItem` SHALL 接受可选参数 `ref`。`ref` 是本空间内一条先前记录的 seq，被引用者只能是：一条 `message/sent` 所在提交的 seq（即该消息的 `id`），或一个条目的创建 seq（其 `item/created` 所在提交的 seq）。未提供 `ref`（键不存在）时命令行为与本变更之前完全相同。提供时 MUST 为正的安全整数，且 MUST 指向上述两类记录之一，否则以 `COLLAB_BAD_REF` 拒绝；`ref` 不做隐式类型转换（`"5"`、`null`、`1.5` 均被拒绝）。被引用者必须已存在，因此 `ref` 必然小于新记录的 seq，引用关系不会成环。

`ref` 校验 SHALL 位于该命令既有业务校验（`COLLAB_BAD_RECIPIENT`、`COLLAB_BAD_MESSAGE`、`COLLAB_BAD_ITEM`）之后、话题上限检查之前；任一校验失败都不写提交、不写收据、不记账投递。

`ref` SHALL 原样持久化：`message/sent` 的 `message.ref`、`item/created` 的 `item.ref`；没有 `ref` 时该字段 MUST 不出现。条目后续事件携带的条目快照 SHALL 保留创建时的 `ref`，`reviseItem` 不能修改它。条目的创建 seq 由重放推导，不新增事件字段；状态与总览 SHALL 提供 `itemSeq: {itemId: 创建 seq}`，以自有属性写入（itemId 为 `__proto__` 时仍可查到）。重放时若持久化的 `ref` 指向不存在或不可引用的记录，加载 MUST 失败（fail closed），该空间不可读写，同一存储中的其它空间不受影响。

#### Scenario: 引用先前消息
- **GIVEN** `aily` 在 seq 5 发给 `doubao` 一条消息
- **WHEN** `doubao` 以 `ref:5` 发消息给 `aily`
- **THEN** 提交成功，`message/sent` 的 `message.ref` 为 5

#### Scenario: 引用条目的创建 seq
- **GIVEN** 条目 `R1` 在 seq 7 创建
- **WHEN** `aily` 以 `ref:7` 发消息给 `doubao`，并以 `ref:7` 创建条目 `R2`
- **THEN** 两次都成功；`R2` 的 `item.ref` 为 7；总览 `itemSeq.R1` 为 7

#### Scenario: 不写 ref 时事件形状不变
- **WHEN** `aily` 不带 `ref` 发送消息并创建条目
- **THEN** `message/sent.message` 与 `item/created.item` 都没有 `ref` 键

#### Scenario: 特殊 itemId 的创建 seq 可查
- **GIVEN** 条目 `__proto__` 在 seq 4 创建
- **WHEN** 读取总览
- **THEN** `Object.hasOwn(itemSeq, '__proto__')` 为真且值为 4

#### Scenario: 消息引用不存在或不可引用的 seq
- **GIVEN** 空间 lastSeq 为 9；seq 3 是 `member/statusText` 提交；seq 4 是 `dispatch/completed` 提交
- **WHEN** `aily` 分别以 `ref:3`、`ref:4`、`ref:9999`、`ref:0`、`ref:-1`、`ref:1.5`、`ref:"5"`、`ref:null` 发消息给 `doubao`
- **THEN** 每次都返回 `COLLAB_BAD_REF`，日志长度不变，无 `dispatch/intended`，`aily` 名下无该 cmdId 的收据

#### Scenario: 条目引用非法 seq
- **WHEN** `aily` 以 `ref:9999` 创建条目 `R9`
- **THEN** 返回 `COLLAB_BAD_REF`，`R9` 不存在，日志长度不变

#### Scenario: 多重错误时先报既有校验
- **WHEN** `aily` 以非 active 收件人 `bob` 与 `ref:9999` 发消息
- **THEN** 返回 `COLLAB_BAD_RECIPIENT`

#### Scenario: 悬空引用的日志加载失败
- **GIVEN** 存储中空间 `s1` 的日志被手工改写，使一条 `message/sent` 的 `message.ref` 指向不存在的 seq；空间 `s2` 正常
- **WHEN** 新实例分别打开 `s1` 与 `s2`
- **THEN** `s1` 打开失败且不可读写；`s2` 正常打开

### Requirement: 按话题限制往返

每条消息与每个条目 SHALL 有话题根（topic），由重放从 `ref` 推导，不读取正文：没有 `ref` 的消息或条目，其话题根为自身 seq（消息为其 `id`，条目为其创建 seq）；有 `ref` 的，其话题根为被引用记录的话题根。本变更之前写入的记录没有 `ref`，各自为根。状态与总览 SHALL 提供 `topicOf: {seq: 话题根}`（键为消息 seq 与条目创建 seq）与 `topicWakes: {话题根: 计数}`。

一个话题的计数 SHALL 等于该话题内实际记账了 `wake` 类 `dispatch/intended` 的 `needsReply` 消息条数，由日志重放得出。发送一条 `needsReply:true`、且按唤醒规则会为收件人记账唤醒的消息时，若其话题的计数已达到常量 `TOPIC_LIMIT`（= 20），命令 MUST 以 `COLLAB_THREAD_LIMIT` 拒绝，不写提交、不写收据、不记账投递。`needsReply:false` 的消息、因收件人不可达或绑定不支持唤醒而不记账唤醒的消息 MUST NOT 被拒绝，也不计数，但仍获得话题根并可被引用。邀请与 request 的结束通知 MUST NOT 计入任何话题的计数，也 MUST NOT 被话题上限拒绝；结束通知的 `dispatch/intended` SHALL 在 `delivery.thread` 中记录该 request 的话题根，计数消息的 `dispatch/intended` 记录该消息的话题根，邀请 MUST 不含 `delivery.thread`。

话题上限检查 SHALL 在同一协作空间的串行事务中、以与重放相同的推导完成，并发命令不能越过上限。不提供重置话题计数的入口。

#### Scenario: 同一话题第 21 条唤醒消息被拒绝
- **GIVEN** `aily` 与 `doubao` 均 presence 可达；`aily` 在 seq 5 发出需回复消息给 `doubao`
- **WHEN** 此后两人轮流发 `needsReply:true` 的消息，每条都以 `ref` 指向本话题中任意一条先前消息（包括总是指向 seq 5）
- **THEN** 包括 seq 5 在内的前 20 条都成功，各自唤醒的 `delivery.thread` 为 5；第 21 条返回 `COLLAB_THREAD_LIMIT`，日志长度不变；总览 `topicWakes[5]` 为 20

#### Scenario: 不写 ref 的新消息开启新话题
- **GIVEN** 承上，话题 5 已达上限
- **WHEN** `aily` 不带 `ref` 发送需回复消息给 `doubao`
- **THEN** 成功，唤醒的 `delivery.thread` 为该消息自身的 seq，其话题计数为 1

#### Scenario: 引用条目的消息归属条目话题
- **GIVEN** 条目 `C1` 在 seq 7 创建（无 `ref`）
- **WHEN** `aily` 以 `ref:7` 发需回复消息给 `doubao`，`doubao` 再以 `ref` 指向该消息回复
- **THEN** 两条消息的话题根都是 7，`topicWakes[7]` 为 2

#### Scenario: 不唤醒的消息不受限也不计数
- **GIVEN** 话题 5 已达上限，话题中最后一条消息 seq 为 m
- **WHEN** `doubao` 以 `ref:m`、`needsReply:false` 回复
- **THEN** 成功，无 `dispatch/intended`；该消息话题根为 5，`topicWakes[5]` 仍为 20

#### Scenario: 不可达收件人的消息不计数
- **GIVEN** `doubao` 的 presence 采样为 `unreachable`
- **WHEN** `aily` 发需回复消息给 `doubao`
- **THEN** 成功、不记账唤醒，该消息所在话题的计数不变

#### Scenario: 结束通知不受话题上限限制
- **GIVEN** 作者 `aily` 以 `ref:5` 创建 request `R1`、承接方 `doubao`，话题 5 已达上限
- **WHEN** `doubao` 推进 `R1` 为 `accepted` 再到 `done`
- **THEN** 两次都成功；推进为 `done` 的提交含一条对 `aily`、`delivery.thread` 为 5 的 `wake` 类 `dispatch/intended`；`topicWakes[5]` 仍为 20

#### Scenario: 并发提交不越过上限
- **GIVEN** 话题 5 的计数为 19
- **WHEN** 测试控制入队顺序，依次入队两条都以 `ref:5` 发给可达收件人的需回复消息
- **THEN** 先入队的成功，`topicWakes[5]` 为 20；后入队的返回 `COLLAB_THREAD_LIMIT` 且未写入提交

#### Scenario: 命令时判定与重新加载一致
- **GIVEN** 一个空间依次发生：话题推进到上限、第 21 条被拒、引用条目的消息、不可达收件人的消息、request 结束通知
- **WHEN** 记录此时总览的 `topicOf`、`topicWakes` 与 `itemSeq`，关闭空间后用新实例重新打开并读取总览
- **THEN** 两次的三个映射深度相等；被拒的那条在日志中不存在

#### Scenario: 旧的成员级熔断不再阻断
- **GIVEN** 本变更之前的日志中 `doubao` 已有 6 条 `wake` 记账、无 `breaker/reset`
- **WHEN** 新内核加载该日志后 `aily` 不带 `ref` 发需回复消息给 `doubao`
- **THEN** 该提交含对 `doubao` 的 `wake` 类 `dispatch/intended`；总览 `presence.doubao` 不为 `paused`

### Requirement: 旧日志中已移除的事件按只读历史重放

本变更之前写入的 `breaker/reset`、`decision/requested`、`decision/superseded`、`decision/decided`、`confirm` 类 `dispatch/intended` 及其 `dispatch/completed`，以及 `escalated` 或 `decided` 状态的条目，SHALL 能被新内核加载并重放，不改变它们已记录的内容；新内核 MUST NOT 再写入这些事件。重放得到的决策记录 SHALL 只用于历史展示（投影的"历史条目"小节），不参与任何授权、唤醒或计数。加载这样的日志 MUST NOT 需要任何迁移或格式版本切换。

#### Scenario: 含决策与熔断事件的旧日志可加载
- **GIVEN** 本变更之前的日志含 `breaker/reset{member}`、一组 `decision/requested` 与 `decision/decided`、一条 `confirm` 投递及其完成、一个 `escalated` 条目
- **WHEN** 新内核打开该空间
- **THEN** 打开成功；`decided` 与 `escalated` 条目保持原状态与 revision；投影的"历史条目"小节列出这两个条目；随后成员发送需回复消息成功

#### Scenario: 新内核不写已移除事件
- **GIVEN** 新内核上的空间经历条目修改、ack、request 全流程、Leader 转交与成员离开
- **WHEN** 读取全部提交
- **THEN** 不含 `breaker/reset`、`decision/*` 事件或 `confirm` 类 `dispatch/intended`

## REMOVED Requirements

### Requirement: agent 往返超限自动升级为待人决定
**Reason**: 条目修改不再唤醒任何成员，来回修改不会形成唤醒循环；升级后的 `escalated` 只能由人类决定解除，而人类决定通道一并移除，留着会产生无法离开的死状态。
**Migration**: 新内核不再写入 `escalated` 或维护 `agentEditCount`；旧日志中的 `escalated` 条目按"旧日志中已移除的事件按只读历史重放"保持只读。争执由话题上限与各自向自己的用户求助解决。

### Requirement: 人类决定只能由带证据的确认产生
**Reason**: dsh-collab 没有人类确认通道，决策请求一直停在 `awaitingChannel`，从未可用。按跨边界协作标准，人类不作为台账成员：每个 root 在自己的会话里问自己的用户，再把结论写回台账。
**Migration**: 移除 `requestDecision`、`confirmDecision`、`confirm` 投递、`requestConfirmation`、`deciders`、`awaitingChannel` 与条目状态 `decided`。旧日志中的决策记录按只读历史重放。以后接入真实的人类通道（例如跨机或飞书人类成员）时按新模型重新设计。

### Requirement: 按成员计数的熔断
**Reason**: 成员级计数把一个成员在空间内所有工作的唤醒累加到同一个永不衰减的计数，正常推进多件事即触顶并静默丢弃唤醒，纯 agent 空间无人能重置，空间实际失效。
**Migration**: 由"按话题限制往返"取代。`resetBreaker`、internal purpose `breaker-reset`、成员 `paused` 状态与 `BREAKER_LIMIT` 一并移除；旧日志中的 `breaker/reset` 与成员 `wakeCount` 照常重放但不再参与判断，已暂停的成员在新内核加载后自然恢复。

## MODIFIED Requirements

### Requirement: 封闭的命令集合与授权

`CollabService` 的公开写命令 SHALL 恰为下表所列，并以具名方法暴露，MUST NOT 提供按字符串分发命令的入口。principal SHALL 只能是：

- `agent{channel, address}`：宿主担保的调用方 session；
- `provider{providerId, on:{channel, address}}`：已注册 provider 代表其注册 channel 上的一个地址，`on.channel` 不等于注册 channel MUST 以 `COLLAB_FORBIDDEN` 拒绝；
- `internal{purpose}`：宿主自身，`purpose` 只能是 `host-index`；其它值（包括已移除的 `breaker-reset`）在 principal 稳定校验中 MUST 以 `COLLAB_FORBIDDEN` 拒绝。`host-index` 只用于宿主读取，MUST NOT 执行任何写命令（包括 `createSpace`）。

actor SHALL 由内核从 principal 反查得到，任何命令 MUST NOT 接受调用方指定 actor。

| 命令 | 允许的 principal | 前置条件（"成员"＝反查到的 active 成员） |
|---|---|---|
| `createSpace` | agent、provider | 调用方地址不需要已是成员 |
| `invite` | agent、provider | 成员且为 Leader |
| `join`、`declineInvite` | agent、provider | 反查到的成员状态为 `invited`，且就是被操作的成员本人 |
| `leave` | agent、provider | 成员本人 |
| `markGone` | agent、provider | 成员且为 Leader，目标为其他 active 成员 |
| `transferLeader` | agent、provider | 成员且为 Leader，目标为其他 active 成员 |
| `closeSpace` | agent、provider | 成员且为 Leader |
| `createItem`、`reviseItem`、`ackItem`、`sendMessage`、`setStatus` | agent、provider | 成员（另受条目状态转换表约束） |
| `advanceRequest` | agent、provider | 成员且为该 request 的承接方 |

读取 `overview`、`readSince`、`project`、`readConvention` SHALL 允许成员（任意状态为 `active` 的成员）与 `internal{purpose:'host-index'}`。

处理顺序 SHALL 按命令所属的两个分支之一执行：

- **普通成员命令**（除 `createSpace` 外的全部写命令）：① principal 稳定校验（brand、provider 已注册且 `on.channel` 等于注册 channel；internal principal 在此 MUST 立即以 `COLLAB_FORBIDDEN` 拒绝，早于任何 provider 调用、presence 采样与空间状态检查）→ ② 协作空间存在（否则 `COLLAB_SPACE_NOT_FOUND`）→ ③ 按 `{channel, address}` 反查成员，不检查其状态（失败为 `COLLAB_NOT_MEMBER`）→ ④ `cmdId` 收据查找 → ⑤ 协作空间未关闭 → ⑥ 本表前置条件 → ⑦ 命令专属幂等键 → ⑧ 业务校验。
- **`createSpace`**：① principal 稳定校验（internal principal 在此 MUST 以 `COLLAB_FORBIDDEN` 拒绝）→ ② 以 principal 的 `{channel, address}` 为 scope 查找创建收据（命中则返回原结果）→ ③ 请求的 `spaceId` 不存在（已存在为 `COLLAB_SPACE_EXISTS`）→ ④ 认领首成员地址，认领结果的 `{channel, address}` MUST 等于 principal 的地址 → ⑤ 业务校验。同一 `spaceId` 的创建与该空间上的其他命令串行执行。

分支中的成员与创建者地址 scope 均采用幂等 requirement 定义的带类型标签编码；本变更之前写入的 internal scope 收据照常参与重放比对。

读取不执行上述写命令流水线，不要求 cmdId，也不查找收据或命令专属幂等键。agent/provider 读取依次执行 principal 稳定校验、协作空间存在、按地址反查成员、当前 active 读取授权；internal 读取只执行 principal 稳定校验及协作空间存在，不做写命令 purpose 匹配。读取不因协作空间业务状态 closed 而拒绝；存储 failed 或未打开不因此获得豁免。

反查到的成员状态不满足前置条件 MUST 以 `COLLAB_MEMBER_INACTIVE` 拒绝；其余前置条件不满足 MUST 以本表或对应 requirement 指定的错误拒绝，未指定时为 `COLLAB_FORBIDDEN`。

#### Scenario: 动作记为 principal 反查到的成员
- **GIVEN** active agent 成员 `aily` 绑定 `{test-a, a:1}`
- **WHEN** principal `agent{test-a, a:1}` 发送消息给 `doubao`
- **THEN** 提交中事件 `message/sent` 的 `actor` 为 `aily`

#### Scenario: 首次创建与创建重放
- **GIVEN** provider P1 认领 `a:1` 为 agent，`space-1` 不存在
- **WHEN** principal `agent{test-a, a:1}` 以 `cmdId:'c-1'` 创建 `space-1`，随后以相同 `cmdId` 与载荷再次调用
- **THEN** 第一次成功；第二次返回与第一次相同的结果，日志长度仍为 1

#### Scenario: 重复创建同一协作空间
- **GIVEN** `space-1` 已由 `a:1` 创建
- **WHEN** principal `agent{test-a, a:2}` 以新 `cmdId` 创建 `space-1`
- **THEN** 返回 `COLLAB_SPACE_EXISTS`

#### Scenario: 已移除的 internal purpose 被拒绝
- **GIVEN** `space-1` 存在
- **WHEN** principal `internal{purpose:'breaker-reset'}` 分别调用 `overview` 与 `sendMessage`
- **THEN** 都返回 `COLLAB_FORBIDDEN`，日志长度不变

#### Scenario: 不存在的协作空间先于成员反查报错
- **GIVEN** 本实例不存在 `space-x`
- **WHEN** 地址不属于任何成员的 principal `agent{test-a, a:404}` 对 `space-x` 发送消息
- **THEN** 返回 `COLLAB_SPACE_NOT_FOUND`，而不是 `COLLAB_NOT_MEMBER`

#### Scenario: 公开命令与授权表一致
- **GIVEN** `CollabService` 的真实公开类型与授权表，不提供另一份手工维护的命令常量
- **WHEN** 测试从真实类型提取公开可调用成员，去掉四个纯读方法及经逐项核实的非业务生命周期方法，与授权表键比较；随后在类型夹具中增加未登记方法 `unsafeWrite`，授权表保持不变，再运行同一检查
- **THEN** 真实类型的两个集合相等；增加方法的夹具检查失败，报告授权表缺少 `unsafeWrite`，不能因两份清单同时漏改而通过

#### Scenario: 没有按字符串分发的入口
- **GIVEN** `collab-kernel` 的公开类型声明
- **WHEN** 运行类型层测试检查 `CollabService`
- **THEN** 不存在 `execute` 或其他以命令名字符串为参数的方法，也不存在 `setDeciders`、`requestDecision`、`confirmDecision`、`resetBreaker` 方法

#### Scenario: 非 Leader 邀请被拒
- **GIVEN** Leader 为 `aily`，`doubao` 为 active 非 Leader 成员
- **WHEN** `doubao` 邀请新地址
- **THEN** 返回 `COLLAB_FORBIDDEN`，日志长度不变

#### Scenario: 他人代为加入被拒
- **GIVEN** 地址 `a:9` 已被邀请为成员 `bob`（`invited`），`aily` 为 active
- **WHEN** principal `agent{test-a, a:1}`（成员 `aily`）调用 `join`
- **THEN** 返回 `COLLAB_MEMBER_INACTIVE`，`bob` 仍为 `invited`

#### Scenario: provider 代表其他 channel 被拒
- **GIVEN** provider P1 的注册 channel 为 `test-a`
- **WHEN** P1 以 `on:{channel:'test-b', address:'b:7'}` 发起任意命令
- **THEN** 返回 `COLLAB_FORBIDDEN`

#### Scenario: internal 不能执行成员命令
- **GIVEN** active 成员 `doubao`
- **WHEN** principal `internal{purpose:'host-index'}` 调用 `sendMessage`
- **THEN** 返回 `COLLAB_FORBIDDEN`，日志长度不变

#### Scenario: gone 成员不能读写
- **GIVEN** 成员 `doubao` 已为 `gone`
- **WHEN** `doubao` 的 principal 依次发送消息、读取总览
- **THEN** 两次都返回 `COLLAB_MEMBER_INACTIVE`

#### Scenario: host-index 可以读取任意空间
- **GIVEN** 空间 S 中没有任何与宿主相关的成员
- **WHEN** principal `internal{purpose:'host-index'}` 调用 `readSince(0)`
- **THEN** 返回 S 的全部提交记录，日志字节不变

#### Scenario: host-index 不能执行任何写命令
- **GIVEN** active 成员 `doubao` 与一个 open 空间
- **WHEN** principal `internal{purpose:'host-index'}` 依次调用每一个公开写命令（含 `createSpace`）
- **THEN** 每次都返回 `COLLAB_FORBIDDEN`，日志字节不变，provider 的 claim、presence、deliver 调用次数都为 0

#### Scenario: internal 在已关闭空间执行成员命令仍为 FORBIDDEN
- **GIVEN** 空间已关闭
- **WHEN** principal `internal{purpose:'host-index'}` 调用 `invite`
- **THEN** 返回 `COLLAB_FORBIDDEN` 而非 `COLLAB_SPACE_CLOSED`，provider 调用次数为 0

#### Scenario: 未知 internal purpose 被拒绝
- **WHEN** principal `internal{purpose:'other'}` 调用 `overview`
- **THEN** 返回 `COLLAB_FORBIDDEN`

### Requirement: 协作空间的创建、Leader 转交与关闭

`createSpace` SHALL 创建协作空间，调用方成为首个 active 成员并持有 Leader 角色。`createSpace` SHALL 接受可选的 `purpose`（空间用途说明，字符串，去除首尾空白后 1–200 个字符，不含控制字符，否则以 `COLLAB_BAD_PURPOSE` 拒绝），记录在 `space/created` 中，未提供时该字段不出现；`purpose` 创建后不可修改，总览 SHALL 返回它。Leader 角色 SHALL 只表示成员管理与关闭权限，不代表业务决定权。Leader 变化（主动转交与自动接手）MUST NOT 唤醒任何成员。

主动转交：`transferLeader(target)` SHALL 由 Leader 直接执行，在同一提交内使目标成为 Leader，无需目标确认。

自动接手：Leader 因 `leave` 离开时，内核 SHALL 在同一提交内把 Leader 交给 `joinSeq` 最小的其他 active 成员，无需其接受；没有其他 active 成员时 SHALL 在同一提交内关闭协作空间。Leader 不能对自己 `markGone`。`gone` 只能由 Leader 的 `markGone` 或本人 `leave` 产生，宿主观测到的在线状态 MUST NOT 改变成员状态。

关闭后的协作空间 SHALL 只读：除命中历史收据的重放及走独立创建分支的 createSpace 外，任何写命令 MUST 以 `COLLAB_SPACE_CLOSED` 拒绝；`internal` 仍可读取。对已存在空间以新 cmdId 调用 createSpace 返回 `COLLAB_SPACE_EXISTS`，不因业务状态 closed 改为 `COLLAB_SPACE_CLOSED`。

#### Scenario: 创建者成为 Leader
- **GIVEN** provider P1 认领 `a:1` 为 agent
- **WHEN** principal `agent{test-a, a:1}` 以成员名 `aily` 创建协作空间
- **THEN** 日志首条提交含 `space/created` 与 `member/joined(aily)`，`aily` 为 active 且为 Leader

#### Scenario: Leader 直接转交
- **GIVEN** 成员 A（Leader）与 B（active）
- **WHEN** A 调用 `transferLeader(B)`
- **THEN** 提交含 `leader/changed`，B 为 Leader，A 仍为 active

#### Scenario: 不能转交给非 active 成员
- **GIVEN** A 为 Leader，`bob` 为 `invited`
- **WHEN** A 调用 `transferLeader(bob)`
- **THEN** 返回 `COLLAB_FORBIDDEN`，A 仍为 Leader

#### Scenario: Leader 离开后自动接手
- **GIVEN** A（Leader，joinSeq 1）、B（joinSeq 2）、C（joinSeq 3）均 active
- **WHEN** A 离开
- **THEN** 该提交中 B 成为 Leader，C 不变

#### Scenario: 无人可接手时关闭
- **GIVEN** 除 Leader A 外的成员均为 `declined` 或 `gone`
- **WHEN** A 离开
- **THEN** 协作空间为 `closed`；随后以新 cmdId 发起的写命令返回 `COLLAB_SPACE_CLOSED`；`internal` principal 调用 `readSince(0)` 返回全部提交；A 的 principal 读取返回 `COLLAB_MEMBER_INACTIVE`

#### Scenario: 主动关闭后仍可读取
- **GIVEN** A、B 均 active，A 为 Leader
- **WHEN** A 调用 `closeSpace`，随后 A 与 B 读取 `overview`，`internal{purpose:'host-index'}` 调用 `readSince(0)`，再由 B 以新 `cmdId` 调用 `sendMessage`、由 A 以新 `cmdId` 对该空间调用 `createSpace`
- **THEN** 三次读取均成功且日志长度不变；`sendMessage` 返回 `COLLAB_SPACE_CLOSED`；`createSpace` 返回 `COLLAB_SPACE_EXISTS`

#### Scenario: 创建时记录用途
- **WHEN** `aily` 以 `purpose:'仓库 a 与 b 的公共接口'` 创建 `space-1`，再以未提供 `purpose` 创建 `space-2`
- **THEN** `space-1` 总览的 `purpose` 为该字符串；`space-2` 的 `space/created` 事件不含 `purpose` 键

#### Scenario: 非法用途被拒
- **WHEN** 分别以 `purpose:''`、`purpose:'a\nb'`、201 个字符的 `purpose` 创建空间
- **THEN** 每次都返回 `COLLAB_BAD_PURPOSE`，存储中不存在该空间

#### Scenario: Leader 变化不唤醒
- **GIVEN** `aily` 为 Leader，`doubao` 为 active
- **WHEN** `aily` 转交 Leader 给 `doubao`，随后 `doubao` 离开使 Leader 自动交回 `aily`
- **THEN** 两个提交都不含 `dispatch/intended`

### Requirement: 条目状态转换表

条目 SHALL 有 `kind`（`charter|request|other`）、`title`（1–200 字符）、`body`（≤ 64KiB）、`revision`（创建时为 1）、`status`（创建时为 `draft`）、`requiredAcks[]`（创建时指定，须为 active 成员，可为空）、`acks{member: revision}`，`request` 另有 `assignee`（须为 active 成员）与 `progress`（创建时为 `open`）。违反上述约束的 `createItem` MUST 以 `COLLAB_BAD_ITEM` 拒绝，错误详情指明字段。条目 SHALL 另有可选的 `ref`（见"消息与条目可引用先前记录"），创建后不可修改。`reviseItem` SHALL 只能修改 `title`、`body`、`requiredAcks`，同样受上述约束；本变更之前写入、仍带 `deciders` 或 `agentEditCount` 的条目照常重放，这两个字段不再参与任何判断。

条目状态 SHALL 只按下表转换，表外组合 MUST 以表中所列错误拒绝且不写事件：

| 当前状态 | `reviseItem` | `ackItem` |
|---|---|---|
| `draft` | → `draft` | 记录 ack；`requiredAcks` 非空且全部满足 → `agreed` |
| `agreed` | → `draft` | `COLLAB_ITEM_SETTLED` |
| `escalated`（仅存在于本变更之前的日志） | `COLLAB_ITEM_ESCALATED` | `COLLAB_ITEM_ESCALATED` |
| `decided`（仅存在于本变更之前的日志） | `COLLAB_DECIDED_LOCKED` | `COLLAB_DECIDED_LOCKED` |

新写入的条目只会处于 `draft` 或 `agreed`；`escalated` 与 `decided` 只能来自旧日志的重放，是只读历史，不能离开。条目的修改、ack 与达成 `agreed` MUST NOT 唤醒任何成员（共识静默）；需要他人确认时，由修改方另发 `needsReply` 消息。

每次 `reviseItem` SHALL 携带 `expectedRevision`，不等于当前 revision MUST 以 `COLLAB_STALE_REVISION` 拒绝（详情含 `currentRevision`）；生效后 `revision` 加 1、`acks` 清空。`ackItem` SHALL 携带 revision，只接受当前 revision。`request` 的 `progress` 独立于条目状态与 revision（见"request 条目的承接流程"）。

#### Scenario: 全员 ack 后 agreed
- **GIVEN** 条目 `C1` 为 `draft` revision 2，`requiredAcks` 为 `aily`、`doubao`
- **WHEN** 两者都对 revision 2 ack
- **THEN** `C1` 状态为 `agreed`

#### Scenario: 修改使旧 ack 失效
- **GIVEN** `C1` 为 `draft` revision 2，`aily` 已 ack revision 2
- **WHEN** `doubao` 以 `expectedRevision:2` 修改 `C1`
- **THEN** `C1` 为 `draft` revision 3，`acks` 为空对象

#### Scenario: 过期 revision 修改被拒
- **GIVEN** `C2` revision 为 4
- **WHEN** 以 `expectedRevision:3` 修改
- **THEN** 返回 `COLLAB_STALE_REVISION`，`currentRevision` 为 4

#### Scenario: 过期 revision 的 ack 被拒
- **GIVEN** `C1` 为 `draft` revision 3
- **WHEN** `aily` 对 revision 2 ack
- **THEN** 返回 `COLLAB_STALE_REVISION`

#### Scenario: 旧日志中的 escalated 条目只读
- **GIVEN** 本变更之前的日志中条目 `C3` 为 `escalated` revision 5
- **WHEN** 新内核加载后，成员以 `expectedRevision:5` 修改，随后 ack revision 5
- **THEN** 两次分别返回 `COLLAB_ITEM_ESCALATED`，`C3` 仍为 `escalated` revision 5

#### Scenario: 旧日志中的 decided 条目只读
- **GIVEN** 本变更之前的日志中条目 `C4` 为 `decided`
- **WHEN** 新内核加载后，成员依次 ack、修改
- **THEN** 两次都返回 `COLLAB_DECIDED_LOCKED`，`C4` 不变

#### Scenario: 非法条目字段
- **GIVEN** active 成员 `aily`，`bob` 为 `invited`
- **WHEN** 创建 `requiredAcks` 为 `['bob']` 的条目，再创建带 `deciders` 字段的条目
- **THEN** 两次都返回 `COLLAB_BAD_ITEM`，详情字段分别为 `requiredAcks` 与 `deciders`

#### Scenario: 修改与达成共识不唤醒
- **GIVEN** `aily` 与 `doubao` 均为 active，charter `C1` 的 `requiredAcks` 为 `['doubao']`
- **WHEN** `aily` 修改 `C1`，随后 `doubao` ack 使其 `agreed`
- **THEN** 两个提交都不含 `dispatch/intended`；`C1` 为 `agreed`

### Requirement: 消息与状态文本

`sendMessage(to, body, needsReply, ref?)` SHALL 要求：`to` 为当前 active 的其他成员（否则 `COLLAB_BAD_RECIPIENT`）；`body` 为字符串，UTF-8 编码后 1 字节至 16 KiB（否则 `COLLAB_BAD_MESSAGE`）；`needsReply` 仅在未提供时缺省为 `false`；提供时 MUST 为布尔值，否则以 `COLLAB_BAD_MESSAGE` 拒绝，不做隐式类型转换；`ref` 的校验与话题上限见"消息与条目可引用先前记录"与"按话题限制往返"。`setStatus(text)` SHALL 只修改调用方自己的状态文本；`text` 为字符串，长度不超过 500 个字符，空字符串表示清空（否则 `COLLAB_BAD_STATUS`）。

#### Scenario: 正常发送消息
- **GIVEN** `aily` 与 `doubao` 均为 active
- **WHEN** `aily` 发送正文 `hi`、未给 `needsReply` 的消息给 `doubao`
- **THEN** 提交含 `message/sent`，`needsReply` 为 `false`

#### Scenario: 收件人不是 active 成员
- **GIVEN** `bob` 为 `invited`
- **WHEN** `aily` 发送消息给 `bob`
- **THEN** 返回 `COLLAB_BAD_RECIPIENT`

#### Scenario: 正文超限
- **GIVEN** `aily` 与 `doubao` 均为 active
- **WHEN** `aily` 发送 16 KiB + 1 字节的正文
- **THEN** 返回 `COLLAB_BAD_MESSAGE`

#### Scenario: needsReply 不做隐式转换
- **GIVEN** `aily` 与 `doubao` 均为 active
- **WHEN** `aily` 分别以 `needsReply:'false'`、`needsReply:null` 发送合法正文给 `doubao`，再省略 `needsReply` 发送一次
- **THEN** 前两次均返回 `COLLAB_BAD_MESSAGE`，日志长度不变且无 `dispatch/intended`；第三次成功且 `needsReply` 为 `false`

#### Scenario: 清空与超长状态
- **GIVEN** `aily` 的状态文本为 `做 C2`
- **WHEN** `aily` 先设置空字符串，再设置 501 个字符
- **THEN** 第一次后状态文本为空；第二次返回 `COLLAB_BAD_STATUS`，状态文本仍为空

### Requirement: request 条目的承接流程

`request` 条目的 `progress` SHALL 只能按 `open → accepted → done`、`open → rejected`、`accepted → rejected` 推进，仅 `assignee` 可推进，且与条目状态与 revision 无关。非法跳转 MUST 以 `COLLAB_BAD_TRANSITION` 拒绝；非承接方推进 MUST 以 `COLLAB_FORBIDDEN` 拒绝。推进为 `accepted` MUST NOT 唤醒任何成员；推进为终态 `done` 或 `rejected` SHALL 唤醒 request 的作者（结束通知；作者即承接方本人时不唤醒）。终态不可逆，因此每个 request 至多产生一次结束通知。

#### Scenario: 承接方正常推进
- **GIVEN** `R1` 的 `assignee` 为 `doubao`，`progress` 为 `open`
- **WHEN** `doubao` 依次推进为 `accepted`、`done`
- **THEN** `R1.progress` 为 `done`，日志新增两条含 `request/progressed` 的提交；推进为 `accepted` 的提交不含 `dispatch/intended`，推进为 `done` 的提交恰含一条对作者 `aily` 的 `wake` 类 `dispatch/intended`

#### Scenario: 非承接方推进被拒
- **GIVEN** 同上
- **WHEN** `aily` 推进为 `accepted`
- **THEN** 返回 `COLLAB_FORBIDDEN`

#### Scenario: 非法跳转被拒
- **GIVEN** `R1` 为 `open`
- **WHEN** `doubao` 直接推进为 `done`
- **THEN** 返回 `COLLAB_BAD_TRANSITION`

#### Scenario: 拒绝也通知作者
- **GIVEN** 作者 `aily` 的 `R2` 承接方为 `doubao`，`progress` 为 `open`
- **WHEN** `doubao` 推进为 `rejected`
- **THEN** 该提交恰含一条对 `aily` 的 `wake` 类 `dispatch/intended`

#### Scenario: 自己给自己的 request 不唤醒
- **GIVEN** `aily` 创建承接方为 `aily` 的 `R3`
- **WHEN** `aily` 推进为 `accepted` 再到 `done`
- **THEN** 两个提交都不含 `dispatch/intended`

### Requirement: 命令按 cmdId 幂等

每个写命令 SHALL 携带调用方生成的非空 `cmdId`，作用域为 `(spaceId, scope)`。scope SHALL 为带类型标签的结构化值：普通成员为 `{kind:'member', name}`，createSpace 为 `{kind:'create', channel, address}`；本变更之前写入的 `{kind:'internal', purpose}` 收据照常保留并参与重放比对。收据键使用该结构化值的规范化编码，不同 kind 的 scope 永不相等；不得只用 name 或 purpose 字符串作为键。每条成功的公开写命令提交 SHALL 持久化收据 `{cmdId, scope, payloadHash, result}`，`payloadHash` 覆盖规范化后的命令名与全部参数。在通用处理顺序中，收据查找位于"协作空间未关闭"与命令前置条件之前：命中且 `payloadHash` 相同时 SHALL 返回收据中的原结果且不新增提交；`payloadHash` 不同 MUST 以 `COLLAB_CMD_CONFLICT` 拒绝。业务校验失败的命令 MUST NOT 写入收据，同一 `cmdId` 可以重试。

#### Scenario: 重放返回原结果
- **GIVEN** 命令 `cmd-1` 已成功提交为 seq 12
- **WHEN** 同一成员以相同 `cmdId` 与载荷重放
- **THEN** 返回结果引用 seq 12，日志长度不变

#### Scenario: 状态已变化的命令仍可重放
- **GIVEN** `bob` 以 `cmdId:'j-1'` 成功 `join`，此时 `bob` 已为 active
- **WHEN** `bob` 以 `j-1` 再次 `join`
- **THEN** 返回首次结果，日志长度不变

#### Scenario: 关闭后的历史重放
- **GIVEN** `cmd-9` 在协作空间关闭前已成功提交
- **WHEN** 关闭后以相同 `cmdId` 与载荷重放
- **THEN** 返回首次结果，而不是 `COLLAB_SPACE_CLOSED`

#### Scenario: 同 cmdId 不同载荷
- **GIVEN** `cmd-1` 已处理
- **WHEN** 同一成员以 `cmd-1` 提交不同内容
- **THEN** 返回 `COLLAB_CMD_CONFLICT`

#### Scenario: 重启后幂等仍成立
- **GIVEN** `cmd-1` 已提交，内核实例正常关闭
- **WHEN** 基于同一存储新建实例并重放 `cmd-1`
- **THEN** 返回原结果，日志长度不变

#### Scenario: 失败命令可以重试
- **GIVEN** `cmd-2` 因 `COLLAB_STALE_REVISION` 失败
- **WHEN** 以 `cmd-2` 和正确的 `expectedRevision` 重试
- **THEN** 成功提交

#### Scenario: 成员与旧 internal 收据互不冲突
- **GIVEN** 本变更之前的日志含一条 scope 为 `{kind:'internal', purpose:'breaker-reset'}`、`cmdId:'same-id'` 的收据，且存在 active 成员 `breaker-reset`
- **WHEN** 成员 `breaker-reset` 以 `cmdId:'same-id'` 调用 `setStatus`，再以相同载荷重放
- **THEN** 首调成功并新增一条成员 scope 收据，旧收据不变；重放返回该结果且不新增提交

#### Scenario: ref 是幂等载荷的一部分
- **GIVEN** `aily` 以 `cmdId:'m-1'`、`ref:5` 成功发送消息
- **WHEN** `aily` 以 `cmdId:'m-1'`、`ref:7` 及相同正文重放
- **THEN** 返回 `COLLAB_CMD_CONFLICT`，日志长度不变，`m-1` 的原收据逐字节不变；随后以 `ref:5` 与原正文重放返回首次结果

### Requirement: 存储按命令原子提交，并由排他锁保证单写入方

内核 SHALL 只通过存储接口持久化：`open(spaceId)`、`close(spaceId)`、`breakLock(spaceId, expectedInstanceId)`、`commit(spaceId, record, expectedLastSeq)`、`read(spaceId, fromSeq)`、`list()`。本期 SHALL 提供本地磁盘实现：

- 每个协作空间一个 jsonl 文件，每条提交恰为一行，以 `\n` 结尾；提交对象 SHALL 只含 JSON 值（对象、数组、字符串、有限数字、布尔、null），值为 `undefined` 的字段在写入前删除；行内 `sha256` 字段 SHALL 为该提交对象去掉 `sha256` 字段后，递归地把每个普通对象的键按 JavaScript 默认字符串排序（UTF-16 码元序）重建、数组保持原次序，再以标准 `JSON.stringify` 无空白序列化所得 UTF-8 字节的十六进制 SHA-256；
- `commit` SHALL 循环写入直至整行字节全部写出，随后 `fsync` 文件；首次创建文件后还 SHALL `fsync` 所在目录；全部完成后才返回成功；
- 加载时：文件末尾不以 `\n` 结尾的残片 SHALL 视为未提交并截断，截断后 `fsync`；任何以 `\n` 结尾的完整行若无法解析或校验不符，MUST 以 `COLLAB_STORE_CORRUPT` 拒绝加载且不修改文件；
- 任何写入、`fsync` 或内存应用失败时，内核 SHALL 把该协作空间置为 `failed`，此后对它的命令 MUST 以 `COLLAB_STORE_FAILED` 拒绝；调用方 SHALL 把该次结果视为未知，并按以下步骤恢复：对该协作空间调用 `close`（`close` 先停止接纳新命令、等待在途存储操作结束，此后该实例对该空间的任何提交 MUST 被拒绝，再删除内容等于本实例 id 的锁）→ `open` 并加载 → 失败的若是公开写命令提交，以相同 `cmdId` 重试，由收据给出确定结果；失败的若是投递完成提交，不重试、不重新投递，以重新加载后的持久日志为准：已有完整的 `dispatch/completed` 则采用该结果，否则该投递保持结果未知并列入 `pendingDeliveries`；
- `open` SHALL 以排他创建锁文件（写入实例 id 与进程 pid）获取写入权，锁已存在 MUST 以 `COLLAB_STORE_LOCKED` 拒绝（错误详情含锁内容），内核 MUST NOT 自行判断锁持有者是否存活或自动接管；`close` 只删除内容等于本实例 id 的锁；`breakLock(spaceId, expectedInstanceId)` SHALL 仅在锁内实例 id 等于 `expectedInstanceId` 时删除锁，否则以 `COLLAB_STORE_LOCKED` 拒绝。宿主 MUST 在调用前证明该 `expectedInstanceId` 对应的持有者已不存在，证明不足 MUST NOT 调用；匹配实例 id 本身不是证明；
- `commit` 时 `expectedLastSeq` 与文件最后一条提交的 seq 不符 MUST 以 `COLLAB_STORE_CONFLICT` 拒绝并把协作空间置为 `failed`。

命令成功响应 MUST 只在提交持久化且内存应用完成之后返回。

#### Scenario: 重启后状态一致
- **GIVEN** 本地磁盘存储上的协作空间经历成员加入、条目修改与 ack，实例正常 `close`
- **WHEN** 新实例 `open` 并加载
- **THEN** 新实例的成员与条目状态和原实例深度相等

#### Scenario: 行校验和有固定向量
- **GIVEN** 提交对象 `{"seq":1,"z":"é\n","a":[3,{"y":null,"b":true}],"u":undefined,"n":1.5}`
- **WHEN** 计算行校验和，并把写出的行解析后再次计算
- **THEN** 参与计算的规范化 JSON 恰为 `{"a":[3,{"b":true,"y":null}],"n":1.5,"seq":1,"z":"é\n"}`，两次计算均得到固定 SHA-256 `840fce0f37377ab788320a1479c096dd3eecae5e93795e4fda0be650adf39d9f`（该规范化字符串 UTF-8 字节的摘要）

#### Scenario: 末尾残片被截断
- **GIVEN** 文件有 10 条完整提交，末尾追加了第 11 行的前一半且无换行
- **WHEN** 加载
- **THEN** 加载成功，最大 seq 为 10，文件字节等于原 10 行

#### Scenario: 完整行损坏拒绝加载
- **GIVEN** 最后一行以 `\n` 结尾但校验和与内容不符
- **WHEN** 加载
- **THEN** 返回 `COLLAB_STORE_CORRUPT`，文件字节未改变

#### Scenario: 短写不报告成功
- **GIVEN** 测试替身让每次 `write` 只写出一半字节且不抛错
- **WHEN** 提交一条命令
- **THEN** 命令成功返回，且文件中该行完整、校验通过（写入循环补足了剩余字节）

#### Scenario: 多事件命令不会只落一半
- **GIVEN** 一次命令需要写入多个事件（例如 `needsReply` 消息与其 `dispatch/intended`）
- **WHEN** 测试替身在写出部分字节后抛错
- **THEN** 命令返回 `COLLAB_STORE_FAILED`；`close` 后重新 `open` 加载，这些事件都不存在

#### Scenario: fsync 失败后结果交给重试判定
- **GIVEN** 测试替身使 `fsync` 抛错，但整行已写入文件
- **WHEN** 提交 `cmd-5`，随后再提交另一条命令，然后 `close`、`open` 并加载
- **THEN** 前两次都返回 `COLLAB_STORE_FAILED`；重新加载后以 `cmd-5` 重放返回已提交的结果

#### Scenario: failed 后的 close 阻止旧队列继续提交
- **GIVEN** 实例 X 上 `space-1` 已为 `failed`，且有一个已排队的命令
- **WHEN** X 对 `space-1` 调用 `close`，随后实例 Y `open` 并加载 `space-1`
- **THEN** X 的排队命令返回 `COLLAB_STORE_FAILED` 且未写入文件；`close` 完成后锁文件被删除；Y 打开成功

#### Scenario: 已被锁定时拒绝打开
- **GIVEN** 实例 X 已打开 `space-1`
- **WHEN** 实例 Y 打开 `space-1`
- **THEN** Y 返回 `COLLAB_STORE_LOCKED`，锁文件内容仍为 X 的实例 id

#### Scenario: 残留锁不被自动接管
- **GIVEN** `space-1` 的锁文件存在，但没有实例持有它
- **WHEN** 新实例打开 `space-1`
- **THEN** 返回 `COLLAB_STORE_LOCKED`，错误详情包含锁文件路径与其中的实例 id

#### Scenario: 按实例 id 解除残留锁
- **GIVEN** `space-1` 的残留锁内容为实例 `x-1`
- **WHEN** 调用 `breakLock('space-1', 'x-1')`，随后新实例 `open`
- **THEN** 锁被删除，新实例打开成功

#### Scenario: 实例 id 不符不解除
- **GIVEN** `space-1` 的锁内容为实例 `x-2`
- **WHEN** 调用 `breakLock('space-1', 'x-1')`
- **THEN** 返回 `COLLAB_STORE_LOCKED`，锁文件内容仍为 `x-2`

### Requirement: 唤醒只投结构化指针，按事件类型决定接收方

内核 SHALL 在计算每条提交时，按下表得出受影响成员集合，去掉动作发起者本人与非 active 成员（邀请事件的被邀请者除外），去重后为每人记账一条普通唤醒：

| 事件 | 受影响成员 |
|---|---|
| 消息且 `needsReply:true` | 收件人 |
| 邀请 | 被邀请成员（`invited` 状态，本事件是唯一允许投递给非 active 成员的情形） |
| request `progress` 变为 `done` 或 `rejected` | request 作者（结束通知） |
| 条目创建、修改、ack、达成 `agreed`；request 变为 `accepted`；状态更新；`needsReply:false` 消息；成员加入、离开、标记离开；Leader 转交与自动接手 | 无 |

内核 MUST NOT 写入 `confirm` 类投递；本变更之前日志中的 `confirm` 类投递与 `decision/*` 事件照常重放为只读历史。

普通唤醒的指针 SHALL 是只含白名单字段的对象 `{spaceId, toSeq, counts:{message, item, decision, member}, from, invited, thread}`，`from` 为发起者成员名，`invited` 仅在邀请唤醒中为 `true`（表示接收方应调用 `join` 或 `declineInvite`），`thread` 仅在唤醒来自消息或 request 时出现，值为其话题根 seq（见"按话题限制往返"）；`counts.decision` 恒为 0，保留以兼容指针形状，MUST NOT 含消息正文、条目标题或正文。邀请唤醒不改变 `invited` 成员的读写权限。

#### Scenario: 需回复消息叫醒收件人
- **GIVEN** 测试 provider 记录全部 `deliver` 调用
- **WHEN** `aily` 发送 `needsReply:true`、正文为 `SECRET-BODY` 的消息给 `doubao`
- **THEN** 恰有一次对 `doubao` 的 `deliver`；指针的键集合恰为 `spaceId, toSeq, counts, from, thread`，`thread` 等于该消息自身的 seq；序列化后不含 `SECRET-BODY`

#### Scenario: 状态更新不叫醒
- **GIVEN** 同上
- **WHEN** `aily` 更新状态文本
- **THEN** 无 `deliver` 调用

#### Scenario: 不叫醒自己
- **GIVEN** `aily` 创建承接方为 `aily` 的 request `R1`
- **WHEN** `aily` 推进 `R1` 为 `accepted` 再到 `done`
- **THEN** 无 `deliver` 调用

#### Scenario: 邀请叫醒被邀请者
- **GIVEN** 测试 provider 认领 `a:9` 且支持唤醒
- **WHEN** Leader `aily` 邀请 `a:9` 为 `bob`
- **THEN** 该提交恰含一条对 `bob` 的 `wake` 类 `dispatch/intended`；随后的 `deliver` 指针中 `invited` 为 `true` 且不含 `thread`；`bob` 读取总览仍返回 `COLLAB_MEMBER_INACTIVE`

### Requirement: 投递意图在事务内记账

内核 SHALL 在产生唤醒的命令的同一提交中，为每次投递写入 `dispatch/intended`（含 `deliveryId`、成员、类型 `wake`、承担投递的 `providerId`，归属话题时含 `thread`）。外部 SPI 调用 SHALL 在提交之后、事务之外执行：调 `deliver(member, pointer)`。provider 接口 SHALL 不再包含 `requestConfirmation`。

每次 SPI 调用结束后，内核 SHALL 自行在同一协作空间的串行事务中写入 `dispatch/completed`（actor 为 `system:dispatch`），宿主与 provider 不能直接写入投递结果：SPI 正常返回记为 `succeeded`；抛错记为 `failed`。内核 MUST NOT 为 SPI 调用设置超时，也 MUST NOT 在 SPI 结束前写入结果：冷恢复一个会话可能耗时很久且不可取消。SPI 尚未结束的投递 SHALL 在总览中列为 `inFlightDeliveries`。每个 `deliveryId` SHALL 至多一个结果。协作空间已关闭时 SHALL 不写结果。加载时有 `dispatch/intended` 而无结果的投递 SHALL 视为结果未知：不自动重发，并在总览的 `pendingDeliveries` 中列出。

#### Scenario: 意图与命令同提交
- **GIVEN** `aily` 发送需回复消息给 `doubao`
- **WHEN** 读取该命令的提交
- **THEN** 同一提交内含 `message/sent` 与一条成员为 `doubao`、类型为 `wake` 的 `dispatch/intended`

#### Scenario: 正常返回记为成功
- **GIVEN** 上一步的 `deliveryId` 为 `dv-1`，测试 provider 的 `deliver` 正常返回
- **WHEN** 等待调度完成
- **THEN** 日志新增一条提交，含 `dispatch/completed`（`deliveryId:'dv-1'`、`outcome:'succeeded'`、actor `system:dispatch`）

#### Scenario: provider 抛错记为失败
- **GIVEN** 测试 provider 的 `deliver` 抛错
- **WHEN** 记账后的调度完成
- **THEN** 日志新增 `dispatch/completed(outcome:'failed')`，原业务提交不受影响

#### Scenario: 慢投递在结束前不写结果
- **GIVEN** 测试 provider 的 `deliver` 在 60 秒后才返回（假定时器）
- **WHEN** `aily` 发送需回复消息给 `doubao`，推进时间到 30 秒，读取总览；再推进到 60 秒
- **THEN** 30 秒时日志无该投递的 `dispatch/completed`，总览 `inFlightDeliveries` 含它；60 秒后写入一条 `dispatch/completed(outcome:'succeeded')`

#### Scenario: 宿主不能写入投递结果
- **GIVEN** `CollabService` 的公开类型声明
- **WHEN** 运行类型层测试
- **THEN** 不存在 `recordDispatch` 或其他可写入投递结果的公开方法

#### Scenario: 重启后未完成投递不重发
- **GIVEN** `dv-2` 有 `dispatch/intended` 而无结果
- **WHEN** 新实例加载
- **THEN** 无 SPI 调用；总览的 `pendingDeliveries` 包含 `dv-2`

#### Scenario: 投递完成提交可持久化与重放且无收据
- **GIVEN** 文件存储上的投递 `dv-1` 已写入 `dispatch/completed(outcome:'succeeded')`
- **WHEN** 读取该提交，随后 `close`、新实例 `open` 并加载
- **THEN** 该提交只含 `dispatch/completed`，不含 `cmdId` 与收据；加载后 `dv-1` 的结果仍为 `succeeded`，`pendingDeliveries` 不含 `dv-1`

#### Scenario: failed 后不写投递完成提交
- **GIVEN** 已记账 `dv-4`，随后存储写入失败使协作空间为 `failed`
- **WHEN** `dv-4` 的 SPI 调用返回
- **THEN** 不写入 `dispatch/completed`；`close` 后重新加载，`dv-4` 出现在 `pendingDeliveries`

#### Scenario: 投递完成提交 fsync 失败后按日志恢复
- **GIVEN** `dv-5` 的 SPI 调用正常返回，测试替身使写入 `dispatch/completed` 时整行写出后 `fsync` 抛错
- **WHEN** 协作空间进入 `failed`，随后 `close`、`open` 并加载
- **THEN** 加载后 `dv-5` 的结果为 `succeeded`，日志中 `dv-5` 恰有一条 `dispatch/completed`；恢复过程中无新的 SPI 调用

### Requirement: 选择绑定与在线状态

本期每个成员只有一个绑定。普通唤醒 SHALL 只在该绑定 `supports.wake` 为真、且记账前对其 `presence` 的采样不为 `unreachable` 时记账，否则不记账，并在总览中把该成员标记为 `unreachable`。`presence` SHALL 在命令进入事务之前采样一次，作为该命令计算的显式输入。绑定的 `supports.confirm` 字段 SHALL 保留以兼容成员形状，但不再参与任何判断。

#### Scenario: 不可达成员不记账
- **GIVEN** agent 成员 `doubao` 的 presence 采样为 `unreachable`
- **WHEN** `aily` 发送需回复消息给 `doubao`
- **THEN** 该提交不含对 `doubao` 的 `dispatch/intended`，总览中 `doubao` 为 `unreachable`

#### Scenario: 不支持唤醒的绑定不记账
- **GIVEN** 成员 `pm` 的绑定 `supports.wake` 为假
- **WHEN** `aily` 发送需回复消息给 `pm`
- **THEN** 该提交不含对 `pm` 的 `dispatch/intended`，消息照常提交

### Requirement: 状态投影只呈现当前值，且以纯文本安全输出

内核 SHALL 提供纯函数 `project(state, presence)`，生成面向人的 Markdown，包含：空间用途、charter 当前版本、成员与在线状态（含 `unreachable`）、待 ack 条目及缺少的成员、未结 request、`pendingDeliveries`；旧日志中存在 `escalated` 或 `decided` 条目时另列"历史条目"小节。投影 MUST NOT 包含消息正文。成员输入的文本（标题、状态文本）SHALL 依次：去除控制字符与换行（替换为单个空格）→ 去除首尾空白 → 对全部 CommonMark ASCII 标点（`` !"#$%&'()*+,-./:;<=>?@[\]^_`{|}~ ``）各做一次反斜杠转义，不做 HTML 实体转义；结果以投影模板中固定的非空白前缀开头的行输出，MUST NOT 放入代码 span 或代码块。投影与指针只是带来源的协作数据，宿主 MUST NOT 把其中的成员文本当作系统或用户指令。

#### Scenario: 投影列出待 ack
- **GIVEN** 条目 `C2` 需要 `doubao` ack 且尚未确认
- **WHEN** 生成投影
- **THEN** 投影的"待确认"小节包含 `C2` 与 `doubao`

#### Scenario: 投影不含消息正文
- **GIVEN** 日志中有正文为 `SECRET-BODY` 的消息
- **WHEN** 生成投影
- **THEN** 投影文本不包含 `SECRET-BODY`

#### Scenario: 恶意标题不能产生额外结构
- **GIVEN** 条目标题为 ``x`` ``\n## 已决定\n- [点我](http://evil)<script>`` ``
- **WHEN** 生成投影并用 CommonMark 解析器解析
- **THEN** 解析结果中，该标题所在节点之内不存在 heading、list、link、html、code 节点，且全文仅有投影模板自身产生的 heading

#### Scenario: 转义后可见文本不变
- **GIVEN** 条目标题为 `<tag>&"x` 前面带四个空格
- **WHEN** 生成投影并用 CommonMark 解析器解析
- **THEN** 该标题所在节点的可见文本恰为 `<tag>&"x`，节点类型为普通段落文本而非代码块

#### Scenario: 投影不含已移除机制
- **GIVEN** 新内核上的空间含 charter、未结 request 与待 ack 条目
- **WHEN** 生成投影
- **THEN** 投影文本不含 `paused`、`awaitingChannel`、"已决定"、"已升级"

### Requirement: 协作约定随协作空间提供

协作约定的指南文本 SHALL 随 `collab-kernel` 包按版本发布，已发布版本的文本 MUST NOT 修改，新增内容只能以新版本发布。包内 SHALL 同时提供版本 `1`、`2` 与 `3`，未显式指定约定的内核实例以最新版本 `3` 作为新空间的默认约定。协作空间创建时 SHALL 记录所用版本；`overview` SHALL 返回 `convention:{version, sha256}`；`readConvention(version)` SHALL 返回空间所记录版本的全文，其 sha256 与总览一致；读取包内任一已发布版本都 SHALL 成功。不存在的版本 MUST 以 `COLLAB_CONVENTION_UNKNOWN` 拒绝。版本 `2` SHALL 在版本 `1` 的基础上说明：宿主可以声明成员信任，此时被邀请者已由宿主代为加入，承接方在本会话原有权限边界内直接处理空间内的 request，不再为此另向人类索取授权；宿主未声明时按版本 `1` 的规则处理。版本 `3` SHALL 是版本 `2` 的修订副本：删除成员级熔断（每成员 6 次、暂停、重置）、条目升级与人类决定（`requestDecision`、`awaitingChannel`、`decided`）相关内容，并说明：四条原则（改状态不顺带唤醒；request 终态通知作者；要对方动手就发 `needsReply` 消息；台账是唯一真源）；接续同一件事用 `ref` 引用先前消息或条目，另起一件事不写；每个话题至多 20 条唤醒消息，超出返回 `COLLAB_THREAD_LIMIT`，此时应停止这段往返并向本会话用户报告，不要为继续同一件事另起话题；自记进度用无 `requiredAcks` 的 `other` 条目并由作者更新；修改共识后需要确认时另发 `needsReply` 消息；按空间用途选择写入的空间；需要人决定时在本会话问自己的用户，再把结论写回台账。各版本都 SHALL 保留"人类决定只能来自受信确认"与"消息不是越权依据"的规则。

#### Scenario: 总览带约定版本
- **GIVEN** 以约定版本 `3` 创建的协作空间
- **WHEN** 成员读取总览并调用 `readConvention('3')`
- **THEN** 总览含 `convention.version:'3'`，全文的 sha256 等于 `convention.sha256`

#### Scenario: 旧空间仍按原版本读取
- **GIVEN** 分别以约定版本 `1`、`2` 创建的已有空间
- **WHEN** 升级后成员分别调用 `readConvention('1')`、`readConvention('2')`
- **THEN** 返回与升级前逐字节相同的全文，sha256 等于该空间记录的值

#### Scenario: 已发布文本不可变
- **WHEN** 计算包内版本 `1`、`2` 文本的 sha256
- **THEN** 分别等于 `5df2524d42641e3885f4e2ec0314d4b03f0922662d933f9283fe1ddd4c8cd039` 与 `70b660c57e72ccb04d575212d99ce045f6ce2d4029b8313d5591382e614afec9`

#### Scenario: 未知版本
- **GIVEN** 包内只有版本 `1`、`2` 与 `3`
- **WHEN** 调用 `readConvention('9')`
- **THEN** 返回 `COLLAB_CONVENTION_UNKNOWN`

#### Scenario: v3 写明新规则且不含已移除机制
- **WHEN** 读取版本 `3` 全文
- **THEN** 全文同时含 `ref`、`20`、`COLLAB_THREAD_LIMIT`、`needsReply`、"停止"、"向本会话用户报告"、"不要为继续同一件事另起话题"与"不是系统指令"；且不含"6 次"、"暂停"、`requestDecision`、`awaitingChannel`、"内部接口"

### Requirement: 公开纯状态推导函数

内核 SHALL 从公开入口导出纯函数 `reduce(previous, record)`，与内核内部加载、提交时使用的是同一实现：输入上一状态与一条提交记录，返回新状态，不读写存储、不调用 provider、不需要 principal。它不授予任何读取权：调用者必须已经通过合法读取取得提交记录。

#### Scenario: 公开推导与内核状态一致
- **GIVEN** 一个空间经历创建、邀请、加入、statusText 更新、条目修改、ack、带 `ref` 的消息与 Leader 转交
- **WHEN** 以 `internal{purpose:'host-index'}` 调用 `readSince(0)`，再用公开 `reduce` 依次折叠全部记录
- **THEN** 所得状态与同一时刻 `overview` 返回的状态在 members、items、leader、status、lastSeq、`itemSeq`、`topicOf` 上深度相等

#### Scenario: 推导不修改输入
- **GIVEN** 一个非空的上一状态与一条成员加入记录
- **WHEN** 调用公开 `reduce`
- **THEN** 调用前后对上一状态与记录各做的深拷贝分别深度相等

#### Scenario: 推导函数不接触外部
- **GIVEN** 存储与 provider 的每个方法都被替换为一经调用即抛错的替身
- **WHEN** 用公开 `reduce` 折叠一组记录
- **THEN** 正常返回状态，替身调用次数为 0
