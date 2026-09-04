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

#### Scenario: Dependency mutation is refused in lean mode
- **WHEN** 已绑定的 pnpm 项目处于 lean 状态，Agent 尝试修改依赖（如编辑 `package.json` 或 `pnpm-lock.yaml` 后直接安装）
- **THEN** Worktree Session 执行保护 SHALL 要求先 promote 为 mutable，与 npm 项目的既有规则一致

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
安全清理 SHALL 只移除已证明可丢弃的 worktree 运行资源和 task branch，并将持久绑定标记为 cleaned；标记时 SHALL 一并记录该源 Session 在清理时刻的归档成员资格，使归档生命周期的后续判定不丢失该事实。系统 MUST 保留原 Session、源 Workspace 归属及可审计的 cleaned operation 历史，且不得将 Session 移动到“未分组”。

当一个已清理绑定的托管 worktree 已不复存在时，系统 SHALL 自动释放该绑定并将会话恢复为普通 Session，无论其是否曾经归档；托管 worktree 仍然存在且身份可被证明时，SHALL 保持其既有 Worktree Session 约束。该转换 MUST 不创建新的 branch、worktree、Workspace、Session 或 operation，也 MUST 不启用非 blank Session 的 Worktree 启动能力。

#### Scenario: Clean an archived completed Session
- **WHEN** 绑定 Session 已归档、worktree 干净、无活动执行且 task branch 已被普通 Git ancestry 证明合并
- **THEN** 系统 SHALL 删除 worktree 和安全可删的本地 task branch、标记绑定已清理，并保留 Session 在源 Workspace 下的历史记录

#### Scenario: Reopen a cleaned historical Session whose worktree is gone
- **WHEN** 用户重新打开一个已完成安全清理、且其托管 worktree 已不存在的历史 Session（无论是否曾经归档）
- **THEN** 系统 SHALL 释放该绑定并以普通 Session 恢复该会话，且 MUST NOT 把旧 worktree 路径或源仓库主 checkout 当作该绑定的托管执行目录

#### Scenario: Unarchive a cleaned historical Session
- **WHEN** 一个 cleaned Session 已进入归档集，随后用户取消归档并重新打开该 Session
- **THEN** 系统 SHALL 自动释放当前 Worktree Session 绑定、移除其 cleaned 运行约束，并以源 Workspace 中的普通 Session 行为恢复该会话

#### Scenario: Unarchive after an archive-then-clean finish releases the Session
- **WHEN** 一个候选经"确认 → 归档 → 清理"收尾后，用户取消归档并重新打开该源 Session
- **THEN** 系统 SHALL 与"清理前已归档"路径一样自动释放该绑定并恢复为普通 Session，其工具策略 MUST NOT 继续按已清理绑定拒绝调用

#### Scenario: A never-archived cleaned Session is released all the same
- **WHEN** 一个已清理且从未进入过归档集的 Session 被重新打开，其托管 worktree 已不存在
- **THEN** 系统 SHALL 同样释放该绑定并恢复为普通 Session，MUST NOT 因其缺少归档往返而使其停留在全工具拒绝状态

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

### Requirement: The cleaned tombstone records the archive fact as of clean time
写入 cleaned tombstone 时，系统 SHALL 依据该源 Session 在**清理时刻**的真实归档成员资格确定绑定状态：已归档时写入等价于"已清理且在归档集内"的状态，未归档时写入"已清理"。该归档事实 MUST 由受信 Host 提供；维护层 MUST NOT 自行推断，也 MUST NOT 无条件假定未归档。

之所以必须在写入时刻确定：归档与清理是两个独立的持久写入。"先归档再清理"的收尾编排中，归档先于 tombstone 存在而发生，因此归档观察到的是一个尚未清理的 operation，对其无状态可推进；随后 tombstone 若把状态固定为"未归档已清理"，就把已经发生的归档事实覆盖掉了。清理是这两个事件中较晚的一个，它写入时归档成员资格已经确定，因此这里是唯一能同时看到两个事实的位置。

#### Scenario: A Session archived during the finish flow is cleaned as archived
- **WHEN** 收尾编排先归档源 Session，随后对该候选执行真实清理
- **THEN** tombstone SHALL 记录该绑定为已清理且在归档集内，使既有的取消归档释放路径对该记录可达

#### Scenario: A Session archived before cleanup keeps its existing outcome
- **WHEN** 源 Session 在清理发起前即已归档，随后被清理
- **THEN** tombstone SHALL 记录同一"已清理且在归档集内"的状态，与既有行为一致

#### Scenario: A never-archived Session is cleaned as unarchived
- **WHEN** 某个入口在源 Session 未归档时完成清理
- **THEN** tombstone SHALL 记录为"已清理"，且 MUST NOT 伪造任何归档事实

#### Scenario: The archive fact is never inferred by the maintenance layer
- **WHEN** 调用方未提供该源 Session 的归档事实
- **THEN** 系统 SHALL 保持既有"已清理"写入，MUST NOT 通过扫描归档集或其他旁路自行推断

### Requirement: A binding whose managed worktree no longer exists is released
恢复一个已清理绑定时，系统 SHALL 依据**该托管 worktree 当前是否仍然存在且身份可被证明**来决定其归属：仍存在且身份校验通过时，保持既有 Worktree Session 约束；已不存在或身份无法被证明时，SHALL 释放该绑定并以源 Workspace 中的普通 Session 行为恢复该会话。

