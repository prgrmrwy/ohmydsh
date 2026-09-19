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

## Upstream `dirPrefix` collision assessment

Upstream multi-directory search uses a display prefix derived from each search
directory. Two configured directories with the same final path segment can therefore
produce ambiguous identities. dsh-memex does not use that route: it invokes one
isolated `MEMEX_HOME` per scope and attaches the source scope from the call target
before deterministic merge. A local fork is not warranted. If upstream exposes a
structured multi-directory result API later, an issue/PR should request a stable full
directory identity rather than another display-only prefix.

## npm registry pitfall

Repository `.npmrc` points at npmjs, but `npm install -g` ignores project config
and falls back to `~/.npmrc` (bnpm on this machine). The mirror currently lacks
memex 0.4.1. Use an explicit registry for the pinned global install.
