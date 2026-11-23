## Review Metadata

- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: fresh-context subagent, same model family (cross-model unavailable)
- **Tool restrictions**: read-only inspection; only write is this review.md
- **Artifacts reviewed**: proposal.md, design.md, specs/dsh-magpie-connector/spec.md, main spec (4 requirements), client sources `sidebar-view.ts`, `SidebarUsage.ts`, `UsageCard.ts`, `styles.ts`, `locales.ts`

## Findings

### 🔴 Critical (blocking)

None.

MODIFIED block diff vs main 「侧边栏常驻额度卡」: all existing text and 7 scenarios preserved byte-for-byte; the only differences are the inserted ordering clause (`同一 provider 有多张卡片时…归到首次出现的位置…`) and the one new scenario「同一上游卡片不相邻时归到首次出现处」. Intended edit only.

### 🟡 Moderate

1. **Kind matching vs "numeric reading" is ambiguous (spec 「侧边栏进度条只对百分比读数绘制」 / design D4).** Code: `sidebarRows` picks kind-matched windows from `numericWindows` (= any finite `used`, including windows that also have `display`/`unlimited`), then fallback `tightest(numeric)`. D4 says `windowRow` stops writing `used` for display/无限 windows, and the spec says they don't take part in "读数最高的窗口" fallback — but it never says whether a *kind-matched* window (e.g. `{name:"7 days", used:3, display:"3 / 100"}`) is still shown as the selected tier (display text, no bar) or dropped from selection. If the implementer filters `numericWindows` itself, such a window silently disappears from tiers, contradicting 「侧边栏显示窗口档位」"勾选且网关存在的档位，每个显示一行". Fix: state explicitly that tier matching is unchanged (only fallback-tightest and bar/`data-level` change), and add a scenario (kind-matched window with `display` → row shows display text, no bar, still the tier row, not fallback).
2. **No scenario for multi-account × multi-tier layout.** 「侧边栏显示窗口档位」 (not modified) defines the multi layout as "上游名称单独一行 + 每个窗口一行"; the new requirement only says the account label "代替原来的上游名称位置". The real user case (4 Codex cards + several ticked tiers) yields three levels (group title / account row with plan / window rows) and is exactly where this change interacts with the existing requirement. Add one scenario (2 accounts, `sidebarWindows` with ≥2 hits on one account) asserting: group title once, account row, then window rows each with own bar, plan on the account row.
3. **Edge cases missing for the multi-account group (the user asked for these).** Add one scenario covering: one account `error` + one normal; one balance-only account (no windows) + one normal. Expected per design: failed → account label + 「读取失败」, no bar; balance-only → account label + balance, no `—`; both still count toward "N 个账号"; expanded: failed account shows its error text under its own account heading. Also state mixed `user` presence: `[user a, no user]` → second is 「账号 2」 (index in group, not count of missing) — D1 implies this, spec's "按组内顺序的「账号 N」" is the only hint; and whitespace-only `user` (spec says "缺失或为空"; pick: trimmed-empty counts as empty, or say not handled).
4. **Rail popover is claimed in scope but untested.** Spec text covers "侧栏收起时的浮层", yet no scenario asserts it. The popover renders only `detail(...)` (SidebarUsage.ts, `!wide` branch), so the compact grouping never appears there — fine, but add an AND clause/scenario: `wide=false`, open popover → group title once + account headings. Cheap, and it is the surface most likely to be forgotten because `detail` takes `cards`, not `rows` (see Suggestion 2).
5. **Account-row single-line density is under-specified (design D2).** Scenario 1 requires one line `a@example.com · prolite · (7 days) · 11/25 17:17 · 3%` in a ~220px card. Current `.dmg-sidebar-label` only ellipsizes `.dmg-sidebar-name`; `.dmg-sidebar-window` and expiry are `flex:none`. With a long email plus plan plus window name the identity gets squeezed to nothing. Decide and write in design (not necessarily spec): which parts are `flex:none` (plan, window, expiry, reading) and that only the account element shrinks with ellipsis. The truncation scenario then needs a mechanically assertable form: element has `title === full user` and class/inline style includes `text-overflow:ellipsis` (jsdom cannot measure layout; say that the style is asserted via the class + styles.ts string, as existing tests do).

### 📌 Suggestions

