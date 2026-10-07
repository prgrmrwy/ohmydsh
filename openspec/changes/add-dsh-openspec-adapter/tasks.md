## 0. Gate and target-runtime probes

Round history: round 1 is VOID. Round 2 was `APPROVE_WITH_CHANGES` with all 16 Required Changes accepted over three narrow re-checks. The user-authorized `openspec-upgrade` naming amendment supersedes that review; fresh-context round 3 is `VERDICT: APPROVE`, `CHANGES_APPLIED: n/a`. This approves artifacts only: review I1 records Host-side management mutation as an implementation acceptance blocker, not a new authorization. Any further edit to proposal, design or specs voids the verdict and needs a new review round.

- [x] 0.1 Confirm the round-2 review exists and read its Required Changes (done; round-1 gate no longer applies)
- [x] 0.2 Probe Skill get/load seam. **Result**: `dsh-tool-skill` calls `ctx.skills.get(name,{cwd,signal,scope})`; provider `get(candidate,options)` is the real load event; `list` is catalog-driven. The loader returns only `content`. Two carriers reach the model: the `skill` tool result and the user `/name` gesture injection. **Decision (user)**: append one delimited adapter block after the unmodified body.
- [x] 0.3 Probe: can the official filesystem provider alone serve a generation directory? **Result**: it can read a directory and its class is exported, but it has no load hook; a thin custom provider reusing its discovery is needed.
- [x] 0.4 Probe: session-scoped tools / layering. **Result**: `tools.register()` lands in the calling context's scope layer; `tools.restrict()` filters only the inherited layer. **Decision**: no session tool is published in this change.
- [x] 0.5 Probe: can the header prove an ordinary session? **Result** (56 decoded v3 logs): header fields are `id, cwd, parentSession, isSeeded, origin, delegationDepth, agentPreset`; a workspace-resident Pet executor (`agentPreset: standard`) has a header identical to an ordinary session; no real dedicated-Pet-executor or Locus-child sample exists locally. Earlier tool-count/catalog comparisons were confounded by session era and are void. **Decision**: no routing tool in any session.
- [x] 0.6 Probe: non-waking notice seam. **Result (corrected after review)**: `Agent.inject` exists and is non-waking, but it persists an extra user-role message, is best-effort, and the provider has no agent handle. **Decision**: notice only as an attachment in the adapter block of the next consumption result.
- [x] 0.7 Probe: does `openspec init --profile` write global config? **Result**: `--profile` is read-only; extend-mode `migrateIfNeeded` writes the global config when it has no `profile` field and the project already holds official workflow artifacts. **Adjustment**: the init result warns when the workspace already contains `openspec` (covered by a scenario).
- [x] 0.8 Probes contradicted the design in three places; design, specs, test-plan and tasks were revised and Anvil round 2 was run.
- [x] 0.9 Probe 0.10 (review C3): **Result (reproduced with the real `SkillRegistry` + `createScope`)**: a host-level provider is listed and loaded from a Pet-style scope; the registry merges the global layer into every scope view and has no restrict API. **Decision (user)**: match archify/spec-superflow (host-level), declare the gap, record it in `BACKLOG.md`, do not fix it here.
- [x] 0.10 Reviewer re-check of the round-2 Required Changes: accepted over three re-checks; `review.md` shows `CHANGES_APPLIED: yes`
- [x] 0.11 Implementation location: this session is already bound to `.worktrees/openspec-apply-change-add-dsh-openspec-adapter`; implement only in this worktree. Do not write or commit planning artifacts to the main checkout. The original assumption that this session was unbound and therefore needed a new Worktree Session was stale.

## 1. Package skeleton and deployment record

