## ADDED Requirements

### Requirement: Official conversation surface is derived from one pinned release
The adapter SHALL derive Skills and workflow commands from one exact official OpenSpec release, initially 1.13.2. It SHALL support the entire official workflow catalog and honor effective official profile/delivery selection. The adapter SHALL define one function `renderOfficialBody(selection)` returning, for each workflow, the `instructions` text of the official renderer's output for that selection with exactly one documented DSH transform applied: official `/opsx:<name>` references are rewritten to the DSH-valid name for the same workflow (DSH command names match `^[a-z][a-z0-9_-]*$`, so `:` is not representable). The same function SHALL feed Skills and commands, and every "body equals the official output" assertion in this change SHALL mean equality with `renderOfficialBody` of the pinned release. A single compatibility module SHALL isolate internal upstream APIs and load them by absolute file URL, because the official package exports only its root entry. It MUST NOT invent workflow semantics or expose CLI-only commands as native conversation tools. Custom init, update management and routing surfaces SHALL be separately named and identified, and preparation SHALL fail closed if any official Skill or command name produced by the pinned release collides with a custom surface name.

#### Scenario: Official catalog and configuration are respected
- **GIVEN** a compatible pinned release and effective profile/delivery configuration
- **WHEN** the adapter materializes its conversation surface
- **THEN** the Skill names and workflow command ids equal the official catalog for that selection, each body equals `renderOfficialBody(selection)`, and selecting all official workflows exposes all 12 baseline workflows

#### Scenario: Unsupported upstream contract is rejected
- **GIVEN** an upstream module has a missing export, unresolved conditional, incompatible template shape, unmapped workflow id, a name colliding with a custom surface, or a body containing a block marker line or a loader frame closer
- **WHEN** the adapter prepares that release
- **THEN** preparation returns `upstream-incompatible`, publishes none of the new release and keeps the previously active generation id unchanged; CLI-only native tools are absent

#### Scenario: Official profile or delivery edits reach the catalog
- **GIVEN** the user changes the official global profile from `core` to `custom` with extra workflows while a session is live
- **WHEN** the adapter next checks the official global configuration (stat on a bounded cadence of at most 30s, or at the next consumption)
- **THEN** the adapter invalidates its provider registration, the next catalog listing contains the newly selected workflows, and a workflow that was dropped is no longer listed

### Requirement: The adapter block has a closed normative format
Each consumed Skill or command result SHALL end with exactly one adapter block placed after the unmodified official body, between two fixed marker lines whose exact bytes the implementation SHALL define once and the tests SHALL assert; the opening marker SHALL carry provenance `dsh-openspec-adapter` and `block-format=1`. The block SHALL contain only this closed field set: generation id (charset `[a-z0-9._-]+`), the managed invocation, telemetry mode, update-check mode, an optional notice `{installed, available, managementEntry}`, and an optional `recovery` status from a fixed enum. The block MUST NOT contain the session cwd, slash or user arguments, project-controlled text, or raw registry or error strings; versions SHALL be re-rendered from parsed integers as `MAJOR.MINOR.PATCH`. The managed invocation SHALL be rendered by one named POSIX single-quote function (`'` becomes `'\''`) applied to every path segment; NUL, CR, LF or any other control character, or a non-absolute path, SHALL yield typed error `block-unrenderable`, no partial block, and a fail-closed load. The invocation SHALL always carry `OPENSPEC_NO_UPDATE_CHECK=1` and, unless the plugin option `telemetry` is `official`, `OPENSPEC_TELEMETRY=0`. Both carriers that hand skill content to the model (the model `skill` tool result and the user `/name` gesture injection) SHALL use the same builder and produce identical block bytes. One shared helper `parseAdapterBlock(content)` SHALL be the only parser used by tests.

#### Scenario: Block is parseable, last, and identical across carriers
- **GIVEN** a loaded Skill reached through the model tool and again through the user gesture path
- **WHEN** `parseAdapterBlock` is applied to each content
- **THEN** each content has exactly one marker pair, the block is last, the field set equals the closed set, and the two blocks are byte-identical

