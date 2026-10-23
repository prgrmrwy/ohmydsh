# Verification and release progress

## Local implementation (2026-10-24)

- Expected RED: package content test failed because package-local skill was absent; after migration it passes.
- Package tests: 162/162, typecheck and build pass, including a real official SkillRegistry/filesystem-provider lifecycle test (one skill, body load, scope visibility, disposal).
- Independent package directory: fresh public-registry npm install (no shared monorepo node_modules), typecheck, 162 tests and npm pack pass. Pack: 62 files, about 1 MB unpacked, including both GIFs, patch, skills and lib.
- Found and fixed an actual standalone gap: DOM tests depended on monorepo-hoisted jsdom. Added explicit dev dependency. Initial default-registry install also missed the optional rolldown native binding; public-registry install with optional packages succeeded.
- Root npm test: 447 total, 445 pass, 2 skipped, 0 failures. Artifact policy passes.
- Isolated migration test uses sync's test-owned fake package installer (not a real DSH install): old manifest-managed skill deployed, new manifest removes old copy, second sync no-op; disabling preserves synthetic mode file and unrelated private skill. This does not alone establish a full real-CLI migration.

## Real Host acceptance

Official `@deepseek-ai/dsh@0.2.0-rc.2`, base and web-app installed from public npm in a temporary HOME/XDG/DSH_HOME under /tmp; release tarball installed into its clean profile. No symlinks to production profile or launcher and no private absolute-path fixes. Port 3199 only; production 3080 not restarted or rebuilt.

A temporary, non-shipped observation plugin used the real Host services:
- Enabled bundle: skill catalog count 1, provider auto-model-routing-plugin, body contains reasoning_effort, route_subagent registered.
- Tool executed with a real freshly created MANUAL agent: `{routed:false, reason:manual}` without a credential or LLM request.
- Same profile reassembled without routing bundle: catalog count 0, body absent, route_subagent absent.
- Browser showed the actual MANUAL chip. No paid request was sent.
- Known scope boundary: host-level provider remains visible in a created scope, as the real registry integration test demonstrates; no claim of Pet scope isolation.
- Isolated Host and browser stopped after observations. Port 3199 no longer listening.

## Review

Whole implementation diff reviewed locally against proposal/design/delta: no routing algorithm or credential resolver changes; only bundle/files/metadata/skill-source migration and tests. Existing filesystem ownership cleanup reused rather than adding a destructive migration. Authentication, real Git install, mirror provenance and external store age remain separate release gates.

## External steps

- npm whoami against public registry returns E401. No publish attempted; user must configure authenticated publishing locally (never paste token into chat).
- Store contributing and screenshot probe re-read: category is `model`, 1-day repository minimum, GIF paths allowed by author screenshot declaration (no extension restriction there). Existing gallery retained.
- Public mirror, real Git install, complete real-CLI migration, npm 0.3.0 and submissions: pending; update here with actual evidence before marking tasks complete.
