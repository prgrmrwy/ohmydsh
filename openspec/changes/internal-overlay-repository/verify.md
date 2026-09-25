## Verify — internal-overlay-repository

### 1. Task completion

All tasks 0.1–12.2 are `- [x]`.

**12.3** was run after the merge, from the main checkout at `014609f8`, against the real profile with the machine's repo-root overlay in place. It was run there rather than in the worktree for two reasons:
- a worktree run would not see the overlay, so it would uninstall the overlay's package;
- it would re-point local `file:` specs at the worktree.

Profile `package.json`, `cordis.patch.yml`, and the ledger were backed up first.

- **Run 1:** exit 0, `done — 3 change(s) applied`. The three changes:
  - rebuild of the local package `dsh-cockpit-worktree-open-shim`;
  - reinstall of that package, whose content changed through commits merged into main alongside this change;
  - regeneration of `cordis.patch.yml`, whose only diff is the new D10 header.

  Profile `dependencies` are identical to the backup, so the overlay's package stayed installed.
- **Run 2:** exit 0, `no changes — deployment already matches manifest`.

### 2. TDD integrity

- **All planned tests exist.** Every `test-plan.md` row names a test that exists verbatim in the listed file. This was checked mechanically by a script that matched each row's test name against the file source; there were no misses.
- **All rows are green.** 38 rows are 🟢. 28 were flipped from 🔴 during this apply; 10 were existing regression guards. None are 🔴. There are no `N/A` rows.
- **Every red test failed first, for the intended reason.** Some examples:
  - missing `assertHostRuntimeSources` export
  - reset blocked by the load-stage builder check
  - build run with `cwd` = public repo ("No workspaces found")
  - overlay name reuse installed instead of rejected
  - update check never reached the scoped registry
- **Full suite passes.** No tests are skipped, pending, or commented out.
- **Tests changed, none weakened:**
  - `tests/sync-local-manifest-overlay.test.mjs` was moved onto the shared fixture. Its env-path test now places the patch next to the external overlay; that is the root semantics of design D1, not a relaxed assertion.
  - `tests/dsh-host-runtime.test.mjs` only gained a test. It asserts that declaration parsing is source-free, and that both `assertHostRuntimeSources` and Host startup (`loadDeclaredHostRuntime`, `prepareDeclaredHostRuntime`) still fail closed.
  - `external root build failure stops before install` asserts two things: no install or remove action for `q`, and no `node_modules/<q>`. It does not assert that profile `package.json` is unchanged; see warning W2.

### 3. Review integrity

- `review.md`:
  - round 4, `VERDICT: APPROVE_WITH_CHANGES`, `CHANGES_APPLIED: yes`
  - RC1 and RC2 re-checked PASS
  - M1 rebuttal ACCEPTED by the reviewer
- **Staleness (warning W1).** The mtime of `design.md` (01:48:34) is later than `review.md` (01:46:02). The other artifacts predate the review: `proposal.md` 01:36, `specs/` 01:43, `test-plan.md` 01:47. The change directory is untracked, so no history exists to prove the 01:48 edit was limited to the listed required changes. The implementation follows design D0–D10 as currently written, and `openspec validate --strict` passes. A light re-check of `design.md` is recommended before archive.

### 4. Delivery status

Committed as `2d690dd0` and merged into `main` as `014609f8` via `scripts/ws-merge.mjs`, with user approval. This ledger update (12.3) is a follow-up commit on the same branch.

**Changed files:**

- `package.json`
- `docs/notes/local-manifest-overlay.md`
- scripts:
  - `scripts/sync.mjs`
  - `scripts/plugin-list.mjs`
  - `scripts/plugin-update.mjs`
  - `scripts/lib/manifest-overlay.mjs`
  - `scripts/lib/dsh-host-runtime.mjs`
  - `scripts/lib/plugin-updates.mjs`
- modified tests:
  - `tests/sync-local-manifest-overlay.test.mjs`
  - `tests/dsh-host-runtime.test.mjs`
- new tests:
  - `tests/helpers/overlay-fixture.mjs`
  - `tests/test-isolation.test.mjs`
  - `tests/sync-overlay-root.test.mjs`
  - `tests/sync-preflight.test.mjs`
  - `tests/sync-npm-scopes.test.mjs`
  - `tests/plugin-update-overlay.test.mjs`
- `openspec/changes/internal-overlay-repository/` (all artifacts)

**Public-name hygiene.** The added diff and all untracked files were grepped for internal scope and registry names; there were no hits. The only matches repo-wide are in the already-archived `local-manifest-overlay` change on `origin/main`, which this change does not touch.

### Warnings

- **W1.** `design.md` was modified after the review verdict (see §3).
- **W2.** When a local package's build fails, the pre-existing "local package path repair" in `syncPackages` may already have written the package's `file:` spec into profile `package.json` before the build. No install or remove runs, and nothing lands in `node_modules`. This matches the spec: it requires no install or removal of `q`, not an unchanged `package.json`. The behavior predates this change and applies to public local packages too.

### Evidence

All commands were run from the worktree root on 2026-09-25:

| Command | Result |
|-|-|
| `npm test` | `tests 197 / pass 197 / fail 0`, exit 0 (baseline before this change: 157) |
| `npm run check:artifacts` | `[artifacts] tracked paths comply with repository policy`, exit 0 |
| `npm test` on merged `014609f8` | `tests 197 / pass 197 / fail 0` |
| `node scripts/sync.mjs` ×2 on main (real profile) | run 1: 3 changes, exit 0; run 2: `no changes`, exit 0 |
| `npx openspec validate internal-overlay-repository --strict` | `Change 'internal-overlay-repository' is valid`, exit 0 |

### Overall Decision

⚠️ PASS WITH WARNINGS. W1 needs a human decision before archive.
