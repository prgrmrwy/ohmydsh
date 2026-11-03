## ADDED Requirements

### Requirement: 按 relay-contract 接入、对账注册与降级

shim SHALL 只经 cockpit 设备侧插件提供的进程内服务 `cockpitRelay`（relay-contract revision 4 即契约 v3，及其补充 `relay-contract-addendum-1`、`relay-contract-addendum-2`）耦合：只读属性 `contractVersion`、`state()`、`directory()`、`subscribe(listener)`、`send(envelope)`、`receive(handler)`。shim MUST NOT 自行生成本机 runtimeId，只读 `state().runtimeId`。服务不存在、`contractVersion` 不等于 1（每次 `subscribe` 回调时重新检查）、`receive` 注册失败（`consumer-exists`）或 `state().connected` 为 false 时，shim SHALL 不注册任何远端 runtime，并 `dispose` 已有注册。

每次 `subscribe` 回调，shim SHALL 按最新目录快照对账：`presence:'reachable'` 的 runtime 若未注册则调用内核 `register` 并保存 `dispose` 句柄；`presence:'unreachable'` 的 runtime 调用 `dispose`；从快照中消失的 runtime 仅在快照顶层 `truncated` 为 false 时调用 `dispose`（顶层 `truncated:true` 的快照不完整，消失不代表删除，见 `relay-contract-addendum-2`）；由不可达恢复为可达时重新 `register`（generation 递增）。以下条目 MUST NOT 注册：runtimeId 等于本机 `state().runtimeId`、等于保留值 `local`、或不匹配 `^[a-z0-9][a-z0-9-]{0,63}$`（fail closed，不做映射）。本机 runtimeId 改变（重新握手）或快照 `revision` 小于上次已处理值（cockpit 重启）时，shim SHALL `dispose` 全部远端注册并按新快照重建。shim 只用快照中的 runtimeId 与 presence；session 条目只用于远端 `sessions()`，MUST NOT 经任何工具输出。

#### Scenario: 握手后对账注册
- **GIVEN** `cockpitRelay` 替身 `state()` 为 `{connected:true, runtimeId:'dev-a'}`，快照含 `dev-a`、`dev-b`、`local`、`Dev_X`（均 reachable）以及 unreachable 的 `dev-c`
- **WHEN** shim 启动并处理该快照
- **THEN** 内核 `list()` 严格等于 `['local','dev-b']`

#### Scenario: 服务缺失、未连接或处理器被占
- **GIVEN** 情形一无 `cockpitRelay` 服务；情形二 `state().connected` 为 false；情形三 `receive` 抛 `consumer-exists`；情形四 `contractVersion` 为 2
- **WHEN** shim 启动并收到含 reachable `dev-b` 的快照
- **THEN** 四种情形下 `list()` 都为 `['local']`，替身 `send` 调用次数为 0

#### Scenario: 截断快照中消失不注销
- **GIVEN** 已注册 `dev-b`，已处理快照 revision 5
- **WHEN** 收到顶层 `truncated:true`、不含 `dev-b` 的 revision 6，再收到顶层 `truncated:false`、不含 `dev-b` 的 revision 7
- **THEN** revision 6 后 `list()` 仍含 `dev-b` 且 generation 不变；revision 7 后不含 `dev-b`

#### Scenario: shim 卸载与版本变化
- **GIVEN** 已注册 `dev-b`，有一个等待中的 call
- **WHEN** shim 整体 dispose；之后重新加载 shim，`contractVersion` 先为 2、再恢复为 1 并收到含 reachable `dev-b` 的快照
- **THEN** dispose 后 `list()` 为 `['local']`、等待中的 call 以 `unavailable` 结束、`receive` 与 `subscribe` 的 disposer 各被调用一次；版本为 2 时不注册；恢复为 1 后 `dev-b` 以新 generation 注册，替身 `send` 未收到任何重试信封

