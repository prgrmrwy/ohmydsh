# Implementation review repairs

Independent cross-model source report: `implementation-review.md`. Findings are verified against actual code, not accepted as blanket approval.

## C1 / runner deadlines and orphaned descendants

Confirmed default 180s timer applied to interactive official CLI, sync and confirmation. Removed implicit timer entirely: only finite positive explicit timeout is bounded; Infinity does not create Node's 1ms overflow timer. Explicit bounded executions get a new POSIX group and whole-group KILL or verified still-live Windows child tree taskkill. New runner regression first RED (status1 instead of124), then GREEN (124 + descendant nonexecuting); separate no-timer/Infinity test observes no setTimeout call. The single descendant from the initial RED was identified by exact known argv and reclaimed; test cleanup now records PID before asserting status.

## C2 / macOS process identity; M1 Node executable aliases

Confirmed ps parser rejected bare `node`. ps now forces LC_ALL/LANG=C and obtains executable independently from PID-scoped lsof txt. Exact current Node realpath is additionally accepted for nonstandard node binary names, without trusting arbitrary PATH names. New darwin-injected fixture uses a real temporary verified package, bare-node ps argv, and asserts locale/executable proof. This is unit evidence only; real macOS remains pending.

## M2 failed-readiness cleanup

Confirmed TERM-only cleanup could hang. POSIX now signals only the group from this exact new ChildProcess, waits500ms, escalates while leader live, waits bounded, then unrefs. Regression starts a synthetic entry with a non-DSH filename and ignored TERM, verifies launcher returns before test kill deadline and listener becomes empty. No port-inferred unknown PID is signaled.

## M3 xdg-open handoff

Production Linux opener now detached spawn/unref after successful spawn, no3s browser-lifetime kill. Missing executable still reports manual URL. Injected pure opener tests retain bounded call seam; no real user browser opened during testing.

## M4 startup observability

Restored plugin-list --names to startup record (`plugins=[…]`), Host runtime line and two-space-dash plugin display. Real lifecycle assertions check all three outputs.

## M5 concurrent launch

Added real concurrent two-launch fixture. Initial repair still RED: loser could exit before ownership polling. Failure path now probes even after early child exit and only returns success if another fully verified owned listener wins. Never treats reachable HTTP as proof. Final test run recorded separately.

## Additional self-review

Post-sync auto-update worktree status guard rejects unrelated drift before git add/commit. New drift test first RED then GREEN; shared command trace explicitly includes new safety query. Dual UI event writes reduced by letting UI module own suppression/open events. No planning specification changed.

## Remaining limits

Real macOS identity and PWA/tab surface, Windows console-close, full public manifest build×2/dump/Host remain unaccepted. Linux full gate currently stops at pnpm11.7 script-approval policy; no script approvals or allow-all policy were added. These are not waived by unit tests.
