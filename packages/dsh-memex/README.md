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

Libraries live under one namespace and never reference one another. The scope map is
local-path based — the local repository path decides the library, not the remote URL:

```text
~/.dsh-memex/
  personal/
  nexus/
  flow-web-monorepo/
```

Every child is a standard memex home (`cards/`, optional git repository and
remote). A library may be copied, synced or deleted independently.

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

## Settings

Configuration is registered under the `dsh-memex` DSH settings namespace.
Absent settings use schema defaults. Invalid settings at registration prevent the
plugin from publishing tools; invalid live edits are rejected by the official
settings provider while the plugin continues using the last-good value.

## Runtime prerequisites

```bash
npm install -g @touchskyer/memex@0.4.1 --registry=https://registry.npmjs.org/
```

Global npm installs may ignore the repository `.npmrc` and fall back to a user
mirror. This repository's user-level bnpm mirror currently lags npmjs, so the
explicit registry argument matters for the pinned release.
