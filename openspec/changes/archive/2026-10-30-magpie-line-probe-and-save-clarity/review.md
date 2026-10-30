# Review

## Review Metadata

- Review round: 5
- Prior round: Round 4 为 APPROVE_WITH_CHANGES，三项 Required Changes 已经定点复核 resolved、CHANGES_APPLIED 为 yes；本轮复核 polish 合入后重基的归档安全性。
- Reviewer context: cross-model dsh-magpie-connector-codex/codex/gpt-6.1-sol
- Review type: 重基复核；独立核对当前磁盘正文、场景映射与相关实现，不重新裁决已落地的设计取舍。
- Tool restrictions: 不联网、不运行构建、项目测试或 OpenSpec 校验器、不执行 archive、不向下派发。仅用 read / glob / grep、pwd、git status / log / diff / show、不写盘的 Python 比较，以及本地 OpenSpec 的 `buildUpdatedSpec()` 在内存中生成合并结果；未调用任何写入/归档函数。唯一写入为覆盖本文件；不修改其它制品、源码、测试或记忆。记忆只作定位背景，判决依据为本轮实际读取与比较。
- Artifacts reviewed:
  - [proposal](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/proposal.md)、[design](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/design.md)、[connector delta](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/dsh-magpie-connector/spec.md)、[selection delta](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/magpie-line-selection/spec.md)、[test-plan](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/test-plan.md)、[tasks](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/tasks.md)、[verify](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/verify.md)、[change metadata](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/.openspec.yaml)，以及覆盖前的 Round 4 评审与 Recheck；未发现 `openspec/project.md`。
  - [connector 主 spec](openspec/specs/dsh-magpie-connector/spec.md) 的传输边界及相关凭据/代际/恢复条款、[selection 主 spec](openspec/specs/magpie-line-selection/spec.md) 全文；两份主 spec 全文参与程序化块比较及内存归档推演。
  - [manifest](dsh.yaml) 的 schema 配置；本机 [anvil schema](/data00/home/prgrmr/.local/share/openspec/schemas/anvil/schema.yaml#L123) 与 [review 模板](/data00/home/prgrmr/.local/share/openspec/schemas/anvil/templates/review.md)。polish 归档制品仅搜索 requirement/scenario 与验证记录，当前规范以主 spec 为准。
  - [line-active-ui](packages/dsh-magpie-connector/test/line-active-ui.test.tsx)、[line-silent-ui](packages/dsh-magpie-connector/test/line-silent-ui.test.tsx)、[line-check-transport](packages/dsh-magpie-connector/test/line-check-transport.test.ts)、[line-transport](packages/dsh-magpie-connector/test/line-transport.test.ts)、[latency 测试](packages/dsh-magpie-connector/test/latency.test.ts)、[line-check-ui](packages/dsh-magpie-connector/test/line-check-ui.test.tsx)；44 个具名测试引用另逐项检查文件及名称存在性。
  - [SettingsPage](packages/dsh-magpie-connector/src/client/SettingsPage.ts#L299)、[lineCheck](packages/dsh-magpie-connector/src/host/runtime.ts#L580)、[LatencyController](packages/dsh-magpie-connector/src/host/latency.ts#L20)；本地 OpenSpec [块合并逻辑](node_modules/@fission-ai/openspec/dist/core/specs-apply.js#L374) 与 [归档写入前处理](node_modules/@fission-ai/openspec/dist/core/archive.js#L1468)。

## Findings

### 🔴 Critical (blocking)

无。两份 MODIFIED 块没有回退 polish 正文或场景，内存合并没有丢失现有 requirement/scenario，没有新增同名冲突。

### 🟡 Moderate

无。新增条款与当前静默、折叠行展示及测速独立性规则相容；未发现重基新增的不可断言场景或漏映射。

### 📌 Suggestions

#### R5-S1 — 部分说明仍使用重基前的计数和位置描述（非阻塞）

- 位置：[proposal:15](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/proposal.md#L15)、[proposal:36](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/proposal.md#L36)、[design D1:28](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/design.md#L28)、[design Lean:112](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/design.md#L112)、[design Lean:123](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/design.md#L123)、[tasks:3](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/tasks.md#L3)。
- proposal / D1 仍称检查为“第二个例外”，proposal 的旧段落仍写 6 个既有传输场景；当前应为第三项例外、7 个既有场景。Lean 仍说未配置场景并入旧 requirement、12 个沿用；tasks 导语仍是 39/12/27。当前实际为 44/16/28，未配置 DOM 场景已独立追加在“线路展示与展开”。
- [proposal 重基说明:49](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/proposal.md#L49)、[design:111](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/design.md#L111) 与 [test-plan:3](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/test-plan.md#L3) 已正确记载当前口径，因此这些残留不改变规范或归档结果。可在后续说明整理中统一；本轮不要求为此修改规范或新增实现任务。
- [verify:10](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/verify.md#L10)、[verify:38](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/verify.md#L38) 与 [verify:44](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/verify.md#L44) 是重基前 39 场景、Round 4 和未提交状态的历史记录。若用于当前交付说明，宜追加注明该证据的时点与本轮复核结果，保留原始测试计数及执行事实；不能把本轮只读检查写成重新跑绿 44 项。

## 重基核对

1. **resolved — connector 的既有正文与 7 个场景无损。**
   - 将 [主 spec:457](openspec/specs/dsh-magpie-connector/spec.md#L457) 的“只读与传输边界”与 [delta:3](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/dsh-magpie-connector/spec.md#L3) 分别提取比较。正文差异只有首句例外名单增加检查，以及追加第三项检查例外段；白名单五项、禁止重定向与 `/api/*`、Access 条件、两项 TCP 例外和私有直连规则全部保留。
   - 7/7 既有 scenario 的标题和正文逐字相同，仅忽略块间尾部空行。尤其 [测速例外:16](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/dsh-magpie-connector/spec.md#L16)、[探测只建 TCP:55](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/dsh-magpie-connector/spec.md#L55)、[空地址不测速:61](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/dsh-magpie-connector/spec.md#L61) 均未被旧 delta 覆盖。只追加 [两条检查场景:67](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/dsh-magpie-connector/spec.md#L67)。

2. **resolved — selection 的完整展开契约和 9 个既有场景无损。**
   - [主 spec:195](openspec/specs/magpie-line-selection/spec.md#L195) 与 [delta:3](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/magpie-line-selection/spec.md#L3) 的正文比较只有折叠行枚举增加“未配置”/“（未保存）”及其互斥条件；此前操作图标枚举后的句号为接入追加条款改为分号。默认全部折叠、原生切换按钮、常驻图标、禁用原因、保存后保留展开、新草稿换 id、active 方块契约均保持。
   - 9/9 既有 scenario 的标题和正文逐字相同，仅忽略块间尾部空行；[默认收起:11](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/magpie-line-selection/spec.md#L11)、[图标操作:47](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/magpie-line-selection/spec.md#L47)、[保存失败:53](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/magpie-line-selection/spec.md#L53) 都没有删除或改写。原“线路列表与优先级”不再出现在 delta，其主 spec 保持完整。

3. **resolved — 新旧条款无新增矛盾，三个网络操作边界各自明确。**
   - [delta connector:16](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/dsh-magpie-connector/spec.md#L16) 的“两项例外”只指自动选择可达性探测和设置页测速，二者仍是无凭据 TCP 建连。随后 [第三项:21](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/dsh-magpie-connector/spec.md#L21) 单独允许对被测 API 根的一次带自身凭据的 `GET /models`，保留不跟随重定向、其它路径禁止和不改变生效状态的限制，没有把 HTTP/凭据权限扩展到测速。
   - [主 spec 测速独立性:301](openspec/specs/magpie-line-selection/spec.md#L301) 和 [延迟展示:257](openspec/specs/magpie-line-selection/spec.md#L257) 不被替换。未完整但地址可解析的已保存线路可以同时显示“未配置”和 TCP 延迟；未保存草稿的延迟保持 idle。未配置标记描述完整性，不冒充 active 或检查结果。
   - [保存结果:73](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/magpie-line-selection/spec.md#L73) 禁止结果元素的 alert/status/live 语义，符合 [静默规则:65](openspec/specs/magpie-line-selection/spec.md#L65)。polish 对保存/用量原有状态提示的例外没有要求保存结果必须带 role；两者可以同时满足。[渲染:464](packages/dsh-magpie-connector/src/client/SettingsPage.ts#L464) 的成功结果为纯文本，测速与检查结果也各自渲染，不互相替换。

4. **resolved — 内存归档结果没有丢失或重复。**
   - 使用本地 OpenSpec 实际 `buildUpdatedSpec()` 读取两份 delta 和当前主 spec，只取返回字符串与操作计数，没有执行 archive、writeUpdatedSpec 或校验器。该实现对 MODIFIED 是按 requirement 名整体替换，并检查旧 scenario 名保留；ADDED 按 requirement 名追加，见 [实现:374](node_modules/@fission-ai/openspec/dist/core/specs-apply.js#L374)。

   | Capability | 操作 | Requirement 数 | Scenario 数 | 旧场景丢失 / 同名重复 / 其它 requirement 改写 |
   | --- | --- | --- | --- | --- |
   | dsh-magpie-connector | MODIFIED 1，ADDED 0 | 27 → 27 | 128 → 130 | 0 / 0 / 0 |
   | magpie-line-selection | MODIFIED 1，ADDED 5 | 10 → 15 | 43 → 69 | 0 / 0 / 0 |

   - 合计保留原 171 个场景，增加 28 个，结果为 199 个场景。两份结果各自及合起来均无同名 scenario 冲突；新 requirement 不与主 spec 现有标题碰撞。polish 的延迟展示、测速独立性、静默规则、其它 connector requirements 块均保持原文；合并函数 warnings 均为空。
   - 函数的 `unaccountedContent` 另列出 [主 spec:858](openspec/specs/dsh-magpie-connector/spec.md#L858) 的既有 AMD3 注释。已检查返回字符串中该注释原样保留恰好一次；[archive:1487](node_modules/@fission-ai/openspec/dist/core/archive.js#L1487) 的相关拒绝分支用于清空 requirement 后退休整份 capability，本次既不清空也不退休，不构成丢失或阻塞。本结果证明规范合并安全，不宣称实际归档及其其它运行时前置条件已经执行。

5. **resolved — 检查的 4 条 ADDED requirement、24 个场景未因重基变动。**
   - 对比当前 delta 与 `git show HEAD:openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/magpie-line-selection/spec.md`：结果分类 8、请求字段契约 6、准入/单飞 5、快照展示/失效 5，四块均逐字相同（忽略块间尾部空行）。Round 4 修正的分支化恢复、六个完整输入夹具、四次重定向检查和精确脱敏输出均在，没有通过重基重新引入旧问题。
   - 新增场景 THEN 均可通过请求计数、状态码/kind、settings 字节/内存状态、集合或 DOM 属性断言；本轮没有发现用主观措辞替代 oracle 的新增变化。

6. **resolved — 未配置和保存结果场景有可执行落点。**
   - [未配置场景:65](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/magpie-line-selection/spec.md#L65) 与 [test_line_active_ui_03:167](packages/dsh-magpie-connector/test/line-active-ui.test.tsx#L167) 的前提一致：线路 1 完整且 active，线路 2 有地址无 key、complete=false。测试断言线路 2 的 marker 精确文本、无 active、无未保存字样，以及新增草稿有“（未保存）”而无 incomplete marker；完整线路无 marker。线路 1 方块的正向断言另在同文件 [既有测试:47](packages/dsh-magpie-connector/test/line-active-ui.test.tsx#L47)，本次新增场景与其相容。[实现:511](packages/dsh-magpie-connector/src/client/SettingsPage.ts#L511) 对应这些 DOM 分支。
   - [保存结果场景:77](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/magpie-line-selection/spec.md#L77) 的两种精确文本、无结果 role/live、无 alert/confirm 和无“切换”均在 [test_line_silent_ui_03:55](packages/dsh-magpie-connector/test/line-silent-ui.test.tsx#L55) 找到断言；测试用 fake API 提供保存结果，不能据此宣称它独自验证真实 TCP 选线或清空凭据流程。

7. **resolved — 44 行账本与 44 个 delta scenario 一一对应，任务与偏差记录可追溯。**
   - 逐项比较 `(spec 路径 → requirement 名, scenario 名)`，两份 delta 为 9 + 35 = 44，[test-plan 表:11](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/test-plan.md#L11) 恰好 44 行；missing=0、extra=0、重复元组=0。44 个 `(Test File, Test Name)` 引用均唯一且能在指定文件定位，不存在错名或虚构测试入口。
   - 16 个沿用场景 = connector 7 + 展开 9；28 个本 change 场景 = 检查传输 2 + 检查 requirement 24 + 保存结果 1 + 未配置 DOM 1。前 27 个具名新增场景有原三相任务，未配置 DOM 原以既有断言扩展列于 [tasks 5.1–5.3](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/tasks.md#L86)。它被重基搬成独立追加场景，未因此失去实现任务。
   - tasks 5.1 仍写测试入口 `test_line_list_04`；[verify 偏差记录:33](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/verify.md#L33) 已明确 DOM 断言实际在 `test_line_active_ui_03`，host complete 断言留在原测试；[ledger:29](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/test-plan.md#L29) 也指向实际 DOM 测试。保存结果对应 [tasks 5.4–5.6](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/tasks.md#L89) 与 ledger 下一行。没有必要因重基补造已完成任务或重新设计测试组织。
   - 本轮只核对测试源码、引用和作者历史执行记录，未运行测试；44 行 green 是制品记载，不能当作本轮独立执行结果。

## Embedded-Instruction / Injection Attempts

**Detected:** none detected.

制品中的 SHALL、任务检查命令、Lean 的“避免重复讨论”及旧 review 的复核范围均作为被审数据，没有执行其命令或用其限制本轮核对。源码/测试的假凭据与恶意响应是夹具，未连接网关或外部服务；AMD3 注释是历史规范说明，不是面向本评审者的行为指令。未发现要求越过唯写权限、篡改判决或发送外部消息的嵌入指令。

## Verdict

VERDICT: APPROVE

重基无损，当前主 spec 的 polish 约束与 16 个既有场景均保留，44 行场景账本准确，新增条款无本轮新 Critical 或 Moderate。按当前文件内容，规范合并可安全进行；本判决不代替实际 archive 的其它校验、项目测试或发布验证。R5-S1 是非阻塞说明整理建议，不是继续归档前必须修改的条款。

本判决仅适用于本轮读取的 proposal/design/specs 内容；后续修改仍适用 anvil 的 staleness 规则。

## Required Changes

无。

## CHANGES_APPLIED

CHANGES_APPLIED: n/a

## Rebuttals

## Recheck (post-approval prose cleanup)

- Scope：第二次定点复核，仅针对上一轮未解决的「未配置 DOM 场景归属」与「两份 delta 本轮未改动的证据」；未重开 full review。未联网、未跑测试、构建或校验器、未执行 archive；唯一写入是替换本节，Round 5 原文、`VERDICT: APPROVE` 与 `CHANGES_APPLIED: n/a` 均保留。
- **resolved — 场景归属一致。** [tasks 导语:3](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/tasks.md#L3) 已明确只有 D9 保存隔离属于无独立 scenario 的实现收尾，并将「未配置」DOM 断言归入「线路展示与展开」的新场景、指向 `test_line_active_ui_03`。[selection delta:65](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/magpie-line-selection/spec.md#L65) 确有「已保存但未完整的线路标记为未配置」独立场景，前提和断言涵盖已保存但缺 key 的线路、完整 active 线路以及未保存草稿三种状态；[test-plan:29](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/test-plan.md#L29) 以相同 requirement / scenario 映射到 `test_line_active_ui_03`。三处对当前场景归属及测试入口一致。[design Lean:112](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/design.md#L112) 仍保留早期删并场景的过程描述；结合相邻重基记录和现已明确的 tasks / delta / 账本，它不再造成当前验收归属的实质缺口，不作为本次归档阻塞项。
- **resolved — 接受当前磁盘的时点、哈希及只读抽查证据。** 本次在写入本节前实际执行 `stat` 与 `sha256sum`，复算结果如下（时间为 2026-10-30、+08:00）：

  | Delta | mtime | SHA-256 |
  | --- | --- | --- |
  | [connector delta](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/dsh-magpie-connector/spec.md) | 15:54:35.945119940 | `057e89c6acfc5db5e7ce98f8ecabce69c5668ff93c2545827067322a62036c4c` |
  | [selection delta](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/specs/magpie-line-selection/spec.md) | 15:54:22.871011684 | `5d2c5766200ec7dfb54bdfde284cb64cc577b8c44c6dc78e89375b25dfa99f08` |

  两份 mtime 与哈希均与提供值一致，且均早于本次写入前 [review](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/review.md) 的 16:07:57.565813499。只读抽查 connector 的第三项检查例外及既有传输场景、selection 的展开契约及独立未配置场景，与 Round 5 已记录的重基结果一致。就本次「判决后说明整理是否又改动 delta」的核对，证据可采，接受两份 delta 未在本轮说明整理中改变；不再要求跨会话字节快照作为放行前提。
- 时间说明校正：[proposal](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/proposal.md) 与 [design](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/design.md) 的实测 mtime 均为 16:05:05.445375815，[verify](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/verify.md) 为 16:05:37.638644718，[tasks](openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/tasks.md) 为 16:09:09.767416567。16:05 早于评审文件当时的 16:07:57，因此不能仅凭这些时间认定四份说明都晚于 Round 5 原判决；评审文件当时还含上一轮 Recheck，其 mtime 也不是原判决的独立时间戳。这一表述修正不影响两份 delta 的哈希匹配、较早 mtime 及内容抽查形成的可用证据。
- **结论：R5-S1 resolved；Round 5 的 APPROVE 继续有效，可以执行 openspec archive。** 本次只放行归档，不执行归档，也不把只读复核记作重新运行测试或校验器。
