<!-- Phases P1–P5 are the acceptance stages from design D9. Each phase: Lead dispatches → teammate delivers → Lead accepts against the listed test-plan rows + manual gates; ≤5 rounds per phase, then escalate to the user. Lead commits once per accepted phase on the ws/ branch. Full `npm test` / sync are run only by the Lead. -->

## 1. P1 · Shared test helpers

- [x] 1.1 Write `tests/helpers/markdown.mjs` (section anchors, fence/inline-code stripping, link extraction + resolution, CJK ratio, `git ls-files`) together with unit tests for each helper on fixture strings
- [x] 1.2 Run the helper unit tests; confirm they pass

## 2. P1 · Agent entry, root leftovers, stray dependency

- [x] 2.1 Write failing tests: RDG `AGENTS.md is a symlink whose blob is exactly CLAUDE.md`, RDG `wrong-case symlink target is reported`; TA `rejects root debug screenshot and generated architecture note` (assert they fail on the current tree for the stated reason)
- [x] 2.2 Implement: repoint `AGENTS.md` → `CLAUDE.md`; delete `.cdp-scratch-shot.png` and `worktree-session-architecture.md`; add both to `artifactPolicyViolations` forbidden list
- [x] 2.3 `ws promote`, then remove the stray `"2"` dependency from root `package.json` and `package-lock.json` (`npm uninstall 2`); confirm `npm ci` and the full suite stay green
- [x] 2.4 Refactor; full suite stays green

## 3. P1 · docs admission whitelist

- [x] 3.1 Write failing tests: TA `rejects tracked docs outside the whitelist`; RDG `tracked docs live only in adr/architecture/assets and architecture docs are linked from entry docs`; RDG `docs/assets has no orphan files`
- [x] 3.2 Implement: whitelist rule in `scripts/check-tracked-artifacts.mjs` (only `docs/adr/`, `docs/architecture/`, `docs/assets/`)
- [x] 3.3 Refactor; tests from 3.1 stay red only because `docs/notes/` still exists (expected until group 4)

## 4. P1 · docs/notes migration and redaction

- [x] 4.1 Write failing tests: RDG `notes migration matches notes-disposition.json and design table`; RDG `each migrated note h1 appears exactly once at its target`; RDG `migrated targets contain no redaction-rule matches or registered manual items`
- [x] 4.2 Write `scripts/maintenance/notes-migration-diff.mjs <base>` plus RDG fixture test `notes-migration-diff flags an unregistered body edit`
- [x] 4.3 Implement: migrate all 25 files per `notes-disposition.json`. Apply automatic redaction rules to every non-deleted file, register each additional identifiable item found during migration in `manualRedactions`, rewrite the two `move-rewrite` files as current-mechanism docs under `docs/architecture/`, and add the two BACKLOG defect entries
- [x] 4.4 Run `node scripts/maintenance/notes-migration-diff.mjs <base>`; confirm the only residual diffs are registered manual items; record command, `<base>`, and output in `verify.md`
- [x] 4.5 Lead manual gate: read through every non-deleted migrated file against the privacy checklist; record a per-file conclusion in `verify.md` (missing conclusion = P1 not passed)
- [x] 4.6 Refactor; groups 3–4 tests green

## 5. P1 · stale references and entry docs

- [x] 5.1 Write failing tests: RDG `every repo-relative markdown link resolves to a tracked path`; RDG `broken relative link is reported with file, line, target`; RDG `no tracked text file outside archive mentions docs/notes/`
- [x] 5.2 Implement: update every `docs/notes/` reference (CLAUDE.md, CONTRIBUTING.md, `.gitignore` → `*.local.md`, `.env.local.example`, ADR-0006, in-progress changes, `dsh.yaml`, source comments in `packages/dsh-pet` / `packages/dsh-memex`, issue template, BACKLOG); update the CLAUDE.md reading order to point at `docs/architecture/`
- [x] 5.3 Implement: prune landed BACKLOG entries (Lead lists borderline entries for user confirmation first)
- [x] 5.4 Refactor; full suite and `npm run check:artifacts` green → **P1 phase acceptance + commit**

## 6. P2 · Facade diagrams

- [x] 6.1 Write failing test: TA `requires both facade diagrams with their sources`
- [x] 6.2 Implement: archify showcase architecture diagram (add private overlay + `thirdPartyResources`) and new lifecycle diagram; commit JSON + dual SVG for each; add the lifecycle pair to `REQUIRED_TRACKED_PATHS`
- [x] 6.3 Refactor; `archify validate --quality showcase` passes for both; suite green

## 7. P2 · Root README pair

