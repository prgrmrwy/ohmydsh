## Context

现状来自三份只读盘点（2026-11-05，inv-persistence / inv-controller / inv-management，结论汇总在本文件）和线上事故：在从未建立群级入口的话题群里，话题内 `/bind W` 额外建出了 auto W0+M0。

- **不同构的根因**：`ensureTopic` 补群时把显式 W 丢掉了，调用的是 `ensureGroupLocked(群, undefined)`（`controller.ts:784-787`），于是群挂到 auto W0、话题挂到 W，而且分两次 provisioning 提交（`provisionGroupLocked` :1113 与 `provisionChildLocus` :1183）。改绑 auto 群时只处理群行，话题留在旧 M 下（:1073-1075，测试 `locus-controller.test.ts:647`）。持久层也从不校验话题的 M 是否等于群的 M，只有内存版 repository 校验（`repository.ts:891`）。
- **字段一名多义、冗余**：
  - `parentSessionId` 在不同地方分别指 M 或 W；
  - `generation`/`replacesLocusId` 与 `locusId` 都在区分实例；
  - `childSessionId`/`reservedChildSessionId` 是同一个值的两个阶段；
  - `permission`×`toolTier` 两个字段组合出无意义的状态，加上 desired/effective 的待应用协议，非驻留撤回 shell 失败时会继续按 shell 服务；
  - `busy` 在生产路径上实际是由投递表推出来的；
  - `contextAnchor` 已不再起门控作用（ADR-0005）；
  - `childComposition` 在 v19 之后恒等于 `tier3`；
  - `source` 只服务于"/bind 能否覆盖"这一种交互。
- **管理面**：
  - 面板上的「父会话」实际是 M，不是 W（`management.ts:549`，`locus-view.ts:560`），但飞书侧判断归档时看的是 W（`index.ts:2059-2067`）。
  - 快照校验不认 `not-created`（`settings.tsx:2307`），出现这种入口时整个面板可能加载失败。
  - 现行 spec「管理面不提供新建外部资源的入口」禁止手工输入会话标识。
- **v19 刚完成**（change `pet-locus-purge-previous-model`，已归档）：持久层里只剩三层行；迁移脚本框架是"只读预检 → 持锁复查 → 备份 → 单事务"；sync 新增了 deploy check。

## Goals / Non-Goals

**Goals**
1. 同构：任何从零开始的创建都得到 W → M → {群 locus, 话题 locus}；一个群（或一篇文档）的全部 locus 在同一个 M 下，且这一点由数据结构本身保证。
2. locus 行字段每个只有一个含义，删掉冗余字段，一个入口只占一行。
3. 改绑只用于"原 W 已归档，换一个 W 接着跟进"，单事务完成，不保留上下文。
4. v20 break-change 离线迁移，复用 v19 的框架。

**Non-Goals**
- 不迁移协作空间里的条目，不提供跨会话读取历史的能力。
- 不改 DSH runtime，不改 `locus_mains` 的 W↔M 一对一。
- 不处理 ledger/inquiry 表的数据（它们只把 locusId 当字符串存着）。
- 不部署、不 push、不对线上库执行迁移。线上 `oc_bb0e` 的修复需所有者确认后再按新流程处理。

## Decisions

### D1 同构不变量与数据形状

- `loci` 一个入口一行，主键是入口身份 `endpointKey(chatId, threadId?)`。
- **群行**（没有 `threadId`）独占 `locusMainSessionId`、`workspaceId`，以及可选的 `reboundFrom`（改绑前的 W）。**话题行**不存这几个字段，需要时按 `chatId` 去群行上读。
- 结构约束：有话题行就一定有同 `chatId` 的群行。这一条在单行 schema 之外，由集合校验 `validateLocusSetForStorage` 和每个写入口检查。
- 因为话题行上根本没有 M 字段，"同群跨 M"这种数据写不出来，不需要额外加一层校验。
- 被否决的备选：每行都存 M，再用校验保证同群一致。这正是现在的做法，结果出了事故。

### D2 行字段（v20）

