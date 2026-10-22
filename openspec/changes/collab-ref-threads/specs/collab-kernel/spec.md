## ADDED Requirements

### Requirement: 消息与条目可引用先前记录

`sendMessage` 与 `createItem` SHALL 接受可选参数 `ref`。`ref` 是本空间内一条先前记录的 seq，被引用者只能是：一条 `message/sent` 所在提交的 seq（即该消息的 `id`），或一个条目的创建 seq（其 `item/created` 所在提交的 seq）。未提供 `ref`（键不存在）时命令行为与本变更之前完全相同。提供时 MUST 为正的安全整数，且 MUST 指向上述两类记录之一，否则以 `COLLAB_BAD_REF` 拒绝；`ref` 不做隐式类型转换（`"5"`、`null`、`1.5` 均被拒绝）。被引用者必须已存在，因此 `ref` 必然小于新记录的 seq，引用关系不会成环。

`ref` 校验 SHALL 位于该命令既有业务校验（`COLLAB_BAD_RECIPIENT`、`COLLAB_BAD_MESSAGE`、`COLLAB_BAD_ITEM`）之后、链长检查之前；任一校验失败都不写提交、不写收据、不记账投递。

`ref` SHALL 原样持久化：`message/sent` 的 `message.ref`、`item/created` 的 `item.ref`；没有 `ref` 时该字段 MUST 不出现。条目后续事件（`item/revised`、`item/acked`）携带的条目快照 SHALL 保留创建时的 `ref`，不可修改。条目的创建 seq 由重放推导，不新增事件字段；总览 SHALL 提供 `itemSeq: {itemId: 创建 seq}`，并以自有属性写入（itemId 为 `__proto__` 时仍可查到）。

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
- **THEN** 每次都返回 `COLLAB_BAD_REF`，日志长度不变，无 `dispatch/intended`

#### Scenario: 条目引用非法 seq
- **WHEN** `aily` 以 `ref:9999` 创建条目 `R9`
- **THEN** 返回 `COLLAB_BAD_REF`，`R9` 不存在，日志长度不变

#### Scenario: 悬空引用的日志加载失败
- **GIVEN** 存储中某空间的日志被手工改写，使一条 `message/sent` 的 `message.ref` 指向不存在的 seq
- **WHEN** 新实例打开该空间
- **THEN** 打开失败，该空间不可读写；同一存储中的其它空间正常打开

#### Scenario: 多重错误时先报既有校验
- **WHEN** `aily` 以非 active 收件人 `bob` 与 `ref:9999` 发消息
- **THEN** 返回 `COLLAB_BAD_RECIPIENT`

### Requirement: 按链长限制往返

每条消息与每个条目 SHALL 有链长（chain length）与链起点（thread），由重放从 `ref` 推导，不读取正文：

- 消息：无 `ref` 时链长为 1、起点为自身 seq；有 `ref` 时链长为被引用记录**此刻**的链长加 1、起点为被引用记录的起点。
- 条目：创建时无 `ref` 则链长为 1、起点为创建 seq；有 `ref` 则链长为被引用记录此刻的链长加 1、起点为被引用记录的起点。此后该条目每产生一个"会叫醒他人的条目事件"，链长 SHALL 加 1，起点不变。"会叫醒他人的条目事件"指唤醒表中归属条目的行（`item/revised`、使条目变为 `agreed` 的 `item/acked`、`request/progressed`、`decision/decided`），且按唤醒表算出的受影响成员（去掉发起者本人与非 active 成员后、presence 与绑定能力过滤之前）非空；判定与 presence 无关，因此可由重放确定。
- 本变更之前写入的记录没有 `ref`，按上述规则从 1 起算。

链长上限为常量 `CHAIN_LIMIT`（= 20）。一个命令若会产生上述"会叫醒他人"的事件（对消息而言即 `needsReply:true` 且收件人非发起者本人），且该事件使对应链长超过 `CHAIN_LIMIT`，命令 MUST 以 `COLLAB_THREAD_LIMIT` 拒绝，不写提交、不写收据、不记账投递；这包括 `needsReply:true` 的消息（新消息的链长）。不叫醒任何人的命令（`needsReply:false` 的消息、未使条目进入 `agreed` 的 ack、无 `requiredAcks` 的修改、状态文本）与成员管理命令 MUST NOT 受链长限制；`needsReply:false` 的消息仍按规则获得链长与起点，可被引用。人类决定（`confirmDecision`）与 request 进度推进（`advanceRequest`，每个 request 至多两次，不能成环）不受链长限制，但仍使条目链长加 1。

