# Pet Lark Channel Specification (Delta)

## MODIFIED Requirements

### Requirement: 入站触发仅限 allowlist 发送者且未通过防线的消息静默丢弃

系统 SHALL 仅接受 allowlist 内发送者的触发：群聊中 mention 命中自身 bot 的消息、
以及单聊中的任意消息（单聊无需 mention，逐条触发）。allowlist SHALL 以解析后的
open_id 持久化并在运行时比对；用户名无法解析为 open_id 时该配置项 SHALL 不生效
（fail closed），MUST NOT 回退为字符串比对。

`kind: qa` 绑定的群 SHALL 豁免发送者 allowlist：该群任何成员 mention bot 的消息
即通过准入，信任依据是该群由 Host 亲手创建且成员由本人信任链拉入。豁免 SHALL
以绑定行的 `kind` 判定，MUST NOT 因 qa 群成员身份放行该发送者在任何其它 chat 的
触发。mention 命中、去重、水位与消息类型防线对 qa 群 SHALL 原样适用。

未通过准入、mention 判定、去重或水位任一防线的消息 SHALL 被静默丢弃：仅记录
诊断日志，MUST NOT 打表情、回复或以其它方式向会话暴露 bot 背后存在 agent。
qa 绑定失效后的群消息 SHALL 按其失效语义处理（有限次明示后静默），不适用
「不暴露 agent」原则——该群内 bot 已公开参与对话。

#### Scenario: 非 allowlist 用户在群里 @bot
- **WHEN** 一个不在 allowlist 的用户在已含 bot 的非 qa 群中 @bot
- **THEN** 消息被静默丢弃，不打表情、不回复、不创建任何 Task 或 Invocation

#### Scenario: 群内未 @bot 的消息
- **WHEN** allowlist 用户在群里发送未 mention bot 的消息
- **THEN** 消息不触发任何处理

#### Scenario: allowlist 用户单聊 bot
- **WHEN** allowlist 用户在与 bot 的单聊中发送一条普通消息
- **THEN** 该消息无需 @即触发一次完整的入站处理

#### Scenario: allowlist 配置无法解析
- **WHEN** 配置的用户名在当前 bot app 维度解析 open_id 失败
- **THEN** 该配置项不生效且设置页显示可诊断错误，系统不放行任何未证明身份的发送者

#### Scenario: qa 群成员豁免 allowlist
- **WHEN** 一个不在全局 allowlist 的用户在 qa 绑定的群中 @bot
- **THEN** 消息通过准入并投递给该群绑定的 child

#### Scenario: qa 豁免不外溢
- **WHEN** 同一用户在另一个非 qa 群或单聊中向 bot 发消息
- **THEN** 按全局 allowlist 判定，不因其 qa 群成员身份放行

### Requirement: 触发消息按 default workspace 加覆盖 map 路由且失败关闭

系统 SHALL 维护 chat 到 workspace 的路由：存在该 chat 的显式绑定行时使用其
workspace；否则使用 default workspace，并将本次路由结果作为标记为自动来源的
绑定行写回，供用户后续在设置页查看与改绑。单聊与群聊 SHALL 共用同一路由模型。

绑定行 SHALL 区分 `kind`：`workspace`（既有语义）与 `qa`。`kind: qa` 行的路由
目标是其记录的 fork child 会话而非 workspace；此类行 SHALL 仅由 Q&A 动作创建，
MUST NOT 由入站消息自动写回产生，MUST NOT 参与 default workspace 回退，设置页
MUST NOT 允许将其改绑为 workspace 目标。存量绑定行 SHALL 读作 `kind: workspace`。

路由目标 MUST 是当前 Host 已注册的 workspace（`kind: workspace`）或有效的 qa
绑定（`kind: qa`）。default workspace 未配置且无绑定行、或目标 workspace 已不
存在时，系统 SHALL fail closed：不创建 Task，并在触发消息上给出失败表情反馈。
qa 绑定已失效时按其失效语义处理。

#### Scenario: 未绑定的群首次触发
- **WHEN** allowlist 用户在一个没有绑定行的群中 @bot，default workspace 配置为 nexus
- **THEN** 本次触发路由到 nexus，并写回一行该群到 nexus 的自动绑定

#### Scenario: 已显式改绑的群触发
- **WHEN** 用户已在设置页把某群绑定到 dev-infra-server，随后在该群 @bot
- **THEN** 触发路由到 dev-infra-server，不受 default workspace 影响

#### Scenario: 路由目标不可解析
- **WHEN** 触发消息命中的 workspace 已在 Host 注销，或无绑定且 default 未配置
- **THEN** 系统不创建 Task 或 Invocation，在触发消息上打失败表情并记录诊断

#### Scenario: qa 群触发路由到 child
- **WHEN** qa 绑定的群中有成员 @bot
- **THEN** 消息路由到该绑定记录的 child 会话，不经 default workspace，也不写回自动绑定行

#### Scenario: qa 绑定不可被改绑为 workspace
- **WHEN** 用户在设置页查看一个 qa 绑定行
- **THEN** 该行展示其 qa 属性与源会话，不提供改绑到 workspace 的操作

### Requirement: 每条触发消息独立关联 Invocation 并进入 Task 串行队列

每条通过防线的触发消息 SHALL 恰好对应一个 Invocation 或 qa 投递记录，并持久化
其 channel 关联（chat、触发消息 ID、根消息 ID、发送者 open_id、表情 ID）。
`kind: workspace` 绑定沿用既有语义：当前 Invocation 未终结时，新触发消息的
Invocation SHALL 进入该 Task 的持久队列按到达序执行，遵循既有的 Task 级严格
串行语义；当前 Invocation 处于 waiting-user 且队列头部为 channel 触发的
Invocation 时，系统 SHALL 将其消息内容作为用户输入投递给等待中的 Invocation
而不是并发启动，被消费的触发消息的表情反馈 SHALL 跟随该等待中 Invocation 的
终态。

`kind: qa` 绑定的消息 SHALL 由宿主排入 child 的收件队列成为独立 turn，排队与
顺序由 child 收件队列（FIFO）承担，系统 MUST NOT 为其另建 Invocation 串行队列，
MUST NOT 经能力 envelope 通道派发；其终态 SHALL 由子代理结算事件观测，投递被
接受 MUST NOT 被视为执行完成。

channel 关联原文之外，系统 MUST NOT 在持久层保存拉取的会话历史内容。

#### Scenario: 排队消息的表情独立跟随
- **WHEN** 用户在前一次触发仍在执行时连续 @bot 两次
- **THEN** 两条消息各自立即获得进行中表情，各自的终态表情跟随各自 Invocation 的结果

#### Scenario: 等待用户时的追加消息
- **WHEN** 当前 Invocation 正在等待用户回答，allowlist 用户在该会话再次发来消息
- **THEN** 该消息内容被作为用户输入续进等待中的 Invocation，不与其并发执行

#### Scenario: 队列按到达序推进
- **WHEN** 当前 Invocation 进入终态且队列中还有两条 channel 触发的 Invocation
- **THEN** 系统按消息到达顺序启动下一个 Invocation

#### Scenario: qa 消息不建 executor 也不进 Invocation 队列
- **WHEN** qa 群成员 @bot 且该群 child 正在处理上一条消息
- **THEN** 新消息作为 child 收件队列中的下一个 turn 排队，系统不创建新 executor session，channel 关联照常持久化

#### Scenario: qa 投递接受不等于完成
- **WHEN** qa 消息已被 child 收件队列接受但 turn 尚未结算
- **THEN** 触发消息保持进行中表情，终态表情仅在对应结算事件后出现
