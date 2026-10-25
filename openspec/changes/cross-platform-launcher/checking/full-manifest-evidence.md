# Complete public-manifest gate — first attempts

## Scope and authorization

Lead approved the exact prepared Linux and Windows-local roots below for root npm ci, full unchanged public-manifest build twice, doctor --check, official config dump, isolated Host ready/start/stop. Host prerequisite healing was permitted only into the scratch npm prefix, not the user's global prefix. No public manifest customization was disabled, no real local env/credential/private overlay was copied, and no production port 3080 was used.

The reproducible driver `checking/full-manifest-gate.mjs` separates `prepare` (source snapshot + tool preflight) from `execute <exact-root> --approved-exact-root`. The full gate stops at its first failed stage. No retry was made after either failure below.

Both preparations copied **1172** existing public source files from a git-tracked/current-unignored allowlist: bin/scripts/packages/patches/skills/presets/instructions plus root manifest/package/lock/tooling/public metadata. Tracked deletions are omitted; generated node_modules, compat outputs/upstream clones, env/credential names are excluded. No root or profile deployment from the source checkout is reused.

Identical immutable input hashes for both attempts:

- Public `dsh.yaml`: `b0d430dcf64851984135a59bf70d3d0ad77d9de17f88936e9cad0bf530f1d12d`
- Root `package-lock.json`: `dc1f87d3b8531a54fd0544e8d8b37502022b4e0ca2855f937fa342ff977f64d6`

## Isolation parameters

Every prepared root has independent repo/home/DSH home/profile, XDG data/config/cache, APPDATA/LOCALAPPDATA, TEMP/TMP/TMPDIR, npm user/global configs (distinct empty files), npm cache/prefix, Corepack home, and Git global configuration (empty, no system config, no interactive prompts). `DSH_LOCAL_MANIFEST=''`; `DSH_BIN` and all real credentials are absent. `DSH_SKIP_UPDATE=1` preserves the reviewed exact public pin. On execution `DSH_SKIP_HOST_PREREQUISITES` is removed, and scratch prefix bin is prepended to PATH; any declared prerequisite install would target only that prefix.

Preparation originally included a skipped-prerequisite flag while awaiting approval; lead explicitly approved scratch-prefix healing, and execution removes that flag. Therefore neither executed attempt skipped prerequisite healing by policy. No Host was reached because both attempts failed earlier.

### Linux

- Root `/tmp/ohmydsh-full-gate-qCmwh7`; candidate repo is its `repo` child.
- Reserved non-production port: **40163**.
- Native Node **24.20.0**, npm **12.0.2**, Corepack **0.35.0**, Git **2.43.0**, GNU tar **1.35**.
- PATH: current Node installation bin, `/usr/bin`, `/bin`, plus scratch prefix bin at execution. Direct pnpm was absent; the compatibility builder invokes the explicit Corepack `pnpm@11.7.0` path.

### Native Windows

- Windows-local TEMP root named `ohmydsh-full-gate-R1Lrg3`; candidate repo is its `repo` child (not a UNC cwd).
- Reserved non-production port: **52626**.
- Native Node **24.12.0**, npm **11.6.2**, Corepack **0.34.5**, Git **2.54.0.windows.1**, bsdtar **3.8.9**.
- PATH: native Node, Git `cmd` only, scratch native-tools, Windows PowerShell directory, and scratch npm prefix at execution. Native-tools contains only cmd/taskkill/where/tar, not System32 as a whole. where.exe proves bash/sh unavailable.
- npm is resolved to its actual verified JS entry; no cmd/bat package-manager shim is handed to shell:false.
- One preparation-only pnpm version probe went through Corepack fallback and downloaded pnpm **12.15.0** into the isolated Corepack cache. This did not change any pin or user installation; it is not evidence that the builder's explicit pnpm 11.7.0 ran. The driver now resolves but does not invoke unpinned fallback pnpm during preparation.

## Exact execution commands

Linux:

```sh
node openspec/changes/cross-platform-launcher/checking/full-manifest-gate.mjs execute /tmp/ohmydsh-full-gate-qCmwh7 --approved-exact-root
```

Windows: system PowerShell invoked native Node on the worktree's runner, passing the exact Windows-local root and `--approved-exact-root`. All actual npm/build subprocess cwd values are candidate-local, with the sanitized environment above.

## Results — gate remains NOT PASSED

