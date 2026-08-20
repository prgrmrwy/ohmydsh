# sidebar-session-provider-icon — Design

## Context

动机见 proposal.md。现状约束（均已源码核实）：

- Web 侧边栏的 session 行由官方 `@deepseek-ai/dsh-client-ui-workspace` 渲染（`SessionNodeItem`），行结构固定为 `[状态点 slot][标题][时间][行菜单]`，**没有 per-session-row 的 slot 注入点**（已安装 rc.7 与 GitHub master rc.8 的 `Rows.tsx` 均确认）。社区 `dsh-sentinel` 使用的 `sidebar.workspaces.sessionRow.branch` 依赖官方不存在的 `betterSidebar` 服务契约，装上也不渲染。
- 数据面存在官方标准通道：`@deepseek-ai/dsh-session-projection` 的 `SessionProjectionMap` 是 **declaration-merge 可扩展**的 projection 表，host 侧注册单元后，框架订阅/驱动、持久化缓存（`(sessionId, key, ver, seq, val)`）、随列表帧下发到 `SessionSummary.projectionValues`。官方 `title` / `sessionStats` / `tokenUsage` 均走此路。
- provider/model 的真相源：session 日志的 `request/header` 事件携带 `EpochHeader.config`（`LlmCallConfig { provider, model, … }`），且**只在路由/容量变化时 append**（canonical equality），因此 fold 到最新一条 `request/header` 即"最后一次实际请求"的路由。`assistant/message` 不直接携带 provider。

## Goals / Non-Goals

**Goals:**
- 用官方 projection 通道（不引入新 API/协议）让 host 侧为每个会话维护 `provider` 投影值并流到客户端。
- 在侧边栏 session 行标题前渲染动态 provider logo，切 provider / 重启后依然准确，不存 localStorage。
- 将 DOM 结构依赖**收敛到单一模块**，使升级时只修一处、失败无害降级。

**Non-Goals:**
- 不实现"影子替换整个 sidebar.workspaces"（organizer-sidebar 的 `priority:-2` 做法）。
- 不修改官方 `sessionRow` 渲染的任何既有元素；`StateDot` 状态点保持只读原样。
- 不做 per-session provider 的选择页/管理 UI；不处理模型能力差异（视觉路由等）——那是别的 capability。
- 无 provider 值的行不做任何插入修改（避免空行占位跳动）。

## Decisions

### D1 数据单元：host 侧注册 `provider` session-projection 键
在自研 host 侧注册一个 `ProjectionDefinition`，键 `provider`、`stateVersion: 1`：
- `init()` → `{ provider: string | null, model: string | null }`（空日志无值）。
- `apply(state, event)` → 仅对 `event.type === 'request/header'` 更新为 `{ provider: header.config.provider, model: header.config.model }`；其它事件原引用返回（零下游工作）。这是纯同步折叠，满足 projection 单元契约（MUST 同步、state 必须 plain JSON）。
- `view(state)` → 无 provider 时返回 `null`（`provider: null`），否则返回 `{ provider, model }`；schema 用 zod 校验。
- 由 `ctx.inject(['sessionProjections'], …)` 注册，headless 组合无服务时不受影响（官方约定）。

**为什么选它**：官方投影通道自动处理订阅/驱动/持久化缓存/帧下发，重启后 host 用缓存+日志尾巴重 fold，所有历史会话的 provider 都可用——客户端零计算、零 localStorage。**替代方案**：
- 客户端逐会话打开读 `conversation.requestConfig`：要为每个历史会话拉历史、成本高且不持久；
- 客户端 localStorage 记录：换浏览器/清缓存即丢，且与"真相在 host 日志"的模型相悖。
两者均被否。

