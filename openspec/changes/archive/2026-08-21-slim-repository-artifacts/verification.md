# Verification Record

## Repository footprint

Measured against the change base tree (`HEAD`) without rewriting Git history:

| Metric | Before | After (index) | Reduction |
| --- | ---: | ---: | ---: |
| Tracked files | 318 | 220 projected (including new policy/tests/change artifacts) | 98 (30.8%) |
| Tracked bytes | 9,219,543 | 1,269,537 projected | 7,950,006 (86.2%) |

The reduction comes primarily from raw checking evidence, duplicate architecture exports, nested lockfiles and generated package `lib/` output.

## Dependency and package verification

- Root `npm ci`: PASS; workspace lock contains all three local packages.
- `dsh-worktree-session`: typecheck PASS; 84 tests PASS; host/client build PASS.
- `dsh-sidebar-session-provider-icon`: typecheck PASS; 21 tests PASS; host/client build PASS.
- Generated host exports and both client bundle entries exist after root workspace builds.
- Root repository suite: 20 tests PASS, including clean local build, source/asset/missing-output invalidation, repeat idempotence, mixed local/remote install, build-failure-before-remove, native-JS content reinstall, state garbage collection and tracked-artifact policy.

## Artifact and documentation verification

- `npm run check:artifacts`: PASS after removals are staged.
- Main architecture asset is one self-contained, theme-aware SVG with the structured JSON source retained.
- Worktree Session architecture is maintained as Markdown/Mermaid and covers schema-v2 binding, dependency modes, lifecycle, cleanup gates and the planned cleaned-to-ordinary recovery.
- Checking raw baselines/screenshots had no reusable test-fixture consumers; retained reports record their ephemeral/external-retention status.