判定 SHALL 复用既有的托管 worktree 身份校验（目录存在、位于仓库的 worktree 分配根之内、当前分支等于任务分支、Git common dir 与 operation 元数据一致），MUST NOT 退化为只判断路径是否存在——一个被删除后又以同名重建的目录不构成同一个托管 worktree。

该判定 MUST NOT 依赖该 Session 是否曾经归档：worktree 是否还在与归档历史无关。以归档历史决定归属，会使两个执行目录同样已被删除的会话得到不同结果——其中一个永久停在全工具拒绝状态，而这与其执行目录的真实状态无关。

释放 MUST NOT 创建、修改或删除任何 branch、worktree、Workspace、Session、operation 或其他 Git/DSH 资源，MUST NOT 删除 cleaned tombstone，且 MUST 与既有 released 单调性一致。

#### Scenario: A cleaned binding whose worktree is gone becomes an ordinary Session
- **WHEN** 恢复一个已清理绑定，其托管 worktree 目录已不存在
- **THEN** 系统 SHALL 释放该绑定并以普通 Session 行为恢复该会话，且 MUST NOT 创建或删除任何 Git/DSH 资源

#### Scenario: Release does not depend on archive history
- **WHEN** 两个已清理绑定的托管 worktree 均已被删除，其中一个曾经历归档往返、另一个从未归档
- **THEN** 系统 SHALL 对二者作出相同判定并均释放为普通 Session

#### Scenario: A surviving managed worktree keeps its binding
- **WHEN** 恢复一个绑定，其托管 worktree 仍然存在且通过既有身份校验
- **THEN** 系统 SHALL 保持该 Worktree Session 绑定与其既有执行约束不变

#### Scenario: An unprovable worktree identity is not treated as surviving
- **WHEN** 目标路径存在，但其分支、Git common dir 或分配根不满足既有身份校验
- **THEN** 系统 SHALL 判定该托管 worktree 不复存在并释放该绑定，MUST NOT 把该路径当作托管执行目录

#### Scenario: Released monotonicity is preserved
- **WHEN** 归档生命周期协调遇到一个已经处于 released 的记录
- **THEN** 系统 SHALL 保持其 released 不变，MUST NOT 回退为任何更早的状态

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

### Requirement: Input-area base ref chooser shows refs in one line with a hover full name
输入区在空白会话创建态展示 base ref 选择器时，选择器按钮标签与下拉候选项的 ref 名 SHALL 以单行渲染，超出可用宽度时以省略号截断且不发生换行；当用户 hover 按钮或候选项时，SHALL 能看到该 ref 的完整名称。该展示行为 MUST NOT 改变 base ref 选择语义（选择仍不产生任何 Git 副作用），也不得改变绑定模型、生命周期状态或任何持久数据。

#### Scenario: Long selected base ref keeps the input row on one line
- **WHEN** 空白会话已选中的 base ref 名在选择器按钮可用宽度内无法完整容纳
- **THEN** 按钮 SHALL 保持单行布局，超宽部分以省略号显示，且不因换行而增加输入区控件行高

#### Scenario: Hover the chooser reveals the full selected ref name
- **WHEN** 用户将指针悬停在 base ref 选择器按钮上
- **THEN** 系统 SHALL 展示当前选中 ref 的完整名称，并同时保留“选择 base ref 不产生 Git 副作用”的说明语义

#### Scenario: Long candidate ref in the dropdown stays on one line
- **WHEN** 下拉候选列表中某个本地或远端 ref 名超出候选面板可用宽度
- **THEN** 该候选项 SHALL 单行省略显示，且 hover 时展示该候选 ref 的完整名称

#### Scenario: Short ref names are unaffected
- **WHEN** 选中的 ref 名或候选 ref 名在可用宽度内可完整容纳
- **THEN** 系统 SHALL 完整显示该名称且不添加省略号或截断

#### Scenario: Selection still has no Git side effects
- **WHEN** 用户在下拉列表中点选任意候选 ref
- **THEN** 系统 SHALL 仅更新该会话的暂存 base ref 选择，且 MUST NOT 执行任何 Git 操作或产生持久绑定

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

### Requirement: Project type is resolved before any Worktree resource is created
系统 SHALL 在创建任何 operation 文件、task branch、worktree 或绑定之前，依据仓库根目录的 lockfile 解析项目类型：仅存在 `package-lock.json`（npm）、仅存在 `pnpm-lock.yaml`（pnpm）。

二者同时存在时，系统 SHALL NOT 直接拒绝，而是先按以下固定优先级采集**可证明的仓库意图信号**：

1. 仓库根 `package.json` 的 `packageManager` 字段：其声明的包管理器为 npm 或 pnpm 时，系统 SHALL 采信该声明；
2. 否则比较两个 lockfile 的版本控制跟踪状态：恰好一个被仓库跟踪时，系统 SHALL 采信被跟踪的那个 lockfile 对应的包管理器；
3. 以上信号均无法区分时（两个 lockfile 都被跟踪、都未被跟踪、`packageManager` 声明的是不支持的包管理器、或跟踪状态无法查询），系统 SHALL 拒绝请求。

二者均不存在时，系统 SHALL 拒绝请求。

