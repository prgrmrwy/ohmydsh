## Context

- 用户通过 Cockpit 跨机使用 DSH。每台机器的 DSH 都监听 3080，Cockpit 经 SSH 把它映射到浏览器所在电脑的一个随机回环端口，再用 iframe 加载。DSH 同源 server 上注册的插件路由会自动随这条隧道送达浏览器。
- 规划历程：第 1、2 轮评审都判 REVISE，人类裁决见 [human-decisions.md](human-decisions.md)，要点如下：
  - 保留 Host 同源前缀代理，并把 `location` 也代理掉。
  - 外部网站不在本 change 范围内。
  - 不要求“绝不访问浏览器本机”的绝对保证，改为尽力而为，并列出已知例外。
  - 只保证 tab 内的后退和前进，不支持书签。
  - 必须支持 JS 读写 cookie。
  - 先做浏览器可行性探针，再写本版。
- 可行性探针（Chrome 157，模拟 Cockpit 跨端口嵌套）：结果见 [probes/browser-feasibility.md](probes/browser-feasibility.md)，脚本可重跑。本设计的每个浏览器侧机制都以探针结果为依据，下文以「探针:」标注。
- 宿主事实。原文摘录见 [evidence/dsh-install-excerpts.md](evidence/dsh-install-excerpts.md)，对应 `@deepseek-ai/*@0.2.2-rc.1`：
  - **webServer 路由分派**：`register` 分精确表和前缀表，前缀匹配条件为 `pathname === prefix || startsWith(prefix + '/')`，最长前缀优先，未命中走 fallback。handler 拿到的是原始 `req/res`，宿主不做认证。`registerUpgrade` 只支持精确路径，未命中的升级请求直接 `destroy`。`port` 在 listen 完成后才有值。
  - **webServer 的 index 注入**：插件可通过两种方式修改 DSH index：
    - `webserver/index-inject` 事件：让插件添加结构化的行（如 `{kind:'script', text, placement:'head'}`）。这些行按订阅者激活顺序插在 `<head>` 开始标签之后，所以无法保证某一行排在首位。
    - `tapIndex(transform)`：在所有结构化行渲染完之后，对整份 HTML 做原始变换（`renderIndex` = 先渲染行，再 `applyIndexTaps`）。
  - **fallback 的真实行为**（`dsh-host-frontend-static` 的 `serveStatic`）：只有 `/` 和 `/index.html` 返回渲染后的 index；dist 中存在的文件按文件返回；其余路径返回 **404**。也就是说，不存在“任意路径都返回 SPA”的情况。
  - **`connection.requestRejection(req)` 的检查顺序**：
    1. `Host` 必须是回环地址、bind 地址或 trustedHosts，否则返回 403。
    2. `Sec-Fetch-Site` 为 `cross-site` 时返回 403。
    3. 带 `Origin` 时，必须满足 `originUrl.host === Host`（含端口），否则返回 403。
    4. 校验 `dsh-auth-<sha256(authority)>` cookie。该 cookie 为 `Path=/; HttpOnly; SameSite=Strict`，签名绑定 authority；校验失败返回 401。
  - **官方 gate 的缺口**：另一个回环端口的网页发出的、不带 `Origin` 的同站请求，能通过上述全部检查。
- 本仓先例：
  - dsh-pet 用 `requestRejection` 包住原始路由（`packages/dsh-pet/src/host/http.ts:60-95`）。但它自己的 `isTrustedRequest` 会放行任意回环 Origin，本 change 不沿用这一层。
  - tab 注册方式和 client 产物形态参照 `packages/sidebar-session-resources`。Host 侧服务用异步 `ctx.inject` 获取，见 `docs/architecture/dsh-plugin-integration-pitfalls.md` 第 630 行起。

## Goals / Non-Goals

