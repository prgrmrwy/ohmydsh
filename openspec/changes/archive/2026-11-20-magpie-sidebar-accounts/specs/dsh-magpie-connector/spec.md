## ADDED Requirements

### Requirement: 侧边栏多账号分段

同一 `provider` 在本次卡片结果中有两张及以上卡片时，侧边栏常驻卡的收起形态、展开明细与侧栏收起时的浮层 SHALL 只显示一次该上游名称（卡片 `name`，缺失时 `provider`）并附账号数（中文「N 个账号」，英文「N accounts」），随后按网关顺序列出每张卡片。每张卡片 SHALL 以账号标识代替原来的上游名称位置：账号标识为卡片的 `user`；`user` 缺失或为空时为按组内顺序的「账号 N」（英文「Account N」，N 从 1 起）；有 `plan` 时附在账号标识之后。账号标识过长时 SHALL 截断显示并在 `title` 给出全文。

账号标识之下的窗口选择、窗口行、重置时间、读数、进度条、回退与失败显示 SHALL 与单账号时的规则相同，SHALL NOT 因分段减少显示的窗口或重置时间。只有一张卡片的上游 SHALL 保持原有渲染，不显示账号数或账号标识。插件 SHALL NOT 显示多账号的分配方式。

#### Scenario: 同一上游多账号分段
- **GIVEN** 网关依次返回 `{provider:"codex", name:"Codex", user:"a@example.com", plan:"prolite", windows:[{name:"7 days", used:3, resetsAt:<11/25 17:17>}]}`、`{provider:"claude", name:"Claude Code", windows:[{name:"7 days", used:20}]}`、`{provider:"codex", name:"Codex", user:"b@example.com", plan:"free", windows:[{name:"30 days", used:0, resetsAt:<12/20 16:04>}]}`；`sidebarWindows` 为 `["weekly"]`
- **WHEN** 渲染常驻卡（收起），再展开
- **THEN** 收起时依次为：`Codex` 组标题含「2 个账号」；`a@example.com`、`prolite`、`(7 days)`、`11/25 17:17`、`3%` 与进度条；`b@example.com`、`free`、`(30 days)`（回退）、`12/20 16:04`、`0%` 与进度条；然后是 `Claude Code (7 days)` 单行且没有账号标识或账号数
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

### Requirement: 侧边栏进度条只对百分比读数绘制

侧边栏常驻卡与展开明细中，一个窗口的读数显示为「无限」或网关 `display` 文本时，SHALL NOT 为该窗口绘制进度条，也 SHALL NOT 把它当作数字读数参与「读数最高的窗口」回退选择；它仍可作为最后一级的 `display`/「无限」回退显示文字。只有读数显示为 `used` 百分比的窗口才绘制进度条，读数颜色（`data-level`）同理。勾选档位的匹配规则不变：带有限 `used` 的窗口即使同时带 `display`，仍按窗口名匹配为该档位行，只是显示 `display` 文本且没有进度条。

#### Scenario: 文字读数不画进度条
- **GIVEN** `codex` 卡片窗口为 `{name:"7 days", used:3}` 与 `{name:"Image generation", used:0, display:"Unknown"}`
- **WHEN** 渲染展开明细
- **THEN** `7 days` 行显示 `3%` 并有一条进度条；`Image generation` 行显示 `Unknown` 且没有进度条

#### Scenario: 档位窗口带 display 时仍是档位行
- **GIVEN** `codex` 卡片只有 `{name:"7 days", used:20, display:"约 20%"}`，`sidebarWindows` 为 `["weekly"]`
- **WHEN** 渲染常驻卡
- **THEN** 该行为档位行 `Codex (7 days)`（窗口名没有回退说明 `title`），读数为 `约 20%`，没有进度条，读数元素没有 `data-level`

#### Scenario: 文字读数不参与回退选择
- **GIVEN** `codex` 卡片只有 `{name:"30 days", used:0}` 与 `{name:"Image generation", used:50, display:"Unknown"}`，`sidebarWindows` 为 `["weekly"]`
- **WHEN** 渲染常驻卡
- **THEN** 回退行为 `(30 days)` 与 `0%`，不是 `Image generation`

## MODIFIED Requirements

### Requirement: 侧边栏常驻额度卡

