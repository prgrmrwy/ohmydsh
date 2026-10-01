## Context

`packages/dsh-memex/src/lifecycle/index.ts` 在 `agent/turn-stopping` 中调用 `agent.inject(notice)`。dsh-agent 对该事件的说明是：回合结束前，如果收件箱里有新内容，循环就会再执行一步，所以提醒必然在同一回合里多出一次模型请求。现有的 `lifecycle-runtime.test.ts › adds at most one reminder step after recall` 正好把这个行为写成了断言（同一回合发出 2 次请求）。

与本方案相关的宿主能力（以当前 pin 的 dsh-agent 类型声明 `runtime-types.d.ts` 为准）：

- `agent/pre-step`（waterfall）：在每一步进入模型之前，可以替换这一步的消息。`payload` 带有 `turn` 和 `step`。
- 官方先例：`@deepseek-ai/dsh-agent` 在切换模型时就是在 `agent/pre-step` 里调用 `next()`，再把 `modelSwitchNotice` 追加到 `decision.messages` 末尾（`lib/index.js`，`disposeNotice`），而不是走 inbox。
- `agent.send(message, 'next-turn', false)`：消息会持久化进下一回合的 inbox，并且不会唤醒 driver。

## Goals / Non-Goals

**Goals:**
- 写卡提醒永远不在它被安排的那个回合里产生额外的模型请求。
- 提醒在送达那一刻再判断一次前置条件，不成立就放弃。

**Non-Goals:**
- 不调整提醒的措辞和强度，也不新增“回答前先写卡”的引导（方案 C 已被否决）。
- 不处理 Web GUI 只展示最后一条消息的折叠方式（那是宿主的 UI 行为）。
- 不让待送达的提醒跨进程重启保留：它和现有的 `SessionState` 一样只存在内存里，重启后从头计算。

## Decisions

### 1. 回合结束时只记录，下一回合第一步才追加

`agent/turn-stopping` 只做一件事：前置条件成立时，在会话状态里记下 `pendingSinceTurn = turn`，不调用 `inject`。

`agent/pre-step` 先 `await next()`。满足以下全部条件时，才把提醒消息追加到 `decision.messages` 末尾，并清掉 pending、置 `reminded = true`：

- `decision.kind === 'enter'`；
- signal 未中止；
- `payload.turn > pendingSinceTurn`；
- 记忆未关闭；
- 尚未写卡。

如果条件已经不成立，就直接清掉 pending。

**为什么用 `turn > pendingSinceTurn`，而不是“下一个 pre-step”：** `turn-stopping` 是 serial 事件，其他监听器可能 steer，让同一回合再跑一步。按回合号比较能保证提醒绝不落进它被安排的那个回合。

**被放弃的方案：**

- **`agent.send(msg, 'next-turn', false)`：** 消息会持久化进 inbox。会话在送达前写了卡，就得用 `splice` 把它撤回；重启后，内存里的状态也会和持久化的 inbox 对不上。
- **在下一回合开始时（例如 `agent/status → running`）调用 `inject`：** `inject` 的说明写明它可能赶不上已经认领过批次的 pre-step，时序不可靠。

`pre-step` 追加消息是宿主官方已经在用的模式，消息随这一步持久化，provenance 仍然是 `{kind:'plugin', plugin:'dsh-memex', form:'notice'}`。

### 2. 状态字段

`SessionState` 新增 `pendingSinceTurn?: number`。现有 `reminded` 保持“本轮写卡之前已送达一次”的含义。

- 安排 pending 的条件：`!off && recalled && !wrote && !reminded && pending === undefined`。
- `mark('write' | 'retro')`：清掉 pending，`reminded = false`（与现在一致）。
- `session-start`：清掉 pending；其余重置规则不变。

### 3. 监听器顺序

监听器不使用 `prepend`。dsh-agent 自己的切模型提示用了 `prepend: true`，会排在更外层。提醒追加在 `next()` 返回的消息之后，所以用户消息和宿主自己追加的上下文都排在提醒前面。消息之间的相对顺序对模型理解没有实质影响。

## Risks / Trade-offs

- **[用户不再发消息时就不写卡]** → 这是用户已接受的代价。召回引导里本来就要求“任务完成后写卡”，模型自觉写卡的路径不受影响。
- **[pre-step 的 `turn`/`step` 编号语义与假设不符]** → 实现前先用真实 AgentLoop 集成测试证明：提醒只出现在下一回合的首个请求里，不出现在当前回合；测试不过就不合并。
- **[子代理会话也会收到提醒]** → 行为和现在一样：子代理的 agent 有自己的 session 状态，没召回就不会安排提醒，本变更不扩大影响面。
- **[提醒出现在用户消息之后，模型可能先写卡、再回答]** → 这可以接受：写卡发生在回答之前，回答仍然是回合的最后一条消息，正好是我们想要的顺序。

## Migration Plan

不涉及数据迁移。改完后运行 `dsh build` 并重启 DSH 即可生效。回滚只需还原 `lifecycle/index.ts`，再重新 build。
