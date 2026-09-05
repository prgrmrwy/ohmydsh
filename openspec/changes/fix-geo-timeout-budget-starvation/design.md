## Context

`home-network-model-guard` 的 Host 半区在 `llm/stream` 上强制 Claude 出口门禁。判定链路是：`NetworkVerdictCache.refresh()` 建一个 `AbortController` + `setTimeout(fetchTimeoutMs)`（默认 5s），把 `controller.signal` 交给 `GeoCountrySource.resolveCountry(signal)`，后者串行遍历 `[primary, fallback]`，**把同一个 signal 原样传给两个端点**。

于是超时预算是「整次判定」级别而非「单端点」级别。主端点挂起即吃光全部预算，`for` 循环下一轮的 `if (signal.aborted) return null` 直接短路，备用端点一次都不会被 fetch。已用真实 `lib/` 产物验证（主端点挂起、备用端点健康且瞬时返回）：

```
result          = null
fallback tried? = false
```

这与 `openspec/specs/home-network-model-guard/spec.md` 已承诺的「主服务失败后使用备用服务」直接冲突。既有测试没能拦住，是因为 `geo.test.ts` 的失败用例都是**瞬时 reject**（`AbortController` 从未真正触发），从未构造「慢主端点」这一真实故障形态。

实机后果（2026-09-04 14:35:41，session `8e83fb7e`）：一个 84 分钟、351 步的 turn 被终结于 `Claude egress is restricted (unknown)`；该 step 恰好 5005ms。当时出口为 `US`（非阻断），两端点实测均 200——判定失败纯属自伤。放大因素是 `index.ts` 每次判定都 `new GeoCountrySource(...)`，无连接复用，冷 TLS 实测 2.6–2.8s，单主端点即吃掉 55%+ 预算；该 session 有 30 个 step 落在 4.8–5.4s 带内，说明贴边是常态。

约束：这是 fail-closed 安全路径，任何改动不得让「出口受限时禁用 Claude」在故障态失效；`engines.node >= 22.19`，`AbortSignal.any` 可用；不得新增外呼信任面。

## Goals / Non-Goals

**Goals:**

- 让主备端点各自拥有独立超时预算，恢复 spec 承诺的双备份语义。
- 在单端点预算内容忍瞬时抖动（有限快速重试），降低假 `unknown`。
- 让 Host gate 的拒绝可事后复核（诊断记录），消除静默失败。
- 用回归测试锁住「慢主端点 + 健康备端点 → 必须放行」这一此前无覆盖的缺口。

**Non-Goals:**

- 不放宽 `unknown` 对 Claude 的 fail-closed 语义。修的是「判定不该假失败」，不是「失败后放行」。
- 不改 RPC 契约、`GuardCheckResult` 字段、配置文件 schema 或 Web 客户端行为。
- 不引入连接池/keep-alive 复用（见 Open Questions——虽是根因放大器，但涉及 agent 生命周期管理，单独评估）。
- 不新增 Geo 端点或任何外部依赖。

## Decisions

### D1：per-endpoint 超时，用 `AbortSignal.any` 组合调用方信号

每次端点尝试新建一个 `AbortSignal.timeout(perEndpointMs)`，与调用方传入的总 signal 经 `AbortSignal.any([caller, perEndpoint])` 组合后传给 `fetch`。

- 主端点耗尽自身预算 → 只中止该次 fetch，循环继续，备端点获得**全新**预算。
- 调用方取消 → 组合信号立刻 abort，全部尝试中止（保住 spec 的「整体取消」场景）。

*备选*：给 `resolveCountry` 传 `timeoutMs` 数值、内部各自 `setTimeout`。被否——需手工管理 timer 生命周期与 `finally` 清理，且无法自然表达「调用方取消」与「端点超时」的或关系；`AbortSignal.any` 原生具备该语义且自动解引用，避免 listener 泄漏。

*为何不并发发起两个端点*：并发能把延迟压到 `min` 而非 `sum`，但会让每次判定的外呼量翻倍——对第三方免费服务不友好，且违背「主成功即用其结果、备用仅作 backup」的既有 spec 措辞。保持串行。

### D2：`timeoutMs` 语义由「整体预算」改为「单端点预算」

现有 `config.json` 的 `timeoutMs`（默认 5000）重解释为单端点预算，最坏整体耗时变为约 `2 × timeoutMs`（含重试则见 D3）。

理由：保留字段名与默认值，避免破坏既有本地配置；语义变化方向是**更宽容**，不会让原本能判定的场景变得不能判定。代价是最坏整体时延上升——但该路径只在缓存 miss 时触发（TTL 5min），且与「误杀一个 84 分钟 turn」相比完全可接受。

*备选*：新增 `perEndpointTimeoutMs` 字段并保留 `timeoutMs` 为整体上限。被否——两个预算字段会产生互相矛盾的配置组合（如整体 < 单端点），校验复杂度和用户困惑都不划算。

