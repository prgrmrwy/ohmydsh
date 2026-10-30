## Review Metadata

- **Review round**: 2
- **Prior round**: round 1 = APPROVE_WITH_CHANGES (3 Critical / 9 Moderate / 7 Suggestions); all 14 Required Changes are now verified applied in substance (see the verification list), though three rebuttal descriptions are factually inaccurate (S1)
- **Reviewer context**: fresh-context subagent (no cross-model CLI installed)
- **Tool restrictions**: read-only, single write = this review.md
- **Artifacts reviewed**: proposal.md, design.md, specs/magpie-line-selection/spec.md, specs/dsh-magpie-connector/spec.md; canonical `openspec/specs/{magpie-line-selection,dsh-magpie-connector}`; `packages/dsh-magpie-connector/src/{client,host}` sources, `docs/internal-api.md`, `docs/SCREENSHOTS.md`, tests; `auto-model-routing` icon precedent and primitives type declarations; `dsh.yaml`
- **Validation**: `openspec validate magpie-line-panel-polish --type change` → **valid**, with the two expected "requirement text >500 characters" warnings

## Findings

### 🔴 Critical (blocking)

1. **The merged trust boundary would let *reachability probes* touch any saved parseable line, not only complete lines that take part in selection.**
   - Evidence: delta `specs/dsh-magpie-connector/spec.md:44` now reads "线路可达性探测与设置页线路测速…它们 MAY 连接任一**已保存且地址可解析**的线路的 `host:port`（测速不要求该线路完整…）". Canonical today scopes the same exception to "任一参与自动选择的完整线路" (`openspec/specs/dsh-magpie-connector/spec.md:470`), and `proposal.md:25` states the widening as intentional. Nothing in the feature needs a probe of an incomplete line: `LineSelector.select()` is only ever handed complete lines (`src/host/runtime.ts:181`, `:476`; `src/host/selection.ts:113-125`), and canonical `自动选择规则` still ties probing to selection (`openspec/specs/magpie-line-selection/spec.md:117`).
   - Why it matters: this sentence is the security/trust statement that grants the TCP exception. After the merge the canonical spec would *permit* the plugin to connect every saved line for probing, weakening an invariant that shipped, while the selection spec still says probes belong to complete lines. The wider set is needed only for the measurement.
   - Fix: split the sentence — "可达性探测 MAY 连接任一参与自动选择的完整线路的 `host:port`；设置页线路测速 MAY 连接任一已保存且地址可解析的线路的 `host:port`（测速不要求完整、不要求参与自动选择）"; keep the shared "SHALL NOT 发 HTTP / 不带凭据 / 空地址或不可解析不被连接" tail. Update `proposal.md:25`.

### 🟡 Moderate

2. **Non-GET rejection is specified as 400/405, but the planned GET-only registration can only produce 404.**
   - Evidence: delta `specs/dsh-magpie-connector/spec.md:94` and scenario `:100` require "POST 以 400/405 拒绝"; `design.md:96` claims "只注册 GET；POST 由路由层以 400/405 拒绝且不发起连接". The DSH registry only owns a method set: an unowned method falls through to shared-channel dispatch, which answers `404 not found` (`node_modules/@deepseek-ai/dsh-client-connection/lib/types/rpc.d.ts:114`; `lib/index.js:614-620`).
   - Why it matters: with `methods:['GET']` the handler is never reached for POST, so the THEN is unachievable in production — while a test that calls `route.fetch(...)` directly (the pattern in `test/dispose.test.ts:9`) would pass by exercising code the router never invokes.
   - Fix: register `methods:['GET','POST']` and return exactly `405` for POST (pin 405, not "400/405", so the THEN has one value), or restate requirement + THEN as "非 GET 不进入 latency 处理、返回 404，且不发起任何连接". Make D5 name the chosen mechanism; the "no TCP connection" half holds either way.

