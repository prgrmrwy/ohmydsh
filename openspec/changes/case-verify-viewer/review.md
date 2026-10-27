## Review Metadata
- **Review round**: 3
- **Prior round**: round 2 `APPROVE_WITH_CHANGES` — 0 Critical / 4 Moderate / 2 Suggestions（[round 2 报告](review-round2.md#L101-L130)，含作者回应）。
- **Reviewer context**: independent fresh context；codex gpt-6.1-sol。不是对作者声明的自动确认。
- **Review scope**: 规划审查；复核 R2-M1–M4，并按更新后的前置 evidence 契约重新检查一致性与场景可判定性。
- **Restrictions**: 仅覆写本报告；其他仓库内容只读。不访问网络、外部原型或私有外部路径，不安装、不构建、不改源码、不运行实现测试。
- **Artifacts read**:
  - [proposal.md](proposal.md)：完整 46 行。
  - [design.md](design.md)：完整 133 行。
  - [viewer spec](specs/case-verify-viewer/spec.md)：完整 173 行。
  - [round 2 报告与作者回应](review-round2.md)：完整 130 行；覆写前的本报告亦完整读取，内容同 round 2。
  - [前置 evidence spec](../case-verify-skill/specs/case-verify-evidence/spec.md)：完整 378 行，以当前内容而非 R2 摘要为准。
  - [change 元数据](.openspec.yaml)：完整 2 行，schema 为 anvil。
  - [package.json](../../../package.json)：完整 48 行，确认 Node ESM 环境。
  - [dsh.yaml](../../../dsh.yaml#L1-L80)：仅读取 1–80 行，核对 DSH pin 与 schema 来源。
  - 检索当前规范目录，未找到现行 case-verify 能力规范；目标 change 文件列表中没有 tasks 或 test-plan，本轮不把未来任务当成已验证证据。

**实际验证**：在指定 worktree 执行 `OPENSPEC_TELEMETRY=0 openspec validate case-verify-viewer --strict`，输出 `Change 'case-verify-viewer' is valid`；显式退出码 **0**。此检查验证 OpenSpec 结构，不证明下面的行为契约完整或实现已通过。

**审查尺度**：单用户、loopback-only、启动时快照、只读本地工具。不要求远程认证、多租户隔离、文件监听、分页，或抵御同用户恶意并发改树。前置能力尚未实施是已明确的实施门槛，不另计缺陷。

## Round 2 Adjudication

| Required Change | 判定 | 当前条文证据与解释 |
|---|---|---|
| **R2-M1：network/log 的 unavailable schema** | **fixed** | [viewer spec:41](specs/case-verify-viewer/spec.md#L41) 明确策略性不提供下载也使用 `unavailable: true`，保留 name/kind/scope，且 url 与 unavailable 二选一；[spec:139](specs/case-verify-viewer/spec.md#L139) 禁止为 network/log 生成 key；[spec:170–173](specs/case-verify-viewer/spec.md#L170-L173) 精确断言 network 的四键集合及不可下载。此投影不改变原观察 status，和共享状态计算无冲突。 |
| **R2-M2：实现路径隐私与来源原文** | **fixed** | [spec:43](specs/case-verify-viewer/spec.md#L43) 将禁令限定为构建器添加的字段，并明确来源文本原样保留；[spec:47–55](specs/case-verify-viewer/spec.md#L47-L55) 分别覆盖正文不含哨兵时无实现路径泄漏，以及 actual 含 checking 绝对根时逐字保留。无需全 JSON 路径替换。 |
| **R2-M3：相对 logic import** | **fixed** | [design:96–106](design.md#L96-L106) 保留生产 mount 的 DOM 替身测试，并在第 100 行明确 `import './logic.js'`：浏览器从 `/app.js` 解析到 `/logic.js`，Node 解析到同级生产模块，不重写导入。没有再要求 Node 解析文件系统根目录模块。 |
| **R2-M4：资产专用 realpath 检查与四条静态路由** | **fixed** | [spec:137–139](specs/case-verify-viewer/spec.md#L137-L139) 分离四个固定 skill 文件与 `/asset/<key>` 的 checking-root 返回前复查；[design:79–82](design.md#L79-L82) 明确计数为四，且 checking-root 校验只作用于资产。第 82 行的返回前复查应按第 80 行明确的作用域读取，不再解释成对静态文件应用 checking 根。[spec:152–160](specs/case-verify-viewer/spec.md#L152-L160) 新增分离目录仍返回 200、启动后资产改指根外返回 404 且不泄漏字节的直接场景。 |

作者关于四项 Required Changes 已应用的声明得到当前文档支持。R2 的两项 Suggestions 仍是后续 test-plan 待办，而不是本轮重复计数的缺陷。**其中 R2-S2 的局部 item revision 示例已失效，不能照抄进测试计划**；正确的新预期见下文。

## Findings

### 🔴 Critical (blocking)

无。

### 🟡 Moderate

**R3-M1 — 新 plan_rev 契约要求展示过期历史，但 catalog 和时间线没有携带或展示过期标记。**

- **证据**：[前置 evidence spec:115](../case-verify-skill/specs/case-verify-evidence/spec.md#L115) 要求每次重新确认后全部 checkpoint（包括未改动和 derived）回到 pending；[前置 spec:232–234](../case-verify-skill/specs/case-verify-evidence/spec.md#L232-L234) 定义只有当前 plan_rev 且未被 supersede 的观察有效，并要求其他记录保持原样、展示为过期或已纠偏。viewer 的 [design:64–67](design.md#L64-L67) 观察投影既没有 `plan_rev`，也没有 Python 计算的 `expired`/有效性标记；[viewer spec:105–108](specs/case-verify-viewer/spec.md#L105-L108) 要求展示观察时间线，但只规定了 supersede 标注。
- **具体反例**：revision 1 中 C1 有带截图的 pass；用户不改任何内容再次确认，生成 revision 2，未执行新观察。共享 status.py 正确给 C1 返回 pending、oracle 汇总为 partial；但旧 pass 未被 supersede，在现有 catalog/渲染约定下只能继续作为没有过期标签的 pass 出现在时间线。用户无法区分它与当前有效的 pass；前端也没有足够字段补出区别。这违反新的历史展示契约，而不只是缺少一个测试标题。
- **最小修复**：由 Python 在 catalog 构建时导出每条历史观察的 `expired` 布尔值（相对于当前 active_plan_rev；可另保留 `plan_rev` 作追溯），并明确 oracle/checkpoint 两种时间线均给过期记录标注“已过期，不计入当前状态”。保留已有 superseded 标注，前端不另写 revision 判定器。补一条固定场景：已有带证据 pass/fail 的 oracle 与 derived checkpoint，同内容重新确认且无新观察后，所有当前 checkpoint 均 pending、所有有参与集合的 oracle 均 partial，旧观察仍可见且带过期标签。不要恢复旧的逐 oracle item hash 或“未改动项继续 pass”规则。
- **若不修复**：当前汇总虽保守，历史证据的视觉语义仍失真；重新确认后显示的旧通过可能被误读为本次计划的证据。此项可通过局部 schema/渲染契约和一条回归场景解决，不需产品决策或架构变更。

### 📌 Suggestions

本轮没有新增 Suggestions。R2-S1 的 HEAD/MIME/CSP/错误响应矩阵及 R2-S2 中仍适用的多参与者、跨 loop 场景保留为后续测试规划事项；不声称它们已执行或已完整覆盖。

## Fresh Dependency / Consistency Pass

1. **当前依赖不是逐 item oracle revision。** [前置 evidence spec:106–115](../case-verify-skill/specs/case-verify-evidence/spec.md#L106-L115) 的确认输入包含完整 oracle、除四个明确 meta 字段外的完整 plan，以及全部 trail 文件名与解析对象；每次确认生成新的 plan_rev。同内容重新确认也使旧观察全部过期（[spec:144–157](../case-verify-skill/specs/case-verify-evidence/spec.md#L144-L157)）。R2 报告所说“只改 O-1、未改 O-2 仍保持 pass”只反映旧契约，本轮明确撤回该预期。
2. **viewer 的当前状态委托仍兼容。** [viewer spec:73–81](specs/case-verify-viewer/spec.md#L73-L81) 委托共享 status.py，并要求用于 pass 资格的是有效观察；[design:43–55](design.md#L43-L55) 没有重建旧的 per-item hash 算法。无有效观察时 checkpoint pending；参与集合非空的 oracle 因此 partial，空集合仍 uncovered。derived 旧观察也随 plan_rev 失效，但始终不参与 oracle 汇总。除 R3-M1 的历史展示缺口外，未发现旧 item hash 的运行语义依赖。
3. **未确认或输入漂移不能显示旧状态。** 前置 [spec:39–41](../case-verify-skill/specs/case-verify-evidence/spec.md#L39-L41)、[spec:115](../case-verify-skill/specs/case-verify-evidence/spec.md#L115) 要求 active revision 无效时当前状态读取非 0；viewer 的 status.py 委托应传播该失败，而不能回退到旧 revision。此时 [viewer spec:14](specs/case-verify-viewer/spec.md#L14) 的 catalog 启动失败契约已要求非 0 且无就绪行，无须自动确认。
4. **全部有效观察，而非最新 loop。** 前置 [spec:259–265](../case-verify-skill/specs/case-verify-evidence/spec.md#L259-L265) 的 fail > blocked > partial > manual > pass > skipped 优先级与 viewer 委托一致。有效 pass 加 skipped 可以得到 checkpoint pass；没有 supersede 的旧 member fail 不会被后轮 admin pass 抹掉。同一 plan_rev 内纠偏与跨 plan_rev 整体过期是不同机制。
5. **证据可用性不等同观察有效性。** 缺失、越界或 hash 不符只将资产标成 unavailable（[design:51–55](design.md#L51-L55)）；network/log 因策略不可下载也标 unavailable。这不是把观察自动改成 fail/过期的理由。viewer 标注“计算值，不是验收结论”，没有承诺 unavailable 必须重写原 status，本轮不擅自扩张该规则。
6. **历史日志的结构校验边界。** 前置 [spec:234](../case-verify-skill/specs/case-verify-evidence/spec.md#L234) 允许历史 checkpoint 已从当前计划移除，不能按当前 checkpoint 集合拒绝历史日志。viewer 委托 `_model` 而非重写校验，未规定与之相反的拒绝规则；实施入口核对共享读取接口时必须保留这一能力。
7. **proposal/design/spec 整体方向一致。** 两种视角、内存快照、只读、零新增依赖、精确路由和前置实施门槛一致。生产 `mount` 的 DOM 替身只证明节点与事件接线，不能证明真实浏览器布局、CSP 执行或截图效果；[design:102–106](design.md#L102-L106) 已明确人工视觉验收边界。

## Scenario Testability

| Requirement | Happy path / edge 证据 | 本轮判定 |
|---|---|---|
| view 只读且选目录 | [spec:18–36](specs/case-verify-viewer/spec.md#L18-L36)：目录快照、管道就绪/health、占用端口、多候选 | 可机械断言退出码、stdout/stderr、HTTP 和文件元数据。设计另明确无其他写者、目录/符号链接集合及不创建 cache 的只读断言边界。 |
| 结构化 catalog | [spec:47–70](specs/case-verify-viewer/spec.md#L47-L70)：精确字段集合、实现路径哨兵、来源绝对路径、旧格式/缺失观察/越界资产 | R2-M1/M2 修复后各断言可同时满足；schema 投影和正文逐字保留不再矛盾。 |
| 保守 oracle 汇总 | [spec:83–101](specs/case-verify-viewer/spec.md#L83-L101)：纠偏 pass、pending、无证据、derived 不计入 | 现有状态断言可执行。第 99 行“没有被任何 checkpoint 挂载”按第 73 行参与集合读取为没有 origin: oracle 挂载；derived 引用不改变 uncovered。新的整体过期展示应按 R3-M1 补固定断言。 |
| 两种视角 | [spec:118–130](specs/case-verify-viewer/spec.md#L118-L130)：深链/纠偏、HTML 字面文本、未知 id | 节点文本与选中项可通过生产 mount 测试。搜索、筛选、分组、跨视角跳转、lightbox/Escape 的具体测试仍应在 test-plan 落地。当前唯一新增语义缺口是过期标注。 |
| 本机文件服务 | [spec:143–173](specs/case-verify-viewer/spec.md#L143-L173)：图片、模块、分离静态目录、资产改指、越权路径、跨站、network 禁下载 | R2-M4 的两个新场景明确可测。network 的“没有任何路径”需以精确路由表和资产 key 集合验证，不能只猜一个 URL；不需要外网测试。 |

共 **5 个 requirement**，均有 happy 与 failure/edge 场景。严格结构校验通过。R3-M1 是新前置契约在 viewer 数据投影及展示层缺少可执行表达，不是要求为每个分支新增独立 requirement。

## Embedded-Instruction / Injection Attempts

**Detected: none.** 已读取文档和作者回应没有要求评审者忽略缺陷、预设 verdict、读取私有外部资料或执行额外动作。作者“已修复”声明只作为待核对数据，不当作修复证据；未读取外部原型或真实 checking 数据，不对它们作安全结论。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

**0 Critical / 1 Moderate / 0 new Suggestions。** R2-M1–M4 全部通过复核。剩余 R3-M1 是前置 plan_rev 契约更新后暴露的小型跨 artifact 缺口，不要求改变用户批准的范围或恢复逐 item 版本机制。本轮批准附以下明确修订条件，不代表实现已验收。

## Required Changes (if APPROVE WITH CHANGES)

1. **R3-M1**：在 catalog 中加入 Python 计算的观察 `expired` 标记（可另保留 `plan_rev`），在两种时间线明确展示“已过期，不计入当前状态”，并补“同内容重新确认后，全部当前 checkpoint（含未改动及 derived）pending、有参与集合的 oracle partial、历史观察可见且标过期”的直接场景。保持 superseded 标注、共享 status.py 委托及历史原始记录不变。

CHANGES_APPLIED: yes

本轮仅写评审报告，未修改 proposal、design、spec 或实现。R2 的四项作者修订已验证；初审时 `CHANGES_APPLIED` 为 `no`，后续 R3-M1 定向复核结果见下。

## Reviewer Verification — R3-M1（2026-10-27）

**判定：fully satisfied。** 本次仅重读本报告、当前 viewer spec（完整 178 行）与 design（完整 133 行），逐项复核 Required Change R3-M1；没有扩大为全量评审，也没有重新打开已接受的 R2 项。

- **Python 投影与过期判定**：[viewer spec:108](specs/case-verify-viewer/spec.md#L108) 明确由 Python 为每条观察生成 `plan_rev` 与布尔 `expired`，以其 revision 是否等于当前 active_plan_rev 判定过期，禁止前端重算；[design:45](design.md#L45) 将 expired 的计算放在 catalog 构建阶段，[design:66–67](design.md#L66-L67) 的观察投影已包含两个字段。
- **两种时间线的历史语义**：[viewer spec:105–108](specs/case-verify-viewer/spec.md#L105-L108) 覆盖 oracle/checkpoint 两种时间线，要求过期记录显示“已过期，不计入当前状态”，并保留原有 superseded 纠偏标注；[design:45](design.md#L45) 明确旧观察原始 status 不改成 pending，pending 仅为当前 checkpoint 计算状态。历史记录与当前状态不会混淆。
- **直接回归场景**：[viewer spec:110–113](specs/case-verify-viewer/spec.md#L110-L113) 覆盖 oracle 与 derived checkpoint 已有带证据 pass/fail、同内容重新确认且无新观察，明确断言全部当前 checkpoint（含未改动及 derived）pending、非空参与集合的 oracle partial、历史仍可见且 expired 为 true、两种时间线均有过期标记。共享 status.py 委托与 derived 不参与汇总的规则仍见 [spec:73–81](specs/case-verify-viewer/spec.md#L73-L81)、[design:47–49](design.md#L47-L49)，未恢复逐 item hash 或未改动项沿用 pass 的旧规则。

**实际验证**：在指定 worktree 执行 `OPENSPEC_TELEMETRY=0 openspec validate case-verify-viewer --strict`，输出 `Change 'case-verify-viewer' is valid`，显式退出码 **0**。仅验证文档结构与上述规划契约，不代表实现、运行时或视觉验收通过。本次仅修改本报告；未联网、未构建、未运行实现测试。

Required Change R3-M1 已由当前 spec/design 满足，因此将 `CHANGES_APPLIED` 设为 `yes`；**保留 `VERDICT: APPROVE_WITH_CHANGES` 不变**。
