# auto-model-routing Specification

## Purpose

主会话在 AUTO 下经 Jev（OpenRouter）判断推理投入，主模型不变；子任务独立判断模型能力与投入并由宿主应用精确路由。2026-10-25 用户授权将该新策略设为默认，不再要求选择版本；MANUAL 与现有会话模式不变。显式 `policy: legacy` 仅供回滚，保留旧配置。

## 决策服务与反馈

决策服务 SHALL 默认保留 OpenRouter，可切 TypeSafe 官方、Concentrate 或兼容 System One 自定义完整端点及明确模型。各服务 SHALL 使用独立固定凭据引用，不跨服务自动回退。自定义端点 SHALL 限 HTTPS 或回环 HTTP，无 URL 凭据、query、hash，拒绝重定向。切换服务草稿 SHALL 清空 key 草稿，保存后才管理新服务凭据。测试连接 SHALL 仅在用户点击时发送固定公开样例，不含会话文本。

新策略 SHALL 保留并展示主/子独立维度置信度、耗时、决策服务模型与推荐/实际应用状态。只有实际请求匹配才标已应用。缺失置信度 SHALL 显示未提供，不编造总分或等同任务成功率；toast 开关 SHALL 只控制临时提示，不隐藏 tooltip。子决策 SHALL 随精确身份持久恢复；主状态运行期保留，重启后下一回合重建。

## 当前默认 AUTO 契约

### Requirement: 默认新策略与显式回滚
缺省 policy SHALL 为内部 `policy-v2`，已有未含 policy 字段配置 SHALL 直接使用新策略且不改写配置文件或会话模式。设置 SHALL 不展示版本选择；旧四档映射 SHALL 仅在显式 legacy 回滚时展示和使用，不删除历史配置。

#### Scenario: 无版本选择即可使用
- **WHEN** 现有会话为 AUTO 且配置没有 policy 字段
- **THEN** 新策略生效；用户无需额外开启，MANUAL 会话保持不判档

### Requirement: 新策略决策与执行
主会话 SHALL 仅判断 depth=lower/baseline/higher 并在模型支持序列按推荐起点最多移动一档，不修改 provider/model、不调用会保存全局默认值的 selectModel。子任务 SHALL 独立判断 capability=bounded/analytical/frontier 或 insufficient_context，保留显式模型/effort，完全显式时不调用 Jev。正式 ordinary/fresh teammate 创建 SHALL 按精确 child ID 绑定、持久化、实际请求匹配后标 applied；恢复不重判。fork SHALL 报 unsupported，不悄悄改 fresh；Agent 保留编排和验收权，不实现自主重试升级。

#### Scenario: Magpie 自动子路由
- **WHEN** Magpie GPT 主会话为 AUTO 且创建 bounded 子任务
- **THEN** 从允许列表和实时目录验证同 transport 的 codex/gpt-6-luna 及支持 effort，持久绑定精确 child；不得转到本地入口

### Requirement: 手动隔离与失败可见
MANUAL SHALL 不触发新判断或主请求覆盖；此前绑定的子实例 SHALL 恢复既定路由。输入 SHALL 仅使用官方 user 来源并脱敏限长。主判断失败 SHALL 可见停用 AUTO，子失败 SHALL 停止派发而非继承/换模。Magpie transport SHALL 保留完整ID；未知能力家族需显式模型，未知推荐effort不猜。OpenRouter只用于Jev。性能与成本缺少证据 SHALL 标未知。

#### Scenario: 新策略不改官方全局模型
- **WHEN** AUTO 调整主 effort
- **THEN** 请求按支持范围生效，主 provider/model 保持，selectModel 调用数为零

## legacy 回滚契约作用域

下列历史 Requirements 与场景中的四档、共享 questions、选择器同步及映射配置仅约束显式 `policy: legacy` 回滚路径；不作为新默认 AUTO 的验收预期。新策略使用上述当前契约，旧格式读取、凭据保护和会话模式存储继续共用。

## Requirements

### Requirement: 模式与改写规则
系统 SHALL 为每个主会话提供 `AUTO` 与 `MANUAL` 两种模式，按会话持久化。新建普通会话的初始模式 SHALL 取设置项「新会话默认模式」（`MANUAL` | `AUTO`，缺省 `MANUAL`）：仅当普通会话以全新方式创建（不是恢复、清空、压缩或子会话）时，系统 SHALL 按创建时刻的设置值写入该会话的模式；此后修改设置 MUST NOT 改变已有会话的模式。没有状态记录的已有会话（例如设置生效前创建的会话）SHALL 视为 `MANUAL`。默认模式为 `AUTO` 时新会话的行为与用户手动切到 `AUTO` 相同（含 Jev 失败即停用）。
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

#### Scenario: 新会话按默认模式创建
- **GIVEN** 设置「新会话默认模式」为 `AUTO`
- **WHEN** 新建普通会话 S1，并恢复一个此前从未设置过模式的已有会话 S0，S1 派生子会话 C1
- **THEN** S1 的模式为 `AUTO`，其首个用户回合请求 Jev；S0 为 `MANUAL`；C1 不产生会话状态

#### Scenario: 修改默认模式不影响已有会话
- **GIVEN** 默认模式为 `AUTO` 时创建了会话 S1（`AUTO`），用户随后把 S1 切为 `MANUAL`
- **WHEN** 把默认模式改为 `MANUAL`，再改回 `AUTO`，然后 Host 重启
- **THEN** S1 始终为 `MANUAL`；改回后新建的会话 S2 为 `AUTO`

