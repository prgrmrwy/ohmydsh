## ADDED Requirements

### Requirement: 模式与改写规则
系统 SHALL 为每个主会话提供 `AUTO` 与 `MANUAL` 两种模式，默认 `MANUAL`，按会话持久化。
- **AUTO**：系统 SHALL 只改写主会话请求的 reasoning effort，MUST NOT 改写 provider 与 model；同一回合内档位一经决定即不再变化（同回合换模型时按新模型重新映射 effort）。改写出的 effort 与官方本次合成的 effort 不同时，系统 SHALL 经官方 `sessionController.selectModel` 把会话选择更新为 `{provider, model, effort}`（官方选择已为该值时不调用；同一值的调用尚未完成时不重复调用），使右侧模型选择器与实际请求一致；官方该接口同时把此选择保存为新会话的默认值（用户已接受）。调用失败 MUST NOT 影响本次请求。
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

#### Scenario: AUTO 结果同步到官方选择
- **GIVEN** 会话为 `AUTO`，官方合成 `claude/claude-opus-5-5`、`medium`，本回合判档映射为 `xhigh`
- **WHEN** 本回合首个与第二个请求经过路由器
- **THEN** `selectModel` 恰被调用一次，参数为 `{sessionId, provider: claude, model: claude-opus-5-5, reasoningEffort: xhigh}`；官方合成已为 `xhigh` 时不再调用；`selectModel` 抛错时请求仍输出 `xhigh`

#### Scenario: AUTO 判档覆盖待生效手选
- **GIVEN** 会话为 `AUTO`，用户在 AUTO 期间手选 `medium`（官方待生效手选）
- **WHEN** 下一回合 AUTO 判档为 `xhigh`，随后切 MANUAL 并发出请求
- **THEN** 官方选择被更新为 `xhigh`；切 MANUAL 后的请求与官方合成配置深度相等，effort 为 `xhigh`

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
系统 SHALL 在 AUTO 的用户回合 step 1 中，以一次 Jev `choice` 请求得出本回合档位 `simple | standard | complex | escalated`：经 `POST https://openrouter.ai/api/alpha/decisions`，模型 `typesafe/jev-1.13`，凭据每次调用时经官方 launch environment 读取 `OPENROUTER_API_KEY`；`questions` 为主会话与 `route_subagent` 共用的 `TIER_QUESTIONS`，SHALL 从 package 内唯一的规则文件 `packages/auto-model-routing/src/rubric.json` 读入（源码与评估脚本都从它读，不另存副本）；规则版本 `rubricVersion` SHALL 为 `sha256(JSON.stringify(TIER_QUESTIONS))` 的前 8 个十六进制字符，由代码计算、不手工维护；单次请求期限 3000ms，`redirect: 'error'`，MUST NOT 重试。Jev 返回后 SHALL 重新读取会话状态，等待期间模式已变时丢弃该结果（不写决定、不写 `disabled`）。成功时 SHALL 采用响应 `answers.tier.choice` 作为档位，`reason` 为 `jev`，不设置信度门槛。系统 MUST NOT 包含本地规则、关键词或通用对话模型的分类路径；代码只做上一档“升一级”的计算（档位序加一，`escalated` 封顶），不读消息内容。请求 MUST NOT 携带会话状态、其它会话内容或凭据以外的鉴权信息；出站主机 SHALL 仅为 `openrouter.ai`。

主会话请求的 `state` SHALL 依次包含：
1. 档位行：有上一档时为 `Previous user-turn tier: <tier> (one tier above: <tier+1>)`，否则为 `Previous user-turn tier: none`。上一用户回合档位 SHALL 按会话持久化（只存档位名，不存任务文本），Host 重启后仍随下一次判档发送，并在 MANUAL、停用与重新切 AUTO 时保留。
2. 上一轮上下文（存在时）：一行固定说明“上下文仅用于理解新消息，只判断新消息引出的工作”，随后 `Previous user message (truncated):` 加上一用户回合文本 `.slice(0, 500)`，以及 `Previous assistant reply (last part):` 加上一轮助手文本 `.slice(-1200)`（均为脱敏后截取）。不存在时省略对应段，两者都不存在时省略说明行。
3. `New user message:` 加本回合分类输入（无上一轮上下文时标签为 `User message:`）。
“上一轮”两段在 step 1 的 `agent/pre-step` 中、本回合消息进入之前，从 `agent.session.deriveMessages()` 取得：上一用户回合文本为最后一条 `source.kind === "user"` 的消息的 `text` 块按序以 `"\n"` 连接；助手段为最后一条含非空 `text` 块的 `assistant` 消息的文本块连接。

