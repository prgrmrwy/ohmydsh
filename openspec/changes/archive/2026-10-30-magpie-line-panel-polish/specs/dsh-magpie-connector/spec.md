## MODIFIED Requirements

### Requirement: 用量入口与颜色（AMD4）

设置页 SHALL NOT 提供独立的「用量」栏目或常驻「刷新全部」；刷新只在每张卡片上进行，单卡刷新的提示与失败原因显示在该卡片所在分组。没有卡片时，用量状态显示在连接面板，并在空或失败时提供「获取模型与用量」：先重新同步目录，成功后发一次全量刷新（`{all: true}`），同步失败则不刷新并显示原因。窗口用量条 SHALL 按 `used` 着色：≤70 蓝色（business），大于 70 且小于 90 橙色（warn），≥90 红色（error）。窗口用量条的填充段 SHALL 两端为圆角：`settingsCss` 中 `.dmg-fill` 声明的 `border-radius` SHALL 与 `.dmg-track` 相同且非零。

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

### Requirement: 只读与传输边界

插件对 Magpie 的每个网络 hop（可达性探测与线路测速除外，见下）SHALL 只落在当前生效线路地址的同一 origin 上，并且只使用以下方法和路径（相对该线路 API 根）：
- `GET /models`
- `POST /responses`
- `POST /chat/completions`
- `GET /magpie/quotas/cards`
- `POST /magpie/quotas/refresh`

插件 SHALL NOT 跟随 HTTP 重定向：收到 3xx 时以错误结束，不向重定向目标发送任何请求。插件 SHALL NOT 请求 Magpie GUI 的 `/api/*`，SHALL NOT 提供 Magpie 账号的登录、退出、添加或删除，SHALL NOT 修改 Magpie 配置。

Access 请求头 SHALL 只附加到启用 Cloudflare Access 且地址为 https 的生效线路。直连线路与任何明文 http 线路 SHALL NOT 携带 Access 头，也 SHALL NOT 因其它线路配置了 Access 而携带。相应线路的 gateway key 仍按线路使用 bearer 认证。

线路可达性探测与设置页线路测速是上述网络 hop 约束的两项例外：
- 可达性探测 MAY 连接任一参与自动选择的完整线路的 `host:port`（保持既有范围）；
- 设置页线路测速 MAY 连接任一已保存且地址可解析的线路的 `host:port`（不要求该线路完整、不要求参与自动选择）。
两项例外 SHALL NOT 发送 HTTP 请求、SHALL NOT 携带任何凭据，也不受 origin / 白名单 / 重定向规则约束。地址为空或不可解析的线路 SHALL NOT 被连接。

插件发往网关的请求 SHALL 使用插件自己的直连传输，不经过 DSH 按 `HTTP(S)_PROXY` 安装的全局代理 dispatcher。插件 SHALL NOT 提供插件级代理配置。

#### Scenario: 完整流程只触达白名单

- **GIVEN** 生效线路的网关 mock 记录收到的每个请求
- **WHEN** 依次执行：目录同步、一次生成、读取卡片、刷新一张卡片、刷新全部
- **THEN** 记录中的每个 `(method, path)` 都属于上述五项，且没有以 `/api/` 开头的路径

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

## ADDED Requirements

### Requirement: 线路测速资源接口

插件 SHALL 注册只读资源 `GET /api/dsh-magpie-connector/latency`，返回 `{lines: [{id, ms}]}`。`lines` 只包含当前已保存且地址可解析的线路，每条线路最多一条记录；`ms` 为毫秒整数（600ms 内完成建连）或 null（600ms 内未完成）。响应 SHALL NOT 含凭据、请求头或线路地址。该资源 SHALL 只处理 `GET`；其它方法 SHALL 不进入 latency 处理、由连接层返回 404，且不发起任何连接。测试通过断言注册的 `methods` 恰为 `['GET']`、且 POST 未到达处理器/未产生连接来覆盖这一契约（404 本身由连接层产生）。

#### Scenario: 响应形状与 GET-only

- **GIVEN** 两条已保存且有可解析地址的线路、一条已保存但地址为空的线路
- **WHEN** 客户端 `GET /api/dsh-magpie-connector/latency`，然后 `POST` 同一路径
- **THEN** `GET` 返回 200，`lines` 恰有两条记录且每条的 `ms` 为整数或 null；`POST` 返回 404，且请求前后都没有新增 TCP 连接

#### Scenario: 空地址线路不出现在响应中

- **GIVEN** 一条已保存但地址为空字符串的线路
- **WHEN** 客户端 `GET /api/dsh-magpie-connector/latency`
- **THEN** 响应状态为 200，`lines` 为空数组，且没有产生任何 TCP 连接

### Requirement: 线路测速生命周期

测量 SHALL 并行发起、单条截止 ≤600ms、使用单调时钟并保证非负毫秒值（DNS 解析时间计入）。同一时刻 SHALL 最多只有一组测量：并发 `GET` SHALL 共享同一次测量结果。测量结果 SHALL NOT 持久化、SHALL NOT 写入 settings、SHALL NOT 改变 `activeLineId` 或自动选择的探测缓存。插件 dispose 时 SHALL 中止进行中的测量、释放 socket，且 dispose 之后 SHALL NOT 再发起连接。

#### Scenario: 并发 GET 共享一次测量

- **GIVEN** 两条可解析地址的线路，测量被 mock 延迟
- **WHEN** 两个 `GET latency` 并发发出
- **THEN** 每条线路只出现一次 TCP 连接尝试；两次响应状态都是 200 且 `lines` 相同

#### Scenario: dispose 中止悬挂测量

- **GIVEN** 一条线路的地址不响应，测量仍在进行
- **WHEN** 插件 dispose，然后再次请求 `GET latency` 或直接调用控制器的 `read()`
- **THEN** 进行中的测量被中止且 socket 被释放；dispose 完成后不再出现新的连接尝试或响应写入；dispose 后的读取直接返回空结果且不建连

#### Scenario: 测速不写设置也不改变线路选择

- **GIVEN** settings.json 内容为 S，`activeLineId` 为线路 1
- **WHEN** 完成一次 `GET latency` 测量，随后发起一次需要选择线路的操作
- **THEN** settings.json 字节仍为 S、`activeLineId` 不变，且该操作的选择仍按「自动选择规则」重新探测，不复用测速结果