#### Scenario: 离线、恢复、删除与 cockpit 重启
- **GIVEN** 已注册 `dev-b`（generation 1），已处理快照 revision 5
- **WHEN** 依次收到 `dev-b` unreachable（revision 6）、reachable（revision 7）、从快照删除（revision 8）、以及 revision 1 且含 reachable `dev-b` 的快照
- **THEN** revision 6 后 `list()` 不含 `dev-b`；revision 7 后含且 generation 为 2；revision 8 后不含；revision 1 后含且 generation 为 3

### Requirement: 信封编码与带类型的标识改写

shim SHALL 把 `Connection` 的 `claim`/`wake`/`call` 编码为信封 `{msgId, target, kind, body}`，经 `cockpitRelay.send` 发出；`msgId` 由 shim 生成，MUST 为 1–96 个 `[A-Za-z0-9._-]` 且全局唯一（不含 `:`）；来源字段由 cockpit 盖章，shim 不填。标识改写 SHALL 只作用于下列具名字段，MUST NOT 触及消息正文、条目标题/正文、`ext`、`cmdId` 及其它自由文本：

| 字段 | 出站 | 入站 |
|------|------|------|
| wake 指针 `pointer.spaceId`（裸 id） | → `<id>@<本机deviceId>` | `<id>@<本机deviceId>` → 裸 `<id>`；其它 runtime 保持 |
| call 的 `spaceId` | 远端引用 `<id>@<target>` → 裸 `<id>` | 原样（owner 视角的裸 id） |
| invite `recipientSessionId` | `local/<s>` → `<本机deviceId>/<s>` | `<本机deviceId>/<s>` → self 的 `<s>`；其它 runtime 保持 |
| `joinConsent.spaceRef` | 裸 `<id>` → `<id>@<本机deviceId>` | 原样 |

入站解码后，若任何身份或地址字段解析出的 runtime 为 `local`，信封 MUST 被拒绝。

#### Scenario: 只改写具名字段
- **GIVEN** 本机 deviceId 为 `dev-a`
- **WHEN** 编码一个发往 `dev-b` 的 wake，指针 `spaceId:'s'`，同时编码一个 sendMessage call，其消息正文为 `see s@local and local/x`
- **THEN** wake body 中指针 `spaceId` 为 `s@dev-a`；call body 中消息正文与原文字节相等；`cmdId` 不变

#### Scenario: 入站伪造 local
- **WHEN** 收到来源 `dev-b` 的 invite call，`recipientSessionId:'local/s1'`
- **THEN** reply `{error:{code:'COLLAB_BAD_ARGUMENTS'}}`，内核调用次数为 0

### Requirement: reply 关联、超时与体积

每个出站 claim/wake/call SHALL 等待至多一条 reply。pending 表 SHALL 以原 msgId 为键并绑定目标 runtimeId、信封 kind 与发送时的 generation；只有满足以下之一的入站 `kind:'reply'` 才被接受：来源等于原目标 runtime、`inReplyTo` 等于原 msgId 且该 runtime 的 generation 未变；或 `relay === true`、`inReplyTo` 等于原 msgId 且 body 为 `{undeliverable: reason}` 的中继回执（cockpit 转发设备信封时删除 `relay` 字段，对端 shim 无法伪造）。其它 reply（来源不符、重复、迟到、旧 generation）SHALL 被丢弃且不改变任何状态。claim、wake、call 的超时默认 30 秒，status 用途的 call 默认 5 秒；超时、中继回执、`dispose`/替换 SHALL 释放 pending 并使对应 `Connection` 方法以 `TransportError{kind:'unavailable'}` 结束；对端 reply 的 `{error:{code}}` SHALL 映射为 `TransportError{kind:'rejected', code}`。`send` 同步抛出 `not-connected`/`outbox-full` 映射为 `unavailable`；`body-too-large` 或本地 UTF-8 序列化超过 1 MiB 映射为确定的超限错误（dsh-collab 映射为 `COLLAB_PAYLOAD_TOO_LARGE`）；入站 call 的结果超限则改发 `{error:{code:'COLLAB_PAYLOAD_TOO_LARGE'}}`。

