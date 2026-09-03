# dsh-pet Specification

## Purpose
TBD - created by archiving change add-dsh-pet. Update Purpose after archive.
## Requirements
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

系统 SHALL 在 DSH 页面提供不替换原生工作台的**视口级**浮动 Pet。Pet SHALL 在普通会话、无会话 Hero 和 Settings 等页面状态间保持可用，允许用户拖动位置，并在页面重载后恢复已保存的位置。Pet 的位置 SHALL 以视口为坐标系，MUST NOT 因应用外壳的布局变化（侧栏、工作台、详情列的展开收起或调宽）而被移动或裁剪。Pet MUST NOT 默认遮挡底层页面交互；其可交互表面 SHALL 明确接管指针和键盘操作，而未绘制区域 MUST NOT 拦截指针事件。

快捷能力 SHALL 呈现为以 Pet 本体为圆心的同心圆环轮盘。轮盘 SHALL 由内向外填充，每圈填满后才启用下一圈，最多三圈，容量依次为 6、8、10，合计上限 24 个能力；超出上限的能力 MUST NOT 渲染，且 MUST NOT 因此报错或阻断其余能力。

hover Pet 本体或等价键盘操作 SHALL 展开轮盘；指向 Pet 本体之外的区域 MUST NOT 唤起轮盘。展开后，从圆心到最外侧已渲染圆环之间的整个圆盘 SHALL 视为轮盘的可保持区域，其中包含圆环之间的间隙与扇区接缝；指针离开该区域 SHALL 立即收起轮盘。可保持区域的半径 SHALL 按实际渲染的圈数计算，MUST NOT 按最大圈数计算。

轮盘 SHALL 逐圈渐入：第一圈在展开时立即可见，其后每圈依次延迟出现，使层次可被感知而不显著推迟可操作时间。

扇区标签 SHALL 沿弧线切向排布并随扇区角度旋转；当该角度会使文字上下颠倒时，系统 SHALL 将其翻转 180°，使任意位置的标签均保持可正向阅读。标签超出扇区弧长可容纳的宽度时 SHALL 截断并以省略号标示。

点击 Pet 本体 SHALL 打开 Task 面板或提供等价入口。所有能力、任务状态和上下文选择 MUST 可通过键盘操作，且深色与浅色主题下均保持可辨认。

#### Scenario: 在会话之间切换
- **WHEN** 用户从一个 DSH session 切换到另一个 session
- **THEN** Pet 保持挂载且位置不变，后续操作使用新的当前页面上下文而不是先前页面上下文

#### Scenario: 拖动并重载页面
- **WHEN** 用户拖动 Pet 到新的可见位置后重载 DSH 页面
- **THEN** Pet 在视口边界内恢复到已保存位置

#### Scenario: 应用侧栏展开
- **WHEN** 任一侧栏或工作台展开并压缩应用外壳的可用宽度
- **THEN** Pet 的屏幕位置保持不变，不被推移也不被裁剪

#### Scenario: 指针掠过 Pet 周围空白
- **WHEN** 指针经过 Pet 本体之外、轮盘尚未展开的区域
- **THEN** 轮盘保持收起，且该区域不拦截底层页面的指针操作

#### Scenario: 从 Pet 本体移向外圈能力
- **WHEN** 用户 hover Pet 展开轮盘后，将指针移向某个外圈扇区
- **THEN** 轮盘在移动全程保持展开，经过圆环间隙与扇区接缝时不收起

#### Scenario: 能力不足以填满三圈
- **WHEN** 已启用能力只够渲染一圈，用户将指针移到第二圈本应所在的空白位置
- **THEN** 轮盘收起，因为该位置不属于已渲染的圆盘

#### Scenario: 能力数量超过轮盘上限
- **WHEN** 已启用能力多于 24 个
- **THEN** 轮盘渲染前 24 个能力，其余不渲染，且轮盘与其余功能均可正常使用

#### Scenario: 标签位于轮盘下方
- **WHEN** 某个能力的扇区位于轮盘正下方
- **THEN** 该扇区标签正向朝上显示，不出现上下颠倒

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

