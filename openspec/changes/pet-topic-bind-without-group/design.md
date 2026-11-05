## Context

三层模型下，干活主会话 W 与 locus 主会话 M 一一对应，每个入口是 M 下的一个子会话代际（`openspec/specs/pet-locus-collaboration/spec.md`，见"Locus 三层实体""入口建立统一为一条路径"）。建立话题时仍沿用两层时代（`ed2e3c31`）的层级补齐做法：`ensureTopic` 先调用 `ensureGroupLocked(群, undefined)`（`controller.ts:821`），再执行 `provisionChildLocus(..., groupResult.locus.locusId)`（`:830`）。

在两类情况下，显式话题绑定会替群做 auto：

1. 群从未建立：进入 `provisionGroupLocked`，依次调用 `createAutoWorkSession` 和 `ensureLocusMain`（`:1160-1228`）。
2. 群是旧模型：`ensureGroupLocked` 以 `explicitParent=undefined` 调用 `establishFromPreviousModelLocked`（`:1138-1145`），后者 auto 新建 W0/M0（`:1903-1915`）。旧模型话题本身的显式绑定，也会先对群执行 `repairEntryLocked`（`:1884-1895`）。

划词评论被映射为带 threadId 的入口（`host/channel/doc-comment.ts:137-143`），`/bind` 与管理面绑定都直接调用 `ensureTopic`（`index.ts:2256-2265`、`:3382-3386`），所以文档评论与群话题完全同路。

"话题必须有群级父入口"这一点，目前在以下位置写死：
- `host/spec.ts:641`（zod）
- `locus/aggregate.ts:403`
- `locus/repository.ts:884`（`assertParentLocus`；`index.ts:353` 生产使用）
- `locus/persistence.ts:4409/4435/4448`（提交形状）、`:4495`（`assertNewTopicParent`）、`:4649`（`normalizeRecord`）
- `controller.ts:766/773`（已存在分支的 `requireGroup`）、`:1022-1030`（`rebuildExplicit`）
- `RebuildLocusResult.group` 必填（`:452-458`），且 `:1083` 有非空断言

已经允许话题无父的部分：
- 管理面 `client/locus-view.ts:584-596`：父缺失或跨父时作为根行。
- `repairEntryLocked`（`:1791`）、`regenerateUnderSameMainLocked`（`:1853`）、`migrateLocusMainLocked`（`:2009-2019`）：父可选或原样保留。

carry 只按 chatId、当前代与归档来筛选话题（`carry-topics.ts:46-52`），不看父关系。调用方有两处：同源群 `/bind` 重试（`index.ts:2247-2254`）和群级归档换绑（`:2288-2295`）。

## Goals / Non-Goals

**Goals：**
- 显式绑定（群话题与划词评论）只作用于发出命令的入口。不为其它入口创建或修复会话、协作空间、群级行，也不退休旧模型行。
- 无父话题由持久层在提交前可证明的条件下接受，其余情况 fail closed；四条后继路径都保持无父。
- 群级 carry 不接管无父话题。

**Non-Goals：**
- 普通授权 at 的 auto 与旧模型退休行为不变。群级结构未建立时，未绑定话题的首个 at 仍会先建群级。
- 不新增状态，不升级持久层版本，不迁移已有行。
- 不重写未接入生产的 `locus/hierarchy.ts`。
- 不改 `/bind` 回执文案。
- 不清理现场遗留数据，不部署，不重启。

## Decisions

### D1 统一判定"群级结构未建立"

controller 与持久层使用同一定义：最新群级行不存在；或者最新群级行属于旧模型，且不是所有者停止或退役的行。
- 旧模型的判定方式：controller 用现有的 `previousModelRow({chatId})`（`:1820-1824`），即父会话没有 `locus_mains` 记录且不是 owner exit。持久层在提交事务内用 `getLocusMain(latest.parentSessionId) === undefined` 加 `isOwnerExit` 判定。
- 群级已按三层建立时：
  - 可服务（`active`/`not-created`）：话题照常挂在其下；
  - 其它状态：话题显式绑定以 `GROUP_UNAVAILABLE` 拒绝。不调用 `repairEntryLocked`、迁移或换代，也不创建任何会话。

备选方案与否决理由：
- 遇到旧模型群直接拒绝（评审建议的最便宜方案）。否决：话题群没有"群本体"可以操作，所有者没法先处理群，等于永久卡住。
- 显式话题绑定时顺带修复三层群。否决：修复可能新建 locus 主会话或迁移其它入口，超出点对点声明的范围。

### D2 无父话题，而不是隐式绑群或建群占位行

- 备选 A：同一次 `/bind` 把群级也挂到 W。否决：这是没人要求的群绑定，之后新话题会默认继承 W。
- 备选 B：新增"群级占位"状态。否决：需要引入新的枚举、投影和迁移。
- 选定：话题行省略 `parentLocusId`。类型上该字段本来就是可选的，客户端也已经能处理。

### D3 controller 改动

