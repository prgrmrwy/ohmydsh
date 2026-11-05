## Review Metadata

- **Review round**: 3
- **Prior round**: round 2 REVISE (3 critical, 4 moderate)
- **Reviewer context**: cross-model codex gpt-6.1-sol, fresh context, read-only
- **Tool restrictions**: 唯一写入为完整替换本报告；未运行测试、构建、迁移、部署或重启；未打开、复制或操作线上状态库；未修改实现、其它 artifact 或记忆库。第三轮由所有者在连续两次 REVISE 后明确授权。
- **Artifacts reviewed**: [proposal](<proposal.md>)、[design D1–D17](<design.md>)、[collaboration delta](<specs/pet-locus-collaboration/spec.md>)、[doc-comments delta](<specs/pet-locus-doc-comments/spec.md>)、[Round 1](<review-round1.md>)、[Round 2 及作者答复](<review-round2.md>)；两份 [current collaboration spec](<../../specs/pet-locus-collaboration/spec.md>) / [current doc-comments spec](<../../specs/pet-locus-doc-comments/spec.md>)、[manifest](<../../../dsh.yaml>)、[ADR-0009](<../../../packages/dsh-pet/docs/adr/ADR-0009-locus-three-tier-structure.md>)、[集成陷阱](<../../../docs/architecture/dsh-plugin-integration-pitfalls.md#L546-L614>)；下述 Pet controller、persistence、adapter、resolution、channel、composition、staging、first-delivery、collab、storage、迁移脚本与测试夹具；安装依赖中 subagent manager、agent registry、API session controller 的静态实现。未发现 openspec/project.md；本 change 尚无 tasks/test-plan。

评审对象是**计划是否可实现、自洽且能生成可靠验收**，不是要求尚未编写的 v20 代码现在就通过测试。运行假设：一个独占 Pet 库的 Host、一个长期 repository/controller、多路异步调用交错。接受所有固定产品规则及本轮的简化方向，不要求恢复 lazy 迁移、持久 access operation、live apply/rollback、历史表或额外实例编号。

**时效**：结论仅适用于本轮读到的 artifact。除落实本报告 Required Changes 外，后续修改 proposal/design/specs 将使结论失效。

## Findings

### 🔴 Critical (blocking)

#### R3-C1 — “整 W”只枚举一个 M，漏掉真实 v19 会留下的其它配对；默认 Q&A 仍可因此重复创建

- **计划证据**：[D7:99–104](<design.md#L99-L104>) 称整 W，却只按触发入口的 M 枚举群、退休这个 M，并永远新建目标。与此同时 [D13:178–193](<design.md#L178-L193>) 只归并“话题与群跨 M”，没有归并“同 W 的不同群分散在 retired/active M”。[残留场景:1472–1475](<specs/pet-locus-collaboration/spec.md#L1472-L1475>) 甚至仍承认已有 active M1、另一个群引用旧配对。
- **不是假想坏库**：当前 [migrateLocusMainLocked:1816–1826](<../../../packages/dsh-pet/src/host/locus/controller.ts#L1816-L1826>) 跳过 busy 和 owner-exit 入口，然后 [1877–1882](<../../../packages/dsh-pet/src/host/locus/controller.ts#L1877-L1882>) 发布 M1 并退休 M0。忙群的 Delivery 随后终态，不会自动改其父 M；[v19 validator:4747–4777](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4747-L4777>) 明确接受引用 retired 配对的行。因此这类全库无未终态投递的 v19 输入可以通过本次离线预检。
- **具体失败**：W 的普通群 G 已在 active M1，默认 Q&A 群 Q 仍在 retired M0。v20 原样保留两个群的 M，并把 Q 的旧指针改成行标记。打开 W 默认 Q&A 仍沿 [active-M reader:113–117](<../../../packages/dsh-pet/src/host/locus/controller-persistence-adapter.ts#L113-L117>)，看不到 Q；[createOrOpenDefaultQa:817–863](<../../../packages/dsh-pet/src/host/locus/controller.ts#L817-L863>) 因此创建第二个群。若 Q 的 at 先触发迁移，新建 M2 但只退休 M0，真实 [commit guard:3018–3030](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3018-L3030>) 会因 W 已有 active M1 而拒绝；逐行 CAS 无法改变这一配对冲突。删除该 guard 则会违反“一 W 至多一个 active M”。
- **最小修订**：不恢复运行期 lazy/复用分支。扩展已有 v20 离线归并：对同 W、唯一 active M 已存在但最新群行仍挂在其它 retired 配对的合法输入，把这些群统一归入该 active M，移动群的非 stopped 入口按既有重置规则处理，dry-run 明示上下文损失；在归并完成后再设置/去重 `defaultQa`。这样运行期 D7 的“一个 M 覆盖整 W”才有可验证的初始前提。修正上述残留场景，并明确不能用忽略 active-M guard 代替归并。
- **必须验收**：用上述真实 v19 形状、所有 Delivery 已终态的夹具跑迁移；再从 W 打开默认 Q&A，返回原 Q、外部建群为 0；Q/普通 G 的 at 不触发配对冲突；重启后仍成立。归并后的多个默认候选沿现有“全部清除且列出”规则处理，不能最后写入者获胜。

#### R3-C2 — backlog 派发器在发现 M 不可用之前先 claim，反而制造了阻止迁移的 current

- **计划证据**：[D7:100–105](<design.md#L100-L105>) / [delta:1407–1411](<specs/pet-locus-collaboration/spec.md#L1407-L1411>) 新增“current 结算后的 backlog 推进也触发迁移”，并要求有任何 current 就不迁。没有指定在现有派发顺序的哪个位置做这件事。
- **真实顺序**：[dispatchNextActive:1089–1107](<../../../packages/dsh-pet/src/host/channel/locus-controller.ts#L1089-L1107>) 先 `resolveCurrent`；它只读 [factsOf(record, false):333–345](<../../../packages/dsh-pet/src/host/locus/resolution.ts#L333-L345>)，不跑异步 `verifyMain`。然后 [1158–1175](<../../../packages/dsh-pet/src/host/channel/locus-controller.ts#L1158-L1175>) claim backlog 为 current。直到 [dispatchClaimed:1194–1209](<../../../packages/dsh-pet/src/host/channel/locus-controller.ts#L1194-L1209>) → [resolveLocus:2278–2305](<../../../packages/dsh-pet/src/host/channel/locus-controller.ts#L2278-L2305>) → [ensureForDelivery:358–398](<../../../packages/dsh-pet/src/host/locus/resolution.ts#L358-L398>)，才核验 M 并调用修复。
- **具体失败**：A 结算、B 在 backlog，M 已删除或 preset 错误但配对仍 active。派发器先把 B claim 为 current，随后才发现 M 不可用；D7 被刚造出的 B 挡住。到期后下一条重复此过程。M 被归档的分支更早在 `resolveCurrent` 抛错后返回，连修复都不会进入。单测只断言“B 改指新 sessionId”捕捉不到此问题。
- **最小修订**：把 delivery-time M 核验及必要迁移接到 **claim 之前**；对已知的 M 不可用不能沿旧 catch-return 路径静默结束。迁移成功后重读入口与 backlog 的新 `sessionId`，用新 correlation claim/dispatch；其它群的 current 仍按原规则阻挡。无需新状态机或额外调度器。
- **必须验收**：不发送新的 at，仅让 A 终结推进 B，分别注入 archived / missing / preset 错误 M。每例证明迁移发生于 B claim 之前，B 经新预留实际进入一次首创/投递，而不是只检查数据库行；其它群有 current 时 B 保持 backlog，不先占 current。

#### R3-C3 — enqueue 的 access acquire 修好了 acceptance 竞态，但 drain→CAS 期间仍可被父回复重新冷恢复

- **接受的部分**：[D8:118](<design.md#L118>) 将 acquire 放进同一写队列，能封住 R2-C1 的“acceptance 写入中但不可见”窗口；[enqueue:4270–4276](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4270-L4276>) 确实等待先前写操作完成。
- **遗漏的真实入口**：Set 只列 acceptance/stop/rebind/migrate/rebuild，没有挡 agent publication。父 M 的 [locus_reply_child:252–268](<../../../packages/dsh-pet/src/host/collab/locus-tools.ts#L252-L268>) 只要求 child 是 active 行，不要求 current，不检查该 Set；官方 [deliverFollowup:1111–1123] (node_modules/@deepseek-ai/dsh-subagent/lib/types/manager.js#L1111-L1123) 对已释放 child 会冷恢复，并在 [coldResume:1200–1222] (node_modules/@deepseek-ai/dsh-subagent/lib/types/manager.js#L1200-L1222) 组装后投递。新的 [D15 active 分支](<design.md#L198-L203>) 会允许它发布。
- **具体交错**：入口无 Delivery，原值 full；access acquire 成功，旧 child drain 完成。访问变更的 CAS 尚在 repository/medium await 时，M 的一条迟到回复冷恢复同一 child，按仍为 full 的旧行发布。CAS 随后把行改成 read 并 finally 清 Set；live child 却仍是 full，下一次不必再组装。这直接违反“变更后下一次唤醒按新值核验”的安全前提，不是要求恢复 live 回滚。
- **最小修订**：在现有单次组合 lookup / `agent/created` 发布边界也检查同一个 `accessChanging` Set，命中就拒绝本次发布；cold reply 不能绕过它。drain 成功后、CAS 前还要确认目标 live agent 已退出，避免把 manager 的 absent-target no-op 当作释放证明。保持进程内 Set、无持久 access operation、无 live apply/rollback。
- **必须验收**：暂停 CAS 持久提交，在 drain 与 CAS 之间通过真实 `locus_reply_child` seam 触发冷恢复；不得按旧模式发布。CAS 完成后再唤醒，恰按新模式核验；兄弟 child 不被释放或阻断。

### 🟡 Moderate

#### R3-M1 — drainChildren 是“精确 parent + 指定 child 列表”，而且抛错不意味着 child 未变

- **计划证据**：[D8:120–123](<design.md#L120-L123>) 和 [访问模式:17–21、50–53](<specs/pet-locus-collaboration/spec.md#L17-L53>) 使用 `drainChildren(exact-parent)` 的简写，并断言释放失败时“行和子会话都没变”“子会话仍在运行”。这是不能由真实 API 保证的 THEN。
- **真实语义**：[manager:289–307] (node_modules/@deepseek-ai/dsh-subagent/lib/types/manager.js#L289-L307) 需要 exact live parent **和** `[childId]`；其它兄弟不受影响，resident 中没有目标时成功 no-op。[close:659–669] (node_modules/@deepseek-ai/dsh-subagent/lib/types/manager.js#L659-L669) 先同步关闭 admission；[finishDisposal:995–1058] (node_modules/@deepseek-ai/dsh-subagent/lib/types/manager.js#L995-L1058) 即使取消/句柄释放报错，也会尝试释放并删除 resident、释放 slot，最后才抛错。Pet 已有 [exact release 用法:1169–1187](<../../../packages/dsh-pet/src/host/locus/child.ts#L1169-L1187>) 可参考，但不能从 catch 推导 runtime 未改变。
- **最小修订**：写出 `drainChildren(exactLiveParent, [exactSessionId])`，并保留 turn 空闲证明、检查 inbox 无待处理输入（现有 [turn-only 检查:1038–1054](<../../../packages/dsh-pet/src/index.ts#L1038-L1054>) 本身不检查 inbox）。失败保证只承诺“行未改，access 拒绝；runtime 可能已释放或部分关闭”。后续照实际 live/冷恢复事实处理，不能回执 child 仍运行；不必为此添加 invalid 或回滚协议。
- **必须验收**：两名兄弟只释放指定一名、absent target、stale parent 拒绝，以及“实际 child 已消失但 drain promise reject”的故障。后者不得推进 access 行，也不得断言 child 仍在。

#### R3-M2 — D15 有序 lookup 应保留现存 first-creation recovery-debt veto

- **计划证据**：[D15:198–205](<design.md#L198-L205>) 现已正确区分 active 与 staged not-created，修好了 R2-M2；但 active 分支只要求行和 session 匹配。
- **真实保护**：原 [durable lookup:1015–1017](<../../../packages/dsh-pet/src/index.ts#L1015-L1017>) 不仅排除非 active，还拒绝 `hasFirstDeliveryRecoveryDebt`。该判定在 [3217–3220](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3217-L3220>) 检查 publishing/compensating/needs-recovery；[recoveryDebt 分支:2555–2574](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L2555-L2574>) 可留下仍 active、session 未变化的行。D16 也明确要求无法证明释放时拒绝再次创建。
- **具体失败**：首创发布后释放无法证明，留下恢复债；此时无 staged，但行仍 active。按新 D15 第 1 条，父回复触发的冷恢复会被允许，绕过当前源码的债务发布门禁。
- **最小修订**：把“无阻断的首创恢复债”保留为 active/staged 路径的共同前置条件；不是把非 active 一律抛错的旧逻辑搬回来，也不增加查找次数。新正常首创的 live publication 不应被误判成遗留债。
- **必须验收**：正常 staged 首创及首图轮换仍各 claim 一次；另用 active + needs-recovery 同 session 夹具，证明冷恢复/父回复均拒绝发布，直到既有恢复协议完成。

#### R3-M3 — stopped 根行的归属变化没有 revision 推进，且数个 THEN 仍与自己的前提/真实形状冲突

以下都是可定点改文案和断言的修订，不要求扩大产品范围：

1. **围栏遗漏**：[resetChat:154–157](<specs/pet-locus-collaboration/spec.md#L154-L157>) 先改群行的 M/工作区/reboundFrom/defaultQa，却只给非 stopped 行 revision+1。群行可以 stopped 而话题 active，这是 [543–546](<specs/pet-locus-collaboration/spec.md#L543-L546>) 明确支持的状态。该群改绑后，旧页面仍持同 locusId/revision，旧 access 请求可命中新 W 下的入口；这违反 [D3 唯一 CAS 围栏](<design.md#L65-L68>)。保持 stopped 状态不等于保持 revision；整群归属改变时所有受影响行须推进围栏，至少不能漏掉已实际改写的 stopped 根行。
2. **访问模式重置与创建失败例外**：[D8:115](<design.md#L114-L115>) / [delta:10](<specs/pet-locus-collaboration/spec.md#L10>) 说重置后一律 read；D17 对 stopped 行只随群移动，[resetChat:159](<specs/pet-locus-collaboration/spec.md#L159>) 又把创建失败轮换称为“同样的重置”。但 [首次 full 创建失败:1203–1206](<specs/pet-locus-collaboration/spec.md#L1203-L1206>) 正确要求保留 full。明确生命周期 reset 与“仅轮换首创身份”的差别：后者保留 accessMode；stopped 随整群移动仍保持 stopped，但访问模式与围栏按已定 reset 规则处理。另 [D16:212–213](<design.md#L211-L213>) 仍把首图降级列入失败投递结算，与 delta 已修好的 [1142–1144](<specs/pet-locus-collaboration/spec.md#L1142-L1144>) 相反，设计也要加预 prompt 首图例外。
3. **“queued 但未注入”不是实际持久形状**：[改绑场景:211–214](<specs/pet-locus-collaboration/spec.md#L211-L214>)、[迁移场景:1452–1455](<specs/pet-locus-collaboration/spec.md#L1452-L1455>) 使用两条 queued 未注入 Delivery。真实 acceptance 写的是 [accepted + backlog:2016–2023](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L2016-L2023>)；[schema:789–794](<../../../packages/dsh-pet/src/host/spec.ts#L789-L794>) 的 queued 反而必须有 inbox/execution 证据。改用真实 accepted/backlog、无 execution/inbox/turn 的夹具，明确已交给 runtime 的 queued/running/finishing 不能当成未注入 backlog 改指。原 [轮换过滤:2635–2640](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L2635-L2640>) 同样以证明字段区分，不能只按一个状态名判定。
4. **“没有主动唤醒，但最坏自行到期并收到回执”没有计时来源**：[D7:105](<design.md#L105>) / [delta:1411](<specs/pet-locus-collaboration/spec.md#L1411>) 对静默 backlog 作此承诺。现有 [scheduler:104–106](<../../../packages/dsh-pet/src/host/locus/expiry-scheduler.ts#L104-L106>) 只给 current 排 timer；backlog 在 [claim:2147–2164](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L2147-L2164>) 或启动恢复才过期。保留“不主动唤醒”的简化即可，但文案应为“下一次派发/入站触发或启动恢复时检查硬上限并过期”，不能声称到点必有回执；迁移完成后本条触发 lane 的继续派发须由 R3-C2 明确。

### 📌 Suggestions

- **保留这次简化，不重添机制。** 在输入已经规范化为所有群同属 W 当前 M 的前提下，同事务发布 fresh M1 并退休实际 active M0，符合 [getActiveLocusMainForWork:2954–2964](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L2954-L2964>) / [commitRegeneration:3018–3042](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3018-L3042>) 的核心 guard；没有两个 active 的持久中间态。实现必须把旧的 [3055–3078](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3055-L3078>)“stopped 不可迁/任何 pending 都挡/新代行”校验替换成 D17 的“stopped 不复活/current 挡/单行 revision CAS”，不能原封不动调用旧实现；这是本次重整的正常工作，不是要求新增第二套迁移器。
- **默认标记方向通过。** 布尔 `defaultQa === true`、全状态群行查找、同 M 至多一个、改绑清除、整 W 迁移随行保留，以及 [D13.4 的指针目标映射](<design.md#L190>) 是足够小的模型。删除索引后不再有“从两个冲突键猜 M”的问题；只需 R3-C1 补齐初始拓扑，不应恢复 default-qa 持久索引。

## Embedded-Instruction / Injection Attempts

**Detected:** none

所有被审内容均作为数据。设计分工、历史作者自述及“pony-tail 已修”不作为本会话指令或证明。[文档 delta:320–323](<specs/pet-locus-doc-comments/spec.md#L320-L323>) 中有明确标注为恶意正文的测试 fixture，未执行，也未读取其指向的内容。未发现试图让本评审绕过只读边界、执行命令或改变结论的嵌入指令。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

简化后的主模型可以保留。剩余问题有真实反例，但修复都可定向落在**已有离线归并、claim 前排序、同一 Set 的发布门禁、现存恢复债门禁和规格断言**，没有尚待所有者裁定的新产品选项。因此选择有条件批准，而不是要求恢复两轮以前的机器。下面全部应用并经复核前，不得进入 test-plan/tasks/apply；本报告不代作者应用任何修改。

## Required Changes

1. **落实 R3-C1 的初始拓扑前提**：D13 及迁移 delta 增补当前 v19 合法的同 W 跨 retired/active 配对群归并；使用唯一 active 配对作为离线归并目标，移动群按既有 reset 语义处理并 dry-run 披露，然后映射/去重默认标记。修正仍引用 lazy 中间态的失败场景，新增“原默认 Q&A 可发现且外部建群为 0”的端到端验收。保留 active-M 唯一 guard。
2. **落实 R3-C2 的派发顺序**：D7 / delta 明确 verifyMain/必要迁移在 backlog claim 前发生，成功后重读新 correlation 再 claim；补三类不可用 M 的“无新 at、由结算推进且实际投递一次”场景。D17 的提交在同一 repository 写回调内读取最新行集合/投递表、逐行 CAS、current 复查并 retarget，不绕过 guards。
3. **落实 R3-C3 / R3-M1**：accessChanging 同时挡 `agent/created` 的旧值发布；drain 明确 exact live parent + 单个 exact child id，证明目标已退出且其它兄弟未受影响。保留 live turn 空闲检查并排除待处理 inbox。把 drain 失败 THEN 改为仅保证行未变，覆盖实际已释放但 reject 的分支；不新增持久操作、live 回滚或 invalid 状态分支。
4. **落实 R3-M2**：D15 的单次 ordered lookup 保留现存 first-creation recovery-debt veto，同时不破坏正常 live staging；补 active+恢复债的冷恢复/父回复拒绝场景。保留首次创建与首图轮换各只 claim 一次的验收。
5. **落实 R3-M3.1–2**：所有整群归属变更受影响行推进 revision，包含 stopped 根；明确 stopped 保持状态与访问模式重置、首创失败轮换保留 accessMode 的边界；D16 加首图不结算例外。补 stopped 根+active 话题改绑后旧围栏拒绝场景。
6. **落实 R3-M3.3–4**：未注入 backlog 夹具改为真实 accepted/backlog 无执行证据，已注入状态不允许 retarget；把静默 backlog 的自行到期回执承诺改为既有派发/启动恢复触发语义。无需增加后台 backlog 定时器。

CHANGES_APPLIED: yes

## Rebuttals adjudication

以下逐项裁定 [Round 2 作者回应:119–126](<review-round2.md#L119-L126>)，不是接受作者自证。关闭的是上一轮具体反例，不代表新接口遗漏也自动关闭。

| Round 2 finding | 本轮裁定 | 源码核对与理由 |
|---|---|---|
| R2-C1 acceptance 与 access acquire 交错 | **accepted by reviewer** | D8 把 acquire 放进 repository enqueue；真实 [写链](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4270-L4276>) 包住 [acceptance 的 await 提交](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L2030-L2044>)，先前 acceptance 在 Domain 视图刷新前不会让 acquire 越过。新“父回复重新发布”是 R3-C3，不要求推翻这项修正。 |
| R2-C2 lazy 忙群无排空路径 | **部分接受，尚未完全关闭** | 整 W+只有 current 阻挡、事务内 retarget 消除了新增的 lazy 死锁，核心 pairing guard 可支持单次替换。但真实派发器先 claim 后 verify 会自堵（R3-C2），且 v19 已存在旧配对群必须由迁移处理（R3-C1）。不能只核对新建干净数据。 |
| R2-C3 默认 Q&A 在 retired M 隐身 | **部分接受，尚未完全关闭** | 新 v20 正常整 W 事务可让标记随行走，解决未来中间态；真实按 W reader 仍只看 active M，旧 v19 部分迁移数据没被 D13 收敛，所以原默认 Q&A 反例在升级后仍成立，见 R3-C1。 |
| R2-M1 真实释放能力、live 空闲与失败围栏 | **部分接受** | 不再 live apply/rollback，成功 drain 后按行冷恢复，是更小且合理的方案；turn 检查也已恢复。真实 drain 具有选择单 child 能力，但签名、no-op、部分失败语义及 drain→CAS 再发布窗口未被新 THEN 覆盖，见 R3-C3 / R3-M1。无需恢复旧 invalid/rollback 方案。 |
| R2-M2 staged 与 durable-first 冲突 | **accepted by reviewer** | D15 明确一次查找、active / 精确 not-created staged / preset veto 的顺序，修正了 [旧 combined lookup](<../../../packages/dsh-pet/src/host/locus/prepublication-staging.ts#L530-L546>) 的互斥假设；[agent/created](<../../../packages/dsh-pet/src/index.ts#L1314-L1318>) 已要求不能先 probe 再 compose。现存 recovery-debt 条件须另保留，见 R3-M2。 |
| R2-M3 默认键的歧义与碰撞 | **accepted by reviewer** | 默认位不再由 key 中的 M 决定；迁移按 `locusIds[0]`→原 endpoint→最新群行设置标记，多目标同 M 全清并列出。与真实 [指针 payload](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3765-L3777>) 相容；删除索引消除了旧键 canonicalization 冲突，而非猜一个键。 |
| R2-M4 六处矛盾 / THEN 前提 | **大部分 accepted by reviewer，少量残留须定点修正** | delta 的首图例外、`agentPreset` 取代 `toolFilter`、A/B 与 M 迁移分离、删除手动重建、管理面 rebind 可建 M/space、空闲 GIVEN 都已明确。核对 [首创实际参数](<../../../packages/dsh-pet/src/host/locus/child.ts#L898-L902>)、[首图双分支](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L2643-L2654>) 后接受方向；D16 总则首图结算句仍残留，新增 D17/queued/expiry 断言问题见 R3-M3，不把整项笼统标为已完成。 |

**未验证**：没有执行任何测试、构建、迁移、自检或真机操作；所有“必须验收”都是后续需要产生的证据，不是本轮已通过的结果。为遵守“只可写本报告”，未写入记忆卡片。

## Re-check of Required Changes (round 3)

**复核结论：Required Changes 1–6 均已落实于当前设计与 delta specs，`CHANGES_APPLIED: yes`；原唯一 `VERDICT: APPROVE_WITH_CHANGES` 行保持不变。** 本节关闭的是计划修订要求，不宣称 v20 已实施或其验收已执行；历史 Findings 与上一轮裁定保留作审计记录，以本节为本次复核结果。

已阅读 [第三轮作者答复](<review-round3.md#L111-L117>)，仅将其作为待核对的声明；以下均与当前 artifact 及真实源码交叉核验。

1. **通过（R3-C1）**：[D13 第 9 步](<design.md#L203>) 与 [迁移规格](<specs/pet-locus-collaboration/spec.md#L399-L407>) 明确先把同 W 的 retired 配对群归并到唯一 active M、按 reset 规则处理受影响行并披露上下文损失，再映射/去重默认标记；stopped 群行也计入全部清除候选。[验收场景](<specs/pet-locus-collaboration/spec.md#L442-L460>) 覆盖原 Q 可发现、外部建群 0 次、Q/G 投递无配对冲突与重启保持。真实 [旧迁移跳过入口](<../../../packages/dsh-pet/src/host/locus/controller.ts#L1816-L1826>)、[active-M reader](<../../../packages/dsh-pet/src/host/locus/controller-persistence-adapter.ts#L113-L117>) 和 [active 唯一 guard](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3018-L3030>) 与修订所针对的前提相符。另 [D7](<design.md#L102-L104>) 和 [运行期规格及无 active 场景](<specs/pet-locus-collaboration/spec.md#L1482-L1484>)、[全部 retired 配对场景](<specs/pet-locus-collaboration/spec.md#L1539-L1542>) 已明确整 W 收齐所有 active/retired 配对群、仅退休实际 active 配对（若有），不放宽唯一 guard。
2. **通过（R3-C2）**：[D7 派发顺序](<design.md#L112>) 明确 claim 前核验 M、必要迁移、重读新关联再 claim；[D17](<design.md#L233-L237>) 与 [事务规格](<specs/pet-locus-collaboration/spec.md#L186-L189>) 要求同一个 repository 写回调内读取最新行集合/投递表、逐行 CAS、复查 current 并 retarget。对照真实 [先 claim 后派发的接缝](<../../../packages/dsh-pet/src/host/channel/locus-controller.ts#L1158-L1199>) 与 [异步核验入口](<../../../packages/dsh-pet/src/host/locus/resolution.ts#L333-L359>)，新增 [无新 at 的故障矩阵](<specs/pet-locus-collaboration/spec.md#L1527-L1537>) 已覆盖 archived/missing/preset 错误及错误工作区，断言迁移先于 claim 且经新预留实际投递恰一次；[其它群 current 场景](<specs/pet-locus-collaboration/spec.md#L1549-L1552>) 保持 B 为 backlog。
3. **通过（R3-C3 / R3-M1）**：[D8](<design.md#L126-L136>)、[D15 第 0 步](<design.md#L209>) 与 [访问模式规格及场景](<specs/pet-locus-collaboration/spec.md#L14-L93>) 已把同一 `accessChanging` 门禁接到发布边界，明确 exact live parent + 单个 child、退出确认、turn 与 inbox 空闲，以及 drain reject 只保证行未改、runtime 可能已变。覆盖 absent target、stale parent、兄弟隔离、已释放但 reject、暂停 CAS 后经真实父回复 seam 冷恢复等断言。核对真实 [父回复](<../../../packages/dsh-pet/src/host/collab/locus-tools.ts#L252-L268>)、[Pet 精确释放用法](<../../../packages/dsh-pet/src/host/locus/child.ts#L1169-L1177>) 及 [turn-only 检查](<../../../packages/dsh-pet/src/index.ts#L1038-L1054>)；安装依赖的 [drainChildren] (node_modules/@deepseek-ai/dsh-subagent/lib/types/manager.js#L289-L307)、[释放后才抛错] (node_modules/@deepseek-ai/dsh-subagent/lib/types/manager.js#L1030-L1058) 和 [父回复冷恢复] (node_modules/@deepseek-ai/dsh-subagent/lib/types/manager.js#L1111-L1123) 与修订保证一致。未新增持久 access 操作、live 回滚或 invalid 分支。
4. **通过（R3-M2）**：[D15](<design.md#L207-L215>) 保留单次 ordered lookup，并把恢复债 veto 置于 active/staged 路径之前，正常 live publication 明确不算遗留债；[场景](<specs/pet-locus-collaboration/spec.md#L299-L317>) 保留正常首创与首图轮换各 claim 一次，并覆盖 active + needs-recovery 同 session 的冷恢复/父回复拒绝。与现存 [durable veto](<../../../packages/dsh-pet/src/index.ts#L1007-L1018>)、[恢复债谓词](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3216-L3220>) 及 [一次性 staging 约束](<../../../packages/dsh-pet/src/host/locus/prepublication-staging.ts#L523-L546>) 相符，没有把正常 live publishing 误列为阻断债。
5. **通过（R3-M3.1–2）**：[D17](<design.md#L230-L236>) 和 [resetChat 规格与旧围栏场景](<specs/pet-locus-collaboration/spec.md#L181-L216>) 明确包含 stopped 根的所有受影响行 revision +1、accessMode 重置，但 stopped 不复活；[D16](<design.md#L221-L224>) 及 D17 对首创身份轮换明确另行保留 accessMode/state，并加预 prompt 首图不结算例外。与真实 [轮换/首图双分支](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L2626-L2654>)、[首图规格](<specs/pet-locus-collaboration/spec.md#L1217-L1224>)、[full 创建失败保留模式](<specs/pet-locus-collaboration/spec.md#L1278-L1281>) 一致；[文档评论 delta](<specs/pet-locus-doc-comments/spec.md#L157-L179>) 同步 stopped 评论 read-only/revision +1，无本项引入的入口类型矛盾。
6. **通过（R3-M3.3–4）**：[D7](<design.md#L103-L113>)、[D17](<design.md#L233-L234>) 与 [规格](<specs/pet-locus-collaboration/spec.md#L186-L187>) 已用真实 accepted/backlog 且无 execution/inbox/turn 证明定义未注入；queued/running/finishing 计为 current、阻挡迁移/改绑且不得改指。[重置夹具](<specs/pet-locus-collaboration/spec.md#L193-L211>)、[改绑夹具](<specs/pet-locus-collaboration/spec.md#L253-L256>) 与 [迁移/静默过期场景](<specs/pet-locus-collaboration/spec.md#L1544-L1562>) 已落实该形状及仅在下一次派发/入站/启动恢复检查硬上限、不保证到点回执。与真实 [acceptance](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L2016-L2023>)、[queued schema](<../../../packages/dsh-pet/src/host/spec.ts#L789-L799>)、[current-only timer](<../../../packages/dsh-pet/src/host/locus/expiry-scheduler.ts#L104-L106>) 和 [claim 时过期](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L2145-L2168>) 相符，不需要新增 backlog 定时器。

**实际执行的校验**：在仓库根执行 `openspec validate pet-locus-isomorphic-entries --strict`，输出 `Change 'pet-locus-isomorphic-entries' is valid`，退出码 **0**。

**边界**：只复核 Required Changes 1–6 及其修订是否引入矛盾，未扩展新 findings。仅修改本报告；未运行测试、构建、迁移或真机验收，未打开/复制/访问 live DB，未写记忆库。上面的验收场景是后续实施要求，不是已执行证据。
