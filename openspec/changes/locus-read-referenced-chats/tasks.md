## 0. Platform probes (gate: stop and go back to design if a result does not match)

- [ ] 0.1 Merge-forward probe: the owner merge-forwards a set of chat records containing a video into the test group. Read the outer message raw as the bot, and run `+messages-mget` on it. Record whether child messages are attached, the `upper_message_id`, `chat_id`, and resource key fields, and whether downloading via the outer id works. Turn the result into a redacted fixture and record it in design.md Context. If it does not match D4, stop, update the design, and send it for a new review.
- [x] 0.2 Message-link fixture: redact the 2026-11-12 `message_links/query` response and the raw-read response into a fixture, including the 99991672 error envelope.
- [x] 0.3 Backfill the existing test names for the 🟡 rows in test-plan.

## 1. Link extraction

- [x] 1.1 Write failing tests: `extracts, dedupes and numbers links from text and post href`, `rejects foreign host, userinfo, http and empty or duplicate token`
- [x] 1.2 Implement `locus/message-link.ts` (WHATWG URL check, host allowlist, at most 10 links, raw body and formatted text adapters) so 1.1 passes
- [x] 1.3 Refactor; full suite stays green

## 2. Merge-forward expansion and overall budget (media.ts)

- [ ] 2.1 Write failing tests: the four tests in locus-media-merge.test.ts and the three in locus-media-budget.test.ts
- [ ] 2.2 Implement: change `singleItem` to accept merge-forward children; download child resources via the outer id; add a shared per-call budget (12 attempts, 90 s AbortSignal, 16 000 chars) so 2.1 passes
- [ ] 2.3 Refactor; full suite stays green, including the existing media/video tests

## 3. `pet_locus_linked_message`

- [x] 3.1 Write failing tests: all locus-linked-message-tool.test.ts entries
- [x] 3.2 Implement: `readLinkedMessage` in media.ts (read the source message raw → extract → `message_links/query` → read the target raw → existing single-message flow) and `locus-linked-message-tool.ts` (JSON plus Unicode-escaped data block, caller re-verification) so 3.1 passes
- [x] 3.3 Refactor; full suite stays green
      - 2026-11-13：链接路径已实现并转绿（11 条）。链接目标为合并转发时的展开，以及整体工作预算，随第 2 组一起实现。

## 4. Assembly, guidance, and history

- [x] 4.1 Write failing tests: the runtime publication matrix, the doc-entrance exclusion, the guidance/prompt tests in locus-context.test.ts, and the two new history tests
- [x] 4.2 Implement: `selectLocusEntryReadTools` publishes both tools; update `message-guidance.ts` and `context.ts`; extend the `locus-history-tool.ts` id rule; update the caller-bound allowlist and output schema (see pitfalls §16) so 4.1 passes
- [x] 4.3 Refactor; full suite stays green
      - 2026-11-13：dsh-pet typecheck 通过，全量 3357 通过 / 4 跳过 / 0 失败。`plain text line without link gets no id` 写下时即为绿（守卫性测试，防止新规则误匹配）。按设计同步修订了两条守卫：`executor-scope.test.ts` 注册计数 12→13，`locus-composition.test.ts` 的 allowlist 列表加入新工具；旧测试 `the description states that message links are unresolvable` 随指引语义变更改为 `the description points message links to pet_locus_linked_message`。

## 5. Verification and delivery

- [ ] 5.1 dsh-pet `npm run typecheck` and `npm test`; repo root `npm test`, `npm run check:artifacts`, and `openspec validate locus-read-referenced-chats --strict`; every test-plan row 🟢
- [ ] 5.2 Update the dsh-pet README (Chinese and English): the link-reading capability, the `im:message.message_link:read` permission, and the risk notes; record the snapshot-key 234003 pitfall in pitfalls
- [ ] 5.3 Real-device acceptance (owner-authorized test group): a link to a group the bot is in (video), a link to a group the bot is not in (`link-unauthorized`), a merge-forward containing a video, and a link to a plain-text message
- [ ] 5.4 Write the verify artifact
