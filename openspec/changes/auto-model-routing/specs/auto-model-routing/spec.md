## ADDED Requirements

### Requirement: 模式与改写规则
系统 SHALL 为每个主会话提供 `AUTO` 与 `MANUAL` 两种模式，默认 `MANUAL`，按会话持久化。
- **AUTO**：系统 SHALL 只改写主会话请求的 reasoning effort，MUST NOT 改写 provider 与 model；同一回合内一经决定即不再变化。
- **MANUAL**：系统 MUST NOT 改写任何字段，也 MUST NOT 把 effort 写回任何先前的值。切到 MANUAL 只是停止自动调整；此后请求使用官方当前选择（运行时在无待生效手选时沿用上一次实际请求的配置），由用户在官方模型选择器中自行调整。
切 MANUAL SHALL 废止当前回合的 AUTO 决定：同回合后续请求不再改写。再次切 AUTO 只能在下一用户回合首个请求重新决定，此前 MUST NOT 恢复旧 AUTO 决定。重复设置相同模式 SHALL 为无副作用操作。插件不保存锚点、不维护复原义务；未加载时不请求 Jev、不改写。

#### Scenario: MANUAL 请求原样通过
- **GIVEN** 会话为 `MANUAL`，官方合成配置为 `claude/claude-opus-5-5`、effort `high`
- **WHEN** 主会话发出一次模型请求
- **THEN** 路由器输出与官方合成配置深度相等

#### Scenario: AUTO 只改 effort
- **GIVEN** 会话为 `AUTO`，官方合成 `claude/claude-opus-5-5`、`medium`，本回合级别映射为 `xhigh`
- **WHEN** 本回合首个请求经过路由器
- **THEN** 输出 provider 为 `claude`、model 为 `claude-opus-5-5`、effort 为 `xhigh`

#### Scenario: 切回 MANUAL 不复原
- **GIVEN** 会话为 `AUTO`，本回合已输出 `xhigh`；官方此后合成配置为 `xhigh`（沿用上一请求）
- **WHEN** 切 MANUAL 后同回合与下一回合发出请求
- **THEN** 两个请求均与官方合成配置深度相等（effort 仍为 `xhigh`），MANUAL 请求不向历史追加条目

#### Scenario: AUTO 期间的手选在切回 MANUAL 后生效
- **GIVEN** 会话为 `AUTO`，用户在 AUTO 期间手选 `medium`（官方待生效手选），AUTO 仍按判档输出 `xhigh`
- **WHEN** 切 MANUAL 后发出请求
- **THEN** 请求与官方合成配置深度相等（effort 为手选的 `medium`），插件不改写

#### Scenario: 快速切回 AUTO 不恢复旧决定
- **GIVEN** 当前回合 AUTO 已决定 `xhigh`；为区分是否沿用旧决定，测试注入官方合成 `medium`
- **WHEN** 切 MANUAL 后再切 AUTO，并继续当前回合请求
- **THEN** 当前回合请求与官方合成配置深度相等（不改写，不输出旧 AUTO 决定）；下一用户回合重新请求 Jev 并按其结果改写

#### Scenario: 重复同模式设置无副作用
- **GIVEN** 会话为 `MANUAL`
- **WHEN** 再次设置 MANUAL
- **THEN** 状态存储不发生写入

#### Scenario: 旧状态文件可读
- **GIVEN** 状态文件为旧格式，含 `restore` 与 `anchor` 字段
- **WHEN** 插件读取该会话状态
- **THEN** 读取成功，模式与 `disabled` 保留；读取不触发重写，旧字段在下次写入时去掉；`mode` 或 `disabled` 形状非法时仍拒绝，不回退为默认值

