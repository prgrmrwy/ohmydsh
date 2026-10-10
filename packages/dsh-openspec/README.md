# dsh-openspec

English · [简体中文](README.zh.md)

<!-- problem -->
OpenSpec's guided, spec-driven workflows for AI agents normally have to be installed into every project and kept up to date by hand, so different projects drift onto different versions. dsh-openspec makes the official workflows available in every DSH workspace as ready-to-use skills and `/opsx-*` commands, all pinned to one reviewed OpenSpec version that you upgrade on purpose.

![Illustration: one managed, pinned OpenSpec adapter exposes the official workflows as skills and /opsx-* commands in a DSH session](docs/overview.png)

**What you get**

- **The full official workflow catalog** as bundled Skills and `opsx-*` slash commands, generated from one exact OpenSpec release (currently 1.13.2, pinned in `package.json`) instead of copied into each project.
- **One managed CLI per workspace session.** Every consumed workflow carries an immutable, version-bound CLI invocation; no global `openspec` executable is intercepted or required.
- **`/openspec-init`** returns a validated official init command for the current workspace, and **`/openspec-upgrade`** prepares reviewed upgrade, rollback and project-refresh commands.
- **Quiet and private by default.** The only network request is an optional, credential-free version check, and telemetry of the managed CLI is off unless you turn it on.
- **Reversible.** Disable the manifest entry and sync; old generations are retained, never silently rewritten.

