# Federated DSH control plane — M0 feasibility gate

## Gate decision

**PASS. M1 implementation may begin.**

All thirteen M0 tasks have executable or fixed-source evidence. The one initially unsupported seam—generic pre-fallback `fed1:` denial while preserving rc.2 Typert-first composition—was paused, reviewed with the user, amended in OpenSpec, and proven using a three-file fixed-source Connection compatibility patch.

No production package, `dsh.yaml` federation entry, real GUI build, DSH restart or replacement server was introduced during M0.

## Evidence matrix

| Seam | Result | Primary evidence |
| --- | --- | --- |
| rc.2 protocol/call graph | PASS | `rc2-route-call-graph.md`, protocol inventories and synthetic frames |
| Reproducible upstream source | PASS | fixed commit/tree/blob manifests, content-addressed fetchers, offline-cache tests |
| Official Workspace subtree extraction | PASS | `workspace-node-section-patch-report.md`, fixed patch/output hashes |
| NodeSection injection and isolation | PASS | `node-section-injection-contract.md`, two-instance JSDOM test |
| Official single-node behavior differential | PASS | `node-section-differential-report.md` |
| Slot runtime limitation/full-browser exclusion | PASS | `slot-runtime-entry-finding.md`, executable source guards |
| Complete route identity inventory | PASS | ApiProxy + 26 Typert endpoints + direct export inventory |
| Generic pre-fallback deny seam | PASS | three-file Connection patch inside physical route trust fence; Typert-first/no-fallback tests |
| Route transaction rollback | PASS | conflict injected at every registration position; strict reverse disposal |
| Host/client activation split | PASS | two tabs, late tab, refresh, readiness failure and entry-crash isolation |
| System OpenSSH | PASS | real unprivileged loopback sshd, alias/BatchMode/host-key/ProxyJump/forward/cleanup tests |
| Three-node collision isolation | PASS | identical native workspace/session IDs, dual streams, owner routing and generation rejection |

## Approved rc.2 compatibility amendments

### Workspace Embed

The fixed-source Workspace patch exports `Rc2WorkspaceNodeSection` and makes official `WorkspaceBrowser` consume the same extracted implementation. It does not export or duplicate the full Browser shell.

### Connection outer middleware

The fixed-source Connection patch changes only:

- `src/index.ts`;
- `src/rpc.ts`;
- `src/rpc-host.ts`.

`createSharedFetchHandler()` remains unchanged. The real physical `/api` route performs its original Host/Origin/sec-fetch trust check, then invokes the optional singleton middleware around the already composed Typert-first handler. Source, patch and outputs are hash-pinned, built in staging, and preserve last-known-good output on mismatch.

This is a trusted in-process Host extension seam. Federation must inspect request bodies through `request.clone()`, delegate native requests at most once, preserve request signal/streaming responses, and never expose or call bare ApiProxy.

## Reference-project incidents converted to constraints

The audit of `Asaiuta/dsh-session-hub` at commit `fef18684e2112c2546f6098fd8aaf6e289126b95` supplied useful incident patterns but not an implementation baseline:

- route capture must roll back on any collision;
- every `host/*` frame goes to both official Session and Workspace host sinks; mux frames go only to the mux sink;
- approval resolution correlates by `approvalId`, question resolution by `questionRpcId`;
- per-link generation prevents stale reconnect work from overwriting current state;
- workspace projection changes require host-frame delivery.

Unsafe reference patterns remain rejected: bare native-ID dedupe/first-owner routing, fixed 17-route inventory, unknown ID to local fallback, direct bare ApiProxy dispatch, server-as-workspace flattening, baseline-before-subscribe, `ssh2`, credential synchronization, and raw frame forwarding without federated ID rewriting.

## Verification snapshot

Actual commands run after the final M0 patch narrowing:

```text
npm test
  72 tests, 72 passed, 0 failed

openspec validate federated-dsh-control-plane --type change --strict --no-interactive
  valid

npm run check:artifacts
  tracked paths comply
```

## M1 entry conditions

M1 may create the disabled/headless package and stable Core, but must preserve these gate facts:

1. Core imports no Cordis, React, fs, HTTP/WS, OpenSSH or DSH wire types.
2. Both fixed-source compatibility builds fail before replacing a deployed last-known-good package.
3. Host READY commits only after the middleware/route ledger and dependencies succeed.
4. Every client independently commits both federation slots or falls back to both official entries.
5. Any valid, malformed, wrong-kind, unknown-node or unclassified `fed1:` carrier is routed or rejected before native fallback.
6. No uncertain write is automatically replayed.
7. Remote DSH, paths, subscriptions, credentials, workspaces, sessions and tools remain node-owned.
