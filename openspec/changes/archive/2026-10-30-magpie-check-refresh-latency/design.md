## Context

设置页的延迟读数是 host 侧 `LatencyController` 对每条「已保存且地址可解析」线路做一次 TCP 建连（≤600ms，并行、单飞）得到的；客户端在面板打开时与线路保存成功后各请求一次 `GET /api/dsh-magpie-connector/latency`。2026-10-30 落地的「检查线路」（`POST /line-check`）会真实访问同一条线路，但不会刷新延迟格。

## Goals / Non-Goals

**Goals:** 已保存线路的检查完成后顺手刷新一次延迟读数，让「检查」与延迟展示在同一时刻对应得上，用户不必关开面板。

**Non-Goals:** 未保存草稿的延迟展示（草稿没有 line id，行本来就是 `idle`）；给 latency 端点加「按显式地址测量」的入参；任何轮询或定时刷新；把检查结果的 `latencyMs` 当作延迟读数。

## Decisions

**D1：复用现有 `readLatency()`，client-only。**
`MagpieSettings` 已持有 `readLatency`（打开面板与保存成功后调用）。把回调以 `onRefreshLatency` 传给 `Connection`，`runCheck` 在快照落地后调用。host 的 `LatencyController` 自带单飞与 600ms 截止，连续点击不会并发探测，无需 host 改动。

**D2：只在 `draft.id` 存在时触发。**
未保存草稿没有 line id，host 的测速对象只认已保存线路，草稿行恒为 `idle`；为草稿触发只会刷新别的行，属于意外副作用，直接不触发。

**D3：不把检查的 `latencyMs` 当作延迟读数。**
检查的 `latencyMs` 是一次 HTTP 往返（TLS、请求、`/models` 解析），延迟格是纯 TCP 建连耗时，spec 的 info 文案明确区分二者；混用会让「延迟」在两个地方含义不同。

**D4：触发时机是「拿到结果之后」。**
只有响应解析出快照才刷新（404 旧 host、网络异常、解析失败不刷新），避免一次失败的调用还去多打一轮测速。

## Risks / Trade-offs

- [每次检查多一次 `GET latency`（最多 N 条线路各一次 TCP 连接）] → host 单飞 + 600ms 截止；只在用户显式点检查且拿到结果后才发生，成本可忽略。
- [测速失败会静默降级] → 既有规则不变：失败不提示、行显示「—」；检查结果本身仍完整展示。
- [与「禁止轮询」的规则混淆] → spec 明确把「检查完成后」列为已有触发点之一，仍然没有任何定时器。

## Migration Plan

无数据/协议变化，patch 版本 0.4.1；旧 host 不受影响（不新增端点、不新增请求类型）。改动只落在 Web 客户端 bundle：`dsh build` 物化后仍需重启 DSH Host 才会加载新 bundle，仅刷新页面不够。

## Open Questions

- 无。
