门禁：第 6 轮 APPROVE_WITH_CHANGES，定点复核 CHANGES_APPLIED: yes。按 design 实现、按 test-plan 的 43 行验收；每组先观察正确失败，再实现，再重构。测试路径相对 `packages/auto-model-routing/`。首版代码（`13f1587b`）中复原、锚点、映射、端点、client 已验证的部分沿用，按新语义改写其测试并重新观察失败。

## 1. 移除本地分类器

- [x] 1.1 写失败测试 `content.test.ts › no_local_classifier_or_other_egress`：源码无 `classify`/词表导出，唯一出站主机为 `openrouter.ai`，无 `node:http(s)`/`node:child_process`。确认因 `classifier.ts` 仍导出 `classify` 而失败。
- [x] 1.2 删除 `classify`/`resolveLevel`/词表及其测试，把 `mapEffort`、档位与 effort 类型移到 `src/effort.ts`；`Reason` 改为 `jev | continued | no-effort-support | manual-restore | jev-failed`。1.1 中“无本地分类”部分通过（出站部分待第 3 组）。
- [x] 1.3 重构 router 对级别来源的依赖（暂以注入的档位驱动），既有 router/state/selection 测试保持绿。

## 2. effort 映射与子会话表

- [x] 2.1 写失败测试 `effort.test.ts › maps_tier_to_effort`、`clamps_unsupported_effort`、`child_table_matches_design_and_family`（断言 D9 子会话常量与 Claude 家族规则）；确认子会话常量不存在而失败。
- [x] 2.2 在 `src/effort.ts` 增加子会话表常量 `CHILD_TABLE`，使 2.1 通过。
- [x] 2.3 重构；全套保持绿。

## 3. Jev 客户端

- [ ] 3.1 写失败测试 `jev.test.ts › request_body_and_limits`、`redirect_is_rejected`、`failure_categories`（本地回环假服务覆盖全部状态码、302、超时、断连、非 JSON、非法 choice、200+`error.code`、缺凭据不发请求；三态返回含 `cancelled`）。确认因 `src/jev.ts` 不存在而失败。
- [ ] 3.2 实现 `src/jev.ts`：`TIER_QUESTIONS` 常量（design D4 原文）、`fetch` + `redirect:'error'` + 3000ms + 无重试 + 64 KiB 上限、三态结果、闭集类别；凭据经注入的 launch environment 每次读取。使 3.1 与 1.1 出站部分通过。
- [ ] 3.3 重构；全套保持绿。

## 4. 状态：停用记录

- [ ] 4.1 扩充失败测试：`state.test.ts` 增加 `disabled` 持久化与旧文件可读、schema 拒绝非法 category；`router.test.ts › no_effort_support_passthrough`、`auto_effort_only`、`turn_retries_reuse_decision`、`nonuser_turn_reuses_level`、`notification_turn_restores`、`rapid_mode_toggle_invalidates_auto`、`child_passthrough`、`guard_failure_never_changes_model`、`new_model_same_turn_remaps_effort`、`manual_passthrough` 改为新原因闭集（`jev`/`continued`）。确认按新断言失败。
- [ ] 4.2 实现 `SessionState.disabled`、`RoutingState.disable/setMode(AUTO 清除)`，router 以 Jev 结果（成功档位或失败类别）为输入；使 4.1 通过。
- [ ] 4.3 重构；全套保持绿。

## 5. Host 接线：pre-step 判断、停用、竞态、取消

- [ ] 5.1 写失败测试 `host.integration.test.ts › jev_tier_drives_effort`、`rejected_step_skips_jev`、`mode_change_during_jev_discards_result`、`failure_disables_and_restores`、`auto_clears_disabled`、`cancel_is_not_failure`、`no_secret_or_body_leak`（真实 AgentLoop + 假 Jev 服务 + 注入凭据）。确认失败原因是仍未调用 Jev。
- [ ] 5.2 实现 `index.ts`：pre-step 先 `await next()`，`enter` 时判断用户回合并 `await` Jev；返回后重读状态，模式变化则丢弃；失败调用 `disable`；取消不停用。保留 `selection-projection`、端点与仅 AUTO 时查询模型元数据。使 5.1 通过。
- [ ] 5.3 改写并重新观察 `selection.integration.test.ts › manual_restore_survives_same_step_retry`、`restore_survives_preheader_failure`、`selection_after_assembly_keeps_routes_legal` 在 Jev 驱动下仍成立；`input.test.ts › only_user_source_contributes`、`joins_and_truncates_user_text` 保持；`state.test.ts › repeated_mode_is_noop`、`initialize_anchor_once`、`selection_updates_anchor`、`anchor_survives_restart_without_drift` 保持（其被测行为未变，若首次运行即绿须如实记录为沿用而非新红）。
- [ ] 5.4 重构；全套保持绿。

## 6. 子会话工具与 skill

- [ ] 6.1 写失败测试 `subagent-tool.test.ts › tool_returns_table_entry`、`tool_failure_reports_without_state_change`（含取消返回“已取消”），`host.integration.test.ts › main_and_tool_share_questions`，`content.test.ts › skill_contains_seven_rules`。确认因工具未注册、skill 仍为档位表而失败。
- [ ] 6.2 用 `defineTool` 注册 `route_subagent`（`timeoutMs` 5000，描述说明外发），复用 Jev 客户端与 `CHILD_TABLE`；改写 skill 为七项规则且不含模型名。使 6.1 通过。
- [ ] 6.3 重构；全套保持绿。

## 7. 端点与 client

- [ ] 7.1 写失败测试 `endpoints.test.ts › invalid_targets_rejected`、`set_mode_targets_one_session`（state 返回 `disabled`，setMode AUTO 清除）；`client.test.ts › chip_negative_order`、`panel_state_and_history_bound`（`reason: jev`）、`disabled_visible_in_chip_and_panel`、`toggle_plugin_endpoint_only`。确认停用显示相关断言失败。
- [ ] 7.2 实现：state 响应带 `disabled`；芯片可见文本 `MANUAL · Jev 停用` + 警示样式、title 类别提示；面板类别/提示/时间/“点击 AUTO 重试”；历史 `jev-failed` 含类别。使 7.1 通过。
- [ ] 7.3 重构；全套保持绿。

## 8. 登记与验收

- [ ] 8.1 更新 package README（中英）、`dsh.yaml` note：外发对象、保留条款未确认、凭据、停用语义、开关耦合；保持默认禁用。运行根 `npm test`、`npm run check:artifacts`。
- [ ] 8.2 运行 package `npm run typecheck`、`npm test`、`npm run build`；逐行核对 test-plan 43 行转绿；隔离 DSH_HOME 连续 sync 两次。
- [ ] 8.3 手动冒烟（会计费）：用最终 `TIER_QUESTIONS` 对 spike 10 条样本经真实 OpenRouter 重跑，记录档位/耗时/费用；与 spike 不一致则停下回到规划。
- [ ] 8.4 用户授权启用后，在现有 GUI 验证芯片、模式、停用显示与一次真实子会话委派；未授权则如实保留待验收。
- [ ] 8.5 执行 `openspec validate auto-model-routing --strict`，写 verify.md；未经授权不合入、归档或清理工作树。
