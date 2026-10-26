## 1. Manifest validation for jevProvider

- [x] 1.1 Write failing tests: "jevProvider openrouter entry validates with mapped credential", "credentialEnv mismatch with jevProvider is rejected before side effects", "unknown or missing jevProvider is rejected"; update the shared `mcp` fixture to `jevProvider: typesafe` (assert they fail for the right reason)
- [x] 1.2 Implement: `jevProvider` field in `FIELDS['npm-mcp-server']`, closed-set check and fixed credential mapping in `validateMcp` to pass 1.1
- [x] 1.3 Refactor; full suite stays green

## 2. Package-pin enumeration ignores the transport enum

- [x] 2.1 Write failing test: "mixed workflow and MCP pin enumeration excludes transport enum" (resolver call count/specs, no `openrouter` argument) — green on first run because D1 rename already prevents the collision; a direct probe confirmed `packagePins` would emit a string if a `provider` string reached it, which this test's object-shape assertions reject
- [x] 2.2 Implement: confirm/adjust pin traversal so only package objects are enumerated (rename already avoids the collision; add a type guard if the test exposes any gap) to pass 2.1
- [x] 2.3 Refactor; full suite stays green

## 3. Generated row and launcher per provider

- [x] 3.1 Write failing tests: "openrouter row and launcher pass only the openrouter credential", "openrouter launcher exits 78 silently without its credential", "openrouter launcher missing entry diagnostics omit credential", "generated row and launcher contain variable names but no credential values"; update the TypeSafe launcher test to the new signature
- [x] 3.2 Implement: `renderResourcePatch` uses `credentialEnv`; `renderMcpLauncher(entry, { jevProvider, credentialEnv })` and its caller in `syncManagedLaunchers` pass validated values, to pass 3.1
- [x] 3.3 Refactor; full suite stays green

## 4. Credential channel and readiness

- [x] 4.1 Write failing tests: "literal OPENROUTER_API_KEY in env.local reaches hostEnv", "shell-expanded credential line is rejected without echoing value" (both env tests green on first run — existing strict parser already satisfies them; kept as characterization), "readiness reports configured credential variable without its value", "readiness prefers v4 session file and falls back to v3"
- [x] 4.2 Implement: `scripts/jev-readiness.mjs` reads `credentialEnv` from the manifest, reports `credential.variable`, looks up v4 then v3 session files, honours `DSH_REPO_ROOT` for test isolation, to pass 4.1
- [x] 4.3 Refactor; full suite stays green

## 5. Recorder: jevProvider field and region-blocked category

- [x] 5.1 Write failing tests: "region-blocked category is kept and counted in summary", "jevProvider outside closed set or missing is stored as unknown"; update "record persists only normalized bounded fields…" key set and the legacy-v1 test (jevProvider unknown, proven latency kept)
- [x] 5.2 Implement: `region-blocked` in `ERROR_CATEGORIES`; `jevProvider` in normalized and stored records with closed-set fallback to `unknown`, to pass 5.1
- [x] 5.3 Refactor; full suite stays green

## 6. Recorder: deterministic attribution from jevCalls

- [x] 6.1 Write failing tests: "jevCalls projections yield deterministic provider and category", "incidental numbers are not HTTP statuses and pinned deadline is timeout", "semantic and agent-observed failures survive jevCalls and stay needs-review", "provider error text never persists in records or recorder output"
- [x] 6.2 Implement: `jevCalls` validation (≤2 items, shapes, 512-char messages), anchored provider/status grammars, deadline/network/timeout rules, semantic → malformed-response, preserve supplied category when no failed call; `jevCalls` never persisted, to pass 6.1
- [x] 6.3 Refactor; full suite stays green

## 7. Recorder: input safety

- [x] 7.1 Write failing test: "malformed stdin gets fixed diagnostic and shell-shaped text stays inert"
- [x] 7.2 Implement: `readStdin` throws a fixed `invalid JSON input` error without parser text, to pass 7.1
- [x] 7.3 Refactor; full suite stays green

## 8. Report breakdown by provider

- [x] 8.1 Write failing test: "report breaks down real-vibe records by jevProvider including unknown"; extend "synthetic fixtures never contribute…" with a jevProvider assertion and "disabled mode prevents…" with a jevCalls input
- [x] 8.2 Implement: `breakdowns.jevProvider` over real-vibe records with closed keys plus `breakdowns.jevProviderScope: 'attributed-records-only'`; Phase 2 gates unchanged, to pass 8.1
- [x] 8.3 Refactor; full suite stays green

## 9. Skill instructions

- [x] 9.1 Write failing test: extend "skill is an observation-only closed two-step shadow router" to require `jevCalls`, `region-blocked`, the temp-file + `< file` stdin instruction, the no shell/heredoc/argv rule, explicit `errorCategory: none` on full success, and cleanup of the staging file
- [x] 9.2 Implement: update `skills/jev-workflow-router/SKILL.md` (projection shape, narrow raw-text exception, staging file permissions/cleanup) to pass 9.1
- [x] 9.3 Refactor; full suite stays green

## 10. Manifest switch and deployment

- [x] 10.1 Run `npm test` and `npm run check:artifacts`; confirm both pass — artifacts pass; npm test 613 pass / 7 fail, the 7 identical to the pre-change baseline (launcher host-lifecycle tests, `test_link_from_external_cwd`, auto-model-routing bundle migration), none touching this change
- [x] 10.2 Update `dsh.yaml` Jev entry: `jevProvider: openrouter`, `credentialEnv: OPENROUTER_API_KEY`; update the jev-workflow-router note (OpenRouter processor, terms not separately reviewed, key kept in `.env.local` and credentials store separately)
- [x] 10.3 User adds `export OPENROUTER_API_KEY=...` to `.env.local` (agent does not read or copy the key); confirm via `node scripts/jev-readiness.mjs` that `privateEnvDeclaration` is true
- [x] 10.4 Run `dsh build` twice; confirm the second run reports no changes — first build needed `node scripts/bootstrap.mjs` (root `zx` from the main merge was not installed); build 1 applied 28 changes (jev launcher + bridge row regenerated for openrouter), build 2 applied 3 pnpm-level changes unrelated to Jev, build 3 reported `no changes`
- [x] 10.5 Restart Host (user-approved); in a new session confirm `mcp__jev__jev_classify`/`jev_decide` are present and `liveProbeReady: true`
- [x] 10.6 Perform one real shadow observation and confirm the stored record has `jevProvider: openrouter`; record results in verify.md
