## 0. Gate and target-runtime probes

Round history: round 1 is VOID (artifacts changed after it). Round 2 verdict is `APPROVE_WITH_CHANGES` with 3 Critical and 14 Moderate findings; all 16 Required Changes were applied and accepted over three narrow reviewer re-checks, and `review.md` shows `CHANGES_APPLIED: yes` for the current content. Any further edit to proposal, design or specs voids it and needs a new review round.

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
- [ ] 0.11 Decide where implementation runs. This session is NOT bound to a Worktree Session, so no guard blocks main-checkout writes (the spec's main-checkout write ban applies only to bound sessions). The reason to isolate is different: the main checkout is the live deployment source (local packages are hardlinked into the running profile, BACKLOG D005), and prior changes landed via ws/* branches. A new Worktree Session starts from the base branch, so UNTRACKED change artifacts are not carried into it: the planning files must be committed to the base first.

## 1. Package skeleton and deployment record

- [ ] 1.1 Write failing test: R/sync-dsh-openspec.test.mjs `dsh_openspec_clean_sync_then_noop_with_notice` (assert it fails for the right reason)
- [ ] 1.2 Implement: new `packages/dsh-openspec` (package.json with exact `@fission-ai/openspec@1.13.2`, current-family peers, NOTICE crediting `@codigoconelmer/dsh-openspec@0.1.0` gitHead 95966d07 MIT, cordis.patch.yml, build config), root lockfile, `dsh.yaml` entry whose `note` records the official dependency in prose without a version, `.gitignore` for build output
- [ ] 1.3 Refactor; full suite stays green
- [ ] 1.4 Write failing test: R/sync-dsh-openspec.test.mjs `dsh_openspec_pin_mismatch_vs_lockfile_fails_without_profile_change` (assert it fails for the right reason)
- [ ] 1.5 Implement: sync check comparing the package.json pin with the root lockfile name/version/integrity, diagnostic `dsh-openspec-pin-mismatch` naming both values
- [ ] 1.6 Refactor; full suite stays green
- [ ] 1.7 Write failing test: P/options.test.ts `options_read_from_settings_namespace_with_documented_defaults` (assert it fails for the right reason)
- [ ] 1.8 Implement: read `updateCheck` and `telemetry` from the DSH settings namespace `dsh-openspec` with defaults `enabled` / `adapter-off`
- [ ] 1.9 Refactor; full suite stays green

## 2. Upstream compatibility, catalog and generations

- [ ] 2.1 Write failing test: P/upstream-compat.test.ts `renders_official_catalog_and_bodies_equal_render_official_body` (assert it fails for the right reason)
- [ ] 2.2 Implement: `upstream-compat` module (absolute file URL loading) providing `renderOfficialBody(selection)` with the single documented `/opsx:` reference transform, workflow-id mapping for all 12
- [ ] 2.3 Refactor; full suite stays green
- [ ] 2.4 Write failing test: P/upstream-compat.test.ts `rejects_incompatible_colliding_or_marker_bearing_upstream_and_keeps_active_generation` (assert it fails for the right reason)
- [ ] 2.5 Implement: `upstream-incompatible` preparation failure incl. custom-name collision and marker/loader-closer scan; no publish on failure
- [ ] 2.6 Refactor; full suite stays green
- [ ] 2.7 Write failing test: P/catalog-invalidation.test.ts `profile_edit_invalidates_provider_and_next_listing_reflects_it` (assert it fails for the right reason)
- [ ] 2.8 Implement: bounded-cadence (≤30s) and per-consumption stat of the official global config, calling the registration `invalidate()`
- [ ] 2.9 Refactor; full suite stays green
- [ ] 2.10 Write failing test: P/generations.test.ts `loaded_generation_stays_executable_after_new_selection` (assert it fails for the right reason)
- [ ] 2.11 Implement: immutable generation materialization under `$DSH_HOME/plugins/dsh-openspec/generations/<identity>/`, atomic active reference, no deletion of non-staging generations
- [ ] 2.12 Refactor; full suite stays green
- [ ] 2.13 Write failing test: P/generations.test.ts `activation_racing_a_load_never_mixes_body_and_block_generations` (assert it fails for the right reason)
- [ ] 2.14 Implement: resolve the active generation exactly once per load and use that single generation for body and block
- [ ] 2.15 Refactor; full suite stays green
- [ ] 2.16 Write failing test: P/generations.test.ts `lookup_without_cwd_returns_same_body_and_block` (assert it fails for the right reason)
- [ ] 2.17 Implement: body and block do not depend on cwd; a cwd-less lookup returns the same result
- [ ] 2.18 Refactor; full suite stays green
- [ ] 2.19 Write failing test: P/generations.test.ts `missing_or_partial_generation_fails_with_typed_error_and_no_body` (assert it fails for the right reason)
- [ ] 2.20 Implement: typed error when the active generation or its CLI entry is missing; generation id in the block equals the rendering generation
- [ ] 2.21 Refactor; full suite stays green

## 3. Adapter block and managed invocation

- [ ] 3.1 Write failing test: P/adapter-block.test.ts `block_parses_last_closed_fields_and_identical_for_tool_and_gesture` (assert it fails for the right reason)
- [ ] 3.2 Implement: single block builder with fixed markers and closed field set, shared `parseAdapterBlock` helper, one builder for tool and gesture carriers
- [ ] 3.3 Refactor; full suite stays green
- [ ] 3.4 Write failing test: P/adapter-block.test.ts `hostile_generation_path_round_trips_as_single_shell_argument_and_newline_rejected` (assert it fails for the right reason)
- [ ] 3.5 Implement: one named POSIX single-quote function applied per path segment; control character or non-absolute path → `block-unrenderable`
- [ ] 3.6 Refactor; full suite stays green
- [ ] 3.7 Write failing test: P/adapter-block.test.ts `block_bytes_identical_for_different_cwds` (assert it fails for the right reason)
- [ ] 3.8 Implement: no cwd, arguments, project text or raw registry strings in the block
- [ ] 3.9 Refactor; full suite stays green
- [ ] 3.10 Write failing test: P/adapter-block.test.ts `hostile_registry_version_is_canonicalized_or_omitted_single_marker_pair` (assert it fails for the right reason)
- [ ] 3.11 Implement: versions re-rendered from parsed integers; omit notice on non-canonical input
- [ ] 3.12 Refactor; full suite stays green
- [ ] 3.13 Write failing test: P/managed-invocation.test.ts `body_then_one_block_with_pinned_version_and_telemetry_and_update_check_off` (assert it fails for the right reason)
- [ ] 3.14 Implement: managed invocation `node <generation bin>` with `OPENSPEC_NO_UPDATE_CHECK=1` and, by default, `OPENSPEC_TELEMETRY=0`
- [ ] 3.15 Refactor; full suite stays green
- [ ] 3.16 Write failing test: P/managed-invocation.test.ts `official_cli_makes_zero_registry_requests_and_telemetry_official_omits_assignment` (assert it fails for the right reason)
- [ ] 3.17 Implement: `telemetry: official` omits the telemetry assignment but still sets `OPENSPEC_NO_UPDATE_CHECK=1`; assert zero official-CLI registry requests
- [ ] 3.18 Refactor; full suite stays green
- [ ] 3.19 Write failing test: P/manage-check.test.ts `check_reports_path_managed_version_mismatch` (assert it fails for the right reason)
- [ ] 3.20 Implement: management check reporting `path-version`, `managed-version`, `mismatch`, `node` engine support, `recovery`, and winning source/provider per Skill name
- [ ] 3.21 Refactor; full suite stays green
- [ ] 3.22 Write failing test: P/precedence.test.ts `project_skill_wins_and_check_reports_winning_source_and_provider` (assert it fails for the right reason)
- [ ] 3.23 Implement: diagnostics via `ctx.skills.list` `source`/`provider`; adapter `get` never runs for an overridden name
- [ ] 3.24 Refactor; full suite stays green

## 4. Commands and init

- [ ] 4.1 Write failing test: P/command-carrier.test.ts `command_adapter_message_has_body_then_block_without_raw_argument_and_a_separate_user_message_carries_it` (assert it fails for the right reason)
- [ ] 4.2 Implement: register `opsx-<workflow>` per effective workflow plus `openspec-init` and `dsh-openspec-manage`; one adapter-sourced message = body + block (no raw argument) and a separate user-sourced message carrying exactly the raw argument string; `openspec-init`/`dsh-openspec-manage` use a fixed adapter-authored instruction + block; `recordInput: false` where audit is not needed
- [ ] 4.3 Refactor; full suite stays green
- [ ] 4.4 Write failing test: P/init-command.test.ts `default_init_creates_skeleton_without_tool_skills` (assert it fails for the right reason)
- [ ] 4.5 Implement: `/openspec-init` returning an adapter-built command with `--tools none --no-copilot-cloud --no-animation` for the caller cwd
- [ ] 4.6 Refactor; full suite stays green
- [ ] 4.7 Write failing test: P/init-command.test.ts `rejects_metacharacters_unknown_tools_and_bad_language` (assert it fails for the right reason)
- [ ] 4.8 Implement: official-enum validation for tools/profile, language regex, typed validation errors, no command offered on failure
- [ ] 4.9 Refactor; full suite stays green
- [ ] 4.10 Write failing test: P/init-command.test.ts `never_offers_force_and_never_spawns_from_host` (assert it fails for the right reason)
- [ ] 4.11 Implement: force only after separate confirmation; the handler never spawns a process
- [ ] 4.12 Refactor; full suite stays green
- [ ] 4.13 Write failing test: P/init-command.test.ts `warns_about_global_config_only_when_openspec_dir_exists` (assert it fails for the right reason)
- [ ] 4.14 Implement: result warning when the workspace already contains an `openspec` directory
- [ ] 4.15 Refactor; full suite stays green

## 5. Update check and notice

- [ ] 5.1 Write failing test: P/update-check.test.ts `concurrent_consumers_share_one_request_across_restart` (assert it fails for the right reason)
- [ ] 5.2 Implement: consumption-triggered check, single-flight, cross-process lock + atomic cache, 24h TTL, 2s budget, no redirects
- [ ] 5.3 Refactor; full suite stays green
- [ ] 5.4 Write failing test: P/update-check.test.ts `request_is_fixed_latest_url_and_real_shaped_fixture_fits_limit` (assert it fails for the right reason)
- [ ] 5.5 Implement: fixed `GET /@fission-ai%2Fopenspec/latest`, read only `version`, 64 KiB limit, real-shaped fixture
- [ ] 5.6 Refactor; full suite stays green
- [ ] 5.7 Write failing test: P/update-check.test.ts `failures_normalize_and_back_off_fifteen_minutes` (assert it fails for the right reason)
- [ ] 5.8 Implement: normalized failure classes, 15min backoff, `ahead-of-latest` state
- [ ] 5.9 Refactor; full suite stays green
- [ ] 5.10 Write failing test: P/update-check.test.ts `corrupt_future_dated_cache_and_stale_lock_are_ignored` (assert it fails for the right reason)
- [ ] 5.11 Implement: treat corrupt/future/unwritable cache as absent; expire stale locks
- [ ] 5.12 Refactor; full suite stays green
- [ ] 5.13 Write failing test: P/update-check.test.ts `unwritable_state_dir_still_serves_with_at_most_one_request_and_reports_state_unwritable` (assert it fails for the right reason)
- [ ] 5.14 Implement: serve Skills when state is unwritable, at most one request per process per 15min, report `state-unwritable`
- [ ] 5.15 Refactor; full suite stays green
- [ ] 5.16 Write failing test: P/update-check.test.ts `disabled_option_makes_zero_requests` (assert it fails for the right reason)
- [ ] 5.17 Implement: `updateCheck: disabled` handling incl. explicit check returning `check-disabled`
- [ ] 5.18 Refactor; full suite stays green
- [ ] 5.19 Write failing test: P/update-notice.test.ts `newer_release_notice_once_in_one_result_without_turn_or_install` (assert it fails for the right reason)
- [ ] 5.20 Implement: notice delivered only as an attachment in the adapter block of the next consumption result; dedup key = `scope` object identity in a `WeakMap`; no scope → no notice
- [ ] 5.21 Refactor; full suite stays green
- [ ] 5.22 Write failing test: P/update-notice.test.ts `racing_model_and_gesture_consumers_spend_notice_once` (assert it fails for the right reason)
- [ ] 5.23 Implement: decide-and-mark as one synchronous test-and-set before any await
- [ ] 5.24 Refactor; full suite stays green
- [ ] 5.25 Write failing test: P/update-notice.test.ts `newer_pair_renotifies_and_scope_less_lookup_gets_none` (assert it fails for the right reason)
- [ ] 5.26 Implement: per-pair dedup; scope-less lookup gets no notice; pin the undeclared `scope` option at both `dsh-tool-skill` call sites
- [ ] 5.27 Refactor; full suite stays green
- [ ] 5.28 Write failing test: P/scope-option.test.ts `scope_reaches_provider_get_at_model_and_gesture_call_sites_and_undefined_agent_gets_no_notice` (assert it fails for the right reason)
- [ ] 5.29 Implement: pin the registry-passes-options-through dependency with the real dsh-tool-skill model path and gesture path; undefined agent -> no notice
- [ ] 5.30 Refactor; full suite stays green
- [ ] 5.31 Write failing test: P/update-notice.test.ts `tool_gesture_and_command_consumers_each_spend_notice_and_listing_never_does` (assert it fails for the right reason)
- [ ] 5.32 Implement: notice is spent by any adapter-Skill `get` (model tool, gesture, command handler) and never by catalog listing
- [ ] 5.33 Refactor; full suite stays green
- [ ] 5.34 Write failing test: P/update-notice.test.ts `notice_state_keyed_to_discarded_scope_is_never_read_or_written` (assert it fails for the right reason)
- [ ] 5.35 Implement: no state read or written for a discarded scope
- [ ] 5.36 Refactor; full suite stays green

## 6. Management flow

- [ ] 6.1 Write failing test: P/manage-flow.test.ts `loading_manage_help_mutates_nothing` (assert it fails for the right reason)
- [ ] 6.2 Implement: `dsh-openspec-manage` Skill and `/dsh-openspec-manage` guidance separating upgrade, `openspec update` and change revision; no mutation on load
- [ ] 6.3 Refactor; full suite stays green
- [ ] 6.4 Write failing test: P/manage-flow.test.ts `upgrade_changes_only_runtime_selection` (assert it fails for the right reason)
- [ ] 6.5 Implement: upgrade path wired to the transaction helper only; project refresh requires separate approval
- [ ] 6.6 Refactor; full suite stays green

## 7. Source-owned upgrade/rollback transaction and recovery

- [ ] 7.1 Write failing test: R/dsh-openspec-upgrade.test.mjs `approved_upgrade_persists_across_sync_without_pin_mismatch_and_keeps_old_generation` (assert it fails for the right reason)
- [ ] 7.2 Implement: helper locating the sync-recorded realpath checkout; staging (ignore-scripts, parity, CLI smoke, lockfile integrity == registry `dist.integrity`); CAS of exactly package.json dependency entry + root lockfile; sync; activation; `activation: live | pending-reload`
- [ ] 7.3 Refactor; full suite stays green
- [ ] 7.4 Write failing test: R/dsh-openspec-upgrade.test.mjs `rollback_rewrites_source_and_survives_sync_without_mismatch` (assert it fails for the right reason)
- [ ] 7.5 Implement: rollback as the same transaction type targeting B
- [ ] 7.6 Refactor; full suite stays green
- [ ] 7.7 Write failing test: R/dsh-openspec-upgrade.test.mjs `blocked_or_failed_upgrade_keeps_hashes_and_active_id` (assert it fails for the right reason)
- [ ] 7.8 Implement: `blocked` for Worktree-bound caller, non-recorded checkout, unwritable source, denied policy, integrity mismatch, related drift, concurrent lock; frozen startup-time fields
- [ ] 7.9 Refactor; full suite stays green
- [ ] 7.10 Write failing test: R/dsh-openspec-upgrade.test.mjs `kill_after_cas_reports_recovery_in_block_and_old_generation_serves` (assert it fails for the right reason)
- [ ] 7.11 Implement: prepared journal before source write; report-only `recovery-required` via the block `recovery` field and the management check; upgrade refusal until resolved
- [ ] 7.12 Refactor; full suite stays green
- [ ] 7.13 Write failing test: R/dsh-openspec-upgrade.test.mjs `user_edit_after_cas_returns_recovery_required_untouched` (assert it fails for the right reason)
- [ ] 7.14 Implement: hash-guarded rollback with manual reconciliation steps
- [ ] 7.15 Refactor; full suite stays green

## 8. Routing registry and dispatcher (contract-only)

- [ ] 8.1 Write failing test: P/routing-registry.test.ts `selected_provider_invoked_once_then_unavailable_after_dispose` (assert it fails for the right reason)
- [ ] 8.2 Implement: experimental v1 registration service, explicit `activeProviderId`, disposer, cancellation on dispose
- [ ] 8.3 Refactor; full suite stays green
- [ ] 8.4 Write failing test: P/routing-registry.test.ts `invalid_or_missing_provider_never_falls_back` (assert it fails for the right reason)
- [ ] 8.5 Implement: duplicate/unsupported/absent handling without order-based fallback
- [ ] 8.6 Refactor; full suite stays green
- [ ] 8.7 Write failing test: P/routing-dispatch.test.ts `two_stage_tokens_correlate_and_candidate_kinds_differ` (assert it fails for the right reason)
- [ ] 8.8 Implement: bounded feature schema, typed candidates from official schema discovery and trusted external declarations
- [ ] 8.9 Refactor; full suite stays green
- [ ] 8.10 Write failing test: P/routing-dispatch.test.ts `invalid_stage_tokens_refused_with_zero_callbacks` (assert it fails for the right reason)
- [ ] 8.11 Implement: ≥128-bit single-use session-bound token with 10min TTL, injectable clock, bounded table with eviction, `invalid-stage-token`
- [ ] 8.12 Refactor; full suite stays green
- [ ] 8.13 Write failing test: P/routing-dispatch.test.ts `unknown_features_or_ineligible_candidate_needs_review` (assert it fails for the right reason)
- [ ] 8.14 Implement: input/result validation, never fabricate a candidate
- [ ] 8.15 Refactor; full suite stays green
- [ ] 8.16 Write failing test: P/routing-dispatch.test.ts `traversal_change_name_rejected_and_candidate_text_bounded_stripped_labeled` (assert it fails for the right reason)
- [ ] 8.17 Implement: change-name pattern validation and root containment (no traversal/symlink escape); candidate text ≤2 KiB, control-stripped, labeled untrusted
- [ ] 8.18 Refactor; full suite stays green
- [ ] 8.19 Write failing test: P/routing-authority.test.ts `existing_change_returns_recorded_schema_without_callback` (assert it fails for the right reason)
- [ ] 8.20 Implement: dispatcher-resolved existing-change authority via official discovery
- [ ] 8.21 Refactor; full suite stays green
- [ ] 8.22 Write failing test: P/routing-authority.test.ts `confident_result_has_authority_none_and_no_side_effects` (assert it fails for the right reason)
- [ ] 8.23 Implement: `authority: none` on every result; no side effects
- [ ] 8.24 Refactor; full suite stays green
- [ ] 8.25 Write failing test: P/routing-authority.test.ts `unapproved_provider_unavailable_with_zero_callbacks` (assert it fails for the right reason)
- [ ] 8.26 Implement: approval-record gate (test fixtures only in this change; Jev not selectable)
- [ ] 8.27 Refactor; full suite stays green
- [ ] 8.28 Write failing test: P/routing-entry.test.ts `single_entry_is_only_route_to_provider_and_no_other_export_reaches_it` (assert it fails for the right reason)
- [ ] 8.29 Implement: one in-process dispatcher entry; no tool, no guidance, no session registration
- [ ] 8.30 Refactor; full suite stays green
- [ ] 8.31 Write failing test: P/routing-failure.test.ts `needs_review_passes_through_without_substitution` (assert it fails for the right reason)
- [ ] 8.32 Implement: pass-through of `needs-review`
- [ ] 8.33 Refactor; full suite stays green
- [ ] 8.34 Write failing test: P/routing-failure.test.ts `timeout_cancel_throw_unload_normalize_and_persist_no_text` (assert it fails for the right reason)
- [ ] 8.35 Implement: 5s budget, cancellation forwarding, stale-result discard, normalized error class only
- [ ] 8.36 Refactor; full suite stays green

## 9. Host wiring and target-runtime smoke (isolated profile only)

- [ ] 9.1 Write failing test: L/cross-workspace.smoke.mjs `second_workspace_discovers_surface_and_uses_own_cwd` (assert it fails for the right reason)
- [ ] 9.2 Implement: register the Skill provider and commands as host-level (matching archify/spec-superflow); no agent-scoped registration
- [ ] 9.3 Refactor; full suite stays green
- [ ] 9.4 Write failing test: P/pet-exposure-gap.test.ts `host_level_provider_is_visible_in_pet_style_scope_and_gap_is_documented` (assert it fails for the right reason)
- [ ] 9.5 Implement: document the gap in repository docs and `BACKLOG.md` as a cross-provider issue (archify, spec-superflow, this adapter)
- [ ] 9.6 Refactor; full suite stays green
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

- [ ] 10.1 Write README (usage, settings namespace `dsh-openspec` options `updateCheck`/`telemetry`, manual removal after sessions end, no purge in v1, the known Pet exposure gap) and the prose `dsh.yaml` note; run `npm test`, `npm run check:artifacts`, package build/typecheck/test, and `openspec validate add-dsh-openspec-adapter --strict`; confirm all pass
- [ ] 10.2 Run `node scripts/sync.mjs` twice in the isolated profile; confirm the second run reports no changes
- [ ] 10.3 Flip every test-plan row to 🟢 green only after its test passes; then write verify.md
