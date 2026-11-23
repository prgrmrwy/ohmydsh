## MODIFIED Requirements

### Requirement: 侧边栏额度开关

插件设置页 SHALL 提供侧边栏用量开关（与 Magpie 官方用语对齐，侧栏相关文案统一称「用量」（重置卡相关的「重置额度」等文案不变）：中文开关文案为「在侧边栏常驻显示用量」，侧栏标题为「Magpie 用量」；`role="switch"`，默认关闭），其值 SHALL 持久化在插件 host 设置的 `sidebarUsage` 布尔字段中；字段缺失时按 `false` 处理，写入非布尔值 SHALL 被拒绝（400）且设置不变。开关关闭时，客户端 SHALL NOT 渲染任何侧栏额度 UI，也 SHALL NOT 发起卡片请求。

#### Scenario: 开关关闭时不渲染也不请求

- **GIVEN** `sidebarUsage` 为 `false`
- **WHEN** 侧栏渲染完成
- **THEN** `sidebar.footer.action` 中没有额度卡片与 icon，客户端没有发出 `GET cards`

#### Scenario: 开关持久化

- **GIVEN** 设置页把 `sidebarUsage` 写为 `true`
- **WHEN** 重新读取设置
- **THEN** 返回的 `sidebarUsage` 为 `true`；写入 `"yes"` 等非布尔值返回 400 且设置不变

### Requirement: 侧边栏卡片的展开、收起与读取（流内手风琴）

标题行 SHALL 提供一个带 `aria-expanded` 的展开/收起按钮，点击 SHALL 在展开与收起之间切换；标题行其余部分（刷新按钮除外）点击效果相同。常驻卡正文与双下箭头 SHALL NOT 可点击。滚动容器 SHALL 隐藏滚动条（`scrollbar-width:none`、`-ms-overflow-style:none` 且 `::-webkit-scrollbar{display:none}`），滚动能力保留。展开时客户端 SHALL 在同一张卡内以手风琴方式显示每个上游的全部窗口（网关 `display` 文字读数窗口除外，见「侧边栏进度条只对百分比读数绘制」）、重置时间、余额、重置机会与错误：明细在流内变高、占掉侧栏列表的可用高度，SHALL NOT 以浮层覆盖列表内容；明细自身 SHALL 限高并内部滚动。收起正文与展开明细 SHALL 共用同一条溢出提示规则：容器溢出时卡片底部 SHALL 始终保留 16px 提示带；只要容器里还有内容在折叠线以下，提示带内 SHALL 显示双下箭头，滚动到底部后箭头 SHALL 隐藏（用 `visibility:hidden`，占位保留）。侧栏收起（`wide === false`）时 SHALL 只渲染一个 Magpie icon 按钮，点击打开 320px 浮层。读取 SHALL 只由用户动作或页面事件触发并以 60 秒 TTL 缓存，SHALL NOT 使用其它定时器轮询；用户显式开启的 `sidebarRefreshMinutes` 定时刷新是唯一例外，它按间隔发送全量刷新（见「侧边栏额度定时刷新」）。读取失败 SHALL NOT 影响目录同步、模型选择与生成。

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
- **THEN** 只有带 `aria-label`/tooltip「Magpie 用量」的 icon 按钮，没有常驻卡与百分比

### Requirement: 侧边栏多账号分段

同一 `provider` 在本次卡片结果中有两张及以上卡片时，侧边栏常驻卡的收起形态、展开明细与侧栏收起时的浮层 SHALL 只显示一次该上游名称（卡片 `name`，缺失时 `provider`）并附账号数（中文「N 个账号」，英文「N accounts」），随后按网关顺序列出每张卡片。每张卡片 SHALL 以账号标识代替原来的上游名称位置：账号标识为卡片的 `user`；`user` 缺失或为空时为按组内顺序的「账号 N」（英文「Account N」，N 从 1 起）；有 `plan` 时附在账号标识之后。收起形态中，每个账号先占一行（账号标识与 `plan`），其下再显示窗口行；只有账号标识可以截断（截断时在 `title` 给出全文），`plan`、窗口名、到期时间与读数 SHALL 完整显示，不截断、不相互重叠。组内每个账号都恰好显示同一个窗口名（且回退状态相同）时，该窗口名 SHALL 只在组标题中以括号显示一次（如 `Codex (7 days)`「4 个账号」），各账号的窗口行不再重复窗口名；否则窗口名留在各账号的窗口行上。展开明细与浮层中账号标识为段落标题。

