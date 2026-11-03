## ADDED Requirements

### Requirement: 侧边栏额度卡片

插件设置页 SHALL 提供「在侧边栏常驻显示额度用量」开关（`role="switch"`，默认关闭），其值 SHALL 持久化在插件 host 设置的 `sidebarUsage` 布尔字段中。该字段缺失时按 `false` 处理；写入非布尔值 SHALL 被拒绝（400）。

开关关闭时，客户端 SHALL NOT 渲染任何侧栏额度 UI，也 SHALL NOT 发起卡片请求。

开关打开时，客户端 SHALL 在官方槽位 `sidebar.footer.action` 渲染常驻卡：

- 每个上游 SHALL 只显示其 `7 days` 窗口的读数；没有周窗口时回退到读数最高的窗口；再没有数字读数时显示网关的 `display` 文本或「无限」。窗口名 SHALL 照抄网关原文，SHALL NOT 翻译或编造。
- 每行 SHALL 包含上游名称、窗口名、已用百分比与整宽进度条；百分比与条 SHALL 按 `used` 着色（≤70 品牌色、>70 警示、≥90 错误），文字警示色 SHALL 使用 `--dsw-alias-state-warn-label`。
- 常驻卡 SHALL 最多显示 5 行；超过时 SHALL 在卡内滚动，并在底部显示双下箭头（无分割线，可点击）。
- 卡片 SHALL NOT 使用 border；层级只由底色与阴影表达。整张卡 SHALL 只有一个刷新入口。
- 顺序 SHALL 按网关返回顺序，SHALL NOT 按当前模型或严重度重排。

点击常驻卡或双下箭头时，客户端 SHALL 在同一位置以覆盖层展开完整卡片（同宽、向上长高、内部滚动），显示每个上游的全部窗口、重置时间、余额、重置机会与错误；该覆盖层 SHALL NOT 改变侧栏会话列表的可用高度（常驻卡保留流内占位）。

侧栏收起（`wide === false`）时，客户端 SHALL 只渲染一个 Magpie icon 按钮（hover tooltip「Magpie 额度」）；点击 SHALL 在右侧打开宽 320px 的浮层，内容与展开卡相同。

刷新 SHALL 只由用户点击触发（`POST {all: true}`），插件 SHALL NOT 使用定时器轮询卡片端点；客户端 SHALL 以 60 秒 TTL 缓存并在挂载、手动刷新、展开补读、页面重新可见时读取。任何卡片读取失败 SHALL NOT 影响目录同步、模型选择与生成。

#### Scenario: 开关关闭时不渲染也不请求

- **GIVEN** `sidebarUsage` 为 `false`
- **WHEN** 侧栏渲染完成
- **THEN** `sidebar.footer.action` 中没有额度卡片与 icon，客户端没有发出 `GET cards`

#### Scenario: 常驻卡只显示周窗口且最多 5 行

- **GIVEN** 网关返回 6 张卡片：其中 `claude` 同时有 `5 hours` 与 `7 days` 窗口，其余各只有 `7 days`
- **WHEN** 渲染常驻卡
- **THEN** 每行显示对应上游的 `7 days` 读数（`claude` 不显示 `5 hours`）；可见 5 行，底部出现双下箭头；第 6 行只能通过卡内滚动看到

#### Scenario: 展开不改变会话列表可用高度

- **GIVEN** 常驻卡已渲染，会话列表容器高度为 H
- **WHEN** 点击常驻卡展开
- **THEN** 展开卡在侧栏内以覆盖层显示，会话列表容器高度仍为 H；关闭后回到常驻卡

#### Scenario: 侧栏收起只留 icon

- **GIVEN** `wide` 为 `false`
- **WHEN** 渲染 `sidebar.footer.action`
- **THEN** 只有带 `aria-label`/tooltip「Magpie 额度」的 icon 按钮，没有常驻卡与百分比

#### Scenario: 单一刷新入口

