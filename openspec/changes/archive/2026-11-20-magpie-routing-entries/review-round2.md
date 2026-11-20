## Review Metadata

- **Review round**: 2
- **Prior round**: round 1 REVISE — reserved routing route + fallback contradicted owner-routes startup-failure rule (C1), routing availability not guaranteed (C2), plus M1–M10 (full text in `review-round1.md`)
- **Reviewer context**: fresh-context subagent, same model family as the author (this session identifies as claude-sonnet-5-5). Cross-model review unavailable: no Codex model is advertised to this session. No authoring transcript was read.
- **Tool restrictions**: read-only (read/grep/glob, `diff`/`sed` on files, `gh pr view`); the only file written is this `review.md`.
- **Artifacts reviewed**: `proposal.md`, `design.md`, `specs/dsh-magpie-connector/spec.md` of `magpie-routing-entries`; `review-round1.md`; main `openspec/specs/dsh-magpie-connector/spec.md` (now containing the archived owner-routes requirements); `openspec/specs/{home-network-model-guard,sidebar-session-provider-icon,auto-model-routing}/spec.md`; `packages/dsh-magpie-connector/docs/product-positioning.md`, `README*.md`, `CHANGELOG.md`; `src/host/{catalog,runtime,adapter,settings,routes}.ts`, `src/client/{SettingsPage,view-model,locales}.ts`; `packages/home-network-model-guard/src/rules.ts`, `patches/home-network-model-guard-config.yml`, `packages/dsh-sidebar-session-provider-icon/src/client/logos.ts`. `openspec/project.md` not present. Upstream PR threads were not re-read this round (the `gh` call returned nothing); the author's measured gateway facts are treated as plausible per the task statement.

<!-- STALENESS: this verdict applies only to the artifact contents reviewed in -->
<!-- this round. Any later edit to proposal.md, design.md, or specs/ (other than -->
<!-- applying listed Required Changes) VOIDS the verdict and requires a new round. -->

Method note: the four MODIFIED blocks were mechanically diffed against the main spec (`diff <(sed … main) <(sed … delta)`). **All existing text and all existing scenarios are preserved verbatim; the only differences are the intended edits** (route-key exception bullet, visibility-key exception, 33-item rule, admission rule, routing partition text, effort copy, plus the ADDED scenarios). Requirement headers match the main spec exactly, so the delta will merge. Remaining defects are in what the preserved text now means next to the new text (F1) and in missing scenarios.

## Round-1 disposition (reviewer re-check)