被拒绝的请求 SHALL 返回明确诊断，MUST NOT 创建或修改任何 Git 资源、operation 文件或绑定，且不发送首条消息。裁决 SHALL 全部发生在创建任何资源之前，无论结果是采信还是拒绝。

#### Scenario: Unsupported project refuses before any resource
- **WHEN** 空白 Session 的仓库根目录既无 `package-lock.json` 也无 `pnpm-lock.yaml`，用户启用 Worktree 并发送首条消息
- **THEN** 系统 SHALL 返回明确的 `UNSUPPORTED_PROJECT` 诊断（说明仅支持 npm/pnpm 锁文件项目），且不创建 task branch、worktree、operation 文件或绑定

#### Scenario: Mixed lockfiles adopt the tracked one
- **WHEN** 仓库根目录同时存在 `package-lock.json` 与 `pnpm-lock.yaml`，其中恰好一个被仓库跟踪、另一个未被跟踪，且 `package.json` 未声明 `packageManager`
- **THEN** 系统 SHALL 将被跟踪的那个 lockfile 对应的包管理器识别为项目类型并继续既有启动流程，未被跟踪的 lockfile SHALL 被忽略且不参与依赖指纹计算

#### Scenario: Mixed lockfiles defer to the packageManager declaration
- **WHEN** 仓库根目录同时存在两个 lockfile，且 `package.json` 的 `packageManager` 字段声明了 npm 或 pnpm
- **THEN** 系统 SHALL 采信该声明作为项目类型，即使跟踪状态指向另一个包管理器

#### Scenario: Mixed lockfiles refuse with a clear diagnostic
- **WHEN** 仓库根目录同时存在 `package-lock.json` 与 `pnpm-lock.yaml`，且二者跟踪状态相同（都被跟踪或都未被跟踪），且 `package.json` 未声明受支持的 `packageManager`
- **THEN** 系统 SHALL 在创建任何资源前拒绝请求并返回明确诊断，说明存在混合 lockfile 且无法判定仓库意图，且不创建 task branch、worktree、operation 文件或绑定

#### Scenario: Unqueryable tracking state refuses instead of guessing
- **WHEN** 仓库根目录同时存在两个 lockfile，`package.json` 未声明受支持的 `packageManager`，且跟踪状态无法查询（例如目标不是 Git 工作树或查询失败）
- **THEN** 系统 SHALL 拒绝请求并返回明确诊断，MUST NOT 退化为任何默认包管理器

#### Scenario: npm project is recognized unchanged
- **WHEN** 仓库根目录存在 `package-lock.json`
- **THEN** 系统 SHALL 按 npm 项目继续既有启动流程，行为与变更前一致

#### Scenario: pnpm project is recognized
- **WHEN** 仓库根目录存在 `pnpm-lock.yaml`
- **THEN** 系统 SHALL 将该项目识别为 pnpm 项目并继续按其语义执行后续准备工作

### Requirement: pnpm projects are fully supported across the Worktree Session lifecycle
系统 SHALL 对 pnpm 项目（单包或 pnpm workspace）提供与 npm 项目等价的 Worktree Session 生命周期：依赖指纹依据 `pnpm-lock.yaml` 与 pnpm CLI major 计算；lean 准备在绑定 worktree 内按 lockfile 安装依赖；promote 按 lockfile 在绑定 worktree 内重新完整安装并报告 `mutable`；状态查询与维护命令 SHALL 报告项目类型（npm/pnpm）。安装解析与去重复用 pnpm 全局 store，MUST NOT 修改真实用户配置或污染其他项目。

#### Scenario: pnpm workspace starts and prepares dependencies in the worktree
- **WHEN** 空白 Session 落在 pnpm workspace 仓库根目录，用户启用 Worktree 并发送首条消息
- **THEN** 系统 SHALL 创建 task branch 与 worktree，在绑定 worktree 内完成依赖准备（workspace 内部包解析到该 worktree 的源码），并在同一 Session 中只提交一次首条消息

#### Scenario: pnpm promote produces mutable dependencies
- **WHEN** 已绑定的 pnpm 项目处于 lean 状态，Agent 先执行 promote
- **THEN** 系统 SHALL 按 lockfile 在绑定 worktree 内重新完整安装依赖并验证成功后报告 `mutable`

#### Scenario: pnpm status reports project type and mode
- **WHEN** 用户查询一个 pnpm 项目绑定的状态
- **THEN** 状态结果与 UI SHALL 报告项目类型为 pnpm 以及当前 lean/mutable 模式

#### Scenario: pnpm dependency fingerprint follows the lockfile and CLI version
- **WHEN** `pnpm-lock.yaml` 内容或 pnpm CLI major 变化
- **THEN** 依赖指纹 SHALL 相应变化，且不同指纹的依赖状态互不共享

### Requirement: An adopted mixed-lockfile resolution is visible, never silent
当系统在混合 lockfile 场景下采信某个包管理器并继续启动时，系统 SHALL 使该裁决对用户可见：记录采信的包管理器、依据的信号（`packageManager` 声明或跟踪状态）以及被忽略的 lockfile。该信息 SHALL 随 operation 一起持久化，使用户在启动后仍可复核为何只有一套锁生效。可见性 MUST NOT 改变启动是否成功，也 MUST NOT 阻塞首条消息。

