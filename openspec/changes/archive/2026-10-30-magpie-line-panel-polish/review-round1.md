## Review Metadata

- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: fresh-context subagent (no cross-model CLI installed)
- **Tool restrictions**: read-only (read/grep/glob), single write = this review.md
- **Artifacts reviewed**: proposal.md, design.md, specs/magpie-line-selection/spec.md, specs/dsh-magpie-connector/spec.md, plus the listed source/spec/test files

## Findings

### 🔴 Critical (blocking)

1. **MODIFIED requirement renamed — the merge leaves the old `active 展示` requirement (with the opposite rule) alive in the canonical spec.**
   - Evidence: canonical header is `### Requirement: active 展示` (`openspec/specs/magpie-line-selection/spec.md:65`) with the normative sentence "设置页 SHALL 默认只展开当前生效线路" (`:67`); the delta declares `### Requirement: 线路展示与展开状态` (`openspec/changes/magpie-line-panel-polish/specs/magpie-line-selection/spec.md:3`). The anvil spec instruction requires a MODIFIED block to be the "full updated content" of an existing requirement, and renames go through `## RENAMED Requirements` with `FROM:`/`TO:` (`/data00/home/prgrmr/.local/share/openspec/schemas/anvil/schema.yaml`, specs → "RENAMED Requirements - Name changes only - use FROM:/TO: format").
   - Why it matters: a header-keyed merge (spec-merger/archive) does not match `线路展示与展开状态` to `active 展示`, so the shipped canonical spec ends up with **both** "默认展开 active" and "默认全部折叠" — the exact behavior this change exists to reverse — plus two active-marker clauses. This is a silent regression of the canonical truth, not a cosmetic naming issue.
   - Fix: keep `### Requirement: active 展示` as the MODIFIED header and put the new text there; if the new name is wanted, add a separate `## RENAMED Requirements` block with `FROM: active 展示` / `TO: 线路展示与展开状态` and keep the MODIFIED body under the FROM name.

2. **The delta drops an existing canonical scenario and the requirement is left with no failure/edge scenario.**
   - Evidence: canonical `#### Scenario: 无 active 时不显示方块` (`openspec/specs/magpie-line-selection/spec.md:75-79`) is absent from the delta (delta scenarios: `:11`, `:17`, `:23`, `:29`, `:35`). That scenario is the only place asserting "a saved but incomplete line, `activeLineId: null` → no `data-active-line`, page still renders", and it has a live test named after it (`packages/dsh-magpie-connector/test/line-active-ui.test.tsx:39-46`, `test_line_active_ui_02 spec Scenario "无 active 时不显示方块"`), which the change would orphan. The canonical scenario at `:17` only covers the zero-line first-install case.
   - Also: the delta's replacement requirement has five scenarios, **none** of which is a failure/edge of the new save path — while the anvil schema is explicit: "Every requirement MUST have at least one happy-path AND one failure/edge scenario. Missing failure scenarios are a review-blocking defect" (`…/schemas/anvil/schema.yaml`, specs instruction).
   - Why it matters: the whole point of the change is "saving must not collapse the row being edited"; the only failure case that can violate it (POST settings 400/409) is unspecified, and the no-active edge silently loses its canonical protection.
   - Fix: restore `#### Scenario: 无 active 时不显示方块` (adapted to collapsed default) and add a failure scenario, e.g. "保存失败时保持展开且不清空输入": GIVEN 线路 2 expanded with a modified address, WHEN POST settings returns 409/400, THEN 线路 2 stays `data-expanded="true"`, the typed address remains in the input, and no latency re-measure is issued.

