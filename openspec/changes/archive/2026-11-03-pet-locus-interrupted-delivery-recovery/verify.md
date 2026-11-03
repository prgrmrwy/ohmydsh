## Verification Results

### Task Completion
- [x] 1.1–4.4 全部实现与单测（`tasks.md` 已逐条标注实现位置与测试名）
- [x] 5.1 `openspec validate pet-locus-interrupted-delivery-recovery --strict` → valid
- [ ] **5.2 真机端到端未复现**：见 W1 —— 目标投递 `delivery-53` 在本修复进入运行进程**之前**已被旧代码按 deadline 结算，因此"启动时立即结算"这一路径没有在真机上跑过；其余验收项已通过（下表）
- [ ] 5.3 本文件（生成中）
- [ ] 5.4 spec 合并与归档：待 `pet-locus-shell-tier` 7.4 与 `pet-locus-feishu-read-and-delivery-fixes` 的归档顺序确定

### TDD Integrity
- [x] `test-plan.md` 6 条 scenario 全部映射到具名测试，台账全绿
- [x] 全量测试：`cd packages/dsh-pet && npx vitest run` → **3039 passed, 0 failed, 43 skipped**（171 文件：168 passed, 3 skipped）
- [x] `npx tsc --noEmit` 零错误
- [x] **红绿验证**：把 `reconcileStartup` 中 `interrupted` 结算分支临时禁用后，恢复级测试 `settles a current Delivery whose bound turn was interrupted, then frees the backlog` **转红**；恢复实现后转绿（本轮实际执行过，非事后声明）
- [x] 未删除或弱化任何既有断言：`test/locus-delivery.test.ts` / `test/locus-persistence.test.ts` / `test/locus-startup-recovery.test.ts` 均为新增用例；既有 25/42/14 条全部保持绿色

### Evidence

- 新增证明（`src/host/locus/startup-recovery.ts#proveInterruptedStartupDelivery`）单测覆盖：成立一例 + `it.each` 六类 fail-closed（turn 仍打开、原因 completed、原因 error、无进入消息、消息进入两次、绑定 turnId 不匹配、日志畸形）+ 空日志/无 `snapshotEvents`，另有"durable turnId 未绑定时仍可证明"一例。
- ledger 迁移 `abandonInterruptedDelivery`（`src/host/locus/delivery.ts`）单测：`current → failed` + `startupDisposition: 'turn-interrupted'` + 明确 `failureReason` + 保留 inbox/execution 证据 + 幂等拒绝；非 current 行 `invalid-transition`。
- 恢复级测试（`test/locus-persistence.test.ts`，真实 Domain + 真实 `reconcileStartup`）：`current`（已绑定 `turnId`/`executionId`/`inboxMessageId`）+ `interrupted` 证明 → `failedDeliveries` 命中、locus 保持 `active`、`claimCurrentDelivery` 立即提升 backlog 行；无证明 → 保持 `current` 且 `deadlineAt` 未被改动。
- 最小执行租约：`MIN_PROMOTED_DELIVERY_LEASE_MS`（10 分钟）三例 —— 临近/已过自身软租约的 backlog 行被提升后 `deadlineAt = now + 10min` 且可 `markFinishing`；接近 24h 硬上限时被压到硬上限之内；正常提升仍用自己的更长租约。
- **真数据回放（关键证据）**：把**真机** `delivery-53` 的持久记录与 child `session-1e2caf37-…` 的**真实会话日志**（185 条事件）喂给**已构建的** `lib/host/locus/startup-recovery.js`：
  ```
  proof = {"deliveryId":"delivery-53","executionId":"8daa3471-…","turnId":"session-1e2caf37-…#3","state":"interrupted"}
  ```
  即：修复后的判定对该真实数据成立，若修复已在运行，这条投递会在启动时被立即结算（而非等满 1 小时）。
- 构建与部署：`npm run build` 成功；`node scripts/sync.mjs` 两次（第二次 `no changes`）；`diff -rq packages/dsh-pet/lib ~/.dsh/profiles/web/node_modules/dsh-pet/lib` 无差异。
- 提交：`5479d623`（实现）、`5514bf05`（BACKLOG 状态）。

### 真机结果（2026-10-13，运行进程 PID 78305，11:20:22 启动）

| 事实 | 结果 |
|---|---|
| `delivery-53`（被重启打断的那条） | `status: expired`、`failureReason: 'delivery deadline expired'`、无 `startupDisposition` —— **旧代码按 deadline 于 02:32:44 结算**，不是本修复的路径 |
| `delivery-54`（后续消息） | `queuedAt 02:32:45 → startedAt 02:32:46 → finishedAt 02:33:03`，`replied` + `outboundResult: success` —— 等满原租约后被提升，约 18 秒内完成回复 |
| =前者说明 | 旧行为与诊断完全一致（"等满 1 小时、期间后续消息全被堵"）；本修复解决的正是这段等待 |
| 11:20 重启时的恢复 | 无 pending 投递（53 已终态、54 已回复），因此没有 `interrupted Deliveries settled without replay` 日志 —— 与"没有可结算对象"一致 |

### Review Integrity
- 本 change 未跑对抗式跨模型评审（规模小、纯启动恢复判定，且改动集中在既有证明函数与新 ledger 迁移）。已用"真数据回放 + 红绿验证 + fail-closed 六例"替代；如需，可补一轮定向评审。

## Warnings

- **W1 真机端到端未复现（未阻塞结论，但必须如实标注）**：`delivery-53` 在本修复进入运行进程之前就已被旧代码按 deadline 结算（02:32:44），所以"启动恢复立即结算 + 立即派发 backlog"这一条**只在单测/恢复级测试与真数据回放中验证过**，没有在真机上经历过一次真正的"重启打断进行中 turn"。要复现，需要在下一次真机验收中故意在投递处理中重启一次 Host。
- **W2 群内可见性**：被中断结算后，飞书侧仍只有原来的"进行中"表情，用户不会自动看到"这条被中断了"。本 change 只在持久记录与启动日志里可诊断（设计 D4/Deferred 已记录）。
- **W3 缺少 `turn/end` 的 open turn 仍保持等待**：强杀导致日志停在 open turn 时，判定与既有一致（不推断），仍会等到租约。属 Deferred 明确范围。
- **W4 provider 抖动**：三条投递（51/52/54）的 turn 在业务回复**之后**都命中过 codex pool `EMPTY_RESPONSE`（DSH 自动重试），与本 change 无关，不影响已发出的回复与已结算的 Delivery。

## Overall Decision

DECISION: PASS_WITH_WARNINGS

⚠️ 实现、测试、构建、部署均完成，且判定已用**真实持久记录 + 真实会话日志**回放验证；唯一警告是"启动立即结算"这一路径尚未在真机上经历一次真实的重启打断（W1），因此本 change **可以随该 change 一起归档，但 W1 应保留在归档说明里**，并在下一次真机重启打断时补验。
