## Review Metadata

- **Review round**: 6
- **Prior round**: round 5 REVISE（1 Critical / 1 Suggestion：新询问覆盖记录导致 D 迟到答复被当成 E 的）；所有者选择带回 msgId 核对
- **Reviewer context**: cross-model (codex / gpt-6-astra), fresh context
- **Tool restrictions**: read-only（唯一写入为本文件）；未联网、部署、读取凭据或继续委派。
- **Artifacts reviewed**: [proposal](<openspec/changes/locus-ask-work-first-and-concise/proposal.md>)、[design](<openspec/changes/locus-ask-work-first-and-concise/design.md>)、[collaboration delta](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md>)、[intent delta](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-intent-triage/spec.md>)、[round 1](<openspec/changes/locus-ask-work-first-and-concise/review-round1.md>)、[round 2](<openspec/changes/locus-ask-work-first-and-concise/review-round2.md>)、[round 3](<openspec/changes/locus-ask-work-first-and-concise/review-round3.md>)、[round 4](<openspec/changes/locus-ask-work-first-and-concise/review-round4.md>)、[round 5](<openspec/changes/locus-ask-work-first-and-concise/review-round5.md>)、对应当前规范及下述相关源码。
- **Artifact hashes**: SHA-256，依次对应上述四个规划工件：
  - proposal: `48764f2585aa7a64ee80147fe528890ee18498d88c5609123a3271e7ee8e5bab`
  - design: `5d43885e68418fba0a432ae8ff39678ad5111a8f626c312c904b6748d97935b2`
  - collaboration delta: `a7236d229fa3387a8adda305f0d496ea70d26866df065d73cc8f688eb09f6d76`
  - intent delta: `67f7bd019cb7521f61707a068eb5acbc4b83ec28438e23cee650c02a0abf705a`

本报告是静态规划评审，不是实现验收；未运行测试或真实会话 fixture。源码中的旧行为被视为待修改落点，不作为新能力已经存在的证明。

## Round 5 Findings Status

