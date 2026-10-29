# Changelog

## 0.3.1

- Replace both README demo GIFs with representative PNG screenshots (the model picker grouped by provider; per-provider visibility, default effort and usage cards in Settings), because the DSH plugin store does not show GIFs by default. No runtime behavior changes.

## 0.3.0

**BREAKING:** the single provider route `dsh-magpie-connector` is retired and not aliased. Sessions, the default model and any external configuration saved with that route id no longer resolve; reselect the model after upgrading, and update anything that lists the exact route id (subagent routing, egress allowlists).

- **Grouping on stock DSH.** One real route per gateway `owned_by`: `dsh-magpie-connector-<owner>` (lower-cased, 1–48 chars of `a-z0-9._-`; anything else goes to `-other`). The official picker shows `Magpie (<Owner>)` groups without any Host extension; the `displayGroup` metadata is gone.
- **Route identity.** Every model result carries the requested route as `provider`; lookups are by model id, so capabilities are identical on any plugin route.
- **Replay across routes.** Native reasoning replay uses a fixed transport identity, so encrypted reasoning survives tool turns, restarts and switching between plugin routes; foreign or tampered history degrades to plain history.
- **Remembered owners.** `settings.json` `knownOwners` (max 32, first-seen order) registers routes at start-up before the first sync. Invalid values are reset as a whole (`knownOwnersReset`), over-limit owners are reported (`ownerLimitReached`, `rejectedOwners`), and owners that disappear keep their empty route.
- **Failure handling.** A failed first registration (route owned by another plugin, or a host listener `INVARIANT`) is reported as `routeRegistrationError` in Settings and requires a DSH restart; replace conflicts roll back the new owner and still publish catalog changes. Settings writes go through one synchronous writer, so owner discovery never deadlocks with settings requests or overwrites concurrent line saves.
- **Speed control** shows on any plugin route.

## 0.2.0

**BREAKING:** the settings format changes from a single top-level `baseUrl` to an ordered `lines[]` list, and credentials move to per-line derived refs. Existing `settings.json` files with only `baseUrl` and the legacy fixed refs (`MAGPIE_API_KEY`, `MAGPIE_ACCESS_CLIENT_ID`, `MAGPIE_ACCESS_CLIENT_SECRET`) are **not read, migrated or deleted**; reconfigure the connection in Settings after upgrading. `visibleModels` / `defaultEfforts` are preserved. Back up `settings.json` and the old credential refs before upgrading if you need a rollback path.

- **Multiple connection lines.** Settings hold an ordered list of 0–5 lines (empty on first install; normally one), each with its own address, gateway key and access mode (`direct` or Cloudflare Access). Array order is the priority order used for automatic selection; moving lines does not change their identity or credentials.
- **Stable random line ids.** The host generates an 8-hex-character id when a line is created (unique among existing and pending lines); it is stored in settings, never shown in the UI (the UI shows the 1-based position) and never changes when the address, key, order, or another line changes.
- **Per-line credentials.** Every line uses `MAGPIE_LINE_<ID>_API_KEY` / `MAGPIE_LINE_<ID>_ACCESS_CLIENT_ID` / `MAGPIE_LINE_<ID>_ACCESS_CLIENT_SECRET` (uppercase id). Deleting a line clears its writable refs; environment-owned values are reported through `retainedCredentials`. New lines omit `id` in POST bodies and are assigned one by the host.
- **Automatic line selection.** Before each gateway operation the first reachable complete line (priority order) is chosen with a ≤600ms TCP probe (10s positive / 15s negative in-memory cache, no background polling). A single-line setup never probes. If all lines are unreachable the first line carries the real request and the error surfaces as-is.
- **Line switching keeps the catalog.** Switching lines carries the current model catalog over (no empty flash), clears usage cards and re-syncs the new line. Editing a non-active line does not clear the catalog or trigger a sync; editing the active line keeps the identity-change semantics. Generated requests are never replayed or switched: a connection-phase failure only invalidates that line's probe cache.
- **Per-line Cloudflare Access.** Access is enabled per line and sent only to HTTPS lines that enable it; plain-HTTP lines never carry the service token. Switching a line back to Direct clears its saved Access pair on save.
- **Load validation and write safety.** Malformed/duplicate persisted lines or pending records make the whole connection read as unconfigured (no requests, no credential resolution, file untouched). Credential writes are persisted as `(lineId, field)` pending entries before secrets are written; partial failures keep the pending quarantine across restarts and require an explicit complete retry. Removed/new line ids are cleaned through that quarantine.
- **Settings UI.** Line cards with the active line expanded by default, a 4×4 green active marker after its number, an info tooltip explaining priority, add/move/delete controls, an empty state with an add button for first install, and silent switching (no toast/alert).
- **Docs/tests.** README, architecture diagrams, internal API notes and the CHANGELOG document the breaking upgrade and reconfiguration steps; the old settings screenshot was removed pending re-recording.

## 0.1.2

- Default request output budget now reserves context space for DSH compaction: `min(max_output_tokens, max(1, context_window/4, context_window/2 − 65536))`. The gateway's capacity stays the pi-ai model output limit, so the model's real ceiling is unchanged.
  - On a live gateway, `codex/gpt-6-astra` and `codex/gpt-6-luna` (272k window / 128k capacity) move their compaction threshold from 78,464 to 136,000 tokens; `opencode-go/minimax-m3.1-flash` (1M / 512k) from 422,464 to 500,000.
  - An explicit `maxTokens` passes through unchanged; DSH still fills the default when a request omits it.
  - Models with a window below 104,026 tokens are not guaranteed to pass DSH's two compaction checks; they are still mapped with the same formula rather than dropped.

## 0.1.1

- Fix README images on npm: `repository` no longer declares a monorepo `directory`, so relative image links resolve against the standalone repository root.

## 0.1.0

- First release.
- One `dsh-magpie-connector` LLM route for a self-hosted Magpie gateway: model discovery from `GET /models`, Responses or Chat Completions per model, text, tools, images, usage, cancellation and DSH-managed retries.
- Model picker and settings group models and read-only usage cards by the gateway's upstream provider; `owned_by` drives the `Magpie (Claude)` / `Magpie (GPT)` headings while the real route stays single.
- Per-provider model visibility, per-model default effort and a per-session standard/fast switch for models advertising the `priority` service tier; the switch follows model-selection changes immediately instead of waiting for the 3-second poll.
- Optional Cloudflare Access service-token authentication for gateways behind Cloudflare Tunnel + Access; HTTPS only.
- Credentials use DSH credentials (`MAGPIE_API_KEY` and optional Access refs); the key is never written to the settings file or returned by the settings API.