| Platform | root npm ci | build 1 | build 2 / doctor / dump / Host ready-stop |
| --- | --- | --- | --- |
| Native Windows initial | **FAIL**, exit 1 | Not reached | Not reached |
| Native Windows after reviewed workspace/launcher fixes | **PASS**, exit 0 | **FAIL**, exit 1; unapproved genai/protobufjs install scripts | Not reached |
| Linux initial/resume | **PASS**, exit 0 | **FAIL**, exit 1 (missing pnpm, then unapproved build scripts) | Not reached |

### Windows first cause (job bash-220)

Root npm ci executes workspace `packages/sidebar-session-provider-icon`'s public prepare script. The chain is:

`prepare: npm run build` → `build: npm run clean && npm run build:host && npm run build:client` → `clean: rm -rf lib`.

With native cmd and no Bash/POSIX tools, this clean command fails. The temp log identifies the workspace lifecycle failure and exact `rm -rf lib` invocation. Its source is the package's clean script (package JSON line 64 in this candidate), not a native DSH runtime dependency or a network installation failure. npm's subsequent EPERM cleanup warning is secondary, not the first cause.

This is a public root-install command-closure portability gap, reported to lead for owner-scoped repair. No upstream patch, package disabling, ignored lifecycle scripts, or fallback Git Bash was applied. No build/Host stage ran on Windows.

### Linux first cause: official CLI requires pnpm on PATH (jobs bash-221 / bash-232)

root npm ci completed with status 0; first launcher build returned status 1. The runner correctly stopped before build 2/doctor/dump/start/stop. Its raw log is retained only in that isolated root's `logs/build-1.log`.

The delegated read tool rejected inspection of that /tmp log as outside the managed root. That denial was reported rather than bypassed. Lead then explicitly authorized **one** new build-only diagnostic invocation on the same exact root/candidate, without npm ci, candidate modification or entry disabling. `diagnose-build-once /tmp/ohmydsh-full-gate-qCmwh7 --approved-exact-root` (job bash-232) returned status 1 and printed the new execution's bounded output tail.

The diagnostic identifies the first cause: the official DSH plugin manager requires a pnpm executable on PATH and repeatedly reports `pnpm was not found; install pnpm and make it available on PATH`. All 30 package-install failures share this cause; local TypeScript/client builds completed, and schema/skill synchronization was reached. This is a gate toolchain prerequisite gap, not evidence of a package native-build incompatibility or a failed Corepack builder pin. The preflight had already observed that direct pnpm was absent even though Corepack was installed. Resolving Corepack from our wrapper does not satisfy the official CLI's own executable discovery.

Lead subsequently approved exact `pnpm@11.7.0` installation into `/tmp/ohmydsh-full-gate-qCmwh7/tool-prefix` and a same-candidate resume beginning at build 1 without another root ci. `resume-build-with-pnpm` (job bash-236) installed with explicit registry/prefix, verified direct pnpm on the prioritized scratch prefix/bin PATH (both stages status 0), and ran the gate again. Build 1 still returned status 1, now with five package failures rather than thirty. Its first newly visible cause is **`ERR_PNPM_IGNORED_BUILDS` for `@google/genai@1.52.0` and `protobufjs@7.6.6`**, with pnpm asking for `approve-builds`. The five affected final install operations are dsh-magpie-connect, spec-superflow, dsh-skill-filesystem, jev-mcp and dsh-mcp-client. No arbitrary script approval, dependency change or allowlist was added; execution stopped before build 2/doctor/dump/Host again. This is a supply-chain build-policy/toolchain compatibility issue requiring owner review, not a reason to silently weaken installation policy. On Windows, the official CLI's treatment of npm-generated pnpm.cmd also requires native verification, not an assumption based on our no-shell resolver.

## Follow-up workspace refresh and exact metadata inspection

Lead authorized refreshing exactly twelve task-12 workspace package manifests and the new collab-kernel copy-convention helper into the original Windows candidate, with no root lock or public manifest change, followed by native workspace tests before any root-ci retry. The native suite is **3 passed / 1 failed**: copy-convention, permission-step and POSIX-tool absence checks pass; clean removal leaves `lib` present despite status 0. Root ci was **not retried** while that prerequisite remained red.

