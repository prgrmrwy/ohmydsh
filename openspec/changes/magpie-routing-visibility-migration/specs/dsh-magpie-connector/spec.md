## MODIFIED Requirements

### Requirement: 按 provider 分组的模型可见性
设置页 SHALL 按网关模型的 `owned_by` 分组；没有 `owned_by` 的模型，取 id 中第一个 `/` 之前的部分作为分组。路由入口（设置响应中带 `routingKind` 的模型行，见「路由入口识别」）例外：它们 SHALL 只出现在键为 `routing` 的「路由组」分区，该分区排在所有 provider 分区之前；厂商分区不再包含路由入口。一个 provider 只剩路由入口、且没有该 provider 的用量卡片时，SHALL NOT 显示该 provider 的空分区；有用量卡片时照常显示该分区（只含卡片）。

「路由组」分区顶部 SHALL 说明路由组在 Magpie 中新建和编辑；每行显示可见性勾选框、名称、类型（自定义 / 自动，取自设置响应模型行的 `routingKind`）以及（有 `reasoning_levels` 时）默认 effort 下拉。插件 SHALL NOT 提供创建、编辑路由组或展示其成员的控件。

每个分区（含「路由组」）的可见性语义：
- 没有保存过选择：跟随网关模型列表，全部可见；
- 保存过选择（包括空列表）：只显示列表中的模型，之后新上架的模型默认隐藏。

保存过选择的分区 SHALL 提供「恢复跟随网关列表」，该操作只删除本分区自己的键。路由入口的可见性 SHALL 只由 `routing` 键决定，不受其 `owned_by` 对应键的白名单影响。

**0.7 之前设置的一次性迁移**：目录同步成功后，若已保存的可见性中没有 `routing` 键，且某个路由入口的 id 出现在它 0.7 之前的可见性键（`owned_by` 原值，缺失时为 id 首段）列表中，插件 SHALL 一次性改写可见性：`routing` 键为本次目录中按旧规则可见的路由入口（旧键未保存过选择，或旧键列表含该 id），并从各键列表中移除路由入口 id，其余键与 id 不变（列表变空时保留空数组）。已有 `routing` 键时 SHALL NOT 改写；写盘失败时保持原设置，下次同步重试。插件 SHALL NOT 为此迁移会话中保存的模型选择。

选择器 SHALL 只提供「网关目录 ∩ 可见集」中的模型。可见性是 DSH 侧本地偏好，SHALL NOT 回写网关。保存时只校验形状（键 → 字符串数组），不与当前目录比对。形状非法时 SHALL 以 400 拒绝。

#### Scenario: 未设置时跟随网关
- **GIVEN** `codex` 组未保存过可见性，网关新增 `codex/gpt-6-nova`
- **WHEN** 目录同步后列举模型
- **THEN** 列表包含 `codex/gpt-6-nova`

#### Scenario: 设置后严格按白名单与目录求交集
- **GIVEN** 以下状态同时成立：
  - `claude` 组保存了可见集 `[claude/claude-opus-5-5, claude/claude-haiku-5-5]`，其中 `claude/claude-haiku-5-5` 已不在网关目录中；
  - 网关新增了 `claude/claude-fable-5-2`；
  - `deepseek` 组保存了可见集 `[]`。
- **WHEN** 列举模型，并读取设置
- **THEN** `claude/` 前缀的模型恰为 `claude/claude-opus-5-5`；不含任何 `deepseek/` 前缀的模型；设置中 `claude/claude-fable-5-2` 为 `visible: false`；可见集记录仍保留 `claude/claude-haiku-5-5`

#### Scenario: 形状非法被拒绝
- **GIVEN** 已保存的可见性为 V
- **WHEN** 客户端提交 `{codex: "codex/gpt-6-luna"}`（值不是数组）
- **THEN** 响应状态为 400，已保存的可见性仍为 V

#### Scenario: 路由组只受 routing 键控制
- **GIVEN** 网关目录含 `{id:"group/ds", owned_by:"opencode-go"}`、`{id:"auto/glm-5", owned_by:"opencode-go"}` 与 `{id:"opencode-go/kimi-k3", owned_by:"opencode-go"}`；可见性保存了 `{"opencode-go": ["opencode-go/kimi-k3"]}`，没有 `routing` 键
- **WHEN** 列举模型并读取设置
- **THEN** `group/ds`、`auto/glm-5` 都可见；设置响应 `groups` 中 `provider: "routing"` 的组恰含这两个模型，其 `routingKind` 依次为 `custom`、`auto`；`opencode-go` 组恰含 `opencode-go/kimi-k3`

#### Scenario: 只有路由组时仍能恢复跟随网关
- **GIVEN** 网关目录只有 `group/solo`（无用量卡片）；用户取消再勾选 `group/solo`，保存了 `{"routing": ["group/solo"]}` 与 `{"claude": []}`
- **WHEN** 网关新增 `group/new`，渲染设置页，点击「路由组」分区的「恢复跟随网关列表」，再列举模型
- **THEN** 点击前 `group/new` 隐藏且分区显示「恢复跟随网关列表」；点击后 `visibleModels` 不含 `routing` 键而 `claude` 键不变，列举结果含 `group/solo` 与 `group/new`

#### Scenario: provider 只剩路由入口时不留空分区
- **GIVEN** 网关目录只有 `{id:"group/ds", owned_by:"opencode-go"}` 与 `{id:"claude/claude-fable-5-2", owned_by:"claude"}`，没有 `opencode-go` 的用量卡片
- **WHEN** 渲染设置页
- **THEN** 分区依次为「路由组」与 `claude`；没有 `data-provider="opencode-go"` 的分区

