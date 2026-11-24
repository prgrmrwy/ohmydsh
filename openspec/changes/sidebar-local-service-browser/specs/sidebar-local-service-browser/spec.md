## ADDED Requirements

### Requirement: 地址栏输入解析与显示
系统 SHALL 在 better-sidebar 工作台提供单实例「本地服务」tab。地址栏 SHALL 只接受主机为 `127.0.0.1`、`localhost` 或 `[::1]`、**显式写出端口**的 `http:` 地址（可以省略 `http://`）。端口 SHALL 从原始输入文本中读取，不经 WHATWG 的默认端口折叠，且必须是 1–65535 的十进制整数。`127.0.0.1` 与 `localhost` SHALL 映射到目标族 `p`（连接 Host 的 `127.0.0.1`），`[::1]` SHALL 映射到 `p6`（连接 Host 的 `::1`）。以下输入 MUST NOT 加载 iframe，并 SHALL 显示对应的错误提示：含用户信息、反斜杠或控制字符；主机不是回环地址；协议为 `https:`；没有写端口。地址栏 SHALL 显示直接地址（`http://127.0.0.1:<端口>/…` 或 `http://[::1]:<端口>/…`），MUST NOT 显示代理前缀。

#### Scenario: 输入本机地址后加载对应代理并显示直接地址
- **GIVEN** 「本地服务」tab 已打开且浏览器满足支持条件
- **WHEN** 用户输入 `localhost:5173/app?x=1#top` 并回车
- **THEN** iframe 的初始导航地址为 `/dsh-local-service/p/5173/app?x=1#top`
- **AND** 地址栏显示 `http://127.0.0.1:5173/app?x=1#top`

#### Scenario: 默认端口不被折叠
- **GIVEN** 「本地服务」tab 已打开
- **WHEN** 用户输入 `http://localhost:80/`
- **THEN** iframe 的初始导航地址为 `/dsh-local-service/p/80/`

#### Scenario: IPv6 回环地址连接 Host 的 ::1
- **GIVEN** 「本地服务」tab 已打开
- **WHEN** 用户输入 `[::1]:8080/`
- **THEN** iframe 的初始导航地址为 `/dsh-local-service/p6/8080/`
- **AND** 地址栏显示 `http://[::1]:8080/`

#### Scenario: 非法输入不加载
- **GIVEN** 「本地服务」tab 正在显示某个页面
- **WHEN** 用户依次输入 `http://example.com:8080/`、`http://user@127.0.0.1:5173/`、`127.0.0.1:70000`、`127.0.0.1`
- **THEN** 每次 iframe 的地址都保持不变
- **AND** tab 依次显示「仅支持本机地址」「地址不能包含用户信息」「端口无效」「需要写明端口」

### Requirement: 代理请求的认证与来源限制
Host SHALL 在 DSH 同源 web server 上注册前缀路由 `/dsh-local-service`，以及精确升级路由 `/dsh-local-service/ws`。本插件前缀路由下的每个 HTTP 请求（包括代理路径 `/dsh-local-service/p/…`、`/dsh-local-service/p6/…` 与 `/dsh-local-service/sw.js`）都 MUST 依次满足两项：(1) 官方 `connection.requestRejection(req)` 返回 `undefined`；(2) 请求头 `Sec-Fetch-Site` 为 `same-origin` 或 `none`。第一项不满足时 MUST 原样返回其状态码（401/403）；第二项不满足时（包括缺少该头）MUST 返回 403。两种情况下都 MUST NOT 向任何上游建立连接。浏览器不会在 WebSocket 升级请求中发送 `Sec-Fetch-Site`，因此升级请求只要求通过 `connection.requestRejection(req)`，后者会精确比对 `Origin` 与 `Host`（含端口）。

#### Scenario: 已认证的同源请求被转发
- **GIVEN** Host 本机 `127.0.0.1:5173` 有 HTTP 服务对 `/` 返回 `200 hello`；请求带有效 DSH 浏览器会话，且 `Sec-Fetch-Site: same-origin`
- **WHEN** 请求访问 `/dsh-local-service/p/5173/`
- **THEN** 响应状态为 200，响应正文以 `hello` 结尾
- **AND** 上游收到的请求行路径为 `/`，`Host` 头为 `127.0.0.1:5173`

#### Scenario: 未认证请求不触达上游
- **GIVEN** 真实 connection 服务判定该请求未认证（没有 `dsh-auth-*` cookie）
- **WHEN** 请求访问 `/dsh-local-service/p/5173/`
- **THEN** 响应状态为 401
- **AND** 上游测试服务收到的连接数为 0

#### Scenario: 其它本机网页借用会话被拒绝
- **GIVEN** 请求带有效 DSH 会话 cookie，`Sec-Fetch-Site: same-site`，且没有 `Origin` 头（模拟另一个回环端口页面里的 `<img>`）
- **WHEN** 请求访问 `/dsh-local-service/p/5173/delete`
- **THEN** 响应状态为 403
- **AND** 上游测试服务收到的连接数为 0

#### Scenario: sw.js 适用同一来源检查
- **GIVEN** 三个都带有效 DSH 会话 cookie 的 `GET /dsh-local-service/sw.js` 请求，`Sec-Fetch-Site` 依次为 `same-origin`、`same-site` 与缺失
- **WHEN** 请求到达 Host
- **THEN** 响应状态依次为 200（`Content-Type: text/javascript`）、403、403

#### Scenario: 缺少 Sec-Fetch-Site 被拒绝
- **GIVEN** 请求带有效 DSH 会话 cookie，没有 `Sec-Fetch-Site` 头
- **WHEN** 请求访问 `/dsh-local-service/p/5173/`
- **THEN** 响应状态为 403，且上游连接数为 0

#### Scenario: 跨端口 Origin 的升级被拒绝
- **GIVEN** 升级请求带有效 DSH 会话 cookie，但 `Origin` 为 `http://127.0.0.1:9999`，而 `Host` 为 `127.0.0.1:3080`
- **WHEN** 请求升级 `/dsh-local-service/ws?fam=p&port=5173&path=%2Fecho`
- **THEN** socket 被关闭，上游连接数为 0

### Requirement: 代理目标限制
通过认证后，系统 SHALL 只连接两类地址：`p` 族的 `127.0.0.1:<端口>`，或 `p6` 族的 `[::1]:<端口>`。端口段不是 1–65535 的十进制整数时 MUST 返回 400。每个请求 SHALL 现场读取 `ctx.webServer.port`：它不是正整数时 MUST 返回 503；目标端口等于它时 MUST 返回 400。这两种情况都 MUST NOT 连接上游。上游拒绝连接，或在 10 秒内未建立连接时，SHALL 返回 502，响应正文包含目标端口号。已建立的响应流 MUST NOT 受总时长限制。

#### Scenario: 指向 DSH 自身端口被拒绝
- **GIVEN** DSH web server 实际监听端口为 41234
- **WHEN** 已认证请求访问 `/dsh-local-service/p/41234/`
- **THEN** 响应状态为 400，且没有向 `127.0.0.1:41234` 发起代理连接

#### Scenario: Host 端口未知时拒绝
- **GIVEN** `ctx.webServer.port` 为 `undefined`
- **WHEN** 已认证请求访问 `/dsh-local-service/p/5173/`
- **THEN** 响应状态为 503，且上游连接数为 0

