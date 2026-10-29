# auto-model-routing Specification

## Purpose

主会话在 AUTO 下经所选决策服务的 Jev 判断推理投入，主模型不变；子任务独立判断模型能力与投入，由宿主在官方 fresh 创建的精确子会话上应用路由。插件只有一套 AUTO 策略，没有策略或记录格式的版本选择；与模型家族相关的知识（支持范围、effort 起点、能力槽的模型名）全部来自「家族策略注册表」；provider 不登记，子会话沿用直接父会话的 provider。MANUAL 与会话模式存储不变。需要 0.5.0 之前的四档行为时，在 ohmydsh `dsh.yaml` 中把该条目固定为已发布的 0.4.x 包，插件内不提供回滚开关。

本 spec 的全部 Requirements 都是当前契约。旧配置字段、旧子会话记录与旧反馈账本按「旧配置与旧记录只读兼容」处理。

## 决策服务与反馈

决策服务 SHALL 默认保留 OpenRouter，可切 TypeSafe 官方、Concentrate 或兼容 System One 自定义完整端点及明确模型。各服务 SHALL 使用独立固定凭据引用，不跨服务自动回退。自定义端点 SHALL 限 HTTPS 或回环 HTTP，无 URL 凭据、query、hash，拒绝重定向。切换服务草稿 SHALL 清空 key 草稿，保存后才管理新服务凭据。测试连接 SHALL 仅在用户点击时发送固定公开样例，不含会话文本。

AUTO SHALL 保留并展示主/子独立维度置信度、耗时、决策服务模型与推荐/实际应用状态。只有实际请求匹配才标已应用。缺失置信度 SHALL 显示未提供，不编造总分或等同任务成功率；toast 开关 SHALL 只控制临时提示，不隐藏 tooltip。子决策 SHALL 随精确身份持久恢复；主状态运行期保留，重启后下一回合重建。

## Requirements

### Requirement: 手动隔离与失败可见
MANUAL SHALL 不触发新判断或主请求覆盖；此前绑定的子实例 SHALL 恢复既定路由。输入 SHALL 仅使用官方 user 来源并脱敏限长。主判断失败 SHALL 可见停用 AUTO；子任务路由不可用或子任务判断失败 SHALL 按「子任务路由退化链」不改写并可见告警，MUST NOT 换 provider 或改用能力槽以外的模型。provider SHALL 保留完整 ID；未知能力家族保持父模型只调 effort，未知推荐 effort 不猜。OpenRouter只用于Jev。性能与成本缺少证据 SHALL 标未知。

#### Scenario: AUTO 不改主 provider/model
- **WHEN** AUTO 调整主 effort
- **THEN** 请求按支持范围生效，主 provider/model 保持；effort 变化时只以同 provider/model 经官方 selectModel 同步

#### Scenario: 子失败不换模且可见
- **GIVEN** 根会话为 `AUTO`，受管子任务 Jev 超时
- **WHEN** 子会话发出首个请求
- **THEN** 请求与官方合成配置深度相等（未换 provider/model）；根会话状态含 `childNotice.reason = "jev-timeout"`

### Requirement: Magpie 兼容不扩大权限与能力范围
新旧 Magpie 的候选 SHALL 同时满足精确 provider/model 的实时目录能力、自动 effort cap、当前官方允许列表及存在时的父会话 captured allowlist；不满足时 SHALL 按「子任务路由退化链」继续，MUST NOT 改写为该候选。兼容分类 SHALL NOT 将另一 transport 的许可视为本 transport 许可，不添加或放宽任何 allowlist 项，不静默突破能力或 effort cap；沿用父会话模型同样须满足上述全部条件。持久记录损坏 SHALL 继续 fail closed。

#### Scenario: GPT 主子保持同 transport 及支持的 effort
- **GIVEN** AUTO Magpie GPT 主模型与同 transport 的 bounded GPT 子模型均在目录/允许列表内且支持目标 effort
- **WHEN** 主请求和 fresh 子请求应用新默认策略
- **THEN** 主 provider/model 不变并应用支持的 effort；子使用同 transport 的 codex/gpt-6-luna，持久恢复后保持身份和 effort

#### Scenario: 更新全局目录不能扩大父 captured allowlist
- **GIVEN** 任一 Magpie 父会话 captured allowlist 不含当前目标，即使较新全局目录和列表已含该目标
- **WHEN** 创建需要该目标的子实例
- **THEN** 子请求不被改写为该目标（按退化链保持父模型只调 effort，或不改写并告警），无越权实际子请求；另一 Magpie transport 的许可与不支持/超过 cap 的 effort 也不能使该目标被选用

### Requirement: AUTO 主 effort 同步官方选择
AUTO 主请求 SHALL 保持官方合成 provider/model，按 depth 算法、实时支持与 effort cap 选 effort；与官方合成 effort 不同时 SHALL 等待官方 sessionController.selectModel，以同 sessionId/provider/model 和选定 reasoningEffort 更新选择，允许官方保存全局 defaults。相同 effort SHALL 不重复同步。官方同步失败或 writer 尚不可用 SHALL 记录可诊断告警，保留官方原请求 effort 以避免再次产生显示差异，不将目标 effort 标为 applied、不静默吞错、不换模型；MANUAL、无 effort 支持及已绑定 child 请求 SHALL 不因此写官方选择。判断与 child 精确绑定不受本要求影响。

#### Scenario: 同次主请求同步官方 effort 与 defaults
- **GIVEN** AUTO 主模型 pending medium，模型支持 high，Jev depth 为 higher
- **WHEN** 真实主请求执行（包含新旧 Magpie 与普通 route）
- **THEN** adapter/header、官方选择与默认保存均为同 provider/model 的 high；同步完成后才发出该请求，不产生递归请求，后续相同 effort 不重复写

#### Scenario: 同步失败不丢本次请求
- **GIVEN** 官方当前选择 medium、AUTO 目标 high，但官方 selectModel 拒绝或 writer 不可用
- **WHEN** 主请求执行
- **THEN** 记录同步告警，实际请求保留原 provider/model/medium，使选择与请求一致；不停用 AUTO、不伪造目标 high 已同步或 applied

#### Scenario: 手动与子请求不污染默认
- **GIVEN** MANUAL 主会话、同 effort AUTO 主请求，或此前精确绑定的 child
- **WHEN** 对应请求执行或恢复
- **THEN** MANUAL 请求原样通过，child 保持既定路由；均无额外 selectModel/defaults 保存

#### Scenario: 异步解析期间切 MANUAL 不覆盖主请求
- **GIVEN** AUTO 主请求正在异步解析模型能力
- **WHEN** 会话切为 MANUAL 后解析完成
- **THEN** 输出保持官方合成请求，不写官方选择或全局 defaults

### Requirement: 选择器恢复官方单值 effort
受管宿主 SHALL 删除仅服务 actual/next 双值展示的 ModelDirectory.lastUsed 接缝、caption helper 与 locale；trigger、root effort 行和 menu SHALL 依官方 current 展示单一 effort，不出现“最近实际/下次”或 Last used/Next 双值文案。展示分组、统一搜索、真实 provider/model 的 click/keyboard/effort 提交、core modelSelection 投影及 metadata 校验/detach SHALL 保留；不得维护两套 value helper 或手改 generated dirs。

#### Scenario: 单值 effort 与选择一致
- **GIVEN** 官方 current 为同模型 high（或手选 medium/low）
- **WHEN** 渲染 trigger、root effort 行和 effort menu
- **THEN** 只展示官方 current 的一个 effort，menu 勾选相同值；主动选择仍按原 provider/model 与选定 effort 提交，无展示写入

#### Scenario: 分组搜索与精确选择保留
- **GIVEN** Claude/GPT 展示组与普通 provider 共存
- **WHEN** 搜索组标签、型号或完整 id，并使用 click 或 keyboard 接受
- **THEN** 保持既有可见顺序、唯一高亮与真实 provider/model/effort 提交，展示组 key 不充当 provider

### Requirement: 模式与改写规则
系统 SHALL 为每个主会话提供 `AUTO` 与 `MANUAL` 两种模式，按会话持久化。新建普通会话的初始模式 SHALL 取设置项「新会话默认模式」（`MANUAL` | `AUTO`，缺省 `MANUAL`）：仅当普通会话以全新方式创建（不是恢复、清空、压缩或子会话）且其默认主模型受支持时，系统 SHALL 按创建时刻的设置值写入该会话的模式；此后修改设置 MUST NOT 改变已有会话的模式。没有状态记录的已有会话 SHALL 视为 `MANUAL`。默认模式为 `AUTO` 时新会话的行为与用户手动切到 `AUTO` 相同（含 Jev 失败即停用）。
- **AUTO**：系统 SHALL 只改写主会话请求的 reasoning effort，MUST NOT 改写 provider 与 model；同一回合内 depth 一经判断即不再变化，每次请求按该次实际模型重新计算 effort。effort 与官方选择的同步按「AUTO 主 effort 同步官方选择」执行。
- **MANUAL**：系统 MUST NOT 改写任何字段，也 MUST NOT 把 effort 写回任何先前的值。切到 MANUAL 只是停止自动调整；此后请求使用官方当前选择，由用户在官方模型选择器中自行调整。
切 MANUAL SHALL 废止当前回合的 AUTO 决定：同回合后续请求不再改写。再次切 AUTO 只能在下一用户回合首个请求重新决定，此前 MUST NOT 恢复旧 AUTO 决定。重复设置相同模式 SHALL 为无副作用操作。插件不保存锚点、不维护复原义务；未加载时不请求 Jev、不改写。

#### Scenario: MANUAL 请求原样通过
- **GIVEN** 会话为 `MANUAL`，官方合成配置为 `claude/claude-opus-5-5`、effort `high`
- **WHEN** 主会话发出一次模型请求
- **THEN** 实际请求配置与官方合成配置深度相等

#### Scenario: AUTO 只改 effort
- **GIVEN** 会话为 `AUTO`，官方合成 `claude/claude-opus-5-5`、`medium`，本回合 Jev depth 为 `higher`
- **WHEN** 本回合首个请求发出
- **THEN** 实际请求 provider 为 `claude`、model 为 `claude-opus-5-5`、effort 为 `high`

#### Scenario: 切回 MANUAL 不复原
- **GIVEN** 会话为 `AUTO`，本回合已输出 `high`；官方此后合成配置为 `high`
- **WHEN** 切 MANUAL 后同回合与下一回合发出请求
- **THEN** 两个请求均与官方合成配置深度相等（effort 仍为 `high`）

#### Scenario: AUTO 结果同步到官方选择
- **GIVEN** 会话为 `AUTO`，官方合成 `claude/claude-opus-5-5`、`medium`，本回合 Jev depth 为 `higher`
- **WHEN** 本回合首个与第二个请求发出
- **THEN** `selectModel` 恰被调用一次，参数为 `{sessionId, provider: claude, model: claude-opus-5-5, reasoningEffort: high}`；官方合成已为 `high` 时不再调用

#### Scenario: AUTO 判档覆盖待生效手选
- **GIVEN** 会话为 `AUTO`，用户在 AUTO 期间手选 `medium`（官方待生效手选），主模型 `claude-opus-5-5`
- **WHEN** 下一回合 Jev depth 为 `higher`，随后切 MANUAL 并发出请求
- **THEN** 官方选择被更新为 `high`；切 MANUAL 后的请求与官方合成配置深度相等，effort 为 `high`

#### Scenario: 快速切回 AUTO 不恢复旧决定
- **GIVEN** 当前回合 AUTO 已决定 `high`；测试注入官方合成 `medium`
- **WHEN** 切 MANUAL 后再切 AUTO，并继续当前回合请求
- **THEN** 当前回合请求与官方合成配置深度相等；下一用户回合重新请求 Jev 并按其结果改写

#### Scenario: 重复同模式设置无副作用
- **GIVEN** 会话为 `MANUAL`
- **WHEN** 再次设置 MANUAL
- **THEN** 状态存储不发生写入

#### Scenario: 旧状态文件可读
- **GIVEN** 状态文件为旧格式，含 `restore`、`anchor` 与 `previous: complex` 字段
- **WHEN** 插件读取该会话状态并完成一个 AUTO 用户回合
- **THEN** 读取成功，模式与 `disabled` 保留；`restore` 与 `anchor` 在下次写入时去掉；`previous` 不被更新；`mode` 或 `disabled` 形状非法时仍拒绝，不回退为默认值

