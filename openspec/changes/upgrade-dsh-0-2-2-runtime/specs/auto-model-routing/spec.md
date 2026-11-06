## MODIFIED Requirements

### Requirement: 手动隔离与失败可见
MANUAL SHALL 不触发新判断或主请求覆盖；此前绑定的子实例 SHALL 恢复既定路由。输入 SHALL 仅使用官方 user 来源并脱敏限长。主判断失败 SHALL 可见停用 AUTO；子任务路由不可用或子任务判断失败 SHALL 按「子任务路由退化链」不改写并可见告警，MUST NOT 换 provider 或改用能力槽以外的模型。provider SHALL 保留完整 ID；未知能力家族保持父模型只调 effort，未知推荐 effort 不猜。OpenRouter只用于Jev。性能与成本缺少证据 SHALL 标未知。

#### Scenario: AUTO 不改主 provider/model
- **WHEN** AUTO 调整主 effort
- **THEN** 请求按支持范围生效，主 provider/model 保持；effort 变化时只以同 provider/model 经 `agent.model.select` 写入会话选择，并经 `ctx.agentDefaultModel.saveSelection` 保存默认

#### Scenario: 子失败不换模且可见
- **GIVEN** 根会话为 `AUTO`，受管子任务 Jev 超时
- **WHEN** 子会话发出首个请求
- **THEN** 请求与官方合成配置深度相等（未换 provider/model）；根会话状态含 `childNotice.reason = "jev-timeout"`

### Requirement: AUTO 主 effort 同步官方选择
AUTO 主会话 SHALL 保持当前选择的 provider/model，按 depth 算法、实时支持与 effort cap 选 effort。写入分三步：

- **预先校验**（判断阶段，可异步）：以判断开始时 `agent.model.current()` 的 provider/model 解析模型能力（支持的 effort 序列与默认 effort），并完成与官方 `selectModel` 等价的校验：目录成员身份（与官方 `requireModel` 相同，经 provider/model 目录列举确认）以及调用配置可解析（`resolveCallConfig`）。校验失败 SHALL 记录可诊断告警，不缓存可提交结果。缓存内容为 depth、上述 provider/model 与模型能力，不缓存最终 effort。
- **同步提交**（领取时）：只在「用户回合与 Jev 输入」规定的提交点，以提交时读取的设置中 effort cap 与缓存的模型能力同步计算 effort，并经 `agent.model.select()` 写入会话选择；计算结果与当前选择相同则不写。提交前 SHALL 同步核对 AUTO 模式、判断世代，以及当前 provider/model 与缓存一致；任一不符则丢弃本次结果。计算无法得出 effort 时按无 effort 支持处理，不写选择。
- **全局默认**：会话选择写入后，系统 SHALL 以官方公开服务 `ctx.agentDefaultModel.saveSelection()` 在后台保存同一选择；保存失败只记录告警，不回滚会话选择，不停用 AUTO。

系统 MUST NOT 注册 `agent/request` 监听器。**行为变化（相对 0.2.1）**：effort 每个用户回合在 step 1 之前设定一次；用户在回合中途经官方选择器修改模型或 effort 后，本回合剩余步骤使用用户所选值，下一个用户回合 AUTO 按当时选择的模型与 cap 重新计算。MANUAL、无 effort 支持的模型 SHALL 不写选择，也不保存默认。

#### Scenario: 同次主请求同步官方 effort 与 defaults
- **GIVEN** AUTO 主会话空闲，当前选择为同一 provider/model 的 medium，模型支持 high，cap 为 xhigh，Jev 判出 depth higher
- **WHEN** 用户发送一条消息，该回合开始
- **THEN** `agent.model.select` 在该回合第一次 `agent/inbox/claimed` 回调内恰好被调用一次，参数为同 provider/model 的 high；step 1 的 `modelSelection` 与请求头 effort 均为 high；`ctx.agentDefaultModel.saveSelection` 以同一选择被调用一次；运行体没有抛出 "use agent.model.select() before step preparation"

#### Scenario: 同步失败不丢本次请求
- **GIVEN** 当前选择为 medium，AUTO 目标为 high；分别为：(a) 预先校验时调用配置解析失败；(b) 预先校验时该模型已不在官方目录中；(c) `saveSelection` 被拒绝
- **WHEN** 该回合的主请求执行
- **THEN** (a)(b) 记录告警，`agent.model.select` 调用次数为 0，请求为 medium，决策不标 applied；(c) 记录告警，请求为 high，决策按请求头标 applied；三种情况都不停用 AUTO，回合正常完成

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

