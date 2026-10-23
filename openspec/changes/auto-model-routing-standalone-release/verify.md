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
- Public mirror: https://github.com/prgrmrwy/dsh-auto-model-routing — created 2026-10-23T16:05:24Z (2026-10-24 00:05:24 Asia/Shanghai). Earliest awesome submission time under the current 1-day rule: 2026-10-25 00:05:24 Asia/Shanghai.
- ohmydsh source commit: 9bacb8247e6be246b9ff34be1637a4f4b4078e3e. Public subtree commit: 1da9d2481cdfac069951cdcccff268faba19cd39. main and the five discovery topics are configured; About description matches package metadata. Package history authors checked: public prgrmrwy and dependabot identities.
- Actual Git dependency installation from that public mirror passes with public npm registry. In addition to checking lib/index.js, lib/client.js and skill body, the Git-installed dependency was loaded in the clean official Host profile: count=1, bodyLoaded=true, tool=true, MANUAL tool result routed=false. Temporary probe initially collided with its previous persisted session id; rerun with a fresh id passed. Host stopped afterwards.
- dsh.so: actual submit page checks passed (format pass, 0 Critical, 0 Warnings, 5 Info); server-side submission returned the visible `Submitted` receipt. Checked source commit is the public subtree above. This is an application, NOT confirmation of marketplace listing. Site-provided submission tracker was not publicly resolvable through gh; no invented issue URL.
- awesome-dsh-plugin: current upstream validateEntries(readEntries filtered to the new entry) returns [] (no errors). Single YAML is prepared locally; no PR submitted before repository age threshold. Category is model. Proposed English description: “Adjusts reasoning effort per user turn using Jev via OpenRouter without changing the main model; includes configurable subagent route recommendations and disables AUTO on judgment failure.”
- npm authentication: user requested isolated public-registry setup instructions because their default registry is internal. Use a dedicated user config, do not change the default registry, do not read or print credentials. Awaiting user confirmation; no npm publish attempted.
- Real-CLI migration supplement: a throwaway repo with sync scripts, independently installed plugin source and official public-npm DSH CLI was run under isolated HOME/XDG/DSH_HOME. Legacy sync succeeds and old global skill exists; remove the standalone customization and upgrade sync succeeds with old skill absent; third sync reports no changes. The resulting actual profile boots with skill count=1, bodyLoaded=true, tool=true, MANUAL routed=false. This closes the fake-installer-only migration gap. Fixture tests separately cover user skill/mode preservation, and clean Host removal covers provider/tool disappearance.
- Throwaway harness initially lacked js-yaml and repo workspace declarations; repo-compatible js-yaml 4.1.0 and workspaces fixed setup without product or production changes.
- Store YAML is persisted as store-submission.yml beside this record, revalidated with upstream validateEntries (no errors); eventual PR does not depend on /tmp surviving.
- Cleanup completed 2026-10-24: all acceptance Host jobs stopped, browser sessions closed, port 3199 not listening; verified the disposable root resolves to /private/tmp/amr-release before deleting it. Durable evidence and store YAML remain in this change. Production untouched.
- Outstanding: npm 0.3.0/Trusted Publisher (user has not yet created the dedicated local npm config), age-gated awesome PR and subsequent third-party visibility checks. Same authentication/age conditions persisted over three continuation rounds; no publish or premature PR attempted. Change remains open.
