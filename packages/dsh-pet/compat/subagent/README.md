# Pet Locus pinned-source compatibility runtime

English · [简体中文](README.zh.md)

## What this is

The current `dsh.yaml` pins DSH `0.2.0-rc.2`. Pet's unified locus requires narrow Host-owned runtime seams that the official package does not expose yet, so this directory maintains pinned-source compatibility artifacts.

The generated launcher replaces the official `@deepseek-ai/dsh-subagent`, `@deepseek-ai/dsh-agent-loop`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-tool-subagent`, `@deepseek-ai/dsh-tool-subagent-control`, `@deepseek-ai/dsh-tool-workflow`, and `@deepseek-ai/dsh-tool-ralph` packages. The tools artifact rechecks the live monotonic scoped guard after any asynchronous `tools/execute` wrapper delegates and immediately before the registry invokes the resolved registered body. It preserves the original execution scope and does not let any guard force-allow a call. This protects only registered managed tool calls; it does not stop arbitrary effects from a tool body that already began.

`node build-launcher.cjs --isolated-output /absolute/new-or-empty-directory` is the single isolated build command: it invokes `build.mjs` and packages that root into a temporary launcher graph. The output must be new or empty. It verifies package identity and behavior without publishing or moving the formal `.launcher` pointer. The default launcher path remains unchanged.

## Compatibility artifacts

- `settlement-notice.patch` patches `@deepseek-ai/dsh-subagent` at the reviewed 0.2.0-rc.2 commit for silent settlement, idle creation, independent child composition, and live child Session access.
- `inquiry-isolation.patch` patches `@deepseek-ai/dsh-agent-loop` so an inquiry's queued-turn claim does not sweep unrelated GUI messages.
- `newinquiry-tools-guard.patch` patches `@deepseek-ai/dsh-tools` at the same commit so a guard revoked while an async execution wrapper is waiting still denies before body invocation.
- `native-managed-effects.patch` marks four native tool owners with `Symbol.for('dsh.tool.managed-effect')`: communication for subagent messaging/control and delegation for subagent, workflow, and Ralph execution. Its generated package artifacts preserve upstream exports and type/runtime files, use a compatibility version, and record patch provenance.

Each artifact is pinned by source commit, patch hash, generated package version, and runtime graph checks. Re-derive the patches and re-run the focused package tests whenever the upstream commit changes.

## Verification

`node test-packaging.cjs` checks patch pins and rejects malformed isolated-build arguments before formal launcher state is touched. The upstream scoped-tools regression test is `pnpm exec vitest run packages/core/tools/tests/scoped.spec.ts --config vitest.config.ts` from the pinned upstream checkout. The isolated launcher verifier exercises the generated dependency graph rather than trusting package metadata alone.

For the production-local inquiry cases, build an isolated compiled launcher with `node build-launcher.cjs --isolated-output /absolute/isolated/output`, then run from `packages/dsh-pet`:

```sh
PET_INQUIRY_LAUNCHER=/absolute/isolated/launcher npx --no-install vitest run --config vitest.inquiry-production.config.ts --testTimeout 12000
```

This gate requires the explicit isolated launcher path; it has no formal-launcher default and does not build/publish one. These five cases exercise the compiled graph with a mock LLM, not the formal Host or a complete inquiry lifecycle guarantee.
