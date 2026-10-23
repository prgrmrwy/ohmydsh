## MODIFIED Requirements

### Requirement: 调用身份来自实际执行会话

协作工具 SHALL 从宿主工具执行上下文推导调用会话，以 channel `dsh-session` 与完整 session ID 构造 agent principal。参数 MUST NOT 接受 actor、principal、providerId 或调用者 sessionId。调用会话 MUST 是当前 Host 中真实执行的普通一级会话，或按"工具调用者可解析为托管成员"被恰好一个接入方解析的会话：已归档或位于 `denySessionIds` 中的会话，以及未被接入方解析的已知 subagent origin、非零 delegationDepth、官方所有权拒绝的会话，MUST 以 `COLLAB_CALLER_UNAVAILABLE` 拒绝且不读写协作数据。准入模式 `admission` 取值 SHALL 仅为 `invite`（默认）或 `allowlist`：`invite` 下通过上述校验即可调用，空间读写由内核成员授权决定；`allowlist` 额外要求调用者在 `allowedSessionIds` 中。两个 ID 列表只能由宿主配置提供，agent 工具不能修改；修改后须经 `dsh build` 与 `dsh restart` 才生效。插件启动时 MUST 拒绝以下配置并不注册服务：`admission` 不是上述两个值之一；任一列表含空串、首尾空白或重复项；同一 ID 同时出现在两个列表。工具不会授予额外文件权限，也不会改变 preset、cwd 或会话派生关系。

#### Scenario: 跨 workspace 调用仍归属实际会话
- **GIVEN** workspace A/B 的已有普通会话 A/B
- **WHEN** B 调用协作写工具
- **THEN** 事件 actor 对应 B 的成员绑定，不可能归属于 A；B 的 cwd、preset 与父子关系不变

#### Scenario: 参数伪造身份被拒绝
- **WHEN** 工具参数包含 actor、principal 或调用者 sessionId 等未声明字段
- **THEN** 返回 `COLLAB_BAD_ARGUMENTS`，内核未收到命令，日志字节不变

#### Scenario: 无调用会话不能访问
- **WHEN** 从缺少执行 agent 的上下文调用协作读取或写入
- **THEN** 返回 `COLLAB_CALLER_UNAVAILABLE`，不返回空间存在性或数据

#### Scenario: 邀请模式下未配置名单的普通会话可建空间
- **GIVEN** `admission: invite`，`allowedSessionIds` 为空，A 是普通一级会话
- **WHEN** A 创建空间
- **THEN** 创建成功且 A 为 Leader；没有配置文件写入或 Host 重启

#### Scenario: 排除名单与派生会话不可调用
- **GIVEN** 会话 P 在 `denySessionIds` 中，会话 S 是没有被任何接入方解析的 subagent
- **WHEN** P 或 S 调用任一协作工具
- **THEN** 返回 `COLLAB_CALLER_UNAVAILABLE`，日志字节不变

#### Scenario: 兼容模式保持首版行为
- **GIVEN** `admission: allowlist`，C 是不在名单中的普通会话
- **WHEN** C 调用协作工具，或 Leader 邀请 C
- **THEN** C 的调用返回 `COLLAB_CALLER_UNAVAILABLE`；邀请返回地址未认领，成员与投递意图不新增

#### Scenario: 非法配置拒绝启动
- **WHEN** 配置为 `admission: open`，或同一 ID 同时在 `allowedSessionIds` 与 `denySessionIds`
- **THEN** 每种情况插件都拒绝启动并报告 `COLLAB_BAD_CONFIG`，不注册任何协作工具，不创建 dataDir

### Requirement: 具名工具忠实适配内核

