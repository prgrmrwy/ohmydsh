# DSH × memex integration notes

## Why not use the MCP server directly

memex's MCP server resolves one home when the process starts:

1. `MEMEX_HOME`
2. walk upward from `process.cwd()` for `.memexrc`
3. `~/.memex`

`dsh-mcp-client` launches a long-lived stdio child whose cwd is the DSH Host's
cwd, not `agent.session.header.cwd`. A single child therefore cannot route calls
from concurrent Sessions into different libraries. The integration registers
native DSH tools and spawns the memex CLI per call, injecting exactly one
`MEMEX_HOME`.

## DSH lifecycle equivalents

The first design draft incorrectly concluded that DSH lacked SessionStart/Stop
hooks. The equivalent surface lives in `@deepseek-ai/dsh-agent`, not only in the
hook-protocol package:

- `agent/session-start` + `agent.inject()` — seed recall guidance before the
  first turn; `source: "compact"` resets recall state after compaction.
- `agent/turn-stopping` + `agent.inject()` — queue a non-interrupting write
  reminder for the next step/turn when recall occurred but no write did.

Injected messages use `{kind:"plugin", plugin:"dsh-memex"}` provenance so
transcript consumers do not mistake them for user messages.

## CLI output is not structured

memex 0.4.1 `search`, `read`, and `write` do not expose JSON output. The adapter
therefore pins the version and centralizes parsing. Important observed contracts:

- search miss: exit 0, empty stdout;
- missing library: exit 0, empty stdout, stderr warning — indistinguishable from
  a miss unless the caller validates `cards/` first;
- read miss: exit 1 and `Card not found` on stderr;
- write success: exit 0, stdout empty, stderr may contain warnings;
- missing required fields and sensitive input: exit 1 with stderr.

Never infer success from output emptiness; use exit status.

## Sync granularity forces physical isolation

Both `GitAdapter.push()` and `pull()` operate at memex-home repository scope.
There is no per-card remote routing, so one library can have only one publish
target. The package therefore stores each scope under `~/.dsh-memex/<scope>`.

## Fallback is local derivation, not `personal`

An unowned directory used to resolve to `personal`, which is itself synced — so
writing a card in, say, `~/Documents/learning` pushed it to the `personal`
remote. The directory now derives its own library from its last two path
segments (`~/Documents/learning` → `documents-learning`), under the same
namespace, with **no remote**: nothing leaves the machine until a human
configures one.

`personal` remains resolvable and is now the **fallback entry**: reachable in both
directions by default, so a new workspace works with no configuration at all. An
entry declares `fallback: false` to turn that off, and then neither reading nor
writing reaches `personal` — "not using an entry" means neither direction. A
binding that lists `personal` explicitly still grants it, because an explicit
declaration outranks a default. To keep a directory *in* `personal` as its own
library, declare it as one of `personal`'s workspace paths.

Migration cost: cards already written into `personal` from such directories stay
there. They are not moved, and the new library starts empty.

## The page is built on the host's workspace registry

The workspace list comes from `ctx.workspaceRegistry` (the same entities the
sidebar shows: `{id, title, path}`), not from the configured path prefixes. The
configured prefixes are only a *copy* of the real workspaces: this machine has
eight workspaces and four of them had no configuration at all, so a page built on
the configuration could not show them or let anyone attach an entry to them.

`ctx.get('workspaceRegistry')` reads the service **without an injection
requirement**, which is what makes it truly optional: absent (or throwing), the
endpoint answers `known: false` and the page falls back to configuration-only
blocks with a visible explanation. An empty list would be a different claim —
"you have no workspaces" — and the page must never make it up.

Registry paths are absolute while configured prefixes are usually `~/…`, so the
same answer carries `homeDir`; without it the browser cannot tell that
`~/mydir/dev/nexus` and `/Users/me/mydir/dev/nexus` are one workspace.

Two traps worth remembering when editing this page:

- **`resolve()` stops deriving as soon as one declaration matches the directory.**
  Attaching a second entry to an undeclared workspace therefore has to declare the
  derived primary in the same save, or the new entry silently takes the route. The
  page stages that declaration and says so in the notice line.
- **One library is one configuration entry.** Attaching an existing library to a
  workspace must add the path to that library's own entry, never append a second
  row with the same name — and the picker must not offer a library the workspace
  already has, which is how the duplicate-name error used to become reachable from
  the interface.

The same derivation shape serves both paths (`<last two segments joined by ->`,
normalized), so one collision check covers them: two different sources — two
remotes, two local paths, or one of each — that produce one name raise
`Different sources derive the same scope …` instead of silently sharing a library.

## Remote actions and the "never re-create" rule

The settings page configures remotes only through the kernel CLI
(`sync --init <url>`, `sync`, `sync push|pull`, `sync on|off`) and only on an
explicit human action. The system never writes a library's `.sync.json`,
`.gitignore`, or git repository.

Upstream `--init` is safe to point at an existing library because it probes for a
git directory first and updates the remote instead of re-adding it. Verified
behaviours (see change `dsh-memex-settings-ui`, task 0.6):

- re-running `--init` leaves `.git`, the card files' inodes and hashes, and the
  commit count untouched;
- an unmergeable history aborts the merge and exits 1 with the cards unchanged;
- `--init` writes `auto: true`, so configuring a remote turns auto-sync **on** by
  default — the page shows that state and can turn it off.

**Locale trap:** the kernel decides "remote already exists" by matching the
English string `already exists` in the git error. With `LANG=zh_CN.UTF-8`, git
answers 「远程 origin 已经存在。」, the check misses, and re-running `--init` on a
configured library fails outright. Every kernel call therefore runs with
`LC_ALL=C`/`LANG=C` (see `runKernel`). Re-check this on any kernel upgrade.

## Upstream `dirPrefix` collision assessment

Upstream multi-directory search uses a display prefix derived from each search
directory. Two configured directories with the same final path segment can therefore
produce ambiguous identities. dsh-memex does not use that route: it invokes one
isolated `MEMEX_HOME` per scope and attaches the source scope from the call target
before deterministic merge. A local fork is not warranted. If upstream exposes a
structured multi-directory result API later, an issue/PR should request a stable full
directory identity rather than another display-only prefix.

Note (kernel 0.4.1): the *default* (non-nested) slug mode identifies a card by
**basename** — writing `slug` updates an existing `cards/nested/slug.md` in place,
verified by probe. That is upstream's own contract, and the reason the multi-directory
prefix problem exists at all.

## npm registry pitfall

Repository `.npmrc` points at npmjs, but `npm install -g` ignores project config
and falls back to `~/.npmrc` (bnpm on this machine). The mirror currently lacks
memex 0.4.1. Use an explicit registry for the pinned global install.
