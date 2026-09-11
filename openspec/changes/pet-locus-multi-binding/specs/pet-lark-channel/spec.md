## MODIFIED Requirements

### Requirement: 触发消息按 default workspace 加覆盖 map 路由且失败关闭

系统 SHALL 以**绑定位点**为路由主体。位点由 chat 标识构成，当入站消息携带可用的
话题标识时由 chat 标识与话题标识共同构成。消息未携带话题标识时 SHALL 归属该 chat
的群本体位点，MUST NOT 猜测或伪造话题标识；系统 MUST NOT 依据 chat 的类型字段
判定其是否为话题群。

路由 SHALL 分两层解析：存在该位点的 agent 绑定时路由到其记录的目标；否则回退到
该 chat 的 workspace 路由——存在该 chat 的显式 workspace 路由时使用它，否则使用
default workspace 并将本次结果作为标记为自动来源的路由行写回，供用户后续在设置页
查看与改绑。单聊与群聊 SHALL 共用同一路由模型。**未绑定的话题 SHALL 走该 chat 的
workspace 路由**，而不是落到群本体位点的 agent 上。

chat 的 workspace 路由与位点的 agent 绑定 SHALL 是彼此独立的记录：绑定一个位点
MUST NOT 覆盖或消耗该 chat 的 workspace 路由，解除绑定后该 chat SHALL 自然回到
其原有 workspace 路由，无需还原动作。

agent 绑定 SHALL 记录其代理形态：由 Pet 在目标 workspace 新建 executor，或由源
会话 fork 而来的 continuable child。fork 形态的绑定 SHALL 仅由 Q&A 动作或绑定
命令创建，MUST NOT 由入站消息自动写回产生，MUST NOT 参与 default workspace 回退，
设置页 MUST NOT 允许将其改绑为 workspace 目标。

位点内命令 SHALL 在按既有规则丢弃或路由**之前**被识别，并 SHALL 发生在 mention、
去重、水位与消息类型防线**之后**：命令不豁免任何一道既有防线。命令 SHALL 包含
绑定、解绑与授权三类。

命令 SHALL 无论该位点当前是否已绑定都被识别，由对应流程给出确定性结果；
MUST NOT 因位点的绑定状态而不识别命令、使其作为普通提问投递给 child。冲突、
「无可解绑」与「无可授权」都是数据库事实，SHALL 由一次查询机械判定并立即回执，
MUST NOT 交由模型推理得出。

命令识别 MUST NOT 改变无 agent 绑定的群或单聊的任何既有行为。

路由目标 MUST 是当前 Host 已注册的 workspace 或一个有效的 agent 绑定。default
workspace 未配置且无路由行、或目标 workspace 已不存在时，系统 SHALL fail closed：
不创建 Task，并在触发消息上给出失败表情反馈。agent 绑定已失效时按其失效语义处理。

#### Scenario: 未绑定的群首次触发
- **WHEN** allowlist 用户在一个没有任何绑定的群中 @bot，default workspace 配置为 nexus
- **THEN** 本次触发路由到 nexus，并写回一行该 chat 到 nexus 的自动 workspace 路由

#### Scenario: 已显式改绑的群触发
- **WHEN** 用户已在设置页把某群的 workspace 路由改为 dev-infra-server，随后在该群 @bot
- **THEN** 触发路由到 dev-infra-server，不受 default workspace 影响

#### Scenario: 路由目标不可解析
- **WHEN** 触发消息命中的 workspace 已在 Host 注销，或无路由行且 default 未配置
- **THEN** 系统不创建 Task 或 Invocation，在触发消息上打失败表情并记录诊断

#### Scenario: qa 群触发路由到 child
- **WHEN** 一个有 fork 形态 agent 绑定的位点中有成员 @bot
- **THEN** 消息路由到该绑定记录的 child 会话，不经 default workspace，也不写回自动路由行

#### Scenario: 同群不同话题各自路由
- **WHEN** 同一群的话题 A 已绑定某源会话，话题 B 未绑定，两个话题各有一条触发消息
- **THEN** 话题 A 的消息投递给其 child，话题 B 的消息按该 chat 的 workspace 路由处理

#### Scenario: 群本体已绑定而话题未绑定
- **WHEN** 某群的群本体位点已绑定一个源会话，随后一条消息来自该群一个未绑定的话题
- **THEN** 该消息走 chat 的 workspace 路由，不投递给群本体位点的 child

#### Scenario: 解除绑定后回到原有 workspace 路由
- **WHEN** 一个原本路由到某 workspace 的群，其位点被绑定后又被解除
- **THEN** 该群自然回到原 workspace 路由，系统无需执行任何还原动作

#### Scenario: qa 绑定不可被改绑为 workspace
- **WHEN** 用户在设置页查看一个 fork 形态的 agent 绑定
- **THEN** 该行展示其形态与源会话，不提供改绑到 workspace 的操作

#### Scenario: 未绑定群中的绑定命令被识别
- **WHEN** 一个无 agent 绑定的位点中，allowlist 用户 @bot 发送 `/bind <前缀>`
- **THEN** 消息进入绑定流程，不按 default workspace 路由、不写回自动 workspace 路由行

#### Scenario: 绑定命令不豁免既有防线
- **WHEN** 一条命令消息未 mention bot、属重复投递或早于启动水位
- **THEN** 该消息按对应防线丢弃，命令流程不被触发

#### Scenario: 已绑定群中识别解绑命令
- **WHEN** 一个已有 agent 绑定的位点中，allowlist 用户 @bot 发送 `/unbind`
- **THEN** 消息进入解绑流程，不作为提问投递给 child