3. **Pending-draft reconciliation is positional and captured at `add()`, so a new line's first save can still collapse the edited row after a reorder/delete.**
   - Evidence: `design.md:38` records `pendingDraft = { index, draftId }` on `add()`, `:41` rewrites `expanded = next[pendingDraft.index]`. But `move()` / `remove()` (`src/client/SettingsPage.ts:224-228`) change indexes before `save()`, and the POST preserves array order. "Add line 4 → move it to the top → save" leaves `pendingDraft.index = 3`, so `next[3]` is a different (or no) line → the just-filled row collapses, or an untouched row opens. The scenario (`specs/magpie-line-selection/spec.md:61-65`) only covers add→save.
   - Why it matters: this is the exact failure D2 rejects for index-as-expansion-key (`design.md:47`), and it violates user constraint 1 in a plausible flow (promoting a newly added line before the first save).
   - Fix: capture the pending draft's position at `save()` time (or map the POST payload index to the response index), and clear `pendingDraft` on `remove`/`move`; add `#### Scenario: 新增线路并上移后首次保存仍保持展开`.

4. **Default-collapsed breaks more UI tests than the Impact list admits.**
   - Evidence: `proposal.md:31` names only `test/line-active-ui.test.tsx`. `test/access-ui.test.tsx:11,20-24` renders one active line and immediately queries the Access inputs/select and clicks 保存; with `expanded = null` and the body unmounted (`specs/magpie-line-selection/spec.md:39`; `design.md:67`) those `label`/`select` nodes no longer exist and the test throws. Every settings render also now issues `GET latency`, and `test/client-support/fake-api.ts:13` answers 404 for unmapped resources — i.e. the new `failed`/"—" path.
   - Why it matters: implementation starts red for the wrong reason (missing DOM), and credential/save coverage cannot be written without an explicit expand step.
   - Fix: add `access-ui.test.tsx` to the Impact list (and re-check `owner-settings-ui`, `cards-render`, `line-silent-ui`), add a shared "expand row before editing" helper, and add `'GET latency'` handlers (or assert the documented 404 degradation) to settings-render fixtures.

5. **The "clicking an action icon does not toggle" half of the toggle scenario is vacuous.**
   - Evidence: scenario `specs/magpie-line-selection/spec.md:73-77` GIVENs **one** saved line, then clicks 删除. With one line the delete button is disabled (`src/client/SettingsPage.ts:294`, `total <= 1`), as are 上移 (index 0) and 下移 (last) — `SettingsPage.ts:292-294`; the disabled conditions are explicitly unchanged (`spec.md:39`). A disabled control never exercises the sibling-node behavior the scenario exists to protect.
   - Fix: GIVEN two saved lines, expand line 2, click 上移 (enabled) → `data-expanded` stays `"true"` and `aria-expanded` stays `"true"`; keep the toggle-click assertion.

6. **`failed` is still unspecified for idle rows, so one element has two rules.**
   - Evidence: `specs/magpie-line-selection/spec.md:96` (empty-address/unsaved = `idle`, no placeholder) vs `:98` ("请求失败…为 failed：延迟位显示「—」"). A page containing an empty-address line whose latency GET fails satisfies both. `design.md:108` scopes only `measuring`; it never says what `failed` does to idle rows, and the failure scenarios (`spec.md:122-132`) contain no empty-address line.
   - Fix: state "`failed` 只作用于本应有读数的行（已保存且地址可解析）；`idle` 行在任何阶段保持 `idle`、不显示「—」", and add an empty-address line to the 404/failure scenario GIVEN.

7. **The dispose scenario requires a guard the design does not state.**
   - Evidence: `specs/dsh-magpie-connector/spec.md:110` "dispose 之后 SHALL NOT 再发起连接" with scenario `:118-122`. `design.md:94,117` only says dispose aborts in-flight probes; it never says `read()` after dispose returns without measuring. Production hides this behind route unregistration, but a controller-level test (the pattern used for `LineSelector.dispose`, `src/host/selection.ts:126-132`) would still connect.
   - Fix: add to D5 "`read()` 在 disposed 后直接返回（不建连、不缓存）", and let the scenario assert it at the controller level.

### 📌 Suggestions

