# Verify: add-dsh-openspec-adapter

DECISION: FAIL

Verified in the managed worktree `ws/openspec-apply-change-add-dsh-openspec-adapter`. The change is **not complete**: 5 of 59 test-plan rows are still red and 17 tasks are unchecked. All of them depend on work that was not done (see Blockers). Nothing below claims more than was actually run.

## 1. Task completion

`openspec instructions apply --change add-dsh-openspec-adapter --json` → **174 / 191 complete, 17 remaining**.

Unchecked tasks and the reason for each:

| Tasks | Reason |
|---|---|
| 5.28, 5.29, 5.30 | The spec requires pinning scope pass-through at **both real `dsh-tool-skill` call sites**. `@deepseek-ai/dsh-tool-skill` is not installed in this worktree, so the model-tool and gesture call sites were never driven. What exists instead: a synthetic provider test (`scope-option.test.ts`) and real-`SkillRegistry` tests (`registry-real.test.ts`). Those prove the registry passes `scope` to the provider, but they are not the specified call-site evidence. |
| 9.1, 9.2, 9.3 | `L/cross-workspace.smoke.mjs` not written; needs an isolated DSH profile running DSH 0.1.5-rc.2. |
| 9.7, 9.8, 9.9, 9.10, 9.11, 9.12 | `L/routing-invocation.smoke.mjs` not written; needs real `request/header` output from an isolated profile. |
| 9.13, 9.14, 9.15 | `L/disable.smoke.mjs` not written; needs an isolated profile. |
| 10.2 | Not satisfied; see section 5 (the second sync is not a no-op because of a pre-existing, unrelated entry). |
| 10.3 | Cannot be ticked: it requires every row green. |

## 2. TDD integrity (BLOCKING) — fails

- test-plan rows: **54 🟢 green, 5 🔴 red** (59 total). Red rows:
  - `second_workspace_discovers_surface_and_uses_own_cwd` (L/)
  - `disable_removes_surface_and_keeps_unrelated_bytes` (L/)
  - `scope_reaches_provider_get_at_model_and_gesture_call_sites_and_undefined_agent_gets_no_notice` (P/)
  - `every_producible_session_kind_header_equals_baseline_and_gaps_are_recorded` (L/)
  - `no_provider_header_equals_baseline_exactly` (L/)
- A row still red is a failure by this artifact's own rule. No row was declared `N/A` to avoid that; the L/ rows are executable and simply not yet written.
- No test was weakened or deleted without a REMOVED requirement. One test, `unquoted_legacy_node_command_is_not_accepted_by_normative_builder`, was added and then removed in the same session because the builder deliberately kept a compatibility path at that moment; the final builder accepts only the normative POSIX-quoted form and all fixtures were migrated to it.
- Skipped tests: the repo suite reports 2 skipped. They are in the existing MCP-bridge test (`real DSH MCP bridge exposes a typed tool…`, `disposing the real bridge unregisters…`), which is unrelated to this change and skips because the exact `@deepseek-ai/dsh-mcp-client` is only in a managed profile. They pre-date this change.

## 3. Review integrity

- `review.md`: `VERDICT: APPROVE_WITH_CHANGES`, `CHANGES_APPLIED: yes`.
- Not stale: `git diff HEAD -- proposal.md design.md specs` lists **0 files**, so the guarded artifacts are byte-identical to the committed, reviewed state. Only `tasks.md` and `test-plan.md` changed, and they are outside the staleness guard.
- I did not re-run the review. The review's findings concerned design, not this implementation.

## 4. Evidence — final runs at the last code snapshot

Run from the worktree root. Source code was not changed after these runs; only `tasks.md` (task 10.1 tick) and this file changed afterward.

| Command | Result |
|---|---|
| `npm run build --workspace dsh-openspec` | success |
| `npm run typecheck --workspace dsh-openspec` | no errors |
| `npm run test --workspace dsh-openspec` | **26 files, 72 tests, all passed** |
| `npm test` (repo) | **263 tests: 261 pass, 0 fail, 2 skipped** |
| `npm run check:artifacts` | "tracked paths comply with repository policy" |
| `openspec validate add-dsh-openspec-adapter --strict` | "Change 'add-dsh-openspec-adapter' is valid" |
| `git diff --check` | clean |

