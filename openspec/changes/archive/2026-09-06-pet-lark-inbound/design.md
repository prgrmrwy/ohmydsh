# pet-lark-inbound Design

## Context

Pet 一期的触发面只有本机浮层。现行 `dsh-pet` spec 已预铺三条演进约束（持久模型允许
Channel Binding；外部回复按调用 session 解析绑定目标，不接受模型生成的
chat/thread/user ID；channel secret 以受保护机制保存），本 change 首次落地它们。

关键既有约束：

- Pet Host 有自有受控生命周期（starting/ready/degraded/stopping），初始化失败只降级
  自身；channel 故障域必须同样自包含。
- 一期 executor session 固定生在 DSH Pet Workspace，来源经 `pet_context` 快照授权；
  Skill 边界由 allowlist provider + workspace 投影保证。
- Pet sqlite domain 现为 v3；管理面是 loopback + same-origin 精确路由、严格字段校验。
- 本机 `lark-cli` 同时持有 user 与 bot 身份；`lark-event` 链路提供
  `lark-cli event consume <EventKey>` 的 NDJSON 长连接流（stderr ready-marker 契约）。

机制参考（非依赖）：`code.byted.org/aiby/lark-agent-bridge`（探索期 clone 至
`/tmp/lark-agent-bridge` 阅读）。借鉴其 session key 形态、msg_id TTL 去重 +
StartTime 防重放、`allow_from` 校验、reaction 增删序列（`MessageReaction.Create`
返回 reaction_id，删除需 message_id + reaction_id）、reply 上下文三元组、
「引用/历史拉取失败优雅降级」与「sender 身份注入 prompt 且声明非指令」等实践。
全部为百行级逻辑，自建，不引入该 Go 仓运行时依赖。

## Goals / Non-Goals

**Goals:**

- 飞书群 @bot / 单聊 bot → 准入校验 → 路由 workspace → 复用/创建该会话唯一活跃
  Pet Task → 注入飞书上下文的 Invocation 串行执行。
- 表情反馈（OnIt → done/失败）全程由 Host 观测 turn 终态驱动。
- 单聊自动回复最终 assistant 消息；群聊本 change 无文字出站。
- channel 故障独立降级，可诊断，可显式恢复。
- 凭据零接触：Pet 不读、不存、不代理任何飞书 app secret / token。

**Non-Goals:**

- 群聊文字回复 / `pet_reply` 工具（后续 change pet-lark-reply）。
- turn 末全自动群聊推送（pet-lark-reply 落地后按真实使用再议）。
- 斜杠命令 / 关键词（如 `/new` 强制新 Task）——留口不实现，跑偏时用户从 Pet 面板
  归档 Task 兜底。
- 执行期间持续监听会话新消息（上下文为触发时一次性拉取）。
- 消息内容脱敏、多 bot、多设备路由、Cockpit 侧任何改动。
- 飞书图片/文件附件的下载与注入（仅文本，附件场景显式降级说明）。

## Decisions

### D1 transport：Pet Host 内嵌 lark-cli 子进程，而非独立 daemon 或复用 bridge

Pet Host ready 后 spawn `lark-cli event consume im.message.receive_v1`（bot 身份），
以 NDJSON 流消费事件，stderr ready-marker 确认订阅成功。

替代方案：（a）以 lark-agent-bridge 写 `agent/dsh` 适配器——否决：引入内网 Go 仓
深度依赖，且 DSH Task/Invocation/归档语义放不进它的 Session 模型，两套会话真相源
打架；（b）独立 bridge 进程调 Pet 管理面——否决：多一个 daemon 生命周期，且要求
Pet 管理面对外开口，扩大现有 loopback+same-origin 信任面。

推论：所有飞书 API 调用（拉历史、表情增删、单聊回复）统一 `--as bot`。user 身份
会混入个人可见范围，且回复显示为用户本人发言，语义错误。

### D1b Bot 绑定：走 lark-cli 自己的 `config init`，Pet 只做编排

实现期查证发现 lark-cli **内置**了飞书的应用注册协议（二进制中可见
`/oauth/v1/app/registration`、`archetype=PersonalAgent`），并暴露为
`config init`：`--new` 走浏览器创建授权流程，`--app-id` + `--app-secret-stdin`
连接已有 app，`--profile <name>` 使多个 app 并存。帮助文本明确写了 agent 用法
（后台运行、从输出取验证 URL）。