#### Scenario: Hostile DSH_HOME or generation path round-trips as one argument
- **GIVEN** a generation path containing a space, a single quote, `$()`, a backtick and a leading `-`
- **WHEN** the managed invocation is rendered and executed with `sh -c` after substituting a harmless `--version`
- **THEN** the shell receives the path as a single argument and the CLI reports its version; a path containing a newline yields `block-unrenderable` and no block

#### Scenario: Block bytes do not depend on the session cwd
- **GIVEN** the same Skill loaded from two sessions with different cwd values
- **WHEN** both blocks are compared
- **THEN** the blocks are byte-identical

#### Scenario: Hostile registry text yields no injection
- **GIVEN** registry metadata whose version string contains a prerelease tag, build metadata or control characters
- **WHEN** a notice is rendered
- **THEN** the notice contains only canonical `MAJOR.MINOR.PATCH` integers or is omitted, and the block still has exactly one marker pair

### Requirement: The supplied managed invocation binds CLI and templates to one version
The adapter SHALL own an exact official dependency and immutable versioned generations. The DSH Skill loader returns only a Skill's `content`, so the managed invocation SHALL be carried by the adapter block. Version sharing is guaranteed only for that supplied invocation. The adapter MUST NOT change global npm installation or global PATH and MUST NOT claim to redirect bare `openspec` commands; the management check SHALL report any mismatch between the version found on PATH and the selected managed version. A generation SHALL remain executable while its directory exists; v1 SHALL NOT delete any non-staging generation. A load whose active generation directory is missing, corrupt or half-materialized SHALL fail with a typed error and SHALL NOT return a body together with a block pointing at a dead path. The adapter SHALL resolve the active generation exactly once per load and use that one generation for both the body and the block, so the generation id in a block equals the generation that rendered its body even when activation races the load. The lookup `cwd` is declared optional by the DSH skill contract; a load without `cwd` SHALL still succeed with the same body and block, because neither depends on `cwd`.

#### Scenario: Managed execution ignores a different global CLI
- **GIVEN** global OpenSpec version A on PATH, selected managed version B, and default telemetry option
- **WHEN** an adapter workflow loads and the supplied managed invocation is run with `--version`
- **THEN** the loaded content equals `renderOfficialBody` followed by one adapter block, the CLI output reports B, the invocation contains `OPENSPEC_TELEMETRY=0` and `OPENSPEC_NO_UPDATE_CHECK=1`, and global CLI files and PATH are byte-identical to before

#### Scenario: Official update check and telemetry stay off through the managed invocation
- **GIVEN** a counting fake registry and the plugin option `telemetry: official`
- **WHEN** the managed invocation runs `update` and `--version` with the official check otherwise enabled
- **THEN** the fake registry observes zero requests from the CLI, and the invocation contains no `OPENSPEC_TELEMETRY` assignment

#### Scenario: Bare openspec of a different version is reported not redirected
- **GIVEN** global version A differs from selected managed version B
- **WHEN** the Agent runs bare `openspec` and the management check is then run
- **THEN** the bare command runs version A without adapter interception, and the check reports `path-version: A`, `managed-version: B`, `mismatch: true`

#### Scenario: Upgrade does not break an in-flight generation
- **GIVEN** a workflow has loaded generation B and version C is selected later or C fails activation
- **WHEN** the workflow invokes its recorded managed invocation
- **THEN** B executes successfully because its generation directory still exists, and the directory is present after rollback to B

#### Scenario: Missing or half-materialized generation fails closed
- **GIVEN** the active generation directory is missing, or its CLI entry file is absent
- **WHEN** a Skill is loaded
- **THEN** the load fails with a typed error and the result contains neither a body nor a block

#### Scenario: Activation racing a load never mixes generations
- **GIVEN** a load has resolved generation B and the active reference is switched to C before the load finishes
- **WHEN** the load completes
- **THEN** the returned body was rendered by B, the block names generation B, and its invocation points at B's directory