外发的每段文本（本回合用户文本、上一轮两段、`route_subagent` 任务文本）SHALL 先对**完整文本**经同一函数 `redact` 处理，再截断。`redact` 依次替换（`i` 表示不区分大小写）：
1. `/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g` → `<redacted>`
2. `/\bBearer\s+[A-Za-z0-9._~+\/=-]{8,}/gi` → `Bearer <redacted>`
3. `/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g` → `<redacted>`
4. `/(密码|授权码|appid|password|passwd|token|api[_-]?key|secret)(["']?\s*[:：=]\s*["']?)[^\s"',;]+/gi` → 保留关键字与分隔符，值替换为 `<redacted>`（必须有 `:`、`：` 或 `=` 分隔；“token 过期了”不被替换）
5. `/\/\/[^\s/:@]+:[^\s/@]+@/g` → `//<redacted>@`
6. `/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g` → `<ip>`
这是形态匹配，尽力而为，不保证移除所有敏感信息。`route_subagent` 的 `state` 只含 `Previous user-turn tier: none` 与 `User message:` 加处理后的任务文本。

#### Scenario: 成功判断采用 Jev 档位
- **GIVEN** 会话为 `AUTO`，Jev 对本回合返回 `choice: complex`，实际模型为 `claude-opus-5-5`
- **WHEN** 本回合首个请求经过路由器
- **THEN** 输出 effort 为 `high`，`reason` 为 `jev`，provider/model 不变，本回合 Jev 请求次数为 1

#### Scenario: 请求内容受限
- **GIVEN** 上一用户回合档位为 `standard`，上一轮用户文本为“修一下登录”，上一轮最后一条助手回复以“要我开始实施吗？”结尾，本回合分类输入为“继续”
- **WHEN** 路由器向 Jev 发起请求
- **THEN** 请求地址为 `https://openrouter.ai/api/alpha/decisions`，body 的 `model` 为 `typesafe/jev-1.13`；`state` 首行为 `Previous user-turn tier: standard (one tier above: complex)`，并依次含“修一下登录”“要我开始实施吗？”与 `New user message:\n继续`，不含其它会话字段；`Authorization` 为 Bearer 凭据；超时 3000ms 且失败后无第二次请求

#### Scenario: 上一轮上下文截断、取末段并脱敏
- **GIVEN** 会话历史中上一条用户消息 900 字；之后有两条助手消息，第一条为“早先内容”，最后一条 3000 字且结尾含 `token=abc123def456` 与 `10.1.2.3:8080`
- **WHEN** 路由器构造 `state`
- **THEN** 上一轮用户段为脱敏后文本的前 500 字；助手段为最后一条助手消息脱敏后的末 1200 字，不含“早先内容”；`state` 不含 `abc123def456` 与 `10.1.2.3`，含 `token=<redacted>` 与 `<ip>`

#### Scenario: 脱敏覆盖常见形态且不误伤正文
- **GIVEN** 文本依次含 `{"API_KEY": "abc123"}`、`Token：xyz789`、`Authorization: Bearer abcdefgh12345`、`ghp_0123456789abcdefghijABCD`、`https://u:p@host/x`、`token 过期了怎么办`，以及一个 `sk-` 开头、长 40 字符且起始位置在末 1200 字边界之前 10 字符处的密钥
- **WHEN** 对该文本执行 `redact` 后取末 1200 字
- **THEN** 结果不含 `abc123`、`xyz789`、`abcdefgh12345`、`ghp_0123`、`u:p@` 与该密钥的任何 8 字以上片段；`token 过期了怎么办` 原样保留

#### Scenario: 首个用户回合不带上一轮上下文
- **GIVEN** 会话为 `AUTO`，没有上一用户回合
- **WHEN** 首个用户回合发送“看下这个报错”
- **THEN** `state` 恰为 `Previous user-turn tier: none\nUser message:\n看下这个报错`

#### Scenario: 规则版本由规则内容决定
- **GIVEN** `src/rubric.json`，以及改动其中一个字符后的副本
- **WHEN** 分别计算 `rubricVersion`
- **THEN** 原文件的版本为 `sha256(JSON.stringify(questions)).slice(0, 8)`；副本的版本与之不同；上一档为 `escalated` 时“升一级”仍为 `escalated`

