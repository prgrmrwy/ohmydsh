## Review Metadata

- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: cross-model codex gpt-6.1-sol, read-only
- **Tool restrictions**: 只读审阅；唯一写入为本报告。未运行测试、构建、迁移、部署或重启；未读取或操作线上状态库，未修改实现、其它 artifact 或记忆库。
- **Artifacts reviewed**: [proposal](<proposal.md>)、[design D1–D14](<design.md>)、[collaboration delta](<specs/pet-locus-collaboration/spec.md>)、[doc-comments delta](<specs/pet-locus-doc-comments/spec.md>)；两份 current spec、[manifest](<../../../dsh.yaml#L173-L197>)、[ADR-0009](<../../../packages/dsh-pet/docs/adr/ADR-0009-locus-three-tier-structure.md>)、[集成陷阱](<../../../docs/architecture/dsh-plugin-integration-pitfalls.md>)、前一 change 的第一轮（已删除的旧 change：../pet-topic-bind-without-group/review-round1.md）与第二轮（已删除的旧 change：../pet-topic-bind-without-group/review.md）评审；下述真实 controller、persistence、delivery、composition、tools/context、startup recovery、admission、management、preset、迁移与部署源码及相关测试夹具。未发现 openspec/project.md；本 change 当前尚无 tasks/test-plan。

本报告评审**计划能否正确实现**，不把尚未编写的 v20 实现当作已经存在的缺陷。运行边界为一个独占 Pet 状态库的 Host、同一长驻 controller 并发处理多个入站请求。接受所有者已定的同构模型、单行入口、单值 accessMode、管理面归档后整群改绑和不保留上下文，不重议产品选择。结论仅适用于本轮读到的 artifact；除落实 Required Changes 外，后续修改 proposal/design/specs 须重新评审。

## Findings

### 🔴 Critical (blocking)

#### C1 — 默认 Q&A 迁移的输入形状写错，验收会把错误夹具固化

- **计划证据**：[D13:191](<design.md#L190-L194>) 与 [delta:244](<specs/pet-locus-collaboration/spec.md#L241-L246>) 说按 `value.key` 读取并改成入口键；[场景:282–285](<specs/pet-locus-collaboration/spec.md#L282-L285>) 更明确假设 `value.key` 指向旧 locus id。
- **真实形状与反例**：索引的 `key` 是**索引自己的键**，目标在 `locusIds[0]`，见 [schema:683–687](<../../../packages/dsh-pet/src/host/spec.ts#L683-L687>)、reader:1094–1105（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L1094-L1105`）、writer:4844–4855（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L4844-L4855`）。真实行是 `{key:'default-qa:M', locusIds:['Lold']}`，而不是 `{key:'Lold'}`；现有[夹具:66–69](<../../../packages/dsh-pet/test/migrate-cli.test.ts#L66-L69>) 也如此。按现有文字实现，找不到 Lold 或把索引键当入口键；D12 又明确默认位不能推导，启动重建救不回来。
- **最小修订**：精确定义 v19→v20 两侧完整 KV 形状：从物理键/`value.key` 解析 M，从 `locusIds[0]` 查原行，再按其 endpoint 映射到保留的最新群行。若默认位仍指向同入口的旧历史 id，也须映射到最新入口，而非只认幸存 id。明确悬空、话题目标和键冲突时拒绝还是清除，不能静默丢默认位。
- **机械验收**：使用真实索引形状，分别覆盖正常默认、指向同入口旧代、历史截断键兼容以及悬空指针；迁移后打开 Host，再经 W 调用创建/打开默认 Q&A，返回同一群且外部建群次数为 0。

#### C2 — 按群迁 M 的中间态违反“一 W 至多一个 active M”，忙群之后也没有可复用目标的证明

- **计划证据**：[D7:111](<design.md#L106-L111>)、[delta:1226](<specs/pet-locus-collaboration/spec.md#L1220-L1227>) 要求旧 M **没有任何群引用后才 retired**；[场景:1248–1251](<specs/pet-locus-collaboration/spec.md#L1248-L1251>) 又要求先迁 G1、G2 忙则保留旧 M。与此同时 [三层实体:1137](<specs/pet-locus-collaboration/spec.md#L1131-L1137>) 仍要求同 W 至多一个 active M，D11 明说保留原 main 模型。
- **真实反例**：W 的 active M0 被归档，G1 空闲、G2 有 current。G1 发布到 active M1 时，M0 因 G2 仍引用不能 retired；现有 main 只有 `active|retired`，见 [schema:663–677](<../../../packages/dsh-pet/src/host/spec.ts#L663-L677>)。两个 active 使 getActiveLocusMainForWork:2953–2962（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L2953-L2962`） 抛错，真实发布 guard 也只允许在同事务退休旧 active，见 commitRegeneration:3010–3042（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L3010-L3042`）。若 M1 不 active，新群又不能服务。只给各群锁不能保证 G1/G2 同时迁移时只建一个替代 M；还需要 W 的 main lease 持有至发布。
- **最小修订**：区分“当前路由配对退出 active”和“旧会话/历史仍被引用”。最便宜的方案是首群发布 M1 时原子退休 M0 的**配对**（不删除/归档历史），允许忙群暂时引用 retired 配对，后续按 W 查到并复用 M1；若坚持最后才 retired，则必须明确其它可表示的非 active 状态和恢复协议。不能同时保留现在这两条相反的断言。
- **机械验收**：至少覆盖 G1 已迁/G2 忙的持久中间态、该时刻重启、G2 后续迁移、两群同时触发、M1 又不可用。每阶段同 W 至多一个 active、只创建一个本轮目标 M/空间，忙群旧 current 不被改写；群迁移提交也须像 rebind 一样与 `acceptDelivery` 串行检查，不能只查群锁外的空闲快照。

#### C3 — `prepared access` 只替换了状态名，没有替换原来的完整权限变更栅栏

- **计划证据**：[D8:117–126](<design.md#L117-L126>)、[delta:12–17](<specs/pet-locus-collaboration/spec.md#L12-L17>) 只规定 prepared 时拒绝 `acceptDelivery`、同 locus 串行变更，以及回读失败恢复行值；没有规定 prepared 的原子建立、失败/重启终结、回滚失败与其它生命周期动作的关系。
- **具体反例 A（准入竞态）**：变更读到无投递，普通 at 随后在写 prepared 前被接受；投递不拿 access 的进程内锁。若不在与 acceptance 同一持久序列中**复查空闲并写栅栏**，已接受的请求与 live 权限变更重叠。旧实现的这个保证不是命名惯例，而是 beginPermissionMutation:1454–1465（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L1454-L1465`） 的原子空闲复查加 `switching`，以及 acceptDelivery:1966–1969（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L1964-L1969`） 的状态拒绝。
- **具体反例 B（崩溃/回滚）**：prepared 已持久化，live sandbox 已改成 full，工具面应用或持久提交失败。仅把行恢复 read、把操作标成结束会留下 live 的宽权限；保留 prepared 又会永久挡入口。当前 permission-mutation:325–373（已删除：`../../../packages/dsh-pet/src/host/locus/permission-mutation.ts#L325-L373`） 有恢复 live 策略的专门路径，而 启动恢复:3609–3614（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L3609-L3614`） 对非 provisioning operation **只报告人工债**，不会自动恢复/结束 access。不能声称“复用原恢复”即可闭合；prepared 的失败阶段若转成 `failed/needs-recovery`，只检查 prepared 还会提前解禁。
- **最小修订**：保留单值 accessMode，不恢复 pending desired/effective。给 access operation 定义最小持久生命周期：原子复查空闲/CAS/建立栅栏；操作记录精确绑定 sessionId、revision 与回滚所需旧值；live sandbox 和工具面均恢复并回读成功才释放；失败债也挡 acceptance/发布。启动根据**已提交行**重新装配并核验后幂等终结债，不能重放未承诺的提权。stop/rebind/rebuild 必须与它互斥，或使其晚回调凭最初捕获的 session/revision 失效，不能重读新 revision 后给旧操作续权。
- **机械验收**：在写 prepared 前后、两项 live 应用之间、回读后提交前、提交后解锁前分别注入并发 acceptance 和崩溃；另测回滚失败、stop 及整群 rebind 竞争。断言没有非空闲变更、没有 read 标签下的 full live authority、没有永久孤儿栅栏或误解禁。

#### C4 — 首次创建核验失败被要求复用已消耗的 sessionId，直接破坏现有的失败恢复协议

- **规范冲突**：[场景:1050–1052](<specs/pet-locus-collaboration/spec.md#L1050-L1052>) 明确要求 `agent/created` 回读失败后 `sessionId`、`revision` 都不变，并在下一条 at 重试。D3 只提首图降级轮换，遗漏其它创建失败。
- **真实源码证据**：failFirstDeliveryCreation:2594–2605（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L2594-L2605`） 明确处理“agent/created veto 也可能留下持久 Session id”；revert:2626–2666（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L2626-L2666`） 为此新预留 id、递增 revision、终结失败 current，并只重定向**未注入** backlog。入口即使未发布 active，也不表示 runtime 没建 Session。官方创建与 adoption 不可混用，见 [child.ts:856–859](<../../../packages/dsh-pet/src/host/locus/child.ts#L856-L859>)。下一次拿同一 id 再调创建会遇到重复持久身份，或迫使实现错误 adopt 核验失败的会话。
- **最小修订**：按失败发生点分流：尚未调用官方创建、已证明无副作用的名额拒绝可以保留预留；已经或可能消耗 id 的非名额失败，安全释放后原子预留新 sessionId、revision 递增，失败 Delivery 保留旧关联，未注入 backlog 跟随新预留；无法证明释放时留下恢复债并拒绝再次创建。首图纯文本重试复用这套机制，不只覆盖图片错误。
- **机械验收**：核验失败前已持久化 Session 的 fixture、发布后 API 拒绝、清理失败、重启补偿，以及首图 veto 同时存在 backlog。必须检查旧 session 的迟到 claim/turn 不影响新 current，首图最多一次文本重试且 deadline/触发 message 不变，backlog 不遗落在旧 sessionId。

#### C5 — 单行覆盖后旧 child 会被误认作普通会话，绕过发布时收紧

- **计划证据**：[D2:50](<design.md#L47-L60>) 保留 locusId、覆盖 sessionId；[D6:100](<design.md#L94-L104>) 明确不归档旧 child；[D11:159](<design.md#L157-L160>) 又把组合证明全部交给发布边界。计划没有说明**不再被 loci 引用、但依然持久存在的 locus child**在该边界如何识别。
- **真实反例**：read-only C0 在 rebind/rebuild/首创回滚后被 C1 覆盖，所有者从保留的历史打开 C0 或让其冷恢复。当前 reverse lookup:1080–1082（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L1080-L1082`） 只扫 loci；覆盖后返回 0。于是 [durable lookup:1007–1016](<../../../packages/dsh-pet/src/index.ts#L1007-L1016>) 返回 undefined，[composeLocusChild:354–367](<../../../packages/dsh-pet/src/host/locus/composition.ts#L354-L367>) 当普通会话放行，**不安装** access 限制、caller-bound 表面和项目读取 guard。持久 [locus-child preset:40–46、70–71](<../../../presets/locus-child/agent.cordis.yml#L38-L71>) 自带 bash/skill 宽底座；read-only sandbox 并不能替代禁 shell/飞书凭据的工具隔离。旧实现保留历史行，非 active 子会话会在 lookup 中被拒；单行后这个负面证明丢了。
- **最小修订**：不需要恢复历史 locus 表。利用持久 `locus-child` preset/header/父 M 身份，在发布时区别“普通非 Pet 会话”和“已退役、无当前归属的 Pet child”；后者 veto 执行或安装明确的不可工作最小隔离，仍允许只读查看历史。staged 新 child、当前 child、普通 W/worker 分别处理，不能把无匹配统一解释成普通会话。
- **机械验收**：覆盖被 rebind、原地重建、迁移合并及首图回滚淘汰的旧 child；打开/冷恢复后不可获得 bash/skill、caller-bound/current 或旧空间工作能力，新 child 正常，普通 W 创建的 worker 不受影响。此项是删 history 后必须补的负面身份边界，不是在要求重新保存全部历史。

#### C6 — v20 必填 sessionId 没有覆盖 v19 合法的“从未创建、也无预留”的停止/失效行

- **计划证据**：[行形状:183](<specs/pet-locus-collaboration/spec.md#L180-L184>) 要求 sessionId；[D13:185–188](<design.md#L183-L189>) 和 [迁移:242](<specs/pet-locus-collaboration/spec.md#L241-L247>) 仅定义 `childSessionId ?? reservedChildSessionId`，没有缺省分支。
- **真实反例**：v19 两字段均 optional，非 active 允许没有 marker/child，见 [schema:590–602、614](<../../../packages/dsh-pet/src/host/spec.ts#L590-L614>)；已有[迁移 fixture:366–378](<../../../packages/dsh-pet/test/migrate-cli.test.ts#L366-L378>) 的 stopped/invalid 就两者都无，且原契约承诺合法保留。按新公式得到 undefined，v20 validator 拒绝；v18 中保留这类三层行也同样失败。这不是非法数据应 fail closed，而是支持的源版本没有被定义完。
- **最小修订**：明确无现存 child/无预留 id 的非 active 源行怎样生成**新预留** sessionId，同时保持 stopped/invalid 语义与原 locusId、时间事实；若拟把某类源形状列为不可自动迁移，也必须给出识别与修复路径，而不是宣称 2..19 普遍可迁。预检与锁内分析要针对旧形状，最终发布才用 v20 validator。
- **机械验收**：至少 v19、v18 的 stopped/invalid 双缺省、已有 reserved、已有 child 三类；以及 v2..17 无 main 的旧行清除。所有允许源形状经迁移后可打开并保持正确停止/恢复路径。

### 🟡 Moderate

#### M1 — 默认 Q&A 的运行期转移与审计重键仍欠完整定义

- [D12:168](<design.md#L162-L170>) 把默认位固定为 M→群入口键，但 [rebind 事务](<specs/pet-locus-collaboration/spec.md#L135-L143>) 和[按群迁 M](<specs/pet-locus-collaboration/spec.md#L1226-L1251>) 都没写默认位如何更新。真实 findDefaultQa adapter:113–117（已删除：`../../../packages/dsh-pet/src/host/locus/controller-persistence-adapter.ts#L113-L117`） 从 W 的 active M 找默认；旧 commitRegeneration:3092–3095（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L3092-L3095`） 会随换 M 转移它。只改群行会使默认位悬在旧 M，启动派生丢弃或 reader 拒绝。rebind 目标 W 已有自己的默认群时，还可能出现两个群抢同一默认位。
- [审计场景:287–290](<specs/pet-locus-collaboration/spec.md#L287-L290>) 把同入口两代称为同一个 locusId，但旧代每代 id 不同；真实审计键:1695–1711（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L1695-L1711`） 是 `oldLocusId<sep>generation<sep>sequence`，字段名为 `sequence`，不是 `seq`。D13 的“映射字段”未定义历史 audit.locusId 是否映射到保留的最新 locusId，及不再有 locus 行的审计如何读。
- **修订**：明示同 W 换 M 的默认位原子转移；跨 W rebind 选定“清除旧默认/是否占用新默认”的确定规则，不能覆盖目标既有默认。审计用两个不同 old id、各自 generation/sequence 的真实夹具，给出映射后的完整键和值、排序与冲突/拒绝审计事实保留规则。不要让测试依赖虚构的输入。

#### M2 — MODIFIED 场景仍有无法同时满足或不再可构造的前提

- **文档场景仍混淆 M/W**：[doc 场景:37–39](<specs/pet-locus-doc-comments/spec.md#L36-L39>) 在 GIVEN 说文档级 locus“主会话为 S0”，THEN 又断言“其 W 仍为 S0”；新三层模型下 locus 的主会话是 M，W 是另一会话，不能把两者设成同一 id。夹具应分别给出 W0、M0 并断言评论解析到 M0、其工作归属为 W0。注意：飞书控制层已经[先解析前缀再调用 controller](<../../../packages/dsh-pet/src/index.ts#L2226-L2251>)，因此跨 W 场景里 controller 的 `resolveMainParent` 0 次本身可成立，不应误判为必须额外解析或外部创建。
- **失败来源混用**：[换绑按层:1223、1233–1236](<specs/pet-locus-collaboration/spec.md#L1220-L1236>) 把组合核验失败列为 invalid、下一条 at 重建；[发布拒绝场景:1124–1127](<specs/pet-locus-collaboration/spec.md#L1124-L1127>) 又规定同类冷恢复 `composeLocusChild` 失败时入口行不改写。应区分可重建的 child 损坏、应保留 accessMode 等待纠正的策略核验失败、runtime 能力缺失，固定诊断与状态转移，不能让实现自由选择。
- **不存在的 v19 行**：[safe-v1 场景:1111–1114](<specs/pet-locus-collaboration/spec.md#L1111-L1114>) 假设版本19合法带 safe-v1；真实 [v19 schema:602](<../../../packages/dsh-pet/src/host/spec.ts#L598-L602>) 已不允许它。该测试只能证明任意 v19 戳都会 version-mismatch，不能证明升级前组合防护；应改为真实 v19 tier3，另在对应旧版本/非法库拒绝场景覆盖 safe-v1。

#### M3 — 全局关闭时把整个 access 控件禁用，会堵死从 full 退回 read 的管理面恢复路径

- [access requirement:19](<specs/pet-locus-collaboration/spec.md#L17-L21>) 只禁止授予 full，并拒绝已有 full 服务；但 [完全访问 requirement:95、115–117](<specs/pet-locus-collaboration/spec.md#L95-L117>) 禁用整个 `access` 控件。按 [迁移:242](<specs/pet-locus-collaboration/spec.md#L241-L242>)，确实会留下 full 记录；默认开关为关，管理面没有办法恢复其服务，只能借飞书命令绕回去。
- **修订**：仅禁用 full 选项/提权，不禁用 full→read；spec、UI 场景与回执保持一致。补“迁移留下 full + 写开关关闭”夹具，管理面可改 read，随后的 authorized at 可服务。另[未创建状态场景:1394](<specs/pet-locus-collaboration/spec.md#L1391-L1394>) 无条件说访问模式可用，也须服从同一规则。

#### M4 — 并发及停止的验收尚不足以证明新边界，不能用行数成功场景替代

- [D4](<design.md#L70-L79>) 和[建立场景:1184–1197](<specs/pet-locus-collaboration/spec.md#L1184-L1197>) 没有覆盖从零双创建与并发群 @。真实[群锁及话题锁:723–734](<../../../packages/dsh-pet/src/host/locus/controller.ts#L723-L734>) 和 [main lease:1945–1955](<../../../packages/dsh-pet/src/host/locus/controller.ts#L1945-L1955>) 必须跨过外部资源创建和 durable commit；一次 commit 本身不能证明不会多建 W/M/space。应补两话题同时首 @、话题 bind 与群首 @（两种胜出顺序）、同 W Q&A 与首次 bind、提交前失败与提交成功后 finalize 失败/重启。断言无半群/孤话题、失败资源仅补偿自己拥有的部分、既有 M 不被误回收。
- [允许忙时停止:12、67–70](<specs/pet-locus-collaboration/spec.md#L12-L70>) 是新增行为，真实 stopLocus:1197–1203（已删除：`../../../packages/dsh-pet/src/host/locus/persistence.ts#L1197-L1203`）、[management stop:1134–1142](<../../../packages/dsh-pet/src/host/locus/management.ts#L1134-L1142>) 都拒绝 pending。计划未说明停止如何处置 current/backlog、是否取消运行、何时允许同 W bind、迟到 finish 是否仍可出站。应固定 fail-closed 的队列终态/取消策略并补停止与 acceptance/finish/rebind 的交错；否则“停止受理”可以只改状态却留下永不结算的 pending，使重启或改绑永久忙。
- rebind 已有[提交前插入投递场景:170–173](<specs/pet-locus-collaboration/spec.md#L170-L173>)，方向正确，但目标 W 尚无 M 时先创建的 M/space，在忙冲突、CAS 冲突和进程崩溃后的资源 ownership/补偿也须断言；SQLite 回滚不了外部建空间。

### 📌 Suggestions

#### S1 — 保留迁移与部署现成接缝，不再平行维护第二套正确性实现

[D13:174、194](<design.md#L174-L194>) 的 lib 复用与 deploy check 方向合理；真实[部署检查器](<../../../scripts/lib/deploy-checks.mjs#L21-L54>) 已从部署副本、仓库外 cwd 用 plain node 执行声明 bin，[installed fixture](<../../../packages/dsh-pet/test/migrate-cli-installed.test.ts#L30-L68>) 已覆盖无 Host peers、nested runtime dependencies 与 `.bin` 符号链接。无需另造部署框架。应扩展现有 self-check **实际导入 v20 transform 与旧形状预检所需的全部模块**，而不只是 import 新 persistence；v19 的同名 validator 在升级后会变成 v20 validator，“先验 v19、再验 v20”不能调用同一新函数两次冒充两个版本的证明。

#### S2 — `(locusId, sessionId)` 可以替代实例代号，但不是 Delivery 或恢复证明

核过 [delivery correlation](<../../../packages/dsh-pet/src/host/locus/delivery.ts#L1110-L1120>)、[精确结算](<../../../packages/dsh-pet/src/host/locus/delivery.ts#L1004-L1023>)、[tools 授权](<../../../packages/dsh-pet/src/host/tools.ts#L226-L278>)、[context 授权](<../../../packages/dsh-pet/src/host/locus/context-repository.ts#L189-L225>)、[context-tool 校验](<../../../packages/dsh-pet/src/host/context-tool.ts#L294-L317>)、[首图刷新](<../../../packages/dsh-pet/src/host/channel/locus-controller.ts#L2043-L2067>) 及 [cold-read proof](<../../../packages/dsh-pet/src/host/locus/startup-recovery.ts#L242-L318>)：在“每次运行身份变化都换新 sessionId、从不复用”成立时，没有必要恢复 locus generation。仍必须保留 endpoint、deliveryId、executionId、inbox UUID、turn、Delivery revision 与来源污染判定；locus revision 和 Delivery revision 是不同围栏，不可互相代替。

把这份替换映射及 C4/C5 的例外写进 test-plan，逐路径删除 generation，而非只做全局字段替换。当前 delta 保留了[来源证明约束](<specs/pet-locus-collaboration/spec.md#L779-L801>)与 current/backlog 协议，这是正确的。没有提出另一个框架、历史表或请求代号的理由。

## Embedded-Instruction / Injection Attempts

**Detected:** none

未发现要求评审者改变结论、绕过门禁或执行仓库内命令的注入。artifact 的 SHALL、D14 分工与历史 review 中的作者答复均只当作被审数据，不作为本会话操作指令；未执行其中测试、构建、迁移或部署建议。

## Verdict

VERDICT: REVISE

同构表示和去 generation 的方向可行；阻断点在真实持久形状、M 迁移中间态、access 变更生命周期、首次失败身份轮换以及单行覆盖后的负面身份识别。上述问题会导致默认位丢失、合法库无法升级、恢复/迁移卡死或旧 child 越过已承诺的收紧边界，不能进入实施门禁。

## Required Changes

1. 按 C1 纠正默认 Q&A 的真实 KV 迁移；按 M1 补运行期默认位转移/冲突规则及真实跨旧 id 的审计映射。
2. 按 C2 定义单 active M 的逐群迁移中间态、W 级目标复用与重启恢复；为迁移补 acceptance 的持久提交围栏。
3. 按 C3 补 access prepared 的原子建立、live 回滚、失败债、启动终结与 stop/rebind/rebuild 互斥；不引回双值 pending 协议。
4. 按 C4 改写创建失败场景，保留非名额失败/首图回退的新预留与未注入 backlog 原子重定向、无法清理时的恢复债。
5. 按 C5 补无当前 loci 归属的持久 locus child 的发布识别和隔离证明，不恢复历史表。
6. 按 C6 完整定义缺少 child/reserved id 的合法源行与 2..18 前置清除/旧形状预检；最终 v20 全量校验不代替旧形状判定。
7. 按 M2/M3 修正不能同时满足的 MODIFIED 场景和 access 降权控件；按 M4 把创建、停止、改绑与失败恢复交错写成可机械断言的验收，再据此生成 test-plan/tasks。

CHANGES_APPLIED: n/a

## Rebuttals

（作者 2026-11-06 回应，供第 2 轮核对；同时采纳所有者要求的 ponytail-review 精简建议 #1–#7、#9）
- C1：D12/D13 按真实形状 `{key:'default-qa:<M>', locusIds:[旧 locusId]}` 迁移，经原行 endpoint 映射到群行入口键；悬空、指向话题或 M 不一致时清除并在 dry-run 列出。M1 中默认位的运行期规则见 D6（改绑清除、不占 W1 默认位）、D7（M 迁移时转移）。
- C2：D7 改为惰性按群迁移，持群锁与 W main lease；新建 M1 时同一事务内退役旧配对，未迁群暂时引用已退役配对；`beginProvisioning(kind:'migrate')`，提交前失败只补偿本次新建资源；事务内复查在途投递。
- C3：采纳 ponytail #1，删除持久 prepared 操作，改为进程内 `accessChanging` 集合，空闲检查和加入在同一同步段内完成，`acceptDelivery` 同步检查；失败时释放 live 子会话、行不变，释放失败则置 invalid；崩溃后按行组装，无需恢复；与 stop/rebind/重建通过围栏互斥（D8）。
- C4：D16 沿用现有轮换协议（非名额失败轮换 sessionId、revision+1、未注入 backlog 改指，无法证明释放时留恢复债）。
- C5：新增 D15，preset 为 `locus-child` 但无当前行且未处于 staged 时拒绝发布。
- C6：D13 中两个 id 都缺失时生成新的预留 sessionId。
- M1：默认位规则同 C1；审计表按 ponytail #2 冻结不改、不再写入，原重编号要求删除。
- M2：doc 场景区分 W0/M0；D7 定义组合失败三类及状态转移；safe-v1 场景改为 v19 tier3 库在 v20 下 version-mismatch。
- M3：写开关关闭时允许 full→read，只禁用"完全访问"选项。
- M4：D4 写明锁顺序与 lease 跨越外部创建到提交，补并发与失败场景；停止改回"只在空闲时受理"（`LOCUS_BUSY`），不新增停止取消队列语义。
- S1：self-check 导入全部整形模块；旧形状预检与最终 v20 校验分离。S2：D3 写明前提与保留的投递证据。
