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
