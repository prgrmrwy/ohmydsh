## Verification Results

### Task Completion
- [x] All tasks marked `[x]` in tasks.md
- Remaining open tasks: none.
  - 10.5 live acceptance is done (tasks 10.5). Two sub-checks could not be driven without a human in the cameo app, and are covered by tests instead: a follow-up inside an anchored comment, and an IM @ on the same connection.

### TDD Integrity
- [x] Every test-plan.md entry exists as a real test.
  - All 129 rows were checked mechanically: each row's test file has an `it`/`test`/`describe` TITLE line carrying `spec Scenario "<scenario>"` (comments do not count; the earlier looser check matched a comment, which round 7's re-review caught), and the Test Name column equals that title. The script reports `missing 0`.
- [x] Every test-plan.md row flipped to 🟢 green.
  - 129/129 are green. Four are marked **partial**, and the row says which part of the THEN is not unit-proven:
    - "旧代际迟到结算": the pure ledger has no diagnostic channel.
    - "宿主重启无法证明关联": intake pause is the `index.ts` `blockedLoci` startup wiring.
    - "Host 重启恢复未过期 current": deadline-timer re-arm is the `index.ts` startup dispatch.
    - "缺少导航能力时受理照常完成": "待办为已受理" is proven separately in `todo-dispatch.test.ts`.
  - These four are recorded honestly rather than claimed in full.
- [x] Full suite passes. See Evidence.
- [x] No skipped, pending or commented-out test was introduced by this change.
  - The only skips in the package are pre-existing `describe.skipIf` opt-in runtime suites (43 skipped, unchanged from baseline).
  - No `.only` or `.todo` was introduced.
- [x] No test was weakened, or deleted without replacement. Every removed `it(` title is either renamed with a `spec Scenario` prefix, or replaced on purpose:
  - `runs lark-cli with bot identity` was replaced by the `+subscribe` argv test "启用 channel 后启动订阅". The `consume` argv is gone by design (D1).
  - `is not connected until the readiness marker arrives` was replaced by "is connected only after the SDK connection line, not the early banner". The old marker belonged to `consume`.
  - `terminates with SIGTERM, never SIGKILL` was replaced by the process-group tests "停止时回收整个进程组" and the SIGKILL-only-for-a-live-child test. SIGKILL escalation is now intended (D1, R4-S-2).
  - `declares the channel down once attempts are exhausted` was renamed to "lark-cli bot 身份不可用", with the same assertions.
  - `starts a separate bot-added consumer…` was replaced by "单连接同时承载群消息与评论". The second connection is removed by design, because it splits events (E3).
  - `accepts the installed identity-contract version…` was replaced by the 1.0.97 floor test (R4-RC6).
  - `sends the original text when the member list cannot be read` was renamed to "成员表不可读时仍能发出" and strengthened: it now asserts exactly one diagnostic.
  - `PET_DOMAIN_VERSION is 15…` was replaced by the v16 contract test. The v15 rationale assertion is kept.

### Evidence
- Final full-suite command: `npm --prefix packages/dsh-pet run build && npx vitest run` (run in `packages/dsh-pet`).
- Result summary: **3220 passed, 0 failed, 43 skipped** (176 files passed, 3 skipped).
  - Baseline before the change was 3046 passed and 1 failed. That failure was `loader-composition`, which needs `lib/`; it passes once built.
- Typecheck: `npm run typecheck` (`tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit`): clean.
- Repo root: `npm test` gives **416 passed, 8 failed, 2 skipped**.
  - The 8 failures are identical to the pre-change baseline recorded in tasks 0.2 (base `68bc1a188`):
    - 7 sync tests, which fail because the temp-copied repo has no `node_modules`;
    - `repo-facade`, which reports that the README does not list `ponytail` / `ponytail-skills`.
  - This change adds no root failure. One transient new failure, the dsh.yaml note going over 600 code points, was found and fixed (9.1).
