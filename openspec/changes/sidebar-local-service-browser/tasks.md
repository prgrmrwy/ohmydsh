## 0. 准备与脚手架

- [x] 0.1 按 `packages/sidebar-session-resources` 新建 `packages/sidebar-local-service-browser/`：package.json（name `dsh-sidebar-local-service-browser`，engines.dsh 与 peer 版本照 proposal）、tsconfig、tsdown（Host、client，以及 sw/inject 两个字符串 entry）、vitest 配置（`vitest.config.ts` 与 `vitest.browser.config.ts`）、cordis.patch.yml、README 骨架；确认 `npm run build` 与 `npm test` 能跑通空套件
- [x] 0.2 编写浏览器测试 harness `test/browser/harness.ts`：参照 probes/browser-feasibility.mjs，搭建模拟 Cockpit 的跨端口父页、加载真实插件产物的 DSH 测试实例与上游；通过 DevTools 协议控制 headless Chrome，找不到 Chrome 时直接失败。先写一个冒烟测试证明 harness 能跑，失败时先修 harness
- [x] 0.3 编写 Node 测试 harness：真实 Host WebServer、真实 `dsh-client-connection`（签发与校验 cookie）、可计数连接的上游 server；确认 `requestRejection` 在 harness 中对无 cookie 请求返回 401

## 1. 地址栏输入解析与显示

实现要点：地址解析器（原始文本取端口、族映射、错误文案）与 tab 地址栏/iframe 联动（design D1）

- [x] 1.1 Write failing test: `test/tab-address.test.tsx` → spec Scenario "输入本机地址后加载对应代理并显示直接地址"（断言其因缺少对应行为而失败）
- [x] 1.2 Implement: 使 1.1 通过（地址栏输入解析与显示）
- [x] 1.3 Refactor；`npm test` 全部保持绿色
- [x] 1.4 Write failing test: `test/tab-address.test.tsx` → spec Scenario "默认端口不被折叠"（断言其因缺少对应行为而失败）
- [x] 1.5 Implement: 使 1.4 通过（地址栏输入解析与显示）
- [x] 1.6 Refactor；`npm test` 全部保持绿色
- [x] 1.7 Write failing test: `test/tab-address.test.tsx` → spec Scenario "IPv6 回环地址连接 Host 的 ::1"（断言其因缺少对应行为而失败）
- [x] 1.8 Implement: 使 1.7 通过（地址栏输入解析与显示）
- [x] 1.9 Refactor；`npm test` 全部保持绿色
- [x] 1.10 Write failing test: `test/tab-address.test.tsx` → spec Scenario "非法输入不加载"（断言其因缺少对应行为而失败）
- [x] 1.11 Implement: 使 1.10 通过（地址栏输入解析与显示）
- [x] 1.12 Refactor；`npm test` 全部保持绿色

## 2. 代理请求的认证与来源限制

实现要点：Host 路由入口：官方 requestRejection + Sec-Fetch-Site same-origin|none fence，覆盖代理路径与 sw.js；WS 只走官方 gate（design D2）

- [x] 2.1 Write failing test: `test/host-auth.test.ts` → spec Scenario "已认证的同源请求被转发"（断言其因缺少对应行为而失败）
- [x] 2.2 Implement: 使 2.1 通过（代理请求的认证与来源限制）
- [x] 2.3 Refactor；`npm test` 全部保持绿色
- [x] 2.4 Write failing test: `test/host-auth.test.ts` → spec Scenario "未认证请求不触达上游"（断言其因缺少对应行为而失败）
- [x] 2.5 Implement: 使 2.4 通过（代理请求的认证与来源限制）
- [x] 2.6 Refactor；`npm test` 全部保持绿色
- [x] 2.7 Write failing test: `test/host-auth.test.ts` → spec Scenario "其它本机网页借用会话被拒绝"（断言其因缺少对应行为而失败）
- [x] 2.8 Implement: 使 2.7 通过（代理请求的认证与来源限制）
- [x] 2.9 Refactor；`npm test` 全部保持绿色
- [x] 2.10 Write failing test: `test/host-auth.test.ts` → spec Scenario "sw.js 适用同一来源检查"（断言其因缺少对应行为而失败）
- [x] 2.11 Implement: 使 2.10 通过（代理请求的认证与来源限制）
- [x] 2.12 Refactor；`npm test` 全部保持绿色
- [x] 2.13 Write failing test: `test/host-auth.test.ts` → spec Scenario "缺少 Sec-Fetch-Site 被拒绝"（断言其因缺少对应行为而失败）
- [x] 2.14 Implement: 使 2.13 通过（代理请求的认证与来源限制）
- [x] 2.15 Refactor；`npm test` 全部保持绿色
- [x] 2.16 Write failing test: `test/host-ws.test.ts` → spec Scenario "跨端口 Origin 的升级被拒绝"（断言其因缺少对应行为而失败）
- [x] 2.17 Implement: 使 2.16 通过（代理请求的认证与来源限制）
- [x] 2.18 Refactor；`npm test` 全部保持绿色

