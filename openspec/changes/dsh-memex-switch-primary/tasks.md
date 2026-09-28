Every "failing test" task names test-plan.md rows. Each must be observed red, for the stated reason, before its implement task starts. Flip each row in test-plan.md to 🟢 when its test passes. 🟢 existing and 🟡 pin rows are checked in the refactor step of their group.

## 1. Schema and validation (Host)

- [x] 1.1 Write failing tests in `test/settings.test.ts`. Assert they fail because `workspaces` is unknown or unvalidated:
  - `rejects memory: true or fallback: true in a workspace declaration`
  - `rejects a declared primary that does not claim that exact path`
  - `rejects duplicate or missing workspace declaration paths`
  - `rejects two scopes claiming one workspace with neither a declaration nor a mark`
  - `rejects two scopes claiming one workspace with two marks and no declaration`
  - `accepts a workspace declaration that picks one primary among conflicting marks`
- [x] 1.2 Implement `workspaces: [{ path, primary?, memory?: false, fallback?: false }]` in `MemexSettingsSchema` / `ScopeConfig` (`src/scope/settings.ts`, `types.ts`), with config-time validation per design D2:
  - `path` is normalized and unique;
  - the switches accept only `false`;
  - `primary` must be an exact claimer of that path;
  - the exclusive-claim rule accepts the declaration as its resolution.
- [x] 1.3 Write the rollback pin. Freeze the 0.2.0 schema into `test/fixtures/settings-schema-0.2.0.ts`, then add `test/settings-rollback.test.ts` → `the frozen 0.2.0 schema passes workspaces through unchanged and the new schema recovers it`.
- [x] 1.4 Refactor; `npm test -w packages/dsh-memex` stays green. Confirm the 🟢 existing rows `accepts one workspace split across two libraries when exactly one is primary` and `lets a lone claimer stay unmarked`.

## 2. Resolver: path declarations, off-wins, stale primary (Host)

- [x] 2.1 Write failing tests:
  - every `test/workspace-decisions.test.ts` row in test-plan: the scope ADDED requirement, `a fallback declaration on one workspace leaves…`, and `personal as current scope reports…`;
  - the extended `test/scope.test.ts` rows `routes a two-entry workspace…` (declaration-chosen primary) and `refuses a path prefix shared…` (extended);
  - `removes the fallback from both directions when a declaration or the entry turns it off`.
- [x] 2.2 Implement in `src/scope/resolver.ts`:
  - Covering declarations match by path segments for every route kind (path, remote, derived, local).
  - Memory or fallback is off iff any covering declaration or the primary entry says `false` (D2).
  - For path routes, `primaryOf` uses `workspaces[deepest prefix].primary` first, rejects a stale one at resolve time, then falls back to the unique entry mark. Remote routes are unchanged.
  - The resolution exposes `claim`, `offBy`, `fallback`, and binding-aware `personal: { read, write }` (D5).
- [x] 2.3 Add pin: `derives a separate library for an unclaimed repository copy outside the checkout`. (The runtime distinct-pattern scenario is already covered by an existing test; the test-plan mapping was corrected.)
- [x] 2.4 Refactor; full package suite green. Confirm the scope 🟢 existing rows.

## 3. Memory switch timing and tools (Host)

- [x] 3.1 Write failing tests:
  - `test/lifecycle.test.ts` → `injects nothing when a path declaration closes memory…`;
  - `test/tools.test.ts` → the extended `refuses every tool…`, `a memory-off workspace's primary stays writable as another workspace's fallback target`, and `closing memory in one workspace leaves a workspace sharing its primary fully working`;
  - `test/lifecycle-runtime.test.ts` → `reopening memory enables tools immediately but does not inject recall into a started session` and `closing memory mid-session refuses later tool calls without retracting injected recall`.
- [x] 3.2 Implement: route the resolver's declaration-aware `memory` through `currentFor()` and lifecycle session-start. No new logic should be needed beyond group 2; fix any path that reads entry-level `memory` directly.
- [x] 3.3 Refactor; suite green. Confirm `reports memory as on by default and off only when the entry says so` is still green.

## 4. Channel contract (Host)

- [x] 4.1 Write failing tests:
  - `test/channel.test.ts` → `resolve reports fallback false with personal reachable through a binding` and `resolve reports claim and offBy without any raw remote URL`;
  - the `test/channel-browse.test.ts` pin `ignores a workspace field in the request and still refuses an entry-level memory-off library`.
