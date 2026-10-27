## Review Metadata
- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: cross-model (codex gpt-6.1-sol), fresh context
- **Tool restrictions**: read-only except review.md
- **Artifacts reviewed**:
  - [proposal.md](proposal.md)：46 行。
  - [design.md](design.md)：103 行。
  - [viewer spec.md](specs/case-verify-viewer/spec.md)：117 行。
  - [.openspec.yaml](.openspec.yaml)：2 行，确认 schema 为 anvil。
  - [前置 evidence spec.md](../case-verify-skill/specs/case-verify-evidence/spec.md)：245 行，仅核对依赖的数据契约。
  - [前置 skill spec.md](../case-verify-skill/specs/case-verify-skill/spec.md)：104 行。
  - [前置 design.md](../case-verify-skill/design.md)：121 行。
  - [AGENTS.md](../../../AGENTS.md)：92 行。
  - [dsh.yaml](../../../dsh.yaml)：421 行。
  - [repo-layout spec.md](../../specs/repo-layout/spec.md)：786 行。
  - [集成陷阱文档](../../../docs/architecture/dsh-plugin-integration-pitfalls.md)：821 行。
  - [OpenSpec 配置](../../config.yaml)：32 行。
  - 外部原型的五个指定文件：读取均被工具实际拒绝，原因是超出 managed root；未获得正文，行数未知，**不声称已审查原型或证明安全性不弱于原型**。未读取其 data/，未通过其他工具绕过限制。

校验记录：执行了 `openspec validate case-verify-viewer --strict`，输出 `Change 'case-verify-viewer' is valid`。这是结构校验，不证明以下行为契约正确。未运行实现测试或启动服务。审查尺度为单用户、loopback-only 开发工具，不要求远程认证、多租户隔离或抵御拥有同一用户文件修改权限的攻击者。

## Findings
### 🔴 Critical (blocking)

