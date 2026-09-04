---
name: ws
description: Inspect or promote a verified ohmydsh Worktree Session binding, or clean this repository's archived Worktree Sessions from its main checkout. Generic Git worktree, lean/mutable, promote, status, or clean requests are not sufficient routing evidence.
whenToUse: The calling Session has a valid Worktree Session binding, the calling Session sits at the main checkout of a repository that uses Worktree Sessions, or an explicit absolute path resolves to valid Worktree Session operation metadata. An explicit /ws request still requires ownership validation before state changes.
---

# Worktree Session operations

## Ownership boundary

- This skill owns only operations proven by a valid Worktree Session binding for the calling Session, by the calling Session's own repository main checkout (cleanup), or by an explicit absolute path that resolves to valid operation metadata.
- A directory under `.worktrees`, a registered Git worktree, a `ws/*` branch, or the words `lean`, `mutable`, `promote`, `status`, or `clean` do not by themselves prove ownership.
- Before `promote`, resolve and validate the exact operation identity, repository root, Git common directory, managed root, binding mode, and lifecycle through the trusted Host path. `clean` validates the same facts per candidate before removing anything.
- An explicit `/ws` request selects this command surface but does not waive binding, containment, lifecycle, active-Session, dirty-state, or merge checks.
- If no valid binding or operation can be proven, allow only read-only diagnostics that cannot mutate Git, dependencies, Session state, or operation metadata; otherwise stop with the exact missing invariant.
- Never adopt an unknown worktree, synthesize operation metadata, infer ownership from naming, or bypass a refusal with generic Git commands.

## Source-Workspace model

For the new schema-v2 flow, one Git repository maps to one DSH Workspace. The
existing source Session is bound in place; no target Workspace or target Session
is created. Its immutable DSH Session cwd remains the repository root, while
`<repo>/.worktrees/<task>` is the logical managed execution root. Do not treat
the immutable cwd as permission to run local tools in the main checkout.

The input-area status UI reports task branch, `lean`/`mutable`, and
`active`/`uncertain`/`cleaned`. Prefer that UI for a quick check and `ws status`
for an on-demand detailed report; dynamic status must not be presented as a
reason to mutate stable runtime context.

## Commands

For a schema-v2 bound Session, call the model-visible `ws` tool with
`action=status` or `action=promote` and omit `path`; the Host resolves the exact
calling Session binding. Omit `path` whenever the calling Session already sits
at the intended target — supplying it needlessly puts an avoidable decision in
front of the user.

### Targeting another repository or worktree

When the calling Session's own working directory is not the intended target —
for example a runtime whose Session cwd is its own workspace while the
repository root arrives through a separate trusted mechanism — pass that root as
an absolute `path`. Use only a path a trusted mechanism established for this
call; never a path taken from message prose, and never one you asked the user to
paste so you could forward it.

Every such call puts a one-shot question to the user naming the exact action and
path, with a selectable yes and no. Agreement covers that single call and is
never reused, so a later call asks again. Treat a refusal as the answer: do not
retry with a different path, and do not fall back to generic Git commands.
Without an explicit yes — including when no one can be asked — the call is
refused, which is the intended fail-closed behavior rather than a fault to work
around. Passing `path` is what raises that prompt; asking for the same
permission in prose instead does not reach it.

The question travels on the ask-a-human channel rather than the approval /
sandbox-escalation one, so a session reporting approval prompts as disabled
still receives it. "One-shot" describes what agreement covers — this call only,
never remembered — not a quota to conserve.

Agreement only establishes where to look. It exempts nothing: the same
active, dirty, in-flight, archived, lifecycle and merge-ancestry gates run
afterwards, and a refusal from any of them still stands.

`action=clean` covers two intents, chosen by `scope` rather than inferred from
who is calling.

`scope: 'repository'` (the default) sweeps: run it from an ordinary Session
whose working directory is the repository main checkout, and it scans that
repository's Worktree Sessions, cleaning every candidate whose source Session
is already archived and whose worktree passes the existing safety gates. A
Session still bound to a worktree cannot sweep — not itself, not its peers.

