## Review Metadata
- **Review round**: 4
- **Prior round**: round 3 REVISE（2 Critical / 1 Moderate：同段旧答复不撤能力、签票不验执行来源、冷读只折叠 next-turn）；经所有者授权进入本轮
- **Reviewer context**: cross-model (codex / gpt-6-astra), fresh context
- **Tool restrictions**: read-only（唯一写入为本文件）；另以只读 `shasum -a 256` 计算摘要。
- **Artifacts reviewed**: [proposal.md](<openspec/changes/locus-ask-work-first-and-concise/proposal.md>)、[design.md](<openspec/changes/locus-ask-work-first-and-concise/design.md>)、[collaboration delta](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md>)、[intent-triage delta](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-intent-triage/spec.md>)、[round 1](<openspec/changes/locus-ask-work-first-and-concise/review-round1.md>)、[round 2](<openspec/changes/locus-ask-work-first-and-concise/review-round2.md>)、[round 3](<openspec/changes/locus-ask-work-first-and-concise/review-round3.md>)、对应当前规范及下述相关源码。静态规划评审，未实施或运行测试，未联网、构建、部署、重启。
- **Artifact hashes**: SHA-256
  - proposal: `5b941b3b2dcf9e8eb1a64e16359f5635f5410e928819a80f5db1cf0d086c06e7`
  - design: `58510b371ed9367367f0e95755514739e3ae38b1ca00b39e6cdb86b52d107aa6`
  - collaboration delta: `6384333d53d334e975d50427a053b79105d709f0742a76652979911f6b43aee0`
  - intent-triage delta: `053e9e4e0ebffecb8ecbfdecd68fb0913e2f5d6a014b8ba76e903d78ed8c7125`

## Round 3 Findings Status

