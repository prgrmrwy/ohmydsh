---
name: subagent-model-routing
description: 创建或复用子智能体前，调用 route_subagent（Jev 判档）选择 provider/model/reasoning_effort 并显式传入与标注；判档失败时暂停委派并询问用户。
---

# 子会话模型选择

判档由插件工具 `route_subagent` 完成（与主会话 AUTO 共用同一个 Jev 判断），主 Agent 不自行估档。工具跟随所属主会话的模式：只有主会话为 AUTO 时才判档，并把脱敏后的任务文本发送给 OpenRouter/TypeSafe；主会话为 MANUAL 时不判档、不外发。

## 默认 AUTO（优先于下方旧策略回滚规则）

无需选择版本；未显式配置 legacy 回滚且根会话为 AUTO 时：Agent 仍决定拆解、派发和验收；AUTO 在官方创建工具的精确 child 身份上选配资源，主子问题不再相同。

- Magpie 使用精确 provider `dsh-magpie-connect` 和完整带前缀 model ID，不改成本地 claude/codex；自动槽支持 Claude/GPT 家族，其他网关模型需显式模型与可验证 effort。当前本机测试仅走 Magpie，OpenRouter 只用于 Jev，不直接调用本地 Claude/codex。
- 使用官方 fresh `subagent` / `spawn_teammate` 创建，提供清楚的目标和范围即可；不要为自动任务先调用推荐工具再把推荐伪装成用户显式约束。请求首次发送前 AUTO 会判断能力与投入、验证目录并应用。
- 用户显式指定 model/effort 时照实传递；只指定一个维度仅判断另一个，两者指定则不调用 Jev。只指定 effort 也不能沿用下方“完全不判”的原策略规则。
- `route_subagent` 在此分支仅做可选预览，`status: recommended` 不是 applied；fork 返回 unsupported，应暂停并改用 fresh，或让用户明确选择关闭试验后继承。不要擅自将 fork 改为 fresh。
- 通过 `childRouting` 状态接口检查对应 sessionId 的 recommended/applied/unsupported/needs-context/failed；应用证据来自实际 request/header，不来自工具推荐。未绑定的创建路径不冒充已路由。
- 已创建成员收到后续消息不重选；需要升级视作 Agent 明确发起的新建资源决策，说明原因并保留显式约束，不进行自治重试。
- 验收时区分任务描述不足、信息缺失、推理投入不足、能力不足与基础设施故障；网络错误不是自动升级理由。
- MANUAL 停止新决策，已创建实例保持初始路线；关闭试验回到原策略，不删除已绑定子会话的恢复记录。

以下规则只适用于原策略。

## 创建

1. 尊重用户或 lead 显式指定的模型与 effort：
   - 已指定 effort（无论是否指定模型）：不调用工具，按指定值委派。
   - 只指定模型：照常调用工具，并把该模型作为 `model` 传入；工具只推荐 effort，模型保持不变。工具返回 `routed: false` 时只传指定的模型。
   - 都未指定：按下面的步骤由工具选模型与 effort。
2. 选择 provider：默认用当前会话的 provider；用户或 lead 要求独立模型体系审查时改用另一个。当前 provider 不是 claude/codex 时，暂停委派并询问用户使用哪一个。
3. 委派前调用 `route_subagent`，参数为任务描述与 provider。
4. 返回 `routed: false`（主会话为 MANUAL）时：按官方默认委派，**不传** provider/model/reasoning_effort，不询问用户，也不猜档位。
5. 成功时，把返回的 `provider`、`model`、`reasoning_effort` **全部显式**传给官方子智能体工具，即使与当前模型相同也要显式写 `reasoning_effort`，避免继承父会话 AUTO 残留的 effort。
6. 在 `description` 末尾以 `[model·effort]` 标注，例如 `检查鉴权边界 [<model>·<effort>]`。官方白名单校验不能绕过；官方报告模型不可用时如实告知用户，不换模型。

## 失败

- `route_subagent` 返回错误（余额不足、凭据无效、限流、地区受限、超时等）：**暂停委派并询问用户**。不得自行猜测档位、不得改由主会话自己完成、不得换用其它模型代替。把错误原文告诉用户。
- 工具被取消：按用户的取消意图停止，不再询问档位。
- 工具不存在（插件未启用）：告知用户“子会话 Jev 选模未启用”，然后按官方默认委派，**不传** provider/model/reasoning_effort，也不猜档位。

## 复用

向已有子会话发送新任务前，比较其 `[model·effort]` 标注与新任务需求。新任务需要更高档、不同模型体系，或无法确认原配置时新建。创建后不动态修改子会话模型或 effort。此规则是尽力指引，不声称系统能强制阻止不适配的复用。
