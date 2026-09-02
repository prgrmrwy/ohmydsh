## 1. Package and composition foundation

- [x] 1.1 Scaffold `packages/dsh-pet/` as a local npm-workspace package with Host and Web entries, DSH bundle patch, exports, peer ranges, build/typecheck/test scripts, README, built-in Skill assets and independent-install metadata.
- [x] 1.2 Add one reversible `source: local`, `type: package` Pet customization to `dsh.yaml` with version, brief and trust/runtime-state notes; cover manifest validation and generated profile wiring without changing `dsh-cockpit-bridge`.
- [x] 1.3 Compose the package against the DSH version pinned by `dsh.yaml` and add a loader-composition test proving the Host service and client bundle load without any Cockpit package/source changes.

  `test/loader-composition.test.ts` (12 cases) loads the REAL plugin entry
  through cordis the way the DSH loader does, rather than hand-assembling its
  parts: it asserts the exported loader contract, that `inject` matches the
  bundle patch exactly, that the Host reaches ready and registers only exact
  `/dsh-pet/api/*` routes, that first boot creates the state tree and installs
  and projects the declared built-in Skill, that a missing sqlite backend
  degrades without registering routes or throwing, that `apply` never rejects
  and emits no unhandled rejection when initialization fails, and that the
  built `lib/client.js` evaluates against a stub module loader and exports the
  client plugin contract with no Cockpit dependency.

  This suite caught two startup-breaking defects the other 266 tests missed,
  both of which would have degraded Pet on a real Host:

  1. `inject` omitted `storage`, while `verifyBackendOwnership` reads
     `ctx.storage`. cordis denies property access to an undeclared service, so
     ownership verification failed with a misleading "backend is not
     registered" diagnostic. Fixed in `src/index.ts` and `cordis.patch.yml`.
  2. `verifyDatabaseLocation` treated a missing database file as foreign-medium
     ownership, but the SQLite backend materializes lazily — so every genuine
     first boot degraded. It now forces one durable write first, then proves
     the file landed at Pet's configured path.
- [x] 1.4 Implement the contained Pet Host lifecycle (`starting`, `ready`, `degraded`, `stopping`) and tests proving failed Pet initialization does not prevent ordinary DSH services from loading.
- [x] 1.5 Resolve Pet runtime paths from the active DSH home, create owner-only state/workspace directories, and verify no runtime writes target the local package checkout, generated profile or Cockpit home.

## 2. Durable Pet domain

- [x] 2.1 Define versioned schemas and TypeScript types for Pet Task, Invocation, source snapshot, Run, configuration/workspace binding and lifecycle/archival states.
- [x] 2.2 Compose the standard DSH SQLite backend and route only the `dsh-pet` storage domain to `$DSH_HOME/plugins/dsh-pet/state.sqlite`, preserving all existing domain routes and failing Pet degraded on incompatible backend ownership.
- [x] 2.3 Implement the Pet repository over `storage-domain`, including active-task lookup by scope key, epoch allocation, executor lookup, Invocation queue order and atomic record updates.
- [x] 2.4 Enforce and test domain invariants: one unarchived Task per scope, one executor per Task, one current running/waiting Invocation, immutable snapshots, archived Tasks reject new Invocations, and Task status remains separate from archive state.
- [x] 2.5 Add restart fixtures covering valid recovery, malformed/version-mismatched media, persistence write failure and explicit intermediate states without reporting uncertain work as successful.

## 3. Explicit Pet Skill installation and isolation

- [x] 3.1 Define persisted installed-revision, selected-enabled-revision, shortcut visibility, skill-set generation, provenance and Invocation digest-reference records and invariants.
- [x] 3.2 Implement immutable built-in Skill import from a package-owned manifest into the Pet state store, first-boot `defaultEnabled` selection, upgrade-as-available behavior, manifest hashing, staging, verification, atomic rename and no execution from `node_modules`.
- [x] 3.3 Implement Host-absolute-path read-only Skill inspection plus separately confirmed bounded one-time bundle import, with canonical path validation, `SKILL.md`/frontmatter/name checks, symlink/path-escape/special-file rejection and file-count/per-file/total-size limits.
- [x] 3.4 Implement enable, disable, upgrade and uninstall semantics plus same-directory temporary symlink/atomic-rename projection from Pet Workspace `.dsh/skills/<name>` to the selected immutable store revision, with resolved-target containment/digest validation and no copying to `.agents` or provider-specific directories.
- [x] 3.5 Implement the scoped Pet allowlist Skill provider, catalog, loader and explicit `/<name>` injection boundary, omitting or shadowing broad `tool-skill` behavior and rejecting global/disabled/revision-mismatched Skills.

  A follow-up audit found the registration calling the WRONG registry method:
  `skills.register(skill)` contributes one single runtime skill, while a
  provider must use `skills.registerProvider(create)` — a factory receiving
  the registration control. Verified against the installed registry: the old
  call throws `TypeError` inside `dsh-skill`, and because it ran inside agent
  `setup`, executor creation itself would have failed and every Invocation
  with it. Now registered through `registerProvider` with no cast, and
  covered by a test that mounts the provider on a real `SkillRegistry` and
  asserts the allowlist is served and removed on disposal.

  The provider itself lives in `src/host/skill-provider.ts`, and it is now
  actually INSTALLED on every executor Agent: `PetCoordinator` accepts an
  `executorSetup` composition and passes it into ordinary Agent creation, and
  the Host entry registers the allowlist provider on the scoped agent context
  (never the Host context) inside that callback. The factory awaits `setup`
  before publishing the session and agent, so the scope exists before the
  first prompt is assembled.

  A second gap in the same area: `resolveInvocationSkill` — the explicit
  `/<name>` injection boundary — was also never called, so dispatch never
  proved the Invocation's FIXED digest was still resolvable. An uninstalled,
  disabled or tampered revision would have had its `/<name>` envelope sent to
  the Agent anyway. The coordinator now verifies before any state moves and,
  on failure, marks the Invocation failed with the diagnostic and returns the
  Task to idle so later work still runs. Three cases in
  `test/coordinator.test.ts` cover this, and all three were verified to FAIL
  when the check is removed.

  An audit found this wiring MISSING: `createPetSkillProvider` was exported
  but never called, so executors would have inherited DSH's global Skill
  discovery and Pet's isolation boundary would have existed only on paper.
  Covered now by `test/executor-scope.test.ts` (5 cases) plus an end-to-end
  case in `test/loader-composition.test.ts` that drives a real Invocation
  through the actual plugin routes and asserts the created executor carries
  the Pet composition and the Pet Workspace cwd.
