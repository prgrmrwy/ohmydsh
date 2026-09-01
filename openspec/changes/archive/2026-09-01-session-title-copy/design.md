# session-title-copy 设计

## Context

见 proposal.md - Why。运行体为 DSH 0.1.1-rc.2，其 Web client 由 `@deepseek-ai/dsh-client-ui-conversation` 渲染对话区 header（`ConversationSessionHeader`），当前会话标题是面包屑 `nav` 中**最后一个** `button.crumb`，官方对其设置 `disabled: last` 且 `crumbCurrent` 的 CSS 为 `cursor: default`；整个 `nav` 的面包屑标题都只承担「打开会话」职责。本仓既定模式（dsh-cockpit-bridge / dsh-sidebar-session-provider-icon）是「Web client 插件 + 订阅官方 store + 轻量 DOM 注入」，本次沿用。

## Goals / Non-Goals

**Goals:**
- 当前会话标题点击 → 复制当前 session id（真相源 = 官方 sessions list 的 `current`）。
- 标题悬停显示 pointer 指针（并恢复官方 crumb 悬停底色）。
- 复制成功给出瞬态轻量反馈；祖先面包屑行为完全不变。
- DOM 升级安全降级：定位失败不注入、不抛错。

**Non-Goals:**
- 不改 DSH core / 官方客户端源码（本仓是定制仓，core 以 npm 包形式存在，插件模式是既定路径）。
- 不给祖先面包屑加复制（其「点击打开」语义被用户依赖）。
- 不做 toast/snackbar 系统、不做复制历史、不做长按/右键菜单，不引入任何网络请求。
- host 端不新增任何能力/服务/权限面。

## Decisions

### D1. 打包形态：host 空入口 + Web client 插件（仿 dsh-cockpit-bridge）
- `package.json` 声明 `dsh.bundle.patch → cordis.patch.yml`（注册 bundle 行）、`dsh.client`（platform web + inject 服务）、`exports["./client"]`；宿主入口 `src/index.ts` 为 no-op cordis 插件。
- 为什么（两点）：① client-modules scanner 需要 bundle 行 + loader entry 才能发现并服务浏览器包——缺 host 入口正是 dsh-cockpit-bridge v0.1.0「DSH 启动即崩」事故的根因，必须避免重演；② 订阅官方 `sessions` store 即可拿到 `ctx.sessions.list.getSnapshot().current`，与 cockpit bridge 同源，无需 host 转发。
- 备选：改官方 UI 源码（本仓不可行）；host 桥接（无必要）。

### D2. DOM 定位：结构化选择器 + class **后缀**匹配，且只认 `header nav` 内的按钮
- 官方 CSS Modules 会哈希类名（如 `wSkVaW_crumb`），后缀匹配（token `endsWith('crumb')`）可在哈希变化时保持稳定（sidebar row-locator 已验证该策略）。
- 当前标题定位 = `header` 内 `nav` 中带 `disabled` 的按钮（官方只对 last crumb 设 `disabled: last`）。祖先 crumb 是 enabled 按钮，天然区分。
- 结构知识全部收敛在 `src/client/title-locator.ts`（同 row-locator.ts 的职责隔离），升级只修一处。
- 备选：按 aria-label（`session.hierarchy` 的本地化文案）定位 `nav` ——依赖 locale 字符串，不选；按完整哈希类名 ——版本升级即碎，不选。

### D3. 移除 `disabled` + capture 阶段拦截 click（核心机制）
- `disabled` 按钮完全抑制事件派发（含子元素与祖先的 click 捕获），直接挂 click 不生效，所以必须 `removeAttribute('disabled')`。
- 移除后官方 React 的 onClick（`open(summary.id)`）会随点击执行——当前会话会被重新打开/导航，必须拦截：在按钮上注册 **capture 阶段** click listener + `stopPropagation()`。React 18 把监听委托到容器 root（capture+bubble 都挂 root），按钮上的 capture listener 先于 root 触发，`stopPropagation()` 可同时阻断两者，官方 onClick 永不执行。
- 附带收益：键盘可达（Enter/Space 触发 click → 复制），与「可点击复制」语义一致。
- 备选：透明覆盖层盖住标题 —— 需持续跟踪布局（ResizeObserver）且阻挡官方 hover，复杂且侵入，不选。

