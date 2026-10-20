## ADDED Requirements

### Requirement: 模式与改写规则
系统 SHALL 为每个主会话提供 `AUTO` 与 `MANUAL` 两种模式，默认 `MANUAL`，按会话持久化。改写规则按以下三种互斥状态：
- **AUTO**：系统 SHALL 只改写主会话请求的 reasoning effort，MUST NOT 改写 provider 与 model；同一回合内一经决定即不再变化。
- **MANUAL 过渡**：从 `AUTO` 切为 `MANUAL` 后产生复原义务，无论当前属于哪个回合。当官方合成 provider/model 与最新锚点相等时，系统 SHALL 写回锚点 effort（无则移除字段），`reason` 为 `manual-restore`；不匹配时 SHALL 透传并保留义务，MUST NOT 改 provider/model。只有观察到锚点配置已进入持久请求头，且当前官方合成配置也与最新锚点精确相等后，才可清除义务并透传；此前同一步重试 SHALL 继续复原。无请求头、取消、prepareCall 失败均不得提前清除义务。
- **MANUAL**（其余情况）：系统 MUST NOT 改写任何字段。
切 MANUAL SHALL 废止当前回合旧 AUTO 决定；再次切 AUTO 只能在下一用户回合首个请求重新决定，此前 MUST NOT 恢复旧 AUTO 缓存，复原义务继续有效。下一用户回合边界仍未完成复原时 SHALL 先完成复原，该回合不启用 AUTO；复原完成后的下一用户回合才启用 AUTO。重复设置相同模式 SHALL 为无副作用操作。插件未加载时不请求 Jev、不改写，不承诺清除已残留的 AUTO effort。

#### Scenario: MANUAL 请求原样通过
- **GIVEN** 会话为 `MANUAL` 且非过渡请求，官方合成配置为 `claude/claude-opus-5-5`、effort `high`
- **WHEN** 主会话发出一次模型请求
- **THEN** 路由器输出与官方合成配置深度相等

#### Scenario: AUTO 只改 effort
- **GIVEN** 会话为 `AUTO`，锚点 `claude/claude-opus-5-5`、`medium`，本回合级别映射为 `xhigh`
- **WHEN** 本回合首个请求经过路由器
- **THEN** 输出 provider 为 `claude`、model 为 `claude-opus-5-5`、effort 为 `xhigh`

#### Scenario: MANUAL 复原覆盖旧快照重试直至收敛
- **GIVEN** 会话为 `AUTO`，官方已 assemble `xhigh`，锚点为同模型 `medium`
- **WHEN** 切 MANUAL 后发出请求并在同 step 失败重试，随后重新 assemble
- **THEN** 首次请求与重试均为 `medium`，旧快照期间复原义务不清除；只有持久请求头及重新合成配置均为锚点时清除，后续透传仍为 `medium`

#### Scenario: header 前取消或准备失败保留复原
- **GIVEN** MANUAL 复原待完成，官方旧快照为 `xhigh`、锚点为 `medium`
- **WHEN** 首次尝试在 header 持久化前取消或 prepareCall 失败，随后再次请求
- **THEN** 失败后义务仍在，再次请求输出 `medium`，不因首次返回配置而清除义务

#### Scenario: 快速切回 AUTO 不恢复旧决定
- **GIVEN** 当前回合 AUTO 已决定 `xhigh`，锚点 `medium`
- **WHEN** 切 MANUAL 后分别在已复原、尚未复原两种情况下切 AUTO，并继续当前回合请求
- **THEN** 两种序列均不再输出旧 AUTO `xhigh`；继续复原到 `medium`，完成前不请求 Jev，完成后的下一用户回合才重新启用 AUTO

#### Scenario: 重复同模式设置不重建过渡
- **GIVEN** MANUAL 已完成复原
- **WHEN** 再次设置 MANUAL
- **THEN** 状态存储不变，不创建新复原义务

