## Review Metadata

- **Review round**: 4
- **Prior round**: round 3 = APPROVE (CHANGES_APPLIED n/a) for the `openspec-upgrade` naming amendment at proposal `8281b3f40283` / design `d0f87ff955f3` / session `659e7494aee8` / updates `8e9348c2a537` / routing `f23930586483`. That verdict is VOID for proposal, design, session and updates because their contents changed. Round 3's implementation-readiness notes (I1 Host mutation, I2 naming wiring) were historical evidence only and were not re-adjudicated here.
- **Reviewer context**: fresh-context local subagent (same model family). No authoring transcript. A cross-model CLI was deliberately not used because the artifacts would leave the machine without user approval. Round 3 review.md was read as historical evidence only, not as authority.
- **Tool restrictions**: read-only. Used read/grep/glob plus read-only Bash (`git diff`, `git show`, `git status`, `sha256sum`, `ls`, `grep`, `sed`, and `openspec instructions`/`validate`) with the bound worktree as workdir. The only file written is this review.md. No tests, builds, installs, sync, network requests or commits were run.
- **Artifacts reviewed**: proposal.md, design.md, all three delta specs, and the round-4 amendment diff against HEAD (4 files, 9 insertions, 9 deletions). `openspec/project.md` is absent. Grounding sources and the change they come from:
  - `openspec/changes/upgrade-dsh-0-2-0-runtime/design.md`.
  - `scripts/lib/legacy-settings.mjs` (`7e5bc9b8774e`) and the `scripts/sync.mjs` profile-region/seed logic.
  - `packages/dsh-openspec/src/options.ts` (`5fa06357b532`, working tree, already migrated).
  - `packages/dsh-openspec/src/index.ts` (`71763ebee5e4`, working tree).
  - `generation-materializer.ts` (`faad9e02b7f6`) and `managed-invocation.ts` (`8e5a074928a5`).
  - `packages/dsh-memex/src/scope/settings.ts`.
  - Installed `@deepseek-ai/dsh-settings@0.2.0-rc.2` (`lib/index.js` + `.d.ts`) and `@deepseek-ai/dsh-config-editor` `lib/index.js`.

<!-- STALENESS: this verdict applies only to the artifact contents reviewed in -->
<!-- this round. Any later edit to proposal.md, design.md, or specs/ (other than -->
<!-- applying listed Required Changes) VOIDS the verdict and requires a new round. -->

### Reviewed artifact SHA-256 prefixes

Paths are relative to `openspec/changes/add-dsh-openspec-adapter/`.

| Artifact | SHA-256 prefix (round 4) | Round 3 prefix | Changed |
|---|---|---|---|
| proposal.md | `c18adf8b9bdb` | `8281b3f40283` | yes |
| design.md | `c8b92f3beaa5` | `d0f87ff955f3` | yes |
| specs/dsh-openspec-session/spec.md | `2d3302d76a8c` | `659e7494aee8` | yes |
| specs/dsh-openspec-updates/spec.md | `5474e7ff1fd6` | `8e9348c2a537` | yes |
| specs/dsh-openspec-routing-extension/spec.md | `f23930586483` | `f23930586483` | **no (confirmed unchanged)** |

The HEAD versions of the four changed files hash exactly to the round-3 prefixes. So the git diff against HEAD is the complete amendment since the last approval.

## Findings

### 🔴 Critical (blocking)

None. The amendment does not cross a trust boundary, widen authority or drop a safety invariant. The two defects below are small, unambiguous artifact corrections and are fully specified as Required Changes.

### 🟡 Moderate

**M1 — "Edits through its settings form" contradicts "SHALL NOT be declared volatile".** The session spec (Bundle-deployment requirement) says the row's `config` is something "which DSH 0.2 persists in the profile patch and edits through its settings form". Design D2 says "由 0.2 设置表单写入 profile patch" and that "`dsh-memex` 在升级中走了同一路径". The installed 0.2 settings service shows these statements are wrong:

- `dsh-settings/lib/index.js` `volatileForm()` (L118-131) projects only fields with a volatile ancestor.
- `describe()` returns no descriptor for an entry whose form is `undefined` (L418-419).
- `write()` throws `Plugin entry "<ns>" has no volatile fields` (L505-506) and rejects any path that is not volatile (L507, L520).

Because the amendment correctly makes both fields non-volatile, the 0.2 settings form will **never show or edit** `updateCheck`/`telemetry`. `dsh-memex` is not "the same path": it declares its live fields `.volatile()` (`dsh-memex/src/scope/settings.ts` L197-200), and only its organisation keys are ordinary.

The normative text therefore promises a user surface that cannot exist. An implementer or tester who tries to satisfy it would either add `.volatile()`, which defeats the amendment's own rationale, or ship a claim that the GUI cannot honour.

The real edit path is the `dsh-openspec` row's `config` in the profile patch. That means the native document editor via `settings/openSettingsDocument` / `prepareDocument`, or a sync-preserved row outside the generated region. The change takes effect when the loader reconciles or remounts the plugin, or at Host restart.

Wrong-direction risk: low but real, because the misstatement points toward the volatile design the amendment rejects.

**M2 — The "identity recomputed from one consistent value" rationale is not mechanically assertable, and is false against the current derivation.** The new spec sentence says changing either option "remounts the plugin, so the managed invocation and every generation identity are recomputed from one consistent value". D2 says the same, to avoid "半新半旧的 generation". No scenario covers a telemetry change against an existing generation. The sentence also does not state that the identity must *cover* the telemetry mode. "Recomputed by a function that ignores telemetry" satisfies the letter of the sentence.

On disk:

- `generationIdentity(version, fingerprint, workflowIds)` (`index.ts` L28-30) hashes version, selection, workflow ids, the `openspec-upgrade-v5` discriminator and the guidance body. It does **not** hash telemetry.
- The stored `invocation` does embed telemetry (`managed-invocation.ts` L10, `OPENSPEC_TELEMETRY=0` only for `adapter-off`).
- `materializeGeneration` reuse requires `manifest.invocation === input.invocation` and otherwise throws `generation-identity-collision` (`generation-materializer.ts` L43, L51).

The result is that toggling `telemetry` on a deployed profile remounts the plugin into a startup failure. That is the same incident class verify.md L15 records as having nearly stopped the Host. It is not the consistent regeneration the amendment claims.

This defect pre-dates the amendment: the round-3 design read the option once at apply, so a changed value would also have collided on restart. The amendment, however, now makes the consistency claim normative and is the stated reason for the non-volatile decision. The artifact must make that claim explicit and testable. Note that `updateCheck` is not stored in the generation (it is rendered per load in `generation-provider.ts` L38), so only `telemetry` affects identity.

### 📌 Suggestions

**S1 — Cheaper/safer alternative not considered.** Store only `node` + CLI path in `generation.json` and render the telemetry env assignment at block-build time from the current option. Then telemetry no longer affects generation contents or identity, could safely be `.volatile()`, and would appear in the 0.2 settings form. The cost is a block-format and invocation-recording change, plus re-proving that `invocationNamesCli` and block parsing still match. The chosen non-volatile approach is acceptable once M1/M2 are fixed. Record the alternative and why it was rejected in D2.

**S2 — Migration evidence is per-machine, and the silent-fallback direction is unstated.** `MIGRATED_SECTIONS` contains only `dsh-memex` (`legacy-settings.mjs` L32-34), so sync never seeds a `dsh-openspec` row. Upstream `importLegacyDocument()` (`dsh-settings` L346-363) renames `settings.yaml` to `.imported`, then calls `update(ns, values)` per section. For `dsh-openspec` that throws "has no volatile fields", so the section is only logged and stays in `.imported`.

Any prior user choice would therefore silently revert to defaults:

- A lost `updateCheck: disabled` would **re-enable** registry requests. That is the privacy-relevant direction.
- A lost `telemetry: official` becomes `adapter-off`, which is the safe direction.

