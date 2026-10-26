## Why

AUTO 的分配反馈目前只有用户主动点击的显式评价。实际使用中几乎不点，偶尔点的多半是“觉得不对”的时候，于是已有标签既稀少又偏向负例，无法回答“初始策略是否合适”，也无法为后续的旁路评审器提供校准对照。

“没点”本身含有信息，但混着三种情况：看过且无异议、根本没看到、觉得不对但没点或直接干预了。只有先记录“是否看过”和“之后有没有干预、会话是否继续”这些事实，才能把第一种分离出来。这些事实不需要调用模型，也不打扰主会话，可以先跑一段时间，用数据决定是否值得做旁路评审。

## What Changes

- 在已应用主 AUTO 决策的回复上记录**曝光事实**：回复在可见页面中持续可见达到阈值时，记一次 observation；未达到不记。
- Host 从会话事件和模式切换中记录**行为事实**：该决策所在回合的结束原因（完成、被用户中止等）、下一个用户回合之前是否切到 MANUAL、会话是否以新的用户回合继续。
- 上述事实作为独立事件追加到现有反馈账本，按 `(sessionId, decisionId)` 关联；不改写决策快照，不合并到显式反馈。
- 按需报告为每个比较子组增加隐式信号分布：显式评价、负向信号、隐式无异议、未继续、未曝光，五类互斥；并加入固定说明，强调隐式无异议不等于合适。
- 不改变路由、不调策略、不自动训练；不记录任何正文。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `auto-allocation-feedback`：新增“隐式反馈事实”要求——曝光与行为事实的记录口径、关联单位、隔离与隐私约束。
- `auto-routing-usage-report`：新增“隐式信号分布”要求——五类互斥归类、优先级、与显式评价分列及固定说明。

## Impact

- 代码：`packages/auto-model-routing/src/feedback.ts`（新事件类型与读取）、`src/policy-host.ts`（回合结束、继续与模式切换事实）、`src/endpoints.ts` 与 `src/index.ts`（observation RPC、模式切换钩子）、`src/client/label.ts`（曝光判定）、`src/usage-report.ts`（分布统计）。
- 数据：`$DSH_HOME/state/auto-model-routing/allocation-feedback.jsonl` 新增两类事件行；旧版读取逻辑会跳过不认识的行，旧记录照常可读。
- 文档：`packages/auto-model-routing/docs/feedback-evaluation.md`、包内 report skill 文案。
- 部署：`dsh build` 后需重启 DSH 加载 Host 侧变化；不涉及 manifest pin 或第三方依赖变化。
