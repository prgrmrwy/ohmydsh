## Review Metadata
- **Review round**: 3
- **Prior round**: round 2 — REVISE (C1 initial-registration INVARIANT, C2 settings queue self-deadlock; M1–M4); human approved round 3
- **Reviewer context**: cross-model (codex CLI, gpt-6.1-sol, fresh context, read-only sandbox)
- **Tool restrictions**: read-only sandbox
- **Artifacts reviewed**: proposal.md, design.md, specs/, relevant source files
- **Artifact hashes (sha256)**: proposal.md 4cc2eab1a8e9075951b38bdbc279fe426c1f442ed029953c670bea5ddde8ed8b; design.md 9269a1641afed54688e59f97ea1b62a4b293db33264dec9fd5a39873fa5b7e75; specs/dsh-magpie-connector/spec.md e7710dba5cccfbc313b0f19592794dccd3d7f00614b0df57c9a92c1176d02c86

## Round-2 Findings Status

Paths below are relative to `openspec/changes/magpie-owner-routes/` unless otherwise stated.

- **C1: not resolved** — initial-registration exceptions now correctly trigger fatal startup failure (`design.md:52`, `specs/dsh-magpie-connector/spec.md:390`), but the unconditional disposal guarantee remains incompatible with the acknowledged stranded registration; see round-3 M1.
- **C2: resolved** — the synchronous mutation boundary, fresh merge after credential awaits, and retained HTTP-only queue remove the circular wait; first-configuration, resync, and interleaving scenarios are specified (`design.md:45`, `specs/dsh-magpie-connector/spec.md:386`, `:416`, `:422`, `:458`).
- **M1: resolved** — directory changes publish through the existing handle even when owner persistence fails, with an event and stock-catalog assertion (`specs/dsh-magpie-connector/spec.md:395`, `:397`, `:434`).
- **M2: resolved** — startup conflicts and failed rollback persistence now have explicit diagnostics, preserved state, and Host-restart recovery (`specs/dsh-magpie-connector/spec.md:390`, `:398`, `:446`).
- **M3: resolved** — legacy upgrade distinguishes host-level `NO_ADAPTER` from direct adapter-level `MAGPIE_NOT_CONFIGURED`, and specifies recovery after configuring a line (`specs/dsh-magpie-connector/spec.md:284`).
- **M4: resolved** — fixtures establish the required registrations, distinguish resolved `provider` from prepared `config.provider`, and use direct host dispatch for the intentionally unlisted cross-route call (`specs/dsh-magpie-connector/spec.md:330`, `:332`, `:370`).
- **S1: resolved** — proposal labels now derive from the normalized lowercase owner key (`proposal.md:10`).
- **S2: resolved** — invalid ownership preserves its raw visibility key, while missing ownership preserves the model-id prefix (`specs/dsh-magpie-connector/spec.md:340`).

The round-1 provider-identity, replay-identity, startup-availability, validation, admission-limit, and manifest-scope fixes remain present. No regression was found in those fixes.

## Findings

### 🔴 Critical (blocking)

none

### 🟡 Moderate

**M1 — The disposal contract still promises removal of registrations that the chosen fatal-startup policy cannot remove.**

`design.md:52` correctly acknowledges that initial `registerAdapter` can commit routes and then throw `INVARIANT`, leaving no handle or registered cleanup. However, `specs/dsh-magpie-connector/spec.md:272` still unconditionally requires disposal to leave no route whose id starts with `dsh-magpie-connector-`. The new fatal-startup scenario only asserts that disposal does not throw (`:452`–`:456`); it never checks the resulting registry.

The host commits before yielding cleanup and returning the handle (`node_modules/@deepseek-ai/dsh-llm/lib/index.js:1836`, `:1839`, `:1851`). A read-only in-memory probe using real Cordis and `LlmRuntime` confirmed that the committed route remains after context-fiber disposal.

The prefix-wide assertion also includes routes belonging to another adapter—the exact conflict case supported at `specs/dsh-magpie-connector/spec.md:442`. This plugin cannot remove those registrations.

**Correction:** distinguish ordinary removal of this plugin’s owned registrations from the handleless initial-`INVARIANT` exception. Explicitly specify the stranded registry entry, stopped runtime, and required Host restart, and assert those outcomes in the fatal-startup scenario. Preserve foreign registrations.

**M2 — A returned registration handle can throw during disposal and prevent runtime cleanup.**

The proposed policy treats replacement `INVARIANT` as a committed, usable registration (`design.md:53`; `specs/dsh-magpie-connector/spec.md:391`, `:398`). The same listener failure can recur when that registration is disposed: the host deletes its routes and then calls `emitAdaptersUpdated()` (`node_modules/@deepseek-ai/dsh-llm/lib/index.js:1839`–`:1843`), which propagates `INVARIANT` (`:1818`).