#### Scenario: 新会话按默认模式创建
- **GIVEN** 设置「新会话默认模式」为 `AUTO`
- **WHEN** 新建默认主模型为 `claude-opus-5-5` 的普通会话 S1、默认主模型为 `deepseek-v4.1-flash` 的普通会话 S2，恢复一个此前从未设置过模式的已有会话 S0，S1 派生子会话 C1
- **THEN** S1 的模式为 `AUTO`，其首个用户回合请求 Jev；S2 与 S0 为 `MANUAL`；C1 不产生会话状态

#### Scenario: 修改默认模式不影响已有会话
- **GIVEN** 默认模式为 `AUTO` 时创建了会话 S1（`AUTO`），用户随后把 S1 切为 `MANUAL`
- **WHEN** 把默认模式改为 `MANUAL`，再改回 `AUTO`，然后 Host 重启
- **THEN** S1 始终为 `MANUAL`；改回后新建的会话 S2 为 `AUTO`

### Requirement: Jev 失败即停用并提示
主会话 Jev 调用失败时，系统 SHALL 把该会话转为 `MANUAL`（与用户切 MANUAL 相同：废止本回合 AUTO 决定，本回合不改写、不复原 effort），MUST NOT 改写 provider/model，同时持久记录 `disabled = {category, at}`；MUST NOT 以任何本地规则或其它模型得出判断。失败类别为闭集：`missing-credential`（凭据缺失，不发请求）、`insufficient-credits`（402）、`unauthorized`（401/403）、`rate-limited`（429）、`region-blocked`（451）、`rejected`（其它 4xx 或被拒绝的重定向）、`unavailable`（5xx 或网络错误）、`timeout`（期限到达）、`invalid-response`（非 JSON、缺所需维度的 choice，或 choice 不属于规则文件该维度的 criteria）。HTTP 200 但 body 含数字 `error.code` 时 SHALL 按该 code 套用上述映射。调用方取消（用户取消回合）MUST NOT 视为失败：不停用、不写 `disabled`、本回合不改写。停用 SHALL 保持到用户把模式设为 `AUTO`，此时清除 `disabled`；系统 MUST NOT 轮询、主动查询余额或自动恢复 AUTO。子任务判断失败、取消或返回 `insufficient_context` 时 SHALL 按「子任务路由退化链」第 4 步不改写并告警，MUST NOT 停用根会话或写入 `disabled`。`disabled`、错误结果与日志 MUST NOT 包含凭据或响应体。

#### Scenario: 各状态码映射为闭集类别
- **GIVEN** 假 Jev 服务分别返回 402、401、403、429、451、404、500、网络断开、超过期限无响应、200 但 body 非 JSON、200 但 depth choice 为 `huge`、200 但 body 为 `{error: {code: 402}}`，以及 launch environment 中缺少凭据
- **WHEN** 每种情况下 AUTO 会话发起一个用户回合
- **THEN** `disabled.category` 依次为 `insufficient-credits`、`unauthorized`、`unauthorized`、`rate-limited`、`region-blocked`、`rejected`、`unavailable`、`unavailable`、`timeout`、`invalid-response`、`invalid-response`、`insufficient-credits`、`missing-credential`；缺凭据时假服务未收到请求

#### Scenario: 停用后不再调用 Jev 且不改写
- **GIVEN** 上一回合 AUTO 已输出 `high`，官方此后合成 `high`，本回合 Jev 返回 402
- **WHEN** 本回合首个请求及下一用户回合请求发出
- **THEN** 会话为 `MANUAL` 且 `disabled.category` 为 `insufficient-credits`；两个请求均与官方合成配置深度相等（effort `high`）；下一用户回合 Jev 请求次数为 0，`disabled` 仍保留

#### Scenario: 用户重新点 AUTO 清除停用
- **GIVEN** 会话因 `timeout` 停用，主模型 `claude-opus-5-5`
- **WHEN** 用户把模式设为 `AUTO`，下一用户回合 Jev 返回 depth `lower`
- **THEN** `disabled` 被清除；该回合 Jev 请求 1 次，effort 为 `low`

#### Scenario: 用户取消不是失败
- **GIVEN** 会话为 `AUTO`，Jev 请求进行中
- **WHEN** 用户取消该回合
- **THEN** Jev 请求被中止；会话仍为 `AUTO`，无 `disabled`，下一用户回合重新请求 Jev

#### Scenario: 凭据与响应体不泄漏
- **GIVEN** 凭据为 `sk-or-test-SECRET`，假服务返回 401 且响应体含 `SECRET-BODY`
- **WHEN** 读取状态文件、状态端点响应与面板渲染文本
- **THEN** 均不含 `sk-or-test-SECRET` 或 `SECRET-BODY`

#### Scenario: 子任务判断失败不停用根会话
- **GIVEN** 根会话为 `AUTO`；子任务 Jev 依次返回 429 与 `insufficient_context`
- **WHEN** 两个受管子会话各发出首个请求
- **THEN** 两个请求均与官方合成配置深度相等；记录 `reason` 分别为 `jev-rate-limited`、`needs-context`；根会话仍为 `AUTO` 且无 `disabled`

### Requirement: Host 端点边界
本插件只提供以下经 `connection.fetch.register` 注册的端点：会话级的 `state`、`setMode`、`label`、`observe`、`childRouting`，以及不带会话的 `settings`、`saveSettings`、`setKey`、`testDecision`（后四者见「设置页」与 auto-decision-services-feedback，不读写任何会话状态）。会话级端点 SHALL 以请求体 `sessionId` 经官方会话控制器解析目标会话（与官方会话端点同一授权模型）；`sessionId` 缺失、非字符串或无法解析时 SHALL 返回 4xx 且不修改任何状态；指向 `origin = "subagent"` 会话时，`setMode`、`label`、`observe` SHALL 返回 4xx 且不修改任何状态，`state` SHALL 返回 200 与 `{applicable: false}`（见「子会话不显示 AUTO 芯片」），`childRouting` 只读，有记录时返回该子会话的决策记录，并在响应顶层附加 `scopeNote: "按官方工具 ALS 上下文、同父与 startup 绑定；不能区分同窗口插件旁支，旁支可能一并受管。"`（仅响应说明，不写回记录）；无记录时仍返回 `{status: "unsupported"}`。`setMode` SHALL 只修改该会话的模式与 `disabled`（设为 `AUTO` 时清除），`mode` 不属于 `AUTO | MANUAL` 时返回 4xx。`label` 参数为 `{sessionId, messageId, feedback?}`，语义见 auto-allocation-feedback；`observe` 参数为 `{sessionId, messageId}`。普通会话的 `state` SHALL 返回模式、`disabled`（如有）、`autoSupport`、最近决策与 `childNotice`（如有）。

#### Scenario: 无效会话被拒绝且无副作用
- **GIVEN** 会话 S1 为 `AUTO`；`session-unknown` 无法解析；`session-child` 为子会话
- **WHEN** 分别以无 `sessionId`、`sessionId: 42`、`session-unknown`、`session-child` 调用设置模式（`MANUAL`）
- **THEN** 四次均返回 4xx；S1 仍为 `AUTO`；所有会话状态不变

#### Scenario: 只修改目标会话
- **GIVEN** 会话 S1 与 S2 均为 `AUTO`
- **WHEN** 以 `sessionId: S1, mode: "MANUAL"` 调用设置模式
- **THEN** S1 为 `MANUAL`；S2 的模式与 `disabled` 不变

#### Scenario: label 响应以绑定是否存在区分
- **GIVEN** S1 的回复 m1 绑定了已应用主决策（depth `higher`、model `claude-opus-5-5`、effort `high`），回复 m2 无绑定
- **WHEN** 以 m1、m2 调用 `label`，并在 client 渲染两条回复的操作项且 m1 连续可见 3 秒
- **THEN** m1 响应含 `depth: higher`、`model`、`effort`，不含 `policy`；m2 响应为 `{}`；client 为 m1 渲染分配反馈按钮（Tooltip 以 `AUTO 分配：higher → high · claude-opus-5-5` 开头）并发出一次 `observe`，m2 渲染为空且不发出 `observe`

#### Scenario: 子会话状态返回不适用
- **GIVEN** `session-child` 为子会话，`session-unknown` 无法解析
- **WHEN** 分别以二者调用 `state`
- **THEN** 前者返回 200 且 body 恰为 `{applicable: false}`，状态文件不变；后者返回 4xx

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
- 派发时直接使用官方 fresh 创建工具，只传用户或 lead 指定的 provider、model、reasoning_effort；AUTO 会在创建时自行选配。派发前不需要先调用 `route_subagent`，它只是可选预览，其推荐结果 MUST NOT 作为显式参数传给官方工具；预览返回错误时暂停委派并询问用户。详细规则见 `subagent-model-routing` skill。
该节 MUST NOT 引用具体模型名或 effort 值（唯一来源为插件代码）。本 change MUST NOT 新增物化机制，沿用 `agentInstructions` 将其物化为 `$DSH_HOME/AGENTS.md`（已有 `tests/sync-agent-instructions.test.mjs` 覆盖物化、幂等与撤销）。

#### Scenario: 环境级指令含派发规则且不含模型名
- **GIVEN** 仓库中的 `instructions/dsh-home.md`
- **WHEN** 测试读取其文本
- **THEN** 含标题“子会话派发”，含“独立评审”“并行”“route_subagent”“不派发”与“本身是子会话时不再向下派发”；含“官方 fresh 创建工具”“只传用户或 lead 指定”“不需要先调用 `route_subagent`”与“暂停委派并询问用户”；不含“必须先调用 `route_subagent`”与“全部显式传给”；不含任何 `claude-`、`gpt-` 开头的模型名，也不匹配 `\bxhigh\b`、`\bmax\b`

#### Scenario: 指令不要求把预览结果当显式参数
- **GIVEN** 仓库中的 `instructions/dsh-home.md` 与包内 `skills/subagent-model-routing/SKILL.md`
- **WHEN** 测试读取两者文本
- **THEN** 两者都不含“返回档位”或“全部显式传给子会话工具”一类要求；skill 中关于预览的条目与环境级指令都表述为可选

### Requirement: 插件安装自包含配套 skill
安装本插件 SHALL 同时提供 `route_subagent` 工具与 `subagent-model-routing`、`auto-model-routing-report` 两个 skill，不依赖 ohmydsh 根目录的 skills 或环境级指令。`subagent-model-routing` SHALL 只描述当前 AUTO 的子任务用法，并以不含版本的表述保留仍然成立的规则，至少包括：(1) 使用官方 fresh 创建工具并给出清楚的目标与范围；(2) 用户或 lead 显式指定的模型与 effort 照实传递，只指定一个维度时只判断另一个；(3) `route_subagent` 只是预览，`recommended` 不等于已应用，不把推荐当成用户显式约束；(4) 主会话为 MANUAL 时工具返回 `routed: false`，按官方默认委派，只传用户或 lead 指定的值；(5) 在 `description` 末尾以 `[model·effort]` 标注；(6) fork 与父会话保持一致、AUTO 不路由，需要按任务选配时改用 fresh；(7) 通过 `childRouting` 查看应用证据；(8) 派发不需要先预览，路由只在创建时判断一次；若调用了预览：返回 `status: "fallback"` 时按官方默认委派并向用户简要说明原因，返回 `status: "needs-context"` 时补充目标与范围后再派发，返回错误（含判断被取消）时暂停委派并询问用户，不猜测、不换模型、不改由主会话完成、不自治重试；(9) 工具不存在时告知“子会话 Jev 选模未启用”并按官方默认委派；(10) 复用已有子会话前比较其标注，需要更高投入、不同家族或无法确认时新建。skill MUST NOT 含四档规则或“原策略/旧策略/回滚”段落，MUST NOT 声称仅注册 skill 就能强制 Agent 每次委派前执行工具，MUST NOT 要求把预览结果作为显式参数传给官方工具，且 SHALL 与「子会话派发时机写入环境级指令」一致。ohmydsh SHALL 仅保留插件的 local customization；禁用插件并重新装配后，其工具及包内 skill SHALL 均不可用，用户设置与历史记录 SHALL 保留。

#### Scenario: 干净安装获得唯一 skill
- **WHEN** 在不含 ohmydsh 指令或全局 skill 的干净 DSH profile 安装并加载发布包
- **THEN** 真实 Host 的 skill catalog 中 `subagent-model-routing` 恰好出现一次；工具集包含 `route_subagent`

#### Scenario: skill 只含当前用法
- **WHEN** 测试读取包内 `skills/subagent-model-routing/SKILL.md`
- **THEN** 文本含 `route_subagent`、`fresh`、`recommended`、`routed: false`、`fallback`、`needs-context`、“不需要先预览”、`[model·effort]`、`fork`、`childRouting`、“暂停委派并询问用户”、“子会话 Jev 选模未启用”与“新建”；不含“fork 不支持”、“显式传给”、`simple`、`escalated`、`legacy`、`原策略`、`旧策略`、`回滚`，也不含任何 `claude-`、`gpt-` 开头的模型名

