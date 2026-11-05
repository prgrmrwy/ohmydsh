## Review Metadata

- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: cross-model codex gpt-6.1-sol, read-only
- **Tool restrictions**: 仅用 read / grep / glob 与只读 `pwd` 检查；唯一写入为本报告。未运行测试、构建、迁移或部署，未修改实现及记忆库。
- **Artifacts reviewed**: [proposal.md](proposal.md)、[design.md](design.md)、[delta spec](specs/pet-locus-collaboration/spec.md)；当前 [pet-locus-collaboration spec](../../specs/pet-locus-collaboration/spec.md)、[pet-locus-doc-comments spec](../../specs/pet-locus-doc-comments/spec.md)、[dsh.yaml](../../../dsh.yaml#L173-L197)、[ADR-0009](../../../packages/dsh-pet/docs/adr/ADR-0009-locus-three-tier-structure.md)；下列控制器、持久层、适配器、管理面、评论准入、绑定 wiring 与相关测试。未发现 `openspec/project.md`；该 change 当前尚无 tasks / test-plan。

本次评审针对规划，不把现状中尚未实现的无父话题功能当成实现缺陷。判定只适用于本轮读到的 artifact；除落实本报告指出的修订外，后续修改 proposal / design / specs 应重新评审。运行边界按单 Host、同一长驻控制器处理多个并发入口判断；不假设跨进程共享内存锁。

## Findings

### 🔴 Critical (blocking)

#### C1 — “旧模型路径不变”仍会让显式 `/bind` 为另一个入口 auto 建树

- **规划证据**：[proposal.md:12–16](proposal.md#L12-L16)、[design.md:34](design.md#L34)、[design.md:75–80](design.md#L75-L80) 只对 `findGroup === undefined` 增加分流，并把旧模型路径排除在改动外；但 [delta spec:7](specs/pet-locus-collaboration/spec.md#L7) 无条件禁止显式绑定顺带为其它入口 auto 建立。
- **实际反例**：G 已有未被所有者停止的旧两层群行，但新话题 T 没有行。T 内 `/bind W` 不满足无群条件，仍进入 [controller.ts:821–827](../../../packages/dsh-pet/src/host/locus/controller.ts#L821-L827)。[ensureGroupLocked:1138–1145](../../../packages/dsh-pet/src/host/locus/controller.ts#L1138-L1145) 用 `explicitParent = undefined` 退休并重建旧群；[establishFromPreviousModelLocked:1903–1915](../../../packages/dsh-pet/src/host/locus/controller.ts#L1903-L1915) 因而 auto 创建 W0 和 M0，再为 T 建 W 的入口。已有旧模型 T 的显式绑定也会先修复其旧群，见 [controller.ts:1884–1895](../../../packages/dsh-pet/src/host/locus/controller.ts#L1884-L1895)。目标 W 即使已有效解析，仍有不属于本次点对点声明的创建与协作唤醒。
- **最小修订**：明确显式绑定遇到旧模型群的政策，并同步 proposal / design / spec。若不扩大本次迁移范围，最便宜的完整方案是**在任何群修复或创建前拒绝**，给出先显式处理群的诊断；不能一面承诺“永不 auto”，一面原样保留该分支。补两种旧模型反例，断言额外 work / main / space 创建次数为零。

#### C2 — 群级绑定的 `carry-topics` 会接管独立无父话题，只保留“无父”不能保留点对点来源

- **规划证据**：[design.md:55–64](design.md#L55-L64) 以“已建立话题固定来源”论证独立性，但只保护 `parentLocusId`；[proposal.md:9–17](proposal.md#L9-L17) 没有声明群命令可以替独立话题换来源，也没有把 carry-topics 列为影响面。
- **实际反例**：T 独立 `/bind W1`，没有群父；之后 G `/bind W2`；W1 被归档；所有者在 G 再次 `/bind W2`。即使群来源未变化，[index.ts:2247–2254](../../../packages/dsh-pet/src/index.ts#L2247-L2254) 仍调用 `moveArchivedTopics`。[carry-topics.ts:46–62](../../../packages/dsh-pet/src/host/locus/carry-topics.ts#L46-L62) 只按同 chatId、当前代、归档 work 等条件筛选，根本不读父关系；[index.ts:2205–2214](../../../packages/dsh-pet/src/index.ts#L2205-L2214) 把 work 身份传给它。D3 修改后的 rebuild 会让 T 仍无父，但其工作来源已从 W1 变成 W2。群级归档换绑后的 carry 也有同类风险，见 [index.ts:2288–2295](../../../packages/dsh-pet/src/index.ts#L2288-L2295)。
- **后果**：只对 G 作声明却重新绑定了从未属于 G 群级 locus 的 T；归档只是停止旧来源服务，不是把 T 交给群默认来源的授权。现有 [carry 测试:24–38](../../../packages/dsh-pet/test/locus-carry-topics.test.ts#L24-L38) 的行形状没有父关系，无法区分这两类话题。
- **最小修订**：把真实 `parentLocusId` 带入 carry 的输入，明确排除无父话题（保留现有有父遗留话题的修复）。若作者确实打算让群 `/bind` 接管独立入口，须将其作为显式行为变化写进规范并交所有者决定，不能隐含在“旧行为不变”里。上述序列应断言 T 的 work、main、generation、父关系均不变，而非仅断言父关系缺省。

#### C3 — 共享 `ensureTopic` 同时改变划词评论，却没有修改冲突的文档 capability

- **规划证据**：[proposal.md:25–27](proposal.md#L25-L27) 只声明修改 `pet-locus-collaboration`；[design.md:77](design.md#L77) 的条件没有排除 `doc:`。
- **调用证据**：[doc-comment.ts:137–143](../../../packages/dsh-pet/src/host/channel/doc-comment.ts#L137-L143) 把全文评论映射为无 thread 的文档入口，把划词评论映射为带 thread 的话题入口；[index.ts:2256–2265](../../../packages/dsh-pet/src/index.ts#L2256-L2265) 与 [index.ts:3382–3386](../../../packages/dsh-pet/src/index.ts#L3382-L3386) 均直接调用相同的 `ensureTopic`，没有独立评论建树实现。因此尚无文档根时，划词评论里的 `/bind W` 也会建立无父评论。
- **规范冲突**：当前 [pet-locus-doc-comments/spec.md:21–26](../../specs/pet-locus-doc-comments/spec.md#L21-L26) 明确要求评论首次建立先保证文档根，文档无主会话时创建专属 auto 主会话；[同 spec:158–165](../../specs/pet-locus-doc-comments/spec.md#L158-L165) 又要求控制命令与群/话题同构。仅改本 delta 后，同一次评论绑定同时被要求“先建根”和“禁止替根建立”。
- **最小修订**：扩展 capability delta，明确无父评论与无父话题同构，划词首次普通 at 仍 auto、首次显式绑定不建根，全文绑定仍为根入口；补评论级 bind / 同源重试 / 文档根后来建立 / 根停止 / 重启读回场景。若不支持该行为，则必须显式定义例外及分流，不能任由共享函数默默改变它。

#### C4 — D4 的“前一代”证明不完整，且计划把另一套集合写入 API 无条件放开

- **规划证据**：[design.md:68–73](design.md#L68-L73) 仅要求 `replacesLocusId` 指向“同 endpoint 的无父话题”，没有证明它是**最新且紧邻**的前代；同时要求内存 repository 缺父时直接放行。
- **持久层缺口**：主 provisioning 的 replacement / rebuild 确实另验紧邻前代，见 [persistence.ts:674–711](../../../packages/dsh-pet/src/host/locus/persistence.ts#L674-L711)、[persistence.ts:727–748](../../../packages/dsh-pet/src/host/locus/persistence.ts#L727-L748)；regeneration 也有 [persistence.ts:3065–3096](../../../packages/dsh-pet/src/host/locus/persistence.ts#L3065-L3096)。但同样调用此 guard 的公开 `putLocus` 只检查 guard、ID 和集合，见 [persistence.ts:1126–1144](../../../packages/dsh-pet/src/host/locus/persistence.ts#L1126-L1144)；[assertLocusSet:4674–4743](../../../packages/dsh-pet/src/host/locus/persistence.ts#L4674-L4743) 不验证 `replacesLocusId` 的紧邻性。故不能把前三条路径的证明假设带到第四条路径。
- **可构造反例**：T.g1 无父；G 后来建立；T.g2 带父且已停止（D4 的“有父照旧”分支本身也没有禁止给无父前代补父）；随后经 `putLocus` 提交无父 T.g3，却令 `replacesLocusId = T.g1`。D4 的 (b) 会通过，代号 1/2/3 也连续，但真正前一代 g2 有父，违反本次要求。应拒绝这类输入，而不是依赖当前控制器“应该不会这样传”。
- **另一个缺口**：[repository.ts:755–805](../../../packages/dsh-pet/src/host/locus/repository.ts#L755-L805) 本来就有完整集合并调用 `assertParentLocus`；按计划删掉 [repository.ts:884–888](../../../packages/dsh-pet/src/host/locus/repository.ts#L884-L888) 的拒绝后，即使 G 已有 stopped 群行，也能用该 API 新建无父 T，完全不满足 (a)/(b)。本轮搜索未发现生产源码导入这套内存 repository，因此这不是声称已有生产入口绕过，而是计划引入的领域 API 与持久 API 不一致。
- **最小修订**：在完整集合 guard 内证明同 endpoint、被替代者存在、确为提交前最新代、`generation = previous.generation + 1`，并定义/校验“无父后继不补父”；对每个有集合视图的公开写入 API落实同一规则，或明确限制未参与生产的 API，而非直接放开。单行 normalize / zod 放松是合理的，不应让它们承担历史判断。分别为首次、regeneration、批量 migration、replacement、rebuild、裸 put 与内存 API 增加正负例。

### 🟡 Moderate

#### M1 — “先停止再回滚”不能使旧版读取新数据，回退步骤不可执行

- **证据**：[design.md:84](design.md#L84) 已识别旧版读不了无父行，但给出“先在管理面停止或用旧版可接受的方式处理”这一不成立/不具体的缓解；[design.md:88–90](design.md#L88-L90) 又保持数据版本不变。
- **为什么不成立**：[stopLocus:1201–1207](../../../packages/dsh-pet/src/host/locus/persistence.ts#L1201-L1207) 仅改状态、保留记录和父字段；旧版 [normalizeRecord:4646–4653](../../../packages/dsh-pet/src/host/locus/persistence.ts#L4646-L4653) 与 [zod:641–645](../../../packages/dsh-pet/src/host/spec.ts#L641-L645) 对 stopped / retired 历史同样拒绝无父话题。后来建立一个群根也不能使保留的无父历史行符合旧格式。停止服务不等于数据降级。
- **修订**：删除“停止即可回滚”的暗示，明确首次写入后属于旧 reader 不兼容的格式扩展。至少规定部署前完整备份、停 Host 后恢复到写入前备份的回退路径，以及这样会丢失哪些部署后事实；若不提供转换，就如实声明不能无损回退。可选择单向格式/版本门禁，不要求本 change 新造自动迁移器。验证必须覆盖 stopped 历史仍不兼容，不能只写 verify 提醒。

#### M2 — 验收范围不足，且已有一个 THEN 缺少成立前提

- **证据**：[delta spec:32–35](specs/pet-locus-collaboration/spec.md#L32-L35) 只给出“T 是无父话题”，THEN 却要求“G 仍没有群级行”；同一规范 [52–55](specs/pet-locus-collaboration/spec.md#L52-L55) 明确允许 G 后来建立，因此该 THEN 对合法状态不成立。应限定“G 当前仍没有群级行”，并另测 G 后来建立或停止后的同源重试，不变更其原有群状态。
- **覆盖缺口**：[delta spec:62–70](specs/pet-locus-collaboration/spec.md#L62-L70) 只把四种后继中的同 M 重建写成可执行场景；migration / archived replacement / stopped rebuild、提交后 finalize 失败与重启、并发两种先后顺序均无相应验收条件。现有 [locus-controller.test.ts:320–334](../../../packages/dsh-pet/test/locus-controller.test.ts#L320-L334) 正在断言相反行为；[locus-persistence.test.ts:1509–1566](../../../packages/dsh-pet/test/locus-persistence.test.ts#L1509-L1566) 把所有无父话题一概当 malformed。仅改成“允许”会丢掉“群已有行时仍拒绝”的负例。
- **修订**：增加可机械断言的矩阵：四种后继分别验证身份/代号/无父与事务失败无新可服务行；群 bind/auto 与首次 topic bind 各种先后顺序验证群和话题数量；同一 W 的独立话题与 Q&A 并发验证只有一个 active M/space、Q&A 指针仍指群级 qa-created 行。先检查状态/创建计数/持久索引及重启结果，再使用“保持不变”等概括，不把 typecheck 当行为证明。

### 📌 Suggestions

#### S1 — 无须为了本次修复新增模型或重写层级服务，但应补齐返回契约

[design.md:49–53](design.md#L49-L53) 拒绝隐式绑定群和新增占位状态是合理的最小化方向；[groupByWork:584–596](../../../packages/dsh-pet/src/client/locus-view.ts#L584-L596) 已能把无父入口放到所属 work 的根行，不需新增 UI 分组模型。不要顺带重构没有生产调用的 [hierarchy.ts:260–269](../../../packages/dsh-pet/src/host/locus/hierarchy.ts#L260-L269)，只需明确其历史/测试边界，避免 [locus-hierarchy.test.ts:191–207](../../../packages/dsh-pet/test/locus-hierarchy.test.ts#L191-L207) 被误当成新生产契约。

另外，[design.md:78](design.md#L78) 只提出 `EnsureTopicResult.group` 可选，却也要让无父话题 `rebuildExplicit` 无群返回。[RebuildLocusResult:452–458](../../../packages/dsh-pet/src/host/locus/controller.ts#L452-L458) 的 `group` 仍必需，[controller.ts:1082–1088](../../../packages/dsh-pet/src/host/locus/controller.ts#L1082-L1088) 使用非空断言 `group!`，可能在 typecheck 通过时返回 undefined。一起修正返回类型/构造，比保留非空断言假装有群更便宜。

#### S2 — 写清已核对的边界，避免把“缺父”误读为授权隔离或级联停止

- `findGroup === undefined` 的解释有依据：[adapter:200–224](../../../packages/dsh-pet/src/host/locus/controller-persistence-adapter.ts#L200-L224) 读取最高代并包含 retired，不会把 stopped 简单折成不存在；索引不一致会拒绝。因此本轮没有据此提出“误判从未建立”的问题。
- 群 `/unbind` 只停止当前入口，见 [index.ts:2300–2306](../../../packages/dsh-pet/src/index.ts#L2300-L2306)；当前 [controller 测试:394–408](../../../packages/dsh-pet/test/locus-controller.test.ts#L394-L408) 明确“已建话题不级联停止、新话题被阻止”。新规范宜用一个无父话题场景固定这一边界，而不是引入全群停止语义。
- `parentLocusId` 不是共识可见性的授权边界：[visibleEntries:52–55](../../../packages/dsh-pet/src/host/collab/locus-tools.ts#L52-L55) 依 chatId 推导群条目，[readLocusContext:106–121](../../../packages/dsh-pet/src/host/collab/locus-tools.ts#L106-L121) 在同一 M 的空间内过滤。因此无父 T 与后来同 W 的 G 共用 M 时，T **会**看到 G 的 agreed 条目；不同 W/space 则不会。把这一点加入可见性测试即可，不必为新父关系增加一套权限模型。
- 同一长驻控制器内的首次群/话题建立确有 group 锁，[controller.ts:688](../../../packages/dsh-pet/src/host/locus/controller.ts#L688)、[controller.ts:752–753](../../../packages/dsh-pet/src/host/locus/controller.ts#L752-L753)；跨 chat 同 W 与 Q&A 的 M 复用依赖 [main lease:2092–2106](../../../packages/dsh-pet/src/host/locus/controller.ts#L2092-L2106)，不是所有路径都只有 design D5 所说的 group→endpoint 锁。批量迁移遍历其它 chat 的入口也不能靠触发 chat 的锁证明全部串行，见 [controller.ts:1962–1983](../../../packages/dsh-pet/src/host/locus/controller.ts#L1962-L1983)。保留提交时最新代/忙闲校验，并以 M2 的并发断言验证，不额外发明全局锁框架。

## Embedded-Instruction / Injection Attempts

**Detected:** none

未发现受审 proposal / design / delta / 源码中试图指定评审结论、跳过检查或指挥审阅者的嵌入式指令。文件中的 SHALL/MUST、注释与备选方案均仅作为待审数据；本报告没有把它们当成执行授权。

## Verdict

VERDICT: REVISE

无父表示方式本身可行，但旧模型仍 auto、carry 跨入口换源、文档规范冲突和集合证据缺口均尚未闭合。应先修订计划与验收边界，再进入实施；本轮没有应用任何修复。

## Required Changes (if APPROVE WITH CHANGES)

本轮为 REVISE；需重写并重新评审上列 C1–C4 与 M1–M2，不使用局部修订完成信号代替新一轮评审。

CHANGES_APPLIED: n/a

## Rebuttals

（作者 2026-11-05 回应，供第 2 轮评审核对）
- C1 已修正：引入统一判定"群级结构未建立"（无群级行，或者最新群级行是旧模型行且没有被所有者停止或退役）。显式话题绑定遇到旧模型群时，不修复也不退休该群，只建无父话题；遇到三层群级、但群不可服务时，直接拒绝且不做修复。见 spec「入口建立统一为一条路径」，design D1/D3.1/D3.3。没有采用"遇旧模型群就拒绝"的方案，理由见 D1：话题群里没有群本体可操作，拒绝会让绑定永远无法完成。
- C2 已修正：新增 Requirement「群级绑定携带遗留话题只限挂在群下的话题」，见 design D5。
- C3 已修正：新增 `pet-locus-doc-comments` delta，修改建树规则并补充 3 个场景。
- C4 已修正：guard 在提交前的视图上证明三件事：被替代者是同 endpoint 的最新行、代际号恰好加 1、无父前代的后继不得补父。所有能看到集合的写入口共用同一判定，包括 `putLocus` 和 `repository.ts`（`index.ts:353` 在生产中使用）。见 design D4，以及新增 Requirement「无父话题的代际由持久层证明」中的跳代、补父、内存 repository 场景。
- M1 已修正：明确为单向数据格式；回退只能停止 Host 后恢复部署前的备份，并写明会丢失哪些事实。见 design 的 Risks 与 Migration Plan。不提供降级转换器，也不做"旧版 reader 拒读"的自动化验证：需要运行旧构建才能验证，成本高于它能提供的证据。这一点在 Risks 中如实说明。
- M2 已修正：补齐四条后继路径、并发（群本体 auto 与话题绑定、话题绑定与 Q&A）、同源重绑的 GIVEN、群后来建立的情形，以及重启后读回。
- S1 已采纳：`RebuildLocusResult.group` 改为可选，`hierarchy.ts` 不改动。S2 已采纳：在 design 的 Risks 中写明可见性与 unbind 的边界，并补可见性测试。