- **GIVEN** 常驻卡与展开卡都已渲染
- **WHEN** 查找所有刷新控件
- **THEN** 只有头部一个刷新按钮；点击它发出一次 `POST cards {all:true}`，每张卡片上没有独立刷新控件

#### Scenario: 读取失败的行不伪造读数

- **GIVEN** 网关返回的 `codex` 卡片带 `error: "token expired"`
- **WHEN** 渲染常驻卡
- **THEN** `codex` 行显示「读取失败」且没有百分比与进度条；展开卡中显示该错误文本

#### Scenario: 缺少周窗口时回退到最紧窗口

- **GIVEN** 某上游只有 `5 hours` 窗口（`used` 44）且没有周窗口
- **WHEN** 渲染常驻卡
- **THEN** 该行显示 `5 hours 44%`，不显示空读数或伪造的 `7 days`

#### Scenario: 开关持久化

- **GIVEN** 设置页把 `sidebarUsage` 写为 `true`
- **WHEN** 重新读取设置
- **THEN** 返回的 `sidebarUsage` 为 `true`；写入 `"yes"` 等非布尔值返回 400 且设置不变

## MODIFIED Requirements

### Requirement: 用量入口与颜色（AMD4）

设置页 SHALL NOT 提供独立的「用量」栏目或常驻「刷新全部」；刷新只在每张卡片上进行，单卡刷新的提示与失败原因显示在该卡片所在分组。没有卡片时，用量状态显示在连接面板，并在空或失败时提供「获取模型与用量」：先重新同步目录，成功后发一次全量刷新（`{all: true}`），同步失败则不刷新并显示原因。窗口用量条 SHALL 按 `used` 着色：≤70 蓝色（business），大于 70 且小于 90 橙色（warn），≥90 红色（error）。窗口用量条的填充段 SHALL 两端为圆角：`settingsCss` 中 `.dmg-fill` 声明的 `border-radius` SHALL 与 `.dmg-track` 相同且非零。

插件 SHALL NOT 使用定时器轮询卡片或刷新端点。设置页与侧栏额度卡片的读取 SHALL 只发生在用户动作或页面事件上：打开设置页、打开侧栏并挂载常驻卡、用户点击刷新、用户展开侧栏卡片、页面重新可见（客户端 60 秒 TTL 内不重复请求）。侧栏卡片的读取规则见「侧边栏额度卡片」。

#### Scenario: 用量条三档颜色（AMD4）

- **GIVEN** 卡片窗口 `used` 分别为 0、70、70.5、71、89.9、90、100
- **WHEN** 渲染设置页
- **THEN** 用量条档位依次为 normal、normal、warn、warn、warn、high、high

#### Scenario: 有卡片时没有整体刷新（AMD4）

- **GIVEN** 卡片端点返回一张 codex 卡片
- **WHEN** 渲染设置页
- **THEN** 页面没有「刷新全部」或「获取模型与用量」按钮，也没有用量状态栏；只有该卡片自己的「刷新」

#### Scenario: 目录同步失败时不发全量刷新

- **GIVEN** 卡片为空，设置写入（目录同步）返回 502
- **WHEN** 用户点击「获取模型与用量」
- **THEN** 不发出全量刷新，连接面板显示失败原因

#### Scenario: 用量条填充两端圆角

- **GIVEN** 设置页把样式表作为字符串导出（`settingsCss`）
- **WHEN** 解析其中 `.dmg-track` 与 `.dmg-fill` 的 `border-radius` 声明
- **THEN** 两者都声明了相同且非零的 `border-radius`（46% 进度时末端视觉为圆弧，由预览验收确认）

#### Scenario: 没有定时器轮询

- **GIVEN** 设置页或侧栏卡片已打开且用户不操作
- **WHEN** 等待超过任何合理轮询间隔
- **THEN** 客户端没有发出额外 `GET cards`（实现不使用 `setInterval`/`setTimeout` 轮询卡片）