3. **Saving a newly added line collapses it — the plan's expansion key does not survive the host assigning an id, violating user constraint 1.**
   - Evidence: pending drafts key expansion by `draftId = line.id ?? 'new-<n>-<ts>'` (`packages/dsh-magpie-connector/src/client/SettingsPage.ts:206`), `add()` sets `expanded` to that synthetic id (`:229-231`), and the settings effect resets drafts from the response (`:219`). After the first successful save of a new line the response carries the assigned id, so `lineDrafts()` produces `draftId = <id>` and the preserved `expanded = 'new-…'` matches no row → **every row collapses**, including the one just filled in. Design D2 only says "该线路已不存在时回到 null" (`design.md:37`) — the line does exist, it just changed key. The delta scenario that is supposed to protect this ("保存后不收起正在编辑的行", delta `:35-39`) is written with an **already-saved** 线路 2, so it passes while the common add-then-save flow still breaks.
   - Why it matters: user constraint 1 explicitly joins "a newly added line still auto-expands" with "saving must not collapse the row the user is editing". With first-time setup, the first save is exactly the moment the row disappears.
   - Fix: specify the key reconciliation in D2 (e.g. keep a `pendingDraftId` and, when a settings response contains a line at the same index/address as the pending draft, rewrite `expanded` to that line's id; or key expansion by index + id fallback), and add a scenario "新建线路首次保存后保持展开" (GIVEN 空态, WHEN 添加线路 → 填写地址与 key → 保存成功, THEN 该行仍 `data-expanded="true"` 且显示新 id 的 active/读数状态, 其它行折叠).

### 🟡 Moderate

4. **Design D3 and the delta requirement disagree about what the click target is.**
   - Evidence: delta says "行头部 SHALL 是点击目标（鼠标 pointer）：点击头部 … SHALL 切换该行展开/收起" (delta `:9`) and the scenario clicks "该行头部（非操作图标区域）" (`:32`); design D3 says explicitly `.dmg-line-head (div, 不加 click)` with only `button.dmg-line-toggle` clickable and "拆成兄弟节点后点击操作天然不切换" (`design.md:44-56`). Under D3 the head's 8px gaps and `flex-wrap` padding are dead space, so the normative sentence is false as written.
   - Why it matters: an implementer following the spec would put a click handler on the head div (nested interactive elements, the thing D3 rejects); a test author following D3 clicks the button and never exercises the stated behavior. The artifacts must state one truth.
   - Fix: change the delta to "行头部的切换控件（`button`，`flex:1`）SHALL 是点击目标；点击序号/主机名/延迟区域 SHALL 切换该行", and drop "整行头部是切换控件" phrasing in `proposal.md:12` or restate it as "头部的切换控件覆盖序号、active 方块、主机名与延迟".

5. **The keyboard half of the toggle scenario is not mechanically assertable in this repo.**
   - Evidence: delta scenario `:32` says "按 Tab 聚焦切换控件并按 Enter … THEN … 按 Enter 后回到 `false`". `jsdom` does not perform default keyboard activation of `<button>` and there is no user-event/testing-library in this package (only react-dom `act` + raw DOM events; see `test/line-active-ui.test.tsx:1-7`, `test/client-support/fake-api.ts:50-54`). Neither Tab order nor Enter→click exists to assert. Design D3's justification "Enter / Space 天然可用" (`design.md:57`) is true in a browser, not in the test harness.
   - Why it matters: anvil requires each scenario to map 1:1 to a named test (`…/schemas/anvil/schema.yaml`); this THEN either fails or has to be faked with a synthetic `MouseEvent`, which would not prove keyboard operability.
   - Fix: split it — assert in jsdom that the toggle is a native `button` (`tagName === 'BUTTON'`, `type === 'button'`, `aria-expanded`), and move "聚焦后 Enter/Space 切换" to the worktree-preview acceptance list; alternatively add an explicit `onKeyDown` handler and then assert the dispatched keydown. State the chosen split in the delta.

6. **The rounded-fill scenario asserts a pixel outcome jsdom cannot produce.**
   - Evidence: delta THEN "渲染 46% 的填充段时右端为圆角而非直角" (`specs/dsh-magpie-connector/spec.md:29`). jsdom has no layout or painting; the only existing style assertions are attribute/CSS-string based (`test/cards-render.test.tsx:32` reads `.dmg-fill` `data-level`; `settingsCss` is an exported string, `src/client/styles.ts:6`). Design D1 already retreats to "测试断言 `.dmg-fill` 规则含非零 `border-radius`" (`design.md:31`), which contradicts the delta's THEN.
   - Why it matters: the scenario cannot be a test, so the radius fix has no executable acceptance.
   - Fix: rewrite the THEN to "`settingsCss` 中 `.dmg-fill` 声明的 `border-radius` 与 `.dmg-track` 相同且非零（46% 时的视觉连续由预览验收）"; keep the 46% rendering claim only in the preview/verify notes.

7. **The latency UI has no pinned DOM contract, so "4 格/超时/测速中" cannot be asserted without inventing selectors.**
   - Evidence: the delta scenarios assert "4、3、2、1 格信号条" (`:82`), "0 格" (`:94`), 「测速中…」(`:88`) and "不显示读数" (`:106`, `:118`), but no artifact names the element, class or attribute carrying the level/state. Design D6 only discusses tokens and colours (`design.md:90-94`); the one hint that grades be assertable is a risk row ("档位、状态都以导出常量/`data-*` 属性断言", `design.md:115`) which never becomes a decision. Existing code only offers `data-level` on `.dmg-fill` (`src/client/styles.ts:40-41`, `test/cards-render.test.tsx:32`).
   - Why it matters: test-plan is derived from scenarios; without a contract each test author picks a different selector and the "格" assertion becomes a proxy for the implementation rather than for the spec.
   - Fix: add to the ADDED requirement: each row's latency slot SHALL expose `data-latency-state` (`measuring|done|failed|idle`), `data-latency-level` (`0..4`) and, when a reading exists, `data-latency-ms`; then the scenarios can assert attributes.

8. **The latency requirement contradicts itself on the measuring placeholder and leaves two THENs non-deterministic.**
   - Evidence: "没有地址或未保存的线路 SHALL 不显示读数" (`:74`) vs "测速进行中**每行**的延迟位 SHALL 显示「测速中…」" (`:67`) and scenario "每行延迟位显示「测速中…」" (`:88`). An empty-address row therefore either shows a placeholder that can never resolve, or violates `:67`. Separately, `:106` allows two outcomes ("留空或显示「—」") and `:73`/`:75` allows two colour tokens ("超时为 error 或 dimmed"), so no single DOM state can be asserted.
   - Why it matters: both are direct violations of "THEN must be a state you would be willing to assert"; they also make screenshots/e2e flaky.
   - Fix: state "无地址或未保存的线路在测速中与测速后 SHALL 都留空（不显示占位、不显示格数）", pick exactly `—` for the failed/unavailable reading (or exactly empty), and pick exactly one token for level 0 (`--dsw-alias-label-dimmed`) instead of "error 或 dimmed".

9. **The host side of the new resource is under-specified: single-flight, dispose-abort, "no cache/no settings write" and the response shape have no scenario anywhere.**
   - Evidence: proposal promises "同一时刻只有一组探测（单飞），dispose 时中止" (`proposal.md:14`); design D5/D7 promise `read()` single-flight, `dispose()` abort of hanging probes and "不写 settings、不碰探针缓存、不改 `activeLineId`" (`design.md:82`, `:100-101`). None of these appears in either delta: `specs/magpie-line-selection/spec.md` has only client-facing scenarios, and `specs/dsh-magpie-connector/spec.md` only adds "探测与测速只建 TCP 连接不发 HTTP" (`:78-82`) and "空地址线路不被测速" (`:84-88`). `LatencyController` is new host code that aborts sockets during teardown; today's teardown path is `registerRoutes(...).dispose` registered as the effect cleanup (`src/index.ts:35-37`) and `registerRoutes` currently returns only `{settings,cards,speed,dispose}` (`src/host/routes.ts:68`).
   - Why it matters: anvil maps scenarios 1:1 to tests, so "单飞" and "dispose 中止悬挂探测" would ship untested — the same class of behavior the selection spec already protects with `dispose 中止探测` (`openspec/specs/magpie-line-selection/spec.md:169-173`). Also the response shape (`{measuredAt, lines:[{id, ms}]}`, `ms: null`) exists only in proposal/design, and `measuredAt` is never displayed or asserted.
   - Fix: add to the delta (host capability `dsh-magpie-connector`) a requirement + scenarios: (a) the resource is GET-only and returns `{measuredAt, lines:[{id, ms:number|null}]}` with at most one entry per saved parseable line, no keys/headers; (b) two concurrent GETs observe one set of TCP connections and the same `measuredAt`; (c) `dispose` during a hanging measurement releases it with no dangling socket and no subsequent connection; (d) a latency read writes nothing to settings and does not change `activeLineId`/the probe cache. Drop `measuredAt` if it is not used.

10. **The two deltas name the measured line set differently, and one name contradicts its own clarification.**
    - Evidence: `dsh-magpie-connector` delta says "任一已配置且地址可解析的线路" (`:44`) then immediately clarifies "测速不要求该线路完整" — but in this spec "已配置/未配置" is the *completeness* axis (`openspec/specs/magpie-line-selection/spec.md:11`, "未完整配置的线路 … 标记为未配置"), while `magpie-line-selection` delta says "当前已保存且地址可解析的每条线路" (`:69`). Two different terms for one set, one of which reads as "complete".
    - Why it matters: the probe-exception clause is a security/trust boundary sentence; "已配置" can be read as "complete" and re-narrow the exception back to the old rule, which is precisely what the change is widening.
    - Fix: use "已保存（persisted）且地址可解析的线路" in both deltas, and keep the parenthetical "不要求完整、不要求参与自动选择" only as clarification.

11. **The delta widens probing beyond automatic selection without amending the selection rule that forbids it.**
    - Evidence: canonical "自动选择规则" states unconditionally "只有一条完整线路时，插件 SHALL 直接使用该线路且 SHALL NOT 探测" (`openspec/specs/magpie-line-selection/spec.md:117`), while the new feature probes that same single line every time the settings panel opens (delta `:67`, `:69`). Only `dsh-magpie-connector`'s boundary paragraph is updated; `自动选择规则` and `探测实现与缓存` (`:145-149`) are untouched.
    - Why it matters: the archived canonical spec would then contain a literal prohibition on a connection the feature performs by design; anyone testing "single line never probes" against the *spec* would file the new feature as a defect.
    - Fix: either scope the existing sentence ("自动选择 SHALL NOT 为选择目的发起探测") via the same MODIFIED requirement, or add one sentence to the ADDED requirement noting that settings-page measurement is outside the selection probe rules (and does not consult or populate the probe cache).

12. **Settings-write failure and 404 (old host) are outside the failure scenarios.**
    - Evidence: the silent-degradation scenario GIVEN is "host 的 latency 资源返回 500 或网络错误" (`:104`); the proposal's upgrade path relies on "请求 404 时静默跳过" (`proposal.md:35`). A 404 is neither 500 nor a network error, and the current fetch helper surfaces it as `{status:404}` (`src/client/api.ts:13-33`), so the documented version-skew path has no scenario.
    - Why it matters: the only supported downgrade path (new client + old host) would ship unverified, and `fakeApi` even defaults unmapped resources to 404 (`test/client-support/fake-api.ts:13`) — the tests will hit this path whether or not the spec describes it.
    - Fix: change the GIVEN to "任何非 2xx（含 404）或网络错误" and name 404 explicitly in the THEN.

### 📌 Suggestions

13. **`proposal.md:31` misdescribes the test change.** `test/feature-wiring.test.ts` has no "资源数量断言" — it only says "three resources" in the test title (`:12`) and asserts `routes.size === 0` after dispose (`:62`). The real count assertions are in `test/dispose.test.ts:9` (exact path array + `release` called 3 times). Say so, or the test-plan will look for a non-existent assertion.

14. **Docstrings will go stale.** `src/client/index.ts:7` ("three D10 resources") and `src/client/api.ts:2` ("the three D10 resources") must become four; the proposal only names `api.ts`. Add both to the Impact list.

15. **`dsh.yaml` is missing from the Impact list.** The local package entry pins `version: 0.3.1` (`dsh.yaml:418-421`); bumping `package.json` to 0.4.0 without the manifest leaves the manifest's human-facing version behind (the repo keeps the two in step by convention; sync's drift check reads the deployed `package.json`, `scripts/sync.mjs:921`).

