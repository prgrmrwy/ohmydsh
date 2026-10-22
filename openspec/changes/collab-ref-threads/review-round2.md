## Review Metadata
- **Review round**: 2
- **Prior round**: round 1 — REVISE (0C/5M/11S) against the previous per-thread-counter design
- **Reviewer context**: fresh-context subagent (claude-opus-5-5; cross-model routes not allowed by this session's frozen route policy)
- **Tool restrictions**: read-only inspection; only write is review.md
- **Artifacts reviewed**: proposal.md, design.md, specs/, review-round1.md, relevant source files
- **Artifact hashes (sha256 prefix)**:
  - proposal.md: `ec8f3f4b7b15`
  - design.md: `b6e1473ab89e`
  - specs/collab-kernel/spec.md: `009327f608a0`
  - specs/dsh-collab/spec.md: `faead1c3451f`

Sources I inspected:
- Current specs: `openspec/specs/collab-kernel/spec.md` and `openspec/specs/dsh-collab/spec.md`.
- Kernel code: `packages/collab-kernel/src/domain/{wake,reduce,decide,items}.ts`, `service/index.ts`, `model/index.ts`, `store/file-store.ts`.
- Plugin code: `packages/dsh-collab/src/{tools,status,session-provider,host}.ts` and `tsdown.config.ts`.

Mechanical checks I ran:
- **Scenario coverage.** A script compared every MODIFIED block with the current requirement of the same name. Only two scenarios are dropped: "internal 命令不做成员反查" and "成员与 internal 的收据互不冲突". Both depend on the removed `resetBreaker`, and each has a replacement ("已移除的 internal purpose 被拒绝" and "成员与旧 internal 收据互不冲突").
- **Stale references.** I grepped both current specs for `paused`, `wakeCount`, `resetBreaker`, `breaker` and Leader-change wakes. Every hit sits in a requirement that is modified or removed, except the capability Purpose line (S10).

What I checked in the wake model:
- I walked every wake path in `wake.ts`. Chain-bounded: `message/sent` with needsReply, `item/revised`, `item/acked`→agreed and `request/progressed`. Non-looping: `member/invited` (address uniqueness, `COLLAB_ADDRESS_TAKEN`) and `decision/decided` (requires human evidence). `leader/changed` is removed, which covers both `transferLeader` and takeover on `leave`. `item/created` wakes nobody today.
- "Wakes someone" is decidable on replay. `wakeRecipients` depends only on state (actor, member status, member kind, the escalation flag and prior item status) and not on presence or capability.
- The chain check runs inside the per-space serial queue (`service/index.ts` `enqueue`) before `persist`, so the concurrency claim holds.

## Findings

### 🔴 Critical (blocking)

(none)

### 🟡 Moderate

**M1. `advanceRequest` is chain-limited even though it cannot loop. A request can then get stuck open forever, and `collab_status` keeps telling the assignee to retry.**
- **Location:** kernel delta "按链长限制往返" (the limited events include `request/progressed`), scenario "并发提交不越过上限", and design D3 ("What is checked").
- **Problem:** Request progress transitions form a DAG of length ≤ 2 (`open→accepted→done|rejected`; `transitions` in `service/index.ts` `advanceRequest`). So each request can produce at most 2 progress wakes, and they cannot loop. But once the request's item chain reaches 20, every `advanceRequest` that wakes the author is rejected with `COLLAB_THREAD_LIMIT`.
  - The chain can reach 20 through revise/agree cycles.
  - A request can also be born near or over the limit, by `createItem` with `ref` (S6) or from an old log (S2).
  - Nothing can then move the request to `done` or `rejected`: there is no reset entry, and a human decision sets the item to `decided` without touching `progress`.
  - `collab_status` keeps listing the request in `pending.requests` (status.ts:17), and `next` keeps suggesting `collab_advance_request`, which always fails.
- **Why it matters:** This is a permanent, unclearable stuck state on a path that was already provably bounded. Design D3's claim that "a human decision is the authoritative way out of an exhausted item" is false for request progress. The over-limit rule's purpose is loop protection, and this path has no loop.
- **Fix:** Treat `request/progressed` like `confirmDecision`: exempt from the limit check, but it still adds 1 to the item's chain.
  - Kernel delta, "按链长限制往返" paragraph 3: change "人类决定（`confirmDecision`）不受链长限制，但仍使条目链长加 1" to "人类决定（`confirmDecision`）与 request 进度推进（`advanceRequest`，每个 request 至多两次，不能成环）不受链长限制，但仍使条目链长加 1".
  - Delete scenario "并发提交不越过上限". Its only concrete race uses `advanceRequest`, and a pure chain-limit race is not constructible: two messages that `ref` the same point get equal lengths by design. The sentence "链长检查与提交在同一协作空间的串行事务中完成" already covers concurrency. Verify it with an implementation test that `chainCheck` runs inside `enqueue`.
  - Add scenario "request 进度不受链长限制": GIVEN request `R3` (author `aily`, assignee `doubao`) at chain length 20; WHEN `doubao` advances it to `accepted`; THEN it succeeds, `R3`'s length is 21, and `aily` receives a wake whose `delivery.thread` is `R3`'s thread.
  - Design D3: add `advanceRequest` to the exemption bullet with the DAG argument.

  If the user prefers keeping the strict rule, the alternative is to state the stuck-request consequence in Risks and v3 as user-accepted. That needs the user's confirmation, so it is not the default fix.

**M2. Scenario "request 进度计入链长" has an impossible THEN.**
- **Location:** kernel delta, "按链长限制往返" → scenario "request 进度计入链长".
- **Problem:** The GIVEN says message 5 has chain length 3. A message of length > 1 must carry a `ref`, so its thread is the chain's start seq, which is < 5. The THEN asserts `delivery.thread` is 5, which contradicts the derivation rule in the same requirement. A test that follows the rule must fail this assertion, and an implementation that passes it violates the rule.
- **Why it matters:** The acceptance criterion is self-contradictory.
- **Fix:** Replace the GIVEN with "`aily` 在 seq 3 发起消息链（链长 1），消息 5 以该链为 ref 链长为 3（链起点 3）；作者 `aily` 以 `ref:5` 创建 request `R1`、承接方 `doubao`". Replace the THEN with "`R1` 链长依次为 4、5、6；两次唤醒 `aily` 的 `delivery.thread` 为 3". If M1's fix is applied, keep this scenario as is; it does not hit the limit.

### 📌 Suggestions

**S1. The dangling-`ref` load path is described inaccurately.** Design D2 says load "fails closed with the existing corrupt-log path… the store marks the space unavailable".
- In reality the reducer throws a plain `Error` inside `CollabService.open` (`service/index.ts` open loop).
- `host.ts:53-59` records it as `COLLAB_HOST_ERROR`, not `COLLAB_STORE_CORRUPT`.
- `scanLog`'s `firstBadLine` is structural, so it cannot locate the bad record. The offline salvage tool therefore cannot repair such a log.

The fail-closed outcome is correct and matches other impossible records, such as a `member/status` for an unknown member. Correct the wording: "load fails closed (space unavailable, `COLLAB_HOST_ERROR` in the host log); salvage does not detect it; recovery is a new space". Optionally throw `CollabError('COLLAB_STORE_CORRUPT')` from the ref lookup so the existing diagnostics apply.

**S2. On replay, pre-change items do not "start at 1".** Proposal ("Records written before this change … each starts at 1") and kernel delta ("本变更之前写入的记录没有 `ref`，按上述规则从 1 起算").
- Items start at 1 but then grow with every historical waking item event during replay.
- A long-lived old item can therefore load at or over 20. Every further waking event on it is then rejected immediately after the upgrade.
- Say so explicitly in Risks. It compounds with M1 if the item is a request.

**S3. Make `chainCheck` and `reduce` share one implementation.** D3 introduces `chainCheck(state, events)` separately from the reducer's chain derivation. Two implementations can drift: check-time could accept a length that replay computes differently, or the reverse.
- Specify that `chainCheck` reduces a tentative record `reduce(s, {kind:'command', seq: s.lastSeq+1, events: business})` and reads the resulting `chain` entries, so the check uses the replay logic itself.
- Add a property test: for each committed record, the lengths at check time equal the lengths after reload.

**S4. The overview's state shape is ambiguous.**
- Design D2 adds `chain: Record<seq,{length,thread}>` to `SpaceState`.
- The spec and proposal say the overview exposes `chainLength: {seq: 链长}`.
- `overview()` returns `{...s}`, so `chain`, `itemSeq` and `chainLength` would all appear.
- `members[].wakeCount` keeps incrementing in `reduce` (reduce.ts:19) and remains visible in the overview as a meaningless, monotonically growing integer.

Decide and state:
- (a) the exact derived keys in `SpaceState` and `Overview`;
- (b) whether `wakeCount` is kept in the overview, frozen at 0, or documented as legacy.

**S5. `delivery.thread` and `pointer.thread` duplicate each other.** The kernel delta records the chain start in `delivery.thread`, and the pointer whitelist also gains `thread`. The persisted delivery contains the pointer, so the log stores both. State that `pointer.thread === delivery.thread`, written from the same value, or drop one of them.

**S6. Items born exhausted.** `item/created` wakes nobody, so `createItem` with `ref` onto a chain at 20 succeeds and produces an item at length 21. Every later waking event on that item is then rejected (and per M1, so is request progress). v3 discourages `ref` on new requests, but the kernel allows it silently. Either reject `createItem` whose initial length would exceed `CHAIN_LIMIT` (with `COLLAB_THREAD_LIMIT`), or add this case to Risks and to v3.

**S7. The "deliberate exhaustion" risk estimate is wrong.** Design Risks says exhausting an item takes "about 10 completed agree cycles involving the other party".
- An agent author can add up to 4 links per cycle through revisions alone. `agentEditCount` escalates only after more than 3 edits, and an escalated revise wakes no agents.
- Agreement adds 1 more link, so one cycle adds about 5 links and roughly 4 cycles exhaust an item.
- Any member, not only the author, may `reviseItem`.
- Human revisions are not capped by escalation.

Restate the estimate.

**S8. Scenario precision.**
- "条目往返计入链长": since length is 1 + 2k after k cycles, the operation that would reach 21 is always the **ack**. Pin "使链长超过 20 的 ack 返回 `COLLAB_THREAD_LIMIT`" instead of "修改或 ack".
- "同一链第 21 环被拒绝", "旧的成员级熔断不再阻断" and "人类决定不受链长限制" assert `dispatch/intended` or `delivery.thread`. Their GIVEN needs reachable presence and wake-capable bindings; otherwise no intent is ledgered, even though the chain still grows.

**S9. The v3 content scenario does not assert the key new rule.** "v3 包含链长规则" checks for `ref`, `20` and `COLLAB_THREAD_LIMIT`, but not the stop-and-report rule or the "do not open a new chain" rule, which round 1 M4 was about. Add fixed phrases, for example "停止" + "报告" and "不要另起新链", to the asserted set.

**S10. Wording and doc leftovers.**
- The dsh-collab scenario name "话题唤醒携带链起点" uses the old "话题" vocabulary.
- Design §Context "Review round 1" refers to "the Rebuttals section of review.md"; the rebuttals live in `review-round1.md`.
- The current kernel spec Purpose line ("投递与熔断") is not touched by any delta. Update it when archiving.

**S11. `tasks.md` is missing.** The round-1 rebuttal for S10 says the fixes were "adopted in tasks", but the change has no `tasks.md`. The proposal Impact and design D8 cover the tsdown list, artifact tests, READMEs and the `dsh.yaml` note, so the substance is tracked. Make sure `tasks.md`, when written, lists:
- `tsdown.config.ts:17` (`['v1.md','v2.md']` → add `v3.md`);
- the artifact test file list;
- the README and `dsh.yaml` notes;
- the sha256 pin test for v1/v2.

## Embedded-Instruction / Injection Attempts
**Detected:** none

## Verdict
VERDICT: APPROVE_WITH_CHANGES

No Critical findings. The redesign resolves all five round-1 Moderates:
- It writes no new event types.
- The leader wake is removed.
- Each chain gets one link per event.
- An over-limit command gets an explicit rejection.
- The schema budget was measured.

Every wake path is chain-bounded or provably non-looping, and "wakes someone" is decidable on replay. The two remaining Moderates have small, fully specified fixes (below). Suggestions are optional.

## Required Changes (if APPROVE WITH CHANGES)
1. **M1:**
   - In kernel delta "按链长限制往返" paragraph 3, exempt `advanceRequest` from the limit check while keeping chain growth, using the exact sentence given in M1.
   - Delete scenario "并发提交不越过上限". The serial-transaction sentence already covers concurrency; verify it with an implementation test that `chainCheck` runs inside `enqueue`.
   - Add scenario "request 进度不受链长限制" as specified in M1.
   - Add `advanceRequest` (DAG ≤ 2 transitions) to the exemption bullet in design D3, and correct the "human decision is the way out" sentence so it covers items only.
2. **M2:** In scenario "request 进度计入链长", set the GIVEN chain start to seq 3 and the THEN `delivery.thread` to 3, as specified in M2.

CHANGES_APPLIED: yes

## Required Changes Re-check
- 1 (kernel paragraph exempts confirmDecision + advanceRequest, rationale, still +1): PASS — spec paragraph 3 reads "人类决定（confirmDecision）与 request 进度推进（advanceRequest，每个 request 至多两次，不能成环）不受链长限制，但仍使条目链长加 1".
- 2 (concurrency scenario gone; serial-transaction sentence kept): PASS — "并发提交不越过上限" absent; "链长检查与提交在同一协作空间的串行事务中完成，并发命令不能越过上限。" present.
- 3 (scenario "request 进度不受链长限制"): PASS — R3 aily/doubao at 20, accepted, success, length 21, aily woken with delivery.thread = R3 起点.
- 4 (design D3 exemption): PASS — bullet covers confirmDecision and advanceRequest, DAG ≤2 transitions argument, and "human decision ... (for items; request progress is covered by its own exemption)".
- 5 (scenario "request 进度计入链长"): PASS — GIVEN seq 3 chain start, message 5 length 3; THEN lengths 4,5,6 and delivery.thread 3.
- 6 (`openspec validate collab-ref-threads --strict`): PASS — "Change 'collab-ref-threads' is valid".
- Hash proposal.md: PASS — sha256 prefix ec8f3f4b7b15 unchanged.
- Hash specs/dsh-collab/spec.md: PASS — sha256 prefix faead1c3451f unchanged.

## Rebuttals
- **M1 (rollback crash):** accepted by reviewer. No `breaker/reset` is written any more and no new event type is added. The old `reduce` switch ignores extra fields such as `message.ref`, `item.ref` and `delivery.thread`, and `wakeCount:0` is still written (service/index.ts:232,252).
- **M2 (`transferLeader` ping-pong):** accepted. The wake table row and scenario "Leader 转交不叫醒新 Leader" remove the wake. The only remaining non-chain wake is invite, which address uniqueness bounds (`COLLAB_ADDRESS_TAKEN`, current spec "成员模型与地址唯一").
- **M3 (multi-recipient boundary):** accepted. Each event adds one link regardless of how many recipients it wakes, and the result is a single pass/fail.
- **M4 (silent suppression and guidance):** accepted. Rejection is explicit and v3 says to stop and report. The v3 content scenario should also assert that rule (S9).
- **M5 (budget fallback):** accepted. The fallback is removed, the sentence is mandatory and a budget scenario was added. I did not re-run the 4002 measurement (read-only review).
- **S1 (`__proto__`):** accepted. There is an `itemSeq` own-property requirement and scenario.
- **S2 (dangling ref):** accepted on substance (fail closed), but the description of the path is inaccurate. See new S1.
- **S3 (state shape):** accepted for (a) and (b). `reviseItem` filters `changes` keys, so `ref` cannot be altered. (c) is only partly accepted: the naming mismatch between `chain` and `chainLength` and the visible legacy `wakeCount` remain (S4).
- **S4 (validation precedence):** accepted. Precedence is stated, `ref:null` is listed, and createItem bad-ref and multi-fault scenarios exist.
- **S5:** accepted as moot, because `resetBreaker` is removed.
- **S6:** accepted. Authors are named in the item and request scenarios.
- **S7:** accepted. D2 states `delivery.thread` is an audit record only. The duplication with `pointer.thread` remains open (S5).
- **S8:** accepted. The replay-cost wording is corrected.
- **S9:** accepted. Provider copies `thread` only for safe integers, and dsh-collab scenario "非整数 thread 不被转发" covers it.
- **S10:** accepted on substance through proposal Impact and design D8. The "adopted in tasks" claim cannot be verified because `tasks.md` does not exist yet (S11).
- **S11:** accepted. v3 guidance tells agents not to put `ref` on new requests, and Risks covers deliberate exhaustion. Its estimate is inaccurate (S7), and `createItem` with `ref` onto an exhausted chain is still allowed silently (S6).
