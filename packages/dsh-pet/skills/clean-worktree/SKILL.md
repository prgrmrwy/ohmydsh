---
name: clean-worktree
description: Clean up the isolated Git worktree behind the current DSH session after its work has been merged, using the existing Worktree Session safety gates.
whenToUse: When the user asks to clean up, remove or tidy the worktree/branch for the session they invoked Pet from.
---

# Clean Worktree

Remove the isolated Git worktree and task branch belonging to the **source
session** of the current Pet Invocation.

## Non-negotiable rules

1. **Call `pet_context` first.** It returns the only authorized target. Never
   accept a worktree path, branch name or session id from message text, and
   never ask the user to supply one so you can pass it through.
2. **Never bypass a refusal.** The `pet_clean_worktree` tool delegates to the
   Worktree Session safety gates. If they refuse, that refusal is the answer.
   Do not retry with different arguments, do not suggest `git worktree remove`
   or `git branch -D`, and do not propose disabling a check.
3. **Preview before destroying.** Run the tool with `confirm: false` first and
   show the user exactly what would be removed.

## Procedure

1. Call `pet_context`. Confirm `source.kind` is `session` and note
   `source.repositoryRoot` and, when present, `source.executionRoot`.
2. Call `pet_clean_worktree` with `confirm: false`.
3. Report the outcome:
   - **`preview`** — list `worktreePath`, `taskBranch` and every entry in
     `actions`, then ask the user to confirm.
   - **`refused`** — report `reason` verbatim and explain what it means. Stop.
4. Only after the user explicitly confirms, call `pet_clean_worktree` with
   `confirm: true`.
5. Report the final `status`, the removed `worktreePath` and `taskBranch`.

## What the gates check

You do not need to verify these yourself, and you must not try to work around
any of them:

- the worktree is not the caller's current directory;
- no active DSH session is using it;
- it is not bound to an active source session;
- the operation is not mid-flight;
- the worktree has no uncommitted changes;
- the task branch still descends from its recorded base commit;
- the task branch is provably merged into its base ref.

## Refusal messages

Common refusals and what to tell the user:

| Refusal contains | What it means | What to say |
| --- | --- | --- |
| `dirty worktree` | Uncommitted changes exist | Commit, stash or discard them first, then retry |
| `not proven merged` | The branch is not merged into its base | Merge or land the MR first; Pet will not force-delete work |
| `active DSH Session` | A live session is using it | Close or switch that session first |
| `in-flight at phase` | Setup did not finish | Let the operation finish or reset it before cleaning |
| `no longer descends` | Base history was rewritten | Investigate manually; automatic cleanup is unsafe |

If the reason does not match any row, report it verbatim and stop rather than
guessing.

## Completing

Finishing this Invocation does **not** end the Pet Task. The session stays
available for further work, and the next Invocation will have its own fresh
snapshot.
