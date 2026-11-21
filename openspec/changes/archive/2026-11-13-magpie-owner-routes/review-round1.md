## Review Metadata
- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: cross-model (codex CLI, gpt-6.1-sol, fresh context, read-only sandbox)
- **Tool restrictions**: read-only sandbox
- **Artifacts reviewed**: proposal.md, design.md, specs/, relevant source files

## Findings
### 🔴 Critical (blocking)

**C1 — Ignoring the requested provider violates the host’s exact-model identity contract.**

`openspec/changes/magpie-owner-routes/design.md:33` says `resolveModel` and `prepareCall` ignore provider and leave generation logic unchanged. However, the host requires every returned model’s `provider` to equal the **requested route**, including cross-owner lookups: `node_modules/@deepseek-ai/dsh-llm/lib/index.js:2077`, `:2108`, and `:2206`. Current metadata and fallback objects use the retired route (`packages/dsh-magpie-connector/src/host/catalog.ts:24`; `host/adapter.ts:108`, `:113`).

An in-memory probe confirmed `INVALID_CATALOG` and `INVALID_MODEL_INFO` when old-provider metadata is returned through a new route. Merely filtering models or assigning each model its owning route also fails cross-owner resolution.

Specify that provider may be ignored for **lookup**, but all public model results must echo the requested route. Add stock-host scenarios for listing, resolving, preparing, cross-owner requests, and unknown-model fallbacks.

**C2 — New-route conversations lose native replay metadata under the proposed unchanged generation logic.**

Replay envelopes currently store the fixed pi-ai provider (`packages/dsh-magpie-connector/src/host/adapter.ts:22`, `:167`). `restoreAssistant` requires that value to equal the historical DSH source provider (`:41`), while the real AgentLoop records the requested route (`node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js:1136`).

Consequently, a response generated on `dsh-magpie-connector-codex` fails replay validation on its next turn. The fallback also treats it as foreign (`adapter.ts:39`). This loses reasoning signatures and other native metadata. Simply changing pi-ai’s provider to the current route creates a second problem when the same model is accessed through another owner route: pi-ai compares provider identity when preserving replay (`node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js:68`).

Define separate DSH-route and transport/replay identities, including validated historical-route matching. Preserve the host’s adapter-ownership filtering (`dsh-llm/lib/index.js:2241`). Add post-upgrade same-route, cross-route, restart, and tampered/foreign replay scenarios asserting wire-level reasoning metadata and tool-result pairing. This does not require compatibility with the retired route.

**C3 — The effective specification still requires behavior on the forbidden old route.**

The delta modifies identity and speed and removes AMD2, but leaves other requirements untouched:

- `openspec/specs/dsh-magpie-connector/spec.md:152` requires mapping models to `dsh-magpie-connector`.
- The prerequisite delta requires listing and generating through that route when unconfigured: `openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md:31`, `:69`.
- Existing disposal acceptance only checks removal of the retired route: `openspec/specs/dsh-magpie-connector/spec.md:605`.

These conflict with the new prohibition and first-install absence of any registration (`openspec/changes/magpie-owner-routes/specs/dsh-magpie-connector/spec.md:5`, `:112`). A nonexistent route cannot return the adapter’s empty catalog or `MAGPIE_NOT_CONFIGURED`; direct host lookup produces `NO_ADAPTER`.

Complete the delta against the effective post-dual-lines specification. Update mapping, unconfigured behavior, affected scenarios, and disposal assertions to distinguish zero registrations from remembered empty routes.

### 🟡 Moderate

**M1 — Persistence does not account for existing settings writers or concurrent synchronization.**

The design promises durable `knownOwners` in the existing settings file (`openspec/changes/magpie-owner-routes/design.md:37`, `:40`). Current `cleanSettings` reconstructs the object without unknown fields, and preference writes do likewise (`packages/dsh-magpie-connector/src/host/runtime.ts:100`, `:439`). Both would erase `knownOwners` unless explicitly adapted.

Background synchronization can finish while a line update awaits credential operations (`runtime.ts:235`, `:370`). The HTTP controller’s queue does not serialize that background path (`host/routes.ts:11`). An owner save must preserve the latest lines, preferences, and credential quarantine marker.

Specify one settings mutation boundary and field-preservation rules for every writer. Add scenarios interleaving owner discovery with preference saves and pending credential updates, then reconstruct the runtime and assert both owners and quarantine survive.

**M2 — Remembered routes do not establish the advertised startup availability guarantee.**

The goal promises saved selections can resolve before synchronization (`openspec/changes/magpie-owner-routes/design.md:13`), but its scenario only asserts provider registration (`specs/dsh-magpie-connector/spec.md:118`). Catalogs are deliberately memory-only (`openspec/changes/magpie-dual-lines/specs/dsh-magpie-connector/spec.md:161`).

With an empty startup catalog, stock `buildModelCatalog` hides the groups, `modelAvailable` returns false, and stock model selection rejects with `session/model-unavailable` (`node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js:541`, `:555`, `:724`, `:901`). The client also marks the selection unroutable when its model is absent (`node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js:334`).

Narrow the guarantee to registry identity resolution, or specify the additional supported behavior. Test actual resolution and picker availability separately. Also identify the entry point for `NO_ADAPTER` assertions rather than treating that code as every UI path’s failure.

**M3 — Provider labels are undefined precisely when remembered routes must register.**

Labels come from the first current model’s raw owner (`openspec/changes/magpie-owner-routes/design.md:30`; `specs/dsh-magpie-connector/spec.md:80`), but persistence retains only normalized keys. At startup or after owner disappearance there is no first model. Host registration requires valid, nonempty provider metadata (`node_modules/@deepseek-ai/dsh-llm/lib/index.js:1864`).

