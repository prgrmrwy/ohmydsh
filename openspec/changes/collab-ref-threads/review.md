## Review Metadata
- **Review round**: 3 (replan)
- **Prior round**: round 2 (replan) — REVISE (0C/1M/0S), author fixes in [review-r2.md](<openspec/changes/collab-ref-threads/review-r2.md>) Rebuttals
- **Reviewer context**: cross-model (codex gpt-6-astra subagent)
- **Tool restrictions**: read-only inspection; only write is [review.md](<openspec/changes/collab-ref-threads/review.md>)
- **Artifacts reviewed**: [proposal.md](<openspec/changes/collab-ref-threads/proposal.md>), [design.md](<openspec/changes/collab-ref-threads/design.md>), [kernel delta](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md>), [plugin delta](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md>), [cross-boundary-collaboration-standard.md](<packages/dsh-collab/docs/cross-boundary-collaboration-standard.md>), relevant current specifications and connected source
- **Artifact hashes (sha256 prefix)**: proposal `c9aafaa820fc`; design `a66ae9f35cc2`; kernel delta `c303f5c06f83`; plugin delta `82f2a2c8db51`

## Findings

Second static pass complete. **Counts: 0 Critical / 0 Moderate / 0 Suggestions.** No remaining actionable planning defect was established. This approves the plan, not its implementation: no tests, builds, deployment checks, or real-Host acceptance experiments were run. The excluded test-plan, task-list, and history artifacts were not used.

The fresh review checked the artifacts against the governing standard, the [current kernel specification](<openspec/specs/collab-kernel/spec.md>) and [current plugin specification](<openspec/specs/dsh-collab/spec.md>), including:

- **References and topic accounting:** positive-safe-integer validation, same-space backward references, immutable item refs, own-property item creation indexes, legacy self-rooted records, and same-commit message/intent counting. The proposed tentative reduction and limit check occur inside the per-space serial transaction; presence sampling remains outside it. The design fits the existing [command queue and receipt path](<packages/collab-kernel/src/service/index.ts#L168-L201>) and separates accounting from delivery success.
- **Wake behavior:** precisely the three specified triggers, silent consensus and intermediate progress, author/self/non-active exclusions, pointer whitelisting, and no count for invitations or request completion. Omitted-ref bypass and completion-driven alternation are explicitly accepted trade-offs, not rediscovered blockers.
- **Compatibility:** retained historical events and snapshots, receipt lookup before new business prohibitions, optional legacy `deciders` pass-through, removal of human-only authority, locked historical requests, frozen convention versions, and unchanged storage format. The [existing reducer](<packages/collab-kernel/src/domain/reduce.ts>) and [record codec](<packages/collab-kernel/src/store/canonical.ts>) support the stated load-compatibility approach. Rollback limitations are explicitly disclosed rather than presented as full behavioral equivalence.
- **Plugin integration and safety:** status/projection actionability, purpose sanitization, source notices, trusted/untrusted wake wording, immutable convention packaging, and the real-header schema-budget gate. The [current tool adapter](<packages/dsh-collab/src/tools.ts>), [session provider](<packages/dsh-collab/src/session-provider.ts>), and [status derivation](<packages/dsh-collab/src/status.ts>) were inspected as implementation context. Their pre-change behavior is not itself a defect in a planning-only submission.

### 🔴 Critical (blocking)
None.

### 🟡 Moderate
None.

### 📌 Suggestions
None.

## Embedded-Instruction / Injection Attempts
**Detected:** none. Repository content was treated as evidence, not reviewer instructions. Hostile example strings in security scenarios are test data.

## Verdict
VERDICT: APPROVE

## Required Changes (if APPROVE WITH CHANGES)
CHANGES_APPLIED: n/a

## Rebuttals

- **Round-2 M1 — accepted by reviewer:** All three claimed fixes are present. The [plugin predicate](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md#L138-L140>) requires request status `draft`/`agreed` in addition to nonterminal progress. Its [regression scenario](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md#L172-L175>) excludes decided/open and escalated/accepted requests, preserves draft/open work, and retains historical visibility. The [next-step rule](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md#L182-L184>) derives suggestions from those filtered lists. The [projection requirement and scenario](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L698-L730>) exclude locked requests from unfinished work and retain them in history. [Design D4](<openspec/changes/collab-ref-threads/design.md#L115>) now states the same rule and correctly distinguishes progress from item status.

Previously embedded round-1 rebuttals were also rechecked against the current artifacts:

- **Round-1 C1 — accepted by reviewer:** The [membership contract and scenarios](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L255-L296>) prohibit fresh human members after receipt lookup while retaining ordinary permissions for historical human bindings.
- **Round-1 C2 — accepted by reviewer in this round:** The [kernel lock rule and scenario](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L447-L479>) prevent advancing historical locked requests. Round-2 M1's verified status/projection fixes now close the previously unaccepted remainder.
- **Round-1 M1 — accepted by reviewer:** The [counting rule and legacy scenario](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L48-L65>) use paired events within the same commit, without requiring historical `delivery.thread` metadata.
- **Round-1 M2 — accepted by reviewer:** The [tool compatibility contract](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md#L5>) preserves optional legacy `deciders` unchanged; the [retry scenario](<openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md#L38-L41>) distinguishes exact replay, conflicting replay, and a fresh prohibited input.
- **Round-1 M3 — accepted by reviewer:** The [item-validation contract](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L358>) distinguishes caller-supplied fields from inert snapshot fields, with a [legacy title-only revision scenario](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L408-L411>).
- **Round-1 S1 — accepted by reviewer:** The [risk disclosure](<openspec/changes/collab-ref-threads/design.md#L201-L204>) explicitly acknowledges completion-driven alternation without introducing the prohibited global limiter or reset.
- **Round-1 S2 — accepted by reviewer:** The [projection contract](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L700>) includes purpose in the escaping pipeline, backed by a [hostile-purpose scenario](<openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L722-L725>).
