# Main integration status — 2026-10-25

## Prepared and verified

Main was clean and synchronized with origin/main at f6f1391bb9dbc58f70b56ef377ae8f8c682f8638 when continuation resumed. Main already contains the earlier launcher migration under rewritten commit IDs. Replayed only the follow-up repair commit1bb9de70 onto that main, producing0e51a84a; no old Pet/collaboration/routing/configuration content was restored. The sole rebase conflict was verify.md; retained both ordinary WSL follow-up and later Windows/macOS evidence. Public manifest, root package/lock and latest sidebar icon remain main's versions.

Two integration repairs are separate commits:

- f4204482 fixes repository links in8review reports and keeps installed/temp source references as plain historical path text. No review finding, verdict or test assertion was weakened.
- d886190b removes an unawaited duplicate async file write from synchronous provisioning fixture. It raced staging rename/cleanup and reproduced ENOTEMPTY in two full runs. Existing synchronous materialization and assertions remain. Focused provisioning9/9; final full root598/596pass/0fail/2existing MCP skips, bash-945. Artifacts, cross-platform-launcher strict validation and diff checks pass.

A separate read-only strict validation of add-dsh-magpie-plugin fails because its MODIFIED sidebar icon requirement lacks the two scenarios newly added to current specs. This is existing independent planning drift; no corresponding spec/requirement was silently amended for this launcher delivery.

## Controlled merge waiting (historical; completed below)

Before real fast-forward, main acquired an unrelated untracked test file packages/sidebar-session-provider-icon/test/zz-triple.test.ts. ws-merge refuses dirty main; no bypass, removal, stash or unrelated commit performed. ws/win is clean. Main remains f6f1391b; repair branch is ready for controlled fast-forward after owner resolves unrelated work. No push, archive, worktree cleanup or production restart occurred.

## Windows preparation

Native checkout remains main90de15a4 with19dirty/untracked paths. A fresh read-only byte check matches current source for18; terminal fixture differs only by a later macOS timeout diagnostic in current source. No unique PC implementation is missing here. One-shot synchronization runner (ignored baselines/sync-windows-main.mjs) has been inspected in native Windows mode only: rejects unexpected paths/bytes/head, creates backup branch and include-untracked stash, requires clean state and exact expected remote head before switching main. It has NOT executed backup/stash/switch; native source/config/runtime generations remain unchanged.

Before execution: confirm main clean and tip unchanged; controlled fast-forward and normal push (never force), then rerun Windows inspection against current bytes. Preserve backup branch/stash and ignored local config/generations; no git clean -fdx, no stale local-file replay onto updated main. Build/test only after toolchain/dependency checks; do not restart existing Host3080 or operate desktop without separate permission. Original UI acceptance remains pending, DECISION: FAIL retained.

## Completed main and Windows synchronization

After owner confirmed competing main work had ended, controlled ws-merge fast-forwarded main to20dab7db7f2896c1e2380fa04892d8da1a4e3266, normal push succeeded, ls-remote agreed (bash-973/978). No force push, archive or worktree cleanup. Current task worktree retained.

Native Windows backup/sync bash-974 verified exact19-path allowlist/bytes and oldHEAD90de15a4, created branch `backup/windows-launcher-pre-main-2026-10-25T13-38-29-620Z` and include-untracked stash54d23c2699df799bdb6fee07a3f51fde0f5c00ed. Both retained. It then switched clean main to exact origin/main20dab7db. Ignored config/caches/generations preserved; no clean -fdx or stash replay.

Windows bootstrap bash-975 found healthy locked dependencies and skipped npm ci; no root install or global bin change. Native updated root lane **97/97pass/0skip**, ordinary PATH, no real production Host restart.

Updated-manifest build first pair bash-976:build1 exit0/apply14changes (local builds, remote version drift and patch generation); build2 exit0/apply4changes (local dependency path strings for collab/sidebar-icon/auto-routing/Pet). Exact no-change assertion correctly **FAILED**. Do not call this an immediate post-upgrade idempotence PASS. Read-only inspection confirmed four expected file:D:\\ paths after second build; no code or policy weakened.

Convergence diagnostic bash-982:next build nochangePASS, doctor --check0, dump0. Stable consecutive pair bash-983:bothbuilds0/nochanges, exact second-nochangePASS; checkout clean at20dab7db, backup stash still present. This is successful converged build verification, not a retroactive repair of first-pair failure. First-pair one-extra-pass path canonicalization remains a disclosed limitation for future investigation, not silently hidden.

No existing Host3080 restarted, desktop operation, new exact script grant, archive or worktree cleanup. Windows is ready for owner manual startup/usage. Before a fresh user invocation, check normal terminal pnpm/Corepack availability: acceptance runner explicitly used existing local pnpm prefix, not a global installation.