#### Scenario: 判断后降低 cap 在提交时生效
- **GIVEN** 运行中回合 T 的停止边界已为排队消息 B 判出 depth higher（当时 cap 为 xhigh，按此可得 high），B 尚未被领取
- **WHEN** 用户把 cap 改为 medium，随后 B 的回合开始
- **THEN** 提交时按 cap medium 计算，`agent.model.select` 写入的 effort 不高于 medium，`saveSelection` 保存同一值；Jev 请求次数不增加

### Requirement: 用户回合与 Jev 输入
系统 SHALL 在回合开始前完成判断，并把结果绑定到该回合第一次领取的那批消息。

**用户消息与批次**：用户消息指 `source.kind` 严格等于 `"user"` 的消息；其它来源（含 `agent-instructions`、`plugin`、`plugin:<id>`、`runtime-context`、`time-context`、`skill-catalog`）与缺失 `source` 的消息 MUST NOT 贡献输入。**批次**指运行体开启新回合时一次领取的消息：next-step 队列全部，加 next-turn 队首一条。批次的**用户消息键**为其中用户消息按领取顺序排列的 id 列表。批次不含用户消息的回合不是用户回合：不请求 Jev，沿用当前选择。分类输入为批次中用户消息按领取顺序、消息内按块顺序的 `text` 块文本，以 `"\n"` 连接，经 `redact` 后取 `.slice(0, 8000)`；非文本块不贡献。

**判断入口**（只计算并缓存，不写选择）：
1. **空闲入口**：任一实时插入（`agent/inbox/inserted`）发生后，若队列中存在尚无有效缓存的用户消息，监听器 SHALL 在同步回调内调用 `agent.runMaintenance()`，在维护任务中判断「预测批次」，即按当时队列预测的下一批次。Jev 返回后 SHALL 重新预测；批次已变化时，在同一个「Jev 期限」预算内重新判断，预算用尽则不缓存。会话恢复后残留的、或此前取消后残留的待处理用户消息，因此会在下一次插入唤醒时判断。
2. **停止边界入口**：运行中回合 T 到达 `agent/turn-stopping` 时，若 next-turn 队首是尚无有效缓存的用户消息，AUTO 监听器 SHALL 以该 payload 的 signal 判断由它组成的批次，并 await 判断结束后才返回（只计算，不提交）。T 若随后被续步并再次到达停止边界，上下文已变化，SHALL 按新上下文重新判断。
3. **晚到入口**：插入时 `runMaintenance` 同步抛错（会话正在运行，或维护被其它插件占用），且停止边界入口不会再覆盖该消息时，系统 SHALL 立即为该消息所属的预测批次启动不阻塞的后台判断。

插入事件只带消息本身；系统 SHALL 在同步回调中按消息 id 查询 `agent.inbox.nextStep` / `nextTurn` 确定其队列，MUST NOT 从公开 status 推断（维护阶段的公开 status 也是 idle）。

**缓存键**：(agent, 用户消息键, 上下文指纹, 模式世代)。上下文指纹为判断开始时「上一轮」两段所取消息的 seq。

**提交**：每个回合第一次 `agent/inbox/claimed` 回调中，系统 SHALL 用回调前记录的待处理消息与回调时队列之差求出本次领取的批次。只有当批次的用户消息键与某条已就绪缓存完全一致、且上下文指纹未变时才提交：主会话按「AUTO 主 effort 同步官方选择」，子会话按「AUTO 决策与执行」。同一回合后续的领取（续步）MUST NOT 提交。没有匹配的就绪缓存时，本回合不改选择；在批次被领取之后才返回的结果一律丢弃，MUST NOT 用于其它回合。

决定 SHALL 按 (agent, 回合) 保存，同回合后续请求（含同 turn/step 的错误重试）复用该决定。

