## MODIFIED Requirements

### Requirement: 只读与传输边界

插件对 Magpie 的每个网络 hop（可达性探测、线路测速与线路检查除外，见下）SHALL 只落在当前生效线路地址的同一 origin 上，并且只使用以下方法和路径（相对该线路 API 根）：
- `GET /models`
- `POST /responses`
- `POST /chat/completions`
- `GET /magpie/quotas/cards`
- `POST /magpie/quotas/refresh`
- `POST /magpie/quotas/codex-reset`

带 query 的请求 SHALL 只有两种：`POST /magpie/quotas/refresh` 只允许 `provider`、`user`；`POST /magpie/quotas/codex-reset` 只允许 `user`、`credit`，且 SHALL 同时带这两项。其它组合 SHALL 在发出前被拒绝。`POST /magpie/quotas/codex-reset` SHALL 只由「使用 Codex 重置卡」的确认消费发出，插件的其它路径 SHALL NOT 请求它。

插件 SHALL NOT 跟随 HTTP 重定向：收到 3xx 时以错误结束，不向重定向目标发送任何请求。插件 SHALL NOT 请求 Magpie GUI 的 `/api/*`，SHALL NOT 提供 Magpie 账号的登录、退出、添加或删除，SHALL NOT 修改 Magpie 配置。

Access 请求头 SHALL 只附加到启用 Cloudflare Access 且地址为 https 的生效线路。直连线路与任何明文 http 线路 SHALL NOT 携带 Access 头，也 SHALL NOT 因其它线路配置了 Access 而携带。相应线路的 gateway key 仍按线路使用 bearer 认证。

线路可达性探测与设置页线路测速是上述网络 hop 约束的两项例外：
- 可达性探测 MAY 连接任一参与自动选择的完整线路的 `host:port`（保持既有范围）；
- 设置页线路测速 MAY 连接任一已保存且地址可解析的线路的 `host:port`（不要求该线路完整、不要求参与自动选择）。
两项例外 SHALL NOT 发送 HTTP 请求、SHALL NOT 携带任何凭据，也不受 origin / 白名单 / 重定向规则约束。地址为空或不可解析的线路 SHALL NOT 被连接。

线路检查（见 `magpie-line-selection`）是上述 origin 约束的第三项例外，且只限于单次检查：它 MAY 向被检查线路经过校验的 API 根发送一次 `GET /models`，只使用该线路自己的 bearer key；仅当被检查线路启用 Cloudflare Access 且地址为 https 时附加该线路的 Access 头。它 SHALL NOT 请求其它路径或任何 `/api/*`、SHALL NOT 携带其它线路的凭据，也 SHALL NOT 因被检查线路不是生效线路而改变生效线路、触发目录同步或注册路由。不跟随重定向的规则对它同样适用：检查只向被检查线路发一次 `GET /models`，收到 3xx 后不再向重定向目标或其它路径发请求。

插件发往网关的请求 SHALL 使用插件自己的直连传输，不经过 DSH 按 `HTTP(S)_PROXY` 安装的全局代理 dispatcher。插件 SHALL NOT 提供插件级代理配置。

#### Scenario: 完整流程只触达白名单

- **GIVEN** 生效线路的网关 mock 记录收到的每个请求
- **WHEN** 依次执行：目录同步、一次生成、读取卡片、刷新一张卡片、刷新全部
- **THEN** 记录中的每个 `(method, path)` 都属于上述白名单前五项，没有 `codex-reset`，且没有以 `/api/` 开头的路径

#### Scenario: 重置端点的 query 受限

- **GIVEN** 生效线路可用
- **WHEN** 插件传输层被要求发送 `POST /magpie/quotas/codex-reset?user=a%40b.com`（缺 `credit`）、`POST /magpie/quotas/codex-reset?user=a%40b.com&credit=r1&provider=x`、`GET /magpie/quotas/codex-reset?user=a%40b.com&credit=r1`
- **THEN** 三个请求都在发出前被拒绝，网关 mock 收到 0 个请求

#### Scenario: 重定向不被跟随

- **GIVEN** 生效线路的网关 mock 对 `POST /v1/responses` 返回 307，分别指向另一 origin 的 mock 和同 origin 的 `/api/usage`
- **WHEN** 发起一次生成
- **THEN** 生成以 `kind: error` 结束；另一 origin 的 mock 收到 0 个请求，同 origin 的 `/api/usage` 收到 0 个请求

#### Scenario: 存在全局代理时仍直连

- **GIVEN** 进程的全局 fetch dispatcher 被替换为会记录请求的代理 mock，网关 mock 在本机端口监听
- **WHEN** 插件执行一次目录同步
- **THEN** 网关 mock 收到 `GET /v1/models`，代理 mock 收到的请求数为 0

