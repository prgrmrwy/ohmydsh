## Why

额度卡片目前只在设置页可见，日常要在对话与设置之间来回切；而「现在这个模型背后还剩多少」正是每次决定发不发请求时最想知道的信息。用户已确认展示形态：侧栏底部常驻一张密集卡片，默认只看每个上游的 `7 days` 窗口，点击原地展开全部窗口；侧栏收起时只留一个 icon，点开右侧浮层。

## What Changes

- 设置页新增「侧边栏额度」面板与开关「在侧边栏常驻显示额度用量」，默认关闭。开关持久化到插件 **host 设置**（新增 `sidebarUsage: boolean`），跨浏览器/跨 Host 一致。
- 开关打开时，在官方槽位 `sidebar.footer.action`（设置行上方）渲染常驻卡：
  - 每个上游一行，只显示该上游的 `7 days` 窗口（没有周窗口时回退到最紧窗口），行内是名称 + 窗口 + 已用 % + 整宽 3px 条；
  - 最多 5 行；超出时卡内滚动，底部显示双下箭头（无分割线，可点 = 展开全部）；
  - 卡片无 border，只用阴影；整张卡只有一个刷新入口（头部），`POST {all:true}`；
  - 任何卡片读取失败的行显示「读取失败」，不伪造读数。
- 点击常驻卡/双箭头：在同一位置以覆盖层展开完整卡片（同宽、向上长高、内部滚动），显示每个上游的全部窗口、重置时间、余额、重置机会与脱敏错误；**不改变侧栏会话列表的可用高度**（常驻卡保留占位）。
- 侧栏收起（`wide === false`）：只渲染一个 Magpie icon（hover tooltip「Magpie 额度」）；点击在右侧打开 320px 浮层，内容同展开卡。
- 读取策略：客户端 60s TTL 缓存；只在挂载、用户点击刷新、展开补读、页面重新可见时读；**不使用定时器轮询**。AMD4 中「SHALL NOT 定时请求卡片」按此明确措辞。
- 顺序按网关返回顺序；窗口名照抄网关原文。

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
- `dsh-magpie-connector`：新增「侧边栏额度卡片」；`用量入口与颜色（AMD4）` 的读取时机措辞明确为「不得用定时器轮询，只在事件发生时读取」。

## Impact

- 代码：`packages/dsh-magpie-connector/src/host/{settings.ts,routes.ts,runtime.ts}`（设置字段）、`src/client/{index.ts,styles.ts,locales.ts,view-model.ts}`、新增 `src/client/{SidebarUsage.tsx,sidebar-view.ts,sidebar-api.ts}`；测试 `test/sidebar-view.test.ts`、`test/sidebar-usage.test.tsx`、设置写入相关测试。
- 只复用现有只读接口（`GET/POST /api/dsh-magpie-connector/cards`），不新增 host 路由、不改网关请求。
- 用户可见：设置页多一个开关；打开后侧栏底部多一张卡片与一个浮层。开关关闭时行为与现在完全一致（不渲染、不请求）。
- 发布：`dsh-magpie-connector` 版本 0.6.0，CHANGELOG、README（中英）与 `dsh.yaml` 条目说明同步。