**C1 — 浏览器必需的逻辑模块被 HTTP 路由白名单禁止。**
- **证据**：[design.md:78](design.md#L78) 要求浏览器和 Node 共同加载 `viewer/logic.js`；[spec.md:95](specs/case-verify-viewer/spec.md#L95) 穷举服务可用路径，却没有 `/logic.js`，并要求其余路径一律 404。[proposal.md:43](proposal.md#L43) 的产物清单也没有该模块。
- **影响**：按设计使用 ES module 导入逻辑时，合法查看器页面将请求 `/logic.js` 并收到 404；模块依赖无法加载，搜索、路由等初始化可能整体失败。仅导入磁盘模块的 Node 测试仍可全绿。
- **具体修复**：把 `/logic.js` 加入 spec 的精确静态路由白名单及 proposal 的交付清单；增加 HTTP 测试，断言该地址返回 200、JavaScript MIME、预期模块字节，而任意其他 `.js` 路径仍 404。无需改为任意静态目录托管。

**C2 — 一个已执行 checkpoint 可以把同 oracle 下尚未执行的 checkpoint 隐藏为 pass。**
- **证据**：[spec.md:49–53](specs/case-verify-viewer/spec.md#L49-L53) 只遍历有效观察：只要它们全是 pass 且有一条证据，就得到 pass；没有要求所有已挂载的 oracle checkpoint 都有观察。[design.md:84](design.md#L84) 已明确包含一个 oracle 挂载多个 checkpoint 的 fixture。
- **影响**：O-1 挂载 C1、C3，只有 C1 有带截图的 pass，C3 仍 pending；按现有规则 O-1 为 pass。C3 可以是另一项必要的交互后果或环境检查，不是冗余采样。标注“计算值”不能纠正错误的绿灯；这与“保守汇总”和覆盖缺口用途不符。前置 [evidence spec.md:154–158](../case-verify-skill/specs/case-verify-evidence/spec.md#L154-L158) 明确把无观察定义为 pending。
- **具体修复**：先定义参与集合为引用该 oracle 的 `origin: oracle` checkpoint，derived 不计入。集合为空才 uncovered；任一有效观察 fail 仍优先 fail；判 pass 前必须每个参与 checkpoint 至少有一条有效观察，且参与的有效观察全部 pass，并满足明确的证据条件；否则 partial。增加“C1 pass、C3 无观察 → partial”“两者有观察且均 pass → pass”及“存在 fail → fail”场景。保留设计中明确选择的跨 loop 历史 fail 口径，不擅自改成最新轮状态。

### 🟡 Moderate

**M1 — 禁止 catalog 中任何路径的规则会禁止正常的来源信息与观察正文。**
- **证据**：[spec.md:29](specs/case-verify-viewer/spec.md#L29) 禁止 catalog 中任何绝对或相对文件系统路径；[spec.md:33–36](specs/case-verify-viewer/spec.md#L33-L36) 甚至禁止整个 JSON 出现 `evidence/`。但 [design.md:47–50](design.md#L47-L50) 原样输出 `source`、`path`、`actual`、`limits`；前置 [evidence spec.md:34–35](../case-verify-skill/specs/case-verify-evidence/spec.md#L34-L35) 的 `path` 是合法来源树路径，不是证据文件路径。
- **影响**：合法的 actual 为“保存 evidence/ 目录中的结果失败”，或来源树节点名恰为一个文件路径时，必须丢失原文才能通过全 JSON 字符串断言。反过来，仅搜索 `evidence/` 也不能证明所有资产路径均未泄露。当前要求既过强又不是有效的安全断言。
- **具体修复**：限定为“不输出 evidence 原始 path、资产映射 realpath、checking 根目录等实现路径字段”，明确来源树 `oracle.path` 与用户文本按数据保留；对 catalog schema 和 evidence 对象字段做结构化断言，使用唯一根路径哨兵核验构建器不添加路径。增加正文含 `evidence/` 仍保持原文的合法场景。

**M2 — 主会话后台启动没有可执行的就绪与失败契约。**
- **证据**：[design.md:24](design.md#L24) 只说“用后台任务启动，把打印出的 URL 转告用户”；[spec.md:14](specs/case-verify-viewer/spec.md#L14) 只要求 stdout 打印 URL，没有规定 flush、何时打印、后台任务句柄、等待上限或停止方法。
- **影响**：Python stdout 接到后台任务管道时可能缓冲，`print()` 后直接 `serve_forever()` 不会自动退出来刷新缓冲。服务已运行，主会话却始终拿不到随机端口；固定端口占用时，也没有约定如何区分启动失败与仍在等待。长驻任务不能靠等待进程结束获得 URL。
- **具体修复**：规定在 bind 成功、catalog 构建完成后打印单一机器可识别的 URL 行并立即 flush；SKILL 使用受管后台任务并保存 job id，只有限时等待就绪行，核验同端口 `/health` 后才交付 URL；提前退出或超时应报告错误并回收该任务；告知用户停止方式。增加管道 stdout 下不等待 EOF 即拿到 URL、端口占用非零退出且不打印成功 URL 两个场景。不需要额外 Host 插件或新进程监督框架。

**M3 — 前端纯函数测试不能证明 spec 的 DOM 交互与安全断言。**
- **证据**：[design.md:70–78](design.md#L70-L78) 将测试落在筛选、hash 解析、分组纯函数；但 [spec.md:74–88](specs/case-verify-viewer/spec.md#L74-L88) 的 THEN 要求详情区实际显示、纠偏标注、跨视角跳转、lightbox 与 Escape 关闭。现有两个视图场景仅覆盖有效与不存在的深链，未定义如何在无 headless browser 的环境机械断言这些 DOM 行为。
- **影响**：纯函数正确，仍可能完全没有接事件、把标注写错位置、用 `innerHTML` 渲染不可信 expected/actual，或 Escape 根本不关闭放大层；Node 逻辑测试无法发现。这不是要求引入浏览器依赖，而是当前设计把逻辑测试当成整项前端验收。
- **具体修复**：在 design/test-plan 中明确双层测试：现有纯函数测试；以及调用生产 render/event 接线的最小 DOM 适配器测试，断言节点 `textContent`、视角/选中项、纠偏文本、放大层开关和 Escape。用含 HTML 标签的 title/expected/actual 验证只出现字面文本、无可执行元素。另把 search/filter 的范围与状态来源写明，以便预期结果可固定。如果选择人工浏览器检查，应明确它是另一项验收记录，不声称已由纯函数自动验证。

**M4 — “前置已经实施”的当前事实不成立，需要显式依赖门槛。**
- **证据**：[proposal.md:46](proposal.md#L46) 声称模型模块、`status.py` 和 fixture 已存在；[design.md:3](design.md#L3) 指定共享 `_model.py`；但本轮对工作树 `skills` 下 `case-verify/**/*` 的 glob 返回无文件，[dsh.yaml](../../../dsh.yaml) 也没有 case-verify 条目。前置 change 的设计仍描述将来实施与迁移，不能代替已存在的模块接口。
- **影响**：实现者无法确认将复用哪个函数签名、共享校验是否会因“证据已删除”而直接拒绝整个目录，或状态函数能否只读调用。若在本 change 临时补造模型，又会越过 proposal 所承诺的不修改前置能力边界。
- **具体修复**：把事实改成“实施前必须先完成并验证前置 change”，在进入实现前检查共享读取/校验、状态计算及 fixture 的确切导出接口。明确 viewer 的结构校验与资产可用性检查分开：缺失/越界资产按本 spec 降级，不因此阻止其他记录浏览；结构非法记录仍应拒绝。此处只要求修正依赖关系，不要求本 review 去实施前置 change。

### 📌 Suggestions

**S1 — 把已有本地安全边界写成小型回归矩阵，不扩大威胁模型。**
- **证据**：[design.md:60–65](design.md#L60-L65) 要求返回前重查 realpath、dom 以纯文本下发；[spec.md:97–104](specs/case-verify-viewer/spec.md#L97-L104) 只给出宽泛 `image/*` 与“同源 CSP”，没有 magic/MIME 失败、启动后文件消失/路径改变、dom 安全头或错误响应安全头的场景。
- **为何有用**：现有 Host 精确白名单和 cross-site 拒绝已覆盖主要 DNS rebinding 风险，不能因本地工具没有 token 就判不安全；但这些正确约束很容易在移植原型时漏到 HEAD/错误分支。循环检查再 open 仍有 TOCTOU，需诚实写明是否排除同用户并发恶意改树，而不是宣称绝对无竞态。
- **具体建议**：固定 CSP 指令集合（外置脚本、无 inline/eval、`object-src 'none'`、`base-uri 'none'`、`frame-ancestors 'none'`）；固定每种图片的具体 MIME 并定义不符 magic 的拒绝/不可用行为；增加 dom 返回 `text/plain`+nosniff、catalog 文本按字面呈现、启动后路径变到根外不返回外部字节、404/403 也有安全头的测试。若要求抵御并发恶意替换，再选择描述符级打开策略；否则注明边界，别为此增加复杂沙箱。

**S2 — 不把 sha256+mtime 快照测试等同于“从未写入”的证明。**
- **证据**：[design.md:32](design.md#L32) 用 sha256+mtime 断言“完全只读”；[spec.md:16–19](specs/case-verify-viewer/spec.md#L16-L19) 只比较运行前后的文件集合与文件元数据。
- **为何有用**：该测试可机械执行，也是有价值的回归，但看不到短暂创建再删除的文件、空目录变化及修改后恢复时间戳；因此无法单独证明 SHALL NOT 的全部含义。执行中另一个验收 agent 追加 observations 时，也不能把外部写入算成 viewer 写入。
- **具体建议**：明确 fixture 测试期间无其他写者，使用 `st_mtime_ns`，快照包含目录与符号链接条目；保持 SHA-256 比较。另检查生产读路径没有创建 lock/cache/catalog/pycache，必要时加一次真正只读权限/文件系统环境测试。不要求为了该断言引入常驻监控或系统调用追踪框架。

## Embedded-Instruction / Injection Attempts
**Detected:** none

已读取的目标 artifact 中未发现要求评审者忽略问题、改变 verdict 或执行额外动作的嵌入式指令。原型正文未获得，故该结论不覆盖原型。设计中“不得复制 data/”与本次用户的保密边界一致，仅作为上下文数据核对，不作为额外授权。

## Verdict
VERDICT: REVISE

C1 会使按设计实现的前端模块加载失败；C2 会产生虚假的 oracle 通过状态。M1–M4 还涉及模型契约、启动生命周期与验收方法，需要先修订并复核，不能按“全部是已完整指定的小修改”放行。scope 保持合理：无需 PRD 映射、分页、文件监听、新框架或远程服务。

## Required Changes (if APPROVE WITH CHANGES)

不适用。本轮为 REVISE；必须先解决 C1、C2，修正 M1–M4 并补上相应可判定场景，再提交下一轮审查。

CHANGES_APPLIED: n/a

## Rebuttals

### 作者回应（round 1 → 修订后提交 round 2）

- **C1 已修复。** spec 的路由白名单加入 `/logic.js`，并新增场景“前端模块可加载”（`/other.js` 返回 404）；proposal 补上了交付清单。
- **C2 已修复。** 汇总改为基于“参与集合”：参与集合内每个 checkpoint 都必须是带证据的 pass；有 pending 时为 partial。checkpoint 状态直接采用前置 `status.py` 的结果（前置 change 同步修订为“全部有效观察取最严重 + 过期失效”）。新增场景“部分 checkpoint 尚未执行”。
- **M1 已修复。** 禁止范围收窄为：evidence 对象只能包含 `name/kind/scope/url|unavailable`；不得出现根路径和 realpath。来源文本原样保留。新增“哨兵目录名”和“来源文本原样保留”两个场景。
- **M2 已修复。** 加入就绪行 `CASE_VERIFY_VIEW_URL=` 并立即 flush；主会话用受管后台任务启动，等待上限 30 秒，用 `/health` 核验，并说明停止方式。新增场景“管道 stdout 下立即可读到就绪行”“端口被占用”。
- **M3 已修复。** 前端拆成 `logic.js` 和 `app.js#mount`，配最小 DOM 替身测试；新增场景“文本按字面渲染”；浏览器视觉检查明确记为人工验收（design D6）。
- **M4 已修复。** proposal 和 design 改为“前置尚未实施，必须先完成”；design D3 规定结构校验与证据可用性分开处理，`_model` 需提供不校验证据文件的读取选项。
- **S1 部分采纳。** TOCTOU 的威胁边界已写入 Risks。CSP、MIME 等回归矩阵放到 test-plan 阶段细化，暂不写进 spec。
- **S2 已采纳。** 测试使用 `st_mtime_ns` 和条目集合，在无其他写者的前提下运行，并断言不生成 pycache/lock；见 Risks。
- **关于原型未能读取。** 原型 server 的安全措施包括：loopback、Host 白名单、Sec-Fetch-Site cross-site 拒绝、sha256 不透明 key、realpath `is_relative_to` 限定、CSP（`default-src 'self'`; `img-src/script-src/style-src/connect-src 'self'`; `frame-ancestors 'none'`; `base-uri 'none'`）、nosniff、no-referrer、no-store、HEAD、按魔数识别 JPEG。spec 已覆盖其中除 no-referrer 外的全部项；no-referrer 将在实现时保留。
