## 1. Manifest validation for jevProvider

- [ ] 1.1 Write failing tests: "jevProvider openrouter entry validates with mapped credential", "credentialEnv mismatch with jevProvider is rejected before side effects", "unknown or missing jevProvider is rejected"; update the shared `mcp` fixture to `jevProvider: typesafe` (assert they fail for the right reason)
- [ ] 1.2 Implement: `jevProvider` field in `FIELDS['npm-mcp-server']`, closed-set check and fixed credential mapping in `validateMcp` to pass 1.1
- [ ] 1.3 Refactor; full suite stays green

## 2. Package-pin enumeration ignores the transport enum

- [ ] 2.1 Write failing test: "mixed workflow and MCP pin enumeration excludes transport enum" (resolver call count/specs, no `openrouter` argument)
- [ ] 2.2 Implement: confirm/adjust pin traversal so only package objects are enumerated (rename already avoids the collision; add a type guard if the test exposes any gap) to pass 2.1
- [ ] 2.3 Refactor; full suite stays green

## 3. Generated row and launcher per provider

- [ ] 3.1 Write failing tests: "openrouter row and launcher pass only the openrouter credential", "openrouter launcher exits 78 silently without its credential", "openrouter launcher missing entry diagnostics omit credential", "generated row and launcher contain variable names but no credential values"; update the TypeSafe launcher test to the new signature
- [ ] 3.2 Implement: `renderResourcePatch` uses `credentialEnv`; `renderMcpLauncher(entry, { jevProvider, credentialEnv })` and its caller in `syncManagedLaunchers` pass validated values, to pass 3.1
- [ ] 3.3 Refactor; full suite stays green

## 4. Credential channel and readiness

- [ ] 4.1 Write failing tests: "literal OPENROUTER_API_KEY in env.local reaches hostEnv", "shell-expanded credential line is rejected without echoing value" (expected to pass already; if green immediately, record as characterization and keep), "readiness reports configured credential variable without its value", "readiness prefers v4 session file and falls back to v3"
- [ ] 4.2 Implement: `scripts/jev-readiness.mjs` reads `credentialEnv` from the manifest, reports `credential.variable`, looks up v4 then v3 session files, to pass 4.1
- [ ] 4.3 Refactor; full suite stays green

## 5. Recorder: jevProvider field and region-blocked category

- [ ] 5.1 Write failing tests: "region-blocked category is kept and counted in summary", "jevProvider outside closed set or missing is stored as unknown"; update "record persists only normalized bounded fields…" key set and the legacy-v1 test (jevProvider unknown, proven latency kept)
- [ ] 5.2 Implement: `region-blocked` in `ERROR_CATEGORIES`; `jevProvider` in normalized and stored records with closed-set fallback to `unknown`, to pass 5.1
- [ ] 5.3 Refactor; full suite stays green

## 6. Recorder: deterministic attribution from jevCalls

- [ ] 6.1 Write failing tests: "jevCalls projections yield deterministic provider and category", "incidental numbers are not HTTP statuses and pinned deadline is timeout", "semantic and agent-observed failures survive jevCalls and stay needs-review", "provider error text never persists in records or recorder output"
- [ ] 6.2 Implement: `jevCalls` validation (≤2 items, shapes, 512-char messages), anchored provider/status grammars, deadline/network/timeout rules, semantic → malformed-response, preserve supplied category when no failed call; `jevCalls` never persisted, to pass 6.1
- [ ] 6.3 Refactor; full suite stays green

## 7. Recorder: input safety

- [ ] 7.1 Write failing test: "malformed stdin gets fixed diagnostic and shell-shaped text stays inert"
- [ ] 7.2 Implement: `readStdin` throws a fixed `invalid JSON input` error without parser text, to pass 7.1
- [ ] 7.3 Refactor; full suite stays green

## 8. Report breakdown by provider

- [ ] 8.1 Write failing test: "report breaks down real-vibe records by jevProvider including unknown"; extend "synthetic fixtures never contribute…" with a jevProvider assertion and "disabled mode prevents…" with a jevCalls input
- [ ] 8.2 Implement: `breakdowns.jevProvider` over real-vibe records with closed keys plus `breakdowns.jevProviderScope: 'attributed-records-only'`; Phase 2 gates unchanged, to pass 8.1
- [ ] 8.3 Refactor; full suite stays green

## 9. Skill instructions

- [ ] 9.1 Write failing test: extend "skill is an observation-only closed two-step shadow router" to require `jevCalls`, `region-blocked`, the temp-file + `< file` stdin instruction, the no shell/heredoc/argv rule, explicit `errorCategory: none` on full success, and cleanup of the staging file
- [ ] 9.2 Implement: update `skills/jev-workflow-router/SKILL.md` (projection shape, narrow raw-text exception, staging file permissions/cleanup) to pass 9.1
- [ ] 9.3 Refactor; full suite stays green

## 10. Manifest switch and deployment

- [ ] 10.1 Run `npm test` and `npm run check:artifacts`; confirm both pass
- [ ] 10.2 Update `dsh.yaml` Jev entry: `jevProvider: openrouter`, `credentialEnv: OPENROUTER_API_KEY`; update the jev-workflow-router note (OpenRouter processor, terms not separately reviewed, key kept in `.env.local` and credentials store separately)
- [ ] 10.3 User adds `export OPENROUTER_API_KEY=...` to `.env.local` (agent does not read or copy the key); confirm via `node scripts/jev-readiness.mjs` that `privateEnvDeclaration` is true
- [ ] 10.4 Run `dsh build` twice; confirm the second run reports no changes
- [ ] 10.5 Restart Host (user-approved); in a new session confirm `mcp__jev__jev_classify`/`jev_decide` are present and `liveProbeReady: true`
- [ ] 10.6 Perform one real shadow observation and confirm the stored record has `jevProvider: openrouter`; record results in verify.md
