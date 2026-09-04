## 1. Reproduce Before Fixing

- [x] 1.1 添加回归测试驱动真实事件顺序：候选未归档 → 确认 → `archiveSession` → `wsClean` → 取消归档 → 断言 `binding.state` 为 `released`。已确认修复前失败且失败原因确为状态停在 `cleaned`：`AssertionError: expected 'cleaned' to be 'released'`（`test/archive-then-clean-release.test.ts`，真实 Git fixture）。
- [x] 1.2 添加测试断言该卡死绑定的会话工具后果：`checkTool` 对停在 `cleaned` 的绑定拒绝 `bash`/`read`/`grep`/`write` 全部四类，固定"deny-all 发生在 `TOOL_CONTRACTS` 查表之前"这一事实（修复前即通过，属行为固定而非复现）。

## 2. Clean Writes the Archive Fact

- [x] 2.1 给 `wsClean` 增加可选入参 `sourceSessionArchived`；省略时保持既有 `cleaned` 写入，operator CLI 与 HTTP 入口不传该参数因而行为不变。
- [x] 2.2 tombstone 写入改为依据该入参选择 `cleaned-archived` 或 `cleaned`，不再硬编码。
- [x] 2.3 在 `wsCleanRepository` 传入 `archived.has(sourceSessionId) || archivedBeforeClean`，覆盖"清理前已归档"与"本次确认后归档"两条路径。
- [x] 2.4 1.1 已转为通过；`git diff` 证明 `host/operation.ts` 零改动，释放确由**既有** `cleaned-archived → released` 边完成，未新增任何 reconcile 边。

## 3. Release by Worktree Existence

- [x] 3.1 移除 `identityDiagnostic` 对 `cleaned`/`cleaned-archived` 的短路返回，使已清理绑定同样执行完整身份校验；校验内容本身未改动。
- [x] 3.2 落点分工：`recoverBindingSync` 新增 `worktreeGone` 信号，`index.ts` 在 session-start **同步**据此跳过 guard 安装，再异步调用新增的 `releaseMissingWorktreeBinding` 落盘。同步决定 guard、异步只负责持久化，故不会出现"本次不装 guard 却始终不落盘"。
- [x] 3.3 新增 `releaseMissingWorktreeBinding`（持仓库锁），仅对 `cleaned`/`cleaned-archived` 释放为 `released`；不创建或删除任何 Git/DSH 资源，不删除 tombstone，已 released 记录原样返回。测试另证 tombstone 的 phase/taskBranch/worktreePath 均保留。
- [x] 3.4 测试：从未归档且 worktree 已删除的 cleaned 记录被释放，且释放后 `recoverBindingSync` 不再返回该绑定（下次启动不装 guard）。已用 `git stash` 验证移除修复后该测试失败，证明其真实承载该断言。
- [x] 3.5 测试：worktree 仍存在且校验通过的绑定为 `valid: true` 且无 `worktreeGone`，未被误降级（该测试在修复前后均通过，属"不得回归"断言）。
- [x] 3.6 测试：worktree 删除后以同名重建普通目录时仍判定为 `worktreeGone`，证明未退化为 `statSync` 式判断。
- [x] 3.7 测试：释放幂等且单调（重复调用 binding 完全相同）；另补一条——**未清理**的活动绑定即使身份校验失败也 MUST NOT 经此路径释放，保持既有 fail-closed，避免把损坏绑定反而放宽为普通会话。

## 4. Safety and Compatibility Coverage

- [x] 4.1 全量重跑 `packages/worktree-session` 测试：28 文件 194 通过，涵盖 `wsClean`、`wsCleanRepository`、CLI、HTTP、source-binding、archive lifecycle、guard/policy 与 bin-entrypoint；安全门、合入证明与 Git 资源处置逻辑未变。
- [x] 4.2 `git diff` 证明 `wire.ts`、`cli.ts`、`host/http.ts` 均零改动，故 operation schema 版本、wire 格式、HTTP route 契约与 CLI 参数不变；`maintenance.test.ts` 与 `source-binding.test.ts` 中不传新入参的调用仍断言写入 `cleaned`，证明默认路径与历史记录处理未变。
- [x] 4.3 `git diff --stat -- packages/dsh-pet/` 为空，确认零改动。
- [x] 4.4 改写 `repo-clean.test.ts` 中"两个源 Session 在清理时均已归档却断言写入 `cleaned`"的断言为 `cleaned-archived`——该断言此前固化的正是本次要修复的缺陷；以改写而非跳过/删除方式处理。

## 5. Documentation and Verification

- [x] 5.1 更新 `worktree-session-architecture.md`：状态图补 `cleaned/cleanedArchived --> released : 恢复时托管 worktree 已不存在` 与"清理时已归档直接写 cleanedArchived"两条边；正文说明归属只看 worktree 是否存在、不得退化为路径判断、不依赖归档历史，以及活动绑定校验失败时含义相反须保持 fail-closed。
- [x] 5.2 `npm run build`（成功）、`npm run typecheck`（通过）、包测试 28 文件 194 通过；仓库级 `npm test` 89/89、`npm run check:artifacts` 合规；`git status` 确认构建产物 `lib/` 未被跟踪。
- [x] 5.3 `openspec validate release-binding-when-worktree-is-gone --strict` 通过；`git diff --stat` 复核无范围蔓延：仅 `maintenance.ts`、`operation.ts`、`recovery.ts`、`index.ts`、两个新测试、一处既有测试断言改写与架构文档；`dsh-pet`、`wire.ts`、`cli.ts`、`http.ts` 零改动。
- [ ] 5.4 端到端验证写入修复：走一次真实的「确认 → 归档 → 清理」收尾，确认新写入的 tombstone 直接为 `cleaned-archived`（而非 `cleaned`），随后取消归档确认会话恢复为普通会话且工具可用——即证明该路径不再产生新的卡死记录。
- [ ] 5.5 端到端验证归属判定：构造一个 worktree 已被删除、且**从未归档**的 cleaned 会话，打开它确认自动恢复为普通会话且 `bash` 可用；再确认一个 worktree 仍在的绑定会话未被误降级、其执行约束照旧。
