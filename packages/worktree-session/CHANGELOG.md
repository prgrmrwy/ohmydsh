# Changelog

## 0.1.1

- First-message official `@` references are part of the handoff payload: WS no longer refuses a draft with reference chips, the ordinary submit resolves and serializes them after binding, and the bound context maps file/folder reference paths onto the managed worktree instead of the main checkout.

## 0.1.0

- Initial Worktree Session Host and Web client bundle.
- Recoverable Git worktree, npm lean cache, local environment, status, promote and safe-clean operations.
- First-submit Worktree handoff for blank Git sessions.
