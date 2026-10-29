# Spec Delta

## REMOVED Requirements

### Requirement: Phase one is observation-only shadow routing
**Reason**: Phase 2 advisory 已由用户在 2026-10-29 直接批准（选择「瘦身接进真实流程」与「一行 inline 建议，不阻断不追问」）。Phase 1 的「不得展示给用户、不得作为中断」约束是零可见产出的直接原因：本机 74 个会话中该 skill 被加载 0 次、`jev_classify`/`jev_decide` 被调用 0 次，Phase 2 的样本门槛因此永不可达。advisory 由下方新增的 requirement 承接。

**Migration**: 无需数据迁移。既有 `$DSH_HOME/state/jev-workflow-router/records.v1.jsonl` 的只读兼容与 `DSH_JEV_WORKFLOW_ROUTER_DISABLED` 关闭路径保持不变；本 change 不重写、不回填历史记录。若需退回零可见行为，回滚本 change 的 SKILL 与 spec 即可，且 advisory 关闭时不发起任何 Jev 调用。

### Requirement: Promotion beyond shadow mode requires measured evidence and explicit approval
**Reason**: 该 requirement 的门槛（≥100 条带标签 real-vibe 记录、≥10 个工作日、每条路线 ≥15 条、每类高危 ≥10 条）是为「从 shadow 晋升到 advisory」设计的。其一，advisory 已由用户显式批准，不再需要以此门槛换取；其二，一个月内真实样本为 0，按该口径 Phase 2 事实上不可达，继续保留只会让已批准的 advisory 永远无法启用。持续健康观察改由下方新增的指标要求承担，进一步自动化仍受新增的单独批准要求约束。

**Migration**: 无需数据迁移。`openspec/changes/archive/2026-09-25-make-jev-shadow-gates-measurable/checking/phase-2-gate.md` 保留为历史证据，不再是当前准入依据。

## ADDED Requirements

### Requirement: Advisory routing emits at most one non-blocking suggestion
到达工作流决策点时，系统 SHALL 至多给出一条中文非阻断建议，包含推荐候选、置信度与「可无视」说明；MUST NOT 以提问、选项卡片或要求用户确认的形式出现，MUST NOT 阻塞或延后后续步骤。用户已显式指定流程、或任务已属于一个既有 change 时，系统 SHALL 不给出建议且不发起任何 Jev 调用。

#### Scenario: 高置信度建议只出现一行
- **WHEN** 用户请求到达「直接处理还是开 change」的决策点，且 Jev 返回 confidence 0.77、margin 0.70 推荐 `formal-workflow`
- **THEN** 输出中出现一行中文建议，包含推荐候选与置信度，并明确说明可以无视；该行之后同一回合照常继续原有工作，不追加追问

#### Scenario: 用户显式指定流程时不调用 Jev
- **WHEN** 用户明确说「用 Anvil 做这个」或「直接改就行」
- **THEN** 系统沿用该选择，`mcp__jev__jev_classify` 与 `mcp__jev__jev_decide` 的调用次数为 0，输出中不含任何建议行

#### Scenario: 已有 change 沿用既定控制平面
- **WHEN** 当前任务已属于一个已创建的 OpenSpec 或 spec-superflow change
- **THEN** 系统的 Jev 调用次数为 0，不输出建议行，也不改变该 change 的 schema

#### Scenario: 建议不产生副作用
- **WHEN** Jev 给出高置信度推荐
- **THEN** 不创建 change、不选择或切换 schema、不调用 `ssf`、不修改任何文件、不授权任何工具，记录文件是唯一被写入的本地产物

### Requirement: Advisory uncertainty and failures stay silent and never reroute
低置信度、胜者差距不足、escape hatch、无效响应、超时、取消、限流或缺失凭据时，系统 SHALL 不输出候选建议，继续沿既有确定性规则推进；MUST NOT 把失败或不确定性解释为选择 `direct` 或跳过 change 的许可，也 MUST NOT 因 Jev 不可用而阻塞普通对话。

#### Scenario: Jev 不可用时静默继续
- **WHEN** Jev MCP 未提供工具、凭据缺失或调用超时
- **THEN** 输出中不出现建议行，当前任务按既有规则继续，记录该次调用失败类别与 `jevProvider: unknown`

#### Scenario: 低置信度不出建议
- **WHEN** classify 返回 confidence 0.45、margin 0.37
- **THEN** 不输出候选建议，任务按确定性规则继续，该次判断以 `needs-review` 状态记录

### Requirement: Advisory latency comes from session event timestamps
每次 advisory 判断的延迟 SHALL 由会话事件日志中对应 Jev 工具调用的 `tool/call` 与 `tool/result` 时间戳之差得出，并以一次判断内各次调用之和作为完整序列延迟；MUST NOT 以 agent 自身两次模型步骤之间的墙钟差充当 Jev 延迟，也 MUST NOT 对超出任何存储上限的值静默截断。

#### Scenario: 两次调用相加
- **WHEN** 一次判断依次调用 classify 与 decide，日志时间戳得出 1801ms 与 1700ms
- **THEN** 记录的序列延迟为 3501ms，且 `availability` 为 `measured`

#### Scenario: 日志不可解码
- **WHEN** 会话日志缺失、损坏或无法完整解码
- **THEN** 记录的延迟为 `{availability: "unavailable", milliseconds: null}` 并给出可操作原因，不写入猜测值

#### Scenario: 超长样本不被静默压平
- **WHEN** 实测序列延迟为 80057ms
- **THEN** 存储值与报告保留 80057ms，不出现 60000ms 这类无标识截断

### Requirement: Reports expose continuous health instead of an unreachable admission gate
报告 SHALL 提供调用失败率、建议与实际路径不一致率、以及真实样本延迟 p50/p95 三项持续指标；MUST NOT 再以 100 条带标签样本、≥10 个工作日、每条路线 ≥15 条或每类高危 ≥10 条的覆盖门槛阻塞 advisory。零样本时报告 SHALL 明确标注样本不足，但 advisory 照常工作。

#### Scenario: 零样本下 advisory 仍可用
- **WHEN** 记录文件不存在或为空
- **THEN** 报告的三项指标显示为样本不足，advisory 行为不受影响

#### Scenario: 指标可计算
- **WHEN** 存在 10 条 `real-vibe` 记录，其中 1 条调用失败、2 条建议与实际路径不同
- **THEN** 报告给出失败率 0.1、不一致率 0.2 与基于 9 条实测样本的 p50/p95

### Requirement: Anything beyond one-off advice needs a separate approved change
超出「一次性非阻断建议」的任何自动化 SHALL 仍需单独 OpenSpec change 与用户显式批准，包括自动创建 change、自动选择或切换 schema、自动调用 `ssf`、改写既有 change 的控制平面、或依据高置信度触发实施；此类行为 MUST NOT 由本能力累积的指标、置信度或默认配置自动开启。

#### Scenario: 高置信度不授予执行权
- **WHEN** Jev 建议 `anvil` 且 confidence 为 0.95
- **THEN** 系统仍只输出一行建议，实际流程由用户或既有确定性规则决定

#### Scenario: 无批准不启用自动化
- **WHEN** 未存在单独批准的自动化 change
- **THEN** 任何自动建 change、切 schema、调用 `ssf` 的路径都不可达