#### Scenario: 上游无服务时返回 502
- **GIVEN** Host 本机 `127.0.0.1:5999` 没有服务监听
- **WHEN** 已认证请求访问 `/dsh-local-service/p/5999/`
- **THEN** 响应状态为 502，响应正文包含 `5999`

#### Scenario: 长流不被总时长截断
- **GIVEN** 上游 5173 的 `/events` 是每 5 秒发送一条事件的 SSE 流
- **WHEN** 已认证请求访问 `/dsh-local-service/p/5173/events`，持续 30 秒
- **THEN** 客户端收到全部 6 条事件，连接未被代理关闭

### Requirement: 请求与响应头的凭据处理
转发请求时，系统 SHALL 按以下规则处理请求头：
- `Cookie`：MUST 只转发名称以 `dshls.<A>.<族>.<端口>.` 开头的 cookie，并去掉该前缀；没有这样的 cookie 时不发送 `Cookie` 头。
- `Proxy-Authorization`：MUST 删除。
- `Authorization`：SHALL 原样转发给本次请求的目标。代理 MUST NOT 自行添加该头。
- `Origin`：存在时 SHALL 改写为目标的上游地址形式（`http://127.0.0.1:<端口>` 或 `http://[::1]:<端口>`）。
- `Referer`：存在时 SHALL 改写为目标上游地址加 `/`。
- 条件请求头：`Sec-Fetch-Dest` 为 `iframe` 或 `document` 的请求 SHALL 删除 `If-None-Match` 与 `If-Modified-Since`。

上游响应中的每个 `Set-Cookie` SHALL 改写为：名称加前缀 `dshls.<A>.<族>.<端口>.`，`Path` 固定为 `/`，删除 `Domain`，其余属性保持不变。上游响应的 `Service-Worker-Allowed` 头 MUST 删除。

`<A>` 是 DSH authority 哈希：对本次请求 `Host` 头的值求 SHA-256，取 base64url 编码的前 8 个字符。`Host` 的值就是浏览器看到的 DSH `host:port`，经 Cockpit 访问时即隧道的本地端口。下文场景以 `h1` 表示 `Host: 127.0.0.1:3080` 时的值。不同 DSH authority 的代理 cookie MUST NOT 互相转发。

本要求只保证 Host 转发时对 cookie 的过滤，不构成浏览器内的隔离，具体有两点：
- 原 `Path` 不再生效，同一端口的 cookie 对该端口的所有路径都可见。
- 浏览器 cookie 不按端口区分，这些 cookie 也会被发往浏览器所在电脑上同一回环主机的其它端口，包括其它 DSH 隧道和 Cockpit。`HttpOnly` 属性保持不变。

#### Scenario: 只有本端口的代理 cookie 被转发
- **GIVEN** 浏览器请求带有 `dsh-auth-AbC=sig`、`dshls.h1.p.5173.sid=abc`、`dshls.h1.p.4000.sid=zzz`、`other=1`，以及 `Proxy-Authorization: Basic x`、`Authorization: Bearer t`
- **WHEN** 请求经代理转发到 `127.0.0.1:5173`
- **THEN** 上游收到的 `Cookie` 头恰为 `sid=abc`，`Authorization` 为 `Bearer t`
- **AND** 上游没有收到 `Proxy-Authorization`

#### Scenario: 另一台机器的代理 cookie 不被转发
- **GIVEN** 浏览器请求的 `Host` 为 `127.0.0.1:3080`，并带有 `dshls.h1.p.5173.sid=abc` 与 `dshls.h2.p.5173.sid=other`，其中 `h2` 为 `127.0.0.1:3081` 的 authority 哈希
- **WHEN** 请求经代理转发到 `127.0.0.1:5173`
- **THEN** 上游收到的 `Cookie` 头恰为 `sid=abc`

#### Scenario: 上游 Set-Cookie 被改名并放到根路径
- **GIVEN** 上游 5173 响应 `Set-Cookie: sid=abc; Path=/api; Domain=localhost; HttpOnly`
- **WHEN** 响应经代理返回浏览器
- **THEN** 浏览器收到 `Set-Cookie: dshls.h1.p.5173.sid=abc; HttpOnly; Path=/`

#### Scenario: Origin 与 Referer 改写为上游地址
- **GIVEN** 请求带 `Origin: http://127.0.0.1:3080` 与 `Referer: http://127.0.0.1:3080/form?x=1`
- **WHEN** 请求转发到 5173
- **THEN** 上游收到 `Origin: http://127.0.0.1:5173` 与 `Referer: http://127.0.0.1:5173/`

#### Scenario: 文档请求去掉条件头
- **GIVEN** 请求带 `Sec-Fetch-Dest: iframe` 与 `If-None-Match: "v1"`
- **WHEN** 请求转发到 5173
- **THEN** 上游没有收到 `If-None-Match`

### Requirement: 重定向与外部跳转
系统 SHALL 删除上游响应的 `X-Frame-Options`，以及 CSP 中的 `frame-ancestors` 指令。上游 `Location` SHALL 以上游请求 URL 为基准，按 WHATWG URL 规则解析，然后按结果分三种情况处理：
- 本族本端口：改写为 `/dsh-local-service/<族>/<端口>/…`。
- 其它回环主机或端口：改写为对应族与端口的代理路径。
- 其它主机：如果请求是导航（`Sec-Fetch-Mode: navigate`），SHALL 改为返回 `200 text/html` 的提示页。提示页包含该外部地址，以及一个「在新窗口打开」链接（`target="_blank" rel="noopener"`）。iframe MUST NOT 被导航到外部来源。如果请求不是导航，`Location` 原样保留。

#### Scenario: 根路径与协议相对重定向
- **GIVEN** 上游 5173 对 `/` 依次返回 `302 Location: /login` 与 `302 Location: //localhost:4000/cb`
- **WHEN** 经代理分别请求
- **THEN** 响应的 `Location` 依次为 `/dsh-local-service/p/5173/login` 与 `/dsh-local-service/p/4000/cb`

#### Scenario: 导航遇到外部重定向时返回提示页
- **GIVEN** 上游返回 `302 Location: https://sso.example.com/x`，请求带 `Sec-Fetch-Mode: navigate`
- **WHEN** 响应经代理返回
- **THEN** 响应状态为 200，`Content-Type` 为 `text/html`，正文含 `https://sso.example.com/x` 和一个 `rel="noopener"` 的链接

#### Scenario: 禁嵌头被移除
- **GIVEN** 上游返回 `X-Frame-Options: DENY` 与 `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`
- **WHEN** 响应经代理返回
- **THEN** 响应没有 `X-Frame-Options`，`frame-ancestors` 指令已从 CSP 中删除

### Requirement: HTML 注入与传输语义
对 `Content-Type` 为 `text/html`、方法不是 HEAD、状态码不是 204、206 或 304 的响应，系统 SHALL 注入一段内联 `<script nonce="<N>">`（即注入脚本），规则如下：
- 注入位置：跳过开头的 BOM、空白、doctype 和注释之后，插在第一个其它标签之前。结束位置 SHALL 按 HTML 分词规则判定：
  - 注释：`<!-->` 与 `<!--->` 立即结束，其它情况取最先出现的 `-->` 或 `--!>`。
  - doctype：遇到第一个 `>` 即结束。

  有两种情况 SHALL 改为插在**开头尚未结束的那个注释或 doctype 之前**：该 token 直到输入结束都没有结束；或者某个上游数据块到达后仍无法确定插入位置，且该数据块与此前尚未输出的字节合计**超过** 256 KiB（262144 字节）。此前各数据块中已识别并结束的开头 BOM、空白、注释和 doctype 已经输出，不计入合计；本数据块内新识别的部分在这次判断之后才输出，所以仍计入。因此，未输出的缓冲量最多为 256 KiB 加一个数据块。插在这个位置，注入脚本依旧先于页面中任何元素与脚本执行。直到输入结束都没有找到其它标签、且开头的 token 都已结束时，插在已读内容的末尾。
