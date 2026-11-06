## MODIFIED Requirements

### Requirement: AUTO 主 effort 同步官方选择
AUTO 主请求 SHALL 保持当前选择的 provider/model，按 depth 算法、实时支持与 effort cap 选 effort。选择的写入时机与方式如下：

- **预先校验**：判断完成时，系统 SHALL 以判断那一刻 `agent.model.current()` 的 provider/model 计算目标 effort，并完成与官方 `selectModel` 相同的校验（模型能力解析、调用配置可解析）。校验失败时 SHALL 记录可诊断告警，不写选择。
- **同步提交**：目标 effort 只在该回合首次领取（`agent/inbox/claimed`，见「用户回合与 Jev 输入」）的同步回调内，经 `agent.model.select()` 写入会话选择；与当前选择相同则不写。提交前 SHALL 重新核对 AUTO 模式与判断世代，并核对当前 provider/model 与预先校验时一致；任一不符则丢弃本次结果、不写选择。
- **全局默认**：会话选择写入后，系统 SHALL 以官方 `ctx.agentDefaultModel.saveSelection()` 在后台保存同一选择；保存失败只记录告警，不回滚会话选择，不停用 AUTO。

系统 MUST NOT 注册 `agent/request` 监听器。**行为变化（相对 0.2.1）**：effort 只在每个用户回合 step 1 之前设定一次；用户在回合中途经官方选择器修改模型或 effort 后，本回合剩余步骤使用用户所选值，下一个用户回合 AUTO 按当时选择的模型重新计算。MANUAL、无 effort 支持的模型 SHALL 不写选择，也不保存默认。

#### Scenario: 同次主请求同步官方 effort 与 defaults
- **GIVEN** AUTO 主会话空闲，当前选择为同一 provider/model 的 medium，模型支持 high，Jev 判出 depth higher
- **WHEN** 用户发送一条消息，该回合开始
- **THEN** `agent.model.select` 在该回合首次 `agent/inbox/claimed` 回调内恰好被调用一次，参数为同 provider/model 的 high；step 1 的 `modelSelection` 与请求头 effort 均为 high；`ctx.agentDefaultModel.saveSelection` 以同一选择被调用一次；运行体没有抛出 "use agent.model.select() before step preparation"

#### Scenario: 同步失败不丢本次请求
- **GIVEN** 当前选择为 medium，AUTO 目标为 high；分别为：(a) 预先校验时调用配置解析失败；(b) `saveSelection` 被拒绝
- **WHEN** 该回合的主请求执行
- **THEN** (a) 记录告警，`agent.model.select` 调用次数为 0，请求为 medium，决策不标 applied；(b) 记录告警，请求为 high，决策按请求头标 applied；两种情况都不停用 AUTO，回合正常完成

#### Scenario: 手动与子请求不污染默认
- **GIVEN** 分别为：MANUAL 主会话；目标 effort 与当前选择相同的 AUTO 主会话；已精确绑定的 child 的后续回合
- **WHEN** 对应回合开始
- **THEN** 三种情况下 `saveSelection` 调用次数均为 0；前两种 `agent.model.select` 调用次数为 0；child 保持既定 route

#### Scenario: 异步解析期间切 MANUAL 不覆盖主请求
- **GIVEN** AUTO 主会话的判断或预先校验仍在进行
- **WHEN** 会话切为 MANUAL 之后，判断才结束，该回合随后被领取
- **THEN** `agent.model.select` 与 `saveSelection` 调用次数均为 0；step 1 使用切换前的选择

#### Scenario: 回合中途手动切换保持到本回合结束
- **GIVEN** AUTO 主会话回合 T 已按 depth higher 设为 high，step 1 已完成
- **WHEN** 用户在 step 2 前经官方选择器把 effort 改为 low，T 继续执行 step 2、3，随后用户发起回合 T+1，Jev 再判出 depth higher
- **THEN** T 的 step 2、3 的请求头 effort 为 low，T 内 `agent.model.select` 无 AUTO 调用；T+1 step 1 的 effort 为 high

### Requirement: 用户回合与 Jev 输入
系统 SHALL 在回合 step 准备之前完成判断，并把结果绑定到具体消息：

