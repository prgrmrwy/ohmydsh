## Context

见 `proposal.md` 的动机。当前模型工具在 `tool.ts` 中先统一调用 `targetFor()`：只要是 Agent 调用，就把当前 `{sessionId, repoPath}` 作为 maintenance target。`maintenance.ts` 随后通过 `findBySourceSession()` 查找当前 Session 的 operation。因此普通主仓 Session 调用 `clean` 会在任何清理安全门运行前得到 `No Worktree Session binding exists`。

现有单 operation `wsClean()` 已实现仓库锁、当前/活动路径、active bound Session、phase、dirty、base ancestry、merge ancestry、schema-v2 source binding、worktree/branch 删除和 cleaned tombstone。Host 还掌握 `workspaceRegistry.archivedSessionIds`、live Session cwd 和 live Agent 列表。最小修复应复用这些能力，不改变 operation schema 或 operator CLI。

## Goals / Non-Goals

**Goals:**

- 让无 binding 的普通主仓 Session 成为模型 `ws clean` 的合法入口。
- 在同一仓库内扫描 operation，并批量处理全部已归档且通过现有安全门的候选。
- 保持逐项 fail-closed：一个候选被拒绝不导致误删，也不阻止其他独立候选完成判定。
- 让绑定 Session、非主 checkout 调用者和未归档候选获得明确诊断。

**Non-Goals:**

- 不改变 `ws status`、`ws promote` 或显式路径 `dsh-ws` CLI。
- 不支持模型指定 path、Session id 或跨仓库目标。
- 不改变 operation schema、归档生命周期、Session/Workspace 历史或依赖缓存策略。
- 不提供强制删除、自动归档或未合并分支的替代证明。

## Decisions

### 1. 仅为 `clean` 分流调用上下文

`registerWsTool()` 对 `status`/`promote` 继续使用当前 `targetFor()`。对 `clean`，Host 从 Agent Session 取得 `sessionId` 和 `cwd`：

1. 通过当前绑定查询判断调用 Session 是否已绑定；若已绑定，拒绝并提示切换到同仓库普通主仓 Session。
2. 通过 Git discovery 和 canonical path 比较证明 Session cwd 精确等于 `repoRoot`；否则拒绝。
3. 将已证明的 `repoRoot` 交给仓库级 clean coordinator，不开放模型 path 参数。

**替代方案：**让所有 maintenance action 都做仓库扫描。否决，因为会破坏 `status/promote` 的 Session-oriented 契约并扩大变更范围。

### 2. 增加薄的仓库级 coordinator，直接复用单 operation `wsClean`

在 maintenance 层增加仓库 operation 枚举与批量协调函数。它读取 `<gitCommonDir>/ws/operations/*.json`，按文件名稳定排序，并分类为：

- `cleaned`：本次成功清理；
- `refused`：未归档、记录无法解析或单 operation 安全门拒绝，附错误 code/message；
- `ignored`：已 cleaned/released 的审计历史。

对每个可解析且已归档的候选，coordinator 直接以其 worktree path 调用现有 `wsClean()`。该函数会独立获取仓库锁、重新解析目标并执行完整安全门，因此无需重构现有单项清理或引入批量事务。候选在枚举后发生变化时，单项重新解析会安全拒绝并进入汇总。

**替代方案：**拆分 `wsClean()` 并让整个批次持有一个仓库锁。否决，因为本 change 不需要全局原子性；该重构会显著扩大实现与回归范围。

### 3. 归档状态由 Host 作为受信输入传入

仓库级 coordinator 不直接读取 DSH storage；`registerWsTool()` 从 `ctx.workspaceRegistry.archivedSessionIds` 取得快照并传入，同时传入现有 live Session paths 和 active bound Session ids。每个 source binding 不在归档集合中时，该项在调用单 operation `wsClean()` 前即标记为 `refused/not-archived`。

operation 自身已经把 source Session binding 与精确 `repoRoot` 持久关联；枚举只读取当前调用仓库的 `gitCommonDir`，因此本 change 不再增加额外 Workspace membership 查询。

**替代方案：**maintenance 层解析 `~/.dsh/storages/workspace.json`。否决，因为会耦合持久格式并绕过运行中 Host 的权威状态。

### 4. 批量结果是 best-effort 汇总，不是全局事务

候选按 operation 文件名稳定排序，各自通过现有仓库锁重新验证。单项预检或 Git 删除失败记录为 refused，并继续下一项。该策略符合“清理全部安全候选”的用户意图，也避免一个脏任务长期阻塞无关已完成任务。

删除 worktree 成功但删除 branch 失败属于现有单项操作的部分失败风险。本 change 不引入新的跨资源事务格式；实现应保留 operation 未 cleaned 并返回 Git 错误，让 operator 能依据现有 metadata 诊断，绝不把失败项误报为 cleaned。

**替代方案：**任一候选失败就整批停止。否决，因为失败候选之间没有共享资源依赖，且会使批量入口退化为反复人工重试。

### 5. 保持 HTTP path clean 与 CLI 兼容

现有 `/worktree-session/api/clean` 的显式 `path`/`sessionId+repoPath` 单项 contract 和 `dsh-ws` CLI 不变。仓库批量 clean 只由模型工具直接调用 Host maintenance coordinator；如果实现需要可测试 seam，可导出内部函数，而不新增公共 HTTP route。

**替代方案：**扩展现有 HTTP route 接受 `repoPath`。否决，因为浏览器/其他调用方不需要该能力，且会扩大未经本 change 讨论的破坏性 API 面。

## Risks / Trade-offs

- [批量清理扩大一次调用的删除数量] → 仅允许无 binding 的精确主 checkout Session；每项必须已归档并通过全部既有安全门；模型不能指定路径。
- [operation 目录含损坏或未知 schema 文件] → 逐文件捕获解析错误并报告 refused，不猜测、不修复、不删除该记录对应资源。
- [归档快照与逐项清理间发生变化] → 归档集合来自同一次 Host 调用的 Registry 快照；每项仍重新运行 active Session/Agent 与 Git 安全门。归档状态并发变化的极窄窗口不用于绕过其他安全门，后续调用会按新状态重新分类。
- [单项 Git 删除可能部分完成] → 仅在 worktree 与 branch 删除均成功后写 cleaned tombstone；失败保留 operation 供诊断，不增加 force fallback。
- [主 checkout 自身有未提交修改] → 它不是清理目标；现有目标 worktree dirty 检查继续逐项执行，主仓 dirty 不作为拒绝理由。

## Migration Plan

1. 部署 package 与 Skill 文案后重启 DSH Host，使新的模型工具行为生效。
2. 既有 operation 无需迁移；schema 与目录布局不变。
3. 回滚时恢复旧 tool/maintenance 行为即可；已通过安全门清理的 operation 仍是合法 cleaned tombstone，不需要反向恢复 worktree。
