# dsh-magpie

English · [简体中文](README.zh.md)

A DeepSeek Harness plugin for a self-hosted Magpie gateway. One `dsh-magpie` provider route serves the models discovered at your gateway. Settings group models and read-only usage cards by upstream provider.

<!-- problem -->
Magpie manages upstream accounts, login, routing and provider-side proxies. This plugin adds DSH-side model visibility, default reasoning effort, cached usage cards with manual refresh, and a per-session standard/fast switch for models advertising the `priority` service tier. The API key uses DSH credentials rather than a separate plaintext plugin file.

## Requirements

- DeepSeek Harness `0.2.0-rc.2`.
- A reachable Magpie gateway and an enabled gateway key.
- For remote access, Magpie must allow the client network: enable LAN sharing or bind `MAGPIE_ADDR` to a non-loopback address. Binding only to loopback is not remote access.
- For usage cards, an unrestricted key works directly. A restricted held key needs Quotas permission and sees only cards in its permitted scope.

## Installation and configuration

In ohmydsh, enable the local `dsh-magpie` entry in the manifest, build, then restart DSH when ready. This package has not yet been published to npm; do not assume an `npm install dsh-magpie` release exists.

Open **Settings → Magpie**. Enter the gateway API URL including `/v1`, for example `http://192.168.1.20:3425/v1`, and the gateway key. Never put the key in a URL or the manifest. Saving connection details synchronizes the model catalog. Use **刷新模型列表** to synchronize again; there is no catalog polling.

The key is stored through DSH's credentials service as `MAGPIE_API_KEY`. If supplied by the launch environment, it is read-only in settings. Changing an environment variable outside the running process requires a restart. Address and preferences are stored separately at `$DSH_HOME/plugins/dsh-magpie/settings.json` (default `$HOME/.dsh/plugins/dsh-magpie/settings.json`); the key is not included in that file or returned by the settings API.

### Models and reasoning

- With no visibility selection for a provider, discovery controls the list and new models appear automatically.
- An explicit selection is a strict allowlist. An empty selection hides all models; new models stay hidden.
- Default effort is a DSH preference. A saved effort that disappears from discovery is retained but does not apply until the gateway offers it again.
- Responses-capable models use Responses; others use Chat Completions. Both use pi-ai for the wire protocol.
- Nonempty `stop` sequences fail before network access with `MAGPIE_STOP_UNSUPPORTED`: Magpie cannot preserve them across all upstream translations.
- Failures are retried by DSH's built-in `llm-retry` with the same policy as dsh-plugin-subscriptions: up to 10 retries, exponential backoff from 1s capped at 60s, ±20% jitter, honouring `Retry-After` on 429. The plugin never replays a request itself; it classifies failures into canonical codes. `TIMEOUT`, `TRANSPORT` (dropped connection), `SERVER` (5xx), `RATE_LIMIT` (429) and `EMPTY_RESPONSE` are retried; 401/403, exhausted quota, context overflow and other 4xx are not.
- The stream watchdog only asks whether the gateway is still sending data: headers, SSE events and heartbeats all count. Only 300 seconds of total silence ends the request with `TIMEOUT` (message contains `MAGPIE_STREAM_TIMEOUT`), so long reasoning survives as long as the gateway keeps the stream alive.
- Fast mode is per session and in memory. Restarting the host restores standard mode. Priority service can consume more upstream quota.

### Model menu groups and effort

In ohmydsh, these menu features require the Pet managed Host extension at the reviewed DSH `0.2.0-rc.2` pin. It rebuilds five packages together: `@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-api-session-controller`, `@deepseek-ai/dsh-api-remotes`, `@deepseek-ai/dsh-client-ui-model-selection`, and `@deepseek-ai/dsh-client-ui-commands`. Stock rc.2 can still use the plugin's route and generation, but keeps a flat provider list.

With that extension, the model picker and `/model` use gateway `owned_by` for headings: `Magpie (Claude)`, `Magpie (GPT)` for `codex`, other nonempty owners verbatim, and `Magpie (Other)` when absent. Search covers heading, model name and full id. Display metadata does not change the real `dsh-magpie` route, model ids, names, visibility keys or default effort.

The picker uses the official single effort value. Default AUTO synchronizes a changed main effort through official `selectModel` on the same provider/model and allows its global-default save; MANUAL remains unchanged and bound children do not write that selection. The Host display extension only handles grouping/search metadata, not a second effort caption. Local source tests do not establish deployment or live GUI acceptance.

