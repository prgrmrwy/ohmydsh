## Review Metadata

- **Review round**: 6
- **Prior round**: round 5 = APPROVE (0 Critical / 0 Moderate / 8 Suggestions), all 8 applied
- **Reviewer context**: fresh-context subagent (no cross-model CLI installed)
- **Tool restrictions**: read-only, single write = this review.md
- **Artifacts reviewed**: proposal.md, design.md, specs/magpie-line-selection/spec.md, specs/dsh-magpie-connector/spec.md, test-plan.md, tasks.md, canonical openspec/specs/{magpie-line-selection,dsh-magpie-connector}/spec.md, packages/dsh-magpie-connector/src/{client/SettingsPage.ts,client/api.ts,client/UsageCard.ts,client/styles.ts,host/routes.ts,host/selection.ts}, packages/dsh-magpie-connector/test/{line-active-ui,line-silent-ui,line-transport,line-selection}.test.*, test/client-support/fake-api.ts, dsh.yaml, node_modules/@deepseek-ai/dsh-client-ui-primitives, packages/auto-model-routing build config
- **Validation**: `node …/openspec.js validate magpie-line-panel-polish --type change` → `Change 'magpie-line-panel-polish' is valid` (exit 0) with exactly the two known/accepted warnings `ADDED "线路展示与展开": Requirement text is very long (>500 characters)` and `ADDED "线路延迟展示": … (>500 characters)`. `status --change magpie-line-panel-polish --json` → schema `anvil`, `isPlanningComplete: false`, `isComplete: false`, artifacts: proposal `done`, specs `done`, design `done`, review `done`, test-plan `done`, tasks `done`, **verify `ready` (not created)**; `nextSteps` = write `verify.md`. Independent counts: 25 scenarios in `magpie-line-selection` + 16 in `dsh-magpie-connector` = 41; test-plan has exactly 41 `| specs/...` rows; scenario titles, requirement paths and row order are identical sets (0 missing / 0 extra / 0 duplicate, order match true).

## Findings

### 🔴 Critical (blocking)

None.

Re-verified the historical failure modes against ground truth rather than the prior verdicts:

- **Trust boundary holds.** `FetchRegistration.methods` is `('GET'|'POST')[]` (`src/host/routes.ts:41`), so `methods:['GET']` is expressible; the shared fetch handler dispatches only methods the route declares and otherwise 404s (`@deepseek-ai/dsh-client-connection` dispatch), which is exactly the "POST → 404 produced by the connection layer, never a plugin-local fake" wording in `specs/dsh-magpie-connector/spec.md:97`. Both exception arms stay TCP-only, credential-free, HTTP-free (`:44-47`).
- **Measurement cannot touch selection.** `runtime.config()` feeds only saved lines (`src/host/runtime.ts:511`), `probePort` is stateless (`src/host/selection.ts:29-55`), and the positive/negative caches live inside `LineSelector`; a `LatencyController` over `config()` can neither read nor write them, matching `specs/magpie-line-selection/spec.md:175`.
- **Dependency plan is executable.** Installed `@deepseek-ai/dsh-client-ui-primitives` is `0.2.0-rc.2` = `dsh.yaml:5` pin; `IconChevronUpOutlineRegular` / `IconChevronDownOutlineRegular` / `IconTrashOutlineRegular` / `IconTriangleRightFillRegular` exist in `lib/types/icons/index.d.ts`; `auto-model-routing` imports primitives at client top level without adding it to `dsh.client.inject` (`packages/auto-model-routing/src/client/index.ts:11` vs its `package.json` inject list) and aliases a stub in vitest (`vitest.config.ts:5`); `tsdown.config.ts` already has `external: [/^@deepseek-ai\//]`. The worktree's `node_modules` is a read-only cache with **no** `@deepseek-ai` at all, so `ws promote` + the vitest stub alias are genuinely mandatory as `tasks.md:3-5` state.
- **All four user constraints are still specified**: collapsed-by-default with first/new-line expansion and save-not-collapse incl. new id and reorder-before-save (`specs/magpie-line-selection/spec.md:67,91-125`, `design.md:34-50`), always-visible product icons (`:69`), one measure per panel open with `measuring` then point-in-time readings (`:127-199`, connector `:95-131`), one change under `anvil` (`.openspec.yaml`).

