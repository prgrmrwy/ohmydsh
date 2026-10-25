# Native Windows targeted acceptance evidence

## Actual environment and isolation

Executed from this Worktree Session through system Windows PowerShell **5.1.26100.9711**, invoking native **Windows Node v24.12.0** (`process.platform === 'win32'`), actual **npm 11.6.2** and **Git 2.54.0.windows.1**. Candidate code was copied from the worktree to a fresh Windows-local TEMP root before tests ran; no npm operation used a UNC cwd.

The reproducible driver is `checking/native-windows-runner.mjs`. It copies only public candidate files, scripts, bin/root lock and five existing dependencies (`zx`, `js-yaml`, `yaml`, `semver`, `typescript`) into its own temp candidate. It does **not install** dependencies, use user npm configuration, or invoke a browser. The final expanded install suite additionally exercises offline npm link/unlink against a fixture-owned prefix with ignore-scripts, never a user global prefix. HOME/USERPROFILE/APPDATA/LOCALAPPDATA/DSH_HOME/prefix and npm user/global config point to isolated temp locations. User and global npm config are distinct empty files.

Final sanitized PATH:

- `C:\nvm4w\nodejs`
- `D:\Software\Git\cmd`
- `<temporary candidate>\native-tools` (copies of taskkill.exe, where.exe, cmd.exe only)
- `C:\Windows\System32\WindowsPowerShell\v1.0`

Absolute where.exe checks prove both `bash` and `sh` are unavailable before execution. Merely retaining System32 initially exposed `C:\Windows\System32\bash.exe` (the WSL launcher); that attempt failed the preflight and did not run suites. System32 was removed rather than accepting a no-Bash exception. No Git/bin or Git/usr/bin directories are present.

Actual npm resolution was additionally exercised, not inferred from synthetic layout tests: `resolvePackageManager('npm')` resolved the NVM junction to `...\nvm\v24.12.0\node_modules\npm\bin\npm-cli.js`, ran it with the current Node and returned **11.6.2 / status 0**. An early metadata attempt used one empty config file for both npm user/global config and npm correctly rejected double-loading it; splitting the runner's isolated config paths fixed the runner, not production code. A PowerShell inline Node -e introspection also suffered quote re-encoding; subsequent observations used the Node file runner, not inline source.

## Commands and results

All shell tool calls used the managed worktree as explicit workdir. Native entry command:

```powershell
& 'C:\nvm4w\nodejs\node.exe' '<worktree UNC>\openspec\changes\cross-platform-launcher\checking\native-windows-runner.mjs'
```

The runner then executes native Node with `--test` and exact file argv (no shell glob):

- tests/package-manager.test.mjs
- tests/launcher-bootstrap.test.mjs
- tests/launcher-exec.test.mjs
- tests/launcher-env-local.test.mjs
- tests/launcher-environment.test.mjs
- tests/launcher-args.test.mjs
- tests/launcher-process.test.mjs
- tests/launcher-ui.test.mjs
- tests/platform/windows-launcher.test.mjs

Initial native batch: **53 passed / 0 failed / 0 skipped**. This includes real Git quote/empty config roundtrip without shell aliases and a real empty-port PowerShell ownership query. UI effect tests inject runners; no browser opened.

## Native defect found and repaired: PowerShell stdout encoding

The first native lifecycle run had **2 passed / 2 failed**: default detached start and restart-preparation scenarios could not identify the newly ready fixture under a Chinese/spaced path; foreign-port/early-exit and foreground exit propagation passed. A minimal real listener with ASCII path was owned and stopped successfully. Changing only that fixture path to include `中文 space` reproduced unknown ownership with:

- Expected entry component: `owned 中文 space`
- Actual decoded CIM CommandLine component: `owned ���� space`
- Result: `unknown`, `DSH entry package identity cannot be verified`

Root cause: PowerShell 5.1 emits JSON using the console code page while Node decodes stdout as UTF-8. The Windows argv parser retained boundaries correctly; corrupt text caused realpath/package validation to fail closed.

Lead explicitly authorized the original process owner to repair this root cause. A permanent native regression was added to `tests/platform/windows-launcher.test.mjs` before the production fix. Its RED run: **54 tests / 53 passed / 1 failed**, with exact expected-vs-actual entry diagnostics (job bash-192). The minimal process change sets `[Console]::OutputEncoding` to no-BOM UTF-8 and `$OutputEncoding` to the same encoding at the start of the fixed query; no argv/ownership weakening or main changes were made.

## Final native GREEN (job bash-193, exit 0)

- Targeted native batch: **54 passed / 0 failed / 0 skipped**, ~11.86 seconds.
- Permanent real Unicode/spaced path test: matching package + argv + CIM creation identity becomes owned, exact original path preserved, fixture-only taskkill succeeds and final port probe is empty.
- Additional runner-owned real probe: mismatched advertised port remains unknown; exact Unicode/spaced entry is owned with its actual PID; verified forced stop returns `{ok:true,state:'empty'}`. No unrelated process is targeted.
- Native `tests/launcher-lifecycle.test.mjs`: **4 passed / 0 failed / 0 skipped**, ~49.15 seconds:
  - `test_detached_host_outlives_launcher`: launcher returns, fixture lives, repeat start reuses one Host, stop empties port.
  - `test_foreign_port_and_early_exit_fail`: unrelated listener untouched; own early exit rejected.
  - `test_failed_replacement_keeps_healthy_host`: failed preparation retains existing PID.
  - `foreground Host nonzero exit is propagated`: exit 9 returned.
