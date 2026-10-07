# Round 6 Review Re-check

VERDICT: APPROVE
CHANGES_APPLIED: n/a

Why this verdict: the two round 6 blockers were both corrected on disk, and this re-check is no longer requesting any changes.

## Scope

This is a final targeted re-check of the two items that kept round 6 at `APPROVE_WITH_CHANGES`:

1. M2(a): proposal impact text for accept-success navigation.
2. Cleanup: test-plan scenario count and stale row-number prose.

No other issues were re-litigated.

## Findings

None.

## Re-check Results

### M2(a) Navigation Target and Reachability

Accepted by reviewer.

`proposal.md:36` now states that accept-success navigation uses the receipt's `executionTarget`, not a front-end-derived target. It also explicitly rejects `sessionJumpBlock` for this path, with the right reason: that helper only translates availability from the locus snapshot, while `useTodoLedger.dispatch` refreshes only the todo ledger (`settings.tsx:717-722`, `settings.tsx:2333-2336`).

The same paragraph now preserves the D11/D9 split: reachability is Host-side, `unreachable` means no dispatch, missing `sessionOpener`/`closeSettings` must not invalidate a successful accept, and the dispatch receipt must survive panel closing so `dispatched` and `queued` remain distinguishable.

This is consistent with:

- `design.md:319-330`: `executionTarget` is carried on the one-shot dispatch receipt, not persisted to the todo row.
- `design.md:406-414`: D11 consumes that receipt directly and does not ask the front end to re-derive reachability.
- `specs/pet-locus-intent-triage/spec.md:95`: successful dispatch returns the resolved execution target as an operation result.
- `specs/pet-locus-intent-triage/spec.md:199-203`: navigation target comes from the accept result, missing navigation capability does not fail accept, and navigation must not erase outcome distinction.

### Cleanup

Accepted by reviewer.

`test-plan.md:3` now says all 41 scenarios are mapped to named tests. The table contains 41 scenario rows. The previous stale "36 scenarios" wording is gone, and the old row-number-style cleanup prose has been replaced with descriptive language, notably the existing-test note at `test-plan.md:60`.

## Rebuttals

- M1: accepted by reviewer. D11 now requires the outcome receipt to survive navigation, and the spec/test plan have a dedicated queued-outcome path.
- M2(a): accepted by reviewer. The proposal now directs the front end to use receipt `executionTarget`, rejects `sessionJumpBlock` for this path, and leaves reachability to Host.
- M2(b): accepted by reviewer. The remaining navigation edge cases are covered: missing GUI seams do not fail accept, failed/unreachable accepts do not navigate, and child-tool request execution does not navigate.
- S1: accepted by reviewer. D9 keeps `executionTarget` in the one-shot dispatch receipt and out of the persisted todo row, matching the "do not infer from row state" rule.
- S2: accepted by reviewer. The "request execution does not navigate" assertion is now correctly framed as a Host/tool-path assertion rather than a GUI interaction test.

## Residual Risk

None from the two targeted round 6 blockers. Implementation still needs to execute the listed tests, but the change proposal, design, spec delta, tasks, and test plan are now internally consistent for these items.
