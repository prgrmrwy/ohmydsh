门禁：第 5 轮 APPROVE_WITH_CHANGES，定点复核 CHANGES_APPLIED: yes。按 design 实现、按 test-plan 的 33 行验收；以下每组先观察正确失败，再实现，再重构。当前均未实施。测试路径相对 `packages/auto-model-routing/`。

## 1. 包骨架

- [x] 1.1 建立 `packages/auto-model-routing/` Host/client bundle 与 vitest 配置，复用现有 guard 包的构建布局；不添加占位框架。证明：package build/typecheck 与测试发现正常。安装依赖前先 ws promote。

## 2. 同步分类与映射（依赖 1）

- [x] 2.1 在 `test/classifier.test.ts` 写失败测试：classifier_fixture_tiers、classifier_closed_set_and_blank、standard_maps_medium、intent_precedence、classifier_cannot_escalate、effort_clamps_to_supported；运行并确认失败原因。
- [x] 2.2 实现纯函数分类、三类意图词表、固定主模型 effort 表与支持值裁剪，使 2.1 通过；不增加异步接口或配置系统。
- [x] 2.3 重构上述分类/映射职责；package 全套测试保持通过。

## 3. 输入与会话小状态（依赖 2）

- [x] 3.1 在 `test/input.test.ts` 和 `test/state.test.ts` 写失败测试：first_claim_user_only、ordered_text_bounded_utf16、repeated_mode_is_noop、initialize_anchor_once、selection_updates_anchor、anchor_survives_restart_without_drift；包含已有历史最新手选与过渡跨重启。
- [x] 3.2 实现可信文本聚合、按会话持久化模式/锚点/复原义务、重复设置幂等；不从 AUTO 请求头刷新锚点，使 3.1 通过。
- [x] 3.3 重构会话状态与输入代码；package 全套测试保持通过。

## 4. 主会话路由与官方集成（依赖 3）

- [x] 4.1 在 `test/router.test.ts` 写失败测试：manual_passthrough、auto_effort_only、rapid_mode_toggle_invalidates_auto、notification_turn_restores、turn_retries_reuse_decision、nonuser_turn_reuses_level、child_passthrough、unsupported_and_unclassified_passthrough、guard_failure_never_changes_model；运行确认失败。
- [x] 4.2 实现 step-1 同步分类、每 Agent 当前决定 WeakMap、外层 request listener、MANUAL 废止旧决定与复原优先，满足 4.1；始终保留官方 provider/model。
- [x] 4.3 重构路由职责；package 全套测试保持通过。
- [x] 4.4 用真实 DSH AgentLoop/selection/projection 写 `test/selection.integration.test.ts` 失败测试：restore_survives_retry_until_convergence、restore_survives_preheader_failure、selection_after_assembly_keeps_routes_legal。模拟 LLM 错误/取消而非复制官方实现；确认可触发旧快照问题。
- [x] 4.5 将复原完成条件落实为持久 header 与当前官方配置双收敛，模型不匹配时等待；按实际输出模型映射 effort，使 4.4 通过。核实真实注入与 waterfall 注册顺序。
- [x] 4.6 重构集成与路由；package 全套测试保持通过。

## 5. 子会话 skill 与内容检查（依赖 2）

- [x] 5.1 在 `test/content.test.ts` 写失败测试：source_has_no_egress_primitives、skill_required_guidance、skill_tier_table、skill_provider_family；直接读取文件断言，不创建专用检查脚本。
- [x] 5.2 编写 `skills/subagent-model-routing/SKILL.md`，包括档位表、官方可用模型查询、三元组显式参数、标注/复用与独立体系规则；清除源码外发路径，使 5.1 通过，不新增路由工具或第二份运行时子会话表。
- [x] 5.3 重构 skill 与内容测试；package 全套测试保持通过。

## 6. 两个 Host 端点（依赖 3、4）

- [x] 6.1 在 `test/endpoints.test.ts` 写失败测试：reject_invalid_session_without_mutation、mutate_target_only；额外覆盖非法 mode。
- [x] 6.2 经已认证 connection 注册 state/setMode，解析目标普通会话，验证输入，且只修改目标会话；使 6.1 通过。不新增 restore/clear/global-toggle 接口。
- [x] 6.3 重构端点；package 全套测试保持通过。

## 7. Composer 芯片与面板（依赖 6）

- [x] 7.1 在 `test/client.test.ts` 写失败测试：chip_negative_order、panel_state_and_history_bound、toggle_plugin_endpoint_only；覆盖最近 20 条及重启清空。
- [x] 7.2 实现 order -10 芯片与面板，通过插件 state/setMode 读写；每 Agent 历史仅内存且不存正文，释放后不保留；使 7.1 通过。
- [x] 7.3 重构 client 与内存状态；package 全套测试保持通过。

## 8. 登记与验收（依赖 1–7）

- [x] 8.1 在 `dsh.yaml` 登记默认禁用 local package 与 skill，补 package 文档，写清切 MANUAL 并等待请求复原后再禁用；不改实时部署。运行根目录 `npm test`、`npm run check:artifacts`。
- [x] 8.2 运行 package `npm run build`、`npm run typecheck`、`npm test`，逐一核对 test-plan 33 行后变绿；在隔离 DSH_HOME 连续 sync 两次验证幂等与 host/client 同批构建。
- [ ] 8.3 用户授权启用后，在现有 GUI 核对芯片顺序、模式/effort 状态，并做一次真实子会话委派观察显式参数与标注；按 anvil verify 模板记录实际证据。未授权则如实保留待验收，不另启服务器替代当前 GUI。
- [x] 8.4 执行 `openspec validate auto-model-routing --strict`，确认规范、测试映射与完成状态一致；未经授权不合入、归档或清理工作树。
