# Implementation log — sync-build-inputs-dirs

## Scope and implementation

2026-10-17, approved planning round 2 (`VERDICT: APPROVE`). Modified only [sync implementation](../../../scripts/sync.mjs), added [directory tests](../../../tests/sync-build-inputs-dirs.test.mjs), and this log. No manifest/dependency/spec/ledger edits, production sync, consumer implementation, commit, merge, archive, worktree cleanup or memory write. Tests use throwaway fixtures and explicit isolated DSH_HOME/fake CLI; new fixtures verify their temporary root before teardown. Root `npm test` belongs to the parent agent.

- buildInputs alone use `file-or-dir` preflight, preserving strict file/dir paths and realpath containment before home writes. FIFO/socket/missing/escaping paths fail closed.
- Directory hashing calls `collectFiles(absolute)` unchanged, prefixes `repo-dir:<input>\0`, sorts owning-root-relative filenames, then adds filename NUL and bytes. Empty, duplicate, overlap and symlink semantics follow approved design. Existing file/self selection and encoding remain unchanged.
- No change to needsBuild, generation evidence, deployment refresh or collector. Fixture consumer directly reads current external source; declares src and package.json (no unused tsconfig/build-config inputs).

## TDD evidence (exact commands; all run in the managed worktree root)

All test commands below start with `DSH_LOCAL_MANIFEST=/nonexistent/ohmydsh-test-isolation/dsh.yaml.local`.

1. Baseline: `DSH_LOCAL_MANIFEST=/nonexistent/ohmydsh-test-isolation/dsh.yaml.local node --test tests/sync-local-manifest-overlay.test.mjs tests/sync-overlay-root.test.mjs tests/sync-preflight.test.mjs tests/plugin-update-overlay.test.mjs tests/sync-build-freshness.test.mjs` → **49 passed, 0 failed/skipped**, exit 0 (job bash-436).
2. RED before any production edit: `DSH_LOCAL_MANIFEST=/nonexistent/ohmydsh-test-isolation/dsh.yaml.local node --test tests/sync-build-inputs-dirs.test.mjs` → **18 tests, 6 passed, 12 failed, 0 skipped**, exit 1 (bash-445). Legal directory rejected as `must be a regular file`; FIFO/socket rejected with old file-only wording. Tests loaded/executed; no syntax/import failures. Existing file hash and private-manifest negative oracle already pass.
3. After preflight-only edit: `DSH_LOCAL_MANIFEST=/nonexistent/ohmydsh-test-isolation/dsh.yaml.local node --test tests/sync-build-inputs-dirs.test.mjs tests/sync-preflight.test.mjs tests/sync-overlay-root.test.mjs` → **44 tests, 34 passed, 10 failed, 0 skipped**, exit 1 (bash-447). FIFO/socket and strict kinds pass; remaining RED explicitly reaches `local build input missing or not a regular file` in hash, proving the second missing integration point.
4. GREEN after minimal directory hash: `DSH_LOCAL_MANIFEST=/nonexistent/ohmydsh-test-isolation/dsh.yaml.local node --test tests/sync-build-inputs-dirs.test.mjs tests/sync-preflight.test.mjs tests/sync-overlay-root.test.mjs tests/sync-build-freshness.test.mjs` → **48 passed, 0 failed/skipped**, exit 0 (bash-449).
5. Full six-suite run after stronger ordering/link/mtime assertions → **67 passed, 0 failed/skipped**, exit 0 (bash-464). Then added one inherited-validation test (see I06). Its first run was **67 passed, 1 failed** (bash-471): test incorrectly expected the runtime fence's existing diagnostic to contain overlay path. Investigation traced `declaredHostRuntimeFromManifest` error: identity and version are reported, not path; inherited scenario requires failure before writes, not path. Corrected only this extra unsupported test expectation to require `dsh-pet hostRuntimeCompatibility`; retained nonzero status, mismatch message, unchanged home, zero CLI calls. No product workaround.
6. **Final snapshot:** `DSH_LOCAL_MANIFEST=/nonexistent/ohmydsh-test-isolation/dsh.yaml.local node --test tests/sync-build-inputs-dirs.test.mjs tests/sync-local-manifest-overlay.test.mjs tests/sync-overlay-root.test.mjs tests/sync-preflight.test.mjs tests/plugin-update-overlay.test.mjs tests/sync-build-freshness.test.mjs` → **68 passed, 0 failed/cancelled/skipped/todo**, exit 0, ~7.23s (bash-478). New suite: 19 tests, comprising 13 top-level tests plus six input-kind subtests.
7. At final snapshot: `git diff --check` → exit 0; `openspec validate sync-build-inputs-dirs --strict` → valid, exit 0; `npm run check:artifacts` → tracked paths comply, exit 0 (same bash-478 chain). Anvil verify instructions read, but verify artifact/task/ledger modifications are reserved to parent under this delegation's file scope.