#### Scenario: 回归脚本只把基线外的新未命中视为失败
- **GIVEN** `packages/auto-model-routing/eval/` 的 `cases.json` 与 `baseline.json`；一个假 Jev 服务，按用例 id 返回固定档位
- **WHEN** 分别让假服务：全部按基线结果返回；让一个不在 `knownMisses` 的用例判错；让一个请求返回 HTTP 500
- **THEN** `run.mjs --base <假服务地址>` 依次退出 0、1、2；请求失败不计入未命中；脚本构造的 `state` 与 Host 对同一用例构造的 `state` 逐字相等

#### Scenario: 重启后仍沿用上一档位
- **GIVEN** 会话为 `AUTO`，上一用户回合 Jev 判为 `complex`，随后 Host 重启
- **WHEN** 用户发送“继续”
- **THEN** 发给 Jev 的 `state` 首行为 `Previous user-turn tier: complex (one tier above: escalated)`；状态文件含 `previous: complex` 且不含任务文本

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
系统 SHALL 把档位按 `await next()` 得到的实际官方 provider/model 转为 effort，MUST NOT 套用尚未生效的手选模型的映射；同回合实际模型变化时 SHALL 按新模型重新映射，不重新请求 Jev。每个模型有一个起点 effort（代码常量，取值与出处见 design D9）：`claude-opus-5-5`、`claude-sonnet-5-5`、`claude-haiku-5-5`、`gpt-6.1-sol` 为 `medium`，`claude-fable-5-1`、`gpt-6-luna` 为 `high`，`gpt-6-astra` 为 `low`，其它模型为 `medium`。在序列 `low < medium < high < xhigh < max` 上：`standard` 取起点，`simple` 降一级（最低 `low`），`complex` 升一级，`escalated` 升两级；任一档位结果 MUST NOT 高于 `xhigh`，自动路由 MUST NOT 输出 `max`。候选集为模型受支持的 effort 与 `{low, medium, high, xhigh}` 的交集；目标不在候选集时取不超过目标的最高候选值，无则取最低候选值；候选集为空时不改写，`reason` 为 `no-effort-support`。

#### Scenario: 档位映射为 effort
- **GIVEN** 实际模型 `claude-opus-5-5`，支持全部五级
- **WHEN** 路由器分别为 `simple`、`standard`、`complex`、`escalated` 计算 effort
- **THEN** 依次输出 `low`、`medium`、`high`、`xhigh`

#### Scenario: 起点不同的模型按起点浮动且封顶 xhigh
- **GIVEN** 实际模型分别为 `claude-fable-5-1`、`gpt-6-luna`、`gpt-6-astra`、`unknown-model`，均支持全部五级
- **WHEN** 路由器为四个档位计算 effort
- **THEN** Fable 与 Luna 依次为 `medium/high/xhigh/xhigh`，Astra 为 `low/low/medium/high`，未知模型为 `low/medium/high/xhigh`；所有结果中不出现 `max`

#### Scenario: 不支持的 effort 被截断
- **GIVEN** 实际模型 `claude-opus-5-5` 只支持 `[low, medium, high, max]`，档位 `escalated`（目标 `xhigh`）
- **WHEN** 路由器计算 effort
- **THEN** 输出 effort 为 `high`，不为 `max`

#### Scenario: 无 effort 支持时不改写
- **GIVEN** 实际模型目录信息中无 reasoning efforts，或只支持 `[max]`，档位 `complex`
- **WHEN** 请求经过路由器
- **THEN** 两种情况输出都与官方合成配置深度相等，`reason` 为 `no-effort-support`

#### Scenario: 同回合换模型重新映射
- **GIVEN** 本回合档位 `complex`，首个请求实际模型 Opus 输出 `high`
- **WHEN** 同回合后续请求实际模型变为 `gpt-6-astra`
- **THEN** 输出 effort 为 `medium`，Jev 请求次数仍为 1