- **触发**：`agent/inbox/inserted` 收到一条 `source.kind` 严格等于 `"user"` 的实时插入消息。其它来源（含 `agent-instructions`、`plugin`、`plugin:<id>`、`runtime-context`、`time-context`、`skill-catalog`）与缺失 `source` 的消息 MUST NOT 触发判断，也 MUST NOT 贡献输入。
- **空闲时**：监听器 SHALL 在同步回调内调用官方 `agent.runMaintenance()`，在维护任务中等待 Jev 并缓存结果；运行体在维护任务结束后才开始回合，因此结果在领取前已就绪。
- **运行中**：`runMaintenance` 同步抛错时（会话已有活动工作），只有插入到 next-turn 队列的消息才启动不阻塞回合的后台判断；插入 next-step 队列的消息属于当前回合，不判断。
- **绑定与提交**：结果以 (agent, 消息 id) 缓存。回合首次 `agent/inbox/claimed` 领取到一条有缓存结果的消息时，按「AUTO 主 effort 同步官方选择」（子会话按「AUTO 决策与执行」）同步提交。领取时结果尚未就绪，则本回合不改选择、沿用当前选择，迟到的结果丢弃，MUST NOT 应用到其它回合。消息被丢弃（`agent/inbox/discarded`）时 SHALL 中止其判断并删除缓存。只领取 next-step 消息的续步（同一回合继续）MUST NOT 提交任何缓存结果。

分类输入是被绑定那条消息的 `text` 块按块顺序以 `"\n"` 连接，经 `redact` 后取 `.slice(0, 8000)`；非文本块不贡献。官方普通 followup 独占自己的回合，每条 followup 的判断只用它自己的文本。

决定 SHALL 按 (agent, 回合) 保存，同回合后续请求（含同 turn/step 的错误重试）复用该决定。没有绑定判断的回合不是用户回合，不请求 Jev，沿用当前选择。

取消：调用方取消（会话 cancel 或消息被丢弃）SHALL 中止 Jev 请求，不应用结果、不停用 AUTO、不写 `disabled`，下一用户回合重新判断。超过「Jev 期限」或 Jev 失败按「Jev 失败即停用并提示」处理。维护任务 MUST NOT 以未处理异常结束。

`origin = "subagent"` 的会话 MUST NOT 走主会话判断，其路由只按「AUTO 决策与执行」处理；子会话的判断输入是绑定到它首条 user 消息的文本。

#### Scenario: 空闲入口在回合开始前完成判断
- **GIVEN** AUTO 主会话空闲
- **WHEN** 一条 `user` 消息“修复登录 bug”入队
- **THEN** Jev 请求恰好 1 次，分类输入为“修复登录 bug”；Jev 返回之前，该回合不产生 `step/start` 事件

#### Scenario: 步骤被拒时不请求 Jev
- **GIVEN** 会话为 `AUTO`，空闲入口已为消息 m 完成判断；下游 pre-step listener 对 m 所在回合的 step 1 返回 `{kind: reject}`
- **WHEN** 该回合以 blocked 结束
- **THEN** 该回合内 Jev 请求次数为 1（只有入口那一次）；pre-step 被拒不触发额外 Jev 请求，也不撤销已提交的选择

#### Scenario: 首轮真实领取序列只取用户消息
- **GIVEN** 会话空闲时依次实时插入 `agent-instructions`（文本 A）、`plugin:dsh-memex`（文本 B）、`runtime-context`（文本 C）、`skill-catalog`（文本 D）、`user`（文本“修复登录 bug”）
- **WHEN** 构造分类输入
- **THEN** Jev 请求恰好 1 次，分类输入恰为“修复登录 bug”

#### Scenario: 多条用户消息按序拼接并截断
- **GIVEN** 一条 `user` 消息含文本块“先看日志”、一个图片块、文本块“再改配置”；另有一条无 `source` 的消息（文本 X）
- **WHEN** 构造分类输入
- **THEN** 分类输入恰为“先看日志\n再改配置”；拼接结果长度超过 8000 时，等于其 `.slice(0, 8000)`；无 `source` 的消息不触发 Jev

#### Scenario: 两条排队 followup 分属两个回合
- **GIVEN** 回合 T 运行中，用户先后发送 followup A（判出 lower）与 B（判出 higher），两者都在 next-turn 队列
- **WHEN** T 结束后运行体依次开始回合 T+1、T+2
- **THEN** A 的分类输入只含 A 的文本，B 的只含 B 的文本；T+1 领取 A、step 1 effort 为 lower 对应值；T+2 领取 B、step 1 effort 为 higher 对应值

#### Scenario: 当前回合被续步时不提前切换
- **GIVEN** 回合 T 以 low 运行，followup B 已在 next-turn 且判断已就绪（high）；T 的停止边界上另一个 listener 注入一条 next-step 消息
- **WHEN** T 继续执行下一步
- **THEN** T 后续步骤的 `modelSelection` 仍为 low，`agent.model.select` 无 AUTO 调用；B 的回合 step 1 才为 high

#### Scenario: 晚到 followup 在其回合领取时应用
- **GIVEN** 回合 T 运行中且停止边界的 listener 正在 await，此时 followup B 入队，判断在 B 被领取前就绪
- **WHEN** 运行体不经空闲直接开始 B 的回合
- **THEN** B 的回合 step 1 的 `modelSelection` 为 B 的判断结果；Jev 请求次数为 1

