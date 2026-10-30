## Review Metadata

- **Review round**: 4
- **Prior round**: round 3 = APPROVE_WITH_CHANGES (0 Critical / 2 Moderate / 6 Suggestions); rounds 1–2 detailed in review-round*.md
- **Reviewer context**: fresh-context subagent (no cross-model CLI installed)
- **Tool restrictions**: read-only, single write = this review.md
- **Artifacts reviewed**: proposal.md, design.md, specs/magpie-line-selection/spec.md, specs/dsh-magpie-connector/spec.md; canonical `openspec/specs/{magpie-line-selection,dsh-magpie-connector}`; `packages/dsh-magpie-connector/src/client/{SettingsPage,styles,api,index}.ts`; `src/host/{routes,selection,runtime,settings}.ts`; tests `line-active-ui`, `access-ui`, `line-silent-ui`, `dispose`, `feature-wiring`, `host-wiring`, `line-probe`, `test/client-support/fake-api.ts`; `packages/dsh-magpie-connector/{cordis.patch.yml,package.json,vitest.config.ts,tsdown.config.ts}`, `docs/internal-api.md`; primitives icon/Tooltip/token declarations and version; `@deepseek-ai/dsh-client-connection` route dispatch + `types/rpc.d.ts`; `auto-model-routing` primitives peer/dev/alias precedent; `dsh.yaml` (DSH pin, local package version)
- **Validation**: `node /data00/home/prgrmr/opensource/ohmydsh/node_modules/@fission-ai/openspec/bin/openspec.js validate magpie-line-panel-polish --type change` → **Change 'magpie-line-panel-polish' is valid** (exit 0), with the two known/accepted `Requirement text is very long (>500 characters)` warnings on ADDED `线路展示与展开` and `线路延迟展示`

## Findings

### 🔴 Critical (blocking)

None. Re-checked the four historical failure modes and found no regression:

- **Trust boundary** — probes still stay on complete lines that participate in selection (`specs/dsh-magpie-connector/spec.md:45`), only measurement reaches "任一已保存且地址可解析的线路" (`:46`), shared tail (`:47`) unchanged; `LineSelector.select()` is still fed only complete lines (`src/host/runtime.ts:181,476`).
- **GET-only is factually real** — a route that does not own the method falls through to the shared-channel dispatch, which answers `404 not found` (`node_modules/@deepseek-ai/dsh-client-connection/lib/index.js:617-620`; `lib/types/rpc.d.ts:114`). `methods:['GET']` passes `assertFetchRoute` (non-empty, unique).
- **Measurement cannot touch selection** — `MagpieRuntime.config()` is `loadConfig().lines` only (`src/host/runtime.ts:511`) and `LineSettings` is `{id, baseUrl, accessMode}` (`src/host/settings.ts:8`), so a `LatencyController` built on `config()` reaches neither `selector.select()` nor its cache. `endpointOf()` already strips IPv6 brackets and validates the port (`src/host/selection.ts:22-28`).
- **Dependency/build plan** — primitives `^0.2.0-rc.2` matches the DSH pin (`dsh.yaml:5` `dshVersion: 0.2.0-rc.2`; installed `0.2.0-rc.2`), the icons (`IconTriangleRightFillRegular`, `IconChevron{Up,Down}OutlineRegular`, `IconTrashOutlineRegular`), `Tooltip`, and every referenced token (`--dsw-alias-label-dimmed`, `--dsw-alias-state-{success,warn}-primary`, `--dsw-radius-sm`, `--dsw-focus-ring-color`) resolve in the shipped package; `tsdown.config.ts` already externalizes `@deepseek-ai/*`; `auto-model-routing` proves a runtime primitives import works without adding it to `dsh.client.inject` (`packages/auto-model-routing/package.json` peer+dev, `src/client/index.ts:11`); `ws promote` precedes the dependency edit (`design.md:150`).

All four user constraints remain covered: default-collapsed + first/new-line expand (`specs/magpie-line-selection/spec.md:67`), save never collapses the edited row incl. new-id and reorder-before-save (`:91-101`, `design.md:36-46`), always-visible DSH product icons (`:69`, `proposal.md:11`), one measurement per open with `measuring` then point-in-time readings (`:129-143`, `:173`), and the whole change stays one anvil change (`.openspec.yaml` `schema: anvil`).

