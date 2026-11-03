## ADDED Requirements

### Requirement: runtime 注册表与连接 SPI

内核 SHALL 提供 runtime 注册表：`register(runtime)` 返回仅能由注册方调用的 `dispose()` 句柄；`list()`；`connect(runtimeId)` 返回 `Connection { generation, sessions(), claim(sessionId, kind), wake(member, pointer), call(request) }`。`runtimeId` MUST 匹配 `^[a-z0-9][a-z0-9-]{0,63}$` 且 MUST NOT 等于保留值 `local`；违反时 `register` 抛出非 `CollabError` 的编程错误，注册表不变。注册表中恰有一个 self runtime，id 固定为 `local`，由宿主在内核构造时提供，不经 `register`。本机与远端 runtime 形状相同，内核只以 `runtimeId === 'local'` 区分，MUST NOT 依赖额外的 `local` 布尔字段。

同一 runtimeId 再次 `register` SHALL 替换旧注册并使 `generation` 递增；旧注册的 `dispose()` 在被替换后为空操作。`dispose()` 或替换发生时，内核 SHALL 使该 runtime 上一代所有未完成的 `Connection` 调用以传输失败（见"跨机错误分层"）结束。`connect` 未注册的 id SHALL 抛出 `TransportError{kind:'unavailable'}`。内核 MUST NOT 引用任何具体传输（如 cockpit）的名字或类型。

`runtime-session` 是内核保留的 channel：构造内核时传入 channel 为 `runtime-session` 的 `ChannelProvider` MUST 抛出非 `CollabError` 的编程错误。

#### Scenario: 注册、列出与连接
- **GIVEN** 测试传输注册 runtime `dev-b`，其 `sessions()` 返回 `[{sessionId:'s2'}]`
- **WHEN** 调用 `list()` 与 `connect('dev-b').sessions()`
- **THEN** `list()` 严格等于 `['local','dev-b']`；`sessions()` 严格等于 `[{sessionId:'s2'}]`；`connect('dev-b').generation` 为 1

#### Scenario: 非法与保留 id
- **WHEN** 分别以 `local`、`Dev_B`、65 个字符的 id 调用 `register`
- **THEN** 三次都抛出非 `CollabError` 错误，`list()` 仍为 `['local']`

#### Scenario: 替换注册使旧代调用失败
- **GIVEN** 已注册 `dev-b`（generation 1），一个 `call` 正在等待
- **WHEN** 同 id 再次 `register`
- **THEN** 等待中的 call 以 `TransportError{kind:'unavailable'}` 结束；`connect('dev-b').generation` 为 2；对旧句柄调用 `dispose()` 后 `list()` 仍含 `dev-b`

#### Scenario: 保留 channel 不能被 provider 占用
- **WHEN** 以一个 channel 为 `runtime-session` 的托管 provider 构造内核
- **THEN** 构造抛出非 `CollabError` 错误，未打开任何空间

#### Scenario: 注销后不可连接
- **GIVEN** 已注册 `dev-b`
- **WHEN** 调用其 `dispose()`，再 `connect('dev-b')`
- **THEN** `list()` 为 `['local']`，`connect` 抛出 `TransportError{kind:'unavailable'}`

### Requirement: 成员地址带 runtime 且兼容旧绑定

内核 SHALL 把成员地址统一解释为 `runtimeId/sessionId`。self 上的成员 SHALL 继续以 `{channel:'dsh-session', address:sessionId}` 写入日志（字节格式与本变更前相同），解释为 `local/sessionId`；远端成员 SHALL 以 `{channel:'runtime-session', address:'<runtimeId>/<sessionId>'}` 写入，其中 runtimeId 满足注册表的 id 规则（因而不为 `local`），sessionId 非空且不含 `/`。`runtime-session` 地址的 runtimeId 为 `local` 或不合规时 MUST 以 `COLLAB_BAD_CHANNEL` 拒绝。日志 MUST NOT 写入本机的传输层设备 id。地址唯一性检查 SHALL 在解释后的 `runtimeId/sessionId` 上进行。"远端成员"的唯一判别是：绑定 channel 为 `runtime-session` 且没有 `managedBy`。该判别 SHALL 统一用于地址解释、远端 principal 匹配、presence、投递方式检查、投递意图选择与实际 wake。本变更前日志中若存在 `managedBy` 非空、channel 为 `runtime-session` 的托管成员（旧配置曾允许该 channel），SHALL 照常重放、保持托管成员原有语义，但不是远端成员：MUST NOT 被任何远端 principal 匹配，不按远端地址规则校验或解释其 address，MUST NOT 经任何 `Connection` 投递；升级后已无该 channel 的 provider，其 presence 为 `unreachable`，不产生投递意图。

#### Scenario: 旧日志成员按 self 解释
- **GIVEN** 本变更前的日志含 active 成员 `bob`，绑定 `{channel:'dsh-session', address:'s1'}`
- **WHEN** 新内核加载该日志，principal `agent{dsh-session, s1}` 以新 cmdId 发送消息
- **THEN** 新提交的 `message/sent.actor` 为 `bob`；日志前 N 行（原有提交）字节不变

#### Scenario: 远端成员的写入形式
- **GIVEN** 测试传输注册 `dev-b` 并认领 `s2`
- **WHEN** Leader 邀请 `dev-b/s2` 为 `bob`
- **THEN** `member/invited.member.binding` 为 `{channel:'runtime-session', address:'dev-b/s2', ...}`

