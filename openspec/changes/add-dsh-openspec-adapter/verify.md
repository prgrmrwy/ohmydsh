# Verify: add-dsh-openspec-adapter

DECISION: FAIL

Interim implementation report, not final acceptance. The public naming amendment is complete locally; the overall change remains incomplete. Do not merge, archive, or treat artifact approval as authorization for Host-side mutations.

## Latest bounded work: source-wide exclusion and recovery reachability (goal round 8)

Five additional RED → GREEN regressions:

- Two profiles sharing one physical checkout previously staged/committed concurrently. Transaction/recovery now additionally acquire a source-realpath hash lock under the OS temp directory before staging, held with the profile lock and released only by its acquiring invocation. Test holds profile A in staging and proves profile B cannot stage. Owner pid/checkout/stateDir is recorded; no automatic stale-lock reclamation is introduced.
- A chmod-readonly source file was replaced via atomic rename and reported success. Preflight now checks writable file and parent modes plus OS W_OK before staging or prepared journal; readonly fixture remains byte-identical and stage is uncalled. This is ordinary OS/mode proof, not a DSH sandbox-denial proof.
- Session updater previously ignored selected-version/source-pin mismatch. It now blocks before staging; after pending-reload, another upgrade waits until selected and source match again.
- The guarded recoverRollback existed but was unreachable through session updater. Existing explicit rollback grammar now recovers only the pending journal's exact previousVersion; normal upgrades/arbitrary rollback remain blocked while recovery is pending. Test uses real transaction fixture + session updater, no source writes outside temp fixtures, no sync/project refresh side effects.
- Recovery retained target-only closure entries. Prepared journal now stores added entry identities/hashes (no source snapshots); recovery deletes only those exact additions after full source/journal hash guard, preserving unrelated entries. Complete old package metadata/lock text reconstruction and all partial-write windows are not claimed.

Fresh package final snapshot: **32 files / 115 tests pass**, pretest/build/typecheck/artifacts/strict validation/diff check pass. Repository `npm test`: **263 total / 261 pass / 0 fail / 2 existing skips**, collected bash-31, before the final recovery routing/closure-added-owner refinements; those were subsequently package-tested. No VM operations, install, source pin mutation or model calls. README explains guarded recovery and conservative abandoned-lock operator handling.

Task totals remain **177/194**. Remaining transaction evidence includes genuine process death and lock-owner cleanup, partial two-file CAS windows, permissions revoked mid-transaction, cross-platform/profile locking and real upgrade/reload. A killed process still leaves locks; age-based cleanup is intentionally not guessed. These are tracked acceptance work, not silently marked complete. Next batch will prepare the current branch for VM deployment and close the real-runtime rows, subject to implementation review.

## Earlier bounded work: selected renderer and transaction recovery (goal round 7)

Six additional regressions demonstrated RED before repair, then GREEN:

- Independent official renderer comparison for the core selection exposed incorrect all-workflow optional branches (e.g. apply suggested uninstalled continue). `renderOfficialBody` now receives the exact selected workflow ids that feed catalog preparation; both native surfaces use that one body. Generation identity advances to `openspec-upgrade-v5` so old incorrect bodies are retained but not reused.
- A rejected competing upgrade removed another process's lock and same-instance contender cleared its owner's busy flag. Cleanup now releases only the lock/busy ownership actually acquired by this invocation.
- Malformed recovery journal was treated as absent. Upgrade now refuses before staging, inspectRecovery reports recovery-required, and journal is checked again after lock acquisition.
- Actual adapter startup with a prepared journal overwrote active.json. Startup/refresh now refuse materialization while recovery is pending and previous generation continues to serve body + recovery block. Test drives actual apply, old version fixture and byte-identical active reference, not a real killed VM process.
- recoverRollback lacked forbidden-context/serialization gates and only checked source before staging. It now checks approval/worktree/recorded realpath, shares mutation lock, validates old target staging, and rechecks exact source/journal after awaits before writing. A user edit injected during staging is preserved with recovery-required, journal unchanged.
- Source pin/lockfile mismatch previously proceeded to staging; it now blocks before stage. Transaction no longer copies unrelated staged workspace metadata into lockfile startup fields.

Fresh current snapshot: package **32 files / 110 tests pass**, pretest/build/typecheck, artifacts, strict validation and diff check pass; repository `npm test` **263 total / 261 pass / 0 fail / 2 existing skips**, exit 0, collected bash-30. No deployment, dependency install or real model request. These fixtures do not prove OS-level two-file crash windows, unwritable-source failure classification, cross-profile source locking, full previous lock closure reconstruction or live pending-reload activation. Recovery helper public exposure and those remaining transaction contracts still need final audit; no blanket completion claim is made. Task count remains **177/194**.

