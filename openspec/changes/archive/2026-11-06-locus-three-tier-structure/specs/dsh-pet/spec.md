## ADDED Requirements

### Requirement: 子代结算按官方默认通知 locus 主会话

locus child 结算 SHALL 使用官方默认的结算通知，通知其父 locus 主会话；locus 主会话是该结算的受众。Pet MUST NOT 使用静默结算兼容能力，干活主会话 MUST NOT 收到子代结算通知。

#### Scenario: 结算通知只到 locus 主会话
- **WHEN** 某入口的 child 完成一轮并结算
- **THEN** locus 主会话收到官方结算通知；干活主会话的事件流中没有该结算

#### Scenario: 多个入口结算不打断干活主会话
- **WHEN** 同一 locus 主会话下的三个 child 先后结算，期间干活主会话正在执行轮次
- **THEN** 干活主会话的当前轮次没有被注入或打断

## MODIFIED Requirements

### Requirement: Locus child 创建使用官方 subagent 契约表达其不变量

Pet 创建 locus child 时 SHALL 使用宿主官方已发布的 subagent 创建契约表达以下不变量：调用方预留的 child 身份、child 工具面限制及其跨冷恢复的持久化、以及 child 组合与父后续变更的隔离。child 的父 SHALL 是 Pet 自建、preset 锁定为 `locus-base` 的 locus 主会话；创建 SHALL 使用官方 `startContinuable` 并携带首条 prompt，冷恢复按官方规则从父组合重建。"与父后续变更的隔离"由父 preset 不可更改保证：Host SHALL 在 child 发布与每次投递前核验父 preset 仍为 `locus-base`。

上述不变量 MUST NOT 通过修改宿主源码实现，除非已按 `pet-compat-minimization` 的正面证据标准证明官方契约无法表达。

child 实际暴露的工具面 SHALL 在发布前被读取并核验；核验不通过时 SHALL 拒绝发布该 child。该核验 MUST 独立于任何工具过滤声明而存在，因为在 child 自身作用域注册的工具不受继承面过滤约束。

#### Scenario: 预留身份后创建 child
- **WHEN** Pet 在创建 child 前已持久登记其身份
- **THEN** 创建 SHALL 使用该预留身份，MUST NOT 产生第二次身份握手或接受与预留值不同的身份

#### Scenario: 冷恢复后工具面限制仍然有效
- **WHEN** Host 重启后恢复一个已存在的 locus child
- **THEN** 该 child 的工具面限制 SHALL 与创建时一致

#### Scenario: 父在 child 存活期间更改组合
- **WHEN** locus 主会话的 preset 在 locus child 存活期间被改为非 `locus-base`
- **THEN** Host SHALL 拒绝向该 child 派发并按"换绑与归档按层处理"把 locus 主会话视为不可用，MUST NOT 让 child 以变更后的组合服务

#### Scenario: child 实际工具面超出允许范围
- **WHEN** 发布前核验发现 child 暴露了允许清单与 Pet 自有注册均无法解释的工具
- **THEN** 系统 SHALL 拒绝发布该 child，MUST NOT 依赖工具过滤声明推定其安全

### Requirement: Pet executor preset 按运行体的 preset 承载方式声明

Pet 依赖的 preset（Pet Task executor 用 `dsh-pet-executor`；locus 主会话与子会话用 `locus-base`）SHALL 以所 pin 运行体实际加载的方式提供，使 Pet 创建与冷恢复时都能按 id 挂载它。`locus-base` SHALL 是白名单构建、名称中性、与 channel 无关且不含任何委派行的 preset。所 pin 的运行体只接受在 profile 配置中声明 preset 时，该 preset SHALL 以声明形式出现在生效配置中。`dsh-pet-executor` 的工具与 persona 组合 MUST 与迁移前等价。

preset 无法按 id 挂载时，Pet SHALL fail closed：拒绝创建或恢复依赖该 preset 的会话，并给出可诊断说明。locus 主会话 MUST NOT 以其它 preset 创建。

#### Scenario: 运行体只接受声明式 preset 时冷恢复 locus child
- **WHEN** Host 重启后恢复一个 locus child，且运行体只从 profile 声明加载 preset
- **THEN** 其父 locus 主会话按声明的 `locus-base` 挂载，child 从父组合恢复，工具面与恢复前一致

#### Scenario: preset 缺失
- **WHEN** 生效配置中没有 `locus-base` 的声明
- **THEN** Pet 拒绝创建 locus 主会话与 child 并报告缺失，MUST NOT 改用其它 preset

#### Scenario: locus-base 不含委派
- **WHEN** 展开 `locus-base` 的工具组合
- **THEN** 不含 `subagent`、`subagent_fork`、`workflow`、`ralph`、`send_message` 与 agent 控制工具

### Requirement: 子代激活受运行体名额约束时 fail closed

所 pin 的运行体对同时激活的子代设有名额上限时，Pet 的 locus child 创建与恢复 SHALL 遵守该上限。名额不足时，Pet SHALL 显式报告并保留可重试状态，MUST NOT 静默丢弃投递，也 MUST NOT 把 child 标记为已失败或已结束。

Pet 读取 child 状态 SHALL 经 `sessionQuery.observeSession` 冷读，MUST NOT 为只读访问物化 child。

#### Scenario: 名额已满时创建 locus child
- **WHEN** 已激活子代数达到运行体上限，此时 Pet 需要创建或恢复 locus child
- **THEN** Pet 报告名额不足并保留待处理状态，名额释放后可以重试；不丢失投递，也不把 child 标为失败

#### Scenario: 只读访问不长期占用名额
- **WHEN** Pet 读取某个未驻留 child 的状态
- **THEN** 经冷读完成，不物化该 child、不占用名额

## REMOVED Requirements

### Requirement: 子代结算 MUST NOT 打断父会话的进行中工作
**Reason**: 父会话改为 Pet 自有的 locus 主会话，它正是结算的受众（ADR-0007 理由 3 取向 B），静默结算与 `settlement-notice.patch` 退役。
**Migration**: 由"子代结算按官方默认通知 locus 主会话"取代；干活主会话不再是子会话的父，不会收到结算。
