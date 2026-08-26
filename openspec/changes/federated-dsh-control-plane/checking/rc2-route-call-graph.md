# DSH rc.2 federation route and call-graph gate

## Scope and method

This is a static, reproducible inventory for `@deepseek-ai/dsh@0.1.1-rc.2`. It records the effective composed Connection path used by the official browser, including routes that do not appear in `RpcMethodMap`. The JSON inventory and frames beside this report contain synthetic values only.

Evidence was read from the installed package declarations and release bundles under the pinned DSH checkout. No live DSH process, real session, real workspace, credential, or user content is required.

## Effective transport composition

```text
Official browser runtime/UI
  ├─ IApiClient domain method
  │    └─ AbstractApiClient.callUnary(method, payload)
  │         └─ POST /api/<method> ClientRequest
  ├─ pending approval/question wait
  │    └─ POST /api/respond ClientResponse
  ├─ event bridge
  │    ├─ WS /api/events.mux
  │    └─ WS /api/events.host
  ├─ session-log-export client
  │    └─ HEAD/GET /api/session.export?sessionId=...
  └─ generated Typert client remotes
       └─ connection.rpc.call('/api', '<namespace>/<method>', {args})

Host WebServer prefix /api
  └─ HostConnectionService.createSharedFetchHandler('/api', fallback)
       ├─ if one registered interceptor matches endpoint
       │    └─ interceptor FetchHandler
       │         └─ TypertGatewayService.dispatchRpc for namespace/method
       └─ otherwise
            └─ toFetchHandler(apiProxy) fallback
                 ├─ /api/events.mux and /api/events.host SSE face
                 ├─ /api/session.export GET/HEAD
                 ├─ /api/respond
                 └─ RpcMethodMap unary routes
```

### Proven interceptor order

`HostConnectionService.createSharedFetchHandler` derives the endpoint and reads the sole `/api` interceptor. A matching interceptor runs before fallback; unmatched/invalid endpoints use fallback. `registerInterceptor` rejects a second interceptor for `/api`. `TypertGatewayService` installs that interceptor with `authority: trusted-host` and claims strict generated or SRC remote endpoints. Therefore federation must compose with the effective shared handler or become that one exhaustive interceptor; it cannot register a second independent `/api` interceptor and cannot call bare `ctx.apiProxy` for local fallback without bypassing Typert.

The prefix-wide browser trust fence is outside the composite handler. Privileged API Proxy methods receive an additional loopback-only check. Browser event downlinks are registered as exact WebSocket upgrades and apply the same trust check.

Evidence:

- `dsh-client-connection/lib/index.js:218-239`: public RPC registration and interceptor-before-fallback selection.
- `dsh-client-connection/lib/index.js:259-272`: one interceptor only and scoped disposer.
- `dsh-client-connection/lib/index.js:275-299`: endpoint/method/envelope validation.
- `dsh-client-connection/lib/index.js:530-565`: `/api` prefix trust fence and API Proxy fallback.
- `dsh-client-connection/lib/index.js:566-584`: mux/host WebSocket upgrade registration.
- `dsh-api-gateway/lib/index.js:56-70`: Typert Gateway interceptor registration and claims.
- `dsh-api-gateway/README.md:13-23`: documented composed semantics and Client Remote call path.

## Routes that federation must account for

The machine-readable shapes are in `protocol/rc2-route-inventory.json`.

### Core session and workspace routes

All twelve `session.*` and seven `workspace.*` entries in `RpcMethodMap` are used by the official runtime. `host.describe`, `host.listDirectory`, and `host.createDirectory` are needed by readiness and node-bound directory flow. `host.pickDirectory` is This-Mac-only and `host.openPath` must never be routed to a remote node.

Every response echoes the request `rpcId`. Business failures are encoded in `result.ok === false`; HTTP errors describe carrier/protocol failure.

### Respond

`respond` is intentionally absent from `RpcMethodMap`. `POST /api/respond` carries a `ClientResponse`, whose `rpcId` identifies a pending approval or question. Federation needs a pending-request ownership table keyed by the server-minted `rpcId`; no session id appears in the response envelope itself.