## 3. 代理目标限制

实现要点：目标解析：族→主机、端口校验、现场读取 webServer.port、10s 建连超时与无总时长流（design D3）

- [x] 3.1 Write failing test: `test/host-target.test.ts` → spec Scenario "指向 DSH 自身端口被拒绝"（断言其因缺少对应行为而失败）
- [x] 3.2 Implement: 使 3.1 通过（代理目标限制）
- [x] 3.3 Refactor；`npm test` 全部保持绿色
- [x] 3.4 Write failing test: `test/host-target.test.ts` → spec Scenario "Host 端口未知时拒绝"（断言其因缺少对应行为而失败）
- [x] 3.5 Implement: 使 3.4 通过（代理目标限制）
- [x] 3.6 Refactor；`npm test` 全部保持绿色
- [x] 3.7 Write failing test: `test/host-target.test.ts` → spec Scenario "上游无服务时返回 502"（断言其因缺少对应行为而失败）
- [x] 3.8 Implement: 使 3.7 通过（代理目标限制）
- [x] 3.9 Refactor；`npm test` 全部保持绿色
- [x] 3.10 Write failing test: `test/host-target.test.ts` → spec Scenario "长流不被总时长截断"（断言其因缺少对应行为而失败）
- [x] 3.11 Implement: 使 3.10 通过（代理目标限制）
- [x] 3.12 Refactor；`npm test` 全部保持绿色

## 4. 请求与响应头的凭据处理

实现要点：cookie authority 前缀白名单与 Set-Cookie 改写、Origin/Referer/Authorization/条件头规则（design D4、D5）

- [x] 4.1 Write failing test: `test/host-headers.test.ts` → spec Scenario "只有本端口的代理 cookie 被转发"（断言其因缺少对应行为而失败）
- [x] 4.2 Implement: 使 4.1 通过（请求与响应头的凭据处理）
- [x] 4.3 Refactor；`npm test` 全部保持绿色
- [x] 4.4 Write failing test: `test/host-headers.test.ts` → spec Scenario "另一台机器的代理 cookie 不被转发"（断言其因缺少对应行为而失败）
- [x] 4.5 Implement: 使 4.4 通过（请求与响应头的凭据处理）
- [x] 4.6 Refactor；`npm test` 全部保持绿色
- [x] 4.7 Write failing test: `test/host-headers.test.ts` → spec Scenario "上游 Set-Cookie 被改名并放到根路径"（断言其因缺少对应行为而失败）
- [x] 4.8 Implement: 使 4.7 通过（请求与响应头的凭据处理）
- [x] 4.9 Refactor；`npm test` 全部保持绿色
- [x] 4.10 Write failing test: `test/host-headers.test.ts` → spec Scenario "Origin 与 Referer 改写为上游地址"（断言其因缺少对应行为而失败）
- [x] 4.11 Implement: 使 4.10 通过（请求与响应头的凭据处理）
- [x] 4.12 Refactor；`npm test` 全部保持绿色
- [x] 4.13 Write failing test: `test/host-headers.test.ts` → spec Scenario "文档请求去掉条件头"（断言其因缺少对应行为而失败）
- [x] 4.14 Implement: 使 4.13 通过（请求与响应头的凭据处理）
- [x] 4.15 Refactor；`npm test` 全部保持绿色

## 5. 重定向与外部跳转

实现要点：Location 解析改写、导航外跳提示页、去除禁嵌头（spec 重定向要求）

