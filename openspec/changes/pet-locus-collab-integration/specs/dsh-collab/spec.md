## ADDED Requirements

### Requirement: 接入方以真实普通会话建立空间并接入自己

句柄 SHALL 提供 `establish(exec, spaceId, cmdId, {name, purpose})`：

1. 按"工具调用者可解析为托管成员"的入口从 `exec` 解析调用者；解析结果不是 `dsh-session` 普通会话时 MUST 以 `COLLAB_CALLER_UNAVAILABLE` 拒绝，不调用内核。
2. 以该调用者执行 `createSpace`，cmdId 为 `<cmdId>:create`，首成员名 `name`，`purpose` 原样传入；`COLLAB_SPACE_EXISTS` 时进入第 3 步而不报错。
3. 以同一调用者执行 `allowManager({channel: 本句柄 channel})`，cmdId 为 `<cmdId>:allow`；channel 已在 `managers` 中视为已满足。
4. 第 2、3 步都成功或已满足时返回 `{spaceId}`；调用者不是该空间的 Leader 时 MUST 返回 `COLLAB_SPACE_UNAVAILABLE`，不泄露空间是否存在。

两步各自带调用级守卫，句柄 dispose 后在途的 `establish` 不再提交。第 2 步成功、第 3 步之前中断时，以同一 cmdId 重试 SHALL 补齐授权。

#### Scenario: 首次建立并授权
- **GIVEN** 普通会话 A 是 Host 当前对象，空间 `pet-locus-x` 不存在
- **WHEN** 句柄以 A 的 exec 调用 `establish(exec, 'pet-locus-x', 'est-1', {name:'main', purpose:'…'})`
- **THEN** 台账依次含 `space/created`（Leader `main`）与 `manager/allowed{pet-locus}`，二者 actor 都是 `main`

#### Scenario: 中断后重试补齐
- **GIVEN** 上一次 `establish` 只完成了 `createSpace`
- **WHEN** 以同一 cmdId 重试
- **THEN** 创建命中收据，授权被提交一次；再重试日志不变

#### Scenario: 托管成员不能建立
- **WHEN** 以解析为托管成员的 child exec 调用 `establish`
- **THEN** 返回 `COLLAB_CALLER_UNAVAILABLE`，内核未收到命令

#### Scenario: 非 Leader 不能借此授权
- **GIVEN** 空间 S 已由 B 建立，A 不是其成员
- **WHEN** 句柄以 A 的 exec 调用 `establish(exec, 'S', …)`
- **THEN** 返回 `COLLAB_SPACE_UNAVAILABLE`，S 的日志不变

### Requirement: 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间

接入方 `resolveCaller` 返回的 `stamp` SHALL 是规范 JSON 不超过 1024 字节的普通对象；不满足时该解析结果视为 `undefined`。戳在入口随地址一起捕获，调用级守卫 SHALL 要求地址与戳的规范 JSON 都不变。接入方 adapter MAY 提供同步方法 `visible(stamp, subject): boolean`，`subject` 为 `{kind:'item', item}`、`{kind:'message', message}` 或 `{kind:'statusText', name}`；抛错视为不可见。以下规则只对"带戳的托管调用者"生效；普通调用者与无戳托管调用者不受影响。

**写入盖戳**：`collab_create_item` 与 `collab_send_message` SHALL 把戳作为 `ext` 交给内核；工具仍 MUST NOT 接受模型传入的 `ext`。

**cmdId 命名空间**：插件 SHALL 把每个写命令的 cmdId 改写为 `<sha256(规范 JSON(stamp)) 的前 16 位十六进制>:<原 cmdId>` 后交给内核。模型 MUST NOT 能指定或看到该前缀。

**写目标授权**：接入方提供 `visible` 时，带戳调用者只能改自己的记录：`collab_revise_item`、`collab_ack_item`、`collab_advance_request` 的目标条目 `ext` MUST 等于调用者的戳（普通成员写的条目对带戳调用者只读，即使其 `requiredAcks` 或 `assignee` 含该托管成员名）；`collab_create_item`、`collab_send_message` 的 `ref` 所指记录 MUST 是带相同戳的记录，或作者为普通成员、`to` 为该托管成员名、且接入方 `visible` 判定为可见的消息；MUST NOT 允许 ref 普通成员写的条目。不满足时条目类以 `COLLAB_ITEM_NOT_FOUND`、ref 以 `COLLAB_BAD_REF` 拒绝，不调用内核，MUST NOT 泄露 revision 或存在性。该检查 SHALL 在入口执行并随调用级守卫在提交前重验；收据重放路径同样经过该检查。`collab_send_message` 的 `to` 对带戳调用者 SHALL 只允许接入方声明的收件人集合（本变更中 Pet 声明为 `['main']`）；其它取值以 `COLLAB_BAD_RECIPIENT` 拒绝，不调用内核。

