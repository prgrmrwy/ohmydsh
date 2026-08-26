# Host entry wiring: from tested components to a composed plugin

## The gap this closes

Every M1/M2 mechanism had been implemented and proven in isolation — activation
coordinator, uplink, router, adapters, carriers, Node Shell, client activation
controller. But both plugin entry points were still inert stubs:

```ts
// src/index.ts        (host)
export function apply(_ctx: Context): void {}
// src/client/index.ts (browser)
export function apply(_ctx: ClientContext): void {}
```

So enabling the package would have registered nothing and rendered nothing.
Tasks 6.6–6.8 and 7.x were marked complete on the strength of their components,
which overstated the state: the mechanisms existed but were unreachable from the
plugin DSH actually loads.

## What the host entry now does

`apply()` performs the process-wide activation transaction, and is deliberately
conservative:

1. read `$DSH_HOME/plugins/dsh-federation/nodes.json` **without ever creating or
   repairing it**; a corrupt, symlinked or over-permissive registry is caught and
   yields no activation;
2. if the registry is absent, unreadable, or declares **no enabled remote**,
   return without touching the Host at all;
3. otherwise claim the single `/api` outer middleware seam — inside the patched
   Connection's Host/Origin trust fence, before the composed Typert-first
   handler — and route through `CentralUplink`;
4. `local-passthrough` outcomes call `next.fetch(request)`, i.e. the untouched
   native chain; disposal releases the seam.

A deployed-but-unused federation is therefore indistinguishable from an absent
one.

## A real defect found while wiring

The first draft registered placeholder routes (`() => () => Promise.resolve()`).
That would have reported `HOST_READY` while routing nothing — worse than the
honest stub — so it was replaced with the actual middleware seam the approved
spec requires.

More importantly, driving the composed path surfaced a genuine bug:

**`CommandRouter` derived its known-node set from the connected `ports` map.**
A node that is *registered but whose tunnel is not up yet* was therefore rejected
as `federation-id-unknown-node` — the diagnostic for a **forged** id. Both paths
fail closed, so this was not a security hole, but the approved spec explicitly
requires distinguishing *registry* from *routing* errors, and this conflated
them: an operator would be told their legitimate node id was invalid.

Fix: `CommandRouter` now accepts an optional registry-wide `knownNodes` set,
separate from connectivity. A registered-but-unconnected node produces a routing
error (`UNKNOWN_NODE` from the port lookup) rather than an identity error. The
parameter is optional, so existing call sites keep the previous behaviour.

## Verified behaviour

| Case | Result |
| --- | --- |
| no registry | federation never claims the seam; native chain answers |
| registry with only the local node | federation never claims the seam |
| registry with an enabled remote | federation claims the seam |
| forged `fed1:ghost:` id | `federation-id-unknown-node`, native chain never called |
| bare native id | reaches the untouched native chain |
| registered but unconnected node | routing failure, **not** silently local |

## Mutation checks

| Mutation | Test result |
| --- | --- |
| activate regardless of registry contents | **detected** |
| ignore the registry-wide known-node set in `CommandRouter` | **detected** |

## A flake I fixed rather than tolerated

The first version of this test slept fixed intervals (500 ms) waiting for
`apply()`'s asynchronous registry read. Under the full parallel suite that raced
and produced one intermittent failure. It now polls for the activation decision
and asserts it explicitly, which is both deterministic and faster. Two
consecutive full runs: **93 passed, 0 failed**.

## Round 19：联邦 inventory 端点（闭合浏览器↔Host 回路）

Round 18 让浏览器调用 `federation/nodes` 与 `federation/baseline`，但**Host 端从未实现
这两个端点**——真实部署下它们会落到 `local-passthrough`，联邦 UI 永远激活不了。本轮
补齐，并在过程中发现两个额外的真实缺陷。

### 缺陷 1：端点缺失（会导致 UI 永不激活）

`CentralUplink` 现在处理 `/api/federation/nodes` 与 `/api/federation/baseline`，并接受
一个可选的 `FederationInventory`。未挂载 inventory 时返回
`federation-inventory-unavailable`（503）**而不是**回落 native——否则联邦身份会落进
本机官方 handler。

### 缺陷 2：未回显 `rpcId`（会导致每次调用抛错）

读 rc.2 客户端源码时发现 `connection.rpc.call` 会
`serverResponseSchema.parse(...)` 并**校验 `full.rpcId !== rpcId` 就抛错**，然后返回
`full.result`。我最初的中间件应答**完全没有 `rpcId`**，因此每一次联邦调用都会在浏览器
侧抛异常。现已回显请求的 `rpcId`，错误分支也改为标准 `result: { ok:false, error }`
形状。这个缺陷只有读真实客户端契约才能发现，靠"看起来合理"是发现不了的。