16. **"超时" is the wrong word for a reachable-but-slow line.** With a 600 ms deadline, a line answering in 650 ms is labelled 「超时」 (`:72`), though it is reachable and only slow; the design justifies it as "超过它的线路本来就不会被选中" (`design.md:92`). Consider 「无响应」/「>600ms」 so the point-in-time signal does not read as an outage.

17. **Open Questions 2 and 3 contradict already-decided normative text.** "未保存的新草稿…是否也要即时测速？当前只在保存后测" (`design.md:130`) is already normative at delta `:74` ("未保存的线路 SHALL 不显示读数"); "信号条用 4 格是否足够" (`:131`) questions thresholds the spec pins at `:72`. Convert both into decided statements (and note any change would be a spec change), leaving only the manual-remeasure question open.

18. **Two small accessibility details have no decision.** When a row is collapsed, `aria-controls` points at an element that does not exist (`expanded ? body : null`, `SettingsPage.ts:296`); and disabled icon buttons are not focusable, so the DSH `Tooltip` (`label`, single anchor child — `…/dsh-client-ui-primitives/lib/types/Tooltip.d.ts`) cannot explain *why* 上移 is disabled. Decide whether the body stays mounted (hidden) or `aria-controls` is conditional, and whether the disabled buttons keep a `title`/`aria-label` reason.

