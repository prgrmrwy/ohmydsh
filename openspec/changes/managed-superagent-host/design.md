## Context

The managed start path in `scripts/launcher/main.mjs` writes the profile as `web`. Process ownership in `scripts/launcher/process.mjs` (`isDshWebProcess`) also hard-codes `argv[2] === 'web'`, and `classifyPort`, `verifyEntry`, and `probePort` depend on it. `loadEnvironment` already returns `profile: env.DSH_PROFILE || 'web'`, but nothing uses it. `scripts/sync.mjs`, `scripts/plugin-list.mjs`, and `scripts/lib/plugin-updates.mjs` pick their target profile from `DSH_PROFILE`.

## Decisions (user-confirmed; not reopened here)

1. **Interface**: `DSH_PROFILE=<profile> dsh -p <port>`. Default `web`; a non-web profile requires an explicit port. `--profile` stays an official passthrough.
2. **Scope isolation belongs to the caller**: `systemd-run --user --scope` in the deployment script. The launcher adds no detach logic. `--foreground` keeps the launcher as the caller-visible parent.
3. **Managed start only**: no no-pet-stop patch for non-web profiles, so no descriptor; non-web stop/restart fails closed. `--allow-legacy-restart` stays explicit manual maintenance.

## Implementation

### `process.mjs`

- `validProfile(name)`: `^[A-Za-z0-9][A-Za-z0-9._-]*$`. A profile becomes `argv[2]` and a path segment, so empty strings, leading `-`, separators, and `..` are rejected.
- `isDshHostProcess(record, port, { platform, profile = 'web' })`: same checks as before, with exact `argv[2] === profile`. `isDshWebProcess` is a fixed-`web` alias, so existing callers and tests keep their meaning.
- `classifyPort` forwards `options.profile`. `verifyEntry` takes the profile. `probePort` accepts `profile = 'web'` and returns `probe-error` for an invalid name before running any command.
- The macOS `ps` recovery regex accepted only a `web …` tail. It now accepts any profile-shaped token; the profile itself is still enforced by `isDshHostProcess`.
- `stopServer` forwards `profile` to its default probe.

### `main.mjs`

- `guardManagedProfile` runs right after argument parsing and preview detection, before any probe, script, stop, or spawn. For a non-web profile it checks, in order:
  1. Invalid name → refuse.
  2. `build`, `-b`/`--build`, `reset`, `plugin-update`, `doctor` → refuse. These run `sync.mjs` or plugin maintenance against `DSH_PROFILE` and would deploy ohmydsh into the other profile.
  3. `history` → allowed (read-only, no port needed).
  4. No explicit `-p/--port` (`DSH_PORT` does not count) → refuse.
  5. Isolated preview home → refuse (previews are web-only).
  6. `stop`/`restart` without `--allow-legacy-restart` → refuse.
  7. Start, or restart with maintenance, while `$DSH_HOME/profiles/<profile>/cordis.yml` is missing → refuse.
- Every `probe` call and the `guardedStop` probe binding carry the profile. The binding applies `profile` after `...options`, so `stopServer`'s own default does not override it. `preparePetStop` gets the profile (descriptor lookup is profile-scoped and fails closed on mismatch).
- `autoUpdate` runs only for `web`. It can rewrite `dsh.yaml` and run `sync.mjs` into `DSH_PROFILE`, a third cross-profile write path the handoff did not list. `ensurePrerequisites` does not read `DSH_PROFILE` and still runs.
- `protocolPatch` is generated only when `profile === 'web'` and the runtime is not `env`. Host argv is `[profile, ...protocolPatch, '--port', …]`.
- `verifyStopProtocol` after `restart --allow-legacy-restart` runs only for `web`. A non-web replacement never publishes a descriptor, so verification would always fail after the Host was already restarted.
- The startup record adds `profile=<profile>` for every profile, including web, because both Hosts share one `$DSH_HOME/dsh-startup.log`.

### Not changed

- `pet-stop.mjs`: already profile-aware; it only receives the profile now.
- `no-pet-stop-plugin.mjs` and `no-pet-known-modules.json`: the static-module roster is not relaxed to make a custom bundle certify.
- `session-restart.mjs`: a non-web restart is refused before session scheduling unless maintenance is explicit. The scheduled re-exec inherits the caller environment, `DSH_PROFILE` included.
- Direct `node scripts/sync.mjs` with `DSH_PROFILE` set remains the existing low-level behavior. Only the launcher entry is guarded.

## Safety boundary

- A non-web Host has no descriptor, so stop stays refused. There is no automatic downgrade to SIGTERM/SIGKILL.
- No new escape hatch skips ownership checks. Ownership is still a full process identity (Node executable, verified `@deepseek-ai/dsh` entry, exact profile, exact single `--port`).
- Profiles are mutually exclusive: a web probe classifies a superagent listener as `unknown`, so `dsh stop`/`dsh restart` on that port refuses, and the reverse also holds.
- `--allow-legacy-restart` keeps its meaning: explicit manual maintenance with no drain guarantee.

## Known limits

- If a profile's `cordis.patch.yml` overrides the `webserver` entry's `config`, that block replaces the Web bundle's port configuration and the Host ignores `--port`. A `port:` there wins over `-p`; a `config` without `port` fails startup (`$.port missing required value`). Ownership then fails because argv `--port` and the real listener differ. Either keep the configured port equal to `-p`, or remove the `webserver` entry and let `-p` decide (verified 2026-11-05 with 0.2.1-rc.5).
- A non-web Host started in background mode appends to the shared `$DSH_HOME/dsh.log`. The deployment caller uses `--foreground` in its own scope.
- `-p 3080` with a non-web profile is not refused. If a web Host holds 3080, ownership refuses the start; if 3080 is free, the profile Host takes it. Choosing the port is the caller's job.
- Writing `dsh web` together with `DSH_PROFILE=<non-web>` starts the non-web profile (`web` is an ignored token for the argument parser, as before).
