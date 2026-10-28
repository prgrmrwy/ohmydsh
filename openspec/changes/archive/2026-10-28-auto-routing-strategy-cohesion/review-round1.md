## Review Metadata

- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: cross-model (codex / gpt-6.1-sol), fresh context
- **Tool restrictions**: read-only inspection; single write to review.md
- **Artifacts reviewed**: proposal.md, design.md, all three delta specs, all three current main specs, root AGENTS.md and dsh.yaml; key source files: src/policy-v2.ts, src/policy-host.ts, src/policy-store.ts, src/support.ts, src/effort.ts, src/index.ts, src/subagent-tool.ts, src/endpoints.ts, src/feedback.ts, src/state.ts, src/context.ts, src/jev.ts, src/settings.ts, src/settings-contract.ts, src/settings-host.ts, src/client/index.ts, src/client/control.ts, src/client/label.ts, src/client/strategy-details.ts, src/policy-v2-rubric.json, package.json, tsconfig.json, tsdown.config.ts; relevant policy-host/host/tool/store/feedback/usage-report/label/content tests, both bundled skills, README.md, docs/feedback-evaluation.md, eval/policy-v2-live.mjs, scripts/policy-v2-host-probe.mjs; root scripts/sync.mjs and tests/auto-model-routing-sync.test.mjs. Paths below are relative to the repository unless explicitly absolute.

Inspection only: no tests, builds, sync, archive, or live model calls were run. Strict validation exited 1 with exactly seven long-requirement warnings; non-strict validation exited 0. These warnings are not evidence that archive semantics, equivalence, or security are correct.

## Findings

### 🔴 Critical (blocking)

**C1. The required uniqueness rule rejects the required built-in registry.**

- **Evidence:** openspec/changes/auto-routing-strategy-cohesion/specs/auto-model-routing/spec.md:12 requires transport prefixes to be unique across all strategies. Lines 17–18 give both Claude and Codex the empty prefix for their local transports. Lines 25–28 add a third empty-prefix local transport for DeepSeek. design.md:66 repeats the global uniqueness rule.
- **Concrete failure:** a conforming `createRegistry` compares prefixes across strategies and rejects `claude: ''` versus `codex: ''` at module initialization. The plugin cannot load with its mandatory built-ins. If interpreted as uniqueness across all transport entries, each family's two Magpie entries also collide.
- **Required fix:** define uniqueness and ambiguity within each provider's namespace, not globally. Distinct providers may reuse the empty prefix and identical prefixes. For a shared provider, reject duplicate/overlapping family prefixes; define how an empty prefix interacts with other families on that provider. Add construction scenarios accepting both actual built-ins plus the synthetic local DeepSeek strategy, and rejecting two conflicting family prefixes on the same provider. Apply case normalization consistently with the matching contract.

**C2. The persisted family schema prevents the promised one-file-plus-registration extension.**

- **Evidence:** design.md:27 promises that adding a family needs only a strategy file and registration, but design.md:79 explicitly keeps `family` restricted to `claude | codex`. The current restriction is packages/auto-model-routing/src/policy-store.ts:12; policy-host.ts:18 also embeds this union. The new-family scenario at delta auto-model-routing/spec.md:25–28 exercises a main request and preview, not official child creation, persistence, or cold restoration.
- **Concrete failure:** register `deepseek` on `opencode-go` and infer that family during official creation. `PolicyStore.set` rejects the child binding before its first request. A preview can pass while actual automatic delegation still fails. Leaving the new family out of the stored binding instead is not a general solution for shared transports.
- **Required fix:** derive accepted family/provider identities from the registry throughout the host and record schemas, including the AsyncLocalStorage binding. Specify cold-read behavior for records whose family is no longer registered without weakening exact-route validation. Extend the synthetic-family scenario through official fresh creation, precise child binding, durable record read, plugin restart, and replay with zero additional Jev calls; assert no source edits outside the new strategy and registration.

**C3. Broad passthrough parsing weakens the current fail-closed record boundary.**

