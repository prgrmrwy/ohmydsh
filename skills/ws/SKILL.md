---
name: ws
description: Inspect, promote, or safely clean an ohmydsh Worktree Session. Use when the user asks for ws status, lean dependency promotion, or Worktree Session cleanup.
whenToUse: The current directory is a WS worktree, or the user explicitly asks for /ws status, /ws promote, or /ws clean.
---

# Worktree Session operations

Run the bundled wrapper from this skill directory:

```bash
scripts/ws.sh status [path]
scripts/ws.sh promote [path]
scripts/ws.sh clean --dry-run [path]
scripts/ws.sh clean [path]
```

## Safety

- `status` prints operation/base/task branch/path/dependency fingerprint and the isolated development `DSH_HOME`; it never prints `.env.local` values.
- `promote` is required before npm operations that mutate a lean shared install. It verifies the exact lean link, runs and validates worktree-local `npm ci`, and reports mutable only after success.
- Always run `clean --dry-run` first. Clean refuses the caller's current worktree, active Session paths supplied by the Host, dirty state, in-flight operations, and branches not proven merged by ordinary Git ancestry. It preserves remote branches and shared caches.
- Never bypass a refusal with force deletion. Preserve/commit useful work and establish merge ancestry first.

## Recovery

A retry of the first Worktree submit reuses the same operation id and validates every durable Host phase. For orphaned prepared operations, run status and clean dry-run from outside the target worktree. If target message admission is uncertain, navigate to the target Session and inspect its preserved draft/history; do not resubmit automatically.

## Deferred, not commands

`/ws setup`, per-repository config/trust, generic adapters, pnpm/Rush support, explicit network ref refresh, and squash-merge provider proof are backlog only. Do not claim they exist and do not synthesize hidden config files for them.
