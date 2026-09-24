## Purpose

提供一个随 DSH 常驻、贴近当前工作现场但独立于源研发会话的桌宠式 Agent 入口，使用户可以在保留可信来源快照、任务连续性和完整可追溯关系的前提下快速执行管理型 Skills。

## ADDED Requirements

### Requirement: Pet 作为可独立安装的 DSH 伴生插件运行

系统 SHALL 以 DSH Host 与 Web Client 双半区插件提供 Pet。Host 半区 SHALL 随 `dsh web` 进程启动并拥有任务持久化、Agent 执行和后续后台 channel 的生命周期；Web 半区 SHALL 随对应 DSH 页面加载并提供交互界面。Pet MUST NOT 要求独立 daemon、Pi、ACP、cc-connect 或 ohmydsh 才能运行，但目标 DSH profile MUST 已安装该插件。

Pet Host 初始化或可选依赖失败时 SHALL 进入可诊断的 degraded 状态，而 MUST NOT 阻止 DSH 其余功能启动和使用。关闭浏览器不得停止已启动的 Pet Host 或正在执行的 Pet Task；停止 `dsh web` 时 Pet Host SHALL 终止并在下次启动恢复持久状态。

#### Scenario: 安装插件后启动 DSH Web
- **WHEN** 用户在任意标准 DSH Web profile 安装 Pet 插件并启动 `dsh web`
- **THEN** DSH Loader 在同一 Host 进程加载 Pet Host，浏览器加载 Pet Web，且不要求安装或运行 ohmydsh 与独立 Pet daemon

#### Scenario: Pet 可选能力初始化失败
- **WHEN** Pet 状态存储、Pet Workspace 或其它可选能力初始化失败
- **THEN** Pet 显示可诊断的 degraded 状态，DSH 的普通会话和工作台仍可使用

#### Scenario: 浏览器关闭但 DSH Host 继续运行
- **WHEN** 用户关闭 DSH 页面而一个 Pet Invocation 正在执行
- **THEN** Pet Host 继续管理该 Invocation，重新打开页面后从持久状态恢复其最新状态

### Requirement: Web 中提供常驻、可拖动且可访问的 Pet 入口

系统 SHALL 在 DSH 页面提供不替换原生工作台的 frame-wide 浮动 Pet。Pet SHALL 在普通会话、无会话 Hero 和 Settings 等页面状态间保持可用，允许用户拖动位置，并在页面重载后恢复已保存的位置。Pet MUST NOT 默认遮挡底层页面交互；其可交互表面 SHALL 明确接管指针和键盘操作。

鼠标 hover 或等价键盘操作 SHALL 展开快捷能力轮盘；点击 Pet 本体 SHALL 打开 Task/配置面板或提供等价入口。所有能力、任务状态、归档和上下文选择 MUST 可通过键盘操作，且深色与浅色主题下均保持可辨认。

#### Scenario: 在会话之间切换
- **WHEN** 用户从一个 DSH session 切换到另一个 session
- **THEN** Pet 保持挂载且位置不变，后续操作使用新的当前页面上下文而不是先前页面上下文

#### Scenario: 拖动并重载页面
- **WHEN** 用户拖动 Pet 到新的可见位置后重载 DSH 页面
- **THEN** Pet 在视口边界内恢复到已保存位置

#### Scenario: 键盘使用能力轮盘
- **WHEN** 键盘用户聚焦 Pet 并打开快捷能力
- **THEN** 用户可以遍历、选择或关闭能力轮盘，焦点状态和能力禁用原因均可感知

### Requirement: Pet 使用自有持久化任务模型

系统 SHALL 将 Pet Task、Pet Invocation、source snapshot、执行尝试、executor session 关联和归档状态持久化在 Pet 自有状态目录中。Pet Task ID SHALL 是关联关系的主身份；DSH session 标题、启动消息和其它可见文案仅作为投影，系统 MUST NOT 通过解析这些文案恢复或授权关联。

系统 SHALL 原子持久化状态，并在 Host 重启后恢复未完成任务、Invocation 队列和关联。状态目录 MUST 与插件安装目录分离，插件升级或 profile 重建不得覆盖 Pet 任务数据。归档 MUST NOT 删除 Pet 记录或 DSH session log。

