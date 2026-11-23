# dsh-sidebar-local-service-browser

[English](README.md) · 简体中文

<!-- problem -->
通过 Cockpit 在远端机器上使用 DSH 时，Agent 在远端启动的开发服务（例如 `127.0.0.1:5173`）在你的浏览器里会解析成你自己电脑的地址，所以看不到，每个服务都要单独建一条 SSH 隧道。这个插件在右侧边栏加一个「本地服务」tab，由 DSH 自己的 web server 代为访问 **DSH Host 所在机器** 的 `127.0.0.1:<端口>`，流量走 DSH 已有的隧道，不需要新端口或新隧道。

**你能得到什么**

- **输入地址，看到 Host 上的端口。** 接受 `127.0.0.1:5173/app`、`localhost:5173` 和 `[::1]:8080`；地址栏和页面自己的脚本看到的都是直接地址，不会出现代理前缀。
- **常见开发应用照常工作。** 根路径资源和写死的跨端口本机地址、SPA 路由（`pushState`、`location.assign/replace/reload`）、链接与表单（含 `form.submit()` 和文件上传）、HMR WebSocket、cookie 登录态、通过 `document.cookie` 读取的 CSRF token，以及 tab 内的后退和前进。
- **不增加暴露面。** 不新增端口，不建隧道，不改动 Cockpit、它的 bridge 或 `better-sidebar`。

**安装。** 通过 `dsh.yaml` 管理（条目 `sidebar-local-service-browser`，`source: local`）：设为 `enabled: true`，运行 `dsh build`，然后重启 DSH。它依赖第三方 `better-sidebar` 插件（`dsh-better-sidebar`，peer `>=0.16.0`，可选）：没有它时不会注册 tab 和 Service Worker。Host 部分还需要官方 `connection` 服务，缺失时不注册任何东西。需要 DSH `>=0.2.2-rc.1` 和 **Chromium 系浏览器**（Navigation API 与 Service Worker）。设计与验收见 OpenSpec change `sidebar-local-service-browser`。

## 使用

打开 tab 并输入地址。只接受主机为 `127.0.0.1`、`localhost` 或 `[::1]`、**显式写出端口**（1–65535）的 `http:` 地址，可以省略 `http://`。端口取自你输入的原文，所以 `http://localhost:80/` 就是 80 端口。

| 输入 | 加载 | 地址栏显示 |
|---|---|---|
| `localhost:5173/app?x=1#top` | Host 的 `127.0.0.1:5173` | `http://127.0.0.1:5173/app?x=1#top` |
| `127.0.0.1:8080` | Host 的 `127.0.0.1:8080` | `http://127.0.0.1:8080/` |
| `[::1]:8080/` | Host 的 `[::1]:8080` | `http://[::1]:8080/` |
| `https://…`、其它主机、`user@host`、没写端口、端口超出范围 | 不加载，原页面保持不变 | tab 中的错误提示 |

- **只打开你信任的本机服务。** tab 中常驻显示这条提醒，原因见下文「信任模型」。
- **指向其它站点的链接** 不会在框内跳转：先显示提示条，点击后才在新窗口打开。导航时遇到外部站点的重定向，会显示提示页。
- **后退与前进** 在 tab 内可用，包括跨服务（`:5173` → `:8000` → 后退）。不支持书签，也不支持把无前缀地址拿到别处打开。

## 支持矩阵

| 支持 | 不支持（见「已知例外」与「不做的事」） |
|---|---|
| Host 本机 `127.0.0.1` / `::1` 上的 HTTP，除 DSH 自身端口外任意端口 | HTTPS 上游、非回环主机、端口发现 |
| 回环端口之间的重定向（改写进代理） | 在框内跳到外部站点的重定向（改为提示页） |
| 页面发起的 WebSocket / HMR（Worker 内除外） | Worker 内发起的 WebSocket 和 `fetch` |
| `document.cookie`、`localStorage`、`sessionStorage`（按端口的视图） | `cookieStore`，被代理页面自己注册的 Service Worker |
| Chromium 系浏览器 | Firefox、Safari（tab 拒绝加载并说明原因） |

## 信任模型

- **每个代理请求都要求 DSH 浏览器会话**（官方 `connection.requestRejection` 围栏），**并且** `Sec-Fetch-Site` 为 `same-origin` 或 `none`。WebSocket 升级由同一个官方检查把关，它会精确比对 `Origin` 与 `Host`。未认证或跨站请求不会触达任何上游。
- **目标受限**：只连接 Host 本机的 `127.0.0.1:<端口>` 或 `[::1]:<端口>`，主机只由 URL 里的族段决定，并且永远不是 DSH 自身端口。
- **被代理页面与 DSH 同源。** 它的脚本能调用 DSH 的 API，也能读取 DSH 页面的 DOM 和 IndexedDB。给 iframe 加 `sandbox` 会让 Service Worker 与认证一起失效，所以这一点无法消除。只有这些缓解措施：仅回环目标、只在用户主动输入时加载、常驻提醒，以及 `dsh.yaml` 中的说明。
- **代理 cookie 会超出浏览器里的 cookie 作用域。** 浏览器的 cookie 不按端口区分，被代理服务的 cookie（以 `dshls.<authority 哈希>.<族>.<端口>.<名字>` 存放，`Path=/`，保留 `HttpOnly`）也会被发往 **你电脑上** 同一回环主机的其它服务，例如其它 DSH 隧道或 Cockpit。Host 转发给上游时只发同一 DSH authority、同一端口的 cookie，绝不发 `dsh-auth-*` 或其它 cookie。这个残余风险来自浏览器的 cookie 模型，无法消除。
- **被代理页面不能注册自己的 Service Worker。** 带 `Service-Worker: script` 的脚本请求返回 403，`Service-Worker-Allowed` 被删除，注入脚本也会拒绝 `register()`。tab 每次挂载时，会注销所有脚本 URL 以 `/dsh-local-service/p` 开头的注册。

