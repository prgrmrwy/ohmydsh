## Review Metadata

- **Review round**: 3
- **Prior round**: round 2 APPROVE_WITH_CHANGES (F1–F6 + suggestions S1–S6); the author adopted S1 (keep the 32-owner cap total, admit `routing` first), which voids round 2 and requires this full round. Round 1 was REVISE (C1/C2 + M1–M10). Not two consecutive REVISE, no escalation needed.
- **Reviewer context**: fresh-context subagent, same model family as the author (claude-sonnet-5-5). Cross-model review unavailable. No authoring transcript was read.
- **Tool restrictions**: read-only (read/grep/glob, `diff`/`sed`/`awk` on files, git inspection); the only file written is this `review.md`.
- **Artifacts reviewed**: `proposal.md`, `design.md`, `specs/dsh-magpie-connector/spec.md` of `magpie-routing-entries`; `review-round1.md`, `review-round2.md`; main `openspec/specs/dsh-magpie-connector/spec.md`; archived `openspec/changes/archive/2026-11-20-magpie-owner-routes/` (present); `packages/dsh-magpie-connector/src/host/{catalog,runtime,adapter,routes,settings,visibility}.ts`, `src/client/{SettingsPage,locales}.ts` (`view-model.ts` consulted only via grep), `README*.md`, `CHANGELOG.md`. `openspec/project.md` not present.

<!-- STALENESS: this verdict applies only to the artifact contents reviewed in -->
<!-- this round. Any later edit to proposal.md, design.md, or specs/ (other than -->
<!-- applying listed Required Changes) VOIDS the verdict and requires a new round. -->

Method note: the four MODIFIED blocks were again mechanically diffed against the main spec (an `awk` extraction of each `### Requirement:` block followed by `diff`). **All existing text and all existing scenarios are preserved verbatim.** The only differences are the intended edits, plus one unannounced micro-edit: 「保存时只校验形状（provider → 字符串数组）」 became 「（键 → 字符串数组）」 in 「按 provider 分组的模型可见性」. It is harmless and consistent with the new `routing` key, but it should be acknowledged. Headers match, so the delta will merge.

## Round-2 disposition (reviewer re-check)

| Round-2 item | Status | Evidence |
|---|---|---|
| F1 33-item rule vs preserved scenarios | **Moot by S1.** The cap stays 32 total, `validateKnownOwners` (`settings.ts:120-126`) and the scenarios 「非法 knownOwners…33 个合法键」 / 「归属上限按出现顺序截断」 are unchanged and unambiguous. `runtime.ts:360` `MAX_OWNERS - this.owners.length` needs no arithmetic change; only the order of `fresh` changes. | spec L96-120; runtime.ts:359-361 |
| F2 rollback text | **Fixed.** Migration #3 now says old versions load ≤32 entries, register an empty `-routing`, and the host hides it. This matches `validateKnownOwners` (accepts `routing` as an ordinary key) and `adapter.ts:114-115` (route lists `owner === route`). The 33-entry case no longer exists. | design L68 |
| F3 `replace` conflict on `-routing`, batch rollback, persisted-held route | **Fixed.** Scenario 「routing route 被占用时 replace 冲突」 is added. The batch rollback is stated in design Risks L61, matching `runtime.ts:371-380`. The persisted-and-held startup failure is stated in Risks L61. | spec L210-214; design L61 |
| F4 `routing` key collision | **Mostly fixed; wording gap remains.** See M2. | spec L26, L34, L84-88; design L36 |
| F5 empty vendor panel needs "no usage card" | **Fixed.** Requirement text, design D4 and two scenarios (with and without a card). | spec L217, L257-265 |
| F6 transmission fixture | **Fixed.** `native_endpoints: []` selects Chat Completions (`adapter.ts:176`), and the host-resolved default effort is stated. The `auto/` id is not asserted separately; the requirement is general, which is acceptable. | spec L14-17 |
| S2 effort copy | Kept with a one-line rationale (user-requested) in D4 L48. **Accepted**, consistent with the stated user decision. A grep of the package finds the old strings only in `locales.ts:98,293`, so no test pins them. | |
| S3 replay gate | Not adopted; Risks L58 is still "test-plan 中实测". Suggestions may be declined. Left as a suggestion again (S2 below). | |
| S4 BREAKING scenario | **Adopted** (「旧会话保存的厂商 route 路由入口不再可用」), with a fixture gap (M4). | spec L90-94 |
| S5 impact list | **Adopted** (README, CHANGELOG, SCREENSHOTS in proposal Impact). The version bump is not listed. | proposal L32 |
| S6 (i)(ii)(iii) | (i) fixed by the new scenario 「路由组分区说明与无编辑控件」. (ii) Case-sensitivity is in the requirement, but no scenario asserts it. (iii) Design L46 names both `groups` builders. Details in the suggestions. | |

