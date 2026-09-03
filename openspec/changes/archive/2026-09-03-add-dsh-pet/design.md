## Context

See `proposal.md` for motivation and `specs/dsh-pet/spec.md` for the behavior contract.

This repository is the customization and deployment source of truth for the user's DSH profile. `dsh.yaml` controls enabled local/remote packages, `packages/` owns self-developed Host+Web bundles, and the sync/build flow materializes them into `$DSH_HOME`; mutable runtime data must remain outside generated package/profile files. Existing local `worktree-session`, subscription-provider customizations and ordinary DSH Skills provide the integration environment Pet needs. DSH exposes an additive root-scoped `shell.overlay`, settings slots, root session/workspace APIs, Agent presets, ordinary prompt/approval/history behavior, scoped Skill providers and Host-side storage domains.

The earlier planning draft was created in `dsh-cockpit`, but phase-one Pet changes only a device-local DSH profile and has no Cockpit operation or coordination-plane feature. This ohmydsh change is therefore canonical. Cockpit remains an external read-only consumer and receives Pet only incidentally through its native DSH iframe.

The relevant DSH constraints are:

- the browser's active session is local UI state; it must be captured when the user invokes Pet and cannot be reconstructed later from Host events;
- DSH has no `sessionKind: pet`; executor sessions must remain ordinary root sessions and be separated by workspace, title and Pet-owned association data;
- Skill invocation is a normal prompt beginning with `/skill-name`, not a separate execution RPC;
- subscription adapters register in the same Host LLM registry as ordinary providers, so sessions created in the Web Host can reuse them without Pet reading credentials;
- the existing Worktree Session keeps `Session.header.cwd` at the repository root while its managed execution root is stored in Worktree Session binding state, so Pet must capture that optional provider-specific context rather than infer it from `cwd`;
- Cockpit's fleet plane remains read-only and the existing bridge remains minimal. Pet runs inside the device's native DSH page and Host; this change does not add a Cockpit operation proxy.

## Goals / Non-Goals

**Goals:**

- Deliver one independently installable Host+Web package that starts and stops with `dsh web`.
- Make Task, Invocation, snapshot and executor session distinct durable entities with fail-closed routing.
- Reuse one ordinary executor DSH session for every Invocation in an unarchived Task.
- Capture fresh source context at each user invocation and keep queued work deterministic across page switches and Host restarts.
- Reuse the current DSH Agent composition and provider registry while keeping Pet configuration and credentials separate.
- Keep executor sessions visible and diagnosable in one Pet-owned Workspace rather than inventing a hidden session protocol.
- Leave explicit seams for future Channel Bindings without implementing transport in phase one.

**Non-Goals:**

- A standalone Pet daemon or a second Agent runtime.
- New DSH session origin/kind semantics, replacing the workspace sidebar, or mirroring complete executor transcripts into Pet UI.
- Automatic cross-device routing, shared-bot ownership, Cockpit Pet Hub, or Lark inbound events.
- Vector memory, autonomous scheduling, generic plugin/channel marketplaces, or multi-Agent relay.
- Bypassing existing Worktree Session safety gates, DSH permission behavior, provider authentication, or model selection validation.

## Decisions

### 1. Ship Pet as one package with Host and Web halves

Add the local npm-workspace package `packages/dsh-pet/` with a real Host entry, a Web client entry, a DSH bundle patch, settings registration and package-owned tests. Add one `type: package`, `source: local` customization to `dsh.yaml`; this is the only deployment switch and sync/build must remain idempotent. The Host entry owns persistence, task coordination, session creation/observation and tools. The Web entry registers one additive `shell.overlay` surface plus one settings section. The package remains independently publishable/installable even though this repository is its initial implementation and deployment owner.

The Host plugin is a service inside the existing `dsh web` Node process, not a child process. `apply` registers lightweight services and lifecycle effects; fallible asynchronous initialization is contained in a Pet runtime state machine (`starting | ready | degraded | stopping`) so a Pet failure does not abort unrelated DSH capabilities. Channel reconnect loops, when introduced later, will attach to this Host lifecycle.

