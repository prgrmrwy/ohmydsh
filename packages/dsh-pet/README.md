# dsh-pet

A resident desktop-companion Agent entry for DeepSeek Harness. Pet stays close
to whatever you are working on, runs management Skills against a **trusted,
immutable snapshot** of that moment, and keeps the whole relationship
traceable — without polluting your development session.

Pet ships as one package with a **Host half** (persistence, task coordination,
session creation, tools) and a **Web half** (a draggable mascot, a capability
menu, a task panel and a settings section).

## Product concepts

These four are deliberately distinct entities, not synonyms:

| Concept | What it is |
| --- | --- |
| **Task** | A long-lived work thread for one source scope. Owns exactly one executor session for its whole lifetime. |
| **Invocation** | One user request inside a Task. Each has its own immutable snapshot. |
| **Snapshot** | The source state frozen at the moment you invoked a capability. Never rewritten. |
| **Run** | One execution attempt of an Invocation. A transient retry adds a Run; it never re-targets. |

**Source session vs executor session.** The *source* is the session you were
looking at when you invoked Pet. The *executor* is an ordinary DSH root session
in the Pet-owned `DSH Pet` workspace that actually does the work. They are
never the same session, and Pet never runs inside your development session.

At most one unarchived Task exists per source scope (`session:<id>`,
`workspace:<id>`, or the independent scope). Invoking three capabilities from
one session appends three Invocations to one Task and one executor session —
it does not create three sessions. Archiving closes a Task permanently; the
next invocation from that source starts a **new epoch** with a fresh executor.

## Why snapshots are captured in the browser

The active session is browser UI state. The Host cannot observe it and cannot
reconstruct it afterwards. So Pet freezes the source at the instant you
confirm an Invocation. If you switch pages immediately after clicking, the
running Invocation still targets the session you launched it from.

## Trust model

Prompt text is **not** an authorization boundary. Two mechanisms are:

1. **`pet_context`** — a zero-argument tool. The target is resolved from the
   real executing session id, so a model cannot pass an identifier to redirect
   at another Task, session or workspace. It fails closed for ordinary
   sessions, archived Tasks and ambiguous or missing current work.
2. **Bounded tools** — side effects (creating an MR, sending a message,
   cleaning a worktree) run through deterministic tools and existing safety
   gates, never through free-text destinations the model invented.

Pet never reads, copies or stores provider credentials. It records only the
selected provider/model **ids**; authentication stays with the DSH provider and
subscription plugins.

## Skill installation and isolation

Pet does **not** inherit DSH's global Skill discovery. Three facts are stored
separately per Skill: which immutable revisions are installed, which single
revision is enabled, and whether it appears as a shortcut.

Two install sources are supported in this phase:

- **Built-in** bundles declared in the package's `skills/manifest.json`. Only
  declared directories are read — the directory is never scanned — and Pet
  never executes from `node_modules`.