#### Scenario: 旧部署迁移无重复来源
- **GIVEN** 上一版本通过 manifest 的独立 skill 条目产生受管副本
- **WHEN** 升级并连续执行两次隔离 sync，再重新装配 Host
- **THEN** 旧受管副本不再存在，包内 skill 恰好注册一次，第二次 sync 为 no-op；现有配置、模式与历史记录未被修改

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

### Requirement: AUTO 主模型支持范围与不可用锁定
AUTO SHALL 只处理注册表中有策略匹配的主模型：主模型 id 去掉最后一个 `/` 及其之前部分后，以某策略的任一 `modelPrefixes` 开头（大小写不敏感）即视为支持；当前内置注册表即 `claude-` 与 `gpt-`。其余模型 SHALL 视为不支持。当前主模型不在支持范围时，系统 MUST NOT 发起 Jev 判断、MUST NOT 改写该请求，并 SHALL 把会话模式持久化为 `MANUAL`；状态接口 SHALL 返回当前选择与 `autoSupport = { supported: false, provider, model }`。模式按主模型切换实时推导：切回受支持模型后 `autoSupport.supported` SHALL 为 `true` 且芯片恢复可点击，模式保持 `MANUAL`，MUST NOT 自动恢复 `AUTO`。主模型在支持范围内但自动 effort 映射不可得（目录没有可用 `low|medium|high|xhigh`、推荐起点不可验证、或自动 effort 上限排除全部候选）时，主请求 SHALL 保持官方合成配置、`reason` 为 `no-effort-support`，MUST NOT 阻断请求、停用 AUTO 或记为 Jev 失败。子任务无法给出可用 effort 时 SHALL 按「子任务路由退化链」处理，MUST NOT 阻断子请求。锁定态面板 SHALL 以注册表各家族 label 说明支持范围。

#### Scenario: 切换到不支持的主模型自动锁定
- **GIVEN** 会话为 `AUTO`，主模型为 `opencode-go/deepseek-v4.1-flash`
- **WHEN** 用户切换模型后读取状态或发出下一回合请求
- **THEN** 模式持久化为 `MANUAL`；状态含 `autoSupport = { supported: false, provider: 'opencode-go', model: 'deepseek-v4.1-flash' }`；该回合 Jev 请求次数为 0，模型请求的 provider/model/effort 与官方合成配置深度相等

#### Scenario: 不支持模型的请求不再导致整轮失败
- **GIVEN** 会话此前在 AUTO 下正常完成过回合，用户随后把主模型切换为不支持范围
- **WHEN** 用户发出下一回合请求
- **THEN** 回合正常结束（`turn/end` 不为 error）；请求照常发出且未被改写；会话保持 `MANUAL`，不产生 `disabled` 记录

#### Scenario: 芯片锁定态与悬停提示
- **GIVEN** 状态接口返回 `mode: 'MANUAL'` 与 `autoSupport = { supported: false, provider: 'opencode-go', model: 'deepseek-v4.1-flash' }`
- **WHEN** 渲染芯片并悬停或聚焦整个按钮
- **THEN** 芯片可见文本为 `MANUAL`，其后是描边 info 图标；按钮带 `aria-disabled` 标记且点击不发出 `setMode` 请求；面板说明 AUTO 目前仅支持 Claude / GPT 系列模型，并给出 `https://github.com/prgrmrwy/dsh-auto-model-routing` 链接；锁定时不使用 Jev 停用的红色警示样式

#### Scenario: 切回受支持模型后恢复可切换
- **GIVEN** 会话因主模型不支持而处于 `MANUAL` 锁定态
- **WHEN** 主模型切回 `claude` / `gpt` 系列
- **THEN** 状态返回 `autoSupport.supported = true`；芯片恢复普通 `MANUAL` 显示与切换图标且可点击；用户点击后才进入 `AUTO`

#### Scenario: 支持范围判定只依据注册表
- **GIVEN** 内置注册表
- **WHEN** 判定 `claude-opus-5-5`、`gpt-6-astra`、`GPT-5.6-Sol`、`CLAUDE-fable-5-1`、`claude/claude-opus-5-5`、`codex/gpt-6.1-sol`，以及 `deepseek-v4.1-flash`、`glm-5.3`、`kimi-k3`、`opencode-go/deepseek-v4.1-flash`、空串、undefined
- **THEN** 前六个为支持，其余为不支持

#### Scenario: 支持范围内映射不可得不阻断请求
- **GIVEN** 会话为 `AUTO`，主模型属于 Claude / GPT 系列，但官方目录只提供 `max`（或自动 effort 上限排除了全部可用候选）
- **WHEN** 本回合首个请求发出
- **THEN** 请求配置与官方合成配置深度相等，`reason` 为 `no-effort-support`；请求成功发出，AUTO 未被停用，未记为 Jev 失败

### Requirement: AUTO 决策与执行
主会话 SHALL 仅判断 depth=lower/baseline/higher，并在模型支持序列中以所属家族策略的推荐起点最多移动一档，不修改 provider/model；选定 effort 与官方合成值不同时，按「AUTO 主 effort 同步官方选择」经官方 selectModel 同步。子任务 SHALL 只在「AUTO 受管子会话范围」内路由：独立判断 capability=bounded/analytical/frontier 或 insufficient_context，按「子任务路由退化链」确定 route，保留显式模型/effort，完全显式时不调用 Jev。受管子会话 SHALL 按精确 child ID 绑定、持久化，实际请求匹配后标 applied；恢复不重判。fork 不属于受管范围，SHALL 与父会话保持一致、原样放行，MUST NOT 报错或悄悄改为 fresh。Agent 保留编排和验收权，不实现自主重试升级。

#### Scenario: Magpie 自动子路由
- **WHEN** Magpie GPT 主会话为 AUTO 且创建 bounded 子任务
- **THEN** 从允许列表和实时目录验证同 transport 的 codex/gpt-6-luna 及支持 effort，持久绑定精确 child；不得转到本地入口

#### Scenario: 未登记 provider 的 GPT 主会话可以派子任务
- **GIVEN** 根会话为 `AUTO`，provider `traex`、模型 `GPT-5.6-Sol`
- **WHEN** 经官方 `subagent` 工具创建子会话（不传 provider/model/effort）
- **THEN** 工具执行不抛错；子会话受管，记录 `explicit.provider` 为 `traex`、`family` 为 `codex`；首个请求 provider 为 `traex`

### Requirement: 无策略版本
系统 MUST NOT 存在策略、规则、映射或记录格式的版本概念：设置 MUST NOT 有 `policy` 字段；以下新写入 MUST NOT 含 `policy`、`policyVersion`、`mappingVersion`、`rubricVersion`、`pluginVersion`、`schema` 或 `version` 键：Host 状态响应、`label` 端点响应、`route_subagent` 输出、子会话决策记录、反馈账本的绑定行、反馈事件行与隐式事实行、用量报告输出、`eval/` 实测脚本的报告。子会话恢复 MUST NOT 以版本比对作为门禁。`label` 端点 SHALL 把绑定投影为不含上述键的公开形状后返回，历史快照在账本中保持原样，供用量报告的历史分组使用。发布包 MUST NOT 含已删除或改名源文件的旧构建产物。Jev 规则文件 SHALL 为包内唯一的 `src/rubric.json`，内容与本变更前的 `policy-v2-rubric.json` 逐字节相同。工具描述、参数说明、错误信息、client 渲染文本与包内 skill MUST NOT 出现 `policy-v2`、`legacy`、`新策略`、`旧策略`、`原策略` 或“回滚”。插件行为随包版本迭代，包的发布版本号只属于发布元数据，不进入运行时记录。唯一保留的历史名称是子会话决策记录目录 `state/auto-model-routing/policy-v2/`：该路径不迁移，只在一处常量中定义。

#### Scenario: 新写入不含版本字段
- **GIVEN** AUTO 主会话有一个已应用的主决策并绑定回复，且创建并应用了一个 bounded 子任务
- **WHEN** 依次读取：状态响应；该回复的 `label` 响应；一次 `route_subagent` 输出；子任务的决策记录文件；修改、撤销该回复反馈，触发一次曝光与一次切 MANUAL 后反馈账本的全部新增行；随后运行用量报告
- **THEN** 以上 JSON（含嵌套对象）中都不存在键 `policy`、`policyVersion`、`mappingVersion`、`rubricVersion`、`pluginVersion`、`schema`、`version`

#### Scenario: 旧绑定的 label 响应不暴露历史版本键
- **GIVEN** 反馈账本中回复 m0 的旧绑定快照含 `policyVersion`、`mappingVersion`，已有反馈“合适”与一条带 `version: 1` 的曝光事实
- **WHEN** 升级后以 m0 调用 `label` 查询，再改为“投入偏高”，再撤销
- **THEN** 三次响应（含嵌套 `snapshot`）都不含上述版本键，也不含 `strategy`；新增的两行反馈事件不含 `version`；账本中原绑定行字节不变；查询结果的反馈与曝光语义与升级前一致；用量报告仍把该绑定归入其历史组

#### Scenario: 源码与文案不含版本
- **GIVEN** 包内 `src/`、`eval/`、`skills/` 与 `route_subagent` 工具定义
- **WHEN** 测试扫描文本
- **THEN** 从已含 0.4.2 构建产物的 `lib/` 出发执行包构建与 `npm pack --dry-run` 后，文件列表不含 `lib/router.js`、`lib/judgements.js`、`lib/policy-v2.js`、`lib/policy-v2-rubric.json`，且仍含 `lib/index.js`、`lib/client.js`、`lib/usage-report.js` 与 `skills/` 下两个 skill；`src/` 中字符串字面量 `policy-v2` 恰出现一次（决策记录目录常量）；不存在字符串字面量 `legacy`，不存在标识符 `rubricVersion`、`pluginVersion`；`policyVersion` 与 `mappingVersion` 只出现在 `feedback.ts`、`policy-store.ts`、`usage-report.ts` 的旧记录读取处；工具描述、参数说明与两个 skill 不含 `policy-v2`、`legacy`、`原策略`、`旧策略`、`回滚`；`src/rubric.json` 与变更前规则文件的 sha256 相同

#### Scenario: 旧子会话记录恢复不比较版本
- **GIVEN** 决策记录目录中有一个已应用子任务的旧记录，含 `version: 1`、`policyVersion: "policy-v2-0000aaaa"`、`mappingVersion: "capability-slots-1"` 与 route `claude` / `claude-haiku-5-5` / `medium`
- **WHEN** 插件重启后该子会话发出下一次请求
- **THEN** 请求使用记录中的 route，不报错、不调用 Jev；该请求之后记录文件被重写时不再含 `version`、`policyVersion`、`mappingVersion`

### Requirement: 旧配置与旧记录只读兼容
配置文件中的 `policy`、`mainEfforts`、`childRoutes` SHALL 在读取时被忽略：不影响任何路由，不使设置状态变为 `invalid`。设置读取响应 SHALL 以 `deprecated` 数组（按字母序）列出文件中存在的这些键；设置页在该数组非空时 SHALL 显示说明：这些旧映射已不再生效，下次保存设置时移除。保存设置 SHALL 不再写出这些键；提交含这些键的补丁 SHALL 按未知字段拒绝，配置文件字节不变。会话状态文件中的 `previous` 字段 SHALL 继续可读，系统不再写入新值。`judgements.jsonl` SHALL 不再被写入，保留供用量报告只读。`label` 端点收到 `label` 参数时 SHALL 返回 4xx 且不写入任何文件。子会话决策记录读取时 SHALL 只额外接受三个历史键 `version`（值为 1）、`policyVersion`（字符串）、`mappingVersion`（字符串），读取后丢弃；其它未知键、形状错误、身份不符一律 fail closed；写入 SHALL 严格校验，不含历史键。

#### Scenario: 旧映射配置不影响路由并在保存时移除
- **GIVEN** 配置文件为 `{policy: "legacy", decisionToast: true, mainEfforts: {codex: {simple: "medium"}}, childRoutes: {claude: {simple: {model: "claude-haiku-5-5", reasoningEffort: "high"}}}}`；AUTO 主会话主模型 `claude-opus-5-5`，Jev 判 depth `baseline`
- **WHEN** 发出主请求，读取设置，然后只提交 `{decisionToast: false}`
- **THEN** 主请求 effort 为 `medium`；设置读取 `configStatus` 为 `ok`，`deprecated` 为 `["childRoutes", "mainEfforts", "policy"]`，设置页显示“不再生效”说明；保存后文件恰为 `{decisionToast: false}`，再次读取 `deprecated` 为空

