## 1. Durable source-Session binding

- [x] 1.1 Introduce a versioned operation parser/writer that reads existing schema-v1 target handoffs and writes schema-v2 source-session bindings without eagerly rewriting legacy files.
- [x] 1.2 Add repository-locked binding transitions for `bind-source`, `claim-submit`, `admitted`, `uncertain`, and `cleaned`, enforcing one active binding per Session and one Session per operation.
- [x] 1.3 Add lookup and replay validation by source Session id, including canonical repo cwd, worktree identity, task branch, and conflict diagnostics.
- [x] 1.4 Extend strict guarded Host routes and wire types for source binding and Session status while retaining compatible v1 maintenance requests.
- [x] 1.5 Add operation tests for restart replay, conflicting bindings, exactly-once claims, uncertain recovery, atomic persistence, and schema-v1 compatibility.

## 2. Stable Agent context and lifecycle recovery

- [x] 2.1 Inject the Host Agent, tool-runtime, and system-prompt services required to install policy in an exact live Agent scope.
- [x] 2.2 Implement one deterministic active-binding runtime-context renderer containing only repo root, worktree root, task branch, main-checkout prohibition, explicit-path rule, and promote-before-dependency-mutation guidance.
- [x] 2.3 Implement a deterministic cleaned-binding terminal context that denies reuse of the removed execution path and directs the user to create a new Worktree Session.
- [x] 2.4 Install binding context idempotently for an already-live source Agent before submit claim and restore it during `agent/session-start` before the first prompt assembly.
- [x] 2.5 Add integration tests proving identical later turns and Host restart do not append duplicate context snapshots, while clear/compaction recovery and cleaned reopening produce only the required low-frequency update.

## 3. Fail-closed managed-root policy

- [x] 3.1 Inventory the pinned DSH rc.7 model-visible tools that can access local paths, run commands, or create child execution contexts, and encode their audited argument contracts in a tested policy table.
- [x] 3.2 Implement shared canonical containment checks for existing paths, non-existent write targets, `..` traversal, symlinked ancestors, and platform path boundaries.
- [x] 3.3 Add Session-scoped pre-execution/guard policy that rejects missing Bash workdirs, relative local paths, main-checkout targets, out-of-worktree paths, and schema-drifted local-capability tools without silently rewriting frozen arguments.
- [x] 3.4 Allow audited non-local tools and verified managed-root calls to continue through existing sandbox, approval, timeout, and tool policies without granting additional access.
- [x] 3.5 Propagate the binding into built-in subagent/fork/background Agent scopes before their first step, and deny providers whose inheritance cannot be proven.
- [x] 3.6 Add adversarial tests for Bash, read/write/edit, glob/grep, symlink escape, missing output files, nested tool dispatch, built-in delegation, unsupported providers, and unaffected non-local tools.

## 4. In-place first submission

- [x] 4.1 Replace the Client target-Workspace handoff with source Session binding, policy readiness, durable submit claim, and invocation of the source facade's original `submit`.
- [x] 4.2 Remove successful new-flow calls to `workspaces.create`, `connectWorkspace`, `sessions.open`, target input lookup, and cross-Session draft/image transfer while preserving ordinary-submit passthrough when Worktree is off.
- [x] 4.3 Keep source draft and images intact until preparation/binding succeeds, clear them only through the official admitted source submission, and preserve them on failure or uncertain admission.
- [x] 4.4 Make retries reuse the same operation and refuse automatic resubmission after a durable claim whose admission is uncertain.
- [x] 4.5 Update Client tests to prove Workspace and Session counts do not increase, the first message is admitted exactly once in the source Session, failures never fall back to the main checkout, and submit decoration restores cleanly.

## 5. Session-oriented status, promote, and cleanup

- [x] 5.1 Add persistent input-area status for bound non-blank Sessions showing task branch, `lean`/`mutable`, and active/uncertain/cleaned lifecycle without adding dynamic model context.
- [x] 5.2 Resolve `ws status` and `ws promote` from the calling Session binding by default, retaining explicit path support only for compatibility and diagnostics.
- [x] 5.3 Update promote to refresh metadata/UI after validation while snapshot-testing that the stable binding context is byte-identical across lean-to-mutable transition.
- [x] 5.4 Extend active cleanup protection to source Sessions/Agents bound to the target worktree even though their immutable Session cwd is the repo root.
- [x] 5.5 Change successful clean to retain a compact cleaned tombstone and source Workspace history while deleting only safety-proven worktree/branch resources.
- [x] 5.6 Add maintenance tests for conversational no-path status/promote, active bound-Session refusal, archived safe cleanup, cleaned historical reopening, and unchanged schema-v1 target maintenance.

## 6. Documentation and compatibility

- [x] 6.1 Update package README and `/ws` Skill to explain source-Workspace management, logical execution roots, default lean behavior, Agent-driven promote, status UI, and cleaned historical Sessions.
- [x] 6.2 Document that old independent Workspaces/Sessions are not migrated, renamed, deleted, or reparented and remain manageable through compatible path-based operations.
- [x] 6.3 Update architecture/interaction documentation to remove target Workspace/Session creation from the new flow and distinguish immutable Session cwd from the managed worktree execution root.
- [x] 6.4 Record DSH rc.7 tool-contract and runtime-context assumptions plus the required regression review on future DSH upgrades.

## 7. Validation and delivery

- [x] 7.1 Run package typecheck, all unit/integration tests, Host and Client builds, package manifest checks, and repository sync tests with zero failures.
- [x] 7.2 Validate and dry-run package installation in an isolated `DSH_HOME`, confirming one Loader row, required Host injections, Client bundle discovery, `ws` Skill materialization, and no schema-v1 load regression.
- [x] 7.3 Perform browser acceptance in a real Git repository: ordinary submit unchanged; Worktree submit creates one task worktree but no new Workspace/Session; subsequent file/Bash calls are confined; repeated turns add no duplicate runtime context. <!-- verified by verifying-acceptance: 2026-08-20; Loops 2–4 -->
- [x] 7.4 Exercise a real `lean → mutable` promotion and safe archived cleanup, proving UI/status updates without context churn and that the historical Session remains under the source Workspace after its worktree is removed. <!-- verified by verifying-acceptance: 2026-08-20; Loop 2 promote/context + Loop 4 safe cleanup -->
- [x] 7.5 Verify a pre-upgrade independent target Workspace/Session remains visible and safely maintainable without automatic migration. <!-- verified by verifying-acceptance: 2026-08-20; Loop 4 schema-v1 restart + GUI reuse -->
- [x] 7.6 Run `dsh build` to materialize the accepted package and Skill into the live profile, verify composed config, and ask the user to restart DSH rather than stopping the active Host automatically.