- [x] 1.1 Write failing test: R/sync-dsh-openspec.test.mjs `dsh_openspec_clean_sync_then_noop_with_notice` (red: package manifest absent)
- [x] 1.2 Implement: new `packages/dsh-openspec` (package.json with exact `@fission-ai/openspec@1.13.2`, current-family peers, NOTICE crediting `@codigoconelmer/dsh-openspec@0.1.0` gitHead 95966d07 MIT, cordis.patch.yml, build config), root lockfile, `dsh.yaml` entry whose `note` records the official dependency in prose without a version, `.gitignore` for build output
- [x] 1.3 Refactor; full suite stays green
- [x] 1.4 Write failing test: R/sync-dsh-openspec.test.mjs `dsh_openspec_pin_mismatch_vs_lockfile_fails_without_profile_change` (red: sync succeeded despite conflicting lockfile version)
- [x] 1.5 Implement: pre-profile sync check compares package.json pin to root lockfile workspace pin and resolved name/version, requires lockfile integrity; diagnostic `dsh-openspec-pin-mismatch` names both values
- [x] 1.6 Refactor; full suite stays green (npm test: 255 pass, 2 skipped)
- [x] 1.7 Write failing test: P/options.test.ts `options_read_from_settings_namespace_with_documented_defaults` (red: missing options module)
- [x] 1.8 Implement: read `updateCheck` and `telemetry` from the DSH settings namespace `dsh-openspec` with defaults `enabled` / `adapter-off`
- [x] 1.9 Refactor; package test, typecheck, and build pass

## 2. Upstream compatibility, catalog and generations

- [x] 2.1 Write failing test: P/upstream-compat.test.ts `renders_official_catalog_and_bodies_equal_render_official_body` (red: missing upstream-compat module)
- [x] 2.2 Implement: `upstream-compat` module loads internals by absolute file URL and provides `renderOfficialBody(selection)` with `/opsx:` → `/opsx-` transform and 12-workflow mapping
- [x] 2.3 Refactor; package test passes (2 tests)
- [x] 2.4 Write failing test: P/upstream-incompat.test.ts `rejects_incompatible_colliding_or_marker_bearing_upstream_and_keeps_active_generation` (red: preparation entry missing)
- [x] 2.5 Implement: typed `upstream-incompatible` preparation failure for custom-name collisions and marker/loader-closer scan; preparation is side-effect free
- [x] 2.6 Refactor; package tests (3) and typecheck pass
- [x] 2.7 Write failing test: P/catalog-invalidation.test.ts `profile_edit_invalidates_provider_and_next_listing_reflects_it` (red: missing catalog invalidation module)
- [x] 2.8 Implement: global-config stat monitor with at-most-30s interval and `invalidate()` callback. Round-5 audit/repair: monitor now awaits async refresh; actual registration control.invalidate is called after single-flight materialization, both Skill and command surfaces follow current selection/delivery, get and slash consumption refresh before delivery, returning to prior profile works. Timer is disposed; failed refresh preserves prior surface and can retry.
- [x] 2.9 Refactor; package test and typecheck pass. Round-5 evidence adds actual apply with official CLI and real SkillRegistry cached-list regression, dropped command handler denial, failed-refresh/single-flight/disposal tests; earlier callback-only test did not prove runtime wiring.
- [x] 2.10 Write failing test: P/generations.test.ts `loaded_generation_stays_executable_after_new_selection` (red: missing generations module)
- [x] 2.11 Implement: immutable generation materialization under `$DSH_HOME/plugins/dsh-openspec/generations/<identity>/`, atomic active reference, no deletion of non-staging generations. Round-5 repair retains selection/delivery metadata rather than rewriting manifest at activation; reuse validates exact metadata and removes staging, prior manifest bytes unchanged, cancelled refresh refuses activation. Round-6 RED 3 closure tests → GREEN nested-version/cycle/internal-edge resolution and missing optional handling, recursive runtime hashes with tamper/source drift refusal, unique staging and concurrent same-id convergence; source removed then CLI still executes.
- [x] 2.12 Refactor; package test/typecheck pass
- [x] 2.13 Write failing test: P/generations.test.ts `activation_racing_a_load_never_mixes_body_and_block_generations` (captured generation remains stable across activation)
- [x] 2.14 Implement: each load resolves active generation once and returns an immutable snapshot
- [x] 2.15 Refactor; package test/typecheck pass
- [x] 2.16 Write failing test: P/generations.test.ts `lookup_without_cwd_returns_same_body_and_block` (cwd-free data API)
- [x] 2.17 Implement: generation lookup is cwd independent
- [x] 2.18 Refactor; package test/typecheck pass
- [x] 2.19 Write failing test: P/generations.test.ts `missing_or_partial_generation_fails_with_typed_error_and_no_body` (malformed generation refused)
- [x] 2.20 Implement: typed error for absent/invalid active generation; generation id is loaded from the same immutable generation object
- [x] 2.21 Refactor; package tests (8) and typecheck pass