#### Scenario: 提交旧映射字段被拒
- **GIVEN** 配置文件只含 `{defaultMode: "AUTO"}`
- **WHEN** 分别提交 `{policy: "legacy"}`、`{mainEfforts: {claude: {simple: "low"}}}`、`{childRoutes: {}}`
- **THEN** 三次都返回字段错误，配置文件字节不变

#### Scenario: 旧判档账本不再增长且标注参数被拒
- **GIVEN** `judgements.jsonl` 已有 3 行；AUTO 会话完成两个用户回合，其回复 m1 已绑定分配决策
- **WHEN** 读取该文件，并以 `{sessionId, messageId: m1, label: "simple"}` 调用 `label` 端点
- **THEN** 文件仍为 3 行；端点返回 4xx，反馈账本与 `judgements.jsonl` 均无新增行

#### Scenario: 决策记录只容忍已知的历史键
- **GIVEN** 五个决策记录文件：合法旧记录（含 `version: 1`、`policyVersion`、`mappingVersion`）；在合法记录上多一个 `task` 键；多一个拼错的 `rout` 键；`version: 2`；`childId` 与文件对应 id 不同
- **WHEN** 对应子会话发出请求
- **THEN** 第一个按记录 route 恢复；其余四个都拒绝请求，错误含“无法恢复”，模型请求与 Jev 请求数均为 0；写入含 `task` 键的记录同样抛错

#### Scenario: 绑定标记存在但记录缺失或损坏
- **GIVEN** 子会话已有绑定标记，记录文件被删除，或绑定标记内容与 id 不符
- **WHEN** 该子会话发出请求
- **THEN** 请求被拒绝，模型请求与 Jev 请求数均为 0，不重新判断、不继承父会话配置

### Requirement: 子任务路由预览工具
系统 SHALL 注册 Host 工具 `route_subagent`，参数 `{task: string, provider: string, model?: string, reasoning_effort?: string, path?: "ordinary" | "fork" | "teammate"}`；`provider` 为任意非空字符串，不设枚举。描述 SHALL 说明：该工具是可选预览，派发不需要先调用它；它只给出推荐，不代表已应用，推荐结果不应作为显式参数传给官方工具；正式自动路由在官方 fresh 创建工具创建的精确子会话首次请求前独立完成；会把脱敏任务文本发送给所选决策服务。

工具 SHALL 先按子会话链找到所属主会话（链上任一会话不在 live 注册表中时视为 MANUAL）。所属主会话不是 `AUTO` 时 SHALL 返回非错误结果 `{routed: false, reason: "manual"}`，MUST NOT 请求 Jev。`path` 为 `fork` 时 SHALL 返回非错误结果 `{routed: false, status: "unsupported", reason: "fork"}`，MUST NOT 请求 Jev。`model` 与 `reasoning_effort` 都给出时 MUST NOT 请求 Jev；只给出一个时只判断另一维度；都未给出时判断 capability 与 depth。capability 为 `insufficient_context` 时 SHALL 返回 `{routed: false, status: "needs-context"}`。路由 SHALL 以调用会话此刻的 provider/模型/effort 为父快照，按「子任务路由退化链」与「模型家族策略注册表」计算；退化链到达第 4 步或 Jev 失败时 SHALL 返回非错误结果 `{routed: false, status: "fallback", reason}`，MUST NOT 返回其它模型；Jev 被取消时 SHALL 返回错误，内容含“已取消”与“暂停委派并询问用户”。成功时 SHALL 返回 `{status: "recommended", capability?, depth, provider, model, reasoning_effort}`。工具内部异常 SHALL 返回错误，内容含“暂停委派并询问用户”。工具 MUST NOT 写入任何会话状态或决策记录。插件 SHALL 随包提供 skill `subagent-model-routing`。

#### Scenario: AUTO 下返回推荐且保留显式维度
- **GIVEN** 所属主会话为 `AUTO`，主模型 `claude` / `claude-opus-5-5`；目录与允许列表含 `claude-haiku-5-5`（支持 `low..xhigh`）；Jev 返回 capability `bounded`、depth `baseline`
- **WHEN** 依次以 `{provider: claude}`、`{provider: claude, model: claude-haiku-5-5, reasoning_effort: high}`、`{provider: claude, path: fork}` 调用
- **THEN** 第一次返回 `{status: recommended, model: claude-haiku-5-5, reasoning_effort: medium}`；第二次返回 `reasoning_effort: high`；第三次返回非错误的 `status: unsupported`；假 Jev 服务共收到 1 个请求

#### Scenario: MANUAL 与不可用路由
- **GIVEN** 会话 S1 为 `MANUAL`；会话 S2 为 `AUTO`，主模型 `codex` / `gpt-6.1-sol`、effort `max`，官方允许列表为空，目录中该模型只支持 `max`
- **WHEN** 在 S1 与 S2 中各以 `{provider: codex}` 调用
- **THEN** S1 返回 `{routed: false, reason: manual}` 且 Jev 请求数为 0；S2 返回非错误的 `{routed: false, status: fallback}`，`reason` 为 `no-usable-route`，不返回任何模型；两个会话的模式与 `disabled` 不变

#### Scenario: 预览失败与取消的区分
- **GIVEN** 会话 S 为 `AUTO`，目录与允许列表正常
- **WHEN** 分别在假 Jev 返回 insufficient_context、返回 402、以及调用方中止信号触发时以 `{provider: claude}` 调用
- **THEN** 第一次返回非错误 `{routed: false, status: needs-context}`；第二次返回非错误 `{routed: false, status: fallback, reason: jev-insufficient-credits}`；第三次返回错误且内容含“已取消”；S 的模式与 `disabled` 不变，无决策记录写入

### Requirement: AUTO 的双 Magpie 精确 transport 兼容
AUTO SHALL 在目录、子任务路由、预览工具与持久化恢复中保持 `dsh-magpie-connector`、`dsh-magpie-connect` 及其它任意 provider 的精确 provider 与完整 model ID，不把两者互为 alias，也不转到本地 claude/codex；这些 provider 无需任何登记。模型不属于任何已注册家族且未显式给出模型时，SHALL 保持父会话模型、按退化链只调 effort；显式给出此类模型时，effort 须可由目录默认验证，否则按退化链处理。所属根会话为 MANUAL 时预览工具 SHALL 返回 `{routed: false, reason: "manual"}`，不判断、不外发、不写状态；此前已绑定实例继续按既定精确身份恢复。

#### Scenario: 新旧 Magpie 子实例保持精确身份并恢复
- **GIVEN** AUTO 主会话，transport 分别为新旧 Magpie，目录和允许列表包含同 transport 的目标模型
- **WHEN** 创建 bounded 子实例，再重载插件、切父 MANUAL 并恢复该已绑定实例
- **THEN** 初始持久绑定及后续实际请求仍为原 transport 和完整 model ID；恢复不重判、不迁移到另一个 Magpie 或本地入口

#### Scenario: 未注册家族的 Magpie 模型需显式模型与可验证 effort
- **GIVEN** 所属根会话为 AUTO（主模型 `codex/gpt-6.1-sol`、effort `medium`），transport 为任一 Magpie；目录与允许列表含 `opencode-go/kimi-k3`（支持 `low`、`high`，目录默认 `high`）
- **WHEN** 分别以 `{model: "opencode-go/kimi-k3"}`、目录默认缺失时的 `{model: "opencode-go/kimi-k3"}`、目录默认缺失时的 `{model: "opencode-go/kimi-k3", reasoning_effort: "low"}`、`{model: "../kimi-k3", reasoning_effort: "low"}` 调用 `route_subagent`；前两次只给出模型，Jev 返回 depth `baseline`
- **THEN** 第一次返回该模型与 `high`；第二次与第四次返回非错误的 `status: fallback`；第三次返回该模型与 `low`；四次调用共发出 2 次 Jev 请求；任何一次都不返回其它模型

### Requirement: 用户回合与 Jev 输入
系统 SHALL 只在 step 1 的 `agent/pre-step` 中、先执行 `await next()` 得到 `PreStepDecision` 后判定主会话用户回合并请求 Jev：结果为 `reject` 时 MUST NOT 请求 Jev、MUST NOT 记录本回合决定；结果为 `enter` 时只使用其 `messages`。**合格消息**为该次领取消息中 `source.kind` 严格等于 `"user"` 的消息；其它来源（含 `agent-instructions`、`plugin`、`plugin:<id>`、`runtime-context`、`time-context`、`skill-catalog`）与缺失 `source` 的消息 MUST NOT 贡献输入。合格消息数为 0 的回合不是用户回合，沿用上一用户回合的 depth 且不请求 Jev；首个用户回合之前无 depth 时不改写。分类输入为合格消息按领取顺序、消息内按块顺序的 `text` 块文本，以 `"\n"` 连接，经 `redact` 后取 `.slice(0, 8000)`；非文本块不贡献。决定 SHALL 按 (agent, turn) 保存，同回合后续请求（含同 turn/step 的错误重试）复用该决定。`origin = "subagent"` 会话 MUST NOT 走主会话判断；其路由只按「AUTO 决策与执行」处理，判断输入只取该子会话自身进入消息中的合格消息。

#### Scenario: 步骤被拒时不请求 Jev
- **GIVEN** 会话为 `AUTO`，下游 pre-step listener 对 step 1 返回 `{kind: reject}`
- **WHEN** 该步骤被提交
- **THEN** Jev 请求次数为 0，本回合无决定；之后同回合重新提交并 `enter` 时请求 Jev 1 次

#### Scenario: 首轮真实领取序列只取用户消息
- **GIVEN** step 1 领取消息依次为 `agent-instructions`（文本 A）、`plugin:dsh-memex`（文本 B）、`runtime-context`（文本 C）、`skill-catalog`（文本 D）、`user`（文本“修复登录 bug”）
- **WHEN** 构造分类输入
- **THEN** 分类输入恰为“修复登录 bug”

#### Scenario: 多条用户消息按序拼接并截断
- **GIVEN** step 1 领取两条 `user` 消息，第一条文本“先看日志”，第二条含文本“再改配置”与一个图片块；另有一条无 `source` 的消息（文本 X）
- **WHEN** 构造分类输入
- **THEN** 分类输入恰为“先看日志\n再改配置”；若拼接结果长度超过 8000，则等于其 `.slice(0, 8000)`

#### Scenario: 同回合与重试复用决定
- **GIVEN** 用户回合 T 首个请求已按 depth `higher` 输出 effort `high`
- **WHEN** 回合 T 内第 2 至第 5 个请求到达，其中一次为同 (turn, step) 的错误重试
- **THEN** 这些请求的 effort 均为 `high`，回合 T 内 Jev 请求次数为 1

#### Scenario: 非用户回合沿用上一 depth
- **GIVEN** 上一用户回合 depth 为 `higher`，会话为 `AUTO`，主模型 `claude-opus-5-5`
- **WHEN** 一个由子会话完成通知开启的回合发出首个请求
- **THEN** 该请求 effort 为 `high`，Jev 请求次数不增加

#### Scenario: 子会话不走主会话判断
- **GIVEN** 父会话为 `AUTO`，经官方 fresh 子会话工具创建的子会话首条进入消息含注入的非 user 指令与 user 文本“整理日志”
- **WHEN** 子会话首次请求前进行判断
- **THEN** 发往 Jev 的子任务 `state` 只含“整理日志”，不含注入指令文本；父会话本回合的决定与 Jev 请求次数不变

### Requirement: Jev 判断请求与脱敏
系统 SHALL 在 AUTO 主会话用户回合 step 1 与已绑定子任务首次请求前，各以一次 Jev 决策请求得出判断：请求发往设置中所选决策服务的端点与模型（见 auto-decision-services-feedback），凭据按该服务的固定引用在每次调用时经官方 credentials 服务解析（credentials 服务不存在时经官方 launch environment 读取），未解析到值时为 `missing-credential`；单次期限取设置项「Jev 期限」（整数毫秒，范围 1000–8000，缺省 5000，每次请求时读取），`redirect: 'error'`，MUST NOT 重试。请求 body 为 `{model, state, questions}`；`questions` SHALL 取自包内唯一规则文件 `src/rubric.json`：主会话只含 `depth`，子任务按显式维度含 `capability`、`depth` 或两者。Jev 返回后 SHALL 重新读取会话模式，等待期间模式已变或回合决定已被废止时丢弃结果（不写决定、不写 `disabled`）。系统 MUST NOT 包含本地规则、关键词或通用对话模型的判断路径。请求 MUST NOT 携带会话状态、其它会话内容或凭据以外的鉴权信息；出站主机 SHALL 仅为所选决策服务的端点主机。

