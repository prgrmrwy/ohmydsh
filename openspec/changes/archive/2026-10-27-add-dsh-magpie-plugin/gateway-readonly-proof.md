# Bounded live Magpie readonly proof — 2026-10-26

## Result and scope

**Live Responses candidate accepted; expected optional-field behavior observed.** This was a GPT-only, no-delegation acceptance attempt, not a production fix or full task16.2 PASS. Exactly three gateway HTTP requests were sent: directory GET, cached-cards GET, and one Responses generation. No Chat generation, quota refresh, host tool execution, GUI access, restart, build, sync, commit, publication, dependency installation, credential mutation, or permission change occurred.

- Initial OS guard probe: **2026-10-26 14:00:56.032781–14:00:56.062391 UTC** (10:00:56 America/New_York), `bwrap` exit **0**.
- Official credential-only preflight: **14:05:45.660–14:05:45.737 UTC**, isolated Node exit **0**, stdout/stderr **0 bytes**, no network.
- Bounded live attempt: **14:09:30.289–14:09:40.348 UTC** (10:09:30–10:09:40 America/New_York), isolated Node exit **0**, stdout/stderr **0 bytes**. Shell/orchestrator commands also exited **0**.
- Complete sanitized staged evidence: `/tmp/dsh-magpie-connector-readonly-proof-sanitized.json`, verified mode **0600**. Private probe scripts and public sentinel evidence: `/tmp/dsh-magpie-connector-readonly-proof-qb_mp5_7` (created 0700). These are local ephemeral artifacts, not repository links. No raw response/account/user documents or secret bytes were saved.

## Readonly safety proof before initialization