- **Evidence:** design.md:79 prescribes `.passthrough()` with an unspecified omit-style compatibility parse. Today packages/auto-model-routing/src/policy-store.ts:6–16 uses strict objects, :32–35 refuses invalid records, and :38–42 validates writes. test/policy-store.test.ts:6–17 explicitly rejects unknown fields, including a raw `task` payload. design.md:96 says these default-path test expectations must not change.
- **Concrete failure:** a valid child record plus an unknown `task` or misspelled routing-control field is rejected today. General passthrough accepts it. Because `childRouting` returns the record directly (src/index.ts:151–154), passthrough data can also escape in status responses; a spread-and-save path can perpetuate it. The plan says both “tolerate old versions” and “corruption still fails closed” without a safe boundary between them.
- **Required fix:** allow only the specifically retired historical keys on reads, validate their historical shapes as appropriate, strip them before constructing the canonical record, and keep canonical/nested objects strict on writes. Do not accept arbitrary extra keys. Add tests proving that a genuine old record restores, while an unknown field, malformed route/identity, mismatched child ID, damaged bound marker, or missing bound record still rejects without a model request or Jev call. Preserve the existing raw-task rejection test.

**C4. The plan replaces removed version concepts with new version concepts and leaves other version writers undefined.**

- **Evidence:** proposal.md:12,27–28; design.md:45,81–82; delta auto-allocation-feedback/spec.md:4–9; delta auto-routing-usage-report/spec.md:27–37 require new `pluginVersion` snapshots and version-based report groups. This is a new runtime provenance/grouping concept, not merely an ordinary package release number. Meanwhile src/feedback.ts:13–14,43,50 writes `version: 2` feedback events and `version: 1` fact events; src/usage-report.ts:282 emits `schema: 1`; eval/policy-v2-live.mjs:19 writes `rubricVersion`, although design.md:70 says to change only the live evaluator's paths.
- **Concrete failure:** following the design still produces version-bearing telemetry, version-based grouping, and a live evaluation `rubricVersion`, despite the owner's authoritative request to remove every version concept. The new-field absence scenario at delta auto-model-routing/spec.md:43–46 only covers initial binding and creation, not feedback changes, exposure, MANUAL facts, report output, or evaluator output.
- **Required fix:** remove the newly introduced snapshot `pluginVersion` and package-version grouping requirement. Retain only non-version facts needed for strategy attribution and specify report grouping accordingly. Explicitly inventory and settle the remaining event/report/evaluator format markers under the same no-version rule; preserve read-only compatibility for historical rows rather than silently keeping new version writes. Add write/absence scenarios covering feedback changes/revocation, exposure, MANUAL facts, reports, and the live evaluator. Normal package/dependency release numbers are separate publishing metadata, not a reason to reintroduce routing-version semantics.

### 🟡 Moderate

**M1. The documented rollback command does not roll back this local package, and its data impact is understated.**

- **Evidence:** design.md:108 says to pin the dsh.yaml entry back to 0.4.1 and run `dsh build`; dsh.yaml:171–177 declares `source: local`. scripts/sync.mjs:1352,1378 chooses `file:<current package directory>` for local packages, regardless of the version label; :1542–1544 detects the version mismatch and reinstalls those same local bytes. Old strict readers are visible at src/policy-store.ts:8–16 and src/feedback.ts:7–14. Routed child headers write their record again at src/policy-host.ts:234.
- **Concrete failure:** changing only the manifest version reinstalls 0.5.0 source, not 0.4.1. Even with an actual old artifact installed, an old child resumed under 0.5.0 can have its historical record rewritten without the old fields; downgrade failure is therefore not limited to newly created 0.5.0 children. Skipped ledger bindings also remove decisions from usage reports, not only feedback icons.
- **Required fix:** document an executable, exact 0.4.1 artifact rollback (for example a temporary remote customization with exact npm spec/version, or restoring the matching committed package source and manifest), including restart and verification. State that any rewritten child record can become unreadable, that new ledger rows become invisible to old readers/reports, and that saving settings has removed old overrides. Define a non-destructive backup/restore or explicit loss boundary; never recommend deleting bound markers to bypass failure. Add a read-only-fixture compatibility matrix for upgrade and downgrade.

**M2. Archive leaves the current main spec's authority text contradicting the new requirements.**

- **Evidence:** current openspec/specs/auto-model-routing/spec.md:5–7 still authorizes legacy rollback and says only the first seven requirements are the current contract, with later requirements applying only to legacy. Current openspec/specs/auto-routing-usage-report/spec.md:5 still describes version grouping. Neither delta plans an explicit update to these non-requirement sections. The installed OpenSpec merger at /Users/prgrmrwy/.dsh/plugins/dsh-openspec/generations/013714614a39ede9e69d20c7/dist/core/specs-apply.js:238–248 deliberately leaves an existing Purpose unchanged, even if a delta supplies a replacement Purpose.
- **Concrete failure:** a successful requirements merge leaves top-level guidance declaring the removed rollback path valid and potentially classifying newly appended registry/input/settings requirements as legacy-only. Passing validation will not catch this contradiction.
- **Required fix:** include an explicit sync/archive task to rewrite the current model-routing Purpose and seven-requirement authority paragraph, and the usage-report Purpose, after requirement merging. Verify the merged main documents contain no live legacy/version-selection obligations and that each surviving current requirement remains authoritative. The rename-plus-MODIFIED operation for `新策略决策与执行` itself is valid; the unmerged prose is the problem.

