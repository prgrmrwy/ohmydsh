## Review Metadata

- **Review round**: 2
- **Prior round**: round 1 REVISE — C1 上游 SW 宽作用域持久控制、C2 location.assign/replace 与子 iframe 导航不可兑现，及 M1–M7
- **Reviewer context**: cross-model codex/gpt-6-astra fresh-context subagent
- **Tool restrictions**: read-only（唯一写入为本 review.md）
- **Artifacts reviewed**: [proposal.md](proposal.md)、[design.md](design.md)、[spec.md](specs/sidebar-local-service-browser/spec.md)、[review-round1.md](review-round1.md)、[安装摘录](evidence/dsh-install-excerpts.md)；另查 manifest 的 sidebar/Cockpit 条目、当前 sidebar-session-resources spec、better-sidebar 类型镜像、Pet HTTP 认证调用。未发现 openspec/project.md。
- **核验方式**: 首先运行并完整读取 `openspec instructions review --change sidebar-local-service-browser --json`。安装目录直接 read 被 managed-root guard 拒绝，没有绕过；宿主事实均为**摘录核验**，不是亲读安装包。只做静态评审，没有运行浏览器、安装、构建或修改性测试。浏览器文档 web_fetch 因 provider 配置错误未取得内容，不冒充外部验证。shell 命令均返回结果且未报告失败；工具显示未包含独立 exit-code marker。
- **用户决定**: 接受继续采用 Host 同源前缀代理及处理 location；不将切换 Cockpit bridge 作为本轮必改项。该决定不等于用户接受丢失 POST、错误端口或访问浏览器本机。
- **内容快照 SHA-256**:
  - proposal: `a15f4587d505923386070365e3cb2c633f5fb971f20950c15e76d9fe8d5adb91`
  - design: `12a4a14618c96b43ea29f2a287ea2160e77be5b8e7501eb3967ecf0f7927db5f`
  - spec: `bf9f830856ce76437602a0ba9a9c8ebeba20ae3d58f00c829e4ece1e76f5ef01`

本判决只适用于以上快照。任何后续规划内容变化均不能沿用本轮批准（本轮也没有批准）。范围按单用户开发工作台评估，不假设公网多租户，但仍检查其它回环网页和未成功注入的普通开发页面。

## Findings

### 第 1 轮 Critical / Moderate 逐项裁决（先于新发现）

