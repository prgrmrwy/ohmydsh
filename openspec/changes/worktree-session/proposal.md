# Worktree Session（WS）

## Why

当前在同一仓库并行启动多个 DSH 编码会话时，会话默认共享同一 checkout、依赖安装结果与 ohmydsh 物化目标，容易发生文件互踩、依赖状态串线和并行 `dsh build` 覆盖。需要一个类似 Claude Code `--worktree` 的首页启动能力：用户先选择 base、勾选 Worktree，再以第一次发送作为原子启动动作，让真正执行任务的 Agent 从出生起就在隔离 worktree 中工作。

## What Changes

- 新增本地 DSH package `worktree-session`（简称 WS），提供 Host + Web Client 双端能力，并作为仓库定制由 `dsh.yaml` 管理和物化。
- 在首页空白 Session 的输入框工具行显示 base branch 选择器和 `Worktree` 开关；不修改侧边栏“新建会话”入口。
- Worktree 未勾选时完全沿用 DSH 官方发送路径；勾选后，仅接管该空白 Session 的第一次发送。
- 第一次发送时按顺序完成：冻结首条输入 → 基于所选 base 创建独立 task branch 与 worktree → 执行当前仓库的 npm lean 初始化和本地环境同步 → 为开发构建分配隔离的 `DSH_HOME` → 注册 DSH Workspace → 以 worktree 为 cwd 创建目标空白 Session → 迁移并提交首条输入。目标 Agent 的第一轮不得早于 worktree/setup 完成。
- 首次启动任一步骤失败时不得把消息降级发送到原 checkout；保留原输入和 Worktree 选择，报告失败阶段并允许幂等重试或由用户显式关闭 Worktree。
- 提供 `/ws` skill/命令面用于查看依赖隔离状态、将 lean worktree 提升为 mutable、以及安全清理已完成 worktree；清理不得静默丢弃未提交或未合并工作。
- 首版只适配当前 ohmydsh 仓库：npm 根依赖、`node_modules` lean 复用、`.env.local` 本地环境同步、独立开发构建 `DSH_HOME`。通用多仓 adapter 与由 LLM 识别仓库并生成配置的 `/ws setup` 记入本 change 的 deferred backlog，不进入 MVP。
- 借鉴 MIT 项目 `LaoYueHanNi/dsh-git-worktree` 的输入框分支 UI、Git 探测和 Workspace 跳转模式，但将“选择目标分支后立即创建/切换”改为“选择 base，首次发送时创建新的 task branch/worktree”；不提供对主 checkout 的原地 `git switch`。

## Capabilities

### New Capabilities

- `worktree-session`: 首页 Worktree 启动选择、首次发送事务、task branch/worktree 生命周期、当前仓库 lean/mutable 依赖隔离、开发构建环境隔离及安全恢复/清理的行为契约。

### Modified Capabilities

- （无）现有 `repo-layout` 已定义本地 package 定制的 manifest、bundle 与 sync 规则；本 change 依照该契约新增一个 package，不改变既有需求。

## Impact

- 新增 `packages/worktree-session/`：Host Git/依赖/session 编排服务、Web Client 输入框控件与首次发送接管、共享 wire contract、测试和 bundle patch。
- 新增 `skills/ws/`：`/ws status`、`/ws promote`、`/ws clean` 等操作指导；`/ws setup` 仅记录为 deferred backlog。
- 修改 `dsh.yaml`：登记并启用本地 `worktree-session` package 与 `ws` skill，使用独立版本 pin。
- 修改 `.gitignore` 或 Git-local exclude 初始化策略：避免仓库内 worktree/session 临时目录进入版本控制。
- 影响 Git 工作区、DSH Workspace/Session 创建、npm 依赖目录、`.env.local` 副本及隔离的开发构建 `DSH_HOME`；不得隐式写入/部署到当前运行 GUI 的真实 `~/.dsh`。
- 参考依赖：`LaoYueHanNi/dsh-git-worktree`（MIT）仅作为实现与交互参考，需保留来源/许可记录；不要求运行时依赖该插件。
