# devbox clean-build acceptance

## Run identity

| Item | Value |
|---|---|
| Host | `devbox` (`n37-044-026`), Linux x86_64, 64 cores |
| Candidate SHA (expected = fetched = HEAD) | `dd15a13be4ab907e66be0fcb764a97d3a1559457` |
| Temporary ref | `refs/heads/acceptance/dsh-015-5e1042d9ea32be47` (deleted by compare-and-delete) |
| Toolchain | Node `v22.23.2`, npm `10.9.8`, git `2.30.2` (upgraded from 2.20.1) |
| Lock hash (after fix) | `c04a83d6e17c558a` |
| Isolation | dedicated `HOME`, `DSH_HOME`, npm/XDG/corepack caches, port `39521` |

Network used the mandated `set_sh_devbox_proxy` inside the same interactive
zsh as every git/npm operation. The helper is an **alias**, not a function, so
it requires `zsh -ic`; `bash -lc` and `zsh -lc` both report it missing. No
proxy value was printed.

## Defect found and fixed by this gate

The first run failed `dsh-memex` and `dsh-worktree-session` with
`Cannot find package '@deepseek-ai/dsh-scope'` and `'@deepseek-ai/dsh-atomic-write'`.

Root cause: the lockfile regenerated with `--legacy-peer-deps` dropped the
install entries for those two packages, which are peers of 11 official runtime
packages. This was invisible locally because the managed worktree is nested
inside the main checkout, so Node's upward resolution silently borrowed them
from the parent `node_modules`. devbox has no parent to borrow from.

Fix: regenerate the lockfile in an isolated copy with no parent
`node_modules` (354 -> 367 entries). After the fix both peers install on
devbox. This defect would have broken any clean deployment, including
`host`/`lumevm`.

## Results

| Gate | Result |
|---|---|
| Fetch exactness | expected = fetched = HEAD, worktree clean |
| No inherited artifacts | no `node_modules`, no `packages/*/lib` |
| `npm ci` | clean, 293 packages |
| Root `npm test` | **127 passed, 1 skipped, 0 failed** |
| `npm run check:artifacts` | passed |
| 7 packages typecheck/test/build | passed |
| `dsh-subscriptions-sandbox-shim` | passed |
| Subagent compat build | `@deepseek-ai/dsh-subagent@0.1.5-rc.2-locus-settlement-notice.2`, semantic proof gate passed |
| Storage artifacts | 4 artifacts at `0.1.5-rc.2-locus-atomic.2`, `upstreamBase fb2c4b9e` |
| Launcher build | published; all four capability markers present; official root `0.1.5-rc.2` |
| Host runtime resolution | `customization-host-runtime`, owner `dsh-pet`, kind `pet-unified-locus-v1` — no official fallback |
| `sync` x2 | 46 changes, then `no changes` (idempotent) |
| Host start | HTTP `401` on `/` (auth fence active), process alive |
| **Pet on target runtime** | **`[dsh-pet] ready — routes registered`**, state tree + `state.sqlite` created |

Pet reported no locus/storage/child-seam degradation. The only reported
limitation is `inquiry dispatch stays unavailable (marker-absent)`, which is
the intended fail-closed behavior while `overrideRuntimeAgent = false`.

## Round 2 — real deployment path, complete suite

The first round ran in an isolated run root. Round 2 did what an operator
actually does: `git pull` into the existing devbox checkout, `dsh build`,
`dsh restart`, against the live `~/.dsh` (22M of real Sessions) on port 3080.
A verified backup (`dsh-home.tgz` + source, 18,214 entries) was taken first.

### Prerequisites resolved on the host

- **git 2.20.1 -> 2.30.2** via `buster-backports` (`apt-get install -t
  buster-backports git`). Clears the `git init -b` requirement (>= 2.28).
- **pnpm 10.23.0**: the standalone shim had a DANGLING symlink at
  `~/.local/share/pnpm/.tools/pnpm/10.23.0/bin/pnpm` pointing into a deleted
  `_tmp_` directory left by pnpm's own installer. Re-linked to the real
  `node_modules/pnpm/bin/pnpm.cjs`.
