# Independent implementation review — cross-platform-launcher (read-only)

Scope: `bin/dsh.mjs`, `scripts/launcher/*.mjs`, `scripts/lib/package-manager.cjs`, `env-local.mjs`, `dsh-cli.mjs`, `run-bounded.mjs`, `scripts/dsh-cli.mjs`, compared with `tests/fixtures/launcher-bash-baseline`. No code was changed.
Ran: `node --test tests/launcher-{process,ui,env-local,args,environment}.test.mjs` → 34/34 passed. I also ran small regex probes with `node -e` (listed below).
Unverified gates (reported as limitations, not source bugs): terminal-close survival, the full public-manifest build×2/dump/Host gate, and real macOS (PWA/tabs/ps).

## Critical

### C1 `runner.mjs:4,11`: every user-facing command is SIGKILLed after 180 s
`run()` defaults to `timeoutMs = 180_000`. `main.mjs:39` `runScript` and `maintenance.mjs` never override it. That covers official CLI forwarding (`main.mjs:44`), including interactive `dsh --profile <name>`, `plugin add`, `sync.mjs` build/reset, `plugin-update` (it waits on a readline `[Y/n]` prompt), doctor, and autoUpdate's sync.
- Only the direct child is killed (`child.kill('SIGKILL')`; on Windows that is TerminateProcess of the leader). The grandchild keeps running: `scripts/dsh-cli.mjs` uses spawnSync for the official CLI, and sync spawns npm/pnpm. That grandchild still holds the terminal's stdio.
- A killed autoUpdate sync hits the rollback branch (`maintenance.mjs:52-55`). That restores `dsh.yaml`, but `~/.dsh` stays half-materialized.
- The Bash baseline had no such timeout.
- Reproducer: a stub `scripts/sync.mjs` that does `setTimeout(()=>{},200_000)` (or inject a short timeout) → `dsh build` exits 1 at 180 s, and the stub's child keeps running.
- Smallest fix: no timer unless the caller passes a finite `timeoutMs` (guard with `Number.isFinite`; note `setTimeout(fn, Infinity)` fires after 1 ms). Keep bounded timeouts only for captured probes (check-update, git status, plugin-list, dsh-server-bin already bounded internally). Report a timeout distinctly instead of `status ?? 1`.
- Test: an inherited-stdio runScript stub running 200 s with a fake clock or injected timeout must not be killed. The official forward must leave no orphaned grandchild.

### C2 `process.mjs:97-106`: the macOS listener identity can't prove real Hosts
On macOS, start, stop and restart all fail with probe-error, which breaks the spec scenario "`node …/node_modules/.bin/dsh web`".
- The regex requires argv0 to contain `/`. An `.bin/dsh` shebang launch (`#!/usr/bin/env node`) and the old Bash launcher (`node "$server_bin"`) both show argv0 as bare `node`. Probe: `node /Users/a/.npm/_npx/x/node_modules/@deepseek-ai/dsh/lib/bin.js web --port 3080` → regex false.
- `lstart` depends on the locale: `ps` inherits the user's `LC_*`, and the `\w{3}\s+\w{3}` pattern fails for a non-English LC_TIME.
- Result: after upgrading, a user with an already-running Host gets refused on `dsh`, `dsh stop` and `dsh restart`, with no way out except killing it by hand. The Linux path (`/proc`) is fine.
- Fix:
  - Run `ps` with `LC_ALL=C` (and `LANG=C`).
  - Get the executable from `lsof -a -p PID -d txt -Fn` (first `n` line), or `ps -o comm=`, instead of argv0.
  - Accept an argv0 basename of `node`.
- Test: darwin-injected `ps` output with bare `node` argv0, `.bin/dsh`, and an `LC_TIME=de_DE`-style lstart → owned/unknown as expected, never probe-error for a valid DSH. Also needs a real macOS run.

## Moderate

### M1 `process.mjs:61-62,87`: ownership requires the Node executable basename to be exactly `node`/`node.exe`
If `process.execPath` is `nodejs` (Debian), `node24`, or a renamed/versioned binary, the Host the launcher just spawned is classified `unknown`. `main.mjs:127` then breaks out of the wait, kills it (line 136) and reports failure, so every start fails. Baseline: substring match, so this is a regression.
- Fix: also accept realpath(executable) === realpath(process.execPath).
- Test: a fixture Node symlink named `nodejs` spawns the stub Host → ready.

