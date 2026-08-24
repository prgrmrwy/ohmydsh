# source-workspace-worktree-session Specification

## Purpose

定义 Worktree Session 在不创建额外 DSH Workspace 的前提下，将源 Workspace 内的 Session 持久绑定到隔离 Git worktree、约束 Agent 执行根并保留历史归属的可观察行为。

## Requirements

### Requirement: Worktree Session remains in the source Workspace
系统 SHALL 在源 Workspace 的空白 Session 中完成 Worktree 启动，而不得为新启动流程注册第二个 Workspace 或创建第二个 Session。准备成功后，首条消息 SHALL 通过原 Session 的官方提交路径发送，Session 的 Workspace 归属 SHALL 保持不变。

#### Scenario: Successful in-place Worktree start
- **WHEN** 用户在源 Workspace 的空白 Session 选择 base、启用 Worktree 并发送首条消息
- **THEN** 系统创建独立 task branch 和 worktree，将当前 Session 绑定到该 worktree，并在同一 Session 中只提交一次首条消息
- **THEN** DSH Workspace 列表不新增该 worktree 对应的顶层 Workspace

#### Scenario: Worktree preparation fails before submission
- **WHEN** branch、worktree、依赖或环境准备任一步骤失败
- **THEN** 系统不得发送首条消息、不得把消息降级到主 checkout，并 SHALL 保留草稿和可重试 operation id

#### Scenario: Worktree mode is disabled
- **WHEN** 用户未启用 Worktree 并发送消息
- **THEN** 系统 SHALL 完全沿用普通 Session 提交行为且不得创建或绑定 worktree

### Requirement: Session-to-worktree binding is durable and exclusive
系统 SHALL 持久保存源 Session id、operation id、源仓库、worktree 路径和 task branch 的绑定。一个活动 Session 在同一时刻 MUST 只绑定一个未清理 worktree，一个未清理 operation MUST 只绑定一个源 Session。

#### Scenario: Host restart and Session resume
- **WHEN** DSH Host 重启后恢复一个已绑定且未清理的 Session
- **THEN** 系统 SHALL 从持久元数据恢复相同 worktree 绑定，并在允许继续执行前重新校验仓库、分支和 worktree 身份

#### Scenario: Repeated first-submit retry
- **WHEN** 同一 Session 使用相同 operation id 重试尚未确认的首次提交
- **THEN** 系统 SHALL 复用既有绑定和已准备资源，不得创建第二个 task branch、worktree 或重复提交

#### Scenario: Conflicting binding request
- **WHEN** 一个 Session 或 operation 被请求绑定到与持久记录不同的活动对象
- **THEN** 系统 SHALL 拒绝请求并返回可诊断冲突，不得覆盖既有绑定

### Requirement: Stable model context describes only durable execution invariants
系统 SHALL 为已绑定 Session 提供模型可见的 worktree 执行约束，至少包含源仓库、绑定 worktree、task branch、主 checkout 禁写和依赖变更前 promote 规则。该上下文 MUST 排除时间戳、实时阶段、dirty 状态、当前 HEAD、错误文本和 lean/mutable 等易变字段。

#### Scenario: Unchanged binding across turns
- **WHEN** 已绑定 Session 开始后续 turn 且稳定绑定内容未变化
- **THEN** 系统 SHALL 复用既有 runtime-context snapshot，不得向 Session 历史重复追加等价上下文事件

#### Scenario: Session resumes after restart
- **WHEN** Session 恢复且重新计算出的稳定上下文与历史中保留的 snapshot 完全一致
- **THEN** 系统 SHALL 不追加新的上下文事件

#### Scenario: Compaction removed the active snapshot
- **WHEN** compaction 或 clear 使稳定约束不再存在于有效会话表面且 Session 仍绑定活动 worktree
- **THEN** 系统 SHALL 在下一次执行前重新投影一次相同约束

### Requirement: Bound Sessions fail closed outside their worktree
系统 SHALL 对绑定 Session 的本地文件、搜索、命令执行和会创建执行上下文的委派操作实施 Session-scoped 路径保护。任何可能写入、读取或默认执行于主 checkout 或绑定 worktree 之外的调用 MUST 被拒绝，除非该工具具有明确且经验证的只读/维护例外。

#### Scenario: Bash omits the bound workdir
- **WHEN** 绑定 Session 请求运行 Bash 但未显式指定绑定 worktree 内的工作目录
- **THEN** 系统 SHALL 在工具执行前拒绝调用，并返回绑定 worktree 路径供 Agent 修正后重试

