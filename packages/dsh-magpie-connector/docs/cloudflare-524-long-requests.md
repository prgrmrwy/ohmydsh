# Cloudflare 524：长会话的 Magpie 请求在 125 秒边缘超时

> 状态：**已定位，未修复**。跟踪条目见 [BACKLOG D014](../../../BACKLOG.md)。
> 记录时间：2026-10-28。本文是排查记录，不是当前实现规范。

## 1. 结论摘要

经 Cloudflare 访问 Magpie 网关时，长会话（约 40 万 token）的生成请求会被 Cloudflare 以 **524** 中断。根因不是 Magpie 报错，也不是 DSH 插件超时：

- Cloudflare 边缘等**源站返回 HTTP 响应头**的上限是 **125 秒**（Proxy Read Timeout）；
- Magpie 要**先拿到上游响应头**才写自己的响应头；
- 所以这 125 秒计的是上游完整的「首个响应字节」时间，长 prompt 的 prefill 超过它，边缘就回 524。

突破口：这个计时在源站发出**第一个字节**时停止，不需要整个响应在 125 秒内完成。任何「让源站立刻发头 + 心跳」的中间层都能绕开。

## 2. 现象

- 报错文案：`本轮运行失败 524 status code (no body)`。
- 只发生在长会话；新会话正常。同一天内第一次出现时上下文已到约 40 万 token。
- 影响所有经该 Cloudflare 入口的模型（Claude 与 OpenCode Go 都出现）。

## 3. 证据

### 3.1 会话日志里的原始错误

从会话日志（`~/.dsh/sessions/<workspace>/session-*/session.v4.jsonl.zstd`，多帧 zstd，需逐帧解压）中解出：

```json
{"failure":{"code":"SERVER","message":"524 status code (no body)","status":524,"providerRetryAfterMs":120000}}
{"failure":{"code":"SERVER","message":"502 status code (no body)","status":502,"providerRetryAfterMs":60000}}
{"failure":{"code":"SERVER","message":"dsh-magpie-connector API error (524): 524 status code (no body)","status":524,"providerRetryAfterMs":120000}}
```

`providerRetryAfterMs: 120000` 说明响应带了 `Retry-After: 120`——这是 Cloudflare 的 524 响应特征，不是 Magpie 的。

### 3.2 失败耗时正好卡在 125 秒

用 `step/start` 与 `assistant/attempt` 的时间差计算三次失败（2026-10-28）：

| 时间 | 轮次 | 耗时 | 结果 |
|---|---|---:|---|
| 15:26:29 → 15:28:36 | turn 8 step 17 | **127.2s** | 524 |
| 15:34:07 → 15:36:15 | turn 9 step 1 | **128.1s** | 524 |
| 15:41:24 → 15:43:34 | turn 10 step 3 | **129.7s** | 524 |

对照：同一会话里一次 502 只用了 16.2 秒。**127–130 秒**与 Cloudflare 的 125 秒 Proxy Read Timeout 完全吻合，可以排除「上游正常但偶发」。

### 3.3 会话规模与请求配置

- 该会话峰值 usage：`inputTokens + cacheReadTokens = 396,348`（约 40 万 token）。
- `request/header` 记录：`provider: dsh-magpie-connector`，`maxTokens: 128000`（Claude）或 `384000`（OpenCode Go DeepSeek），`adapterDefaults.maxTokens: true`。

### 3.4 取证方法

会话日志是多帧 zstd，`zstd -dc` 只能解第一帧且本机未必装了 zstd。可用 Node `zlib.zstdDecompressSync` 按帧魔数 `28 B5 2F FD` 切分后逐帧解压，再按 `type` 过滤 `assistant/attempt`、`step/start`、`request/header`。

## 4. 根因机制

### 4.1 Cloudflare 的连接限制