### Requirement: 子会话决策工具与 skill
系统 SHALL 注册 Host 工具 `route_subagent`，参数 `{task: string, provider: "claude" | "codex"}`，描述须说明会把任务文本发送给 OpenRouter/TypeSafe：以与主会话相同的 Jev 客户端、`TIER_QUESTIONS` 与失败类别判断档位（`state` 上一档位为 `none`），成功返回 `{tier, provider, model, reasoning_effort}`。子会话模型按档位取自代码常量 `CHILD_MODELS`（唯一来源）：`claude` 依次为 `claude-haiku-5-5`、`claude-sonnet-5-5`、`claude-opus-5-5`、`claude-opus-5-5`，`codex` 依次为 `gpt-6-luna`、`gpt-6.1-sol`、`gpt-6.1-sol`、`gpt-6.1-sol`；模型选择只依赖档位与 provider，MUST NOT 受调用会话当前模型限制；MUST NOT 自动返回 `claude-fable-5-1` 或 `gpt-6-astra`。`reasoning_effort` SHALL 按“级别与 effort 映射”的同一起点规则对所选模型计算（不做受支持值截断，由官方创建参数校验）；失败返回错误结果，内容为该类别提示与“暂停委派并询问用户”；`exec.signal` 取消时返回“已取消”错误结果，不含余额/凭据提示。工具 MUST NOT 改写任何会话状态。工具 SHALL 先确定**所属主会话**：调用会话为普通会话时即其本身；为子会话时经 `ctx.agents.get(header.parentSession)` 逐级向上，找到第一个非 `origin = subagent` 的会话；链上任一会话不在 live 注册表中时视为 MANUAL。模式按所属主会话 id 从插件状态读取。所属主会话模式不是 `AUTO`（含因 Jev 失败停用）时，工具 MUST NOT 请求 Jev、MUST NOT 外发任务文本，返回非错误结果 `{routed: false, reason: "manual"}`，渲染文本说明“主会话为 MANUAL：不判档，按官方默认委派，不传 provider/model/reasoning_effort”；只有所属主会话为 `AUTO` 时才判档。系统 SHALL 提供 skill `subagent-model-routing`，其文本须要求：(1) 委派前调用 `route_subagent`；(2) 将返回的 `provider`、`model`、`reasoning_effort` 全部显式传给官方 `subagent`；(3) 在 `description` 末尾以 `[model·effort]` 标注；(4) 默认 provider 为当前会话 provider，用户或 lead 要求独立体系时改用另一个；当前 provider 不是 `claude`/`codex` 时暂停委派并询问用户；(5) 工具失败时暂停委派并询问用户，MUST NOT 自行猜测档位、改由主会话完成或换用其它模型；(6) 复用已有子会话前比较其标注，更高或无法确认时新建；(7) `route_subagent` 工具不存在时告知用户“子会话 Jev 选模未启用”，按官方默认委派且不传 provider/model/reasoning_effort，不得猜档位；(8) 工具返回 `routed: false` 时按官方默认委派且不传 provider/model/reasoning_effort，不询问用户、不猜档位。路由器 MUST NOT 改写子会话的创建参数或请求。

#### Scenario: 工具成功返回表中条目
- **GIVEN** 调用会话为 `AUTO`
- **WHEN** Jev 依次返回四个档位，并分别以 `provider: claude` 与 `provider: codex` 调用 `route_subagent`
- **THEN** 8 个结果的 `{model, reasoning_effort}` 依次为：claude `haiku-5-5/low`、`sonnet-5-5/medium`、`opus-5-5/high`、`opus-5-5/xhigh`；codex `gpt-6-luna/medium`、`gpt-6.1-sol/medium`、`gpt-6.1-sol/high`、`gpt-6.1-sol/xhigh`（Claude 模型名带 `claude-` 前缀）

#### Scenario: 主会话为 MANUAL 时不判档、不外发
- **GIVEN** 会话 S1 为 `MANUAL`（分别为用户手动设置、因 Jev 402 停用两种情况）；S1 的子会话 C1；另有 AUTO 会话 S2 的子会话 C2，其父会话不在 live 注册表中
- **WHEN** 分别在 S1、C1、C2 中调用 `route_subagent`
- **THEN** 三次都返回非错误结果 `{routed: false, reason: manual}`，渲染文本含“按官方默认委派”；假 Jev 服务收到 0 个请求；S1 无新的 `decision`

#### Scenario: 子会话中调用按根会话模式判档
- **GIVEN** 会话 S1 为 `AUTO`，其子会话 C1 的子会话 C2，Jev 返回 `standard`
- **WHEN** 在 C2 中以 `provider: claude` 调用 `route_subagent`
- **THEN** 返回 `{standard, claude, claude-sonnet-5-5, medium}`；假 Jev 服务收到 1 个请求；S1 不新增 `decision`