### Requirement: 用户回合与分类输入
系统 SHALL 只在 step 1 的 `agent/pre-step` 中、先执行 `await next()` 得到 `PreStepDecision` 后判定用户回合并请求 Jev 判断：结果为 `reject` 时 MUST NOT 请求 Jev、MUST NOT 记录本回合决定；结果为 `enter` 时只使用其 `messages`。**合格消息**为该次领取消息中 `source.kind` 严格等于 `"user"` 的消息；其它来源（含首轮 Host 注入的 `agent-instructions`、`plugin`、`plugin:<id>`、`runtime-context`、`time-context`、`skill-catalog`）与缺失 `source` 的消息 MUST NOT 贡献输入。合格消息数为 0 的回合不是用户回合，沿用上一用户回合的级别且不请求 Jev；首个用户回合之前无级别时不改写。分类输入为合格消息按领取顺序、消息内按块顺序的 `text` 块文本，以 `"\n"` 连接，经 `redact`（见“Jev 判断档位”）后取 `.slice(0, 8000)`；非文本块不贡献。决定 SHALL 按 (agent, turn) 保存，同回合后续请求（含同 turn/step 的错误重试）复用该决定。`origin = "subagent"` 会话 MUST NOT 被分类或改写。

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
系统 SHALL 在 AUTO 的用户回合 step 1 中，以一次 Jev `choice` 请求得出本回合档位 `simple | standard | complex | escalated`：经 `POST https://openrouter.ai/api/alpha/decisions`，模型 `typesafe/jev-1.13`，凭据 `OPENROUTER_API_KEY` 每次调用时经官方 credentials 服务解析（其固有优先级：启动环境 > 凭据存储文件 > 项目 `.env` > `$DSH_HOME/.env`；credentials 服务不存在时经官方 launch environment 读取），未解析到值时为 `missing-credential`；`questions` 为主会话与 `route_subagent` 共用的 `TIER_QUESTIONS`，SHALL 从 package 内唯一的规则文件 `packages/auto-model-routing/src/rubric.json` 读入（源码与评估脚本都从它读，不另存副本）；规则版本 `rubricVersion` SHALL 为 `sha256(JSON.stringify(TIER_QUESTIONS))` 的前 8 个十六进制字符，由代码计算、不手工维护；单次请求期限取设置项「Jev 期限」（整数毫秒，范围 1000–4500，缺省 3000；每次请求时读取），`redirect: 'error'`，MUST NOT 重试。Jev 返回后 SHALL 重新读取会话状态，等待期间模式已变时丢弃该结果（不写决定、不写 `disabled`）。成功时 SHALL 采用响应 `answers.tier.choice` 作为档位，`reason` 为 `jev`，不设置信度门槛。系统 MUST NOT 包含本地规则、关键词或通用对话模型的分类路径；代码只做上一档“升一级”的计算（档位序加一，`escalated` 封顶），不读消息内容。请求 MUST NOT 携带会话状态、其它会话内容或凭据以外的鉴权信息；出站主机 SHALL 仅为 `openrouter.ai`。

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

#### Scenario: 凭据从存储读取且换 key 立即生效
- **GIVEN** 启动环境中没有 `OPENROUTER_API_KEY`，credentials 存储中为 key A
- **WHEN** 发出一次 AUTO 判档，然后经设置页把 key 换成 B，再发出一次判档，再删除 key 后判档
- **THEN** 假 Jev 服务依次收到 `Bearer A`、`Bearer B`；第三次不发请求，会话以 `missing-credential` 停用；全程无需重启

#### Scenario: 期限按设置生效
- **GIVEN** 「Jev 期限」设为 1500，假 Jev 服务 2000ms 后才响应
- **WHEN** 发出一次 AUTO 判档
- **THEN** 约 1500ms 时以 `timeout` 停用；把期限改为 2500 后，下一次判档成功

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
系统 SHALL 把档位按 `await next()` 得到的实际官方 provider/model 转为 effort，MUST NOT 改变 provider/model ；同回合实际模型变化时 SHALL 按新模型重新映射，不重新请求 Jev。主会话 SHALL 优先读取provider/tier 的体系级显式 `mainEfforts`（作用该体系所有主模型）；未覆盖时用模型起点算法：Opus/Sonnet/Haiku/Sol 起点 medium，Fable/Luna 起点 high，Astra 起点 low，其它模型 medium，simple 降一级、standard 不变、complex 升一级、escalated 升两级，最高 xhigh。自动路由 MUST NOT 输出 max。

「自动 effort 上限」为 `low | medium | high | xhigh`，缺省 xhigh。缺省算法的目标 SHALL 取起点浮动结果与上限的较低者；候选集为模型实际支持的自动 effort 中不超过上限的值。目标不在候选集时取不超过目标的最高候选值，无则取候选集最低值；候选集为空时不改写，reason 为 `no-effort-support`，MUST NOT 为满足模型最低值而突破上限。

显式主映射保存时 SHALL 被当前目录该体系全部模型共同支持且不超过上限，目录无对应模型时拒绝新增覆盖；运行时 SHALL 校验官方实际模型支持该值。保存时出现冲突 SHALL 拒绝，MUST NOT 静默截断；使用时因文件修改或目录变化发现显式映射无效，SHALL 阻止该次 AUTO 请求并给出设置错误，MUST NOT 换模型、改用缺省映射或记为 Jev 失败停用。配置在下一次请求生效，同回合已完成的 Jev 判档仍复用。

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

