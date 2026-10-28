## 0.2.0 single-schema line settings API (current)

BREAKING: the host settings surface keeps only the `lines[]` schema. Legacy top-level `baseUrl`, `nextLineId`, notices and fixed `MAGPIE_API_KEY` / `MAGPIE_ACCESS_*` refs no longer exist; the 0.1.x notes below are historical.

```ts
// GET projection (SettingsController)
{ lines: [{ id, baseUrl, accessMode, complete,
            key: { configured, writable },
            access: { clientId: { configured, writable }, clientSecret: { configured, writable } },
            refs: { key, accessClientId, accessClientSecret } }],
  activeLineId, pending, retainedCredentials,
  lastSyncAt?, lastSyncError?, lastSyncErrorKind?, groups, visibleModels, defaultEfforts }

// POST (SettingsController passes the connection subset to runtime.settings)
{ lines: [{ id?, baseUrl: string, accessMode: 'direct' | 'cloudflare',
            key?: string | null, accessClientId?: string | null, accessClientSecret?: string | null }],
  resync?: true }
// `resync: true` alone is valid (force one catalog sync). A line with zero lines in the
// committed list is only reachable through load/first install; POST requires 1–5 lines.
```

- A line is complete when it has an address, a resolvable key and (for `cloudflare`) an HTTPS address plus both Access values. Only complete lines take part in automatic selection.
- Line ids are host-generated 8-hex-character random ids (unique among existing and pending lines), stored in settings, stable across reorder/delete/restart and never derived from the address or key. Creation must omit `id`; existing ids must reference a current line and may not repeat (400 zero-write otherwise).
- Every line uses `MAGPIE_LINE_<ID>_API_KEY` / `..._ACCESS_CLIENT_ID` / `..._ACCESS_CLIENT_SECRET` (uppercase id). Sorting/deleting never rebinds references; deleting a line clears writable refs and reports environment-owned values through `retainedCredentials`.
- Credential fields are tri-state: omitted = keep, `null` = clear (writable refs only), string = write. Whole-table saves/reorders must omit credentials they do not want to change.
- Loading validates the persisted lines and pending entries strictly: invalid format, duplicate ids/addresses, >5 lines or malformed pending make the whole connection read as empty (unconfigured) without touching the file or resolving credentials.
- Subscribe to `credentials/reference-updated` for **any** ref and map it with `lineIdOfCredentialRef(ref)`: a change on the active line invalidates the generation, a change on a non-active line does not.
- Credential writes are not transactional. Attempted `(lineId, field)` pairs are persisted as `pending` before any secret write; on successful whole-table commit, pending entries for lines absent from the commit are cleaned automatically (unset writable refs, keep env-owned ones in `retainedCredentials`). Deletes/access-mode changes commit only after every writable credential was cleared.
- `Operation` captures `lineId`, `accessMode`, `baseUrl` and the credentials; use `op` (not `gen.baseUrl`) for requests. `Generation` still owns catalog/cards; a line switch replaces the generation but carries the catalog, so `isCurrent(gen)` remains the commit guard.

## Runtime and connection identity

```ts
const runtime = new MagpieRuntime(credentials, store, publish)
await runtime.start()
await runtime.syncCatalog()
const op = await runtime.beginOperation()
try {
  const response = await runtime.transport.request(
    { baseUrl: op.baseUrl, key: op.key }, 'GET', '/magpie/quotas/cards',
    { signal: op.gen.bgAbort.signal },
  )
  // Read/project/redact first; commit only if runtime.isCurrent(op.gen).
} finally { op.release() }
```

