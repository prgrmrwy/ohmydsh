# Upstream resource audit

Audited on 2026-09-23 for `bootstrap-jev-workflow-routing`. All three user-facing choices keep their upstream identity; no schema or workflow is forked.

## Pins and provenance

| Resource | Exact source | Integrity / content identity | License | Runtime |
|---|---|---|---|---|
| Jev MCP | npm `@jkudish/jev-mcp@0.6.0`; source commit observed on upstream `main`: `eb926594da6252a7b4eefd7f50dde566913c541e` | npm integrity `sha512-AAQeZESEMatz5m5X/bojvcL3bpwTPxebFOXBSj66KKNOKznumhne2VsLQ9btxPWBS8obhbVvCInwooy7Phudtw==`; npm shasum `d4c026b234cf708f7dc1b4c440b729f8c88c507b`; tarball SHA-512 `00041e64448431ab73e66e57fdba23bdc2f76e9c133f179b14e5c14a3eba28a34e2b39ee9a19ded95b0b43d6edc4f5814bca1b85b56f0889f0a28cbb3e1b9db7` | MIT | Node >=20; project Node >=22 satisfies it |
| DSH MCP bridge | npm `@deepseek-ai/dsh-mcp-client@0.1.5-rc.2` (matches `dshVersion`) | npm integrity `sha512-L1uhXptzs63bne3fpe8By30xUu2KzC9bbo8t1RdasnRNxhevNJA/5/Z9ZenuMRh26XZh9THF+DVuudEH8PFIsQ==`; npm shasum `0ee3d8cbf01365eb861895c446a6f6e3a86790bf`; tarball SHA-512 `2f5ba15e9b73b3addb9deddfa5ef01cb7d3152ed8acc2f5b6e8f2dd5175ab2744dc617af34903fe7f67d65e9ee311876e97661f531c5f8356eb9d107f0f148b1` | MIT | DSH 0.1.5 peers; `@modelcontextprotocol/sdk` dependency |
| spec-superflow | npm `spec-superflow@2.0.1`; source commit observed on upstream `main`: `25d9b0cee1991e60a4401df0bd2f06b5e3942f38` | npm integrity `sha512-G5P8ossz5R7lDuUWAO1v5aVG93qVjk3D85+tF2gkPGVhnVgdfEZ+pqllsAo+IEMsKa7/KE52ohbAhb9m+r0XtQ==`; npm shasum `5da4715bd72f9e5a86f7600bbf8be257e61e55b3`; tarball SHA-512 `1b93fca2cb33e51ee50ee51600ed6fe5a546f77a958e4dc3f39fad1768243c65619d581d7c467ea6a965b00a3e20432c29aeff284e76a216c085bf66fabd17b5`; npm provenance attestation is present | MIT | Node >=20; two binaries `ssf` and `spec-superflow` |
| Anvil | `https://github.com/jikkujoyce/openspec-schemas`, commit `73eea60c622712a5d952ec1aec62da4e349f8c33`; archive `https://codeload.github.com/jikkujoyce/openspec-schemas/tar.gz/73eea60c622712a5d952ec1aec62da4e349f8c33`; subdirectory `schemas/anvil` | archive SHA-256 `62a94ccad4000982c8de93f5596ee0e778ef58a41797994568e546021eacd9d5`; stable selected-tree SHA-256 `61250a6741799df17fe74c41ed23a95e2910ea3190fff2f6c0e8f66004a63767` (sorted relative path + NUL + bytes + NUL) | MIT | OpenSpec project schema version 1 |

The Anvil commit was the upstream `main` head at audit time, authored 2026-07-27. The repository contained four commits. The other npm resources were published or updated recently in September 2026 and must be treated as young software rather than infrastructure assumed stable.

## Network and credential surface

### Jev MCP

- With the chosen direct TypeSafe provider, runtime egress is to the TypeSafe API selected by `@typesafe-ai/sdk`; no endpoint override is configured.
- Only `TYPESAFE_API_KEY` is passed to the child. The profile does not pass `OPENROUTER_API_KEY`, Cloudflare tokens, Vercel credentials, compatible-provider credentials, provider/base-URL overrides, project `.env`, or the full ambient environment.
- The bridge starts the exact installed package using Node and stdio, without shell interpolation.
- `JEV_MCP_MODEL` defaults upstream to `jev-latest`. A future model pin is a separate reviewed manifest change.
- MCP tool-call timeout is bounded by DSH. Jev MCP 0.6.0 additionally documents bounded retry only for 408/409/429/5xx on its fetch-based transports, never for ambiguous network failures; direct TypeSafe remains SDK-owned. Cancellation reaches the MCP request and the upstream TypeSafe fetch regression is explicitly guarded in 0.6.0.
- Provider error bodies must never be persisted. Router evidence records only a normalized finite error category.

