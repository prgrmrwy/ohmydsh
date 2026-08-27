# M0 three-node collision and event fixture report

## Result

Task 1.12: **PASS**.

The fixture is a pure domain prototype: it imports no Cordis, React, filesystem, HTTP/WebSocket, OpenSSH or DSH wire types.

## Fixture topology

```text
This Mac (nodeId local) ─┐
VM A     (nodeId vm-a)  ├─ native workspaceId = workspace-collision
VM B     (nodeId vm-b)  ┘  native sessionId   = native-collision
```

Every node intentionally exposes the same native IDs.

## Executable evidence

`tests/federation-three-node.test.mjs` proves:

1. all three colliding native workspaces and sessions remain simultaneously present under distinct reversible `fed1` IDs;
2. workspace membership is rewritten to the owning node's federated session ID;
3. decoding enforces version, known node and object kind; bare/malformed/unknown/wrong-kind IDs fail closed;
4. three commands targeting the same native session ID reach exactly their encoded owner and pass only the decoded native ID to that node;
5. mux and host frames recursively rewrite session, parent/child, workspace, membership and archived IDs with source node ownership;
6. colliding mux and host identities remain distinct across all three nodes;
7. after VM A opens a new generation, both late mux and host frames from its old generation are rejected;
8. the current VM A generation and independent VM B generation continue accepting frames.

This M0 prototype proves the identity/router/generation seam. Full baseline buffering, `seq`/`asOfSeq` reconciliation, tombstones and authoritative refresh remain M1 tasks 3.7 and 5.8.
