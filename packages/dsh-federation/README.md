# dsh-federation

Federated DSH is a central control plane for independent ordinary `dsh web` nodes. Its target hierarchy is `Node → Workspace → Session`; execution, files, Git state, subscriptions, models, tools, credentials, workspaces and sessions stay on their owning node.

The package is under active OpenSpec implementation and acceptance in `federated-dsh-control-plane`. Its manifest entry remains `enabled: false` until the module, integration and real-node gates pass. When enabled, its build also produces a fixed-source rc.2 Connection compatibility artifact; sync installs that artifact under the official Connection package identity in the same profile transaction as this bundle, and removes both on rollback.

## Safety boundary

- System OpenSSH aliases and loopback forwards only; no embedded SSH client or stored key material.
- No remote DSH installation, start, stop or settings/credential proxy.
- No path mapping, file synchronization, automatic download or remote `openPath`.
- No automatic replay after an uncertain write outcome.
- Fixed-source rc.2 Workspace and Connection compatibility patches fail closed on input/output hash mismatch.

## Development

From the repository root:

```bash
npm install
npm run typecheck --workspace dsh-federation
npm test --workspace dsh-federation
npm run build --workspace dsh-federation
```

`lib/` is generated and must not be committed.