#### Scenario: Host 重启后恢复进行中任务
- **WHEN** DSH Host 在 Pet Task 已创建且 Invocation 未完成时重启
- **THEN** Pet 从持久化关联恢复 Task、Invocation、snapshot 和 executor session，并将无法证明仍在执行的状态标记为可诊断待恢复状态而不是伪报成功

#### Scenario: 用户改名 executor session
- **WHEN** 用户修改 Pet executor DSH session 的标题
- **THEN** Pet Task 与 source 的关联保持不变，任务聚合和可信工具解析继续使用持久化 ID 关系

#### Scenario: 插件升级
- **WHEN** Pet 插件包或 DSH profile 被重新构建
- **THEN** Pet 的任务、快照和配置仍保存在独立状态目录中且可恢复

### Requirement: 每个来源 scope 至多有一个活跃 Pet Task

系统 SHALL 将 Pet Task 建模为一个长期工作线程。对相同来源 scope，系统 SHALL 复用唯一未归档 Pet Task 及其固定 executor DSH session，并把多次能力调用追加为不同 Pet Invocations；系统 MUST NOT 因每次调用 Skill 而创建新的 Task 或 executor session。

Pet Task 归档后 MUST NOT 再接收新 Invocation。用户在同一来源 scope 再次使用 Pet 时，系统 SHALL 创建新的 Task epoch 和新的 executor session，并保留旧 Task 的历史。

来源 scope SHALL 至少支持：指定 DSH session、指定 DSH workspace 和无关联的独立 scope。不同 scope 的 Task MUST NOT 被错误复用。

#### Scenario: 在同一 source session 多次调用能力
- **WHEN** 用户在同一 DSH source session 依次调用 Create MR、Send CR 和 Clean Worktree，且其 Pet Task 未归档
- **THEN** 系统创建一个 Pet Task 和一个 executor DSH session，并在其中按顺序追加三个独立 Invocation

#### Scenario: 归档后再次调用
- **WHEN** 用户归档某 source session 的活跃 Pet Task 后再次从该 source session 调用能力
- **THEN** 系统创建新的 Task epoch 和 executor session，旧 Task 保持只读历史且不被复活

#### Scenario: 不同来源分别调用 Pet
- **WHEN** 两个不同 DSH sessions 各自调用 Pet
- **THEN** 系统为两个 source scope 分别维护活跃 Pet Task，不共享 executor session 或当前 Invocation

### Requirement: 每次主动调用在发起位置捕获独立快照

系统 SHALL 在用户主动调用能力或提交新 Pet 请求时创建 Pet Invocation，并在接受操作的同一逻辑时刻固定 source identity、可用的 session event 位置、session metadata、workspace metadata、worktree binding 和 SCM metadata。后续页面切换、source session 继续运行或元数据变化 MUST NOT 改写该 Invocation 已绑定的 snapshot。

系统 MAY 按引用和结构化摘要组合保存快照，但 SHALL 保存足以解释 Invocation 发起位置和目标的不可变信息。Agent 内部重试 SHALL 继续使用同一 Invocation snapshot；用户再次主动执行 SHALL 创建新的 Invocation 和新 snapshot。

#### Scenario: 调用后立即切换页面
- **WHEN** 用户在 Session A 发起 Create MR 后立即切换到 Session B
- **THEN** 已创建 Invocation 仍绑定 Session A 在点击时的 snapshot，执行期间不得重新读取浏览器当前 Session B 作为目标

#### Scenario: 同一 Task 的后续能力看到更新现场
- **WHEN** Create MR 完成后 source session 状态继续演进，用户随后调用 Send CR
- **THEN** Send CR 获得新的 Invocation snapshot，并可观察调用时已经存在的 MR 信息，而不复用 Create MR 的首次快照

#### Scenario: Agent 自动重试
- **WHEN** 一个 Invocation 因瞬态网络失败执行内部重试
- **THEN** 重试继续使用原 Invocation 和 snapshot，不因重试时 source 已变化而切换目标

### Requirement: 来源上下文是显式且可移除的一等输入

