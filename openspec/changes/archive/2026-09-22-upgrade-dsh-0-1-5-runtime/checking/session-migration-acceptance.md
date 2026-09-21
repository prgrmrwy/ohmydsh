# Session v0 -> v3 migration acceptance (devbox, real data)

## What the formats are

`v0`..`v3` are the DSH **session log persistence format** versions (JSONL, now
zstd-framed). Authority, read from the target tree rather than inferred:

- writer constant: `SESSION_FORMAT_VERSION = 3` in
  `packages/core/session/src/types.ts`
- release record: `docs/session-format-status.md` ->
  `latestReleasedVersion: 3`, `evidenceTag: dsh-v0.1.5-alpha.1`
- migration design: `.agents/notes/implemented/architecture/2026-08-31-released-session-format-migrations.md`
  (v0->v1 tracks message/retry identity; v1->v2 buffers one unsettled Assistant
  attempt, tracks blocked events and old->new sequence references)

Our pinned `0.1.2-rc.1` wrote the v0 line; `0.1.5-rc.2` writes v3. The upgrade
therefore crosses the real migration chain.

## Real-data evidence (the user's own devbox sessions)

Scan of `~/.dsh/sessions`: **40 files at format v0**, **11 at v3**, all v3
mtime 2026-09-21 (the upgrade day). Note migration is LAZY: a session converts
when it is first opened, so the remaining v0 files are simply unopened, not
skipped.

Seven sessions had both generations present. Per-session comparison (decoding
**every** zstd frame, not just the first — the header is its own frame):

| session | rows old->new | tool/call | tool/result | asst/msg | text lost | old kept | lock |
|---|---|---|---|---|---|---|---|
| corp-nexus | 4->5 | 0 | 0 | 0 | 0 | yes | yes |
| dev-infra-server | **18,672->77** | 7 | 7 | 10 | **0** | yes | yes |
| learning | 5->5 | 0 | 0 | 0 | 0 | yes | yes |
| nexus_workspace | 5->5 | 0 | 0 | 0 | 0 | yes | yes |
| opensource-ohmydsh A | 550->176 | 41 | 41 | 16 | **0** | yes | yes |
| opensource-ohmydsh B | 1,287->417 | 115 | 115 | 40 | **0** | yes | yes |
| opensource-ohmydsh C | 4->25 | 0 | 0 | 0 | 0 | yes | yes |

`7 samples, 0 failures.`

Row counts collapse (e.g. 18,672 -> 77) because v1->v2 folds released streaming
chunks (`assistant/chunk`, `text-chunks`, `reasoning-chunks`,
`tool-call-chunks`) into settled messages. The fidelity check is therefore on
CONTENT, not row count: every `tool/call` and `tool/result` is preserved
1:1, `assistant/message` and `step/start` counts match, and **no text block is
lost in any sample**.

Header fields verified equal across generations: `id`, `cwd`, `createdAt`,
`agentPreset`, `delegationDepth`. The only header delta is v3 adding
`isSeeded: false`, which is a new field, not a loss.

Generation handling observed on disk:

```
session.jsonl.zstd      197669B  Sep 19   <- v0 generation RETAINED
session.v3.jsonl.zstd   121362B  Sep 21   <- v3 generation published
session.lock                      Sep 21   <- lease artifact present
```

## Property verification via the upstream suites

Rather than re-implement checks, the target's own authoritative specs were run
against the target source (`fb2c4b9e`):

- `packages/session/session-persistence-jsonl/tests/` — **13 files, 468 passed**,
  covering `generation`, `lease`, `migration-refusal`, `migration-verifier`,
  `multi-edge-publication`, `v3-event-admission`, `v2-ptc-migration`,
  `v2-system-migration`, `zstd` (+compat)
- e2e: `lease.two-process.e2e.ts`, `built-migration-worker.e2e.ts` — **2 passed**

These are the authoritative tests for old-generation retention, atomic
publication, lease exclusivity, interruption/generation selection and
migration refusal.

## Status

- Field fidelity on real data: **verified** (7/7 samples, no content loss)
- Old generation retained + new generation published: **verified**
- Lease / atomicity / interruption semantics: **verified** via upstream suites
- Not yet done: an explicit post-migration write-and-restart consistency run on
  devbox, and a rollback rehearsal to `0.1.2-rc.1`.