**取消与清理**：
- 官方取消（`sessionController.cancel` → `agent.cancel({kind: "user"}, {keepInbox: true})`）中止空闲入口的维护任务时，系统 SHALL 中止 Jev、不缓存结果，并把预测批次中的消息标为「已取消」；维护任务正常 resolve。之后运行体领取到含「已取消」消息的批次时，AUTO 的 `agent/pre-step` 监听器（最外层，以 prepend 注册）SHALL 不调用下游，直接返回 `{kind: "reject"}`。这样该批消息不进入模型，回合以 blocked 结束；队列中其余消息保留，且不被自动执行。cause 为 `disposed` 时运行体不再唤醒，不需要标记。
- 停止边界入口的判断随回合 T 的 signal 中止，不缓存；留在队列中的消息由之后的空闲入口判断。
- 晚到入口的后台判断各自持有中止控制，在该消息被丢弃（`agent/inbox/discarded`）、会话 dispose 或模式切换时中止。
- 判断在其批次已被领取、消息已被丢弃或会话已 dispose 之后才返回的，无论成功还是失败，SHALL 丢弃，不写决定、不写 `disabled`，只记日志。批次仍待领取时返回的 Jev 失败或超时，按「Jev 失败即停用并提示」处理。调用方取消 MUST NOT 停用 AUTO，MUST NOT 写 `disabled`。会话 dispose 之后 MUST NOT 再有 `agent.model.select`、`saveSelection` 或状态写入。维护任务 MUST NOT 以未处理异常结束。

**已知时序缺口（显式行为变化）**：用户消息在 AUTO 的停止边界监听已返回、而运行体尚未开始其回合时插入（其它 `agent/turn-stopping` 监听仍在 await），0.2.2 在这段时间没有可等待的接缝。该回合若后台判断尚未就绪，就沿用当前选择，并在状态中记 `reason: "judgment-late"`。

`origin = "subagent"` 的会话 MUST NOT 走主会话判断，其路由只按「AUTO 决策与执行」处理；子会话判断输入取自其首个批次中的用户消息。

#### Scenario: 空闲入口在回合开始前完成判断
- **GIVEN** AUTO 主会话空闲，队列为空
- **WHEN** 一条 `user` 消息“修复登录 bug”入队
- **THEN** Jev 请求恰好 1 次，分类输入为“修复登录 bug”；Jev 返回之前该回合不产生 `step/start` 事件；该回合 step 1 的 `modelSelection` 为判断结果

#### Scenario: 步骤被拒时不请求 Jev
- **GIVEN** 会话为 `AUTO`，空闲入口已为消息 m 的批次完成判断并在领取时提交；下游 pre-step listener 对该回合 step 1 返回 `{kind: reject}`
- **WHEN** 该回合以 blocked 结束
- **THEN** 该回合内 Jev 请求次数为 1（只有入口那一次）；pre-step 被拒不触发额外 Jev 请求，也不撤销已提交的选择

#### Scenario: 首轮真实领取序列只取用户消息
- **GIVEN** 会话空闲时，同一批次依次含 `agent-instructions`（文本 A）、`plugin:dsh-memex`（文本 B）、`runtime-context`（文本 C）、`skill-catalog`（文本 D）、`user`（文本“修复登录 bug”）
- **WHEN** 构造分类输入
- **THEN** Jev 请求恰好 1 次，分类输入恰为“修复登录 bug”

#### Scenario: 多条用户消息按序拼接并截断
- **GIVEN** 会话空闲时，next-step 队列依次有两条 `user` 消息：第一条文本“先看日志”，第二条含文本“再改配置”和一个图片块；另有一条无 `source` 的消息（文本 X）；next-turn 队列为空
- **WHEN** 一次插入唤醒会话，构造该批次的分类输入
- **THEN** Jev 请求恰好 1 次，分类输入恰为“先看日志\n再改配置”；拼接结果长度超过 8000 时，等于其 `.slice(0, 8000)`；回合第一次领取的用户消息键等于这两条消息的 id，提交 1 次

#### Scenario: 两条排队 followup 分属两个回合
- **GIVEN** 回合 T 运行中，用户先后发送 followup A（判出 lower）与 B（判出 higher），两者都在 next-turn 队列；A、B 的判断都在各自被领取前就绪，期间 provider/model 与 cap 不变
- **WHEN** T 结束后运行体依次开始回合 T+1、T+2
- **THEN** A 的分类输入只含 A 的文本，B 的只含 B 的文本；T+1 领取 A，step 1 为 lower 对应的 effort；T+2 领取 B，step 1 为 higher 对应的 effort