| 字段 | 群行 | 话题行 | 说明 |
|---|---|---|---|
| 主键 = `endpointKey` | ✓ | ✓ | |
| `locusId` | ✓ | ✓ | 实例 id。只在入口从零创建时生成；原地重建和改绑都**不换** |
| `sessionId` | ✓ | ✓ | 预留阶段和已创建阶段共用一个值；是否已创建看 `state` |
| `state` | ✓ | ✓ | `not-created` / `active` / `invalid` / `stopped` |
| `accessMode` | ✓ | ✓ | `read-only` / `danger-full-access`；可选 `verifiedAt`、`grantedBy` |
| `revision` | ✓ | ✓ | 必填，同一入口单调递增，**原地重建、改绑都不归零** |
| `createdAt` / `updatedAt` / `stoppedAt?` / `invalidReason?` | ✓ | ✓ | |
| `locusMainSessionId` | ✓ | — | |
| `workspaceId` | ✓ | — | W 的项目工作区，即项目读取的允许根 |
| `reboundFrom?` | ✓ | — | 改绑前那个已归档的 W，用于展示和首投提示 |
| `defaultQa?` | ✓ | — | 布尔，标记该群是其 M 的默认 Q&A 群；每个 M 下至多一个群行带此标记（集合不变量）。取代持久的 `default-qa` 索引（ponytail-2 #1） |

删除的字段：`id` 作主键、`generation`、`replacesLocusId`、`parentSessionId`、`parentLocusId`、`source`、`childSessionId`、`reservedChildSessionId`、`childComposition`、`busy`、`contextAnchor`、`permission`、`toolTier`、`retiredAt`、`revision` 的 optional 回退。

被否决的备选：保留 `source` 只作展示。`/bind` 是否能覆盖已经统一为拒绝，Q&A 群可以从默认 Q&A 指针识别，`source` 已经没有任何行为上的读取方。

### D3 实例匹配与并发围栏

- 投递、结算、caller-bound 工具的匹配键由 `(locusId, generation, childSessionId)` 改为 `(locusId, sessionId)`。**前提：每次运行身份变化都换新的 `sessionId`，且永不复用**（原地重建、创建失败轮换、首图降级、改绑、M 迁移，见 D7、D16）。投递自身的 deliveryId、executionId、inbox UUID、turn、Delivery revision 与来源证明保持不变；locus revision 和 Delivery revision 是两道不同的围栏（评审 S2）。
- 所有写当前行的操作都用 `{expectedLocusId, expectedRevision}` 做 CAS。管理面的围栏去掉 `expectedGeneration`/`expectedUpdatedAt`。
- 被否决的备选：每次实例变化都换 `locusId`。会牵连投递、审计、首子会话恢复债等引用，换来的隔离效果 `sessionId` 已经提供了。

### D4 从零创建：一次提交建群行和话题行

- `provisionChatLocked(chatId, chatName, explicit?, threadId?)` 取代 `provisionGroupLocked` 和"先补群再建话题"的两步。流程：`beginProvisioning(kind: 'chat')` → W = explicit ?? `createAutoWorkSession` → `ensureLocusMain(W)` → 群行 + 可选话题行 → **一次** `commitProvisioning({rows, main?})`。
- 调用方：`ensureGroup`、`ensureTopic` 在群不存在时的分支（显式 W 必须传下去）；划词评论走同一个入口。Q&A 只建群行。
- 群已存在、来源相同：话题在群行的 M 下追加一行（`addTopicRowLocked`）。不需要 `ensureLocusMain`，也不调外部，所以不需要 provisioning 操作。
- 显式来源在任何外部创建之前解析，和现在一样。
- 并发（评审 M4）：锁顺序保持 `group:<chat>` → `endpoint:<key>` → `main:<W>` lease，lease 从 `ensureLocusMain` 一直持有到 durable commit 或失败补偿结束。因此：同群两个话题同时首次 @、话题 `/bind` 与群首次 @ 同时到达，都被群锁串行，后到者看到已存在的群行，走"群已存在"分支；同一 W 的 Q&A 与首次 `/bind` 并发时，main lease 保证只建一个 M 和一个空间。提交前失败只补偿本操作新建的资源；提交后 finalize 失败沿用现有 committed-operation 恢复。
- 被否决的备选：话题无父（`pet-topic-bind-without-group`，两轮 REVISE）。

### D5 拒绝跨 M 的 `/bind`

