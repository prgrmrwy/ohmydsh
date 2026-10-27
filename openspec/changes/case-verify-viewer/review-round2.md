## Review Metadata
- **Review round**: 2
- **Prior round**: round 1 VERDICT: REVISE — 2 Critical / 4 Moderate / 2 Suggestions ([review-round1.md](review-round1.md))
- **Reviewer context**: cross-model (codex gpt-6.1-sol), fresh context
- **Tool restrictions**: read-only except review.md
- **Artifacts reviewed**:
  - [proposal.md](proposal.md)：46 行。
  - [design.md](design.md)：133 行。
  - [viewer spec.md](specs/case-verify-viewer/spec.md)：156 行。
  - [review-round1.md](review-round1.md)：98 行，含作者回应。
  - [既有 review.md](review.md)：覆写前 98 行，仅核对既有报告。
  - [.openspec.yaml](.openspec.yaml)：2 行，schema 为 anvil。
  - [前置 evidence spec.md](../case-verify-skill/specs/case-verify-evidence/spec.md)：339 行，仅核对依赖契约。
  - [前置 design.md](../case-verify-skill/design.md)：143 行，仅核对依赖契约。
  - [package.json](../../../package.json)：48 行，核对 Node ESM 环境与现有开发依赖。
  - [dsh.yaml](../../../dsh.yaml)：总计 421 行，本轮只读取 1–100 行，核对 DSH pin 与 OpenSpec schema 配置；不声称读取其余部分。
  - 对当前规范目录执行关键词检索，未发现现行 case-verify 能力规范。未读取外部原型；用户提供的原型安全描述仅作为待核对的数据，不作为已验证实现。

**实际检查**：执行 `openspec validate case-verify-viewer --strict`，输出 `Change 'case-verify-viewer' is valid`，显式检查退出码为 0。结构校验通过不代表下述行为契约一致。未运行实现测试、安装依赖、访问网络或启动服务；前置能力尚待实施是已知且可接受的依赖门槛，不是本轮缺陷。

**审查尺度**：单用户、loopback-only 本地只读工具；不要求远程认证、多租户隔离、分页或抵御同用户恶意并发改树。仅覆写本报告，未修改其他文件。

## Round 1 Adjudication