- [x] 4.2 Implement:
  - `MemexResolveResult` gains `claim`, `offBy`, `fallback`, and `personal` (`src/contract.ts`, plus the resolve and workspaces endpoints in `src/host/channel.ts`).
  - The browse contract stays `{ scope }`, and the entry-level refusal before spawn is unchanged.
- [x] 4.3 Refactor; suite green. Confirm `refuses a memory-off library before starting anything` is green.

## 5. Page model: draft, homeDir, recomputation (client)

- [x] 5.1 Write failing tests:
  - `test/settings-model.test.ts` → `model path comparisons use the Host homeDir, not an empty string`;
  - `test/settings-guard.test.ts` → `the draft recomputation agrees with the Host resolver on a table of configurations` and `keeps a read-only or write-only binding's direction when computing reachability`.
- [x] 5.2 Implement:
  - The draft becomes `{ rows, workspaces }`; `bindings` are read-only from the snapshot.
  - Every `homeDir=''` call site (`setPrimary`, `detachEntry`, `routeOwnerOf`, `stageAssumedPrimary`, `attachEntry`) uses the Host `homeDir` instead.
  - Add a pure draft-recompute module shaped like the resolver. It treats routes it cannot compute as reachable (conservative).
- [x] 5.3 Refactor; suite green.

## 6. Page model: close / open / universal guard (client)

- [x] 6.1 Write failing tests:
  - settings-model rows:
    - `a fallback close writes only this workspace's declaration…`
    - `closing the fallback of an undeclared workspace adds a declaration and no scopes entry`
    - `closing memory in one workspace leaves another workspace on the same primary on`
  - settings-guard rows:
    - `closing a parent lists…`
    - `refuses to open a workspace an ancestor declaration closes…`
    - `opening removes the entry field and adds off declarations…`
    - `refuses to open when the closing entry carries remote patterns`
    - `attaching an entry under an inherited off primary…`
    - `detaching the only primary adds a memory declaration…`
    - `refuses a save whose preserving declaration would close an on child workspace`
  - round 6 rows (settings-guard / settings-model):
    - `refuses a claim-changing save while the registry is unavailable`
    - `configuration blocks of every kind carry no switch and say why`
    - `making personal an entry on the workspace's own block is explicit and noted`
    - `refuses an edit that makes personal an entry of a workspace indirectly`
    - `points an ancestor refusal at the configuration when the ancestor is not registered`
- [x] 6.2 Implement:
  - D3 close and open.
  - The universal guard, run on every staged save. The before state comes from Host facts and the after state from the draft recompute; the guard either adds declarations or refuses with the named cause.
  - Rewrite the entry-writing switch functions to write declarations instead.
  - Done in `src/client/workspace-actions.ts` (`closeSwitch` / `openSwitch` / `guard` / `withPersonalIntent`). Views read declarations and carry `switches`. The old `setFallback` / `setMemory` remain only as `page.tsx` callers and are deleted with the page rewiring in 8.2.
- [x] 6.3 Refactor; suite green.

## 7. Page model: switch primary (client)

- [x] 7.1 Write failing tests:
  - settings-model rows:
    - `puts both entries… (declaration-chosen primary)`
    - `setting the fallback personal row as primary…`
    - `switching under an inherited ancestor prefix splits…`
    - `switching primary in one workspace leaves the shared library's other workspaces unchanged`
    - `keeps exactly one primary when a workspace gains a second entry` (declaration)
    - `blocks a workspace with no declaration and no unique mark`
    - `blocks a workspace with several marks and no declaration, and a non-exact declared primary`
    - round 6: `attaching on an inherited workspace makes the new entry its sole primary and names every inherited library`, `refuses an inherited attach whose new primary's binding lists personal, saying it would become primary`, `refuses an inherited attach whose preserving declaration would close an on child`
  - settings-guard rows:
    - `switching primary keeps both switches' effective values`
    - `carries the old primary's entry-level memory off…`
    - `adds no fallback declaration when a binding kept personal reachable…`
    - `adds a fallback declaration when switching away… without a binding`
    - `refuses a switch whose new primary's binding would make personal reachable`
- [x] 7.2 Implement:
  - `switchPrimary` per the D3 table: exact-claim, ancestor split-out, derived. Remote is not offered. Write `workspaces[P].primary` iff there are ≥ 2 exact claimers.
  - `setPrimary` and `attachEntry` delegate to it.
  - `conflicts()` accepts declarations and flags non-exact declared primaries.
  - Done in `src/client/workspace-edits.ts` (`attachTo` / `detachFrom` / `switchPrimary`, all through `guard`). Views pick the primary via `claimPrimary`. A derived workspace gaining a second entry now gets its staged primary as `workspaces[P].primary`, not an entry mark (≥ 2 exact claimers ⇒ declaration). The page test `declares the derived primary when an undeclared workspace gets a second entry` is updated accordingly in 8.1.