- 群已存在，且显式 W ≠ 群行的 W 时：无论 `/bind` 发在话题里还是群本体，在加群锁后、调用 `resolveMainParent` 之前就以现有错误码 `EXPLICIT_PARENT_CONFLICT` 拒绝（ponytail #9：语义相同，只改文案），不触碰 Host。
- `control.ts` 的回执为"该群已由 <W 标签> 跟进，不能在这里改绑；原会话归档后可在管理面「改绑到其他会话」"。原文案"请先解除后再绑定"现在是错误的指引，一并替换。
- 同一个 W 的 `/bind`：入口处于 `stopped` 时重新启用（D7），否则幂等返回 reused。

### D6 改绑：仅在原 W 已归档时，由管理面操作

- 入口：管理面上群行或文档根那一行，按钮**直接放在行上**，名为「改绑到其他会话」，输入工作会话 sessionId。走通用 `locus-action` 路由，请求为 `{action:'rebind', chatId, workSessionId, expectedLocusId, expectedRevision}`，围栏用群行的值。
- Host 依次检查，首个不满足即拒绝：群行存在（`LOCUS_NOT_FOUND`）；围栏匹配（`LOCUS_CONFLICT`）；当前 W 已归档（`INVALID_REQUEST`）；目标是普通一级会话，未归档、不是子会话、不是任何 locus 主会话（`INVALID_REQUEST`）；同 `chatId` 下没有 current 投递（`LOCUS_BUSY`）。
- 执行：`beginProvisioning(kind:'rebind')`，持 W1 的 main lease；`ensureLocusMain(W1)`（没有就新建，资源记入该操作）；W1 的 active M 不可用时，先对 W1 执行 D7 的整 W 迁移，W1 其它群有 current 时 `LOCUS_BUSY`（实现阶段补充，2026-11-06）；然后调用 D17 的 `resetChat`，参数 `{toM: M1, workspaceId: W1 的工作区, reboundFrom: 原 W, clearDefaultQa: true}`。提交前任何失败只补偿本操作新建的 M1/空间。
- 不做的事：不换 `locusId`；不归档旧子会话（D15 保证它们不能再运行）；不动旧 M 和旧协作空间；不迁移协作条目；不发群消息，回执只出现在管理面；不占用 W1 的默认 Q&A。
- 被否决的备选：允许任意时候改绑；迁移协作条目；归档旧子会话或发切换通知（理由同前）。

### D7 不可用状态的处理

- `invalid`（Host 判定子会话丢失或身份无法证明）：下一条授权 @ 时原地重建，同一行换新的预留 `sessionId`，`state = not-created`，`revision + 1`，`locusId` 不变，未注入 backlog 改指新 `sessionId`（与 D16 同一机制）。
- `stopped`：停止只在入口空闲时受理，有在途投递时以 `LOCUS_BUSY` 拒绝。普通 @ 不恢复；在该入口内对**同一个 W** 重新 `/bind` 时原地重置为 `not-created` 并重新启用。群行 `stopped` 时同一 W 的 `/bind` 只重启群行；停止群行不连带话题行。
- W 已归档：入口停止服务，不改写 `state`；授权 @ 的有限次回执为"来源会话已归档，请在管理面改绑"。
- **M 不可用（被归档、删除、preset 核验失败或不在 DSH Pet 工作区），W 正常：整 W 一次迁移**（ponytail-2 #2，取代惰性按群迁移）。
  - 触发：授权 @ 到达，或某条 current 结算后派发器推进 backlog 时，发现所在群的 M 不可用且 W 未归档（后者来自先前已接受的授权 @，不会凭空触发）。
  - 两个触发并发：被 `main:<W>` lease 串行；后到者看到 M 已是可用的 M1，不再迁移。
  - 持 `main:<W>` lease，取该 W 在 `locus_mains` 中**所有配对**（active 与 retired）的 M，经 `parent-loci` 收齐这些 M 下的全部群一起迁移，不只看触发群的 M。任何一个群有 current 投递 → 本次不迁移，本条消息留在 backlog（backlog 不挡迁移，只有 current 挡）。
  - "有 current"包括已交给 runtime 的 queued / running / finishing 投递，它们同样阻止迁移和改绑。
  - 否则 `beginProvisioning(kind:'migrate')`，新建 M1（整 W 迁移永远新建，没有"复用 M1"分支），然后**一个事务**内：该 W 的 active 配对（若有）置 `retired`、M1 `active`；对上述收齐的每个群（来自该 W 的全部配对）调用 D17 的 `resetChat({toM: M1})`。事务内对每一行按 `expectedRevision` CAS，并复查没有 current 投递；不满足则整体回滚，只补偿本次新建的 M1/空间。
  - 不需要持有其它群的群锁：事务内逐行 CAS 已经保证一致（沿用现有 `commitRegeneration` 的做法）。改绑要求 W 已归档、迁移要求 W 未归档，两者互斥。
  - 已知代价：某个群有 current 时，同一 W 下其它群的新消息排在 backlog，直到那条 current 结算后由派发器推进（见下文派发顺序）。M 不可用很少见，接受这个代价。
  - 注意：部署后若线上还有建在来源工作区的旧 M，第一次 @ 就会走这条路径，所以必须真机验收。
