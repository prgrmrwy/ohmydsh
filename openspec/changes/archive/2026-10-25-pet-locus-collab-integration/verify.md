## Verification Results

### Task Completion
- [x] All tasks marked `[x]` in tasks.md, except 10.4 (this artifact and the closing steps it lists), which is completed by writing this file and the standard update below.
- Remaining open tasks: none after this commit. Archiving is a separate step and needs the user's go-ahead.

### TDD Integrity
- [x] Every test-plan.md entry exists as a real test: 106 rows, none `N/A — non-executable`. 38 rows carry existing tests forward; 68 are new.
- [x] Every test-plan.md row is 🟢 green. The ledger contains no 🔴 row.
- [x] Full suite passes in all three packages and at the repository root (see Evidence).
- [x] No new skipped, pending or commented-out tests. A grep for `.skip(` / `.only(` / `.todo(` / `it.fails` in the three packages' tests returns nothing. The only conditional skips are three pre-existing `describe.skipIf` real-runtime probes in dsh-pet (8 tests), identical to the 0.1 baseline. The one `it.todo` added in group 6 was turned into a real test in group 7.
- [x] No test was weakened or deleted without a requirement change. Every assertion change has a recorded basis in implementation-log.md:
  - collab-kernel: the two authorization-coverage guards in `auth.test.ts` each gained one row for `disposeManagedRequest`, with unchanged assertions.
  - dsh-collab: `handle-05` now expects the ten handle methods that the modified requirement lists.
  - dsh-pet: `pet_locus_ledger_read` was retired by design D6 and by the delta scenario "兄弟子会话读不到彼此登记的结论". Its guidance text changed to `collab_read` in five assertions. Three execution tests and `ledger-read.test.ts` were deleted together with the tool and module. `executor-scope` changed its count from 9 to 8 and now asserts exactly which tool was removed. Two legacy-medium contract tests ("refuses writes without an atomic Domain" and the non-atomic decoupling e2e) moved to legacy-only describes with their assertions unchanged; their collab counterparts are covered by availability-01.

**Deviations from red-first ordering (recorded, with compensating evidence):**
- Group 4 (dsh-collab stamp, projection, authorization): stamp-01..19 were written at once and shared one red cause (the stamped resolution was not recognized). This was compensated afterwards by three mutation runs. Disabling write authorization turned 7 tests red, disabling projection turned 8 red, and disabling the cmdId namespace turned 3 red. Each was restored and verified byte-identical with `cmp`. The details are in implementation-log.md.
- Group 6 (Pet proxy): the integration tests were written after the proxy. They are backed by 15 pure-function tests, and three real red causes surfaced and were resolved: AMD-3, and two assertions aligned with D8.
- Groups 7 and 9: four tests were green on first run because their behavior had already landed in an earlier group (toolface-04, the "dsh-collab missing ⇒ no collab tools" case, availability-01 and availability-03). scope-06 (track part), availability-01 (track part) and the owner-ledger wiring guard were validated by post-hoc mutation; each turned red as expected and was restored.
- Group 8: before the equivalence tests were trusted, a one-space evidence difference was injected into the collab backend. The first injection exposed that equivalence-04 did not compare evidence. It was fixed, and the second injection turned all four red on the evidence fields only.

### Evidence

| Command | Result | 0.1 baseline |
|---|---|---|
| `npm run typecheck && npm run build && npx vitest run` in `packages/collab-kernel` | exit 0; 46 files, 281 passed, 0 skipped | 44 / 272 / 0 |
| same in `packages/dsh-collab` (+ `npm test` node:test, `test:components`) | exit 0; vitest 11 files, 179 passed, 0 skipped; node:test 2/2; components 19 + 4 passed; tool schema 3927 / 4200 | 9 / 152 / 0 |
| same in `packages/dsh-pet` | exit 0; 210 files passed, 3 skipped; 3482 passed, 8 skipped (pre-existing runtime probes) | 202 files; 3430 / 8 |
| `npm test` (repository root) | 447 tests, 445 pass, 0 fail, 2 skipped (pre-existing MCP bridge probes) | same skips |
| `npm run check:artifacts` | tracked paths comply | — |
| `openspec validate pet-locus-collab-integration --strict` | valid | — |
| `git diff --check` | clean | — |
| `node scripts/sync.mjs` twice (main checkout, private overlay loaded) | 1st: 6 changes, dsh-collab and dsh-pet reinstalled; 2nd: `no changes` | — |