Note on `npm test`: an earlier full run, before the final changes, reported one transient failure in `tests/dsh-runtime-provisioning.test.mjs` (`ENOTEMPTY` removing a `/tmp/ohmydsh-runtime-*` directory). Re-running that file alone passed, and the later full runs passed. I did not find the root cause, so treat it as an unexplained flake, not as fixed.

## 5. Two-sync check (task 10.2) — not satisfied

Run in a throwaway profile (`DSH_HOME`, `XDG_*` and `HOME` all isolated, real repo manifest, fake DSH CLI); the real `~/.dsh` was not touched.

- First sync: exit 0, 63 changes applied.
- Second sync: exit 0, **but one change reported**: `install remote package dsh-cockpit-bridge …`. A third sync reported the same line again.
- Control: the same experiment on an unmodified checkout of `HEAD` (no changes from this work) reproduces the identical `dsh-cockpit-bridge` reinstall on the second sync. So it is **pre-existing and not caused by this change**.
- Every other line of the second and third runs, including `package dsh-openspec@0.1.0 up-to-date`, is up-to-date. In particular the new `source-checkout.json` record is written once and then a no-op.
- Because that line appears, the literal acceptance ("the second run reports no changes") is not met. I did not investigate or change the `dsh-cockpit-bridge` behavior; that is outside this change's scope.

An earlier attempt of the same check, before I isolated `XDG_DATA_HOME`, failed with `third-party schema target /home/prgrmr/.local/share/openspec/schemas/anvil is unmanaged; refusing to overwrite`. That was a refusal, not an overwrite: the real directory's mtime was unchanged afterward. Sync does read the user's real `~/.local/share/openspec` when `XDG_DATA_HOME` is not set, so any future two-sync check must isolate it.

## 6. Delivery status

Nothing committed. Changed files, awaiting human review:

- modified: `dsh.yaml`, `package-lock.json`, `scripts/sync.mjs`, `scripts/lib/plugin-updates.mjs`, `openspec/changes/add-dsh-openspec-adapter/tasks.md`, `…/test-plan.md`
- new: `packages/dsh-openspec/` (source, tests, README, NOTICE), `tests/dsh-openspec-upgrade.test.mjs`, `tests/sync-dsh-openspec.test.mjs`, `…/verify.md`

No archive, merge or worktree cleanup has been done or requested.

## 7. Blockers and honest limits

1. **Live evidence is missing.** The 4 `L/` rows and the real-call-site scope test all need a real DSH 0.1.5-rc.2 process in an isolated profile (not the GUI on 127.0.0.1:3080). Header-level claims, cross-workspace discovery, and disable behavior are unverified; `docs/notes/dsh-plugin-integration-pitfalls.md` says unit tests are not valid evidence for them. This needs your go-ahead to start a managed isolated DSH process.
2. **Upgrade staging has never run against the real npm registry.** `stage-target.ts` is unit-tested with injected dependencies, and `stage-official.ts` (real `fetch`, `npm install --ignore-scripts`, CLI smoke, renderer parity) is untested code. The repo-level upgrade tests inject their own `stage`.
3. **`activate` can only report `live` for the version the running process already has.** For any other target it returns `pending-reload` and does not materialize the new generation; that happens at next DSH start. This follows the spec's `activation: live | pending-reload` wording, but the "restart then new generation is materialized" path has no test.
4. **The recorded-checkout trust model is new and lightly tested.** `sync.mjs` now writes `$DSH_HOME/plugins/dsh-openspec/source-checkout.json`. The plugin treats that file as the authoritative checkout and blocks Git worktrees via a `.git`-is-a-file check. This is my implementation of the spec's "sync-recorded checkout"; the spec does not define the record's format.
5. **Routing is contract-only, as designed.** No production provider is registered and nothing is exposed to sessions. The routing tests are unit-level; the header-parity claim (rows 9.7/9.10) is unverified.
6. **Pet/Locus exposure gap is documented, not fixed**, per the approved decision (`BACKLOG.md` D006, README "Known scope gap"). `pet-exposure-gap.test.ts` asserts the gap exists using the real `SkillRegistry`.

## Decision

`DECISION: FAIL` — 5 red test-plan rows and 17 unchecked tasks remain, and the two-sync acceptance is not met. The package, transaction and management work is implemented and passes 72 package tests plus the full repository suite, but the change cannot be called complete until the isolated-profile smoke tests and the real call-site test exist.