系统 SHALL 支持 `session`、`workspace` 和 `none` 三类 Pet Task 来源。每项 Pet Capability SHALL 声明其上下文要求为无需上下文、可选上下文、需要 workspace 或需要 session。用户在执行前 SHALL 能看见有效来源；可选来源 SHALL 允许用户移除或改选。

没有 active DSH session 时，系统 MUST NOT 隐式绑定最近使用的 session。无需上下文或可选上下文能力 SHALL 能从 `none` 来源创建或复用独立 Pet Task；需要 session/workspace 的能力在缺少目标时 SHALL 禁止执行并提供选择入口。

#### Scenario: 从无会话页面发起独立任务
- **WHEN** 用户在没有 active session 的页面调用一个无需上下文的能力
- **THEN** 系统以 `none` 来源创建或复用独立 Pet Task，启动消息明确显示没有 source DSH session

#### Scenario: 移除可选当前会话
- **WHEN** 一个可选上下文能力默认显示当前 session，用户在执行前移除该关联
- **THEN** Invocation 使用 `none` 来源，且不得向 Agent 暴露刚被移除的 session 上下文

#### Scenario: 缺少强制 session
- **WHEN** 用户没有 active session 且选择需要 session 的 Clean Worktree 能力
- **THEN** 系统不创建 Invocation，并提示用户选择一个符合条件的 DSH session

### Requirement: Pet Task 使用专用 Workspace 中的普通 DSH executor session

系统 SHALL 确保存在一个标题可识别的 `DSH Pet` Workspace，其路径位于 Pet 持久状态目录而非插件安装目录。每个 Pet Task SHALL 固定关联该 Workspace 下的一个普通 DSH root session，并复用同一 DSH Host 已装配的 Agent Loop、Skills、Tools、交互能力和 LLM provider；executor session SHALL 在原生 DSH 列表中可见并可打开。

创建 executor session 后，系统 SHALL 按 Pet 配置选择 Pet Agent composition 与模型。当前 Web profile 已注册的 subscription provider SHALL 可被 Pet executor session 正常选择，Pet MUST NOT 读取、复制或另行保存 provider token。模型或 Pet composition 不可用时 SHALL 让 Task 进入可诊断失败/等待配置状态，不得创建伪成功结果。

#### Scenario: 首次为 source scope 启动 Task
- **WHEN** 用户首次从某 source scope 调用 Pet 能力
- **THEN** 系统在 `DSH Pet` Workspace 创建一个普通 executor session、保存双向关联并将 Invocation 投递给该 session

#### Scenario: 打开完整执行过程
- **WHEN** 用户从 Pet Task 面板点击“打开完整过程”
- **THEN** DSH 打开该 Task 固定关联的原生 executor session，用户可查看历史、回答问题、取消或继续会话

#### Scenario: 使用订阅 provider
- **WHEN** Pet 配置选择了当前 DSH Web Host 中已登录并可路由的 Claude 或 Codex subscription provider
- **THEN** executor session 使用该 provider 执行，不要求 Pet 复制凭据或再次登录

#### Scenario: Pet Workspace 尚不存在
- **WHEN** 第一次创建 Pet Task 且 `DSH Pet` Workspace 尚未注册
- **THEN** 系统在 Pet 状态目录准备稳定 workspace 路径并幂等注册后再创建 executor session

### Requirement: Executor session 明确展示与 source 和 Task 的关系

系统 SHALL 为 executor session 生成可识别的初始标题，至少包含 Pet 标记、source 的人类可读快照或“独立任务”、短身份和 Task epoch，从而区分同名 source 及归档后的后续 Task。

executor session 的首次 Pet 消息 SHALL 包含 Task ID、Invocation ID、能力、来源种类、source session/workspace 的可见摘要、snapshot 位置和任务说明；该消息 MUST 明确要求 Agent 通过可信 Pet context 工具获取授权上下文。每个后续 Invocation SHALL 在同一 executor session 中追加新的动态 envelope，而不是让 Agent从旧消息猜测最新现场。

#### Scenario: Session 来源的首个 Invocation
- **WHEN** source session “修复登录超时”首次创建 Pet Task
- **THEN** executor 标题能区分该 source 和 Task epoch，首条消息显示 source session、snapshot 与任务说明