## 3. Adapter block and managed invocation

- [x] 3.1 Write failing test: P/adapter-block.test.ts `block_parses_last_closed_fields_and_identical_for_tool_and_gesture` (red: missing adapter block module)
- [x] 3.2 Implement: single block builder with fixed markers and closed field set, shared `parseAdapterBlock` helper, one builder for both carriers
- [x] 3.3 Refactor; package tests/typecheck pass
- [x] 3.4 Write failing test: P/adapter-block.test.ts `hostile_generation_path_round_trips_as_single_shell_argument_and_newline_rejected` (red: missing quoting helper)
- [x] 3.5 Implement: POSIX quoting with control-character/absolute-path validation → `block-unrenderable`
- [x] 3.6 Refactor; package tests/typecheck pass
- [x] 3.7 Write failing test: P/adapter-block.test.ts `block_bytes_identical_for_different_cwds` (cwd-independent pure builder)
- [x] 3.8 Implement: no cwd, arguments, project text or raw registry strings in block
- [x] 3.9 Refactor; package tests/typecheck pass
- [x] 3.10 Write failing test: P/adapter-block.test.ts `hostile_registry_version_is_canonicalized_or_omitted_single_marker_pair` (invalid notice omitted)
- [x] 3.11 Implement: versions canonicalized; omit notice on non-canonical input
- [x] 3.12 Refactor; package tests/typecheck pass
- [x] 3.13 Write test: P/managed-invocation.test.ts `body_then_one_block_with_pinned_version_and_telemetry_and_update_check_off`
- [x] 3.14 Implement: managed invocation with `OPENSPEC_NO_UPDATE_CHECK=1`, default `OPENSPEC_TELEMETRY=0`
- [x] 3.15 Refactor; package tests pass
- [x] 3.16 Write test: P/managed-invocation.test.ts `official_cli_makes_zero_registry_requests_and_telemetry_official_omits_assignment`
- [x] 3.17 Implement: official telemetry omits assignment, retains update-check disable
- [x] 3.18 Refactor; package tests pass
- [x] 3.19 Write failing test: P/manage-check.test.ts `check_reports_path_managed_version_mismatch` (red: missing diagnostics module)
- [x] 3.20 Implement: management check reports path/managed version, mismatch, node engine support, recovery, and winning provider facts
- [x] 3.21 Refactor; focused package test/typecheck pass
- [x] 3.22 Write failing test: P/precedence.test.ts `project_skill_wins_and_check_reports_winning_source_and_provider` (red: diagnoseSkillWinners missing)
- [x] 3.23 Implement: diagnostics read winning `source`/`provider`; registry resolution means shadowed provider get is not called
- [x] 3.24 Refactor; focused package test/typecheck pass

## 4. Commands and init

- [x] 4.1 Write failing test: P/command-carrier.test.ts `command_adapter_message_has_body_then_block_without_raw_argument_and_a_separate_user_message_carries_it` (red: missing commands module)
- [x] 4.2 Implement: register official `opsx-*`, init and management commands; keep trusted adapter instructions separate from raw user args; disable duplicate audit payload
- [x] 4.3 Refactor; command carrier test and package typecheck pass
- [x] 4.4 Write failing test: P/init-command.test.ts `default_init_creates_skeleton_without_tool_skills` (red: missing init builder)
- [x] 4.5 Implement: `/openspec-init` command builder with no-tools/no-cloud/no-animation defaults
- [x] 4.6 Refactor; focused tests pass
- [x] 4.7 Write failing test: P/init-command.test.ts `rejects_metacharacters_unknown_tools_and_bad_language` (covered by input validation tests)
- [x] 4.8 Implement: tool/profile enum checks, language regex and typed invalid-options error
- [x] 4.9 Refactor; package tests/typecheck pass
- [x] 4.10 Write test: P/init-command.test.ts `never_offers_force_and_never_spawns_from_host`
- [x] 4.11 Implement: builder omits force; Host handler returns a command rather than spawning it
- [x] 4.12 Refactor; package tests pass
- [x] 4.13 Write test: P/init-command.test.ts `warns_about_global_config_only_when_openspec_dir_exists`
- [x] 4.14 Implement: warning is conditional on existing workspace OpenSpec directory
- [x] 4.15 Refactor; package tests/typecheck pass

