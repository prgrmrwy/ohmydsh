## MODIFIED Requirements

### Requirement: Pet 语境由 standing instructions 与 envelope 建立而非 preset

这里的 standing instructions 是 **Pet 自己的常驻上下文**（物化为 Pet Workspace 下的 `AGENTS.md`），与 **DSH Agent preset** 是两个不同概念，不可混用：preset 是 DSH 的具名插件组合，由 `AgentOptions.agentPreset` 选择；Pet 不拥有、不定义、也不自带 preset，只把用户在设置中选择的值透传给 DSH。Pet 的语境由 standing instructions 加每次调用的 Invocation envelope 建立，而不是由 preset 建立。

Pet SHALL NOT 自带 package 私有的 Agent composition。Pet executor 只需要普通 DSH 工具（由已启用 Skill 驱动），因此 Host 默认组合即为正确选择；引入 Pet 专有组合会让 Pet 重新成为特权容器。仅当出现明确需求（例如刻意收窄 executor 的工具面）时才重新评估。

系统 SHALL 提供无目标参数的可信上下文能力。调用时 Host MUST 从实际调用 session
反查其 Pet Task，并按该 Task 的形态解析上下文；模型 MUST NOT 能通过传入任意
task/session/workspace/位点标识改绑目标。

上下文来源 SHALL 按 Task 形态分流，因为两种形态获得上下文的途径本质不同：

- **root executor 形态**：Host MUST 反查当前 Invocation 与 snapshot 并返回其绑定的
  source/context。该 executor 是 Pet 新建的空白会话，对源会话一无所知，snapshot 是
  其唯一的上下文通道，MUST NOT 以任何其它来源替代。不存在唯一当前 Invocation、
  Task 已归档或调用 session 未绑定 Pet Task 时，能力 SHALL fail closed 并返回可
  诊断错误。
- **fork-child 形态**：Host MUST 反查该 child 所服务的绑定位点并返回其记录的
  上下文，至少包含源会话标识、受管执行目录（已认定时）与当前权限档位。该形态
  天然没有 Invocation 记录，因此 MUST NOT 按 Invocation 解析——曾经如此解析使
  child 每次调用都收到「没有正在运行或等待的 Invocation」。位点已失效或该 child
  不服务任何位点时，能力 SHALL fail closed 并返回可诊断错误。

返回结果 SHALL 标明本次解析所依据的形态，使调用方不必从字段有无反推。

该可信上下文能力 SHALL 只对由 Pet 组合的 Agent 发布：其注册 MUST 位于该 Agent
自身的作用域，MUST NOT 位于 Host 全局工具面。未绑定 Pet Task 的会话的 model-facing
工具清单 MUST NOT 包含该能力。fail-closed 的目标解析已保证不泄漏其它 Task 上下文，
但把能力发布到全局工具面会让每个普通会话都看到并尝试调用一个对其永远不可用的工具，
产生噪声与误导；能力的**可见性**必须与其**授权边界**一致。

#### Scenario: Agent 获取当前快照
- **WHEN** Pet root executor Agent 在 Invocation 执行开始时调用 Pet context 能力
- **THEN** Host 根据调用 executor session 返回当前 Invocation 的可信 source snapshot，而不要求或接受模型提供 source ID

#### Scenario: fork-child 获取其位点上下文
- **WHEN** 一个服务某位点的 fork child 调用 Pet context 能力
- **THEN** Host 返回该位点记录的源会话、执行目录与当前权限档位，并标明这是位点形态的解析，不因缺少 Invocation 而报错

#### Scenario: fork-child 据档位预先说明限制
- **WHEN** 位点处于只读档，其 child 被要求修改工作区
- **THEN** child 可据该能力返回的档位直接说明需要所有者授权，而不是先触发沙箱拒绝

#### Scenario: 非 Pet session 调用上下文能力
- **WHEN** 普通 DSH session 调用 Pet context 能力
- **THEN** 系统拒绝请求并说明该 session 未绑定 Pet Task，不暴露其它 Task 上下文

#### Scenario: 归档 Task 的 executor 再次调用
- **WHEN** 已归档 Task 的 executor Agent 尝试获取活动 Invocation 上下文
- **THEN** 系统 fail closed，不将旧 snapshot 当成新的可执行授权

#### Scenario: 失效位点的 child 调用
- **WHEN** 一个其位点已失效的 fork child 调用该能力
- **THEN** 系统 fail closed 并给出可诊断说明，不返回过期的位点上下文

#### Scenario: 普通会话的工具面不含 Pet 可信上下文能力
- **WHEN** Pet 已加载，用户在一个未绑定 Pet Task 的普通 DSH 会话中开始一个 turn
- **THEN** 该会话的 model-facing 工具清单不含 Pet 可信上下文能力，模型没有可调用入口，也不会产生"未绑定 Pet Task"的调用错误

### Requirement: Pet executor 的作用域组合在每次加载时存在

Pet 创建和管理的 root executor SHALL 在**每一次** Agent 进入活跃状态时获得与其 Task 形态一致的 scoped surface：所有这类 executor 都获得可信上下文能力；专用 Pet Workspace 中的 executor 还获得 Pet allowlist Skill provider；workspace-resident executor 则按前述边界保留 `standard` preset 与目标 workspace 自身的 Skill，不安装 Pet allowlist。

