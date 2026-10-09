## ADDED Requirements

### Requirement: Consumption checks are cached bounded private and configurable
Actual adapter Skill loading or slash invocation SHALL trigger an asynchronous stable-release metadata check when no successful result younger than 24h exists. Catalog listing and ordinary conversation SHALL NOT trigger it. The switch SHALL be the plugin option `updateCheck` from the adapter's plugin Config, default `enabled`; `disabled` stops all automatic and explicit network checks. Cache SHALL be shared within the same DSH_HOME/profile, deduplicate concurrent consumers and survive Host restart. Automatic checks SHALL have a 2s budget and 15min failure backoff; explicit check may bypass TTL/backoff but not endpoint or safety constraints. The check SHALL request exactly `GET https://registry.npmjs.org/@fission-ai%2Fopenspec/latest` and read only the `version` field of that document (a response of about 3 KB; the full packument is about 157 KB and SHALL NOT be requested), with redirects rejected and a 64 KiB response limit. Only credential-free official npm registry metadata SHALL be requested. No prompt, code, workspace path or provider credential SHALL be sent. A registry latest older than the selected version SHALL yield state `ahead-of-latest` without a notice. A corrupt, future-dated or unwritable cache or lock SHALL be treated as absent and SHALL NOT be reported as fresh; when the state directory is unwritable the adapter SHALL still serve Skills, SHALL issue at most one request per process per 15min, and SHALL report state `state-unwritable`; a lock left by a crashed holder SHALL expire.

#### Scenario: Concurrent workspaces share a successful check
- **GIVEN** no fresh cache and simultaneous Skill/slash consumption in two workspaces
- **WHEN** metadata check succeeds
- **THEN** exactly one request is issued and its result is reused for 24h including after restart; catalog listing alone issues zero requests

#### Scenario: The request targets the latest document and fits the limit
- **GIVEN** a fixture shaped like the real `/latest` response (about 3 KB)
- **WHEN** an automatic check runs
- **THEN** the request URL equals the fixed `/latest` URL, the response is accepted under the 64 KiB limit, and only `version` is read

#### Scenario: Network or metadata failure preserves existing use
- **GIVEN** timeout, invalid semver, prerelease-only value, oversized response or network failure
- **WHEN** an automatic check runs
- **THEN** existing Skills remain loadable, state reports a normalized failure class rather than `up-to-date`, and zero automatic requests occur during the next 15min

#### Scenario: Corrupt or future-dated state is not treated as fresh
- **GIVEN** a cache file with invalid JSON or a `checkedAt` in the future, and a lock file left by a dead process
- **WHEN** an automatic check runs
- **THEN** the stale cache is ignored, the stale lock expires, one request is issued, and a valid cache is written

#### Scenario: Disabled checking issues no request
- **GIVEN** `updateCheck: disabled`
- **WHEN** Skills and commands are consumed and an explicit check is requested
- **THEN** zero registry requests are made and the explicit check reports `check-disabled`

### Requirement: Update notification never performs installation or starts a turn
A newer stable release SHALL produce a versioned notice containing installed/available versions and the management entry. Delivery SHALL be an attachment, inside the adapter block, on the next Skill or command consumption result in a live scope; the adapter SHALL NOT append session messages or steer a session. This is chosen over `Agent.inject` because `inject` persists an additional user-role message into the conversation, delivery is best-effort (it may miss a request whose pre-step already claimed its batch and may be discarded on cancellation), and the skill provider receives no agent handle to call it with. The notice SHALL appear at most once per scope and installed/available pair, and is spent by whichever consumption in that scope first receives it: any `get` call the registry makes for an adapter Skill, whether from the model `skill` tool, the user `/name` gesture or a command handler building its message, but never by catalog listing. The dedup key SHALL be the identity of the `scope` object the registry passes to the provider, held in a process-local `WeakMap`, so it resets on restart, resume and fork and dies with the agent; when no `scope` is supplied no notice is delivered. The decide-and-mark step SHALL be one synchronous test-and-set before any await so racing consumers (the user `/name` gesture path and a separate subagent scope) cannot both receive it. The `scope` option is not part of the DSH provider contract's declared lookup options; the adapter depends on the registry passing the caller's options object through to `get`. That dependency SHALL be pinned by a test at both `dsh-tool-skill` call sites (the model tool, which may pass an undefined `scope`, and the user gesture path). A later pair B-to-D after B-to-C was shown SHALL produce a new notice. A result computed after its consuming scope ended SHALL NOT be delivered to that scope.