- nonce：`<N>` 为每个响应新生成的随机 nonce。
- CSP 改写：对上游 `Content-Security-Policy` 响应头中的每条策略，先确定生效的脚本指令：有 `script-src-elem` 就用它，否则用 `script-src`，再否则用 `default-src`。生效指令存在时，按以下规则处理：
  - 指令只靠 `'unsafe-inline'` 放行内联脚本（含 `'unsafe-inline'`，且不含任何 nonce、hash 或 `'strict-dynamic'`）：不改动。
  - 其它情况：SHALL 在该指令中追加 `'nonce-<N>'`。指令中已有 nonce、hash 或 `'strict-dynamic'` 时，浏览器会忽略 `'unsafe-inline'`，因此同样必须追加。
- 编码：系统 SHALL 以 `Accept-Encoding: identity` 请求上游。上游仍返回 `gzip`、`deflate` 或 `br` 编码的 HTML 时，SHALL 先解压再注入；其它编码 MUST 返回 502。
- 响应头：注入后的响应 SHALL 删除 `Content-Length`、`ETag` 与 `Last-Modified`，并设置 `Cache-Control: no-store`。
- 流式：注入 SHALL 流式进行，MUST NOT 等待上游正文结束。唯一的例外是有界缓冲：插入位置还没确定时，系统会缓冲尚未输出的字节，直到确定位置，或触发上文按数据块合计超过 256 KiB 的回退（未输出缓冲量最多为 256 KiB 加一个数据块）；位置一旦确定，SHALL 立即输出注入脚本和已缓冲的内容，之后的内容直接透传。
- 透传：非 HTML 响应，以及 HEAD、204、206、304 响应的正文 SHALL 逐字节透传。

客户端中止请求时，系统 SHALL 在 1 秒内销毁对应的上游连接。

#### Scenario: 注入在任何页面脚本之前并加入 nonce
- **GIVEN** 上游返回 `Content-Security-Policy: script-src 'nonce-r4nd' 'strict-dynamic'`，正文为 `<!doctype html><script>fetch('http://localhost:8000/x')</script><html><head><title>t</title>`
- **WHEN** 响应经代理返回
- **THEN** 正文中注入脚本位于 `<!doctype html>` 之后、页面原有 `<script>` 之前
- **AND** CSP 为 `script-src 'nonce-r4nd' 'strict-dynamic' 'nonce-<N>'`，`<N>` 与注入标签的 `nonce` 属性相同

#### Scenario: unsafe-inline 策略不被收紧
- **GIVEN** 上游返回 `Content-Security-Policy: script-src 'self' 'unsafe-inline'`
- **WHEN** 响应经代理返回
- **THEN** CSP 头值不变

#### Scenario: unsafe-inline 与已有 nonce 共存时仍追加
- **GIVEN** 上游返回 `Content-Security-Policy: script-src 'unsafe-inline' 'nonce-old'`，正文含一个 `<script nonce="old">` 和一个不带 nonce 的内联 `<script>`
- **WHEN** 页面在 Chromium 中经代理加载
- **THEN** CSP 为 `script-src 'unsafe-inline' 'nonce-old' 'nonce-<N>'`
- **AND** 注入脚本与带 `nonce="old"` 的脚本都执行，不带 nonce 的内联脚本不执行

#### Scenario: gzip HTML 解压后注入，未知编码拒绝
- **GIVEN** 上游无视 identity，两次分别返回 `Content-Encoding: gzip` 与 `Content-Encoding: zstd-x` 的 HTML
- **WHEN** 响应经代理返回
- **THEN** 前者响应为已解压、已注入的 HTML，且没有 `Content-Encoding`、`ETag`，`Cache-Control` 为 `no-store`；后者响应状态为 502

#### Scenario: 带脚本的 404 页面同样注入
- **GIVEN** 上游对 `/missing` 返回 `404 text/html`，正文含 `<script>`
- **WHEN** 响应经代理返回
- **THEN** 响应状态仍为 404，正文以注入脚本开头（在 doctype 之后）

#### Scenario: 超长未结束的开头注释触发有界回退
- **GIVEN** 上游先发送 `<!--` 加 262144 个 `x`（共 262148 字节，超过 256 KiB，且注释未结束），之后暂停，不发送剩余内容
- **WHEN** 经代理请求
- **THEN** 客户端在 2 秒内收到的字节以注入脚本开头（位于 `<!--` 之前）
- **AND** 上游随后发送 `--><script>…</script>` 并结束；最终正文在浏览器中解析时，注入脚本先于该页面脚本执行

#### Scenario: 流式 HTML 先到先发
- **GIVEN** 上游先发送 `<html><head></head><body>a`，10 秒后才发送剩余内容
- **WHEN** 经代理请求
- **THEN** 客户端在 2 秒内收到包含注入脚本和 `a` 的字节

#### Scenario: 非 HTML 与 HEAD 不改写正文
- **GIVEN** 上游对 GET 返回 1 MiB 的 `application/octet-stream`，对 HEAD 返回 `text/html` 与 `Content-Length: 500`
- **WHEN** 经代理请求
- **THEN** GET 的正文与上游逐字节相同；HEAD 响应没有正文，并保留 `Content-Length: 500`

### Requirement: 禁止被代理页面注册 Service Worker
代理路径上带 `Service-Worker: script` 请求头的请求，系统 MUST 返回 403，且不连接上游。注入脚本 SHALL 使被代理页面调用 `navigator.serviceWorker.register()` 时返回被拒绝的 Promise（`SecurityError`）。「本地服务」tab 每次挂载时，SHALL 注销所有脚本 URL 以 `/dsh-local-service/p` 开头的 Service Worker 注册。

#### Scenario: 上游宽作用域注册被拒绝
- **GIVEN** 上游 5173 提供 `/sw.js`，并带响应头 `Service-Worker-Allowed: /`
- **WHEN** DSH 同源页面直接调用原生方法 `navigator.serviceWorker.register('/dsh-local-service/p/5173/sw.js', { scope: '/' })`
- **THEN** 浏览器对该脚本的请求得到 403，注册失败
- **AND** 上游没有收到 `/sw.js` 请求

#### Scenario: 页面内注册调用被拒绝
- **GIVEN** 被代理页面已加载注入脚本
- **WHEN** 页面调用 `navigator.serviceWorker.register('/sw.js')`
- **THEN** 返回的 Promise 以 `SecurityError` 拒绝，上游没有收到 `/sw.js` 请求

#### Scenario: 残留注册被清理
- **GIVEN** 测试 profile 中存在一个脚本 URL 为 `/dsh-local-service/p/5173/sw.js` 的注册
- **WHEN** 「本地服务」tab 挂载
- **THEN** 该注册被注销；作用域为 `/dsh-local-service/` 的本插件注册不受影响