账号标识之下的窗口选择、窗口行、重置时间、读数、进度条、回退与失败显示 SHALL 与单账号时的规则相同，SHALL NOT 因分段减少显示的窗口或重置时间。只有一张卡片的上游 SHALL 保持原有渲染，不显示账号数或账号标识。插件 SHALL NOT 显示多账号的分配方式。

#### Scenario: 同一上游多账号分段
- **GIVEN** 网关依次返回 `{provider:"codex", name:"Codex", user:"a@example.com", plan:"prolite", windows:[{name:"7 days", used:3, resetsAt:<11/25 17:17>}]}`、`{provider:"claude", name:"Claude Code", windows:[{name:"7 days", used:20}]}`、`{provider:"codex", name:"Codex", user:"b@example.com", plan:"free", windows:[{name:"30 days", used:0, resetsAt:<12/20 16:04>}]}`；`sidebarWindows` 为 `["weekly"]`
- **WHEN** 渲染常驻卡（收起），再展开
- **THEN** 收起时依次为：`Codex` 组标题含「2 个账号」且不含窗口名（两账号窗口不同）；`a@example.com` 与 `prolite` 一行，其下 `7 days`、`11/25 17:17`、`3%` 与进度条；`b@example.com` 与 `free` 一行，其下 `30 days`（回退）、`12/20 16:04`、`0%` 与进度条；然后是 `Claude Code (7 days)` 单行且没有账号标识或账号数
- **AND** 展开后 `Codex` 只作为组标题出现一次，两段的段落标题分别为 `a@example.com` 与 `b@example.com`，各自列出自己的全部窗口；`Claude Code` 段落不变

#### Scenario: 多账号且勾选多个档位
- **GIVEN** 两张 `provider:"claude"`、`name:"Claude Code"` 卡片，`user` 分别为 `a@example.com`（`plan:"max"`）与 `b@example.com`，各有 `5 hours` 与 `7 days` 窗口；`sidebarWindows` 为 `["fiveHour","weekly"]`
- **WHEN** 渲染常驻卡
- **THEN** 先是组标题 `Claude Code`「2 个账号」；然后 `a@example.com` 与 `max` 一行，其下 `5 hours`、`7 days` 两行各带到期时间、读数与进度条；然后 `b@example.com` 一行，其下同样两行

#### Scenario: 组内一个账号失败、一个只有余额
- **GIVEN** 两张 `provider:"deepseek"` 卡片：`{user:"a", error:"HTTP 502"}` 与 `{user:"b", balance:"¥42.50"}`
- **WHEN** 渲染常驻卡，再展开
- **THEN** 收起时组标题「2 个账号」下，`a` 行显示「读取失败」且没有百分比与进度条，`b` 行显示 `¥42.50` 且没有进度条；展开后 `a` 段显示 `HTTP 502`，`b` 段显示余额

#### Scenario: 侧栏收起时浮层也分段
- **GIVEN** 「同一上游多账号分段」的卡片，`wide` 为 `false`
- **WHEN** 点击 Magpie icon 打开浮层
- **THEN** 浮层内 `Codex` 组标题只出现一次并含「2 个账号」，两段的段落标题为 `a@example.com` 与 `b@example.com`

#### Scenario: 多账号缺少 user
- **GIVEN** 三张 `provider:"codex"` 卡片，`user` 依次缺失、为 `"  "`、为 `c@example.com`，各有 `7 days` 窗口
- **WHEN** 渲染常驻卡
- **THEN** 账号标识依次为「账号 1」「账号 2」「c@example.com」；渲染文本不出现 `undefined`；渲染过程中没有 React 重复 key 警告

