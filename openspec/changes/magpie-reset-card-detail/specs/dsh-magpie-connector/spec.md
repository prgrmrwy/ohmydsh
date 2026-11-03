## MODIFIED Requirements

### Requirement: 只读用量卡片

设置页 SHALL 用 `GET /magpie/quotas/cards` 的结果，按卡片的 `provider` 归入对应分组展示。卡片的 provider 在模型目录中没有对应分组时，SHALL 单独成组显示，不得丢弃。同一 provider 下的多张卡片按 `user` 分别显示。

host SHALL 把网关卡片投影为固定字段集合，再返回给浏览器，未列出的字段 SHALL NOT 跨过设置 API；所有字符串字段先按「网关连接与凭据」的规则脱敏。每张卡片 SHALL 展示网关给出的以下字段：
- `name`、`user`、`plan`、`until`、`renew`、`balance`；
- 读取时间（`readAt`，没有时取 `asOf`；有 `asOf` 时标明这是旧读数）；
- `error`；
- 每个窗口的 `name` 与读数。窗口读数规则：`unlimited` 为真时显示「无限」；否则有 `display` 时显示 `display`；否则显示 `used` 百分比，有 `resetsAt` 时附上重置时间；
- `resets` 的重置卡区 SHALL 是一个折叠块（`<details>`）：摘要行显示标题「用量限制重置」和次数，展开后逐张列出持有的每张重置卡；
- 摘要行的次数：`byWindow` 为真时按窗口显示 `fiveHour`/`weekly` 的次数（如「5 小时 2 次 · 每周 1 次」），否则在 `count` 存在时显示「可用 {count} 次」；
- 展开后的每张重置卡：种类（该项 `window` 为 `fiveHour`/`weekly` 时显示对应窗口，否则显示「完整重置」）与到期时间；到期时间 SHALL 用 `<time dateTime>` 渲染，文案取自「{时间} 到期」；该项 `until` 缺失时 SHALL 显示「到期时间不可用」，不推断日期。

`resets.each` SHALL 只投影每项的 `until` 与 `window`，拒绝其它字段。`each` 为空而 `until` 存在时，SHALL 用该 `until` 作为唯一一张重置卡列出。

最早到期的那一张重置卡（按时间取 `each` 中最早者；没有 `each` 时取单独的 `until`）SHALL 附一个相对过期提示：未来时刻显示「N 天后过期」或不足 24 小时时「N 小时后过期」，已经过去的时刻显示「已过期」；时间字符串无法解析时不显示该提示。

网关没给的字段 SHALL 省略，不显示占位值或推断值。带 `error` 的卡片 SHALL 显示该错误，不得被隐藏。

插件设置页只在打开时读取一次卡片；用户手动刷新后，用刷新响应更新显示。插件 SHALL NOT 定时请求卡片或刷新端点。卡片中的字符串一律作为文本渲染。重置卡区 SHALL 只读：不提供任何使用/消费重置卡的控件，也不请求重置相关端点。

网关返回空集合或读取失败时，连接面板 SHALL 显示空状态「Magpie 未返回可见用量」（失败时为失败原因）和「获取模型与用量」入口（见「用量入口与颜色（AMD4）」）。全量刷新之后仍然为空时，SHALL 追加提示：受限的 gateway key 无法让 Magpie 首次读取用量，需要 Magpie 管理员先在 Magpie 中读取一次，或者改用不受限的 key。插件 SHALL NOT 承诺「获取模型与用量」一定能产生卡片，也 SHALL NOT 建议扩大网关权限或共享范围。

#### Scenario: 渲染卡片字段
- **GIVEN** 卡片端点返回两张卡片：
  - claude：`{provider: "claude", plan: "max", windows: [{name: "7 days", used: 83, resetsAt: "2026-10-27T11:00:00+08:00"}, {name: "Chat", unlimited: true, display: "Unlimited"}]}`；
  - codex：`{provider: "codex", resets: {count: 1, until: "2026-11-06T23:30:34Z"}}`。
