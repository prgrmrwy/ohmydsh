## Context

0.4.1 的检查后刷新调用 `readLatency()`（全量），导致所有已保存行的读数一起变。host 的 `LatencyController` 原本只有一趟全量测量。

## Goals / Non-Goals

**Goals:** 检查完成后只重测被检查的那条线，只更新那一行。

**Non-Goals:** 草稿测速；改变打开面板/保存后的全量测速；引入每行独立轮询或缓存。

## Decisions

**D1：host 侧加可选 `line` scope，而不是新增端点。**
`GET latency?line=<id>` 复用同一资源与同一 `Measure` 注入缝：过滤目标线路、只连一次、只返回该行；不带参数保持全量语义。未知/未保存 id 直接返回 `{lines: []}` 且不发起连接，与其他「未配置不测速」规则一致。

**D2：单飞按 scope 记账，全量可复用给单行。**
`passes` 以 scope（`'*'` 或 line id）为键：同一 scope 的并发请求共享一趟；单行请求在已有全量 pass 运行时直接复用它（不重复探测）；全量请求在单行 pass 运行时另起一趟（不因单行测量而缺行）。避免原先单槽 `inFlight` 在两种 scope 间互相污染。

**D3：客户端把单行结果合并进现有读数表。**
`readLatency(only?)`：带 id 时把该行标记为 `measuring`，请求带 `query.line`，响应只覆盖该 id（`Map` 合并），不重置其它行；失败或请求被更新的一趟取代时静默清理 `measuring`，不改变已有读数。全量路径保持原行为。

**D4：不做乐观无请求的 merge。**
检查结果的 `latencyMs` 是 HTTP 往返，不是 TCP 建连；不能拿它冒充延迟读数。

## Risks / Trade-offs

- [每次检查多一次单行 TCP 连接] → 就是用户点的这一条，≤600ms，host 单飞；比原来全量更省。
- [旧 host 忽略 `?line=` 会返回全量] → 客户端只 merge 目标 id，其它行即使被重新测量也不会改写（结果被过滤），行为仍安全，只是白测一轮；不需要版本协商。
- [并发场景：检查期间保存触发全量] → scope 单飞与 epoch 丢弃旧结果；`measuring` 一定会被清理。

## Migration Plan

patch 0.4.2，无协议破坏；旧 host 兼容（见上）。

## Open Questions

- 无。
