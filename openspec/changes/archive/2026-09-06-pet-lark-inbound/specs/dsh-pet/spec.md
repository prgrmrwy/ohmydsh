# dsh-pet 规范增量：飞书入站通道

本增量以 `openspec/specs/dsh-pet/spec.md` 现行内容为基准。channel 自身行为见新能力
`pet-lark-channel`；本文件只修订 dsh-pet 既有 Requirement 中受影响的部分。
既有「同一 Pet Task 的 Invocations 严格串行」Requirement 的队列语义原文适用于
channel 触发，不在本增量修改。

## MODIFIED Requirements

### Requirement: 每个来源 scope 至多有一个活跃 Pet Task

系统 SHALL 将 Pet Task 建模为一个长期工作线程。对相同来源 scope，系统 SHALL 复用唯一未归档 Pet Task 及其固定 executor DSH session，并把多次能力调用追加为不同 Pet Invocations；系统 MUST NOT 因每次调用 Skill 而创建新的 Task 或 executor session。

Pet Task 归档后 MUST NOT 再接收新 Invocation。用户在同一来源 scope 再次使用 Pet 时，系统 SHALL 创建新的 Task epoch 和新的 executor session，并保留旧 Task 的历史。

来源 scope SHALL 至少支持：指定 DSH session、指定 DSH workspace、无关联的独立 scope，以及外部 channel 会话（如飞书 chat）。不同 scope 的 Task MUST NOT 被错误复用；两个不同 channel 会话即使路由到同一 workspace 也属于不同 scope。

#### Scenario: 在同一 source session 多次调用能力
- **WHEN** 用户在同一 DSH source session 依次调用 Create MR、Send CR 和 Clean Worktree，且其 Pet Task 未归档
- **THEN** 系统创建一个 Pet Task 和一个 executor DSH session，并在其中按顺序追加三个独立 Invocation

#### Scenario: 归档后再次调用
- **WHEN** 用户归档某 source session 的活跃 Pet Task 后再次从该 source session 调用能力
- **THEN** 系统创建新的 Task epoch 和 executor session，旧 Task 保持只读历史且不被复活

#### Scenario: 不同来源分别调用 Pet
- **WHEN** 两个不同 DSH sessions 各自调用 Pet
- **THEN** 系统为两个 source scope 分别维护活跃 Pet Task，不共享 executor session 或当前 Invocation

#### Scenario: channel 会话构成独立 scope
- **WHEN** 一个飞书群与一个本机浮层 workspace 来源分别触发同一 workspace 上的工作
- **THEN** 两者各自维护独立的活跃 Pet Task，互不复用 executor session

### Requirement: Pet Task 使用专用 Workspace 中的普通 DSH executor session

系统 SHALL 确保存在一个标题可识别的 `DSH Pet` Workspace，其路径位于 Pet 持久状态目录而非插件安装目录。浮层触发的 Pet Task SHALL 固定关联该 Workspace 下的一个普通 DSH root session，并复用同一 DSH Host 已装配的 Agent Loop、Skills、Tools、交互能力和 LLM provider；executor session SHALL 在原生 DSH 列表中可见并可打开。

系统 SHALL 另支持 workspace-resident Task 形态：executor session 是路由目标 workspace 下的普通 DSH root session，其工作目录即该 workspace，且 SHALL 被登记到该目标 workspace（而非 Pet Workspace），使其在原生会话列表中归属于对应项目而不是显示为未分类。此形态 SHALL 仅由用户显式建立或显式可改的 channel 路由触发，信任来源是该显式路由加发送者 allowlist。

此形态下 Pet MUST NOT 承诺 Pet Skill allowlist 投影与 standing instructions 边界——目标 workspace 自身的 Skill 目录与 Agent 指令生效。为与该承诺一致，系统 MUST NOT 为此形态施加 Pet 专用 executor preset，也 MUST NOT 安装 Pet 的 allowlist Skill provider：两者的作用都是把 Skill 面收窄为 Pet 的清单，与「使用目标 workspace 自身能力」直接矛盾。此形态 SHALL 显式使用 DSH 的 `standard` preset——而非省略 preset：未指定的 preset 不会记录在会话头上，会使该会话在原生界面中显示不出任何模式。Pet MUST NOT 向目标 workspace 仓库写入任何投影、指令或状态文件。

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

#### Scenario: channel 触发创建 workspace-resident executor
- **WHEN** 飞书触发经路由命中 nexus workspace 且该 chat 无活跃 Task
- **THEN** 系统在 nexus workspace 创建普通 executor session，该 session 使用 nexus 自身的 Skill 与 Agent 指令，Pet 不向 nexus 仓库写入任何文件

