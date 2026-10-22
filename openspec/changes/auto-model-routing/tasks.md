门禁：第 7 轮 review `APPROVE_WITH_CHANGES` 且 `CHANGES_APPLIED: yes` 后执行。按 design 实现，按 test-plan 的 66 行验收；每个 🔴 场景先写测试并观察它因正确的原因失败，再实现，再重构。测试路径相对 `packages/auto-model-routing/`。首版与 2026-10-21 的任务记录在 `history/*.2026-10-21`，已完成的部分沿用。

## 1. 规则单一来源与上一轮上下文

- [x] 1.1 写失败测试 `jev.test.ts › rubric_version_is_content_hash`：`TIER_QUESTIONS` 深度等于 `src/rubric.json`，`rubricVersion` 为其内容哈希前 8 位，改一个字符版本即变；`escalated` 的“升一级”仍为 `escalated`。确认因 `TIER_QUESTIONS` 仍是内联旧规则而失败。
- [x] 1.2 `jev.ts` 从 `src/rubric.json` 读入 `TIER_QUESTIONS`（tsc `resolveJsonModule` 或构建复制，二选一保证 `lib/` 可用），导出 `rubricVersion` 与 `tierAbove`。使 1.1 通过。
- [x] 1.3 写失败测试 `context.test.ts › redact_covers_shapes_before_truncation`、`previous_turn_truncated_and_redacted`、`first_turn_state_has_no_context`。确认因 `redact`/`buildState` 不存在而失败。
- [x] 1.4 新建 `src/context.ts`（本回合分类输入也先经 `redact` 再截 8000，见 spec“用户回合与分类输入”；design D4 首段的文字补同一说明，属复核记录的非阻塞措辞项）：`redact`（spec 六条正则，按序）、`previousTurn(messages)`（从 `deriveMessages()` 结果倒序取上一条用户消息与最后一条含文本的助手消息）、`buildState({previous, prevUser, prevAssistant, text})`（先脱敏后截断）。使 1.3 通过。
- [x] 1.5 写失败测试 `host.integration.test.ts › state_carries_previous_turn`、`previous_tier_survives_restart`（新首行含 `(one tier above: …)`）、`jev_tier_drives_effort`（complex → high）。确认失败。
- [x] 1.6 `index.ts` pre-step 中在 `router.begin` 后读取 `payload.agent.session.deriveMessages()`，组装 state 后调用 Jev；`JevClient.judge` 改为接收组装好的 state。使 1.5 通过。
- [x] 1.7 重构；全套保持绿。

## 2. effort 起点表

- [x] 2.1 写失败测试 `effort.test.ts › maps_tier_to_effort`、`starting_points_float_and_cap_at_xhigh`、`clamps_unsupported_effort`；`router.test.ts › no_effort_support_passthrough`（含只支持 `[max]`）、`new_model_same_turn_remaps_effort`（Opus high → Astra medium）。确认按新断言失败。
- [x] 2.2 `effort.ts` 改为起点常量 + 档位偏移 + 封顶 `xhigh` + 与 `{low,medium,high,xhigh}` 取交集的截断；删除旧映射表。使 2.1 通过。
- [x] 2.3 重构；全套保持绿。

## 3. 子会话工具

- [ ] 3.1 写失败测试 `subagent-tool.test.ts › tool_returns_table_entry`（8 组枚举）、`child_model_not_capped_by_caller`、`manual_root_skips_jev`（MANUAL、Jev 停用、父会话不在 live 注册表三种，假 Jev 0 次请求）、`nested_child_follows_root_mode`、`tool_failure_reports_without_state_change`（AUTO 下 402）。确认失败。
- [ ] 3.2 `effort.ts` 增加 `CHILD_MODELS`（只含模型）并由起点规则计算 effort；`subagent-tool.ts` 经 `ctx.agents.get(header.parentSession)` 上溯到根会话、按根会话 id 读 `RoutingState`，非 AUTO 返回 `{routed: false, reason: 'manual'}`；任务文本先 `redact`。工具注册改为能拿到 `agents` 与状态。使 3.1 通过。
- [ ] 3.3 写失败测试 `content.test.ts › skill_contains_eight_rules`；改 `skills/subagent-model-routing/SKILL.md` 增加第 8 条（`routed: false` 时按官方默认委派、不询问）。使其通过。
- [ ] 3.4 写失败测试 `host.integration.test.ts › main_decision_toast`、`subagent_decision_toast`（effort 新值；子会话提示只在调用会话为 AUTO 时出现）与 `client.test.ts › panel_shows_latest_decision`（complex → high）。按需改实现使其通过。
- [ ] 3.5 重构；全套保持绿。

## 4. 判档记录与标注端点