### Requirement: 本插件 Service Worker 改写受控页面的子请求
前端 SHALL 注册一个 Service Worker：脚本为 `/dsh-local-service/sw.js`，作用域为 `/dsh-local-service/`。Host SHALL 以 `Content-Type: text/javascript`、`Cache-Control: no-store` 提供该脚本，且不带 `Service-Worker-Allowed`。

该 Service Worker SHALL 以 client 为单位记录所属的族与端口：
- 来源：处理导航请求时，按 `resultingClientId` 与目标代理路径记录。
- 存储：记录 SHALL 同步写入内存，并通过 `event.waitUntil` 持久化到 IndexedDB。查询时先查内存，再查 IndexedDB。

对受控 client 发出的请求，按以下规则处理：
- 同源且路径不以 `/dsh-local-service/` 开头：改写为该 client 的 `/dsh-local-service/<族>/<端口>/<原路径>`。
- `http://127.0.0.1|localhost:<端口>/…`：改写为 `/dsh-local-service/p/<端口>/…`；`http://[::1]:<端口>/…`：改写为 `/dsh-local-service/p6/<端口>/…`。
- 其它来源：原样放行。
- 同源请求所属 client 查不到记录时：Service Worker MUST 返回状态 502 的合成响应，MUST NOT 原样放行。

#### Scenario: 根路径资源改写到当前端口
- **GIVEN** 受控页面由 `/dsh-local-service/p/5173/` 加载，且注入脚本已把文档地址改为 `/`
- **WHEN** 页面请求 `/assets/main.js`
- **THEN** 网络上实际发出的请求为 `/dsh-local-service/p/5173/assets/main.js`

#### Scenario: 写死的另一本机端口地址被改写
- **GIVEN** 受控页面由 `/dsh-local-service/p/5173/` 加载
- **WHEN** 页面执行 `fetch('http://localhost:8000/api/x')`
- **THEN** 网络上实际发出的请求为 `/dsh-local-service/p/8000/api/x`，且浏览器所在电脑的 8000 端口没有收到连接

#### Scenario: Service Worker 重启后仍按原端口改写
- **GIVEN** 受控页面由 `/dsh-local-service/p/5173/` 加载，随后 Service Worker 被终止（通过 DevTools 协议 `ServiceWorker.stopWorker`）
- **WHEN** 页面请求 `/api/data`
- **THEN** 网络上实际发出的请求为 `/dsh-local-service/p/5173/api/data`

#### Scenario: 未知 client 不放行
- **GIVEN** 某个受控 client 在内存和 IndexedDB 中都没有记录
- **WHEN** 它请求同源的 `/api/x`
- **THEN** 该请求得到状态 502 的合成响应，DSH 的 `/api/x` 没有收到请求

#### Scenario: DSH 主页面不受控
- **GIVEN** 本插件 Service Worker 已激活
- **WHEN** DSH 主页面请求 `/api/sessions`
- **THEN** DSH 主页面的 `navigator.serviceWorker.controller` 为 `null`

### Requirement: 页面看到直接地址，导航留在代理内
注入脚本 SHALL 是文档中第一个执行的脚本，并依次完成以下步骤：
1. 检查 `navigator.serviceWorker.controller`。不存在时，SHALL 调用 `window.stop()`，向父窗口报告「未受控」，并且不执行后续步骤。这一步只保证注入脚本自身停止安装并报告，不保证页面中已被解析的脚本不执行。
2. 用 `history.replaceState` 把文档地址从 `/dsh-local-service/<族>/<端口><rest>` 改为 `<rest>`，使页面读到的 `location.pathname`、`location.search`、`location.hash` 与直接访问上游时一致。
3. 维护历史身份表，规则如下：
   - **存储位置**：注入脚本 SHALL 在安装任何存储包装之前，先取得原生 `sessionStorage` 引用。身份表存于该原生对象的保留键 `__dshls.entries.<frameId>` 中，`<frameId>` 是 tab 写在 iframe `data-dshls` 属性上的随机 id。
   - **记录内容**：表中以 `navigation.currentEntry.key` 为键，值为 `{ fam, port, rest }`，`rest` 取当前的 `location.pathname + location.search + location.hash`。
   - **写入时机**：步骤 2 完成后立即写入一次，之后每次 `currententrychange` 都再写入一次。这样，应用自己的 `pushState`、`replaceState`、hash 变化以及同文档 traverse 产生的条目都会有身份。
   - **剪除失效条目**：每次写入时，删除 key 不在 `navigation.entries()` 中的记录。身份表最多保留 500 条，超出时删除最早写入的记录。
   - **与页面存储包装的关系**：保留键不带 `dshls.<A>.<族>.<端口>.` 前缀，因此页面看到的 `sessionStorage` 包装对象看不到它，包装对象的 `clear()` 也不会删除它。
   - **结构校验**：值必须是对象，每条记录必须形如 `{ fam: "p" | "p6", port: 十进制数字字符串, rest: 以 "/" 开头的字符串 }`。
   - **跨文档合并**：同一 frame 内跨文档导航后，新文档 SHALL 先读出已有的表再合并写入，MUST NOT 丢弃之前文档写入、仍在 `navigation.entries()` 中的条目。
   - **失败处理**：读取、解析、校验或写入身份表时出现任何异常或不合格（例如 `QuotaExceededError`、值不是合法 JSON、JSON 合法但结构不符），注入脚本 SHALL 调用 `window.stop()`、向 tab 报告「身份表不可用」，且 MUST NOT 继续执行后续步骤。tab 收到报告后 SHALL 把 iframe 导航到 `about:blank` 并显示该错误。
   - **清理归属**：tab 挂载时，SHALL 只删除那些 `<frameId>` 不属于当前文档中任何存活 `iframe[data-dshls]` 的 `__dshls.entries.*` 键；卸载时，SHALL 只删除自己 `<frameId>` 对应的键。
   - 注入脚本 MUST NOT 读写应用的 Navigation API state。
4. 监听 Navigation API 的 `navigate` 事件，处理跨文档导航：
   - 目标为同源非代理路径或本机回环地址，且事件可取消（`location.assign/replace`、`location.href` 赋值、链接点击、`reload`）：SHALL 调用 `preventDefault()`，再按原类型导航到对应的代理路径（`push` 保持 push，`replace` 与 `reload` 用 replace）。
   - 导航带表单数据且有 `sourceElement`（表单）：SHALL 把该表单的 `action` 改为代理路径后，原生重新提交，保留 method、正文与文件。
   - 目标为其它来源，且事件可取消：SHALL 取消导航，并通知 tab 显示「外部链接」提示条。提示条带一个由用户点击、在新窗口打开该地址的链接。
5. 在 `submit` 事件的捕获阶段，把指向同源非代理路径或本机回环地址的表单 `action` 改写为代理路径。

iframe 每次导航完成，以及同文档地址变化后，tab SHALL 把当前地址还原为直接地址，显示在地址栏。

#### Scenario: 页面读到无前缀的路径
- **GIVEN** 用户在地址栏输入 `127.0.0.1:5173/dashboard?tab=2`
- **WHEN** 上游页面中第一个页面自有脚本读取 `location.pathname + location.search`
- **THEN** 读到 `/dashboard?tab=2`