需在 `dsh.yaml` note 与 package README 记录该语义变化。

### D3：快速重试限定在单端点预算内，且只针对瞬时失败

每个端点在其预算内最多重试 1 次，仅当失败属于**瞬时**类别（transport 失败、非 2xx）。明确**不重试**：该端点自身超时（已耗尽预算，重试无意义且会侵占备端点时间）、响应无 country（确定性失败，重试必然同样结果）。

重试前置一个极短固定退避（约 150ms），避免对抖动中的端点立即打第二枪。

*备选*：不加重试，只靠 D1。被否——D1 解决的是「备端点拿不到机会」，但主端点单次瞬时抖动仍会浪费一次机会；不过这确实是三项里边际收益最低的，故严格限幅（1 次、仅瞬时类、短退避），避免把判定拖长。

`NetworkVerdictCache` 层的指数退避（2s→60s）语义不变——那是**跨判定**的节流，与这里**判定内**的重试是不同层次，互不影响。

### D4：gate 拒绝路径注入诊断回调，而非在 gate 内直接 `logger`

`createEgressGate(check, onReject?)` 增加一个可选回调；`index.ts` 在 `apply()` 里用 `ctx.logger(...)` 接线。

- 保持 `egress-gate.ts` 无 cordis 依赖、纯函数可测（现有测试风格如此）。
- 回调只收 `verdict` 与 `degradedReason` 两个已脱敏字段，从类型层面就无法泄漏 IP/端点/响应体。

日志放在 `apply()` 的根上下文（不在 `ctx.inject(['connection'])` 内），因为 gate 本身注册在根上下文、headless 组合也要覆盖——现有 `logTransition` 只在 connection 分支内，正是实机查不到日志的原因。

拒绝日志需**去重**（同 verdict 连续拒绝不刷屏），沿用现有 `lastLogged` 式的转移记录思路，但与 RPC 路径各自独立计数。`EgressRestrictedError` 的 message 文本保持不变（稳定标记，Web 侧可能依赖）。

## Risks / Trade-offs

- **[最坏判定时延上升到约 2×timeoutMs（含重试更长）]** → 只影响缓存 miss 路径（TTL 5min）；相较误杀长 turn 的代价可忽略。若实测偏长，可下调默认 `timeoutMs`（此时单端点 5s 已比原先「两端点共享 5s」更宽松）。
- **[重试放大对第三方 Geo 服务的请求量]** → 严格限幅：仅瞬时失败、每端点至多 1 次、150ms 退避；正常路径（主端点成功）完全不触发重试。
- **[放宽超时可能掩盖真实的网络故障]** → 不会：双端点都真失败仍进入 `unknown` 并 fail-closed，安全结论不变；D4 的诊断日志反而让真故障**更**可见。
- **[改动落在 fail-closed 安全路径，回归风险高]** → 全部改动只影响「判定如何得出」，不触碰「判定如何被执行」；`egress-gate.ts` 的拒绝条件 `result.verdict !== 'allowed'` 保持逐字不变。新增回归测试覆盖慢主端点、整体取消、双失败三种形态。
- **[`AbortSignal.any` 的运行时可用性]** → `engines.node >= 22.19` 已保证（Node 20+ 即有），实测当前 v24.16.0 可用。

## Migration Plan

1. 改 `geo.ts`（D1/D3）+ `network.ts`（预算传递）+ `egress-gate.ts`/`index.ts`（D4），补测试。
2. `npm test`（package 内 vitest）+ `typecheck`；仓库级 `npm test`、`npm run check:artifacts`。
3. `node scripts/sync.mjs` 物化，连跑两次确认幂等。
4. 实机验证：重启 DSH 后确认判定为 `allowed`（当前出口 US），并人为把主端点指向一个黑洞地址（本地 `config.json`，不进仓库）验证备端点仍能放行。
5. 更新 `dsh.yaml` note 记录 `timeoutMs` 语义变化。

回滚：改动集中在单个 package 且无状态迁移、无配置格式变更，`git revert` 后重新 `dsh build` 即可；旧 `config.json` 在新旧两版下都能被解析。

## Open Questions

- **连接复用**：冷 TLS 2.6–2.8s 是本次故障的放大器。复用 agent/keep-alive 能显著降低单次判定耗时，但 5min TTL 下连接多半已被对端关闭，收益存疑，且涉及 undici agent 生命周期管理。本次不做，待 D1–D3 上线后用实测数据评估。
- **`unknown` 与 `blocked` 的后果区分**：用户本轮明确选择保持 fail-closed 不变，此处仅留档——若未来长 turn 被误杀仍复现，可再单独提 change 讨论（例如仅对「判定失败」而非「确认违规」允许一次带提示的确认放行）。