**读取为可见投影**：接入方提供 `visible` 时，插件 SHALL 先用完整日志重放内核状态，再对返回值投影，MUST NOT 以删除提交记录的方式过滤。投影 SHALL 挡住正常读取中兄弟的正文与状态；MUST NOT 被表述为防止有意配合的托管调用者借存在性、计数或错误码传递信息。
- `collab_read overview`：按白名单输出，SHALL 恰含 `spaceId`、`serviceId`、`status`、`leader`、`convention`、`purpose`、`lastSeq`、`members`、`items`、`messages`、`deliveries`、`pendingDeliveries`、`inFlightDeliveries`、`presence`，MUST NOT 含 `itemSeq`、`topicOf`、`topicWakes` 或任何其它派生索引；`members[*]` 只输出 `name`、`kind`、`status`、`binding.channel`、`managedBy`、`statusText`，MUST NOT 含 `wakeCount`、`joinSeq` 或地址；`statusText` 对不可见者置为空字符串；`items`、`messages` 只保留可见主体；三个投递列表只保留唤醒源可见的；`lastSeq` 原样。
- `collab_read since`：每条提交记录保留 `seq` 与 `at`，`events` 经过滤：业务事件按主体可见性保留，`dispatch/*` 只在其唤醒源可见时保留，`member/statusText` 只在可见时保留，其余结构事件保留；过滤后 `events` 为空的记录仍输出且 `events` 为 `[]`；不输出 `receipt`。
- `collab_status`：`pending.*` 与 `next` 按投影后的条目与消息推导，且 SHALL 只列出带戳调用者按写目标授权能执行的动作：普通成员写的条目即使 `requiredAcks` 或 `assignee` 含该托管成员名，也 MUST NOT 产生 `ack` 或 `advance_request` 项。
- `convention` 读取不投影。

#### Scenario: 托管调用者写入带戳且 cmdId 带命名空间
- **GIVEN** L 解析为 `{address:'pet:s1', stamp:{pet:{locusId:'a'}}}`
- **WHEN** L 以 `cmdId:'c-1'` 调用 `collab_create_item` 创建 request `todo-1`
- **THEN** `item/created` 的 `ext` 为 `{pet:{locusId:'a'}}`；收据的 cmdId 以 `sha256` 前缀开头并以 `:c-1` 结尾；L 的调用参数中不含 `ext`

#### Scenario: 不同戳的同名 cmdId 互不干扰
- **GIVEN** A（戳 a）与 B（戳 b）都解析到地址 `pet:s1`
- **WHEN** A 以 `cmdId:'s-1'` 调用 `collab_set_status('x')`，B 以 `cmdId:'s-1'` 调用 `collab_set_status('y')`，随后 A 以相同参数重试
- **THEN** 两次 `set_status` 都提交，B 的调用不返回 A 的 seq 也不返回 `COLLAB_CMD_CONFLICT`；A 的重试返回 A 的原 seq，日志长度不变

#### Scenario: 兄弟条目对读取不可见
- **GIVEN** 空间 S 中有 `main` 写的条目 I0、戳 a 写的条目 Ia、戳 b 写的条目 Ib；`visible` 只对作者为 `main` 或 `ext.pet.locusId` 等于戳的主体返回真
- **WHEN** 戳 a 的 L 调用 `collab_read overview`、`collab_read since 0` 与 `collab_status`
- **THEN** 三者都含 I0 与 Ia、不含 Ib；`since` 中创建 Ib 的记录 `events` 为 `[]` 且 seq 保留；`collab_status` 的 `pending` 不因 Ib 产生任何项；`main` 的同样读取得到全部三条

