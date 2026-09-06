# Pet Lark Channel Specification

## Purpose
Pet 的飞书入站通道：绑定 bot 并经本机 lark-cli 以 bot 身份订阅消息（凭据零接触），
按 allowlist 准入并将触发消息路由到目标 workspace，在其中复用每会话唯一的
workspace-resident Pet Task 执行；系统维护表情状态，会话内容读取与文字回复由
Agent 自行完成。

## Requirements
### Requirement: 飞书入站通道经本机 lark-cli bot 身份接入且凭据零接触

Pet Host SHALL 以内嵌子进程方式运行 `lark-cli event consume`（bot 身份）订阅
`im.message.receive_v1`，以流式事件作为唯一入站来源。Pet MUST NOT 读取、保存、
回传或代理任何飞书 app secret、token 或其它凭据；凭据生命周期完全属于 lark-cli。
所有出站飞书调用（拉取历史、表情增删、单聊回复）SHALL 统一使用 bot 身份，
MUST NOT 使用 lark-cli 的 user 身份。

channel SHALL 是显式开关能力且默认关闭；未启用时 Pet MUST NOT 启动订阅子进程。

#### Scenario: 启用 channel 后启动订阅
- **WHEN** 用户在设置中启用 channel 且 lark-cli bot 身份可用，Pet Host 达到 ready
- **THEN** Pet 启动事件订阅子进程并在确认订阅成功后将 channel 标记为 connected

#### Scenario: lark-cli bot 身份不可用
- **WHEN** channel 已启用但 lark-cli 未登录 bot 或登录态失效
- **THEN** channel 进入 down 状态并给出指向 lark-cli 重新登录的诊断说明，Pet 其余能力不受影响

#### Scenario: 升级后默认不消费事件
- **WHEN** 用户升级到含 channel 能力的 Pet 版本且未显式启用 channel
- **THEN** Pet 不启动订阅子进程，不消费任何飞书事件

### Requirement: Bot 绑定经 lark-cli 专属 profile 完成且 Pet 不接触凭据

系统 SHALL 提供两条 bot 绑定路径：**创建新 Bot**（经 `lark-cli config init --new`
发起授权流程，由用户在浏览器完成创建与授权）与**连接已有 Bot**（用户提供 App ID
与 App Secret）。两条路径 SHALL 使用 Pet 专属的 lark-cli profile，MUST NOT 修改或
覆盖用户既有的 lark-cli app 配置、令牌或身份策略。

Pet MUST NOT 保存、回显或写入日志任何 app secret。「连接已有 Bot」路径中用户提供的
secret SHALL 仅经进程标准输入直接传递给 lark-cli，随后立即丢弃；「创建新 Bot」路径
中 secret 由 lark-cli 自行落地，Pet SHALL 只读取 App ID 等非机密身份信息。

创建流程是阻塞式的，系统 SHALL 以后台任务承载并向用户展示待完成的验证入口与当前
等待状态，MUST NOT 在流程未完成时报告绑定成功。绑定失败、被拒绝或超时 SHALL 保留
可诊断说明且不写入部分配置。

bot 自身 open_id SHALL 可在首次收到群消息时自动获得，使新建 bot 无需先被拉入群聊
即可完成配置。事件中的 mention 仅作为**候选来源**，MUST NOT 单独作为身份依据：
系统 SHALL 通过该会话的成员列表确认候选 open_id 归属于已绑定的 app id，仅在恰好
一个候选同时满足「归属本 app」与「被本条消息 mention」时才持久化。显示名 MUST NOT
参与该判定——显示名可被冒充，app id 不能。无法取得成员列表、无匹配或存在歧义时
SHALL 不写入任何身份，群聊 mention 判定在 open_id 未知期间 SHALL 继续 fail closed。

#### Scenario: 创建新 Bot
- **WHEN** 用户在 Channel 页选择创建新 Bot 并完成浏览器授权
- **THEN** 新 app 落在 Pet 专属 profile 中，Channel 页显示其 App ID 与名称，
      用户既有 lark-cli app 的配置与登录态不变

