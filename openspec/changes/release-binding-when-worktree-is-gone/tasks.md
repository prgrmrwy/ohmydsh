## 1. Reproduce Before Fixing

- [ ] 1.1 添加回归测试驱动真实事件顺序：候选未归档 → 确认 → `archiveSession` → `wsClean` → 取消归档 → 断言 `binding.state` 为 `released`。确认该测试在修复前失败，且失败原因是状态停在 `cleaned`（而非其他偶发原因）。
- [ ] 1.2 添加测试断言该卡死绑定的会话工具后果：`checkTool` 对停在 `cleaned` 的绑定拒绝的是全部工具（含 `bash` 与只读文件工具），固定"deny-all 发生在 `TOOL_CONTRACTS` 查表之前"这一事实。

## 2. Clean Writes the Archive Fact

- [ ] 2.1 给 `wsClean`（`host/maintenance.ts`）增加可选入参，表示"该源 Session 在清理时刻已归档"；不传时保持既有 `cleaned` 写入，确保 operator CLI 与 HTTP 入口行为逐字节不变。
- [ ] 2.2 修改 tombstone 写入（`maintenance.ts` 约 `:169-173`），依据该入参写 `cleaned-archived` 或 `cleaned`，不再硬编码。
- [ ] 2.3 在 `wsCleanRepository` 传入该事实：由既有 `archived` 集合与 `archivedBeforeClean` 标志共同得出，覆盖"清理前已归档"与"本次确认后归档"两条路径。
- [ ] 2.4 确认 1.1 的测试转为通过，且释放由**既有** `cleaned-archived → released` 边完成，未新增任何 reconcile 边。

## 3. Release by Worktree Existence

- [ ] 3.1 让 `recovery.ts` 的 `identityDiagnostic` 对已清理绑定同样执行托管 worktree 身份校验：移除 `:31` 对 `cleaned`/`cleaned-archived` 的短路返回，保持校验内容不变（目录存在、位于 `.worktrees/` 分配根内、分支等于任务分支、Git common dir 一致）。
- [ ] 3.2 按 design Open Questions 确定判定的落点分工（`recoverBindingSync` 决定本次是否装 guard，`reconcileSourceArchiveLifecycle` 负责把 `released` 落盘），并确保不出现"本次不装 guard 却始终不落盘"的不一致。
- [ ] 3.3 接通降级：worktree 不存在或身份无法证明时释放绑定并按普通 Session 恢复；不创建或删除任何 Git/DSH 资源，不删除 tombstone，遵守 `released` 单调性。
- [ ] 3.4 添加测试：**从未归档**且 worktree 已删除的 cleaned 记录被释放为普通会话——这是本次规范收敛的核心断言，旧行为会让它永久停在全工具拒绝。
- [ ] 3.5 添加测试：worktree 仍存在且校验通过的绑定保持既有约束不变，不被误降级。
- [ ] 3.6 添加测试：路径存在但身份不符（分支不匹配、common dir 不一致、或删除后同名重建）时判定为不存在并释放，证明未退化为 `statSync` 式判断。
- [ ] 3.7 添加测试：校验过程抛错时 fail closed 到降级，且 `released` 记录不回退。

## 4. Safety and Compatibility Coverage

- [ ] 4.1 重跑既有 `wsClean`、`wsCleanRepository`、CLI、HTTP、source-binding、archive lifecycle、guard/policy 与 bin-entrypoint 测试，证明安全门、合入证明与 Git 资源处置逻辑未变。
- [ ] 4.2 断言 operation schema 版本、wire 格式、HTTP route 契约与 CLI 参数均未改变；证明历史记录（缺少或已有 `archiveLifecycle` 标记）在读取路径上仍被正确处理。
- [ ] 4.3 确认 `dsh-pet` 零改动。
- [ ] 4.4 更新既有 spec 场景 `Reopen a cleaned historical Session` 所对应的测试：本 change 有意改变该行为，相关断言 MUST 一并改写为新语义，MUST NOT 以跳过或删除测试的方式回避。

## 5. Documentation and Verification

- [ ] 5.1 更新 `worktree-session-architecture.md` 的归档生命周期章节：说明 tombstone 承载清理时刻的归档事实，以及归属判定改由托管 worktree 是否存在决定（而非归档历史）。
- [ ] 5.2 运行 `packages/worktree-session` 的 build/typecheck/test 与仓库级 `npm test`、`npm run check:artifacts`，记录确切命令与结果。
- [ ] 5.3 运行 `openspec validate release-binding-when-worktree-is-gone --strict`，复核 diff 无范围蔓延。
- [ ] 5.4 端到端验证写入修复：走一次真实的「确认 → 归档 → 清理」收尾，确认新写入的 tombstone 直接为 `cleaned-archived`（而非 `cleaned`），随后取消归档确认会话恢复为普通会话且工具可用——即证明该路径不再产生新的卡死记录。
- [ ] 5.5 端到端验证归属判定：构造一个 worktree 已被删除、且**从未归档**的 cleaned 会话，打开它确认自动恢复为普通会话且 `bash` 可用；再确认一个 worktree 仍在的绑定会话未被误降级、其执行约束照旧。