#### Scenario: 多线路时只触达生效线路 origin

- **GIVEN** 两条线路指向不同 origin，生效线路为线路 2
- **WHEN** 同步目录、发起一次生成、读取卡片
- **THEN** 全部 HTTP 请求只落在线路 2 origin；线路 1 origin 收到 0 个请求

#### Scenario: 明文 http 线路不携带 Access 头

- **GIVEN** 生效线路是地址为 http 的直连线路，另一条 https 线路配置了 Cloudflare Access
- **WHEN** 向生效线路发起卡片读取与生成
- **THEN** 请求中不出现 `CF-Access-Client-Id` / `CF-Access-Client-Secret`，即使 Access 凭据已在另一条线路保存

#### Scenario: 探测只建 TCP 连接不发 HTTP

- **GIVEN** 两条完整线路、一条地址可解析但未配置 key 的线路，且探测与测速的连接被记录
- **WHEN** 自动选择触发一次可达性探测，然后在设置页完成一次线路测速
- **THEN** 只能观察到 TCP 连接尝试，没有任何 HTTP 请求，也没有 bearer 或 Access 头；测速连接覆盖那条未配置 key 但地址可解析的线路

#### Scenario: 空地址线路不被测速

- **GIVEN** 一条已保存但地址为空字符串的线路，以及一条地址指向已关闭端口的线路
- **WHEN** 设置页触发一次线路测速
- **THEN** 空地址线路没有产生任何连接；关闭端口的线路产生一次 TCP 连接尝试并以超时/不可达结束；没有任何 HTTP 请求或凭据头

#### Scenario: 线路检查只触达被检查线路的 /v1/models

- **GIVEN** 线路 1 是生效线路，线路 2 是未生效的已保存线路，两条线路指向不同 origin
- **WHEN** 对线路 2 发起一次线路检查
- **THEN** 线路 2 origin 只收到 1 个 `GET /v1/models` 并带线路 2 自己的 bearer；线路 1 origin 收到 0 个请求；没有任何 `/api/*` 请求；没有发生目录同步，生效线路仍为线路 1

#### Scenario: 检查直连草稿不携带 Access 头

- **GIVEN** 已保存线路 1 启用 Cloudflare Access；被检查的草稿是地址为 https 的直连线路
- **WHEN** 发起线路检查且草稿 key 有效
- **THEN** 该请求不出现 `CF-Access-Client-Id` / `CF-Access-Client-Secret`，只带草稿自己的 bearer

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

重置折叠块的版式 SHALL 与 `dsh-plugin-subscriptions` 一致：摘要行的展开箭头宽 12px，与标题间距 6px，展开时旋转 90°；展开区每张重置卡的左缘 SHALL 与摘要行标题文字的左缘对齐（缩进 = 箭头宽 + 间距）；每张重置卡一行，种类在左、到期时间右对齐。

`resets.each` 发给浏览器时 SHALL 只投影每项的 `until` 与 `window`，拒绝其它字段；网关给出的 `id` SHALL 只留在 host 内部，供「使用 Codex 重置卡」挑选，SHALL NOT 出现在任何设置 API 响应中。host MAY 在 `resets` 上附加布尔字段 `redeemable`，表示该卡片满足「使用 Codex 重置卡」的展示前提。`each` 为空而 `until` 存在时，SHALL 用该 `until` 作为唯一一张重置卡列出。

最早到期的那一张重置卡（按时间取 `each` 中最早者；没有 `each` 时取单独的 `until`）SHALL 附一个相对过期提示：未来时刻显示「N 天后过期」或不足 24 小时时「N 小时后过期」，已经过去的时刻显示「已过期」；时间字符串无法解析时不显示该提示。

除重置卡的到期时间按上文明确标注「到期时间不可用」外，网关没给的字段 SHALL 省略，不显示占位值或推断值。带 `error` 的卡片 SHALL 显示该错误，不得被隐藏。

插件设置页只在打开时读取一次卡片；用户手动刷新后，用刷新响应更新显示。插件 SHALL NOT 定时请求卡片或刷新端点。卡片中的字符串一律作为文本渲染。除「使用 Codex 重置卡」规定的那一个按钮外，重置卡区 SHALL NOT 提供其它使用/消费重置卡的控件。

