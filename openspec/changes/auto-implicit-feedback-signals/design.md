## Context

- 绑定：`policy-host.ts` 在 `session/event` 的 `assistant/message` 上，把当前已应用主决策绑定到 `messageId`（`FeedbackBook.bind`），首个绑定不可替换；`applied` map 保存每个会话最近一次已应用的主决策，在下一个 `request/header` 到来时清空。
- 显式反馈：`FeedbackBook.set` 追加 `type:'feedback', version:2` 事件；构造时逐行读取，`schema.parse` 失败的行被静默跳过。因此旧版本代码遇到新事件类型会跳过，降级安全。
- 客户端：`LabelButton` 挂在 `conversation.chat.assistant-actions` 槽位（回复末尾操作栏），每条回复查询一次 `auto-model-routing.label`，只有已应用决策才渲染。
- 会话日志：报告的 `readSession` 已经逐事件扫描 `turn/start`、`user/message`（`source.kind === 'user'`）、`request/header`、`assistant/message`，但目前跳过 `turn/end`。`turn/end { turn, reason }` 的 `reason.kind` 为 `completed`、`aborted`（附 `reason.reason.kind` 为 `user`/`parent`/`hook`/`disposed`/`legacy`）、`blocked` 等，可被插件扩展。
- 模式切换：`index.ts` 的 RPC 分派里已有 `setMode` 分支，可以在成功后加钩子。模式切换不进会话日志。
- 报告：`usage-report.ts` 通过 `FeedbackBook` 读取，按 `(sessionId, decisionId)` 聚合，且受只读与输出白名单约束。

## Goals / Non-Goals

**Goals:**
- 只在运行时记录日志里拿不到的事实（曝光、切 MANUAL）；其它事实报告时从日志推导，不重复记账。
- 每类事实每决策至多一条，重复触发、刷新和多条回复不产生重复。

**Non-Goals:**
- 不做旁路评审器、不调用任何模型。
- 不采集滚动轨迹、停留时长分布、点击或复制等更细的行为。
- 不为子会话记录事实。
- 不在 Host 侧维护每会话的回合状态机。

## Decisions

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

### D4 切 MANUAL：复用 `applied` map
`policy-host` 暴露 `appliedDecision(sessionId)`，返回 `applied` map 中最近一次已应用的主决策 id。`index.ts` 的 `setMode` 成功切到 MANUAL 时，若有值就写 `manual-switch`。`applied` 在下一个 `request/header` 时清空，所以“下一次模型请求之前”的口径由现有逻辑自然保证，不加新状态。

### D5 报告：从日志推导回合结束与继续
`readSession` 增加记录：每个用户回合的 `turn/end` 原因（映射为 `completed | aborted-user | aborted-other | blocked | other`，缺失为 `unknown`），以及会话内由用户发起的回合号列表。决策单位的回合取其最后一次关联调用的 `userTurn`；“继续”定义为该回合之后存在用户发起的回合。

映射：`completed` → `completed`；`aborted` 且 cause `user` → `aborted-user`；其它 `aborted` → `aborted-other`；`blocked` → `blocked`；其余（含插件扩展的未知种类与错误）→ `other`。只有 `aborted-user` 计入负向。

### D6 五类归类
对每个决策单位按规范的优先级归类：显式 → 负向 → 隐式无异议 → 未继续 → 未曝光。“曝光且有显式评价”另外单列，用来对照隐式口径是否可信。输出只有类别名和计数，满足白名单要求。

## Risks / Trade-offs

- [曝光不代表读过] → 3 秒阈值和前台条件只能排除“一闪而过”；caveats 固定说明，`implicit-ok` 不与显式 `appropriate` 合并。
- [`hasFocus` 在多窗口下可能误判] → 只会漏记曝光，不会多记；偏保守。
- [用户先继续、后来才发现问题] → 不在本变更范围；显式反馈仍可随时补点，归类中显式优先。
- [日志缺失或尾段不完整] → 该决策结束类别为 `unknown`，归入 `not-continued` 而非 `implicit-ok`；偏保守。
- [决策跨多个用户回合] → 取最后一次关联调用的回合作为“决策所在回合”，与报告已有的“决策单位按首次关联调用归属时间”口径不同但各自明确；在文档中写明。

## Migration Plan

部署：`dsh build` 后重启 DSH（Host 侧与客户端都有变化）。旧记录无需迁移，没有曝光事实的旧决策在报告中归为 `unobserved`。回滚：回到旧版本即可，旧代码跳过 `type:'fact'` 行，显式反馈与绑定不受影响。