- [x] 3.6 Bind every Invocation to an immutable Skill digest, publish replacement catalogs after configuration changes, retain referenced old revisions and add garbage collection only for unreferenced revisions.

  Garbage collection was UNREACHABLE: `collectableRevisions` and
  `deleteSkillRevision` had no caller because the skill-mutation route had no
  `uninstall` action at all (tasks 3.4 / 10.3 both require one). Added the
  action, ordered so it first removes the Skill from future use and from the
  shortcut menu, then collects only what `collectableRevisions` proves
  unreferenced, deleting the physical revision through a new
  store-contained `removeRevisionDirectory`. A digest fixed by an unarchived
  Task or a non-terminal Invocation is retained, so queued work still runs the
  exact version it accepted. Surfaced in the Settings Skills tab and covered
  by four cases in `test/skill-allowlist.test.ts` plus two UI cases.
- [x] 3.7 Detect store/allowlist/Workspace projection drift at startup and on mutation, fail closed for affected Skills, and implement an explicit verified projection rebuild.
- [x] 3.8 Add tests for DSH discovery through managed directory symlinks, broken/out-of-store/non-link projection rejection, global same-name Skills, multiple LLM providers sharing one projection, imported-source mutation, upgrade during queued work, disabled explicit invocation, atomic failure recovery and digest retention.

## 4. Pet Workspace and executor session lifecycle

- [x] 4.1 Implement idempotent preparation and registration of the Pet-owned `DSH Pet` Workspace at the stable state path.
- [x] 4.2 Implement preallocated Task/executor IDs and the recoverable create sequence from persisted `creating-executor` state through ordinary root Agent/session creation, workspace membership and stored association.
- [x] 4.3 Install Pet standing instructions and validated provider/model
  selection for executor Agents, reusing the current Host LLM registry.

  Terminology, because two different things were both being called "preset":

  - **Pet standing instructions** — Pet's own durable context, written to
    `AGENTS.md` in the Pet Workspace (`host/workspace.ts`). This is the
    "startup briefing": it tells the executor it is a Pet Task Agent, that one
    session carries multiple serial Invocations, that finishing one does not
    end the Task, and that authority comes only from `pet_context`. Combined
    with the per-Invocation envelope (`host/envelope.ts`), which carries the
    Task/Invocation ids, source label, repository root, managed execution root
    and snapshot id, this is what actually establishes Pet's context.
  - **DSH Agent preset** — a DSH concept Pet does not own: a named plugin
    composition selected by `AgentOptions.agentPreset`. Pet only passes the
    user's choice through, enumerated from `ctx.agentPresets.list()`.

  NOT built, deliberately: a package-owned fallback composition. Since 7.6
  removed the bespoke `pet_*` tools, a Pet executor needs nothing beyond the
  ordinary DSH tools an installed Skill drives, so the Host default
  composition is already correct. Shipping a Pet-specific composition would
  make Pet a privileged container again for no proven benefit. Revisit only
  with a concrete requirement — for example deliberately narrowing an
  executor's tool surface.

  `validateModelSelection` was also dead: the Host only checked that a
  provider/model was CONFIGURED, never that it was routable, so an unroutable
  selection would have failed deep inside Agent creation instead of
  diagnostically. Selection now runs through the validator against
  `ctx.llm.listProviders()`. `LlmProviderInfo` carries only `id`/`name`, so
  the check is provider-level and the doc comment was corrected to stop
  implying model-level validation. Verified end-to-end: configuring an
  unroutable provider makes an Invocation fail with `MODEL_UNAVAILABLE` and
  creates no executor — Pet never falls back to another provider.
- [x] 4.4 Generate bounded relationship titles containing Pet marker, source/independent snapshot, short identity and epoch; prove user renaming does not affect stored routing or Task grouping.

  A dead-export audit found `titleForTask` never called: executor sessions
  were created but NEVER renamed, so every Pet session showed a default title
  and epochs of one source were indistinguishable. The coordinator now applies
  the generated title through `ctx.sessionTitle.rename` right after executor
  creation. Renaming is cosmetic by contract, so a failure is swallowed and
  the Invocation still runs, and the title is applied only when the executor
  is created — a later user rename survives subsequent Invocations. Covered by
  three cases in `test/executor-scope.test.ts`.
- [x] 4.5 Add tests for provider/model unavailable diagnostics, logged-in subscription-provider selection without credential access, conflicting preallocated session recovery and executor session visibility in the Pet Workspace.

## 5. Source capture and trusted context

- [x] 5.1 Define the immutable Web-to-Host Invocation capture contract for `session`, `workspace` and `none` sources, including source removal/override and stable client invocation IDs.
- [x] 5.2 Implement Host validation and enrichment of browser-captured session/workspace metadata with a durable event-sequence anchor before any Agent prompt can be queued.
- [x] 5.3 Add a bounded Source Context Provider registry and base provider for DSH session/workspace facts.
- [x] 5.4 Add an optional Worktree Session context adapter that resolves managed execution root, branch, dependency mode and lifecycle through the installed Worktree contract and fails diagnostically instead of inferring from `cwd`.

  The adapter existed but was never REGISTERED, so no snapshot ever carried
  managed-worktree facts and `clean-worktree` saw only the repository root.
  It is now registered on the source-context registry whenever the Worktree
  Session maintenance module resolves, reading `wsStatus` per source session;
  an unbound session yields no worktree fields rather than a provider fault.
- [x] 5.5 Persist one fresh snapshot for every user-created Invocation and test immediate page switching, later source evolution, independent source, optional source removal and same-snapshot internal retries.
- [x] 5.6 Register the zero-argument executor-bound `pet_context` tool and test valid current Invocation lookup plus fail-closed behavior for ordinary sessions, archived Tasks, missing/ambiguous current work and attempted target substitution.

  An audit of the `as never` casts on tool registration found the schemas
  written against an invented contract. `parameters` is a FLAT property map
  (an implicit open object root with per-property `required: true`), but Pet
  passed a raw JSON Schema object. Verified against the installed runtime:
  the old shape throws `JsonSchemaError: parameters.type must be a value
  schema object`, so BOTH Pet tools failed to register — including
  `pet_context`, which the standing instructions require on every Invocation.

  Both tools now go through `defineTool`, so the schemas are compile-time
  checked and the casts are gone. Confirmed the compiled output is correct:
  `pet_context` → `{ type: 'object', properties: {} }`, `pet_clean_worktree`
  → a single boolean `confirm`. Guarded in `test/executor-scope.test.ts`,
  including a case asserting the previously shipped raw-JSON-Schema shape
  still throws.

