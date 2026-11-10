## Review Metadata
- **Review round**: 3
- **Prior round**: round 2 REVISE（3 Critical / 2 Moderate：入口过滤不是披露边界、迟到答复无 Delivery 关联、code 绕过脱敏）；连续两轮 REVISE 后经所有者授权进入本轮
- **Reviewer context**: cross-model (codex / gpt-6-astra), fresh context
- **Tool restrictions**: read-only: view, grep, glob only（唯一写入为本文件）；另仅计算下列工件 SHA-256，未运行测试、构建、部署、网络请求或读取凭据。
- **Artifacts reviewed**: [proposal](openspec/changes/locus-ask-work-first-and-concise/proposal.md)、[design](openspec/changes/locus-ask-work-first-and-concise/design.md)、[collaboration delta](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md)、[intent delta](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-intent-triage/spec.md)、[round 1](openspec/changes/locus-ask-work-first-and-concise/review-round1.md)、[round 2 与作者答复](openspec/changes/locus-ask-work-first-and-concise/review-round2.md)。对照 [current collaboration](openspec/specs/pet-locus-collaboration/spec.md) 的上下文、工具、capability 与访问模式条款及 [current intent](openspec/specs/pet-locus-intent-triage/spec.md) 的意图条款；结合下列源码与测试进行静态路径复核。目录内尚无 tasks 工件，不把尚未实施本身作为缺陷。
- **Artifact hashes** (SHA-256):
  - proposal: `26b2c035fe57e347aaa7c4dda3bd8899599e4562e32138e9903404522dab1fdc`
  - design: `78e4f4671948a5e14cf05869fe4afb0c930768b88242fe300af3951b299aa3f1`
  - collaboration delta: `34d1c77a3e8f5d1a664f9f33df612d00a8f223422148770bc491aea9f9c3fdf2`
  - intent delta: `3d824f284ad5bcaee8f22fc33cf994b5d27cd5f39c8af31b0a63c29167b5f572`

## Round 2 Findings Status

