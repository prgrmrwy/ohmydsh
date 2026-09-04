## 1. Regression Tests for the Archive-then-Clean Offer

- [x] 1.1 添加失败测试：未归档但其余安全门全通过的候选，在用户确认后先归档再清理，汇总标明该候选已归档并清理。
- [x] 1.2 添加失败测试：用户拒绝、取消或无可用应答通道时，保持既有 `not-archived` 拒绝，且未调用归档、未删除任何 Git 资源。
- [x] 1.3 添加失败测试：确认信息包含源 Session id、任务分支、worktree 路径与已判定的合入/洁净状态。
- [x] 1.4 添加回归测试：已归档候选照旧直接清理，不发起任何确认。
- [x] 1.5 添加回归测试：未注入确认/归档实现时（如 CLI 路径），未归档候选保持既有拒绝语义逐字不变。

## 2. Offer Preconditions

- [x] 2.1 实现"其余安全门全通过"的前置判定：仅对未合入、dirty、非 prepared、binding 损坏、schema 不支持、活跃占用之外的候选发起确认。实现方式为复用既有 `wsClean(dryRun:true)` 作为探针，不重复实现任何安全门。
- [x] 2.2 添加测试：未合入或 dirty 的未归档候选按既有原因拒绝，且不发起确认、不归档。
- [x] 2.3 添加测试：被活跃 Session 占用或即调用方当前执行根的候选按既有原因拒绝，且不发起确认。
- [x] 2.4 添加测试：确认并归档后，清理阶段复核发现安全门不再通过时按该门拒绝，不因已归档而放行。

## 3. Maintenance Layer Orchestration

- [x] 3.1 在 `RepoCleanOptions` 增加可选的确认与归档注入项，保持 maintenance 层不直接依赖 DSH registry。
- [x] 3.2 在 `wsCleanRepository` 的 `not-archived` 分支接入：前置判定 → 确认 → 归档 → 调用既有 `wsClean`。
- [x] 3.3 扩展 `wire.ts`：新增 `RepoCleanArchiveOffer`、`CleanResult.archivedBeforeClean` 与 `archive-failed` 拒绝类型。
- [x] 3.4 保持逐候选独立：任一候选的确认、归档或清理失败不影响其余候选的判定。

## 4. Host Wiring

- [x] 4.1 在 `tool.ts` 注入真实实现：确认走 `authorize-explicit-ws-path` 建立的用户提问通道 `ctx.userQuestions`（抽出共用 `askUser`），归档走 `ctx.workspaceRegistry.archiveSession`。
- [x] 4.2 确认文案包含确切候选事实（源 Session id、任务分支、worktree 路径、已证明合入与洁净）并说明移除不可逆、归档本身可恢复；不含任何调用方特定措辞。
- [x] 4.3 确保 `dsh-ws` CLI 与 Skill shell wrapper 不注入归档能力：`wsCleanRepository` 仅有 `tool.ts` 一个调用点，CLI/HTTP 走单 operation `wsClean`，结构上无法获得归档钩子。
- [x] 4.4 添加测试：CLI 路径遇到未合入的未归档 operation 时仍按既有 merge 门拒绝，不出现归档前置或确认。

## 5. Failure Reporting

- [x] 5.1 添加测试：归档调用失败时以 `archive-failed` 报告原因，候选的 worktree、分支与 operation 保持不变，其余候选继续判定。
- [x] 5.2 添加测试：归档成功但清理被拒时，如实报告清理未完成，不汇报为已清理，且不回滚归档。
- [x] 5.3 添加测试：同一次调用中一个候选失败不阻止其他合格候选完成清理。

## 6. Documentation and Verification

- [x] 6.1 更新 `skills/ws/SKILL.md`：说明收尾退出流程（确认 → 归档 → 清理）、提议的前置条件，以及 operator CLI 的例外。
- [x] 6.2 更新 `worktree-session-architecture.md` 的清理章节，补充归档编排与既有 released 恢复路径的关系。
- [x] 6.3 运行验证：`npm run build`、`npm run typecheck`、包测试 24 文件 161 通过、仓库级 `npm test` 92/92、`npm run check:artifacts` 合规。合入主仓并重启后于主 checkout 运行 `node scripts/sync.mjs`，第二次运行报 `no changes — deployment already matches manifest`（幂等成立）。注意：在 worktree 内运行 sync 会把共享部署面指向本 worktree，而 `dsh` 启动器读主仓 manifest，两者会互相覆盖——本次已确认的部署陷阱。
- [x] 6.4 运行 `openspec validate archive-and-clean-finished-worktree --strict`（通过），复核 diff 无范围蔓延：仅 `maintenance.ts`、`tool.ts`、`wire.ts`、一个新测试与两份文档；`dsh-pet` 零改动，operation schema、HTTP route、CLI 行为、归档生命周期与历史 Session 语义均未改变。
- [ ] 6.5 端到端验证：对一个已完成、已合入的 Worktree Session 走完确认 → 归档 → 清理，并确认 design 中"归档是否使会话从 Host 卸载"这一开放问题的真实行为，据此决定是否需要补充提示或另立 change。
