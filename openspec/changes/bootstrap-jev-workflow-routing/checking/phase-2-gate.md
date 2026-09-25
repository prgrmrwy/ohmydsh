# Phase 2 advisory-mode admission gate

Phase 1 remains shadow-only until **every** mandatory condition below passes and the user explicitly approves a separate OpenSpec change. Passing this document never enables advisory UI or automatic routing by itself.

## Dataset gate

Use only bounded router records plus retrospective actual-route labels. Full prompts, conversation text, source/diffs, paths, URLs, attachments and raw provider errors are not evaluation inputs or retained evidence.

A candidate report is admissible only when it contains:

- at least 100 reliably labelled observations from at least 10 distinct working days;
- at least 30 Chinese and 20 English observations;
- at least 15 labelled examples for each actual route proposed for Phase 2 (`direct`, `standard-openspec`, `anvil`, `spec-superflow`);
- at least 10 examples in each high-cost category: security, migration/persistence, concurrency, existing change, and explicit user selection;
- no guessed labels: `unknown` stays unknown and is excluded from accuracy denominators but included in coverage reporting;
- a frozen router/catalog version per report, or separate metrics by version.

If spec-superflow is ineligible inside managed Worktree Sessions, those records count toward availability/fallback coverage but not toward executable spec-superflow accuracy.

## Quality gate

The report must publish the complete confusion matrix and these pre-registered costs:

| Actual → recommended | Cost |
|---|---:|
| formal workflow → `direct` | 10 |
| `anvil` → either `direct` or `spec-superflow` | 10 |
| existing change → a different control plane | 10 |
| explicit route → a different route | 10 |
| `standard-openspec` → `direct` | 6 |
| `spec-superflow` → `direct` | 5 |
| `direct` → any formal workflow | 2 |
| between available formal workflows, all other cases | 3 |
| any recommendation correctly converted to `needs-review` rather than executed | 0 |

Mandatory thresholds:

- **zero** high-cost (cost 10) misses;
- weighted cost per reliably labelled observation <= 0.75;
- needs-review rate <= 35% overall, while never reducing review to hide a high-cost miss;
- ordinary Agent/control flow success rate = 100% when Jev is missing, unauthorized, rate-limited, returns 5xx/malformed output, times out, is cancelled, or disconnects;
- provider/MCP failure rate <= 5% in the measured environment, reported separately from model uncertainty;
- p50 shadow latency <= 1.5 s and p95 <= 5 s; because Phase 1 is non-blocking, no Jev latency may extend an authoritative user decision or existing workflow;
- estimated mean external decision cost is reported and accepted by the user; no universal cost ceiling is assumed before real usage data exists.

Metrics must be shown overall and by language, actual route, high-cost category, router version, and candidate availability. Do not publish a single aggregate score that hides a weak category.

## Privacy and security gate

All must pass:

- persistence allowlist tests cover malicious/long strings, paths, URLs, email, token-like values, attachment metadata, source/diff text and reflecting provider errors;
- repository, generated profile, sync ledger, stdout/stderr evidence and exported summary contain no credential value;
- Jev receives only the documented bounded feature projection and the minimal child environment;
- local records are mode `0600` under the active `$DSH_HOME`, size/count bounded, corruption tolerant, clearable, and never injected into model context;
- disabling the router makes zero new calls/writes and leaves ordinary conversation and standard OpenSpec unchanged.

## Integration and fallback gate

- A real ordinary DSH Agent request header proves the Jev tool names are present when enabled and absent when disabled/missing credential.
- A typed mock call, cancellation, dispose and startup-failure probe pass through the actual DSH MCP bridge.
- Standard `spec-driven` remains the project default and can create/validate a change after every rollback drill.
- Anvil is byte-identical to its exact upstream pin and is selectable only via explicit `--schema anvil`.
- spec-superflow is byte-identical to its exact npm pin, explicitly activated only, and removed from executable candidates wherever Worktree Session lifecycle conflicts are not mechanically prevented.
- Two consecutive sync runs converge to no changes, and disable/re-enable affects only managed artifacts.

## Approval rule

After the gates pass, produce a redacted report containing dataset coverage, confusion/cost tables, needs-review/failure/latency/cost metrics, privacy test result, candidate health and rollback result. Then ask the user to approve or reject a **new Phase 2 OpenSpec change** with a concrete advisory UI and override design.

Without that explicit approval—or whenever any threshold later regresses—the system remains in Phase 1 shadow mode. Phase 3 automation is not implied by Phase 2 approval and needs its own evidence, design and approval.
