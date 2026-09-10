## ADDED Requirements

### Requirement: 允许成员可通过设置页发起的单聊配对加入 allowlist

Channel 设置页 SHALL 在“允许触发的成员”区域提供配对入口。仅当 Bot 已绑定、其 `open_id` 已由受支持的 lark-cli 身份输出确认且专属 profile 可用时，用户方可生成配对；生成后页面 SHALL 展示格式为 `/pair xxxx-xxxx` 的完整单聊命令、剩余有效时间、复制、取消与重新生成操作。

配对码 SHALL 由 Pet Host 使用密码学安全随机源生成，为短时、单次有效且不持久化的秘密；有效期 SHALL 为 5 分钟，同一 Host 同一时刻至多存在一个有效配对。重新生成、取消、成功认领、过期、Pet 停止或 Host 重启 SHALL 立即使旧码失效。配对码、完整配对命令与错误尝试内容 MUST NOT 写入日志、Pet 持久层、Task、Invocation 或诊断输出。

有效配对期间，系统 SHALL 仅把用户在 Bot 单聊中发送的文本消息作为候选，并 SHALL 在 trim 后精确匹配 `/pair <当前配对码>`；群聊消息、Bot 消息、非文本消息、额外参数、错误码、旧码与配对启动水位之前的消息 SHALL 静默丢弃。匹配事件的发送者 `open_id` SHALL 是授权真相源，系统 MUST NOT 依据显示名、消息正文中的身份声明或字符串猜测授权。

第一个成功匹配者 SHALL 原子认领当前配对并以去重方式追加到 `allowOpenIds`；同一配对的并发或重投事件 MUST NOT 加入第二个成员。系统 MAY 从匹配消息读取发送者显示名并写入 `knownNames` 展示缓存，但准入 MUST 始终只比较 `open_id`。持久化成功后 Host SHALL 向原单聊回复一次配对成功确认并在设置页展示成功成员；持久化失败 MUST NOT 报告成功，页面 SHALL 显示可重试的失败诊断。

配对消息 MUST NOT 创建 Task、Invocation、chat binding 或 channel 关联，MUST NOT 参与 default workspace 路由或添加任务表情。错误配对码、群聊尝试及其它陌生消息 MUST NOT 收到任何回复；当前配对码在到达 Host 时已过期的精确单聊命令 MAY 收到一次失效提示，但 MUST NOT 加入 allowlist。

#### Scenario: 首位成员在 Channel 关闭时完成配对
- **WHEN** Bot 身份已确认、allowlist 为空且正式 Channel 未启用，用户在设置页生成配对码并于 5 分钟内单聊 Bot 发送精确命令
- **THEN** Host 从该事件取得发送者 `open_id`，原子加入 allowlist，回复一次成功确认，且不创建 Task、Invocation 或 chat binding

#### Scenario: 后续成员通过同一入口配对
- **WHEN** allowlist 已有成员，设置页生成新码且另一用户以单聊精确匹配
- **THEN** 新用户的 `open_id` 去重追加到既有 allowlist，原有成员不变

#### Scenario: 群聊中的正确配对码不生效
- **WHEN** 任意用户在群聊中发送或 @Bot 发送当前正确的 `/pair <code>`
- **THEN** 系统静默丢弃，不加入成员、不回复、不打表情且不创建工作

#### Scenario: 错误配对码保持静默
- **WHEN** 陌生用户单聊 Bot 发送格式正确但不匹配当前码的 `/pair <code>`
- **THEN** 系统静默丢弃且不暴露是否存在有效配对

#### Scenario: 并发认领只有一个获胜者
- **WHEN** 两个不同发送者的正确配对消息并发到达
- **THEN** 只有第一个完成原子认领的发送者被加入 allowlist，另一个事件静默结束且不产生第二次授权

#### Scenario: 重新生成立即废弃旧码
- **WHEN** 用户在旧码仍有效时点击重新生成，随后有人发送旧码
- **THEN** 旧码不再生效，只有新码可以认领当前配对

#### Scenario: Host 重启后配对失效
- **WHEN** 有效配对尚未完成而 DSH Host 重启
- **THEN** 重启后页面不恢复该配对，旧命令不能加入 allowlist，用户必须重新生成