#### Scenario: 上限压低主会话 effort
- **GIVEN** 「自动 effort 上限」为 `medium`，实际模型 `claude-opus-5-5` 支持全部五级
- **WHEN** 路由器为四个档位计算 effort
- **THEN** 依次输出 `low`、`medium`、`medium`、`medium`；上限为 `low` 时四个档位均为 `low`

#### Scenario: 上限对起点高于它的模型同样生效
- **GIVEN** 「自动 effort 上限」为 `medium`，实际模型 `claude-fable-5-1`（起点 `high`）
- **WHEN** 路由器为 `simple` 与 `standard` 计算 effort
- **THEN** 两者都输出 `medium`

#### Scenario: 主会话显式映射作用整个体系
- **GIVEN** codex/simple 显式设为 medium，Claude 未覆盖，官方目录各模型支持该值
- **WHEN** Jev 判 simple，实际模型分别为 Sol、Luna、Astra、Opus
- **THEN** 前三者均使用 medium，Opus 使用缺省 low；不改 provider/model

#### Scenario: 显式映射使用时失效
- **GIVEN** 已存 claude/complex=high，之后模型目录不再支持 high
- **WHEN** AUTO 请求经过路由器
- **THEN** 返回设置错误阻止请求，不静默改成其它 effort、不调用其它模型、不写 Jev disabled

### Requirement: 子会话决策工具与 skill
系统 SHALL 注册 Host 工具 `route_subagent`，参数 `{task: string, provider: "claude" | "codex", model?: string}`，描述须说明会把任务文本发送给 OpenRouter/TypeSafe：以与主会话相同的 Jev 客户端、`TIER_QUESTIONS` 与失败类别判断档位（`state` 上一档位为 `none`），成功返回 `{tier, provider, model, reasoning_effort}`。子会话推荐 SHALL 按 provider/tier 读取设置中的完整 `childRoutes` 组合 `{model, reasoningEffort}`；未覆盖的格子用代码默认表（claude 为 Haiku/Sonnet/Opus/Opus，codex 为 Luna/Sol/Sol/Sol）与所选模型的缺省起点算法生成完整组合，再应用全局 effort 上限与模型支持范围。用户可在官方允许列表中选择 Fable/Astra；默认表不含它们。子会话推荐 MUST NOT 继承 `mainEfforts`，MUST NOT 受调用会话当前模型限制。调用方传入 `model` 时（用户或 lead 已指定子会话模型），工具 SHALL 只推荐 effort：返回的 `model` 等于传入值，MUST NOT 查默认表或 `childRoutes`（即使某格配置了同一模型也不采用其 effort），effort 按该模型的缺省起点算法、全局 effort 上限与模型支持范围计算；该模型不在当前模型目录、不属于所给 provider、不在当前官方允许列表或无可用 effort 时 SHALL 返回设置错误并要求暂停委派，MUST NOT 换成其它模型。所属主会话不是 AUTO 时，传入 `model` 也同样返回 `routed: false`，不判档、不外发。显式 effort MUST NOT 被静默改写；模型不在当前官方允许列表、effort 不被支持或超过上限、无有效默认 effort 时 SHALL 返回设置错误并要求暂停委派，不换模型、不回退到其它映射、不记为 Jev 失败、不改会话状态。工具使用时 SHALL 重新校验当前列表与模型能力，最终仍由官方创建校验和会话白名单快照把关。失败返回错误结果，内容为该类别提示与“暂停委派并询问用户”；`exec.signal` 取消时返回“已取消”错误结果，不含余额/凭据提示。工具 MUST NOT 改写任何会话状态。工具 SHALL 先确定**所属主会话**：调用会话为普通会话时即其本身；为子会话时经 `ctx.agents.get(header.parentSession)` 逐级向上，找到第一个非 `origin = subagent` 的会话；链上任一会话不在 live 注册表中时视为 MANUAL。模式按所属主会话 id 从插件状态读取。所属主会话模式不是 `AUTO`（含因 Jev 失败停用）时，工具 MUST NOT 请求 Jev、MUST NOT 外发任务文本，返回非错误结果 `{routed: false, reason: "manual"}`，渲染文本说明“主会话为 MANUAL：不判档，按官方默认委派；只传用户或 lead 指定的值（例如指定的模型），不传其它 provider/model/reasoning_effort”；只有所属主会话为 `AUTO` 时才判档。系统 SHALL 提供 skill `subagent-model-routing`，其文本须要求：(1) 委派前调用 `route_subagent`；用户或 lead 已同时指定模型与 effort（或只指定 effort）时不调用工具，按指定值委派；只指定模型时调用工具并传入该 `model`，其余规则不变；工具返回 `routed: false` 时只传用户或 lead 指定的值；(2) 将返回的 `provider`、`model`、`reasoning_effort` 全部显式传给官方 `subagent`；(3) 在 `description` 末尾以 `[model·effort]` 标注；(4) 默认 provider 为当前会话 provider，用户或 lead 要求独立体系时改用另一个；当前 provider 不是 `claude`/`codex` 时暂停委派并询问用户；(5) 工具失败时暂停委派并询问用户，MUST NOT 自行猜测档位、改由主会话完成或换用其它模型；(6) 复用已有子会话前比较其标注，更高或无法确认时新建；(7) `route_subagent` 工具不存在时告知用户“子会话 Jev 选模未启用”，按官方默认委派且不传 provider/model/reasoning_effort，不得猜档位；(8) 工具返回 `routed: false` 时按官方默认委派且不传 provider/model/reasoning_effort，不询问用户、不猜档位。路由器 MUST NOT 改写子会话的创建参数或请求。

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
- **GIVEN** 调用会话为 `AUTO` 且当前模型为 `claude-haiku-5-5`，子会话模型表为缺省值，Jev 对任务返回 `escalated`
- **WHEN** 以 `provider: claude` 调用 `route_subagent`
- **THEN** 返回 `{escalated, claude, claude-opus-5-5, xhigh}`；对四个档位与两个 provider 的全部组合，返回值中不出现 `claude-fable-5-1`、`gpt-6-astra` 或 `max`