#### Scenario: 非用户回合同样完成复原
- **GIVEN** 会话刚切为 `MANUAL`，下一个回合由子会话完成通知（`source.kind` 不为 `user`）开启
- **WHEN** 该回合首个请求经过路由器
- **THEN** 该请求 effort 为锚点 effort，`reason` 为 `manual-restore`

### Requirement: 锚点由用户选择维护
系统 SHALL 按会话保存锚点 `{provider, model, effort?, provenance}`：`provenance = "user-selected"` 来自该会话最近一次 `model/selection` 事件；会话尚无该事件时以首个请求的官方合成配置初始化为 `initialized`，仅一次。锚点 MUST 只由 `model/selection` 事件更新，MUST NOT 由请求头或路由结果更新；模式、锚点与过渡标记 SHALL 在 Host 重启后保留。

#### Scenario: 首个请求初始化锚点
- **GIVEN** 会话无 `model/selection` 事件，首个请求的官方合成配置为 `codex/gpt-6.1-sol`、`medium`
- **WHEN** 首个请求经过路由器后读取锚点
- **THEN** 锚点为 `{codex, gpt-6.1-sol, medium, provenance: initialized}`

#### Scenario: 用户手选更新锚点
- **GIVEN** 锚点 provenance 为 `initialized`
- **WHEN** 会话追加 `model/selection` 事件 `{provider: codex, model: gpt-6-astra, reasoningEffort: low}`
- **THEN** 锚点为 `{codex, gpt-6-astra, low, provenance: user-selected}`

#### Scenario: 路由结果与重启不改锚点
- **GIVEN** 锚点为 `user-selected`、effort `medium`，前 3 个回合路由器输出 `low`、`xhigh`、`high`
- **WHEN** Host 重启后恢复该会话并读取锚点
- **THEN** 锚点 effort 仍为 `medium`，provenance 仍为 `user-selected`

#### Scenario: assemble 后手选不混用模型与 effort
- **GIVEN** 官方已 assemble Opus/xhigh，用户随后手选 Astra/low 并更新锚点，本回合级别为 complex
- **WHEN** 旧快照请求在 AUTO 下处理，以及同一时序改为 MANUAL 后处理
- **THEN** AUTO 按实际 Opus 输出 xhigh；MANUAL 透传旧 Opus/xhigh 并保留复原义务；后续 step 官方采用 Astra/low 时，MANUAL 输出 Astra/low，持久 header 精确匹配后 pending 被消费，锚点保持 Astra/low

### Requirement: 用户回合与分类输入
系统 SHALL 只在 step 1 的 `agent/pre-step` 中判定用户回合并请求 Jev 判断：**合格消息**为该次领取消息中 `source.kind` 严格等于 `"user"` 的消息；其它来源（含首轮 Host 注入的 `agent-instructions`、`plugin`、`plugin:<id>`、`runtime-context`、`time-context`、`skill-catalog`）与缺失 `source` 的消息 MUST NOT 贡献输入。合格消息数为 0 的回合不是用户回合，沿用上一用户回合的级别且不请求 Jev；首个用户回合之前无级别时不改写。分类输入为合格消息按领取顺序、消息内按块顺序的 `text` 块文本，以 `"\n"` 连接后取 `.slice(0, 8000)`；非文本块不贡献。决定 SHALL 按 (agent, turn) 保存，同回合后续请求（含同 turn/step 的错误重试）复用该决定。`origin = "subagent"` 会话 MUST NOT 被分类或改写。

#### Scenario: 首轮真实领取序列只取用户消息
- **GIVEN** step 1 领取消息依次为 `agent-instructions`（文本 A）、`plugin:dsh-memex`（文本 B）、`runtime-context`（文本 C）、`skill-catalog`（文本 D）、`user`（文本“修复登录 bug”）
- **WHEN** 路由器构造分类输入
- **THEN** 分类输入恰为“修复登录 bug”

