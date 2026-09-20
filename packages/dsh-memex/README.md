# dsh-memex

DSH-native memex integration with one added dimension: **scope**.

This package is structurally the DSH equivalent of the Pi extension shipped by
[`@touchskyer/memex`](https://github.com/iamtouchskyer/memex): it registers the
memex tool surface in-process, subscribes to the host session lifecycle, and
publishes memex's bundled methodology skills. It additionally resolves each DSH
Session to an isolated memex library and coordinates multi-library reads/writes.

## What belongs where

- **memex owns:** card format, Zettelkasten methodology, slugs, wikilinks,
  recall/retro/organize workflows, sync and serve.
- **DSH owns:** Sessions, tools, lifecycle events, settings and skill discovery.
- **this package owns:** cwd → scope → `MEMEX_HOME`, concurrent cross-library
  search, result provenance, binding limits and the external-publish write guard.

No memex source, skill, or card format is modified. See `ATTRIBUTION.md`.

## Storage layout

Libraries live under one namespace and never reference one another. A scope is
resolved from the Session's cwd in this order: a configured workspace path, a
configured repository pattern, then derivation — from the repository's `origin`
for a checkout, or from the directory's own path when it belongs to no
repository:

```text
~/.dsh-memex/
  personal/               # declared: shared by the workspaces the config lists
  nexus/                  # declared
  documents-learning/     # derived locally: a directory outside every repository
  prgrmy-ohmydsh/         # derived from a remote that no entry claims
```

Every child is a standard memex home (`cards/`, optional git repository and
remote). A library may be copied, synced or deleted independently.

Two consequences worth knowing:

- **A directory that belongs to no repository no longer lands in a shared
  library.** It gets its own, named after its last two path segments, and that
  library stays local: nothing is pushed anywhere until a human configures a
  remote for it.
- **`personal` is the fallback entry**: reachable in both directions by default,
  so a new workspace is usable with no configuration at all. A workspace whose
  entry declares `fallback: false` reaches neither reading nor writing it, and a
  binding that names it explicitly still can (an explicit declaration outranks a
  default).

A library is only materialized on the first write to it, so a repository that
never touches memory never creates one.

## Tool behavior

The package registers the eight tools exposed by memex's Pi extension:

- `memex_recall`, `memex_retro`, `memex_search`, `memex_read`
- `memex_write`, `memex_links`, `memex_archive`, `memex_organize`

Names and descriptions come verbatim from the pinned memex release. Scope is
implicit (`current`) unless the operation accepts an optional `scope`. Multi-
library search fans out concurrently, one normal memex CLI call per library.

## Guard boundary

Writes to libraries whose `publish` direction is `external` are scanned for:

- known internal scope names,
- internal domains/remotes/private IPs,
- known internal workspace paths.

Unknown publication direction is treated as external (fail closed). The guard
reduces accidental writes; it **cannot guarantee that semantic business
information is absent**. Cross-library content must still be rewritten in a
context-appropriate, de-businessized form, and externally published libraries
require periodic human review.

Internal-to-internal writes are not guarded: they are a potential filing error,
not an irreversible external disclosure.

The publication direction is deliberately **not** editable in the settings page:
it is the guard's input, so relaxing it stays an explicit hand edit.

## Settings

Configuration is registered under the `dsh-memex` DSH settings namespace.
Absent settings use schema defaults. Invalid settings at registration prevent the
plugin from publishing tools; invalid live edits are rejected by the official
settings provider while the plugin continues using the last-good value.

A rejected edit keeps the previous section, so an invalid draft can never change
how memory is routed.

### The Memory settings page

The web half registers a **记忆 / Memory** section in the DSH web settings panel.

Its unit is a **workspace** — the host's own workspace registry, not a re-reading
of the configured paths — and each workspace lists the memory entries a session
in that directory uses:

- **the primary entry** carries the route: recall, the graph-level operations and
  default reads and writes. A workspace nothing declares shows the library the
  resolver *derives* for it, marked as derived and written to the configuration
  only when a decision (a second entry, or the fallback) needs it to be.
- **additional entries** — including the fallback entry `personal`, on by
  default and switchable on the row itself — are reachable but never touched
  unless a call names them.

An entry is listed as role + name + card count and expands into its own facts:
library path (copyable, with the namespace default as a placeholder), remote
address, auto-sync state, last sync and publication direction (read-only).

Adding an entry picks from the libraries that exist (declared ones plus
undeclared ones found under the namespace) or offers to create a new one, so a
duplicate name is not reachable from the interface — one library is always one
configuration entry, whatever number of workspaces claim it.

It also lists libraries that exist under the namespace but no entry declares
(derived ones included) and can declare them, and offers a path probe that
answers which library a directory resolves to **without creating anything**.

Two claims are refused before a save: one library directory shared by two
entries, and one repository pattern written verbatim under two entries. Whether
two *different* patterns claim the same repository cannot be decided from the
configuration, so that case is reported when a session actually resolves against
it.

### Remote actions

The page configures remotes, and only through the kernel CLI:

| Library state | Actions |
|---|---|
| no remote configured | configure remote (`memex sync --init <url>`) |
| remote configured | sync now, pull, auto-sync on/off, change remote (separate, confirmed) |

An already-configured library is **never re-initialized or rebuilt**: the kernel
detects the existing repository and updates the remote instead. Every kernel call
runs with a C locale, because the kernel decides "remote already exists" by
matching an English git error string — a localized `git remote add` failure would
otherwise make re-running `--init` refuse.

The system never writes a library's own files: `.sync.json`, `.gitignore` and the
git repository remain the kernel's.

## Runtime prerequisites

```bash
npm install -g @touchskyer/memex@0.4.1 --registry=https://registry.npmjs.org/
```

Global npm installs may ignore the repository `.npmrc` and fall back to a user
mirror. This repository's user-level bnpm mirror currently lags npmjs, so the
explicit registry argument matters for the pinned release.