#### Scenario: 当前回合被续步时不提前切换
- **GIVEN** 回合 T 以 low 运行，followup B 在 next-turn，停止边界入口已为 B 判出 high；之后另一个停止边界 listener 注入一条 next-step 消息
- **WHEN** T 继续执行下一步
- **THEN** T 后续步骤的 `modelSelection` 仍为 low，`agent.model.select` 无 AUTO 调用；B 的回合 step 1 才为 high

#### Scenario: 续步后上下文变化重新判断
- **GIVEN** 同上，T 续步后又产生了新的 assistant 文本，再次到达停止边界
- **WHEN** AUTO 停止边界 listener 再次运行
- **THEN** 为 B 发出第二次 Jev 请求，其 `state` 的上一轮助手段取自新文本；B 的回合按第二次结果提交，第一次结果不被提交

#### Scenario: 晚到 followup
- **GIVEN** 回合 T 运行中，AUTO 停止边界 listener 已返回，另一个停止边界 listener 正在 await；此时 followup B 入队，`runMaintenance` 同步抛错
- **WHEN** 运行体不经空闲直接开始 B 的回合；分别为：(a) B 的后台判断在领取前就绪；(b) 判断在领取后才返回 high
- **THEN** (a) B 的回合 step 1 为判断结果；(b) B 的回合全部步骤使用领取时的选择，状态 `reason` 为 `judgment-late`，迟到结果被丢弃，之后回合的 `agent.model.select` 无 AUTO 调用；两种情况的 Jev 请求次数都为 1

#### Scenario: 恢复后的待处理消息在下一次唤醒时判断
- **GIVEN** AUTO 主会话有未领取的 followup A，Host 在判断后、领取前退出
- **WHEN** 重启恢复后插入新消息 B 唤醒会话
- **THEN** 维护任务先判断预测批次 [A]（分类输入为 A 的文本），A 的回合 step 1 为 A 的判断结果；B 由 A 回合的停止边界入口判断，B 的回合使用 B 的判断结果；恢复本身不发起 Jev 请求

#### Scenario: 取消正在判断的空闲回合
- **GIVEN** AUTO 主会话空闲，队列中已有一条残留 followup B；用户发送 A 使空闲入口进入维护，预测批次为 [B]，Jev 尚未返回
- **WHEN** 用户经官方 `sessionController.cancel` 取消
- **THEN** 传给 Jev 的 signal 已 aborted；维护任务 resolve；随后被领取的批次被 AUTO pre-step 拒绝，provider 请求次数为 0，回合以 blocked 结束；A 仍在队列，未被自动执行；`agent.model.select` 调用次数为 0；会话模式仍为 `AUTO` 且未写 `disabled`；下一次插入唤醒时为 [A] 再次请求 Jev

#### Scenario: 取消运行中回合不影响排队消息的后续判断
- **GIVEN** 回合 T 运行中，B 在 next-turn，停止边界入口正在为 B 等待 Jev
- **WHEN** 用户经官方 `sessionController.cancel` 取消 T
- **THEN** B 的判断随 T 的 signal 中止，不缓存，不写 `disabled`；B 留在队列且未被自动执行；下一次插入唤醒时空闲入口为 [B] 请求 Jev

#### Scenario: 迟到结果被丢弃
- **GIVEN** 晚到入口为 B 启动了后台判断，B 已被领取或已被丢弃，或会话已 dispose
- **WHEN** 判断随后分别以成功和 HTTP 402 失败返回
- **THEN** 两种情况都不写决定、不写 `disabled`、不调用 `agent.model.select` 或 `saveSelection`，只记日志

#### Scenario: 维护被其它插件占用
- **GIVEN** 会话公开 status 为 idle，但另一个插件持有维护阶段；此时插入一条 user steer（落入 next-step）
- **WHEN** `runMaintenance` 同步抛错，插件维护结束后会话以该消息开启新回合
- **THEN** 晚到入口为该消息所属的预测批次启动后台判断；判断在领取前就绪时提交，否则按 `judgment-late` 沿用当前选择；任何情况下都没有未处理异常