## 6. Invocation coordinator and Agent execution

- [x] 6.1 Implement the Host capability registry and read-only projection with capability ID, label/icon/description, Skill name, context requirement, confirmation policy, availability and diagnostic.
- [x] 6.2 Implement create-or-reuse Task behavior for session/workspace/independent scopes and the rule that archived Tasks produce a new epoch/executor rather than being reactivated.
- [x] 6.3 Render the visible first and subsequent Pet Invocation envelopes with Task/Invocation IDs, source summary, snapshot anchor and instruction to call trusted context, while keeping the stored binding authoritative.
- [x] 6.4 Dispatch digest-bound `/<skill-name>` envelopes through the ordinary Host Agent followup/flush lifecycle and Pet allowlist injection boundary, then project accepted, running, waiting, succeeded, failed, cancelled and recovering states from DSH events.

  An audit against the installed `dsh-agent-loop` types found the dispatcher
  using an invented API: it called `followup(text: string)` and awaited a
  Promise, but the real contract is `followup(input: UserMessage): void`. The
  dispatcher now builds a real message with `createUserMessage` (role `user`,
  source `{ kind: 'user' }`, stable id), calls the synchronous `followup`, and
  flushes by awaiting the agent's `whenIdle()` boundary. Locked by an
  end-to-end case in `test/loader-composition.test.ts` asserting the submitted
  value is a structured `UserMessage` whose first content block still begins
  with the `/clean-worktree` token that drives the ordinary Skill pre-step.
- [x] 6.5 Implement the durable per-Task serial queue so new Invocations wait behind running or waiting-user work and current context switches atomically only after terminal settlement.
- [x] 6.6 Implement Pet answer, cancel and retry operations: answers continue the current Invocation, transient retries create a new Run on the same snapshot, and a new user execution creates a new Invocation/snapshot.
- [x] 6.7 Add crash/restart reconciliation tests for Task persisted before executor creation, executor created before association commit, prompt dispatch uncertainty, queue recovery and browser closure during execution.

## 7. Phase-one Agent capabilities and bounded side effects

- [x] 7.1 Inspect the exact installed/public bounded tool contracts for Create MR, Lark/Codebase and Worktree Session, then author the three package-owned built-in Pet Skill bundles against those adapters.

  All three contracts were inspected on this machine rather than assumed:
  `bytedcli codebase mr create` (`--repo/--head/--base/--title/--body/
  --reviewer-ids/--push`), `lark-cli im +messages-send` (`--chat-id/--text/
  --idempotency-key`), and Worktree Session's `wsStatus`/`wsClean`. All three
  bundles are authored against those exact surfaces and declared in the
  package manifest, and a first boot installs, enables and projects all three.

- [x] 7.11 A Skill carries one free-text argument string, appended after the
  skill token on every dispatch. Configurable when adding the Skill and
  editable afterwards, because the right arguments are usually discovered by
  running it once.

  Replaced an earlier design where the Skill declared named parameters in its
  frontmatter and Pet rendered one field each. That was more machinery for no
  gain: the consumer is an LLM reading the Skill's own instructions, so
  `/ws clean` is already unambiguous and a schema only constrains what the
  user may type. Pet stores the string verbatim, caps it at 500 characters,
  and never parses it.

  It must ride on the skill-token line — that line drives real Skill
  injection, so putting arguments in a separate section would invoke the Skill
  with no argument at all.

- [x] 7.11-superseded Skills declare the parameters they need, and Pet collects them at
  add time. `SKILL.md` frontmatter carries `petParams: name:Label, other`;
  inspection surfaces the declaration, the add form renders one field per
  parameter, and the values are persisted with the registration and injected
  into every Invocation envelope as a "Configured parameters" section.

  This is the mechanism 7.8 deliberately left open when the Bindings page was
  removed. It puts the declaration where the requirement lives — in the Skill
  — instead of in a Pet-side page that has to guess what Skills might want.

  The two halves stay decoupled: Pet supports INJECTING values, and the Skill
  decides what they mean. Pet reserves no parameter name, validates none of
  them beyond the identifier shape, and carries the values verbatim. A Skill
  needing a chat id, a retention window or a tone declares whichever names it
  wants, and the user supplies the values — none of that reaches Pet's code.

  Boundaries, verified in a real booted Host: only declared names are stored
  (an undeclared key sent alongside `chatId` was dropped); a name must be a
  plain identifier, since it becomes a storage key and is echoed into the
  envelope; duplicates collapse and the count is capped at 8.

- [x] 7.8 Removed the Bindings surface entirely. It configured a workspace id,
  a `business` tag and a CR chat id — but `business` had ZERO readers anywhere
  in the repository, and after the per-capability adapters were removed in 7.6
  nothing read bindings at all. The page therefore accepted settings that
  could never take effect, which is worse than not offering them. Dropped the
  tab, both routes, the repository accessors, the `workspace_bindings` table
  and the wire types.

  Follow-up left open deliberately: how a Skill such as `send-cr` learns its
  destination. Two candidate shapes — several `workspace -> chat` mappings, or
  per-Skill parameters supplied when the Skill is added — are not yet decided,
  so no half-built mechanism was left behind in the meantime.

- [x] 7.9 Directory selection now degrades instead of appearing dead.
  `host.pickDirectory` requires the `native` capability; this deployment only
  serves `browse`, so the call was rejected and the Browse button did nothing
  visible. The rejection is now swallowed and falls through to an in-app
  directory browser built on `host.listDirectory` (crumbs, child directories,
  "select this directory"); a deployment offering neither says so plainly
  rather than failing silently.

- [x] 7.10 The Agent preset is enumerated from `ctx.agentPresets.list()`
  instead of typed free-hand, so it cannot name a composition that does not
  exist. Adding `agentPresets` to `inject` also required providing it in every
  loader-composition test block — `apply` waits for every declared service, so
  a missing one silently registers no routes at all.