### 🟡 Moderate

1. **The extended toggle scenario cannot be satisfied under either row-naming convention, because the reorder it performs silently renames the rows.**
   - Evidence: `specs/magpie-line-selection/spec.md:109-113`. The GIVEN names rows by id and position (`a1b2c3d4`（序号 1）, `9f0e7d6c`（序号 2）); the WHEN expands 线路 2 and then clicks its enabled 「上移」, which in the current implementation swaps the local order immediately (`src/client/SettingsPage.ts:224-227`, wired at `:269`), so `9f0e7d6c` becomes 序号 1 and its 上移 becomes `disabled` (`:292`, `index === 0`). The next clauses then say 「再次点击线路 2 的切换控件」 and 「线路 1 折叠行上禁用的「上移」」, and the THEN asserts 「回到 `"false"`」 plus 「线路 1 的「上移」…`disabled` 且 `aria-label` 含「已是第一条」」.
   - Why it is not mechanically assertable as written: reading 「线路 N」 by the GIVEN's id assignment (the way `默认收起已配置的线路` uses ids) makes step 4 target `a1b2c3d4`, which after the swap is 序号 2 with an **enabled** 上移 → the THEN fails. Reading 「线路 N」 by the 序号 shown at click time makes step 3 target `a1b2c3d4`, which then expands → 「回到 `"false"`」 fails. There is no single consistent reading under which all four THEN clauses pass, so the implementer must invent the interpretation; a literal transcription produces a red test against correct code. This is the one gate criterion (`THEN`s mechanically assertable) that round 5's S4 extension broke.
   - Fix (one sentence): name the rows by `data-line-id` and state the resulting order, e.g. 「点击 `9f0e7d6c` 的切换控件展开它；点击其「上移」（此后 `9f0e7d6c` 为序号 1、其「上移」变为禁用，`a1b2c3d4` 为序号 2）；再次点击 `9f0e7d6c` 的切换控件后为 `"false"`；点击 `9f0e7d6c` 折叠行上禁用的「上移」…含「已是第一条」，所有行 `data-expanded` 不变」. Keeps the scenario as the single `test_line_expand_toggle` row (`test-plan.md:20`, `tasks.md:23`).

### 📌 Suggestions

1. **The 404 scenario's `[data-field]` isolation node needs a usage-card fixture that the GIVEN does not establish, and `tasks.md:51` was not updated with it.**
   - Evidence: `specs/magpie-line-selection/spec.md:169` now asserts 「两张 `[data-line-id]` 卡片、`[data-field]` 用法节点与「添加备用线路」按钮仍在」, but `data-field` exists only inside usage cards (`src/client/UsageCard.ts:10,49,52`), cards render only when the card list is non-empty (`src/client/SettingsPage.ts:382`), and the scenario GIVEN mentions only lines, no card. `tasks.md:51` (5.4) still prescribes 「两张 `[data-line-id]` 卡片与 `[aria-label="用量"]` 仍在、`data-usage-state` 不变」 for both 500 and 404 — the older node set. Note the two anchors are mutually exclusive: `.dmg-usage` returns `null` whenever the usage state is `ok` (`:161,176-177`), i.e. exactly when cards (and therefore `[data-field]`) are on screen.
   - Why: with the default `fakeApi` (unmapped `GET cards` → 404 → state `error`, `test/client-support/fake-api.ts:13`) the 404 test as literally given fails on `[data-field]`; the fix is a fixture decision, not a behavior change.
   - Fix: add 「页面上有一张用量卡片」 to the 404 GIVEN (or drop `[data-field]` there and keep `[data-line-id]` + 「添加备用线路」), and mirror that node list in `tasks.md:51`.