### M2 `main.mjs:131-139`: cleanup after a failed readiness is unbounded and incomplete
- On POSIX, `child.kill('SIGTERM')` hits only the leader of the detached process group. There is no wait and no SIGKILL escalation.
- The ChildProcess handle is never `unref()`ed on this path. So when the Host ignores SIGTERM or exits slowly, `dsh` hangs until it exits. This breaks the "bounded" requirement and can leave a listener holding the port.
- Fix: `process.kill(-child.pid,'SIGTERM')`, wait for `closed` for at most ~5 s, then `SIGKILL` the group (only while `child.exitCode === null`), then `child.unref()`.
- Test: a stub Host that listens with mismatched argv (→ unknown) and traps SIGTERM: the launcher must exit non-zero within its budget, and no stub process may remain.

### M3 `ui.mjs:101` + `process.mjs:12`: xdg-open runs with a 3 s execFile timeout
On many desktops `xdg-open` blocks while it launches a cold browser. At 3 s it gets killed, and the launcher warns "opener failed, open manually" even though the UI opened, so the warning is a false "not opened" report (the Bash baseline had no timeout).
- Fix: spawn it detached with `stdio:'ignore'` + `unref`, and count a successful spawn plus a ≥3 s "still running" as opened; or allow a longer bound.
- Test: an xdg-open stub that sleeps 5 s and exits 0 → `opened` is true, or at least no false failure message.

### M4 `main.mjs:141`: the startup history record dropped `plugins=[...]`
Baseline `record_startup` runs `plugin-list.mjs --names`. `dsh history` is a kept contract (design D6), so it now loses the loaded-plugin list. The "Host runtime: kind=…" line and the `  - ` plugin prefix in `showPlugins` are also gone.
- Test: compare the startup log line format against the baseline.

### M5 `main.mjs:126-127`: concurrent starts
When a different, provably-DSH Host wins the port (two `dsh` runs at once), the loser kills its own child and exits 1, even though DSH is running. Suggest: if the state is owned by another verified DSH and our child has exited, report "already running" (exit 0) or say so in a distinct message.

## Suggestions
- `ui.mjs:41` writes to `dsh-ui.log` when DSH_HOME is set, and `main.mjs:53,57` also does `appendEvent(...'dsh-ui.log')`, so UI lines are duplicated. Without DSH_HOME, only main logs.
- `ui.mjs:115-120`: `DSH_OPEN_APP="Google Chrome"` (an app name, not a PWA) means `stop` quits all of Chrome. This matches the baseline, but conflicts with the spec ("do not kill all of Chrome"). Consider restricting the quit to `.app` PWA bundles or names matching `DeepSeek Harness`.
- `main.mjs:14` `canConnect` duplicates `process.mjs` `portReachable`.
- Verify on the real pinned Host that DSH does not overwrite `process.title`. If it did, `/proc/cmdline` would lose the argv, `isDshWebProcess` would fail, and the full Host gate would fail.

## Checked, no bug found
- restart prepares the runtime before stop; a failed prepare keeps the healthy Host.
- stop does not provision. It only reads local `.env.local`/`.npmrc`.
- Unknown or probe-error ports refuse before autoUpdate.
- An empty port needs both no listener and a failed connect.
- Every kill re-probes and compares pid + start time + argv + executable. Windows taskkill 128 requires a re-probe that shows the port empty.
- Windows argv parser: tried quotes, empty arg, trailing backslash.
- PowerShell UTF-8 output.
- `.env.local` strict mode and DSH_BIN snapshot/legacy migration.
- npm env stripped from Host env; explicit registry re-applied.
- Host cwd = caller cwd; repo comes from `import.meta` realpath.
- autoUpdate dirty check, rewrite, sync rollback and commit match the baseline (except for C1).
- Malformed YAML stops startup because no version can be read (allowed); `web` that is not an object → defaults to open.
