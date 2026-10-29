# Acceptance follow-up source review — 2026-10-29

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
