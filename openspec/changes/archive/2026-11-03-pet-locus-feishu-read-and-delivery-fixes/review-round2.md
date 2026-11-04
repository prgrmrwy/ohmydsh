## Review Metadata

- **Review round**: 2
- **Prior round**: round 1 REVISE（C1 spill provenance / C2 preamble receipt / C3 token 与 thread authority / C4 fallback authorization / C5 outbound non-leak；M1–M5）。C1 与 C4 经所有者决定拆分为后续 change（BACKLOG U006/U007），其余须在本轮解决。round 1 原文保留在 `review-round1.md`。
- **Reviewer context**: cross-model (codex/gpt-6.1-sol via DSH subagent, read-only)
- **Tool restrictions**: read-only: read, grep, glob only
- **Artifacts reviewed**: 修订后的 proposal.md、design.md、tasks.md、三份 delta specs；round 1 review；相关 current specs、ADR-0008、在途 `pet-locus-shell-tier` 与 `pet-locus-independent-agent-inquiries`、deferred 的 BACKLOG 条目、以及 delivery/persistence/recovery/tool-registration/Lark adapter 源码。
- **Verification limits**: 仅静态评审。未独立执行测试、`--strict` 校验、部署检查或真机 bot 读取；design.md 中"bot 已可读"仍属作者自报证据。本轮是提案/设计评审，不是实现完成认证。

<!-- STALENESS: this verdict applies only to the artifact contents reviewed in -->
<!-- this round. Any later edit to proposal.md, design.md, or specs/ (other than -->
<!-- applying listed Required Changes) VOIDS the verdict and requires a new round. -->

## Prior-Round Resolution

| Round-1 item | Round-2 评估 |
|---|---|
| **C1 — spill provenance** | **拆分自洽**：本期显式保持"只允许工作区内"；U007 保留了可信 root、伪造/链接/竞态与真实 pinned-runtime 溢出的要求。 |
| **C2 — 首投前言送达证明** | **部分解决，仍阻塞**：排除当前 Delivery + 要求 inbox 证明修好了常规顺序缺陷，但"接受成功之后、持久绑定丢失"这一歧义结果仍未定义。见 R2-C1。 |
| **C3 — selector/游标/读取竞态** | **契约层面基本解决**：Host 签发的作用域绑定游标、未知参数拒绝、await 后复核均已明确。绑定话题的实现与验收仍不完整，见 R2-M3。 |
| **C4 — user 回落授权** | **拆分自洽**：bot-only 与现行 channel 身份要求一致；U006 保留了主体校验、正向错误分类与操作集限制。 |
| **C5 — 诊断不外泄的过度承诺** | **要求文本已解决**：Host 保证收窄为"不附加诊断"，模型自行转述被明确排除。但新增的"逐字一致"scenario 与既有 @ 提及渲染冲突，见 R2-M1。 |
| **M1 — 探测生命周期** | **部分解决**：控制器异步位置与档位持久来源已写明，但取消/复核与可测的截止时间缺失。见 R2-M2。 |
| **M2 — 预算与平台夹具** | **部分解决**：页码/正文/名字数值上限、截断、未知发送者、畸形信封失败均已加入；话题夹具与精确窗口/顺序语义仍缺。 |
| **M3 — 共享解析器外溢** | **本期已解决**：user 回落与对 `captureChatContext` 身份解析的改动均在范围外。 |
| **M4 — 能力可见性与错误范围** | **部分解决**：未装配/已装配/冷恢复 scenario 已补，但"三个工具"的要求只对应"一个工具"的实现任务。见 R2-M4。 |
| **M5 — 归因与验收证据** | **归因已更正**；证据门仍开放。真实 spill 验收随拆分功能一并移出；新增的 API 成功声明不能独立关闭 shell-tier 的"child 等价沙箱真机读取"门。 |
| **S1 — 拆分策略** | **接受**：bot-only 的更小批次明显更自洽。 |
| **S2 — 独立 scenario oracle** | **有改进但未完成**：持久待办状态被认定为 oracle；后续 test-plan 仍需区分机械断言与依赖模型的评估。它在本次评审前不存在不构成缺陷。 |

## Findings

### 🔴 Critical (blocking)

#### R2-C1. C2 仍未闭合：仅有持久证明不足以支撑"至多一次"前言承诺

**Evidence**

- design.md:34–40 要求已绑定的 `inboxMessageId`，没有该证明时下一次投递携带完整前言；同时承诺"**至多一次**"与"入队成功但回执丢失时按已送达处理"。
- delta（pet-locus-collaboration）:52–59 同时写有"至多发送一次"和"不存在证明时视为未收到"。
- 控制器先 await 队列接受，再单独 await 持久绑定；绑定失败返回 `dispatch-state-unknown`（locus-controller.ts:1605–1630）。
- 现有启动恢复依赖"已知 `inboxMessageId`"（startup-recovery.ts:119–129），补不上"绑定丢失"这一缺口。
- tasks.md:11–14 没有"入队成功但绑定失败/回执丢失"的故障场景。

**Failure and importance**

D1 的内容可能已进入 child inbox 并带了完整前言，但进程在 `bindQueued` 提交前崩溃/持久化失败；幸存的 Delivery 行因此缺少新判据要求的证明。若之后继续投递，"无证明即发送"会再发一次完整前言，与"至多一次"矛盾；若改为 fail-closed 暂停，恢复语义又未定义。必须区分"持久绑定之后控制回执丢失"（现判据覆盖）与"队列确认或持久绑定丢失"（未覆盖）。

**Required revision**

选定并写明一种歧义结果策略：