### Usage cards and refresh

Opening settings reads Magpie's cached cards, not the provider's live quota endpoint. Each card has its own **刷新**, which asks Magpie to reread that one account; there is no page-wide bulk refresh. Magpie may return the old reading during its throttle window; this is not proof of a fresh read. Cards with `asOf` are old readings.

Usage bars are coloured by the share used: blue at 70% or below, orange above 70% and below 90%, red at 90% or above.

A cold gateway may return no cards. The connection panel then offers **获取模型与用量**, which refreshes the model list and asks Magpie to read all usage. That initializes cards with an unrestricted key. A restricted held key cannot initialize an empty cache: ask the Magpie administrator to read usage in Magpie first, or use an unrestricted key. Do not grant additional access just to hide an empty state.

Codex reset-credit counts and expiry are display-only. This plugin never calls Magpie GUI account-management or reset endpoints.

## Connection methods

By default you only need the gateway URL and key. **高级连接** (advanced connection, expanded by default) selects how the gateway is reached:

- **直连 / Direct** (default): the gateway URL is directly reachable. LAN and Tailscale both fall here — once the client machine joins the tailnet, use `http://<host>.<tailnet>.ts.net:3425/v1` or the subnet-routed address; there is nothing else to configure in the plugin.
- **Cloudflare Access**: for a gateway behind Cloudflare Tunnel + Access when the client cannot run a VPN. Enter the Access service token's Client ID and Client Secret; every gateway request then carries `CF-Access-Client-Id`/`CF-Access-Client-Secret` alongside the bearer key. HTTPS only. Both values live in DSH credentials; switching back to Direct and saving clears them. Note that Cloudflare Free/Pro plans return 524 when the origin sends no response within 100 seconds.

Need another method (custom headers, mTLS, another zero-trust gateway)? Issues and pull requests are welcome — describe your deployment.

## Security and networking

Host requests go directly to the configured gateway through a private undici dispatcher. They do not inherit a global proxy dispatcher. Redirects are rejected; methods and API paths are allowlisted. Provider egress proxies belong in Magpie, not this plugin. LAN and Tailscale subnet routing can use the same address when the subnet route is reachable.

Connection identity changes hide old catalog and card state. Prepared or running generations deliberately finish using their captured old address and key; a connection edit does not cancel them. User cancellation and plugin disposal still stop generation. Treat the configured gateway as trusted: it receives prompts, attachments and the gateway key.

## Migration from dsh-magpie-connect

1. Keep the old plugin and display-name shim enabled while testing the new route.
2. Configure Magpie here; keys and preferences are not copied from the old plugin automatically.
3. Manually select `dsh-magpie` in existing sessions. Old sessions keep their saved `dsh-magpie-connect` route until changed.
4. After successful conversation, tools, cancellation and fast-mode checks, disable the old plugin and shim in the manifest, build and restart. Do not delete their entries or data as part of the trial.

The current default AUTO policy supports both exact transports, `dsh-magpie` and `dsh-magpie-connect`, retaining full model ids, live capability/effort caps and the parent's captured allowlist. They are not aliases. For a root AUTO session using explicit legacy, either Magpie preview is rejected before Jev; MANUAL still returns `routed: false` without judging or state writes. Previously bound children keep their saved transport. Network-guard changes remain separate. See [AUTO routing](<../auto-model-routing/README.md#auto-automatic-resource-selection-default>).

## Development

```sh
npm install
npm test --workspace=dsh-magpie
npm run typecheck --workspace=dsh-magpie
npm run build --workspace=dsh-magpie
```

Tests use local mock gateways and real pi-ai; no real key is required. Build output is not committed. Both `prepare` and `prepack` build the package.

## Removal

<!-- section: removal -->
Set the manifest entry to `enabled: false`, build and restart DSH. Disposal releases registrations, timers and connections; it does not remove credentials or settings.

If you want to erase data, separately remove the `MAGPIE_API_KEY` credential using DSH credentials management, and remove the plugin settings file after locating it from the installed plugin's configured data directory. Do not remove that credential if another integration still uses it. Old connect data is separate and is not deleted by this plugin.

To roll back, disable this plugin and re-enable the old connect route if needed. Historical sessions may need a manual model selection.

## License

MIT. pi-ai and undici are separate MIT-licensed dependencies. See their distribution notices for their upstream licenses.
