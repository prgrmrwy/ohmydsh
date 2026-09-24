## ADDED Requirements

### Requirement: 统一 locus 协作显式替代本能力中的旧飞书执行模型

本能力中所有飞书协作（含 Q&A、新建群、绑定既有群、project 群自动建立、话题与单聊）SHALL 以 `pet-locus-collaboration` 为唯一领域与生命周期契约：主会话承载共同基础，精确飞书入口关联一个 locus，由主会话下的专属子会话持续处理。Subagent 仅为 DSH 创建和运行子会话的技术机制，MUST NOT 形成第二种产品执行模型。

本要求 SHALL 对本能力中仍描述旧 QA 或 channel root/Invocation 语义的条文形成明确替代，替代范围如下；其余普通轮盘行为保持不变：

- **持久化与来源 scope**：`Pet 使用自有持久化任务模型`、`每个来源 scope 至多有一个活跃 Pet Task`、`每次主动调用在发起位置捕获独立快照` 中的 Task/Invocation/Snapshot 原规则继续适用于普通轮盘能力，不再规定飞书执行。飞书当前身份是 locus 及代际，消息是 Delivery；一个主会话可关联多个群/话题 locus，不受一个 qa Task 或源会话双向 1:1 约束。若公共管理面仍使用 Task，它 SHALL 只是 locus 生命周期的内部投影，MUST NOT 成为可独立归档、恢复或释放占用的第二个生命周期真相。
- **执行来源与组合**：`Pet Task 使用专用 Workspace 中的普通 DSH executor session` 中以 channel 路由创建/复用 workspace-resident root executor 和 `qa-child Task` 的飞书分叉不再适用。所有新飞书工作 SHALL 经主会话下的专属子会话处理；default workspace 仅用于自动主会话的初始化归属。不得为群消息新建飞书专用 root executor。普通轮盘专用 root executor、已有非飞书 root 的 preset/Skill 恢复保障与原生列表行为不变。
- **调用与交互**：`Executor session 明确展示与 source 和 Task 的关系`、`Pet 能力以 Agent Skill 驱动并以有界工具完成副作用`、`同一 Pet Task 的 Invocations 严格串行` 中的飞书对话式 Invocation、能力 envelope、固定快照、Invocation waiting-user 和 Task 串行队列全部由同一 locus 子会话的常规多轮交互、inbox 顺序及 Delivery 关联替代。飞书决策通过当前入口往返，后续 `@bot` 续进同一子会话，不创建占位 Skill、Invocation 或额外 waiting-user 机器。普通轮盘 Skill Invocation/Snapshot、严格串行与重试规则 SHALL 原样保留。
- **管理与归档**：`Pet 面板按来源聚合并管理 Task 和 Invocation`、`Task 与 DSH session 归档语义保持一致且不误删历史` 中旧 qa/channel Task 的终态、归档和绑定释放规则由 locus 生命周期替代。管理面 SHALL 从同一 locus 真相投影主会话到全部入口、入口到主/子会话的发现关系；子会话一轮结束或 Agent 卸载不结束 locus。退出/归档/失效停止该关联服务但不删除群、session 或历史，主会话失效遵循统一协作失效规则，不以旧 Task 仍活跃作为继续服务的依据。
- **配置与路由**：`Pet 设置采用固定的页签信息架构且不接触 provider 凭据` 中旧 chat→workspace 覆盖 map、自动写回路由、改绑/删除 workspace 路由的配置与场景不再适用。Channel 仍保留 bot、profile、allowlist、default workspace、启用与诊断；default workspace 只初始化自动主会话，本期 MUST NOT 提供群级 workspace 覆盖配置。新 locus 的 workspace 从主会话归属推导，管理面显示关联与权限，不将群改绑实现为恢复旧 workspace 路由。普通轮盘 General/Skills/环境变量以及 provider 凭据零接触边界不变。
- **出站与可信上下文**：`由 ohmydsh 管理部署且保持 Cockpit 与跨设备边界` 中限定飞书回复必须来自当前 Invocation、仅由 Host 单聊代发的旧表述由 caller-bound locus 加当前 Delivery 回复入口替代；Host 只维护表情与机械控制回执，业务文字由子会话发往当前触发入口。不得跨入口串用回复目标；GUI 私聊、初始化与父子补问不创建飞书 Delivery。设备内执行、凭据零接触及 Cockpit 不新增写代理的边界继续生效。