网关返回空集合或读取失败时，连接面板 SHALL 显示空状态「Magpie 未返回可见用量」（失败时为失败原因）和「获取模型与用量」入口（见「用量入口与颜色（AMD4）」）。全量刷新之后仍然为空时，SHALL 追加提示：受限的 gateway key 无法让 Magpie 首次读取用量，需要 Magpie 管理员先在 Magpie 中读取一次，或者改用不受限的 key。插件 SHALL NOT 承诺「获取模型与用量」一定能产生卡片，也 SHALL NOT 建议扩大网关权限或共享范围。

#### Scenario: 渲染卡片字段
- **GIVEN** 卡片端点返回两张卡片：
  - claude：`{provider: "claude", plan: "max", windows: [{name: "7 days", used: 83, resetsAt: "2026-10-27T11:00:00+08:00"}, {name: "Chat", unlimited: true, display: "Unlimited"}]}`；
  - codex：`{provider: "codex", resets: {count: 1, until: "2026-11-06T23:30:34Z"}}`。
- **WHEN** 渲染设置页
- **THEN** `claude` 分组显示 `max`、`7 days 83%` 和对应的重置时间，`Chat` 窗口显示「无限」而不是 `0%`；`codex` 分组的重置折叠块摘要显示「可用 1 次」，展开区显示该过期时间；因为没有 `each[].id`，没有「使用…」按钮

#### Scenario: 逐张列出重置卡过期时间
- **GIVEN** codex 卡片带 `resets: {count: 3, until: "2026-11-06T23:30:34Z", each: [{until: "2026-11-06T23:30:34Z"}, {until: "2026-11-30T20:02:48Z"}]}`
- **WHEN** 渲染设置页
- **THEN** 重置区是折叠块，摘要显示「用量限制重置」「可用 3 次」；展开区逐项显示两个 `<time>`（`datetime` 分别为这两项），而不是只显示最早的 `until`

#### Scenario: 展开条目与标题对齐
- **GIVEN** codex 卡片带两张重置卡
- **WHEN** 渲染设置页并展开重置区
- **THEN** 摘要行箭头元素宽 12px、与标题间距 6px；展开区缩进为 18px

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
- **THEN** 返回给浏览器的 `resets` 只含 `count`、`until`、`byWindow`、`fiveHour`、`weekly`、`each` 与可选的 `redeemable`，`each` 的每项只含 `until` 与 `window`，响应中没有 `id`、`r1` 或 `debug`

## ADDED Requirements

### Requirement: Codex 重置卡的使用门槛

设置页 SHALL 只在满足展示前提的卡片上提供「使用…」按钮：`provider` 为 `codex`、有非空 `user`、`resets.byWindow` 不为真，且 host 最近一次读到的 `resets.each` 中至少一张带 `id`。按钮 SHALL 只出现在展开区最早到期的那一项上。

只有满足门槛才允许使用：周窗口（名为 `7 days`）的 `used` 为数字且 ≥ 80，`resetsAt` 晚于当前时刻，卡片没有 `error`，并且存在 `id` 不为空、`until` 缺失或晚于当前时刻的重置卡。浏览器 SHALL 按当前读数预判并禁用按钮、说明原因；host SHALL 在准备与消费两个阶段，都用刚对该 `provider`/`user` 执行 `POST /magpie/quotas/refresh` 得到的卡片独立重新校验，不信任浏览器。任一项无法证明时 SHALL NOT 提交。

#### Scenario: 周用量未达门槛
- **GIVEN** codex 卡片 `user: "u@example.com"`，`windows: [{name: "7 days", used: 49, resetsAt: <未来>}]`，`resets.each` 两张均带 `id`
- **WHEN** 渲染设置页并展开重置区；再直接向 host 提交准备请求
- **THEN** 只有最早到期那一项旁有「使用…」按钮，处于禁用态，提示含「80%」；准备请求被拒绝，网关 mock 没有收到 `codex-reset`

#### Scenario: 只在最早到期那张上显示按钮
- **GIVEN** codex 卡片周用量 85%，`resets.each` 三张，到期时间分别为 11-07、12-01、12-02（网关顺序打乱）
- **WHEN** 渲染设置页并展开重置区
- **THEN** 恰有 1 个「使用…」按钮，位于到期 11-07 的那一项，且可点击

#### Scenario: 没有 id 的旧网关
- **GIVEN** 网关卡片 `resets.each` 只有 `until`，没有 `id`
- **WHEN** 渲染设置页
- **THEN** 没有「使用…」按钮，`resets.redeemable` 不为真

### Requirement: 只使用最早到期的重置卡

host SHALL 从刚读到的卡片中选出可用重置卡里 `until` 最早的一张（`until` 缺失的排最后），把其 `id` 记入确认票据。浏览器 SHALL NOT 能指定或改变所用的重置卡；消费时票据记下的那张已不在可用列表中，SHALL 拒绝，SHALL NOT 改用其它重置卡。

