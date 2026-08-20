## Why

当前 Worktree Session 将 worktree 路径注册为独立 DSH Workspace，虽然保证了原生 cwd 隔离，却把同一 Git 仓库的任务拆成多个顶层项目，并使归档、清理和历史 Session 归属复杂化。我们需要借鉴现有 `sw` 的单 Workspace 使用体验，在保留可恢复 worktree、lean/mutable 和安全维护能力的同时，让任务 Session 始终由源仓库 Workspace 统一管理。

## What Changes

- **BREAKING**：Worktree 首次提交不再创建目标 Workspace/Session，也不再迁移草稿；当前空白 Session 原地绑定创建完成的 `.worktrees/<task>`，然后沿当前 Session 的原始提交路径发送首条消息。
- 为每个托管 Session 持久记录 `sessionId → operation/worktreePath` 绑定，并在 Host 重启、Session resume/clear/compact 后恢复运行约束。
- 为托管 Session 注入一次稳定、内容去动态化的 runtime context，声明实际执行根和主 checkout 禁写规则；内容未变化时不得重复追加对话事件。
- 在 Session scope 对文件、搜索、Bash 及委派等工具执行做 fail-closed 路径保护，要求显式操作绑定 worktree；实时阶段、时间戳、dirty 状态和 lean/mutable 不进入稳定模型上下文。
- lean/mutable、branch、清理状态通过输入区状态 UI、operation metadata 和按需 `/ws status` 展示；`promote` 与 `clean` 继续复用现有安全门。
- 清理只移除已证明安全的 worktree、task branch 和运行资源；Session 及其归档归属仍保留在源 Workspace，历史 Session 重新打开时显示已清理状态而不进入“未分组”。
- 为升级前已创建的独立 Worktree Workspace/Session 定义兼容策略：不自动迁移或删除既有历史实体，新创建流程统一使用源 Workspace 托管模式。

## Capabilities

### New Capabilities

- `source-workspace-worktree-session`: 同一 Git 仓库内由源 DSH Workspace 统一管理 Worktree Session，包括原地首次提交、持久 Session 绑定、稳定上下文、工具路径保护、状态展示和清理后的历史归属。

### Modified Capabilities

- （无）基础规格尚未包含已完成但未归档的 `worktree-session` capability；本 change 以独立增量 capability 定义新的统一 Workspace 行为，并在设计中记录对现有实现的替代关系。

## Impact

- 修改 `packages/worktree-session/` 的 wire contract、Host operation/session binding、Client submit 编排、状态 UI、工具保护和测试；移除新流程对 `workspaces.create`、`connectWorkspace`、`sessions.open` 与跨 Session 草稿搬运的依赖。
- 扩展 operation metadata，以持久保存源 Session 绑定和 cleaned 历史状态；保持现有 Git、依赖缓存、环境隔离和仓库锁格式可兼容读取。
- 修改 `skills/ws/` 的状态、promote、clean 说明，使 Agent 默认从当前 Session 绑定解析目标 worktree，用户无需执行长命令。
- 需要验证 DSH rc.7 的 agent-scoped runtime context、`tools/pre-execute`/guard、Session lifecycle 和 runtime-context 去重语义；不得通过频繁变化的上下文破坏模型前缀缓存。
- 不修改 DSH 核心 Workspace 数据模型，不引入 Repository Group，也不自动迁移旧的独立 Workspace 历史记录。