- [x] 5.1 Write failing test: `test/host-redirect.test.ts` → spec Scenario "根路径与协议相对重定向"（断言其因缺少对应行为而失败）
- [x] 5.2 Implement: 使 5.1 通过（重定向与外部跳转）
- [x] 5.3 Refactor；`npm test` 全部保持绿色
- [x] 5.4 Write failing test: `test/host-redirect.test.ts` → spec Scenario "导航遇到外部重定向时返回提示页"（断言其因缺少对应行为而失败）
- [x] 5.5 Implement: 使 5.4 通过（重定向与外部跳转）
- [x] 5.6 Refactor；`npm test` 全部保持绿色
- [x] 5.7 Write failing test: `test/host-redirect.test.ts` → spec Scenario "禁嵌头被移除"（断言其因缺少对应行为而失败）
- [x] 5.8 Implement: 使 5.7 通过（重定向与外部跳转）
- [x] 5.9 Refactor；`npm test` 全部保持绿色

## 6. HTML 注入与传输语义

实现要点：注入位置扫描器、per-response nonce 与 CSP 规则、解压/流式/缓存头处理（design D6）

- [x] 6.1 Write failing test: `test/host-html.test.ts` → spec Scenario "注入在任何页面脚本之前并加入 nonce"（断言其因缺少对应行为而失败）
- [x] 6.2 Implement: 使 6.1 通过（HTML 注入与传输语义）
- [x] 6.3 Refactor；`npm test` 全部保持绿色
- [x] 6.4 Write failing test: `test/host-html.test.ts` → spec Scenario "unsafe-inline 策略不被收紧"（断言其因缺少对应行为而失败）
- [x] 6.5 Implement: 使 6.4 通过（HTML 注入与传输语义）
- [x] 6.6 Refactor；`npm test` 全部保持绿色
- [x] 6.7 Write failing test: `test/browser/csp.browser.test.ts` → spec Scenario "unsafe-inline 与已有 nonce 共存时仍追加"（断言其因缺少对应行为而失败；负责人 browser-dev。Host 侧 CSP 头断言作为额外测试保留在 host-html.test.ts）
- [x] 6.8 Implement: 使 6.7 通过（HTML 注入与传输语义）
- [x] 6.9 Refactor；`npm test` 与 `npm run test:browser` 全部保持绿色
- [x] 6.10 Write failing test: `test/host-html.test.ts` → spec Scenario "gzip HTML 解压后注入，未知编码拒绝"（断言其因缺少对应行为而失败）
- [x] 6.11 Implement: 使 6.10 通过（HTML 注入与传输语义）
- [x] 6.12 Refactor；`npm test` 全部保持绿色
- [x] 6.13 Write failing test: `test/host-html.test.ts` → spec Scenario "带脚本的 404 页面同样注入"（断言其因缺少对应行为而失败）
- [x] 6.14 Implement: 使 6.13 通过（HTML 注入与传输语义）
- [x] 6.15 Refactor；`npm test` 全部保持绿色
- [x] 6.A1 Write failing test: `test/browser/inject-position.browser.test.ts` → spec Scenario "超长未结束的开头注释触发有界回退"（实施阶段 spec 修订新增；负责人 host-dev）
- [x] 6.A2 Implement: 使 6.A1 通过（HTML 注入与传输语义）
- [x] 6.A3 Refactor；`npm test` 与 `npm run test:browser` 全部保持绿色
- [x] 6.16 Write failing test: `test/host-html.test.ts` → spec Scenario "流式 HTML 先到先发"（断言其因缺少对应行为而失败）
- [x] 6.17 Implement: 使 6.16 通过（HTML 注入与传输语义）
- [x] 6.18 Refactor；`npm test` 全部保持绿色
- [x] 6.19 Write failing test: `test/host-html.test.ts` → spec Scenario "非 HTML 与 HEAD 不改写正文"（断言其因缺少对应行为而失败）
- [x] 6.20 Implement: 使 6.19 通过（HTML 注入与传输语义）
- [x] 6.21 Refactor；`npm test` 全部保持绿色

## 7. 禁止被代理页面注册 Service Worker

实现要点：Service-Worker: script 403、剥离 Service-Worker-Allowed、注入脚本拒绝 register、tab 挂载清理（design D8）

