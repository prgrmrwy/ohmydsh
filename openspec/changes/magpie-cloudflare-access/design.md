## Context

See proposal.md. The shared checkout is now clean and contains the AMD3 effort/display commit. The cooperating mainline owner identified runtime/settings/transport/routes and client SettingsPage/api as available follow-up scope. AUTO/Pet compat, existing change ledger and their README edits remain outside this change.

The current runtime captures only a gateway key in Operation and retains active/prepared keys for redaction. Transport owns a direct undici dispatcher, exact endpoint/query allowlist and redirect rejection. Public ingress has already passed independent HTTP/SSE and Responses tool continuation, but actual plugin compatibility is not yet proven.

## Goals / Non-Goals

Goals: optional dual Access headers over HTTPS, official credential storage, coherent operation capture, safe editable UI and deterministic tests.
Non-goals: replacing Magpie bearer auth, browser Access login, Cloudflare admin UI, new providers, AUTO changes, production connection migration, implicit restart or broad arbitrary request-header configuration.

## Decisions

- Add two named official credential references for client id and secret; do not store either in JSON settings or expose resolved values via settings API. Treat both as confidential for redaction.
- Capture the complete gateway identity at beginOperation and thread it through catalog/cards/adapter fetch. Include Access identity in connection fingerprint/credential invalidation; retain all captured secrets while active/prepared. Avoid reading mutable current credentials inside a prepared stream.
- Add a narrowly defined optional Access pair to settings API/UI. Validate all input and writable status before any mutation. Explicit clearing, password-style fields and configured status avoid redisplaying secrets. No automatic migration of current LAN connection.
- Require HTTPS for an Access-enabled connection, to avoid leaking service credentials on LAN plaintext. Unconfigured Access retains existing LAN HTTP support. No redirects, arbitrary origins or extra endpoint access.
- Reuse existing official credential and generation seams; no dependencies or shim. Reject partial credentials rather than silently send one header. Tests must cover independent credential notifications, mixed environment/file sources, clearing, redaction and rotation races.

## Risks / Trade-offs

- Multi-key writes are not inherently transactional → prevalidate writable fields and define/verify failure handling before implementing UI save; never claim atomic rollback without tests.
- Active operation secrets may outlive a settings change → retain/redact each captured secret until operation release and preserve prepared lifecycle behavior.
- Cloudflare edge behavior differs from local mocks → real plugin public smoke remains an explicit acceptance step; company network is user acceptance.

## Migration Plan

Implement and test in independent scoped change. Preserve current LAN settings. Only after review, isolated validation and explicit production deployment approval, configure the external client with HTTPS plus privately delivered credentials. Rollback clears Access settings or disables the new capability and restores prior LAN settings; do not remove edge Access while public ingress remains active.
