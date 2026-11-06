## REMOVED Requirements

### Requirement: 侧边栏额度自动刷新

**Reason**: 该要求规定定时器只发 `GET cards`、且 `SHALL NOT` 发全量刷新；当前 Magpie 网关的 `GET /v1/magpie/quotas/cards` 只返回它上次读到的缓存（`quotaCards` 直接取 `CachedCards`，不问上游），只有 `POST /v1/magpie/quotas/refresh` 才会让网关重读。按该要求实现出来的定时器永远拿不到新读数，与「自动刷新」的用户预期相反。

**Migration**: 由「侧边栏额度定时刷新」取代：`sidebarRefreshMinutes` 字段与取值规则、默认 5、`0` 关闭、页面隐藏时暂停、恢复可见时补读、失败保留旧读数都不变；唯一变化是到点时发全量刷新（`POST cards {all:true}`，与卡头刷新按钮同一路径）而不是只读缓存。

## ADDED Requirements

### Requirement: 侧边栏额度定时刷新

插件 host 设置 SHALL 提供 `sidebarRefreshMinutes` 整数分钟：缺失时按 `5` 处理，`0` 表示关闭定时刷新，合法范围 `0–1440`，非整数或越界写入 SHALL 返回 400 且设置不变。设置页 SHALL 提供对应的分钟输入（`0` = 关闭）。开启时，侧栏额度卡 SHALL 按该间隔静默刷新卡片：发送与卡头刷新按钮相同的全量刷新（`POST cards {all:true}`），因为网关的 `GET cards` 只返回它上次读到的缓存、不会向上游重读；定时刷新 SHALL NOT 只发 `GET cards` 当作刷新。刷新失败 SHALL 保留旧读数、不显示错误且不影响其他功能；页面隐藏时到期 SHALL 不刷新，恢复可见时 SHALL 补读一次（`GET cards`）。

#### Scenario: 默认五分钟

- **GIVEN** 设置中没有 `sidebarRefreshMinutes`
- **WHEN** 读取设置页
- **THEN** 返回的 `sidebarRefreshMinutes` 为 `5`；侧栏卡片在 5 分钟后定时刷新一次（发出 `POST cards {all:true}`）

#### Scenario: 关闭定时刷新

- **GIVEN** `sidebarRefreshMinutes` 为 `0`
- **WHEN** 等待超过 5 分钟且用户不操作
- **THEN** 侧栏卡片没有发出额外的 `GET cards` 或 `POST cards`，行为与手动读取一致

#### Scenario: 修改间隔立即生效

- **GIVEN** 当前间隔为 5 分钟
- **WHEN** 用户把输入改为 `2` 并提交
- **THEN** 设置写入 `sidebarRefreshMinutes: 2`；侧栏下一个定时刷新发生在 2 分钟后

#### Scenario: 非法输入被拒绝

- **GIVEN** 设置页显示定时刷新输入
- **WHEN** 提交 `1.5`、`-1`、`1441` 或非数字
- **THEN** host 返回 400 或界面回退到当前值，设置保持不变

#### Scenario: 页面隐藏时不刷新

- **GIVEN** 定时刷新间隔为 1 分钟，页面处于隐藏状态
- **WHEN** 到期
- **THEN** 客户端不发出 `GET cards` 或 `POST cards`；页面恢复可见后补读一次

#### Scenario: 定时刷新触发全量刷新

- **GIVEN** 定时刷新已开启，当前显示的读取时间为 T
- **WHEN** 定时触发
- **THEN** 客户端只发出一次 `POST cards {all:true}`，没有额外 `GET cards`，并显示刷新响应中的读数

#### Scenario: 定时刷新失败保留旧读数

- **GIVEN** 定时刷新已开启，网关 mock 对全量刷新返回 502
- **WHEN** 定时触发
- **THEN** 卡片读数与刷新前一致，不显示错误提示，也不影响展开/手动刷新等其它功能

## MODIFIED Requirements

### Requirement: 用量入口与颜色（AMD4）

设置页 SHALL NOT 提供独立的「用量」栏目或常驻「刷新全部」；刷新只在每张卡片上进行，单卡刷新的提示与失败原因显示在该卡片所在分组。没有卡片时，用量状态显示在连接面板，并在空或失败时提供「获取模型与用量」：先重新同步目录，成功后发一次全量刷新（`{all: true}`），同步失败则不刷新并显示原因。窗口用量条 SHALL 按 `used` 着色：≤70 蓝色（business），大于 70 且小于 90 橙色（warn），≥90 红色（error）。窗口用量条的填充段 SHALL 两端为圆角：`settingsCss` 中 `.dmg-fill` 声明的 `border-radius` SHALL 与 `.dmg-track` 相同且非零。