#### Scenario: 子会话模型不受调用会话模型限制
- **GIVEN** 调用会话为 `AUTO` 且当前模型为 `claude-haiku-5-5`，Jev 对任务返回 `escalated`
- **WHEN** 以 `provider: claude` 调用 `route_subagent`
- **THEN** 返回 `{escalated, claude, claude-opus-5-5, xhigh}`；对四个档位与两个 provider 的全部组合，返回值中不出现 `claude-fable-5-1`、`gpt-6-astra` 或 `max`

#### Scenario: 工具失败返回类别且不改状态
- **GIVEN** Jev 返回 402，主会话 S1 为 `AUTO` 且无 `disabled`
- **WHEN** 调用 `route_subagent`
- **THEN** 结果为错误，内容含“余额不足”与“暂停委派并询问用户”；S1 仍为 `AUTO` 且无 `disabled`

#### Scenario: 主子会话问题定义相同
- **GIVEN** 主会话一个 AUTO 用户回合与一次 `route_subagent` 调用
- **WHEN** 记录二者发往假 Jev 服务的 body
- **THEN** 两个 body 的 `model` 与 `questions` 深度相等，仅 `state` 不同

#### Scenario: skill 文本包含八项规则
- **GIVEN** `skills/subagent-model-routing/SKILL.md`
- **WHEN** 测试读取其文本
- **THEN** 文本包含 `route_subagent`、`reasoning_effort`、`[model·effort]`、独立体系规则、非 claude/codex provider 时询问、“暂停委派并询问用户”、复用“新建”规则、“子会话 Jev 选模未启用”及 `routed: false` 时按官方默认委派，且不含档位表模型名

### Requirement: 状态可见且不改写其它控件
系统 SHALL 在 composer 的 `conversation.input.right` 列表以负的 `order` 注册 `AUTO / MANUAL` 芯片（GPT 速度芯片为 `order: 0`）。芯片 SHALL 是单个按钮：可见文本为模式名，其后跟一个切换图标；无边框、无底色，hover 时显示官方交互底色；点击即切换模式。状态面板 SHALL 在鼠标悬停或键盘聚焦芯片时显示、离开芯片与面板时收起，内容为插件本回合实际输出的 effort 与 `reason`，以及该会话最近一次 Jev 决策（与决策提示同一格式的两行：谁判断、档位 → （模型）effort、耗时；非 0% 档位分布），无决策时不显示该段；面板 MUST NOT 渲染决定历史（Host 仍在内存保留最近 20 条并经状态接口返回，供排查，重启后清空、不落盘）；面板 MUST NOT 声称官方选择器总能反映 AUTO 结果（存在待生效手选时二者不同）。`reason` 取值为闭集 `jev | continued | no-effort-support | jev-failed`（`continued` 为非用户回合沿用上一级别）。会话存在 `disabled` 时，芯片**可见文本** SHALL 为 `MANUAL · Jev 停用` 并以警示色显示，title SHALL 给出该失败类别的人类可读提示；面板 SHALL 显示类别、提示、发生时间及“点击 AUTO 重试”。芯片 MUST NOT 调用官方模型选择接口或速度芯片的设置接口。

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

#### Scenario: 悬停面板显示最近一次决策分布
- **GIVEN** 会话最近一次决策为 `{source: main, tier: complex, effort: high, probabilities: {complex: 0.61, escalated: 0.39}}`，提示开关关闭
- **WHEN** 悬停芯片打开面板
- **THEN** 面板含 `主会话判断 · complex → high` 与 `complex 61% / escalated 39%`；无决策时面板不含“最近决策”段

#### Scenario: 芯片样式与悬停面板
- **GIVEN** client bundle 已加载，会话为 `MANUAL`
- **WHEN** 渲染芯片
- **THEN** 芯片是单个按钮，可见文本 `MANUAL` 在前、切换图标在后，无边框；面板默认不渲染；面板开关逻辑对进入/聚焦返回打开、对离开/失焦返回收起（真实悬停与延迟由 GUI 复验）

#### Scenario: 切换模式只调用插件接口
- **GIVEN** 用户点击芯片切换模式
- **WHEN** 记录本次交互发出的 RPC
- **THEN** 只调用本插件的设置模式接口，未调用官方模型选择或 `subscriptions-auth.setSpeed`

### Requirement: 决策提示（默认开启）
系统 SHALL 提供默认开启的开关：`$DSH_HOME/plugins/dsh-auto-model-routing/config.json` 中 `decisionToast: false` 时关闭；文件缺失、不可解析或值非 `false` 时视为开启，不得影响路由。开关每次读取状态时生效，无需重启。