因此 Pet **不实现注册协议**，只编排 lark-cli 并读取结果。这与 D1 一脉相承：
凭据生命周期整体留在 lark-cli。

- **专属 profile `dsh-pet`**：与用户既有 app 完全隔离，既守住「不动用户现有配置」，
  也顺带避免两个消费者抢同一 app 的事件。
- **secret 传递**：`--new` 路径 Pet 根本见不到 secret；「连接已有」路径经
  **stdin** 交给 lark-cli（不进 argv——进程列表可见），用后即弃，不落库不记日志。
- **阻塞流程**：`config init --new` 阻塞到用户完成授权，故以后台任务承载，UI 显示
  验证入口与等待态；未完成不写任何配置，避免半绑定状态。

替代方案：（a）自行实现注册协议（两个 form-POST + 二维码，协议已在 SDK 源码中
读清） —— 否决：lark-cli 已有且更完整（keychain 落地、profile 管理、brand 切换），
自建等于复制一套凭据处理代码，与「Pet 零接触凭据」背道而驰；（b）依赖
lark-agent-bridge 的 `bot new` —— 否决：为建一个 app 引入整个 Go 运行时依赖。

**bot open_id 的获取**：spike 用的是 `im +chat-members-list` 按自身 app_id 匹配，
但新建的 bot 不在任何群里，该路径看似不可用。关键转折：**收到群消息本身就证明
bot 已经在那个群里**——成员列表因此又可用了。

所以采用「候选 + 证明」两步：事件的 `mentions` 提供候选 open_id，成员列表把候选
与已绑定 `app_id` 对上，两者都命中且唯一时才写入。**显示名不参与判定**——曾考虑
过按 botName 匹配 mention，但那意味着任何人把自己或另一个 bot 改成同名再 @一次，
就能让 Pet 记错自己的身份（后果是真 @不响应、假 @被当成自己）。app_id 无法冒充，
名字可以，所以证明步骤只认前者。成员列表读不到时 MUST NOT 退回信任 mention，保持
open_id 未知、群聊 fail closed（D2），因此这条路径不打开任何缺口。

### D1c bootstrap 入口：浮层提示 + 设置页，而不是一个能力

**它不能是 capability/Skill**。轮盘上的能力全部由已注册 Skill 派生，而现行 spec
禁止内置 Skill（D5b 刚以同样理由否决过占位能力）；更根本的是，bot 绑定是
「浏览器授权 + Host 侧凭据落地」，不是派发给 executor 的 Invocation——让 Agent
去跑授权流程会直接违反凭据零接触。

形态：**Channel 页签是常驻的家；浮层提示区是可关闭的发现入口**。提示区已有同款
先例（「还没有可用能力…」），因此不引入任何新概念。可关闭是因为 channel 属可选
增强，永久唠叨不合理；关闭只影响浮层，设置页入口永在，所以关掉也不会失去入口。
多条引导竞争时 Skill 优先——没有能力的 Pet 首先需要的是 Skill，不是飞书。

### D2 入站防线：allowlist（open_id）→ 去重 → 水位，全部 fail closed

- **allowlist**：准入门设在人维度而非群维度。配置以用户名解析为该 bot app 维度的
  open_id 后持久化（事件里的 sender 是 open_id，不能存用户名运行时比对）。解析
  失败则该配置不生效（fail closed）。初始仅 zhangyong.617。
- **去重**：msg_id 60s TTL 内存表——飞书 WS 断线重连会重投未 ack 事件。
- **水位**：channel 子进程每次启动记录水位时间，丢弃 create_time 早于水位的消息，
  防重启重放批量建 Invocation。
- 群聊仅 @bot（mention 命中自身 bot open_id）触发；单聊条条触发（准入已由
  allowlist 保证）。未通过任一防线的消息静默丢弃（仅 log），不打表情不回复——
  不向无关方暴露 bot 背后有 agent。

### D3 路由：default_workspace + chat 覆盖 map，首次触发自动写回

```
触发消息（已过防线）
  └─ chat_bindings 有该 chat_id 显式行？
       ├─ 有 → 该行 workspace
       └─ 无 → default_workspace（初始 nexus），并写回一行绑定（来源标记 auto）
```

单聊与群聊共用同一张表（chat_id 天然区分 p2p/group）。自动写回使后续可在设置页
把某群改绑（如 dev-infra-server），无需先手工建行。workspace 必须是 Host 已注册
workspace；路由目标无法解析（default 未配且无绑定、或 workspace 已不存在）时
fail closed：不建 Task，打失败表情。

