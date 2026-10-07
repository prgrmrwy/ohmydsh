# Implementation review — WIP deployment boundary

This is a bounded local review for the user-authorized task-branch VM test deployment, NOT the final whole-change acceptance review. Overall verify remains FAIL. No merge/archive/cleanup approved.

## Reviewed snapshot

Git base for accumulated branch: `c9e927e5af93ee6122ff401942fc26489391c494` (merged VM main). HEAD before current repair commit: `de0b93dce65946acdd2820e37e9c2c72c5e73fcb`; current uncommitted naming and round-4–8 repair files are included in this review. Ancestor branch also includes unrelated pre-existing memex work; only dsh-openspec/current-change files will be staged in this commit. VM is clean on the exact task branch at de0b93d and real process PID16995 listens on localhost3080.

## Local inspection

Inspected actual source for command/Skill wiring, registry control invalidation, recovery startup, read-only session command builder and updater, source record/worktree gate, recursive closure materializer, stage parity and transaction lock/recovery. Relevant approved D3/D4/D5 requirements unchanged. Latest focused/full package tests: 32 files/115 tests; build/typecheck/artifact/strict validation/diff checks pass. Repository 261 pass/0fail/2existing skips; its latest run predates final round-8 recovery-route/owner-record refinements, which were subsequently package-tested.

- Host no longer exposes or calls source/project mutation callbacks from management. Actual approved-action execution remains in ordinary session Bash. WIP deployment uses only startup/discovery/read-only checks, not upgrade or project refresh.
- Registry refresh uses the actual registration invalidate capability; selected body parity is independently compared to official renderer; immutable generations retain older versions. Actual apply+real CLI and real SkillRegistry integration tests are present.
- Failed/partial transactions are not silently repaired at startup. Recovery mutation has explicit approval/checkout/worktree/lock/drift gates.

## Remaining important findings (block final acceptance)

1. Process-death/abandoned-lock recovery and partial two-file CAS behavior are not yet proven. Source locking uses OS temporary directory identity; cross-platform/TMPDIR variation requires further examination.
2. Upgrade sync target runtime/install and activation pending-reload have no real npm/VM proof. No live-source upgrade is allowed as a side effect of this deployment.
3. Real `dsh-tool-skill` tool+gesture scope/cwd and no-provider request-header coverage, disable preservation and repeated main-profile sync evidence remain pending.
4. Full scenario strength/review remains outstanding; earlier checked tasks are not blanket proof. Update checker installed version captures pre-materialization active state; startup version transition diagnostics require audit.

A Jev summary-only secondary review returned escalate, safe_to_apply=0.09, confidence/blast-radius below thresholds. It received no complete source diff and is NOT an approval; local source inspection/tests and existing user authorization define only the bounded WIP test deployment. Do not use this note to claim final readiness.

## Disposition

Proceed only with the already-authorized task-branch push and real main-process test deployment, then verify discovered generation, read-only surfaces and repeated sync. Do not invoke approved mutation actions, create model-request sessions, disable live plugin or claim change complete in this batch. Final implementation review remains pending.
