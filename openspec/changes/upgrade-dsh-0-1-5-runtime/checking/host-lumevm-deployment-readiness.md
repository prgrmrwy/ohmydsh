# host/lumevm deployment readiness (task 10.3)

Scope: this repository never operated `host` or `lumevm`. Everything below is
what the user needs in order to run `git pull` + `dsh build` + `dsh restart`
there. Neither machine is marked as accepted by this change.

## Exact identities to deploy

| Item | Value |
|---|---|
| Branch | `main` |
| Commit | see `git rev-parse main` at cutover; last verified devbox candidate was `7cb49e3` |
| `dshVersion` | `0.1.5-rc.2` |
| Upstream tag / commit | `dsh-v0.1.5-rc.2` / `fb2c4b9e698e30edb738bca4cf0618587db7d203` |
| Pet compat artifact | `@deepseek-ai/dsh-subagent@0.1.5-rc.2-locus-settlement-notice.2` |
| Pet storage artifacts | `0.1.5-rc.2-locus-atomic.2` |
| `autoUpdate` | `false` (unchanged) |

Upstream dist-tags re-checked at write time: `latest`/`next` = `0.1.5-rc.2`,
`alpha` = `0.1.6-alpha.2` (not tracked). No drift.

## Pre-flight on each machine

1. **Stop the writer first.** `dsh stop`, then confirm no DSH process holds
   `$DSH_HOME`. A concurrent writer during a format migration is the one
   unrecoverable scenario.
2. **Back up `$DSH_HOME` while stopped**, and verify the archive. On devbox the
   equivalent step produced `dsh-home.tgz` (~115 MB, 18,214 entries). Keep the
   old `dsh.yaml` and the resolved old runtime alongside it.
3. **Confirm the local plugin environment.** `.env.local` is machine-private
   and gitignored; the launcher sources it. In particular `DSH_TRAEX_BRIDGE`
   gates the Trae bridge (`enabledEnv`, default off) and `DSH_MEMEX_ENABLED`
   gates memex. Whatever the machine had before, keep it.
4. **Profile registry.** The profile `.npmrc` is per-machine and may point at
   an internal mirror. devbox needed `registry=https://registry.npmjs.org/`
   plus a `@byted` scope line. Do not let the build silently inherit a mirror
   that has not mirrored the new packages.

## The one thing that changes the risk profile

**Rolling back the runtime alone is NOT a rollback.** Session logs migrate
lazily to format v3 when a session is first opened, the v0 generation is
retained on disk beside it, but the **old `0.1.2-rc.1` runtime cannot read v3**.
So after any session has been opened post-upgrade:

- recovering requires stopping writers, restoring the `$DSH_HOME` backup, and
  only then restoring the old runtime — in that order;
- reverting `dsh.yaml` alone will leave the Host unable to read the sessions it
  already migrated.

This is why the backup in pre-flight is mandatory rather than nice-to-have.

Evidence that this path is safe (devbox, real data): 7 migrated sessions with
both generations present, zero content loss, all `tool/call` and `tool/result`
preserved 1:1, header fields equal. Upstream suites for generation atomicity,
lease exclusivity, migration refusal and multi-edge publication pass
(468 tests + 2 e2e). See `session-migration-acceptance.md`.

## Verification after restart

1. `dsh build` must report `no changes` on a second run (idempotence).
2. Host resolves the Pet compat runtime, not the official package:
   `dsh-server-bin.mjs` should print
   `DSH_RUNTIME_KIND=customization-host-runtime`, `owner=dsh-pet`.
3. Pet logs `ready — routes registered` and **no** `locus-unavailable`.
4. A Feishu `@` in a group creates a locus and replies (the end-to-end path that
   took seven fixes on devbox — see `pet-feishu-locus-acceptance.md`).
5. Refresh the machine's own existing GUI URL and confirm the composed feature
   set. A spare-port instance does not count as that machine's acceptance.

## What is still outstanding (not blockers to upgrade, but not done)

These are pending tasks in the change; none of them are required for the runtime
to run, but they are why the change should not yet be archived:

- **Approved plugin upgrades are not pinned yet.** `cost-meter` 1.7.30,
  `better-sidebar` 0.19.1, `width-tiers` 1.0.5, `skin-center`/`session-archive`
  0.3.24, `cockpit-bridge` 0.4.0, Trae 0.1.15. The manifest still carries the
  rollback pins. `better-sidebar@0.18.0` is running on 0.1.5 today and only
  imports stable externals (`react`, `dsh-client-ui-primitives`), so this is a
  known-benign declaration lag rather than a load failure — but it is unverified
  by the change's own gate.
- **Trae 0.1.15** must be validated only where it is actually enabled; do not
  ship an unverified pin.
- **Archify** user-visible behavior (single provider, generate/validate/deliver/
  export) is unverified.
- **Worktree isolated Web acceptance** (text/image/file first submission).
- **Proxy surface** for 0.1.5 outbound paths.
- **Explicit rollback rehearsal** on a real machine.

## Recommended sequencing

The runtime upgrade itself is verified end-to-end on devbox, including Pet and
the session migration. The remaining items are additive feature upgrades with
their own rollback pins. So the safe order is:

1. Back up, pull, build, restart on `host` (or `lumevm`) with the current pins.
2. Verify the five checks above.
3. Only then take the plugin-pin batch, one group at a time, each with its own
   materialize + verify + rollback.
