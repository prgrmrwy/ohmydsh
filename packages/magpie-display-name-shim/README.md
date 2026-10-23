# dsh-magpie-display-name-shim

English · [简体中文](README.zh.md)

<!-- problem -->
With [dsh-magpie-connect](https://github.com/bitxeno/dsh-magpie-connect) 0.4.1 the DSH model picker lists Magpie gateway models by their route id (`claude/claude-haiku-5-5`, `codex/gpt-6-luna`) instead of the display name the gateway already provides (`Claude Haiku 5.5`, `GPT-6-Luna`). This plugin makes the picker show the display names.

The upstream fix is [bitxeno/dsh-magpie-connect#1](https://github.com/bitxeno/dsh-magpie-connect/pull/1). This shim bridges the gap until a release with that fix is pinned; then disable or remove it.

## How it works

- On `llm/adapters-updated` it wraps the adapter registered for the Magpie route (`dsh-magpie-connect` by default): the `name` returned by `listModels` and `resolveModel` is replaced by the gateway display name.
- Names come from dsh-magpie-connect's own catalog cache (`~/.dsh-magpie-connect/magpie-models.json`), re-read only when the file changes. The shim makes no network requests.
- `id` is never changed, so routing, saved selections and session history keep the route id. Models without a display name keep showing their id.
- Any failure to read the cache leaves names as they were; the picker is never broken by the shim.

## Configuration

| Field | Default | Description |
|---|---|---|
| `providerId` | `dsh-magpie-connect` | Route id registered by dsh-magpie-connect (its `providerId`). |
| `dataDir` | `~/.dsh-magpie-connect` | dsh-magpie-connect's data directory (its `dataDir`). |

## Removal

<!-- section: removal -->
`test/real-adapter.test.mjs` asserts the pinned dsh-magpie-connect still reports `name: id`. When an upgrade makes that assertion fail, the upstream fix has shipped: set `enabled: false` in `dsh.yaml`, run `dsh build`, and restart.

## Development

```bash
npm test
```
