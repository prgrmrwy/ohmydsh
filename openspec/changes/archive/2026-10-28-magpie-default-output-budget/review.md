## Review Metadata
- **Review round**: 2
- **Prior round**: round 1 — VERDICT: REVISE（C1 小窗口无法保证正压力；C2 Responses 最小 16 冲突；M1–M5）
- **Reviewer context**: cross-model fresh-context subagent (traex/GPT-6.1-Sol, high effort; author was Claude Opus 5.5)
- **Tool restrictions**: read-only inspection; only write is review.md
- **Artifacts reviewed**:
  - [proposal.md](<openspec/changes/magpie-default-output-budget/proposal.md>)
  - [design.md](<openspec/changes/magpie-default-output-budget/design.md>)
  - [delta spec.md](<openspec/changes/magpie-default-output-budget/specs/dsh-magpie-connector/spec.md>)，完整对照 [当前规范](<openspec/specs/dsh-magpie-connector/spec.md>)
  - 首先读取原有 round-1 评审及作者 Rebuttals；随后独立核验本地目录、适配器、默认 effort、目录与生成测试及全部 test/support，仓库与 launcher compat 的 dsh-llm、pi-ai、compaction-basic，以及固定 Magpie 提交的相关源码。Rebuttals 只作为待核验的陈述，不作为处理完成或用户授权的证据。

