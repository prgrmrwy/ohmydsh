# `dsh-better-sidebar@0.19.1` audit

## Provenance and runtime relationship

Current rollback pin: `dsh-better-sidebar@0.18.0`. Candidate `0.19.1` was compared with the npm `0.18.0` artifact and official `@deepseek-ai/dsh-client-ui-sidebar-right@0.1.5-rc.2`; extracted artifacts were read-only under `/tmp/dsh-sidebar-audit.*`.

The candidate moves DSH peers from the `0.1.2` family to `^0.1.5-rc.1`, adds the official sidebar-right client inject, and keeps the `better-sidebar` bundle row. Target `0.1.5-rc.2` satisfies the peer range. The client uses the native sidebar-right service, resource editor, Session-scoped occurrences and lifecycle aborts; `single: true` only protects the legacy bottom-workbench registration.

## Hard validation point

The candidate declares `node-pty: ^1.1.0`, while target DSH `@deepseek-ai/dsh-subprocess-local@0.1.5-rc.2` declares `node-pty: 1.2.0-beta.15`. These ranges do not prove one physical native binding. A fresh target profile must record `npm ls node-pty`, `pnpm why node-pty`, both `require.resolve` paths and native binding identity. Any duplicate or mismatched binding is a production blocker until an explicitly reviewed override resolves it.

## Local composition boundary

`packages/session-links` still uses the legacy `ctx.betterSidebar.openTab` editor path. It does not yet use `ctx.sidebarRight.openResource`, an authorizing Session resource address, or official resource pin/authorization. Static session-links tests therefore do not prove Session A/B isolation, cold-session persistence authorization, or close/unload abort behavior under the target right sidebar.

## Decision

Conditional GO for isolated migration only. Add `better-sidebar@0.19.1` after the bare target runtime and before `session-links` in the target profile; verify loader uniqueness, native sidebar/resources behavior, Session switching, unload/abort/reload and node-pty single-instance. Keep `0.18.0` for rollback. Do not mark task 2.3 complete until those target and composition gates execute; `sidebar-qa` remains removed by explicit user decision.