#### Scenario: 子会话显式推荐按设置生效
- **GIVEN** 当前官方允许列表与模型目录允许 Fable/Astra；`claude.escalated` 配置 Fable/high，`codex.simple` 配置 Astra/low，上限 high
- **WHEN** Jev 分别判为 escalated 与 simple，工具按对应 provider 调用
- **THEN** 返回 Fable/high 与 Astra/low；未覆盖的 claude.standard 仍为 Sonnet/medium；修改主会话 Fable 的映射不影响子会话推荐

#### Scenario: 使用时发现推荐失效
- **GIVEN** 已保存子会话推荐 Sol/high，之后官方移除 Sol，或文件被改为超过上限的 effort
- **WHEN** AUTO 下调用 route_subagent 并判到该档
- **THEN** 返回明确设置错误并要求暂停委派，不返回另一个模型或较低 effort，不改变根会话模式和 disabled

#### Scenario: 指定模型时只推荐 effort
- **GIVEN** 调用会话为 `AUTO`；当前模型目录与官方允许列表包含 `gpt-6-astra`（支持 low..xhigh），上限 xhigh；`childRoutes.codex.complex` 配置为 Astra/high
- **WHEN** Jev 依次返回四个档位，每次以 `provider: codex, model: gpt-6-astra` 调用 `route_subagent`
- **THEN** 返回的 `model` 均为 `gpt-6-astra`，`reasoning_effort` 依次为 `low`、`low`、`medium`、`high`（不采用 `childRoutes` 中的 high）；假 Jev 服务收到 4 个请求

#### Scenario: 指定模型不可用时不换模型
- **GIVEN** 调用会话为 `AUTO`
- **WHEN** 分别以 `provider: codex, model: gpt-6-astra`（不在官方允许列表）、`provider: claude, model: gpt-6-astra`（provider 不符）、`provider: claude, model: claude-unknown`（不在模型目录）调用 `route_subagent`
- **THEN** 三次都返回设置错误，含“暂停委派并询问用户”，不返回其它模型；会话模式与 `disabled` 不变

#### Scenario: 指定模型且主会话为 MANUAL
- **GIVEN** 会话 S1 为 `MANUAL`
- **WHEN** 以 `provider: codex, model: gpt-6-astra` 调用 `route_subagent`
- **THEN** 返回 `{routed: false, reason: manual}`，渲染文本含“只传用户或 lead 指定的值”；假 Jev 服务收到 0 个请求

#### Scenario: 工具失败返回类别且不改状态
- **GIVEN** Jev 返回 402，主会话 S1 为 `AUTO` 且无 `disabled`
- **WHEN** 调用 `route_subagent`
- **THEN** 结果为错误，内容含“余额不足”与“暂停委派并询问用户”；S1 仍为 `AUTO` 且无 `disabled`

#### Scenario: 主子会话问题定义相同
- **GIVEN** 主会话一个 AUTO 用户回合与一次 `route_subagent` 调用
- **WHEN** 记录二者发往假 Jev 服务的 body
- **THEN** 两个 body 的 `model` 与 `questions` 深度相等，仅 `state` 不同

#### Scenario: skill 文本包含八项规则
- **GIVEN** 插件安装目录中的 `skills/subagent-model-routing/SKILL.md`
- **WHEN** 测试读取其文本
- **THEN** 文本包含 `route_subagent`、`reasoning_effort`、`[model·effort]`、独立体系规则、非 claude/codex provider 时询问、“暂停委派并询问用户”、复用“新建”规则、“只指定模型”时传 `model` 的规则、“子会话 Jev 选模未启用”及 `routed: false` 时按官方默认委派，且不含档位表模型名

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
本插件只提供六个经 `connection.fetch.register` 注册的端点：读取状态、设置模式、标注（`label`，参数与校验见“判档记录与人工标注”），以及读取设置、保存设置、设置 API key（三者见“设置页”，不带 `sessionId`、不读写任何会话状态）。前三者 SHALL 以请求体 `sessionId` 经官方会话控制器解析目标会话（与官方会话端点同一授权模型）；`sessionId` 缺失、非字符串、无法解析或指向 `origin = "subagent"` 会话时 SHALL 返回 4xx 且不修改任何状态；设置模式 SHALL 只修改该会话的模式与 `disabled`（设为 `AUTO` 时清除），`mode` 不属于 `AUTO | MANUAL` 时返回 4xx；读取状态 SHALL 返回 `disabled`（如有）。

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
- 派发前 MUST 先调用 `route_subagent`（工具存在时；已指定 effort 时除外）：只指定了模型时调用时传入该模型，工具只推荐 effort；返回 `routed: false` 时按官方默认委派、只传用户或 lead 指定的值；成功时把返回的 provider、model、reasoning_effort 全部显式传给官方子会话工具；工具出错时暂停委派并询问用户；详细规则见 `subagent-model-routing` skill。此步骤 SHALL 直接写在该节中，使 Agent 不必先加载 skill 也能执行（2026-10-22 验收：AUTO 回合中 Agent 未加载 skill 便直接委派，子会话继承了父会话 AUTO 设的 effort）。
该节 MUST NOT 引用具体模型名或 effort 值（唯一来源为插件代码）。本 change MUST NOT 新增物化机制，沿用 `agentInstructions` 将其物化为 `$DSH_HOME/AGENTS.md`（已有 `tests/sync-agent-instructions.test.mjs` 覆盖物化、幂等与撤销）。