The browser receives only the Pet management methods and projections required by its UI. It does not open SQLite directly and does not become the authority for tasks.

**Alternatives considered:**

- Independent daemon: rejected for phase one because it duplicates process supervision, DSH authentication/provider state and Agent/session APIs.
- Browser-only plugin: rejected because tasks must survive browser closure and phase-two channels require Host lifetime.
- Extend `dsh-cockpit-bridge`: rejected because the bridge intentionally reports only active session ID to Cockpit and must remain a minimal, read-only trust seam.

### 2. Use the DSH storage-domain abstraction on a Pet-owned SQLite backend

Pet will use DSH's storage hub/domain abstraction rather than hand-writing an unrelated repository layer. The package declares a versioned `dsh-pet` domain with schema-validated tables and routes it to a Pet-owned SQLite database under `$DSH_HOME/plugins/dsh-pet/state.sqlite`. Its bundle patch composes the standard `@deepseek-ai/dsh-storage-sqlite` backend (the shipped Web profile currently composes JSON only) and adds only a `dsh-pet → sqlite` override to the existing storage-domain routes; all other DSH domains remain on the profile's default JSON backend. Startup MUST fail Pet into degraded mode if another composition already owns the `sqlite` backend with incompatible configuration rather than replacing that backend.

The exact physical schema is hidden behind the domain spec, but the logical records are:

```text
pet_tasks
  id, scopeKey, epoch, sourceKind, sourceId snapshots,
  executorSessionId, status, archivedAt, timestamps

pet_invocations
  id, taskId, capabilityId, request/envelope,
  snapshotId, status, queue position, timestamps

pet_source_snapshots
  id, invocationId, source identity, asOfSeq,
  session/workspace/worktree/scm structured facts, capturedAt

pet_runs
  id, invocationId, attempt, status, timestamps, error/result summary

pet_config / workspace_bindings
  model/composition, capability flags, appearance defaults,
  trusted workspace-to-business/CR targets (non-secret phase-one data)
```

The domain's write chain provides one durability order. Task creation, executor creation and invocation dispatch still span DSH session persistence and Pet storage, so they use explicit intermediate states (`creating-executor`, `dispatching`, `recovering`) plus stable preallocated IDs rather than pretending to have a cross-system transaction. Restart reconciliation proves each side before advancing or marks a recoverable failure.

**Alternatives considered:**

- Browser localStorage: suitable only for Pet position; rejected for tasks because it disappears with browser profiles and cannot drive Host work.
- Ad hoc JSON files: simpler initially but weak for indexed Task/Invocation relationships and serialized queue transitions.
- Direct `node:sqlite` tables: viable, but rejected for phase one because using DSH's versioned domain/storage contract gives schema validation, owner-only setup, deterministic writes and standard lifecycle. Changing this choice later would require a design/spec revision and explicit data migration, not an implementation-time fallback.

### 3. Model Task, Invocation, Snapshot and Run separately

A Pet Task is a durable work thread and owns exactly one executor session for its lifetime. A Pet Invocation is one user request/skill dispatch inside that thread. A Snapshot belongs to one Invocation and represents the source at acceptance time. A Run is one attempt to execute the Invocation.

```text
Source Scope ── 1 active ──> Pet Task ── 1 ──> Executor Session
                              │
                              └── N Invocations ── 1 Snapshot
                                      │
                                      └── N Runs
```

`scopeKey` defines active-task uniqueness:

- `session:<sessionId>`
- `workspace:<workspaceId>`
- `independent:web:default` in phase one

The active uniqueness invariant is enforced in the Host coordinator, not inferred from titles. `epoch` increments after archival for the same scope. An archived Task is immutable except for repair/diagnostic metadata and cannot be reactivated.

One Task has at most one `running` or `waiting-user` Invocation. Later Invocations are durably ordered. Internal attempt retries remain on the same Snapshot; a new user gesture produces a new Invocation and fresh Snapshot.

**Alternatives considered:**