#### Scenario: location.assign 到根路径留在代理内
- **GIVEN** iframe 显示 5173 的页面
- **WHEN** 页面执行 `location.assign('/login')`
- **THEN** iframe 的下一次网络导航请求为 `/dsh-local-service/p/5173/login`，DSH 没有收到 `/login` 请求
- **AND** 地址栏显示 `http://127.0.0.1:5173/login`

#### Scenario: location.replace 与 reload 也被改写
- **GIVEN** iframe 显示 5173 的 `/a`
- **WHEN** 页面执行 `location.replace('http://localhost:5173/b')`，随后执行 `location.reload()`
- **THEN** 两次网络导航请求都是 `/dsh-local-service/p/5173/b`，且 `navigation.entries().length` 没有增加

#### Scenario: 程序化表单提交保留 POST 正文
- **GIVEN** iframe 显示 5173 的页面，页面中有一个 `method="POST" action="/form"` 的表单，字段为 `b=2`
- **WHEN** 页面调用 `form.submit()`
- **THEN** 上游收到 `POST /form`，正文为 `b=2`

#### Scenario: 外部链接改为提示条
- **GIVEN** iframe 显示 5173 的页面
- **WHEN** 页面执行 `location.href = 'https://example.com/'`
- **THEN** iframe 地址不变；tab 显示「外部链接」提示条，其中链接的 `href` 为 `https://example.com/`，`target` 为 `_blank`

#### Scenario: 身份表写入失败时停止
- **GIVEN** 以下三种情况之一：原生 `sessionStorage` 已被填满；`__dshls.entries.<frameId>` 的值为 `not-json`；该值为 `{"k1":{"fam":"x","port":"5173","rest":"/"}}`（JSON 合法但结构不符）
- **WHEN** iframe 加载 5173 的代理页面
- **THEN** 注入脚本报告「身份表不可用」，且没有替换 `WebSocket` 构造函数
- **AND** iframe 地址变为 `about:blank`，tab 显示该错误

#### Scenario: 页面清空 sessionStorage 不影响身份表
- **GIVEN** iframe 显示 5173 的页面，身份表中已有当前条目的记录
- **WHEN** 页面执行 `sessionStorage.clear()`
- **THEN** 原生 `sessionStorage.getItem('__dshls.entries.<frameId>')` 仍包含当前条目 key 的记录

#### Scenario: 失效条目被剪除且不影响其它 frame
- **GIVEN** 身份表 `__dshls.entries.f1` 中有一个 key 不在 iframe f1 的 `navigation.entries()` 中，另有键 `__dshls.entries.f2`
- **WHEN** f1 中的页面执行 `history.pushState(null, '', '/x')`
- **THEN** `__dshls.entries.f1` 中不再有该失效 key，`__dshls.entries.f2` 的值不变

#### Scenario: 跨文档导航后旧条目仍保留
- **GIVEN** iframe f1 显示 5173 的 `/a`，身份表中记录了该条目的 key k1
- **WHEN** 页面整页导航到 4000 的 `/b`，新文档的注入脚本写入了自己条目的 key k2
- **THEN** 原生 `sessionStorage.getItem('__dshls.entries.f1')` 同时包含 k1（`{p, 5173, /a}`）与 k2（`{p, 4000, /b}`）

#### Scenario: 跨文档导航并重载后仍能按旧条目恢复
- **GIVEN** iframe（`data-dshls="f1"`）先显示 5173 的 `/a`，再整页导航到 4000 的 `/b`
- **WHEN** 页面执行 `location.reload()`，随后执行 `history.back()`
- **THEN** 重载后 iframe 的 `data-dshls` 仍为 `f1`；原生 `sessionStorage.getItem('__dshls.entries.f1')` 中仍有 `/a` 条目 key 对应的 `{p, 5173, /a}`
- **AND** 后退后 5173 收到 `/a` 请求，4000 没有收到 `/a` 请求，地址栏显示 `http://127.0.0.1:5173/a`

#### Scenario: 挂载与卸载不删除其它存活 frame 的表
- **GIVEN** 当前文档中存在一个存活的 `iframe[data-dshls="f2"]`，原生 sessionStorage 中有 `__dshls.entries.f0`、`__dshls.entries.f2`，其中 f0 已不对应任何存活 iframe
- **WHEN** 一个新的 tab 实例以 frameId f1 挂载，随后又卸载
- **THEN** 挂载后 `__dshls.entries.f0` 被删除，`__dshls.entries.f2` 保持不变；卸载后 `__dshls.entries.f1` 被删除，`__dshls.entries.f2` 仍保持不变

#### Scenario: pushState 后地址栏同步
- **GIVEN** iframe 显示 5173 的 `/`
- **WHEN** 页面执行 `history.pushState(null, '', '/settings')`
- **THEN** 地址栏显示 `http://127.0.0.1:5173/settings`

### Requirement: tab 内历史前进后退按条目身份恢复
跨文档的后退或前进无法取消，浏览器会先请求无前缀地址。系统 SHALL 以 `navigation.currentEntry.key` 在历史身份表中查出 `{族, 端口, rest}`，按它恢复，MUST NOT 用当前端口推断。按落到的路径分两种情况：
- 落到 DSH index（`/` 或 `/index.html`）：
  - Host SHALL 通过官方 `webServer.tapIndex` 注册一个变换，把守卫脚本插到第一个 `<head …>` 开始标签之后。`tapIndex` 在所有结构化注入行渲染完后才执行，所以守卫位于这些行之前。
  - 官方 `frontend-static` 在 `renderIndex` 之后，还会在 `<head>` 后插入 `<base href="./">`。因此最终响应中守卫 SHALL 是**第一个可执行脚本**，允许它前面有这个 `<base>` 元素。
  - 守卫只在 `window.frameElement` 带 `data-dshls` 属性时生效：先执行 `window.stop()`；查到身份时，再 `location.replace` 到根绝对的代理路径 `/dsh-local-service/<族>/<端口><rest>`，该路径不受 `<base>` 影响。
  - 在顶层页面或不带 `data-dshls` 的 iframe 中，守卫 MUST NOT 产生任何效果。
  - 在带 `data-dshls` 的 iframe 中，DSH index 里位于守卫之后的脚本 MUST NOT 执行。
- 落到其它路径：DSH 对这些路径返回 404 或同名的静态资源。tab 在 iframe 的 `load` 事件中发现文档没有注入标记时，SHALL 按身份表查出身份，并 `location.replace` 到对应的代理路径。

条目没有身份记录时，tab SHALL 把 iframe 导航到 `about:blank`，并显示「无法恢复该历史记录」。系统 MUST NOT 支持书签，也 MUST NOT 支持把无前缀地址放到 tab iframe 之外打开。

#### Scenario: 跨端口后退回到正确的服务
- **GIVEN** iframe 先整页导航到 5173 的 `/form`，再整页导航到 4000 的 `/page2`
- **WHEN** 页面执行 `history.back()`
- **THEN** 4000 端口没有收到 `/form` 请求，5173 收到了 `/form` 请求
- **AND** 地址栏显示 `http://127.0.0.1:5173/form`

#### Scenario: 应用内路由变化后跨端口后退
- **GIVEN** iframe 在 5173 的 `/spa` 中依次执行 `history.pushState(null, '', '/spa/route2')` 与 `history.replaceState({ app: 1 }, '', '/spa/route3')`，随后整页导航到 4000 的 `/page2`
- **WHEN** 页面执行 `history.back()`
- **THEN** 5173 收到 `/spa/route3` 请求，4000 没有收到该请求
- **AND** 地址栏显示 `http://127.0.0.1:5173/spa/route3`