#### Scenario: Adoption is recorded on the operation
- **WHEN** 系统按跟踪状态或 `packageManager` 声明采信了混合 lockfile 中的一个
- **THEN** 该 operation 的持久诊断 SHALL 包含采信的包管理器、依据的信号与被忽略的 lockfile 名称

#### Scenario: Single-lockfile projects add no noise
- **WHEN** 仓库根目录只存在一个受支持的 lockfile
- **THEN** 系统 SHALL NOT 记录任何混合 lockfile 裁决信息

### Requirement: Repository cleanup is initiated from an ordinary main-checkout Session
模型可见的 `ws clean` SHALL 从调用 Session 的仓库主 checkout 发起仓库级清理，而不是要求调用 Session 自身具有 Worktree Session binding。调用 Session MUST 是 cwd 精确对应仓库主 checkout、且没有当前 Worktree Session binding 的普通 Session。系统 SHALL 只扫描该仓库的 Worktree Session operation；未经用户一次性授权时，不得接受模型指定任意路径、其他 Session 或其他仓库作为清理目标，经用户一次性授权的显式路径 SHALL 按授权路径目标语义处理。`ws status` 与 `ws promote` MUST 继续按当前调用 Session binding 解析目标（授权显式路径除外）。

#### Scenario: Ordinary main Session starts repository cleanup
- **WHEN** 一个 cwd 精确对应仓库主 checkout、且没有 Worktree Session binding 的普通 Session 调用 `ws clean`
- **THEN** 系统 SHALL 扫描该仓库的 Worktree Session operation，而不得因调用 Session 没有 binding 报错

#### Scenario: Bound Worktree Session attempts cleanup
- **WHEN** 一个仍具有当前 Worktree Session binding 的 Session 调用 `ws clean` 且未携带经授权的显式 `path`
- **THEN** 系统 SHALL 拒绝清理自身及其他任务，并明确提示用户切换到同仓库的普通主仓 Session 执行清理

#### Scenario: Unbound caller is not at the main checkout
- **WHEN** 一个无 binding Session 的 cwd 不能被证明精确对应仓库主 checkout，且调用未携带经授权的显式 `path`
- **THEN** 系统 SHALL 拒绝整次清理，且不得扫描或删除任何 Worktree Session 资源

#### Scenario: Status and promote retain binding semantics
- **WHEN** 无 Worktree Session binding 的普通主仓 Session 调用 `ws status` 或 `ws promote` 且未携带经授权的显式 `path`
- **THEN** 系统 SHALL 保持现有无绑定诊断，且不得把这两个动作改为仓库级扫描

### Requirement: Agent explicit ws path is model-visible and gated by authorization
模型可见的 `ws` 工具 SHALL 在其参数 schema 中声明可选的 `path` 参数，使该通道可被发现，而不依赖“参数根开放、未声明参数亦可到达执行”的未公开行为；参数描述 MUST 说明它接受绝对路径且每次使用都需要用户一次性授权。工具描述 MUST 相应说明显式路径对 Agent 可用但受授权把关，不得再表述为仅经 `dsh-ws` 或 Skill shell wrapper 可用。

#### Scenario: Explicit path is discoverable in the tool schema
- **WHEN** 模型读取 `ws` 工具的参数 schema
- **THEN** schema SHALL 包含可选的 `path` 参数，且其描述说明该路径需要用户一次性授权

#### Scenario: Operator CLI remains available unchanged
- **WHEN** operator 使用 `dsh-ws` 或 Skill shell wrapper 的显式路径命令
- **THEN** 系统 SHALL 按既有 operator 语义执行，不因模型可见 `path` 的引入而改变目标解析或安全门

### Requirement: Agent explicit ws path is trusted only through one-shot user authorization
模型可见的 `ws` 工具在 Agent 调用携带非空显式 `path`、且该调用可能改变仓库状态时，SHALL 通过 DSH 平台的用户提问能力（`ctx.userQuestions`）向用户发起一次性确认，询问 MUST 明确包含被请求的 action 与确切路径，并提供可直接选择的同意与拒绝选项。

只读预览（`clean` 且 `dry_run` 为真）MUST NOT 要求该确认：它不删除、不归档、不发起任何询问，此时确认所守护的只是一次读取。既有指引要求"先预览再决定"，若预览同样索取确认，一个流程在发生任何实质动作前就需两次作答；守护空无一物的提问会稀释真正守护破坏性动作的那一次。**真实运行仍必须确认**。不具备预览形态的 action（`status`、`promote`）MUST 对每次显式路径照常确认。系统 MUST NOT 使用 approval（沙箱提权授权）能力承载该确认：该能力在 `danger-full-access` 部署下 policy 为 `never`，会在无人应答的情况下自动拒绝，使确认在最需要它的部署中不可达。仅当用户明确选择同意项时，系统 SHALL 将该显式路径作为本次调用的目标来源；用户拒绝、未作答、仅给出自由文本、无可用提问 provider 或询问抛错时，系统 MUST 拒绝该调用并保持与既有拒绝一致的 fail-closed 行为，不得扫描、修改或删除任何 Worktree Session 资源。同意 MUST 只对当次调用生效，不得建立任何持久放权。省略 `path` 或空字符串 `path`（wire 兼容形态）的调用 MUST 保持既有解析语义完全不变。