- One Task/session per skill click: rejected because Create MR → Send CR → Clean Worktree is one continuous working context.
- One Task per source forever: rejected because archival must close a thread and create a clean Agent context on later use.
- Store only executor session ID: rejected because retries, per-click snapshots, phase-two external routing and lifecycle recovery require explicit product entities.

### 4. Capture snapshots in the browser/Host handoff, then enrich Host-side

The Web plugin reads one atomic browser snapshot when the user confirms an Invocation:

- `ctx.sessions.list.current` and its `SessionSummary`;
- matching `WorkspaceView` from `ctx.workspaces.list`;
- user-selected source override/removal;
- the capability and user request.

It sends this immutable capture request to Pet Host with a client-generated invocation ID. Host validates that source IDs are visible/known, resolves the latest durable source header and available event tail (`asOfSeq`), and invokes registered Source Context Providers for optional enrichment:

- base DSH session/workspace facts;
- Worktree Session binding (managed execution root, branch, lifecycle, dependency mode), when installed;
- SCM/MR facts that can be read without side effects.

The resulting structured snapshot is persisted before the Invocation may run. The browser `current` value is never consulted again for that Invocation. If a requested source cannot be validated, creation fails before the Agent prompt is queued.

Source Context Providers are an internal registry with bounded output schemas. Worktree support is optional: absence yields no managed-worktree fields, while a provider error is surfaced instead of silently treating repository root as a managed execution root.

**Alternatives considered:**

- Capture only at first Task creation: rejected because source state evolves between capabilities.
- Resolve active session when the Agent calls the tool: rejected because the user may have switched sessions and Host cannot observe browser selection.
- Copy the entire source transcript into SQLite: rejected for phase one due to duplication, privacy and size; store a sequence anchor and small structured facts, and use explicit bounded history retrieval only when a capability requires it.

### 5. Ensure one ordinary `DSH Pet` Workspace and preallocate executor session IDs

Pet Host creates `$DSH_HOME/plugins/dsh-pet/workspace/` owner-only, writes package-owned Agent instructions/skill references needed by the Pet composition, and calls `workspaceRegistry.create(path, 'DSH Pet')` idempotently. It never uses `node_modules/dsh-pet` as runtime state.

For a new Task, Host preallocates `taskId`, `executorSessionId` and epoch, persists the creating record, then creates/resumes a normal root Agent with:

- `meta.cwd = Pet Workspace path`;
- selected provider/model from validated Pet settings;
- Pet Agent Preset when configured, otherwise a package-owned setup that installs Pet standing instructions, model selection and tool scope;
- no `origin: subagent` and no parent-session authority.

After Agent/session creation succeeds, Host inserts the session into the Pet Workspace order, renames it using a generated relationship title, persists the active association and dispatches the first envelope. Stable preallocated IDs make a crash between these steps reconcilable. If the session already exists with a conflicting cwd/preset, recovery fails closed.

Executor titles follow a bounded projection such as:

```text
🐾 <source snapshot title | Independent> [<source/task short id>] · #<epoch>
```

User renames are allowed and never parsed. The Task panel always uses stored metadata.

**Alternatives considered:**

- Executor cwd equals source repo/worktree: rejected because one Task may outlive or move across source snapshots and would mix Pet sessions into business Workspaces. Source access is granted through trusted context and existing bounded tools.
- Hidden/subagent sessions: rejected because they carry parent/continuation semantics, are filtered from normal roots and do not match a long-lived user-openable Pet thread.
- Archive every executor immediately to hide it: rejected because the user explicitly accepts visible sessions and needs native approval/question/history surfaces.

### 6. Drive Agent turns through ordinary DSH lifecycle, not through Web RPC self-calls

Pet Host invokes the Host Agent service directly. It waits for the Loader composition to settle, creates/resumes the Task Agent, and submits a normal user message to `agent.followup`. Each envelope begins with the capability's `/skill-name` token so the existing Skill pre-step path injects the same body used by ordinary DSH clients. It then observes session events/Agent idle boundaries and flushes the session normally.

