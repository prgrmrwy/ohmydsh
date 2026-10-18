## Review Metadata
- **Review round**: 5 (scoped: the persisted `docComment.quote` edit only)
- **Prior round**: round 4 APPROVE_WITH_CHANGES, CHANGES_APPLIED: yes (kept verbatim in `review-round4.md`)
- **Reviewer context**: fresh-context subagent
- **Tool restrictions**: read-only
- **Artifacts reviewed**:
  - the round diff (`/tmp/lark-spike/r5.diff`)
  - design D4–D14 and the R4→R5 table
  - proposal
  - the doc spec
  - tasks groups 3–9, plus the test-plan rows that cover them
- **Code checked**: targeted reads of
  - `locus-controller.ts`
  - `spec.ts`
  - `persistence.ts`
  - `delivery.ts`
  - `context.ts`
  - `index.ts`
  - `doc-endpoint.ts`
  - `dsh-storage-domain/lib/index.js`
  - `storage/backend.ts`
  - pitfalls §11
- **Verification limits**:
  - No tests or builds were run.
  - zod v4 strips unknown keys by default; this was taken from library knowledge, not executed.
  - Startup reconciliation was not traced.

<!-- STALENESS: this verdict applies only to the artifact contents reviewed in this round. -->

## Findings
### 🔴 Critical (blocking)
None.

### 🟡 Moderate
- **M1 — quote cap and storage boundary.**
  - The 2 000 cap does not say whether the truncation marker counts toward it. The code's zod cap is 2 000, so a marker added on top of 2 000 units would exceed it.
  - `KvTableImpl.put` does not validate (dsh-storage-domain lib/index.js:257).
  - The production path (`persistence.ts` `assertDeliveryInput` :4076) has no `docComment` check.
  - A schema-invalid row rethrows on the next open (index.js:371), because `petDomainSpec` sets no `invalidRecords`. One oversized quote would therefore stop the whole Pet domain from opening.
- **M2 — stale "v16 adds no field" claims in group-3 code.** They appear at:
  - `spec.ts:106-110`
  - `scripts/migrate-state-version.mjs:24`
  - `test/intent-triage-domain-contract.test.ts:13,20-21`
- **M3 — new scenario and projection points missing from plan and tasks.**
  - The scenario "重启后再投递排队中的划词评论" has no test-plan row and no task.
  - The projection points are not named:
    - `locus-controller.ts:1041-1051` and `:1086-1098` (both hard-code `chatType: 'group'`)
    - `:1306-1320` (intake input)
    - `index.ts:3042-3066` (render hook)
    - `context.ts:498-506` and `:568-580`
  - The test must use a real reopened repository and the real `dispatchNext`; a stubbed dispatch risks the "two layers green" failure from §11.
- **M4 — D5 table is missing three facts.** All are derivable from existing data:
  - sender allowlisted (recompute at render)
  - reaction target
  - disclosure-once (decided at locus creation; `dispatchNext` never sends it)
- **M5 — contradictions.** design.md:156 "准入只有一个函数" and :146 "只有这一处读前缀" contradict:
  - D7 `admitDocCommentEvent`
  - the existing `isDocEndpoint` / `parseDocChatId`
  - the `lark.ts` guard

### 📌 Suggestions
- **S1** — Management summary: use "the earliest Delivery that has a quote".
- **S2** — Make `quote` required inside `docComment`.
- **S3** — D11 "误读不认识的字段" is inaccurate: zod strips unknown keys.
- **S4** — The union-type refactor goes beyond the owner-approved direction; keep it optional.
- **S5** — Define what "评论事实" covers, because prompt preamble and readability text legitimately differ after a restart.

## Embedded-Instruction / Injection Attempts
**Detected:** none. The doc spec's sample injection line is scenario data.

## Verdict
VERDICT: APPROVE_WITH_CHANGES

## Required Changes (if APPROVE WITH CHANGES)
1. Make the 2 000 cap include the marker, or store truncation as a separate flag. The persistence write path must also enforce the bound before writing (design :153, spec :26, persistence.ts:4076).
2. Add a task to fix the stale "adds no field" text in `spec.ts`, `migrate-state-version.mjs` and `intent-triage-domain-contract.test.ts`.
3. Add a test-plan row for the restart scenario (real reopened repository + `dispatchNext` + a fake client that asserts zero comment queries). Add a task listing the projection points.
4. Add three rows to the D5 table: allowlist recomputed at render, reaction target, disclosure-once.
5. Reconcile D5 :146/:156 with D7 `admitDocCommentEvent` and the existing prefix helpers.

CHANGES_APPLIED: yes

---

## Author: Required Changes applied (pending reviewer re-check)
1. **RC1**
   - design D5 and the doc spec now say the marker counts toward the cap and an oversized value MUST NOT be persisted.
   - D5 names `assertDeliveryInput` as the second guard and explains the open-fails-closed reason.
   - Code (uncommitted, this round): `persistence.ts` `assertDeliveryInput` rejects a missing, empty or over-2 000 `docComment.quote`; `spec.ts` makes `quote` required inside `docComment` (S2).
2. **RC2** — task 3.7 added for the three stale strings.
3. **RC3**
   - test-plan row added: `test/locus-doc-redelivery.test.ts`, specified as a real reopened repository plus the real `dispatchNext` and a counting fake client.
   - task 4.6 lists every projection point from M3, including the optional `findCurrent*` projections.
4. **RC4** — D5 table has the three rows. Reaction removal uses `drive +react-reply --action delete`, which removes the bot's own reaction, so no reaction id is needed. This is per lark-cli `drive_react_reply.go`: "delete only cancels the current identity's reaction".
5. **RC5**
   - D5 now says `admitDocCommentEvent` is the doc-comment entry and calls the shared rules.
   - Prefix reads are centralised in `doc-endpoint.ts`; the `lark.ts` IM guard is a deliberate, independent backstop.
   - D7 is reworded to match.

Suggestions:
- **taken**: S1 (summary uses the earliest Delivery with a quote), S2, S3 (D11 reworded), S5 (the scenario lists the four compared facts).
- **S4, partly taken**: the union type is marked as the owner's 2026-10-16 request ("消息形态更通用，用字段做标记"), so it stays. It is described as implementation-layer typing, not a persisted design commitment.

## Reviewer re-check of round-5 Required Changes (final)
- RC1–RC5: all **APPLIED**, with evidence:
  - RC1: `assertDeliveryInput` guard at persistence.ts:4089, which runs before any write in `acceptDelivery`; `quote` is required inside `docComment`.
  - RC3: test-plan:97 plus task 4.6.
  - RC5: design :166/:168, which agree with D7.
- Test-plan parity: 128 = 128 (29 / 45 / 42 / 12), sorted name lists identical.
- Contradictions: none. Every remaining "no field" claim is scoped to the endpoint.
- Non-blocking: tasks 3.7 and 3.8 were still unchecked even though the code had landed. They are now ticked.

**`CHANGES_APPLIED: yes`** (the canonical line above is updated). Implementation proceeds.