#### Scenario: 后退到根路径时 DSH 不启动
- **GIVEN** DSH index 中有一个测试哨兵脚本：在带 `data-dshls` 的 iframe 中执行时会上报；且已通过正向对照确认，没有守卫时该哨兵会上报
- **AND** iframe 先整页导航到 5173 的 `/`，再整页导航到 5173 的 `/page3`
- **WHEN** 页面执行 `history.back()`
- **THEN** 5173 收到第二个 `/` 请求，哨兵的上报次数为 0

#### Scenario: 最终 index 流水线中守卫是首个可执行脚本
- **GIVEN** 真实的 `renderIndex` 与 `frontend-static` 流水线；两个测试插件通过 `webserver/index-inject` 注册了 head 脚本行，其中一个在本插件之前激活，另一个在本插件之后激活；本插件注册了 `tapIndex` 守卫
- **WHEN** 分别请求 `/` 与 `/index.html`
- **THEN** 两份响应中第一个 `<script>` 元素都是守卫，它前面只允许出现 `<base href="./">`
- **AND** 在顶层页面与不带 `data-dshls` 的 iframe 中加载时，index 中的哨兵脚本会上报；在带 `data-dshls` 且身份可查的 iframe 中加载时，哨兵不上报

#### Scenario: 没有身份记录时不猜测
- **GIVEN** iframe 落到一个文档：没有前缀，没有注入标记，且当前条目的 key 在身份表中查不到
- **WHEN** tab 处理该次加载
- **THEN** iframe 地址变为 `about:blank`，tab 显示「无法恢复该历史记录」，没有向任何上游端口发起请求

### Requirement: 页面内 cookie 与存储视图按端口隔开
注入脚本 SHALL 覆盖 `Document.prototype.cookie`：
- 读取：只返回名称以 `dshls.<A>.<族>.<端口>.` 开头的 cookie，并去掉该前缀。
- 写入：给名称加上该前缀，`Path` 设为 `/`，删除 `Domain`。

注入脚本 SHALL 用以 `dshls.<A>.<族>.<端口>.` 为键前缀的包装对象替换页面的 `localStorage` 与 `sessionStorage`，使 `getItem`、`setItem`、`removeItem`、`key()`、`length`、`clear()` 只作用于本端口的键；注入脚本 SHALL 将 `window.cookieStore` 设为 `undefined`。这些措施只用于防止误用和键冲突，MUST NOT 被描述为安全隔离。

#### Scenario: JS 读写 cookie 使用原名
- **GIVEN** 上游以 `Set-Cookie: csrftoken=t1; Path=/start` 设置了 cookie，页面随后被 `replaceState` 改到 `/start`
- **WHEN** 页面读取 `document.cookie`，然后执行 `document.cookie = 'theme=dark'`
- **THEN** 读到的字符串包含 `csrftoken=t1`，且不含 `dsh-auth-`
- **AND** 下一次发往上游的请求，其 `Cookie` 头包含 `csrftoken=t1` 与 `theme=dark`

#### Scenario: localStorage.clear 不影响 DSH 的键
- **GIVEN** DSH 主页面在 localStorage 中存有键 `dsh.settings`
- **WHEN** 被代理页面执行 `localStorage.setItem('a','1'); localStorage.clear()`
- **THEN** DSH 主页面中 `localStorage.getItem('dsh.settings')` 仍为原值

### Requirement: WebSocket 代理
注入脚本 SHALL 包装页面的 `WebSocket` 构造函数：URL 解析为同源地址或本机回环地址时，SHALL 改写为 `ws(s)://<当前 DSH 主机>/dsh-local-service/ws?fam=<族>&port=<端口>&path=<编码后的 origin-form 路径与查询>`。同源地址的族与端口取当前文档记录的值。

Host 在精确升级路由 `/dsh-local-service/ws` 上处理升级请求：
- 校验：`fam`、`port` 的规则与 HTTP 代理相同；`path` MUST 以 `/` 开头，且不含 CR、LF、空白或 `#`。不满足时 MUST 关闭 socket，且不连接上游。
- 转发：通过校验后，SHALL 向上游发起升级。转发的请求头只包括：`Sec-WebSocket-Key`、`Sec-WebSocket-Version`、`Sec-WebSocket-Protocol`、`Sec-WebSocket-Extensions`、`User-Agent`，按 cookie 规则过滤后的 `Cookie`，以及改写为上游地址形式的 `Origin`。
- 上游返回非 101 时，SHALL 关闭客户端 socket。
- 建立后：SHALL 双向透传数据，包括握手时已读到的 `head` 字节；任一端关闭时，SHALL 在 1 秒内关闭另一端。

#### Scenario: 带登录态的 WebSocket 透传
- **GIVEN** 上游 5173 的 `/echo` 只接受带 cookie `sid=abc` 的升级，浏览器中有 `dshls.h1.p.5173.sid=abc`（`Path=/`）
- **WHEN** 被代理页面执行 `new WebSocket('ws://localhost:5173/echo', ['v1'])`，并发送 `ping`
- **THEN** 页面收到 `ping`；上游收到的升级路径为 `/echo`，`Sec-WebSocket-Protocol` 为 `v1`，`Cookie` 为 `sid=abc`

#### Scenario: 只连 WebSocket 的另一端口也可用
- **GIVEN** 被代理页面属于 5173，从未通过 HTTP 访问过 8000；上游 8000 的 `/ws` 是回显服务
- **WHEN** 页面执行 `new WebSocket('ws://127.0.0.1:8000/ws')`，并发送 `x`
- **THEN** 页面收到 `x`

#### Scenario: 非法 path 被拒绝
- **GIVEN** 一个已认证的升级请求
- **WHEN** `path` 参数解码后为 `/x\r\nHost: evil`
- **THEN** socket 被关闭，上游连接数为 0

#### Scenario: 上游拒绝升级时关闭客户端
- **GIVEN** 上游对升级请求返回 `403`
- **WHEN** 已认证客户端请求升级
- **THEN** 客户端连接被关闭，未收到 101

### Requirement: 前置条件不满足时失败闭合（尽力而为）
tab 在加载任何代理页面前 SHALL 检查以下条件：`navigator.serviceWorker` 存在，`window.navigation` 存在，本插件 Service Worker 注册成功并在 5 秒内处于 active。任一条件不满足时，tab MUST NOT 设置 iframe 地址，并 SHALL 显示具体原因。

注入脚本报告「未受控」时，tab SHALL 重新加载 iframe 一次；再次未受控时，SHALL 把 iframe 导航到 `about:blank`，并显示错误。

iframe 加载了位于代理路径、但没有注入标记的文档时，tab SHALL 把 iframe 导航到 `about:blank`，并根据该文档的 `document.contentType` 区分两种情况：
- 不是 `text/html`：显示标题「这个地址返回的不是网页」，并说明内容类型。iframe 窗口的 `performance.getEntriesByType('navigation')` 第一项存在、其 `responseStatus` 为正整数时，同时显示状态码；条目不存在、属性缺失或值为 0 时，只显示内容类型，不显示状态码。tab MUST NOT 提供在 tab 之外打开该代理地址的链接。
- 是 `text/html`：显示「页面阻止了注入脚本」。

