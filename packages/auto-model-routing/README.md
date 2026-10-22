# dsh-auto-model-routing

[中文](README.zh.md)

<!-- problem -->
Automatically adjust the main chat's reasoning effort without changing its provider or model. Each user turn in AUTO asks the Jev decision model (via OpenRouter) for a task tier. If Jev fails for any reason, AUTO turns itself off and the chip says why; there is no local fallback. Disabled by default; each chat starts in MANUAL.

## Use

Put `OPENROUTER_API_KEY=sk-or-...` in the main checkout's `.env.local`; `bin/dsh` loads it at launch. The AUTO/MANUAL control sits before the GPT speed control and looks like the model picker. Click it to switch; hover it to see the effort the plugin set this turn and why, plus the latest Jev decision and its distribution. Each AUTO decision is also written to the official model selection, so the model picker shows the effort actually used. Note that the official selection is also saved as the default for new chats, so a new chat starts from the last AUTO effort; to set an effort by hand, switch to MANUAL first.

**Data sent out.** In AUTO, every user turn sends up to 8000 characters of your message, plus parts of the previous turn (the first 500 characters of the previous user message and the last 1200 of the previous assistant reply), to OpenRouter and TypeSafe (model `typesafe/jev-1.13`). `route_subagent` sends its task text only while the main chat is in AUTO. Text is redacted by shape before it leaves (keys, Bearer tokens, `token=`-style assignments, credentials in URLs, IP addresses); this is best effort and does not guarantee that every secret is removed. OpenRouter's retention and logging terms for this model are not confirmed; set them in your OpenRouter account.

**Tier rubric.** Tiers measure only how much reasoning and checking the task needs, not risk, size or message length. The single source is `src/rubric.json`; regression cases and the runner are in [`eval/`](eval/README.md). **Effort** starts from each model's officially recommended starting point: standard uses it, simple goes one step down, complex one up, escalated two up, capped at xhigh; automatic routing never picks max (Opus/Sonnet/Haiku/Sol start at medium, Fable/Luna at high, Astra at low).

**When Jev fails** (no key, out of credits, bad key, rate limit, region block, timeout, bad response), the chat switches to MANUAL and the chip shows `MANUAL · Jev 停用` with the reason. Click AUTO to try again. Cancelling a turn does not count as a failure. There is no polling and no balance query.

**Decision hint (on by default).** After each Jev decision a three-second hint appears above the chip: who judged, tier → (model) effort and duration, then the distribution without 0% tiers, for example `主会话判断 · complex → high · 0.78s` / `complex 61% / escalated 39%`. It appears within about 3 seconds. To turn it off, put `{"decisionToast": false}` in `$DSH_HOME/plugins/dsh-auto-model-routing/config.json`; no restart needed.

The `route_subagent` tool uses the same Jev judgment for sub-agents and returns provider/model/reasoning_effort: Claude goes Haiku, Sonnet, Opus, Opus and Codex goes Luna, Sol, Sol, Sol by tier, whatever model the main chat uses; Fable and Astra are never picked automatically. It follows the mode of the main chat it belongs to (from a sub-agent, it walks up to the root chat): in MANUAL it neither judges nor sends anything and returns `routed: false`, and the agent delegates with official defaults. The `subagent-model-routing` skill tells the agent to pass the values explicitly, and to stop and ask you when the tool fails. These five routes (haiku/sonnet/opus/luna/sol) must be in the Settings allowlist "Sub-agents → models the agent may choose"; the allowlist is fixed when a chat is created, so changes apply to new chats only.

**Judgements and labels.** Each main-chat judgement appends one line to `$DSH_HOME/state/auto-model-routing/judgements.jsonl` (chat id, turn, tier, effort, model, rubric version; no message text). On judged turns the reply action bar shows a gauge button: hover for the judgement, click to say which tier the turn should have used. `node scripts/label-report.mjs` summarizes agreement, judged-higher and judged-lower per rubric version. After a Host restart, buttons for earlier turns no longer appear (the log is unaffected).

The last tier is kept per chat (the tier name only), so a follow-up such as "continue" keeps that tier even after a Host restart.

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