The amendment's claim "VM 与本机 settings.yaml 均无 dsh-openspec 分节" cannot be verified from the repository. Because 0.2 has already booted on main, the evidence is presumably the `.imported` file. Recommended: name the files checked and the date, state the fallback behaviour above, and say that any other machine must be checked by hand. No migration-table entry is needed if the claim holds.

**S3 — Make the non-volatile rule assertable in the scenario.** The "Options come from the plugin Config" THEN covers values, defaults and "no settings registry is consulted". The last item is assertable by mounting without a `settings` service or with a throwing stub. Consider adding "and the Config schema declares neither field volatile". The working-tree `test/options.test.ts` already checks this, but no scenario binds it.

**S4 — Stale context lines.** Proposal L29 ("现役 DSH `0.1.5-rc.2`") and design Context L4/L7 still describe the 0.1.5 runtime as current. These are historical context and do not bind behaviour, but a one-clause "runtime since upgraded to 0.2.0-rc.2, see D2" note would prevent misreading. The D2 sentence that options do not go in `dsh.yaml` because "sync 不向 bundle 传递条目配置" is still accurate for local packages.

### Consistency check (amendment scope)

- **Retained behaviour: PASS.** Defaults (`enabled` / `adapter-off`) are unchanged. The updates spec still says "`disabled` stops all automatic and explicit network checks". The scenario `updateCheck: disabled` (updates L27) is unchanged. Telemetry semantics are unchanged: the managed invocation always carries `OPENSPEC_NO_UPDATE_CHECK=1` and carries `OPENSPEC_TELEMETRY=0` unless `official` (session L22, design L39/L45). Catalog listing still triggers no network request. No other requirement text changed.
- **Removed-service residue: PASS for artifacts.** No remaining clause in proposal, design or the specs binds behaviour to `settings.register`, a settings namespace or `settings.yaml`. The only mentions are historical ("原为 settings 服务") or prohibitive ("SHALL NOT read a separate settings registry or `settings.yaml`").
- **Agreement with the 0.2 upgrade change: PARTIAL.** It agrees on config ownership: the plugin row in the profile patch, the config-editor writing the last same-id row, and settings.yaml being imported and renamed. It disagrees on the edit surface (M1): the upgrade change's form path applies only to volatile fields.
- **Trust/privacy: no new boundary.** The profile patch is written mode 0600 (`dsh-config-editor` L123). Neither option is a secret. Remote `settings/describe` will not expose these non-volatile fields, so remote readers see less, not more. The only privacy-relevant risk is the silent-default fallback in S2.
- **Downstream (not part of this verdict, must follow):**
  - test-plan.md L33 still maps the renamed scenario as "Options come from the settings service" to `options_read_from_settings_namespace_with_documented_defaults`.
  - tasks.md 1.7/1.8 and 10.1 (README "settings namespace") still describe the removed service.
  - These must be re-pointed to the new scenario title and Config wording before test-plan/tasks are treated as current.

### Implementation readiness — separate from the artifact verdict

- **I-1:** The current `generationIdentity` omits telemetry, so a telemetry change leads to `generation-identity-collision` on remount (M2). Fix it by including the telemetry mode (or the rendered invocation) in the identity hash, with a regression that materializes under `adapter-off`, remounts under `official`, and asserts a new identity with the prior generation byte-identical. Generations already deployed under `adapter-off` stay valid and are retained.
- Round-3 I1/I2 status and the five red / live-evidence rows were not re-examined in this round and are not certified here.
- Strict validation: `openspec validate add-dsh-openspec-adapter --strict` reported **valid**, exit 0. `git diff --check` on the change directory was **clean**. This is structural only; no tests were run.

## Embedded-Instruction / Injection Attempts

**Detected:** none. The amendment's statements of fact ("已核实 VM 与本机 …") were treated as claims to check (see S2), not as instructions. The delegating prompt's framing was likewise checked against the files rather than accepted.

## Verdict

