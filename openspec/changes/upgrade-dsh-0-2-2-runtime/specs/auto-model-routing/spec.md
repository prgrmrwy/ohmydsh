## MODIFIED Requirements

### Requirement: AUTO 主 effort 同步官方选择
AUTO 主请求 SHALL 保持官方合成 provider/model，按 depth 算法、实时支持与 effort cap 选 effort。与当前官方选择的 effort 不同时，SHALL 在本回合 step 准备之前（即运行体读取本步 model selection 之前）等待官方 `sessionController.selectModel`，用同一 sessionId/provider/model 和选定的 reasoningEffort 更新选择，允许官方保存全局 defaults。effort 相同时 SHALL 不重复同步。系统 MUST NOT 在 `agent/request` 中改写 provider、model 或 reasoningEffort；该 waterfall 只能原样返回 `await next()` 的结果。官方同步失败、writer 尚不可用或判断超时时，SHALL 记录可诊断告警，并保留官方当前选择，使请求与选择一致；不得把目标 effort 标为 applied，不得静默吞错，不得换模型。MANUAL 会话、无 effort 支持的模型以及已绑定的 child 请求 SHALL 不因此写官方选择。本要求不改变判断逻辑和 child 精确绑定。

#### Scenario: 同次主请求同步官方 effort 与 defaults
- **GIVEN** AUTO 主会话空闲，官方当前选择为 medium，模型支持 high，Jev 判出 depth higher
- **WHEN** 用户发送一条消息，会话开始该回合
- **THEN** `selectModel` 在该回合 step 1 的 `agent/pre-step` 之前恰好被调用一次，参数为同 provider/model 的 high；step 1 的 `modelSelection` 与请求头 effort 均为 high；`agent/request` 返回值等于 `await next()`；运行体没有抛出 "use agent.model.select() before step preparation"

#### Scenario: 同步失败不丢本次请求
- **GIVEN** 官方当前选择为 medium，AUTO 目标为 high，但官方 `selectModel` 拒绝，或 writer 不可用
- **WHEN** 该回合的主请求执行
- **THEN** 记录同步告警；实际请求为原 provider/model 加 medium，与选择一致；不停用 AUTO，不把 high 记为已同步或 applied；回合正常完成，不抛错

#### Scenario: 手动与子请求不污染默认
- **GIVEN** 分别为：MANUAL 主会话；目标 effort 与当前选择相同的 AUTO 主会话；此前已精确绑定的 child
- **WHEN** 对应请求执行或恢复
- **THEN** 三种情况下 `selectModel` 调用次数均为 0；MANUAL 请求原样通过，child 保持既定路由

#### Scenario: 异步解析期间切 MANUAL 不覆盖主请求
- **GIVEN** AUTO 主会话正在 step 准备前等待 Jev 或模型能力解析
- **WHEN** 会话切为 MANUAL 之后，等待才结束
- **THEN** `selectModel` 调用次数为 0；step 1 使用切换前的官方选择

### Requirement: 用户回合与 Jev 输入
系统 SHALL 在主会话用户回合的 step 准备之前判定该回合并请求 Jev。判定入口只有两个：

- **空闲入口**：会话空闲时，`agent/inbox/inserted` 收到一条 `source.kind` 严格等于 `"user"` 的消息。监听器 SHALL 在同步回调内调用官方 `agent.runMaintenance()`，在维护任务里完成 Jev 判断和选择同步；运行体会在维护任务结束之后才开始该回合。
- **回合间入口**：会话运行中，`agent/turn-stopping` 到达时，next-turn 队列中已有合格消息。系统 SHALL 在该 serial 监听器里完成判断和选择同步，然后才返回。

**合格消息**是进入入口时尚在 inbox、且 `source.kind` 严格等于 `"user"` 的消息；其它来源（含 `agent-instructions`、`plugin`、`plugin:<id>`、`runtime-context`、`time-context`、`skill-catalog`）和缺失 `source` 的消息 MUST NOT 贡献输入。合格消息数为 0 的回合不是用户回合：沿用上一用户回合的 depth，不请求 Jev；首个用户回合之前没有 depth 时不改写。

分类输入是合格消息按入队顺序、消息内按块顺序的 `text` 块文本，以 `"\n"` 连接，经 `redact` 后取 `.slice(0, 8000)`；非文本块不贡献。

决定 SHALL 按 (agent, 回合) 保存，同回合后续请求（含同 turn/step 的错误重试）复用该决定。判断完成后、该回合 step 1 之前才入队的用户消息，进入同一回合但不触发重判。`runMaintenance` 同步抛错（会话已有活动工作）时，SHALL 不请求 Jev，本回合沿用上一用户回合的 depth。维护任务和回合间判断 SHALL 把运行体提供的 abort signal 传给 Jev；被取消或超过「Jev 期限」时，按「Jev 失败即停用并提示」处理，MUST NOT 让维护任务抛出未处理的异常。

`origin = "subagent"` 的会话 MUST NOT 走主会话判断，其路由只按「AUTO 决策与执行」处理，判断输入只取该子会话自身首条进入消息中的合格消息。

#### Scenario: 空闲入口在回合开始前完成判断
- **GIVEN** AUTO 主会话空闲
- **WHEN** 一条 `user` 消息“修复登录 bug”入队
- **THEN** Jev 请求恰好 1 次，分类输入为“修复登录 bug”；Jev 返回之前，该回合不产生 `step/start` 事件

