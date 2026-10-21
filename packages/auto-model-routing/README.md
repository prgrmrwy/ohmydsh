# dsh-auto-model-routing

[中文](README.zh.md)

<!-- problem -->
Automatically adjust the main chat's reasoning effort without changing its provider or model. Each user turn in AUTO asks the Jev decision model (via OpenRouter) for a task tier. If Jev fails for any reason, AUTO turns itself off and the chip says why; there is no local fallback. Disabled by default; each chat starts in MANUAL.

## Use

Put `OPENROUTER_API_KEY=sk-or-...` in the main checkout's `.env.local`; `bin/dsh` loads it at launch. The AUTO/MANUAL control sits before the GPT speed control and looks like the model picker. Click it to switch; hover it to see this turn's effort, the reason and the last 20 in-memory decisions (no task text; cleared on restart). The effort AUTO picks shows up in the official model picker once a request is sent.

**Data sent out.** In AUTO, every user turn sends up to 8000 characters of your message to OpenRouter and TypeSafe (model `typesafe/jev-1.13`). Each `route_subagent` call sends its task text the same way, whatever the main chat mode. OpenRouter's retention and logging terms for this model are not confirmed; set them in your OpenRouter account.

**When Jev fails** (no key, out of credits, bad key, rate limit, region block, timeout, bad response), the chat switches to MANUAL and the chip shows `MANUAL · Jev 停用` with the reason. Click AUTO to try again. Cancelling a turn does not count as a failure. There is no polling and no balance query.

The `route_subagent` tool uses the same Jev judgment for sub-agents and returns provider/model/reasoning_effort. The `subagent-model-routing` skill tells the agent to pass them explicitly, and to stop and ask you when the tool fails.

**MANUAL only stops automatic changes.** It does not restore an earlier effort: the chat keeps the last effort AUTO used until you pick another one in the model picker. The same holds after a Jev failure. Mode and the last Jev failure are stored under `$DSH_HOME/state/auto-model-routing/sessions/`. It never changes the model. Network restrictions and official model allowlists stay in charge. Provider cache hits are not guaranteed.

## Development

Install dependencies from the workspace root, then run:

```sh
npm --prefix packages/auto-model-routing test
npm --prefix packages/auto-model-routing run typecheck
npm --prefix packages/auto-model-routing run build
```

Tests use the real AgentLoop, a fake LLM stream and a loopback fake Jev server. They never call OpenRouter. Offline checks do not replace acceptance in the existing GUI.

## Removal
<!-- section: removal -->

Disable the entry and rebuild. The chat keeps the last effort AUTO used; pick another one in the official model picker if needed. The skill has its own manifest switch; with the plugin off it tells the agent to delegate with official defaults.