插件 SHALL 恰好提供 11 个常驻协作工具：`collab_status`、`collab_space`（`action: create|close|allow_manager|revoke_manager`）、`collab_invite`、`collab_member`（`action: join|decline|leave|mark_gone|transfer_leader`）、`collab_read`（`view: overview|since|convention`）、`collab_create_item`、`collab_revise_item`、`collab_ack_item`、`collab_send_message`、`collab_set_status`、`collab_advance_request`。`action`/`view` SHALL 为封闭枚举，每个取值静态对应一个具名内核方法；取值所需字段缺失或出现不属于该取值的字段时 MUST 以 `COLLAB_BAD_ARGUMENTS` 拒绝且不调用内核。写操作 SHALL 要求非空 cmdId，创建地址固定为实际调用会话，邀请只接受 agent。`collab_space` 的 `create` SHALL 接受可选 `purpose` 并原样传给内核；`allow_manager` 与 `revoke_manager` SHALL 要求 `channel` 并分别调用内核 `allowManager`、`revokeManager`，`channel` 原样传递，由内核校验。协作工具 MUST NOT 接受 `ext` 与 `mode`。`collab_send_message` 与 `collab_create_item` SHALL 提供可选整数参数 `ref`，在出现时原样传给内核；`collab_send_message` 的描述 SHALL 说明"接续同一件事时 ref 填相关消息或条目的 seq，另起一件事不填"。`collab_create_item` 与 `collab_revise_item` 的 schema SHALL 仍接受可选的 `deciders`（不再必填），出现时原样传给内核：本变更之前的调用都带 `deciders`（含空数组），原样传递才能让同 cmdId 同参数的重试命中内核收据、返回原结果；对没有收据的新命令，内核以 `COLLAB_BAD_ITEM`（字段 `deciders`）拒绝。工具描述 MUST NOT 引导模型填写 `deciders`。插件 MUST NOT 自行校验、补全或删改 `ref`、`purpose` 与 `deciders`，非法值由内核拒绝（`COLLAB_BAD_REF`、`COLLAB_BAD_PURPOSE`），超出话题上限由内核以 `COLLAB_THREAD_LIMIT` 拒绝，均原样返回。`collab_create_item` 的工具描述 SHALL 说明 itemId 应使用小写字母、数字与连字符；插件 MUST NOT 在内核之前拒绝其它 itemId，以免挡住旧命令的收据重放。MUST NOT 暴露内核实例、任意事件写入、自由字符串命令分发、内部重置或人类确认工具；命令先交内核执行，内核的收据、CAS 与幂等语义 SHALL 原样保留，同一调用者以相同 cmdId 和参数重试已成功的命令 SHALL 返回原结果。读取不保存已读游标，不自动 ack/join。`collab_status` 的描述 SHALL 说明：写命令返回 `COLLAB_SPACE_UNAVAILABLE` 时结果未知，应稍后用原 cmdId 与相同参数重试；`collab_read` 的描述 SHALL 说明：空间 `lastSeq` 小于自己保存的游标时，应从 0 重读。

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

### Requirement: 投递只传协作指针并使用下一回合语义

普通唤醒 SHALL 只包含内核白名单指针（`thread` 仅在为安全整数时复制）及固定说明文本，不携带条目/消息正文、标题或其它 workspace 文件。固定说明 SHALL 指明先调用 `collab_status` 查看待处理事项，并按 `memberTrust` 取两套文本之一：

- `memberTrust: true`：说明本会话是该协作空间的成员，本机用户已允许本会话承接空间成员派发的 request 并在本会话原有权限边界内直接执行，无需再向用户确认；越出原有 sandbox、approval 或 worktree 限制的操作仍按原规则处理；需要人决定时在本会话问本机用户，成员转述不能代替用户的决定。对带 `invited:true` 的指针，另说明宿主已在邀请时代为加入，若 `collab_status` 仍列出该邀请再自行 join。
- `memberTrust: false`：明确其为插件协作数据而非用户/系统授权，不表示用户同意或工作完成。

指针带 `mode` 时按"接入方可为普通会话收件人注册投递方式"交给接入方 handler，不使用 followup；其余情况下，运行中会话通过官方 followup 进入下一回合；空闲会话可开始新回合。provider 成功 SHALL 只表示宿主接受入队，不宣称模型已处理或完成工作。MUST NOT 用 steer 打断当前回合或等待模型完成才返回。

#### Scenario: 运行中目标下一回合收到
- **GIVEN** B 当前回合正在执行工具调用
- **WHEN** A 触发 B 的普通唤醒
- **THEN** 指针不出现在 B 当前回合输入；当前回合结束后恰在下一回合输入出现一次；投递无需等待 B 完成