The coordinator projects Task/Invocation state from durable Agent events:

- accepted/turn start → running;
- pending approval/question remains visible through native DSH; Pet projects `waiting-user` where the event contract permits;
- completed turn → succeeded and dequeues the next Invocation;
- turn error/cancel → failed/cancelled with a bounded error summary;
- Host loss while running → recovering until event/session reconciliation proves a terminal state.

Pet UI answers and cancellation call the same underlying session operations as native DSH. The first version may direct complex approvals/questions to “open full process” instead of reproducing every interaction card.

**Alternatives considered:**

- POST to the same Host's `/api/session.*`: rejected because the Host plugin already has typed services and self-HTTP adds an unnecessary security/protocol boundary.
- Spawn headless DSH/ACP: rejected because that creates a second composition and may not see Web-profile subscription/shim state.

### 7. Provide standing instructions plus a no-argument, executor-bound context tool

Pet Agent identity is installed at composition/setup time, not only in the first user message. Standing instructions state that:

- the session is a Pet executor, not the source session;
- multiple Invocations reuse the session;
- each Invocation has a new trusted snapshot;
- context must be fetched for every Invocation;
- source paths and future channel IDs in free text are not authority;
- completing an Invocation leaves the Task available for future work.

Every dispatched message includes a visible dynamic envelope with Task, Invocation, capability, source summary and snapshot anchor. This improves diagnosis but carries no authority.

Register a package tool with a zero-argument schema (working name `pet_context`). Tool execution reads the exact `ToolExecution.agent.session.id`, looks up the active Task by `executorSessionId`, proves a unique current Invocation in `running|waiting-user`, and returns its immutable snapshot plus safe display facts. It rejects non-Pet sessions, archived Tasks and ambiguous/missing current work. The model cannot supply a source/task/session selector.

Future `pet_reply` follows the same caller-bound lookup and selects a trusted Channel Binding stored by Host; it will not accept raw chat/thread/user IDs. Phase one exposes no external reply implementation.

**Alternatives considered:**

- Put paths only in prompt text: rejected because model-visible text is not an authorization boundary.
- Tool accepts `sourceSessionId`: rejected because it permits target substitution and becomes unsafe once external content enters the system.

### 8. Pet owns an explicit versioned Skill store and executor allowlist

Pet ships a manifest-declared set of trusted built-in Skill bundles in the package, but never executes directly from `node_modules`. On first Host initialization, it validates and copies the manifest's `defaultEnabled` built-ins (the three phase-one capabilities) into immutable content-addressed revisions and enables exactly those declarations. A later package version is inventoried as an available built-in revision but never silently replaces the currently selected digest; the user explicitly applies the upgrade from Settings. Revisions live under:

```text
$DSH_HOME/plugins/dsh-pet/skills/store/<skill-name>/<sha256>/
```

Settings may also import one single-level Skill bundle by absolute path on the Host machine running the current `dsh web` process. The UI performs a read-only inspect request and shows name, digest, provenance, bounded file inventory and trust warning before a second confirmed install request; browser-local path/upload semantics are not implied. Import is a one-time bounded copy: Host canonicalizes the source, rejects symlink/path escapes and unsupported/special files, validates `SKILL.md` frontmatter/name, applies file-count/per-file/total-size limits, computes a manifest digest, copies through a staging directory, verifies the copied digest and atomically renames it into the store. The source path remains diagnostic provenance only and is never a live provider root. Git/URL/npm install is out of phase one.

Pet persists three separate facts per Skill: installed immutable revisions, one selected enabled revision, and whether it appears as a radial shortcut capability. Enabling or upgrading computes a complete desired projection whose named entries are Pet-created directory symlinks:

```text
$DSH_HOME/plugins/dsh-pet/workspace/.dsh/skills/<skill-name>
  -> $DSH_HOME/plugins/dsh-pet/skills/store/<skill-name>/<sha256>/
```