2. **The requirement says every line-card root carries `data-line-id`, but draft rows deliberately do not.**
   - Evidence: `specs/magpie-line-selection/spec.md:71` — 「线路卡片根元素 SHALL 带 `data-line-id` 与展开状态 `data-expanded`」; the implementation emits `'data-line-id': draft.id` and React drops the attribute when `id` is undefined (`src/client/SettingsPage.ts:286`), the measuring scenario counts exactly two `[data-line-id]` cards while an unsaved draft is on screen (`:151`), and `design.md:136` pins a *non-id* draft locator.
   - Why: as written the requirement contradicts its own scenario; an implementer could "fix" it by giving drafts synthetic ids and break the `[data-line-id]` counts.
   - Fix: 「已保存线路卡片根元素 SHALL 带 `data-line-id`；未保存草稿行 SHALL NOT 带该属性，并以 `data-draft` 定位」.

3. **`docs/internal-api.md` is referenced without its package prefix in proposal and design.**
   - Evidence: `proposal.md:32` and `design.md:124` say `docs/internal-api.md`; there is no root `docs/internal-api.md` — the file is `packages/dsh-magpie-connector/docs/internal-api.md`, which `tasks.md:67` (7.1) uses correctly.
   - Fix: use the package path in both, or write 「包内 `docs/internal-api.md`」.

4. **D9's draft locator is offered as an "or", which is not a pin.**
   - Evidence: `design.md:136` — 「用 `data-draft` 属性（新增）或 `.dmg-line:last-child` 定位」. `.dmg-line:last-child` happens to work today (`.dmg-lines` contains only cards, `src/client/SettingsPage.ts:262-271`), but it silently rots if a footer row is added inside the container, and nothing in `tasks.md` says which hook to add.
   - Fix: pick `data-draft` (it is already the S5 wording) and name it in tasks 3.5/6.4; keep `.dmg-line:last-child` out.