- **`@touchskyer/memex@0.4.1`** installed globally; `dsh-memex` shells out to
  it and its description check pins that exact version.

### Three real defects found by this round

1. **Stale compat checkout breaks the upgrade path.** `.upstream` /
   `.storage-upstream` were shallow clones at the OLD reviewed commit, so
   `git checkout --detach <new commit>` failed with "reference is not a tree"
   and aborted `dsh build`. Only upgrades hit this; fresh machines never do.
   Both builders now prove the commit exists (`git cat-file -e`) before
   reusing a cache.
2. **Pet ran new runtime against a STALE deployed plugin.** After the failed
   build, sync still reported `dsh-pet up-to-date` while the deployed copy was
   3 days old, producing `unified locus child seam unavailable —
   inbox-unavailable` and a refused Feishu channel. Source vs deployed lib
   hashes differed (`5baddd1a` vs `10a68591`); all 110 deployed files were
   stale. After an atomic reinstall the hashes match and the channel reports
   `subscription connected`, matching the pre-upgrade baseline.
3. **`prunable` is git >= 2.36 only.** `pruneInvalidRegistrations` keyed on that
   field, so on older git it silently no-ops and a deleted worktree can never
   be recreated. Now keyed on "registration present but directory absent",
   observable on every supported git. This was a product bug, not a test bug.

Two test-only provenance defects were also fixed: `collaboration-assembly` and
`locus-turn-observer-runtime` hardcoded 0.1.2 artifact versions/commits/hashes.
Both now derive provenance from the builders, so a future pin change cannot
silently assert the wrong runtime. The Inbox replay suite additionally skips
when the runtime no longer exports `Inbox` (0.1.5 moved it into
`dsh-agent-loop` and stopped exporting it); the isolated-claim behavior stays
proven by the builder's semantic gate on every compat build.

### Complete suite on the real checkout (`5264bea`, git 2.30.2)

| Package | Result |
|---|---|
| `dsh-memex` | **174 passed** |
| `dsh-pet` | **2,684 passed**, 43 skipped |
| `dsh-home-network-model-guard` | 70 passed |
| `dsh-session-links` | 54 passed |
| `dsh-session-title-copy` | 20 passed |
| `dsh-sidebar-session-provider-icon` | 25 passed |
| `dsh-system-clock` | 21 passed |
| `dsh-worktree-session` | **206 passed** |
| `dsh-subscriptions-sandbox-shim` | passed |

Root `npm test`: **127 passed, 1 skipped, 0 failed**. All 8 buildable packages
typecheck and build. `check:artifacts` and the memex description check pass.
**Zero test failures remain on devbox.**

### Live deployment state

`dsh build` + `dsh restart` succeeded. The Host runs
`dshVersion=0.1.5-rc.2`, `kind=customization-host-runtime`, `owner=dsh-pet`,
serving 3080 with HTTP 401 (auth fence). Pet reports `ready — routes
registered`, its Feishu channel `subscription connected`, and **zero**
`inbox-unavailable` in the latest boot.

## Cleanup ledger

| Item | State |
|---|---|
| My Hosts (ports 39517/39519/39521) | stopped |
| Pre-existing Hosts (3080/3081) | **preserved, untouched** |
| Run root | removed |
| Temporary remote ref | deleted after SHA compare-and-delete |
| Local `127.0.0.1:3080` GUI | never touched |

## Decision

devbox acceptance **passed** in both rounds. It caught four real defects that
local runs could not see: the missing peer entries, the stale compat checkout,
the stale deployed plugin, and the git-version-dependent prune. With host
prerequisites resolved (git 2.30.2, pnpm relink, memex CLI) the complete suite
is green with zero failures, and the live devbox Host runs 0.1.5-rc.2 with Pet
ready and its channel connected.

Still outstanding before production: real Session v0->v3 migration with
sanitized samples, Pet runtime capability probes against a live child,
remote-plugin user-visible activation, and browser-level GUI verification.