- [x] 7.1 Write failing test: `test/browser/sw-guard.browser.test.ts` → spec Scenario "上游宽作用域注册被拒绝"（断言其因缺少对应行为而失败）
- [x] 7.2 Implement: 使 7.1 通过（禁止被代理页面注册 Service Worker）
- [x] 7.3 Refactor；`npm test` 全部保持绿色
- [x] 7.4 Write failing test: `test/browser/sw-guard.browser.test.ts` → spec Scenario "页面内注册调用被拒绝"（断言其因缺少对应行为而失败）
- [x] 7.5 Implement: 使 7.4 通过（禁止被代理页面注册 Service Worker）
- [x] 7.6 Refactor；`npm test` 全部保持绿色
- [x] 7.7 Write failing test: `test/browser/sw-guard.browser.test.ts` → spec Scenario "残留注册被清理"（断言其因缺少对应行为而失败）
- [x] 7.8 Implement: 使 7.7 通过（禁止被代理页面注册 Service Worker）
- [x] 7.9 Refactor；`npm test` 全部保持绿色

## 8. 本插件 Service Worker 改写受控页面的子请求

实现要点：SW：client→身份记录（内存+IndexedDB）、三条改写规则、未知 client 502（design D8）

- [x] 8.1 Write failing test: `test/browser/sw-rewrite.browser.test.ts` → spec Scenario "根路径资源改写到当前端口"（断言其因缺少对应行为而失败）
- [x] 8.2 Implement: 使 8.1 通过（本插件 Service Worker 改写受控页面的子请求）
- [x] 8.3 Refactor；`npm test` 全部保持绿色
- [x] 8.4 Write failing test: `test/browser/sw-rewrite.browser.test.ts` → spec Scenario "写死的另一本机端口地址被改写"（断言其因缺少对应行为而失败）
- [x] 8.5 Implement: 使 8.4 通过（本插件 Service Worker 改写受控页面的子请求）
- [x] 8.6 Refactor；`npm test` 全部保持绿色
- [x] 8.7 Write failing test: `test/browser/sw-rewrite.browser.test.ts` → spec Scenario "Service Worker 重启后仍按原端口改写"（断言其因缺少对应行为而失败）
- [x] 8.8 Implement: 使 8.7 通过（本插件 Service Worker 改写受控页面的子请求）
- [x] 8.9 Refactor；`npm test` 全部保持绿色
- [x] 8.10 Write failing test: `test/browser/sw-rewrite.browser.test.ts` → spec Scenario "未知 client 不放行"（断言其因缺少对应行为而失败）
- [x] 8.11 Implement: 使 8.10 通过（本插件 Service Worker 改写受控页面的子请求）
- [x] 8.12 Refactor；`npm test` 全部保持绿色
- [x] 8.13 Write failing test: `test/browser/sw-rewrite.browser.test.ts` → spec Scenario "DSH 主页面不受控"（断言其因缺少对应行为而失败）
- [x] 8.14 Implement: 使 8.13 通过（本插件 Service Worker 改写受控页面的子请求）
- [x] 8.15 Refactor；`npm test` 全部保持绿色

## 9. 页面看到直接地址，导航留在代理内

实现要点：注入脚本：受控检查、replaceState、身份表（原生 sessionStorage、frameId 命名空间、剪除、校验、失败停止、合并、清理）、navigate/submit 拦截、外跳提示条、地址栏同步（design D7）