#### Scenario: provider 只剩路由入口但有用量卡片时保留分区
- **GIVEN** 网关目录只有 `{id:"group/ds", owned_by:"opencode-go"}`；用量卡片端点返回一张 `provider: "opencode-go"` 的卡片
- **WHEN** 渲染设置页
- **THEN** 存在 `data-provider="opencode-go"` 的分区，其中有该用量卡片而没有模型行；`group/ds` 只出现在「路由组」分区

#### Scenario: 路由组分区说明与无编辑控件
- **GIVEN** 网关目录含 `group/ds`
- **WHEN** 渲染设置页
- **THEN** 「路由组」分区含说明文本（中文界面为「在 Magpie 中新建和编辑路由组；这里决定是否在 DSH 显示及默认推理强度」）；该分区内的控件只有可见性勾选框、默认 effort 下拉与「恢复跟随网关列表」按钮

#### Scenario: 0.7 之前保存在厂商键下的路由入口可见性被迁移
- **GIVEN** 已保存 `visibleModels` 为 `{"opencode-go": ["opencode-go/kimi-k3", "group/ds"]}`；目录含 `opencode-go/kimi-k3`、`group/ds` 与 `group/hidden`（`owned_by: "opencode-go"`）、`auto/glm-5`（`owned_by: "claude"`）
- **WHEN** 目录同步
- **THEN** 设置文件 `visibleModels` 为 `{"opencode-go": ["opencode-go/kimi-k3"], "routing": ["group/ds", "auto/glm-5"]}`；`dsh-magpie-connector-routing` 列举恰为 `group/ds`、`auto/glm-5`

#### Scenario: 无需迁移或已有 routing 键时不改写
- **GIVEN** 已保存 `visibleModels` 依次为 `{"opencode-go": ["opencode-go/kimi-k3"]}` 与 `{"opencode-go": ["group/ds"], "routing": ["auto/glm-5"]}`，目录同上
- **WHEN** 分别目录同步
- **THEN** 两种情况下设置文件 `visibleModels` 都保持原样

### Requirement: 侧边栏多账号分段

同一 `provider` 在本次卡片结果中有两张及以上卡片时，侧边栏常驻卡的收起形态、展开明细与侧栏收起时的浮层 SHALL 只显示一次该上游名称（卡片 `name`，缺失时 `provider`）并附账号数（中文「N 个账号」，英文「N accounts」），随后按网关顺序列出每张卡片。每张卡片 SHALL 以账号标识代替原来的上游名称位置：账号标识为卡片的 `user`；`user` 缺失或为空时为按组内顺序的「账号 N」（英文「Account N」，N 从 1 起）；有 `plan` 时附在账号标识之后。收起形态中，单窗口账号的第一行只显示账号标识，第二行依次显示 `plan`、窗口名（未提到组标题时）、到期时间与读数；只有账号标识可以截断（截断时在 `title` 给出全文），`plan`、窗口名、到期时间与读数 SHALL 完整显示，不截断、不相互重叠，放不下时到期时间与读数整体换到下一行。多窗口账号仍为账号标识与 `plan` 一行、每窗口一行。组内每个账号都恰好显示同一个窗口名（且回退状态相同）时，该窗口名 SHALL 只在组标题中以括号显示一次（如 `Codex (7 days)`「4 个账号」），各账号的窗口行不再重复窗口名；否则窗口名留在各账号的窗口行上。展开明细与浮层中账号标识为段落标题。

账号标识之下的窗口选择、窗口行、重置时间、读数、进度条、回退与失败显示 SHALL 与单账号时的规则相同，SHALL NOT 因分段减少显示的窗口或重置时间。只有一张卡片的上游 SHALL 保持原有渲染，不显示账号数或账号标识。插件 SHALL NOT 显示多账号的分配方式。

#### Scenario: 同一上游多账号分段
- **GIVEN** 网关依次返回 `{provider:"codex", name:"Codex", user:"a@example.com", plan:"prolite", windows:[{name:"7 days", used:3, resetsAt:<11/25 17:17>}]}`、`{provider:"claude", name:"Claude Code", windows:[{name:"7 days", used:20}]}`、`{provider:"codex", name:"Codex", user:"b@example.com", plan:"free", windows:[{name:"30 days", used:0, resetsAt:<12/20 16:04>}]}`；`sidebarWindows` 为 `["weekly"]`
- **WHEN** 渲染常驻卡（收起），再展开
- **THEN** 收起时依次为：`Codex` 组标题含「2 个账号」且不含窗口名（两账号窗口不同）；`a@example.com` 一行，其下 `prolite`、`7 days`、`11/25 17:17`、`3%` 与进度条；`b@example.com` 一行，其下 `free`、`30 days`（回退）、`12/20 16:04`、`0%` 与进度条；然后是 `Claude Code (7 days)` 单行且没有账号标识或账号数
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
- **THEN** 组标题为 `Codex`、`(7 days)`、「4 个账号」；四个账号第一行为账号标识，第二行为完整的 `self_serve_business_prolite`、到期时间与读数，且不含 `7 days`

#### Scenario: 只有账号标识可截断
- **WHEN** 读取插件样式表
- **THEN** `.dmg-sidebar-plan`、`.dmg-sidebar-expiry`、`.dmg-sidebar-pct` 都声明 `flex:none` 且 `.dmg-sidebar-plan` 不含 `ellipsis`；`.dmg-sidebar-account` 声明 `text-overflow:ellipsis` 与 `min-width:0`
