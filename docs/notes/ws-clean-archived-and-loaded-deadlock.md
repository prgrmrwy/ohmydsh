# Backlog：已归档 + 仍加载的 Worktree Session 无法被 `ws clean` 收尾

状态：**待处理**。已在本仓库实测复现，未修复，无已知可靠绕行办法。

相关规范：`openspec/specs/source-workspace-worktree-session/spec.md`
的 `Repository cleanup processes all and only archived safe candidates`、
`Unarchived candidates are offered archive-then-clean instead of a bare refusal`
与 `Archiving is never proposed to mask an unresolved safety gate`。
实现位于 `packages/worktree-session/src/host/maintenance.ts`。

## 现象

`ws clean` 拒绝一个各项实质检查全部通过的候选：

```
reason: "Refusing to clean a worktree bound to active source Session session-74d5d367-…"
code:   CLEAN_REFUSED
```

实测证据（operation `5c0619fb-ee51-44ab-a75c-e5df534b7aa5`，
worktree `.worktrees/zhangyong-617-prgrmr-163-com`）：

| 判定 | 结果 |
| --- | --- |
| `merge-base --is-ancestor branch main` | YES（已合入） |
| `git cherry main branch` | 空（无未落地提交） |
| `git status --porcelain`（worktree） | 空（干净） |
| operation `phase` | `prepared`（无 in-flight） |
| 调用方 cwd / 全部活跃 Session cwd 在 worktree 内 | 否（两道占用门均通过） |
| 源 Session 在 `archivedSessionIds` 中 | **是（已归档）** |
| `ctx.sessions.get(id)` / `ctx.agents.get(id)` | **非 undefined（仍加载）** |

即：唯一未通过的是 `activeBoundSessionIds` 这道 active 门。

## 成因

「已归档」与「仍加载」是两个互不相干的维度，可以同时成立：

- **已归档**是持久化列表成员资格。`@deepseek-ai/dsh-workspace` 的
  `archiveSession()` 只向 `archivedSessionIds` 追加 id（其文档明确
  `its workspace accounting — or lack of one — is irrelevant`），
  **不 dispose、不 unload 任何会话**。
- **仍加载**是运行时内存事实。`ctx.sessions.get(id)` 即
  `store.get(id)?.session` 的查表，出 store 依赖 fiber unload / dispose。

`maintenance.ts` 中解开这道门的豁免是 `finishedSourceSessionId`，但它的发放
入口写在 `if (!archived.has(sourceSessionId))` 分支内，**只发给未归档候选**；
已归档候选走另一条路径且注释明确「已归档候选绝不获得豁免」。于是：

- 未归档 + 仍加载 → 有豁免，弹确认框，可收尾（既有 change 专门修的死锁）
- **已归档 + 仍加载 → 无提议、无豁免**，而归档本身又永不清除该门 → 卡死

## 这不是实现缺陷，而是规范边界

当前 spec 明确要求候选须先过「既有 active…安全门」，且把「自身源 Session 仍加载」
的豁免**限定在未归档分支**（见 `Archiving is never proposed to mask an
unresolved safety gate` 及其
`A Session may finish its own worktree while still loaded` 场景，两处均写明
「未归档候选」）。因此放宽它属于**行为变更，须走 OpenSpec change**，
不可直接改代码——这道门的字面意思是「拒绝删除仍绑着活跃会话的 worktree」，
无规范背书的放宽会被后来者当作 bug 再收紧回去。

## 绕行办法：目前没有可靠的

- GUI 中未恢复该会话页签；
- **已实测重启 DSH（进程新起 34 秒）后该候选仍被拒**。

重启后同批次的 `say-hi` / `sayhi-1` 由 `cleaned` 转为 `released`，证明新代码确已
生效，但目标候选依旧报 active。故「重启即可释放」这一推测**已被证伪**，
Host 仍持有该 session 的原因尚未查明（日志中无该 session id 的任何记录）。
下次处理应先定位究竟是什么持有它。

受影响的 worktree 保持原样即可，它是安全的（已合入、干净），不清理无数据风险。

## 处理方向（未决）

倾向于：把既有不变量的适用范围从「未归档」扩到「已归档」两个分支——已归档是
比未归档**更强**的「我完事了」信号，按现行规范意图，它本应更容易收尾而非更难。
预计改动为一条 requirement 的 MODIFIED delta（扩范围，不改判定强度）、
`maintenance.ts` 中豁免发放条件的放宽，以及一个回归测试。

`cwd === target` 与 `activePaths` 两道证明「没人站在 worktree 里」的门
**必须保持不可豁免**。

## 复发条件

「干完活 → 先归档收拾干净 → 回头再 `ws clean`」是自然顺序，而现有设计假定的是
先 clean 后归档。该顺序会再次触发，建议在下一次相关改动时一并处理。
