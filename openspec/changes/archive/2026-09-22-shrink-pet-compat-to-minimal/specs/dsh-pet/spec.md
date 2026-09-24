## MODIFIED Requirements

### Requirement: Pet 使用自有持久化任务模型

系统 SHALL 将 Pet Task、Pet Invocation、source snapshot、执行尝试、executor session 关联和归档状态持久化在 Pet 自有状态目录中。Pet Task ID SHALL 是关联关系的主身份；DSH session 标题、启动消息和其它可见文案仅作为投影，系统 MUST NOT 通过解析这些文案恢复或授权关联。

系统 SHALL 原子持久化状态，并在 Host 重启后恢复未完成任务、Invocation 队列和关联。状态目录 MUST 与插件安装目录分离，插件升级或 profile 重建不得覆盖 Pet 任务数据。归档 MUST NOT 删除 Pet 记录或 DSH session log。

原子性 SHALL 由 Pet 在自有介质上保证，不依赖对宿主持久化实现的修改。跨表跨行的多项写入 MUST 全有或全无地提交；同一介质 MUST 在任一时刻只有一个 Host 进程可写。所需保证无法取得时，写入路径 SHALL fail closed 并给出可诊断错误，MUST NOT 降级为逐项写入或静默丢弃。

#### Scenario: Host 重启后恢复进行中任务
- **WHEN** DSH Host 在 Pet Task 已创建且 Invocation 未完成时重启
- **THEN** Pet 从持久化关联恢复 Task、Invocation、snapshot 和 executor session，并将无法证明仍在执行的状态标记为可诊断待恢复状态而不是伪报成功

#### Scenario: 用户改名 executor session
- **WHEN** 用户修改 Pet executor DSH session 的标题
- **THEN** Pet Task 与 source 的关联保持不变，任务聚合和可信工具解析继续使用持久化 ID 关系

#### Scenario: 插件升级
- **WHEN** Pet 插件包或 DSH profile 被重新构建
- **THEN** Pet 的任务、快照和配置仍保存在独立状态目录中且可恢复

#### Scenario: 多项写入中途失败
- **WHEN** 一次跨表写入在部分记录已暂存后失败
- **THEN** 该次写入的全部改动 SHALL 不可见，介质 SHALL 保持写入前的一致状态

#### Scenario: 第二个 Host 进程尝试写入同一介质
- **WHEN** 另一个 Host 进程尝试取得同一 Pet 状态介质的写入权
- **THEN** 该进程 SHALL 明确失败并可诊断，MUST NOT 与既有持有者并发写入

#### Scenario: 原子写入保证不可得
- **WHEN** 运行环境无法提供所需的原子提交或介质独占保证
- **THEN** 相关写入路径 SHALL 拒绝执行并给出可诊断错误，MUST NOT 以非原子方式继续

## ADDED Requirements

### Requirement: Locus child 创建使用官方 subagent 契约表达其不变量

Pet 创建 locus child 时 SHALL 使用宿主官方已发布的 subagent 创建契约表达以下不变量：调用方预留的 child 身份、child 工具面限制及其跨冷恢复的持久化、以及 child 组合与父后续变更的隔离。

上述不变量 MUST NOT 通过修改宿主源码实现，除非已按 `pet-compat-minimization` 的正面证据标准证明官方契约无法表达。

child 实际暴露的工具面 SHALL 在发布前被读取并核验；核验不通过时 SHALL 拒绝发布该 child。该核验 MUST 独立于任何工具过滤声明而存在，因为在 child 自身作用域注册的工具不受继承面过滤约束。

#### Scenario: 预留身份后创建 child
- **WHEN** Pet 在创建 child 前已持久登记其身份
- **THEN** 创建 SHALL 使用该预留身份，MUST NOT 产生第二次身份握手或接受与预留值不同的身份

#### Scenario: 冷恢复后工具面限制仍然有效
- **WHEN** Host 重启后恢复一个已存在的 locus child
- **THEN** 该 child 的工具面限制 SHALL 与创建时一致

#### Scenario: 父在 child 存活期间更改组合
- **WHEN** 父会话在 locus child 存活期间切换其 preset 或组合
- **THEN** 该 child SHALL 继续运行在其创建时的组合上，不受该变更影响

#### Scenario: child 实际工具面超出允许范围
- **WHEN** 发布前核验发现 child 暴露了允许清单与 Pet 自有注册均无法解释的工具
- **THEN** 系统 SHALL 拒绝发布该 child，MUST NOT 依赖工具过滤声明推定其安全

### Requirement: 子代结算 MUST NOT 打断父会话的进行中工作

Pet 拥有自有汇报通道的 locus child 结算时，系统 SHALL 确保该结算不会打断父会话正在进行的工作。父会话是用户实际使用的主会话，且一个主会话可关联多个 locus。

当宿主官方契约无法表达非打断式结算投递时，系统 SHALL 保留满足 `pet-compat-minimization` 举证标准的最窄 compatibility seam，并记录其退役条件与上游报告状态。

#### Scenario: 父会话工作期间子代结算
- **WHEN** 某个 locus child 在父会话正在执行一个轮次时结算
- **THEN** 父会话当前轮次 SHALL 不被该结算打断

#### Scenario: 多个 locus 同时结算
- **WHEN** 同一父会话关联的多个 locus child 先后结算
- **THEN** 父会话受到的打断次数 SHALL 为零，不随 locus 数量增长

#### Scenario: Host 重启后子代冷恢复再结算
- **WHEN** 一个已配置非打断式结算的 locus child 经 Host 重启被重新物化，随后完成工作并结算
- **THEN** 其结算策略 SHALL 与创建时一致，父会话受到的打断次数仍为零
- **AND** 该策略 MUST 从子代自身的持久化记录还原，MUST NOT 依赖进程内存中的创建期状态
