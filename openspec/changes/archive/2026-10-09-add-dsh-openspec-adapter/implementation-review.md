# Accumulated implementation review — FAIL (goal round 18; findings IR18-INIT/ROUTE/DIAG/GEN repaired in round 19, IR18-LIVE open)

## Range and method

Base `c9e927e5af93ee6122ff401942fc26489391c494` (recorded merged-main base), reviewed committed head `c446cb5493fc6f2b0e0e386fe2508f7d9384d11c`, plus current generation-consumption repair. Never substituted HEAD~1. Git range101files includes pre-existing unrelated memex work: that work is not adapter implementation approval. Reviewed relevant delta specs/proposal/design/review/test-plan/tasks/verify, accumulated manifest/sync/plugin-update diffs, adapter Host/commands/provider/registry/generations/closure/materializer, stage/updater/transaction and routing sources and associated tests. No reviewer subagent, no SSF state/receipt fabricated (no recorded SSF contract).

This is a failing accumulated-range audit, NOT a completed final PASS or exhaustive line-by-line attestation of all101files. OpenSpec status isComplete denotes artifact existence; authoritative apply progress is180/194,14pending, not completion.

## Closed or strengthened findings

- Prior I1 Host mutation path: current index/commands no source/npm/project mutation callbacks, only prepareSessionManagement guidance and actual session Bash helper. Helper recorded-realpath/worktree/approval gates retained. Real policy/live upgrade still unproven.
- Prior I2 naming: openspec-upgrade only, new identity discriminator, canonical notice/collision checks, old generations retained. Local regressions exist; latest branch not VM deployed.
- Official selection, actual registry invalidation, closure copy/concurrency, staged full catalog and marker checks repaired earlier. Latest source reviewed supports these bounded claims, not arbitrary future upstream compatibility.
- Real Skill model/gesture caller evidence previously added; actual CommandService/header cwd fixed round17. Real header/main-profile evidence still outstanding.
- Startup update installed version now selected generation. Metadata body timer/stream cap and expired-lock reacquisition repaired rounds13–15.
- Actual killed Linux transaction fixture + fresh-process guarded rollback proves abandoned locks survive and operator sequence works; two-file partial states separately tested. No fsync/power loss/macOS process-death proof.

## Important findings — block final acceptance

### IR18-GEN — runtime integrity absent at consumption (focused repair GREEN)

Before repair generations.load only parsed manifest; sourceHashes compared only materializer reuse. RED2: materialize a healthy fixture then deleteCLI or tamperdist; provider.get resolved body+block instead of generation-invalid. Current repair opts into recursive hash verification at generation provider get and actual project-refresh CLI boundary. Metadata/list/recovery lookups remain light. Initial all-load verification caused5existing5s timeouts (repeated full real closure hashing); moved verification to consumption instead of widening test budgets. Final package33files/132tests pass. Legacy/test lightweight manifests without sourceHashes are still supported; no general manifest-signature or hostile-owner proof claimed. Runtime check I/O performance on VM remains to measure.

### IR18-ROUTE — contract implementation materially incomplete

routing.ts:37 exported registry.dispatch is a second callback-reaching path exposed through openspec.routing service (index48), bypassing dispatcher tokens/features/candidates. routing-entry.test only enumerates dispatcher keys; it never checks registry surface for another callback path. Direct Node probe against current built JS calls registry.dispatch with forged workflow-selection token and callback returns selected. This is in-process trusted extension boundary, NOT a model/tool exploit, but violates spec single-entry contract.

routing.ts:69–120 first-stage dispatch never issues token from a formal recommendation; tests pre-issue issueFormalToken and call workflow-selection twice, rather than actual first-stage→second-stage lifecycle. same probe first-stage selected formal-workflow has no token, accepts confidence5 (no numerical result validation). Input candidates arbitrary spread fields and no32count/2KiB-byte bound; text slicing2048JS characters not2KiB and label adds bytes. Feature set lacks approved decision vocabulary. existing-change schema comes from caller context.existingChange (authority test injects it), not official discovery; Host entry cannot supply that context. Current unit green is insufficient. Need focused REDs and repair under unchanged routing spec before final review; no new provider or session surface authorized.

### IR18-DIAG — winning-provider diagnostics lack calling workspace

index149–150/commands115/manage-check13–16 call skills.list() without cwd/scope. Native registry precedence depends on caller workspace/scope; project override test only injects already-resolved summaries. Real slash diagnostics can miss same-name project winners. commands114 nodeSupported is Host process.versions.node, not caller Bash PATH node required by updates spec70; false assurance if paths differ. No direct Host spawn mutation permitted; use correctly scoped read-only resolution/guidance, no new privileged tool.

### IR18-INIT — argument validation tests do not drive slash parser

commands89 always buildInitCommand({cwd,hasOpenSpecDir}); invocation.rawInput ignored. Builder supports tools/profile/language but actual slash has no parser, so supplied unknown/metacharacter args are silently dropped rather than rejected and valid overrides ignored. Typed error naming argument required by session spec116–119. Generation fixed fields also lag refreshed surface for init handler. Needs carrier regression, not claim based on pure-builder tests.

### IR18-LIVE — missing live and deployment acceptance

9.1–9.3 cross-workspace;9.7–9.12 actual no-provider/session-kind request-header baseline;9.13–9.15 disable preservation;10.2 repeated real sync;10.3 full ledger audit remain unchecked. User repairs VM DNS; no repair confirmation, no real-session method selection and no disable consent. No deployment retry or live model operations in round18.

Source cross-profile lock location hashes checkout under process tmpdir; alternate TMPDIR values can split exclusion. Existing same-TMPDIR tests insufficient. Recovery remains conservative; no automatic source-lock deletion proposed. Actual upgrade staged npm/sync/pending-reload still lacks VM evidence. Unrelated-byte/no reference removal on disable must be proven (syncDshOpenSpecSourceRecord currently returns on disable, preserving record).

## Fresh verification

- Focused generation RED:2fail (body returned for missingCLI/tamper); GREEN15tests pass.
- Initial full implementation all-load hashing:5timeout/127pass, not hidden; focused placement repair restored suite within unchanged budgets.
- bash-55: package33files132tests pass, build/typecheck/artifacts/strict/diff pass.
- bash-54: repo263total261pass0fail2existing MCPskips.
- Routing semantic probe exit0 exposed2callback calls, missing first-stage token and confidence5 accepted. Exit0 here means reproduction completed, not contract passed.

## Disposition

FAIL: repair important routing/diagnostic/init obligations without narrowing approved artifacts; retain red live rows and explicitly downgrade false-positive routing ledger assertions. Whole-objective completion/merge/archive forbidden until all important findings and actual acceptance evidence resolved. No permission expansion inferred from this report.