主会话请求的 `state` SHALL 依次包含：
1. 固定首行 `Previous user-turn tier: none`。
2. 上一轮上下文（存在时）：一行固定说明“上下文仅用于理解新消息，只判断新消息引出的工作”，随后 `Previous user message (truncated):` 加上一用户回合文本 `.slice(0, 500)`，以及 `Previous assistant reply (last part):` 加上一轮助手文本 `.slice(-1200)`（均为脱敏后截取）。不存在时省略对应段，两者都不存在时省略说明行。
3. `New user message:` 加本回合分类输入（无上一轮上下文时标签为 `User message:`）。
“上一轮”两段在 step 1 的 `agent/pre-step` 中、本回合消息进入之前，从 `agent.session.deriveMessages()` 取得：上一用户回合文本为最后一条 `source.kind === "user"` 的消息的 `text` 块按序以 `"\n"` 连接；助手段为最后一条含非空 `text` 块的 `assistant` 消息的文本块连接。子任务与预览工具的 `state` 为 `Previous user-turn tier: none`、`User message:` 加处理后的任务文本。

外发的每段文本 SHALL 先对**完整文本**经同一函数 `redact` 处理，再截断。`redact` 依次替换（`i` 表示不区分大小写）：
1. `/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g` → `<redacted>`
2. `/\bBearer\s+[A-Za-z0-9._~+\/=-]{8,}/gi` → `Bearer <redacted>`
3. `/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g` → `<redacted>`
4. `/(密码|授权码|appid|password|passwd|token|api[_-]?key|secret)(["']?\s*[:：=]\s*["']?)[^\s"',;]+/gi` → 保留关键字与分隔符，值替换为 `<redacted>`
5. `/\/\/[^\s/:@]+:[^\s/@]+@/g` → `//<redacted>@`
6. `/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g` → `<ip>`
这是形态匹配，尽力而为，不保证移除所有敏感信息。

#### Scenario: 请求内容受限
- **GIVEN** 决策服务为缺省 OpenRouter；上一轮用户文本为“修一下登录”，上一轮最后一条助手回复以“要我开始实施吗？”结尾，本回合分类输入为“继续”
- **WHEN** 主会话向 Jev 发起请求
- **THEN** 请求地址为 `https://openrouter.ai/api/alpha/decisions`，body 的 `model` 为 `typesafe/jev-1.13`，`questions` 只有键 `depth` 且与 `src/rubric.json` 的 `depth` 深度相等；`state` 首行为 `Previous user-turn tier: none`，并依次含“修一下登录”“要我开始实施吗？”与 `New user message:\n继续`；`Authorization` 为 Bearer 凭据；失败后无第二次请求

#### Scenario: 上一轮上下文截断、取末段并脱敏
- **GIVEN** 会话历史中上一条用户消息 900 字；之后有两条助手消息，第一条为“早先内容”，最后一条 3000 字且结尾含 `token=abc123def456` 与 `10.1.2.3:8080`
- **WHEN** 构造 `state`
- **THEN** 上一轮用户段为脱敏后文本的前 500 字；助手段为最后一条助手消息脱敏后的末 1200 字，不含“早先内容”；`state` 不含 `abc123def456` 与 `10.1.2.3`，含 `token=<redacted>` 与 `<ip>`

#### Scenario: 脱敏覆盖常见形态且不误伤正文
- **GIVEN** 文本依次含 `{"API_KEY": "abc123"}`、`Token：xyz789`、`Authorization: Bearer abcdefgh12345`、`ghp_0123456789abcdefghijABCD`、`https://u:p@host/x`、`token 过期了怎么办`，以及一个 `sk-` 开头、长 40 字符且起始位置在末 1200 字边界之前 10 字符处的密钥
- **WHEN** 对该文本执行 `redact` 后取末 1200 字
- **THEN** 结果不含 `abc123`、`xyz789`、`abcdefgh12345`、`ghp_0123`、`u:p@` 与该密钥的任何 8 字以上片段；`token 过期了怎么办` 原样保留

#### Scenario: 首个用户回合不带上一轮上下文
- **GIVEN** 会话为 `AUTO`，没有上一用户回合
- **WHEN** 首个用户回合发送“看下这个报错”
- **THEN** `state` 恰为 `Previous user-turn tier: none\nUser message:\n看下这个报错`

#### Scenario: 等待期间切换模式丢弃结果
- **GIVEN** 会话为 `AUTO`，Jev 请求进行中
- **WHEN** 用户在 Jev 返回前切为 `MANUAL`，随后 Jev 分别返回 depth `higher` 或 HTTP 402
- **THEN** 两种情况本回合均不按 Jev 改写 effort；会话为 `MANUAL`，无 `disabled`

#### Scenario: 不跟随重定向
- **GIVEN** 假 Jev 服务返回 302 指向其它主机
- **WHEN** AUTO 会话发起用户回合
- **THEN** 不请求重定向目标，`disabled.category` 为 `rejected`

#### Scenario: 源码不含本地分类与其它出站
- **GIVEN** 包内 `src/` 源码
- **WHEN** 测试扫描源码文本
- **THEN** 不存在 `classify` 导出或关键词词表；出站 URL 主机只属于内置决策服务（`openrouter.ai`、`api.typesafe.ai`、`api.concentrate.ai`）与文档链接主机；不出现 `node:http`、`node:https`、`node:child_process`

#### Scenario: 凭据从存储读取且换 key 立即生效
- **GIVEN** 启动环境中没有 `OPENROUTER_API_KEY`，credentials 存储中为 key A
- **WHEN** 发出一次 AUTO 判断，然后经设置页把 key 换成 B，再发出一次判断，再删除 key 后判断
- **THEN** 假 Jev 服务依次收到 `Bearer A`、`Bearer B`；第三次不发请求，会话以 `missing-credential` 停用；全程无需重启

#### Scenario: 期限按设置生效
- **GIVEN** 「Jev 期限」设为 1500，假 Jev 服务 2000ms 后才响应
- **WHEN** 发出一次 AUTO 判断
- **THEN** 约 1500ms 时以 `timeout` 停用；把期限改为 2500 后，下一次判断成功

### Requirement: AUTO 芯片与状态面板
系统 SHALL 在 composer 的 `conversation.input.right` 列表以负的 `order` 注册 `AUTO / MANUAL` 芯片（GPT 速度芯片为 `order: 0`）。芯片 SHALL 是单个按钮：可见文本为模式名，其后跟一个切换图标；无边框、无底色，hover 时显示官方交互底色；点击即切换模式。状态面板 SHALL 在鼠标悬停或键盘聚焦芯片时显示、离开芯片与面板时收起，内容为：本回合插件实际输出的 effort 与 `reason`；`AUTO · <depth>` 说明行；该会话最近一次决策（与决策提示同一格式），无决策时不显示该段。状态响应 MUST NOT 含决定历史。`reason` 取值为闭集 `jev | no-effort-support`。面板 MUST NOT 声称官方选择器总能反映 AUTO 结果。会话存在 `disabled` 时，芯片**可见文本** SHALL 为 `MANUAL · Jev 停用` 并以警示色显示，title SHALL 给出该失败类别的人类可读提示；面板 SHALL 显示类别、提示、发生时间及“点击 AUTO 重试”。芯片 MUST NOT 调用官方模型选择接口或速度芯片的设置接口。当状态接口返回 `autoSupport.supported = false` 时，芯片 SHALL 改用「AUTO 主模型支持范围与不可用锁定」定义的锁定态渲染，该锁定态不改变 `disabled`（Jev 停用）的“点击 AUTO 重试”语义。

#### Scenario: 芯片注册在速度芯片左侧
- **GIVEN** client bundle 已加载
- **WHEN** 读取 `conversation.input.right` 的注册项
- **THEN** 本芯片 `order` 小于 0

#### Scenario: 面板展示本回合状态且无历史
- **GIVEN** 会话为 `AUTO`，状态为 `{depth: higher, effort: high, reason: jev}`
- **WHEN** 读取状态接口并渲染面板
- **THEN** 状态响应不含 `history` 键；面板文本包含 `high`、`jev` 与 `AUTO · higher`

#### Scenario: 停用状态在芯片与面板可见
- **GIVEN** 会话 `disabled = {category: insufficient-credits}`，模式为 `MANUAL`
- **WHEN** 渲染芯片与面板
- **THEN** 芯片可见文本含“Jev 停用”且带警示标记，title 含“余额不足”；面板含 `insufficient-credits`、“余额不足”与“点击 AUTO 重试”；无 `disabled` 时芯片可见文本不含“Jev 停用”且不带警示标记

#### Scenario: 悬停面板显示最近一次决策分布
- **GIVEN** 会话最近一次决策为 `{source: main, depth: higher, status: applied, probabilities: {baseline: 0.3, higher: 0.7}, provider: claude, model: claude-opus-5-5, effort: high}`，提示开关关闭
- **WHEN** 悬停芯片打开面板
- **THEN** 面板含 `主会话 · 已应用` 与 `投入分布：baseline 30% / higher 70%`；无决策时面板不含“最近决策”段

#### Scenario: 芯片样式与悬停面板
- **GIVEN** client bundle 已加载，会话为 `MANUAL`
- **WHEN** 渲染芯片
- **THEN** 芯片是单个按钮，可见文本 `MANUAL` 在前、切换图标在后，无边框；面板默认不渲染；面板开关逻辑对进入/聚焦返回打开、对离开/失焦返回收起

#### Scenario: 切换模式只调用插件接口
- **GIVEN** 用户点击芯片切换模式
- **WHEN** 记录本次交互发出的 RPC
- **THEN** 只调用本插件的设置模式接口，未调用官方模型选择或 `subscriptions-auth.setSpeed`

### Requirement: 决策提示
系统 SHALL 提供默认开启的开关：`$DSH_HOME/plugins/dsh-auto-model-routing/config.json` 中 `decisionToast: false` 时关闭；文件缺失、不可解析或值非 `false` 时视为开启，不得影响路由。开关每次读取状态时生效，无需重启。

系统 SHALL 为每个主会话保留最近一次决策（仅内存，不落盘），字段与本变更前相同：`{id, source, tier, depth, capability?, effort, provider?, model?, status, confidence?, probabilities?, capabilityConfidence?, capabilityProbabilities?, decisionProvider, decisionModel, ms}`，其中 `tier` 等于 depth（子任务为 capability），为既有非版本字段，保留。主会话：Jev 成功判断后记录，`effort` 为 `待应用`、`status` 为 `recommended`；该回合请求按实际模型得出 effort 后更新 `effort`、`provider`、`model`；无法得出 effort 时 `status` 为 `unsupported`；实际请求头与决策一致时为 `applied`，否则为 `failed`。子任务（记录到其根会话）：判断完成或显式指定两个维度时记录，后者 `decisionProvider` 为 `explicit`、`decisionModel` 为 `未调用`、`ms` 为 0；实际请求匹配时为 `applied`。判断失败、取消或被丢弃时 MUST NOT 记录新决策。以下场景中的决策对象均为部分匹配。

状态接口 SHALL 始终返回 `decision`（如有）。开关开启时状态接口同时返回 `decisionToast: true`；client SHALL 仅在 `decisionToast` 为 true 且发现新的决策 `id` 时于芯片上方显示提示，3 秒后自动消失，不拦截指针；提示 MUST 在 Agent 运行、官方隐藏右侧控件期间仍可见。提示与面板共用同一文本：
1. `<主会话|子任务> · <已应用|未应用|不支持调整|已判断/待应用>`
2. 有 capability 时：`能力 <capability> · 判定确定度 <百分比|未提供>` 与 `能力分布：<…>`
3. `投入 <depth> · 判定确定度 <百分比|未提供>`
4. `投入分布：<按 lower/baseline/higher 顺序列出存在的值，以 " / " 分隔，无则“未提供”>`
5. `<provider> / <model|待确定> · <effort>`
6. `<decisionProvider> / <decisionModel> · <秒，两位小数>s`
7. 固定说明：确定度的计算方式，且不是任务成功率。
两次状态读取之间若有多次决策，只显示最新一次。开关关闭时 client MUST NOT 弹出提示。