**M3. The equivalence oracle covers normal slots but not the routing inputs most likely to change.**

- **Evidence:** delta auto-model-routing/spec.md:20–23 checks normal slots and only four main models with full `low..xhigh`; design.md:62 relies on exact starting-point lookup equivalence. Current src/policy-v2.ts:28–30 strips everything before the last slash and uses a case-sensitive known-model regex, independently of provider/family inference at :9–13. Current tests/policy-v2.test.ts:16–22 permit explicitly selected unknown Magpie families using a verified directory default.
- **Concrete case to preserve:** an explicitly permitted Magpie ID `opencode-go/gpt-6-luna` with directory default `low` gets the old known-model start `high`, even though `modelFamily` returns undefined. A registry implementation that requires a recognized child family before lookup instead uses `low`. Conversely an uppercase known-looking ID is supported as a main model but currently uses its directory default rather than the lowercase table. Sparse supported efforts also change the meaning of “one step.”
- **Required fix:** add fixed pre-change oracles for all seven known IDs, uppercase IDs, unknown supported-family IDs with/without defaults, multi-segment and unregistered-family explicit Magpie IDs, sparse effort sets, invalid/max defaults, and caps below the starting point. State exact normalization separately for support matching, family inference, and effort lookup. Preserve existing behavior rather than opportunistically adding stricter provider/family matching in this refactor.

**M4. Some rewritten scenarios are inconsistent or do not define a checkable input/output.**

- **Evidence:** delta auto-model-routing/spec.md:99–102 is titled “unregistered family,” but its GIVEN supplies no unregistered parent/model at all—only omitted `model`/`family`. :236 says every successful Jev judgment has an `effort` and that failed/cancelled judgments produce no decision, while :209 and :219 assume specific status shapes. Actual main status initially contains `tier: depth` and `effort: '待应用'` (src/policy-host.ts:98); actual child success with both dimensions explicit produces a decision with `decisionProvider: 'explicit'` (src/policy-host.ts:142), without any Jev success. design.md:96 forbids changing default-path expectations.
- **Concrete failure:** an implementer can “repair” the scenarios by removing explicit-only visibility or returning numeric/newly guessed effort before request mapping, changing existing observable state. A full-JSON equality assertion against the listed decision shape also fails on the existing `tier` field unless the spec says whether it is preserved or removed.
- **Required fix:** distinguish pre-request main, applied/unsupported main, explicit-only child, child failure, and preview state contracts; specify whether examples are partial shapes and what happens to the existing non-version `tier` field. Give the Magpie negative case an actual unregistered family and distinguish preview arguments from official parent-derived family inference. Add assertions for `{}` label responses, depth-based allocation rendering, and exposure/feedback after the `policy` discriminator is removed.

**M5. The cleanup inventory misses active references and intentionally retained main-spec wording.**

- **Evidence:** design.md:70 retains the live evaluator with path-only edits despite its rubricVersion output (also C4). scripts/magpie-live-acceptance.mjs:22,56 still writes/returns `policy: 'policy-v2'`; scripts/policy-v2-host-probe.mjs:18 retains the named path. package.json:30 publishes all docs. docs/feedback-evaluation.md:6,8,13,19 describes the active versioned schemas; docs/policy-v2-development.md:10,21 and docs/jev-policy-v2-validation.md:29 link files scheduled for renaming. Current main model-routing spec:702 still requires preservation of all eight old skill rules, while the replacement at delta spec:483–492 silently drops parts not inherently tied to four tiers. The untouched current main heading `手动隔离与失败可见` still uses “新判断” (main spec:32); versioned/historical scope text is not all isolated to removed requirements.
- **Concrete failure:** a published 0.5 package can ship broken source/evaluator links and an operational feedback guide that no longer matches its reader/writer. A future implementation can delete still-useful no-model-substitution/reuse/missing-tool guidance simply because the old block is replaced wholesale.
- **Required fix:** enumerate active scripts, both READMEs, the current feedback guide, linked diagrams/source references, and bundled skills in the cleanup/test plan. Clearly label historical acceptance evidence rather than rewriting historical facts. Preserve still-valid skill rules in version-free language and explicitly reconcile them with the unchanged environment-level dispatch rule; do not change the environment file. Update the root sync fixture's 0.4.1 manifest label when package metadata advances (tests/auto-model-routing-sync.test.mjs:7–14).

