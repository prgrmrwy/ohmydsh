# 浏览器可行性探针结果

- 日期：2026-11-23。授权见 [human-decisions.md](../human-decisions.md)。本文是第 3 轮评审（review-round3.md R3-M2）之后的修订版，替换了先前的结果。
- 环境：macOS；Google Chrome 157.0.8103.79，`--headless=new`，每次运行使用全新的临时 profile。
- 脚本：[browser-feasibility.mjs](browser-feasibility.mjs)。用 `node browser-feasibility.mjs [chrome 路径]` 运行，标准输出为 JSON 日志。原始日志不入库，重跑即可复现。
- 拓扑：全部用回环地址和随机端口，共四层：
  1. `cockpit` 页（端口 C）；
  2. 它的 iframe 里是假 DSH 页（端口 D）。C 与 D 跨端口、同站，对应 Cockpit 嵌套 DSH 的真实情况；
  3. DSH 页的 tab iframe（带 `data-dshls`）加载最小代理 `/dsh-local-service/p/<U>/…`；
  4. 代理背后是两个上游 U1 和 U2。
- 代理是设计机制的最小镜像，**不是插件代码**：
  - 注入：内联首脚本，插在 doctype/注释之后、第一个其它标签之前，并带每个响应单独生成的 nonce。
  - CSP nonce：按 D6 规则追加。
  - cookie：名称前缀为 `dshls.<DSH authority 哈希>.<族>.<端口>.`，`Path=/`。
  - SW：按 `resultingClientId` 记录 client 所属端口。
  - 注入脚本：用 `currententrychange` 维护 `entry.key → {族, 端口, rest}`，保存在原生 sessionStorage。
  - DSH index 守卫：位于 `<head>` 首位。
  - fallback：按真实实现，只有 `/` 返回 index，其余返回 404。
- 判定依据：
  - **直连计数**：代理请求一律带 `x-via-proxy: 1`。上游若收到不带该头的请求，即说明浏览器绕过代理、直连了浏览器本机。
  - **DSH 启动哨兵**：DSH index 中的「哨兵」脚本代表 DSH 自身的启动脚本，只要它在 tab iframe 内执行就会上报。
  - **哨兵的正向对照**：用同样带 `data-dshls` 的 iframe 加载去掉守卫的 index（`/?noguard`），确认哨兵在这种情况下确实会上报。这样“有守卫时计数为 0”才可以作为证据。
- 未覆盖：SW 被终止后从 IndexedDB 恢复（探针只记在内存里）；未受控时 `window.stop()` 的分支（第 4 轮 R4-M2 之后，spec 只承诺这个分支“停止安装、上报、只重载一次、清空 iframe”，不承诺页面脚本零执行；表中“守卫”行验证的是另一条控制流，不能拿来证明这个分支）；身份表的配额与坏值失败路径、按 frame 分命名空间（探针只用了单一键，也只包装了 `localStorage`）；真实 `renderIndex` 加 `frontend-static` 流水线中 `<base>` 与守卫的先后顺序（探针中的 index 是手写的）；真实 Cockpit/DSH 进程；跨 DSH authority 的 cookie 过滤（属于 Host 侧的纯逻辑，放到单元测试里）；Windows。

## 结论（最后一次运行：U1=51954，U2=51955，D=51956，authority 哈希 `1iLrmyfF`）

