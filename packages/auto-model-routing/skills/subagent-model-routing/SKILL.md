---
name: subagent-model-routing
description: 创建或复用子智能体前使用：通过官方 fresh 创建工具委派，照实传递用户或 lead 指定的模型与 effort；可用 route_subagent 预览 AUTO 的子任务路由，失败时暂停委派并询问用户。
---

# 子会话模型选择

AUTO 的子任务路由由插件在**官方 fresh 创建工具**创建的精确子会话首次请求前完成：插件判断能力与投入、校验当前目录与官方允许列表，并把路由绑定到该子会话。主 Agent 负责拆解、派发与验收，不自行估档。工具跟随所属主会话的模式：只有主会话为 AUTO 时才判断，并把脱敏后的任务文本发送给设置中所选的决策服务；MANUAL 时不判断、不外发。

## 创建

1. **使用官方 fresh 创建工具**（`subagent` 或 fresh `spawn_teammate`），给出清楚的目标与范围。目标或范围不足时，插件会返回 needs-context，请补充描述后重新创建。
2. **显式指定的值照实传递**：用户或 lead 指定了模型或 effort 时，原样传给官方工具。只指定一个维度时，插件只判断另一个；两者都指定时不调用 Jev，只做校验。
3. **`route_subagent` 只是预览**：它返回的 `status: recommended` 不等于已应用。不要把推荐结果当成用户的显式约束再传给官方工具；让插件在创建时自行选配。
4. **主会话为 MANUAL**：`route_subagent` 返回 `routed: false`。此时按官方默认委派，只传用户或 lead 指定的值，不传其它 provider/model/reasoning_effort，也不猜档位。
5. **标注**：在 `description` 末尾以 `[model·effort]` 标注实际使用的配置，例如 `检查鉴权边界 [<model>·<effort>]`；不确定时先查第 7 条的应用证据。
6. **fork 不支持**：`route_subagent` 对 fork 返回 unsupported，创建时插件也会拒绝。应暂停并改用 fresh 创建；不要擅自把 fork 换成 fresh 而不说明。
7. **应用证据**：通过 `childRouting` 状态接口查看对应子会话的 recommended / applied / unsupported / needs-context / failed。applied 来自实际请求头，而不是工具推荐；未绑定的创建路径不算已路由。

## 失败

8. 工具或判断失败（余额不足、凭据无效、限流、地区受限、超时、目录或允许列表中没有可用路由等）：**暂停委派并询问用户**，把错误原文告诉用户。不得猜测档位、不得换用其它模型、不得改由主会话自己完成，也不自行重试或升级。工具被取消时，按用户的取消意图停止。
9. 工具不存在（插件未启用）：告知用户“子会话 Jev 选模未启用”，然后按官方默认委派，只传用户或 lead 指定的值。

## 复用

10. 向已有子会话发送新任务前，先比较它的 `[model·effort]` 标注与新任务的需求。需要更高投入、不同模型家族，或无法确认原配置时，**新建**子会话。已创建的子会话收到后续消息时不会重新选模；创建后不动态修改其模型或 effort。

此 skill 是使用指引，不能强制 Agent 每次委派前都执行某个工具。与环境级指令“委派前先调用 `route_subagent`”相容：MANUAL 下该调用返回 `routed: false`，按第 4 条处理即可。
