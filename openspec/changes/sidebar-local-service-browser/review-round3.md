## Review Metadata

- **Review round**: 3
- **Prior round**: round 2 REVISE（R2-C1 启动失败闭合、R2-C2 历史身份、R2-C3 cookie Path，及 R2-M1–M6），经人类裁决后授权第 3 轮
- **Reviewer context**: cross-model codex/gpt-6-astra fresh-context subagent
- **Tool restrictions**: read-only + 可运行探针；本轮只做静态核验，唯一写入为本报告，没有运行探针、安装、构建或生产操作。
- **Artifacts reviewed**: [proposal](proposal.md)、[design](design.md)、[delta spec](specs/sidebar-local-service-browser/spec.md)、[人类裁决](human-decisions.md)、[首轮报告](review-round1.md)、[第二轮报告](review-round2.md)、[探针结果](probes/browser-feasibility.md)、[探针源码](probes/browser-feasibility.mjs)、[安装包摘录](evidence/dsh-install-excerpts.md)；并核对仓库现有 sidebar-session-resources 规范、manifest 版本及集成陷阱文档。未发现 openspec/project.md。
- **证据限制**: 安装包绝对路径访问被 managed-root 拒绝，未绕过；以下宿主行为均为**摘录核验**，不是安装包直接核验。探针结果为作者报告，静态审查发现其中一个 oracle 无效，不能整体视作通过。
- **内容快照 SHA-256**:
  - proposal: `407064507d89e0287f24db71143c77b32e1d943d49e37271ff5430b2b04049c1`
  - design: `d7eeb015bee227407e1f82cb6e190f74cbc3ae932eaa04ba023f4e10151dae5f`
  - spec: `bdbb46d063555cde24a8c46414e161b18bf60c7daf9987c0ec0b71024f6b98f5`

本判决仅适用于以上内容；改动后须重新完整 fresh-context 评审。不重新争论已接受的 Host 同源代理、无前缀 pathname、JS cookie Path=/ 或尽力而为取舍。

## Findings

### 前轮逐项裁决

