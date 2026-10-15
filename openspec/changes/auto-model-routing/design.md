## Context

目标环境是个人本机 DSH `0.2.0-rc.2`，不是多用户服务。主会话自动调 effort；子会话选模型由 skill 指导，官方接口落实。2026-10-15 用户接受 ponytail 精简：删除建议工具、候选池实现、持久记录及清理、恢复按钮、异步分类扩展点、运行时全局开关、版本化原因协议。

已核验的运行时约束：
- `agent/pre-step` 携带 `{agent, messages, turn, step, signal}`；step 1 的领取消息中既有用户消息，也有 Host 注入消息。只接受 `source.kind === "user"`，不靠文本推断来源（集成陷阱文档 §5）。
- `agent/request` 是 waterfall。官方模型选择 listener 在 `await next()` 后写入 provider/model/effort；插件必须在外层等待官方合成后才能调整 effort。Cordis `prepend` 注册到外层，实际顺序须用运行时集成测试确认。
- 官方当前选择优先取 pending，其次最近请求头（含 effort），最后默认选择。`model/selection` 是用户选择事件；provider/model/effort 完全匹配请求头后 pending 才被消费。
- 官方模型切换通知只比较 provider/model；只调 effort 不触发该通知。不能由此推断所有 provider 的 prompt cache 一定保留。
- 子会话默认继承父会话最近请求头；官方创建参数可覆盖。允许模型列表在会话创建时冻结，官方负责校验。
- Web connection 只认一个 operator，并无 connection→session 绑定；官方会话操作也通过请求的 `sessionId` 解析目标。认证由 connection 负责。
- `conversation.input.right` 按 order 升序排在模型选择器左侧，GPT 速度芯片 order 为 0。网络门禁检查最终请求的 provider/model。

## Goals / Non-Goals

目标：主会话仅改 effort；MANUAL 可复原锚点；本地同步分类；状态可见；子会话显式参数由 skill 指导。

不做：主会话自动换模型、子会话动态改配置、建议工具、网络探测、自动 provider 回退、Jev、持久决定日志、恢复按钮、全局开关、可插拔分类框架。

## Decisions

### D1. 独立 package 与 skill
选择：`packages/auto-model-routing/` 提供 Host 和 Web client，布局复用 `home-network-model-guard` 的 bundle 模式；另提供 `skills/subagent-model-routing/SKILL.md`。manifest 默认禁用。

理由：只有插件能改主请求并展示芯片，子会话任务判断则主 Agent 比关键词工具更合适。替代方案是安装 laya 或全部用 skill；前者不符合用户要求，后者不能改请求。后果：子会话选模是尽力指引，不承诺硬性执行。

### D2. 官方合成后只调 effort
选择：`agent/request` 外层 listener 先 `await next()`，保留官方 provider/model 与其它配置，只按决定修改 reasoning effort；子会话直接透传。effort 支持范围取实际官方输出模型的目录，不以过期锚点替换模型。

理由：避免模型切换通知及与模型门禁的分歧。替代方案是切模型并压制通知；会干预官方消息，拒绝。后果：效果受用户所选模型能力限制；不保证 provider 特有的缓存行为。

### D3. 持久小状态与 MANUAL 过渡
选择：插件会话级存储保存模式、锚点、过渡标记，按 session id 隔离。锚点从最近 `model/selection` 初始化/更新；无该事件时才取第一次官方合成配置，标记 `initialized`。只在状态变化时写存储，不追加决定日志。

切到 MANUAL 后立即废止当前 turn 的旧 AUTO 缓存，保留复原义务。每次请求先比较官方合成模型与最新锚点：不同则透传并等待，不向旧模型写新锚点 effort；相同则写回锚点 effort（无则移除）。仅当持久请求头及当前官方合成均精确匹配最新锚点，才持久化清除义务；同 step 重试仍用旧 assembled 快照，因此必须继续覆盖。header 前取消或 prepareCall 失败不算完成。

同回合再次切 AUTO 不恢复旧缓存，未完成复原继续有效；若下一用户回合到来仍有义务，先完成复原且该回合不启用 AUTO，完成后的下一用户回合才重新决定。用现有 turn/模式/过渡字段记录这个边界，不引入异步任务状态机。相同模式重复设置不写存储、不重新创建过渡。

理由：切模式本身已能复原，不再调用 `selectModel`。替代方案是恢复按钮加 pending 跟踪；多一条写接口及回滚状态，删除。后果：卸载前须先切 MANUAL 并完成一次请求；直接卸载仍保留最后的 AUTO effort。官方 pending 对 effort 精确匹配，AUTO 与用户手选的相互作用仍须用真实投影测试，不能只靠模拟证明。