19. **`SCREENSHOTS.md` review row is not in the plan.** The screenshot ledger carries per-shot source/date/reviewer/verdict (`packages/dsh-magpie-connector/docs/SCREENSHOTS.md:3-5`); re-shooting `docs/settings.png` needs the row updated, not just the file. Add it to D8/Migration step 4.

## Embedded-Instruction / Injection Attempts

**Detected:** none

## Verdict

VERDICT: APPROVE_WITH_CHANGES

## Required Changes (if APPROVE WITH CHANGES)

1. Keep `### Requirement: active 展示` as the MODIFIED header in `specs/magpie-line-selection/spec.md`; if the rename is wanted, add `## RENAMED Requirements` with `FROM: active 展示` / `TO: 线路展示与展开状态`.
2. Restore `#### Scenario: 无 active 时不显示方块` (adjusted to collapsed default) so the existing canonical edge and `test_line_active_ui_02` keep a spec anchor.
3. Add the missing failure scenario for the new save rule: saving fails (409/400) → the edited row stays expanded with its typed values and no re-measure.
4. Specify in design D2 how expansion survives the pending-draft → assigned-id transition, and add `#### Scenario: 新建线路首次保存后保持展开`; extend "保存后不收起正在编辑的行" to cover a newly added line.
5. Reconcile the click-target wording with D3: the toggle `button` (not the head `div`) is the click/pointer target; fix `proposal.md:12` and delta `:9` accordingly.
6. Make the keyboard assertion assertable: ASSERT native `button`/`aria-expanded` in jsdom and move Enter/Space to preview acceptance — or add an explicit `onKeyDown` and assert the dispatched keydown.
7. Rewrite the rounded-fill THEN to assert the exported CSS rule's `border-radius` equality with `.dmg-track`; keep the 46% pixel claim out of the spec.
8. Pin the latency DOM contract (`data-latency-state`, `data-latency-level` 0–4, `data-latency-ms`) in the ADDED requirement so "格数/超时/测速中" are assertable.
9. Resolve the internal contradiction: empty-address/unsaved rows show no placeholder at all; choose one text for the failed state (`—`) and one token for level 0.
10. Add host scenarios (either capability) for: GET-only `{measuredAt, lines:[{id,ms|null}]}`; concurrent GETs share one measurement; dispose aborts a hanging measurement leaving no socket; a latency read writes no settings and does not change `activeLineId`/probe cache.
11. Use one term for the probed set in both deltas ("已保存且地址可解析"), and amend 自动选择规则 so "SHALL NOT 探测" is scoped to selection (or explicitly excepted for settings measurement).
12. Widen the silent-degradation GIVEN to any non-2xx including 404, and state 404 explicitly (old host / version skew).
13. Align `ms` semantics with the wording: either exclude DNS (true "TCP 建连往返") or change both the spec and the info text to "TCP 建连耗时（含 DNS 解析）", and use a monotonic clock with a non-negative clamp.
14. Apply suggestions 13–15 at minimum (test-description correction, docstrings, `dsh.yaml` version) so the Impact/verification lists are accurate.