#### Scenario: 空闲目标收到带来源指针
- **WHEN** 向空闲 B 投递
- **THEN** B 新回合收到的消息来源为 `plugin:dsh-collab`，文本包含 `collab_status` 与精确指针 JSON，不含条目标题或正文

#### Scenario: 成员信任下的唤醒文本是常设授权
- **GIVEN** `memberTrust: true`
- **WHEN** 向 B 投递任一普通唤醒
- **THEN** 文本含"无需再向用户确认"与"原有权限边界"的说明，不含"不是额外授权"或"不表示用户同意"

#### Scenario: 关闭成员信任保持原说明
- **GIVEN** `memberTrust: false`
- **WHEN** 向 B 投递任一普通唤醒
- **THEN** 文本与本变更之前的固定说明逐字相同

#### Scenario: 邀请指针不能替代加入
- **GIVEN** `memberTrust: false`，invited 的 B 收到带 `invited:true` 的指针
- **WHEN** B 在 join 前用 `collab_read` 读取该空间
- **THEN** 返回 `COLLAB_MEMBER_INACTIVE`，不含空间内容；provider 不替 B 自动 join 或 ack

#### Scenario: 不满足准入条件的目标不投递
- **GIVEN** B 曾被邀请，随后被加入 `denySessionIds` 并经 `dsh build` 与 `dsh restart` 生效
- **WHEN** 新 Host 中有成员触发一次新的、需要唤醒 B 的投递
- **THEN** provider 拒绝投递，不调用恢复或 followup，投递记为失败

#### Scenario: 话题唤醒携带话题根
- **GIVEN** 内核指针为 `{spaceId:'s', toSeq:9, counts:{message:1,item:0,decision:0,member:0}, from:'a', thread:5, title:'SECRET'}`
- **WHEN** provider 投递该指针
- **THEN** 消息中的指针 JSON 恰为 `{"spaceId":"s","toSeq":9,"counts":{"message":1,"item":0,"decision":0,"member":0},"from":"a","thread":5}`

#### Scenario: 非整数 thread 不被转发
- **GIVEN** 指针分别不含 `thread`、`thread` 为 `'5'`、`thread` 为 `1.5`
- **WHEN** provider 投递
- **THEN** 三次转发的指针 JSON 都不含 `thread` 键

#### Scenario: 唤醒文本不再提及决策工具
- **GIVEN** `memberTrust: true`
- **WHEN** 向 B 投递任一普通唤醒
- **THEN** 文本不含 `requestDecision`，含"问本机用户"

### Requirement: 状态入口的下一步建议与联系人

`next` SHALL 按下表推导，每个非空类别每空间一项：invites → `join_or_decline`/`collab_member`；acks → `ack`/`collab_ack_item`；replies → `read_and_reply`/`collab_read`；requests → `advance_request`/`collab_advance_request`。closed 空间不产生 `next`。`contacts` SHALL 只含 `allowedSessionIds` 中剔除 `denySessionIds`、已归档、调用者自身，且 header 核验为普通会话的会话，cwd 只取 header 元数据；元数据列表不可用时 `contacts` 为空数组。调用者解析为托管成员时，`collab_status` SHALL 按该调用者的 `{channel, address}` 匹配各空间成员的当前绑定，`contacts` 恒为空数组（种子名单只描述普通会话，接入方自行提供其成员可见的联系人）。

#### Scenario: 邀请只暴露最少信息
- **GIVEN** B 被 A 邀请进入空间 S 但未 join
- **WHEN** B 调用 `collab_status`
- **THEN** `invites` 恰为 `[{spaceId:'S', invitedBy:'a'}]`；`spaces` 不含 S；`next` 恰含一项 `{kind:'join_or_decline', spaceId:'S', tool:'collab_member'}`

#### Scenario: 联系人只来自种子名单
- **GIVEN** 种子名单含 D 与 F，F 已归档；B 与 C 同为空间 S 的 active 成员；E 是与任何空间无关的普通会话
- **WHEN** B 调用 `collab_status`
- **THEN** `contacts` 的 sessionId 集合恰为 {D}

