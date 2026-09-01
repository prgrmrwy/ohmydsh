# session-title-id-badge 设计

## Context

见 proposal.md - Why。现行实现（v0.1.0，change `2026-09-01-session-title-copy` 已归档）把当前标题 crumb 改造成点击复制，实机反馈三点：① 点击前不知道标题可点；② 看不到复制的是哪个会话；③ 面包屑是导航控件，点击语义违直觉。本次把交互对象从「标题按钮」换成「标题右侧自建徽标」，并完整恢复标题的官方行为。官方结构（rc.2 实机验证）：

```
header > div.titleRow > div.titleCluster
        ├─ nav[aria-label=session.hierarchy]   ← 面包屑(crumb 按钮,当前项 disabled)
        └─ div.headerActions                    ← Session log 等
```

## Goals / Non-Goals

**Goals:**
- 标题右侧展示当前 session id 的 6 位短标识，可识别「是哪个会话」。
- 点击徽标复制**完整** session id + toast；悬停 tooltip 展示完整 id。
- 标题恢复官方原样（disabled、cursor default），插件不再触碰标题。
- 官方 DOM 升级安全降级（不注入、不报错、不残留）不变。

**Non-Goals:**
- 不改官方客户端源码；不改祖先面包屑行为。
- 不做常驻复制图标之外的额外 UI（下拉、列表、多会话切换器）。
- 不新增 host 能力/网络请求；不引入依赖。

## Decisions

### D1. 徽标位置：titleCluster 内 nav 之后（面包屑与 headerActions 之间）
- 插入点为 `nav` 的 parentElement（titleCluster），`nav.insertAdjacentElement('afterend', badge)`：紧跟面包屑右侧，位于 Session log 按钮左侧，属于标题行自然延伸。
- 备选：插进最后一个 crumbSeg 内部 —— nav 有 `overflow:hidden` 且 crumb 有 `max-width:220px`，长标题下会被裁剪，不选；插进 headerActions —— 那是官方项集合，语义不当，不选。
- React 兼容性：titleCluster 的官方 children 固定为 [nav, headerActions]，我们用自有标记 + MutationObserver；重渲染时 React 只 diff 自身节点，我们插在中间的外来节点由 observer 兜底重建（spec 场景「标题区重建后重新生效」）。

### D2. 短标识推导：去 `session-` 前缀后取前 6 位
- `sessionSnippet(id) = id.startsWith('session-') ? id.slice(8).slice(0,6) : id.slice(0,6)`。
- 为什么：官方 id 形如 `session-9af69be9-…`，直接取前 6 位 = “sessio”，无辨识度；用户目标是「一眼认出是哪个会话」。
- 纯函数、单测覆盖；若未来 id 格式变化，只改这一处。

### D3. 徽标本体：自建 `<button type="button">` + 自有标记 + 内联样式
- 标记 `data-dsh-session-title-copy-badge`；样式全部内联（不依赖官方 CSS 变量名是否变化，用官方 token 加 fallback：`var(--dsw-alias-interactive-bg-hover, …)`）。
- 等宽小字（`font-family: var(--ds-font-family-code, ui-monospace, monospace)`、11px）、圆角 chip、hover 变深；`cursor:pointer` 天然可点。
- `title` 属性 = 完整 session id（悬停即可看全 id）；点击 handler 与 v0.1.0 同机制：读取 `ctx.sessions.list.getSnapshot().current` → `navigator.clipboard.writeText` → toast；无需拦截（徽标是我们自己的元素，无官方 handler 冲突）。

### D4. 标题恢复官方：删除一切标题改造
- 移除 `disabled` 移除、capture 拦截、cursor/tooltip 设置（v0.1.0 的 wireTitle/reconcile 对标题的全部逻辑删除）。标题按钮回到官方 disabled 态 —— 官方 onClick 仍被 disabled 屏蔽，与我们无关。
- locator 不再要求「disabled crumb」，改为「header 内含 crumb 按钮的 nav」= 标题区存在（header 非 hidden 才有 nav）；未知结构返回 null → 不注入。

### D5. 生命周期 = `ctx.effect` + MutationObserver + sessions.list.subscribe（沿用 v0.1.0 骨架）
- reconcile：定位标题区 → 无则移除残留徽标（自建元素全局按标记清）→ 有则「存在即更新 / 不存在即创建 + 接线」；
- 徽标幂等：`data-dsh-session-title-copy-badge` 存在则只更新文本/title，不重复接线；
- cleanup：移除徽标 + 提示 + 观察器 + 订阅；effect 内所有 reconcile 异常 catch 吞掉（严格失败路径）。

### D6. 版本与验证面
- package 0.1.0 → 0.1.1（dsh.yaml version/note 同步）；peer 不变。
- 验证：vitest（短标识推导、定位、幂等插入/更新、点击复制、清理、降级）+ typecheck/build + 隔离 DSH_HOME sync 幂等；合并部署后 headless 真机复核徽标可见性/复制/toast 与标题官方态。

## Risks / Trade-offs

- [React 重渲染影响自建徽标位置] → 自有标记 + observer 幂等重建；窗口期仅缺失徽标，无功能错误。
- [未来官方在 titleCluster 加新兄弟节点] → locator 只是「nav 之后插入」，官方新节点默认在 headerActions 内或其后，不冲突；结构大变则降级不注入。
- [「前 6 位」语义] → 取去前缀后的前 6 位；若用户想要其它口径（如带 `session-` 前缀前 6 位），改 `sessionSnippet` 一处 + 单测即可。

## Migration Plan

1. v0.1.1 实现 → 自测 → manifest 同步 → sync 物化 → 重启 DSH（杀掉 v0.1.0 行为，标题即时恢复官方态）。
2. 回滚：manifest `enabled: false` + sync + 重启；无持久化数据。

## Open Questions

无。规格/方案/任务划分均无未决项。