#### Scenario: 同回合与重试复用决定
- **GIVEN** 用户回合 T 的首个请求已按 depth `higher` 输出 effort `high`
- **WHEN** 回合 T 内第 2 至第 5 个请求到达，其中一次是同 (turn, step) 的错误重试
- **THEN** 这些请求的 effort 都是 `high`；回合 T 内 Jev 请求次数为 1

#### Scenario: 非用户回合沿用上一 depth
- **GIVEN** 上一用户回合已把选择设为 `claude-opus-5-5` / `high`，会话为 `AUTO`
- **WHEN** 由子会话完成通知开启的回合发出首个请求
- **THEN** 该请求 effort 为 `high`，Jev 请求次数不增加，`agent.model.select` 无 AUTO 调用

#### Scenario: 子会话不走主会话判断
- **GIVEN** 父会话为 `AUTO`，经官方 fresh 子会话工具创建的子会话首个批次含注入的非 user 指令与 user 文本“整理日志”
- **WHEN** 子会话首次请求前进行判断
- **THEN** 发往 Jev 的子任务 `state` 只含“整理日志”，不含注入的指令文本；父会话本回合的决定和 Jev 请求次数都不变

### Requirement: AUTO 决策与执行
主会话 SHALL 只判断 depth=lower/baseline/higher，在模型支持序列中以所属家族策略的推荐起点最多移动一档，不修改 provider/model，按「AUTO 主 effort 同步官方选择」写入。子任务 SHALL 只在「AUTO 受管子会话范围」内路由：独立判断 capability=bounded/analytical/frontier 或 insufficient_context，按「子任务路由退化链」确定 route，保留显式模型/effort，完全显式时不调用 Jev。

受管子会话的判断走「用户回合与 Jev 输入」的空闲入口（官方 fresh 子会话的首条消息在创建返回后以 followup 投递，此时子会话空闲）。route 在其第一次领取时经子会话自身的 `agent.model.select()` 同步写入；提交时 SHALL 按提交时的 cap 同步核对 route 的 effort，超过时不写入，按退化链「不改写并告警」处理。子会话 MUST NOT 保存全局默认。受管子会话 SHALL 按精确 child ID 绑定并持久化，实际请求头匹配 route 后标 applied；恢复时不重判，已持久的选择即为 route。

实时门禁 SHALL 在每一次实际模型调用时执行，包括同一步内的错误重试：系统 SHALL 注册 `llm/stream` 监听器，对 `isAgentLoopRequest` 为真、且 `sessionId` 属于已有 route 的受管子会话的请求，在调用 `next()` 之前核验精确绑定（记录完整性、parent 身份）、请求的 provider/model/effort 与 route 一致，以及当前目录、允许列表、存在时的父 captured allowlist 与 effort cap。核验不通过时 SHALL 抛出可诊断错误，使该次调用不到达 adapter；监听器 MUST NOT 改写请求或 route。fork 不属于受管范围，SHALL 与父会话保持一致、原样放行，MUST NOT 报错，也不得悄悄改为 fresh。Agent 保留编排和验收权，不实现自主重试升级。

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
- **THEN** `llm/stream` 监听器抛出可诊断错误；adapter 调用次数为 0；C 的选择仍为 high，不被改写

#### Scenario: 同一步重试前门禁失效
- **GIVEN** 受管子会话 C 的 high route 首次请求通过门禁，provider 返回可重试错误，`agent/request-error` 返回 retry
- **WHEN** 重试前 cap 降为 medium（或允许列表撤销该目标、目录不可用）
- **THEN** 第二次调用在 `llm/stream` 监听器中被拒绝，第二次 adapter 调用次数为 0；route 与 C 的选择不变

#### Scenario: 提交时 route 已超过 cap
- **GIVEN** 子任务判断完成时 route 为 high，首次领取前 cap 降为 medium
- **WHEN** 子会话第一次领取
- **THEN** `agent.model.select` 无 AUTO 调用；按退化链记「不改写并告警」；子会话请求不使用 high

