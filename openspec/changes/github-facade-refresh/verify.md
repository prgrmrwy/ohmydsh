## Manual gates and one-time acceptance evidence (in progress)

> Final Verification Results / DECISION sections are appended after P5. This section accumulates evidence per phase.

### P1 · docs/notes migration (tasks 4.4, 4.5)

- Base: `224bd52`. Command: `node scripts/maintenance/notes-migration-diff.mjs 224bd52` → exit 0, `only registered manual redactions differ: 37 registered manual occurrence(s) across 19 move file(s)`; all 19 `move` rows `ok`.
- Full suite after P1 (Lead, serial): `npm test` → 390 tests, 388 pass, 0 fail, 2 skipped (pre-existing). `npm run check:artifacts` → compliant. `git ls-files docs/notes` → empty. `AGENTS.md` mode 120000, blob `CLAUDE.md`.
- Lead privacy read-through of every non-deleted migrated file (automatic rule scan + residual-token scan for lark ids, UUID/session prefixes, home paths, devbox hosts, emails, IPs, person-name tokens, known private names; plus spot-reading redacted lines in the two live-acceptance notes and BACKLOG D007/D008):

| # | Target | Conclusion |
|---|---|---|
| 1 | archive/2026-09-18-pet-unified-locus-collaboration/checking/research-concurrency-and-queueing.md | pass (public third-party citations only) |
| 2 | …/checking/research-concurrent-write-isolation.md | pass |
| 3 | archive/2026-09-20-dsh-memex-scoped-memory/commit-attribution.md | pass |
| 5 | upgrade-dsh-0-2-0-runtime/checking/cockpit-bridge-061-deployment.md | pass after review: public repo owner account in a public release URL is kept (it is the repository owner shown in package.json) |
| 6 | archive/2026-09-22-shrink-pet-compat-to-minimal/checking/extension-point-survey.md | pass |
| 7 | docs/architecture/agent-instructions.md | pass (rewritten) |
| 8 | packages/dsh-memex/docs/integration-notes.md | pass (private repo names/commit ids replaced) |
| 9 | packages/dsh-openspec/docs/generation-identity.md | pass |
| 10 | docs/architecture/dsh-plugin-integration-pitfalls.md | pass (person and bot names replaced) |
| 12 | docs/architecture/private-overlay.md | pass (rewritten, placeholders only) |
| 13 | pet-locus-independent-agent-inquiries/checking/capability-audit.md | pass (local path replaced) |
| 14 | archive/2026-09-19-pet-locus-delivery-safety-hardening/checking/live-acceptance.md | pass (ids, member and bot names, production chat name replaced) |
| 15 | archive/2026-09-18-…/checking/host-capability-audit.md | pass |
| 16 | archive/2026-09-15-pet-locus-independent-child/handoff.md | pass |
| 17 | archive/2026-09-15-pet-locus-on-demand-tree/checking/live-acceptance.md | pass (chat ids, session prefixes replaced) |
| 18 | packages/dsh-pet/docs/locus-plan-ab-cost-analysis.md | pass |
| 19 | archive/2026-09-15-pet-locus-multi-binding/checking/spike-findings.md | pass |
| 20 | packages/dsh-pet/docs/media-download.md | pass |
| 21 | archive/2026-09-19-pet-mention-open-id-and-asker-name/notes.md | pass |
| 22 | archive/2026-09-18-…/cutover-runbook.md | pass |
| 24 | upgrade-dsh-0-2-0-runtime/checking/devbox-validation.md | pass (devbox host and proxy helper replaced) |
| 23, 25 | BACKLOG.md D007, D008 | pass (session id, worktree name containing an email replaced) |

Known out-of-scope residue (per the 2026-10-09 human scope decision), recorded for BACKLOG: identifiers elsewhere in the repository and in git history, including a truncated session prefix and an IP in older BACKLOG entries.

- BACKLOG pruned (user-approved scope 2026-10-09): removed landed U001, U002, B003, B004, B005, B006, B007, B009, B010, B013, B015, B018, B031, B032, B036; moved misfiled B022, B043, B044, B047 from 已完成 to 想法; kept boundary entries B017, B019, B026, B030, B033, B035.