旧 qa/workspace 绑定与飞书 Invocation SHALL 退休隔离：新版 MUST NOT 消费、转换、恢复或回退到旧记录，也 MUST NOT 因旧群首次再来消息而静默用 default workspace 换身份接管；需所有者显式重新建立。旧 session、日志、群及普通轮盘 Task/Invocation SHALL 保留，破坏性版本切换不是删除授权。新的关联从 read 开始，遵循统一协作的创建、权限核验与发布流程。

#### Scenario: project 群先行不创建飞书 root executor
- **WHEN** 一个获授权的 project 群需要首次建立协作，default workspace 可用
- **THEN** 系统在该 workspace 幂等建立群主会话和 locus，由专属子会话处理合格 `@bot` 消息，不创建飞书 workspace-resident executor 或 Invocation

#### Scenario: 普通轮盘 Skill 调用保持既有模型
- **WHEN** 用户从 Pet 轮盘在同一 source scope 依次调用两个已启用 Skill
- **THEN** 系统仍复用普通 Pet Task/root executor，以独立不可变 Snapshot 和严格串行 Invocation 执行，原有 standing instructions、preset、Skill allowlist 与归档保障不变

#### Scenario: Task 投影不能复活已退出 locus
- **WHEN** 某 locus 已退出但公共面板保留其 Task 形态的历史投影
- **THEN** 面板只显示该 locus 的历史状态，不允许依据旧 Task 活跃状态继续投递、独立恢复绑定或释放另一 locus 的占用

#### Scenario: Channel 设置不再提供群级 workspace 覆盖
- **WHEN** 用户查看新协作群的 Channel 管理信息
- **THEN** 页面展示该 locus 的主/子会话、workspace 归属、权限与状态，不提供 chat→workspace 覆盖路由；改变 default workspace 不改写已有 locus 的主会话

#### Scenario: 旧飞书关联不得自动接管
- **WHEN** 新版收到一个仍可识别为旧 qa/workspace 关联的入口消息
- **THEN** 系统不恢复旧 child、root executor 或 Invocation，也不悄悄创建 default 身份；提示所有者重新建立，旧群和会话历史保留

#### Scenario: 飞书决策由子会话后续轮次继续
- **WHEN** 子会话已向当前 locus 的飞书入口提出决策问题且该轮结束，用户随后 `@bot` 回复
- **THEN** 回复作为同一子会话的后续轮次处理，关联自身 Delivery，不创建或续进飞书 waiting-user Invocation

### Requirement: Pet domain 版本迁移只能由人类离线执行

当 Pet 持久介质的 `dsh_pet` domain stamp 低于当前 descriptor 且属于实现明确列出的 additive 版本时，Host SHALL 仅将 Pet 标记为 `degraded`，保留原始版本错误，并在 `[dsh-pet]` 日志给出可复制的离线检查、显式确认迁移和重新启动步骤。正常 Host 启动 MUST NOT 为检测或修复版本而直接打开、重标或清理 `state.sqlite`；运行中的 SQLite backend 对该介质保持唯一所有权。

离线迁移 SHALL 要求先停止 DSH，并在写入前要求明确确认；SHALL 在介质旁建立带来源版本和时间的备份；SHALL 对已是当前版本幂等成功。未知版本、需要清理旧行而非纯 additive restamp 的版本、缺少可信 unit stamp、文件缺失或锁仍被占用时 MUST fail closed，不猜测、不创建新数据库、不自动清理历史。该 domain stamp 操作 MUST NOT 被解释为把旧 QA/chat route/飞书 Invocation 转换成统一 Locus；旧关联隔离规则不变。