系统 SHALL 支持 `session`、`workspace` 和 `none` 三类 Pet Task 来源。用户在执行前
SHALL 能看见有效来源，并 SHALL 能移除或改选该来源。

系统 MUST NOT 按能力施加上下文门禁：Pet 不声明也不存储任何"此能力需要
session/workspace"的要求，任何能力在任何来源下都 SHALL 可被发起。没有 active DSH
session 时，系统 MUST NOT 隐式绑定最近使用的 session，而 SHALL 以 `none` 来源创建
或复用独立 Pet Task，并在启动消息中明确标注没有 source DSH session。

对来源的实质要求由 Skill 自身在执行时校验并向用户说明。

#### Scenario: 从无会话页面发起任务
- **WHEN** 用户在没有 active session 的页面调用一个能力
- **THEN** 系统以 `none` 来源创建或复用独立 Pet Task，启动消息明确显示没有
      source DSH session，能力正常派发

#### Scenario: 移除可选当前会话
- **WHEN** 一个能力默认显示当前 session，用户在执行前移除该关联
- **THEN** Invocation 使用 `none` 来源，且不得向 Agent 暴露刚被移除的 session 上下文

#### Scenario: 来源不满足由 Skill 报告
- **WHEN** 用户以 `none` 来源发起一个实际需要 session 的 Skill
- **THEN** Invocation 正常创建并派发，Skill 经 `pet_context` 发现来源不足后停止并
      说明需要从一个会话发起

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

面板中每个 Task SHALL 呈现为单一可点击条目，点击 SHALL 打开该 Task 的 executor session。面板 MUST NOT 提供归档 Task 的入口；归档 SHALL 在 executor session 自身完成，Pet SHALL 观察归档变化并同步——终态 Task 自动归档，非终态 Task 保持活跃并给出可诊断说明，MUST NOT 把外部归档当作工作已被取消的证据。

用户 SHALL 能从面板回答当前等待问题。重试瞬态执行尝试不得创建新 snapshot；用户主动重新执行能力 SHALL 创建新 Invocation 和新 snapshot。

#### Scenario: 当前 session 有多次 Pet 调用
- **WHEN** 当前 source session 的 Pet Task 已执行 Create MR 并正在执行 Send CR
- **THEN** 面板在一个 Task 下显示两条 Invocation、各自状态和同一个 executor session 跳转入口

#### Scenario: 查看其它来源任务
- **WHEN** 用户从当前来源切换到“全部任务”
- **THEN** 面板可按 source session/workspace/独立来源聚合展示活跃和已归档 Task，且不会把 executor session 当作 source

#### Scenario: 从面板进入执行会话
- **WHEN** 用户点击面板中的某个 Task 条目
- **THEN** 系统打开该 Task 的 executor session，且该条目不提供归档或取消操作

#### Scenario: 在会话中归档终态 Task
- **WHEN** 用户在某个终态 Pet Task 的 executor session 中归档该会话
- **THEN** Pet 同步将该 Task 标记为已归档，无需用户在 Pet 面板中另行操作

#### Scenario: 在会话中归档仍在进行的 Task
- **WHEN** 用户归档了一个仍处于非终态的 Pet Task 的 executor session
- **THEN** 该 Task 保持活跃并显示可诊断说明，Pet 不将其视为已取消

### Requirement: Pet Skill 通过显式安装和启用清单管理

Pet SHALL 将“已安装”“已启用”“显示为快捷能力”建模为显式 Pet 配置，而 MUST NOT 把 DSH 全局 Skill 发现结果自动加入 Pet。Pet Agent 的 model-facing catalog、`skill` loader 和用户显式 `/<skill-name>` 注入 SHALL 只允许当前配置代际中已启用且由当前 Invocation 固定版本的 Pet Skill；未启用、仅全局可见、已卸载或名称碰撞的 Skill SHALL fail-closed。

设置界面 SHALL 在已启用 Skill 达到轮盘容量上限（24 个）时阻止继续启用，并说明原因。该上限属于呈现约束，MUST NOT 影响授权边界：超出上限不改变任何 Skill 的启用状态或可执行性，只影响其是否出现在轮盘上。