替代（bridge 的约定匹配：群名 == workspace 名自动绑定）：留作后续增强，本 change
不做——群名解析需要额外 API 且个人场景收益有限。

### D4 Task 模型：workspace-resident 形态，信任前移到绑定配置

新 Task 形态：executor session cwd 直接位于路由目标 workspace（如 nexus checkout），
而非 DSH Pet Workspace。

诚实的信任口径（写入 spec）：此形态下 Pet 不承诺一期的 Skill allowlist 投影与
standing instructions 边界——目标 workspace 自身的 `.dsh/skills`、AGENTS.md 生效。
信任来源是「chat→workspace 绑定由用户显式建立或显式可改 + 触发者在 allowlist」。
Pet MUST NOT 向目标仓库写入任何投影或指令文件。

替代（A：仍生在 Pet Workspace，经 pet_context 快照授权访问来源）：否决——用户
意图明确是「在 nexus 中创建 session 跟进」，A 形态下每次文件访问都要绕授权链，
与「跟进一个项目问题」的工作方式不匹配；bridge 的 per-channel work_dir 实践也
验证了 B 的形态。

一期「每来源 scope 至多一个未归档 Task、固定复用 executor session」的语义平移为
「每 chat 至多一个活跃 Task」：chat_bindings 持有 active_task_id，终态 Task 复用
同一 executor session 续新 Invocation（对话延续）；已归档或指针悬空则新建并修指针。

### D5 Invocation 队列：新增 queued 状态，Task 级串行

一期 Invocation 是「创建即派发」。本 change 引入 `queued`：同一 Task 上多条触发
消息按到达序生成 Invocation，同一时刻至多一个在 running/waiting-user，其余 queued。
前一个 turn 终态后出队下一个。

- 每条触发消息 = 一个 Invocation = 一行 `invocation_channel`（chat_id /
  trigger_msg_id / root_id / sender_open_id / reaction_id）。关联天然持久化，
  无需额外逻辑映射表。
- queued 的消息同样立即打 OnIt——「收到在排队」与「正在处理」对用户等价，
  区分反而要多一种表情语义。
- waiting-user 时轮到的下一条 Invocation 内容作为用户输入续进当前等待（与
  DSH「等待用户输入时收到消息」的既有语义对齐），不另起 turn。
- 回复顺序不做跨 Invocation 保序承诺：每条消息的表情状态独立跟随自己的
  Invocation 生命周期。

### D5b 对话式 Invocation：Skill 字段改为可选，而非造一个占位能力

**实现期发现的模型冲突**：一期把「Invocation」等同于「执行某个 Skill」——
`accept()` 首步即解析 capability，`PetInvocationRecord` 的 `skillName` /
`skillSourcePath` / `skillSetGeneration` 均为必填，envelope 首行渲染
`/<skillName>` 驱动真实注入，`pump()` 派发前还要 `verifySkill()`。但飞书触发是
「用户问了个问题」，没有 Skill 可绑。

**决定**：三个字段改为可选，新增不绑定 Skill 的对话式 Invocation。envelope 在
`skillName === undefined` 时**完全不发前导令牌**（发 `/undefined` 会作为普通散文
抵达 Agent，读起来是一条格式错误的命令）；`verifySkill` 因无校验对象而跳过。

**这不放宽授权边界**：被跳过的检查是「这个 Invocation 固定的 Skill 现在是否仍可
合法加载」，而对话式 Invocation 根本不引用任何 Skill，不存在可绕过的对象。
executor 实际可用的 Skill 面由其所在 workspace 决定，与本决定无关。

替代方案：（a）造一个内置「对话」伪 capability 占位 —— **否决**：直接违反现行
spec 明文「Pet MUST NOT 自带、声明或自动安装任何 Skill——不存在内置 Skill 这一
类别」，为了绕开类型必填而制造一个二等 Skill 正是该条款要防的事；（b）要求用户
导入一个 `chat` skill 并绑定给 channel —— 否决：把「问个问题」变成「执行某 skill」，
且用户必须先造一个 skill 才能使用 channel，与「飞书里随口一问」的意图相悖。

### D6 上下文：不注入历史，交给 Agent 自取

最初注入触发消息前后各若干条历史。真机验证暴露了它的根本问题：一条真实 prompt
达到 8142 字符，其中转发消息被截断在中间、`<p>` 标签裸露、多行结构被
`replace(/\s+/g, ' ')` 压成一行——**恰恰是话题、卡片、图片这些最需要看清的内容，
在压平中全部损失**，而代价是每次触发都付出数千 token。

