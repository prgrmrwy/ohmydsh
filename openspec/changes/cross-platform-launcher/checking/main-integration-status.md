# Main integration status — 2026-10-25

## Prepared and verified

Main was clean and synchronized with origin/main at f6f1391bb9dbc58f70b56ef377ae8f8c682f8638 when continuation resumed. Main already contains the earlier launcher migration under rewritten commit IDs. Replayed only the follow-up repair commit1bb9de70 onto that main, producing0e51a84a; no old Pet/collaboration/routing/configuration content was restored. The sole rebase conflict was verify.md; retained both ordinary WSL follow-up and later Windows/macOS evidence. Public manifest, root package/lock and latest sidebar icon remain main's versions.

Two integration repairs are separate commits:

- f4204482 fixes repository links in8review reports and keeps installed/temp source references as plain historical path text. No review finding, verdict or test assertion was weakened.
- d886190b removes an unawaited duplicate async file write from synchronous provisioning fixture. It raced staging rename/cleanup and reproduced ENOTEMPTY in two full runs. Existing synchronous materialization and assertions remain. Focused provisioning9/9; final full root598/596pass/0fail/2existing MCP skips, bash-945. Artifacts, cross-platform-launcher strict validation and diff checks pass.

A separate read-only strict validation of add-dsh-magpie-plugin fails because its MODIFIED sidebar icon requirement lacks the two scenarios newly added to current specs. This is existing independent planning drift; no corresponding spec/requirement was silently amended for this launcher delivery.

## Controlled merge waiting

Before real fast-forward, main acquired an unrelated untracked test file packages/sidebar-session-provider-icon/test/zz-triple.test.ts. ws-merge refuses dirty main; no bypass, removal, stash or unrelated commit performed. ws/win is clean. Main remains f6f1391b; repair branch is ready for controlled fast-forward after owner resolves unrelated work. No push, archive, worktree cleanup or production restart occurred.

## Windows preparation

Native checkout remains main90de15a4 with19dirty/untracked paths. A fresh read-only byte check matches current source for18; terminal fixture differs only by a later macOS timeout diagnostic in current source. No unique PC implementation is missing here. One-shot synchronization runner (ignored baselines/sync-windows-main.mjs) has been inspected in native Windows mode only: rejects unexpected paths/bytes/head, creates backup branch and include-untracked stash, requires clean state and exact expected remote head before switching main. It has NOT executed backup/stash/switch; native source/config/runtime generations remain unchanged.

Before execution: confirm main clean and tip unchanged; controlled fast-forward and normal push (never force), then rerun Windows inspection against current bytes. Preserve backup branch/stash and ignored local config/generations; no git clean -fdx, no stale local-file replay onto updated main. Build/test only after toolchain/dependency checks; do not restart existing Host3080 or operate desktop without separate permission. Original UI acceptance remains pending, DECISION: FAIL retained.
