# Verification record (task 10.5)

All commands below were executed in this repository; the reported numbers are
actual tool output, not estimates.

## Commands and results

| Command | Result |
| --- | --- |
| `npm run typecheck --workspace dsh-federation` | pass (host+core `tsconfig.json`, client `tsconfig.client.json`, `strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`) |
| `npm test --workspace dsh-federation` | **135 passed** across 17 files |
| `npm test` (repository root) | **99 passed**, 0 failed |
| `npm run check:artifacts` | tracked-artifact policy pass + federation fixture privacy pass |
| `npm run build --workspace dsh-federation` | pass; second consecutive run reused the verified embed (`workspace embed reused <sha256>`) |
| `openspec validate "federated-dsh-control-plane" --type change --strict --no-interactive` | `Change 'federated-dsh-control-plane' is valid` |

## Package test files

| File | Tests | Covers |
| --- | --- | --- |
| `boundaries.test.ts` | 1 | Stable Core imports no Cordis/React/fs/HTTP/WS/SSH/DSH-wire package |
| `id.test.ts` | 4 | `fed1` codec: Unicode round-trip, malformed/version/kind/node/bounds, rename stability, collisions |
| `registry-projection.test.ts` | 5 | immutable registry model, generation, ordering, node-owned projections |
| `router-reconciliation-ledger.test.ts` | 7 | ownership/capability routing, generation windows, higher-seq-wins, delivery ledger |
| `registry-storage.test.ts` | 6 | missing/symlink/mode/truncated/unknown-version, serialized CAS, pre-rename interruption, owned-temp cleanup |
| `ssh-manager.test.ts` | 11 | BatchMode identity probe with no remote command, strict argv, bind-collision retry, readiness gating, redacted diagnostics, catchable shutdown, per-node backoff |
| `carrier.test.ts` | 6 | loopback-only unary carrier, timeout/abort/body-limit/protocol errors, dual-stream lifecycle, bounded queue, stale-generation drop |
| `rc2-adapter.test.ts` | 11 | structural capability gating for every rc.2-advertised version, optional search/browse capabilities, call-time search downgrade, official request/response shapes, per-method validators, frame conversion, method allowlist |
| `central-adapter.test.ts` | 14 | in-process local transport, central runtime view, frame rewriting, uplink routing/denials, activation transaction |
| `client-activation.test.ts` | 6 | per-client slot shadowing, host-not-ready refusal, cross-client independence, timeout, entry crash, partial-registration rollback |
| `node-shell.test.ts` | 14 | node rows/status/aggregates, node-scoped action binding, drag scope, search coordinator, node-bound directory flow |
| `node-shell-view.test.ts` | 6 | flat-mode node partitioning, ordering, shared view controls, hero picker with blank reuse |
| `plugin-compat.test.ts` | 8 | row-menu seam and This-Mac-only `cwd`, entry isolation, provider-icon renderer/observer exclusivity, per-node extension gating |
| `reliability.test.ts` | 15 | layered diagnostics, secret redaction, transport/dual-stream/baseline/old-frame fault injection, concurrency without locks, cross-node security, disable/restore |
| `scale.test.ts` | 3 | three nodes / 60 workspaces / 900 sessions with colliding native ids, flat partitioning, capped search |

## Root test files added by this change

- `federation-m0.test.mjs`, `federation-route-gate.test.mjs`,
  `federation-activation.test.mjs`, `federation-connection-compat.test.mjs`
- `federation-openssh.test.mjs` (real loopback OpenSSH),
  `federation-three-node.test.mjs`
- `federation-node-section.test.mjs` (two real sections + official differential)
- `federation-node-shell.test.mjs` (real shell: one official subtree per node,
  isolated stores/portals, owner-only action routing, stale skeleton)
- `federation-ui-matrix.test.mjs` (15 declared rc.2 behaviour rows)
- `federation-package-build.test.mjs`, `federation-fixture-policy.test.mjs`
- `federation-rc2-live.test.mjs` — drives the real adapter against a real
  `dsh web` under an isolated `DSH_HOME` (skips cleanly if the pinned rc.2 binary
  is absent); validates against the actual server rather than transcribed fixtures
- `federation-three-node-live.test.mjs` — **three real** `dsh web` servers with
  isolated DSH_HOMEs, two reachable only through real system-OpenSSH loopback
  tunnels via a real `sshd`, deliberately colliding native ids; proves owner-only
  routing, cross-node denial, remote lifecycle, tunnel-loss isolation and
  reconnect recovery
- `federation-remote-directory-flow.test.mjs` — real browse-serving rc.2 node
  driving the node-bound Miller-column directory flow
