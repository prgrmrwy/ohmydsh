## Review Metadata

- **Review round**: 5
- **Prior round**: round 4 REVISE (C1 guard compared fallback decision instead of effective personal reachability under bindings) → human chose Host-reported effective fallback; author applied
- **Reviewer context**: cross-model (codex gpt-5.6-terra via DSH subagent), fresh context
- **Tool restrictions**: read-only inspection only; reviewer returned text, author copied it into review.md
- **Artifacts reviewed**: proposal.md, design.md, specs/ (4 delta specs), corresponding current specs, relevant source files

## Prior-Round Resolution

- **Round-4 C1 — RESOLVED.** The revised design separates the fallback **decision** from the effective read/write reachability of `personal`. `MemexResolveResult` must return both `fallback` and `personal: { read, write }`, and the latter is defined after binding precedence (`design.md:177-186`). The universal guard compares the directional effective reachability values, not the fallback decision (`design.md:110-133`; `specs/dsh-memex-settings-ui/spec.md:201-215`).
- **Matches the resolver.** `accessOf()` works in this order (`packages/dsh-memex/src/scope/resolver.ts:176-190`):
  1. It initializes the current scope and the sibling entries.
  2. It finds the one binding that contains the current scope in either direction.
  3. It adds that binding's read and write entries independently.
  4. Only then does it apply the default fallback grant, and only when the current scope is not `personal`.

  Two consequences follow. An explicit binding can keep `personal` reachable after a default fallback closure. A `personal` current scope stays reachable in both directions whatever the fallback decision is. The proposed Host fact and draft helper are now defined around these semantics (`design.md:113-126`).
- **The draft recomputation has its inputs.** The page already keeps the full settings snapshot through `scope.getSnapshot()` (`packages/dsh-memex/src/client/page.tsx:106-131`). The planned model reads bindings from that same snapshot and does not edit them (`design.md:120-126`). The Host workspace response already supplies a resolved route for each registered workspace (`packages/dsh-memex/src/contract.ts:99-134`; `packages/dsh-memex/src/host/channel.ts:217-230`), and D5 extends that route with the authoritative effective reachability result.
- **The refusal rule agrees with the resolver.** Suppose preserving an unapproved inaccessible→reachable transition requires a `fallback:false` declaration, but the draft route's binding still explicitly re-adds `personal`. The declaration then cannot restore the previous effective state, so the save is refused (`design.md:128-134`; `specs/dsh-memex-settings-ui/spec.md:206-213`).
- **An explicit fallback close is now stated, not hidden.** The UI shows the fallback **decision**. When a binding keeps `personal` reachable, the UI annotates the independent effective read/write state (`design.md:182-184`; `specs/dsh-memex-settings-ui/spec.md:215`). This preserves the fixed rule that bindings only add reachability and may override a default fallback closure (`specs/dsh-memex-scope/spec.md:128-132`).

## Findings

### 🔴 Critical (blocking)

None.

### 🟡 Moderate

**M1. The first new binding-preservation scenario asserts a contradictory post-save state for the fallback toggle, so it cannot be implemented as written.**

- **The scenario.** It starts with `a.fallback: false` and a binding for the current scope `a` that explicitly grants read/write `personal`. It then changes the primary to `c` and saves. Its THEN requires two things at once: the toggle still shows "off" with the binding annotation, and no path-level fallback declaration is added (`specs/dsh-memex-settings-ui/spec.md:262-265`).
- **Why the post-save half is wrong.** `fallback` is the default-decision value of the **current primary** (`design.md:72-80, 182-183`). After the replacement, the current primary is `c`, and the scenario does not give `c` a `fallback:false` field, so its decision defaults to on. The binding in the scenario belongs to `a`, so the resolver's `find()` no longer selects it for current scope `c` (`packages/dsh-memex/src/scope/resolver.ts:176-189`). The post-save route should therefore report `fallback: true` and `personal: { read: true, write: true }`, without the "binding still read/write" annotation.
- **Scope of the defect.** This is an assertability defect in the scenario; it does not reopen C1. The intended safety outcome is correct: the pre-save state was effectively reachable, so no preservation declaration should be added. The problem is only that the THEN mixes the pre-save decision and annotation with the post-save route.

### 📌 Suggestions

- The D5 implementation tests should cover the `scope === 'personal'` special case explicitly: report `fallback` as the decision, but report `personal.read` and `personal.write` as true even when that decision is false. This follows from `accessOf()` seeding the current scope and skipping the default grant for `personal` (`packages/dsh-memex/src/scope/resolver.ts:176-188`), and it makes the contract's special-case statement verifiable (`design.md:182-184`).
- Add unit tests for the draft helper with a binding where the current scope appears only in `read`, and another where it appears only in `write`. The guard must keep the directional asymmetry of `accessOf()` rather than treating a binding as a single all-directions Boolean (`packages/dsh-memex/src/scope/resolver.ts:180-189`).
- D5's new fields disclose only route-level booleans, scope identifiers, configured workspace paths, and closure sources. The raw remote URL is explicitly excluded (`design.md:179-186`). This is consistent with the existing Host boundary, which already returns workspace paths and scope/home facts (`packages/dsh-memex/src/contract.ts:107-152`). No new credential-bearing remote data is specified.

