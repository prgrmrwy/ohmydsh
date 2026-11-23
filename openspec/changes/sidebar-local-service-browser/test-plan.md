## Test Plan

覆盖账本。spec 中的每个 `#### Scenario:` 都对应一个命名测试：测试标题与 scenario 名逐字相同，并带 `spec Scenario` 前缀，方便机械核对。实施期间，每个测试第一次以正确原因失败（🔴）后再实现；通过后把这一行翻为 🟢。verify 阶段只要还有任何一行是红的，就阻断。

共 67 行，对应 spec 中的 67 个 scenario（第 67 行为实施阶段 spec 修订新增，见 review.md 的定向复核）。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/sidebar-local-service-browser/spec.md → 地址栏输入解析与显示 | 输入本机地址后加载对应代理并显示直接地址 | packages/sidebar-local-service-browser/test/tab-address.test.tsx | spec Scenario "输入本机地址后加载对应代理并显示直接地址" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 地址栏输入解析与显示 | 默认端口不被折叠 | packages/sidebar-local-service-browser/test/tab-address.test.tsx | spec Scenario "默认端口不被折叠" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 地址栏输入解析与显示 | IPv6 回环地址连接 Host 的 ::1 | packages/sidebar-local-service-browser/test/tab-address.test.tsx | spec Scenario "IPv6 回环地址连接 Host 的 ::1" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 地址栏输入解析与显示 | 非法输入不加载 | packages/sidebar-local-service-browser/test/tab-address.test.tsx | spec Scenario "非法输入不加载" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 代理请求的认证与来源限制 | 已认证的同源请求被转发 | packages/sidebar-local-service-browser/test/host-auth.test.ts | spec Scenario "已认证的同源请求被转发" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 代理请求的认证与来源限制 | 未认证请求不触达上游 | packages/sidebar-local-service-browser/test/host-auth.test.ts | spec Scenario "未认证请求不触达上游" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 代理请求的认证与来源限制 | 其它本机网页借用会话被拒绝 | packages/sidebar-local-service-browser/test/host-auth.test.ts | spec Scenario "其它本机网页借用会话被拒绝" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 代理请求的认证与来源限制 | sw.js 适用同一来源检查 | packages/sidebar-local-service-browser/test/host-auth.test.ts | spec Scenario "sw.js 适用同一来源检查" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 代理请求的认证与来源限制 | 缺少 Sec-Fetch-Site 被拒绝 | packages/sidebar-local-service-browser/test/host-auth.test.ts | spec Scenario "缺少 Sec-Fetch-Site 被拒绝" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 代理请求的认证与来源限制 | 跨端口 Origin 的升级被拒绝 | packages/sidebar-local-service-browser/test/host-ws.test.ts | spec Scenario "跨端口 Origin 的升级被拒绝" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 代理目标限制 | 指向 DSH 自身端口被拒绝 | packages/sidebar-local-service-browser/test/host-target.test.ts | spec Scenario "指向 DSH 自身端口被拒绝" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 代理目标限制 | Host 端口未知时拒绝 | packages/sidebar-local-service-browser/test/host-target.test.ts | spec Scenario "Host 端口未知时拒绝" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 代理目标限制 | 上游无服务时返回 502 | packages/sidebar-local-service-browser/test/host-target.test.ts | spec Scenario "上游无服务时返回 502" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 代理目标限制 | 长流不被总时长截断 | packages/sidebar-local-service-browser/test/host-target.test.ts | spec Scenario "长流不被总时长截断" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 请求与响应头的凭据处理 | 只有本端口的代理 cookie 被转发 | packages/sidebar-local-service-browser/test/host-headers.test.ts | spec Scenario "只有本端口的代理 cookie 被转发" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 请求与响应头的凭据处理 | 另一台机器的代理 cookie 不被转发 | packages/sidebar-local-service-browser/test/host-headers.test.ts | spec Scenario "另一台机器的代理 cookie 不被转发" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 请求与响应头的凭据处理 | 上游 Set-Cookie 被改名并放到根路径 | packages/sidebar-local-service-browser/test/host-headers.test.ts | spec Scenario "上游 Set-Cookie 被改名并放到根路径" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 请求与响应头的凭据处理 | Origin 与 Referer 改写为上游地址 | packages/sidebar-local-service-browser/test/host-headers.test.ts | spec Scenario "Origin 与 Referer 改写为上游地址" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 请求与响应头的凭据处理 | 文档请求去掉条件头 | packages/sidebar-local-service-browser/test/host-headers.test.ts | spec Scenario "文档请求去掉条件头" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 重定向与外部跳转 | 根路径与协议相对重定向 | packages/sidebar-local-service-browser/test/host-redirect.test.ts | spec Scenario "根路径与协议相对重定向" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 重定向与外部跳转 | 导航遇到外部重定向时返回提示页 | packages/sidebar-local-service-browser/test/host-redirect.test.ts | spec Scenario "导航遇到外部重定向时返回提示页" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 重定向与外部跳转 | 禁嵌头被移除 | packages/sidebar-local-service-browser/test/host-redirect.test.ts | spec Scenario "禁嵌头被移除" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → HTML 注入与传输语义 | 注入在任何页面脚本之前并加入 nonce | packages/sidebar-local-service-browser/test/host-html.test.ts | spec Scenario "注入在任何页面脚本之前并加入 nonce" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → HTML 注入与传输语义 | unsafe-inline 策略不被收紧 | packages/sidebar-local-service-browser/test/host-html.test.ts | spec Scenario "unsafe-inline 策略不被收紧" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → HTML 注入与传输语义 | unsafe-inline 与已有 nonce 共存时仍追加 | packages/sidebar-local-service-browser/test/browser/csp.browser.test.ts | spec Scenario "unsafe-inline 与已有 nonce 共存时仍追加" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → HTML 注入与传输语义 | gzip HTML 解压后注入，未知编码拒绝 | packages/sidebar-local-service-browser/test/host-html.test.ts | spec Scenario "gzip HTML 解压后注入，未知编码拒绝" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → HTML 注入与传输语义 | 带脚本的 404 页面同样注入 | packages/sidebar-local-service-browser/test/host-html.test.ts | spec Scenario "带脚本的 404 页面同样注入" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → HTML 注入与传输语义 | 超长未结束的开头注释触发有界回退 | packages/sidebar-local-service-browser/test/browser/inject-position.browser.test.ts | spec Scenario "超长未结束的开头注释触发有界回退" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → HTML 注入与传输语义 | 流式 HTML 先到先发 | packages/sidebar-local-service-browser/test/host-html.test.ts | spec Scenario "流式 HTML 先到先发" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → HTML 注入与传输语义 | 非 HTML 与 HEAD 不改写正文 | packages/sidebar-local-service-browser/test/host-html.test.ts | spec Scenario "非 HTML 与 HEAD 不改写正文" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 禁止被代理页面注册 Service Worker | 上游宽作用域注册被拒绝 | packages/sidebar-local-service-browser/test/browser/sw-guard.browser.test.ts | spec Scenario "上游宽作用域注册被拒绝" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 禁止被代理页面注册 Service Worker | 页面内注册调用被拒绝 | packages/sidebar-local-service-browser/test/browser/sw-guard.browser.test.ts | spec Scenario "页面内注册调用被拒绝" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 禁止被代理页面注册 Service Worker | 残留注册被清理 | packages/sidebar-local-service-browser/test/browser/sw-guard.browser.test.ts | spec Scenario "残留注册被清理" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 本插件 Service Worker 改写受控页面的子请求 | 根路径资源改写到当前端口 | packages/sidebar-local-service-browser/test/browser/sw-rewrite.browser.test.ts | spec Scenario "根路径资源改写到当前端口" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 本插件 Service Worker 改写受控页面的子请求 | 写死的另一本机端口地址被改写 | packages/sidebar-local-service-browser/test/browser/sw-rewrite.browser.test.ts | spec Scenario "写死的另一本机端口地址被改写" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 本插件 Service Worker 改写受控页面的子请求 | Service Worker 重启后仍按原端口改写 | packages/sidebar-local-service-browser/test/browser/sw-rewrite.browser.test.ts | spec Scenario "Service Worker 重启后仍按原端口改写" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 本插件 Service Worker 改写受控页面的子请求 | 未知 client 不放行 | packages/sidebar-local-service-browser/test/browser/sw-rewrite.browser.test.ts | spec Scenario "未知 client 不放行" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 本插件 Service Worker 改写受控页面的子请求 | DSH 主页面不受控 | packages/sidebar-local-service-browser/test/browser/sw-rewrite.browser.test.ts | spec Scenario "DSH 主页面不受控" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 页面看到直接地址，导航留在代理内 | 页面读到无前缀的路径 | packages/sidebar-local-service-browser/test/browser/navigation.browser.test.ts | spec Scenario "页面读到无前缀的路径" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 页面看到直接地址，导航留在代理内 | location.assign 到根路径留在代理内 | packages/sidebar-local-service-browser/test/browser/navigation.browser.test.ts | spec Scenario "location.assign 到根路径留在代理内" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 页面看到直接地址，导航留在代理内 | location.replace 与 reload 也被改写 | packages/sidebar-local-service-browser/test/browser/navigation.browser.test.ts | spec Scenario "location.replace 与 reload 也被改写" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 页面看到直接地址，导航留在代理内 | 程序化表单提交保留 POST 正文 | packages/sidebar-local-service-browser/test/browser/navigation.browser.test.ts | spec Scenario "程序化表单提交保留 POST 正文" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 页面看到直接地址，导航留在代理内 | 外部链接改为提示条 | packages/sidebar-local-service-browser/test/browser/navigation.browser.test.ts | spec Scenario "外部链接改为提示条" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 页面看到直接地址，导航留在代理内 | 身份表写入失败时停止 | packages/sidebar-local-service-browser/test/browser/identity-table.browser.test.ts | spec Scenario "身份表写入失败时停止" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 页面看到直接地址，导航留在代理内 | 页面清空 sessionStorage 不影响身份表 | packages/sidebar-local-service-browser/test/browser/identity-table.browser.test.ts | spec Scenario "页面清空 sessionStorage 不影响身份表" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 页面看到直接地址，导航留在代理内 | 失效条目被剪除且不影响其它 frame | packages/sidebar-local-service-browser/test/browser/identity-table.browser.test.ts | spec Scenario "失效条目被剪除且不影响其它 frame" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 页面看到直接地址，导航留在代理内 | 跨文档导航后旧条目仍保留 | packages/sidebar-local-service-browser/test/browser/identity-table.browser.test.ts | spec Scenario "跨文档导航后旧条目仍保留" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 页面看到直接地址，导航留在代理内 | 跨文档导航并重载后仍能按旧条目恢复 | packages/sidebar-local-service-browser/test/browser/history.browser.test.ts | spec Scenario "跨文档导航并重载后仍能按旧条目恢复" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 页面看到直接地址，导航留在代理内 | 挂载与卸载不删除其它存活 frame 的表 | packages/sidebar-local-service-browser/test/browser/identity-table.browser.test.ts | spec Scenario "挂载与卸载不删除其它存活 frame 的表" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 页面看到直接地址，导航留在代理内 | pushState 后地址栏同步 | packages/sidebar-local-service-browser/test/browser/navigation.browser.test.ts | spec Scenario "pushState 后地址栏同步" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → tab 内历史前进后退按条目身份恢复 | 跨端口后退回到正确的服务 | packages/sidebar-local-service-browser/test/browser/history.browser.test.ts | spec Scenario "跨端口后退回到正确的服务" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → tab 内历史前进后退按条目身份恢复 | 应用内路由变化后跨端口后退 | packages/sidebar-local-service-browser/test/browser/history.browser.test.ts | spec Scenario "应用内路由变化后跨端口后退" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → tab 内历史前进后退按条目身份恢复 | 后退到根路径时 DSH 不启动 | packages/sidebar-local-service-browser/test/browser/index-guard.browser.test.ts | spec Scenario "后退到根路径时 DSH 不启动" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → tab 内历史前进后退按条目身份恢复 | 最终 index 流水线中守卫是首个可执行脚本 | packages/sidebar-local-service-browser/test/browser/index-guard.browser.test.ts | spec Scenario "最终 index 流水线中守卫是首个可执行脚本" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → tab 内历史前进后退按条目身份恢复 | 没有身份记录时不猜测 | packages/sidebar-local-service-browser/test/browser/history.browser.test.ts | spec Scenario "没有身份记录时不猜测" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 页面内 cookie 与存储视图按端口隔开 | JS 读写 cookie 使用原名 | packages/sidebar-local-service-browser/test/browser/storage.browser.test.ts | spec Scenario "JS 读写 cookie 使用原名" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 页面内 cookie 与存储视图按端口隔开 | localStorage.clear 不影响 DSH 的键 | packages/sidebar-local-service-browser/test/browser/storage.browser.test.ts | spec Scenario "localStorage.clear 不影响 DSH 的键" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → WebSocket 代理 | 带登录态的 WebSocket 透传 | packages/sidebar-local-service-browser/test/browser/websocket.browser.test.ts | spec Scenario "带登录态的 WebSocket 透传" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → WebSocket 代理 | 只连 WebSocket 的另一端口也可用 | packages/sidebar-local-service-browser/test/browser/websocket.browser.test.ts | spec Scenario "只连 WebSocket 的另一端口也可用" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → WebSocket 代理 | 非法 path 被拒绝 | packages/sidebar-local-service-browser/test/host-ws.test.ts | spec Scenario "非法 path 被拒绝" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → WebSocket 代理 | 上游拒绝升级时关闭客户端 | packages/sidebar-local-service-browser/test/host-ws.test.ts | spec Scenario "上游拒绝升级时关闭客户端" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 前置条件不满足时失败闭合（尽力而为） | 浏览器不支持 Navigation API | packages/sidebar-local-service-browser/test/browser/fail-closed.browser.test.ts | spec Scenario "浏览器不支持 Navigation API" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 前置条件不满足时失败闭合（尽力而为） | Service Worker 注册失败 | packages/sidebar-local-service-browser/test/browser/fail-closed.browser.test.ts | spec Scenario "Service Worker 注册失败" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 前置条件不满足时失败闭合（尽力而为） | 页面未受控时停止并只重载一次 | packages/sidebar-local-service-browser/test/browser/fail-closed.browser.test.ts | spec Scenario "页面未受控时停止并只重载一次" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 可独立启停与卸载清理 | 正常启用时注册 tab 与路由 | packages/sidebar-local-service-browser/test/lifecycle.test.ts | spec Scenario "正常启用时注册 tab 与路由" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 可独立启停与卸载清理 | 缺少 connection 时不暴露路由 | packages/sidebar-local-service-browser/test/lifecycle.test.ts | spec Scenario "缺少 connection 时不暴露路由" | 🟢 green |
| specs/sidebar-local-service-browser/spec.md → 可独立启停与卸载清理 | 卸载时关闭在途连接与 Service Worker | packages/sidebar-local-service-browser/test/browser/lifecycle.browser.test.ts | spec Scenario "卸载时关闭在途连接与 Service Worker" | 🟢 green |

