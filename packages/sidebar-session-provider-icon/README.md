# dsh-sidebar-session-provider-icon

[![dsh.so risk](https://www.dsh.so/badge/dsh-sidebar-session-provider-icon.svg)](https://www.dsh.so/artifact/dsh-sidebar-session-provider-icon/)

English · [简体中文](README.zh.md)

![The DSH session list with a different brand logo before each title (Grok, GLM, Kimi, OpenAI, DeepSeek), one per session's selected model; the models are local demo routes](docs/overview.png)

![Sidebar rendering: same-vendor selections show one logo; aggregator routes show the provider logo with the model logo in the corner (light and dark theme)](docs/screenshot.png)

<!-- problem -->
In the DeepSeek Harness (DSH) sidebar every session row looks alike, so you cannot tell which provider and model a conversation uses without opening it. This plugin shows a provider + model icon in front of each session title, read from the model currently selected in the composer, and updates it the moment you switch. When the provider and the model come from different vendors (for example `opencode-go/deepseek-v4-flash`), the provider logo carries a small model logo in its bottom-right corner.

**Install.** DeepSeek Harness `0.2.0-rc.2`, Node.js `>=22.19`.

```sh
# from npm — prebuilt, no build approval
dsh plugin --profile web add dsh-sidebar-session-provider-icon

# or straight from source — builds locally, approve the build when dsh asks
dsh plugin --profile web add prgrmrwy/dsh-sidebar-session-provider-icon
```

Restart DSH and refresh the Web page. Nothing else is needed: no configuration, no network access, and no files written outside the DSH profile that installs it.

In the ohmydsh repository this plugin is wired through the `dsh.yaml` entry `sidebar-session-provider-icon` (`source: local`), so a source change there only needs `dsh build` and a restart. Current behavior is specified in [`openspec/specs/sidebar-session-provider-icon`](https://github.com/prgrmrwy/ohmydsh/blob/main/openspec/specs/sidebar-session-provider-icon/spec.md); design history lives in the archived changes [`sidebar-session-provider-icon`](https://github.com/prgrmrwy/ohmydsh/tree/main/openspec/changes/archive/2026-08-21-sidebar-session-provider-icon) and [`sidebar-provider-icon-composite-model-badge`](https://github.com/prgrmrwy/ohmydsh/tree/main/openspec/changes/archive/2026-10-10-sidebar-provider-icon-composite-model-badge).

## How it behaves

The logo shown for a session comes from three sources, in this order:

1. **Live selection (preferred, while verifiable).** The official `dsh-client-ui-model-selection` store, read as `ctx.modelDirectories.directoryFor(sessionId).store.current`. It is the single per-session state shared by the input-box selector and the `/model` command, and it publishes `{ provider, model }` as soon as `session.selectModel` succeeds. The open session, including a blank one that has not sent a message yet, therefore follows the input-box selection. That store belongs to a client Session scope, so every session-list and DOM signal re-resolves it: when the runtime hands out a new store for the same session (leaving the session and coming back is enough) the badge re-subscribes and re-reads it, and it re-reads the snapshot even when the identity did not change. An observation is kept only while its session is the open one; once the view moves on — or the directory cannot be resolved any more — it is dropped, so a value the client can no longer verify never decides a row.
2. **Selected model (durable).** The official `modelSelection` projection's `next`: the selection the session will use for its next request. The host maintains it and it also covers a model the user picked but has not sent with yet, which is what keeps a row right after you leave its session.
3. **Last request (cold-history fallback).** A Host `provider` session projection folds the `request/header` events of the session log, so a history session whose selector has not been loaded in this browser still shows the provider of its most recent real request. It survives restarts and uses no `localStorage`.

Brand resolution has two independent dimensions: the provider route picks the **main logo**, the model id picks the **corner logo**.

| Selection | Shown |
|---|---|
| `claude/claude-opus-5`, `codex/gpt-6-luna`, `deepseek-official/deepseek-v4-pro` (same vendor) | a single Anthropic / OpenAI / DeepSeek logo |
| `opencode-go/deepseek-v4-flash`, `opencode-go/qwen3.8-flash`, `opencode-go/kimi-k2.7-code` | OpenCode, with DeepSeek / Qwen / Kimi in the corner |
| `traex/GPT-5.6-Sol[1m]`, `traex/DeepSeek-V4-Flash`, `traex/Gemini-3.1-Pro-Preview` | Trae, with OpenAI / DeepSeek / Gemini in the corner |
| `traex/openrouter-3o[1m]`, `traex/Seed-2.1-Pro-0915` | Trae, with OpenRouter / ByteDance in the corner |
| `dsh-magpie-connect` + `claude/claude-haiku-5-5`, `codex/gpt-6-luna`, `opencode-go/deepseek-v4-flash` (Magpie gateway) | Magpie, with Anthropic / OpenAI / OpenCode in the corner |
| known route + unrecognized model (e.g. `opencode-go/omen-alpha`) | the route logo only, no corner logo |
| unknown or generic route | a single logo from the model name; if that also fails, a neutral single-letter badge |

- **Route first.** `opencode-go/deepseek-v4-flash` shows OpenCode as the main logo; DeepSeek can only appear in the corner.
- **No impersonation.** A model whose vendor cannot be identified gets no corner logo, and never a letter badge in the corner.
- **Size.** The composite keeps the 14×14 footprint of a single logo, so the row layout does not move. The corner logo is the bare 10px glyph, overhanging the bottom-right by 4px, with no plate, ring or padding: at this scale any decoration eats the pixels the glyph needs.
- **Tooltip.** Hovering always shows the exact `provider · model`.

| Layer | Implementation |
|---|---|
| Host | `src/provider.ts` registers the `provider` projection (it requires the `sessionProjections` service) and folds `request/header`; it only serves the cold-history fallback |
| Client data | `selection-binding.ts` observes the open session's store of `ctx.modelDirectories` (re-resolved per signal); `provider-map.ts` prefers a verifiable observation, then the official `modelSelection` selection, then the `provider` fallback |
| Client DOM | `row-locator.ts` holds all knowledge of the official row DOM: each row is identified by its official `data-row-key="session:<id>"` (the title reverse lookup remains only as the fallback for a runtime without it), so two sessions sharing a display title never receive each other's badge; a `MutationObserver` maintains a separate badge `<span>` in front of the title |
| Brand art | `src/client/assets/*.svg`, downloaded once and bundled; `logos.ts` resolves the provider brand and the model brand separately and renders the composite when they differ |

The badge content is derived only from `(provider, model)`; `index.ts` rebuilds a badge only when those values or the tooltip change.

## Configuration

None. The plugin row carries no `config` fields and the package reads no environment variables.

Recognized brands:

| Dimension | Brands |
|---|---|
| provider and model | DeepSeek, OpenAI/GPT/Codex, Anthropic/Claude, Grok/xAI, Kimi/Moonshot, GLM (Zhipu), MiniMax, Pi, OpenClaw, Hermes Agent (the misspelling `hermas` is also accepted), OpenCode, Qwen, Tencent Hunyuan (`hy3`, `hy4-*`), Meituan LongCat, Xiaomi MiMo, Gemini/Gemma, NVIDIA (Nemotron), Meta (Muse Spark, Llama), Ant Group (Ling/Ring), OpenRouter, ByteDance Seed |
| provider only | Trae (`trae`, `trae-ai`, `traex*`; exact name or prefix, never a substring), Magpie (`magpie`, `magpie-*`, and the `dsh-magpie-connect` plugin route; exact name or prefix) |

Behind a gateway route (Magpie) a model id is `<upstream provider>/<model>`: the corner logo comes from the upstream segment read as a provider route (`claude` → Anthropic, `opencode-go` → OpenCode), and only when that segment is no brand (`auto/`, `group/`, a custom id) from the model name after the slash. Other routes keep reading the whole model id.

The model dimension covers every identifiable model family in the OpenCode Go / Zen catalogs, plus the GPT, DeepSeek, Gemini, OpenRouter and ByteDance Seed families in the current TraeX catalog.

Brand art is pinned and vendored, never hand-drawn and never fetched from a CDN at runtime:

- every brand except OpenCode and Magpie: `@lobehub/icons-static-svg@1.94.0`, MIT; the color variant is used where one exists;
- OpenCode: the official provider SVG from `anomalyco/opencode` at commit `5e75e5e9901f0d178f425bfb47f1bd46cbe78a59`, MIT;
- Magpie: the official mark `internal/provider/magpie.svg` from `yetone/magpie` at commit `ba1dc7f975666e50308ef7bf8173c8a8e91c553b`, MIT.

Per-file source URLs and SHA-256 checksums are listed in [`src/client/assets/README.md`](src/client/assets/README.md). Some color SVGs carry gradient/clip ids; the corner instance suffixes them with `-sub` so copies on the same page never resolve each other's definitions.

To add a brand: put the SVG in `src/client/assets/`, record source, pin, license and SHA-256 in the assets README, then add rules and tests to `providerBrandOf` / `modelBrandOf` in `logos.ts`.

## Boundaries & safety

- The official `StateDot` is never replaced, moved or hidden; times, row menus and drag behavior stay official.
- The badge is a standalone `<span>` in front of the title. If the row DOM cannot be located reliably, the plugin silently shows nothing and leaves the page intact.
- No network requests of its own: the logos ship with the bundle and the data comes from DSH's own stores and session log.
- Code is MIT-licensed ([LICENSE](LICENSE)). The brand icons are vendored from MIT-licensed upstreams; their copyright notices, the exact rendering changes, and the trademark position are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Brand owners retain their trademark rights; the marks only identify the selected provider route and model and imply no endorsement.

## Development

`lib/` is a gitignored build artifact. In a standalone checkout:

```sh
npm install
npm run typecheck
npm test
npm run build
```

In the ohmydsh monorepo this package is a workspace member: install once at the repository root and add `--workspace dsh-sidebar-session-provider-icon` to the last three commands. `dsh build` / sync also builds `lib/` on demand before installing the local package; refresh the Web page to pick up a new client bundle.

Under vitest, small SVGs are inlined as data URLs with attribute quotes rewritten to `'`. Any regex that rewrites SVG attributes must accept both `"` and `'`.
