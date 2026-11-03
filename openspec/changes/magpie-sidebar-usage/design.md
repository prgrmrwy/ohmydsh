## Context

- 升级前的状态：额度卡片只在设置页（`SettingsPage.ts` + `UsageCard.ts`），主界面没有任何入口。
- 宿主扩展位（DSH 0.2.0-rc.2）：`sidebar.footer.action` 是 root 级 list 槽位，渲染在 `sidebar.settings` 之上（`@deepseek-ai/dsh-client-ui-sidebar` 的 `.footArea` 内先 `.footerActions` 再 `.settingsArea`），owner prop 只有 `wide: boolean`（false = 56px rail）。浮层定位用 `@deepseek-ai/dsh-client-ui-primitives` 的 `useAnchoredPosition`（只支持 `top/bottom` + `start/end`）与 `useDismissOnOutsidePointer`。
- 数据面：`src/host/cards.ts` 的 `send()` 每次 GET 都真打网关（只有并发去重，没有 TTL）；`POST {all:true}` 走 Magpie 刷新端点并受上游节流。
- 视觉与交互方案详见 `ui/design.md`（含截图说明与可交互预览页 `ui/sidebar-preview.html`）；本文件只记录决定与取舍。

## Goals / Non-Goals

**Goals**
- 开关关闭时零副作用（不渲染、不请求）。
- 常驻卡一眼可读（每个上游一条 `7 days`），展开不改变工作区可用高度。
- 侧栏收起时仍能进入完整卡片。
- 刷新只有一个入口；读取频率可控。

**Non-Goals**
- 不做单卡刷新、不做定时轮询、不做图表/趋势。
- 不改变网关请求、路由注册、凭据与生成路径。
- 不在主界面显示「读取失败」之外的诊断细节（诊断仍在设置页）。

## Decisions

### D1 槽位与形态
常驻卡渲染在 `sidebar.footer.action`；`wide === false` 时只渲染 icon 按钮。展开态不再用右侧浮层（会挤压对话区观感、也偏离用户要求），改为**原位覆盖**：常驻卡保留流内占位（展开时 `visibility: hidden`），展开卡 `position: absolute; bottom: 0; left/right: 0` 向上覆盖会话列表，因此列表可用高度不变。rail 的展开仍是右侧 320px 浮层（侧栏收起时没有可长高的卡）。

### D2 设置持久化在 host
`Settings.sidebarUsage?: boolean`（缺省 = false）。理由：换浏览器/换 Host 一致；设置页与卡片读同一份状态；可在 host 侧测试。备选 localStorage 被否决（每台机器各存一份，且与「设置里的开关」语义不符）。

### D3 读取策略
客户端 60s TTL + 事件驱动（挂载、手动刷新、展开补读、页面重新可见）。`GET cards` 每次真打网关，因此不能按渲染/切换频繁触发；不使用 `setInterval`。AMD4 的「SHALL NOT 定时请求卡片」按此明确措辞（见 spec delta）。

### D4 周窗口选择
`name` 命中 `/7\s*days?|week|weekly|周/i` 且有数字 `used` → 取 `used` 最大者；没有周窗口 → 取所有有 `used` 窗口里最大者；再没有 → 显示 `display` 原文或「无限」。只决定挑哪个窗口，显示的名字照抄网关。

### D5 刷新与错误
单一刷新入口（卡片/浮层头部）→ `POST {all:true}`；`readAt` 未变时按设置页同样的比较提示「Magpie 未重新读取」。单卡 `error` 在常驻行走「读取失败」，展开卡里显示已脱敏原因。

### D6 视觉
无 border，仅阴影（浅 `0 1px 2px #0000000f, 0 4px 14px #0000000d`，深色加深）；读数 `tabular-nums`；警示文字用 `state-warn-label`（amber-500 对比度不足，仅用于条）。

## Risks / Trade-offs

- `sidebar.footer.action` 在 0.2.0-rc.2 的 `.footerActions` 是 flex 行：若未来同槽位出现其它 entry 会并排。当前只有本插件使用；组件根节点占满整行。
- 原位展开会覆盖住会话列表底部若干行（但列表高度不变）。这是「不挤占」的直接代价；用阴影与圆角区分层级。
- 窄宽度（220px）下完整重置时间放不下，展开卡用 `11/3 19:20` 短格式（完整时间在 `title` 与设置页）。
- 侧栏 rail 的 20px 喜鹊图标辨识度有限；用 tooltip 与浮层标题补足。

## Migration

无数据迁移；`sidebarUsage` 缺省即关闭。旧版本写入的设置文件不含该字段，读取时按 false 处理，写回时保留。

## Open Questions

无（设计已在 `ui/design.md` 冻结）。