#### Scenario: File tool targets the main checkout
- **WHEN** 绑定 Session 的文件工具请求目标解析到源仓库主 checkout 而不是绑定 worktree
- **THEN** 系统 SHALL 拒绝调用且不得修改主 checkout

#### Scenario: Tool targets a path inside the bound worktree
- **WHEN** 工具参数规范化后全部目标都位于绑定 worktree 内且满足现有 sandbox policy
- **THEN** Worktree Session 路径保护 SHALL 允许调用继续由其他安全策略判定

#### Scenario: Subagent is delegated from a bound Session
- **WHEN** 绑定 Session 创建子 Agent 或后台 Agent
- **THEN** 系统 SHALL 使子 Agent继承相同逻辑 worktree 约束，或在无法可靠传播时拒绝委派并给出明确原因

### Requirement: Dependency mode is observable without mutating conversation context
新 Worktree Session SHALL 默认为 lean。当前 task branch、依赖模式和生命周期状态 SHALL 通过 UI 状态、持久元数据及按需 `ws` Skill 查询提供；状态变化不得要求更新稳定模型上下文。

#### Scenario: User asks for current dependency mode
- **WHEN** 用户在绑定 Session 中询问当前模式或 Agent 调用 `ws status`
- **THEN** 系统 SHALL 从该 Session 的持久绑定解析目标并报告 `lean` 或 `mutable`，无需用户提供 worktree 路径

#### Scenario: User requests dependency modification
- **WHEN** 用户要求安装、移除或更新依赖而当前模式为 lean
- **THEN** Agent SHALL 先通过 `ws` Skill 将当前绑定 worktree promote 为 mutable，验证成功后再执行依赖变更

#### Scenario: Promote changes the mode
- **WHEN** promote 成功将依赖模式从 lean 改为 mutable
- **THEN** UI 和后续状态查询 SHALL 显示 mutable，但系统不得仅因该变化向对话历史追加新的稳定上下文 snapshot

### Requirement: Cleanup preserves source Workspace history
安全清理 SHALL 只移除已证明可丢弃的 worktree 运行资源和 task branch，并将持久绑定标记为 cleaned。系统 MUST 保留原 Session、源 Workspace 归属及可审计的 cleaned operation 历史，且不得将 Session 移动到“未分组”。在 cleaned Session 完成一次归档后取消归档时，系统 SHALL 自动释放其当前 Worktree Session 绑定并将其恢复为普通 Session；该转换 MUST 不创建新的 branch、worktree、Workspace、Session 或 operation，也 MUST 不启用非 blank Session 的 Worktree 启动能力。

#### Scenario: Clean an archived completed Session
- **WHEN** 绑定 Session 已归档、worktree 干净、无活动执行且 task branch 已被普通 Git ancestry 证明合并
- **THEN** 系统 SHALL 删除 worktree 和安全可删的本地 task branch、标记绑定已清理，并保留 Session 在源 Workspace 下的历史记录

#### Scenario: Reopen a cleaned historical Session
- **WHEN** 用户重新打开一个已完成安全清理、但尚未发生归档后取消归档转换的历史 Session
- **THEN** 系统 SHALL 保持 cleaned 历史状态，表明旧执行目录已不存在，并拒绝把旧路径或源仓库主 checkout 当作该绑定的托管执行目录

#### Scenario: Unarchive a cleaned historical Session
- **WHEN** 一个 cleaned Session 已进入归档集，随后用户取消归档并重新打开该 Session
- **THEN** 系统 SHALL 自动释放当前 Worktree Session 绑定、移除其 cleaned 运行约束，并以源 Workspace 中的普通 Session 行为恢复该会话

#### Scenario: Unarchive creates no replacement worktree resources
- **WHEN** cleaned Session 因取消归档恢复为普通 Session
- **THEN** 系统 MUST 不创建 task branch、worktree、Workspace、Session 或 operation，且 MUST 不触发或提供非 blank `ws start`

#### Scenario: Released history remains auditable but is not current
- **WHEN** cleaned Session 已因取消归档释放为普通 Session
- **THEN** 系统 SHALL 保留其 cleaned operation 历史用于审计，但 Session 状态、输入区 UI、运行上下文、工具策略和当前绑定查询 MUST 不再把该 operation 视为当前 Worktree Session 绑定