| 第 1 轮 | 裁决 | 当前证据与理由 |
|---|---|---|
| C1 上游宽 scope SW | **resolved** | [design:67–70](design.md#L67-L70)、[spec:149–166](specs/sidebar-local-service-browser/spec.md#L149-L166) 对代理脚本的 `Service-Worker: script` 请求做 Host 403、删除扩大 scope 头并清理旧注册，已封堵原报告的代理脚本安装反例。这里只接受该具体反例的修复，不把同源脚本限制描述为通用沙箱。 |
| C2 导航/子 iframe | **partially** | [design:23–27](design.md#L23-L27) 明确排除子 iframe；[60–62](design.md#L60-L62) 改为 Navigation API，避免覆盖不可配置 Location。但 POST、跨文档 history、无用户激活的外跳仍未兑现，见 R2-C2、R2-M1；不是 resolved。 |
| M1 认证/CSRF | **partially** | [design:39–42](design.md#L39-L42)、[spec:29–58](specs/sidebar-local-service-browser/spec.md#L29-L58) 补 same-site 拒绝与精确 Origin；摘录支持该缺口及修复方向。真实 Cockpit 嵌套发出的 Fetch Metadata、失效会话/null Origin/Host 矩阵仍未形成浏览器支持契约，见 R2-M5。 |
| M2 WS/cookie Path | **partially** | [design:80–83](design.md#L80-L83)、[spec:239–260](specs/sidebar-local-service-browser/spec.md#L239-L260) 修复根 Path cookie 对入口不可见，并补握手要求。但仅 WS 的第二端口不会触发动态路由注册，且窄 Path cookie 仍不随合成入口发送，见 R2-M3。 |
| M3 HTTP 传输 | **partially** | [design:52–56](design.md#L52-L56)、[spec:125–147](specs/sidebar-local-service-browser/spec.md#L125-L147) 已补压缩、长度、流、HEAD、取消，不再有大 HTML 放行降级。注入的“最先执行”与缓存后的再注入仍有反例，见 R2-C1、R2-M4。 |
| M4 cookie/凭据 | **partially** | [design:47–50](design.md#L47-L50)、[spec:83–105,225–237](specs/sidebar-local-service-browser/spec.md#L83-L105) 不再谎称安全隔离，定义 JS 包装及 Proxy-Authorization。但 URL 改写使 cookie getter 根本读不到目标 cookie，Authorization/Origin 与默认 Path 仍不完整，见 R2-C3、R2-M2。 |
| M5 fail-closed/可行性 | **partially** | [design:66–74,93](design.md#L66-L74)、[spec:168–189,262–278](specs/sidebar-local-service-browser/spec.md#L168-L189) 加 IDB 与 active 检查是进步；active 不等于本 iframe 受控，load 后检查无法阻止之前的请求。真实嵌套拓扑仍无结果，见 R2-C1、R2-M5。 |
| M6 URL/外跳 | **partially** | [spec:3–27,107–118](specs/sidebar-local-service-browser/spec.md#L3-L27) 修复显式 80、IPv6、protocol-relative Location、外部 302。但重新导航丢失 history/提交语义，程序外跳依赖 popup，见 R2-C2、R2-M1。 |
| M7 端口/生命周期 | **partially** | [spec:60–81,280–296](specs/sidebar-local-service-browser/spec.md#L60-L81) 已修未知 port、非 3080、自身端口与 Host dispose 连接关闭。浏览器仍活跃的 iframe/SW 在卸载后的行为未闭合；[design:103](design.md#L103) 所称必返 404 与已核验 SPA fallback 不符，见 R2-M6。 |

原 S1：接受用户选择，不要求换路线；但仍须限定可兑现的支持集。原 S2：D11 已吸收异步 inject/CJS 装配，真实产物验收尚待后续，不能记成已通过。

### 🔴 Critical (blocking)

**R2-C1 — “加载完成后清空”不是失败闭合；在此前已经可能访问浏览器本机。**

- 依据：[design:54–62,73–74](design.md#L54-L74)、[spec:125–142,262–273](specs/sidebar-local-service-browser/spec.md#L262-L273)。设计把 `<head>` 后第一个注入脚本等同于“任何上游脚本/请求之前”，并仅在 iframe `load` 后检查。
- 具体反例：合法可解析 HTML 在显式 `<head>` 前包含 `<script>fetch('http://localhost:8000/x')</script>`；浏览器会隐式建立 head 并执行该脚本，字节扫描却在后面的 `<head>` 后插入。另一个反例是上游响应 CSP 禁止 inject.js、但允许某个上游脚本；该脚本仍可先运行并导航到浏览器的回环地址。即便初始文档受 SW 控制，跨文档本机导航不受子请求改写保证；最后的 load/清空已来不及。非 200 HTML（例如有脚本的 404 页面）也按现 spec 不注入却仍加载。
- active worker 不等于当前 client 已被该 worker 控制；仅验证 API 存在无法在首次安装、controller 变更或注入失败时建立“不漏出”不变量。
- 必须先决定：对不能保证启动屏障的文档，在任何上游可执行内容进入 iframe 前拒绝，或明确撤回“失败时绝不访问浏览器回环”的绝对承诺并让用户接受。若坚持承诺，需要有可执行的 boot/controller/端口绑定握手及安全 HTML 交付策略，不是再加一个 load 检查。验收必须用浏览器本机监听器断言**连接数始终为 0**，覆盖 pre-head 脚本、CSP、404 HTML、SW 首次安装和失控。

**R2-C2 — 抹去 URL 中的端口后，跨文档历史无法可靠还原，可能把请求发到错误服务。**

- 依据：[design:60–62,68,74](design.md#L60-L74)、[spec:196–223,275–278](specs/sidebar-local-service-browser/spec.md#L196-L223)。只有 client→端口和一个原生 sessionStorage 保留键；没有每条历史 entry 的目标身份。
- 反例：从 5173 `/a` 整页跳到 4000 `/b`，两条 entry 都被改成 DSH 同源无前缀路径。旧文档不在 BFCache 时，iframe 跨文档后退可能不可取消并先请求 DSH `/a`；D8 用“所在端口”4000 修复则得到 4000 `/a`，不是 5173 `/a`。单个 sessionStorage 键不保存历史，已销毁 client 的 IDB 记录也没有从新导航反查旧 entry 的约定。
- 若无前缀路径恰好是 DSH 的真实 API、静态资源或下载而非 SPA fallback，先发生错误请求，甚至没有可检查的 HTML load；这不是仅“短暂闪屏”。复制/书签该文档 URL 到新框架或新标签时，端口信息更已永久丢失，父 tab 的 load 修复不存在。
- 必须定义每条 history entry 的 `{族,端口,rest}` 身份、跨文档 traverse 的处理与不可取消分支、框架重新加载/恢复的支持边界；不能用当前端口推断过去。至少断言跨端口 a→b→back→forward 的上游命中日志、无 BFCache、DSH API 同名路径、框架 reload，以及书签/独立打开的明确拒绝或恢复行为。若这些在同源无前缀 URL 下无法保证，人类需收窄 location/history 保证，而非悄悄采用 `/` scope SW。

**R2-C3 — replaceState 后 cookie Path 已不匹配；覆盖 getter 去前缀无法恢复 JS cookie。**

- 依据：[design:48–49,60](design.md#L48-L60)、[spec:84,225–232](specs/sidebar-local-service-browser/spec.md#L225-L232)。cookie 存在 `/dsh-local-service/p/5173/`，文档 URL 已改成 `/dashboard`。
- 原生 `document.cookie` getter 先由浏览器按当前文档 URL 的 Path 过滤。包装层拿到的字符串不含 `dshls.p.5173.csrftoken`，再过滤/去前缀也不能得到 `csrftoken=t1`。这直接反驳 spec 的已设置 CSRF cookie 用例。setter 可写较宽/其它路径 cookie，并不使 getter 能读到它。可配置的 Document.prototype 访问器只证明能安装包装，不证明包装语义成立。
- 必须选定能与无前缀 URL 共存的 cookie 视图方案（并写清 HttpOnly、Path/default Path、删除、服务端 Set-Cookie 更新语义及泄露面），或经用户确认排除 JS cookie/CSRF 应用。不可仅增加 wrapper 单测。浏览器验收需由 HTTP Set-Cookie 起步、replaceState 后读取，再经历导航和删除；不得直接向 getter mock 塞 cookie。

### 🟡 Moderate

**R2-M1 — Navigation API 的重发不等于保留导航语义。**

- [design:61](design.md#L61)、[spec:197,215–218](specs/sidebar-local-service-browser/spec.md#L197-L218)：取消 `POST /login` 后调用 `navigation.navigate(proxy)` 会发普通导航，不携带原 form 的 method/body/enctype/files；API 的 URL 导航不等同于重放表单。reload 也不是 push/replace 二选一，不能无说明退化为新增 entry。检查 `window.navigation` 存在不能证明某个事件 cancelable；iframe 的跨文档 traverse 尤其不能靠 preventDefault。
- `location.href='https://example.com/'` 在计时器或初始脚本中执行没有 transient user activation，`window.open` 可被 popup blocker 拒绝；spec 的必新开窗口不可机械保证。
- 修订为逐类导航矩阵：cancelable 与 canIntercept 分开（不能拦截不等于不能取消），明确 POST 原始体/文件如何送达；不可取消分支不得当成功；外跳无激活时使用用户点击的提示链接。加入 POST 上游 method/body 字节断言、reload entry 计数及无激活外跳用例。

**R2-M2 — 凭据转发仍不符合新文档 URL，且 Authorization 未裁决。**

- [spec:84](specs/sidebar-local-service-browser/spec.md#L84) 要求 Origin/Referer 含同端口代理路径才能还原。但 Origin 从来不含路径；replaceState 后 Referer 也为无前缀 `/dashboard`。按字面实现会删除它们，常见检验 Origin/Referer 的登录 POST/CSRF 服务拒绝合法请求。WS 却直接合成上游 Origin，HTTP/WS 策略不一致。
- 同一行把无 Path 的 Set-Cookie 默认为 `/`，而原生默认路径应由上游请求目录推导；`/account/login` 设置的 cookie 被扩大到所有上游路径。Authorization 的转发与跨端口 302 规则仍缺失：两个后端在浏览器侧已变成同源，不能指望浏览器按原上游的跨源重定向规则自动剥离。
- 明确 HTTP 来源映射的可信输入，禁止靠无前缀 Referer 猜端口；定义 Authorization 在跨目标 redirect/fetch 的保留或清除策略，以及 cookie 默认路径/删除/Secure 前缀规则。加两个不同端口的授权标记不得串流的测试。

**R2-M3 — 动态升级路由依赖先 HTTP，遗漏“只有 WS 的另一端口”，且固定入口不能携带所有 Path cookie。**

- [design:81–82](design.md#L81-L82)、[spec:240–245](specs/sidebar-local-service-browser/spec.md#L240-L245)：5173 页面直接连接 `ws://localhost:8000/echo`，从未 HTTP 访问8000，因此对应精确路由不存在，宿主会 destroy socket（[摘录:138–150](evidence/dsh-install-excerpts.md#L138-L150)）。当前 echo 场景只覆盖已经 HTTP 加载的端口。
- 上游 `sid; Path=/echo` 被存到代理 `/.../5173/echo`，不会随 `/.../5173/.dshls-ws` 发送；改变入口只解决了 Path=/ 的 cookie，不是一般带登录态 WS。
- 要么提供经认证的、在握手前完成的目标注册机制与清晰的上限失败，要么明确排除未加载端口；并决定窄 Path WS cookie 的可支持范围。覆盖首次直连第二端口 WS、并发注册同端口、256 上限与窄 Path sid。禁止把 HttpOnly cookie 搬进 query。

**R2-M4 — 注入位置/nonce 与 validator 规则仍不足以确定返回什么。**

- [design:54–56,86](design.md#L54-L56)、[spec:126–137](specs/sidebar-local-service-browser/spec.md#L126-L137)：字节搜索 `<head` 可匹配注释/脚本文本/`<header>`，不等同于 HTML tokenizer；多 CSP policy 或 `script-src-elem` 与 `script-src` 的不同 nonce 不能靠“取同一个 nonce”解决。可以拒绝不支持的 CSP，但必须在执行上游内容前拒绝，不能靠 load 后提示（R2-C1）。
- 注入后仅强 ETag 改弱，未定义浏览器旧缓存的 inject.js/HTML 与新插件版本如何绑定；上游 304 不经过正文变换，复用旧 HTML 的行为未验证。至少应选明确的缓存策略或版本化注入，并覆盖条件请求与插件升级，不声称改弱就解决 validator。
- 最小修订：限定可安全识别的 HTML/CSP 支持集及拒绝路径、验证 nonce 对所有生效策略可用，定义变换后缓存身份。无需为此直接引入全浏览器虚拟化库。

**R2-M5 — SW 持久化是正确方向，但 Chromium + active 不是 Cockpit 支持矩阵。**

- [design:40,67–74,93,100](design.md#L39-L40)、[spec:169,263](specs/sidebar-local-service-browser/spec.md#L168-L169)：replaceState 本身不会使当前已受控 Document 立刻丢失 controller；同文档相对 URL 会以新 URL 解析。这两个基本选择不是本轮缺陷。问题在新文档/controller 变更、IDB 写入完成时序及失败没有明确握手：postMessage 不等于记录已持久化，未知 client 的 502 可误伤先执行的模块/资源。
- D2 的 gate 能阻止普通其它回环端口页面的 same-site 请求，且 URL 改 pathname 不会把 origin 改掉；不应为解决兼容性放开 same-site。但实际 nested iframe 的请求还受 ancestor 安全上下文、cookie/存储策略、初次导航与重定向链影响，`none` 也不是“有该头便可信”，仍必须保留官方 gate。当前只有手工合成 header 场景，没有真实拓扑的浏览器观测；不判定 gate 已被绕过，也不判定所有合法流量一定 same-origin。
- 在批准功能实现前，先提交只读结果或经人类授权单独进行最小可行性探针，记录 Chromium 版本、Cockpit/DSH scheme-host-port、祖先 sandbox、实际 Fetch Metadata/cookie/controller。明确 IDB 事务完成、ACK、失败/超时、worker 重启恢复与旧 client 清理。Storage 包装要覆盖 property 访问/删除/枚举和保留键隔离，而非只测方法调用；可重定义全局属性不代表可完整模拟 Storage。

**R2-M6 — 卸载后“残留 SW 请求必为404”与宿主 fallback 冲突。**

- [design:103](design.md#L103) 断言路由消失后返回404；[摘录:154–166](evidence/dsh-install-excerpts.md#L154-L166) 明确未命中走 fallback，Context 自己也承认 SPA fallback。已打开 iframe 仍可能受旧 worker 控制并请求根资源，旧 worker 将其送往已消失代理路由，收到 DSH HTML 而不是明确失败。
- [spec:280–296](specs/sidebar-local-service-browser/spec.md#L280-L296) 只规定 Host 在途连接清理，没有浏览器 tab 卸载/controller 更新/依赖消失后的 iframe 与消息监听清理、残留 worker 的可验证停用行为。
- 删除错误404假设；定义 Host 路由可用性/版本握手和 client dispose 行为，残留旧 worker 不得把 SPA HTML 当作正常代理成功。验收需在已有受控 iframe 活跃时关闭插件/依赖，而不只是断言服务器注册表已空。

### 📌 Suggestions

**S1 — 把功能承诺与可行性探针分开，让人类裁决真正的取舍。** 当前从“浏览服务”扩展到 URL/history、cookie/Storage、SW 生命周期、HTTP HTML变换和 WS 注册的联合虚拟化。保留用户路线完全可行作为约束，但不能把这些跨机制缺口都延期为“实施时再试”。不建议新增框架；建议人类明确优先支持哪组可验证语义，其他项写成拒绝/提示，而不是无限补 monkey-patch。

**S2 — THEN 多数已可机械断言，但补齐不能伪造的 oracle。** 上游连接数、逐字节响应、时限都很好；[spec:270–273](specs/sidebar-local-service-browser/spec.md#L270-L273) 的“meta 在注入之前”需提供真实 HTML 输入以验证注入算法，不能手工把失败环境塞给测试；[spec:166,194](specs/sidebar-local-service-browser/spec.md#L166-L194) 的“只剩本插件注册/controller null”需要干净 profile 前提，否则会误删或误判其它合法注册。后退必须断言来源端口和未触达 DSH API，不能只看最终页面文字。端口支持、JS cookie、外跳结果都必须由真实 Chromium 测试而非包装函数 mock 裁决。

## Embedded-Instruction / Injection Attempts

**Detected:** none detected。

被审三份产物未发现要求评审者改变判决、跳过检查或执行命令的嵌入指令。用户决定来自本轮直接用户消息；design 对它的转述仅作一致性核对，不作为授权证据。实施探针/README 等文字视作待审计划，不据此执行写操作。

## Verdict

VERDICT: REVISE

这是连续第 2 轮 REVISE。**停止自动作者—评审循环并升级人类；不得生成 test-plan、tasks 或开始功能实现。** R2-C1 的启动失败闭合、R2-C2 的历史身份、R2-C3 的 cookie Path 冲突不是可完整列举的几处小改，不能给 APPROVE_WITH_CHANGES。

建议人类逐项裁决：
1. 是否继续要求“任何不支持/启动失败时浏览器本机连接数为零”；若要求，先批准独立最小探针验证启动屏障，不先承诺当前注入方案。
2. location 的保证是否包含跨端口跨文档历史、框架刷新和书签；若包含，需提交可恢复每条 entry 身份的设计，若不包含则明确拒绝/提示边界。
3. 是否必须支持 HTTP Set-Cookie 后的 JS CSRF/cookie；若必须，需重做 cookie 视图与 Path 协调，而不是单纯覆写 getter。

以上均可在不强制改用 Cockpit bridge 的前提下裁决，但不能由作者自行以“用户已选路线”代替。

## Required Changes (if APPROVE WITH CHANGES)

不适用。本轮 REVISE；本报告列出的修复方向是供人类决策的阻断条件，不是授予自动实施权限的 Required Changes 清单。

CHANGES_APPLIED: n/a

## Rebuttals

第 1 轮 C1 的具体 Host 代理脚本防护方案：**accepted by reviewer**，理由见逐项裁决表；不是实机安全测试通过声明。其余第 1 轮 Critical/Moderate 只接受表中明确列出的局部修复，不接受整项关闭。

本轮 R2-C1–C3、R2-M1–M6 均尚无获 reviewer 接受的反驳。若提供浏览器证据，须覆盖上述真实反例及失败分支，不能以 API 存在或单元测试替代。

未检查：真实 Cockpit 嵌套浏览器执行、安装包直接内容、实际实现产物（本 change 尚属规划）。依用户唯一写入约束，本轮未写 Memex 或任何其它文件。