CHANGES_APPLIED: no

## Rebuttals

Author responses to round-1 findings (fixes are in proposal.md, design.md, specs/magpie-line-selection/spec.md, specs/dsh-magpie-connector/spec.md):

- 🔴1 fixed: MODIFIED header is back to the canonical `### Requirement: active 展示`; no rename is issued (kept stable for header-keyed merge), and the body now carries the new default-collapsed rule.
- 🔴2 fixed: restored `#### Scenario: 无 active 时不显示方块` (adapted to collapsed default, still asserts no `data-active-line` and a rendering line) and added `#### Scenario: 保存失败时保持展开且不清空输入` (409/400 → stays expanded, input kept, no latency re-measure).
- 🔴3 fixed: design D2 now specifies the pending-draft → assigned-id reconciliation (record `pendingDraft = {index, draftId}` on `add()`, rewrite `expanded` to the draft at the same index when the synthetic id disappears), and the delta adds `#### Scenario: 新建线路首次保存后保持展开并换成新 id`.
- 🟡4 fixed: click target is now consistently the toggle `button` (covers index / marker / hostname / latency) in proposal, delta and design D3; the head `div` is not clickable.
- 🟡5 fixed: split as proposed — jsdom asserts native `button`/`type`/`aria-expanded` on click; Enter/Space activation is listed for preview acceptance in the scenario text and design D3.
- 🟡6 fixed: rounded-fill THEN now asserts `settingsCss` declares the same non-zero `border-radius` for `.dmg-track` and `.dmg-fill`; the 46% pixel claim moved to preview acceptance (design D1).
- 🟡7 fixed: ADDED requirement pins `data-latency-state` (`measuring|done|failed|idle`), `data-latency-level` (`0..4`) and `data-latency-ms`, and every scenario asserts those attributes.
- 🟡8 fixed: empty-address/unsaved rows are `idle` with no placeholder in every phase; `failed` shows exactly 「—」; level 0 uses exactly `--dsw-alias-label-dimmed`.
- 🟡9 + 🟡10 fixed: added ADDED requirement `线路测速资源` in `dsh-magpie-connector` with response shape (GET-only), concurrent-GET single flight, dispose-abort and no-settings/no-selection-change scenarios. Probed set is now worded identically in both deltas as 「已保存且地址可解析」.
- 🟡11 fixed: ADDED requirement states settings-page measurement is independent of selection, does not read/write the selection probe cache and is not constrained by "single complete line never probes".
- 🟡12 fixed: silent-degradation GIVEN widened to any non-2xx including 404, and a dedicated 404 (old host) scenario was added.
- 🟡13 fixed (required 14): `ms` semantics/explanations now say 「TCP 建连耗时（含 DNS 解析）」; design D5 uses a monotonic clock with `Math.max(0, …)` clamp.
- 📌13 fixed: proposal Impact now describes the real assertions (`dispose.test.ts:7` path array + release count 3 → 4; `feature-wiring.test.ts:12` only the title).
- 📌14 fixed: `api.ts` and `client/index.ts` docstring updates are in the Impact list.
- 📌15 fixed: `dsh.yaml` local package version sync is in the Impact list and migration step 4.
- 📌16 declined: 「超时」 kept as the familiar FPS failure reading because at a 600 ms deadline we cannot distinguish slow vs refused/unreachable; the tooltip explains 「600ms 内未完成建连（可能很慢或不可达）」. Renaming to 「无响应」/「>600ms」 would misreport refused connections.
- 📌17 applied: Open Questions reduced to the single manual-remeasure item; the unsaved-draft and 4-bar-threshold questions are now decided in spec/design.
- 📌18 applied: design D3 decides conditional `aria-controls` (only when expanded, body unmounted otherwise) and disabled buttons carry the reason in `aria-label` (tooltip only on enabled buttons).
- 📌19 applied: screenshot ledger row update is in design D8 and proposal Impact.

CHANGES_APPLIED: no
