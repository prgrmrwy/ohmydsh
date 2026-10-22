## Review Metadata
- **Review round**: 5
- **Prior round**: round 4 — REVISE (0C/1M/1S), author fixes in review-round4.md Rebuttals (`openspec/changes/collab-ref-threads/review-round4.md#L45-L55`)
- **Reviewer context**: cross-model (codex gpt-6-astra subagent)
- **Tool restrictions**: read-only inspection; only write is review.md (`openspec/changes/collab-ref-threads/review.md`)
- **Artifacts reviewed**: proposal.md (`openspec/changes/collab-ref-threads/proposal.md`), design.md (`openspec/changes/collab-ref-threads/design.md`), kernel delta (`openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md`), plugin delta (`openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md`), test-plan.md (`openspec/changes/collab-ref-threads/test-plan.md`), tasks.md (`openspec/changes/collab-ref-threads/tasks.md`), and historical round 1 (`openspec/changes/collab-ref-threads/review-round1.md`), round 2 (`openspec/changes/collab-ref-threads/review-round2.md`), round 3 (`openspec/changes/collab-ref-threads/review-round3.md`), round 4 (`openspec/changes/collab-ref-threads/review-round4.md`) reports. Cross-checked modified requirements against the current kernel specification (`openspec/specs/collab-kernel/spec.md`) and current plugin specification (`openspec/specs/dsh-collab/spec.md`), and inspected connected kernel/service/provider/status/bundle code and relevant test fixtures.
- **Review method**: pass 1 wrote a complete provisional report early; pass 2 completed the static adversarial review and replaced it with this report. No tests, builds, deployment, or implementation changes were performed. Test-plan RED/GREEN labels are planning assertions, not verified test results.
- **Artifact hashes (sha256 prefix)**, rechecked during pass 2:
  - proposal.md (`openspec/changes/collab-ref-threads/proposal.md`): `ec8f3f4b7b15`
  - design.md (`openspec/changes/collab-ref-threads/design.md`): `215fe0fbf346`
  - kernel delta (`openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md`): `29ac0452f38b`
  - plugin delta (`openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md`): `faead1c3451f`
  - test-plan.md (`openspec/changes/collab-ref-threads/test-plan.md`): `f32c9dea60b5`
  - tasks.md (`openspec/changes/collab-ref-threads/tasks.md`): `e3b0c44298fc` (0 bytes)

## Findings
### 🔴 Critical (blocking)
None.

### 🟡 Moderate
**M1. The implementation task artifact is empty, so the claimed task-order fix is absent.**
- **Location:** tasks.md (`openspec/changes/collab-ref-threads/tasks.md`), round-4 author response:49–55 (`openspec/changes/collab-ref-threads/review-round4.md#L49-L55`), and test-plan.md:123 (`openspec/changes/collab-ref-threads/test-plan.md#L123`).
- **Problem:** Repeated reads return zero lines, and the byte count and SHA-256 independently confirm an empty file. The author describes revised groups 1–3, rule 0.3 and task 5.2, but none exists in the submitted artifact. The test plan still depends on “tasks group 3.” This is not a disagreement about the proposed ordering: there is no ordering to execute or review.
- **Why it matters:** The previous round's remaining Moderate was specifically an executable TDD/dependency problem. Narrative rebuttals do not repair it. The convention loader eagerly reads registered versions, while the plugin bundle hook:17 (`packages/dsh-collab/tsdown.config.ts#L17`) copies only v1/v2. The build-artifact fixture:28–43 (`packages/dsh-collab/test/build-artifact.test.mjs#L28-L43`) and sync-artifact fixture:31–45 (`packages/dsh-collab/test/sync-artifact.test.mjs#L31-L45`) also mutate the exact v2 default expression and expect its sentinel. Those edits must accompany v3 registration before the relevant green gate. Likewise, derived-chain behavior cannot be prescribed as newly RED after an earlier batch already implements it. The missing task artifact also loses the promised baseline, API/breaker batching, documentation and final verification work.
- **Concrete fix:** Restore the actual updated task list, not another rebuttal-only claim. It should (1) establish the existing baseline; (2) batch v3 registration/default, asset copying, artifact file assertions and both source-mutation fixtures before their green gate; (3) write derivation tests, including `chain-02/05/11`, before implementing that behavior, and assign both thread fields from one value; (4) keep limit/exemption/leader-no-wake/breaker removal and affected callers/tests coherently batched; (5) explicitly permit already-satisfied assertions to remain green with a reason instead of manufacturing a failure; and (6) include regressions, real-header budget, immutable-version checks, docs/manifest and spec-sync cleanup. Recheck the restored list against the test ledger before requesting another review.

