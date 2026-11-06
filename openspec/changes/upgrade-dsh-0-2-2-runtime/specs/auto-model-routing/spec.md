## MODIFIED Requirements

### Requirement: AUTO 主 effort 同步官方选择
AUTO 主会话 SHALL 保持本步选择的 provider/model，按 depth 算法、实时支持与 effort cap 选 effort。系统 SHALL 在每一步的 `agent/pre-step` 中完成该步 effort 的计算与应用：此时运行体已固定本步选择（payload `modelSelection`），尚未生成请求。目标 effort 与 `modelSelection` 的 effort 不同时，SHALL 先等待官方 sessionController.selectModel，以同 sessionId/provider/model 和选定 reasoningEffort 更新选择，允许官方保存全局 defaults；成功后再把 `modelSelection.reasoningEffort` 改为同一值，使本步请求即用该值（依赖见「本步选择改写依赖运行体核验」）。相同 effort SHALL 不重复同步。系统 MUST NOT 改动 `modelSelection` 的 provider/model，MUST NOT 在 `agent/request` 中改写主会话请求。官方同步失败或 writer 尚不可用 SHALL 记录可诊断告警，不改 `modelSelection`，本步按原选择发出，以避免选择与请求不一致；不将目标 effort 标为 applied、不静默吞错、不换模型。MANUAL、无 effort 支持及已绑定 child 请求 SHALL 不因此写官方选择。判断与 child 精确绑定不受本要求影响。

#### Scenario: 同次主请求同步官方 effort 与 defaults
- **GIVEN** AUTO 主模型 pending medium，模型支持 high，Jev depth 为 higher
- **WHEN** 真实主请求执行（包含新旧 Magpie 与普通 route）
- **THEN** adapter/header、官方选择与默认保存均为同 provider/model 的 high；同步完成后才发出该请求，该回合 step 1 的请求头即为 high，运行体未抛出 "use agent.model.select() before step preparation"；不产生递归请求，后续相同 effort 不重复写

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

### Requirement: 模式与改写规则
系统 SHALL 为每个主会话提供 `AUTO` 与 `MANUAL` 两种模式，按会话持久化。新建普通会话的初始模式 SHALL 取设置项「新会话默认模式」（`MANUAL` | `AUTO`，缺省 `MANUAL`）：仅当普通会话以全新方式创建（不是恢复、清空、压缩或子会话）且其默认主模型受支持时，系统 SHALL 按创建时刻的设置值写入该会话的模式；此后修改设置 MUST NOT 改变已有会话的模式。没有状态记录的已有会话 SHALL 视为 `MANUAL`。默认模式为 `AUTO` 时新会话的行为与用户手动切到 `AUTO` 相同（含 Jev 失败即停用）。
- **AUTO**：系统 SHALL 只设定主会话每一步的 reasoning effort，MUST NOT 改动 provider 与 model；同一回合内 depth 一经判断即不再变化，每一步开始时按该步实际模型重新计算 effort；同一步内的错误重试沿用该步已设定的值。effort 的设定与官方选择的同步按「AUTO 主 effort 同步官方选择」执行。
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

### Requirement: 用户回合与 Jev 输入
系统 SHALL 只在 step 1 的 `agent/pre-step` 中、先执行 `await next()` 得到 `PreStepDecision` 后判定主会话用户回合并请求 Jev：结果为 `reject` 时 MUST NOT 请求 Jev、MUST NOT 记录本回合决定；结果为 `enter` 时只使用其 `messages`。**合格消息**为该次领取消息中 `source.kind` 严格等于 `"user"` 的消息；其它来源（含 `agent-instructions`、`plugin`、`plugin:<id>`、`runtime-context`、`time-context`、`skill-catalog`）与缺失 `source` 的消息 MUST NOT 贡献输入。合格消息数为 0 的回合不是用户回合，沿用上一用户回合的 depth 且不请求 Jev；首个用户回合之前无 depth 时不改写。分类输入为合格消息按领取顺序、消息内按块顺序的 `text` 块文本，以 `"\n"` 连接，经 `redact` 后取 `.slice(0, 8000)`；非文本块不贡献。决定 SHALL 按 (agent, turn) 保存，同回合后续请求（含同 turn/step 的错误重试）复用该决定。`origin = "subagent"` 会话 MUST NOT 走主会话判断；其路由只按「AUTO 决策与执行」处理；判断输入为创建它的官方工具调用（`subagent`、`spawn_teammate`）参数中的任务文本 `prompt`，即子会话首条 user 消息的内容，运行体为子会话注入的非 user 消息不贡献输入。

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
- **GIVEN** 父会话为 `AUTO`，经官方 fresh 子会话工具创建子会话，工具参数 `prompt` 为“整理日志”；子会话首条进入消息另含运行体注入的非 user 指令
- **WHEN** 创建该子会话的工具调用进行判断
- **THEN** 发往 Jev 的子任务 `state` 只含“整理日志”，不含注入指令文本；父会话本回合的决定与 Jev 请求次数不变

