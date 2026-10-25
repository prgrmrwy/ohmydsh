# Tasks 2–11 implementation evidence

Execution root: `~/mydir/opensource/ohmydsh/.worktrees/openspec-explore-session-session-dsh-dsh-agent-t`.
All commands below ran there with an explicit workdir. No install, commit, deployment, planning-artifact edits, or memory writes were performed by this implementer.

## Approved contract and handoff

Read proposal, entire delta spec (707 lines), design, review (round 8 APPROVE), tasks and test-plan before implementation. `openspec status --change collab-kernel --json` and `openspec instructions apply --change collab-kernel --json` confirmed Anvil ready. Task ledger and test-plan updates belong to Lead, outside this implementer's write scope.

Before behavior implementation, created runnable `throw new Error('not implemented')` service stubs and stable interfaces, then notified Lead:

- `model/index.ts`: typed discriminated events; command commit includes receipt and may have empty events; completion commit has exactly one dispatch/completed event and no receipt.
- `store/interface.ts`: open, close, breakLock, commit, read, list; no FileStore implementation by this implementer.
- `spi/index.ts`: claim(address, kind), deliver, presence.
- `service/index.ts`: every write takes CommandContext `{principal, spaceId, cmdId}` and typed input; reads take ReadContext `{principal, spaceId}`. Exact lifecycle exceptions for API coverage: open/close only. No execute, setDeciders, recordDispatch or event-write service method.
- Convention/project integration is injected with ServiceOptions.convention/project; Lead owns later defaults and pure project export.

## Actual red → green commands

Every RED below was an exit 1 from real behavioral assertions or callable stubs, not import/syntax errors. Each GREEN regression command includes all earlier implemented suites. Structural absence checks that were already guaranteed by the stable API signatures passed initially; they are not represented as failed behavior.

| Group | RED command (prefix `npm test --workspace packages/collab-kernel -- `) | Observed RED | GREEN regression command suffix | Observed GREEN |
|---|---|---|---|---|
| 2 auth | `test/auth.test.ts` | 13 failed, 1 passed: callable open/create stubs and absent authorization map; no type errors | `test/auth.test.ts` | 14 passed |
| 3 members | `test/members.test.ts` | 7 failed: invite/join stubs and agent creator incorrectly allowed human kind | `test/auth.test.ts test/members.test.ts test/boundary.test.ts` | 26 passed |
| 4 lifecycle | `test/lifecycle.test.ts` | 5 failed, 1 passed: transfer/leave/close stubs; creation already required by auth | `test/auth.test.ts test/members.test.ts test/lifecycle.test.ts test/boundary.test.ts` | 32 passed |
| 5 items | `test/items.test.ts` | 8 failed: item mutation stubs and missing state table | `test/auth.test.ts test/members.test.ts test/lifecycle.test.ts test/items.test.ts test/boundary.test.ts` | 40 passed |
| 6 messages | `test/messages.test.ts` | 4 failed, 1 passed: illegal recipients, byte bounds, needsReply types, status limits accepted | `test/auth.test.ts test/members.test.ts test/lifecycle.test.ts test/items.test.ts test/messages.test.ts test/boundary.test.ts` | 45 passed |
| 7 requests | `test/requests.test.ts` | 3 failed: advanceRequest stub | `test/auth.test.ts test/members.test.ts test/lifecycle.test.ts test/items.test.ts test/messages.test.ts test/requests.test.ts test/boundary.test.ts` | 48 passed |
| 8 escalation | `test/escalation.test.ts` | 2 failed, 1 passed: agent count not incremented/escalated and agreed count not reset | `test/auth.test.ts test/members.test.ts test/lifecycle.test.ts test/items.test.ts test/messages.test.ts test/requests.test.ts test/escalation.test.ts test/boundary.test.ts` | 51 passed |
| 9 decisions | `test/decisions.test.ts` | 11 failed, 1 passed: request/confirm stubs; inactive identity rejection already implemented | `test/auth.test.ts test/members.test.ts test/lifecycle.test.ts test/items.test.ts test/messages.test.ts test/requests.test.ts test/escalation.test.ts test/decisions.test.ts test/boundary.test.ts` | 63 passed |
| 10 idempotency | `test/idempotency.test.ts` | 1 failed, 8 passed: empty creation cmdId accepted; seven required historical/scoped receipt scenarios already needed by task2 pipeline | `test/auth.test.ts test/members.test.ts test/lifecycle.test.ts test/items.test.ts test/messages.test.ts test/requests.test.ts test/escalation.test.ts test/decisions.test.ts test/idempotency.test.ts test/boundary.test.ts` | 72 passed |
| 11 log | `test/log.test.ts` | 1 failed, 1 passed: illegal negative/fractional cursor accepted; replay/read foundation already needed by task2 | `test/auth.test.ts test/auth.test-d.ts test/members.test.ts test/lifecycle.test.ts test/items.test.ts test/messages.test.ts test/requests.test.ts test/escalation.test.ts test/decisions.test.ts test/idempotency.test.ts test/log.test.ts test/boundary.test.ts` | 13 test files / 76 test counts passed, including type suite; strict package typecheck exit0 |