- [x] 7.7 MODEL CHANGE — Skills are LINKED, not copied, and Pet ships no
  built-in category. Registering a Skill records the user's own directory and
  projects a symlink to it, so an edit to that directory takes effect on the
  next Invocation with no reinstall. Removed `builtins.ts`, the packaged
  manifest, the content-addressed store copy, digest computation and
  verification, the upgrade flow, multi-revision retention and its garbage
  collection. The three packaged Skills moved to `skills/examples/` and are no
  longer installed automatically; a user adds them like any other Skill.

  Deliberately traded away, at the user's explicit direction: content is no
  longer pinned, so a source edit can change what a queued Invocation runs, and
  deleting or moving the source directory breaks that Skill. Retained: the
  allowlist provider is still the authorization boundary (never the
  projection), a bundle containing symlinks or a relative path is still
  rejected, and a broken or substituted projection still fails closed with a
  diagnostic.

  Verified in a real booted Host: registering links the user's directory with
  provenance `local-link` and no store copy; editing `SKILL.md` afterwards is
  visible through the projection immediately; moving the directory away is
  reported as broken; and removing the Skill leaves the user's directory
  untouched.

- [x] 7.6 Pet ships NO per-capability adapter. A capability exists because a
  Skill is installed and enabled — adding one is an install, never a code
  change. The Skill declares its own presentation and context requirement in
  `SKILL.md` frontmatter (`petLabel`, `petIcon`, `petContext`, `petConfirm`),
  persisted with the immutable revision so queued work keeps what it accepted;
  an unrecognized `petContext` falls back to `optional` so a bundle cannot
  widen its own authority by typo.

  Removed `create-mr.ts`, `send-cr.ts`, `clean-worktree.ts` and
  `bounded-command.ts` (~675 lines) along with the tools `pet_create_mr`,
  `pet_send_cr` and `pet_clean_worktree`. Exactly ONE tool remains,
  `pet_context`, which hands a Skill its authorized snapshot; the Skill then
  drives ordinary DSH tools and owns its own bounded behavior — including the
  destination and confirmation discipline that used to live in Pet. The three
  built-ins were rewritten to do exactly that, with `clean-worktree` driving
  the existing `ws` Skill's gated `scripts/ws.sh clean` rather than
  reimplementing Worktree Session's safety gates.

  Worktree status remains a Host concern but only as snapshot ENRICHMENT
  (`worktree-status.ts`): it tells `pet_context` where the managed execution
  root is, so a Skill never has to guess. Pet performs no worktree effects.

  An optional Host declaration may still ANNOTATE a Skill-derived entry (a
  probe proving an organization dependency is absent), but it can never create
  one — covered by a test asserting a declaration with no installed Skill
  behind it projects nothing.

- [x] 7.2 Implement the `create-mr` capability as a session-required Agent Skill backed by trusted source/worktree resolution, explicit MR target/reviewer validation and bounded Codebase/MR side effects.

  The repository and branch come only from the Invocation snapshot — the tool
  exposes no repository or branch parameter, so a model cannot retarget the
  MR. The managed worktree execution root and its task branch win over the
  session header cwd when present. Effects run through a shared bounded
  runner using `execFile` with a fixed argv array (never a shell string), a
  timeout and capped output, so model-supplied titles and bodies containing
  shell metacharacters stay inert data. Title/body/reviewer bounds are
  enforced before the CLI is touched, and a CLI refusal is returned verbatim
  rather than retried differently.
- [x] 7.3 Implement the `send-cr` capability as a session-required Agent Skill backed by validated workspace→business/group/reviewer configuration, fixed structured rendering and a sender that never accepts model-provided raw destinations.

  The destination is the security boundary and is resolved exclusively from
  the trusted workspace binding: the tool has no chat/group/user parameter at
  all, so there is nothing for a model to supply. A source without a
  configured binding fails with `BINDING_INVALID` and sends nothing. The
  message body is a fixed Pet template carrying source, MR link and an
  optional note, always identifying itself as sent by Pet, and each send
  carries an Invocation-derived idempotency key so a retry cannot double-post.
- [x] 7.4 Implement the `clean-worktree` capability as a session-required Agent Skill that delegates to existing `ws` status/dry-run/clean safety gates and never bypasses dirty, merge or active-session checks.
- [x] 7.5 Add deterministic adapter fakes and tests for clarification/waiting-user, missing external dependencies, invalid bindings, safe refusal, successful structured results and absence of real organizational side effects in CI.

  `test/capabilities.test.ts` adds 20 cases for the two organization-specific
  adapters, all driven by a deterministic fake runner so CI opens no merge
  request and sends no message. They cover missing external dependencies,
  trusted target resolution (including worktree execution root preference),
  shell metacharacters staying inert argv data, non-Pet callers, missing
  context, invalid input rejected before the CLI runs, verbatim refusals,
  invalid bindings, and the fixed message template.

  Previously done for `clean-worktree` in `test/clean-worktree.test.ts` (19 cases): a
  deterministic fake reproduces the exact `wsClean` refusal messages, and the
  tests cover missing Worktree Session, non-Pet callers, missing session source
  or repository root, mandatory dry-run preview, verbatim refusal surfacing for
  all six gate reasons, no destructive call after a refusal, and no real Git or
  network effect in CI. The Create MR and Send CR halves follow tasks 7.2/7.3.

## 8. Narrow Host management surface

- [x] 8.1 Define strict schemas and stable error codes for Pet status, configuration, built-in/installed Skill revisions and management mutations, capability list, Task list/detail, Invocation creation, answer/cancel/retry, archive and navigation metadata.
- [x] 8.2 Implement same-origin/loopback-constrained exact routes or a package-owned logical RPC channel with body limits, unknown-field rejection, idempotency/revision checks and no arbitrary DSH RPC, prompt, unrestricted filesystem path or channel target pass-through; local Skill import accepts only the dedicated validated import operation.
- [x] 8.3 Implement a Pet change feed or generation-aware refresh signal and a reconnect baseline so Web never depends on polling or applies increments before complete state.

  The Host feed existed and mutations published to it, but an audit found the
  Web side never CONSUMED it: the Task panel fetched once on mount and then
  only after the user's own actions, so an Invocation settling in the
  background left the panel permanently stale. The panel now asks the cheap
  status route for the generation (sending the one it last adopted) and
  reloads the complete task list only when the Host answers `stale` — it never
  polls the expensive data routes and never applies an increment onto partial
  state. Guarded by two cases in `test/client.test.ts`.