- Real native bounded-runner timeout: timeout 800 ms, grace 1000 ms; supervisor exits **124** and recorded leader + descendant are both dead (`alive: []`). Only the runner's own recorded fixture tree is eligible for cleanup.
- POSIX regression after encoding fix: `node --test tests/launcher-process.test.mjs tests/launcher-ui.test.mjs && git diff --check`: **22/22 passed**, zero skips, diff check passed.

Final native snapshot was a Windows-local TEMP directory named `ohmydsh-native-o77iPD`. It was not a deployed installation. Relevant SHA-256 identities:

| Candidate | SHA-256 |
| --- | --- |
| scripts/launcher/process.mjs (UTF-8 fix) | 473639de998bb15c65e1cd8701150b73610e8d4d1fbb8435a57d0f5a39a936ac |
| scripts/launcher/ui.mjs | 93e2777c258aaef92664fe0f0ce71396aa7ca05425fc75876080b7b06977f534 |
| bin/dsh.mjs | f63424bd083b67caddb2a2191fd1595785206dea7902e473f73ea54f23337a7d |
| package-lock.json | dc1f87d3b8531a54fd0544e8d8b37502022b4e0ca2855f937fa342ff977f64d6 |
| tests/launcher-lifecycle.test.mjs | 9ffab550152c5a7841365656ee9e888998c6903d168d5802598c3f8a98b0d5ce |
| tests/platform/windows-launcher.test.mjs | 3b261cd41e2543e7f98853859c7d775ed69d5b628cf1f59bb48f5851ace2586a |

The runner prints per-file hashes for local reproduction; raw output is not copied into the repository. No real local env, npmrc, credentials or private overlay was read. No production port 3080, user global installation or existing Host was changed.

## Final reviewed launcher rerun (separate snapshot)

The final fresh batch adds launcher runner and install suites; it must not be summed with the earlier 54-case snapshot. An initial final-candidate batch had **60 total, 58 passed, 2 failed**, zero skipped: an injected Darwin fixture emitted a Windows backslash path into POSIX ps argv, and the install fixture let Node re-quote the explicit cmd /s /c command string. Lead repaired those fixture boundaries (forward-slash simulated Darwin path; windowsVerbatimArguments for explicit cmd). Assertions and production safety checks were not weakened.

Fresh rerun job bash-302, Windows-local TEMP root `ohmydsh-native-h6e7aQ`:

- Targeted batch: **60 passed / 0 failed / 0 skipped**, ~11.94 seconds.
- Includes real scratch-prefix offline npm link/unlink and invocation of its generated cmd shim from an external cwd, runner timeout-tree cleanup/no implicit interactive timer, new process/UI ownership contracts and original Unicode ownership probes.
- Additional owned Unicode/spaced fixture probe and verified stop returned owned → empty.
- Final native lifecycle suite: **7 passed / 0 failed / 0 skipped**, ~83.73 seconds: missing owner probe fails before effects, detached Host survives launcher, foreign listener/early exit, failed replacement preserves existing PID, simultaneous starts reuse a verified winner, ownership-readiness failure reclaims a TERM-ignoring own child, and foreground exit propagation.
- Final bounded supervisor: status **124**, its own leader/child recorded and both confirmed dead (`alive: []`).
- Overall driver job bash-302 exited **0**. The seven lifecycle cases are a separate batch, not added to the 60-case targeted suite.
- A final lead-authorized two-file refresh of scripts/test.mjs and its test into the same scratch snapshot passed the native test-driver selection contract **1/1, zero skipped**, ~78 ms. This separately proves Windows selects portable/native suites while unfinished console-close remains an independent red gate; it does not reclassify that gate as passed.

Final candidate identities printed by this fresh snapshot:

| Candidate | SHA-256 |
| --- | --- |
| scripts/launcher/process.mjs | 87557f305e8eb17e401b1df9e5835eb0f12fbfb57412a606d4d396108f72b273 |
| scripts/launcher/ui.mjs | 38c128887598221fff3d59f17ee071ecb34e339e739c6df851b49d0bf44bbcaf |
| tests/launcher-process.test.mjs | cc7943ad65d95a99ac008a4b68435f5ac2491b303cc3761dae783541439b037c |
| tests/launcher-install.test.mjs | 2c5ff2dbef728af4e2be4940249c3b8d185fff5d92e0a0f911631501eac13aa2 |
| tests/launcher-lifecycle.test.mjs | 38f73c88a544d457dbe07a7d6abc86fa7f9a04b894703ee471ded48ae0a43740 |

Root lock and bin hashes remain those recorded above. The complete-manifest gate separately passed native root npm ci after reviewed workspace lifecycle fixes; see `full-manifest-evidence.md`. It has **not** passed full build twice/dump/Host readiness.

## Not acceptance evidence for

These targeted runs do not prove real terminal/console-close survival, actual browser opening, PowerShell generated shim execution, macOS PWA/tabs, Node 22, or the complete public-manifest build×2/dump/Host gate. Minimal copied dependencies passing health checks do not substitute for the separate full-source gate. Full Windows repository support remains unclaimed until those gates are satisfied.
