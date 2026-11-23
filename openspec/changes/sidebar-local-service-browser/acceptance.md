# 预览验收记录（tasks 15.5，本机直连部分）

- 日期：2026-11-24。执行人：browser-dev。
- **范围声明**：本记录只覆盖「本机直连」。浏览器（headless Chrome 157，由本机 DevTools 协议驱动）与预览 Host 在**同一台机器**上，这**不等于**「经 Cockpit 跨机」验收。**经 Cockpit 跨机的全部项目：未做**，由用户完成。
- 环境：worktree 隔离预览 Host（`node bin/dsh.mjs --no-open --foreground`，`DSH_PREVIEW` 输出 `http://127.0.0.1:3241`，isolated home）；全程没有触碰日常 3080，没有在预览中发起任何 Agent 对话或模型请求，只用「本地服务」tab 与代理。验收结束后预览 Host 已停止，3241、样例端口 5198/5199 均确认已关闭，没有残留 Chrome。
- 入口：用 launcher 输出的带 token 地址登录（token 不入库），在真实 better-sidebar 底部面板的「新建标签页」菜单里打开「本地服务」tab，地址栏输入 `127.0.0.1:5199`。
- 样例应用（仓库之外的临时目录，`mktemp -d`，用 npm 安装 vite 8.3.8、react、react-router-dom 7.18.6、@vitejs/plugin-react）：
  - Vite 开发服务器，端口 5199；路由 `/`、`/second`（由 `location.assign('/second')` 触发）、`/form`、`/cross`、`/login`。
  - 一个简易 node API 服务，端口 5198：`POST /form`、`GET /api/hello`、`GET /page`，并记录每个请求。
  - 登录 cookie：Vite 中间件 `/api-login` 通过 `Set-Cookie` 下发 `demo_user=alice; Path=/`（页面可读）与 `sid=s-secret; Path=/; HttpOnly`；`/whoami` 回显上游收到的 `Cookie` 头。
- 驱动与证据：独立脚本（在仓库外）经 DevTools 协议执行下列步骤并断言；证据为断言值、上游请求日志与 Chrome Network 事件。**没有截图**（脚本只做 DOM / 网络断言）。

## 清单

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| 1 | 页面能显示 | 通过 | tab 内页面 `#title` 为 `Hello v1`，页面读到的 `location.pathname` 为 `/`，地址栏为 `http://127.0.0.1:5199/` |
| 2 | HMR | 通过（见注 A） | 修改被 `import.meta.hot.accept()` 接收的模块后，页面文本 `hmr-value: A` 变为 `hmr-value: B`，同一文档未重载（先写入的 `window.__keep` 仍在）。HMR WebSocket 的创建地址是 `ws://127.0.0.1:3241/dsh-local-service/ws?fam=p&port=5199&path=…`，即经 Host 升级入口，没有直连 |
| 3 | 登录 cookie：JS 可读，后续请求会带上 | 通过 | `document.cookie` 为 `demo_user=alice`（不含 HttpOnly 的 `sid`，不含 `dsh-auth-`）；随后 `/whoami` 显示上游收到 `demo_user=alice; sid=s-secret` |
| 4 | `location.assign` 留在代理内，地址栏显示直接地址 | 通过 | 点击后页面 `location.pathname` 为 `/second`；浏览器实际导航请求为 `…:3241/dsh-local-service/p/5199/second`，没有对 DSH 发出裸 `/second`；地址栏 `http://127.0.0.1:5199/second` |
| 5 | 表单 POST 正文到达上游 | 通过 | API 服务记录：`POST /form`，`Host: 127.0.0.1:5198`，`Origin: http://127.0.0.1:5198`，正文 `note=hello-form`；结果页显示 `posted: note=hello-form`，地址栏 `http://127.0.0.1:5198/form` |
| 6 | 跨端口 API 到达 API 服务，且浏览器没有直连 | 通过 | 页面写死 `http://127.0.0.1:5198/api/hello` 的 `fetch` 得到 `hello-from-api`，API 日志有 `GET /api/hello`（Host、Referer 都是上游形式）；Chrome Network 中所有发往 `127.0.0.1\|localhost\|[::1]:5198` 的请求都由 Service Worker 应答（`fromServiceWorker=true`），非 Service Worker 的直连请求数为 0 |
| 7 | tab 内后退与前进 | 通过 | 序列：Vite `/second` → 整页跳到 API 端口的 `/page` → `history.back()`：地址栏恢复 `http://127.0.0.1:5199/second`，页面 `#title2` 在，注入标记在；`history.forward()`：地址栏恢复 `http://127.0.0.1:5198/page`，`location.pathname` 为 `/page` |
| 8 | 渲染后 DSH index 的守卫是第一个可执行脚本 | 通过 | 用 curl 取得认证 cookie 后分别请求 `/` 与 `/index.html`（均 200）：`<head>` 之后、第一个 `<script>` 之前只有 `<base href="./">`；第一个 `<script>` 含 `data-dshls` 与 `__dshls.entries`；整份页面共 13 个 `<script>` |

## 观察与注意

- **注 A（HMR 的样例选择）**：样例里 React Fast Refresh 的组件热更新，在**不经代理、直接打开 `http://127.0.0.1:5199/`** 的对照里也不更新文本（Vite 8 + plugin-react 的组合问题，与本插件无关），所以 HMR 一项改用 Vite 自身的 `import.meta.hot.accept()` 模块验证传输链路（Vite 的 `hmr update` 日志、模块经 Service Worker 取回、WebSocket 经 Host 入口）。组件级 Fast Refresh 在代理下的表现，本次**未验证**。
- **注 B（非 HTML 文档）**：试验过程中，tab 中的文档若是没有注入标记的响应（例如样例 API 对未知路径返回的 `text/plain` 404），tab 会按 spec（失败闭合）导航到 `about:blank` 并显示「页面阻止了注入脚本」。这符合 spec，但意味着 tab 无法直接查看 JSON、纯文本或 PDF 等非 HTML 文档。这是产品行为上的已知限制，建议写入 README 的支持边界；本次不改源码。
- 同一次预览里，API 日志会累积多轮脚本重复运行的记录，所以 `GET /api/hello` 条目可能不止一条，不影响结论。
- 本次未覆盖：IPv6（`[::1]`）目标；真实 Cockpit 跨机；非 Chromium 浏览器；样例应用以外的框架。