- [x] 8.4 Add security tests proving responses redact credentials/secrets, non-loopback/untrusted origins fail closed and model/provider tokens never enter Pet storage or management payloads.

  Hardened `redactSecrets` while auditing it: as a boundary that runs on every
  successful response it must terminate on any input, but the original
  recursion overflowed the stack on a cyclic or pathologically deep payload.
  It now carries cycle and depth guards that collapse to `[circular]` /
  `[truncated]`, while shared (non-cyclic) sibling references are still walked
  normally. Pet's own records never reach either guard; the route wrapper was
  separately verified to answer 500 rather than hang even in the old form.

## 9. Floating Pet and task management UI

- [x] 9.1 Build an accessible Pet visual prototype using DSH theme tokens and select the mascot asset plus compact panel presentation before final component implementation.
- [x] 9.2 Register the additive root-scoped `shell.overlay` Pet surface with click-through surroundings, pointer-capture dragging, viewport clamping and persisted position across reload/session switches.

  An audit against the installed `dsh-client-ui-slots` types found the
  registration written against an invented API and never validated. Three
  compounding defects, all fixed:

  1. **Client program was never typechecked.** The parent tsconfig excludes
     `src/client`, and that `exclude` is INHERITED and beats the child's
     `include`, so `tsconfig.client.json` compiled only `wire.ts`. Every
     `ctx.*` was `any`. Fixed with `"exclude": []`; `tsc --showConfig` now
     lists all seven client files.
  2. **Wrong `register` arity.** Pet called
     `register('shell.overlay', { id, order }, Component)`, but the real
     contract is `register({ name, id, order }, Component)` — a load-time
     throw, so the overlay would never have rendered. With the program
     actually compiling, the old form is now a `TS2554` error.
  3. **Missing slot-contract dependencies.** `dsh-client-ui-layout` and
     `dsh-client-ui-settings` were imported for their `SlotMap` augmentations
     but not declared, so the slot keys were unchecked even once compilation
     was fixed. Both are now peer + dev dependencies.

  Registration also moved to `ctx.slots.inject(key, () => register(...))`,
  matching the sibling `system-clock` package: it waits for the slot
  declaration instead of registering into a slot the shell has not declared
  yet. The overlay component is now a module-scope component rather than an
  inline arrow, so React keeps one identity and Pet is not remounted (losing
  drag and panel state) on every session/Hero/Settings transition.

  Guarded by two cases in `test/client.test.ts` that assert the client
  program compiles every client file and that the slot-contract packages stay
  declared; both were verified to FAIL when the tsconfig regression is
  reintroduced.
- [x] 9.3 Implement the hover/focus radial capability menu with keyboard navigation, disabled diagnostics and context-requirement checks.

  `requiresConfirmation` was similarly inert: capabilities declare it (and
  `clean-worktree` sets it, because its effects are destructive) but the menu
  ran everything immediately. The menu now requires a second, explicit click
  for such a capability and labels the pending entry. Fixed a stale-closure
  bug found while wiring it — the confirmation state is read inside the run
  callback, so it must also be a dependency or the second click never observes
  the first.

  An accessibility pass against the requirement "all capabilities, task
  status, archival and context selection MUST be keyboard operable" found two
  real gaps. The menu opened only on `mouseEnter`, so a keyboard user could
  never reach the capabilities; it now also opens on focus and closes on blur
  only when focus genuinely leaves the Pet surface, so moving between the
  mascot and a menu item does not collapse it, with Escape closing from
  anywhere on the surface. Disabled reasons were carried by `title` alone,
  which assistive technology does not reliably announce; each reason is now
  bound as the control's accessible description, and the degraded badge
  announces its diagnostic through a `role="status"` live region with a
  visually hidden label instead of a hover-only tooltip.

  A behavior audit found `showAsShortcut` persisted and toggleable in
  Settings but IGNORED by the menu, so "Hide from menu" silently did nothing.
  The capability projection now carries the flag and the overlay renders only
  shortcut-visible entries. Visibility is presentation only and never an
  authorization boundary: a hidden capability stays installed, enabled and
  invocable, and a Skill that was never selected defaults to visible-but-
  unavailable with its diagnostic rather than disappearing. Covered by three
  cases in `test/coordinator.test.ts` plus one UI case.
- [x] 9.4 Implement the pre-execution source chip and chooser: current source is visible, optional source can be removed, no active session never falls back to recent, and required contexts block before Invocation creation.

  Once the client program was actually compiling (see 9.2), an audit against
  the installed client contracts found the source reader written entirely
  against invented shapes — it would have reported "no active session" always:

  - `sessions.list` / `workspaces.list` are `ObservableSnapshot`s; the state
    must be read with `getSnapshot()`. Pet was reading `.current` off the feed
    object itself, which is `undefined`.
  - `SessionListState` keys rows by `byId`, not an `items` array.
  - `WorkspaceView` identifies itself with `workspaceId`, not `id`.
  - untyped `ctx.get('sessions')` lookups bypassed the compiler entirely and
    are replaced by the typed `ctx.sessions` / `ctx.workspaces` faces.

  Also removed a dead control: the Task panel had a "Settings" button wired to
  an invented `settings.open(section, tab)`. DSH's real `openSection` belongs
  to the settings ONBOARDING slot and is not plugin-callable, so the button
  would have silently done nothing; the panel now points at
  "Manage in Settings → Pet" instead. Locked by three cases in
  `test/client.test.ts`.
