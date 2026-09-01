## 1. Package and composition foundation

- [ ] 1.1 Scaffold `packages/dsh-pet/` as a local npm-workspace package with Host and Web entries, DSH bundle patch, exports, peer ranges, build/typecheck/test scripts, README, built-in Skill assets and independent-install metadata.
- [ ] 1.2 Add one reversible `source: local`, `type: package` Pet customization to `dsh.yaml` with version, brief and trust/runtime-state notes; cover manifest validation and generated profile wiring without changing `dsh-cockpit-bridge`.
- [ ] 1.3 Compose the package against the DSH version pinned by `dsh.yaml` and add a loader-composition test proving the Host service and client bundle load without any Cockpit package/source changes.
- [ ] 1.4 Implement the contained Pet Host lifecycle (`starting`, `ready`, `degraded`, `stopping`) and tests proving failed Pet initialization does not prevent ordinary DSH services from loading.
- [ ] 1.5 Resolve Pet runtime paths from the active DSH home, create owner-only state/workspace directories, and verify no runtime writes target the local package checkout, generated profile or Cockpit home.

## 2. Durable Pet domain

- [ ] 2.1 Define versioned schemas and TypeScript types for Pet Task, Invocation, source snapshot, Run, configuration/workspace binding and lifecycle/archival states.
- [ ] 2.2 Compose the standard DSH SQLite backend and route only the `dsh-pet` storage domain to `$DSH_HOME/plugins/dsh-pet/state.sqlite`, preserving all existing domain routes and failing Pet degraded on incompatible backend ownership.
- [ ] 2.3 Implement the Pet repository over `storage-domain`, including active-task lookup by scope key, epoch allocation, executor lookup, Invocation queue order and atomic record updates.
- [ ] 2.4 Enforce and test domain invariants: one unarchived Task per scope, one executor per Task, one current running/waiting Invocation, immutable snapshots, archived Tasks reject new Invocations, and Task status remains separate from archive state.
- [ ] 2.5 Add restart fixtures covering valid recovery, malformed/version-mismatched media, persistence write failure and explicit intermediate states without reporting uncertain work as successful.

## 3. Explicit Pet Skill installation and isolation

- [ ] 3.1 Define persisted installed-revision, selected-enabled-revision, shortcut visibility, skill-set generation, provenance and Invocation digest-reference records and invariants.
- [ ] 3.2 Implement immutable built-in Skill import from a package-owned manifest into the Pet state store, first-boot `defaultEnabled` selection, upgrade-as-available behavior, manifest hashing, staging, verification, atomic rename and no execution from `node_modules`.
- [ ] 3.3 Implement Host-absolute-path read-only Skill inspection plus separately confirmed bounded one-time bundle import, with canonical path validation, `SKILL.md`/frontmatter/name checks, symlink/path-escape/special-file rejection and file-count/per-file/total-size limits.
- [ ] 3.4 Implement enable, disable, upgrade and uninstall semantics plus same-directory temporary symlink/atomic-rename projection from Pet Workspace `.dsh/skills/<name>` to the selected immutable store revision, with resolved-target containment/digest validation and no copying to `.agents` or provider-specific directories.
- [ ] 3.5 Implement the scoped Pet allowlist Skill provider, catalog, loader and explicit `/<name>` injection boundary, omitting or shadowing broad `tool-skill` behavior and rejecting global/disabled/revision-mismatched Skills.
- [ ] 3.6 Bind every Invocation to an immutable Skill digest, publish replacement catalogs after configuration changes, retain referenced old revisions and add garbage collection only for unreferenced revisions.
- [ ] 3.7 Detect store/allowlist/Workspace projection drift at startup and on mutation, fail closed for affected Skills, and implement an explicit verified projection rebuild.
- [ ] 3.8 Add tests for DSH discovery through managed directory symlinks, broken/out-of-store/non-link projection rejection, global same-name Skills, multiple LLM providers sharing one projection, imported-source mutation, upgrade during queued work, disabled explicit invocation, atomic failure recovery and digest retention.

## 4. Pet Workspace and executor session lifecycle

- [ ] 4.1 Implement idempotent preparation and registration of the Pet-owned `DSH Pet` Workspace at the stable state path.
- [ ] 4.2 Implement preallocated Task/executor IDs and the recoverable create sequence from persisted `creating-executor` state through ordinary root Agent/session creation, workspace membership and stored association.
- [ ] 4.3 Install Pet standing instructions and validated provider/model selection for executor Agents, with an optional configured Pet preset and a package-owned fallback composition that reuses the current Host LLM registry.
- [ ] 4.4 Generate bounded relationship titles containing Pet marker, source/independent snapshot, short identity and epoch; prove user renaming does not affect stored routing or Task grouping.
- [ ] 4.5 Add tests for provider/model unavailable diagnostics, logged-in subscription-provider selection without credential access, conflicting preallocated session recovery and executor session visibility in the Pet Workspace.

