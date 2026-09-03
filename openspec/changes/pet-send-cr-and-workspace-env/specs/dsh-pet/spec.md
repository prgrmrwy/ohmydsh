## MODIFIED Requirements

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