#### Scenario: 所选重置卡已不在
- **GIVEN** 准备时选中 `r1`；消费前网关刷新返回的 `each` 中已没有 `r1`，只有 `r2`
- **WHEN** 用户确认消费
- **THEN** 请求被拒绝，提示该重置已不可用；网关 mock 没有收到 `codex-reset`，`r2` 未被使用

### Requirement: 重置卡的两段确认

使用重置卡 SHALL 经过准备与确认两段：
1. 准备：浏览器只提交 `{provider: "codex", user}`；host 校验门槛后返回 60 秒有效的一次性票据、周用量百分比和所选卡的到期时间，不返回 `id`。
2. 确认：对话框显示账号、周用量、到期时间与不可撤销警告；勾选「我理解将消耗一次额度」之前，确认按钮 SHALL 不可用。
3. 消费：浏览器提交票据；票据不存在、过期或已用过时 SHALL 拒绝并提示重新开始；无论成败，票据只能用一次。全部校验通过后，host 才发送 `POST /magpie/quotas/codex-reset?user=<user>&credit=<id>`。

#### Scenario: 完整两段确认并成功
- **GIVEN** 网关 mock：刷新返回周用量 85%、`each: [{id: "r1", until: 11-07}, {id: "r2", until: 12-01}]`；`codex-reset` 返回 `200 {code: "reset", windows: 2}`
- **WHEN** 用户点「使用…」，在对话框勾选确认并点「消耗一次重置」
- **THEN** 网关 mock 恰好收到 1 个 `POST /v1/magpie/quotas/codex-reset?user=u%40example.com&credit=r1`；勾选前确认按钮为禁用态；完成后显示成功并更新卡片；浏览器收到的任何响应中都没有 `r1`/`r2`

#### Scenario: 票据一次性且 60 秒过期
- **GIVEN** 准备成功拿到票据
- **WHEN** 用同一票据消费两次；或在 61 秒后才消费
- **THEN** 第二次与过期的消费都被拒绝并提示重新开始；网关 mock 至多收到 1 个 `codex-reset`

### Requirement: 同一时刻只允许一个重置

整个插件同一时刻 SHALL 最多存在一张有效票据和一个进行中的准备或消费。新的准备请求 SHALL 作废此前未用的票据；已有准备或消费在进行时，新的准备与消费请求 SHALL 被拒绝并提示已有重置正在进行。

#### Scenario: 不同账号也不能同时使用
- **GIVEN** 账号 A 的消费已提交、网关尚未返回
- **WHEN** 用户对账号 B 点「使用…」
- **THEN** 准备请求被拒绝并提示已有重置正在进行；A 返回前网关 mock 只收到 1 个 `codex-reset`

### Requirement: 重置结果判定与不确定锁定

host SHALL 按网关响应分类结果：
- 2xx 且 `code` 为 `reset`：成功，显示重置的窗口数，并用一次刷新响应更新卡片；`nothing_to_reset`（未消耗）、`no_credit`、`already_redeemed` 显示对应说明；未知 `code` 原样显示；
- 4xx（含权限不足、409 正在使用、入口白名单拒绝）：未消耗，显示脱敏后的网关错误；
- 网络错误、超时、5xx，或 2xx 但响应无法解析：结果不确定。host SHALL 把该账号锁定到插件 host 重启为止，期间对该账号的准备与消费一律拒绝，并提示先去 Magpie 核对；SHALL NOT 自动重试。

浏览器到 host 的消费请求超时 SHALL 不短于 host 对网关请求的超时；浏览器侧超时也按结果不确定提示。

#### Scenario: 结果不确定时锁定
- **GIVEN** `codex-reset` 请求在网关返回前连接中断（或返回 502）
- **WHEN** 消费结束，用户再次对同一账号点「使用…」
- **THEN** 第一次显示「结果无法确认，请先在 Magpie 核对，不要重试」；第二次准备被拒绝；网关 mock 只收到过 1 个 `codex-reset`

#### Scenario: 网关明确拒绝时不锁定
- **GIVEN** `codex-reset` 返回 `401`，错误体说明需要完整权限的 gateway key
- **WHEN** 消费结束，用户再次对同一账号点「使用…」
- **THEN** 第一次显示脱敏后的网关错误；第二次可以正常进入准备阶段

#### Scenario: 未消耗的结果
- **GIVEN** `codex-reset` 返回 `200 {code: "nothing_to_reset", windows: 0}`
- **WHEN** 消费结束
- **THEN** 界面说明没有窗口需要重置、重置卡未被消耗；该账号未被锁定

