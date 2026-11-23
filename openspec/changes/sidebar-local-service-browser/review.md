## Review Metadata

- **Review round**: 4
- **Prior round**: round 3 REVISE（R3-C1 每 entry 身份维护、R3-M1 CSP unsafe-inline+nonce、R3-M2 探针 oracle、R3-M3 guard 排序、R3-M4 跨 authority cookie）；人类已授权第 4 轮。
- **Reviewer context**: cross-model codex/gpt-6-astra fresh-context subagent；未参与编写或前三轮评审。
- **Tool restrictions**: 只读检查及获准运行浏览器探针；唯一仓库写入为本报告。未安装、构建、部署、修改规划或实现；未写记忆。
- **Artifacts reviewed**: [proposal](proposal.md)、[design](design.md)、[spec](specs/sidebar-local-service-browser/spec.md)、[人类裁决](human-decisions.md)、前三轮报告、[探针说明](probes/browser-feasibility.md)、[探针源码](probes/browser-feasibility.mjs)、[安装摘录](evidence/dsh-install-excerpts.md)；另参照 manifest、当前 sidebar-session-resources 规范和集成陷阱文档。未发现 openspec/project.md。
- **核验限制**: 已读取 OpenSpec review instructions/template。安装目录访问被 managed-root 拒绝，没有绕过；宿主结论为**摘录核验**，不冒充直接读取安装包。长工具输出有中部截断，对关键规划段落分段补读。探针 stdout 中部亦被展示截断，没有把未展示的事件当作本轮逐项实测证据。
- **本轮实际运行**: `node openspec/changes/sidebar-local-service-browser/probes/browser-feasibility.mjs`，完成 exit code 0；U1=53728、U2=53729、D=53730、C=53731，authority hash=`okBB8hhf`。可见输出确认 SW active、DSH 主页不受控、上游 SW 请求403、首脚本标记/地址还原、两个资源经代理、cookie 与 localStorage 保留、CSP old-nonce 脚本标记为 true、去守卫正向对照确实上报、finish。它不是完整插件验收；WS handler 只记录并销毁 socket，不能证明 WS 握手与回显通过。
- **SHA-256**:
  - proposal: `8364c414c410f2e6aa2724a9704185589bfc3531ae552a4f441443dae2f1f2df`
  - design: `10267a7c56ca9ce9566fcbb8ff34bcf789f2b6c230f63653771d2b6f694dd656`
  - spec: `02b0c1deae2ea9fc85ad0a1a26bcb38ae57c058b2af0d2a1d9b733a8b5f12323`

本判决仅适用于这些快照；除逐条落实 Required Changes 外，改动规划须重新完整评审。已接受同源信任、Path=/、尽力而为和无书签，不把这些取舍重新列为缺陷。

## Findings

### 第 3 轮逐项裁决

