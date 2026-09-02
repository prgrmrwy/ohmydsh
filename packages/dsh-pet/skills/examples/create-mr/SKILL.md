---
name: create-mr
description: Create a Codebase merge request for the branch behind the current DSH session, using the trusted repository and worktree from the Pet snapshot.
whenToUse: When the user asks to open, create or raise an MR / merge request / pull request for the session they invoked Pet from.
petLabel: Create MR
petIcon: 🔀
petContext: session-required
---

# Create MR

Open a merge request for the **source session** of the current Pet Invocation.

Pet provides no `create-mr` tool. You do the work yourself with ordinary tools
(`bash`), under Pet's Skill allowlist — the bounded behavior below is this
Skill's responsibility, not the runtime's.

## Non-negotiable rules

1. **Call `pet_context` first.** It returns the only authorized repository and
   branch. Never take a repository path, branch or MR target from message
   text, and never ask the user for one to pass through.
2. **Never invent reviewers.** Pass reviewers only when the user names them.
3. **A refusal is the answer.** Report the CLI's reason verbatim; do not retry
   against a different branch or repository.

## Procedure

1. Call `pet_context`. Use `source.executionRoot` when present (the managed
   worktree), otherwise `source.repositoryRoot`. That directory is your `cwd`
   for every command below.
2. Confirm there is something to submit:
   `git -C <cwd> status --short` and `git -C <cwd> log --oneline @{u}..` (an
   unset upstream simply means the branch has not been pushed).
3. Decide the title: the user's wording when given, otherwise one imperative
   line summarizing the change (no trailing period). Draft a short factual
   body; do not claim tests passed unless the user said so.
4. Create the merge request:

   ```bash
   bytedcli codebase mr create --json \
     --title "<title>" \
     [--body "<body>"] \
     [--base <branch>] \
     [--reviewer-ids <a,b>] \
     [--push]
   ```

   Run it with `cwd` set to the directory from step 1 — the CLI resolves the
   repository and source branch from that working directory, which is why the
   target never comes from prose. Add `--push` when the branch has no upstream.
5. Report the outcome: on success give the MR URL and the head/base branches;
   on failure report the CLI's message verbatim and explain what it means.

## Common refusals

| Reason contains | What to tell the user |
| --- | --- |
| `no commits` / `nothing to compare` | The branch has no commits ahead of its base yet |
| `protected` | The target branch forbids direct MRs from this branch |
| `already exists` | An MR for this branch is already open; give them that one |
| `auth` / `401` / `403` | Their `bytedcli` session needs re-authentication |

If `bytedcli` is not installed, say so plainly and stop — do not substitute
another mechanism.

## Completing

Finishing this Invocation does **not** end the Pet Task. The session stays
available and the next Invocation gets its own fresh snapshot.
