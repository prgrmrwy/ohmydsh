## Purpose

为 DSH 首页空白会话提供 Claude 式 start-in-worktree 启动契约，使首条任务只在独立 task branch、worktree、依赖状态与开发构建环境准备完成后才创建目标 Session 并启动 Agent。

## ADDED Requirements

### Requirement: 首页空白会话提供 Worktree 启动选择

当当前 Session 为空白且 cwd 位于受支持的 Git 仓库中时，系统 SHALL 在首页输入框工具行显示 base ref 选择器与默认关闭的 `Worktree` 开关；选择 base 或切换开关 SHALL 仅暂存启动意图，不得立即创建 worktree、切换当前 checkout 分支或创建目标 Session。系统不得为此能力修改侧边栏“新建会话”入口。

#### Scenario: 空白 Git 会话显示启动选择
- **WHEN** 用户打开 cwd 位于受支持 Git 仓库中的空白 Session
- **THEN** 首页输入框工具行显示当前 base 与 `Worktree` 开关，且开关默认关闭

#### Scenario: 选择 base 无 Git 副作用
- **WHEN** 用户选择另一 local 或 remote base ref 但尚未发送首条消息
- **THEN** 系统仅更新待用 base，当前 checkout、Git worktree 列表和 Session 列表均不改变

#### Scenario: 非 Git 或非空白会话不提供启动选择
- **WHEN** 当前 cwd 不在受支持 Git 仓库中，或当前 Session 已产生持久化消息
- **THEN** 系统不提供可启动新 Worktree Session 的开关

#### Scenario: 侧边栏入口保持原状
- **WHEN** 用户使用侧边栏的新建会话入口
- **THEN** 该入口继续遵循 DSH 原有行为，不增加 WS 专属步骤或弹窗

### Requirement: 未启用 Worktree 时保持官方发送行为

当 `Worktree` 未启用时，系统 SHALL 不接管输入提交、Workspace 选择或 Session 创建，首条及后续消息均由 DSH 官方输入路径处理。

#### Scenario: 普通首次发送
- **WHEN** 用户未启用 `Worktree` 并发送首条消息
- **THEN** 消息在当前 Session 与当前 cwd 中按 DSH 官方行为提交，系统不创建 task branch 或 worktree

### Requirement: 首次发送原子启动目标 Worktree Session

当 `Worktree` 已启用且用户发送首条任务时，系统 SHALL 拦截原 Session 的默认提交，并依次完成 task branch/worktree 创建、仓库初始化、DSH Workspace 注册、以 worktree 为 cwd 的目标空白 Session 创建、首条输入迁移和目标 Session 提交。目标 Agent 的第一轮 SHALL 发生在初始化完成之后；系统不得要求用户提前创建、再次确认或再次发送。

#### Scenario: 成功启动
- **WHEN** 用户选择 `main` 为 base、启用 `Worktree` 并发送一条受支持的首条任务
- **THEN** 系统创建独立 task branch/worktree，完成初始化，以该 worktree 为 cwd 创建目标 Session，并将该任务作为目标 Session 的第一条消息提交

#### Scenario: 原 Session 不执行任务
- **WHEN** Worktree Session 启动成功
- **THEN** 原空白 Session 不持久化该首条消息、不启动 Agent turn，任务只在目标 Session 执行

#### Scenario: 无额外交互
- **WHEN** 用户已经选择 base、启用 `Worktree` 并点击发送
- **THEN** 系统直接执行启动事务，不再要求创建确认、Workspace 手动选择或第二次发送

### Requirement: 每次启动创建独立 task branch 且不扰动主 checkout

系统 SHALL 把用户选择的 ref 解释为新任务的 base，而非需要原地检出的目标分支；每次新启动 SHALL 分配唯一的 `ws/` task branch 与 worktree 路径，并通过 `git worktree add -b` 等价语义从 base 创建。系统不得对主 checkout 执行 `git switch`、`checkout` 或 `reset`。

#### Scenario: 同一 base 并行启动
- **WHEN** 用户两次从 `main` 启动不同 Worktree Session
- **THEN** 两次启动获得不同的 `ws/` task branch 和不同 worktree，且主 checkout 仍停留在原分支与原 HEAD

#### Scenario: 名称冲突
- **WHEN** 推导出的 task branch 或 worktree 路径已被另一任务占用
- **THEN** 系统分配不冲突的稳定后缀，不得复用未证明属于同一启动操作的目录或分支

#### Scenario: remote base
- **WHEN** 用户选择一个本地可解析的 remote ref 作为 base
- **THEN** 新 task branch 从该 ref 的当前提交创建，主 checkout 不切换到该 remote ref

### Requirement: 当前仓库采用可验证的 lean 依赖初始化

首版系统 SHALL 为 mydsh 的新 worktree 建立 `lean` 依赖状态：按 `package-lock.json` 指纹复用只属于相同指纹的共享 npm 安装结果，并将 worktree 的 `node_modules` 指向该结果。初始化 SHALL 校验 lockfile 指纹和安装健康状态；不匹配或不健康的结果不得被复用。系统 SHALL 明确暴露 `lean` 状态，并要求在执行会改变安装结果的 npm 操作前先提升为 `mutable`。

#### Scenario: 相同 lockfile 复用依赖
- **WHEN** 新 worktree 的 `package-lock.json` 指纹已有健康的共享安装结果
- **THEN** 系统不重复完整安装，worktree 进入 `lean` 状态并复用该安装结果

#### Scenario: 新 lockfile 指纹
- **WHEN** 新 worktree 的 lockfile 指纹没有可用安装结果
- **THEN** 系统为该指纹准备并校验新的共享安装结果后才完成启动，不得链接其他指纹的 `node_modules`