- [x] 9.5 Implement the Pet Task panel with current/all/archived source grouping, Invocation queue/status/results, source/executor navigation, answer/cancel/retry/archive actions and “open full process” instead of transcript mirroring; expose links to Settings but no Skill installation or binding editors.

  A second scenario pass found two more gaps in the same panel. Source
  navigation was missing entirely — spec 9.5 requires opening the source AND
  the executor, but only the executor had a control and `TaskView` did not
  even carry `sourceId`. An "Open source" control is now offered for
  session-sourced Tasks, disabled with a reason when the source was archived
  (the Task and its history remain), and absent for independent Tasks.

  The panel also had no notion of the CURRENT source: it offered only
  active/archived, so the scenario "show the current source's Task, then
  switch to all/archived" was unmet. Views are now Current / All / Archived,
  with "current" matched on the same `scopeKey` the Host routes on — so it
  shows exactly the Task that source would reuse, and the executor session is
  never mistaken for a source. Tasks are labelled by source kind when listing
  every source.

  A scenario audit found the ANSWER affordance missing: the panel shipped
  cancel, retry and archive, and the Host route existed, but a `waiting-user`
  Invocation could not be answered from Pet at all. The panel now shows a
  labelled answer field only while a Task waits, submitting through the
  existing route. Verified against the coordinator that an answer continues
  the CURRENT Invocation and does not preempt queued work, and that answering
  is refused when nothing waits or the Task is unknown. Complex interactions
  still belong in the native session, which “open full process” reaches.
- [x] 9.6 Add responsive, dark/light, pointer and keyboard component tests plus client lifecycle tests proving Pet stays mounted through session, Hero and Settings transitions.

## 10. Settings and configuration

- [x] 10.1 Register the Pet settings namespace and one dedicated section with stable General, Skills, Bindings and Diagnostics tabs, deep-linkable from the Pet overlay.
- [x] 10.2 Implement General for appearance/position reset, default Agent preset/provider/model and new-Task context policy with revision-fenced validation, preserved input and no silent routing fallback.

  A behavior audit found `defaultContextPolicy` persisted, validated and
  DISPLAYED, but never editable and never applied — choosing a policy could
  not happen, and would have had no effect if it had. General now offers it as
  a control, and the overlay applies it: with `none`, a new Task starts
  unattached (the current session is pre-removed rather than pre-selected), so
  an optional-context capability runs independently unless the user picks a
  source.
- [x] 10.3 Implement Skills for built-in installation, Host-path inspect/preview/confirmed import, immutable revision/provenance display, enable/disable, radial-shortcut visibility, upgrade/uninstall and projection status/rebuild.

  `installBuiltins` recorded `upgradeAvailableDigest` on first boot, but the
  Skills tab never displayed or applied it, so a packaged upgrade was
  unreachable — the user could not perform the explicit adoption task 3.2
  requires. The tab now shows an "upgrade available" marker and an Upgrade
  button only while one is pending, applying it through the existing
  `upgrade` action. Verified that applying it replaces the whole selection
  row, clearing the pending marker and bumping the skill-set generation so
  catalogs republish; already-queued Invocations keep their fixed digest.
- [x] 10.4 Implement Bindings for trusted workspace/business/group/reviewer configuration with field-level validation and no arbitrary raw side-effect destinations.
- [x] 10.5 Implement Diagnostics for Host lifecycle, dependency availability, runtime/store/workspace/projection paths, digests/drift and explicit repair results.
- [x] 10.6 Ensure provider credentials remain owned by DSH provider/subscription plugins and add tests proving Pet settings never read, persist or display their tokens.
- [x] 10.7 Document future channel secrets as protected references only and keep Channel Binding/reply UI and transport disabled in phase one.
- [x] 10.8 Add settings navigation, accessibility, dark/light, validation-retention and Skill-management component/integration tests.

## 11. Archive and lifecycle reconciliation

- [x] 11.1 Observe the durable DSH archive set and implement idempotent source-archive display updates without archiving the related Pet Task.

  Reconciliation previously ran ONLY at startup, so a session archived
  natively while Pet was running was not reflected until a restart. Added
  `registerArchiveObserver`, following the audited `worktree-session`
  pattern: seed from the registry snapshot, then diff the archived set on
  `domain/changed` writes to the workspace domain global (`table`/`key` are
  `''` for a global-singleton put), serializing reconciliation on a tail
  promise and logging failures instead of breaking the observer. Verified
  against the real `workspaceDomainSpec` (domain name `workspace`) and the
  real `DomainChangedPut` shape, with four cases in `test/archive.test.ts`
  covering native executor archive, source-only display update, ignored
  foreign/non-global writes, and disposal.
- [x] 11.2 Implement terminal executor→Task and terminal Task→executor archive synchronization with revision guards and loop prevention.

  An audit found the Task→executor direction UNWIRED: `archiveTaskFromPet`
  (which performs the sync) was exported but never called, and the archive
  route went straight to `repository.archiveTask`. Archiving a Task from the
  Pet panel therefore left its executor session live and the two sides
  diverged. The route now goes through `archiveTaskFromPet` with a real
  `archiveSink` backed by `workspaceRegistry.archiveSession`.

  Covered end-to-end in `test/loader-composition.test.ts`, driving the real
  routes: a running Task is refused with `ARCHIVE_BLOCKED` and archives
  nothing, and after cancellation settles the archive call also archives the
  exact executor session. That test was verified to FAIL when the direct
  `repository.archiveTask` call is reintroduced.
- [x] 11.3 Block non-terminal Task archival until explicit cancellation settles; keep externally archived running/waiting executor Tasks visible and diagnosable without inferring cancellation.
- [x] 11.4 Add startup and live-event tests for every archive direction, archived Task rejection, new epoch creation and retention of Task records/snapshots/DSH logs.

## 12. Packaging, deployment and acceptance