**Goals:**
- 在 tab 中输入 `127.0.0.1:<端口>`，看到的是 DSH Host 所在机器上的该端口。地址栏和页面脚本看到的都是直接地址。
- 常见开发应用在 tab 内可用，包括：
  - 根路径资源，以及写死的本机跨端口地址；
  - SPA 路由（`pushState` + `location.pathname`），以及 `location.assign/replace/href/reload`；
  - 链接、表单（含 `form.submit()` 和文件上传）、tab 内后退和前进；
  - HMR WebSocket、cookie 登录态、通过 `document.cookie` 读写的 CSRF token。
- 所有代理流量都要求 DSH 浏览器会话，并且必须是同源请求。
- 不新增端口和隧道，不改动 Cockpit、bridge 或 better-sidebar。

**Non-Goals（明确不支持，写进 README）：**
- 不保证零泄漏。以下情形的请求可能落到浏览器所在电脑的回环地址：
  - Worker 中发起的 fetch 和 WebSocket，以及 Worker 自身脚本中的根路径地址；
  - 被代理页面中再嵌套的 iframe；
  - 页面未受控或身份表不可用时，`window.stop()` 之前已被解析的页面脚本可能执行一次。
- 跨文档后退或前进时，浏览器会先向 DSH 同名路径发一次 GET，返回结果是 404、静态文件或 index（被守卫截停），然后再按条目身份恢复。
- 书签，以及把 iframe 中的无前缀地址拿到其它地方打开。
- 非 Chromium 浏览器：缺少 Navigation API 时直接拒绝加载。
- 被代理页面注册自己的 Service Worker（一律拒绝），以及 `cookieStore` API。
- IndexedDB、Cache Storage、BroadcastChannel 不按端口隔开，与 DSH 同 origin。
- `location.host`/`location.origin` 返回的是 DSH 的地址。
- 同一端口内的 cookie Path 粒度：所有 cookie 都放在 `Path=/`。
- 代理 HTTPS 上游或非回环主机。（端口发现已于 2026-11-24 加入，见 spec「首页列出 Host 上的网页服务」。）

## Decisions

### D1 Host 同源前缀代理
Host 注册三类路由：
- 前缀路由 `/dsh-local-service`：`/dsh-local-service/p/<端口>/…` 转发到 `127.0.0.1:<端口>`，`/dsh-local-service/p6/<端口>/…` 转发到 `[::1]:<端口>`；`/dsh-local-service/sw.js` 是静态资源。
- 精确升级路由 `/dsh-local-service/ws`。
- DSH index 的守卫注入（D7）。

否决的方案：
- **bridge forwards 独立 origin**：用户选择不依赖 Cockpit，并且要求写死的跨端口地址也走远端。
- **`<端口>.localhost` 子域**：webserver 只按 path 分派，无法按 Host 头路由。
- **服务端改写 JS 文本中的 `location`**：需要 AST 级改写，会破坏 source map 和 HMR。

### D2 认证与 CSRF：官方 gate 加 Sec-Fetch-Site
- **HTTP**：本插件前缀路由下的全部 HTTP 请求（代理路径和 `sw.js` 都算）先走 `requestRejection`，再要求 `Sec-Fetch-Site ∈ {same-origin, none}`，缺少该头也拒绝（第 4 轮 R4-M4）。
  - 合法流量都满足这一条。探针中，iframe 导航、子请求、SW 转发的 fetch、`sw.js` 全部是 `same-origin`。
  - `none` 只来自用户直接操作，其它网页无法伪造。
- **WebSocket**：浏览器不会在升级请求中发送 `Sec-Fetch-Site`（探针已确认），所以只依赖官方 gate。官方 gate 会精确比对 `Origin`，而浏览器发起 WebSocket 时必定带上 `Origin`。

否决的方案：
- **只依赖官方 gate**：不带 Origin 的同站 GET 能带着 cookie 通过。
- **自建 token**：子资源请求无法携带自定义 header；放进 query 又会泄漏到上游和日志。

### D3 目标限制
- 每个请求都现场读取 `ctx.webServer.port`：不是正整数时返回 503，与目标端口相同时返回 400。
- 目标主机只由族决定，不来自任何请求参数。
- 建连超时 10 秒。已建立的流不限总时长；客户端断开时，立即销毁上游连接。

