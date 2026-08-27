# Rc2WorkspaceNodeSection injection and isolation contract

## Required identity and composition inputs

Each mounted section is created by the federated Node shell with one immutable Node identity. The shell must derive and keep these distinct values:

| Input | Contract |
| --- | --- |
| React `key` | stable opaque `nodeId`; remount only when the logical Node is removed/re-added |
| `nodeKey` | same stable opaque Node identity; used as a DOM diagnostic attribute, never a display name/path |
| view-store scope key | `fed1-node:<nodeId>`; creates `dsh.workspace.view.v5.fed1-node:<nodeId>` persistence, never the root official key |
| `overlayNamespace` | CSS-safe opaque derivative (for example base64url/hex of nodeId), unique among mounted Nodes |
| `useSessions` | node-filtered selector hook over a snapshot containing only this Node's federated session ids |
| `useWorkspaces` | node-filtered selector hook over only this Node's Workspace projection and archive set |
| action callbacks | node-bound wrappers that reject identities outside this Node before Adapter/RPC invocation |
| `home` | this Node's Host-reported home; display abbreviation only |
| `now` | one shell render instant shared by all mounted Node sections for deterministic relative times |
| `groupBy` / `orderBy` | global Node-shell controls intentionally shared as values, not as mutable section stores |

`nodeKey`, store scope, and `overlayNamespace` must not contain hostname, SSH alias, display name, path, native Workspace id, or native Session id.

## Node-filtered current session

The one federated SessionRuntime owns a union-global `current` id. For each Node section the bridge builds a snapshot where:

```text
current = globalCurrent if decode(globalCurrent).nodeId == thisNodeId
current = undefined otherwise
```

The bridge also filters `ids`, `byId`, `subagentsByParent`, `jobsBySession`, Workspace membership, and archived ids to the same Node. It must not merely clear `current` on an otherwise global list: same-native-id fixtures and descendant projections would still leak. A malformed or unknown federated current id yields no selected Node section and is reported by the bridge; it never becomes a local native id.

Consequences:

- exactly one section can render `aria-selected=true` for the union-global current session;
- only its owning section can show/promote a current blank session;
- a remote blank does not become visible in another Node's Ungrouped group;
- subagent status and completed markers cannot cross node identity collisions.

## Store and local state isolation

`createWorkspaceViewStore().create('fed1-node:<nodeId>')` creates one store instance per Node. The resulting `useStore` and `actions` passed to the section must come from that exact instance. Expansion, manual order, updated-order observations, flat order and show-more remain isolated.

Component-local state is isolated by the stable React key:

- expanded-session-overflow (`show more`);
- workspace/session drag markers;
- row menu open state;
- workspace/session rename dialog state;
- workspace delete dialog state;
- composition and pending/error states.

The shell must never recycle a Node section key for a different Node.

## Portal/dialog ownership

rc.2 `Menu` and `Modal` portal into `document.body`. Every patched NodeSection menu and dialog carries:

```text
dsh-federation-node-overlay-<overlayNamespace>
```

The Node shell owns an overlay coordinator keyed by `nodeId`/namespace. It may allow only one active Node overlay at a time; opening another first dismisses the previous owner. Escape/outside dismissal remains the official primitive behavior. The coordinator and tests address portals only through the namespace class and accessible role/name, never by global row text alone.

This seam is deliberately smaller than injecting a new portal implementation, preserving rc.2 focus, mask, menu placement and ARIA behavior.

## Drag ownership

`SessionTree` and `FlatList` retain local drag state and official same-group reorder semantics. The Node shell owns a process-in-document drag coordinator:

```text
{ nodeId, kind: 'workspace' | 'session', workspaceId?, objectId }
```

Action wrappers and drop markers require coordinator ownership by the section's node. Other Node sections receive drag-disabled callbacks while one origin is active. NodeSection remains responsible for same-Workspace session checks; the shell/adapter repeats all Node and Workspace ownership checks before an RPC. Cross-node and cross-Workspace drops show no marker and send no action.

The patched section's local document drag listeners accept only drags whose callbacks were enabled by that coordinator. Directory flow is not inside NodeSection at all; it is owned by the Node-aware Picker/shell and namespaced separately with the same stable node identity.

## Action surface

The exact official subtree action surface is:

- `startSession(workspaceId?)`
- `open(sessionId)`
- `renameSession(sessionId,title)`
- `forkSession(sessionId)`
- `archiveSession(sessionId)`
- `renameWorkspace(workspaceId,title)`
- `deleteWorkspace(workspaceId)`
- `insertWorkspaceBefore(workspaceId,beforeWorkspaceId?)`
- `insertSessionBefore(workspaceId,sessionId,beforeSessionId?)`

Every id-bearing argument must decode to the mounted Node. `startSession(undefined)` is disabled in a per-Node section; callers always bind an explicit Workspace, except the Node's own Ungrouped action whose policy remains node-bound. No `createWorkspace`, directory flow, search, model, Settings, credentials, file open, or generic remote execution action is present in this component API.

## Test obligations

Task 1.6 must mount at least two sections simultaneously and prove:

1. store expansion/order changes remain per Node;
2. show-more state remains per Node;
3. selected/current blank appears only in the owning Node;
4. menu and Modal portals carry the correct namespace and dismiss independently/coordinated;
5. drag markers and action spies never cross Node or Workspace;
6. colliding native ids remain distinct after federation encoding;
7. one Node's directory controller is absent from this section and cannot be invoked through it.