### Requirement: 用户回合与分类输入
系统 SHALL 只在 step 1 的 `agent/pre-step` 中、先执行 `await next()` 得到 `PreStepDecision` 后判定用户回合并请求 Jev 判断：结果为 `reject` 时 MUST NOT 请求 Jev、MUST NOT 记录本回合决定；结果为 `enter` 时只使用其 `messages`。**合格消息**为该次领取消息中 `source.kind` 严格等于 `"user"` 的消息；其它来源（含首轮 Host 注入的 `agent-instructions`、`plugin`、`plugin:<id>`、`runtime-context`、`time-context`、`skill-catalog`）与缺失 `source` 的消息 MUST NOT 贡献输入。合格消息数为 0 的回合不是用户回合，沿用上一用户回合的级别且不请求 Jev；首个用户回合之前无级别时不改写。分类输入为合格消息按领取顺序、消息内按块顺序的 `text` 块文本，以 `"\n"` 连接后取 `.slice(0, 8000)`；非文本块不贡献。决定 SHALL 按 (agent, turn) 保存，同回合后续请求（含同 turn/step 的错误重试）复用该决定。`origin = "subagent"` 会话 MUST NOT 被分类或改写。

#### Scenario: 步骤被拒时不请求 Jev
- **GIVEN** 会话为 `AUTO`，下游 pre-step listener 对 step 1 返回 `{kind: reject}`
- **WHEN** 该步骤被提交
- **THEN** Jev 请求次数为 0，本回合无决定；之后同回合重新提交并 `enter` 时请求 Jev 1 次

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
系统 SHALL 在 AUTO 的用户回合 step 1 中，以一次 Jev `choice` 请求得出本回合档位 `simple | standard | complex | escalated`：经 `POST https://openrouter.ai/api/alpha/decisions`，模型 `typesafe/jev-1.13`，凭据每次调用时经官方 launch environment 读取 `OPENROUTER_API_KEY`；`questions` 为主会话与 `route_subagent` 共用的常量 `TIER_QUESTIONS`（四级 criteria 见 design D4）；请求 `state` 包含上一用户回合档位（无则 `none`）与本回合分类输入；单次请求期限 3000ms，`redirect: 'error'`，MUST NOT 重试。Jev 返回后 SHALL 重新读取会话状态，等待期间模式已变时丢弃该结果（不写决定、不写 `disabled`）。成功时 SHALL 采用响应 `answers.tier.choice` 作为档位，`reason` 为 `jev`，不设置信度门槛。系统 MUST NOT 包含本地规则、关键词或通用对话模型的分类路径。请求 MUST NOT 携带会话状态、其它会话内容或凭据以外的鉴权信息；出站主机 SHALL 仅为 `openrouter.ai`。

#### Scenario: 成功判断采用 Jev 档位
- **GIVEN** 会话为 `AUTO`，Jev 对本回合返回 `choice: complex`，实际模型为 `claude-opus-5-5`
- **WHEN** 本回合首个请求经过路由器
- **THEN** 输出 effort 为 `xhigh`，`reason` 为 `jev`，provider/model 不变，本回合 Jev 请求次数为 1

#### Scenario: 请求内容受限
- **GIVEN** 上一用户回合档位为 `standard`，本回合分类输入为“继续”
- **WHEN** 路由器向 Jev 发起请求
- **THEN** 请求地址为 `https://openrouter.ai/api/alpha/decisions`，body 的 `model` 为 `typesafe/jev-1.13`，`state` 含 `standard` 与“继续”，不含其它会话字段；`Authorization` 为 Bearer 凭据；超时 3000ms 且失败后无第二次请求

#### Scenario: 等待期间切换模式丢弃结果
- **GIVEN** 会话为 `AUTO`，Jev 请求进行中
- **WHEN** 用户在 Jev 返回前切为 `MANUAL`，随后 Jev 分别返回 `complex` 或 HTTP 402
- **THEN** 两种情况本回合均不按 Jev 改写 effort；会话为 `MANUAL`，无 `disabled`

#### Scenario: 不跟随重定向
- **GIVEN** 假 Jev 服务返回 302 指向其它主机
- **WHEN** AUTO 会话发起用户回合
- **THEN** 不请求重定向目标，`disabled.category` 为 `rejected`

