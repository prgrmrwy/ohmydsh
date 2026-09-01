# Changelog

## 0.1.1 — 2026-09-01

- 实机反馈修订（openspec change `session-title-id-badge`）：交互从「点击标题复制」改为「标题右侧 6 位 ID 徽标」——标题**恢复官方原样**（disabled、cursor default，不再移除/拦截），不为面包屑导航控件引入点击语义。
- 徽标：显示当前 session id 去 `session-` 前缀后的前 6 位（如 `session-9af69be9-…` → `9af69b`），hover pointer + 底色，tooltip 展示完整 id；点击复制**完整**当前 session id + 「会话 ID 已复制」瞬态提示。
- 插入点：官方 titleCluster 内面包屑 nav 之后（`insertBefore`），自有标记 `data-dsh-session-title-copy-badge`；`MutationObserver` + sessions 订阅 rAF 防抖 reconcile（存在即更新 / 缺失即创建+接线），标题区重建/会话切换幂等跟随；无标题区/结构未知清除残留徽标。
- 边界不变：祖先面包屑「点击打开」不动；DOM 结构知识单文件 `title-locator.ts`；定位失败/剪贴板拒绝安全降级；无 host 能力、无网络请求。

## 0.1.0 — 2026-09-01

- 首个版本：Web client 插件，对话区 header 当前会话标题点击复制当前 session id，hover 显示 pointer 指针 + 官方 crumb 悬停底色，复制成功显示瞬态「会话 ID 已复制」提示。
- 数据链路：订阅官方 `sessions` list store（`current` 为 id 真相源，与 dsh-cockpit-bridge 同 seam），无 host 端能力、无网络请求。
- 交互机制：移除标题 crumb 的 `disabled`（官方抑制事件）并在按钮上注册 capture 阶段 click 拦截 `stopPropagation()`，避免 React 委托的 `open(current)` 重新打开当前会话；`MutationObserver` + sessions 订阅挂 rAF 防抖 reconcile，幂等打标记（`data-dsh-session-title-copy`）。
- 边界：只改当前标题一个按钮，祖先面包屑「点击打开」行为不变；DOM 结构知识隔离于 `title-locator.ts`；定位失败/剪贴板拒绝安全降级。
- 对应 openspec change `session-title-copy`、backlog B018。
