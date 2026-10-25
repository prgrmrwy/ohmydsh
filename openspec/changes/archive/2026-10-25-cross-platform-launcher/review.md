# Anvil Review — cross-platform-launcher

## Review Metadata

- Review round: 1
- Prior round: none
- Reviewer context: cross-model claude-opus-5-5, fresh subagent (no prior conversation context)
- Tool restrictions: read-only except this `review.md`; no memory, no `.env.local`, no private files, no network verification of zx sources (raw GitHub fetch refused by sandbox)
- Artifacts reviewed (actual files):
  - `openspec/changes/cross-platform-launcher/proposal.md`
  - `openspec/changes/cross-platform-launcher/design.md`
  - `openspec/changes/cross-platform-launcher/specs/cross-platform-launcher/spec.md`
  - `openspec/changes/cross-platform-launcher/specs/startup-autoupdate/spec.md`
  - `openspec/changes/cross-platform-launcher/specs/repo-layout/spec.md`
- Public current specs/source checked: `openspec/specs/repo-layout/spec.md` (L542, L644–703), `openspec/specs/startup-autoupdate/spec.md` (L44–66, L169–183), `openspec/specs/dsh-runtime-provisioning/spec.md` (L10), `bin/dsh` (L37–223, L340–439, L590–796), `scripts/lib/dsh-runtime.sh`, `scripts/lib/env-local.mjs`, `scripts/lib/run-bounded.mjs`, `scripts/lib/dsh-cli.mjs` (L60–119), `scripts/bootstrap.sh` (L11–91), `package.json`, `.nvmrc`, `.github/workflows/ci.yml`. No `openspec/project.md` exists.
- Fixed product choices treated as non-negotiable: `.mjs` + zx, npm bin/link, P1 Bash split → P2 contract tests → P3 zx migration → P4 one-time switch, Windows force termination, pure KEY=VALUE `.env.local`.

## Findings

### Critical