## Earlier bounded work: dependency integrity and target staging (goal round 6)

### RED → GREEN evidence

- New `generation-closure.test.ts` failed on nested-version flattening (`EEXIST`), accepted a tampered generation on reuse, and concurrent calls used the same pid/timestamp staging path. Repair copies each physical dependency once into an internal store, links dependency edges within the generation, skips only absent optional dependencies, supports cycles/nested versions, and uses random staging identities. Tests run the CLI after deleting its source tree to prove the closure is self-contained.
- Recursive path/type/byte hashes now cover bin/dist/schemas/node_modules/package.json (the old implementation hashed only files, silently skipped directories, and never compared hashes). Reuse checks the expected staged hashes and the existing generation's bytes before selecting; changed source or tampering fails without manifest overwrite. Concurrent same-id publication reuses only the identical verified winner and removes its own staging; old generations remain untouched.
- New `stage-official.test.ts` failed because parity checked no custom-name collision or package identity. It now checks all unfiltered official workflows, mapped ids/completeness/uniqueness, custom names, package name/version, renderer exports/body markers. The real installed 1.13.2 package passes; hostile noncore collision and unknown-id fixtures are rejected. No network/install test is implied.
- Exact CLI smoke regression caught `1.13.20` accepted as `1.13.2`; both target staging and materializer now reject the substring mismatch.
- Routing registry unload regression failed because no whole-service disposer existed. New disposal cancels all in-flight requests, prevents future registration and is called by adapter teardown. Routing remains contract-only; no model-facing routing tool/provider is added.

Fresh final snapshot: `npm run test --workspace dsh-openspec -- --reporter=dot` (pretest builds): **32 files / 104 tests pass**; typecheck/artifacts/strict validation/diff check pass. Repository `npm test`: **263 total / 261 pass / 0 fail / 2 existing skips**, exit 0, collected from bash-27. No dependency install, VM deployment/restart, source pin mutation or model call performed. Generation format tag is now `openspec-upgrade-v4` for the new immutable closure/hash representation.

This is local implementation evidence, not final acceptance. Remaining audits include full scenario/test strength, transaction source drift/recovery/live reload, official renderer selection-dependent body parity, and real-runtime rows. Task count remains **177/194**, since this round strengthens already checked implementation rows.

## Earlier bounded work: catalog/generation lifecycle repair (goal round 5)

Auditing the checked 2.x tasks found production wiring did not satisfy D1/D4: monitor called an async refresh without awaiting, never called registration-scoped `control.invalidate()`, compared against startup fingerprint forever, and never replaced commands. Delivery modes also exposed both surfaces and silently dropped verify/onboard. Materialization wrote metadata then rewrote generation.json without selection/delivery, so repeat materialization could collide and leaked staging on reuse.

### RED → GREEN evidence

- `generations.test.ts`: new fixture failed because selectionFingerprint/delivery disappeared. Repair selects the complete staged manifest without rewriting it, compares exact selection/delivery on reuse and removes staging before returning. Repeated materialization and collision rejection leave old manifest bytes unchanged.
- `catalog-lifecycle.test.ts`: actual apply using the official installed CLI failed because cached listing was not invalidated and skills-only mode still registered commands. A subsequent regression caught dropped slash handler fallback serving old body. Repair uses registration control.invalidate, refresh single-flight/current fingerprint, replaces command registrations and rejects absent consumed workflow rather than fallback.
- Actual **real SkillRegistry** (not just an invalidation spy) now shows cached catalog replaced after profile refresh and empty catalog after provider disposal. Other actual-apply tests cover switching back to the original generation, commands-only Skill suppression, get-time refresh of a cached candidate, failed refresh preserving active/catalog, concurrent refresh sharing one publication, and no post-disposal timer-triggered refresh.
- `upstream-compat.test.ts`: all-mode catalog regression exposed silent verify/onboard omission; both remain in the shared 12-workflow catalog and native delivery is filtered at surface registration instead.
- `generations.test.ts`: cancellation regression initially activated despite `canActivate: false`; materializer now checks lifecycle before publication/selection and clears its own staging on cancellation. This covers explicit cancellation points, not every OS-level activation/disposal race.
- Monitor establishes initial signature immediately, awaits refresh, retries failures, contains timer rejection and does not invalidate after a pending stat resolves post-disposal.