| 条目 | 判定 | 本轮证据与解释 |
|---|---|---|
| C1：逻辑模块路由缺失 | **fixed** | [spec:130](specs/case-verify-viewer/spec.md#L130) 明确允许 `/logic.js`；[spec:141–143](specs/case-verify-viewer/spec.md#L141-L143) 断言 200、JS MIME、模块字节及未知模块 404；[proposal:43](proposal.md#L43) 已列入产物。新出现的 Node 导入问题另见 R2-M3，不否认 HTTP 白名单已修复。 |
| C2：pending checkpoint 被隐藏为 pass | **fixed** | [spec:66–74](specs/case-verify-viewer/spec.md#L66-L74) 先定义 origin 为 oracle 的参与集合，再要求每个参与 checkpoint 均为 pass 且各有带证据的有效 pass；[spec:81–84](specs/case-verify-viewer/spec.md#L81-L84) 明确 C1 pass、C3 pending → partial。 |
| M1：路径禁令误伤来源文本 | **partial** | [spec:41](specs/case-verify-viewer/spec.md#L41) 已放开相对来源路径，并要求正文保留；[spec:50–53](specs/case-verify-viewer/spec.md#L50-L53) 有相对路径正文场景。但“任何字段不得包含 checking 绝对路径”仍会禁止合法 actual/limits 原文，见 R2-M2。 |
| M2：后台启动无就绪/失败契约 | **fixed** | [spec:14–16](specs/case-verify-viewer/spec.md#L14-L16) 与 [design:26–31](design.md#L26-L31) 已规定 catalog 完成、bind 成功后输出单行并 flush，受管任务、job id、30 秒上限、health 检查及失败回收；[spec:23–31](specs/case-verify-viewer/spec.md#L23-L31) 覆盖管道不等 EOF 和端口占用。 |
| M3：纯函数测试代替 DOM 验收 | **partial** | [design:96–106](design.md#L96-L106) 已引入生产 mount 的 DOM 替身测试，并把视觉检查明确留给人工；[spec:104–119](specs/case-verify-viewer/spec.md#L104-L119) 已写清搜索范围和字面文本断言。该分层可行，但设计指定的浏览器绝对导入路径不能直接用于 Node，见 R2-M3。 |
| M4：前置能力被误称已实施 | **fixed** | [proposal:46](proposal.md#L46)、[design:3](design.md#L3) 明确尚未实施、先验证前置接口；[design:51–55](design.md#L51-L55) 分离结构校验和证据可用性。当前没有 tasks 文件；“tasks 0.1”是后续规划引用，不认作已经落实的检查证据。 |
| S1：本地安全回归矩阵 | **partial** | [design:124](design.md#L124) 已诚实限定 TOCTOU 威胁模型；[spec:116–119](specs/case-verify-viewer/spec.md#L116-L119) 补了字面渲染。HEAD、JPEG 魔数、具体 CSP、安全头错误分支仍没有对应验收矩阵；作者明确后移到 test-plan，见 R2-S1。 |
| S2：只读快照不是从未写入的证明 | **fixed** | [design:125](design.md#L125) 已写明无其他写者、纳秒 mtime、目录/符号链接集合、短暂写入不可证明，以及不创建 lock/cache/pycache。无需为此增加文件系统监控框架。 |

## Findings

### 🔴 Critical (blocking)

**无。** 上轮两项 Critical 的核心行为都已修复。本轮剩余项均能通过局部且明确的契约修订解决，不要求改变架构或前置状态语义。

### 🟡 Moderate

**R2-M1 — 网络证据场景与统一 evidence schema 无法同时满足。**
- **证据**：[spec:41](specs/case-verify-viewer/spec.md#L41) 要求 evidence 含 `name/kind/scope`，并且 `url` 与 `unavailable: true` 必须二选一；[spec:153–156](specs/case-verify-viewer/spec.md#L153-L156) 却要求 network 证据“只有 name 和 kind”。[design:66–67](design.md#L66-L67) 也保留 scope。
- **具体反例 / 影响**：合法 network 记录带 `scope: exact`。输出 scope 会违反网络场景；丢掉 scope 又违反统一 schema；无 url 且无 unavailable 同样违反二选一要求。实现和测试无法同时遵守两处契约。
- **最小修复**：统一规定 network/log 不生成资产 key，catalog 输出 `{name, kind, scope, unavailable: true}`；明确此处 unavailable 也包括“按策略不提供下载”，不据此改写原始观察状态。修改网络场景，断言该精确键集合及不存在下载路由。无需增加新字段或暴露原始路径。

**R2-M2 — 绝对路径全局禁令仍与正文逐字保留矛盾。**
- **证据**：[spec:41](specs/case-verify-viewer/spec.md#L41) 同时要求“任何字段”不得包含 checking 绝对路径，以及 actual、limits 等来源文本原样保留；[spec:45–48](specs/case-verify-viewer/spec.md#L45-L48) 以整个 JSON 不含哨兵串作断言。
- **具体反例 / 影响**：合法 actual 是“导出到 /tmp/CHECK_SENTINEL/evidence/out.png 后大小为 0”，checking 根正是 `/tmp/CHECK_SENTINEL`。保留原文违反第一条；删除路径违反第二条。前置 [evidence spec:151–153](../case-verify-skill/specs/case-verify-evidence/spec.md#L151-L153) 未禁止这样的正文。这是剩余契约矛盾，不是要求查看器替用户脱敏所有文本。
- **最小修复**：将禁令明确限定到**构建器添加的实现字段和值**：不得输出 evidence 原始 path/sha256、资产映射 realpath 或另加 checking 根字段；来源文本即使包含绝对路径也逐字保留。哨兵场景注明输入正文不含该哨兵，用于检查构建器没有添加实现路径；另加正文明确含 checking 根仍保持原文的场景。不要使用全 JSON 路径替换。

**R2-M3 — 浏览器根路径导入会使 Node 在执行 mount 前失败。**
- **证据**：[design:100](design.md#L100) 指定 app.js import `/logic.js`；[design:103–104](design.md#L103-L104) 又要求 Node 直接加载生产模块并调用 mount。[package.json:4](../../../package.json#L4) 的 ESM 设置能让 `.js` 作为模块解析，但不会把 HTTP 根路径转换为 skill 目录。
- **具体反例 / 影响**：Node 从生产 app.js 加载 `import '/logic.js'` 时，查找文件系统根目录的模块，而非 viewer 中的逻辑模块；通常以模块不存在结束。DOM 替身再完整也不会被执行。只测 logic.js 的纯函数无法发现浏览器与 Node 的这项共享模块契约问题。
- **最小修复**：设计明确使用 `import './logic.js'`。浏览器从 `/app.js` 解析后仍请求白名单内的 `/logic.js`，Node 则解析到同级文件。测试直接导入两份生产模块并调用 mount，不重写 import、复制模块或加 Node loader。其余 DOM 替身方案保留。

**R2-M4 — 返回文件的 checking-root 校验未限定资产，会拒绝合法静态模块。**
- **证据**：[spec:130–132](specs/case-verify-viewer/spec.md#L130-L132) 先开放静态模块，随后无条件要求“返回文件前”确认文件仍在 checking 内；[design:41](design.md#L41) 明确静态文件来自独立的 skill/viewer 目录，[design:82](design.md#L82) 却同样没有限定这项 commonpath 校验的适用路由。
- **具体反例 / 影响**：典型 skill 安装目录在 checking 根之外。若按统一文件返回 helper 执行上述 SHALL，`/app.js`、`/logic.js` 乃至首页都会被拒绝。它与本轮修好的模块白名单互相抵消；“静态文件是例外”不应依赖实现者猜测。
- **最小修复**：把 checking-root realpath 校验明确限定为 `/asset/<key>` 的证据读取。静态路由仍只映射四个固定的 skill 文件：`/`、`/app.js`、`/logic.js`、`/style.css`；API/health 不是静态文件。同步更正 [design:80](design.md#L80) 的“5 个精确静态路径”计数。增加场景：checking 与 skill 目录互不包含时四条静态路由均 200，而已登记资产启动后改指根外时不返回外部字节。保留资产的返回前复查，不放宽为任意目录托管。

### 📌 Suggestions

**R2-S1 — 把“保留原型安全措施”落实成紧凑测试清单，避免作者回应高估规范覆盖。**
- [review-round1:98](review-round1.md#L98) 声称除 no-referrer 外均已被 spec 覆盖，但 [spec:125–156](specs/case-verify-viewer/spec.md#L125-L156) 实际没有 HEAD、JPEG 实际字节与扩展名不一致时的 MIME、完整 CSP 指令集合等明确要求或场景。[design:5、77](design.md#L5) 是保留原型的设计意图，不是这些行为已获得验证。
- 后续 test-plan 用小矩阵固定：HEAD 与 GET 同状态/安全头但无响应体；JPEG 字节即使名为 `.png` 也发 `image/jpeg`；dom 发 `text/plain` 和 nosniff；403/404 也带既定安全头；保留用户给定的 CSP 与 no-referrer。无需 token、远程认证或更强文件沙箱。本建议沿用上轮 S1，暂未补齐不升级为 Critical。

**R2-S2 — 为新的共享状态语义补直接回归场景。**
- [spec:76–94](specs/case-verify-viewer/spec.md#L76-L94) 已有单 checkpoint 纠偏通过、pending、无证据和 derived 缺口；尚无多参与者全部 pass、未 supersede 的跨 loop fail，以及 oracle 重新冻结造成旧 pass 过期的 viewer 场景。
- 最小补充三组固定断言：C1/C3 均有有效带证据 pass → oracle pass；历史 member fail 未 supersede、后轮 admin pass → fail；只改 O-1 并重新冻结 → 挂 O-1 的 checkpoint pending、其 oracle partial，未改 O-2 的独立 checkpoint/oracle 保持 pass。第三组也能检查证据条件不会误用旧 revision 的 pass。无需在 JS 重写状态计算器。

### 新一轮交叉检查结论

**参与集合与前置契约：未发现语义矛盾。** [viewer spec:66](specs/case-verify-viewer/spec.md#L66) 委托共享 status.py 计算状态；前置 [evidence spec:207–211](../case-verify-skill/specs/case-verify-evidence/spec.md#L207-L211) 按 checkpoint 任一关联 oracle 的 item revision 变化使观察过期，[evidence spec:236–240](../case-verify-skill/specs/case-verify-evidence/spec.md#L236-L240) 对全部有效观察按优先级取状态。viewer 没有重新引入“只看最新 loop”。只有旧 pass 时，过期后 checkpoint 为 pending，参与集合仍非空，因此 oracle 为 partial，而不是 uncovered 或 pass。derived 排除也与前置 [evidence spec:286–289](../case-verify-skill/specs/case-verify-evidence/spec.md#L286-L289) 一致。

注意：前置优先级中 pass 高于 skipped，因此“有效 pass + 有效 skipped”可算 checkpoint pass；viewer 沿用该结果，不等同于“所有有效观察字面上都是 pass”。本轮不擅自把共享状态语义改回另一套规则。

**后台启动：契约可执行。** 机器可识别就绪行、立即 flush、受管句柄、有限等待、health 与失败回收均已落实在文档中。实现时应读取运行中任务的增量输出，而不是等待长驻进程 EOF；无需引入新 Host 插件。管道测试的 10 秒断言与主会话 30 秒等待上限分别是测试时限和操作上限，不构成冲突。

**DOM 替身：方向可行，边界诚实。** 小替身可验证生产 mount 的节点文本和事件接线，不证明浏览器布局、CSP 执行或真实浏览器解析；设计已单列人工视觉检查。按 R2-M3 改相对 import 后，无需为本次规划引入无头浏览器或通用 DOM 框架，也不要求替身实现完整浏览器。

**每个 requirement 的 happy / failure-or-edge 覆盖及 THEN 可判定性：**

| Requirement | happy 场景 | failure / edge 场景 | 判断 |
|---|---|---|---|
| view 只读且选目录 | [spec:18–26](specs/case-verify-viewer/spec.md#L18-L26)：目录快照、就绪和 health | [spec:28–36](specs/case-verify-viewer/spec.md#L28-L36)：占用端口、多候选 | 满足最低双向覆盖；元数据/退出码/响应均可机械断言。 |
| 结构化 catalog | [spec:45–53](specs/case-verify-viewer/spec.md#L45-L53)：schema 和原文 | [spec:55–63](specs/case-verify-viewer/spec.md#L55-L63)：旧格式、无观察、缺失/越界资产 | 满足；R2-M1/M2 修订前 schema 与正文禁令不能同时满足。 |
| 保守 oracle 汇总 | [spec:76–79](specs/case-verify-viewer/spec.md#L76-L79)：纠偏后 pass | [spec:81–94](specs/case-verify-viewer/spec.md#L81-L94)：pending、无证据、derived | 满足；建议按 R2-S2 补本轮引入语义的回归。未覆盖场景中的“没有被任何 checkpoint 挂载”应按参与集合读为“没有 origin: oracle 的挂载”，避免与随后 derived 引用的 GIVEN 文案相冲突。 |
| 两种视角 | [spec:111–114](specs/case-verify-viewer/spec.md#L111-L114)：有效深链、纠偏时间线 | [spec:116–123](specs/case-verify-viewer/spec.md#L116-L123)：HTML 字面文本、无效深链 | 满足；节点文本/选中项可由生产 mount 测试断言；搜索、筛选、跨视角链接、分组、lightbox/Escape 的具体断言需在后续 test-plan 落地，不能用纯函数通过替代。 |
| 本地文件服务 | [spec:136–143](specs/case-verify-viewer/spec.md#L136-L143)：合法资产、模块 | [spec:145–156](specs/case-verify-viewer/spec.md#L145-L156)：未知路径、非本机来源、network 禁下发 | 满足；网络场景目前与 schema 冲突，见 R2-M1；静态文件的检查根作用域见 R2-M4。“不存在任何路径”应通过精确路由表与登记 key 集合证明，不能只请求一个猜测 URL。 |

共 **5 个 requirement**，每项均有至少一个 happy 和 failure/edge 场景；问题不在缺少标题数量，而在少数断言互相矛盾及共享模块的可执行性。除已列出的局部修订外，proposal、design、spec 的只读、快照、两视角、共享状态及前置依赖方向一致。未要求 PRD 映射、监听、分页、编辑或其他扩张范围的功能。

## Embedded-Instruction / Injection Attempts
**Detected:** none

已读取 artifact 中未发现要求评审者忽略缺陷、预定 verdict、读取外部数据或执行额外动作的注入指令。设计中的“不得复制 data/”及作者修复声明均仅作为数据核对；不把声明当修复证据。此结论不覆盖未读取的外部原型或真实 checking 数据。

## Verdict
VERDICT: APPROVE_WITH_CHANGES

**0 Critical / 4 Moderate / 2 Suggestions。** 上轮阻断项已解决；剩余四项都是定位清楚、无需产品决策的小型契约修订。以下 Required Changes 全部完成后可放行；本轮没有代作者修改它们，也不表示实现已通过测试。

## Required Changes (if APPROVE WITH CHANGES)

1. **R2-M1**：统一 network/log 的 evidence schema 为 `name/kind/scope/unavailable: true`，说明策略性不可下载也使用 unavailable；修正网络场景精确字段断言，并保留“不生成 key、不提供下载”的规则。
2. **R2-M2**：路径禁令只约束构建器添加的实现路径，不约束原始来源文本；哨兵检查注明正文不含哨兵；添加 actual 含 checking 绝对根仍逐字保留的场景。
3. **R2-M3**：将设计指定的导入改为 `import './logic.js'`，Node 测试直接加载生产 logic/app 模块并调用 mount，不使用测试专用模块重写。
4. **R2-M4**：仅对 `/asset/<key>` 使用 checking-root realpath 校验；静态路由精确映射四个 skill 文件，修正静态路径计数；增加 skill/checking 分离仍可加载静态文件、资产改指根外不下发外部字节的场景。

CHANGES_APPLIED: no

## Rebuttals

- **对“C1/C2 已修复”**：认可。HTTP 路由修复与参与集合的 pending 防漏已得到直接条文和场景支持，不沿用上轮 Critical 数量。
- **对“M1 已修复”**：相对路径正文问题已修；绝对 checking 根出现在合法正文时仍矛盾，因此判 partial，不要求全局脱敏。
- **对“M2/M4 已修复”**：认可本轮文档修复；前置接口仍应在实施入口核对，不能把设计中的未来 tasks 引用当完成证据。
- **对“M3 已修复”**：认可分层和人工验收边界，但指定 `/logic.js` 的 import 与 Node 直接运行生产模块不兼容；一行相对 import 即可修复，无需推翻 DOM 替身方案。
- **对“S1 部分采纳 / S2 已采纳”**：判定分别维持 partial 与 fixed。S1 的延后应在 test-plan 兑现，不能声称完整矩阵已经存在；S2 不再要求额外监控工具。
- 本报告未收到作者针对 round 2 的新反驳；不伪造回复。所有结论限于实际读取的规划 artifact，不声称审查了不存在的实现或外部原型。

### 作者回应（round 2 Required Changes 已应用，待评审方复核）

1. **R2-M1 已修复。** spec 第 41 行附近：network/log 证据统一为 `unavailable: true`。网络证据场景改为断言键集合恰好为 `{name, kind, scope, unavailable}`。
2. **R2-M2 已修复。** 路径禁令仅约束构建器自行添加的字段；哨兵场景注明“fixture 正文中不含哨兵串”；新增场景“正文中的绝对路径照样保留”。
3. **R2-M3 已修复。** design D6 改为 `import './logic.js'`，并说明浏览器与 Node 对这一导入的解析方式。
4. **R2-M4 已修复。** 4 个静态文件精确映射到 skill 的 `viewer/`，checking 根目录的 realpath 校验只作用于 `/asset/`。design 中的计数改为 4。新增两个场景：“skill 目录与 checking 目录分离”“资产启动后被改指到根外”。
- **建议 S1、S2 推迟到 test-plan 阶段处理。** 原型的 HEAD/MIME/CSP/错误响应回归，以及多参与者、跨 loop、revision 过期的 viewer 回归，届时作为补充测试，不改 spec。
