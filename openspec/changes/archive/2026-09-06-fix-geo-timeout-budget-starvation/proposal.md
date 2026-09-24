## Why

`home-network-model-guard` 的主备 Geo 判定共用同一个 `AbortController`：`network.ts` 建一个 `fetchTimeoutMs`（默认 5s）的 controller，`geo.ts` 把同一个 `signal` 串行传给主、备两个端点。主端点慢时会吃光整个预算，**备用端点一次都不会被尝试**，判定直接落到 `unknown`，Claude 被 fail-closed 拒绝。这违反当前 spec 已承诺的不变量「主 Geo 服务不可达或返回无法解析的响应，而备用服务返回合法国家/地区码 → 采用备用服务结果，不因主服务失败直接进入未知」。

这不是理论风险：2026-09-04 14:35:41 的实机故障中，一个已运行 84 分钟、351 步的 turn 被 `Claude egress is restricted (unknown)` 终结，该 step 耗时 5005ms——精确撞上 5s 预算；同一 session 有 30 个 step 落在 4.8–5.4s 区间，说明预算耗尽是持续贴边的常态而非偶发。当时出口实为 `US`（不在阻断清单内）、两个端点实测均返回 200，即**判定失败纯属自伤**。诱因是 guard 每次判定都新建 `GeoCountrySource` 而不复用连接，冷 TLS 握手实测 2.6–2.8s，单主端点即消耗 55%+ 预算。

## What Changes

- **主备超时预算隔离**：每个 Geo 端点获得独立的超时窗口，主端点耗尽自身预算后备用端点仍有完整尝试机会；调用方总 signal 仍可随时取消全部尝试。恢复 spec 承诺的「双备份」语义。
- **判定失败前的有限快速重试**：一次瞬时抖动不应等同于「服务不可达」。在总预算内允许受限的快速重试，降低假 `unknown` 概率。重试是**判定内部行为**，不改变判定结论的语义。
- **Host gate 拒绝路径可观测**：`llm/stream` gate 拒绝 Claude 调用时输出一行诊断日志（分类 + 降级原因，不含 IP、端点原文或响应体）。当前该路径完全静默，故障无法自证——实机排查只能靠解压 session 日志反推。
- 非破坏性：不改变 RPC 契约、配置文件 schema 或 Web 客户端行为。

**明确不做**（保持 fail-closed 不退让）：不放宽 `unknown` 对 Claude 的拒绝语义。本 change 修的是「判定不应假失败」，而非「判定失败后放行」。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `home-network-model-guard`：收紧两条既有需求的可验证性——(1) 主备故障转移需求补充「单个端点耗尽其超时不得剥夺备用端点的尝试机会」，把原本仅靠散文承诺、实现可绕过的不变量变成可测场景；(2) 未知出口 fail-closed 需求补充「Host 拒绝路径必须留下不含敏感网络事实的诊断记录」。两处均为**加强约束**，不放松任何安全保证。

## Impact

- `packages/home-network-model-guard/src/geo.ts`：per-endpoint 超时与信号组合。
- `packages/home-network-model-guard/src/network.ts`：超时预算分配、重试计数；`degradedReason` 语义不变。
- `packages/home-network-model-guard/src/index.ts`：gate 拒绝路径日志接线（`createEgressGate` 需要一个诊断回调）。
- `packages/home-network-model-guard/src/egress-gate.ts`：拒绝时触发诊断回调；错误文本保持不变（`EgressRestrictedError` 是稳定标记）。
- `packages/home-network-model-guard/test/`：新增 per-endpoint 超时隔离与重试的回归测试，覆盖「主端点挂起 + 备用端点健康 → 必须放行」这一此前无覆盖的缺口。
- `openspec/specs/home-network-model-guard/spec.md`：归档时并入两处需求增补。
- 无新增外呼信任面：仍只访问配置声明的两个 Geo 端点，不新增依赖。
- 用户可见影响：`config.json` 现有字段语义微调（`timeoutMs` 由「整体预算」变为「单端点预算」），需在 design 中明确并在 note 记录。
