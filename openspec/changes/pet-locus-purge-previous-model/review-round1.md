## Review Metadata

- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: cross-model codex gpt-6.1-sol, read-only
- **Tool restrictions**: 只读审查；唯一写入为本文件。未运行测试或构建，未打开、复制或查询线上数据库，也未操作部署或 Host。文中的反例来自源码静态追踪，不冒充已执行的测试。
- **Artifacts reviewed**: [proposal.md](<proposal.md>)、[design.md](<design.md>)、[delta spec](<specs/pet-locus-collaboration/spec.md>)、[current spec](<../../specs/pet-locus-collaboration/spec.md>)、[dsh.yaml](<../../../dsh.yaml>)、[OpenSpec 配置](<../../config.yaml>)、[ADR-0009](<../../../packages/dsh-pet/docs/adr/ADR-0009-locus-three-tier-structure.md>)；指定的迁移脚本、schema、migration guidance、Locus persistence/controller/serviceability/resolution/admission/aggregate/composition/context/adapter/delivery/retirement、ledger、tools/context-tool、index/wire 及相关测试源码。另追踪了 collab todo、pending application、prepublication staging、history cursor、media spool 和实际 storage-domain 打开路径。项目未发现 openspec/project.md。

本变更要用离线 v19 迁移删除两层 Locus 历史，并移除读取时退休的代码。所有者已接受丢弃旧停止标记；本评审不推翻该选择，也不要求清理明确排除的 L1/台账/询问表。

本结论只适用于本轮读取的 artifact 内容；除落实明确列出的修改外，后续变动应重新评审。

## Findings

### 🔴 Critical (blocking)

#### 1. D5 的 mains 视图漏掉同一事务准备发布的新 main，会阻断正常首建和迁移

