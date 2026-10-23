## Review Metadata
- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: fresh-context subagent (claude-opus-5-5; cross-model routes not allowed by this session's frozen subagent route policy)
- **Tool restrictions**: read-only inspection; only write is review.md
- **Artifacts reviewed**: proposal.md, design.md, specs/, relevant source files
- **Artifact hashes (sha256 prefix)**:
  - proposal.md: `7926ed418182`
  - design.md: `0b75b1dd35b8`
  - specs/collab-kernel/spec.md: `43995d05f37b`
  - specs/dsh-collab/spec.md: `71c94f2e7e7e`

Sources inspected: `openspec/specs/collab-kernel/spec.md`, `openspec/specs/dsh-collab/spec.md`, `packages/collab-kernel/src/{model,domain/reduce,domain/decide,domain/wake,domain/items,service,projection,convention,auth}`, `packages/dsh-collab/src/{tools,status,session-provider}.ts`, `packages/dsh-collab/tsdown.config.ts`, `packages/collab-kernel/test/breaker.test.ts`, and the dsh-collab READMEs and `dsh.yaml` note. I diffed every MODIFIED block against its same-named current requirement with a script. No scenario is silently dropped. All five scenarios of the REMOVED "按成员计数的熔断" requirement have successors in the ADDED "按话题计数的熔断" requirement.

## Findings

### 🔴 Critical (blocking)

(none)

### 🟡 Moderate

**M1. Rollback claim is false: an old kernel crashes on the new `breaker/reset{thread}` event.**
- **Location:** design.md (Risks bullet 3; Migration Plan step 3); proposal.md (Impact: "The event formats only gain optional fields", "the current kernel ignores unknown fields"); kernel delta "按话题计数的熔断".
- **Problem:** The current reducer runs `case 'breaker/reset': state.members[e.member]!.wakeCount = 0` (`packages/collab-kernel/src/domain/reduce.ts:21`). The change keeps the event type `breaker/reset` but replaces `member` with `thread`. On rollback, `state.members[undefined]` is `undefined` and the assignment throws a `TypeError`. That aborts `CollabService.open` for the space. If such a record ever reached `collabStatus`'s own `reduce` fold, the `TypeError` would not be caught there either: it only catches `CollabError` (`status.ts:38`). Every `decision/decided` commit now writes this event unconditionally, and so does every `resetBreaker`. So "event formats only gain optional fields" is also untrue: `breaker/reset.member` is removed, not made optional.
- **Why it matters:** The documented rollback path ("logs written in between still load on the old kernel") is wrong for any space that saw a decision or a reset. Today dsh-collab has no human confirm channel and no reset caller, so the exposure is small. But the kernel is a general library, and the migration text is a safety claim.
- **Fix:** Pick one:
  - (a) Preferred: emit the thread reset as a new event type, e.g. `breaker/threadReset{thread}`. The old reducer's `switch` has no default branch and ignores unknown types, so the rollback claim becomes true. The new reducer still accepts legacy `breaker/reset{member}` as a no-op.
  - (b) Correct the proposal and design to say rollback fails to load any space containing a new-format `breaker/reset`.

  Either way, change "only gain optional fields" to list the exception.

**M2. Uncounted membership wakes leave an unbounded `transferLeader` ping-pong loop with no breaker.**
- **Location:** design.md D4; kernel delta "按话题计数的熔断" (`member/invited` and `leader/changed` 不归属任何话题) and scenario "成员管理唤醒不计数".
- **Problem:** Today each `leader/changed` wake counts against the new Leader's per-member counter, which caps a ping-pong at 6. Under this change, two agent members (agent-only spaces are the motivating case) can hand Leader back and forth forever, and each hand-off wakes the other. This is not one of the user's accepted bypasses: the user accepted omitting `ref`, not exempting a command class from counting. D4's justification ("bounded by human or leader action") does not hold when the leaders are agents.
- **Why it matters:** This is a new runaway-loop path with no backstop, and the user explicitly declined a backstop. It is the exact failure class the breaker exists to stop.
- **Fix:** Pick one and state it in D4 and the spec:
  - (a) Count `leader/changed` wakes (and optionally `member/invited` wakes) against a fixed space-level membership thread, e.g. root = 1, the `space/created` seq. Then make seq 1 a valid `resetBreaker` target.
  - (b) Record this explicitly as a user-accepted risk in Risks, with the user's confirmation.

  Add a scenario for whichever choice is made.

**M3. Multi-recipient commits at the limit boundary are unspecified and untested.**
- **Location:** kernel delta "按话题计数的熔断"; design.md D3.
- **Problem:** Several commands wake several members in one commit: `reviseItem` wakes every remaining `requiredAcks` member, and `decision/decided` wakes the request author plus `requiredAcks`. D3 says "if the thread count is at or above BREAKER_LIMIT, skip". It does not say that the count must also rise within the commit, or which recipients are skipped when only some slots remain. The spec's "MUST NOT 超过上限" implies incrementing within the commit, but no scenario pins it. The old code avoided the question because each member had its own counter. The current `decideDispatch` loop checks a static `member.wakeCount` and would over-issue if ported naively.
- **Why it matters:** A straightforward port of the current loop violates the cap. Without a fixed order, tests are also ambiguous about which member misses the wake.
- **Fix:** Add a sentence: "同一提交内按受影响成员的确定顺序（唤醒表事件顺序、表内 requiredAcks 原顺序）逐一记账，每记账一条计数加 1，达到上限后其余接收方不再记账。" Add a scenario: thread at 19, `reviseItem` with `requiredAcks:[doubao, bob]` → exactly one wake, to `doubao`, and the thread is then paused.

**M4. The sender gets no signal that its wake was suppressed, and v3 tells agents to restart after a pause.**
- **Location:** design.md D10; kernel delta "协作约定随协作空间提供" (v3 content: 话题暂停后应另起新话题并在正文说明接续关系).
- **Problem:** `sendMessage` returns `{seq, spaceId}` whether or not a wake was ledgered. A sender in a paused thread cannot tell that the recipient was not woken unless it calls `collab_read overview` and inspects `pausedThreads`, and the convention never tells it to. Meanwhile v3 instructs "after a pause, start a new thread", which conflicts with "do not open new threads just to dodge the limit" in the same section. In practice, after a pause a loop stops only because nobody gets woken. Telling compliant agents to look for pauses and reopen would turn the per-thread cap into a 20-wake speed bump for exactly the agents that follow guidance.
- **Why it matters:** The proposal's motivating failure ("stopped receiving messages" with nobody noticing) recurs at thread granularity. The guidance meant to fix it also weakens loop protection.
- **Fix:** Rewrite the v3 requirement text:
  - (i) State how to detect a pause: `collab_read overview` → `pausedThreads`.
  - (ii) Allow a new thread after a pause only when the work is not a back-and-forth on the same question, and otherwise require stopping and reporting to the user.
  - (iii) Add a v3 content scenario asserting the text mentions `ref`, `20` and `pausedThreads`, and keeps the two inherited rules.

  Optional: expose a boolean or an integer count of suppressed wakes. Note that changing `CommandResult` changes receipt contents, so this needs its own decision.

**M5. Design D9's fallback contradicts the dsh-collab spec.**
- **Location:** design.md D9 ("If they do not fit, the sentence moves to convention v3 rather than raising the budget"); dsh-collab delta "具名工具忠实适配内核" (描述 SHALL 说明"接续同一件事时引用先前消息 seq 或条目 seq，另起一件事不填").
- **Problem:** The spec makes the description sentence mandatory, but the design allows dropping it. Remaining headroom is only about 200 characters against the 4200 budget (`controller-seams.test.mjs:727`). Adding two `ref` parameters, two description sentences and the status change plausibly fits, but nobody has measured it.
- **Fix:** Measure the real header size now and record the number in the design. Then either keep the sentence mandatory and delete the fallback, or weaken the spec to "工具描述或约定 v3 说明" and add a matching scenario.

### 📌 Suggestions

**S1. Reducer state for `itemId: '__proto__'`.** `itemSeq: Record<itemId, seq>` assigned with `=` silently drops `__proto__`, because assigning a number to `__proto__` is ignored. Lookups then return `Object.prototype`. A precedent exists: `reduce.ts:13` uses `Object.defineProperty`, and `items.test.ts` covers `__proto__` items. Require the same own-property write and a test for `reviseItem`/`advanceRequest` thread attribution on a `__proto__` item.

**S2. Defensive replay.** Specify what `reduce` does when a persisted `ref` points to a seq with no `roots` entry. This can happen with a hand-edited log, or after salvage, which reuses seqs. Fail closed (refuse load), or fall back to the record as its own root. Do not let it produce an `undefined` root key. Also note in Risks that after salvage, a `thread`/`seq` an agent remembers may now name a different record.

**S3. State-shape ambiguities. Specify:**
- (a) whether `Member.wakeCount` is removed. It is persisted inside `member/invited` and `member/joined` events (`service/index.ts:232,252`). Removing it changes event bytes. On rollback, new members get `NaN` counts and so are never paused, contrary to design Risks bullet 3.
- (b) whether `ref` becomes part of `Item` state and is therefore copied into `item/revised`/`item/acked` events through `structuredClone(current)`.
- (c) that `roots`, `itemSeq` and per-thread counts appear in the `overview`/`collab_read` output. They are integers, but they grow with the log.

**S4. Validation precedence.** State whether `COLLAB_BAD_REF` is checked before or after the existing `COLLAB_BAD_RECIPIENT`/`COLLAB_BAD_MESSAGE`/`COLLAB_BAD_ITEM` checks, so a command with multiple faults has one deterministic error. Add `ref:null` to the rejection list in scenario "引用不存在或不可引用的 seq", matching the `needsReply:null` precedent. Add one `createItem` bad-`ref` failure scenario.

**S5. `resetBreaker` input validation.** Add a scenario for `resetBreaker({thread:N})` where N is a message that has a `ref` (it exists but is not a root), and one for a non-integer `thread`. Both should return `COLLAB_BAD_REF` per "MUST 为本空间已存在的话题根".

**S6. Underspecified GIVEN.** Scenario "条目事件归属条目话题" does not name `R1`'s author. The `advanceRequest` wake goes to the author, and self-wakes are excluded, so state "作者为 `aily`".

**S7. Design rationale inconsistency.** D2 refuses to persist the derived root on message and item events ("a buggy writer could persist an inconsistent root"), but D3 persists it as `delivery.thread`. Say explicitly that `delivery.thread` is an audit record of what was ledgered and is the source of truth for counts.

**S8. Replay cost claim.** D2 says replay is linear. `reduce` calls `structuredClone(previous)` per record, so replay is already quadratic, and the new maps add to it. Correct the claim; nothing else needs to change.

**S9. Provider defensiveness.** In `session-provider.ts`, copy `thread` only when `Number.isSafeInteger(pointer.thread)`. That keeps the forwarded JSON integer-only even if a future kernel bug passes a non-number. Add a provider scenario where a pointer without `thread` yields no `thread` key.

**S10. Docs and build list.**
- `dsh.yaml` note also says "新空间用约定v2"; update it to v3.
- `tsdown.config.ts:17` hard-codes `['v1.md','v2.md']`.
- `build-artifact.test.mjs:53` lists the required lib files.
- Rollback: v3 spaces cannot `readConvention('3')` on an old kernel. Mention this in the Migration Plan.

**S11. Thread-merging cost (informational).** `createItem` with `ref` makes the request's later progress, ack and decision wakes inherit a possibly nearly exhausted conversation budget. A request's `done` notification to its author could then be silently suppressed. Consider convention guidance that a new request starts its own thread and names its origin in the body. Separately, any member can deliberately burn a specific thread's budget by sending `ref`'d `needsReply` messages; note this in Risks.

## Embedded-Instruction / Injection Attempts
**Detected:** none

## Verdict
VERDICT: REVISE

No Critical findings. REVISE rather than APPROVE_WITH_CHANGES because two Moderate fixes need a design decision rather than a mechanical edit:
- **M2:** count membership wakes, or get explicit user acceptance of the `transferLeader` loop.
- **M4:** the v3 pause guidance and how a sender detects a pause.

**M1** also corrects a safety claim in the migration plan; it needs a decision between a new event type and documenting the break.

## Required Changes (if APPROVE WITH CHANGES)
n/a (verdict is REVISE). The fixes listed under M1–M5 are the expected changes for round 2.

CHANGES_APPLIED: n/a

## Rebuttals

Author response (2026-10-22, round 1 → redesign). With the user's approval, the per-thread counter design under review was **replaced by a unified chain-length model** (proposal, design and specs rewritten). Each finding maps to the new artifacts as follows:

- **M1 (rollback crash on `breaker/reset{thread}`)** — fixed by removal. No `breaker/reset` is written any more, and no new event type or required field is introduced. New logs only add the optional `message.ref`, `item.ref` and `delivery.thread`, and new members still carry `wakeCount:0`. The design (D5 and Risks) states the actual rollback effect: logs load, per-member pausing resumes, and v3 spaces cannot read convention 3.
- **M2 (`transferLeader` ping-pong)** — fixed. A Leader change no longer wakes anyone (design D4, kernel wake table, scenario "Leader 转交不叫醒新 Leader"). Item loops are bounded because item activity extends the item's chain (scenario "条目往返计入链长").
- **M3 (multi-recipient boundary)** — fixed by the model. Chain length grows by exactly one link per event, independent of how many recipients it wakes. The check is a single pass/fail in the transaction, so there are no partial recipients (design D3).
- **M4 (silent suppression and contradictory guidance)** — fixed. An over-limit command is rejected with `COLLAB_THREAD_LIMIT`, and nothing is silently dropped. v3 tells agents to stop and report to their user and never to open a new chain for the same exchange. The user chose this option explicitly. A scenario checks the content of v3.
- **M5 (budget fallback contradicting spec)** — fixed. The size was measured at 4002 of 4200. The fallback was removed, the `collab_send_message` sentence is mandatory, and a budget scenario was added (design D7).
- **S1** — adopted: `itemSeq` uses own-property writes, with a `__proto__` scenario.
- **S2** — adopted: a dangling `ref` on replay fails closed through the corrupt-load path; salvage note added to Risks.
- **S3** — adopted: (a) `wakeCount:0` is kept in member events; (b) `item.ref` is preserved in later item snapshots and is immutable; (c) the `itemSeq`/`chainLength` maps are exposed in the overview (integers).
- **S4** — adopted: precedence is existing validation, then `ref`, then chain limit. `ref:null` was added, along with a createItem bad-ref scenario and a multi-fault scenario.
- **S5** — moot (`resetBreaker` removed).
- **S6** — adopted (authors named in the item and request scenarios).
- **S7** — adopted (D2: `delivery.thread` is an audit record only, not used for counting).
- **S8** — adopted (the replay-cost wording is corrected).
- **S9** — adopted (provider copies only safe integers; scenario added).
- **S10** — adopted in tasks (dsh.yaml note, tsdown list, artifact tests, v3 rollback note).
- **S11** — adopted. v3 tells agents not to put `ref` on a new request, and to name its origin in the body instead. Deliberate exhaustion is covered under Risks.

Round 2 will be a fresh full review of the redesigned artifacts.