#### Scenario: 授权尚未完成
- **WHEN** 创建流程已发起但用户尚未在浏览器完成授权
- **THEN** 系统显示等待状态与验证入口，不报告绑定成功，也不写入部分配置

#### Scenario: 连接已有 Bot
- **WHEN** 用户提供既有 App ID 与 App Secret 并提交
- **THEN** secret 仅经标准输入交给 lark-cli，Pet 的持久层与日志中不出现该值，
      页面此后也不回显它

#### Scenario: 绑定失败
- **WHEN** 授权被拒绝、超时或凭据无效
- **THEN** 系统给出可诊断说明，channel 保持未配置状态而非半配置状态

#### Scenario: 首次群消息回填 bot open_id
- **WHEN** 已绑定但 bot open_id 未知，allowlist 用户在群中 @该 bot
- **THEN** 系统以该会话成员列表确认候选 open_id 归属已绑定 app 后持久化，
      供后续 mention 判定使用

#### Scenario: 冒充者复制了 bot 显示名
- **WHEN** 某个同名但归属其它 app 的成员被 @，而本 bot 未被 @
- **THEN** 系统不写入任何 open_id，该消息不触发工作，群聊判定保持 fail closed

#### Scenario: 成员列表不可读时不降级
- **WHEN** open_id 未知且该会话的成员列表无法取得
- **THEN** 系统 MUST NOT 退而信任 mention 中的标识，保持 open_id 未知

### Requirement: 入站触发仅限 allowlist 发送者且未通过防线的消息静默丢弃

系统 SHALL 仅接受 allowlist 内发送者的触发：群聊中 mention 命中自身 bot 的消息、
以及单聊中的任意消息（单聊无需 mention，逐条触发）。allowlist SHALL 以解析后的
open_id 持久化并在运行时比对；用户名无法解析为 open_id 时该配置项 SHALL 不生效
（fail closed），MUST NOT 回退为字符串比对。

未通过准入、mention 判定、去重或水位任一防线的消息 SHALL 被静默丢弃：仅记录
诊断日志，MUST NOT 打表情、回复或以其它方式向会话暴露 bot 背后存在 agent。

#### Scenario: 非 allowlist 用户在群里 @bot
- **WHEN** 一个不在 allowlist 的用户在已含 bot 的群中 @bot
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

### Requirement: 入站事件具备去重与启动水位防重放

系统 SHALL 按消息 ID 在时间窗口内去重，并 SHALL 丢弃创建时间早于当前订阅
子进程启动水位的消息。Invocation 创建 SHALL 以触发消息 ID 幂等：同一消息
MUST NOT 产生第二个 Invocation。

#### Scenario: WebSocket 重连后事件重投
- **WHEN** 订阅链路断线重连，同一消息事件被再次投递
- **THEN** 系统识别为重复并丢弃，不重复打表情或创建 Invocation

#### Scenario: 子进程重启后收到历史消息
- **WHEN** channel 子进程重启后收到创建时间早于本次启动水位的消息
- **THEN** 系统丢弃该消息，不触发处理

### Requirement: 触发消息按 default workspace 加覆盖 map 路由且失败关闭

系统 SHALL 维护 chat 到 workspace 的路由：存在该 chat 的显式绑定行时使用其
workspace；否则使用 default workspace，并将本次路由结果作为标记为自动来源的
绑定行写回，供用户后续在设置页查看与改绑。单聊与群聊 SHALL 共用同一路由模型。

路由目标 MUST 是当前 Host 已注册的 workspace。default workspace 未配置且无
绑定行、或目标 workspace 已不存在时，系统 SHALL fail closed：不创建 Task，
并在触发消息上给出失败表情反馈。

