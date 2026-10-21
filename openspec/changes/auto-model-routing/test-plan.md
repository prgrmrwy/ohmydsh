## Test Plan

测试路径相对 `packages/auto-model-routing/`。首版已有的同名测试仍需按新语义改写或重新观察失败；保留同名仅为追溯，不视为已绿。

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
| specs/auto-model-routing/spec.md → 用户回合与分类输入 | 首轮真实领取序列只取用户消息 | test/input.test.ts | only_user_source_contributes | 🟢 green |
| specs/auto-model-routing/spec.md → 用户回合与分类输入 | 多条用户消息按序拼接并截断 | test/input.test.ts | joins_and_truncates_user_text | 🟢 green |
| specs/auto-model-routing/spec.md → 用户回合与分类输入 | 同回合与重试复用决定 | test/router.test.ts | turn_retries_reuse_decision | 🟢 green |
| specs/auto-model-routing/spec.md → 用户回合与分类输入 | 非用户回合沿用上一级别 | test/router.test.ts | nonuser_turn_reuses_level | 🟢 green |
| specs/auto-model-routing/spec.md → 用户回合与分类输入 | 子会话请求不被改写 | test/router.test.ts | child_passthrough | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 成功判断采用 Jev 档位 | test/host.integration.test.ts | jev_tier_drives_effort | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 请求内容受限 | test/jev.test.ts | request_body_and_limits | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 等待期间切换模式丢弃结果 | test/host.integration.test.ts | mode_change_during_jev_discards_result | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 不跟随重定向 | test/jev.test.ts | redirect_is_rejected | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 判断档位 | 源码不含本地分类与其它出站 | test/content.test.ts | no_local_classifier_or_other_egress | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 各状态码映射为闭集类别 | test/jev.test.ts | failure_categories | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 停用后不再调用 Jev 且不改写 | test/host.integration.test.ts | failure_disables_without_rewrite | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 用户重新点 AUTO 清除停用 | test/host.integration.test.ts | auto_clears_disabled | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 用户取消不是失败 | test/host.integration.test.ts | cancel_is_not_failure | 🟢 green |
| specs/auto-model-routing/spec.md → Jev 失败即停用并提示 | 凭据与响应体不泄漏 | test/host.integration.test.ts | no_secret_or_body_leak | 🟢 green |
| specs/auto-model-routing/spec.md → 级别与 effort 映射 | 档位映射为 effort | test/effort.test.ts | maps_tier_to_effort | 🟢 green |
| specs/auto-model-routing/spec.md → 级别与 effort 映射 | 不支持的 effort 被截断 | test/effort.test.ts | clamps_unsupported_effort | 🟢 green |
| specs/auto-model-routing/spec.md → 级别与 effort 映射 | 无 effort 支持时不改写 | test/router.test.ts | no_effort_support_passthrough | 🟢 green |
| specs/auto-model-routing/spec.md → 级别与 effort 映射 | 同回合换模型重新映射 | test/router.test.ts | new_model_same_turn_remaps_effort | 🟢 green |
| specs/auto-model-routing/spec.md → 子会话决策工具与 skill | 工具成功返回表中条目 | test/subagent-tool.test.ts | tool_returns_table_entry | 🟢 green |
| specs/auto-model-routing/spec.md → 子会话决策工具与 skill | 工具失败返回类别且不改状态 | test/subagent-tool.test.ts | tool_failure_reports_without_state_change | 🟢 green |
| specs/auto-model-routing/spec.md → 子会话决策工具与 skill | 主子会话问题定义相同 | test/host.integration.test.ts | main_and_tool_share_questions | 🟢 green |
| specs/auto-model-routing/spec.md → 子会话决策工具与 skill | 子会话表与家族一致 | test/effort.test.ts | child_table_matches_design_and_family | 🟢 green |
| specs/auto-model-routing/spec.md → 子会话决策工具与 skill | skill 文本包含七项规则 | test/content.test.ts | skill_contains_seven_rules | 🟢 green |
| specs/auto-model-routing/spec.md → 状态可见且不改写其它控件 | 芯片注册在速度芯片左侧 | test/client.test.ts | chip_negative_order | 🟢 green |
| specs/auto-model-routing/spec.md → 状态可见且不改写其它控件 | 面板展示本回合状态，历史只留在 Host | test/client.test.ts | panel_state_and_history_bound | 🟢 green |
| specs/auto-model-routing/spec.md → 状态可见且不改写其它控件 | 停用状态在芯片与面板可见 | test/client.test.ts | disabled_visible_in_chip_and_panel | 🟢 green |
| specs/auto-model-routing/spec.md → 状态可见且不改写其它控件 | 芯片样式与悬停面板 | test/client.test.ts | chip_style_and_hover_panel | 🟢 green |
| specs/auto-model-routing/spec.md → 状态可见且不改写其它控件 | 切换模式只调用插件接口 | test/client.test.ts | toggle_plugin_endpoint_only | 🟢 green |
| specs/auto-model-routing/spec.md → 决策提示（可选） | 主会话判档提示 | test/host.integration.test.ts | main_decision_toast | 🟢 green |
| specs/auto-model-routing/spec.md → 决策提示（可选） | 子会话选模提示 | test/host.integration.test.ts | subagent_decision_toast | 🟢 green |
| specs/auto-model-routing/spec.md → 决策提示（可选） | 开关关闭或判档失败不提示 | test/host.integration.test.ts | toast_off_or_failure_silent | 🟢 green |
| specs/auto-model-routing/spec.md → 决策提示（可选） | 提示只显示一次且 3 秒消失 | test/client.test.ts | toast_once_and_expires | 🟢 green |
| specs/auto-model-routing/spec.md → 决策提示（可选） | 提示只显示一次且 3 秒消失（组件层：首轮预热、换会话不弹旧值、状态变化不阻止消失、控件隐藏时仍可见） | test/toast.dom.test.ts | first poll only primes / switching session / toast still disappears / toast is visible while the composer hides the chip / toast is horizontally centred on the chip | 🟢 green |
| specs/auto-model-routing/spec.md → Host 端点边界 | 无效会话被拒绝且无副作用 | test/endpoints.test.ts | invalid_targets_rejected | 🟢 green |
| specs/auto-model-routing/spec.md → Host 端点边界 | 只修改目标会话 | test/endpoints.test.ts | set_mode_targets_one_session | 🟢 green |
| specs/auto-model-routing/spec.md → 自动选路不得绕过既有模型门禁 | 门禁拒绝不引起改路由 | test/router.test.ts | guard_failure_never_changes_model | 🟢 green |