#### Scenario: 公开记录引用隐藏记录仍能重放
- **GIVEN** 戳 b 创建条目 Ib（seq 3，不唤醒）；`main` 创建条目 I0，`ref: 3`
- **WHEN** 戳 a 的 L 调用 `collab_read overview` 与 `collab_status`
- **THEN** 两者成功返回，含 I0、不含 Ib；没有 `dangling ref` 类错误

#### Scenario: 同一提交中的 dispatch 不泄露兄弟消息
- **GIVEN** 戳 b 向在线的 `main` 发 `needsReply` 消息，其 `message/sent` 与 `dispatch/intended` 在同一提交
- **WHEN** 戳 a 的 L 调用 `collab_read since 0`
- **THEN** 该提交记录输出为 `events: []`；`overview` 的 `pendingDeliveries`/`inFlightDeliveries` 不含该投递

#### Scenario: 状态文本不能传话
- **GIVEN** 戳 a 的 L 调用 `collab_set_status('给 B 的话')`；`visible({kind:'statusText', name:'pet'})` 为假
- **WHEN** 戳 b 的 M 调用 `collab_read overview` 与 `since`
- **THEN** `overview.members.pet.statusText` 为空字符串；`since` 中该 `member/statusText` 事件被过滤

#### Scenario: 隐藏条目的标识不经任何字段泄露
- **GIVEN** 戳 b 创建条目，`itemId` 为 `zq7-secret-marker`
- **WHEN** 戳 a 的 L 调用 `collab_read overview` 与 `collab_status`，对两者的返回值做完整 JSON 序列化
- **THEN** 两个序列化字符串都不含 `zq7-secret-marker`；`overview` 的顶层键恰为白名单所列；`main` 的 `overview.itemSeq` 含该 id

#### Scenario: 不能借主会话的公开条目传话
- **GIVEN** `main` 创建条目 I0（无 requiredAcks）；戳 a 与戳 b 都能读到 I0
- **WHEN** 戳 a 的 L 调用 `collab_revise_item(I0, expectedRevision: 1, body: '给 B 的话')`
- **THEN** 返回 `COLLAB_ITEM_NOT_FOUND`，内核未收到命令，日志字节不变；戳 b 读到的 I0 正文仍是原文

#### Scenario: 可以修订自己的条目
- **GIVEN** 戳 a 创建条目 Ia（revision 1）
- **WHEN** 戳 a 的 L 以正确 revision 调用 `collab_revise_item(Ia)`
- **THEN** 修订成功，`item/revised` 的 `item.ext` 仍为戳 a

#### Scenario: 主会话的条目对子会话只读
- **GIVEN** `main` 创建 `requiredAcks:['pet']` 的条目 I1 与 `assignee:'pet'` 的 request R1；戳 b 能读到两者
- **WHEN** 戳 a 的 L 分别 `collab_ack_item(I1, 1)`、`collab_advance_request(R1, 'accepted')`、带 `ref` 指向 I1 创建 seq 的 `collab_send_message(to:'main')`
- **THEN** 前两者返回 `COLLAB_ITEM_NOT_FOUND`，第三者返回 `COLLAB_BAD_REF`；内核未收到命令，日志字节不变；戳 b 读到的 I1、R1 状态不变；戳 a 与戳 b 的 `collab_status` 的 `pending.acks`、`pending.requests` 都不含 I1、R1，`next` 不含对应建议

#### Scenario: 可以引用主会话发给自己的消息
- **GIVEN** `main` 向 `pet` 发消息 M（seq 9），接入方路由其目标为戳 a
- **WHEN** 戳 a 的 L 调用 `collab_send_message(to:'main', ref: 9, needsReply: true)`；戳 b 的 M2 调用同样的命令
- **THEN** 前者成功；后者返回 `COLLAB_BAD_REF`，内核未收到命令

#### Scenario: 不同 Locus 新开独立话题不继承其它根的额度
- **GIVEN** 戳 a 在自己的话题里连续发了 20 条被唤醒的 `needsReply` 消息，第 21 条被 `COLLAB_THREAD_LIMIT` 拒绝
- **WHEN** 戳 b 向 `main` 发第一条无 `ref` 的 `needsReply` 消息
- **THEN** 成功，不受 a 的额度影响

#### Scenario: 成员计数不进投影
- **GIVEN** 戳 b 向在线的 `main` 发 `needsReply` 消息，`main` 的内核 `wakeCount` 加一
- **WHEN** 戳 a 的 L 调用 `collab_read overview`
- **THEN** `members.main` 的键恰为 `name`、`kind`、`status`、`binding`、`statusText`（`binding` 只含 `channel`），不含 `wakeCount`；`main` 的同样读取含 `wakeCount`