## 5. Source capture and trusted context

- [ ] 5.1 Define the immutable Web-to-Host Invocation capture contract for `session`, `workspace` and `none` sources, including source removal/override and stable client invocation IDs.
- [ ] 5.2 Implement Host validation and enrichment of browser-captured session/workspace metadata with a durable event-sequence anchor before any Agent prompt can be queued.
- [ ] 5.3 Add a bounded Source Context Provider registry and base provider for DSH session/workspace facts.
- [ ] 5.4 Add an optional Worktree Session context adapter that resolves managed execution root, branch, dependency mode and lifecycle through the installed Worktree contract and fails diagnostically instead of inferring from `cwd`.
- [ ] 5.5 Persist one fresh snapshot for every user-created Invocation and test immediate page switching, later source evolution, independent source, optional source removal and same-snapshot internal retries.
- [ ] 5.6 Register the zero-argument executor-bound `pet_context` tool and test valid current Invocation lookup plus fail-closed behavior for ordinary sessions, archived Tasks, missing/ambiguous current work and attempted target substitution.

## 6. Invocation coordinator and Agent execution

- [ ] 6.1 Implement the Host capability registry and read-only projection with capability ID, label/icon/description, Skill name, context requirement, confirmation policy, availability and diagnostic.
- [ ] 6.2 Implement create-or-reuse Task behavior for session/workspace/independent scopes and the rule that archived Tasks produce a new epoch/executor rather than being reactivated.
- [ ] 6.3 Render the visible first and subsequent Pet Invocation envelopes with Task/Invocation IDs, source summary, snapshot anchor and instruction to call trusted context, while keeping the stored binding authoritative.
- [ ] 6.4 Dispatch digest-bound `/<skill-name>` envelopes through the ordinary Host Agent followup/flush lifecycle and Pet allowlist injection boundary, then project accepted, running, waiting, succeeded, failed, cancelled and recovering states from DSH events.
- [ ] 6.5 Implement the durable per-Task serial queue so new Invocations wait behind running or waiting-user work and current context switches atomically only after terminal settlement.
- [ ] 6.6 Implement Pet answer, cancel and retry operations: answers continue the current Invocation, transient retries create a new Run on the same snapshot, and a new user execution creates a new Invocation/snapshot.
- [ ] 6.7 Add crash/restart reconciliation tests for Task persisted before executor creation, executor created before association commit, prompt dispatch uncertainty, queue recovery and browser closure during execution.

## 7. Phase-one Agent capabilities and bounded side effects

- [ ] 7.1 Inspect the exact installed/public bounded tool contracts for Create MR, Lark/Codebase and Worktree Session, then author the three package-owned built-in Pet Skill bundles against those adapters.
- [ ] 7.2 Implement the `create-mr` capability as a session-required Agent Skill backed by trusted source/worktree resolution, explicit MR target/reviewer validation and bounded Codebase/MR side effects.
- [ ] 7.3 Implement the `send-cr` capability as a session-required Agent Skill backed by validated workspace→business/group/reviewer configuration, fixed structured rendering and a sender that never accepts model-provided raw destinations.
- [ ] 7.4 Implement the `clean-worktree` capability as a session-required Agent Skill that delegates to existing `ws` status/dry-run/clean safety gates and never bypasses dirty, merge or active-session checks.
- [ ] 7.5 Add deterministic adapter fakes and tests for clarification/waiting-user, missing external dependencies, invalid bindings, safe refusal, successful structured results and absence of real organizational side effects in CI.

## 8. Narrow Host management surface

- [ ] 8.1 Define strict schemas and stable error codes for Pet status, configuration, built-in/installed Skill revisions and management mutations, capability list, Task list/detail, Invocation creation, answer/cancel/retry, archive and navigation metadata.
- [ ] 8.2 Implement same-origin/loopback-constrained exact routes or a package-owned logical RPC channel with body limits, unknown-field rejection, idempotency/revision checks and no arbitrary DSH RPC, prompt, unrestricted filesystem path or channel target pass-through; local Skill import accepts only the dedicated validated import operation.
- [ ] 8.3 Implement a Pet change feed or generation-aware refresh signal and a reconnect baseline so Web never depends on polling or applies increments before complete state.
- [ ] 8.4 Add security tests proving responses redact credentials/secrets, non-loopback/untrusted origins fail closed and model/provider tokens never enter Pet storage or management payloads.