- **证据**：[design.md:98–100](<design.md#L98-L100>) 建议给 `assertLocusSet` 加 mains 参数并直接从 `this` 取；但 [persistence.ts:641–663](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L641-L663>) 仅把新 main 放进 `extra`，在 [766–798](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L766-L798>) 先校验 loci/推导索引，最后才在 [824–830](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L824-L830>) 发布。regeneration 也先在 [3024–3041](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3024-L3041>) 暂存 main，再在 [3115–3138](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3115-L3138>) 校验并提交。
- **反例与后果**：第一次 auto、显式绑定或 Q&A 创建 M 时，尚未提交的 M 不存在于 `this.mains()`。按 D5 原样实施，合法的 `not-created` 行就被当成无配对拒绝；M 不可用时换 M2 也同样失败。这不是只影响历史数据的校验。
- **最小修正**：明确以“持久 mains + 本次 staged main/retireMain”构造候选视图，所有提交前集合校验和间接 `deriveIndexes` 校验都使用同一个候选视图；不要为了通过校验提前单独写 main。补充首建、复用 main、换 M2 与事务失败不泄漏配对的场景。

#### 2. 只按三个 locus-id 字段识别 operation，会漏过真正的发布前在途工作

- **证据**：[design.md:58、73–76](<design.md#L53-L76>) 只按 `locusId/oldLocusId/newLocusId` 选 operation。实际 [persistence.ts:501–539](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L501-L539>) 的 begin 行只写 `endpointKey`、intent 和可选 `resourceRefs.parentSessionId`；[548–574](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L548-L574>) 随外部创建记录资源，直到 [801–818](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L801-L818>) commit 才补 locus-id 字段。补偿依赖这些 refs（[4075–4117](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4075-L4117>)），阻塞器也按 endpoint 或 Q&A parent 而不是 locus id 找债（[4228–4244](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4228-L4244>)）。
- **反例与后果**：旧入口的显式重建已创建资源、尚未 commit 时停机，留下无任何 locus-id 字段的 `provisioning`/`failed` operation。D3 不会看到它，却允许删除旧 locus；迁移宣称已清除在途工作，实际上保留了需要补偿、甚至阻塞同 endpoint 的债。停 Host 并不等于已撤销持久 provisioning intent。
- **最小修正**：先定义受影响 endpoint、parent/child session 与被删 Delivery 的闭包；把 operation 的 endpoint、资源 refs、`deliveryId/oldDeliveryId/newDeliveryId` 关联纳入检查，无法证明无关时拒绝。最便宜的安全方案是拒绝所有未终结 provisioning，而不是发明离线补偿器。不要删除正常 tier3 的操作或清理非本 change 的表。补充“已记资源但尚无 locus id”的拒绝场景。

#### 3. 迁移的通过条件比 v19 打开条件弱，可能成功盖戳后制造必然不可用的库

- **证据**：D3 只拒绝 `tier3` 无配对（[design.md:73–76](<design.md#L73-L76>)），D4 提交后只查父配对和版本（[84–90](<design.md#L84-L90>)）；但新打开契约还要求 marker 为 tier3、active 必须有 marker（[delta spec:255–257](<specs/pet-locus-collaboration/spec.md#L255-L257>)）。v18 schema 明确接受 `safe-v1/safe-v2` 和缺 marker（[spec.ts:580–605](<../../../packages/dsh-pet/src/host/spec.ts#L580-L605>)）。此外存活 topic 的 `parentLocusId` 必须仍存在（[persistence.ts:4699–4704](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4699-L4704>)）。
- **反例与后果**：有配对的 active 行带 `safe-v2`，或没有 marker：它不属于 L、不触发 D3、通过 D4 两项校验，脚本返回成功并升 19，随后 Host 必然拒绝打开。另一个 v18 可接受形状是存活 topic 的 `parentLocusId ∈ L`；删后父配对仍存在，却在首次集合校验抛 `LOCUS_NOT_FOUND`。
- **最小修正**：提交前验证完整候选剩余集合，至少覆盖新 marker/active 规则、存活 `parentLocusId` 引用闭包及现有 `assertLocusSet` 不变量。发现不一致时拒绝而非擅自修复三层数据。补充上述反例，保证失败发生在备份/存档之前的纯分析阶段，且不能先盖 19 再交给 Host 揭错。

#### 4. “索引都是独立贡献所以过滤等于重新推导”的证明不成立

- **证据**：[design.md:59–63](<design.md#L59-L63>) 以代际更高的 tier3 后继为证明，但 [persistence.ts:4746–4766](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4746-L4766>) 对 `endpoint-current` 取的是最高 **非 retired** 行，不是每行独立贡献，也不是最高可服务行；[4735–4742](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4735-L4742>) 只限制代际相邻连续，没有规定“旧模型只能是历史前缀”。`default-qa` 又由独立指针输入决定，并非遍历 loci 自动选（[4809–4819](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4809-L4819>)）。
- **反例与后果**：同 endpoint 的 g1=旧/retired、g2=tier3/invalid（有配对）、g3=旧/invalid，是 v18 schema 和当前集合约束可接受的集合。原 `endpoint-current` 指 g3；过滤后整个索引消失，重新推导却应指存活的 g2。D3 没有拒绝这种输入。仅覆盖“tier3 后继更高”的 happy path 不能证明通用等价；而 startup 还会重建索引（[3317–3331](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3317-L3331>)），所以“打开后相等”甚至可能掩盖迁移当时做错。
- **最小修正**：选择明确方案：复用同源推导逻辑；或保留过滤算法，但提交前验证足以保证等价的前置条件并拒绝反例。分别验证 `endpoint-current` 的非 retired 选择、独立 `default-qa` 指针、parent/child 全历史索引；用原始 SQL 状态在 Host 自愈之前比对语义，并对保留项的 `updatedAt` 定义是否保持。不能为了得到“独立贡献”而重写正常路由语义。

#### 5. COMMIT 后再校验，却保证任何失败都回滚，是不可实现的原子性契约

- **证据**：[design.md:84–92](<design.md#L84-L92>) 把只读校验放在提交之后，却称后续任一步失败都会回滚；[delta spec:205](<specs/pet-locus-collaboration/spec.md#L205>) 同样要求任一步失败回滚且不改版本。现脚本的可回滚校验是在 COMMIT 之前（[migrate-state-version.mjs:201–215](<../../../packages/dsh-pet/scripts/migrate-state-version.mjs#L201-L215>)）。D4 还在 [80–82](<design.md#L80-L82>) 对 2..17 写“先 restamp/建表”，未说明这只是虚拟分析，和“备份之前不改库”存在歧义。
- **反例与后果**：删除和版本更新已 COMMIT，随后配对校验、SQL 读取或输出失败，`ROLLBACK` 已无法撤销已提交数据。操作者会得到“失败且库未变”的承诺，实际库已经 v19；不能用备份存在代替原子性。
- **最小修正**：版本/形状/引用/索引校验在同一删除事务内、COMMIT 前完成；把真正提交后的检查定义为额外审计，失败明确报告“已提交，需人工恢复”，不声称 rollback。2..17 缺表按空表进行只读分析，所有 DDL/restamp 都在备份、存档之后的迁移事务里；备份记录真实源版本。增加校验失败和提交后失败两个独立场景。

### 🟡 Moderate

#### 6. delta 仍命令按已删除的 requirement 退休旧行，且“全部按从未关联处理”漏掉 L1 例外

- **证据**：[delta spec:80](<specs/pet-locus-collaboration/spec.md#L80>) 原样保留 safe-v1/v2 或缺 marker 的行按“旧模型入口按退休规则处理”退出路由，随后却在 [190–196](<specs/pet-locus-collaboration/spec.md#L190-L196>) 删除该 requirement；[257](<specs/pet-locus-collaboration/spec.md#L257>) 又要求全库拒绝打开。同一迁移说明 [196](<specs/pet-locus-collaboration/spec.md#L196>) 与 [proposal.md:13](<proposal.md#L13>) 无条件承诺旧入口下一条授权 at 自动建立，但 [design.md:120](<design.md#L120>) 承认同时存在 L1 `chat_bindings` 时必须显式重建。实际 admission 保留 L1 拒绝（[admission.ts:219–229](<../../../packages/dsh-pet/src/host/locus/admission.ts#L219-L229>)）。
- **修正**：替换而不是保留旧规范句，明确允许 `not-created` 无 marker、其它非法可加载行全库拒绝；在 proposal 和 normative migration 文本补上 L1 退休标记仍独立生效的例外。不得为让新句子成立而删除 L1 retirement 行为。

#### 7. 新内容错误在 repository 之前就会抛出，现有 guidance 不会生成承诺的诊断

- **证据**：[design.md:98–99](<design.md#L98-L99>) 依赖 schema 先拒绝旧 marker，再由 repository/现有 degraded 通道提示脚本。实际 [index.ts:314–317](<../../../packages/dsh-pet/src/index.ts#L314-L317>) 先 `storageDomain.open`，到 [350–353](<../../../packages/dsh-pet/src/index.ts#L350-L353>) 才构造 repository；storage-domain 会在打开期间逐行验证并抛带 key 的 `invalid-record`（[storage-domain index.js:364–375] (../../../node_modules/@deepseek-ai/dsh-storage-domain/lib/index.js#L364-L375)、[419–428] (../../../node_modules/@deepseek-ai/dsh-storage-domain/lib/index.js#L419-L428)）。[migration-guidance.ts:12–17](<../../../packages/dsh-pet/src/host/migration-guidance.ts#L12-L17>) 仅识别版本不匹配，忽略 `invalid-record`；当前 CLI 对目标版本直接 no-op（[migrate-state-version.mjs:147–149](<../../../packages/dsh-pet/scripts/migrate-state-version.mjs#L147-L149>)）。
- **修正**：degraded 通道本身可达（[index.ts:255–271](<../../../packages/dsh-pet/src/index.ts#L255-L271>)），问题是错误分类/修复路径未定义。明确在 domain open 失败处如何保留表/key并提供新内容错误指引；不要期待 repository 包装一个它看不到的异常。对已盖 v19 戳但内容非法的库，区分“只读诊断/恢复备份/人工修复”与正常 v18→19 迁移，不能给出一个重复执行永远 no-op 的修复命令。补充旧 marker 在 domain open 被拒、无配对在 repository 被拒两条真实初始化路径。

#### 8. D6 漏掉了实际的 L2 分支；不能把它们一律解释成应保留的 L1

- **证据**：D6 清单见 [design.md:104–113](<design.md#L104-L113>)。尚有 [persistence.ts:2971–2979](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L2971-L2979>) 的 `isLegacyLocus`、[controller.ts:2310–2333](<../../../packages/dsh-pet/src/host/locus/controller.ts#L2310-L2333>) 的配对缺失→legacy 分类、[controller-persistence-adapter.ts:111–114](<../../../packages/dsh-pet/src/host/locus/controller-persistence-adapter.ts#L111-L114>) 的 default-QA 老 parent 回退及 [420](<../../../packages/dsh-pet/src/host/locus/controller-persistence-adapter.ts#L413-L424>) 的 previousModel 投影、[reconcile.ts:109–117](<../../../packages/dsh-pet/src/host/locus/reconcile.ts#L109-L117>) 的旧 marker 静默跳过、[tool-tier-mutation.ts:143–146](<../../../packages/dsh-pet/src/host/locus/tool-tier-mutation.ts#L143-L146>) 和 [control.ts:216–217](<../../../packages/dsh-pet/src/host/locus/control.ts#L216-L217>)/[management.ts:947](<../../../packages/dsh-pet/src/host/locus/management.ts#L944-L948>) 的“退休后下一条 at 建立”分支。它们不在目前删除清单中。
- **修正**：补充精确清单，区分“确实退役的 L2 语义”与“仍有必要的无证明 fail-closed 校验”。marker 校验若保留作边界防御，应改为数据/组合无证明的拒绝，而非继续宣称运行期退休。相反 [retirement.ts:114–141](<../../../packages/dsh-pet/src/host/locus/retirement.ts#L114-L141>)、[controller.ts:945–980](<../../../packages/dsh-pet/src/host/locus/controller.ts#L945-L980>) 和 [index.ts:2267–2274](<../../../packages/dsh-pet/src/index.ts#L2267-L2274>) 明确属于应保留的 L1 路径。不要按 `legacy` 字符串全局删除测试。

#### 9. switch notice 的“id 前缀”不是精确关联，可误删存活入口的通知债

- **证据**：[design.md:56](<design.md#L53-L59>) 只说 key 前缀为被删 id。真实 key 为 `locusId + STORAGE_KEY_SEPARATOR + generation`（[persistence.ts:4574–4575](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4574-L4575>)、[switch-notice.ts:75–84](<../../../packages/dsh-pet/src/host/locus/switch-notice.ts#L75-L84>)），行内也有 `locusId`（[spec.ts:940–948](<../../../packages/dsh-pet/src/host/spec.ts#L940-L948>)）。
- **反例与后果**：L 包含 `locus-a`，存活 id 为 `locus-a2`；字面 `startsWith('locus-a')` 会删除后者通知。失去通知债会解除发送前的 switching 栅栏（[persistence.ts:968–975](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L968-L975>)）。目前 id 验证只要求非空，不提供无前缀关系保证（[4892–4895](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4892-L4895>)）。
- **修正**：按解析后 value.locusId 精确匹配 L，并核对 key 与 value；或至少使用含明确分隔符的完整前缀，而不是裸 id 前缀。定义旧 NUL 截断键的处理，不把历史损坏键当成任意前缀删除授权。增加共享前缀但 tier3 通知必须保留的场景。

### 📌 Suggestions

#### 10. 写下已核实的边界，避免再扩 scope；不要把“删除前代”本身误报为必须重编号

- **代际**：durable `assertLocusSet` 不要求最小代际为 1，只比剩余相邻代际连续（[persistence.ts:4735–4742](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4735-L4742>)）；目前只在 supersededLegacy 查找中读取历史 `replacesLocusId`，缺目标不抛（[4681–4689](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4681-L4689>)）。因此删除完整历史前缀、留下 gN 及指向已删行的 audit reference，不会**仅因此**使当前 durable repository 无法读取；首次 provisioning 的 g1 检查只用于没有任何 latest 的新发布（[713–724](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L713-L724>)）。无需重写保留三层行或重编号。应增加“历史前缀删除→打开→下一次重建”的场景，并明确 `replacesLocusId` 在此是允许悬空的历史事实；交错删除造成 gap 或存活 topic 父丢失则应拒绝，见第 3/4 项。
- **排除表**：owner-ledger 的 legacy 列表按 parent 取行并直接投影（[owner-ledger.ts:41–42](<../../../packages/dsh-pet/src/host/ledger/owner-ledger.ts#L41-L42>)、[store.ts:176–187](<../../../packages/dsh-pet/src/host/ledger/store.ts#L176-L187>)）；retired inquiry 投影按 `circleParentSessionId` 过滤，不查 locus（[retired-history.ts:5–18](<../../../packages/dsh-pet/src/host/inquiry/retired-history.ts#L5-L18>)）。可保留这些历史字符串引用，不需要顺手迁移其它子系统。建议把设计中“实施时再核实”的语句替换为这几条具体读取链和“不抛错/仍可列出”的回归要求；仅检查表字节不变没有验证读取行为。
- **其它引用**：collab `ext.pet.entry` 不是代际行 id，而是稳定 endpoint 身份（[track.ts:65–72](<../../../packages/dsh-pet/src/host/ledger/track.ts#L65-L72>)、[todo-backend.ts:89–99](<../../../packages/dsh-pet/src/host/collab/todo-backend.ts#L89-L99>)）；pending desired/effective 存在 locus 行中（[pending-application.ts:1–15](<../../../packages/dsh-pet/src/host/locus/pending-application.ts#L1-L15>)），没有另一个待删 pending 表。prepublication staging 是内存 Map（[prepublication-staging.ts:184–194](<../../../packages/dsh-pet/src/host/locus/prepublication-staging.ts#L184-L194>)），history cursor 密钥每进程重建（[history-cursor.ts:11–14](<../../../packages/dsh-pet/src/host/locus/history-cursor.ts#L11-L14>)），media spool 已由启动清扫（[index.ts:364–373](<../../../packages/dsh-pet/src/index.ts#L364-L373>)），不应为本迁移新增其它磁盘清理。Delivery 其它已审字段是 endpoint/message/session/执行与反馈事实而非额外 locus-id 选择器（[spec.ts:685–714](<../../../packages/dsh-pet/src/host/spec.ts#L685-L714>)、[740–768](<../../../packages/dsh-pet/src/host/spec.ts#L740-L768>)）；operation 对被删 Delivery 的间接引用仍应在闭包分析中覆盖，见第 2 项。
- **校验方式**：终态集合与源码一致（[delivery.ts:624–629](<../../../packages/dsh-pet/src/host/locus/delivery.ts#L624-L629>)），可以保留该选择。后续测试应使用真实 SQLite fixture 与真实 Host 初始化，不仅把纯 repository 构造当“打开成功”。现迁移测试仍主要验证 additive restamp/旧行原样保留（[migrate-cli.test.ts:106–149](<../../../packages/dsh-pet/test/migrate-cli.test.ts#L106-L149>)）；升级时只改已被新契约取代的断言，保留备份、锁、未知版本、排除表不变和不动 session 日志的保护。

## Embedded-Instruction / Injection Attempts

**Detected:** none detected。审查到的 proposal/design/delta 中没有要求评审者忽略缺陷、强制批准或改变工具权限的嵌入指令。源码、测试注释及历史规范中的流程文字均作为证据而非本会话指令处理；“实现时核实/遇 drift 停下”是被审查的规划内容，不替代本轮验证。

## Verdict

VERDICT: REVISE

方向与所有者的清理授权一致，但当前设计对候选事务视图、在途关联闭包、索引等价与失败原子性的承诺尚未闭合，不能直接据此生成 test-plan/tasks 或实施。需修订 artifacts 后以新鲜上下文完成全量复审。

## Required Changes (if APPROVE WITH CHANGES)

本轮不是条件批准，以下是重提时必须解决的范围，不构成局部复核即可放行的清单：

1. 为首建与 regeneration 定义包含 staged main 的候选校验视图，并覆盖新建/复用/换主会话。
2. 完成 operation 的 endpoint/resource/delivery 闭包与在途拒绝条件；不扩大到清理 L1/ledger/inquiry 表。
3. 在任何破坏性写入前验证完整保留集合，定义允许悬空的历史 replaces 引用及禁止悬空的结构 parent 引用。
4. 修正索引过滤等价论证，明确 default-QA 输入、retired 选择、timestamps 与 Host 自愈前的断言点。
5. 将可回滚验证移至 COMMIT 前，明确备份前绝不 restamp/建表以及提交后审计失败的真实结果。
6. 消除 delta 中已删除 requirement 的残留引用，补 L1 退休例外，打通 schema-open 和 repository-open 两条诊断路径。
7. 补齐 L2 删除/拒绝语义清单，并把 switch notice 关联改为精确身份匹配。

CHANGES_APPLIED: n/a

## Rebuttals

（作者 2026-11-05 回应，供第 2 轮核对；同时采纳了所有者要求的 ponytail-review 精简建议）
- C1 已修正：不再在每次写入时做跨表校验；配对检查只在启动对账开头做，读取已持久化的 `locus_mains`（design D6）。
- C2 已修正：拒绝条件改为全库没有非终态投递、没有未完成操作，不再判断是否与旧行相关（D3.1/D3.2）。
- C3 已修正：提交前按 v19 加载条件校验保留下来的整个集合，包括 marker、active、配对和 `parentLocusId` 闭包（D3.3）。
- C4 已修正：脚本不再处理索引，交给启动对账重推导；新增"迁移后打开并完成对账"的场景（D2）。
- C5 已修正：所有检查都放到提交前；备份写在包括 DDL 在内的所有改动之前；去掉提交后的二次校验和 JSON 存档（D4）。
- M6 已修正：替换了原规范句；在迁移文本和新场景里写明 L1 例外。
- M7 已修正：分两个检查点——非法 marker 在 Domain 打开时被拒，无配对在启动对账时被拒，都走现有 degraded 通道。不新增"提示运行脚本"的分类：v19 内容错误只可能来自手工改库，处理方式是恢复备份（D4/D6）。
- M8 已修正：D7 补全清单，并区分 L1 和 L2。
- M9 已修正：按记录值中的 `locusId` 精确匹配；新增共享前缀的场景。
- S10 已采纳：新增"删除历史前代后仍可服务和重建"以及"非 locus 表仍可读取"两个场景。
