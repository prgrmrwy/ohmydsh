## Why

The ohmydsh launcher hard-codes the `web` profile on its managed start path (`scripts/launcher/main.mjs`, Host argv `['web', …]`). Today the only way to run a non-web profile Host is the official `dsh --profile <name>` passthrough. That bypasses the version pin, ownership probe, and startup history, and when it is started from a DSH session the process lands in that session Host's `dsh-subprocess-<hostpid>-*.scope`. At 2026-11-05 16:58:53 (+08) the daily 3080 Host restarted, its disposal cleared that scope, and the running superagent Host on 3082 was killed with it.

The deployment-side `scripts/dsh-superagent` (another checkout) needs to start the superagent profile through the managed path and run it as its own transient systemd user service (`systemd-run --user --wait --collect --unit=…`). That requires the launcher to support a non-web profile on the managed start path.

## What Changes

- **Profile selection**: `DSH_PROFILE=<profile> dsh -p <port>` starts a managed Host for that profile. `DSH_PROFILE` defaults to `web`. Any non-web profile requires an explicit `-p/--port`, and `$DSH_HOME/profiles/<profile>/cordis.yml` must exist. The official `--profile` passthrough is unchanged.
- **Ownership by profile**: process ownership (`isDshHostProcess`, `classifyPort`, entry verification, `probePort`, `stopServer`) compares argv against the selected profile instead of a hard-coded `web`. `isDshWebProcess` remains as an alias for the web case.
- **Managed start only**: non-web Hosts do not load the no-pet-stop patch and publish no descriptor. `stop/restart` refuses before any side effect; `--allow-legacy-restart` stays explicit manual maintenance.
- **No cross-profile deployment**: under a non-web `DSH_PROFILE`, `build`/`-b`/`reset`/`plugin-update`/`doctor` are refused and the start path skips `autoUpdate`, because these run `sync.mjs`/plugin maintenance against `DSH_PROFILE`. Worktree previews refuse non-web profiles.
- **History**: startup records add `profile=<profile>` (the web Host and the non-web Host share `$DSH_HOME/dsh-startup.log`).
- Docs: `scripts/launcher/README.md` / `README.zh.md` and a `dsh --help` line.

## Non-goals

- Changing the deployment checkout (`dsh-superagent-prototype`) or its `scripts/dsh-superagent`.
- Detach/scope logic in the launcher. Scope isolation belongs to the caller (a transient `systemd-run --user` service; `--scope` does not survive the caller's pane or session scope); the launcher only avoids blocking it.
- An authenticated stop protocol for non-web profiles, or relaxing the no-pet-stop static-module roster.
- Changing `dsh.yaml`, `dsh web` behavior, or the official `--profile` semantics.

## Capabilities

### New Capabilities

- `launcher-host-lifecycle`: managed Host profile selection, port and profile-directory requirements, profile-scoped ownership, the stop/maintenance refusal semantics for non-web profiles, and the web regression invariant.

## Impact

- Code: `scripts/launcher/main.mjs`, `scripts/launcher/process.mjs`, `scripts/launcher/args.mjs` (help text).
- Tests: new `tests/launcher-managed-profile.test.mjs`; existing launcher tests unchanged.
- Deployment: after merging to main, run `dsh build` from the main checkout so the linked `dsh` launcher picks up the code (it is read from the repo, so the files are updated by the merge itself). The 3080 Host keeps running; its behavior is unchanged, so no restart is required. The deployment side then switches `scripts/dsh-superagent` to `systemd-run --user --wait --collect --unit=dsh-superagent-superagent … -- env DSH_PROFILE=superagent dsh --foreground -p 3082 --no-open` and runs live acceptance.