#### Scenario: 启动发现可迁移的旧 stamp
- **WHEN** Host 打开 `dsh_pet` domain 时发现介质版本属于已知 additive 旧版本
- **THEN** Pet 进入 degraded，日志保留版本不兼容根因并给出“停止 DSH、dry-run、显式确认迁移、重新启动”的人工步骤；Host 本身不迁移介质

#### Scenario: 人工离线迁移多台机器
- **WHEN** 操作者在每台机器停止 DSH 后依次执行检查和显式确认迁移
- **THEN** 工具针对该机器的 active `DSH_HOME` 建立备份并只更新允许的 domain stamp；重复执行成功且不产生第二份迁移备份

#### Scenario: 版本或所有权无法证明
- **WHEN** 介质版本未知、需要非 additive 清理、没有 `dsh_pet` stamp，或仍被运行中的 Host 锁定
- **THEN** 工具拒绝写入并给出诊断，不创建数据库、不改写版本、不删除记录

## MODIFIED Requirements

### Requirement: Pet Agent 获得稳定身份前馈和可信的当前 Invocation 上下文

Pet executor Agent SHALL 获得 standing instructions，明确其为 Pet Task Agent、一个 session 会承载多个串行 Invocation、每次操作必须读取当前 Invocation snapshot、完成单次 Invocation 不等于结束整个 Task，以及不得从消息文本接受任意 session path 或外部 channel ID 作为授权。该 Invocation 身份与快照语义继续适用于普通 Pet 轮盘 root executor；统一飞书协作子会话的身份与上下文 SHALL 来自其 caller-bound locus，不伪造 Pet Invocation。

Pet SHALL 在创建 executor session 前校验并自动修复 Workspace 依赖文件（standing instructions 与投影目录）。准备流程只在启动时执行一次，因此启动后被删除、被替换为软链，或因包升级而过时的文件，若不在此处修复将一直失效到下次重启，并静默产出没有身份前馈的 executor。修复 MUST 只重写包自有文件与目录，MUST NOT 触碰 Task 状态或移除已投影的 Skill；修复后仍不可用时 SHALL fail closed 并拒绝创建 session。修复实现 MUST 先删除已有条目再写入——`writeFile` 会跟随软链，直接写会穿透并污染包安装目录、且保留坏链。管理面 SHALL 暴露该状态与一个显式修复操作。

standing instructions 的正文 SHALL 由 Pet 包以普通 Markdown 文件维护，并在准备 Workspace 时**复制**到 `$DSH_HOME/plugins/dsh-pet/workspace/AGENTS.md`；MUST NOT 软链到包安装目录。包目录在每次部署时被删除重建，软链会立即断裂并使 executor 失去身份前馈；这也违反"状态目录与插件安装目录分离"的既有不变量。

这里的 standing instructions 是 **Pet 自己的常驻上下文**（物化为 Pet Workspace 下的 `AGENTS.md`），与 **DSH Agent preset** 是两个不同概念，不可混用：preset 是 DSH 的具名插件组合，由 `AgentOptions.agentPreset` 选择；Pet 不拥有、不定义、也不自带 preset，只把用户在设置中选择的值透传给 DSH。Pet 的语境由 standing instructions 加每次调用的 Invocation envelope 建立，而不是由 preset 建立。

Pet SHALL NOT 自带 package 私有的 Agent composition。Pet executor 只需要普通 DSH 工具（由已启用 Skill 驱动），因此 Host 默认组合即为正确选择；引入 Pet 专有组合会让 Pet 重新成为特权容器。仅当出现明确需求（例如刻意收窄 executor 的工具面）时才重新评估。

系统 SHALL 提供无目标参数的可信上下文能力 `pet_context`。对于普通 Pet root executor，调用时 Host MUST 从实际调用 executor session 反查 Pet Task、当前 Invocation 和 snapshot，并返回绑定的 source/context；模型 MUST NOT 能通过传入任意 task/session/workspace 标识改绑目标。不存在唯一当前 Invocation、Task 已归档或调用 session 未绑定 Pet Task 且也不是有效的统一协作子会话时，能力 SHALL fail closed 并返回可诊断错误。

