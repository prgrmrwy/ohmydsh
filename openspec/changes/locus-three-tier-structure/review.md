# locus-three-tier-structure — Round 7 规划评审

## Metadata

- 轮次：round 7；时间基准：2026-11-03T19:30:58+08:00。
- 性质：全量规划复审，结合当前实现检查设计可落地性；**不是实现完成审计**。
- 上轮：round 6 `APPROVE_WITH_CHANGES`，`CHANGES_APPLIED: no`，历史上未闭合。本轮独立确认其 RC1–RC3 的规划补充已经出现；不倒改上轮状态，也不把本轮确认当成测试通过。
- 范围：proposal、design、六组 delta specs、tasks、test-plan；当前 interrupted recovery 规范；worktree 内官方 rc.2 subagent 与 Pet 创建、首 prompt 桥、队列、持久化和恢复路径。
- 约束：仅覆盖本报告；未修改规划正文或实现，未派发、未运行 git、安装、构建、部署或测试。
- 假设：单机 Host 管理多个入口，每入口串行 Delivery；同一入口存在异步 claim、持久写入、补偿与进程重启边界。没有引入多机共享状态要求。

## Findings

### Critical

无。三层结构、普通协作成员与 actAs、独立子上下文、保守迁移和官方能力替换方向均可接受。没有理由恢复已决定退役的四个补丁或重开所有者已接受的 final-guard 时间窗。

### Moderate

#### M1 — 首图降级的业务例外已正确提出，但尚缺与首发布 WAL 的交接约束和故障验收