#### Scenario: 已绑定群中的 /bind 被机械拒绝
- **WHEN** 一个已有 agent 绑定的位点中，allowlist 用户 @bot 发送 `/bind <前缀>`
- **THEN** 系统立即回执「本位点已绑定」，该消息不投递给 child，不经模型推理

#### Scenario: 未绑定群中的 /unbind 被机械拒绝
- **WHEN** 一个无 agent 绑定的位点中，allowlist 用户 @bot 发送 `/unbind`
- **THEN** 系统立即回执「本位点没有绑定任何会话」，该消息不投递给 child

### Requirement: 入站触发仅限 allowlist 发送者且未通过防线的消息静默丢弃

系统 SHALL 仅接受 allowlist 内发送者的触发：群聊中 mention 命中自身 bot 的消息、
以及单聊中的任意消息（单聊无需 mention，逐条触发）。allowlist SHALL 以解析后的
open_id 持久化并在运行时比对；用户名无法解析为 open_id 时该配置项 SHALL 不生效
（fail closed），MUST NOT 回退为字符串比对。

存在 fork 形态 agent 绑定的 chat SHALL 豁免发送者 allowlist：该 chat 任何成员
mention bot 的消息即通过准入。豁免 SHALL 以 **chat 为单位**判定——飞书的成员关系
本身是群级的，不存在「仅某话题的成员」，按位点判定会使同一个人在一个话题能提问
而在另一个话题被静默丢弃。因此该 chat 下**存在任一有效 fork 绑定**即构成豁免。

豁免 MUST NOT 因某人是该 chat 成员而放行其在任何其它 chat 的触发。豁免 SHALL 以
有效绑定为据，MUST NOT 以「存在绑定行」为据：已释放或已失效的绑定行会被保留以便
历史可查，据此豁免会让一个无人服务的 chat 继续放行名单外发送者。mention 命中、
去重、水位与消息类型防线对已豁免 chat SHALL 原样适用。

命令类消息 MUST NOT 享有该豁免：绑定、解绑与授权 SHALL 仅由全局 allowlist 内的
发送者触发。提问权可以让渡给全体成员，改变关联与授权范围则不可以。

未通过准入、mention 判定、去重或水位任一防线的消息 SHALL 被静默丢弃：仅记录
诊断日志，MUST NOT 打表情、回复或以其它方式向会话暴露 bot 背后存在 agent。
绑定失效后的消息 SHALL 按其失效语义处理（有限次明示后静默），不适用
「不暴露 agent」原则——该会话内 bot 已公开参与对话。

#### Scenario: 非 allowlist 用户在群里 @bot
- **WHEN** 一个不在 allowlist 的用户在一个无任何 fork 绑定的群中 @bot
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
- **WHEN** 一个不在全局 allowlist 的用户在一个有有效 fork 绑定的 chat 中 @bot
- **THEN** 消息通过准入并按位点路由

#### Scenario: 豁免覆盖该 chat 的未绑定话题
- **WHEN** 某群的一个话题已绑定，非 allowlist 成员在该群另一个未绑定话题中 @bot
- **THEN** 消息通过准入，并按该 chat 的 workspace 路由处理

#### Scenario: qa 豁免不外溢
- **WHEN** 同一用户在另一个无 fork 绑定的群或单聊中向 bot 发消息
- **THEN** 按全局 allowlist 判定，不因其在别处的成员身份放行

#### Scenario: 已释放的 chat 不再豁免
- **WHEN** 某 chat 的全部 fork 绑定均已归档，其成员（不在 allowlist）@bot
- **THEN** 该发送者不再获得豁免，消息按全局 allowlist 判定

#### Scenario: 豁免不覆盖命令
- **WHEN** 一个不在 allowlist 的成员在已绑定 chat 中发送绑定、解绑或授权命令
- **THEN** 消息被静默丢弃，不执行命令、不回复、不暴露 bot 背后存在 agent

### Requirement: 每个 chat 至多一个活跃 workspace-resident Pet Task 且可复用

channel 触发且路由到 workspace 的 Pet Task SHALL 采用 workspace-resident 形态：
executor session 创建于路由目标 workspace。系统 SHALL 为每个**位点**维护至多一个
活跃 Task：后续触发复用该 Task 及其固定 executor session 追加 Invocation；Task
已归档、被删除或指针悬空时 SHALL 创建新 Task 并修复指针，MUST NOT 因指针漂移
报错拒绝。

位点 SHALL 构成独立的来源 scope 种类：不同位点即使路由到同一 workspace 也
MUST NOT 共享 Task 或 executor session；同一 chat 下的不同话题同样 MUST NOT
共享。

#### Scenario: 同一群连续两次触发
- **WHEN** 某位点的活跃 Task 存在且未归档，allowlist 用户再次 @bot
- **THEN** 系统在该 Task 的同一 executor session 上追加新 Invocation，不创建新 Task

#### Scenario: 活跃 Task 已在 DSH 侧归档
- **WHEN** 某位点绑定的活跃 Task 已进入归档状态，用户再次 @bot
- **THEN** 系统创建新 Task 与新 executor session 并更新绑定指针，旧 Task 保持只读历史

#### Scenario: 两个群绑定同一 workspace
- **WHEN** 两个不同位点都路由到 nexus 并分别触发
- **THEN** 两个位点各自持有独立的活跃 Task 与 executor session

#### Scenario: 同群两个话题路由到同一 workspace
- **WHEN** 同一群的两个未绑定话题先后触发，且都回退到同一个 workspace 路由
- **THEN** 两个话题各自持有独立的 Task 与 executor session
