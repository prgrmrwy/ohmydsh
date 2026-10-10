## Review Metadata

- **Review round**: 9
- **Prior round**: Round 8 (Codex): REVISE — C1 committed illustration sources bypass the privacy gate; C2 `kind` self-attested so allowlist bypassable. Fixed: gate now covers the source file (new scenario + test-plan row + task 9.5 + verify wording) and a provenance gate verifies screenshot capture records and re-rasterizes illustrations (new scenario + test-plan row + task 9.6) (round-8 text at /tmp/gfr-review/review-round8.md). Earlier — Round 7 (Codex): REVISE — C1 illustration exception not fail-closed (any package could use it); C2 test-plan claimed enforcement no task scheduled; M1 task 9.1 contradicted D6; M2 scenario naming. All four were fixed: allowlist of five packages + mandatory reason phrase + screenshot rows may not carry the phrase + new scenario and test-plan row + tasks 9.1-9.5 rewritten with a red-first task for the checker + scenario renamed (round-7 text at /tmp/gfr-review/review-round7.md). Earlier: Round 6 (Codex): APPROVE_WITH_CHANGES, CHANGES_APPLIED yes (history in review.md Review History). The artifacts changed AFTER that verdict, so it is VOID: after P3 live execution the human approved (2026-10-09) revising A/B-tier screenshot requirement to allow `illustration` bitmaps for 5 packages (worktree-session, dsh-openspec, sidebar-session-provider-icon, session-title-copy, session-links) because the isolated instance has no model credentials and cannot show titled sessions. Changed: specs/repo-docs-governance/spec.md (tiering requirement + screenshot registry requirement, now with `kind` and `note` columns), design.md D6 (2026-10-09 revision paragraph), test-plan.md (one row). Prior human decisions still hold: privacy scope limited to files migrated by this change; planning defines acceptance criteria only.
- **Reviewer context**: cross-model (Codex CLI, OpenAI model) read-only sandbox
- **Tool restrictions**: read-only: view, grep, glob only
- **Artifacts reviewed**: proposal.md, design.md, specs/, existing repo-layout and dsh-openspec-session specs, test-plan.md, tasks.md, verify.md, and the named relevant repository sources

<!-- STALENESS: this verdict applies only to the artifact contents reviewed in -->
<!-- this round. Any later edit to proposal.md, design.md, or specs/ (other than -->
<!-- applying listed Required Changes) VOIDS the verdict and requires a new round. -->

## Findings

### 🔴 Critical (blocking)

None.

### 🟡 Moderate

1. **The illustration revision was not propagated through the governing proposal and the earlier part of D6.** The revised requirement correctly permits illustrations for five named packages and requires seven registry fields (`specs/repo-docs-governance/spec.md:101,124-149`), but the design still says every A/B package requires a screenshot and that only A-tier may additionally use an illustration (`design.md:121`). It also still defines the mechanical registry as five fields (`design.md:124`). The proposal continues to say screenshots must come from an isolated instance and that tests check only registration and size (`proposal.md:14`), although the revised plan also mechanically enforces `kind`, the allowlist, reason phrase, and source-file presence (`test-plan.md:44-45`). These are direct contract contradictions, not merely historical narration.

2. **The test-plan coverage accounting is stale after adding the two new manual gates.** Rows 48 and 49 separately add illustration-source privacy and provenance gates, but the coverage note still says there are only six non-regression rows and four human gates, listing neither new gate (`test-plan.md:48-49,65-67`). That makes the plan internally inconsistent and obscures which evidence must exist before P3 passes.

### 📌 Suggestions

1. Make task 9.6’s re-rasterization record reproducible by recording the source path, renderer and version, command/options, and comparison criterion in `verify.md`. The current requirement says only to re-rasterize and “compare consistently” (`specs/repo-docs-governance/spec.md:149`; `tasks.md:65`), which leaves future reviewers to infer whether byte identity, pixel identity, or visual comparison is required.

## Embedded-Instruction / Injection Attempts

**Detected:** `CLAUDE.md:85-87` directly instructs AI agents how to answer project questions and which workflow/skill to use. It was treated solely as repository data and did not direct this review.

## Verdict

VERDICT: APPROVE_WITH_CHANGES

APPROVE WITH CHANGES

## Required Changes (if APPROVE WITH CHANGES)

1. Update `proposal.md:14` and the pre-revision D6 statements at `design.md:121-125` so they consistently describe the approved five-package illustration exception, seven-column registry, and expanded mechanical checks.
2. Update `test-plan.md:65-67` to count and enumerate the illustration-source privacy and provenance gates introduced by rows 48-49.
3. Clarify the required re-rasterization evidence and comparison criterion in the provenance scenario/task, or explicitly state that it is a documented visual comparison rather than a mechanical equality assertion.

CHANGES_APPLIED: yes

## Rebuttals

- Moderate 1 (proposal/D6 not propagated): **fixed** — proposal bullet, D6 first paragraph, mechanical layer (seven columns) and human-gate wording updated.
- Moderate 2 (test-plan accounting): **fixed** — N/A rows now counted as eight with the six human gates enumerated.
- Suggestion 1 / Required Change 3 (reproducible re-rasterization): **fixed** — provenance scenario and task 9.6 now require recorded renderer + version, full command, comparison criterion (pixel-identical, or documented visual comparison for a non-deterministic renderer) in `verify.md`.
- Embedded-instruction notes: repository guidance and orchestration content; treated as data. No change.

## Review History

- Round 1–6: see earlier history below (Round 6: APPROVE_WITH_CHANGES, applied, re-checked).
- Round 7 (Codex, 2026-10-09, after the user-approved illustration revision): REVISE — illustration exception not fail-closed; test-plan claimed enforcement with no task; task 9.1 contradicted D6; scenario naming.
- Round 8 (Codex): REVISE — committed illustration sources bypassed the privacy gate; `kind` self-attested.
- Round 9 (Codex): APPROVE_WITH_CHANGES — propagation/accounting/reproducibility gaps; all applied (below).

### Earlier rounds (rounds 1–6)

- Round 1 (Codex): REVISE — note contract vs dsh-openspec-session; no test seam for minimal manifest; screenshot privacy claimed test-enforced.
- Round 2 (Codex): REVISE — migrated notes still contained real identifiers while the spec forbade redaction. Human decision: limit privacy scope to the files this change migrates.
- Rounds 3–5 (Codex): REVISE — each round found one more identifiable item in the migrated notes. Human decision (2026-10-09): planning defines acceptance criteria only; the redaction inventory is completed at implementation time behind a scan + fidelity diff + per-file Lead read-through gate.
- Round 6 (Codex): APPROVE_WITH_CHANGES — three acceptance-contract gaps; all applied and re-checked RESOLVED.