对于 `pet-locus-collaboration` 定义的统一协作子会话，同一零目标参数能力 SHALL 从实际调用 child session 反查唯一有效 locus，返回该 locus 的飞书入口、workspace 归属、主/子会话关联、当前权限档位以及已确认的工作目录与约束锚点；有当前飞书触发轮次时 SHALL 仅提供该轮次经 Host 关联的消息与回复入口。本机直接对话没有飞书触发关联时 MUST NOT 从上一轮沿用回复授权。该解析 MUST NOT 要求存在 Invocation，也 MUST NOT 为迎合旧工具创建占位 Invocation。模型提供的 locus/chat/thread/session/path 标识、消息正文或可见标题 MUST NOT 成为改绑依据。

子会话 SHALL 继承主会话已完成的可用前缀，必要时向主会话询问执行目录与既有约束；Host 保存已确认锚点供后续 `pet_context` 读取，而不是每轮重复整段上下文。尚未确认的锚点 SHALL 明示缺失，MUST NOT 从 `cwd`、浏览器当前位置或其它 locus 猜测补齐。可信上下文只说明当前关联和已确认约束，MUST NOT 宣称提示词建立了真实沙箱权限，也 MUST NOT 替代新能力定义的权限核验。子代理只是 DSH 创建与运行子会话的执行细节，不是另一套产品上下文模型。

locus 已退出、退休、失效，关联不唯一，主会话不可用，或调用 child 与持久关联不一致时，`pet_context` SHALL fail closed 并返回可诊断错误；MUST NOT 回退到旧 qa/workspace 绑定、其它 locus 或普通 Task 的 Invocation。旧关联不兼容、不转换、不恢复执行，其 session 与历史的保留不构成当前授权。

该可信上下文能力 SHALL 只对 Pet root executor 与经当前 locus 证明身份的统一协作子会话发布：其注册 MUST 位于实际调用 Agent 自身的作用域，MUST NOT 位于 Host 全局工具面。普通主会话不会仅因拥有 locus 子会话而获得此工具。非 Pet root executor、非有效协作子会话的 model-facing 工具清单 MUST NOT 包含该能力。fail-closed 的目标解析已保证不泄漏其它 Task 或 locus 上下文，但把能力发布到全局工具面会让每个普通会话都看到并尝试调用一个对其永远不可用的工具，产生噪声与误导；能力的**可见性**必须与其**授权边界**一致。已加载后关联失效的调用同样 MUST 重新验证并拒绝。

#### Scenario: Agent 获取当前快照
- **WHEN** Pet executor Agent 在 Invocation 执行开始时调用 Pet context 能力
- **THEN** Host 根据调用 executor session 返回当前 Invocation 的可信 source snapshot，而不要求或接受模型提供 source ID

#### Scenario: 非 Pet session 调用上下文能力
- **WHEN** 普通 DSH session（既非 Pet root executor 也非有效统一协作子会话）调用 Pet context 能力
- **THEN** 系统拒绝请求并说明该 session 未绑定 Pet Task 或有效 locus，不暴露其它 Task 或 locus 上下文

#### Scenario: 归档 Task 的 executor 再次调用
- **WHEN** 已归档 Task 的 executor Agent 尝试获取活动 Invocation 上下文
- **THEN** 系统 fail closed，不将旧 snapshot 当成新的可执行授权

#### Scenario: 普通会话的工具面不含 Pet 可信上下文能力
- **WHEN** Pet 已加载，用户在一个未绑定 Pet Task、也非有效统一协作子会话的普通 DSH 会话中开始一个 turn
- **THEN** 该会话的 model-facing 工具清单不含 Pet 可信上下文能力，模型没有可调用入口，也不会产生"未绑定 Pet Task"的调用错误

#### Scenario: 统一协作子会话不依赖 Invocation 获取上下文
- **WHEN** 一个有效 locus 的专属子会话在没有 Pet Invocation 的情况下调用 `pet_context`
- **THEN** Host 按调用 child session 返回唯一当前 locus、权限与已确认锚点，不查找或新建 Invocation，不接受模型指定另一个入口