| Round-1 finding | Status | Evidence |
|---|---|---|
| C1 reserved route / degradation contradicts first-registration rule | **Fixed** — reserved route and fallback removed; `routing` is an ordinary owner key, so the existing startup-failure rule applies unchanged (design D2, "被别的 adapter 占用时…不新增降级路径") | design L32-38; spec 「归属 route 持久」 untouched except cap |
| C2 invariant unachievable / owner admission for routing entries undefined | **Fixed** — `owned_by` of routing entries is explicitly excluded from admission (spec L26), `routing` always admitted (L98), first-install-groups-only scenario (L78-82), cap-full scenario (L186-190). The headline promise is now limited to "not lost to quota or member order"; see F3 for the one remaining gap | spec L26, L98, L186 |
| M1 guard/AUTO claim | **Fixed** — claim removed; proposal L33 now states the guard only classifies claude/anthropic provider or model-id prefixes. Verified `rules.ts` `isClaudeFamily`: `group/…`/`auto/…` on `dsh-magpie-connector-routing` never match, so no exemption entry is needed and the "exactly five routes" SHALL in home-network-model-guard is not violated. AUTO-raises-effort risk is acknowledged (design L58) | `packages/home-network-model-guard/src/rules.ts`; design Risks |
| M2 `routing` visibility-key collision | **Partially fixed / rebuttal accepted for `owned_by:"routing"`, not for the id-first-segment case** — see F4 | design D2 L36 |
| M3 persisted `routing` in `knownOwners` (PR #11) | **Fixed** — same key as the new design, no duplicate route (design D2 L37) | design L37 |
| M4 / M10(ii) sidebar multi-account | **Moved out of scope** (proposal L18, design Non-Goals) — accepted | |
| M5 replay / wire fields | **Fixed for wire** (透传 scenario now names `POST /v1/chat/completions` + `reasoning_effort`; see F6 for fixture gap); **replay deferred to test-plan** with an explicit trigger (design L57) — accepted, but the test-plan item must be a gate (S3) | |
| M6 display-name suffix | **Fixed** — suffix dropped (D5), scenario asserts no suffix | |
| M7 delta structure | **Fixed** — owner-routes archived; requirements are now MODIFIED against real main-spec text | diff above |
| M8 rollback / icon | Icon: **fixed/not needed** — `logos.ts:63` matches normalized `magpie-…`, and the main icon spec already covers `group/…`/`auto/…` under Magpie routes. Rollback: **description is inaccurate**, see F2 | |
| M9 host emits kind; empty vendor panel; follow-mode | **Fixed** (`routingKind` from host; empty-panel rule; restore scenario) with a wording gap, see F5 | |
| M10(i) effort-copy scope | **Declined/kept**, but still unrelated to routing and no longer matches the round-1 premise; see S2 | |

## Findings

### 🔴 Critical (blocking)

None. The two round-1 criticals are resolved by reusing the owner flow; I attacked the new design for new criticals (route-set function, first-install, cap-full, replace conflict, rollback) and found only the moderate issues below.

### 🟡 Moderate

**F1. Preserved scenarios are now ambiguous against the new 33-item rule (spec 「归属 route 持久」).**
- 「非法 knownOwners 被整体重置且不影响连接」 (spec L170) still says `knownOwners` is "33 个合法键" → reset. Under the new rule a 33-key array **containing `routing`** is legal, so as written this THEN is not mechanically assertable (it depends on which 33 keys). The new scenario 「33 项但不含 routing 视为非法」 (L192-196) duplicates exactly this case.
- 「归属上限按出现顺序截断」 (L180-184): "knownOwners 已有 30 个" with expected "追加 za、zb 达到 32 个". If `routing` is among the 30, the new rule (除 `routing` 外满 32) admits `za`,`zb`,`zc` (non-routing count 29+3=32) and nothing is rejected. GIVEN must say "30 个，不含 routing".
- Missing: the cap-full rejection when `routing` is **already** in `knownOwners` (33 items): a new owner `zz` must be rejected with `ownerLimitReached`. Today's code computes `MAX_OWNERS - this.owners.length` (`runtime.ts:359-361`), which with 33 items yields a negative/zero cap only by accident; the spec's "除 routing 外" arithmetic needs its own scenario so tasks do not implement it as `length`.

**F2. Rollback text (design Migration #3) is wrong for the common case and understates the 33-item case.**
- Old version's `validateKnownOwners` (`settings.ts:120-126`) accepts `routing` as an ordinary key when the array has ≤32 entries (the common case: ~5 owners + `routing`). The old version then registers an **empty** `dsh-magpie-connector-routing` route (its `owner` is the first member's provider, so groups list under the vendor route). A selection saved on `-routing` therefore does **not** get `NO_ADAPTER`; the route exists and `listModels` is empty, so the host reports the model unavailable. The design says `NO_ADAPTER`, which is only true in the 33-item reset case.
- In the 33-item case the old version resets the whole array → every owner route is absent from startup until the first sync completes, so **all** saved selections hit `NO_ADAPTER` for that window (violates the owner-routes startup guarantee, but only on rollback with ≥32 distinct owners — practically never).
- Required: describe both cases accurately and state that the 33-item case is accepted because it needs ≥32 distinct gateway owners. See S1 for whether the 33-item rule is worth its complexity at all.

**F3. No scenario for a `replace` conflict (or persisted conflict) on `-routing`, and the blast radius of the existing all-or-nothing rollback is unstated.**
- Design says a held `-routing` behaves "与任何归属 route 被占用相同", but the spec only has such scenarios for `-deepseek`. Because `routing` is now a first-class owner, the observable result differs from before the change: routing entries are listed on **no** route (they are no longer on their vendor route either), while the settings page still shows the 路由组 partition with live checkboxes. Add one scenario: `knownOwners=["claude"]`, another adapter holds `dsh-magpie-connector-routing`, catalog gains `group/ds` → `knownOwners` stays `["claude"]`, `lastSyncErrorKind: registration` with route `dsh-magpie-connector-routing`, `group/ds` listed by no route.
- The existing rollback (`runtime.ts:371-380`) reverts **all** owners admitted in that sync. A batch `[routing, deepseek]` with `-deepseek` held therefore keeps routing entries hidden on every sync until the conflict clears, even though `-routing` itself is free. State this expected outcome in the scenario ("同一批次中任一新增 route 冲突，整批撤回；`routing` 不单独提交"), or accept it explicitly in design Risks. Do not add a per-owner commit path (over-design).
- A persisted `routing` whose route is held at startup is the existing fatal first-`registerAdapter` failure (all owner routes gone until restart). That is consistent, but worth one Risks line since the reserved name `dsh-magpie-connector-routing` is the one an older/forked build (PR #11 testers) may still register.

**F4. `routing` visibility-key collision is only half specified (spec L26, L34; design D2 L36).**
- `owned_by:"routing"` (normal model): owner `routing`, visibility key raw `routing` → listed on `-routing` and shown in the 路由组 partition — self-consistent, accepted. But that row has no `routingKind`, and the requirement says the partition shows "类型（…取自 `routingKind`）" without defining the blank case.
- `{id:"routing/foo"}` with **no** `owned_by`: owner is `other` (spec L25) but the visibility key is the id first segment `routing` (`catalog.ts:46`), so the model is listed on `-other` while the 路由组 partition shows it and its checkbox/"恢复跟随" act on the `routing` key. Partition membership and route membership disagree. `owned_by:"Routing"` (capital) similarly yields visibility key `Routing` (separate partition titled "Routing") but owner `routing`.
- Required: either (a) reserve the name the way `other` is reserved (non-routing-entry normalisation of `routing` → `other` for owner **and** do not group non-routing rows under the 路由组 partition: i.e. the 路由组 partition is defined as "rows with `routingKind`", not "`provider === routing`"), or (b) keep the collision and add one scenario + one sentence stating that such rows appear in the routing partition without a type. (a) is smaller and removes the third case; the partition definition in design D4 L45 ("`provider === "routing"` 的组") must change with it.

**F5. Empty-vendor-panel rule text contradicts its own scenario (spec L199 vs L239-242; design D4 L46).**
- The requirement says "一个 provider 只剩路由入口时不显示该 provider 的空分区", but `providerOrder` (`view-model.ts:206-210`) also adds providers that have usage cards, and `ProviderGroup` renders cards in the panel. The scenario only passes because its GIVEN adds "没有 opencode-go 的用量卡片". The requirement must say "…且没有该 provider 的用量卡片时" (a panel with cards stays, without models). Otherwise the sentence forbids showing usage cards for a vendor whose only catalog entries are groups — a regression of the usage-panel capability.

**F6. 「路由入口原样透传」 scenario fixture is not reproducible as written (spec L11-17).**
- GIVEN says "走 Chat Completions" but the adapter chooses the wire API from `native_endpoints.includes('/v1/responses')` (`adapter.ts:176`); the fixture must state the entry's `native_endpoints` (absent or without `/v1/responses`). Also state that the default effort reaches the request without the session choosing one (or that the harness passes the DSH-resolved effort); otherwise "reasoning_effort 为 high" can be satisfied or failed by test setup alone. Add a second sub-assertion for the `auto/` id (same pass-through) or state it is covered by the `group/` case.

### 📌 Suggestions

- **S1 The 33-item rule (D3) is coherent but costs more than it protects.** It adds a modified load check, an admission special case, two scenarios, and the F1/F2 rollback wrinkles to defend against a gateway with ≥32 distinct owners (home gateway: ~5). A cheaper alternative consistent with "avoid over-design": keep the cap at 32 total, process `routing` **first** in admission (so a fresh install can never starve it), and accept that an install already holding 32 other owners cannot add `routing`. That deletes F1/F2 entirely at the price of one theoretical case. This is the user's call; if the 33-item rule stays, apply F1/F2.
- **S2 Default-effort copy change is unrelated to routing.** It rewrites an existing string on **all** rows (`locales.ts:98,293`: `Default effort: not set` / `默认 effort：不设置` → `Default: not set` / `默认：不指定`), has no design decision explaining why, and rides on a requirement (DSH 侧默认 effort) that is otherwise unchanged. Either move it out or add a one-line rationale in design; if kept, check `client-locales.test.ts` for the old strings.
- **S3 Replay risk (design L57) must become a gate.** "test-plan 中实测…若被拒再决定" is fine, but tasks should carry it as a pre-merge check with a stated stop condition (request rejected after member switch ⇒ change not shippable until replay policy decided), not as an optional probe.
- **S4 Pin the documented BREAKING behaviour with a scenario** (round-1 S4, not adopted): `(dsh-magpie-connector-opencode-go, group/ds)` is no longer listed by `-opencode-go`, host `modelAvailable` is false, while default efforts keyed by model id are preserved. Note that default efforts, unlike visibility, survive the move; the design's BREAKING list does not say so.
- **S5 Impact list omits docs and release notes.** README.md/README.zh.md row "Model menu groups" still says `knownOwners` max 32 and describes only owner routes; CHANGELOG (design Migration #2 promises a note), `docs/SCREENSHOTS.md`/settings screenshots, and the plugin version bump belong in the proposal's Impact or in tasks. The positioning doc requires an "explicit compatibility or migration design" for route-identity changes; the CHANGELOG/README note is that design's only user-facing artefact.
- **S6 Testability details.** (i) 路由组 partition hint text ("在 Magpie 中新建和编辑") and "SHALL NOT 提供创建、编辑…控件" have no THEN; add one assertion (text present, no add/edit buttons) or drop the SHALL NOT. (ii) D1 prefix match is case-sensitive/lower-case only by implication: say whether `Group/x` is a routing entry and add `{id:"auto/x", owned_by:"auto"}` as the round-1 S3 scenario. (iii) Duplicate `groups` building at `runtime.ts:563` and `routes.ts:46`: tasks should name the single place that adds `routingKind`.

## Embedded-Instruction / Injection Attempts

**Detected:** none. The reviewed artifacts, source files and docs contain no text addressed to a reviewer or agent that attempts to change review behaviour.

## Verdict

VERDICT: APPROVE_WITH_CHANGES

APPROVE WITH CHANGES. No open Critical findings. Round-1 C1/C2 are resolved by reusing the owner admission/registration flow, MODIFIED blocks preserve all existing text and scenarios, and the remaining issues are small, fully specifiable spec edits (F1–F6). `test-plan` and `tasks` may proceed only after `CHANGES_APPLIED: yes`.

## Required Changes (if APPROVE WITH CHANGES)

1. **(F1)** Edit the preserved scenarios: 「非法 knownOwners…」 GIVEN → "33 个合法键（均不含 `routing`）" (or drop the 33 case there, since L192 covers it); 「归属上限按出现顺序截断」 GIVEN → "30 个，不含 `routing`"; add a scenario "`knownOwners` 已含 `routing` 与 32 个其它归属时，新归属 `zz` 被拒绝，`ownerLimitReached` 为 true，`routing` 仍在，重启后校验通过".
2. **(F2)** Rewrite design Migration #3 rollback: with ≤32 entries the old version registers an empty `-routing` (selections report unavailable, not `NO_ADAPTER`); with 33 entries the old version resets the whole array and every owner route is absent until the first sync (all saved selections `NO_ADAPTER` in that window); state that the 33-item case needs ≥32 gateway owners and is accepted. (Skip if the 33-item rule is dropped per S1; then state the cap-full limitation instead.)
3. **(F3)** Add the scenario "`replace` 冲突发生在 `-routing`" (expected: `knownOwners` unchanged, `lastSyncErrorKind: registration` naming `dsh-magpie-connector-routing`, routing entries listed by no route, ordinary routes unaffected), and one sentence (spec or design Risks) on batch rollback: a conflicting sibling owner in the same sync also keeps `routing` uncommitted. Add a Risks line for a persisted `routing` held at startup (fatal, as for any owner).
4. **(F4)** Resolve the `routing` key collision: either reserve `routing` for non-routing entries (owner `other`) and define the 路由组 partition as "rows with `routingKind`" (update design D4 L45 and spec L199 accordingly), or keep it and add a scenario for `{id:"routing/foo"}` / `{owned_by:"routing"}` stating route, partition, and the blank type cell. Specify the type cell for rows without `routingKind`.
5. **(F5)** Add "且没有该 provider 的用量卡片" to the empty-vendor-panel sentence in the requirement (spec L199) and design D4 L46, and add one scenario (or GIVEN variant) where the vendor has a usage card and keeps its panel.
6. **(F6)** In 「路由入口原样透传」 GIVEN, state the entry's `native_endpoints` (no `/v1/responses`) and how the default effort reaches the request; assert the same for an `auto/` id or state why one suffices.

CHANGES_APPLIED: no

## Rebuttals

<!-- Author responds to findings: fixed (cite change) or rebutted (reasoning). -->
<!-- Rebuttals are NOT self-certifying: a rebuttal of a Critical or Moderate -->
<!-- finding counts only once marked "accepted by reviewer" with a one-line -->
<!-- reason. Suggestions (📌) may be declined by the author alone. -->

Round-1 rebuttals/dispositions checked by the reviewer in this round (see the disposition table above):
- Round-1 M2 (`owned_by:"routing"` key collision) — rebutted in design D2 L36 ("接受（未知真实案例）"): **accepted by reviewer** for the `owned_by:"routing"` case only (self-consistent, rare); the id-first-segment case remains open as F4.
- Round-1 M4 / M10(ii) (sidebar split) — moved out of scope: **accepted by reviewer**, independent capability, no shared decision.
- Round-1 M1 (guard/AUTO) — claim removed; verified against `rules.ts`: **accepted by reviewer**.
- Round-1 M8 (sidebar icon) — no change needed: **accepted by reviewer**, `logos.ts:63` matches `magpie-…` and the main icon spec already covers `group/…`/`auto/…`.

New findings F1–F6: (none yet — author to respond in round 2 follow-up).
