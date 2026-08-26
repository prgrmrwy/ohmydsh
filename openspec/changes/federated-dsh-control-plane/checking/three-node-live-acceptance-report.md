# Three-node live acceptance (tasks 10.1, 10.3 partial)

Automated as `tests/federation-three-node-live.test.mjs`, run on real
infrastructure. Nothing touches `~/.dsh`; no deployment runs; the manifest entry
stays `enabled: false`.

## Infrastructure actually used

| Element | Real or simulated |
| --- | --- |
| DSH servers | **3 real** `dsh web` processes (pinned `@deepseek-ai/dsh@0.1.1-rc.2`) |
| Per-node state | **3 isolated** `DSH_HOME` directories + 3 separate project cwds |
| Remote reachability | **real system OpenSSH** `-L` loopback forwards through a **real `sshd`** |
| SSH configuration | real `ssh -F <config>` aliases, publickey-only, `StrictHostKeyChecking yes` |
| Federation code | real Core (`NodeRegistryModel`, `aggregateProjection`, `CommandRouter`) + real `DshRc2NodeAdapter` + real `HttpUnaryCarrier` |

Two of the three nodes are reachable **only** through their SSH tunnel; the
local node speaks to its own server directly. This is the strongest available
substitute for separate physical machines: separate processes, separate DSH
homes, separate registries, separate session stores, real transport.

## Deliberate native-id collision

Each node independently received a workspace titled `shared-workspace` and a
session titled `shared-session`, created against its own project directory.
Native workspace/session ids are host-generated UUIDs per node, and the
*display* identity is intentionally identical across all three.

Verified:

- 3 nodes → 3 workspaces → 3 sessions in the aggregate projection, with no
  merging or overwrite;
- all three workspace titles are the single colliding string, yet every
  federated id decodes back to its own owning node;
- each node owns exactly one workspace, whose single session id carries that
  node's prefix (`fed1:<node>:s:`);
- `Node → Workspace → Session` ownership holds independently on every node.

## Owner-only routing under collision

For each of the three nodes, one `renameSession` was routed through the real
`CommandRouter` using that node's federated id, with a node-unique title.
Each live server was then queried independently: every server showed **only its
own** rename. A command therefore reaches exactly the encoded owner even when
all three nodes carry identical titles.

Cross-node workspace reorder was refused by the router **before any RPC**
(`CAPABILITY_DENIED: cross-node workspace reorder is forbidden`), thrown
synchronously rather than attempted and rolled back.

## Remote lifecycle through the tunnel (task 10.3)

Executed against a remote node reachable only via SSH:

- `workspace.create` on a real subdirectory → federated id owned by that node;
- same-node `workspace.insertBefore` → asserted as an **exact swap** of the two
  workspaces, so the check cannot pass on a no-op;
- `session.create` → `session.rename` → visible in that node's own list;
- `session.fork` → `RemoteBusinessError` (correct: no completed turn to fork);
- `workspace.archiveSession` → reflected in the remote workspace account;
- `workspace.delete` → back to one workspace.

## Fault isolation, remote survival, reconnect

Killing one tunnel with `SIGKILL`:

- the local node stayed fully usable;
- the **other** remote node was unaffected;
- the victim node's calls failed (correctly, as transport loss);
- the victim's `dsh web` process **stayed alive**, confirmed both by
  `exitCode === null` and by an independent `ps -p <pid>` check — the central
  side owns only its own `ssh` child and never stops remote DSH;
- opening a **new** tunnel recovered the victim's durable state (its
  node-unique session title was still present, every recovered session still
  owned by that node), with the remote never restarted.

## Mutation checks (does the test have teeth?)

The suite was re-run against two deliberate source mutations, then the sources
were restored and re-verified:

| Mutation | Result |
| --- | --- |
| removed the cross-node reorder guard in `core/router.ts` | **test failed** |
| made `core/id.ts` decode to an arbitrary known node instead of the encoded owner | **test failed** (`must show only its own rename`) |

So the collision/ownership proof detects real regressions rather than merely
executing the code path.

## Scope

Proven here: tasks **10.1** in full, and the workspace/session lifecycle plus
cross-node-drag prohibition parts of **10.3**.

Still open and *not* claimed:

- **10.2 (partial)** — the disconnect/recovery half is now proven by
  `tests/federation-disconnect-recovery.test.mjs`; see the section below. The
  model-consuming half (real prompt/stream/tool/approval/model-switch against a
  remote's own subscription) is still **not** driven: it spends a paid
  subscription and needs an operator-owned credential on the remote.
- **10.3 remainder** — now closed by
  `tests/federation-remote-directory-flow.test.mjs`; see the section below.
- **10.6–10.8** — enabling, deployed-GUI acceptance and final sign-off, which
  require the operator's decision to switch `dsh.yaml` to `enabled: true`.


## Remote in-app directory flow (task 10.3 remainder)

The default macOS deployment composes the **native** picker, so
`host.listDirectory` is not served there. rc.2's `directory-picker-auto`
resolves to **browse** whenever the host looks SSH-reached
(`SSH_CONNECTION` / `SSH_TTY` present) — precisely the shape of a federated
remote node. `tests/federation-remote-directory-flow.test.mjs` therefore starts
a real `dsh web` presenting as SSH-reached and drives the real
`NodeDirectoryFlow` against it:

- the probe grants `directory.read` + `directory.write` and reports
  `directory browse available`, whereas the native-picker deployment correctly
  gets neither;
- `usesNativeChooser === false` for a remote node — it uses the in-app flow;
- a real remote directory level lists with host-provided breadcrumbs;
- hidden directories arrive in the payload and are filtered by the flow's own
  show-hidden toggle;
- single-level creation succeeds and the flow navigates into the created child;
- a multi-segment name (`a/b`) is refused **without any remote call**;
- the browsed remote directory registers as a real workspace owned by that node;
- every recorded directory request carried its explicit node id.

Mutation check: removing the single-segment guard in
`client/shell/directory-flow.ts` makes this test fail, so the guard is genuinely
covered.


## Central disconnect, remote independence, generation-safe recovery (task 10.2, partial)

`tests/federation-disconnect-recovery.test.mjs` drives a real `dsh web` through
a full disconnect/reconnect cycle:

- moving the central generation forward makes the old carrier refuse to talk
  (`StaleGeneration`) rather than silently continuing;
- the remote Host process is untouched by the central disconnect, verified by
  both `exitCode === null` and an independent `ps -p <pid>`;
- work the remote commits **while the central side is away** (a session created
  and renamed by a direct client, as the remote's own operator would) is present
  after reconnect;
- reconnect installs a **new** generation, and a late frame carrying the old
  generation is rejected (`accept() === false`) instead of being applied;
- a write that was in flight at disconnect stays `OUTCOME_UNKNOWN` and never
  enters `replayable()` — before or after recovery. Reconnecting proves nothing
  about whether it executed, which is exactly the approved semantics.

What this does **not** cover: a real model turn. Prompt, streaming, tool calls,
approval/question round-trips and model switching would consume the remote's own
paid subscription, so they remain operator-driven work.