每次 Jev **成功**判档，系统 SHALL 为发起判档的主会话记录最近一次决策 `{id, source, tier, effort, model?, confidence?, probabilities?, ms}`（仅内存，不落盘）：
- `source = main`：主会话 AUTO 用户回合判档；`effort` 为按实际模型映射后的值（无 effort 支持时不记录），无 `model`。
- `source = subagent`：`route_subagent` 成功返回（所属主会话为 AUTO 时才会发生）；`model` 与 `effort` 为工具返回值；记录到调用工具的普通会话（调用方为子会话时不记录）。
`confidence` 取 Jev 响应 `answers.tier.confidence`（0–1，缺失或非数字时不显示）；`probabilities` 取 `answers.tier.probabilities` 中四个档位的有限数值（其余键忽略，一个都没有时不显示）；`ms` 为该次 Jev 请求耗时。判档失败、取消或被丢弃时 MUST NOT 记录。

状态接口 SHALL 始终返回 `decision`（如有），供面板展示；开关只控制弹出提示。开关开启时状态接口同时返回 `decisionToast: true`；client SHALL 仅在 `decisionToast` 为 true 且发现新的决策 `id` 时于芯片上方显示提示，3 秒后自动消失，不拦截指针；提示 MUST 在 Agent 运行、官方隐藏右侧控件期间仍可见（渲染在隐藏区域之外）。提示两行：第一行 `主会话判断 · <tier> → <effort> · <s>s` 或 `子会话判断 · <tier> → <model> · <effort> · <s>s`；第二行为分布，按 simple、standard、complex、escalated 固定顺序列出四舍五入后非 0% 的档位，以 ` / ` 分隔，例如 `complex 61% / escalated 39%`；无分布时省略第二行。提示不显示置信（它由最高概率推导，不含额外信息，且易与分布混淆）。两次状态读取之间若有多次决策，只显示最新一次。开关关闭时 client MUST NOT 弹出提示。

#### Scenario: 主会话判档提示
- **GIVEN** 开关开启，会话为 `AUTO`，Jev 返回 `complex`、confidence 0.92，实际模型为 Opus
- **WHEN** 该回合首个请求经过路由器后读取状态并渲染提示
- **THEN** 状态含 `decision = {source: main, tier: complex, effort: high, confidence: 0.92, probabilities}`；提示第一行为 `主会话判断 · complex → high · <耗时>s`，第二行列出非 0% 的档位

#### Scenario: 子会话选模提示
- **GIVEN** 开关开启，会话 S1 为 `AUTO`，Jev 对 `route_subagent` 返回 `complex`、confidence 0.8
- **WHEN** S1 调用 `route_subagent(provider: claude)` 后读取 S1 状态并渲染提示
- **THEN** 状态含 `decision = {source: subagent, tier: complex, model: claude-opus-5-5, effort: high, confidence: 0.8, probabilities}`；提示第一行以 `子会话判断 · complex → claude-opus-5-5 · high` 开头，不含“置信”

#### Scenario: 开关关闭或判档失败不提示
- **GIVEN** 开关显式关闭（`decisionToast: false`），或开关开启但 Jev 返回 402
- **WHEN** 读取状态
- **THEN** 关闭时状态不含 `decisionToast`、client 不弹出提示（面板仍可显示最近决策）；失败时不产生新的 `decision`

#### Scenario: 提示只显示一次且 3 秒消失
- **GIVEN** client 已显示 id 为 7 的决策提示
- **WHEN** 后续状态读取仍返回 id 7，或经过 3 秒
- **THEN** 不重复显示 id 7；3 秒后提示被移除；官方隐藏右侧控件时提示仍可见

### Requirement: Host 端点边界
本插件只提供三个经 `connection.fetch.register` 注册的端点：读取状态、设置模式与标注（`label`，参数与校验见“判档记录与人工标注”）。三者 SHALL 以请求体 `sessionId` 经官方会话控制器解析目标会话（与官方会话端点同一授权模型）；`sessionId` 缺失、非字符串、无法解析或指向 `origin = "subagent"` 会话时 SHALL 返回 4xx 且不修改任何状态；设置模式 SHALL 只修改该会话的模式与 `disabled`（设为 `AUTO` 时清除），`mode` 不属于 `AUTO | MANUAL` 时返回 4xx；读取状态 SHALL 返回 `disabled`（如有）。

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