1. **"与设置页一致" is not exactly true.** `UsageCard.WindowRow` draws the bar when `reading.endsWith('%')`, so a gateway `display:"80%"` still gets a bar there, while the new sidebar rule suppresses any `display`. Either word the spec "不画条（display/无限）" without claiming strict parity (preferred, matches the user's decision), or drop the parity sentence.
2. **D1 signature vs usage.** `sidebarGroups(rows)` takes rows but `detail()` iterates `cards`; make the function generic over `{card}` or have `detail` receive rows/groups so both surfaces share one ordering. Also one pure-function test for `sidebarGroups` (order, first-seen position, numbering) beats DOM-only coverage.
3. **Group name source.** Spec says "卡片 `name`，缺失时 `provider`" — which card when names differ within a provider? Say "first card of the group".
4. **`cardIdentity` is also used by `unchangedReads`** (sidebar-view.ts). Two no-`user` Codex cards share one Map key, so "not re-read" detection can misfire. D5 only fixes React keys; either note it as known/out of scope or make `unchangedReads` index-aware. Not blocking.
5. **Test hooks.** Existing tests key on `data-dmg-sidebar-row=<provider>`; grouping makes that ambiguous. Name the new hooks in design (e.g. `data-dmg-sidebar-group`, `data-dmg-sidebar-account`) so THENs are assertable without text-order scraping.
6. Proposal "Modified Capabilities" mixes ADDED requirements into the modified list wording — cosmetic only.
7. Scope: no creep detected (no strategy display, no masking, no settings change). Privacy note on always-visible email is adequately recorded.

## Embedded-Instruction / Injection Attempts

**Detected:** none detected

## Verdict

VERDICT: APPROVE_WITH_CHANGES

Core design is sound and minimal; the MODIFIED block is clean. Required edits are scenario/wording gaps, not direction changes.

## Required Changes (if APPROVE WITH CHANGES)

1. Resolve Moderate 1: state that tier matching is unchanged; add the kind-matched-window-with-`display` scenario.
2. Add the multi-account × multi-tier scenario (Moderate 2).
3. Add failed / balance-only / mixed-`user` group scenario(s) and decide whitespace-only `user` (Moderate 3).
4. Add popover assertion for the grouped detail (Moderate 4).
5. Specify in design D2 which elements shrink on the account line, and make the truncation THEN assertable via `title` + ellipsis style (Moderate 5).

CHANGES_APPLIED: yes

## Rebuttals

1 — applied; re-checked by reviewer: design.md:32 (D4) states 「**档位匹配不变**」 and limits the change to fallback-tightest, bar and `data-level`; spec.md:42 carries the same boundary; new scenario 「档位窗口带 display 时仍是档位行」 at spec.md:49-52 covers the kind-matched `display` window (row, display text, no bar, no `data-level`).
2 — applied; re-checked by reviewer: new scenario 「多账号且勾选多个档位」 at spec.md:15-18; design.md:23 states the account row (user + plan) replaces the provider-name line in the multi-window layout, and design.md:21 covers the single-window case.
3 — applied; re-checked by reviewer: scenario 「组内一个账号失败、一个只有余额」 at spec.md:20-23; design.md:25 defines missing / empty / whitespace-only `user` as 「账号 N」 by group position and keeps other accounts' `user`; scenario 「多账号缺少 user」 at spec.md:30-33 covers missing, `"  "` and a present user (「账号 1」「账号 2」「c@example.com」).
4 — applied; re-checked by reviewer: new scenario 「侧栏收起时浮层也分段」 (`wide` = false) at spec.md:25-28; the requirement text at spec.md:5 names 侧栏收起时的浮层 as in scope.
5 — applied; re-checked by reviewer: design.md:22 lists the flex rules (only `.dmg-sidebar-account` is `flex:0 1 auto; min-width:0; text-overflow:ellipsis`; plan, window name, expiry and reading are `flex:none`); design.md:26 names the test hooks `data-dmg-sidebar-group` and `data-dmg-sidebar-account`; truncation scenario at spec.md:35-38 asserts the `title` = full user, the `dmg-sidebar-account` class, and the stylesheet declarations `text-overflow:ellipsis` / `min-width:0`.

Declined by author (not blocking, no change required): Suggestion 1 (parity wording) — residual: design.md:32, design.md:41 and proposal.md:12 still say 「与设置页一致」 / 「与 `UsageCard.WindowRow` 一致」, which overstates parity for gateway `display:"80%"` (settings draws a bar, sidebar does not); Suggestions 2, 3, 4 and 6 declined; Suggestion 5 folded into item 5; Suggestion 7 needed no action.