### D4 cookie：Host 端按前缀白名单，页面内按端口包装
- **Host 端（安全边界）**：
  - 转发时只发送名为 `dshls.<A>.<族>.<端口>.*` 的 cookie，并去掉前缀。`dsh-auth-*`、Cockpit 等其它同主机 cookie 一律不发。
  - `<A>` 是请求 `Host` 头（浏览器看到的 DSH `host:port`）SHA-256 哈希的前 8 位 base64url，对应第 3 轮 R3-M4。这样做的原因：浏览器的 cookie 不按端口区分，用户经 Cockpit 同时打开机器 A、B 时，两条隧道都在浏览器电脑的 `127.0.0.1` 上；如果前缀只有族和端口，A 上 5173 的 cookie 会被转发给 B 上的 5173。加入 authority 后，Host 只认本 authority 的 cookie。
  - 这个哈希只用来区分命名空间，不是安全凭据。注入脚本拿到的是 Host 填好的完整前缀，不需要自己算。
  - 上游的 `Set-Cookie` 改名，`Path` 固定为 `/`，删除 `Domain`。
  - 选择 `Path=/` 的原因：页面经 `replaceState` 改为无前缀地址后，原生 `document.cookie` 按新地址过滤；如果把 cookie 放在代理前缀路径下，页面脚本就读不到了。第 2 轮的 R2-C3 正是这个问题。
  - 带来的好处：所有代理 cookie 都会随 `/dsh-local-service/ws` 一起发送，WebSocket 回到单一入口即可。第 2 轮的 R2-M3 随之消失。
  - 代价：
    - 同一端口内的 Path 粒度丢失。
    - 所有端口的代理 cookie 都会随每个同源请求发出，包括 DSH 自己的请求；DSH 会忽略这些未知 cookie。
    - 浏览器还会把这些 cookie 发给浏览器电脑同一回环主机上的其它端口，包括其它 DSH 隧道和 Cockpit。cookie 原有的 `HttpOnly` 保留，所以页面脚本读不到；但那些本机服务能收到。这是浏览器 cookie 模型决定的残余风险，无法消除，写进 README 和 manifest note。
  - 探针：上游以 `Path=/start` 设置的 `csrftoken` 改写后，页面能读到；页面写入的 `theme=dark` 也被转发给了上游。
- **页面内（兼容层，不是安全边界）**：
  - 覆盖 `Document.prototype.cookie`，按前缀过滤并去掉前缀。
  - `localStorage` 和 `sessionStorage` 换成带前缀的包装对象，`cookieStore` 置为 `undefined`。
  - 探针：包装后执行 `localStorage.clear()`，DSH 的设置仍然保留。

否决的方案：
- **转发所有 cookie，只剔除 `dsh-auth-*`**：同主机上还有 Cockpit 等其它服务的 cookie，剔除名单永远列不全。
- **按代理路径设置 Path**：与 D6 的地址还原冲突。

### D5 其它请求头
- `Origin` 和 `Referer`：一律改写为目标的上游地址形式。经过 D2 后，`Origin` 必然是 DSH 自身的 origin，没有信息量；`Referer` 在 `replaceState` 之后不再带端口，所以不靠它推断端口，只保留上游 origin 加 `/`。这样能满足常见的“Origin/Referer 同源”校验。
- `Authorization`：原样转发给本次请求的目标，代理不会自行添加。已知的边界是：页面自己发起的、跨端口的同源重定向会让浏览器继续携带该头，两端都是用户自己打开的本机服务，这一点写进 README。
- `Proxy-Authorization`：删除。
- 文档请求的条件头：删除，配合 D6 的 `no-store`，避免旧的 HTML 被复用。

