# Changelog

## Unreleased

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