## 补充回归：既有 design D5 响应体限制（2026-10-20）

不增加验收场景或变更分类策略，补足原 43 场景之外的传输边界覆盖。

| 既有约束 | Test File | Test Name | 状态 |
|---|---|---|---|
| 64 KiB 按 UTF-8 字节计算，恰好上限有效、超出 1 字节拒绝 | test/jev.test.ts | response_limit_counts_utf8_bytes | 🟢 green |
| 超限流未结束即拒绝并取消读取，只发一次请求 | test/jev.test.ts | oversized_stream_is_cancelled_before_eof | 🟢 green |
| HTTP 402 不等待正文结束，保留余额不足类别并取消正文 | test/jev.test.ts | http_error_is_classified_without_waiting_for_body | 🟢 green |
| 收到响应头后，读取正文期间的调用方取消与期限超时保持原三态语义 | test/jev.test.ts | response_stream_respects_abort (caller/deadline) | 🟢 green |

红阶段：上述三条分别观测到误接收 oversized JSON、`timeout` 而非 `invalid-response`、`timeout` 而非 `insufficient-credits`。根因均为完整 `response.text()` 后才检查状态与字符串长度。绿阶段改为状态码先分类、成功响应按流累计字节至最多 65536、超限 cancel；既有取消/超时/失败分类仍通过。

## 修订（2026-10-21）：切回 MANUAL 不复原、芯片改样式

用户在 GUI 验收中决定（独立复核 APPROVE_WITH_CHANGES，M1/M2 与 m1–m6 已落实）：切回 MANUAL 只停止自动调整，不复原；芯片外观对齐官方模型选择器，图标在文字后，面板悬停显示。删除锚点需求与 7 行复原/锚点场景（REMOVED 需求，非弱化）；新增/改写 9 行标为 🔴，按 TDD 重新观察。依据：探测测试与正式 `dsh-api-session-controller` `selectionFor` 源码确认无待生效手选时官方沿用上一请求头 effort，右侧选择器显示 `pending ?? lastUsed`。

## Coverage Notes

- **2026-10-21 修订后**：下文关于 selection 三条、state 锚点四条的变异验证与复原相关说明已随需求删除，仅作历史。`MUST NOT 套用尚未生效的手选模型的映射表` 由 `new_model_same_turn_remaps_effort`（按实际输出模型映射）覆盖。悬停面板：SSR 断言结构，开关逻辑为纯函数单测，真实悬停/延迟由 GUI 复验。

- **假 Jev 服务**：`test/jev.test.ts` 与 host 集成测试使用本地 `node:http` 回环服务器（仅测试代码，源码扫描不覆盖 `test/`），按用例返回 402/401/403/429/451/404/500/302/超时/断连/非 JSON/非法 choice/200+error.code；客户端以可注入的 base URL 指向它（生产常量固定 `https://openrouter.ai`，注入点只在测试构造函数中）。
- **凭据**：测试经可注入的 launch environment 提供 `sk-or-test-SECRET`；泄漏检查读取状态文件、端点响应与 SSR 面板文本。
- **真实运行时**：host 集成测试沿用真实 Context/AgentLoop/官方 `installModelSelection` 与假 LlmAdapter（`{kind:'stop'}` finish 帧），只替身 connection 与 sessionController。步骤拒绝用一个额外 pre-step listener 返回 `{kind:'reject'}` 构造。
- **首版测试**：classifier/resolveLevel 相关测试随本地分类器删除；保留的 router/state/selection/endpoints/client 测试按新原因闭集与 Jev 来源改写。删除的测试对应的需求已被 REMOVED（规则分类器需求已从 spec 中整体替换），不属于弱化。
- **真实 OpenRouter**：不进入自动化套件（会计费且依赖网络）。按 design D4，实施时用最终 `TIER_QUESTIONS` 重跑 spike 的 10 条样本作为手动冒烟，结果写入 verify 证据；不一致回到规划。
- **skill 文本测试**：直接读取 `skills/subagent-model-routing/SKILL.md`（仓库根相对路径）。

- **沿用而首次即绿**（行为未变，仅随 Jev 驱动改写）：input 两条、state 四条、effort 映射两条。selection 三条在真实插件下首次即绿，已用定向变异重新观察失败：去掉“请求头与合成均收敛”的复原清除条件 / 首次复原即清义务 → 三条失败；去掉锚点更新 → `selection_after_assembly_keeps_routes_legal`（加强锚点断言后）失败。Host `rejected_step_skips_jev` 以去掉 `enter` 守卫的变异确认能捕获。
- 端点两条与 client 三条沿用首版行为，首次即绿（端点 state 已展开会话状态含 `disabled`，由第 4 组实现）；`disabled_visible_in_chip_and_panel` 先红后绿。