该 scoped surface 无论 Agent 由 Pet 首次创建、由 Pet 从持久化 session 恢复，**还是由 Pet 之外的 DSH 自身加载**（例如用户从原生会话列表直接打开该 executor session）都必须存在。DSH 会卸载空闲 Agent，恢复时铸造**全新的** Agent 作用域，原作用域的注册随旧 Agent 一并销毁。因此恢复路径 MUST 先实际 mount 与 Task 形态一致的 preset，再安装相同 scoped surface；只在创建时安装会让闲置后恢复的 Pet Task 丢失工具或隔离边界，而 Task 与 session 本身仍看似完好。

由于 root executor session 按既有要求在原生 DSH 列表中可见并可打开，Pet MUST NOT 假定自己是 executor Agent 的唯一加载者：由 DSH 自身加载时，原生 session controller 已按持久化 metadata mount preset，Pet 的加载观察者 SHALL 只补 scoped surface，MUST NOT 重复 mount preset。系统 SHALL 根据 Task 记录判断是否安装 allowlist；重复安装 scoped surface SHALL 幂等，同一 Agent 被多次触发安装 MUST NOT 因重复注册而失败或中断加载。

该加载观察者对 Host 发布的**每一个** Agent 触发，并以 executor session id 反查
Task；而 fork-child 形态恰好把 child 会话 id 记在同一个 `executorSessionId` 字段上。
因此"能按 executor session id 查到 Task"**不足以**证明该 Agent 可被完整组合：
观察者 SHALL 在安装任何 scoped surface **之前**先按 Task 的 source kind 判定形态，
并对 fork-child 形态**只安装可信上下文能力**：

- MUST NOT mount 任何 preset——child 的 preset 由 DSH 子代理机制按其父会话确定；
- MUST NOT 安装 Pet allowlist Skill provider——该 provider 会**替换** child 继承自
  源会话的 Skill catalog，而继承正是该形态存在的理由；
- SHALL 安装可信上下文能力，并按位点形态解析——该能力是 child 得知自身执行目录与
  权限档位的途径，其失败原因是数据源错配而非边界问题。

这两类组件的开关 SHALL 彼此独立，MUST NOT 因其中一类不适用而整体跳过。

#### Scenario: 闲置后被恢复的 executor 仍具备可信上下文能力
- **WHEN** 某 Pet Task 的 executor 因长时间空闲被 DSH 卸载，随后用户发起新的 Invocation 触发恢复
- **THEN** 恢复后的 executor 仍可调用 Pet 可信上下文能力并取得当前 Invocation 快照

#### Scenario: 闲置后被恢复的专用 Pet executor 仍受 Skill 允许清单约束
- **WHEN** 上述被恢复的是专用 Pet Workspace executor，且 Host 全局安装了未被 Pet 启用的 Skill
- **THEN** 该 executor 的 Skill catalog 仍只含 Pet 允许清单中已启用的 Skill，全局 Skill 不因恢复而变得可见

#### Scenario: 闲置后被恢复的 workspace-resident executor 保留自身能力
- **WHEN** 被恢复的是 workspace-resident executor
- **THEN** 系统实际 mount `standard` preset、恢复可信上下文能力，但不安装 Pet allowlist provider，其 Skill 继续由目标 workspace 决定

#### Scenario: 用户从原生列表打开 executor 后再触发 Invocation
- **WHEN** 用户从 DSH 原生会话列表直接打开某 Pet Task 的 root executor session（由 DSH 自身完成加载），随后从 Pet 发起新的 Invocation
- **THEN** 该 Invocation 仍在具备该 Task 形态所需 scoped surface 的 executor 上执行：可信上下文能力可用；若为专用 Pet executor，Skill catalog 仍只含 Pet 允许清单中已启用的 Skill；若为 workspace-resident executor，则继续使用目标 workspace 的 Skill

#### Scenario: 同一 executor 被重复触发组合安装
- **WHEN** 同一 executor Agent 在其生命周期内被多次触发作用域组合安装
- **THEN** 安装幂等，不因重复注册同名能力而报错或中断该 Agent 的加载

#### Scenario: 加载观察者遇到 qa-child 不施加 Pet 组合
- **WHEN** Host 发布某答疑位点绑定的 fork child Agent，Pet 的加载观察者按其 session id 查到对应的 fork-child Task
- **THEN** 系统不 mount preset、不安装 Pet allowlist provider，该 child 的 Skill 目录仍完全继承自源会话；仅安装可信上下文能力

#### Scenario: qa-child 不被诱导调用可信上下文能力
- **WHEN** 位点参与者提问，该问题作为一轮消息进入 child，child 按工具说明调用可信上下文能力
- **THEN** 能力按位点形态返回源会话、执行目录与权限档位，不再因该形态天然没有 Invocation 记录而返回"没有正在运行或等待的 Invocation"这类错误

#### Scenario: 作用域组合缺失或安装失败
- **WHEN** 系统无法确认某 executor 已具备 Pet 作用域组合，或安装过程失败
- **THEN** 系统不在该 executor 上派发 Invocation，并给出可诊断说明，不退化为无隔离边界的执行
