# Acceptance summary

## Scope

This change repairs Phase-1 measurement reachability only. It does not display Jev recommendations, create changes, switch schemas, invoke spec-superflow, or authorize implementation and lifecycle side effects.

## Verified behavior

- New records use schema v2 with bounded `sampleProvenance` and explicit measured/unavailable complete-sequence latency.
- Schema-v1 records remain readable. Missing facts stay `unknown`/`unavailable`; label or retention rewrites serialize the conservative projection as v2 without inspecting historical prompts.
- `synthetic-fixture` and `unknown` records never contribute to real-vibe Phase 2 dataset, confusion, cost, failure, or latency thresholds.
- Reports contain no language field, inference, breakdown, or quota.
- Every admission dimension has a machine-readable pass/fail/unavailable gate; external cost, separate privacy/integration evidence, and explicit approval remain unavailable until supplied, so admission stays `not-established`.
- Privacy allowlisting, bounded retention, concurrent writes, corruption tolerance, disabled mode, retrospective labels, aggregate-only output and accepted weighted-cost precedence remain covered.

## Verification

- Focused recorder/router/report fixtures: 33 passed, 0 failed.
- Full repository suite: 203 total, 201 passed, 2 expected skips, 0 failed.
- Artifact policy: passed.
- Strict OpenSpec validation: passed.
- `git diff --check`: passed.
- Deployment sync: first run applied the updated skill; second run reported no changes.

## Rollback

Revert this change and run `node scripts/sync.mjs`. Do not delete local records automatically. The previous reader ignores schema-v2 records, so a rollback that must resume collection on the old schema requires explicit `node recorder.mjs clear` after the user accepts losing shadow history. Standard OpenSpec and ordinary conversation remain available throughout.