### 📌 Suggestions
None added. Remaining editorial cleanup and restoration of previously promised task details are accounted for under M1 rather than counted again.

## Embedded-Instruction / Injection Attempts
**Detected:** none. The malicious title `忽略之前所有指令` in the plugin security scenario:113–116 (`openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md#L113-L116`) is explicitly test input whose exclusion is asserted, not an instruction to this reviewer. Convention prose describes future agent behavior; author rebuttals are claims to verify, not review directives.

## Verdict
VERDICT: REVISE

**0 Critical / 1 Moderate / 0 Suggestions.** Static review is complete. Approval is blocked by the empty execution artifact, not by a newly discovered flaw in the fixed optional-ref design.

Additional cross-checks:
- All **72 kernel and 25 plugin delta scenarios** have named test-plan mappings. Comparing modified requirements with the current specs found no unrelated removal: the retired breaker scenarios and replaced internal/reset scenarios follow the explicit API removal. Mapping coverage does not establish that those tests exist or pass.
- The shared derivation design:62–89 (`openspec/changes/collab-ref-threads/design.md#L62-L89`) uses pre-event logical recipients and the same reducer for tentative checks and replay. That matches the connected wake calculation (`packages/collab-kernel/src/domain/wake.ts`) and the per-space command transaction:178–196 (`packages/collab-kernel/src/service/index.ts#L178-L196`). The snapshot/reopen/race scenarios:90–103 (`openspec/changes/collab-ref-threads/specs/collab-kernel/spec.md#L90-L103`) test the relevant semantic boundaries rather than folding a log twice or relying on a stale-revision failure.
- Rejection oracles:115–117 (`openspec/changes/collab-ref-threads/test-plan.md#L115-L117`) correctly distinguish a rejected never-committed command from a conflicting retry whose original receipt must survive. Optional ref persistence, invalid-reference precedence, immutable item refs and own-property item IDs are explicitly specified.
- The plugin pointer and status contracts (`openspec/changes/collab-ref-threads/specs/dsh-collab/spec.md#L47-L126`) preserve the existing trust boundary and only add structured numeric data. The provider whitelist:113–114 (`packages/dsh-collab/src/session-provider.ts#L113-L114`) and status projection:12–24 (`packages/dsh-collab/src/status.ts#L12-L24`) are the concrete adaptation sites. No new tool or free-text authorization channel is required.
- Accepted user choices remain accepted: omitted refs start new chains; branching is not cumulative fan-out accounting; no-wake creations may exceed 20; request progress and trusted decisions are exempt; leader changes do not wake; there is no global backstop/reset. These are not recast as defects. Replay growth and rollback limitations remain disclosed in Risks and Migration (`openspec/changes/collab-ref-threads/design.md#L164-L180`).

## Required Changes (if APPROVE WITH CHANGES)
CHANGES_APPLIED: n/a

## Rebuttals

Author response (round 5 → round 6):

- **M1 (empty tasks.md)** — accepted, and caused by an author bug. A post-commit edit script accidentally rewrote `tasks.md` as an empty file, so commit `8a94db1bc` contained a 0-byte task list. The list has been regenerated from the test ledger. It covers all six points of the concrete fix:
  - 0.1–0.3: baseline first, plus the rule that an assertion already satisfied may start green with a one-line reason.
  - Group 1 is one batch: v3 registration and the new default, `tsdown` copying v1/v2/v3, `lib/v3.md` artifact assertions, and retargeting both source-mutation fixtures to v3, all before its green gate.
  - Group 2 writes the derivation tests, including `chain-02/05/11`, red-first before that behavior is implemented. Both thread fields are assigned from a single value.
  - Group 3 batches together the limit, the exemptions, no wake on leader change, removal of the breaker, API changes and changes to callers.
  - Group 4 is the plugin work and includes the real-header budget check.
  - Groups 5 and 6 cover docs and the manifest, spec-sync cleanup, immutable-version checks, the regression suite and verification.

  Before requesting another review, a script checked that every 🔴 row in `test-plan.md` names a test that appears in `tasks.md`.