这些检查只是尽力而为：系统不保证所有情况下都不会访问浏览器所在电脑的回环地址。已知的例外 SHALL 写进 README：
- 页面在 Worker 中发起的请求和 WebSocket；
- 页面再嵌套的 iframe；
- 页面未受控或身份表不可用时，`window.stop()` 之前已被解析器读入的页面脚本可能仍会执行一次。

#### Scenario: 浏览器不支持 Navigation API
- **GIVEN** `window.navigation` 为 `undefined`
- **WHEN** 用户输入 `127.0.0.1:5173`
- **THEN** iframe 不加载，tab 显示「当前浏览器不支持 Navigation API」

#### Scenario: Service Worker 注册失败
- **GIVEN** `/dsh-local-service/sw.js` 返回 500
- **WHEN** 用户输入 `127.0.0.1:5173`
- **THEN** iframe 不加载，tab 显示 Service Worker 注册失败的原因

#### Scenario: 页面未受控时停止并只重载一次
- **GIVEN** iframe 中的代理文档两次加载都未被本插件 Service Worker 控制
- **WHEN** 注入脚本执行
- **THEN** 注入脚本调用了 `window.stop()`、报告「未受控」，并且没有替换 `WebSocket` 构造函数、没有写入身份表
- **AND** tab 只重新加载 iframe 一次，第二次报告后 iframe 地址变为 `about:blank` 并显示错误
- **AND** 本场景不断言页面自有脚本的执行次数：`window.stop()` 能否截停同一数据块中已解析的脚本不作保证（尽力而为，见上文已知例外）

#### Scenario: 非网页响应显示类型和可读状态码
- **GIVEN** 上游 8000 对 `/` 返回 `404`，`Content-Type: text/plain`，正文为空
- **WHEN** 用户在地址栏输入 `127.0.0.1:8000/`
- **THEN** 在 Chromium 中（其导航条目提供 `responseStatus`），iframe 地址变为 `about:blank`；tab 显示「这个地址返回的不是网页」，并显示 `text/plain` 与 `404`
- **AND** tab 中没有任何 `href` 指向 `/dsh-local-service/` 代理路径的链接

#### Scenario: 状态码不可读时只显示内容类型
- **GIVEN** 没有注入标记的代理文档，`contentType` 为 `application/json`；它的导航条目依次为：不存在、缺少 `responseStatus`、`responseStatus` 为 0
- **WHEN** tab 处理该次加载
- **THEN** 三种情况下 tab 都显示「这个地址返回的不是网页」和 `application/json`，且不显示任何状态码数字

#### Scenario: 被阻止注入的网页仍提示注入被阻止
- **GIVEN** 上游 5173 返回的 `text/html` 文档中没有注入标记（测试中通过在扫描器之外构造该响应来模拟注入被阻止）
- **WHEN** iframe 加载该文档
- **THEN** iframe 地址变为 `about:blank`，tab 显示「页面阻止了注入脚本」，不显示「这个地址返回的不是网页」

### Requirement: tab 顶部的返回按钮
tab 顶部 SHALL 在地址栏左侧提供一个返回按钮，可访问名称为「返回」。

浏览器的联合会话历史由 iframe 与 DSH 顶层页面共用，`history.back()`、iframe 的 `navigation.back()` 和 `traverseTo()` 都可能让 DSH 顶层页面一起后退。因此，返回按钮 MUST NOT 使用这些 API，而 SHALL 改由 tab 自己维护的访问栈实现。返回按钮只改变 iframe，不产生新的会话历史条目，MUST NOT 改变 DSH 顶层页面的地址或历史。

访问栈规则：
- 栈中每项记录 `{ fam, port, rest }`，内容就是注入脚本在 `dshls:installed` 与 `dshls:location` 消息中报告的值。tab 收到这两类消息（`event.source` 为 iframe 窗口）时，如果地址与栈顶不同，SHALL 入栈。页面内同文档的路由变化（`pushState`）同样入栈；返回到这样的地址时，整页会重新加载。
- 点击返回时，tab SHALL 弹出栈顶，用 iframe 窗口的 `location.replace(...)` 加载新栈顶的代理路径，并设置“返回中”标志。
- “返回中”标志生效期间收到的第一条 `dshls:installed`，SHALL 把栈顶替换为它报告的地址（而不是入栈），并清除标志。这样，返回目标被上游重定向到别处时，就不会出现“返回 → 重定向回来 → 再次入栈”的循环。
- 在地址栏提交地址时，tab SHALL 先清空访问栈并清除“返回中”标志，再加载新地址。iframe 因错误被置为 `about:blank` 时，SHALL 清除“返回中”标志。
- 栈中少于 2 项时，返回按钮 SHALL 带 `disabled` 属性；有 2 项或更多时，按钮 MUST 可用，MUST NOT 因为在等待加载而被禁用。tab 根元素 SHALL 暴露 `data-dshls-history-depth` 属性，值为栈的长度。

已知限制（尽力而为，SHALL 写入 README）：点击返回后、页面加载完成前，若又发生了其它导航（页面自己跳转、用户快速连点返回），访问栈可能多出一项或错开一项，但不会卡住，也不会影响 DSH。返回目标已失效时，已弹出的那一项不会恢复。返回目标被重定向时，这一项会合并为重定向后的地址。返回时不保留页面内存状态（`history.state`、滚动位置、未提交的表单）。

#### Scenario: 返回按钮回到上一页并同步地址栏
- **GIVEN** 用户提交 `127.0.0.1:5173/`，然后页面整页导航到 `/second`
- **WHEN** 用户点击「返回」
- **THEN** iframe 回到 5173 的 `/`，地址栏显示 `http://127.0.0.1:5173/`，`data-dshls-history-depth` 为 `1`

#### Scenario: 顶层历史穿插时只后退 iframe
- **GIVEN** iframe 依次显示 5173 的 `/` 和 `/second`；随后在 DSH 顶层页面 `location.hash` 为空时执行 `history.pushState(null, '', '#x')`，并记录顶层此时的 `history.length`
- **WHEN** 用户点击「返回」
- **THEN** iframe 回到 5173 的 `/`；DSH 顶层页面的 `location.hash` 仍为 `#x`，`history.length` 不变

#### Scenario: 没有上一页时返回按钮禁用
- **GIVEN** tab 刚挂载、尚未加载任何页面；随后用户提交 `127.0.0.1:5173/`，并等待加载完成
- **WHEN** 分别在上述两个时刻检查返回按钮
- **THEN** 两个时刻按钮都带 `disabled` 属性，点击后 iframe 地址不变；加载完成后 `data-dshls-history-depth` 为 `1`

#### Scenario: 返回目标被重定向时不循环
- **GIVEN** 栈为 [5173 `/a`, 5173 `/b`]；之后上游把 `/a` 改为返回 `302 Location: /b`
- **WHEN** 用户点击「返回」
- **THEN** iframe 最终显示 `/b`，`data-dshls-history-depth` 为 `1`，返回按钮带 `disabled`
- **AND** 再等待 1 秒，上游 5173 收到的请求总数不再增加

#### Scenario: 提交新地址后访问栈重置
- **GIVEN** 栈为 [5173 `/`, 5173 `/second`]，此时返回按钮可用
- **WHEN** 用户在地址栏提交 `127.0.0.1:8000/page`，并等待加载完成
- **THEN** `data-dshls-history-depth` 为 `1`，返回按钮带 `disabled` 属性