链长只依赖 `ref` 与条目事件，与"谁叫醒了谁"无关；同一链上任意成员的往返都计入。归属消息或条目的 `wake` 类 `dispatch/intended` SHALL 在 `delivery.thread` 中记录链起点，不归属的（邀请）MUST 不含该字段。总览 SHALL 提供 `chainLength: {seq: 链长}`，键为消息 seq 与条目创建 seq。链长检查与提交在同一协作空间的串行事务中完成，并发命令不能越过上限。

#### Scenario: 同一链第 21 环被拒绝
- **GIVEN** `aily` 在 seq 5 发出需回复消息给 `doubao`（链长 1）
- **WHEN** 此后两人轮流以 `ref` 指向对方上一条消息、发 `needsReply:true` 的消息
- **THEN** 第 2 至 20 条成功，链长依次为 2…20，每条唤醒的 `delivery.thread` 为 5；第 21 条返回 `COLLAB_THREAD_LIMIT`，日志长度不变

#### Scenario: 不写 ref 的新消息从 1 开始
- **GIVEN** 承上，链 5 已达 20
- **WHEN** `aily` 不带 `ref` 发送需回复消息给 `doubao`
- **THEN** 成功，链长为 1，唤醒的 `delivery.thread` 为该消息自身的 seq

#### Scenario: 不叫醒人的命令不受限
- **GIVEN** 承上，链 5 中最后一条消息 seq 为 m（链长 20）
- **WHEN** `doubao` 以 `ref:m`、`needsReply:false` 回复
- **THEN** 成功，无 `dispatch/intended`；该消息链长为 21

#### Scenario: 条目往返计入链长
- **GIVEN** 作者 `aily` 在 seq 7 创建条目 `C1`，`requiredAcks:['doubao']`（链长 1）
- **WHEN** `aily` 修改 `C1`、`doubao` ack 使其 `agreed`，如此反复
- **THEN** 每次修改与每次达成 `agreed` 各使 `C1` 链长加 1，相应唤醒的 `delivery.thread` 为 7；使链长超过 20 的那次修改或 ack 返回 `COLLAB_THREAD_LIMIT`，`C1` 状态与 revision 不变

#### Scenario: request 进度计入链长
- **GIVEN** `aily` 在 seq 3 发起消息链（链长 1），消息 5 以该链为 ref 链长为 3（链起点 3）；作者 `aily` 以 `ref:5` 创建 request `R1`、承接方 `doubao`
- **WHEN** `doubao` 推进 `R1` 为 `accepted` 再到 `done`
- **THEN** `R1` 链长依次为 4、5、6；两次唤醒 `aily` 的 `delivery.thread` 为 3

#### Scenario: request 进度不受链长限制
- **GIVEN** request `R3`（作者 `aily`、承接方 `doubao`）链长为 20
- **WHEN** `doubao` 推进 `R3` 为 `accepted`
- **THEN** 成功，`R3` 链长为 21，`aily` 收到一条 `delivery.thread` 为 `R3` 起点的唤醒

#### Scenario: 引用条目时取引用那一刻的链长
- **GIVEN** 作者 `aily` 的条目 `C2`（`requiredAcks:['doubao']`，创建 seq 7）链长为 3
- **WHEN** `doubao` 以 `ref:7` 发需回复消息 M1；随后 `aily` 修改 `C2` 使其链长为 4；再由 `doubao` 以 `ref:7` 发需回复消息 M2
- **THEN** M1 的链长为 4，并在 `C2` 增长后仍为 4；M2 的链长为 5

#### Scenario: 命令时判定与重新加载一致
- **GIVEN** 一个空间依次发生：消息链推进到第 20 环、第 21 环被拒、条目修改与 ack 达成 agreed、引用条目前后各发一条消息、一个收件人 presence 不可达的需回复消息
- **WHEN** 记录此时总览的 `chainLength` 与 `itemSeq`，关闭空间后用新实例重新打开并读取总览
- **THEN** 两次的 `chainLength` 与 `itemSeq` 深度相等；被拒的那一环在日志中不存在；presence 不可达的消息仍有链长且计入链

#### Scenario: 并发的条目事件不越过上限
- **GIVEN** 作者 `aily` 的条目 `C5`（`requiredAcks:['doubao']`，draft、revision r）链长为 19，`doubao` 的 ack 会使 `C5` 进入 agreed
- **WHEN** 测试控制入队顺序：先入队 `doubao` 对 revision r 的 ack，再入队 `aily` 以 `expectedRevision:r`（ack 不改变 revision，agreed 条目允许修改）的修改
- **THEN** ack 成功、`C5` 链长为 20；修改返回 `COLLAB_THREAD_LIMIT`（而非 `COLLAB_STALE_REVISION`），`C5` 的 revision 不变