## 5. Update check and notice

- [x] 5.1 Write failing test: P/update-check.test.ts `concurrent_consumers_share_one_request_across_restart` (red: missing checker module)
- [x] 5.2 Implement: single-flight, shared atomic cache/lock, 24h TTL, 2s auto budget, redirects rejected
- [x] 5.3 Refactor; focused suite green
- [x] 5.4 Write failing test: P/update-check.test.ts `request_is_fixed_latest_url_and_real_shaped_fixture_fits_limit`
- [x] 5.5 Implement: fixed latest URL, bounded response and version-only selection
- [x] 5.6 Refactor; focused suite green
- [x] 5.7 Write test: P/update-check.test.ts `failures_normalize_and_back_off_fifteen_minutes`
- [x] 5.8 Implement: normalized error states, failure backoff, `ahead-of-latest`
- [x] 5.9 Refactor; focused suite green
- [x] 5.10 Write test: P/update-check.test.ts `corrupt_future_dated_cache_and_stale_lock_are_ignored`
- [x] 5.11 Implement: corrupt/future cache ignored and stale lock expiry
- [x] 5.12 Refactor; focused suite green
- [x] 5.13 Write test: P/update-check.test.ts `unwritable_state_dir_still_serves_with_at_most_one_request_and_reports_state_unwritable`
- [x] 5.14 Implement: fail-open consumption with 15m per-process limit and `state-unwritable`
- [x] 5.15 Refactor; focused suite green
- [x] 5.16 Write test: P/update-check.test.ts `disabled_option_makes_zero_requests`
- [x] 5.17 Implement: disabled automatic/explicit checks report `check-disabled`
- [x] 5.18 Refactor; focused suite green
- [x] 5.19 Write failing test: P/update-notice.test.ts `newer_release_notice_once_in_one_result_without_turn_or_install` (red: no notice attached)
- [x] 5.20 Implement: attach update notice only in the adapter block on consumption; no scope → no notice
- [x] 5.21 Refactor; focused tests green
- [x] 5.22 Write failing test: P/update-notice.test.ts `racing_model_and_gesture_consumers_spend_notice_once` (parallel consumption reproduces duplicate check)
- [x] 5.23 Implement: synchronous scope-identity WeakMap reservation before check; dedup test is concurrent
- [x] 5.24 Refactor; focused tests green
- [x] 5.25 Write failing test: P/update-notice.test.ts `newer_pair_renotifies_and_scope_less_lookup_gets_none`
- [x] 5.26 Implement: pair-sensitive notices; scope-less lookup remains notice-free; consumer path passes live scope
- [x] 5.27 Refactor; full suite stays green
- [x] 5.28 Write failing test: P/scope-option.test.ts `scope_reaches_provider_get_at_model_and_gesture_call_sites_and_undefined_agent_gets_no_notice`. Round10 replaces synthetic-only evidence with `tests/openspec-skill-caller.smoke.mjs`: actual official tool.execute and gesture listeners, real Cordis SkillRegistry/createScope, current adapter provider. Both model and gesture missing-scope negative controls fail at their distinct intended scope assertions; no import failure counted as RED.
- [x] 5.29 Implement: pin the registry-passes-options-through dependency with the real dsh-tool-skill model path and gesture path; undefined agent -> no notice. Fresh pinned official caller0.1.5-rc.2 passes scope identity/cwd/signal/full rendered-frame equality and no-agent zero-check assertions on VM; no caller/registry patch needed. Explicit runtime anchor/version required, no skip/install/mock replacement. VM main launcher's caller unexpectedly rc.3 (byte-identical caller JS) passes separately labeled diagnostic run; it is NOT silently accepted as the rc.2 pin. Fixture agents only, no real-session/header acceptance.
- [x] 5.30 Refactor; full suite stays green. Round10 final pinned caller smoke pass; package32files/115tests/build/typecheck pass; repository263total/261pass/0fail/2existing skips (bash-40); artifacts/strict/diff checks pass. No production mutation, no dependency installation or Host session/model requests.
- [x] 5.31 Write failing test: P/update-notice.test.ts `tool_gesture_and_command_consumers_each_spend_notice_and_listing_never_does` (assert it fails for the right reason)
- [x] 5.32 Implement: notice consumed by any adapter-skill `get`, including command handler, never by catalog listing
- [x] 5.33 Refactor; full suite stays green
- [x] 5.34 Write failing test: P/update-notice.test.ts `notice_state_keyed_to_discarded_scope_is_never_read_or_written` (assert it fails for the right reason)
- [x] 5.35 Implement: completion for a discarded scope is dropped and does not write WeakMap state
- [x] 5.36 Refactor; full suite stays green