开关打开时，客户端 SHALL 在官方槽位 `sidebar.footer.action` 渲染常驻卡：每个上游显示「侧边栏显示窗口档位」勾选的窗口（默认只有 `7 days`），单行布局下窗口名照抄网关原文并紧跟名称后的括号里，多选布局见该要求；每行读数左侧 SHALL 显示该窗口的绝对重置时间（当年 `M/D HH:mm`，跨年 `YYYY/M/D HH:mm`，完整时间放在 `title` 属性）；网关未提供该窗口 `resetsAt`（例如某个滚动窗口当前无用量）时 SHALL 显示 `—` 并在 `title` 说明网关未提供重置时间，SHALL NOT 推算或补造时间。所选档位缺失时按「侧边栏显示窗口档位」回退；没有数字读数时显示网关 `display` 文本或「无限」，只有 `balance` 时显示余额，两者都没有才显示 `—`。常驻卡正文 SHALL 限高 320px，超出时在卡内滚动；容器溢出时卡片底部 SHALL 保留一行提示带（高度恒定为 16px），只要仍有内容在折叠线以下就 SHALL 在该带内显示无分割线的双下箭头，滚到底后箭头 SHALL 隐藏但提示带高度 SHALL 保留，卡片 SHALL NOT 因箭头出现/消失发生位移（详见「侧边栏卡片的展开、收起与读取」的溢出提示要求）。常驻卡 SHALL NOT 使用 border；顺序 SHALL 按网关返回顺序；同一 `provider` 有多张卡片时，这些卡片 SHALL 归到该 `provider` 在结果中首次出现的位置，组内保持网关顺序（见「侧边栏多账号分段」）；整张卡 SHALL 只有一个刷新入口；除刷新按钮外，只有标题行是交互目标。

#### Scenario: 默认档位只显示周窗口

- **GIVEN** 网关返回 6 张卡片：其中 `claude` 同时有 `5 hours` 与 `7 days` 窗口，其余各只有 `7 days`
- **WHEN** 渲染常驻卡
- **THEN** 每行的窗口名在名称后的括号中显示（如 `Claude (7 days)`），读数为对应上游的 `7 days` 读数（`claude` 不显示 `5 hours`）。
- **AND** 六个上游都渲染在卡内；正文超过 320px 时出现滚动，底部提示带显示双下箭头，卡片本身不再按「5 行」截断

#### Scenario: 收起行显示到期时间

- **GIVEN** `claude` 卡片只有 `7 days` 窗口（`used` 为 20，`resetsAt` 为本地时间 2026-11-20 11:00）
- **WHEN** 渲染常驻卡
- **THEN** 该行依次显示 `Claude (7 days)`、`11/20 11:00`、`20%`，进度条宽度为 20%
- **AND** 该行没有 `resetsAt` 时不显示到期时间，只有余额的行也不显示

#### Scenario: 缺少勾选档位时回退到最紧窗口

- **GIVEN** 某上游只有 `5 hours` 窗口（`used` 44）且没有周窗口，`sidebarWindows` 为 `["weekly"]`
- **WHEN** 渲染常驻卡
- **THEN** 该行显示 `5 hours 44%`，不显示空读数或伪造的 `7 days`，窗口名的 `title` 说明这是回退

#### Scenario: 只有余额的上游不显示破折号

- **GIVEN** 网关返回的 `deepseek` 卡片没有窗口、`balance` 为 `¥42.50`
- **WHEN** 渲染常驻卡
- **THEN** `deepseek` 行显示 `¥42.50`，没有 `—` 也没有进度条

#### Scenario: 读取失败的行不伪造读数

- **GIVEN** 网关返回的 `codex` 卡片带 `error: "token expired"`
- **WHEN** 渲染常驻卡
- **THEN** `codex` 行显示「读取失败」且没有百分比与进度条；展开卡中显示该错误文本

#### Scenario: 单一刷新入口

- **GIVEN** 常驻卡已渲染
- **WHEN** 查找所有刷新控件
- **THEN** 只有头部一个刷新按钮；点击它发出一次 `POST cards {all:true}`，每张卡片上没有独立刷新控件

#### Scenario: 同一上游卡片不相邻时归到首次出现处

- **GIVEN** 网关依次返回 `codex`（user a）、`claude`、`codex`（user b）三张卡片
- **WHEN** 渲染常驻卡
- **THEN** 顺序为 `Codex` 组（a、b）在前、`Claude Code` 在后
