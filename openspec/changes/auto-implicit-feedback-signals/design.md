## Context

- 绑定：`policy-host.ts` 在 `session/event` 的 `assistant/message` 上，把当前已应用主决策绑定到 `messageId`（`FeedbackBook.bind`），首个绑定不可替换；`applied` map 保存每个会话最近一次已应用的主决策，在下一个 `request/header` 到来时清空。
- 显式反馈：`FeedbackBook.set` 追加 `type:'feedback', version:2` 事件；构造时逐行读取，`schema.parse` 失败的行被静默跳过。因此旧版本代码遇到新事件类型会跳过，降级安全。
- 客户端：`LabelButton` 挂在 `conversation.chat.assistant-actions` 槽位（回复末尾操作栏），每条回复查询一次 `auto-model-routing.label`，只有已应用决策才渲染。
- 会话日志：报告的 `readSession` 已经逐事件扫描 `turn/start`、`user/message`（`source.kind === 'user'`）、`request/header`、`assistant/message`，但目前跳过 `turn/end`。`turn/end { turn, reason }` 的 `reason.kind` 为 `completed`、`aborted`（附 `reason.reason.kind` 为 `user`/`parent`/`hook`/`disposed`/`legacy`）、`blocked` 等，可被插件扩展。
- 模式切换：`index.ts` 的 RPC 分派里已有 `setMode` 分支，可以在成功后加钩子。模式切换不进会话日志。
- 报告：`usage-report.ts` 通过 `FeedbackBook` 读取，按 `(sessionId, decisionId)` 聚合，且受只读与输出白名单约束。

- 已应用判定（D012 的根因）：`policy-host` 只在 `request/header` 事件里比较实际配置与判断，`applied.set` 只发生在这里；而 `pre-step` 在每个用户回合开头 `applied.delete`。宿主 `dsh-agent-loop` 的 `buildRequest` 只在首个请求、配置变化（`!headerEquals`）或新请求序列时写 `request/header`。所以判断结果等于当前配置的回合不会产生新请求头，决策永远停在“待应用”。本会话日志实证：有请求头的回合全部绑定，没有请求头的回合全部未绑定，一一对应。

## Goals / Non-Goals

**Goals:**
- 配置未变的回合同样判定“已应用”并绑定回复（修复 D012），这是隐式事实覆盖面的前提。
- 只在运行时记录日志里拿不到的事实（曝光、切 MANUAL）；其它事实报告时从日志推导，不重复记账。
- 每类事实每决策至多一条，重复触发、刷新和多条回复不产生重复。

**Non-Goals:**
- 不做旁路评审器、不调用任何模型。
- 不采集滚动轨迹、停留时长分布、点击或复制等更细的行为。
- 不为子会话记录事实。
- 不在 Host 侧维护每会话的回合状态机。

## Decisions

### D0 已应用判定不依赖新请求头
主会话在 `agent/request` waterfall 里已经拿到本次请求的最终配置（provider、model、`reasoningEffort`）。在这里做“实际配置与判断是否一致”的比较，并记下待确认的结果。随后两种情况：
- 宿主写了 `request/header`：沿用现有逻辑，以请求头内容为准并记录其 `seq`。
- 宿主没写（配置未变）：在本回合第一条 `assistant/message` 到来、准备绑定时，用 `session.requestHeader()` 的当前值确认配置一致，`requestSeq` 取当时生效的那个请求头事件的 seq。

备选：只在 `agent/request` 里直接 `applied.set`。放弃原因：waterfall 返回的 config 之后还可能被宿主的 `prepareCall` 调整，`requestHeader()` 才是实际生效的记录；用它确认能保持“以实际请求为准”的既有口径，不会把推荐当成应用。

`requestSeq` 的含义因此从“本回合新写的请求头”变为“本回合生效的请求头”。快照字段本身不变，旧记录口径一致（旧记录都是新写请求头的回合）。

### D1 账本：同一文件、新增一个事件类型
新增 `{ type:'fact', version:1, sessionId, decisionId, fact, at }`，`fact` ∈ `exposed | manual-switch`。`FeedbackBook` 读取时按 `(sessionId, decisionId, fact)` 保留首条，提供 `facts(sessionId, decisionId)` 与写入方法 `fact(...)`，写入前查重。

备选：单独文件 `implicit-facts.jsonl`。放弃原因：报告和账本已经以 `FeedbackBook` 为唯一读取入口（规范“账本关联”要求不另行实现），另开文件就要再维护一套折叠逻辑。

关联键用 `decisionId` 而不是 `messageId`：一个决策会绑定多条消息，事实属于决策。

### D2 哪些事实在运行时记、哪些在报告时推导
判据只有一条：**会话日志里有没有**。

| 事实 | 日志里有吗 | 做法 |
|---|---|---|
| 曝光 | 没有（浏览器状态） | 运行时记 |
| 切 MANUAL | 没有（不进日志） | 运行时记 |
| 回合结束原因 | 有（`turn/end.reason`） | 报告时读 |
| 是否继续 | 有（后续 `turn/start` + 用户 `user/message`） | 报告时读 |