### Event streams

The browser uses downlink-only WebSockets at `/api/events.mux` and `/api/events.host`; API Proxy also exposes an isomorphic GET/SSE face. Frames are full `ServerRequest` envelopes whose method equals `payload.type`.

Only session log events and `session/projection.seq` have comparable session-domain sequence. `session/subscribed.lastSeq` and history `projections.asOfSeq` anchor resync. Host workspace/order/archive/status frames have no unified cross-stream sequence and must not be compared with mux sequence values.

### Session export

`dsh-session-log-export` directly constructs `/api/session.export`, puts `sessionId` in the query, probes with HEAD, and lets the browser perform GET. It bypasses `IApiClient` and the POST envelope. It must either route a federated session to its node safely or reject `fed1:` before local API Proxy fallback. V1 may capability-gate remote export, but silent local interpretation is forbidden.

### Typert Remote endpoints

Session-aware official UI also calls generated Typert endpoints over the same `/api` channel, notably commands, goals, file/session reference providers, message feedback, and plugin UI operations. Their exact wire names and argument codecs are generated by the Host assembly and claimed by `TypertGatewayService`; they are not present in `RpcMethodMap`.

M0 task 1.9 must derive the selected assembly's full generated contribution and classify every id-bearing argument. Until that executable inventory exists, the safe policy is:

1. exact support for audited federation endpoints;
2. reject any request containing a syntactically `fed1:` identity before local fallback when the endpoint is unclassified;
3. preserve bare native-id calls through the original composed handler as This Mac;
4. never forward Settings, Credentials, provider secrets, `host.openPath`, or generic remote execution.

This is why task 1.1 can close with the protocol inventory while task 1.9 remains open until transaction and deny-by-default tests exist.

## Official runtime call sites

- Connection startup calls `host.describe`, opens both event streams, then drives manager refresh.
- Session manager: list, search, create, fork, history, models/selectModel, prompt, attachment, updateQueue, cancel, rename, and subagent routes.
- Workspace manager: list, create, rename, delete, insertBefore, insertSessionBefore, archiveSession.
- Pending approval/question waits call `api.respond`.
- Session runtime calls generated `remote.commands.execute` for command execution; other official UI packages call generated goals/reference/message-feedback/plugin namespaces.

Representative evidence:

- `dsh-client-connection/lib/client.js:9973-10088`: exhaustive fixture dispatch demonstrates RpcMethodMap and both streams/respond.
- `dsh-client-runtime/lib/client.js:7196-7366`: prompt/attachment/queue/cancel/rename and command Remote.
- `dsh-client-runtime/lib/client.js:8070-8201`: session list/search/create/fork.
- `dsh-client-runtime/lib/client.js:9496-9642`: complete workspace manager call path and frame reconciliation.
- `dsh-session-log-export/lib/client.js:97-116`: direct export URL.

## Schema and privacy conclusions

- Request, response, and frame types come from browser-importable `@deepseek-ai/dsh-host-apiproxy/api` contracts; adapter code should import/validate there and translate immediately into stable Core types.
- A prompt's `rpcId` is durably copied to `user/message` source, which is unique evidence for unknown prompt reconciliation. Text equality is not evidence.
- Synthetic fixtures use only `fixture-*`, `/synthetic/...`, fixed UTC timestamps, and invented content. No runtime dump is retained.

## Gate result

Task 1.1 is proven for the installed rc.2 protocol and official composed Connection: **PASS**.

Task 1.9 is **PASS** after the user-approved minimal Connection compatibility seam. The selected isolated assembly inventory now covers all 26 Typert endpoints (21 identity-bearing), the expanded ApiProxy identity routes, and direct GET/HEAD export. `rc2-connection-api-middleware.patch` adds one scoped outer `/api` middleware after the existing physical route trust fence and before the unmodified composed handler. Executable tests prove Typert-first native delegation, generic unknown-route `fed1:` rejection with zero native fallback calls, unique middleware ownership/disposal, and strict reverse rollback at every exact-route registration position. Fixed source/blob/patch/output hashes and last-known-good preservation are recorded in `upstream/rc2-connection-source-manifest.json`.