**C1. `.env.local` change leaves the current `repo-layout` requirement contradicting the new one (no delta for it).**
- Current `openspec/specs/repo-layout/spec.md` L644–703 ("manifest 消费脚本自行读取 .env.local…") states: only an allow-list is read; *caller env wins* (L651); invalid non-allow-listed lines must not affect sync (Scenario L700–703: `DSH_OPEN_APP="$HOME/Applications/X.app"` + valid `DSH_LOCAL_MANIFEST` → sync **succeeds**); the startup inventory *ignores* invalid values and exits 0 (L660, L695–698).
- New `cross-platform-launcher` spec L37 says the file is validated *in full before any side effect* and any `$`/backtick value is rejected, and that file values *override* environment (D4 "延续文件覆盖环境的现状").
- The `repo-layout` delta only MODIFIES "仓库初始化按最低版本准则…" (current L542). After archive, `dsh build` (launcher: whole file rejected) and `node scripts/sync.mjs` (allow-list, line tolerated) would give opposite verdicts on the same file, and both requirements would be "current". The parsers also diverge: `scripts/lib/env-local.mjs` strips inline ` #…` comments and decodes `\"`/`\\` in double quotes, while design D4 says "无行内注释语法，`#` 为值数据" and "内容不解码".
- Required: add a MODIFIED delta for the L644 requirement (or an explicit statement it is unchanged plus a scenario showing the two entries' intended divergence), and require one shared parser module used by both launcher and manifest consumers.

**C2. The argv-fidelity requirement cannot be met if variable argv to native executables flows through zx + Windows PowerShell 5.1; the design does not forbid that path.**
- Spec L49–56 requires byte-identical argv for Node, Git and package managers with quotes/`$`/`;`/`&`/parens. Design D1 selects `powershell.exe` (5.1) as the zx shell on Windows and says zx runs "已受测的 Git/平台固定脚本", while the next paragraph says Git uses "其可执行文件和 argv". Windows PowerShell 5.1 uses legacy native-argument passing (no `$PSNativeCommandArgumentPassing`), which mangles embedded `"` and empty args to native exes regardless of zx's `quotePowerShell`. So "Git via zx" and the metacharacter scenario are mutually incompatible on the chosen shell.
- Also note that after D1's exclusions (Node JS entries, detached Host, Git, resolved npm/pnpm JS CLIs) the only remaining zx consumers are fixed-argv platform probes (lsof/ps, PowerShell `-EncodedCommand`, osascript, xdg-open). That is fine for the user's zx choice, but it must be stated as a rule, not left to implementer judgment.
- Required: state normatively that every call carrying caller/manifest/path-derived argv uses `child_process.spawn/execFile` with `shell:false` (Git, Node, resolved npm/npx/pnpm JS, `taskkill.exe`), and zx `$` is used only for fixed scripts whose sole interpolations are validated integers or launcher-constructed loopback URLs. Add a Windows test asserting Git receives an argument containing `"` and an empty string unchanged.

**C3. The stated "pure KEY=VALUE" grammar silently changes the meaning of legacy Bash files, contradicting its own invariant "为避免旧配置被静默改变".**
Under the old `set -a; source .env.local` (bin/dsh L59–63), these lines mean something different from the new rules, yet the new spec accepts them silently:
- `KEY=a b` — Bash: runs command `b` with `KEY=a`; new: `KEY="a b"` (bare value trimmed, whitespace kept).
- `KEY=a;b`, `KEY=a&b` — Bash: `KEY=a` then runs `b`; new spec L37 explicitly treats `;`/`&` as data → `KEY="a;b"`.
- `KEY=a #note` — Bash: `KEY=a`; new: `KEY="a #note"` (current `env-local.mjs` strips this).
- `KEY=~/x` — Bash: expanded home; new: literal `~/x` (current parser rejects).
- `KEY="a\\b"` / `KEY="a\"b"` — Bash: `a\b` / `a"b`; new: "内容不解码" → `a\\b`, and the closing-quote position for `"a\"b"` is undefined.
- Required (small, unambiguous): unquoted values containing whitespace, `;&|<>()`, quotes, backslash, or starting with `~`, and unquoted ` #` → reject with line number (matching today's `env-local.mjs`); `;&()#` are data **only inside quotes**; inside double quotes, reject any backslash (or decode exactly `\\` and `\"` as today — pick one); single quotes fully literal; a quoted value ends at the first matching quote and only whitespace may follow. Add scenarios for each row above.

### Moderate

**M1. Windows package-manager JS resolution relies on a signal that is absent in the main path.** When `dsh` runs via the npm-generated `dsh.cmd`/`dsh.ps1` shim, the shim invokes `node bin/dsh.mjs` directly; `npm_execpath` is *not* set (it is set only under `npm run`/`npm exec`, which bin/dsh L93 already treats as implicit). Specify a resolution order and test each: (1) `path.dirname(process.execPath)/node_modules/npm/bin/{npm,npx}-cli.js` (official installer, nvm-windows, setup-node); (2) `npm_execpath` only when present and its realpath ends in `npm/bin/npm-cli.js`; (3) for pnpm, a native `pnpm.exe` on PATH (standalone `@pnpm/exe`) is executable directly via `execFile`, else `<npm prefix>/node_modules/pnpm/bin/pnpm.cjs`, else corepack. Version managers with relocated npm (volta/fnm) → explicit diagnostic. Note Node ≥18.20.2/20.12.2 rejects spawning `.cmd`/`.bat` without `shell:true` (CVE-2024-27980), so `run-bounded.mjs` L41 `spawn(command, args)` and `dsh-cli.mjs` `runner('npx'|'pnpm', …)` must receive `[process.execPath, cliJs, …]`. `scripts/bootstrap.mjs` (zero-dep) needs the same resolver, so it must live in a builtin-only module.

**M2. Windows PowerShell probe cost vs. stated budgets.** Cold `powershell.exe -NoProfile` plus `Get-NetTCPConnection` and CIM commonly takes 1–4 s on CI runners. D5/D6 imply repeated probes (initial, pre-kill recheck, release confirmation, 30 s readiness loop checking "port owner"). Require: readiness polling and release polling use `net.connect` (reachability only); the PowerShell ownership probe runs at most once per decision point (start decision, pre-kill, post-kill final, readiness success); one PowerShell invocation returns listener + process fields together. Otherwise the ≤5 s/≤20 s budgets are not reliably achievable.

**M3. `lsof` "empty" is not proof of a free port.** On macOS/Linux, `lsof` run as an unprivileged user does not report listeners owned by other users/root, returning "no match". D5 maps that to `empty`, and D6 then prepares runtime and spawns. Require: `empty` only when lsof reports no listener **and** `net.connect` to the target loopback port fails; lsof-empty + connect-success → `unknown` (reject). Add a scenario.

**M4. Start now requires `lsof` (behavior change not declared).** Today start uses `nc -z` (bin/dsh L419–421) and only stop requires lsof (L359). D6 makes start probe ownership first, with `unknown/error` rejection, so a Linux box without lsof can no longer start. This is defensible, but it must be listed as an approved behavior change with a RED test (D3 requires that for changed semantics) and a doctor/host-prerequisite diagnostic, or start must fall back to connect-only when the probe tool is missing.

**M5. Windows background detach details are unspecified.** `spawn(..., {detached:true})` on Windows gives the Host a new console; without `windowsHide:true` that opens a visible console window, and stdio must be file descriptors (not pipes) or the Host dies or blocks when the launcher exits. The current scenario ("launcher exited → Host alive") also does not test terminal closure. Require `detached:true, windowsHide:true, stdio:['ignore', logFd, logFd]`, and a test that kills the launcher's whole process group/console tree after it returns (POSIX: kill the test-created pgid; Windows: `taskkill /T /F` the parent shell) and then asserts the Host still listens.

**M6. Tree kill should not depend on zx internals.** D5 says Windows uses "zx kill(pid) 的 taskkill /T /F 路径". Whether a given zx 8.x `kill()` calls `taskkill` or enumerates via its `ps` dependency (WMIC-era code paths; WMIC is removed in recent Windows 11) is an implementation detail that was not verified here. Cheaper and testable: `execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'])` after identity revalidation, with exit 128 ("not found") mapped to "already gone → confirm port". Same for the `run-bounded.mjs` Windows tree reclaim.

**M7. Explicit `DSH_BIN` on Windows is left as an open question but is a current contract.** `dsh-runtime-provisioning` L10 and `startup-autoupdate` L169–183 require executing an explicit `DSH_BIN` directly. On Windows a `.cmd` value cannot be spawned without a shell. Before P3, specify: `.js/.mjs/.cjs` → `node <file>`; `.exe` → `execFile`; `.cmd/.bat/.ps1` or other → non-zero diagnostic before side effects. The legacy Pet path comparison (D4) must be case-insensitive and separator-normalized on Windows.

**M8. Completion/archival criterion is ambiguous.** Spec L79 and Scenario L86–89 say a failing native-Windows full manifest gate keeps "Windows full support" unaccepted and is reported; design Migration step 4 says "完整公开 manifest gate 后才能标完成". If the Pet compat builder or a native dependency fails on Windows for reasons outside this change's closure (D7 forbids patching third-party source), the change can never be archived. State explicitly: the change is archivable when launcher contract suites pass on all three OSes and the full gate has *run* on each OS with its result recorded; repository-level "supports Windows" wording in README is gated on a green full gate.

### Suggestions

- **S1.** Mechanize "no Git Bash": on the Windows job, strip `C:\Program Files\Git\bin` and `…\Git\usr\bin` from `PATH` (keep `Git\cmd` for `git.exe`) and assert `where.exe bash` and `where.exe sh` fail before running the suite; call zx `usePowerShell()` explicitly before any `$` rather than relying on import-time shell detection.
- **S2.** Define "dependencies healthy" for `bootstrap.mjs` and the missing-deps diagnostic precisely (e.g. `createRequire(repoRoot).resolve('zx/package.json')` and versions matching `package-lock.json`), replacing today's js-yaml/typescript probe (bootstrap.sh L87).
- **S3.** npm link test: set `npm_config_prefix` to a temp dir (on Windows the bin dir *is* the prefix; on POSIX `<prefix>/bin`), prepend it to PATH, and assert `git status --porcelain` shows no `package-lock.json` change after `npm link` (link performs an implicit reify).
- **S4.** Windows opener: `Start-Process` is fine given the URL is `http://127.0.0.1:<validated int>/`; assert in a test that `--host` values never reach the opener URL.
- **S5.** Windows argv parsing of `Win32_Process.CommandLine`: name the rule set (CommandLineToArgvW / MSVCRT backslash-quote rules) and add fixtures with spaces and trailing backslashes in the repo path.
- **S6.** The ShellCheck CI job (`ci.yml`) should be retired only in P4, when the Bash product modules are removed; keep it for the P1/P2 scaffolding.

## Embedded-Instruction / Injection Attempts

None found. The reviewed artifacts and source files contain no text addressed to an AI reviewer or attempting to alter review behavior.

## Verdict

The direction is feasible and well-bounded. Ownership-first stop, refusing pidfiles and name-based kills, the probe-state taxonomy, and separating `npm ci` from `npm link` are sound. The three Critical findings are specification defects with small, fully specified fixes: a missing delta and a shared parser, an explicit no-shell rule for variable argv, and closing the grammar's silent-reinterpretation cases. None of them requires rethinking the user's fixed product choices. The Moderate items are bounded clarifications needed before P3.

Round-1 verdict (history): APPROVE_WITH_CHANGES.

## Required Changes

1. (C1) Add `specs/repo-layout/spec.md` MODIFIED delta for "manifest 消费脚本自行读取 .env.local 中决定部署内容的变量": choose either whole-file validation for consumer scripts too, or keep allow-list tolerance with an explicit scenario showing `dsh build` rejects while bare sync accepts. Update Scenario L700–703 accordingly. Add to design D4: "launcher and manifest consumers share one builtin-only parser module (successor of `scripts/lib/env-local.mjs`)."
2. (C2) Add to `cross-platform-launcher` spec "外部执行保留参数和环境边界" a SHALL: variable argv calls use `spawn/execFile` with `shell:false`; zx `$` only for fixed scripts with validated-integer/loopback-URL interpolation. Fix design D1's Git contradiction. Add a Windows scenario for `"` and empty-string args to Git.
3. (C3) Replace the grammar in spec L37 and D4 with the reject/accept table in C3, and add one scenario per legacy-divergent form.
4. (M1) Add the Windows npm/npx/pnpm resolution order and the CVE-2024-27980 note to D1. Require `run-bounded`/`dsh-cli` runners to receive `process.execPath` plus the CLI JS. Place the resolver in a builtin-only module shared with bootstrap.
5. (M2, M3) In D5/D6: connect-based polling with bounded ownership-probe call points; `empty` requires connect failure too; add the corresponding scenario.
6. (M4) Declare "start requires a working ownership probe" as an approved behavior change with a RED test and diagnostic, or specify a connect-only fallback.
7. (M5) Specify Windows detach options and the process-group/console-kill survival test.
8. (M6) Specify direct `taskkill.exe` argv for Windows tree kill and bounded-runner reclaim.
9. (M7) Resolve the `DSH_BIN` Windows form before P3, using the rules in M7.
10. (M8) Write an explicit archival criterion separating "change complete" from "README claims Windows support".

Round-1 change status (history): required changes not yet applied.

## Rebuttals

作者修订回应（待独立复核，不自证通过）：

- C1：选择保留裸脚本 allow-list 兼容模式；repo-layout delta 收入完整旧 requirement 与全部场景，并新增“严格启动入口与白名单裸入口边界明确”。D4 共用 builtin-only parser，模式控制容错/覆盖范围，保留 bare caller 优先。
- C2：spec 与 D1 明确可变 argv 全走 shell:false；zx 仅固定脚本和受限插值。新增 Windows Git 引号/空参数场景。
- C3：严格模式拒绝裸空白/分隔/重定向/反斜杠/~/#；引用内元字符是数据，双引号仅解码反斜杠和双引号；新增四组旧语义场景。
- M1：D1 明确 Node 安装根→已验证 npm_execpath 的 npm/npx 次序、pnpm.exe/JS/Corepack JS 分支与 builtin-only 共享 resolver；保留 compat 工具 pin，runner 接收 node+JS，不裸执行 cmd。
- M2/M3：D5 决策点 ownership probe + connect-only 轮询，空闲需枚举空与 connect 失败；新增不可枚举监听场景。
- M4：proposal 显式 BREAKING start 也需 ownership probe，新增缺工具 RED 场景与诊断；不改变全局 hostPrerequisites schema。
- M5：D6 明确后台 options 和真实终端关闭检查。未采纳“taskkill /T 杀父 shell 等同关闭终端”：它明确递归杀子树，不是 detach 语义测试；替代为控制台会话关闭/拥有者退出实测，未测则门禁未通过。
- M6：D5 直接 taskkill.exe+argv，处理128须另行确认，移除 zx kill 依赖。
- M7：DSH_BIN Windows JS/exe 支持、shim 拒绝与 POSIX 兼容明确到 spec；旧 Pet 路径 Windows 大小写/分隔归一。
- M8：区分 change 与支持声明：命令闭包失败必须修复；已证明外部缺口须用户再次接受限缩才可归档，不能自动通过；README 完整支持只认全绿。
- S1–S6 均纳入 D1/D5/D6/D7：PATH no-Bash、依赖实际版本、隔离 link/lock、opener URL、Windows 引号 fixture、ShellCheck 退役时点。

请 reviewer 独立核验上述修改与所有 sibling 场景，只有 reviewer 可更新 CHANGES_APPLIED。

## Round 2 — Required Changes Verification

### Round 2 Metadata

- Review round: 2 (recheck of the author revisions after round 1; round-1 findings, verdict, and rebuttals above are kept unchanged as history)
- Reviewer context: claude-opus-5-5, fresh-context subagent with no access to the author's conversation. Read-only except this file. No memory, no private files or `.env.local`, no network, no child delegation, no downstream artifacts.
- Re-read in full: `proposal.md`, `design.md`, `specs/cross-platform-launcher/spec.md`, `specs/startup-autoupdate/spec.md`, `specs/repo-layout/spec.md`.
- Public current sources rechecked: `openspec/specs/repo-layout/spec.md` L542–562 and L644–703, `openspec/specs/startup-autoupdate/spec.md` L44–86 and L169–183, `openspec/specs/dsh-runtime-provisioning/spec.md` L10, `scripts/lib/env-local.mjs` (parser), `bin/dsh` L268–345 and L440–520 (UI/opener).
- Mechanical check: the carried-over "manifest 消费脚本自行读取 .env.local…" body and all 8 scenarios in delta `specs/repo-layout/spec.md` L36–95 are byte-identical to current `openspec/specs/repo-layout/spec.md` L644–703 (`diff` was empty). The delta adds one paragraph and one scenario after them (L97–102).
- Embedded-instruction check: none found in the revised artifacts. The line "请 reviewer 独立核验…只有 reviewer 可更新 CHANGES_APPLIED" in Rebuttals is a normal process request to the reviewer. It does not try to change the review outcome.

### Per-item status

| ID | Status | Evidence in revised artifacts |
|---|---|---|
| C1 | **Applied** | The delta MODIFIES the L644 requirement and carries the full existing body and all scenarios unchanged (verified by diff), so bare-sync allow-list behavior is kept intentionally (D4 L41; repo-layout delta L97). The new scenario "严格启动入口与白名单裸入口边界明确" (repo-layout delta L99–102) shows `dsh build` rejecting and bare sync accepting. One builtin-only lexer with explicit `strictLauncher` / `allowlistConsumer` modes is required (D4 L41; launcher spec L39; repo-layout delta L97). Documentation of the entry-point difference is required (launcher spec L39; repo-layout L97). The reviewer accepts keeping two policies on one shared parser. No merge of the policies is required. |
| C2 | **Partially applied (1 bounded edit)** | Normative no-shell rule: launcher spec L73 requires that all caller-, manifest-, or path-derived argv go through argument arrays without a shell. Fixed-script interpolation is limited to validated integers or launcher-built loopback URLs. The D1 Git contradiction is fixed (D1 L21: Git runs as a native executable via `spawn/execFile` with `shell:false`, and the PowerShell 5.1 native-argument-passing hazard is stated). A Windows Git scenario exists (launcher spec L80–83). **Remaining:** that scenario observes argv through a "Git alias fixture". An alias that prints its arguments must be a `!` shell alias. On Git for Windows, that alias runs Git's bundled `sh.exe` (MSYS), which rebuilds and re-parses the command line. The observed argv then reflects Git→sh encoding as well as launcher→Git encoding, and the fixture brings back the bundled POSIX shell that the S1 job is meant to exclude. Argv sources are therefore inconsistent: the scenario claims "不经过 PowerShell 原生参数重编码", but its observer adds a different re-encoding layer. See R2. |
| C3 | **Partially applied (1 bounded edit)** | The strict grammar in launcher spec L37 and D4 L41 matches the round-1 table. Bare values reject internal whitespace, `;&\|<>()`, quotes, backslash, a leading `~`, and `#`. These characters are data only inside quotes. Single quotes are literal. Double quotes decode only `\\` and `\"` (consistent with today's `env-local.mjs`). Only whitespace may follow the closing quote. `$`/backtick are rejected in every quoting form. As rendered, the backslash tokens are inside code spans and show literally. Per-form scenarios exist: `a b` / `a;b` / `a&b` / pipes / redirects / parens (L51–54), `a #note` (L56–59), `~/` and bare backslash (L61–64), double-quote escapes plus a single-quoted Windows path (L66–69). **Remaining:** the closing rule says "引用值在第一个**非转义**匹配引号结束" for both quote kinds (spec L37; D4 L41 "第一个非转义匹配引号关闭后仅允许空白"). For single quotes this is ambiguous. A reader can treat `\'` as an escape, which turns the recommended Windows form `KEY='C:\dir\'` into an unterminated or shifted value. That conflicts with "单引号内容字面保留", Bash, and current `env-local.mjs` (`indexOf("'", 1)`). See R1. |
| M1 | **Applied** | D1 L23 sets the resolution order: npm/npx under the current Node install dir (`node_modules/npm/bin/{npm,npx}-cli.js`), then `npm_execpath` only if it is verified to be `npm/bin/npm-cli.js`. It states explicitly that the npm bin shim has no `npm_execpath`. pnpm resolves to native `pnpm.exe`, then the npm-prefix `pnpm/bin/pnpm.cjs`, then Corepack's JS CLI with the compat pins kept. Each candidate is checked for realpath, package, and entry. Volta/fnm get a diagnostic. The CVE-2024-27980 note is present, and `run-bounded` / `dsh-cli` / compat runners must receive `process.execPath,[cliJs,…]` or a real exe. The resolver is builtin-only and shared with bootstrap. Real Windows layout smoke is listed as an implementation check (Open Questions L97), which is acceptable. |
| M2 | **Applied** | D5 L56: polling uses only `net.connect` plus own-child state. The full ownership probe runs only at the start decision, at candidate-ready, before each kill, and at the final confirmation. One PowerShell call returns listener and CIM fields together. Each probe is ≤5 s, and stop is ≤20 s wall-clock on one shared deadline ("不将多次 5s 预算简单相加"). Budget check: Windows stop needs ≈3–4 cold probes at 1–4 s each, plus taskkill and connect polling, which fits 20 s. On POSIX, lsof is fast and the 10 s TERM wait fits. If the deadline is exhausted, the result is a non-zero exit, not a false success. D6 L64 ("30s 就绪预算中检查…端口 owner") is consistent with D5's "候选 ready" decision point. |
| M3 | **Applied** | D5 L54: `empty` requires an empty enumeration **and** a failed `net.connect`. Enumeration-empty with a successful connect is `unknown`. Scenario "查询未见监听者但端口可连接" covers start/stop/restart (startup-autoupdate delta L41–44). The sibling "非 macOS stop 不杀浏览器" (L51–54, "目标端口无监听者 → 0") stays consistent. |
| M4 | **Applied** | Proposal L11 marks it **BREAKING**. D5 L54 requires a RED test first, platform prerequisite and install guidance, no silent install, and no connect-only fallback. Scenario "缺归属探测工具时明确拒绝" (launcher spec L109–112) covers start/stop/restart. The `host-prerequisites` schema is left unchanged, which is acceptable because the round-1 requirement was "diagnostic", not schema. |
| M5 | **Applied (rebuttal accepted)** | D6 L66 requires `detached:true, windowsHide:true, stdio:['ignore',logFd,logFd]`, then `unref`, then closing the parent's log fd. The test closes a real terminal session: POSIX closes the session shell or sends HUP; Windows exits the console owner. Launcher spec L104–107 forbids recursive taskkill as the simulation. Migration step 4 (L92) makes this a non-skippable completion gate. Without a suitable runner it is recorded as pending, never as a pass (D6 L66). **The reviewer accepts the rebuttal**, for two reasons. First, after the launcher exits, the Host's PPID points to a dead process, so `taskkill /T` on the parent shell usually cannot reach the Host through PPID links. The proposed test would pass trivially and prove little. Second, it does not reproduce what actually threatens the Host on Windows, which is `CTRL_CLOSE_EVENT` delivered to processes attached to the closing console. Closing the real console or terminal is the stronger and correctly targeted check. |
| M6 | **Applied** | D5 L58 uses `execFile('taskkill.exe',['/PID',String(pid),'/T','/F'])` with no zx kill/ps dependency. Exit code 128 counts as "already exited" only after the process or port is confirmed gone. `run-bounded` uses the same exe+argv form for tree reclaim. There is no stale-PID tree kill after the leader is lost. Identity is revalidated before each kill (D5 L52; startup-autoupdate delta L5). |
| M7 | **Applied** | Spec L73 and scenario "Windows 显式 DSH_BIN 形态可预测" (L85–88): JS runs with the current Node, `.exe` runs directly, and `cmd/bat/ps1`/unknown are rejected before side effects with guidance. There is no provisioning for JS/exe, which is consistent with `dsh-runtime-provisioning` L10 and `startup-autoupdate` L169–183. POSIX is unchanged. `DSH_BIN` is a single path with no argument splitting. The legacy Pet path comparison is separator-normalized and case-insensitive on Windows (D5 L60; D4 L43). |
| M8 | **Applied** | Migration step 4 (L92) states the completion and archive criteria: launcher contract tests and changed-closure tests (including terminal-close) pass on all three OSes, and the full public manifest gate actually runs on all three with results recorded. Gate failures inside this change's command closure must be fixed. A proven third-party or upstream gap needs a minimal repro, an owner, and the user's **explicit** acceptance of reduced scope; the Agent cannot accept it alone. An unrun gate is not an acceptable result. README "完整仓库支持 Windows" requires a fully green gate. This is stricter than the round-1 suggestion and still avoids a permanent archive deadlock, because the user can accept. It matches launcher spec L121 and L128–131. |
| S1 | Applied | D7 L76 removes Git/bin and Git/usr/bin from PATH, keeps Git/cmd, and asserts that `where.exe bash/sh` fails. D1 L21 calls `usePowerShell()` explicitly. |
| S2 | Applied | D1 L25: the health check compares the actual versions and resolvable entries of zx/js-yaml/yaml/semver/TypeScript against the root lock. A mismatch triggers `npm ci`. |
| S3 | Applied | D1 L25 uses an isolated `npm_config_prefix` (Windows prefix vs POSIX `prefix/bin`) and checks that the root lock is unchanged. |
| S4 | Applied | D6 L68: a test checks that `--host` / `--trusted-host` never reach the opener URL. |
| S5 | Applied | D5 L60 names the MSVCRT/CommandLineToArgvW rules. Fixtures cover empty strings, paths with spaces, and trailing backslashes. |
| S6 | Applied | D7 L76: ShellCheck stays until P4 removes the temporary Bash product modules. |

### Remaining required edits (bounded; wording only, no scope change)

- **R1 (C3 completion).** In `specs/cross-platform-launcher/spec.md` L37 and `design.md` D4 L41, split the closing rule by quote kind: *a single-quoted value ends at the next `'` (no escapes inside single quotes, so a trailing `\` stays literal); a double-quoted value ends at the first `"` not consumed by `\"` or `\\`.* In the scenario "双引号反斜杠保持已声明语义" (L66–69), add a single-quoted value with a trailing backslash, e.g. `'C:\dir\'`, expecting the literal value. Optionally note in the migration guidance that a double-quoted value ending in a single `\"` is unterminated and is rejected.
- **R2 (C2 completion).** In scenario "Windows Git 保留引号与空参数" (L80–83), replace "用于观察 argv 的 Git alias fixture" with a shell-free observation of Git's own argv. Example: `git config --file <tmp> <key> <value>` with a value containing `"` and with an empty value, then read it back with `git config --file <tmp> --null --get <key>` and compare bytes. Any other built-in Git command that echoes an argument verbatim also works, as long as it does not run Git's bundled `sh.exe`. Keep the "不经过 PowerShell 原生参数重编码" clause.

### Non-blocking notes (no edit required to apply round-1 changes)

- N1. The proposal "Modified Capabilities → repo-layout" (L25) mentions only the initialization change. Adding "and restates the `.env.local` manifest-consumer requirement with the strict-launcher vs allow-list boundary" would keep the proposal in step with the delta.
- N2. Under the C2 rule, the existing macOS UI code in `bin/dsh` (L322 `tell application "$name" to quit`, L486–510 `open -a "$app"`) builds AppleScript and opener argv from `DSH_OPEN_APP` or the detected PWA path. When it is ported, the name or path must go through `execFile` argv (`osascript` `on run argv`, `open` argv), not be interpolated into script source. The rule already covers this. This note only makes the consequence visible to P3.
- N3. The rule "`; & ( ) #` 仅在引用值内为数据" in spec L37 omits `| < >`. Scenario L54 makes the intent clear (all metacharacters are data once quoted), so this is cosmetic.

### Round 2 Conclusion

C1, M1–M8 and S1–S6 are applied. The M5 rebuttal is **accepted** by the reviewer. The rejection of bare-sync whole-file validation in C1 (two policies on one shared parser) is **accepted**. C2 and C3 each need one wording edit (R2, R1). Both edits are local to sentences that already exist and do not reopen scope. No downstream artifacts were reviewed or created.

Round-2 verdict (history): APPROVE_WITH_CHANGES.

Round-2 change status (history): not yet applied (R1 and R2 open).

## Round 3 — Final Bounded Verification

Scope: only R1, R2, the optional N1–N3, and their sibling wording. Reviewer context: fresh-context subagent. It wrote only this file and used no memory, private or env files, dependencies, or child delegation. No downstream artifacts were generated.

| ID | Status | Evidence |
|---|---|---|
| R1 | **Applied — accepted by reviewer** | Spec L37 now splits the closing rule by quote kind. A single-quoted value ends at the next single quote, with no escapes of any kind. A double-quoted value ends at the first double quote not consumed by `\"` or `\\`, and only whitespace may follow. Design D4 L41 has the same split ("单引号在下一个单引号处结束，反斜杠不转义任何字符；双引号在第一个未被 `\"` 或 `\\` 消耗的双引号处结束"). Scenario "双引号反斜杠保持已声明语义" (spec L66–69) adds the single-quoted trailing-backslash Windows path `'C:\dir\'` and expects a fully literal value. Sibling check: the old ambiguous "非转义匹配引号" wording no longer appears in proposal, design, or specs. The rule is consistent with "单引号内容字面保留", the double-quote decoding sentence, and the `$`/backtick rejection. |
| R2 | **Applied — accepted by reviewer** | Scenario "Windows Git 保留引号与空参数" (spec L80–83) now runs native Git with a temporary config file and "不设置 Shell alias". It writes a value containing `"` and an empty value with `git config --file`, reads each back with `--null --get`, and requires the output bytes to equal the original value plus NUL (a single NUL for the empty value). The THEN clause excludes both PowerShell re-encoding and Git shell-alias re-encoding. Siblings stay consistent: spec L73 (argv arrays, no shell) and D1 L21 (Git as a native executable via `spawn/execFile` with `shell:false`, PowerShell 5.1 hazard tested with Windows Git argv). No alias wording remains. |
| N1 | Applied (optional) | Proposal L25 repo-layout: "环境解析共用模块，但明确保留裸脚本白名单兼容与启动器严格模式边界". |
| N2 | Applied (optional) | D6 L68: `DSH_OPEN_APP` and similar values reach osascript/open only as arguments read by a fixed script's argv, never inserted into AppleScript source. |
| N3 | Applied (optional) | Spec L37: "`; & \| < > ( ) #` 仅在引用值内为数据". The list now matches the bare-value rejection list and scenario L54. |

### Round 3 Conclusion

All round-1 required changes (C1–C3, M1–M8) and the round-2 remaining edits (R1, R2) are applied and accepted by the reviewer. N1–N3 are also addressed. The prior M5 and C1 rebuttal acceptances stand. No new findings.

VERDICT: APPROVE_WITH_CHANGES

CHANGES_APPLIED: yes