#### Scenario: 人类决定不受链长限制
- **GIVEN** 条目 `C3` 链长为 20，有 open 决策请求与合格的确认证据
- **WHEN** 人类成员确认
- **THEN** 提交成功，`C3` 为 `decided`，链长为 21，`requiredAcks` 成员被唤醒且 `delivery.thread` 为 `C3` 的起点

#### Scenario: 邀请不归属任何链
- **WHEN** Leader 邀请 `bob`
- **THEN** 对 `bob` 的 `wake` 类 `dispatch/intended` 不含 `delivery.thread`

#### Scenario: 旧的成员级熔断不再阻断
- **GIVEN** 本变更之前的日志中 `doubao` 已有 6 条不含 `thread` 的 `wake` 记账、无 `breaker/reset`
- **WHEN** 新内核加载该日志后 `aily` 不带 `ref` 发需回复消息给 `doubao`
- **THEN** 该提交含对 `doubao` 的 `wake` 类 `dispatch/intended`；总览 `presence.doubao` 不为 `paused`

#### Scenario: 旧日志中的 breaker/reset 照常重放
- **GIVEN** 本变更之前的日志含 `breaker/reset{member:'doubao'}` 与 `internal` scope 收据
- **WHEN** 新内核加载该日志
- **THEN** 加载成功，状态中各消息链长为 1

## REMOVED Requirements

### Requirement: 按成员计数的熔断
**Reason**: 成员级计数把一个成员在空间内所有工作的唤醒累加到同一个永不衰减的计数，正常推进多件事即触顶并静默丢弃唤醒，而纯 agent 空间无人能重置，空间实际失效。用户确认防循环应按单一链的往返长度计算，并且超限要显式拒绝而非静默丢弃。
**Migration**: 由"按链长限制往返"取代。`resetBreaker`、internal purpose `breaker-reset`、成员 `paused` 状态与 `BREAKER_LIMIT` 一并移除。旧日志中的 `breaker/reset` 事件、成员 `wakeCount` 字段与 internal scope 收据照常重放但不再参与任何判断；已暂停的成员在新内核加载后自然恢复。

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
| `requestDecision` | agent、provider | 成员 |
| `confirmDecision` | provider | 成员（当前 active，否则 `COLLAB_MEMBER_INACTIVE`）且 `kind` 为 `human`（否则 `COLLAB_FORBIDDEN`）；其余见"人类决定只能由带证据的确认产生" |

读取 `overview`、`readSince`、`project`、`readConvention` SHALL 允许成员（任意状态为 `active` 的成员）与 `internal{purpose:'host-index'}`。

处理顺序 SHALL 按命令所属的两个分支之一执行：

- **普通成员命令**（除 `createSpace` 外的全部写命令）：① principal 稳定校验（brand、provider 已注册且 `on.channel` 等于注册 channel；internal principal 在此 MUST 立即以 `COLLAB_FORBIDDEN` 拒绝，早于任何 provider 调用、presence 采样与空间状态检查）→ ② 协作空间存在（否则 `COLLAB_SPACE_NOT_FOUND`）→ ③ 按 `{channel, address}` 反查成员，不检查其状态（失败为 `COLLAB_NOT_MEMBER`）→ ④ `cmdId` 收据查找 → ⑤ 协作空间未关闭 → ⑥ 本表前置条件 → ⑦ 命令专属幂等键 → ⑧ 业务校验。
- **`createSpace`**：① principal 稳定校验（internal principal 在此 MUST 以 `COLLAB_FORBIDDEN` 拒绝）→ ② 以 principal 的 `{channel, address}` 为 scope 查找创建收据（命中则返回原结果）→ ③ 请求的 `spaceId` 不存在（已存在为 `COLLAB_SPACE_EXISTS`）→ ④ 认领首成员地址，认领结果的 `{channel, address}` MUST 等于 principal 的地址 → ⑤ 业务校验。同一 `spaceId` 的创建与该空间上的其他命令串行执行。

