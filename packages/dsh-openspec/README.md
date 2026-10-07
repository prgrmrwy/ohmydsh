# dsh-openspec

A DSH host-level adapter exposing the official OpenSpec 1.13.2 workflow catalog as bundled Skills and `opsx-*` commands. It carries an immutable managed CLI invocation with each consumed workflow; it does not intercept a global `openspec` executable.

## Usage

Enable the local package through `dsh.yaml`, build/sync the profile, then use an official workflow Skill or matching slash command. `/openspec-init` returns a validated official CLI command for the current workspace; the adapter itself does not spawn it. `/dsh-openspec-manage` reports adapter state and separates three operations: changing the adapter's pinned runtime, project instruction refresh (`openspec update`), and OpenSpec change revision (`opsx-update`).

## Settings

Settings use namespace `dsh-openspec`:

- `updateCheck`: `enabled` (default) or `disabled`; checks only the fixed credential-free npm latest endpoint on Skill/command consumption.
- `telemetry`: `adapter-off` (default) or `official`; the selected policy is included in the managed invocation.

Notices appear only in a live consumption result. They do not install packages, append messages, or start turns.

## Upgrade and removal

Adapter upgrade/rollback is a source-owned transaction and requires explicit approval; it does not run `openspec update` or restart DSH. Run it from the authoritative checkout's DSH session (never a Worktree Session):

- `/dsh-openspec-manage` — report adapter state; mutates nothing.
- `/dsh-openspec-manage upgrade X.Y.Z --approve` / `rollback X.Y.Z --approve` — exact stable versions only; without the literal `--approve` flag the request is blocked.
- `/dsh-openspec-manage refresh-project --approve` — runs `openspec update` for the project; separate from upgrade.

`scripts/sync.mjs` records the authoritative checkout in `$DSH_HOME/plugins/dsh-openspec/source-checkout.json`; without that record, or when the checkout is a Git worktree, upgrades are blocked. A result of `activation: pending-reload` means the new pin is committed and the previously active generation keeps serving until the next DSH start. Keep the recorded authoritative checkout available. For removal, disable the manifest entry and sync, then after all DSH sessions using the adapter have ended, manually remove obsolete non-active directories under `$DSH_HOME/plugins/dsh-openspec/generations/` if desired. V1 intentionally does not purge generations automatically.

## Known scope gap

DSH merges host-level Skill providers into every scope, including Pet executor and Locus child scopes. This adapter follows existing host-provider practice and does not implement per-preset isolation. The issue is tracked cross-provider in `BACKLOG.md` D006 and must be fixed once at the Pet/registry boundary.