#### Scenario: 源码不含本地分类与其它出站
- **GIVEN** `packages/auto-model-routing/src/` 源码
- **WHEN** 测试扫描源码文本
- **THEN** 不存在 `classify` 导出或关键词词表；唯一出站 URL 主机为 `openrouter.ai`；不出现 `node:http`、`node:https`、`node:child_process`

### Requirement: Jev 失败即停用并提示
Jev 调用失败时，系统 SHALL 把该会话转为 `MANUAL`（与用户切 MANUAL 相同：废止本回合 AUTO 决定，本回合不改写、不复原 effort），MUST NOT 改写 provider/model，同时持久记录 `disabled = {category, at}`，并向历史追加 `{reason: jev-failed, category}`（不含 effort）；MUST NOT 以任何本地规则或其它模型得出档位。失败类别为闭集：`missing-credential`（凭据缺失，不发请求）、`insufficient-credits`（402）、`unauthorized`（401/403）、`rate-limited`（429）、`region-blocked`（451）、`rejected`（其它 4xx）、`unavailable`（5xx 或网络错误）、`timeout`（期限到达）、`invalid-response`（非 JSON、缺 choice 或 choice 不在四级内）。HTTP 200 但 body 含数字 `error.code` 时 SHALL 按该 code 套用上述映射。调用方取消（用户取消回合）MUST NOT 视为失败：不停用、不写 `disabled`、本回合不改写。停用 SHALL 保持到用户把模式设为 `AUTO`，此时清除 `disabled`；系统 MUST NOT 轮询、主动查询余额或自动恢复 AUTO。`disabled`、错误结果与日志 MUST NOT 包含凭据或响应体。

#### Scenario: 各状态码映射为闭集类别
- **GIVEN** 假 Jev 服务分别返回 402、401、403、429、451、404、500、网络断开、超过 3000ms 无响应、200 但 body 非 JSON、200 但 choice 为 `huge`、200 但 body 为 `{error: {code: 402}}`，以及 launch environment 中缺少凭据
- **WHEN** 每种情况下 AUTO 会话发起一个用户回合
- **THEN** `disabled.category` 依次为 `insufficient-credits`、`unauthorized`、`unauthorized`、`rate-limited`、`region-blocked`、`rejected`、`unavailable`、`unavailable`、`timeout`、`invalid-response`、`invalid-response`、`insufficient-credits`、`missing-credential`；缺凭据时假服务未收到请求

#### Scenario: 停用后不再调用 Jev 且不改写
- **GIVEN** 上一回合 AUTO 已输出 `xhigh`，官方此后合成 `xhigh`，本回合 Jev 返回 402
- **WHEN** 本回合首个请求及下一用户回合请求经过路由器
- **THEN** 会话为 `MANUAL` 且 `disabled.category` 为 `insufficient-credits`；本回合与下一回合请求均与官方合成配置深度相等（effort `xhigh`），历史末条为 `{jev-failed, insufficient-credits}`；下一用户回合 Jev 请求次数为 0，`disabled` 仍保留

