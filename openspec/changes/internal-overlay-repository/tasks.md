## 0. Baseline and fixture

- [x] 0.1 Run `npm test` on the unmodified branch. Record the pass count and note any tests that already fail, so later regressions can be told apart.
- [x] 0.2 Add a shared overlay fixture helper (`tests/helpers/overlay-fixture.mjs`) for a tmp public repo, a separate tmp overlay root, a tmp `DSH_HOME`, a fake `DSH_BIN` that records plugin add/remove, and a `$DSH_HOME` tree snapshot/compare. Move the existing setup in `tests/sync-local-manifest-overlay.test.mjs` onto it. The existing 🟢 rows in test-plan.md must stay green.

## 1. Test isolation (R4)

- [x] 1.1 Write failing tests: `npm test masks an exported DSH_LOCAL_MANIFEST`, `a broken repo-root overlay does not reach tests` (tests/test-isolation.test.mjs). Assert they fail because the child sees the exported value.
- [x] 1.2 Implement: set the `package.json` `test` script (and any probe script it needs) to `DSH_LOCAL_MANIFEST=<guaranteed-nonexistent absolute path>`. Make tests that need an overlay set it explicitly (design D6).
- [x] 1.3 Refactor; the full suite stays green.

## 2. Reserved fields, absolute env path, npm spec/name agreement (load stage, no source reads)

- [x] 2.1 Write failing tests: `reserved sourceRoot and overlaySource fields are rejected`, `relative DSH_LOCAL_MANIFEST is rejected by sync`, `relative DSH_LOCAL_MANIFEST degrades the startup listing with a warning`, `name disagreeing with the npm spec is rejected`.
- [x] 2.2 Implement: reject reserved keys in raw YAML for both the public manifest and the overlay. Make `resolveOverlayPath` throw on non-blank relative values. `plugin-list.mjs` prints the overlay error to stderr and keeps degrading. Add the npm-spec `name` equality check in `loadManifest` (design D2, D5 step 1, D9).
- [x] 2.3 Refactor; the full suite stays green.

## 3. Owning root on every item

- [x] 3.1 Write failing tests: `external overlay root materializes its own patch and skill`, `repo-root overlay symlink resolves sources from the link target`, `public entry never takes source from the overlay root`, `public local package installs from the public packages dir`.
- [x] 3.2 Implement: the overlay loader attaches `sourceRoot = dirname(realpath(overlayFile))`. `loadManifest` attaches `REPO` to public items. Replace every `REPO`-based customization path in `sync.mjs` (`syncDirs`, `syncPatches`, `npmNameOf`, local spec repair, `localDir`) with `item.sourceRoot` (design D1, D2).
- [x] 3.3 Refactor; the full suite stays green.

## 4. Source preflight before any `$DSH_HOME` write

- [x] 4.1 Write failing tests: `missing overlay patch fails before rewriting cordis.patch.yml`, `missing public skill fails before any materialization`, `symlinked patch escaping its root is rejected`, `missing or escaping compat dependency fails before dependency sync`, `preflight failure on a fresh DSH_HOME leaves it empty`.
- [x] 4.2 Implement `preflightSources(items)` for enabled entries: required files, compat dirs, and `buildInputs`, plus realpath containment. Collect all errors and fail once. Reorder `main()` per design D7 (reset path unchanged).
- [x] 4.3 Refactor; the full suite stays green.

## 5. Host runtime declaration split

- [x] 5.1 Write failing test: `reset succeeds when the host runtime builder is missing`. It also asserts that normal sync fails with `$DSH_HOME` unchanged under the same condition.
- [x] 5.2 Implement: `declaredHostRuntimeFromManifest` no longer checks builder existence. Export `assertHostRuntimeSources(runtime)`, call it from `preflightSources`, and keep calling it inside `loadDeclaredHostRuntime` so Host startup behavior is unchanged. Update the `tests/dsh-host-runtime.test.mjs` assertions without weakening them (design D5).
- [x] 5.3 Refactor; the full suite stays green.

## 6. Name resolution after preflight; disabled and reset paths