### D6 HTML 注入：内联首脚本、nonce 与传输语义
- **注入位置**：在 doctype 和注释之后、第一个其它标签之前。按 HTML 解析规则，此位置的脚本会成为隐式 `<head>` 中的第一个元素，先于页面所有脚本执行，包括写在 `<head>` 之前的脚本，这对应第 2 轮的 R2-C1。只需要按 HTML 词法跳过 BOM、空白、doctype 和注释，不需要完整的 HTML 解析器。注释在哪里结束，要按 HTML 分词规则判断：`<!-->` 和 `<!--->` 立即结束；其余情况取最先出现的 `-->` 或 `--!>`。实现阶段的独立评审（implementation-review.md M1）发现，只认 `-->` 会让页面脚本先于注入脚本执行。doctype 遇到第一个 `>` 就结束。开头的注释或 doctype 有两种情况会让注入脚本插到它前面：一是直到文档结束都没有闭合，二是某个数据块到达后仍定不下插入位置，且该块与此前尚未输出的字节合计超过 256 KiB。之前各块里已识别并结束的开头注释、doctype 已经输出，不计入；本块新识别的部分要等这次判断之后才输出，所以仍计入。因此未输出的缓冲最多为 256 KiB 加一个数据块。前一种必须这样做，因为浏览器会把未闭合的注释一直吞到文档末尾，脚本放在末尾永远不会执行。后一种是有界回退，用来保证流式输出不会无限等待；插在开头 token 之前，注入脚本照样先于页面中所有元素和脚本执行，只是字节位置和一次性处理的结果不同。插入位置确定之前要先缓冲，上限如上，这是“流式、不等正文结束”这条规则唯一的例外。
- **内联加 nonce，而不是外链**：
  - 没有额外请求，也就没有“脚本加载失败但页面照常执行”的情形。
  - 每个响应生成一个随机 nonce，对 CSP 响应头中每条策略的生效脚本指令按下面的规则处理（第 3 轮 R3-M1）：
    - 指令只靠 `'unsafe-inline'` 放行内联脚本（不含任何 nonce、hash 或 `'strict-dynamic'`）：不追加。一旦加入 nonce，`'unsafe-inline'` 就会失效，等于收紧了上游的策略。
    - 其它情况都追加 `'nonce-<N>'`。指令里已有 nonce、hash 或 `'strict-dynamic'` 时，浏览器本来就忽略 `'unsafe-inline'`，不追加的话注入脚本会被拦。
    - 探针：在 `script-src 'unsafe-inline' 'nonce-old'` 下，注入脚本和 `nonce-old` 脚本都执行，不带 nonce 的内联脚本仍然被拦截。
  - `<meta>` 形式的 CSP 只约束它之后的内容，注入脚本位于它之前，不受影响。
  - 这一方案对多策略的情况同样成立，对应第 2 轮的 R2-M4。
- **适用范围**：所有 HTML 状态码都注入，包括 404 和 500，只排除 HEAD、204、206 和 304。
- **缓存**：注入后的 HTML 删除 `Content-Length`、`ETag`、`Last-Modified`，设置 `no-store`；文档请求同时删除条件头。这样插件升级后不会复用旧的注入结果。
- **编码与流式**：请求上游时带 `identity`。若上游仍返回 gzip、deflate 或 br，就解压后再处理；其它编码返回 502。注入流式进行，请求和响应都用 pipe 处理背压。

### D7 让页面看到直接地址，按条目恢复历史
注入脚本是文档中第一个执行的脚本，按顺序做以下几步：
1. **检查受控**：如果 `navigator.serviceWorker.controller` 为空，说明 SW 尚未接管，此时页面的子请求不会被改写。注入脚本调用 `window.stop()` 并上报，tab 重载一次；仍未受控就清空 iframe。
   - 承诺的范围（第 4 轮 R4-M2，按人类裁决第 1 条“尽力而为”）只包括：注入脚本自身停止安装、上报、tab 只重载一次、最后清空 iframe 并提示。
   - 不承诺 `window.stop()` 能截停解析器已经读入同一数据块的页面脚本。这个分支没有做浏览器实验，列入已知例外。
   - 守卫的“DSH 脚本不执行”是另一条控制流，已由探针的正反对照验证，与此处无关。
