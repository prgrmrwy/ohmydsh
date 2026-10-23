# dsh-auto-model-routing

English · [简体中文](README.zh.md)

![AUTO in action: a refactor-and-debug turn is judged complex and runs at high, a follow-up rename is judged simple and drops to low; hovering the AUTO chip shows the decision, clicking it switches to MANUAL](docs/auto-routing.gif)

<!-- problem -->
You should not have to raise or lower reasoning effort by hand for every message. In AUTO, each user turn is judged by the Jev decision model (via OpenRouter) as `simple` / `standard` / `complex` / `escalated`, and the plugin changes **only the reasoning effort** of the model you already picked. Provider and model are never changed. If Jev fails for any reason, AUTO switches itself off and the chip shows why.

**Install.** Managed through `dsh.yaml`: set `enabled: true` on `auto-model-routing` and its companion skill `subagent-model-routing`, then run `dsh build`. See the [plugin index](../../README.md#plugins).

## Use

| Where | What you do |
|---|---|
| **AUTO / MANUAL chip** (left of the model picker) | Click to switch. Hover to see this turn's effort, the latest Jev decision and its distribution. |
| **Decision hint** | Appears above the chip for 3 s after each judgment, e.g. `complex → high · 0.70s`. |
| **Gauge button** on a reply | Hover for the judgment; click to record which tier the turn should have used. |
| **Settings → 自动模型路由** | OpenRouter key, default mode, effort cap, Jev deadline, hint switch and the routing maps (below). |

![Settings → Auto model routing: judging service, session defaults, and the Claude / GPT routing maps with main-chat effort and sub-agent recommendation per tier](docs/settings.gif)

**Default effort.** Each model starts at its officially recommended effort: `standard` keeps it, `simple` goes one step down, `complex` one up, `escalated` two up. The result is capped (default `xhigh`), and AUTO never picks `max`. Each cell of the routing map can override this: main efforts apply to every model of a provider family, and sub-agent cells are full model + effort pairs.

**Sub-agents.** The `route_subagent` tool uses the same judgment and returns provider/model/effort (Claude: Haiku → Sonnet → Opus → Opus; GPT: Luna → Sol → Sol → Sol). It only judges when the root chat is AUTO, and otherwise returns `routed: false`. These routes must be in the official sub-agent allowlist, which is fixed when a chat is created.

## Good to know

- **New chats default to MANUAL.** You can change this in Settings.
- **Fail closed.** No key, out of credits, rate limit, region block, timeout or a bad reply: the chat goes to `MANUAL · Jev 停用` with the reason. Click AUTO to retry. There is no local fallback and no retry.
- **MANUAL only stops changes.** The chat keeps the last effort AUTO set. AUTO also writes it into the official selection, so new chats start from it.
- **Data sent out.** In AUTO, every user turn sends up to 8000 characters of your message and short parts of the previous turn to OpenRouter / TypeSafe (`typesafe/jev-1.13`). The text is redacted by shape first (keys, tokens, URL credentials, IPs). This is best effort and does not guarantee that every secret is removed.
- **The key** is stored through the official DSH credentials service, never in the plugin config. A key in the launch environment (`OPENROUTER_API_KEY`) takes precedence and is read-only. To move it to the GUI, remove it from the launch environment, restart once, then save it in Settings.
- **Files.** Settings live in `$DSH_HOME/plugins/dsh-auto-model-routing/config.json`; per-chat mode and judgments live in `$DSH_HOME/state/auto-model-routing/`. Changes take effect on the next request; no restart is needed.

## Architecture
<!-- section: architecture -->

![auto-model-routing architecture: the chip and RPC endpoints, the agent/pre-step hook asking Jev through OpenRouter, the agent/request hook rewriting only reasoning effort, and the route_subagent tool sharing the same judgment](docs/architecture.dual.svg)

An `agent/pre-step` hook judges step 1 of each user turn. An `agent/request` hook (prepended) then rewrites only `reasoningEffort`, and syncs it to the official model selection. Entry point: [`src/index.ts`](src/index.ts). Rubric: [`src/rubric.json`](src/rubric.json). Effort table: [`src/effort.ts`](src/effort.ts). UI: [`src/client/`](src/client/index.ts). Regression cases: [`eval/`](eval/README.md). Diagram source: [`docs/architecture.json`](docs/architecture.json) (archify).

## Development

```sh
npm --prefix packages/auto-model-routing test
npm --prefix packages/auto-model-routing run typecheck
npm --prefix packages/auto-model-routing run build
```

Tests use the real AgentLoop with a fake LLM stream and a loopback fake Jev; they never call OpenRouter. `node scripts/label-report.mjs` summarizes your tier labels per rubric version.

Specs and design: the current spec is [`openspec/specs/auto-model-routing`](../../openspec/specs/auto-model-routing/spec.md). The archived changes record the design history: [routing](../../openspec/changes/archive/2026-10-22-auto-model-routing/design.md) (decisions D1–D14) and [settings](../../openspec/changes/archive/2026-10-23-auto-model-routing-settings/design.md). The companion skill is [`skills/subagent-model-routing`](../../skills/subagent-model-routing/SKILL.md). Before you change the hooks, read [DSH plugin integration pitfalls](../../docs/architecture/dsh-plugin-integration-pitfalls.md).

## Removal
<!-- section: removal -->

Set `enabled: false` and rebuild. Chats keep the last effort AUTO set; pick another one in the model picker if needed. With the plugin off, the skill tells the agent to delegate with official defaults.