| 检查项 | 结果 | 证据 |
|---|---|---|
| 嵌在跨端口同站父页中的 DSH 页注册本插件 SW（scope `/dsh-local-service/`） | ✅ SW 处于 active；DSH 主页面 `controller=null` | `sw-active` |
| 上游 SW 带 `Service-Worker-Allowed: /` 并注册 scope `/` | ✅ 脚本请求带 `Service-Worker: script`，代理返回 403，注册失败 | `upstream-sw-root` |
| 页面内调用 `navigator.serviceWorker.register('/sw.js')` | ✅ 以 `SecurityError` 拒绝 | `start.swRegister` |
| `<head>` 之前就有页面脚本（`<!doctype><!-- c --><script>…</script><html><head>`） | ✅ 页面脚本执行时注入脚本已经运行完毕：`injectRanFirst=true`，读到的路径已是 `/start` | `start.preHead` |
| 页面读到的地址 | ✅ `/start?x=1` | `start.pathname` |
| 根路径子请求、写死的另一端口 `http://127.0.0.1:U2/api/x` | ✅ 分别被 SW 改写到 U1、U2 的代理路径，返回 `U1-asset`、`U2-api` | `rewrite`、`start` |
| JS cookie（cookie 名带 authority 哈希前缀） | ✅ 页面读到 `csrftoken=t1`；写入 `theme=dark` 后再读能读回；转发给上游的是 `csrftoken=t1; sid=s1; theme=dark`；`HttpOnly` 的 `sid` 页面读不到 | `start`、U1 日志 |
| `localStorage.clear()` | ✅ DSH 的 `dsh.settings` 仍在 | `dsh-ls-after` |
| `location.assign` / `replace` / `reload` | ✅ 三者都可取消，并改写到代理路径；replace 和 reload 不会增加历史条目 | `after-assign`、`after-replace`、`after-reload` |
| `form.requestSubmit()` / `form.submit()` POST | ✅ 上游分别收到 `a=1`、`b=2` | `after-requestSubmit`、`after-submit` |
| **SPA 路由后跨端口再后退（R3-C1）**：U1 `/spa` 依次执行 `pushState('/spa/route2')`、`replaceState({app:1},'/spa/route3')`，再整页跳到 U2 `/page2`，然后 `history.back()` | ✅ traverse 不可取消，浏览器先向 DSH 请求 `/spa/route3`，得到 404；按 `entry.key` 查到的身份是 `{p, U1, /spa/route3}`，tab 据此纠正为 U1 `/spa/route3`，没有落到 U2 | `back-to-spa-route-raw`、`-fixed` |
| 后退到 `/`（命中 DSH index） | ✅ 守卫按条目身份跳回 U1 `/`；**哨兵计数为 0**。正向对照中，不带守卫的 `/?noguard` 上报了 1 次 | `guard`、`after-back-to-root`、`dsh-index` |
| 前进 | ✅ 先拿到 404，再按条目身份纠正 | `forward-to-page3-*` |
| **CSP 同时含 `'unsafe-inline'` 和已有 nonce（R3-M1）**：`script-src 'unsafe-inline' 'nonce-old'` | ✅ 追加我们的 nonce 后注入脚本可以执行（标记为 true）；带 `nonce-old` 的页面脚本照常执行；不带 nonce 的内联脚本仍被拦截，计数为 0，与原策略的语义一致 | `csp-old-nonce-ran`、`csp-plain-inline-ran` 计数 |
| WebSocket：本端口，以及从未用 HTTP 访问过的另一端口 | ✅ 都改写到单一入口 `/dsh-local-service/ws?fam=p&port=…&path=…`，并带上全部 `Path=/` 的代理 cookie | `dsh-upgrade` ×2 |
| WS 升级请求的 `Sec-Fetch-Site` | ⚠️ 浏览器不发送；`Origin` 为 DSH origin | `dsh-upgrade` |
| 合法请求的 `Sec-Fetch-Site` | ✅ 代理路径上的导航、子请求、SW fetch、`sw.js` 全部为 `same-origin`。DSH 页被 Cockpit 跨端口嵌入时，其自身的 `/` 为 `same-site` | dsh 日志 |
| 全程直连浏览器本机端口的次数 | ✅ 0 | 上游日志中 `viaProxy=false` 计数 |
| SW 查不到 client 记录（`unknown-client`）的次数 | ✅ 0 | sw 日志 |

## 对设计的影响

1. 每条历史条目的身份用 `entry.key` 索引，存在原生 sessionStorage。`currententrychange` 覆盖了 `pushState`、`replaceState`、hash 变化，以及同文档内的 traverse。它不占用应用自己的 Navigation API state，也不受应用 `replaceState` 的影响。
2. CSP 的 nonce 规则：指令中已有 nonce、hash 或 `'strict-dynamic'` 时，必须追加我们的 nonce。只有在指令仅靠 `'unsafe-inline'` 放行内联脚本时，才不追加。
3. 守卫必须是 index 最终响应中的第一个可执行脚本（其前允许有官方 `<base href="./">`），并配一个能证明有效的哨兵对照。探针中的 index 是手写的，真实流水线中的顺序留到实现阶段验收。
4. cookie 前缀带上 DSH authority 哈希。同一浏览器通过不同 Cockpit 隧道访问的不同机器，它们的代理 cookie 互不转发。这一点由 Host 侧单元测试验证。
