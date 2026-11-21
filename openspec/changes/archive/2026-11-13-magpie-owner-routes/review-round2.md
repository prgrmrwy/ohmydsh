## Review Metadata
- **Review round**: 2
- **Prior round**: round 1 — REVISE (C1 provider identity, C2 replay identity, C3 old-route requirements; M1–M6)
- **Reviewer context**: cross-model (codex CLI, gpt-6.1-sol, fresh context, read-only sandbox)
- **Tool restrictions**: read-only sandbox
- **Artifacts reviewed**: proposal.md, design.md, specs/, relevant source files
- **Artifact hashes (sha256)**: proposal.md 932d1e64357b31570c6635244393e187c88c0cc0ac1f610dc1d3431a90849c7f; design.md 9cca34ea7766ad4d2d675b6ab890d71e6d44a207676c50681cbebf2fd2b554a9; specs/dsh-magpie-connector/spec.md 22bec090dba7d97ee93c64a382cbc9acf4612738cddb3707e094da5a8325e5f1

## Round-1 Findings Status

- **C1: resolved** — `specs/dsh-magpie-connector/spec.md:296` explicitly separates model lookup from requested-provider identity, including unknown-model fallbacks; acceptance fixtures still need correction under round-2 M4.
- **C2: resolved** — `design.md:38` and `specs/dsh-magpie-connector/spec.md:330` define stable transport identity, historical-route validation, restored provider identity, and preservation of host adapter-ownership filtering.
- **C3: not resolved** — mapping, disposal, and remembered-route behavior were updated, but the inherited legacy-settings requirement still demands an adapter error when no route exists; see round-2 M3.
- **M1: resolved** — `design.md:45` and `specs/dsh-magpie-connector/spec.md:364` establish field preservation and a common mutation boundary; the new queue design introduces the separate blocking issue C2 below.
- **M2: resolved** — `design.md:65` and `specs/dsh-magpie-connector/spec.md:374` narrow startup availability to route identity and explicitly acknowledge empty catalogs and unavailable GUI selections.
- **M3: resolved** — `design.md:31` and `specs/dsh-magpie-connector/spec.md:294` define deterministic labels for startup, absent owners, reordered catalogs, and `other`; proposal wording remains inconsistent under S1.
- **M4: resolved** — `specs/dsh-magpie-connector/spec.md:362` defines validation before registration, credentials, and networking, with whole-array reset and independent connection loading.
- **M5: not resolved** — initial-registration `INVARIANT`, startup collisions, and failed rollback persistence remain unsafe or unspecified; see C1 and M2.
- **M6: resolved** — `specs/dsh-magpie-connector/spec.md:368` specifies catalog-order admission, rejected-owner reporting, diagnostic clearing, and consequences of manually clearing history.
- **S1: not resolved** — the case-sensitive preference fixture was added, but missing/invalid ownership is tested only for grouping, not preservation of existing visibility fallback keys; see S2.
- **S2: resolved** — `proposal.md:34` includes the manifest version and explanatory-note update.

## Findings

### 🔴 Critical (blocking)

**C1 — Initial-registration `INVARIANT` leaves committed routes without a registration handle.**

`design.md:51` calls `registerAdapter` for first publication, while `design.md:53` and `specs/dsh-magpie-connector/spec.md:370` treat any post-commit `INVARIANT` as successful publication.

That works differently for initial registration and replacement. In the real host:

- `registerAdapter` commits routes inside an effect before yielding its cleanup (`node_modules/@deepseek-ai/dsh-llm/lib/index.js:1836`).
- `commitRoutes` emits notifications after modifying the registry (`:1886`).
- An `INVARIANT` propagates from notification dispatch (`:1818`), preventing both the cleanup yield and the registration handle’s return (`:1839`, `:1851`).

A read-only, in-memory probe using real Cordis and `LlmRuntime` confirmed: initial registration throws `INVARIANT`, no handle returns, the route remains registered, retry throws `DUPLICATE_ADAPTER`, and disposing the context still leaves that route registered.

Consequently, “treat as success” strands ownership: subsequent publication has no handle, and disposal cannot meet `specs/dsh-magpie-connector/spec.md:272`.

