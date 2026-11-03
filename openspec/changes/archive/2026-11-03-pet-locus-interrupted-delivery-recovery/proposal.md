## Why

2026-10-13 真机验收 `pet-locus-feishu-read-and-delivery-fixes` 7.5 时实测到一条**可证明已死**的投递把整个入口堵了 1 小时：

- 群 `oc_6847047be0e4310c404a8a41ed068365`，`delivery-53` 于 01:32:44 受理、01:32:45 入队（`inboxMessageId` 已绑定）、01:32:46 `startedAt`，child 开始跑 turn 3。
- Host 于 **01:33:35 重启**；child 会话日志随后写入 `turn/end {reason: {kind: "interrupted"}}`，之后**再无任何 turn** —— 这条投递永远不会有人结算。
- 重启恢复只报告 `1 pending Deliveries … no side effect replayed`：`reconcileStartup` 对**已绑定 `turnId`** 的 `current` 行采取"序列化 current 即物理派发栅栏，无需 open-turn 证明即可存活重启"，于是它只能等自己的 `deadlineAt = 受理时刻 + 1h`（02:32:44）。
- 后续 `delivery-54`（01:34:27 受理）只能停在 `accepted`/`backlog`：用户看到两条消息各有一个表情，**最长一小时没有任何回复，也没有任何解释**。
- 附带风险：backlog 行被提升时租约仍从它**自己的 `acceptedAt`** 起算。本例 `delivery-54` 在 02:32:44 被提升时只剩约 100 秒，再被提升即到期就会重演同一循环。

**根因**：`startup-recovery.ts` 只实现了两种启动证明——"仍是当前 open turn"（`running`）与"从未被消费"（`unconsumed`）——**缺少"绑定 turn 已被证明中断"这第三种**；而第三种所需的证据是持久且精确的：child 会话日志中该 turn 有 `turn/end`、原因为 `interrupted`、该投递 `outboundResult` 仍为 `none`、无 `finishOutcome`。

## What Changes

- **启动恢复新增第三种证明**：绑定 turn 以 `interrupted` 结束时，该投递被证明"不可能再被结算"。
- **立即结算，不重发正文**：命中该证明的 `current` 投递 SHALL 以终态 `failed`（`startupDisposition: 'turn-interrupted'`）结算，`outboundResult: 'none'`，并带上可诊断的失败原因；**MUST NOT 重发消息正文**——内容已进入 child inbox（绑定已提交），按既有"送达即送达"策略 A 计为已送达，结算是承认"不会有回复"，不是重试。
- **backlog 立即放行**：结算后该 locus 处于"有 backlog、无 current"状态，启动排空 SHALL 立刻提升并派发下一条，MUST NOT 让后续消息继续等待原投递的完整租约。
- **被提升行获得最小执行租约**：backlog → current 时，若其剩余租约不足最小执行租约，SHALL 提升到 `now + 最小执行租约`（不超过 24h 硬上限），避免"提升即到期"。
- **fail closed**：证据不足或歧义（turn 仍未结束、`turn/end` 原因不是 `interrupted`、inbox 绑定不匹配、日志不可读）时 SHALL 保持现有等待语义，MUST NOT 猜测、MUST NOT 提前结算。
- **可诊断**：结算原因 SHALL 明确说明"turn 被中断且不重发"，而不是笼统的 `delivery deadline expired`；启动日志 SHALL 单独报出被中断结算的条数。

## Capabilities

- `pet-locus-collaboration`：新增一条 requirement，规定启动恢复对被中断投递的处理、最小执行租约与 fail-closed 边界。

## Non-goals

- 不改投递结算的正常路径（`pet_locus_finish`、deadline 过期、`unknown-terminal`）。
- 不改"已送达不重发前言/正文"的策略 A 判据。
- 不引入任何手工/管理面"作废投递"入口；本 change 只改启动恢复的自动判定。
- 不处理 `turn/end` 原因为 `completed`/`error` 的投递（child 进程仍在时的既有语义不变），也不处理"open turn 但缺少结束事件"的日志（保持等待，留待后续按证据评估）。
- 不改 `dsh.yaml`、DSH core 或身份策略；不涉及 user 身份回落（U006）与 spill 读取（U007）。

## Deferred

- **缺少 `turn/end` 的 open turn**：进程被强杀（无优雅中断事件）时日志可能停在 open turn，现有代码按"仍可能执行"保留。是否可用进程代际 + 会话最后写入时刻判定留待后续评估（本次先只认显式 `interrupted`，避免把"仍在跑的 turn"误判为死）。
- **投递过期后的用户可见性**：被中断结算目前只在持久记录与日志可诊断，飞书侧仍只留一个进行中表情。要不要给群内可诊断回执，属产品决策。