- 组合失败**两类**（ponytail-2 #5）：
  - A：子会话丢失或身份无法证明 → `invalid`，按上面原地重建。
  - B：其它任何 `composeLocusChild`、访问策略或 runtime 能力失败 → 拒绝发布，本次投递以确定性诊断失败结算，行不改写（首次创建时按 D16 轮换 `sessionId`，`accessMode` 与 `state` 不变）。
  - M 不可用不属于组合失败，走上面的迁移。
- **派发顺序（评审 R3-C2）**：backlog 派发器在 **claim 之前**核验 M（含归档、缺失、preset 错误、不在 Pet 工作区），不能沿旧的 catch-return 静默结束。M 不可用且 W 未归档时，先走上面的整 W 迁移；迁移成功后重读入口与 backlog 的新 `sessionId`，用新关联 claim 并派发。其它群有 current 时迁移不发生，本群 backlog 保持 backlog，不先占成 current。
- **静默 backlog 的过期**（评审 R3-M3.4）：不主动唤醒，也不新增 backlog 定时器。backlog 只在下一次派发、入站触发或启动恢复时检查硬上限并过期，不承诺到点必有回执。

### D8 访问模式 accessMode

- 取值：`read-only`（沙箱 `read-only`，工具面不含 bash/skill）、`danger-full-access`（沙箱 `danger-full-access`，加 bash/skill，只接受 allowlist 成员的 @）。任何档位都不开放委派工具。
- 新建、原地重建、`stopped` 重新启用、改绑、迁移后，一律为 `read-only`。
- 命令：飞书侧统一为 `/access read|full`（短参 `-a`）；原 `/scope`、`/tools`、`-s`、`-t` 不再改变状态，回执提示改用 `/access`。
- 访问变更只对 `not-created` / `active` 行受理；`stopped` / `invalid` 行以 `INVALID_REQUEST` 拒绝，因为重新启用或原地重建本来就会重置为只读（实现阶段补充，2026-11-06）。
- **变更流程（ponytail-2 #3、#4）**：
  1. `acquireAccessChange(locusId)`：作为仓储写队列（`enqueue`）里的一个短操作，在队列内复查无未终态投递、不在 `accessChanging` 集合中，加入集合并返回当时的 `{locusId, revision}`。`acceptDelivery` 在它自己的队列回调里检查这个集合；stop、rebind、migrate、原地重建的提交也在队列内检查集合。不在整个外部操作期间占用队列。
  2. 证明 live 空闲：保留现有的 turn 边界检查（`index.ts:1038`，含 GUI/inquiry turn）。不空闲、或第 3 步释放失败，都以 `LOCUS_BUSY` 拒绝。
  3. 子会话常驻时，用真正的 `drainChildren(exact-parent)` 释放它（不是 `adapter.dispose`）。
  4. CAS 写行（`accessMode`、`grantedBy`、`revision + 1`，清空 `verifiedAt`）。
  5. `finally` 从集合中移除。
  - 任一步失败状态都是自洽的：释放失败 → 行没变、访问变更以 `LOCUS_BUSY` 拒绝（runtime 可能已释放或部分关闭，不承诺子会话仍在运行）；CAS 失败 → 行没变、子会话已释放，下次按旧行冷恢复。没有 live 应用、回读、回滚，也没有 invalid 分支。
  - 回执统一为"已更新，下次唤醒时应用并核验；核验失败将拒绝服务"。授予时不再当场核验，核验发生在下一次组装。
