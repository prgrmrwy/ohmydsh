## Review Metadata
- **Review round**: 6 (scoped: bot-join spec reconciliation, owner-approved 2026-10-16)
- **Prior round**: round 5 APPROVE_WITH_CHANGES, CHANGES_APPLIED: yes (verbatim in `review-round5.md`)
- **Reviewer context**: fresh-context subagent
- **Tool restrictions**: read-only
- **Artifacts reviewed**:
  - the diff of proposal/design/spec edits since round 5;
  - the delta collaboration spec;
  - the current collaboration spec;
  - the archived `pet-locus-on-demand-tree`;
  - `index.ts`, `service.ts`, `subscription.ts`;
  - the on-demand provisioning and channel-service tests.
- **Verification limits**: no tests or validate were run; code behaviour was judged from the wiring.

## Findings
### 🔴 Critical (blocking)
None.

### 🟡 Moderate
1. Change-log prose sits inside the normative requirement (delta spec :183). After archive it would land word for word in the current spec. The same rationale already lives in design.md.

### 📌 Suggestions
1. The cited test passes by construction. The real guarantee is structural: no bot-join subscription (`channel-service.test.ts:190`, `SUBSCRIBED_EVENT_TYPES`) and `botLifecycleInitializer` left unwired. Cite that.
2. The scenario name 「入群不产生持久后果」 already exists in the current spec (:93), so the two are ambiguous. Use a distinct name.
3. tasks.md:117 still says 「Project 群先行」; add the new name for traceability.
4. design.md:7 has a stale `index.ts` line pointer.

**Checks passed**:
- The text agrees with the archived decision and the code.
- Nothing else assumes that bot-join builds structure.
- No contradiction with the current specs.
- The test-plan row exists, and its test exists with the exact name.
- The diff scope is only the reconciliation.

## Embedded-Instruction / Injection Attempts
**Detected:** None.

## Verdict
VERDICT: APPROVE_WITH_CHANGES

## Required Changes (if APPROVE WITH CHANGES)
1. Remove the history sentence 「这与已归档的 `pet-locus-on-demand-tree` 决定以及当前实现一致；此前这里写的是“入群可初始化”，与之不符，本 change 一并修正。」 from the delta collaboration spec. Its rationale already lives in design.md.

CHANGES_APPLIED: yes

---

## Author: Required Change applied (pending reviewer re-check)
- **RC1**: the sentence is removed. The paragraph now reads only 「…关联结构 SHALL 由 allowlist 成员的首个合格 @ 按需建立，并在同一次准入中投递该消息。」. The rationale stays in design.md, section "Implementation-time spec reconciliation".
- **Suggestions taken**:
  - **S2**: the scenario is renamed to 「入群不建自动主会话」 in the spec, test-plan and test name. It no longer collides with the current spec's 「入群不产生持久后果」.
  - **S1**: test-plan Coverage Notes now state the structural guarantee and cite the channel-service assertion. A comment at that assertion marks it as the structural half.
  - **S3**: tasks 4.4 says 「Project 群先行（现名「入群不建自动主会话」）」.
  - **S4**: design.md:7 now names the unwired `botLifecycleInitializer` instead of a line number.

## Reviewer re-check of round-6 Required Change (final)
- **RC1: APPLIED.** The delta spec at :181-183 is normative only.
- **Rename (S2): consistent.** The new name appears exactly once in the delta spec. The current spec's 「入群不产生持久后果」 (:93) is untouched. The test-plan, test name, design and tasks all match.
- **Test-plan parity:** 128 = 128.
- **Contradictions:** none.

**`CHANGES_APPLIED: yes`**