改为：prompt 只给触发消息、触发者与会话标识，并告诉 Agent 它可以用 lark-cli 以
bot 身份自行读取。指向 lark-cli **自带的能力文档**（`skills list` / `skills read`）
而不是内联一份命令清单——后者会随 CLI 演进而失效，前者永远是最新的。

保留一次极小的历史读取，但**只为解析触发者显示名**（入站事件只有 open_id，而历史
API 会解析 `sender.name`），读到的内容不进 prompt、不落库。

能力可用性**每次触发实际探测**（`auth status` 看 bot 是否 ready）而非假设：bot 登录
过期时明确告知 Agent 读不了也回不了，让它如实说明限制，而不是自信地失败。

### D7 出站：系统只管表情，文字由 Agent 自己发

```
触发消息到达 ──▶ 打 OnIt（记 reaction_id，失败仅 log）
                 ↑ 必须在 dispatch 之前：acceptConversation 会 await 到派发完成，
                   快的 turn 在此期间就结束了，之后再打就成了"事后补标"甚至打不上
                    │
              Invocation 终态（Host 观测 executor turn 事件）
                    │
        ├─ succeeded ─▶ 删 OnIt → 打 done 表情
        └─ failed/cancelled ─▶ 删 OnIt → 打失败表情
```

**文字出站不在这条链上。** 最初的设计是 Host 在 turn 终态回传最后一段 assistant
文本（仅单聊）。真机验证否决了它：一旦 Agent 拿到 lark-cli，它会自己回复——于是
同一个问题收到两条答复，一条是 Agent 组织过的，一条是系统机械回传的 transcript
尾巴。而且系统那条永远只能是"最后一段文字"，无法选择内容、时机与形式。

因此改为：**系统只维护表情这类纯状态，回复归 Agent**。代价是回复目标不再由系统
解析，"只能发到绑定会话"从代码约束降为 prompt 约束——prompt 里明确给出本次
chat_id 与 message_id 并要求只回此处。这是有意的取舍：Agent 本来就持有 bot 身份的
shell，能力上无法真正限制，写进代码只会制造"已经拦住了"的错觉。

`invocation_channel` 仍然保留完整的回复目标信息：它是后续 `pet_reply`（受信、
caller-bound、模型不可指定目标）的基础，届时可为需要强约束的场景提供一条不依赖
自由 shell 的通道。

### D8 生命周期：channel 独立降级，指数退避，经 SIGTERM 回收

channel 是 Pet 的子状态机：`connected / reconnecting / down(原因)`，独立于 Pet
整体 degraded——飞书链路故障不影响浮层、面板与一期能力。子进程异常退出按指数
退避重启，达到上限进入 down 并在 Diagnostics 显示原因与显式重连操作；lark-cli
登录态失效（bot token 过期）是可预期的 down 原因，诊断文案指向 lark-cli 重新登录。

**bus daemon 中间层（spike 实测发现，非原设计假设）**：`lark-cli event consume`
不是自己持有 WebSocket，而是连接（必要时拉起）一个 app 级的 bus daemon：

```
Pet Host ──spawn──▶ lark-cli event consume ──▶ bus daemon（独立进程，app 级共享）
                         （我们的子进程）              │
                                              feishu-websocket
```

由此产生三条实现约束：

1. **回收必须用 SIGTERM，MUST NOT 用 SIGKILL**。lark-cli 明确警告 `kill -9`
   跳过清理并可能泄漏服务端订阅。Pet stopping 时向 consumer 发 SIGTERM 并等待
   其退出。
2. **daemon 不归 Pet 所有，也不由 Pet 回收**。它在最后一个 consumer 退出约 30s
   后自动退出；Pet 只对自己 spawn 的 consumer 负责，MUST NOT 尝试杀 daemon
   ——它可能正被本机其它 lark-cli 用途（如 lark-im-live）共用。
3. **诊断需区分两层**：Pet 的 connected 判定以「我们的 consumer 存活且已收到
   ready marker」为准；daemon 或上游 WebSocket 的状态经 consumer 的 stderr
   （`[source] feishu-websocket: connected`）与 `lark-cli event status` 观测，
   作为 down 时的归因信息展示，MUST NOT 让 daemon 层的共享状态影响 Pet 自身
   的启停判定。