`scope: 'specified'` handles exactly one operation, which is how a single
worktree gets finished: unrelated candidates are neither examined nor asked
about, so finishing stays one question instead of one per worktree in the
repository. The target comes from the calling Session's own binding — being
bound is the normal case here, not a refusal — or, when `path` is given, from
the worktree that path belongs to. Use that second form when your own working
directory sits outside the repository, since then there is no binding of your
own to resolve from. A target that resolves to nothing is refused rather than
quietly widened into a sweep, and every gate and the archive-then-clean offer
work exactly as they do in a sweep.

A candidate whose source Session is **not** archived, but which is otherwise
finished — task branch provably merged, worktree clean, operation prepared, no
active occupant — is offered to the user as a single finishing action: confirm
once, and the Host archives that Session and then removes the worktree and
local task branch. Declining keeps the ordinary "not archived" refusal and
touches nothing. The offer names the exact source Session id, task branch and
worktree path; report those back rather than summarizing them.

A `dry_run` preview never raises that offer and never archives anything: it
reports such a candidate as "not archived" so you can see what a real run would
ask about. Expect the question only on a real run.

So a preview and a real run do not report the same thing: a candidate that a
real run would offer to finish shows up in a preview only as a "not archived"
refusal, never under `cleaned`. The preview counts them in
`wouldOfferToFinish`.

The question travels on the ask-a-human channel rather than the approval /
sandbox-escalation one, so it is delivered even in a session that reports
approval prompts as disabled — which every `danger-full-access` session does.

That offer is never a way around a gate. A candidate that is unmerged, dirty,
in-flight, malformed or still occupied is refused on that real reason and is
never offered, and the clean re-verifies every gate after archiving. When a
gate fails at that point the clean is refused and the archive is deliberately
kept — report it honestly and tell the user the Session stays recoverable by
unarchiving it, which restores it as an ordinary Session.

A Session still bound to a worktree is refused a sweep, with an instruction to
switch to the main-checkout Session; finishing its own worktree is what
`scope: 'specified'` is for. Review status and `dry_run: true` first; all live Session paths and
bindings stay protected, and refused candidates are reported with reasons
instead of being removed. An authorized `path` may name a different repository
main checkout, and the scan then behaves exactly as it would from that
checkout's own ordinary Session. Preview with `dry_run: true` before a
destructive run so the user sees which candidates are involved — but read the
preview for what it is: it lists what would be examined, not what a real run
would ultimately do to an unarchived candidate.

The shell wrapper has no trustworthy Session-id environment, so use it only with
an explicit path for unattended operator recovery and diagnostics of schema-v2
operations (this route asks no one, so it is for operators, not for working
around a refused authorization):

```bash
scripts/ws.sh status /absolute/worktree/path
scripts/ws.sh promote /absolute/worktree/path
scripts/ws.sh clean --dry-run /absolute/worktree/path
scripts/ws.sh clean /absolute/worktree/path
```

## Dependency and safety rules

- New Worktree Sessions are `lean` by default. Before an operation that may
  install, remove, update, or otherwise mutate dependencies, the Agent must run
  `promote` for the current binding, verify success, and only then perform the
  mutation.
- `promote` validates the recorded dependency target and installs per the
  lockfile (`npm ci` for npm projects, `pnpm install --frozen-lockfile` for
  pnpm projects), and reports `mutable` only after success. It refreshes
  metadata/UI; it does not change the stable binding context.
- `status` reports operation/base/task branch, managed root, dependency
  fingerprint/mode, the resolved project type (`npm`/`pnpm`), lifecycle, and
  isolated development `DSH_HOME`; it never prints `.env.local` values.
