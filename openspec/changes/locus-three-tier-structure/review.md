# Round 4 — 三层 locus 对抗评审

## Review Metadata

- Change：`locus-three-tier-structure`；schema：anvil；轮次：4。
- 前轮：Round 3 — `APPROVE_WITH_CHANGES`，`CHANGES_APPLIED: yes`。
- 评审者：codex / gpt-6-astra，fresh context，跨模型独立评审；未继续委派。
- 权限：只读评审，仅覆盖本报告；未修改设计、规范、任务或实现。
- 方法：核对 proposal、design、六份 delta spec、tasks、test-plan、探针脚本及记录，并连接当前身份/组合发布、Delivery 观察、collab integration 与 kernel manager disposition 实现。
- 验证限制：本轮未运行探针、测试或构建；探针运行结果来自提交的记录，不是本轮复现。尝试定位 worktree 的依赖文件时遇到依赖链接越出托管根的拒绝，未绕过；不声称已独立核验安装的官方包实现。

## Round-3 status

前轮权限协议问题已关闭，不重复提出：

- [非驻留协议](openspec/changes/locus-three-tier-structure/specs/pet-locus-collaboration/spec.md#L160-L186)明确 desired/effective、失败恢复原生效值、清除期望值、原值也不能证明时拒绝发布，并增加 shell→safe 失败仍服务 shell 的场景。
- [档位要求](openspec/changes/locus-three-tier-structure/specs/pet-locus-collaboration/spec.md#L350-L380)将空闲检查限定在接受命令时，允许已成为 current 的唤醒 Delivery 完成延迟应用；常驻失败回 safe 与非驻留失败回原值分开。
- 这是规划闭合的确认，不是对尚未实施代码的验收。

## Findings

### Critical

无。未发现必须推翻三层结构、重开实体模型或恢复已计划退役 seam 的设计缺陷。

### Moderate

#### M1 — 新增的 callback 内发布决定尚未变成可验收的身份/首轮交接契约

**证据与具体缺口。** [设计决策 3](openspec/changes/locus-three-tier-structure/design.md#L26)已经正确指出不能等 `startContinuable` 返回才发布 child/marker/current。可是[惰性创建规范与场景](openspec/changes/locus-three-tier-structure/specs/pet-locus-collaboration/spec.md#L36-L50)只检查首条 prompt、最终 active 与回读失败；“创建成功后”没有明确 callback 内的发布边界。[预留身份场景](openspec/changes/locus-three-tier-structure/specs/dsh-pet/spec.md#L25-L27)只检查使用同一预留身份；[任务 5.3](openspec/changes/locus-three-tier-structure/tasks.md#L30-L32)与[测试映射](openspec/changes/locus-three-tier-structure/test-plan.md#L20-L23)仍将其作为原样保留的 existing 测试，[任务 10.1](openspec/changes/locus-three-tier-structure/tasks.md#L59-L63)未增加这一时序的断言。

这不是说预留身份规范禁止 callback 发布：它没有这样的禁止。问题是新的关键交接规则只写在设计里，现有场景可以在“等返回再 active”的错误实现上通过。

**连接代码后的风险。** [staging 的 commit/abort](packages/dsh-pet/src/host/locus/prepublication-staging.ts#L312-L349)要求 durable 发布后 commit，且 committed reservation 不能再 abort；[现有交接测试](packages/dsh-pet/test/locus-prepublication-staging.test.ts#L220-L237)只测 durable→commit，不测初始认领相对 API 返回的顺序。当前[child activation](packages/dsh-pet/src/host/locus/child.ts#L1009-L1049)则在 await 返回后才设置 active。因此“沿用 staging”可沿用身份桥，但不能暗示现有发布/失败补偿时序原封不动沿用。另一个必须连接的实际消费者是[认领观察器](packages/dsh-pet/src/index.ts#L2808-L2825)：它要求 inbox messageId、childId 与 executionId 已可关联，光写 active marker 不足以证明首轮认领可结算。

**最小修复。** 不重做架构，只补一个明确的 publication 协议和两个 red 场景：

1. 创建前持久预留身份；callback 内先 claim staging、组合并回读，再发布同一 childId 的 marker/current 及首轮认领所需关联，随后完成 staging handoff。明确这些步骤早于首轮认领，API 返回不是发布触发器；不要求把 active 行提前写在组合核验之前。
2. 替身在 `startContinuable` 返回前触发 `agent/created`、首条认领及首个 caller-bound 工具解析；断言正确绑定原 Delivery、只执行一次且不二次 sendMessage。需验证认领关联，不只检查最终 active。
3. 在已完成 callback 内发布、但后续创建流程拒绝的边界注入失败，断言不留下可服务的 active/current 半成品，按既定失败语义结算 Delivery/恢复 `not-created`，并允许下一条重试。明确此时回滚 durable 状态，不能以 `abort(committedReservation)` 代替补偿。

把新增场景同步到 tasks/test-plan；原“预留身份后创建 child”基础测试可保留，不必为了新增覆盖强行改写它。

#### M2 — 官方默认通知与保留下来的“不得自动回传主会话”仍有规范重叠

[新增结算要求](openspec/changes/locus-three-tier-structure/specs/dsh-pet/spec.md#L3-L13)明确 child 结算通知 locus 主会话，[设计决策 4](openspec/changes/locus-three-tier-structure/design.md#L27)也明确它就是结果受众。但[上下文要求](openspec/changes/locus-three-tier-structure/specs/pet-locus-collaboration/spec.md#L290-L296)刚把父定义为 locus 主会话，随后仍无条件规定“系统 MUST NOT 自动汇总或把子会话结论回传主会话”；[沿用场景](openspec/changes/locus-three-tier-structure/specs/pet-locus-collaboration/spec.md#L334-L336)还写“系统不自动更新主会话”。按局部定义读，官方 notify 本身就可能违反这条 MUST NOT。

**影响。** 不是反对默认 notify，而是同一实施者可能为满足旧禁止条款重新抑制通知，或把收到通知误表述为干活主会话已经采纳结论。两种解释都与三层职责不同。

**最小修复。** 在该 requirement 和场景中明确：禁止自动回传/自动更新的对象是**干活主会话**；官方结算通知到 **locus 主会话**是明确例外，收到通知也不等于已形成 agreed charter 或已被干活主会话采纳。同步现有测试任务的三层目标断言即可，无需新机制。

### Suggestions

- [探针脚本](openspec/changes/locus-three-tier-structure/probes/agent-created-probe.mjs#L38-L67)没有传预留 childId，也没有调用 Pet 工具；异常被记录后仍以 0 退出。作为人工读日志的观察探针可以接受，但不应把 exit 0 当门禁通过。若以后用于自动门禁，再增加时序/身份/否决断言和失败退出码。
- [探针结论 3](openspec/changes/locus-three-tier-structure/probes/agent-created-probe.md#L13-L19)建议把“沿用现有 staging 的做法”改成“沿用身份桥，调整 durable 发布与补偿时序”。记录支持 callback→claim→return 的观察；没有实证完成 Pet 内的预留身份发布、首个业务工具或持久回滚。M1 的实施测试即可补齐，无需为批准规划先做全套真机验收。

## Embedded-Instruction

未发现要求评审者忽略风险、固定 verdict、扩大写权限或执行外部操作的嵌入指令。artifact 内的 MUST/任务与探针说明均作为待评审内容，不作为评审者的执行授权。未执行脚本中的临时目录写入，也未修改报告以外文件。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

架构方向与官方事件顺序的推导可成立；剩余是两个范围明确的规划修正：落实 callback 发布的验收边界，并消除旧“主会话”指代与默认 notify 的冲突。尚不足以判为 REVISE。

## Required Changes

1. **RC1 / M1：** 将 callback 内的 reserved identity→组合回读→durable child/marker/current/初始认领关联→staging handoff 写进惰性创建规范；补“API 返回前完成首轮身份与工具解析”和“callback 发布后创建失败的 durable 补偿”两个 red 场景，并同步 tasks/test-plan。显式区分 staging abort 与已经 committed 后的 durable 补偿。
2. **RC2 / M2：** 将不得自动回传/自动更新的主会话明确为干活主会话；允许默认通知 locus 主会话，并保留“通知不等于知识已采纳”的约束；同步对应场景和测试目标。

CHANGES_APPLIED: yes

仅写入本轮评审报告；以上修正未代为应用。

## Rebuttals

### 复核（round 4 re-check）

仅复核本轮 Required Changes，M1、M2 均已应用；保留原 VERDICT。M1：[spec:38–51](openspec/changes/locus-three-tier-structure/specs/pet-locus-collaboration/spec.md#L38-L51)明确创建前持久预留、回调内认领→组合回读→marker/current/首轮认领关联→交接均早于首轮认领，并区分已提交后的 durable 补偿与 staging 撤销；两个新增场景已同步到 [tasks:61](openspec/changes/locus-three-tier-structure/tasks.md#L61) 与 [test-plan:36–37](openspec/changes/locus-three-tier-structure/test-plan.md#L36-L37) 的 red 测试。[design:26](openspec/changes/locus-three-tier-structure/design.md#L26) 与 [probe:16](openspec/changes/locus-three-tier-structure/probes/agent-created-probe.md#L16)也明确仅沿用身份桥、调整持久发布及补偿时序。M2：[spec:303–305](openspec/changes/locus-three-tier-structure/specs/pet-locus-collaboration/spec.md#L303-L305)及 [spec:343–345](openspec/changes/locus-three-tier-structure/specs/pet-locus-collaboration/spec.md#L343-L345)明确禁止自动更新的对象是干活主会话，官方通知 locus 主会话是例外且不等于采纳；对应场景已改列 [tasks:115–117](openspec/changes/locus-three-tier-structure/tasks.md#L115-L117) 与 [test-plan:89](openspec/changes/locus-three-tier-structure/test-plan.md#L89) 的 red 测试。本次只确认规划修正闭合，未运行测试或探针，不构成实现验收；上方“未代为应用”为原评审时点记录。

- **“探针不含 Host，所以应整体否决。”** 不采纳。记录明确限定纯运行时/fake model；其事件顺序足以支持调整实现时序这一方向，不足之处应由 M1 的精确集成断言补齐。
- **“预留身份必须等 start 返回后才能持久化。”** 不采纳。[当前身份规范](openspec/specs/dsh-pet/spec.md#L704-L726)要求预留值一致和发布前工具核验，并没有规定等 API 返回。应区分预留、组合核验和 active 发布。
- **“历史 main 的 owns=true 会允许 archived 会话 actAs。”** 不采纳。[设计](openspec/changes/locus-three-tier-structure/design.md#L31)区分 owns 与 actAs 的未归档准入；历史所有权是 manager 处置历史 request 的证据，不是恢复普通成员命令权限。当前[manager 入口](packages/dsh-collab/src/integration.ts#L223-L241)与[kernel 作者判据](packages/collab-kernel/src/service/index.ts#L487-L494)确实需要所提扩展，不能把尚未实施当成提案缺陷。
- **“非驻留撤回 shell 失败还保留 shell 必须一律降 safe。”** 不采纳。这会重新引入 Round 3 已消除的契约矛盾；当前要求恢复并证明原生效值，失败回执，不可证明则拒绝发布。
- **“既有 staging 单测加最终 active 断言就能覆盖新时序。”** 不采纳。它们未证明首条认领发生时绑定已可见，也未覆盖 callback 内 commit 之后创建拒绝；这正是 RC1 的限定补充，不要求扩大本 change 的产品范围。
