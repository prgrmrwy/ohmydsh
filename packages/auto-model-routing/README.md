# dsh-auto-model-routing

[中文](README.zh.md)

<!-- problem -->
Automatically adjust the main chat's reasoning effort without changing its provider or model. Disabled by default; each chat starts in MANUAL. A local synchronous classifier reads bounded user text and sends nothing to an external classification service. A separate skill guides explicit child-agent model selection.

## Use

The AUTO/MANUAL control sits before the GPT speed control. Its arrow opens the anchor, current reason and the last 20 in-memory decisions. History disappears on restart and contains no task text. Mode, anchor and pending restoration are stored under `$DSH_HOME/state/auto-model-routing/sessions/`.

MANUAL keeps restoring across stale-snapshot retries until both the persisted request header and official configuration converge. It never changes the model to catch up with an anchor. Network restrictions and official model allowlists remain authoritative. Provider cache hits are not guaranteed.

## Development

Install dependencies from the workspace root, then run:

```sh
npm --prefix packages/auto-model-routing test
npm --prefix packages/auto-model-routing run typecheck
npm --prefix packages/auto-model-routing run build
```

Integration tests use the real AgentLoop with a fake LLM stream. They do not call a model service. Source scans are supplemental checks, not a complete security proof. Offline checks do not replace acceptance in the existing GUI.

## Removal
<!-- section: removal -->

Switch to MANUAL, complete a request and wait for restoration to finish before disabling and rebuilding. Unloading directly may leave the last AUTO effort; restore it with the official model picker. The child-agent skill has its own manifest switch and does not follow the main chat mode.