1. `ensureTopic` 新话题分支：先解析显式来源，任何创建都在这一步之后。如果有显式来源且群级结构未建立，调用 `provisionChildLocus('topic', ..., parentLocusId: undefined)`，返回值不带 `group`，`groupCreated: false`。如果有显式来源且群为三层，读取群而不修复：可服务就挂其下，否则拒绝。没有显式来源时，维持现有的 auto 流程。
2. `ensureTopic` 已存在分支：`requireGroup` 改为 `findGroup`；`EnsureTopicResult.group` 改为可选。
3. `establishFromPreviousModelLocked` 的话题分支：
   - 当 `explicitWork` 存在、且群级结构未建立时，不修复群，后继不带父；
   - 当 `explicitWork` 存在、且群为三层时，按上面第 1 条处理，不调用 `repairEntryLocked`。
   - 无 `explicitWork` 的 auto 路径不变。
4. `rebuildExplicit` 的话题分支：
   - 前代无父时，不要求群，后继无父；
   - 前代有父时，维持现有逻辑：要求三层群可服务。如果群级结构未建立（例如旧模型话题），后继无父。
   - `RebuildLocusResult.group` 改为可选，去掉 `group!`。
5. `replaceInheritedTopicParentLocked`：只有前代有父时才取 `currentGroup` 作为父；前代无父时，后继保持无父。
6. `regenerateUnderSameMainLocked` 与 `migrateLocusMainLocked` 已经原样保留父字段，只补测试。

### D4 持久层：在提交前的集合上证明

`assertNewTopicParent(before, record, ctx)` 只对话题行生效：
- 有 `parentLocusId`：执行原有父级校验；另外，如果被替代者无父，则拒绝（禁止补父）。
- 无 `parentLocusId` 且无 `replacesLocusId`：该 endpoint 在 `before` 中没有任何行，且 `ctx.groupUnestablished(chatId)` 成立。
- 无 `parentLocusId` 且有 `replacesLocusId`：被替代者在 `before` 中存在、属于同一 endpoint、是 `before` 中该 endpoint 的最新行，且 `record.generation === previous.generation + 1`；同时满足以下两者之一：前代无父，或 `ctx.groupUnestablished(chatId)`。

调用点：
- 首次、replacement、rebuild 的提交（`:631`）
- `putLocus`（`:1130`）
- `:1315`、`:1379`
- regeneration（`:3096`）

regeneration 当前把 `after` 传给 guard。这里改为传入提交前的集合；批量迁移的多个条目都对照同一个 `before` 判定。`ctx.groupUnestablished` 由持久层实例提供，在同一事务视图内读取 `locus_mains`。`assertProvisioningCommitForm` 的 topic/replacement/rebuild 分支删除"话题必须带父"这一条，改由 guard 判定。

`repository.ts` 的 `assertParentLocus` 是另一份生产集合写入口，用同一个判定函数实现（共享一个纯函数，入参为集合视图、记录和判定上下文）。单行的 `normalizeRecord`、`aggregate`、zod 只保留"群级行不得带父"。

备选：在各层都做判定。否决：单行层看不到集合和历史。

### D5 carry 只携带有父话题

`carryArchivedTopics` 的行形状增加 `parentLocusId`，筛选条件加上 `row.parentLocusId !== undefined`。`index.ts` 的 `listLoci` 映射保留这个字段。无父话题不计入已携带或跳过的数量。

### D6 并发

- 同一群内，群本体 auto 与话题显式绑定都持有 `group:${chatId}` 锁，因此是串行的；结果取决于先后顺序，在 spec 中有对应场景。
- 跨群或 Q&A 共用同一个 W 时，由 main lease（`:2092-2106`）保证只有一个 M。
- 跨 chat 的批量迁移不依赖触发群的锁，正确性由持久层的"最新代"与"忙闲"校验保证。
- 不新增全局锁。

## Risks / Trade-offs

- [单向数据格式] 写入第一条无父话题后，旧版 `normalizeRecord`/zod 会拒绝该行，与行状态无关；停止入口不会删掉这条行（`persistence.ts:1201-1207`）。→ 见 Migration Plan，回退只能恢复备份。不提供降级转换器。
- [同群分属不同来源] 无父话题与之后建立的群级入口可能分属不同的 W，这符合点对点意图，管理面也按父会话分开呈现。
- [共识可见性] `visibleEntries` 按 chatId 推导（`collab/locus-tools.ts:52-55`），并且只在同一 M 的空间内过滤。所以如果之后的群级入口也属于同一个 W，无父话题可以看到群条目；属于不同 W 时则看不到。这不是新的授权边界，会补可见性测试。
- [群 `/unbind`] 只停止群级当前入口，不级联停止已有话题。这是现有行为，本次不变。

## Migration Plan

1. 部署前停止 Host，或在 Host 空闲时，复制 `~/.dsh/plugins/dsh-pet/state.sqlite`（及 `-journal`）作为回退点。
2. `dsh build` 部署，由所有者决定是否重启。持久层版本不变，已有行不迁移。
3. 回退：停止 Host，恢复第 1 步的备份，再部署旧版本。回退点之后产生的所有 Pet 状态（入口、Delivery、权限变更）都会丢失。如果还没有写入任何无父话题，可以直接回退代码而不恢复备份。
4. 现场遗留数据（`session-17bd88a3`、`session-1a300190`、群 `oc_bb0e9199…` 的 `not-created` 群级行）在部署后经所有者确认再处理。

## Open Questions

无。
