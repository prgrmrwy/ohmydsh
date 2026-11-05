## Review Metadata

- **Review round**: 2
- **Prior round**: round 1 REVISE (5 critical, 4 moderate)
- **Reviewer context**: cross-model codex gpt-6.1-sol, fresh context, read-only
- **Tool restrictions**: 只读静态审查，唯一授权写入是完整替换本报告。未运行测试、构建或迁移；未打开、复制或查询线上数据库；未部署或重启。下述反例是源码推演，不是已执行的复现。
- **Artifacts reviewed**: [proposal](<proposal.md>)、[design](<design.md>)、[delta spec](<specs/pet-locus-collaboration/spec.md>)、[round-1 与作者回应](<review-round1.md>)、[current spec](<../../specs/pet-locus-collaboration/spec.md>)、[manifest](<../../../dsh.yaml#L172-L197>)、[ADR-0009](<../../../packages/dsh-pet/docs/adr/ADR-0009-locus-three-tier-structure.md>)；指定迁移脚本、Host 初始化/lifecycle/guidance/schema、Locus persistence/delivery、D7 所列 L1/L2 文件及 ledger/inquiry 读取链，相关迁移、持久化、三层实体、Host wiring、补偿、旧模型、权限及 UI fixture 测试源码。另核对本仓依赖中的 storage-domain 打开路径与官方 subagent 的只读子会话发现实现。

本变更要离线删除两层 Locus 历史，再移除运行期旧模型分支。所有者已接受删除旧停止标记；本轮不推翻这个选择，不扩大到 L1、台账、询问或会话历史清理。评审对象是规划而非尚未提交的实现。

**简化方向总体合理**：数据库备份足以代替 JSON archive；索引可继续由 Host 重推导；配对检查可只放在启动，不需要把 staged main 视图塞进所有写入口；全库拒绝未终结工作也是有效的保守策略。但“完整保留集校验”尚未真正写完整，且有正常三层状态被误拒。其余问题可以通过精确的契约、启动顺序和 fixture 更新解决，不需要增加离线补偿器、第二套索引维护或运行期跨表 guard。

本结论只适用于本轮读取的 artifact 内容；之后除落实本报告所列修改以外的变更应重新评审。两轮连续要求修订，按 anvil 约定应交所有者裁决后再进入下一步。

## Findings

### 🔴 Critical (blocking)

#### R2-C1 / R1-C3：四项检查仍不等于完整保留集合校验，交错删除会盖上无法启动的 v19 戳

- **证据**：[design:84–90](<design.md#L84-L90>) 与 [delta:205–208](<specs/pet-locus-collaboration/spec.md#L205-L208>) 把 v19 放行条件列为配对、marker、active、`parentLocusId`；没有明确要求保留集合通过现有全部 `assertLocusSet` 不变量。[persistence:4735–4741](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4735-L4741>) 仍要求同 endpoint 的剩余相邻 generation 连续，启动在 [3317–3322](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3317-L3322>) 即调用它；[D7](<design.md#L120-L131>) 没有计划删除这项约束。
- **具体反例**：同一群入口的 g1 是有配对、带 `tier3` 的 `invalid` 行，g2 是无配对的旧 `invalid` 行，g3 是有配对的 `not-created` 行；全部只读、非 busy，没有非终态工作或 topic 引用。迁移前集合的 generation 为 1/2/3，符合当前 schema 和集合约束。按 D1 删除 g2 后，g1/g3 通过 D3 的四项检查，却在启动以“generations … must advance contiguously”失败。数据库已升 19，重复脚本又会 no-op。
- **最小修正**：明确 D3 在提交前验证完整候选集合，包括现有 `normalizeRecord`/`assertLocusSet` 的全部适用不变量（不是只验证新增四条）。对上述 gap 拒绝并列出入口/行；保留合法历史前缀删除，不重编号、不重写保留行、不更改 runtime 路由语义。新增 1/2/3 交错删除拒绝场景，并让它与现有“删除历史前代后仍可重建”的成功场景共同约束校验器。
- **不修后果**：仍违反“脚本放行就意味着 Host 能打开”的核心安全承诺。作者对 R1-C3 的回应只能部分接受。

### 🟡 Moderate

#### R2-M2：D3 将“没有 child 的三层历史”误判为非法 marker，正常停止/换 M 后就可能迁不了

- **证据**：[D3:85–88](<design.md#L85-L88>) 与 [delta:208](<specs/pet-locus-collaboration/spec.md#L208>) 只允许 `not-created` 无 marker；但 [D6:114](<design.md#L114>) 和 [v19 requirement:275](<specs/pet-locus-collaboration/spec.md#L273-L275>) 实际只要求“marker 若存在则为 tier3；active 必须带 marker”。现行首建生成无 marker 的 `not-created`（[controller:2167–2181](<../../../packages/dsh-pet/src/host/locus/controller.ts#L2167-L2181>)）；其合法迁移包括 `stopped/invalid/retired`（[aggregate:586–617](<../../../packages/dsh-pet/src/host/locus/aggregate.ts#L586-L617>)），这些迁移保留原 marker 缺失，不制造虚假 child 证明。
- **具体反例**：所有者先 `/bind` 一个入口，尚未发送第一条业务消息就停止它。[index:2301–2306](<../../../packages/dsh-pet/src/index.ts#L2301-L2306>) 经 [persistence:1201–1207](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L1201-L1207>) 产生有配对、没有 child/marker 的 `stopped` 行。另一个常见形状是换 M 时把尚未创建 child 的旧代转成 `invalid`（[persistence:3101–3105](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3101-L3105>)）。这些都是正常三层历史，不属于 L；v19 requirement 允许，却被 D3 永久拒绝。等待空闲或重复脚本不会改变它们。
- **最小修正**：让迁移与 v19 schema 使用同一 marker 规则，允许没有真实 child attestation 的非 active 历史保留缺失 marker，并继续验证其它既有形状约束。同步修正“not-created 代际尚无标记”不完整的概括；不得补写 `tier3` 伪造历史证明。补充“首条消息前停止”和“未创建 child 就换 M”的保留/打开场景。

#### R2-M3：D2 的“首次重建前没有任何索引读取方”漏掉已注册的 agent 回调

- **证据**：业务 intake 的确在 [index:2766–2793](<../../../packages/dsh-pet/src/index.ts#L2766-L2793>) 的恢复成功后才继续构建，但 `agent/created` 早在 [1302–1304](<../../../packages/dsh-pet/src/index.ts#L1302-L1304>) 注册。该回调在 [1363–1380](<../../../packages/dsh-pet/src/index.ts#L1363-L1380>) 处理冷恢复的 pending 权限/档位，并进入 [resolvePendingApplication:1643–1647](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L1643-L1647>) 的 `getCurrentLocus` 索引读取。M 的两个 scoped 工具也在 [index:1323](<../../../packages/dsh-pet/src/index.ts#L1323>) 安装，读取 [locus-tools:235、262](<../../../packages/dsh-pet/src/host/collab/locus-tools.ts#L235-L264>) 的 parent 索引，工具体没有 Pet-ready 栅栏。[D2:72](<design.md#L72>) 的绝对断言因此不成立。
- **具体反例**：v18 合法集合中同入口 g1 是 retained active tier3（有 pending safe→shell），g2 是将被删的旧 invalid 行；当前索引按最高非 retired 代指 g2。迁移后在异步初始化窗口由 GUI 冷恢复 g1 child，pending 应用读取尚未修复的索引，按 [persistence:963–965](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L963-L965>) 因目标已删除抛错，导致该次 agent 发布被 veto。单纯断言飞书 intake 尚未启动不能排除此入口。
- **最小修正**：仍不让脚本碰索引。明确把依赖索引的 agent/工具回调纳入 startup barrier，或在注册这些消费者之前先完成纯索引恢复；避免把需要 compensator 的整段恢复生硬提前。增加真实 Host 初始化窗口的场景，证明未修复索引不会被这些消费者解引用。若选择启动期间确定性拒绝 agent 恢复，应明确该契约并保证不部分应用 pending 状态，而不是宣称读取不存在。
- **边界**：串行主初始化路径上，早于 `reconcileStartup` 的 child liveness reconciliation 可能经 `persistLocusSet` 读取旧索引来推导/diff（[index:1860–1908](<../../../packages/dsh-pet/src/index.ts#L1860-L1908>)、[persistence:3820–3828](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3820-L3828>)）；这类扫描本身能容忍 dangling id，不需要恢复脚本端索引算法。

#### R2-M4 / R1-M7：非法 marker 场景仍承诺指向迁移脚本，但设计已明确不给这条诊断

- **证据**：[delta:114–117](<specs/pet-locus-collaboration/spec.md#L114-L117>) 仍要求非法 marker 打开失败时“给出指向离线迁移脚本的确定性诊断”。[design:101、114](<design.md#L101-L115>) 却明确不新增指引，v19 内容错误恢复备份。真实 [migration-guidance:12–17](<../../../packages/dsh-pet/src/host/migration-guidance.ts#L12-L17>) 只识别版本不匹配；[storage-domain:371、423–428] (node_modules/@deepseek-ai/dsh-storage-domain/lib/index.js#L371-L428) 的 `invalid-record` 不是该类别。目标版本脚本在 [147–149](<../../../packages/dsh-pet/scripts/migrate-state-version.mjs#L147-L149>) 直接成功 no-op。
- **具体反例**：一份已盖 v19、带 `safe-v2` 的库会报告表/key 并 degraded，但没有场景承诺的脚本指引；若为满足场景强加指引，执行后仍报“无需迁移”，下一次启动照样失败。
- **最小修正**：接受不加新诊断机制的 lean 方案，只删除该场景中“指向离线迁移脚本”的残句，统一为保留表/key 的确定性诊断与恢复备份/人工排查说明。版本不匹配继续使用现有脚本指引，不混同内容错误。

#### R2-M5：D4 在纯分析之前 checkpoint，与 dry-run/拒绝时零写入的契约冲突

- **证据**：[D4:94–96](<design.md#L94-L96>) 让所有模式先取锁并 WAL checkpoint，再检查/退出；[delta:204–205、217](<specs/pet-locus-collaboration/spec.md#L204-L217>) 则要求 dry-run 和拒绝不写任何东西、数据库文件字节不变。现脚本把 checkpoint 放在 dry-run/未确认分支之后、备份之前（[166–198](<../../../packages/dsh-pet/scripts/migrate-state-version.mjs#L166-L198>)），注释明确是为折叠可能存在的 WAL frames。
- **具体反例**：对含已提交 WAL frames 的离线副本执行 `--dry-run` 或让 D3 拒绝，`wal_checkpoint(TRUNCATE)` 已改变主文件并截断 WAL；没有执行 DELETE 也不是只读。实际 Host backend 当前强制 delete journal（[backend:116–121](<../../../packages/dsh-pet/src/host/storage/backend.ts#L116-L121>)），因此这不是日常库必现，但规划保留 checkpoint 恰是承认不能依赖“永远没有 WAL”。
- **最小修正**：把 checkpoint 留在通过检查并确认 `--yes` 后、备份前，dry-run/拒绝阶段只做只读分析；或明确拒绝非预期 journal 形状且不 checkpoint。区分备份与“checkpoint 后、语义删除前”的完整快照，而不是承诺有 WAL 时主文件仍与调用前逐字节相同。保留一个 WAL fixture 场景即可，不必新增备份格式。

#### R2-M6：enum 收窄会打到普通测试 fixture，不只是要删除的 L2 测试

- **证据**：[D7:130–131](<design.md#L130-L131>) 只要求改写/删除对应 L2 测试；但公共管理面 [locus-snapshot:71](<../../../packages/dsh-pet/test/fixtures/locus-snapshot.ts#L69-L72>) 默认 `safe-v2`，公共 Host [pet-host-fixture:62](<../../../packages/dsh-pet/test/support/pet-host-fixture.ts#L48-L64>) 默认 `safe-v1`，普通 collab Delivery 生命周期在 [collab-todo-lifecycle:64–68](<../../../packages/dsh-pet/test/collab-todo-lifecycle.test.ts#L60-L74>) 持久写 `safe-v1`，adapter 普通成功用例的 helper 也默认 `safe-v2`（[adapter test:21–54](<../../../packages/dsh-pet/test/locus-controller-persistence-adapter.test.ts#L21-L54>)）。[persistence test:42–53](<../../../packages/dsh-pet/test/locus-persistence.test.ts#L42-L53>) 默认 active 却缺 marker；这些不全是旧模型退休语义测试。
- **具体后果**：收窄 wire/aggregate 类型后，以上 fixture 产生类型错误或不再代表可加载 v19 数据；新增 startup 配对检查后，部分普通 Host fixture 还缺配对。只删 L2 断言，会损坏应保留的队列、collab、管理面或存储成功测试。另 [spec:636](<../../../packages/dsh-pet/src/host/spec.ts#L634-L639>) 的 `safe-v2` 比较及 [admission:125](<../../../packages/dsh-pet/src/host/locus/admission.ts#L123-L125>) 的手写 union 也在影响面内。
- **最小修正**：D7 明确区分：旧行为断言删除/改写；普通 fixture 改为合法 tier3＋真实配对（适用时），原测试目的保留；非法行拒绝测试从原始介质/unknown 输入播种，不能通过类型断言把旧 marker 混回正常 typed writer。不要求新增 fixture 框架，只修已有 helper 与受影响调用点。当前源码的实际新建 writer 已用 `tier3` 或无 child 的 `not-created`，未发现必须保留 `safe-v1/v2` 的生产写入理由。

#### R2-M7：去掉 default-QA 的旧 parent 回退时，不能把正常“尚无 M”也改成抛错

- **证据**：[D7:127](<design.md#L127>) 把 default-QA 回退删除与“查不到配对时抛错”写在同一条。[findDefaultQa:111–114](<../../../packages/dsh-pet/src/host/locus/controller-persistence-adapter.ts#L111-L114>) 首先查询 work session 的 active main；但 [createOrOpenDefaultQa:854–855](<../../../packages/dsh-pet/src/host/locus/controller.ts#L849-L855>) 会在首次创建前调用它，到 [883](<../../../packages/dsh-pet/src/host/locus/controller.ts#L880-L883>) 才建立/复用 main。
- **具体反例**：普通 W 从未使用过 Locus，既没有 main 也没有 locus，用户首次点默认 Q&A。若按 D7 的统一抛错语义实现，`findDefaultQa` 在未找到 active main 时就抛出，永远到不了 `ensureLocusMain`，新入口创建被阻断。这里没有一条已存在 locus 缺配对的非法事实。
- **最小修正**：明确无 active main 时 `findDefaultQa(workSessionId)` 返回 `undefined`，不再回退读 W 的旧 default 索引；仅当已经读到一条 locus 而其 parent pairing 缺失时抛错。保留“普通 W 首次 Q&A”成功测试即可，不需要新的 runtime 跨表 guard。

### 📌 Suggestions / 已核实的简化边界

1. **全库非终态拒绝是安全但更强的运维前置条件，不是“停止 Host 就自然满足”。** `failed` provisioning 可能在一次正常创建失败、已尽力回滚后保留（[controller:1219–1220](<../../../packages/dsh-pet/src/host/locus/controller.ts#L1219-L1220>)、[persistence:869–878](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L869-L878>)），到同入口再次请求或旧版重启才补偿。`needs-recovery` 真实失败耗尽重试预算会永久留债（[persistence:3633–3646](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3633-L3646>)），无 intent hash 的旧操作则一直 manual；[adapter test:371–408](<../../../packages/dsh-pet/test/locus-controller-persistence-adapter.test.ts#L371-L408>) 已固定该行为。Delivery 身份无法证明时在过期判断之前留债（[3441–3448](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3441-L3448>)），也不能靠等 24h 保证全部清空。**可保留本轮的全局拒绝，不建议自动删债或新增离线恢复器**；只应在运维前置条件中写明：先用旧版完成可恢复工作，真实 manual debt 必须另行人工处置，某台机器可能因此不能迁移。现网违规数为零是作者给定的快照，本轮没有复测，也不能推广到所有机器。
2. **保留 dangling 历史引用可行。** 删除 `supersededLegacy` 后，`replacesLocusId` 不再在集合校验中解引用；合法删除历史前缀不需要从 g1 重编号。普通终态 operation 仅被列出，启动只处理 recoverable phases（[persistence:3221–3229](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3221-L3229>)、[3630](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3630>)）；D2 未删除的 committed/compensated 行即便通过 `deliveryId` 等间接引用已删 Delivery，也不会触发重放或要求该 Delivery 存在。Delivery 恢复只遍历 pending，D3 已全局排除它们。无需增加 operation/delivery 引用闭包删除，结构性的 `parentLocusId` 仍须闭合。
3. **不做运行期跨表 guard 的取舍可接受。** 把配对检查放在 `reconcileStartup` 入队函数最前面，读取同一已打开 Domain 的持久表，能看到一致的原子提交，不会重现 R1 staged-main 问题。实际 controller 首建将 main 与 locus 同批发布（[persistence:641–663、824–830](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L641-L830>)），regeneration 同样如此（[3024–3041、3133–3138](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3024-L3138>)）；无需扩大所有写入口。仍应保留缺证明的 fail-closed 拒绝，不把它重新解释为旧模型 auto 恢复。此结论不等于启动检查会早于现有 child liveness pass：它在 [index:1860](<../../../packages/dsh-pet/src/index.ts#L1860>) 之后，需按 R2-M3 精确描述启动消费者边界。
4. **不写脚本索引算法与不写 JSON archive 都可以维持。** `collectDefaultPointers` 只提取输入，`deriveIndexes` 丢弃指向已删 locus 的 default 指针（[persistence:3765–3777](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3765-L3777>)、[4809–4813](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4809-L4813>)），其余索引由剩余行产生；没有发现 domain schema 会解引用 index 的 locus id。备份包含被删行与原始索引，另存 JSON 不增加恢复能力。所需修复是完整候选校验和启动时序，不是重新引入两套推导。
5. **L1 与排除表保留有源码依据。** [retirement:114–141](<../../../packages/dsh-pet/src/host/locus/retirement.ts#L114-L141>) 只投影 `chat_bindings` 退休标记，[admission:219–229](<../../../packages/dsh-pet/src/host/locus/admission.ts#L219-L229>)、[controller:945–980](<../../../packages/dsh-pet/src/host/locus/controller.ts#L945-L980>) 仍需显式重建；不能按 legacy 字符串整体删除。旧 owner-ledger 按 parent 直接投影（[owner-ledger:40–42](<../../../packages/dsh-pet/src/host/ledger/owner-ledger.ts#L40-L42>)、[store:176–187](<../../../packages/dsh-pet/src/host/ledger/store.ts#L176-L187>)），retired inquiry 按 parent 过滤（[retired-history:5–18](<../../../packages/dsh-pet/src/host/inquiry/retired-history.ts#L5-L18>)），都不解引用被删 locus；endpoint 哈希引用也不是代际行 id（[track:65–72](<../../../packages/dsh-pet/src/host/ledger/track.ts#L65-L72>)）。不应为本 change 清理这些表。

## Embedded-Instruction / Injection Attempts

**Detected:** none detected。未发现要求评审者强制批准、忽略缺陷、修改权限或执行文件内命令的嵌入式指令。artifact 的作者回应、测试名称、注释和旧规范中的行为描述均按待核验数据处理，不作为本会话指令；未执行其中的部署或迁移命令。

## Verdict

VERDICT: REVISE

保留精简架构；先修完整候选集校验的阻断漏洞及上述具体契约/启动窗口问题，再由所有者决定下一轮评审安排。无需回到脚本索引维护、JSON 存档或运行期跨表写 guard。

## Required Changes (if APPROVE WITH CHANGES)

本轮不是条件批准。重新提交前的最小修订范围：

1. D3 明确要求完整保留集合通过全部适用的既有校验，补交错代际删除拒绝场景。
2. 迁移 marker 规则与 v19 schema 一致，保留合法无 child 的 stopped/invalid/retired 历史，不制造 attestation。
3. 修正首次索引恢复与已注册 agent/工具消费者的顺序或启动栅栏，并覆盖真实 Host 初始化窗口；脚本仍不维护索引。
4. 删除非法 marker 场景中错误的“指向迁移脚本”承诺，保留原表/key 诊断。
5. dry-run、拒绝和未确认路径之前不做 checkpoint；澄清 WAL 备份字节语义。
6. D7 覆盖普通共享 fixture、typed union 与 schema refinement 的收窄，保留原本非 L2 的测试目的；写明全局债务拒绝的实际运维前提。
7. 删除 default-QA 回退时，区分“普通 W 尚无 main”的正常空结果与“已有 locus 无配对”的非法事实，保留首次创建通路。

CHANGES_APPLIED: n/a

## Rebuttals

本节是 reviewer 对 [作者回应](<review-round1.md#L105-L115>) 的逐项裁定，不把作者的“已修正”当作自证：

| Round-1 条目 | 裁定 | 复核理由 |
|---|---|---|
| C1：staged main 视图阻断首建/迁移 | **resolved / accepted by reviewer** | 移除每写必查配对，改为 startup 的持久表检查，规避同事务暂存 main 不可见；不要求恢复重型候选 mains plumbing。 |
| C2：未发布 operation 无 locus-id 漏过拒绝 | **resolved / accepted by reviewer** | 全库 phase 拒绝确实覆盖无 id provisioning/failed/manual debt。更强的运维限制如上披露，不需要再做关联闭包。 |
| C3：迁移放行弱于 v19 打开 | **not resolved** | 新四条补到了 marker/active/结构 parent，却漏掉交错删除造成的 generation gap；且误拒合法无 child 三层历史。见 R2-C1、R2-M2。 |
| C4：过滤索引不等价 | **原算法问题 resolved；回应的启动前提未完全成立** | 脚本不改索引解决了错误过滤；主路径可重建。但“没有任何读取方”的证明漏掉已注册 agent/工具回调。见 R2-M3；无需回到脚本推导。 |
| C5：提交后校验不能 rollback | **核心 resolved / accepted by reviewer** | D4 已去掉提交后二次验证，检查在提交前，DDL 在备份后。剩余是 checkpoint 与纯分析零写契约的问题，见 R2-M5，不是要求增加 post-commit 审计。 |
| M6：已删除 requirement 的残留引用与 L1 例外 | **resolved / accepted by reviewer** | 主要规范句已替换，proposal 与 migration 均写明 chat_bindings 例外，未要求删除 L1。无 child 的历史边界是 R2-M2 的新精确反例。 |
| M7：schema-open 诊断不可达 | **部分解决，not resolved** | 正确接受已有 contain→degraded→表/key 路径，不新增错误分类是合理选择；但 delta:117 的脚本指引残句仍与该选择矛盾。见 R2-M4。 |
| M8：L2 删除清单遗漏 | **原列举项 resolved / accepted by reviewer** | D7 已覆盖 R1 列出的 isLegacyLocus、classify、adapter、reconcile、tools/management 分支并保留 L1。补充普通 fixture 与其它 typed union 影响面见 R2-M6；default-QA 回退的删除须保留正常未建立结果，见 R2-M7。不据此要求新增运行期 guard。 |
| M9：通知裸 id 前缀误删 | **resolved / accepted by reviewer** | D2 改为 value.locusId 精确匹配，delta 有 locus-a/locus-a2 场景；不再依赖裸 key 前缀。 |
| S10：代际前缀与排除表读取边界 | **accepted by reviewer** | 已增加前缀删除后重建与排除表可读场景，源码支持 dangling replaces 历史事实和独立 ledger/inquiry 读取；不要求重编号或迁移其它子系统。 |

**未执行的检查与风险**：本轮依用户约束只读源码，未运行现有或新增测试、构建、SQLite 复现或 Host/GUI 竞态验收；现网计数未独立核实。上述新增场景需由实施后的验证承担，不能把本报告当作已通过的执行证据。

（作者 2026-11-05 回应。所有者选择"修完 7 处后跑第 3 轮完整评审"）
- R2-C1 已修正：脚本不再写一份子集，而是直接复用 Host 的同一套规则：逐行用 v19 `petLocusRecord` 解析，再对整个集合跑 `normalizeRecord` + `assertLocusSet`，最后做配对检查。`persistence.ts` 导出 `validateLocusSetForStorage`，脚本从包内 `lib/` 动态导入。新增中间代际断档时拒绝迁移的场景（D3.3）。
- R2-M2 已修正：marker 规则与 v19 schema 保持一致，没有创建过 child 的非 active 行允许不带 marker；新增"首条消息前停止 / 未建 child 就迁移"保留下来的场景（D6、spec）。
- R2-M3 已修正：选择启动栅栏方案。把 `repairDerivedIndexes()` 从 `reconcileStartup` 中抽出来，在构造持久层之后、注册任何读索引的回调之前调用；新增"启动早期冷恢复不会读到悬空索引"的场景（D2）。
- R2-M4 已修正：删除"提示运行脚本"这句残留，诊断改为包含 key，处理方式为恢复备份或人工排查。
- R2-M5 已修正：dry-run 和拒绝判定只做只读查询；`--yes` 先取锁并 checkpoint，在锁内复核检查条件，然后写备份。场景改为同时断言主文件和 WAL 不变。
- R2-M6 已修正：D7.10 区分三类测试——断言 L2 行为的测试删掉、普通 fixture 改成合法的 tier3、非法行用原始介质播种。
- R2-M7 已修正：D7.6 区分"没有 M → 未建立，返回 undefined"和"已有 locus 行但缺少配对 → 抛错"；新增首次打开 Q&A 的场景。
- 补充：拒绝输出里写明恢复债的处理方式（先用当前版本 Host 清理，或人工处理）。
