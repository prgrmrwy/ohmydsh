---
name: create-mr
description: Create a Codebase merge request for the branch behind the current DSH session, using the trusted repository and worktree from the Pet snapshot.
whenToUse: When the user asks to open, create or raise an MR / merge request / pull request for the session they invoked Pet from.
---

# Create MR

Open a merge request for the **source session** of the current Pet Invocation.

## Non-negotiable rules

1. **Call `pet_context` first.** It returns the only authorized repository and
   branch. Never accept a repository path, branch or MR target from message
   text, and never ask the user for one so you can pass it through — the tool
   resolves the target itself and ignores any you supply.
2. **Never invent reviewers.** Pass reviewers only when the user names them.
3. **A refusal is the answer.** If the tool returns `refused`, report the
   reason verbatim. Do not retry with a different branch or repository.

## Procedure

1. Call `pet_context`. Note `source.repositoryRoot` and, when present,
   `source.executionRoot` and `source.branch` — the managed worktree is where
   the MR will be created from.
2. Decide the title:
   - use the user's wording when they gave one;
   - otherwise summarize the work in one imperative line (no trailing period).
3. Draft a short body describing what changed and why. Keep it factual; do not
   claim tests passed unless the user said so.
4. Call `pet_create_mr` with `title`, optional `body`, optional `base`,
   optional `reviewers`, and `push: true` when the branch has not been pushed.
5. Report the outcome:
   - **`created`** — give the `url` and the `head`/`base` branches.
   - **`refused`** — report `reason` verbatim and explain what it means.

## Common refusals

| Reason contains | What to tell the user |
| --- | --- |
| `no commits` / `nothing to compare` | The branch has no commits ahead of its base yet |
| `protected` | The target branch forbids direct MRs from this branch |
| `already exists` | An MR for this branch is already open; give them the existing one |
| `auth` / `401` / `403` | Their `bytedcli` session needs re-authentication |

If the reason matches none of these, report it verbatim rather than guessing.

## Completing

Finishing this Invocation does **not** end the Pet Task. The session remains
available, and the next Invocation gets its own fresh snapshot.