#### Scenario: 环境级指令含派发规则且不含模型名
- **GIVEN** 仓库中的 `instructions/dsh-home.md`
- **WHEN** 测试读取其文本
- **THEN** 含标题“子会话派发”，含“独立评审”“并行”“route_subagent”“不派发”与“本身是子会话时不再向下派发”；含“必须先调用 `route_subagent`”“只指定了模型”“`routed: false`”“reasoning_effort”与“暂停委派并询问用户”；不含任何 `claude-`、`gpt-` 开头的模型名，也不匹配 `\bxhigh\b`、`\bmax\b`

### Requirement: 判档记录与人工标注
系统 SHALL 把主会话 AUTO 用户回合的每次成功判档追加一行到 `$DSH_HOME/state/auto-model-routing/judgements.jsonl`：`{sessionId, turn, tier, effort?, model, rubricVersion}`，写入时机为成功判档后该回合首个请求（无论是否映射出 effort，未映射时省略 `effort`）；`route_subagent`、失败、取消、被丢弃与非用户回合不写判档行。标注也是追加一行 `{sessionId, turn, label}`。行 MUST NOT 包含消息文本、上一轮上下文、响应体或凭据。追加失败 MUST NOT 影响请求、MUST NOT 停用 AUTO，只记一条日志。读取方 SHALL 按 `(sessionId, turn)` 折叠：判档取最后一条判档行，标注取最后一条标注行；无法解析的行跳过。

Host SHALL 经 `session/event` 观察 `assistant/message`，在内存中记录 `messageId → turn`（每会话一个 Map）。非用户回合（`continued`）的助手消息 SHALL 记到该会话最近一个用户回合；该用户回合没有判档时 MUST NOT 建立映射。

系统 SHALL 提供一个与现有端点同一授权模型的端点 `auto-model-routing.label`：参数 `{sessionId, messageId, label?}`。`messageId` 对应回合有判档时，无 `label` 返回 `{tier, effort?, label?}`，带 `label`（四档之一）时先追加标注行再返回同一结构，追加失败返回 5xx 且不返回 `label`；`messageId` 不在映射中或回合无判档时返回 `{}` 且不写入。`sessionId` 缺失、非字符串、无法解析、指向子会话，`messageId` 非字符串，或 `label` 不属于四档时 SHALL 返回 4xx 且不写入。

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
- **GIVEN** S1 回合 3 有判档 `complex`；回合 3 有助手消息 m1、m2；回合 4 为子会话完成通知开启的回合，有助手消息 m3；回合 5 是 MANUAL 下的用户回合（无判档），回合 6 为其后的子会话完成通知回合，有助手消息 m6
- **WHEN** 以 m1 查询，以 m3 标注 `standard`，再以 m2 查询，最后以 m6 查询
- **THEN** 第一次返回 `{tier: complex, effort: high}`；第二次追加一行 `{S1, 3, standard}` 并返回 `label: standard`；第三次返回 `{tier: complex, effort: high, label: standard}`；第四次返回 `{}`

#### Scenario: 标注追加失败返回错误
- **GIVEN** S1 回合 3 有判档，`judgements.jsonl` 此时不可写
- **WHEN** 以回合 3 的消息标注 `simple`
- **THEN** 返回 5xx，响应不含 `label`；会话状态不变

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
- Tooltip 文本：`AUTO 判档：<档位中文> → <effort>`（无 `effort` 时省略 ` → <effort>`），已标注时追加 ` · 你标注：<档位中文>`。
- 点击打开官方 `Menu`，标题“这轮应该用哪档？”，四项依次为 `简单`、`标准`、`复杂`、`升级`，Jev 判出的一项带“Jev”标记，已标注项带勾选。选择即带 `label` 调用端点并关闭菜单；调用失败时不改变已显示的标注。
档位中文：`simple` 简单、`standard` 标准、`complex` 复杂、`escalated` 升级。Host 重启后内存映射为空，此前回合的按钮不再显示；已写入的记录不受影响。

#### Scenario: 有判档才显示按钮
- **GIVEN** m2 对应回合有判档；m3 的端点结果为 `{}`
- **WHEN** 分别以 m2、m3 渲染操作项
- **THEN** m2 渲染按钮，m3 渲染为空；每条消息只发出一次端点请求

