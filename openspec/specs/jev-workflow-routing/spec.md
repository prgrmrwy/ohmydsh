# jev-workflow-routing Specification

## Purpose

定义 Jev 作为低成本结构化决策层，对日常开发请求是否需要 change 以及应采用何种既有社区流程给出可审计、可回退的推荐，而不让该推荐自行授权执行。

## Requirements

### Requirement: Workflow routing uses a closed set of unmodified community choices
系统 SHALL 只在以下闭集内推荐工作流：继续直接对话、仓库当前标准 OpenSpec `spec-driven`、未经本地改写的社区 Anvil、未经本地改写的 spec-superflow。系统 MUST NOT 为路由目的生成、fork 或静默修改一个个人混合 schema。

#### Scenario: A request reaches the workflow decision point
- **WHEN** 普通 vibe 对话出现是否需要 change 或应采用何种规划流程的决策点
- **THEN** 系统只在直接对话、标准 OpenSpec、Anvil 与 spec-superflow 中产生结构化推荐

#### Scenario: A community workflow is unavailable
- **WHEN** Anvil 或 spec-superflow 未安装、版本不受支持或健康检查失败
- **THEN** 系统不得推荐该候选为可执行路径，并 SHALL 保留标准 OpenSpec 作为可用回退

### Requirement: Deterministic authority precedes Jev judgment
用户显式选择和已有 change 的既定流程 SHALL 优先于 Jev 推荐。Jev 只能在尚无权威选择的普通对话决策点提供判断，MUST NOT 覆盖用户指令、改变现有 change 的 schema、降低既有门禁或授权写操作、依赖变更、外部副作用、合入、归档与清理。

#### Scenario: User explicitly chooses a workflow
- **WHEN** 用户明确要求标准 OpenSpec、Anvil、spec-superflow 或继续直接处理
- **THEN** 系统沿用该显式选择，且不以 Jev 结果替换它

#### Scenario: Work continues in an existing change
- **WHEN** 当前任务已经属于一个已创建的 OpenSpec 或 spec-superflow change
- **THEN** 系统沿用该 change 已记录的流程，不因新的 Jev 推荐切换控制平面

#### Scenario: Recommendation conflicts with a safety gate
- **WHEN** Jev 推荐较轻流程但现有安全、权限、Worktree Session、验证或合入规则要求更严格行为
- **THEN** 现有规则保持有效，Jev 推荐不得降级或绕过它们

### Requirement: Phase one is observation-only shadow routing
首期路由 SHALL 运行在 shadow mode。系统 MUST 保持当前对话、OpenSpec 提醒、change 创建和执行行为不变；Jev 结果只能形成评估记录，不得自动展示为用户必须响应的中断，不得创建 change、选择 schema、调用 spec-superflow 或触发实现。

#### Scenario: High-confidence shadow recommendation
- **WHEN** Jev 对某次决策给出高置信度推荐
- **THEN** 系统记录该推荐与概率证据，但当前 Agent 仍按既有行为决定和推进流程

#### Scenario: Shadow recommendation disagrees with actual route
- **WHEN** Jev 推荐与用户或现有 Agent 最终采用的流程不同
- **THEN** 系统保留二者作为后续评估样本，但不得在本次任务中自动纠正或重放流程

### Requirement: Routing failures fail open to existing behavior and closed to new automation
缺失凭据、网络故障、超时、取消、限流、无效响应、未知候选、显式逃逸、低置信度或低胜者差距 SHALL 被视为未作出自动决定。系统 SHALL 在不阻塞普通对话的前提下维持接入前的标准行为，并 MUST NOT 把故障或不确定性解释为允许跳过 change。

#### Scenario: Jev is unavailable
- **WHEN** Jev 服务、凭据或 MCP 入口不可用
- **THEN** 普通对话和现有 OpenSpec 流程继续工作，且系统不产生可执行的自动路由结论