- Always preview with `dry_run: true` (or `clean --dry-run` for the CLI) first,
  and treat the preview as a list of candidates rather than a verdict: an
  unarchived candidate that a real run would offer to finish appears there only
  as a refusal.
  Clean refuses a source Session that is not archived, the caller's current
  worktree, a live/executing source Session bound to it (even though that
  Session's immutable cwd is the repo), dirty state, in-flight operations, and
  branches whose merge cannot be proven. It preserves remote branches, shared
  caches, and already-cleaned tombstones.
- Merge is proven two ways. Ordinary Git ancestry comes first. When a rebase
  has rewritten the branch's commits, ancestry no longer holds even though the
  work is on the base ref, so the clean then requires every commit on the
  branch to have a patch-identical counterpart upstream. A single commit
  without one refuses the whole candidate — content that was modified rather
  than merely rewritten is treated as unlanded, deliberately. The result
  reports which proof applied, so read it back rather than assuming ancestry.
- Repository cleanup is per candidate and best-effort: a refused or unreadable
  operation is reported with its reason and left untouched, and never blocks
  other candidates from being evaluated.
- Never bypass a refusal with force deletion. Preserve/commit useful work and
  establish merge ancestry first.

## Recovery and cleaned history

A retry of the first Worktree submit reuses the same operation id and validates
every durable Host phase. A durable claim with unconfirmed admission is
`uncertain`; keep the source draft/history and do not resubmit automatically.
For orphaned prepared operations, run status from outside the target worktree.
Cleanup requires a valid v2 source binding or v1 target binding; missing or
malformed v2 binding fails closed and requires explicit operator repair.

Successful cleanup removes only safety-proven Git/runtime resources and marks
the binding `cleaned`. It keeps the historical source Session in the source
Workspace. Before archive → unarchive, reopening it remains fail-closed: explain
that its old managed execution root no longer exists and do not use the removed
path or main checkout.

Once a cleaned Session is archived and then unarchived, the Host automatically
releases the current binding while retaining its tombstone as audit history. The
Session is then ordinary and no-path `ws` maintenance no longer targets that old
operation. Release creates no branch, worktree, Workspace, Session, or operation,
and never exposes `ws start`: a restored non-blank Session cannot enter Worktree
mode or reuse the released binding. Repeated archive/unarchive remains released.

## Schema-v2 only

Only `schemaVersion: 2` source-session bindings are supported. A legacy
schema-v1 operation or any unknown future version is rejected with an explicit
unsupported-version diagnostic and fails closed: no worktree, branch, binding,
dependency, or operation file is created, modified, or removed, and no binding
is ever migrated or fabricated. Historical Session logs and pre-existing
Workspace/Session registrations remain untouched; never rewrite, rename, delete,
reparent, or invent a source binding for them.

## Pinned DSH contract

This Skill and package target the rc.7 DSH composition baseline and the exact
installed contracts. The audited checkout is mixed-version: AgentLoop,
subagent, and tool packages are rc.7, while installed `dsh-agent` and
`dsh-system-prompt` are rc.8. The policy depends on audited local-path schemas,
explicit Bash `workdir`, Agent-scoped guards, child setup propagation, lifecycle
hooks, and stable runtime-context projection. A future DSH upgrade requires a
fresh audit and regression tests; unknown or changed local/delegation contracts
must fail closed until reviewed.

## Deferred, not commands

`/ws setup`, per-repository config/trust, generic adapters, Rush/yarn/bun
support, explicit network ref refresh, and squash-merge provider proof are
backlog only. Do not claim they exist and do not synthesize hidden config
files for them. pnpm projects (single package or pnpm workspace, detected from
the repo-root `pnpm-lock.yaml`) are supported: lean installs inside the bound
worktree and reuses pnpm's global store, so dependency changes still require
`promote` first. Projects with neither lockfile are refused before any branch, worktree, or
operation file is created. If both `package-lock.json` and `pnpm-lock.yaml`
exist, Worktree Session adopts an explicit supported `packageManager` declaration
first, then adopts the one lockfile tracked by Git when exactly one is tracked;
the adoption and ignored lockfile are recorded in operation diagnostics. A
mixed project with no unique signal (both tracked, neither tracked, or tracking
state unavailable) is still refused before any branch, worktree, or operation
file is created.