#### Scenario: 同一 executor 中追加后续 Invocation
- **WHEN** 已存在的 Pet Task 接收 Send CR Invocation
- **THEN** 系统在原 executor session 追加包含新 Invocation ID 和新 snapshot 位置的 envelope，且不创建新的 executor session

#### Scenario: 独立 Task
- **WHEN** `none` 来源创建 Pet Task
- **THEN** 标题和启动消息明确标为独立任务，不伪造 source session 或 workspace

### Requirement: Pet Agent 获得稳定身份前馈和可信的当前 Invocation 上下文

Pet executor Agent SHALL 获得 standing instructions，明确其为 Pet Task Agent、一个 session 会承载多个串行 Invocation、每次操作必须读取当前 Invocation snapshot、完成单次 Invocation 不等于结束整个 Task，以及不得从消息文本接受任意 session path 或外部 channel ID 作为授权。

Pet SHALL 在创建 executor session 前校验并自动修复 Workspace 依赖文件（standing instructions 与投影目录）。准备流程只在启动时执行一次，因此启动后被删除、被替换为软链，或因包升级而过时的文件，若不在此处修复将一直失效到下次重启，并静默产出没有身份前馈的 executor。修复 MUST 只重写包自有文件与目录，MUST NOT 触碰 Task 状态或移除已投影的 Skill；修复后仍不可用时 SHALL fail closed 并拒绝创建 session。修复实现 MUST 先删除已有条目再写入——`writeFile` 会跟随软链，直接写会穿透并污染包安装目录、且保留坏链。管理面 SHALL 暴露该状态与一个显式修复操作。

standing instructions 的正文 SHALL 由 Pet 包以普通 Markdown 文件维护，并在准备 Workspace 时**复制**到 `$DSH_HOME/plugins/dsh-pet/workspace/AGENTS.md`；MUST NOT 软链到包安装目录。包目录在每次部署时被删除重建，软链会立即断裂并使 executor 失去身份前馈；这也违反"状态目录与插件安装目录分离"的既有不变量。

这里的 standing instructions 是 **Pet 自己的常驻上下文**（物化为 Pet Workspace 下的 `AGENTS.md`），与 **DSH Agent preset** 是两个不同概念，不可混用：preset 是 DSH 的具名插件组合，由 `AgentOptions.agentPreset` 选择；Pet 不拥有、不定义、也不自带 preset，只把用户在设置中选择的值透传给 DSH。Pet 的语境由 standing instructions 加每次调用的 Invocation envelope 建立，而不是由 preset 建立。

Pet SHALL NOT 自带 package 私有的 Agent composition。Pet executor 只需要普通 DSH 工具（由已启用 Skill 驱动），因此 Host 默认组合即为正确选择；引入 Pet 专有组合会让 Pet 重新成为特权容器。仅当出现明确需求（例如刻意收窄 executor 的工具面）时才重新评估。

系统 SHALL 提供无目标参数的可信上下文能力。调用时 Host MUST 从实际调用 executor session 反查 Pet Task、当前 Invocation 和 snapshot，并返回绑定的 source/context；模型 MUST NOT 能通过传入任意 task/session/workspace 标识改绑目标。不存在唯一当前 Invocation、Task 已归档或调用 session 未绑定 Pet Task 时，能力 SHALL fail closed 并返回可诊断错误。

#### Scenario: Agent 获取当前快照
- **WHEN** Pet executor Agent 在 Invocation 执行开始时调用 Pet context 能力
- **THEN** Host 根据调用 executor session 返回当前 Invocation 的可信 source snapshot，而不要求或接受模型提供 source ID

#### Scenario: 非 Pet session 调用上下文能力
- **WHEN** 普通 DSH session 调用 Pet context 能力
- **THEN** 系统拒绝请求并说明该 session 未绑定 Pet Task，不暴露其它 Task 上下文

#### Scenario: 归档 Task 的 executor 再次调用
- **WHEN** 已归档 Task 的 executor Agent 尝试获取活动 Invocation 上下文
- **THEN** 系统 fail closed，不将旧 snapshot 当成新的可执行授权

### Requirement: 同一 Pet Task 的 Invocations 严格串行

