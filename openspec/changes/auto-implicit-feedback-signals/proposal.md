## Why

AUTO 的分配反馈目前只有用户主动点击的显式评价。实际使用中几乎不点，偶尔点的多半是“觉得不对”的时候，于是已有标签既稀少又偏向负例，无法回答“初始策略是否合适”，也无法为后续的旁路评审器提供校准对照。

“没点”本身含有信息，但混着三种情况：看过且无异议、根本没看到、觉得不对但没点或直接干预了。只有先记录“是否看过”和“之后有没有干预、会话是否继续”这些事实，才能把第一种分离出来。这些事实不需要调用模型，也不打扰主会话，可以先跑一段时间，用数据决定是否值得做旁路评审。

## What Changes

- 运行时只记录会话日志里**没有**的两类事实：**曝光**（回复在前台持续可见达到阈值）和**切换 MANUAL**（用户在决策之后把会话切到 MANUAL）。作为独立事件追加到现有反馈账本，按 `(sessionId, decisionId)` 关联；不改写决策快照，不合并到显式反馈。
- 回合结束原因与是否继续下一回合**不在运行时重复记录**：报告脚本本来就在解码会话日志，从 `turn/end` 和后续用户回合推导即可。
- 按需报告为每个比较子组增加隐式信号分布：显式评价、负向信号、隐式无异议、未继续、未曝光，五类互斥；并加入固定说明，强调隐式无异议不等于合适。
- 不改变路由、不调策略、不自动训练；不记录任何正文。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `auto-allocation-feedback`：新增“隐式反馈事实”要求——曝光与行为事实的记录口径、关联单位、隔离与隐私约束。
- `auto-routing-usage-report`：新增“隐式信号分布”要求——五类互斥归类、优先级、与显式评价分列及固定说明。

## Impact

- 代码：`packages/auto-model-routing/src/feedback.ts`（新事件类型与读取）、`src/policy-host.ts`（暴露最近已应用决策供切换钩子使用）、`src/endpoints.ts` 与 `src/index.ts`（observation RPC、`setMode` 钩子）、`src/client/label.ts`（曝光判定）、`src/usage-report.ts`（从日志推导回合结束与继续，并做五类归类）。
- 数据：`$DSH_HOME/state/auto-model-routing/allocation-feedback.jsonl` 新增两类事件行；旧版读取逻辑会跳过不认识的行，旧记录照常可读。
- 文档：`packages/auto-model-routing/docs/feedback-evaluation.md`、包内 report skill 文案。
- 部署：`dsh build` 后需重启 DSH 加载 Host 侧变化；不涉及 manifest pin 或第三方依赖变化。
