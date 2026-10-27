# Implementation log — auto-routing-strategy-cohesion

## 0. Preparation (2026-10-28)

### 0.1 Gate and drift correction

- Base commit `3ba705c0a`. Reviewed artifacts had drifted from the code before apply started: `8f3799b07` renamed Magpie route `dsh-magpie` → `dsh-magpie-connector`, and `64c7fdcaa` released 0.4.2. With user approval, corrected only these facts in proposal/design/specs/tasks/test-plan (provider ID; baseline and rollback pin 0.4.1 → 0.4.2), then ran a fresh-context codex re-review (review.md "Round 2b"): `APPROVE_WITH_CHANGES`, one required change R2b-M1 (spec.md:61 provider), applied → `CHANGES_APPLIED: yes`.
- Dependencies: Worktree promoted to mutable, `npm ci` at root.

### 0.2 / 0.3 Fixtures

- `npm run build` in the package on the unmodified 0.4.2 source; `lib/` is that build.
- `test/fixtures/routing-oracle-0.4.2.json`: `policyEffort` for 12 models × {no default, default `low`} × 3 depths, the 6 boundary cases, and all 54 `choosePolicyRoute` built-in combinations (claude, codex, and both Magpie transports × both families × 3 capabilities × 3 depths), run against `lib/policy-v2.js`. Values match the spec tables (e.g. Luna `medium/high/xhigh`, Astra `low/low/medium`, unknown+default low `low/low/medium`, no default → unsupported error).
- `rubricSha256` (sha256 of `src/policy-v2-rubric.json`) is recorded in the same fixture.
- `test/fixtures/lib-files-0.4.2.json` and `test/fixtures/lib-0.4.2/{router.js,judgements.js,policy-v2.js,policy-v2-rubric.json}`.

### 0.4 Baseline suites (unmodified source)

- Package `npx vitest run`: 34 files, **266 passed / 2 failed** of 268. Both failures are in `usage-report.test.ts` (`keeps incomplete ends inconclusive and legacy exposure unknown`, `keeps complete frames when only the tail is incomplete`): with Node v24.16.0, `zstdDecompressSync` on a frame truncated by 5 bytes returns without throwing, so `tail-incomplete` stays 0. This is environmental and predates this change.
- Root `npm test`: 633 tests, **627 pass / 2 fail / 4 skipped**. Failures: `tests/jev-readiness.test.mjs` "readiness prefers v4 session file…" (no `zstd` CLI on this machine) and `tests/repo-docs-governance.test.mjs` "every repo-relative markdown link resolves…" (pre-existing repo-root-relative links in this change's `review.md`). Both also fail on a clean checkout of the base.

## 1. Registry and built-in strategies

- 1.1 red: `strategies.test.ts` failed with "Cannot find module '../src/strategies/index.js'". 1.2 green: `src/strategies/{types,claude,codex,index}.ts`; 10/10 pass (7 rejection cases, set-compared provider list, 72 start rows and 6 boundary rows read only from the oracle fixture).
- 1.3/1.4: `policy-v2.ts` → `routing.ts`, `policy-v2.test.ts` → `routing.test.ts`. `choosePolicyRoute` / `policyEffort` / `modelFamily` / `validatePolicyRoute` and `support.ts` read the registry; `POLICY_MODELS`, `mappingVersion` export, the known-model regex and `STARTING_POINTS` are gone. A single-family transport (empty prefix) still implies its family ahead of a passed `family`, as before. New "内置子路由与原行为一致" (54 oracle rows) and "支持范围判定只依据注册表" pass.
- 1.5 deferred, by design: `effort.ts` still exports `targetEffort`, `mapEffort`, `CHILD_MODELS` and tiers, because their only remaining callers are the legacy chain (`router.ts`, legacy `route_subagent` branch, legacy `settings-section` mapping tabs) and `effort.test.ts`. These are deleted in section 3. `targetEffort` now reads starts from `registry.effortStart`. Temporary shims in `policy-host.ts` (`mappingVersion` constant), `subagent-tool.ts` and `settings-host.ts` (`magpieProvider` derived from the registry) are removed in sections 2–4.
- Package suite after section 1: 277 passed, 2 failed (the two baseline zstd tests only).

## 2. Registry-driven Host boundaries

- 2.1 red: "新增家族只需新增策略" failed with `autoSupport.supported === false` and "记录中的家族已不在注册表" with a non-error tool result (the plugin ignored injected strategies). The two `subagent-tool` scenarios already passed after section 1 (provider membership and family resolution moved to the registry there); they are kept as named regressions.
- 2.2: `Config.strategies` → `createRegistry` in `apply`; `PolicyStore(directory, registry)` builds provider/family enums per registry; `settingsHost(ctx, store, registry)` filters catalog and allowlist with `registry.hasProvider` (no more `includeMagpie`/policy switch, so Magpie is always included, matching the default chain); `policyHost` and `routeSubagentTool` take `registry`, and the tool's `provider`/`family` enums are `registry.providers()`/`registry.ids()`. Test-side `PolicyStore` in the harness uses the same injected registry. All four 2.1 scenarios pass.
- `settings-host.test.ts` legacy case "catalog is isolated from legacy yet available for persisted v2 replay" (asserted the `policy: legacy` catalog switch, deleted in section 3) is replaced by "catalog and allowlist include only registry providers".
- 2.3: the scan test is stricter than the spec examples (also catches `['claude','codex']` lists, `{ id: 'claude' }` and "Claude / GPT" copy). Lock-state copy in `client/index.ts` now uses `registry.labels()`. The remaining offenders are only `effort.ts`, `settings-contract.ts`, `settings-validation.ts` and `settings.ts` legacy mapping code removed in section 3; the test goes green there.