系统 SHALL 保证每个 Pet Task 同时至多有一个 running 或 waiting-user Invocation。用户在当前 Invocation 未终结时发起的新能力 SHALL 进入该 Task 的持久队列，不得与当前 Invocation 并发使用同一个 executor session。当前 Invocation 完成、失败或取消后，系统 SHALL 按接受顺序启动下一项；waiting-user 状态不得被后续 Invocation 隐式抢占。

#### Scenario: 连续点击两个能力
- **WHEN** 用户在 Create MR 尚未完成时点击 Send CR
- **THEN** Send CR Invocation 被持久排队，Create MR 仍是 Pet context 工具解析的唯一当前 Invocation

#### Scenario: 当前 Invocation 等待用户
- **WHEN** Create MR 正在等待用户选择 target branch 且队列中已有 Send CR
- **THEN** Send CR 保持排队，用户回答继续发送给同一 Create MR Invocation

#### Scenario: 当前 Invocation 完成
- **WHEN** 当前 Invocation 进入终态且队列非空
- **THEN** 系统按序启动下一 Invocation，并使可信上下文能力原子切换到其 snapshot

### Requirement: Pet 面板按来源聚合并管理 Task 和 Invocation

Pet 面板 SHALL 显示当前来源 scope 的活跃 Pet Task、其 executor session 状态和按时间排列的 Invocations，并允许切换查看其它来源和已归档 Task。每个 Invocation SHALL 显示能力、运行/排队/等待/结果/失败状态及必要结果链接；复杂执行过程 SHALL 通过打开原生 executor session 查看，Pet 面板不要求复制完整 DSH transcript。

用户 SHALL 能从面板回答当前等待问题、取消当前 Invocation、重试失败 Invocation、打开 source/executor session，以及在允许时归档 Task。重试瞬态执行尝试不得创建新 snapshot；用户主动重新执行能力 SHALL 创建新 Invocation 和新 snapshot。

#### Scenario: 当前 session 有多次 Pet 调用
- **WHEN** 当前 source session 的 Pet Task 已执行 Create MR 并正在执行 Send CR
- **THEN** 面板在一个 Task 下显示两条 Invocation、各自状态和同一个 executor session 跳转入口

#### Scenario: 查看其它来源任务
- **WHEN** 用户从当前来源切换到“全部任务”
- **THEN** 面板可按 source session/workspace/独立来源聚合展示活跃和已归档 Task，且不会把 executor session 当作 source

#### Scenario: 失败 Invocation 重试
- **WHEN** 用户对因瞬态错误失败的 Invocation 选择重试
- **THEN** 系统新增执行尝试并继续使用原 Invocation snapshot，状态和失败原因可见

### Requirement: Pet Skill 通过显式安装和启用清单管理

Pet SHALL 将“已安装”“已启用”“显示为快捷能力”建模为显式 Pet 配置，而 MUST NOT 把 DSH 全局 Skill 发现结果自动加入 Pet。Pet Agent 的 model-facing catalog、`skill` loader 和用户显式 `/<skill-name>` 注入 SHALL 只允许当前配置代际中已启用且由当前 Invocation 固定版本的 Pet Skill；未启用、仅全局可见、已卸载或名称碰撞的 Skill SHALL fail-closed。

一期 SHALL 支持两种安装来源：Pet 插件 manifest 显式声明的受信内置 Skill，以及用户从运行当前 `dsh web` 的 Host 机器绝对路径显式导入的单层 Skill bundle。Web UI SHALL 先提交该路径执行只读检查并展示名称、摘要、文件范围、来源和风险预览，只有用户再次确认后才复制安装；它 MUST NOT 把路径解释为浏览器客户端路径或直接提供持续挂载。首次 Host 初始化 SHALL 仅安装并启用 manifest 标记为 `defaultEnabled` 的一期内置能力；插件升级发现的新内置版本 SHALL 显示为可升级项，但 MUST NOT 静默替换当前选中摘要。安装 SHALL 把经过名称、frontmatter、文件类型、大小和路径边界验证的内容复制到 `$DSH_HOME/plugins/dsh-pet/skills/store/` 的不可变版本中，而 MUST NOT 持续扫描、软链接或在执行时信任原导入目录。Git、URL、npm 与自动市场发现不属于一期。

