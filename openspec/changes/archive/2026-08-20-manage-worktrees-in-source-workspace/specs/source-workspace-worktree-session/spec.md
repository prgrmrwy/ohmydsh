## Purpose

定义 Worktree Session 在不创建额外 DSH Workspace 的前提下，将源 Workspace 内的 Session 持久绑定到隔离 Git worktree、约束 Agent 执行根并保留历史归属的可观察行为。

## ADDED Requirements

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
安全清理 SHALL 只移除已证明可丢弃的 worktree 运行资源和 task branch，并将持久绑定标记为 cleaned。系统 MUST 保留原 Session、其归档状态和源 Workspace 归属，且不得将其移动到“未分组”。

#### Scenario: Clean an archived completed Session
- **WHEN** 绑定 Session 已归档、worktree 干净、无活动执行且 task branch 已被普通 Git ancestry 证明合并
- **THEN** 系统 SHALL 删除 worktree 和安全可删的本地 task branch、标记绑定已清理，并保留 Session 在源 Workspace 下的历史记录

#### Scenario: Reopen a cleaned historical Session
- **WHEN** 用户重新打开已经 cleaned 的历史 Session
- **THEN** 系统 SHALL 表明旧执行目录已不存在、拒绝继续写入旧路径，并指导用户创建新的 Worktree Session 继续开发

#### Scenario: Cleanup safety cannot be proven
- **WHEN** worktree 当前活跃、dirty、operation in-flight、调用者位于目标 worktree 或合并证明不足
- **THEN** 系统 SHALL 拒绝清理且不得强制删除 Session、worktree 或 branch

### Requirement: Existing independent Workspace records remain compatible
升级前由旧流程创建的独立 worktree Workspace/Session SHALL 保持可访问。新版本 MUST 不自动迁移、重绑定、删除或重命名这些实体；兼容维护仍 SHALL 能从既有 operation metadata 识别其 worktree。

#### Scenario: Upgrade with an existing target Workspace
- **WHEN** 用户升级时存在旧流程创建的 worktree Workspace 和目标 Session
- **THEN** 系统 SHALL 保持其 Workspace/Session 注册和历史不变，并仅对升级后新启动的 Worktree Session 使用源 Workspace 托管模式

#### Scenario: Maintain an old-format operation
- **WHEN** `ws status`、promote 或 clean 接收一个旧格式 operation 对应的 worktree
- **THEN** 系统 SHALL 在不伪造源 Session 绑定的情况下继续执行兼容的安全维护，或以明确的版本诊断拒绝不安全操作
