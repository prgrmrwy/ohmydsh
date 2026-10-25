# Authorized main merge and local testing

## User decision (2026-10-25)

User confirmed PC is the native Windows machine already tested, replaced devbox with this machine's WSL, authorized preparing and merging into main before local testing, and requested normal local testing instead of an isolated profile. This is not acceptance of unrun macOS/console/full-manifest gates and does not authorize restarting the existing production Host.

The local two-exact-version script policy remains denial (`allowBuilds:false`), not approval to execute scripts or any allow-all. Permanent deployment configuration must still be maintained through repository sources, not an undocumented generated-profile edit.

## Main cleanliness gate

Controlled `node scripts/ws-merge.mjs ws/win` dry-run refused because main had one pre-existing dirty file, root package-lock.json. Read-only diff showed two existing workspace keys reordered. User explicitly selected preserving and committing that change first. Parsed JSON equality to HEAD was checked before staging; no dependency value changed. Saved separately on main as `85ea1f42` (`chore(lock): preserve existing workspace entry ordering`); main then clean.

## Migration commit candidate

Staged only migration implementation/tests/evidence plus the previously approved old-change archive/spec synchronization. No ignored dependency-review raw scratch or generated package build output included. Staged artifact policy/diff checks pass. Fresh staged candidate `npm test` job bash-336: **578 tests /576 pass /0 fail /2 existing MCP integration skips**, exit0.

Migration remains unaccepted (`verify.md DECISION:FAIL`) while merge/local testing proceeds under this explicit user authorization. No upstream push, change archive, worktree deletion or production restart has been performed.

## Controlled merge result

Migration committed on ws/win as `4a729275`. Controlled preview passed after main's existing lock reorder was preserved; `node scripts/ws-merge.mjs ws/win --yes` succeeded with merge commit `5b84475f`. Main is clean, three commits ahead of origin/main, and contains the migration commit by ancestry check. No push was run.

## Local WSL preflight

Read-only policy metadata shows the existing local web profile already has name-wide `@google/genai:false` and `protobufjs:false`, plus pre-existing `node-pty:true`; installed versions are the reviewed genai1.52.0/protobufjs7.6.6. No policy was written or broadened by this work. Local pnpm is11.24.0 (different from isolated gate11.7.0), Node24.20.0.

Merged main dependency health is false, so its bin correctly refuses with initialization instructions; no main dependency installation was attempted because this Session remains bound to the worktree. User selected continuing local profile testing from the current worktree's healthy dependencies with code already contained in main. `DSH_SKIP_UPDATE=1 node bin/dsh.mjs doctor --check` passes for memex0.4.1. Main and worktree were clean after this preflight.

Authorized first local build was attempted with `DSH_SKIP_UPDATE=1 node bin/dsh.mjs build --no-open` (job bash-354), then collected to completion: **exit1**. Actual sync output identifies the target as the Worktree Session DSH home recorded by ws status, not the existing ordinary ~/.dsh profile examined in preflight. Therefore this attempt does NOT satisfy the user's requested ordinary local-profile test. The earlier assumption that inspecting inherited DSH_HOME proved the actual build target was incorrect; no attempt is made to override the managed binding.

The fresh managed profile did not inherit ordinary local profile script denials. Five plugin additions report ERR_PNPM_IGNORED_BUILDS for genai1.52.0/protobufjs7.6.6. Separately, schema installation refuses the existing unmanaged Anvil schema target. No approve-builds, policy widening, unmanaged-schema deletion/overwrite or Host restart was performed. No second build was run after these failures. The ordinary local profile's pre-existing denial policy is not evidence that it was applied to the actual managed build target.

Next ordinary main-checkout initialization/local-profile testing requires a Session not bound to this worktree, or a supported Host transition of the binding. Do not evade the binding with a main-cwd npm install, environment override or bare filesystem edit of a generated profile. Main bootstrap remains pending; source merged successfully, but main dependencies remain uninitialized. Existing private/local inputs and raw logs are not published in this report.

## Ordinary-session handoff (not executed here)

