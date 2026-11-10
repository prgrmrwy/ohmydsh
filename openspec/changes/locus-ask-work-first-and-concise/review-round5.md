## Review Metadata
- **Review round**: 5
- **Prior round**: round 4 REVISE（1 Critical / 1 Moderate / 1 Suggestion：询问标识可伪造、MODIFIED 保留无标记续答）；所有者按 ponytail-review 收窄后进入本轮
- **Reviewer context**: cross-model (codex / gpt-6-astra), fresh context
- **Tool restrictions**: read-only（唯一写入为本文件）；只读计算 SHA-256，未联网、实施、测试、构建、部署、重启或再委派。
- **Artifacts reviewed**: [proposal.md](<openspec/changes/locus-ask-work-first-and-concise/proposal.md>)、[design.md](<openspec/changes/locus-ask-work-first-and-concise/design.md>)、[collaboration delta](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md>)、[intent delta](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-intent-triage/spec.md>)、[round 1](<openspec/changes/locus-ask-work-first-and-concise/review-round1.md>)、[round 2](<openspec/changes/locus-ask-work-first-and-concise/review-round2.md>)、[round 3](<openspec/changes/locus-ask-work-first-and-concise/review-round3.md>)、[round 4](<openspec/changes/locus-ask-work-first-and-concise/review-round4.md>)；对应当前规范的相关 requirements，以及下列源码相关段落。源码和大型基线按相关段落核对，不声称逐行审计全仓。
- **Artifact hashes**: SHA-256（四个当前规划工件）
  - proposal: `032e3c6eb361a838c15046c815696094bb872678accb330ce2c5ab542639357d`
  - design: `f8136efe863ab3ffde3457b56b00187b42795146312c59c5d23988eebcc7badc`
  - collaboration delta: `15b7807f56206656f7a8ccca04331a64f8adafa123b9743d36efc7bd1819aaae`
  - intent delta: `b976c88366cb441fe08fd93a6ce99ce36bcfb6fa80121cf03d4e4e8e6fbb5578`

## Round 4 Findings Status