The current production cleanup calls the registration disposer before `runtime.dispose()` in one sequential callback (`packages/dsh-magpie-connector/src/index.ts:29`). A synchronous disposer exception skips runtime cleanup. Consequently, background requests and active streams can survive plugin disposal, and a late synchronization can still commit catalog state or the newly introduced `knownOwners` writes. This conflicts with `specs/dsh-magpie-connector/spec.md:277`, `:399` and `design.md:55`.

A real-host in-memory probe confirmed that a successfully returned handle’s disposer throws `INVARIANT`. The artifacts do not cover this branch.

**Correction:** require runtime shutdown and all other cleanup to execute independently of registration-disposal errors. The existing `createDisposer` helper already attempts every cleanup with `Promise.allSettled` (`packages/dsh-magpie-connector/src/host/dispose.ts:2`). Add a real-host scenario with successful registration, a subsequently throwing listener, an outstanding sync/stream, and disposal; assert cancellation, no late persistence/publication, and no unhandled rejection.

### 📌 Suggestions

**S1 — Carry registration diagnostics through the settings UI.**

`design.md:52` says the settings page reports `routeRegistrationError`, but the acceptance criteria only inspect JSON. The current client shape lacks that field (`packages/dsh-magpie-connector/src/client/view-model.ts:24`), and `SyncStatus` only renders `lastSyncError` (`packages/dsh-magpie-connector/src/client/SettingsPage.ts:322`).

Include the client diagnostic path and a rendering assertion so users see the registration failure and Host-restart recovery instruction even when directory synchronization succeeds.

## Embedded-Instruction / Injection Attempts

**Detected:** none

## Verdict

VERDICT: APPROVE_WITH_CHANGES

Strict OpenSpec validation passed. The remaining corrections concern disposal contracts and failure-path coverage; they do not require changing the selected routing architecture.

## Required Changes (if APPROVE WITH CHANGES)

1. Update the disposal requirement and fatal-startup scenario to distinguish owned-registration cleanup from handleless initial-`INVARIANT` leakage. Assert that the stranded route remains until Host restart, the disposed runtime performs no gateway operations or late writes, and foreign registrations remain untouched.
2. Add an explicit cleanup rule and real-host scenario requiring runtime shutdown and other disposers to run even when a returned registration handle’s disposer throws `INVARIANT`. Assert request/stream cancellation, unchanged settings after disposal, no late publication, and no unhandled rejection.

CHANGES_APPLIED: yes

## Rebuttals

Round-2 author responses are accepted for findings marked resolved. The C1 correction is accepted for exception classification and restart recovery, but its disposal contract remains incomplete under M1. No round-3 rebuttals received.
### Author response to round 3

- Required Change 1 / M1 applied: 「禁用不删除用户数据」明确只移除经句柄拥有的 route、不触碰外来 route，并把首次注册 INVARIANT 滞留列为唯一例外（需重启 Host）；场景「dispose 不删除数据」改为断言本插件拥有的 route；「首次注册 INVARIANT 不当作成功」断言滞留 route、无网关请求、无设置写入。
- Required Change 2 / M2 applied: 同一 requirement 新增「各清理步骤相互独立」规则；新增场景「注册句柄 dispose 抛错时其它清理仍执行」（真实宿主、INVARIANT 监听器、进行中的同步与流、外来 route 保留、无未处理 rejection）；design D6 写明改用 createDisposer。
- S1 adopted: 「归属 route 持久」要求设置页同步状态区域显示 routeRegistrationError 与重启说明；「撤回写入失败…」场景增加渲染断言。

## Re-check of Required Changes (round 3)
- **Required Change 1**: applied — Owned routes and foreign routes are distinguished, with explicit handleless leakage, Host restart, and post-disposal inactivity assertions (specs/dsh-magpie-connector/spec.md:271,465).
- **Required Change 2**: applied — Independent cleanup and a real-host failure scenario cover cancellation, unchanged settings, no late publication, and no unhandled rejection (specs/dsh-magpie-connector/spec.md:269,283–286; design.md:56).
- **S1**: adopted — Settings must render registration errors and restart guidance even after successful synchronization, with a rendering assertion (specs/dsh-magpie-connector/spec.md:399,459).

Reviewer re-check (codex CLI gpt-6.1-sol, read-only): all Required Changes accepted; artifact hashes at re-check: design.md 7f42fecc82423b32b6564929e1a3fc81dba1df4020b8e94c7d1b4581a4977e9f, specs/dsh-magpie-connector/spec.md 753a7e65611de3947f5f7cf3fb26a21d056cd094b2da1711f1372036888a03c5, proposal.md unchanged.