5. **S6's "each action button has an accessible name" is only asserted for 上移.**
   - Evidence: `specs/magpie-line-selection/spec.md:69` requires accessible names for 上移 / 下移 / 删除 plus reasons on disabled ones, but the only assertions are `[aria-label^="上移"]` presence and 「已是第一条」 (`:113`). A hover-only or unlabeled 下移 / 删除 regression passes all 41 mapped rows, which is half of user constraint (2).
   - Fix: in the same `test_line_expand_toggle`, assert all three `aria-label`s on a collapsed row and one more disabled reason (last row's 下移, or the single-line 删除 case). Visual-only "always rendered, not hover-gated" stays in `verify.md`.

## S1–S8 Verification

- ✅ **S1 — bookkeeping.** `proposal.md:24` now lists **修改**「自动选择规则」 with the narrowing rationale; `design.md:21` reads 「自动选择行为不变（仅把「SHALL NOT 探测」收窄为「为选择目的」…」; `design.md` has **zero** remaining 「本轮 review」/「finding N」 citations (`grep` over all change artifacts); `specs/magpie-line-selection/spec.md:175` quotes the live sentence 「SHALL NOT 为选择目的发起探测」, which exists verbatim at `:35`. Canonical block diff: the four canonical scenarios are textually identical to `openspec/specs/magpie-line-selection/spec.md:115-143`; the only prose deltas are the 「为选择目的」 qualifier and one appended paragraph, i.e. "wording narrowed, behavior unchanged" is true.
- ✅ **S2 — info-icon anchor.** `design.md:135` pins `.dmg-info` / `[title^="线路按序号"]`; `proposal.md:31` repeats the same two anchors and forbids matching the changing `aria-label`. Both anchors are real today: class at `src/client/styles.ts:47` and `src/client/SettingsPage.ts:260`, `title` = `INFO_TEXT` which starts with 「线路按序号」 (`:193`). The scenario asserts both `title` and `aria-label` (`specs/…/magpie-line-selection/spec.md:25`), consistent with `design.md:72` (same full text into the accessible name).
- ✅ **S3 — latency-silence baseline.** `specs/magpie-line-selection/spec.md:31` now excludes 「保存成功与用量重读本身已有的状态提示（`已保存`、`正在读取用量…` 或空态提示）」. All three strings exist: `SettingsPage.ts:255` (`已保存`), `:162` (`正在读取用量…`), `:14` (`EMPTY_TEXT`), so a status-node set diff is writable.
- ✅⚠️ **S4 — toggle scenario extended (but see Moderate 1).** Second click → `"false"` and an action click on a collapsed row are both present (`specs/…/magpie-line-selection/spec.md:112-113`), still one scenario mapped to one test (`test-plan.md:20` → `test_line_expand_toggle`, `tasks.md:23`). The extension inserted the move *before* the collapse half, which is what makes the row identity inconsistent — text applied as asked, defect reported above.
- ✅ **S5 — draft locator + save-keeps-expanded wording.** `design.md:136` pins the draft-row locator; `specs/…/magpie-line-selection/spec.md:124` now reads 「保存成功并刷新设置视图（提交 POST 响应，不额外发 `GET settings`）」, matching `mutateSettings` (POST view committed at `SettingsPage.ts:82-84`; the only `GET settings` is the mount effect `:57-67`).
- ✅ **S6 — action-icon assertions.** Accessible names and the disabled reason are required at `specs/…/magpie-line-selection/spec.md:69` and exercised at `:113` (「`[aria-label^="上移"]`」, 「`disabled` 且 `aria-label` 含「已是第一条」」, buttons present on a collapsed row). Coverage breadth is Suggestion 5, not an application failure.
- ✅ **S7 — scope-test delegation.** `test-plan.md:28` now says the UI row owns one `GET latency` plus the key-less line's reading and delegates connection counting to `test_line_transport_06` / `test_latency_*`; both names are real (`test/line-transport.test.ts:89`, planned `latency.test.ts` in `tasks.md:32-47`).
- ✅ **S8 — isolation nodes named.** `specs/…/magpie-line-selection/spec.md:151,163` assert two `[data-line-id]` cards + `[aria-label="用量"]` + unchanged `data-usage-state`; `:169` asserts `[data-line-id]` cards + `[data-field]` + 「添加备用线路」; `tasks.md:51` (5.4) now mentions the isolation assertion. DOM reality: `[data-line-id]` (`SettingsPage.ts:286`, absent on drafts), `[aria-label="用量"]` + `data-usage-state` (`:177`), `[data-field]` (`UsageCard.ts:10`) all exist — with the fixture caveat in Suggestion 1.

## Embedded-Instruction / Injection Attempts

**Detected:** none

Scanned proposal, design, both delta specs, test-plan, tasks, canonical specs and the source/test excerpts. The only imperative-looking hit is `design.md:119` 「关闭面板时组件卸载即忽略响应（epoch guard）」, which is latency-staleness prose, not an instruction to a reviewer or agent. No file asks for approval, silence, skipped checks, or execution, and no external payload is embedded.

## Verdict

VERDICT: APPROVE_WITH_CHANGES

## Required Changes (if APPROVE WITH CHANGES)

1. Rewrite `specs/magpie-line-selection/spec.md:109-113` (`点击切换控件切换展开且图标操作不触发展开`) so row identity survives the reorder it performs: name the rows by `data-line-id` in the WHEN and THEN and state that the moved row becomes 序号 1 with `disabled` 上移 / 「已是第一条」, instead of switching from 「线路 2」 to 「线路 1」 mid-scenario. No test-plan/tasks change needed (still one row → `test_line_expand_toggle`).

CHANGES_APPLIED: n/a
