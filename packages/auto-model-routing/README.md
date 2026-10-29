# dsh-auto-model-routing

English · [简体中文](README.zh.md)

<p align="center">
  <img src="docs/auto-routing.gif" alt="AUTO: switch modes, apply effort and inspect the decision distribution" width="49%">
  <img src="docs/settings.gif" alt="Settings: decision service, connection test, defaults and strategy details" width="49%">
</p>

*Left: AUTO interaction and applied decision. Right: current settings and strategy details. Recorded from an isolated DSH host with local mock Jev/model responses and synthetic tasks.*

![AUTO architecture — independent judgments, validated requests and allocation feedback](docs/architecture-v2.en.svg)

<!-- problem -->
**Add AUTO mode to DSH: automatic effort for the main agent, automatic model + effort for sub-agents.** Stop adjusting reasoning investment every turn or choosing a model for every delegated task.

- **Main agent: keep your selected model and adjust reasoning effort per user turn.**
- **Sub-agents: judge capability needs and reasoning investment independently, then select model + effort.** A stronger model does not automatically mean deeper reasoning.
- **Visible decisions, local feedback:** inspect candidate distributions and actual application status, then rate the allocation below a reply.

### Which DSH scenarios does AUTO cover?

| Scenario | AUTO behavior | Current boundary |
|---|---|---|
| Main-agent user turn | Judge effort for each new user turn; keep the main model | Not rejudged at every tool step; model must support the effort |
| Official fresh `subagent` | Select and bind child model + effort before its first request | Real Magpie Claude/GPT ordinary child calls verified; catalog and allowlist apply |
| Official fresh `spawn_teammate` | Bind the new teammate's model + effort using the same policy | Mock-host coverage; real-provider teammate acceptance remains unverified |
| Resume or continue a bound child | Replay its initial allocation without rejudging | Requires the plugin enabled and intact route records |
| Explicit model / effort | Preserve the specified dimension; judge only the other | Both specified: validate without calling Jev |
| Fork, third-party or unbound creation paths | No automatic-allocation guarantee | Fork and unbound AUTO child paths are explicitly rejected, not silently replaced |

This describes official integration paths—not acceptance of every DSH entry point, CLI/TUI interface or third-party plugin. The Web UI is the currently verified interface. MANUAL makes no new judgments. `route_subagent` is a preview, not a required step before dispatch.

### Local feedback → future learning and adjustment

**Available now:** rate a decision-bound reply as appropriate, too high, too low or unknown; change or clear the rating. Feedback and decision snapshots stay on your machine. Submitting feedback does not upload it to the decision service or immediately change routing; AUTO task judgments themselves still use your selected external service.

**Planned direction:** add learning, evaluation and policy adjustment based on local feedback and execution outcomes, so AUTO can better fit your tasks. **Automatic learning and feedback-driven tuning are not implemented yet.** Today's records support later evaluation; they are not evidence of measured quality gains or cost savings.

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

- **Main chat:** `lower / baseline / higher` moves at most one supported effort step below/at/above the model's verified recommended starting point. The cap defaults to `xhigh`; AUTO never selects `max`. It keeps the main provider/model and synchronizes the selected effort through official `selectModel`, which also saves global defaults.
- **Claude/GPT families only:** AUTO manages models whose id (after any transport prefix) starts with `claude-` or `gpt-`. Selecting any other main model — DeepSeek, GLM, Grok, Gemini, Kimi, Qwen, … — switches the session to MANUAL and locks the chip: it shows an outlined info icon, and hovering the whole button explains the support scope with an issue/PR link to the repository. Switching back to a Claude/GPT model restores a clickable MANUAL chip; AUTO is never re-enabled automatically.
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

### Magpie transports and picker display

AUTO accepts both exact transports, `dsh-magpie-connector` and `dsh-magpie-connect`. They are not aliases: full model ids, live model capabilities, supported effort/caps, the current allowlist and the parent's captured allowlist all retain their exact transport identity. Families without a registered strategy need an explicit model and a verifiable effort. With a MANUAL root session the preview returns `routed: false` without judging or state writes. Already bound children replay their saved route.

AUTO applies the selected effort to the current main request and awaits official `selectModel` on the same provider/model when the effort changes. This also updates global defaults; the official picker shows one effort value. MANUAL requests pass through unchanged and bound children never write the main selection. A selection-sync failure is logged while the current request retains its selected effort. Magpie menu grouping still requires ohmydsh's managed five-package Host extension; stock rc.2 keeps a flat list. See [Magpie setup and display requirements](<../dsh-magpie-connector/README.md#model-menu-groups-and-effort>); local tests do not establish deployment or live GUI acceptance.

## Good to know