## Embedded-Instruction / Injection Attempts

**Detected:** none

## Verdict

VERDICT: APPROVE_WITH_CHANGES

## Required Changes (if APPROVE WITH CHANGES)

1. Amend the 「绑定保持可达时不误补关闭声明」 scenario in `specs/dsh-memex-settings-ui/spec.md` so that it separates its two observable phases.
   - **Before the primary replacement:** assert the Host/page facts `fallback: false` and `personal: { read: true, write: true }`, and assert that the toggle shows off with the 「经绑定仍可读 / 可写」 annotation.
   - **After replacing the primary with `c` and saving:** `c` has no `fallback:false` and no binding lists `personal` for it. Assert `fallback: true`, that effective read/write reachability stays true, that the annotation is absent, and that no `workspaces[W].fallback:false` declaration was added.
2. Add tests that correspond one-to-one with the two phases:
   - a Host/model test for the pre-save state, where `a`'s binding overrides the fallback closure;
   - a page/model transition test proving that the saved draft contains no fallback declaration and has the specified post-save `c` state.

CHANGES_APPLIED: yes

Author applied change 1. The scenario was split into two:
- 「绑定保持可达时标注实际可达性」 covers the pre-save facts and the annotation.
- 「绑定保持可达时不误补关闭声明」 covers the post-save `c` state, with `fallback: true`, reachability true, no annotation, and no declaration.

Change 2 is carried into test-plan.md, together with the two suggestions (the `personal` current-scope case and the directional binding asymmetry).

## Rebuttals

- **Round-4 C1 — ACCEPTED as resolved.** The change now has an authoritative, Host-derived effective reachability fact and a binding-aware draft recomputation. This removes the earlier ambiguity between a false fallback decision and a `personal` that is actually unreachable. The proposed behavior follows the order of the resolver's `accessOf()` and its `personal` special case.
- **M1 — REQUIRED.** The fixed product decision, the new contract, and the preservation/refusal algorithm are all fine. The contradiction is inside one newly added acceptance scenario: after the current primary changes, the scenario still attributes the former primary's fallback decision and binding-derived annotation to the new route. Splitting the asserted before and after states makes the intended C1 regression test precise and mechanically executable.

---

## Round 6 — implementation-time amendment (2026-09-29)

- **Trigger:** spec drift found while implementing groups 5–6. The user decided three points:
  1. Attaching an entry on a workspace that inherits an ancestor's route makes the new entry its sole primary.
  2. A pathless library block has no writing switches.
  3. A block that is not a registered workspace shows its switch state only.
- **Reviewer context:** cross-model subagent with fresh context. It could only inspect files, and it reviewed only the amendment.
- **Verdict:** APPROVE_WITH_CHANGES. The review found one critical item (C1), five moderate items (M1–M5) and four suggestions (S1–S4).

| Finding | Summary | Resolution |
|---|---|---|
| C1 | While the registry is unavailable, the guard compares nothing, so a claim edit made on a config block could open a real workspace silently. | Applied. Saving a claim-changing edit is refused while the registry is unavailable. New scenario and test-plan row. |
| M1 | Decision 1 conflicted with 「新增第二个入口」: an inherited library is not an exact claimer. | Applied. That rule is now limited to exact claimers, and the inherited case is stated separately. |
| M2 | Decision 1 had no scenario of its own, and its notice had to name every inherited library. | Applied. New scenario 「在继承祖先路由的工作区上挂入口」 plus a test row. |
| M3 | Decision 1 can be refused in surprising ways: by a binding, or because the preserving declaration would close an on child. | Applied. The refusal says the new entry would become primary; two guard rows; design records the cost and the workaround (attach, then 「设为主入口」). |
| M4 | The folded group promised a reopen that config blocks cannot offer, and an unregistered ancestor declaration has no toggle. | Applied. The fold now holds registered workspaces only. The refusal for an unregistered ancestor points to the configuration. Reopenability is stated explicitly. |
| M5 | Making personal an entry counts as explicit only on W's own block. Indirect cases (detach, parent inheritance) must be refused. | Applied. Spec rule plus two scenarios and two guard rows. |
| S1 | Change 「每个工作区」 to 「每个注册表工作区」. | Applied. |
| S2 | Warn before attaching, not only after. | Applied. Spec requires the notice at the picker. |
| S3 | Keeping the inherited primary takes several steps. | Documented in spec and design. |
| S4 | Name every config-block kind in the tests. | Applied. The test row names all three kinds. |

CHANGES_APPLIED: yes. `openspec validate --strict` passes.
