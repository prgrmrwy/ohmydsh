## Review Metadata
- **Review round**: 2
- **Prior round**: round 1 REVISE（3 Critical / 2 Moderate / 1 Suggestion：超时自查不可执行、外发授权边界、日志脱敏）
- **Reviewer context**: cross-model (codex / gpt-6-astra), fresh context
- **Tool restrictions**: read-only: view, grep, glob only（唯一写入为本文件）；另执行只读 `shasum -a 256` 计算工件摘要。
- **Artifacts reviewed**: [proposal](openspec/changes/locus-ask-work-first-and-concise/proposal.md)、[design](openspec/changes/locus-ask-work-first-and-concise/design.md)、[collaboration delta](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md)、[intent-triage delta](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-intent-triage/spec.md)。对照当前规范、第一轮报告与相关 controller、消息工具、turn observer、冷读适配器和测试；这是规划评审，未实施、运行测试、联网、部署或重启。
- **Artifact hashes**: SHA-256
  - proposal: `2ff97835752ea7377a9650f8bb82c64720fa25b6a1a047c4d5184c02e8675ed1`
  - design: `1bc528f70f4174d95ca6778882c50f3ed753e2497c1c65dbe5d4e022fdb4e884`
  - collaboration delta: `78469f44a8d937a6495688bc4548fa0b58dbd24a70234674fb74a813a5437eed`
  - intent-triage delta: `3315d85ee2828d0337cd5255514ea9155f65f848bde918fce3c1d3a81ee6401a`

## Round 1 Findings Status