分支中的成员与创建者地址 scope 均采用幂等 requirement 定义的带类型标签编码；本变更之前写入的 internal scope 收据照常重放。

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
- **WHEN** principal `internal{purpose:'breaker-reset'}` 调用 `overview` 与 `sendMessage`
- **THEN** 都返回 `COLLAB_FORBIDDEN`，日志长度不变；`CollabService` 公开类型中不存在 `resetBreaker`

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
- **THEN** 不存在 `execute` 或其他以命令名字符串为参数的方法，也不存在 `setDeciders` 方法

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

#### Scenario: agent 调用 confirmDecision 被拒
- **GIVEN** 一个 open 的决策请求
- **WHEN** principal `agent{test-a, a:1}` 调用 `confirmDecision`
- **THEN** 返回 `COLLAB_FORBIDDEN`，请求仍为 open，日志长度不变

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

`createSpace` SHALL 创建协作空间，调用方成为首个 active 成员并持有 Leader 角色。Leader 角色 SHALL 只表示成员管理与关闭权限，不代表业务决定权。

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

### Requirement: 消息与状态文本

`sendMessage(to, body, needsReply, ref?)` SHALL 要求：`to` 为当前 active 的其他成员（否则 `COLLAB_BAD_RECIPIENT`）；`body` 为字符串，UTF-8 编码后 1 字节至 16 KiB（否则 `COLLAB_BAD_MESSAGE`）；`needsReply` 仅在未提供时缺省为 `false`；提供时 MUST 为布尔值，否则以 `COLLAB_BAD_MESSAGE` 拒绝，不做隐式类型转换；`ref` 的校验与链长限制见"消息与条目可引用先前记录"与"按链长限制往返"。`setStatus(text)` SHALL 只修改调用方自己的状态文本；`text` 为字符串，长度不超过 500 个字符，空字符串表示清空（否则 `COLLAB_BAD_STATUS`）。

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
- **THEN** 首调成功并新增一条成员 scope 收据；重放返回该结果且不新增提交

#### Scenario: ref 是幂等载荷的一部分
- **GIVEN** `aily` 以 `cmdId:'m-1'`、`ref:5` 成功发送消息
- **WHEN** `aily` 以 `cmdId:'m-1'`、`ref:7` 及相同正文重放
- **THEN** 返回 `COLLAB_CMD_CONFLICT`，日志长度不变，`m-1` 的原收据逐字节不变；随后以 `cmdId:'m-1'`、`ref:5` 及原正文重放，返回首次结果

### Requirement: 唤醒只投结构化指针，按事件类型决定接收方

内核 SHALL 在计算每条提交时，按下表得出受影响成员集合，去掉动作发起者本人与非 active 成员（邀请事件的被邀请者除外），去重后为每人记账一条普通唤醒：

| 事件 | 受影响成员 |
|---|---|
| 消息且 `needsReply:true` | 收件人 |
| 条目修改 | 修改后仍在 `requiredAcks` 中的成员 |
| 条目变为 `agreed` | 条目作者 |
| request `progress` 变化 | request 作者 |
| 邀请 | 被邀请成员（`invited` 状态，本事件是唯一允许投递给非 active 成员的情形） |
| `decision/decided` | 请求发起方与条目 `requiredAcks` 成员 |
| 条目变为 `escalated` | 无 agent 成员 |
| 状态更新、`needsReply:false` 消息、成员加入、Leader 转交（含 Leader 离开后的自动接手） | 无 |

普通唤醒的指针 SHALL 是只含白名单字段的对象 `{spaceId, toSeq, counts:{message, item, decision, member}, from, invited, thread}`，`from` 为发起者成员名，`invited` 仅在邀请唤醒中为 `true`（表示接收方应调用 `join` 或 `declineInvite`），`thread` 仅在唤醒来自消息或条目事件时出现，值为该链的起点 seq（见"按链长限制往返"），MUST NOT 含消息正文、条目标题或正文。邀请唤醒不改变 `invited` 成员的读写权限。

#### Scenario: 需回复消息叫醒收件人
- **GIVEN** 测试 provider 记录全部 `deliver` 调用
- **WHEN** `aily` 发送 `needsReply:true`、正文为 `SECRET-BODY` 的消息给 `doubao`
- **THEN** 恰有一次对 `doubao` 的 `deliver`；指针的键集合恰为 `spaceId, toSeq, counts, from, thread`，`thread` 等于该消息自身的 seq；序列化后不含 `SECRET-BODY`

#### Scenario: 状态更新不叫醒
- **GIVEN** 同上
- **WHEN** `aily` 更新状态文本
- **THEN** 无 `deliver` 调用

