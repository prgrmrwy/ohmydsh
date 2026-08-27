## Purpose

在本机 DSH Web GUI 中提供完整的多节点 Workspace/Session 控制体验，增加 Node 层但不牺牲官方浏览器的核心交互、本机扩展能力和无障碍质量。

## ADDED Requirements

### Requirement: 统一 GUI 同时呈现 Node → Workspace → Session
系统 SHALL 在中央 DSH 的 Workspace 浏览区同时展示 This Mac 与所有已登记节点，并在每个 Node 下展示真实 Workspace、Ungrouped 和 Session。系统 SHALL 同步接管空白会话的 Workspace Picker，使所有新建入口使用同一节点/Workspace 模型；右侧 conversation、composer、模型选择、工具卡片、审批和提问 SHALL 继续使用官方组件。

#### Scenario: 跨节点原地切换会话
- **WHEN** 用户依次打开本机、VM 和 devbox 的 session
- **THEN** 右侧官方会话区显示各自历史和实时状态，左侧当前选中项始终包含正确 Node/Workspace 上下文

#### Scenario: 空白页面选择远端 Workspace
- **WHEN** 当前没有 session 且用户从 Hero Workspace Picker 选择远端 workspace
- **THEN** 系统在对应远端 Host 创建或复用 blank session，而不是把远端路径当成本机 workspace

### Requirement: 联邦侧栏保持官方 rc.2 核心行为等价
系统 SHALL 保留官方 WorkspaceBrowser 的 grouped/flat 视图、展开状态、每 workspace 默认五条和展开其余、manual/last-updated 排序、prompt/steer 置顶、Workspace/Session 操作、blank session 特殊行、hover/copy、搜索、状态点、subagent 过滤与后代活动、新完成未查看、响应式轨道、键盘、ARIA 和 reduced-motion 行为。新增 Node 层不得使 This Mac 的日常核心能力退化。

#### Scenario: Blank session 行保持特殊行为
- **WHEN** 一个 session 尚未发送首条消息
- **THEN** 其行不显示时间或 rename/fork/archive 菜单，且 New Session 流优先复用所属 workspace 的既有 blank session

#### Scenario: 状态优先级保持一致
- **WHEN** session 同时存在待回答交互、运行状态和 subagent 后代活动
- **THEN** 待处理交互优先作为主状态，后代活动仍保留独立可访问提示，不因 Node 层丢失

### Requirement: 拖拽和排序不得改变节点或 Workspace 归属
系统 SHALL 允许 Node 在中央列表内排序、Workspace 在同 Node 内排序、Session 在同 Node 且同 Workspace 内排序。Ungrouped 和 flat 列表排序 SHALL 仅保存为浏览器视图顺序。跨 Node Workspace 拖拽、跨 Workspace Session 拖拽和跨 Node Session 拖拽 MUST 被拒绝，拒绝目标不得显示可接受 marker 或发送 RPC。

#### Scenario: 同节点 Workspace 排序
- **WHEN** 用户把一个 workspace 拖到同 Node 另一 workspace 之前
- **THEN** 系统调用该 Node 的 workspace reorder，其他 Node 顺序和归属不变

#### Scenario: Session 拖向另一 Node
- **WHEN** 用户把 session 拖向不同 Node 的 workspace
- **THEN** UI 显示不可放置且不发送任何移动、复制、cwd 改写或重排请求

### Requirement: 搜索跨节点聚合且容忍部分失败
系统 SHALL 支持标题、Workspace 和会话内容搜索，保留查询清理、250ms 防抖、取消前序请求、结果上限和过宽提示。搜索可并行查询已连接节点，结果 MUST 显示 Node/Workspace 上下文；单节点失败不得清除其他节点的元数据或内容结果。

#### Scenario: 一个节点搜索失败
- **WHEN** 全局搜索期间 VM A 超时而 This Mac 与 VM B 成功
- **THEN** UI 展示成功节点结果并标注 VM A 警告，不把整个搜索判为失败

#### Scenario: 打开搜索结果
- **WHEN** 用户打开一个远端搜索结果
- **THEN** 系统打开其联合 session，不清空现有查询，也不把同名本机 session 误选中

### Requirement: 每个节点独立展示目录和连接状态
系统 SHALL 为 Node 行显示连接、degraded、incompatible、offline 等状态，并可聚合运行和待回答数量。节点折叠不得抹去其真实状态；一个节点离线时其他节点和本机操作 SHALL 保持可用。

#### Scenario: 折叠节点有等待回答
- **WHEN** 一个折叠的远端 Node 内存在等待审批或问题的 session
- **THEN** Node 行显示可访问的聚合提示，使用户无需先展开即可发现待处理工作

#### Scenario: 节点离线
- **WHEN** 某远端节点断线
- **THEN** 该节点保留带 stale/offline 标记的树骨架并禁用写操作，其他节点仍可正常使用

### Requirement: This Mac 扩展能力完整保留，远端按能力显示
系统 SHALL 保留 This Mac 已启用的 provider logo、Workspace row-menu、归档管理和 worktree-session 等扩展能力。远端扩展操作只有在节点能力探测确认对应协议时才显示；本机路径动作 MUST NOT 作用于远端。联邦侧栏 SHALL 声明可组合的 Workspace row-menu seam，使现有扩展无需依赖 DOM 猜测。

#### Scenario: 本机 Open in VSCode
- **WHEN** 用户打开 This Mac workspace 的菜单
- **THEN** 现有 Open in VSCode 动作仍可用并只接收本机路径

#### Scenario: 远端缺少扩展插件
- **WHEN** 远端节点没有 unarchive、worktree 或 editor-open 扩展能力
- **THEN** 中央隐藏对应操作，核心远端 workspace/session 控制仍然可用

### Requirement: 远端 Workspace 使用节点绑定的应用内目录选择
系统 SHALL 在远端添加 Workspace 时展示应用内目录浏览器，支持层级浏览、路径输入、隐藏目录开关和创建单级子目录，并把全部操作绑定到所选 Node。This Mac SHALL 保持其 Host 报告的 native/browse 选择能力。

#### Scenario: 远端浏览目录
- **WHEN** 用户从远端 Node 的添加 Workspace 入口打开选择器
- **THEN** 列表和创建目录请求仅发送到该 Node，面包屑和显示根反映远端文件系统

#### Scenario: 远端目录浏览失败
- **WHEN** 目标目录不可读或节点在选择期间断线
- **THEN** 错误留在可重试选择界面，系统不创建半成品 workspace，也不回退浏览本机目录