## Prior Findings Status
- **C1 — resolved**；accepted by reviewer: [delta:67–78](<openspec/changes/magpie-default-output-budget/specs/dsh-magpie-connector/spec.md#L67-L78>) 已将无条件正压力承诺改为 C ≥ 104026，并明确域外照公式保留模型、不保证通过。独立计算确认 104025 最坏预算失败、104026 成功；不再存在无法同时实现的 SHALL。
- **C2 — resolved**；accepted by reviewer: 原“请求补齐默认输出预算”要求已删除；[delta:80–91](<openspec/changes/magpie-default-output-budget/specs/dsh-magpie-connector/spec.md#L80-L91>) 仅承诺请求值原样交给 pi-ai，不再承诺所有小值在 HTTP 中与预算严格相等。[design:18、21](<openspec/changes/magpie-default-output-budget/design.md#L18-L21>) 将既有 Responses 归一化明确留在范围外；无需因此新增适配器补齐或小值拒绝策略。但对归一化触发条件的括号说明仍错误，见 N2。
- **M1 — resolved**；accepted by reviewer: [proposal:3、13–14](<openspec/changes/magpie-default-output-budget/proposal.md#L3-L14>) 与 [design:5、34–35](<openspec/changes/magpie-default-output-budget/design.md#L5-L35>) 已承认宿主物化默认值，选择最小方案：只改目录预算与 SDK 能力，不新增请求补齐。本轮重读 [dsh-llm:2169–2173、2291–2308](<node_modules/@deepseek-ai/dsh-llm/lib/index.js#L2169-L2173>) 及 launcher compat 同一路径，确认该基线。
- **M2 — resolved**；accepted by reviewer: [delta:68–78](<openspec/changes/magpie-default-output-budget/specs/dsh-magpie-connector/spec.md#L68-L78>) 已同时要求压力 > 0 与保留量 < 阈值，并加入失败侧场景。默认配置与 [compaction-basic:124–134](<packages/dsh-pet/compat/subagent/.launcher-builds/96b1a019fb2ee6b51b1a5ca7cc031df3b2516db54c813f1ea8fc42cfbd05dd43-6648104f-21fa-4e2c-b120-abcfac5e5c10/node_modules/@deepseek-ai/dsh-compaction-basic/lib/index.js#L124-L134>) 一致；边界结论正确，但新增证明中的一个上界错误，见 N1。
- **M3 — resolved**；accepted by reviewer: 无条件“没有默认预算就不写字段”已随原补齐要求删除。[delta:81](<openspec/changes/magpie-default-output-budget/specs/dsh-magpie-connector/spec.md#L81>) 保留请求 maxTokens 原样传入 pi-ai；不存在 O 缺失时覆盖显式值的条款。缺 O 且显式 maxTokens 的额外回归断言列为建议 S3，不要求新增行为。
- **M4 — resolved**；accepted by reviewer: 当前目录对象均给出 id，容量对场景明确构造带非空 id 的合法条目；[delta:27–30](<openspec/changes/magpie-default-output-budget/specs/dsh-magpie-connector/spec.md#L27-L30>) 补了五类非法容量；[delta:83–91](<openspec/changes/magpie-default-output-budget/specs/dsh-magpie-connector/spec.md#L83-L91>) 直接断言 pi-ai model.maxTokens = O 和缺 O 时的 16384 回退。未将尚未实施的测试误称已通过。
- **M5 — resolved**；accepted by reviewer: [design:20、41–42](<openspec/changes/magpie-default-output-budget/design.md#L41-L42>) 已明确不复刻手动 Max output 例外；[delta:35、52–55](<openspec/changes/magpie-default-output-budget/specs/dsh-magpie-connector/spec.md#L52-L55>) 明确统一公式与 (524288,393216) → 196608。固定提交的 OutputSet 确为 json:"-"，且模型发布对象只含输出数值，不含该标志。
- **S1 — resolved**；[design:29](<openspec/changes/magpie-default-output-budget/design.md#L29>) 已将论据改为能力语义，而非当前 stream 必然拒绝大显式值。本轮 pi-ai 假 fetch 检查确认 SDK 上限为 184464 时，两协议仍发送显式 300000，不按该元数据封顶。
- **S2 — not resolved**；[design:8、50](<openspec/changes/magpie-default-output-budget/design.md#L47-L52>) 已固定 commit 并声明未核实在线部署，但 [proposal:14](<openspec/changes/magpie-default-output-budget/proposal.md#L14>) 仍无条件宣布 Codex“实际生成不受影响”，[design:64](<openspec/changes/magpie-default-output-budget/design.md#L64>) 仍以该假设宣布 MiniMax 是“唯一”上游受影响模型。应同步证据边界，见 N3。

## Findings
### 🔴 Critical (blocking)

无。本轮未发现新的不可实现契约、破坏性操作要求或安全边界放宽。首轮两个 Critical 的核心矛盾已经通过收窄契约消除。

### 🟡 Moderate

**N1 — Decision 4 的大窗口证明把预算上界反向用作保留量上界；边界结论正确，但证明不成立。**

- **证据与反例：**[design:38](<openspec/changes/magpie-default-output-budget/design.md#L38>) 从 `B ≤ C/2 − 65536` 推出“保留量 ≤ 0.16 × (C/2 + 65536)”。实际 `C−B` 在 B 变小时变大。合法输入 C=1000000、O=1 得到 B=1、保留量 159999，明显大于所称上界 90485.76；该输入仍通过两项检查，故不是预算公式或 104026 边界错误。
- **影响：**本 change 明确选择不运行宿主压缩插件，依赖不变量证明与测试；错误证明会误导后续常量升级和边界维护。有限的 O 采样不能代替“任意合法 O”的理由。
- **最小修复：**保留公式和适用域，只替换 Decision 4 的推导：C ≥ 262144 时，`B ≤ floor(C/2)−65536`，所以 `P ≥ ceil(C/2)`、`T ≥ floor(C/2)`；同时 `R ≤ floor(0.16*C) < floor(C/2)`，故 R < T。对于 104026 ≤ C < 262144，最坏预算为 `floor(C/4)`；令 `S=C−B`，则 `R<T` 等价于同时满足 `R<floor(0.8*C)` 和 `R<S−65536`。前者由 `R≤floor(0.16*C)` 保证，后者对整数 S 等价于 `0.84*S>65536`，最小 S 为 78020；104025 的最坏 S=78019，104026 为 78020，且之后最坏 S 单调不减。如此说明为何最大 B 是最坏情况，无需枚举所有 O。

**N2 — Responses 既有行为可以不修，但“只有 O<16 或窗口极小时才会出现”的范围声明仍是首轮反例的错误复述。**

- **证据与反例：**[design:21](<openspec/changes/magpie-default-output-budget/design.md#L21>) 的括号限定遗漏调用方显式 maxTokens。C=1000000、O=393216、显式 maxTokens=1 时，与窗口或能力是否极小无关；适配器将 1 原样交给 pi-ai，SDK 仍发送 16。[Responses:230–231](<node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js#L230-L231>) 和本轮假 fetch 均确认这一点。15 同样发送 16；Chat 分别发送 1、15。
- **影响：**范围外声明正确，但错误限定会让普通大窗口模型的使用者误以为显式小值是 HTTP 硬上限，也掩盖宿主预留值与线协议值的既有差异。删除原请求补齐要求不能使这句事实变真。
- **最小修复：**将该 Non-Goal 改为：“不改变 pi-ai Responses 将有效请求 maxTokens 1–15 提到 16 的既有行为；有效值可以来自调用方显式值，也可以来自宿主补齐的默认预算。适配器仅原样传给 pi-ai，不保证该区间线协议值与本地预留严格相等。”不用新增 SDK patch、拒绝策略或配置；[proposal:13](<openspec/changes/magpie-default-output-budget/proposal.md#L13>) 的“显式值原样使用”同步澄清为宿主/适配器输入层原样保留，HTTP 仍由既有 SDK 处理。

**N3 — 在线效果的摘要仍比已核验的固定版本证据更强。**

- **证据与具体情形：**[proposal:14](<openspec/changes/magpie-default-output-budget/proposal.md#L14>) 声称 Codex 实际生成不受影响；[design:64](<openspec/changes/magpie-default-output-budget/design.md#L64>) 据此把 MiniMax 定为唯一会上游收紧的模型。但是 [design:50](<openspec/changes/magpie-default-output-budget/design.md#L50>) 明确未核实在线部署版本。本轮仅证实固定提交的 [codexBody:264–265](<https://github.com/yetone/magpie/blob/98e23350f14bfa63adc43c54271fb8fecb4fce5c/internal/provider/codex_request.go#L264-L265>) 删除字段；若在线部署或实际路由路径不同，Astra/Luna 是否同样删除尚无证据，默认上限变小也可能影响真实输出。
- **影响：**这是首轮 S2 的残留，不是已证明线上出错。但摘要与冒烟对象选择不能把“源码如此”升级为“当前部署如此”，否则可能跳过该验证的 Codex 路径。
- **最小修复：**在 proposal 的 Codex 影响句以及 design 的冒烟对象句中同步加入“以固定 commit 的对应 Codex 路径为条件，在线版本/路径未验证”。冒烟建议改成“在确认在线 Codex 路径确实删除字段后，MiniMax 是已列三种受影响模型中唯一预期在上游保留收紧字段的对象；否则先核验部署/路由，不排除 Codex”。本轮无需授权真实调用、访问凭据或强制增加其它冒烟。

### 📌 Suggestions

**S3 — 用很小的跨层回归矩阵保护“删掉重复补齐”后的边界，不要把显式 B 的直调测试当成宿主默认路径证明。**

[delta:83–91](<openspec/changes/magpie-default-output-budget/specs/dsh-magpie-connector/spec.md#L83-L91>) 已能证明能力分离；但正常场景显式传 184464，回退场景只用 Chat、无 O、无显式值。现有 [generate.test:14–20](<packages/dsh-magpie-connector/test/generate.test.ts#L14-L20>) 都直调适配器，且 [wire:1–5](<packages/dsh-magpie-connector/test/support/wire.ts#L1-L5>) 的模型没有容量字段。

实施时可补三类小断言：两协议经公共 llm 服务不指定 maxTokens 时，宿主配置与 HTTP 均为 B；O 缺失、显式 100 时 SDK 回退 16384 而 HTTP 为 100；有 O、有 B 但直调适配器不指定 maxTokens 时，HTTP 仍省略字段。既有代码已经支持后两项，不需要为了测试新增产品行为。这是集成覆盖建议，不恢复首轮被删除的补齐要求。

**S4 — 非法容量场景再加“一个非法、另一个合法”，避免联合省略测试遗漏缺字段分支。**

[delta:28–30](<openspec/changes/magpie-default-output-budget/specs/dsh-magpie-connector/spec.md#L27-L30>) 五组都让 C、O 同时非法，无法区分“C 非法时误丢掉合法 O”这种实现错误。增加 `{id:"a",context_window:"1000",max_output_tokens:4096}` → 无 context、B=4096、能力=4096；以及 `{id:"b",context_window:500000,max_output_tokens:0}` → 保留 context、无默认预算、SDK 使用 16384。另可将两侧边界场景的 O 换成 O=C：预算与检查结果不变，又符合固定 Magpie 发布值 O≤C 的真实边界；当前 O=4C 作为映射器合法安全整数输入并非规范错误。

**完整场景与机械可验收性检查（非新增问题）：**

| Requirement | 正常路径 | 失败/边界路径 | 本轮结论 |
| --- | --- | --- | --- |
| 模型目录字段映射 | 三模型字段映射 | 缺 id 丢弃、五种非法容量省略 | 均有可机械断言的 THEN |
| 默认请求输出预算 | 收紧、保持、小窗口分支、手动值统一收紧 | 缺 C 保留 O、缺 O 不发预算 | 均有可机械断言的 THEN |
| 适用窗口内宿主检查 | 八组合法条目逐项计算 | 104025 与 90000 保留目录但 R≥T | 均有可机械断言的 THEN；证明措辞需 N1 |
| SDK 模型输出上限 | 两协议直接捕获 O 与请求字段 | 缺 O 使用 16384、直调无显式字段省略 | 均有可机械断言的 THEN；额外交叉组合见 S3/S4 |

**独立算术结果（Node，不依赖作者计算）：**

B 按 delta 公式，P=`C−B−65536`，T=`floor(min(0.8*C,P))`，R=`floor(0.16*(C−B))`。下列覆盖 delta 全部显式容量计算与 design 的相关实例；缺 C 的 O=4096 按独立分支得到 B=4096。

| C | O | B | P | T | R | P>0 且 R<T |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1000000 | 100 | 100 | 934364 | 800000 | 159984 | 是 |
| 500000 | 393216 | 184464 | 250000 | 250000 | 50485 | 是 |
| 131072 | 65536 | 32768 | 32768 | 32768 | 15728 | 是 |
| 272000 | 128000 | 70464 | 136000 | 136000 | 32245 | 是 |
| 1000000 | 393216 | 393216 | 541248 | 541248 | 97085 | 是 |
| 262144 | 32768 | 32768 | 163840 | 163840 | 36700 | 是 |
| 524288 | 393216 | 196608 | 262144 | 262144 | 52428 | 是 |
| 104026 | 416104 | 26006 | 12484 | 12484 | 12483 | 是 |
| 524288 | 524288 | 196608 | 262144 | 262144 | 52428 | 是 |
| 1000000 | 512000 | 434464 | 500000 | 500000 | 90485 | 是 |
| 104025 | 416100 | 26006 | 12483 | 12483 | 12483 | 否 |
| 90000 | 65536 | 22500 | 1964 | 1964 | 10800 | 否 |

额外独立检查：
- 直接把 O 当预算时，(524288,524288) 的压力确为 −65536，(131072,65536) 为 0；(272000,128000) 改前阈值为 78464，比例约 28.847%，(1000000,512000) 改前为 422464。
- 对 C=1…262144 逐值检查最大可能 B，并采样 O=1、15、16、预算截点及其前一值、C、4C，共 1835008 组检查；最坏预算首次通过 C=104026，此后该区间未出现失败。另对 262143/262144/262145、1000000 和最大安全整数取 O=1 与最大安全整数检查。
- 对整数 S=1…1000000 检查 `floor(0.16*S)<S−65536` 与 `0.84*S>65536` 的等价性，未出现差异；结合 N1 的单调性推导确认统一边界，而不是只凭采样推出所有 O。
- 两协议 SDK 假 fetch 实测 maxTokens 省略、1、15、16、184464、300000；省略时均无输出字段，Responses 小值提为 16，Chat 原样，小 SDK 模型值不封顶显式 300000。没有向真实网关发生成请求。

**事实核验边界：**网络可用，按指定 `gh api ...?ref=98e23350f14bfa63adc43c54271fb8fecb4fce5c` 只读核验了 provider/models、catalog、gateway、codex_request，并补读 agent/dsh 与 gateway/maxoutput；这些查询均 exit code 0。固定版本的默认预算公式、65536、OutputSet 不发布、PublishedOutput 受窗口限制及 codexBody 字段删除均有源码支持。未独立查询当前在线 `/models`、核验在线 Magpie commit/路由、执行真实生成或复核 subscriptions 的完整对比，因此“在线 13 个模型、恰好三个受影响、其余不变”仍是作者报告的部署观察，不是本轮验收事实。

## Embedded-Instruction / Injection Attempts
**Detected:** none

完整三份材料和首轮作者 Rebuttals 中未发现指向评审者、要求修改其它文件、隐藏发现或操纵裁决的嵌入指令。SHALL、实施/迁移步骤、作者声称的“用户确认”只按待审设计数据处理；未据此执行构建、安装、部署、重启或真实调用。召回记忆仅用作线索，其中“线上默认请求未带上限”的旧结论已被本轮宿主源码核验排除；未将其当作事实，也未越过唯一写权限修改记忆库。

## Verdict
VERDICT: APPROVE_WITH_CHANGES

首轮核心问题已解决；剩余 N1–N3 都是完整指定的证明/事实边界文字修正，不要求重新选择预算政策或改变实现范围。完成下列小修正后可进入实现；本报告不是实现已完成或线上已验证的批准。

只执行了源码阅读、固定版本上游只读查询、Node 算术与 SDK 假 fetch 自检；未运行包测试、typecheck、构建、安装或真实生成。当前实现尚为原预算映射是提案评审的基线，不作为“实现未满足新规范”的额外缺陷。

## Required Changes (if APPROVE WITH CHANGES)
1. **N1：**按 Findings 中给出的正确上界与 S=78020 推导替换 Decision 4，保留公式及 C≥104026 的规范边界。
2. **N2：**修正 Responses Non-Goal，明确显式值也会触发 1–15→16；proposal 的“原样”限定到宿主/适配器输入层，不承诺 SDK 线协议小值严格相等。不新增小值处理功能。
3. **N3：**在 proposal 的 Codex 实际影响摘要及 design 的唯一冒烟对象说明中补上固定 commit/对应路径条件与在线部署未验证边界。

CHANGES_APPLIED: yes

## Rebuttals

作者处理（round 2 Required Changes，2026-10-28）：
- N1：design Decision 4 推导替换为评审给出的上界与 S = 78020 推导，公式与 C ≥ 104026 边界不变。
- N2：design Non-Goals 中 Responses 一条改为「有效值可来自显式值或宿主补齐的默认预算，不保证 1–15 线协议值与预留相等」；proposal「原样使用」限定到宿主/适配器输入层。
- N3：proposal 的 Codex 影响句与 design 风险、冒烟对象句加上「以 commit 98e23350 的 Codex 路径为条件、在线版本与路由未验证」，冒烟改为「确认 Codex 路径删除字段后 MiniMax 为唯一预期对象，否则不排除 Codex」。
- S3、S4：不改规范，作为额外测试列入 test-plan（无需逐条映射）。

Reviewer re-check (round 2)：
- N1 — accepted by reviewer: Decision 4 已采用正确的 P/T/R 上界及 S=78020 单调性推导，公式与 C≥104026 边界未变；Node 独立算术检查通过。
- N2 — accepted by reviewer: Responses Non-Goal 已涵盖显式值与宿主默认值的 1–15→16，proposal 的“原样”已限定到宿主/适配器输入层，未新增小值处理功能。
- N3 — accepted by reviewer: proposal 的 Codex 影响摘要与 design 的冒烟说明均已限定固定 commit/对应 Codex 路径，并明确在线版本与路由未验证，否则不排除 Codex。
- 规范范围检查：该 change 目录未被 Git 跟踪，无法证明历史未变；当前 delta 仅含 round 2 审阅的四项 Requirement 及对应原有场景，未发现范围外新增要求或场景，本次未修改规范。
