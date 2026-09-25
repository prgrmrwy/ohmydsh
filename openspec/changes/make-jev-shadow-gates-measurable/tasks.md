## 1. Versioned record contract

- [ ] 1.1 Add failing tests for schema-v2 bounded `sampleProvenance` and explicit measured/unavailable latency normalization, including rejection/defaulting of arbitrary strings and non-finite values
- [ ] 1.2 Implement schema-v2 writes and v1/v2 compatible reads without inspecting historical prompts or inventing missing metadata
- [ ] 1.3 Verify mixed-version label, retention, corruption tolerance, `0600` atomic writes, disable, summary, and clear behavior remains correct

## 2. Measurable Phase 2 report

- [ ] 2.1 Add failing report tests that separate `real-vibe`, `synthetic-fixture`, and unknown provenance and prove no language field, inference, breakdown, or quota remains
- [ ] 2.2 Add failing tests for measured latency coverage/percentiles and for legacy or missing latency remaining unavailable rather than zero
- [ ] 2.3 Implement overall and real-vibe-only aggregates plus provenance, route, high-cost category, router-version, and candidate-availability breakdowns
- [ ] 2.4 Emit a machine-readable status for every pre-registered dataset, quality, latency, cost-availability, privacy/integration-evidence, and explicit-approval gate; derive overall admission conservatively so any fail/unavailable remains `not-established`
- [ ] 2.5 Preserve the accepted cost precedence and verify synthetic fixtures never contribute to real-vibe Phase 2 thresholds

## 3. Shadow call instrumentation and privacy

- [ ] 3.1 Update the router skill to define bounded local-only provenance, prohibit sending it or raw request text to Jev, and explicitly prohibit language collection or inference
- [ ] 3.2 Document monotonic timing around the complete classify-plus-conditional-decide sequence and record explicit unavailable timing only when local measurement genuinely cannot be obtained
- [ ] 3.3 Extend privacy allowlist tests to prove arbitrary provenance strings, language fields, prompts, paths, URLs, identifiers, attachments, provider errors, and credentials cannot persist or appear in aggregate output
- [ ] 3.4 Update the Phase 2 gate/runbook to distinguish real-vibe eligibility from synthetic validation and state the exact latency measurement method

## 4. Migration and acceptance

- [ ] 4.1 Exercise a temporary state directory containing legacy v1, new v2, and corrupt records; verify legacy unknowns remain unknown and no historical file is destructively backfilled
- [ ] 4.2 Run focused router/readiness/resource tests, the full repository suite, artifact policy, strict OpenSpec validation, and `git diff --check`
- [ ] 4.3 Run sync twice to prove deployment convergence, then verify the live report still remains shadow-only and `not-established` until all measured gates and explicit approval pass
- [ ] 4.4 Record a privacy-safe acceptance summary and rollback procedure; do not create a Phase 2 advisory change or enable user-visible recommendations in this change