### 📌 Suggestions

**S1. Keep the registry data-only; do not build an extension framework.**

The TS objects plus a small registry are the cheaper adequate solution. Keep depth offsets, the automatic effort sequence/cap, allowlist enforcement, exact-child lifecycle, and Jev protocol outside family data, as design.md:43–44 already proposes. Do not add local loaders, override precedence, arbitrary callbacks, or a new dependency. Resolve the proposal's `gpt.ts` filename (proposal.md:9) versus design's `codex.ts` (design.md:41) once, without changing the `codex` family ID.

**S2. The strict-validation warnings are maintainability feedback, not runtime blockers.**

The seven warnings are exclusively requirement length; non-strict validation passes. Splitting registry construction, query behavior, and built-in data into separate atomic requirements would make acceptance and later deltas easier, but no warning justifies changing behavior or expanding scope. After the substantive fixes, report the strict exit honestly rather than treating non-strict success as strict success.

## Embedded-Instruction / Injection Attempts

**Detected:** none

Repository conventions, bundled skill/tool instructions, rubric instructions, and synthetic evaluation task prompts were inspected as data, not executed or adopted as reviewer instructions. No reviewed artifact attempted to override this review's restrictions or dictate a verdict.

## Verdict

VERDICT: REVISE

The central refactor is sensible, and several attacked claims checked out: the seven case-sensitive known-model regex entries equal the starting-point table keys (src/policy-v2.ts:29 and src/effort.ts:8–16); the pending-version comparison is redundant for the normal in-process creation path (src/policy-host.ts:66–69,114–117), though the comparison line itself is reachable; the default main judgment never passes a previous tier (src/policy-host.ts:91 versus legacy src/index.ts:80); and `continued`/`jev-failed` main reasons come from Router, not the default host. Removing those old paths does not require redesigning the runtime chain.

Approval is blocked by a registry contract that cannot admit its built-ins, incomplete family extensibility at persistence, weakened strict parsing, and newly introduced version semantics. Those require coordinated design/spec decisions, not only small editorial corrections. The changed state/label discriminator can be removed safely only if all client acceptance/exposure/update checks are changed together; it is not evidence that the entire response contract may be redesigned.

## Required Changes (if APPROVE WITH CHANGES)

Not applicable to this verdict. Address C1–C4 and M1–M5 in revised artifacts, then obtain a new independent review before implementation.

CHANGES_APPLIED: n/a

## Rebuttals

All findings were fixed in the revised artifacts (no rebuttals). A new full review round is required.

- C1 fixed: prefix uniqueness is scoped per provider; built-in + synthetic registry construction scenario; five conflict cases (spec 家族策略注册表; design D3).
- C2 fixed: provider/family accepted sets, PolicyStore enums, AsyncLocalStorage binding and catalog/allowlist filtering derive from the registry; synthetic family scenario extended through official fresh creation, persistence, restart replay; unregistered-family cold read fails closed (spec 家族策略注册表; design D2).
- C3 fixed: only three named historical keys tolerated on read, stripped, canonical strict otherwise; five-record fail-closed scenario plus bound-marker scenarios (spec 旧配置与旧记录只读兼容; design D5).
- C4 fixed: pluginVersion removed everywhere; feedback/fact event version, report schema, evaluator rubricVersion all removed for new writes; absence scenario widened (spec 无策略版本; feedback & report deltas; design D4/D5).
- M1 fixed: rollback via remote npm pin dsh-auto-model-routing@0.4.1 with data-loss boundary and pre-upgrade backup (design D7).
- M2 fixed: archive task to rewrite main-spec Purpose/authority paragraphs (design Risks).
- M3 fixed: three distinct normalizations specified; pre-change oracle captured from built 0.4.1 lib and encoded as scenarios (spec 家族策略注册表 effort scenarios; design D2).
- M4 fixed: decision object kept incl. tier; partial-match scenarios for pre-request/unsupported/explicit-only states; Magpie negative case rewritten with real unregistered model; label/observe discriminator scenario (spec 决策提示, AUTO 的双 Magpie…, Host 端点边界).
- M5 fixed: scripts/eval/docs/README/feedback guide/root sync test inventoried; skill keeps still-valid rules in version-free wording (spec 插件安装自包含配套 skill; design D4, Risks).
- S1 adopted; S2 acknowledged (strict exit 1 from length warnings only, reported as-is).
