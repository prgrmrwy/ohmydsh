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
- 2.3 green after section 3 removed the legacy mapping code (`content.test.ts` "家族知识只有一个来源" passes).

## 3. Remove the legacy chain

- Harness: the `host.integration` harness was extracted to `test/host-harness.ts` (shared with `settings.test.ts`) and now writes no `policy` by default (`{}` or `{defaultMode:'AUTO'}`); with that change 21 tests that only exercised the Router failed, as expected.
- 3.1 red, each for the expected reason: "旧判档账本不再增长且标注参数被拒" (label with `label` returned 200), "提交旧映射字段被拒" (`{policy:'legacy'}` saved without error), "旧映射配置不影响路由并在保存时移除" (no `deprecated` in the settings read), settings-page notice (no `[data-deprecated]`).
- 3.2 deleted: `router.ts`, four-tier `rubric.json`, `judgements.ts`, `client/route-picker.ts`, `scripts/label-report.mjs` (+ `files` entry), `eval/run.mjs`, `eval/cases.json`, `eval/baseline.json`; mapping validation/merge in `settings*.ts`; mapping tabs/table in `settings-section.ts`; four-tier menu in `label.ts` (allocation view now keyed on `depth`); legacy tier branch in `control.ts` `toastText`; legacy hooks/Router/JudgementBook in `index.ts`; legacy branch in `subagent-tool.ts`; `TIER_QUESTIONS`/`tierAbove`/`judge` in `jev.ts`; `mapEffort`/`targetEffort`/`CHILD_MODELS`/tiers in `effort.ts`. `policy-v2-rubric.json` → `rubric.json` (sha256 `e3eff171…` equals the fixture). `SettingsRead.deprecated` lists `childRoutes`/`mainEfforts`/`policy` present in the file; patches with them are rejected as unknown fields; saves drop them. The settings page shows "旧映射…已不再生效，下次保存设置时移除". `label` rejects any key other than `sessionId`/`messageId`/`feedback` with 400 before touching any file. `route_subagent` errors for an unusable route always say "暂停委派并询问用户".
- 3.3: `buildState` has no `previous` parameter; first line is the fixed `Previous user-turn tier: none` (byte-identical to what the default chain already sent). `RoutingState.remember` removed; `previous` is still parsed and preserved on rewrite, never updated.
- Tests deleted with legacy (test-plan Coverage Notes): `router`, `label-report`, `eval-runner`, `route-picker.dom`, `settings-states.dom`, `effort`, `settings-validation` (mapping validators), the mapping cases of `settings` and `settings-section.dom`, the legacy cases of `host.integration` (`jev_tier_drives_effort`, `state_carries_previous_turn`, `main_and_tool_share_questions`, `main_decision_toast`, `subagent_decision_toast`, `previous_tier_survives_restart`, `judgement_*`, `label_*`, `settings_rpc_…`, `family_mapping_…`, `selection_sync_failure_does_not_block_request` — the default-chain equivalent is `policy-host` "selection sync failure …"), the legacy branches of `subagent-tool`, `policy-host` ("keeps legacy and manual creation …" → MANUAL part kept) and `label-button` (tier menu). `jev.test.ts` transport/failure tests were moved from `judge` to `judgePolicy(…,'main')` with the same expected categories and limits; `policy-v2-jev.test.ts` → `jev-dimensions.test.ts`.
- Package suite after section 3: 205 passed, 2 failed (baseline zstd only). `tsc` (src and test configs) clean.