#### Scenario: 本机直接对话不沿用飞书回复授权
- **WHEN** 用户在 GUI 向协作子会话直接输入，上一轮曾由飞书消息触发
- **THEN** `pet_context` 可返回该 child 的 locus 与已确认锚点，但明确当前轮无飞书触发关联，不复用上一轮消息的回复授权

#### Scenario: 执行锚点尚未确认
- **WHEN** child 的 locus 尚未持久化经确认的执行目录或约束
- **THEN** 可信上下文明示缺失并允许按统一协作流程询问主会话，不从 cwd 或其它 locus 猜测，不伪报权限已满足

#### Scenario: 退休或失效 locus 的 child 调用上下文
- **WHEN** child 所属 locus 已退休、退出、失效或无法唯一证明关联，或该 child 仅属于旧 qa 绑定
- **THEN** 调用 fail closed，不把保留的旧会话历史、旧绑定或另一 locus 当作活动授权

### Requirement: Pet executor 的作用域组合在每次加载时存在

Pet 创建和管理的 root executor SHALL 在**每一次** Agent 进入活跃状态时获得与其 Task 形态一致的 scoped surface：所有这类 executor 都获得可信上下文能力；专用 Pet Workspace 中的 executor 还获得 Pet allowlist Skill provider；workspace-resident executor 则按前述边界保留 `standard` preset 与目标 workspace 自身的 Skill，不安装 Pet allowlist。这些既有 root executor 的组合保障不构成继续消费旧飞书 workspace/qa 绑定的许可，统一飞书工作仅走 `pet-locus-collaboration` 的主会话与专属子会话流程。

统一协作子会话 SHALL 在每一次加载时获得自身 Agent 作用域中的 caller-bound `pet_context`；其余组合由 DSH 子会话机制继承主会话。Pet MUST NOT 为安装上下文能力而替换、重新选择或重新 mount child 的继承 preset，MUST NOT 安装 Pet allowlist Skill provider 收窄或替换主会话继承的 Skill 面，也 MUST NOT 把 Pet Workspace standing instructions 或 root Invocation 身份强加给 child。该 scoped 上下文补充不是 Pet 专有 Agent composition；子代理只是执行细节。

该 scoped surface 无论 Agent 由 Pet 首次创建、由 Pet 从持久化 session 恢复，**还是由 Pet 之外的 DSH 自身加载**（例如用户从原生会话列表直接打开该 executor session）都必须存在。DSH 会卸载空闲 Agent，恢复时铸造**全新的** Agent 作用域，原作用域的注册随旧 Agent 一并销毁。因此 root executor 恢复路径 MUST 先实际 mount 与 Task 形态一致的 preset，再安装相同 scoped surface；只在创建时安装会让闲置后恢复的 Pet Task 丢失工具或隔离边界，而 Task 与 session 本身仍看似完好。统一协作子会话则 SHALL 保持 DSH 已恢复的主会话继承组合，仅补装该 child 的 scoped context，覆盖首次 fork 的首个 turn、Pet resume/冷恢复，以及 DSH 原生子会话加载；不得等到首轮工具调用失败后才补装。

由于 root executor session 按既有要求在原生 DSH 列表中可见并可打开，Pet MUST NOT 假定自己是 executor Agent 的唯一加载者：由 DSH 自身加载时，原生 session controller 已按持久化 metadata mount preset，Pet 的加载观察者 SHALL 只补 scoped surface，MUST NOT 重复 mount preset。系统 SHALL 根据 Task 记录判断是否安装 allowlist；重复安装 scoped surface SHALL 幂等，同一 Agent 被多次触发安装 MUST NOT 因重复注册而失败或中断加载。统一协作子会话从原生入口加载时也 SHALL 仅幂等补装自身的 scoped context，不重复或替换其继承 preset/Skill 组合。

