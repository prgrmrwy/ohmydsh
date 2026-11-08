# Judgement presets

[中文](README.zh.md)

A judgement preset is a built-in, named and sourced set of Jev questions. Users pick one under Settings → Auto model routing → Judgement preset; the default is `reasoning-depth`.

A preset decides **only** the questions Jev sees (`rubric.json`) and context lines from a fixed set (currently only `execution`). The depth offset, effort cap, family starting efforts and sub-model capability slots are not part of a preset, and switching presets never changes them.

| id | Document | In one line |
|---|---|---|
| `reasoning-depth` (default) | [reasoning-depth.md](reasoning-depth.md) | depth follows reasoning difficulty |
| `effort-as-verification` | [effort-as-verification.md](effort-as-verification.md) | depth follows the verification and edge-case work needed |

The two preset documents are written in Chinese.

## Presets are not versions

Presets live side by side and the user chooses one. They never upgrade automatically and a user's selection is never migrated. A new preset is named after its way of judging, without a sequence number or date suffix. Runtime records store only the preset id, never a version key.

## Adding a preset

1. Create `src/presets/<id>/rubric.json`. Its labels must match the existing presets exactly: capability `bounded/analytical/frontier/insufficient_context`, depth `lower/baseline/higher`.
2. Append an entry to `PRESETS` in `src/presets/index.ts` with English and Chinese title, summary and evidence, `https` sources and `context`.
3. Append the id's `rubricSha256` and `context` to the lock table `LOCK` in `test/presets.test.ts`.
4. Create `docs/presets/<id>.md` with its source, key points, how it differs from the other presets and known limits.

## Published presets never change in place

**Existing lock-table entries are read-only; only append new ids** (rule text: `只能追加新 id`). To change how a published preset judges (the bytes of its `rubric.json` or its `context`), create a new preset instead. Title, summary, evidence and sources are outside the lock and may change at any time.

The lock test only detects content that no longer matches the lock table; it cannot stop someone who edits a rubric and its lock entry together. So whoever reviews a PR that adds or touches presets checks it against the lock table of the previous release: no existing row changed, only new rows were added.