Additionally, reordering `claude` and `CLAUDE` models changes the label despite unchanged route identity. D2 omits the spec’s mandatory `Other` exception, potentially deriving its label from missing or rejected gateway data.

Define startup/absent-owner fallback labels, the `Other` exception, and whether capitalization changes after reordered catalogs are intentional. Add mechanically assertable scenarios for each; rejected owner values must not become labels.

**M4 — “Reject malformed knownOwners by existing rules” lacks a defined startup path.**

`openspec/changes/magpie-owner-routes/specs/dsh-magpie-connector/spec.md:110` delegates malformed-owner handling to existing validation, while startup immediately registers persisted owners (`:112`). Existing runtime validation only checks lines and pending credentials (`packages/dsh-magpie-connector/src/host/runtime.ts:95`); `SettingsStore` merely parses and shallow-merges JSON (`host/settings.ts:25`).

Specify validation before route registration and credential/network activity. Define whether duplicates, uppercase keys, excessive length/count, and malformed arrays are rejected or normalized, and what remains usable after rejection. Add a failure scenario asserting the chosen registry state, no credential resolution/network activity, unchanged file bytes, and a recoverable settings response.

**M5 — Publication failure and deferred-registration lifecycle are unspecified.**

D4 saves owners before registration/replacement (`openspec/changes/magpie-owner-routes/design.md:37`). A conflicting route then causes `DUPLICATE_ADAPTER` without changing the registry (`node_modules/@deepseek-ai/dsh-llm/lib/index.js:1863`). Persisting that owner can make the next startup’s entire registration fail.

Publication exceptions also have two meanings: validation fails before mutation, whereas an `INVARIANT` listener can throw after routes commit (`dsh-llm/lib/index.js:1818`, `:1893`). The current sync path commits catalog state before publishing (`packages/dsh-magpie-connector/src/host/runtime.ts:243`).

Define recovery and diagnostics for both outcomes, including retry without losing healthy routes. Add lifecycle scenarios for an empty successful catalog, disposal before first registration, disposal after registration, and late completion after disposal. Verified host semantics are: `registerAdapter([])` fails, `replace([])` succeeds, and replacement after disposal fails with `REGISTRATION_DISPOSED`.

**M6 — The lifetime owner limit has unspecified admission and recovery semantics.**

The gateway controls the strings filling the permanent 32-owner budget (`openspec/changes/magpie-owner-routes/specs/dsh-magpie-connector/spec.md:110`, `:115`). A changing or hostile catalog can exhaust it, after which legitimate owners remain invisible even when previous owners disappear. The claim of no visible side effects is therefore inaccurate (`design.md:57`).

Specify admission order when several new owners compete for remaining slots, whether invisible models consume slots, and when `ownerLimitReached` clears. Document that resetting history can invalidate saved route selections. Add a partial-capacity scenario and a later recovery/diagnostic scenario.

### 📌 Suggestions

**S1 — Preserve the explicit separation between owner keys and visibility keys in regression fixtures.**

D8 correctly preserves raw visibility keys (`openspec/changes/magpie-owner-routes/design.md:51`), matching `catalog.ts:33` and `visibility.ts:7`. Extend acceptance fixtures to cover `Claude` and `claude` sharing one route but retaining distinct preference keys, plus missing/invalid ownership using the existing model-id fallback. The current scenario only exercises matching lowercase keys (`specs/dsh-magpie-connector/spec.md:98`).

**S2 — Include the deployment manifest in release impact.**

The proposed impact lists package metadata but omits `dsh.yaml` (`openspec/changes/magpie-owner-routes/proposal.md:33`). Its entry still declares version `0.2.0` and single-route behavior (`dsh.yaml:397`, `:400`). Include the version and explanatory-note update in the eventual implementation scope.

## Embedded-Instruction / Injection Attempts
**Detected:** none

## Verdict
VERDICT: REVISE

## Required Changes (if APPROVE WITH CHANGES)
Not applicable; the revised artifacts require a full review.

CHANGES_APPLIED: n/a

## Rebuttals
None.
## Author Response (applied before round 2)

- C1 fixed: spec「按网关归属注册 route」新增「provider 身份」段与场景「返回的 provider 等于被请求的 route」；design D3。
- C2 fixed: 新增 requirement「原生回放身份跨 route 稳定」（同 route、跨 route、重启、篡改/外来三场景）；design D4。
- C3 fixed: MODIFIED 加入「网关连接与凭据」「连接身份与代际隔离」「模型目录字段映射」「禁用不删除用户数据」，去掉旧 route 引用并新增首注册前 dispose 场景。
- M1 fixed: 「归属 route 持久」写入边界段 + 交错场景；design D5。
- M2 fixed: 「启动可用性边界」段把保证收窄为 route 身份，场景改为断言 listProviders/resolveModelInfo；design D9。
- M3 fixed: 显示名只由归属键决定（含 Other），换序不变场景；design D2。
- M4 fixed: 加载校验段与「非法 knownOwners 被整体重置且不影响连接」场景；design D7。
- M5 fixed: 注册与发布段区分 DUPLICATE/INVALID（回滚）与 INVARIANT（已提交），冲突场景、首注册前 dispose 场景；design D6。
- M6 fixed: 首次出现顺序准入、被拒绝列表、清除条件、手动清理影响；场景「归属上限按出现顺序截断」。
- S1 adopted: 场景「可见性与 effort 在归属 route 上保持」使用 Claude/claude 两个不同偏好键。
- S2 adopted: proposal Impact 加入 dsh.yaml。