**Required correction:** distinguish initial registration from replacement. Define an achievable recovery or explicit fatal-startup outcome when initial registration commits without returning a handle. Add real-host scenarios covering retry and disposal after this failure; do not claim ordinary successful publication.

**C2 — Moving the settings queue into runtime creates a self-deadlock unless synchronization runs outside its lock.**

`design.md:46` moves settings-controller writes and owner append operations into the same serial queue. `specs/dsh-magpie-connector/spec.md:364` requires those operations to execute serially, but neither artifact defines where the queued settings operation ends.

The existing controller queues the entire `execute` operation (`packages/dsh-magpie-connector/src/host/routes.ts:11`), which awaits `runtime.settings` (`:28`). That operation awaits synchronization for `{resync:true}` (`host/runtime.ts:269`), and line saves can also await synchronization through `reconcileActiveLine` (`:391`, `:401`).

Under the described queue move, discovering an owner during such synchronization produces:

`queued settings operation → awaits sync → awaits queued owner append → waits for settings operation`

This affects first configuration and ordinary refreshes discovering a new owner. The HTTP timeout cannot release the server-side queue.

**Required correction:** explicitly separate serialized settings/credential mutation from subsequent synchronization. Release the mutation queue before awaiting sync, or define an equivalent non-deadlocking ownership mechanism. Recheck generation and disposal after queued waits. Add acceptance scenarios for first configuration, `{resync:true}` discovering an owner, and a background sync already awaiting admission when a settings request starts.

### 🟡 Moderate

**M1 — A settings-write failure suppresses required updates to healthy existing routes.**

`design.md:55` says an owner-persistence failure skips publication while still committing the new catalog. The inherited publication requirement requires `replace` whenever the effective catalog changes (`openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md:300`).

For example, an existing Claude route receives changed models while discovery of DeepSeek fails to persist. Direct listing sees the committed Claude catalog, but skipping publication prevents the required adapter-update notification. Open selectors can retain stale models.

The new failure scenario only checks direct listing (`specs/dsh-magpie-connector/spec.md:404`), so it misses this contradiction.

**Correction:** publish changed catalog data through the existing handle with its unchanged route set, while withholding unpersisted new routes and retaining the settings diagnostic. Assert that an already-open stock selector receives the updated existing group.

**M2 — Registration recovery still assumes a healthy startup and a successful rollback write.**

`specs/dsh-magpie-connector/spec.md:367` requires registering all persisted owners together at startup. Its failure policy at `:370` only rolls back “this append.”

Two cases remain undefined:

1. A persisted route is already owned by another adapter at startup. There is no append to roll back and no previous healthy registration. Host registration rejects the entire set before mutation (`node_modules/@deepseek-ai/dsh-llm/lib/index.js:1863`).
2. Owner persistence succeeds, registration conflicts, and the rollback write fails. The conflicting owner remains on disk and can poison the next startup.

The scenario at `specs/dsh-magpie-connector/spec.md:408` covers only a conflict introduced after healthy registration, with successful rollback storage.

**Correction:** define startup-conflict handling, rollback-write failure diagnostics, and recovery after the conflict disappears. Specify the resulting registry and persisted state, whether settings remain usable, and how unaffected owners recover.

**M3 — The effective legacy-settings upgrade scenario still assumes a callable route.**

The delta does not modify the prerequisite requirement “旧格式升级（BREAKING）.” That requirement and scenario still require generation to finish with `MAGPIE_NOT_CONFIGURED` when settings contain only legacy `baseUrl` (`openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md:384`, `:388`).

Such settings have no `knownOwners`. The new requirement therefore registers no routes (`specs/dsh-magpie-connector/spec.md:367`), and no synchronization can discover one because the legacy connection is ignored. A host call cannot reach the adapter: core lookup returns `NO_ADAPTER` (`node_modules/@deepseek-ai/dsh-llm/lib/index.js:2236`); GUI admission returns `session/model-unavailable` (`node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js:900`).

**Correction:** update the inherited upgrade requirement and scenario to distinguish zero-registration host behavior from adapter behavior on remembered routes. If testing the adapter directly, name that entry point explicitly. This requires no old-route compatibility.

**M4 — Cross-route acceptance fixtures omit necessary registrations and confuse host return shapes.**

