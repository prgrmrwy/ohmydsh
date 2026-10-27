## Review Metadata

- **Review round**: 2
- **Prior round**: round 1 REVISE (C1–C4, M1–M5); author revised all items without rebuttal
- **Reviewer context**: cross-model (codex / gpt-6.1-sol), fresh context
- **Tool restrictions**: read-only inspection; single write to review.md
- **Artifacts reviewed**:
  - [Proposal](<openspec/changes/auto-routing-strategy-cohesion/proposal.md>)
  - [Design](<openspec/changes/auto-routing-strategy-cohesion/design.md>)
  - [Model-routing delta](<openspec/changes/auto-routing-strategy-cohesion/specs/auto-model-routing/spec.md>)
  - [Allocation-feedback delta](<openspec/changes/auto-routing-strategy-cohesion/specs/auto-allocation-feedback/spec.md>)
  - [Usage-report delta](<openspec/changes/auto-routing-strategy-cohesion/specs/auto-routing-usage-report/spec.md>)
  - [Round-1 record and author responses](<openspec/changes/auto-routing-strategy-cohesion/review-round1.md>)
  - Current main specs: [model routing](<openspec/specs/auto-model-routing/spec.md>), [allocation feedback](<openspec/specs/auto-allocation-feedback/spec.md>), [usage report](<openspec/specs/auto-routing-usage-report/spec.md>)
  - Repository conventions and deployment evidence: [AGENTS.md](<AGENTS.md>), [dsh.yaml](<dsh.yaml>), [sync implementation](<scripts/sync.mjs>), [routing sync fixture](<tests/auto-model-routing-sync.test.mjs>), [environment dispatch instructions](<instructions/dsh-home.md>)
  - Supporting package evidence: routing, host, persistence, settings, Jev, feedback, report and client source; relevant host/store/tool/report/content/label tests; both bundled skills; [package metadata](<packages/auto-model-routing/package.json>), [TypeScript configuration](<packages/auto-model-routing/tsconfig.json>), [client build configuration](<packages/auto-model-routing/tsdown.config.ts>), [English README](<packages/auto-model-routing/README.md>), [feedback guide](<packages/auto-model-routing/docs/feedback-evaluation.md>), development/validation records, and active acceptance/evaluation scripts. Specific evidence is linked below.

Inspection assumed the repository's local, single-Host deployment and standalone published package, not a newly designed multi-process service. No build, test suite, sync, archive, network call, or live model call was run. Read-only Node imports of the existing built routing module confirmed the revised effort table and all 54 built-in transport/family × capability × depth combinations against independently calculated expected routes.

The permitted strict validation command exited **1**, with **10 requirement-length warnings and no reported ERROR**. The failing exit was investigated: all ten diagnostics concern requirement text longer than 500 characters. Non-strict validation was not run in this round. Validation does not prove archive completeness, behavior equivalence, or compatibility.

## Round-1 Adjudication