- [x] 9.1 Write failing test: `test/browser/navigation.browser.test.ts` → spec Scenario "页面读到无前缀的路径"（断言其因缺少对应行为而失败）
- [x] 9.2 Implement: 使 9.1 通过（页面看到直接地址，导航留在代理内）
- [x] 9.3 Refactor；`npm test` 全部保持绿色
- [x] 9.4 Write failing test: `test/browser/navigation.browser.test.ts` → spec Scenario "location.assign 到根路径留在代理内"（断言其因缺少对应行为而失败）
- [x] 9.5 Implement: 使 9.4 通过（页面看到直接地址，导航留在代理内）
- [x] 9.6 Refactor；`npm test` 全部保持绿色
- [x] 9.7 Write failing test: `test/browser/navigation.browser.test.ts` → spec Scenario "location.replace 与 reload 也被改写"（断言其因缺少对应行为而失败）
- [x] 9.8 Implement: 使 9.7 通过（页面看到直接地址，导航留在代理内）
- [x] 9.9 Refactor；`npm test` 全部保持绿色
- [x] 9.10 Write failing test: `test/browser/navigation.browser.test.ts` → spec Scenario "程序化表单提交保留 POST 正文"（断言其因缺少对应行为而失败）
- [x] 9.11 Implement: 使 9.10 通过（页面看到直接地址，导航留在代理内）
- [x] 9.12 Refactor；`npm test` 全部保持绿色
- [x] 9.13 Write failing test: `test/browser/navigation.browser.test.ts` → spec Scenario "外部链接改为提示条"（断言其因缺少对应行为而失败）
- [x] 9.14 Implement: 使 9.13 通过（页面看到直接地址，导航留在代理内）
- [x] 9.15 Refactor；`npm test` 全部保持绿色
- [x] 9.16 Write failing test: `test/browser/identity-table.browser.test.ts` → spec Scenario "身份表写入失败时停止"（断言其因缺少对应行为而失败）
- [x] 9.17 Implement: 使 9.16 通过（页面看到直接地址，导航留在代理内）
- [x] 9.18 Refactor；`npm test` 全部保持绿色
- [x] 9.19 Write failing test: `test/browser/identity-table.browser.test.ts` → spec Scenario "页面清空 sessionStorage 不影响身份表"（断言其因缺少对应行为而失败）
- [x] 9.20 Implement: 使 9.19 通过（页面看到直接地址，导航留在代理内）
- [x] 9.21 Refactor；`npm test` 全部保持绿色
- [x] 9.22 Write failing test: `test/browser/identity-table.browser.test.ts` → spec Scenario "失效条目被剪除且不影响其它 frame"（断言其因缺少对应行为而失败）
- [x] 9.23 Implement: 使 9.22 通过（页面看到直接地址，导航留在代理内）
- [x] 9.24 Refactor；`npm test` 全部保持绿色
- [x] 9.25 Write failing test: `test/browser/identity-table.browser.test.ts` → spec Scenario "跨文档导航后旧条目仍保留"（断言其因缺少对应行为而失败）
- [x] 9.26 Implement: 使 9.25 通过（页面看到直接地址，导航留在代理内）
- [x] 9.27 Refactor；`npm test` 全部保持绿色
- [x] 9.28 Write failing test: `test/browser/history.browser.test.ts` → spec Scenario "跨文档导航并重载后仍能按旧条目恢复"（断言其因缺少对应行为而失败）
- [x] 9.29 Implement: 使 9.28 通过（页面看到直接地址，导航留在代理内）
- [x] 9.30 Refactor；`npm test` 全部保持绿色
- [x] 9.31 Write failing test: `test/browser/identity-table.browser.test.ts` → spec Scenario "挂载与卸载不删除其它存活 frame 的表"（断言其因缺少对应行为而失败）
- [x] 9.32 Implement: 使 9.31 通过（页面看到直接地址，导航留在代理内）
- [x] 9.33 Refactor；`npm test` 全部保持绿色
- [x] 9.34 Write failing test: `test/browser/navigation.browser.test.ts` → spec Scenario "pushState 后地址栏同步"（断言其因缺少对应行为而失败）
- [x] 9.35 Implement: 使 9.34 通过（页面看到直接地址，导航留在代理内）
- [x] 9.36 Refactor；`npm test` 全部保持绿色

## 10. tab 内历史前进后退按条目身份恢复

实现要点：tapIndex 守卫（首个可执行脚本、根绝对恢复路径）与 tab 的 load 纠正（design D7 第 5 步）

- [x] 10.1 Write failing test: `test/browser/history.browser.test.ts` → spec Scenario "跨端口后退回到正确的服务"（断言其因缺少对应行为而失败）
- [x] 10.2 Implement: 使 10.1 通过（tab 内历史前进后退按条目身份恢复）
- [x] 10.3 Refactor；`npm test` 全部保持绿色
- [x] 10.4 Write failing test: `test/browser/history.browser.test.ts` → spec Scenario "应用内路由变化后跨端口后退"（断言其因缺少对应行为而失败）
- [x] 10.5 Implement: 使 10.4 通过（tab 内历史前进后退按条目身份恢复）
- [x] 10.6 Refactor；`npm test` 全部保持绿色
- [x] 10.7 Write failing test: `test/browser/index-guard.browser.test.ts` → spec Scenario "后退到根路径时 DSH 不启动"（断言其因缺少对应行为而失败）
- [x] 10.8 Implement: 使 10.7 通过（tab 内历史前进后退按条目身份恢复）
- [x] 10.9 Refactor；`npm test` 全部保持绿色
- [x] 10.10 Write failing test: `test/browser/index-guard.browser.test.ts` → spec Scenario "最终 index 流水线中守卫是首个可执行脚本"（断言其因缺少对应行为而失败）
- [x] 10.11 Implement: 使 10.10 通过（tab 内历史前进后退按条目身份恢复）
- [x] 10.12 Refactor；`npm test` 全部保持绿色
- [x] 10.13 Write failing test: `test/browser/history.browser.test.ts` → spec Scenario "没有身份记录时不猜测"（断言其因缺少对应行为而失败）
- [x] 10.14 Implement: 使 10.13 通过（tab 内历史前进后退按条目身份恢复）
- [x] 10.15 Refactor；`npm test` 全部保持绿色

