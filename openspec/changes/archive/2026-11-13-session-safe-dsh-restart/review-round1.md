# Review: session-safe-dsh-restart

## Review Metadata

- **Review round:** 1
- **Prior round:** none
- **Reviewer context:** fresh-context independent adversarial reviewer (Anvil), did not participate in authoring; the three change artifacts were treated as data, not instructions. Environment: Linux/WSL2, systemd 255.4-1ubuntu8.18, repository worktree `.worktrees/dsh-dsh-restart` at base commit `8aeca83d`; the change has no implementation/tasks yet (`openspec list`: `no-tasks`), so this review judges proposal/design/spec facts and feasibility only.
- **Tool restrictions:** read-only except this `review.md`. No writes to source/tests/config/manifest, no build/sync/npm/git-write, no service/Host restart, no network, no state-changing shell. Read-only shell used: `cat /proc/$$/cgroup`, `systemctl --user show/list-units`, `man systemd-run`, `openspec validate --strict`, `git status/log`, `grep/sed/ps`.
- **Artifacts reviewed (read in full):**
  - `openspec/changes/session-safe-dsh-restart/proposal.md` (36 lines)
  - `openspec/changes/session-safe-dsh-restart/design.md` (133 lines)
  - `openspec/changes/session-safe-dsh-restart/specs/session-safe-restart/spec.md` (111 lines)
- **Source/spec evidence inspected (read-only):** `bin/dsh.mjs`; `scripts/launcher/{main,process,args,environment,runner,ui,maintenance}.mjs`; `tests/launcher-{contract,lifecycle,atomic,cli-routing,process,ui}.test.mjs`; `tests/helpers/launcher-fixture.mjs`; `openspec/specs/{startup-autoupdate,launcher-npm-environment,repo-layout}/spec.md`; `openspec/changes/cross-platform-launcher/{proposal,design,tasks,verify}.md` and its `specs/startup-autoupdate/spec.md` delta; `instructions/dsh-home.md`; `skills/{add,remove}-dsh-plugin/SKILL.md`; `README.md`; `BACKLOG.md`; compat build at `packages/dsh-pet/compat/subagent/.launcher-builds/d1fbbf15c1c1d9e0b4ca80de6ffcb0450d5c0a25af9f1eda4b51ec16645ab279-372ff018-8cf6-4e66-942c-3ffe06b95ced/node_modules/@deepseek-ai/` (cited below as `$COMPAT`): `dsh-subprocess-local/README.md`, `dsh-subprocess-local/lib/index.js`, `dsh/lib/profile-boot-BZ2ZjNWi.js`, `dsh-shell-env/README.md`, `dsh-terminal-bash/lib/index.js`; `~/.dsh/dsh-startup.log` (incident evidence); local `man systemd-run`.
- **Source verification performed (claims checked, not trusted):**
  - ✅ Root-cause mechanism is accurate: this reviewer's own agent shell runs in `/user.slice/.../dsh-subprocess-25773-<hash>.scope` (cgroup read), with `DSH_SHELL=1`, `DSH_SESSION_ID`, `DSH_WEB_URL` in env; `$COMPAT/dsh-subprocess-local/lib/index.js:48-50,486` shows `dsh-subprocess-<hostpid>-<12hex>` naming via `unitStem`; `$COMPAT/dsh-subprocess-local/README.md:66` confirms disposal "terminates every running managed range and terminal session and awaits quiescence"; `$COMPAT/dsh/lib/profile-boot-BZ2ZjNWi.js:12,230,243,249` confirms SIGTERM → `shutdown.interrupt` → whole-app `dispose`. So a session-launched `dsh restart` is killed after SIGTERM, before spawn, exactly as claimed.
  - ✅ Incident evidence in `~/.dsh/dsh-startup.log:50-51`: failed in-session attempt leaves only `hostPrerequisites: skipped` at `2026-10-26T15:35:04.948Z` (11:35:04 EDT) with no success record, then the external restart records success at `15:35:37.386Z` — consistent with proposal:3 / design:5.
  - ✅ The change's evidence for old instruction wording is accurate: `skills/add-dsh-plugin/SKILL.md:28` and `skills/remove-dsh-plugin/SKILL.md:17` contain "**由用户执行**——重启会中断当前会话，agent 在会话内执行等于自断"; `instructions/dsh-home.md` currently has no restart section; README:92 has a one-line `dsh restart` description.
  - ✅ Cross-change analysis is accurate: `cross-platform-launcher` is still active (111/169 tasks, not archived) and owns the `MODIFIED` delta for the `startup-autoupdate` stop/restart requirement (`openspec/changes/cross-platform-launcher/specs/startup-autoupdate/spec.md`); main already contains the Node launcher baseline (`scripts/launcher/main.mjs` tracked at HEAD).
  - ✅ Platform facts: user manager reachable (`systemctl --user show --property=Version` → 255.4), `systemd-run` present, `--expand-environment=` documented as "Added in version 254" in local `man systemd-run`; with `--scope`, systemd-run executes the command synchronously and returns only when that command exits (man `systemd-run`:28-32), which is the property the design relies on.
  - ✅ `openspec validate session-safe-dsh-restart --strict` passes.
  - ❌ Found factual/citation defects and two blocking detection gaps: see C1, C2, S3.