ready marker 实测为 stderr 行 `[event] ready event_key=<key>`；连接建立另有
`[source] feishu-websocket: connected`。

### D9 持久化：sqlite v4，三张新表

```
channel_config      bot_open_id / bot_app_id / allow_open_ids /
                    default_workspace / enabled
chat_bindings       chat_id / chat_type(p2p|group) / workspace_id /
                    active_task_id / bound_by(auto|user) / bound_at
invocation_channel  invocation_id / chat_id / trigger_msg_id / root_id /
                    sender_open_id / reaction_id
```

v3 → v4 只增表不改旧表，不清存量数据。`invocation_channel` 即 spec 预铺的
Channel Binding 落地：后续 pet-lark-reply 的回复目标解析（caller-bound：executor
session → 当前 Invocation → 本表行）完全建立在它之上，本 change 不实现该工具。

### D10 实现前置 spike（tasks 第一项）

方案压在三个未实测假设上：bot 身份可长连订阅 `im.message.receive_v1` 且事件带可
识别自身的 mention 结构；bot 可拉群历史（需相应 scope 且 bot 在群）；bot 可对
消息打/删表情。spike 用真机跑通 consume → mention 识别 → 打表情 → 拉 20+10 →
删表情 → 单聊 reply 最小链路，全绿才进入实现；任一环不满足回到设计调整（如历史
拉不到则上下文退化为触发消息 + 引用链）。

**spike 已确证部分（本机 lark-cli 1.0.87，app `cli_a91b50b53178dbc4`）：**

- 订阅前置全绿：`consume --as bot --dry-run` 的 `credentials_available` /
  `console_event_published` / `scopes_granted` 均 ok。
- **群消息实测可收**：真机 consume 到 `chat_type: "group"` 事件，无需额外申请
  群消息 scope（event schema 只声明 `im:message.p2p_msg:readonly`，但平台默认
  bot 权限模板已覆盖群收消息——与 bridge 权限文档「以真实调用为准、不要从文档
  推断 scope」的结论一致）。
- **事件字段与设计假设完全吻合**：`chat_id` / `chat_type(p2p|group)` /
  `message_id`（schema 明确标注为推荐幂等键，且指出 `event_id` 不可用作去重键）
  / `create_time` / `mentions[{id,key,name}]` / `sender_id` / `sender_type(user|bot)`
  / `root_id` / `reply_to` / `thread_id`。
- **mention 过滤确为必需**：实测收到的首条群事件是 @另一个 bot 的消息，
  若不按自身 open_id 过滤会误触发。
- **bot 自身 open_id 的获取路径**：bridge 用 `GET /open-apis/bot/v3/info`
  （tenant token）读 `bot.open_id`；但 lark-cli 的 `api` 命令只提取标准 `data`
  信封，而该端点把结果放在顶层 `bot` 字段，故经 lark-cli 取不到。替代路径：
  `im +chat-members-list --member-types bot` 按自身 `app_id` 匹配 `member_id`
  （多个群结果一致，可交叉验证）。本机实测值：小小芒果
  `ou_023b15a8d3e5de253ffc32182a7dde35`。该值一次性解析后存入
  `channel_config.bot_open_id`，运行时不再依赖此查询。
- 可用命令面：`im reactions create/delete/list`（bot 身份，要求 bot 在会话中）、
  `im +chat-messages-list`（bot 身份，支持时间范围与 asc/desc 分页）、
  `im +messages-reply`（bot 身份，支持 thread reply 与幂等键）。

**写路径闭环已实测通过**（单聊真实消息 `om_x100b66e...`，测试残留已清理）：

- `im reactions create --as bot --message-id <om_> --data '{"reaction_type":
  {"emoji_type":"OnIt"}}'` → 返回 `data.reaction_id`，即
  `invocation_channel.reaction_id` 的来源。
- `im reactions delete --as bot --message-id <om_> --reaction-id <rid>` → ok。
- `im reactions list` 可枚举某条消息上的全部 reaction（含 reaction_id），是
  表情状态漂移时的对账手段。
- `im +chat-messages-list --as bot --chat-id <oc_> --order desc --page-size N`
  → ok，且返回值比预期丰富：`sender.name` 已解析（无需另调通讯录）、
  `reactions` 内嵌、`message_position` 可用于精确定位「向上/向下」区间、
  `has_more` 支持分页。
- `im +messages-reply --as bot --message-id <om_> --text <...>` → ok，返回新
  消息 id。