All package results were re-run by the lead independently of the teammates' reports.

**Live Host acceptance (task 10.3).** The real Web Host was restarted by the user. The trigger messages were sent by the user in the Feishu group 「迁移 Pet Locus 共享台账至协作层」. Full record in implementation-log.md §10.3:
- Space established on main-session load. Its members are exactly `main` and `pet`. The other nine main sessions were not woken.
- All 9 legacy todos are listed as `legacy`. accept, done and drop on a legacy todo through the real owner route each return 400, and the `ledger_item` table is unchanged row for row.
- A child registered a todo through `pet_locus_track`. The commit contains only `item/created`, with author `pet`, assignee `main`, the endpoint-derived stamp, a JSON body and a namespaced cmdId, and no wake.
- The child's real request header contains exactly the 8 `collab_*` tools, with no space/invite/member tools and no `pet_locus_ledger_read`.
- Owner accept dispatched the follow-up as a next-turn item, and progress became `accepted` by `manager:pet-locus`. A second accept was refused before dispatch.
- The main session advanced the todo to `done` itself. The terminal wake went to `pet` and Pet routed it to `locus-0c3af9d398667401` via ref. The child opened no turn and sent nothing to Feishu.
- Owner drop wrote only `rejected` and woke nobody. Turn and inbox counts for the child and the main session were unchanged.
- With dsh-collab disabled, the child's tool surface had no `collab_*`. Registration returned "协作层当前不可用" and wrote nothing, the reply still went out, and the owner panel showed `collab=unavailable` with the legacy todos still listed.
- After dsh-collab was re-enabled, the same space was recognized, registration succeeded with the same stamp, and the member set was unchanged.
- **Observation (design D8):** the main session's `collab_status` lists open todos and suggests `advance_request`. During acceptance the main session did not self-accept any open todo. The sample is small.

### Review Integrity
- [x] review.md has `VERDICT: APPROVE_WITH_CHANGES` (round 4) with `CHANGES_APPLIED: yes`, re-checked by the reviewer.
- [x] The verdict is not stale. After it was issued, design and specs changed only through three apply-time amendments (AMD-1 visible lookup, AMD-2 endpoint-derived stamp identity, AMD-3 constructible GIVEN for routing-01). Each was recorded in review.md and re-checked and accepted by the cross-model reviewer before the dependent code was committed. AMD-2's first version was rejected and then revised. The 1-line wording change in the dsh-collab note in `dsh.yaml` is not a reviewed artifact.
- [x] All findings from rounds 1–4 were fixed or rebutted, and every Critical and Moderate item is marked accepted by the reviewer.

### Change Delivery
- Commits on `main` (rebased onto concurrent unrelated work, so this is a list rather than a range): `d5074b2e5` (first plan), `1561d9518` (rewritten plan, round 4), `25339e0ec`, `a9533f227`, `7b2eb9f5b`, `26e7714d7`, `643be2fb2`, `09d482f15`, `803bcddae`, `d35ef4bc0`, `6bbb77701`, `505d01a9a`, `4aa9fa254`, `d7be3a7cc`, `ced93d049`, `3081dc86e`, `7ca04ffc8`, `b52623af3`, `22b5d32cd`, `4bcd19200`, plus the commit that adds this file. Not pushed.
- Private overlay (`inner-ohmydsh`): first added `managedChannels` there, then (user decision) removed the whole `dsh-collab-local` entry including the historical Pet main-session deny list, which conflicted with the new model. dsh-collab config now lives in the public patch `dsh-collab-config`. Not pushed.
- Deployed to `~/.dsh` and running on the user's Host.

### Known limitations (accepted by design, not defects)
- Pet's inbound registrations, including unroutable messages, are kept in memory only and are cleared on Host restart (D4: not persisted in this change).
- Locus spaces exist only for main sessions that have been loaded since deployment (D2: no session is woken to create a space). Main sessions that were on the removed deny list get their space on their next load after the user restarts the Host.
- Sibling isolation prevents accidental leaks, not collusion (user decision after review round 3).
- Inquiry migration, cross-machine spaces, and removal of sibling-direct inquiry in `pet-locus-independent-agent-inquiries` are out of scope and recorded as follow-ups.

## Overall Decision

DECISION: PASS_WITH_WARNINGS

⚠️ Pass with warnings. Every gate is met. The warnings are the recorded red-first ordering deviations in groups 4, 6, 7 and 9, each with compensating mutation evidence, and the small sample size for the D8 "main self-accepts" observation.