- `federation-disconnect-recovery.test.mjs` — central disconnect leaves the
  remote independent; reconnect is generation-safe and uncertain writes stay
  unreplayed
- `federation-registry-multiprocess.test.mjs` — two genuinely concurrent OS
  processes racing `nodes.json`: no torn file, exactly one generation increment,
  the loser fails closed with `CONFLICT`, no stale temps; identifies the
  pre-commit CAS re-check as the guard that closes the cross-process window
- `federation-central-path-live.test.mjs` — the **whole** central path composed
  once: patched Connection route → federation middleware → `CentralUplink` →
  router → adapter → two real `dsh web` servers (remote reached only over a real
  SSH tunnel); proves owner routing, native fallthrough, forged-id rejection,
  cross-node denial and the trust fence together
- `federation-artifact-load.test.mjs` — loads the artifacts `dsh build`
  actually deploys: the host entry `lib/index.js` under a real Cordis context
  (inert, full public surface, forbidden methods unreachable) and the browser
  bundle `lib/client.js` evaluated against the real ModuleLoader contract
- `federation-client-activation-live.test.mjs` — the **shipped**
  `ClientActivationController` against the **real** rc.2 `SlotCore`: priority
  shadowing, real collision rollback, real abdication, cross-client isolation,
  refresh without entry accumulation, and clean disposal
- `federation-connection-fence.test.mjs` — the patched Connection's **real
  `apply()`** on a real Cordis context, served over a real HTTP server: proves
  the federation middleware runs strictly inside the Host/Origin fence, that a
  cross-site request never reaches it, and that ownership is exclusive and
  fiber-scoped
- `federation-live-event-streams.test.mjs` — real rc.2 WebSocket mux/host
  streams through the real `DualEventCarrier`: pins the HTTP 426 SSE rejection,
  observes real frames, converts them to Core frames, and proves
  old-generation frames are dropped
- `federation-sync-rollback.test.mjs` — enable/deploy, idempotent re-sync,
  rollback on disable and re-enable, driven through the real `scripts/sync.mjs`
  and the real package in an isolated `DSH_HOME`; plus the pinned-source
  fail-closed contract

## Issues found by verification and fixed

1. **rc.2 wire-shape deviations** (found by reading pinned `.d.ts` after tests
   were green): `workspace.create`/`workspace.rename` return `{workspace}`
   wrappers; reorder uses `beforeWorkspaceId`; `/api/respond` is a
   `client-response` with a carrier receipt, not an RPC envelope; prompt `rpcId`
   belongs only in the envelope; `session.list` has no title/status/workspace
   fields (title/seq come from `projections`, ownership from `workspace.list`,
   archived from the archive set); `session.search` returns only
   `{sessionId, snippet}`. All corrected, with unknown search hits failing closed.
2. **Capability probe was not a probe**: it trusted a caller-supplied method
   list. Replaced with real `host.describe` + `workspace.list` + `session.list`
   reads plus dual-stream readiness.
3. **Reserved federation namespace leak** (found by fault injection): an id such
   as `fed2:...` fell through to local passthrough, i.e. a future federation
   version would have been read as a bare *local* native id. The whole
   `fed<N>:` namespace is now reserved and rejected on every route.
4. **Inconsistent diagnostic vocabulary**: id errors emitted
   `federation-id-unknown_node` while routing errors were kebab-case. Unified.
5. **Exact-version gate would have denied writes to every real rc.2 node**
   (found by running the adapter against a real `dsh web`): rc.2's
   `host.describe` hardcodes `version: "0.0.1"` despite documenting the
   apps/cli version, so `SUPPORTED` was unreachable in practice. `SUPPORTED` now
   rests on the structural probe; see `compatibility/rc2-live-conformance-report.md`.
6. **`session.search` and directory browse are deployment-configurable, and
   search is state-dependent**: the sqlite query index can be configured to open
   `never` (surfacing only once it must open for real), and
   `host.listDirectory` requires a `browse` picker while the tested deployment
   composes `native`. Both are now probed as optional capabilities, and search
   additionally degrades at call time so one node cannot fail a federated search.
7. **Event-stream transport was assumed, not verified**: `DualEventCarrier`
   had only run against fake sockets. A real `dsh web` rejects `GET` on both
   event paths with **HTTP 426** and serves only WebSocket upgrades, even though
   the pinned source also contains an SSE path (used in-process). The assumption
   held, but it is now pinned by a live test rather than inferred; see
   `live-event-stream-report.md`.
8. **rc.2 has no row-menu slot**: verified that rc.2 declares only
   `sidebar.workspaces` and `sidebar.workspaces.directoryFlow`, while
   `dsh-open-in-vscode@0.1.6` targets `sidebar.workspaces.row-menu` and
   otherwise DOM-scrapes. Federation now declares that hole so the plugin takes
   its supported path.