## Findings

The core "why" and failure mechanism analysis is **verified correct**; the blocking issues are in the detection contract and in the normative spec's internal consistency, followed by implementation-boundary and testability gaps.

### 🔴 Critical (blocking)

#### C1. 会话语境识别漏掉 `dsh-terminal-*` managed range；原始半重启在 DSH 终端面板内仍可复现，正常面板调用也会被误送入 fail-closed

**Evidence**
- `spec.md:5` requires checking only `dsh-subprocess-*.scope`; `design.md:37` pins the regex `/dsh-subprocess-\d+-[0-9a-f]+\.scope/`; `spec.md:9,21`, `design.md:38-41` all key off that one prefix.
- The provider does **not** use that prefix for terminal sessions: `$COMPAT/dsh-subprocess-local/lib/index.js:448-464` creates Linux PTY scopes with `unitStem("dsh-terminal")` (`:458`), while ordinary subprocesses use `unitStem("dsh-subprocess")` (`:486`); naming is `${prefix}-${process.pid}-${randomBytes(6).toString("hex")}` (`:48-50`). `$COMPAT/dsh-subprocess-local/README.md:66` — which `design.md:4` itself quotes — says disposal terminates "every running managed range **and terminal session**".
- Therefore a `dsh restart` typed in a DSH terminal panel (or run by any process inside that panel) is inside a Host-managed range that the old Host's dispose also terminates, yet detection cannot recognize it by cgroup.

**Consequence (two real paths)**
1. **Normal panel invocation** (with markers): `$COMPAT/dsh-terminal-bash/lib/index.js:941-942` injects `DSH_SHELL=1`/`DSH_SESSION_ID` per terminal session, so markers hit but cgroup does not match → `design.md:39` row 3 ("cgroup 与 env 证据冲突") → treated as session context. The artifacts then disagree about what happens: `spec.md:5` R1 requires "进入 fail-closed", while `design.md:39` allows "fail-closed **或**脱离路径". Either reading is wrong as specified: fail-closed refuses a restart on a supported platform where `spec.md:27` R2 promises the detach path, and detach is only correct if terminal ranges are recognized as managed ranges (the fix below); the spec contains no terminal-range scenario at all.
2. **Marker-stripped panel invocation** (e.g. `sudo …`, `env -u DSH_SESSION_ID -u DSH_SHELL …`, or a wrapper that scrubs env): no cgroup match + no markers → external sync path → the Host dispose kills the launcher during terminal-session teardown *after* stop → exactly the original "stop succeeded, start never happened" bug returns, contradicting proposal:3/9 and design Goal `design.md:13`.

