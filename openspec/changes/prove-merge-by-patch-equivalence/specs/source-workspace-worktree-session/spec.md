## ADDED Requirements

### Requirement: Merge proof accepts patch equivalence after a rebase
系统 SHALL 在证明任务分支已合入时接受两种独立依据：普通 Git 祖先关系（任务分支 head 是 base ref 的祖先），或**全量 patch 等价**（该分支相对 base ref 的每一个 commit，在上游都存在 patch-id 等价的 commit）。任一依据成立即 SHALL 视为已证明合入。两种依据均不成立时，系统 MUST 保持既有拒绝语义，不得清理任何资源。

patch 等价之所以必要：rebase 会重写 commit hash，使已经落地的工作不再是上游的祖先。此时仅凭祖先关系判定会把"内容已在主干"误判为"未合入"，导致已完成的 worktree 永远无法清理。

#### Scenario: Ancestor relationship still proves merge
- **WHEN** 任务分支 head 是 base ref 的祖先
- **THEN** 系统 SHALL 判定已合入，无需再做 patch 等价判定

#### Scenario: Rebase rewrote the commits but every patch exists upstream
- **WHEN** 任务分支不是 base ref 的祖先，但其相对 base ref 的每个 commit 在上游都有 patch-id 等价的 commit
- **THEN** 系统 SHALL 判定已合入，并允许后续安全门继续评估该候选

#### Scenario: Any commit without an upstream equivalent refuses
- **WHEN** 任务分支存在至少一个在上游没有 patch-id 等价物的 commit
- **THEN** 系统 SHALL 按既有"未证明合入"拒绝该候选，MUST NOT 删除其 worktree 或分支

#### Scenario: A branch with no commits of its own
- **WHEN** 任务分支相对 base ref 没有任何独有 commit
- **THEN** 系统 SHALL 判定已合入（没有任何未落地的工作），与祖先关系判定结论一致

### Requirement: The clean result states which merge proof was used
清理结果 SHALL 标明该候选的合入判定所依据的是祖先关系还是 patch 等价，使"为何判定为已合入"可被复核。dry-run 与实际清理 MUST 报告同一依据。

#### Scenario: Result distinguishes the two proofs
- **WHEN** 一个候选分别以祖先关系、以 patch 等价被判定为已合入
- **THEN** 两次结果 SHALL 分别标明其所用依据，且 MUST NOT 以同一表述掩盖差异