| Round 1 | 状态 | 核对结论 |
|---|---|---|
| C1 超时自查不可执行 | partially | [D2](openspec/changes/locus-ask-work-first-and-concise/design.md#L33-L37) 已取消超时自查，正确采用失败/无记录唤醒与到期终止；但新增迟到回复不消费后续 Delivery 的承诺仍缺关联机制，见本轮 C2。原始“wait 自行唤醒”问题已关闭。 |
| C2 外发授权边界 | partially | 接受所有者“绑定即授权 W 对话”的明确选择，不要求重新确认产品取舍；[D3](openspec/changes/locus-ask-work-first-and-concise/design.md#L39-L44) 已写存量、提示与撤销，但宣称 Host 保证其它入口不转发不成立，见本轮 C1。 |
| C3 诊断泄露凭据 | partially | [D5](openspec/changes/locus-ask-work-first-and-concise/design.md#L53-L56) 已增加 message 先脱敏再截断、类名允许列表与禁读 cause/stack；code 仅做格式验证，仍可直接泄露规范明确要求清洗的凭据形态，见本轮 C3。 |
| M1 无证据报空闲 | partially | [状态条款](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L144) 已处理冷读失败、未闭合轮次及快照竞态；仍未定义 inbox 不可核验分支，见本轮 M1。 |
| M2 最终文本提取不闭合 | closed | [D4](openspec/changes/locus-ask-work-first-and-concise/design.md#L46-L51) 已给轮次、来源、最终 stop 纯文本、进行中处理及真实脱敏 fixture 的实施前置；[场景](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L182-L195) 覆盖过程文本和进行中输入。按规划层关闭，不等于已验证 runtime fixture。 |
| S1 迁移回执不统一 | closed | [迁移契约](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L231-L257) 与 [D6](openspec/changes/locus-ask-work-first-and-concise/design.md#L58-L61) 已明确两步提交、失败标记传递、回执与重试复用。与现有整 W 迁移先提交再返回的路径相容。 |

## Findings

### 🔴 Critical (blocking)

#### C1 — M 自选 entry 的读取过滤不是请求入口的披露边界
- **证据**：[design:41–42](openspec/changes/locus-ask-work-first-and-concise/design.md#L41-L42) 声称其它入口内容不经本入口转发已从 prompt 变为 Host 保证；[工具契约:138–142](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L138-L142) 却允许同一个 M 选择任意所属 entry，再选择任意所属 child 回复。现有 [readLocusContext:117–127](packages/dsh-pet/src/host/collab/locus-tools.ts#L117-L127) 的边界来自实际 child，不来自模型参数。
- **反例**：A/B 同属 M，B 发问时 M 调用 `locus_consensus({entry:A})`，Host 因 A 属于 M 而返回 A 的专属 charter，再 `locus_reply_child(B, text)`。两次调用都满足设计校验，B 却收到规范禁止的 A 入口事实。即使本次正确选择 B，长寿命 M 也可能早已在处理 A 时读过该文本；单次过滤不会清除 M 的既有上下文。这不同于所有者已经接受的“W 中讨论 A 的内容可以给 B”。
- **影响**：仍被保留的跨入口禁止披露条款没有 Host 安全边界；当前正向场景只证明“选 B 时不返回 A”，没有验证“处理 B 时不能选 A”。
- **最小修复**：准确区分单次结果过滤与端到端披露保证。若保留硬隔离，必须定义 Host 绑定实际询问入口的读取/答复链路，并处理共享 M 上下文的既有污染（例如独立请求上下文或不经共享模型的受限转发），补 B 请求选 A 及 A 历史残留场景。若实际只准备做模型行为约束，应明确残余泄露风险并取得该额外取舍的确认，不能引用 W 共享决定替代它。

#### C2 — 迟到答案没有 Delivery 身份，能被当成 E 的合法 continuation
- **证据**：[intent:7](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-intent-triage/spec.md#L7) 禁止迟到父答复消费后续 Delivery，但 [迟到场景:37–40](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-intent-triage/spec.md#L37-L40) 只检查 E 目标不变，没有检查 E 不被结算。[工具契约:136–138](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L136-L138) 只绑定 child/current generation；[askParent:198–208](packages/dsh-pet/src/host/collab/locus-tools.ts#L198-L208) 仅携带 entry、child 与问题。[continuation:585–613](packages/dsh-pet/src/host/locus/turn-observer.ts#L585-L613) 按 child 的 retained current 接纳后续 agent-message，不识别它回答的是哪次询问。
- **反例**：D 发问后过期；同一 child 获得 E，E 的原始 turn 结束且仍为 current；此时 M 才回答 D。消息的 turn 比 E 新，Host 可将它接到 E 的 retained lineage。child 用 D 的答案 finish E：D 仍 expired、E 目标没变，现有新增场景全部通过，但 E 被错误消费。现有 [撤权测试:525–543](packages/dsh-pet/test/locus-turn-observer.test.ts#L525-L543) 测的是旧 Delivery claim 重放，不是新的迟到 agent-message，因此不能作为此反例的证明。
- **影响**：新的 ask-first 主路径将旧问答发送到另一条业务请求，并消耗该请求的唯一结算机会。
- **最小修复**：为询问与答复增加 Host 可验证的关联（例如不由模型创造的 request token，绑定 child generation + Delivery/execution），在回复注入及 continuation 授权处验证仍是原 current；失效回复不授予 E 能力。允许实现不持久化，但必须说明重启失效策略。新增“E 原始 turn 已结束、D 答复随后抵达”的测试断言：E 不被该答复结算、不向 E 发送 D 答案；同步修订仅 prompt/不改变关联机制的范围描述。

#### C3 — 合法格式的 code 仍能携带未脱敏凭据
- **证据**：[design:55](openspec/changes/locus-ask-work-first-and-concise/design.md#L55)、[诊断条款:263、269–276](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L263-L276) 要求保留正则匹配的 code，仅对 message 调用脱敏；负向 fixture 的 code 是小写含空格，天然被排除。
- **反例**：未知异常 `code` 被上游填为一个以 A–F 开头、长度 32 的大写十六进制凭据（使用合成 fixture 即可）。它匹配 `^[A-Z][A-Z0-9_]{1,63}$`，按方案完整进入日志；同一文本放在 message 中，却按 [历史脱敏条款:147](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L147) 必须被替换。
- **影响**：这不是“无法识别非常见秘密”的已接受局限，而是绕过已经定义的清洗规则，继续兑现第一轮的原始泄露路径。
- **最小修复**：code 只接受固定内部原因码集合，未知 code 省略；或先对 code 应用相同凭据清洗并拒绝发生替换的值，再验证格式。补正则合法且命中凭据形态的 code fixture，断言日志/回执无原值。

### 🟡 Moderate

#### M1 — 轮次闭合不等于已证明输入队列空
- **证据**：[design:49](openspec/changes/locus-ask-work-first-and-concise/design.md#L49)、[状态条款:144](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L144) 对 resident 缺失 inbox 和 cold queue 未知都没有明确规则。[现有 inbox helper:2083–2087](packages/dsh-pet/src/index.ts#L2083-L2087) 在 handle/inbox 不可得时直接返回 false；[冷读适配器:61–65](packages/dsh-pet/src/host/session-inspection.ts#L61-L65) 只返回 header/events，并不返回队列证明。
- **反例**：能读取 resident session 的已闭合事件，但 agent handle/inbox 尚不可读取；复用 helper 得到 false，再由“无 open turn、无 pending”推成 idle。另一个等价缺口是冷读只看见最后一轮结束，无法判断是否有尚未开始下一轮的 pending 输入。
- **影响**：M 可能在证据未知时主动问 W，违背只在确认空闲时打断的策略；“状态仅是快照”解决读取之后的竞态，不解决读取时缺少队列证据。
- **最小修复**：区分“队列空”和“队列未知”；未知返回 unknown，或给出当前 runtime 保证 cold session 不可能有 pending 的依据。补 inbox 不可得以及闭合日志但队列未知的失败场景，勿改变既有子会话 helper 的语义来迁就新工具。

#### M2 — 注入的“最坏只有错误答复”结论超出当前权限模型，且缺负向验收
- **证据**：[design:70](openspec/changes/locus-ask-work-first-and-concise/design.md#L70) 以“子会话只读、出站只经 finish”断言最坏结果不是越权。但 [现行 full-access 契约:1384–1396](openspec/specs/pet-locus-collaboration/spec.md#L1384-L1396) 明确全访问可获得整机文件、命令、飞书凭据能力，不得把出站 guard 描述为安全边界；写开关默认关闭不等于规范删除这一模式。[历史工具场景:182–227](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L182-L227) 也没有历史恶意指令不获指令权的负向场景。
- **反例**：所有者按已有路径开启 full，W 历史或引用群文本含诱导执行命令的内容；新链路将其带入 M/child。固定数据前缀能缓解，但不能证明模型只会给错答案。这里不要求移除已授权 full，也不把所有 full 行为称为权限升级；问题是设计给出了不成立的安全后果上界。
- **影响**：风险评估误导实施与验收，并漏掉第一轮要求的注入失败/边界覆盖。
- **最小修复**：按 read-only/full 分别如实描述残余风险，限定数据前缀的作用，不承诺 Host 没有提供的隔离；补历史包含命令/越界转发指令时仍只视为资料、不得因此提升权限或改变目标的负向场景。无需为了本次小改造引入通用注入防御系统。

### 📌 Suggestions

无新增非阻断建议。第一轮 S1 的规划缺口已经闭合，不重复索要相同修改。

## Embedded-Instruction / Injection Attempts
**Detected:** 未发现针对评审者的嵌入式指令攻击。工件中的 prompt、SHALL/MUST、部署步骤以及第一轮作者答复均仅作为审查数据，没有作为执行指令或已修复证明。C1/M2 指运行时不可信内容流转的设计风险，并非认定本次文档含实际攻击载荷。

## Verdict
VERDICT: REVISE

本轮 3 Critical / 2 Moderate / 0 Suggestions。规则持续送达、无答复到期失败、最终文本提取与迁移回执均有实质改善；但请求入口与读取入口不绑定、迟到答案与 Delivery 不绑定、诊断 code 绕过清洗仍是阻断项。修复需要明确 Host 契约及相应反例验收，不适合在尚未决策时给 APPROVE_WITH_CHANGES。

## Required Changes (if APPROVE WITH CHANGES)
CHANGES_APPLIED: n/a

先闭合 C1–C3 的安全/关联机制，再补 M1–M2 的未知状态与风险场景，重新提交规划评审。本轮没有修改任何规划工件或源代码。

## Rebuttals

（以下为作者答复，2026-11-10；连续两轮 REVISE 后已上报所有者，所有者授权第 3 轮并对 C1、C2 作出决定。均为"已修订"，待第 3 轮核对。）

- **C1 按所有者决定修订**：所有者选择"同一工作会话下的入口互相共享"。规范删除"其它入口不经本入口转发"及"Host 过滤保证"的说法，明确授权范围为该 W 的对话与该 W 当前协作空间的全部 agreed charter，并明确 MUST NOT 宣称同一 W 下有隔离、MUST NOT 越过该 W。`locus_consensus` 改回无参数。design D3 记录理由（共享 M、已有 collab_read、上下文残留）与残余风险。
- **C2 按所有者决定修订**：所有者选择 Host 询问票据。`locus_ask_parent` 签发绑定 `(子会话, 入口 revision, current Delivery)` 的内存票据；`locus_reply_child` 改为 `({askId, text})`，送达前核验票据仍对应当前 Delivery，否则"询问已过期"；续答授权在 turn-observer 处同样核验票据。新增 Delivery 过期后答复被拒、送达后才过期不能结算 E、他人票据、重启作废场景；intent-triage 迟到场景改为断言 E 未被结算。design D8 列出关联实现的两种方式及都不可行时停下上报。
- **C3 已修订**：code 只认 `LocusControllerError`/`PetError` 已定义的原因码集合，不再用格式正则；新增 32 位大写十六进制 code fixture 场景。
- **M1 已修订**：`idle` 要求同时证明无未结束轮次与输入队列为空；内存中读不到 inbox 为 unknown；冷读按 startup-recovery 的规则折叠持久化的 `agent/inbox/spliced` 事件，不精确为 unknown。新增两个场景；不改子会话现有 helper 语义。
- **M2 已修订**：按只读 / 完全访问分别描述注入后果，前缀只称缓解；Host 只保证回复目标、票据与访问模式不被改变。新增"记录中的指令不改变目标与权限"负向场景。