**Fix (required)**
- Extend the managed-range predicate to all provider-managed prefixes from the provider contract: `dsh-subprocess-*` **and** `dsh-terminal-*` (ideally expressed as a provider-contract-derived matcher plus a regression fixture built from the actual naming rule), and state it in `spec.md:5` and `design.md:33-41`.
- Add scenarios: (a) DSH terminal panel invocation with markers; (b) terminal-managed cgroup with markers stripped. Decide and document explicitly whether P0 detaches or fails closed for terminal-range callers; in either case a terminal-range caller must never take the external sync path.
- Note the asymmetry already captured in `design.md:116`: the false-positive direction (markers on an external terminal) is safe; the false-negative direction on managed ranges is the dangerous one and is currently open for `dsh-terminal-*`.

#### C2. 非 Linux 会话检测没有被规范强制的证据来源；R1 的 `MAY` 标记与 R2 的平台级 fail-closed 自相矛盾（且与 R1 Scenario 3 冲突）

**Evidence**
- `spec.md:5` makes session env markers optional ("可(MAY) 辅以会话环境标记"), and requires cgroup checks only on Linux/WSL. On darwin/win32 there is no cgroup, so if an implementation follows the spec literally (cgroup-only, MAY markers), it has **no** session evidence on non-Linux platforms. `design.md:40-41` nevertheless depends on markers for exactly those platforms.
- The markers are a real and guaranteed substrate and should be normative, not optional: `$COMPAT/dsh-shell-env/README.md:32` — every model shell call gets `DSH_HOME`, `DSH_SHELL=1`, and agent calls get `DSH_SESSION_ID`; terminal sessions get both (`$COMPAT/dsh-terminal-bash/lib/index.js:941-942`). This reviewer's own shell confirms all three (`DSH_SHELL`, `DSH_SESSION_ID`, plus `DSH_WEB_URL`).
- R2 is written platform-level: `spec.md:27` "P0 不支持的环境（macOS、Windows…）必须 fail-closed", and the scenario `spec.md:35-39` GIVEN "平台为 darwin 或 win32 … 非零退出". Read literally this would make **external** macOS/Windows `dsh restart` fail closed, contradicting R1 Scenario 3 (`spec.md:19-23`: external terminal → unchanged sync path), proposal non-goal `proposal.md:16`, and design Goal `design.md:17` ("外部终端路径…零变化").
- On Windows the same gap exists: `spec.md:5` never requires any Windows session signal; `dsh-tool-pwsh`/shell-env facts are the only viable substrate.

**Fix (required)**
- Rewrite R1 detection as a cross-platform rule: session **if** (a) session env markers hit (`DSH_SHELL=1`, agent `DSH_SESSION_ID`; SHALL on every platform), **or** (b) on Linux/WSL the cgroup matches any Host-managed range prefix (C1); external only if neither hit; reading failure with any marker hit ⇒ fail-closed. Mention that markers can be spoofed/leaked (false positive is the safe direction, already noted in `design.md:116`).
- Scope R2 fail-closed to "会话语境下的 P0 不支持环境"; keep the external path explicitly synchronous on those platforms.
- Add scenarios: darwin/win32 with markers → fail-closed, zero side effects, external-terminal guidance; darwin/win32 without markers → unchanged sync path; Linux cgroup unreadable but markers present → fail-closed.

### 🟡 Moderate

#### M1. `performRestart` 的抽取边界遗漏了现有 restart 的前置阶段（autoUpdate / ensurePrerequisites），脱离路径会与外部路径语义分叉