#### Scenario: 账号标识过长时截断
- **GIVEN** 两张 codex 卡片，其中一张 `user` 为 60 个字符
- **WHEN** 渲染常驻卡
- **THEN** 该账号标识元素（`[data-dmg-sidebar-account]`）的 `title` 为完整的 60 字符 `user`，且带 `dmg-sidebar-account` 类；插件样式表中 `.dmg-sidebar-account` 声明 `text-overflow:ellipsis` 与 `min-width:0`

#### Scenario: 组内同一窗口时窗口名提到组标题
- **GIVEN** 四张 `provider:"codex"`、`name:"Codex"` 卡片，`plan` 均为 `self_serve_business_prolite`，各只有 `7 days` 窗口；`sidebarWindows` 为 `["weekly"]`
- **WHEN** 渲染常驻卡
- **THEN** 组标题为 `Codex`、`(7 days)`、「4 个账号」；四个账号行各显示账号标识与完整的 `self_serve_business_prolite`，其下窗口行显示到期时间与读数但不含 `7 days`

#### Scenario: 只有账号标识可截断
- **WHEN** 读取插件样式表
- **THEN** `.dmg-sidebar-plan`、`.dmg-sidebar-expiry`、`.dmg-sidebar-pct` 都声明 `flex:none` 且 `.dmg-sidebar-plan` 不含 `ellipsis`；`.dmg-sidebar-account` 声明 `text-overflow:ellipsis` 与 `min-width:0`

### Requirement: 侧边栏进度条只对百分比读数绘制

侧边栏展开明细与浮层 SHALL NOT 列出读数为网关 `display` 文本的窗口（如 Codex 的 `Image generation` `Unknown`），这类窗口只在设置页用量卡片中显示；「无限」窗口照常列出。带有限 `used` 又带 `display` 的窗口同样按文字读数处理：可作为收起形态的档位行显示，但不列入展开明细与浮层。侧边栏常驻卡与展开明细中，一个窗口的读数显示为「无限」或网关 `display` 文本时，SHALL NOT 为该窗口绘制进度条，也 SHALL NOT 把它当作数字读数参与「读数最高的窗口」回退选择；它仍可作为最后一级的 `display`/「无限」回退显示文字。只有读数显示为 `used` 百分比的窗口才绘制进度条，读数颜色（`data-level`）同理。勾选档位的匹配规则不变：带有限 `used` 的窗口即使同时带 `display`，仍按窗口名匹配为该档位行，只是显示 `display` 文本且没有进度条。

#### Scenario: 文字读数不画进度条
- **GIVEN** `codex` 卡片窗口为 `{name:"7 days", used:3}` 与 `{name:"Image generation", used:0, display:"Unknown"}`
- **WHEN** 渲染侧栏展开明细
- **THEN** 明细只列出 `7 days` 一行，显示 `3%` 并有一条进度条；渲染文本中没有 `Image generation` 与 `Unknown`

#### Scenario: 档位窗口带 display 时仍是档位行
- **GIVEN** `codex` 卡片只有 `{name:"7 days", used:20, display:"约 20%"}`，`sidebarWindows` 为 `["weekly"]`
- **WHEN** 渲染常驻卡
- **THEN** 该行为档位行 `Codex (7 days)`（窗口名没有回退说明 `title`），读数为 `约 20%`，没有进度条，读数元素没有 `data-level`

#### Scenario: 文字读数不参与回退选择
- **GIVEN** `codex` 卡片只有 `{name:"30 days", used:0}` 与 `{name:"Image generation", used:50, display:"Unknown"}`，`sidebarWindows` 为 `["weekly"]`
- **WHEN** 渲染常驻卡
- **THEN** 回退行为 `(30 days)` 与 `0%`，不是 `Image generation`