### Requirement: AUTO 决策与执行
主会话 SHALL 仅判断 depth=lower/baseline/higher，并在模型支持序列中以所属家族策略的推荐起点最多移动一档，不修改 provider/model；选定 effort 与官方合成值不同时，按「AUTO 主 effort 同步官方选择」经官方 selectModel 同步。子任务 SHALL 只在「AUTO 受管子会话范围」内路由：独立判断 capability=bounded/analytical/frontier 或 insufficient_context，按「子任务路由退化链」确定 route，保留显式模型/effort，完全显式时不调用 Jev。受管子会话的判断 SHALL 在创建它的官方工具调用中完成（`tools/execute` 调用 `next()` 之前，使用该调用的 signal）；子会话在 `agent/created` 中绑定后，系统 SHALL 同步以子会话自身的 `agent.model.select(route)` 写入 route，使其 step 1 即用该 route，MUST NOT 保存全局默认。受管子会话 SHALL 按精确 child ID 绑定、持久化，实际请求匹配后标 applied；恢复不重判，已持久的选择即为 route。已有 route 的子会话 SHALL 在每次请求的 `agent/request` 中只核验、不改写：返回值 MUST 等于 `await next()` 的结果。fork 不属于受管范围，SHALL 与父会话保持一致、原样放行，MUST NOT 报错或悄悄改为 fresh。Agent 保留编排和验收权，不实现自主重试升级。

#### Scenario: Magpie 自动子路由
- **WHEN** Magpie GPT 主会话为 AUTO 且创建 bounded 子任务
- **THEN** 从允许列表和实时目录验证同 transport 的 codex/gpt-6-luna 及支持 effort，持久绑定精确 child；不得转到本地入口

#### Scenario: 未登记 provider 的 GPT 主会话可以派子任务
- **GIVEN** 根会话为 `AUTO`，provider `traex`、模型 `GPT-5.6-Sol`
- **WHEN** 经官方 `subagent` 工具创建子会话（不传 provider/model/effort）
- **THEN** 工具执行不抛错；子会话受管，记录 `explicit.provider` 为 `traex`、`family` 为 `codex`；首个请求 provider 为 `traex`

#### Scenario: 子路由在 step 1 生效且不写默认
- **GIVEN** AUTO 根会话经官方 fresh 子会话工具创建受管子任务，判出 route `claude` / `claude-haiku-5-5` / `medium`
- **WHEN** 子会话开始 step 1
- **THEN** `agent.model.select` 在该子会话 `agent/created` 中恰被调用一次，参数为该 route；step 1 的 `modelSelection` 与请求头均为该 route；`saveSelection` 调用次数为 0；`agent/request` 返回值等于 `await next()`，运行体未抛错