- [x] 12.1 Document product concepts (Pet vs Task vs Invocation vs source/executor session), explicit built-in/local Skill install and trust model, managed symlink projection, state/store/projection paths, ohmydsh manifest operation, independent DSH installation, rollback behavior, supported DSH range and organization-specific capability diagnostics.
- [x] 12.2 Verify the package in an isolated DSH home/profile: first boot, four-tab Settings, built-in/local Skill install and allowlist isolation, managed-symlink drift recovery, degraded adapters, Pet Workspace/session creation, multiple skills on one Task, fresh snapshots, no-source Task, restart recovery and archive/new-epoch flow.

  An eighth pass stress-tested admission and found a genuine concurrency
  defect: two simultaneous invocations for one source both observed "no active
  Task", both tried to create one, and the second failed the
  one-Task-per-scope invariant with an opaque `INTERNAL`. Sequential HTTP
  probing had masked it; only truly parallel in-process calls exposed it.
  Admission is now serialized per scope key, so the second caller observes the
  Task the first created and reuses it — which is what the user asked for —
  while different scopes never contend. Three cases in
  `test/coordinator.test.ts` pin unique contiguous queue positions, at most
  one active Invocation per Task, and the one-executor-per-Task invariant
  under parallel load; all three fail without the serialization.

  A seventh live pass exercised retry and found a race the event wiring
  exposed: dispatch claimed the serial slot and then promoted the Invocation
  to `running`, but a synchronous `turn/end` from the just-started attempt
  could settle it in between. The settled-record guard then threw out of the
  CALLER's request, so `invocation-retry` returned
  `INVALID_REQUEST: already settled as failed` even though the retry had in
  fact run — the run record proved a second attempt existed. Both transitions
  are now best-effort: losing the race means another path already owns the
  outcome, so dispatch stops quietly and reports the record's real state
  instead of failing the request.

  Verified live after the fix: retry returns `ok: true`, reuses the same
  Invocation and the same snapshot, and the Task ends with 1 invocation,
  1 snapshot and 2 runs — a transient retry adds an attempt without
  re-targeting, exactly as required.

  A sixth pass closed the remaining projection gap: `waiting-user` was never
  derived from real events, so an Invocation blocked on a human approval still
  read as an opaque `running`. The Host now also maps `approval/asked` to
  `waiting-user` and `approval/decided` back to running, both arriving on the
  same durable session firehose. The coordinator only acts on a non-settled,
  non-queued Invocation, so a trailing decision cannot resurrect finished
  work, and waiting on a human still occupies the serial slot rather than
  letting queued work start behind it. Four cases in
  `test/coordinator.test.ts` cover this.

  Verified live afterwards that the serial queue now DRAINS on its own: two
  Invocations queued back-to-back both reached a terminal state without any
  intervention, where before the event fix the first would hang on `running`
  and the second would never start.

  A fifth live pass followed an Invocation past dispatch and found the most
  consequential defect of the whole change: `PetCoordinator.onAgentEvent`
  existed and was unit-tested, but was NEVER SUBSCRIBED to any DSH event. The
  Host projected nothing, so an Invocation stayed `running` forever — a
  completed turn never settled, the serial queue never advanced on its own,
  and every Task accumulated permanently stuck work. Unit tests could not see
  it because they call `onAgentEvent` directly.

  The Host now subscribes to the durable `session/event` firehose, filters to
  Pet executors, and maps `turn/start` to running and `turn/end` by its
  `reason.kind`: `completed` → succeeded, `aborted` → cancelled, and
  `failed`/`blocked`/any future reason → failed with the structured error
  message rather than leaving the Invocation in flight. Verified live: an
  Invocation that previously hung on `running` now settles (in the isolated
  probe home it settles as `failed` with the Host's own
  "has no provider/model" diagnostic, since that home has no credentials) and
  the Task returns to `idle`.

  A fourth live pass exercised the Skill trust boundary end to end against a
  booted Host and found no new defect — every guarantee held:

  - read-only inspect installs nothing; import requires a second call echoing
    the inspected digest, and a mismatched digest is rejected;
  - import does NOT auto-enable, so a bundle becomes usable only by explicit
    selection;
  - a symlink inside a bundle, a relative path and a missing `SKILL.md` are
    each rejected;
  - **mutating the import source after installation has zero effect** on the
    installed revision — the store copy stays byte-identical;
  - tampering with the STORE copy is detected as a digest mismatch, and an
    Invocation fixed to that revision then FAILS CLOSED at dispatch with a
    digest diagnostic instead of reaching the Agent, returning the Task to
    `idle` so later work still runs;
  - an explicit rebuild repairs substituted LINKS but refuses to republish a
    revision whose contents no longer match their digest, so corrupted
    content cannot be laundered back into service. That distinction had no
    unit coverage and is now pinned by two cases in `test/projection.test.ts`.

  A third live pass exercised the remaining lifecycle paths against a booted
  Host and caught one more defect: restart reconciliation only handled
  `creating-executor`, so a Task left `running` or `waiting-user` when the
  Host stopped came back still claiming to run even though no Agent was
  driving it. Such work is now reconciled to `recovering` with a diagnostic —
  visible and diagnosable rather than falsely reported as in progress —
  while settled and archived Tasks are untouched. Verified in a real Host:
  the same Task that previously returned `running` after a restart now
  returns `recovering`.

  The same pass confirmed, live: Task reuse across capabilities; durable
  serial queueing (a second Invocation queues at position 1 rather than
  preempting); cancel settling the current Invocation and atomically starting
  the queued one; `ARCHIVE_BLOCKED` while running, then archive succeeding
  after cancellation AND the executor session actually appearing in DSH's
  archived set; a new epoch (2) with a fresh executor after archival rather
  than reactivating; `CONTEXT_REQUIRED` for a session-required capability from
  a `none` source; drift detected as `not-a-symlink` when a managed link is
  replaced by a directory, and explicit rebuild repairing it to `ok`;
  shortcut visibility; uninstall removing the revision, the projection entry
  and the capability; and full state — tasks, epochs, archive state,
  allowlist, shortcut flags — surviving a real restart.

  A second live pass drove a COMPLETE Task lifecycle over the real API —
  create workspace, create session, configure Pet, invoke a capability — and
  caught a defect no unit test could reach: executor `setup` read
  `scoped.skills` directly, but the agent context is a fresh fiber that does
  NOT inherit the plugin's inject grants, so every Task creation failed with
  `cannot get property "skills" without inject`. Fixed by declaring the
  dependency with `scoped.inject(['skills'], …)` around the registration.

  After the fix, the same live run proved the whole chain: a Pet Task is
  created with the right `scopeKey` and epoch, a real executor session is
  spawned with `cwd` at the Pet Workspace, the executor is renamed to
  `🐾 … [<short id>] · #1`, the Invocation is fixed to the built-in's exact
  digest, a snapshot is bound to the real source session with its `cwd` and
  `asOfSeq` anchor, and a run record is opened. Provider routability was also
  proven against the real registry: an unroutable id is refused and the
  message lists the providers this Host actually offers.

  Additionally verified against a REAL booted DSH Host: the shipped profile
  was copied to a temporary `$DSH_HOME`, booted on an ephemeral port
  (`--port 0 --no-open`), exercised over HTTP, then stopped and deleted. The
  user's Host on 3080 was never touched. Observed there:

  - `status` and `diagnostics` report `phase: ready` — the plugin genuinely
    loads and initializes in a real composition;
  - all three built-ins install, enable and project with `drift: []`, and the
    Workspace entries are real symlinks into the digest-addressed store whose
    `SKILL.md` reads back through the link;
  - `state.sqlite` materializes owner-only under `$DSH_HOME/plugins/dsh-pet/`;
  - all three capabilities report `available: true`;
  - the Web client bundle is served at `/plugins/dsh-pet/client.js` (200,
    ~50 KB) with the correct module-loader wrapper, so both halves load;
  - a session-required capability invoked with `sourceKind: none` is refused
    with `CONTEXT_REQUIRED` before anything is created;
  - a cross-origin request fails closed, and an unknown request field is
    rejected rather than ignored.

  Automated in `test/acceptance.test.ts` (14 cases) against an isolated DSH
  home using the real storage-domain layer, the real SQLite backend and a real
  filesystem. Covers every listed scenario: first boot directories/workspace,
  four-tab Settings, local Skill install, allowlist isolation of an
  installed-but-disabled Skill, managed-symlink drift plus explicit rebuild
  recovery, a degraded adapter disabling one capability while Pet keeps
  working, Pet Workspace/executor creation, two skills on one Task and one
  executor session, a fresh snapshot per invocation, trusted context bound to
  the executing session, a no-source independent Task, restart recovery from
  the real database file, and the archive → new-epoch flow with history
  retained.

  This suite found and fixed a real defect: an explicit projection rebuild
  could not repair an entry a user had replaced with a plain directory,
  because `rename` cannot overwrite a directory. `rebuildProjection` now
  clears a conflicting non-symlink entry inside Pet's own projection directory
  first, while `removeProjectionEntry` still refuses to delete foreign content.