### D4. hover pointer + 交互底色
- `crumbCurrent` 的 `cursor: default` 用内联 `style.cursor = 'pointer'` 覆盖（内联优先于 class）；`disabled` 移除后官方的 `.crumb:hover:not(:disabled)` 底色自动生效。
- 只改这一个按钮，不动官方 CSS 文件，不做全局样式注入。

### D5. 复制与反馈
- 主路径 `navigator.clipboard.writeText(id)`。127.0.0.1 是 secure context，且驾驶舱为同源 iframe，均可用；`try/catch` 包裹，失败静默（不打断页面，符合 spec 场景）。
- 反馈：自绘 body 级 `position: fixed` 的瞬态提示（位于标题下方、高 z-index），1.2s 后淡出并 `remove()`；不参与布局、不留 DOM。
- 备选：改按钮文本做反馈 —— 会与 title 内容冲突且刷新后难以恢复，不选；接入官方 toast —— 本仓未发现稳定公开的 toast 服务，不引入新依赖，不选。

### D6. 接线生命周期 = `ctx.effect` + MutationObserver + sessions.list.subscribe
- `effect` 内：`document.body` 上 MutationObserver（childList+subtree）→ reconcile；`sessions.list.subscribe` → reconcile；启动立刻 reconcile 一次。effect 清理函数断开 observer、移除残留提示。
- reconcile 幂等：标题按钮上打自有标记属性（自拥命名空间，如 `data-dsh-session-title-copy`），已处理则跳过（不重复 removeAttribute / 不叠 listener / 不重复设 cursor）；按钮被 React 重渲染重建（会话切换、标题生成）后由 observer 重新定位接线——对应 spec「标题刷新后重新接线」场景。
- 候选节点不匹配就静默跳过；任何 reconcile 异常 catch 后吞掉（严格失败路径：绝不影响官方页面）。

### D7. 版本与验证面
- `packages/session-title-copy` v0.1.0，peer 仅 `@deepseek-ai/cordis` + `@deepseek-ai/dsh-client-runtime`；devDeps 与 sidebar 包同套（typescript/tsdown/vitest + peers）。
- 验证：locator/接线逻辑用 vitest 结构桩测试（无浏览器）；`tsc` 双项目 typecheck；tsdown 产出 `lib/client.js`；manifest 注册后用隔离 DSH_HOME 跑 `node scripts/sync.mjs` 二次幂等。

## Risks / Trade-offs

- [官方升级改 header 结构或 disabled 语义] → locator 单文件降级为不注入（spec 已约定），升级时回归验证即可。
- [React 重渲染覆盖我们的改造（disabled 恢复、cursor 丢失）] → observer 每次重接，reconcile 幂等；窗口期（重渲染瞬间）内按钮回到官方态，短暂且无害。
- [移除 disabled 使标题进入 Tab 焦点序列，Enter 触发复制] → 与祖先 crumb（enabled）一致，属可接受语义；点击复制主路径不受影响。
- [其他插件在 header nav 内注入 disabled 按钮] → 本仓已知插件（open-in-vscode/sidebar-qa 等）均不落入 `header nav`；如未来冲突，降级判定（仅取 nav 内唯一 disabled crumb）按 spec 场景静默跳过。
- [剪贴板权限被拒] → 静默降级（不弹错误、不打断），spec 场景覆盖。

## Migration Plan

1. 本 change 实现 → package 自测 → manifest 启用 → sync 物化 → 重启 DSH 加载 client bundle。
2. 回滚：manifest `enabled: false` + sync（或直接移除条目），重启即恢复官方行为；无持久化数据，无迁移负担。

## Open Questions

无。规格/方案/任务划分均无未决项。
