## Why

通过 Cockpit 跨机使用 DSH 时，远端机器自己启动的本地服务（如 `127.0.0.1:5173` 的开发服务器）在浏览器所在电脑上会解析为本机地址，所以看不到；现在每个服务都要手动建一条 SSH 隧道。DSH 页面本身已经通过 Cockpit 的 workbench 隧道送达浏览器，挂在 DSH 同源 server 上的插件路由会随这条隧道一起走，所以只要由 DSH Host 代为访问本机端口，就不需要新隧道。

## What Changes

- 新增自研 local package `dsh-sidebar-local-service-browser`，在 better-sidebar 右侧工作台注册「本地服务」tab。
- 地址栏接受并显示直接地址（`127.0.0.1:5173/path`、`localhost:5173`、`[::1]:5173`），被代理的页面脚本读到的 `location.pathname` 等也是直接地址；iframe 内容来自 **DSH Host 所在机器**的该端口。
- Host 侧在 DSH 同源 web server 上注册代理前缀路由、一个 WebSocket 入口，并经官方 `tapIndex` 在 DSH 首页加一个历史恢复守卫：它是首页最终响应中第一个可执行的脚本，只在本 tab 的 iframe 内生效。每个请求都要通过 DSH 浏览器会话认证，且必须是同源请求，只转发到 Host 本机回环地址，并排除 DSH 自身端口。
- 前端用作用域受限的 Service Worker 改写子请求，用注入脚本处理 Navigation API 导航、`history.replaceState` 地址还原、WebSocket、cookie/存储视图；被代理页面不能注册自己的 Service Worker。加载前检查前置条件，不满足就不加载；加载后的失败闭合是尽力而为，已知例外在 design 中列明。
- 仅支持 Chromium 系浏览器；不支持项（嵌套 iframe、Worker 内 WebSocket、IndexedDB 隔离等）在 design 和 README 中列明。
- `dsh.yaml` 新增该 package 条目，依赖 `dsh-better-sidebar`（缺失时不激活）。
- 不修改 dsh-cockpit、dsh-cockpit-bridge 或 better-sidebar。

## Capabilities

### New Capabilities
- `sidebar-local-service-browser`：better-sidebar 内的本地服务浏览 tab，以及支撑它的 Host 同源回环代理，包括认证与 CSRF、目标限制、头与 cookie 处理、HTML 注入、Service Worker 与导航改写、WebSocket、失败闭合和生命周期。

### Modified Capabilities
（无）

## Impact

- 新增 `packages/sidebar-local-service-browser/`（Host 入口 + Web client 入口 + Service Worker/注入脚本 + 测试）。
- `dsh.yaml` 新增一条 local 定制；通过 `dsh build` 物化。
- 运行时：DSH web server 新增 `/dsh-local-service` 前缀路由、`/dsh-local-service/ws` 升级路由和一个 index `tapIndex` 变换；浏览器新增一个作用域为 `/dsh-local-service/` 的 Service Worker。
- 信任面：被代理页面与 DSH 同源，可调用 DSH API（设计中显式接受，并以常驻提示告知）；Host 新增一条“已认证的同源浏览器请求 → 本机任意回环端口”的通路。
- 依赖：DSH `>=0.2.2-rc.1 <0.3.0-0`（`webServer.register/registerUpgrade/port`、`connection.requestRejection`），`dsh-better-sidebar >=0.16.0`（`registerTab`），以及支持 Navigation API 与 Service Worker 的 Chromium 系浏览器。