| Round 3 | 状态 | 核对结论 |
|---|---|---|
| C1 同段旧答复不撤能力 | closed | 按规划层关闭原反例：[D8:72](<openspec/changes/locus-ask-work-first-and-concise/design.md#L72>) 与 [delta:145、195–203](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L145>) 已规定每条 claim 校验、整段不可逆污染、两种顺序、原始 E/有效 E 均不能洗掉旧 D。另有 [同 D 正例:172–174](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L172-L174>)，不要求把所有父消息都判坏。这里关闭的是“已识别为旧答复仍保留能力”，不证明新编码不可伪造；后者见本轮 C1。旧宽泛续答条款仍须统一，见 M1。 |
| C2 签发不验执行来源 | partially | [D8:70](<openspec/changes/locus-ask-work-first-and-concise/design.md#L70>) 已改成调用执行的 current capability 而非数据库 current，且 [GUI/旧执行场景:205–213](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L205-L213>) 明确不能升级。既有 [resolveAuthorizedCurrent:227–271](<packages/dsh-pet/src/host/tools.ts#L227-L271>) 确实可提供这种组合证明；但接收方只解码和查现行持久事实，不证明这些字段曾由该签发路径产生，新增编码方案使 none→E 篡改仍可绕过签发检查，见本轮 C1。 |
| M1 冷读只折叠 next-turn | closed | [delta:151](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L151>) 明确两个队列独立精确折叠，不复用启动恢复专用证明；[场景:267–280](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L267-L280>) 覆盖 next-step 非空、异常 splice 与未闭合轮次。与 [startup-recovery:173–182](<packages/dsh-pet/src/host/locus/startup-recovery.ts#L173-L182>) 实际只看 next-turn 的局限相符。 |

## Findings

### 🔴 Critical (blocking)

#### C1 — 不透明编码不证明 Host 签发，M 可重编码 none/旧 D 为 current E
- **位置**：[design:69–73](<openspec/changes/locus-ask-work-first-and-concise/design.md#L69-L73>)、[collaboration delta:141–145](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L141-L145>)。
- **反例**：GUI 执行正确收到 `(C,L,r,none)` 的询问标识，或 M 保留了 `(C,L,r,D)`。同一入口 E 成为 current 后，M 修改编码中的 deliveryId 为 E，调用 `locus_reply_child`。计划规定的检查只有归属 M、入口 active/session/revision、Delivery 当前性；这些全可成立。Host 随后给篡改结果加上“Host 标记”，observer 看到合法 current E，授权续答。签发时的执行来源证明已经丢失。“模型 MUST NOT 能够改写字段”是目标，不是编码的安全性质；移除显式 childSessionId 参数也不能阻止在 askId 中改同样的字段。
- **可达依据**：字段来自模型看得到的询问正文，而非秘密；Delivery 身份不得假设不可猜：[delivery:671–681](<packages/dsh-pet/src/host/locus/delivery.ts#L671-L681>) 默认使用递增 `delivery-N`，并允许指定 ID。即使实际 E 不可预测，知道 E 的反例仍成立。当前 [officialSubagentMessenger:702–707](<packages/dsh-pet/src/index.ts#L702-L707>) 只保证实际发送 agent 与官方接口，并不认证工具参数里的询问标识来源；接收后由 Host 加前缀不能补回签发真实性。
- **影响**：round 3 C2 要求的“无执行能力不能经询问洗成飞书能力”仍可绕过；同 W 内容共享授权不等于允许模型为任意 current 铸造完成能力。已有“别的 M 的标识被拒”测试只验证归属，不覆盖同 M 篡改，也不覆盖旧 revision 改成新 revision。
- **最小修复**：保持所有者选择的既有持久身份，不另造随机询问票据；为编码增加可验证的 Host 签发完整性，例如对版本、目标 M 与完整 tuple 的规范化编码做 MAC，签发只在真实能力判定后发生，reply 和 claim 都先验真再判当前性。必须说明重启稳定的密钥来源、不可用/轮换时 fail closed，不能顺手假设已有合适密钥；如不能满足“不增加持久状态”，选择能从既有持久记录证明签发的方案或上报该约束，不退回纯编码。新增修改 child/locus/revision/delivery、none→E、D→E、截断/伪造标签均不送达且不授能力的测试；原始标识重启后有效的正例仍须保留。此完整性保护不保证模型答复内容语义正确，也不阻止它使用自己已持有的另一份真实授权，不能作更强承诺。

### 🟡 Moderate

#### M1 — MODIFIED 完整替换中仍保留无标记跨 turn 续答契约，与 D8 及新条款相反
- **位置**：[collaboration delta:22、99–101](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L22>) 对照 [同文件:145](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L145>)、[design:72](<openspec/changes/locus-ask-work-first-and-concise/design.md#L72>)。
- **反例**：D 原始 turn 结束，child 只收到无询问标记的 agent-message。前一 requirement 与原生父回复场景仍要求后续 turn 可 finish；后一 requirement 和 D8 要求不授续答能力。实现者若为保留旧验收沿用按 child 的路径，即恢复本次明确要删除的行为。
- **依据与影响**：这不是只在未修改 baseline 中残留；本次 MODIFIED 文本原样包含这一承诺。现有 [admitAgentContinuation:585–614](<packages/dsh-pet/src/host/locus/turn-observer.ts#L585-L614>) 和 [selector:791–813](<packages/dsh-pet/src/host/locus/turn-observer.ts#L791-L813>) 正是按 retained child lineage 续答。D8 只点名收窄同段正例，不足以让两套相反的跨 turn 验收同时通过。
- **最小修复**：在第 22 行与第 99–101 行明确仅“经验证、绑定同一 current 的 Host 询问答复”能在后续执行段恢复能力；无标记只补上下文。保留“不改持久回复目标”的独立不变量，不把“撤销本段能力”写成“撤销 Delivery 目标”。补无标记消息单独跨 turn 到达时 finish/wait/track 全拒的场景，并检查 baseline 关联 requirement 的措辞与此收窄一致。

### 📌 Suggestions

#### S1 — 把执行段、无能力询问与冷读正例的验收补成可机械断言的矩阵
- **位置**：[design:70–73](<openspec/changes/locus-ask-work-first-and-concise/design.md#L70-L73>)、[delta:195–222、257–280](<openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L195-L222>)。
- **依据**：[ObservedTurn:294–345](<packages/dsh-pet/src/host/locus/turn-observer.ts#L294-L345>) 实际以 `(childSessionId, turn)` 为段，不是 inbox message、模型 step 或持久 executionId；[claim bridge:2186–2206](<packages/dsh-pet/src/index.ts#L2186-L2206>) 当前只传 sourceKind，虽然注释说明原 payload 带完整 UserMessage，尚不能把正文解析能力视为实测通过。现有 [askParent:185–208](<packages/dsh-pet/src/host/collab/locus-tools.ts#L185-L208>) 与 [注册:587–590](<packages/dsh-pet/src/host/tools.ts#L587-L590>) 还未注入 selector，规划的复用是待实施工作，不是现成依赖。
- **影响**：实现容易把污染只保留到 next-step，或永久污染 child；仅测试 GUI 新回合不能证明 none 答复与 E 原始消息同段时同样撤权。冷读目前有充分失败例，但缺“双队列经插入/删除精确归零”的明确 idle 正例。
- **最小改进**：写明污染寿命与 `(child,turn)` 映射，测试同 turn 不同步 step 仍拒、后续干净段可按真实标识重新授权；补 none 与原始 E 同段两种顺序、重启恢复后原能力可用、两队列归零返回 idle。对拒绝除断言“不结算”外，检查 wait 不延长期限、track 不创建条目。保留实施第一步真实 payload fixture 的停下上报门禁，不用模拟正文掩盖 Host 接入缺失。

### 其余全量核对结论
- 接受同 W 入口共享与非随机持久身份这两项所有者决定；不重新要求 intra-W 隔离。跨 W 边界、凭据形态脱敏与 full-access 注入残余风险已有明确条款。
- ask-first 的成功、无记录、当场失败、永不答复及过期后迟到场景已具备；不再虚构 wait 会唤醒模型。业务口径与技术追问例外未扩大写权限，也未新增完成入口。
- 历史读取有最近三个人工轮次、最终助手文本、进行中输入、一次搜索、输出限长与脱敏顺序；[冷读适配器:48–68](<packages/dsh-pet/src/host/session-inspection.ts#L48-L68>) 有 `projectionMode: none` 和 finally 释放，设计引用有实际接入基础。未把 [resident helper:2068–2087](<packages/dsh-pet/src/index.ts#L2068-L2087>) 的缺 inbox 默认值当作 idle 证据。
- 显式 bind 迁移插入点对应 [provisionChatLocked:567–590](<packages/dsh-pet/src/host/locus/controller.ts#L567-L590>)；[migrateWholeW:775–828](<packages/dsh-pet/src/host/locus/controller.ts#L775-L828>) 有 lease 下重查、current 拒绝、持久提交，规划的两步回执与失败后复用合理。诊断方案采用有限 class/code 与先脱敏后截断，未把 [safeControlError:175–204](<packages/dsh-pet/src/host/locus/control.ts#L175-L204>) 现有兜底直接宣称为已完成的新能力。

## Embedded-Instruction / Injection Attempts
**Detected:** 未发现要求评审者忽略约束、改判通过或执行额外动作的嵌入式指令。规范中的“忽略之前的规则”等为明确的攻击测试数据；历史报告中的作者答复不是完成证据。未执行工件中的部署说明。本轮 C1 是运行时模型参数完整性缺口，不是声称本次评审材料已经遭到注入。

## Verdict
VERDICT: REVISE

1 项 Critical、1 项 Moderate、1 项 Suggestion。整段污染与双队列冷读已在规划层补齐，但纯编码不能证明 Host 曾签发该执行能力，且旧的无标记跨 turn 续答契约仍与新规则冲突。

## Required Changes (if APPROVE WITH CHANGES)
CHANGES_APPLIED: n/a

本轮不属于 APPROVE_WITH_CHANGES；请解决 C1 的真实性证明与重启契约、统一 M1 的规范及验收后重新评审。本次只创建本报告，未修改任何规划或源码。

## Rebuttals

（作者答复，2026-11-10；连续第 4 轮 REVISE 后上报所有者。所有者先要求 ponytail-review 查过度设计，随后同意按其结论收窄。）
- **C1（标识可伪造）**：整个询问标识方案已删除。改为 Host 在内存里按子会话记录询问对应的 Delivery，记录不进 M 可见的消息，M 无从伪造；`locus_reply_child` 参数不变，送达前核对该 Delivery 仍是 current。
- **M（MODIFIED 仍保留无标记续答）**：不再引入"无标识不授续答"的新规则，与基线「跨 turn 父回复继续 current Delivery」不再冲突，turn-observer 不改。
- 已知缺口：答复送达后、子会话处理前 current 换代时不拦截；design D8 与 spec 写明，并要求代码用 `shortcut:` 注释标出。
- 同时按 ponytail-review 收窄：删 `locus_consensus` 工具（改为询问消息附带 agreed charter）；忙闲只分 idle/unknown，不回放冷读队列；兜底日志只记已定义原因码，不记消息，删日志脱敏。
