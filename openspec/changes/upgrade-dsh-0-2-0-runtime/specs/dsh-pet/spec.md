## ADDED Requirements

### Requirement: Pet executor preset 按运行体的 preset 承载方式声明

Pet 依赖的 executor preset（`dsh-pet-executor`）SHALL 以所 pin 运行体实际加载的方式提供，使 Pet 冷恢复与独立 child 组合时都能按 id 挂载它。所 pin 的运行体只接受在 profile 配置中声明 preset 时，该 preset SHALL 以声明形式出现在生效配置中。它的工具与 persona 组合 MUST 与迁移前等价。

preset 无法按 id 挂载时，Pet SHALL fail closed：拒绝创建或恢复依赖该 preset 的 locus child，并给出可诊断说明。Pet MUST NOT 退化为挂载父会话的 preset。

#### Scenario: 运行体只接受声明式 preset 时冷恢复 locus child
- **WHEN** Host 重启后恢复一个记录了 `dsh-pet-executor` 的 locus child，且运行体只从 profile 声明加载 preset
- **THEN** 该 child 按声明的 preset 挂载，其工具面与迁移前一致

#### Scenario: preset 缺失
- **WHEN** 生效配置中没有 `dsh-pet-executor` 的声明
- **THEN** Pet 拒绝创建或恢复依赖它的 child 并报告缺失，MUST NOT 改用父会话的 preset

### Requirement: Locus child 的存在证明不依赖运行体可能移除的目录字段

Pet 判定某个 locus child 仍然存在时，所依据的字段 SHALL 在所 pin 运行体的子代目录契约中仍有定义，例如子代 id、创建时间与模式。Pet MUST NOT 依赖目标运行体已移除的字段，例如条目类型标记。缺少该字段时，系统 MUST NOT 把子代判定为不存在，也 MUST NOT 判定为存在。

#### Scenario: 子代目录不再携带类型标记
- **WHEN** 运行体的子代目录条目只含 id、创建时间、模式与标签
- **THEN** Pet 仍能为已存在的 locus child 给出正确的存在证明，冷启动后不会把它误判为丢失

### Requirement: 子代激活受运行体名额约束时 fail closed

所 pin 的运行体对同时激活的子代设有名额上限时，Pet 的 locus child 创建与恢复 SHALL 遵守该上限。名额不足时，Pet SHALL 显式报告并保留可重试状态，MUST NOT 静默丢弃投递，也 MUST NOT 把 child 标记为已失败或已结束。

Pet 只为读取 child 状态而触发的物化 SHALL 在完成后归还名额，不得因只读访问长期占用名额。

#### Scenario: 名额已满时创建 locus child
- **WHEN** 已激活子代数达到运行体上限，此时 Pet 需要创建或恢复 locus child
- **THEN** Pet 报告名额不足并保留待处理状态，名额释放后可以重试；不丢失投递，也不把 child 标为失败

#### Scenario: 只读访问不长期占用名额
- **WHEN** Pet 为读取某个 child 的状态而触发其物化
- **THEN** 读取完成后该名额被归还，不影响后续创建