**是什么。** [图片例外](../../../openspec/changes/locus-three-tier-structure/specs/pet-locus-collaboration/spec.md#L40-L45)与[设计决策 3](../../../openspec/changes/locus-three-tier-structure/design.md#L26)正确要求原 Delivery 不失败、同代换新 child、文本仅重试一次。它不是普通的“再调一次 queue”：旧 child 已创建，回调可能已发布 current/执行身份，且相应恢复日志已经存在。

**具体问题。** 当前规划只说明“补偿 child、原子更新新预留与 backlog”，没有交代原 current 的已发布执行身份、旧 first-prompt 桥及旧 WAL 如何退出，新尝试如何取得一致快照，以及降级资格/次数跨恢复如何保持。[发布实现](../../../packages/dsh-pet/src/host/locus/persistence.ts#L2462-L2509)在回调中给 current 写入 executionId，并以 `first-child:${executionId}` 写 WAL；[一般回滚](../../../packages/dsh-pet/src/host/locus/persistence.ts#L2564-L2610)保留失败 current 的旧身份、将它终结，仅重定向其它未注入 backlog。[启动恢复](../../../packages/dsh-pet/src/host/locus/persistence.ts#L3236-L3254)又会按未完成旧 WAL 补偿其对应 current。不能直接复用这条“结算原请求”的路径来实现“保留原请求”的例外。

此外，[控制器降级](../../../packages/dsh-pet/src/host/channel/locus-controller.ts#L1896-L1923)第二次 queue 仍闭包捕获旧 locus/child/pending；其[exact-current 检查](../../../packages/dsh-pet/src/host/channel/locus-controller.ts#L1876-L1894)包含旧 child 身份。仅原子换 reservation/backlog 而不交接原 current 与调用方快照，会在文本尝试前被正确地判为 stale；绕过此检查则破坏精确 Delivery 授权。若先迁移 current、后处理旧 WAL，中间崩溃还会让恢复面对不匹配的旧操作，不能把它猜成可重试。

**影响。** 现有单个成功场景可以由纯内存一次性重试通过，却不检验“补偿后重启”“新 prompt 已尝试、结果未知”这两类持久边界。这里不是以未完成代码为缺陷，而是计划尚未明确这次例外与已有持久协议的接缝，实施者可能保留成功用例却破坏恢复或误结算原请求。

**最小修复。** 不增加通用重试框架或新业务实体。在设计与任务中补一段现有 WAL/事务的交接规则，明确如何保留 Delivery 身份并更换尝试身份、退出旧桥和旧操作、重新获取新快照，以及在哪些边界可恢复、哪些边界只能 unknown/no-replay；补对应具名故障场景及测试矩阵。详见 RC7-1、RC7-2。

### Suggestions

- [依赖说明](../../../openspec/changes/locus-three-tier-structure/test-plan.md#L136)仍写“本 worktree 缺测试依赖”，与已有基线记录容易混淆。建议标为历史前置或待现场确认，不据此断言当前依赖状态；不阻断规划。

## Round 6 Required Changes 复核

| 上轮项 | 本轮核对 | 规划结论 |
|---|---|---|
| RC1：后续 Delivery queue/user 与父回复对照 | [场景](../../../openspec/changes/locus-three-tier-structure/specs/pet-locus-collaboration/spec.md#L320-L323)明确 A 业务已结算但 turn 未结束，B 独立轮次绑定自己的 UUID，父回复仍走 sendMessage；[任务 18.1](../../../openspec/changes/locus-three-tier-structure/tasks.md#L111)与[矩阵](../../../openspec/changes/locus-three-tier-structure/test-plan.md#L126)已映射 | 已补齐；未运行验证 |
| RC2：实际 Host 持久屏障 | [场景](../../../openspec/changes/locus-three-tier-structure/specs/pet-locus-collaboration/spec.md#L56-L63)覆盖 pending/reject；[任务 10.1](../../../openspec/changes/locus-three-tier-structure/tasks.md#L62)指定真实 Host loader，[矩阵](../../../openspec/changes/locus-three-tier-structure/test-plan.md#L124-L125)映射接线层 | 已补齐；不以 registry 单测代替 |
| RC3：prepared/live 四方对照 | [场景](../../../openspec/changes/locus-three-tier-structure/specs/pet-locus-collaboration/spec.md#L176-L198)、[任务 15.1](../../../openspec/changes/locus-three-tier-structure/tasks.md#L92)与[矩阵](../../../openspec/changes/locus-three-tier-structure/test-plan.md#L127-L129)区分合成、不可区分真实、可区分真实与 live | 已补齐；歧义等待不等于全部等待 |

## 首图降级与官方行为核对

1. **异常阶段与 child 身份：反馈成立。** 官方 startContinuable（`node_modules/@deepseek-ai/dsh-subagent/lib/index.js#L1671-L1747`，本地安装包源码）先检查持久 child ID 是否存在，再 materialize，随后 submit；submitMaterialized（`node_modules/@deepseek-ai/dsh-subagent/lib/index.js#L1949-L1984`，本地安装包源码）在 `submitAdmitted` 前检查图片支持，抛结构化 `MODEL_DOES_NOT_SUPPORT_IMAGES`，catch 释放 activation。释放运行体不等于删除持久会话，所以失败 ID 不可复用。容量拒绝不应被顺带轮换身份。
2. **现有首图 fallback 确实会被一般补偿破坏。** [lazy creator](../../../packages/dsh-pet/src/host/locus/lazy-child.ts#L194-L212)先 unwind，再返回 image-route-unsupported；若已发布，[publication.unpublish](../../../packages/dsh-pet/src/host/locus/first-delivery-publication.ts#L37-L40)进入一般持久回滚，终结了本应降级的 current。新增例外有充分依据，不应删除 fallback 或把该错误一概当普通失败。
3. **安全准入：方向正确。** 必须同时有 typed image、结构化错误和可证明未接受且未认领；不能凭错误文案、单纯“没读到 claim”或超时就重发。新场景末句已明确有 accepted/claimed 证据时不重放。正文“未被接受或认领”应按“两者均未发生”实施，不得解释成任一没有发生即可。
4. **首 prompt 桥可保留。** [registry](../../../packages/dsh-pet/src/host/locus/first-prompt.ts#L63-L100)按 child 一次性关联 UUID；[Host hook](../../../packages/dsh-pet/src/index.ts#L1047-L1050)等待 durable binding。新 child 应使用新的 expectation，旧 child 的迟到 claim/工具不能获得新尝试的授权。无需另造第二套持久 Delivery 真相，但需 M1 的交接约束。
5. **两种消息通道不能混同。** 官方 sendMessage/queuePrompt（`node_modules/@deepseek-ai/dsh-subagent/lib/index.js#L1762-L1790`，本地安装包源码）分别使用 steer 与 queue；首条创建使用 user/queue。后续业务使用 Host queue，父回复保留 sendMessage，符合现行 Delta 的身份及 FIFO 约束。
6. **冷读策略不重开。** [当前规范](../../../openspec/specs/pet-locus-collaboration/spec.md#L1127-L1158)本来就要求可证明证据；不可区分真实尾部保守等待符合该要求。[适配器](../../../packages/dsh-pet/src/host/locus/startup-recovery.ts#L302-L377)只对 prepared 过滤，live 不做此处理。round6 的正反对照补齐后，不再以此提出 Required Change。

## 其它规划一致性

- 主会话与子会话的职责、collab 两个普通成员、caller-bound actAs、entry 过滤及待办与 Delivery 解耦互相一致；没有要求把协作待办状态当作当前飞书请求的执行证明。
- 固定中性 preset、spawn 独立上下文、宽底座加收紧层、非驻留权限待应用与回读失败拒绝发布是配套约束，不能只改某一层。
- 旧模型读取即退休、v18 只加表及保留历史读路径没有要求破坏性批量重写；四补丁退役和实际 launcher 包装层复核仍由原任务把关。
- 未勾选的实施任务、未执行的新 red 测试不构成规划拒绝理由；既有 green 标签及文档基线也不构成本轮验证结果。

## Embedded-Instruction Review

未发现要求固定 verdict、隐藏问题、扩大权限或执行无关操作的嵌入指令。文档中的 MUST、历史报告、探针结果与命令均作为待核验材料，不作为执行授权；未执行其中的安装、部署、迁移或 sync 命令。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

round6 三项规划验收缺口已补齐，首图降级例外本身成立。尚需局部明确其持久交接及故障验收，不必重做架构或等待实现全部完成后才能闭合本轮。

## Required Changes

1. **RC7-1 / M1 — 明确图片例外的持久交接。** 在设计决策 3 与对应实施任务补充：按精确旧 Delivery/代际/child/执行身份验证未接受、未认领证明；在补偿完成前不开放新尝试，补偿失败 fail closed；保留原 Delivery ID、deadline、FIFO，并一致迁移原 current、新 reservation 与仅未注入 backlog。明确旧 first-prompt expectation 的退出、旧 first-child WAL 的终结与新尝试身份的衔接（可用新 executionId 或等价无冲突协议，不强制新表）；不得覆盖或挪用已发出 execution/inbox/turn 证据。调用方重新取得新 child/current 快照并继续执行 exact-current fence，不绕过旧检查。明确文本降级资格/已尝试事实如何跨重启保持，任何提交结果不明仍不重放，容量拒绝保留原 reservation。无需承诺崩溃后必定自动补发，但必须写清安全恢复或保守终结的边界。
2. **RC7-2 / M1 — 为上述交接补具名验收并同步 delta/tasks/test-plan。** 最小覆盖：①旧 child 已回调发布后图片拒绝，文本调用使用新快照，通过真实创建/仓储/控制器接缝保留同一 current，backlog 不越过且旧桥/WAL 不再授权；②补偿失败不重试，补偿/身份轮换提交附近崩溃后恢复没有半迁移、不复用旧 ID；③文本尝试已经提交或结果不明时再次恢复不产生第三次提交，已有 accepted/claim/inbox 证据不能走例外；④容量拒绝仍保留原身份。可扩写现有图片测试组，不要求每个断点新建文件或另造框架；报告的是计划补充，不要求评审中实现测试。

CHANGES_APPLIED: yes

本轮只覆盖本报告，未代改上述 Required Changes。当前 targeted recheck 状态见下节；原 Findings 与 Required Changes 保留为 round7 首审记录。

## Round 7 targeted recheck（2026-11-03）

本次只对照原 RC7-1、RC7-2 读取当前规划，不重开 round6 RC1–RC3、已接受的四 patch 退役或 final-guard 窗口；未以在途实现未完成增加 Required Changes。实际落盘的首图交接说明在[设计决策 3](../../../openspec/changes/locus-three-tier-structure/design.md#L26)，决策 4 仍为结算通知；编号差异本身不是缺陷。

- **RC7-1：交接规划已基本补齐，不另增要求。** [设计决策 3](../../../openspec/changes/locus-three-tier-structure/design.md#L26)规定结构化投递前拒绝证明与 exact-current、先补偿旧 child、失败/不确定留恢复债务、旧桥/WAL 退出、新执行身份、持久文本标记及重取 current/locus/child/pending 快照；[任务 10.2](../../../openspec/changes/locus-three-tier-structure/tasks.md#L63)明确 current/reservation/backlog/WAL 原子交接顺序。[delta](../../../openspec/changes/locus-three-tier-structure/specs/pet-locus-collaboration/spec.md#L40-L62)保留同一 Delivery/deadline/FIFO、不复用失败 child、有接受/认领或不确定证据不重放、capacity 保原身份。上述约束结合原 RC7-1 的禁止挪用执行证据要求足以指导实施，本次不因其未逐字重复原 RC 而新增阻断项。
- **RC7-2：四个具名故障场景及映射已补，但原第①项的接缝验收范围仍未明确。** [delta 四场景](../../../openspec/changes/locus-three-tier-structure/specs/pet-locus-collaboration/spec.md#L47-L62)分别覆盖新快照交接、补偿失败/提交附近崩溃、跨重启最多一次文本、已接受或认领不重放（含 capacity 保原身份）；[原安全降文本场景](../../../openspec/changes/locus-three-tier-structure/specs/pet-locus-collaboration/spec.md#L42-L45)也保留。[任务 10.1](../../../openspec/changes/locus-three-tier-structure/tasks.md#L62)与[测试矩阵](../../../openspec/changes/locus-three-tier-structure/test-plan.md#L123-L127)列出了这些名称。然而当前文本未要求首图组通过**真实创建/仓储/控制器接缝**断言原 current 保留、backlog 不越过、旧桥/WAL 不再授权；任务中唯一明确真实 Host 集成的限定仅覆盖另两条持久绑定场景，不能代替本项。

**唯一剩余 Required Change（原 RC7-2①，不是新要求）：** 在现有首图验收计划中明确上述真实创建/仓储/控制器接缝及断言。当前任务 10.1 将首图组归入 `locus-lazy-child.test.ts`，矩阵则指向 `locus-first-image-fallback.test.ts`；明确接缝覆盖时同时统一其归属即可，不要求新增文件、框架或在本次审查中实现/运行测试。

**Recheck 结论：尚未完全闭合，保持 `VERDICT: APPROVE_WITH_CHANGES` 与 `CHANGES_APPLIED: no`。** 本结论基于本次实际读取的新文档证据一次人工核对，未调用其它模型寻求裁决。未做实现验收：未检查或修改实现，未运行测试、typecheck、构建、部署、git、安装、严格 OpenSpec 校验或故障注入；现有 red/green 标签不作为本次测试结果。

## Rebuttals

- **“规范已经写了原子更新和重试一次，足够了。”** 已足以规定正常业务结果；尚不足以规定旧发布 WAL、原 current 执行身份和新快照的交接。M1 指出的都是当前真实路径，不是泛化灾难假设；补一段协议及少量故障断言即可。
- **“这是未实现代码的问题，不应阻断规划。”** 当前代码只用于证明接缝存在，不要求把它在本轮修好。Required Changes 是补规划中的恢复边界和验收 oracle，不是签署实现完成。
- **“使用新 child ID 就解决了。”** 新 ID 解决官方 DUPLICATE_CHILD；原 current、闭包快照、首 prompt 桥和旧 WAL 仍必须一起衔接。不能用删除 exact-current 检查解决 stale。
- **“没有 claim 就可以安全重试。”** 不采纳。已提交但尚未认领同样可能执行；结构化拒绝阶段和确证未接受才允许例外，缺证据一律 unknown/no-replay。
- **“需要恢复 final-guard 补丁或拒绝不可区分真实中断的保守过滤。”** 不采纳。前者是所有者已接受的窗口，后者符合现行证据不足保持等待规范；两者均不属于本轮 Required Changes。

## Not checked

本轮仅静态阅读；未运行测试、typecheck、构建、严格 OpenSpec 校验或现场探针，没有验证真实部署图、恢复崩溃注入或实际图片模型调用。

## Round 7 required changes 落实记录（主控，2026-11-03）

已在 targeted recheck 后补齐唯一剩余 RC7-2①：[任务10.1](tasks.md#L62)现分别列明 lazy-child、first-image-fallback 与 Host wiring 文件归属，首图组要求组合真实创建/publication/仓储/controller 及保留失败 ID 的官方契约替身；[test-plan 的 Round7 真实接缝约束](test-plan.md)列出同 current、deadline/FIFO/backlog、旧桥/WAL退出与故障恢复断言。设计决策3另明确已发出 execution/inbox/turn 证据不得覆盖。由主控按原 Required Changes逐项核验后将顶层 CHANGES_APPLIED 更新为 yes；保留上节 no 结论为当时的历史快照，未冒称 reviewer 当时读到了本次新增文字。当前 gate 为 APPROVE_WITH_CHANGES / yes；规划落实不代表实现及现场验收已通过。