#### Scenario: 多条用户消息按序拼接并截断
- **GIVEN** step 1 领取两条 `user` 消息，第一条文本“先看日志”，第二条含文本“再改配置”与一个图片块；另有一条无 `source` 的消息（文本 X）
- **WHEN** 路由器构造分类输入
- **THEN** 分类输入恰为“先看日志\n再改配置”；若拼接结果长度超过 8000，则等于其 `.slice(0, 8000)`

#### Scenario: 同回合与重试复用决定
- **GIVEN** 用户回合 T 首个请求已决定 effort `high`
- **WHEN** 回合 T 内第 2 至第 5 个请求到达，其中一次为同 (turn, step) 的错误重试
- **THEN** 这些请求的 effort 均为 `high`，回合 T 内 Jev 请求次数为 1

#### Scenario: 非用户回合沿用上一级别
- **GIVEN** 上一用户回合级别为 `complex`，会话为 `AUTO`
- **WHEN** 一个由子会话完成通知开启的回合发出首个请求
- **THEN** 该请求 effort 为 `complex` 对应 effort，Jev 请求次数不增加

#### Scenario: 子会话请求不被改写
- **GIVEN** 父会话为 `AUTO`，一个 `origin = subagent` 的会话发出请求
- **WHEN** 请求经过路由器
- **THEN** 输出与官方合成配置深度相等，Jev 请求次数为 0

### Requirement: Jev 判断档位
系统 SHALL 在 AUTO、无复原义务的用户回合 step 1 中，以一次 Jev `choice` 请求得出本回合档位 `simple | standard | complex | escalated`：经 `POST https://openrouter.ai/api/alpha/decisions`，模型 `typesafe/jev-1.13`，凭据取自进程环境 `OPENROUTER_API_KEY`；请求 `state` 包含上一用户回合档位（无则 `none`）与本回合分类输入；单次请求期限 3000ms，MUST NOT 重试。成功时 SHALL 采用响应 `answers.tier.choice` 作为档位，`reason` 为 `jev`，不设置信度门槛。系统 MUST NOT 包含本地规则、关键词或通用对话模型的分类路径。请求 MUST NOT 携带锚点、会话状态、其它会话内容或凭据以外的鉴权信息；出站主机 SHALL 仅为 `openrouter.ai`。

#### Scenario: 成功判断采用 Jev 档位
- **GIVEN** 会话为 `AUTO`，Jev 对本回合返回 `choice: complex`，实际模型为 `claude-opus-5-5`
- **WHEN** 本回合首个请求经过路由器
- **THEN** 输出 effort 为 `xhigh`，`reason` 为 `jev`，provider/model 不变，本回合 Jev 请求次数为 1

#### Scenario: 请求内容受限
- **GIVEN** 上一用户回合档位为 `standard`，本回合分类输入为“继续”
- **WHEN** 路由器向 Jev 发起请求
- **THEN** 请求地址为 `https://openrouter.ai/api/alpha/decisions`，body 的 `model` 为 `typesafe/jev-1.13`，`state` 含 `standard` 与“继续”，不含锚点或其它会话字段；`Authorization` 为 Bearer 凭据；超时 3000ms 且失败后无第二次请求

#### Scenario: 源码不含本地分类与其它出站
- **GIVEN** `packages/auto-model-routing/src/` 源码
- **WHEN** 测试扫描源码文本
- **THEN** 不存在 `classify` 导出或关键词词表；唯一出站 URL 主机为 `openrouter.ai`；不出现 `node:http`、`node:https`、`node:child_process`