#### Scenario: workspace-resident 不伪造投影边界
- **WHEN** 用户在 Diagnostics 查看一个 workspace-resident Task
- **THEN** 系统如实展示其形态与信任来源（显式路由 + allowlist），不显示 Pet Skill 投影对其生效

#### Scenario: resident session 归属目标项目
- **WHEN** 飞书触发在 nexus workspace 创建 executor session
- **THEN** 该 session 在原生会话列表中归属 nexus，而非归属 Pet Workspace 或显示为未分类

#### Scenario: resident 形态使用 workspace 自身能力
- **WHEN** 系统为 resident Task 创建 executor
- **THEN** 使用 `standard` preset、不安装 Pet allowlist Skill provider，
      executor 可用的 Skill 由其所在 workspace 决定，且该会话在原生界面显示为标准模式

### Requirement: Pet 设置采用固定的页签信息架构且不接触 provider 凭据

系统 SHALL 在 DSH Settings 注册独立 Pet section，并固定包含以下五个页签：

- **General**：Pet 外观/位置重置、默认 Agent composition、provider/model、新 Task 使用的默认上下文策略；
- **Skills**：Skill 列表、本地目录导入、已安装版本、启用/禁用、快捷能力可见性、升级/卸载和 Workspace 投影同步状态；
- **环境变量**：按全局与来源 workspace 两个作用域配置的键值，经官方 `ctx.shellEnv` 以 `DSH_PET_*` 注入 Pet executor 的每次 shell 调用；
- **Channel**：bot 绑定入口（创建新 Bot / 连接已有 Bot）与已绑定身份摘要、channel 启用开关、发送者 allowlist、default workspace、chat 到 workspace 的绑定列表（含自动写回的绑定行）与改绑/删除操作；
- **Diagnostics**：Host 生命周期、状态/Workspace/Skill store 与投影路径、版本摘要、同步漂移、依赖可用性、channel 连接状态与队列深度，以及显式修复/重建投影/重连操作。

环境变量页签 SHALL 提供全局与 workspace 两个作用域的编辑入口：全局配置对所有 Pet
Task 生效，workspace 配置只对该来源生效并**覆盖**同名的全局配置；两者都没有时该
变量不存在，由 Skill 自行发现并停止。workspace 作用域允许从 Host 已知 workspace
选择，也允许手工输入尚未列出的 workspace id。页面 SHALL 显示每个 key 实际注入的
变量名，使用户知道在 Skill 中如何引用。系统 MUST NOT 为此引入自定义模板语法：
Skill 侧就是普通的 `$DSH_PET_<KEY>` 环境变量引用。

Pet 浮层与 Task 面板 SHALL 只提供快捷能力执行、调用前来源确认以及 Task/Invocation 的日常操作；它们 MUST NOT 承担 Skill 安装、版本管理、环境变量编辑、channel 配置或完整诊断配置。浮层 SHALL 提供进入相应 Settings 页签的明确入口。

channel 尚未绑定 bot 时，浮层的提示区 SHALL 显示一条通向 Channel 页签的引导，且该
引导 SHALL 可被用户永久关闭——channel 是可选增强，不使用它的用户 MUST NOT 被长期
提示。关闭该引导 MUST NOT 影响 Channel 页签本身的可用性：绑定入口 SHALL 始终可从
Settings 到达。提示区同时具备多条引导资格时 SHALL 只显示一条，且 Skill 引导优先于
channel 引导——没有任何能力的 Pet 首先需要的是 Skill。

#### Scenario: 已配置 Skill 但未绑定 Bot
- **WHEN** 用户已启用至少一个 Skill 且尚未绑定飞书 bot，展开轮盘
- **THEN** 提示区显示通向 Channel 页签的绑定引导

#### Scenario: 既无 Skill 也未绑定 Bot
- **WHEN** 全新安装的 Pet 展开轮盘
- **THEN** 提示区只显示添加 Skill 的引导，不同时显示 channel 引导

#### Scenario: 关闭 channel 引导后仍可绑定
- **WHEN** 用户关闭浮层的 channel 引导，随后改变主意想绑定 bot
- **THEN** 浮层不再显示该引导，Settings 的 Channel 页签仍提供完整绑定入口

#### Scenario: 绑定完成后引导消失
- **WHEN** 用户完成 bot 绑定
- **THEN** 浮层不再显示 channel 引导，无需用户手动关闭

Pet SHALL 显示 provider/model 可用性，但 MUST NOT 读取、回传或保存 subscription token 和其它 provider credentials。环境变量页保存的值 MUST NOT 被当作凭据保管机制，页面 SHALL 提示其会进入子进程环境。Channel 页 MUST NOT 展示或保存任何飞书凭据。配置写入失败 SHALL 保留用户输入并显示错误；需要重启才生效的配置 SHALL 明确提示。敏感 channel 字段在未来加入时 SHALL 以 secret reference 或等价受保护机制保存，管理读取不得回显明文。

