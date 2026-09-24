# DSH 记忆设置页：工作区 ↔ 记忆库 ↔ 远端存储

## Why

`dsh-memex` 的 Host 半区已经完成并归档（change `dsh-memex-scoped-memory`），但它是**纯 Host bundle**：
没有 Web 半区，因此设置面板里没有它的座位，全部配置只能手改 `~/.dsh/settings.yaml`。

实测后果（2026-09-20 用真实 resolver + 部署配置扫描本机）：

- **12 个真实工作区里只有 3 个在显式配置里**，其余要么自动派生成机器名库，要么落进 `personal`；
- **`personal` 已经配了远端**（`github.com:prgrmrwy/dsh-memex`，auto on），而它同时是 no-repo 目录的 `fallback`
  —— 于是 `~/Documents/learning`、pet workspace 这类无仓库目录写下的卡片会被自动推送到那个仓；
- **配置名与派生名可以不一致**：同一仓库在声明路径下是 `flow-web-monorepo`，仓外副本派生出来却是
  `flow-flow-web-monorepo`，同一个项目分裂成两个库；
- **派生出来的库不在配置里**（`list()` 里是 `discovered`、`publishKnown=false`），既看不见，
  又会让每次外部写入都带上 `configuration:known-scope-publish-unknown` 告警；
- 会话开始注入的那行 `Current memory scope / Library` 是唯一的路由反馈，且改配置后不会刷新
  —— 本次探索中它显示 `ohmydsh` + 一个并不存在的仓内库路径，而磁盘配置解析出来是 `personal`。

**「这个工作区对应哪个记忆库、这个库推到哪里」是这套系统最需要被看见的一件事，而现在完全不可见。**

## What Changes

- **新增 Web 半区**，注册 `settings.section`（id `dsh-memex`，文案「记忆」，导航图标用本仓既有的
  有界 DOM 适配方式画 book，与 `dsh-pet` 的 `settings-nav-icon` 同法）。
- **页面只做一件事**：把「本地工作区 ↔ 记忆库 ↔ 远端存储」这条对应关系显示出来并可编辑。
  三个部分：工作区路径 / 库的本地路径（留空显示 `~/.dsh-memex/<name>` 占位，可复制）/ 远端存储
  （只读展示 remote · auto · last sync，可复制）。
- **新增一条只读 Host RPC 通道**，提供浏览器拿不到的事实：库是否存在与卡片数、`memex sync --status`
  的三项事实、memex CLI 版本、派生/未声明库清单、以及 `resolve(path)` 路径试解析。
- **远端写入按状态分流**：未配置的库 → `sync --init <url>`；**已配置的库不重新 init**，只提供
  立即同步 / 拉取 / auto 开关 / 换远端（单独动作 + 二次确认）。全部委托 memex CLI，系统自身不写库内文件。
- **BREAKING（行为变化）**：fallback 不再解析为 `personal`。无仓库目录改为**本地路径派生**出各自的库，
  位于 `~/.dsh-memex/<派生名>`，且不配置远端同步。`personal` 从此只服务于显式声明的工作区。
- **完整性约束**：同一 `home` 不得被两个 scope 共用；编辑时拦截并说明后果。
- **模型修正（BREAKING，2026-09-20 追加）**：把路由从「一个工作区恰好一个入口」改为
  「**一个工作区可关联多个入口，其中恰好一个是主入口**」。理由是归档 design 的 D3 自己写明
  「库的划分依据是**发布目标与访问权限**，而不是概念域」——同一个项目在发布方向不同时本就应有
  多个库（内部知识一个、可外发知识一个）。主入口承载当前 scope 与全部图级操作；附加入口在可达
  范围内但**默认不被读或写**（必须显式指名，否则每张卡都会自动复制进外部库）。
  今天同一路径前缀被两个 scope 声明时是**静默取声明顺序第一个**（实测），这正是要修掉的。
- **规范措辞拆分**：`dsh-memex-integration` 的「不注册与记忆无关的运维动作」按
  **模型面禁止 / 人面允许（仅显式动作）** 重写。

## Capabilities

### New Capabilities

- `dsh-memex-settings-ui`：设置页本身——页面契约（一行 = 一个记忆库、三个部分的语义）、可编辑与只读字段的边界、
  只读库事实通道的内容与失败语义、远端写入的状态分流与「不重建」保证、编辑时的完整性约束拦截、
  以及导航图标的适配边界（失败必须静默降级且页面自身完整）。

### Modified Capabilities

- `dsh-memex-scope`：fallback 规则由「解析为 `personal`」改为「按本地路径派生独立库且不配远端同步」；
  新增两条完整性约束；把「外部 worktree 经 remote 命中主仓」由无法判定的承诺改写成可判定的规则
  （依赖该仓库已被某 scope 以 remote 模式认领）。
- `dsh-memex-integration`：把「不注册与记忆无关的运维动作」的禁令限定在模型面，
  并为人面（设置页内由用户显式发起的远端配置）建立允许条件与边界。

## Impact

- **代码**：`packages/dsh-memex` 新增 Web 半区（`src/client/`、`dsh.client` 声明、tsdown client 构建、
  `exports["./client"]`）、新增只读 RPC 通道与 `contract.ts`、`resolve`/`knowled` 层新增本地派生与完整性校验。
- **清单**：`dsh.yaml` 中 `dsh-memex` 条目升级版本并更新 note（新增 Web 半区、图标适配、fallback 行为变化）。
- **部署**：`~/.dsh/settings.yaml` 的 `dsh-memex` 分节**无需迁移**（已声明的 3 个 scope 路由不变）；
  但 no-repo 目录的路由结果会变——这些目录下次写卡时落在新的本地库，历史卡片留在原库。
- **文档**：`docs/notes/dsh-memex-integration.md` 补充「fallback 不再落 `personal`」与远端写入的状态分流。
- **兼容性**：不改 DSH core、不引 patch；库与卡片格式不变；上游 memex 版本与调用契约不变。
- **回归面**：scope 解析（新增本地派生与两条完整性约束）、guard 的 known-scope 警告数量、
  工具返回值中的 `current` 路由、以及设置页在 RPC 不可达时的降级表现。