## 6. Management flow

- [x] 6.1 Write failing test: P/manage-flow.test.ts `loading_manage_help_mutates_nothing` (assert it fails for the right reason)
- [x] 6.2 Implement: `openspec-upgrade` Skill and `/openspec-upgrade` guidance separating upgrade, `openspec update` and change revision; no mutation on load
- [x] 6.3 Refactor; full suite stays green
- [x] 6.4 Write failing test: P/manage-flow.test.ts `upgrade_changes_only_runtime_selection` (assert it fails for the right reason)
- [x] 6.5 Implement: upgrade path wired to the transaction helper only; project refresh requires separate approval. Round-3 I1 local repair: Host controller/service removed; handler prepares only a quoted command for calling-session Bash, updater rechecks approval, recorded realpath cwd and .git worktree status before staging; project refresh uses the active managed CLI with caller cwd and telemetry policy. `session-management.test.ts` RED 2 Host mutation assertions → GREEN; `session-updater.test.ts` RED 4 stub behavior assertions → GREEN. Existing Worktree Bash guard denial and built helper shell/cwd isolation verified. Real session sandbox/VM upgrade evidence remains outside this local completion.
- [x] 6.6 Refactor; full suite stays green: package build/typecheck and 29 files/88 tests pass; repository 263 total/261 pass/0 fail/2 existing skips; artifact/strict/diff checks pass. Old Host-dispatch tests corrected to the unchanged D3 requirement, transaction tests retained. No acceptance or deployment claimed.

### User-authorized naming amendment (round 3)

- [x] 6.7 Write failing regression: `P/upgrade-entry.test.ts` asserts new Skill/slash discovery with no old alias, canonical notice destination, read-only help/new usage text, and new generation identity retaining old bytes. RED: all four failed against `de0b93d` source (old registration, omitted notice, missing new handler, identity collision).
- [x] 6.8 Implement: rename to `openspec-upgrade`, describe the adapter-defined managed official OpenSpec stack, update reserved-name/notice wiring and both generation identity derivations; GREEN: all four naming regressions pass. No Host mutation authorization or boundary repair is claimed.
- [x] 6.9 Refactor and run package build/typecheck/tests, repository tests/artifact checks, strict validation; evidence: 27 files/80 package tests pass, repo 263 total/261 pass/0 fail/2 pre-existing skips, build/typecheck/artifact/strict/diff checks pass. Recorded in verify.md; I1/live-evidence gaps remain open. No sync/deployment or final change acceptance claimed.

## 7. Source-owned upgrade/rollback transaction and recovery

