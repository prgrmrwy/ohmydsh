## Why

当前 DSH Web GUI 只能控制本机单一 Host；VM、未来 devbox 上的 Claude/GPT 等订阅、workspace、session 与文件系统彼此隔离，用户必须切换隧道和页面才能管理。需要在不搬运订阅凭据、不共享磁盘、不改变远端执行归属的前提下，把本机 DSH 建成多节点统一控制台。

## What Changes

- 新增自研双面 package `dsh-federation`，本机 DSH 作为联邦控制面，远端保持普通 `dsh web` Host。
- 新增 GUI 节点注册与私有持久化；节点通过已预验证的 OpenSSH alias 接入，中央管理本地转发、健康探测、断线重连与分级诊断。
- 新增稳定联邦领域层，以版本化复合 ID 隔离各节点的 workspace/session 身份，并把 DSH rc.2 wire 变化收敛在中央和远端薄 Adapter 中。
- 事务性接管中央 DSH 的 workspace/session API 与事件投影：Host route 冲突按进程整体回滚；浏览器联邦 UI 按 Client 独立提交或回退官方单机界面，一个 tab 失败不影响其他 tab。
- 替换中央 GUI 的 Workspace 浏览区与空白会话 Workspace Picker，提供完整 `Node → Workspace → Session` 树；联邦插件自研 Node 外壳和跨节点编排，通过版本固定的 rc.2 Workspace Embed 兼容层复用官方 Workspace/Session 子树、行、store 与拖拽实现。
- 允许中央浏览和注册远端 Host 的真实目录为 workspace；目录、工具、Git、会话日志、模型及订阅凭据始终留在所属节点。
- 保留 This Mac 的全部官方和现有扩展体验；远端扩展操作按节点能力显示，禁止把本机路径动作错误用于远端。
- V1 仅支持人工通过统一 GUI 操作远端会话；不包含中央 Agent 自动委派、team 编排、跨节点 session 迁移、文件同步、共享磁盘或远端设置/凭据代理。

## Capabilities

### New Capabilities

- `federated-node-connectivity`: GUI 节点注册、OpenSSH 信任与隧道、节点状态、兼容探测、重连和安全生命周期。
- `federated-workspace-sessions`: 联合身份、Node/Workspace/Session 投影、远端 workspace/session 操作、事件对账和写操作交付语义。
- `federated-control-ui`: 完整联邦侧栏与 Workspace Picker、跨节点搜索、节点内排序/拖拽规则、本机行为等价与按能力扩展。
- `federated-activation-safety`: API 接管的原子激活、冲突回滚、官方单机逃生门、错误分类和诊断。

### Modified Capabilities

- `sidebar-session-provider-icon`: 联邦侧栏启用时，provider logo 从依赖官方行 DOM 的注入改为正式 Session Row 渲染能力，同时维持模型真相源、品牌映射及不干扰状态点的行为。

## Impact

- 新增 `packages/dsh-federation/` 双面 package，并在 `dsh.yaml` 中作为 local customization 管理；同时新增 rc.2 Workspace Embed 构建期兼容 patch，固定上游 commit `b150a551…`、提交 blob/hash provenance、可重放且不 vendor 生成 bundle。节点实例保存在 `$DSH_HOME/plugins/dsh-federation/nodes.json`，不进入 Git。
- 影响 DSH Web Host 的 `/api/session.*`、`/api/workspace.*`、`/api/respond` 等 route 组合，并新增一个固定源码/hash 的 rc.2 Connection compatibility patch，使联邦能在原 Host/Origin fence 内、Typert-first composed handler 外执行 generic `fed1:` route-or-reject；同时影响浏览器端 session/workspace event bridge、`sidebar.workspaces` 与 `conversation.hero.workspace` slots。
- 依赖系统 OpenSSH、现有 DSH rc.2 Host API、HTTP/WebSocket 双事件流和目录浏览能力；不增加远端插件或第二套控制平台。
- 需要与 `sidebar-session-provider-icon`、`dsh-open-in-vscode`、`ui-archive-manager`、`worktree-session` 及现有 UI 插件完成兼容回归。
- 设计参考 MIT 社区项目 `Asaiuta/dsh-session-hub` 的多 Host 网关模型和已知事件踩坑，但不把它作为运行时依赖，也不复制其内部架构。