### Requirement: 子任务路由退化链
受管子会话首次请求前，系统 SHALL 按以下顺序确定 route。记 P 为 provider（显式指定值，否则为创建快照中的父 provider），M0、E0 为创建快照中的父模型与 effort，“目录”指 P 的实时目录，“可用”指：该 provider/model 在目录中、在官方子会话允许列表中（状态须为 enabled）、在父会话 captured allowlist（存在时）中，且 effort 属于该模型支持序列并不超过 effort 上限。允许列表 MUST 对每个候选校验，包括 M0；系统 MUST NOT 为任何模型豁免允许列表。
1. **能力槽**：未显式指定模型且 M0 的家族已知时，按「模型家族策略注册表」的能力槽解析规则在目录中找槽位模型。effort 取显式 effort，否则按 depth 计算；候选可用则采用。
2. **保持模型、按 depth 调 effort**：第 1 步未采用时，模型取显式模型，否则 M0；effort 取显式 effort，否则按 depth 计算；可用则采用。
3. **父会话 effort**：仅当**未显式指定 effort**、第 2 步因按 depth 计算的 effort 不可得或不可用而未采用时，以第 2 步的模型与 E0 组成候选；可用则采用。
4. **不改写并告警**：以上均未采用，或子任务 Jev 失败/取消/返回 `insufficient_context`，或写入 route（子会话 `agent/created`）前根会话已离开 `AUTO`，或首次请求前发现初始决策中断（冷恢复后记录为 `recommended` 且无 route）时，系统 MUST NOT 改写该请求（交给 DSH 默认行为），写入 `status: "unsupported"` 与闭集 `reason`，并按「子任务未路由告警」告警。闭集为：`jev-<失败类别>`、`jev-cancelled`、`needs-context`、`mode-changed`、`interrupted`、`no-usable-route`、`explicit-unavailable`（显式指定的模型或 effort 在第 2 步不可用时使用）。

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

#### Scenario: 同一步重试前门禁失效
- **GIVEN** 受管子会话 C 的 high route 首次请求通过核验，provider 返回可重试错误，`agent/request-error` 返回 retry
- **WHEN** 重试前 effort cap 降为 medium（或允许列表撤销该目标、目录不可用）
- **THEN** 重试那次的 `agent/request` 核验抛出可诊断错误，第二次 adapter 调用次数为 0；route 与 C 的选择不变

### Requirement: Jev 判断请求与脱敏
系统 SHALL 在 AUTO 主会话用户回合 step 1 的 `agent/pre-step` 与受管子任务创建时（创建它的官方工具调用中，子会话首个请求之前），各以一次 Jev 决策请求得出判断：请求发往设置中所选决策服务的端点与模型（见 auto-decision-services-feedback），凭据按该服务的固定引用在每次调用时经官方 credentials 服务解析（credentials 服务不存在时经官方 launch environment 读取），未解析到值时为 `missing-credential`；单次期限取设置项「Jev 期限」（整数毫秒，范围 1000–8000，缺省 8000，每次请求时读取），`redirect: 'error'`，MUST NOT 重试。请求 body 为 `{model, state, questions}`；`questions` SHALL 取自按「判档预设的采样与归属」为该次判断捕获的预设的 `rubric.json`：主会话只含 `depth`，子任务按显式维度含 `capability`、`depth` 或两者；`route_subagent` 同样使用所选预设。返回的 choice SHALL 按该捕获预设的 criteria 键校验。Jev 返回后 SHALL 重新读取会话模式，等待期间模式已变或回合决定已被废止时丢弃结果（不写决定、不写 `disabled`）。系统 MUST NOT 包含本地规则、关键词或通用对话模型的判断路径。请求 MUST NOT 携带会话状态、其它会话内容或凭据以外的鉴权信息；出站主机 SHALL 仅为所选决策服务的端点主机。

主会话请求的 `state` SHALL 依次包含：
1. 固定首行 `Previous user-turn tier: none`。
2. 仅当所选预设 `context` 含 `execution` 时：固定行 `Execution: main conversation.`。
3. 上一轮上下文（存在时）：一行固定说明“上下文仅用于理解新消息，只判断新消息引出的工作”，随后 `Previous user message (truncated):` 加上一用户回合文本 `.slice(0, 500)`，以及 `Previous assistant reply (last part):` 加上一轮助手文本 `.slice(-1200)`（均为脱敏后截取）。不存在时省略对应段，两者都不存在时省略说明行。
4. `New user message:` 加本回合分类输入（无上一轮上下文时标签为 `User message:`）。
“上一轮”两段在 step 1 的 `agent/pre-step` 中、本回合消息进入之前，从 `agent.session.deriveMessages()` 取得：上一用户回合文本为最后一条 `source.kind === "user"` 的消息的 `text` 块按序以 `"\n"` 连接；助手段为最后一条含非空 `text` 块的 `assistant` 消息的文本块连接。子任务与预览工具的 `state` 为 `Previous user-turn tier: none`、（仅当所选预设 `context` 含 `execution` 时）固定行 `Execution: delegated subtask; the result returns to an orchestrating agent.`、`User message:` 加处理后的任务文本。`Execution` 行的取值只由调用路径（主会话或子任务/预览）决定，只陈述调用路径、不断言是否有人复核，不含任何会话内容，不属于“会话状态”。