早先的草案把四类都放在运行时记，并引入 `turnDecision`/`awaiting` 状态机。放弃原因：后两类是重复记录；而且内存状态跨不过 DSH 重启，反而会制造缺口。报告时推导没有这个问题，代价是日志缺失或尾段不完整时该决策为 `unknown`，报告已有 `missing-log`/`tail-incomplete` 计数覆盖这种情况。

### D3 曝光：在操作栏组件上用 IntersectionObserver
`LabelButton` 已经只在已应用决策的回复上渲染，且位于回复末尾，滚到它可见基本等于看完了这条回复。组件挂一个 `IntersectionObserver`（阈值 1.0），可见且 `document.visibilityState === 'visible'` 且 `document.hasFocus()` 时开始计时，任何一个条件失效就清零；连续 3 秒后调用新 RPC `auto-model-routing.observe {sessionId, messageId}`，调用后本组件不再计时。Host 用 `lookup(sessionId, messageId)` 得到 `decisionId` 后写入，查重在 Host 侧完成，所以刷新、多条回复都安全。

备选：观察整条回复正文。放弃原因：正文由官方组件渲染，插件只拿得到操作栏槽位；长回复也很难定义“看完”。

### D4 切 MANUAL：复用 `applied` map，先读后清
`policy-host` 暴露 `appliedDecision(sessionId)`，返回 `applied` map 中最近一次已应用的主决策 id。`applied` 在下一个 `request/header` 时被替换或清空，所以“尚未被新请求取代”的口径由现有逻辑自然保证，不加新状态。

顺序是关键：`index.ts` 的 `setMode` 路由在调用 `endpoint('setMode')` **之前**就执行 `policy.invalidate(id)`，而 `invalidate` 会清空 `applied`。因此 `appliedDecision` 必须在 `invalidate` 之前读出并暂存；等 `setMode` 响应成功、且目标模式为 MANUAL 时，才用暂存值写 `manual-switch`。响应失败则不写。测试必须走真实的 `setMode` RPC 路由，不能只调钩子，否则测不出这个顺序问题。

### D5 报告：从日志推导回合结束、继续与有效曝光
`readSession` 增加三项：每个调用的**实际回合号** `turn`（现有的 `userTurn` 是它归属的用户回合，二者在子会话结果或定时提醒唤醒的回合里不同）；每个回合的 `turn/end` 原因（映射为 `completed | aborted-user | aborted-other | blocked | other`，缺失为 `unknown`）；会话内由用户发起的回合及其开始时间。

决策所在回合取其最后一次关联调用的实际回合号 `turn`，不用 `userTurn`。原因：`policy-host` 在非用户发起的回合沿用原决策，若用 `userTurn`，用户中止这类后续回合会被读成前一个正常结束的回合。

“继续”定义为决策所在回合之后存在用户发起的回合，第一个这样的回合的 `turn/start` 时间为继续时间。曝光事实只有在 `at` 早于继续时间时才有效：事后翻看旧会话会让旧回复补上曝光，若不加这个约束，这些回复会被算成当时看过且无异议。

映射：`completed` → `completed`；`aborted` 且 cause `user` → `aborted-user`；其它 `aborted` → `aborted-other`；`blocked` → `blocked`；其余（含插件扩展的未知种类与错误）→ `other`。只有 `aborted-user` 计入负向。

### D6 五类归类
对每个决策单位按规范的优先级归类：显式 → 负向 → 隐式无异议 → 无定论（`inconclusive`）→ 未曝光。第 4 类不叫“未继续”，因为它也包含继续了但结束类别非 `completed` 的决策（例如父会话取消）。“有效曝光且有显式评价”另外单列，用来对照隐式口径是否可信。输出只有类别名和计数，满足白名单要求。

## Risks / Trade-offs

- [修复后绑定数突然增加] → 报告里“无记录回合”会明显下降，这是修复缺口而非行为变化；在 `docs/feedback-evaluation.md` 记下修复日期，前后数据不要直接比较。

- [曝光不代表读过] → 3 秒阈值和前台条件只能排除“一闪而过”；caveats 固定说明，`implicit-ok` 不与显式 `appropriate` 合并。
- [`hasFocus` 在多窗口下可能误判] → 只会漏记曝光，不会多记；偏保守。
- [用户先继续、后来才发现问题] → 不在本变更范围；显式反馈仍可随时补点，归类中显式优先。
- [日志缺失或尾段不完整] → 该决策结束类别为 `unknown`，归入 `inconclusive` 而非 `implicit-ok`；偏保守。
- [决策跨多个回合] → 取最后一次关联调用的实际回合作为“决策所在回合”，与报告已有的“决策单位按首次关联调用归属时间”口径不同但各自明确；在文档中写明。
- [浏览器与 Host 时钟] → 曝光的 `at` 由 Host 写入时取时间，与会话日志同一时钟，可直接比较。

## Migration Plan

部署：`dsh build` 后重启 DSH（Host 侧与客户端都有变化）。旧记录无需迁移，没有曝光事实的旧决策在报告中归为 `unobserved`。回滚：回到旧版本即可，旧代码跳过 `type:'fact'` 行，显式反馈与绑定不受影响。