#### Scenario: A read-only preview is not gated
- **WHEN** Agent 以显式 `path` 发起 `clean` 且 `dry_run` 为真
- **THEN** 系统 SHALL 直接以该路径执行预览，MUST NOT 发起确认，且 MUST NOT 删除、归档或修改任何资源

#### Scenario: The real run after a preview still asks
- **WHEN** 同一 Agent 在预览之后以同一显式 `path` 发起真实清理
- **THEN** 系统 SHALL 就该次调用发起确认，MUST NOT 因刚完成预览而免除

#### Scenario: User agrees to an explicit path
- **WHEN** Agent 调用 `ws` 携带非空显式 `path`，用户在确认中选择同意项
- **THEN** 系统 SHALL 以该路径作为本次调用的目标来源继续执行，且后续全部既有安全门逐项照常评估

#### Scenario: User declines the confirmation
- **WHEN** Agent 调用 `ws` 携带非空显式 `path`，用户选择拒绝项
- **THEN** 系统 SHALL 拒绝本次调用并返回明确诊断，不得对任何 Worktree Session 资源产生读写以外的影响

#### Scenario: Confirmation is unreachable or unanswered
- **WHEN** 会话未组合用户提问 provider、询问抛错（如步骤被中止），或用户未选择任何选项
- **THEN** 系统 SHALL 确定性拒绝本次调用（fail closed），且 MUST NOT 把沉默或自由文本当作同意

#### Scenario: Full-access deployment still receives the prompt
- **WHEN** 部署以 `danger-full-access` 运行（approval policy 为 `never`），Agent 调用 `ws` 携带非空显式 `path`
- **THEN** 系统 SHALL 仍通过用户提问能力向用户展示确认，MUST NOT 因 approval policy 而自动拒绝

#### Scenario: Agreement does not bypass safety gates
- **WHEN** 用户已同意显式路径，但目标候选未通过既有安全门（如 dirty、active、in-flight、未归档、未合并或 schema 不支持）
- **THEN** 系统 SHALL 按既有安全门语义拒绝该候选并报告原因；同意 MUST 不构成任何安全门的豁免

#### Scenario: Agreement is single-use
- **WHEN** 同一 Agent 在一次同意后再次调用 `ws` 携带显式 `path`
- **THEN** 系统 SHALL 重新发起确认，不得复用先前同意

#### Scenario: Omitted or empty path keeps existing resolution
- **WHEN** Agent 调用 `ws` 省略 `path` 或传入空字符串
- **THEN** 系统 SHALL 按既有语义解析目标（`status`/`promote` 按调用 Session binding，`clean` 按调用 Session 主 checkout cwd），且 MUST 不发起授权询问

### Requirement: Authorized explicit path selects existing target semantics per action
一次性授权通过后，显式路径 MUST 只替换“目标来源信任”，不得引入新的目标语义：`clean` 携带授权路径 SHALL 等价于从该路径对应仓库主 checkout 的普通无绑定 Session 发起的仓库级清理扫描（含既有主 checkout 校验、归档前置条件、逐项安全门与批量汇总）；`status` 与 `promote` 携带授权路径 SHALL 等价于既有显式路径 operator 维护的单 operation 语义。授权路径无法被证明为有效目标（非仓库主 checkout、无有效 operation metadata 等）时，系统 MUST 按既有诊断拒绝。

#### Scenario: Authorized clean scans the named repository main checkout
- **WHEN** 用户授权后，`ws clean` 以某仓库主 checkout 的绝对路径为 `path` 执行
- **THEN** 系统 SHALL 对该仓库执行与主 checkout 普通 Session 发起完全一致的仓库级扫描与批量清理，逐项报告 cleaned/refused/ignored

#### Scenario: Authorized clean path is not a repository main checkout
- **WHEN** 用户授权的 `path` 不能被证明精确对应某仓库主 checkout
- **THEN** 系统 SHALL 拒绝整次清理并返回明确诊断，不得扫描或删除任何 Worktree Session 资源

#### Scenario: Authorized status or promote targets one operation
- **WHEN** 用户授权后，`ws status` 或 `ws promote` 以有效 worktree 绝对路径为 `path` 执行
- **THEN** 系统 SHALL 按既有显式路径单 operation 语义解析并执行，安全门与诊断不变

### Requirement: The confirmation is answerable and self-evident to the user
每次显式路径确认 SHALL 由发起调用的会话中的真人作答，询问 MUST 自带判断所需的全部事实（被请求的 action 与确切绝对路径），MUST NOT 要求用户另行查阅上下文才能理解自己在批准什么，且 MUST 提供可直接选择的拒绝项，使拒绝无需输入自由文本。询问与作答由平台用户提问能力记录在该会话的对话中，构成可回溯的决定记录；系统 MUST NOT 在没有用户明确同意的情况下采纳任何显式路径。

#### Scenario: The question carries the deciding facts
- **WHEN** Agent 携带显式 `path` 调用 `ws` 触发确认
- **THEN** 询问 SHALL 包含被请求的 action 与确切路径，并说明同意仅对本次调用生效

#### Scenario: Declining requires no free text
- **WHEN** 用户希望拒绝一次显式路径确认
- **THEN** 询问 SHALL 提供可直接选择的拒绝项，且选择它 MUST 使调用按 fail-closed 拒绝