#### Scenario: 旧托管成员与远端身份不碰撞
- **GIVEN** 本变更前日志含托管成员 `locus-a`，`managedBy:'runtime-session'`，绑定 `runtime-session:dev-b/s2`
- **WHEN** 新内核加载该日志，principal `agent{runtime-session, dev-b/s2}` 发送消息
- **THEN** 加载成功且 `locus-a` 仍为托管成员；发送返回 `COLLAB_NOT_MEMBER`，日志长度不变

#### Scenario: 旧托管成员不走远端投递
- **GIVEN** 同上日志，另有不含 `/` 的旧托管成员 `locus-b`（绑定 `runtime-session:abc`），`dev-b` 已注册
- **WHEN** 普通成员 `aily` 分别给 `locus-a`、`locus-b` 发送 `notify:true` 消息，并采样两者 presence
- **THEN** 两次 presence 均为 `unreachable`；两个提交都不含 `dispatch/intended`；`dev-b` 的 `Connection.wake` 调用次数为 0

#### Scenario: 保留 id 与不合规远端地址被拒
- **WHEN** Leader 分别邀请 `local/s1`（以 `runtime-session` 形式）与 `Dev_B/s2`
- **THEN** 两次都返回 `COLLAB_BAD_CHANNEL`，日志长度不变

#### Scenario: 纯本机空间可被旧内核读取
- **GIVEN** 新内核创建空间、邀请并加入两个本机成员、发送一条消息
- **WHEN** 用测试夹具中固定的本变更前内核构建（由提交 `743557e5928df2627b3372ddb105c5d74b20682f` 的 `packages/collab-kernel` 打包、随测试提交并记录 sha256 的 fixture）打开该日志并读取 overview
- **THEN** 打开成功，两成员 `binding.channel` 均为 `dsh-session`，日志文件不含子串 `runtime-session`

### Requirement: 跨机错误分层

`Connection` 的方法 SHALL 只以两类传输错误失败：`TransportError{kind:'unavailable'}`（未注册、断开、超时、中继不可达；结果未知）与 `TransportError{kind:'rejected', code}`（对端以确定的 collab 错误码拒绝，`code` 为对端返回的、经对端脱敏的错误码）。内核 MUST NOT 为跨机失败定义新的 `CollabError` 码；把 `unavailable` 映射为工具错误由宿主负责（见 dsh-collab"跨机工具错误映射"）。内核内部调用 `Connection.claim` 收到 `unavailable` 时 SHALL 以 `COLLAB_SPACE_UNAVAILABLE` 失败且不写日志；收到 `rejected` 或空结果时按现有"无人认领"返回 `COLLAB_ADDRESS_UNCLAIMED`。

#### Scenario: 远端认领不可达
- **GIVEN** `dev-b` 已注册，其 `claim` 抛出 `TransportError{kind:'unavailable'}`
- **WHEN** Leader 邀请 `dev-b/s2`
- **THEN** 返回 `COLLAB_SPACE_UNAVAILABLE`，日志长度不变

#### Scenario: 远端拒绝认领
- **GIVEN** `dev-b` 的 `claim` 返回 `null`
- **WHEN** Leader 邀请 `dev-b/s2`
- **THEN** 返回 `COLLAB_ADDRESS_UNCLAIMED`，日志长度不变

### Requirement: 远端成员的唤醒经其 runtime 投递

远端成员（见上文判别）的唤醒，内核 SHALL 通过该 runtime 的 `Connection.wake(member, pointer)` 投递唤醒，pointer 的 `spaceId` 由内核写为本机视角的裸 spaceId（改写为全局引用由传输适配层负责）。`wake` 成功记 `dispatch/completed succeeded`；以任一 `TransportError` 失败记 `failed`；内核 MUST NOT 对同一 deliveryId 自动重投。远端成员的 presence SHALL 只由注册表决定：所在 runtime 当前已注册为 `reachable`，未注册为 `unreachable`，不做网络探测。远端 runtime 只支持默认投递方式：对远端成员指定任何非默认 `mode` 的唤醒 SHALL 按现有"唤醒可指定投递方式"在提交前以 `COLLAB_MODE_UNSUPPORTED` 拒绝。self 上成员的 presence、投递方式支持与投递 SHALL 继续由现有 `dsh-session` provider 实现（self runtime 是它的适配，不替换其逻辑）。

#### Scenario: 远端 presence 与投递方式
- **GIVEN** 成员 `bob` 绑定 `runtime-session:dev-b/s2`
- **WHEN** `dev-b` 已注册时采样 presence；`dev-b` 注销后再采样；向 `bob` 发送带 `mode:'pet-locus:x'` 的唤醒消息
- **THEN** 两次 presence 依次为 `reachable`、`unreachable`；带 mode 的发送返回 `COLLAB_MODE_UNSUPPORTED`，日志长度不变

#### Scenario: 远端唤醒成功与失败
- **GIVEN** 成员 `bob` 绑定 `runtime-session:dev-b/s2`
- **WHEN** 向 `bob` 发送 `notify:true` 消息两次，测试传输第一次成功、第二次抛 `unavailable`
- **THEN** 两个 deliveryId 分别记 `succeeded` 与 `failed`；之后推进测试时钟 10 分钟，`wake` 总调用次数仍为 2
