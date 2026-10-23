## Why

用户或 lead 指定子会话模型时（例如 openspec anvil 独立评审指定 `gpt-6-astra`），skill 规定“有显式指定时不调用工具”，`route_subagent` 也只接受 `{task, provider}`。主会话即使处于 AUTO，这类子会话也拿不到按任务判档的 effort，只能落到官方默认 effort。主会话 AUTO 本来就是“模型不动、只调 effort”，指定模型的子会话应当得到同样的处理。

## What Changes

- `route_subagent` 新增可选参数 `model`。传入时只判档、只推荐 effort：模型保持调用方指定的值，不查子会话模型表（含设置中的 `childRoutes`），effort 按该模型的起点规则、全局上限与模型支持范围计算。
- 指定模型不在当前模型目录、不属于所给 provider、不在官方子会话允许列表，或无可用 effort 时，返回设置错误并要求暂停委派；不换模型。
- 所属主会话为 MANUAL 时行为不变：不判档、不外发，返回 `routed: false`。
- skill `subagent-model-routing` 与环境级派发规则改为三种情况：模型与 effort 都已指定时不调用工具；只指定模型时调用工具并传 `model`；都未指定时按原流程。
- 不改变主会话路由、Jev 请求格式、判档记录与芯片。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `auto-model-routing`：修改“子会话决策工具与 skill”（新增可选 `model` 参数及其校验、skill 第 1 条规则）与“子会话派发时机写入环境级指令”（派发步骤区分是否已指定模型）。

## Impact

- `packages/auto-model-routing/src/subagent-tool.ts` 及其测试。
- `skills/subagent-model-routing/SKILL.md`、`instructions/dsh-home.md` 及对应文本测试（`packages/auto-model-routing/test/content.test.ts`、`tests/agent-instructions-dispatch.test.mjs`）。
- 外发面：只指定模型的委派在 AUTO 下也会把脱敏后的任务文本发给 OpenRouter/TypeSafe，与不指定模型时的条件相同。
