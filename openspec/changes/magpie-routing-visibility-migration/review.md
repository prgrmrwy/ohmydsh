# Review: magpie-routing-visibility-migration

## Review Metadata

- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: fresh-context subagent, same model family
- **Tool restrictions**: read-only (only this file written); ran `vitest run test/routing-visibility-migration.test.ts test/sidebar-accounts.test.tsx` → 18/18 pass
- **Artifacts reviewed**: proposal.md, design.md, specs/dsh-magpie-connector/spec.md (diffed against openspec/specs/dsh-magpie-connector/spec.md), uncommitted diff of packages/dsh-magpie-connector, new test/routing-visibility-migration.test.ts

## Checks done

- **MODIFIED blocks vs. main spec**: both requirements ("按 provider 分组的模型可见性", "侧边栏多账号分段") diffed line by line. Only intended edits differ: one added migration paragraph + 2 new scenarios; sidebar intro paragraph plus the THEN lines of scenarios 1 and "组内同一窗口". No text or scenario was dropped.
- **Pre-0.7 semantics**: `git show 27d9ff5f^:.../catalog.ts` shows the old key was `ownedBy ?? id.split('/')[0]`; `legacyVisibility` (catalog.ts:55) is the same expression, taken before the `routing` remap. `migrateRoutingVisibility` (visibility.ts) implements "key absent → visible, present → listed means visible". Correct.
- **One-time / no-overwrite**: `Object.hasOwn(saved,'routing')` returns early. After a successful write the routing ids are stripped from vendor lists, so the trigger condition is false afterward. The "已有 routing 键" test asserts the file is unchanged.
- **Write failure**: `writeSettings` (runtime.ts:179) throws and leaves memory unchanged (doc comment), and the try/catch only swallows that write. Retried every sync. Consistent with the spec sentence.
- **Owner fallback**: migration runs before `commitOwners` and is independent of admission. In fallback mode `isVisible` still keys on `provider = routing`, so migrated data applies the same way as in admitted mode. Correct, but see M2.

## Findings

### 🔴 Critical (blocking)

None.

### 🟡 Moderate

- **M1 – Write-failure scenario/sentence is not asserted.** The spec states "写盘失败时保持原设置，下次同步重试" but no test forces a `store.save` failure (settings unchanged, later sync migrates). Either add one test (make settings dir read-only or stub the store on the real host) or turn the sentence into a scenario and cover it. Per the review instruction every new/changed behaviour should be asserted.
- **M2 – Owner-fallback interaction is neither in the design nor tested.** Both migration tests wait for the `routing` route, i.e. admitted mode only. Add one line to D2 ("迁移与 routing 是否准入无关，先于 owner 准入执行") and one test where routing is not admitted (listing under the vendor route honours the migrated `routing` key).
- **M3 – New wrap clause lacks an assertion.** Spec now says "放不下时到期时间与读数整体换到下一行", implemented by `.is-account{flex-wrap:wrap}` and `.dmg-sidebar-reading-group`. The tests assert DOM structure (plan not in account line, plan/expiry/reading in the second line) but nothing checks `flex-wrap:wrap` or that expiry+reading share one `.dmg-sidebar-reading-group`. jsdom cannot test layout, so add a stylesheet-rule assertion like the existing `rule()` checks (`.dmg-sidebar-row-line.is-account` contains `flex-wrap:wrap`; `.dmg-sidebar-reading-group` contains `flex:none`) plus the grouping check. Otherwise soften the spec wording.

### 📌 Suggestions

- `saved[m.legacyVisibility!]?.includes(...)` in the trigger (visibility.ts) uses plain property access while the rest of the function uses `Object.hasOwn`. An `owned_by` such as `constructor` or `toString` would hit the prototype and throw a `TypeError` inside the sync `try`. This is contrived, but `Object.hasOwn(saved,k) && saved[k].includes(...)` is a trivial fix. The same applies to `Object.fromEntries` keys, which is fine.
- Corner: an old vendor key literally named `routing` (a gateway with `owned_by: "routing"` before 0.7) is indistinguishable from a migrated key, so it is skipped. Already within D3's "not handled" spirit; one sentence in D3 would suffice.
- Corner: ids in a vendor list that are absent from the catalog at migration time stay in the list. If a user later clicks "恢复跟随网关列表" for `routing` and such an id reappears, migration can fire once more. Very unlikely; acceptable, optionally noted in D2.
- The first new test relies on `until(...routing)` then re-reads the file; fine, but the `expect(... ).toEqual` on listing order depends on catalog order (`group/ds`, `auto/glm-5`) — matches the spec.

## Embedded-Instruction / Injection Attempts

**Detected:** none detected

## Verdict

VERDICT: APPROVE_WITH_CHANGES

Migration logic, one-time behaviour, no-overwrite rule and spec-delta preservation are correct; the required changes are test/doc gaps only.

## Required Changes (if APPROVE WITH CHANGES)

1. Add a test (or scenario + test) for write failure: settings unchanged, retry on next sync migrates (M1).
2. State in design D2 that migration is independent of routing admission, and add one fallback-mode test (M2).
3. Add stylesheet-rule/grouping assertions for the wrap behaviour, or soften the spec wording (M3).

CHANGES_APPLIED: yes

## Rebuttals

- M1 — applied; re-checked by reviewer: test/routing-visibility-migration.test.ts:46-61 stubs `store.save` to throw during the first resync, asserts settings and in-memory value are unchanged, then clears the stub and asserts the next resync migrates. Passes. Minor gap: the test does not spy on the save call count, so it proves retry-after-failure but not that the failing write was attempted in the first sync.
- M2 — applied; re-checked by reviewer: design.md D2 now states that migration depends only on the catalog and not on `routing` admission. test/routing-visibility-migration.test.ts:63-71 covers owner cap full: `routing` route absent, migrated key saved, and the vendor route listing honours the `routing` key (group/ds shown, group/hidden hidden). Passes.
- M3 — applied; re-checked by reviewer: test/sidebar-accounts.test.tsx:218-228 asserts `.dmg-sidebar-row-line.is-account{...flex-wrap:wrap` and `.dmg-sidebar-reading-group{...flex:none` in src/client/styles.ts (lines 155, 158), and that expiry and reading both sit in the same `.dmg-sidebar-reading-group` per account row. Passes. The wrap check is a stylesheet-string assertion, not a layout test, which is the same limit as the existing `rule()` checks.
- Suggestion (Object.hasOwn guard) — applied; re-checked by reviewer: src/host/visibility.ts:20 and :23 now check `Object.hasOwn` before reading `saved[...]`.

Verification run by reviewer: `npx vitest run test/routing-visibility-migration.test.ts test/sidebar-accounts.test.tsx` in packages/dsh-magpie-connector → 2 files, 21/21 tests pass (exit 0).