| 前轮条目 | 本轮裁决与依据 |
|---|---|
| R2-C1 | **部分解决**：人类已撤回绝对零泄漏要求，内联首脚本/非200注入修复了原先的主要缺口；但 `window.stop()` 单独截停的强断言仍未证明，见 R3-M2；[design:103–116](design.md#L103-L116)、[spec:350–373](specs/sidebar-local-service-browser/spec.md#L350-L373)。 |
| R2-C2 | **部分解决，仍阻断**：初始 entry 的身份与无身份拒绝合理，但没有维护 SPA 同文档变化后的身份，见 R3-C1；[spec:236–301](specs/sidebar-local-service-browser/spec.md#L236-L301)。 |
| R2-C3 | **已解决原反例，accepted by reviewer**：Path=/ 使无前缀页面能读到代理 cookie，JS getter/setter 有明确规则；Path 粒度丢失已接受；[design:80–95](design.md#L80-L95)、[spec:303–314](specs/sidebar-local-service-browser/spec.md#L303-L314)。新暴露的跨 authority 泄漏见 R3-M4。 |
| R2-M1 | **主要反例已解决，accepted by reviewer**：原生 form 重提交、reload 用 replace、外跳用户点击提示取代无激活 window.open；[spec:241–273](specs/sidebar-local-service-browser/spec.md#L241-L273)。这不是完整表单兼容性实测通过。 |
| R2-M2 | **主要策略已解决，accepted by reviewer**：Origin/Referer 按目标重建；Authorization 明确保留并披露跨端口重定向；Path=/ 是人类裁决；[design:97–101](design.md#L97-L101)、[spec:83–108](specs/sidebar-local-service-browser/spec.md#L83-L108)。前缀 cookie、删除等边界测试仍建议补齐。 |
| R2-M3 | **已解决，accepted by reviewer**：固定精确 WS 入口加 Path=/，不依赖先 HTTP；已有第二端口 WS 场景；[spec:321–338](specs/sidebar-local-service-browser/spec.md#L321-L338)。 |
| R2-M4 | **部分解决**：首脚本、no-store、删除 validators/条件头有明确规则；unsafe-inline 判断仍有确定反例，见 R3-M1；[spec:136–177](specs/sidebar-local-service-browser/spec.md#L136-L177)。 |
| R2-M5 | **部分解决**：已提供版本/同站嵌套最小探针、内存优先及 IDB 恢复约定；不是实际 Cockpit、重启与失控测试；[design:133–135](design.md#L133-L135)、[探针限制:9](probes/browser-feasibility.md#L9)、R3-M2。 |
| R2-M6 | **原 fallback 反驳接受，accepted by reviewer**：摘录证明非 index 且无同名静态文件时返回404；已明确 client dispose 和连接清理；[摘录:238–274](evidence/dsh-install-excerpts.md#L238-L274)、[spec:375–395](specs/sidebar-local-service-browser/spec.md#L375-L395)。不再要求仅为不存在的通用 SPA fallback 新增握手。 |

首轮部分解决项继续逐项追踪，不能因换编号消失：

- **R1-C2**：部分解决；嵌套 iframe 已排除、assign/replace/POST 有新机制；历史仍见 R3-C1。
- **R1-M1**：主要解决；官方 gate + HTTP Fetch Metadata / WS Origin 分工成立，[design:65–73](design.md#L65-L73)。不把浏览器缺少 WS Fetch Metadata 当漏洞。
- **R1-M2**：已解决，沿用 R2-M3 裁决。
- **R1-M3**：传输规则已解决主要反例；注入兼容性沿用 R2-M4/R3-M1，不声称已执行流式测试。
- **R1-M4**：原 cookie JS/凭据头反例已解决，沿用 R2-C3/M2；新增泄漏面 R3-M4。
- **R1-M5**：部分解决，沿用 R2-C1/M5 与 R3-M2。
- **R1-M6**：输入/IPv6/协议相对重定向/外跳主要反例已解决；历史仍见 R3-C1。
- **R1-M7**：已解决计划缺口，[design:75–78](design.md#L75-L78) 现场校验实际监听端口，[spec:375–395](specs/sidebar-local-service-browser/spec.md#L375-L395) 明确双侧清理。
- R1-C1 的上游 SW script 拒绝继续接受，[spec:179–196](specs/sidebar-local-service-browser/spec.md#L179-L196)；不因同源本身重新打开已裁决的临时信任面。

### 🔴 Critical (blocking)

**R3-C1 — entry 身份只在初始注入写入，SPA 路由改写后仍无法恢复 tab 历史。**

- 依据：[design:117–126](design.md#L117-L126)、[spec:239–247,275–285](specs/sidebar-local-service-browser/spec.md#L239-L285)。只规定初次 replaceState 后 updateCurrentEntry；后面的监听明确仅处理跨文档导航，pushState 场景只验地址栏。
- 具体反例：5173 `/` 加载后，应用执行 `history.replaceState(appState,'','/settings')`，再整页跳到4000 `/page2`，禁用 BFCache 后 back。设计自己已确认 replaceState 会清空 navigation state；这次应用调用后没有重新写入身份，父 tab 只能清空，不能恢复5173 `/settings`。pushState 新条目也没有保存身份的协议；hash/同文档变化还可能保留过期 rest。
- 探针没有覆盖：[源码:81–84](probes/browser-feasibility.mjs#L81-L84) 直接跳过 `sameDocument`；不能用当前整页 back 成功证明 SPA 历史成功。
- 最小充分修正：定义所有支持的同文档 push/replace/hash/traverse 完成后的身份维护和 rest 更新，保留应用 `history.state`，与 Navigation API state 的覆盖关系明确；未知身份仍拒绝，禁止以当前端口猜测。补 `SPA replace/push → 跨端口整页 → back → forward`、无 BFCache、hash/query 和应用 state 不受损的浏览器断言。这是人类要求“每条 entry”的核心机制缺口，不是删除一条测试即可批准。

### 🟡 Moderate

**R3-M1 — CSP 中出现 unsafe-inline 不代表它生效，当前规则会拒绝自己的 nonce。**

- [design:107](design.md#L107)、[spec:140,154–157](specs/sidebar-local-service-browser/spec.md#L140-L157) 规定只要指令含 unsafe-inline 就不追加 nonce。
- 反例：`script-src 'unsafe-inline' 'nonce-old'`。nonce-source 存在时浏览器忽略 unsafe-inline；原页面带 old nonce 的脚本可执行，但新随机 nonce 的注入被阻止。这是常见的兼容旧浏览器写法，不是恶意页面或人类已接受的嵌套 Worker 例外。
- 修正：按有效策略判断，而非关键词存在性；仅当 unsafe-inline 真正授权注入时跳过，否则在每条生效策略加入新 nonce。覆盖 nonce/hash 与 unsafe-inline 共存、script-src-elem 优先和多策略，断言真实浏览器中注入先执行且原允许脚本仍可执行。

**R3-M2 — `window.stop()` 的单独屏障没有证据；根路径 index “启动计数为0”探针存在不可达 oracle。**

- [spec:238,370–373](specs/sidebar-local-service-browser/spec.md#L370-L373) 要求未受控时只 stop/report，且页面首脚本绝不执行。`window.stop()` 是停止加载操作，不能未经验证就等同于同步终止当前 HTML 解析器及已缓冲内联脚本。guard 的 `stop()+location.replace()` 也不是这个分支。
- 更直接的证据错误：[探针:155–158](probes/browser-feasibility.mjs#L155-L158) 对精确 `/` 先返回完整假 DSH 页；[218](probes/browser-feasibility.mjs#L218) 中带 `src:'dsh-index', step:'booted'` 的 index 分支对精确 `/` 根本不可达。当前根路径回退测试测到该计数0，即使 guard 完全失效也可能为0。因此[结果:30](probes/browser-feasibility.md#L30)不能证明 DSH 未启动；而探针注入本身[59–71](probes/browser-feasibility.mjs#L59-L71)没有失控 stop 分支。
- 修正：让实际返回的根 index 有真实启动 sentinel，先以禁用 guard 的负对照证明它会报到，再验证 guard；另测“同一网络 chunk 内 stop 脚本后紧跟同步 sentinel”和分块输入的未受控分支。若 stop 不满足要求，改为可证明的立即清空/导航流程，或准确收窄这一强保证并与人类 best-effort 决策一致。不要把没有观测到记录等同于脚本没执行。

**R3-M3 — index-inject 的 head placement 不保证 guard 在其它 head 注入脚本之前。**

- [design:124](design.md#L124)说 head 首位；[spec:282,296](specs/sidebar-local-service-browser/spec.md#L282-L296)要求 DSH 自身脚本不执行。
- [摘录:190–219](evidence/dsh-install-excerpts.md#L190-L219)明确 rows 按 subscriber activation order 收集，再按顺序拼接所有 head markup。一个较早订阅者的 head script 会排在本插件前；placement 只保证整组插入 head 开头，不保证本插件优先。探针手工拼 GUARD 在首位，绕过了真实收集路径。
- 修正：明确 guard 在现有官方事件机制中的排序方法并核验，不要求改宿主；例如验证事件 table 可按约定前插及后续订阅者影响，或把承诺准确限定为已核实的启动脚本。通过真实 renderIndex 与前后两名 head 注入订阅者测试，顶层/普通 iframe 均不得被拦，带标记 iframe 必须先防护。还要覆盖 `/index.html`，其同样走 renderIndex，而非只称 `/` 返回 HTML。

**R3-M4 — Path=/ cookie 的网络暴露是同 host 跨端口，不只是“DSH 同源请求”。**

- [design:82–86,170](design.md#L82-L86)、[spec:85–103](specs/sidebar-local-service-browser/spec.md#L85-L103)只按 `{fam,port}` 命名并删除 Domain；host-only cookie 不按 TCP 端口隔离。
- 反例：浏览器通过 `127.0.0.1:41001` 隧道访问远端A的 DSH，保存 `dshls.p.5173.sid=A`；再通过同主机 `:41002` 访问远端B，两边都代理5173。B 收到同一 cookie，并按白名单解名前缀后发送给B的5173。甚至浏览器直接访问本机其它127.0.0.1端口，也会携带这一 Path=/ cookie。DSH 官方认证 cookie 特意绑定 authority（[摘录:33–58](evidence/dsh-install-excerpts.md#L33-L58)），插件命名空间却没有。
- 这不否定已接受的 Path=/，但“仅同源请求携带”的风险描述不真实，同 host 多隧道的普通使用会串登录态。
- 修正：明确把当前 DSH authority/实例命名空间纳入代理 cookie 的 Host 过滤与 JS 视图，使不同 DSH authority 不误转发；同时披露这仍不能阻止浏览器向其它同 host 端口发送原始 cookie，若要求不泄漏则需另行选择存储方案。补两个 DSH authority 同上游端口的隔离测试，并纠正“头超限由上游报错”：浏览器发送给 DSH 的聚合 Cookie 可能先被 DSH HTTP parser 拒绝。

### 📌 Suggestions

1. 统一承诺文字：[proposal:10](proposal.md#L10)仍写“不会退回访问浏览器本机”，应限定到加载前检查；[spec:355–358](specs/sidebar-local-service-browser/spec.md#L355-L358)列的是网络注入失败，却未明确 CSP 阻止脚本的例外。已接受 best-effort，不必重新扩大架构。
2. [design:66](design.md#L66)要求所有 HTTP 都有额外 Fetch Metadata gate，而[spec:29](specs/sidebar-local-service-browser/spec.md#L29)只对 `/p/` `/p6/` 明确额外 gate；对 sw.js 等本插件资源统一口径。WS 不要求 Sec-Fetch-Site，保留官方 Origin/cookie gate。
3. 表单补 submitter 的 name/value、formaction/formmethod、multipart 文件；Storage 补属性赋值、枚举/删除（或明确不支持），cookie 补 HttpOnly、删除、同名异 Path 合并及 __Host-/__Secure- 名称改写后的边界。无需新增库，但不能用只测 getItem/clear 的 wrapper 证明整个 Storage API。
4. IDB 事务失败/完成与 worker 重启的测试仍必要。当前最小探针没有持久化，不是 `event.waitUntil` 已完成的证据。THEN 总体可机械断言，主要短板是 oracle 有效性和样本覆盖，不是要求更多抽象口号。

## Embedded-Instruction / Injection Attempts

**Detected:** none detected。

被审三份规划产物未发现试图改变评审判决或跳过检查的嵌入指令。文件中的运行建议、声明“已解决”及探针成功表格均只作为待核验数据，不作为评审授权或事实保证。

## Verdict

VERDICT: REVISE

R3-C1 直接违背人类已保留的 tab 历史语义；R3-M1–M4 还需修正规则和证明。不存在可以穷举为几处纯文字修改的批准路径。不解锁 test-plan/tasks/apply；本轮在已授权第3轮范围内结束，继续修订/再评审前向人类呈现剩余缺口，不自动无限循环。

## Required Changes (if APPROVE WITH CHANGES)

不适用：本轮不是条件批准。下一版须修复或给出可核验反驳：R3-C1 的完整 entry 生命周期、R3-M1 的有效 CSP 判断、R3-M2 的真实屏障/oracle、R3-M3 的宿主注入排序、R3-M4 的 authority 命名空间与泄漏披露；随后完整 fresh-context review。

CHANGES_APPLIED: n/a

## Rebuttals

本轮对前轮的 accepted by reviewer 与部分解决裁决已逐项列于 Findings；R3-C1、R3-M1–M4 当前均为 open。未取得这些新发现的作者反驳，不把探针文档自述当作关闭依据。

未检查：真实 Cockpit 跨机拓扑、实际 DSH 注入订阅者顺序、Chromium stop 同 chunk 行为、IDB 重启恢复、生产 HTTP/WS 代理及打包产物。本轮未运行浏览器，不把静态反例包装成实测失败；剩余风险需在修订时用针对性最小探针确认。