- 下次组装（冷恢复或首次创建，`agent/created`）按行上的值应用并回读，一致则写 `verifiedAt`；不符就拒绝发布（D7 B 类），**不回退到旧值**。首次创建也按行上的值组装（替换 `lazy-child.ts` / `child-delivery.ts` 里写死的 read/safe）。
- 全局写开关 `LOCUS_WRITE_ENABLED` 关闭时：拒绝把 `accessMode` 设为 `danger-full-access`；**允许改回 `read-only`**；已经是 `danger-full-access` 的入口，唤醒组装时拒绝发布（B 类）。管理面只禁用"完全访问"选项。
- 准入：完全访问只允许 allowlist 成员，按 `accessMode` 判断，对所有状态生效。文档入口与群共用这一规则，拒绝诊断同为 `owner-only-tier`（实现阶段补充，2026-11-06：原 doc spec 写的 `not-allowed-sender` 是沿用旧文本，与“规则与群相同”矛盾）。
- 删除 `pending-application.ts`、`resolvePendingApplication`、`switching` 状态、permission/tool-tier 两套 mutation，合并为 `access-mutation.ts`。不再写权限审计行；`locus_permission_audit` 表声明保留，旧行冻结。
- **评审 R3-C3 / R3-M1 补充**：
  - `agent/created` 发布边界（D15 的单次查找）同样检查 `accessChanging`，命中即拒绝本次发布。父 M 的 `locus_reply_child` 触发的冷恢复因此不能在 drain→CAS 窗口里按旧值发布。
  - 释放调用写明为 `drainChildren(exactLiveParent, [exactSessionId])`，只释放目标，兄弟不受影响；目标不在 resident 中时属于成功 no-op，所以 CAS 前还要确认目标 live agent 确实已退出。
  - 空闲证明 = 无未终态投递 + turn 边界空闲 + 该子会话 inbox 无待处理输入。
  - 失败只承诺"行未改，访问变更以 `LOCUS_BUSY` 拒绝"；runtime 可能已经释放或部分关闭，回执不得声称子会话仍在运行。不新增 invalid 或回滚分支。

### D9 首投提示

`not-created` 行首次创建子会话时，若该入口所属群的群行带 `reboundFrom`，首投前言追加："本群此前由另一个已归档的会话跟进，那段上下文没有迁移；可以用当前入口的历史读取工具读飞书里的讨论，其它背景请向所有者确认。"（IM 入口指 `pet_locus_chat_history`，文档入口指文档上下文工具。）`reboundFrom` 不清除，改绑后该群每次新建子会话都带这段说明。

只说明情况，不提供任何新的读取能力。原地重建不加说明（ponytail #5），`invalidReason` 只描述 `invalid` 状态。

### D10 管理面

- view：
  - 每个入口一行；
  - 增加 `work: {sessionId, title?, availability}`（W），保留 `locusMain`（M）；
  - 按 W 分组，话题按 `chatId` 嵌套在群行下；
  - 去掉「历史 N 代」、generation、contextAnchor、permission/toolTier/childComposition；
  - 增加 `accessMode`、`revision`、`reboundFrom`；
  - 「投递中」由投递表推出（保持现有行为，取代 `busy`）。
- 动作：只保留 `stop`、`access`、`rebind`，外加只读的 `view` / `defaultQa` / `todos`。删除 bind、unbind、archive、scope、tools、confirm-anchor、rebuild、replace-parent。
- 「改绑到其他会话」按钮只在群行或文档根上出现，直接放在行上。控件只在原 W 已归档时存在（W 可用或无法证明已归档时：无按钮、无原因行、无输入框）；出现后，仅有 current 投递时置灰并写明原因。
- 投递中：「投递中」徽标与访问模式、停止的置灰都按"有未终态投递"判断（停止与访问变更只在完全空闲时受理）；「改绑到其他会话」只在有 current 投递时置灰（backlog 会被 resetChat 改指）。两个口径不同是有意的。
- 写开关关闭时只禁用"完全访问"选项，"只读"仍可选。
- 筛选：恰有三个平铺选项——「在服务」（`not-created` / `active`，默认勾选）、「已停止 / 已失效」（默认不勾选）、「已归档」（默认不勾选）。工作会话 W 已归档的入口无论自身状态只计入「已归档」，所以 W 已归档的组默认隐藏，勾选「已归档」后才显示，群行写明「来源会话已归档，可改绑」，「改绑到其他会话」按钮随之出现；已归档的 W 仍显示标题。状态不在四值集合内的入口始终显示为「未知状态」，不计入任何选项（位于已归档 W 之下时计入「已归档」）。各选项计数之和等于入口总数。
- 修复快照校验不认 `not-created` 的问题（新状态集合天然包含它）。

