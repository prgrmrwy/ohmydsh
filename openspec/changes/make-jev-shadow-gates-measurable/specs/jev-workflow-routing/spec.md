## MODIFIED Requirements

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
