# Spec Delta：jev-workflow-routing

## MODIFIED Requirements

### Requirement: Advisory routing emits at most one non-blocking suggestion
到达工作流决策点时，系统 SHALL 至多给出一条中文非阻断建议，包含推荐候选、置信度与「可无视」说明；MUST NOT 以提问、选项卡片或要求用户确认的形式出现，MUST NOT 阻塞或延后后续步骤。用户已显式指定流程、或任务已属于一个既有 change 时，系统 SHALL 不给出建议且不发起任何 Jev 调用。仅当产生该建议的 Jev 调用结果同时满足 `confidence >= 0.50` 与 winner margin `>= 0.50` 时才输出建议；执行两阶段判断时，第一阶段与第二阶段的调用结果都必须满足该门槛。winner margin 取 Jev 结果的 `margin`，其结果不含该字段时取其概率分布的最大与次高概率之差。

#### Scenario: 高置信度建议只出现一行
- **WHEN** 用户请求到达「直接处理还是开 change」的决策点，第一阶段返回 confidence 0.77、margin 0.70 推荐 `formal-workflow`，第二阶段返回 confidence 0.72、margin 0.70 推荐 `standard-openspec`
- **THEN** 输出中出现一行中文建议，包含 `standard-openspec` 与置信度 0.72，并明确说明可以无视；该行之后同一回合照常继续原有工作，不追加追问

#### Scenario: 门槛是 0.50，不是 top_probability 的 0.85
- **WHEN** classify 返回 `top_probability 0.86`、`margin 0.73`、`confidence 0.79`，推荐 `direct`
- **THEN** 输出一行 `direct` 建议，包含置信度 0.79，并明确说明可以无视；该次判断以 `auto-candidate` 状态记录，而不是因为 `confidence` 未达到 0.85 而静默

#### Scenario: 第二阶段概率接近时不输出
- **GIVEN** 第二阶段结果的 `workflowProbabilities` 最高为 0.46、次高为 0.29，`confidence` 为 0.35
- **WHEN** 第一阶段推荐 `formal-workflow` 且通过门槛
- **THEN** 不输出建议行，该次判断以 `needs-review` 状态记录

#### Scenario: 高 top_probability 不能替代 confidence 门槛
- **GIVEN** classify 返回 `top_probability 0.95`、`margin 0.80`、`confidence 0.40`
- **WHEN** 用户在决策点发起一次判断
- **THEN** 不输出建议行，该次判断以 `needs-review` 状态记录

#### Scenario: 用户显式指定流程时不调用 Jev
- **WHEN** 用户明确说「用 Anvil 做这个」或「直接改就行」
- **THEN** 系统沿用该选择，`mcp__jev__jev_classify` 与 `mcp__jev__jev_decide` 的调用次数为 0，输出中不含任何建议行

#### Scenario: 已有 change 沿用既定控制平面
- **WHEN** 当前任务已属于一个已创建的 OpenSpec 或 spec-superflow change
- **THEN** 系统的 Jev 调用次数为 0，不输出建议行，也不改变该 change 的 schema

#### Scenario: 建议不产生副作用
- **WHEN** Jev 给出高置信度推荐
- **THEN** 不创建 change、不选择或切换 schema、不调用 `ssf`、不修改任何文件、不授权任何工具，记录文件是唯一被写入的本地产物