#### Scenario: 用户重新点 AUTO 清除停用
- **GIVEN** 会话因 `timeout` 停用
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
系统 SHALL 把档位经代码常量映射表按 `await next()` 得到的实际官方 provider/model 转为 effort（表见 design D9），MUST NOT 套用尚未生效的手选模型的映射表；同回合实际模型变化时 SHALL 按新模型重新映射，不重新请求 Jev。目标 effort 不被该模型支持时取不超过目标的最高受支持值，无则取最低受支持值；模型不支持任何 effort 时不改写，`reason` 为 `no-effort-support`。

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
系统 SHALL 注册 Host 工具 `route_subagent`，参数 `{task: string, provider: "claude" | "codex"}`，描述须说明会把任务文本发送给 OpenRouter/TypeSafe：以与主会话相同的 Jev 客户端、`TIER_QUESTIONS` 与失败类别判断档位（`state` 上一档位为 `none`），成功返回 `{tier, provider, model, reasoning_effort}`（取自 design D9 子会话表，代码常量为唯一来源）；失败返回错误结果，内容为该类别提示与“暂停委派并询问用户”；`exec.signal` 取消时返回“已取消”错误结果，不含余额/凭据提示。工具 MUST NOT 改写任何会话状态，不受主会话模式或 `disabled` 影响。系统 SHALL 提供 skill `subagent-model-routing`，其文本须要求：(1) 委派前调用 `route_subagent`；(2) 将返回的 `provider`、`model`、`reasoning_effort` 全部显式传给官方 `subagent`；(3) 在 `description` 末尾以 `[model·effort]` 标注；(4) 默认 provider 为当前会话 provider，用户或 lead 要求独立体系时改用另一个；当前 provider 不是 `claude`/`codex` 时暂停委派并询问用户；(5) 工具失败时暂停委派并询问用户，MUST NOT 自行猜测档位、改由主会话完成或换用其它模型；(6) 复用已有子会话前比较其标注，更高或无法确认时新建；(7) `route_subagent` 工具不存在时告知用户“子会话 Jev 选模未启用”，按官方默认委派且不传 provider/model/reasoning_effort，不得猜档位。路由器 MUST NOT 改写子会话的创建参数或请求。

#### Scenario: 工具成功返回表中条目
- **GIVEN** Jev 对任务返回 `complex`
- **WHEN** 以 `provider: claude` 与 `provider: codex` 分别调用 `route_subagent`
- **THEN** 分别返回 `{complex, claude, claude-opus-5-5, xhigh}` 与 `{complex, codex, gpt-6.1-sol, xhigh}`

#### Scenario: 工具失败返回类别且不改状态
- **GIVEN** Jev 返回 402，主会话 S1 为 `AUTO` 且无 `disabled`
- **WHEN** 调用 `route_subagent`
- **THEN** 结果为错误，内容含“余额不足”与“暂停委派并询问用户”；S1 仍为 `AUTO` 且无 `disabled`

#### Scenario: 主子会话问题定义相同
- **GIVEN** 主会话一个 AUTO 用户回合与一次 `route_subagent` 调用
- **WHEN** 记录二者发往假 Jev 服务的 body
- **THEN** 两个 body 的 `model` 与 `questions` 深度相等，仅 `state` 不同

#### Scenario: 子会话表与家族一致
- **GIVEN** 代码中的子会话表常量
- **WHEN** 测试逐级断言并按 Claude 家族规则检查
- **THEN** 每级 model/effort 等于 design D9；`claude` 条目全为 Claude 家族，`codex` 条目全非 Claude 家族

#### Scenario: skill 文本包含七项规则
- **GIVEN** `skills/subagent-model-routing/SKILL.md`
- **WHEN** 测试读取其文本
- **THEN** 文本包含 `route_subagent`、`reasoning_effort`、`[model·effort]`、独立体系规则、非 claude/codex provider 时询问、“暂停委派并询问用户”、复用“新建”规则及“子会话 Jev 选模未启用”，且不含档位表模型名

### Requirement: 状态可见且不改写其它控件
系统 SHALL 在 composer 的 `conversation.input.right` 列表以负的 `order` 注册 `AUTO / MANUAL` 芯片（GPT 速度芯片为 `order: 0`）。芯片 SHALL 是单个按钮：可见文本为模式名，其后跟一个切换图标；无边框、无底色，hover 时显示官方交互底色；点击即切换模式。状态面板 SHALL 在鼠标悬停或键盘聚焦芯片时显示、离开芯片与面板时收起，内容为插件本回合实际输出的 effort 与 `reason`；面板 MUST NOT 渲染决定历史（Host 仍在内存保留最近 20 条并经状态接口返回，供排查，重启后清空、不落盘）；面板 MUST NOT 声称官方选择器总能反映 AUTO 结果（存在待生效手选时二者不同）。`reason` 取值为闭集 `jev | continued | no-effort-support | jev-failed`（`continued` 为非用户回合沿用上一级别）。会话存在 `disabled` 时，芯片**可见文本** SHALL 为 `MANUAL · Jev 停用` 并以警示色显示，title SHALL 给出该失败类别的人类可读提示；面板 SHALL 显示类别、提示、发生时间及“点击 AUTO 重试”。芯片 MUST NOT 调用官方模型选择接口或速度芯片的设置接口。

