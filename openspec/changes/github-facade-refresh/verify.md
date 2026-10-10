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