- [x] 7.1 Write failing tests (RF): `root README pair is tracked, cross-linked, and anchor sequences match`; `anchor sequence mismatch reports first differing position`; `h2 without section anchor is reported with its line`; `both READMEs have exactly the eight anchors in order with diagrams and lifecycle vocabulary`; `missing required anchor is named`
- [x] 7.2 Write failing tests (RF): `minimal-manifest fixture has exact shape and black-box sync accepts it with no installs`; `minimal-manifest dshVersion equals root dsh.yaml dshVersion`; `agent-install-prompt contains all six rule tags in both READMEs`; `every dsh subcommand mentioned in READMEs exists in bin/dsh case arms`
- [x] 7.3 Write failing tests (RF): `multiple-machines is at most 8 lines, links dsh-cockpit, states per-machine build`; `multiple-machines over 8 lines reports the count`; `plugin index covers every enabled customization and resource with valid links and descriptions`; `unlisted enabled id is reported`; `semver in plugin index is reported with its line`
- [x] 7.4 Implement: write English `README.md` and `README.zh.md` (eight sections, three Quick Start paths, minimal-manifest fixture, agent install prompt with six rule tags, `dsh reset` caveat, cockpit routing, plugin index); delete `README.en.md`
- [x] 7.5 Lead manual gate: per-section bilingual semantic sign-off recorded in `verify.md`
- [x] 7.6 Refactor; full suite green → **P2 phase acceptance + commit**

## 8. P3 · Package tiers and README pairs

- [ ] 8.1 Write failing tests (RDG): `every tracked README.md has a cross-linked README.zh.md within language thresholds`; `README without zh pair is reported`; `cjk ratio helper flags a Chinese README.md`; `package READMEs satisfy their docTier presentation rules`; `package without ohmydsh.docTier is reported`; `A/B tier with only an SVG above first h2 is reported`
- [ ] 8.2 Write failing tests (RDG): `every README bitmap is registered in SCREENSHOTS.md and under 400 KiB`; `unregistered bitmap is reported`
- [ ] 8.3 Implement: add `ohmydsh.docTier` to every `packages/*/package.json` per design D6

## 9. P3 · Synthetic screenshots

- [ ] 9.1 Implement: isolated `DSH_HOME` + non-3080 port instance with synthetic data; capture screenshots for the 4 A-tier and 5 B-tier packages via Chrome CDP into `packages/<id>/docs/`, each ≤400 KiB; write `SCREENSHOTS.md` rows; stop the instance and remove the temp home
- [ ] 9.2 Lead manual gate: per-image privacy checklist verdict recorded in `SCREENSHOTS.md` and `verify.md`; failed images re-shot

## 10. P3 · README rewrites (parallel, one teammate per scope)

- [ ] 10.1 A-tier: `dsh-pet` README pair (problem paragraph, screenshot, existing content reorganized below the fold)
- [ ] 10.2 A-tier: `dsh-memex` README pair
- [ ] 10.3 A-tier: `worktree-session` README pair
- [ ] 10.4 A-tier: `dsh-openspec` README pair
- [ ] 10.5 B-tier: `sidebar-session-provider-icon`, `session-title-copy`, `system-clock`, `session-links`, `home-network-model-guard` README pairs
- [ ] 10.6 C-tier and the rest: `subscriptions-sandbox-shim`, `cockpit-worktree-open-shim`, `cockpit-memex-browse-shim` (with `removal` section); `packages/README`, `patches/README`, `presets/README`, `skills/README`, `packages/dsh-pet/compat/subagent/README`, `packages/sidebar-session-provider-icon/src/client/assets/README` pairs
- [ ] 10.7 Implement: community docs English-first (CONTRIBUTING with the "update README.zh.md together" rule, SECURITY, CODE_OF_CONDUCT)
- [ ] 10.8 Lead manual gate: per-package problem-statement and bilingual sign-off recorded in `verify.md`
- [ ] 10.9 Refactor; full suite and `npm run check:artifacts` green → **P3 phase acceptance + commit**

## 11. P4 · Manifest notes

- [ ] 11.1 Write failing tests (MN): `every enabled customization has a brief ≤80 and note ≤600 code points`; `oversized note is reported with id and length`; `dsh-openspec note keeps upstream/license/telemetry/credential/upgrade/removal`
- [ ] 11.2 Write `scripts/maintenance/manifest-structure-diff.mjs <base>` and failing test MN `structure-diff reports a changed version path and exits non-zero`; implement until it passes
- [ ] 11.3 Merge latest `main` into the task branch first; record `<base>` = HEAD
- [ ] 11.4 Implement: slim every `note` to source/license or change + trust surface + upgrade checkpoint + rollback; remove per-version history comments; add missing `brief`s
- [ ] 11.5 Run `node scripts/maintenance/manifest-structure-diff.mjs <base>`; confirm `structure unchanged`; record in `verify.md`
- [ ] 11.6 Implement: update `openspec/changes/upgrade-dsh-0-2-0-runtime/tasks.md` task 7.1 to follow the new note form
- [ ] 11.7 Run `node scripts/sync.mjs` twice against an isolated `DSH_HOME`; confirm the second run reports no changes
- [ ] 11.8 Refactor; full suite green → **P4 phase acceptance + commit**

## 12. P5 · Final review and closure

- [ ] 12.1 Fresh-context reviewer teammate does a read-only full review of the diff against specs and design; Lead fixes every finding
- [ ] 12.2 Run `npm test`, `npm run check:artifacts`, `openspec validate github-facade-refresh --strict`; flip every test-plan row to 🟢 or confirm its N/A check ran green
- [ ] 12.3 Write `verify.md`; request user confirmation before `scripts/ws-merge.mjs`
