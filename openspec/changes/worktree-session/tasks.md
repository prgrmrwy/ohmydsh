## 1. Package skeleton and reference intake

- [ ] 1.1 Create `packages/worktree-session/` as a local DSH bundle with host, client, wire, build, typecheck and test entry points; pin peer/dev dependencies to the repository's active DSH rc family.
- [ ] 1.2 Record the `LaoYueHanNi/dsh-git-worktree` MIT source/interaction reference in README/NOTICE, include required license text, and document which concepts or code were adapted.
- [ ] 1.3 Add the bundle patch and a disabled local package entry in `dsh.yaml`; verify `node scripts/sync.mjs` can resolve the package without enabling it in the live profile.

## 2. Host Git discovery and operation model

- [ ] 2.1 Implement argv-based Git execution with timeouts and typed errors for repo/common-dir discovery, local/remote ref enumeration, ref-to-commit resolution, worktree listing and status.
- [ ] 2.2 Implement deterministic task slug, unique `ws/<slug>` branch and `.worktrees/<slug>` path allocation under a repository lock; validate refs and never checkout/reset the main checkout.
- [ ] 2.3 Implement atomic operation metadata under `<git-common-dir>/ws/operations/` with explicit phases and validation-based idempotent resume for the same operation id.
- [ ] 2.4 Implement task branch/worktree creation from the recorded base commit, stale worktree pruning limited to invalid registrations, and rollback/diagnostics for partial Git failures.
- [ ] 2.5 Add real-Git fixture tests covering two concurrent tasks from one base, name collisions, local/remote base refs, main-checkout invariance, stale registrations and retry after partial creation.

## 3. Lean dependency and local environment setup

- [ ] 3.1 Implement npm cache fingerprinting from `package-lock.json`, Node major and npm major, plus cache-level locking and atomic ready metadata.
- [ ] 3.2 Implement cache preparation with `npm ci` and health validation, then safe lean linking that refuses to overwrite an unexpected worktree `node_modules` path.
- [ ] 3.3 Implement `.git/info/exclude` initialization for `/.worktrees/` without modifying project `.gitignore`.
- [ ] 3.4 Implement `.env.local` synchronization only from a Git-ignored source, owner-only destination permissions, and an idempotent managed block assigning the operation's isolated development `DSH_HOME`.
- [ ] 3.5 Add fixture tests for cache hit/miss, fingerprint changes, unhealthy/partial cache recovery, unexpected `node_modules`, ignored-versus-tracked `.env.local`, managed-block idempotency and two distinct build homes.

## 4. Host wire API

- [ ] 4.1 Define the zero-runtime shared wire contract for repo status, start operation, operation status, promote and clean, including stable phase/error envelopes.
- [ ] 4.2 Mount guarded no-store Host routes through the DSH webserver with strict body keys, absolute-path/repo-boundary checks, request size limits and structured errors.
- [ ] 4.3 Implement the start route as a single-flight operation that resolves base, creates Git resources, prepares lean dependencies/environment and returns the prepared worktree facts.
- [ ] 4.4 Add route tests for malformed input, non-Git paths, operation replay, concurrent duplicate requests, each failing phase and secret-free responses/logs.

## 5. Homepage branch and Worktree controls

- [ ] 5.1 Implement the `conversation.input.left` segmented control for blank Git Sessions, showing the staged base and a default-off Worktree toggle while leaving non-Git/non-blank Sessions unchanged.
- [ ] 5.2 Implement the hierarchical local/remote base picker with search, ref refresh on focus/menu open, and no `git switch`, worktree or Session side effects on selection.
- [ ] 5.3 Implement a per-source-Session client stage store that resets on cwd/session lifecycle changes and displays the current start phase or recoverable error without adding a confirmation dialog.
- [ ] 5.4 Add client tests confirming sidebar behavior is untouched, ordinary submit is untouched while disabled, and base/toggle changes are side-effect free.

## 6. First-submit interception and handoff

- [ ] 6.1 Implement a compatibility-checked, idempotent decoration of the armed blank Session's `SessionInput.submit`, preserving/restoring the original facade method on disarm, success, lifecycle exit and plugin disposal.
- [ ] 6.2 Before Host side effects, validate plain input phase, non-empty draft, live images, no slash claim and no reference occurrences; show a recoverable refusal while preserving the source draft.
- [ ] 6.3 On accepted submit, freeze the text/image/mode snapshot, allocate an operation id and call the Host start transaction in single-flight mode while preventing the source default sink.
- [ ] 6.4 Register the prepared path as a DSH Workspace, connect/create its blank Session, obtain the target input facade, and transfer text plus ordered image ids without prematurely clearing the source.
- [ ] 6.5 Open the target Session and invoke its original submit exactly once; on successful admission clear the source draft/images and disarm, while on uncertain or failed admission prefer navigation/preserved target draft over duplicate sending.
- [ ] 6.6 Implement restart/retry behavior for prepared operations and already-created target Sessions, including the fail-closed rule that a non-blank target is never auto-resubmitted.
- [ ] 6.7 Add client integration tests for Enter and send-button paths, ordinary mode passthrough, text/image handoff, invalid references/commands, failures at every phase, explicit disarm fallback, double clicks and refresh/retry duplicate prevention.

## 7. WS status, promote and safe clean

- [ ] 7.1 Implement `ws status` resolution from any registered worktree, reporting operation/base commit/task branch/path/dependency mode/fingerprint/development home without exposing `.env.local` contents.
- [ ] 7.2 Implement `ws promote` to verify and remove only the expected lean link, run/validate worktree-local `npm ci`, and update metadata to mutable only on success.
- [ ] 7.3 Implement `ws clean --dry-run` and clean safety gates for current cwd/session use, dirty state, in-flight operation and ordinary-merge ancestry; remove only safe worktree/local branch/operation data and preserve remote branches/cache.
- [ ] 7.4 Create `skills/ws/SKILL.md` and script wrappers for status/promote/clean; explicitly mark `/ws setup`, general adapters and squash-merge platform proof as deferred backlog rather than implemented commands.
- [ ] 7.5 Add shell/fixture tests for status, promote success/failure/retry, dry-run, safe merged cleanup and refusal of dirty/unproven/current worktrees.

## 8. Deployment and acceptance

- [ ] 8.1 Run package typecheck, unit/integration tests, client/host builds and real-Git smoke tests; verify committed build artifacts match source if the package ships prebuilt output.
- [ ] 8.2 Install the disabled bundle into an isolated test `DSH_HOME` and perform browser acceptance on the existing DSH GUI build: homepage placement, base selection, toggle, normal submit, successful WS first submit and staged failure/retry.
- [ ] 8.3 Run two real mydsh Worktree Sessions from `main`; prove unique branches/cwds, unchanged main checkout, shared correct-fingerprint lean dependencies, distinct development `DSH_HOME`s and no writes to the GUI's real `~/.dsh`.
- [ ] 8.4 Validate promote and safe clean end-to-end, including refusal of dirty and unproven branches; document recovery for orphaned prepared operations.
- [ ] 8.5 Enable `worktree-session` package and `ws` skill in `dsh.yaml`, run `dsh build`, confirm successful materialization, and ask the user to restart DSH rather than stopping the current session automatically.
- [ ] 8.6 Add a deferred backlog section to this change's design/implementation notes for `/ws setup`, per-repository local config/trust, pnpm/Rush adapters, explicit ref refresh and squash-merge provider proofs; do not add these to the repository-global `BACKLOG.md`.