Diagnostics used only new fixture-owned directories, printing the exact program, actual process.cwd and exists before/after. All eleven clean programs were the intended Node `fs.rmSync('lib',{recursive:true,force:true})`; cwd and argv were correct. A control file containing the same native filesystem operations isolates a runtime issue on **Windows Node 24.12.0**: under an all-ASCII cwd, rmSync removes files/directories; under a Chinese cwd, rmSync returns success but leaves both files and recursive directories. In the same Chinese cwd, unlinkSync, rmdirSync and **fs.promises.rm** succeed. Relative/absolute path and force/no-force controls do not change the rmSync failure. No package source or assertion was modified by this gate task; owner was notified to choose an asynchronous deletion implementation or verified runtime fix rather than weakening coverage. The task-12 owner changed all eleven clean hooks to `fs.promises.rm` with rejection-to-nonzero handling, preserving deletion/content assertions. Approved exact candidate refresh then passed native **4/4, zero skipped** (job bash-274), including Chinese paths and idempotence. Public manifest and root lock hashes remained unchanged. Lead's previously approved same-Windows-root npm ci retry (job bash-275) installed/verified scratch pnpm 11.7.0 and passed root ci, then stopped at build 1 status 1. Its bounded combined-stream tail contained local builds and warnings but did not expose the error chain; status was 1, signal null and spawn error absent (not ENOBUFS/ETIMEDOUT). Lead authorized one further build-only diagnostic on that same candidate/profile with separate stdout/stderr tails and error-chain extraction; it is explicitly a reused-profile diagnosis, not a clean first-pass success. That attempt (bash-282) ended status 1 after successful pnpm additions with no sync completion/error summary. The old snapshot still contained the subsequently reviewed/fixed implicit 180-second launcher command timeout (C1), so that result must **not** be classified as an external/native dependency defect. Lead then explicitly authorized refreshing only launcher runner/main/ui/process into this same root and one further 20-minute-budget build-only diagnostic (bash-300). This is an upgraded candidate plus reused profile, not clean full acceptance. Exact refreshed hashes: runner `12475b12f2e75aa3528055a634713932da52796ff4c3cdec9efb76b2794a4ef3`; main `1b77f4e1354825bc41b76ec96a0e60246a15b7898a9c2b58cc054759405960c6`; ui `38c128887598221fff3d59f17ee071ecb34e339e739c6df851b49d0bf44bbcaf`; process `87557f305e8eb17e401b1df9e5835eb0f12fbfb57412a606d4d396108f72b273`. Collected result: **status 1, signal null, no spawn error**. The refreshed default-unbounded launcher reaches sync's final summary and reproduces the same Linux **`ERR_PNPM_IGNORED_BUILDS` for genai 1.52.0 / protobufjs 7.6.6**, with the same five package-add failures. This separates the earlier old-runner timeout obstruction from the current supply-chain approval prerequisite. No policy was weakened and no further attempt was made.

Read-only exact npm metadata queries (no scripts executed) identify the Linux dependency chain: public `dsh-magpie-connect@0.4.1` depends on `@earendil-works/pi-ai ^0.82.1`; inspected `pi-ai@0.82.1` pins `@google/genai 1.52.0`; genai requests `protobufjs ^7.5.4`, resolved by the gate to 7.6.6. genai's metadata includes `preinstall: echo 'preinstall: no-op'` and `prepare: node scripts/prepare.js`; protobufjs includes `postinstall: node scripts/postinstall`. Registry metadata alone is not a safety review of those script contents. No `allowBuilds`, `onlyBuiltDependencies`, `ignoredBuiltDependencies`, `dangerouslyAllowAllBuilds` or approve-builds configuration was found in the public repository's mjs scripts. A bounded read-only scan of the isolated official CLI npm cache also produced no matching policy strings; its depth/file filters make this a limited inspection, not proof no policy exists anywhere in the published runtime. Explicit script approval has **not** been granted or applied.

## Acceptance boundaries

These are actual full-input attempts, not successes. Full Windows support, complete-manifest idempotence, dump validity and real full-profile Host readiness remain unaccepted. The final separate targeted native **60-case / 7-lifecycle GREEN** evidence does not substitute for this gate (nor does the earlier 54-case / 4-lifecycle snapshot). macOS and terminal-close survival are not covered here.

No actual production home, port 3080, user global prefix, real env/npmrc/credentials or private overlay was changed. Temporary outputs remain outside tracked source; no raw log is stored in this report. Further execution requires lead coordination after first-cause triage and candidate repair.
