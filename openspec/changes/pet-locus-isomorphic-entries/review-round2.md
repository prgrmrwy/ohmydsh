## Review Metadata

- **Review round**: 2
- **Prior round**: round 1 REVISE (6 critical, 4 moderate)
- **Reviewer context**: cross-model codex gpt-6.1-sol, fresh context, read-only
- **Tool restrictions**: 唯一写入为完整替换本报告；未运行测试、构建、迁移、部署或重启；未打开、复制或操作线上状态库；未修改实现、其它 artifact 或记忆库。
- **Artifacts reviewed**: [proposal](<proposal.md>)、[design D1–D16](<design.md>)、[collaboration delta](<specs/pet-locus-collaboration/spec.md>)、[doc-comments delta](<specs/pet-locus-doc-comments/spec.md>)、[Round 1 及作者答复](<review-round1.md>)；两份 current spec、[manifest](<../../../dsh.yaml#L173-L197>)、[ADR-0009](<../../../packages/dsh-pet/docs/adr/ADR-0009-locus-three-tier-structure.md>)、[集成陷阱](<../../../docs/architecture/dsh-plugin-integration-pitfalls.md#L535-L614>)；下述 controller、persistence、storage transaction、resolution、composition、first-delivery、channel、tools、management、迁移与部署源码及测试夹具。另静态读取仓库安装依赖的 AgentHandle / subagent drain 实现核对释放能力。未发现 openspec/project.md；本 change 尚无 tasks/test-plan。

本轮评审的是**计划**，不是声称 v20 已经实现。负载假设是一个独占 Pet 库的 Host、一个长驻 repository/controller、多个异步请求交错。接受同群同 M、跨 W `/bind` 拒绝、原 W 归档后管理面改绑、单值 accessMode、单行入口及 v20 break-change；不要求恢复 prepared、审计重键、locus-id 索引、重建说明或批量 M 迁移。以下反例都来自真实调用链，不以“更稳妥”代替证据。

**时效**：本结论只适用于本轮读到的 artifact；除落实本报告 Required Changes 外，后续修改 proposal/design/specs 将使结论失效。

## Findings

### 🔴 Critical (blocking)

#### R2-C1 — 两段同步代码不等于同一个准入临界区：acceptance 已经在途、但尚不可见

- **计划证据**：[D8:128–133](<design.md#L128-L133>)、[访问模式:14–19](<specs/pet-locus-collaboration/spec.md#L14-L19>) 以“事件循环串行”证明空闲检查加 Set 与 `acceptDelivery` 没有交错；[场景:71–75](<specs/pet-locus-collaboration/spec.md#L71-L75>) 只覆盖加入 Set 以后到达和已经写完的两个端点。
- **真实源码**：`acceptDelivery` 在 repository.enqueue 内检查并构造投递（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L1956-L1984`），随后 await 持久提交（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L2030-L2044`）；enqueue:4270–4276（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L4270-L4276`） 只串行 repository 写操作，不会串行外部同步读取加 Set。事务还经过 [Promise 链调度](<../../../packages/dsh-pet/src/host/storage/atomic-domain.ts#L249-L279>)，并且 [applyBatch 完成后才逐行刷新 Domain 内存视图](<../../../packages/dsh-pet/src/host/storage/atomic-domain.ts#L214-L232>)。
- **可复现交错**：A 已通过 Set 检查，进入持久提交 await；投递尚未出现在 `hasPendingDeliveries` 的内存读取中。此时 access 检查“空闲”并加入 Set、开始改 live sandbox/tools。A 的提交随后完成；它不会因为之后加入 Set 而自动撤销。已经接受的工作与 live 权限变更重叠。只把 Set 检查放在 `acceptDelivery` 顶部，或者紧挨 await 前，都不能封住这个窗口；提交后的 locus CAS 也撤不回已经应用的 live 权限。
- **最小修订**：仍只用进程内 Set，但让“复查空闲 + 加入 Set + 捕获最初围栏”的 acquire **作为同一 repository 写队列中的一个短操作执行**，排在先前 acceptance 完成之后；后续 acceptance 在自己的队列回调内查同一个 Set。不要跨整个外部应用持有 repository 队列，以免最终 CAS 自锁。stop/rebind/rebuild/migrate 的提交也在相同序列内检查该 Set。
- **必须验收**：人为暂停 A 的持久写，在 A 通过 Set 检查但尚未刷新投递表时发起 access；access 必须等 A 完成后以忙拒绝，不能调用 live apply。反向 acquire 先胜时 acceptance 不落库。无需任何持久 access operation。

#### R2-C2 — retired 配对能存下来，但未迁忙群没有排空路径；“照常排队”会把迁移条件越锁越死

- **计划证据**：[D7:111–117](<design.md#L111-L117>)、[delta:1389–1394](<specs/pet-locus-collaboration/spec.md#L1389-L1394>) 规定先退休 M0 配对、忙群继续引用它，新的 at 照常排队，只有**没有任何未终态投递**时才迁移。[重启场景](<specs/pet-locus-collaboration/spec.md#L1426-L1439>) 只断言行与 active 数，不断言 current/backlog 能继续。
- **真实源码分层核对**：持久集合校验只要求有配对，**确实允许 retired**，见 validator:4743–4767（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L4743-L4767`）；因此不再报告 Round 1 的“双 active”错误。但 [resolution:309–345](<../../../packages/dsh-pet/src/host/locus/resolution.ts#L309-L345>) 把 retired 配对直接视为 M 不可用；[ensureForDelivery](<../../../packages/dsh-pet/src/host/locus/resolution.ts#L351-L398>) 走修复，而不是返回旧 child。current 完成后 [dispatchNextActive:1084–1107](<../../../packages/dsh-pet/src/host/channel/locus-controller.ts#L1084-L1107>) 又先经过同一 resolver。旧 M 本身的冷发布也被 [index:1320–1324](<../../../packages/dsh-pet/src/index.ts#L1320-L1324>) 拒绝。即使 child 仍能凭旧行完成当前请求，下一条 backlog 也不因此变得可投递。
- **具体失败**：W 的 G1 空闲、G2 有 current A 与 backlog B。G1 迁 M1 并退休 M0。A 的 caller-bound finish 可以结算（[context 授权只核当前行与 Delivery](<../../../packages/dsh-pet/src/host/locus/context-repository.ts#L198-L225>)），但 B 晋升前 resolver 拒绝 retired M0；G2 又因 B 未终态不能迁。按计划继续接受 C 只增加阻塞。M0 若被删除、归档或 preset 漂移，简单允许 retired 也不能证明官方旧父恢复与组合可用；等待 backlog 的 24 小时上限，不等于“照常排队并服务”。
- **另一个真实受影响入口**：[关闭准备:3748–3774](<../../../packages/dsh-pet/src/index.ts#L3748-L3774>) 把“retired 配对下仍有 live child”当归属冲突，合法的惰性迁移中间态会使 prepare-stop 失败。不能只改建树 controller。
- **Required**：明确未迁群的执行与排空协议：旧 current 如何凭原身份完成/失败/到期，未注入 backlog 怎样保留并最终服务或确定性终结，期间的新消息是否仍接受，以及何时允许整群原子迁移。若选择继续旧父服务，必须明确 retired 配对与真的不可用 M 的区别，并贯通 resolution、composition、queue、启动恢复与 stop drain；若旧父不能服务，需定义不依赖它排空的有限收敛路径。不要求批量调度或第三种持久 main 状态，但不能同时要求“旧父不可运行”“所有 pending 都挡迁移”“新消息照常排队”。
- **必须验收**：G1 已迁、G2 的 A 正在运行且 B 未注入；A 成功、A 到期、期间重启、旧 M 真正缺失四类分支。断言 B 的实际终态/交接、没有误重播 A、G2 最终可迁、prepare-stop 可处理该合法中间态，而不只检查库中一条 active。

#### R2-C3 — 惰性迁移把 W 的默认 Q&A 暂时藏在 retired M 下，真实打开路径会创建第二个群

- **计划证据**：[D7:114–115](<design.md#L114-L115>) 与 [delta:1392–1393](<specs/pet-locus-collaboration/spec.md#L1392-L1393>) 只在**默认群本身**迁移时转默认位；[默认位定义](<specs/pet-locus-collaboration/spec.md#L273-L273>) 仍按 M 存储。
- **真实源码与反例**：W 在 M0 下有普通群 G1 与默认 Q&A 群 Q。G1 先迁 M1，Q 尚未迁（可以是空闲但还没收到 at，也可以忙）。findDefaultQa:113–117（已删除：`../../../packages/dsh-pet/src/host/locus/controller-persistence-adapter.ts#L113-L117`） **只找 W 的 active M**，所以看不到仍在 M0 的默认位；[createOrOpenDefaultQa:817–863](<../../../packages/dsh-pet/src/host/locus/controller.ts#L817-L863>) 把它当未建立，创建新的外部群 Q2 并占用 M1 的默认位。后来 Q 迁移，计划又要求把 M0 的默认位转到 M1，没有定义覆盖 Q2 还是拒绝。即使 R2-C2 的投递排空修好，这个无在途投递的反例仍成立。
- **最小修订**：保留现有 M→默认指针形状即可，但按 W 查默认时须能发现尚未迁移的旧配对上的既有默认，返回该入口或可行动的不可用结果，MUST NOT 当作“从未创建”调用外部建群。定义 M1 已有默认与旧指针并存时的确定规则，以及 M0→M1→M2 链上如何唯一发现。
- **必须验收**：非默认 G1 首先迁移、默认 Q 留在 retired M0；从 Pet 轮盘打开 W 默认 Q&A，外部建群为 0；Q 后迁移与期间重启后仍为同一个默认群。再覆盖显式冲突库，不能静默覆盖任一默认位。

### 🟡 Moderate

#### R2-M1 — dispose 回滚方向可行，但要点名真正的释放能力，并保留 live 空闲证明与失败围栏

- **接受的部分**：成功释放运行体、保留 durable session，下次按旧行冷恢复，比再造 pending/回滚协议更小。真实 child drain 已可复用，见 [compensateChild:1148–1189](<../../../packages/dsh-pet/src/host/locus/child.ts#L1148-L1189>)；失败后置 invalid 可以封住后续正常 Delivery，不需要恢复 prepared。
- **遗漏的真实接缝**：[D8:129–130](<design.md#L129-L130>)、[delta:14–16、46–54](<specs/pet-locus-collaboration/spec.md#L14-L16>) 只以“无未终态 Delivery”定义空闲，删除了现有 session.isIdle 检查（已删除：`../../../packages/dsh-pet/src/host/locus/permission-mutation.ts#L299-L301`） 与 tool-tier live.isIdle 检查（已删除：`../../../packages/dsh-pet/src/host/locus/tool-tier-mutation.ts#L202-L206`） 的保证；实际 [live 检查器](<../../../packages/dsh-pet/src/index.ts#L1034-L1054>) 特意覆盖没有 Delivery 的 GUI/inquiry turn。此时切换可能在该 turn 执行中改变 sandbox/tools，失败释放还会中断该 turn。
- **不能把同名函数当能力**：[adapter.dispose:1207–1216](<../../../packages/dsh-pet/src/host/locus/child.ts#L1207-L1216>) 只撤监听，明确**不释放 child**；`ctx.agents.get` 返回裸 Agent 而非持有 disposer 的 handle，见仓库依赖 [AgentHandle 契约:130–145] (../../../node_modules/@deepseek-ai/dsh-agent/lib/types/index.d.ts#L130-L145)。只断言“dispose 调用 1 次”会让错误实现也通过。
- **最小修订与断言**：变更前还要证明 live agent 无打开 turn/待处理输入；使用现有 exact-parent `drainChildren`/真实 owner disposer，不是 adapter.dispose。验收释放后 registry 不再有旧 live agent，下一次确实触发 cold composition 且历史保留。若释放失败，先保持 `accessChanging`，用捕获的 session/revision 失效当前行；只有失效持久化成功或已证明不再有可执行 live authority 才解禁。补“释放失败且 invalid 写入也失败”分支，不能在仍为 active/read 标签时无条件解锁。

#### R2-M2 — D15 的负面识别应接在一次组合 lookup 后；新索引会让所有 staged 首创撞上 durable-first 检查

- **计划**：[D12/D15](<design.md#L176-L177>)、[退役 child 场景](<specs/pet-locus-collaboration/spec.md#L235-L261>) 的 preset 身份 veto 是足够小的方向，可关闭 Round 1 C5 的架构缺口，不必恢复历史表。
- **真实整合陷阱**：v20 的 `child-locus` 给**所有行**的 `sessionId` 建索引，首次创建前 `not-created` 已占 C0。现在 [combined lookup](<../../../packages/dsh-pet/src/host/locus/prepublication-staging.ts#L530-L546>) 先调 durable；[durable lookup](<../../../packages/dsh-pet/src/index.ts#L1007-L1018>) 对找到的非 active 行直接抛错。若照新索引扩展 durable 反查，staged C0 既有 not-created 行又有 reservation，根本到不了 staged claim（或触发 durable-stage-conflict）。首图轮换 C1 后同样如此。另多查一次 `find` 来决定 D15 是否放行，会消耗 one-shot claim，现有 [agent/created 注释](<../../../packages/dsh-pet/src/index.ts#L1314-L1318>) 已明确警告。
- **最小修订**：写明顺序与互斥：当前 active durable 身份正常组合；精确匹配当前 not-created 行 session/M/revision 的 staged reservation 走一次 claim；not-created 但无 staged 的手动打开、invalid/stopped 及无当前行的 locus-child 都拒绝；普通会话不受影响。D15 不能仅判断“索引里有行”就放行。验收首创、首图轮换后的首创各实际通过一次 `agent/created`，且旧 C0 冷恢复被拒；这比单独测 veto 更关键。

#### R2-M3 — 默认位输入形状已纠正，但“截断键或反过来”仍没有唯一映射和碰撞规则

- **计划**：[D13:200–203](<design.md#L200-L203>)、[迁移场景:380–383](<specs/pet-locus-collaboration/spec.md#L380-L383>) 说从物理键或 value.key 取可解析到 main 的那个键；未定义两者都能解析且不同、或两个物理行被规范化到同一个默认键的结果。
- **真实边界**：collectIndexes:3735–3757（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L3735-L3757`） 现有兼容只允许**物理键是 value.key 的前缀**这一单向形状；default reader:1094–1105（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L1094-L1105`） 不把 main 存在本身当作指针正确证明。若 `M` 与 `M-long` 都存在，两个候选都可解析；任意择一/Map 最后写入会改掉默认归属或丢指针。Round 1 C1 已要求键冲突规则，作者答复未补此项。
- **最小修订**：限制为源码支持、可证明的单向前缀兼容，或明确更宽修复的唯一判据；不一致及规范化碰撞无法唯一证明时预检拒绝并列出原键，不能猜。补两个都有效的 M、两个源键归一到同一目标键的 fixture。仍保持普通悬空/话题/M 不一致指针“列出后清除”的已定策略。

#### R2-M4 — 仍有数处文字互斥或 THEN 缺前提，不能原样生成可靠验收

以下均可局部改文案，不需要新机制：

1. **首图例外**：[D16:220–221](<design.md#L220-L221>) 与 [首创总则:1124](<specs/pet-locus-collaboration/spec.md#L1124-L1124>) 把首图降级列入“失败 Delivery 保留旧关联并结算”；但 [1126–1136](<specs/pet-locus-collaboration/spec.md#L1126-L1136>) 要同一 Delivery 保持 current、换 session 纯文本重试。真实 rollback:2643–2654（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L2643-L2654`） 明确是两个分支。总则必须加“预 prompt 图像拒绝除外”，且该 Delivery 的 session 也跟随新预留，不能同时要求结算旧关联。
2. **不存在的 runtime 参数**：[首创:1124](<specs/pet-locus-collaboration/spec.md#L1124-L1124>) 仍要求传 `toolFilter`；[出站:1205](<specs/pet-locus-collaboration/spec.md#L1205-L1205>) 又说 runtime 不再携带它。真实 [child.ts:898–902](<../../../packages/dsh-pet/src/host/locus/child.ts#L898-L902>) 已说明它被忽略，靠持久独立 preset。前者改成 `agentPreset: locus-child`。
3. **冷组合失败分类仍过宽**：[1231–1237、1252–1255](<specs/pet-locus-collaboration/spec.md#L1231-L1255>) 对组合缺失、父 preset 错等笼统要求“冷恢复行不改写”，与 [1383–1389](<specs/pet-locus-collaboration/spec.md#L1383-L1389>) 的 child 身份损坏置 invalid、M preset 失败迁移仍重叠。直接引用三类错误判定，并区分 child policy 拒绝与 M 不可用；不能让相同注入故障同时断言 unchanged 与 rebuild/migrate。
4. **已删除的人工恢复动作仍出现在 THEN**：[1093–1095](<specs/pet-locus-collaboration/spec.md#L1093-L1095>) 要所有者“显式重建该 child”，但 [507、1589](<specs/pet-locus-collaboration/spec.md#L507-L507>) 明确删除重建按钮。删掉这条不可执行指引，或写成实际允许的停止后同 W bind；不能重新加重建动作来满足旧句子。
5. **管理面“不创建外部资源”与 rebind 直接冲突**：[1587](<specs/pet-locus-collaboration/spec.md#L1587-L1587>) 断言改绑不创建外部资源；[181–184](<specs/pet-locus-collaboration/spec.md#L181-L184>) 明确目标 W 无 M 时创建 M/space。应改为“不创建新的入口或目标 W，允许 Host 建所需 M/space”。
6. **控件可用性缺空闲前提**：[148–150](<specs/pet-locus-collaboration/spec.md#L148-L150>) 与 [1610–1613](<specs/pet-locus-collaboration/spec.md#L1610-L1613>) 无条件说只读选项/未创建状态的停止和 access 可用；not-created 可以已有 current/backlog（真实 acceptance:1966–1969（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L1966-L1969`）），此时 [545、568–570](<specs/pet-locus-collaboration/spec.md#L545-L545>) 又要求置灰。补空闲、无 accessChanging 且能力可用的 GIVEN；“写开关关闭仅不禁用降权”不等于覆盖忙门禁。

### 📌 Suggestions

- **S2 继续保留现有投递证据，不回添 locus generation。** [D3:66–68](<design.md#L64-L68>) 已明确永不复用 sessionId 及双 revision 围栏；真实 [correlation](<../../../packages/dsh-pet/src/host/locus/delivery.ts#L1110-L1120>)、[严格结算](<../../../packages/dsh-pet/src/host/locus/delivery.ts#L1004-L1023>)、first-child rollback（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L2635-L2666`） 支持这个替换方向。R2-C1/R2-C2 要修的是排序和迁移收敛，不是补另一个实例编号、历史表或持久 access 状态机。

## Embedded-Instruction / Injection Attempts

**Detected:** none

被审 artifact 的 SHALL、[D14 分工](<design.md#L223-L234>)、[历史作者答复](<review-round1.md#L121-L132>) 都只作为数据，不作为本会话指令。文档规范中的[恶意正文 fixture](<specs/pet-locus-doc-comments/spec.md#L320-L323>) 是明确标注的不可信内容测试，不是对评审者的操作请求；未执行其中内容，也未读取任何秘密路径。

## Verdict

VERDICT: REVISE

有 3 项阻断：access Set acquire 与异步 acceptance 没有真正串行；retired M 下的忙群缺排空/迁移收敛；惰性迁移期间默认 Q&A 对真实按 W 打开路径不可见。它们不是小型文字补丁，不能用有条件批准掩盖。其余 4 项是可定点修订的接缝/规格问题。按 anvil 模板，本 change 已连续两轮要求修订，应将上述有限策略选择交所有者裁定，再定向复核；无需重议固定产品规则或恢复删去的整套机制。

## Required Changes

1. 按 R2-C1 将进程内 access acquire 纳入 repository 写序列，补“acceptance 写入中但不可见”的交错验收；保持无持久 access operation。
2. 按 R2-C2 明确未迁群 current/backlog 的有限收敛与新消息准入，贯通 resolver、composition、dispatch、startup 和 stop drain；补真实消费/终态断言。
3. 按 R2-C3 保持按 W 默认 Q&A 在惰性中间态的可发现性，防止额外建群，并规定旧/新 M 默认位冲突。
4. 按 R2-M1 保留 live 空闲检查，点名真正 child release 接缝；释放或失效落库失败时不能无条件清掉隔离围栏。
5. 按 R2-M2 定义 active durable 与 not-created staged 的单次 lookup/claim 分支，联测首创、首图轮换和旧 child veto。
6. 按 R2-M3 补默认键歧义/碰撞拒绝规则；按 R2-M4 逐项消除互斥总则、失效指引和缺前提的 THEN，再据此生成 test-plan/tasks。

CHANGES_APPLIED: n/a

## Rebuttals

本节逐项裁决作者的 [Round 1 回复](<review-round1.md#L121-L132>)；“接受”仅指**修订计划足以回应原发现**，不代表实现或测试已通过。

| Round 1 | 裁决 | 独立源码核对与理由 |
|---|---|---|
| C1 默认位形状 | **部分接受；仍需 R2-M3，运行期另见 R2-C3** | [schema:683–687](<../../../packages/dsh-pet/src/host/spec.ts#L683-L687>)、reader:1094–1105（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L1094-L1105`）、[fixture:66–69](<../../../packages/dsh-pet/test/migrate-cli.test.ts#L66-L69>) 都证明目标在 locusIds[0]，不是 value.key。新 D13 已正确从旧 id 经 endpoint 映射最新群行，并列出清除原因；键歧义/冲突仍未定。 |
| C2 单 active M | **部分接受；双 active 已解决，R2-C2/C3 未解决** | active 查询（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L2953-L2964`） 与 旧 commit 的退休检查（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L3010-L3042`） 支持“发布新配对时退休旧配对”；validator（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L4743-L4767`） 不要求引用 active。但 resolution/dispatch/default reader 还不能消费新的合法中间态，不能仅凭一条 active 关闭原生命周期问题。 |
| C3 access 完整围栏 | **未接受为已解决；见 R2-C1/M1** | 删除 prepared 是可接受减法，崩溃按单值行冷恢复也合理；真实 enqueue（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L4270-L4276`） 和 [await 提交](<../../../packages/dsh-pet/src/host/storage/atomic-domain.ts#L214-L225>) 否定“两段同步即无交错”的证明。dispose 应走真实释放，且不能删 live idle 保证。 |
| C4 首创失败轮换 | **接受修复方向；首图例外按 R2-M4.1 补清** | failFirstDeliveryCreation/revert（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L2594-L2666`） 确实轮换预留、改指未注入 backlog、保留旧执行；D16 与新增失败场景已承接，不需要回添 generation。普通失败和一次性图像重试必须分开写。 |
| C5 旧 child 负面识别 | **接受修复方向；落点按 R2-M2 补清** | [原 lookup](<../../../packages/dsh-pet/src/index.ts#L1007-L1018>) 零匹配会落到 [composed:false](<../../../packages/dsh-pet/src/host/locus/composition.ts#L354-L367>)；持久 preset veto 足以补无归属 child 边界。但当前 not-created 与 staged 同时存在，不能照搬旧 durable-first。 |
| C6 双缺省 session id | **accepted by reviewer** | [v19 schema](<../../../packages/dsh-pet/src/host/spec.ts#L590-L602>) 与 [stopped/invalid 夹具](<../../../packages/dsh-pet/test/migrate-cli.test.ts#L366-L378>) 证明源行合法。新 [D13:195](<design.md#L195-L195>)、[场景:355–358](<specs/pet-locus-collaboration/spec.md#L355-L358>) 已给出新预留与状态/时间保留规则。 |
| M1 默认位/审计 | **部分接受** | rebind 清原默认且不占新默认已明确；审计冻结与不再写入可接受，故不再要求重键。旧默认 reader（已删除：`../../../packages/dsh-pet/src/host/locus/controller-persistence-adapter.ts#L113-L117`） 却使 lazy 中间态的新问题 R2-C3 独立成立。 |
| M2 三类矛盾 | **大部分接受；仍有 R2-M4.3** | [文档场景 W0/M0](<specs/pet-locus-doc-comments/spec.md#L36-L39>) 已分开；[v19 marker](<../../../packages/dsh-pet/src/host/spec.ts#L598-L602>) 与新 [version-mismatch 场景](<specs/pet-locus-collaboration/spec.md#L1239-L1242>) 一致；D7 三类方向清楚，但出站 requirement 的笼统 unchanged 场景没有同步限定。 |
| M3 关闭开关仍可降权 | **accepted by reviewer** | [新 D8:135](<design.md#L135-L135>)、[delta:97–105、128](<specs/pet-locus-collaboration/spec.md#L97-L105>) 已允许 full→read；真实旧 pending/fallback（已删除：`../../../packages/dsh-pet/src/host/locus/permission-mutation.ts#L263-L296`） 正是此次要删除的语义。只需按 R2-M4.6 保留其它门禁，不再要求禁整个控件。 |
| M4 并发/停止 | **accepted by reviewer（原发现）；新增交错见 R2-C1/C2** | [真实群/话题锁](<../../../packages/dsh-pet/src/host/locus/controller.ts#L726-L734>)、[main lease](<../../../packages/dsh-pet/src/host/locus/controller.ts#L1945-L1955>)、stop pending guard（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L1197-L1203`） 均核对。新 D4 与 [1344–1372](<specs/pet-locus-collaboration/spec.md#L1344-L1372>) 覆盖并发胜出顺序、ownership 补偿、finalize；停止恢复为忙拒绝，不再有未定义的忙时取消。 |
| S1 迁移/部署复用 | **accepted by reviewer** | [迁移原预检和锁内复查](<../../../packages/dsh-pet/scripts/migrate-state-version.mjs#L311-L397>)、[部署副本检查器](<../../../scripts/lib/deploy-checks.mjs#L21-L54>) 均存在。新 D13 明分旧形状分析与最终 v20 validator，新增 self-check 导入全部模块场景，不需要另建部署框架。 |
| S2 身份替换边界 | **accepted by reviewer** | [D3](<design.md#L64-L68>) 保留 deliveryId/executionId/inbox/turn/来源和双 revision，符合真实 [严格结算](<../../../packages/dsh-pet/src/host/locus/delivery.ts#L1004-L1023>) 与 [冷读中断证明](<../../../packages/dsh-pet/src/host/locus/startup-recovery.ts#L240-L265>)。去 locus generation 本身不是阻断点。 |

（作者 2026-11-06 回应，供第 3 轮核对；同时采纳所有者要求的第二次 ponytail-review #1–#9，#10 删除 invalid 状态未采纳，所有者要求保留）
- R2-C1：acquireAccessChange 放进仓储写队列（enqueue）内执行，复查投递并加入集合；acceptDelivery/stop/rebind/migrate/重建都在队列内检查集合（D8）。不恢复 prepared。
- R2-C2：M 不可用改为整 W 一次迁移：任一群有 current 则不迁、backlog 不阻挡；永远新建 M1；一个事务内旧配对 retired + 全部群 resetChat，逐行 CAS 并复查 current（D7、D17）。不存在群引用已退休配对的中间态，也没有复用 M1 分支。
- R2-C3：default-qa 持久索引删除，改为群行 defaultQa 标记，每个 M 至多一个；全部索引可推导；迁移按 locusIds[0]→同入口最新群行置位（D2、D12、D13.4）。
- R2-M1：访问变更改为释放常驻子会话（drainChildren，非 adapter.dispose）后 CAS 行，下一次组装核验；删除 live 应用、回滚、置 invalid 分支；保留 turn 边界空闲检查；不空闲或 drain 失败为 LOCUS_BUSY（D8）。
- R2-M2：D15 改为一次查找、按顺序判定，含 staged 精确 claim；现有 durable lookup 对非 active 行抛错须改。
- R2-M3：随 default-qa 索引删除而不复存在。
- R2-M4：组合失败合并为两类；首图结算例外、toolFilter→agentPreset、删除手动重建指引、管理面措辞与可用性前提、旧退役隔离句均已修正。