- [x] 12.3 Run package build/typecheck/test/lint plus repository `npm test`, `npm run check:artifacts` and assembled no-key DSH snapshot/loader tests required by DSH-facing behavior changes; record exact results.

  Deployment caveat observed twice while iterating: after editing package
  files in place, `node scripts/sync.mjs` can report `up-to-date` while the
  installed copy under `~/.dsh/profiles/web/node_modules/dsh-pet/` is stale,
  because pnpm hard-links unchanged-size files from its content-addressed
  store. Verify with a checksum comparison, and when they differ remove the
  installed package directory plus the `dsh-pet` entries from
  `~/.dsh/.dsh-sync-state.json` and re-sync. Both fixes in this change were
  confirmed deployed that way (`lib/index.js` and `cordis.patch.yml`
  checksums equal, and a following sync reports `up-to-date`).

  Recorded results (all run from a clean tree):

  | Check | Command | Result |
  | --- | --- | --- |
  | Package build | `npm run build` (workspace `dsh-pet`) | pass — `lib/index.js` + `lib/client.js` (42.36 kB) emitted |
  | Package typecheck | `npm run typecheck` | pass — host and client programs, `strict` + `exactOptionalPropertyTypes` |
  | Package tests | `npx vitest run` | pass — 233 tests / 14 files |
  | Repository tests | `npm test` | pass — 81 tests, 0 fail |
  | Artifact policy | `npm run check:artifacts` | pass — tracked paths comply |
  | Composition | isolated `node scripts/sync.mjs` | `dsh-pet` builds, installs, registers as a bundle; `@deepseek-ai/dsh-storage-sqlite` resolves into the profile |
  | Idempotency | second isolated sync | `package dsh-pet@0.1.0 up-to-date` — no rebuild, no reinstall |

  Package tests exercise the real DSH storage-domain layer and the real
  `@deepseek-ai/dsh-storage-sqlite` backend (`test/sqlite-composition.test.ts`)
  plus real filesystem symlink projection, rather than mocking those contracts.
  No API key or network access is required.
- [x] 12.4 Run `node scripts/sync.mjs` or an isolated equivalent twice and prove the second materialization is idempotent, with no tracked `lib/`, generated profile, runtime database or Skill-store artifacts.
- [x] 12.5 Build the affected installed DSH Web profile and verify the existing native DSH URL after refresh; do not start a replacement server, and verify Cockpit iframe use leaves the separate Cockpit server/shared/bridge contracts unchanged.

  Composition is now verified against the REAL profile with
  `dsh --profile web --dump-config`, which builds the composed plugin tree
  without booting anything — no replacement server, and the running Host is
  untouched. That check caught a defect no test had: the bundle patch used a
  `- patch:` wrapper, which is not a valid form, so composition failed with
  "[dsh-pet] patch: id is required for non-insert patches". Pet would have
  failed to load on the very next restart.

  A patch row is a top-level entry naming its target by `id`, and it REPLACES
  the targeted row's whole `config` — so the fix also had to restate
  `backend: json`, without which the override would have dropped the profile
  default and left every other DSH domain unrouted. The composed tree now
  shows `storage-domain` with `backend: json` plus only the `dsh_pet: sqlite`
  route, and both Pet rows present with all ten injects. Guarded by three
  cases in `test/loader-composition.test.ts`, verified to fail when the
  wrapper form is reintroduced.

  `node scripts/sync.mjs` ran against the real `~/.dsh` with the manifest row
  enabled and finished with no failures. Verified in the installed profile:
  `dsh-pet` is registered in `dsh.profile.bundles`, its `lib/`, `skills/` and
  `cordis.patch.yml` are materialized, and `@deepseek-ai/dsh-storage-sqlite`
  resolved into `profiles/web/node_modules/@deepseek-ai/`. A second sync
  reported `package dsh-pet@0.1.0 up-to-date` (idempotent). No replacement
  server was started; the existing http://127.0.0.1:3080 still answers 200.
  The `dsh-cockpit` repository and `dsh-cockpit-bridge` were not modified.
- [ ] 12.6 Ask before restarting the user's daily DSH Host; after confirmation, restart and repeat the core Pet/Settings/Task smoke flow on the existing URL.

  Blocked by a self-termination constraint, not by missing work. The user
  approved the restart, but this agent session runs *inside* the `dsh web`
  process that must be restarted (PID owning 127.0.0.1:3080), so issuing
  `dsh restart` ends the session before the post-restart smoke flow can be
  observed. Everything the restart depends on is already deployed and
  verified (see 12.5). The remaining step is for the user to run
  `dsh restart` and confirm the Pet overlay, four-tab Settings and Task panel
  on the existing URL.