#### Scenario: Re-archive an already released ordinary Session
- **WHEN** 用户再次归档或取消归档一个已经释放为普通状态的 Session
- **THEN** released 状态 SHALL 保持单调不回退，系统 MUST 不重新恢复旧的 cleaned 绑定

#### Scenario: Upgrade an already-unarchived legacy cleaned Session
- **WHEN** 升级前创建的 schema-v2 cleaned tombstone 仍关联一个当前未归档的源 Session，且缺少本变更新增的归档生命周期标记
- **THEN** 系统 SHALL 将该历史关系迁移为 released，并让 Session 以普通会话恢复，同时不删除 tombstone 或创建任何 Git/DSH 资源

#### Scenario: Cleanup safety cannot be proven
- **WHEN** worktree 当前活跃、dirty、operation in-flight、调用者位于目标 worktree 或合并证明不足
- **THEN** 系统 SHALL 拒绝清理且不得强制删除 Session、worktree 或 branch

### Requirement: Retired schema-v1 operations fail closed
系统 SHALL 将 `schemaVersion: 1` 及任何未知未来版本视为已退役或不受支持的 operation 格式，并在 status/promote/clean/recovery 中返回明确的 unsupported-version 诊断；系统 MUST 不为该类 operation 创建、修改或删除任何 Git worktree、branch、绑定、依赖或 operation 文件，且 MUST 不迁移或伪造绑定。

#### Scenario: Status receives a schema-v1 operation
- **WHEN** `ws status` 解析到 `schemaVersion: 1` 的 operation metadata
- **THEN** 系统 SHALL 返回清晰的 unsupported-version 诊断，且不修改任何持久数据或 Git 资源

#### Scenario: Promote receives a schema-v1 operation
- **WHEN** `ws promote` 解析到 `schemaVersion: 1` 的 operation metadata
- **THEN** 系统 SHALL 拒绝操作且不得改动依赖、lean 链接或绑定状态

#### Scenario: Clean receives a schema-v1 operation
- **WHEN** `ws clean` 解析到 `schemaVersion: 1` 的 operation metadata
- **THEN** 系统 SHALL 拒绝清理，且不得删除 Git worktree、branch 或 operation 文件

#### Scenario: Unknown future schemaVersion
- **WHEN** 系统遇到既非 1 也非 2 的 `schemaVersion`
- **THEN** 系统 SHALL 以与退役版本相同的 fail-closed 语义拒绝，并报告遇到的具体版本号

### Requirement: Operator maintenance CLI is reachable through its published entrypoint

operator 维护命令面（`status`/`promote`/`clean`）SHALL 在其所有已发布的调用路径下真实执行，包括 npm `bin` 安装产生的 symlink、构建产物真实路径以及相对路径调用。当 CLI 以已发布的 `bin` 名称被调用时，系统 MUST 执行被请求的子命令并输出该子命令的结果或明确诊断。

系统 MUST NOT 在未执行任何安全检查的情况下以成功退出码静默返回。若入口无法执行请求的子命令，系统 SHALL 以非零退出码在 stderr 输出明确诊断，使调用方无法把“未执行”误判为“检查已通过”。

作为库被导入以获取其导出（例如 `main`）时，模块 MUST NOT 因导入副作用执行任何子命令。

#### Scenario: Invoke the CLI through its npm bin symlink
- **WHEN** operator 通过 npm 安装的 `bin` symlink（例如 `node_modules/.bin/dsh-ws`）执行 `status` 并传入有效的 worktree 绝对路径
- **THEN** 系统 SHALL 执行 status 并在 stdout 输出该 operation 的 JSON 报告，退出码为 0

#### Scenario: Invoke the CLI through the built artifact realpath
- **WHEN** operator 直接以构建产物真实路径执行同一 `status` 命令
- **THEN** 系统 SHALL 产生与经 symlink 调用一致的报告和退出码

#### Scenario: A dry-run cleanup through the bin entrypoint actually evaluates safety
- **WHEN** operator 通过已发布的 `bin` 入口执行 `clean --dry-run` 并传入有效 worktree 路径
- **THEN** 系统 SHALL 真实评估 containment、dirty-state 与 merge-ancestry 等安全门，并输出计划动作与 `dryRun: true`；系统 MUST NOT 在未做这些评估时返回成功

