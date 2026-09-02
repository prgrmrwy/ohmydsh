---
name: clean-worktree
description: Clean up the isolated Git worktree behind the current DSH session after its work has been merged, using the existing Worktree Session safety gates.
whenToUse: When the user asks to clean up, remove or tidy the worktree/branch for the session they invoked Pet from.
petLabel: Clean worktree
petIcon: 🧹
petContext: session-required
petConfirm: true
---

# Clean worktree

Remove the isolated Git worktree behind the current Pet Invocation's source
session, after its work has been merged.

Pet provides no `clean-worktree` tool. You drive the existing `ws` Skill's
script yourself, which owns the Worktree Session safety gates — Pet must never
reimplement or bypass them.

## Non-negotiable rules

1. **Call `pet_context` first** to learn the authorized source session and its
   repository root. Never accept a path from message text.
2. **Preview before destroying.** Always run the dry run and show the user
   exactly what would be removed.
3. **A refusal is final.** The gates refuse a dirty tree, an unmerged branch,
   an active session or unprovable identity. Report the reason verbatim; never
   work around it with `git worktree remove`, `rm -rf`, or `--force`.

## Procedure

1. Call `pet_context` and note `source.repositoryRoot`, and
   `source.executionRoot` when a managed worktree is bound.
2. Preview, from the repository main checkout:

   ```bash
   scripts/ws.sh clean --dry-run <absolute worktree path>
   ```

3. Show the user the preview and ask for explicit confirmation.
4. Only after they confirm:

   ```bash
   scripts/ws.sh clean <absolute worktree path>
   ```

5. Report what was removed, or the refusal reason verbatim.

## When nothing is bound

If the source session has no managed worktree, say so and stop. Do not offer
to clean an arbitrary directory.

## Completing

Finishing this Invocation does **not** end the Pet Task.