## 9. Floating Pet and task management UI

- [ ] 9.1 Build an accessible Pet visual prototype using DSH theme tokens and select the mascot asset plus compact panel presentation before final component implementation.
- [ ] 9.2 Register the additive root-scoped `shell.overlay` Pet surface with click-through surroundings, pointer-capture dragging, viewport clamping and persisted position across reload/session switches.
- [ ] 9.3 Implement the hover/focus radial capability menu with keyboard navigation, disabled diagnostics and context-requirement checks.
- [ ] 9.4 Implement the pre-execution source chip and chooser: current source is visible, optional source can be removed, no active session never falls back to recent, and required contexts block before Invocation creation.
- [ ] 9.5 Implement the Pet Task panel with current/all/archived source grouping, Invocation queue/status/results, source/executor navigation, answer/cancel/retry/archive actions and “open full process” instead of transcript mirroring; expose links to Settings but no Skill installation or binding editors.
- [ ] 9.6 Add responsive, dark/light, pointer and keyboard component tests plus client lifecycle tests proving Pet stays mounted through session, Hero and Settings transitions.

## 10. Settings and configuration

- [ ] 10.1 Register the Pet settings namespace and one dedicated section with stable General, Skills, Bindings and Diagnostics tabs, deep-linkable from the Pet overlay.
- [ ] 10.2 Implement General for appearance/position reset, default Agent preset/provider/model and new-Task context policy with revision-fenced validation, preserved input and no silent routing fallback.
- [ ] 10.3 Implement Skills for built-in installation, Host-path inspect/preview/confirmed import, immutable revision/provenance display, enable/disable, radial-shortcut visibility, upgrade/uninstall and projection status/rebuild.
- [ ] 10.4 Implement Bindings for trusted workspace/business/group/reviewer configuration with field-level validation and no arbitrary raw side-effect destinations.
- [ ] 10.5 Implement Diagnostics for Host lifecycle, dependency availability, runtime/store/workspace/projection paths, digests/drift and explicit repair results.
- [ ] 10.6 Ensure provider credentials remain owned by DSH provider/subscription plugins and add tests proving Pet settings never read, persist or display their tokens.
- [ ] 10.7 Document future channel secrets as protected references only and keep Channel Binding/reply UI and transport disabled in phase one.
- [ ] 10.8 Add settings navigation, accessibility, dark/light, validation-retention and Skill-management component/integration tests.

## 11. Archive and lifecycle reconciliation

- [ ] 11.1 Observe the durable DSH archive set and implement idempotent source-archive display updates without archiving the related Pet Task.
- [ ] 11.2 Implement terminal executor→Task and terminal Task→executor archive synchronization with revision guards and loop prevention.
- [ ] 11.3 Block non-terminal Task archival until explicit cancellation settles; keep externally archived running/waiting executor Tasks visible and diagnosable without inferring cancellation.
- [ ] 11.4 Add startup and live-event tests for every archive direction, archived Task rejection, new epoch creation and retention of Task records/snapshots/DSH logs.

## 12. Packaging, deployment and acceptance

- [ ] 12.1 Document product concepts (Pet vs Task vs Invocation vs source/executor session), explicit built-in/local Skill install and trust model, managed symlink projection, state/store/projection paths, ohmydsh manifest operation, independent DSH installation, rollback behavior, supported DSH range and organization-specific capability diagnostics.
- [ ] 12.2 Verify the package in an isolated DSH home/profile: first boot, four-tab Settings, built-in/local Skill install and allowlist isolation, managed-symlink drift recovery, degraded adapters, Pet Workspace/session creation, multiple skills on one Task, fresh snapshots, no-source Task, restart recovery and archive/new-epoch flow.
- [ ] 12.3 Run package build/typecheck/test/lint plus repository `npm test`, `npm run check:artifacts` and assembled no-key DSH snapshot/loader tests required by DSH-facing behavior changes; record exact results.
- [ ] 12.4 Run `node scripts/sync.mjs` or an isolated equivalent twice and prove the second materialization is idempotent, with no tracked `lib/`, generated profile, runtime database or Skill-store artifacts.
- [ ] 12.5 Build the affected installed DSH Web profile and verify the existing native DSH URL after refresh; do not start a replacement server, and verify Cockpit iframe use leaves the separate Cockpit server/shared/bridge contracts unchanged.
- [ ] 12.6 Ask before restarting the user's daily DSH Host; after confirmation, restart and repeat the core Pet/Settings/Task smoke flow on the existing URL.