The tasks overlap intentionally: task2 mandates durable receipts and replay ordering, so the seven named task10 scenarios cannot honestly all be first-RED in task10 without breaking task2. Their actual initial PASS is reported rather than fabricated. Likewise task11 replay/read support is needed to load task2's persisted authorization world. No behavior was disabled merely to manufacture RED.

## Refactor and extra negative coverage

- Replaced the initial unsafeWrite name-list fixture with a real TypeScript virtual source declaring `interface CoverageFixture extends CollabService { unsafeWrite(): Promise<void> }`. The same compiler-type traversal checks real service and extended fixture. No product COMMANDS list.
- Added a 17-command authorization matrix, independently invoking every named public method on an allowed and rejected principal/precondition. Its case names are checked against authorization keys.
- Read authorization checked for all four reads by Lead's input-boundaries suite. Returned overview/log values are detached snapshots.
- Lead's extra input-boundaries tests exposed inherited `constructor` collisions in names/item IDs. Fixed own-property checks, then added two additional real RED tests (`test/items.test.ts test/input-boundaries.test.ts`): `__proto__` item disappearing and inherited absent item throwing a TypeError. Fixed dictionary insertion with an own data property and own-property lookup; 15 tests passed on rerun.
- One final typed run detected two source-test type errors (Partial<Item> fixture permitted request discrimination, deliberately invalid needsReply cast lacked unknown bridge). Fixed only fixture typing, not assertions. Subsequent owned suite runtime result: 14 files / 84 counts passed.

## Validation boundary at handoff

`npm run typecheck --workspace packages/collab-kernel` passed after tasks9 and11. Early task2/task3 typecheck temporarily failed because a concurrent FileStore imported CollabStore from model rather than store/interface; notified Lead; Luna corrected it.

A full `npm test --workspace packages/collab-kernel` was run at 02:08:07: 145 passed / 20 failed. At that exact moment concurrent later work intentionally remained RED: wake/dispatch/presence/breaker (17 failures), two input-boundary failures since fixed, and store-06 expected multi-event confirmation before later breaker/reset event integration (one failure). This was not represented as all-package GREEN.

At 02:09:32 and 02:10:08 the selected owned+boundary+input suites had 84 passing runtime/type test counts, but commands exited1 due source typechecking: first the two fixture typing issues described above, then one concurrent dispatch-world missing `dispatchRequest` export. Notified Lead; the latter is outside this implementer's write scope. Final validations should be rerun after the concurrent later-task edits settle.

Final handoff run at 02:11:07: the exact selected-owned command listed above completed exit0: 14 files / 84 test counts passed, no type errors. `npm run typecheck --workspace packages/collab-kernel` then completed exit0, including both `tsc -p tsconfig.json --noEmit` and Lead's newly added `tsc -p tsconfig.test.json --noEmit`.

No wake scheduler/presence sampling was implemented early. Human-confirmation tests preload persisted intended/completed evidence in MemStore fixtures; they never call a public event-write service interface. No spec/design/review contradiction was found. FileStore/projection/convention/later dispatch changes are Lead/Luna's responsibility, not claimed as delivered by tasks2–11.
