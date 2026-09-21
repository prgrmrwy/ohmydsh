# DSH 0.1.2-rc.1 Baseline

Recorded before changing the runtime pin. This report keeps summarized outcomes only; raw command output and session/history data are not committed.

## Root checks

- Node: `v24.20.0`; npm: `11.19.0`.
- `npm test`: **127 passed, 1 skipped, 0 failed** (`128` tests total).
- `npm run check:artifacts`: **passed**.

## Local package checks

Commands attempted for each TypeScript package: `npm run build && npm run typecheck && npm test`. The shim has only its Node test command.

| Package | Build | Typecheck | Test | Result / known difference |
|---|---|---|---|---|
| `dsh-memex` | pass | pass | 174 pass | baseline green |
| `dsh-pet` | pass | fail | 6 test failures in 4 suites | Existing install lacks `@deepseek-ai/dsh-client-ui-layout/client`, `@deepseek-ai/dsh-api-workspace-controller/client`, and `@deepseek-ai/dsh-storage-sqlite`; client tests also lack the installed DSW token declaration set. This is recorded as an old dependency-tree/environment gap, not accepted as migration evidence. |
| `dsh-home-network-model-guard` | pass | pass | 70 pass | baseline green |
| `dsh-session-links` | pass | pass | 54 pass | baseline green |
| `dsh-session-title-copy` | pass | pass | 20 pass | baseline green |
| `dsh-sidebar-session-provider-icon` | pass | pass | 25 pass | baseline green |
| `dsh-subscriptions-sandbox-shim` | n/a | n/a | 26 pass | Node test-only package; baseline green |
| `dsh-system-clock` | pass | pass | 21 pass | baseline green |
| `dsh-worktree-session` | fail | fail | 201 pass | Build/typecheck cannot resolve `@deepseek-ai/dsh-user-questions`; tests pass against the existing source/test environment. Generic attachment migration remains an implementation blocker. |

## Baseline interpretation

The root repository checks are green, but the installed old runtime dependency tree is incomplete for Pet and Worktree package verification. The migration must not claim those packages compatible from this baseline. After the target dependency tree is composed, rerun all affected build/typecheck/test commands and resolve or explicitly document every target-side failure. No production DSH home or current GUI was modified by these baseline commands.