Final package snapshot: **30 files / 96 tests pass**, pretest/build/typecheck pass; artifact policy, strict spec validation and diff check pass. Repository `npm test`: **263 total / 261 pass / 0 fail / 2 existing skips**, exit 0 before the final cancellation-only refinements; those were subsequently package-tested. No dependency installation, VM deployment or real model request performed.

Generation format tag is now `openspec-upgrade-v3` to avoid reusing older metadata-incomplete generations. Remaining audits include dependency-closure/sourceHashes integrity, concurrent generation publication and routing disposal; the real-runtime acceptance rows remain outstanding. Task totals remain **177/194**, since these are repairs/stronger evidence for already-checked tasks, not newly completed live scenarios.

## Earlier bounded work: D3 session-owned updater (goal round 4)

Removed the Host `openspec.management` mutation service and Host-side transaction/sync/project-update wiring. `/openspec-upgrade` now only prepares an action-specific quoted updater command, after explicit approval and caller-cwd checks. The agent must execute it with the ordinary session Bash tool/workdir; the handler does not execute it or claim completion.

New `src/session-management.ts` performs read-only planning; `src/session-updater.ts` runs as the Bash child. Upgrade/rollback verifies caller realpath equals the sync-recorded non-worktree checkout before staging, then reuses the real transaction helper and sync; it returns pending-reload without switching the active generation or restarting Host. Project refresh separately uses the active generation's contained CLI, caller cwd and configured telemetry mode. No global CLI install or project refresh is included as an upgrade side effect. Failures exposed by the updater are normalized (raw transaction error text is not forwarded).

### Local RED/GREEN and verification

- `session-management.test.ts` RED: two assertions exposed Host mutation calls. GREEN: zero mutations for approved/unapproved input, missing caller cwd fail-closed, session Bash plan only. Existing Worktree Session Bash guard is driven directly and denies authoritative checkout workdir from a bound task.
- `session-updater.test.ts` RED: four behavioral failures with stub implementations. GREEN: approval/recorded cwd/worktree gates before staging; quoted plan; active-generation project refresh at caller cwd; injected-stage real transaction preserves active bytes until reload.
- Additional built helper test executes through `sh -c` against a fixture CLI and proves only the selected workspace changes; an unapproved CLI run exits 1 and changes nothing. This is a real child-process test, not a real DSH sandbox test.
- Telemetry pass-through and raw error normalization each demonstrated a failing regression before repair.
- Prior Host-controller assertions in `manage-command.test.ts` were corrected to the unchanged approved D3 requirement (no Host mutation). Independent transaction tests retained. No requirement or permission was weakened.
- Fresh package pretest/build/typecheck: pass; **29 files / 88 tests pass**. `npm test`: **263 total / 261 pass / 0 fail / 2 existing skips**, exit 0 (before the final guidance/identity/pretest/error-normalization refinements, all of which were subsequently package-tested). Artifact policy/strict spec validation/diff check pass at final source snapshot.
- Public help changed, so both generation identity derivations advanced to `openspec-upgrade-v2`. Package pretest builds before testing the actual helper entrypoint.

No VM deployment/restart, real model calls, upgrade target registry install or main-process sync was performed. The repair does not prove all source-permission/sandbox-denial contracts or live Host-reload behavior. Those remain acceptance work.

## Earlier bounded work: `openspec-upgrade` naming amendment

The user requested the more direct name `openspec-upgrade` for the entry that upgrades the managed official OpenSpec stack. Updated the Skill, slash registration, descriptions/help, usage error, reserved-name collision list, update-notice destination, README and current change artifacts. No legacy alias is registered. Both generation-id derivations use a new format tag, preserving prior generation bytes instead of overwriting them.

This is not an official workflow, global CLI upgrade, or authorization to execute mutation in the Host. Check/upgrade/rollback/separately approved project-refresh grammar is otherwise unchanged.

### TDD evidence

`npm run test --workspace dsh-openspec -- test/upgrade-entry.test.ts --reporter=verbose`

- RED before source edits: 4 failures for the expected reasons: no new command, new notice omitted, new handler absent, old generation identity collision.
- GREEN after edits: all 4 pass.
- Tests drive the actual adapter startup callback with stubbed Host services and a temporary DSH_HOME, using the real installed official 1.13.2 CLI for materialization. No VM GUI, real session, source mutation, sync, registry request or model call is used.
- Coverage: Skill/slash discovery with no old alias; adapter-defined help; canonical new notice and rejection of arbitrary/legacy/injection-shaped destinations; no mutations on empty help/invalid input; new generation identity with prior manifest byte-identical.

### Fresh validation on the naming source snapshot