2. **还原地址**：调用 `history.replaceState(…, rest)`。
3. **按条目记录身份**（第 3 轮 R3-C1）：在原生 sessionStorage 的 `__dshls.entries.<frameId>` 中维护 `entry.key → {fam, port, rest}`。还原地址后立即写入一次；之后每次触发 `currententrychange` 再写入一次，这样应用自己的 `pushState`、`replaceState`、hash 变化和同文档 traverse 都会被记下。
   - 为什么用 `entry.key`：它在后退和前进时保持不变。
   - 为什么不用 Navigation API 的 state：应用自己的 `replaceState` 会清空 state，应用也可能自己使用 state。
   - 为什么放在 sessionStorage：它属于同一顶层浏览上下文和同一 origin，tab、守卫和注入脚本都能读到。
   - 探针：在 `/spa` 中先 `pushState` 再 `replaceState`，随后跨端口整页跳转再后退，恢复到的是 U1 `/spa/route3`。
   - **存储契约**（第 4 轮 R4-M1）：
     - 在安装页面存储包装之前取得原生 sessionStorage 引用。保留键 `__dshls.entries.<frameId>` 不带端口前缀，页面包装看不到它，也不会被包装的 `clear()` 删掉。`<frameId>` 是 tab 写在 `data-dshls` 上的随机 id，用来给每个 iframe 分开命名空间。
     - 每次写入时剪掉不在 `navigation.entries()` 里的 key，上限 500 条。
     - 读、解析或写入出现任何异常（配额不足、坏 JSON 等）都视为失败：`window.stop()`，上报，tab 清空 iframe。这种情况下不能继续半初始化，否则后续条目会没有身份。
     - 清理：tab 挂载时，只删除那些 `<frameId>` 不属于当前文档中任何存活的 `iframe[data-dshls]` 的 `__dshls.entries.*` 键；卸载时，只删除自己的那一项。这样不会误删其它仍在使用的 frame 的记录。
     - 结构校验：值必须是对象，每条记录必须是 `{fam: "p"|"p6", port: 十进制字符串, rest: 以 "/" 开头的字符串}`。不符合时按失败处理，与坏 JSON 相同。
     - 跨文档：同一 frame 内整页跳转后，新文档的注入脚本先读出已有的表，再合并写入，不覆盖上一个文档留下的条目。这样后退时仍能查到旧条目。
4. **拦截导航**：监听 `navigate` 事件。
   - push、replace、reload 都可以取消（探针已确认）。取消后，push 仍按 push 导航，replace 和 reload 改用 replace。
   - 带表单数据的导航用 `e.sourceElement` 改写 `action` 后原生重新提交，这样 method、正文和文件都保留。探针：`form.submit()` 的 POST 正文被完整送达。
   - `requestSubmit` 和用户点击提交，在 `submit` 捕获阶段改写 `action`（探针已确认）。
   - 外部地址的导航取消后交给 tab，显示一个提示条，用户点击后才打开。这样可以避开没有用户激活时的弹窗拦截，对应第 2 轮的 R2-M1。
