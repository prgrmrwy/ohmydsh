## ADDED Requirements

### Requirement: Project type is resolved before any Worktree resource is created
系统 SHALL 在创建任何 operation 文件、task branch、worktree 或绑定之前，依据仓库根目录的 lockfile 解析项目类型：存在 `package-lock.json`（npm）、存在 `pnpm-lock.yaml`（pnpm）。二者同时存在或均不存在时，系统 SHALL 在创建任何资源前拒绝请求并返回明确诊断；被拒绝的请求 MUST NOT 创建或修改任何 Git 资源、operation 文件或绑定，且不发送首条消息。

#### Scenario: Unsupported project refuses before any resource
- **WHEN** 空白 Session 的仓库根目录既无 `package-lock.json` 也无 `pnpm-lock.yaml`，用户启用 Worktree 并发送首条消息
- **THEN** 系统 SHALL 返回明确的 `UNSUPPORTED_PROJECT` 诊断（说明仅支持 npm/pnpm 锁文件项目），且不创建 task branch、worktree、operation 文件或绑定

#### Scenario: Mixed lockfiles refuse with a clear diagnostic
- **WHEN** 仓库根目录同时存在 `package-lock.json` 与 `pnpm-lock.yaml`
- **THEN** 系统 SHALL 在创建任何资源前拒绝请求并返回明确诊断，且不创建 task branch、worktree、operation 文件或绑定

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

## MODIFIED Requirements

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