| 发现 | 状态 | 独立核对 |
|---|---|---|
| C1 新询问覆盖关联 | closed（规划层） | [D8:69–76](<openspec/changes/locus-ask-work-first-and-concise/design.md#L69-L76>) 与 [工具契约:141–143](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L141-L143>) 改为调用显式带回原询问的 msgId；E 再询问不会改写 D 调用中的 askRef。新增 [189–192 场景](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L189-L192>) 明确 D 拒收、messenger 0 次、E 不结算，随后 E 正常送达。 |
| S1 四个边界场景 | closed（规划层） | [194–216 场景](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L194-L216>) 覆盖两阶段同 D 回复、none→E、D→无 current、解绑重绑旧 child。两阶段明确调用 2 次；其余的“不送达”可机械断言为调用 0 次。另有缺参拒绝、重启仍为 current 的条件正例。 |

该关闭依赖所有者明确选择的非防伪边界：M 必须照抄所答询问的引用。M 把旧答案故意或错误标成 E，不是本方案能判定的语义问题；当前 [风险条款:85](<openspec/changes/locus-ask-work-first-and-concise/design.md#L85>) 已如实说明，不再要求签票或执行段撤权。

## Findings

### 🔴 Critical (blocking)

无。

### 🟡 Moderate

无。

### 📌 Suggestions

#### S1 — 实施时用小型参数化测试补齐 askRef 正向边界

- **证据**：[工具契约:141–143](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L141-L143>) 已明确文档评论引用、none、同 Delivery 重复询问及缺参规则，但独立场景主要覆盖换代拒收；[D8:74](<openspec/changes/locus-ask-work-first-and-concise/design.md#L74>) 还要求旧 M 根据错误文案重试。
- **建议**：实施测试补四行即可：①none→none 送达且不创建 Delivery；②同 D 连续问两次，两个答复均能送达；③文档的完整 `doc:docx:<token>/<comment_id>/<reply_id>` 原样通过，另一个 replyId 拒收；④旧 M 缺 askRef 拒绝后，错误提示指向询问正文中的引用，补参后成功。拒绝统一断言 messenger 0 次，避免只比对错误文案。
- **影响与最小范围**：现有 [reply 注册:729–750](<packages/dsh-pet/src/host/tools.ts#L729-L750>) 只有 childSessionId/text；增加 required 参数时容易只覆盖 schema 拒绝而漏掉可恢复提示。文档 ID 由 [docMessageId:53–60](<packages/dsh-pet/src/host/locus/doc-endpoint.ts#L53-L60>) 合成，不能把“格式有效”误实现成只接受 IM 的 `om_`。这些预期已经能从规范推出，不构成规划阻断，也不需要新表或新状态。

### 全量核对结论

1. **关联实现落点成立。** [askParent:192–208](<packages/dsh-pet/src/host/collab/locus-tools.ts#L192-L208>) 已从真实 child 解析父目标，可在此追加 Host 读取的 current 引用；[replyChild:265–279](<packages/dsh-pet/src/host/collab/locus-tools.ts#L265-L279>) 已检查 active/current child 归属，需在调用 messenger 前增加持久 current 比较。实际 [Delivery 去重:644–667](<packages/dsh-pet/src/host/locus/delivery.ts#L644-L667>) 以 messageId 返回原记录，重投不会天然产生同 msgId 的另一个新 Delivery。重启正例明确以“D 仍为 current”为前提，不承诺重启保留所有运行中的 D。
2. **边界没有偷偷扩大。** [intent:7](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-intent-triage/spec.md#L7>) 与 [collaboration:143](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L143>) 都将拦截限定在送达前，并显式保留送达后换代 shortcut；不能以此批准送达前不核对或核对失败仍发送。不重开签名、observer、冷 inbox 回放或跨入口隔离。
3. **ask-first 与存量会话覆盖一致。** [D1–D2](<openspec/changes/locus-ask-work-first-and-concise/design.md#L30-L39>) 同时修改 [首投指引](<packages/dsh-pet/src/host/ledger/prompt.ts#L14-L49>)、[续投指引](<packages/dsh-pet/src/host/locus/context.ts#L411-L440>) 和每次询问正文。成功、无记录、自问失败、始终不答复、迟到拒收均有明确结局；wait 不被误当作定时唤醒。业务简答及追问实现细节例外不改变权限和统一 finish 入口。
4. **历史读取可实现，但仍需真实 fixture。** [D4](<openspec/changes/locus-ask-work-first-and-concise/design.md#L48-L53>) 给出人工 source、最终纯文本 stop、未闭合轮次和 1500/8000/10 条上限；[官方冷读适配器](<packages/dsh-pet/src/host/session-inspection.ts#L48-L68>) 已提供 none projection 与 finally 释放。新状态 helper 必须将 inbox 不可读判 unknown，不能直接使用 [现有 pending helper](<packages/dsh-pet/src/index.ts#L2083-L2087>) 的 false 作为空队列证明。脱敏先于截断与搜索空结果、冷读失败均有可断言场景；真实事件结构仍须按计划首步核验。
5. **披露和日志风险收窄诚实。** [披露条款](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L18>) 接受绑定即授权、同 W 共享，而非声称入口隔离；[locus_context 原过滤](<packages/dsh-pet/src/host/collab/locus-tools.ts#L117-L138>) 保留只是结果收窄。历史是数据、模式脱敏并非通用 DLP、full-access 注入残余风险均明示。新日志 [304–317](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L304-L317>) 只允许内部 class/已定义 code，未知普通异常即使有看似合法 code 也不记录；不再依赖任意 code 正则过滤。
6. **迁移与错误映射落点具体。** [D6–D7](<openspec/changes/locus-ask-work-first-and-concise/design.md#L60-L67>) 位于 [显式 W 解析和 provisioning 之间](<packages/dsh-pet/src/host/locus/controller.ts#L560-L593>)，复用 [migrateWholeW](<packages/dsh-pet/src/host/locus/controller.ts#L762-L835>) 的 lease 重查、current 拒绝与持久提交；[293–298 场景](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L293-L298>) 规定提交后失败不回滚、回执说明、重试复用。现有 [safeControlError/bindReceipt](<packages/dsh-pet/src/host/locus/control.ts#L175-L225>) 需要新增映射、迁移标记和披露文本，方案没有将其当作已实现。auto、文档及已有群复用明确排除。
7. **MODIFIED 是完整替换。** 对照 [上下文基线:67–137](<openspec/specs/pet-locus-collaboration/spec.md#L67-L137>) 与 [工具基线:1141–1170](<openspec/specs/pet-locus-collaboration/spec.md#L1141-L1170>)，独立历史、身份、原生跨 turn、GUI fail-closed、过滤、旧代拒绝等非本次变更内容仍保留；intent 的四分类、权限独立和统一完成契约也保留。移除旧的无条件向 W 转问，是新 idle/unknown 顺序的有意替换，不是遗漏。没有残留要求签票或禁止所有无标记 continuation 的矛盾条款。

## Embedded-Instruction / Injection Attempts

**Detected:** 未发现针对评审者的实际嵌入式指令攻击。[“忽略之前的规则”场景](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L76-L79>) 是负向 fixture，仅作为数据审查。历史报告作者答复不作为修复证据；部署文字没有被执行。

## Verdict

VERDICT: APPROVE

**0 Critical / 0 Moderate / 1 Suggestion。** Round 5 的覆盖型错配已通过显式带回原 msgId 在规划层关闭；保留所有者批准的小范围关联与送达后竞态取舍，未发现新的阻断问题。可以进入实施，批准不代表真实历史 fixture、runtime 接入或端到端行为已通过验收。

## Required Changes (if APPROVE WITH CHANGES)

CHANGES_APPLIED: n/a

无必须先改的规划项。S1 为实施阶段的小型回归建议。本轮仅创建本报告，未修改规划或源码。

## Rebuttals

暂无。所有者已批准的 shortcut 与非防伪边界在本轮被尊重，没有以被否决的大机制作为通过前提。