#### Scenario: 判断未就绪时本回合不改选择
- **GIVEN** 运行中入队的 followup B 的后台判断尚未返回
- **WHEN** 运行体领取 B 并开始其回合，随后判断返回 high
- **THEN** B 的回合全部步骤使用领取时的选择；迟到的结果被丢弃，之后回合的 `agent.model.select` 无 AUTO 调用

#### Scenario: 同回合与重试复用决定
- **GIVEN** 用户回合 T 的首个请求已按 depth `higher` 输出 effort `high`
- **WHEN** 回合 T 内第 2 至第 5 个请求到达，其中一次是同 (turn, step) 的错误重试
- **THEN** 这些请求的 effort 都是 `high`；回合 T 内 Jev 请求次数为 1

#### Scenario: 非用户回合沿用上一 depth
- **GIVEN** 上一用户回合已把选择设为 `claude-opus-5-5` / `high`，会话为 `AUTO`
- **WHEN** 由子会话完成通知开启的回合发出首个请求
- **THEN** 该请求 effort 为 `high`，Jev 请求次数不增加，`agent.model.select` 无 AUTO 调用

#### Scenario: 取消中止判断
- **GIVEN** 空闲入口的维护任务正在等待 Jev
- **WHEN** 用户取消会话
- **THEN** 传给 Jev 的 signal 已 aborted；`agent.model.select` 调用次数为 0；会话模式仍为 `AUTO` 且未写 `disabled`；维护任务 resolve；下一条 user 消息再次请求 Jev

#### Scenario: 子会话不走主会话判断
- **GIVEN** 父会话为 `AUTO`，经官方 fresh 子会话工具创建的子会话首条进入消息含注入的非 user 指令与 user 文本“整理日志”
- **WHEN** 子会话首次请求前进行判断
- **THEN** 发往 Jev 的子任务 `state` 只含“整理日志”，不含注入的指令文本；父会话本回合的决定和 Jev 请求次数都不变

### Requirement: AUTO 决策与执行
主会话 SHALL 只判断 depth=lower/baseline/higher，在模型支持序列中以所属家族策略的推荐起点最多移动一档，不修改 provider/model，按「AUTO 主 effort 同步官方选择」写入。子任务 SHALL 只在「AUTO 受管子会话范围」内路由：独立判断 capability=bounded/analytical/frontier 或 insufficient_context，按「子任务路由退化链」确定 route，保留显式模型/effort，完全显式时不调用 Jev。

受管子会话的判断走「用户回合与 Jev 输入」的同一入口（子会话首条 user 消息在其空闲时入队），route 在其首次领取时经子会话自身的 `agent.model.select()` 同步写入；MUST NOT 保存全局默认。受管子会话 SHALL 按精确 child ID 绑定并持久化，实际请求头匹配 route 后标 applied；恢复时不重判，已持久的选择即为 route。

实时门禁（cap、允许列表、目录）SHALL 在受管子会话每一步的 `agent/pre-step` 中、对 payload 的 `modelSelection` 重新核验；不通过时 SHALL 抛出可诊断错误，使该步在请求发出前失败，MUST NOT 改为其它 route。fork 不属于受管范围，SHALL 与父会话保持一致、原样放行，MUST NOT 报错，也不得悄悄改为 fresh。Agent 保留编排和验收权，不实现自主重试升级。

#### Scenario: Magpie 自动子路由
- **WHEN** Magpie GPT 主会话为 AUTO，并创建 bounded 子任务
- **THEN** 从允许列表和实时目录验证同 transport 的 codex/gpt-6-luna 及其支持的 effort，持久绑定精确 child；子会话 step 1 的 `modelSelection` 等于该 route；不得转到本地入口

#### Scenario: 未登记 provider 的 GPT 主会话可以派子任务
- **GIVEN** 根会话为 `AUTO`，provider `traex`，模型 `GPT-5.6-Sol`
- **WHEN** 经官方 `subagent` 工具创建子会话（不传 provider/model/effort）
- **THEN** 工具执行不抛错；子会话受管，记录的 `explicit.provider` 为 `traex`、`family` 为 `codex`；首个请求的 provider 为 `traex`

#### Scenario: 子路由不写官方默认
- **GIVEN** AUTO 根会话创建一个受管子任务，判出 route `claude` / `claude-haiku-5-5` / `medium`
- **WHEN** 子会话开始 step 1
- **THEN** 子会话 `agent.model.select` 恰好被调用一次，参数为该 route；`saveSelection` 调用次数为 0；插件没有注册 `agent/request` 监听器

#### Scenario: 实时门禁失效时暂停子请求
- **GIVEN** 受管子会话 C 已应用 high route，之后 effort cap 降为 medium
- **WHEN** C 的下一步准备发出请求
- **THEN** 该步的 `agent/pre-step` 抛出可诊断错误；没有向 provider 发出请求；C 的选择仍为 high，不被改写