#### Scenario: 正确来源的 reply 被接受
- **GIVEN** 向 `dev-b` 发出 call（msgId `m1`）
- **WHEN** 来源 `dev-b` 的 reply `inReplyTo:'m1'`、body `{result:{seq:9}}` 到达
- **THEN** call 解析为 `{seq:9}`

#### Scenario: 伪造来源、迟到与中继回执
- **GIVEN** 向 `dev-b` 发出 call `m1` 与 `m2`
- **WHEN** 来源 `dev-c` 的 reply `inReplyTo:'m1'` 先到；`m1` 超过 30 秒后来源 `dev-b` 的 reply 到达；来源 `dev-b`、无 `relay` 字段、`inReplyTo:'m2'`、body `{undeliverable:'busy'}` 的 reply 到达；随后 `relay:true`、`inReplyTo:'m2'`、body `{undeliverable:'no-consumer'}` 的回执到达
- **THEN** `m1` 以 `unavailable` 结束且两条 `m1` reply 都被丢弃；无 `relay` 的那条不改变 `m2` 状态；`m2` 只在 `relay:true` 回执到达后以 `unavailable` 结束；pending 表为空

#### Scenario: wake 无回执时超时失败
- **GIVEN** `dev-b` 保持 reachable，但永不回 reply
- **WHEN** 发出 wake 并推进测试时钟 30 秒
- **THEN** wake 以 `unavailable` 结束（内核记一次 `dispatch/completed failed`），pending 表为空，之后到达的 reply 被丢弃

#### Scenario: 超限请求不发送
- **WHEN** 编码 body 为 1 MiB + 1 字节（UTF-8，含多字节字符）的 call
- **THEN** 替身 `send` 调用次数为 0，调用以确定的超限错误结束

### Requirement: 入站执行与来源校验

shim SHALL 以 `cockpitRelay.receive` 注册唯一入站处理器，把入站 claim/wake/call 交给 dsh-collab 的入站处理，来源只取信封的 cockpit 盖章 `origin`。origin 等于本机 runtimeId、为 `local`、或当前未注册（含不可达与不合规）时 MUST 回 `{error:{code:'COLLAB_CALLER_UNAVAILABLE'}}` 且不执行。入站处理 SHALL 在收到时记录来源当前 generation，并作为 owner guard 的比较基准（见 dsh-collab"远端调用身份由来源 Host 担保"）。重复投递的抑制只依赖插件"同 (origin,msgId) 10 分钟内只调用一次"的保证；shim MUST NOT 缓存或重放已完成的 reply，每次进入处理器的信封都重新经过当前准入与 guard。超出插件去重窗口的重复 SHALL 重新执行：写命令由 owner 的 cmdId 收据保证幂等，wake 可能重复唤醒，这是已接受的代价。每个进入处理器的 claim/wake/call SHALL 恰回一条 reply。

#### Scenario: 每次入站都重新判定授权
- **GIVEN** `bob` 绑定 `runtime-session:dev-b/s2`；来源 `dev-b` 的 read call（msgId `m1`）已执行并回 ok
- **WHEN** `bob` 被 Leader 标记 gone，`dev-b` 断开后恢复（generation 2），插件在去重窗口外再次交付同一信封 `m1`
- **THEN** 处理器再次执行，reply 为安全错误码，不含空间内容

#### Scenario: 伪造来源
- **WHEN** 收到 origin 为本机 `dev-a`、为 `local`、以及为未注册 `dev-z` 的 call 各一条
- **THEN** 三条 reply 都是 `COLLAB_CALLER_UNAVAILABLE`，dsh-collab 入站处理调用次数为 0

#### Scenario: 窗口外重复写命令幂等
- **GIVEN** 来源 `dev-b` 的 sendMessage call（cmdId `c1`）已执行
- **WHEN** 去重窗口外插件再次交付同一信封
- **THEN** 处理器再次执行并返回原收据结果；owner 日志只有一条该 cmdId 的 `message/sent`
