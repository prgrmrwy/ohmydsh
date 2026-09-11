## REMOVED Requirements

### Requirement: 入站触发仅限 allowlist 发送者且未通过防线的消息静默丢弃
**Reason**: 旧 QA kind 豁免与单聊无 mention 触发被统一 locus 准入替代。
**Migration**: 使用本能力新增的“统一协作消息准入”及 pet-locus-collaboration；命令仅 allowlist，工作仅 at，群级豁免依赖新模型授权。

### Requirement: 触发消息按 default workspace 加覆盖 map 路由且失败关闭
**Reason**: 新模型只有主会话解析与子会话执行，不再维护 chat workspace 覆盖执行路由。
**Migration**: pet-locus-collaboration 的自动主会话与层级补齐要求替代；default 仅用于自动创建，旧路由不迁移。

### Requirement: 每个 chat 至多一个活跃 workspace-resident Pet Task 且可复用
**Reason**: 移除直接服务飞书的 workspace root executor。
**Migration**: 每活跃 locus 一个专属子会话，自动主会话按群幂等创建；普通轮盘 root executor 不变。

### Requirement: 每条触发消息独立关联 Invocation 并进入 Task 串行队列
**Reason**: 所有飞书消息通过子会话常规交互，废除飞书 Invocation/waiting-user 分支。
**Migration**: 按 pet-locus-collaboration“全部飞书工作统一为子会话常规交互”与“投递与结算关联独立于会话运行状态”实现队列、决策往返和独立反馈。

### Requirement: 会话内容由 Agent 自取而非预先注入
**Reason**: 原要求以 Invocation 为前提；保留按需读取原则但采用统一子会话上下文。
**Migration**: 本能力新增“统一子会话按需读取与回复”替代，保留 bot 可用性核验、结构化历史不压平和凭据零接触。

### Requirement: 表情反馈状态机由 Host 观测终态驱动且 fail-soft
**Reason**: 终态不再来自飞书 Invocation。
**Migration**: pet-locus-collaboration 的 Delivery 与子会话执行关联驱动同样的进行中/完成/失败表情，继续 fail-soft。

### Requirement: 文字回复由 Agent 发出而系统只维护表情状态
**Reason**: 统一子会话代替旧 Invocation，明确业务正文与机械控制回执的区别。
**Migration**: 新增“统一子会话按需读取与回复”及 locus 投递规范承接；Host 不重复代发正文。

## ADDED Requirements

### Requirement: 统一协作消息准入

系统 SHALL 仅在消息 mention 已验证 bot 身份时触发工作，群聊与单聊一致。未建立授权协作结构的入口 SHALL 仅接受全局 allowlist 发送者；经所有者授权建立的新模型群 SHALL 允许群成员 at 提问，豁免不外溢。控制命令 MUST 始终核验全局 allowlist，非授权命令静默丢弃。去重、水位、消息类型与身份防线 SHALL 原样生效；未经准入 MUST NOT 因 ensure 自动创建主会话或扩大授权。

#### Scenario: 单聊未 mention
- **WHEN** allowlist 用户在单聊发送未 mention bot 的普通消息
- **THEN** 不启动工作；不会因单聊类型绕过 at 规则

#### Scenario: 授权群成员提问
- **WHEN** 非 allowlist 成员在新模型已授权群内 at bot
- **THEN** 可以按当前 locus 触发工作，但不能执行 bind/scope/unbind

#### Scenario: 新群非授权消息
- **WHEN** 未建立授权群结构的群中非 allowlist 用户 at bot
- **THEN** 静默拒绝，不创建自动主会话或 locus

### Requirement: Bot 入群初始化与消息消费分离

启用的 channel SHALL 接收可验证的 bot 入群生命周期事件以确保群级协作结构；该事件 MUST NOT 触发项目分析或业务回答。事件授权信息不足时 SHALL 保持未授权待建立状态并提供诊断，不推断邀请人可信。首次合格 allowlist at SHALL 可补齐缺失初始化，重复事件 SHALL 幂等。channel 关闭时 MUST NOT 消费入群或消息事件。

#### Scenario: 入群仅初始化
- **WHEN** 收到有可信初始化授权的 bot 入群事件
- **THEN** 确保 default workspace 下的群级结构，不分析群历史

#### Scenario: 入群事件不可验证
- **WHEN** 事件不能证明初始化权限
- **THEN** 不授予群级豁免；首次 allowlist at 可完成建立

### Requirement: 统一子会话按需读取与回复

每次交付 SHALL 只包含触发请求、发送者、入口和消息关联以及 context 查询引导；MUST NOT 将拉取的全部历史压平注入或持久化为 Pet 消息副本。子会话 SHALL 按需使用专属 profile 的 bot 身份读取消息与资料，指向现有能力文档而非固化 CLI 命令。每次派发 SHALL 核验/如实呈现 bot 可用性，不宣称可读无权文档。

