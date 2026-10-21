# auto-model-routing

主会话 AUTO 每个用户回合请求一次 Jev（经 OpenRouter decisions 接口，`typesafe/jev-1.13`，3 秒期限、不重试）得出四级档位，只调整 reasoning effort，保留官方 provider/model；切 MANUAL 只停止自动调整，不复原（2026-10-21 修订）。Jev 任何失败（余额不足、凭据无效、限流、地区受限、超时等）立即把会话停用为 MANUAL 并在芯片上显示原因，直到用户重新点 AUTO；不使用本地规则或通用模型降级，不主动查询余额。

子会话通过 Host 工具 `route_subagent` 复用同一 Jev 判断，返回显式 provider/model/reasoning_effort；工具失败时 skill 要求主 Agent 暂停委派并询问用户。

状态：2026-10-20 改为 Jev 判档；2026-10-21 已合入并启用，GUI 验收中用户决定切 MANUAL 不复原、芯片对齐官方模型选择器（tasks 第 9 组，独立复核 APPROVE_WITH_CHANGES 已落实）。首版本地规则的 tasks/test-plan/verify 已移至 `history/`。

2026-10-22 修订（判档策略，进行中）：档位只衡量推理难度（规则 v6，见 design D4 与 `eval/`）；effort 以官方推荐起点上下浮动、封顶 xhigh、永不自动 max；子会话按难度选模、不受主会话模型限制；Jev 看到上一轮问答（脱敏）；派发时机写入环境级指令；回复操作栏增加档位标注按钮与统计脚本。需新一轮独立审查后再写 test-plan/tasks。
