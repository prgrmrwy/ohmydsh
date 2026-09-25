# Phase 2 advisory-mode admission gate

Phase 1 remains shadow-only until every mandatory condition below passes and the user explicitly approves a separate OpenSpec change. This report never enables advisory UI or automatic routing by itself.

## Eligible dataset

Only reliably labelled records whose `sampleProvenance` is `real-vibe` contribute to Phase 2 dataset, confusion, cost, failure, or latency thresholds. `synthetic-fixture` records validate implementation only; `unknown` records remain visible in provenance totals but are ineligible. Full prompts, language classification, conversation text, source/diffs, paths, URLs, attachments and raw provider errors are neither evaluation inputs nor retained evidence.

Required real-vibe coverage:

- at least 100 reliably labelled observations from at least 10 distinct working days;
- at least 15 labelled examples for each actual route proposed for Phase 2 (`direct`, `standard-openspec`, `anvil`, `spec-superflow`);
- at least 10 examples in each high-cost category: security, migration/persistence, concurrency, existing change, and explicit user selection;
- no guessed labels; unknown remains unknown;
- frozen router/catalog versions per report, or separate metrics by version.

There is no request-language field, breakdown, or Chinese/English quota.

## Quality and timing

The accepted weighted-cost table and deterministic precedence remain unchanged from the archived Phase 1 gate. Mandatory real-vibe thresholds remain:

- zero cost-10 misses;
- weighted cost per reliably labelled observation <= 0.75;
- needs-review rate <= 35%;
- provider/MCP failure rate <= 5%;
- p50 complete shadow-sequence latency <= 1.5 s and p95 <= 5 s;
- estimated mean external decision cost is reported and accepted by the user.

Latency is measured locally with a monotonic clock around the complete classify-plus-conditional-decide sequence, including provider/tool transport and terminal failure. Missing measurement is explicit `unavailable`, never zero, and prevents admission.

## Machine-readable gate rule

Every dataset, route/category coverage, quality, latency, external-cost, privacy/integration evidence, and explicit-approval gate reports `pass`, `fail`, or `unavailable`. Any `fail` or `unavailable` keeps `phase2Admission` at `not-established`. Passing measured gates only makes a separate advisory proposal eligible for user review; it does not authorize Phase 2.

## Privacy, integration, and approval

The archived Phase 1 privacy, tool-surface, fallback, upstream pin, rollback, disable, and idempotence evidence remains required and must be rechecked for the candidate report. After every gate passes, produce a redacted report and ask the user to approve or reject a new Phase 2 OpenSpec change. Phase 3 automation is not implied by Phase 2 approval.
