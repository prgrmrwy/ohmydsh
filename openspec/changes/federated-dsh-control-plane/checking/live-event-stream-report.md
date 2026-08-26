# Live dual event-stream conformance

Automated as `tests/federation-live-event-streams.test.mjs`, run against a real
`dsh web` (pinned rc.2) under an isolated `DSH_HOME`. Closes a real gap: until
now `DualEventCarrier` had only ever run against hand-written fake sockets, so
the transport choice itself was unverified.

## Transport is WebSocket-only on the browser carrier path

A real rc.2 server answers a plain `GET` on both event paths with:

```
GET /api/events.mux  -> HTTP 426  text/plain  "upgrade required"
GET /api/events.host -> HTTP 426  text/plain  "upgrade required"
```

and completes a WebSocket upgrade on the same paths
(`HTTP/1.1 101 Switching Protocols`).

This matters because the pinned rc.2 source contains **both** transports:
`dsh-host-apiproxy/lib/types/fetch/handler.js` serves SSE
(`content-type: text/event-stream`) for in-process use, while the browser
carrier (`WebApiClient.readWebSocket`) uses WebSocket downlinks. A federated
central connecting to a remote `dsh web` takes the browser-facing path, so SSE
is **not** available there. `DualEventCarrier`'s WebSocket assumption is
correct, and this test now pins that fact instead of assuming it.

Node's global `WebSocket` already satisfies the package's `CarrierSocket`
interface, so the real carrier is driven unmodified.

## Real frames observed and converted

With both streams open, real host activity (`workspace.create`,
`session.create`, `session.rename`) produced **14 frames** across both streams,
of which **10** converted into stable Core reconciliation frames. Observed
vocabulary:

| Stream | Frame types |
| --- | --- |
| `mux` | `session/subscribed`, `session/event`, `session/projection` |
| `host` | `host/workspace-changed`, `host/session-added`, `host/remote-event` |

Asserted: both streams deliver; every frame carries its stream tag and the
current generation; the session and host frame families the projection depends
on are all present; and the adapter converts live frames into Core frames whose
session/workspace identities are plain strings — no rc.2 schema leaks outward.

## Old-generation frames are dropped

After moving the central generation forward, a rename issued through a
*current* carrier (so the server genuinely emits frames) produced **no**
delivered frames on the superseded carrier.

Two earlier versions of this assertion were **vacuous** and were fixed:

1. the first had no control step, so "no frames arrived" could not be
   distinguished from "this action never emits frames". A baseline now proves a
   rename does produce live frames while the generation is current.
2. the second issued the post-change rename through the *stale* unary carrier,
   which correctly failed with `StaleGeneration` — so the server never emitted
   anything and the drop assertion again proved nothing. The write is now issued
   through a current carrier; only the event carrier is stale.

## Mutation checks

| Mutation in `host/carrier/events.ts` | Test result |
| --- | --- |
| remove the generation check at message ingestion only | **passed** (not detected) |
| remove the generation checks at ingestion **and** drain **and** queue-clear | **failed** ✓ |

The first result is informative rather than a weakness: generation filtering is
**defense in depth** across three sites, so disabling any single one still
stops delivery. Only removing all three lets stale frames through, and the test
catches exactly that. Sources were restored and verified clean (0 mutation
markers).

## Verification

`npm test` → **85 passed, 0 failed**; `dsh-federation` package → **117 passed**.
Nothing touches `~/.dsh`; `dsh.yaml` keeps `dsh-federation: enabled: false`.
