## Why

`ws clean` 用 `git merge-base --is-ancestor <taskHead> <baseTip>` 证明任务分支已合入。该证明只认**祖先关系**，因此在 rebase 工作流下会对已经落地的工作给出错误结论。

真实案例（2026-09-04，本仓库）：`ws/pet-send-cr-send-cr-skill-map-workspace` 的全部内容都已在 `main` 中，但用户 rebase 主干后这些 commit 被重写成新 hash，原 commit 不再是 `main` 的祖先。`ws clean` 因此报 `Task branch … is not proven merged into main` 并拒绝清理——工作已经完成、代码已经在主干，worktree 却清不掉。

`git cherry <upstream> <branch>` 按 patch-id 判定等价，正是为这种情况设计：本仓库实测中，该分支每个 commit 都返回 `-`（上游已有等价 patch），而真正缺失的 commit 返回 `+`。它能在不放松安全性的前提下补上 rebase 场景的证明能力。

## What Changes

- 合入证明扩展为两级：先用既有 `merge-base --is-ancestor` 判定；不成立时，再用 `git cherry` 判定该分支是否**每个** commit 都在上游有等价 patch（全部为 `-`）。两者任一成立即视为已合入。
- 任一 commit 返回 `+`（上游无等价 patch）时，保持现有拒绝语义与诊断，绝不清理。
- 清理结果与诊断中标明合入证明的依据（祖先关系 / patch 等价），使"为何判定为已合入"可复核。
- 不改变其余安全门（dirty、active、in-flight、归档、schema、base 祖先校验）、operation schema、CLI 与 HTTP 契约。

## Capabilities

### New Capabilities

- （无）

### Modified Capabilities

- `source-workspace-worktree-session`: 合入证明从"仅祖先关系"扩展为"祖先关系或全量 patch 等价"，并要求结果标明所用依据。

## Impact

- `packages/worktree-session/src/host/maintenance.ts`：`wsClean` 的 merge ancestry 判定增加 patch 等价回退分支。
- `packages/worktree-session/src/wire.ts`：`CleanResult` 增加合入证明依据字段。
- `packages/worktree-session/test/`：覆盖祖先成立、rebase 后仅 patch 等价成立、存在未合入 commit 时拒绝，以及空分支等边界。
- `skills/ws/SKILL.md` 与架构文档：说明 rebase 后仍可安全清理的条件。
- 不改变 operation schema、归档生命周期、远端分支与共享缓存策略。