### Requirement: 子会话派发时机写入环境级指令
`instructions/dsh-home.md` SHALL 包含一节“子会话派发”，由主 Agent 决定是否派发，内容至少包括：
- 派发：实施已批准计划中工作量较大的编码任务；独立评审或复核（需要新上下文）；中间输出多的探索（大范围搜索、读日志、跑测试），只带回结论；彼此独立、可并行的多块工作。
- 不派发：与用户讨论或做决定的回合；前后依赖且主会话上下文装得下的工作；单个小修复。
- 本身是子会话时不再向下派发，除非任务明确要求。
- 派发前若 `route_subagent` 可用，按 `subagent-model-routing` skill 判档并显式传参。
该节 MUST NOT 引用具体模型名或 effort 值（唯一来源为插件代码）。本 change MUST NOT 新增物化机制，沿用 `agentInstructions` 将其物化为 `$DSH_HOME/AGENTS.md`（已有 `tests/sync-agent-instructions.test.mjs` 覆盖物化、幂等与撤销）。

#### Scenario: 环境级指令含派发规则且不含模型名
- **GIVEN** 仓库中的 `instructions/dsh-home.md`
- **WHEN** 测试读取其文本
- **THEN** 含标题“子会话派发”，含“独立评审”“并行”“route_subagent”“不派发”与“本身是子会话时不再向下派发”；不含任何 `claude-`、`gpt-` 开头的模型名，也不匹配 `\bxhigh\b`、`\bmax\b`

### Requirement: 判档记录与人工标注
系统 SHALL 把主会话 AUTO 用户回合的每次成功判档追加一行到 `$DSH_HOME/state/auto-model-routing/judgements.jsonl`：`{sessionId, turn, tier, effort?, model, rubricVersion}`，写入时机为成功判档后该回合首个请求（无论是否映射出 effort，未映射时省略 `effort`）；`route_subagent`、失败、取消、被丢弃与非用户回合不写判档行。标注也是追加一行 `{sessionId, turn, label}`。行 MUST NOT 包含消息文本、上一轮上下文、响应体或凭据。追加失败 MUST NOT 影响请求、MUST NOT 停用 AUTO，只记一条日志。读取方 SHALL 按 `(sessionId, turn)` 折叠：判档取最后一条判档行，标注取最后一条标注行；无法解析的行跳过。

Host SHALL 经 `session/event` 观察 `assistant/message`，在内存中记录 `messageId → turn`（每会话一个 Map）。非用户回合（`continued`）的助手消息 SHALL 记到该会话最近一个有判档的用户回合。

系统 SHALL 提供一个与现有端点同一授权模型的端点 `auto-model-routing.label`：参数 `{sessionId, messageId, label?}`。`messageId` 对应回合有判档时，无 `label` 返回 `{tier, effort?, label?}`，带 `label`（四档之一）时先追加标注行再返回同一结构；`messageId` 不在映射中或回合无判档时返回 `{}` 且不写入。`sessionId` 缺失、非字符串、无法解析、指向子会话，`messageId` 非字符串，或 `label` 不属于四档时 SHALL 返回 4xx 且不写入。

仓库 SHALL 提供只读统计脚本 `packages/auto-model-routing/scripts/label-report.mjs`：读取 `judgements.jsonl`，按 `rubricVersion` 输出已标注数、一致数、判高数、判低数与不一致的 `(sessionId, turn)` 列表；不读取消息内容、不联网、不写文件。

#### Scenario: 成功判档追加一行不含文本的记录
- **GIVEN** 会话 S1 为 `AUTO`，回合 3 的用户文本含 `SECRET-TEXT`，Jev 返回 `complex`，实际模型 Opus
- **WHEN** 回合 3 的首个与第二个请求经过路由器
- **THEN** `judgements.jsonl` 恰新增一行 `{sessionId: S1, turn: 3, tier: complex, effort: high, model: claude-opus-5-5, rubricVersion}`；文件不含 `SECRET-TEXT`

#### Scenario: 失败、取消、子会话判档与非用户回合不写判档行
- **GIVEN** 会话为 `AUTO`
- **WHEN** 分别发生 Jev 402、用户取消、等待期间切 MANUAL、一次成功的 `route_subagent`，以及一个子会话完成通知开启的回合
- **THEN** `judgements.jsonl` 无新增判档行