#### Scenario: Entrypoint cannot execute the requested command
- **WHEN** 入口因解析失败、缺失构建产物或未知子命令而无法执行请求的操作
- **THEN** 系统 SHALL 以非零退出码返回明确诊断，且 MUST NOT 以退出码 0 静默结束

#### Scenario: Importing the CLI module runs no command
- **WHEN** 其他模块导入 CLI 模块以使用其导出函数
- **THEN** 导入 MUST NOT 触发任何 status/promote/clean 执行或产生 stdout 输出

### Requirement: Legacy history is preserved, never migrated
系统 SHALL 保留历史源 Session 日志与既有 DSH Workspace/Session 注册；退役 schema-v1 不得触发任何自动迁移、重绑定、重命名或删除历史实体，且任何路径都无法为旧格式伪造 source-session binding。

#### Scenario: Historical Session logs remain readable
- **WHEN** 用户或系统在 schema-v1 退役后访问历史 Session 日志
- **THEN** 日志 SHALL 保持原样可读，系统不得改写或迁移其历史内容

#### Scenario: No binding fabrication for legacy records
- **WHEN** 系统遇到一个遗留 v1 operation 或独立 Workspace/Session 记录
- **THEN** 系统 SHALL 不为其创建 source-session binding，也不将其从“已归档或独立”状态重绑定或重归类

### Requirement: Input-area status shows the task branch in one line with a hover title
输入区状态栏在展示已绑定工作会话的任务分支名时，SHALL 以单行渲染并在超出可用宽度时以省略号截断；当用户 hover 该分支名文本时，SHALL 展示完整的 task branch 名称。该展示行为 MUST 不改变绑定模型、生命周期状态或任何持久数据。

#### Scenario: Long branch name stays on one line
- **WHEN** 已绑定会话的任务分支名在状态栏可用宽度内无法完整容纳
- **THEN** 状态栏 SHALL 保持单行布局，超宽部分以省略号显示且不发生换行

#### Scenario: Hover reveals the full branch name
- **WHEN** 用户将指针悬停在状态栏的分支名文本上
- **THEN** 系统 SHALL 展示该分支的完整名称（而非 worktree 路径）

#### Scenario: Short branch name is unaffected
- **WHEN** 任务分支名在可用宽度内可完整容纳
- **THEN** 状态栏 SHALL 完整显示分支名且不添加省略号或截断

### Requirement: Branch name opens the bound worktree in the local editor
在绑定会话的输入区状态栏中，任务分支名 SHALL 是可点击的；用户点击后，系统 SHALL 使用本机编辑器打开该会话绑定的 managed worktree 目录。打开路径 MUST 来自该会话的持久绑定元数据（`worktreePath`），而不是用户可任意指定的文本。未绑定或已清理的会话 MUST 不提供该打开行为。

#### Scenario: Click the branch name of a bound Session
- **WHEN** 用户点击绑定会话状态栏的任务分支名
- **THEN** 系统 SHALL 请求本机编辑器打开该绑定的 managed worktree 目录

#### Scenario: Opened directory is the bound worktree path
- **WHEN** 系统构造编辑器深链
- **THEN** 打开目标 SHALL 精确等于该会话持久绑定中的 `worktreePath`，且不得退化为仓库根目录或其他路径

#### Scenario: No binding yet
- **WHEN** 会话尚未绑定 worktree（空白会话或没有 lifecycle 状态）
- **THEN** 分支名 SHALL 显示为普通文本且不可点击，不产生任何打开请求

#### Scenario: Cleaned historical Session
- **WHEN** 会话的绑定已经是 cleaned（旧 worktree 已删除）
- **THEN** 系统 SHALL 不尝试打开旧路径，且不提供可点击打开行为

### Requirement: Editor open behavior is configurable
系统 SHALL 允许配置编辑器打开方式；默认 SHALL 使用 `vscode://file/<绝对路径>` deep link 交给本机处理。配置变更 MUST NOT 改变绑定模型、持久格式、wire 或 schema。

#### Scenario: Default deep link
- **WHEN** 用户未自定义打开方式且点击分支名
- **THEN** 系统 SHALL 以 `vscode://file/<worktreePath>` 交给本机打开

#### Scenario: Missing local editor
- **WHEN** 本机没有注册处理 deep link 的编辑器
- **THEN** 系统 SHALL 不静默失败；其行为由操作系统/浏览器对未注册 scheme 的标准处理决定，且不得伪造成功