#### Scenario: New release is reported once
- **GIVEN** selected version B and metadata latest C greater than B
- **WHEN** multiple consumptions occur in one live scope
- **THEN** exactly one consumption result contains the B-to-C notice inside the adapter block, the other results contain none, no turn is started by it, no package install occurs and the original workflow proceeds

#### Scenario: Racing consumers spend the notice once
- **GIVEN** two consumptions in the same scope started in the same tick through the model path and the gesture path
- **WHEN** both complete
- **THEN** exactly one of them contains the notice

#### Scenario: A newer pair produces a new notice and a missing scope produces none
- **GIVEN** B-to-C was already shown in a scope, then latest becomes D, and a lookup without a `scope`
- **WHEN** the next consumption occurs in that scope and in the scope-less lookup
- **THEN** the scoped consumption contains a B-to-D notice and the scope-less one contains no notice

#### Scenario: The undeclared scope option reaches the provider at both call sites
- **GIVEN** the real `dsh-tool-skill` model path and gesture path driving the real skill registry with the adapter provider registered
- **WHEN** each path loads an adapter Skill from a live agent
- **THEN** the provider's `get` receives the calling agent as `scope` at both call sites, and a model-path call whose agent is undefined yields a result with no notice

#### Scenario: Every consumer kind can spend the notice and listing cannot
- **GIVEN** selected version B, latest C, and a scope that has had only catalog listings
- **WHEN** the first consumption is, in turn across fresh scopes, the model tool, the gesture path and a command handler
- **THEN** in each scope that first consumption carries the notice, and a catalog listing in a fresh scope carries and spends nothing

#### Scenario: An unwritable state directory degrades without failing
- **GIVEN** the state directory cannot be written
- **WHEN** Skills are consumed twice within 15min
- **THEN** both loads succeed, at most one registry request is issued, and the management check reports `state-unwritable`

#### Scenario: Notice state does not outlive its scope
- **GIVEN** a check finishes after its consuming scope was discarded
- **WHEN** the next consumption occurs in a different live scope
- **THEN** no state keyed to the discarded scope is read or written, and the notice appears in the new scope's first consumption result

### Requirement: Management Skill separates three update meanings
A separately identified `openspec-upgrade` Skill and `/openspec-upgrade` entry SHALL offer check, upgrade and rollback. Its description and help SHALL identify it as an adapter-defined entry for upgrading the managed official OpenSpec stack, not an official change workflow or a system-global installation upgrade. The adapter SHALL NOT register the former management name as an alias. Update notices SHALL point to `openspec-upgrade`. Renaming SHALL materialize a new generation identity and retain prior generation directories without rewriting their contents. They SHALL distinguish official npm version upgrade, project instruction refresh via `openspec update`, and official change revision via `opsx-update`. Merely consuming the Skill SHALL NOT authorize upgrade or project refresh. Project refresh SHALL require separately scoped approval and use the selected official CLI's semantics, including no configured tools. The management check SHALL report `path-version`, `managed-version`, `mismatch`, any `recovery` status, the winning source and provider of each adapter Skill name, and whether the `node` on the Bash PATH satisfies the official CLI's engine requirement.