#### Scenario: Tooltip 与菜单内容
- **GIVEN** m2 对应 `{tier: complex, effort: high, label: standard}`；m4 对应 `{tier: simple}`（无 effort）
- **WHEN** 渲染两者的按钮并打开 m2 的菜单
- **THEN** m4 的 Tooltip 文本为 `AUTO 判档：简单`；m2 的 Tooltip 文本为 `AUTO 判档：复杂 → high · 你标注：标准`；菜单四项依次为 `简单`、`标准`、`复杂`、`升级`，`复杂` 带“Jev”，`标准` 带勾选

#### Scenario: 选择档位只调用插件标注端点，失败不改显示
- **GIVEN** 按钮已渲染、未标注
- **WHEN** 用户在菜单中选择 `标准`，端点分别返回成功与错误
- **THEN** 两次都只发出一次带 `label: standard` 的 `auto-model-routing.label` 请求，未调用官方反馈接口；成功时 Tooltip 追加“你标注：标准”，错误时 Tooltip 仍不含“你标注”

### Requirement: 设置页
系统 SHALL 在官方设置页注册「自动模型路由」，提供读取设置、保存设置、设置 API key 三个已认证 Host 端点。非密钥设置 SHALL 保存在 `$DSH_HOME/plugins/dsh-auto-model-routing/config.json`（目录 0700、文件 0600，原子替换），字段均可缺省：
- `decisionToast`：布尔，缺省 true；
- `defaultMode`：MANUAL | AUTO，缺省 MANUAL；
- `effortCap`：low | medium | high | xhigh，缺省 xhigh；
- `jevTimeoutMs`：1000–4500 整数，缺省 3000；
- `mainEfforts`：按 provider（claude/codex）、tier 索引的稀疏体系 effort 覆盖，适用于该体系所有主模型；
- `childRoutes`：按 provider（claude/codex）、tier 索引的稀疏 `{model, reasoningEffort}` 完整组合覆盖。
模型 id SHALL 为 1–128 个字母数字或 `._:-` 字符；tier SHALL 为四档之一，effort SHALL 为自动集合之一。页面保存 SHALL 只持久化被修改的覆盖；恢复默认 SHALL 删除该格覆盖，不固化其它缺省值。

写入 SHALL 整体校验、保留未修改字段，拒绝未知字段、形似凭据的字段名、非法 provider/model/tier/effort。Host SHALL 重新验证本次提交涉及的显式映射：主 effort 被当前目录该体系全部模型共同支持且目录非空；子模型在当前启用的官方子智能体允许列表与可用目录的交集中；effort 被该模型支持且不超过新上限。降低上限 SHALL 验证所有存续的显式覆盖并拒绝冲突；同一次提交可同时修复映射。失败 SHALL 返回字段级错误且配置文件字节不变，MUST NOT 自动换模型、选择其它 effort 或静默截断。未改动的历史失效记录可保留并提示，但不能因此允许新增或修改成失效组合。

文件缺失/不可解析时 SHALL 使用缺省设置并报告配置状态；可独立解析的非法普通字段按缺省值处理。显式路由覆盖有误时 SHALL 保留可识别的错误状态，不把它当作未配置而静默恢复默认。读取/保存/使用映射时均核验所需能力，下一次请求或工具调用采用新配置，无需重启。

读取响应 SHALL 包含设置、默认值、配置问题、API key 状态 `{configured, source?, writable}`、当前主会话可用模型目录、子会话允许列表状态、模型展示名与实际 reasoning efforts，以及当前 `rubric.json` 的四档 criteria 原文；MUST NOT 包含 key 值。

页面 SHALL 按 Claude / GPT 分页，GPT 内部 provider id 为 codex。切换分页 SHALL 保留其它视图的未保存草稿，MUST NOT 切换真实会话模型或调用会话 selectModel。每页包含：
- MUST NOT 显示表格上方的主会话模型选择器；主会话列直接管理本页体系全部模型；
- 四行表格，列为「档位」「主会话推理等级」「子会话推荐」；
- 档位只显示英文名 + info，hover/键盘聚焦直接显示规则文件 criteria 原文，MUST NOT 维护中文描述或第二份规则副本；
- 主会话格可选择该体系此档的统一 effort，候选为当前体系所有主模型支持交集且不超过上限；未覆盖时显示「默认（随模型）」而非任意模型算例；子会话格可选择完整 model + effort，收起时两者作为同一个 trigger 展示，打开为「模型」「推理等级」两行，再进入各自候选菜单；
- 子模型只能选择当前官方允许列表内且可用的同 provider 模型。effort 菜单只列所选模型支持且不超过上限的自动等级。换模型时原 effort 若仍有效则保留，否则要求用户重新选择并阻止保存；不得悄悄选一个新值；
- 已存模型后来被移除时，仅以不可用状态显示旧值，不把旧值放进可选项。列表未启用、为空或不可读取时禁用子会话 picker 并说明原因，其它可验证设置仍可保存；
- 推理强度上限放在通用行为分区。超上限的显式格子显示冲突并阻止保存，不显示划线自动降档预览；
- 常驻说明主会话保留真实当前模型、子会话推荐仅用于 route_subagent 后续委派，不改现有子会话、不决定是否派发，并提示官方允许列表是会话创建时的快照。

