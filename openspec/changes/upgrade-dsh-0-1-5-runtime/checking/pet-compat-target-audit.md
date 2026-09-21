# Pet compatibility target audit

## Target identity

- DSH tag: `dsh-v0.1.5-rc.2`
- Commit: `fb2c4b9e698e30edb738bca4cf0618587db7d203`
- Manifest target: `0.1.5-rc.2`
- `autoUpdate.enabled`: `false`

## Public/API migration evidence

The Pet host and test fixtures now use the target public Agent contract:

- generic `Agent` identity is branded `agent.id: SessionId`;
- `AgentSetup` receives `(agentCtx, agent)`;
- creation/resume use target flat `agentOptions` and return an `AgentHandle`;
- subagent creation rows carry branded `{ childId, messageId }`;
- host delivery uses `Symbol.for('dsh.subagent.deliverPrompt')` with the sixth argument `'queue'`;
- persisted child adoption requires `kind: 'child'` and `mode: 'continuable'`;
- Session objects are resolved separately through the Session service where title/flush/persistence APIs require a Session.

`packages/dsh-pet` typecheck passed. Its full Vitest suite passed with 154 files, 2,680 tests passed, and 47 skipped. The skipped cases are existing capability-gated paths; no test failure was converted to a pass by disabling Pet.

## Subagent compatibility: re-derived against the target

The old 0.1.2 patch was discarded, not relabeled. `settlement-notice.patch` is
now derived from the target source itself:

- upstream tag: `dsh-v0.1.5-rc.2`
- reviewed commit: `fb2c4b9e698e30edb738bca4cf0618587db7d203`
- patch SHA-256: `68f9531ad03ae0a1c6a9cebc3884f04ee2b1dca1cad542f0a832246fa978e8a0`
- published artifact: `@deepseek-ai/dsh-subagent@0.1.5-rc.2-locus-settlement-notice.2`

It applies cleanly to a pristine clone of the target tag (`git apply --check`),
and the builder re-verifies that hash before every build.

### What the patch adds, and why each is still needed

The target already provides durable `toolFilter`, queue/steer delivery, cold
resume, and parent-facing reply guidance, so none of those are patched. What
remains absent upstream, and is therefore added at source:

1. `settlementNotice: 'silent'` — the target's `notifySettlement` always injects
   an account into the parent conversation. A Host owning the child's own
   reporting channel must be able to suppress exactly that notice.
2. `createIdleContinuable` — two-phase provisioning needs a child that exists
   and is owned before the Host commits its index, with no artificial
   initialization prompt polluting the child transcript.
3. `contextMode: 'independent-v1'` — composes a child from its own durable
   saved preset, so a cold resume restores the creation-time selection instead
   of the parent's later composition. Creation refuses when no preset resolves,
   rather than silently falling back.
4. `withLiveContinuableChildSession` — generic Session routing cannot resolve a
   continuation-owned child; this proves exact live parent identity and durable
   child lineage before granting access.
5. `isolateQueuedTurnClaim` — claims only the head queued turn so parked
   `next-step` GUI input is not destroyed. Upstream moved `Inbox` from
   `dsh-agent` to `dsh-agent-loop`, which is why the old patch could not apply.

Durable persistence is versioned: ordinary continuable descriptors stamp
version 4, independent ones version 5, and upstream version 3 remains readable.
Without this a cold resume would silently lose silence and independence.

### Evidence

- `git apply --check` succeeds on a pristine `fb2c4b9e` clone.
- Target host typecheck: 0 errors.
- Target suites: 748 passed across 35 files, including 136 pre-existing
  continuation tests unchanged plus 12 new executable seam proofs.
- Mutation check: deleting the silent-settlement guard makes its proof fail,
  and restoring it passes, so the proof is not vacuous.
- `build.mjs` runs the reviewed proofs against the patched checkout before
  publishing, so a build that only typechecks cannot ship.
- Full launcher build succeeds; `npm ls` shows every override deduped to a
  single instance, and the resolved runtime reports all four capability markers
  with `replaces`/`upstreamTag`/`upstreamBase` matching the reviewed target.

`overrideRuntimeAgent` remains `false`: the isolated-claim seam is built and
proven, but the agent-pair override is not loaded, so Pet keeps the inquiry
queue unavailable rather than risk parked GUI input. That is unchanged policy,
not a new gap.

## Storage compatibility evidence

Storage was independently re-derived against the target commit rather than accepted from textual applicability:

- patch SHA-256: `188e5aac118b5835f0ff0b7b9a4c1794c92e64f340602e39f59eba09375c4b7e`;
- target typecheck passed;
- 97 target semantic tests passed across domain/JSON/SQLite;
- evidence covers all-or-none failure, unsupported transactions, `applyBatch`, exclusive SQLite ownership, double-writer rejection, OS signal recovery, and interrupted rollback;
- `build-storage.mjs` succeeded and a second run reported `up-to-date`.

Storage evidence does not unblock the independent Subagent overlay gate.

## Decision

- Agent/public API migration: implementation and automated package evidence complete.
- Storage target patch: semantically validated and built.
- Subagent target patch: **re-derived from the target tag, proven, and built**; the
  earlier hard blocker is resolved.
- Combined compatibility runtime: builds end-to-end with single-instance
  overrides and all four capability markers present.
- Production and devbox acceptance: still **NO-GO** — runtime probes against a
  live Pet Host, approved sanitized Session/Pet migration samples, remote
  plugin activation, and the devbox clean-build gate remain outstanding.

No production DSH, port `3080`, host, or lumevm was operated by this audit.
