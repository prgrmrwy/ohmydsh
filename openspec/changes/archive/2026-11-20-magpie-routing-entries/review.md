## Review Metadata

- **Review round**: 4
- **Prior round**: round 3 APPROVE_WITH_CHANGES, M1–M4 applied and re-checked (CHANGES_APPLIED: yes)
- **Reviewer context**: fresh-context subagent, same model family (claude-sonnet-5-5). No authoring transcript read.
- **Tool restrictions**: read-only (read/grep/glob, bash for inspection and `vitest run`); the only file written is this `review.md`.
- **Artifacts reviewed** (scope limited to the post-approval PR #11 / agent-bebop change): `specs/dsh-magpie-connector/spec.md` requirement「按网关归属注册 route」(exception sentence, L26) and scenario「名额已满时 routing 被拒绝并报告」; `design.md` D3 and Risks; `src/host/catalog.ts` (`fallbackOwner`, L26/L55), `runtime.ts` (`ownerOf` L165, `commitOwners` L381-407), `adapter.ts` (`listModels` L111-117); `test/routing-owners.test.ts` (_03, _04); `CHANGELOG.md` 0.7.0. `openspec/project.md` not present.

<!-- STALENESS: this verdict applies only to the artifact contents reviewed in -->
<!-- this round. Any later edit to proposal.md, design.md, or specs/ (other than -->
<!-- applying listed Required Changes) VOIDS the verdict and requires a new round. -->

Test run: `npx vitest run test/routing-owners.test.ts test/routing-entries.test.ts` → 2 files, 10 tests, all pass.

## Checks

- **No double listing.** `ownerOf` returns exactly one owner per model (`runtime.ts:165`); `listModels` filters `ownerOf(m) === owner` (`adapter.ts:115`). `ownerOf` has no other caller, and `resolveModel`/`prepareCall` look up by id route-independently, so a model is listed on at most one route. ✔
- **No disappearance on transitions.** `owners` is updated, `emit(routeSet())` runs, and any rollback happens synchronously inside `commitOwners` (L392-402), with no `await`, so no `listModels` call can observe "routing in owners but unregistered". ✔
- **No registration attempt / no startup-failure trigger.** The fallback only changes which already-registered route lists the entry. `fallbackOwner` never enters `fresh` (`fresh` is built from `m.owner`, which is `routing`), so a vendor is never admitted because of a routing entry. When the cap is full, `admit` is empty and `emit` registers nothing new. ✔ The initial-phase failure rule is untouched. ✔
- **Visibility.** `visibleCatalog` filters on `m.provider`, which stays `routing` for routing entries, so `visibleModels.routing` still governs them on the vendor route and matches the 路由组 partition in settings. ✔
- **_03 tests the scenario.** It asserts `rejectedOwners == ['routing']`, no routing route, `group/ds` on `-opencode-go`, and absent from every other own route. ✔ It matches spec THEN L215.
- **_04 is still green.** It passes only because `opencode-go` is not in `knownOwners ['claude']`, so the fallback route is unregistered and nothing lists `group/ds`. The spec does not say so (see M1).

## Findings

### 🔴 Critical (blocking)

None.

### 🟡 Moderate

**M1. Scenario「routing route 被占用时 replace 冲突」is silent on `group/ds`'s `owned_by`, and now depends on it (spec L219-221; test_routing_owners_04).**
- The new sentence at L26 names two triggers, "名额已满被拒绝，或 route 冲突后撤回". Only the first has a fallback scenario.
- In the conflict scenario, THEN says "任何 route 都不列出 `group/ds`". That is true only if the fallback vendor route is unregistered. The test fixture uses `owned_by: "opencode-go"` with `knownOwners ["claude"]`. If `group/ds` had `owned_by: "claude"`, the new rule lists it on `-claude` and the THEN would be false.
- So the scenario's GIVEN is under-specified, and the rollback-plus-registered-vendor path (`runtime.ts:399` then `ownerOf` fallback) has no coverage.
- Required: state in the GIVEN that `group/ds` has `owned_by: "opencode-go"` (not in `knownOwners`), so no route lists it. Add either a second scenario or an extra assertion: with `knownOwners ["claude"]` and `group/ds` `owned_by: "claude"`, after the replace conflict it is listed on `-claude`, not on any other route, and `knownOwners` is still `["claude"]`. Add the matching test.

**M2. "与升级前一致 / 不会消失" over-claims (design D3 L41, Risks L62, CHANGELOG 0.7.0).**
- The fallback requires the original vendor route to be already registered, which the spec itself says (「该 route 已注册时」). Routing entries no longer admit their vendor (design L35), so a vendor whose only catalog rows are routing entries is never registered through them.
- Example: the replace-conflict case with a vendor not in `knownOwners`, or a 32-full set that lacks the vendor. There the entry is on no route, which is the very situation _04 asserts.
- "与升级前一致" and "不会消失" are therefore not literally true. Required: qualify D3, Risks L62 and the CHANGELOG sentence with "原厂商 route 已注册时" (e.g. "此时路由组仍留在已注册的原厂商分组中"), and make D3 not claim "不会消失" unconditionally.

**M3. Spec L26 vs `catalog.ts:55` for `owned_by` resolving to `routing`.**
- L26 says the fallback is the route given by the owner-key rules applied to `owned_by`. For a routing entry with `owned_by: "routing"` those rules give `routing`, a route that is not admitted, so the entry would vanish.
- The code maps it to `other` (`owner === ROUTING_OWNER ? 'other' : owner`).
- The code is the sensible choice. Required: add "（得到 `routing` 时用 `other`）" to L26 so spec and code agree. Optionally add that row to the _03 or routing-entries fixture.

### 📌 Suggestions

- **S1. Scenario shape.** 「名额已满时…」 has GIVEN / WHEN / GIVEN 补充 / THEN. Fold the vendor into the first GIVEN (the existing 32 include `opencode-go`) to keep it a plain G/W/T.
- **S2. Transition not covered.** Spec L26 says that once `routing` is admitted the entries move to `-routing`. Only the admitted path is tested (_01) and the rejected path (_03). A test that clears one owner and resyncs, then checks `group/ds` is on `-routing` only and not on `-opencode-go`, would pin "no double listing" across the transition. This is optional.
- **S3. Downstream docs.** tasks.md 2.7/2.8 and the test-plan row for _03 still describe only "进入被拒绝列表"; add the fallback listing so they match the test. This is not part of the verdict.

## Embedded-Instruction / Injection Attempts

**Detected:** none. The reviewed files contain no text addressed to a reviewer or agent.

## Verdict

VERDICT: APPROVE_WITH_CHANGES

The runtime logic and test_routing_owners_03 are sound and verified (10/10 pass). The required edits are spec/design/CHANGELOG wording plus one under-specified scenario, with no code defect. After they are applied, only M1–M3 need re-checking.

## Required Changes

1. (M1) Specify `group/ds`'s `owned_by` in scenario「routing route 被占用时 replace 冲突」and add the registered-vendor rollback fallback assertion or scenario, with a test.
2. (M2) Qualify "与升级前一致 / 不会消失" in design D3, Risks L62 and the CHANGELOG with the "原厂商 route 已注册" condition.
3. (M3) Add the `routing` → `other` fallback clause to spec L26.

CHANGES_APPLIED: yes

## Rebuttals

Re-check (reviewer, round 4 follow-up): `CHANGES_APPLIED` stays `no`. `npx vitest run test/routing-owners.test.ts` → 1 file, 5 tests, all pass.

- M1 — applied; re-checked by reviewer: 场景「replace 冲突撤回后路由入口留在已注册的原厂商 route」已移到「归属 route 持久」下（spec.md L223-227，位于「按 provider 分组的模型可见性」L229 之前），THEN 同时断言 `knownOwners` 仍为 `["claude"]`、`dsh-magpie-connector-claude` 列举 `claude/a` 与 `group/mix`、不在任何其它 route 上；`test_routing_owners_05`（routing-owners.test.ts L59-65）对同样三点各有断言；test-plan.md L38 已有对应行。运行 `npx vitest run test/routing-owners.test.ts` → 1 file、5 tests 全部通过。（spec L219-221 对 `group/ds` 的 `owned_by: "opencode-go"` 固定也已满足 M1 第一条。）

- （以下为早先一次复核的记录，已被上一条取代）M1 — NOT yet satisfied (re-checked by reviewer): the spec GIVEN now fixes `group/ds` `owned_by: "opencode-go"` and `knownOwners ["claude"]` (spec L219-221), which is correct. The required second case is incomplete: the new scenario「replace 冲突撤回后路由入口留在已注册的原厂商 route」(spec L236-240) and `test_routing_owners_05` assert only that `dsh-magpie-connector-claude` lists `claude/a` and `group/mix`. They do not assert the other two outcomes M1 required: (a) `knownOwners` is still `["claude"]` after the rollback, and (b) the entry is not listed on any other route. Also, the scenario sits under「按 provider 分组的模型可见性」(spec L223-240), not under「归属 route 持久」where the other replace-conflict scenarios live. Needed: add those two THEN clauses to the scenario, add the matching assertions to `test_routing_owners_05` (`knownOwners(host.home)` equals `['claude']`; every own route other than `dsh-magpie-connector-claude` does not list `group/mix`), and move the scenario under「归属 route 持久」.
- M2 — applied; re-checked by reviewer: design D3 (design.md L41) now says "原厂商 route 已注册时与升级前一致、不会消失；未注册时不出现在任何 route 上", Risks (design.md L62) is qualified with「原厂商 route 已注册时」, and CHANGELOG 0.7.0 says「此时若原厂商分组已存在，路由组仍留在其中可用（与升级前一致）」. The CHANGELOG wording「已存在」is slightly looser than「已注册」; acceptable.
- M3 — applied; re-checked by reviewer: spec L26 now reads「（得到 `routing` 时用 `other`；该 route 已注册时）」, which matches `catalog.ts:55` (`fallbackOwner: owner === ROUTING_OWNER ? 'other' : owner`).