#### Scenario: lean 状态禁止被误认作 mutable
- **WHEN** 用户或 Agent 查询 WS 状态
- **THEN** 系统明确报告依赖模式为 `lean`，并提示依赖变更前执行 promote

### Requirement: 本地环境与开发构建目标按 Worktree Session 隔离

系统 SHALL 将主 checkout 中允许同步且被 Git 忽略的 `.env.local` 复制到新 worktree，并为该任务分配独立的开发构建 `DSH_HOME`。通过 WS 约定执行的 mydsh 构建 SHALL 写入该隔离目录，不得隐式物化到当前运行 GUI 使用的真实 `~/.dsh`。该隔离目录只约束 worktree 内的开发构建，不声称改变已运行 DSH Host 的进程级 home。

#### Scenario: 复制本地环境并覆盖构建 home
- **WHEN** 主 checkout 存在 `.env.local` 且 Worktree Session 初始化成功
- **THEN** worktree 获得本地副本，其中开发构建使用的 `DSH_HOME` 指向该任务的隔离目录，同时源文件保持不变

#### Scenario: 并行构建不互相覆盖
- **WHEN** 两个 Worktree Session 分别按 WS 约定执行 mydsh build
- **THEN** 两次构建写入不同的开发 `DSH_HOME`，且均不写入当前 GUI 的真实 `~/.dsh`

#### Scenario: 不承诺运行中 Host 隔离
- **WHEN** 用户在当前 GUI 中进入目标 Session
- **THEN** Agent 使用目标 worktree cwd，但当前 GUI Host 仍使用其启动时的进程级 `DSH_HOME`

### Requirement: 首条输入迁移保真且拒绝不安全形态

系统 SHALL 支持迁移普通文本与浏览器持有的图片草稿，并且仅在目标输入完整接收后才从原输入移除。首版遇到不能安全跨 Session 重建的输入形态（包括活动的 `/command` claim 或带内部 occurrence 的 `@`/引用占位）时 SHALL 在创建 worktree 前拒绝启动并保留原草稿，不得静默降级、丢失或以损坏内容发送。

#### Scenario: 文本和图片成功迁移
- **WHEN** 首条输入包含普通文本及可用图片草稿
- **THEN** 目标 Session 收到相同文本和有序图片，成功提交后原 Session 不再持有这些草稿

#### Scenario: 引用占位被拒绝
- **WHEN** 首条输入含不能跨 Session 安全重建的引用 occurrence
- **THEN** 系统在产生 Git/Workspace 副作用前阻止启动，说明需移除该引用，且原草稿保持可编辑

#### Scenario: slash command 被拒绝
- **WHEN** Worktree 已启用且首条输入处于 slash command claim 或将作为客户端命令处理
- **THEN** 系统不创建 worktree、不执行命令，并提示先用普通任务启动目标 Session

### Requirement: 失败不得降级到原 checkout 且重试幂等

首次发送事务任一步骤失败时，系统 SHALL 阻止原 Session 默认提交，保留首条输入与 Worktree 选择，报告失败阶段，并允许使用同一操作标识重试。重试 SHALL 复用经验证属于同一操作的已完成资源，不得重复创建 branch、worktree、Workspace、Session 或重复提交首条消息。只有用户显式关闭 `Worktree` 后的新提交才可走原 cwd。

#### Scenario: worktree 创建失败
- **WHEN** Git 拒绝创建 task branch 或 worktree
- **THEN** 原 Session 不发送消息，输入与选择保留，界面报告 Git 创建阶段失败并允许重试

#### Scenario: 初始化后续步骤失败
- **WHEN** worktree 已创建但依赖初始化、Workspace 注册、Session 创建或草稿迁移失败
- **THEN** 系统记录已完成阶段并保留可恢复资源，重试从验证后的阶段继续且不重复提交

#### Scenario: 用户显式退出 Worktree 模式
- **WHEN** 一次启动失败后用户关闭 `Worktree` 并再次点击发送
- **THEN** 系统才允许该消息按官方路径在原 Session/cwd 中提交

### Requirement: WS 状态、promote 与清理操作安全可判定

系统 SHALL 提供 `/ws` 操作面，至少支持查看当前任务及依赖模式、把 `lean` worktree 提升为独占 `mutable` 安装、以及安全清理 worktree。promote SHALL 解除共享 `node_modules` 后在目标 worktree 建立独占安装；clean SHALL 默认拒绝删除脏 worktree、未证明已合并的 task branch 或当前正在使用的 worktree，且不得默认删除远端分支。

#### Scenario: 查询状态
- **WHEN** 用户在 WS worktree 中执行状态查询
- **THEN** 系统报告 operation、base、task branch、worktree 路径、依赖模式、lockfile 指纹与开发 `DSH_HOME`

#### Scenario: promote 为 mutable
- **WHEN** lean worktree 的用户执行 promote
- **THEN** 系统解除共享依赖引用，在该 worktree 建立并校验独占安装，并把状态更新为 `mutable`

#### Scenario: 拒绝清理脏工作
- **WHEN** clean 目标存在未提交修改或 task branch 未证明已合并，且用户未提供显式确认
- **THEN** 系统拒绝删除 worktree 与 branch，并报告具体安全条件

#### Scenario: 安全清理已完成任务
- **WHEN** 目标 worktree 干净、未被当前 Session 使用且 task branch 已证明合并到指定 base
- **THEN** 系统移除 worktree 与本地 task branch并清理 WS 元数据，但保留远端分支和共享 lockfile 缓存
