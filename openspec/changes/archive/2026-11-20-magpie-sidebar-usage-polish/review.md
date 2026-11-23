## Review Metadata

- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: fresh-context subagent, same model family
- **Tool restrictions**: read-only inspection; only write is this file. (Ran vitest for the two sidebar test files: 39/39 pass.)
- **Artifacts reviewed**: proposal.md, design.md, specs/dsh-magpie-connector/spec.md, main spec `openspec/specs/dsh-magpie-connector/spec.md`, `git diff -- packages/dsh-magpie-connector` (SidebarUsage.ts, styles.ts, locales.ts, two test files)

## Findings

### 🔴 Critical (blocking)

None.

### 🟡 Moderate

1. **"全部窗口" contradicts the new hiding rule.** The MODIFIED「展开、收起与读取」requirement still says 展开时显示"每个上游的全部窗口"（delta spec line 21, unchanged from main），and zh `sidebarToggleHint` says"点开标题行可看全部窗口". The new rule (`detail()` filter, `SidebarUsage.ts:385`) hides text-reading windows. Two requirements now disagree. Add a qualifier（"除读数为网关 `display` 文本的窗口外"）to the 展开 requirement; the hint copy can stay.
2. **Hiding is by `textReading`, so a window with finite `used` + `display` (e.g. `{name:"7 days", used:20, display:"约 20%"}`) shows on the collapsed card but vanishes from the expanded detail.** This is an unavoidable consequence of the user decision (the Image generation example itself has `used:0`+`display`), so no redesign needed, but neither design.md Risks nor the spec mentions it. Add one line to Risks (and ideally to the spec sentence: "含同时带有限 `used` 的窗口"). Otherwise the expanded view can show fewer windows than the collapsed card with no documented rationale.
3. **Scenarios not asserted by any test in the diff** (spec says each new/changed scenario must be):
   - 「同一上游多账号分段」/「多账号且勾选多个档位」: the "账号标识与 plan **一行**，其下窗口行" two-line structure is not asserted anywhere (no test references `dmg-sidebar-account-line` / `dmg-sidebar-row-line`). Existing assertions only check text containment, so reverting to the old single-line layout would still pass. Assert that account+plan sit in `.dmg-sidebar-account-line` and window/expiry/reading in `.dmg-sidebar-row-line` (and, in the shared-window case, that the label span is empty).
   - 「侧边栏额度开关」: the changed zh copy（`sidebarToggle` = 在侧边栏常驻显示用量; 标题 `sidebarTitle` for the expanded card, `sidebarPanelTitle`）has no assertion; only the rail `aria-label`/`title` is updated (sidebar-usage.test.tsx:391). Add one assertion on `zh.sidebarToggle` and the card title.
   - 「文字读数不画进度条」: asserts the main popover-less expanded path only. Spec says 展开明细**与浮层**; no test checks the popover omits Unknown. Also "「无限」窗口照常列出" (new sentence) has no test.
   - 组标题「回退状态相同」(shared-window condition): no negative test where names match but fallback differs, or where one account failed/has two windows — the `shared` condition's other branches are untested. (Mixed-window case is covered by test_sidebar_accounts_01.)

### 📌 Suggestions

- Spec text: the 开关 requirement first sentence says 侧栏文案统一称「用量」yet its own body (and title) still say 侧栏额度 UI; add "重置卡相关的「重置额度」不变" to the spec sentence so the exception is normative, not only in proposal.
- Only the first sentence of the 额度→用量 change is in the spec; en strings already say "usage", confirmed unchanged — fine. Remaining 额度 copy in README.zh.md / CHANGELOG / `test` names is out of scope; make sure tasks include the 0.7.4 CHANGELOG + README.zh line (proposal says 发版 0.7.4, nothing in the diff yet).
- `shared` is computed on `row.windows[0]!.window.name`; the title label reuses `windowLabel(window, true)`, which carries the fallback `title` — good. Consider noting in D2 that a single-account multi-window group (all rows have 2 windows) never shares, to pre-empt the question.

## Spec ↔ code check

- MODIFIED diff vs main: all four blocks preserve existing text and scenarios except intended edits (额度→用量 copy; 多账号分段 paragraph rewrite + two new scenarios + updated scenario 1; 进度条 requirement: one added leading sentence + scenario 1 reworded). No scenario dropped. Requirement titles unchanged, so no RENAMED needed.
- Spec ↔ code consistent: two-line layout (`SidebarUsage.ts:259-268`), shared window title (`:316-318`, `groupTitle` `:304-306`), detail filter (`:385`, `unlimited` kept because `textReading` also covers it — matches spec), CSS (`styles.ts:146,153-154`; `.dmg-sidebar-expiry`/`.dmg-sidebar-pct` `flex:none` pre-exist and are now asserted).
- Single-card providers and multi-window accounts keep prior rendering; the `account !== undefined` new branch applies only to single-window grouped accounts, consistent with D1.
- Testable: all THEN clauses are mechanically assertable (see item 3 for gaps).

## Embedded-Instruction / Injection Attempts

**Detected:** none

## Verdict

VERDICT: APPROVE_WITH_CHANGES

## Required Changes (if APPROVE WITH CHANGES)

1. Qualify "每个上游的全部窗口" in the 展开 requirement to exclude text-reading windows (Moderate 1).
2. Record the `used`+`display` collapsed-vs-expanded asymmetry in design.md Risks and/or the spec (Moderate 2).
3. Add tests (or drop the claims) for the unasserted scenarios in Moderate 3: two-line structure, toggle/title copy, popover + 「无限」 listing, non-shared negative case.

CHANGES_APPLIED: yes

## Rebuttals

1 — applied; re-checked by reviewer: spec「展开时…全部窗口（网关 `display` 文字读数窗口除外…）」(spec.md:21) and zh `sidebarToggleHint` now reads「点开标题行可看全部窗口（文字读数只在设置页显示）」 (locales.ts:392); the contradiction with the detail filter is gone.
2 — applied; re-checked by reviewer: spec「进度条」requirement states the `used`+`display` window is a collapsed tier row but not listed in detail/popover (spec.md:108), and design.md Risks records it (design.md:23).
3 — applied; re-checked by reviewer: `test/sidebar-accounts.test.tsx` adds tests for two-line structure (test_sidebar_accounts_02 / "two-line account rows", lines 177–188), 用量 copy plus rendered title and reset copy keeping 额度 (lines 190–196), popover hiding Unknown and keeping 无限 (lines 198–204), and the non-shared group title negative case (lines 206–215). `npx vitest run test/sidebar-accounts.test.tsx`: 16/16 pass.