| Command | Actual result |
|---|---|
| `npm run build --workspace dsh-openspec` | exit 0 |
| `npm run typecheck --workspace dsh-openspec` | exit 0 |
| `npm run test --workspace dsh-openspec -- --reporter=dot` | 27 files / 80 tests pass, exit 0 |
| `npm test` | 263 total / 261 pass / 0 fail / 2 pre-existing skips, exit 0 |
| `npm run check:artifacts` | pass, exit 0 |
| `OPENSPEC_TELEMETRY=0 OPENSPEC_NO_UPDATE_CHECK=1 openspec validate add-dsh-openspec-adapter --strict` | valid, exit 0 |
| `git diff --check` | pass, exit 0 |

The two repository skips are the existing real MCP bridge integration tests: the exact package is only installed in a managed DSH profile. No skipped test was converted into proof. No source change followed these runs; subsequent edits update tasks/report only.

## Review integrity

Fresh-context Anvil round 3 approved the naming planning amendment: `VERDICT: APPROVE`, `CHANGES_APPLIED: n/a`. The reviewer explicitly did not approve implementation readiness. The guarded artifact hashes are recorded in `review.md`; comparing Git HEAD to the files is not, by itself, proof of review freshness.

Review I1 identified Host mutation and Host-cwd project refresh at its recorded source snapshot. Goal round 4 repaired that local path without changing guarded planning artifacts: tasks 6.5/6.6 now have focused evidence above. Review.md remains a historical independent artifact verdict, not a new implementation approval; real session policy/upgrade/reload validation is still outstanding.

A secondary Jev patch-summary check returned `escalate` (safe-to-apply 0.33; limiting rubric test-gap). It had only the bounded summary/test output, not source inspection, and is not an approval. Local diff inspection confirms the naming edits, while the source's pre-existing mutation defect remains explicitly unresolved. No deployment or completion follows from this check.

## Remaining work and evidence limits

Tasks after the local D3 repair: **177 / 194 complete, 17 unchecked**. These are bookkeeping counts, not proof that the previously checked scenarios are fully implemented. Earlier broad checkbox/green-row claims require a semantic audit; particularly transaction fixtures inject staging and do not demonstrate real registry staging, source permission enforcement or Host restart activation.

| Unchecked tasks | Missing behavior or evidence |
|---|---|
| 5.28–5.30 | Drive both actual `dsh-tool-skill` model and gesture callers; synthetic provider and real SkillRegistry seams alone do not prove these call sites. |
| 9.1–9.3 | Real second-workspace discovery and caller cwd smoke. |
| 9.7–9.12 | Real routing/no-provider request-header baselines and explicit gaps for unproducible session kinds. |
| 9.13–9.15 | Real disable/removal smoke preserving unrelated bytes. |
| 10.2 | Full real deployment repeated sync no-op evidence; injected installer fixtures are not sufficient. |
| 10.3 | Audit all scenario rows; final acceptance only after implementation/evidence gaps are resolved. |

The 59 historical scenario rows retain 54 green / 5 red flags; their old green flags are not accepted as proof of full contracts solely because similarly named tests pass. Full RED history and test-strength audit remain incomplete. This report makes no blanket assertion that no prior test was weakened.

Round 5 repaired local profile/catalog refresh, delivery enforcement, provider/timer cleanup and generation selection metadata/reuse. Round 6 repaired routing disposal, dependency-closure/sourceHashes integrity, concurrent same-id publication and full target-stage name/id parity locally. Remaining inspected debt includes selection-dependent official renderer parity and transaction drift/recovery/live activation evidence. These require focused tests/repairs before final acceptance.

## Earlier VM deployment (prior name; not renamed live evidence)

Earlier session evidence established corp-mac-vm's real main process/profile at branch commit `de0b93d`: managed official CLI 1.13.2 materialized and executed through its recorded shell invocation with both ordinary and minimal PATH. Active generation was `d9734b69dff2e2f9b6b50a9b`; prior inactive generation retained. The user screenshot showed the former management command plus official Skills in the real GUI. Those observations establish deployment/discovery at that older snapshot, not the new name, all workspace/scope paths, or upgrade correctness.

The VM's authorized main-process test environment differs from the test-plan's isolated-profile wording. No main-process evidence is silently presented as isolated-profile acceptance. The rename turn did not sync, restart, read credentials, create live sessions, issue model requests, or modify the VM. Until rename deployment occurs, its GUI will still display the former entry name.

## Decision

`DECISION: FAIL` remains. Local naming and D3 execution-path repairs pass, but the overall change cannot be called complete while real session policy/upgrade/reload evidence, other implementation debt and scenario audits remain open.
