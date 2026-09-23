# 批 A：移除 isolateQueuedTurnClaim（从未启用的 seam）

## 结论

**已移除。compat 的上游包从 3 个降到 1 个，patch 从 40 hunks 降到 32。**

`dsh-agent` 与 `dsh-agent-loop` 现在解析到**官方原版** `0.1.5-rc.3`，不再被覆盖。

## 移除依据（四条独立事实）

| 事实 | 证据 |
|---|---|
| **从未在生产启用** | `build-launcher.cjs` 的 `overrideRuntimeAgent = false`，`expectedRuntimeAgent` 恒为空数组；注释记录原因为 npm 11.19.0 arborist 崩溃（`TypeError: Cannot read properties of null (reading 'matches')` at `Link.matches` → `CanPlaceDep.canPlacePeers`） |
| **无存量数据** | 生产库副本实测：`u_dsh_pet_inquiries` **0 行**、`u_dsh_pet_inquiry_results` **0 行** |
| **产品路径已被替代** | 推送式派发因「处理不了注意力问题」被所有者否决；实际在用的是拉取式上下文工具 |
| **与保留能力无依赖** | 记台账（`pet_inquire` 写库）不经过 claim；拉取式工具是纯读，不碰 inbox |

### 关键区分：拉取 vs 推送

`pet_locus_parent_lookup` 的官方工具描述逐字写明：

> returns your caller-bound main session's **already-persisted transcript** … It is a **pure data read**: it **never wakes the main session, never occupies its run slot**, and **multiple children may call it concurrently**.

即子代获取父/兄弟上下文走的是**拉取**，从设计上就绕开了 claim 机制。`isolateQueuedTurnClaim` 只服务于**推送派发**（忙时排队、不 steer 当前任务），二者正交。

### 一次被实测证伪的判断

曾因 `scheduler.ts:513` 的注释——

> the inquiry remains exactly where it was, so a rebuilt runtime can dispatch it later

——推断「队列里可能攒着待派发的存量 inquiry」，并据此主张保留 patch。**查表后为 0 行**，该论据不成立。注释描述的是可能性，不是事实。

## 实际改动

| 文件 | 改动 |
|---|---|
| `settlement-notice.patch` | 移除 5 个文件的 8 个 hunks（`core/agent-loop` 的 agent.ts / inbox.ts / index.ts / inbox.spec.ts，`core/agent` 的 runtime-types.ts） |
| `build-launcher.cjs` | 删 `overrideRuntimeAgent` / `expectedRuntimeAgent` / `agentPatchVersion`；删 56 行能力校验（含 Inbox 活体行为实验）；从 overrides、`npm ls` 证明与 package-copy 表中移除 agent 对 |
| `build.mjs` | 删 30 行 agent 产物构建；删 24 行 isolated-claim 校验；从上游测试列表移除 `inbox.spec.ts`（patch 已不再改它） |
| 两个 builder | patch SHA-256 重新固定：`68f9531a…` → `8bcf808c…` |
| `.gitignore` | 保留 `agent-artifacts/` 条目并注明原因（防旧残留被误提交） |
| `tests/pet-locus-runtime-override.test.mjs` | 旧断言（要求 patch 含 `isolateQueuedTurn`）替换为**新不变量**：patch 必须只触及 `subagent/subagent` 一个上游包，且不得含 isolated-claim 痕迹 |

### 刻意未改动

`detectIsolatedQueuedTurnClaim`（`src/host/inquiry/capability.ts`）与 `InquiryScheduler` 的 fail-closed 门禁**保持原样**。它们是 Pet 自有代码、属并行 change `pet-locus-independent-agent-inquiries` 的产品语义，不在本 change 范围。marker 探测不到时它们照常给出确定性拒绝（`reason: 'isolated-claim-unsupported'`，不消费任何队列状态），行为与移除前完全一致。

## 验证

| 项 | 结果 |
|---|---|
| launcher 重建 | 成功，新 fingerprint `7bfb7330…` |
| `dsh-agent` / `dsh-agent-loop` 解析 | **官方原版 `0.1.5-rc.3`**（`[compat]` 标记消失） |
| `dsh-subagent` | 仍为 `0.1.5-rc.2-locus-settlement-notice.2` |
| storage 三件套 | 仍为 `0.1.5-rc.2-locus-atomic.2` |
| patch 最终形态 | 32 hunks / 上游包仅 `subagent/subagent` |
| `agent-artifacts/` | 不再生成，旧残留已清理 |
| 根测试 | **139 pass / 0 fail**（基线 134 + provenance 4 + 本批 1） |
| Pet 测试 | **2710 passed / 43 skipped**（基线 2696 / 43；skip 数未变） |

Pet 测试数 +14 而非减少：移除的是 compat patch 里的上游测试，不是 Pet 自己的测试；Pet 侧 fail-closed 用例全部保留并通过。

## 遗留

Host **未重启**（按用户要求）。运行中的进程仍持有旧 launcher（`cef535d8…`），重启后才切换到 `7bfb7330…`。两代均保留可回滚。
