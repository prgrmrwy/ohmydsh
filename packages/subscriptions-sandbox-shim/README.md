# dsh-subscriptions-sandbox-shim

English · [简体中文](README.zh.md)

<!-- problem -->
When DSH runs in `danger-full-access` with `approval: never`, ChatGPT/Codex and Grok sessions keep failing tool calls with `sandbox escalation ... is not strictly wider`, because the models fill in sandbox-escalation fields that this deployment can never honour. This plugin removes those fields at the adapter boundary so the calls simply work.

A deployment-side mitigation plugin: it cleans the sandbox-escalation fields (`sandbox_permissions` / `justification`) off the tool surface of subscription providers (by default ChatGPT/Codex and Grok). It addresses `dsh-plugin-subscriptions` [issue #7](https://github.com/V1ki/dsh-plugin-subscriptions/issues/7) (`sandbox escalation ... is not strictly wider`). It changes neither DSH source nor the subscriptions plugin itself.

## What it does

Two stripping layers plus a history guard, all at the adapter boundary (wrapping the `stream` of the adapter instance registered through `ctx.llm`):

1. **Outbound (schema layer):** both properties are removed from the tool `parameters` sent to the model, which removes the cue that makes GPT/Codex fill them in by mistake.
2. **Inbound (returned-arguments layer):** after JSON parsing of the tool-call `arguments` the model returns (at block end), both keys are deleted. This is the hard guarantee: even if the model hallucinates them, the call does not fail.
3. **Responses history pairing guard:** before a codex/grok request is sent, orphaned `tool-call`s without a `tool-result` in the same request (and the reverse, orphaned results) are dropped. This specifically covers the settlement notice of an interrupted DSH subagent: core embeds the child session's last assistant content verbatim into a parent-session user message, and its unfinished tool calls must not be replayed as parent `function_call`s.

## Configuration

| Field | Default | Description |
|---|---|---|
| `providers` | `['codex', 'grok']` | Provider routes the shim applies to; `claude` can be added |
| `stripSchema` | `true` | Outbound stripping switch |
| `stripOutput` | `true` | Inbound stripping switch |
| `stripHistory` | `true` | Outbound Responses history role/pairing guard; keep it on even when a restricted deployment needs to turn off the two sandbox-stripping layers |

Example (manifest override):

```yaml
- id: subscriptions-sandbox-shim
  name: dsh-subscriptions-sandbox-shim
  config:
    providers: [codex, grok, claude]
    stripOutput: true
```

## ⚠ Deployment constraint

The semantics of this plugin are **"this deployment never uses the sandbox-escalation channel"**. Enable it only in `danger-full-access` + `approval: never` deployments (or equivalently, where there is no legitimate escalation path).

In restricted deployments (`read-only` / `workspace-write` + `approval: ask`) you must turn off `stripSchema` and `stripOutput` (or disable the whole plugin): there a legitimate escalation retry would be stripped by these two layers, and an operation denied by the sandbox could not recover. `stripHistory` does not touch sandbox permissions and can stay on by itself to prevent a Codex Responses 400.

## Removal

<!-- section: removal -->
This plugin connects two ends: the **model-provider tool surface** of `dsh-plugin-subscriptions` (Codex/Grok adapters that advertise and accept `sandbox_permissions`) and the **DSH core sandbox check** that rejects an escalation that is not strictly wider than the current mode.

It is the deployment-side mitigation for the core defect recorded as [BACKLOG D001](../../BACKLOG.md) (a statically advertised escalation enum at composition time plus a strict-wider check at execution time). Remove it exactly when one of these holds: upstream fixes the defect (the tool schema becomes aware of the session mode, or the rejection text self-corrects), or a DSH upgrade eliminates it; and also before moving to a restricted deployment where escalation retries are legitimate. To remove: delete the manifest entry → sync → restart. Nothing needs migrating.

## Development

```sh
npm test          # node --test test/ (pure-logic unit tests, zero external dependencies)
```

`test/assembler.test.mjs` dynamically imports `~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-llm` to verify integration with the BlockAssembler; that case skips itself automatically when it is not installed.
