# dsh-auto-model-routing

English · [简体中文](README.zh.md)

![AUTO interaction: toggle AUTO/MANUAL and inspect the decision](docs/auto-routing.gif)

*Interaction recording from the earlier four-tier UI (isolated mock Host); current decisions use independent capability and depth as described below.*

[Repository](https://github.com/prgrmrwy/dsh-auto-model-routing) · [Releases](https://github.com/prgrmrwy/dsh-auto-model-routing/releases) · [npm](https://www.npmjs.com/package/dsh-auto-model-routing)

<!-- problem -->
Keep the main model you chose; let AUTO select reasoning investment for each turn and suitable resources for fresh sub-agents. Jev judges **capability and effort independently**. DSH applies the route, and the UI distinguishes a decision from a configuration that actually reached a request.

**Install.** Tested with DSH `0.2.0-rc.2`, Web UI, Node.js `>=22.19`.

```sh
dsh plugin --profile web add dsh-auto-model-routing
# Or install source (approve the local build when prompted):
dsh plugin --profile web add prgrmrwy/dsh-auto-model-routing
```

Restart DSH and refresh the Web page. In **Settings → Auto model routing**, choose a decision service, save its API key, and use **Test connection** with a fixed public sample. These are English descriptions of the controls; the plugin's interface labels are currently in Chinese. New chats default to **MANUAL**; click the chip to use AUTO. The companion delegation skill is included—no separate skill installation is needed.

## Use

| Where | What you do |
|---|---|
| **AUTO / MANUAL chip**, left of the model picker | Click to switch. Hover for the decision, candidate distribution, certainty, model/effort and application status. |
| **Decision hint** | Shows new decisions briefly; its Settings switch does not hide the hover panel. |
| **Gauge button** below an eligible reply | Mark the allocation appropriate, too high, too low or unknown; change or clear your feedback later. Only replies bound to an applied main decision qualify. |
| **Settings → Auto model routing** | Choose service/model, manage its separate key, test the connection, set defaults/cap/deadline, or expand **View decision strategy** to inspect the actual rubric and model slots. |

### Main model stays fixed; children are selected separately

- **Main chat:** `lower / baseline / higher` moves at most one supported effort step below/at/above the model's verified recommended starting point. The cap defaults to `xhigh`; AUTO never selects `max`. It does not change the main provider/model or write global model defaults.
- **Fresh children:** capability is `bounded / analytical / frontier`; effort is judged separately. Claude slots are Haiku / Sonnet / Opus 5.5; GPT slots are Luna / Sol / Sol. The current catalog, supported efforts and official child allowlist must all permit the route. Magpie uses its exact provider and full family-prefixed model IDs, not a fallback to local transports.
- **Explicit choices win:** specifying a model or effort leaves only the other dimension to judge. Specifying both skips Jev and validates the route. Missing task scope stops delegation rather than guessing.
- **Official creation binds the route:** fresh `subagent` and fresh `spawn_teammate` paths bind an exact child identity before its first request. `route_subagent` is an optional preview—not proof of application and not a user constraint to copy into a subsequent call. Fork and unbound creation paths are unsupported; there is no silent substitution.
- **Resume keeps the initial route.** Switching the root to MANUAL stops new judgments; already bound children retain their initial route. `applied` means the actual request configuration matched, **not** that the task succeeded. Real Magpie Claude/GPT ordinary calls were tested; fresh teammate routing and cold resume have mock-host coverage, not real-provider teammate acceptance.

### Choose the decision service

| Service | Endpoint | Default model | Credential reference |
|---|---|---|---|
| OpenRouter (default, preserves existing installations) | `https://openrouter.ai/api/alpha/decisions` | `typesafe/jev-1.13` | `OPENROUTER_API_KEY` |
| TypeSafe | `https://api.typesafe.ai/v1/systemone` | `jev-1.13.0` | `TYPESAFE_API_KEY` |
| Concentrate | `https://api.concentrate.ai/v1/systemone` | `jev-1.13.0` | `CONCENTRATE_API_KEY` |
| Custom System One | Your full endpoint | Editable | `AUTO_DECISION_CUSTOM_API_KEY` |

Preset model menus expose documented versions, not live availability guarantees. Custom services keep an editable model ID and must support `state + questions → answers`; an OpenAI chat-completions endpoint alone is not compatible. Custom endpoints require HTTPS (loopback HTTP is allowed), reject URL credentials/query/fragment and redirects. Only configure endpoints you trust with the dedicated key. TypeSafe and Concentrate have contract/mock coverage; their live authentication and regional availability were not verified here. No service failover occurs automatically.

**Certainty is not the selected probability.** Choice certainty is `(pmax − 1/n) / (1 − 1/n)`: with three candidates, a 70% top probability gives 55% certainty. The panel shows the service's returned certainty and full candidate distribution separately, including returned zeroes; missing values are marked unavailable. Neither number is task success rate.

## Good to know

- **Failures are visible.** Main judgment failure disables AUTO with a reason; child judgment/route failure stops dispatch. No local classifier, automatic retry, upgrade or cross-service fallback.
- **MANUAL stops adjustments, not history.** It does not restore an earlier effort. The official current selection remains in control; existing bound children keep their route while the plugin is enabled.
- **Data leaves the machine.** AUTO sends shape-redacted task text (up to 8000 characters) and short previous-turn excerpts to your chosen service. Redaction is best effort, not a guarantee that all secrets are removed. Test Connection sends only a fixed public sample and can incur a small charge.
- **Keys use official DSH credentials**, never plugin configuration. Launch-environment keys take precedence and are read-only. Service changes clear key drafts; save the service before managing its separate key. Changing a custom endpoint does not create a new credential namespace—review the key before trusting a new host.
- **Local state:** configuration is under `$DSH_HOME/plugins/dsh-auto-model-routing/`; mode, child routes and feedback are under `$DSH_HOME/state/auto-model-routing/`. Feedback stores resource metadata, IDs, versions, returned distributions and timestamps—not task/reply text. Request event IDs allow later usage correlation; costs are not fabricated when unavailable. See [feedback and evaluation](docs/feedback-evaluation.md).
- **No automatic learning.** Human allocation feedback is observational. It does not change routing or prove quality/cost benefits. Old messages without decision bindings are not backfilled; old records with missing evaluation fields remain unknown.
- **Upgrade:** existing AUTO sessions use the new policy without a version switch or rewriting their stored mode. New chats still default to MANUAL unless configured otherwise. Historical four-tier mappings remain only for explicit `policy: "legacy"` rollback in plugin configuration; they are not the current policy or feedback menu.

## Architecture
<!-- section: architecture -->

![AUTO architecture — independent judgments, validated requests and allocation feedback](docs/architecture-v2.en.svg)

Main failures disable AUTO; child failures stop dispatch. Explicit model/effort constraints are preserved. The diagram shows the AUTO paths; MANUAL makes no new judgments and fork is unsupported. Feedback does not automatically alter routing.

Entry: [index.ts](src/index.ts). Enforcement: [policy-host.ts](src/policy-host.ts). Actual rubric: [policy-v2-rubric.json](src/policy-v2-rubric.json). Model slots: [policy-v2.ts](src/policy-v2.ts). UI: [client](src/client/index.ts). Coverage and limitations: [development verification](docs/policy-v2-development.md), [real Magpie acceptance](docs/magpie-live-acceptance.md).

<details>
<summary>Earlier four-tier UI demos (legacy rollback only)</summary>

These isolated-host recordings use mock Jev/model responses and show the previous UI, not the current default policy.

![Legacy four-tier routing settings](docs/settings.gif)

</details>

## Development

```sh
npm test
npm run typecheck
npm run build
```

Tests use the official AgentLoop with fake LLM streams and mock/loopback Jev responses, not paid model calls. `scripts/label-report.mjs` reports **legacy tier labels only**; it is not a report for new allocation feedback. Evaluation schema and deduplication rules are in [feedback-evaluation.md](docs/feedback-evaluation.md).

The [current specification](https://github.com/prgrmrwy/ohmydsh/blob/main/openspec/specs/auto-model-routing/spec.md) lives in the source monorepo. The bundled [delegation skill](skills/subagent-model-routing/SKILL.md) supplies guidance; enforcement belongs to the official host hooks, not the prompt. No measured task-quality or token-savings claim is made.

## Removal
<!-- section: removal -->

```sh
dsh plugin --profile web remove dsh-auto-model-routing
```

Restart DSH and refresh the page. The plugin's skill/tools and request hooks disappear; settings and logs remain. Without the plugin, child replay is no longer enforced and host restoration uses the original creation configuration. In [ohmydsh](https://github.com/prgrmrwy/ohmydsh), disable the local entry and rebuild instead.
