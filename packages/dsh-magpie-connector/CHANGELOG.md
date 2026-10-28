# Changelog

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
