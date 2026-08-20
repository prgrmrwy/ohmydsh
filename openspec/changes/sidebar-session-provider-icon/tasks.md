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
- [ ] 5.3 Restart acceptance (real GUI deployment, user-driven): sidebar shows provider logos per session (incl. history after restart), logo updates when a session switches provider, official `StateDot`/time/menu/drag unchanged, blank sessions show no logo. NOTE: main checkout holds uncommitted parallel schema-v2 work; merge to main is handled by the user in a separate session.