#### Scenario: 未绑定的群首次触发
- **WHEN** allowlist 用户在一个没有绑定行的群中 @bot，default workspace 配置为 nexus
- **THEN** 本次触发路由到 nexus，并写回一行该群到 nexus 的自动绑定

#### Scenario: 已显式改绑的群触发
- **WHEN** 用户已在设置页把某群绑定到 dev-infra-server，随后在该群 @bot
- **THEN** 触发路由到 dev-infra-server，不受 default workspace 影响

#### Scenario: 路由目标不可解析
- **WHEN** 触发消息命中的 workspace 已在 Host 注销，或无绑定且 default 未配置
- **THEN** 系统不创建 Task 或 Invocation，在触发消息上打失败表情并记录诊断

### Requirement: 每个 chat 至多一个活跃 workspace-resident Pet Task 且可复用

channel 触发的 Pet Task SHALL 采用 workspace-resident 形态：executor session
创建于路由目标 workspace。系统 SHALL 为每个 chat 维护至多一个活跃 Task：
后续触发复用该 Task 及其固定 executor session 追加 Invocation；Task 已归档、
被删除或指针悬空时 SHALL 创建新 Task 并修复指针，MUST NOT 因指针漂移报错拒绝。

chat SHALL 构成独立的来源 scope 种类：不同 chat 即使路由到同一 workspace 也
MUST NOT 共享 Task 或 executor session。

#### Scenario: 同一群连续两次触发
- **WHEN** 某群的活跃 Task 存在且未归档，allowlist 用户再次 @bot
- **THEN** 系统在该 Task 的同一 executor session 上追加新 Invocation，不创建新 Task

#### Scenario: 活跃 Task 已在 DSH 侧归档
- **WHEN** 某群绑定的活跃 Task 已进入归档状态，用户再次 @bot
- **THEN** 系统创建新 Task 与新 executor session 并更新绑定指针，旧 Task 保持只读历史

#### Scenario: 两个群绑定同一 workspace
- **WHEN** 两个不同群都路由到 nexus 并分别触发
- **THEN** 两个群各自持有独立的活跃 Task 与 executor session

### Requirement: 每条触发消息独立关联 Invocation 并进入 Task 串行队列

每条通过防线的触发消息 SHALL 恰好对应一个 Invocation，并持久化其 channel 关联
（chat、触发消息 ID、根消息 ID、发送者 open_id、表情 ID）。当前 Invocation 未
终结时，新触发消息的 Invocation SHALL 进入该 Task 的持久队列按到达序执行，
遵循既有的 Task 级严格串行语义。

当前 Invocation 处于 waiting-user 且队列头部为 channel 触发的 Invocation 时，
系统 SHALL 将其消息内容作为用户输入投递给等待中的 Invocation 而不是并发启动；
被消费的触发消息的表情反馈 SHALL 跟随该等待中 Invocation 的终态。

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

### Requirement: 会话内容由 Agent 自取而非预先注入

系统 MUST NOT 把会话历史压平后注入 Invocation prompt。压平会丢失转发、话题、
卡片、图片等结构，且把成本花在与问题无关的消息上。注入 SHALL 只包含触发消息本身、
触发者身份与会话标识。

当本机 lark-cli 的 bot 身份可用时，注入 SHALL 告知 Agent 可以此身份直接读取飞书
内容，并 SHALL 指向 lark-cli 自带的能力文档（列出与精读）而非内联固定命令清单
——固定清单会与 CLI 演进脱节。注入 SHALL 要求所有调用显式使用 bot 身份。该可用性
SHALL 在每次创建 Invocation 时实际探测；不可用时系统 SHALL 明确声明该限制，
MUST NOT 声称 Agent 具备它当前不具备的能力。

系统 MAY 为解析触发者显示名而读取少量消息，但该读取结果 MUST NOT 作为会话上下文
注入 prompt，也 MUST NOT 写入 Pet 持久层。

#### Scenario: 触发消息含富文本或转发内容
- **WHEN** 触发消息或其上下文包含转发、话题、卡片或图片等结构化内容
- **THEN** prompt 不含被压平的历史文本，Agent 依据会话与消息标识自行读取原样内容