### D4. 同步分类与每 Agent 一个决定
选择：step 1 的 pre-step 聚合可信文本（领取顺序、块顺序、换行连接、`.slice(0, 8000)`），直接调用纯函数 `classify`。用 `WeakMap<Agent, {turn, level?, effort?, reason, previousUserLevel?}>` 保存当前决定；新回合替换旧条目。MANUAL 过渡优先于缓存。无用户消息沿用上一用户级别；无历史且无法分类则透传。

理由：没有异步分类工作，不需要 pending/cancelled 状态、AbortSignal 接口、迟到结果或两回合缓存。替代方案是保留 Jev 扩展点；等真正引入外部分类时另行设计。后果：规则可能误判，用户可以切 MANUAL；测试覆盖分类 fixture、同回合重试及真实首轮来源序列。

### D5. 级别与原因使用代码常量
选择：显式级别词 → 延续词 → 重做词升一级 → 分类 → 未分类沿用历史；最高为 escalated。三类词表随代码提供，不提供约束词表或用户配置。原因使用 TypeScript 字面量联合类型，不设 reasonSchema 或运行时版本协议。

理由：输入输出都是插件内部类型，编译检查与表驱动测试足够。替代方案是每个生产点校验闭集并抛错；增加无实际外部输入的失败路径，删除。

### D6. 子会话只用 skill
选择：主 Agent 参考 D9 自行判断任务，默认跟随当前用户选定 provider，使用官方模型目录与允许列表确认可用性；显式 provider/独立体系要求优先。模型不可用时如实报告，不偷偷跨 provider 或改成另一模型。总是显式传 provider/model/reasoning_effort，并用 `[model·effort]` 标注 description。复用无法确认适配时新建。

理由：不让弱关键词分类器替理解任务的主 Agent 做决定。替代方案 route_for_task 与四重候选池已删除。后果：MANUAL 仅控制主会话；skill 不随模式开关，平台白名单仍是强边界。

### D7. 两个端点与一个面板
选择：通过已认证 connection 注册 POST JSON 端点 `/api/auto-model-routing.state`、`/api/auto-model-routing.setMode`。解析 sessionId，拒绝未知/子会话目标；setMode 验证 AUTO/MANUAL，只写目标会话。无 clear、restore 或 settings 开关接口。

芯片 order 为 -10，不调用官方模型选择或速度设置接口。面板展示锚点 provenance、effort、reason 与最近 20 条决定；每 Agent 内存条目有界，释放后不保留，Host 重启清空；不保存任务文本。

理由：复用官方认证模型，避免新授权体系及无消费者的文件日志。替代方案 JSONL 轮转与清理接口已删除。后果：没有重启前的决策审计历史；有意接受。

### D9. 固定映射表

主会话 effort（常量，不提供配置 UI）：

| 模型 | simple | standard | complex | escalated |
|---|---|---|---|---|
| claude-opus-5-5 | low | medium | xhigh | max |
| claude-sonnet-5-5 | low | medium | high | max |
| claude-fable-5-1 | low | medium | high | max |
| gpt-6.1-sol | low | medium | xhigh | max |
| gpt-6-astra | low | low | medium | high |
| 其它 | low | medium | high | max |

顺序 `low < medium < high < xhigh < max`；不支持目标时取不超过目标的最高支持值，无则取最低支持值；无 effort 支持时透传。

skill 子会话表：

| 级别 | claude | codex |
|---|---|---|
| simple | claude-haiku-5-5 / low | gpt-6-luna / medium |
| standard | claude-sonnet-5-5 / medium | gpt-6.1-sol / medium |
| complex | claude-opus-5-5 / xhigh | gpt-6.1-sol / xhigh |
| escalated | claude-fable-5-1 / high | gpt-6-astra / medium |

表只放在 skill；测试直接解析 skill 并断言预期条目及家族一致性，不为测试创建运行时未使用的第二份子会话常量。

## Risks / Verification

- effort 残留：切 MANUAL 并完成请求再卸载；测试重启后过渡标记仍生效。
- 手选 pending 与外层 effort 覆盖：真实官方 selection/projection 集成测试证明 provider/model 保持、锚点跟随事件；不复制一套官方实现充当独立证据。
- listener 顺序与异步注入：用最小真实 Host 测试实际注册顺序；参照集成陷阱文档，不只测自造 waterfall。
- 本地规则误判：固定 fixture 表，保留 MANUAL，不声称理解任意任务。
- skill 遵守度：自动测试只能检查文本，实际委派验证显式参数与标注；不承诺强制防止复用。
- client 位置：构建 host/client 同批产物后，在现有 GUI 验证；不另起服务器冒充当前页面。

## Delivery / Rollback

仅规划阶段，不部署。实现验收在隔离 DSH_HOME 执行构建与两次 sync；manifest 默认禁用。用户授权上线后再构建/刷新。回滚前先切 MANUAL 完成请求，随后禁用插件；若未执行请求，用户可通过官方模型选择器重设 effort。
