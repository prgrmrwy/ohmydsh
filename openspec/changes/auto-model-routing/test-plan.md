## Test Plan

测试路径相对 `packages/auto-model-routing/`。首版已有的同名测试仍需按新语义改写或重新观察失败；保留同名仅为追溯，不视为已绿。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/auto-model-routing/spec.md → 模式与改写规则 | MANUAL 请求原样通过 | test/router.test.ts | manual_passthrough | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | AUTO 只改 effort | test/router.test.ts | auto_effort_only | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | MANUAL 复原覆盖旧快照重试直至收敛 | test/selection.integration.test.ts | manual_restore_survives_same_step_retry | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | header 前取消或准备失败保留复原 | test/selection.integration.test.ts | restore_survives_preheader_failure | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | 快速切回 AUTO 不恢复旧决定 | test/router.test.ts | rapid_mode_toggle_invalidates_auto | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | 重复同模式设置不重建过渡 | test/state.test.ts | repeated_mode_is_noop | 🔴 red |
| specs/auto-model-routing/spec.md → 模式与改写规则 | 非用户回合同样完成复原 | test/router.test.ts | notification_turn_restores | 🔴 red |
| specs/auto-model-routing/spec.md → 锚点由用户选择维护 | 首个请求初始化锚点 | test/state.test.ts | initialize_anchor_once | 🔴 red |
| specs/auto-model-routing/spec.md → 锚点由用户选择维护 | 用户手选更新锚点 | test/state.test.ts | selection_updates_anchor | 🔴 red |
| specs/auto-model-routing/spec.md → 锚点由用户选择维护 | 路由结果与重启不改锚点 | test/state.test.ts | anchor_survives_restart_without_drift | 🔴 red |
| specs/auto-model-routing/spec.md → 锚点由用户选择维护 | assemble 后手选不混用模型与 effort | test/selection.integration.test.ts | selection_after_assembly_keeps_routes_legal | 🔴 red |
| specs/auto-model-routing/spec.md → 用户回合与分类输入 | 步骤被拒时不请求 Jev | test/host.integration.test.ts | rejected_step_skips_jev | 🔴 red |
| specs/auto-model-routing/spec.md → 用户回合与分类输入 | 首轮真实领取序列只取用户消息 | test/input.test.ts | only_user_source_contributes | 🔴 red |
| specs/auto-model-routing/spec.md → 用户回合与分类输入 | 多条用户消息按序拼接并截断 | test/input.test.ts | joins_and_truncates_user_text | 🔴 red |
| specs/auto-model-routing/spec.md → 用户回合与分类输入 | 同回合与重试复用决定 | test/router.test.ts | turn_retries_reuse_decision | 🔴 red |
| specs/auto-model-routing/spec.md → 用户回合与分类输入 | 非用户回合沿用上一级别 | test/router.test.ts | nonuser_turn_reuses_level | 🔴 red |
| specs/auto-model-routing/spec.md → 用户回合与分类输入 | 子会话请求不被改写 | test/router.test.ts | child_passthrough | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 成功判断采用 Jev 档位 | test/host.integration.test.ts | jev_tier_drives_effort | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 请求内容受限 | test/jev.test.ts | request_body_and_limits | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 等待期间切换模式丢弃结果 | test/host.integration.test.ts | mode_change_during_jev_discards_result | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 不跟随重定向 | test/jev.test.ts | redirect_is_rejected | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 源码不含本地分类与其它出站 | test/content.test.ts | no_local_classifier_or_other_egress | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 各状态码映射为闭集类别 | test/jev.test.ts | failure_categories | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 停用后不再调用 Jev 且复原锚点 | test/host.integration.test.ts | failure_disables_and_restores | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 用户重新点 AUTO 清除停用 | test/host.integration.test.ts | auto_clears_disabled | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 用户取消不是失败 | test/host.integration.test.ts | cancel_is_not_failure | 🔴 red |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 凭据与响应体不泄漏 | test/host.integration.test.ts | no_secret_or_body_leak | 🔴 red |
| specs/auto-model-routing/spec.md → 级别与 effort 映射 | 档位映射为 effort | test/effort.test.ts | maps_tier_to_effort | 🟢 green |
| specs/auto-model-routing/spec.md → 级别与 effort 映射 | 不支持的 effort 被截断 | test/effort.test.ts | clamps_unsupported_effort | 🟢 green |
| specs/auto-model-routing/spec.md → 级别与 effort 映射 | 无 effort 支持时不改写 | test/router.test.ts | no_effort_support_passthrough | 🔴 red |
| specs/auto-model-routing/spec.md → 级别与 effort 映射 | 同回合换模型重新映射 | test/router.test.ts | new_model_same_turn_remaps_effort | 🔴 red |
| specs/auto-model-routing/spec.md → 子会话决策工具与 skill | 工具成功返回表中条目 | test/subagent-tool.test.ts | tool_returns_table_entry | 🔴 red |
| specs/auto-model-routing/spec.md → 子会话决策工具与 skill | 工具失败返回类别且不改状态 | test/subagent-tool.test.ts | tool_failure_reports_without_state_change | 🔴 red |
| specs/auto-model-routing/spec.md → 子会话决策工具与 skill | 主子会话问题定义相同 | test/host.integration.test.ts | main_and_tool_share_questions | 🔴 red |
| specs/auto-model-routing/spec.md → 子会话决策工具与 skill | 子会话表与家族一致 | test/effort.test.ts | child_table_matches_design_and_family | 🟢 green |
| specs/auto-model-routing/spec.md → 子会话决策工具与 skill | skill 文本包含七项规则 | test/content.test.ts | skill_contains_seven_rules | 🔴 red |
| specs/auto-model-routing/spec.md → 状态可见且不改写其它控件 | 芯片注册在速度芯片左侧 | test/client.test.ts | chip_negative_order | 🔴 red |
| specs/auto-model-routing/spec.md → 状态可见且不改写其它控件 | 面板展示状态并限 20 条 | test/client.test.ts | panel_state_and_history_bound | 🔴 red |
| specs/auto-model-routing/spec.md → 状态可见且不改写其它控件 | 停用状态在芯片与面板可见 | test/client.test.ts | disabled_visible_in_chip_and_panel | 🔴 red |
| specs/auto-model-routing/spec.md → 状态可见且不改写其它控件 | 切换模式只调用插件接口 | test/client.test.ts | toggle_plugin_endpoint_only | 🔴 red |
| specs/auto-model-routing/spec.md → Host 端点边界 | 无效会话被拒绝且无副作用 | test/endpoints.test.ts | invalid_targets_rejected | 🔴 red |
| specs/auto-model-routing/spec.md → Host 端点边界 | 只修改目标会话 | test/endpoints.test.ts | set_mode_targets_one_session | 🔴 red |
| specs/auto-model-routing/spec.md → 自动选路不得绕过既有模型门禁 | 门禁拒绝不引起改路由 | test/router.test.ts | guard_failure_never_changes_model | 🔴 red |

