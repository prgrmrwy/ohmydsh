# dsh-openspec

A DSH host-level adapter exposing the official OpenSpec 1.13.2 workflow catalog as bundled Skills and `opsx-*` commands. It carries an immutable managed CLI invocation with each consumed workflow; it does not intercept a global `openspec` executable.

## Usage

Enable the local package through `dsh.yaml`, build/sync the profile, then use an official workflow Skill or matching slash command. `/openspec-init` returns a validated official CLI command for the current workspace; the adapter itself does not spawn it. `/openspec-upgrade` is an adapter-defined entry for checking and upgrading the managed official OpenSpec stack (CLI and workflow templates), not an official change workflow or a system-global installation upgrade. It separates software upgrade/rollback, project instruction refresh (`openspec update`), and OpenSpec change revision (`opsx-update`). The former management name is not registered as an alias; reloading materializes a new generation and retains old generation directories unchanged.

## Settings

Options are fields of this plugin's own Config (the `dsh-openspec` row). DSH 0.2 persists them in the profile patch and edits them through its settings form; there is no separate settings registry or `settings.yaml` section.

- `updateCheck`: `enabled` (default) or `disabled`; checks only the fixed credential-free npm latest endpoint on Skill/command consumption. `disabled` makes zero network requests.
- `telemetry`: `adapter-off` (default) or `official`; the selected policy is included in the managed invocation.

Neither field is live-editable: a change remounts the plugin, so the managed invocation and generation identity are recomputed from one consistent value. Invalid values are rejected by the Host before the plugin mounts.

Notices appear only in a live consumption result. They do not install packages, append messages, or start turns.

## Upgrade and removal

**WIP:** the overall change is not accepted yet; real-runtime upgrade/reload and policy-denial evidence remain outstanding. The local Host mutation bypass reported by review I1 has been removed: the handler only prepares guidance, and an explicitly requested action must execute `lib/session-updater.js` through the calling session's Bash. Existing sandbox, filesystem and Worktree Session policy applies; a denied call must not be retried through Host or a different cwd. This repair has not been deployed to the VM.

Upgrade/rollback is a source-owned transaction with explicit approval through the calling session's controlled Bash; it does not refresh project instructions or restart DSH as a side effect. Public grammar:

- `/openspec-upgrade` — report adapter state; mutates nothing.
- `/openspec-upgrade upgrade X.Y.Z --approve` / `/openspec-upgrade rollback X.Y.Z --approve` — prepare an exact-version updater command. The caller must be in the recorded authoritative checkout (not a Git worktree); the helper rechecks this before any staging or source write. Without the literal `--approve` no command is offered.
- `/openspec-upgrade refresh-project --approve` — prepare a separately authorized `openspec update` using the active managed generation CLI and the calling session cwd, not Host cwd. No upgrade/sync transaction runs for this operation.

The handler does not execute either action or report it as completed. The agent must run the supplied quoted command with the stated Bash `workdir` and report its actual result. `pending-reload` does not trigger automatic restart. Helper project refresh honors the configured telemetry mode and always disables the official CLI's independent update check.

`scripts/sync.mjs` records the authoritative checkout in `$DSH_HOME/plugins/dsh-openspec/source-checkout.json`; without that record, or when the checkout is a Git worktree, upgrades are blocked. A result of `activation: pending-reload` means the new pin is committed and the previously active generation keeps serving until the next DSH start. Keep the recorded authoritative checkout available. For removal, disable the manifest entry and sync, then after all DSH sessions using the adapter have ended, manually remove obsolete non-active directories under `$DSH_HOME/plugins/dsh-openspec/generations/` if desired. V1 intentionally does not purge generations automatically.

## Recovery

If a prepared journal exists, ordinary upgrades are blocked and Host continues to serve the previous generation. An explicitly approved `/openspec-upgrade rollback X.Y.Z --approve` targeting the journal's exact previous version runs guarded recovery through the same session helper. It rechecks source/journal hashes after staging; user edits require manual reconciliation instead of overwrite. Recovery does not refresh projects or automatically restart DSH.

Transactions lock both this profile and the physical source checkout (across profiles). The source lock is a `dsh-openspec-source-<sha256 of checkout realpath>.lock` file in the OS temporary directory; it records the owner pid, checkout and profile state directory. A killed process can leave either lock. There is no age-based or automatic lock reclamation: after proving the recorded owner is gone and coordinating all profiles, inspect and retain the journal and source bytes, explicitly remove only the verified abandoned locks, then invoke the approved rollback for the journal's exact previous version. Any source drift requires manual reconciliation; never discard the journal just to enable another upgrade. Do not delete a live or unknown-owner lock to make an upgrade proceed. This operator recovery remains a WIP acceptance gap.

## Known scope gap

DSH merges host-level Skill providers into every scope, including Pet executor and Locus child scopes. This adapter follows existing host-provider practice and does not implement per-preset isolation. The issue is tracked cross-provider in `BACKLOG.md` D006 and must be fixed once at the Pet/registry boundary.