### Requirement: 模式与改写规则
系统 SHALL 为每个主会话提供 `AUTO` 与 `MANUAL` 两种模式，按会话持久化。新建普通会话的初始模式 SHALL 取设置项「新会话默认模式」（`MANUAL` | `AUTO`，缺省 `MANUAL`）：仅当普通会话以全新方式创建（不是恢复、清空、压缩或子会话）且其默认主模型受支持时，系统 SHALL 按创建时刻的设置值写入该会话的模式；此后修改设置 MUST NOT 改变已有会话的模式。没有状态记录的已有会话 SHALL 视为 `MANUAL`。默认模式为 `AUTO` 时新会话的行为与用户手动切到 `AUTO` 相同（含 Jev 失败即停用）。
- **AUTO**：系统 SHALL 只设定主会话的 reasoning effort，MUST NOT 改动 provider 与 model。depth 每个用户回合判断一次；effort 在该回合 step 1 之前，按提交时选择的模型与 cap 计算并写入一次（见「用户回合与 Jev 输入」「AUTO 主 effort 同步官方选择」）。同一回合的后续步骤 MUST NOT 再写入；用户在回合中途手动修改的值保持到本回合结束。
- **MANUAL**：系统 MUST NOT 改写任何字段，也 MUST NOT 把 effort 写回任何先前的值。切到 MANUAL 只是停止自动调整；此后请求使用官方当前选择，由用户在官方模型选择器中自行调整。
切 MANUAL SHALL 废止尚未提交的判断，当前回合后续步骤不再写入。再次切 AUTO 只能在下一用户回合开始前重新判断，此前 MUST NOT 恢复旧 AUTO 决定。重复设置相同模式 SHALL 为无副作用操作。插件不保存锚点、不维护复原义务；未加载时不请求 Jev、不改写。

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
- **THEN** 本回合第一次领取时 `agent.model.select` 恰被调用一次，参数为 `{provider: claude, model: claude-opus-5-5, reasoningEffort: high}`，`ctx.agentDefaultModel.saveSelection` 以同一选择恰被调用一次；第二个请求前两者都不再调用；官方当前选择已为 `high` 时两者都不调用

#### Scenario: AUTO 判档覆盖待生效手选
- **GIVEN** 会话为 `AUTO`，用户在 AUTO 期间手选 `medium`（官方待生效手选），主模型 `claude-opus-5-5`
- **WHEN** 下一回合 Jev depth 为 `higher`，随后切 MANUAL 并发出请求
- **THEN** 官方选择被更新为 `high`；切 MANUAL 后的请求与官方合成配置深度相等，effort 为 `high`

#### Scenario: 快速切回 AUTO 不恢复旧决定
- **GIVEN** 当前回合 AUTO 已决定 `high`；测试注入官方合成 `medium`
- **WHEN** 切 MANUAL 后再切 AUTO，并继续当前回合请求
- **THEN** 当前回合请求与官方合成配置深度相等；下一用户回合开始前重新请求 Jev，并按其结果在领取时写入

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

### Requirement: Jev 判断请求与脱敏
系统 SHALL 为 AUTO 主会话每个用户回合的批次与每个受管子任务的首个批次，在其被领取前，按「用户回合与 Jev 输入」的入口以 Jev 决策请求得出判断（通常各一次；只有该要求规定的批次变化或上下文变化才会重判，每次重判都是独立的一次请求）：请求发往设置中所选决策服务的端点与模型（见 auto-decision-services-feedback），凭据按该服务的固定引用在每次调用时经官方 credentials 服务解析（credentials 服务不存在时经官方 launch environment 读取），未解析到值时为 `missing-credential`；单次期限取设置项「Jev 期限」（整数毫秒，范围 1000–8000，缺省 8000，每次请求时读取），`redirect: 'error'`，MUST NOT 重试。请求 body 为 `{model, state, questions}`；`questions` SHALL 取自按「判档预设的采样与归属」为该次判断捕获的预设的 `rubric.json`：主会话只含 `depth`，子任务按显式维度含 `capability`、`depth` 或两者；`route_subagent` 同样使用所选预设。返回的 choice SHALL 按该捕获预设的 criteria 键校验。Jev 返回后 SHALL 重新读取会话模式，等待期间模式已变或回合决定已被废止时丢弃结果（不写决定、不写 `disabled`）。系统 MUST NOT 包含本地规则、关键词或通用对话模型的判断路径。请求 MUST NOT 携带会话状态、其它会话内容或凭据以外的鉴权信息；出站主机 SHALL 仅为所选决策服务的端点主机。