安装来源 SHALL 只有一种：用户从运行当前 `dsh web` 的 Host 机器绝对路径显式导入的单层 Skill bundle。Pet MUST NOT 自带、声明或自动安装任何 Skill——不存在"内置 Skill"这一类别，因此也不存在内置与外部之分。Web UI SHALL 先提交该路径执行只读检查并展示名称、摘要、文件范围、来源和风险预览，只有用户再次确认后才注册安装；它 MUST NOT 把路径解释为浏览器客户端路径。

注册 SHALL 记录用户自有目录的链接而非内容副本，因此对该目录的修改立即生效、无需重新导入；目录被删除或移走时该 Skill SHALL 失效并拒绝执行，而不是运行过期副本。

#### Scenario: 启用数量达到上限
- **WHEN** 用户已启用 24 个 Skill，并尝试启用第 25 个
- **THEN** 系统拒绝该次启用并说明已达轮盘容量上限，已启用的 Skill 不受影响

#### Scenario: 存量启用数超过上限
- **WHEN** 由于历史数据，已启用 Skill 数量超过 24 个
- **THEN** 轮盘只渲染前 24 个，其余 Skill 仍可被调用与管理，系统不报错

#### Scenario: Pet 不提供任何内置 Skill
- **WHEN** 用户首次安装 Pet 并打开 Skills 页
- **THEN** 列表为空，且不存在可供"启用内置 Skill"的入口

#### Scenario: 修改已注册目录立即生效
- **WHEN** 用户编辑某个已注册 Skill 的源目录内容
- **THEN** 下一次调用即读到新内容，无需重新导入

### Requirement: Pet 能力以 Agent Skill 驱动并以有界工具完成副作用

Pet 能力 SHALL 全部由**普通 DSH Skill** 提供：Skill 在仓库 `skills/` 下维护、随
sync 部署到 `~/.dsh/skills/`，可在任意普通 DSH 会话中独立使用，并由用户在 Pet
Settings 中显式导入、启用后成为 Pet 能力。Pet MUST NOT 自动 seed 或隐式启用任何
Skill。

系统 MUST NOT 提供任何让 Skill 为 Pet 适配的机制。Skill 的 `SKILL.md` MUST NOT 被
读取任何 Pet 专属字段，Pet MUST NOT 定义、解析或消费此类声明——不存在"为 Pet 优化
过的 Skill"与"普通 Skill"之分，因此也不存在两等 Skill。Pet 呈现一项能力时 SHALL
只使用普通 Skill 已有的信息（名称与 description）。

一期 SHALL 以两项能力验证该形态：`ws`（既有，Worktree Session 维护）与 `send-cr`
（新增）。Create MR 不属于一期范围。

Pet SHALL 允许 Agent 参与现场检查、信息补全、结果生成和用户澄清，但清理 worktree、
发送外部消息等副作用 SHALL 通过确定性、有界且可审计的工具或现有安全门禁执行。

Pet MUST NOT 代替 Skill 判断其执行前提。需要特定来源、配置或外部依赖的 Skill
SHALL 自行在执行开始时校验（在 Pet 中运行时经 `pet_context` 获取可信快照），并在
不满足时停止并说明缺失项。Pet MUST NOT 让模型通过自由文本自行替换 source 路径、
清理目标、飞书群或 reviewer 绑定。

#### Scenario: 任何普通 Skill 都能被同等消费
- **WHEN** 用户导入任意一个普通 DSH Skill（例如既有的 `ws`）
- **THEN** 它正常成为 Pet 能力，标签为 Skill 名、描述取自其 description，且无需
      为此修改该 Skill 的任何内容

#### Scenario: Clean Worktree 遇到不安全状态
- **WHEN** source worktree 尚有未提交修改或无法证明满足清理门禁
- **THEN** Skill 与确定性工具停止清理并返回可操作说明，不绕过既有安全检查

#### Scenario: Skill 自行发现来源不满足
- **WHEN** 用户从没有 source session 的页面调用一个需要 session 的 Skill
- **THEN** Pet 正常创建 Invocation 并派发，Skill 经 `pet_context` 发现来源不满足后
      停止并说明原因，而不是由 Pet 提前拦截

#### Scenario: Send CR 缺少可信群配置
- **WHEN** source workspace 没有配置可用的 CR 目标群且用户未明确给出
- **THEN** Skill 不向任意群发送消息，停止并说明缺失项与配置位置