- [x] 7.3 Refactor; suite green.

## 8. Page UI (client)

- [x] 8.1 Write failing tests in `test/page.test.tsx`:
  - `a remote-claimed workspace offers no claim or primary action and says why`
  - `can switch memory back on from inside the folded group` (declaration removal)
  - round 6: `folds only registered memory-off workspaces`, `shows a configuration block's switches as read-only state`
  - `turns the fallback off in both directions with a path declaration`
  - `labels a lone entry with its role`
  - `replaces the primary with a picked library and names the replaced one before saving`
  - `switches memory off for one workspace with a path declaration and no derived entry`
  - `annotates a fallback kept reachable by a binding`
  - `offers browsing for a shared library under the memory-on workspace only`
  - `saves scopes and workspaces as two sets in one fenced mutation`
- [x] 8.2 Implement in `page.tsx` and `locales.ts`:
  - A role badge on every row.
  - 「设为主入口」 on fallback and additional rows, and 「更换主入口」 on the primary, using the same picker as add-entry.
  - Remote-claimed blocks are read-only, with an explanation.
  - Notice lines for the replaced library, split-out, added declarations, and refusals.
  - The binding annotation.
  - Hide the fallback row when `personal` is an entry.
  - Save is one `mutate` containing `set ['scopes']` and `set ['workspaces']`.
- [x] 8.3 Add pins: `copies the library path and the remote to the clipboard`, `shows personal as readable and writable while the fallback is on`, `shows a memory-off workspace's state and its meaning, and keeps editing available`.
- [x] 8.4 Refactor; suite green. Confirm all page 🟢 existing rows.

  Implementation note (2026-09-29): the page's draft is a `Session`. Every workspace edit runs through `closeSwitch` / `openSwitch` / `attachTo` / `detachFrom` / `switchPrimary`. Save runs `guard` once more for edits made by typing: if it adds declarations, it shows their notes and the save completes on the next click. A rename also rewrites any declared primary that names the library. `claimsChanged` ignores libraries that claim no path and no repository, because such a library routes nothing; declaring an undeclared store therefore stays possible without a registry (pinned in `refuses a claim-changing save while the registry is unavailable`). Configuration blocks keep direct entry edits; their switches are read-only. `setFallback`, `setMemory`, `routeOwnerOf` and the `stagedNotice` copy were removed.

## 9. Version, docs, validation

- [x] 9.1 Bump `dsh-memex` 0.2.0 → 0.3.0 in `package.json` and in `dsh.yaml` (version and note). Add a CHANGELOG entry covering:
  - off-wins path declarations;
  - the page guard;
  - the hand-edit caveat (prefer path declarations for a stable off state);
  - the browse narrowing;
  - the timing wording;
  - the rollback steps: write off states back to entries, and add entry-level `primary: true` where only a declaration chose the primary.
- [x] 9.2 Run and record:
  - the package `typecheck`, `build`, and `test`;
  - the repo `npm test` and `npm run check:artifacts`;
  - `openspec validate dsh-memex-switch-primary --strict`.

  Confirm every test-plan row is 🟢.

  Recorded 2026-09-29: package `typecheck` exit 0, `build` complete, `test` 26 files / 333 tests passed; repo `npm test` 241 pass / 0 fail / 2 skipped; `npm run check:artifacts` compliant; `check:descriptions` matches memex 0.4.1; `openspec validate dsh-memex-switch-primary --strict` valid. Every test-plan row is 🟢. The workspace entry in `package-lock.json` was bumped with the package, as in 0.2.0.

## 10. Deploy and live acceptance

- [x] 10.1 Run `node scripts/sync.mjs`, then run it again and confirm no changes.
- [x] 10.2 Restart DSH detached from the calling process (`setsid`), then verify http://127.0.0.1:3080 after a refresh.
- [x] 10.3 Live check on the real settings and registry:
  - the `personal` rows under ohmydsh and dsh-cockpit show 主;
  - close memory on ohmydsh only, and confirm dsh-cockpit stays on;
  - switch a workspace's primary and switch it back;
  - inspect the saved `~/.dsh/settings.yaml` section (read-only) and confirm it matches expectations;
  - restore the original state.
- [x] 10.4 Write `verify.md`, and save a memex retro card.