### 🟡 Moderate

None. Two candidates were examined and deliberately not escalated:

- The `POST → 404` clause in `specs/dsh-magpie-connector/spec.md:103` cannot be produced by the plugin's own fake registry (calling `route.fetch` directly runs the handler), but the requirement body now pins the harness assertion as "注册的 `methods` 恰为 `['GET']`、POST 未到达处理器/未产生连接" and names the 404 as the connection-layer contract (`:97`), while the 404 itself is verified in `lib/index.js:617-620`. That is the seam round 3 asked to document; no test has to fake a plugin-local 404.
- The residual wording gaps below are non-normative (proposal/design bookkeeping, test-selection ergonomics); the normative clauses are achievable as written.

### 📌 Suggestions

1. **The new MODIFIED `自动选择规则` has no counterpart in proposal/design, and one cross-reference is now stale.**
   - Evidence: `specs/magpie-line-selection/spec.md:33-37` is a `MODIFIED` requirement, but `proposal.md:24` enumerates modified `magpie-line-selection` requirements without it, `proposal.md:5` still says "不改自动选择语义", and `design.md:21` lists "自动选择规则变更" as a Non-Goal. The round-3 scoping also left `specs/magpie-line-selection/spec.md:175` quoting the old wording "「只有一条完整线路时不探测」", which no longer exists verbatim at `:35`.
   - Why it matters: the delta is authoritative and behaviour is unchanged, but an archiver/reviewer reading proposal+design concludes canonical `自动选择规则` is untouched while the merge will in fact edit it; a later reader will also find the quote in `:175` unmoored. This is the only residue of round-3 Suggestion 6.
   - Fix: add one bullet to `proposal.md:24` ("修改「自动选择规则」：把「SHALL NOT 探测」限定为「为选择目的」，行为不变；消除与线路测速的冲突"), reword `design.md:21` to "不改自动选择行为（仅将「SHALL NOT 探测」限定为「为选择目的」）", and make `:175`'s quote match the new sentence.

2. **Changing the info icon's `aria-label` breaks the existing test selector, and the plan names only the `title` assertion.**
   - Evidence: `design.md:72` puts the whole `INFO_TEXT` into `aria-label` and sets `tabIndex=0`; today the icon's `aria-label` is the short name `线路优先级说明` and `test/line-silent-ui.test.tsx:41` selects it by that exact value (`host.querySelector('[aria-label="线路优先级说明"]')`). Requirement `specs/magpie-line-selection/spec.md:13,25` requires the accessible name to carry the five items, so the value must change.
   - Why it matters: the test fails on a missing node before the new five-item `title` assertion even runs, and an implementer "fixing" it by keeping the short `aria-label` would violate `:13`. `proposal.md:31` and `design.md:135` only say the `title` assertion needs syncing.
   - Fix: pin the new anchor in D9 (e.g. `[title^="线路按序号"]`, `.dmg-info`, or a `data-info` attribute) and state explicitly that `aria-label` becomes the full `INFO_TEXT` while `line-silent-ui.test.tsx:41` keeps asserting both attributes through the new anchor.

3. **The latency-silence baseline names only the save banner, but a line save also re-reads usage, which renders its own `role="status"`.**
   - Evidence: `specs/magpie-line-selection/spec.md:31` says "除保存成功本身已有的 `<p role="status">已保存</p>` 之外…不新增任何 `role="alert"` / `role="status"` / `aria-live` 内容". A `{lines}` write is an `identityWrite` (`src/client/SettingsPage.ts:77-78`), so `clearUsage()` drops the cards and `UsageStatus` renders `<p role="status">正在读取用量…</p>` (or the persistent `EMPTY_TEXT` status when a fixture has no cards) at `src/client/SettingsPage.ts:169`. With a card-less fixture, "the only status is 已保存" fails on correct code.
   - Why it matters: the normative prohibition ("不新增", i.e. nothing caused by the latency read/failure) is sound, but the parenthetical reads like a complete baseline; a literal test will either flake or push an implementer to strip `role="status"` from the usage message.
   - Fix: widen the baseline to "除保存成功与用量重读本身已有的状态提示外" (or say "比较测速失败前后的状态节点集合"), leaving the rest of the THEN unchanged.