## 11. 页面内 cookie 与存储视图按端口隔开

实现要点：Document.prototype.cookie 覆盖、local/sessionStorage 前缀包装、cookieStore 置空（design D4）

- [x] 11.1 Write failing test: `test/browser/storage.browser.test.ts` → spec Scenario "JS 读写 cookie 使用原名"（断言其因缺少对应行为而失败）
- [x] 11.2 Implement: 使 11.1 通过（页面内 cookie 与存储视图按端口隔开）
- [x] 11.3 Refactor；`npm test` 全部保持绿色
- [x] 11.4 Write failing test: `test/browser/storage.browser.test.ts` → spec Scenario "localStorage.clear 不影响 DSH 的键"（断言其因缺少对应行为而失败）
- [x] 11.5 Implement: 使 11.4 通过（页面内 cookie 与存储视图按端口隔开）
- [x] 11.6 Refactor；`npm test` 全部保持绿色

## 12. WebSocket 代理

实现要点：WebSocket 构造函数包装、/dsh-local-service/ws 升级处理：校验、白名单头、101 握手、head 字节、双向关闭（design D10）

- [x] 12.1 Write failing test: `test/browser/websocket.browser.test.ts` → spec Scenario "带登录态的 WebSocket 透传"（断言其因缺少对应行为而失败）
- [x] 12.2 Implement: 使 12.1 通过（WebSocket 代理）
- [x] 12.3 Refactor；`npm test` 全部保持绿色
- [x] 12.4 Write failing test: `test/browser/websocket.browser.test.ts` → spec Scenario "只连 WebSocket 的另一端口也可用"（断言其因缺少对应行为而失败）
- [x] 12.5 Implement: 使 12.4 通过（WebSocket 代理）
- [x] 12.6 Refactor；`npm test` 全部保持绿色
- [x] 12.7 Write failing test: `test/host-ws.test.ts` → spec Scenario "非法 path 被拒绝"（断言其因缺少对应行为而失败）
- [x] 12.8 Implement: 使 12.7 通过（WebSocket 代理）
- [x] 12.9 Refactor；`npm test` 全部保持绿色
- [x] 12.10 Write failing test: `test/host-ws.test.ts` → spec Scenario "上游拒绝升级时关闭客户端"（断言其因缺少对应行为而失败）
- [x] 12.11 Implement: 使 12.10 通过（WebSocket 代理）
- [x] 12.12 Refactor；`npm test` 全部保持绿色

## 13. 前置条件不满足时失败闭合（尽力而为）

实现要点：tab 前置检查、未受控重载一次、无注入标记清空（design D11）

- [x] 13.1 Write failing test: `test/browser/fail-closed.browser.test.ts` → spec Scenario "浏览器不支持 Navigation API"（断言其因缺少对应行为而失败）
- [x] 13.2 Implement: 使 13.1 通过（前置条件不满足时失败闭合（尽力而为））
- [x] 13.3 Refactor；`npm test` 全部保持绿色
- [x] 13.4 Write failing test: `test/browser/fail-closed.browser.test.ts` → spec Scenario "Service Worker 注册失败"（断言其因缺少对应行为而失败）
- [x] 13.5 Implement: 使 13.4 通过（前置条件不满足时失败闭合（尽力而为））
- [x] 13.6 Refactor；`npm test` 全部保持绿色
- [x] 13.7 Write failing test: `test/browser/fail-closed.browser.test.ts` → spec Scenario "页面未受控时停止并只重载一次"（断言其因缺少对应行为而失败）
- [x] 13.8 Implement: 使 13.7 通过（前置条件不满足时失败闭合（尽力而为））
- [x] 13.9 Refactor；`npm test` 全部保持绿色

## 14. 可独立启停与卸载清理

实现要点：Host/client 入口装配、connection 缺失不注册、卸载清理在途 socket 与 SW 注销（design D12）