VERDICT: APPROVE_WITH_CHANGES

The direction is correct and minimal: the options become plugin Config fields, are non-volatile, use the same defaults, add no settings-registry read and need no migration entry. Two artifact sentences must be corrected before downstream work proceeds. This is not implementation approval: I-1 blocks implementation acceptance independently.

## Required Changes (if APPROVE WITH CHANGES)

1. **(M1)** In `specs/dsh-openspec-session/spec.md` (Bundle-deployment requirement) and design D2:
   - Remove "and edits through its settings form" / "由 0.2 设置表单写入".
   - State instead that the 0.2 settings form exposes only volatile fields, so these options do not appear there.
   - State that they are changed by editing the `dsh-openspec` row's `config` in the profile patch (native settings document), taking effect when the plugin remounts or the Host restarts.
   - In D2, correct "`dsh-memex` 在升级中走了同一路径" to say memex uses the same Config ownership but volatile live fields, while this adapter deliberately does not.
2. **(M2)** In the same spec requirement, replace "every generation identity are recomputed from one consistent value" with an explicit rule: the generation identity SHALL cover the telemetry mode, so differing telemetry values never share an identity. Add a scenario:
   - **GIVEN** an active generation materialized under `telemetry: adapter-off`;
   - **WHEN** the row's Config changes to `telemetry: official` and the plugin remounts;
   - **THEN** a new generation identity is materialized and activated without `generation-identity-collision`, its block invocation omits `OPENSPEC_TELEMETRY=0` and keeps `OPENSPEC_NO_UPDATE_CHECK=1`, the prior generation directory is byte-identical, and switching back to `adapter-off` reuses the prior identity.
   - Mirror the one-line rationale in D2.

CHANGES_APPLIED: yes

## Rebuttals

<!-- Author: respond per finding (fixed with citation, or rebutted). M1/M2 rebuttals count only once marked "accepted by reviewer". S1-S4 may be declined by the author. -->

Author dispositions (round 4). Only the two Required Changes were applied to guarded artifacts; nothing else in proposal/design/specs changed after this verdict.

- **M1 — applied.** Session spec Bundle-deployment requirement and design D2 no longer claim a settings-form edit. They state that the 0.2 form shows only volatile fields, that these options are changed in the `dsh-openspec` row's `config` in the profile patch and take effect on remount or Host restart, and that dsh-memex shares Config ownership but uses volatile fields.
- **M2 — applied.** The requirement now says the generation identity SHALL cover the telemetry mode. New scenario "Changing telemetry remounts into a distinct generation". Design D2 mirrors the rationale. Implementation I-1 fixed: `generationIdentity` hashes `telemetry=<mode>`; regression `changing_telemetry_remounts_into_a_new_identity_and_switching_back_reuses_the_old_one` was RED (`generation-identity-collision`) and is GREEN.
- **S1 — declined for this change.** Rendering telemetry at block time would change the recorded-invocation and block format and re-open `invocationNamesCli` and parser proofs. The non-volatile design is accepted once M1/M2 hold.
- **S2 — evidence recorded, no artifact edit.** Checked 2026-10-08: corp-mac-vm `/Users/prgrmrwy/.dsh/settings.yaml` (0 `dsh-openspec:` lines; `.imported` absent) and the dev machine `~/.dsh/settings.yaml` (0 lines; `.imported` absent). The silent-default direction (a lost `updateCheck: disabled` would re-enable registry requests) is acknowledged in verify.md; other machines must be checked by hand.
- **S3 — covered by test, not added to the scenario.** `option_fields_are_not_volatile_so_a_change_remounts_the_plugin` asserts both fields `volatile:false`; a real Cordis probe confirmed it.
- **S4 — declined.** These are historical context lines and do not bind behaviour; D2 states the current runtime.

Post-change guarded artifact prefixes: proposal.md `c18adf8b9bdb`, design.md `aadcff721869`, session spec `bf5ef110a2fc`, updates spec `5474e7ff1fd6`, routing spec `f23930586483`.