#### Scenario: 配对持久化失败
- **WHEN** 正确配对消息已原子认领但 allowlist 写入失败
- **THEN** 系统不发送成功确认、不把成员显示为已授权，并在设置页提供失败诊断和重新生成入口

## MODIFIED Requirements

### Requirement: 飞书入站通道经本机 lark-cli bot 身份接入且凭据零接触

Pet Host SHALL 以内嵌子进程方式运行 `lark-cli event consume`（bot 身份）订阅
`im.message.receive_v1`，以流式事件作为唯一入站来源。Pet MUST NOT 读取、保存、
回传或代理任何飞书 app secret、token 或其它凭据；凭据生命周期完全属于 lark-cli。
所有出站飞书调用（拉取历史、表情增删、单聊回复）SHALL 统一使用 bot 身份，
MUST NOT 使用 lark-cli 的 user 身份。

channel SHALL 是显式开关能力且默认关闭。正式 Channel 未启用时，Pet MUST NOT 因普通消息处理而启动订阅子进程；但在 Bot 已绑定、身份已确认且存在有效配对时，Pet SHALL 为配对临时运行同一个受监督 consumer。系统 MUST NOT 为配对另起第二个同 EventKey consumer。consumer 的运行条件 SHALL 是“正式 Channel 已启用”或“存在处于启动、等待或认领阶段的有效配对”；两个原因均消失时 SHALL 以 SIGTERM 回收 consumer，且 MUST NOT 终止 lark-cli 共享 bus daemon。

#### Scenario: 启用 channel 后启动订阅
- **WHEN** 用户在设置中启用 channel 且 lark-cli bot 身份可用，Pet Host 达到 ready
- **THEN** Pet 启动事件订阅子进程并在确认订阅成功后将 channel 标记为 connected

#### Scenario: lark-cli bot 身份不可用
- **WHEN** channel 已启用但 lark-cli 未登录 bot 或登录态失效
- **THEN** channel 进入 down 状态并给出指向 lark-cli 重新登录的诊断说明，Pet 其余能力不受影响

#### Scenario: 升级后默认不消费事件
- **WHEN** 用户升级到含配对能力的 Pet 版本，未显式启用 channel 且没有发起配对
- **THEN** Pet 不启动订阅子进程，不消费任何飞书事件

#### Scenario: Channel 关闭时为配对临时订阅
- **WHEN** 正式 Channel 未启用但用户生成了有效配对码
- **THEN** Pet 复用既有受监督 subscription 启动唯一 consumer，只允许配对前置分支处理匹配单聊，其它消息仍按关闭语义静默丢弃

#### Scenario: 配对结束后按运行原因回收
- **WHEN** 配对成功、取消、失败或过期
- **THEN** 若正式 Channel 已启用则 consumer 继续运行，否则 Pet 以 SIGTERM 停止 consumer

### Requirement: 文字回复由 Agent 发出而系统只维护表情状态

对进入 Task、Invocation 或 qa child 的业务请求，系统 MUST NOT 代 Agent 向会话发送任何文字内容。回复的时机、内容与形式（纯文本或消息卡片）SHALL 由 Agent 决定并自行发出；系统仅维护表情状态。两条业务回复路径并存会产生重复回答，且系统侧只能机械回传最后一段 transcript，无法替代经过组织的答复。

由于业务回复目标不再由系统解析，注入 SHALL 明确要求 Agent 只回到本次触发所在会话与触发消息，MUST NOT 发往其它群或个人，并 SHALL 在 prompt 中给出该会话与消息标识。系统 SHALL 明确告知 Agent「不发送即用户收不到」，避免其误以为系统会代为送达。Agent 无输出或未发送时，系统 SHALL 仍完成表情状态流转，MUST NOT 因此阻塞或重试。

设置页发起的配对属于 Host 控制面而非业务请求；它 MUST NOT 进入 Agent。Host MAY 仅对正确配对成功和当前码已过期这两种确定性结果，在原单聊发送一次固定模板回执。该例外 MUST NOT 扩展到错误码、普通陌生消息或任何业务请求。

#### Scenario: 单聊触发成功
- **WHEN** allowlist 用户单聊 bot 提问且 Invocation 成功完成
- **THEN** 用户收到的业务文字回复恰好来自 Agent 一次发送，系统不再追加任何消息