### Requirement: Repository cleanup processes all and only archived safe candidates
仓库级 `ws clean` SHALL 枚举当前仓库尚未清理的 schema-v2 source-session operation，并逐项判定。候选 MUST 通过既有 active、dirty、in-flight、调用路径、binding 完整性与普通 Git merge ancestry 安全门，才可删除其 worktree 和本地 task branch 并保留 cleaned tombstone。源 Session 已归档的候选 SHALL 直接进入清理；源 Session 未归档但其余安全门均通过的候选 SHALL 经用户一次性确认后先归档再清理，未确认则保持 `not-archived` 拒绝。一次调用 SHALL 尝试处理全部合格候选；单个候选不合格、无法解析、确认被拒或归档失败时 MUST 保持该候选资源不变，并在汇总结果中报告原因，而不得阻止其他独立合格候选接受判定。

#### Scenario: Multiple archived candidates are safe
- **WHEN** 当前仓库存在多个已归档、无活动执行、worktree 干净、operation 已 prepared 且 task branch 已证明合并的 Worktree Session
- **THEN** 一次 `ws clean` SHALL 清理全部这些候选，并为每项保留 cleaned operation tombstone

#### Scenario: Safe Git state but source Session is not archived
- **WHEN** 候选通过 Git、phase、binding 与活跃状态安全门，但其源 Session 未归档
- **THEN** 系统 SHALL 就该候选发起归档确认；用户确认则先归档再清理，未确认则保留其 worktree、分支和 operation 并在汇总中报告未归档拒绝原因

#### Scenario: Mixed eligible and refused candidates
- **WHEN** 同一仓库同时包含合格候选，以及 dirty、活跃、in-flight、未合并、binding 损坏或 schema 不支持的候选
- **THEN** 系统 SHALL 只处理合格候选，保持所有拒绝候选不变，并分别汇总已清理项和带原因的拒绝项

#### Scenario: No operations are eligible
- **WHEN** 仓库不存在合格候选
- **THEN** 系统 SHALL 成功返回零清理汇总及各拒绝或忽略原因，而不得把“调用 Session 无 binding”作为错误

#### Scenario: Already cleaned history is encountered
- **WHEN** 扫描遇到 phase 已为 cleaned 或 binding 已 released 的审计记录
- **THEN** 系统 SHALL 将其作为已完成历史忽略，不重复删除资源或回退生命周期

### Requirement: Cleanup scope is chosen by the caller, not inferred
`ws clean` SHALL 支持两种明确的处理范围：默认的仓库级清扫，以及**只处理指定的那一个 operation**。请求后者时，系统 MUST NOT 扫描仓库内其他 Worktree Session，MUST NOT 就其他候选发起任何确认，也 MUST NOT 删除其他候选的任何资源；该 operation 的全部既有安全门与归档收尾编排照常适用。

范围 MUST 由调用显式声明，MUST NOT 由系统依调用方是否绑定 worktree 隐式改变：同一动作依上下文变更影响范围，会使用户无法从请求本身预见其后果。

指定范围下的目标解析 MUST 沿用既有规则，MUST NOT 引入第三套目标语义：调用方自身有 worktree 绑定时按该绑定解析；调用方提供经用户一次性授权的显式路径时，该路径 SHALL 被解析为它所属的那一个 worktree operation。系统不具备"当前 worktree"这一独立概念：所谓指定，指的是按上述规则解析出的那一个 operation。

工作目录不在目标仓库内的调用方 MUST 能够使用该范围。这类调用方没有自身绑定可依据，其唯一可用事实就是授权路径；若要求"必须由自身绑定解析"，该范围对它们将不可达，而它们恰恰最需要单目标收尾。

调用方自身仍绑定 worktree MUST NOT 成为拒绝该范围的理由——收尾自身工作区正是其适用场景；但这 MUST NOT 使它获得处置同仓库内其他 Worktree Session 的能力。

#### Scenario: The specified scope targets exactly one operation
- **WHEN** 调用方请求只处理指定的 operation，且目标可按既有规则解析
- **THEN** 系统 SHALL 仅就该 operation 判定与处置，最多发起一次收尾确认，且结果中 MUST NOT 出现其他 operation

#### Scenario: The specified scope never sweeps peers
- **WHEN** 仓库内同时存在其他未归档且已完成的 Worktree Session
- **THEN** 该调用 MUST NOT 就它们发起确认或删除其资源

#### Scenario: A bound Session may finish its own worktree
- **WHEN** 仍绑定 worktree 的 Session 以指定范围发起清理
- **THEN** 系统 SHALL 按其自身绑定解析目标并照常判定，MUST NOT 仅因调用方处于绑定状态而拒绝

#### Scenario: A caller outside the repository finishes one worktree by path
- **WHEN** 工作目录不在目标仓库内的调用方以指定范围发起清理，并提供经授权的 worktree 路径
- **THEN** 系统 SHALL 将该路径解析为其所属的唯一 operation 并仅处置它，MUST NOT 因调用方无自身绑定而拒绝，也 MUST NOT 扩大为仓库级清扫

#### Scenario: A path owned by no registered worktree is refused
- **WHEN** 指定范围下给出的路径不属于任何已注册的 worktree
- **THEN** 系统 SHALL 以明确诊断拒绝，MUST NOT 退化为仓库级清扫

#### Scenario: The specified scope requires a resolvable target
- **WHEN** 调用方请求指定范围，但既无自身绑定亦无授权路径可解析出 operation
- **THEN** 系统 SHALL 以明确诊断拒绝，MUST NOT 退化为仓库级清扫

