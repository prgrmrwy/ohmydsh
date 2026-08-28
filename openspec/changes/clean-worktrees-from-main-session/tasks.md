## 1. Regression Tests for Tool Entry Semantics

- [x] 1.1 Add a failing tool test proving `ws clean` from an unbound Session whose cwd is the repository main checkout does not resolve through the caller binding and instead invokes repository cleanup.
- [x] 1.2 Add failing tool tests proving a bound Worktree Session is refused with a main-session instruction, and `ws status`/`ws promote` retain their existing binding-required behavior.
- [x] 1.3 Add a failing tool test proving an unbound caller whose cwd is not the canonical main checkout is refused before any operation scan or deletion.

## 2. Repository Cleanup Coordinator

- [x] 2.1 Add wire result types for a repository-clean summary with deterministic `cleaned`, `refused`, and `ignored` entries and stable error details.
- [x] 2.2 Implement deterministic enumeration of the current repository's operation files, classifying cleaned/released history and preserving malformed or unsupported records as refused items without mutation.
- [x] 2.3 For each current source-session operation, require its source Session id to be in the Host-supplied archived set, then call the existing single-operation `wsClean` with trusted active paths and active bound Session ids.
- [x] 2.4 Make candidate failures independent: continue after dirty, active, in-flight, unmerged, unarchived, malformed, unsupported-schema, or Git failures and return the complete summary.

## 3. Model Tool Wiring

- [x] 3.1 Branch `registerWsTool` by action so `status`/`promote` keep `targetFor`, while `clean` validates an unbound canonical main-checkout Session and calls repository cleanup without exposing path or Session selectors to the model.
- [x] 3.2 Supply archived Session ids, active Session paths, and active bound Session ids from trusted Host services to the repository coordinator.
- [x] 3.3 Update the model-visible tool description and `skills/ws/SKILL.md` to state that clean runs from a same-repository ordinary main Session and scans archived safe Worktree Sessions.

## 4. Safety and Compatibility Coverage

- [x] 4.1 Add maintenance tests with multiple candidates proving all archived safe candidates are cleaned while dirty, active, in-flight, unmerged, unarchived, malformed, and unsupported candidates remain unchanged with reasons.
- [x] 4.2 Add tests proving zero eligible candidates returns a successful zero-clean summary and already cleaned/released tombstones are ignored without lifecycle regression.
- [x] 4.3 Re-run existing `wsClean`, HTTP clean, CLI, source-binding, archive lifecycle, and bin-entrypoint tests to prove explicit-path operator behavior and single-operation safety gates remain unchanged.

## 5. Documentation and Verification

- [x] 5.1 Update `worktree-session-architecture.md` so model clean is documented as main-checkout repository cleanup while the operator CLI remains explicit-path maintenance.
- [x] 5.2 Run the worktree-session package typecheck/build/test commands and the repository test suite; record exact commands and results.
- [x] 5.3 Run `openspec validate clean-worktrees-from-main-session --strict`, review the final diff for scope creep, and confirm no operation schema, public HTTP route, CLI behavior, remote branch, cache, or historical Session semantics changed.