### P2 · Facade (tasks 6.x, 7.5)

- Full suite after P2 (Lead, serial): `npm test` → 408 tests, 406 pass, 0 fail, 2 skipped (pre-existing). One earlier run showed a single failure in `tests/dsh-runtime-provisioning.test.mjs` ("generated asynchronous activity after the test ended", ENOENT in a staging dir). It is a pre-existing timing flake unrelated to this change: the file passed 3/3 in isolation and the full-suite rerun was green. `npm run check:artifacts` → compliant; `openspec validate --strict` → valid.
- Diagrams: archify showcase validation 9/9, 0 errors, 0 warnings for both (receipts in the teammate report: architecture spec `00c826bc…`, lifecycle spec `c4d49912…`). Lead rendered both dual SVGs in headless Chrome in light and dark and read them: text legible, no overlapping nodes or labels, edges clean. Caveat: the lifecycle "new pin" edge has a bend-heavy dashed route; accepted. `archify visual-check` fails containment for the lifecycle *HTML viewer* at three sizes; that HTML is not committed (only the dual SVG is), so it does not apply.
- Upstream URLs in the plugin index were checked against `npm view` repository/homepage metadata by the Lead: all match. `skin-center` links `zhu1090093659/dsh-skins` (npm metadata); the older manifest note says `dsh-web`; the note is slated for slimming in P4.
- Lead manual gate 7.5 — per-section bilingual semantic sign-off (README.md ↔ README.zh.md):

| Section anchor | Conclusion |
|---|---|
| what-it-does | pass — same claims, same three bullets, same two audiences; lifecycle verbs all present in both |
| quick-start | pass — three paths, minimal-manifest fixture identical, `dsh reset` caveat present, six rule tags identical and in the same order, cheat-sheet uses only real subcommands |
| architecture | pass — same sub-sections, table, layout, both diagrams, overlay and doc links |
| multiple-machines | pass — clone + `dsh build`, cockpit does not distribute configuration; 2 lines each |
| your-configuration | pass — same five bullets |
| plugins | pass — same grouping and items; capability sentences cross-checked against the packages' own READMEs and skill descriptions |
| contributing | pass |
| license | pass |

- Process note: the Lead briefly ran a stash/checkout while only meaning to re-run a test; the stash was empty and the working tree was then re-verified (anchors, SVG sizes, full suite) before commit.

### P3 · Package READMEs, bitmaps, community docs (tasks 8–10)

- Full suite after P3 (Lead, serial): `npm test` → 421 tests, 419 pass, 0 fail, 2 skipped (pre-existing). `npm run check:artifacts` → compliant. `openspec validate --strict` → valid.
- Scope change during P3 (user-approved 2026-10-09, re-reviewed through anvil rounds 7–9, see review.md): the isolated instance has no model credentials, so five packages could not be screenshotted. The tiering and screenshot-registry requirements now allow `kind=illustration` for exactly `worktree-session`, `dsh-openspec`, `sidebar-session-provider-icon`, `session-title-copy`, `session-links`. Registry is seven columns (`file`, `kind`, `source`, `date`, `reviewer`, `verdict`, `note`).
- **Screenshot provenance (task 9.6, `kind=screenshot`).** `dsh-pet`, `dsh-memex`, `system-clock`, `home-network-model-guard` were captured from an isolated DSH instance: temporary `HOME`/`XDG_*`/`DSH_HOME` under `/tmp`, port 3199 (never 3080), run under `unshare -Ur --uts` with hostname `demo-host` (the system-clock capture itself shows `DSH 主机 · demo-host`), `DSH_LOCAL_MANIFEST` pointed at a nonexistent file so no private overlay was read, headless Chrome over CDP at 1440×900. Cleanup confirmed by the teammate and re-checked by the Lead: the instance and Chrome jobs were killed, `/tmp/gfr-shots` removed, no scratch dir left in the worktree, port 3080 untouched. Known cosmetic caveat: the dsh-pet capture shows emoji glyphs as boxes (the machine has no color-emoji font and installing one needs sudo); accepted.
- **Bitmap privacy gate (task 9.2), Lead viewed every bitmap.** screenshots: dsh-pet (Settings → Pet general tab) pass; dsh-memex (Settings → 记忆; paths are `/tmp/gfr-shots/...` only) pass; system-clock pass; home-network-model-guard (Settings → 出口守卫 verdict page) pass. No real hostname, user, path, email, token or session title visible in any. The home-network-model-guard capture shows the settings page, not the disabled composer; the alt text was corrected to match.
- **Illustration source-file privacy gate and provenance (tasks 9.5, 9.6), source checked.** For each of the five illustrations the Lead read `overview.svg`: no `<metadata>`, `<image>`, `<script>`, `<foreignObject>`, `href`, hidden/`display:none`/zero-opacity elements; one leading comment each; no paths, emails, URLs, ids or tokens (grep). Text is synthetic (`demo-app`, `example.com`, `provider-a`, `session-9af69b3e-demo-0001`); no real brand logos are embedded. Re-rasterization by the Lead with the command on line 1 of each `overview.render.txt` (renderer Google Chrome 152.0.7977.64, fonts DejaVu Sans / DejaVu Sans Mono, from the repo root) was byte-identical (cmp) to the committed PNG for all five: worktree-session 126372 B, dsh-openspec 127928 B, sidebar-session-provider-icon 115253 B, session-title-copy 84773 B, session-links 117618 B. Criterion: byte identity (stricter than pixel identity). Rendering depends on the listed system fonts.

