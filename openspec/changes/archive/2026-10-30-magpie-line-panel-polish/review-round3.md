## Review Metadata

- **Review round**: 3
- **Prior round**: round 2 = APPROVE_WITH_CHANGES (1 Critical / 6 Moderate / 8 Suggestions); round 1 = APPROVE_WITH_CHANGES (3 Critical / 9 Moderate / 7 Suggestions)
- **Reviewer context**: fresh-context subagent (no cross-model CLI installed)
- **Tool restrictions**: read-only, single write = this review.md
- **Artifacts reviewed**: proposal.md, design.md, specs/magpie-line-selection/spec.md, specs/dsh-magpie-connector/spec.md; canonical `openspec/specs/{magpie-line-selection,dsh-magpie-connector}`; `packages/dsh-magpie-connector/src/client/{SettingsPage,styles,api,index}.ts`; `src/host/{routes,selection,runtime,settings}.ts`; `packages/dsh-magpie-connector/docs/{internal-api.md,SCREENSHOTS.md}`; tests `line-active-ui`, `access-ui`, `line-silent-ui`, `dispose`, `feature-wiring`, `line-probe`, `speed-ui`, `owner-dispose`, `test/client-support/fake-api.ts`; `@deepseek-ai/dsh-client-ui-primitives` icon/Tooltip declarations; `@deepseek-ai/dsh-client-connection` route dispatch + `types/rpc.d.ts`; `auto-model-routing` primitives stub/vitest alias/tsdown externals; `dsh.yaml`; anvil schema artifact flow
- **Validation**: `node node_modules/@fission-ai/openspec/bin/openspec.js validate magpie-line-panel-polish --type change` → **Change 'magpie-line-panel-polish' is valid** (exit 0), with the two known/accepted "Requirement text is very long (>500 characters)" warnings on ADDED `线路展示与展开` and `线路延迟展示`

## Findings

### 🔴 Critical (blocking)

None. Re-checked the areas that historically blocked this change and found no regression:

- The network-hop exception is split again exactly as canonical requires: reachability probes stay on "任一参与自动选择的完整线路" (`specs/dsh-magpie-connector/spec.md:45`) and only settings measurement reaches "任一已保存且地址可解析的线路" (`:46`), with the shared no-HTTP/no-credentials/no-unparseable-address tail (`:47`) against canonical `openspec/specs/dsh-magpie-connector/spec.md:470`. `LineSelector.select()` is still only fed complete lines (`src/host/runtime.ts:181,476`).
- GET-only is now factually achievable: `methods:['GET']` passes `assertFetchRoute` (non-empty, unique), and a non-owned method falls through `createSharedFetchHandler` to `404 not found` (`node_modules/@deepseek-ai/dsh-client-connection/lib/index.js:608-620`; `lib/types/rpc.d.ts:114` "Other methods continue through normal shared-channel dispatch"). No plugin-level path can send HTTP or credentials during measurement.
- Dependency plan is coherent: primitives is peer+dev with the DSH pin (`dsh.yaml:5` `0.2.0-rc.2` vs `^0.2.0-rc.2`), `tsdown.config.ts` already has `external: [/^@deepseek-ai\//]`, `ws promote` precedes the dep edit (`design.md:150`), and `auto-model-routing` proves runtime import works without adding primitives to `dsh.client.inject`.
- All four user constraints are covered: default-collapsed + first/new-line expand (`spec.md:37`), save never collapses the edited row incl. new-id and reorder-before-save (`:61-71`), always-visible DSH product icons (`:39`, `proposal.md:11`), one measure per open with `measuring` then point-in-time readings (`:99-109`, `:143`), single anvil change (`.openspec.yaml` `schema: anvil`).

### 🟡 Moderate

1. **The new latency-silence scenario's THEN contradicts the save-confirmation the same WHEN necessarily produces.**
   - Evidence: `specs/magpie-line-selection/spec.md:27-31` — WHEN "线路保存触发重测" (which per `design.md:118` requires a *successful* save), THEN "页面没有新的 `role="alert"` / `role="status"` / `aria-live` 内容". A successful settings write sets a success message (`src/client/SettingsPage.ts:243`) rendered as `<p role="status">已保存</p>` (`src/client/SettingsPage.ts:278`). A test written literally (`queryByRole('status')` after the failure) fails on correct code, and "fixing" it by dropping the banner's status role would silently regress existing save feedback. The canonical silence rule only forbids *new kinds* of prompt (`openspec/specs/magpie-line-selection/spec.md:83`).
   - Why it matters: an unachievable-if-read-literally THEN in a requirement added by this change; the failure mode (implementer removes the banner role) is worse than the wording bug.
   - Fix: make the baseline explicit, e.g. "除保存成功本身已有的状态提示外，延迟读数变化与测速失败不新增任何 `role="alert"` / `role="status"` / `aria-live` 内容" — or split it into "无新增 `role="alert"`/`aria-live`" plus "状态提示文本不变".

