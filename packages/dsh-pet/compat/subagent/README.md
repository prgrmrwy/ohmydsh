# Pet Locus pinned-source compatibility runtime

English · [简体中文](README.zh.md)

## What this is

The current `dsh.yaml` pins DSH `0.2.0-rc.2`. Pet's unified locus requires narrow Host-owned runtime seams that the official package does not expose yet, so this directory maintains pinned-source compatibility artifacts.

The generated launcher replaces the official `@deepseek-ai/dsh-subagent`, `@deepseek-ai/dsh-agent-loop`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-tool-subagent`, `@deepseek-ai/dsh-tool-subagent-control`, `@deepseek-ai/dsh-tool-workflow`, and `@deepseek-ai/dsh-tool-ralph` packages. The tools artifact rechecks the live monotonic scoped guard after any asynchronous `tools/execute` wrapper delegates and immediately before the registry invokes the resolved registered body. It preserves the original execution scope and does not let any guard force-allow a call. This protects only registered managed tool calls; it does not stop arbitrary effects from a tool body that already began.

`node build-launcher.cjs --isolated-output /absolute/new-or-empty-directory` is the single isolated build command: it invokes `build.mjs` and packages that root into a temporary launcher graph. The output must be new or empty. It verifies package identity and behavior without publishing or moving the formal `.launcher` pointer. The default launcher path remains unchanged.

## Install policy and publication

`install-script-policy.json` is the repository-owned exact-version npm script policy; unknown script versions fail strict checks. The builder forces project scope, disables ignore/allow-all bypasses, strips conflicting environment keys, and never automatically approves all scripts. The policy contains only separately human-reviewed exact grants and denials; any new true rule requires separate human review.

POSIX keeps atomic pointer replacement. Windows uses a shared-lock, backup/publish/verify handoff with rollback and a short absent-pointer interval—not atomic visibility. Host preparation holds the same lock through physical-entry, version and fingerprint reads and returns the immutable generation path. Publication retains all generations; cleanup is separate. Unknown/dangling pointers or interrupted next/previous/restore residuals fail closed and require explicit recovery without deleting targets.

## Compatibility artifacts

- `settlement-notice.patch` patches `@deepseek-ai/dsh-subagent` at the reviewed 0.2.0-rc.2 commit for silent settlement, idle creation, independent child composition, and live child Session access.
- `inquiry-isolation.patch` patches `@deepseek-ai/dsh-agent-loop` so an inquiry's queued-turn claim does not sweep unrelated GUI messages.
- `newinquiry-tools-guard.patch` patches `@deepseek-ai/dsh-tools` at the same commit so a guard revoked while an async execution wrapper is waiting still denies before body invocation.
- `native-managed-effects.patch` marks four native tool owners with `Symbol.for('dsh.tool.managed-effect')`: communication for subagent messaging/control and delegation for subagent, workflow, and Ralph execution. Its generated package artifacts preserve upstream exports and type/runtime files, use a compatibility version, and record patch provenance.

- `model-display.patch` adds optional resolved-model `displayGroup {id,label}` validation/detachment, Host catalog projection, shared presentation buckets/search for the picker and `/model`. It rebuilds five packages together: `@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-api-session-controller`, `@deepseek-ai/dsh-api-remotes`, `@deepseek-ai/dsh-client-ui-model-selection`, and `@deepseek-ai/dsh-client-ui-commands`. The aggregate `api-remotes` codec must be regenerated too; adding metadata only to the controller or UI loses it on the wire.

The model-display extension is pinned to upstream `639ed015397290b3745d163aafe02ffee4aa3f84`, patch SHA-256 `7ac67eabf1bb717ce63aad9fb178c9b8a09294b390b133831a20e1613183426f`, and package version `0.2.0-rc.2-model-display.1`. Stock rc.2 still runs the Magpie plugin route, but shows a flat provider list. Metadata never changes provider/model identity or names. The picker retains the official single effort caption. AUTO owns same-route effort synchronization through official `selectModel`, including its global-default save; this display patch does not write selections, rewrite the core projection or change MANUAL requests.

Each artifact is pinned by source commit, patch hash, generated package version, and runtime graph checks. Re-derive the patches and re-run the focused package tests whenever the upstream commit changes.

### Model-display seam evidence and retirement

At reviewed stock rc.2, the published `@deepseek-ai/dsh-llm/lib/types/types.d.ts` defines `LlmModelInfo` at lines 304–315 without presentation metadata. Published `@deepseek-ai/dsh-client-ui-model-selection/lib/client.js` at lines 537–557 and 980–1022 uses `group.id` for real selection/current/pending identity; the public `ModelSelectInjected` contract exposes directory/load/select, not a subgroup renderer. Fake provider groups therefore cannot express presentation-only ownership safely. The authorized seam and evidence boundaries are recorded in [the change design, D13–D15](<../../../../openspec/changes/archive/2026-10-27-add-dsh-magpie-plugin/design.md#d13-amd2-选择器展示分组本轮已授权受管宿主扩展待独立-recheck>).

Retire this patch only after a reviewed official release preserves optional metadata across resolve/prepare normalization, Host catalog and generated controller/aggregate Remote codecs, supports matching presentation/search in both selector entries with true route actions. Verify every behavior and the loaded graph before removing all five overrides, template/pins and their tests together; do not retire unrelated Pet seams. No upstream report/release for this complete seam is recorded here. Local isolated build evidence is not deployment or live GUI acceptance.

## Verification

`node test-packaging.cjs` checks patch pins and rejects malformed isolated-build arguments before formal launcher state is touched. The upstream scoped-tools regression test is `pnpm exec vitest run packages/core/tools/tests/scoped.spec.ts --config vitest.config.ts` from the pinned upstream checkout. The isolated launcher verifier exercises the generated dependency graph rather than trusting package metadata alone.

For the production-local inquiry cases, build an isolated compiled launcher with `node build-launcher.cjs --isolated-output /absolute/isolated/output`, then run from `packages/dsh-pet`:

```sh
PET_INQUIRY_LAUNCHER=/absolute/isolated/launcher npx --no-install vitest run --config vitest.inquiry-production.config.ts --testTimeout 12000
```

This gate requires the explicit isolated launcher path; it has no formal-launcher default and does not build/publish one. These five cases exercise the compiled graph with a mock LLM, not the formal Host or a complete inquiry lifecycle guarantee.

For model-display source tests, use an independent copy of a clean checkout at the pin, apply the five managed source patches in builder order, then run from that checkout:

```sh
DSH_COMPAT_SUBAGENT_CHECKOUT=/absolute/isolated/upstream node ./node_modules/vitest/vitest.mjs run --config /absolute/ohmydsh/packages/dsh-pet/compat/subagent/model-display.vitest.config.mjs
node ./node_modules/vitest/vitest.mjs run packages/llm/llm/tests/service.spec.ts packages/api/session-controller/tests/session-models.host.spec.ts packages/client/ui-model-selection/tests packages/client/ui-commands/tests
```

Restore applied patches in a `finally`/EXIT handler, preserving existing dependencies/generated outputs. Never apply or scrub a shared `.upstream` or active launcher. The builder restores tracked source after its semantic gate, so unpatched source failures after a build are not product regressions. Dedicated source tests total 24 after replacing dual-value cases with single-effort regressions; exact cross-group keyboard, click, search and metadata tests remain. Core projection tests still preserve its independent semantics; no display-only lastUsed field is added to ModelDirectory.

`node verify-model-display.mjs --graph /absolute/isolated/launcher` probes compiled package provenance, real controller catalog, generated Remote schema and client artifacts. The launcher fingerprint includes dedicated tests/config/verifier as well as source inputs: changing a test invalidates an earlier graph's identity. The next formal build must recompute the fingerprint and recheck the resulting graph before deployment; a passing older isolated graph is not proof of final-source freshness.