外发的每段文本 SHALL 先对**完整文本**经同一函数 `redact` 处理，再截断。`redact` 依次替换（`i` 表示不区分大小写）：
1. `/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g` → `<redacted>`
2. `/\bBearer\s+[A-Za-z0-9._~+\/=-]{8,}/gi` → `Bearer <redacted>`
3. `/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g` → `<redacted>`
4. `/(密码|授权码|appid|password|passwd|token|api[_-]?key|secret)(["']?\s*[:：=]\s*["']?)[^\s"',;]+/gi` → 保留关键字与分隔符，值替换为 `<redacted>`
5. `/\/\/[^\s/:@]+:[^\s/@]+@/g` → `//<redacted>@`
6. `/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g` → `<ip>`
这是形态匹配，尽力而为，不保证移除所有敏感信息。

#### Scenario: 请求内容受限
- **GIVEN** 决策服务为缺省 OpenRouter，预设为缺省 `reasoning-depth`；上一轮用户文本为“修一下登录”，上一轮最后一条助手回复以“要我开始实施吗？”结尾，本回合分类输入为“继续”
- **WHEN** 主会话向 Jev 发起请求
- **THEN** 请求地址为 `https://openrouter.ai/api/alpha/decisions`，body 的 `model` 为 `typesafe/jev-1.13`，`questions` 只有键 `depth` 且与 `src/presets/reasoning-depth/rubric.json` 的 `depth` 深度相等；`state` 首行为 `Previous user-turn tier: none`，不含 `Execution:`，并依次含“修一下登录”“要我开始实施吗？”与 `New user message:\n继续`；`Authorization` 为 Bearer 凭据；失败后无第二次请求

#### Scenario: 上一轮上下文截断、取末段并脱敏
- **GIVEN** 会话历史中上一条用户消息 900 字；之后有两条助手消息，第一条为“早先内容”，最后一条 3000 字且结尾含 `token=abc123def456` 与 `10.1.2.3:8080`
- **WHEN** 构造 `state`
- **THEN** 上一轮用户段为脱敏后文本的前 500 字；助手段为最后一条助手消息脱敏后的末 1200 字，不含“早先内容”；`state` 不含 `abc123def456` 与 `10.1.2.3`，含 `token=<redacted>` 与 `<ip>`

#### Scenario: 脱敏覆盖常见形态且不误伤正文
- **GIVEN** 文本依次含 `{"API_KEY": "abc123"}`、`Token：xyz789`、`Authorization: Bearer abcdefgh12345`、`ghp_0123456789abcdefghijABCD`、`https://u:p@host/x`、`token 过期了怎么办`，以及一个 `sk-` 开头、长 40 字符且起始位置在末 1200 字边界之前 10 字符处的密钥
- **WHEN** 对该文本执行 `redact` 后取末 1200 字
- **THEN** 结果不含 `abc123`、`xyz789`、`abcdefgh12345`、`ghp_0123`、`u:p@` 与该密钥的任何 8 字以上片段；`token 过期了怎么办` 原样保留

#### Scenario: 首个用户回合不带上一轮上下文
- **GIVEN** 会话为 `AUTO`，预设为 `reasoning-depth`，没有上一用户回合
- **WHEN** 首个用户回合发送“看下这个报错”
- **THEN** `state` 恰为 `Previous user-turn tier: none\nUser message:\n看下这个报错`

#### Scenario: 启用 execution 的预设加入固定行
- **GIVEN** 设置 `preset` 为 `effort-as-verification`；会话为 `AUTO`，没有上一用户回合
- **WHEN** 首个用户回合发送“看下这个报错”，随后该会话经官方 fresh 子会话工具创建任务文本为“整理日志”的子任务，并以同一任务文本调用 `route_subagent`
- **THEN** 主会话 `state` 恰为 `Previous user-turn tier: none\nExecution: main conversation.\nUser message:\n看下这个报错`；子任务与预览工具的 `state` 都恰为 `Previous user-turn tier: none\nExecution: delegated subtask; the result returns to an orchestrating agent.\nUser message:\n整理日志`；三次请求的 `questions` 均取自 `effort-as-verification/rubric.json`

