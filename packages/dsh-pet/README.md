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

Pet does **not** inherit DSH's global Skill discovery, and it ships **no
Skills of its own**. Every capability comes from an ordinary DSH Skill the
user imports explicitly. Two facts are stored separately per Skill: whether it
is registered, and whether it is enabled (plus whether it appears as a
shortcut).

Crucially, Pet reads **nothing Pet-specific** from a `SKILL.md`. There is no
`petLabel`, `petIcon` or `petContext` — a Skill cannot opt into better
treatment inside Pet, so "Pet-adapted" and "ordinary" Skills are the same
thing. The capability's label is the Skill name and its description is the
Skill's own. This is why `skills/ws` from the ohmydsh repository works as a Pet
capability with no changes whatsoever.

The single install source is **local import** from an absolute path *on the
Host machine running `dsh web`* (not the browser's machine). Import is two
steps: a read-only inspection showing name, description and file inventory,
then a separately confirmed registration.

Every import is validated (`SKILL.md` present, kebab-case name, non-empty
description, no symlinks, no special files, no path escapes,
file-count/per-file/total-size limits). What is stored is a **link to the
user's own directory**, not a copy:

```
skillName -> /absolute/path/the/user/gave
```

Editing that directory takes effect immediately, with no re-import. Deleting or
moving it makes the Skill unresolvable, and the capability refuses to run
rather than executing something stale.

### Managed symlink projection

Registered, enabled Skills are projected into the Pet workspace as
**Pet-created directory symlinks**:

```
$DSH_HOME/plugins/dsh-pet/workspace/.dsh/skills/<name>
  -> /absolute/path/the/user/gave
```

DSH's filesystem Skill provider follows direct child symlinks, so one canonical
directory serves every runtime. Pet does **not** also copy into
`.agents/skills` or provider-specific directories: Skills belong to the DSH
Agent runtime, not to the selected LLM provider, and duplicate roots create
ambiguous precedence.

**The projection is not the authorization boundary.** The Pet allowlist
provider is. A projection entry that is missing, not a symlink, or broken is
treated as drift: the affected Skill fails closed until you rebuild the
projection explicitly from Settings → Diagnostics.

Pet applies **no per-capability context gate**. Any capability can be invoked
from any source, including the independent scope — knowing what a given Skill
requires would mean the Skill declaring it, which is exactly the coupling above
removes. A Skill that needs a session, a repository or a configured value
checks its own snapshot through `pet_context` and stops to ask when something
is missing.

## Runtime paths

Everything mutable lives under the **active** DSH home — never in the package
checkout or the generated profile, so plugin upgrades and profile rebuilds
cannot destroy task data:

```
$DSH_HOME/plugins/dsh-pet/
├── state.sqlite                 durable Tasks, Invocations, snapshots, runs,
│                                registered Skills, environment values
├── workspace/                   the registered "DSH Pet" workspace
│   ├── AGENTS.md                Pet standing instructions
│   └── .dsh/skills/<name>       managed symlink projection
└── skills/
    ├── store/                   legacy; unused since Skills became links
    └── staging/                 legacy; unused since Skills became links
```

> `skills/store` and `skills/staging` date from an earlier model that copied
> each Skill into an immutable content-addressed revision. Skills are now
> registered as links to the user's own directory, so both are inert. An
> existing installation may still hold orphaned directories there; they are
> safe to delete.

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
- **Skills** — local import, enable/disable, shortcut visibility, run
  arguments, removal, projection status. Pet ships no Skills of its own, so
  this list starts empty
- **Environment** — key/value pairs in a `global` scope and per source
  workspace, injected into executor shell calls as `DSH_PET_*`
- **Diagnostics** — lifecycle, paths, allowlist, drift, explicit rebuild

The floating Pet and Task panel handle only quick execution, source
confirmation and day-to-day Task operations. Installation, environment and
diagnostics live in Settings.

## Environment values

A Skill often needs a value Pet cannot infer — which review group to post to,
which URL shape identifies this organization's merge requests. Those are
configured in Settings and reach the Skill as **ordinary environment
variables**, so nothing organization-specific has to be written into a Skill
that is otherwise shareable.

Two scopes, resolved per Invocation from the snapshot's source workspace:

| Scope | Applies to |
| --- | --- |
| `global` | Every Pet Task, including independent ones |
| A workspace id | Only Tasks sourced from that workspace; **overrides** a same-named global entry |

Keys are upper snake case and are injected with a `DSH_PET_` prefix, so
`CR_GROUP` is read as `$DSH_PET_CR_GROUP`. When neither scope defines a key the
variable is simply absent — Pet invents no default, and a Skill that needs it
is expected to stop and ask rather than guess.

Injection goes through DSH's own `ctx.shellEnv` registry, so values travel on
the `dshEnv` channel to the child process and never appear in the prompt, the
envelope or any model-visible text. The registry is an **optional** dependency:
where it is absent Pet logs the fact and injects nothing instead of degrading.

Values are stored in Pet's SQLite state, not in any repository, and they reach
every command the executor runs. The panel says as much: this is not a
credential store, and the masking in the list is display-only.

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