#### Scenario: A lookup without cwd still loads
- **GIVEN** a skill lookup that supplies no `cwd`
- **WHEN** the adapter's `get` runs
- **THEN** it returns the same body and block as the same load with a `cwd`

### Requirement: Slash commands carry the same body and block to the model
The adapter SHALL register one DSH command per effective official workflow under a DSH-valid name equal to the official Skill's workflow name prefixed `opsx-` (for example `opsx-propose`), plus the custom commands `openspec-init` and `openspec-upgrade`. A command handler SHALL submit one message to the calling agent whose source marks the adapter as the author, whose text is `renderOfficialBody` followed by the adapter block, and which MUST NOT contain the raw argument string; the raw arguments SHALL remain only as the user's own input. Registrations SHALL set `recordInput: false` where the command's argument text is not needed for audit. A typed `/<skill-name>` that matches a Skill gesture SHALL be served by the Skill path with identical block bytes. Because a registered command is handled by its handler and its raw argument string is not otherwise sent to the model, an official workflow command SHALL submit a second, user-sourced message containing exactly the raw argument string so the user's own request reaches the model unmodified and is never placed inside the adapter-sourced message. `openspec-init` and `openspec-upgrade` have no official body: their adapter-sourced message text SHALL be a fixed adapter-authored instruction plus the adapter block, with validated values only.

#### Scenario: Command message carries body, block and no raw arguments
- **GIVEN** a command invoked with an argument string containing a sentinel text
- **WHEN** the handler submits its message
- **THEN** the adapter-sourced message text begins with `renderOfficialBody` for that workflow, ends with exactly one adapter block, and does not contain the sentinel; a separate user-sourced message contains exactly the sentinel argument string

### Requirement: Profile-scoped surface follows the invoking workspace
Sessions in every workspace using the enabled profile SHALL discover the adapter's bundled Skills and commands without project copies. Invocation SHALL use the calling session workspace and leave root/store resolution to official OpenSpec. Project/user Skill precedence SHALL remain native DSH behavior; when a same-named project Skill wins, the adapter's `get` does not run, so the adapter SHALL expose which source and provider won through the management check, reading `source` and `provider` from the skill listing. The adapter MUST NOT overwrite project Skills. The adapter SHALL register its Skill provider the same way the existing `archify` and `spec-superflow` host-level providers are registered. Host-level providers are merged into every scope's skill view by the DSH skill registry, so Pet executors and Locus children can list and load the adapter's Skills; this is a known gap shared with those existing providers and is NOT resolved by this change. The gap SHALL be recorded in repository documentation and in `BACKLOG.md` under 缺陷备忘 as a new `D###` entry (next free id, currently `D006`) describing it as a cross-provider problem to be fixed once on the Pet side.

#### Scenario: A second workspace uses the installed surface
- **GIVEN** two ordinary workspaces and no project OpenSpec Skill copies in the second
- **WHEN** each loads an official Skill and invokes its workflow command
- **THEN** both discover the selected profile surface and each command's managed invocation targets its own session cwd, not the Host launch directory

#### Scenario: Project override is preserved and diagnosed
- **GIVEN** a workspace has an older same-named project Skill
- **WHEN** catalog discovery runs and the management check is invoked
- **THEN** native project precedence is unchanged, the adapter's `get` is not called for that name, and the check reports the winning source and provider

#### Scenario: The known Pet exposure gap is documented and detectable
- **GIVEN** a scope composed like a Pet executor with its own additive provider, and the adapter provider registered at host level
- **WHEN** the real skill registry lists that scope
- **THEN** the adapter's Skills are visible, matching the control host-level provider; the repository documents this gap and `BACKLOG.md` records it

### Requirement: Init slash uses the official CLI with validated adapter-built arguments
`/openspec-init` SHALL offer noninteractive official initialization in the caller's workspace, defaulting to `--tools none --no-copilot-cloud --no-animation`. Tool and profile values SHALL be accepted only from the official values of the pinned release; `language` SHALL match `^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$`. The adapter SHALL return one fully shell-quoted command string built by adapter code; the model MUST NOT be asked to interpolate raw arguments. Force/migration cleanup SHALL require separate explicit confirmation. Writes SHALL go through the session's Bash under its filesystem/approval boundary; a Host handler MUST NOT spawn the CLI itself. Because official `init` in extend mode may write the official global configuration (profile=custom) when the global configuration has no `profile` field and the project already holds official workflow artifacts, the result text SHALL warn of that possibility whenever the workspace already contains an `openspec` directory.

