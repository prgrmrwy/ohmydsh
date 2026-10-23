# dsh-auto-model-routing

English · [简体中文](README.zh.md)

<!-- problem -->
Automatically adjust the main chat's reasoning effort without changing its provider or model. Each user turn in AUTO asks the Jev decision model (via OpenRouter) for a task tier. If Jev fails for any reason, AUTO turns itself off and the chip says why; there is no local fallback. Automatic routing is opt-in: new ordinary chats default to MANUAL unless changed in Settings.

**Install.** In an ohmydsh setup this package is managed through `dsh.yaml` (entry `auto-model-routing`, `source: local`), together with its companion skill entry `subagent-model-routing`: set `enabled: true` on both and run `dsh build`. This README documents no standalone installation. For the surrounding repository see the [plugin index](../../README.md#plugins).

## Architecture
<!-- section: architecture -->

![auto-model-routing architecture: the chip and RPC endpoints, the agent/pre-step hook asking Jev through OpenRouter, the agent/request hook rewriting only reasoning effort, and the route_subagent tool sharing the same judgment](docs/architecture.dual.svg)

The plugin has a Host half and a Web half and adds no process of its own. Everything in the dashed box runs inside the DSH Host.

1. **Judge (step 1 of a user turn).** An `agent/pre-step` listener lets the official chain decide first and only acts when the step actually enters. In AUTO, for a turn that carries user messages, it builds a redacted, truncated state (this message, the previous tier and a slice of the previous turn) and makes one request to Jev through OpenRouter. The result is a tier: `simple`, `standard`, `complex` or `escalated`. Turns without user input (for example sub-agent completion notifications) reuse the last tier and are not sent out.
2. **Rewrite (every request of that turn).** An `agent/request` listener registered with `prepend` runs outside the official model-selection listener: it awaits the official config first, then maps the tier to an effort for the model actually chosen (provider-wide main override, or starting point ± tier offset within supported efforts and the configured cap, never `max`) and changes only `reasoningEffort`. Provider and model are left as they are. If the result differs from the official selection, it calls the official `sessionController.selectModel` without waiting, so the model picker shows the effort that was used.
3. **Fail closed.** Any Jev failure (no key, credits, auth, rate limit, region, timeout, bad response) writes `MANUAL` plus the failure category to the session state file, and that turn is not rewritten. There is no local classifier and no retry; the user clicks AUTO again.
4. **Sub-agents.** The `route_subagent` tool walks from the caller up to its root chat. Only if that chat is AUTO does it send the task text to the same Jev rubric, then resolves the explicit child model + effort override or the built-in default table, rechecking catalog and allowlist. The `subagent-model-routing` skill and the environment-level dispatch rules make the main agent call it before every delegation and pass the three values explicitly.
5. **Web.** The chip in `conversation.input.right` polls the `state` endpoint every 3 seconds and switches mode through `setMode`; the gauge button in `conversation.chat.assistant-actions` reads and writes tier labels through `label`. The Settings page uses `settings`, `saveSettings` and `setKey`; all six are POST endpoints on the authenticated official connection. Settings operations do not select a session model.

| Concern | Source |
|---|---|
| Hooks, endpoints, tool registration | [`src/index.ts`](src/index.ts) |
| Turn bookkeeping and the AUTO/MANUAL rules | [`src/router.ts`](src/router.ts), [`src/state.ts`](src/state.ts) |
| Jev request, failure categories, redaction | [`src/jev.ts`](src/jev.ts), [`src/context.ts`](src/context.ts) |
| Tier rubric (single source) | [`src/rubric.json`](src/rubric.json) |
| Tier → effort, sub-agent model table | [`src/effort.ts`](src/effort.ts) |
| Settings storage, validation and credentials/catalog adapter | [`src/settings.ts`](src/settings.ts), [`src/settings-validation.ts`](src/settings-validation.ts), [`src/settings-host.ts`](src/settings-host.ts) |
| Sub-agent tool | [`src/subagent-tool.ts`](src/subagent-tool.ts) |
| Chip, hint and reply-bar button | [`src/client/`](src/client/index.ts) |

The diagram source is [`docs/architecture.json`](docs/architecture.json) (archify, explicitly unpinned working-tree source notes; not immutable commit evidence); re-render it with archify and export the dual-theme SVG after a structural change.

## Use

Open **Settings → 自动模型路由** (Auto model routing) to configure OpenRouter credentials and routing. The AUTO/MANUAL control sits before the GPT speed control and looks like the model picker. Click it to switch; hover it to see the effort the plugin set this turn and why, plus the latest Jev decision and its distribution. Each AUTO decision is also written to the official model selection, so the model picker shows the effort actually used. Note that the official selection is also saved as the default for new chats, so a new chat starts from the last AUTO effort; to set an effort by hand, switch to MANUAL first.

### Settings and credential migration

The page has three sections—judging service, sessions and routing maps—and six categories:

| Setting | Default / behavior |
|---|---|
| OpenRouter API key | Official DSH credentials service; shows status/source/writability, never the value. Blank input keeps the existing key; a separate delete action removes it. |
| New-chat default mode (`defaultMode`) | `MANUAL`; `AUTO` applies only to freshly created ordinary chats (including ordinary Pet main chats), not resume, clear, compact, sub-agents or existing chats without state. Each new AUTO chat sends user turns to Jev. |
| Automatic effort cap (`effortCap`) | `xhigh`; choose `low`, `medium`, `high` or `xhigh`, for both main and child routes. `max` is never automatic. |
| Jev deadline (`jevTimeoutMs`) | `3000` ms; integer `1000–4500`, read for each judgment, no retry. |
| Decision hints (`decisionToast`) | On; controls the transient hint, not routing or the hover panel. |
| Routing maps (`mainEfforts`, `childRoutes`) | Sparse, per-cell overrides; uncovered cells use the built-in defaults. |

**Claude / GPT tabs.** GPT is the display name; its internal provider id remains `codex` (Claude is `claude`). Each page has four tiers and two columns: main-chat effort and child-chat recommendation. There is no extra main-model selector: the main column applies each tier’s effort to every main model in that provider family. Main overrides are keyed by provider/tier; untouched cells display “默认（随模型）” and keep the actual model’s built-in starting-point algorithm. Child overrides are complete model + effort pairs keyed by provider/tier and do not inherit main overrides. Switching tabs keeps unsaved drafts. The tier info tooltip uses the English criteria verbatim from [`src/rubric.json`](src/rubric.json).

Main models come from the official available catalog, independent of the child allowlist. Child choices are the intersection of this tab's provider, the current catalog and the enabled official sub-agent allowlist; effort choices are the model's actual supported automatic values under the cap. If a changed model cannot keep the old effort, choose an effort explicitly before saving. A removed route stays visible as unavailable, not as a selectable option. An unavailable/disabled/empty allowlist disables child pickers without broadening access; other verifiable settings can still be saved. The official allowlist is also snapshotted when a chat is created, so an older chat may still reject a newly configured route. The plugin never bypasses that rejection or silently substitutes another model.

Main effort choices are the intersection supported by all currently cataloged models of that family, bounded by the cap; the child allowlist does not restrict main models. The compact provider, mode and cap tabs use the same 28px height and 12px type.

**Conflicts and defaults.** Explicit mappings are exact: unsupported or over-cap values are rejected, not clamped. Lowering the cap requires fixing or restoring every conflicting explicit cell in the same save, including other tabs. “恢复默认” removes only that cell's override; it does not copy the default table into configuration. Built-in algorithm results do respect the cap: a main model with no valid effort passes through (`no-effort-support`), while a child recommendation with none fails and pauses delegation. Catalog changes or hand-edited invalid explicit maps cause a settings error at use time: the main AUTO request is blocked; the child tool asks to pause delegation. These are not Jev failures, do not set `disabled`, and never fall back to another mapping.

Non-secret settings live in `$DSH_HOME/plugins/dsh-auto-model-routing/config.json` (directory 0700, file 0600, atomic replacement). Ordinary invalid scalar fields default independently; an unreadable/unparseable file displays defaults and a diagnostic, and saving replaces its damaged contents. Invalid explicit routes remain diagnosable rather than silently disappearing. Settings take effect on the next request/tool call without build or restart; a same-turn tier is reused while its mapping is re-read. Rule text, redaction/outbound limits, endpoint/model id and starting-point constants are not editable here.

**Move an existing launch-environment key to GUI management, in this order:**

1. Keep the existing key privately on your machine; do not paste it into chat or repository files.
2. Remove `OPENROUTER_API_KEY` from its launch source (in this setup the main checkout's `.env.local`, loaded by `bin/dsh`).
3. Restart DSH once so that the launch snapshot no longer contains it. **Do not try to save in the GUI before removing the variable and restarting**: a launch-environment credential is read-only and takes precedence.
4. Save the key in Settings. Later replacements/deletion are resolved on the next judgment without another restart. During an unconfigured migration gap AUTO can stop with `missing-credential`; saving a key does not clear that state—click AUTO to retry.

The official resolver order is launch environment → credential store → project `.env` → `$DSH_HOME/.env`; without the credentials service, launch-environment reading remains available but GUI key management is disabled. The local official store is normally `~/.dsh/.credentials.yaml` (0600); the plugin never writes a key to its config, responses or logs. File permissions do not isolate the key from Agent tools running as the same user. No save-time key validation request or balance query is made.

The bottom Save button coordinates **independent** key/config commits, not a cross-store transaction: if one succeeds and the other fails, the page reports each result, clears a successfully saved key draft, and retains unsaved settings for repair. To roll back to 0.1.0, restore the key to the launch environment and restart: that version cannot read the credential store and ignores new config fields other than `decisionToast`.

**Data sent out.** In AUTO, every user turn sends up to 8000 characters of your message, plus parts of the previous turn (the first 500 characters of the previous user message and the last 1200 of the previous assistant reply), to OpenRouter and TypeSafe (model `typesafe/jev-1.13`). `route_subagent` sends its task text only while the main chat is in AUTO. Text is redacted by shape before it leaves (keys, Bearer tokens, `token=`-style assignments, credentials in URLs, IP addresses); this is best effort and does not guarantee that every secret is removed. OpenRouter's retention and logging terms for this model are not confirmed; set them in your OpenRouter account.

**Tier rubric.** Tiers measure only how much reasoning and checking the task needs, not risk, size or message length. The single source is `src/rubric.json`; regression cases and the runner are in [`eval/`](eval/README.md). **Effort** starts from each model's officially recommended starting point: standard uses it, simple goes one step down, complex one up, escalated two up, capped at xhigh; automatic routing never picks max (Opus/Sonnet/Haiku/Sol start at medium, Fable/Luna at high, Astra at low).

**When Jev fails** (no key, out of credits, bad key, rate limit, region block, timeout, bad response), the chat switches to MANUAL and the chip shows `MANUAL · Jev 停用` with the reason. Click AUTO to try again. Cancelling a turn does not count as a failure. There is no polling and no balance query.

**Decision hint (on by default).** After each Jev decision a three-second hint appears above the chip: who judged, tier → (model) effort and duration, then the distribution without 0% tiers, for example `主会话判断 · complex → high · 0.78s` / `complex 61% / escalated 39%`. It appears within about 3 seconds. Turn it off with the decision-hint switch in Settings; no restart needed.

The `route_subagent` tool uses the same Jev judgment for sub-agents and returns provider/model/reasoning_effort: Claude goes Haiku, Sonnet, Opus, Opus and Codex goes Luna, Sol, Sol, Sol by tier, whatever model the main chat uses; The default table excludes Fable and Astra; they are available only through an explicit valid child override. It follows the mode of the main chat it belongs to (from a sub-agent, it walks up to the root chat): in MANUAL it neither judges nor sends anything and returns `routed: false`, and the agent delegates with official defaults. The `subagent-model-routing` skill tells the agent to pass the values explicitly, and to stop and ask you when the tool fails. These five routes (haiku/sonnet/opus/luna/sol) must be in the Settings allowlist "Sub-agents → models the agent may choose"; the allowlist is fixed when a chat is created, so changes apply to new chats only.

**Judgements and labels.** Each main-chat judgement appends one line to `$DSH_HOME/state/auto-model-routing/judgements.jsonl` (chat id, turn, tier, effort, model, rubric version; no message text). On judged turns the reply action bar shows a gauge button: hover for the judgement, click to say which tier the turn should have used. `node scripts/label-report.mjs` summarizes agreement, judged-higher and judged-lower per rubric version. After a Host restart, buttons for earlier turns no longer appear (the log is unaffected).

The last tier is kept per chat (the tier name only), including across Host restarts. A user follow-up such as "continue" is judged with that previous tier and bounded previous-turn context; a turn with no user input reuses the tier without another judgment.

**MANUAL only stops automatic changes.** It does not restore an earlier effort: the chat keeps the last effort AUTO used until you pick another one in the model picker. The same holds after a Jev failure. Mode and the last Jev failure are stored under `$DSH_HOME/state/auto-model-routing/sessions/`. It never changes the model. Network restrictions and official model allowlists stay in charge. Provider cache hits are not guaranteed.

## Development

Install dependencies from the workspace root, then run:

```sh
npm --prefix packages/auto-model-routing test
npm --prefix packages/auto-model-routing run typecheck
npm --prefix packages/auto-model-routing run build
```

Tests use the real AgentLoop, a fake LLM stream and a loopback fake Jev server. They never call OpenRouter. Offline checks do not replace acceptance in the existing GUI.

## Specs and design in the main repository

This package is part of the [ohmydsh](../../README.md) customization repository, which keeps the behavior written down before it is built:

- **Current spec (settings synchronized):** [`openspec/specs/auto-model-routing`](../../openspec/specs/auto-model-routing/spec.md), the acceptance scenarios this package must satisfy.
- **Settings design and accepted verification gaps:** archived change [`auto-model-routing-settings`](../../openspec/changes/archive/2026-10-23-auto-model-routing-settings/proposal.md), its [design](../../openspec/changes/archive/2026-10-23-auto-model-routing-settings/design.md) and [delta spec](../../openspec/changes/archive/2026-10-23-auto-model-routing-settings/specs/auto-model-routing/spec.md). The root spec is synchronized; the user accepted the compact family-wide GUI and authorized archiving with documented evidence gaps.
- **Design and history:** the archived change [`2026-10-22-auto-model-routing`](../../openspec/changes/archive/2026-10-22-auto-model-routing/design.md) (decisions D1–D14: why only effort changes, why there is no local fallback, the starting-point table, labels), with its [Jev/OpenRouter spike](../../openspec/changes/archive/2026-10-22-auto-model-routing/spike-jev-openrouter.md) and [GUI verification](../../openspec/changes/archive/2026-10-22-auto-model-routing/verify.md).
- **Manifest entry and trust notes:** `auto-model-routing` and `subagent-model-routing` in [`dsh.yaml`](../../dsh.yaml) record what leaves the machine, where the credential lives and how to disable it.
- **Companion skill:** [`skills/subagent-model-routing`](../../skills/subagent-model-routing/SKILL.md); the "sub-agent dispatch" rules that require `route_subagent` before every delegation live in the environment-level instructions [`instructions/dsh-home.md`](../../instructions/dsh-home.md) (see [environment-level agent instructions](../../docs/architecture/agent-instructions.md)).
- **Host integration pitfalls:** read [DSH plugin integration pitfalls](../../docs/architecture/dsh-plugin-integration-pitfalls.md) before changing how the hooks read user messages or session events.

## Removal
<!-- section: removal -->

Disable the entry and rebuild. The chat keeps the last effort AUTO used; pick another one in the official model picker if needed. The skill has its own manifest switch; with the plugin off it tells the agent to delegate with official defaults.

Legacy per-model main maps are diagnosed and blocked rather than silently applied or discarded. Unrelated saves preserve them; explicitly reset that family or replace it with provider/tier values. Historical acceptance Loop 2 exercised the earlier per-model design and does not establish this family-wide revision.