- **Failures are visible.** Main judgment failure disables AUTO with a reason; child judgment/route failure stops dispatch. No local classifier, automatic retry, upgrade or cross-service fallback.
- **MANUAL stops adjustments, not history.** It does not restore an earlier effort. The official current selection remains in control; existing bound children keep their route while the plugin is enabled.
- **Data leaves the machine.** AUTO sends shape-redacted task text (up to 8000 characters) and short previous-turn excerpts to your chosen service. Redaction is best effort, not a guarantee that all secrets are removed. Test Connection sends only a fixed public sample and can incur a small charge.
- **Keys use official DSH credentials**, never plugin configuration. Launch-environment keys take precedence and are read-only. Service changes clear key drafts; save the service before managing its separate key. Changing a custom endpoint does not create a new credential namespace—review the key before trusting a new host.
- **Local state:** configuration is under `$DSH_HOME/plugins/dsh-auto-model-routing/`; mode, child routes and feedback are under `$DSH_HOME/state/auto-model-routing/`. Feedback stores resource metadata, IDs, the strategy family, returned distributions and timestamps—not task/reply text. Request event IDs allow later usage correlation; costs are not fabricated when unavailable. See [feedback and evaluation](docs/feedback-evaluation.md).
- **No automatic learning.** Human allocation feedback is observational. It does not change routing or prove quality/cost benefits. Old messages without decision bindings are not backfilled; old records with missing evaluation fields remain unknown.
- **Upgrade to 0.5.0:** there is one AUTO strategy and no version setting. Existing sessions keep their stored mode; new chats still default to MANUAL unless configured otherwise. Retired `policy` / `mainEfforts` / `childRoutes` keys in the plugin configuration are ignored, shown as no longer effective in Settings, and removed on the next save. Child decisions and feedback recorded by 0.4.x stay readable. To go back, pin the published `dsh-auto-model-routing@0.4.2` (see [CHANGELOG](CHANGELOG.md) for the data boundary).

## Architecture
<!-- section: architecture -->

The diagram at the top shows the AUTO paths. Main failures disable AUTO; child failures stop dispatch. Explicit model/effort constraints are preserved. MANUAL makes no new judgments and fork is unsupported. Feedback does not automatically alter routing.

Entry: [index.ts](src/index.ts). Enforcement: [policy-host.ts](src/policy-host.ts). Actual rubric: [rubric.json](src/rubric.json). Family strategies (supported models, transports, effort starting points, capability slots): [strategies](src/strategies/index.ts); routing: [routing.ts](src/routing.ts). UI: [client](src/client/index.ts). Coverage and limitations (historical records): [development verification](docs/policy-v2-development.md), [real Magpie acceptance](docs/magpie-live-acceptance.md).

## Development

```sh
npm test
npm run typecheck
npm run build
```

Tests use the official AgentLoop with fake LLM streams and mock/loopback Jev responses, not paid model calls. To observe AUTO decisions and their actual token usage, ask the agent to use the `auto-model-routing-report` skill (on demand only; it runs the read-only `lib/usage-report.js`). It is observational, not a savings measurement. Evaluation schema and deduplication rules are in [feedback-evaluation.md](docs/feedback-evaluation.md).

The package builds and loads independently using its declared dependencies, bundled skill and official DSH services; no monorepo checkout or monorepo instruction file is required. External design references are optional background, not runtime inputs. The bundled [delegation skill](skills/subagent-model-routing/SKILL.md) supplies guidance; enforcement belongs to the official host hooks, not the prompt. No measured task-quality or token-savings claim is made.

## Removal
<!-- section: removal -->

```sh
dsh plugin --profile web remove dsh-auto-model-routing
```

Restart DSH and refresh the page. The plugin's skill/tools and request hooks disappear; settings and logs remain. Without the plugin, child replay is no longer enforced and host restoration uses the original creation configuration. In [ohmydsh](https://github.com/prgrmrwy/ohmydsh), disable the local entry and rebuild instead.

## Source, license and contributing

This plugin is developed in [ohmydsh](https://github.com/prgrmrwy/ohmydsh) (`packages/auto-model-routing`); [this repository](https://github.com/prgrmrwy/dsh-auto-model-routing) is its release mirror, published automatically to [npm](https://www.npmjs.com/package/dsh-auto-model-routing) and [GitHub Releases](https://github.com/prgrmrwy/dsh-auto-model-routing/releases). The [current specification](https://github.com/prgrmrwy/ohmydsh/blob/main/openspec/specs/auto-model-routing/spec.md) lives there too.

[MIT](LICENSE). Issues and pull requests are welcome at [prgrmrwy/dsh-auto-model-routing](https://github.com/prgrmrwy/dsh-auto-model-routing/issues) — including support for model families beyond Claude and GPT.