5. **跨文档后退和前进**：`traverse` 事件不可取消（探针已确认），浏览器会先请求无前缀地址。之后按 `entry.key` 查身份表恢复，对应第 2 轮 R2-C2。
   - **落到 index（`/` 或 `/index.html`）**：DSH 返回 index。
     - 插件用官方 `webServer.tapIndex` 把守卫插到 index 第一个 `<head …>` 之后。`tapIndex` 在所有结构化注入行渲染完后才执行，所以守卫排在其它插件的 head 行之前（第 3 轮 R3-M3）。
     - 官方 `frontend-static` 在 `renderIndex` 之后还会在 `<head>` 后插入 `<base href="./">`（见摘录），因此最终顺序是 head → base → 守卫。base 不执行脚本，所以验收标准定为“守卫是最终响应中**第一个可执行脚本**”（第 4 轮 R4-M3）。
     - 守卫恢复时使用根绝对路径 `/dsh-local-service/…`，不受 base 影响。
     - 若另一个 tap 也往同一位置插入，顺序取决于注册先后，这一点写进风险。
     - 守卫只在 `frameElement` 带 `data-dshls` 时生效：先 `window.stop()`，再按身份 `location.replace`。在顶层页面或普通 iframe 中，守卫什么都不做。
     - 探针：用 DSH index 中的哨兵代表 DSH 自身脚本。有守卫时，哨兵上报 0 次；正向对照（同样的 iframe、去掉守卫）上报 1 次。对应第 3 轮 R3-M2。
   - **落到其它路径**：DSH 返回 404 或同名静态文件。tab 在 `load` 事件中发现文档没有注入标记，就按身份表用 replace 导航回去。
   - **身份表里查不到**：清空 iframe，不做任何猜测。

否决的方案：
- **把 SW 作用域设为 `/`**：SW 会接管 DSH 主页面，影响面太大。
- **不还原地址**：前端路由看到的是带前缀的 pathname，SPA 无法使用。

### D8 Service Worker
- **注册**：脚本为 `/dsh-local-service/sw.js`，作用域为 `/dsh-local-service/`，Host 以 JS MIME 和 `no-store` 返回，不带 `Service-Worker-Allowed`；安装后执行 `skipWaiting` 和 `clients.claim`。探针：DSH 主页面的 `controller` 为 null。
- **client 记录**：按导航请求的 `resultingClientId` 记录该 client 的 `{族, 端口}`，先同步写入内存，再用 `waitUntil` 写入 IndexedDB。查找时先查内存，再查 IndexedDB；都查不到就返回 502，不放行。`replaceState` 之后，client 的 URL 已不带前缀，所以只能依赖这份记录。探针：`replaceState` 之后页面仍受控，根路径资源和写死的跨端口地址都被正确改写，直连浏览器本机的次数为 0。
- **禁止上游注册 SW**（第 1 轮 C1，已获评审接受）：
  - 代理路径上带 `Service-Worker: script` 头的请求一律返回 403；同时删除上游返回的 `Service-Worker-Allowed`，`register()` 也直接拒绝。
  - tab 挂载时，注销脚本 URL 位于 `/dsh-local-service/p` 下的注册。
  - 探针：按前缀作用域和 `/` 作用域注册上游 SW 都失败，原因是 403。

### D9 同源取舍（显式接受）
被代理页面与 DSH 同源，它的脚本能调用 DSH API，也能读取 DSH 页面的 DOM 和 IndexedDB。
- 无法通过 `sandbox` 消除：iframe 加了 `sandbox` 后，SW 和认证会一起失效。
- 采取的措施：只允许本机回环目标；只在用户主动输入时加载；tab 中常驻提示「只打开你信任的本机服务」；在 dsh.yaml 的 note 中写明。
- 持久控制的风险已由 D8 封堵，不属于这里接受的范围。

### D10 WebSocket
- **入口**：使用单一精确入口 `/dsh-local-service/ws?fam=&port=&path=`。cookie 为 `Path=/`，会随请求带到入口（探针已确认）。按端口动态注册的方案取消，“只连 WS 的端口没有路由”这一问题也随之消失。
- **注入脚本**：替换全局 `WebSocket` 构造函数，并保留它的 `prototype`。
- **Host**：用 `net.connect` 重建握手，只转发白名单请求头；上游返回 101 后双向 pipe，并转发握手时读到的 `head` 字节；上游返回非 101 时关闭客户端连接。`path` 只接受 origin-form。

### D11 失败闭合是尽力而为
- **加载前检查**：`navigator.serviceWorker` 存在、`window.navigation` 存在、SW 在 5 秒内变为 active。任何一项不满足就不加载，并显示原因。
- **加载后检查**：代理路径上的文档如果没有注入标记，就清空 iframe 并提示；没有受控的文档按 D7 第 1 步处理。
- 承诺的边界只到这里，已知的例外列在 Non-Goals 中。这符合人类裁决第 1 条。

