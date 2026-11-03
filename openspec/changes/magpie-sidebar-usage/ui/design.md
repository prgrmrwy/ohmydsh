# Magpie 额度 · 侧边栏常驻卡片设计（v3）

状态：按 2026-11-03 第三轮确认定稿，未实施 · `dsh-magpie-connector` 0.5.1 / DSH 0.2.0-rc.2

定稿：**host 设置开关** + **侧栏底部常驻密集卡片**（每个上游一条 `7 days`，最多 5 条，双下箭头，无分割线）+ **点击在原地长高**（覆盖式，不改变工作区可用高度）+ **收起时只留 icon，点开右侧 320px 浮层**。顺序按网关返回顺序。

预览：`sidebar-preview.html`（`#resident-light` / `#resident-dark` / `#expanded-light` / `#expanded-dark` / `#rail-light` / `#settings-light`）。截图不提交（用无头 Chromium 从该页生成对应视图即可复核），演示数据虚构。

---

## 1. 决策记录

| 问题 | 结论 |
| --- | --- |
| 开关持久化 | host 设置 `sidebarUsage: boolean`，默认 false，跨浏览器/跨 Host 一致 |
| 常驻卡内容 | 每个上游只显示 `7 days` 窗口；最多 5 条；溢出时卡内滚动 |
| 溢出提示 | 底部双下箭头，`cursor: pointer`，**上方不要分割线**；点它 = 展开全部 |
| 展开态（侧栏展开） | 在常驻卡原位长高（同宽 220px），向上覆盖会话列表，**不改变列表可用高度** |
| 刷新 | 统一一个刷新按钮（卡片头部），不做单卡刷新 |
| 卡片描边 | 不用 border，只用 shadow |
| 展开态（侧栏收起） | 只有 icon（hover tooltip：`Magpie 额度`），点击在右侧弹 320px 浮层，显示完整卡片 |
| 顺序 | 网关返回顺序 |

## 2. 界面

### 2.1 设置开关（host 设置）

「连接」之后新增「侧边栏额度」面板：

- 说明：`打开后，左侧栏底部常驻一张额度卡片：每个上游显示一条 7 days 读数，最多 5 条，超出时底部出现双箭头；点击卡片展开全部窗口（含重置时间、余额与失败原因）。卡片只读，不影响路由、模型选择与生成。`
- 开关：`在侧边栏常驻显示额度用量`，默认关闭。

### 2.2 常驻卡

- 位置 `sidebar.footer.action`（设置行上方），流内占位约 190px。
- 外观：无 border（`border: 0`），只有一层柔和阴影（浅色 `0 1px 2px #0000000f, 0 4px 14px #0000000d`，深色对应加深），圆角 12px。
- 头部 22px：15px 喜鹊 + `Magpie 额度`（12px/500）+ 右侧 `3 分钟前`（10px）+ 统一刷新 ↻（18px 图标）。
- 行：`名称`（12px）… `7 days`（10px tertiary）+ `已用 %`（11.5px tabular）；下一行整宽 3px 条。行高 29px。色档 ≤70 默认 / >70 `warn-label` / ≥90 `error`；失败行无条、红字 `读取失败`。
- 正文高度 = 前 5 行的实际高度（用 `ResizeObserver` 量第 5 行底部，实测 113–125px；宿主字号/无进度条行不同，避免固定 145px 露出第 6 行），第 6 条起卡内滚动（细滚动条，`overscroll-behavior: contain`）。
- 溢出时底部 16px 双下箭头（无 `border-top`，只有 `cursor:pointer` 与 hover 变色的文字色箭头）。
- 空态：卡片壳 + 一行状态。

### 2.3 展开（侧栏展开时，原地长高）

- 点击常驻卡（头部/正文/双箭头）在同一位置长高：`position: absolute; left:0; right:0; bottom:0`，宽度与常驻卡一致（220px），向上覆盖会话列表；`max-height: min(72vh, 600px)` + 内部滚动。
- **不改变工作区可用高度**：常驻卡保留在流内占位（展开时 `visibility:hidden`），展开卡是覆盖层，会话列表区域尺寸不变。
- 窄宽度的密集布局（这是与设置页宽卡片不同的地方）：
  - 头部：喜鹊 + `Magpie 额度` + `3 分钟前` + 统一刷新 + 收起 ×（整张卡只有这一个刷新）；
  - 每家一段：`名称`；`账号 …`（超长省略）、`计划 max · 读取于 11/3 16:17`；
  - 每个窗口：`5 hours 44%` + 右侧短重置时间 `11/3 19:20`（10px，完整时间放 `title`），下面 3px 条；
  - 段尾：`重置机会 1 次 · 11-06 23:30 到期`、`余额`；`error` 段只显示脱敏原因。
- 短重置格式：24 小时内 `19:20`，否则 `11/10 11:00`；完整时间在 `title` 与设置页里。

### 2.4 侧栏收起（56px rail）

- 只有 36px 的喜鹊 icon 按钮；hover `tooltip` 显示 `Magpie 额度`。
- 点击在 icon 右侧上方弹 **320px** 浮层（`useAnchoredPosition`：锚在触发元素上方、从左边缘向右展开；宿主 primitive 没有 right 方向）。内容与 2.3 相同、同样只有一个刷新，宽度足够时窗口行是 `label + % + 重置于 …` 一行。浮层同样无 border、只用 shadow。
- 关闭：× / `Escape` / 点外部；焦点回到 icon。