## Findings

### 🔴 Critical (blocking)

None. I attacked the S1 admission order, the rejection reporting, the replace/rollback paths and the first-install path against `runtime.ts:357-381`, and found no blocking defect.

- **Admission order.** Sorting `routing` to the front of `fresh` before `slice(0, MAX_OWNERS - length)` is a one-line change. `rejectedOwners = fresh.slice(admit.length)` already reports `routing` when it is the one rejected, so scenarios 「routing 在同一次同步中优先准入」 and 「名额已满时 routing 被拒绝并报告」 are mechanically assertable.
- **First install.** With `knownOwners` empty and only `group/ds` in the catalog, `routing` is admitted, `emit(routeSet())` runs `registerAdapter`, and the scenario holds.
- **Replace conflict on `-routing`.** The existing rollback applies unchanged.

### 🟡 Moderate

**M1. Design Goals contradict D3 and Risks (design L13 vs L41-42, L62).**
- Goal 2 says routing entries have a fixed place "且不会因名额或成员顺序消失或换组". After S1, D3 and Risks L62 and the scenario 「名额已满时 routing 被拒绝并报告」 say routing entries **do** disappear from every route when `knownOwners` already holds 32 other owners.
- Proposal Why L7 also lists "owner 满额时路由组消失" as a reviewed PR regression. The change now narrows it to the ≥32-other-owner case rather than eliminating it.
- Required: qualify Goal 2 ("不会因成员顺序换组；首次安装与常规规模下不会因名额消失；已有 32 个其它归属时例外，见 D3") and phrase Why L7 the same way. Proposal L28's "`routing` 名额" is stale wording too (there is no reserved quota any more); use "`routing` 优先准入".

