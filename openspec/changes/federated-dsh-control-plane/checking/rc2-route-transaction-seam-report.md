# M0 rc.2 route transaction and pre-fallback seam report

## Result

Task 1.9: **PASS** with the user-approved fixed-source Connection compatibility seam.

No GUI or DSH server was started. Inventory extraction, patch build, route composition, transaction rollback and deny-by-default tests run headlessly.

## Selected assembly inventory

An isolated temporary `DSH_HOME` default web profile was dumped with updates disabled and the runtime pinned to `0.1.1-rc.2`. The checked-in inventories cover:

- every identity-bearing ApiProxy method, including `subagent.*`, `agentPreset.select` and `goal.*`;
- all 26 selected generated Typert endpoints, of which 21 carry `agentId` or nested `request.sessionId`;
- direct GET/HEAD `/api/session.export?sessionId=...`;
- `/api/events.mux` and `/api/events.host` ownership, which remains unchanged.

This inventory is selected-assembly-specific. A changed profile/plugin composition must regenerate and diff it before activation.

## Why exact routes alone were insufficient

The original rc.2 public composition exposes no supported generic pre-fallback seam:

- `TypertGatewayService` owns the sole `/api` interceptor;
- a second interceptor fails;
- known exact routes shadow the physical `/api` prefix, but unknown future endpoints still select that prefix;
- a second `/api` prefix fails;
- delegating to bare `ctx.apiProxy` bypasses Typert.

An exhaustive known exact-route set can protect the audited routes but cannot prove the normative statement that any unclassified future request containing `fed1:` is rejected before local fallback.

## Approved compatibility seam

`upstream/rc2-connection-api-middleware.patch` modifies only three pinned Connection source files:

- `src/rpc.ts`: public `ConnectionApiMiddleware`, minimal Fetch handler, and `HostConnectionApi.use()` contracts;
- `src/rpc-host.ts`: one scoped middleware owner plus a package-internal dispatcher around a caller-supplied composed handler;
- `src/index.ts`: type exports.

The effective order is:

```text
physical /api WebServer route
  -> original Host/Origin trust fence
  -> federation outer middleware (zero or one owner)
       -> valid federation request: route remotely
       -> malformed/unknown/unclassified fed1: reject
       -> native request: next.fetch(request)
            -> original Typert interceptor when claimed
            -> original privileged loopback fence / ApiProxy fallback otherwise
```

The patch does not modify the trust-fence, bridge, websocket or ApiProxy files. `createSharedFetchHandler()` remains byte-for-byte unchanged; only the physical `/api` route wraps its result after the existing trust check. The patch does not copy Typert dispatch and never exposes bare ApiProxy as federation's native delegate.

## Fixed-source build contract

`upstream/rc2-connection-source-manifest.json` pins:

- upstream commit/tree and DSH version;
- every selected source Git blob and size;
- deterministic archive SHA-256;
- patch SHA-256;
- output Git blobs, SHA-256 values and sizes;
- upstream MIT license identity.

`scripts/fetch-rc2-connection-source.mjs` provides fixed-commit bootstrap plus content-addressed offline cache. `scripts/build-rc2-connection-compat.mjs` validates source and patch, applies in staging, validates every output, and replaces the destination atomically. A source mismatch leaves an existing last-known-good output unchanged.

## Executable evidence

`tests/federation-connection-compat.test.mjs` proves:

1. fixed source/patch/output identities and the three-file patch boundary;
2. offline cache miss fails closed;
3. the patched runtime invokes outer middleware before Typert and preserves Typert-before-fallback native semantics;
4. an unknown request containing `fed1:` never calls native fallback;
5. a second middleware owner conflicts;
6. disposal restores the original composed handler;
7. source mismatch preserves last-known-good output.

`tests/federation-route-gate.test.mjs` proves:

1. complete selected identity route membership;
2. route registration conflict at every position restores the exact baseline registry;
3. prior registrations dispose in strict reverse order;
4. known and unknown JSON `fed1:` carriers never call native fallback;
5. decoded GET/HEAD export query carriers route before fallback;
6. native unknown requests delegate exactly once.

The M0 transaction prototype treats outer middleware ownership and all necessary exact ownership steps as one activation ledger; production task 6.6 will reuse the same strict reverse rollback rule and commit `HOST_READY` only after the complete ledger succeeds.