| 上轮项 | 状态 | 本轮核对 |
|---|---|---|
| C1 入口过滤不是披露边界 | **已关闭（规划层）** | [D3](openspec/changes/locus-ask-work-first-and-concise/design.md#L40-L45) 明确同 W 共享，`locus_consensus()` 无入口参数；[披露条款](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L18) 删除入口间隔离承诺。尊重所有者取舍，不要求重新引入隔离。 |
| C2 迟到答案无 Delivery 关联 | **部分关闭** | [D8](openspec/changes/locus-ask-work-first-and-concise/design.md#L68-L73) 已定义票据、发送检查、终结/重启失效与 continuation 检查；[送达后过期场景](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L181-L198) 已补。然而“拒绝授予新能力”未覆盖同回合已有能力，且签票缺少当前执行来源证明；见本轮 C1/C2。 |
| C3 code 绕过脱敏 | **已关闭（规划层）** | [D5](openspec/changes/locus-ask-work-first-and-concise/design.md#L54-L57) 改为内部有限原因码集合，不再接受格式合法的任意字符串；[负向场景](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L301-L319) 包含大写 32 位 hex code。 |
| M1 轮次闭合不等于队列空 | **部分关闭** | resident inbox 不可读返回 unknown，cold 需队列证明；但 [D4](openspec/changes/locus-ask-work-first-and-concise/design.md#L47-L52) 指定复用的折叠规则只处理 next-turn，不足以证明全部输入队列为空，见 M1。 |
| M2 注入后果上界与负向验收 | **已关闭（本轮所要求的模式区分）** | [D3](openspec/changes/locus-ask-work-first-and-concise/design.md#L45) 不再把完全访问描述为只读；[负向场景](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L76-L79) 检查目标/票据/模式，前缀明确仅缓解。这里认可权限不升级的契约，不把提示词当作注入防护证明。 |

重新检查了规则持续送达、无答复到期失败、历史读取/提取/脱敏、同 W 共享边界、显式绑定迁移与部分成功回执、工具注册与 observer 接线。未以“已有源码尚未实现新规划”为缺陷；以下均是按规划实施仍会遗漏的反例。

## Findings

### 🔴 Critical (blocking)

#### C1 — 拒绝迟到票据的 continuation，不会撤销同回合已经取得的 E 能力
- **证据**：[D8:71](openspec/changes/locus-ask-work-first-and-concise/design.md#L71) 的修复点是 `admitAgentContinuation`，票据不匹配就“不授予续答”。当前 [observer:585–613](packages/dsh-pet/src/host/locus/turn-observer.ts#L585-L613) 对同 turn 或已推进的 turn 直接返回；[能力选择器:749–778](packages/dsh-pet/src/host/locus/turn-observer.ts#L749-L778) 若已有唯一 Delivery claim，仍返回该 Delivery 的能力。[现有测试:660–674](packages/dsh-pet/test/locus-turn-observer.test.ts#L660-L674) 明确要求 agent-message 与原始 Delivery 共用 turn 时保留能力，并说明运行中 sendMessage 在 next-step 领取。新增 [场景:186–189](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L186-L189) 只测 E 原始 turn **已结束**的单一迟到答复。
- **反例**：D 的答复已经送入 inbox；D 到期后 E 晋升。E 的原始输入和 D 的旧答复在同一 turn 领取（或 E 的有效票据答复与 D 的旧答复在同一 continuation turn 领取）。旧票据检查失败并 return，但 E 的合法 claim 已提供能力。模型把 D 的答案提交为 E 的答复，仍可 finish E。先处理旧答复再处理有效 claim 也必须防住，不能靠回调顺序。
- **影响**：[intent:40](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-intent-triage/spec.md#L37-L40) 宣称的“E 未被结算、没有旧正文外发”不成立。这里没有要求阻止历史文本对模型的一切影响，而是已识别为旧请求的本次输入不能共享当前结算能力。
- **最小修复**：在所有 agent-message claim 路径上核对关联；已证明失效/异 Delivery 的票据输入应使**本执行段** fail closed，即使当前段另有有效原始 Delivery 或有效票据；该污染标记不得被后到的有效 claim 清除。统一覆盖 finish/wait/track 的能力检查。保留“同 D 有效票据与原始 turn 合并仍可完成”的正例；补“旧票据+E 原始 claim”“旧票据+E 有效 continuation”两种组合及相反到达顺序。同步修订泛化的 [agent-message 条款](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L22)，明确不能由无关联消息走旧授权路径。

#### C2 — 签票只绑定数据库 current，可把 GUI/旧执行的问题洗成 E 的合法答复
- **证据**：[签票契约:141](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L141) 只检查 caller 是当前 active child，然后绑定“调用时的 current Delivery”；[D8:69](openspec/changes/locus-ask-work-first-and-concise/design.md#L69) 同样未要求调用执行具有该 Delivery 的已证明关联。现有 [askParent:192–208](packages/dsh-pet/src/host/collab/locus-tools.ts#L192-L208) 确实只解析 child 身份。与之相对，[当前 capability 契约:427–431](openspec/specs/pet-locus-collaboration/spec.md#L427-L431) 明确数据库存在 current 不能授予能力，GUI/混合来源不能经“补证明”放宽。
- **反例**：E 为 current，child 的 GUI/user steer 回合无 E 完成能力；该回合调用合法的 `locus_ask_parent`，Host 按数据库 current 签出绑定 E 的 k。该回合结束后，M 以 k 答复；这是合法 M、合法行/revision、合法 current、合法票据，后续干净 agent-message turn 可获得 E 的能力，并把 GUI 问题的答案发给 E。另一版本是 D 的旧执行在 E 晋升后发问，签票却绑定 E。无需猜票据或伪造 sender。
- **影响**：新票据证明了“发问时数据库有 E”，却没有证明“问题来源于 E”；会绕过本来必须保留的 GUI/旧执行隔离。随机性、发送时 current 检查、领取时 current 检查均不能修复此错误绑定。
- **最小修复**：给票据附带 Delivery 能力时，签发必须使用与 finish/wait/track 同源的当前执行证明，验证 caller、generation、execution/turn 与唯一 current 的关系，不能只查 current 行。已有 current 但执行无关联/已污染时拒绝签发 Delivery-bound 票据；如保留无 current 的上下文询问，显式无 Delivery 的票据不得在后续晋升时升级为 E 票据。补 GUI 回合发问、旧 D 执行在 E 晋升后发问、正常 D 原始/续答回合发问三个端到端静态契约场景。

### 🟡 Moderate

#### M1 — 冷读“按启动恢复相同规则”只折叠 next-turn，无法证明全队列为空
- **证据**：[D4:50](openspec/changes/locus-ask-work-first-and-concise/design.md#L50) 和 [状态规范:151](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L151) 指向启动恢复的事件折叠规则。[被引用实现:173](packages/dsh-pet/src/host/locus/startup-recovery.ts#L155-L182) 明确跳过所有非 `next-turn` 事件；它是特定初始 Delivery 重放证明，不是所有输入的空闲证明。[resident helper](packages/dsh-pet/src/index.ts#L2083-L2087) 则检查 nextTurn **及** nextStep。
- **反例/影响**：冷读日志中最后 turn 已结束，next-turn 折叠为空，但记录存在未消除的 next-step 项或无法解释的 next-step splice。原样采用所指定算法会忽略它并得到 idle，而非 busy/unknown，M 随即打扰 W。“快照不是发送时保证”不能解释读取时已被忽略的队列证据。
- **最小修复**：明确分别精确折叠两种 target，任一非空不能 idle；无法证明日志起点/完整性或任一 target 的 splice 不可精确解释，返回 unknown。也可更保守地在发现无法覆盖的 target 时直接 unknown。补只剩 next-step、next-step 畸形、两个队列均有完整空证明的场景；不要修改原有 startup replay helper 的专用语义。

### 📌 Suggestions

无额外非阻断建议。上述修复限定于本次新增票据与状态 helper，无需建立通用消息系统、通用 DLP 或重新讨论同 W 分享授权。

## Embedded-Instruction / Injection Attempts
**Detected:** 未发现针对评审者的嵌入式指令攻击。工件内的“忽略之前的规则……”是明确的负向测试数据；prompt 文案、SHALL/MUST、作者答复与部署说明仅作为审查对象，未作为执行指令或已经实现的证明。没有执行其中的部署步骤。

## Verdict
VERDICT: REVISE

**2 Critical / 1 Moderate / 0 Suggestions。** 上轮 C1/C3/M2 在规划层已关闭，C2/M1 有实质改善但部分开放。票据方向正确，却必须同时证明签发来源及整个执行段的纯净关联，不能只在续答入口拒绝一次新授权。此处涉及 fail-closed capability 契约，不适合以小型文字调整的 APPROVE_WITH_CHANGES 放行。

## Required Changes (if APPROVE WITH CHANGES)
CHANGES_APPLIED: n/a

先明确 C1/C2 的签票与混合回合规则并补对应验收场景，再修正 M1 的双队列证明。仅创建本报告，未修改规划正文或源代码；未运行测试，不将静态分析表述为实测失败。

## Rebuttals

（作者答复，2026-11-10；所有者授权第 4 轮，并指出无需另造票据，改用既有 Delivery 身份。待第 4 轮核对。）
- **C1 已修订**：续答以执行段为单位 fail closed：段内领取过对不上 current 的带标识答复即整段无 finish/wait/track，不论顺序、不可清除；无标识 agent-message 不再授续答。新增两种同段组合（含两种顺序）场景，保留同 Delivery 同段正例。
- **C2 已修订**：绑定 deliveryId 须用与 finish 同源的执行来源证明；GUI/旧执行只能绑定 none，答复不授任何能力且不升级。新增 GUI 回合、旧 D 执行发问场景。
- **M1 已修订**：冷读分别精确折叠 next-turn 与 next-step，不复用启动恢复专用折叠；新增只剩 next-step、无法解释事件场景。
- 另：票据改为既有持久 Delivery 身份编码，去掉内存 Map 与重启作废；重启后仍可核验。