- **C1 — Closed.** Provider-scoped prefix conflicts and the empty-prefix exclusivity rule replace global uniqueness; the actual built-ins plus synthetic local DeepSeek are explicitly accepted, and same-provider collisions rejected ([routing delta:4–21](<openspec/changes/auto-routing-strategy-cohesion/specs/auto-model-routing/spec.md#L4-L21>); [design:83–96](<openspec/changes/auto-routing-strategy-cohesion/design.md#L83-L96>)).
- **C2 — Closed.** Provider/family acceptance now derives from the registry through record schemas, AsyncLocalStorage, catalog filtering and preview parameters; the synthetic-family scenario reaches creation, persistence and restart replay, with an explicit removed-family failure boundary ([routing delta:6–41](<openspec/changes/auto-routing-strategy-cohesion/specs/auto-model-routing/spec.md#L6-L41>); [design:70–81](<openspec/changes/auto-routing-strategy-cohesion/design.md#L70-L81>)).
- **C3 — Closed.** Compatibility is limited to three named historical keys, followed by stripping and canonical strict validation; unknown fields, mismatched identity and damaged/missing binding evidence reject ([design:123–125](<openspec/changes/auto-routing-strategy-cohesion/design.md#L123-L125>); [routing delta:99–107](<openspec/changes/auto-routing-strategy-cohesion/specs/auto-model-routing/spec.md#L99-L107>)). This preserves the existing raw-task rejection boundary.
- **C4 — Partially closed.** New plugin-version provenance was removed, and feedback/fact markers, report schema and evaluator hashes are inventoried for removal ([design:108–110](<openspec/changes/auto-routing-strategy-cohesion/design.md#L108-L110>), [123–137](<openspec/changes/auto-routing-strategy-cohesion/design.md#L123-L137>)). However, historical snapshots can still reach public label responses with prohibited nested version keys; see R2-M1.
- **M1 — Closed.** Remote exact-artifact rollback replaces the ineffective local version-label change; restart, verification, rewritten old-child incompatibility, report/feedback loss, settings loss and a backup boundary are documented ([design:143–163](<openspec/changes/auto-routing-strategy-cohesion/design.md#L143-L163>)). The local/remote distinction agrees with [sync:1352–1378](<scripts/sync.mjs#L1352-L1378>) and [1535–1544](<scripts/sync.mjs#L1535-L1544>).
- **M2 — Closed.** The design explicitly schedules direct correction of the model-routing Purpose/authority paragraph and usage-report Purpose rather than assuming delta application changes them ([design:172](<openspec/changes/auto-routing-strategy-cohesion/design.md#L172>)). This closes the particular Purpose-merging defect; additional untouched body wording is R2-M4.
- **M3 — Closed.** Three distinct matching normalizations and fixed outputs for all seven known IDs, uppercase/unknown IDs, slash-prefixed IDs, sparse efforts, caps and invalid starts are specified ([routing delta:8–31](<openspec/changes/auto-routing-strategy-cohesion/specs/auto-model-routing/spec.md#L8-L31>); [design:62–68](<openspec/changes/auto-routing-strategy-cohesion/design.md#L62-L68>)). Read-only evaluation of the pre-change built module confirmed the listed values. Input completeness of two scenarios still needs the small correction in R2-M3.
- **M4 — Partially closed.** Existing non-version `tier`, partial object matches, pre-request/unsupported/explicit-only decision states and depth-based label/exposure handling are now explicit ([routing delta:268–298](<openspec/changes/auto-routing-strategy-cohesion/specs/auto-model-routing/spec.md#L268-L298>), [492–495](<openspec/changes/auto-routing-strategy-cohesion/specs/auto-model-routing/spec.md#L492-L495>)). The unknown-family preview scenario now uses a real unknown model, but omits the Jev depth needed to assert its effort; see R2-M3.
- **M5 — Closed.** The active scripts, evaluator, published docs, README pair, feedback guide, bundled skills and root sync fixture are inventoried; historical evidence is distinguished from current documentation, and still-valid failure/reuse/missing-tool guidance is retained without editing environment instructions ([design:98–116](<openspec/changes/auto-routing-strategy-cohesion/design.md#L98-L116>), [167–177](<openspec/changes/auto-routing-strategy-cohesion/design.md#L167-L177>); [routing delta:530–547](<openspec/changes/auto-routing-strategy-cohesion/specs/auto-model-routing/spec.md#L530-L547>)). Emitted-file cleanup is a separate newly identified omission, R2-M2.
- **S1 — Closed.** Data-only TS strategies, unchanged `codex` identity, no local loader/callback framework, and engine-owned offsets/caps are explicit; the proposal and design now both name the same strategy files ([proposal:9](<openspec/changes/auto-routing-strategy-cohesion/proposal.md#L9>); [design:39–46](<openspec/changes/auto-routing-strategy-cohesion/design.md#L39-L46>)).
- **S2 — Partially closed.** The design correctly distinguishes warning-only strict failure from success, but its current count of seven is stale: this round produced ten warnings ([design:173](<openspec/changes/auto-routing-strategy-cohesion/design.md#L173>)). See R2-S1.

## Findings

### 🔴 Critical (blocking)

None. The round-1 registry-construction, family-schema and broad-passthrough blockers have been resolved at the artifact level. This is not implementation acceptance.

### 🟡 Moderate

**R2-M1. Historical feedback snapshots still leak version keys through label responses.**

- **Evidence:** The new absence requirement covers label JSON **including nested objects** ([routing delta:64–69](<openspec/changes/auto-routing-strategy-cohesion/specs/auto-model-routing/spec.md#L64-L69>)). Historical feedback snapshots must remain readable without invented fields ([feedback delta:4–9](<openspec/changes/auto-routing-strategy-cohesion/specs/auto-allocation-feedback/spec.md#L4-L9>)). The design removes only the label response's `policy` discriminator ([design:126–136](<openspec/changes/auto-routing-strategy-cohesion/design.md#L126-L136>)). Today the endpoint spreads the complete folded binding into its response ([endpoints:43–50](<packages/auto-model-routing/src/endpoints.ts#L43-L50>)), and lookup returns a clone retaining the snapshot ([feedback:24–37](<packages/auto-model-routing/src/feedback.ts#L24-L37>)).
- **Concrete failure:** Upgrade with an existing bound reply whose snapshot contains `policyVersion` and `mappingVersion`, then query that reply or change its feedback. Removing only the top-level discriminator still returns both retired keys inside `snapshot`. The newly written label response violates the no-version contract. The absence scenario currently exercises only a newly created binding, so it misses this case.
- **Smallest fix:** Keep historical ledger reads and stored snapshots unchanged, but explicitly project label responses to a version-free public shape. Exclude retired snapshot keys without backfilling `strategy` on historical records. Add an old-binding query/change/revoke scenario that checks the nested response, new event rows, unchanged original snapshot and preserved feedback/exposure semantics. Do not solve this by stripping provenance from the internal reader used for historical report grouping.
- **If skipped:** Upgrade behavior depends on the age of the reply: new replies satisfy the headline removal requirement while old replies keep exposing the removed API concepts.

**R2-M2. The existing build leaves deleted and renamed modules in the published package.**

- **Evidence:** The change deletes the legacy router/recorder and renames the routing/rubric modules ([proposal:11–14](<openspec/changes/auto-routing-strategy-cohesion/proposal.md#L11-L14>); [design:100–111](<openspec/changes/auto-routing-strategy-cohesion/design.md#L100-L111>)). The build is `tsc -p tsconfig.json && tsdown`, and the entire output directory is published ([package metadata:22–32](<packages/auto-model-routing/package.json#L22-L32>), [48–53](<packages/auto-model-routing/package.json#L48-L53>)). TypeScript emits into the existing output directory without removing orphaned files ([TypeScript configuration:7–16](<packages/auto-model-routing/tsconfig.json#L7-L16>)); the second build stage explicitly uses `clean: false` ([client build configuration:4–9](<packages/auto-model-routing/tsdown.config.ts#L4-L9>)). Pre-change emitted modules are present in this checkout.
- **Concrete failure:** Follow the normal local-upgrade build from this checkout after deleting the legacy sources. The old emitted router/recorder and version-named routing/rubric files remain in the output directory and therefore in the npm artifact. The renamed rubric also overwrites the old rubric's destination, so a surviving legacy module may now consume an incompatible rule shape. Fresh-clone builds do not expose this difference.
- **Smallest fix:** Add a fixed-output-directory cleanup **before TypeScript emission** to the package build; retain the client bundler's non-cleaning behavior so it does not delete the newly emitted Host modules. Add a dirty-output build/pack acceptance case: begin with the pre-change outputs, build, then verify the tarball lacks the retired emitted router/recorder and old version-named routing/rubric modules while retaining all declared Host/Web/report entries.
- **If skipped:** The published bytes do not match the claimed deletion, and package contents differ depending on whether the builder had an older output tree. Source-only absence scans cannot detect it.

**R2-M3. Two equivalence scenarios omit inputs that determine their asserted effort.**

- **Evidence:** The unknown Magpie-family preview scenario specifies supported efforts and a directory default but no Jev depth, then unconditionally expects `high` ([routing delta:131–134](<openspec/changes/auto-routing-strategy-cohesion/specs/auto-model-routing/spec.md#L131-L134>)). The effort-boundary scenario supplies no general supported-effort fixture for the Luna cases ([routing delta:28–31](<openspec/changes/auto-routing-strategy-cohesion/specs/auto-model-routing/spec.md#L28-L31>)). The existing calculation moves within the supported sequence and requires the start itself to be supported ([routing implementation:27–40](<packages/auto-model-routing/src/policy-v2.ts#L27-L40>)).
- **Concrete counterexample:** For the exact `opencode-go/kimi-k3` entry in the preview scenario, the pre-change implementation returns `low` for depth `lower`, and `high` for `baseline` or `higher`. All three responses are legitimate under the current GIVEN. Likewise, Luna baseline with cap `medium` returns `medium` when all automatic efforts are supported, but rejects when the supported set lacks its `high` start. Both behaviors were confirmed by reading/calculating against the existing built module; no live judgment was used.
- **Smallest fix:** State that the two model-only preview calls receive Jev depth `baseline`; the fully explicit calls make no Jev request. Assert two Jev requests across the four calls. For the boundary table, state a default supported set `[low, medium, high, xhigh, max]` and cap `xhigh`, overridden only where an individual case supplies a set or cap. Preserve the listed outputs and the existing algorithm.
- **If skipped:** A correct implementation can fail acceptance depending on an unstated fixture, or an implementer can hard-code baseline behavior to satisfy a false universal oracle.

**R2-M4. Requirement merging still leaves active version-named usage-report behavior in the main spec body.**

- **Evidence:** The usage-report delta modifies output, association and grouping only ([usage-report delta](<openspec/changes/auto-routing-strategy-cohesion/specs/auto-routing-usage-report/spec.md>)). The untouched current requirements still define coverage as sessions with `policy-v2` records and before-AUTO positioning using `legacy` versus `policy-v2` ([main usage spec:106–135](<openspec/specs/auto-routing-usage-report/spec.md#L106-L135>)). The design's direct-edit instruction addresses the Purpose, not these surviving requirements ([design:172](<openspec/changes/auto-routing-strategy-cohesion/design.md#L172>)).
- **Concrete failure:** Apply the delta and perform the promised Purpose correction. A newly written version-free binding with `strategy: "claude"` is not literally a `policy-v2` record, yet the remaining coverage requirement and reference scenario use that category to decide eligibility. A literal implementation can count new allocation calls but omit their coverage/reference baseline; another must rely on an unstated alias to preserve today's result. The archive also retains active version naming despite the owner's explicit scope.
- **Smallest fix:** Add MODIFIED blocks for `覆盖与可见性` and `前后 effort 起点参照`, preserving all numerical expectations, filters and boundary rules. Replace the current-format category with “allocation-feedback bindings, historical or version-free”; describe the older judgement ledger as historical four-tier data used only for locating the first AUTO turn. Include a version-free binding fixture proving unchanged coverage and reference results, plus the existing mixed historical-ledger boundary case. Historical version strings remain confined to the explicitly defined historical grouping compatibility, not a live format discriminator.
- **If skipped:** The merged normative body contradicts the new record model even after the round-1 Purpose fix.

### 📌 Suggestions

**R2-S1. Refresh the strict-validation record rather than carrying forward seven warnings.**

[Design:173](<openspec/changes/auto-routing-strategy-cohesion/design.md#L173>) says seven; the permitted command now reports ten, all length warnings. Update that count or avoid a hard-coded count. Splitting the long registry/compatibility requirements is optional maintainability work, not a reason to change behavior or declare a successful strict exit.

**R2-S2. Add the two missing constructor rejection fixtures.**

The constructor contract requires globally unique effort keys and all three capability slots, but the five negative construction cases do not exercise those branches ([routing delta:4–21](<openspec/changes/auto-routing-strategy-cohesion/specs/auto-model-routing/spec.md#L4-L21>)). Add one otherwise valid synthetic strategy that repeats an existing effort key and one missing `frontier`; both should fail before any registry is returned. This is a small test-plan addition, not a request for a runtime extension framework.

## Embedded-Instruction / Injection Attempts

**Detected:** none

Repository instructions, bundled skill directives, evaluator comments and synthetic task prompts were treated as inspected data. They were not used to authorize builds, paid calls, additional writes, or a predetermined verdict. No reviewed artifact attempted to override the review restrictions.

## Verdict

VERDICT: APPROVE_WITH_CHANGES

The registry design is now coherent, and the principal round-1 blockers are resolved. The remaining required fixes are bounded: one public-response projection, one build-output cleanup requirement, deterministic scenario fixtures, and two existing report-requirement updates. None requires changing the routing algorithm, gates, identities, explicit constraints, fork boundary, environment instructions, or strategy architecture. Approval remains conditional on these edits; this review did not implement them.

## Required Changes (if APPROVE WITH CHANGES)

1. **R2-M1:** Amend design D5 and add a routing/feedback scenario requiring version-free label response projection for historical bindings. Keep original ledger snapshots and internal historical provenance intact; query/change/revoke responses and all newly appended events must contain no prohibited version keys. Historical `strategy` remains unknown rather than inferred.
2. **R2-M2:** Add build cleanup before TypeScript emission and a dirty-output build/pack check to the implementation/acceptance plan. Explicitly exclude the retired emitted router/recorder and old version-named routing/rubric modules from the package; retain the Host, browser and usage-report entry points. Do not make the post-TypeScript client bundler clean the shared output directory.
3. **R2-M3:** Set Jev depth `baseline` for the two model-only unknown-family preview calls and assert exactly two Jev calls for the four invocations. Give the effort-boundary table the full default supported set and cap stated above, with per-case overrides. Do not change the listed efforts or runtime calculation.
4. **R2-M4:** Add complete MODIFIED replacements for usage-report `覆盖与可见性` and `前后 effort 起点参照`. Use allocation binding terminology covering both historical and version-free rows; preserve existing counts/reference semantics and add a version-free fixture. Keep the already planned direct Purpose correction as a separate archive obligation.

CHANGES_APPLIED: yes

## Required Changes Re-check

- **R2-M1 — Verified.** Design D5:136 and routing delta:64–74 require version-free public label projection for old-binding query/change/revoke, version-free appended events, no inferred historical strategy, unchanged original snapshots, and preserved feedback/exposure and internal historical grouping.
- **R2-M2 — Verified.** Design Risks:173 requires fixed package-local output cleanup before TypeScript emission while retaining `tsdown clean: false`; routing delta:64,76–79 adds dirty-0.4.1-output build/pack exclusion of retired router/recorder and version-named modules while retaining Host, client, report and both skills.
- **R2-M3 — Verified.** Routing delta:29–31 supplies the full default supported set and xhigh cap with per-case overrides and unchanged expected outputs; :137–139 specifies baseline for both model-only previews and exactly two Jev requests across four calls, with none for fully explicit calls.
- **R2-M4 — Verified.** Usage-report delta:39–78 completely replaces both requirements using historical/version-free allocation bindings; comparison with main spec:106–135 preserves 7/17 coverage, 1-of-4 AUTO visibility, mixed-ledger turn-1 boundary, turns 1–5 before turn 6, root/model/effort filters and reference restrictions, and adds version-free equivalence fixtures; design:172 retains the separate Purpose correction.
- **R2-S1 — Verified.** Design Risks:174 removes the stale fixed warning count and preserves warning-only strict exit 1 reporting; the permitted strict command re-run exited 1 with ten requirement-length warnings and no reported ERROR.
- **R2-S2 — Verified.** Routing delta:18–21 now lists seven constructor rejection fixtures, including duplicate effort key `gpt-6-luna` and missing `frontier`, each requiring a specific error and no partial registry.

## Rebuttals

_Author responses pending._
