# Changelog

## 0.1.0

- First release under the `dsh-magpie-connector` name (previously the unpublished `dsh-magpie`).
- One `dsh-magpie-connector` LLM route for a self-hosted Magpie gateway: model discovery from `GET /models`, Responses or Chat Completions per model, text, tools, images, usage, cancellation and DSH-managed retries.
- Model picker and settings group models and read-only usage cards by the gateway's upstream provider; `owned_by` drives the `Magpie (Claude)` / `Magpie (GPT)` headings while the real route stays single.
- Per-provider model visibility, per-model default effort and a per-session standard/fast switch for models advertising the `priority` service tier.
- Optional Cloudflare Access service-token authentication for gateways behind Cloudflare Tunnel + Access; HTTPS only.
- Credentials use DSH credentials (`MAGPIE_API_KEY` and optional Access refs); the key is never written to the settings file or returned by the settings API.
- Rename migration: the first start may read `$DSH_HOME/plugins/dsh-magpie/settings.json` once, leaving the legacy file untouched. Sessions that saved the old `dsh-magpie` route need a manual model re-selection.