[Connection limits](https://developers.cloudflare.com/fundamentals/reference/connection-limits/) 中与本次相关的三行：

| 限制 | 数值 | 触发错误码 | 可配置 |
|---|---:|---|---|
| Proxy Read Timeout（等源站响应头） | **125s** | 524 | 仅 Enterprise 可调 |
| Proxy Write Timeout（向源站写请求） | 30s | 524 | 否 |
| Proxy Idle Timeout | 900s | 520 | 否 |

[Error 524 官方说明](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/)：Cloudflare 已连上源站，但源站在 125 秒内没有返回 HTTP 响应。Enterprise 可经 Cache Rule 或 zone setting API 提到 6000 秒；其它计划只有两个官方建议——**换不代理的子域**，或**改成后台任务 + 轮询**。

### 4.2 Magpie 写响应头的时机

Magpie 的流式转发路径（`internal/gateway/gateway.go`，固定 commit `98e23350`）：

```go
// 约 4990 行：先拿到上游响应 res
rd, sse := eventStream(res)
...
w.WriteHeader(res.StatusCode)   // 约 5004 行，此后才写自己的响应头
```

也就是说 `WriteHeader` 在 `res` 之后。上游（Anthropic / OpenAI / Codex 后端）在长 prompt 的 prefill 完成前不返回响应头，Magpie 也就一直不发头，Cloudflare 的 125 秒从收到请求起算，直接命中。

### 4.3 为什么长会话必炸

以 Claude 为例（`context_window: 1,000,000`、`max_output_tokens: 128,000`）。当前（未修复的 0.1.1）把最大输出能力直接作为默认输出预算，DSH 的压缩阈值按 compaction-basic 公式计算：

```
压缩阈值 = floor(min(C × 0.8, C − defaultMaxTokens − headroom))
         = floor(min(800,000, 1,000,000 − 128,000 − 65,536))
         = 800,000 tokens
```

所以 40 万 token 远未达到压缩条件，会话可以继续增长，每轮都重传全部上下文。上游 prefill 时间随 prompt 线性增长，超过 125 秒只是时间问题。

> 注意：这**不是** `magpie-default-output-budget` change 能解决的问题。该 change 修的是「最大输出相对窗口过大」的模型（如 272k/128k 的 GPT-6 Astra/Luna、1M/512k 的 MiniMax）；Claude 的 128k/1M 按公式预算不变、阈值仍是 800k。

### 4.4 重试放大了观感

适配器把 524 归入 `SERVER`（可重试），并把 Cloudflare 的 `Retry-After: 120` 作为 `providerRetryAfterMs` 传下去；DSH 的重试策略是 normal 模式最多 10 次、指数退避上限 60 秒。于是每次 524 后要等约 120 秒再重试，长请求场景下表现为**连续十几分钟一直在报 524**。

## 5. 已排除的方案

| 方案 | 为什么不可行 |
|---|---|
| 直连 LAN / 不走代理 | 用户从公网访问家庭网络，只能经 Cloudflare 打通 |
| 缩小上下文窗口预算 | 长会话是主要使用方式，不能牺牲 |
| 提高 Cloudflare 超时 | 仅 Enterprise 可调 125 → 6000 秒 |
| 不等代理的子域 | 家庭网络没有公网入口，Tunnel 是唯一通道 |
| 后台任务 + 轮询 | OpenAI 兼容协议与 DSH 生成流程不支持改协议 |

## 6. 社区同类问题与解法

### 6.1 local-cli-bridge：最贴近的先例

[REMOTE_BRIDGE.md](https://github.com/JediConcepts/local-cli-bridge/blob/HEAD/docs/REMOTE_BRIDGE.md) 描述的场景与本仓几乎同构：Claude/Codex 订阅跑在家用工作站，经 Cloudflare Tunnel + Access 暴露成 OpenAI 兼容端点。它对 524 的做法（原文要点）：

- 请求带 Cloudflare 边缘头（`cf-ray` / `cf-connecting-ip`）时，**立即提交 200 并送出第一个字节**，停掉边缘计时；
- 然后每 **20 秒**发一次心跳（换行），直到后端完成；
- 最后再写真正的响应体。

它同时写明三点代价：

1. 心跳开始后失败无法再改状态码，只能作为 `{"error":{...}}` 放进 200 的 body，客户端必须识别；
2. 可用 `BRIDGE_KEEPALIVE_MS` 强制数值间隔（`0` 关闭）；
3. 如果隧道链路剥掉了 Cloudflare 头，`auto` 会误判成本地请求，长请求重新 524。

### 6.2 Cloudflare 侧的官方选项

见 4.1：Enterprise 提额，或改不代理子域 / 轮询协议。都不适用。

### 6.3 Workers 能否代理

[Cloudflare Agents 的 SSE 文档](https://developers.cloudflare.com/agents/agent-class/http-sse/)称 Workers 上的 SSE 响应没有有效时长限制。但 Worker 到源站（经 Tunnel）的 fetch 是否仍受 125 秒约束未经验证，作为备选而非首选。

### 6.4 SSE 缓冲

社区已知 SSE 经 Cloudflare 需要关掉缓冲（[SSE with Cloudflare Proxy 讨论](https://community.cloudflare.com/t/using-server-sent-events-sse-with-cloudflare-proxy/656279)），靠 `X-Accel-Buffering: no`。Magpie 已经设置（`gateway.go` 约 5001–5003 行），这一层不是本次原因。

## 7. 候选方案对比

| 方案 | 做法 | 优点 | 代价 |
|---|---|---|---|
| **A. 家庭侧保活中继**（推荐） | 在 nginx 与 Magpie 之间加一层小中继：带 `cf-ray` 的请求先等 20–30 秒拿 Magpie 响应头；快请求原样透传状态码；超时未响应则提交 `200 text/event-stream` + SSE 注释心跳（15–20 秒一次），直到 Magpie 开始返回再透传字节 | 不动上游、不动客户端、不需要企业版；错误语义只对慢请求退化 | 多一个要维护的服务；慢请求的错误变成流内事件 |
| B. 推动 Magpie 上游 | 让 Magpie 收到请求就 flush SSE 头并周期心跳 | 根治，所有用户受益 | 上游是否接受未知；周期长；且需要等发版 |
| C. Cloudflare Worker 代理 | Worker 立即回 200 流，把源站 SSE 管道接进来 | 不用家里加服务 | Worker→源站的 125 秒约束未验证；多一处故障点 |
| D. 换入口 | Tailscale / frp + VPS 等 | 彻底绕开 125 秒 | 与「必须走 Cloudflare」的约束冲突 |

## 8. 推荐方案要点（A）

1. 只拦截生成路径（`/v1/responses`、`/v1/chat/completions`），其它接口（`/v1/models`、额度卡片）保持原样直连。
2. **延迟提交**：先给 Magpie 20–30 秒拿响应头。4xx/5xx（鉴权、限流）通常远快于这个窗口，因此状态码语义保留。
3. 超时后才提交 `200` + `text/event-stream`，立刻发一条 SSE 注释心跳，之后每 15–20 秒一条，直到 Magpie 的首个字节到达。
4. Magpie 开始返回后，字节原样透传，不再插入任何内容。
5. 已提交 200 之后 Magpie 若失败，把失败翻译成对应协议的**流内错误**（Chat 的 `error` 事件 / Responses 的 `response.failed`），DSH 适配器已能识别并正确归类。
6. 判据用 `cf-ray` 头；中继只监听回环，不额外暴露端口。

## 9. 待验证 / 未决

- **Proxy Write Timeout（30 秒）**：40 万 token 的请求体约 1.5–2MB，若家庭上行带宽不足，上传超过 30 秒同样会 524，症状一样但根因不同。需要实测一次长请求的请求体大小与上行速率，确认是否叠加了第二个问题。
- 中继落地位置：建议放在 home-substore 的 `ops/magpie-cloudflare`（与 Cloudflare 入口配置同处），不属于本仓。
- 是否同时向 yetone/magpie 提 issue（该仓库不收 PR，功能请求走 issue）。
- 修复后如何回归：用一次 40 万 token 级别的长会话请求，确认耗时超过 125 秒仍正常出流，且 401/429 仍是原始状态码。

## 10. 参考资料

- [Cloudflare Error 524](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/)
- [Cloudflare Connection limits](https://developers.cloudflare.com/fundamentals/reference/connection-limits/)
- [local-cli-bridge: Remote model bridge over Cloudflare](https://github.com/JediConcepts/local-cli-bridge/blob/HEAD/docs/REMOTE_BRIDGE.md)
- [Cloudflare Agents: HTTP and Server-Sent Events](https://developers.cloudflare.com/agents/agent-class/http-sse/)
- [Cloudflare Community: Using SSE with Cloudflare Proxy](https://community.cloudflare.com/t/using-server-sent-events-sse-with-cloudflare-proxy/656279)
- 上游代码：`yetone/magpie` commit `98e23350f14bfa63adc43c54271fb8fecb4fce5c` 的 `internal/gateway/gateway.go`
