# Changelog

## 0.5.1

- Replace both retired four-tier GIFs with high-resolution recordings of the current AUTO interaction, applied decision distribution and settings/strategy UI, using isolated mock services and synthetic tasks.
- Show both demos side by side at the top of the English and Chinese READMEs; remove the obsolete demo disclaimer and folded settings recording. No runtime behavior changes.

## 0.5.0

- **Breaking — one AUTO strategy.** The opt-in legacy four-tier chain is removed: the tier router and its rubric, the per-family `mainEfforts` / `childRoutes` mappings and their settings tabs, the reply-bar tier menu and `label` parameter, `judgements.jsonl` writes, `scripts/label-report.mjs` and the `eval/run.mjs` baseline. Default AUTO behavior (main effort, child capability routing, exact-child binding, Magpie transports, caps, allowlists, fork refusal) is unchanged.
- **Breaking — no strategy versions.** The `policy` setting and the `policyVersion` / `mappingVersion` / `rubricVersion` markers are gone, as is the `version` field on child records and feedback events and the usage report's `schema`. New feedback snapshots record the strategy family (`strategy`). The rule file is now `rubric.json` (same bytes).
- **Family strategies.** Everything about the Claude and GPT families (supported main models, transport prefixes, effort starting points, capability slots, accepted providers) lives in `src/strategies/`; a new family is one strategy file plus registration. The registry rejects conflicting strategies at load.
- **Old data stays readable.** Retired `policy`, `mainEfforts` and `childRoutes` keys are ignored, listed as `deprecated` and removed on the next settings save; submitting them is rejected. Child records written by 0.4.x restore without a version check (only the three known historical keys are tolerated, then dropped). Old feedback rows and events stay readable; the usage report keeps them in their original historical group. `judgements.jsonl` is kept read-only for the report.
- **Rollback.** Pin the published 0.4.2 package: in `dsh.yaml`, set this entry to `source: remote`, `spec: dsh-auto-model-routing@0.4.2`, `version: 0.4.2`, run `dsh build` and restart the Host. Data boundary: child records rewritten by 0.5.0 and feedback rows written by 0.5.0 are not readable by 0.4.2 (fail closed; recreate those child sessions), and settings saved under 0.5.0 no longer contain the retired mapping keys. Back up `state/auto-model-routing/` and the plugin `config.json` before upgrading if you may roll back.
- The Jev decision deadline now defaults to 5000 ms (was 3000 ms) and can be set up to 8000 ms (was 4500 ms); an explicitly saved value is kept. The `route_subagent` tool deadline is 10 s so it outlasts the longest decision.
- The package build now clears `lib/` before compiling, so deleted or renamed modules never ship from a stale output directory.

## 0.4.2

- AUTO now handles Claude and GPT model families only: selecting any other main model switches the session to MANUAL instead of failing the turn in the effort mapper.
- Support the renamed `dsh-magpie-connector` Magpie route as an exact policy transport (replacing `dsh-magpie`); `dsh-magpie-connect` remains supported.
- Fix the missing feedback entry on turns whose request configuration did not change: the main decision is marked applied from the effective request header instead of waiting for a new one.
- Record two implicit feedback facts as separate ledger events keyed by session and decision: reply exposure and a later switch to MANUAL. No message text is stored; routing is unchanged.
- The usage report adds a mutually exclusive implicit-signal breakdown per comparison group, with a fixed caveat that implicit no-objection is not the same as appropriate.
- Sync the AUTO-selected effort through the official selection and simplify the picker display.

## 0.4.1

- Add the on-demand `auto-model-routing-report` skill and read-only `lib/usage-report.js`: joins policy-v2 decisions to actual per-call usage by message ID, grouped by version × model × depth, with coverage gaps, sample thresholds and fixed caveats. Observational only; never writes, spawns or uses the network, and never prints message text, paths or session IDs.

## 0.4.0

- Upgrade AUTO by default: keep the main model fixed, independently judge child capability and reasoning investment, and enforce exact fresh-child bindings with persisted replay. Preserve explicit legacy rollback and MANUAL behavior.
- Add TypeSafe, Concentrate and custom System One decision services with separate credentials, preset model menus and explicit public-sample connection testing.
- Expose executable strategy details, candidate distributions, normalized Choice certainty and actual application status; no task-quality or savings claims.
- Restore per-reply allocation feedback with immutable evaluation snapshots, request-event correlation, timestamped change/cancel events and legacy-record compatibility.
- Refresh bilingual user documentation; label earlier GIFs as legacy mock-host demonstrations. Fork and real-provider teammate acceptance remain unsupported/unverified as documented.


- Accept the DSH 0.2 host's React 18.3.1 as well as React 19 in the runtime peer declaration; client builds continue to use the host's shared React instance.

## 0.3.0

- Publish as a standalone DSH bundle with the companion `subagent-model-routing` skill included.
- Replace the separate ohmydsh skill customization with a package-owned filesystem skill provider. Skill and tools now enable/disable together.
- Add npm/Git installation instructions, demo GIFs, licensing and OIDC release automation.
- Keep the existing tier rubric, effort mappings, default MANUAL mode, credentials and stored state unchanged.
