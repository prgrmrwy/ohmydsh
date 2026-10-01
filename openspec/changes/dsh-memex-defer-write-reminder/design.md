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

`agent/turn-stopping` 只做一件事：提醒仍然该发（记忆开启、已召回、未写卡、本会话未送达过）且尚未排队时，在会话状态里记下 `pendingSince = turn`，不调用 `inject`。

`agent/pre-step` 先 `await next()`，让链上其余监听器先决定这一步。之后：

- 没有排队的提醒：原样返回（每个会话的每一步都会走到这里，所以此路径不分配、不做 I/O）。
- 排队的提醒已不再该发（期间写过卡）：清掉排队，原样返回。
- 仅当以下条件**全部**成立，才把提醒追加到 `decision.messages` 末尾，并清掉排队、置 `reminded = true`：
  - `decision.kind === 'enter'`；
  - signal 未中止；
  - `turn > pendingSince`；
  - `decision.messages.length > 0`，即这一步本来就带有输入。

否则保持排队，等下一个满足条件的步骤。

**为什么用 `turn > pendingSinceTurn`，而不是“下一个 pre-step”：** `turn-stopping` 是 serial 事件，其他监听器可能 steer，让同一回合再跑一步。按回合号比较能保证提醒绝不落进它被安排的那个回合。

**为什么要求 `decision.messages.length > 0`：** 循环在 `turnEnds` 已设置且这一步没有任何消息时会直接结束回合，不发模型请求（`dsh-agent-loop` 的 `turn()` 循环）。如果插件此时塞进一条消息，就等于由插件自己强行开启一次模型请求，违背「提醒不自行开启回合」。所以提醒只搭乘一个本来就要运行的步骤。

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

监听器不使用 `prepend`，提醒追加在 `next()` 返回的消息**之后**，所以用户自己的消息一定排在提醒前面。

用真实 AgentLoop 实测过与 `prepend: true` 监听器（dsh-agent 自己的切模型提示就是这种）的相对位置：外层监听器包住我们的结果，因此它的通知会排在提醒**之后**。实测顺序为「用户消息 → 提醒 → 外层通知」。

这不影响目标：提醒不是回合的最后一条**助手**消息，也不改变用户消息的位置；消息之间的相对顺序对模型理解没有实质影响，所以不为此去抢 `prepend` 位置（那会和宿主的通知争位置，收益为零）。

### 4. 提醒文案保持原样

提醒现在随下一回合送达，措辞里的 “before finishing” 读起来略显滞后。已评估过改写文案（让模型在回复当前请求的同时写卡，并保持回答为最后一条消息），但**不在本变更里做**：

- 文案是模型可见行为，改它会同时改变写卡率，应当有独立的观察和回滚路径，与「修正投递时机」混在一起会让两种效果无法区分。
- 时机修正后，即使模型照旧写卡，回答也不再被挤到前面，目标问题已经解决。

文案若需调整，另开 change。

## Risks / Trade-offs

- **[用户不再发消息时就不写卡]** → 这是用户已接受的代价。召回引导里本来就要求“任务完成后写卡”，模型自觉写卡的路径不受影响。
- **[pre-step 的 `turn`/`step` 编号语义与假设不符]** → 已用真实 AgentLoop 集成测试证明（`lifecycle-runtime.test.ts`）：同一回合只发 1 次请求，提醒出现在下一回合的首个请求里且只出现一次；并用 5 个人为破坏实现的突变确认测试能抓住每一道保护（回合号判断、空步骤判断、送达前复核、会话重置清排队、回到「回合结束时 inject」）。
- **[子代理会话也会收到提醒]** → 行为和现在一样：子代理的 agent 有自己的 session 状态，没召回就不会安排提醒，本变更不扩大影响面。
- **[提醒出现在用户消息之后，模型可能先写卡、再回答]** → 这可以接受：写卡发生在回答之前，回答仍然是回合的最后一条消息，正好是我们想要的顺序。

## Migration Plan

不涉及数据迁移。改完后运行 `dsh build` 并重启 DSH 即可生效。回滚只需还原 `lifecycle/index.ts`，再重新 build。
