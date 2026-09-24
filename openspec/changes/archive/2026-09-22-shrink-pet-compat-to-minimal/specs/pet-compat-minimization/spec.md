## ADDED Requirements

### Requirement: compatibility patch 必须以正面证据证明官方不支持

在为长期 Host compatibility runtime 新增或保留任一 patch seam 前，系统 SHALL 要求该 seam 附带**正面证据**，证明目标精确版本的官方公开 API 无法表达所需语义。

正面证据 MUST 引用目标版本**已发布产物**中的具体位置（类型声明文件及其行号、或官方文档段落原文），并说明所引用的官方 API 为何不能表达该语义。

"搜索关键词无结果"、"我不知道有这个 API"、"上游文档没提到"或"类型检查通过即认为需要 patch" MUST NOT 被接受为正面证据。

当证据只能证明官方 API 存在但**使用方式不同**时，系统 SHALL 判定该 seam 不成立，并改用官方 API。

#### Scenario: 新增 patch seam 时缺少正面证据
- **WHEN** 有人提出新增一个 compatibility patch seam，但未引用目标版本类型声明或官方文档中的具体位置
- **THEN** 该 seam SHALL 被拒绝进入 compat 层，直到补齐正面证据

#### Scenario: 正面证据反证官方已支持
- **WHEN** 对某个既有 patch seam 的核验发现目标版本官方 API 已能表达该语义
- **THEN** 该 seam SHALL 被判定为不成立并退回官方 API，MUST NOT 以"改动风险"为由继续保留

#### Scenario: 官方 API 存在但语义不足
- **WHEN** 官方存在形近 API，但其文档语义与所需语义明确不同（例如只覆盖"从未真正存在过的子代"而非"已完成工作的子代"）
- **THEN** 该 seam SHALL 被判定为成立，并在证据中记录被排除的官方 API 及其语义差异

### Requirement: 判定 seam 可移除必须覆盖其全部语义

判定某个既有 patch seam「官方已支持、可以移除」时，系统 SHALL 要求证据覆盖该 seam 服务的**每一项语义**，而不仅是其中一项或签名层面的兼容。

证据 MUST 逐项列出该 seam 承担的语义，并对每一项说明官方 API 如何表达。任一项无法说明时，该 seam SHALL 判定为**不可移除**。

"官方存在同名或形近 API"、"参数可以对上"、"官方文档某一句话支持其中一项语义" MUST NOT 被单独视为等价性证明。移除判定与新增判定适用同一标准：两个方向都需要正面举证。

#### Scenario: 只验证了一项语义就判定可移除
- **WHEN** 某 seam 同时承担多项语义（例如既允许调用方预留身份，又允许不提交初始内容），而证据只覆盖其中一项
- **THEN** 该判定 SHALL 被拒绝，seam 保留，直到每一项都有对应证据

#### Scenario: 形近 API 解决的是相邻但不同的问题
- **WHEN** 官方 API 的文档语句看似支持所需语义，但实际回答的是相邻问题（例如保证"已存活子代不被父的后续变更污染"，而所需语义是"子代能独立于父重建自己的组合"）
- **THEN** 该 seam SHALL 判定为不可移除，并在证据中记录两者的语义差异

#### Scenario: 待移除 seam 与保留 seam 共享持久化结构
- **WHEN** 某 seam 被证明可移除，但其实现与另一个必须保留的 seam 共用同一持久化结构（例如同一个 descriptor 版本）
- **THEN** 系统 SHALL 判定其在当前组合下不可单独摘除，并记录该耦合，MUST NOT 为拆分而改动持久化结构的版本语义

### Requirement: compat seam 必须最小且逐项可辩护

Compatibility runtime SHALL 只包含经正面证据逐项证明成立的 seam。每个 seam MUST 记录：所替换的上游包、改动的上游源文件、所需语义、被排除的官方替代路径，以及可验证的退役条件。

当某项能力可以通过**插件自身实现**取得同等保证而无需改动上游源码时，系统 SHALL 采用插件级实现，MUST NOT 仅因"复用宿主设施更方便"而扩大 compat 面。

Compat 层 MUST NOT 包含当前未启用的 seam。已禁用、已停用或从未启用的 patch、构建产物与开关 SHALL 从 compat 层移除。

#### Scenario: 能力可由插件自持
- **WHEN** 某项 compat seam 所提供的保证可由插件在自有介质上以等价方式实现
- **THEN** 系统 SHALL 移除该 seam 并改为插件级实现，同时保持原有的原子性、独占性与失败语义

#### Scenario: compat 层存在未启用的 seam
- **WHEN** compat 层包含某个因构建失败、开关关闭或其它原因从未在生产启用的 seam
- **THEN** 该 seam 及其构建产物 SHALL 被移除，不得以"将来可能用到"为由保留

#### Scenario: 退役条件必须可验证
- **WHEN** 记录某个 compat seam 的退役条件
- **THEN** 该条件 SHALL 表述为可在目标版本上机器或人工核验的事实，MUST NOT 表述为无到期依据的承诺；若该需求尚未向上游报告，SHALL 显式记录这一事实

### Requirement: 部署 overlay 必须与源产物 provenance 一致

当 compatibility 相关产物被投影到部署 profile 时，系统 SHALL 在部署路径上校验已部署产物与源产物的 provenance 身份（至少包含上游 base commit 与 patch 身份）。

不一致时系统 SHALL fail closed 并明确诊断，MUST NOT 因依赖名称、路径或内容 hash 未变而判定为新鲜。

#### Scenario: 部署 overlay 落后于源产物
- **WHEN** 部署 profile 中的 compatibility 产物 provenance 与仓库源产物不一致
- **THEN** 系统 SHALL 报告该漂移并拒绝将其视为已同步状态

#### Scenario: 名称与路径不变但产物已换代
- **WHEN** 依赖声明的名称与路径未变，但源产物已针对新的上游 base 重新生成
- **THEN** 部署校验 SHALL 依据 provenance 判定需要重新物化，MUST NOT 仅依据声明未变而跳过