- [x] 14.1 Write failing test: `test/lifecycle.test.ts` → spec Scenario "正常启用时注册 tab 与路由"（断言其因缺少对应行为而失败）
- [x] 14.2 Implement: 使 14.1 通过（可独立启停与卸载清理）
- [x] 14.3 Refactor；`npm test` 全部保持绿色
- [x] 14.4 Write failing test: `test/lifecycle.test.ts` → spec Scenario "缺少 connection 时不暴露路由"（断言其因缺少对应行为而失败）
- [x] 14.5 Implement: 使 14.4 通过（可独立启停与卸载清理）
- [x] 14.6 Refactor；`npm test` 全部保持绿色
- [x] 14.7 Write failing test: `test/browser/lifecycle.browser.test.ts` → spec Scenario "卸载时关闭在途连接与 Service Worker"（断言其因缺少对应行为而失败）
- [x] 14.8 Implement: 使 14.7 通过（可独立启停与卸载清理）
- [x] 14.9 Refactor；`npm test` 全部保持绿色

## 16. 跨机试用后的修订（2026-11-24，见 human-decisions.md）

- [x] 16.1 对 spec 修订（非网页提示、返回按钮）做定向复核，结论为 APPROVE 后才实施（review.md「Targeted re-review 6 (post-ponytail)」APPROVE，spec SHA 5718df92…）
- [x] 16.2 Write failing test: `browser/fail-closed.browser.test.ts` → spec Scenario "非网页响应显示类型和可读状态码"
- [x] 16.3 Implement: 使 16.2 通过
- [x] 16.4 Refactor；`npm test` 与 `npm run test:browser` 全部保持绿色
- [x] 16.5 Write failing test: `browser/fail-closed.browser.test.ts` → spec Scenario "被阻止注入的网页仍提示注入被阻止"
- [x] 16.6 Implement: 使 16.5 通过
- [x] 16.7 Refactor；`npm test` 与 `npm run test:browser` 全部保持绿色
- [x] 16.A1 Write failing test: `tab-not-html.test.tsx` → spec Scenario "状态码不可读时只显示内容类型"
- [x] 16.A2 Implement: 使 16.A1 通过
- [x] 16.A3 Refactor；`npm test` 全部保持绿色
- [x] 16.H1 Write failing test: `browser/back-button.browser.test.ts` → spec Scenario "返回按钮回到上一页并同步地址栏"
- [x] 16.H2 Implement: 使 16.H1 通过
- [x] 16.H3 Refactor；`npm test` 与 `npm run test:browser` 全部保持绿色
- [x] 16.H4 Write failing test: `browser/back-button.browser.test.ts` → spec Scenario "顶层历史穿插时只后退 iframe"
- [x] 16.H5 Implement: 使 16.H4 通过
- [x] 16.H6 Refactor；`npm test` 与 `npm run test:browser` 全部保持绿色
- [x] 16.H7 Write failing test: `browser/back-button.browser.test.ts` → spec Scenario "没有上一页时返回按钮禁用"
- [x] 16.H8 Implement: 使 16.H7 通过
- [x] 16.H9 Refactor；`npm test` 与 `npm run test:browser` 全部保持绿色
- [x] 16.H10 Write failing test: `browser/back-button.browser.test.ts` → spec Scenario "返回目标被重定向时不循环"
- [x] 16.H11 Implement: 使 16.H10 通过
- [x] 16.H12 Refactor；`npm test` 与 `npm run test:browser` 全部保持绿色
- [x] 16.H13 Write failing test: `browser/back-button.browser.test.ts` → spec Scenario "提交新地址后访问栈重置"
- [x] 16.H14 Implement: 使 16.H13 通过
- [x] 16.H15 Refactor；`npm test` 与 `npm run test:browser` 全部保持绿色
- [x] 16.14 按 frontend-design 设计稿重做 tab 的视觉：只改样式与布局，不改行为；用 DSH 主题变量，亮色和暗色都要截图自查；全部既有测试保持绿色
- [ ] 16.15 隔离 dsh build 后，从主 checkout 部署（dsh build 连续两次，第二次无变化），经用户批准后重启

## 17. 首页列出 Host 上的网页服务（2026-11-24）