### spec-superflow

- Normal workflow execution is local. Its optional update check can contact upstream but is documented as cached and non-blocking; network access is never required for recovery.
- It needs no API key. Its packaged runtime includes scripts, templates, docs, hooks, and skills.
- The DSH deployment exposes upstream skills and the packaged CLI runtime as one version unit. Worktree isolation, SDD delegation, finish, risk acceptance, integration, and cleanup remain explicitly opt-in and never override this repository's Worktree Session or merge authorization.

### Anvil

- Static OpenSpec schema only; no runtime network or credential access.
- Review prompts may instruct use of another model, but data-locality and model selection remain existing DSH/user policy. The schema itself does not send data.
- Its gates are agent instructions: OpenSpec `requires` checks artifact existence, not verdict contents or TDD ordering. This capability limit is intentionally retained rather than hidden by a local fork.

## Host seam audit (DSH 0.1.5-rc.2)

The supported seam exists; no local MCP protocol adapter is required.

- `@deepseek-ai/dsh-mcp-client@0.1.5-rc.2` is a bundle-less DSH package that connects one MCP server and registers tools on `ctx.tools`.
- One configured stdio row owns process startup. Public names are deterministic: `mcp__<serverName>__<rawTool>`, so `serverName: jev` yields `mcp__jev__jev_classify` and `mcp__jev__jev_decide`.
- The package calls `scrubbedParentEnv()` and overlays only its explicit `env`; therefore an explicit single-variable map is the credential allowlist rather than ambient inheritance.
- Tool execution forwards the DSH execution `AbortSignal` and a configured timeout to MCP `tools/call`.
- Its effect disposer closes the MCP client/process, waits for generation settlement, unregisters all tools, and releases the server-name scope reservation. Reconnect is bounded.
- `failOnStartupError: false` preserves normal Agent startup when Jev or its credential is unavailable. No tools are initially registered on failure; the rest of DSH remains available.
- Tools are registered in the Cordis scope containing the MCP row. This bootstrap uses the ordinary profile/Agent tool registry; the stable tool surface must still be confirmed in an actual DSH request header and one real typed call before task 6.1 can pass.

Configuration presence and startup logs are not acceptance evidence. Phase-one integration acceptance requires all of: tool name visible in a real ordinary Agent request, mock typed call through the bridge, cancellation/disposal probe, and (only when the local credential is securely present) one live TypeSafe decision.

## Upgrade review points

For every version/commit change:

1. re-fetch metadata and archive bytes; update exact integrity/hash;
2. inspect license, engines, install scripts, dependencies and published file list;
3. inspect new outbound hosts, environment variables, credential/error handling and telemetry;
4. re-run upstream tests where practical and local manifest/sync/drift/disable tests;
5. re-check MCP schemas/tool names, structured output and cancellation behavior;
6. compare Anvil selected-tree hash and inspect every changed template/instruction;
7. compare spec-superflow worktree, finish, completion, update-check and skill activation semantics;
8. repeat real DSH tool-surface and rollback validation.

## Disable and removal

- Jev MCP: disable the `npm-mcp-server` resource and sync. The generated MCP row disappears, the bridge/server packages are removed if no other resource owns them, and ordinary conversation/OpenSpec remain.
- spec-superflow: disable the `npm-workflow` resource and sync. Only managed skill entries/runtime dependency are removed. Existing workflow directories are data and are not deleted.
- Anvil: disable the `openspec-schema` resource and sync. Only the ohmydsh-managed user schema copy (default `~/.local/share/openspec/schemas/anvil`) is removed after ownership/drift safety checks; standard `spec-driven`, worktree sources, and existing changes remain.
- Router: disable its manifest skill and sync, then use the recorder's explicit clear command for local shadow evidence. Disable never implies deleting unrelated state or changes.