#### Scenario: 不能修改、确认或引用兄弟条目
- **GIVEN** 戳 b 创建条目 Ib（revision 1）
- **WHEN** 戳 a 的 L 分别调用 `collab_revise_item(Ib, expectedRevision: 5)`、`collab_ack_item(Ib, 1)`、`collab_advance_request(Ib)`，以及带 `ref` 指向 Ib 创建 seq 的 `collab_create_item`
- **THEN** 前三者返回 `COLLAB_ITEM_NOT_FOUND`，不含 `currentRevision`；最后一个返回 `COLLAB_BAD_REF`；内核未收到任何命令，日志字节不变

#### Scenario: 无权调用者拿不到旧收据
- **GIVEN** 戳 b 以 `cmdId:'r-1'` 修订了自己的条目 Ib
- **WHEN** 戳 a 的 L 以 `cmdId:'r-1'` 与相同参数调用 `collab_revise_item(Ib)`
- **THEN** 返回 `COLLAB_ITEM_NOT_FOUND`，不返回 b 的结果

#### Scenario: 带戳调用者只能发给 main
- **WHEN** 戳 a 的 L 调用 `collab_send_message` 且 `to` 为 `pet` 或任何非 `main` 的值
- **THEN** 返回 `COLLAB_BAD_RECIPIENT`，内核未收到命令

#### Scenario: 戳在途变化时调用失效
- **GIVEN** L 以戳 a 通过入口，其 `collab_send_message` 停在内核的 presence 采样
- **WHEN** 接入方此时把 L 解析为戳 b，随后释放采样
- **THEN** 调用返回 `COLLAB_CALLER_UNAVAILABLE`，日志字节不变

#### Scenario: 超长或非对象的戳视为未解析
- **WHEN** 接入方为 L 返回 1025 字节的戳，或戳为数组
- **THEN** L 调用任一协作工具返回 `COLLAB_CALLER_UNAVAILABLE`

#### Scenario: 不提供 visible 时不投影也不做写授权
- **GIVEN** 接入方未实现 `visible`
- **WHEN** 托管调用者 `collab_read since 0` 并修订任意条目
- **THEN** 返回全部记录；修订按内核规则执行

## MODIFIED Requirements

### Requirement: 接入方经句柄托管成员

句柄 SHALL 提供 `admit(spaceId, cmdId, {name, address})`、`rebind(spaceId, cmdId, {member, address})` 与 `retire(spaceId, cmdId, {member})`。它们以该中继 provider 的 manager principal 调用内核同名命令，返回内核结果。错误按"错误披露不泄露无权空间"映射。

每次调用 SHALL 携带一个守卫。守卫捕获本句柄的接入代际，只在该代际仍是当前代际时返回真；对 `admit` 与 `rebind`，还要求 adapter 的同步方法 `holds(address)` 对新地址返回真。因此句柄 dispose 后，它发起的、仍在途的托管命令不会提交。

内核以 `COLLAB_CALLER_STALE` 拒绝时，句柄按守卫记录的失败原因映射错误：接入代际已变返回 `COLLAB_CHANNEL_DETACHED`，新地址不再被持有返回 `COLLAB_ADDRESS_UNCLAIMED`。

句柄 SHALL 另提供 `disposeRequest(spaceId, cmdId, {itemId, progress})`，以 manager principal 调用内核 `disposeManagedRequest`，守卫只检查接入代际；以及 `readManaged(spaceId)`：以宿主既有的 `internal{purpose:'host-index'}` 读取该空间全部提交记录，推导状态后要求本句柄 channel 在 `managers` 中，否则与空间不存在、存储失败一样返回 `COLLAB_SPACE_UNAVAILABLE`；返回前检查接入代际，结果为深拷贝。内核读取授权不因此改变。

句柄 MUST NOT 提供 `revokeManager`、`invite`、`markGone`、`transferLeader` 或 `closeSpace`。`allowManager` 只能经 `establish` 以真实普通会话调用者的身份、且只为本句柄 channel 执行（见"接入方以真实普通会话建立空间并接入自己"）；接入方不能凭自身身份授权自己。