#### Scenario: 打开 Pet 设置
- **WHEN** 用户从 Pet 浮层或 DSH Settings 打开 Pet 配置
- **THEN** 用户看到 General、Skills、环境变量、Channel、Diagnostics 五个稳定页签，并能在 Skills 页完成安装、启用和投影诊断而无需进入 Task 执行面板

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

#### Scenario: 在 Channel 页改绑一个群
- **WHEN** 用户把一个此前自动绑定到 default workspace 的群改绑到另一个已注册 workspace
- **THEN** 后续该群的触发路由到新 workspace，改绑行标记为用户显式绑定

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

系统 SHALL 另支持**对话式 Invocation**：由入站 channel 消息发起、不绑定任何 Skill
的调用。此类 Invocation MUST NOT 固定 skill 名称、来源路径或 skill-set 代际，其
envelope MUST NOT 发出 `/<skill-name>` 前导令牌，派发前的 Skill 校验 SHALL 因无可
校验对象而跳过。这 MUST NOT 被解读为放宽 Skill 边界：对话式 Invocation 不引用任何
Skill，因此不存在被绕过的授权检查；executor 可用的 Skill 面仍由其所在 workspace
决定（workspace-resident 形态下即该 workspace 自身的 Skill）。

Pet MUST NOT 为对话式 Invocation 自带、声明或隐式创建"内置 Skill"或伪能力来充当
占位；无 Skill 就是无 Skill。

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

#### Scenario: 飞书消息发起对话式 Invocation
- **WHEN** allowlist 用户在已绑定的会话中触发一次分析请求
- **THEN** Pet 创建不绑定 Skill 的 Invocation，其 envelope 不含 `/<skill-name>`
      令牌，派发不因缺少 Skill 而失败

#### Scenario: 对话式 Invocation 不产生占位能力
- **WHEN** 用户在 Pet 设置的 Skills 页查看能力列表，且已发生过 channel 触发
- **THEN** 列表中不出现任何 Pet 自带的对话或占位能力条目

### Requirement: 由 ohmydsh 管理部署且保持 Cockpit 与跨设备边界

本仓 SHALL 在 `packages/dsh-pet/` 保存插件源码，并以 `dsh.yaml` 中一个可逆的 local package customization 作为本机 profile 安装、启用和禁用的唯一真相源。sync/build SHALL 幂等物化该插件且不得把 Pet runtime database、Skill store、Workspace、生成 profile 或 package `lib/` 当作应提交源码。插件包本身 SHALL 保持可独立安装，运行时 MUST NOT 依赖 ohmydsh 脚本。

Pet SHALL 仅在其所在 DSH 设备内创建 Task 和 executor session，不修改 dsh-cockpit 仓，不新增 Cockpit 对 DSH 的写代理，不修改 `dsh-cockpit-bridge` 只上报 active session ID 的契约，也不实现同 bot 多设备竞争或 Cockpit Pet Hub。飞书入站 transport SHALL 按 `pet-lark-channel` 规范经本机 lark-cli 提供，MUST NOT 引入 lark-agent-bridge 或其它外部 bridge 运行时依赖。跨设备 Pet 聚合、设备路由、共享 Bot 或 Pet Hub SHALL 在需求出现时由 dsh-cockpit 的独立 change 负责。

系统的持久模型 SHALL 为 channel 触发的 Invocation 保存可信 Channel Binding（chat、触发消息、发送者、表情标识）。外部回复能力 MUST 根据调用 executor session 和当前 Invocation 解析绑定目标，MUST NOT 接受模型生成的任意 chat/thread/user ID；本 change 内唯一的外部文字出站是 Host 侧单聊自动回复，模型主动回复工具由后续 change 承接。

#### Scenario: ohmydsh 重复物化 Pet customization
- **WHEN** 用户在相同 manifest 和源码下连续运行两次 sync/build
- **THEN** 第二次运行不产生配置或安装漂移，Pet runtime 状态保持在 `$DSH_HOME/plugins/dsh-pet/` 且不回写仓库

#### Scenario: Cockpit 承载安装 Pet 的设备
- **WHEN** 用户通过 Cockpit iframe 使用已安装 Pet 的设备
- **THEN** Pet 在该设备原生 DSH 页面内运行，Cockpit 仍不代理 Pet executor RPC、settings 或 provider credentials

#### Scenario: 模型请求任意外部回复目标
- **WHEN** Agent 在 executor session 中试图以自由文本指定一个 chat/thread/user ID 要求回复
- **THEN** 系统不存在接受该标识的通道，任何出站回复目标只能来自当前 Invocation 持久化的 Channel Binding
