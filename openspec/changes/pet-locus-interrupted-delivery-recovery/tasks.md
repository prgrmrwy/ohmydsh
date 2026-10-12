## 1. 证据与迁移

- [x] 1.1 `startup-recovery.ts`：新增 `proveInterruptedStartupDelivery`，返回 `{ state: 'interrupted', turnId }`；严格复用既有折叠语义（畸形事件/turn 重叠/绑定不匹配 → undefined）
- [x] 1.2 `delivery.ts`：`DeliveryRecord.startupDisposition` 增加 `'turn-interrupted'`；新增 ledger 迁移 `abandonInterruptedDelivery`（`current → failed`，`failedAt`、明确 `failureReason`）
- [x] 1.3 `persistence.ts`：`LocusStartupDeliveryProof` 增加 `interrupted`；状态校验补 `turn-interrupted` 分支（保留 inbox/execution 证明）

## 2. 启动恢复接入

- [x] 2.1 `persistence.ts#reconcileStartup`：对 `current` 行也请求一次 `deliveryProof`；命中 `interrupted`（且 deliveryId/executionId/turnId 一致）→ 立即结算（`invalidateLocus = false`）并计入 `failedDeliveries`
- [x] 2.2 结算后该 locus 处于"有 backlog、无 current"：确认启动排空会提升并派发下一条（不新增代码，用测试钉住）→ `test/locus-persistence.test.ts`（`… then frees the backlog`）
- [x] 2.3 `index.ts`：把新证明接入 `deliveryProof` 组合链（running → interrupted → unconsumed），并在启动日志单独报出被中断结算的条数

## 3. 被提升行的最小执行租约

- [x] 3.1 `delivery.ts`：新增 `MIN_PROMOTED_DELIVERY_LEASE_MS`（10 分钟）；`claimCurrentDelivery` 提升 backlog 行时把 `deadlineAt` 抬到至少 `now + 最小租约`，上限为 24h 硬上限
- [x] 3.2 单测：临近/已过自身软租约的 backlog 行被提升后仍可 `markFinishing`；硬上限不被突破；正常行不受影响 → `test/locus-delivery.test.ts`（三例）

## 4. 测试

- [x] 4.1 interrupted 证明成立与 fail-closed → `test/locus-startup-recovery.test.ts`（`proves an interrupted bound turn and never a still-open one`、`refuses to prove when …` 六例 it.each、`refuses an empty log and a session without events`）
- [x] 4.2 `test/locus-delivery.test.ts`：`abandonInterruptedDelivery` 只在 `current` 上生效、产出终态与处置标记、幂等（已终态不再变）
- [x] 4.3 恢复级测试：`current` + 已中断 turn → 结算；无证据 → 保持 current 与既有等待语义；结算后 backlog 行可被提升
- [x] 4.4 全量 `npx vitest run`（3039 passed / 0 failed / 43 skipped）+ `npm run typecheck` 零错误

## 5. 验证与收尾

- [x] 5.1 `openspec validate pet-locus-interrupted-delivery-recovery --strict`
- [ ] 5.2 真机：所有者重启后确认 `delivery-53` 结算为 `failed/turn-interrupted`、`delivery-54` 立即派发并回复；补跑 7.5 剩余项（未知参数拒绝、伪造游标、守卫文案、话题入口）
- [ ] 5.3 `verify.md`：任务完成、test-plan 全绿、全量测试与真机证据
- [ ] 5.4 spec 合并与归档（待 `pet-locus-shell-tier` 7.4 与 `pet-locus-feishu-read-and-delivery-fixes` 归档顺序确定）