### D2 渲染：轻量 DOM 注入 + `row-locator` 模块（不用影子替换）
新增 web client 插件：
- 订阅 `ctx.sessions.list`（每行 summary 已带 `projectionValues.provider`），维护 `sessionId → provider` 映射。
- 用 `MutationObserver` 观察侧边栏 session 树区（`sidebar.workspaces` 渲染所在节点），在**新出现的 session 行**上插入 logo；行被移除时同步清理。全部 DOM 结构知识收进 `src/client/row-locator.ts` 单一模块。
- row-locator 的定位策略（**不用 hashed 完整类名**）：
  1. 主锚：`[role="treeitem"]` 且类名以 `sessionRow` 结尾（CSS Modules 产物保留局部类名后缀 `…_sessionRow`，升级仅前缀 hash 变化时仍可命中；`projectRow`/folder 行作为排除条件）；
  2. 行识别后，取其标题 `span[class$="title"]` 文本，与 sessions.list 的 `displayTitle` 反查对应 `sessionId`（重复标题按行内已插入集合去重 + 顺序兜底）；
  3. 严苛失败时（无匹配行/结构异常）**安全不插**：不抛未捕获异常，不向错误行注入。
- 只在 `projectionValues.provider` 非空时插入；插入位置为标题文本前的一个独立 `<span>`（logo svg），**不影响状态点 / 时间 / 菜单 / 拖拽**。

**为什么选它**：官方无 per-row slot，能凑齐"每行一个动态图标且不动官方结构"的入口只有「替换整棵浏览器」或「DOM 注入」。替换整棵（D3）运维成本高、与官方功能脱节；DOM 注入最轻，且本项目 B010/B003 已有"复用社区轻量方案"先例。脆弱面用单一 `row-locator` + 降级策略兜底。

### D3（否决）影子替换 `sidebar.workspaces`
organizer-sidebar 用 `priority:-2` 把单槽位 `sidebar.workspaces` 整个顶替，需自建分组/搜索/拖拽/菜单/状态点。零 hack（用的是官方 declared slot），但把所有功能面拉入维护范围，官方每个版本加功能都要跟着抄，正是用户反感的"侵入性/可维护性"问题。**否决**，记录以证权衡。

### D4 provider → logo 映射与未知 provider
client 内置一小张「provider 名 → 内联 SVG」映射表，覆盖已知 provider（从 provider 名判断：`codex`/openai、`claude`/anthropic、`grok`/xAI、`deepseek` 等），用官方品牌 logo（用户确认无需考虑版权）。未知 provider 用中性 fallback（首字母圆标，避免误导）。logo 约 12~14px，`title` 属性带 provider/model 提示（若有 model）。

### D5 打包与接线
按 repo-layout：新增 `packages/sidebar-session-provider-icon/` 本地自研包（`dsh.bundle` + `cordis.patch.yml` + `src/`），manifest `dsh.yaml` 加一条 `source: local` 的 package 定制；client 面按官方 `dsh.client.platform: "web"` + `inject` 声明，host 面注册 projection 单元。走 `scripts/sync.mjs` + `dsh build` 物化，重启生效。

## Risks / Trade-offs

- **DOM 结构脆弱（升级风险）** → 全部收敛于 `row-locator`（单一改动点）；后缀锚 + 文本反查即可命中目标；定位失败一律静默降级为不显示，绝不误插/报错。
- **class 名完全重命名（css-modules 局部名改掉）** → row-locator 退化为 title 文本反查 + 行菜单锚点；仍失败则安全不显示（spec 已约定该降级）。
- **投影键长期归属** → `stateVersion: 1` 起步，后续决定变更时 bump，旧缓存自动丢弃。
- **重复标题会话反查错行** → 行内已插入集合去重 + 顺序兜底；错误注入的代价只是 logo 短暂错位，会被下一次观察修正。
- **注入导致布局抖动** → 无 provider 值不插；插入使用固定 14px 内联元素且不替换官方元素，布局影响仅标题前多 2~4px。

## Migration Plan

1. 实现本 change（包 + manifest 条目），commit 后 `node scripts/sync.mjs` + `dsh build` 物化到 `~/.dsh`。
2. 重启 DSH：确认 host 侧 projection 生效（`dsh --profile web --dump-config` 能看到新包行 / 日志无加载错误）、client 侧 sidebar 每行出现 logo。
3. 回滚：删 manifest 条目 + sync + 重启（plugin bundle 卸载即还原官方行渲染）；不改动任何官方文件。

## Open Questions

无。数据源（`request/header`）、投影表扩展点、渲染入口（DOM 注入）均已核实，spec/设计/任务无需再依赖未知项。
