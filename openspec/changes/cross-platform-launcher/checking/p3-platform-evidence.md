# P3 ownership / UI implementation evidence

Task scope: `scripts/launcher/process.mjs`, `ui.mjs`, their process/UI tests and explicit native platform suites. No dependencies, orchestration, manifests, lockfiles, Bash baseline, or production deployment were changed by this task. Native Windows/macOS execution remains lead-owned and unverified here.

## RED → GREEN

- Importable skeletons were created before implementation. `node --test tests/launcher-process.test.mjs tests/launcher-ui.test.mjs` yielded **11 tests, 2 passed / 9 failed**, with real boolean/shape/argv assertions failing rather than module/import errors.
- Additional UI argv/platform cases ran against the skeleton: **9 tests, 1 passed / 8 failed**. They cover literal application-name argv, bounded AppleScript, Windows encoded opener source, invalid ports and URL isolation.
- Pure process classifier/stop/probe unit batch: **11/11 passed** after implementation.
- Extended process/UI batch: **20/20 passed**.
- A real POSIX integration test initially hung in fixture cleanup after successfully signal-terminating its child: Node reports signal termination through `signalCode` while `exitCode` stays null, and cleanup awaited an already-emitted close event. The obsolete job was canceled and collected; cleanup now checks both fields and registers close before sending a cleanup signal. This was a test cleanup bug, not a product stop failure.
- Corrected real POSIX batch: **21/21 passed**.
- Final extended command: `node --test tests/launcher-process.test.mjs tests/launcher-ui.test.mjs && node --check scripts/launcher/process.mjs && node --check scripts/launcher/ui.mjs && git diff --check`: **22/22 passed**, zero failures/skips, approximately 0.20 s; both syntax checks and diff check exit 0.

## Observable checks

### Process

- Known Node + exact DSH entry path + web + matching port is accepted; foreign script paths, quoted DSH-looking text in node -e, plugin instead of web, and a different port are rejected.
- Identity equality requires PID, nonempty creation identity, exact argv and executable identity when present. Changed creation token/argv/PID is rejected before a signal.
- Empty enumeration plus reachable socket is unknown; mixed owned/foreign records and missing creation identity are unknown. Missing lsof and malformed Windows JSON are probe-error, not empty.
- Windows argv parser covers spaces, empty argv, embedded quotes and trailing backslashes with MSVCRT rules.
- stop refuses unknown/probe-error states; rechecks immediately before each signal; POSIX TERM succeeds only after final empty ownership result. Windows test runner observes exact `taskkill.exe /PID 1234 /T /F` argv and forced-stop warning. Exit 128 does not count as success while ownership is still present. An expired deadline sends no signal.
- Real Linux smoke uses a temporary package root whose path contains spaces and Chinese characters. A real unrelated listener stays alive and stop returns false. A real known-path fixture with wrong package identity remains unknown. Restoring package name permits ownership detection with its actual PID, TERM and final empty result. Cleanup targets only recorded fixture child objects.

### UI

- no-open > open > manifest, default open remains true.
- Linux opener failure returns `{opened:false,url}` and manual URL guidance without any stop/kill call.
- Windows/Linux closeUI makes no external calls and emits manual-close guidance.
- macOS application name is an osascript argument read through `on run argv`, never embedded into source. PWA quit precedes same-port tab cleanup; both calls have 3 s budgets. Failure does not signal unknown UI processes.
- Windows opener test observes a fixed encoded script containing only the constructed loopback URL, not a macOS app value. Production default uses local zx `within` + explicit `usePowerShell` + quiet/nothrow/3 s timeout; variable application/path arguments do not enter zx. Main must omit the custom `run` parameter to use this production zx path; an injected runner is the explicit test seam.
- Opener URL cannot contain host/trusted-host arguments; invalid ports reject before effect. Logging is diagnostic best-effort so a home-log error cannot stop a healthy Host.

## Default mechanisms / review boundaries

`probePort` returns `{state,processes,error?}`; `stopServer` returns `{ok,state,error?}`. No pidfile or HTTP identity is used. Linux reads exact NUL argv and start ticks from `/proc`; POSIX ownership enumeration still requires lsof. macOS uses ps start time and conservative known-entry command reconstruction; ambiguous quoted command suffixes fail closed rather than guessing boundaries. Real entry paths resolve to the published package's lib/bin.js and package name must equal `@deepseek-ai/dsh`; Node executable identity is checked.

Windows executes one fixed UTF-16LE EncodedCommand query combining Get-NetTCPConnection + CIM fields, with no variable argv/path interpolation. Only the validated integer port is inserted. Malformed/failed/permission-limited queries fail closed. Every probe command has a 5 s maximum. stop shares a 20 s deadline; POSIX grants TERM at most 10 s before revalidation/KILL, polling reachability without repeated ownership queries. Revalidation occurs at signal decisions and final confirmation. No npm/provision calls exist in these modules.

`runPlatformCommand` is native argv execFile with shell:false; UI Windows zx is confined to a constructed URL opener. Tool output and injected effect adapters are test observation surfaces, not product environment bypasses.

## Native acceptance not claimed

- `tests/platform/windows-launcher.test.mjs` contains native Git config quote/empty roundtrip (no shell alias) and actual PowerShell empty-port query. It was **not executed** on this Linux task runner.
- `tests/platform/darwin-launcher.test.mjs` is a bounded macOS argv contract, **not** real installed-PWA/Chrome surface cleanup acceptance. It was **not executed** here.
- Native terminal-close survival, Windows taskkill affecting only a verified real tree, actual macOS PWA/tabs, full public-manifest build/dump/Host gate, and minimum Node matrix remain outstanding overall change gates. No platform support declaration follows from these unit results.
- macOS ps creation identity has its platform's timestamp precision and command reconstruction conservatively refuses ambiguous cases. Final query-to-signal TOCTOU is not eliminated by user-space probes; no kernel-handle guarantee is made.