## Coverage Notes

- **假 Jev 服务**：`test/jev.test.ts` 与 host 集成测试使用本地 `node:http` 回环服务器（仅测试代码，源码扫描不覆盖 `test/`），按用例返回 402/401/403/429/451/404/500/302/超时/断连/非 JSON/非法 choice/200+error.code；客户端以可注入的 base URL 指向它（生产常量固定 `https://openrouter.ai`，注入点只在测试构造函数中）。
- **凭据**：测试经可注入的 launch environment 提供 `sk-or-test-SECRET`；泄漏检查读取状态文件、端点响应与 SSR 面板文本。
- **真实运行时**：host 集成测试沿用真实 Context/AgentLoop/官方 `installModelSelection` 与假 LlmAdapter（`{kind:'stop'}` finish 帧），只替身 connection 与 sessionController。步骤拒绝用一个额外 pre-step listener 返回 `{kind:'reject'}` 构造。
- **首版测试**：classifier/resolveLevel 相关测试随本地分类器删除；保留的 router/state/selection/endpoints/client 测试按新原因闭集与 Jev 来源改写。删除的测试对应的需求已被 REMOVED（规则分类器需求已从 spec 中整体替换），不属于弱化。
- **真实 OpenRouter**：不进入自动化套件（会计费且依赖网络）。按 design D4，实施时用最终 `TIER_QUESTIONS` 重跑 spike 的 10 条样本作为手动冒烟，结果写入 verify 证据；不一致回到规划。
- **skill 文本测试**：直接读取 `skills/subagent-model-routing/SKILL.md`（仓库根相对路径）。
