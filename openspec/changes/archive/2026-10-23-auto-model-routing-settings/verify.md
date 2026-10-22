# auto-model-routing settings — implementation verification

> Historical evidence below through live Loop 2 concerns the earlier per-model main editor. On 2026-10-23 the user approved provider-wide main effort cells with no top model selector and compact controls. The latest revision is tracked in tasks §7; do not treat old exact-model CP results as proof of the new mapping semantics.

## Scope and current state

Source implementation targets plugin 0.2.0 on DSH 0.2.0-rc.2. This report separates offline evidence from deployment acceptance. The user authorized real-profile deployment/restart; sync completed twice with the second run unchanged, and the user confirmed restart completion. No replacement server or credential migration was performed. Live GUI reversible settings save was exercised and restored. Main specs are not yet synced and this change is not archived while live acceptance remains pending.

## Implementation and automated evidence

- Settings store and injected catalog validator cover sparse main-model effort overrides, complete child routes, atomic 0600 writes, per-field read diagnostics, null-cell restore, fail-closed explicit values, authoritative save validation, cap conflicts, and unchanged historical invalid values.
- Adversarial review found and repaired no-op patches erasing malformed containers, inherited-key merge access, terminal-newline model IDs, and cap checks missing recognizable efforts in malformed child objects. Regression tests were added.
- Runtime tests cover default model-specific start points, explicit main/child overrides, no max, global cap, no cap-breaking minimum fallback, same-turn remapping after settings change, directory removal before cache reuse, asynchronous credentials, dynamic deadlines, and cancellation during credential lookup.
- Host tests use real AgentLoop, fake LLM adapter/catalog and a loopback Jev server. They cover six RPC endpoints; sparse save without session selection; field errors preserved through the RPC envelope; key A→B→deleted on the next request; fresh default AUTO without reapplying on plugin restart; explicit empty-seed exclusion; resume/clear/compact events ignored; child creation ignored. Resume/clear/compact exclusion is tested at the lifecycle event boundary, not via persisted-session storage reconstruction.
- Settings Host tests cover readonly credentials, sanitized write errors, no environment fallback when an installed credentials service fails, fallback when the service is absent, and one unavailable model not hiding other models in that provider catalog.
- GUI DOM tests cover draft persistence across provider/model editing, route filtering, effort reselection, cap conflicts/reset, partial save outcomes, exact rubric strings, navigation scoping, portal menus, delayed-position focus, keyboard navigation and focus restoration.

## Real component visual/interaction check

A scratch `file://` fixture bundled the actual settings component with upstream official UI primitives and the official theme token CSS. It was not a handwritten equivalent and did not run a replacement application server.

- Light/dark at 1000px and narrow layout at 390px inspected; narrow document width equaled viewport width, no horizontal overflow.
- Long model labels truncate; narrow layout stacks each tier's main/child fields.
- Real menu is portaled to BODY, clamped to viewport; keyboard navigation enters model/effort submenus, Escape returns/closes, focus returns to the exact trigger.
- Rubric tooltip is portaled and displays exact source criteria.
- This check caught and fixed a missing table divider and initial focus attempted while MenuSurface was hidden awaiting anchor measurement; a regression covers delayed positioning.
- Scratch screenshots remain outside the repository. These checks do not prove settings.section is loaded by the currently deployed Host.

## Commands

Latest package validation: 147 tests passed across 24 files; package typecheck and build passed. Build emits existing tsdown deprecation/format advisory warnings, not errors. `npm run check:artifacts` passed.

Initial repository run exposed two integration fixtures: hardcoded plugin version 0.1.0 broke second isolated sync idempotency after the version bump, and the expanded manifest note exceeded the 600-code-point policy. Both were repaired; focused repository tests passed. Final repository rerun passed: 447 tests, 445 passed, 2 skipped, 0 failed. The tracked-only documentation checker initially rejected links to new-but-untracked paths; those paths were registered with Git intent-to-add (no commit), after which the full suite passed. Strict OpenSpec validation and working-tree diff whitespace checks passed.

Architecture source and dual-theme SVG were updated for the working tree (no fictitious immutable commit provenance). Archify validation/delivery/strict/browser gates passed; exported SVG passed system xmllint. Light 1440px and dark 2048px diagram views were inspected. Four resolved crossovers remain an advisory, without observed clipping or overlaps in inspected views. Temporary browser outputs and captures are not tracked. Review attempts using the Jev review service returned HTTP 451 unavailable; local source review, teammate cross-review, tests and browser checks were used instead. No unavailable tool was represented as a successful review.

The repository isolated sync test materializes the package into test-owned temporary directories twice and proves second-run no-op. Subsequently, with explicit user authorization, real-profile sync also ran twice successfully; the second run reported dsh-auto-model-routing@0.2.0 up-to-date and no changes. The existing DSH was restarted, with completion confirmed by the user and new settings verified in the live GUI below.

## Live GUI smoke acceptance (2026-10-22 23:06–23:12 Asia/Shanghai)

The existing authenticated http://127.0.0.1:3080 GUI loaded the new section after restart. Verified six-setting form, Claude/GPT tabs, one scoped navigation E marker, blank disabled key field with launch-environment readonly guidance, actual official model directory, and GPT child model menu containing only current allowed Sol/Astra/Luna routes. Child trigger opens Model/Effort root and model submenu; Escape returns/closes. The composer stayed on GPT Sol/Medium while editing settings. Hint switch was saved off and back on via the actual RPC-backed GUI; success displayed both times and the original value was restored. No API key was read, changed or migrated; no paid model/Jev request was submitted during smoke testing.

## Remaining acceptance

- Deployment/restart, current GUI section loading, scoped navigation E, actual model/allowed-list menu and reversible hint setting save are completed as described above.
- Live paid-task acceptance remains unperformed: outgoing main effort and child recommendation, allowlist changes, deadline effects and new-session AUTO behavior are covered by automated tests but have not been exercised with real paid requests in this GUI.
- Real key migration remains intentionally unperformed: the user's launch-environment credential is still readonly. Migration requires the user to remove that environment variable and restart before entering the key into the official credential store. Do not change or migrate it as an automatic continuation step.
- Only after those checks, sync delta specs and archive through the normal OpenSpec workflow. No unchecked deployment/acceptance task should be represented as completed.

## 2026-10-23 family-wide revision and archive acceptance

User-approved final shape removes the top main-model selector but retains the main column, applying provider/tier overrides to all models in that family. Unset main cells retain model-specific defaults. Segmented controls are 28px high with 12px text, natural widths; picker height is 28px. Legacy per-model values are diagnosed/fail-closed and explicitly recoverable.

Verification: package 155 tests passed; typecheck/build passed; repository 445 pass, 2 skip, 0 fail. Actual upstream primitive file:// component checks measured all three segmented tracks at 28px and confirmed 390px viewport without horizontal overflow, all four criteria tooltip focus, portal/keyboard menus, cap conflict/reset and sparse toast setting save. Real-profile sync twice completed, second no-op. In-session restart command lost its supervisor when old Host stopped; user restarted externally, current settings API returned 200/configStatus ok/7 models. No further restart was performed. User subsequently inspected the GUI and authorized archiving with the remaining documented evidence gaps; no extra live paid requests were submitted for the family revision.

Scope caveat: earlier Loop2 paid results belong to the old per-model design, not full runtime acceptance of this revision. Current family-wide cross-model behavior is supported by new host integration/unit tests. Missing line-level and complete live UI evidence remain recorded rather than relabeled passed. Credentials were not migrated.
