# sidebar-session-provider-icon

## Why

接入订阅制 provider（codex / claude / grok）并与 DeepSeek 混用后，侧边栏里几十个历史会话各自用了哪个 provider，必须点进会话才看得到。用户希望在 sidebar 每行 session 标题前直接显示「该会话当前在用的 provider」的动态 logo，做到扫一眼侧边栏即可分辨会话归属，且切了模型/重启 DSH 后依然准确。

## What Changes

- Host 侧新增一个 `provider` session-projection 单元：折叠会话日志，维护并发布该会话**最后一次实际发送的 assistant 请求**的 provider + model 投影值，经官方 `session/projection` 帧流到每条 `SessionSummary.projectionValues`。
- Web client 新增一个 UI 插件：订阅 sessions 列表，在侧边栏每个 session 行的标题前渲染对应 provider 的官方 logo（12~14px 内联 SVG），随会话 provider 变化实时更新。
- 展示规则：空白 / 从未产生过 assistant 请求的 session 不显示 logo；provider 不可知时不显示（不消除占位导致行跳动，最大化不干扰）。
- **边界（用户明确要求）**：不得影响官方任务状态 `StateDot`（绿/黄/蓝状态点）——只读、不替换、不移动其位置；时间、右键菜单、拖拽排序等行内元素保持官方原样。
- 不采用影子替换整个 `sidebar.workspaces`（organizer-sidebar 的 `priority:-2` 做法）：侵入性/维护成本高、重画整套浏览器与官方升级脱节。

## Capabilities

### New Capabilities
- `sidebar-session-provider-icon`: 每行 session 的 provider logo 展示 —— host 侧 provider 投影值 + web 客户端轻量 DOM 注入渲染，且不触碰官方状态点。

### Modified Capabilities
<!-- 无。行为变化均落在新 capability 内，不改动既有 spec 的需求。 -->

## Impact

- 本仓库自研包：新增 `packages/sidebar-session-provider-icon/`（本地定制，host + client 双面 bundle）。
- `dsh.yaml` manifest：新增一条 `customizations` 本地 package 条目（`source: local`）。
- 数据面：`@deepseek-ai/dsh-session-projection` 的 `SessionProjectionMap` 通过 declaration merging 新增 `provider` 键（host 侧），client 侧经 `projectionValues` 读取；无 API/协议改动，官方 title/stats/token 同路。
- 渲染面：`@deepseek-ai/dsh-client-ui-workspace` session 行无 per-row slot（已核实 rc.7 与 master rc.8 `Rows.tsx`），故在官方行 DOM 上只读注入 logo；全部 DOM 结构依赖收进独立 `row-locator` 模块，升级只修一处。
- 不影响既有插件（cost-meter / subscriptions / worktree-session 等），不触碰 sandbox / approval / 模型请求面。