#### Scenario: 主会话判断提示
- **GIVEN** 开关开启，会话为 `AUTO`，Jev 返回 depth `higher`、confidence 0.4，决策服务 `openrouter` / `typesafe/jev-1.13` 耗时 820ms，实际请求 `claude` / `claude-opus-5-5` / `high`
- **WHEN** 该回合首个请求完成后读取状态并渲染提示
- **THEN** 状态含 `decision = {source: main, depth: higher, effort: high, status: applied}`；提示第一行为 `主会话 · 已应用`，并含 `投入 higher · 判定确定度 40%`、`claude / claude-opus-5-5 · high`、`openrouter / typesafe/jev-1.13 · 0.82s`

#### Scenario: 子任务判断提示
- **GIVEN** 开关开启，会话 S1 为 `AUTO`，其子任务判断为 capability `analytical`、capabilityConfidence 0.8
- **WHEN** 读取 S1 状态并渲染提示
- **THEN** 提示第一行以 `子任务 · ` 开头，含 `能力 analytical · 判定确定度 80%`

#### Scenario: 主决策在请求前后的状态
- **GIVEN** AUTO 主会话本回合 Jev 返回 depth `higher`，主模型目录只支持 `max`
- **WHEN** 分别在 pre-step 完成后与请求发出后读取状态
- **THEN** 前者 `decision` 部分匹配 `{source: main, tier: higher, depth: higher, effort: 待应用, status: recommended}`；后者 `status` 为 `unsupported`，`reason` 为 `no-effort-support`

#### Scenario: 完全显式的子任务决策可见
- **GIVEN** AUTO 根会话经官方 fresh 子会话工具创建子任务，显式给出模型与 effort
- **WHEN** 子任务首次请求完成后读取根会话状态
- **THEN** `decision` 部分匹配 `{source: subagent, decisionProvider: explicit, decisionModel: 未调用, ms: 0, status: applied}`；Jev 请求数为 0

#### Scenario: 开关关闭或判断失败不提示
- **GIVEN** 开关显式关闭（`decisionToast: false`），或开关开启但 Jev 返回 402
- **WHEN** 读取状态
- **THEN** 关闭时状态不含 `decisionToast`、client 不弹出提示（面板仍可显示最近决策）；失败时不产生新的 `decision`

#### Scenario: 提示只显示一次且 3 秒消失
- **GIVEN** client 已显示 id 为 7 的决策提示
- **WHEN** 后续状态读取仍返回 id 7，或经过 3 秒
- **THEN** 不重复显示 id 7；3 秒后提示被移除；官方隐藏右侧控件时提示仍可见

### Requirement: 自动模型路由设置页
系统 SHALL 在官方设置页注册「自动模型路由」，提供读取设置、保存设置、设置 API key、测试连接四个已认证 Host 端点。非密钥设置 SHALL 保存在 `$DSH_HOME/plugins/dsh-auto-model-routing/config.json`（目录 0700、文件 0600，原子替换），字段均可缺省：
- `decisionService`：见 auto-decision-services-feedback；
- `decisionToast`：布尔，缺省 true；
- `defaultMode`：MANUAL | AUTO，缺省 MANUAL；
- `effortCap`：low | medium | high | xhigh，缺省 xhigh；
- `jevTimeoutMs`：1000–8000 整数，缺省 5000。
写入 SHALL 整体校验、保留未修改字段，只持久化文件中已有或本次提交的字段，拒绝未知字段（含 `policy`、`mainEfforts`、`childRoutes`）、形似凭据的字段名与非法值；失败 SHALL 返回字段级错误且配置文件字节不变。文件缺失/不可解析时 SHALL 使用缺省设置并报告配置状态；可独立解析的非法普通字段按缺省值处理。旧映射字段按「旧配置与旧记录只读兼容」处理。下一次请求或工具调用采用新配置，无需重启。

读取响应 SHALL 包含设置、默认值、配置问题、`deprecated` 列表、API key 状态 `{configured, source?, writable, available}`、当前模型目录与子会话允许列表状态；MUST NOT 包含 key 值。

页面 SHALL 包含：决策服务与 API key、判断等待上限、新会话默认模式、判断提示开关、推理强度上限，以及只读的「查看决策策略」说明。策略说明 SHALL 直接展示 `src/rubric.json` 的 instructions 与 criteria 原文，并按注册表列出各家族的能力槽模型与推荐起点；MUST NOT 提供按家族或档位编辑映射的表格。页面 MUST NOT 切换真实会话模型或调用会话 selectModel。

分段控件 SHALL 统一紧凑高度 28px、字号 12px、内边距和圆角，随内容自然占宽。字段保持官方 13px 阅读尺寸、辅助动作/控件用 12px、分区标题 13px/600。页面 SHALL 复用官方主题令牌、表单与菜单基础组件，深浅色跟随宿主；图标使用 E 字形，仅修改自己的导航行，定位失败保留官方默认图标；窄栏不得水平溢出。

设置 API key 端点接受 `{value: string}`（保存/替换）或 `{value: null}`（删除），经官方 credentials 服务写入所选决策服务的凭据引用。空、超过 512 字符或含空白时拒绝。启动环境只读来源 SHALL 拒绝修改，页面说明先移除启动环境变量并重启，再在这里保存。credentials 服务不可用时禁用输入。任何响应、日志、配置文件与错误 MUST NOT 含 key 值；输入不预填，保存后清空草稿；保存 key 不自动清除会话 disabled。key 与非密钥配置是独立提交，任一失败时 SHALL 明确显示哪部分已保存、哪部分未保存。

#### Scenario: 保存普通设置
- **GIVEN** 文件只含 `decisionToast: false`
- **WHEN** 保存 `defaultMode: AUTO`、`jevTimeoutMs: 2500`
- **THEN** 文件为 `{decisionToast: false, defaultMode: "AUTO", jevTimeoutMs: 2500}`，权限 0600；后续新会话与请求采用新设置

#### Scenario: 非法设置整体拒绝
- **GIVEN** 当前设置有效
- **WHEN** 分别提交期限 6000、`effortCap: max`、`defaultMode: auto`、未知字段 `foo`、凭据字段 `apiKey`、`mainEfforts: {}`
- **THEN** 每次均返回字段错误，文件字节不变

#### Scenario: 设置文件损坏
- **GIVEN** 文件不可解析，或普通字段 `effortCap: max` 而期限为 2000
- **WHEN** 打开页面并解析设置
- **THEN** 前者使用默认并说明保存将覆盖损坏文件；后者上限用 xhigh、期限用 2000

#### Scenario: 策略说明来自规则文件与注册表
- **GIVEN** 页面已加载
- **WHEN** 展开「查看决策策略」
- **THEN** 文本含 `src/rubric.json` 每个维度的 instructions 与每条 criteria 原文，以及注册表中每个家族的 label 与三个能力槽模型；页面不存在 `[data-tier]` 行或家族分页；展开不发出任何保存请求

#### Scenario: key 的只读来源与迁移
- **GIVEN** key 来自启动环境
- **WHEN** 打开页面并尝试替换
- **THEN** 显示只读并拒绝，提示先移除环境变量、重启、再保存；不回传 key

#### Scenario: 独立保存结果与不泄漏
- **GIVEN** credentials 可写，用户同时编辑 key 和普通设置
- **WHEN** key 保存成功而普通设置因字段错误失败
- **THEN** 明确显示 key 已保存、设置未保存，清空 key 草稿但保留配置草稿；响应、日志与配置文件无 key

#### Scenario: 导航图标只作用于本区块
- **GIVEN** 设置导航中有本区块与其它插件
- **WHEN** 插件挂载再卸载
- **THEN** 只有自己的导航行使用 E 字形；卸载清除标记，找不到行不报错

### Requirement: AUTO 受管子会话范围

AUTO SHALL 只路由**受管子会话**：在官方 `subagent` 或 fresh `spawn_teammate` 工具执行上下文（AsyncLocalStorage）内，以 `source = "startup"` 创建、且 `parentSession` 等于执行该工具的会话的子会话。判定在子会话 `agent/created` 时一次完成：此刻根会话须为 AUTO、直接父会话 provider 须可读，并同步采样父配置。记录字段 `parentSelection` 形状为 `{provider: string, model?: string, reasoningEffort?: string}`，provider 非空，缺少模型或 effort 时相应退化候选不可用；该字段对新建初始记录必填，旧记录读取允许缺失，旧无 route 的 recommended 冷恢复直接 interrupted，不从现有父配置补造快照。已有 `.bound` 或 `source` 不是 `startup`（含 resume）时 MUST NOT 重写绑定。

**已知限制（用户 2026-10-28 确认接受）**：官方 0.2.0-rc.2 没有能把工具调用与目标子会话一一对应的接缝。实测（`scripts/probe-managed-identity.mjs`）表明：工具执行窗口内若有插件以同一父会话直接创建子会话（含会发布 `subagent/catalog` 的服务直建），它与工具目标不可区分，会被一并视为受管。系统 MUST 在文档与 `childRouting` 说明中如实写明该限制，MUST NOT 声称能区分。窗口之外创建的插件子会话（如 Pet locus 按飞书消息创建）不受影响。

其余 `origin = "subagent"` 会话（官方工具 ALS 上下文外插件直接创建的子会话，如 Pet locus、根会话为 MANUAL 时创建的子会话、`subagent_fork` 或 fork `spawn_teammate` 创建的子会话、父 provider 无法读取的子会话）SHALL 原样放行：MUST NOT 请求 Jev、MUST NOT 改写请求、MUST NOT 写决策记录或绑定标记、MUST NOT 抛错；`childRouting` 返回 `{status: "unsupported"}`。根会话之后切到 `AUTO` MUST NOT 使这些子会话变为受管。孙会话按同一规则判定，provider 与模型锚定其直接父会话。

受管子会话的完整性问题 SHALL 继续 fail closed（拒绝请求，不重新判断、不继承）：绑定标记存在但记录缺失或损坏、记录 `parentId` 与会话 `parentSession` 不符、已绑定 route 与实际请求头不符。

#### Scenario: 官方工具创建的子会话受管
- **GIVEN** 根会话 R 为 `AUTO`，provider `claude`、模型 `claude-opus-5-5`；目录与允许列表含 `claude-haiku-5-5`（支持 `low..xhigh`）；Jev 返回 bounded/baseline
- **WHEN** R 经官方 `subagent` 工具创建子会话 C，C 发出第 1 个请求
- **THEN** C 有绑定标记与决策记录；请求为 `claude` / `claude-haiku-5-5` / `medium`；记录状态为 `applied`

#### Scenario: 插件直接创建的子会话原样放行
- **GIVEN** 根会话 R 为 `AUTO`
- **WHEN** 在官方创建工具的 ALS 上下文之外，以 `meta: {origin: "subagent", parentSession: R}` 直接创建子会话 L 并让其发出第 1 轮请求
- **THEN** 回合正常结束，无抛错；请求配置与官方合成配置深度相等；Jev 请求数为 0；L 无绑定标记与记录文件；`childRouting(L)` 为 `{status: "unsupported"}`

#### Scenario: MANUAL 时创建的子会话在切到 AUTO 后仍放行
- **GIVEN** 根会话 R 为 `MANUAL`，经官方 `subagent` 工具创建子会话 C
- **WHEN** R 切到 `AUTO` 后 C 发出下一次请求
- **THEN** 请求与官方合成配置深度相等，无抛错，Jev 请求数为 0，C 无记录文件

#### Scenario: fork 子会话与父会话一致
- **GIVEN** 根会话 R 为 `AUTO`，本回合 AUTO 已把 R 的 effort 设为 `high`
- **WHEN** R 经官方 `subagent_fork` 创建子会话 F，F 发出第 1 个请求
- **THEN** 工具执行不抛错；F 的请求与官方合成配置深度相等；Jev 请求数不增加；F 无记录文件

#### Scenario: 孙会话以直接父会话为锚
- **GIVEN** 根会话 R 为 `AUTO`，受管子会话 C 已应用 route `claude` / `claude-sonnet-5-5` / `medium`
- **WHEN** C 经官方 `subagent` 工具创建 G，Jev 对 G 返回 bounded/baseline
- **THEN** G 受管，记录 `parentId` 为 C、`rootId` 为 R；G 的 route provider 为 `claude`

#### Scenario: 创建期间根会话离开 AUTO 则不受管
- **GIVEN** 根会话 R 为 `AUTO`，官方 `subagent` 工具已开始执行
- **WHEN** 在子会话 `agent/created` 之前 R 被切为 `MANUAL`，随后子会话 C 创建并发出首个请求
- **THEN** C 无绑定标记与记录文件；请求与官方合成配置深度相等；Jev 请求数为 0