1. Open an ordinary main-checkout Session, not a worktree-bound Session; inspect current main status and effective profile destination before any mutation. Do not assume the present process.env.DSH_HOME proves where a subprocess will deploy.
2. Re-read this report and verify.md. Main already contains implementation4a729275 via merge5b84475f. A later evidence-only follow-up may have been merged; inspect current Git history, do not reset to an old SHA.
3. Validate toolchain, then `node scripts/bootstrap.mjs` in main to restore its root locked dependencies. This may execute existing workspace lifecycle scripts; it is authorized initialization, not a version upgrade. Do not run npm audit fix or overwrite a conflicting global dsh bin.
4. Before `npm link`, inspect which dsh command currently resolves and its ownership. Never force-overwrite an unrelated official command. Explicit `node bin/dsh.mjs` is sufficient for initial functional testing; command-link verification is a separate check.
5. Confirm the actual ordinary local profile is the intended target. Its preflight denial policy was already false for genai/protobufjs; preserve unrelated keys and never allow-all. If actual target/policy differs, report rather than copying policy blindly. No direct hand-edit of generated policy as a substitute for a repository-managed ownership decision.
6. Run build with DSH_SKIP_UPDATE=1 and --no-open; on failure stop and inspect the first actual error. Do not proceed to build2/dump/Host acceptance after an unsuccessful build. The unmanaged Anvil schema refusal must be diagnosed without deleting/replacing the unknown target; record identity/content comparison and request a specific migration decision if needed.
7. Only after build1 succeeds, run build2 and require the exact sync no-changes report using the tested acceptance assertion. Then doctor --check and dump can be checked locally, keeping config output private. Existing Host3080 must not be stopped/restarted without separate confirmation; any test Host must have an explicitly approved nonconflicting port and verified ownership.
8. Windows PC tests remain native Win32, not WSL evidence. Existing native60+7 cases are recorded but do not prove ordinary-PC full build or console-close. macOS remains unrun. Keep DECISION:FAIL and open tasks until their actual gates are closed or the user explicitly accepts a reduced scope.

Do not push, archive the active change, clean this worktree, or mark the goal complete merely because the source was merged.

## Ordinary main-checkout local verification (2026-10-25)

Executed in a new ordinary Session from `/home/prgrmr/opensource/ohmydsh`, main HEAD `1505d27410820886ae0a9b540273cfa4879da095`, initially clean and three commits ahead of origin/main. Current history differs from the original merge receipts above: the current implementation commit is `8bda4a12`, preceded by lock-order commit `8056d0ad`, followed by the evidence handoff commit. No reset or history rewrite was performed in this verification.

Trusted no-path ws status reports no Worktree Session binding for this Session. The launcher environment resolver identifies ordinary `/home/prgrmr/.dsh`, profile `web`; actual sync output also names that profile's generated patch. Toolchain: Node24.20.0, npm12.0.2, pnpm11.24.0. `node scripts/bootstrap.mjs` (bash-3) exits0: dependencies are already healthy at this snapshot, so it skips npm ci. This proves initialization health, not a fresh root installation. The existing global dsh symlink resolves to this checkout's `bin/dsh.mjs`; no npm link or global overwrite was necessary or performed.

Read-only checks of the actual profile's pnpm-workspace.yaml before and after builds show unchanged `allowBuilds`: `@google/genai:false`, `protobufjs:false`, `node-pty:true`. No policy was copied, broadened or written. The ordinary sync ledger already owns user-scope Anvil with the pinned source identity; its real directory is not a symlink and its computed tree hash equals manifest `61250a6741799df17fe74c41ed23a95e2910ea3190fff2f6c0e8f66004a63767`. The earlier managed-profile unmanaged-target failure does not reproduce in this ordinary profile; no schema migration or overwrite was needed.

- Build1: `DSH_SKIP_UPDATE=1 node bin/dsh.mjs build --no-open` (bash-6) exits0, all package/schema/launcher entries up-to-date, generated patch region updated, **1 change applied**.
- Build2: same command captured and passed to `assertSecondBuildNoop` from checking/full-gate-assertions.mjs (bash-8) exits0, exact `[sync] no changes — deployment already matches manifest` present, no contradictory change-applied marker. **Idempotence passes**.
- `DSH_SKIP_UPDATE=1 node bin/dsh.mjs doctor --check` exits0; memex0.4.1 ready.
- `DSH_SKIP_UPDATE=1 node bin/dsh.mjs --profile web --dump-config` (bash-14) exits0, stderr empty, stdout61220 bytes; configuration body was withheld and not saved to the repository. Initial operator invocation used the unsupported positional `dump` (bash-10, then diagnostic repeat), which exited1 with “too many arguments”; source inspection confirmed the gate's documented `--dump-config` flag and the corrected invocation passes. No product repair was required.
- Both builds warn about two pre-existing unmanaged bundles (experimental-agent-team-profile and experimental-voice-input-bundle), which sync preserves. These warnings do not cause a nonzero build result.
- Read-only launcher ownership probe identifies existing port3080 as an owned DSH Host (PID471090). No signal, restart, additional Host or test port was used. This is ownership evidence only, not a fresh Host lifecycle acceptance.

This closes ordinary local WSL build×2/idempotence/doctor/dump at the stated main snapshot with existing local inputs. It does not close isolated public-manifest gates, a fresh npm ci, native-PC full build/PowerShell/console-close, macOS, exact MCP integration prerequisites or missing historical RED receipts. Keep verify.md `DECISION: FAIL` and the corresponding tasks open. No push, commit, archive or worktree cleanup was performed in this verification.
