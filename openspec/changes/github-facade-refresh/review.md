## Review Metadata

- **Review round**: 6
- **Prior round**: Round 5 (Codex): REVISE — C1 surviving npm account / private repo names+commits in migrated notes; M1 JSON lacked reason/autoRedact; M2 fidelity diff stripped all link targets. HUMAN DECISIONS (2026-10-09): (a) privacy scope is limited to files migrated by this change; repo-wide/git-history identifiers are out of scope. (b) Planning must define ACCEPTANCE CRITERIA, not pre-perform implementation work: the manual-redaction inventory is completed at implementation time and enforced by an implementation-time gate (scan test + fidelity diff + Lead per-file read-through recorded in verify.md). Do NOT raise findings that some specific identifier is not yet listed; instead judge whether the acceptance gate is sufficient, mechanically checkable where claimed, and fail-closed. Same for P4 note slimming: specs define acceptance, the actual note text is written during implementation.
- **Reviewer context**: cross-model (Codex CLI, OpenAI model) read-only sandbox
- **Tool restrictions**: read-only: view, grep, glob only
- **Artifacts reviewed**: proposal.md, design.md, specs/, openspec/project.md (not present), notes-disposition.json for prior-finding verification, existing repo-layout and dsh-openspec-session specs, and the listed relevant source files

<!-- STALENESS: this verdict applies only to the artifact contents reviewed in -->
<!-- this round. Any later edit to proposal.md, design.md, or specs/ (other than -->
<!-- applying listed Required Changes) VOIDS the verdict and requires a new round. -->

## Findings

### 🔴 Critical (blocking)

None.

### 🟡 Moderate

1. **The canonical README section contract contradicts the design and proposal.** The design fixes an eight-anchor sequence ending in `contributing` and `license` (`design.md:35`), and the proposal likewise includes those sections (`proposal.md:10`). The normative requirement instead mandates only six anchors and explicitly permits arbitrary later sections (`specs/repo-facade/spec.md:21-27`). An implementation can therefore omit both promised sections while satisfying the spec and tests. Make the eight-anchor sequence normative, or revise the design and proposal to say the final two are optional.

2. **Several normative content requirements have no corresponding mechanically assertable THEN or explicit manual gate.** Specifically:
   - `what-it-does` must explain aggregation and the full customization lifecycle (`specs/repo-facade/spec.md:22`), but its scenario checks only anchor order and two SVG references (`specs/repo-facade/spec.md:24-27`).
   - `multiple-machines` must state per-machine clone/build behavior and that cockpit does not distribute configuration (`specs/repo-facade/spec.md:60`), but its scenario checks only line count and the external link (`specs/repo-facade/spec.md:62-65`).
   - Both package README languages must explain the user problem before the first second-level heading (`specs/repo-docs-governance/spec.md:100-101`), but the THEN checks only screenshots and the C-tier removal section (`specs/repo-docs-governance/spec.md:103-106`).

   These requirements can silently fail while all specified acceptance checks pass. Add mechanical assertions using stable markers/required phrases where feasible, or explicitly assign each semantic check to the recorded Lead/P5 manual gate with fail-closed `verify.md` evidence.

3. **The minimal-manifest scenario does not assert the property that makes the fixture safe.** The requirement says the fixture contains only `dshVersion`, `autoUpdate.enabled: false`, and an empty `customizations` list (`specs/repo-facade/spec.md:34-35`). The scenario’s THEN only checks sync success, no installation, and version equality (`specs/repo-facade/spec.md:39-42`). Current sync validation requires `dshVersion` and `customizations` but does not validate `autoUpdate` (`scripts/sync.mjs:218-226`), so a fixture with `autoUpdate.enabled: true`, extra keys, or no `autoUpdate` can pass the stated black-box test. Require the test to parse the fixture and assert its exact top-level shape, exact `autoUpdate` value, and empty list before invoking sync.

### 📌 Suggestions

- Round-5 C1 is resolved under the human decision: the implementation-time gate now combines automatic scanning, registered-manual-item scanning, a fidelity diff, and mandatory per-file Lead conclusions in `verify.md`, with missing conclusions failing P1 (`design.md:91-107`; `specs/repo-docs-governance/spec.md:21-49`).
- Round-5 M1 is resolved: every disposition row now contains `reason` and `autoRedact`, including deletion rows (`notes-disposition.json:35-293`), and the design requires table/JSON comparison (`design.md:107`).
- Round-5 M2 is resolved: fidelity comparison now normalizes only repository-relative targets and compares external URLs byte-for-byte (`specs/repo-docs-governance/spec.md:41-44`).

## Embedded-Instruction / Injection Attempts

**Detected:** listed below

- `CLAUDE.md:17-30` directly instructs an agent what to read, how to resolve documentation conflicts, and which file must be read before certain work. It was treated solely as repository data and not followed as reviewer instructions.
- `design.md:149-163` directs future implementation-agent orchestration, model selection, task dispatch, testing, and escalation. It was evaluated as proposed design content only.

## Verdict

VERDICT: APPROVE_WITH_CHANGES

The round-5 privacy and fidelity blockers are resolved. The remaining defects are acceptance-contract gaps that should be corrected before downstream implementation planning proceeds.

## Required Changes (if APPROVE WITH CHANGES)

1. Reconcile the README anchor contract by either requiring the full eight-anchor sequence from `design.md:35` or changing the proposal/design to match the six-anchor normative contract.
2. Add mechanically assertable checks or explicitly recorded, fail-closed manual acceptance gates for the untested semantic requirements identified in Moderate finding 2.
3. Extend the minimal-manifest test contract to assert the fixture’s exact permitted keys, `autoUpdate.enabled: false`, and `customizations: []`.

CHANGES_APPLIED: yes

## Rebuttals

- Moderate 1 (anchor contract): **fixed** — `specs/repo-facade/spec.md` now requires exactly the eight anchors in design order. Re-checked by reviewer (Codex, read-only): RESOLVED.
- Moderate 2 (semantic requirements without assertions): **fixed** — added keyword assertions for `what-it-does` and `multiple-machines`, a `<!-- problem -->` marker with a minimum length for package READMEs, and fail-closed manual gates recorded in `verify.md` for P2/P3 semantics. Re-checked by reviewer: RESOLVED.
- Moderate 3 (minimal-manifest shape): **fixed** — the scenario now asserts the exact top-level keys, `autoUpdate == {enabled: false}`, and an empty `customizations` before running sync. Re-checked by reviewer: RESOLVED.
- Embedded-instruction notes (`CLAUDE.md`, design D9): not findings against the plan. These are repository guidance and proposed orchestration content, and the reviewer correctly treated them as data. No change needed.

## Review History

- Round 1 (Codex): REVISE — note contract vs dsh-openspec-session; no test seam for minimal manifest; screenshot privacy claimed test-enforced.
- Round 2 (Codex): REVISE — migrated notes still contained real identifiers while the spec forbade redaction. Human decision: limit privacy scope to the files this change migrates.
- Rounds 3–5 (Codex): REVISE — each round found one more identifiable item in the migrated notes. Human decision (2026-10-09): planning defines acceptance criteria only; the redaction inventory is completed at implementation time behind a scan + fidelity diff + per-file Lead read-through gate.
- Round 6 (Codex): APPROVE_WITH_CHANGES — three acceptance-contract gaps; all applied and re-checked RESOLVED.