### D11 删除的路径

- 话题单独换父会话：`replaceInheritedTopicParentLocked`。
- 只改群行的改绑：`replaceAutomaticGroupParent` / `bindExplicitGroup`。
- `replaceArchivedParent`、`resolveRebuildParent` / `allowFreshParent`。
- 整个 `carry-topics.ts`。
- `rebuildExplicit` 中按代际重建的部分，改为 D7 的原地重建。
- 切换通知债：`locus_switch_notices` 表和 `switch-notice.ts`。
- chat_bindings 退休路径（L1）：`retirement.ts`、`LegacyRetirementProbe`、`rebuildLegacyEndpoint`、`rebuildProtected`。`chat_bindings` 和 `invocation_channel` 表的声明保留只读（Pet 其它旧子系统仍然声明着它们），但 locus 侧不再读。
- `childComposition` 的持久标记：组合证明只在发布时把关（`composeLocusChild` 不通过就拒绝发布）。
- `locus_mains.generation`：保留，W 换 M 时仍然递增，不在本次删除范围内。

### D12 索引

- `endpoint-current`：删除，主键就是入口身份。
- `child-locus`：保留，键改为 `sessionId`，用于按 caller 查找。`sessionId` 全表唯一作为集合不变量，由 `validateLocusSetForStorage` 检查。
- `parent-loci`：改成 M → 群行的入口键。
- `default-qa`：**删除**，改为群行上的 `defaultQa` 标记（D2）。查找默认 Q&A = W 的 active M → `parent-loci` → 带标记的群行。整 W 迁移时标记随行走；改绑时清除。
- 不新增 `locus-id` 索引：`getLocus(locusId)` 直接扫表。

所有索引都可由行推导，由 `repairDerivedIndexes` 维护。

### D13 v20 离线迁移

沿用 v19 的脚本框架和 `lib/` 复用方式，也沿用 deploy check（self-check 需实际导入 v20 整形与旧形状预检用到的全部模块，评审 S1）。源版本 2..19：低于 19 的先执行 v19 的清除，再执行 v20 的整形。**旧形状的预检用脚本内的旧形状分析**（针对 v19 行），最后才用 v20 的 `validateLocusSetForStorage` 校验结果，不用同一个新函数冒充两个版本的证明。以下全部在同一个持锁事务内完成：

1. 拒绝条件：
   - v19 原有的：非终态投递、未完成的操作、v19 加载条件不满足；
   - 新增的：话题行没有群行；存在 `switching` / `provisioning` 状态的行；存在 `inherited` 来源的群行。
   - **话题行的 M 与其群行不一致**（v19 允许，线上只有 `oc_bb0e`）不拒绝，而是归并：话题行的 M 以群行为准，话题行原地重建（新预留 `sessionId`、`not-created`、`accessMode = read-only`；`stopped` 保持停止）。dry-run 逐条列出被归并的话题行及其原 M，所有者核对后再 `--yes`。被归并的话题失去原子会话上下文，旧子会话仍在原 M 下保留（D15 保证不能再运行）。
2. `loci`：
   - 每个入口取最新一代，改写成 v20 形状，主键换成入口键，原 `id` 作为 `locusId`；
   - `retired` 改为 `stopped`，`stoppedAt = retiredAt ?? stoppedAt ?? updatedAt`；
   - `sessionId = childSessionId ?? reservedChildSessionId`；**两者都没有时**（v19 合法的、从未创建也无预留的非 active 行，评审 C6）生成新的预留 `sessionId`（`session-<uuid>`），`state`、`locusId`、时间字段不变；
   - `accessMode`：只有 `permission.effective = write` 且 `toolTier.effective = shell` 时取 `danger-full-access`，其余一律 `read-only`；
   - `revision` 取当前值（缺失视为 0）；
   - 历史代删除。