Pet SHALL 根据启用清单在 `$DSH_HOME/plugins/dsh-pet/workspace/.dsh/skills/` 原子生成由 Pet 管理的目录软链投影：每个 `<skill-name>` 软链指向用户注册该 Skill 时给定的目录本身。Pet 不复制 Skill 内容——注册即链接，因此用户修改该目录会立即影响后续调用。Pet SHALL 通过同目录临时软链加原子 rename 切换目标，并在发布前验证目标仍是一个包含 `SKILL.md` 的目录。损坏、目标缺失或用户手工替换的投影 SHALL fail-closed 并进入可诊断漂移状态。

DSH filesystem Skill provider 对目录软链执行跟随并把最终目录识别为 Skill bundle；该兼容投影不得作为 Pet Agent 的授权边界。Pet 不得同时投影到 `.agents/skills` 或 provider 专用目录来制造重复候选。用户注册的 bundle 内部若含软链仍 SHALL 被拒绝；只有 Pet Host 自己创建、目标为已注册 Skill 目录的投影软链受支持。模型 provider 选择 MUST NOT 改变 Skill 注册位置。Pet 不提供内置 Skill 类别：所有 Skill 均由用户显式加入，加入一个能力是一次注册而非一次代码改动。由于注册即链接，Skill 内容可随时被其源目录改动；Pet 记录调用当时的来源路径用于诊断，但不承诺内容快照。

#### Scenario: 首次初始化默认内置 Skill
- **WHEN** Pet Host 第一次初始化且 manifest 将 Create MR、Send CR 和 Clean Worktree 标记为 `defaultEnabled`
- **THEN** Host 校验并复制其不可变版本到 Pet Skill store，显式启用这三个版本并记录来源、摘要和安装时间，不扫描包中未声明的目录

#### Scenario: 插件升级提供内置新版本
- **WHEN** 新 Pet 包为已启用 Skill 提供与当前摘要不同的受信内置版本
- **THEN** Skills 页显示可升级版本，当前选择和已排队 Invocation 均保持原摘要，直到用户明确升级

#### Scenario: 从 Host 本地目录导入 Skill
- **WHEN** 用户输入运行当前 `dsh web` 的 Host 绝对路径，检查包含有效 `SKILL.md` 和资源文件的 Skill bundle，并在预览后确认导入
- **THEN** Host 在路径和内容校验后复制安装该 bundle；之后修改或删除原目录不会改变已安装版本，浏览器所在机器的同名路径不参与解析

#### Scenario: 启用 Skill
- **WHEN** 用户启用一个已安装 Skill
- **THEN** Host 原子更新 Pet allowlist，并把 Workspace `.dsh/skills/<name>` 软链切换到受管 store 中匹配摘要的不可变目录；后续新 Pet Invocation（包括复用现有 Task 的调用）可在 Pet catalog 中看到该固定版本

#### Scenario: 投影软链被手工替换或越界
- **WHEN** Workspace Skill 软链损坏、被替换为普通文件，或解析后的目标离开 Pet 受管 immutable store
- **THEN** Pet 不加载该投影、不回退到全局同名 Skill，Diagnostics 显示漂移并仅允许通过显式重建恢复

#### Scenario: 全局存在未启用同名 Skill
- **WHEN** DSH 用户或项目全局目录中存在某 Skill，但 Pet 未显式启用它或启用了另一个固定版本
- **THEN** Pet Agent 不发布、加载或注入全局版本，并使用 Pet allowlist 中固定版本或明确拒绝调用

#### Scenario: 升级正在排队的 Skill
- **WHEN** Skill v1 已被一个排队 Invocation 固定，而用户把该 Skill 升级并启用 v2
- **THEN** 已排队 Invocation 仍执行 v1，新创建 Invocation 使用 v2，v1 在引用释放前不会被物理清理

#### Scenario: 选择不同模型 provider
- **WHEN** 用户为 Pet 从当前 DSH Host 选择 Claude、DeepSeek 或其它可路由模型 provider
- **THEN** Pet executor 使用同一个 Pet `.dsh/skills` 投影和显式 catalog，不要求把 Skill 分别安装到 provider 专用目录

### Requirement: Pet 能力以 Agent Skill 驱动并以有界工具完成副作用

