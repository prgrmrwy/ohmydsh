## Test Plan

测试路径相对 `packages/auto-model-routing/`，`tests/` 开头的路径相对仓库根。本表覆盖 2026-10-22 修订后的全部 66 个场景。首版已存在且行为未变的测试保留原名；因本修订改变断言的测试标为 🔴 red，须先观察失败再实现。行为未变的沿用测试标为 🟢 green（如实注明为沿用，不冒称新红）。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/auto-model-routing/spec.md → 模式与改写规则 | MANUAL 请求原样通过 | test/router.test.ts | manual_passthrough | 🟢 green |
| specs/auto-model-routing/spec.md → 模式与改写规则 | AUTO 只改 effort | test/router.test.ts | auto_effort_only | 🟢 green |
| specs/auto-model-routing/spec.md → 模式与改写规则 | 切回 MANUAL 不复原 | test/selection.integration.test.ts | manual_keeps_last_auto_effort | 🟢 green |
| specs/auto-model-routing/spec.md → 模式与改写规则 | AUTO 结果同步到官方选择 | test/host.integration.test.ts | auto_syncs_official_selection / selection_sync_failure_does_not_block_request | 🟢 green |
| specs/auto-model-routing/spec.md → 模式与改写规则 | AUTO 判档覆盖待生效手选 | test/selection.integration.test.ts | auto_overrides_pending_pick | 🟢 green |
| specs/auto-model-routing/spec.md → 模式与改写规则 | 快速切回 AUTO 不恢复旧决定 | test/router.test.ts | rapid_mode_toggle_invalidates_auto | 🟢 green |
| specs/auto-model-routing/spec.md → 模式与改写规则 | 重复同模式设置无副作用 | test/state.test.ts | repeated_mode_is_noop | 🟢 green |
| specs/auto-model-routing/spec.md → 模式与改写规则 | 旧状态文件可读 | test/state.test.ts | legacy_state_file_is_readable | 🟢 green |
| specs/auto-model-routing/spec.md → 用户回合与分类输入 | 步骤被拒时不请求 Jev | test/host.integration.test.ts | rejected_step_skips_jev | 🟢 green |
| specs/auto-model-routing/spec.md → 用户回合与分类输入 | 首轮真实领取序列只取用户消息 | test/input.test.ts | first_claim_user_only | 🟢 green |
| specs/auto-model-routing/spec.md → 用户回合与分类输入 | 多条用户消息按序拼接并截断 | test/input.test.ts | ordered_text_bounded_utf16 | 🟢 green |
| specs/auto-model-routing/spec.md → 用户回合与分类输入 | 同回合与重试复用决定 | test/router.test.ts | turn_retries_reuse_decision | 🟢 green |
| specs/auto-model-routing/spec.md → 用户回合与分类输入 | 非用户回合沿用上一级别 | test/router.test.ts | nonuser_turn_reuses_level | 🟢 green |
| specs/auto-model-routing/spec.md → 用户回合与分类输入 | 子会话请求不被改写 | test/router.test.ts | child_passthrough | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 成功判断采用 Jev 档位 | test/host.integration.test.ts | jev_tier_drives_effort | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 请求内容受限 | test/host.integration.test.ts | state_carries_previous_turn | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 上一轮上下文截断、取末段并脱敏 | test/context.test.ts | previous_turn_truncated_and_redacted | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 脱敏覆盖常见形态且不误伤正文 | test/context.test.ts | redact_covers_shapes_before_truncation | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 首个用户回合不带上一轮上下文 | test/context.test.ts | first_turn_state_has_no_context | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 规则版本由规则内容决定 | test/jev.test.ts | rubric_version_is_content_hash | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 回归脚本只把基线外的新未命中视为失败 | test/eval-runner.test.ts | runner_exit_codes_and_shared_state | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 重启后仍沿用上一档位 | test/host.integration.test.ts | previous_tier_survives_restart | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 等待期间切换模式丢弃结果 | test/host.integration.test.ts | mode_change_during_jev_discards_result | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 不跟随重定向 | test/jev.test.ts | redirect_is_rejected | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 源码不含本地分类与其它出站 | test/content.test.ts | no_local_classifier_or_other_egress | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 各状态码映射为闭集类别 | test/jev.test.ts | failure_categories | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 停用后不再调用 Jev 且不改写 | test/host.integration.test.ts | failure_disables_without_rewrite | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 用户重新点 AUTO 清除停用 | test/host.integration.test.ts | auto_clears_disabled | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 用户取消不是失败 | test/host.integration.test.ts | cancel_is_not_failure | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 凭据与响应体不泄漏 | test/host.integration.test.ts | no_secret_or_body_leak | 🟢 green |
| specs/auto-model-routing/spec.md → 级别与 effort 映射 | 档位映射为 effort | test/effort.test.ts | maps_tier_to_effort | 🟢 green |
| specs/auto-model-routing/spec.md → 级别与 effort 映射 | 起点不同的模型按起点浮动且封顶 xhigh | test/effort.test.ts | starting_points_float_and_cap_at_xhigh | 🟢 green |
| specs/auto-model-routing/spec.md → 级别与 effort 映射 | 不支持的 effort 被截断 | test/effort.test.ts | clamps_unsupported_effort | 🟢 green |
| specs/auto-model-routing/spec.md → 级别与 effort 映射 | 无 effort 支持时不改写 | test/router.test.ts | no_effort_support_passthrough | 🟢 green |
| specs/auto-model-routing/spec.md → 级别与 effort 映射 | 同回合换模型重新映射 | test/router.test.ts | new_model_same_turn_remaps_effort | 🟢 green |
| specs/auto-model-routing/spec.md → 子会话决策工具与 skill | 工具成功返回表中条目 | test/subagent-tool.test.ts | tool_returns_table_entry | 🟢 green |
| specs/auto-model-routing/spec.md → 子会话决策工具与 skill | 主会话为 MANUAL 时不判档、不外发 | test/subagent-tool.test.ts | manual_root_skips_jev | 🟢 green |
| specs/auto-model-routing/spec.md → 子会话决策工具与 skill | 子会话中调用按根会话模式判档 | test/subagent-tool.test.ts | nested_child_follows_root_mode | 🟢 green |
| specs/auto-model-routing/spec.md → 子会话决策工具与 skill | 子会话模型不受调用会话模型限制 | test/subagent-tool.test.ts | child_model_not_capped_by_caller | 🟢 green |
| specs/auto-model-routing/spec.md → 子会话决策工具与 skill | 工具失败返回类别且不改状态 | test/subagent-tool.test.ts | tool_failure_reports_without_state_change | 🟢 green |
| specs/auto-model-routing/spec.md → 子会话决策工具与 skill | 主子会话问题定义相同 | test/host.integration.test.ts | main_and_tool_share_questions | 🟢 green |
| specs/auto-model-routing/spec.md → 子会话决策工具与 skill | skill 文本包含八项规则 | test/content.test.ts | skill_contains_eight_rules | 🟢 green |
| specs/auto-model-routing/spec.md → 状态可见且不改写其它控件 | 芯片注册在速度芯片左侧 | test/client.test.ts | chip_negative_order | 🟢 green |
| specs/auto-model-routing/spec.md → 状态可见且不改写其它控件 | 面板展示本回合状态，历史只留在 Host | test/client.test.ts | panel_state_and_history_bound | 🟢 green |
| specs/auto-model-routing/spec.md → 状态可见且不改写其它控件 | 停用状态在芯片与面板可见 | test/client.test.ts | disabled_visible_in_chip_and_panel | 🟢 green |
| specs/auto-model-routing/spec.md → 状态可见且不改写其它控件 | 悬停面板显示最近一次决策分布 | test/client.test.ts | panel_shows_latest_decision | 🟢 green |
| specs/auto-model-routing/spec.md → 状态可见且不改写其它控件 | 芯片样式与悬停面板 | test/client.test.ts | chip_style_and_hover_panel | 🟢 green |
| specs/auto-model-routing/spec.md → 状态可见且不改写其它控件 | 切换模式只调用插件接口 | test/client.test.ts | toggle_plugin_endpoint_only | 🟢 green |
| specs/auto-model-routing/spec.md → 决策提示（默认开启） | 主会话判档提示 | test/host.integration.test.ts | main_decision_toast | 🟢 green |
| specs/auto-model-routing/spec.md → 决策提示（默认开启） | 子会话选模提示 | test/host.integration.test.ts | subagent_decision_toast | 🟢 green |
| specs/auto-model-routing/spec.md → 决策提示（默认开启） | 开关关闭或判档失败不提示 | test/host.integration.test.ts | toast_off_or_failure_silent | 🟢 green |
| specs/auto-model-routing/spec.md → 决策提示（默认开启） | 提示只显示一次且 3 秒消失 | test/client.test.ts | toast_once_and_expires | 🟢 green |
| specs/auto-model-routing/spec.md → Host 端点边界 | 无效会话被拒绝且无副作用 | test/endpoints.test.ts | invalid_targets_rejected | 🟢 green |
| specs/auto-model-routing/spec.md → Host 端点边界 | 只修改目标会话 | test/endpoints.test.ts | set_mode_targets_one_session | 🟢 green |
| specs/auto-model-routing/spec.md → 自动选路不得绕过既有模型门禁 | 门禁拒绝不引起改路由 | test/router.test.ts | guard_failure_never_changes_model | 🟢 green |
| specs/auto-model-routing/spec.md → 子会话派发时机写入环境级指令 | 环境级指令含派发规则且不含模型名 | tests/agent-instructions-dispatch.test.mjs | dispatch_rules_present_without_model_names | 🟢 green |
| specs/auto-model-routing/spec.md → 判档记录与人工标注 | 成功判档追加一行不含文本的记录 | test/host.integration.test.ts | judgement_line_appended_without_text | 🟢 green |
| specs/auto-model-routing/spec.md → 判档记录与人工标注 | 失败、取消、子会话判档与非用户回合不写判档行 | test/host.integration.test.ts | no_judgement_line_for_failure_cancel_child_continued | 🟢 green |
| specs/auto-model-routing/spec.md → 判档记录与人工标注 | 写入失败不影响请求 | test/host.integration.test.ts | judgement_write_failure_is_harmless | 🟢 green |
| specs/auto-model-routing/spec.md → 判档记录与人工标注 | 按消息查询与标注 | test/host.integration.test.ts | label_query_and_append_by_message | 🟢 green |
| specs/auto-model-routing/spec.md → 判档记录与人工标注 | 标注追加失败返回错误 | test/host.integration.test.ts | label_append_failure_returns_5xx | 🟢 green |
| specs/auto-model-routing/spec.md → 判档记录与人工标注 | 无效请求被拒，未知消息不写入 | test/endpoints.test.ts | label_rejects_invalid_and_ignores_unknown | 🟢 green |
| specs/auto-model-routing/spec.md → 判档记录与人工标注 | 统计脚本按规则版本汇总并跳过损坏行 | test/label-report.test.ts | report_folds_by_version_and_skips_bad_lines | 🟢 green |
| specs/auto-model-routing/spec.md → 回复操作栏档位按钮 | 有判档才显示按钮 | test/label-button.dom.test.ts | button_only_when_judged | 🟢 green |
| specs/auto-model-routing/spec.md → 回复操作栏档位按钮 | Tooltip 与菜单内容 | test/label-button.dom.test.ts | tooltip_and_menu_content | 🟢 green |
| specs/auto-model-routing/spec.md → 回复操作栏档位按钮 | 选择档位只调用插件标注端点，失败不改显示 | test/label-button.dom.test.ts | selection_calls_label_only | 🟢 green |

## Coverage Notes

- 66 个场景全部映射；🔴 33 行、🟢 33 行。🟢 行的被测行为本修订未改，沿用既有测试；实施中若其断言需要因新常量或新签名改动，按 🔴 处理并记录观察到的失败。
- “环境级指令含派发规则”由仓库根测试读取 `instructions/dsh-home.md` 断言；物化、幂等与撤销已由 `tests/sync-agent-instructions.test.mjs` 覆盖，不另建场景。
- “回归脚本”测试使用本地回环假 Jev 服务，不联网；真实 OpenRouter 回归是验收步骤（tasks 第 9 组），不计入 test-plan。
- 子会话白名单不在测试范围：由 DSH 设置管理，会话创建时生效，验收在新会话中进行。
