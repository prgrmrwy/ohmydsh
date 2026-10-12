## Context

- 统一 locus 的 Delivery 生命周期：`accepted → (backlog) → current → finishing → replied/no-reply`，另有 deadline 过期与启动恢复两条异常路径（见 `packages/dsh-pet/src/host/locus/delivery.ts`、`persistence.ts#reconcileStartup`）。
- 启动恢复已有两种精确证明（`src/host/locus/startup-recovery.ts`）：
  - `proveLiveStartupDelivery` → `running`：child 会话里存在**仍未结束**的 turn，且进入过该 Delivery 的 `inboxMessageId`；
  - `proveUnconsumedStartupDelivery` → `unconsumed`：从未有 turn 进入过该消息，且它已不在 child 的 `next-turn` 队列里。
- 对 `current` 行，`reconcileStartup` 仅在 `turnId === undefined` 时才请求证明，用于"派发在交接前死掉"的重派；**已绑定 turnId 的行被直接保留**（注释：*"序列化 current 即物理派发栅栏，不需要 open-turn 证明即可存活重启"*），只能由 `deadlineAt` 结算。
- 2026-10-13 真机：这条规则在"重启打断进行中的 turn"这一形态下产生 1 小时静默阻塞（见 `proposal.md`）。

## Decisions

### D1 新增第三种证明：`interrupted`

`startup-recovery.ts` 增加 `proveInterruptedStartupDelivery`，返回 `LocusStartupDeliveryProof` 的新状态 `{ state: 'interrupted', turnId }`。

判定严格复用既有折叠语义并保持同等保守：

- 前置：`delivery.executionId` 与 `delivery.inboxMessageId` 都存在，`session.snapshotEvents()` 可读且非空；任何畸形事件、`turn/start` 与已打开 turn 重叠、`turn/end` 与打开 turn 不匹配，一律 `undefined`。
- 必须**恰好一次**有 `user/message` 的身份等于 `delivery.inboxMessageId` 落在某个 turn 内；
- 该 turn **已结束**，且其 `turn/end` 的 `reason.kind` 为 `interrupted`；
- 该 turn 仍打开 → `undefined`（属 `running`，不是本规则）；
- 结束原因不是 `interrupted`（`completed`/`error`/其它）→ `undefined`（本 change 明确不改这些语义）；
- 若记录已绑定 `turnId`，折叠出的 turn 必须与之一致，否则 `undefined`。

判据刻意**不依赖"这是一次重启"**：`interrupted` 只表示"这个 turn 已经结束、且不是正常完成"，无论由重启、abort 还是 dispose 造成，结论都一样——它不会再结算这条 Delivery。

替代方案与取舍：

- *按进程代际（PID/启动时刻）判定*：拿不到"这个 turn 属于哪个进程"的持久事实，会退化成启发式；
- *按时间（例如 startedAt 早于本次启动）判定*：会话日志里存在"打开但缺结束事件"的 turn（强杀），时间判据会把可能仍在执行的 turn 误判为死；
- *直接对所有 current 行提前过期*：会丢掉 deadline 语义，且把"child 忘了 `finish`"这类仍可能自愈的情形也一并杀掉。
  因此只认显式 `interrupted` 这一条持久证据。

### D2 结算形态：终态 `failed` + `startupDisposition: 'turn-interrupted'`

- 新增 ledger 迁移 `abandonInterruptedDelivery`（`delivery.ts`）：只接受 `status === 'current'` 的行，产出 `status: 'failed'`、`startupDisposition: 'turn-interrupted'`、`failedAt: now`、`failureReason` 明确写出"turn 被中断、内容已送达、不重发"。
- **不用 deadline 过期**：`expireDelivery` 明确要求 `now >= dueAt`（`deadline-not-reached`），而本场景恰恰是"还没到期但已经不可能完成"；也不该借用 `expired` 的语义，否则用户分不清"等超时"与"被中断"。
- **不重发**：内容已进入 child inbox（`inboxMessageId` 绑定在先），策略 A 判据不变；本规则只把"不可能再完成"这件事尽快落到终态。
- 结算时 `invalidateLocus = false`：locus 本身健康，被销毁的只是这一个 turn；locus 保持 active，交给启动排空去派发 backlog。

### D3 被提升行的最小执行租约

`claimCurrentDelivery` 在把 backlog 行提升为 `current` 时，把 `deadlineAt` 至少抬到 `now + MIN_PROMOTED_DELIVERY_LEASE_MS`（默认 10 分钟），并以 `hardDeadlineAt`（缺省 `acceptedAt + 24h`）为上限。

理由：backlog 行的租约按 `acceptedAt` 计时，长时间排队后可能只剩几十秒；现有实现会让它被提升后立刻在 `markFinishing` 处以 `deadline-expired` 失败，形成"提升即到期"的循环。抬升只影响 soft deadline，24h 硬上限与所有 CAS/过期语义不变。

### D4 fail-closed 边界（明确不做的判定）

- 打开但缺 `turn/end` 的 turn：保持现状（等待），不做推断——强杀与"仍在执行"在日志上不可区分。
- `turn/end` 原因为 `completed`：child 可能只是没调用 `pet_locus_finish`，属既有语义（等到 deadline），本 change 不动。
- `turn/end` 原因为 `error`：进程仍在时 DSH 会重试/继续，属正常路径，本 change 不动。
- 证据读取失败（child 无法 adopt、日志抛错）：与现有 `deliveryProof` 一致地返回 `undefined`，保持等待。

## Risks / Trade-offs

- **误判风险**：把"其实还能完成"的投递结算掉。缓解：只认 `interrupted` 这一显式结束标记；`interrupted` 意味着该 turn 已结束，DQ 不存在"稍后自行完成"的路径。
- **可见性**：结算后飞书侧仍只有一个进行中表情，用户不会自动看到"这条被中断了"。本 change 只在持久记录与启动日志里可诊断（`locus recovery: N interrupted …`），群内回执属产品决策，列入 Deferred。
- **启动开销**：`current` 行现在也会请求一次 `deliveryProof`（可能触发 child adopt + 会话读取）。仅发生在启动、且行数有限；对已绑定 turnId 的行这是从"完全不查"变为"查一次"，换取不再静默阻塞一小时。
- **不变量**：结算沿用 ledger 的终态写入路径（`writeDelivery`），并扩展状态校验对 `startupDisposition: 'turn-interrupted'` 的约束（要求保留 inbox/execution 证明）；不新增任何可被模型调用的入口。

## Migration / Rollback

- 无 schema 版本变化、无数据迁移：`startupDisposition` 是多态可选字段，旧行照旧解释。
- 回滚：revert 本 change + `dsh build` + 重启；已按新规则结算的行保持终态（本就无法完成），不会因回滚而复生。

## Verification

- 单测：`test/locus-interrupted-recovery.test.ts`（证明的三态与 fail-closed）、`test/locus-delivery.test.ts`（`abandonInterruptedDelivery` 迁移、最小租约）、`test/locus-persistence.test.ts` / `test/locus-startup-recovery.test.ts`（结算后 backlog 可派发、busy 语义）。
- 真机：所有者重启后确认 `delivery-53` 被结算为 `failed/turn-interrupted`、`delivery-54` 被提升并回复（见 `verify.md`）。