**Install.** In an ohmydsh setup this package is managed through `dsh.yaml` (entry `dsh-openspec`, `source: local`): enable it, then run `dsh build`. This README documents no standalone installation. For the surrounding repository see the [plugin index](../../README.md#plugins).

**Jump to:** [How it works](#how-it-works) · [Usage](#usage) · [Configuration](#configuration) · [Generations and the host dependency layout](#generations-and-the-host-dependency-layout) · [Safety and privacy](#safety-and-privacy) · [Upgrade and removal](#upgrade-and-removal) · [Recovery](#recovery) · [Known scope gap](#known-scope-gap) · [Development](#development) · [Attribution](#attribution)

## How it works

A DSH host-level adapter exposes the official OpenSpec workflow catalog as bundled Skills and `opsx-*` commands. It carries an immutable managed CLI invocation with each consumed workflow; it does not intercept a global `openspec` executable.

The Skill and command bodies come from the pinned official release's own renderer, followed by one closed-format adapter block that binds the CLI and templates to that version. Both the Skill path and the slash-command path deliver byte-identical blocks. The surface follows the invoking workspace and the effective official profile and delivery configuration, so a workflow that is dropped there stops being listed.

## Usage

Enable the local package through `dsh.yaml`, build/sync the profile, then use an official workflow Skill or the matching slash command.

- `/openspec-init` returns a validated official CLI command for the current workspace; the adapter itself does not spawn it. By default it is non-interactive with `--tools none --no-copilot-cloud --no-animation`, so no project tool Skills are duplicated.
- `/openspec-upgrade` is an adapter-defined entry for checking and upgrading the managed official OpenSpec stack (CLI and workflow templates), not an official change workflow or a system-global installation upgrade. It separates software upgrade/rollback, project instruction refresh (`openspec update`), and OpenSpec change revision (`opsx-update`). The former management name is not registered as an alias; reloading materializes a new generation and retains old generation directories unchanged.

## Configuration

Options are fields of this plugin's own Config (the `dsh-openspec` row), persisted in the profile patch. There is no separate settings registry or `settings.yaml` section.

- `updateCheck`: `enabled` (default) or `disabled`; checks only the fixed credential-free npm latest endpoint on Skill/command consumption. `disabled` makes zero network requests.
- `telemetry`: `adapter-off` (default) or `official`; `adapter-off` sets `OPENSPEC_TELEMETRY=0` on the managed CLI, `official` leaves the official CLI's own setting in charge. The selected policy is included in the managed invocation.

Neither field is live-editable: a change remounts the plugin, so the managed invocation and generation identity are recomputed from one consistent value. The fields are deliberately not marked volatile, so edit them in the `config` of the `dsh-openspec` row in the profile patch rather than expecting them in a settings form. Invalid values are rejected by the Host before the plugin mounts.

Notices appear only in a live consumption result. They do not install packages, append messages, or start turns.

## Generations and the host dependency layout

A generation is an immutable copy of the pinned official release plus its resolved dependency closure; `$DSH_HOME/plugins/dsh-openspec/generations/<identity>/` is what every Skill body and command block points at. Two properties keep that copy reproducible:

- Closure directories are named from each dependency's own identity (name, version, own content) and its direct dependencies' identities — never from a host filesystem path. Reinstalling the same versions under a different physical layout (nested copies hoisted to the profile root, for example) therefore reproduces byte-identical content, and the existing generation is reused instead of colliding.
- The identity covers the resolved closure (and the telemetry mode), so a real dependency change materializes and activates a new generation instead of colliding with the existing one. Existing generations are retained and never rewritten.

If preparing a generation or registering the adapter's Skills and commands fails, the adapter undoes whatever it had already registered — no partial surface stays visible — and writes exactly one error line through the host logger:

```
dsh-openspec: startup contributions failed (<code>); no Skills or commands were registered
```

`<code>` is an error class such as `generation-identity-collision`, `generation-invalid` or `dependency-closure-ambiguous`, never a path or upstream text. That line means the session surface is absent by design rather than silently missing; a restart re-materializes it once the recorded problem is gone. The investigation that led to this design is recorded in [`docs/generation-identity.md`](docs/generation-identity.md).

## Safety and privacy

- **No Host-side mutation.** The handlers only prepare guidance. An explicitly requested init, upgrade, rollback or refresh must be run by the agent through the calling session's Bash, under the existing sandbox, filesystem and Worktree Session policy. A denied call must not be retried through the Host or from a different cwd.
- **Validated arguments.** `/openspec-init` accepts only the official tool and profile values of the pinned release, and a `language` matching a fixed pattern; unsafe or unknown arguments yield a typed validation error and no command. The command string is built and shell-quoted by adapter code, never by the model.
- **Network.** With `updateCheck: enabled`, one request to the fixed npm endpoint for `@fission-ai/openspec` latest reads only the `version` field, uses no credentials, and is cached and backed off. Nothing about sessions, code, paths or provider credentials is sent.
- **Telemetry.** The managed CLI's telemetry is off by default (`telemetry: adapter-off`), and project refresh always disables the official CLI's independent update check.

## Upgrade and removal

**Status: work in progress.** The overall change is not accepted yet; real-runtime upgrade/reload and policy-denial evidence is still outstanding (see the [archived change verification](../../openspec/changes/archive/2026-10-09-add-dsh-openspec-adapter/verify.md)). The local Host mutation bypass reported by review I1 has been removed: the handler only prepares guidance, and an explicitly requested action must execute `lib/session-updater.js` through the calling session's Bash. This repair has not been verified in a deployed runtime.

Upgrade/rollback is a source-owned transaction with explicit approval through the calling session's controlled Bash; it does not refresh project instructions or restart DSH as a side effect. Public grammar:

- `/openspec-upgrade` — report adapter state; mutates nothing.
- `/openspec-upgrade upgrade X.Y.Z --approve` / `/openspec-upgrade rollback X.Y.Z --approve` — prepare an exact-version updater command. The caller must be in the recorded authoritative checkout (not a Git worktree); the helper rechecks this before any staging or source write. Without the literal `--approve` no command is offered.
- `/openspec-upgrade refresh-project --approve` — prepare a separately authorized `openspec update` using the active managed generation CLI and the calling session cwd, not Host cwd. No upgrade/sync transaction runs for this operation.

The handler does not execute either action or report it as completed. The agent must run the supplied quoted command with the stated Bash `workdir` and report its actual result. `pending-reload` does not trigger automatic restart. Helper project refresh honors the configured telemetry mode and always disables the official CLI's independent update check.

`scripts/sync.mjs` records the authoritative checkout in `$DSH_HOME/plugins/dsh-openspec/source-checkout.json`; without that record, or when the checkout is a Git worktree, upgrades are blocked. A result of `activation: pending-reload` means the new pin is committed and the previously active generation keeps serving until the next DSH start. Keep the recorded authoritative checkout available.

**Removal.** Disable the manifest entry and sync, then after all DSH sessions using the adapter have ended, manually remove obsolete non-active directories under `$DSH_HOME/plugins/dsh-openspec/generations/` if desired. V1 intentionally does not purge generations automatically.

## Recovery

If a prepared journal exists, ordinary upgrades are blocked and Host continues to serve the previous generation. An explicitly approved `/openspec-upgrade rollback X.Y.Z --approve` targeting the journal's exact previous version runs guarded recovery through the same session helper. It rechecks source/journal hashes after staging; user edits require manual reconciliation instead of overwrite. Recovery does not refresh projects or automatically restart DSH.

Transactions lock both this profile and the physical source checkout (across profiles). The source lock is a `dsh-openspec-source-<sha256 of checkout realpath>.lock` file in the OS temporary directory; it records the owner pid, checkout and profile state directory. A killed process can leave either lock. There is no age-based or automatic lock reclamation: after proving the recorded owner is gone and coordinating all profiles, inspect and retain the journal and source bytes, explicitly remove only the verified abandoned locks, then invoke the approved rollback for the journal's exact previous version. Any source drift requires manual reconciliation; never discard the journal just to enable another upgrade. Do not delete a live or unknown-owner lock to make an upgrade proceed. This operator recovery remains a WIP acceptance gap.

## Known scope gap

DSH merges host-level Skill providers into every scope, including Pet executor and Locus child scopes. This adapter follows existing host-provider practice and does not implement per-preset isolation. The issue is tracked cross-provider in [`BACKLOG.md`](../../BACKLOG.md) D006 and must be fixed once at the Pet/registry boundary.

## Development

Install dependencies from the repository root with `npm install` or `npm ci`, then run package commands with `--workspace dsh-openspec`: `build` and `typecheck` use `tsc`, `test` runs `vitest` (and builds first). The generated `lib/` is not tracked.

Current behavior is specified in [`dsh-openspec-session`](../../openspec/specs/dsh-openspec-session/spec.md), [`dsh-openspec-updates`](../../openspec/specs/dsh-openspec-updates/spec.md) and [`dsh-openspec-routing-extension`](../../openspec/specs/dsh-openspec-routing-extension/spec.md).

## Attribution

This package is an original ohmydsh implementation and does not copy source code from prior art. Prior art acknowledged: `@codigoconelmer/dsh-openspec@0.1.0`, licensed under MIT. OpenSpec CLI and workflow templates are provided by `@fission-ai/openspec`; see its package metadata and license for the upstream license and notices. Details are in [`NOTICE`](NOTICE).
