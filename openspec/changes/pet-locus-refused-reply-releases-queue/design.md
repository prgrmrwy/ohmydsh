# Design

## Context

见 proposal.md - Why。相关现状（`packages/dsh-pet`）：

- finish/wait 的授权拒绝统一经 `src/host/tools.ts` 的 `rejectAuthorization` 抛出，并回调 `logAuthorizationRefusal({operation, reason})`；`src/index.ts` 目前只用它写日志。该回调不携带 caller，也不携带执行证明。
- `src/host/locus/turn-observer.ts` 的 `settleTurn` 把 turn 结束当作纯诊断：不发终态事件、不清 current 血缘（这是"turn 结束不完成请求"的实现），因此不能直接在那里收尾。
- 已有"current 永远无法完成"的终结迁移 `abandonInterruptedDelivery`（`src/host/locus/delivery.ts`，`failed` + `startupDisposition: 'turn-interrupted'`），以及 controller 端 `settleByTurn`（要求精确 deliveryId/executionId/turn 关联）和既有失败反馈。
- caller-bound 的当前执行证明为 `currentCapabilityForChild(childSessionId)` → `{deliveryId, executionId, turnId, ...}`；拒绝发生时证明可能不可用（拒绝本身常常正是因为证明不成立）。

## Goals / Non-Goals

**Goals:**
- 被拒且本轮未续进的 current Delivery 在该轮结束时以 `failed/reply-refused` 终结，并推进队列、给失败反馈。
- 终结目标必须精确：只能是拒绝发生时该 child 唯一的 persistent current，且终结时它仍是同一行、同一 revision 链上的 current。

**Non-Goals:**
- 不改变任何授权判定；不新增可绕过 mixed-source 的路径。
- 不处理"本轮未调用 finish 就结束"的 Delivery（仍按既有规则保持 current）。
- 不处理 Host 进程在被拒轮结束前崩溃的情形（重启后由既有启动恢复与期限处理）。

## Decisions

### D1. 记录粒度：按 (childSessionId, turn) 记"本轮曾被拒"，不依赖执行证明

拒绝时执行证明常常不成立，所以不能以 executionId 作键。Host 在拒绝回调里记录 `{childSessionId, turn, deliveryId}`：
- `turn` 取自当前工具执行（ToolExecution 已带 agent/turn）；
- `deliveryId` 取自持久层该 child 所在 active locus 的唯一 current（`getCurrentDelivery` 一类只读查询）；不存在或不唯一则不记录（fail closed：不收尾）。

为此给 `logAuthorizationRefusal` 增加可选的 `{childSessionId, turn}` 上下文（由 tools.ts 在已知 execution 时填入），旧调用方不受影响。

**替代方案**：在 turn-observer 内部记录——被否，因为观察者不知道工具调用结果，且把收尾逻辑塞进观察者会破坏其"turn 结束只做诊断"的不变量。

### D2. wait/finish 成功清除本轮标记

同一 (child, turn) 内 finish 成功或 wait 成功时，删除该标记。成功路径已在 `finishCurrentDelivery` / `waitCurrentDelivery` 内部，取其 caller 与 turn 删除即可。

### D3. 在该 child 的 `turn/end` 时收尾

监听 Host 级 `session/event` 的 `turn/end`（与 observer 同源）。若存在 (child, turn) 标记：
1. 重新读取持久层：该 child 的唯一 current 仍是标记中的 deliveryId，且状态为 `current`；
2. 以新的 delivery 迁移 `abandonRefusedDelivery`（与 `abandonInterruptedDelivery` 同形，`failed`、`failureReason: 'reply-refused'`、不设 `startupDisposition`）经 repository 原子提交；revision 不符、已终态、已不是 current 一律放弃；
3. 提交成功后走既有的终结后路径：撤销该 child 的当前 capability（`revokeCurrentCapability`）、应用失败反馈、`dispatchNext` 推进队列。复用期限过期分支已有的"终结→推进"实现，而不是另写一份。

标记用后即删；turn/end 处理异步且失败只记日志（与现有 turn/end 处理一致）。

**替代方案**：被拒即刻收尾——被否，会误杀同轮内改正或转为 wait 的合法请求（proposal 已说明）。

### D4. 反馈与日志

失败反馈复用期限过期/投递失败的同一表情路径；日志一行 `dsh-pet locus delivery released: reply-refused`，只含原因码，不含 chat/message 标识或正文。

## Risks / Trade-offs

- 被拒后反复 `wait` 仍可把队列堵到期限上限：这是 child 主动声明继续等待，规格本就允许，属有意保留。
- 标记只在进程内：Host 在被拒轮结束前重启会丢标记，回退到期限处理（与修改前一致，不更差）。
- 拒绝回调里取"唯一 current"是持久查询，拒绝本就少见，成本可忽略。