#### Scenario: 元数据不可用时联系人为空
- **GIVEN** 种子名单含 D，会话元数据列表抛错
- **WHEN** B 调用 `collab_status`
- **THEN** 调用成功，`contacts` 为空数组

#### Scenario: 托管调用者没有联系人
- **GIVEN** 种子名单含普通会话 D；子会话 L 被接入方解析为托管成员
- **WHEN** L 调用 `collab_status`
- **THEN** `contacts` 为空数组，会话元数据列表调用次数为 0

#### Scenario: 没有待办时没有建议
- **GIVEN** B 是空间 S 的 active 成员，S 中没有与 B 相关的待办
- **WHEN** B 调用 `collab_status`
- **THEN** `next` 为空数组，`spaces` 中 S 的 `pending` 各列表为空

## ADDED Requirements

### Requirement: 宿主声明可托管成员的接入方 channel

插件配置 SHALL 支持 `managedChannels`：一个字符串数组，缺省为 `[]`。每项必须满足：

- 匹配 `^[a-z][a-z0-9-]{0,31}$`；
- 不等于 `dsh-session`；
- 不重复。

否则插件 MUST 以 `COLLAB_BAD_CONFIG` 拒绝启动，不注册任何工具。只有宿主配置能提供该项，修改后须经 `dsh build` 与 `dsh restart` 生效。

插件 SHALL 为每个声明的 channel 注册一个中继 provider：`id` 为 `dsh-collab:<channel>`，`managed: true`，绑定 `supports:{wake:true, confirm:false}`。中继 provider 的行为由当前接入的接入方决定：

| 方法 | 有接入方 | 没有接入方 |
|---|---|---|
| `claim` | 只认领 `kind:'agent'` 且接入方 `claim` 返回真的地址 | 不认领 |
| `presence` | 接入方结果；抛错为 `unknown` | `unreachable` |
| `deliver` | 交给接入方 | 抛错（投递记为失败） |
| `supportsMode` | 只对以 `<channel>:` 开头、且在接入方 `modes` 中的方式返回真 | 返回假 |

插件 SHALL 在加载时以 cordis 服务名 `dshCollab` 提供接入服务。接入方调用 `attach(channel, adapter)` 取得句柄：

- channel 不在 `managedChannels` 中时 MUST 以 `COLLAB_BAD_CHANNEL` 拒绝；
- 该 channel 已有接入方时 MUST 以 `COLLAB_CHANNEL_ATTACHED` 拒绝；
- 句柄 `dispose()` 后该 channel 回到没有接入方的状态，句柄上的任何调用都 MUST 以 `COLLAB_CHANNEL_DETACHED` 拒绝。

插件 dispose 时 SHALL 先使全部句柄失效，再关闭空间。

#### Scenario: 未声明的 channel 不能接入
- **GIVEN** `managedChannels: ['pet-locus']`
- **WHEN** 接入方分别以 `other` 与 `pet-locus` 调用 `attach`，再以 `pet-locus` 调用一次
- **THEN** 依次返回 `COLLAB_BAD_CHANNEL`、成功、`COLLAB_CHANNEL_ATTACHED`

#### Scenario: 非法配置拒绝启动
- **WHEN** 配置分别为 `managedChannels: ['dsh-session']`、`['Pet']`、`['a','a']`、`'pet-locus'`
- **THEN** 每次插件都拒绝启动并报告 `COLLAB_BAD_CONFIG`，不注册工具、不创建 dataDir

#### Scenario: 接入方离开后不可投递
- **GIVEN** 托管成员 `locus-a` 由 `pet-locus` 托管；接入方句柄已 dispose
- **WHEN** 成员 `aily` 给 `locus-a` 发需回复消息
- **THEN** 消息提交成功；采样到的 `locus-a` presence 为 `unreachable`，提交不含 `dispatch/intended`

#### Scenario: 未声明托管 channel 时工具面与行为不变
- **GIVEN** 配置不含 `managedChannels`
- **WHEN** 读取真实工具 schema，并运行既有的普通会话协作场景
- **THEN** 只注册 `dsh-session` provider；既有场景结果与本变更之前相同

