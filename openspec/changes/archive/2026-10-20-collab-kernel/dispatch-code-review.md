# Dispatch/runtime independent review

REVIEW: FAIL

Snapshot review performed 2026-10-17 while implementation continued. This is **not an immutable final merge gate**. Only this report was written; no product code or owner tests were changed.

## Findings

### F1 — High: pending open/create can restore admission after lifecycle close

**Evidence:** [service:32–48][lifecycle] publishes state, `opened`, generation and in-flight maps after awaited store calls without checking whether `close` invalidated that open. `close` only waits the command queue, not pending `open`. [service:170–187][create] runs creation in that queue, awaits provider claim, then may call `open` after `close` already deleted the admission flags. Closing waits creation but does not clear flags again after it drains.

**Observed reproductions, executed against current source with the actual MemStore:**

1. Create a space and lifecycle-close it. Wrap store `read` to capture records, signal entry, then wait on a deferred promise. Start `service.open`, await the entry signal, await `service.close`, release `read`, await opening. `overview` then succeeds despite the completed lifecycle close.
2. On a fresh service, defer the creator's provider `claim`. Start `createSpace`, wait for claim entry, start `close`, release claim, await both creation and close. Creation commits seq 1 and `overview` succeeds after close, although the store has been closed.

In both cases the service's admission state no longer matches the storage lifecycle. The second also admits a command that reaches persistence only after close began. Subsequent ordinary writes reach a closed store rather than being fenced at admission. The [spec:430–449][storage-spec] requires a common failed/close boundary and close to stop admission before draining; [design:98][close-design] repeats that contract.

**Smallest fix:** introduce a per-space lifecycle epoch/admission state established synchronously before asynchronous open/create work. Close invalidates it immediately, tracks/drains pending storage-open/replay work, and never allows an older operation to publish new `opened`/generation state. Create must participate in the same boundary rather than implicitly reopening after an invalidation. Keep provider delivery promises outside the close-drained storage queue. Add deterministic deferred-read and deferred-claim regressions; assert no successful reads/writes after close until a subsequent explicit open. Do not add a provider timeout or redelivery policy.

### F2 — Medium: create receipt replay bypasses failed-space rejection

**Evidence:** [service:170–187][create] consults cached receipts before any failed/opened check. Unlike ordinary commands, it does not call guarded `state` or capture/check a generation. This is not the intentional business-closed historical-receipt exception: failed storage and lifecycle close are distinct from `closeSpace`.

**Observed reproduction, executed against current source:** create a fresh space; replace store `commit` with an injected throw; call `setStatus` and observe `COLLAB_STORE_FAILED`; repeat the original `createSpace` context and input. It returns the original `{seq:1,spaceId:'s'}` successfully. Repeating it after lifecycle close also returns the cached receipt without reopening. The failed-space result directly violates [spec:449][storage-spec]: subsequent commands must reject with `COLLAB_STORE_FAILED` until close → open recovery.

**Smallest fix:** guard create's failed/closing/already-closed lifecycle admission before cached receipt lookup, while preserving initial creation on a fresh ID and legitimate create replay on an explicitly opened, healthy space. Do not apply business `status === closed` ahead of historical receipts. Add one failed-create-replay test and one lifecycle-close-create-replay test; test recovery after explicit close → open too.

## What passed inspection and focused execution

- [Pure scheduling][dispatch-decision] clones business input, deduplicates recipients, builds content-free whitelist pointers, and performs no provider I/O. [Wake selection][wake-selection] implements needs-reply, revision acknowledgers, newly agreed author, request-progress author, invitee, new leader and decision-affected recipients; excludes actor/inactive members with the invitation exception; escalations suppress agent wakes.
- Decision reset events are emitted before capability/reachability filtering; wake breaker counting does not apply to confirm intentions. Missing confirm capability yields awaitingChannel.
- [Dispatch execution][dispatch-runtime] starts after persistence, does not await provider delivery inside the serial queue, writes completion with the shared seq and no receipt, fences late callbacks by generation/failed/opened status, and suppresses completion after business close. Replay does not resend unknown intentions.
- [Confirmation validation][confirmation] binds decision evidence to request, revision, actor, provider, successful confirm delivery and nonempty messageRef; provider/action replay uses receipt-only commits.
- Previously reported `log.at(-1)` race assertions were fixed concurrently to select command result seq. They are **not open findings**. The [test ledger][ledger] was also refreshed concurrently: dispatch08/10 now point to persistence tests and binding rows to presence tests. Earlier stale-ledger observations are superseded.

Executed exactly this directed selection, not the full suite:

```sh
npm --prefix packages/collab-kernel test -- \
  test/wake.test.ts test/wake-table.test.ts test/dispatch.test.ts \
  test/presence.test.ts test/breaker.test.ts test/dispatch-persistence.test.ts \
  test/space-lifecycle.test.ts test/decisions.test.ts test/command-snapshot.test.ts
```

Result: **9 files, 42 tests passed; runner reported “Type Errors no errors.”** This is not a claim that standalone package typecheck/build or repository validation ran. Additional read-only Node execution used `registerHooks` and TypeScript transpilation in memory to import current source; no temporary test/source file was created. Output:

```text
Injected command failure: COLLAB_STORE_FAILED
Create receipt on failed space: {"seq":1,"spaceId":"s"} original: {"seq":1,"spaceId":"s"}
Create receipt after lifecycle close: {"seq":1,"spaceId":"s"}
Read after close raced pending open: s
Read after close raced pending create: s commits: 1
```

## Scope and limits

Reviewed runtime service/domain/auth/model/SPI and relevant spec/design/dispatch test-plan sections; read focused dispatch, breaker, presence, confirmation, lifecycle, snapshot, wake-table and idempotency tests. The focused run includes real-disk completion/recovery cases but **does not replace the separate deep storage review**. No full-suite, repository governance, strict OpenSpec, package-build, projection-security, real-provider or host-integration gate was run. Existing lifecycle tests cover late delivery after reopen and replay-failure cleanup, not the deferred-open/create admission races above. Pure wake-table tests cover the table branches and reset-before-filter behavior, but are not exhaustive adversarial scheduling proof. Further owner edits require re-review of the affected lines and regressions.

[lifecycle]: <../../../packages/collab-kernel/src/service/index.ts#L32-L48>
[create]: <../../../packages/collab-kernel/src/service/index.ts#L170-L187>
[storage-spec]: <specs/collab-kernel/spec.md#L430-L449>
[close-design]: <design.md#L98>
[dispatch-decision]: <../../../packages/collab-kernel/src/domain/decide.ts#L7-L33>
[wake-selection]: <../../../packages/collab-kernel/src/domain/wake.ts#L4-L27>
[dispatch-runtime]: <../../../packages/collab-kernel/src/service/index.ts#L94-L125>
[confirmation]: <../../../packages/collab-kernel/src/service/index.ts#L267-L284>
[ledger]: <test-plan.md#L87-L110>