#### Scenario: Initialize for DSH without project Skill duplication
- **GIVEN** an authorized invocation in an uninitialized writable workspace
- **WHEN** `/openspec-init` is invoked with defaults and the supplied command is run
- **THEN** official init creates its normal project skeleton in that workspace and creates no project tool Skills, no Copilot cloud files and no files in other workspaces

#### Scenario: Unsafe or unknown arguments are rejected
- **GIVEN** a slash argument containing shell metacharacters, an unknown tool id or a language not matching the pattern
- **WHEN** `/openspec-init` validates it
- **THEN** a typed validation error naming the argument is returned and no Bash command string is offered

#### Scenario: Force or unavailable write authority is not assumed
- **GIVEN** existing artifacts require destructive cleanup or the session cannot authorize writes
- **WHEN** init is requested without explicit cleanup confirmation
- **THEN** the offered command contains no `--force`, the result reports the blocked requirement or official exit status, and no Host-spawned process runs

#### Scenario: Extending a configured project warns about the global configuration
- **GIVEN** a workspace that already contains an `openspec` directory
- **WHEN** `/openspec-init` returns its result
- **THEN** the result text contains the global-configuration warning; for an uninitialized workspace it does not

### Requirement: Bundle deployment is reproducible reversible and recorded
The adapter SHALL be an ohmydsh local package written fresh, crediting `@codigoconelmer/dsh-openspec@0.1.0` as prior art in NOTICE without copying its source. The `dsh.yaml` entry's `note` SHALL record the official dependency in prose (upstream, license, telemetry and credential boundary, upgrade checkpoint, removal path) and SHALL NOT carry a machine-checked version or integrity. `packages/dsh-openspec/package.json` plus the root lockfile SHALL remain the single pin, and build/sync SHALL fail with a named diagnostic `dsh-openspec-pin-mismatch` naming both values when the package.json pin differs from the name, version or integrity the root lockfile resolves for `@fission-ai/openspec`. The plugin options `updateCheck` and `telemetry` SHALL be read from the DSH settings service under the namespace `dsh-openspec` (backed by the user's settings file), with defaults `enabled` and `adapter-off`. Peers SHALL follow the current DSH family; generated artifacts SHALL be excluded from Git. Repeated sync SHALL be a no-op. Disabling SHALL remove only its registered surface and managed deployment references, not project artifacts, global CLI or unrelated router/Jev resources.

#### Scenario: Clean installation and repeated sync converge
- **GIVEN** a clean checkout whose `packages/dsh-openspec/package.json` pin matches the root lockfile, and an enabled manifest entry
- **WHEN** build/sync runs twice
- **THEN** the first run produces the loadable bundle, the second reports no changes, and NOTICE names the prior-art package and version

#### Scenario: Package pin and lockfile disagree
- **GIVEN** `packages/dsh-openspec/package.json` pins version Y while the root lockfile resolves X for `@fission-ai/openspec`
- **WHEN** build/sync runs
- **THEN** it exits non-zero with diagnostic `dsh-openspec-pin-mismatch` naming X and Y, and the deployed profile `package.json` is byte-identical to before

#### Scenario: Options come from the settings service
- **GIVEN** the settings namespace `dsh-openspec` sets `updateCheck: disabled` and `telemetry: official`
- **WHEN** the adapter starts
- **THEN** the effective options equal those values, and with no settings they equal the defaults

#### Scenario: Disable leaves unrelated state intact
- **GIVEN** the adapter is deployed with existing project changes and Jev resources
- **WHEN** its manifest entry is disabled and sync plus profile reload completes
- **THEN** its Skills/commands/services are absent from a new session's catalog and `request/header` tools, while project files, global CLI and Jev resources are byte-identical
