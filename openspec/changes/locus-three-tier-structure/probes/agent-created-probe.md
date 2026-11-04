# agent/created 运行时探针（2026-11-03）

**环境**：官方未打补丁的 DSH 0.2.0-rc.2 包（主 checkout `node_modules/@deepseek-ai/*`，确认不含 `settlementNotice`/`createIdleContinuable`/`withLiveContinuableChildSession`），纯运行时装配：cordis Context + session/jsonl 持久化（临时目录）+ session-query + agent/llm/tools/prompt/projection + agent-loop + subagent + spawn provider，假模型。无 Host、无 `~/.dsh`、未触碰日常 DSH。脚本：[agent-created-probe.mjs](agent-created-probe.mjs)，运行 `node agent-created-probe.mjs <含 node_modules 的目录>`，连续两次结果一致。

**结果**（时间为相对毫秒）：

| 模式 | 观察 |
|---|---|
| observe | `startContinuable`：子会话 `agent/created source=startup`（+28）→ 首条 prompt 被认领 turn 1（+30）→ `startContinuable` 返回（+32）→ 父会话被结算通知唤醒 turn 1（+39）。子会话空闲后自动释放（+58 已不常驻）。`sendMessage`：`agent/created source=resume`（+71）→ turn 2 认领（+71）→ `sendMessage` 返回 |
| veto-resume | 监听器在 `source=resume` 时抛错 → `sendMessage` 被拒（`subagent ... is unavailable`），没有 turn 2 |
| veto-create | 监听器在创建时抛错 → `startContinuable` 被拒，首条 prompt 没有被认领 |

**结论**：
1. 冷恢复经过 `agent/created`（`source:'resume'`），且监听器失败会让恢复失败、本轮不执行 —— design 决策 6 的前提成立。与静态阅读一致：`agents.resume` → `setupAndPublish(..., "resume")` → `agents.announce`（`dsh-agent-loop` 1970 行、`dsh-agent` 579 行）。
2. 首条 prompt 创建时，`agent/created` 先于首轮认领；创建期监听器失败时首轮业务请求未执行。
3. **新约束**：`startContinuable` 在首轮已被认领**之后**才返回，因此 Host 不能等它返回再发布子会话/marker/current 关联，必须在 `agent/created` 内用预留的 `childId` 完成发布，否则首轮工具调用会先于关联发布。可沿用现有 `prepublication-staging` 的身份桥，但其持久发布与失败补偿时序要调整（现有 `child.ts` 在 await 返回后才置 active）。本探针只观察了回调→认领→返回的顺序，未覆盖 Pet 内的预留发布、首个业务工具与持久回滚，这些由实施测试补齐；探针以 exit 0 结束，不能当门禁。
4. 官方默认结算通知会唤醒父会话（这里父即 locus 主会话），与 design 决策 4 一致。

**未覆盖**：本探针不含 Pet 与 compat 补丁图、不含真实模型与工具调用；名额不足、Host 重启后的冷恢复留到实施后的隔离预览与真机验收（tasks 最后一组）。
