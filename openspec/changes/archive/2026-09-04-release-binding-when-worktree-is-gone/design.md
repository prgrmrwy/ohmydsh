## Context

Worktree Session 的归档生命周期由两处独立的持久写入共同决定：

- `~/.dsh/storages/workspace.json` 的 `archivedSessionIds`（归档集，Host 所有）；
- `<gitCommonDir>/ws/operations/<id>.json` 的 `binding.state`（绑定状态，worktree-session 所有）。

`reconcileSourceArchiveLifecycle`（`host/operation.ts`）用一台单调状态机把前者的变化推进到后者，只有三条边：

```
legacy(cleaned, 无 archiveLifecycle) --current-snapshot--> cleaned-archived | released
cleaned          --archived=true --> cleaned-archived
cleaned-archived --archived=false--> released
```

`released` 只能经由 `cleaned-archived` 抵达。`policy.ts` 仅对 `state !== 'released'` 安装 guard，而 `guard.ts` 对 `state === 'cleaned'` 在查 `TOOL_CONTRACTS` **之前**就返回拒绝——因此这是一条 deny-all 分支，`bash`、`read`、`write`、`grep` 一并被拒。这解释了症状为何是"整个会话不可用"，而非仅 `bash` 被禁。

`archive-and-clean-finished-worktree` 引入的收尾编排把顺序变成了"先归档，再清理"：

1. `archiveSession()` 写归档集 → 观察者以 `archive-observed` 触发 reconcile；此时 operation 还是 `phase: 'prepared'`，状态机无边可走，**这一次归档观察被消耗且无效果**；
2. `wsClean` 随后写 tombstone，硬编码 `state: 'cleaned'` 并盖上 `archiveLifecycle: {version: 1}`；
3. 用户取消归档 → `unarchive-observed` 要求 `cleaned-archived`，实际是 `cleaned` → 空操作；
4. 此后每次 session-start 的 `current-snapshot` reconcile，也因 legacy 边要求 `archiveLifecycle === undefined` 而被那枚 v1 标记挡住。

于是 `cleaned` + `{version:1}` + 当前未归档成为一个没有出边的死角。本仓库三条真实记录构成完整对照：`c2216d5d`（清理前已归档）为 `cleaned-archived`，可正常释放；`9c664b0d` 已是 `released`；只有 `886cd908`（清理中确认归档）停在 `cleaned`。两个兄弟记录证明既有释放机制本身是好的，被绕开的只是状态写入。

约束：这是 fail-closed 安全路径，`bash` 被拒本身是设计意图（防止会话操作已删除的执行目录），不能通过放宽 guard 来"修好"。

## Goals / Non-Goals

**Goals:**

- 让"确认 → 归档 → 清理 → 取消归档"与"先归档 → 清理 → 取消归档"得到同一结果：会话恢复为普通 Session。
- 让归属判定只依赖一个与之真正相关的事实——托管 worktree 是否仍然存在且身份可证——从而使任何卡死记录在下次打开时自愈，无需一次性迁移。
- 覆盖真实事件顺序的回归测试，使该缺陷不能再次静默通过 CI。

**Non-Goals:**

- 不改变任何清理安全门、合入证明或 Git 资源处置逻辑。
- 不改变 guard 在**绑定仍然有效**时的 fail-closed 语义；本 change 只改变"该绑定是否仍然算数"的判定。
- 不改变 operation schema 版本、wire 格式、HTTP 契约或 CLI 参数。
- 不引入新的绑定状态取值；`cleaned-archived` 与 `released` 均已存在。
- 不触碰 `dsh-pet`。
- 不改变归档集的真相来源：仍由 Host 提供，维护层不自行读取。

## Decisions

### D1：在清理写入时刻确定归档状态，而不是补一条 reconcile 边

**决定**：`wsClean` 写 tombstone 时依据受信调用方传入的"该源 Session 此刻是否已归档"，写 `cleaned-archived` 或 `cleaned`。

**理由**：清理是归档与清理两件事中较晚发生的那一件，是唯一能同时看到两个事实的位置。归档观察之所以无效，正是因为它发生时 tombstone 尚不存在；与其让状态机去追一个已经错过的事件，不如让较晚的写入把当时已确定的事实一次写对。修好之后，既有的 `cleaned-archived → released` 边无需任何改动即可对该路径生效。

**备选（已否决）**：直接补一条 `cleaned + archived=false → released`。这会破坏既有场景 `Reopen a cleaned historical Session`——`cleaned` 单独一个取值无法区分"清理后从未归档"与"归档过又取消归档"，两者当前未归档状态完全相同。要安全地补这条边，就必须先持久化一个判别位；而 `cleaned-archived` 本身就是那个判别位，D1 因此更省。

### D2：归档事实由受信 Host 显式传入，维护层不推断

**决定**：给 `wsClean` 增加一个可选的"源 Session 已归档"入参，由 `wsCleanRepository` 传入（它已持有 `archivedSessionIds` 集合与 `archivedBeforeClean` 标志）。未传入时维持既有 `cleaned` 写入。

**理由**：与 `archivedSessionIds`、`activePaths` 既有的信任模型一致——归档集是 Host 的真相，维护层不得自行读取 DSH 存储。这也让 operator CLI 与 HTTP 入口自然保持现状：它们本就拒绝未归档候选，不传该入参不会产生错误的 `cleaned-archived`。

### D3：归属判定改看"worktree 还在不在"，不再看归档历史

**决定**：恢复已清理绑定时，依据托管 worktree 当前是否仍然存在且身份可被证明来决定归属——还在则保持 Worktree Session 约束，不在则释放为普通 Session。归档历史不再参与该判定。

