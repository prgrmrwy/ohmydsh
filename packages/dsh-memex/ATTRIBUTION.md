# Attribution

This package builds on **[@touchskyer/memex](https://github.com/iamtouchskyer/memex)**
(MIT, Copyright (c) 2026 iamtouchskyer). Its full license text is carried alongside
this file as `LICENSE-memex`.

The relationship is deliberate and narrow: memex supplies the complete Zettelkasten
capability (card format, methodology skills, CLI); this package adds two things and
changes nothing in memex itself.

## Verbatim derivation

| Content | Where it lives here | How it is kept in sync |
|---|---|---|
| Tool names and model-facing descriptions | `src/tools/descriptions.generated.ts` | Extracted from the pinned kernel release by `scripts/sync-memex-descriptions.mjs`; `npm run check:descriptions` fails when they drift |

That generated file is the only verbatim copy of upstream text in this package. It is
extracted at *sync* time by a maintainer, never read at runtime.

## Concept reference

The session-lifecycle design (tool registration in-process, recall injection at
session start, a write reminder at turn close, and resetting recall state after
compaction) follows the integration shipped as memex's Pi extension:

- `pi-extension/index.ts` in the memex package
- https://github.com/iamtouchskyer/memex/blob/main/pi-extension/index.ts

## Not reused

**No implementation code from memex is copied.** The Pi extension depends on Pi's
`ExtensionAPI` and TypeBox, which this host does not provide; the equivalent wiring
here is written against this host's own APIs. The upstream code is a structural
reference, not a source of code.

## Not copied either

memex's methodology skills (`skills/` in its package) are **referenced in place**, not
copied: the host's custom skill-root mechanism points at the installed package's
`skills/` directory. Upstream updates therefore take effect without any action here.

## What this package adds

1. Host-native tool registration (so each call sees the calling session's working
   directory — memex's MCP server cannot).
2. A **scope** dimension: resolving a session to one knowledge domain and injecting
   that domain's `MEMEX_HOME`, plus concurrent multi-library retrieval and a guard on
   writes into externally published libraries.