主会话请求的 `state` SHALL 依次包含：
1. 固定首行 `Previous user-turn tier: none`。
2. 仅当所选预设 `context` 含 `execution` 时：固定行 `Execution: main conversation.`。
3. 上一轮上下文（存在时）：一行固定说明“上下文仅用于理解新消息，只判断新消息引出的工作”，随后 `Previous user message (truncated):` 加上一用户回合文本 `.slice(0, 500)`，以及 `Previous assistant reply (last part):` 加上一轮助手文本 `.slice(-1200)`（均为脱敏后截取）。不存在时省略对应段，两者都不存在时省略说明行。
4. `New user message:` 加本回合分类输入（无上一轮上下文时标签为 `User message:`）。
“上一轮”两段在该次判断开始时从 `agent.session.deriveMessages()` 取得，此时待判批次仍在 inbox，尚未进入历史：上一用户回合文本为最后一条 `source.kind === "user"` 的消息的 `text` 块按序以 `"\n"` 连接；助手段为最后一条含非空 `text` 块的 `assistant` 消息的文本块连接。子任务与预览工具的 `state` 为 `Previous user-turn tier: none`、（仅当所选预设 `context` 含 `execution` 时）固定行 `Execution: delegated subtask; the result returns to an orchestrating agent.`、`User message:` 加处理后的任务文本。`Execution` 行的取值只由调用路径（主会话或子任务/预览）决定，只陈述调用路径、不断言是否有人复核，不含任何会话内容，不属于“会话状态”。

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

### Requirement: 决策提示
系统 SHALL 提供默认开启的开关：`$DSH_HOME/plugins/dsh-auto-model-routing/config.json` 中 `decisionToast: false` 时关闭；文件缺失、不可解析或值非 `false` 时视为开启，不得影响路由。开关每次读取状态时生效，无需重启。

系统 SHALL 为每个主会话保留最近一次决策（仅内存，不落盘），字段与本变更前相同：`{id, source, tier, depth, capability?, effort, provider?, model?, status, confidence?, probabilities?, capabilityConfidence?, capabilityProbabilities?, preset?, decisionProvider, decisionModel, ms}`，其中 `tier` 等于 depth（子任务为 capability），为既有非版本字段，保留；`preset` 为作出该次 Jev 判断时按「判档预设的采样与归属」捕获的预设 id，仅经 Jev 判断的决策含有，只存于内存，MUST NOT 写入子会话决策记录。主会话：Jev 成功判断后记录，`effort` 为 `待应用`、`status` 为 `recommended`；领取提交时按当时的模型与 cap 得出 effort 后更新 `effort`、`provider`、`model`；无法得出 effort 时 `status` 为 `unsupported`；实际请求头与决策一致时为 `applied`，否则为 `failed`。子任务（记录到其根会话）：判断完成或显式指定两个维度时记录，后者 `decisionProvider` 为 `explicit`、`decisionModel` 为 `未调用`、`ms` 为 0；实际请求匹配时为 `applied`。判断失败、取消或被丢弃时 MUST NOT 记录新决策。以下场景中的决策对象均为部分匹配。

状态接口 SHALL 始终返回 `decision`（如有）。开关开启时状态接口同时返回 `decisionToast: true`；client SHALL 仅在 `decisionToast` 为 true 且发现新的决策 `id` 时于芯片上方显示提示，3 秒后自动消失，不拦截指针；提示 MUST 在 Agent 运行、官方隐藏右侧控件期间仍可见。提示与面板共用同一文本：
1. `<主会话|子任务> · <已应用|未应用|不支持调整|已判断/待应用>`
2. 有 `preset` 时：`判档预设 <所选预设的本地化标题>`（id 未注册时原样显示 id）；无 `preset` 时省略此行。
3. 有 capability 时：`能力 <capability> · 判定确定度 <百分比|未提供>` 与 `能力分布：<…>`
4. `投入 <depth> · 判定确定度 <百分比|未提供>`
5. `投入分布：<按 lower/baseline/higher 顺序列出存在的值，以 " / " 分隔，无则“未提供”>`
6. `<provider> / <model|待确定> · <effort>`
7. `<decisionProvider> / <decisionModel> · <秒，两位小数>s`
8. 固定说明：确定度的计算方式，且不是任务成功率。
两次状态读取之间若有多次决策，只显示最新一次。开关关闭时 client MUST NOT 弹出提示。