For each changed entry Host creates a same-directory temporary symlink, resolves it, proves the final target remains under the canonical immutable store with the expected digest and valid `SKILL.md`, then atomically renames it over the old entry. A broken, non-symlink or out-of-store projection is drift and fails closed until explicit rebuild. Imported bundles still reject all user-provided symlinks; only Host-created, store-contained projection links are trusted.

DSH's filesystem Skill provider explicitly follows direct child symlinks, stats their final target and recognizes directory targets as Skill bundles; its watcher defaults to `watchFollowSymlinks: true`. It also supports this exact project root because a cwd without a nearer `.git` falls back to the Pet Workspace itself. Pet does not duplicate files into `.agents/skills`, `.claude/skills` or provider-specific homes: LLM provider selection is independent from DSH Skill discovery. Other runtime projections may be added later behind explicit adapters.

Workspace projection alone is not the isolation boundary. Pet's executor composition registers a scoped Skill provider/catalog backed by the persisted allowlist and immutable store and uses a Pet-owned loader/invocation pre-step that accepts only the enabled revision fixed for the current Invocation. The ordinary broad `tool-skill` catalog/loader is omitted or shadowed in the Pet executor composition. A leading `/<name>` for an unknown, disabled or revision-mismatched Pet Skill rejects instead of becoming ordinary prose. This prevents global/user/project Skill providers from silently expanding Pet Agent capabilities even if the projected Skill happens to be visible to another DSH session.

Each Invocation records `skillName`, immutable `skillDigest` and `skillSetGeneration`. Enable/upgrade changes take effect for the next user-created Invocation even when it reuses an existing Task/executor session; Pet's provider emits a replacement catalog, while dispatch and loading resolve the current Invocation's fixed digest rather than whichever revision is now selected by name. Already queued/running Invocations never change revision. “Uninstall” first removes the selected revision from future use and shortcuts; physical garbage collection retains every digest referenced by an unarchived Task or non-terminal Invocation. Projection drift disables affected Skill invocation until explicit rebuild succeeds.

**Alternatives considered:**

- Rely on default filesystem discovery and filter only the radial menu: rejected because the model could still discover/load global Skills.
- Copy immutable revisions again into the Workspace projection: rejected because DSH supports direct Skill-directory symlinks and duplicate copies create avoidable storage/drift; Pet-created store-contained symlinks preserve one canonical revision.
- Copy into every provider-specific directory: rejected because Skills belong to the DSH Agent runtime, not the selected LLM provider, and duplicate roots create ambiguous precedence.
- Symlink imported source directories: rejected because later external edits would silently alter retained Invocation semantics and symlink traversal complicates trust boundaries; this differs from Host-created projection links into Pet's immutable store.
- Modify DSH's global Skill registry: rejected because Pet isolation should remain package-scoped and independently installable.

### 9. Capability registry separates UI metadata, Skill dispatch and bounded effects

Pet declares a Host capability registry projected read-only to Web. Each capability includes:

```text
id, label/icon/description, skillName,
contextRequirement = none | optional | workspace-required | session-required,
confirmation policy, availability/diagnostic
```

The phase-one registry contains:

- `create-mr`: session-required;
- `send-cr`: session-required for phase one;
- `clean-worktree`: session-required.

The Agent Skill coordinates reasoning and clarification; side effects remain in bounded tools:

- Create MR resolves repository/worktree from `pet_context`, validates Git/MR inputs and invokes an explicit Codebase/MR operation;
- Send CR resolves workspace→business/group/reviewer configuration from Pet Host and renders a fixed structured message; the model cannot provide a raw destination;
- Clean Worktree delegates to existing `ws` safety gates and never reconstructs or bypasses their dirty/merge/active-session checks.

Because internal ByteDance commands and Lark transport may not be available in an open-source environment, capability availability is computed. Missing dependencies produce a disabled/diagnostic capability rather than breaking Pet. Tests use bounded adapters/fakes, not real organizational side effects.

### 10. Expose a narrow Pet management RPC and projection surface

Add a package-owned logical RPC channel or exact Host routes for:

- status/config description and validated updates;
- built-in/installed Skill revisions, bounded local import, enable/disable, shortcut visibility, upgrade/uninstall and projection rebuild;
- capability list;
- Task list/detail grouped by source;
- create Invocation from an immutable source capture;
- answer/cancel/retry current Invocation;
- archive Task;
- open-target metadata for source/executor navigation.

Every mutation is loopback/same-origin constrained by the existing DSH Web transport. Requests use stable IDs and revision/idempotency tokens. Responses redact secrets and do not include provider credentials. No generic `callDshRpc`, arbitrary prompt, arbitrary filesystem path or arbitrary channel destination is exposed.

The Web client subscribes to Pet Host changes through a small Pet event/projection feed or generation-aware refresh signal, rather than polling. Reconnect always reloads a complete Pet snapshot before applying later increments.

### 11. Keep Pet UI additive and split lightweight surface from management panel

The root `shell.overlay` entry renders only the draggable mascot, radial capability menu and compact status badge. The overlay container remains pointer-through; the Pet surface opts into pointer events and uses pointer capture for dragging. Position is a root-scoped persisted client preference and clamped on resize/reload.

A Pet panel, opened by clicking the mascot, renders:

- current source chip with remove/select behavior according to capability requirements;
- current source's active Task and Invocation queue;
- “all/archived” grouped Task views;
- summary/result links and native source/executor session navigation;
- answer/cancel/retry/archive controls.

A dedicated Pet Settings section has four stable tabs:

- **General** — appearance/position reset, default Agent composition, provider/model and default new-Task context policy;
- **Skills** — built-in inventory, local directory import, immutable installed revisions, enable/disable, radial-shortcut visibility, upgrade/uninstall and projection status;
- **Bindings** — trusted workspace/business/group/reviewer bindings for bounded side effects;
- **Diagnostics** — Host lifecycle, state/workspace/store/projection paths, dependency availability, digests/drift and an explicit projection-rebuild action.

Settings uses DSH settings scope/revision behavior; visible secrets are not part of phase one. The Pet overlay and Task panel link to the relevant tab but do not install Skills or edit bindings. The panel does not clone the transcript or approval UI; “open full process” navigates to the executor session.

### 12. Reconcile archive state in both directions with state-sensitive rules

Pet observes the durable workspace archive set. Rules are:

- source archived: update availability/display only;
- terminal executor archived: archive Task;
- terminal Task archived from Pet: archive executor session;
- running/waiting executor archived externally: keep Task active, mark executor hidden/archived and require native recovery or cancellation; never infer cancellation;
- non-terminal Task archive request: require explicit cancellation and settle it before archive;
- no archive path deletes records.

To prevent feedback loops, archive transitions are idempotent and carry the current Task revision. Startup reconciliation compares stored Task archive state with `workspaceRegistry.archivedSessionIds` before accepting new Invocation work.

Current DSH exposes archive but no unarchive API. Therefore phase one treats external executor archive as a one-way close for terminal Tasks; it does not promise restoration from Pet.

### 13. Keep implementation ownership in ohmydsh and preserve the Cockpit boundary

The package's `cordis.patch.yml` composes only into a DSH profile. `dsh.yaml` adds the local package as an independently reversible customization; `dsh build` materializes the profile and a second sync must produce no drift. Package source and built-in Skill assets live under `packages/dsh-pet/`, while runtime paths derive from the active DSH home and never from the package checkout or Cockpit home.

Cockpit receives Pet incidentally inside the existing native DSH iframe and requires no server/web/shared changes. `dsh-cockpit-bridge` remains unchanged and continues to report only selected session IDs. This change MUST NOT edit the dsh-cockpit repository. A future cross-device Pet status aggregate, device router, shared Lark bot owner or Pet Hub is a separate Cockpit-owned capability and must get its own change there rather than expanding this device-local plugin silently.

The repository documents both the manifest-managed local deployment and the package's independent DSH installation contract. The latter preserves future extraction/publishing without making ohmydsh a runtime dependency.