## Scenario mapping / suggested live-ledger updates

All rows below have passing executable evidence in final six-suite run. I01–I35 retain the order of the 35 inherited rows in test-plan. Paths are aliases: O = [overlay tests](../../../tests/sync-local-manifest-overlay.test.mjs), R = [root tests](../../../tests/sync-overlay-root.test.mjs), P = [preflight tests](../../../tests/sync-preflight.test.mjs), U = [update tests](../../../tests/plugin-update-overlay.test.mjs), D = [new directory tests](../../../tests/sync-build-inputs-dirs.test.mjs). Actual test names appear verbatim below; parent should update mapping instead of inventing separate tests for grouped assertions.

| Row | Actual test(s) | Checked oracle |
|---|---|---|
| I01 | O: `no overlay: sync behaves exactly as before` | public patch present; no overlay output |
| I02 | O: `overlay entry is appended and materialized` | both public/private fragments |
| I03 | O: `startup listing includes overlay entries` **and** `update check covers overlay remote entries` | notes project private package; update row present (one test alone is insufficient) |
| I04 | O: `id colliding with the public manifest is rejected` | nonzero, colliding id and append-only diagnostic |
| I05 | O: `overlay declaring a top-level field is rejected` | forbidden top-level fields rejected |
| I06 | O: `overlay entries are not exempt from per-field validation`, `missing required field is rejected for overlay entries`; D: `overlay-regression-06: missing fields, remote identity and runtime mismatch fail before writes` | missing field/non-npm identity/runtime mismatch all rejected before home/CLI changes |
| I07 | O: `present but unparsable overlay fails closed`, `overlay whose root is not a mapping fails closed` | nonzero and parse/shape diagnostics |
| I08 | O: `DSH_LOCAL_MANIFEST replaces the default overlay path` | selected fragment present, default absent |
| I09 | D: `overlay-regression-09: public manifest exposes no private fixture entries` | synthetic private id/name absent and public bytes identical; deliberate contaminated bytes throw AssertionError first; private package really installs |
| I10 | O: `sync stays idempotent with an overlay present` | second no changes; R external idempotence also snapshots home |
| I11 | R: `external overlay root materializes its own patch and skill` | private patch bytes and skill tree equality |
| I12 | P: `missing overlay patch fails before rewriting cordis.patch.yml` | absolute missing private path, patch bytes unchanged despite public decoy |
| I13 | P: `missing public skill fails before any materialization` | missing path, previous patch bytes retained |
| I14 | P: `symlinked patch escaping its root is rejected` | escape/root diagnostic, patch unchanged |
| I15 | P: `missing or escaping compat dependency fails before dependency sync` | both variants, absolute path, manifest unchanged, no CLI calls |
| I16 | P: `preflight failure on a fresh DSH_HOME leaves it empty` | empty tree remains empty |
| I17 | R: `relative DSH_LOCAL_MANIFEST is rejected by sync` | absolute-path diagnostic, home unchanged |
| I18 | R: `relative DSH_LOCAL_MANIFEST degrades the startup listing with a warning` | exit 0, public row, warning |
| I19 | R: `external root local package builds in its own workspace` | real INIT_CWD, file spec, public snapshot unchanged |
| I20 | R: `external root build failure stops before install` | nonzero build error with private root, zero q add/remove calls |
| I21 | R: `buildInputs escaping the overlay root are rejected` | load error/root diagnostic, home unchanged |
| I22 | R: `repo-root overlay symlink resolves sources from the link target` | target-root patch marker/content |
| I23 | R: `overlay package reusing a public npm name is rejected` | name and both ids, unchanged home, zero CLI calls |
| I24 | R: `overlay package reusing a top-level dependency name is rejected` | dependency/name/id diagnostic, unchanged home, zero CLI |
| I25 | R: `overlay package reusing a compat dependency name is rejected` | compat/name/owner ids, unchanged home, zero CLI |
| I26 | U: `plugin-update skips overlay rows without touching dsh.yaml` | manual-overlay output, manifest bytes and temp-fixture commit count unchanged |
| I27 | U: `every update row carries fromOverlay` | all a/b/g rows, public false, private/skipped true |
| I28 | U: `scoped package metadata goes through npm with profile auth` | local registry request carries fixture auth; unreachable default registry |
| I29 | R: `name disagreeing with the npm spec is rejected` | both names/id diagnostic, home unchanged |
| I30 | P: `disabled local package without source is removed via the ledger` | prior installed private package removed after sources disappear |
| I31 | P: `reset succeeds when overlay sources are gone` | package dependency and fragment removed |
| I32 | P: `reset succeeds when the host runtime builder is missing` | normal run nonzero/home unchanged, reset removes managed packages |
| I33 | P: `disabled local package.json escaping its root is rejected before reading` | identity/root/path diagnostics and unchanged home |
| I34 | R: `reserved sourceRoot and overlaySource fields are rejected` | public/private variants, reserved-key error, unchanged home |
| I35 | R: `startup listing resolves local names from the overlay root` | package name with manifest PRIVATE_BRIEF, not package description |