### Requirement: 首页列出 Host 上的网页服务
Host SHALL 提供只读的 HTTP 端点 `GET /dsh-local-service/services`，它与代理路由使用相同的认证和来源检查：官方 `connection.requestRejection`，加上 `Sec-Fetch-Site` 必须为 `same-origin` 或 `none`，未通过时返回 401/403。端点返回 JSON 数组，每项为 `{ fam, port, process }`，按端口升序排列。

- **候选端口**：Host 本机上监听 `127.0.0.1`、`::1`、`0.0.0.0` 或 `::` 的 TCP 端口，排除 `ctx.webServer.port`。监听在 IPv6 地址上的端口，`fam` 为 `p6`；其余为 `p`。macOS 用 `lsof -nP -iTCP -sTCP:LISTEN` 获取，Linux 读 `/proc/net/tcp` 与 `/proc/net/tcp6`。
- **进程名**：只返回可执行文件名（例如 `node`），取不到时为 `null`。MUST NOT 返回命令行参数、路径或环境变量。
- **只保留网页**：Host SHALL 对每个候选端口发起 `GET /` 探测，单次超时 800 毫秒，并发不超过 16。只有响应的 `Content-Type` 以 `text/html` 开头（任意状态码）的端口才列出。探测请求不带任何 cookie 或认证头，只读取响应头，读到响应头后立即中止，不读取正文。
- **限额**：候选端口超过 64 个时，只探测端口号最小的 64 个。整个请求 SHALL 在 3 秒内返回。
- **失败**：取不到监听列表时（命令不存在、无权限等），返回 `200` 和空数组，不暴露错误细节。

tab 工具栏 SHALL 在返回按钮右侧提供一个 Home 按钮，可访问名称为「首页」。点击 Home、tab 首次挂载时，都显示首页：iframe 不加载，访问栈清空，地址栏清空。首页 SHALL 请求上述端点，并按“端口 + 进程名”列出服务；点击某一项，等同于在地址栏提交 `127.0.0.1:<端口>/`（`p6` 时为 `[::1]:<端口>/`）。首页 SHALL 提供一个「刷新」按钮，用于重新请求端点。请求进行中显示“正在查找…”；结果为空或请求失败时，只显示“Host 上没有发现网页服务”和「刷新」按钮，MUST NOT 显示示例链接。

#### Scenario: 列出正在运行的网页服务
- **GIVEN** Host 本机 127.0.0.1 上，端口 A 返回 `text/html`，端口 B 返回 `application/json`，DSH 自身监听端口 W
- **WHEN** 已认证的同源请求访问 `/dsh-local-service/services`
- **THEN** 响应中包含 `{ fam: "p", port: A }`，不包含 B 和 W；每项的 `process` 是字符串或 `null`，且不含空格和 `/`
- **AND** 端口 A 收到的探测请求不带 `Cookie` 头

#### Scenario: 服务端点拒绝未认证与跨站请求
- **GIVEN** 两个请求访问 `/dsh-local-service/services`：一个没有 DSH 会话 cookie；另一个带有效 cookie，但 `Sec-Fetch-Site: same-site`
- **WHEN** 请求到达 Host
- **THEN** 状态码依次为 401 和 403，且没有对任何端口发起探测

#### Scenario: 无响应的端口不拖慢列表
- **GIVEN** Host 上有一个端口接受连接，但永远不发送响应
- **WHEN** 请求服务端点
- **THEN** 3 秒内返回，结果不包含该端口

#### Scenario: Home 按钮回到服务列表并可点选
- **GIVEN** 服务端点会返回 5173；iframe 正在显示 5173 的 `/second`
- **WHEN** 用户点击「首页」，再点击列表中的 5173
- **THEN** 点击「首页」后，iframe 不再显示页面，`data-dshls-history-depth` 为 `0`，列表中有 5173；点击 5173 后，iframe 加载 `/dsh-local-service/p/5173/`，地址栏显示 `http://127.0.0.1:5173/`

#### Scenario: 没有发现服务时只提示不给示例
- **GIVEN** 服务端点返回空数组
- **WHEN** tab 显示首页
- **THEN** 页面显示“Host 上没有发现网页服务”和「刷新」按钮，页面中没有任何示例链接（不出现 `127.0.0.1:5173`、`localhost:3000`、`127.0.0.1:8080`）

### Requirement: tab 工具栏的刷新按钮
tab 工具栏 SHALL 在「首页」按钮右侧提供一个刷新按钮，可访问名称为「刷新」。

- **点击时**：tab SHALL 调用 iframe 窗口的 `location.reload()`。
- **重新加载后**：按「页面看到直接地址，导航留在代理内」要求，这次 reload 会被改写成对代理路径的 replace 导航，不会新增会话历史条目，MUST NOT 改变 DSH 顶层页面的地址或历史。
- **访问栈**：重新加载后的地址与栈顶相同时，不入栈，栈深度不变；地址改变时（例如上游改为重定向到别处），按返回按钮的入栈规则处理。
- **禁用条件**：处于首页（iframe 未加载页面）时，刷新按钮 SHALL 带 `disabled` 属性。

#### Scenario: 刷新重新加载当前页面且栈深度不变
- **GIVEN** iframe 依次显示 5173 的 `/` 和 `/second`，`data-dshls-history-depth` 为 `2`
- **WHEN** 用户点击「刷新」
- **THEN** 上游 5173 再收到一次 `/second` 请求；iframe 仍显示 `/second`；`data-dshls-history-depth` 仍为 `2`；DSH 顶层页面的 `history.length` 不变

#### Scenario: 首页时刷新按钮禁用
- **GIVEN** tab 显示首页
- **WHEN** 检查刷新按钮
- **THEN** 按钮带 `disabled` 属性，点击后上游没有收到请求

### Requirement: 可独立启停与卸载清理
Web client 入口 SHALL 通过 `inject` 依赖 `betterSidebar`。better-sidebar 未安装时，MUST NOT 注册 tab 或 Service Worker。Host 入口 SHALL 在 `connection` 服务不可用时，MUST NOT 注册任何代理路由或 index 注入。

插件卸载时：
- Host SHALL 移除前缀路由、升级路由和 index 注入，并销毁所有在途的上游 HTTP 连接与 WebSocket。
- Web client SHALL 移除 tab，并注销本插件的 Service Worker。

#### Scenario: 正常启用时注册 tab 与路由
- **GIVEN** better-sidebar 与 connection 服务都可用
- **WHEN** 插件加载
- **THEN** tab id `sidebar-local-service-browser` 已注册，`/dsh-local-service` 前缀路由与 `/dsh-local-service/ws` 升级路由都存在

#### Scenario: 缺少 connection 时不暴露路由
- **GIVEN** Host 组合中没有 connection 服务
- **WHEN** 插件加载
- **THEN** 请求 `/dsh-local-service/p/5173/` 不由本插件处理，DSH index 中没有守卫脚本

#### Scenario: 卸载时关闭在途连接与 Service Worker
- **GIVEN** 有一条经代理建立的 WebSocket、一条进行中的 SSE 响应，且本插件 Service Worker 处于 active
- **WHEN** Host 与 Web client 插件都被 dispose
- **THEN** 两条连接在 1 秒内被关闭；前缀路由与升级路由已移除；`navigator.serviceWorker.getRegistrations()` 中不再有作用域为 `/dsh-local-service/` 的注册
