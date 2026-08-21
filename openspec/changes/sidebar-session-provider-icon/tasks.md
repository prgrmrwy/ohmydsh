# sidebar-session-provider-icon — Tasks

## 1. Package skeleton and manifest wiring

- [x] 1.1 Create `packages/sidebar-session-provider-icon/` as a local DSH bundle with host + client faces, build/typecheck/test scripts, `dsh.bundle` patch and README; pin peer/dev dependencies to the repository's active DSH rc family (rc.7).
- [x] 1.2 Add a `source: local` package entry in `dsh.yaml` (id `sidebar-session-provider-icon`); verify `node scripts/sync.mjs` resolves the package and existing wire (width-tiers / worktree-session) still passes.

## 2. Host-side provider projection

- [x] 2.1 Implement the `provider` `ProjectionDefinition` (key `provider`, `stateVersion: 1`): `init` = no value; `apply` updates only on `request/header` events from `header.config.provider/model` (same-reference no-op otherwise); `view` = `null` when absent else `{ provider, model }`; zod schema validates the wire value.
- [x] 2.2 Register the unit via `ctx.inject(['sessionProjections'], …)` on the host composition so headless assemblies without the registry stay unaffected.
- [x] 2.3 Add host tests: fold over synthetic logs (no header → null; one header → its provider/model; later header overrides; other event types do not change state reference).

## 3. Client provider-map subscription and row locator

- [x] 3.1 Implement the client data layer: subscribe to `ctx.sessions.list`, derive `sessionId → projectionValues.provider`, and expose a reactive read used by the renderer.
- [x] 3.2 Implement `src/client/row-locator.ts`: given a session row DOM node, resolve its `sessionId` via `role="treeitem"` + `class$="sessionRow"` anchor and title-text reverse lookup; expose insert/remove of a logo element at the title prefix without touching the official status dot / time / menu / drag cells.
- [x] 3.3 Implement the MutationObserver loop: observe the sidebar workspace region, insert/update/remove logos as rows and provider values change; strict-failure paths silently skip (no exception, no wrong-row injection).
- [x] 3.4 Add client tests for locator resolution (matching row, ambiguous/duplicate titles, unlocatable row → safe skip) and for state-dot non-interference.

## 4. Provider logo mapping and rendering

- [x] 4.1 Add the `provider → inline SVG` logo map for known providers (codex/OpenAI, claude/Anthropic, grok/xAI, deepseek, …) plus a neutral first-letter fallback for unknown providers.
- [x] 4.2 Render the 12~14px logo span (with optional provider/model `title` tooltip) only when a provider value exists; blank/no-request sessions get no insertion.

## 5. Build, sync, and acceptance

- [x] 5.1 `npm run build` + typecheck in the package; fix any leaf diagnostics.
- [x] 5.2 `node scripts/sync.mjs` then `dsh build`; confirm the bundle loads (`dsh --profile web --dump-config` shows the row, log has no load errors).
- [ ] 5.3 Restart acceptance (real GUI deployment, user-driven): sidebar shows correct model-brand logos, official `StateDot`/time/menu/drag unchanged.

## 6. Revision after real-GUI feedback: selected model + real brand assets

- [x] 6.1 Replace last-request-only semantics with `ctx.modelDirectories.directoryFor(sessionId).store.current` as the active session truth source; subscribe for immediate no-send updates, retain the host projection only as a cold-history fallback, and allow a blank session with a current selection to show a logo.
- [x] 6.2 Replace every hand-drawn logo path with downloaded, pinned SVG assets for DeepSeek whale, OpenAI spiral, OpenCode, Anthropic and Grok; resolve known provider routes before using model as a fallback and keep a neutral unknown fallback.
- [x] 6.3 Update package dependencies/inject metadata, B013, README, proposal/design/spec, and add tests for selector precedence, blank-session selection, OpenCode disambiguation and actual downloaded asset content.
- [x] 6.4 Run package typecheck, 21 tests and build; confirm SVG assets inline into `lib/client.js` with no runtime CDN dependency; independently review and cover retry after a transient same-session directory-resolution failure.
- [ ] 6.5 Sync/start an isolated GUI build and verify: DeepSeek/GPT/OpenCode logos visually match downloaded assets, switching the composer model changes the current row icon before sending, and StateDot/time/menu/drag remain untouched.