#### Scenario: bot 身份不可用时不虚报能力
- **WHEN** 创建 Invocation 时本机 lark-cli 的 bot 身份不可用
- **THEN** prompt 明确声明无法读取飞书内容且无法回复，Agent 可如实说明该限制

### Requirement: 表情反馈状态机由 Host 观测终态驱动且 fail-soft

系统 SHALL 在接受触发消息后立即为其打进行中表情并记录表情 ID（排队中的消息
同样打进行中表情）。Host SHALL 观测对应 Invocation 的终态：成功时删除进行中
表情并打完成表情；失败或取消时删除进行中表情并打失败表情。表情操作 MUST NOT
由模型参与或经模型工具触发。

任何表情操作失败 SHALL 仅记录诊断，MUST NOT 改变 Invocation 状态或阻断执行。

#### Scenario: 触发到完成的表情序列
- **WHEN** 一次群聊触发的 Invocation 成功完成
- **THEN** 触发消息经历打进行中表情、删除进行中表情、打完成表情的完整序列

#### Scenario: 表情操作失败
- **WHEN** 打或删表情的飞书调用失败
- **THEN** Invocation 照常执行与终结，失败仅出现在诊断日志中

### Requirement: 文字回复由 Agent 发出而系统只维护表情状态

系统 MUST NOT 代 Agent 向会话发送任何文字内容。回复的时机、内容与形式（纯文本或
消息卡片）SHALL 由 Agent 决定并自行发出；系统仅维护表情状态。两条出站路径并存会
产生重复回答，且系统侧只能机械回传最后一段 transcript，无法替代经过组织的答复。

由于回复目标不再由系统解析，注入 SHALL 明确要求 Agent 只回到本次触发所在会话与
触发消息，MUST NOT 发往其它群或个人，并 SHALL 在 prompt 中给出该会话与消息标识。
系统 SHALL 明确告知 Agent「不发送即用户收不到」，避免其误以为系统会代为送达。

Agent 无输出或未发送时，系统 SHALL 仍完成表情状态流转，MUST NOT 因此阻塞或重试。

#### Scenario: 单聊触发成功
- **WHEN** allowlist 用户单聊 bot 提问且 Invocation 成功完成
- **THEN** 用户收到的文字回复恰好来自 Agent 一次发送，系统不再追加任何消息

#### Scenario: 群聊触发成功
- **WHEN** 群聊触发的 Invocation 成功完成且 Agent 发出了回复
- **THEN** 该回复出现在原会话中，触发消息获得完成表情

#### Scenario: Agent 未发送任何回复
- **WHEN** Invocation 成功完成但 Agent 没有向会话发送内容
- **THEN** 触发消息仍获得完成表情，系统不代为发送

### Requirement: channel 生命周期独立降级且可诊断可回收

channel SHALL 维护独立于 Pet 整体状态的连接状态机（connected、reconnecting、
down 含原因）。订阅子进程异常退出时系统 SHALL 指数退避重启；达到退避上限
SHALL 进入 down 并在 Diagnostics 显示原因与显式重连操作。channel 故障
MUST NOT 影响 Pet 浮层、面板与非 channel 能力。Pet 停止时 SHALL 显式回收
订阅子进程，MUST NOT 遗留孤儿进程。

#### Scenario: 订阅子进程崩溃
- **WHEN** channel 子进程异常退出
- **THEN** channel 进入 reconnecting 并按指数退避重启，Pet 其余能力持续可用

#### Scenario: 重连达到上限
- **WHEN** 连续重启均失败并达到退避上限
- **THEN** channel 进入 down，Diagnostics 显示原因并提供显式重连操作

#### Scenario: Pet 停止
- **WHEN** dsh web 停止使 Pet Host 进入 stopping
- **THEN** 订阅子进程被显式终止，不留孤儿进程