### Requirement: Jev 失败即停用并提示
Jev 调用失败时，系统 SHALL 不改写本请求 effort 之外的任何字段，并把该会话转为 `MANUAL`（与用户切 MANUAL 相同：产生复原义务、废止本回合 AUTO 决定），同时持久记录 `disabled = {category, at}`；MUST NOT 以任何本地规则或其它模型得出档位。失败类别为闭集：`missing-credential`（凭据缺失，不发请求）、`insufficient-credits`（402）、`unauthorized`（401/403）、`rate-limited`（429）、`region-blocked`（451）、`rejected`（其它 4xx）、`unavailable`（5xx 或网络错误）、`timeout`（期限到达）、`invalid-response`（非 JSON、缺 choice 或 choice 不在四级内）。调用方取消（用户取消回合）MUST NOT 视为失败：不停用、不写 `disabled`、本回合不改写。停用 SHALL 保持到用户把模式设为 `AUTO`，此时清除 `disabled`；系统 MUST NOT 轮询、主动查询余额或自动恢复 AUTO。`disabled`、错误结果与日志 MUST NOT 包含凭据或响应体。

#### Scenario: 各状态码映射为闭集类别
- **GIVEN** 假 Jev 服务分别返回 402、401、403、429、451、404、500、网络断开、超过 3000ms 无响应、200 但 body 非 JSON、200 但 choice 为 `huge`，以及进程环境缺少凭据
- **WHEN** 每种情况下 AUTO 会话发起一个用户回合
- **THEN** `disabled.category` 依次为 `insufficient-credits`、`unauthorized`、`unauthorized`、`rate-limited`、`region-blocked`、`rejected`、`unavailable`、`unavailable`、`timeout`、`invalid-response`、`invalid-response`、`missing-credential`；缺凭据时假服务未收到请求

#### Scenario: 停用后不再调用 Jev 且复原锚点
- **GIVEN** 锚点为同模型 `medium`，上一回合 AUTO 已输出 `xhigh`，本回合 Jev 返回 402
- **WHEN** 本回合首个请求及下一用户回合请求经过路由器
- **THEN** 会话为 `MANUAL` 且 `disabled.category` 为 `insufficient-credits`；两次请求 effort 均为 `medium`（`reason: manual-restore`），下一用户回合 Jev 请求次数为 0

#### Scenario: 用户重新点 AUTO 清除停用
- **GIVEN** 会话因 `timeout` 停用，复原已完成
- **WHEN** 用户把模式设为 `AUTO`，下一用户回合 Jev 返回 `simple`
- **THEN** `disabled` 被清除；该回合 Jev 请求 1 次，effort 为 `simple` 对应值

#### Scenario: 用户取消不是失败
- **GIVEN** 会话为 `AUTO`，Jev 请求进行中
- **WHEN** 用户取消该回合
- **THEN** Jev 请求被中止；会话仍为 `AUTO`，无 `disabled`，下一用户回合重新请求 Jev

#### Scenario: 凭据与响应体不泄漏
- **GIVEN** 凭据为 `sk-or-test-SECRET`，假服务返回 401 且响应体含 `SECRET-BODY`
- **WHEN** 读取状态文件、状态端点响应与面板渲染文本
- **THEN** 均不含 `sk-or-test-SECRET` 或 `SECRET-BODY`

### Requirement: 级别与 effort 映射
系统 SHALL 把档位经代码常量映射表按 `await next()` 得到的实际官方 provider/model 转为 effort（表见 design D9），MUST NOT 将尚未生效的新锚点模型表套在旧模型快照上；同回合实际模型变化时 SHALL 按新模型重新映射，不重新请求 Jev。目标 effort 不被该模型支持时取不超过目标的最高受支持值，无则取最低受支持值；模型不支持任何 effort 时不改写，`reason` 为 `no-effort-support`。

#### Scenario: 档位映射为 effort
- **GIVEN** 实际模型 `claude-opus-5-5`，本回合档位 `standard`
- **WHEN** 路由器计算 effort
- **THEN** 输出 effort 为 `medium`

#### Scenario: 不支持的 effort 被截断
- **GIVEN** 实际模型支持 `[low, medium, high, max]`，映射要求 `xhigh`
- **WHEN** 路由器计算 effort
- **THEN** 输出 effort 为 `high`

