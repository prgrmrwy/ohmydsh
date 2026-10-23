## Context

`route_subagent`（`packages/auto-model-routing/src/subagent-tool.ts`）现在的流程：先找所属主会话，不是 AUTO 就返回 `routed: false`；是 AUTO 就请求 Jev 判档，再用档位查模型（`childRoutes` 中配置的组合优先，否则查 `CHILD_MODELS`），用 `mapEffort(model, tier, supported, cap)` 算 effort，最后用 `validateChildRoute` 校验目录、上限和允许列表。effort 的计算只依赖模型和档位，所以“模型已经指定、只算 effort”只需要跳过查模型这一步。

## Goals / Non-Goals

**Goals:**
- 指定模型的委派在 AUTO 下也能按任务判档、得到 effort。
- 复用现有的 effort 算法和校验，不新增表或设置项。

**Non-Goals:**
- 不调整任何模型的起点（例如 Astra 的起点 `low`）。
- 不改主会话路由、Jev 请求、判档记录。
- 不让工具推断用户是否指定了模型；是否传 `model` 由 Agent 按 skill 决定。

## Decisions

### D1. `model` 是可选参数，跳过的只有查模型这一步
传入 `model` 时，`model = args.model`，不调用 `explicitChildRoute`，也不读 `CHILD_MODELS`；之后照常执行 `mapEffort` 和 `validateChildRoute`。校验失败沿用现有的设置错误文本（“暂停委派并询问用户”）。
备选：新建一个只返回 effort 的工具 `route_subagent_effort`。否决：Agent 要多认一个工具，派发规则也要分叉。

### D2. 指定模型时不采用 `childRoutes` 中的 effort
即使某一格配置的模型刚好等于传入的模型，也不用那格的 effort。`childRoutes` 的语义是“这一档推荐这个组合”，模型是用户另行指定的，不属于推荐结果。统一走 `mapEffort`，结果只取决于模型和档位，便于预测。

### D3. provider 必须与模型一致
目录查找和允许列表校验都按 `(provider, model)` 精确匹配，provider 不一致时自然落到设置错误。不另外推断 provider。

### D4. 判档记录写入与现在一致
调用方是普通会话时照常调用 `judged`，`model` 记录为指定模型。芯片因此能显示“Astra·medium”，与实际委派一致。

## Risks / Trade-offs

- [Astra 起点为 low，评审一类任务多判 complex，只得到 medium] → 这是现有起点规则的结果，本 change 不改；需要更高时，用户可同时指定 effort，此时不调用工具。
- [指定模型的委派现在也会外发任务文本] → 只在主会话 AUTO 时外发，与不指定模型时的条件相同；proposal 已说明。
- [Agent 不按 skill 传 `model`，仍然跳过工具] → 环境级派发规则直接写明“只指定了模型时传入该模型”，并用文本测试覆盖。

## Migration Plan

新增参数可选，旧调用行为不变。部署：构建插件并 `node scripts/sync.mjs`；回滚：恢复旧版插件、skill 与指令。
