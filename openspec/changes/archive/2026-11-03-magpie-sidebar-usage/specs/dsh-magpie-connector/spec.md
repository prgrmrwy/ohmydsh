## ADDED Requirements

### Requirement: 侧边栏额度开关

插件设置页 SHALL 提供「在侧边栏常驻显示额度用量」开关（`role="switch"`，默认关闭），其值 SHALL 持久化在插件 host 设置的 `sidebarUsage` 布尔字段中；字段缺失时按 `false` 处理，写入非布尔值 SHALL 被拒绝（400）且设置不变。开关关闭时，客户端 SHALL NOT 渲染任何侧栏额度 UI，也 SHALL NOT 发起卡片请求。

#### Scenario: 开关关闭时不渲染也不请求

- **GIVEN** `sidebarUsage` 为 `false`
- **WHEN** 侧栏渲染完成
- **THEN** `sidebar.footer.action` 中没有额度卡片与 icon，客户端没有发出 `GET cards`

#### Scenario: 开关持久化

- **GIVEN** 设置页把 `sidebarUsage` 写为 `true`
- **WHEN** 重新读取设置
- **THEN** 返回的 `sidebarUsage` 为 `true`；写入 `"yes"` 等非布尔值返回 400 且设置不变

### Requirement: 侧边栏常驻额度卡

开关打开时，客户端 SHALL 在官方槽位 `sidebar.footer.action` 渲染常驻卡：每个上游一行，显示其 `7 days` 窗口读数与整宽进度条，窗口名照抄网关原文；没有周窗口时回退到读数最高的窗口，没有数字读数时显示网关 `display` 文本或「无限」，只有 `balance` 时显示余额，两者都没有才显示 `—`。常驻卡 SHALL 最多显示 5 行，溢出时在卡内滚动并在底部显示无分割线的双下箭头；SHALL NOT 使用 border；顺序 SHALL 按网关返回顺序；整张卡 SHALL 只有一个刷新入口。

#### Scenario: 常驻卡只显示周窗口且最多 5 行

- **GIVEN** 网关返回 6 张卡片：其中 `claude` 同时有 `5 hours` 与 `7 days` 窗口，其余各只有 `7 days`
- **WHEN** 渲染常驻卡
- **THEN** 每行显示对应上游的 `7 days` 读数（`claude` 不显示 `5 hours`）；可见 5 行，底部出现双下箭头；第 6 行只能通过卡内滚动看到

#### Scenario: 缺少周窗口时回退到最紧窗口

- **GIVEN** 某上游只有 `5 hours` 窗口（`used` 44）且没有周窗口
- **WHEN** 渲染常驻卡
- **THEN** 该行显示 `5 hours 44%`，不显示空读数或伪造的 `7 days`

#### Scenario: 只有余额的上游不显示破折号

- **GIVEN** 网关返回的 `deepseek` 卡片没有窗口、`balance` 为 `¥42.50`
- **WHEN** 渲染常驻卡
- **THEN** `deepseek` 行显示 `¥42.50`，没有 `—` 也没有进度条

#### Scenario: 读取失败的行不伪造读数

- **GIVEN** 网关返回的 `codex` 卡片带 `error: "token expired"`
- **WHEN** 渲染常驻卡
- **THEN** `codex` 行显示「读取失败」且没有百分比与进度条；展开卡中显示该错误文本

#### Scenario: 单一刷新入口

- **GIVEN** 常驻卡与展开卡都已渲染
- **WHEN** 查找所有刷新控件
- **THEN** 只有头部一个刷新按钮；点击它发出一次 `POST cards {all:true}`，每张卡片上没有独立刷新控件

### Requirement: 侧边栏卡片的展开、收起与读取

标题行 SHALL 提供一个带 `aria-expanded` 的展开/收起按钮，点击 SHALL 在展开与收起之间切换；点击卡片其余部分或双下箭头 SHALL 展开。展开时客户端 SHALL 在同一位置以覆盖层显示每个上游的全部窗口、重置时间、余额、重置机会与错误，且 SHALL NOT 改变侧栏会话列表的可用高度。侧栏收起（`wide === false`）时 SHALL 只渲染一个 Magpie icon 按钮，点击打开 320px 浮层。读取 SHALL 只由用户动作或页面事件触发并以 60 秒 TTL 缓存，SHALL NOT 使用定时器轮询；读取失败 SHALL NOT 影响目录同步、模型选择与生成。

#### Scenario: 标题行的开关负责展开与收起

- **GIVEN** 常驻卡已渲染
- **WHEN** 点击标题行的展开按钮，再点击展开卡标题行的同一按钮
- **THEN** 第一次点击后出现展开卡且按钮 `aria-expanded` 为 `true`；第二次点击后展开卡消失、回到常驻卡，`aria-expanded` 为 `false`

#### Scenario: 展开不改变会话列表可用高度

- **GIVEN** 常驻卡已渲染，会话列表容器高度为 H
- **WHEN** 点击常驻卡展开
- **THEN** 展开卡在侧栏内以覆盖层显示，会话列表容器高度仍为 H；关闭后回到常驻卡

#### Scenario: 侧栏收起只留 icon

- **GIVEN** `wide` 为 `false`
- **WHEN** 渲染 `sidebar.footer.action`
- **THEN** 只有带 `aria-label`/tooltip「Magpie 额度」的 icon 按钮，没有常驻卡与百分比

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