- `emoji_type` 容错性极高：`DONE`/`Done`/`CheckMark`/`THUMBSUP` 均被接受并各自
  成为独立 reaction（大小写变体不合并）。因此选型是纯产品决定而非可用性约束；
  **实现取 `OnIt`（进行中）/ `DONE`（完成）/ 失败态待定**，并在实现时集中为
  常量便于调整。

**p2p 会话的隐私限制（新发现，影响设置页能力边界）**：bot 身份
MUST NOT 也无法列举 p2p 会话——`+chat-list --types p2p` 明确拒绝
（"To protect user privacy, bot identity cannot list p2p chats"），
`+chat-messages-list --user-id` 同样要求 user 身份。**p2p 的 `chat_id` 只能
从入站事件中获得**。推论：单聊绑定行只能在首次收到该会话消息时由入站流程
创建，设置页 MUST NOT 承诺「手工新增一个单聊绑定」的入口，只能展示与改绑
已由事件建立的行。群聊无此限制（`+chat-list` 可列群）。

**daemon 复用已实测**：第二次 `consume` 未再打印 `started bus daemon`，直接
进入 ready，证实 D8 描述的 app 级共享 daemon 行为。

**事件流不补发**：订阅建立前发生的消息不会在订阅后重投（spike 中实测一次
错过窗口即丢失）。这与 D2 的启动水位设计一致——水位丢弃的是重连重放，而
非用于补历史；Pet 重启期间到达的消息将不被处理，属已知且可接受的行为。

## Risks / Trade-offs

- [workspace-resident 绕开一期 Skill 边界，executor 在真实仓库有全量能力] →
  信任前移：触发人只有 allowlist 内用户（即机器所有者本人），绑定显式可查可改；
  spec 诚实声明边界不承诺，不制造虚假安全感。
- [群聊历史注入 prompt 构成提示注入面] → 历史块显式标注非指令；触发权仍仅限
  allowlist（注入内容只能影响所有者自己发起的执行）；不落库缩小持久暴露面。
- [lark-cli 契约漂移（NDJSON 格式 / ready-marker / scope）] → spike 前置验证 +
  channel 解析层单独封装并测试；解析失败进 down 而非崩 Pet。
- [WS 重连重放 / 事件乱序] → msg_id TTL 去重 + 启动水位双防线；Invocation 创建
  以 trigger_msg_id 幂等（同 msg 不二次建）。
- [单聊自动回复可能过长/含敏感产物] → 截断 + 指向 DSH；收件人即触发者本人，
  无第三方暴露。
- [队列积压（连续多条 @后 executor 慢）] → 每条消息 OnIt 已确认收到；不做队列
  上限与超时（个人单用户场景），Diagnostics 展示队列深度供观察。
- [active_task_id 指针与 DSH 归档状态漂移] → 消费时校验 Task 实际状态，悬空/
  已归档即新建并修指针（自愈而非报错）。

## Migration Plan

1. sqlite v4 migration 随插件升级自动执行（只增表，可安全回滚到 v3 读取）。
2. channel 默认 disabled：升级后需在设置页显式启用并完成 allowlist / default
   workspace 配置，避免「升级即开始消费飞书事件」。
3. 回滚 = 设置禁用 channel（子进程停止，其余 Pet 能力不受影响）或 `dsh.yaml`
   禁用整个 Pet；新表数据保留。

## Open Questions

- ~~bot 接收群消息是否需要额外 scope~~ → **已解答**：不需要，真机实测收到群事件。
- ~~bot 自身 open_id 如何获取~~ → **已解答**：见 D10（`im +chat-members-list`
  按 app_id 匹配；bridge 的 `/open-apis/bot/v3/info` 经 lark-cli 取不到）。
- ~~bot 拉取历史消息的实际可用性~~ → **已解答**：单聊实测可拉（见 D10）；
  群聊拉取待实现阶段用真实绑定群验证（bot 在群即应可用，同一 API）。
- ~~表情选型可用性~~ → **已解答**：emoji_type 容错性高，选型为产品决定；
  失败态用哪个 emoji 留待实现时定（不阻塞）。
- waiting-user 续输入的精确接线（Pet 现有 waiting-user 投影 → DSH 用户输入通道
  的对接点），实现时确认。
- 单聊自动回复的文本长度上限与截断阈值：spike 的短文本 reply 成功，未探到上限；
  实现时取保守阈值并在超限错误上做降级（截断重发），不预设精确数值。
