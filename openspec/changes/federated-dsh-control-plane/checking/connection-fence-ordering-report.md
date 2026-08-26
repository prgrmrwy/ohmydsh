# Trust-fence ordering for the federation `/api` seam

Automated as `tests/federation-connection-fence.test.mjs`. Closes a gap in the
existing Connection compat coverage: that test drives `handleApiRequest` through
a hand-built service object, which cannot show *where* the federation middleware
sits relative to the Host/Origin fence. That ordering is the security property.

## What the fence actually is

In the pinned rc.2 source, the physical `/api` prefix route rejects untrusted
requests **before** the request ever reaches the composed handler:

```ts
handler: async (req, res) => {
  if (!isTrustedApiRequest(req, trustedHosts)) {
    res.writeHead(403); res.end('forbidden'); return
  }
  await bridge(req, res, fetchHandler, maxRequestBodyBytes)
}
```

The compatibility patch replaces only `fetchHandler`, wrapping the composed
handler as `connection.handleApiRequest(request, apiHandler)`. So the federation
middleware runs strictly inside the fence: after Host/Origin rejection, before
the unmodified `Typert interceptor → privileged fence → ApiProxy fallback`
chain.

## How this test proves it

It runs the patched module's **real `apply()`** on a **real Cordis `Context`**
(only `webServer` is stubbed, to capture the registered route), then serves that
route over a **real `http.createServer`** so `bridge()` receives a genuine
`IncomingMessage`/`ServerResponse` pair.

| Case | Expected | Observed |
| --- | --- | --- |
| cross-site request carrying `fed1:` id | 403, middleware never invoked | 403, `seen == []` |
| same-origin request carrying `fed1:` id | reaches federation | 209, `seen == ['/api/future/identity']` |
| after the owning fiber is disposed | native path restored, fence intact | 403, `seen == []` |
| second concurrent middleware | refused | `already has an outer middleware` |
| after disposal, re-claim | allowed | succeeds |

## Detection power (the important part)

A passing assertion is worthless unless a real bypass fails it. Verified in two
layers:

1. **Source tampering is impossible to build.** Removing the fence from the
   fetched rc.2 source and rebuilding fails closed:
   `[connection-compat] ERROR connection source src/index.ts Git blob mismatch`.
   No artifact is produced.
2. **The assertion itself detects a bypass.** Removing the fence from an
   already-built bundle (a post-verification artifact, used only to test the
   test) and re-running the same scenario yields:
   `status 209 | middleware saw ["/api/future/identity"]` — i.e. federation
   observes untrusted cross-site traffic. That is precisely what case 1 above
   asserts against, so the test genuinely detects the regression.

All scratch artifacts were deleted; `scripts/build-rc2-connection-compat.mjs`
was verified byte-identical afterwards.

## Ownership model clarified (investigation record)

While writing this test, calling `ctx.connection.api.use(...)` from the **root**
context appeared to leak the middleware slot: neither the returned disposer nor
`fiber.dispose()` released it. Investigation showed the patch is **correct** and
the probe was wrong.

`registerApiMiddleware(owner, …)` uses `owner.effect(...)`, and the `api` getter
binds `owner = this.ctx` — the *accessing* context, mirroring how
`rpc.intercept` is scoped. Reading the service from the root context therefore
ties cleanup to the service's own lifetime, which never ends in a test.
Registering through `ctx.inject(['connection'], child => child.connection.api.use(…))`
releases the slot as soon as that fiber is disposed, which is the intended
plugin ownership model and is what the test now exercises.

No specification or patch change was required.

## Verification

`npm test` → **86 passed, 0 failed**. Nothing touches `~/.dsh`; `dsh.yaml` keeps
`dsh-federation: enabled: false`.