| Package | Tier | Bitmap kind | Source checked | Gate verdict |
|---|---|---|---|---|
| dsh-pet | A | screenshot | n/a | pass |
| dsh-memex | A | screenshot | n/a | pass |
| worktree-session | A | illustration | yes | pass |
| dsh-openspec | A | illustration | yes | pass |
| system-clock | B | screenshot | n/a | pass |
| home-network-model-guard | B | screenshot | n/a | pass |
| sidebar-session-provider-icon | B | illustration | yes | pass |
| session-title-copy | B | illustration | yes | pass |
| session-links | B | illustration | yes | pass |

- **Lead manual gate 10.8 — per-package problem statement and bilingual sign-off** (Lead read every `<!-- problem -->` paragraph in README.md and README.zh.md):

| Package | Conclusion |
|---|---|
| dsh-pet, dsh-memex, worktree-session, dsh-openspec | pass — states the user problem plainly; zh matches en; alt text now describes the real image |
| sidebar-session-provider-icon, session-title-copy, system-clock, session-links, home-network-model-guard | pass — same |
| subscriptions-sandbox-shim, cockpit-worktree-open-shim, cockpit-memex-browse-shim | pass — problem + `Removal` section present in both languages |

- Teammate-reported corrections accepted by the Lead: stale statements fixed in package READMEs (dsh-pet Lark channel now unified Locus; six settings tabs; own `pet-sqlite` backend; `LOCUS_WRITE_ENABLED=false`; worktree-session hooks `agent/created`; dsh-openspec options live in the profile patch `config`; bridge pin 0.6.4; presets README reflects DSH 0.2 declaration rows; guard config keys read once at load need a restart). One spec/implementation gap noted by a teammate and left for follow-up: `openspec/specs/session-links` mentions a tab badge that `src/client/index.tsx` does not register.
- Contact address `prgrmr@163.com` remains in `SECURITY.md` and `CODE_OF_CONDUCT.md` (it is the maintainer's public contact carried over from the originals; to be confirmed by the user before merge).

### P4 · Manifest notes (tasks group 11)

- Base for the one-time structure check: `be87a7a7a8bd75c1fa314f469e2199d030b7907f` (HEAD before any `dsh.yaml` edit; main had not moved, no merge needed).
- `node scripts/maintenance/manifest-structure-diff.mjs be87a7a7a8bd75c1fa314f469e2199d030b7907f` → `structure unchanged`, exit 0 (run by the teammate and again by the Lead, including after the Lead's one-word correction below).
- Diff audit by the Lead: besides `note`/`brief` values and comment lines, the only changed line in `dsh.yaml` is a trailing comment on dsh-memex's `enabled: true` (value unchanged).
- Size: `dsh.yaml` 92,336 → 33,542 bytes; comment lines 168 → 51; every `note` ≤ 535 code points (limit 600); every enabled entry has a `brief` ≤ 75 (limit 80). The dsh-openspec note keeps the six categories required by `dsh-openspec-session` (upstream, license, telemetry, credential, upgrade checkpoint, removal) and carries no version number.
- Lead read-through of all 32 notes: hard constraints preserved — subscriptions-sandbox-shim (only with `danger-full-access` + `approval: never`; disable on restricted deployments), system-clock and home-network-model-guard (loopback-only; do not add `trustedHosts`), connection-webserver (keep `config.trustedHosts` verbatim; web profile only), width-tiers (never combine the bundle patch with a hand-written wiring patch), dsh-memex (kernel pin equals generated `KERNEL_VERSION`; no cross-machine fallback to localhost; rollback to 0.2.0 needs closed switches written back), dsh-pet (compat overlay re-reviewed on every `dshVersion` change, never auto-applied), bridge/shim version pairings, and the current-pin integrity hashes (cost-meter, better-sidebar, skin-center, width-tiers, experimental-schedule, bridge tarball) now live in the note text. One correction made by the Lead: the skin-center upstream link said `dsh-web`; npm repository metadata says `dsh-skins`, so the note now links `https://github.com/zhu1090093659/dsh-skins`.
- Teammate-flagged facts accepted: cost-meter MIT license verified with `npm view` (new fact, evidence-based); the dsh-pet upstream-tracking pointer now refers to `packages/dsh-pet/compat/subagent/README.md` instead of a discussion number; the five skill entries that had no note got notes derived from their `SKILL.md` (the upgrade-checkpoint wording is the teammate's judgement).
- Full suite after P4 (Lead, serial): `npm test` → 426 tests, 424 pass, 0 fail, 2 skipped (pre-existing). `npm run check:artifacts` → compliant.
- Double sync (task 11.7), Lead, in a fully isolated environment (temporary `HOME`, `XDG_*`, `DSH_HOME` under `/tmp`, `DSH_LOCAL_MANIFEST` pointing to a nonexistent file; the real `~/.dsh` was not touched — its sync-state file kept its 07:54 timestamp): first `node scripts/sync.mjs` → exit 0, `done — 52 change(s) applied`, 0 ERROR lines; second → exit 0, `no changes — deployment already matches manifest`, 0 ERROR lines. The temporary directory was removed afterwards.
- `upgrade-dsh-0-2-0-runtime` task 7.1 wording now follows the new note form (checkbox state unchanged).

### P5 · Independent final review and fixes (tasks group 12)

- Reviewer: a fresh-context teammate (`p1-hygiene`, read-only, never changed any of the content under review) reviewed `HEAD` vs `main` (5 commits, ~165 files) against the plan. Verdict: **MERGE_AFTER_FIXES** — 1 critical, 5 moderate, 5 suggestions. No broken requirement, failing test, data loss or sync/runtime behavior change. The Lead verified each finding against the tree before fixing.
- **C1 (critical) — fixed.** `notes-disposition.json` stored the redacted literals verbatim (person and bot names, private repo names with commit ids, a production chat name, session ids, an email-derived worktree name, internal bridge/helper names), turning the file into an index of the sensitive items. Manual items are now registered as `{findSha256, length, replace}` only (SHA-256 of the UTF-8 literal and its length in code points); `notes-migration-diff.mjs` and the RDG scan match by hashing every window of that length per line. Verified: none of the literals remains in the file; `notes-migration-diff.mjs 224bd52` still reports every one of the 19 `move` rows `ok` and 35 registered occurrences; the redaction test and its fixtures were updated (fixtures use a synthetic name). The residue that exists elsewhere in the repository and in git history is out of scope by the user's decision and is now recorded as BACKLOG D009 (classes only, no literals).
- **M1 — fixed.** References to pruned BACKLOG ids (B004, B007, B013, B015, B018, B036) and to B020 (which never had an entry) were replaced by the archived change name already next to them, or dropped: `dsh.yaml` comments and notes, three package README pairs and two CHANGELOGs, ADR-0006/0007, the dsh-pet cost-analysis note. The one table-cell rewrite inside a migrated file (row 18) is registered as a `pathRewrites` item so the migration diff stays exact.
- **M2 — fixed.** The `dsh.yaml` field-convention comment now says `note` is a human summary of at most 600 code points with the review process in git and OpenSpec.
- **M3 — fixed.** The governance spec now states the one exemption explicitly: the first-line attribution `> Migrated from docs/notes/<file>.` is allowed to keep the old path.
- **M4 — fixed.** BACKLOG D009 records the out-of-scope residue.
- **M5 — fixed.** The test-plan row now carries the real test name.
- **S1 — fixed.** The row-18 recorded grep commands no longer pretend to have run against `docs/architecture/`: the neutral placeholder `<former notes directory>/` is used and registered as a path rewrite, and the disposition file says the recorded hit counts describe the original location. **S2 — fixed:** dead helper `backlogEntries()` removed. **S3 — noted:** besides removing the stray `"2"` dependency and its 53 now-unused packages, nine `node-addon-require-builtin-*` lockfile entries lost `"peer": true` (harmless npm re-resolution; `npm ci` in CI is the check). **S4 — accepted:** the system-clock capture shows the capture machine's time zone and the guard capture its egress country; both are low sensitivity. **S5:** the maintainer contact `prgrmr@163.com` in `SECURITY.md` and `CODE_OF_CONDUCT.md` awaits the user's confirmation.
- Checked and clean by the reviewer, independently of the plan: all new test files pass in isolation; helpers behave correctly and every negative fixture really fails; migration fidelity (19 move rows ok, 11 files added and 0 modified under the archive, `docs/notes` empty); `dsh.yaml` structure identical to both `be87a7a` and `main` (key order and all 32 ids); root README claims verified against `bin/dsh`, `sync.mjs`, `check-update.mjs`; architecture docs verified against the code; illustration sources free of hidden content; hygiene (AGENTS.md symlink, root clean, no stale references); CI workflow unaffected.

### Final evidence

- Final full-suite command: `npm test` (Lead, serial, after all review fixes).
- Result summary: 426 tests, 424 pass, 0 fail, 2 skipped (the same two skips as the baseline before this change). Baseline before P1 was 358 pass / 0 fail / 2 skipped.
- Non-executable checks run: `node scripts/maintenance/manifest-structure-diff.mjs be87a7a7a8bd75c1fa314f469e2199d030b7907f` → `structure unchanged` (exit 0); `node scripts/maintenance/notes-migration-diff.mjs 224bd52` → `only registered manual redactions differ: 35 registered manual occurrence(s) across 19 move file(s)`; `npm run check:artifacts` → compliant; `openspec validate github-facade-refresh --strict` → valid; isolated double sync (P4) → first `done — 52 change(s) applied`, second `no changes`.
- Test-plan ledger: every executable row is 🟢 green (40 rows flipped only after the named test appeared as passed in the logged full run); the eight non-executable rows are N/A with their evidence above.

## Review Integrity

- review.md `VERDICT: APPROVE_WITH_CHANGES` with `CHANGES_APPLIED: yes` (round 9, re-checked by the reviewer: ALL_RESOLVED). Planning artifacts changed after rounds 6 and 7 only through the user-approved illustration revision, which was re-reviewed in rounds 7–9; the later final-review edits touched implementation files, the disposition file, design/spec wording about how manual items are stored (an implementation detail of the redaction gate), the test-plan ledger and the spec exemption for the attribution line. These last small clarifications were not re-run through a separate cross-model round; they were reviewed by the independent P5 reviewer's findings that prompted them.

## Change Delivery

- Commit range: `224bd52..HEAD` on branch `ws/openspec-explore-github-0-dsh-1-quick-start-temp` (planning, P1–P4 committed; the P5 fixes are committed after this note).
- Not merged: awaiting the user's confirmation before `scripts/ws-merge.mjs`.

## Overall Decision

DECISION: PASS_WITH_WARNINGS

Warnings: (1) the maintainer contact address awaits the user's confirmation; (2) five A/B packages use illustrations instead of screenshots (approved scope change); (3) the dsh-pet screenshot shows emoji as boxes because the capture machine has no color-emoji font; (4) out-of-scope residual identifiers elsewhere in the repo and in git history are recorded in BACKLOG D009; (5) the final small spec/design wording fixes were not re-reviewed in a separate cross-model round.
