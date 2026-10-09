# G1 实测证据：executor 会话的用户消息事件形状

被测运行时：**DSH 0.2.0-rc.2**，fingerprint `1ec78f6713be97a4ac31124d61d766842eac098abd51e745120d894e66f7d674`
（现役 Host 进程即 `…/.launcher/node_modules/@deepseek-ai/dsh/lib/bin.js web`，见 `~/.dsh/dsh-startup.log` 末条）。
结论来源分两部分：真实会话日志（本机 `~/.dsh/sessions/…/session.v4.jsonl.zstd`）与 0.2.0-rc.2 发布物源码。

## 1. 真实事件序列（executor 会话 `session-26ecffef-…`）

| seq | 事件 | target | `source.kind` | 带 `rpcId` | 内容 |
| --- | --- | --- | --- | --- | --- |
| 3 | `agent/inbox/spliced` | `next-step` | `plugin:dsh-memex` | 否 | Memex 常驻提醒（宿主注入） |
| 5 | `agent/inbox/spliced` | `next-turn` | `user` | **否** | `/ws clean specified` + Pet Invocation envelope（**Pet 自己派发**） |
| 6 | `turn/start` | — | — | — | turn 1（该 Invocation 的轮次） |
| 74 | `agent/inbox/spliced` | `next-turn` | `user` | **是** `e09f015b-…` | `放弃这个分支把`（GUI 真人直输） |
| 75 | `turn/start` | — | — | — | turn 2（无 Invocation → 复现本 bug） |
| 134 | `agent/inbox/spliced` | `next-turn` | `user` | **是** `8172a1f3-…` | `清理`（GUI 真人直输） |
| 135 | `turn/start` | — | — | — | turn 3（**再次**复现同一错误） |

结论：

- **splice 先于 `turn/start`**（相邻 seq），因此 Pet 的 `session/event` 观察者能在该轮第一个模型步骤之前看到被插入的消息。
- **Pet 自身派发与 GUI 直输可区分**：Pet 用 `createUserMessage({ source: { kind: 'user' } })`，**不带 `rpcId`**；GUI 提交带 `rpcId` 与 `clientTimeZone`。

## 2. 宿主注入与其它来源的 `source.kind`

同一 Host 上实际观察到的注入种类（均**不**是 `user`）：`plugin:dsh-memex`、`time-context`、`agent-instructions`、`runtime-context`、`skill-catalog`、`skill-invocation`。
（来源会话 `session-ed30315d-…` 的 648 条事件中，所有宿主注入均为上述种类；`kind: 'user'` 只出现在 GUI 提交上。）

源码侧枚举 `source: { kind: "user" }` 的生产者：`dsh-acp`、`dsh-command-goal`、`dsh-commands`、`dsh-headless`、`dsh-plan-mode`、`dsh-sdk-jsonrpc-server`、`dsh-session-title`、`dsh-session-format-v2-to-v3`，以及 Pet 自己的 dispatcher——**都不带 `rpcId`**。

## 3. `rpcId` 的宿主生产者

| 位置 | 用途 | 目标会话 |
| --- | --- | --- |
| `dsh-api-session-controller/lib/index.js:858` | Web/GUI `prompt()`：`source = { kind: 'user', rpcId: request.requestId, clientTimeZone? }` | 任意被 prompt 的会话（含 Pet root executor） |
| `dsh-subagent/lib/index.js:3356` | 把「浏览器撰写的消息」投递给 continuable child | **只**是某个父会话的 child（Pet root executor 从不是这种投递目标） |

宿主自身的同一判据（可作先例）：`dsh-api-session-controller` 的 `hasPromptRequest` 用
`source.kind === 'user' && 'rpcId' in source && source.rpcId === requestId` 识别「这条消息是不是某次客户端提交」。

## 4. 其它已核对的接缝

- `agent/inbox/spliced` 载荷（`dsh-session` 事件声明的原文）：
  `{ target: InboxTarget; start: number; removedCount?: number; inserted: UserMessage[]; outcome?: 'canceled' }` —— 直接携带完整 `UserMessage`，含 `source`。
- `agent/inbox/claimed` 载荷 `{ agent, message, turn }`（`dsh-agent-loop/lib/index.js:106` 发射）——给出「本轮消费了哪条消息」。
- `session/event` 对每个 append 的事件发布（`dsh-session/lib/index.js:1468-1473`），因此 splice / claim 都可从 `ctx.on('session/event')` 观察。
- `Agent.inbox` 存在且 `InboxState.nextTurn` / `nextStep` 可读（`dsh-agent/lib/types/runtime-types.d.ts:43,145`），可用于「executor 会话里是否还排着真人消息」这一只读探测。

## 5. 由 G1 推出的识别判据（已写入实现）

一条消息可作为「会话内真人直输」候选，当且仅当：

1. 它经 `agent/inbox/spliced` 进入会话，且 `source.kind === 'user'`、`rpcId` 为非空字符串；
2. 其目标会话是**未归档 Pet Task 的 root executor**（排除 `qa-chat` fork-child 形态与 unified locus child）；
3. 它不是 Pet 派发簿记拥有的消息（envelope 本身不带 `rpcId`，另以派发消息 id 做冗余校验）。

## 6. 结论对实施的影响

- 任务 1.4 的降级分支**不触发**：判据可证明，登记路径按原设计实施。
- 残余注意：`rpcId` 存在本身不构成“只有 GUI 能产生”的证明（`dsh-subagent.prompt()` 也发 `rpcId`），因此识别必须叠加第 2 条（目标会话身份）——这一点已体现在实现与测试里。
