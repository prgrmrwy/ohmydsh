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