业务文字 SHALL 由子会话发送到当前触发入口与回复目标，Host MUST NOT 重复转发最后一段 transcript；子会话未发送时 Host 不代写正文，不因缺正文重放工作。Host SHALL 可发送绑定、来源切换、权限、失效等机械控制回执。表情仅表示对应执行状态，不等于项目完成。

#### Scenario: 结构化资料
- **WHEN** 触发涉及卡片、转发、PRD 链接或图片
- **THEN** 子会话按权限读取原始资料，不接收被压平的全部群历史

#### Scenario: bot 不可用
- **WHEN** 派发时 bot 身份失效
- **THEN** 明确诊断无法读取或回复，不虚报可用能力

#### Scenario: 回复一次
- **WHEN** 子会话成功向原话题发送答复
- **THEN** Host 仅更新表情，不另发重复正文

#### Scenario: 子会话未回复
- **WHEN** 执行结算但未发业务正文
- **THEN** 记录实际结果，不由 Host 拼接 transcript 代发，也不自动重放工作

## MODIFIED Requirements

### Requirement: 入站事件具备去重与启动水位防重放

系统 SHALL 按消息 ID 在时间窗口内去重，并 SHALL 丢弃创建时间早于当前订阅子进程启动水位的消息。新模型 Delivery 接受 SHALL 以触发消息 ID 幂等：同一消息 MUST NOT 产生第二次业务执行；重连不重新建立 locus。生命周期初始化事件 SHALL 单独幂等，不复用消息业务执行状态。

#### Scenario: WebSocket 重连后事件重投
- **WHEN** 订阅链路断线重连，同一消息事件被再次投递
- **THEN** 系统识别重复并丢弃，不重复打表情、创建子会话或派发工作

#### Scenario: 子进程重启后收到历史消息
- **WHEN** channel 子进程重启后收到创建时间早于本次启动水位的消息
- **THEN** 丢弃该消息，不触发处理

### Requirement: Channel onboarding 是有序、可判定且可恢复的

Channel 管理面 SHALL 将“绑定 Bot、确认 Bot 身份、配置至少一个 allowlist 成员、选择默认 workspace、启用订阅”展示为有序的 onboarding 状态，而不是把“绑定成功”呈现为“已经可以在群中使用”。每一步 SHALL 显示完成状态；未满足下一步前置条件时，操作 SHALL 被禁用或返回紧邻操作位置的具体诊断。

系统 SHALL 在启动、显式重连及启用前验证：受支持的 lark-cli 可用、Bot 已绑定且身份可用、bot open_id 已确认、allowlist 非空、默认 workspace 可解析；异步验证完成后 SHALL 再次读取最新配置，已 disable、Host 已停止或前置已失效时不得启动 consumer。已启用时管理面 MUST NOT 允许清空 allowlist 或默认 workspace。可提前验证的版本/scope/身份错误 SHALL 在设置页暴露；目标群调用发现的权限错误 SHALL 持久为 channel 诊断并提供飞书返回的权限申请入口（若有），而不是只表现为群内沉默。系统 MUST NOT 自动授予权限或把未确认用户加入 allowlist。

默认 workspace SHALL 仅用作自动主会话创建的位置。系统 SHALL 展示统一子会话能力与默认 read 核验状态；无法满足安全创建的部署 MUST NOT 发布可服务 locus，且不回退旧 root executor 流程。

#### Scenario: 只完成 Bot 绑定
- **WHEN** 用户完成 Bot 绑定但尚未配置 allowlist 或默认 workspace
- **THEN** 页面明确显示绑定已完成但 channel 尚不可用，并指出下一项待完成步骤，不启动事件订阅

#### Scenario: allowlist 为空时尝试启用
- **WHEN** 用户在没有允许成员时启用 channel
- **THEN** 拒绝启用并说明必须先添加允许成员，不留下无响应状态

#### Scenario: Bot 身份尚未确认时尝试启用
- **WHEN** 绑定记录存在但 bot open_id 尚未通过已验证身份证明
- **THEN** 拒绝启用并展示身份诊断，不启动不能判定 mention 的订阅

#### Scenario: 默认 workspace 不可用
- **WHEN** 默认 workspace 已删除、归档或无法解析
- **THEN** 拒绝将 channel 标为可用并要求重新选择，不等待首条消息才失败

#### Scenario: 全部前置条件满足
- **WHEN** Bot、allowlist、default workspace、订阅与子会话能力均满足且用户显式启用
- **THEN** channel 可用，allowlist at 进入统一主会话/locus/子会话流程，不创建飞书 Invocation
