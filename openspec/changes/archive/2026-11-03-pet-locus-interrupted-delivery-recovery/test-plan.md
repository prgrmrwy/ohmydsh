## Test Plan

每个 `#### Scenario:`（共 6 条）映射到至少一个具名测试；映射是下限不是上限。

运行方式：`cd packages/dsh-pet && npx vitest run <文件>`。

状态图例：🔴 red（先失败后通过）、🟡 pin（为既有行为钉钉子，首次即绿）、🟢 green（已通过，附实际测试名）。

| Scenario | Test File | Test Name | Initial State |
|---|---|---|---|
| 重启打断进行中的 turn | `test/locus-startup-recovery.test.ts`、`test/locus-persistence.test.ts` | `proves an interrupted bound turn and never a still-open one`；`settles a current Delivery whose bound turn was interrupted, then frees the backlog` | 🟢 green |
| 结算后不再占用 current 位置 | `test/locus-persistence.test.ts` | `settles a current Delivery whose bound turn was interrupted, then frees the backlog`（结算后 `claimCurrentDelivery` 立即提升 backlog 行） | 🟢 green |
| 结算原因是可诊断的 | `test/locus-delivery.test.ts` | `abandons an interrupted current Delivery with a diagnosable reason, never a resend` | 🟢 green |
| 证据不足时不结算 | `test/locus-startup-recovery.test.ts`、`test/locus-persistence.test.ts` | `proves an interrupted bound turn and never a still-open one`；`refuses to prove when the turn completed normally`；`refuses to prove when the turn ended with an error`；`refuses to prove when the durable turn id does not match the log`；`refuses an empty log and a session without events`；`keeps an unproven current Delivery waiting instead of settling it early` | 🟢 green |
| 被提升的投递获得最小执行租约 | `test/locus-delivery.test.ts` | `gives a promoted backlog Delivery a minimum lease without breaking the hard cap`；`never extends a promotion past the 24-hour hard cap`；`leaves a fresh promotion on its own longer lease` | 🟢 green |
| 不重发正文 | `test/locus-persistence.test.ts`、`test/locus-delivery.test.ts` | `settles a current Delivery whose bound turn was interrupted, then frees the backlog`（保留 inbox 证据、无重派）；`abandons an interrupted current Delivery with a diagnosable reason, never a resend`（终态且幂等拒绝） | 🟢 green |
