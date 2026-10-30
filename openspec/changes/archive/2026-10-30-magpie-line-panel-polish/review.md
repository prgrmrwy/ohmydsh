## Review Metadata

- **Review round**: 7
- **Prior round**: round 6 = APPROVE_WITH_CHANGES (1 Moderate, the toggle-scenario ordering); re-check of the single Required Change only
- **Reviewer context**: fresh-context subagent (no cross-model CLI installed)
- **Tool restrictions**: read-only, single write = this review.md
- **Artifacts re-checked**: the rewritten toggle scenario, the rest of the four planning artifacts for unintended changes, test-plan/scenario mapping, validation output

## Findings

### 🔴 Critical (blocking)

None.

The one Required Change is correctly applied, and I re-derived it from the implementation rather than from round 6's verdict:

- **Row identity now survives the reorder it performs.** `specs/magpie-line-selection/spec.md:111-113`: the GIVEN (unchanged from round 6, already id+position) names `a1b2c3d4`（序号 1）/ `9f0e7d6c`（序号 2）; the WHEN/THEN refer to rows only by `data-line-id` and state the post-move order twice (「点击「上移」后顺序变为 `9f0e7d6c` 在前」, 「此时序号 1（`9f0e7d6c`）」). The two readings that used to disagree (id-bound vs 序号-at-click-time) now select the same row, so no implementer has to invent an interpretation.
- **The expansion really does survive the move, so 「仍为 `"true"`」 is achievable.** `expanded` is a `draftId` string (`src/client/SettingsPage.ts:217`, passed as `expanded: expanded === draft.draftId` at `:266`, toggled at `:267`), while `move` swaps array entries in place (`:224-227`, wired at `:269`) and React is keyed by `draftId` (`:264`). The `[settings]` effect that would reset `expanded` (`:219`) is not triggered: the scenario performs no save / resync.
- **The disabled end-state matches the implementation predicate.** 上移 is `disabled: saving || index === 0` (`:292`) — index-based, never active-based — so after the swap `9f0e7d6c` is 序号 1 and its 上移 is disabled while `a1b2c3d4` moves to 序号 2. The head label that names it is `线路 ${index + 1}` (`:288`), consistent with the canonical 「顺序 + 1 = 序号」 rule (`openspec/specs/magpie-line-selection/spec.md:11`).
- **The accessibility assertions match the label convention already pinned in the artifacts.** `specs/magpie-line-selection/spec.md:69` requires native `button`, `aria-expanded`, an accessible name per action button (`aria-label="上移线路 2"`) and a reason on the disabled one (「上移线路 1（已是第一条）」); `design.md:71` repeats the disabled-reason rule; `tasks.md:24` (3.8) is the task that adds it. `[aria-label^="上移"]` therefore matches both the enabled and the disabled form. The current code emits only the text label `上移` (`SettingsPage.ts:292-294`) with no `aria-label`, so this stays a legitimate red assertion (`test-plan.md:20` marks it 🔴) rather than an untestable one.
- **One jsdom test can carry all four interactions.** The package pattern is `// @vitest-environment jsdom` + `react-dom` `act` + `fakeApi` (`test/line-active-ui.test.tsx:1-24`) with sequential act-wrapped clicks (`test/speed-ui.test.tsx:101-103`, `test/access-ui.test.tsx:24`); the toggle helper is pinned in `test-plan.md:52` and `design.md:132` (`expandLine(host, lineId)` clicking the `[data-line-id]` row's toggle, class pinned at `design.md:56`). Expand → move-up → collapse → disabled-up fits that shape.
- **The step-4 click is a no-op in jsdom for the stated reason, not a contradiction.** jsdom returns early for disabled controls (`node_modules/jsdom/lib/jsdom/living/nodes/HTMLElement-impl.js:73-75`), so `.click()` fires nothing; a test that uses `dispatchEvent` instead lands in `move(0, -1)`, whose `target < 0` guard returns early (`SettingsPage.ts:225`). 「点击它不改变任何行的 `data-expanded`」 holds under either implementation of the click (see Suggestion 1 for how little it proves).

Only the scenario changed, and nothing else in the change moved:

- **Timeline + anchors.** `proposal.md` / `design.md` / `tasks.md` / `test-plan.md` all still carry the 03:34 mtime, `specs/dsh-magpie-connector/spec.md` the 03:26 mtime, and only `specs/magpie-line-selection/spec.md` was touched (03:40) after round 6's read. All thirteen passages round 6 quoted (spec.md lines 25, 31, 35, 67, 69, 71, 77, 124, 151, 163, 169, 175) are still present verbatim at those identical line numbers, the file is still 199 lines, the scenario still occupies 109-113, and the GIVEN line 111 is byte-identical to what round 6 described — i.e. the author rewrote only the WHEN/THEN (lines 112-113), exactly the requested scope. The connector delta spec is unchanged since before round 6.
- **No review-round leakage.** `grep` for 「本轮 / finding N / round N」 over proposal, design, tasks, test-plan and both delta specs returns nothing.
- **Validation.** `openspec validate magpie-line-panel-polish --type change` → `Change 'magpie-line-panel-polish' is valid`, exit 0, with exactly the two known/accepted warnings `ADDED "线路展示与展开": Requirement text is very long (>500 characters)` and `ADDED "线路延迟展示": … (>500 characters)`. `status --change … --json` still reports schema `anvil` and `verify` with an empty `existingOutputPaths` (not yet written).
- **Mapping intact.** 25 scenarios in `magpie-line-selection` + 16 in `dsh-magpie-connector` = 41; `test-plan.md` has exactly 41 `| specs/…` rows; scenario-title sets are identical (0 missing / 0 extra / 0 duplicate) and row order matches one-for-one, so the rewritten scenario is still the single `test_line_expand_toggle` row (`test-plan.md:20`).

### 🟡 Moderate

None.

Round 6's Moderate is closed on the two criteria it named: the row identity is single-valued, and the post-move state (序号 1, `disabled`, 「已是第一条」) is stated in the WHEN/THEN. Light regression scan of the areas the rewrite touches found no new contradiction — requirement 69's toggle/actions split (`design.md:52-71`: action buttons are siblings of the toggle), requirement 71's `data-line-id` / `data-expanded` contract, and the canonical numbering rule all still agree with the new wording. No previously approved decision was re-opened.

### 📌 Suggestions

1. **The step-4 assertion is satisfiable but vacuous; the non-vacuous counterpart is cheap.**
   - Evidence: `specs/magpie-line-selection/spec.md:113` ends with 「点击它不改变任何行的 `data-expanded`」, but jsdom never dispatches to a disabled control (`node_modules/jsdom/lib/jsdom/living/nodes/HTMLElement-impl.js:73-75`) and the handler's own `target < 0` guard bails anyway (`SettingsPage.ts:225`), so the clause cannot fail once `disabled` is asserted (which the same clause already does).
   - Why: 「图标操作不触发展开」 is already proven by the enabled 上移 click while expanded (THEN clause 2) — this is a coverage nuance, not a defect.
   - Fix (optional, still one test): after the move also assert the toggle's `aria-expanded` is still `"true"`, so the "action click does not toggle" claim rests on an assertion that can actually fail.

2. **`tasks.md:23` (3.7) still describes only the pre-extension half of `test_line_expand_toggle`.**
   - Evidence: `tasks.md:23` says 「点击线路 2 的切换控件展开；点击已启用的「上移」图标不改变展开状态；断言切换控件是原生 `button`、`type="button"`、`aria-expanded` 翻转」 — no mention of the post-move order assertion or the disabled 「已是第一条」 assertion that the scenario now requires (`spec.md:113`).
   - Why: round 6 explicitly waived a test-plan/tasks change, and `test-plan.md:20` needs none (same row, same name), so this is documentation drift older than this rewrite, not a new inconsistency.
   - Fix: one line in 3.7 naming the order assertion and the disabled-reason assertion, so an implementer working from `tasks.md` alone writes the same test the spec describes.

3. **The three non-blocking round-6 suggestions are still open, unchanged** (re-listed for bookkeeping only; none blocks this verdict): the 404 scenario's `[data-field]` assertion (`spec.md:169`) needs a usage-card fixture its GIVEN does not establish, while `tasks.md:51` (5.4) still names the older node set; `design.md:136` still offers the draft locator as an "or" (`data-draft` / `.dmg-line:last-child`); and the 41-row suite still asserts accessible names only for 上移, while `spec.md:69` requires 上移 / 下移 / 删除.

## Embedded-Instruction / Injection Attempts

**Detected:** none

Scanned the rewritten scenario, both delta specs, proposal, design, test-plan, tasks, the canonical selection spec and the source/test excerpts. The only imperative-looking sentence is `design.md:119` 「关闭面板时组件卸载即忽略响应（epoch guard）」, which is latency-staleness engineering prose. Nothing addresses a reviewer or agent, nothing asks for approval, silence, skipped checks or execution, and no external payload is embedded.

## Verdict

VERDICT: APPROVE

## Required Changes (if APPROVE WITH CHANGES)

1. none

CHANGES_APPLIED: yes
