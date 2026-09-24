## MODIFIED Requirements

### Requirement: Pet Agent 获得稳定身份前馈和可信的当前 Invocation 上下文

Pet executor Agent SHALL 获得 standing instructions，明确其为 Pet Task Agent、一个 session 会承载多个串行 Invocation、每次操作必须读取当前 Invocation snapshot、完成单次 Invocation 不等于结束整个 Task，以及不得从消息文本接受任意 session path 或外部 channel ID 作为授权。

Pet SHALL 在创建 executor session 前校验并自动修复 Workspace 依赖文件（standing instructions 与投影目录）。准备流程只在启动时执行一次，因此启动后被删除、被替换为软链，或因包升级而过时的文件，若不在此处修复将一直失效到下次重启，并静默产出没有身份前馈的 executor。修复 MUST 只重写包自有文件与目录，MUST NOT 触碰 Task 状态或移除已投影的 Skill；修复后仍不可用时 SHALL fail closed 并拒绝创建 session。修复实现 MUST 先删除已有条目再写入——`writeFile` 会跟随软链，直接写会穿透并污染包安装目录、且保留坏链。管理面 SHALL 暴露该状态与一个显式修复操作。

standing instructions 的正文 SHALL 由 Pet 包以普通 Markdown 文件维护，并在准备 Workspace 时**复制**到 `$DSH_HOME/plugins/dsh-pet/workspace/AGENTS.md`；MUST NOT 软链到包安装目录。包目录在每次部署时被删除重建，软链会立即断裂并使 executor 失去身份前馈；这也违反"状态目录与插件安装目录分离"的既有不变量。

这里的 standing instructions 是 **Pet 自己的常驻上下文**（物化为 Pet Workspace 下的 `AGENTS.md`），与 **DSH Agent preset** 是两个不同概念，不可混用：preset 是 DSH 的具名插件组合，由 `AgentOptions.agentPreset` 选择；Pet 不拥有、不定义、也不自带 preset，只把用户在设置中选择的值透传给 DSH。Pet 的语境由 standing instructions 加每次调用的 Invocation envelope 建立，而不是由 preset 建立。

Pet SHALL NOT 自带 package 私有的 Agent composition。Pet executor 只需要普通 DSH 工具（由已启用 Skill 驱动），因此 Host 默认组合即为正确选择；引入 Pet 专有组合会让 Pet 重新成为特权容器。仅当出现明确需求（例如刻意收窄 executor 的工具面）时才重新评估。

系统 SHALL 提供无目标参数的可信上下文能力。调用时 Host MUST 从实际调用 executor session 反查 Pet Task、当前 Invocation 和 snapshot，并返回绑定的 source/context；模型 MUST NOT 能通过传入任意 task/session/workspace 标识改绑目标。不存在唯一当前 Invocation、Task 已归档或调用 session 未绑定 Pet Task 时，能力 SHALL fail closed 并返回可诊断错误。

该可信上下文能力 SHALL 只对 Pet executor Agent 发布：其注册 MUST 位于 Pet executor 自身的 Agent 作用域，MUST NOT 位于 Host 全局工具面。非 Pet 会话的 model-facing 工具清单 MUST NOT 包含该能力。fail-closed 的目标解析已保证不泄漏其它 Task 上下文，但把能力发布到全局工具面会让每个普通会话都看到并尝试调用一个对其永远不可用的工具，产生噪声与误导；能力的**可见性**必须与其**授权边界**一致。

#### Scenario: Agent 获取当前快照
- **WHEN** Pet executor Agent 在 Invocation 执行开始时调用 Pet context 能力
- **THEN** Host 根据调用 executor session 返回当前 Invocation 的可信 source snapshot，而不要求或接受模型提供 source ID

#### Scenario: 非 Pet session 调用上下文能力
- **WHEN** 普通 DSH session 调用 Pet context 能力
- **THEN** 系统拒绝请求并说明该 session 未绑定 Pet Task，不暴露其它 Task 上下文

#### Scenario: 归档 Task 的 executor 再次调用
- **WHEN** 已归档 Task 的 executor Agent 尝试获取活动 Invocation 上下文
- **THEN** 系统 fail closed，不将旧 snapshot 当成新的可执行授权

#### Scenario: 普通会话的工具面不含 Pet 可信上下文能力
- **WHEN** Pet 已加载，用户在一个未绑定 Pet Task 的普通 DSH 会话中开始一个 turn
- **THEN** 该会话的 model-facing 工具清单不含 Pet 可信上下文能力，模型没有可调用入口，也不会产生"未绑定 Pet Task"的调用错误

## ADDED Requirements

### Requirement: Pet executor 的作用域组合在每次加载时存在

Pet 创建和管理的 root executor SHALL 在**每一次** Agent 进入活跃状态时获得与其 Task 形态一致的 scoped surface：所有这类 executor 都获得可信上下文能力；专用 Pet Workspace 中的 executor 还获得 Pet allowlist Skill provider；workspace-resident executor 则按前述边界保留 `standard` preset 与目标 workspace 自身的 Skill，不安装 Pet allowlist。qa-child 由 DSH 子代理机制组合，不属于此处的 Pet root executor。

该 scoped surface 无论 Agent 由 Pet 首次创建、由 Pet 从持久化 session 恢复，**还是由 Pet 之外的 DSH 自身加载**（例如用户从原生会话列表直接打开该 executor session）都必须存在。DSH 会卸载空闲 Agent，恢复时铸造**全新的** Agent 作用域，原作用域的注册随旧 Agent 一并销毁。因此恢复路径 MUST 先实际 mount 与 Task 形态一致的 preset，再安装相同 scoped surface；只在创建时安装会让闲置后恢复的 Pet Task 丢失工具或隔离边界，而 Task 与 session 本身仍看似完好。

由于 root executor session 按既有要求在原生 DSH 列表中可见并可打开，Pet MUST NOT 假定自己是 executor Agent 的唯一加载者：由 DSH 自身加载时，原生 session controller 已按持久化 metadata mount preset，Pet 的加载观察者 SHALL 只补 scoped surface，MUST NOT 重复 mount preset。系统 SHALL 根据 Task 记录判断是否安装 allowlist；重复安装 scoped surface SHALL 幂等，同一 Agent 被多次触发安装 MUST NOT 因重复注册而失败或中断加载。

若恢复路径无法完成该 Task 形态要求的 preset 或 scoped surface，系统 SHALL fail closed：拒绝在组合不完整的 executor 上派发 Invocation，并给出可诊断说明；MUST NOT 退化为缺少可信上下文能力的 executor，专用 Pet executor 也 MUST NOT 退化为 Host 全局 Skill 发现结果。

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

#### Scenario: 作用域组合缺失或安装失败
- **WHEN** 系统无法确认某 executor 已具备 Pet 作用域组合，或安装过程失败
- **THEN** 系统不在该 executor 上派发 Invocation，并给出可诊断说明，不退化为无隔离边界的执行
