# Focused macOS ownership repair review

## Verdict: PASS — scoped implementation review only

What this change does: It requests a UTF-8 English locale for macOS `ps`, so a Chinese DSH entry path is not replaced with display escapes. A readable foreign or explicitly rejected ambiguous command now produces an identity record with no recognized argv, instead of turning a successful query into a probe error. Neither result grants permission to stop an unknown listener.

No blocking finding in the reviewed changes. This is **not native macOS or cross-platform acceptance**. The expected load is a local, single-user launcher with potentially competing starts, not a remote process-management service.

## Scope and requirements

Reviewed the current working-tree diff in:

- [Process ownership implementation](</scripts/launcher/process.mjs>).
- [Process tests](</tests/launcher-process.test.mjs>).
- [Launcher fixture](</tests/helpers/launcher-fixture.mjs>).
- [Subprocess closure tests](</tests/subprocess-closure.test.mjs>).
- [Atomic negative observer](</tests/launcher-atomic.test.mjs#L302-L317>).

Read the manifest pin and connected launcher caller. Requirements come from the [current stop safety requirement](</openspec/specs/startup-autoupdate/spec.md#L44-L61>), refined by the active change's [ownership and revalidation requirements](</openspec/changes/cross-platform-launcher/specs/startup-autoupdate/spec.md#L3-L39>) and [design D5](</openspec/changes/cross-platform-launcher/design.md#L45-L60>). The active delta intentionally supersedes older restart ordering and platform UI details; this review does not reinterpret those historical differences as defects in the scoped repair.

## Evidence and safety trace

### 1. Locale repair preserves the ownership checks

[The `ps` call](</scripts/launcher/process.mjs#L100-L103>) changes only its child environment locale to `en_US.UTF-8`. It still uses fixed argv, the same identity parser, and the same failure handling. The locale is scoped to `ps`, not the Host or the caller environment.

[The revised Chinese-path fixture](</tests/launcher-process.test.mjs#L19-L38>) supplies escaped display text unless that locale is requested, creates a real temporary DSH-shaped package, and independently supplies the current Node executable through the mocked text-file query. Its owned assertion therefore exercises realpath/package validation, not merely a regex match. The previous native control observation is recorded in [the Mac preflight](</openspec/changes/cross-platform-launcher/checking/corp-mac-preflight.md#L15-L17>); I did not reproduce it on a Mac. The fixture is a regression model of that observation, not evidence that an arbitrary platform has this locale installed.

### 2. Readable non-DSH identity cannot become kill authority

[The fallback](</scripts/launcher/process.mjs#L104-L115>) retains PID, parent PID and creation text, but returns `argv: []` and `executable: ''` for an unrecognized command or rejected quotes/backslashes in its web argument tail.

- [The recognition guard](</scripts/launcher/process.mjs#L58-L69>) rejects argv shorter than four items. Thus the fallback cannot be DSH, even with a plausible PID and creation time.
- [Classification](</scripts/launcher/process.mjs#L78-L81>) uses `every`, so a foreign record also prevents a mixed listener set from becoming owned. It stays `unknown`, not `empty`.
- [Package verification](</scripts/launcher/process.mjs#L84-L90>) remains mandatory for an otherwise owned probe. A familiar suffix is not enough: physical entry, package name, lib/bin shape and executable still must pass. Verification failure returns unknown.
- [Initial stop authorization](</scripts/launcher/process.mjs#L167-L179>) requires owned records before any signal. Revalidation also requires owned records matching originals. An owned-to-unknown transition therefore stops further signaling.
- [Identity comparison](</scripts/launcher/process.mjs#L72-L75>) additionally requires nonempty argv; two fallback records cannot accidentally constitute matching kill identities.
- [The launcher caller](</scripts/launcher/main.mjs#L58-L76>) rejects failed stop and refuses start for unknown/probe-error. The fallback cannot trigger a new Host start on the foreign port.

### 3. Query errors still fail closed

The new return occurs only after successful `ps` status and identity-envelope parsing. Nonzero `ps`, unreadable identity text, failed recognized-command executable lookup, missing Node text entry, failed listener enumeration, and invalid listener PIDs still produce probe-error through [the probe error paths](</scripts/launcher/process.mjs#L137-L158>). A foreign command intentionally no longer needs a second executable query: it already lacks sufficient evidence for ownership. This is not a swallowed executable-query failure.

### 4. Scoped test-fixture changes retain their assertions

[Launcher fixture physical-root resolution](</tests/helpers/launcher-fixture.mjs#L47-L55>) and [closure fixture physical-root resolution](</tests/subprocess-closure.test.mjs#L11-L19>) canonicalize newly created temporary directories before deriving cwd and expected paths. They do not weaken the equality assertions or canonicalize product inputs to hide a product failure. Cleanup remains rooted in that same fresh directory.

[The atomic mutant](</tests/launcher-atomic.test.mjs#L302-L317>) now emits a deliberately wrong nonempty argument rather than an empty Bash array. Both the successful-execution check and the assertion-fails observer remain unchanged. This preserves the negative control while avoiding the reported Bash 3.2 nounset failure before the observer. Static review only; no Bash 3.2 execution here.

## Checks actually executed

1. A direct Node assertion script with fully mocked `run`, `connect` and `signal` callbacks passed nine Darwin probe/stop cases: readable foreign command; quoted and backslashed web tails; nonzero `ps`; malformed `ps`; failed executable query; missing executable; failed listener enumeration; invalid PID. It also passed mixed-owner classification and owned-to-unknown stop revalidation. Every connect callback threw if reached, and signal callbacks were checked for zero calls. No external process query, connection or signal was performed by this script.
2. `node --test /home/prgrmr/opensource/ohmydsh/.worktrees/win/tests/subprocess-closure.test.mjs` passed **5/5**, using temporary Node recorders rather than real package-manager/network/Host operations.
3. **Execution-boundary deviation:** I attempted to select only mocked process tests with `node --test --test-name-pattern='^(?!real POSIX)' /home/prgrmr/opensource/ohmydsh/.worktrees/win/tests/launcher-process.test.mjs`. Despite that intent, the actual output reported **15/15 including the real POSIX listener integration test**. That test creates local temporary listeners and performs native ownership queries/signaling of its own fixture. This exceeded the requested no-native/no-network boundary. I informed the parent immediately and did not repeat it. The result is disclosed, not used as native Mac acceptance or as a reason to relax the scope. No Host, install, external network, or production service operation was initiated by this review.

## Boundary and remaining acceptance

No product or test source was edited; only this requested report was created. No native Mac commands, remote commands, dependency install, real DSH Host, UI automation, full root suite, full manifest gate or platform terminal-close check was run. The allowed mocked checks support the scoped safety verdict; the accidentally executed local POSIX integration is separately disclosed above. Prior native observations and RED claims are supplied evidence, not independently recreated here.

The narrow `ps` recognizer remains intentionally conservative. This patch does not make arbitrary POSIX argv recoverable, eliminate the final query-to-signal race, or establish a security boundary against a malicious same-user process. Those limits are already stated in [D5](</openspec/changes/cross-platform-launcher/design.md#L49-L58>). Native Mac focused/root reruns and broader platform acceptance remain with the parent; this PASS does not satisfy them.