## 3. 数据与读取

接口不变：`GET /api/dsh-magpie-connector/cards`；`POST {all:true}` 或 `{provider,user}` 刷新。`src/host/cards.ts` 的 `send()` 没有缓存（只有并发去重），每次 GET 都真打网关，频率必须由客户端控制。

| 时机 | 动作 |
| --- | --- |
| 常驻卡挂载且开关打开 | 缓存 >60s 时读一次 |
| 点 ↻（唯一刷新） | `POST {all:true}`；`readAt` 未变提示「Magpie 未重新读取」 |
| 打开展开态 | 用已有数据；>60s 静默补读 |
| 页面重新可见且 >60s | 读一次 |
| 其他 | 不发请求，不用 `setInterval` |

`7 days` 判定：`name` 命中 `/7\s*days?|week|weekly|周/i` 且有 `used` → 取 used 最大；无周窗口 → 取所有有 used 的窗口里最大；都没有 → 显示 `display`/无限。名字照抄网关原文。

降级：空/无权/未配置 → 卡片壳 + 一行状态；网络错误 → 保留上次读数、时间变旧；单卡 error → 行内 `读取失败`。

## 4. 实现清单

host：`settings.ts` 加 `sidebarUsage?: boolean`；`routes.ts` 允许并严格校验 boolean；`runtime.ts` 的 `writeSettings`/`savePreferences`/settings 视图带上该字段；测试覆盖非法值拒绝与持久化。

client：

- `SidebarUsage.tsx`：常驻卡（5 行 + 双箭头）、展开卡（原位长高）、rail icon；`wide` 来自 owner props。
- `sidebar-view.ts`：`weeklyWindow(card)`、`sidebarRows(cards)`、`usedLevel(used)`、`formatResetShort(resetsAt, now)`、`formatAge(readAt, now)`。
- `sidebar-api.ts`：60s TTL 缓存 + `loadCards()` / `refreshAll()`（不暴露单卡刷新）。
- `styles.ts`：`dmg-sidebar-*`，尺寸见第 2 节；配色全部宿主 token。
- `index.ts`：`ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name, id: 'magpie-usage', order: 10 }, SidebarUsage))`。
- 展开层：常驻卡外层 `.dmg-sidebar-slot{position:relative}`，展开卡 `position:absolute; bottom:0; left:0; right:0`，常驻卡 `visibility:hidden` 保占位。
- rail 浮层：`createPortal(document.body)` + `useAnchoredPosition({ side:'top', align:'start', gap:8, margin:12 })` + `useDismissOnOutsidePointer`。
- 测试：`sidebar-view.test.ts`、`sidebar-usage.test.tsx`（5 行截断、双箭头仅溢出时、展开不改变列表高度——用容器高度断言、rail tooltip/aria、刷新不冒泡）；2026-11-03 在隔离 GUI 实测并校正文案与行高。
- 验收：隔离 `DSH_HOME` + loopback mock 网关 + headless Chrome，拍常驻/展开 × 浅/深 + 收起 + 设置开关。

## 5. 规范增量（新 change）

新增「侧边栏额度卡片」requirement：

- 开关关闭：SHALL NOT 渲染、SHALL NOT 请求卡片。
- 开关打开：`sidebar.footer.action` 渲染常驻卡；每上游只显示 `7 days`；最多 5 条；溢出 SHALL 在卡内滚动并显示双箭头（无分割线）。
- 点击常驻卡/双箭头：SHALL 在同一位置以覆盖层展开完整卡片，SHALL NOT 改变侧栏会话列表的可用高度。
- 侧栏收起：只显示 icon；点击 SHALL 在右侧打开浮层（宽 320px）。
- 顺序 SHALL 按网关返回顺序；读数/窗口名/错误原样来自网关投影，缺失省略，字符串按文本渲染。
- 刷新只有一个入口（卡片头部），SHALL NOT 提供单卡刷新；只由用户点击触发，SHALL NOT 用定时器轮询。
- 卡片 SHALL NOT 使用 border，只用阴影与底色区分层级。
- 额度读取失败 SHALL NOT 影响目录同步、模型选择与生成。

同时把 AMD4「SHALL NOT 定时请求卡片」明确为「不得用定时器轮询，只在挂载/手动刷新/展开补读/页面重新可见时读取」。

## 6. 证据

- 现状代码：`src/client/UsageCard.ts`、`src/client/SettingsPage.ts`、`src/host/cards.ts`、`src/host/routes.ts`、`openspec/specs/dsh-magpie-connector/spec.md`。
- 宿主：`sidebar.footer.action`（owner prop `wide`，`@deepseek-ai/dsh-client-ui-sidebar` 0.2.0-rc.2）；`useAnchoredPosition`/`useDismissOnOutsidePointer`（`@deepseek-ai/dsh-client-ui-primitives` 0.2.0-rc.2）。
- 参考：`dsh-cost-meter` 侧栏盒子、`dsh-quota` 面板卡、设置页现有 `UsageCard`。
