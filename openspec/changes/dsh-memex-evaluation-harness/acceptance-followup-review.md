# Acceptance follow-up source review — 2026-10-29

## 2026-10-30 Goal closeout review

A fresh read-only reviewer checked the approved proposal/design/specs/test-plan against the implementation and runtime tests. No approved requirement mandates a new live global title-call recorder, persistent daily-session snapshot, or separate judge-disposal receipt format. Earlier gaps below are historical; treating these extra formats as blockers was an acceptance expansion, now withdrawn without changing any specification or guard.

The new real-model round f2704e21 has complete semantic criteria (report exit0, 5 pass / 1 observed behavior fail / 0 semantic unknown), twelve physically audited fresh judge requests, six hash-checked retirement observations, six continuous owned-job settlements, nineteen registered/filter-excluded identities, and user default-model confirmation. The Lead checked the private artifacts; the reviewer checked the code and recorded evidence, not the private raw logs again.

The actual owner chain awaits one-shot disposal, then parent disposal and final jobs proof before Host writes a successful durable result. Existing real-runtime tests verify parent/children leave the registry before fixture teardown, while retained roots remain archived/idle with empty inboxes. Default title provider plus local mock verifies eval title0/daily title1, exactly as the approved scenario specifies. This batch strengthens a pre-existing daily Agent/inbox/options control and adds deferred-disposer/final-settlement regression checks. No runtime behavior is changed and no new model round or deployment is needed for these test-only additions. Final command results and task closure are recorded at the top of verify.md. A second fresh read-only review found no blocking issue; it identified a microtask window in the new one-shot pending assertion. The Lead added an event-loop turn before asserting and checked an in-memory missing-await mutation: the original passes and the mutation is detected. The reviewed whole Memex suite then passed 124 files / 816 tests with typecheck; repository whole-suite passed 701 of 704 tests, zero failures, three skips.

No claim is made that the offline report automatically verifies every physical receipt, that persistent observations recreate live capabilities, that mock responses are live model calls, or that the tool selftest measures Memex effectiveness. Archive/spec-sync/push remain separate unexecuted operations.

## Historical 2026-10-30 follow-up

The user deployed and restarted the Host; the installed retirement module matches the source build hash, and its mtime precedes the current listener's start time. Earlier undeployed statements below describe the previous review time.

Added a real Connection + Memex channel + actual eval dispatcher composition regression using ephemeral in-memory credentials, official 303/cookie exchange, and captured HTTP route callbacks. Valid-cookie cross-Origin, opaque Origin, cross-site and untrusted Host requests fail before dispatch/default reads; authority changes invalidate the cookie. A same-origin control reaches the actual read-only default-model endpoint, preserves the default and creates no round directory; fiber disposal withdraws the route. No real Host cookie, server listener, session or model call is used. The actual 3080 unauthenticated rejection probe also passes. This completes tasks 3.1/3.3 as implementation regression obligations, without claiming authenticated live-Host black-box coverage.

Fresh whole-package verification: 124 files / 807 tests, typecheck, repository wiring/insights 7 tests, strict OpenSpec, artifacts and whitespace checks all pass. PASS for this test-only addition. Full change remains not ready for archive: no new real-model round with the deployed retirement observations exists, and historical results are never backfilled.

## Scope

Uncommitted follow-up to the successful GPT round: existing-Host Connection rejection test, post-retirement observations, associated regression tests and verification ledger. This is a local source review, not an Anvil planning re-approval or a whole-change archive approval.

## Findings and disposition

- No blocking defect found in this narrow follow-up. The observation is written only after `retireTestRoot` returns; any archive/jobs/drain/identity/idle/inbox failure skips it. A write error propagates and stops the round.
- Repeated retirement is permitted during same-Host resume verification. Each observation therefore gets a unique directory; an existing receipt cannot make a subsequent check pass or cause a predictable-path collision. Resume never reads these observations as authority.
- Existing frozen-input writer enforces exclusive creation and hashes the record. Actual six-condition runtime integration reads each observation through the hash-checking reader and checks exact membership of the six registered roots.
- Failure regression verifies a rejected descendant drain creates no additional successful observation. Existing 26-case managed-resume suite stays green, including missing live capabilities and modified historical evidence rejection.
- Live rejection test is opt-in and uses only `eval/status` without authentication. It checks 401/403 and absence of redirect. This does not establish authenticated cross-Origin rejection independently, nor does it prove the dispatcher side-effect count; the upstream Connection trust/auth tests provide separate supporting evidence.

## Remaining limitations

Historical successful rounds are not backfilled. These observations record trusted execution-path completion, not independent OS-process inspection or present-time Agent state. They do not serialize live capabilities, do not justify cross-Host resume, and are not yet consumed as an automatically verified offline release report. Judge-parent/one-shot disposal remains under its existing owner; this root observation does not claim a separate durable disposal receipt for those objects.

The current follow-up is not deployed and has not been exercised by a new real-model round. Existing GPT success remains valid for its original behavior but cannot supply evidence for newly added observations. No push, archive, Host restart, or model request was performed.

## Evidence

- `MEMEX_TEST_LIVE_CONNECTION=1 npm test --workspace dsh-memex`: 123 files / 806 tests passed.
- `npm run typecheck --workspace dsh-memex` and `npm run build --workspace dsh-memex`: passed.
- Fixed-upstream Connection authority/auth/HTTP-abort suites: 3 files / 24 tests passed.
- After adding the explicit six-receipt integration assertion, targeted production-runtime / host-identities / live-Connection suites: 3 files / 5 tests passed.
- Strict OpenSpec, artifact policy, and diff whitespace checks: passed.

## Verdict

PASS for the narrow implementation and tests above. NOT READY TO ARCHIVE the complete change: remaining task obligations must be evaluated independently, especially current authenticated Connection black-box coverage, complete release evidence consumption, live traffic exclusion and unrelated-session non-interference evidence.