#### Scenario: Upgrade and project refresh are separate
- **GIVEN** a user explicitly approves a managed software upgrade
- **WHEN** management completes it
- **THEN** only the managed runtime selection changes; no project `openspec update` runs unless separately requested, and the official change-revision workflow remains a distinct entry

#### Scenario: Management discovery is not mutation consent
- **GIVEN** a user only loads management help or a project has tools=none
- **WHEN** management examines update state
- **THEN** it installs nothing, project files are byte-identical, and it does not report project update as a global Skill upgrade

### Requirement: Upgrades and rollbacks are exact source-owned transactions
Upgrade and rollback SHALL be the same transaction type: an explicitly approved exact target version is written to `packages/dsh-openspec/package.json` and the root lockfile in the sync-recorded authoritative checkout (by realpath), then the matching generation is activated. These two files are the complete write set; the `dsh.yaml` record is prose and is not rewritten. The transaction SHALL stage dependency (ignore-scripts), renderer parity and CLI smoke checks before any source write, SHALL require the lockfile integrity of the target to equal the registry's `dist.integrity` for that exact version before any source write, serialize mutation, and compare-and-swap the source files. It SHALL modify only the official dependency entry and lockfile closure and MUST NOT change startup-time bundle fields (`dsh.client`, `exports`, peer dependencies). Invocation from a Worktree-bound session, with any other checkout, unwritable source or insufficient session policy SHALL return `blocked` without writes. Results SHALL include `activation: live | pending-reload`; no automatic DSH restart is permitted.

#### Scenario: Approved upgrade survives sync
- **GIVEN** writable authoritative source, matching selected/source versions B and an approved exact target C
- **WHEN** staged checks pass, the transaction commits and a sync runs
- **THEN** source pin and root lockfile record C, the sync raises no `dsh-openspec-pin-mismatch`, new consumers use C, a repeated sync keeps C active, generation B's directory is retained and no system-global package changes

#### Scenario: Rollback is source-owned and sticky
- **GIVEN** C is active after an upgrade from B
- **WHEN** an approved rollback to B commits and a sync runs
- **THEN** source pin and lockfile record B, B is active, the sync raises no mismatch, a repeated sync keeps B active, and C's generation directory is retained but inactive

#### Scenario: Failure or forbidden context leaves state unchanged
- **GIVEN** an incompatible target, an integrity that differs from the registry, related source drift, concurrent upgrade, Worktree-bound caller, non-recorded checkout or denied policy
- **WHEN** upgrade or rollback is attempted
- **THEN** the result is `blocked` or `failed` with a named reason, source pin and lockfile hashes equal their pre-attempt values, the active generation id is unchanged, and no restart occurs

### Requirement: Interrupted upgrades are recoverable and never silently repaired
Before any source write, the transaction SHALL write a prepared journal containing only file hashes, identities and phase. After an interruption, the next Host start or consumption SHALL report `recovery-required` without mutating source, while the previously active generation keeps serving; the report SHALL be observable in two places only: the `recovery` field of the adapter block and the management check. New upgrades SHALL be refused until an explicitly authorized helper run commits or rolls back. Rollback SHALL restore a source file only when its current hash equals the hash this transaction wrote; otherwise it SHALL return `recovery-required` with manual reconciliation steps and leave source and journal untouched.

#### Scenario: Kill between source CAS and activation then restart
- **GIVEN** the process is killed after the source CAS and before the active switch
- **WHEN** the Host restarts and a Skill is consumed
- **THEN** the adapter block's `recovery` field equals `recovery-required`, source file hashes are unchanged by the restart, the previous generation id is still active and serves the Skill, and a new upgrade request is refused

#### Scenario: User edit after CAS blocks automatic rollback
- **GIVEN** a journal exists and the user edited `packages/dsh-openspec/package.json` after the CAS
- **WHEN** an authorized rollback is requested
- **THEN** the result is `recovery-required` with manual steps, and both the edited file and the journal are byte-identical to before the request
