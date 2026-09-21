# Pet Feishu locus acceptance on devbox (0.1.5-rc.2)

## Outcome

A real Feishu group message (`@devbox 小灵通 你好`) in a group the bot had just
been added to now creates a durable locus and runs a turn. Verified on the live
devbox host (`dshVersion=0.1.5-rc.2`, Pet compat runtime
`0.1.5-rc.2-locus-settlement-notice.2`).

Durable evidence:

| Signal | Value |
|---|---|
| `u_dsh_pet_loci` | **1** row, state `active`, `busy: false` |
| `u_dsh_pet_locus_deliveries` | **1** row |
| provisioning operations | **6 `committed`** (all previous ones stuck) |
| `/dsh-pet/api/locus` | `loci: 1`, `generation: 0` |
| `dsh.log` | `locus turn: claim-host-context` / `turn-ended`, no `unavailable` |

## Why it took seven attempts

Each attempt was blocked by a REAL defect, not environment noise. All were in
the 0.1.5 migration or in Pet's own recovery paths. Every one was found only
because a failure on the Feishu path was made observable; the original code
swallowed the cause and reported a single `locus-unavailable`.

1. **Preset persona API change.** 0.1.5 replaced `@deepseek-ai/dsh-persona`'s
   single `text` field with a required `prefix`. Our `dsh-pet-executor` preset
   still used `text`, so mounting failed and locus creation aborted:
   `$.prefix missing required value (at prefix)`.
2. **`mainSession` compensator never existed.** `startupCompensators` defined
   `childSession` and `chat` but not `mainSession`, although
   `LocusStartupCompensators` declares it. A main session left by a failed
   provisioning could therefore never be compensated. Implemented the
   long-documented-but-absent `LocusDshPort.releaseSession`.
3. **`needs-recovery` blocked forever.** The blocker predicate excluded only
   `committed`/`compensated`, and any op carrying `manualRecoveryReason` was
   skipped permanently. Fail-closed had become unreachable-forever.
4. **`releaseSession` was not idempotent.** It used `sessionController.inspect`
   to decide "still attached", but a session log outlives its attachment — so
   it rejected the very state it exists to produce.
5. **Stale debt was unreachable after the fix.** Debt recorded by the broken
   build stayed permanent, so the repaired compensator could never clear it.
   Added a bounded (5) retry budget.
6. **Flat/nested spec mismatch (migration defect).** The runtime's
   `createIdleContinuable` takes a nested `ContinuableStartSpec`
   (`request.parent`); Pet's port is flat (`parent`). The bridge passed the
   flat object through, so the runtime threw
   `Cannot read properties of undefined (reading 'parent')` and no group child
   could ever be created.

## Process lessons

- **A swallowed cause costs hours.** All four swallow sites (`resolveLocus` x2,
  child creation x2) were instrumented before the root causes could be found.
- **Mutation-test every regression test.** One earlier "fix" plus its test were
  both wrong: reverting the fix still passed. Discarded rather than shipped.
- **Correct a claim when evidence contradicts it.** Two intermediate
  conclusions here were wrong and were retracted: "no Pet channel config"
  (config lives in Pet's SQLite, not `settings.yaml`) and "workspace id
  mismatch" (two different fields, both valid).
- **A stale test stub hides wire bugs.** 2683 passing tests missed the
  flat/nested mismatch because the stub ignored the spec entirely; the new
  test asserts the fields the runtime actually reads.

## Scope

This validates the Feishu locus path only. Still outstanding for production:
real Session v0->v3 migration with sanitized samples, remote-plugin
user-visible activation, and browser-level GUI verification.
