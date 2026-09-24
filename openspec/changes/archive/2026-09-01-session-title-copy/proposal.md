# session-title-copy

## Why

对话区 header 的面包屑（会话层级）中，当前会话标题是一个 `disabled` 按钮且 `cursor: default`，点击没有任何反馈。开发/调试（引用 cockpit、脚本、日志排查）时经常需要当前 session id，当前只能去设置或日志翻找。让标题可点击复制当前 session id，并把悬停指针改为 pointer，是低成本、高频收益的小改动。

## What Changes

- 新增本地 Web client 包 `dsh-session-title-copy`：订阅官方 sessions list（`ctx.sessions.list`，与 dsh-cockpit-bridge 同源），定位对话 header 面包屑中当前会话标题（最后一个 crumb 按钮），点击将当前 session id 复制到剪贴板，并显示瞬态「已复制」提示。
- 当前会话标题 hover 显示 `cursor: pointer`，并恢复官方 crumb 的悬停底色（移除 disabled 后自然生效）。
- 祖先面包屑行为不变（点击打开对应历史会话）；只有当前会话标题（最后一项）参与复制。
- 安全降级：官方 DOM 结构变化导致无法定位时，不注入、不抛未捕获异常；剪贴板失败静默；插件不发起网络请求。
- **BREAKING**：无。本次不修改 DSH core，不引入 host 端能力，仅 Web client 注入。

## Capabilities

### New Capabilities
- `session-title-copy`: Web GUI 对话区会话标题点击复制当前 session id 与 hover pointer 交互；以官方 sessions list 为 id 真相源，DOM 知识隔离在 locator 模块，官方结构变化时安全降级。

### Modified Capabilities
<!-- 无。 -->

## Impact

- 新增 `packages/session-title-copy/`（host 空入口 + Web client bundle）；`dsh.yaml` 增加 local customization 条目；需 `dsh build` 物化到 profile 并重启 DSH 后经 client-modules scanner 加载。
- peer 依赖仅 `@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-client-runtime`（client `sessions` 服务），不新增 host 服务/权限面。
- 对官方 UI 的最小 DOM 改造：当前标题 crumb 移除 `disabled` 并拦截其默认 click（防止 React 的 `open(current)` 重新导航），其余元素只读。