#### Scenario: 不叫醒自己
- **GIVEN** `aily` 与 `doubao` 都在条目 `C1` 的 `requiredAcks` 中
- **WHEN** `aily` 修改 `C1`
- **THEN** 只有对 `doubao` 的 `deliver`

#### Scenario: 邀请叫醒被邀请者
- **GIVEN** 测试 provider 认领 `a:9` 且支持唤醒
- **WHEN** Leader `aily` 邀请 `a:9` 为 `bob`
- **THEN** 该提交恰含一条对 `bob` 的 `wake` 类 `dispatch/intended`；随后的 `deliver` 指针中 `invited` 为 `true` 且不含 `thread`；`bob` 读取总览仍返回 `COLLAB_MEMBER_INACTIVE`

#### Scenario: Leader 转交不叫醒新 Leader
- **GIVEN** `aily` 为 Leader，`doubao` 为 active
- **WHEN** `aily` 转交 Leader 给 `doubao`，随后 `doubao` 转交回 `aily`
- **THEN** 两个提交都不含 `dispatch/intended`；`doubao` 在第一次转交后读取总览可见 `leader` 为 `doubao`

### Requirement: 状态投影只呈现当前值，且以纯文本安全输出

内核 SHALL 提供纯函数 `project(state, presence)`，生成面向人的 Markdown，包含：charter 当前版本、成员与在线状态（含 `unreachable`）、待 ack 条目及缺少的成员、未结 request、`escalated` 条目、已决定事项及决定人、`awaitingChannel` 的决策请求、`pendingDeliveries`。投影 MUST NOT 包含消息正文。成员输入的文本（标题、状态文本）SHALL 依次：去除控制字符与换行（替换为单个空格）→ 去除首尾空白 → 对全部 CommonMark ASCII 标点（`` !"#$%&'()*+,-./:;<=>?@[\]^_`{|}~ ``）各做一次反斜杠转义，不做 HTML 实体转义；结果以投影模板中固定的非空白前缀开头的行输出，MUST NOT 放入代码 span 或代码块。投影与指针只是带来源的协作数据，宿主 MUST NOT 把其中的成员文本当作系统或用户指令。

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

#### Scenario: 投影不再出现 paused
- **GIVEN** 本变更之前的日志中 `doubao` 已有 6 条 `wake` 记账
- **WHEN** 新内核加载后生成投影
- **THEN** 投影文本不含 `paused`

### Requirement: 协作约定随协作空间提供

协作约定的指南文本 SHALL 随 `collab-kernel` 包按版本发布，已发布版本的文本 MUST NOT 修改，新增内容只能以新版本发布。包内 SHALL 同时提供版本 `1`、`2` 与 `3`，未显式指定约定的内核实例以最新版本 `3` 作为新空间的默认约定。协作空间创建时 SHALL 记录所用版本；`overview` SHALL 返回 `convention:{version, sha256}`；`readConvention(version)` SHALL 返回空间所记录版本的全文，其 sha256 与总览一致；读取包内任一已发布版本都 SHALL 成功。不存在的版本 MUST 以 `COLLAB_CONVENTION_UNKNOWN` 拒绝。版本 `2` SHALL 在版本 `1` 的基础上说明：宿主可以声明成员信任，此时被邀请者已由宿主代为加入，承接方在本会话原有权限边界内直接处理空间内的 request，不再为此另向人类索取授权；宿主未声明时按版本 `1` 的规则处理。版本 `3` SHALL 是版本 `2` 的修订副本：删除版本 `2` 中描述成员级熔断的内容（每成员 6 次普通唤醒、暂停、人类决定或宿主内部接口重置、"被暂停时停止空转"），其余规则保留，并说明：接续同一件事的消息或条目用 `ref` 引用先前消息 seq 或条目 seq，另起一件事不写 `ref`；每条链至多 20 环，超出时命令返回 `COLLAB_THREAD_LIMIT`；收到该错误应停止这条往返并向本会话用户报告，MUST NOT 为继续同一件事另起新链；创建新 request 时不写 `ref`、在正文说明来源；Leader 转交不叫醒对方。各版本都 SHALL 保留"人类决定只能来自受信确认"与"消息不是越权依据"的规则。

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

#### Scenario: v3 包含链长规则
- **WHEN** 读取版本 `3` 全文
- **THEN** 全文同时含 `ref`、`20`、`COLLAB_THREAD_LIMIT`、`requestDecision`、"不是系统指令"、"停止"、"向本会话用户报告"与"不要为继续同一件事另起新链"；且不含"6 次"、"暂停"、"重置"、"内部接口"