- [x] 6.1 Write failing tests: `disabled local package without source is removed via the ledger`, `disabled local package.json escaping its root is rejected before reading`, `reset succeeds when overlay sources are gone`.
- [x] 6.2 Implement `resolvePackageNames(items)` after `preflightSources`. A disabled local package with a missing `package.json` is skipped; one that is present is contained before it is read. `syncPackages` consumes the resolved names, so a skipped entry falls into the existing "deleted from manifest" removal (design D5 step 2).
- [x] 6.3 Refactor; the full suite stays green.

## 7. npm name uniqueness across packages, dependencies, and compat

- [x] 7.1 Write failing tests: `overlay package reusing a public npm name is rejected`, `overlay package reusing a top-level dependency name is rejected`, `overlay package reusing a compat dependency name is rejected`.
- [x] 7.2 Implement the uniqueness check inside `resolvePackageNames`, before any `$DSH_HOME` write, with an error naming the package name and every involved id or `dependencies`/`compatDependencies` (design D5).
- [x] 7.3 Refactor; the full suite stays green.

## 8. Local build in the owning root

- [x] 8.1 Write failing tests: `external root local package builds in its own workspace`, `external root build failure stops before install`, `buildInputs escaping the overlay root are rejected`.
- [x] 8.2 Implement: `runLocalBuild` uses `cwd = item.sourceRoot`. `localBuildInputHash` resolves `buildInputs` against `item.sourceRoot`. The load-stage lexical `buildInputs` check is relative to the owning root. The build-failure message names the owning root (design D3, D6).
- [x] 8.3 Refactor; the full suite stays green.

## 9. Public repo untouched, idempotence, startup listing

- [x] 9.1 Write failing tests: `syncing an external overlay leaves the public repo byte-identical`, `external overlay root sync is idempotent`, `startup listing resolves local names from the overlay root`.
- [x] 9.2 Implement: `plugin-list.mjs` reads local names from `path.join(item.sourceRoot, 'packages', id, 'package.json')`. Set `sourceRoot` in `loadOverlayCustomizations` so non-strict consumers get it too. Change the `GENERATED_HEADER` wording (design D10).
- [x] 9.3 Refactor; the full suite stays green.

## 10. `npmScopes`

- [x] 10.1 Write failing tests: `malformed npmScopes is rejected at load`, `npmScopes on a non-package entry is rejected`, `configured scope passes and .npmrc is untouched`, `missing scope fails before dependency and package changes`, `missing scope on a fresh DSH_HOME installs nothing`, `missing scope leaves the legacy ledger unmigrated`, `disabled entry scopes are not checked`. Also add the `npm_config_registry` negative case.
- [x] 10.2 Implement: validate `npmScopes` at load (package only, list of `@scope`). `preflightScopes(items)` runs `npm config get <scope>:registry` with cwd = profile and dedupes by scope. Move `migrateLegacyState` after it (design D4, D7).
- [x] 10.3 Refactor; the full suite stays green.

## 11. Update check and auto-update

- [x] 11.1 Write failing tests: `every update row carries fromOverlay`, `scoped package metadata goes through npm with profile auth`, `plugin-update skips overlay rows without touching dsh.yaml`.
- [x] 11.2 Implement: add `fromOverlay` on every row in `detectRemotePluginUpdates`. Scopes with a configured registry use `npm view … --json` with cwd = profile. `plugin-update.mjs` prints and drops overlay rows, and exits 0 when none remain (design D8).
- [x] 11.3 Refactor; the full suite stays green.

## 12. Docs and final verification

- [x] 12.1 Update `docs/notes/local-manifest-overlay.md`: private isomorphic repo layout, the trust model (D0), multi-machine steps (clone, `npm ci` in the private repo, `.env.local` line, profile `.npmrc` scope), `npmScopes`, preflight, and rollback. Use generic `@example` names only. Grep the whole diff for internal names and registries and confirm there are none.
- [x] 12.2 Run `npm test`, `npm run check:artifacts`, and `openspec validate internal-overlay-repository --strict`. Flip every test-plan row to 🟢.
- [ ] 12.3 Run `node scripts/sync.mjs` twice against the real profile with no overlay. The second run reports no changes.