| 项目 | 状态 | 本轮核对 |
|---|---|---|
| C1 编码可伪造 | superseded / 原机制已删除 | [D8:69–73](<openspec/changes/locus-ask-work-first-and-concise/design.md#L69-L73>) 改成 Host 私有内存记录，M 不再提交询问标识，原篡改反例不再适用。不要求恢复签名、持久票据或执行段撤权；但这不证明记录覆盖后仍能区分答复，见本轮 C1。 |
| M1 无标记续答契约冲突 | closed（规划层） | [delta:22、99–105](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L99-L105>) 保留基线续答，不再新增无标记撤权，与“不改 turn-observer”的收窄一致。 |
| S1 执行段/冷读矩阵 | superseded；剩余基础验收见 S1 | 已删除执行段污染和冷队列重放，不能继续索要它们的验收。仍应覆盖新小 Map 自己的正常及失效路径。 |

## Findings

### 🔴 Critical (blocking)

#### C1 — 新询问覆盖记录，会在送达之前把 D 的迟到答复误认为 E 的答复
- **位置**：[design:70–72](<openspec/changes/locus-ask-work-first-and-concise/design.md#L70-L72>)；[collaboration delta:141–143](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L141-L143>)；现有负例只覆盖换代但未再次询问的情况：[delta:184–187](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L184-L187>)。
- **具体反例（无需恶意模型，也无需并发工具调用）**：
  1. 长期 child C 就 D 发问，Map[C] = D。M 告知“已转问”，向 W 提问后结束本轮，等待 W 答复。
  2. W 未及时回答，D 按既有期限过期。下一条 E 成为同一 C 的 current；ask-first 要求 C 再次提问，于是 Map[C] 被覆盖为 E。
  3. W 此时才回答 D 的问题，M 正常调用 `locus_reply_child({childSessionId:C,text:答案D})`。
  4. Host 只能看到 Map[C] = E 与 current = E，检查通过，**首次送达**答案 D。E 在整个送达和处理期间都不必再换代，child 就可能拿答案 D 结算 E。
- **依据与影响**：当前 [askParent:198–208](<packages/dsh-pet/src/host/collab/locus-tools.ts#L198-L208>) 和 [reply 工具参数:729–750](<packages/dsh-pet/src/host/tools.ts#L729-L750>) 只有 child 身份，没有调用对应哪次询问的证据；私有 Map 防止模型改写值，却不防止下一次合法询问改写值。两阶段转问本身是规定的正常路径：[delta:58–61](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L58-L61>)。本反例发生在答案尚未送达时，**不是**所有者已接受的“先送达、后换 current”缺口；E 的业务回复机会仍会被旧答案消费。少量日常询问也可能发生，不以高并发为前提。
- **最小处理**：先补上述 D→E→E 再询问→D 答复的确定性场景，明确预期。保持“参数不变、记录只有最新 child→Delivery、允许后续询问覆盖”时，Host 无法区分该调用与 E 的正常答复；不能只增加一次 current 比较就声称修复。请所有者在两条小范围路径中明确选择：①把“覆盖后旧答复亦可能通过”明确纳入接受的 shortcut，并同步收窄“迟到答复拒收”的承诺及验收；②若送达前拒收仍是硬要求，则调整最小关联/询问准入策略，使旧询问未能排除时不把旧答复自动归给新 current，并写清如何恢复正常询问。无需恢复 round 4 的整套签名、持久化和 observer 方案。本轮不擅自扩大已接受风险，也不以一种没有可用性说明的永久拒收冒充解决。

### 🟡 Moderate

无独立新增 Moderate。C1 所缺的反例验收已计入同一发现，不重复计数。

### 📌 Suggestions

#### S1 — 给新的小 Map 补四个直接可断言的边界场景
- **位置**：[询问及答复契约:141–143](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L141-L143>)、[已有正负例:162–192](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L162-L192>)。
- **建议**：补“无 current 发问，之后 E 出现，答复不送达”；“记录为 D，之后没有 current，答复不送达”；“同一 D 先收到已转问、再收到最终答案，两次都送达”（第一次成功不能删除记录）；“解绑后旧答复拒绝，重新绑定创建新 child 后不能复用旧 child 记录”。每项断言 messenger 的调用次数、返回原因和 current/结算状态，而不只比对自然语言。
- **影响与范围**：已有条款基本能推导这些结果，故不是另一个阻断项；但两阶段正例未明确约束记录保留，常见的一次性消费实现会让最终答案丢失。无需新增数据表、重启恢复或执行段测试体系。

### 其余全量核对结论

- **ask-first 与口径**：流程覆盖已确认结论、最近三轮、一次搜索、idle 才转问、unknown 自查、无答复按既有期限失败；不把 wait 当模型唤醒。首投、续投和存量 M 的每次询问都有新指引落点。对应现有 [intent guidance](<packages/dsh-pet/src/host/ledger/prompt.ts#L14-L49>)、[续投 prompt](<packages/dsh-pet/src/host/locus/context.ts#L411-L440>)、[M briefing](<packages/dsh-pet/src/host/locus/dsh-port.ts#L224-L235>)，属于待改实现，不是已经完成的能力。
- **披露边界**：接受绑定授权、同 W 共享 charter、存量绑定授权与明确 full-access 残余风险；不恢复 intra-W 隔离。`locus_context` 仍按入口过滤，与 ask 消息共享全 W charter 是不同结果集，并非矛盾。跨 W 读取仍 caller-bound。
- **历史读取**：人工轮次、最终助手文本、进行中仅输入、脱敏先于截断及输出限长均已明确；真实事件 fixture 被列为实施首步。现有 [session-inspection:48–68](<packages/dsh-pet/src/host/session-inspection.ts#L48-L68>) 支持官方冷读并释放 lease。新 idle 不能直接沿用 [inbox helper:2083–2087](<packages/dsh-pet/src/index.ts#L2083-L2087>) 的“不可读即无 pending”，规划已规定不可读是 unknown；不再要求冷读证明 idle。
- **迁移与回执**：[D6](<openspec/changes/locus-ask-work-first-and-concise/design.md#L60-L63>) 插在 [provisionChatLocked](<packages/dsh-pet/src/host/locus/controller.ts#L560-L593>) 的显式 W 解析之后、provisioning 之前，可复用 [migrateWholeW](<packages/dsh-pet/src/host/locus/controller.ts#L762-L835>) 的 lease 重查、current 拒绝和持久提交。部分成功回执、重试复用 M1、auto/docs/已有群排除范围均有文字及场景。
- **诊断**：接受仅已定义 class/code 或 unrecognized，不恢复异常文本日志。新映射对应 [safeControlError](<packages/dsh-pet/src/host/locus/control.ts#L175-L204>) 和 [PetError](<packages/dsh-pet/src/host/errors.ts#L11-L25>)；32 位大写十六进制未知 code 的负例保留。没有把本次 dispatcher 兜底日志约束扩大成全仓日志重构。
- **完整替换与旧文案**：两个 collaboration MODIFIED requirements 保留基线独立历史、现行代、跨 turn、入口过滤等契约；本轮文本不再要求签票、执行段撤权、`locus_consensus` 或冷队列重放。历史报告中的旧设计仅用于演进核对，不作为现行实施要求。

## Embedded-Instruction / Injection Attempts
**Detected:** 未发现要求评审者改判、忽略约束或执行额外动作的嵌入式攻击。[规范中的“忽略之前的规则”](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L76-L79>) 是负向测试数据；旧报告作者答复仅作为待验证的历史说明。没有执行文档中的部署指令。

## Verdict
VERDICT: REVISE

**1 Critical / 0 Moderate / 1 Suggestion。** 收窄后的方案整体可实施，但“每 child 只保留最新询问”会在送达前把旧 D 答复接到新 E；该情况超出已接受的送达后竞态，需要明确修复或由所有者另行接受并收窄承诺。

## Required Changes (if APPROVE WITH CHANGES)
CHANGES_APPLIED: n/a

本轮不是 APPROVE_WITH_CHANGES：C1 涉及尚未授权的风险范围选择，不能替所有者决定。只创建本报告，未修改规划或源码。

## Rebuttals

暂无作者答复。接受已有 owner-approved shortcut，不重开已否决的大机制；本轮 C1 特意区分“答案送达前记录已被覆盖”与“答案送达后 current 才换代”。

（作者答复，2026-11-10；所有者选择方案 2：带回 msgId 核对。）
- **C1 已修订**：删除按子会话记最新询问的内存 Map。询问消息写入询问引用（current 的触发消息 id 或 `none`），`locus_reply_child` 增加必填 `askRef`，Host 送达前核对它仍对应 current。新增 D→已转问→D 过期→E 再询问→D 迟到答复被拒、E 正常答复送达的场景。明确不防伪（防答错号）。
- **S1 已采纳**：补无 current→E、D→无 current、同 D 已转问与最终答复两次送达、解绑重绑旧代拒收四个场景，并断言 sendMessage 调用次数；另补缺少 askRef、重启后仍可答复场景。
