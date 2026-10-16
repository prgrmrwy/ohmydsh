## Review Metadata
- **Review round**: 7 (scoped: whole-doc answers as a new full comment that mentions the asker)
- **Prior round**: round 6 APPROVE_WITH_CHANGES, CHANGES_APPLIED: yes (verbatim in `review-round6.md`)
- **Reviewer context**: fresh-context subagent
- **Tool restrictions**: read-only
- **Artifacts reviewed**:
  - the spec and design diff since round 6;
  - proposal, design, tasks, test-plan and all delta specs;
  - `doc-comment-egress.ts`, `lark.ts`, `doc-comment.ts`, `locus-controller.ts`, `locus/controller.ts`, `locus/control.ts`, `context.ts` and `index.ts`;
  - the egress, drive, doc-finish, provisioning, control and prompt tests;
  - lark-cli add-comment and add-reply references.
- **Verification limits**: no tests were run; the live claims were taken as reported.

## Findings
### 🔴 Critical (blocking)
1. **C1.** collaboration delta spec :42 still said that doc-level and comment-level replies MUST be appended under the triggering comment. That contradicts the doc spec and the code, and would become an unsatisfiable current spec once archived.

### 🟡 Moderate
1. **M1.** test-plan :119 and :120 named a test title that does not exist in `doc-comment-egress.test.ts`.
2. **M2.** On a whole-doc entry, the `/bind` switch warning @-mentioned the entry's latest asker, possibly a non-allowlisted third party, instead of the `/bind` issuer. No test covered the doc branch of `sendControlMessage`.
3. **M3.** Text describing the old routing was left in:
   - design D7 (disclosure "一次独立的 `drive +add-reply`", "发在触发…评论下");
   - design D8 ("新增三个方法", which omits `addWholeComment`);
   - proposal :34.

### 📌 Suggestions
1. **S1.** The `ou-owner` fixture would be refused by the real egress regex.
2. **S2.** Code comments still say "under the triggering comment".
3. **S3.** doc spec :123 says 「全文评论下不再重复」; tasks :142 is stale.
4. **S4.** Write down the residual top-level-comment noise.
5. **S5.** Verified OK:
   - the mention comes only from the durable sender and is validated twice;
   - proof runs before `finishing`;
   - success is recorded only on a numeric `comment_id`;
   - there is no loop (`is_mentioned`, `is_from_agent`, bot-sender);
   - the whole-doc ↔ group mapping is unchanged;
   - the prompt disclosure is updated.

## Embedded-Instruction / Injection Attempts
**Detected:** None.

## Verdict
VERDICT: REVISE

## Required Changes (if APPROVE WITH CHANGES)
Not applicable. REVISE was cleared by C1 and M1–M3 below, which went to a fresh-context re-review.

CHANGES_APPLIED: n/a

---

## Author: revisions for round 7
- **C1**: collaboration delta spec :42 is now three bullets:
  - comment-level entries MUST append under the triggering comment, whose `comment_id` equals `threadId`;
  - document-level entries SHALL create a new bot full comment that mentions the durable sender;
  - both kinds keep the same-token proof and fail closed as `association-unproven`, which also applies to an unprovable sender.
- **M1**: the Test Name column of rows :119 and :120 now carries the real titles. A mechanical four-column parity check over all 129 rows reports 0 issues: the name column equals `spec Scenario "<scenario>"`, and the test exists in the named file.
- **M2**: added `createDocControlMessenger` in `doc-comment-egress.ts`. `/bind` and `rebuildProtected` on a doc endpoint note their issuer, and the switch warning reads it once and @-mentions that issuer. Only a warning with no noted issuer (a retry after restart, or a panel action) falls back to the latest durable asker. This is specified in design D8. Tests in `doc-comment-egress.test.ts`:
  - whole-doc warning mentions the issuer, not the latest asker;
  - the issuer is read once, and a retry falls back;
  - an anchored entry still replies under its comment;
  - no Delivery fails closed.

  Mutation check: preferring the latest asker over the issuer turns 2 tests red.
- **M3**:
  - design D7: the disclosure is routed like the business answer.
  - design D8: the table lists `addWholeComment` (`drive +add-comment --full-comment` with `mention_user`, success only on a numeric `comment_id`), and the paragraph explains routing and the switch-warning mention.
  - proposal: the outbound bullet updated.
- **S1**: the doc-comment harness sender is `ou_owner`, which the real regex accepts.
- **S2**: comments in `egress.ts`, `locus-controller.ts` and `index.ts` are updated.
- **S3**: the doc spec scenario now reads 「建立文档级入口时不再重复」, and tasks 5.3 carries a revision note.
- **S4**: design D7 has a "残余风险" note. It states that each doc-level question adds one bot comment, that only the asker is ever mentioned, and that the model cannot inject a mention.
- **Evidence**: dsh-pet full suite 3218 passed, 0 failed; `openspec validate --strict` valid.