#### Scenario: Jev declines or is uncertain
- **WHEN** 返回 escape hatch、无效结构、低于阈值的置信度或不足的第一第二候选差值
- **THEN** 结果标记为需要人工/既有 Agent 判断，且不得静默选择 direct 或任何社区工作流

### Requirement: Routing evidence is bounded, private, and auditable
每条 shadow 记录 SHALL 使用稳定且可迁移的版本结构，至少包含有界的样本 provenance、候选集合及版本、推荐候选、概率、置信度/差值、决策状态、调用时间、完整 shadow 判断的 measured/unavailable 延迟状态、最终实际流程（若已知）和覆盖来源。provenance 只允许 `real-vibe`、`synthetic-fixture`、`unknown`。系统 MUST NOT 记录、推断或按语言分类请求；provenance 与 latency 元数据 MUST NOT 被发送给 Jev。记录 MUST NOT 包含 API Key、凭据、完整会话历史、未裁剪附件、provider 原始错误体、不必要的源代码正文或自由文本摘要，并 SHALL 提供禁用与清理路径。

#### Scenario: A shadow sample is recorded
- **WHEN** 普通 Agent 在真实流程选择点调用 Jev 并获得可解析结果
- **THEN** 系统保存 `real-vibe` provenance 和 measured/unavailable latency，以及足以比较推荐与实际流程的有限证据，且不保存密钥、完整对话或语言分类

#### Scenario: A synthetic fixture is recorded
- **WHEN** 测试或明确的离线 fixture 产生 shadow 记录
- **THEN** 记录使用 `synthetic-fixture` provenance，报告不得把它计入真实 vibe 样本覆盖

#### Scenario: Legacy record lacks new dimensions
- **WHEN** 系统读取旧 schema 记录且其中没有 provenance 或 measured latency
- **THEN** 系统将对应维度保守表示为 `unknown` 或 `unavailable`，不从历史正文、时间、路由结果或其它代理字段猜测，也不原地改写旧记录

#### Scenario: Provider echoes sensitive content in an error
- **WHEN** 外部端点的错误响应包含请求或凭据相关内容
- **THEN** 系统只记录规范化错误类别，不持久化原始错误体

#### Scenario: Routing is disabled
- **WHEN** 用户关闭该定制或执行安全清理
- **THEN** 新的 Jev 调用停止，既有标准 OpenSpec 与普通对话仍可用，并可按明确规则清理 shadow 记录

### Requirement: Promotion beyond shadow mode requires measured evidence and explicit approval
系统 MUST NOT 仅凭若干成功调用自动进入 advisory 或自动路由。升级 SHALL 依赖预先定义且可复核的真实本地样本量、路线与高代价类别覆盖、加权误路由成本、失败率和延迟/成本报告，并需用户显式批准。语言分类和中英文配额 MUST NOT 成为采集字段或准入门槛。报告 MUST 对每个强制门槛产生机器可判定的 pass、fail 或 unavailable 状态；任何 unknown/unavailable 必须阻止准入，而不是被当作零值或通过。任何自动化阶段都 MUST 保留用户覆盖与标准 OpenSpec 回退。

#### Scenario: Every gate is measurable
- **WHEN** 新 schema 的真实 shadow records 包含足够的可靠标签、provenance 和 measured latency
- **THEN** 报告按真实样本计算所有预登记数据集与质量门槛，并为每个门槛输出可判定结果

#### Scenario: Required evidence is unavailable
- **WHEN** 任一强制门槛缺少真实样本 provenance、latency、价格接受或其它所需证据
- **THEN** 报告将该门槛标记为 unavailable 或 fail，整体保持 `not-established`

#### Scenario: Shadow data is insufficient
- **WHEN** 样本量、关键类别覆盖或错误成本证据未达到准入条件
- **THEN** 系统保持 shadow mode，不启用用户可见建议或自动选路

#### Scenario: Promotion is approved
- **WHEN** 评估报告达到全部预先定义门槛且用户显式批准下一阶段
- **THEN** 后续 change 可启用 advisory mode，并继续保留人工覆盖、故障回退和可关闭语义