#### Scenario: 写入失败不影响请求
- **GIVEN** 会话为 `AUTO`，`judgements.jsonl` 所在目录不可写，Jev 返回 `standard`
- **WHEN** 回合首个请求经过路由器
- **THEN** 请求 effort 为 `medium`；会话仍为 `AUTO` 且无 `disabled`；记录一条日志

#### Scenario: 按消息查询与标注
- **GIVEN** S1 回合 3 有判档 `complex`；回合 3 有助手消息 m1、m2；回合 4 为子会话完成通知开启的回合，有助手消息m3
- **WHEN** 以 m1 查询，以 m3 标注 `standard`，再以 m2 查询
- **THEN** 第一次返回 `{tier: complex, effort: high}`；第二次追加一行 `{S1, 3, standard}` 并返回 `label: standard`；第三次返回 `{tier: complex, effort: high, label: standard}`

#### Scenario: 无效请求被拒，未知消息不写入
- **GIVEN** S1 回合 3 有判档；`session-child` 为子会话；`m-unknown` 不在映射中
- **WHEN** 分别以 `label: huge`、`session-child`、`messageId: 42` 调用，以及以 `m-unknown` 标注 `simple`
- **THEN** 前三次返回 4xx；最后一次返回 `{}`；`judgements.jsonl` 无新增行

#### Scenario: 统计脚本按规则版本汇总并跳过损坏行
- **GIVEN** `judgements.jsonl` 含：版本 a 下 `complex` 标 `standard`、`simple` 标 `simple`、`standard` 无标注；版本 b 下 `standard` 先标 `simple` 后标 `complex`；一行半截 JSON
- **WHEN** 运行 `node scripts/label-report.mjs --file <file> --json`
- **THEN** 输出 a `{labeled: 2, agree: 1, over: 1, under: 0}`、b `{labeled: 1, agree: 0, over: 0, under: 1}`，不一致列表含两条；脚本退出 0、对文件无写入

### Requirement: 回复操作栏档位按钮
client SHALL 向官方 `conversation.chat.assistant-actions` 插槽注册一个操作项（`order` 大于官方反馈的 10），`sessionId` 从注册时的 `inject(sessionId)` 取得，不改动官方点赞/点踩、复制或分支。官方只在每个回合的最后一条助手回复上渲染该插槽。操作项 SHALL 以 `messageId` 调用一次 `label` 端点（无 `label`）；返回 `{}` 时不渲染任何内容。否则渲染：
- 一个图标按钮，使用官方 primitives 的 `IconGaugeOutlineRegular`、`Tooltip`（`side: bottom`）与操作栏同款按钮 class，不自定义颜色。
- Tooltip 文本：`AUTO 判档：<档位中文> → <effort>`，已标注时追加 ` · 你标注：<档位中文>`。
- 点击打开官方 `Menu`，标题“这轮应该用哪档？”，四项依次为 `简单`、`标准`、`复杂`、`升级`，Jev 判出的一项带“Jev”标记，已标注项带勾选。选择即带 `label` 调用端点并关闭菜单；调用失败时不改变已显示的标注。
档位中文：`simple` 简单、`standard` 标准、`complex` 复杂、`escalated` 升级。Host 重启后内存映射为空，此前回合的按钮不再显示；已写入的记录不受影响。

#### Scenario: 有判档才显示按钮
- **GIVEN** m2 对应回合有判档；m3 的端点结果为 `{}`
- **WHEN** 分别以 m2、m3 渲染操作项
- **THEN** m2 渲染按钮，m3 渲染为空；每条消息只发出一次端点请求

#### Scenario: Tooltip 与菜单内容
- **GIVEN** m2 对应 `{tier: complex, effort: high, label: standard}`
- **WHEN** 渲染按钮并打开菜单
- **THEN** Tooltip 文本为 `AUTO 判档：复杂 → high · 你标注：标准`；菜单四项依次为 `简单`、`标准`、`复杂`、`升级`，`复杂` 带“Jev”，`标准` 带勾选

#### Scenario: 选择档位只调用插件标注端点，失败不改显示
- **GIVEN** 按钮已渲染、未标注
- **WHEN** 用户在菜单中选择 `标准`，端点分别返回成功与错误
- **THEN** 两次都只发出一次带 `label: standard` 的 `auto-model-routing.label` 请求，未调用官方反馈接口；成功时 Tooltip 追加“你标注：标准”，错误时 Tooltip 仍不含“你标注”
