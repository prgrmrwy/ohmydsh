---
name: subagent-model-routing
description: 创建或复用子智能体时，按任务复杂度选择官方允许的模型与 effort，并显式标注，避免继承父会话的 AUTO effort。
---

# 子会话模型选择

由主 Agent 自行判断委派任务的复杂度，不调用关键词路由工具。此 skill 独立于主会话 AUTO/MANUAL；MANUAL 只控制主会话 effort。

## 创建

1. 尊重用户或 lead 显式指定。未指定时默认跟随当前用户选定的 provider；要求独立模型体系审查时用对应的另一 provider，不套用默认同体系偏好。
2. 用 `list_subagent_models` 查询调用方会话允许的 provider/model 及支持的 effort。目录可能是会话创建时冻结的允许列表，不代表模型网络可用；表中模型不可用或工具未暴露时如实报告，不偷偷跨 provider 或替换为另一模型。
3. 根据实际任务风险和范围选档。短任务也可能复杂（例如安全审查），不要只按文本长短判断。重做或高风险独立审查可用 escalated。

| 级别 | claude | codex |
|---|---|---|
| simple | claude-haiku-5-5 / low | gpt-6-luna / medium |
| standard | claude-sonnet-5-5 / medium | gpt-6.1-sol / medium |
| complex | claude-opus-5-5 / xhigh | gpt-6.1-sol / xhigh |
| escalated | claude-fable-5-1 / high | gpt-6-astra / medium |

4. 调用官方子智能体工具时一并显式传入 `provider`、`model`、`reasoning_effort`。即使沿用当前模型，也显式写出 effort，避免继承父会话最近 AUTO 请求的 effort。不得传未经目录确认的 effort。
5. 在 `description` 末尾以 `[model·effort]` 标注实际选择，例如 `检查鉴权边界 [claude-opus-5-5·xhigh]`。provider/model 必须成对，官方白名单校验不能绕过。

## 复用

向已有子会话发送新任务前，比较原标注和新任务需求。新任务需要更高档、不同模型体系，或无法确认原配置时新建。创建后不动态修改子会话模型或 effort。此规则是尽力指引，不声称系统能强制阻止不适配的复用。
