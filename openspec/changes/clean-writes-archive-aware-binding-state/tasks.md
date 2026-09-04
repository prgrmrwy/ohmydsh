## 1. Reproduce Before Fixing

- [ ] 1.1 添加回归测试驱动真实事件顺序：候选未归档 → 确认 → `archiveSession` → `wsClean` → 取消归档 → 断言 `binding.state` 为 `released`。确认该测试在修复前失败，且失败原因是状态停在 `cleaned`（而非其他偶发原因）。
- [ ] 1.2 添加测试断言该卡死绑定的会话工具后果：`checkTool` 对停在 `cleaned` 的绑定拒绝的是全部工具（含 `bash` 与只读文件工具），固定"deny-all 发生在 `TOOL_CONTRACTS` 查表之前"这一事实。

## 2. Clean Writes the Archive Fact

- [ ] 2.1 给 `wsClean`（`host/maintenance.ts`）增加可选入参，表示"该源 Session 在清理时刻已归档"；不传时保持既有 `cleaned` 写入，确保 operator CLI 与 HTTP 入口行为逐字节不变。
- [ ] 2.2 修改 tombstone 写入（`maintenance.ts` 约 `:169-173`），依据该入参写 `cleaned-archived` 或 `cleaned`，不再硬编码。
- [ ] 2.3 在 `wsCleanRepository` 传入该事实：由既有 `archived` 集合与 `archivedBeforeClean` 标志共同得出，覆盖"清理前已归档"与"本次确认后归档"两条路径。
- [ ] 2.4 确认 1.1 的测试转为通过，且释放由**既有** `cleaned-archived → released` 边完成，未新增任何 reconcile 边。

## 3. Migrate the Wedged Records

- [ ] 3.1 依据 design D3 确定"曾经归档"的证据形式（倾向补写显式判别字段而非时间推断），并记录该选择及其向后兼容代价；不得放宽"证明不了就不释放"。
- [ ] 3.2 在既有 reconcile 入口内实现一次性迁移：可证明曾归档且当前未归档的 `cleaned` 记录 → `released`；不新增用户可见命令，不创建或删除任何 Git/DSH 资源，不删除 tombstone。
- [ ] 3.3 添加测试：无法证明曾归档的 `cleaned` 记录保持不变，证明既有场景 `Reopen a cleaned historical Session` 未被破坏。
- [ ] 3.4 添加测试：迁移遇到已 `released` 的记录保持不变（单调性不回退）。

## 4. Safety and Compatibility Coverage

- [ ] 4.1 重跑既有 `wsClean`、`wsCleanRepository`、CLI、HTTP、source-binding、archive lifecycle、guard/policy 与 bin-entrypoint 测试，证明安全门、合入证明与 Git 资源处置逻辑未变。
- [ ] 4.2 断言 operation schema 版本、wire 格式、HTTP route 契约与 CLI 参数均未改变；若 3.1 选择了新增字段，证明旧记录在缺该字段时仍被正确处理。
- [ ] 4.3 确认 `dsh-pet` 零改动。

## 5. Documentation and Verification

- [ ] 5.1 更新 `worktree-session-architecture.md` 的归档生命周期章节：说明 tombstone 承载清理时刻的归档事实，以及为何 `released` 仍只经由 `cleaned-archived` 抵达。
- [ ] 5.2 运行 `packages/worktree-session` 的 build/typecheck/test 与仓库级 `npm test`、`npm run check:artifacts`，记录确切命令与结果。
- [ ] 5.3 运行 `openspec validate clean-writes-archive-aware-binding-state --strict`，复核 diff 无范围蔓延。
- [ ] 5.4 端到端验证：对真实卡死记录（`b7bfb1f7…` / `session-886cd908…`）确认其恢复为普通会话且 `bash` 可用。若用户已先行用"重新归档 → 取消归档"自愈，则改以一个新构造的 archive-then-clean 记录验证迁移路径，不得以自愈结果冒充迁移已验证。