### 缺陷 3：乐观上报节点状态

registry 只存**持久配置**（`LocalNodeRecord`/`RemoteNodeRecord` 没有 `state` /
`compatibility` 字段——这是正确的，liveness 属运行时事实）。因此 inventory 对尚无
连接的节点上报 `CONNECTING` / `EXPERIMENTAL`，而不是乐观的 `READY` / `SUPPORTED`。

### 验证

| 用例 | 结果 |
| --- | --- |
| `federation/nodes` | 由联邦应答（不经 native），含 local + remote，回显 `rpcId`，`type: server-response` |
| 未连接远端的 state/compatibility | `CONNECTING` / `EXPERIMENTAL`，非乐观值 |
| `federation/baseline` 未知节点 | `federation-id-unknown-node`，错误应答同样回显 `rpcId` |
| `federation/baseline` 已注册但未连接 | fail closed，不返回看似真实的空 baseline |
| 所有 inventory 请求 | `nativeCalls` 恒为空 |

### Round 19 mutation 结果

| 变异 | 结果 |
| --- | --- |
| inventory 端点回落 native | **检出** |
| baseline 不校验未知节点 | **检出** |
| 乐观上报 `READY`/`SUPPORTED` | **检出** |
| 不回显 `rpcId`（缺陷 2 回归） | **检出** |

## 接线现状（截至 round 19）

Host 与浏览器两端都已真实接线，回路闭合：Host 通过 `/api` 唯一 middleware 提供
inventory 与命令路由；浏览器取节点集、按节点装载 baseline、就绪后才遮蔽官方 slots。

仍未接的部分（诚实列出）：

- inventory 的 `runningSessionCount` / `pendingInteractionCount` 目前恒为 0；真实聚合
  需要节点生命周期发布运行时计数。
- `baseline` 的 `archivedSessionIds` 恒为空数组，未从远端 workspace 状态推导。
- 远端节点的**增量帧泵**尚未接线：`NodeProjectionRuntime.accept()` 已实现并验证，但
  还没有把中央 mux/host 帧持续喂给它，因此远端子树目前只有 baseline 快照，不会实时
  更新。**这不是遗漏，而是一个已证实的接缝限制，见下节。**

## ⚠ 已证实的接缝限制：浏览器侧没有非独占的帧订阅口

尝试接增量帧泵时，读 rc.2 源码得到两个硬事实：

1. `ConnectionHandle.start(sinks)` 的契约明确写着
   **"One consumer owns the streams (the runtime object layer); a second call
   throws."**
2. `dsh-client-runtime/lib/client.js:10510` 已经调用了 `connection.start({...})`。

因此**联邦插件不能再调用 `start()`**——那会直接抛错并破坏官方运行时。同时
`ConnectionHandle` 上也**不存在** tap / observe / 旁路订阅接口（已在
`client/index.d.ts` 中确认无 `onMuxEnvelope`/`tap`/`observe` 导出）。

可选的前进路径（都需要你决策，因为都超出当前已批准范围）：

- **A. 轮询 baseline**：按间隔重新拉 `federation/baseline`。最保守、不碰官方运行时，
  但不是实时，且会周期性打远端。
- **B. 联邦自有下行流**：中央 Host 额外开一条联邦专属 SSE/WebSocket 端点，浏览器侧
  联邦独立消费。不与官方 `start()` 冲突，但**新增一条下行通道**，属于对已批准设计的
  扩展。
- **C. 请求 rc.2 提供非独占 tap**：最干净，但依赖上游能力，非本 change 可控。

按目标约定「遇到无法证明的核心接缝时暂停并报告」，我没有擅自选择，也没有强行调用
`start()` 制造"看起来能用"的实现。

**用户决策（round 19）：保持现状——baseline 快照，不假装实时。** 理由是不碰官方运行时、
不扩展已批准设计；实时流若需要，另开独立 change 处理。因此本 change 范围内
`NodeProjectionRuntime.accept()` 保留为已验证但未接入增量流的能力，远端子树显示
baseline 快照，且不会宣称实时。

## Verification

`dsh-federation` package → **120 passed**; root `npm test` → **93 passed, 0
failed** (twice); typecheck clean. Nothing touches `~/.dsh`; `dsh.yaml` keeps
`dsh-federation: enabled: false`.