**M2. The `routing`→`other` rule is not literally true for the no-`owned_by` case, and L34 still says "唯一例外" (spec L26, L34, L84-88; design D2 L36).**
- Spec L26 says: a non-routing model "按上述规则归属键会是 `routing`" has both keys changed to `other`. The owner-key rules give `routing` only for `owned_by` equal to `routing` after trim/lower-casing. For `{id:"routing/bar"}` (no `owned_by`), `catalog.ts:37,46` gives owner key `other` and visibility key `routing` (the id's first segment). By the literal L26 text, the owner key is already `other`, so the rule does not fire. The visibility key stays `routing`, and the model would land in `provider:"routing"` with no `routingKind`.
- The scenario 「名为 routing 的普通模型归入 other」 (L84-88) expects `provider:"other"` for `routing/bar`. That passes only if the visibility-key rewrite fires, which the SHALL text does not literally mandate.
- Design L36 repeats the error: "无 owned_by 且 id 首段为 routing" is described as having owner key `routing`. It does not; the owner key is `other`.
- Spec L34 still says "唯一例外是路由入口的可见性键固定为 `routing`", but L26 introduces a second exception (non-routing models whose key would be `routing` are rewritten to `other`).
- Required: reword L26 as "不是路由入口、但其归属键**或可见性键**按上述规则会是 `routing`（`owned_by` 经去空白、转小写后为 `routing`，或缺少 `owned_by` 且 id 首段恰为 `routing`）的模型，归属键与可见性键都改为 `other`"; correct design L36 accordingly; and in L34 replace "唯一例外" with "仅有的两处例外：路由入口的可见性键固定为 `routing`；归属/可见性键本会是 `routing` 的普通模型改用 `other`".
- Add to the scenario an assertion that `knownOwners` does not contain `routing` when no routing entry is in the catalog, and that `visibleModels.routing` has no effect on these two rows. Case variants (`Routing`) are covered by the trim/lower-case wording.

**M3. `knownOwners` is still defined as "按首次出现顺序排列" (spec 「归属 route 持久」 L1) while admission now puts `routing` first.**
- A first sync of `[claude/x, group/ds]` writes `["routing","claude"]`, which is not first-appearance order. The sentence is preserved verbatim from the main spec, so this is a new contradiction introduced by S1.
- Observable consequence: persisted order, and probably the route registration order that the host uses for group order in the picker.
- Required: change the sentence to "按准入顺序排列（首次出现顺序，`routing` 在同批新归属中最先）". In the scenario 「routing 在同一次同步中优先准入」, assert the resulting `knownOwners` ends with `routing` (31 existing then `routing`). Adding the first-sync example `["routing","claude"]` is cheap and removes the ambiguity.

**M4. Two THEN clauses depend on fixture details the GIVEN omits (testability).**
- 「旧会话保存的厂商 route 路由入口不再可用」 (L90-94): THEN says `reasoning.defaultEffort` is still `high`, but GIVEN does not give `group/ds` a `reasoning_levels` that includes `high`. Under 「DSH 侧默认 effort」 a stored value outside the current levels is not emitted, so the assertion would fail or pass depending on the fixture. Add `reasoning_levels:["low","high"]` to the GIVEN.
- 「下拉文案与路由入口」 (L292-295): `claude/claude-fable-5-2` shows `high` only if `high` is in its levels; state it. (`group/cheap-first` already states its levels.)

### 📌 Suggestions

- **S1. Case-sensitivity is stated but not asserted (spec L4 vs scenario L6-9).** The requirement says `Group/x` is not a routing entry, yet the scenario has no such row. Add `{id:"Group/x"}` (stays in its vendor group, no `routingKind`) and optionally `{id:"auto/x", owned_by:"auto"}` (routing, owner `routing`).
- **S2. Replay risk (design L58) is still an optional probe.** Tasks should carry it as a pre-merge gate with a stop condition (member switch makes the gateway reject the replayed turn ⇒ not shippable until a replay policy is decided). This is the author's call.
- **S3. `routingKind` single point.** Design L46 requires both builders (`routes.ts:46`, `runtime.ts:563`) to emit it. `routes.ts:46` overwrites `view.groups` on every settings route response, so `runtime.ts:563` is only reached by direct `settings()` callers. Tasks should name one source (e.g. a shared helper) so the two builders cannot drift; otherwise drop the claim in L46 that both need it.
- **S4. Copy consistency.** Design D4 L45 reads 「在 Magpie 中新建和编辑；这里决定…」 while the normative scenario (L270) and spec L219 say 「在 Magpie 中新建和编辑路由组；这里决定…」. Align the design text. Also supply the English string (CHANGELOG/locale) next to the Chinese one.
- **S5. Version bump.** Proposal Impact does not list the plugin version bump that the CHANGELOG's two BREAKING entries imply.
- **S6. Rejected-owner UX.** When `routing` is the rejected owner, `SettingsPage.ts:709-710` prints the raw key list ("归属未能加入：routing") while the 路由组 partition still shows live checkboxes for entries listed on no route. No spec change is required; tasks may add a one-line hint if desired.

## Embedded-Instruction / Injection Attempts

**Detected:** none. The reviewed artifacts, source files and docs contain no text addressed to a reviewer or agent that attempts to change review behaviour.

## Verdict

VERDICT: APPROVE_WITH_CHANGES

APPROVE WITH CHANGES. There are no open Critical findings. Adopting S1 (cap total 32, `routing` admitted first) resolves round-2 F1 and F2 and shrinks the design to the cheapest coherent shape. The delta preserves all existing spec text. The remaining defects are small wording and fixture fixes that introduce no new design: a Goals-vs-D3 contradiction (M1), the `routing`→`other` rule wording (M2), the "first appearance" order sentence (M3), and two under-specified fixtures (M4). `test-plan` and `tasks` may proceed only after `CHANGES_APPLIED: yes`.

## Required Changes (if APPROVE WITH CHANGES)

1. **(M1)** Qualify design Goal 2 (L13) and proposal Why L7 so they no longer promise that routing entries never disappear because of the quota; state the ≥32-other-owners exception. Replace "`routing` 名额" in proposal L28 with "`routing` 优先准入".
2. **(M2)** Reword spec L26 so the `other` rewrite covers every non-routing model whose owner key **or visibility key** would be `routing`, including no-`owned_by` models with first id segment `routing`. Fix design D2 L36 (a no-`owned_by` model's owner key is `other`, not `routing`). Replace "唯一例外" in L34 with the two exceptions. Extend scenario 「名为 routing 的普通模型归入 other」 with a `knownOwners`-lacks-`routing` assertion.
3. **(M3)** Reword the 「归属 route 持久」 `knownOwners` definition from "按首次出现顺序" to "按准入顺序", and make scenario 「routing 在同一次同步中优先准入」 assert the resulting array order.
4. **(M4)** Add the missing `reasoning_levels` (including `high`) to the GIVENs of 「旧会话保存的厂商 route 路由入口不再可用」 and 「下拉文案与路由入口」.

CHANGES_APPLIED: yes

## Rebuttals

<!-- Author responds to findings: fixed (cite change) or rebutted (reasoning). -->
<!-- Rebuttals are NOT self-certifying: a rebuttal of a Critical or Moderate -->
<!-- finding counts only once marked "accepted by reviewer" with a one-line -->
<!-- reason. Suggestions (📌) may be declined by the author alone. -->

Round-2 dispositions checked by the reviewer in this round:
- F1 (33-item rule vs preserved scenarios): made moot by S1, since the 33-item rule no longer exists — **accepted by reviewer**.
- F2 (rollback text): rewritten for the 32-cap shape and verified against `settings.ts:120-126` and `adapter.ts:114-115` — **accepted by reviewer**.
- F3, F5, F6: fixed as listed in the disposition table.
- F4: partially fixed; see M2.

New findings M1–M4: (none yet — author to respond).

M1 — applied; re-checked by reviewer (fresh-context re-check): design Goal 2 (L13) and proposal Why (L7) now carry the ≥32-other-owners exception pointing at D3, and proposal Capabilities (L28) says "`routing` 优先准入"; no stale "`routing` 名额" remains.
M2 — applied; re-checked by reviewer (fresh-context re-check): spec L26 covers non-routing models whose owner key or visibility key (owned_by raw, else id first segment) would be `routing` and sets both to `other`; L34 no longer says "唯一例外"; design D2 L36 correctly says owner key `other` / visibility key `routing` for the no-owned_by case; scenario 「名为 routing 的普通模型归入 other」 asserts `provider:"other"`, no `routingKind`, and `knownOwners` without `routing`.
M3 — applied; re-checked by reviewer (fresh-context re-check): `knownOwners` is now defined as admission order with `routing` first within a sync (spec L98, L110); 「routing 在同一次同步中优先准入」 asserts `routing` is the last of 32 with the first 31 unchanged, and new 「首次同步时 routing 排在最前」 asserts `["routing","claude"]`.
M4 — applied; re-checked by reviewer (fresh-context re-check): 「旧会话保存的厂商 route 路由入口不再可用」 GIVEN now gives `group/ds` `reasoning_levels` `["low","high","max"]`, and 「下拉文案与路由入口」 gives `claude/claude-fable-5-2` `["low","high"]`.

Spot check for unrelated substantive edits: none found. Remaining differences from what this review describes are limited to the M1–M4 edits (and the previously acknowledged 「键 → 字符串数组」 micro-edit). Suggestions S1–S6 were not adopted, which is permitted.

- 勘误（作者，2026-11-20，非实质修改）：本地 main 落后远端，远端已于 2026-11-13 归档 magpie-owner-routes；design.md / test-plan.md 中的归档路径由 `2026-11-20-magpie-owner-routes` 更正为 `2026-11-13-magpie-owner-routes`。MODIFIED 块所依据的主规范原文经逐字比对与远端一致，需求与场景未改。