### Requirement: 接入方经句柄托管成员

句柄 SHALL 提供 `admit(spaceId, cmdId, {name, address})`、`rebind(spaceId, cmdId, {member, address})` 与 `retire(spaceId, cmdId, {member})`。它们以该中继 provider 的 manager principal 调用内核同名命令，返回内核结果。错误按"错误披露不泄露无权空间"映射。

句柄 MUST NOT 提供 `allowManager`、`revokeManager`、`invite`、`markGone`、`transferLeader` 或 `closeSpace`。接入方不能替任何会话授权自己。

#### Scenario: Leader 授权后接入方接纳成员
- **GIVEN** 会话 A 是空间 S 的 Leader，A 以 `collab_space` 的 `allow_manager` 授权 `pet-locus`
- **WHEN** 接入方句柄以 `cmdId:'adm-1'` 接纳 `locus-a`（地址 `loc:1`），再以相同参数重试
- **THEN** 两次返回同一 seq；台账含 `manager/allowed` 与 actor 为 `manager:pet-locus` 的 `member/joined`；无唤醒

#### Scenario: 未授权空间返回不可用
- **GIVEN** 空间 S 未授权 `pet-locus`
- **WHEN** 句柄调用 `admit`
- **THEN** 返回 `COLLAB_FORBIDDEN`，日志字节不变

#### Scenario: 句柄没有 Leader 能力
- **WHEN** 检查句柄对象的方法集合
- **THEN** 恰含 `admit`、`rebind`、`retire`、`command`、`read`、`registerSessionMode` 与 `dispose`

### Requirement: 工具调用者可解析为托管成员

接入方 adapter SHALL 提供同步方法 `resolveCaller(agent)`。它只在该 agent 是接入方当前绑定的成员会话时返回地址，否则返回 `undefined`；抛错视为 `undefined`。

协作工具解析调用者时，SHALL 先满足既有的执行会话条件：执行 agent 存在、是 Host 当前对象、`agent.id === agent.session.id`、未归档、不在 `denySessionIds` 中。随后：

1. 若会话是普通一级会话，且满足 `admission` 的现有条件，调用者为 `{channel:'dsh-session', address:<session ID>}`。
2. 否则询问当前全部接入方。恰有一个返回地址时，调用者为 `{channel:<该 channel>, address:<地址>}`。`allowlist` 模式不约束托管调用者：它们的准入由 Leader 授权与接入方绑定共同决定。
3. 以下情况 MUST 以 `COLLAB_CALLER_UNAVAILABLE` 拒绝：普通会话同时被任一接入方认领；多个接入方认领同一会话；没有任何一方认领。

解析结果 SHALL 每次调用重新计算，MUST NOT 缓存。因此接入方解除绑定后，该会话立即无法以托管成员身份调用，即使台账尚未退役它。

#### Scenario: 受管子会话以托管成员身份写入
- **GIVEN** 子会话 L（subagent，delegationDepth 1）被 `pet-locus` 接入方解析为 `loc:1`；`loc:1` 是空间 S 的托管成员 `locus-a`
- **WHEN** L 调用 `collab_send_message` 给 `aily`
- **THEN** 提交的 actor 为 `locus-a`

#### Scenario: 解除绑定后立即失去身份
- **GIVEN** 承上，接入方随后对 L 的 `resolveCaller` 返回 `undefined`，台账中 `locus-a` 仍为 active
- **WHEN** L 调用 `collab_read`
- **THEN** 返回 `COLLAB_CALLER_UNAVAILABLE`，不返回空间内容

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

### Requirement: 接入方以真实调用会话执行带附加数据的命令

句柄 SHALL 提供 `command(exec, spaceId, cmdId, op)` 与 `read(exec, spaceId, view)`。调用者 MUST 按"工具调用者可解析为托管成员"从 `exec` 解析，MUST NOT 接受接入方指定的地址；因此接入方注册的工具只能以实际执行会话的身份写台账。