## Risks / Trade-offs

- **[DSH rc APIs are pre-stable]** Client slots, Host Agent services and session metadata can change between release candidates. → Pin compatible peer ranges, keep DSH-facing adapters narrow, add loader-composition and real assembled snapshot tests, and document the supported DSH range.
- **[Pet Host shares the DSH process]** A synchronous throw or blocking operation can degrade the whole Host. → Keep `apply` registration-only, contain async initialization, bound all external commands, log degraded diagnostics and test failed initialization.
- **[No cross-store transaction]** Pet storage and session/workspace persistence can diverge on crash. → Preallocate IDs, persist explicit intermediate states, use idempotent create/archive operations, and reconcile before accepting work.
- **[One executor serializes work]** A waiting Invocation delays later skills for that source. → Make queue state visible, support cancel, and preserve the one-current-Invocation invariant instead of introducing ambiguous parallel context.
- **[Pet Workspace cwd differs from source execution root]** Broad shell tools may be restricted under future workspace-write policies. → Resolve source via caller-bound context and prefer bounded Host tools; capability availability must report when the current permission composition cannot operate safely.
- **[Visible executor sessions can clutter DSH]** Long-term use produces one session per Task epoch. → Group all sessions in `DSH Pet`, use clear titles and archive synchronization; defer retention/deletion until usage data exists.
- **[First-phase organizational actions are environment-specific]** bytedcli, Lark bot identity and Worktree Session may be absent. → Capability adapters advertise diagnostics and fail closed; base Pet and independent installation must still load.
- **[Snapshot may become stale during a long queue wait]** The contract intentionally fixes user intent at invocation time. → Show capture time/anchor, allow the user to cancel and create a fresh Invocation, and never silently refresh targets.
- **[Task status can lag native interaction state]** Approval/question replay is limited by available DSH events. → Treat DSH session as execution truth, refresh on reconnect, use `recovering/unknown` rather than inventing terminal state, and provide the native-session jump.
- **[Imported Skills are trusted executable instructions/resources]** A local bundle can induce sensitive tool use or contain hostile resource paths. → Require explicit confirmation, copy rather than link, reject symlinks/special files/path escapes, cap size/count and display source/digest/trust before enabling; bounded side-effect tools remain the authority boundary.
- **[Two Skill representations can drift]** Immutable store/allowlist and Workspace projection are separate filesystem/persistence writes. → Record desired digest, stage and atomically swap projection entries, verify at startup, fail closed for affected Skills and expose Diagnostics rebuild.
- **[Archive has no unarchive wire]** An accidental executor archive cannot be automatically restored. → Warn on non-terminal archive, retain Task/history and support creating a new Task epoch after explicit close rather than pretending to unarchive.

## Migration Plan

1. Add `packages/dsh-pet/`, package tests and a disabled local customization row to `dsh.yaml`; verify sync/build composition in an isolated DSH home before daily-profile enablement.
2. Enable the manifest row for isolated dogfooding, run `dsh build`, and verify a second sync is idempotent. Do not restart the user's running daily DSH until separately confirmed.
3. On first Host start, create the owner-only Pet state/workspace/store directories and a version-1 empty domain; no legacy data migration is required.
4. Verify Pet degraded mode with organization-specific adapters disabled, then enable the three manifest-declared built-in capabilities and integrations incrementally.
5. After acceptance, keep the local package row enabled in `dsh.yaml` and document independent package installation for environments not managed by ohmydsh.
6. Rollback by setting the Pet customization `enabled: false`, rebuilding and—after confirmation—restarting DSH. Preserve `$DSH_HOME/plugins/dsh-pet/` and ordinary executor logs so re-enable can recover them; destructive cleanup is a separate explicit operation.

## Open Questions

- The final package/published name and visual mascot asset can be selected during implementation without changing behavior or architecture.
- The compact Task panel's exact drawer/popover visual treatment remains a prototype choice, but its responsibilities are fixed: invocation/source/task operations only; installation, bindings and diagnostics live in the four-tab Pet Settings section.