#### Scenario: 芯片注册在速度芯片左侧
- **GIVEN** client bundle 已加载
- **WHEN** 读取 `conversation.input.right` 的注册项
- **THEN** 本芯片 `order` 小于 0

#### Scenario: 面板展示本回合状态，历史只留在 Host
- **GIVEN** Host 已为某会话产生 25 条决定，最新一条为 `{effort: xhigh, reason: jev}`
- **WHEN** 读取状态接口并渲染面板
- **THEN** 状态接口历史恰含 20 条；面板文本包含 `xhigh`、`jev`，且不渲染历史列表

#### Scenario: 停用状态在芯片与面板可见
- **GIVEN** 会话 `disabled = {category: insufficient-credits}`，模式为 `MANUAL`
- **WHEN** 渲染芯片与面板
- **THEN** 芯片可见文本含“Jev 停用”且带警示标记，title 含“余额不足”；面板含 `insufficient-credits`、“余额不足”与“点击 AUTO 重试”；无 `disabled` 时芯片可见文本不含“Jev 停用”且不带警示标记

#### Scenario: 芯片样式与悬停面板
- **GIVEN** client bundle 已加载，会话为 `MANUAL`
- **WHEN** 渲染芯片
- **THEN** 芯片是单个按钮，可见文本 `MANUAL` 在前、切换图标在后，无边框；面板默认不渲染；面板开关逻辑对进入/聚焦返回打开、对离开/失焦返回收起（真实悬停与延迟由 GUI 复验）

#### Scenario: 切换模式只调用插件接口
- **GIVEN** 用户点击芯片切换模式
- **WHEN** 记录本次交互发出的 RPC
- **THEN** 只调用本插件的设置模式接口，未调用官方模型选择或 `subscriptions-auth.setSpeed`

### Requirement: 决策提示（可选）
系统 SHALL 提供默认关闭的开关：`$DSH_HOME/plugins/dsh-auto-model-routing/config.json` 中 `decisionToast: true` 时开启；文件缺失、不可解析或值非 `true` 时视为关闭，不得影响路由。开关每次读取状态时生效，无需重启。

每次 Jev **成功**判档，系统 SHALL 为发起判档的主会话记录最近一次决策 `{id, source, tier, effort, model?, confidence?, probabilities?, ms}`（仅内存，不落盘）：
- `source = main`：主会话 AUTO 用户回合判档；`effort` 为按实际模型映射后的值（无 effort 支持时不记录），无 `model`。
- `source = subagent`：`route_subagent` 成功返回；`model` 与 `effort` 为工具返回值；记录到调用工具的会话，与该会话模式无关。
`confidence` 取 Jev 响应 `answers.tier.confidence`（0–1，缺失或非数字时不显示）；`probabilities` 取 `answers.tier.probabilities` 中四个档位的有限数值（其余键忽略，一个都没有时不显示）；`ms` 为该次 Jev 请求耗时。判档失败、取消或被丢弃时 MUST NOT 记录。

开关开启时，状态接口 SHALL 返回 `decision`；client SHALL 在发现新的决策 `id` 时于芯片上方显示提示，3 秒后自动消失，不拦截指针；提示 MUST 在 Agent 运行、官方隐藏右侧控件期间仍可见（渲染在隐藏区域之外）。提示两行：第一行 `主会话判断 · <tier> → <effort> · 置信 <n>% · <s>s` 或 `子会话判断 · <tier> → <model> · <effort> · 置信 <n>% · <s>s`；第二行为分布，按 simple、standard、complex、escalated 固定顺序列出各档位百分比，以 ` / ` 分隔，例如 `simple 1% / standard 4% / complex 92% / escalated 3%`；无分布时省略第二行。两次状态读取之间若有多次决策，只显示最新一次。开关关闭时状态接口 MUST NOT 返回 `decision`，client 不显示提示。