## Host entry wiring correction

`checking/host-entry-wiring-report.md` records that both plugin `apply()`
functions were inert stubs while tasks 6.6–6.8/7.x were marked complete. The host
entry is now genuinely wired (conservative activation, real `/api` middleware
seam, verified by `tests/federation-host-entry-wiring.test.mjs`), and task **6.8
was un-marked**. The browser entry is now wired too and verified against the real
rc.2 `SlotCore`, but it remains incomplete on purpose: the
`FederationClientBridge` it needs has **no implementation**, and DSH loads plugins
from YAML so a function cannot be injected — a real deployment therefore still
renders the official UI. See `checking/client-entry-wiring-report.md`.

Round 17 implemented the bridge itself (`FederationBridge` plus a default bridge
built inside `apply()` from the generic Connection channel) and fixed a real
ordering defect: activation ran once against a still-refreshing bridge and
permanently missed the readiness window; it now retries with a bound. Round 18 completed task 6.8: `NodeProjectionRuntime` gives每 remote node its own
browser projection (cross-node isolation proven with identical native ids,
higher-seq-wins titles, offline read-only skeleton), remote bindings read that
projection and write through the central uplink, baselines are hydrated per node,
and the hero slot now renders the real `FederatedHeroPicker` instead of a sidebar
placeholder. Note: task 7.6 had been marked complete earlier while the hero was
still a placeholder — that overstatement is now annotated in `tasks.md`.
See `checking/client-bridge-report.md`.

Round 20 fixed a **real lost-update defect** in the node registry. Adding
`npm run test:tap` (which preserves failing case names, unlike the default
summary) located the low-frequency flake reported since round 17: two concurrent
processes both committed generation 1. The cause was a TOCTOU window between the
pre-commit CAS re-check and `rename`, which no same-process check can close. A
cross-process `O_EXCL` commit lock now wraps re-check + rename + fsync.
Controlled evidence: removing the lock fails 3/12 race runs, keeping it fails
0/12. The round 13 claim that the pre-commit re-check "closes the cross-process
window" was therefore wrong and is now annotated as superseded in
`checking/registry-multiprocess-report.md`.

Round 19 closed the browser↔Host loop by implementing the two federation
inventory endpoints the browser depends on (`federation/nodes`,
`federation/baseline`) and found two further real defects while doing so: the
middleware did not echo `rpcId`, which the rc.2 client validates and would have
made **every** federation call throw; and node liveness was about to be reported
optimistically even though the registry stores durable config only. It also
recorded a **proven seam limitation**: rc.2's `connection.start()` is
single-consumer and already owned by the official runtime, and no non-exclusive
frame tap exists, so live incremental updates for remote nodes cannot be wired
without a decision from the operator. See `checking/host-entry-wiring-report.md`. Wiring also
surfaced a real defect: `CommandRouter` derived known nodes from connected ports,
so a registered-but-unconnected node was misreported as a forged id; it now takes
a registry-wide known-node set.

## Mutation audit

`checking/mutation-audit-report.md` records a systematic audit: 16 safety-critical
invariants were each broken in the real source to confirm a test fails. 15 were
detected. The single survivor — the dispatcher's runtime rc.2 allowlist check —
was investigated rather than papered over: every `#call` site passes a hardcoded
literal, so that path cannot reach the guard. The reachable path
(`probeOptional`, which forwards a dynamic method) is now asserted directly, and
the literal-only property is pinned by a static boundary test that fails if a
dynamic method name is ever introduced.

## Open items (not claimed as verified)

- Tasks 10.1–10.3, 10.6–10.8 remain open: they need three simultaneous live
  nodes running *verified* rc.2 DSH, real remote-subscription prompt/tool/
  approval acceptance, and an enabled deployed GUI.
- The adapter is now proven against a **real rc.2 `dsh web`** in an isolated
  `DSH_HOME` (`compatibility/rc2-live-conformance-report.md`): probe, workspace
  CRUD, session create/history/models/rename/cancel/archive, optional-capability
  withholding and the method allowlist all pass. `session.prompt` was not driven,
  since it would consume a real model subscription.
- The one reachable *remote* DSH node's true version is undetermined, because
  rc.2 reports a constant `0.0.1` (`compatibility/live-remote-probe-report.md`
  carries a superseded-interpretation note).
- `dsh-better-sidebar` layout behaviour against a federated multi-node tree is
  recorded as unproven in `compatibility/plugin-compat-report.md`.
- `dsh.yaml` keeps `dsh-federation: enabled: false`; no `sync`/`dsh build`
  deployment, no DSH restart and no GUI refresh has been performed.