Read the [repository instructions](<../../../AGENTS.md>), [manifest](<../../../dsh.yaml#L389-L414>), [active task16.2](<tasks.md#L170-L187>), [generation contract](<specs/dsh-magpie-connector/spec.md#L148-L199>), [design D2/D3](<design.md#L59-L91>), and [optional-tools investigation](<optional-tools-investigation.md>). There is still no current main `dsh-magpie-connector` spec; this change's delta is the relevant contract. The authorization for this attempt narrows the older task16.2 budget to one Responses generation; it does not close the original Chat or GUI gates.

The official `@deepseek-ai/dsh-credentials-local` source was resolved through the **current formal d1 runtime graph**, fingerprint `d1fbbf15c1c1d9e0b4ca80de6ffcb0450d5c0a25af9f1eda4b51ec16645ab279-372ff018-8cf6-4e66-942c-3ffe06b95ced`, not the unavailable historical `/tmp` source. Its `lib/index.js:441–447,647–688` confirms initialization can migrate a flat document under a sibling writer lock **before** the `watch:false` check; the official atomic-write implementation creates `<filename>.lock` and uses sibling temporary/rename targets. Merely disabling watching is not a readonly guarantee.

Existing `/usr/bin/bwrap` was usable without elevation. Every credential process used an independent user/PID/mount namespace, `--ro-bind / /`, explicit readonly binds for both `/home/prgrmr/.dsh` and `/home/prgrmr/.dsh/.credentials.yaml`, `--cap-drop ALL`, and only its own private `/tmp` directory bind-writable. Initial guard and credential-only preflight also unshared the network namespace. The live process retained the existing network solely for the authorized transport requests. No other server was started.

Before **each** provider initialization, `findmnt --target ... --output TARGET,VFS-OPTIONS,FS-OPTIONS` was executed inside that same namespace. The actual HOME, credential parent, credential file, and private readonly sentinel reported effective VFS flags **`ro,nosuid,nodev,relatime`**. A write to the **own temporary readonly sentinel only** failed with **`EROFS`**. No test write was attempted against the real credential file or directory. The credential parent readonly bind covers lock/temp/rename siblings; the readonly root also protects alternate real HOME paths.

The underlying filesystem superblock still reports `rw`: enforcement here is the effective readonly bind-mount VFS flag, not a claim that the host filesystem globally became readonly. The guard does not freeze other host processes, is not an audited general-purpose sandbox, and provides no upstream packet capture. `/proc` is a namespace-local virtual mount. No JS fs mock/monkeypatch was used to establish write protection.

Actual credentials were inspected by the agent only with `stat`/`realpath` metadata (existing parent 0700, file 0600). The **official service** read its normal document internally. Both official `LocalCredentialProvider` initializations used `watch:false`, succeeded, and resolved only the fixed `MAGPIE_API_KEY` reference (2 total initializations / 5 resolves across preflight and live run). The key stayed in memory and was handed to the real transport through the normal runtime. No set/unset/save, raw-key check, schema dump, secret-file copying, raw exception output, environment dump, or heap dump occurred.

**No credential migration/write failure was observed or blocked in this run.** The blocked write demonstrated was the own sentinel. No syscall write trace was collected, so this report does not turn successful initialization into a syscall-audited assertion that provider-internal write attempts numbered zero. If migration had needed a credential sibling write, its readonly mount would have rejected it and the process would have stopped without ordinary-mode retry.

## Network and catalog evidence

Existing configuration was read via the real `SettingsStore` constructor, without `save`. Its configured base URL was validated by the official normalizer (no userinfo/query/fragment); neither the URL nor unrelated configuration was dumped. All requests used the [real GatewayTransport](<../../../packages/dsh-magpie-connector/src/host/transport.ts#L4-L34>): its own direct undici Agent, path/origin checks, attribution headers, and `redirect:'error'`, not an environmental/global proxy. A test-only wrapper additionally limited this run to the following routes/counts and blocked any second request.

| Authorized operation | Actual count | HTTP status | Retained evidence |
|---|---:|---:|---|
| `GET /models` | 1 | 200 | 13 models; Codex metadata below |
| `GET /magpie/quotas/cards` | 1 | 200 | 3 cached cards; status/count only, no account/card content |
| `POST /responses` | 1 | 200 | Synthetic schema/body checks and tool-call outcome below |
| Chat generation | 0 | — | Pending; not forced onto a different protocol/provider |
| Quota refresh | 0 | — | Not authorized or attempted |

The actual catalog supplied raw `owned_by:'codex'` for these complete model IDs:

| Model ID | `reasoning_levels` | `native_endpoints` |
|---|---|---|
| `codex/gpt-6.1-sol` | `low, medium, high, xhigh, max, ultra` | `/v1/responses` |
| `codex/gpt-6-astra` | `low, medium, high, xhigh, max, ultra` | `/v1/responses` |
| `codex/gpt-6-luna` | `low, medium, high, xhigh, max` | `/v1/responses` |

Selected **`codex/gpt-6.1-sol`**, effort **`low`**, output maximum **512**. No Codex entry advertised a GPT Chat endpoint; no capability was overridden and no local Codex/Claude fallback was used. SDK `maxRetries:0` is supplied by the existing adapter. The request wrapper aborts immediately on the first non-2xx response, cancels that body without reading it, and refuses all further network requests; thus it also fences the adapter's normal 429/5xx retry loop. Every request and the generation had a 15-second timeout. No failure or retry occurred.

## Responses single-variable candidate

Used the **real `MagpieRuntime` + `MagpieAdapter` + pi-ai + OpenAI SDK**, resolved from the current graph's installed `dsh-magpie-connector` entry. No generated module or source was edited. The test-only wrapper at the final `GatewayTransport.request` boundary parsed SDK-produced JSON and changed **only** the ordinary function tool's `strict` field to explicit **false**. This is the wire function object (`tools[0].strict` in Responses), not a top-level field. The original production adapter remains unchanged.

Public synthetic tool: `bash_probe`, with `parameters.type:'object'`, `required:['command']`, `command` string, optional `sandbox_permissions` string enum `['workspace-write','danger-full-access']`, and optional `justification` string. Tool description and the synthetic user prompt requested exactly one call with public arguments `{command:'printf OK'}`, no optional fields and no other content.

Immediately before handing the actual body string to the real direct transport, checks established:

- `strict` **exists** on the function object and is **false**;
- `parameters` **deep-equals** the input schema, with its original required list and optional fields unchanged;
- the only candidate body mutation is that function's explicit false field;
- actual body has `max_output_tokens:512` and `reasoning.effort:'low'`.

Outcome: HTTP **200**, DSH finish reason **`tool-calls`**, exactly **one** `bash_probe` call, argument **keys `['command']`**, **zero** unknown/optional keys. An internal comparison confirmed the public expected command/argument object; no full response or generated arguments were printed. Host tool execution count: **0**.

**Evidence level:** acceptance of the standard field plus expected result behavior at this gateway/model path. It is **not** a captured raw gateway→upstream forwarding packet, proof of all upstream normalization semantics, proof of the main-session symptom's root cause, a production repair, or a deployed GUI/tool-loop acceptance. [The earlier local omission/RED investigation](<optional-tools-investigation.md#L24-L59>) remains distinct evidence. Chat, full task16.2, GUI/task16.4, main-session reproduction, candidate production review/change, and broader final verification remain **pending**. Task and review files were not altered by this attempt.
