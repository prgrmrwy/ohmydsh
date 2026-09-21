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

5. **⚠ Reinstall the repo dependencies before building.** `ws-merge` merges into
   the `main` *branch*, and the main checkout sits on `main` — so on a machine
   where the checkout tracks `main`, **the source advances by itself while
   `node_modules` does not**. Measured on `host`: `dsh.yaml` already said
   `0.1.5-rc.2` while `node_modules/@deepseek-ai/dsh-session` was still
   **`0.1.2-rc.1`** (untouched since 2026-09-20). Building with mismatched deps
   fails the local packages (`tsc` exits 2 in `dsh-worktree-session`; `dsh-pet`'s
   compat build dies on `@deepseek-ai/dsh-attachment` / `admitPromptContent`).
   Run **`npm ci`** in the repo checkout, then confirm
   `@deepseek-ai/dsh-session` reports `0.1.5-rc.2`.

6. **⚠ Clear the stale compat cache.** `packages/dsh-pet/compat/subagent/.upstream`
   (and `.storage-upstream`) are shallow clones pinned at whatever reviewed commit
   last built. Measured on `host`: it still sat at `a66e470 release(dsh): 0.1.2-rc.1`.
   The builder then does `git checkout --detach fb2c4b9e…` → **exit 128** (the commit
   is not in the shallow clone) and the launcher **refuses the official-runtime
   fallback**, so the build fails outright. The new `build.mjs` probes for this
   (`git cat-file -e <sha>^{commit}` + re-clone), but deleting the caches is a safe
   belt-and-braces step:

   ```
   rm -rf packages/dsh-pet/compat/subagent/.upstream packages/dsh-pet/compat/subagent/.storage-upstream
   ```

   On devbox this made the builder re-clone correctly at the pinned commit.

### The exact apply sequence (host is a special case)

On `host` the source is **already** at the target commit (the main checkout follows
`main`), so `git pull` is a no-op there and the real work is steps 2–5:

```
1. dsh stop                          # stop writers
2. back up $DSH_HOME                 # mandatory
3. npm ci                            # ★ step 5 above
4. rm -rf packages/dsh-pet/compat/subagent/.upstream \
          packages/dsh-pet/compat/subagent/.storage-upstream   # ★ step 6 above
5. dsh build
6. dsh restart                       # ★ run WITHOUT the build proxy — see below
```

**⚠ The build proxy must not reach the running Host.** `npm ci` and `dsh build` may need
`http_proxy`/`https_proxy` to reach the registry, but if those variables are still exported
when `dsh restart` runs, **the long-lived Host inherits them** and internal providers break.
Measured on devbox: with the proxy inherited, every Trae call failed with
`Trae request failed before receiving a response` / `TRANSPORT` (5/5 retries); after
`unset http_proxy https_proxy no_proxy` and a restart, the same prompts succeeded normally
(stream + a real tool call). Verified by counting the variables in the Host's own
`/proc/<pid>/environ`: **2 with the leak, 0 after**.

So either `unset http_proxy https_proxy no_proxy` before step 6, or scope the proxy to the
build commands only (`http_proxy=… npm ci`, `http_proxy=… dsh build`). If the Host genuinely
needs outbound proxying, configure it through DSH's own egress settings rather than the
process environment.

On `lumevm`, if its checkout is behind, add `git pull --ff-only origin main` before
step 3. Verify with `git rev-parse HEAD` — the target is the commit recorded in
"Exact identities" below.

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

The **data** half of this path is proven (devbox, real data): 7 migrated sessions
with both generations present, zero content loss, all `tool/call` and
`tool/result` preserved 1:1, header fields equal. Upstream suites for generation
atomicity, lease exclusivity, migration refusal and multi-edge publication pass
(468 tests + 2 e2e). See `session-migration-acceptance.md`.

**The RUNTIME half is proven too** — the round-trip drill passed on devbox
(`rollback-drill.md`). The recoverable procedure is:

```
1. dsh stop                                   # stop writers
2. restore the pre-upgrade $DSH_HOME backup   # data first
3. git checkout <pre-upgrade commit>          # source
4. npm ci                                     # ★ dependencies too — mandatory
5. dsh build                                  # old runtime + old plugin set
6. dsh restart                                # launcher accepts only build/stop/restart
```

Verified numbers: `npm ci` → `@deepseek-ai/dsh-session` back to `0.1.2-rc.1`;
`dsh build` exit 0 (143 s, zero failures); `dsh restart` exit 0 (77 s) →
`dshVersion=0.1.2-rc.1`, Pet `ready` + channel connected, GUI `index=200`,
sessions back to `plain 40 / v3 0`, zero errors in the boot segment. The forward
trip (also with `npm ci`) passed twice.

Two traps:

- **Skipping `npm ci` breaks the build.** The three local packages fail
  (`tsc` exit 2 in `dsh-worktree-session`; the `@deepseek-ai/dsh-attachment` /
  `admitPromptContent` error is a *symptom* of mismatched deps, not its own bug —
  it disappears once deps are rolled back).
- **The compat cache is a shallow clone pinned at the current reviewed commit**, so
  the launcher's `git checkout --detach <old commit>` exits 128 and, because it
  **refuses the official-runtime fallback**, the Host does not start at all. Fix:
  `rm -rf packages/dsh-pet/compat/subagent/.upstream packages/dsh-pet/compat/subagent/.storage-upstream`
  and let the builder re-clone. The new `build.mjs` already probes for this, but a
  rollback runs the *old* code, which does not.

So no "runnable old-runtime snapshot" is needed — the pre-upgrade source plus
`npm ci` rebuilds it. Pre-flight requirements are therefore just:

1. a `$DSH_HOME` backup (**mandatory** — lazy v3 migration makes the old runtime
   unable to read migrated sessions);
2. the pre-upgrade commit SHA (`src-head.txt` already records it);
3. network access for `npm ci` on whatever machine performs a rollback.

Also note `dsh start` is **not** a valid verb — the launcher accepts only
`build` / `stop` / `restart` (plain `dsh` starts). A procedure that says
`dsh build && dsh start` fails at the second command.

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
- ~~Explicit rollback rehearsal on a real machine.~~ **Done — the round trip
  passed on devbox** (`rollback-drill.md`): restore data → `git checkout <old>` →
  **`npm ci`** → `dsh build` → `dsh restart` returns to `0.1.2-rc.1` with Pet ready
  and the GUI serving. No runnable-snapshot staging needed; just remember the two
  traps (deps must be rolled back too; clear the compat caches so the old commit
  can be cloned).

## Recommended sequencing

The runtime upgrade itself is verified end-to-end on devbox, including Pet and
the session migration. The remaining items are additive feature upgrades with
their own rollback pins. So the safe order is:

1. Back up, pull, build, restart on `host` (or `lumevm`) with the current pins.
2. Verify the five checks above.
3. Only then take the plugin-pin batch, one group at a time, each with its own
   materialize + verify + rollback.