三个分段控件（Claude/GPT、MANUAL/AUTO、effort 上限）SHALL 统一紧凑高度 28px、字号 12px、内边距和圆角，随内容自然占宽，不用固定宽度放大体系 tabs。字段保持官方 13px 阅读尺寸、辅助动作/控件用 12px、分区标题 13px/600 体现层级；表格 picker 同样紧凑。

页面 SHALL 复用官方主题令牌、表单与菜单基础组件，深浅色跟随宿主；图标使用用户选定的 E 字形，仅修改自己的导航行，定位失败保留官方默认图标。菜单 SHALL 支持键盘选择、Escape 返回上层/关闭、关闭后焦点回 trigger，浮层不得被表格裁切；窄栏不得水平溢出。

设置 API key 端点接受 `{value: string}`（保存/替换）或 `{value: null}`（删除），经官方 credentials 服务写入 OPENROUTER_API_KEY。空、超过 512 字符或含空白时拒绝。启动环境只读来源 SHALL 拒绝修改，页面说明先移除启动环境变量并重启，再在这里保存；MUST NOT 指导用户在只读覆盖下先保存。credentials 服务不可用时禁用输入。任何响应、日志、配置文件与错误 MUST NOT 含 key 值；输入不预填，保存后清空草稿；保存 key 不自动清除会话 disabled。key 与非密钥配置是独立提交，任一失败时 SHALL 明确显示哪部分已保存、哪部分未保存，不宣称跨存储原子提交成功。

#### Scenario: 保存普通设置不固化映射
- **GIVEN** 文件只含 decisionToast=false
- **WHEN** 保存 defaultMode=AUTO、jevTimeoutMs=2500
- **THEN** 保留 decisionToast，文件为 0600，不添加 mainEfforts 或 childRoutes；后续新会话与请求采用新设置

#### Scenario: 非法设置整体拒绝
- **GIVEN** 当前设置有效
- **WHEN** 分别提交期限 6000、effortCap=max、defaultMode=auto、非法 model id、未知字段 foo、凭据字段 apiKey
- **THEN** 每次均返回字段错误，文件字节不变

#### Scenario: 分页只编辑体系草稿且没有主模型选择器
- **GIVEN** 真实会话模型为 Sol，主目录有 Claude Opus/Fable 与 GPT Sol/Luna/Astra
- **WHEN** 在 Claude 页编辑 simple=medium，再切 GPT 页并返回 Claude
- **THEN** Claude 草稿仍为 medium，真实会话与默认模型未改变；页顶没有主会话模型选择器，表格主列仍可编辑

#### Scenario: 主 effort 不受子列表限制
- **GIVEN** Fable 支持 high 且在 Claude 主目录，但不在子允许列表
- **WHEN** 设置 Claude 主列 complex=high 并打开子模型菜单
- **THEN** 该主设置作用所有 Claude 模型，子模型菜单不可选 Fable

#### Scenario: 体系主 effort 校验全模型支持交集
- **GIVEN** GPT 主目录模型 A 支持 low/medium/high，B 仅支持 low/medium
- **WHEN** 尝试保存 codex/complex=high，再保存 medium
- **THEN** high 被 Host 拒绝且文件不变，medium 成功；页面仅列 low/medium，恢复默认仍可用

#### Scenario: picker 可同时配置模型与 effort
- **GIVEN** GPT 允许列表与目录有 Luna/Sol，上限 xhigh
- **WHEN** simple 子会话 picker 从 Luna/medium 改为 Sol/high 并保存
- **THEN** trigger 显示 Sol High；AUTO 下工具判为 simple 时精确返回 Sol/high，不重新套用模型起点

#### Scenario: 换模型时要求有效 effort
- **GIVEN** 原草稿为模型 A/xhigh，新允许模型 B 仅支持 low/medium
- **WHEN** picker 改为 B
- **THEN** 提示重新选择推理等级并阻止保存；选 medium 后保存 B/medium

#### Scenario: 允许列表收缩与保存竞态
- **GIVEN** 页面打开时 Sol 被允许，之后官方移除 Sol
- **WHEN** 提交新的 Sol 推荐，然后重新读取页面
- **THEN** Host 拒绝提交且文件不变；之前已存的 Sol 推荐仅显示为不可用旧值，菜单不能选 Sol，用户可改选有效项

#### Scenario: 上限冲突必须显式修复
- **GIVEN** 已保存 claude/complex=high 和 GPT 子会话 complex=Sol/high
- **WHEN** 单独把上限降为 medium，再在同一次请求中连同两格改为 medium 提交
- **THEN** 首次返回两个格子的冲突且不保存；第二次整体成功，精确保存 medium，无静默降档或划线旧值

#### Scenario: 恢复默认不复制缺省表
- **GIVEN** mainEfforts 中只有 codex/simple=medium
- **WHEN** 恢复该格默认并保存
- **THEN** 删除该覆盖，显示「默认（随模型）」，各实际模型恢复自己的默认算法，不新增模型记录

#### Scenario: 档位描述只有一个来源
- **GIVEN** simple 的 criteria 为规则文件中的英文原文
- **WHEN** hover 或键盘聚焦 simple 的 info
- **THEN** tooltip 显示完全相同的英文字符串，无中文转述，浮层不被表格裁切

#### Scenario: 设置文件损坏
- **GIVEN** 文件不可解析，或普通字段 effortCap=max 而期限为 2000
- **WHEN** 打开页面并解析设置
- **THEN** 前者使用默认并说明保存将覆盖损坏文件；后者上限用 xhigh、期限用 2000；非法显式映射另显示错误而不静默删除