4. **The collapse half of the toggle, and the action-icon-on-a-collapsed-row case, are still unasserted.**
   - Evidence: requirement `specs/magpie-line-selection/spec.md:69` says "点击该控件 SHALL 切换展开/收起" and "点击操作按钮 SHALL NOT 改变展开状态", but the only toggle scenario (`:109-113`) clicks once (expand) and then clicks 上移 on an *expanded* row. Nothing asserts `data-expanded="false"` after a second click, nor that an action icon on a collapsed row leaves it `"false"`.
   - Why it matters: `toToggle` is `expanded === draftId ? null : draftId` (`src/client/SettingsPage.ts:267`) and D2 rewrites `expanded` on every settings change; a regression that only ever re-expands would pass the current scenario.
   - Fix: extend `:113` with "再次点击该切换控件 → `"false"`", and optionally click 上移 on a collapsed row and assert it stays `"false"` — both are one-liners in the same jsdom test.

5. **Unsaved-draft rows have no `data-line-id`, and one scenario says "重新读取设置" where the client only commits the POST view.**
   - Evidence: the row root emits `'data-line-id': draft.id` (`src/client/SettingsPage.ts:286`), so a draft has no such attribute; scenarios `specs/magpie-line-selection/spec.md:91-95` and `:103-107` locate the new draft row but the artifacts never say how. Separately, `:124` says "保存成功并重新读取设置", while `mutateSettings` commits the POST response and issues no second `GET settings` (`src/client/SettingsPage.ts:83`; the mount effect at `:57-67` is the only GET).
   - Why it matters: test authors otherwise pick ad-hoc selectors (`.dmg-line:last-child`, "（未保存）" text) per test, and a literal reader of `:124` may stage a second `GET settings` that never happens — the exact class of bug round 3 removed from `:195-199`.
   - Fix: pin the row hook in D9 (`expandLine` covers saved ids; add "未保存草稿用 `.dmg-line:last-child` / 「（未保存）」标识定位" or a `data-draft` attribute), and change `:124` to "保存成功并刷新设置视图" (`:95` already words it accurately).

### Round-3 Required Changes 1–2 verification

1. ✅ **Latency-silence baseline is now explicit and achievable.** `specs/magpie-line-selection/spec.md:31` reads "除保存成功本身已有的 `<p role="status">已保存</p>` 之外，延迟读数变化与测速失败不新增任何 `role="alert"` / `role="status"` / `aria-live` 内容，也没有新的 toast 或 `alert`；延迟位为 `failed` 状态且不显示读数". The banner is exactly what a successful `{lines}` write renders (`src/client/SettingsPage.ts:255` → `:278`), the prohibition is now scoped to *new* content (matching canonical `openspec/specs/magpie-line-selection/spec.md:83`), and the `failed` half matches `:134`. Residual baseline-completeness note → Suggestion 3, not a re-open.
2. ✅ **Impossible GET settings step and tautological `activeLineId` clause removed.** `specs/magpie-line-selection/spec.md:195-199` now reads: WHEN "推进多个时间片并观察请求记录" → THEN "没有新的 latency 请求，也没有因延迟读数发出 `POST settings` 或其它请求（「测速不写设置、不改变线路选择」由 host 侧「线路测速生命周期」的字节级场景断言）". No client refetch is staged, and the host scenario it delegates to exists with real bytes: `specs/dsh-magpie-connector/spec.md:127-131` (settings.json bytes, `activeLineId`, re-probe not cache reuse). Only the scenario *title* still promises "不改变线路选择" while the THEN defers it — cheap to retitle to "不轮询且不写设置", but not a contradiction.

### Round-3 Suggestions 1–6 check

