# dsh-pet Specification (Delta)

## MODIFIED Requirements

### Requirement: Web 中提供常驻、可拖动且可访问的 Pet 入口

系统 SHALL 在 DSH 页面提供不替换原生工作台的**视口级**浮动 Pet。Pet SHALL 在普通会话、无会话 Hero 和 Settings 等页面状态间保持可用，允许用户拖动位置，并在页面重载后恢复已保存的位置。Pet 的位置 SHALL 以视口为坐标系，MUST NOT 因应用外壳的布局变化（侧栏、工作台、详情列的展开收起或调宽）而被移动或裁剪。Pet MUST NOT 默认遮挡底层页面交互；其可交互表面 SHALL 明确接管指针和键盘操作，而未绘制区域 MUST NOT 拦截指针事件。

快捷能力 SHALL 呈现为以 Pet 本体为圆心的同心圆环轮盘。轮盘 SHALL 由内向外填充，每圈填满后才启用下一圈，最多三圈，容量依次为 6、8、10，合计上限 24 个能力；超出上限的能力 MUST NOT 渲染，且 MUST NOT 因此报错或阻断其余能力。

轮盘条目 SHALL 支持两类来源：用户导入并启用的 Pet Skill（既有），以及 Host 内置
动作（如 Q&A）。内置动作 MUST NOT 进入 Skill 安装/启用清单模型，MUST NOT 产生
`/<skill-name>` envelope，其可用性由 Host 按各自依赖探测计算；不可用时 SHALL
以禁用态呈现并展示原因。内置动作与 Skill 能力共同计入轮盘容量。

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

#### Scenario: 内置动作与 Skill 能力并列呈现
- **WHEN** 用户在会话来源下展开轮盘，且 Q&A 动作依赖探测通过
- **THEN** Q&A 与已启用 Skill 能力并列出现在轮盘上，点击后执行 Host 内置流程而非派发 Skill

#### Scenario: 内置动作依赖不可用
- **WHEN** 宿主缺少 Q&A 动作所需依赖（如 fork provider 或 channel 未绑定）
- **THEN** 该动作以禁用态呈现并可感知原因，其余轮盘条目不受影响

### Requirement: 每个来源 scope 至多有一个活跃 Pet Task

系统 SHALL 将 Pet Task 建模为一个长期工作线程。对相同来源 scope，系统 SHALL 复用唯一未归档 Pet Task 及其固定 executor DSH session，并把多次能力调用追加为不同 Pet Invocations；系统 MUST NOT 因每次调用 Skill 而创建新的 Task 或 executor session。

Pet Task 归档后 MUST NOT 再接收新 Invocation。用户在同一来源 scope 再次使用 Pet 时，系统 SHALL 创建新的 Task epoch 和新的 executor session，并保留旧 Task 的历史。

来源 scope SHALL 至少支持：指定 DSH session、指定 DSH workspace、无关联的独立 scope、外部 channel 会话（如飞书 chat），以及 qa 答疑群会话。不同 scope 的 Task MUST NOT 被错误复用；两个不同 channel 会话即使路由到同一 workspace 也属于不同 scope。每个 qa 答疑群 SHALL 对应至多一个活跃 Task，其固定"executor"即该群绑定的 fork child 会话；qa Task 归档 SHALL 使对应 qa 绑定失效，MUST NOT 销毁 child 会话历史。

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

#### Scenario: qa 群与源会话的浮层 Task 相互独立
- **WHEN** 用户在源会话上既有浮层触发的活跃 Task，又通过 Q&A 建立了答疑群
- **THEN** 浮层 Task 与 qa Task 各自独立存在，qa 群消息只进入 child，不影响浮层 Task 的 executor

#### Scenario: 归档 qa Task
- **WHEN** 用户在面板归档一个 qa Task
- **THEN** 对应 qa 绑定失效、群消息不再触发工作，child 会话及其历史保留可查

### Requirement: Pet Task 使用专用 Workspace 中的普通 DSH executor session

系统 SHALL 确保存在一个标题可识别的 `DSH Pet` Workspace，其路径位于 Pet 持久状态目录而非插件安装目录。浮层触发的 Pet Task SHALL 固定关联该 Workspace 下的一个普通 DSH root session，并复用同一 DSH Host 已装配的 Agent Loop、Skills、Tools、交互能力和 LLM provider；executor session SHALL 在原生 DSH 列表中可见并可打开。

系统 SHALL 另支持 workspace-resident Task 形态：executor session 是路由目标 workspace 下的普通 DSH root session，其工作目录即该 workspace，且 SHALL 被登记到该目标 workspace（而非 Pet Workspace），使其在原生会话列表中归属于对应项目而不是显示为未分类。此形态 SHALL 仅由用户显式建立或显式可改的 channel 路由触发，信任来源是该显式路由加发送者 allowlist。

此形态下 Pet MUST NOT 承诺 Pet Skill allowlist 投影与 standing instructions 边界——目标 workspace 自身的 Skill 目录与 Agent 指令生效。为与该承诺一致，系统 MUST NOT 为此形态施加 Pet 专用 executor preset，也 MUST NOT 安装 Pet 的 allowlist Skill provider：两者的作用都是把 Skill 面收窄为 Pet 的清单，与「使用目标 workspace 自身能力」直接矛盾。此形态 SHALL 显式使用 DSH 的 `standard` preset——而非省略 preset：未指定的 preset 不会记录在会话头上，会使该会话在原生界面中显示不出任何模式。Pet MUST NOT 向目标 workspace 仓库写入任何投影、指令或状态文件。

系统 SHALL 再支持 qa-child Task 形态：其"executor"是源会话的 fork continuable
子代理会话，由 DSH 子代理机制组合与驱动。此形态下 Pet MUST NOT 自建 root
session、MUST NOT 施加任何 preset、MUST NOT 安装 Pet allowlist Skill provider
——child 的组合与工具面继承自源会话。信任来源是「本人显式创建答疑群 + 本人亲手
拉人入群」；Pet MUST NOT 承诺任何 Pet Skill 边界对 child 生效。child SHALL 收纳
在源会话名下的原生子代理列表中，MUST NOT 作为独立 root session 出现在会话列表。

创建 executor session 后，系统 SHALL 按 Pet 配置选择 Pet Agent composition 与模型。当前 Web profile 已注册的 subscription provider SHALL 可被 Pet executor session 正常选择，Pet MUST NOT 读取、复制或另行保存 provider token。模型或 Pet composition 不可用时 SHALL 让 Task 进入可诊断失败/等待配置状态，不得创建伪成功结果。qa-child 形态的模型选择 SHALL 继承自源会话（fork 快照），不适用 Pet 配置的模型选择。

#### Scenario: 首次为 source scope 启动 Task
- **WHEN** 用户首次从某 source scope 调用 Pet 能力
- **THEN** 系统在 `DSH Pet` Workspace 创建一个普通 executor session、保存双向关联并将 Invocation 投递给该 session

#### Scenario: 打开完整执行过程
- **WHEN** 用户从 Pet Task 面板点击"打开完整过程"
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

#### Scenario: qa-child 形态继承源会话组合
- **WHEN** Q&A 动作对源会话 fork 出 child 并有群成员触发工作
- **THEN** child 以源会话的组合与工具面执行，Pet 不为其装配 preset 或 allowlist provider

#### Scenario: qa-child 不出现在 root 会话列表
- **WHEN** 用户查看源会话所在 workspace 的会话列表
- **THEN** qa child 收纳于源会话名下的子代理折叠列表，不作为独立 root 会话出现
