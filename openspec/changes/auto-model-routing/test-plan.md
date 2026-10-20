> **2026-10-20：以下为首版（本地规则，`13f1587b`）的实施与验收记录，范围已被修订取代，仅作历史参考。**

## Test Plan

门禁：第 5 轮 `APPROVE_WITH_CHANGES`，定点复核 `CHANGES_APPLIED: yes`。替换旧版 77 场景计划；本表对应当前 9 条要求、33 场景。S = `specs/auto-model-routing/spec.md`；测试文件均相对 `packages/auto-model-routing/`。red 表示待编写并观察正确失败，不表示测试已经执行。

| Requirement | Scenario | Test File | Test Name | Initial State |
|---|---|---|---|---|
| S → 模式与改写规则 | MANUAL 请求原样通过 | test/router.test.ts | manual_passthrough | 🟢 green |
| S → 模式与改写规则 | AUTO 只改 effort | test/router.test.ts | auto_effort_only | 🟢 green |
| S → 模式与改写规则 | MANUAL 复原覆盖旧快照重试直至收敛 | test/selection.integration.test.ts | restore_survives_retry_until_convergence | 🟢 green |
| S → 模式与改写规则 | header 前取消或准备失败保留复原 | test/selection.integration.test.ts | restore_survives_preheader_failure | 🟢 green |
| S → 模式与改写规则 | 快速切回 AUTO 不恢复旧决定 | test/router.test.ts | rapid_mode_toggle_invalidates_auto | 🟢 green |
| S → 模式与改写规则 | 重复同模式设置不重建过渡 | test/state.test.ts | repeated_mode_is_noop | 🟢 green |
| S → 模式与改写规则 | 非用户回合同样完成复原 | test/router.test.ts | notification_turn_restores | 🟢 green |
| S → 锚点由用户选择维护 | 首个请求初始化锚点 | test/state.test.ts | initialize_anchor_once | 🟢 green |
| S → 锚点由用户选择维护 | 用户手选更新锚点 | test/state.test.ts | selection_updates_anchor | 🟢 green |
| S → 锚点由用户选择维护 | 路由结果与重启不改锚点 | test/state.test.ts | anchor_survives_restart_without_drift | 🟢 green |
| S → 锚点由用户选择维护 | assemble 后手选不混用模型与 effort | test/selection.integration.test.ts | selection_after_assembly_keeps_routes_legal | 🟢 green |
| S → 用户回合与分类输入 | 首轮真实领取序列只取用户消息 | test/input.test.ts | first_claim_user_only | 🟢 green |
| S → 用户回合与分类输入 | 多条用户消息按序拼接并截断 | test/input.test.ts | ordered_text_bounded_utf16 | 🟢 green |
| S → 用户回合与分类输入 | 同回合与重试复用决定 | test/router.test.ts | turn_retries_reuse_decision | 🟢 green |
| S → 用户回合与分类输入 | 非用户回合沿用上一级别 | test/router.test.ts | nonuser_turn_reuses_level | 🟢 green |
| S → 用户回合与分类输入 | 子会话请求不被改写 | test/router.test.ts | child_passthrough | 🟢 green |
| S → 本地规则分类器 | 典型输入的档位 | test/classifier.test.ts | classifier_fixture_tiers | 🟢 green |
| S → 本地规则分类器 | 指令性与空白输入 | test/classifier.test.ts | classifier_closed_set_and_blank | 🟢 green |
| S → 本地规则分类器 | 源码不含外发路径 | test/content.test.ts | source_has_no_egress_primitives | 🟢 green |
| S → 级别规则与 effort 映射 | 分类结果映射为 effort | test/classifier.test.ts | standard_maps_medium | 🟢 green |
| S → 级别规则与 effort 映射 | 延续、重做与显式意图 | test/classifier.test.ts | intent_precedence | 🟢 green |
| S → 级别规则与 effort 映射 | 分类不能直接产生 escalated | test/classifier.test.ts | classifier_cannot_escalate | 🟢 green |
| S → 级别规则与 effort 映射 | 不支持的 effort 被截断 | test/classifier.test.ts | effort_clamps_to_supported | 🟢 green |
| S → 级别规则与 effort 映射 | 首回合未分类与不支持 effort 时不改写 | test/router.test.ts | unsupported_and_unclassified_passthrough | 🟢 green |
| S → 子会话选模由 skill 指引 | skill 文本包含五项条目 | test/content.test.ts | skill_required_guidance | 🟢 green |
| S → 子会话选模由 skill 指引 | skill 档位表与 design 一致 | test/content.test.ts | skill_tier_table | 🟢 green |
| S → 状态可见且不改写其它控件 | 芯片注册在速度芯片左侧 | test/client.test.ts | chip_negative_order | 🟢 green |
| S → 状态可见且不改写其它控件 | 面板展示状态并限 20 条 | test/client.test.ts | panel_state_and_history_bound | 🟢 green |
| S → 状态可见且不改写其它控件 | 切换模式只调用插件接口 | test/client.test.ts | toggle_plugin_endpoint_only | 🟢 green |
| S → Host 端点边界 | 无效会话被拒绝且无副作用 | test/endpoints.test.ts | reject_invalid_session_without_mutation | 🟢 green |
| S → Host 端点边界 | 只修改目标会话 | test/endpoints.test.ts | mutate_target_only | 🟢 green |
| S → 自动选路不得绕过既有模型门禁 | 门禁拒绝不引起改路由 | test/router.test.ts | guard_failure_never_changes_model | 🟢 green |
| S → 自动选路不得绕过既有模型门禁 | 档位表家族一致 | test/content.test.ts | skill_provider_family | 🟢 green |

## Coverage Notes

- 表中 33 行逐一对应规范场景；组合场景用参数化用例展开，包括快速切换前已复原/未复原、header 前取消/prepareCall 失败、手选后的 AUTO/MANUAL 两条路径。
- 集成测试使用真实 DSH 0.2.0-rc.2 AgentLoop、官方模型选择与投影，注入假的 LLM 流和临时状态目录，不调用外部模型。不得复制一套 selection/AgentLoop 实现再用它证明真实行为；若组合入口不支持测试，先报告阻塞，不把模拟单测冒称集成通过。
- 首轮输入用真实 Host 来源序列；长度测试包含 astral 字符截在代理对中间，断言 JS slice 结果。MANUAL 测试包括无 effort 锚点、持久化过渡跨重启、最新历史选择初始化与手选并发。
- 单元测试直接读源码/skill 断言，不新增 check-scope/check-skill 脚本或仅供测试的运行时子会话表。字符串扫描是补充，不等价于完整无外发证明。
- client 测试检查真实注册贡献与调用，渲染使用现有 renderer 测试入口；实际位置另在既有 GUI 验证。历史仅内存 20 条，重启丢失、不保存正文。
- 验收另做一次真实委派：观察主 Agent 查询官方可选模型、显式传三元组及 description 标注。内容测试不证明 skill 一定被遵守，也不证明表内模型当前被授权。
- 所有测试均尚未运行；实施时逐行变绿。无需为已删除的工具、日志、恢复按钮、异步分类或全局开关建立测试。