- `credentials` is `Pick<CredentialProvider, 'describe' | 'resolve' | 'set' | 'unset'>`. Line references are derived with `lineCredentialRefs(lineId)`; `lineIdOfCredentialRef(ref)` maps a ref back to its line id. Legacy fixed refs are not read. No credential files or process-environment fallback are read.
- `SettingsStore(path?)` loads/saves the single-schema `{lines, visibleModels, defaultEfforts, credentialUpdatePending?}` (see above). With no path it is an in-memory test store. `save(value)` atomically replaces a 0600 settings file. Never put key material in this object.
- `beginOperation(): Promise<Operation>` resolves credentials once, changes generation before dispatch if necessary, starts new-identity catalog sync, and retains that key for redaction until `release()`.
- `Operation = { gen, key, release }`. Release is idempotent. Keep the operation alive through response/error projection, not merely through request dispatch.
- `Generation` exposes `id`, `baseUrl`, `keyFingerprint`, `catalog`, `bgAbort`, `syncPromise?`, `lastSyncAt?`, `lastSyncError?`, `lastSyncErrorKind?`. The string-indexed extension slot lets features attach generation-local state, e.g. `gen.magpieCards`. Do not put feature state on a global singleton.
- `runtime.isCurrent(gen)` must guard every result commit. Dispose also makes it false. A stale request must not put old cards into the new generation.
- `runtime.invalidateCredential(ref?)` maps a `credentials/reference-updated` ref to its line id (`lineIdOfCredentialRef`) and rotates only when that line is active; without a ref it rotates the current generation. It synchronously drops visible old state and aborts background operations before asynchronously resolving/syncing. Own credential writes suppress that listener until the combined settings mutation commits.
- `runtime.redact(text)` replaces current and active-operation keys literally with `[redacted]`. All gateway strings going into HTTP responses or logs must use this method. Catalog metadata is redacted before it is cached.
- `runtime.settings(body?)` handles the single-schema settings update `{lines?, resync?}` (plus GET projection) and returns a `Response`; the generic SettingsController adds preference fields (`visibleModels`, `defaultEffort`) around it. Credential fields use the tri-state (omit/null/write) contract above; unknown keys are rejected with 400 and nothing is written.
- `publish()` must call the adapter registration handle's `replace(['dsh-magpie-connector'])`; no payload-free imitation event is needed. Same-generation sync is single-flight and times out after 15 seconds. Last successful catalog/time survive same-generation failure; identity changes never retain old data.

## Catalog and adapter

`mapCatalog(body)` produces `CatalogModel[]`, each with:

```ts
interface CatalogModel {
  info: LlmResolvedModelInfo
  provider: string // owned_by, else first id segment
  efforts: string[]
  nativeEndpoints: string[]
  serviceTiers: string[] // tier ids, e.g. priority
}
```

`new MagpieAdapter(runtime, attachments?, isFast?)` extends the real DSH `LlmAdapter`. `attachments` is `Pick<AttachmentStore, 'readImage' | 'imageHostPath'>`; `isFast(sessionId): boolean` is evaluated at **stream** time. Priority still requires the captured catalog's `serviceTiers` to contain `priority`.

- `prepareCall(provider, model)` captures operation identity and a detached model capability snapshot. Its stream is single-use and does not resolve credentials or consult current address/catalog again. Key/address changes do not abort prepared/running generation.
- Generation uses actual pi-ai 0.87.1 `createProvider` with only ordinary `openai-completions` and `openai-responses` modules. No Codex WebSocket or provider discovery is used.
- `thinkingLevelMap.off:null`; explicit effort ids map to themselves. Unselected effort emits no reasoning field. Nonempty stop is rejected before dispatch.
- DSH → pi transcript maps images through `readImage`; offloaded images become text naming the attachment/path. Unsupported/failed images produce a pre-network error.
- Stream events map to DSH block start/delta/end, usage, then finish. Tool JSON deltas are accumulated verbatim. `mapUsage` uses normalized disjoint input/cache/output and derives total only when uncached input >0, per final approved spec.
- Successful finish carries `{response:{pi: AssistantMessage}}` replay state; same-plugin assistant history restores it, preserving encrypted reasoning and provider signatures across tool turns.
- First event timeout is 90s, idle timeout 60s; cancellation/dispose close upstream and terminate. No post-output replay. The injected fetch retries only HTTP 429/5xx before handing any response to pi-ai, with at most two extra attempts; SDK retry remains disabled (`maxRetries:0`).

Core advertises current catalog via `listModels()` and resolves `entry.info`. Feature composition must filter visible entries and apply saved default effort in **both** `resolveModel` and `prepareCall` without re-reading dynamic identity during dispatch. This hook integration is intentionally left to the final host-features assembly to avoid concurrent edits.