New scenarios (D):

| Scenario id | Actual test name / assertion |
|---|---|
| dir-input-01 | `dir-input-01: 外部源码变化构建并上线新字节，mtime 无关且第二次幂等` — touch alone does not rebuild; same-mtime changed bytes change hash, rebuild, reach deployed bytes; next run no changes and home snapshot identical |
| dir-input-02 | `dir-input-02: 目录内新增、删除或改名文件改变哈希` — each add/delete/rename differs from previous hash |
| dir-input-03 | `dir-boundary-filters: dir-input-03 ignored scope; dir-input-12 nested lib/test are source` plus dir-boundary-links — out-of-src test/lib, dot/node_modules and src-level external symlink leave hash/build/home unchanged |
| dir-input-04 | `dir-input-04: 空目录条目的哈希稳定且不同于无条目` — exact prefix oracle, repeat equality, differs from absent entry |
| dir-input-05 | `dir-boundary-overlap: dir-input-05 ordering, duplicates, file+dir and self overlap keep contributions` — reversed order equality; explicit expected bytes pin sorting, duplicates and overlaps |
| dir-input-06 | `dir-input-06: 目录条目不存在时预检失败` — existing and fresh home unchanged; absolute path and no CLI calls |
| dir-input-07 | input-kinds subtests `dir-input-07: fifo fails before writes`, `dir-input-07: socket fails before writes` — nonzero, required wording, unchanged fresh home |
| dir-input-08 | input-kinds subtest `dir-input-08: 原有文件条目仍通过预检` — successful sync and frozen old hash |
| dir-input-09 | `dir-boundary-links: internal file/dir links ignored; top-level in-root accepted, dir-input-09 escape rejected` — legal top-level alias exact hash, external top-level alias rejected before writes |
| dir-input-10 | `dir-boundary-root-isolation: dir-input-10 public and overlay use only their owning root` — mutation in each owning root affects only its consumer |
| dir-input-11 | `dir-input-11: 既有文件条目的哈希保持不变` — frozen old algorithm in same Node process, multiple/duplicate/self-overlap files; own excluded lib/test and included nested src/config fixtures |
| dir-input-12 | dir-boundary-filters — each modification under src/lib and src/test changes hash |

All six required design D4 matrix groups are executable: `dir-boundary-input-kinds`, `dir-boundary-overlap`, `dir-boundary-filters`, `dir-boundary-links`, `dir-boundary-root-isolation`, `dir-boundary-freshness`. Last group settles own-directory input after output creation, verifies lib drift rebuilds, then deletes output-provenance records without changing inputs and verifies rebuild again. Existing freshness suite independently exercises output drift with unchanged input hash and per-package isolation.

## Review and handoff

Local whole-change review against approved D1–D4: no unresolved implementation defect. Product diff is confined to preflight type and additive directory hash; no exclusion options, blacklist, deduplication, source API export or additional freshness decision. Tests observe real persisted hashes and deployed bytes, not imported internals. Prior file encoding remains byte-compatible, witnessed by frozen legacy oracle.

Tasks 1.1–4.3 have implementation/test evidence above (mapping grouped tests is intentional). For parent: 5.1 needs parent root `npm test` plus live task/test-plan updates; 5.2 strict check passed, but final Anvil verify artifact is parent's scope; 5.3 remains gated on parent review/verification and explicit authorization for any later spec sync/archive. No claim that all 15 checkboxes are completed or final verify PASS exists. Long-term raw logs/fixtures were not added to Git; only this lightweight reproducible summary is retained.