一期 SHALL 内置并默认提供 Create MR、Send CR 和 Clean Worktree 三项 Pet 能力，并让每项能力在对应 executor session 中通过明确的 Skill Invocation 执行。Pet SHALL 允许 Agent参与现场检查、信息补全、结果生成和用户澄清，但创建 MR、发送外部消息、清理 worktree 等副作用 SHALL 通过确定性、有界且可审计的工具或现有安全门禁执行。

Create MR 和 Clean Worktree SHALL 要求 session 来源；Send CR SHALL 至少支持 session 来源，并在缺少可信 workspace/group/MR 绑定时等待用户补充或明确失败。Pet MUST NOT 让模型通过自由文本自行替换 source 路径、MR 目标、飞书群或 reviewer 绑定。

#### Scenario: Create MR 需要澄清
- **WHEN** Agent 检查 source snapshot 对应 worktree 后无法唯一确定 target branch
- **THEN** Invocation 进入 waiting-user，用户回答后在同一 executor session 和 Invocation 中继续

#### Scenario: Clean Worktree 遇到不安全状态
- **WHEN** source worktree 尚有未提交修改或无法证明满足清理门禁
- **THEN** Agent 和确定性工具停止清理并返回可操作说明，不绕过既有安全检查

#### Scenario: Send CR 缺少可信群绑定
- **WHEN** source workspace 没有配置可用的 CR 目标群
- **THEN** Invocation 不向任意群发送消息，进入等待配置或失败状态并说明缺失项

#### Scenario: Send CR 成功
- **WHEN** MR、reviewer 和目标群均由可信绑定解析且用户要求发送
- **THEN** 有界发送工具按结构化模板发送，并把消息链接和目标摘要记录为 Invocation 结果

### Requirement: Task 与 DSH session 归档语义保持一致且不误删历史

归档 source session SHALL 只更新 Pet 中的来源可用状态，不得自动归档其 Pet Task。归档已进入终态的 executor session SHALL 自动归档对应 Pet Task；从 Pet 面板归档终态 Task SHALL 同步归档其 executor session。running 或 waiting-user Task MUST NOT 因 executor session 被归档而从活跃列表消失或被隐式取消。

系统 MUST 将 Task 执行状态与归档状态分开保存。对非终态 Task 发起归档时 SHALL 要求用户先取消或明确执行取消后归档，且归档操作不得删除 Task、Invocation、snapshot 或 DSH log。

#### Scenario: Source session 被归档
- **WHEN** 用户归档仍有关联 Pet Task 的 source DSH session
- **THEN** Pet Task 保持活跃或保持原终态，面板标记来源已归档并继续保留 executor session 与历史

#### Scenario: 归档已完成 executor session
- **WHEN** 用户从原生 DSH UI 归档一个已完成 Pet executor session
- **THEN** 对应 Pet Task 自动记录归档时间且不再接受新的 Invocation

#### Scenario: 从 Pet 归档已完成 Task
- **WHEN** 用户在 Pet 面板归档一个 succeeded、failed 或 cancelled Task
- **THEN** 系统同步归档其 executor session并保留全部持久历史

#### Scenario: 尝试归档等待用户的 Task
- **WHEN** 用户对 waiting-user Task 发起归档但未确认取消
- **THEN** 系统不归档 Task、不取消 Invocation，并提示需要先处理或取消当前工作

### Requirement: Pet 设置采用固定的四页签信息架构且不接触 provider 凭据

系统 SHALL 在 DSH Settings 注册独立 Pet section，并固定包含以下四个页签：

- **General**：Pet 外观/位置重置、默认 Agent composition、provider/model、新 Task 使用的默认上下文策略；
- **Skills**：内置 Skill 列表、本地目录导入、已安装版本、启用/禁用、快捷能力可见性、升级/卸载和 Workspace 投影同步状态；
- **Bindings**：Send CR 等副作用所需的可信 workspace/business/group/reviewer 绑定；
- **Diagnostics**：Host 生命周期、状态/Workspace/Skill store 与投影路径、版本摘要、同步漂移、依赖可用性以及显式修复/重建投影操作。