- **WHEN** 渲染设置页
- **THEN** `claude` 分组显示 `max`、`7 days 83%` 和对应的重置时间，`Chat` 窗口显示「无限」而不是 `0%`；`codex` 分组的重置折叠块摘要显示「可用 1 次」，展开区显示该过期时间，且没有与重置关联的按钮

#### Scenario: 逐张列出重置卡过期时间
- **GIVEN** codex 卡片带 `resets: {count: 3, until: "2026-11-06T23:30:34Z", each: [{until: "2026-11-06T23:30:34Z"}, {until: "2026-11-30T20:02:48Z"}]}`
- **WHEN** 渲染设置页
- **THEN** 重置区是折叠块，摘要显示「用量限制重置」「可用 3 次」；展开区逐项显示两个 `<time>`（`datetime` 分别为这两项），而不是只显示最早的 `until`

#### Scenario: 按窗口的次数
- **GIVEN** 卡片带 `resets: {byWindow: true, count: 0, fiveHour: 2, weekly: 1}`
- **WHEN** 渲染设置页
- **THEN** 摘要显示「5 小时 2 次」与「每周 1 次」，且不显示单一的总次数 `0`

#### Scenario: 相对过期提示
- **GIVEN** 卡片带 `resets: {count: 1, until: <渲染时刻 3 天后的 ISO 时间>}`
- **WHEN** 渲染设置页
- **THEN** 该重置项显示该过期时间，并附「3 天后过期」

#### Scenario: 缺失字段不伪造
- **GIVEN** codex 卡片带 `resets: {count: 2}`（没有 `until`），且没有 `plan`
- **WHEN** 渲染设置页
- **THEN** 摘要显示「可用 2 次」；渲染文本中不出现 `Invalid Date`、`undefined`、`null`，也没有计划行

#### Scenario: 缺失到期时间的重置卡
- **GIVEN** codex 卡片带 `resets: {count: 1, each: [{}]}`
- **WHEN** 渲染设置页
- **THEN** 展开区的该项显示「到期时间不可用」，且没有 `<time>` 元素

#### Scenario: 带错误的卡片仍显示
- **GIVEN** 卡片端点返回一张带 `error: "token expired"` 的 codex 卡片
- **WHEN** 渲染设置页
- **THEN** `codex` 分组中显示文本 `token expired`

#### Scenario: 无权读取用量
- **GIVEN** 卡片端点返回 403
- **WHEN** 读取设置
- **THEN** 卡片区状态为 `forbidden`；模型列表与生成不受影响

#### Scenario: 冷启动空集合
- **GIVEN** 卡片端点返回 `200 {data: []}`
- **WHEN** 渲染设置页
- **THEN** 连接面板显示「Magpie 未返回可见用量」和「获取模型与用量」按钮；插件没有自动发出任何刷新请求

#### Scenario: 卡片字符串按字面渲染
- **GIVEN** 卡片 `name` 为 `<img src=x onerror=alert(1)>`，`error` 为 `<script>x</script>`
- **WHEN** 渲染设置页
- **THEN** 两个字符串按字面出现在渲染文本中，DOM 中没有 `img` 或 `script` 元素，也没有内联事件属性

#### Scenario: 重置卡投影只保留固定字段
- **GIVEN** 网关卡片返回 `resets: {count: 2, until: "T", byWindow: true, fiveHour: 1, weekly: 1, each: [{until: "T1", window: "weekly", id: "r1", debug: "x"}], debug: "y"}`
- **WHEN** host 读取卡片
- **THEN** 返回给浏览器的 `resets` 只含 `count`、`until`、`byWindow`、`fiveHour`、`weekly`、`each`，`each` 的每项只含 `until` 与 `window`，响应中没有 `id` 或 `debug`
