# Shell-tier narrow port verification

## Scope and provenance

- Reference: session `session-c6978c4f-980b-4c2a-a807-ff1ede1c9d9c`, final human choice and handoff: port **shell-tier only** onto a fresh main-based Worktree Session; do not carry the roster→inquiry fix or broadly merge the old branch.
- Target review base: `20e41ea8abe9551c29a4fd579834f006b17ea8c4`.
- Source committed baseline: `ws/locus-dsh-pet-preset` at `c6cfba4672d21cc2ef942e294d2699de1bce2f83`; shell-tier was still uncommitted there.
- Recovered the exact authorized session with the installed official read-only Session export endpoint. The export contained 13,311 records, including pre-compaction history. Only complete reads and successful literal edits were used for reconstruction; truncated tool results were not treated as full source files. Raw session evidence and recovery scratch files are not retained in the repository.
- Changes are limited to Pet shell-tier source/tests, its active change and ADR, plus the applicable integration note. No edits to collaboration/inquiry implementation, Worktree Session, manifest, dependencies, or current published specs.

## Adaptation to current main

1. Preserve `LOCUS_CHILD_PRESET`, explicit child-preset capability checks and cold-restore behavior; overlay the shell-capable durable filter instead of restoring parent-derived composition.
2. Preserve `pet_locus_request_execution` in the caller-bound allowlist and existing todo dispatch/UI behavior.
3. Preserve the improved `/bind` refusal semantics and current fixture paths.
4. Carry current spec's explicit child-preset requirements and both added scenarios into the MODIFIED delta. Strict validation initially rejected their omission; corrected without changing published specs.
5. Reconcile a dispatch-object reconstruction discrepancy with the later complete reference read; do not keep stale intermediate wiring.
6. Fix a historical test edit that accidentally used an out-of-scope composition variable in the independent startup reconciliation case.
7. Resolve existing client-artifact tests through Node's actual dependency search roots. Lean managed worktrees can resolve shared installs outside the two hard-coded roots; no dependency installation/promotion was needed.
8. Whole-range review found that the source mutation seam checked only Delivery occupancy. Added explicit live-child idle proof so a GUI/inquiry turn blocks tier changes even without a current Delivery. The proof reads balanced ordinary turn boundaries and refuses unknown/open state; mutation releases its fence without applying tools. The new behavioral regression was demonstrated RED before repair and GREEN afterward.

## Verification actually run

| Check | Outcome |
| --- | --- |
| Initial shell-tier regressions on unchanged implementation | RED: absent new modules/constants/behavior, including missing restriction installation |
| Pet host/client `npm run typecheck --workspace=dsh-pet` | Passed after adaptation and idle-gate repair |
| Focused shell-tier suite | 134 passed before review repair |
| Live-child busy regression | RED before repair, GREEN afterward |
| Client/loader/mutation focused integration suite | Passed |
| Final `npm run test --workspace=dsh-pet` | 160 files passed, 3 skipped; 2859 tests passed, 43 skipped |
| Final `npm run build --workspace=dsh-pet` | Host and client build passed |
| `npm test` | 253 passed, 2 skipped, no failures |
| `npm run check:artifacts` | Passed |
| `openspec validate pet-locus-shell-tier --strict` | Passed |
| `git diff --check` | Passed |
| Scope exclusion diff (`host/collaboration`, `host/inquiry`, Worktree Session, manifest) | Empty |

Existing warnings: Vitest reports competing esbuild/oxc JSX options; tsdown reports deprecated external/noExternal options and CommonJS recommendation. These do not represent test/build failures. Skipped runtime tests are not real-host acceptance.

## Local whole-range review

Reviewed the complete current worktree delta against the target base, including new files: durable marker/tier validation; legacy safe-v1 behavior; fresh staging and cold-restore installation; restriction disposer/readback; guard scope and deliberately limited claim; management/control identity and fences; admission and dispatch-time allowlist rechecks; failure/rollback paths; UI consequences; preserving current main features.

Disposition: **pass for source port and local verification**, after correcting the live-child idle omission. This is not permission to merge/deploy and not proof of live Lark behavior.

## Explicit remaining gates

- Task 1.2: bot history-read proof inside a real read-tier child-equivalent sandbox remains unverified. The reference recorded Lark 230027; no fresh external API probe or user-credential substitution was made here.
- Task 7.2: deployment/sync twice and idempotence remain unchecked on this target. Previous source-worktree sync evidence does not certify this port.
- Task 7.3: real safe-v2 rebuild, owner-only request behavior, guard/finish flow, safe rollback and restart/cold-recovery acceptance require separately authorized deployment and a test entry.
- Task 7.4: published-spec merge and archive remain unchecked. No branch merge, commit, push, Worktree cleanup, Host restart or live DSH Home deployment occurred.