#### Scenario: 主会话判档提示
- **GIVEN** 开关开启，会话为 `AUTO`，Jev 返回 `complex`、confidence 0.92，实际模型为 Opus
- **WHEN** 该回合首个请求经过路由器后读取状态并渲染提示
- **THEN** 状态含 `decision = {source: main, tier: complex, effort: xhigh, confidence: 0.92, probabilities}`；提示第一行为 `主会话判断 · complex → xhigh · 置信 92% · <耗时>s`，第二行列出四档分布

#### Scenario: 子会话选模提示
- **GIVEN** 开关开启，会话 S1 为 `MANUAL`，Jev 对 `route_subagent` 返回 `complex`、confidence 0.8
- **WHEN** S1 调用 `route_subagent(provider: claude)` 后读取 S1 状态并渲染提示
- **THEN** 状态含 `decision = {source: subagent, tier: complex, model: claude-opus-5-5, effort: xhigh, confidence: 0.8, probabilities}`；提示第一行以 `子会话判断 · complex → claude-opus-5-5 · xhigh · 置信 80%` 开头

#### Scenario: 开关关闭或判档失败不提示
- **GIVEN** 开关关闭，或开关开启但 Jev 返回 402
- **WHEN** 读取状态
- **THEN** 关闭时状态不含 `decision`；失败时不产生新的 `decision`

#### Scenario: 提示只显示一次且 3 秒消失
- **GIVEN** client 已显示 id 为 7 的决策提示
- **WHEN** 后续状态读取仍返回 id 7，或经过 3 秒
- **THEN** 不重复显示 id 7；3 秒后提示被移除；官方隐藏右侧控件时提示仍可见

### Requirement: Host 端点边界
本插件只提供两个经 `connection.fetch.register` 注册的端点：读取状态与设置模式。两者 SHALL 以请求体 `sessionId` 经官方会话控制器解析目标会话（与官方会话端点同一授权模型）；`sessionId` 缺失、非字符串、无法解析或指向 `origin = "subagent"` 会话时 SHALL 返回 4xx 且不修改任何状态；设置模式 SHALL 只修改该会话的模式与 `disabled`（设为 `AUTO` 时清除），`mode` 不属于 `AUTO | MANUAL` 时返回 4xx；读取状态 SHALL 返回 `disabled`（如有）。

#### Scenario: 无效会话被拒绝且无副作用
- **GIVEN** 会话 S1 为 `AUTO`；`session-unknown` 无法解析；`session-child` 为子会话
- **WHEN** 分别以无 `sessionId`、`sessionId: 42`、`session-unknown`、`session-child` 调用设置模式（`MANUAL`）
- **THEN** 四次均返回 4xx；S1 仍为 `AUTO`；所有会话状态不变

#### Scenario: 只修改目标会话
- **GIVEN** 会话 S1 与 S2 均为 `AUTO`
- **WHEN** 以 `sessionId: S1, mode: "MANUAL"` 调用设置模式
- **THEN** S1 为 `MANUAL`；S2 的模式与 `disabled` 不变

### Requirement: 自动选路不得绕过既有模型门禁
自动选定的 effort SHALL 经过与手选路由相同的既有门禁；由于主会话不改 provider 与 model，`home-network-model-guard` 的 client 与 Host 判定针对同一模型。系统 MUST NOT 在门禁拒绝后改变 provider 或模型。`route_subagent` 返回的模型同样由官方创建参数校验与门禁把关，系统 MUST NOT 在其被拒绝后自行换模型。

#### Scenario: 门禁拒绝不引起改路由
- **GIVEN** 网络门禁对 Claude 为 `blocked`，官方选择为 Claude，AUTO 决定 effort `xhigh`
- **WHEN** 请求被门禁拒绝，同回合下一请求到达
- **THEN** 下一请求的 provider 与 model 仍为官方选择的值
