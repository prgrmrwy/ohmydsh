## Why

DSH 中缺少一个始终贴近当前工作现场、又不污染源研发会话的轻量 Agent 入口。用户需要从任意当前会话或无会话状态快速发起 Create MR、Send CR、Clean Worktree 等任务，并让这些任务复用本机 DSH 的 Agent、Skill、工具和订阅 provider，同时保持来源、执行过程和后续归档关系清晰可追溯。

## What Changes

- 在 `packages/dsh-pet/` 新增可独立构建安装的 DSH Pet Host+Web 双半区插件，并由 `dsh.yaml` 作为本仓部署真相源进行显式启停；Host 服务随 `dsh web` 同进程启动，Web 客户端在 `shell.overlay` 提供可拖动的常驻桌宠、快捷能力轮盘、任务面板和设置入口。
- 新增 Pet 自有持久化模型和状态目录，保存 Pet Task、Invocation、每次调用位置的 source snapshot、executor DSH session 以及归档关系；DSH session 标题和启动消息仅作为关联关系的可见投影。
- 为每个来源 scope 维护至多一个未归档 Pet Task；该 Task 固定复用一个位于专用 `DSH Pet` Workspace 的普通 DSH executor session。归档后，同一来源的下一次调用创建新的 Task epoch 和 executor session。
- 每次从桌宠调用能力时创建新的 Invocation 并立即固定当时的 source session/workspace/worktree 快照；页面随后切换不得改变已创建 Invocation 的上下文。
- 支持 `session`、`workspace` 和 `none` 三类来源。能力声明上下文要求；没有 active session 时不得隐式使用最近会话，允许用户从无关联上下文发起独立 Pet Task。
- 新增显式 Pet Skill 管理：一期仅允许安装 manifest 声明的随包内置 Skill 或从 Host 本地目录复制导入的 Skill bundle；Pet 在自有状态目录保存不可变 revision，并通过 Pet 创建、目标受限于 immutable store 的目录软链，只把显式启用的版本投影到 Pet Workspace 的 `.dsh/skills`。Pet Agent 的 catalog、loader 和显式调用均按 allowlist fail-closed，不从 DSH 全局 Skill 发现结果自动扩展能力。
- 新增 Pet Agent 前馈与可信上下文边界：executor session 使用 Pet 专用 standing instructions，每次 Invocation 收到动态 envelope，并通过无参数的 Pet 上下文工具按调用 executor session 反查当前 Invocation 和快照。
- 一期复用同一 DSH Host 的 Agent Loop、Tools、审批交互和 subscription providers，并通过 Pet 受管 Skill catalog 加载明确安装的 Skill；不引入 Pi、ACP、cc-connect 或独立 Pet daemon。首批内置能力覆盖 Create MR、Send CR 和 Clean Worktree 的 Agent 驱动流程。
- 固定 Pet Web 信息架构：浮层和 Task 面板只负责快速调用、来源确认与 Task/Invocation 操作；DSH Settings 中的 Pet section 使用 General、Skills、Bindings、Diagnostics 四页签负责持久配置、Skill 安装与同步、可信绑定和诊断修复。
- 新增 Task 与 executor session 的最小归档联动：source session 归档只更新来源状态；终态 executor session 与对应 Task 可双向同步归档；归档不删除 Task 数据或 DSH session log。
- 为后续 Channel Binding 和受限回复工具保留演进边界，但一期不实现飞书入站 transport、多设备同 bot 路由或 Cockpit Pet Hub。

## Capabilities

### New Capabilities
- `dsh-pet`: DSH Pet 的常驻插件 UI、Pet Task/Invocation/snapshot 模型、普通 DSH executor session 复用、可信源上下文、Agent 能力启动、任务聚合和归档联动。

### Modified Capabilities

无。

## Impact

- 新增本仓 local package `packages/dsh-pet/`、对应 `dsh.yaml` customization、package tests/README 和同步/构建验收；插件运行时不依赖 ohmydsh 脚本，但本机安装、启停和升级只以 ohmydsh manifest 为真相源。
- 依赖 DSH Web 的官方插件加载、`shell.overlay`/Settings slots、sessions/workspaces 客户端服务、Host session/agent/workspace/settings/storage 能力，以及当前 Web profile 已注册的 LLM providers；本仓现有 `worktree-session` 和 subscription customizations 是可选集成点而不是凭据复制源。
- 新增 Pet 专用 Host 工具和内部管理接口，能够创建和 prompt 普通 DSH session，并原子安装、启停和软链投影 Pet Skill；不得向 Cockpit 暴露任意 DSH RPC，也不改变 Cockpit 既有操作面零协议耦合和统筹面只读原则。
- Pet 状态位于 `$DSH_HOME/plugins/dsh-pet/`；受管 Skill store 位于该状态目录，启用版本通过受管目录软链投影到 Pet Workspace 的 `.dsh/skills`。可见的 executor sessions 统一归入独立 `DSH Pet` Workspace，不使用插件安装目录作为运行目录。
- 一期不修改 dsh-cockpit 仓、远端设备要求、Cockpit 页面或现有 `dsh-cockpit-bridge` 数据契约；跨设备 Pet Hub/共享 Bot/统筹聚合出现时才在 dsh-cockpit 新建独立 change。
