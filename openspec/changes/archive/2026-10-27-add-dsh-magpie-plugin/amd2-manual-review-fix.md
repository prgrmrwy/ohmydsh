# AMD2 independent review finding 1 — correction evidence

Status: **finding 1 corrected; pending independent recheck**. This is an author receipt, not a final review verdict or whole-change acceptance.

## Bounded correction

- [Review finding 1](<model-display-source-review.md#L15-L19>) identifies a documentation defect, not a source-routing defect.
- [AUTO delta](<specs/auto-model-routing/spec.md#L4-L14>): limited the legacy rejection clause and scenario GIVEN to **root AUTO + explicit legacy**. MANUAL still returns `{routed: false, reason: "manual"}` without judging, sending task text or writing state. Existing bound-instance replay and other approved behavior remain unchanged.
- [Test regression](<../../../packages/auto-model-routing/test/subagent-tool.test.ts#L122-L138>): two parameterized cases, one per exact Magpie transport, use a MANUAL root and an explicit-legacy settings supplier. Assert normal manual return, zero fake-Jev requests, no judgement, no settings/catalog access, zero state-store writes and unchanged state. The tool dependency surface has no selection writer; these tests do not claim a live Host selection trace.
- Existing [MANUAL early return](<../../../packages/auto-model-routing/src/subagent-tool.ts#L74-L89>) remains untouched. Tests passed directly against existing correct behavior: **spec regression**, no claimed source-failure RED history and no mutant run.

## Checks actually run (2026-10-25)

From `packages/auto-model-routing`:

- `npm test -- --run test/subagent-tool.test.ts`: **1 file / 15 tests passed**.
- `npm run typecheck`: **exit 0**, both production `--noEmit` and test TypeScript checks.
- `npm test`: **31 files / 222 tests passed**, exit 0. This is a measured run, not an extrapolation from the prior author's 220-test receipt.

From repository root:

- `OPENSPEC_TELEMETRY=0 openspec validate add-dsh-magpie-plugin --strict`: **valid**, exit 0.
- `git diff --check -- openspec/changes/add-dsh-magpie-plugin/specs/auto-model-routing/spec.md packages/auto-model-routing/test/subagent-tool.test.ts`: **exit 0**, no whitespace errors.
- Inspected scoped diffs. The test file already contained the prior owner's dual-provider AUTO regression; this correction adds only `vi` plus the MANUAL parameterized block. The delta file was already untracked; `git diff --no-index -- /dev/null ...` displayed it with expected exit 1 (differences), not a validation failure. Strict/whitespace checks were rerun independently and passed.
- Protected-file SHA-256 samples before/after matched: source tool `0256d911d15fde2d1958406be127d514f72ae3febc06291133aa8de91e90bcd1`; current AUTO spec `3e0626e95d44a8a69a6b9cf8c80fcaae7982ad48defbfada7babbfccb1ce6b0c`; independent source-review report `6cd861071908d06d4f2e6a908e01492c3784c369ba84ed90e5237ddc0b3eb126`; central review `777f08c074545e9ca0fbdce63384aa4ec7ede59501c756b8d05c7f1233a18598`.

## Boundaries

Only the AUTO delta, subagent-tool test and this lightweight receipt were written. No production/current-spec/other artifact/Host/manifest/lock edits; no delegation, commit, build/deployment, restart or credential access. Central review status lines and historical verdicts were not updated. Finding 2, GUI/wire acceptance and final independent recheck are outside this correction.
