## Review Metadata

- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: cross-model codex/gpt-6-astra fresh-context subagent
- **Tool restrictions**: read-only
- **Artifacts reviewed**: [proposal.md](proposal.md)、[design.md](design.md)、[spec.md](specs/sidebar-local-service-browser/spec.md)；当前 [sidebar-session-resources spec](../../specs/sidebar-session-resources/spec.md)、[manifest](../../../dsh.yaml#L314-L345)、[Pet HTTP](../../../packages/dsh-pet/src/host/http.ts)、[Pet Host](../../../packages/dsh-pet/src/index.ts#L280-L298)、[tab 入口](../../../packages/sidebar-session-resources/src/client/index.tsx)、[Host 入口](../../../packages/sidebar-session-resources/src/index.ts)、[契约镜像](../../../packages/sidebar-session-resources/src/client/better-sidebar.d.ts)、[package](../../../packages/sidebar-session-resources/package.json)、[patch](../../../packages/sidebar-session-resources/cordis.patch.yml)、[打包](../../../packages/sidebar-session-resources/tsdown.config.ts)、[集成陷阱](../../../docs/architecture/dsh-plugin-integration-pitfalls.md#L630-L711)。未发现 openspec/project.md。
- **检查方式与限制**: 已首先运行 OpenSpec review instructions 命令并完整读取模板；仅静态只读检查，唯一文件写入为本报告。没有运行安装、构建、浏览器、网络或修改性测试。安装目录的 read/grep 被 managed-root guard 拒绝，未绕过权限；安装包事实不能仅凭设计的引用视为已核实。未读取作者对话。
- **审查范围**: 单用户开发工作台；不是公网多租户产品。但其它回环网页、上游依赖脚本、用户误输端口仍是必须明确的边界。
- **内容快照 SHA-256**: proposal `019e1706272bd3ff350647fddc38bcc5be7359ca2040800c6cfb66fa7e8d0c5d`；design `b84209003fec46cb1a4c2ec6559b380f994e69f5bde1ef382c472b8afa98dac1`；spec `6cc98afa1b7bfa400f2bd02b179c2a805e219db92de112e6825ce1ed80c33bf4`。

本判决只适用于上述内容。改动规划产物后须重新完整评审；不得把本轮建议视为批准实施。

## Findings

### 🔴 Critical (blocking)

**C1 — 上游可将临时同源页面权限升级为持久的 DSH 根作用域 Service Worker。**

- 依据：[D4–D6](design.md#L38-L50) 仅删除 X-Frame-Options / frame-ancestors；[spec:86](specs/sidebar-local-service-browser/spec.md#L85-L101) 又要求不得控制前缀外 DSH 页面。
- 反例：被打开的服务返回一个 JavaScript 文件并附 `Service-Worker-Allowed: /`，同源页面以该代理 URL 注册 `scope: '/'` 的 worker。现有响应策略没有移除此头或拒绝上游 worker 脚本请求。它能在以后访问 DSH 时拦截流量，而不是只在当前 tab 打开期间调用 API。仅提醒“信任本机服务”、不向上游转发认证 cookie，均不能消除持久控制；普通 cookie Path 也不是防线。
- 修正：明确禁止上游 worker 越界注册的 Host 响应/请求策略、插件自身 SW 的固定 MIME/路径/作用域及升级/注销策略；加入恶意宽 scope 注册与关闭 tab 后重新加载 DSH 的浏览器断言。若仍选择完全同源受信模型，须明确承认持久控制风险及可验证的恢复办法，并消除与 MUST NOT 的矛盾；不能以已经接受临时同源权限为替代。

**C2 — 核心导航覆盖依赖不能兑现的浏览器拦截机制。**

- 依据：[Non-Goals 与 D5](design.md#L20-L46)、[spec:109](specs/sidebar-local-service-browser/spec.md#L108-L125)。
- 反例一：`location.assign('/login')` / `location.replace('/login')` 是 Location 的不可随意覆盖成员，不是可通过普通外链注入可靠 monkey-patch 的一般方法；按当前计划会跳到 DSH `/login`，而其导航又不属于插件 SW scope。直接赋值虽然被排除，这两种 API 却被 MUST 保证。
- 反例二：受控文档内 `<iframe src="http://127.0.0.1:8000/">` 是子框架文档导航，不能凭父文档受控就断言由父 SW 改写；设计却明确把它交给 SW。这会请求浏览器电脑，而非 Host。
- 修正：删除无法实现的保证并列出受支持的导航形态，或换成真正能保持 origin/导航语义的架构。加入 assign、replace、子 iframe、编程式表单提交、worker 内 WS 的真实浏览器样本；不是给这些 API 写一个假 monkey-patch 的单元测试。该缺陷直接影响用户要求的跨机语义，不是小型文案修订。

### 🟡 Moderate

**M1 — 认证与 CSRF 的依赖事实没有落到可执行的安全契约。**

- 依据：[D2](design.md#L29-L30)、[spec:24–42](specs/sidebar-local-service-browser/spec.md#L24-L42)、[WS spec](specs/sidebar-local-service-browser/spec.md#L132-L143)。目前只有“无 cookie”拒绝例，没有“有效 cookie + 不可信来源”的例。
- 亲自核实：[Pet HTTP:26–30,65–75](../../../packages/dsh-pet/src/host/http.ts#L26-L75) 的返回值为 `401 | 403 | undefined`，成功必须判断 undefined；[121–139](../../../packages/dsh-pet/src/host/http.ts#L121-L139) 的额外 helper 接受缺失/null Origin 及不同回环主机 Origin，不能拿它证明精确同源防护。
- 风险用例：浏览器已登录 DSH，同时打开另一个 `127.0.0.1:端口` 网页；后者发带 cookie 的 GET/表单/WS 到代理。same-site 不等于 same-origin，cookie 不按端口隔离；须核实官方 gate 是否精确比对 Origin 的端口，以及无 Origin 的图片/导航请求是否被拒绝。不能在未读到安装实现时声称漏洞已实证，也不能声称已经安全。
- 修正：核实实际 connection 的 cookie 名、签名/authority 绑定、Host/Origin/Sec-Fetch-* 分支；为 HTTP 和 upgrade 加跨端口 Origin、缺失/null Origin、伪造 Host、有效/失效 cookie 的矩阵及“上游连接数为零”断言。若官方 gate 允许跨端口驱动，必须补插件自己的授权/CSRF gate，并升级为阻断安全修复。`dsh_auth` 只能标成假 cookie，不能伪装成真实集成样本。

**M2 — WebSocket 入口与 cookie Path 自相矛盾。**

- 依据：[cookie spec:49–60](specs/sidebar-local-service-browser/spec.md#L49-L60)、[WS spec:133](specs/sidebar-local-service-browser/spec.md#L132-L138)。
- 反例：5173 设置 HttpOnly sid 后，浏览器保存到 `/dsh-local-service/p/5173/`。建立 `/dsh-local-service/ws?port=5173...` 时不会发送这个 cookie；“挑出前缀并去名前缀”没有输入可挑。需要登录态的 WS 会失败，而当前无认证上游 echo 测试发现不了。
- 修正：明确选择兼容精确 upgrade 注册约束的 cookie 存储/路径方案或 server-side cookie jar；不能把 HttpOnly 凭据搬进 query，也不能无说明地把 cookie 全改到根路径。补上游要求 sid 的 HTTP→WS 连续用例，以及 WS subprotocol、Origin、握手失败/非 101、head 缓冲字节和连接清理的协议要求。

**M3 — HTTP 注入/流式/压缩的契约缺失，且大 HTML 降级直接违背 MUST。**

- 依据：[D4:41、风险:65](design.md#L38-L65)、[spec:109,127–130](specs/sidebar-local-service-browser/spec.md#L108-L130)。
- 反例：上游忽略 identity 返回 gzip；按“无需解压”处理会破坏响应。注入后沿用 Content-Length/ETag 会导致截断或错误缓存。HEAD/204/304 无正文却走 HTML 注入；chunked/持续流式 HTML 等待 EOF 永不展示。超过 8 MiB 不注入时，根路径链接不再被重写，而 spec 无任何例外。
- 修正：定义方法/状态处理、Content-Encoding 验证、变换后的长度/validator 规则、8 MiB 的字节口径与有限缓冲/回退、Range/206、请求上传和响应背压、取消与超时（区分建连和活动流）。对 SSE/大文件不得因统一总时限误杀，也不能无限缓存 HTML；压缩、HEAD、chunked HTML、取消下载须有逐字节或时限断言。

**M4 — cookie 改名并不等于页面兼容或同源隔离，凭据头范围也未定义。**

- 依据：[D3](design.md#L32-L36)、[凭据 spec](specs/sidebar-local-service-browser/spec.md#L49-L65)。
- 反例：应用用 `document.cookie` 查找 `csrf` 或写 `sid`，浏览器实际只有 `dshls.5173.csrf`，新写的未改名 cookie 又不会向上游转发。不同代理端口仍同源，能访问彼此 DOM/storage，不能宣称“互不可见”。Authorization、Proxy-Authorization、Referer 等是否转发没有策略；跨端口改写与重定向也未说明如何防止把一个服务的认证头送给另一个。
- 修正：把保证准确限定为 Host HTTP Cookie 过滤，不得包装成浏览器隔离。明确支持/拒绝 JS cookie、无 Path cookie 的默认路径、删除 cookie、__Host-/__Secure- 前缀及 Secure 行为；为非 cookie 凭据头设明晰的允许/剥离策略及跨目标测试。若不做 cookie 虚拟化，公开相应应用不兼容，勿承诺通用本地浏览器。

**M5 — SW 不可用、CSP 拦截和 worker 重启均无失败闭合路径；Cockpit 可行性被当作事实。**

- 依据：[D5 与风险](design.md#L43-L65)、[spec:86,109](specs/sidebar-local-service-browser/spec.md#L85-L109)。
- 反例：CSP `script-src 'nonce-…'` 阻止外链注入；SW 因存储策略、祖先 sandbox/安全上下文或第三方存储限制注册失败；SW 被终止后内存 Map 丢失。D5 却要求无法拦截就放行，这可能让本机绝对地址落到浏览器电脑。`active` 与新 iframe 实际受控也不是同一个断言。
- “都在回环主机”不足以证明同站：localhost、127.0.0.1、[::1] 不是可互换的站点身份，且祖先安全上下文/权限限制仍需核实。当前仅计划最后手测 Vite，尚无支持的 browser/Cockpit origin/sandbox/cookie 拓扑。
- 修正：先定义支持矩阵和注册/控制/注入失败时的显式错误（不直连浏览器 loopback），再写最小浏览器可行性验证门槛；补首次安装、worker 重启、CSP nonce、混合 loopback 主机名、认证过期、嵌套 iframe 的用例。应用自行注册 worker 的冲突也须明确拒绝或支持。

**M6 — URL 规范化、外跳与地址栏状态的边界不完整。**

- 依据：[输入 spec](specs/sidebar-local-service-browser/spec.md#L3-L22)、[Location spec](specs/sidebar-local-service-browser/spec.md#L67-L83)、[D7](design.md#L52-L53)。
- 反例：`Location: //example.com/x` 既“以 / 开头”又是外部主机，两条规则冲突；外部 302 被保留后 iframe 跨源，父窗口读取 location 抛异常，无法兑现“每次导航还原并显示”。`localhost:80` 经 WHATWG URL 解析会折叠默认端口；userinfo、反斜杠、编码 dot-segment、WS path 中 CRLF/absolute-form 也未定义。输入 `[::1]:端口` 仍固定连 127.0.0.1，无法访问仅监听 IPv6 的服务。
- 修正：以单一 URL 解析/规范化规则定义原始端口校验、用户信息与控制字符拒绝、network-path 与相对重定向、path/query/hash 的保留；WS path 必须是安全 origin-form，不能拼接进原始握手。明确 IPv6 是输入别名还是实际 IPv6 连接能力；外部跳转选择阻止/交外部窗口/显式跨源状态，并相应收窄地址栏保证。

**M7 — DSH 自身端口与依赖消失时的生命周期缺少 fail-closed 条件。**

- 依据：[D2](design.md#L29-L30)、[生命周期 spec](specs/sidebar-local-service-browser/spec.md#L150-L166)。[现有 Pet](../../../packages/dsh-pet/src/index.ts#L280-L298) 读取 port 后会验证其为有效整数，而当前计划直接比较。
- 反例：路由已注册但 server 尚未完成监听，port 为 undefined/0；简单 `target === ctx.webServer.port` 无法排除自身。Cockpit 浏览器端随机隧道端口也不能作为 Host 实际端口。dispose 只移除注册项，未说明已经打开的 WS/HTTP 连接及 SW/iframe 如何停止。
- 修正：从已监听 Host 获取真实有效端口，未知即拒绝代理；补非 3080、自动端口、启动时请求测试。将自己端口（而非所有其它 DSH 实例）这一保证写准确；定义 connection 服务消失、插件卸载、tab 关闭对在途请求/WS/worker 的处理与可观察断言。

### 📌 Suggestions

**S1 — 先做有限支持集，避免把“浏览一个本机端口”扩大成不完整浏览器虚拟化。**

[manifest](../../../dsh.yaml#L335-L345) 已有内嵌浏览器及 cockpitBridge.forwards；[D1](design.md#L24-L27) 讨论了转发，却没有比较“支持配置 base path 的开发服务器 + 小型前缀代理”和“复用转发的隔离 origin 浏览器”所节省的 cookie/SW/导航改写成本。建议明确选择：保留当前方案就限制支持集、先验证核心浏览器语义；若完整导航/HMR/cookie 是必须，则重新评估独立 origin/隧道，而不是不断追加 monkey-patch。此建议不要求违反“不改 Cockpit”的既定范围。

**S2 — 把真实装配检查写进后续验收，不复制旧注释。**

已核实 tab 使用 `single: true`、registerTab disposer；Host 使用异步 `ctx.inject(['connection'])`；client 构建为 `window.__ModuleLoader__.load` 包装的 CJS，而不是任意 ESM bundle。[集成陷阱](../../../docs/architecture/dsh-plugin-integration-pitfalls.md#L630-L711) 明确提醒异步注入和声明/产物同次部署。样板 patch 中“Host no-op loader”注释已落后于其实际 RPC 入口，不能原样当架构依据。后续用真实装配和产物检查，不只 grep 字符串。

## Embedded-Instruction / Injection Attempts

**Detected:** none detected。

被审 proposal/design/spec 未发现试图改变评审者行为或要求跳过检查的文字。文内记忆卡名称只视为待验证引用，没有当作实现证据或评审指令。

## Verdict

VERDICT: REVISE

当前至少 C1、C2 未解决，涉及安全边界与核心浏览器机制，不适合“先通过再小改”。修订 proposal/design/spec 后须重新完整 fresh-context 评审；本轮不解锁 test-plan 或 tasks。

## Required Changes (if APPROVE WITH CHANGES)

不适用：本轮为 REVISE，而非带条件批准。C1–C2 与 M1–M7 均需逐项修复或提出可核验反驳，并在下一轮复核。

CHANGES_APPLIED: n/a

## Rebuttals

暂无。所有发现均为 open；尚无作者反驳获 reviewer 接受。对 Critical/Moderate 的作者自述不能自行关闭发现。