该加载观察者对 Host 发布的**每一个** Agent 触发，因此"能按 executor session id 查到 Task"**不足以**证明该 Agent 可由 Pet 组合。观察者 SHALL 在安装任何 scoped surface **之前**区分普通 Pet root executor、当前有效 locus 的专属子会话以及旧 qa-child/其它未授权 Agent：root 按 Task 形态安装；有效协作 child 按唯一反向 locus 关联只安装可信上下文；旧 qa-child 或仅命中已退休/失效 locus 的 Agent MUST NOT 安装可信上下文能力或 Pet allowlist Skill provider。普通主会话与无 locus 的一般子代理 MUST NOT 因 `parentSession` 存在而获得 Pet 工具。多重、冲突或不能证明的身份 SHALL fail closed，MUST NOT 用旧 Task 查找结果覆盖 locus 身份。

若恢复路径无法完成该 Task 形态要求的 preset 或 scoped surface，系统 SHALL fail closed：拒绝在组合不完整的 executor 上派发 Invocation，并给出可诊断说明；MUST NOT 退化为缺少可信上下文能力的 executor，专用 Pet executor 也 MUST NOT 退化为 Host 全局 Skill 发现结果。对于统一协作子会话，无法证明当前 locus 有效或无法在首轮/恢复轮前安装 scoped context 时，同样 SHALL 拒绝派发协作轮次并给出诊断，不绕过到 root Invocation 路径，也不因 child 历史可读而继续服务已退休关联。

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
- **WHEN** Host 发布仅属于旧 qa 绑定的 fork child Agent，Pet 的加载观察者按其 session id 查到旧 qa-child Task，但不存在当前有效的新 locus 关联
- **THEN** 系统跳过该 Agent，不安装可信上下文能力、也不安装 Pet allowlist provider；其继承的历史组合不被改写，旧绑定不恢复服务

#### Scenario: qa-child 不被诱导调用可信上下文能力
- **WHEN** 用户打开仅属于旧 qa 绑定的 child 历史，而该 child 没有当前有效的新 locus 关联
- **THEN** child 的工具清单中不含 Pet 可信上下文能力，模型没有可调用入口，不会因该旧形态天然没有 Invocation 记录而收到"没有正在运行或等待的 Invocation"这类错误；群消息不得投递到旧 child

#### Scenario: 作用域组合缺失或安装失败
- **WHEN** 系统无法确认某 executor 已具备 Pet 作用域组合，或安装过程失败
- **THEN** 系统不在该 executor 上派发 Invocation，并给出可诊断说明，不退化为无隔离边界的执行

#### Scenario: 统一协作子会话首轮获得 scoped context
- **WHEN** 为一个有效 locus 首次创建专属子会话并准备其第一个 turn
- **THEN** 在首轮开始前该 child 的 Agent 作用域已有 `pet_context`，返回 caller-bound locus 而非 Invocation；主会话继承的 preset 与 Skill 面保持不变，不安装 Pet allowlist provider

#### Scenario: 统一协作子会话冷恢复保留 scoped context
- **WHEN** Pet 恢复一个有效 locus 的已卸载子会话或在 Host 重启后冷恢复它
- **THEN** 新 Agent 作用域在接收协作轮次前恢复 caller-bound `pet_context`，仅使用自身有效 locus 的已确认锚点，不重装或替换主会话继承组合

#### Scenario: 原生加载统一协作子会话
- **WHEN** 用户从 DSH 原生主会话的子会话列表打开一个有效 locus 的 child，由 DSH 自身完成加载
- **THEN** Pet 在该 child 上幂等补装 scoped context，不重复 mount preset、不安装 Pet allowlist provider，普通主会话与其它一般子会话不受影响

#### Scenario: 协作子会话上下文缺失时不派发
- **WHEN** 新建、恢复或原生加载的协作 child 无法证明 locus 唯一有效，或 scoped context 安装失败
- **THEN** 系统拒绝派发协作轮次并给出诊断，不回退到旧 qa/workspace 绑定或新建 root Invocation，也不更换继承的 preset 来绕过失败
