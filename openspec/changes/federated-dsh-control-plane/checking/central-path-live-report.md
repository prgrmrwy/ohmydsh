# Full central request path, composed end to end

Automated as `tests/federation-central-path-live.test.mjs`.

## Gap this closes

Every link in the central path had its own test, but they had never been
**composed**. `CentralUplink` was only exercised against mock `DshNodePort`
objects, and the Connection fence test never wired the uplink in at all. So no
test proved that a federated id entering the real `/api` route actually reaches
the correct real remote server.

This test assembles the whole chain once:

```
HTTP client
  → patched rc.2 Connection /api route (real Host/Origin fence)
    → federation outer middleware (sole /api seam)
      → CentralUplink (identity → owner → capability)
        → CommandRouter → DshRc2NodeAdapter → HttpUnaryCarrier
          → real `dsh web`  (local: in-process · remote: real SSH tunnel)
```

Two real `dsh web` servers run with independent `DSH_HOME`s; the remote one is
reachable **only** through a real system-OpenSSH `-L` tunnel served by a real
`sshd`.

## Cases verified

| # | Case | Result |
| --- | --- | --- |
| 1 | federated **remote** id → `session.rename` | routed to federation; the write is confirmed **on the remote's own server**, and This Mac is untouched |
| 2 | bare **native** id → `session.rename` | falls through to the local composed handler; the local server applies it |
| 3 | forged id `fed1:ghost:s:…` | rejected `federation-id-unknown-node`; the native fallback is never called |
| 4 | cross-node workspace anchor | rejected `federation-capability-denied` |
| 5 | cross-site request carrying a valid federated id | **403** at the fence; the remote is verified unmutated afterwards |

Case 1 is the one no previous test could make: the assertion is read back from
the remote server directly, not from the central response.

## A fixture artifact I first mistook for a defect

The forged-id case initially threw `FederatedIdError` out of `CentralUplink`
instead of being classified, because `handle()` uses `instanceof`. The cause was
my fixture: it bundled `src/host` and `src/core` **separately**, producing two
copies of the error classes.

Rather than weaken the production code, I checked the deployed build:

- `lib/host/central/uplink.js` imports `{ FederatedIdError, RoutingError }` from
  `../../core/index.js` — a relative path, so there is exactly one instance;
- loading the deployed artifact confirms
  `lib.FederatedIdError === lib/core.FederatedIdError` → `true` (same for
  `RoutingError`);
- driving the **deployed** uplink with a forged id returns
  `{"kind":"error","status":400,"code":"federation-id-unknown-node"}`.

So `instanceof` classification is correct in production, and the fixture now
bundles one entry that re-exports both surfaces, exactly as `lib/index.js` does.
No specification or source change was required.

## Mutation checks

| Mutation in `src/host/central/uplink.ts` | Test result |
| --- | --- |
| treat a federated `session.rename` id as local (`local-passthrough`) | **failed** ✓ |
| swallow unknown-node rejection into `local-passthrough` | **failed** ✓ |

The second mutation is the dangerous one — it would silently interpret another
node's id against This Mac. Source restored and verified clean.

## Verification

`npm test` → **90 passed, 0 failed**; `dsh-federation` package → **117 passed**;
typecheck clean. Nothing touches `~/.dsh`; `dsh.yaml` keeps
`dsh-federation: enabled: false`.