- `npm run check:artifacts`: tracked paths comply with repository policy.
- `openspec validate pet-locus-doc-comments --strict`: valid.
- `openspec validate --specs --strict`: 37 passed, 0 failed.
- Mutation checks: for each critical guard, I disabled the guard and confirmed its test fails. The guards checked:
  - default process-group signal;
  - comment routing;
  - connection gate;
  - dry-run;
  - `docComment` write-path bound;
  - redelivery rebuild (two variants);
  - member questions;
  - trigger-reply text;
  - late-result discard;
  - error-only retry;
  - prove-before-`finishing`;
  - disclosure-once;
  - media guard.
- Live acceptance (10.5) on the test app `cameo`, through Pet's real transport and doc-comment modules:
  - The anchored comment was answered under its own comment with Typing→DONE.
  - The whole-doc comment was answered with a new full comment mentioning the asker, with Typing→DONE.
  - The gate refused correctly while another connection was held.
  - No orphan process was left on stop.
  - Two defects were found live and fixed, with tests that failed first:
    - the connection-count envelope;
    - whole-doc comments cannot be replied to (owner chose option 1; spec, design and egress changed; round 7 reviewed).
- Non-executable checks run:
  - **Sync idempotence (10.4).** `node scripts/sync.mjs` was run twice into an isolated DSH home with a scratch XDG data dir. First run: exit 0, 16 changes. Second run: exit 0, "no changes — deployment already matches manifest", `dsh-pet@0.1.0 up-to-date`.
  - **Upgrade/rollback drill (10.6).** Run on a copy of a real v14 backup (5 loci / 19 deliveries), through the real SQLite backend and storage-domain composition:
    - v15→v16 migration writes a byte-identical backup; the second run is a no-op.
    - v16 code opens the medium.
    - The baseline v15 code is refused cleanly ("stamped version 16 … incompatible with descriptor version 15"). The logical content is unchanged.
    - After restoring the backup, v15 opens it.
    - Full details are in tasks 10.6.

### Review Integrity
- [x] Rounds 1–5 are recorded. Round 5 (`review-round5.md`) is APPROVE_WITH_CHANGES with CHANGES_APPLIED: yes.
- [x] Verdict not stale. There were two post-round-5 spec edits, each scoped-reviewed:
  - **Round 6** (bot-join reconciliation, owner-approved): APPROVE_WITH_CHANGES, `CHANGES_APPLIED: yes` (`review-round6.md`).
  - **Round 7** (whole-doc answers as a new full comment that mentions the asker, found in live acceptance; owner chose option 1):
    - REVISE → revisions → fresh-context re-review APPROVE_WITH_CHANGES;
    - the closing re-check returned `CHANGES_APPLIED: yes` with no contradictions (`review.md`).
  - proposal, design and specs are unchanged since that closing re-check.
- [x] All findings from rounds 1–5 were fixed or rebutted, and the rebuttals were accepted by the reviewer.

### Change Delivery
- Commit range: `1fc90c2d7..HEAD` on `ws/pet-locus-corp-session-links`, on top of base `68bc1a188`. Not merged; merging needs owner approval via `scripts/ws-merge.mjs`.

## Overall Decision

DECISION: PASS

✅ PASS:
- All tasks are done.
- 129/129 test-plan rows are green, each with a strictly titled test.
- The full suite passes: 3220 passed, 0 failed.
- Strict validate, check:artifacts, and sync idempotence (two runs) pass.
- The upgrade/rollback drill passed on a real backup copy.
- Live acceptance is done, and the two defects it found are fixed.
- Reviews are closed through round 7 with `CHANGES_APPLIED: yes`.

Not covered live (needs a human in the cameo app) and covered by tests instead: a follow-up inside an anchored comment, and an IM @ on the same connection.

Deployment prerequisites before the first production start:
- enable `drive.notice.comment_add_v1` and the comment, docx-read and contact scopes on the dsh-pet app;
- stop DSH;
- run `dsh-pet-migrate-state --yes`.