#### Scenario: 群聊触发成功
- **WHEN** 群聊触发的 Invocation 成功完成且 Agent 发出了回复
- **THEN** 该回复出现在原会话中，触发消息获得完成表情

#### Scenario: Agent 未发送任何回复
- **WHEN** Invocation 成功完成但 Agent 没有向会话发送内容
- **THEN** 触发消息仍获得完成表情，系统不代为发送

#### Scenario: 配对成功由 Host 固定回执
- **WHEN** 单聊配对已成功持久化成员
- **THEN** Host 在原单聊发送一次固定成功回执，不创建或调用 Agent

### Requirement: Channel onboarding 是有序、可判定且可恢复的

Channel 管理面 SHALL 将“绑定 Bot、确认 Bot 身份、配置至少一个 allowlist 成员、选择默认 workspace、启用订阅”展示为有序的 onboarding 状态，而不是把“绑定成功”呈现为“已经可以在群中使用”。每一步 SHALL 显示完成状态；未满足下一步前置条件时，操作 SHALL 被禁用或返回紧邻操作位置的具体诊断。

“配置至少一个 allowlist 成员”步骤 SHALL 优先提供单聊配对入口，并保留手工填写已确认 `open_id` 的兜底。配对页面状态 SHALL 来自 Host 当前状态而非客户端自行推断；生成、取消、重新生成、认领、过期、失败和成功后页面 SHALL 最终一致地收敛。倒计时 MAY 在客户端根据 Host 提供的绝对过期时间本地推进，但页面重新打开时 MUST 重新读取 Host 状态。

系统 SHALL 在正式 Channel 启动、显式重连及启用前验证：受支持的 lark-cli 可用、Bot 已绑定且身份可用、bot open_id 已确认、allowlist 非空、默认 workspace 可解析；异步验证完成后 SHALL 再次读取最新配置，已 disable、Host 已停止或前置已失效时不得以正式 Channel 原因启动 consumer。已启用时管理面 MUST NOT 允许清空 allowlist 或默认 workspace。可提前验证的版本/scope/身份错误 SHALL 在设置页暴露；目标群调用发现的权限错误 SHALL 持久为 channel 诊断并提供飞书返回的权限申请入口（若有），而不是只表现为群内沉默。系统 MUST NOT 在没有当前配对码精确证明或用户手工提交已确认 `open_id` 的情况下，把观察到的发送者加入 allowlist。

#### Scenario: 只完成 Bot 绑定
- **WHEN** 用户完成 Bot 绑定但尚未配置 allowlist 或默认 workspace
- **THEN** 页面明确显示绑定已完成但 channel 尚不可用，并在允许成员步骤提供配对入口，不启动正式消息处理

#### Scenario: allowlist 为空时尝试启用
- **WHEN** 用户在没有允许成员时启用 channel
- **THEN** 系统拒绝启用并在开关附近说明必须先通过配对或手工添加至少一个 `ou_...`，而不是仅留下一个没有反应的关闭状态

#### Scenario: Bot 身份尚未确认时尝试启用
- **WHEN** 绑定记录存在但 bot open_id 尚未通过受支持 CLI 的已验证身份证明
- **THEN** 系统拒绝启用并展示身份确认诊断，不启动一个无法判定群聊 mention 的订阅

#### Scenario: Bot 身份尚未确认时发起配对
- **WHEN** 绑定记录存在但 bot open_id 尚未通过受支持 CLI 的已验证身份证明确认
- **THEN** 系统拒绝生成配对码并展示身份确认诊断，不启动 consumer

#### Scenario: 默认 workspace 不可用
- **WHEN** 用户已通过配对加入成员，但默认 workspace 已删除、归档或无法解析
- **THEN** onboarding 仅将允许成员步骤标为完成，仍拒绝启用正式 Channel 并要求重新选择 workspace

#### Scenario: 全部前置条件满足
- **WHEN** Bot 身份、allowlist、默认 workspace 与订阅权限均满足且用户显式启用
- **THEN** consumer 到达 connected，页面显示 channel 可用，allowlist 用户随后在群中 @ Bot 可进入既有路由与 Invocation 流程