## Transport

`GatewayTransport.request({baseUrl,key}, method, path, init?)` is the only outbound transport. `fetchFor(identity)` returns the same captured-identity transport as a standard fetch for pi-ai `options.fetch`.

Allowed relative paths/methods:

- `GET /models`
- `POST /responses`
- `POST /chat/completions`
- `GET /magpie/quotas/cards`
- `POST /magpie/quotas/refresh` (only provider/user query keys)

Every request validates same origin and exact API-root-relative path, forces authorization and DSH attribution headers, uses a private undici Agent, rejects redirects and combines caller/dispose signals. Background requests additionally use `gen.bgAbort`; generation must **not** use that signal. `dispose()` aborts and destroys the private agent, without deleting settings or credentials.

## Host wiring

`apply(ctx,{home?})` currently registers one `dsh-magpie-connector` adapter, credentials event, `/api/dsh-magpie-connector/settings` through injected `connection.fetch`, starts initial sync, and installs an async effect disposer. It returns `{runtime,adapter}` for focused harness tests. The feature assembly adds cards/speed resources and their controller lifecycle here; do not add another adapter registration or another settings route.

## Evidence and remaining assembly

Fresh core run: 9 files / 42 tests pass (connection, generation, catalog mapping/sync, real pi-ai generation, transport, mock self-tests, host wiring, bridge boundaries). Tests named `spec Scenario "…"` match the approved test-plan titles. Two generation-isolation scenarios currently live in `generate.test.ts` because they exercise actual pi-ai dispatch, rather than pure generation state.

Outstanding to lead/features: combine full settings validation/preferences, adapter visibility/default-effort projection, cards/speed route registration, feature dispose tests, and final whole-package verification. Core transport's whitelist test directly exercises all five methods, while feature end-to-end workflows must also be verified after assembly. Bounded pre-event 429/5xx retry now has a dedicated behavioral test, including the 401 no-retry control; already-streaming truncation/error tests assert a single request.

---

# Task-1 implementation evidence

Scope: tasks 1–7 only. No shared task/checkbox completion was marked by this executor. UI sources/tests, OpenSpec, manifest, other packages, credentials and host restart were not edited/read/executed by this executor. Other teammates changed the shared tree during these runs; whole-package results below name the actual snapshot.

## Baseline (2026-10-25, America/New_York)

- 11:27 `npm test --workspace=packages/dsh-magpie-connector`: only 2 UI files, 16 tests passed. There was no host implementation or host test.
- 11:27 `npm run typecheck --workspace=packages/dsh-magpie-connector`: failed TS5010 for `test/support/**` and `test/client-support/**`. Changed the invalid trailing recursive globs to `test/support/**/*.ts` / `test/client-support/**/*.ts`.
- Baseline build only compiled existing client sources. The metadata test later proved the declared host entry did not exist, so a baseline successful client build was not host success.

## RED → GREEN record

Commands use `npm test --workspace=packages/dsh-magpie-connector -- <files>`.