| 项目 | 裁决 | 证据与边界 |
|---|---|---|
| R3-C1 | **resolved（规划机制）** | [design:128–142](design.md#L128-L142)、[spec:259,315–319](specs/sidebar-local-service-browser/spec.md#L259) 改用原生 sessionStorage 的 entry.key 表，并在 currententrychange 后维护；不再依赖应用可覆盖的 state。[探针:77–82,180–184](probes/browser-feasibility.mjs#L77-L82) 确实增加了 SPA push/replace 后跨端口 back；[记录:39](probes/browser-feasibility.md#L39) 给出正确 U1 路径。原“只记初始 entry”反例已消除。存储失败及生命周期另见 R4-M1；不把规划关闭等同于所有 hash/query/BFCache 组合已验收。 |
| R3-M1 | **resolved（原 CSP 反例）** | [spec:151–176](specs/sidebar-local-service-browser/spec.md#L151-L176) 按 script-src-elem → script-src → default-src，逐策略判断真正有效的 unsafe-inline；nonce/hash/strict-dynamic 共存时追加。本轮可见 `csp-old-nonce-ran marker:true`；[探针记录:42](probes/browser-feasibility.md#L42) 给出普通 inline 被阻止。多策略和 fallback 分支仍应放进 test-plan，不能声称均已浏览器验证。 |
| R3-M2 | **partially** | [探针:146–152,195–197,232–234](probes/browser-feasibility.mjs#L146-L152) 的实际 index 已含可达 sentinel，本轮看到了无 guard 正向对照上报；旧 oracle 缺陷已修。但 [说明:23](probes/browser-feasibility.md#L23) 明确未覆盖未受控 stop 分支，[spec:399–402](specs/sidebar-local-service-browser/spec.md#L399-L402) 仍保留首脚本绝不执行的硬断言，见 R4-M2。 |
| R3-M3 | **partially** | [摘录:221–230](evidence/dsh-install-excerpts.md#L221-L230) 支持 tapIndex 晚于全部结构化行，修复较早 head subscriber 的反例；但还有官方后处理 base，最终“首位”口径不准确，且 /index.html 尚未纳入验收，见 R4-M3。 |
| R3-M4 | **resolved（指定的跨 authority 误转发）** | [design:83–98](design.md#L83-L98)、[spec:85–109,334–337,355](specs/sidebar-local-service-browser/spec.md#L85-L109) 对 HTTP/WS/JS 共用 authority 前缀，并披露同 host 其它端口仍收到原始 cookie。官方 gate 先认证、cookie 签名绑定 authority，见 [摘录:60–87](evidence/dsh-install-excerpts.md#L60-L87)；不是仅凭任意客户端声称的 hash 授权。探针没有双 authority Host 过滤测试，规划场景已有，后续仍须执行。 |

### 早期部分解决项跟踪

- R2-C1 / R1-C2、M5：支持范围已由人类收窄，首注入与嵌套拓扑有证据；唯未受控分支强断言仍由 R4-M2 承接，不整项声称已实测关闭。
- R2-C2 / R1-M6：每 entry 身份的核心修订接受；R4-M1 承接持久表异常。POST、外跳提示、无书签继续按既有人类决定处理。
- R2-M4 / R1-M3：有效 CSP 指令选择与缓存/压缩/流式契约已写清，规划层关闭原反例；探针缓冲整个 HTML，不能代替流式实现验收。
- R2-M5：嵌套模拟可行性获支持，但真实 Cockpit、SW 重启与 IDB 恢复仍是待执行验收，不称已通过。R2-M6 的任意 SPA fallback 前提不成立，维持此前关闭。
- 其余前三轮已关闭的认证、单一 WS 入口、cookie Path 冲突、上游 SW 注册反例，没有发现需要重新打开的同一反例。不把普通同源网页兼容包装误当安全沙箱。

### 🔴 Critical (blocking)

**无新的未解决 Critical。** 不要求更换同源前缀架构；下面缺口可用明确、有限的规划修订修复。

### 🟡 Moderate

**R4-M1 — 历史表变成核心依赖，但存储不可用/写满/坏值没有失败契约。**

- [design:128–131](design.md#L128-L131)、[spec:259,307,337](specs/sidebar-local-service-browser/spec.md#L259) 只规定原生保留键和每次写入；没有容量回收、异常或格式校验要求。sessionStorage 是同一顶层上下文、同 origin 的共享配额，隔离键前缀并不隔离配额。
- 具体普通失败：应用写满其 sessionStorage 命名空间，再 pushState；表的 setItem 抛 QuotaExceededError，新 entry 没有身份。下一次跨文档注入中，若首次 rec() 抛错，后续导航和兼容层安装也会被中断。探针 [77–82](probes/browser-feasibility.mjs#L77-L82) 的 rec() 无异常处理，而且 [105–108](probes/browser-feasibility.mjs#L105-L108) 只替换 localStorage，不能证明最终 sessionStorage 包装不影响保留表。未知身份拒绝是合理策略，但当前没有把“记录失败”转为明确可观测的停止/错误。
- 最小修复：定义原生引用获取顺序、保留键对 wrapper 不可见且 clear 不删除、读写/解析失败时通知 tab 并清空 iframe，不允许半初始化页面继续；明确回收失效 entry、frame 关闭后的清理归属，避免每个新 entry 永久累积。共享表清理不能删掉其它仍存活 frame 的记录。补配额/坏 JSON/clear/跨文档重载和两个同源 frame 的断言。无需新增数据库或安全隔离架构。

**R4-M2 — 正向 oracle 修复不等于未受控 stop 屏障已被证实。**

- [spec:257,399–402](specs/sidebar-local-service-browser/spec.md#L399-L402) 仍要求仅 stop/report 后，上游第一个脚本计数严格为零；[design:126](design.md#L126)、[探针说明:23](probes/browser-feasibility.md#L23) 没有相应实验。guard 的 stop+立即 replace 是不同控制流。
- 这是证据/承诺缺口，**不是本轮声称已复现 window.stop 失效**。其 THEN 可以计数，但缺少该分支对照；本轮探针成功退出不能验证未进入的分支。
- 最小修复：遵循已接受的 best-effort，删除此分支未经证明的“页面首脚本绝不执行”硬承诺，改为能机械断言的 stop 调用、未继续安装步骤、报告、仅重载一次、最终 about:blank 与错误；把脚本零执行作为需要独立验证的目标。若坚持强承诺，则先补同 chunk 紧邻 sentinel 与分块 HTML 的真实浏览器证据及无 stop 对照，再保留原条款。

**R4-M3 — tapIndex 不是最终 HTML 后处理，“head 首位”应是“首个可执行脚本”。**

- [design:139,186](design.md#L139)、[spec:302](specs/sidebar-local-service-browser/spec.md#L302) 用首位定义顺序与验收，但 [安装摘录:274](evidence/dsh-install-excerpts.md#L274) 明确官方在 renderIndex（包含 tapIndex）**之后**再插入 `<base href="./">`，最终顺序为 head → base → guard。
- base 自身不执行脚本；因此这**不是 DSH boot 已绕过 guard 的反例**，也不要求移除官方 base。但若据“守卫第一节点”验收，当前官方版本必然不满足；手拼首位的 probe 无法检验实际流水线。另 [design:17](design.md#L17) 承认 /index.html 返回 index，[spec:301–305](specs/sidebar-local-service-browser/spec.md#L301-L305) 却仅把 `/` 列为 index、其它路径称404或静态资源。
- 最小修复：明确 guard 是最终响应的首个可执行脚本，允许其前的官方 base；目标 URL 使用根绝对代理路径、不受 base 影响。把 `/index.html` 同列 index 分支。给最终 renderIndex + frontend-static 后处理、两名结构化 head subscriber、标记/普通 iframe/顶层页面规定可执行顺序和 sentinel 断言。

**R4-M4 — 同一资源的 HTTP 来源检查在 design/spec 不一致。**

- [design:67–70](design.md#L67-L70) 额外 Fetch Metadata fence 适用于全部 HTTP，[spec:30](specs/sidebar-local-service-browser/spec.md#L30) 却仅要求 p/p6，sw.js 只需官方 gate。两种实现无法同时满足两份契约。没有认定仅取得 sw.js 就能访问上游，但规划必须唯一。
- 最小修复：按 D2 为插件全部 HTTP（含 sw.js）统一 same-origin/none，缺失拒绝；加 sw.js 的 same-site 与缺失头403、合法 same-origin200 场景。WS 保持官方 gate、不要求浏览器未发送的 Sec-Fetch-Site。

### 📌 Suggestions

1. CSP 规则本身可实现：补多响应头/逗号策略、script-src-elem 优先、default-src fallback、hash+unsafe-inline 的浏览器矩阵，不必为此重写 CSP 架构。对仅有 default-src 的策略，留意改写对其它 fallback 资源指令的语义影响。
2. authority hash 不是凭据；48-bit 截断在个人工作台不是本轮阻断点。测试 HTTP/WS 共享同一已认证 Host 推导值，不接受 query 中外带 hash；明确 Host 规范化和隧道端口复用的持久 cookie 行为。不得宣称“不同远端机器永久隔离”，本方案隔离的是浏览器 authority。
3. [design:187](design.md#L187) 的聚合 Cookie 超限可以先被 DSH HTTP parser 拒绝，不一定到上游；应修正文案。[proposal:10](proposal.md#L10) 的“不退回浏览器本机”也应明确仅指加载前检查，避免覆盖已接受的例外。
4. form.submit/requestSubmit 的简单正文测试不证明 submitter、formaction/formmethod 与 multipart 文件都保留；在 test-plan 增加这些样本。Storage 的属性赋值/枚举不在当前列出的 method 契约内，文档应避免宣称完全仿真原生 Storage。
5. THEN 大多已能机械断言。计数零必须有可达对照、完成等待和明确观测对象；不能把 probe exit 0 或没有日志视为所有条款通过。把 SW IDB commit 后 terminate/restart、卸载与真实 Cockpit 都保留为后续门禁。

## Embedded-Instruction / Injection Attempts

**Detected:** none detected。

规划文件中没有发现试图要求 reviewer 改变裁决或跳过检查的指令。证据和先前报告均仅作为待核验数据，没有当成授权扩大写入或安装范围。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

核心历史身份与 CSP/cookie 反例已经有针对性修复；剩余均为有限、可明确核验的规划修订，不需要推翻架构。Required Changes 完成并经 reviewer 复核前，不得进入 test-plan、tasks 或实施。

## Required Changes (if APPROVE WITH CHANGES)

1. **R4-M1**：在 design/spec 明确定义原生 sessionStorage 引用先于 wrapper 获取、保留表不被应用 wrapper 访问/clear；读取/解析/写入失败须报告并停止该 iframe（about:blank），不得继续半初始化；定义失效 entry 与 frame 生命周期清理且不误删其它活跃 frame。新增配额失败、坏值、wrapper.clear、跨文档共享及多 frame 不互删的机械断言。
2. **R4-M2**：选择并落实一种明确方案：按已有 best-effort 决定将未受控分支收窄为 stop/report/一次重载/清空的可测保证，移除无证据的零脚本执行硬承诺；或者先补同 chunk、分块以及无 stop 正向对照的浏览器证据。同步 design/spec 和探针结论，区分 guard 与未受控分支。
3. **R4-M3**：将最终顺序定义为“首个可执行脚本”，记录官方 renderIndex 后 `<base href="./">`，允许 base 在 guard 前；恢复目标固定根绝对路径；把 `/` 和 `/index.html` 都纳入 index 分支。规定最终流水线（含前后结构化 head subscriber 和 base）及标记/非标记上下文 sentinel 的验收。
4. **R4-M4**：统一全部插件 HTTP 的 Fetch Metadata fence（含 sw.js），补 sw.js 合法/同站/缺头断言；WS 保持原 gate，不增加 Sec-Fetch-Site 要求。

CHANGES_APPLIED: yes

## Rebuttals

- R3-C1、R3-M1、R3-M4：**accepted by reviewer**，仅关闭逐项表中原具体反例；不是全部实现或实机安全验收通过。
- R3-M2、R3-M3：仅接受表内局部修复；剩余分别由 R4-M2、R4-M3 承接。
- 本轮 R4-M1–M4 尚无作者修复或获 reviewer 接受的反驳。作者自行修改完成信号不构成复核通过。

## Re-check of Required Changes (round 4)

- 复核日期：2026-11-23（Asia/Shanghai）。
- 复核者上下文：cross-model codex/gpt-6-astra fresh-context subagent，read-only；仅复核第 4 轮 Required Changes 1–4，唯一写入为本追加小节。未运行探针、构建或实施验收，未修改原 VERDICT、CHANGES_APPLIED 或其它文件；宿主流水线仅核对所提供摘录。
- 修订后三份产物 SHA-256：
  - [proposal.md](proposal.md)：`b45b248c3f39497708e1de738593134184d06ea083ba5b07e47d0a783168adb2`
  - [design.md](design.md)：`1ecec31f0120c131c90f12cf0bcf90ab08aa913463dce05a4b7ed9f1890ea7a7`
  - [spec.md](specs/sidebar-local-service-browser/spec.md)：`ef5e6b5bf792865994a141b186d7ca7fec84159e92129cdb045955a53bd7c96a`

1. **Required Change 1 / R4-M1 — partially**。
   - 证据：[design:136–140](design.md#L136-L140)、[spec:264–271](specs/sidebar-local-service-browser/spec.md#L264-L271)、[spec:307–321](specs/sidebar-local-service-browser/spec.md#L307-L321)。原生引用先获取、保留键绕开 wrapper/clear、异常报告并 about:blank、失效 entry 剪除及容量上限均已写入；但挂载仍全删共享命名空间，新增多 frame 断言只覆盖 pushState，未覆盖生命周期不互删，也没有显式跨文档重载共享断言。
   - 还差：将 design:140 的“tab 挂载时清掉所有 `__dshls.entries.*`”及 spec:271 的同义 SHALL 改为只删除可证明已失效/归本实例所有的记录，明确不能删除其它活跃 frame 的键；不能仅以单实例 tab 推导同一顶层同源存储中没有其它 frame。补充 f2 存活时 f1 挂载/卸载后 f2 值不变，以及同一 frame 跨文档重载后沿用 frameId、原表可读取并可恢复旧 entry 的机械断言。另为“解析失败”明确合法 JSON 但结构错误（例如 `null` 或记录缺少 fam/port/rest）的校验与相同失败处理，避免坏值仅按 JSON 语法判断；将 design:131 的旧单键 `__dshls.entries` 同步为 frame 分键。
2. **Required Change 2 / R4-M2 — applied**。
   - 证据：[design:126–129](design.md#L126-L129)、[spec:261–262](specs/sidebar-local-service-browser/spec.md#L261-L262)、[spec:419–441](specs/sidebar-local-service-browser/spec.md#L419-L441)、[探针说明:23](probes/browser-feasibility.md#L23)。已明确选择 best-effort：只承诺 stop、停止安装、报告、一次重载与最终清空/错误，删除未受控分支零脚本执行断言，并明确守卫探针不是该分支的证据；本项是规划修订通过，不声称该分支已实测。
3. **Required Change 3 / R4-M3 — partially**。
   - 证据：[design:147–153](design.md#L147-L153)、[spec:330–335](specs/sidebar-local-service-browser/spec.md#L330-L335)、[spec:358–362](specs/sidebar-local-service-browser/spec.md#L358-L362)。主体已加入最终首个可执行脚本、官方后处理 base、根绝对恢复路径、两个 index URL 及三种上下文哨兵；但遗留验收仍要求“排第一”，并且新场景未明确两个结构化 subscriber 分别在本插件之前和之后注册/激活，未完整锁定 Required Change 所要求的前后顺序矩阵。
   - 还差：将 design:199 的“验收时检查渲染后的 DSH index 中守卫是否排第一”改为“最终 frontend-static 响应中守卫为首个可执行脚本，允许官方 base 在前”；design:197 的“只有 `/` 会返回 HTML”改为 index 分支包含 `/` 和 `/index.html`（其它路径仍可能为静态资源）。spec:359 的 GIVEN 明确一个结构化 head subscriber 在本插件之前、另一个在之后注册/激活，保留两 URL 和标记/非标记上下文的断言。同步 [proposal:9](proposal.md#L9) 的“head 首位”与 [探针说明:53](probes/browser-feasibility.md#L53) 的“必须排在 index 的 head 首位”为最终首个可执行脚本口径；探针手写 index 的历史描述可以保留，但不能把其节点首位升级为真实宿主最终验收标准。
4. **Required Change 4 / R4-M4 — applied**。
   - 证据：[design:67–71](design.md#L67-L71)、[spec:29–30](specs/sidebar-local-service-browser/spec.md#L29-L30)、[spec:50–58](specs/sidebar-local-service-browser/spec.md#L50-L58)。全部插件 HTTP（含 sw.js）统一先官方 gate、再 same-origin/none、缺头拒绝；sw.js 明确 same-origin 200、same-site/缺头 403，WS 保持官方 gate 且不新增 Sec-Fetch-Site 要求。

RE-CHECK: FAIL

## Re-check 2 of Required Changes (round 4)

- 复核日期：2026-11-23（Asia/Shanghai）。
- 复核者上下文：cross-model codex/gpt-6-astra fresh-context subagent，read-only。仅对照上一复核节列出的 R4-M1、R4-M3 缺口，并快速确认 R4-M2、R4-M4 未回退；唯一写入为本追加小节。未开展新的全面审查，未运行探针、测试、构建或实施验收；宿主事实仅核对所提供摘录，未读取安装目录。原 VERDICT、CHANGES_APPLIED 与上一复核节均保持不变。
- 修订后 proposal/design/spec 的 SHA-256：
  - [proposal.md](proposal.md)：`65634baaa1e0efcbceb374f0cd087f7a88e8aa76700c889507fa4f3febaffa8e`
  - [design.md](design.md)：`674525069ccce7921cf1229a6abbed27d8f775ab8c67a971c272428a472dca67`
  - [spec.md](specs/sidebar-local-service-browser/spec.md)：`995d969676cbcc6ac5c9bf0f83f7fc263a2b6ac252d2c6eb73fcef12c2713dda`

1. **Required Change 1 / R4-M1 — partially**。上次缺口逐项复核：
   - **挂载全删共享表、生命周期不互删：已补。** [design:140](design.md#L140)、[spec:273](specs/sidebar-local-service-browser/spec.md#L273) 改为按存活 iframe 筛选失效 frameId，卸载只删自身；[spec:330–333](specs/sidebar-local-service-browser/spec.md#L330-L333) 明确 f2 存活时 f1 挂载及卸载后 f2 的值均不变，不再以单实例 tab 为全删依据。
   - **同一 frame 跨文档重载、沿用 frameId、读取原表并恢复旧 entry 的机械断言：部分补齐。** [design:142](design.md#L142)、[spec:271](specs/sidebar-local-service-browser/spec.md#L271) 已规定跨文档读取并合并旧表；[spec:325–328](specs/sidebar-local-service-browser/spec.md#L325-L328) 断言整页导航到另一端口后同一个 f1 表中保留 k1/k2。不过 WHEN 是从 `/a` 整页导航到 `/b`，不是重载；THEN 只检查表内容，未明确重载后 frameId 不变且旧 entry 可恢复。[spec:294–297](specs/sidebar-local-service-browser/spec.md#L294-L297) 的 reload 场景只检查请求路径与历史长度，[spec:352–362](specs/sidebar-local-service-browser/spec.md#L352-L362) 的恢复场景没有重载前提，尚未补齐上一复核明确要求的重载断言。
   - **合法 JSON 但结构错误的校验与失败处理：已补。** [design:139–141](design.md#L139-L141)、[spec:270–272](specs/sidebar-local-service-browser/spec.md#L270-L272) 明确对象与每条记录的字段形状，不合格同样 stop/report/about:blank；[spec:309–313](specs/sidebar-local-service-browser/spec.md#L309-L313) 增加合法 JSON 但 fam 不合格的机械失败样本，不再只检查 JSON 语法。
   - **旧单键同步为 frame 分键：已补。** [design:131](design.md#L131) 现为 `__dshls.entries.<frameId>`，与 [spec:265](specs/sidebar-local-service-browser/spec.md#L265) 一致。
   - 原已落实的原生引用先获取、wrapper.clear 不删除保留表、配额失败停止及失效 entry 剪除仍见 [design:136–139](design.md#L136-L139)、[spec:265–272](specs/sidebar-local-service-browser/spec.md#L265-L272)、[spec:309–323](specs/sidebar-local-service-browser/spec.md#L309-L323)，未见本次修订撤销。
2. **Required Change 2 / R4-M2 — applied**。理由：[design:126–129](design.md#L126-L129)、[spec:262](specs/sidebar-local-service-browser/spec.md#L262)、[spec:448–453](specs/sidebar-local-service-browser/spec.md#L448-L453) 仍只承诺 stop、停止安装、报告、一次重载及最终清空，明确不保证页面自有脚本零执行；[探针说明:23](probes/browser-feasibility.md#L23) 仍区分未受控分支与守卫证据，没有回退为强承诺。
3. **Required Change 3 / R4-M3 — applied**。上次缺口逐项复核：
   - **旧“守卫排第一”验收口径：已补。** [design:201](design.md#L201) 改为最终响应中首个可执行脚本，允许官方 base 在前；[design:149–154](design.md#L149-L154)、[spec:342–346](specs/sidebar-local-service-browser/spec.md#L342-L346) 保留 renderIndex 后 base 及根绝对恢复路径，与 [宿主摘录:228–229,274](evidence/dsh-install-excerpts.md#L228-L274) 相符。
   - **旧“只有 `/` 返回 HTML”的 index 分支遗漏：已补。** [design:199](design.md#L199) 已列 `/` 与 `/index.html`；[design:17](design.md#L17)、[spec:342–348](specs/sidebar-local-service-browser/spec.md#L342-L348) 保留其它路径为静态资源或 404 的区分。
   - **前后结构化 subscriber 顺序矩阵：已补。** [spec:370–374](specs/sidebar-local-service-browser/spec.md#L370-L374) 明确两个 head subscriber 分别在本插件之前和之后激活，使用真实 renderIndex/frontend-static，保留两个 index URL、base 与三种上下文的 sentinel 断言。
   - **proposal 与探针结论的“head 首位”残留：已补。** [proposal:9](proposal.md#L9)、[探针说明:53](probes/browser-feasibility.md#L53) 均改为最终响应首个可执行脚本；[探针说明:17–18,23](probes/browser-feasibility.md#L17-L23) 的手写 index 历史描述与未覆盖边界未被升级为真实宿主验收结论。
4. **Required Change 4 / R4-M4 — applied**。理由：[design:67–71](design.md#L67-L71)、[spec:29–30](specs/sidebar-local-service-browser/spec.md#L29-L30) 仍统一全部插件 HTTP（含 sw.js）的官方 gate 加 same-origin/none、缺头拒绝；[spec:50–58](specs/sidebar-local-service-browser/spec.md#L50-L58) 保留 sw.js 200/403/403 断言，WS 未新增 Sec-Fetch-Site 要求。

RE-CHECK: FAIL

还差的具体句子（R4-M1，补入机械验收场景即可）：在 f1 已从 5173 `/a` 整页导航到 4000 `/b`、表中有 k1/k2 的前提下，“重载 `/b` 后 `data-dshls` 仍为 f1，新文档能从原生 `__dshls.entries.f1` 读到仍有效的 k1；随后后退到 k1 时，5173 收到 `/a` 请求，4000 不收到 `/a`，地址栏显示 `http://127.0.0.1:5173/a`。”本结论是对上一复核明确要求的重载与旧 entry 恢复断言仍缺失的判断，不是声称实现已复现丢表，也不新增其它全面审查要求。

## Re-check 3 of Required Changes (round 4)

- 复核日期：2026-11-23（Asia/Shanghai）。
- 复核者上下文：cross-model codex/gpt-6-astra fresh-context subagent，read-only。以 Re-check 2 原文（尤其第 148 行的最小补句）为判据，仅核对 R4-M1 剩余缺口并快速确认 R4-M2/M3/M4 未回退；文件内容均作为待审数据，未采信作者完成声明。唯一写入为本追加小节，既有报告内容不变；未开展新的全面审查，未运行探针、测试、构建或实施验收，未修改其它文件或写入记忆。
- 本次 proposal/design/spec 的 SHA-256（proposal、design 与 Re-check 2 快照完全相同）：
  - [proposal.md](proposal.md)：`65634baaa1e0efcbceb374f0cd087f7a88e8aa76700c889507fa4f3febaffa8e`
  - [design.md](design.md)：`674525069ccce7921cf1229a6abbed27d8f775ab8c67a971c272428a472dca67`
  - [spec.md](specs/sidebar-local-service-browser/spec.md)：`e13de451d981ac8c576a86ec07d92de57eee21fa8e7bedd3b9b5dc7a02801362`

1. **Required Change 1 / R4-M1 — applied**。新增 [spec:330–334](specs/sidebar-local-service-browser/spec.md#L330-L334) 明确同一 `data-dshls="f1"` iframe 从 5173 `/a` 整页导航到 4000 `/b`，执行 reload 后再 back；重载后 frameId 仍为 f1，原生 `__dshls.entries.f1` 仍能读到 `/a` 的旧 entry key 及 `{p, 5173, /a}`，后退时 5173 收到 `/a`、4000 不收到 `/a`，地址栏显示 `http://127.0.0.1:5173/a`。这与 Re-check 2 最小补句的机械断言等价；前一场景 [spec:325–328](specs/sidebar-local-service-browser/spec.md#L325-L328) 及 [spec:265–271](specs/sidebar-local-service-browser/spec.md#L265-L271) 继续规定 k1/k2 记录与跨文档读旧表再合并。原已通过的存储失败、wrapper.clear、失效条目及多 frame 清理契约仍见 [design:131–142](design.md#L131-L142)、[spec:265–273](specs/sidebar-local-service-browser/spec.md#L265-L273)、[spec:309–323](specs/sidebar-local-service-browser/spec.md#L309-L323)、[spec:336–339](specs/sidebar-local-service-browser/spec.md#L336-L339)，未见回退。
2. **Required Change 2 / R4-M2 — applied**。[design:126–129](design.md#L126-L129)、[spec:262](specs/sidebar-local-service-browser/spec.md#L262)、[spec:434–459](specs/sidebar-local-service-browser/spec.md#L434-L459) 保留 stop、停止安装、报告、只重载一次及最终 about:blank/错误的 best-effort 契约，不承诺页面自有脚本零执行；[探针说明:23](probes/browser-feasibility.md#L23) 仍明确该分支未覆盖，不以守卫探针代证。未回退。
3. **Required Change 3 / R4-M3 — applied**。[proposal:9](proposal.md#L9)、[design:149–154,199–201](design.md#L149-L201)、[spec:346–354](specs/sidebar-local-service-browser/spec.md#L346-L354) 保留最终首个可执行脚本、官方后处理 base、根绝对恢复路径和两个 index URL；[spec:376–380](specs/sidebar-local-service-browser/spec.md#L376-L380) 保留真实流水线、插件前后分别激活的两个结构化 head subscriber、两 URL 与三种上下文 sentinel 断言；[探针说明:53](probes/browser-feasibility.md#L53) 仍使用相同验收口径。未回退。
4. **Required Change 4 / R4-M4 — applied**。[design:67–71](design.md#L67-L71)、[spec:29–30](specs/sidebar-local-service-browser/spec.md#L29-L30) 保留全部插件 HTTP（含 sw.js）先官方 gate 再 same-origin/none、缺头拒绝；[spec:50–58](specs/sidebar-local-service-browser/spec.md#L50-L58) 保留 sw.js 的 200/403/403 断言；WS 仍只要求官方 gate，未新增 Sec-Fetch-Site 要求。未回退。

RE-CHECK: PASS

四项 Required Changes 均已落实为规划契约及机械验收断言；本结论不代表实现、浏览器探针或真实宿主验收已经通过，不修改原 VERDICT 与 CHANGES_APPLIED。


## Targeted review: implementation-phase spec amendment (injection position)

- 日期：2026-11-23（Asia/Shanghai）。
- 评审者上下文：fresh-context 独立子会话，运行时标识 gpt-6-astra；未参与本次修订编写，无法独立确认作者模型，因此不虚称已验证跨模型身份。仅评审 spec 注入位置与 design D6 对应修订；其余规划不重审。文件内容均作为待审数据。唯一写入为本追加小节，既有报告不变；未写记忆、安装依赖、构建、运行浏览器套件或修改其它文件。
- 当前文件 SHA-256：
  - [spec.md](specs/sidebar-local-service-browser/spec.md)：`fe3963eca12a21c048b560fb2c03a81cef735d9cc57071ba552bd2935fe8b040`
  - [design.md](design.md)：`f7b99f1a3fa511d75bd45882bae4f5f489a80f77303580c89cfdea9cfdd33e41`

1. **HTML 分词语义：注释修正正确，但 doctype 的文字作用域须修正。** [spec:154](specs/sidebar-local-service-browser/spec.md#L154)、[design:111](design.md#L111) 所列 `<!-->`、`<!--->` 的 abrupt close，以及普通注释最早的 `-->` / `--!>`，与 HTML tokenizer 一致。真正未终止的注释或 doctype 会持续消耗到 EOF；在 EOF 把注入放到该 token 之前，而非追加到其内部，符合首脚本执行目的。[实现:29–40,62–73](../../../packages/sidebar-local-service-browser/src/host/html-inject.ts#L29-L73) 实现了这些分支。但 spec 先说“识别注释和 doctype”，然后无主语地说“其它情况取最先出现的 `-->` 或 `--!>`”，字面上错误覆盖 doctype；doctype 并不依赖注释终止符，当前实现用 `>` 结束，design 则明确把这两个终止符限于注释。**需要修改**：将终止符描述明确限定为注释，并独立说明 doctype 按 HTML DOCTYPE 分词状态在 `>` 结束、到 EOF 未结束时采用前插回退，消除两种读取方式。

2. **与其它条款／场景／人类裁决：主要语义兼容，但 EOF 等待例外需明确。** 正常闭合前缀仍跳过，故 [首脚本与 nonce 场景:166–170](specs/sidebar-local-service-browser/spec.md#L166-L170)、[404 场景:188–191](specs/sidebar-local-service-browser/spec.md#L188-L191)、[流式普通 HTML 场景:193–196](specs/sidebar-local-service-browser/spec.md#L193-L196) 的原输入与预期均不改变。nonce、CSP、适用状态码和透传规则未被本次修订放宽。修订让注入真正先执行，不是重新承诺 stop 后页面脚本零执行，与 [人类裁决:12](human-decisions.md#L12)、[spec:439–442,459](specs/sidebar-local-service-browser/spec.md#L439-L459)、[design:126–129](design.md#L126-L129) 的尽力而为边界不矛盾。但是“直到输入结束”才判定未闭合 token，与 [spec:161](specs/sidebar-local-service-browser/spec.md#L161) 无条件的“MUST NOT 等待上游正文结束”存在字面冲突：例如短的 `<!-- open` 流，既不能确认最终是否闭合，也不能在 EOF 之前执行所指定回退。**需要修改**：在注入位置条款内明确尚未判定前导 token 的有界缓冲例外及 EOF 回退；流式承诺应是位置已知即发送，不全量缓冲普通正文，而非承诺任何未完成 token 都能立即注入。无需改动三个既有场景或尽力而为裁决。

3. **实现与测试：M1 的核心反例已修；新规则尚未完整表达现存有界回退。** [实现:18–19,96–109](../../../packages/sidebar-local-service-browser/src/host/html-inject.ts#L18-L109) 在 held 超过 256 KiB 时立即在 `scan.safe` 前插，并不等待 EOF，也不保证该 token 最终未闭合。具体反例：第一块为 `<!--` 加 262144 个 `x`，第二块为 `-->` 加页面脚本；stream 在第一块即把注入置于索引 0，而 one-shot 在已闭合注释之后的索引 262151 注入。依 [spec:154](specs/sidebar-local-service-browser/spec.md#L154) 当前文字，此最终闭合的注释必须跳过，两者不一致。这不是要求取消合理的内存上限：**需要修改** 注入位置及 D6 的回退条件，显式允许“未决前导 token 超过有界缓冲阈值时，在该 token 前注入”，并补最终闭合／未闭合的大 token 分块回归，证明位置、脚本顺序及正文保留；也可选择改变实现使其满足另一份明确且可执行的契约，但不要用尽力而为默默豁免位置规则。
   - 已读 [单测:15–64](../../../packages/sidebar-local-service-browser/test/host-html-scanner.test.ts#L15-L64)：覆盖四类终止、正向 page 对照、EOF 注释执行与 doctype 索引；[单测:72–103](../../../packages/sidebar-local-service-browser/test/host-html-scanner.test.ts#L72-L103) 覆盖每个切分点与逐字节分块，但样本均未触达 256 KiB，不能证明其标题所称 streaming/one-shot 等价对超阈值文档成立。
   - 已读 [Chromium 测试:11–45](../../../packages/sidebar-local-service-browser/test/browser/inject-position.browser.test.ts#L11-L45)：断言首页面脚本读取时 marker、pathname、WebSocket 包装已就绪；没有 EOF doctype／注释及超阈值样本。本次按要求未运行 Chrome，不引用作者结果作为自己的执行证据。
   - 实际执行：Node stdin 只读探针加载真实 TypeScript 实现及现有 jsdom，四种闭合注释均得 `inject,page`，未闭合注释与 doctype 均得 `inject`，普通 doctype 得 `inject,page`；同一探针复现上述大注释 `streamIndex=0, oneShotIndex=262151, equal=false`。未运行 Vitest，避免其缓存／结果写入越过本次唯一写入限制。未新增探针文件。

本结论仅要求澄清本次修订涉及的终止符作用域、EOF／有界缓冲回退与流式语义，并为该边界补回归；不重新打开其它规划决定，也不否定已修复的 M1 普通注释反例。对照旧规则使用任务提供的原句；当前第 4 轮报告本身没有逐字保存该句，不能把任务引文冒充报告原文。

AMENDMENT-REVIEW: REVISE

## Targeted re-review 2: injection position amendment

- 日期：2026-11-23（Asia/Shanghai）。
- 评审者上下文：fresh-context 独立子会话，运行时标识 gpt-6-astra；未参与修订。仅复核上一小节的三项要求及其直接引入的不一致，文件内容均视为数据。唯一写入为本追加小节，未改既有内容、实现或其它文件；未写记忆、安装依赖或运行浏览器套件。
- 当前产物 SHA-256：
  - [spec.md](specs/sidebar-local-service-browser/spec.md)：`c65b420b052701ddcaf321c3baa23e850bbf5476ee2d7291550c45b3a43b2933`
  - [design.md](design.md)：`3fae37c0e2e622be513d13e8b5bee4deadc54d5ec234dee04712dc693ed3f5a3`

1. **注释终止符作用域与 doctype 单列 — resolved。** [spec:154–158](specs/sidebar-local-service-browser/spec.md#L154-L158) 已拆为“注释”和“doctype”两项，`-->` / `--!>` 不再字面覆盖 doctype；doctype 单独规定遇 `>` 结束，并与注释共同适用 EOF 前插回退。[design:111](design.md#L111) 同步；[实现:29–40,62–73](../../../packages/sidebar-local-service-browser/src/host/html-inject.ts#L29-L73) 的相应分支没有被文案混同。本结论只关闭上一轮所指的作用域歧义，不将此轻量 scanner 认定为所有 HTML DOCTYPE 状态的完整实现。
2. **EOF 判定与“不等待正文结束”的例外 — resolved（规则结构）。** [spec:158,165](specs/sidebar-local-service-browser/spec.md#L158-L165) 已明确未决位置允许有界缓冲，EOF 时回退；位置确定即输出，后续透传。[design:111](design.md#L111) 同样明确唯一例外。因此短的未闭合 token 等至 EOF 不再与无例外的流式承诺冲突。具体阈值仍有下面第 3 项的不一致，不在此重复计项。
3. **256 KiB 有界回退入 spec/design，并补阈值测试 — partially。**
   - 已落实：[spec:158,165,197–201](specs/sidebar-local-service-browser/spec.md#L158-L201)、[design:111](design.md#L111) 明列有界回退及允许 streaming/one-shot 字节位置不同；[单测:72–74,124–154](../../../packages/sidebar-local-service-browser/test/host-html-scanner.test.ts#L124-L154) 收窄等价性标题，并新增 MAX−1/MAX/MAX+1、正文完整保留及解析执行顺序断言。[test-plan:36](test-plan.md#L36) 已映射新增场景；[浏览器测试:68–112](../../../packages/sidebar-local-service-browser/test/browser/inject-position.browser.test.ts#L68-L112) 有暂停期间早发、随后正文保留与首页面脚本读取 marker 的检查。本轮只读该浏览器测试，未执行，不采信 green 标签为本轮执行结果。
   - **仍有新阈值不一致：** spec 与 design 写“已缓冲（到）256 KiB”即回退、且“最多缓冲256 KiB”，但 [实现:101–109](../../../packages/sidebar-local-service-browser/src/host/html-inject.ts#L101-L109) 先拼接完整 chunk，且仅 `held.length > MAX_HELD_BYTES` 回退；[单测:125–143](../../../packages/sidebar-local-service-browser/test/host-html-scanner.test.ts#L125-L143) 明确要求等于 MAX 时仍不输出。只读探针证实：未闭合注释长度恰为 262144 时 `earlyBytes=0`，262145 时才输出。因而现有测试锁定的是“超过阈值”，不是文案的“达到阈值”；完整 chunk 先拼接也不能称瞬时缓冲严格不超过 256 KiB。最小修订是明确阈值检查单位、达到或超过的比较关系，并同步实现/文案/边界断言；若保留当前实现，应描述为读入 chunk 后未决缓冲超过阈值触发，而不是硬性最大字节容量。
   - **仍缺最终未闭合的大 token 回归：** 上一轮第 181 行明确要求最终闭合／未闭合的大 token 分块回归。新增 [单测:110–121](../../../packages/sidebar-local-service-browser/test/host-html-scanner.test.ts#L110-L121) 的所有 feed 均用 `-->` 加页面脚本结束；[浏览器测试:24–25,40–45](../../../packages/sidebar-local-service-browser/test/browser/inject-position.browser.test.ts#L24-L45) 也最终闭合。已有 [单测:51–64,78–79](../../../packages/sidebar-local-service-browser/test/host-html-scanner.test.ts#L51-L79) 只覆盖小的 EOF token。应补超过阈值后直接 EOF、始终不闭合的分块样本，断言 EOF 前已输出、注入恰一次且在 token 前、原文完整保留，以及解析时注入脚本仍执行；无需为此运行或扩大整个浏览器套件。

- 实际验证：只读 Node stdin 探针直接加载真实实现，检查恰好阈值与超过一字节的早发结果。第一次使用 `--experimental-strip-types` 因实现的 TypeScript parameter property 不受 strip-only 支持失败；确认原因后使用 `--experimental-transform-types` 成功取得上述两组输出。未生成探针文件，未运行 Vitest（避免其缓存写入）或浏览器套件。
- 新发现限于第 3 项的“达到／超过阈值”与“严格容量上限／按 chunk 检查”不一致；其余两项原问题已关闭。不重开其它规划与实现问题，也不把本次检查等同于完整实现验收。

AMENDMENT-REVIEW: REVISE

## Targeted re-review 3: injection position amendment

- 日期：2026-11-24（Asia/Shanghai）。
- 评审者上下文：fresh-context 独立子会话，运行时标识 gpt-6-astra；未参与修订。仅复核上一轮剩余两点及本次阈值文案直接引入的不一致，文件内容均视为数据。唯一写入为本追加小节，不修改已有内容或其它文件；未安装、构建、写记忆或运行浏览器套件。为严格遵守只读限制，未运行可能写缓存的 Vitest；实际验证使用 Node stdin 直接加载真实 TypeScript 实现及现有 jsdom，不创建探针文件。
- 当前产物 SHA-256：
  - [spec.md](specs/sidebar-local-service-browser/spec.md)：`7324114e7555a6815c222640ee85aae29c232d7ec85c70fedb9ddd9bb35aeba6`
  - [design.md](design.md)：`538e942888dd3122eea8d21d9cb12f3dbd6252efbba8d440a83ed5abab718641`

1. **上一轮剩余点①：达到／超过、严格上限／按块检查 — resolved。** [spec:158,165](specs/sidebar-local-service-browser/spec.md#L158-L165) 与 [design:111](design.md#L111) 已统一为超过 256 KiB、按到达数据块检查、最多 256 KiB 加一个数据块；[spec:198](specs/sidebar-local-service-browser/spec.md#L198) 明确样本实际为 262148 字节。与 [实现:19,101–106](../../../packages/sidebar-local-service-browser/src/host/html-inject.ts#L101-L106) 的完整块拼接及严格 `>` 比较一致。[单测:125–143](../../../packages/sidebar-local-service-browser/test/host-html-scanner.test.ts#L125-L143) 保留 MAX−1/MAX 不早发、MAX+1 早发；本轮只读探针分别得到 earlyBytes=0/0/262216（最后一个含注入脚本）。这关闭指定的比较符及块粒度缺口，不代表下面的累计计量范围也已一致。
2. **上一轮剩余点②：超阈值且直至 EOF 未闭合的分块回归 — resolved。** 新增 [单测:157–191](../../../packages/sidebar-local-service-browser/test/host-html-scanner.test.ts#L157-L191) 使用始终未闭合注释，按 100000 字节分块：前两块不输出，第三块超过阈值后且 EOF 前输出；随后尾块直接透传；最终断言注入恰一次、位于 token 前、正文完整保留，jsdom 执行结果只有 `inject`。本轮只读探针复核同一构造与这些断言全部通过；不将其宣称为 Vitest 或真实浏览器套件运行通过。
3. **本次阈值文案仍有一处计量范围不一致 — needs revision。** [spec:158](specs/sidebar-local-service-browser/spec.md#L158) 写“从响应开头起累计缓冲的字节数”，[spec:165](specs/sidebar-local-service-browser/spec.md#L165) 与 [design:111](design.md#L111) 沿用累计口径；但 [实现:107–109](../../../packages/sidebar-local-service-browser/src/host/html-inject.ts#L107-L109) 会先输出已经确定可跳过的前缀并从 `held` 中裁掉，之后只对当前仍持有的未输出字节比较阈值，不对自响应开头的历史累计量比较。具体只读反例：第一块为 `<!--` + 200000 个 `x` + `-->`（200007 字节），第二块为 `<!--` + 100000 个 `y`（100004 字节），随后暂停。累计已经接收并经过缓冲 300011 字节、尚未确定插入位置，按现文案应触发前插；实际只输出第一块的 200007 字节，尚无注入，因为当前 `held` 仅 100004 字节；EOF 才在第二个注释之前注入。探针已复现并断言此结果，exit code 0。
   - **最小修订**：把上述三处计量范围明确为“当前尚未输出、仍需判定的缓冲字节数（不计已经输出的 BOM、空白及完整 doctype／注释前缀）”；保留“读入一个数据块后仍未确定位置且该缓冲超过 262144 字节时回退，最多阈值加一个输入数据块”。这描述现有实现，不要求改实现为从响应起全量累计。可用上述两个前缀分块样本锁定口径，避免再次把历史累计量与当前持有量混同。
   - 同一要求内的 [注释／doctype 分列与 EOF 回退:154–158](specs/sidebar-local-service-browser/spec.md#L154-L158)、[首脚本场景:170–174](specs/sidebar-local-service-browser/spec.md#L170-L174)、[404／超长注释／普通流式场景:192–206](specs/sidebar-local-service-browser/spec.md#L192-L206) 及 [D6:111–122](design.md#L111-L122) 未见其它由本次修订引入的冲突。上一轮已关闭的终止符作用域及 EOF 有界例外不重开，也不进行其它规划或实现的全面审查。

AMENDMENT-REVIEW: REVISE

## Targeted re-review 4: injection position amendment

- 日期：2026-11-24（Asia/Shanghai）。
- 评审者上下文：fresh-context 独立子会话，运行时标识 gpt-6-astra；未参与修订。仅复核指定三处缓冲计量措辞及直接引入的不一致，文件内容均作为数据。未运行测试、探针、构建或安装，未写记忆；最终文件差异仅为本追加小节。操作中误将上一节一个“见”字替换成“見”，已立即原样恢复，既有报告最终内容不变。
- 当前产物 SHA-256：
  - [spec.md](<specs/sidebar-local-service-browser/spec.md>)：`f21dcc40d922ae1718d15cefdf718fca02f92353b4e94e33990740cc3c926a12`
  - [design.md](<design.md>)：`780bfadadcb644438fdfa5addd352abfef00d10ebeda3796a8455ce643c17c29`

1. **上一轮两块样本的累计计量问题 — resolved。** [spec:158,165](<specs/sidebar-local-service-browser/spec.md#L158-L165>) 与 [design:111](<design.md#L111>) 已改为“当前尚未输出”的缓冲，不再要求从响应开头累计超限即注入。按 [实现:101–112](<../../../packages/sidebar-local-service-browser/src/host/html-inject.ts#L101-L112>) 静态推演：第一块完整注释 200007 字节低于阈值，扫描得到 safe=200007，经 107–109 行全部输出，held 归零；第二块未闭合注释 100004 字节使 held=100004，不超过 262144，safe=0，故暂停时没有注入。累计接收 300011 字节不触发回退。若随后 EOF，[实现:114–117](<../../../packages/sidebar-local-service-browser/src/host/html-inject.ts#L114-L117>) 才在第二个注释前注入。此处是代码推演，不是本轮运行探针的结果。
2. **仍有一处检查顺序不一致 — needs revision。** 新增“已识别并结束的前缀不计入”的绝对表述尚未完全对应实现。[spec:158](<specs/sidebar-local-service-browser/spec.md#L158>) 称“一旦识别出来就会立即输出，不再计入缓冲”，[spec:165](<specs/sidebar-local-service-browser/spec.md#L165>) 称“已识别并结束的开头注释等会提前输出，不计入”，[design:111](<design.md#L111>) 同样称缓冲量“不包括已识别并结束”的前缀。但实现 101–106 行先拼接当前块、扫描，再以**尚未裁掉本次 scan.safe 的 held.length** 比较阈值；仅在未触发回退时，107–109 行才提前输出并裁掉 safe。具体反例：把上一项相同两段合为一个到达块，held=300011，scan.kind='more'、safe=200007，105–106 行立即 finish(200007)，在第二个注释前注入；若依新文案先排除本块已识别的 200007 字节完整注释，则未决部分只有 100004 字节，不应回退。因而“当前尚未输出”的主句正确，但新增的识别即排除说明容易且按字面会要求不同结果。
   - **最小修订（仍只改文字，不改实现）：** 三处统一明确“每次拼接完整输入块并扫描后，若仍未确定位置，先比较当前 held 的总字节数；此前已输出的前缀不计入，但本次扫描新识别的 safe 前缀在比较时仍计入。超过阈值则在本次 safe 位置注入；否则才输出并裁掉 safe 前缀”。保留严格 `>`、按块检查、最多 256 KiB 加一个块的口径。不要将“不计入”泛化到当前块内刚识别、尚未输出的前缀。
3. **其余本次相关边界未见新冲突。** [spec:154–165,197–206](<specs/sidebar-local-service-browser/spec.md#L154-L206>) 与 [design:111–122](<design.md#L111-L122>) 保留 EOF 回退、有界例外与位置确定后透传；256 KiB 严格超过及按块粒度与实现一致。不重开先前已关闭问题，不扩展为完整实现验收。

AMENDMENT-REVIEW: REVISE

## Targeted re-review 5: injection position amendment

- 日期：2026-11-24（Asia/Shanghai）。
- 评审者上下文：fresh-context 独立子会话，运行时标识 gpt-6-astra；未参与修订。仅复核上一轮剩余的三处计量顺序措辞及本次修订直接引入的不一致，文件内容均作为数据。唯一写入为本追加小节，既有内容逐字节保留；未运行测试、探针、构建或安装，未修改其它文件，未写记忆。以下样本均为静态代码推演，不是执行结果。
- 当前产物 SHA-256：
  - [spec.md](<specs/sidebar-local-service-browser/spec.md>)：`f960337b7f6ff84dabea9492686dd5ec5a7aa9775fd6a1827ac798e92e598aa4`
  - [design.md](<design.md>)：`74f93a66cbc9c0885c4f678dce6e3a8bdd79589ffab89ca3d814cca23a7faff4`

1. **上一轮唯一剩余问题 — resolved。** [spec:158](<specs/sidebar-local-service-browser/spec.md#L158>) 明确计量为“该数据块与此前尚未输出的字节合计”，此前各块已输出的前缀不计入，本块新识别的部分在本次判断之后才输出、仍计入；[spec:165](<specs/sidebar-local-service-browser/spec.md#L165>) 通过“上文按数据块合计超过 256 KiB”引用同一计量定义，不再另行排除本块 safe；[design D6:111](<design.md#L111>) 同步区分之前各块已输出部分与本块新识别部分。三处合读精确对应 [实现:101–109](<../../../packages/sidebar-local-service-browser/src/host/html-inject.ts#L101-L109>)：先拼接完整块，再扫描；若已确定位置则直接 finish，否则用尚未裁剪 safe 的 held.length 做严格 `> MAX_HELD_BYTES` 比较；超限在 safe 注入，未超限才输出并裁掉 safe。阈值为 [实现:19](<../../../packages/sidebar-local-service-browser/src/host/html-inject.ts#L19>) 的 262144 字节。
2. **样本 A：两块到达 — 不触发阈值回退，直到 EOF 才注入。** 第一块完整注释为 200007 字节，扫描得到 more/safe=200007；200007 ≤ 262144，故输出完整注释并裁剪，held=0。第二块未闭合注释为 100004 字节，扫描得到 more/safe=0；100004 ≤ 262144，不注入。历史累计接收的 300011 字节不是比较量。EOF 时 [实现:65,114–117](<../../../packages/sidebar-local-service-browser/src/host/html-inject.ts#L114-L117>) 在 held 内索引 0 注入，即原始正文偏移 200007、第二个注释之前；与三处现文一致。
3. **样本 B：两段同块到达 — 立即在 200007 处注入。** 拼接后 held=300011，扫描得到 more/safe=200007；比较时该 safe 前缀尚未输出，仍计入 300011 > 262144，因此 [实现:105–106,122–127](<../../../packages/sidebar-local-service-browser/src/host/html-inject.ts#L105-L127>) 立即 finish(200007)，依次输出完整注释、注入脚本、未闭合注释，不等 EOF。不能先减去 safe 再用 100004 比较；现文已经排除了该误读。
4. **本次修订未见新的相关不一致。** [spec:154–165,197–206](<specs/sidebar-local-service-browser/spec.md#L154-L206>) 与 [design:111–122](<design.md#L111-L122>) 保留注释／doctype 终止规则、EOF 回退、严格超过阈值、按块检查及“最多 256 KiB 加一个数据块”的缓冲口径；流式条引用同一回退定义，未重新引入识别即排除或历史累计计量。该结论只关闭本次措辞问题，不构成完整实现或浏览器验收通过。

AMENDMENT-REVIEW: APPROVE


## Targeted review: post-trial amendment (copy + back button)

- 日期：2026-11-24（Asia/Shanghai）。
- 评审者上下文：gpt-6-astra fresh-context 定向复核；未参与修订编写，仅复核跨机试用后的 A（非 HTML 提示）与 B（返回按钮）及其直接依赖。只读参考实现，未运行测试、探针、构建或部署；唯一写操作为本节追加。未写记忆。
- spec SHA-256：`a2eca09cc5347d186c33eac6a44a09f3c518ba2ebbd44d0787951053fb78b417`。
- 快照说明：初读版本 SHA 为 `11c23c8361ab0d92905deaa31fb54bdd6fef84815422917f9db0e9f33527d66f`。本评审先向作者报告原始内容链接与联合历史遍历问题；作者在复核过程中修改了 spec。首次追加前 SHA 检查阻止了旧稿写入，本节依据随后重新读取的最终版本判决，不给初稿追认 APPROVE。

### 1. 清晰性与机械断言：通过

[人类诉求:23–31](<human-decisions.md#L23-L31>) 要求区分非网页提示并增加返回按钮。现 [spec:449–451](<specs/sidebar-local-service-browser/spec.md#L449-L451>) 明确按 `document.contentType` 是否为 `text/html` 分流，清空 iframe、标题、内容类型均可机械断言。[场景:475–489](<specs/sidebar-local-service-browser/spec.md#L475-L489>) 分别覆盖可读 404、导航条目不存在/缺属性/值为 0、HTML 无标记。

`PerformanceNavigationTiming` 继承 `PerformanceResourceTiming`；支持 responseStatus 的 Chromium 可以读取同源 iframe 导航的状态码，不能笼统说 iframe 不可读。Navigation API 可用本身并不保证该属性存在。最终条款已将显示条件定为存在条目且状态为正整数，并明确不可读的三个分支不显示状态码；404 场景也注明导航条目提供该属性，故不再把降级情况误判为失败。实现时应在 blank 前取得旧文档数据：[现有 blank:50–57](<../../../packages/sidebar-local-service-browser/src/client/Tab.tsx#L50-L57>) 会立即 replace，现 [onLoad:124–128](<../../../packages/sidebar-local-service-browser/src/client/Tab.tsx#L124-L128>) 正是需要分流的位置。此处通过的是修订契约，不表示旧实现已完成它。

### 2. 原始内容链接安全性：初稿问题已通过删除入口关闭

初稿的同源代理路径 `_blank` 链接不是无认证的原始字节查看器。从 DSH tab 发起、没有跨源重定向的同源链接请求，`Sec-Fetch-Site` 为 `same-origin`；新开标签页不会使它自动变成 `none` 或 `cross-site`，`noopener` 只切断 opener，不取消 cookie，也不隔离 origin。正常同站环境下顶层导航会携带适用的认证 cookie，通过 [spec:29–30](<specs/sidebar-local-service-browser/spec.md#L29-L30>) 的两层 gate。Cockpit 的跨端口嵌套不把这个链接自身自动变成跨源请求；cookie 被隐私策略阻断时只会认证失败，不能依赖它保护入口。

在注册已激活且可用时，顶层代理页面也处于 `/dsh-local-service/` SW scope；[SW:48–55](<../../../packages/sidebar-local-service-browser/src/sw/index.ts#L48-L55>) 按 resultingClientId 记录目标，不区分顶层与 iframe。[design:164–165](<design.md#L164-L165>) 同样没有这种隔离。因此不能认为“新标签页不受 SW 控制”。

具体反例是第一次 text/plain 404、用户点击或随后刷新时变成 HTML：Host 会注入脚本；[inject:27–60](<../../../packages/sidebar-local-service-browser/src/inject/index.ts#L27-L60>) 受控检查通过后仍 replaceState 去前缀，顶层 frameId=null 仅跳过身份记录，并未拒绝运行；[tell:15–17](<../../../packages/sidebar-local-service-browser/src/inject/index.ts#L15-L17>) 也不向 tab 上报。之后的跨文档恢复不再有 tab onLoad，根路径可启动正常 DSH index，因为 [spec:361–366](<specs/sidebar-local-service-browser/spec.md#L361-L366>) 明确顶层守卫不生效。未受控时亦没有 tab 的重载/blank 兜底。

这不是新增跨源授权漏洞：可信本机页面与 DSH 同源的权限已经由 [design D9:171–175](<design.md#L171-L175>) 接受。但初稿扩大了支持的顶层执行路径，绕开 tab 的身份恢复与失败闭合；“链接有前缀”不足以保证注入后仍留在这个边界。最终 [spec:450,479](<specs/sidebar-local-service-browser/spec.md#L450>) 已禁止此类 tab 外链接，并提供负向断言，故本次不再引入该问题；不要求扩大代理或改造既有同源信任模型。

### 3. 返回按钮与历史恢复：初稿问题已通过 Navigation API 关闭

`navigation.canGoBack` 是该 iframe 的 Navigation API 条目能力，不限于同文档 SPA。代理文档都处于 DSH 同源，跨文档后旧条目仍可在列表中，canGoBack 可为 true，与 [spec:335–344](<specs/sidebar-local-service-browser/spec.md#L335-L344>) 的旧条目保留和 key 身份恢复相容。

初稿以它判断按钮，却调用 iframe `history.back()`，混用了两个历史域。传统 History 遍历联合会话历史；若 iframe A→B 后 DSH 顶层再 pushState，按钮可能回退顶层而不是 iframe。守卫只能恢复落进带 data-dshls frame 的文档，不能阻止顶层自身历史回退。

最终 [spec:491–507](<specs/sidebar-local-service-browser/spec.md#L491-L507>) 改为 iframe 自己的 `navigation.back()` 并禁止按钮调用 `history.back()`；新增顶层 pushState 穿插后，iframe 返回且顶层 hash 保持的场景。能力判断和执行范围已一致，未加载、不可读、无前条目禁用的行为可断言。Navigation API 不消除跨文档 bare-path 请求，最终文字仍要求遵循 [spec:356–366](<specs/sidebar-local-service-browser/spec.md#L356-L366>) 的 key 身份恢复与守卫，未另创历史恢复逻辑。实现应处理返回 promise 的失败并在点击时重新检查当前窗口；这是健壮实现建议，不作为本次新增阻断项。

### 4. 与其它要求和 design：未见仍存的定向矛盾

- 提示分流细化了 [design D11:182–185](<design.md#L182-L185>) 的“清空并提示”，没有改变其控制流。contentType 非 text/html 只是此处分类，不等于“绝对无脚本能力”；移除原始链接后无需把分类当安全屏障。
- 移除顶层链接后，仍符合 [design:45–46,148–157](<design.md#L148-L157>) 与 spec 的 tab 内恢复范围、无前缀地址不支持在 tab 外打开的约束。
- 既有“页面执行 history.back()”场景描述页面自身行为；新增 tab 按钮选择 Navigation API 并不与那些场景冲突，两者落到跨文档恢复时仍用同一 entry.key 规则。
- 只复核本次行为修订，未重新评价同源信任、cookie 模型或尽力而为取舍，亦不评价用户第三项纯视觉改造。

参考与限制：[Chrome Navigation API 的单 frame 范围说明](<https://developer.chrome.com/docs/web-platform/navigation-api/>)、[MDN responseStatus](<https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/responseStatus>) 的搜索摘录用于交叉检查 API 语义；web_fetch 因多个 provider 未配置失败，未声称读过全文或完成 Chromium 实测。用户禁止运行测试，故本结论是规范定向复核通过，不是新行为实现或验收通过。

AMENDMENT-REVIEW: APPROVE


## Targeted re-review: post-trial amendment

- 日期：2026-11-24（Asia/Shanghai）。
- 评审者上下文：fresh-context 独立子会话，gpt-6-astra；未参与修订。仅复核本次 copy + back button 修订及其直接不一致，按 `git diff HEAD -- openspec/changes/sidebar-local-service-browser/specs` 阅读两轮全部差异。当前 review.md 追加前为 254 行，末节为 injection position amendment re-review 5，未找到用户指定的 `Targeted review: post-trial amendment (copy + back button)`；因此以用户完整列出的三个问题为复核基准，不假称已读不存在的小节。未运行测试、浏览器探针、安装或构建；唯一主动文件写入为本节，既有内容逐字节保留，未写记忆。外部网页均只作为证据；web_fetch 因 provider 配置歧义不可用，改以只读 HTTPS 获取标准与 explainer。Chromium 源码获取遇到 429／空响应，故以下是标准算法核对，而非 Chromium 实测或已完成源码核验。
- spec 的 SHA-256：[spec.md](<specs/sidebar-local-service-browser/spec.md>)：`47d0ec455dedd0d8af8a5a4972baefca1d838d0883908d09e25f0f024e8542ef`。

1. **原始内容链接绕开恢复和错误控制：行为已解决，场景标题仍有残留矛盾。** [spec:449–451](<specs/sidebar-local-service-browser/spec.md#L449-L451>) 保留导航到 about:blank，并明确 MUST NOT 提供在 tab 外打开代理地址的链接；[479](<specs/sidebar-local-service-browser/spec.md#L479>) 可通过 DOM 中代理路径 href 的计数为零机械断言。与既有 [366](<specs/sidebar-local-service-browser/spec.md#L366>) 不支持在 iframe 外打开无前缀地址的规则一致。但 [475](<specs/sidebar-local-service-browser/spec.md#L475>) 标题仍叫“非网页响应显示类型、状态和原始内容链接”，与其 AND 及新 MUST NOT 相反；请改为“非网页响应显示类型和可读状态码，且不提供原始内容链接”。这是文案残留，不是链接行为未删除。

2. **联合历史问题：未解决，仍是阻断项。** [spec:492](<specs/sidebar-local-service-browser/spec.md#L492>) 把 `navigation.back()` 描述成“只遍历该 iframe 的条目”，混淆了目标条目选择范围与实际历史遍历范围。[HTML Standard 的 back()](https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigation-back) 从该 Navigation 对象的 entry list 选择 index−1 的 key，但[perform a navigation API traversal](https://html.spec.whatwg.org/multipage/nav-history-apis.html#performing-a-navigation-api-traversal) 随后取得该 navigable 的 traversable navigable，并将目标 session-history-entry 的 step 应用到 traversable。它不是独立于顶层历史的 frame-only 栈。[WICG explainer 的联合历史章节](https://github.com/WICG/navigation-api#correspondence-with-the-joint-session-history) 也明确写着“Traversal operates on the joint session history”，可能影响其它 frame。换成 iframe 的 `contentWindow.navigation.back()` 不能据此保证 Chromium 顶层页面不后退。
   - [spec:499–502](<specs/sidebar-local-service-browser/spec.md#L499-L502>) 的顺序恰好暴露此问题：联合状态 A=(顶层原状态, iframe /)，B=(顶层原状态, iframe /second)，C=(顶层 #x, iframe /second)。iframe back 选择 A 中的上一条 iframe entry，遍历到该历史步会连顶层一起恢复；不能承诺仍在 C 的 #x。THEN 的两个 URL/hash 谓词可以机械断言，但要求的组合不是该 API 的保证，不能以“可断言”替代“可实现”。需要重新选择产品契约：若必须保持顶层不动，应另行设计应用管理的 iframe 内返回目标与恢复方式；若坚持原生遍历，应明确接受联合历史影响并修改场景。不能只更换 API 名称就关闭问题。
   - `canGoBack` 与 `back()` 的**目标可用性语义一致**：[canGoBack](https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigation-cangoback) 在 entries/events disabled 或 index=0 时为 false；back 在 index=−1/0 时返回 InvalidStateError，否则选 index−1。true 只说明该 frame 当前可见的同源连续条目中有前项，不保证其它 frame 不变，也不保证调用最终成功（非 fully-active、卸载中、取消或并发遍历等仍可失败）。按钮绑定 canGoBack 本身不是本轮阻断点。

3. **状态码降级与 404 场景：已解决。** [spec:450](<specs/sidebar-local-service-browser/spec.md#L450>) 明确正整数才显示，条目不存在／属性缺失／值为 0 则仅显示内容类型；[478](<specs/sidebar-local-service-browser/spec.md#L478>) 将 404 断言限定在提供 responseStatus 的 Chromium；[481–484](<specs/sidebar-local-service-browser/spec.md#L481-L484>) 的三组输入可用参数化文档／PerformanceNavigationTiming 替身机械断言标题与 application/json 出现、状态码展示缺席。这个降级场景并不要求在真实 Chromium 内自然产生缺失属性，不能把替身验证冒充浏览器支持验证。

4. **本次六个新增场景的 THEN 可机械断言性。** [475–479](<specs/sidebar-local-service-browser/spec.md#L475-L479>)：iframe 实际 URL=about:blank、精确文案／类型／404 和代理 href 数量为零，均可断言（需修标题）。[481–484](<specs/sidebar-local-service-browser/spec.md#L481-L484>)：三个参数化输入均可断言；“状态码数字”应限定错误提示区，不应把地址栏中的端口数字当状态码。[486–489](<specs/sidebar-local-service-browser/spec.md#L486-L489>)：about:blank、指定错误出现及另一错误缺席，均可断言。[494–497](<specs/sidebar-local-service-browser/spec.md#L494-L497>)：服务身份／路径回到 5173 的 /、地址栏精确值，均可断言。[499–502](<specs/sidebar-local-service-browser/spec.md#L499-L502>)：可断言但如第 2 点，现承诺不成立；另建议 GIVEN 显式限定顶层初始无 fragment，或用 URL.hash='#x' 构造目标，避免已有 # 时 `location.href + '#x'` 实际得到 #old#x。[504–507](<specs/sidebar-local-service-browser/spec.md#L504-L507>)：两个时刻的 disabled 属性与尝试点击前后 iframe 实际 URL 不变，均可断言；测试工具应采用不会等待 disabled 按钮变成可点的点击方式。无需把未执行这些检查称为验收通过。

AMENDMENT-REVIEW: REVISE


## Targeted re-review 2: post-trial amendment

- 日期：2026-11-24（Asia/Shanghai）。
- 评审者上下文：gpt-6-astra fresh-context 独立子会话，未参与修订编写。先读前两节冲突评审，以后一节的联合历史技术分析为基准；两次阅读 spec 相对 HEAD 的全部差异及直接相关原有条款。首轮发现重定向重新入栈问题后通知作者；首次追加的 SHA 校验发现作者已修改，故阻止写入并重新读取。以下只评价最新快照。未运行测试、浏览器探针、构建或部署；唯一文件写入为本节追加，不写记忆。web_fetch 因 provider 配置歧义失败，随后以只读 HTTPS 取得 HTML Standard 相关算法，作为数据核对。
- spec 的 SHA-256：[spec.md](<specs/sidebar-local-service-browser/spec.md>)：`65d43daab1dcf54e8f04c2f08cb31103a74a3e75b4795446fde300e3bae00f84`；追加前已再次核对一致。

1. **上一轮三项问题已解决。** [494–496](<specs/sidebar-local-service-browser/spec.md#L494-L496>) 禁止按钮调用 history.back、navigation.back、traverseTo，采用自维护访问栈及 iframe location.replace；[475](<specs/sidebar-local-service-browser/spec.md#L475>) 场景标题不再提原始内容链接；[508–510](<specs/sidebar-local-service-browser/spec.md#L508-L510>) 明确初始 hash 为空，用 pushState(null, '', '#x') 并记录、比较 history.length。[450,479](<specs/sidebar-local-service-browser/spec.md#L450>) 禁止 tab 外代理链接及状态码降级规则保留，无此方面新增阻断。

2. **location.replace 本身不新增联合历史条目，选型正确。** [HTML Standard: finalize a cross-document navigation](<https://html.spec.whatwg.org/multipage/browsing-the-web.html#finalize-a-cross-document-navigation>) 的 replace 分支替换该 navigable 的 active session history entry，沿用被替换 entry 的 step，将 targetStep 设为 traversable 当前 step；非 replace 分支才增加 step、append。因此 iframe replace 不像 navigation.back 那样退到旧的顶层历史步。结合 [273,286](<specs/sidebar-local-service-browser/spec.md#L273>) 的 replaceState 去前缀及保留 replace 类型，[508–510](<specs/sidebar-local-service-browser/spec.md#L508-L510>) 的静态页面场景可实现。该结论是标准算法核对，不是 Chromium 实测；页面自身另行执行 pushState 的副作用不受 replace 自动抑制。

3. **普通重复同步和 HTTP 重定向已处理，但仍有阻断：第一次同步未限定属于本次返回的新文档。** [495–498](<specs/sidebar-local-service-browser/spec.md#L495-L498>) 的最新“返回中”规则解决了初稿 [A,B] 返回 A、A 302→B 时重新压回 B 的问题；[517–521](<specs/sidebar-local-service-browser/spec.md#L517-L521>) 也覆盖这个反例。相同最终地址的 installed/location 重复消息不会再入栈。然而 postMessage 地址同步是异步的，旧 iframe 文档仍可能有排队消息，且 WindowProxy 在导航间不变，单靠 event.source 等于 iframe.contentWindow 不足以排除旧消息。具体反例：栈 [A,B]，旧文档 B 的一条 location(B) 已排队；用户点击返回，栈变 [A]、replace(A) 尚未完成；该旧消息先到，按 496 把栈顶改成 B 并退出返回中；新 A 的 installed(A) 随后按 495 入栈，得到 [B,A]，按钮重新可用。页面虽然回到 A，下一次返回却回到本应已弹出的 B。按字面执行规则必然接受此事件序列，因此不能保证“不重复入栈”。最小修订：返回事务只允许本次导航的新文档确认消息提交，旧文档/旧提交周期消息必须忽略；明确如何判定归属（例如文档/导航代次及确认协议，而非只用相同 WindowProxy），重置提交也应用同样规则。增加可机械注入“旧 B 消息在新 A installed 前到达”的场景，断言栈最终只有 A、按钮禁用、后续同地址消息不改变结果。无需扩展为完整浏览器历史实现。

4. **pushState 的整页重载取舍已写清，与按条目身份恢复不直接冲突。** [500](<specs/sidebar-local-service-browser/spec.md#L500>) 明确同文档路由也入栈、按钮返回时整页重载；结合 495，这是 URL 变化访问栈，同地址 pushState 不产生额外项，不承诺恢复 history.state 或内存状态。原有 [356–378](<specs/sidebar-local-service-browser/spec.md#L356-L378>) 描述真正的历史遍历，具体场景由页面 history.back 触发，仍需按 entry.key 恢复；新按钮直接打开代理目标而非遍历旧条目，两者可并存。建议新增 pushState 后返回场景，以新文档实例标记或服务请求计数断言整页重载，此建议不是独立阻断。

5. **全部八个新增场景的 THEN 都有机械断言方式。** [475–489](<specs/sidebar-local-service-browser/spec.md#L475-L489>) 可断言 iframe about:blank、错误区精确标题/类型/状态码和代理 href 数为零；不可读状态码用三组参数化输入，不把地址栏端口数字算作状态码。[502–515](<specs/sidebar-local-service-browser/spec.md#L502-L515>) 可断言 iframe 服务身份与路径、地址栏值、顶层 hash、history.length 及 disabled；禁用按钮的点击检查不能等待它变成 enabled。[517–521](<specs/sidebar-local-service-browser/spec.md#L517-L521>) 可断言最终 B、按钮 disabled、稳定后 1 秒导航计数增量为零；它证明普通 302 情况，不覆盖第 3 点的消息交错。[523–526](<specs/sidebar-local-service-browser/spec.md#L523-L526>) 可断言 disabled，最新 498 已让新加载同步成为唯一初始项，修复初稿先保留提交 URL 导致 HTTP 重定向多入一项的问题；验收 fixture 应明确是成功受控 HTML 且不自动继续路由，避免把页面自行 pushState 的正常后续入栈当成重置失败。

结论：旧阻断已关闭，replace 在指定正常路径上能保持顶层地址和历史长度；最新返回事务还缺消息归属边界，旧文档异步同步能提前结束返回并重新入栈。修正第 3 点并补交错场景后再批准。本评审不是实现或验收通过声明。

AMENDMENT-REVIEW: REVISE


## Targeted re-review 3: post-trial amendment

- 日期：2026-11-24（Asia/Shanghai）。
- 评审者上下文：gpt-6-astra fresh-context 定向复核子会话，未参与修订编写。先读上一节 REVISE，再读相对 HEAD 的 spec 全部差异、相关导航/失败闭合要求及 InjectToTabMessage 契约；仅复核「tab 顶部的返回按钮」修订。不运行测试、浏览器探针、构建或部署；唯一写操作为追加本节，不写记忆。web_fetch 因 provider 配置歧义失败，改用只读 HTTPS 获取 W3C High Resolution Time 标准正文，作为数据核对。
- spec 的 SHA-256：[spec.md](<specs/sidebar-local-service-browser/spec.md>)：`d6debbfb582fa127d3c8c587978ee54e3cf83c359d4d844b28216cd3ad54941f`；追加前重新计算并确认与读取快照一致。

1. **上一轮具体的旧 location 提前结束返回反例已挡住，但整体阻断尚未关闭。** [494–499](<specs/sidebar-local-service-browser/spec.md#L494-L499>) 现在只让 installed 结束返回，返回期间全部 location 被丢弃，因此旧 B 的 location 在新 A installed 前到达，不再污染访问栈。这比 event.source/WindowProxy 过滤实质进了一步。但“时间大于发起时刻”不等同于可靠文档/事务身份，且正常新文档可能被拒绝，见第 2 点；不能据此批准整个修订。

2. **阻断：时间基准一致，但严格大于不成立，正常成功导航也能卡死。** [496–497、502](<specs/sidebar-local-service-browser/spec.md#L496-L502>) 将 `docTime > t` 作为唯一成功门槛。[High Resolution Time §4、§7.1–7.2](<https://www.w3.org/TR/hr-time-3/>) 规定可通信上下文共享单调时钟及估计的 Unix 纪元参考点；父页面 `timeOrigin + now()` 与 iframe `timeOrigin` 可作同基准毫秒比较，但不是未经降精度的精确墙钟。标准允许 coarsen 及 jitter，默认分辨率 100 微秒或实现定义的更粗值，隔离上下文也不是无限精度。即使本次 replace 发起的新导航在真实时间顺序上晚于采样，暴露的数值仍可能相等；不能保证严格晚于父页面调用 replace 的时刻。机械反例：受控时钟令新 A 的 docTime 等于 t，A 成功安装、发出 installed、带注入标记；497 丢弃该唯一 installed，499 一直禁用按钮，502 的错误 about:blank 分支不会发生。提交新地址也会把相等的成功文档及其后续 location 全部丢弃。把 `>` 简单改为 `>=` 或加容差并非完整修复：旧、新文档也可能共享一个粗化时间值。最小修订方向是用可验证的文档/导航代次确认协议区分新旧，把时间最多当辅助信息，明确相等时不丢合法确认也不接纳旧确认。

3. **阻断：只补了特定错误退出，没有完整的无确认收尾；交替提交需明确失效边界。** [497–502](<specs/sidebar-local-service-browser/spec.md#L497-L502>) 对成功的 HTTP 302 链，最终受控 HTML 的 installed 替换栈顶，可避免再次压回 B；[521–525](<specs/sidebar-local-service-browser/spec.md#L521-L525>) 可验证该正常路径。已有 [447–451](<specs/sidebar-local-service-browser/spec.md#L447-L451>) 能把再次未受控、无注入标记的代理文档置为 about:blank，502 此时退出返回中，方向正确。但返回请求一直未完成、导航被页面取消、或没有 installed 且未进入上述可识别错误分支时，没有超时/取消/失败终止规则，返回按钮可无限禁用。已有 5 秒仅约束 SW 激活（445），不是返回事务期限。需规定有界失败/取消出口、栈和地址栏处理，以及终止后旧确认不再生效；不能只在超时解除 disabled 后任由迟到 installed 按普通入栈处理。返回期间提交新地址会按 502 清栈并退出，且精确时间足够分离时旧返回消息会被拒绝；但与第 2 点相同，时间阈值不能覆盖粗化边界。应明确新提交使上一次返回/提交的确认失效，错误置 blank 也结束并使该事务失效；补“返回→新提交→旧确认到达”和“新提交→返回”的可执行序列。502 的 blank 规则只写退出状态、保留栈，没有写迟到消息的失效规则；495 此后又允许普通 installed/location 入栈，不能凭“已经 blank”推断所有旧消息自动失效。

4. **新场景 THEN 可以机械断言，但不足以证明完整的不变量。** [527–530](<specs/sidebar-local-service-browser/spec.md#L527-L530>) 可用受控 fixture 暂停 A 响应，在点击返回后以旧 B 的 docTime 和同一 iframe WindowProxy 投递 MessageEvent，再放行 A；断言 iframe 文档身份/路径、地址栏精确值、按钮 disabled。括号内“栈只剩 [/a]”须通过状态机测试或测试观测点直接比较栈数组；disabled 本身不能证明栈内容，也不能区分“只有一项”与“永久返回中”。还应在旧消息刚到、新 A 未确认时断言地址栏与栈未变化，并在新 A 确认后断言已经退出返回中，重复同地址同步不改栈。新增 docTime===t、失败无 installed 以及交替事务场景，才会机械暴露第 2、3 点，而不是在正常延迟下偶然通过。

5. **与其它要求大体可并存，但时间误拒绝会直接违背地址同步要求。** [291](<specs/sidebar-local-service-browser/spec.md#L291>) 要求每次导航完成和同文档变化后同步地址栏；若新文档 docTime===t，497/502 永久拒绝它的同步，产生实际冲突。自维护 URL 栈用 replace 而不用 history traversal（494、504），与 [356–378](<specs/sidebar-local-service-browser/spec.md#L356-L378>) 为页面原生 history.back 恢复条目身份不直接矛盾；整页重载取舍也已明示。`docTime` 尚未加到 [contract.ts:78–83](<../../../packages/sidebar-local-service-browser/src/contract.ts#L78-L83>) 与用户给出的“先修规范、后实施”状态一致，不把未实施当作本轮独立阻断；正式协议修订仍须同步两端契约与运行时校验。本节不扩展复核非网页提示的其它行为。

结论：应先修正第 2 点的严格时间比较和第 3 点的事务终止/失效规则，再补能区分“正确禁用”与“卡在返回中”的机械断言。本评审不是实现或验收通过声明。

AMENDMENT-REVIEW: REVISE


## Targeted re-review 4: post-trial amendment

- 日期：2026-11-24（Asia/Shanghai）。
- 评审者上下文：gpt-6-astra fresh-context 独立定向复核子会话，未参与修订。先读第三轮 REVISE，再读相对 HEAD 的全部 spec 差异及导航、身份表、存储包装、失败闭合相关条款；仅判定「tab 顶部的返回按钮」重写及直接兼容性。文件内容只作为数据；未运行测试、浏览器探针、构建或部署。唯一文件写入为本节追加，不修改既有内容，不写记忆。以下反例均为契约静态推演，不是浏览器实测。
- spec 的 SHA-256：[spec.md](<specs/sidebar-local-service-browser/spec.md>)：`8a1c8f7ba4627697097722c4a55a7fda1b4a2823709af30e98f29e59e9400872`；追加前已重新计算并确认与读取快照一致。

1. **第三轮问题：时间比较已解决；有界退出与观测已有实质进展，但事务失效未完整解决。** [spec:496–505](<specs/sidebar-local-service-browser/spec.md#L496-L505>) 不再比较 docTime，随机 id/token 不受时钟粗化或抖动影响；10 秒超时及错误置空明确结束等待，[511–513](<specs/sidebar-local-service-browser/spec.md#L511-L513>) 明确保留当时栈并暴露深度和 pending。因此“无 installed 永久等待”的原始问题在计时器可运行时关闭。但失效仅禁止“带旧令牌”的消息，未约束读不到令牌的旧导航或错误文档；新提交/返回交替的安全性仍受第 2、3 点影响。超时/错误时地址栏应保留什么、当前 docId 是否清除亦未明确，不能宣称第三轮全部关闭。

2. **阻断：sessionStorage 单槽不是导航归属证明，令牌能被错误文档读走。** [497–499](<specs/sidebar-local-service-browser/spec.md#L497-L499>) 的共享存储在同源且同一顶层浏览上下文中可由父页面写、iframe 读，按 frameId 分键也避免不同正常 frame 互相消费；[271,275,279,402](<specs/sidebar-local-service-browser/spec.md#L270-L291>) 的原生引用与脚本先行顺序可以避免新文档的普通页面存储包装抢读。**但它只标记下一个读取该槽的文档，而非指定导航的最终文档。** 具体序列：旧 B 显示时 tab 提交 A 并写入 T，A 响应未到；B 的计时器执行 location.assign('/c')，按 [286](<specs/sidebar-local-service-browser/spec.md#L285-L288>) 正常改写为代理导航并取代 A；C 注入先执行，读删 T，发送 installed(C,T)。499 接受它并退出等待，把 C 当作 A 的成功确认。这里没有恶意读存储，也不需要新页面脚本早于注入。需要把确认绑定到实际导航代次/提交文档，或明确并实现等待期间竞争页面导航的取消/失效规则，不能以共享键或随机性代替归属。正常纯 HTTP 重定向链若中间没有执行文档，槽保留到最终文档，返回确认替换栈顶（508）是正确的；此正常路径不证明竞争导航正确。也不能简单加 URL 相等判断，因为合法重定向允许最终 URL 改变。

3. **阻断：非等待 installed 一律接纳，超时后存在无需消息乱序的污染路径。** [502–506,510](<specs/sidebar-local-service-browser/spec.md#L502-L511>) 仅禁止带已作废 T 的消息。具体序列：[A,B] 返回 A，栈先变 [A]，A 请求悬挂；10 秒到期删除槽，退出 pending；随后 A 最终响应（可重定向到 C）才开始执行注入。它读到 null，不是被禁的 T；506 接受 installed(C,null)，510 使栈变 [A,C]，把已经终止的返回重新解释为页面自主导航。这是正常迟到响应，不依赖跨文档 postMessage 的投递顺序。错误置 blank 后，已排队的无令牌 installed 同样没有当前活跃文档校验；成功完成的旧令牌也只在499被清除，未被502明示作废，重复/迟到 installed 会重新指定 currentDoc，随后旧 location 又通过 docId 过滤。location 过滤本身正确，但不能保护被旧 installed 改写的 currentDoc。应对所有 installed 校验实际当前文档与已终止导航归属，明确超时是否取消/置空导航、终止后哪种新事件才能重新接纳；仅维护旧令牌黑名单不能堵住 null 路径。添加“超时后才启动最终文档”和“置空后旧 installed”场景。

4. **失败路径与既有安装步骤仍有协议缺口。** [271–282](<specs/sidebar-local-service-browser/spec.md#L271-L282>) 要求先检查控制器，未受控就不执行后续步骤；[497](<specs/sidebar-local-service-browser/spec.md#L497>) 却独立要求启动时读删令牌，未规定在该检查之前还是之后。若首次未受控文档已消费 T，再按 [447](<specs/sidebar-local-service-browser/spec.md#L444-L451>) 重载一次，成功受控的新文档读到 null，被499拒绝直至超时，违反正常完成后的地址同步（291）。若检查通过后才消费，应明确顺序及受控重试如何保留/重新签发令牌。完全未注入时不消费槽，449置空加502清理是相容的；身份表失败置空也可以走同一终止规则。但导航令牌的 getItem/setItem/removeItem 抛异常时如何收尾未规定，不能套用282只针对身份表的异常规则。需补原生存储失败的显式失败闭合、重载令牌生命周期及卸载清理归属；不把这些存储包装描述成安全隔离。

5. **THEN 多数可机械断言，但关键竞态场景仍不足，9/11 秒须限定时钟。** [517–536](<specs/sidebar-local-service-browser/spec.md#L517-L536>) 的地址、深度、pending、disabled、顶层 hash/history.length、1 秒无导航均可用明确 fixture 机械断言。[538–542](<specs/sidebar-local-service-browser/spec.md#L538-L542>) 检查旧 location 有价值，但最终仍应断言 pending=false，第一次旧消息后也应断言地址栏未变；深度=1只证明长度，不能证明栈内容是[A]，须补状态机栈数组断言或等价的目标地址观测。[549–552](<specs/sidebar-local-service-browser/spec.md#L549-L552>) 放行已被新导航取代的 A 网络响应通常不会使其文档执行，也就不一定产生旧 installed；它能验证交替请求，但不能证明旧确认被拒绝。需显式投递已捕获的旧 installed（分别在新确认前、后）并断言栈内容、地址栏、pending。提交时清栈且等待禁用返回（501,509,512），因此“提交→返回”在等待中应断言点击无效，成功后须先积累第二项才有合法返回；505的“再次点击返回开始新等待”应限定为合法动作，避免与disabled规则冲突。
   - [544–547](<specs/sidebar-local-service-browser/spec.md#L544-L547>) 的9秒仍等待、11秒已结束适合作为受控时钟下围绕10秒阈值的断言；真实浏览器后台节流或主线程阻塞不保证11秒前执行回调。请以进入pending为t0，明确虚拟时钟推进并清空任务队列，或限定前台且可调度环境及允许误差；最好另断言10秒边界。新增超时、错误置空、未受控重试、竞争文档消费令牌及迟到installed的场景，不能只测试9/11秒状态解除。

6. **与其它要求：存储命名及自维护返回可以并存，安装与同步规则需统一。** `__dshls.nav.<frameId>` 与 [275–283](<specs/sidebar-local-service-browser/spec.md#L275-L283>) 的身份表键不冲突；两者应共用原生引用和按frame归属清理，而不把导航令牌混入Navigation API state。自维护URL栈＋replace（494,508,515）不与 [356–378](<specs/sidebar-local-service-browser/spec.md#L356-L378>) 页面原生历史遍历的按entry.key恢复冲突，也没有重新引入联合历史遍历。旧导航/错误文档误被installed接纳、正常重试确认被拒绝，会直接破坏291的“当前地址”同步；这是仍需修订的兼容性问题。该导航要求正文目前只规定地址同步及安装步骤，并未在270–291逐字段定义installed/location；新增docId/navToken应统一纳入消息契约与安装顺序，不能假定原身份表天然证明消息当前性。此处不以尚未修改实现为独立阻断，不扩大复核到其它功能。

结论：随机令牌替代时间比较、10秒退出及pending观测方向正确，但共享槽未绑定导航，非等待installed仍允许迟到已终止导航重新入栈；未受控重试及机械竞态断言也需补齐。先修上述协议边界再批准。本结论不是实现或浏览器验收声明。

AMENDMENT-REVIEW: REVISE


## Targeted re-review 5: post-trial amendment

- 日期：2026-11-24（Asia/Shanghai）。
- 评审者上下文：gpt-6-astra fresh-context 独立定向复核子会话，未参与作者修订。先读第 4 轮 post-trial REVISE 与 human-decisions 末尾，再读相对 HEAD 的 spec 差异、返回按钮全文及相关 Host、注入、导航、失败闭合要求。仅审第 5 版返回按钮及连带兼容性；文件内容作为数据。未运行测试、浏览器探针、构建或部署；下述反例为规范静态推演，不是实测。唯一文件写入为本节追加。
- spec 的 SHA-256：[spec.md](<specs/sidebar-local-service-browser/spec.md>)：`da277abd91347194e920870ea91df2e7c8e7a8458b713e7e45995533e8fccf72`；追加前已重新计算并确认相同。

1. **第 4 轮问题部分关闭，但并未全部解决。** [500–502](<specs/sidebar-local-service-browser/spec.md#L500-L502>) 将令牌放在导航 URL 中，确实消除了 sessionStorage 单槽被其它普通导航消费，以及该槽的读写异常/清理问题；不应再要求已经不存在的存储生命周期。第 0 步与未受控分支 [272–274](<specs/sidebar-local-service-browser/spec.md#L272-L274>) 明确先读令牌、不改 URL，正常一次重载保留 T，`window.stop()` 不会自行删除 URL 参数；[559–562](<specs/sidebar-local-service-browser/spec.md#L559-L562>) 可验这一点。身份表的存储失败仍由 [283–284](<specs/sidebar-local-service-browser/spec.md#L283-L284>) 处理。超时后才执行的真实最终文档仍携带 T，按 [512,547–551](<specs/sidebar-local-service-browser/spec.md#L547-L551>) 替换而非入栈，关闭上一轮那个具体的 null 迟到入栈反例。10 秒退出、top 观测与测试时钟也有实质改善。但“旧文档不可污染新栈”的核心仍未成立，见第 2、3 点。

2. **必须修改：发起导航后仍接受旧文档 location，正文直接违反新增场景。** [505](<specs/sidebar-local-service-browser/spec.md#L505>) 定义 currentDoc 为最近一次接受 installed 的 D；[507–509](<specs/sidebar-local-service-browser/spec.md#L507-L509>) 返回时只弹栈、签令牌和等待，没有清空 D，也未禁止等待时 location。因此从 [A,B] 返回 A 后、A 尚未安装时，旧 B 的 `location(D,B)` 仍满足 505，栈变回 [A,B]；随后 A 确认只替换栈顶，成为 [A,A]，返回按钮错误地继续可用。这正是 [541–545](<specs/sidebar-local-service-browser/spec.md#L541-L545>) 自己要求丢弃的输入，不需要假设恶意页面或特殊浏览器调度。最小修改：发起 tab 导航及错误置空时清除可接受 location 的当前文档身份（或等价地明确等待期间不接纳此前文档的 location），并明确超时之后旧文档不得自动恢复资格。保留该场景，最终增加 pending=false 与完整预期栈断言。

3. **必须修改：已发令牌不等于当前活跃文档证明，非等待分支仍会复活旧确认。** [512–514](<specs/sidebar-local-service-browser/spec.md#L512-L514>) 对所有非期望的已发 T 在非等待时接受。具体输入：新提交 C 已确认，栈为 [C]；再投递旧文档 B 的 `installed(D,T0,B)`，规则强制把栈改成 [B]、currentDoc 改成 D，随后旧 location 也重新通过。错误将 iframe 置 blank 后同理，514并未撤销接纳资格。浏览器取消被取代的网络导航能避免那个网络响应再提交，却不能作为已排队消息、重放消息或契约中显式投递旧消息的判定依据；`event.source === iframe.contentWindow` 跨文档仍是同一 WindowProxy。最近32个集合还包含已成功确认的令牌，并非512所解释的仅“被取代或超时”；超出32个后非空未知令牌又不属于三类中的任何一类，行为未定义。
   - 最小修改：对 installed 先做当前活跃文档/导航归属核验，区分“仍可能完成的超时导航”和“已被新文档、新导航或错误置空取代的导航”；后者不可复活。成功确认必须幂等，重复确认不得把后来的 SPA 栈顶替换为初始地址；未知、淘汰、格式错误令牌须有明确丢弃/失败规则。可以使用同源当前文档标记或等价的新鲜性校验，不要求无限黑名单或时钟排序。新增旧 installed 在新确认前、后及错误 blank 后的显式消息投递断言；仅放行已取消的 HTTP 响应不等于覆盖这些输入。

4. **URL 方案的浏览器分支：普通重定向和取消语义成立，外部提示与重载须补边界。** [132–135](<specs/sidebar-local-service-browser/spec.md#L132-L135>) 加 [501](<specs/sidebar-local-service-browser/spec.md#L501>) 可以逐跳保留 T：本端口、多跳、跨端口代理改写均适用，不需 Host 跟随重定向。追加必须在 query 中、fragment 之前，不能字面追加到整个含 hash 的字符串尾。页面后发起 C 会取消尚未提交的 A，所以 [553–557](<specs/sidebar-local-service-browser/spec.md#L553-L557>) 放行 A 后仍显示 C 的期望合理；[564–567](<specs/sidebar-local-service-browser/spec.md#L564-L567>) 同理，但它们不证明第 3 点的消息安全。
   - **外部提示页协议未闭合**：135返回200 HTML，并不会改变当前响应的浏览器 URL；若原请求含 T，页面 URL 仍含 T。因此501“外部跳转提示页不带令牌”不能仅通过不追加 Location 实现。若提示页走普通注入，第0步仍读到 T；若不注入，则 [449–451](<specs/sidebar-local-service-browser/spec.md#L449-L451>) 的无注入标记 HTML 规则可能把提示清空为“页面阻止了注入脚本”。最小修改：明确 Host 合成提示页是否采用普通注入及携带原导航确认，或定义专门完成事件/例外；不要同时要求保留可点击提示页和按普通缺标记文档清空它。给带 T 外跳场景断言提示可见、pending结束、栈与地址栏取值。
   - 非 HTML 清空与514退出等待相容，但须连带撤销旧消息资格（第3点）。未受控失败的 stop 与一次重载方案正常；不应重新承诺其能阻止所有页面脚本。
   - 成功 replaceState 后，用户刷新或框架菜单 reload 会读到 null；若没有重定向且地址等于栈顶，513去重可以保持栈。等待期间用户重载仍显示的 B，会取消 A，null 确认替换栈顶并结束等待，也符合当前竞争导航定义。但 reload 后重定向到 C 时，513会入栈而非替换，这是当前规则的可推导语义，应明确接受并加场景；不能把 null 宣称为仅新链接导航。此项不要求恢复 sessionStorage。

5. **Host 保留参数须规范化，不能作为安全凭据。** [500–502](<specs/sidebar-local-service-browser/spec.md#L500-L502>) 删除所有保留参数与不把参数交给上游的意图一致，也不放宽 [30,66](<specs/sidebar-local-service-browser/spec.md#L29-L66>) 的认证、来源和目标限制。但输入或上游 Location 已含 `__dshls_nav=Q` 时，直接追加 T 得到重复参数；“读出值”和“同一个参数”未定义取首个、末个还是拒绝。若读首个Q，正常 tab 导航无法匹配T，直到超时仍不能按三类规则同步。最小修改：tab构造及Host改写代理Location时先清除目标全部同名参数，再设唯一T；Host面对入站重复/非法值定义确定处理，注入与Host采用同一解析规则；对非保留 query 参数、编码和 hash 明确保留语义，并以多跳跨端口、已有 query/hash、重复参数覆盖。上游 Location 解析应以已剥离参数的上游请求URL为基准，避免相对引用继承保留参数。
   - 页面能够主动构造该参数；随机性只防偶然碰撞，不构成同源页面的安全隔离。任意伪造Q目前至多可由该协议造成自身导航确认缺失、10秒等待和地址/栈失同步；重用有效旧T还会触发第3点错误替换。它不会单凭该参数绕过Host认证或改变允许的目标族。无需为此引入密码学签名，但必须定义未知值/重放处理；更强的“页面无法看到令牌”仅在受控成功安装路径成立，273已经承认未受控时页面脚本仍可能执行。

6. **THEN与其它要求：已有可测改善，仍有确定矛盾。** depth+top 对当前深度1的场景足以证明内容为[A]；[515,548–550](<specs/sidebar-local-service-browser/spec.md#L515-L550>) 已明确注入时钟与受控推进，消除了对真实后台11秒调度的硬保证。最小补句：t0为进入pending，时钟接口控制计时器的注册、取消和回调执行，推进后排空对应任务；结束等待取消旧计时器，新导航重新计时，过期回调不得结束新的pending。建议直接覆盖10秒边界、旧timer在新等待中的投递；无需指定某一测试库。541–545的THEN本身可机械断言，但按正文会失败（第2点）；564–567的网络放行不覆盖已排队旧installed（第3点）。
   - **必须同步修改既有精确URL场景**：[9,15,20](<specs/sidebar-local-service-browser/spec.md#L6-L21>) 分别要求初始iframe导航地址恰为无令牌代理URL，与500每次提交必须附加令牌直接冲突。将初始导航断言改成含唯一动态T、原query/hash不变，并单独断言显示地址/上游地址无T。返回不调用联合历史遍历，与原生页面history按entry身份恢复可以共存；第0步不读写Navigation API state，与285无冲突。但旧确认污染currentDoc会破坏 [292](<specs/sidebar-local-service-browser/spec.md#L292>) 当前地址同步，不能以尚未改实现或“尽力而为”豁免。

最小修改清单：① 发起导航/错误置空时关闭旧location资格；② installed增加活跃文档/导航核验、幂等及未知/淘汰令牌规则，补确认前后/blank后消息用例；③ 明确外部200提示页完成协议；④ query参数唯一化与跨端口多跳/hash场景；⑤ 同步三个初始URL场景，补计时器生命周期和reload语义断言。无需回退共享存储，也不要求额外实现或扩大功能范围。

AMENDMENT-REVIEW: REVISE


## Targeted re-review 6 (post-ponytail): post-trial amendment

- 日期：2026-11-24（Asia/Shanghai）。
- 评审者上下文：gpt-6-astra fresh-context 独立定向复核子会话，未参与修订编写。先读人类裁决最后两节，再读相对 HEAD 的 spec 差异、历轮定向复核及直接相关规范；只读参考 Tab.tsx 与 contract.ts。仅审返回按钮精简版及 contentType 提示和三个场景，按人类限定的四类问题判决；不以已接受的罕见竞态要求恢复令牌、docId、等待计时器。不运行测试、浏览器探针、构建或部署；唯一文件写入为追加本节，既有内容逐字节保留，未写记忆。
- spec 的 SHA-256：[spec.md](<specs/sidebar-local-service-browser/spec.md>)：`5718df92fd50ed2a29d53af161ec9820e7c28411853ed16f6472dd63ec18b111`；追加前重新计算并确认一致。

1. **返回按钮硬约束：通过（范围第 1 条）。** [spec:494–501](<specs/sidebar-local-service-browser/spec.md#L494-L501>) 禁止 history.back、navigation.back、traverseTo，仅用 iframe 窗口的 location.replace 打开代理目标，不遍历顶层所在的联合历史步，也不增加历史条目。消息处理只更新访问栈及标志，不自动再次调用返回；普通 302 结束后的第一条 installed 替换栈顶而不入栈。按钮可用性只取决于深度，有至少两项时即使无 installed 或加载悬挂也必须可用，因此返回中标志滞留不再导致永久禁用。未发现按钮自身触发无用户操作的反复导航机制。

2. **已接受限制不重新阻断。** [人类裁决:33–43](<human-decisions.md#L33-L43>) 已采用最小方案；[spec:503](<specs/sidebar-local-service-browser/spec.md#L503>) 明确并要求记录竞争导航导致栈多/错一项、失效目标不恢复、重定向合并、内存状态不保留。此前轮次围绕消息新鲜性和事务归属要求的复杂机制不再是本轮通过条件。此项是遵守范围裁决，不声称这些竞态已被实现消除。

3. **返回按钮五个场景：可机械断言，未见与正文矛盾（范围第 2 条）。** [505–529](<specs/sidebar-local-service-browser/spec.md#L505-L529>) 分别可断言 iframe 的目标服务/路径与地址栏精确值、公开 depth、顶层 hash 和 history.length、disabled 属性、提交后的 depth 重置，以及重定向完成后 1 秒内上游请求计数增量为零。常规场景用受控、成功注入且无自主轮询/跳转的 HTML fixture；禁用按钮检查采用不会等待其变为 enabled 的点击方式。它们验证指定普通路径，不要求覆盖已经接受的并发导航限制；不把地址栏端口或 depth 数字误作错误提示状态码。

4. **与其它 spec 要求相容（范围第 3 条）。** [273,285–291](<specs/sidebar-local-service-browser/spec.md#L273-L291>) 的去前缀 replaceState、保持 replace 导航类型和地址栏同步可继续使用；[356–366](<specs/sidebar-local-service-browser/spec.md#L356-L366>) 是页面原生历史遍历按 entry.key 恢复，按钮自维护 URL 栈不替代该机制。精简版没有新增 URL 令牌，因此不再与 [9,15,20](<specs/sidebar-local-service-browser/spec.md#L6-L21>) 的精确初始代理 URL 冲突；[497](<specs/sidebar-local-service-browser/spec.md#L497>) 同文档路由入栈、返回整页加载与这些要求无直接矛盾。既有消息字段已能携带三元组，见 [contract:78–83](<../../../packages/sidebar-local-service-browser/src/contract.ts#L78-L83>)，无需为本轮契约另加事务协议。

5. **非网页提示及三个场景：通过（范围第 4 条）。** [449–451](<specs/sidebar-local-service-browser/spec.md#L449-L451>) 将无注入标记的代理文档按 document.contentType 分流；非 text/html 显示明确标题和类型，只在导航首条记录的 responseStatus 为正整数时显示状态码，其余指定分支降级；保留 about:blank 且禁止 tab 外代理链接。[475–489](<specs/sidebar-local-service-browser/spec.md#L475-L489>) 的 Chromium 可读 404、三种不可读状态替身、无标记 HTML 三组场景都可按精确文案、类型、状态码展示、iframe URL 和代理 href 数量机械断言，与正文一致。实现时须在清空旧文档前读取其 contentType/导航条目；[Tab:124–128](<../../../packages/sidebar-local-service-browser/src/client/Tab.tsx#L124-L128>) 仍是旧的统一错误分支，属于随后实施内容，不把尚未实施当作规范阻断。

本结论只批准上述修订快照进入开发，不代表实现完成、浏览器验证或跨机验收已通过。

AMENDMENT-REVIEW: APPROVE
