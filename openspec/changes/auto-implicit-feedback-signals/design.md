## Context

- 绑定：`policy-host.ts` 在 `session/event` 的 `assistant/message` 上，把当前已应用主决策绑定到 `messageId`（`FeedbackBook.bind`），首个绑定不可替换。
- 显式反馈：`FeedbackBook.set` 追加 `type:'feedback', version:2` 事件；构造时逐行读取，`schema.parse` 失败的行被静默跳过。因此旧版本代码遇到新事件类型会跳过，降级安全。
- 客户端：`LabelButton` 挂在 `conversation.chat.assistant-actions` 槽位（回复末尾操作栏），每条回复查询一次 `auto-model-routing.label`，只有已应用决策才渲染。
- 回合事件：`session/event` 中有 `turn/start {turn}`、`user/message`（`source.kind === 'user'` 表示用户发起）、`turn/end {turn, reason}`；`reason.kind` 为 `completed`、`aborted`（`reason.kind` 为 `user`/`parent`/`hook`/`disposed`/`legacy`）、`blocked` 等，可被插件扩展。
- 模式切换：`index.ts` 的 RPC 分派里已有 `setMode` 分支，可以在成功后加钩子。
- 报告：`usage-report.ts` 通过 `FeedbackBook` 读取，按 `(sessionId, decisionId)` 聚合，且受只读与输出白名单约束。

## Goals / Non-Goals

**Goals:**
- 四类事实（曝光、回合结束、切 MANUAL、继续）以最少的新代码进入同一账本，报告能把“没点”拆成可区分的类别。
- 每类事实每决策至多一条，重复触发、刷新和多条回复不产生重复。

**Non-Goals:**
- 不做旁路评审器、不调用任何模型。
- 不跨进程重启补齐事实；重启期间丢失的事实就是缺失。
- 不采集滚动轨迹、停留时长分布、点击或复制等更细的行为。
- 不为子会话记录事实。

## Decisions

### D1 账本：同一文件、新增一个事件类型
新增 `{ type:'fact', version:1, sessionId, decisionId, fact, at, detail? }`，`fact` ∈ `exposed | turn-end | manual-switch | continued`，`detail` 只用于 `turn-end` 的结束类别（`completed | aborted-user | aborted-other | blocked | other`）。`FeedbackBook` 读取时按 `(sessionId, decisionId, fact)` 保留首条，提供 `facts(sessionId, decisionId)` 与写入方法 `fact(...)`，写入前查重。

备选：单独文件 `implicit-facts.jsonl`。放弃原因：报告和账本已经以 `FeedbackBook` 为唯一读取入口（规范“账本关联”要求不另行实现），另开文件就要再维护一套折叠逻辑；同一文件也保证了时间顺序。

关联键用 `decisionId` 而不是 `messageId`：一个决策会绑定多条消息，事实属于决策。

### D2 曝光：在操作栏组件上用 IntersectionObserver
`LabelButton` 已经只在已应用决策的回复上渲染，且位于回复末尾，滚到它可见基本等于看完了这条回复。组件挂一个 `IntersectionObserver`（阈值 1.0），可见且 `document.visibilityState === 'visible'` 且 `document.hasFocus()` 时开始计时，任何一个条件失效就清零；连续 3 秒后调用新 RPC `auto-model-routing.observe {sessionId, messageId}`，调用后本组件不再计时。Host 用 `lookup(sessionId, messageId)` 得到 `decisionId` 后写入，查重在 Host 侧完成，所以刷新、多条回复都安全。

备选：观察整条回复正文。放弃原因：正文由官方组件渲染，插件只拿得到操作栏槽位；长回复也很难定义“看完”。

### D3 回合与继续：Host 侧状态机，只在内存中
`policy-host.ts` 每个会话维护两个值：
- `turnDecision`：本回合绑定过的决策 id（在 `bind` 成功时设置）。
- `awaiting`：上一个已结束回合的决策 id，等待“继续”或“切 MANUAL”。

`turn/end` 到来时，若有 `turnDecision` 则写 `turn-end` 事实，并把它移到 `awaiting`。`user/message` 且 `source.kind === 'user'` 时，若有 `awaiting` 则写 `continued` 并清空。`setMode` 成功切到 MANUAL 时，若有 `awaiting` 则写 `manual-switch`（不清空，用户之后仍可能继续）。

“下一回合之前切 MANUAL”这一口径用 `awaiting` 自然实现：新的用户消息一来，`awaiting` 就被清空。

备选：报告时从会话日志回放推导。放弃原因：模式切换不在会话日志里；而且 Host 侧实时记录更简单，报告也不用扩大读取范围。

### D4 结束类别映射
`completed` → `completed`；`aborted` 且 cause 为 `user` → `aborted-user`；其它 `aborted` → `aborted-other`；`blocked` → `blocked`；其余（含插件扩展的未知种类与错误）→ `other`。只有 `aborted-user` 计入负向信号，`aborted-other`（父会话取消、hook、释放）不算用户的判断。

### D5 报告归类
在已有比较子组循环里，对每个决策单位按规范的五类优先级归类：显式 → 负向 → 隐式无异议 → 未继续 → 未曝光。“曝光且有显式评价”另外单列，用来对照隐式口径是否可信。输出只有类别名和计数，满足白名单要求。

## Risks / Trade-offs

- [DSH 重启时丢失内存状态] → 重启前结束的回合拿不到 `continued`，会被归入 `not-continued`；报告的 caveats 说明，且这只会让 `implicit-ok` 偏低（偏保守），不会制造假的正例。
- [曝光不代表读过] → 3 秒阈值和前台条件只能排除“一闪而过”；caveats 固定说明，`implicit-ok` 不与显式 `appropriate` 合并。
- [`hasFocus` 在多窗口下可能误判] → 只会漏记曝光，不会多记；同样是偏保守。
- [用户先继续、后来才发现问题] → 不在本变更范围；显式反馈仍可随时补点，归类中显式优先。
- [账本体积增长] → 每决策至多 4 行固定小字段，相对现有绑定行可忽略。

## Migration Plan

部署：`dsh build` 后重启 DSH（Host 侧与客户端都有变化）。旧记录无需迁移，没有事实的旧决策在报告中归为 `unobserved`。回滚：回到旧版本即可，旧代码跳过 `type:'fact'` 行，显式反馈与绑定不受影响。