Pet 浮层与 Task 面板 SHALL 只提供快捷能力执行、调用前来源确认以及 Task/Invocation 的日常操作；它们 MUST NOT 承担 Skill 安装、版本管理、可信绑定编辑或完整诊断配置。浮层 SHALL 提供进入相应 Settings 页签的明确入口。

Pet SHALL 显示 provider/model 可用性，但 MUST NOT 读取、回传或保存 subscription token 和其它 provider credentials。配置写入失败 SHALL 保留用户输入并显示错误；需要重启才生效的配置 SHALL 明确提示。敏感 channel 字段在未来加入时 SHALL 以 secret reference 或等价受保护机制保存，管理读取不得回显明文。

#### Scenario: 打开 Pet 设置
- **WHEN** 用户从 Pet 浮层或 DSH Settings 打开 Pet 配置
- **THEN** 用户看到 General、Skills、Bindings、Diagnostics 四个稳定页签，并能在 Skills 页完成安装、启用和投影诊断而无需进入 Task 执行面板

#### Scenario: Skill 投影发生漂移
- **WHEN** Diagnostics 检测到已启用 allowlist 与 Workspace `.dsh/skills` 投影摘要不一致
- **THEN** Pet 显示具体漂移项且停止把不一致 Skill 用于新 Invocation，用户可执行显式重建投影

#### Scenario: 选择已注册模型
- **WHEN** 用户在 Pet 设置中选择当前 DSH Host 可路由的 provider/model
- **THEN** 后续新 Pet executor session 使用该选择，Pet 配置中不出现 provider token

#### Scenario: 选择不可用模型
- **WHEN** 已配置 provider/model 在当前 Host 不可路由
- **THEN** Pet 在启动 Invocation 前显示可诊断配置错误，不静默回退到另一个可能产生不同副作用的模型

#### Scenario: 保存 workspace CR 绑定失败
- **WHEN** 用户提交不完整或无效的 workspace/group/reviewer 配置
- **THEN** 系统拒绝部分写入、保留表单输入并指出无效字段

### Requirement: 一期由 ohmydsh 管理部署且不改变 Cockpit 和外部 transport 边界

本仓 SHALL 在 `packages/dsh-pet/` 保存一期插件源码，并以 `dsh.yaml` 中一个可逆的 local package customization 作为本机 profile 安装、启用和禁用的唯一真相源。sync/build SHALL 幂等物化该插件且不得把 Pet runtime database、Skill store、Workspace、生成 profile 或 package `lib/` 当作应提交源码。插件包本身 SHALL 保持可独立安装，运行时 MUST NOT 依赖 ohmydsh 脚本。

一期 Pet SHALL 仅在其所在 DSH 设备内创建 Task 和 executor session，不修改 dsh-cockpit 仓，不新增 Cockpit 对 DSH 的写代理，不修改 `dsh-cockpit-bridge` 只上报 active session ID 的契约，也不实现飞书入站 transport、同 bot 多设备竞争或 Cockpit Pet Hub。跨设备 Pet 聚合、设备路由、共享 Bot 或 Pet Hub SHALL 在需求出现时由 dsh-cockpit 的独立 change 负责。

系统的持久模型 SHALL 允许未来为 Pet Task/Invocation增加可信 Channel Binding。未来外部回复能力 MUST 根据调用 executor session 和当前 Invocation 解析绑定目标，MUST NOT 接受模型生成的任意 chat/thread/user ID；该演进约束不要求一期提供可见 channel 功能。

#### Scenario: ohmydsh 重复物化 Pet customization
- **WHEN** 用户在相同 manifest 和源码下连续运行两次 sync/build
- **THEN** 第二次运行不产生配置或安装漂移，Pet runtime 状态保持在 `$DSH_HOME/plugins/dsh-pet/` 且不回写仓库

#### Scenario: Cockpit 承载安装 Pet 的设备
- **WHEN** 用户通过 Cockpit iframe 使用已安装 Pet 的设备
- **THEN** Pet 在该设备原生 DSH 页面内运行，Cockpit 仍不代理 Pet executor RPC、settings 或 provider credentials

#### Scenario: 一期没有 Channel Binding
- **WHEN** Agent 请求回复外部会话但当前一期部署没有 channel 能力
- **THEN** 系统明确报告能力不存在，不允许 Agent 通过任意目标标识绕过边界
