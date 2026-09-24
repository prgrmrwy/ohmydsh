# ADR-0005: locus 写档 = 完全访问（显式安全决策）

- **Status**: Accepted
- **Date**: 2026-09-16
- **Relates to**: OpenSpec change `pet-locus-write-full-access`；被取代的条款：`pet-unified-locus-collaboration/design.md:266`（「不隐式映射 danger-full-access；若需更宽权限必须另作明确安全决策」）与 `:267`（「workspace-write 仍有 cwd 根限制，不能保证写入 sw 兄弟目录」）

## Context

统一 locus 的写档此前映射到 DSH 的 `workspace-write`，其边界**就是子会话的 cwd**。而子会话 cwd 在创建时被 DSH 写死为父会话 header 的 cwd（`subagent` 包的 `childSessionMeta`），会话 cwd 又不可变。实测三条事实（2026-09-16）：

- 所有者自己的工作会话是 `danger-full-access`（`permission/preset` + `sandbox/mode` 均为该值），**没有 cwd 边界**，所以 `sw` 把工作带到哪个 worktree，他就能在哪写——与「知不知道路径」无关；
- locus 子会话出生时继承了 `danger-full-access`（`source: delegation`），随后被 Pet 主动收窄为 `read-only`；提权时 apply `workspace-write` 并核验，核验失败即回滚；
- 所有者的 worktree 是**兄弟目录**（`git worktree list`：`corp/nexus`、`corp/nexus-2`、`corp/nexus-rpc`），永远落在 `corp/nexus` 这个边界之外。

结论：只要写档仍是 `workspace-write`，locus 子会话**在任何情况下都无法**在所有者实际工作的 worktree 里写入；而「可修改执行根」需要 DSH 侧新增 per-child cwd（上游 0.1.5-rc.2 / 0.1.6-alpha.1 均无此字段，须打宿主补丁 + 每次换 worktree 重建 child）。

所有者于 2026-09-16 明确选择：**write 即完全访问，单档**（"单档"），先按此简化，将来需要收紧时再加「限目录」档。

## Decision

**`write` 档直接映射到 DSH 的 `danger-full-access`。** locus 的 `read` 仍是默认，`write` 由 allowlist/所有者在空闲时显式授予，授予即代表该入口的成员共享**整机无边界**的文件写能力。

配套：

1. 写档的核验事实改为「宿主回读的 live 模式必须恰为 `danger-full-access`」；原先的「已确认执行根 == live workspace root」不再作为写授权条件（`danger-full-access` 没有有意义的 workspace root）。
2. 上下文锚点（执行根、约束、资料入口）**降级为上下文事实**：写入子会话的 prompt、管理面展示、按需读取，但不再门控提权。所有者此前遇到的「提权被执行根挡死」随之消失。
3. 管理面与飞书回执 MUST 原话说明该档的后果（整机无边界、入口成员共享），不得声称"写范围恰好等于已确认目录"。
4. 审计沿用既有 `locus_permission_audit`（同一提交写入 desired/effective/grantedBy/verifiedAt）。
5. `read` 档的既有语义与核验不变；忙时拒绝切换、应用失败不得回执成功、每次投递前重新核验 live 模式（漂移即暂停该入口）。

## Alternatives considered

- **保持 `workspace-write` + 让所有者改执行根**（需要 DSH per-child cwd 补丁）：边界精确、范围小，但每次 `sw` 换 worktree 都要重建 child（新会话、旧对话不回填），且上游无此能力、必须长期维护宿主补丁。所有者明确否决（其工作流是持续开 worktree）。
- **两档并存**（「可写(限目录)」+「完全访问」）：保留精确边界，代价是面板多一概念、每次提权要选，且仍需补丁。所有者选择先单档，留作将来收紧的选项。
- **只放宽判据为包含关系**：不改变沙箱，属自欺（沙箱仍拒绝），已否决。

## Consequences

**正面**

- locus 子会话与所有者自己的工作会话行为一致：`sw` 换到任何 worktree 都能读写，无需换会话、换绑定或重建 child。
- 不需要宿主补丁、不需要 DSH 版本升级；改动全在 Pet 侧。
- 消除「确认执行根才能提权」这一前置，提权路径只剩"闲置检查 + 应用 + 核验模式"。

**负面（已由所有者显式接受）**

- 写档生效期间，**该入口的所有成员共享整机写权限**：qa 群里任何成员 @bot 都能让它在所有者机器上写/删任意文件（含仓库之外）。沙箱在该档下不提供任何保护。
- 失去「可写范围恰好等于某目录」这一可说明性；管理面只能如实说明"完全访问"。
- 审计只记录 `read`/`write`，不记录具体沙箱模式；若将来增加第二档，需要补记录具体模式（additive schema）。

**中性**

- 现有 locus 全部为 `read`（实测 4 条记录皆为 read/read），因此本次切换无迁移影响。
- `authorization: 'unauthorized'` 字段保留但不再参与写档判定（当前无任何代码路径写入该值）；若恢复"精确边界档"，它是现成的硬拒绝入口。
