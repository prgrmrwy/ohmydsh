## 1. Credential and identity lifecycle

- [x] 1.1 Read existing dsh-magpie mainline spec, integration pitfalls and full affected callers; record exact scope and baseline, verifying no overlap with active mainline writers.
- [x] 1.2 Add optional official Access credential references and complete captured identity; verify partial-pair/HTTPS/rotation/prepared-operation tests and LAN regression tests.
- [x] 1.3 Extend all active/prepared secret redaction and credential invalidation; verify reflected JSON/text errors and settings responses contain no raw values.

## 2. Transport and settings

- [x] 2.1 Attach Access headers on all five existing endpoints while preserving bearer, endpoint/query restrictions and redirects; verify real HTTP/SSE mocks and absence of headers for LAN configuration.
- [x] 2.2 Implement settings updates/status with whole-input validation and writable preflight; explicitly test credential-write failure behavior and unchanged connection on validation rejection.
- [x] 2.3 Add optional password-style Access inputs, configured status and explicit clear behavior; verify settings UI tests never receive stored raw values.

## 3. Verification and delivery

- [x] 3.1 Run package tests/typecheck/build and strict change validation; report exact failures/baseline and verify primary routing/effort remain unchanged.
- [ ] 3.2 Conduct scoped review with mainline owner, verify public real-plugin catalog/cards/SSE/Responses tool round trip without changing the existing production connection; retain credential-free evidence.
- [x] 3.3 Deliver private credential setup instructions, rollback and company-side acceptance steps; update tasks with actual evidence, not standalone infrastructure probe claims.