- [x] 7.1 Write failing test: R/dsh-openspec-upgrade.test.mjs `approved_upgrade_persists_across_sync_without_pin_mismatch_and_keeps_old_generation` (assert it fails for the right reason)
- [x] 7.2 Implement: helper locating the sync-recorded realpath checkout; staging (ignore-scripts, parity, CLI smoke, lockfile integrity == registry `dist.integrity`); CAS of exactly package.json dependency entry + root lockfile; sync; activation; `activation: live | pending-reload`
- [x] 7.3 Refactor; full suite stays green
- [x] 7.4 Write failing test: R/dsh-openspec-upgrade.test.mjs `rollback_rewrites_source_and_survives_sync_without_mismatch` (assert it fails for the right reason)
- [x] 7.5 Implement: rollback as the same transaction type targeting B
- [x] 7.6 Refactor; full suite stays green
- [x] 7.7 Write failing test: R/dsh-openspec-upgrade.test.mjs `blocked_or_failed_upgrade_keeps_hashes_and_active_id` (assert it fails for the right reason)
- [x] 7.8 Implement: `blocked` for Worktree-bound caller, non-recorded checkout, unwritable source, denied policy, integrity mismatch, related drift, concurrent lock; frozen startup-time fields
- [x] 7.9 Refactor; full suite stays green
- [x] 7.10 Write failing test: R/dsh-openspec-upgrade.test.mjs `kill_after_cas_reports_recovery_in_block_and_old_generation_serves` (assert it fails for the right reason)
- [x] 7.11 Implement: prepared journal before source write; report-only `recovery-required` via the block `recovery` field and the management check; upgrade refusal until resolved
- [x] 7.12 Refactor; full suite stays green
- [x] 7.13 Write failing test: R/dsh-openspec-upgrade.test.mjs `user_edit_after_cas_returns_recovery_required_untouched` (assert it fails for the right reason)
- [x] 7.14 Implement: hash-guarded rollback with manual reconciliation steps
- [x] 7.15 Refactor; full suite stays green

## 8. Routing registry and dispatcher (contract-only)

- [x] 8.1 Write failing test: P/routing-registry.test.ts `selected_provider_invoked_once_then_unavailable_after_dispose` (assert it fails for the right reason)
- [x] 8.2 Implement: experimental v1 registration service, explicit `activeProviderId`, disposer, cancellation on dispose. Round-6 whole-registry teardown RED missing dispose → GREEN cancels pending requests, denies later registration and adapter cleanup invokes it.
- [x] 8.3 Refactor; full suite stays green
- [x] 8.4 Write failing test: P/routing-registry.test.ts `invalid_or_missing_provider_never_falls_back` (assert it fails for the right reason)
- [x] 8.5 Implement: duplicate/unsupported/absent handling without order-based fallback
- [x] 8.6 Refactor; full suite stays green
- [x] 8.7 Write failing test: P/routing-dispatch.test.ts `two_stage_tokens_correlate_and_candidate_kinds_differ` (assert it fails for the right reason)
- [x] 8.8 Implement: bounded feature schema, typed candidates from official schema discovery and trusted external declarations
- [x] 8.9 Refactor; full suite stays green
- [x] 8.10 Write failing test: P/routing-dispatch.test.ts `invalid_stage_tokens_refused_with_zero_callbacks` (assert it fails for the right reason)
- [x] 8.11 Implement: ≥128-bit single-use session-bound token with 10min TTL, injectable clock, bounded table with eviction, `invalid-stage-token`
- [x] 8.12 Refactor; full suite stays green
- [x] 8.13 Write failing test: P/routing-dispatch.test.ts `unknown_features_or_ineligible_candidate_needs_review` (assert it fails for the right reason)
- [x] 8.14 Implement: input/result validation, never fabricate a candidate
- [x] 8.15 Refactor; full suite stays green
- [x] 8.16 Write failing test: P/routing-dispatch.test.ts `traversal_change_name_rejected_and_candidate_text_bounded_stripped_labeled` (assert it fails for the right reason)
- [x] 8.17 Implement: change-name pattern validation and root containment (no traversal/symlink escape); candidate text ≤2 KiB, control-stripped, labeled untrusted
- [x] 8.18 Refactor; full suite stays green
- [x] 8.19 Write failing test: P/routing-authority.test.ts `existing_change_returns_recorded_schema_without_callback` (assert it fails for the right reason)
- [x] 8.20 Implement: dispatcher-resolved existing-change authority via official discovery
- [x] 8.21 Refactor; full suite stays green
- [x] 8.22 Write failing test: P/routing-authority.test.ts `confident_result_has_authority_none_and_no_side_effects` (assert it fails for the right reason)
- [x] 8.23 Implement: `authority: none` on every result; no side effects
- [x] 8.24 Refactor; full suite stays green
- [x] 8.25 Write failing test: P/routing-authority.test.ts `unapproved_provider_unavailable_with_zero_callbacks` (assert it fails for the right reason)
- [x] 8.26 Implement: approval-record gate (test fixtures only in this change; Jev not selectable)
- [x] 8.27 Refactor; full suite stays green
- [x] 8.28 Write failing test: P/routing-entry.test.ts `single_entry_is_only_route_to_provider_and_no_other_export_reaches_it` (assert it fails for the right reason)
- [x] 8.29 Implement: one in-process dispatcher entry; no tool, no guidance, no session registration
- [x] 8.30 Refactor; full suite stays green
- [x] 8.31 Write failing test: P/routing-failure.test.ts `needs_review_passes_through_without_substitution` (assert it fails for the right reason)
- [x] 8.32 Implement: pass-through of `needs-review`
- [x] 8.33 Refactor; full suite stays green
- [x] 8.34 Write failing test: P/routing-failure.test.ts `timeout_cancel_throw_unload_normalize_and_persist_no_text` (assert it fails for the right reason)
- [x] 8.35 Implement: 5s budget, cancellation forwarding, stale-result discard, normalized error class only
- [x] 8.36 Refactor; full suite stays green