#### Scenario: 步骤被拒时不请求 Jev
- **GIVEN** 会话为 `AUTO`，空闲入口已为回合 T 完成一次 Jev 判断；下游 pre-step listener 对 step 1 返回 `{kind: reject}`
- **WHEN** 回合 T 以 blocked 结束
- **THEN** 回合 T 内 Jev 请求次数为 1（只有入口那一次）；pre-step 被拒不触发任何额外 Jev 请求，也不撤销已同步的选择

#### Scenario: 首轮真实领取序列只取用户消息
- **GIVEN** 会话空闲时依次入队 `agent-instructions`（文本 A）、`plugin:dsh-memex`（文本 B）、`runtime-context`（文本 C）、`skill-catalog`（文本 D）、`user`（文本“修复登录 bug”）
- **WHEN** 构造分类输入
- **THEN** 分类输入恰为“修复登录 bug”

#### Scenario: 多条用户消息按序拼接并截断
- **GIVEN** 运行中的会话，next-turn 队列依次有两条 `user` 消息：第一条文本“先看日志”，第二条含文本“再改配置”和一个图片块；另有一条无 `source` 的消息（文本 X）
- **WHEN** 当前回合到达 `agent/turn-stopping`
- **THEN** 分类输入恰为“先看日志\n再改配置”；拼接结果长度超过 8000 时，等于其 `.slice(0, 8000)`；下一回合 step 1 的 `modelSelection` 已是该判断对应的 effort

#### Scenario: 同回合与重试复用决定
- **GIVEN** 用户回合 T 的首个请求已按 depth `higher` 输出 effort `high`
- **WHEN** 回合 T 内第 2 至第 5 个请求到达，其中一次是同 (turn, step) 的错误重试
- **THEN** 这些请求的 effort 都是 `high`；回合 T 内 Jev 请求次数为 1

#### Scenario: 非用户回合沿用上一 depth
- **GIVEN** 上一用户回合 depth 为 `higher`，会话为 `AUTO`，主模型 `claude-opus-5-5`
- **WHEN** 由子会话完成通知开启的回合发出首个请求
- **THEN** 该请求 effort 为 `high`，Jev 请求次数不增加

#### Scenario: 无法进入维护时不判断
- **GIVEN** 会话为 `AUTO`，`agent.runMaintenance` 因会话已有活动工作而同步抛错
- **WHEN** 一条 `user` 消息入队
- **THEN** Jev 请求次数为 0；该消息所在回合沿用上一用户回合的 depth；没有未处理异常

#### Scenario: 取消中止判断
- **GIVEN** 空闲入口的维护任务正在等待 Jev
- **WHEN** 用户取消会话
- **THEN** 传给 Jev 的 signal 已 aborted；`selectModel` 调用次数为 0；维护任务正常结束（resolve），不 reject

#### Scenario: 子会话不走主会话判断
- **GIVEN** 父会话为 `AUTO`，经官方 fresh 子会话工具创建的子会话首条进入消息含注入的非 user 指令和 user 文本“整理日志”
- **WHEN** 子会话首次请求前进行判断
- **THEN** 发往 Jev 的子任务 `state` 只含“整理日志”，不含注入的指令文本；父会话本回合的决定和 Jev 请求次数都不变

### Requirement: AUTO 决策与执行
主会话 SHALL 只判断 depth=lower/baseline/higher，在模型支持序列中以所属家族策略的推荐起点最多移动一档，不修改 provider/model；选定 effort 与官方当前选择不同时，按「AUTO 主 effort 同步官方选择」经官方 selectModel 同步。子任务 SHALL 只在「AUTO 受管子会话范围」内路由：独立判断 capability=bounded/analytical/frontier 或 insufficient_context，按「子任务路由退化链」确定 route，保留显式模型/effort，完全显式时不调用 Jev。受管子会话的判断和 route 应用 SHALL 在该子会话 step 1 准备之前完成：经子会话自身的空闲入口（见「用户回合与 Jev 输入」）判断后，调用子会话 `agent.model.select()` 设置 route；MUST NOT 调用 `selectModel` 或保存全局 defaults，MUST NOT 在 `agent/request` 中改写 route。受管子会话 SHALL 按精确 child ID 绑定并持久化，实际请求头匹配 route 后标 applied；恢复时不重判，已持久的选择即为 route。每次请求前 SHALL 重新核验实时门禁（cap、允许列表、目录）：核验不通过时 SHALL 在请求发出前抛出可诊断错误，暂停该子请求，不改为其它 route。fork 不属于受管范围，SHALL 与父会话保持一致、原样放行，MUST NOT 报错，也不得悄悄改为 fresh。Agent 保留编排和验收权，不实现自主重试升级。

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
- **THEN** 子会话 `agent.model.select` 恰好被调用一次，参数为该 route；`selectModel` 调用次数为 0；`agent/request` 返回值等于 `await next()`

#### Scenario: 实时门禁失效时暂停子请求
- **GIVEN** 受管子会话 C 已应用 high route，之后 effort cap 降为 medium
- **WHEN** C 的下一个请求准备发出
- **THEN** 请求发出前抛出可诊断错误；没有向 provider 发出请求；C 的选择仍为 high，不被改写