#### Scenario: 恢复通知不重写已有绑定
- **GIVEN** 受管子会话 C 已有记录 route `claude` / `claude-haiku-5-5` / `medium`
- **WHEN** 插件重启后 C 以 `source = "resume"` 触发 `agent/created`，且此时处于另一次官方工具执行窗口内
- **THEN** C 的记录文件字节不变，不抛错；C 的下一次请求仍为原 route

#### Scenario: 工具窗口外创建的插件子会话不被接管
- **GIVEN** 根会话为 AUTO，官方 `subagent` 工具已执行完毕
- **WHEN** 插件随后分别以 `agents.create` 与 `subagents.startContinuable` 创建同父子会话 L1、L2，各进入首轮
- **THEN** L1、L2 无绑定标记与记录，Jev 请求数为 0，请求与官方合成配置深度相等

#### Scenario: 同窗口同父插件旁支一并受管且如实说明
- **GIVEN** 根会话 R 为 AUTO、父 provider 可读；目录、允许列表和 effort 支持目标 route；Jev 固定返回 bounded/baseline
- **WHEN** 分别在官方 `subagent` 与 fresh `spawn_teammate` 的 ALS 上下文内，在实际工具目标创建之前，以 R 为父调用 `subagents.startContinuable` 创建 startup 插件旁支 L，再让 L 发出首个请求
- **THEN** 两种工具各自的 L 均有绑定标记与记录，并进入受管首次路由；`childRouting(L).scopeNote` 恰为“按官方工具 ALS 上下文、同父与 startup 绑定；不能区分同窗口插件旁支，旁支可能一并受管。”；不以有无 `subagent/catalog` 决定绑定

#### Scenario: provider 与父配置在绑定边界同步采样
- **GIVEN** 官方工具入口时父配置为 A/Ma/Ea，子会话 `agent/created` 前已变为 B/Mb/Eb
- **WHEN** 分别不传 provider、显式传入 provider X 创建受管子会话
- **THEN** 两份 parentSelection 均为 B/Mb/Eb；前者解析 P 与 explicit.provider 为 B，后者为 X；不存在 A/Mb/Eb 的混合快照

#### Scenario: 新初始记录缺少父快照被拒
- **GIVEN** 一条本次新写 recommended 初始记录不含 parentSelection
- **WHEN** 调用创建绑定记录的写入 API
- **THEN** 写入被拒，记录与 bound 标记都不存在；旧 applied 记录无 parentSelection 仍能读取并按原 route 恢复

#### Scenario: 受管子会话完整性问题仍拒绝
- **GIVEN** 受管子会话 C 有绑定标记，但其记录文件的 `parentId` 被改为其它会话
- **WHEN** C 发出请求
- **THEN** 请求被拒绝，模型请求与 Jev 请求数均为 0

### Requirement: 子任务路由退化链
受管子会话首次请求前，系统 SHALL 按以下顺序确定 route。记 P 为 provider（显式指定值，否则为创建快照中的父 provider），M0、E0 为创建快照中的父模型与 effort，“目录”指 P 的实时目录，“可用”指：该 provider/model 在目录中、在官方子会话允许列表中（状态须为 enabled）、在父会话 captured allowlist（存在时）中，且 effort 属于该模型支持序列并不超过 effort 上限。允许列表 MUST 对每个候选校验，包括 M0；系统 MUST NOT 为任何模型豁免允许列表。
1. **能力槽**：未显式指定模型且 M0 的家族已知时，按「模型家族策略注册表」的能力槽解析规则在目录中找槽位模型。effort 取显式 effort，否则按 depth 计算；候选可用则采用。
2. **保持模型、按 depth 调 effort**：第 1 步未采用时，模型取显式模型，否则 M0；effort 取显式 effort，否则按 depth 计算；可用则采用。
3. **父会话 effort**：仅当**未显式指定 effort**、第 2 步因按 depth 计算的 effort 不可得或不可用而未采用时，以第 2 步的模型与 E0 组成候选；可用则采用。
4. **不改写并告警**：以上均未采用，或子任务 Jev 失败/取消/返回 `insufficient_context`，或首次请求前根会话已离开 `AUTO`，或首次请求前发现初始决策中断（冷恢复后记录为 `recommended` 且无 route）时，系统 MUST NOT 改写该请求（交给 DSH 默认行为），写入 `status: "unsupported"` 与闭集 `reason`，并按「子任务未路由告警」告警。闭集为：`jev-<失败类别>`、`jev-cancelled`、`needs-context`、`mode-changed`、`interrupted`、`no-usable-route`、`explicit-unavailable`（显式指定的模型或 effort 在第 2 步不可用时使用）。

已有 route 的子会话每次请求 SHALL 重新校验当前目录、允许列表、存在的父 captured allowlist 与 effort cap；不满足或服务不可用时拒绝该次请求，模型请求数为零，记录保持不变、不重判、不换模型。此安全拒绝独立于首次路由退化链。

子初始判断 SHALL 捕获根模式 epoch，在每次异步 Jev/目录返回后以及保存 route 前复核。epoch 改变（包括 AUTO→MANUAL→AUTO）时丢弃旧结果，以 unsupported/mode-changed 结束，不写新 decision、根 disabled 或旧 Jev 失败 notice；可写 mode-changed notice。取消信号已中止时 MUST NOT 通过退化继续发请求，实际取消由宿主保持。

显式指定的维度 MUST NOT 被替换：显式 effort 不可用时不进入第 3 步。系统 MUST NOT 更换 provider，MUST NOT 选用第 1 步槽位与 M0/显式模型以外的模型。

决策记录 SHALL 满足以下状态组合，写入严格校验，读取时不满足即按「旧配置与旧记录只读兼容」fail closed：`recommended`（无 `actual`）；`applied`（有 `route` 与 `actual`）；`failed`（有 `route`，实际请求不匹配）；`unsupported`（无 `route` 与 `actual`）。新写入的 `unsupported` 的 `reason` MUST 属于上述闭集；读取时 `unsupported` 以及旧状态 `needs-context`、无 `route` 的 `failed` 接受任意不超过 240 字的 `reason`。读取到无 `route` 的 `unsupported`、`needs-context` 或 `failed` 时 SHALL 原样放行且不重新判断；有 `route` 的 `failed` 继续拒绝请求。

#### Scenario: 能力槽可用时按能力选模
- **GIVEN** 父会话 `codex` / `gpt-6.1-sol` / `medium`；目录与允许列表含 `gpt-6-luna`（支持 `low..xhigh`）；Jev 返回 bounded/baseline
- **WHEN** 创建受管子会话并发出首个请求
- **THEN** 请求为 `codex` / `gpt-6-luna` / `high`，记录 `applied`

#### Scenario: provider 没有能力槽模型时保持父模型
- **GIVEN** 父会话 `traex` / `GPT-5.6-Sol` / `medium`；traex 目录只有 `GPT-5.6-Sol`（支持 `low..xhigh`，目录默认 `medium`），允许列表含 `traex` / `GPT-5.6-Sol`；Jev 返回 bounded/higher
- **WHEN** 创建受管子会话并发出首个请求
- **THEN** 请求为 `traex` / `GPT-5.6-Sol` / `high`；记录 `applied`；provider 未变为 `codex` 或任何 Magpie provider

#### Scenario: 父模型不在允许列表时不改写
- **GIVEN** 父会话 `traex` / `GPT-5.6-Sol` / `medium`；traex 目录同上；允许列表分别为空、`disabled`、服务不可用
- **WHEN** 三种情况下各创建受管子会话并发出首个请求，Jev 返回 bounded/higher
- **THEN** 三个请求均与官方合成配置深度相等；记录均为 `{status: "unsupported", reason: "no-usable-route"}`

#### Scenario: depth effort 不可得时用父会话 effort
- **GIVEN** 父会话 `traex` / `GPT-5.6-Sol` / `medium`；目录支持 `low..xhigh` 但无目录默认、该模型也不在 `effortStarts` 中；允许列表含该模型；Jev 返回 bounded/higher
- **WHEN** 创建受管子会话并发出首个请求
- **THEN** 请求为 `traex` / `GPT-5.6-Sol` / `medium`，记录 `applied`

#### Scenario: 父会话 effort 也不可用时不改写并告警
- **GIVEN** 父会话 `traex` / `GPT-5.6-Sol` / `max`；目录只支持 `max`；允许列表含该模型；Jev 返回 bounded/baseline
- **WHEN** 创建受管子会话并发出首个请求
- **THEN** 请求与官方合成配置深度相等；记录 `{status: "unsupported", reason: "no-usable-route"}`；根会话状态出现 `childNotice`；无抛错

#### Scenario: 子任务 Jev 失败不改写
- **GIVEN** 根会话为 `AUTO`，子任务 Jev 返回 402
- **WHEN** 创建受管子会话并发出首个请求
- **THEN** 请求与官方合成配置深度相等；记录 `reason` 为 `jev-insufficient-credits`；根会话仍为 `AUTO` 且无 `disabled`；Jev 不重试

#### Scenario: 显式维度不可用时不替换
- **GIVEN** 根会话为 `AUTO`，effort 上限 `high`；父会话 `claude` / `claude-opus-5-5` / `medium`；目录与允许列表含 `claude-haiku-5-5`（支持 `low..xhigh`）与 `claude-opus-5-5`（只支持 `low`、`medium`）
- **WHEN** 分别以官方工具显式给出 `{model: claude-haiku-5-5, reasoning_effort: xhigh}`、`{reasoning_effort: xhigh}`、`{reasoning_effort: turbo}` 创建受管子会话（DSH 原生校验均已允许创建），各发出首个请求
- **THEN** 三个请求均与官方合成配置深度相等；记录 `reason` 均为 `explicit-unavailable`；第一个的 Jev 请求数为 0；没有任何请求的 effort 被改为 `medium` 或 `high`

#### Scenario: 只显式 effort 时能力槽须支持该 effort
- **GIVEN** 父会话 `claude` / `claude-opus-5-5` / `medium`；目录与允许列表含 `claude-haiku-5-5`（只支持 `low`、`medium`）与 `claude-opus-5-5`（支持 `low..xhigh`）；Jev 返回 bounded/baseline
- **WHEN** 以显式 `{reasoning_effort: high}` 创建受管子会话并发出首个请求
- **THEN** 请求为 `claude` / `claude-opus-5-5` / `high`

#### Scenario: 不改写的记录在重启后不重判
- **GIVEN** 三个子会话记录：`{status: "unsupported", reason: "no-usable-route"}`、旧 `{status: "needs-context", reason: "任务目标或范围不足"}`、旧 `{status: "failed", reason: "初始判断已取消"}`，均无 route
- **WHEN** 插件重启后各子会话再次发出请求
- **THEN** 三个请求均与官方合成配置深度相等，Jev 请求数为 0，无抛错

#### Scenario: 矛盾的记录组合被拒绝
- **GIVEN** 四个子会话记录：`unsupported` 但含 `route`；`applied` 但无 `route`；`recommended` 但含 `actual`；有 `route` 的 `failed`
- **WHEN** 各子会话发出请求，并尝试写入 `{status: "unsupported", reason: "whatever"}`
- **THEN** 四个请求均被拒绝，模型请求与 Jev 请求数均为 0；该写入抛错

#### Scenario: 冷恢复时初始决策中断
- **GIVEN** 子会话记录为 `recommended` 且无 route，插件已重启（内存中无 pending）
- **WHEN** 该子会话发出首个请求
- **THEN** 请求与官方合成配置深度相等；记录改写为 `{status: "unsupported", reason: "interrupted"}`；Jev 请求数为 0

#### Scenario: 已有 route 实时门禁失败仍拒绝
- **GIVEN** C 已应用 high route；分别发生 cap 降为 medium、允许列表撤销目标、目录不可用、允许列表不可用
- **WHEN** C 在各条件下发下一请求，含插件重启后的请求
- **THEN** 各次均被拒绝，模型与 Jev 请求数为零；C 记录字节不变；无新路由

#### Scenario: 子判断期间模式往返使旧结果失效
- **GIVEN** 根为 AUTO，子 Jev 或目录请求 pending
- **WHEN** 分别执行 AUTO→MANUAL、AUTO→MANUAL→AUTO，随后旧 Jev 返回成功或402（四组组合），或旧目录返回成功
- **THEN** 无 route 改写；记录 unsupported/mode-changed；不重判、无根 disabled、无 jev-insufficient-credits notice，无新 decision