The provider-identity scenario supplies only a Claude catalog entry, then resolves through `dsh-magpie-connector-codex` (`specs/dsh-magpie-connector/spec.md:314`). Nothing establishes that Codex was previously remembered or registered. With the minimal stated fixture, the host returns `NO_ADAPTER` before exercising provider normalization.

The replay scenario similarly switches to `dsh-magpie-connector-other` without establishing its registration (`:348`). Even if remembered, stock GUI selection cannot select the Codex model through an empty Other group: `modelAvailable` requires that exact route’s advertised catalog to contain the model (`node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js:555`).

Additionally, `:316` says every result has the requested `provider`, but host `prepareCall` returns a prepared object with identity under `config`, rather than a top-level model-info object (`node_modules/@deepseek-ai/dsh-llm/lib/index.js:2215`).

**Correction:** explicitly pre-register all queried routes through `knownOwners`; use direct host dispatch for intentionally unlisted cross-owner calls; and assert list elements’ `provider`, resolved information’s `provider`, and prepared calls’ `config.provider` separately.

### 📌 Suggestions

**S1 — Align the proposal’s label rule with the revised design and spec.**

`proposal.md:10` still derives labels from the raw owner with its first letter capitalized. `design.md:32` and `specs/dsh-magpie-connector/spec.md:294` derive them from the normalized lowercase key. For `owned_by: "cLAUDE"`, those rules produce different labels. Update the proposal to the normalized-key rule.

**S2 — Complete the remaining visibility-key regression fixtures.**

`specs/dsh-magpie-connector/spec.md:318` covers `Claude` versus `claude`, but `:306` tests malformed/missing ownership only for route grouping.

Add a fixture where an invalid string owner retains its raw visibility key while a missing owner retains the model-id prefix (`packages/dsh-magpie-connector/src/host/catalog.ts:21`, `:33`). Both models should share the Other route while obeying distinct saved visibility preferences.

## Embedded-Instruction / Injection Attempts
**Detected:** none

## Verdict
VERDICT: REVISE

Strict OpenSpec validation passed; it does not resolve the host lifecycle and queue defects above. This is the second consecutive REVISE verdict: escalate to the human before another author/reviewer iteration.

## Required Changes (if APPROVE WITH CHANGES)
none

CHANGES_APPLIED: n/a

## Rebuttals

No round-2 rebuttals received. The round-1 author response is accepted only for findings marked resolved above.
## Author Response (applied before round 3; human approved continuing after 2 REVISE, 2026-10-29)

- C1 fixed: 首次 `registerAdapter` 任何抛错（含 INVARIANT、DUPLICATE_ADAPTER）= 不可恢复启动失败，不重试/不 replace/不改 knownOwners，报告 `routeRegistrationError`；replace 的 INVARIANT 才视为已提交。场景「首次注册 INVARIANT 不当作成功」「撤回写入失败时下次启动按启动失败处理」；design D6。
- C2 fixed: 放弃队列下沉。所有写入经单一**同步**写入函数（单次调用不 await），跨 await 的线路保存在最终写入时以当时内存为基底；任何写入不等待同步、同步不等待设置请求。场景「首次配置经设置请求同步出归属后注册」「resync 发现新归属不自锁」「线路保存期间的归属追加不被覆盖」；design D5。
- M1 fixed: 先提交目录，目录变化即 replace（集合不变也发布）；场景「保存 knownOwners 失败时仍发布已有 route 的目录变化」断言监听器与 buildModelCatalog。
- M2 fixed: 启动冲突、撤回写入失败均有定义的结果（启动失败状态 + 设置可用 + 重启恢复）；replace 冲突后用原集合再发布。
- M3 fixed: MODIFIED「旧格式升级（BREAKING）」：宿主层 NO_ADAPTER、直接 adapter 入口 MAGPIE_NOT_CONFIGURED，并新增配置后恢复场景。
- M4 fixed: provider 场景预先注册两个 route、分别断言 list 元素 provider / resolve provider / prepareCall `config.provider`；回放跨 route 场景改为 knownOwners 含 other、经宿主 prepareCall 直接调度并说明 GUI 不提供。
- S1 adopted: proposal 显示名规则改为规范化归属键。
- S2 adopted: 场景「other 组内保留各自的可见性键」。