- **Local import** from an absolute path *on the Host machine running
  `dsh web`* (not the browser's machine). Import is two steps: a read-only
  inspection showing name, digest and file inventory, then a separately
  confirmed copy.

Every install is validated (`SKILL.md` frontmatter, kebab-case name, no
symlinks, no special files, no path escapes, file-count/per-file/total-size
limits), copied through staging, re-digested after the copy, and atomically
renamed into a content-addressed revision:

```
$DSH_HOME/plugins/dsh-pet/skills/store/<skill-name>/sha256:<hex>/
```

Because the digest is re-computed on the copy, editing the source directory
during import fails the import instead of installing something that does not
match its digest. Editing it afterwards changes nothing at all.

### Managed symlink projection

Enabled revisions are projected into the Pet workspace as **Pet-created
directory symlinks**, not duplicate copies:

```
$DSH_HOME/plugins/dsh-pet/workspace/.dsh/skills/<name>
  -> $DSH_HOME/plugins/dsh-pet/skills/store/<name>/sha256:<hex>/
```

DSH's filesystem Skill provider follows direct child symlinks, so one
canonical revision serves every runtime. Pet does **not** also copy into
`.agents/skills` or provider-specific directories: Skills belong to the DSH
Agent runtime, not to the selected LLM provider, and duplicate roots create
ambiguous precedence.

**The projection is not the authorization boundary.** The Pet allowlist
provider is. A projection entry that is missing, not a symlink, broken, or
resolves outside the immutable store is treated as drift: the affected Skill
fails closed until you rebuild the projection explicitly from Settings →
Diagnostics.

Each Invocation fixes the exact digest it will run. Upgrading a Skill while
work is queued does not change what that queued work executes, and a revision
stays on disk while any unarchived Task or non-terminal Invocation references
it.

## Runtime paths

Everything mutable lives under the **active** DSH home — never in the package
checkout or the generated profile, so plugin upgrades and profile rebuilds
cannot destroy task data:

```
$DSH_HOME/plugins/dsh-pet/
├── state.sqlite                 durable Tasks, Invocations, snapshots, runs
├── workspace/                   the registered "DSH Pet" workspace
│   ├── AGENTS.md                Pet standing instructions
│   └── .dsh/skills/<name>       managed symlink projection
└── skills/
    ├── store/<name>/<digest>/   immutable revisions
    └── staging/                 scratch space for atomic installs
```

Pet composes the standard `@deepseek-ai/dsh-storage-sqlite` backend and routes
**only** its own `dsh_pet` domain to it. `storage-domain.routes` is an override
map, so every other DSH domain keeps the profile's default backend. If the
`sqlite` backend name is already owned by an incompatible composition, Pet
degrades rather than writing into a foreign medium.

> The domain is spelled `dsh_pet`, not `dsh-pet`: DSH's `UNIT_NAME_RE` must
> stay safe as a filename and an unescaped SQL identifier, so hyphens are
> rejected. The route key in `cordis.patch.yml` must match exactly.

## Host lifecycle

The Host runs as a service inside the existing `dsh web` process — not a
separate daemon. `apply` is registration-only and all fallible initialization
is contained, so a Pet failure degrades **Pet alone**:

`starting → ready | degraded → stopping`

Closing the browser does not stop a running Invocation. Stopping `dsh web`
stops the Pet Host, and durable state is recovered on the next start. Work
whose outcome cannot be proven is marked `recovering` or `failed` with a
diagnostic — never reported as success.

## Management surface

Every route is an exact path with a strict body allowlist, restricted to
same-origin loopback requests. There is deliberately **no** generic RPC
bridge: no `callDshRpc`, no arbitrary prompt, no arbitrary filesystem path
outside the dedicated validated import operation, and no channel destination
pass-through. Unknown request fields are rejected rather than ignored, and
responses are redacted before they reach the browser.

## Settings

Four stable tabs:

- **General** — appearance/position reset, provider/model, default context policy
- **Skills** — built-in inventory, local import, enable/disable, shortcut
  visibility, upgrade/uninstall, projection status
- **Bindings** — trusted workspace/business/group/reviewer destinations
- **Diagnostics** — lifecycle, paths, digests, drift, explicit rebuild

The floating Pet and Task panel handle only quick execution, source
confirmation and day-to-day Task operations. Installation, bindings and
diagnostics live in Settings.

## Installation

### Managed by ohmydsh (this repository)

`dsh.yaml` is the single deployment switch:

```yaml
- id: dsh-pet
  type: package
  source: local
  version: 0.1.0
  enabled: true
```

Run `dsh build` (or `node scripts/sync.mjs`) to materialize. Set
`enabled: false` and rebuild to roll back; `$DSH_HOME/plugins/dsh-pet/` is
preserved so re-enabling recovers your data.

### Independent installation

The package does not depend on ohmydsh at runtime. Install it into any DSH
profile and let the bundle patch compose the Host and Web halves.

## Supported DSH range

Built against DSH `0.1.1-rc.2`. These are pre-stable release candidates: client
slots, Host Agent services and session metadata may change between versions.

## Capability availability

Organization-specific integrations (internal CLIs, chat transports, Worktree
Session) may be absent. Availability is **computed**: a missing dependency
disables that capability with a diagnostic instead of breaking Pet. Base Pet
and independent installation always load.

## Development

```bash
npm run build      # host (tsc) + client (tsdown)
npm run typecheck  # both programs
npm test           # vitest
```

Tests run against the real DSH storage layer and real SQLite backend, and use
real filesystems for symlink projection, rather than mocking those contracts.

## License

MIT