### Requirement: 子任务未路由告警
退化链到达第 4 步时，系统 SHALL：以 Host logger 写一条 warn，只含子会话 id 与 `reason`，MUST NOT 含任务文本或凭据；在根会话的状态响应中返回 `childNotice = {id, childId, reason, at}`（仅内存，只保留最近一条，`id` 单调递增）。面板 SHALL 显示“最近子任务未路由：<reason>（按 DSH 默认运行）”。`decisionToast` 为 true 且出现新的 `childNotice.id` 时，client SHALL 以与决策提示相同的位置与时长显示该文本一次。`childNotice` MUST NOT 计入 `decision`，不改变「决策提示」中“判断失败不记录新决策”的规则。

#### Scenario: 未路由告警可见且只提示一次
- **GIVEN** 开关开启；根会话 R 的受管子会话因 `no-usable-route` 未路由
- **WHEN** 连续两次读取 R 的状态并渲染
- **THEN** 两次都含 `childNotice.reason = "no-usable-route"` 与同一 `id`；提示只显示一次，含“未路由”；面板含“按 DSH 默认运行”；Host logger 恰有一条含该子会话 id 的 warn

#### Scenario: 告警不泄漏任务文本且开关关闭不弹出
- **GIVEN** 开关关闭；子任务文本含 `SECRET-TASK`，子任务 Jev 返回 401
- **WHEN** 读取 R 状态、渲染芯片，并读取 logger 输出
- **THEN** 不弹出提示，面板仍显示 `jev-unauthorized`；状态响应、面板文本与日志均不含 `SECRET-TASK`；`decision` 未因此更新

### Requirement: 子会话不显示 AUTO 芯片
对 `origin = "subagent"` 会话，`state` 端点 SHALL 返回 200 与 `{applicable: false}`，不含模式等字段，不修改任何状态；该响应 MUST 在任何主会话支持判定、模式锁定或状态装饰之前返回，原始 HTTP 与 RPC envelope 两条路径的 value 都恰为 `{applicable: false}`。client 收到 `applicable: false` 时 SHALL 不渲染芯片、面板与提示，并停止对该会话的轮询与选择订阅；`sessionId` 切换为其它会话时 SHALL 按新会话重新开始。普通会话的芯片行为不变。

#### Scenario: 子会话不渲染芯片且停止轮询
- **GIVEN** 会话 C 为子会话
- **WHEN** client 挂载芯片并经过 10 秒，随后把 `sessionId` 切换为普通会话 S 再经过 4 秒
- **THEN** C 期间渲染结果为空，C 的状态 RPC 恰调用 1 次；切换后渲染 S 的芯片，S 的状态 RPC 至少调用 2 次

#### Scenario: 带旧 AUTO 状态的子会话不被改写
- **GIVEN** 子会话 C 的状态文件中有 `mode: AUTO`，C 的模型不在支持范围
- **WHEN** 分别以原始 HTTP 与 RPC envelope 调用 C 的 `state`
- **THEN** 两次 value 都恰为 `{applicable: false}`；C 的状态文件字节不变

#### Scenario: 状态读取失败的普通会话保持原行为
- **GIVEN** 普通会话 S 的首次状态 RPC 失败，之后恢复正常
- **WHEN** client 挂载芯片并经过两次轮询间隔
- **THEN** 芯片仍渲染（失败时显示错误），恢复后显示模式；轮询未停止

### Requirement: 模型家族策略注册表
系统 SHALL 把与模型家族相关的全部知识集中在包内 `src/strategies/`：每个家族一个策略文件，导出只读数据对象 `{id, label, modelPrefixes, effortStarts, childModels}`，MUST NOT 含 provider 或 transport 相关字段。注册表构造时 SHALL 校验：`id` 唯一；不同策略的 `modelPrefixes` 在忽略大小写后互不为前缀；`effortStarts` 的键在全体策略间唯一，值属于 `low | medium | high | xhigh`；`childModels` 三个槽位齐全且不含 `/`；策略对象不含上述五个以外的键。任一校验失败 SHALL 抛出指明冲突项的错误，插件加载失败，MUST NOT 以部分策略运行。

匹配规则（`bare(id)` 指 id 最后一个 `/` 之后的部分）：
- 家族：`bare(model)` 忽略大小写以某策略的 `modelPrefixes` 开头。主会话支持判定与子模型家族识别使用同一规则。
- effort 起点：`bare(model)` 大小写敏感地在 `effortStarts` 中查找；未找到时使用目录 `defaultEffort`。
- 能力槽解析：在 provider P 的目录中找同时满足以下两点的条目：`bare(entry.model)` 与槽位模型忽略大小写相等；`entry.model` 最后一个 `/` 之前的部分（无 `/` 时为空串）与父模型的这一部分完全相等。恰好一个时采用该条目的完整 id，否则视为未找到。

provider MUST NOT 从注册表派生，也 MUST NOT 用于过滤目录、允许列表、预览工具参数或决策记录。`src/` 中注册表以外的模块 MUST NOT 出现家族模型 id 或家族前缀字面量。

#### Scenario: 内置注册表可构造且不含 provider 知识
- **GIVEN** 内置两个策略，以及内置策略加合成策略 `deepseek`（`modelPrefixes: ["deepseek-"]`，`effortStarts: {"deepseek-v5": "medium"}`，三个能力槽均为 `deepseek-v5`）
- **WHEN** 分别构造注册表
- **THEN** 两次都成功；任何策略对象都没有 `transports` 键；注册表没有 `providers`、`hasProvider` 方法

#### Scenario: 冲突的注册表拒绝构造
- **GIVEN** 七份策略列表（内置策略加一个除所述缺陷外合法的合成策略）：`id` 重复为 `codex`；`modelPrefixes` 为 `GPT-6-`；起点为 `max`；`effortStarts` 重复内置键 `gpt-6-luna`；`childModels` 缺少 `frontier`；能力槽为 `codex/gpt-6-luna`；含 `transports` 键
- **WHEN** 分别构造注册表
- **THEN** 七次都抛错，错误信息分别含重复的 id、重叠的模型前缀、非法 effort、重复的起点键、缺失的槽位名、含 `/` 的槽位、未知键 `transports`；不返回部分注册表

#### Scenario: effort 起点按模型名查找且保持原结果
- **GIVEN** 内置注册表；目录支持 `low..max`；effort 上限 `xhigh`
- **WHEN** 分别以下列输入计算主 effort（模型、depth、目录默认 effort）
- **THEN** `claude-opus-5-5`、`claude-sonnet-5-5`、`claude-haiku-5-5`、`gpt-6.1-sol` 的 lower/baseline/higher 为 `low/medium/high`；`claude-fable-5-1`、`gpt-6-luna` 为 `medium/high/xhigh`；`gpt-6-astra` 为 `low/low/medium`；`claude/claude-opus-5-5` 与 Opus 相同；`opencode-go/gpt-6-luna`（目录默认 `low`）与 Luna 相同；`CLAUDE-OPUS-5-5`、`claude-unknown`、`gpt-7` 在目录默认 `low` 时为 `low/low/medium`，无目录默认时抛出 unsupported 错误

#### Scenario: effort 边界保持原结果
- **GIVEN** 内置注册表；除个别用例另行给出外，目录支持 `[low, medium, high, xhigh, max]`，effort 上限 `xhigh`
- **WHEN** 计算：Opus higher，支持 `[low, medium, xhigh, max]`；Luna higher，上限 `high`；Luna baseline，上限 `medium`；Astra lower，支持 `[low, medium]`；`deepseek-v4.1-flash` baseline，目录默认 `max`；Opus baseline，只支持 `[max]`
- **THEN** 依次为 `xhigh`、`high`、`medium`、`low`、抛出“起点不可验证”错误、抛出“起点不可验证”错误

#### Scenario: 新增家族只需新增策略
- **GIVEN** 测试以内置策略加合成策略 `deepseek` 构造注册表并注入插件；`opencode-go` 目录与官方允许列表含 `deepseek-v5`，支持 `low..xhigh`
- **WHEN** 主模型为 `opencode-go` / `deepseek-v5` 的 AUTO 会话收到 depth `higher`，经官方 fresh 子会话工具创建一个 Jev 判为 bounded/baseline 的子任务，随后重启插件（同一注册表）并让该子会话再发一次请求
- **THEN** `autoSupport.supported = true`，主请求 effort 为 `high`；子会话记录含 `family: "deepseek"` 与 route `opencode-go` / `deepseek-v5` / `medium`，状态 `applied`；重启后的请求使用同一 route 且 Jev 请求数不增加；注册表以外的源码文件没有修改

#### Scenario: 记录中的家族已不在注册表
- **GIVEN** 决策记录目录中有一个以合成 `deepseek` 注册表写入、已有 route 的子会话记录，插件改用只含内置策略的注册表重启
- **WHEN** 该子会话发出请求
- **THEN** 请求被拒绝且错误含“无法恢复”，Jev 请求数为 0，不改用其它路由；只含内置家族的记录照常恢复

#### Scenario: 家族知识只有一个来源
- **GIVEN** 包内 `src/` 源码
- **WHEN** 测试扫描 `src/strategies/` 以外的全部源码文件（含 client）
- **THEN** 不出现 `claude-haiku-5-5`、`claude-sonnet-5-5`、`claude-opus-5-5`、`claude-fable-5-1`、`gpt-6-luna`、`gpt-6.1-sol`、`gpt-6-astra` 字面量，不出现 `'claude' | 'codex'` 联合类型、`p.id === 'claude'` 一类 provider 判断，或以 `claude-`、`gpt-` 为前缀判定家族的正则与字符串比较；全部源码不出现标识符 `transports`、`hasProvider`

#### Scenario: 未登记的 provider 不被枚举拒绝
- **GIVEN** 根会话为 `AUTO`，父会话 provider `traex`
- **WHEN** 以 provider `traex` 写入并读回一条受管子会话记录，并以 `{provider: "traex"}` 调用 `route_subagent`
- **THEN** 记录写入与读回成功且 provider 为 `traex`；工具参数校验通过，结果不是“provider 不在已注册家族中”一类错误

### Requirement: 内置模型家族策略
内置注册表 SHALL 恰含两个策略：
- `claude`（label `Claude`）：`modelPrefixes: ["claude-"]`；`effortStarts`：`claude-opus-5-5`、`claude-sonnet-5-5`、`claude-haiku-5-5` 为 medium，`claude-fable-5-1` 为 high；`childModels`：bounded `claude-haiku-5-5`、analytical `claude-sonnet-5-5`、frontier `claude-opus-5-5`。
- `codex`（label `GPT`）：`modelPrefixes: ["gpt-"]`；`effortStarts`：`gpt-6.1-sol` 为 medium，`gpt-6-luna` 为 high，`gpt-6-astra` 为 low；`childModels`：bounded `gpt-6-luna`、analytical `gpt-6.1-sol`、frontier `gpt-6.1-sol`。

子模型的实际 id 取自 provider 目录中按能力槽解析规则找到的条目。

#### Scenario: 内置子路由与原行为一致
- **GIVEN** 内置注册表；`claude`、`codex`、`dsh-magpie-connector`、`dsh-magpie-connect` 的目录与允许列表含原有全部能力槽模型（Magpie 下为 `claude/…`、`codex/…`），均支持 `low..xhigh`
- **WHEN** 以父模型 `claude-opus-5-5`、`gpt-6.1-sol`、`claude/claude-opus-5-5`、`codex/gpt-6.1-sol` 在各自 provider 下计算 bounded/analytical/frontier × lower/baseline/higher 的子路由
- **THEN** 结果与本变更前 `choosePolicyRoute` 的输出深度相等，例如 `codex` bounded baseline → `gpt-6-luna` / `high`，`dsh-magpie-connector` + 父 `claude/…` frontier lower → `claude/claude-opus-5-5` / `low`，`claude` bounded baseline → `claude-haiku-5-5` / `medium`

#### Scenario: 能力槽只在父 provider 内解析
- **GIVEN** 父会话 `traex` / `GPT-5.6-Sol`；`codex` 目录与允许列表含 `gpt-6-luna`，`traex` 目录不含；允许列表含 `traex` / `GPT-5.6-Sol`
- **WHEN** 计算 bounded/baseline 子路由
- **THEN** route provider 为 `traex`，模型为 `GPT-5.6-Sol`；结果不含 `codex` 或 `gpt-6-luna`

#### Scenario: 能力槽须与父模型前缀相同
- **GIVEN** provider `dsh-magpie-connect`；目录与允许列表只含 `opencode-go/gpt-6-luna` 与 `codex/gpt-6.1-sol`（均支持 `low..xhigh`）；父模型为 `codex/gpt-6.1-sol`
- **WHEN** 计算 bounded/baseline 子路由
- **THEN** 能力槽视为未找到（`opencode-go/gpt-6-luna` 前缀不同）；route 为 `dsh-magpie-connect` / `codex/gpt-6.1-sol` / `medium`