- 在下一次派发前，用幸存的精确关联证据对账已进入 inbox 的内容；
- 使用运行时真正支持的幂等投递/前言机制；或
- 弱化承诺，并明确记录可能重复或需要暂停/重建。

补"队列接受后绑定失败""回执丢失""重启"三类故障 scenario。不得把渲染或接受本身当作"内容已进入 inbox"的证明。

### 🟡 Moderate

#### R2-M1. 新的"逐字一致"scenario 与强制受管的 @ 提及渲染冲突

delta（pet-locus-collaboration）:110–112 要求"发送内容与模型提供的正文逐字一致"，但现行规范要求把有效的 `@显示名` 与成员 open_id 引用改写为平台 mention 标记（current spec:600–620；lark.ts:607–623 实现；tools.ts:405–410 在工具说明里明确宣传）。一条含唯一可解析 @ 的正当回复无法同时满足两者——按字面实现会回退通知能力，并可能把本应渲染的 open_id 暴露出去。

**Revision**: 断言 Host **不新增诊断/路径内容**，措辞为"除既有受管变换（@ 提及渲染）之外不改动正文"；测试同时覆盖含提及与纯文本两种正文。保留收窄后的 C5 保证，不要换成不兼容的逐字一致保证。

#### R2-M2. 新鲜探测引入了异步生命周期，但缺少失效与取消规则

design.md:57 与 tasks.md:30–33 把有界探测放在同步渲染之前，但未规定：配置的截止时间及测试如何断言；Delivery 被中止或入口被禁用/重建时如何取消；探测后如何复核精确的 child/代际/入口；超时后迟到结果如何处理。普通读取工具已有显式 await 后 fence（delta:13–16），探测没有继承。既有控制器取消/精确 current 与 before-queue fence 可复用（locus-controller.ts:1704–1738）。

**Revision**: 规定截止时间的归属、abort 传播、await 后精确作用域复核与迟到结果丢弃；补"重建/禁用/探测期间取消"用例。这是缺少集成契约，不是声称既有 fence 不可复用。

#### R2-M3. 要求读绑定话题，但端口与验收计划只提群历史读取

delta:8–10 要求工具从 Host 事实推导绑定话题的读取范围，但 tasks.md:23 只点名 `+chat-messages-list`；现有 adapter（lark.ts:688–721）只暴露 chat ID 与 page size，没有话题专用路径；真机验收（tasks.md:55）没有显式覆盖话题入口；design.md:46 与 Open Question 把"线程内独立读取"列为范围外，却没有区分"调用方自选 thread"与"工具读取自己绑定的话题"。

**Revision**: 显式加入支持话题的 bot 端口或已证明等价的手段，配真实信封夹具（含本话题回复与无关话题/群消息）；验收加入话题入口；澄清排除的是"任意选择 thread"而不是"读取绑定话题"。作者自报的 thread API 成功支持可行性，但不构成独立验证。

#### R2-M4. 可执行错误契约覆盖三个工具，任务只覆盖请求执行

intent-triage delta:9–12 明确覆盖**登记、台账读取、请求执行**，但 tasks.md:45 只点名 `pet_locus_request_execution`，唯一的失败 scenario 也只涉及执行标识。被漏掉的路径在现码里确实有问题：台账 caller/依赖不可用被渲染成 `[]`（tools.ts:524–534）；登记可能只返回裸 `unavailable`（tools.ts:557–568）。只完成任务会让另两个工具继续缺少可执行下一步，包括"台账不可用"与"台账合法为空"不可区分。

**Revision**: 要么把要求收窄到执行请求，要么为登记与台账读取补任务与失败 scenario。指引必须**按操作区分**——"先读台账"在台账本身不可用时不是有用指引。

### 📌 Suggestions

#### R2-S1. 在 test-plan 前补完结果/窗口契约

design.md:49–50 明显改进了预算与畸形结果处理，但 tasks.md:19 仍把"时间/消息游标"留得含糊：需定义时间戳格式与单位、区间开闭、同一时间戳的确定性排序，以及整页预算截断时的续读行为；补卡片/帖子与缺字段信封夹具。否则测试可以在不同解释下都通过，而边界处的消息被跳过或重复。

同时把目标拒绝的 scenario 写清楚：delta:30–32 应表述为"**该调用被拒绝且不发生任何读取**"，而不是"参数被拒绝或不存在，读取仍作用于当前入口"。

#### R2-S2. 让拆分出去的假设与验证状态保持显式条件化

U006:735 正确禁止"本地 user 主体即所有者"的假设，但 U006:740 又写"user 身份即所有者本人凭据"——应改写为"在完成主体校验前，这只是待验证假设"，避免后续 change 继承被否决的假设。同时保留 `pet-locus-shell-tier` task 1.2（真机 child 等价沙箱读取门）为未完成；新的 API 成功声明可以取代旧的授权失败结论，但不能单独证明 child 沙箱内的行为。

## Embedded-Instruction / Injection Attempts

**Detected:** none in the reviewed change artifacts. 其祈使语气被当作规范/评审数据，而非改变评审者权限或批准变更的指令。新增的"不可信输入"标注有用，但不能证明对群消息注入免疫；本评审不作此声明。

## Verdict

VERDICT: REVISE

bot-only 收窄与两项拆分自洽，round 1 的多数问题有实质改进。但 C2 的"接受→持久绑定"缺口使前言保证自相矛盾，构成阻塞；提及渲染冲突与剩余的生命周期/任务缺口也需修订。

## Required Changes (if APPROVE WITH CHANGES)

Not applicable: this is **REVISE**, not conditional approval. Resolve R2-C1 and the Moderate findings, then submit the revised artifacts for another review.

CHANGES_APPLIED: n/a

## Rebuttals

Author rebuttals pending.