#### Scenario: Leader 授权后接入方接纳成员
- **GIVEN** 会话 A 是空间 S 的 Leader，A 以 `collab_space` 的 `allow_manager` 授权 `pet-locus`
- **WHEN** 接入方句柄以 `cmdId:'adm-1'` 接纳 `locus-a`（地址 `loc:1`），再以相同参数重试
- **THEN** 两次返回同一 seq；台账含 `manager/allowed` 与 actor 为 `manager:pet-locus` 的 `member/joined`；无唤醒

#### Scenario: 未授权空间的响应完全一致
- **GIVEN** `pet-locus` 未获下列空间授权：S1 健康、S2 已关闭、S3 被锁、S4 日志损坏、S5 运行期提交失败、S6 不存在
- **WHEN** 句柄对每个空间各调用一次 `admit`
- **THEN** 六个响应序列化后完全相同，都是 `{"error":{"code":"COLLAB_SPACE_UNAVAILABLE"}}`；各空间日志字节都不变

#### Scenario: 旧句柄的在途托管命令不提交
- **GIVEN** 句柄 H1 调用 `admit`，其认领被挂起
- **WHEN** H1 dispose，同 channel 重新 attach 得到 H2，随后释放认领
- **THEN** H1 的 `admit` 返回 `COLLAB_CHANNEL_DETACHED`，日志字节不变；H2 以同一 cmdId 与载荷调用 `admit` 成功

#### Scenario: 认领后、提交前地址被撤回
- **GIVEN** 句柄的 `admit` 已认领 `loc:3`
- **WHEN** 进入事务前 adapter 的 `holds('loc:3')` 变为假
- **THEN** 返回 `COLLAB_ADDRESS_UNCLAIMED`，日志字节不变

#### Scenario: 句柄没有 Leader 能力
- **WHEN** 检查句柄对象的方法集合
- **THEN** 恰含 `admit`、`rebind`、`retire`、`disposeRequest`、`readManaged`、`establish`、`command`、`read`、`registerSessionMode` 与 `dispose`

#### Scenario: 托管读取只对已授权空间可用
- **GIVEN** 空间 S 已授权 `pet-locus`，空间 T 未授权，空间 U 不存在
- **WHEN** 句柄分别调用 `readManaged('S')`、`readManaged('T')`、`readManaged('U')`
- **THEN** S 返回其全部提交记录；T 与 U 的响应序列化后相同，均为 `{"error":{"code":"COLLAB_SPACE_UNAVAILABLE"}}`；各日志字节不变

### Requirement: 工具调用者可解析为托管成员

接入方 adapter SHALL 提供同步方法 `resolveCaller(agent)`。它只在该 agent 是接入方当前绑定的成员会话时返回地址，否则返回 `undefined`；抛错视为 `undefined`。返回值 SHALL 为字符串地址，或 `{address, stamp?}`：`stamp` 是接入方从执行会话派生的戳（见"托管调用者的戳与读取过滤"），多个 agent 可以解析到同一地址而戳不同。

协作工具解析调用者时，SHALL 先满足既有的执行会话条件：执行 agent 存在、是 Host 当前对象、`agent.id === agent.session.id`、未归档、不在 `denySessionIds` 中。随后：

1. 若会话是普通一级会话，且满足 `admission` 的现有条件，调用者为 `{channel:'dsh-session', address:<session ID>}`。
2. 否则询问当前全部接入方。恰有一个返回地址时，调用者为 `{channel:<该 channel>, address:<地址>}`。`allowlist` 模式不约束托管调用者：它们的准入由 Leader 授权与接入方绑定共同决定。
3. 以下情况 MUST 以 `COLLAB_CALLER_UNAVAILABLE` 拒绝：普通会话同时被任一接入方认领；多个接入方认领同一会话；没有任何一方认领。

解析结果 SHALL 每次调用重新计算，MUST NOT 缓存。

在途调用同样要防住。每次工具调用与句柄调用，插件 SHALL 在入口创建一个调用级守卫，并随命令或读取交给内核（见内核"调用级守卫在提交与读取边界重验"）。守卫捕获入口时的执行 agent 对象、解析出的 `{channel, address}`，以及托管调用者所属句柄的接入代际（每次 `attach` 递增）。被调用时，它同步重新执行入口的全部条件：

