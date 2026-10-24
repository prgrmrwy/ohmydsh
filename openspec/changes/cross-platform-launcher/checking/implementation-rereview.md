# Focused re-review of implementation-review repairs (read-only)

Scope: only C1, C2 and M1–M5 from `implementation-review.md`, checked against `implementation-repairs.md` and the current `scripts/launcher/{runner,main,process,ui}.mjs`. No code was changed.
Ran: `node --test tests/launcher-{runner,process,ui,lifecycle,contract}.test.mjs` → 57/57 passed. `tests/launcher-lifecycle.test.mjs` alone (real Linux processes) → 7/7 passed.
Not verified here: real macOS, Windows console-close, full public-manifest gate.

| Finding | Verdict | Evidence |
|---|---|---|
| C1 no implicit deadline | ACCEPTED | `runner.mjs:8` `bounded = Number.isFinite(timeoutMs) && timeoutMs > 0`; `:12` timer exists only when bounded. The only production `timeoutMs` caller of `run` is `main.mjs:135` (taskkill, 5 s). `runScript` (`main.mjs:39`) and `maintenance.mjs:16-60` pass none. Test `launcher-runner.test.mjs:21-32` checks that `{}` and `Infinity` create no timer. |
| C1 owned-tree kill on explicit timeout | ACCEPTED | `runner.mjs:9` creates a detached group only when bounded on POSIX. `:18` `process.kill(-child.pid,'SIGKILL')`. `:17` win32 `taskkill /T /F` on this child's PID. `:21` reports status 124. Test `:5-19` checks the descendant is reclaimed (zombie or gone). |
| C2 bare `node` argv0 + independent executable | ACCEPTED (unit only) | `process.mjs:107` accepts a bare `node` argv0. `:111-114` gets the executable from PID-scoped `lsof -d txt -Fn` and never resolves it through PATH. Test `launcher-process.test.mjs:19-36`. |
| C2 locale | ACCEPTED (unit only) | `process.mjs:100` runs `ps` with `LC_ALL:'C', LANG:'C'`. Test asserts `LC_ALL==='C'` (`:34`). |
| M1 non-`node` executable names | ACCEPTED | `process.mjs:64-65` (`realpath(executable)===realpath(execPath)`) and `:90`. The managed spawn uses `nodePath: process.execPath` (`package-manager.cjs:87`). |
| M2 failed-readiness escalation | ACCEPTED on POSIX | `main.mjs:139-144`: TERM to `-child.pid`, wait ≤500 ms, KILL while the leader is still alive, wait ≤500 ms, `unref()`. Only this exact ChildProcess is signalled (`:134`). Test `launcher-lifecycle.test.mjs:96-102` (TERM ignored, port empty, launcher returned). |
| M3 xdg-open | ACCEPTED | `ui.mjs:106-108`: detached spawn, `stdio:'ignore'`, `unref` on `spawn`; ENOENT goes to the manual URL (`:107`, `:112`). |
| M4 startup record | ACCEPTED | `main.mjs:159-161` (`plugins=[…]`, `Host runtime:`) and `:49` (`  - `). Assertions in `launcher-lifecycle.test.mjs:58-60`. |
| M5 concurrent loser reuse | ACCEPTED | `main.mjs:147-154`: after an early exit or a raced owner, it probes again and returns 0 only for `owned`, which `probePort` reaches only after package verification (`process.mjs:148-152`). Test `launcher-lifecycle.test.mjs:89-94`. |

## Residuals (none blocks the Linux gate)
- **R1 (Windows, low).** `main.mjs:135`: after taskkill there is no bounded wait and no `child.unref()`; that only happens in the POSIX branch (`:144`). If taskkill fails on our own child, the detached handle keeps `dsh` alive until the Host exits. Fix: race `closed` with a timeout, then `child.unref()`, in both branches.
- **R2 (POSIX, low).** `main.mjs:142`: the group SIGKILL only runs while the leader is alive. If the leader exits on TERM but a group member ignores TERM, that member survives. The real Host is a direct node child, so this is not concrete today.
- **R3 (real macOS validation item).** `LC_ALL=C` also forces `LC_CTYPE=C`. BSD `ps` may then escape non-ASCII argv bytes, for example a non-ASCII home path. The entry `realpath` would then fail, giving `unknown` (fail-closed refusal, not a wrong kill). Check this on real macOS with a non-ASCII path. If it fails, set only `LC_TIME=C` and clear `LC_ALL`.
- Real macOS identity/PWA/tab behaviour, Windows console-close and the full manifest gate are still unaccepted, as `implementation-repairs.md` states.