### D12 打包与卸载
- **包**：新增 local package `packages/sidebar-local-service-browser/`，npm 名为 `dsh-sidebar-local-service-browser`，结构仿照 `sidebar-session-resources`。
- **Host 入口**：通过 `ctx.inject(['connection'], …)` 异步注册路由和 `webServer.tapIndex` 守卫变换；`sw.js` 和注入脚本由独立的 tsdown entry 构建，以字符串形式内联进 Host 产物。
- **Web client 入口**：`inject = ['betterSidebar']`。
- **依赖**：只使用 Node 内置的 `http`、`net`、`zlib`，不引入第三方代理库或 HTML 解析库。
- **卸载**：Host 移除路由和注入，并销毁所有在途 socket。Web client 移除 tab，并执行 `registration.unregister()`。即使旧 SW 残留，`/dsh-local-service/...` 也会落到 fallback，返回 404 而不是 HTML（见 Context 中的 fallback 事实）。这一点对应第 2 轮的 R2-M6，那条意见的前提是 fallback 会返回 SPA HTML，与事实不符。

## Risks / Trade-offs

- [被代理页面可以调用 DSH API] → D9：只允许本机回环，只在用户主动输入时加载，常驻提示，并写进 manifest note。
- [其它回环网页借用 DSH 会话] → D2 增加 `Sec-Fetch-Site` gate，并配套测试矩阵；WebSocket 由官方 gate 的 Origin 精确比对把关。
- [被代理页面注册持久 SW] → D8。
- [跨文档后退或前进先向 DSH 同名路径发一次 GET] → 这次 GET 不带副作用。只有 index（`/` 与 `/index.html`）会返回 HTML，并被 D7 的守卫截停。若 DSH 插件存在有副作用的 GET 路由，并且恰好与被代理页面的历史路径同名，就会被误触发。这一点写进 README，作为已知风险。
- [代理 cookie 被浏览器发往同一回环主机上的其它本机服务（其它 DSH 隧道、Cockpit）] → 无法消除，这是浏览器 cookie 模型的限制。缓解措施：Host 只转发带本 authority 前缀的 cookie（D4），`HttpOnly` 原样保留；README 和 manifest note 写明这一点。
- [另一个插件的 `tapIndex` 也往 `<head>` 后插入脚本，守卫可能不再是第一个可执行脚本] → 本仓目前没有这样的 tap。验收时，用最终响应检查守卫是否为第一个可执行脚本（其前允许有官方的 `<base href="./">`）；DSH 升级后再复核。
- [所有端口的代理 cookie 都随同源请求发出，请求头变大] → 用户同时打开的端口有限；若请求头超出限制，可能先被 DSH 的 HTTP 解析器拒绝，也可能由上游报错。这一点写进 README。
- [探针环境与真实环境有差距] → 探针是 headless Chrome 模拟的拓扑。tasks 中保留真实 Cockpit 跨机验收，以及 SW 重启、CSP 阻断两项尚未覆盖的检查。
- [注入脚本与页面框架冲突] → 注入脚本只做 D4、D7、D10 列出的覆盖，并在 `window` 上设置一个只读标记。

## Migration Plan

1. 新增 package 和 `dsh.yaml` 条目，连续执行两次 `dsh build`，确认第二次没有变化。
2. 在 worktree 预览中验收两种场景：本机直连，以及经 Cockpit 跨机访问。样本为 Vite + React Router 应用，覆盖 HMR、登录 cookie、`location.assign`、表单 POST、跨端口 API 和后退。
3. 回滚：设置 `enabled: false`，执行 `dsh build`，然后重启 Host。残留 SW 发出的请求会得到 404；README 写明如何手动注销。

## Open Questions

无。裁决见 human-decisions.md，可行性见探针。
