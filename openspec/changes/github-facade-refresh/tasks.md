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

- [x] 8.1 Write failing tests (RDG): `every tracked README.md has a cross-linked README.zh.md within language thresholds`; `README without zh pair is reported`; `cjk ratio helper flags a Chinese README.md`; `package READMEs satisfy their docTier presentation rules`; `package without ohmydsh.docTier is reported`; `A/B tier with only an SVG above first h2 is reported`
- [x] 8.2 Write failing tests (RDG): `every README bitmap is registered in SCREENSHOTS.md and under 400 KiB`; `unregistered bitmap is reported`
- [x] 8.3 Implement: add `ohmydsh.docTier` to every `packages/*/package.json` per design D6

## 9. P3 · Synthetic screenshots

- [x] 9.1 Implement (screenshots, partly done 2026-10-09): `dsh-pet`, `dsh-memex`, `system-clock`, `home-network-model-guard` screenshots are delivered (kind `screenshot`); registry rows must be migrated to the new seven-column schema in 9.4
- [x] 9.2 Lead manual gate: per-image privacy checklist verdict recorded in `SCREENSHOTS.md` and `verify.md`; failed images re-shot (four screenshots already passed; illustrations pass the same gate)
- [x] 9.3 Red-first: update the RDG screenshot test and `screenshotViolations` fixtures to the seven-column schema (`file`, `kind`, `source`, `date`, `reviewer`, `verdict`, `note`) and the illustration allowlist rules; write the test `illustration allowlist, reason phrase, source file and kind values are enforced` and confirm it fails against the current five-column registries
- [x] 9.4 Implement: migrate the four existing `SCREENSHOTS.md` files to the seven-column schema; produce illustrations (archify or equivalent from a committed `.json`/`.svg` source, rasterized to png ≤400 KiB, synthetic text only) for `worktree-session`, `dsh-openspec`, `sidebar-session-provider-icon`, `session-title-copy`, `session-links` as `packages/<id>/docs/overview.png` with a same-name source file; register each with `kind=illustration` and note `isolated instance has no model credentials`
- [x] 9.5 Lead manual gate: for each illustration view the bitmap AND read the committed source file (metadata, comments, hidden layers, unrendered text) against the privacy checklist; record per-file verdicts in `verify.md` with the words 'source checked'
- [x] 9.6 Lead provenance gate: tie each `screenshot` row to the isolated-instance capture record (port, hostname masking, cleanup evidence in `verify.md`); re-rasterize each illustration's committed source with the recorded renderer/options and compare pixel-for-pixel with the committed bitmap (visual comparison only if the renderer is non-deterministic, stated in the record); write source path, renderer and version, full command, criterion and result to `verify.md`; any row whose provenance cannot be established fails P3

## 10. P3 · README rewrites (parallel, one teammate per scope)

- [x] 10.1 A-tier: `dsh-pet` README pair (problem paragraph, screenshot, existing content reorganized below the fold)
- [x] 10.2 A-tier: `dsh-memex` README pair
- [x] 10.3 A-tier: `worktree-session` README pair
- [x] 10.4 A-tier: `dsh-openspec` README pair
- [x] 10.5 B-tier: `sidebar-session-provider-icon`, `session-title-copy`, `system-clock`, `session-links`, `home-network-model-guard` README pairs
- [x] 10.6 C-tier and the rest: `subscriptions-sandbox-shim`, `cockpit-worktree-open-shim`, `cockpit-memex-browse-shim` (with `removal` section); `packages/README`, `patches/README`, `presets/README`, `skills/README`, `packages/dsh-pet/compat/subagent/README`, `packages/sidebar-session-provider-icon/src/client/assets/README` pairs
- [x] 10.7 Implement: community docs English-first (CONTRIBUTING with the "update README.zh.md together" rule, SECURITY, CODE_OF_CONDUCT)
- [x] 10.8 Lead manual gate: per-package problem-statement and bilingual sign-off recorded in `verify.md`
- [x] 10.9 Refactor; full suite and `npm run check:artifacts` green → **P3 phase acceptance + commit**

## 11. P4 · Manifest notes

- [x] 11.1 Write failing tests (MN): `every enabled customization has a brief ≤80 and note ≤600 code points`; `oversized note is reported with id and length`; `dsh-openspec note keeps upstream/license/telemetry/credential/upgrade/removal`
- [x] 11.2 Write `scripts/maintenance/manifest-structure-diff.mjs <base>` and failing test MN `structure-diff reports a changed version path and exits non-zero`; implement until it passes
- [x] 11.3 Merge latest `main` into the task branch first; record `<base>` = HEAD (main has not moved; no merge needed; `<base>` = `be87a7a7a8bd75c1fa314f469e2199d030b7907f`)
- [x] 11.4 Implement: slim every `note` to source/license or change + trust surface + upgrade checkpoint + rollback; remove per-version history comments; add missing `brief`s
- [x] 11.5 Run `node scripts/maintenance/manifest-structure-diff.mjs <base>`; confirm `structure unchanged`; record in `verify.md`
- [x] 11.6 Implement: update `openspec/changes/upgrade-dsh-0-2-0-runtime/tasks.md` task 7.1 to follow the new note form
- [x] 11.7 Run `node scripts/sync.mjs` twice against an isolated `DSH_HOME`; confirm the second run reports no changes
- [x] 11.8 Refactor; full suite green → **P4 phase acceptance + commit**

## 12. P5 · Final review and closure

- [ ] 12.1 Fresh-context reviewer teammate does a read-only full review of the diff against specs and design; Lead fixes every finding
- [ ] 12.2 Run `npm test`, `npm run check:artifacts`, `openspec validate github-facade-refresh --strict`; flip every test-plan row to 🟢 or confirm its N/A check ran green
- [ ] 12.3 Write `verify.md`; request user confirmation before `scripts/ws-merge.mjs`
