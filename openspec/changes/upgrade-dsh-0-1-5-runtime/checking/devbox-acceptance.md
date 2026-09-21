# devbox clean-build acceptance

## Run identity

| Item | Value |
|---|---|
| Host | `devbox` (`n37-044-026`), Linux x86_64, 64 cores |
| Candidate SHA (expected = fetched = HEAD) | `dd15a13be4ab907e66be0fcb764a97d3a1559457` |
| Temporary ref | `refs/heads/acceptance/dsh-015-5e1042d9ea32be47` (deleted by compare-and-delete) |
| Toolchain | Node `v22.23.2`, npm `10.9.8`, git `2.20.1` |
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

## Environment limitations (not candidate defects)

1. **`git init -b` unsupported** — devbox git is `2.20.1`; `-b` needs >= 2.28.
   This appears only in **test fixtures** (18 files). The product path uses
   `git worktree add -b`, which was verified working on git 2.20. This causes
   the remaining `dsh-worktree-session` test failures on this host.
2. **`@touchskyer/memex` not installed globally** — `dsh-memex` shells out to
   that CLI; 9 of its tests need it. Not part of this upgrade.
3. **inotify `max_user_watches = 8192`** — a first Host start crashed with
   `ENOSPC` on chokidar. Two unrelated DSH hosts already run on this box.
   Re-running with `CHOKIDAR_USEPOLLING=1` started cleanly, so this is host
   capacity, not a defect.

None of these three are caused by the candidate, and all would also affect
`0.1.2-rc.1` on this host.

## Cleanup ledger

| Item | State |
|---|---|
| My Hosts (ports 39517/39519/39521) | stopped |
| Pre-existing Hosts (3080/3081) | **preserved, untouched** |
| Run root | removed |
| Temporary remote ref | deleted after SHA compare-and-delete |
| Local `127.0.0.1:3080` GUI | never touched |

## Decision

devbox clean-build acceptance **passed** for the runtime, plugin build, Pet
compatibility runtime and Host startup, and it caught one real deployment
blocker that local runs could not see.

Still outstanding before production: real Session v0->v3 migration with
sanitized samples, Pet runtime capability probes against a live child,
remote-plugin user-visible activation, and browser-level GUI verification.
