---
name: subagent-model-routing
description: 创建或复用子智能体前，调用 route_subagent（Jev 判档）选择 provider/model/reasoning_effort 并显式传入与标注；判档失败时暂停委派并询问用户。
---

# 子会话模型选择

判档由插件工具 `route_subagent` 完成（与主会话 AUTO 共用同一个 Jev 判断），主 Agent 不自行估档。此 skill 独立于主会话 AUTO/MANUAL。调用该工具会把任务文本发送给 OpenRouter/TypeSafe。

## 创建

1. 尊重用户或 lead 显式指定的模型；有显式指定时不调用工具。
2. 选择 provider：默认用当前会话的 provider；用户或 lead 要求独立模型体系审查时改用另一个。当前 provider 不是 claude/codex 时，暂停委派并询问用户使用哪一个。
3. 委派前调用 `route_subagent`，参数为任务描述与 provider。
4. 成功时，把返回的 `provider`、`model`、`reasoning_effort` **全部显式**传给官方子智能体工具，即使与当前模型相同也要显式写 `reasoning_effort`，避免继承父会话 AUTO 残留的 effort。
5. 在 `description` 末尾以 `[model·effort]` 标注，例如 `检查鉴权边界 [<model>·<effort>]`。官方白名单校验不能绕过；官方报告模型不可用时如实告知用户，不换模型。

## 失败

- `route_subagent` 返回错误（余额不足、凭据无效、限流、地区受限、超时等）：**暂停委派并询问用户**。不得自行猜测档位、不得改由主会话自己完成、不得换用其它模型代替。把错误原文告诉用户。
- 工具被取消：按用户的取消意图停止，不再询问档位。
- 工具不存在（插件未启用）：告知用户“子会话 Jev 选模未启用”，然后按官方默认委派，**不传** provider/model/reasoning_effort，也不猜档位。

## 复用

向已有子会话发送新任务前，比较其 `[model·effort]` 标注与新任务需求。新任务需要更高档、不同模型体系，或无法确认原配置时新建。创建后不动态修改子会话模型或 effort。此规则是尽力指引，不声称系统能强制阻止不适配的复用。
