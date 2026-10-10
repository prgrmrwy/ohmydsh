# dsh-cockpit-memex-browse-shim

English · [简体中文](README.zh.md)

<!-- problem -->
When dsh-memex runs on another machine, its "open cards" button would point your browser at a `localhost` address that is not the memex host. This shim makes the button use the port forward that dsh-cockpit publishes, so the card browser opens at an address that really reaches the device.

The only deployment-side coupling point: it registers the bridge's port forwarding into memex's generic browse-address extension. The sources and dependencies of the two ends never reference each other; removing the shim decouples them.

## 0.2.0 behaviour and prerequisites

- Requires the bridge to provide `cockpitBridge.forwards` (the production deployment pins 0.6.4). The old `portForward` / channel register / publish contracts are no longer supported.
- No top-level `inject`; each service is read once with a full dotted name through `ctx.get()`, so any load order of the two ends works.
- It uses `acquire(devicePort, holder)`, single-flight per port; the holder carries a random binding id so that a late release from an old binding cannot affect its replacement.
- starting/retrying/paused states wait for ready through `onChange`, for at most 15 seconds. Only the current `handle.address.url` is delivered; no URL is cached and the shim does not retry by itself. After opening, the holder is kept so the tunnel is not reclaimed right after the tab opens.
- removed rejects the current wait and is not re-acquired automatically. The next explicit open can acquire again, including when the handle was deleted between two clicks.
- Only a structured `CockpitForwardsError` with `code === 'local-device'` falls back to `http://localhost:<port>`. unavailable (no handshake / not inside the cockpit iframe) cannot prove that the browser and the device are on the same machine, so like network or business failures it is rethrown unchanged; the user can still use the known device address directly.
- A memex-only deployment that never discovered a bridge keeps the default local behaviour. If a bridge was discovered and is later unloaded or replaced, pending waits are cancelled and the old handle is released; while the bridge is gone, a fail-closed resolver stays in place so that a remote address never silently falls back to the browser's localhost.
- The resolver is unregistered when the memex side is unloaded or the shim is disposed. Release includes late acquires and failures are handled; the bridge's page-instance reclamation is the final safety net.

## Verification

Independent package test/typecheck/build. The integration regression uses memex's real registry (which returns localhost when nothing is wired) rather than a fake registry that would hide mis-routing. It covers ready waiting, concurrency, address changes, removal, failure classification and the service lifecycle.

## Removal

<!-- section: removal -->
This shim connects two ends: the **`cockpitBridge.forwards` port-forwarding service** of `dsh-cockpit-bridge` and the **`dshMemex.browseAddress` registry** of `dsh-memex`. Their sources and dependencies do not reference each other; the shim is the only place they meet.

Remove it when you no longer open memex cards across machines through dsh-cockpit, or when either end ships the integration natively: delete the manifest entry → `dsh build` → restart; neither end needs any migration. Rolling back to an older shim must also roll the bridge back to a version that provides the old service; never mix the 0.1.1 shim with bridge 0.6.x.