#### Scenario: 缺少允许列表服务
- **GIVEN** 子列表不可读取或未启用
- **WHEN** 打开页面并修改提示开关
- **THEN** 子 picker 禁用且给出配置指引；提示开关可保存，历史推荐不被改写

#### Scenario: key 的只读来源与迁移
- **GIVEN** key 来自启动环境
- **WHEN** 打开页面并尝试替换
- **THEN** 显示只读并拒绝，提示先移除环境变量、重启、再保存；重新由存储管理后换 key 下一次请求生效，不回传 key

#### Scenario: 独立保存结果与不泄漏
- **GIVEN** credentials 可写，用户同时编辑 key 和普通设置
- **WHEN** key 保存成功而普通设置因映射冲突失败
- **THEN** 明确显示 key 已保存、设置未保存，清空 key 草稿但保留配置草稿；响应、日志与配置文件无 key

#### Scenario: 导航图标只作用于本区块
- **GIVEN** 设置导航中有本区块与其它插件
- **WHEN** 插件挂载再卸载
- **THEN** 只有自己的导航行使用 E 字形；卸载清除标记，找不到行不报错

#### Scenario: 旧逐模型主覆盖不静默沿用
- **GIVEN** 文件中仍有 mainEfforts.codex.gpt-6.1-sol.simple=medium 的旧形状
- **WHEN** 读取设置并发 AUTO 请求，随后只保存提示开关
- **THEN** 页面诊断旧配置、提供整组重设动作；AUTO 报设置错误，不静默采用旧值/默认；普通保存保留旧数据
- **WHEN** 用户明确将该体系恢复默认（provider=null）或提交新的 provider/tier 对象
- **THEN** 只删除或替换该旧体系对象，另一体系和子推荐不受影响

#### Scenario: 设置分段控件紧凑一致
- **WHEN** 在真实主题下渲染设置页
- **THEN** 三组 tabs 均为 28px 高、12px 字号，内边距圆角一致，体系页签不拉伸为大块，深浅色跟随宿主且窄栏不溢出

### Requirement: 插件安装自包含配套 skill
安装本插件 SHALL 同时提供 `route_subagent` 工具和唯一的 `subagent-model-routing` skill，不依赖 ohmydsh 根目录的 skills 或环境级指令。skill SHALL 保留既有八项派发规则，但 MUST NOT 声称仅注册 skill 就能强制 Agent 每次委派前执行工具。ohmydsh SHALL 仅保留插件的 local customization；原独立 skill 的受管部署副本 SHALL 在迁移同步时撤销，不删除用户自建的非受管副本。禁用插件并重新装配后，其工具及包内 skill SHALL 均不可用，用户设置与判档记录 SHALL 保留。

#### Scenario: 干净安装获得唯一 skill
- **WHEN** 在不含 ohmydsh 指令或全局 skill 的干净 DSH profile 安装并加载发布包
- **THEN** 真实 Host 的 skill catalog 中 `subagent-model-routing` 恰好出现一次，加载其正文可见既有八项规则；工具集包含 `route_subagent`

#### Scenario: 旧部署迁移无重复来源
- **GIVEN** 上一版本通过 manifest 的独立 skill 条目产生受管副本
- **WHEN** 升级到 0.3.0 并连续执行两次隔离 sync，再重新装配 Host
- **THEN** 旧受管副本不再存在，包内 skill 恰好注册一次，第二次 sync 为 no-op；现有配置、模式与判档记录未被修改

#### Scenario: 插件禁用撤销 skill 与工具
- **WHEN** 从 profile 移除插件或在 ohmydsh 禁用插件后同步并重新装配
- **THEN** 本插件提供的 skill 和工具不再注册；非插件管理的 skill 与既有数据不被删除

### Requirement: 独立分发与可验证发布
本插件 SHALL 提供自包含的 npm 发布物与可从 Git 源码构建的公开镜像。发布物 SHALL 包含 Host/Web 入口、bundle patch、配套 skill、许可证及 README 引用的展示资产；独立安装 MUST NOT 依赖 monorepo node_modules、配置或相对路径。公开安装说明 SHALL 披露兼容性、默认 MANUAL、Jev 外发文本与脱敏限制、凭据和状态写入位置。公开镜像 SHALL 由 ohmydsh 已提交的包目录生成，不成为第二份可独立编辑的真源。

#### Scenario: 打包安装与源码安装均可加载
- **WHEN** 分别在独立临时目录从 npm 打包产物安装、从已提交的镜像源码安装，并执行规定构建生命周期
- **THEN** Host/Web 入口可解析，bundle 能装配工具及 skill；README 图片与包内路径均有效，无 ohmydsh 私有路径依赖

#### Scenario: 发版身份一致
- **WHEN** 镜像 release workflow 发布版本
- **THEN** 版本 tag 与包版本必须匹配，否则发布前失败；长期自动发布通过绑定该仓库和 workflow 的 OIDC 完成，仓库与日志中不存在长期 npm token

#### Scenario: 外部步骤未满足前置条件
- **WHEN** npm 认证、商店年龄/准入校验、审核或索引探测尚未完成
- **THEN** 发布记录分别标明待办条件、已发布版本、PR/申请地址与可见性；不得把创建仓库、发出 PR 或 registry 暂存状态当作已上架，也不得用重复发版绕过等待