#### Scenario: Repository-wide cleanup is unchanged by default
- **WHEN** 调用方未声明指定范围
- **THEN** 系统 SHALL 保持既有仓库级扫描与逐候选判定语义不变

### Requirement: Unarchived candidates are offered archive-then-clean instead of a bare refusal
仓库级 `ws clean` 遇到源 Session 未归档、但其余全部既有安全门均可通过的候选时，SHALL 通过一次性用户授权通道提出"归档并清理"的确认，而不是直接拒绝。确认信息 MUST 包含该候选的源 Session id、任务分支、worktree 路径，以及已判定的合入与洁净状态，使用户在确认前即可判断收尾是否安全。仅当用户明确确认时，系统 SHALL 先归档该源 Session，再对该候选执行既有清理；未确认时 MUST 保持既有 `not-archived` 拒绝语义，且不得归档、修改或删除任何资源。

#### Scenario: User confirms archive-then-clean for a finished candidate
- **WHEN** 候选的源 Session 未归档，但任务分支已证明合入、worktree 干净、operation 为 prepared 且无活跃占用，用户确认收尾
- **THEN** 系统 SHALL 先归档该源 Session，再执行既有清理，并在汇总中报告该候选已归档并清理

#### Scenario: User declines the archive-then-clean offer
- **WHEN** 系统就未归档候选发起确认，用户拒绝、取消，或无可用应答通道
- **THEN** 系统 SHALL 保持既有 `not-archived` 拒绝并报告原因，且 MUST NOT 归档该 Session 或删除任何 Git 资源

#### Scenario: Confirmation names the exact candidate facts
- **WHEN** 系统就某个未归档候选发起确认
- **THEN** 确认信息 SHALL 包含源 Session id、任务分支、worktree 路径与已判定的合入/洁净状态，且 MUST NOT 以概括表述替代具体候选标识

### Requirement: Archiving is never proposed to mask an unresolved safety gate
系统 SHALL 仅对"除未归档、以及该候选自身源 Session 仍处于加载状态之外，全部既有安全门均可通过"的候选提出归档确认。任务分支未证明合入、worktree dirty、operation 非 prepared、binding 损坏、schema 不受支持，或有活动 Session 的当前工作目录位于该 worktree 之内时，系统 MUST 先按既有原因拒绝该候选，MUST NOT 就其发起归档确认，也 MUST NOT 因归档而弱化上述任何安全门。

"候选自身源 Session 仍加载"之所以不阻塞提议：归档只将 Session 加入归档集，从不卸载它，因此该门在收尾流程中永远不会自行清除；若保持武装，任何 Session 都无法收尾自己的 worktree —— 那是死锁而非防护。该豁免 MUST 严格限定为"用户在本次调用中明确确认收尾的那一个源 Session"，MUST NOT 扩展到其他 Session，更 MUST NOT 豁免"有会话正站在该 worktree 内"这一判定。

预览（`dry_run`）MUST NOT 发起任何确认，也 MUST NOT 归档任何 Session：调用方要的是"真实执行会发生什么"，而不是就此开始执行。预览 SHALL 对未归档候选照常报告 `not-archived` 原因，使用户据此得知真实执行时将被询问的内容。

#### Scenario: A dry run neither confirms nor archives
- **WHEN** 以 `dry_run` 预览方式发起仓库级清理，且存在未归档但其余安全门均通过的候选
- **THEN** 系统 MUST NOT 就该候选发起确认，MUST NOT 归档任何 Session，并 SHALL 按既有 `not-archived` 原因报告该候选

#### Scenario: Unmerged or dirty candidate is refused without an offer
- **WHEN** 未归档候选的任务分支未证明合入，或其 worktree 存在未提交修改
- **THEN** 系统 SHALL 按既有原因拒绝该候选，且 MUST NOT 发起归档确认

#### Scenario: A Session may finish its own worktree while still loaded
- **WHEN** 未归档候选的唯一活跃占用是其自身源 Session 仍处于加载状态，且没有任何会话的当前工作目录位于该 worktree 之内
- **THEN** 系统 SHALL 发起归档确认；用户确认后 SHALL 先归档再清理该候选

#### Scenario: An occupant inside the worktree is never waived
- **WHEN** 有活动 DSH Session 的当前工作目录位于该 worktree 之内，或调用方当前执行根即该 worktree
- **THEN** 系统 SHALL 按既有原因拒绝，MUST NOT 发起归档确认，且该判定 MUST NOT 因用户确认收尾而被豁免

#### Scenario: Archiving does not bypass gates re-evaluated at clean time
- **WHEN** 用户确认并完成归档后，清理阶段重新校验时某个安全门不再通过
- **THEN** 系统 SHALL 按该安全门拒绝清理并报告原因，MUST NOT 因已归档而放行

### Requirement: Archive and clean failures are reported per candidate without false consistency
归档失败时，系统 SHALL 报告该候选的归档失败原因并保持其 Git 资源不变。归档成功但随后清理被拒绝或失败时，系统 SHALL 如实报告清理未完成，并 MUST NOT 把该候选汇报为已清理；已完成的归档 MUST NOT 被伪造回滚，用户可通过既有取消归档路径恢复。每个候选的确认、归档与清理相互独立，任一候选失败 MUST NOT 阻止其他候选被判定。