**理由**：这是唯一与"该会话还能不能在隔离目录里执行"直接相关的事实。此前的设计试图从归档历史反推该结论，那是在重建历史而非观察现状，且必然撞上一个无法消解的歧义：`cleaned` + 当前未归档，既可能是"清理后从未归档"，也可能是"归档后又取消归档"，两者字段完全相同。改看 worktree 之后该歧义自然消失——两类记录如果 worktree 都没了，本来就该得到相同结果。

旧行为的不自洽正是本次缺陷的放大器：worktree 同样已被删除的两个会话，仅因归档历史不同，一个能恢复成普通会话、另一个永久停在全工具拒绝。归档历史与执行目录是否存在没有因果关系，以它决定归属缺乏依据。

**实现上不需要新能力**：`recovery.ts` 的 `identityDiagnostic` 已经在做完整的托管 worktree 身份校验（目录存在、位于 `.worktrees/` 分配根内、分支等于任务分支、Git common dir 一致）。它当前在 `:31` 对 `cleaned`/`cleaned-archived` 直接 `return undefined` 短路跳过。要做的是让该校验对已清理绑定同样生效，并把结果接到释放决策上。

**必须用完整校验而非 `statSync`**：仅判断路径存在，会把一个删除后又同名重建的目录误判为原托管 worktree，让会话在身份不明的目录里继续执行。既有校验已覆盖这些情形，直接复用。

**备选（已否决）**：一次性迁移 + "证明曾经归档"。实测全机处于该死角状态的存量样本为 0，且该方案需要新增判别字段或做时间推断，还带误释放风险；D3 生效后存量记录在下次打开时自然自愈，迁移无存在必要。

### D4：接受"显式屏障消失"这一取舍

**决定**：明确接受 `cleaned` 全工具拒绝这道屏障在 worktree 已删除时不再出现。

**理由**：该屏障的作用是防止用户在"以为还在隔离 worktree、其实已经没了"的会话里继续写而误伤主仓。改为自动降级后，这道显式屏障消失，转为依赖 UI 状态、运行上下文与用户自身注意。

之所以可接受：该风险在走过归档往返的那条路上**今天已经在承担**——那正是既有 spec 要求的行为且已实际运行。本次只是把同一待遇给到从未归档的会话，没有引入新的风险类别。同时降级只影响"该会话属不属于 Worktree Session"这一归属判定，**不放宽任何清理安全门**：dirty、active、in-flight、合入证明与调用路径判定全部照旧。

## Risks / Trade-offs

- **身份校验误判为"不存在"，把仍可用的 Worktree Session 降级** → 复用既有 `identityDiagnostic`，它已在活动绑定上长期运行；降级本身不删除任何资源，且 `released` 单调不回退，误判的后果是失去隔离约束而非丢失工作成果。校验抛错时按"无法证明存在"处理（fail closed 到降级），因为一个无法证明身份的目录本就不该被当作托管执行目录。
- **降级后用户在已无 worktree 的会话里误写主仓** → 见 D4：该风险在归档往返路径上今天已存在，本次未新增风险类别；缓解依赖 UI 状态与运行上下文的既有呈现。
- **`wsClean` 新增入参被调用方漏传，导致继续写 `cleaned`** → 默认值即既有行为，漏传只会退回今天的表现而不会写出错误的"已归档"。同时以测试固定 `wsCleanRepository` 这一唯一会传参的调用点。
- **归档与清理之间存在并发窗口（用户在两步之间手动取消归档）** → `wsClean` 在仓库锁内写入，且写的是"清理时刻"的事实；随后的取消归档会照常产生一次 `unarchive-observed`，由既有边处理。该窗口不会产生无出边的状态。
- **`identityDiagnostic` 引入同步 `execFileSync` 调用到 session-start 路径** → 该函数今天已在活动绑定的 session-start 上同步执行，本次只是让它对已清理绑定也执行；目录不存在时在首个 `statSync` 即返回，不会走到 Git 子进程。
- **测试仍绕过真实顺序** → 回归测试必须驱动完整序列（归档 → 清理 → 取消归档 → 断言 released 且工具不再被拒），而不是像既有测试那样直接把状态喂成 `cleaned` 再验证边。既有测试之所以漏掉，正是因为它们从已经正确的状态出发。

## Migration Plan

1. 先落 D1/D2 的写入修复，使**新**的收尾不再产生卡死记录。
2. 再落 D3 的归属判定改造：存量记录（含任何未来出现的卡死记录）在下次打开时按 worktree 是否存在自然自愈，**不需要单独的一次性迁移**。
3. 降级在既有 recovery/reconcile 入口内完成，不新增用户可见命令，不创建或删除任何 Git/DSH 资源，不删除 tombstone，且遵守 released 单调性。
4. 回滚：本 change 只做 `cleaned → released` 的单调推进且不删除 tombstone；如需回退，停用该判定即可，已释放记录按既有单调性保持 released，不产生资源泄漏。

## Open Questions

- 判定应放在哪一层：`recoverBindingSync`（session-start 同步路径，能在首次装 guard 前决定）还是 `reconcileSourceArchiveLifecycle`（持有仓库锁，能把 `released` 落盘）？倾向两者配合——前者决定本次会话是否装 guard，后者负责持久化，避免每次打开都重复校验。实现阶段确定，但 MUST NOT 出现"本次不装 guard 却始终不落盘"的不一致。
- D3 生效后，`cleaned` 与 `cleaned-archived` 在归属判定上是否还有区别？两者都要看 worktree 是否存在，差异可能仅剩审计含义。若确认无行为差异，可在后续 change 中评估简化，本次不动。
- 是否需要在降级后向用户呈现一次可见提示（说明该会话已恢复为普通会话）？倾向不需要：转换本就应当无感，且 UI 状态会自然反映。