#### Scenario: 无 effort 支持时不改写
- **GIVEN** 实际模型目录信息中无 reasoning efforts，档位 `complex`
- **WHEN** 请求经过路由器
- **THEN** 输出与官方合成配置深度相等，`reason` 为 `no-effort-support`

#### Scenario: 同回合换模型重新映射
- **GIVEN** 本回合档位 `complex`，首个请求实际模型 Opus 输出 `xhigh`
- **WHEN** 同回合后续请求实际模型变为 `gpt-6-astra`
- **THEN** 输出 effort 为 `medium`，Jev 请求次数仍为 1

### Requirement: 子会话决策工具与 skill
系统 SHALL 注册 Host 工具 `route_subagent`，参数 `{task: string, provider: "claude" | "codex"}`：以与主会话相同的 Jev 客户端与失败类别判断档位（`state` 不含上一档位），成功返回 `{tier, provider, model, reasoning_effort}`（取自 design D9 子会话表，代码常量为唯一来源）；失败返回错误结果，内容为该类别提示与“暂停委派并询问用户”。工具 MUST NOT 改写任何会话状态，不受主会话模式或 `disabled` 影响。系统 SHALL 提供 skill `subagent-model-routing`，其文本须要求：(1) 委派前调用 `route_subagent`；(2) 将返回的 `provider`、`model`、`reasoning_effort` 全部显式传给官方 `subagent`；(3) 在 `description` 末尾以 `[model·effort]` 标注；(4) 默认 provider 为当前会话 provider，用户或 lead 要求独立体系时改用另一个；(5) 工具失败时暂停委派并询问用户，MUST NOT 自行猜测档位、改由主会话完成或换用其它模型；(6) 复用已有子会话前比较其标注，更高或无法确认时新建。路由器 MUST NOT 改写子会话的创建参数或请求。

#### Scenario: 工具成功返回表中条目
- **GIVEN** Jev 对任务返回 `complex`
- **WHEN** 以 `provider: claude` 与 `provider: codex` 分别调用 `route_subagent`
- **THEN** 分别返回 `{complex, claude, claude-opus-5-5, xhigh}` 与 `{complex, codex, gpt-6.1-sol, xhigh}`

#### Scenario: 工具失败返回类别且不改状态
- **GIVEN** Jev 返回 402，主会话 S1 为 `AUTO` 且无 `disabled`
- **WHEN** 调用 `route_subagent`
- **THEN** 结果为错误，内容含“余额不足”与“暂停委派并询问用户”；S1 仍为 `AUTO` 且无 `disabled`

#### Scenario: 子会话表与家族一致
- **GIVEN** 代码中的子会话表常量
- **WHEN** 测试逐级断言并按 Claude 家族规则检查
- **THEN** 每级 model/effort 等于 design D9；`claude` 条目全为 Claude 家族，`codex` 条目全非 Claude 家族

#### Scenario: skill 文本包含六项规则
- **GIVEN** `skills/subagent-model-routing/SKILL.md`
- **WHEN** 测试读取其文本
- **THEN** 文本包含 `route_subagent`、`reasoning_effort`、`[model·effort]`、独立体系规则、“暂停委派并询问用户”及复用“新建”规则，且不含档位表模型名

### Requirement: 状态可见且不改写其它控件
系统 SHALL 在 composer 的 `conversation.input.right` 列表以负的 `order` 注册 `AUTO / MANUAL` 芯片（GPT 速度芯片为 `order: 0`）。展开面板 SHALL 显示锚点（含 provenance）、本回合 effort 与 `reason`，以及最近 20 条决定（仅 Host 内存，重启后清空）。`reason` 取值为闭集 `jev | continued | no-effort-support | manual-restore | jev-failed`（`continued` 为非用户回合沿用上一级别）。会话存在 `disabled` 时，芯片 SHALL 以区别于正常状态的警示样式显示停用，并在芯片文本或 title 中给出该失败类别的人类可读提示；面板 SHALL 显示类别、提示、发生时间及“点击 AUTO 重试”。芯片 MUST NOT 调用官方模型选择接口或速度芯片的设置接口。