- 该 agent 对象仍是 Host 当前对象，且 `agent.id === agent.session.id`；
- 未归档，不在 `denySessionIds` 中；
- 普通会话仍满足 `admission`，且不被任何接入方认领；
- 托管调用者的接入代际仍是当前代际，且 `resolveCaller` 对该 agent 仍返回同一地址。

任一不满足即返回假。因此，以下任一情况发生时，已在途的调用也不能完成，即使台账尚未退役该成员：接入方解除绑定、Host 换了 agent 对象、会话被归档、句柄 dispose 后又重新 attach。

- 内核的 `COLLAB_CALLER_STALE` SHALL 映射为 `COLLAB_CALLER_UNAVAILABLE`；`COLLAB_BINDING_CHANGED` 原样返回，表示可用原 cmdId 重试。
- `collab_status` 只经 host-index 读取，所以 SHALL 在最后一个 await 之后、返回之前自行调用同一守卫，返回假时输出 `COLLAB_CALLER_UNAVAILABLE`。
- `resolveCaller` 必须基于接入方已异步核验过的内存投影，不能靠省略核验来满足同步接口。

#### Scenario: 受管子会话以托管成员身份写入
- **GIVEN** 子会话 L（subagent，delegationDepth 1）被 `pet-locus` 接入方解析为 `loc:1`；`loc:1` 是空间 S 的托管成员 `locus-a`
- **WHEN** L 调用 `collab_send_message` 给 `aily`
- **THEN** 提交的 actor 为 `locus-a`

#### Scenario: 解除绑定后立即失去身份
- **GIVEN** 承上，接入方随后对 L 的 `resolveCaller` 返回 `undefined`，台账中 `locus-a` 仍为 active
- **WHEN** L 调用 `collab_read`
- **THEN** 返回 `COLLAB_CALLER_UNAVAILABLE`，不返回空间内容

#### Scenario: 在途调用在失效后不能完成
- **GIVEN** L（agent 对象 A）已通过入口，被解析为 `locus-a`（`loc:1`）；它的 `collab_send_message` 与另一次 `collab_read` 都停在内核的 presence 采样
- **WHEN** 分别在四次独立运行中，于采样挂起期间：
  1. 接入方让 `resolveCaller(A)` 返回 `undefined`；
  2. Host 把该会话的当前 agent 对象换成 A′，接入方对 A′ 仍返回 `loc:1`；
  3. 归档该会话；
  4. 句柄 dispose 后，同 channel 重新 attach，新 adapter 对 A 仍返回 `loc:1`。
  每次之后释放采样
- **THEN** 四次运行中，发送都返回 `{"error":{"code":"COLLAB_CALLER_UNAVAILABLE"}}`，日志字节不变、无投递；读取返回同一错误、不含空间数据。第 2、4 种情况下，随后由 A′ 或新句柄发起的新调用成功

#### Scenario: 状态入口在返回前重验
- **GIVEN** L 的 `collab_status` 停在 host-index 读取
- **WHEN** 期间句柄 dispose 后重新 attach
- **THEN** 返回 `{"error":{"code":"COLLAB_CALLER_UNAVAILABLE"}}`，不含空间列表

#### Scenario: 普通会话不能被接入方冒认
- **GIVEN** 普通一级会话 A，接入方的 `resolveCaller` 对 A 返回 `loc:9`
- **WHEN** A 调用任一协作工具
- **THEN** 返回 `COLLAB_CALLER_UNAVAILABLE`

#### Scenario: 排除名单与归档对托管调用者同样生效
- **GIVEN** 子会话 L 能被接入方解析，但已被归档或位于 `denySessionIds`
- **WHEN** L 调用协作工具
- **THEN** 返回 `COLLAB_CALLER_UNAVAILABLE`，`resolveCaller` 调用次数为 0

#### Scenario: 未被认领的子会话仍被拒绝
- **GIVEN** 有接入方，但它对子会话 M 返回 `undefined`
- **WHEN** M 调用协作工具
- **THEN** 返回 `COLLAB_CALLER_UNAVAILABLE`，日志字节不变

#### Scenario: 托管调用者的状态入口
- **GIVEN** `locus-a`（地址 `loc:1`）是空间 S 的 active 托管成员，有一条发给它的需回复消息；种子名单含会话 D
- **WHEN** L 调用 `collab_status`
- **THEN** S 出现在 `spaces` 中，`self` 为 `locus-a`；`pending.replies` 含该消息