## Coverage Notes

- **两类测试**：
  - **Node 测试**：`test/*.test.ts(x)`，用 vitest 运行，命令是 `npm test`。Host 侧测试在随机回环端口上起真实的 `node:http` 上游，并用真实的 Host WebServer 加载插件。认证使用安装包中真实的 `@deepseek-ai/dsh-client-connection` 服务，cookie 由它的浏览器认证流程签发，不用 mock 的 gate 冒充。“上游连接数为 0”这类断言，统计的是上游 server 的 `connection` 事件计数。tab 的地址栏测试在 jsdom 中渲染组件，断言 iframe 的 `src` 和地址栏文本。
  - **浏览器测试**：`test/browser/*.browser.test.ts`，由独立的 vitest 配置 `vitest.browser.config.ts` 运行，命令是 `npm run test:browser`。共享 harness `test/browser/harness.ts` 沿用探针的拓扑：模拟 Cockpit 的跨端口父页、加载真实插件 Host 与 client 产物的 DSH 测试实例、两个以上上游，并通过 DevTools 协议控制 headless Chrome。DevTools 协议用于 `ServiceWorker.stopWorker` 和读取网络事件。
- **零 skip**：浏览器测试必须有 Chrome。harness 找不到 Chrome 时直接失败并报出路径，**不**跳过。CI 或本机的 Chrome 路径由 `DSHLS_CHROME` 指定，默认值为 macOS 的标准安装路径。
- **正向对照**：所有“计数为 0”的断言，都要在同一测试里配一个可达的正向对照，证明计数器确实会响。例如“哨兵不上报”配“无守卫或无 `data-dshls` 时上报”，“上游连接数为 0”配“合法请求时为 1”。每个断言都在明确的完成信号之后执行，不能用“没有日志”代替。
- **真实流水线**：《最终 index 流水线中守卫是首个可执行脚本》必须使用真实的 `renderIndex` 加 `@deepseek-ai/dsh-host-frontend-static` fallback，再加两个测试插件：一个在本插件之前激活，一个在之后激活。不允许手写 index。
- **跨 authority**：《另一台机器的代理 cookie 不被转发》在 Node 测试中用两个不同的 `Host` 值发请求，HTTP 与 WebSocket 共用同一个 authority 哈希函数。
- **测试位置调整**（2026-11-23，实施中由 lead 裁定，属于 test-plan 自身的修订，spec 未改）：《unsafe-inline 与已有 nonce 共存时仍追加》的 THEN 要断言脚本是否执行，只能在 Chromium 中验证，因此从 `host-html.test.ts` 移到 `browser/csp.browser.test.ts`。Host 侧对 CSP 头的断言作为额外测试，保留在 `host-html.test.ts` 中。
- **时间缩放**：时长写进 THEN 的场景，命名测试必须按 spec 的原始数值执行（例如《长流不被总时长截断》是 6 条事件、每条间隔 5 秒、共 30 秒）。缩短后的版本只能作为额外测试。用“测试显式放行”代替“等待 N 秒”是允许的，前提是新写法的断言不比原来弱。
- **额外测试**（不列入上表，多写不限）：CSP 改写的多策略、逗号分隔、`script-src-elem` 优先、`default-src` 回退等参数化用例；注入位置扫描器对 BOM、注释、`<header>` 文本的单元测试；`form.requestSubmit` 带 submitter、`formaction`、`formmethod` 和 multipart 文件的样本（review-round4 建议 4）；Storage 包装的属性访问。
- **留到 verify 之前的人工或集成门禁**（不属于自动化测试行）：真实 Cockpit 跨机验收，样本为 Vite + React Router 应用；`dsh build` 连续两次，第二次无变化；在 worktree 预览中验收。