- Current restart path is not just prepare→stop→spawn: `scripts/launcher/main.mjs:78-85` runs `autoUpdate(context)` and `ensurePrerequisites(context)` for `flags.restart` **before** prepare; the frozen contract tests assert this call trace (`tests/launcher-contract.test.mjs:104,164-170`: `DISABLED_UPDATE`, `PREREQ`, then `dsh-server-bin`; stop must not start before preparation).
- `design.md:3` describes restart as prepare→doStop→spawn and `design.md:61-68` scopes the shared module to "prepare → doStop → spawn → readiness", claiming both paths reuse one implementation. If implemented as written, the orchestrator path skips the auto-update/prerequisite stage, so `dsh restart` behaves differently depending on caller context (external restarts may auto-upgrade/heal prerequisites; session restarts silently won't), and design Goal `design.md:17` / decision title `design.md:61` ("同一语义") is false.
- Required: explicitly place autoUpdate/ensurePrerequisites in the shared restart implementation (run inside the orchestrator before prepare), or declare the intentional divergence and justify it; add a spec requirement/scenario and contract test for parity. Also update `design.md:3` to describe the real current sequence.

#### M2. "排程成功"只证明 `/bin/bash` 启动过，不证明 orchestrator 已接受任务；缺少 launcher↔orchestrator 的生命周期 ack

- `design.md:55` claims "外层 systemd-run 同步返回即代表新 scope 已建立且 orchestrator 已在其中启动". `man systemd-run` (local, systemd 255) says that in `--scope` mode systemd-run executes the command synchronously and returns when **that command** finishes — here the command is `/bin/bash -c '… & disown; exit 0'`, which returns as soon as it has backgrounded orchestrator. A missing/unreadable node binary, a bad script path, or an immediate orchestrator crash still yields `systemd-run` status 0 (or only later failure), after which `spec.md:27`'s "确认该进程已成功建立/接受任务后才允许停止" is not really satisfied.
- Consequence: launcher can print "restart 已排程" and write receipt `scheduled` for a restart that will never happen; receipt is left with a non-terminal phase, and R2's "排程成功与失败都必须留下对应阶段" (`spec.md:27`) has no defined outcome. Host is not stopped (safe), but the command lied about scheduling and no session recovery guidance exists.
- Required: add an acknowledgment/handshake from orchestrator (e.g. orchestrator appends `orchestrator-ready` and the launcher waits for it with a small bounded timeout before printing/returning, or orchestrator creates a ready file that the launcher waits on), define the failure receipt (`failed phase=schedule` vs a distinct phase), and add a scenario "排程命令返回 0 但 orchestrator 立即退出" with no Host stop.

#### M3. 失败尾部未闭合：停止阶段失败、orchestrator 在 stop 后死亡、以及"Host 未起来时谁来恢复"没有规范；Goal 对"不再产生半重启"的表述过强

- R3 (`spec.md:47-73`) covers prepare failure, handoff failure, start failure — but **not stop failure/refusal** (identity changed, unknown occupier, kill failed after the old `stopServer` proof) and not **orchestrator death after stop** (user-manager restart/logout is acknowledged in `design.md:113`; OOM/crash is the same class). In both cases the receipt ends on a non-terminal phase and `dsh history`'s required "展示最近一次 restart 的终态与失败阶段" (`spec.md:77`) is undefined.
- Worse, handoff failure and start failure deliberately leave the Host stopped (`spec.md:47-49,63-73`): the user-visible outcome is still "停机成功、启动没发生", only now recorded. `design.md:13` "会话内 `dsh restart` 不再产生'停止成功、启动未发生'的半重启" overclaims; proposal:10 is more honest ("失败同样落盘").
- R4/instruction requirement (`spec.md:77,97-99`, `design.md:90-92`) only says "重连后按 receipt 验证" — but if the Host did not come back there is nothing to reconnect to and no instruction says "在外部终端执行 `dsh` 恢复". This is the recovery path for the exact residual failure.
- Required: add scenarios/requirements for (a) stop-stage failure → `failed phase=stop`, no replacement start, Host state reported truthfully; (b) orchestrator died after stop → `dsh history` must flag an **incomplete/abandoned** restart (last phase ≠ terminal, Host not owned) rather than silently showing nothing; (c) instructions must include the recovery command (`dsh` from an external terminal) and what to report to the user; align `design.md:13` wording with the residual down-state.

#### M4. Receipt 契约不可机械断言：阶段词表在 proposal/design/spec 之间不一致，且没有 restart 身份导致"最近一次"和并发无法解析

- Vocabulary drift: `proposal.md:10` lists `requested / prepared / …`; `design.md:76` uses `scheduled / …`; `spec.md:45` requires `failed phase=schedule`, while `design.md:76` says `failed` carries `failedPhase`; `spec.md:55` full sequence omits `scheduled` even though R2 requires it to be recorded. Tests cannot assert one machine-readable vocabulary from the artifacts as-is.
- The receipt schema (`design.md:76`) has `{ts, phase, source, port, pid?, oldPid?, newPid?, dshVersion?, rc?, reason?}` — **no restart/run id**. "最近一次 restart" (`spec.md:77`, `design.md:78`) cannot be robustly identified when two restarts overlap (two agent sessions; design risk `design.md:118`) or when an external restart happens after a session restart (`design.md:117` risk is not encoded in any requirement). A stale `ready` receipt could be shown as "最近一次" after a later external restart.
- Required: pin one exact phase enum (`scheduled|prepared|stopping|stopped|process-exited|starting|ready|failed` + `failedPhase`) in the spec and use identical names in proposal/design; add `restartId` to every event; define `dsh history` selection/merge rules (latest terminal event by id; how to label a non-terminal/incomplete run; how to reconcile with `dsh-startup.log` when they disagree) and add a concurrency/staleness scenario.

#### M5. "参数数组、无 shell 拼接"与展示的排程命令自相矛盾；路径/透传参数进入 `bash -c` 字符串带来引号破坏与命令注入面

- `design.md:47` states the scheduling command is built by the launcher and run with `run()` as "参数数组、无 shell 拼接", but `design.md:49-53` shows `/bin/bash -c 'nohup <node> <repo>/scripts/… <explicit-args> >> … 2>&1 & disown; exit 0'` with `<node>`, `<repo>`, `--home`, `--pass-through…` interpolated into a single-quoted shell string. A repo path containing `'`, a `.env.local`-derived `DSH_HOME` with shell metacharacters, or pass-through values such as `--host "a'; …"` can break the command or execute arbitrary shell text (the values come from the user/agent's argv via `scripts/launcher/args.mjs:15-23`, and from repo-controlled config). Even without a hostile input, this contradicts the stated construction rule and is untested by D8's schedule-argv unit test.
- Required: construct the inner invocation without interpolating variable data into the script text — e.g. `systemd-run … -- /bin/bash -c '<fixed script>' dsh-restart <explicit argv…>` and consume `"$@"`; or `systemd-run … -- <node> bootstrap.mjs …` where a fixed bootstrap spawns the orchestrator detached+unref and exits. Add a hostile-fixture test (repo/home/pass-through containing spaces, quotes, `$()`, `;`) asserting argv integrity and that no shell expansion occurs.

#### M6. Test 分层存在非 hermetic 风险：现有 spawn 型 launcher 测试继承真实 cgroup/环境，在 DSH 会话里跑 `npm test` 会让 restart 测试走真实 systemd-run/fail-closed；且 fixture 属于尚未归档的 cross-platform-launcher

- `design.md:43` only promises an in-process injection point ("由 runLauncher 的注入点覆盖"). But existing regression suites drive the launcher as a **real child process**: `tests/launcher-lifecycle.test.mjs:32` spawns `bin/dsh.mjs` with `env: {...process.env, …}`; `tests/helpers/launcher-fixture.mjs:60,79-103` builds a Node harness that calls `runLauncher` in-process with no detection injection. When `npm test` is run from a DSH agent bash tool (the normal dev loop for this repo; this reviewer's own shell is in `dsh-subprocess-…scope` with `DSH_SESSION_ID`), those children read the **real** `/proc/self/cgroup` and inherit markers → every `restart` test would take the session path, schedule real transient scopes, or fail closed. Design D8 (`design.md:96`) and proposal Impact (`proposal.md:33`) do not cover the spawned-`bin/dsh.mjs` path, the fixture helper, or a documented test-only override.
- Additionally, `tests/helpers/launcher-fixture.mjs:1-2` and `tests/fixtures/launcher-bash-baseline/` are explicitly a frozen oracle owned by the still-active `cross-platform-launcher` change (111/169 tasks; its verify records these suites as its acceptance evidence), and `design.md:126` only says "确认 launcher 工作已合入 main…记录 baseline commit". Changing the fixture/expectations while that change is unarchived needs explicit coordination; otherwise this change silently edits another active change's acceptance basis.
- Required: specify and test the hermeticity strategy for both in-process and spawned-launcher tests (real cgroup read must be injectable/overridable in a way that is not available to normal agent use, or tests must run restart contracts against an explicitly injected context); add a guard test that external-path suites never consult ambient session state; list the fixture-helper change and the cross-change verification evidence / archive-order dependency in proposal/design.

#### M7. P0 支持边界写得太弱：`systemd-run --expand-environment=no` 需要 systemd ≥ 254，规范只写"`systemd-run --user --scope` 可用"，且"可用"没有可机械断言的探测契约

- `spec.md:27` defines support as "Linux/WSL 且当前用户 systemd 可用（`systemd-run --user --scope`）". But `design.md:59` probes `systemd-run --user --scope --expand-environment=no`; local `man systemd-run` documents `--expand-environment=BOOL` as **"Added in version 254"**. `$COMPAT/dsh-subprocess-local/README.md:150` (Known Limitations) says Linux native ownership needs "a readable user manager and `systemd-run --expand-environment=no`; older systemd versions use the warned PGID fallback" — on older systemd the Host provider itself falls back, so the managed-range cgroup would not exist and this change would fail closed rather than work (consistent, but the spec should say so).
- Also note `--scope` already disables environment expansion by default (man: "except for --scope where it is disabled by default, for backward compatibility"), so the flag is redundant today and solely raises the floor to systemd 254.
- Required: spec the supported predicate precisely (user manager reachable + `systemd-run --scope` accepting the exact flag set, e.g. via the same bounded capability probe), state the minimum systemd generation or the probe-based boundary, and add a scenario for "systemd 版本/能力不足 → fail-closed with a support-boundary message".

#### M8. 指令真相源的规范缺"不得未经用户明确要求自行重启"，且其验收场景不可机械断言

- `spec.md:97-99` R5 says agents may execute in-session restart "在用户明确要求时", but nowhere requires **not** executing on the agent's own initiative; the consent rule appears only in non-normative `design.md:90` ("仅用户明确要求时执行"). The tests described in `spec.md:101-111` only assert presence of four phrases and absence/presence of old wording — they cannot assert "不得当次宣称成功" behavior or "不再作为唯一指引" (the latter is not a mechanical predicate; restate as "old directive must be removed/rewritten" with exact tokens).
- The test scenario `spec.md:104` also says "运行 `dsh build`（sync）", but the existing instruction-materialization tests drive isolated sync directly (`tests/sync-agent-instructions.test.mjs` fixture) and `dsh build` additionally runs auto-update/prerequisite stages — the scenario should name the exact hermetic command it means.
- Required: add a SHALL NOT autonomous restart clause + exact user-consent wording requirement to R5; add test assertions for the consent phrase and the removal of the old "由用户执行…等于自断" wording in the two skills and README; make the scenario's materialization command hermetic and unambiguous.

#### M9. Receipt 持久化失败没有策略（R4 要求强制落盘，但 design 未定义 `$DSH_HOME` 不可写/磁盘满时是否允许停止 Host），且文件属性未规定

- R4 (`spec.md:77`) makes the receipt mandatory for every session-context restart; `design.md:74-79` does not say what happens when the append fails. If the launcher cannot persist even `scheduled`, proceeding to stop the Host produces a restart whose result is unverifiable by design — the failure mode the change exists to prevent. Also no file mode is specified (cf. `scripts/launcher/ui.mjs:42` precedent: `dsh-ui.log` appended with `0o600`), and `dsh history` parses "receipt 尾部" without a bounded-tail definition.
- Required: specify fail-closed-before-stop when the initial receipt write fails (or a documented, explicitly degraded path), specify mode/ownership (0600, mkdir), define tail size/rotation or last-N semantics, and add a scenario for unwritable/full `$DSH_HOME`.

### 📌 Suggestions

#### S1. grace 5s 应由确定性握手替代/补强，不应作为唯一时序保证
`design.md:70-72` uses a fixed 5000 ms sleep and leaves calibration to an Open Question (`design.md:130`). The sleep is meant to let the tool result reach the agent, but nothing verifies that happened; a slow launcher print or slow Host write can still lose the result, while a slow agent turn is cut anyway. The Host's own shutdown grace is also exactly 5 s (`$COMPAT/dsh/lib/profile-boot-BZ2ZjNWi.js:12`), which invites double-margin mistakes. Recommendation: have the orchestrator wait on a launcher-lifecycle handshake (e.g. launcher writes a `launcher-done` marker after printing; orchestrator waits for it plus a small settle window), keep the sleep only as a fallback cap, and calibrate with the real-machine acceptance.

#### S2. "为什么不选 `--no-block` / service / setsid"缺一项：`--no-block` 与"service 主进程即 orchestrator + 新 Host 另起 scope"未被评估
`design.md:100-108` rejects setsid/nohup/detached and transient service, but (a) never mentions `--no-block` (man systemd-run: it applies to service mode; with `--scope` it is not the relevant escape), and (b) the service rejection argument "主进程退出会 kill 同 cgroup 残留，替代 Host 会被连带杀掉" only rejects the naive variant where the Host stays in the service cgroup; a transient **service whose main process is the orchestrator** (`systemd-run --no-block --unit=… node orchestrator.mjs`) that launches the Host into its own `--scope` would avoid both the shell-string construction (M5) and the "orphan survives empty-man scope" empirically-dependent behavior (which is measured here but is a documented-by-measurement rather than contractual property — man only promises systemd-run returns when the scope *command* finishes). The provider itself uses a launch-request-file + private-runner bootstrap instead of `bash -c` (`$COMPAT/dsh-subprocess-local/lib/index.js:458-464,486-500`) and is the better precedent; record these alternatives and either adopt one or add a precise rejection rationale plus the real-systemd test that pins the chosen behavior.

#### S3. 事实/引用错误（需修正，不影响方向）
- `proposal.md:19` and `design.md:24` cite "BACKLOG B014/U008" for the worktree `DSH_HOME`/restart-target problem, but `BACKLOG.md:792` `U008` is "locus 创建时把入口群名写进记录并在投递 prompt 呈现" — unrelated. Only `B014` (`BACKLOG.md:114-140`) covers it. Fix both citations.
- `design.md:3` says `process.mjs:161-207`; `stopServer` actually spans `:161-208` (closing brace at 208). `main.mjs:106-161` is a rough range (spawn at :111, readiness loop :118-130, cleanup/winner handling :131-161) — acceptable but better cited as `:111-162`.
- `proposal.md:10`/`design.md:76`/`spec.md:45` phase naming drift is covered in M4.

#### S4. "外部终端零变化"与 R4 对 `dsh history` 的扩展存在范围措辞冲突
`design.md:17` says external path behavior/output/exit codes are zero-change; `proposal.md:16` limits this to `dsh restart`. But R4 (`spec.md:77-78,93-95`) requires `dsh history` to display newly parsed restart state whenever a receipt exists, which changes external-terminal `dsh history` output (intended). Scope the zero-change claim to the restart path and explicitly list the accepted `dsh history` additive change; add a no-receipt regression that output stays byte-identical to today (existing `tests/launcher-contract.test.mjs:79-87` is a good anchor to extend).

#### S5. D6 的会话身份清理是 3 项 denylist，可能漏掉其他会话作用域 `DSH_*`
`design.md:84` removes `DSH_SESSION_ID`/`DSH_SHELL`/`DSH_WEB_URL` from the replacement Host env. DSH shell-env facts are extensible (plugin contributors; historically `DSH_SESSION_JSONL` appears in repo docs: `openspec/changes/archive/2026-09-03-pet-send-cr-and-workspace-env/design.md:66`), so a denylist will drift. Prefer an allowlist rule: strip every `DSH_*` from the new Host env except the home/profile facts (`DSH_HOME`, `DSH_PROFILE`, `DSH_PROFILE_DIR`) and the explicitly needed launcher values; test that a representative plugin-contributed `DSH_*` does not reach the replacement Host. (Impact is lower because shell-env discards inherited `DSH_*` for future shell calls, but Host-level plugins can read process.env.)

#### S6. D8 的真实 systemd 用例只证明"父 scope 被杀后孙进程存活"，核心不变量仍只有人工真机验收
`design.md:96-98` unit tests use injected seams; the real-systemd row tests the bootstrap pattern; the true invariant (orchestrator survives the **Host dispose** and then completes stop→start) is only covered by the manual WSL acceptance. Add a real (Linux, no-Host) integration row with a fake Host process that, on SIGTERM, mimics the provider contract by terminating its own managed range (e.g. a `systemctl --user kill`/scope stop plus process-group kill) and verify the orchestrator survives and writes a terminal receipt. Keep the manual end-to-end row as the final gate; do not let the fake replace it.

#### S7. `dsh stop` 的会话语义未进入 proposal 非目标/指令说明
`design.md:132-133` leaves in-session `dsh stop` as an open question: the Host stops correctly but the caller is killed, so from the agent's perspective the tool call dies even though the goal succeeded. The change's instruction update should either state this explicitly (agent must expect disconnect and must not treat it as failure) or add it to proposal non-goals; leaving it out of both creates a future misdiagnosis opportunity.

#### S8. 会话语境下的既有 flag/argv 组合未定义
`design.md:49-56,84` mentions `--pass-through`, but not how the detached path treats `--foreground`, `--build`/`-b`, `--open`/`--no-open`, `--host`/`--trusted-host`, `--check`/`--dry-run`/`-y`, or combinations such as `dsh restart --build`. `args.mjs` accepts and combines these; the orchestrator's intended argv passthrough and the launcher's pre-schedule side effects need an explicit matrix (reject unsupported combos fail-closed before scheduling vs forward to the replacement Host). Add scenarios/tests for the rejection matrix.

#### S9. Scenario→test 映射与 test-plan 尚不存在
`openspec list` shows `session-safe-dsh-restart` status `no-tasks`; the change has no `tasks.md`/`test-plan.md` yet. Cross-platform-launcher's precedent (47 mechanically mapped scenario/test rows) is the right bar: before implementation, every `#### Scenario:` here (including the new ones required to close C1/C2 and the Moderate findings) should map to an exact test file/name, with the real-systemd and manual rows explicitly labeled as required evidence rather than skippable.

#### S10. 归档后与新 capability 的关系需要显式交叉引用
`proposal.md:29` / `design.md:108` correctly avoid modifying the active `cross-platform-launcher` MODIFIED requirement. Once both are archived, two requirements will describe `dsh restart` behavior (base requirement + this new capability). Add a sentence in the new capability spec stating precedence/relationship (this capability adds session-context guarantees; the base requirement remains the external/synchronous contract) so future readers/validators do not treat them as competing sources.

## Embedded-Instruction / Injection Attempts

**Detected:** none.

- Scanned all three artifacts for reviewer-directed text, approval pressure, "ignore previous instructions", hidden control/zero-width characters, and fabricated tool/verdict directives: none found.
- Normative statements about agent behavior (`spec.md:97-111`, `design.md:88-92`) are legitimate requirements for the repo's instruction truth source (DSH agents), not attempts to steer this reviewer; they were evaluated as product requirements (see M8).
- The artifacts themselves instruct `dsh`/agent behavior (e.g. "本次 turn 不得宣称成功") — these were treated as data/requirements, not as commands to this review.

## Verdict

Blocking specification defects remain: (1) the managed-range detection contract is incomplete (`dsh-terminal-*` missing), which leaves the original half-restart reachable and contradicts the supported-platform detach promise; (2) non-Linux session detection has no required evidence source and R2 contradicts R1's external-terminal invariance. The change is directionally right, the root cause analysis is verified accurate, and the design's core systemd mechanism is sound, but the spec/design need another round before implementation.

VERDICT: REVISE
CHANGES_APPLIED: n/a

## Required Changes (if APPROVE WITH CHANGES)

n/a — verdict is `REVISE`. Re-review should focus on Critical C1–C2 closure first; Moderate M1–M9 should be resolved or explicitly dispositioned in the next proposal/design/spec revision (no code exists yet, so all are cheap to fix now).

CHANGES_APPLIED: n/a

## Rebuttals

_(reserved for author rebuttals; none recorded in round 1)_