- [ ] 4.1 写失败测试 `host.integration.test.ts › judgement_line_appended_without_text`、`no_judgement_line_for_failure_cancel_child_continued`、`judgement_write_failure_is_harmless`、`label_query_and_append_by_message`（含 MANUAL 回合后的 continued 消息返回 `{}`）、`label_append_failure_returns_5xx`；`endpoints.test.ts › label_rejects_invalid_and_ignores_unknown`。确认失败。
- [ ] 4.2 新建 `src/judgements.ts`：追加写 `judgements.jsonl`（判档行、标注行），读取时按 `(sessionId, turn)` 折叠并跳过坏行；写失败只记日志。在 `Router.judged()` 的主会话调用点写判档行（无 effort 时也写，省略 `effort`）。
- [ ] 4.3 `index.ts` 订阅 `session/event`，维护每会话 `messageId → turn`，continued 回合的消息记到最近一个有判档的用户回合；注册 `auto-model-routing.label` 端点（同现有 envelope 与授权）。使 4.1 通过。
- [ ] 4.4 写失败测试 `label-report.test.ts › report_folds_by_version_and_skips_bad_lines`；实现零依赖 `scripts/label-report.mjs`。使其通过。
- [ ] 4.5 重构；全套保持绿。

## 5. 回复操作栏档位按钮

- [ ] 5.1 写失败测试 `label-button.dom.test.ts › button_only_when_judged`、`tooltip_and_menu_content`、`selection_calls_label_only`（jsdom，官方 primitives 以测试替身注入）。确认因操作项未注册而失败。
- [ ] 5.2 client 注册 `conversation.chat.assistant-actions`（order 20，`inject(sessionId)`），用 `Tooltip`、`Menu`、`IconGaugeOutlineRegular` 与操作栏按钮 class；`package.json` 的 `dsh.client.inject` 增加 `@deepseek-ai/dsh-client-ui-chat`（如插槽归属需要）。使 5.1 通过。
- [ ] 5.3 重构；全套保持绿。

## 6. 派发规则与评估脚本

- [ ] 6.1 写失败测试 `tests/agent-instructions-dispatch.test.mjs › dispatch_rules_present_without_model_names`（仓库根 `node --test`）。确认因指令文件无该节而失败。
- [ ] 6.2 在 `instructions/dsh-home.md` 增加“子会话派发”一节（含不派发、子会话不再向下派发、`route_subagent` 一句，不含模型名与 effort 值）。使 6.1 通过。
- [ ] 6.3 写失败测试 `eval-runner.test.ts › runner_exit_codes_and_shared_state`（回环假 Jev：全按基线 → 0，基线外新未命中 → 1，HTTP 500 → 2；脚本与 Host 对同一用例的 state 逐字相等）。确认因 `eval/run.mjs` 不存在而失败。
- [ ] 6.4 实现 `eval/run.mjs`：从 `lib/` 导入 `TIER_QUESTIONS` 与 `buildState`，`--base` 指定服务地址，三次取多数，按 `baseline.json` 判定退出码，请求失败单列。使 6.3 通过。
- [ ] 6.5 重构；全套保持绿。

## 7. 沿用测试复核

- [ ] 7.1 运行全套，确认 test-plan 中 🟢 的 33 行仍通过；任何因新常量或签名而需改断言的，按 🔴 记录观察到的失败后再改。

## 8. 文档与登记

- [ ] 8.1 更新 package README（中英）：判档规则、effort 起点、子会话表与 MANUAL 行为、上一轮上下文与脱敏（尽力而为）、判档记录位置与统计脚本、白名单须包含的五条路由且对新会话生效。更新 `dsh.yaml` note（外发范围含助手回复片段、子会话只在 AUTO 时判档）。
- [ ] 8.2 运行 package `npm run typecheck`、`npm test`、`npm run build`；根 `npm test`、`npm run check:artifacts`；隔离 DSH_HOME 连续 `node scripts/sync.mjs` 两次，第二次无变化；`openspec validate auto-model-routing`。逐行把 test-plan 翻绿。

## 9. 验收（需用户在场或授权）

- [ ] 9.1 真实回归（会产生少量费用）：`OPENROUTER_API_KEY=… node eval/run.mjs`，退出 0；出现基线外新未命中则停下回到规划。
- [ ] 9.2 用户授权部署后，在**新建会话**中验证：AUTO 判档与 effort（含 session-4390 类请求落在 medium/high）、档位按钮与标注、MANUAL 下委派不判档、AUTO 下一次复杂委派使用 opus/sol 且不被白名单拒绝。
- [ ] 9.3 写 verify.md；未经授权不合入、归档或清理工作树。

## 实施记录

- 第 1–2 组（2026-10-22）：`rubric.json` 以 `import … with { type: 'json' }` 读入，tsc 开 `resolveJsonModule` 后 `lib/rubric.json` 随构建输出（选 tsc 方案）。本回合输入在 `input.ts` 中先 `redact` 再截 8000（新增 `input.test.ts › redacts_before_bounding`，先观察到失败）。`JevClient.judge(state, signal)` 改为接收组装好的 state。沿用测试中 14 条因新常量（complex：xhigh → high）失败，观察到的失败全部是 effort 值 `xhigh`/`high` 之差，按新映射改断言；`client.test.ts › panel_state_and_history_bound` 改用 `escalated` 以继续断言 `xhigh` 的显示。`CHILD_TABLE` 留到第 3 组替换。