- [x] 17.0 spec 修订通过定向复核（APPROVE）后才开始实施
- [x] 17.1 Write failing test: `host-services.test.ts` → spec Scenario "列出正在运行的网页服务"
- [x] 17.2 Implement: 使 17.1 通过
- [x] 17.3 Refactor；全部测试保持绿色
- [x] 17.4 Write failing test: `host-services.test.ts` → spec Scenario "服务端点拒绝未认证与跨站请求"
- [x] 17.5 Implement: 使 17.4 通过
- [x] 17.6 Refactor；全部测试保持绿色
- [x] 17.7 Write failing test: `host-services.test.ts` → spec Scenario "无响应的端口不拖慢列表"
- [x] 17.8 Implement: 使 17.7 通过
- [x] 17.9 Refactor；全部测试保持绿色
- [x] 17.10 Write failing test: `browser/home.browser.test.ts` → spec Scenario "Home 按钮回到服务列表并可点选"
- [x] 17.11 Implement: 使 17.10 通过
- [x] 17.12 Refactor；全部测试保持绿色
- [x] 17.13 Write failing test: `browser/home.browser.test.ts` → spec Scenario "没有发现服务时显示示例"
- [x] 17.14 Implement: 使 17.13 通过
- [x] 17.15 Refactor；全部测试保持绿色
- [ ] 17.16 合入、推送、部署（dsh build 两次）

## 18. 工具栏刷新按钮（2026-11-24）

- [x] 18.0 spec 修订通过定向复核
- [x] 18.1 Write failing test: `browser/refresh-button.browser.test.ts` → spec Scenario "刷新重新加载当前页面且栈深度不变"
- [x] 18.2 Implement: 使 18.1 通过
- [x] 18.3 Refactor；全部测试保持绿色
- [x] 18.4 Write failing test: `browser/refresh-button.browser.test.ts` → spec Scenario "首页时刷新按钮禁用"
- [x] 18.5 Implement: 使 18.4 通过
- [x] 18.6 Refactor；全部测试保持绿色

## 15. 集成、部署与验收

- [x] 15.1 在 `dsh.yaml` 新增 local 条目 `sidebar-local-service-browser`（位于 better-sidebar 之后）；note 写明以下内容：用途；同源信任面（D9）；代理 cookie 会被发往同一回环主机的其它本机服务（D4 残余风险）；已知例外；Chromium 要求；回滚方式（`enabled:false` → `dsh build` → 重启）
- [x] 15.2 补全 README：使用方法；支持矩阵与 Non-Goals；已知例外；如何手动注销残留 SW；跨文档后退会先向 DSH 同名路径发一次 GET
- [x] 15.3 在 package 内运行 `npm run build`、`npm run typecheck`、`npm test`、`npm run test:browser`；在仓库根运行 `npm test`、`npm run check:artifacts`；全部通过，且没有新增 skip（2026-11-24 lead 实测：typecheck 0；包 npm test 14 个文件、132 个测试通过；npm run test:browser 14 个文件、47 个测试通过；lib 中占位串计数为 0；仓库根 npm test 共 814 项，811 通过、0 失败、3 项 skip，均为原有 skip，运行时临时对新包执行 git add -N，跑完已复原；check:artifacts 通过）
- [x] 15.4 在 worktree 中隔离执行 `dsh build` 两次，第二次应显示无变化（构建时 `XDG_DATA_HOME` 指向隔离目录，避免改动用户级 anvil schema）。实测（launcher 在 worktree 中自动隔离 DSH_HOME 与 XDG_DATA_HOME）：第 1 次 build 应用 81 处变更；第 2 次应用 1 处变更，即 `materialize independent resources for dsh-memex: 5 files`，属于 dsh-memex 首次安装后的补物化，与本 change 无关，本包在这次报告 up-to-date；第 3 次输出 `no changes — deployment already matches manifest`。严格按“第二次无变化”的字面要求，这一项没有满足，已如实记录
- [ ] 15.5 预览验收（`ws prepare-preview` → `dsh`，以 `DSH_PREVIEW` 输出的地址为准），分本机直连与经 Cockpit 跨机两种场景，样本为 Vite + React Router 应用。逐项记录结果：页面能显示、HMR、登录 cookie、`location.assign`、表单 POST、跨端口 API、tab 内后退与前进，以及渲染后的 DSH index 中守卫是否为第一个可执行脚本。结果写入 change 内的 `acceptance.md`，没跑过的项如实标注
- [ ] 15.6 对照 test-plan 把每一行翻为 🟢；按 Anvil verify 指令生成 `verify.md`，确认评审未过期，并如实列出尚未覆盖的项
- [ ] 15.7 合入、生产部署、重启 Host、归档 change：每一步都需用户另行批准，本 change 的实施不包含这些步骤
