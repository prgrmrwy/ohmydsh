## 1. Regression Tests for the Merge Proof

- [x] 1.1 添加失败测试：rebase 重写 commit 后（内容已在 base ref、但非祖先），`wsClean` 判定已合入并允许后续安全门继续。夹具让 main 先前进再 cherry-pick，确保 hash 真正不同、祖先关系真正不成立。
- [x] 1.2 添加失败测试：分支存在至少一个上游无等价 patch 的 commit 时，仍按"未证明合入"拒绝，不删除任何资源。
- [x] 1.3 添加回归测试：祖先关系成立时行为与诊断逐字不变，结果标注 `ancestor`。
- [x] 1.4 添加边界测试：分支相对 base ref 无独有 commit（空差集）时判定为已合入。

## 2. Two-Tier Merge Proof

- [x] 2.1 在 `maintenance.ts` 的合入判定中保留既有 `merge-base --is-ancestor` 为第一级，命中即短路。
- [x] 2.2 第一级不成立时执行 `git cherry <baseRef> <taskBranch>`，仅当命令成功且每行均以 `-` 开头时判定为已合入。
- [x] 2.3 空输出（无独有 commit）经 `every` 判定自然为真，显式落入已合入分支；命令失败则不构成证明。
- [x] 2.4 任一行为 `+` 时保持既有拒绝文案与 `CLEAN_REFUSED` 语义。

## 3. Result Reporting

- [x] 3.1 在 `wire.ts` 增加 `MergeProof` 类型与 `CleanResult.mergeProof` 字段。
- [x] 3.2 dry-run 与实际清理报告同一依据（两处结果构造均带上 `mergeProof`）。
- [x] 3.3 添加测试：`ancestor` 与 `patch-equivalent` 两种依据分别被正确标注。

## 4. Safety Coverage

- [x] 4.1 添加测试：patch 等价成立时 dirty 门仍拒绝；base 祖先校验（分支不再从记录 base commit 长出）仍拒绝。
- [x] 4.2 判定只用 `git cherry` 与 `merge-base` 两个本地只读命令，不触碰远端分支。
- [x] 4.3 重跑既有 `wsClean`、`wsCleanRepository`、CLI、HTTP 与 bin-entrypoint 测试：25 文件 168 通过，常规 merge 工作流行为未变。

## 5. Documentation and Verification

- [x] 5.1 更新 `skills/ws/SKILL.md`：说明两级合入证明、rebase 场景，以及"内容被改动则按未合入拒绝"的保守立场，并要求读回实际所用依据。
- [x] 5.2 更新 `worktree-session-architecture.md` 的清理章节，补充两级合入证明与 `mergeProof` 字段。
- [x] 5.3 运行 typecheck 与包测试（25 文件 168 通过）；仓库级检查见下。
- [x] 5.4 运行 `openspec validate prove-merge-by-patch-equivalence --strict`，复核 diff 无范围蔓延。
- [x] 5.5 端到端验证：用户重启 Host 后，在真实 Pet 流程中对 rebase 后已落地的真实 worktree 走完确认 → 归档 → 清理，闭环成功。patch 等价证明在真实 rebase 场景下生效，worktree 与本地任务分支同时移除，operation 推进至 cleaned。
