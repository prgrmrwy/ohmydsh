## ADDED Requirements

### Requirement: 侧边栏卡片的展开、收起与读取（流内手风琴）

标题行 SHALL 提供一个带 `aria-expanded` 的展开/收起按钮，点击 SHALL 在展开与收起之间切换；标题行其余部分（刷新按钮除外）点击效果相同。常驻卡正文与双下箭头 SHALL NOT 可点击。展开时客户端 SHALL 在同一张卡内以手风琴方式显示每个上游的全部窗口、重置时间、余额、重置机会与错误：明细在流内变高、占掉侧栏列表的可用高度，SHALL NOT 以浮层覆盖列表内容；明细自身 SHALL 限高并内部滚动。侧栏收起（`wide === false`）时 SHALL 只渲染一个 Magpie icon 按钮，点击打开 320px 浮层。读取 SHALL 只由用户动作或页面事件触发并以 60 秒 TTL 缓存，SHALL NOT 使用定时器轮询；读取失败 SHALL NOT 影响目录同步、模型选择与生成。

#### Scenario: 标题行的开关负责展开与收起

- **GIVEN** 常驻卡已渲染
- **WHEN** 点击标题行的展开按钮，再点击展开后标题行的同一按钮
- **THEN** 第一次点击后出现明细且按钮 `aria-expanded` 为 `true`；第二次点击后明细消失、回到 5 行摘要，`aria-expanded` 为 `false`

#### Scenario: 展开顶上去而不是盖住列表

- **GIVEN** 常驻卡已渲染，侧栏列表容器高度为 H1
- **WHEN** 点击标题行展开
- **THEN** 卡片在流内变高，侧栏列表容器高度变为 H2 且 H2 < H1；列表内容仍完整可见、不被任何浮层覆盖；收起后回到 H1

#### Scenario: 正文与双箭头不触发展开

- **GIVEN** 常驻卡已渲染且存在双下箭头
- **WHEN** 点击卡片正文或双下箭头
- **THEN** 明细不出现；双下箭头没有 `role="button"` 或键盘交互

#### Scenario: 侧栏收起只留 icon

- **GIVEN** `wide` 为 `false`
- **WHEN** 渲染 `sidebar.footer.action`
- **THEN** 只有带 `aria-label`/tooltip「Magpie 额度」的 icon 按钮，没有常驻卡与百分比

## MODIFIED Requirements

### Requirement: 侧边栏常驻额度卡

开关打开时，客户端 SHALL 在官方槽位 `sidebar.footer.action` 渲染常驻卡：每个上游一行，显示其 `7 days` 窗口读数与整宽进度条，窗口名照抄网关原文；没有周窗口时回退到读数最高的窗口，没有数字读数时显示网关 `display` 文本或「无限」，只有 `balance` 时显示余额，两者都没有才显示 `—`。常驻卡 SHALL 最多显示 5 行，溢出时在卡内滚动，并在底部显示无分割线的双下箭头；该箭头 SHALL 只是溢出提示，SHALL NOT 可点击。常驻卡 SHALL NOT 使用 border；顺序 SHALL 按网关返回顺序；整张卡 SHALL 只有一个刷新入口；除刷新按钮外，只有标题行是交互目标。

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

- **GIVEN** 常驻卡已渲染
- **WHEN** 查找所有刷新控件
- **THEN** 只有头部一个刷新按钮；点击它发出一次 `POST cards {all:true}`，每张卡片上没有独立刷新控件

## REMOVED Requirements

### Requirement: 侧边栏卡片的展开、收起与读取
**Reason**: 展开态由绝对定位覆盖层改为流内手风琴，展开不再保持会话列表高度，而是让列表从底部让位，避免覆盖列表内容。
**Migration**: 无数据或配置迁移；行为由「侧边栏卡片的展开、收起与读取（流内手风琴）」替代，`sidebarUsage` 设置与读取策略不变。