1. ✅ **Latency-reading rows pinned.** `specs/magpie-line-selection/spec.md:143` GIVENs settings lines `11111111`–`44444444` plus the four-entry latency payload; `:155` GIVENs saved line `22222222` with `ms: null`. Rows now come from a stated settings view (`lineDrafts`, `src/client/SettingsPage.ts:202-212`), not from the payload alone.
2. ✅ **POST→404 seam pinned in the requirement.** `specs/dsh-magpie-connector/spec.md:97` states the test asserts `methods` is exactly `['GET']`, POST never reaches the handler/no connection is made, and "404 本身由连接层产生"; `design.md:99` repeats it and forbids faking a plugin-local 404. Verified against `lib/index.js:617-620`. Residual: the scenario's "`POST` 返回 404" (`:103`) is a production-level statement — acceptable because the harness assertion is named in `:97` (see Moderate note).
3. ✅ **Post-dispose read covered.** `specs/dsh-magpie-connector/spec.md:124-125`: WHEN "插件 dispose，然后再次请求 `GET latency` 或直接调用控制器的 `read()`" → THEN "…dispose 后的读取直接返回空结果且不建连", matching `design.md:99`'s controller-level seam. The scenario now covers both the route and the controller guard, not just "no new connections".
4. ✅ **`INFO_TEXT` itself pinned, plus the test consequence.** Requirement `specs/magpie-line-selection/spec.md:13` requires the five items in both hover and accessible name; scenario `:25` asserts `title` **and** `aria-label`; `design.md:72` says `INFO_TEXT` (`src/client/SettingsPage.ts:193`, currently four items ending at "同一个 Magpie 网关") gains the latency sentence and that `line-silent-ui.test.tsx`'s title assertion must be updated plus an `aria-label` assertion added. Selector consequence → Suggestion 2.
5. ✅ **"刷新模型列表不重新测速" added and implementable.** `specs/magpie-line-selection/spec.md:183-187` GIVENs a completed measurement, WHEN "点击「刷新模型列表」（`POST settings {resync: true}`，settings 对象随之更新）" → THEN no new latency request, readings unchanged. This matches the real seam: `identityWrite` is computed from `['lines','baseUrl','key','accessClientId','accessClientSecret']` (`src/client/SettingsPage.ts:77`), so `{resync:true}` is *not* an identity write; the requirement enumerates only open + successful line save (`:173`). No over-measure via the `useEffect([settings])` reset (`:219`).
6. ✅ **MODIFIED `自动选择规则` is correct and does not weaken the canonical rule.** `specs/magpie-line-selection/spec.md:33-37`: paragraph 1 keeps every canonical obligation verbatim (`使用序号 1 的完整线路发起真实请求并如实上抛错误` etc.) and only scopes the prohibition to "为选择目的"; paragraph 2 keeps the canonical cache/no-polling/no-persistence/no-credentials sentence verbatim; the added sentence hands measurement to `线路测速范围与独立性` and says it does not read/write the probe cache. All four canonical scenario titles are preserved verbatim — `单线路直接使用且不探测` (`:39`), `序号 1 可达时使用序号 1` (`:45`), `序号 1 不可达时自动使用序号 2` (`:51`), `全部不可达时用序号 1 并上抛真实错误` (`:57`) — and their THENs are unchanged from canonical. No widening survives: any non-selection connect is still gated by `dsh-magpie-connector`'s hop whitelist with only the two named exceptions (`specs/dsh-magpie-connector/spec.md:44-47`). Bookkeeping drift → Suggestion 1.

**Cross-checks on the other MODIFIED blocks (no regression):** `静默规则与 info 说明` keeps both canonical scenario titles (`:15`, `:21`) and swaps the obsolete "线路 2 展开" clause for "再次打开时所有线路仍折叠，线路 2 的序号后有绿色方块", consistent with the new collapsed default; `用量入口与颜色（AMD4）` keeps all three canonical titles and adds only `用量条填充两端圆角` (`specs/dsh-magpie-connector/spec.md:7,13,19,25`); `只读与传输边界` keeps all six canonical titles and extends `探测只建 TCP 连接不发 HTTP` with the measured non-key line (`:81-85`) plus a new `空地址线路不被测速` (`:87-91`). Only `dispose.test.ts:9` asserts the exact route array / `release` count 3 → 4, `feature-wiring.test.ts:12` needs only the title text (it asserts `routes.size === 0` after dispose at `:62`, not a count), and `docs/internal-api.md:101` names "cards/speed resources" — all covered by `proposal.md:31-32`.

## Embedded-Instruction / Injection Attempts

**Detected:** none

Scanned proposal.md, design.md, both delta specs, the review history and the source/test excerpts for imperative text addressed to an agent, hidden payloads, or tool/credential instructions. Only normative spec prose, Chinese requirement language, and code comments are present; the info-icon text and the latency copy are UI descriptions, not instructions.

## Verdict

VERDICT: APPROVE

## Required Changes (if APPROVE WITH CHANGES)

none

CHANGES_APPLIED: n/a