#### Scenario: 主会话判断提示
- **GIVEN** 开关开启，会话为 `AUTO`，Jev 返回 depth `higher`、confidence 0.4，决策服务 `openrouter` / `typesafe/jev-1.13` 耗时 820ms，实际请求 `claude` / `claude-opus-5-5` / `high`
- **WHEN** 该回合首个请求完成后读取状态并渲染提示
- **THEN** 状态含 `decision = {source: main, depth: higher, effort: high, status: applied}`；提示第一行为 `主会话 · 已应用`，并含 `投入 higher · 判定确定度 40%`、`claude / claude-opus-5-5 · high`、`openrouter / typesafe/jev-1.13 · 0.82s`

#### Scenario: 决策提示标记所用判档预设
- **GIVEN** 设置 `preset` 为 `effort-as-verification`，AUTO 主会话本回合 Jev 判断完成；另有按 `reasoning-depth` 判断的受管子任务，以及一个显式给出模型与 effort 的子任务
- **WHEN** 分别读取根会话状态并渲染提示
- **THEN** 主决策 `preset` 为 `effort-as-verification`，提示第二行为 `判档预设 Effort 管验证与边界情况`；已判断子任务决策 `preset` 为 `reasoning-depth`，第二行为 `判档预设 推理深度`，其决策记录文件不含 `preset`；显式子任务决策不含 `preset`，提示无 `判档预设` 行

#### Scenario: 子任务判断提示
- **GIVEN** 开关开启，会话 S1 为 `AUTO`，其子任务判断为 capability `analytical`、capabilityConfidence 0.8
- **WHEN** 读取 S1 状态并渲染提示
- **THEN** 提示第一行以 `子任务 · ` 开头，含 `能力 analytical · 判定确定度 80%`

#### Scenario: 主决策在请求前后的状态
- **GIVEN** AUTO 主会话本回合 Jev 返回 depth `higher`，主模型目录只支持 `max`
- **WHEN** 分别在判断完成后（批次被领取前）与请求发出后读取状态
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

### Requirement: 判档预设的采样与归属
每次 Jev 判断 SHALL 在判断开始时（主会话与受管子任务在「用户回合与 Jev 输入」各入口发起的判断、`route_subagent` 调用、设置页测试连接）从当次设置读取一次 `preset` 并解析为预设对象（未注册的 id 解析为缺省预设）；该次判断的 `state`（是否含 `Execution` 行）、`questions`、choice 校验与主会话决策的预设归属 SHALL 都使用这个捕获值。判断进行中设置变更 MUST NOT 影响该次判断，也 MUST NOT 触发重判或重试；只影响之后开始的判断。受管子任务的预设在其首次判断开始时捕获，不在创建时捕获。非用户回合不重新判断，沿用上一用户回合的 depth 与预设归属。`route_subagent` 与随后 fresh 创建的子任务各自独立捕获，预览结果不约束后者。设置页测试连接 SHALL 使用所选预设的 questions，`state` 保持固定测试文本。

#### Scenario: 主判断进行中切换预设
- **GIVEN** 设置 `preset` 为 `reasoning-depth`，AUTO 主会话用户回合的 Jev 请求已发出、尚未返回
- **WHEN** 保存 `preset: "effort-as-verification"`，随后 Jev 返回 depth `higher`、回复完成并绑定，再开始下一用户回合
- **THEN** 第一次请求的 `questions` 等于 `reasoning-depth` 的 depth、`state` 不含 `Execution:`；该回合 Jev 请求数为 1；绑定快照 `preset` 为 `reasoning-depth`；下一回合请求的 `questions` 取自 `effort-as-verification`，`state` 含 `Execution: main conversation.`

#### Scenario: 子任务在创建后、首次判断前切换预设
- **GIVEN** 设置为 `reasoning-depth` 时经官方 fresh 子会话工具创建受管子任务
- **WHEN** 子任务首次请求前把设置改为 `effort-as-verification`，然后子任务进入首次判断；判断进行中再改回 `reasoning-depth`
- **THEN** 子任务的 Jev 请求恰 1 次，`questions` 取自 `effort-as-verification`，`state` 含 `Execution: delegated subtask; the result returns to an orchestrating agent.`；改回不触发第二次请求

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