2. **The "不轮询且不改变线路选择" scenario prescribes a client request that does not exist, so the applied round-2 S13 fix is still not faithfully assertable.**
   - Evidence: `specs/magpie-line-selection/spec.md:159-163` WHEN "…然后客户端再发一次 `GET settings`", THEN "这次 `GET settings` 的响应中 `activeLineId` 与线路顺序不变". The client's only `GET settings` is the mount effect (`src/client/SettingsPage.ts:62`, deps `[api]` at `:66`); saves commit the POST response view (`:79-88`), and no UI action refetches settings. Staging the extra GET therefore means either (a) calling the `api` adapter from the harness — not the client — against a canned fake, making the `activeLineId`/order assertion a tautology, or (b) remounting, which is a *new* panel open and legitimately issues a second measurement, muddying the scenario's own "no new latency request" claim. The substantive "measurement does not change selection" claim is already asserted host-side with real bytes: `specs/dsh-magpie-connector/spec.md:127-131`.
   - Why it matters: a scenario that cannot be implemented as written; the test that does get written will assert either nothing (canned response) or the wrong thing (remount measurement).
   - Fix: drop the extra `GET settings` step and the `activeLineId`/order clause from the client scenario; keep "推进多个时间片后没有新的 latency 请求、也没有 `POST settings`" and let the host scenario own "测速不写设置、不改变线路选择". If a re-read is kept, describe it as a host-side `GET settings` assertion, not a client action.

### 📌 Suggestions

1. **Pin the rows, not only the latency payload, in the latency-reading scenarios.** `specs/magpie-line-selection/spec.md:111-115` and `:123-127` give only `{lines:[{id, ms}]}` while the THEN talks about "四行"/"该行"; rows come from the settings view (`lineDrafts`, `src/client/SettingsPage.ts:203-212`), so the GIVEN should include saved lines with ids `11111111…44444444` / `22222222`.
2. **Name the test seam for the POST→404 half.** The 404 is produced by the connection layer (`lib/index.js:608-620`), not by the plugin, and `dispose.test.ts:9`'s fake registry cannot observe it. Say the test asserts `methods` is exactly `['GET']` (plus "POST never reaches the handler / no connection recorded") and that the 404 itself is the connection contract.
3. **Exercise `read()` after dispose.** `design.md:99` now specifies "disposed 后直接返回空结果：不建连、不缓存", but `specs/dsh-magpie-connector/spec.md:121-125` only forbids *new* connections after dispose. Add a post-dispose `GET latency` (or controller `read()`) assertion so the guard is actually covered.
4. **Say that `INFO_TEXT` itself gains the latency sentence.** Requirement `specs/magpie-line-selection/spec.md:13` and scenario `:25` require the hover `title` to contain "TCP 建连耗时（含 DNS 解析）", but today's `INFO_TEXT` ends at "同一个 Magpie 网关" (`src/client/SettingsPage.ts:193`), while `design.md:72` only mentions the `aria-label` and `proposal.md:31` only adds an `aria-label` assertion for `line-silent-ui`. Pin that the hover text is extended too (the test will otherwise fail on the old 4-item title).
5. **Pin measurement triggers to mount + successful line write only.** `specs/magpie-line-selection/spec.md:143` enumerates "每次打开" and "保存成功"; a settings *refresh* (e.g. the resync flow at `src/client/SettingsPage.ts:121`) must not re-measure. Add a half-sentence or a scenario ("刷新模型列表不重新测速") so an effect keyed on the `settings` object (`:217-219`) cannot over-measure.
6. **Canonical `自动选择规则` still says the unqualified "只有一条完整线路时…SHALL NOT 探测"** (`openspec/specs/magpie-line-selection/spec.md:117`). The exemption lives only in the new requirement (`specs/magpie-line-selection/spec.md:145`). Lex specialis is defensible, but when the delta is merged, scope the canonical sentence ("不为选择发起探测") in the same pass to avoid a later reader flagging a contradiction.

### Round-2 Required Changes verification (1–7)

