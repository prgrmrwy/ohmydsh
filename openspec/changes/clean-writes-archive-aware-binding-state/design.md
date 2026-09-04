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
- 修复已经卡死的历史记录，且在证据不足时保持保守。
- 覆盖真实事件顺序的回归测试，使该缺陷不能再次静默通过 CI。

**Non-Goals:**

- 不改变 guard 的 fail-closed 语义、任何清理安全门、合入证明或 Git 资源处置逻辑。
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

### D3：迁移必须证明"曾经归档"，否则不动

**决定**：一次性迁移只释放能被证明曾进入归档集的 `cleaned` 记录；证据不足时保持 `cleaned`。

**理由**：`Reopen a cleaned historical Session` 要求"清理后从未归档"的会话停在 `cleaned`。仅凭"当前未归档"就释放会把两类记录混为一谈。可用证据在实现阶段确定（如 tombstone 与归档事件的时间关系，或补写一个显式判别字段），但判定规则本身是 spec 级的：**证明不了就不释放**，这与本能力其余部分的 fail-closed 立场一致。

**注意**：用户手动"重新归档 → 取消归档"可以零代码走通现有两条边完成自愈，是迁移落地前的可用规避手段；这不能替代迁移，但可作为其正确性的一次实地对照。

## Risks / Trade-offs

- **迁移误释放了本应停在 `cleaned` 的记录** → 采取 D3 的保守判定：无法证明曾归档就不动。宁可留下个别需手动处理的记录，也不破坏既有重新打开语义。
- **`wsClean` 新增入参被调用方漏传，导致继续写 `cleaned`** → 默认值即既有行为，漏传只会退回今天的表现而不会写出错误的"已归档"。同时以测试固定 `wsCleanRepository` 这一唯一会传参的调用点。
- **归档与清理之间存在并发窗口（用户在两步之间手动取消归档）** → `wsClean` 在仓库锁内写入，且写的是"清理时刻"的事实；随后的取消归档会照常产生一次 `unarchive-observed`，由既有边处理。该窗口不会产生无出边的状态。
- **测试仍绕过真实顺序** → 回归测试必须驱动完整序列（归档 → 清理 → 取消归档 → 断言 released 且工具不再被拒），而不是像既有测试那样直接把状态喂成 `cleaned` 再验证边。既有测试之所以漏掉，正是因为它们从已经正确的状态出发。

## Migration Plan

1. 先落 D1/D2 的写入修复，使**新**的收尾不再产生卡死记录。
2. 再落 D3 的一次性迁移，处理**存量**记录（当前已知一条：`b7bfb1f7…` / `session-886cd908…`）。
3. 迁移在既有 reconcile 入口内完成，不新增用户可见命令，不创建或删除任何 Git/DSH 资源，且遵守 released 单调性。
4. 回滚：迁移只做 `cleaned → released` 的单调推进且不删除 tombstone；如需回退，停用迁移代码即可，已释放记录按既有单调性规则保持 released，不产生资源泄漏。

## Open Questions

- D3 的"曾经归档"证据具体采用哪一种（时间关系推断 vs. 在 tombstone 上补写显式判别字段）？倾向后者——显式字段可证明、不依赖推断，代价是需要一次向后兼容的字段新增；最终选择在实现阶段依据向后兼容成本确定，但不得放宽"证明不了就不释放"这一约束。
- 是否需要在迁移释放后向用户呈现一次可见提示（说明该会话已恢复为普通会话）？倾向不需要：转换本就应当无感，且 UI 状态会自然反映。