| Time | Test(s) | Actual RED observation before behavior implementation |
|---|---|---|
| 11:30 | `metadata.test.ts` | 1 fail / 1 pass: actual declared host artifact `lib/index.js` absent; negative metadata fixture rejects missing prepare. |
| 11:31 | `catalog-mapping.test.ts` | Both exact scenarios failed: empty mapped names vs expected 3; 0 vs 2 valid entries. |
| 11:32 | `transport.test.ts` | All 3 exact scenarios failed against behaviorless transport seam (`Transport not implemented`), not import/syntax errors. |
| 11:34 | `connection.test.ts`, `catalog-sync.test.ts --testTimeout=300` | 9 failures: absent key status/redaction; expected 409/400 got200; 0 vs1 request; 0 vs13 models; sync request never starts (two 300ms waits); unauthorized classification absent. One initial unconfigured negative-only assertion was vacuously green, see qualification below. |
| 11:35 | `generation.test.ts --testTimeout=300` | All 5 scenarios failed: missing B error; old cards remained; delayed sync never starts; external event did not rotate; missed-event operation did not rotate. |
| 11:39 | `generate.test.ts --testTimeout=300` | 14 failures / 3 vacuous negative passes against an error-only adapter seam: missing actual text/tool/usage/body; unsupported stop had wrong code; no network request; no max-tokens/cancel/success; prepared/running calls unsuccessful. |
| 11:40 | `generate.test.ts -t '附件读取失败\|流中错误事件不当成功\|向不可收图模型发图'` | Strengthened the three negative cases **before bridge implementation**: attachment-specific message, positive text before in-stream error, image-specific error. All 3 failed (`Generation not implemented` or absent text). |
| 11:51 | `host-wiring.test.ts` | Real composed host settings HTTP response leaked key through reflected catalog display name. Fixed at catalog cache ingress, then green. |
| 11:56 | `retry.test.ts` | Pre-event429 retry attempts1 vs expected2. Added bounded 429/5xx-only fetch retry; 401 control stays one request. |
| 12:00 | `redaction.test.ts` | Key containing JSON-escaped quote/backslash survived catalog string-level JSON redaction. Changed to JSON reviver applying literal redaction to decoded strings. |

GREEN checkpoints:

- 11:36: connection/generation/catalog-sync/catalog-mapping/transport: **5 files / 20 tests pass**.
- 11:43: real pi-ai generate: **17 tests pass**. The first green attempt found the mock SSE helper wrote headers twice when resuming a delayed stream, fixed the helper root cause (`headersSent` guard), not the generation assertion.
- 11:53: core/support/wiring boundaries: **9 files / 42 tests pass**, full package typecheck passed.
- 12:01: metadata/support/host-wiring/bridge-boundaries/retry/redaction/connection/generation/catalog-sync/catalog-mapping/generate/transport: **12 files / 46 tests pass**; full package typecheck and build passed. Build emits only existing tsdown deprecation/CommonJS advisories.
- 11:58 whole shared package: **108/109 tests pass**, sole failure was newly introduced `feature-wiring.test.ts` expecting unregistered cards endpoint (feature assembly had not yet happened). This is not claimed as a passing full suite.

### Exact test-plan names and file qualification

- Connection: all five exact names exist. `网关反射的 key 被脱敏` has primitive redaction plus real pi-ai401 checks and composed catalog HTTP-reflection coverage; actual cards HTTP projection is owned by host-features and must be included in final whole-change verification.
- Generation: all seven exact names exist. The two real dispatch cases `已准备的调用按捕获值跑完` and `进行中的生成不被换代中止` live in `generate.test.ts`, not the planned `generation.test.ts`; the names match verbatim, but the test-plan file location needs lead correction/acceptance. Executor did not modify OpenSpec.
- Catalog sync: all five names match; mapping: both names match; generation: all fifteen names match; transport: all three names match.
- `未配置时不提供模型且不发请求` was already negative-only green against the initial empty seam. A later real adapter test asserts `MAGPIE_NOT_CONFIGURED` plus empty advertised catalog and zero network, but there is **no legitimate first-red record for that full scenario**. Do not misreport the vacuous initial pass as RED. All generation negative tests initially vacuous were strengthened and confirmed RED before bridge implementation.
- Transport `完整流程只触达白名单` directly exercises all allowed operations through the one transport and rejects forbidden paths, but the final assembled cards/speed feature workflow still requires its own end-to-end run. This test alone is not evidence that all feature endpoints were wired.

## Interfaces and assembly boundary

See `internal-api.md`. Exported core classes: `MagpieRuntime`, `MagpieAdapter`, `GatewayTransport`, `SettingsStore`; operation/capability interfaces come from their host modules. Real DSH `LlmAdapter`/registration/credentials/attachment types are used, not an alternative adapter framework.

The lead/host-features owner takes final composition of preferences, adapter projection and cards/speed routes. Do not mark tasks1–7 or shared task1 complete merely from this evidence: interface assembly and final whole-suite snapshot must be accepted by lead. No dependency installation was needed or performed in this takeover; pre-existing root lockfile changes were preserved.