#### Scenario: 芯片注册在速度芯片左侧
- **GIVEN** client bundle 已加载
- **WHEN** 读取 `conversation.input.right` 的注册项
- **THEN** 本芯片 `order` 小于 0

#### Scenario: 面板展示状态并限 20 条
- **GIVEN** Host 已为某会话产生 25 条决定，最新一条为 `{effort: xhigh, reason: jev}`，锚点 `claude/claude-opus-5-5/medium`
- **WHEN** 读取状态接口并渲染面板
- **THEN** 面板文本包含 `claude-opus-5-5`、`xhigh`、`jev`，历史列表恰含 20 条

#### Scenario: 停用状态在芯片与面板可见
- **GIVEN** 会话 `disabled = {category: insufficient-credits}`，模式为 `MANUAL`
- **WHEN** 渲染芯片与展开面板
- **THEN** 芯片带停用警示样式且其文本或 title 含“余额不足”；面板含 `insufficient-credits`、“余额不足”与“点击 AUTO 重试”；无 `disabled` 时芯片不带警示样式

#### Scenario: 切换模式只调用插件接口
- **GIVEN** 用户点击芯片切换模式
- **WHEN** 记录本次交互发出的 RPC
- **THEN** 只调用本插件的设置模式接口，未调用官方模型选择或 `subscriptions-auth.setSpeed`

### Requirement: Host 端点边界
本插件只提供两个经 `connection.fetch.register` 注册的端点：读取状态与设置模式。两者 SHALL 以请求体 `sessionId` 经官方会话控制器解析目标会话（与官方会话端点同一授权模型）；`sessionId` 缺失、非字符串、无法解析或指向 `origin = "subagent"` 会话时 SHALL 返回 4xx 且不修改任何状态；设置模式 SHALL 只修改该会话的模式、过渡标记与 `disabled`（设为 `AUTO` 时清除），`mode` 不属于 `AUTO | MANUAL` 时返回 4xx；读取状态 SHALL 返回 `disabled`（如有）。

#### Scenario: 无效会话被拒绝且无副作用
- **GIVEN** 会话 S1 为 `AUTO`；`session-unknown` 无法解析；`session-child` 为子会话
- **WHEN** 分别以无 `sessionId`、`sessionId: 42`、`session-unknown`、`session-child` 调用设置模式（`MANUAL`）
- **THEN** 四次均返回 4xx；S1 仍为 `AUTO`；所有会话状态不变

#### Scenario: 只修改目标会话
- **GIVEN** 会话 S1 与 S2 均为 `AUTO`
- **WHEN** 以 `sessionId: S1, mode: "MANUAL"` 调用设置模式
- **THEN** S1 为 `MANUAL` 且过渡标记已设置；S2 的模式、锚点与过渡标记不变

### Requirement: 自动选路不得绕过既有模型门禁
自动选定的 effort SHALL 经过与手选路由相同的既有门禁；由于主会话不改 provider 与 model，`home-network-model-guard` 的 client 与 Host 判定针对同一模型。系统 MUST NOT 在门禁拒绝后改变 provider 或模型。`route_subagent` 返回的模型同样由官方创建参数校验与门禁把关，系统 MUST NOT 在其被拒绝后自行换模型。

#### Scenario: 门禁拒绝不引起改路由
- **GIVEN** 网络门禁对 Claude 为 `blocked`，锚点为 Claude，AUTO 决定 effort `xhigh`
- **WHEN** 请求被门禁拒绝，同回合下一请求到达
- **THEN** 下一请求的 provider 与 model 仍为锚点值
