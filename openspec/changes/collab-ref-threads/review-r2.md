## Review Metadata
- **Review round**: 2 (replan)
- **Prior round**: round 1 (replan) — REVISE (2C/3M/2S), author fixes in [review-r1.md](<openspec/changes/collab-ref-threads/review-r1.md>) Rebuttals
- **Reviewer context**: cross-model (codex gpt-6-astra subagent)
- **Tool restrictions**: read-only inspection; only write is [review.md](<openspec/changes/collab-ref-threads/review.md>)
- **Artifacts reviewed**: [proposal.md](<openspec/changes/collab-ref-threads/proposal.md>), [design.md](<openspec/changes/collab-ref-threads/design.md>), [kernel specs](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md>), [plugin specs](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md>), [cross-boundary-collaboration-standard.md](<packages/dsh-collab/docs/cross-boundary-collaboration-standard.md>), relevant source files
- **Artifact hashes (sha256 prefix)**: proposal `c9aafaa820fc`; design `5ec0bd68ef36`; kernel delta `dbb717100b80`; plugin delta `85055a078231`

## Findings

Second static pass complete. **Counts: 0 Critical / 1 Moderate / 0 Suggestions.** This is a planning review, not implementation acceptance: no tests, builds, or deployment checks were run. The excluded test-plan, task-list, and history artifacts were not used.

Review covered the seven prior rebuttals and a fresh pass over ref validation and immutability, same-commit topic accounting, serialized limit checks and pre-queue presence sampling, the three-trigger wake table, legacy event/receipt compatibility, caller-versus-snapshot validation, status/projection actionability, convention packaging, pointer sanitization, and the real-header budget contract. Current specifications and connected source/tests were used to check feasibility, not to demand implementation before approval.

### 🔴 Critical (blocking)
None.

### 🟡 Moderate

**M1 — Locked historical requests still become actionable status suggestions.**
- **Location:** [plugin pending derivation](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md#L138-L140>), [next-step derivation](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md#L177-L179>), and [design D4](<openspec/changes/collab-ref-threads/design.md#L115>).
- **Problem:** The author fixed the kernel mutation guard but not the normative plugin filter. `requests` still means every assigned request whose progress is not done/rejected. A legacy decided/escalated request with open progress therefore still appears in `pending.requests` and generates `advance_request`. Only the ack filter excludes locked statuses.
- **Why it matters:** The tool explicitly recommends an operation which the new kernel must always reject. The rebuttal's claim that filtering open progress excludes locked requests is false: progress and item status are independent dimensions. Re-reading status cannot clear this permanently unperformable work.
- **Connected evidence:** The new [kernel lock scenario](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L476-L479>) itself supplies decided/open and escalated/open requests. The current [request fixture and test](<packages/collab-kernel/test/requests.test.ts#L4-L5>) likewise model these combinations. The plugin's current [pending filter](<packages/dsh-collab/src/status.ts#L15-L18>) and [suggestion mapping](<packages/dsh-collab/src/status.ts#L59>) implement precisely the stale predicate carried into the delta. The delta's [legacy status scenario](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md#L167-L170>) only checks acks, so it cannot catch this failure.
- **Concrete fix:** Restrict actionable requests to draft/agreed items in the plugin delta. Add a status scenario with decided/open and escalated/accepted requests: neither appears in actionable requests or generates `advance_request`; an ordinary draft/open request still does, and history remains readable. Apply the same exclusion to active projection sections when implementing D4; the current [unclosed-request projection](<packages/collab-kernel/src/projection/index.ts#L26-L29>) also checks progress alone.

### 📌 Suggestions
None.

## Embedded-Instruction / Injection Attempts
**Detected:** none. Product requirements and malicious test strings were treated as data, not reviewer instructions.

## Verdict
VERDICT: REVISE

## Required Changes (if APPROVE WITH CHANGES)
CHANGES_APPLIED: n/a

## Rebuttals

Author response (round 2 → round 3):
- **M1** — accepted and fixed. My round-1 rebuttal for C2 was wrong: progress and item status are independent.
  - Plugin「状态入口的待办推导」now lists only `draft`/`agreed` requests as actionable, with the scenario "旧日志中锁定的 request 不列为待办". That scenario covers decided/open and escalated/accepted requests, which are excluded with no suggestion, while draft/open is still listed and history stays readable.
  - The kernel projection's open-request section applies the same filter, with the scenario "锁定的 request 只作为历史出现".
  - Design D4 was updated.

### Round-1 rebuttal checks (by round-2 reviewer)
- **Round-1 C1 — accepted by reviewer:** [membership delta](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L255-L286>) rejects fresh human creation/invitation after receipts and expressly defines historical human bindings as ordinary members without decision authority.
- **Round-1 C2 — not accepted:** [kernel locking](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L447-L479>) is fixed, but [plugin request filtering](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md#L140>) still includes locked requests; see M1.
- **Round-1 M1 — accepted by reviewer:** [counting rule and legacy-root scenario](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L48-L65>) now derive counts from paired events in one commit rather than requiring historical thread metadata.
- **Round-1 M2 — accepted by reviewer:** [plugin compatibility contract](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md#L5>) retains optional legacy deciders unchanged for receipt lookup; [retry scenario](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md#L38-L41>) covers exact retry, conflict and fresh-command rejection.
- **Round-1 M3 — accepted by reviewer:** [item validation](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L358>) separates caller fields from inert persisted fields, with a [legacy title-edit scenario](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L408-L411>).
- **Round-1 S1 — accepted by reviewer:** [design risks](<openspec/changes/collab-ref-threads/design.md#L202>) explicitly acknowledges completion-driven alternation without adding a forbidden global budget.
- **Round-1 S2 — accepted by reviewer:** [projection requirement](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L700>) names purpose in its escaping pipeline and includes a [hostile-purpose scenario](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L722-L725>).