3. `locus_deliveries`：全部保留（去重要用），去掉 `generation`，`childSessionId` 改名为 `sessionId`。
4. `locus_indexes` 全部删除（v20 所有索引可推导）。v19 的 `default-qa` 索引改写为群行标记：取 `locusIds[0]` 找到原行（可能是同入口旧代），映射到该入口保留的最新群行；它必须是群行，否则清除。不解析、不比较索引键里的 M。同一 M 下映射出多个标记时（v19 读取器本应阻止，只可能来自损坏数据）全部清除，并在 dry-run 列出。清除的指针在 dry-run 中逐条列出。
5. `locus_switch_notices`：清空（表声明删除）。`locus_operations`：清空（前提已保证全部结束）。
6. `locus_permission_audit`：**不改动**，旧行冻结（ponytail #2）。
7. 提交前用 v20 的 `validateLocusSetForStorage` 校验整个结果集合；只读预检、持锁复查、备份、单事务都同 v19。
8. `ledger_item` 的 `generation`：解析器改为可缺省，写入方不再写这个字段；不改写已有行。
9. **同 W 跨配对群归并**（评审 R3-C1）：v19 现有的 M 迁移会跳过忙或已停止的群，留下"同一 W 的唯一 active 配对已存在，而某些群的最新群行仍挂在其它 retired 配对上"的合法数据。离线迁移把这些群统一改挂到该 W 的唯一 active M，移动群的非 stopped 入口按 `resetChat` 规则重置，dry-run 逐条列出（含上下文损失说明）。归并在 `defaultQa` 映射之前完成，归并后同一 M 出现多个候选标记时全部清除并列出；stopped 群行上的标记也算候选。不能用放宽运行期"每 W 至多一个 active M"的 guard 来代替归并。同 W 没有任何 active 配对时，不归并，留给运行期整 W 迁移。

### D15 已退役的 locus 子会话不能再运行（评审 C5）

一个入口一行之后，被替换掉的旧子会话不再被任何行引用。`agent/created` 时做**一次** `child-locus` 查找，按顺序判定（ponytail-2 #7）：

0. 入口在 `accessChanging` 中，或有阻断的首次创建恢复债（publishing / compensating / needs-recovery，沿用 `hasFirstDeliveryRecoveryDebt`，评审 R3-M2）→ 拒绝发布；新的正常首创自身的 live publication 不算遗留债；
1. 找到 `active` 行且 `sessionId` 匹配 → 按该行组装；
2. 找到 `not-created` 行，且与 staged 预留的 `(sessionId, M, revision)` 精确匹配 → claim 一次，进入首次创建；
3. agent 的持久 preset 为 `locus-child`，但上面两条都不满足 → **拒绝发布**，诊断"已退役的 locus 子会话不可再运行"；会话历史仍可查看；
4. preset 不是 `locus-child` → 普通会话，放行。

现有 durable lookup 对非 active 行直接抛错（`index.ts:1015`），要改为上述判定，否则 staged 首创到不了 claim。

### D16 子会话创建失败时轮换 sessionId（评审 C4）

沿用现有的失败恢复协议（`persistence.ts:2594-2666`），只把 generation 换成 revision：

- 名额不足、且已证明没有调用官方创建：保留原预留 `sessionId`，投递保持待处理。
- 其它创建失败（可能已经消耗了这个 id，包括 `agent/created` 回读不符、发布后 API 拒绝、首图降级）：安全释放后，**原子地**预留新的 `sessionId`，`revision + 1`；失败的投递保留旧关联并结算；**未注入**的 backlog 改指新预留。无法证明释放成功时留下恢复债，拒绝再次创建。
- 首图纯文本重试复用这套机制，最多一次，deadline 和触发消息不变。**例外**：预 prompt 阶段的首图拒绝不按旧关联结算触发投递，投递的 session 关联随新预留更新（评审 R3-M3.2）。
- 这里的轮换只换首创身份（`sessionId`、`revision + 1`），**保留 `accessMode` 与 `state`**；这与 D17 的生命周期重置不同。

### D17 整群重置原语 `resetChat`（ponytail-2 #6）

改绑（D6）和整 W 迁移（D7）共用同一个事务体，spec 只写一遍：