1. ✅ **Split the network-hop exception.** `specs/dsh-magpie-connector/spec.md:45` (probes: "任一参与自动选择的完整线路"), `:46` (measurement: "任一已保存且地址可解析的线路"), shared tail `:47`; `proposal.md:25` now states both scopes explicitly. No widening of the probe set survives.
2. ✅ **Non-GET is 404, single-valued.** `specs/dsh-magpie-connector/spec.md:97` ("只处理 `GET`；其它方法…由连接层返回 404，且不发起任何连接") + scenario `:103`; `design.md:99` names the mechanism and the reason. Ground truth confirms 404 (`lib/index.js:608-620`); "400/405" is gone from spec and design.
3. ✅ **Pending-draft position captured at `save()`.** `design.md:38` (clear `pendingDraftId` when the draft is deleted), `:39` (`pendingIndex = drafts.findIndex(...)` computed at save time, with the move/remove explanation), `:40-44` (reconciliation + clear). New scenario `specs/magpie-line-selection/spec.md:67-71`. Ground truth supports it: `updateLines` rebuilds `nextLines` in POST order (`src/host/runtime.ts`, `nextLines.push` loop), and `move`/`remove` mutate indexes beforehand (`src/client/SettingsPage.ts:224-228`).
4. ✅ **Impact list widened.** `proposal.md:31` now names `test/access-ui.test.tsx`, the `expandLine` helper and the `GET latency` fixture / deliberate 404 degradation; `design.md:129-135` (D9) repeats it for `access-ui` plus `owner-settings-ui` / `cards-render` / `line-silent-ui`. Checked: only `access-ui.test.tsx` actually touches the line body (`label`/`select`/`保存`), so the list is sufficient; no other settings-render test asserts `data-expanded` or an absolute GET count.
5. ✅ **Toggle scenario now exercises an enabled icon.** `specs/magpie-line-selection/spec.md:79-83` GIVENs two lines and clicks 上移 on line 2 (index 1 → enabled per `src/client/SettingsPage.ts:292`), so the sibling-node behavior is real; `data-expanded`/`aria-expanded` stay `"true"`.
6. ✅ **`failed` scoped, `idle` invariant, empty-address line in both failure GIVENs.** `specs/magpie-line-selection/spec.md:104` ("本应有读数的行…；地址为空或未保存的草稿在任何阶段都保持 `idle`"), `design.md:111`, scenarios `:131` and `:137` each include an empty-address line.
7. ✅ **`read()` after dispose is specified.** `design.md:99` ("`LatencyController.read()` 在 disposed 后直接返回空结果：不建连、不缓存（测试可在控制器层断言）"), which makes `specs/dsh-magpie-connector/spec.md:110,121-125` reachable at controller level (residual coverage note → Suggestion 3).

### Round-2 Suggestions 9–14 check

9. ✅ Tautology gone — `specs/magpie-line-selection/spec.md:41` now reads "除该方块外，SHALL NOT 使用其它图形化 active 指示"; the expansion triangle is not an active indicator, so no new contradiction with `:39`.
10. ✅ Fixed — `:153-157` scopes "先回到 `measuring`" to rows whose address still parses and sends cleared-address rows to `idle`, consistent with `:102`/`:104`.
11. ✅ Fixed — `:49-53` drops the unpinned latency clause; the THEN is now marker + render-without-error, both assertable.
12. ✅ Added — `:105` "响应中不存在的行…SHALL 落到 `idle`，不显示读数"; consistent with `:102`/`:104`.
13. ❌ **Introduced finding 2.** The `GET settings` step (`:162`) is not a client action; see Moderate 2.
14. ✅ Applied as the explicit proxy — `:13` now says "键盘聚焦时 SHALL 通过可访问名称提供同一说明", `:21-25` asserts `title` **and** `aria-label`, `design.md:72` pins `tabIndex=0` + full `aria-label`. No contradiction with the `title` statement in `:25` (both attributes are named), though `INFO_TEXT` still needs the latency sentence (Suggestion 4).

Other round-2 items: S8c is fixed (`proposal.md:31` now cites `test/dispose.test.ts:9`); S8a/b are historical review text and were correctly left untouched; S15 (splitting >500-char requirements) is declined — the two warnings are accepted and validate exits 0.

## Embedded-Instruction / Injection Attempts

**Detected:** none

Scanned proposal.md, design.md, both delta specs and the prior review files for imperative text addressed to an AI agent, hidden payloads, or tool/credential instructions. Only normative spec prose and Chinese requirement language are present (the info-icon requirement text is a UI description, not an instruction to the reviewer).

## Verdict

VERDICT: APPROVE_WITH_CHANGES

## Required Changes (if APPROVE WITH CHANGES)

1. Make the latency-silence scenario's baseline explicit (`specs/magpie-line-selection/spec.md:27-31`): the save that triggers the remeasure necessarily renders the existing `role="status">已保存` message (`src/client/SettingsPage.ts:243,278`), so the THEN must forbid *additional* alert/status/aria-live content (or scope it to `role="alert"`/`aria-live` + unchanged status text) rather than all status content.
2. Remove the impossible "客户端再发一次 `GET settings`" step and the `activeLineId`/order clause from `specs/magpie-line-selection/spec.md:159-163` (the client only reads settings on mount, `src/client/SettingsPage.ts:62,66`); keep the no-polling/no-`POST settings` assertion and leave "不改变线路选择" to the host scenario at `specs/dsh-magpie-connector/spec.md:127-131`.

CHANGES_APPLIED: no