#### Scenario: 自主主任务不被断言为逐条复核
- **GIVEN** 设置 `preset` 为 `effort-as-verification`；用户在主会话发送“自主完成迁移，过程中不需要我复核”
- **WHEN** 主会话向 Jev 发起请求
- **THEN** `state` 第二行恰为 `Execution: main conversation.`；`state` 不含 `a user reads and steers each reply` 与 `no user in the loop`；分类输入原样保留在 `User message:` 之后

#### Scenario: 设置中的未知预设回落到缺省预设
- **GIVEN** 配置文件 `preset` 为 `does-not-exist`
- **WHEN** AUTO 主会话发起用户回合
- **THEN** Jev 请求的 `questions` 取自 `reasoning-depth`，`state` 不含 `Execution:`；会话不被停用

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
- **THEN** 不存在 `classify` 导出或关键词词表；出站 URL 主机只属于内置决策服务（`openrouter.ai`、`api.typesafe.ai`、`api.concentrate.ai`）与文档链接主机（含预设 `sources` 中的来源主机）；不出现 `node:http`、`node:https`、`node:child_process`

#### Scenario: 凭据从存储读取且换 key 立即生效
- **GIVEN** 启动环境中没有 `OPENROUTER_API_KEY`，credentials 存储中为 key A
- **WHEN** 发出一次 AUTO 判断，然后经设置页把 key 换成 B，再发出一次判断，再删除 key 后判断
- **THEN** 假 Jev 服务依次收到 `Bearer A`、`Bearer B`；第三次不发请求，会话以 `missing-credential` 停用；全程无需重启

#### Scenario: 期限按设置生效
- **GIVEN** 「Jev 期限」设为 1500，假 Jev 服务 2000ms 后才响应
- **WHEN** 发出一次 AUTO 判断
- **THEN** 约 1500ms 时以 `timeout` 停用；把期限改为 2500 后，下一次判断成功

### Requirement: 判档预设的采样与归属
每次 Jev 判断 SHALL 在判断开始时（主会话 step 1 的 pre-step、创建受管子任务的官方工具调用、`route_subagent` 调用、设置页测试连接）从当次设置读取一次 `preset` 并解析为预设对象（未注册的 id 解析为缺省预设）；该次判断的 `state`（是否含 `Execution` 行）、`questions`、choice 校验与主会话决策的预设归属 SHALL 都使用这个捕获值。判断进行中设置变更 MUST NOT 影响该次判断，也 MUST NOT 触发重判或重试；只影响之后开始的判断。受管子任务的预设在创建它的工具调用开始判断时捕获。非用户回合不重新判断，沿用上一用户回合的 depth 与预设归属。`route_subagent` 与随后 fresh 创建的子任务各自独立捕获，预览结果不约束后者。设置页测试连接 SHALL 使用所选预设的 questions，`state` 保持固定测试文本。

#### Scenario: 主判断进行中切换预设
- **GIVEN** 设置 `preset` 为 `reasoning-depth`，AUTO 主会话用户回合的 Jev 请求已发出、尚未返回
- **WHEN** 保存 `preset: "effort-as-verification"`，随后 Jev 返回 depth `higher`、回复完成并绑定，再开始下一用户回合
- **THEN** 第一次请求的 `questions` 等于 `reasoning-depth` 的 depth、`state` 不含 `Execution:`；该回合 Jev 请求数为 1；绑定快照 `preset` 为 `reasoning-depth`；下一回合请求的 `questions` 取自 `effort-as-verification`，`state` 含 `Execution: main conversation.`

#### Scenario: 子任务在创建后、首次判断前切换预设
- **GIVEN** 设置为 `effort-as-verification`，AUTO 主会话调用官方 fresh 子会话工具创建受管子任务，判断在该工具调用中进行
- **WHEN** 判断进行中把设置改为 `reasoning-depth`；子任务创建后、首个请求前再改回 `effort-as-verification`
- **THEN** 子任务的 Jev 请求恰 1 次，`questions` 取自 `effort-as-verification`，`state` 含 `Execution: delegated subtask; the result returns to an orchestrating agent.`；两次设置修改都不触发第二次请求，子会话 step 1 的 route 不变

