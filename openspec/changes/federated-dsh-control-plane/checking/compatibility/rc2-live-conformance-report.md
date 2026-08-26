# rc.2 live conformance run (adapter vs. real `dsh web`)

The pinned rc.2 CLI (`@deepseek-ai/dsh@0.1.1-rc.2` from the npx cache) was
started with `dsh web --port <free> --no-open` under an **isolated
`DSH_HOME`** and an isolated cwd, and the real `DshRc2NodeAdapter` +
`HttpUnaryCarrier` were driven against it. Nothing in `~/.dsh` was touched, no
deployment ran, and the federation manifest entry stayed `enabled: false`.

This closes the gap noted in the previous round: until now the adapter had only
ever been exercised against fixtures written by hand from the pinned `.d.ts`
files.

## Defects found and fixed

### 1. `host.describe.version` is hardcoded `0.0.1` — exact-version gate could never grant writes

The contract comment states *"version = the host app's (apps/cli)
package.json version"*, and `apps/cli` is `0.1.1-rc.2`. The pinned
implementation nevertheless returns a constant:

```js
// @deepseek-ai/dsh-host-apiproxy/lib/index.js:3110
host: { describe(request) { return Promise.resolve(ok(request, { version: "0.0.1", … })) } }
```

Observed from the live server: `"version":"0.0.1"`.

Consequence of the previous implementation: the matrix compared the reported
version to the exact string `0.1.1-rc.2`, so **every genuine rc.2 node would
have been classified `EXPERIMENTAL` and denied all writes**. The bug was
invisible against self-written fixtures because those fixtures echoed the
documented value rather than the implemented one.

Fix: the reported version is treated as advisory. `SUPPORTED` now requires the
**structural** proof (`host.describe` schema + `workspace.list` +
`session.list` + both event streams) and a version rc.2 actually advertises
(`0.1.1-rc.2` or `0.0.1`). An unrecognised version still degrades to
`EXPERIMENTAL`/read-only, so the conservative policy is unchanged.

This also corrects a claim in the previous round's live-probe report: the remote
reporting `0.0.1` is **not** evidence that it is not rc.2.

### 2. `session.search` is deployment-configurable, not a protocol guarantee

```
result.ok = false
error.code = internal
message    = session search failed: SessionQueryError: session search is disabled:
             this deployment configures the session-query index with openAt "never"
```

(`@deepseek-ai/dsh-session-query-sqlite/lib/index.js:593`.)

It is also **state-dependent**: on a brand-new `DSH_HOME` the probe succeeded,
and the same deployment then refused search once a session existed and the index
had to open for real.

Fix: search is probed as an optional capability, and `search()` additionally
degrades at call time — a `RemoteBusinessError` marks the node's search as
unavailable and returns no rows. One node with a closed index therefore
contributes zero hits instead of failing the federated search.

### 3. `host.listDirectory` / `host.createDirectory` require a `browse` picker

```
error.code = directory-picker-unavailable
message    = host.listDirectory needs the browse capability; the composed picker serves "native"
```

(`dsh-host-apiproxy/lib/index.js:3143`.) The tested deployment composes the
**native** picker, so directory browse is not served at all.

Fix: `directory.read` / `directory.write` are granted only when a live
`host.listDirectory` probe succeeds. Against this deployment both are correctly
withheld, which is exactly what the node-bound directory flow needs in order not
to offer an action the node cannot serve.

## Final live run (all assertions from real server responses)

```
probe                                : SUPPORTED, version 0.0.1, writes=true, search=true
workspace.list / session.list (empty): 0 / 0
workspace.create                     : fed1:rc2-live:w:… , path realpath-canonicalized (/var → /private/var)
workspace.rename                     : "Renamed WS"
session.create                       : ok
session.list  (after create)         : 1, every id prefixed fed1:rc2-live:
workspace.list(after create)         : 1 workspace, 1 accounted session
session.history / session.models     : schema-valid
session.rename                       : { title: "Live renamed", seq: <number> }
session.search (index closed)        : 0 rows, no error; second call also safe
directory capabilities               : read=false, write=false (native picker)
session.fork                         : RemoteBusinessError (no completed turn to fork)
session.cancel                       : ok
session.updateQueue (unknown item)   : RemoteBusinessError
workspace.archiveSession             : ok
workspace.delete                     : ok
allowlist excludes forbidden methods : true
```

Notes on the two `RemoteBusinessError` results: both are correct remote
refusals for the fixture state (`session.fork` needs a completed turn;
`updateQueue` referenced a non-existent queue item). They are surfaced as
remote-business errors, distinct from transport/protocol faults — which is the
classification the spec requires.

## Incidental confirmations

- rc.2 composes its `/api` routes **after** the TCP port opens; a probe issued
  between those two moments gets `404` and then a non-JSON body. Federation
  already treats that as `Protocol`, and readiness must be judged by a real
  `host.describe`, not by a successful TCP connect. This reinforces the
  no-false-ready rule in the approved design.
- `workspace.create` returns the host's realpath-canonical path, so a caller
  must not assume its requested string comes back verbatim.

## What this run does not cover

Still requires real infrastructure and remains open (tasks 10.1–10.3):
multi-node collisions across three simultaneous live nodes, remote
subscription-backed prompt/stream/tool/approval, and central-restart recovery
against multiple live nodes. `session.prompt` was deliberately not driven here,
since it would consume a real model subscription.