## 已知例外

失败闭合只是尽力而为，不保证零泄漏。以下情形的请求仍可能落到运行浏览器的那台电脑的回环地址：

- **Worker** 中发起的 `fetch` 和 WebSocket，以及 Worker 自身脚本中的根路径地址；
- 被代理页面中再 **嵌套的 iframe**；
- 页面未被本插件的 Service Worker 控制、或身份表不可用时，`window.stop()` 之前已被解析器读入的脚本可能执行一次。

其它需要知道的行为：

- **跨文档后退或前进时，浏览器会先向 DSH 的同名无前缀路径发一次 GET**（在插件恢复条目之前，浏览器先请求旧 URL）。只有 `/` 与 `/index.html` 会返回 HTML，DSH 首页中的守卫会阻止 DSH 在框内启动；其它路径返回 404 或同名静态文件。这次 GET 没有副作用，除非另一个 DSH 插件恰好在与你访问过的页面完全相同的路径上提供了有副作用的 GET 路由。
- 其它插件的 index tap 如果插入到同一个 `<head>` 位置，可能使守卫不再处于第一个可执行的位置；本仓目前没有这样的 tap。
- **非 HTML 文档不能在 tab 中直接查看。** 比如直接打开一个 API 地址，框架会导航到 JSON、纯文本或 PDF 响应。这类响应里没有注入脚本，tab 会失败闭合：清空框架，并提示「页面阻止了注入脚本」。页面自己用 `fetch` 请求这些资源不受影响。
- `IndexedDB`、Cache Storage 和 `BroadcastChannel` 不按端口隔开，属于 DSH 自己的 origin。
- `location.host` 和 `location.origin` 返回的是 DSH 的地址，不是服务的地址。同一端口内的 cookie 一律放在 `Path=/`。
- 所有代理 cookie 都会随每个同源请求发出，同时打开的端口多了请求头会变大；超出限制时，可能先被 DSH 的 HTTP 解析器拒绝，也可能由上游报错。

## 不做的事

HTTPS 或非回环上游、端口发现、书签、非 Chromium 浏览器、被代理页面自己的 Service Worker、`cookieStore`、IndexedDB/Cache Storage/BroadcastChannel 的按端口隔离。

## 手动注销残留的 Service Worker

停用插件本身并不会替你注销浏览器里的 Service Worker。旧的 worker 如果残留，它在 `/dsh-local-service/…` 下发出的请求会从 DSH 得到一个普通的 404。要清除它，在受影响的浏览器里打开 DSH，然后用 DevTools → Application → Service Workers → Unregister（scope 为 `…/dsh-local-service/`），或者在 DevTools 控制台执行：

```js
navigator.serviceWorker.getRegistrations().then(rs => rs
  .filter(r => new URL(r.scope).pathname === '/dsh-local-service/')
  .forEach(r => r.unregister()))
```

## 开发

在包目录下运行：

```sh
npm run build          # lib/index.js（Host）、lib/client.js（tab）、lib/*.d.ts
npm run typecheck
npm test               # Node 套件：Host 代理、harness、jsdom 的 tab 测试
npm run test:browser   # 无头 Chrome 套件（需要 Chrome：DSHLS_CHROME）
```

Service Worker 脚本（`src/sw`）与注入到页面的脚本（`src/inject`）会被打成压缩的 IIFE，并以虚拟模块 `virtual:dshls/sw` 和 `virtual:dshls/inject` 的形式内联进 Host 产物（插件在 `tsdown.config.ts`，与 `vitest.config.ts` 共用）。入口缺失时构建失败，构建产物中不会有占位脚本。（`tsdown.config.ts` 里的 `ALLOW_PLACEHOLDER_ASSETS_BY_DEFAULT` 为 `false`；`DSHLS_REQUIRE_ASSETS=1` 在任何情况下都强制严格模式；只有 vitest 容忍入口缺失，以便 Host 测试保持可运行。）

`test/support/host-harness.ts` 会启动真实的 DSH Host WebServer、真实的 `@deepseek-ai/dsh-client-connection`（签名的浏览器会话 cookie、Host/Origin 围栏）和可计数连接的上游服务；用法见文件头注释。

## 移除

<!-- section: removal -->
把 `dsh.yaml` 中 `sidebar-local-service-browser` 条目设为 `enabled: false`，运行 `dsh build`，然后重启 DSH Host。Host 的路由（`/dsh-local-service`、`/dsh-local-service/ws`）和 index 守卫随之消失，在途的代理连接被关闭。tab 被移除，插件卸载时也会注销自己的 Service Worker。如果某个浏览器仍然留着该 worker，`/dsh-local-service/…` 下的请求会从 DSH 得到 404，按上文步骤手动清除即可。除此之外没有持久化数据：本插件留下的只有浏览器 `sessionStorage` 中按 tab 的条目（`__dshls.entries.*`，关闭标签页即丢弃）和名为 `dshls.…` 的代理 cookie，它们随浏览器会话或各自的有效期过期。
