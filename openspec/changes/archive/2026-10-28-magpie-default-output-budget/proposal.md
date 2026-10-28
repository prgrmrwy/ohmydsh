## Why

`dsh-magpie-connector` 把网关的 `max_output_tokens`（模型最大输出能力）直接当作 DSH 的 `defaultMaxTokens`（每次请求默认预留的输出预算）。DSH 宿主会在请求未指定 `maxTokens` 时把 `defaultMaxTokens` 补成请求的 `maxTokens`（`@deepseek-ai/dsh-llm` `resolveCallWithInfo`），compaction-basic 再从上下文窗口中扣除这个预留和默认 65,536 的压缩余量，算出压缩阈值。所以输出能力大、窗口相对小的模型会过早压缩，极端组合下宿主直接报压缩配置错误。

2026-10-28 只读查询在线网关（13 个模型）：`codex/gpt-6-astra`、`codex/gpt-6-luna`（272,000 / 128,000）的压缩阈值只有 78,464，约为窗口的 29%；`opencode-go/minimax-m3.1-flash`（1,000,000 / 512,000）为 422,464。

参考：bitxeno/dsh-magpie-connect PR #3（open，未合并），以及 Magpie v0.1.1364 `internal/agent/dsh.go` 中的 `dshMaxTokens`。

## What Changes

- 目录映射区分两个值：**最大输出能力**（保留网关原值，作为交给 pi-ai 的模型输出上限）和 **默认请求输出预算**（作为 `defaultMaxTokens` 交给 DSH）。
- 默认请求输出预算 = `min(最大输出能力, max(1, floor(窗口/4), floor(窗口/2) − 65536))`；网关未给上下文窗口时等于最大输出能力，网关未给最大输出能力时不下发。
- 不改请求补齐逻辑：继续由宿主把 `defaultMaxTokens` 补进请求，显式 `maxTokens` 在宿主与适配器输入层照旧原样使用（发往网关的 HTTP 值仍由 pi-ai 既有逻辑处理，例如 Responses 把 1–15 提到 16）。
- 对用户可见的变化：受影响模型的压缩阈值提高；这些模型经宿主发出的默认输出上限变小（MiniMax M3.1 Flash 512,000 → 434,464；GPT-6 Astra/Luna 128,000 → 70,464，但按 Magpie commit 98e23350 的 Codex 路径，该字段会在发往 Codex 上游前被删除，实际生成不受影响；在线部署版本与路由路径未验证）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `dsh-magpie-connector`：「模型目录字段映射」中 `max_output_tokens` 不再直接作为默认输出预算；新增「默认请求输出预算」「默认预算在适用窗口内通过宿主压缩检查」「SDK 模型输出上限使用最大输出能力」三条要求。

## Impact

- 代码：`packages/dsh-magpie-connector/src/host/catalog.ts`（映射与预算计算、保留能力值）、`src/host/adapter.ts`（交给 pi-ai 的模型输出上限改用能力值）。
- 测试：`test/catalog-mapping.test.ts`、新增预算与 SDK 模型参数测试。
- 版本：插件 0.1.1 → 0.1.2，`dsh.yaml` 同步；CHANGELOG/README 说明默认预算。
- 依赖：无新增；不改宿主、不改网关、不改 Magpie 管理接口。