#### Scenario: 能力不被自动启用
- **WHEN** Pet 首次启动且用户尚未导入任何 Skill
- **THEN** 能力列表为空，用户需显式导入并启用后能力才出现

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
- **Skills**：Skill 列表、本地目录导入、已安装版本、启用/禁用、快捷能力可见性、升级/卸载和 Workspace 投影同步状态；
- **环境变量**：按全局与来源 workspace 两个作用域配置的键值，经官方 `ctx.shellEnv` 以 `DSH_PET_*` 注入 Pet executor 的每次 shell 调用；
- **Diagnostics**：Host 生命周期、状态/Workspace/Skill store 与投影路径、版本摘要、同步漂移、依赖可用性以及显式修复/重建投影操作。

环境变量页签 SHALL 提供全局与 workspace 两个作用域的编辑入口：全局配置对所有 Pet
Task 生效，workspace 配置只对该来源生效并**覆盖**同名的全局配置；两者都没有时该
变量不存在，由 Skill 自行发现并停止。workspace 作用域允许从 Host 已知 workspace
选择，也允许手工输入尚未列出的 workspace id。页面 SHALL 显示每个 key 实际注入的
变量名，使用户知道在 Skill 中如何引用。系统 MUST NOT 为此引入自定义模板语法：
Skill 侧就是普通的 `$DSH_PET_<KEY>` 环境变量引用。

Pet 浮层与 Task 面板 SHALL 只提供快捷能力执行、调用前来源确认以及 Task/Invocation 的日常操作；它们 MUST NOT 承担 Skill 安装、版本管理、环境变量编辑或完整诊断配置。浮层 SHALL 提供进入相应 Settings 页签的明确入口。

Pet SHALL 显示 provider/model 可用性，但 MUST NOT 读取、回传或保存 subscription token 和其它 provider credentials。环境变量页保存的值 MUST NOT 被当作凭据保管机制，页面 SHALL 提示其会进入子进程环境。配置写入失败 SHALL 保留用户输入并显示错误；需要重启才生效的配置 SHALL 明确提示。敏感 channel 字段在未来加入时 SHALL 以 secret reference 或等价受保护机制保存，管理读取不得回显明文。

#### Scenario: 打开 Pet 设置
- **WHEN** 用户从 Pet 浮层或 DSH Settings 打开 Pet 配置
- **THEN** 用户看到 General、Skills、环境变量、Diagnostics 四个稳定页签，并能在 Skills 页完成安装、启用和投影诊断而无需进入 Task 执行面板

#### Scenario: Skill 投影发生漂移
- **WHEN** Diagnostics 检测到已启用 allowlist 与 Workspace `.dsh/skills` 投影摘要不一致
- **THEN** Pet 显示具体漂移项且停止把不一致 Skill 用于新 Invocation，用户可执行显式重建投影

#### Scenario: 选择已注册模型
- **WHEN** 用户在 Pet 设置中选择当前 DSH Host 可路由的 provider/model
- **THEN** 后续新 Pet executor session 使用该选择，Pet 配置中不出现 provider token

#### Scenario: 选择不可用模型
- **WHEN** 已配置 provider/model 在当前 Host 不可路由
- **THEN** Pet 在启动 Invocation 前显示可诊断配置错误，不静默回退到另一个可能产生不同副作用的模型

#### Scenario: 配置 CR 目标群
- **WHEN** 用户在环境变量页为某 workspace 保存 `CR_GROUP`
- **THEN** 页面显示其引用形式 `$DSH_PET_CR_GROUP`，该 workspace 来源的后续 shell 调用可读到该值

#### Scenario: 全局配置对所有 Task 生效
- **WHEN** 用户在环境变量页的全局作用域保存 `CR_GROUP`，且某来源 workspace 未配置该 key
- **THEN** 该来源的 shell 调用读到全局值；若该 workspace 另配了同名 key，则读到 workspace 值

#### Scenario: 保存无效配置
- **WHEN** 用户提交不合法的 key 或空 value
- **THEN** 系统拒绝写入、保留表单输入并指出无效字段

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