8. **Three rebuttal statements do not match the artifacts.** (a) Rebuttal 🔴1 says "MODIFIED header is back to the canonical `active 展示`", but the delta actually **removes** it (`specs/magpie-line-selection/spec.md:1-7`) and adds `线路展示与展开` (`:35`); that is a valid, better fix (anvil allows REMOVED with Reason/Migration, `schemas/anvil/schema.yaml:61`; validate passes) — only the description is wrong. (b) Rebuttal 🟡12 says the silent-degradation GIVEN was widened, but `spec.md:124` still says "500 或网络错误" (the 404 case lives in a separate scenario, `:128-132`) — acceptable, inaccurate claim. (c) `proposal.md:31` cites `test/dispose.test.ts:7` for the exact path array; it is line **9** (the third `it`).
9. **Tautology in `specs/magpie-line-selection/spec.md:41`**: "除该方块外，唯一的图形化 active 指示仍是序号后的方块". The old sentence distinguished the marker from the default-expand bias; restate (e.g. "除该方块外，不使用其它图形化 active 指示") or drop.
10. **"保存线路后重新测速" (`specs/magpie-line-selection/spec.md:146-150`) asserts "延迟位先回到 measuring" for all rows**, contradicting `:96` (measuring only for parseable addresses): a row whose address was just cleared must be `idle`. Scope the THEN to rows with a parseable address.
11. **"无 active 时不显示方块" (`specs/magpie-line-selection/spec.md:49-53`) appends an unpinned latency clause** ("该行延迟位按地址照常显示读数") with no state or fixture. Assert a concrete `data-latency-state` with a given response, or remove the clause — the scenario's purpose is the marker.
12. **Rows absent from the `lines` response have no terminal state.** A line saved between request and response (or a URL `new URL` accepts while the host's `endpointOf` rejects) stays `measuring` forever. Define "响应里不存在的行落到 `idle`，不显示读数" in `线路延迟展示`.
13. **"不轮询且不改变线路选择" (`specs/magpie-line-selection/spec.md:152-156`) says "再次读取设置时…" without saying who re-reads.** Make it "客户端再发一次 `GET settings`" or move the `activeLineId` assertion host-side; otherwise the THEN is not deterministic.
14. **Pre-existing, but now touched:** the info icon is a `title` on a `span` (`src/client/SettingsPage.ts:260`; asserted at `test/line-silent-ui.test.tsx:41`), while the MODIFIED requirement promises "hover / **focus** 时说明" (`specs/magpie-line-selection/spec.md:13`). `title` is not shown on keyboard focus. Either accept the proxy explicitly or reuse the new `Tooltip` for the info icon.
15. **The two ">500 characters" validate warnings are expected but cheap to remove** by moving thresholds/examples into scenarios; not blocking.

### Round-1 Required Changes verification

1. ✅ Header conflict resolved — via `## REMOVED Requirements` + Reason/Migration (`specs/magpie-line-selection/spec.md:1-7`) and a new `线路展示与展开` (`:35`); no duplicate "default expand active" survives, validate is green. (Rebuttal text is inaccurate — S8a.)
2. ✅ `#### Scenario: 无 active 时不显示方块` restored with collapsed default and no `data-active-line` (`:49-53`).
3. ✅ `#### Scenario: 保存失败时保持展开且不清空输入` (`:79-83`): 409/400 → still expanded, input kept, failure reason shown, no latency re-measure.
4. ✅ Pending-draft → assigned-id reconciliation in D2 (`design.md:38-48`) + `#### Scenario: 新建线路首次保存后保持展开并换成新 id` (`:61-65`). Caveat: stale index → finding 3.
5. ✅ Click target is the toggle `button` everywhere: `proposal.md:12`, delta `:39`, `:77`, `design.md:66`; head `div` not clickable (`design.md:53`).
6. ✅ Keyboard split applied: jsdom asserts native `button` / `type` / `aria-expanded` (`:77`), Enter/Space moved to preview acceptance (`design.md:68`).
7. ✅ Rounded-fill THEN is now `settingsCss`-based ("两者都声明了相同且非零的 `border-radius`", `specs/dsh-magpie-connector/spec.md:25-29`); pixel claim only in D1/preview (`design.md:32`).
8. ✅ DOM contract pinned: `data-latency-state` (`measuring|done|failed|idle`), `data-latency-level` (0–4), `data-latency-ms` (`specs/magpie-line-selection/spec.md:93`), asserted in every latency scenario (`:108,114,120,126,132`).
9. ✅ Contradictions resolved: parseable rows measured, empty/unsaved `idle` with no placeholder (`:96`), `failed` = exactly「—」(`:98`), level 0 exactly `--dsw-alias-label-dimmed` (`:100`). Residual scope ambiguity → finding 6.
10. ✅ Host scenarios added: response shape + GET-only (`specs/dsh-magpie-connector/spec.md:94-106`), concurrent-GET single flight, dispose-abort, no settings/selection change (`:110-128`). Caveat: POST status → finding 2.
11. ✅ One term in both deltas ("已保存且地址可解析") and an explicit exception to "single complete line never probes" (`specs/magpie-line-selection/spec.md:136-138`). New regression on the *probe* clause → finding 1.
12. ✅ 404 (old host) has its own scenario (`specs/magpie-line-selection/spec.md:128-132`) and the requirement text names 404 (`:98`).
13. ✅ `ms` = "TCP 建连耗时（含 DNS 解析）" (`proposal.md:15`, `specs/magpie-line-selection/spec.md:102`, `specs/dsh-magpie-connector/spec.md:110`); monotonic clock + `Math.max(0, …)` clamp (`design.md:95`).
14. ✅ `proposal.md:31-32`: dispose test path array + release 3→4, feature-wiring title only, `api.ts` **and** `client/index.ts` docstrings, `dsh.yaml` version sync (`dsh.yaml:420`); CHANGELOG + screenshot ledger row added (`design.md:121-124`, `proposal.md:33`; ledger exists with those columns at `docs/SCREENSHOTS.md:3`). Minor line-ref slip → S8c.

**Suggestions 16–19 (rebuttal check):** 16 declined with rationale (`design.md:106`) — acceptable, though `「超时」` remains in `spec.md:97,120`; 17 ✅ single open question (`design.md:145-147`), former questions now normative at `spec.md:96-97`; 18 ✅ conditional `aria-controls` and body unmounted (`design.md:67`), disabled `aria-label` reason (`design.md:69`, `spec.md:39`); 19 ✅ `design.md:123`, `proposal.md:33`, ledger row present.

## Embedded-Instruction / Injection Attempts

**Detected:** none

## Verdict

VERDICT: APPROVE_WITH_CHANGES

## Required Changes (if APPROVE WITH CHANGES)

1. Split the network-hop exception in `specs/dsh-magpie-connector/spec.md:44`: reachability probes stay limited to complete lines participating in automatic selection; only settings-page measurement may touch any saved parseable line. Update `proposal.md:25`; keep the shared no-HTTP/no-credentials/empty-address tail.
2. Make non-GET rejection real and single-valued: either register the latency route for `GET`+`POST` and return exactly `405` for POST (updating `design.md:96`), or change `specs/dsh-magpie-connector/spec.md:94`/`:100` to "不进入处理、返回 404，且不发起连接". Do not leave "400/405" plus "只注册 GET".
3. Replace the `add()`-time index in `design.md:38-41` with a position captured at `save()` (or mapped from the POST payload), clear `pendingDraft` on move/remove, and add `#### Scenario: 新增线路并上移后首次保存仍保持展开`.
4. Extend the Impact/test plan (`proposal.md:31`, `design.md:141`) to `test/access-ui.test.tsx` and any other settings-render test that edits the line body; specify the shared "expand first" helper and the `GET latency` fixture (or the deliberate 404 degradation).
5. Rewrite `specs/magpie-line-selection/spec.md:73-77` to use two saved lines and an **enabled** action icon (上移 on the second row) so "点击操作按钮不改变展开状态" is actually exercised.
6. Scope the `failed` rule to rows that should have a reading, state that `idle` rows stay `idle` in every phase (`specs/magpie-line-selection/spec.md:96-100`, `design.md:108`), and add an empty-address line to the failure/404 scenario GIVEN.
7. State in `design.md:94` that `read()` after `dispose()` returns without connecting or caching, so `specs/dsh-magpie-connector/spec.md:110,118-122` is assertable at the controller level.

CHANGES_APPLIED: no