## 9. Host wiring and target-runtime smoke (isolated profile only)

- [ ] 9.1 Write failing test: L/cross-workspace.smoke.mjs `second_workspace_discovers_surface_and_uses_own_cwd` (assert it fails for the right reason)
- [ ] 9.2 Implement: register the Skill provider and commands as host-level (matching archify/spec-superflow); no agent-scoped registration
- [ ] 9.3 Refactor; full suite stays green
- [x] 9.4 Write failing test: P/pet-exposure-gap.test.ts `host_level_provider_is_visible_in_pet_style_scope_and_gap_is_documented` (assert it fails for the right reason)
- [x] 9.5 Implement: document the gap in repository docs and `BACKLOG.md` as a cross-provider issue (archify, spec-superflow, this adapter)
- [x] 9.6 Refactor; full suite stays green
- [ ] 9.7 Write failing test: L/routing-invocation.smoke.mjs `every_producible_session_kind_header_equals_baseline_and_gaps_are_recorded` (assert it fails for the right reason)
- [ ] 9.8 Implement: ensure nothing in the bundle registers a routing tool or guidance in any scope; record unproducible session kinds as explicit gaps
- [ ] 9.9 Refactor; full suite stays green
- [ ] 9.10 Write failing test: L/routing-invocation.smoke.mjs `no_provider_header_equals_baseline_exactly` (assert it fails for the right reason)
- [ ] 9.11 Implement: zero routing surface without an approved provider
- [ ] 9.12 Refactor; full suite stays green
- [ ] 9.13 Write failing test: L/disable.smoke.mjs `disable_removes_surface_and_keeps_unrelated_bytes` (assert it fails for the right reason)
- [ ] 9.14 Implement: disable path removing only adapter surface/references
- [ ] 9.15 Refactor; full suite stays green

## 10. Documentation and repository checks

- [x] 10.1 Write README (usage, settings namespace `dsh-openspec` options `updateCheck`/`telemetry`, manual removal after sessions end, no purge in v1, the known Pet exposure gap) and the prose `dsh.yaml` note; run `npm test`, `npm run check:artifacts`, package build/typecheck/test, and `openspec validate add-dsh-openspec-adapter --strict`; confirm all pass
- [ ] 10.2 Run `node scripts/sync.mjs` twice in the isolated profile; confirm the second run reports no changes
- [ ] 10.3 Flip every test-plan row to 🟢 green only after its test passes; then write verify.md