#### Scenario: Archive fails
- **WHEN** 用户确认后归档调用失败
- **THEN** 系统 SHALL 报告归档失败原因，保持该候选的 worktree、分支与 operation 不变，并继续判定其余候选

#### Scenario: Archived but clean refused
- **WHEN** 归档成功，但随后的清理被安全门拒绝
- **THEN** 系统 SHALL 报告该候选清理未完成及其原因，MUST NOT 汇报为已清理，且保留已归档状态供用户按既有路径处置

#### Scenario: One candidate's failure does not block others
- **WHEN** 同一次调用中一个候选的确认或归档失败，另有候选满足条件
- **THEN** 系统 SHALL 独立完成其余合格候选的判定与清理，并在同一汇总中分别报告

### Requirement: Operator CLI keeps its non-interactive refusal
显式路径 `dsh-ws` operator CLI 与 Skill shell wrapper MUST NOT 获得归档能力：它们没有可信的用户确认通道。这些入口遇到未归档候选时 SHALL 保持既有拒绝与诊断，由 operator 自行决定归档与否。

#### Scenario: Operator CLI encounters an unarchived candidate
- **WHEN** operator 通过 `dsh-ws clean` 处理源 Session 未归档的 operation
- **THEN** 系统 SHALL 按既有 `not-archived` 语义拒绝，MUST NOT 归档该 Session，也 MUST NOT 发起任何确认

### Requirement: Merge proof accepts patch equivalence after a rebase
系统 SHALL 在证明任务分支已合入时接受两种独立依据：普通 Git 祖先关系（任务分支 head 是 base ref 的祖先），或**全量 patch 等价**（该分支相对 base ref 的每一个 commit，在上游都存在 patch-id 等价的 commit）。任一依据成立即 SHALL 视为已证明合入。两种依据均不成立时，系统 MUST 保持既有拒绝语义，不得清理任何资源。

patch 等价之所以必要：rebase 会重写 commit hash，使已经落地的工作不再是上游的祖先。此时仅凭祖先关系判定会把"内容已在主干"误判为"未合入"，导致已完成的 worktree 永远无法清理。

#### Scenario: Ancestor relationship still proves merge
- **WHEN** 任务分支 head 是 base ref 的祖先
- **THEN** 系统 SHALL 判定已合入，无需再做 patch 等价判定

#### Scenario: Rebase rewrote the commits but every patch exists upstream
- **WHEN** 任务分支不是 base ref 的祖先，但其相对 base ref 的每个 commit 在上游都有 patch-id 等价的 commit
- **THEN** 系统 SHALL 判定已合入，并允许后续安全门继续评估该候选

#### Scenario: Any commit without an upstream equivalent refuses
- **WHEN** 任务分支存在至少一个在上游没有 patch-id 等价物的 commit
- **THEN** 系统 SHALL 按既有"未证明合入"拒绝该候选，MUST NOT 删除其 worktree 或分支

#### Scenario: A branch with no commits of its own
- **WHEN** 任务分支相对 base ref 没有任何独有 commit
- **THEN** 系统 SHALL 判定已合入（没有任何未落地的工作），与祖先关系判定结论一致

### Requirement: Branch deletion carries out the proof that was established
删除任务分支时，系统 SHALL 采用与所用合入证明相符的删除方式：以 patch 等价证明合入的分支 MUST NOT 因 Git 自身只认祖先关系而删除失败；以祖先关系证明的分支 SHALL 继续使用 Git 的安全删除，保留其独立复核。任一情形下，清理成功 MUST 同时移除 worktree 与本地任务分支，不得留下"worktree 已删、分支残留、生命周期未推进"的中间状态。

#### Scenario: A rebased branch is actually deleted
- **WHEN** 候选以 patch 等价被证明合入，且通过全部安全门后执行真实清理
- **THEN** 系统 SHALL 同时移除其 worktree 与本地任务分支，并将 operation 推进至 cleaned

#### Scenario: An ancestry-proven branch keeps Git's own check
- **WHEN** 候选以祖先关系被证明合入并执行真实清理
- **THEN** 系统 SHALL 使用 Git 的安全删除方式，使 Git 的合入判定作为一次独立复核仍然生效

### Requirement: The clean result states which merge proof was used
清理结果 SHALL 标明该候选的合入判定所依据的是祖先关系还是 patch 等价，使"为何判定为已合入"可被复核。dry-run 与实际清理 MUST 报告同一依据。

#### Scenario: Result distinguishes the two proofs
- **WHEN** 一个候选分别以祖先关系、以 patch 等价被判定为已合入
- **THEN** 两次结果 SHALL 分别标明其所用依据，且 MUST NOT 以同一表述掩盖差异

### Requirement: Explicit-path operator maintenance remains compatible
本 change MUST 不改变显式路径 `dsh-ws status|promote|clean` operator CLI 的目标解析和既有安全门；仓库级批量扫描 SHALL 仅适用于模型可见、由受信 Host 调用上下文发起的 `ws clean`。

#### Scenario: Operator invokes explicit-path cleanup
- **WHEN** operator 使用 `dsh-ws clean [--dry-run] <worktree-path>`
- **THEN** 系统 SHALL 按既有单 operation 路径语义和安全门处理，不自动扫描仓库中的其他 Worktree Session

