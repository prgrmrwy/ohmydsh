# Settings navigation icon migration — verification

## Scope and review

Reviewed the complete working-tree change against baseline `83a26b0e` (no commit created). Pet, Memex, Magpie and AUTO now register one `settings.section.icon` contribution with the existing page id. Existing glyphs, labels and section order are preserved. No Host source, package versions, manifest, lockfile, persistent data or credentials changed; no dependency added.

Removed the icon-specific observers, label-based row discovery, private row markers and pseudo-element overrides. The Magpie component retains the licensed bird resource as a local mask, Pet retains its emoji, and Memex/AUTO retain the original SVG geometry with currentColor. Registry-managed injection owns disposal and missing-seat behavior.

Updated current specs and checked the three modified requirement blocks against their approved deltas. Added a common icon contract and replaced obsolete marker assertions. Root test setup now builds the browser bundles consumed by the integration test so a clean checkout does not rely on stale ignored artifacts; the workspace-selection branch has a focused test.

Whole-change review found no remaining correctness/spec/scope issue. This is a local working-tree review, not an SSF receipt or merge approval.

## Automated evidence

- Pet: `vitest run test/client.test.ts` — 152 passed.
- Memex: `vitest run test/nav-icon.test.ts test/page.test.tsx` — 44 passed.
- Magpie: icon/hot-reload/locales tests — 8 passed; `test/owner-settings-ui.test.tsx` — 5 passed.
- AUTO: settings-registration, settings-section.dom, nav-icon.dom, client, client-hot-reload and client-locales — 27 passed. A stale assertion expecting the deleted adapter effect initially failed; updated it to assert the matching official icon registration and only the dictionary effect, then reran successfully.
- All four packages: `npm run typecheck --workspace <package>` — passed on final product source.
- All four packages: full package builds passed through `node bin/dsh.mjs build` and the root-test prebuild.
- `node --test tests/settings-navigation-icons.test.mjs tests/test-driver.test.mjs tests/client-typecheck-coverage.test.mjs` — 5 passed.
- `npm run check:artifacts` and `git diff --check` — passed.
- `openspec validate migrate-settings-navigation-icons --strict` — passed; `openspec validate --specs` — 56 passed, 0 failed.
- Repository-wide `npm test` — exit 0: 780 tests, 775 passed, 0 failed, 5 skipped (existing environment-dependent skips); duration 173.8s. The real icon integration runs in this suite after fresh package prebuilds.

The new integration test loads the real compiled four client entry points plus official DSH 0.2.2-rc.1 SlotRegistry/renderer under Cordis, using a shell fixture with the current span-wrapped icon render site. It verifies four unique same-id replacements, unmatched-row fallback, missing icon seat without blocking page registration, disposal/reapply without duplicate contributions, default glyph restoration, locale changes, 16/24px size and navigation click/selection. Unrelated page/composer primitives and Pet's floating Lottie surface are isolated. Theme attribute switching and currentColor checks are DOM evidence, not pixel/contrast evidence.

## Deployment evidence

- `node bin/dsh.mjs build` — exit 0; 5 sync changes applied.
- Immediately repeated the same command — exit 0, `no changes — deployment already matches manifest`.
- Repeated after regression prebuild — exit 0, still `no changes`.
- Checked all four deployed client bundles byte-for-byte against source build output, with the official slot present and old private icon markers absent:
  - Pet SHA256 prefix: `33e076ee8edf71ce`
  - Memex: `d41e4de62d43d793`
  - Magpie: `88e8a7698ec28275`
  - AUTO: `840a1329ef2b4d72`
- Sync preserved the two already-installed, unmanaged experimental bundles and emitted its existing warnings; this change did not manage or remove them.
- No Host restart, replacement server, commit, push, publication or version bump performed.

## Real GUI acceptance and automation limitation

After deployment, the user reported “看起来可以了” and requested archival, commit and push. This records user manual GUI acceptance of the reported symptom, not automated screenshot evidence or exhaustive theme/locale acceptance.

Automated real GUI visual acceptance remains **not verified**. `agent-browser --version` returned command-not-found; no Chrome MCP is available in this session. A read-only unauthenticated request to the existing `http://127.0.0.1:3080/` returned 401 / authentication required. No authentication URL, token or cookie was extracted. No screenshot/pixel check was performed and jsdom success is not reported as real-browser acceptance.

Closure: the user manually viewed the deployed GUI, reported that it looked correct, and explicitly authorized archival, commit and push. No Host restart or publication is part of this closure. The automation limitation above remains unchanged.