插件 SHALL NOT 使用定时器轮询刷新端点；唯一的定时刷新是用户显式开启的侧栏额度定时刷新（见「侧边栏额度定时刷新」），它按配置间隔发送全量刷新，不属于轮询。设置页与侧栏额度卡片的读取 SHALL 只发生在用户动作、页面事件或用户显式开启的定时刷新上：打开设置页、打开侧栏并挂载常驻卡、用户点击刷新、用户展开侧栏卡片、页面重新可见、以及 `sidebarRefreshMinutes` 大于 0 时按该间隔定时刷新（事件驱动的读取在客户端 60 秒 TTL 内不重复请求）。侧栏卡片的读取规则见「侧边栏额度卡片」与「侧边栏额度定时刷新」。

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

- **GIVEN** `sidebarRefreshMinutes` 为 0 且设置页与侧栏卡片已打开
- **WHEN** 等待超过任何合理轮询间隔
- **THEN** 客户端没有发出额外 `GET cards` 或 `POST cards`；只有用户显式把 `sidebarRefreshMinutes` 设为正数时，卡片才按该间隔定时刷新

### Requirement: 侧边栏卡片的展开、收起与读取（流内手风琴）

标题行 SHALL 提供一个带 `aria-expanded` 的展开/收起按钮，点击 SHALL 在展开与收起之间切换；标题行其余部分（刷新按钮除外）点击效果相同。常驻卡正文与双下箭头 SHALL NOT 可点击。滚动容器 SHALL 隐藏滚动条（`scrollbar-width:none`、`-ms-overflow-style:none` 且 `::-webkit-scrollbar{display:none}`），滚动能力保留。展开时客户端 SHALL 在同一张卡内以手风琴方式显示每个上游的全部窗口、重置时间、余额、重置机会与错误：明细在流内变高、占掉侧栏列表的可用高度，SHALL NOT 以浮层覆盖列表内容；明细自身 SHALL 限高并内部滚动。收起正文与展开明细 SHALL 共用同一条溢出提示规则：容器溢出时卡片底部 SHALL 始终保留 16px 提示带；只要容器里还有内容在折叠线以下，提示带内 SHALL 显示双下箭头，滚动到底部后箭头 SHALL 隐藏（用 `visibility:hidden`，占位保留）。侧栏收起（`wide === false`）时 SHALL 只渲染一个 Magpie icon 按钮，点击打开 320px 浮层。读取 SHALL 只由用户动作或页面事件触发并以 60 秒 TTL 缓存，SHALL NOT 使用其它定时器轮询；用户显式开启的 `sidebarRefreshMinutes` 定时刷新是唯一例外，它按间隔发送全量刷新（见「侧边栏额度定时刷新」）。读取失败 SHALL NOT 影响目录同步、模型选择与生成。

#### Scenario: 标题行的开关负责展开与收起

- **GIVEN** 常驻卡已渲染
- **WHEN** 点击标题行的展开按钮，再点击展开后标题行的同一按钮
- **THEN** 第一次点击后出现明细且按钮 `aria-expanded` 为 `true`；第二次点击后明细消失、回到收起正文，`aria-expanded` 为 `false`

#### Scenario: 展开顶上去而不是盖住列表

- **GIVEN** 常驻卡已渲染，侧栏列表容器高度为 H1
- **WHEN** 点击标题行展开
- **THEN** 卡片在流内变高，侧栏列表容器高度变为 H2 且 H2 < H1；列表内容仍完整可见、不被任何浮层覆盖；收起后回到 H1

#### Scenario: 正文与双箭头不触发展开

- **GIVEN** 常驻卡已渲染且存在双下箭头
- **WHEN** 点击卡片正文或双下箭头
- **THEN** 明细不出现；双下箭头没有 `role="button"` 或键盘交互

#### Scenario: 双下箭头随滚动位置出现和消失

- **GIVEN** 常驻卡收起时正文超过 320px；展开后明细高于限高
- **WHEN** 分别渲染收起正文与展开明细
- **THEN** 两种状态在还有内容未显示时都在卡片底部显示双下箭头，滚动容器没有可见滚动条
- **AND** 滚动到底部后双下箭头隐藏，但底部提示带仍占 16px，卡片高度不变；回滚到中间时箭头再次出现

#### Scenario: 缺少重置时间显示破折号

- **GIVEN** 某窗口（如 `5 hours`）有读数但网关没有下发 `resetsAt`
- **WHEN** 渲染常驻卡
- **THEN** 该窗口的到期时间位置显示 `—`，`title` 说明网关未提供重置时间，不出现推算时间

#### Scenario: 侧栏收起只留 icon

- **GIVEN** `wide` 为 `false`
- **WHEN** 渲染 `sidebar.footer.action`
- **THEN** 只有带 `aria-label`/tooltip「Magpie 额度」的 icon 按钮，没有常驻卡与百分比