`resetChat(chatId, {toM, workspaceId?, reboundFrom?, clearDefaultQa?})`，在调用方的事务内执行：
- 群行写入 `locusMainSessionId = toM`，以及给出的 `workspaceId`、`reboundFrom`；`clearDefaultQa` 时去掉 `defaultQa` 标记；
- 同 `chatId` 下每一条非 `stopped` 的行：新预留 `sessionId`、`state = not-created`、`accessMode = read-only`、`revision + 1`；`stopped` 的行（包括 stopped 的群行）保持 `stopped`，但 `accessMode` 重置为 `read-only`、**`revision + 1`**，旧围栏因此全部失效（评审 R3-M3.1）；
- **未注入的 backlog 改指新 `sessionId`，在事务里按当时的投递表计算**。"未注入"按真实持久形状判断：`accepted` 且处于 backlog、没有 execution / inbox / turn 证据（评审 R3-M3.3）；已交给 runtime 的 queued / running / finishing 不改指。因为 `acceptDelivery` 不拿群锁，`ensureLocusMain` 的外部创建要几秒，期间新消息可能落到旧 `sessionId` 上；
- 事务内复查该群没有 current 投递，有则整体回滚。

单入口的原地重建（D7 `invalid`）对单行做同样的生命周期重置。D16 的创建失败轮换**不是**这种重置：它只换 `sessionId`、`revision + 1`，保留 `accessMode` 与 `state`。
- 提交在**同一个 repository 写回调**内完成：读取最新行集合与投递表，逐行按 `expectedRevision` CAS，复查 current，再改指 backlog，不绕过现有 guard（评审 R3-C2）。

### D14 实施分工（agent-team）

| 阶段 | 负责人 | 写入范围 |
|---|---|---|
| 0 契约冻结 | lead | `spec.ts`、`domain.ts`、`aggregate.ts` 的类型与 schema、`wire.ts`、`LocusControllerDeps` / 仓储端口签名 |
| 1A 持久层 + 迁移 | A | `persistence.ts`、`persistence-helper.ts`、`repository.ts`、`controller-persistence-adapter.ts`、`delivery.ts`、`context-repository.ts`、`reconcile.ts`、`startup-recovery.ts`、迁移脚本 |
| 1B 控制面 + `/bind` + 装配 | B | `controller.ts`、`control.ts`、`resolution.ts`、`serviceability.ts`、`channel/locus-controller.ts`、`collab/locus-tools.ts`、`tools.ts`、`context-tool.ts`、`index.ts`（只有 B 改它）；删除 `carry-topics.ts`、`retirement.ts` |
| 1C 访问模式 + 组合 + 准入 | C | `access-mutation.ts`（新）、`composition.ts`、`policy-verification.ts`、`admission.ts`、`lazy-child.ts`、`child-delivery.ts`、`first-delivery-publication.ts`、`prepublication-staging.ts`、`context.ts`（首投前言）；删除 permission/tool-tier/pending 模块 |
| 1D 管理面 | D | `management.ts`、`routes.ts`、`client/*` |
| 2 集成 | lead | 审 diff、全套测试与 typecheck、根测试、sync 两次、verify |

各人维护各自范围的测试，跑范围内的测试；中途 typecheck 会有红的时候，由 lead 在集成阶段统一处理。

## Risks / Trade-offs

- **改绑后上下文清零**：这是有意的语义，写进 spec 和首投提示。适用前提是原 W 已归档，此时原上下文本来就已经停止服务。
- **M 不可用时整群迁移也会丢掉子会话上下文**：子会话的父会话是固定的，没有办法避免；W 和它的协作空间都保留。
- **break-change 不可回退**：回退只能恢复 v19 备份并部署旧版本，迁移之后产生的状态全部丢失。
- **管理面去掉历史**：被替换的实例在面板上看不到了，旧子会话仍留在侧栏或旧 M 下。
- **范围大**：通过 agent-team 按写入范围拆分；契约先冻结；test-plan 按归属分到各人。
- **共识可见性**：话题与群必定共享同一个 M，所以「话题可见所在群条目」这条规则天然成立。

## Migration Plan

1. 合入后执行 `dsh build`。deploy check 会验证迁移脚本可以独立运行。
2. 线上 `oc_bb0e`：迁移会把话题并到群行的 M（auto W0 的 M0）下，话题本来就是 `not-created`，没有上下文损失。迁移后由所有者确认，归档 auto W0（`session-17bd88a3`），再在管理面把群改绑到 4437f422，这一步同时作为改绑的真机验收。
3. `dsh stop` → `dsh-pet-migrate-state --dry-run` → `--yes` → `dsh`。
4. 真机验收：
   - 话题群首 `/bind`：只有一个 M，群行和话题行都在它下面；
   - 跨 M 的 `/bind` 被拒绝；
   - 归档 W 后在管理面改绑，新子会话的首投提示包含 `reboundFrom` 说明。

## Open Questions

无。