- `op` SHALL 只能是 `createItem`、`reviseItem`、`ackItem`、`sendMessage`、`setStatus` 或 `advanceRequest`，其余命令 MUST 以 `COLLAB_BAD_ARGUMENTS` 拒绝。
- `createItem` 与 `sendMessage` SHALL 原样传递 `ext`。
- `sendMessage` 的 `mode` 必须以 `<本句柄 channel>:` 开头，否则 MUST 以 `COLLAB_BAD_MODE` 拒绝，内核不会收到命令。
- 协作工具（`collab_*`）MUST NOT 接受 `ext` 或 `mode`。
- `read` 的 `view` SHALL 为 `overview` 或 `since`，返回与 `collab_read` 相同的数据。

#### Scenario: 托管成员写入带来源的请求
- **GIVEN** L 解析为托管成员 `locus-a`
- **WHEN** 接入方在 L 的工具执行中调用 `command(exec, 'S', 'c-1', {op:'createItem', input:{itemId:'todo-1', kind:'request', assignee:'aily', title:'回复群消息', body:'…', requiredAcks:[], ext:{source:{msg:'om_2'}}}})`
- **THEN** `item/created` 的 actor 为 `locus-a`，`ext` 原样保存

#### Scenario: 只能使用本 channel 的投递方式
- **WHEN** `pet-locus` 的句柄以 `mode:'other:inquiry'` 发送消息
- **THEN** 返回 `COLLAB_BAD_MODE`，内核未收到命令

#### Scenario: 模型工具不接受附加数据与方式
- **WHEN** 会话调用 `collab_send_message` 时携带 `ext` 或 `mode`
- **THEN** 返回 `COLLAB_BAD_ARGUMENTS`，内核未收到命令

#### Scenario: 不能经句柄执行成员管理
- **WHEN** 句柄以 `op:'invite'` 或 `op:'allowManager'` 调用 `command`
- **THEN** 返回 `COLLAB_BAD_ARGUMENTS`

### Requirement: 接入方可为普通会话收件人注册投递方式

句柄 SHALL 提供 `registerSessionMode(mode, handler)`：

- `mode` 必须以 `<本句柄 channel>:` 开头且符合内核格式，否则 MUST 以 `COLLAB_BAD_MODE` 拒绝；同一 mode 重复注册 MUST 以 `COLLAB_MODE_TAKEN` 拒绝。
- 句柄 dispose 时注销其全部 mode。
- `dsh-session` provider 的 `supportsMode(mode)` SHALL 只对当前已注册的 mode 返回真。

`dsh-session` provider 投递带 `mode` 的指针时 SHALL：

1. 执行与普通投递相同的准入、身份、归档与关闭核验（开始时、恢复后、交付前）；
2. 不调用 `followup`，改为调用该 mode 的 handler，参数为 `(sessionId, safePointer)`，其中 `safePointer` 是白名单指针（含 `mode`）；
3. handler 抛错、或 mode 在投递时已注销，投递记为失败，不回退为 `followup`。

handler 正常返回只表示接入方已接受该次投递。

#### Scenario: 询问方式交给接入方的独立轮次
- **GIVEN** 接入方注册 `pet-locus:inquiry`；普通会话 A 是空间 S 的成员；托管成员 `locus-a` 经句柄以该 mode 给 A 发需回复消息
- **WHEN** 投递执行
- **THEN** handler 恰被调用一次，参数为 A 的 session ID 与带 `mode:'pet-locus:inquiry'` 的指针；A 的 `followup` 调用次数为 0；投递记为成功

#### Scenario: 方式注销后投递失败而不降级
- **GIVEN** 承上，消息已提交但投递尚未执行时句柄被 dispose
- **WHEN** 投递执行
- **THEN** handler 与 `followup` 都未被调用，投递记为失败

#### Scenario: 未注册的方式在发送时被拒
- **WHEN** 托管成员经句柄以未注册的 `pet-locus:other` 给 A 发需回复消息
- **THEN** 返回 `COLLAB_MODE_UNSUPPORTED`，日志字节不变

#### Scenario: 不能注册他人前缀
- **WHEN** `pet-locus` 的句柄注册 `dsh-session:x`
- **THEN** 返回 `COLLAB_BAD_MODE`