#### Scenario: 预览进行中切换预设
- **GIVEN** 设置为 `reasoning-depth`，AUTO 主会话调用 `route_subagent`，凭据解析被测试挂起
- **WHEN** 挂起期间保存 `preset: "effort-as-verification"`，再释放凭据解析；之后再调用一次 `route_subagent`
- **THEN** 第一次调用的 Jev 请求恰 1 次，`questions` 取自 `reasoning-depth`、`state` 不含 `Execution:`；第二次调用的 `questions` 取自 `effort-as-verification`、`state` 含 `Execution: delegated subtask; the result returns to an orchestrating agent.`

#### Scenario: 预览与 fresh 子任务独立采样
- **GIVEN** 设置为 `reasoning-depth`，AUTO 主会话调用 `route_subagent`
- **WHEN** 预览返回后把设置改为 `effort-as-verification`，再以同一任务文本经官方 fresh 工具创建子任务
- **THEN** 预览的 Jev 请求使用 `reasoning-depth`，子任务的 Jev 请求使用 `effort-as-verification`；子任务路由不读取预览结果

#### Scenario: 非用户回合不重判
- **GIVEN** 上一用户回合按 `effort-as-verification` 判出 depth `higher` 并已应用
- **WHEN** 把设置改为 `reasoning-depth` 后，一个由子会话完成通知开启的回合发出首个请求并完成回复、回复被绑定
- **THEN** 该请求 effort 与上一回合相同，Jev 请求数不增加；该回复绑定快照的 `preset` 为 `effort-as-verification`，决策 id 与上一用户回合相同

#### Scenario: 测试连接使用所选预设
- **GIVEN** 设置为 `effort-as-verification`，测试连接的凭据解析被测试挂起
- **WHEN** 调用设置页测试连接端点，挂起期间保存 `preset: "reasoning-depth"`，再释放；之后再调用一次测试连接
- **THEN** 第一次假 Jev 服务收到的 `questions` 等于 `effort-as-verification` 的 rubric，`state` 等于固定测试文本，请求恰 1 次；第二次收到 `reasoning-depth` 的 rubric

## ADDED Requirements

### Requirement: 本步选择改写依赖运行体核验
主会话的本步 effort 改写依赖目标运行体的一个实现事实：`model.current()` 返回的可写对象原样经 `agent/pre-step` 的 `modelSelection` 传入本步请求准备，同一步的重试也复用该对象（0.2.2-rc.1 `dsh-agent-loop/lib/index.js:671、685、842`，`dsh-agent/lib/types/model-selection.js:82-85`）。该类型在声明上是 `Readonly`，所以这是兼容性依赖，不是官方承诺。

仓库 SHALL 有一项针对 `dshVersion` 精确运行体的集成测试：用真实 agent loop 跑一个 AUTO 主用户回合，断言 step 1 的请求头 effort 等于判断结果，且运行体未抛错。每次 DSH 升级 SHALL 重跑该测试。改写赋值抛错（对象被冻结）时，系统 SHALL 捕获并记录可诊断告警，本步按原选择发出；已同步到官方选择的值从下一步起生效；MUST NOT 让该步失败。

#### Scenario: 目标运行体上 step 1 即用新 effort
- **GIVEN** 目标运行体为 `dshVersion` 精确版本，AUTO 主会话当前选择为 medium，Jev 判出的目标为 high
- **WHEN** 集成测试用真实 agent loop 执行该用户回合
- **THEN** step 1 的请求头 effort 为 high，运行体未抛出 "use agent.model.select() before step preparation"

#### Scenario: 选择对象被冻结时退回下一步生效
- **GIVEN** 测试把 pre-step 的 `modelSelection` 替换为冻结对象，目标为 high、当前为 medium，官方 `selectModel` 成功
- **WHEN** 该用户回合执行两步
- **THEN** 记录一条可诊断告警；step 1 请求头为 medium，step 2 为 high；回合正常完成

#### Scenario: 运行体改为传递副本时测试失败
- **GIVEN** 目标运行体把 `modelSelection` 的副本而非本步使用的对象交给 pre-step
- **WHEN** 运行集成测试
- **THEN** 测试失败，失败信息指出 step 1 请求头 effort 与判断结果不一致
