# Implementation Tasks

依据 spec（WHAT）与 design D1–D12（HOW）的 red-green-refactor 顺序执行；每个 scenario 的具名测试见 [test-plan.md](test-plan.md)。先做第 1 组基础设施，再按依赖推进。

## 1. 基础设施、seam 与 hermeticity

- [ ] 1.1 与 cross-platform-launcher owner 协调 `tests/helpers/launcher-fixture.mjs`/`node-harness.mjs` 的最小 seam 扩展，记录其 archive-order 依赖与冻结 baseline commit（写入 verify 计划）
- [ ] 1.2 实现 `scripts/launcher/session-context.mjs`、`restart-state.mjs`、`restart-receipt.mjs`、`detach.mjs` 与 `runLauncher` seam（sessionContext/schedule/receipt/spawn/clock），先加 seam 测试证明默认外部路径调用序列不变
- [ ] 1.3 扩展 generated `node-harness.mjs` 传递 sessionContext（或转发 NODE_TEST_CONTEXT+gate env），`tests/launcher-{contract,lifecycle,preview}.test.mjs` 显式传 external；`tests/fixtures/launcher-bash-baseline/` 不改
- [ ] 1.4 新增 guard：从 DSH 会话跑 launcher 套件创建零 transient scope/零 capability probe；未设 NODE_TEST_CONTEXT 时 override 被忽略；普通 agent env 不能被强制 external

## 2. D1 会话语境判定（design D1）

- [ ] 2.1 Write failing test `test_linux_subprocess_scope_is_session` in `tests/launcher-session-context.test.mjs` for scenario「Linux 普通子进程 range 判为会话内」（assert fails for the right reason）
- [ ] 2.2 Implement「Linux 普通子进程 range 判为会话内」behavior per design；run `test_linux_subprocess_scope_is_session` to pass（会话语境判定必须先于任何副作用，优先级确定且覆盖全部 Host 管理的执行范围）
- [ ] 2.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 2.4 Write failing test `test_linux_terminal_scope_without_markers_is_session` in `tests/launcher-session-context.test.mjs` for scenario「终端 range 且会话标记被剥离仍判为会话内」（assert fails for the right reason）
- [ ] 2.5 Implement「终端 range 且会话标记被剥离仍判为会话内」behavior per design；run `test_linux_terminal_scope_without_markers_is_session` to pass（会话语境判定必须先于任何副作用，优先级确定且覆盖全部 Host 管理的执行范围）
- [ ] 2.6 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 2.7 Write failing test `test_linux_marker_cgroup_conflict_fails_closed` in `tests/launcher-session-context.test.mjs` for scenario「标记与可读 cgroup 冲突时 fail-closed」（assert fails for the right reason）
- [ ] 2.8 Implement「标记与可读 cgroup 冲突时 fail-closed」behavior per design；run `test_linux_marker_cgroup_conflict_fails_closed` to pass（会话语境判定必须先于任何副作用，优先级确定且覆盖全部 Host 管理的执行范围）
- [ ] 2.9 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 2.10 Write failing test `test_unreadable_cgroup_and_invalid_args_have_no_side_effects` in `tests/launcher-session-context.test.mjs` for scenario「cgroup 不可读或外部路径参数非法」（assert fails for the right reason）
- [ ] 2.11 Implement「cgroup 不可读或外部路径参数非法」behavior per design；run `test_unreadable_cgroup_and_invalid_args_have_no_side_effects` to pass（会话语境判定必须先于任何副作用，优先级确定且覆盖全部 Host 管理的执行范围）
- [ ] 2.12 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 2.13 Write failing test `test_non_linux_marker_or_ancestor_fails_closed` in `tests/launcher-session-context.test.mjs` for scenario「非 Linux 有标记或可证祖先时 fail-closed」（assert fails for the right reason）
- [ ] 2.14 Implement「非 Linux 有标记或可证祖先时 fail-closed」behavior per design；run `test_non_linux_marker_or_ancestor_fails_closed` to pass（会话语境判定必须先于任何副作用，优先级确定且覆盖全部 Host 管理的执行范围）
- [ ] 2.15 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 2.16 Write failing test `test_external_terminal_takes_sync_path` in `tests/launcher-session-context.test.mjs` for scenario「外部终端不被误判」（assert fails for the right reason）
- [ ] 2.17 Implement「外部终端不被误判」behavior per design；run `test_external_terminal_takes_sync_path` to pass（会话语境判定必须先于任何副作用，优先级确定且覆盖全部 Host 管理的执行范围）
- [ ] 2.18 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 3. D2 三段握手、marker/nonce、GRACE 与 stdio（design D2/D3）

- [ ] 3.1 Write failing test `test_ready_scheduled_go_grace_before_stop` in `tests/launcher-restart-handshake.test.mjs` for scenario「支持平台返回前不停止 Host（含 GRACE）」（assert fails for the right reason）
- [ ] 3.2 Implement「支持平台返回前不停止 Host（含 GRACE）」behavior per design；run `test_ready_scheduled_go_grace_before_stop` to pass（会话内 restart 必须完成三段握手 + marker/nonce 协议 + 结果投递宽限，且排程子进程/stdio 生命周期确定）
- [ ] 3.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 3.4 Write failing test `test_scheduled_or_go_write_failure_aborts_without_stop` in `tests/launcher-restart-handshake.test.mjs` for scenario「scheduled/go 写失败不停止 Host」（assert fails for the right reason）
- [ ] 3.5 Implement「scheduled/go 写失败不停止 Host」behavior per design；run `test_scheduled_or_go_write_failure_aborts_without_stop` to pass（会话内 restart 必须完成三段握手 + marker/nonce 协议 + 结果投递宽限，且排程子进程/stdio 生命周期确定）
- [ ] 3.6 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 3.7 Write failing test `test_missing_ready_does_not_claim_scheduled` in `tests/launcher-restart-handshake.test.mjs` for scenario「排程未 ack 时不宣称成功」（assert fails for the right reason）
- [ ] 3.8 Implement「排程未 ack 时不宣称成功」behavior per design；run `test_missing_ready_does_not_claim_scheduled` to pass（会话内 restart 必须完成三段握手 + marker/nonce 协议 + 结果投递宽限，且排程子进程/stdio 生命周期确定）
- [ ] 3.9 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 3.10 Write failing test `test_truncated_or_nonce_mismatched_marker_fails_closed` in `tests/launcher-restart-handshake.test.mjs` for scenario「marker 截断或 nonce 不匹配时 fail-closed」（assert fails for the right reason）
- [ ] 3.11 Implement「marker 截断或 nonce 不匹配时 fail-closed」behavior per design；run `test_truncated_or_nonce_mismatched_marker_fails_closed` to pass（会话内 restart 必须完成三段握手 + marker/nonce 协议 + 结果投递宽限，且排程子进程/stdio 生命周期确定）
- [ ] 3.12 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 3.13 Write failing test `test_unsupported_platform_or_probe_failure_zero_side_effects` in `tests/launcher-restart-handshake.test.mjs` for scenario「不支持环境 fail-closed 且零副作用」（assert fails for the right reason）
- [ ] 3.14 Implement「不支持环境 fail-closed 且零副作用」behavior per design；run `test_unsupported_platform_or_probe_failure_zero_side_effects` to pass（会话内 restart 必须完成三段握手 + marker/nonce 协议 + 结果投递宽限，且排程子进程/stdio 生命周期确定）
- [ ] 3.15 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 3.16 Write failing test `test_argv_metacharacters_preserved_without_shell` in `tests/launcher-restart-handshake.test.mjs` for scenario「恶意/特殊字符路径不破坏排程命令」（assert fails for the right reason）
- [ ] 3.17 Implement「恶意/特殊字符路径不破坏排程命令」behavior per design；run `test_argv_metacharacters_preserved_without_shell` to pass（会话内 restart 必须完成三段握手 + marker/nonce 协议 + 结果投递宽限，且排程子进程/stdio 生命周期确定）
- [ ] 3.18 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 3.19 Write failing test `test_session_foreground_rejected` in `tests/launcher-restart-handshake.test.mjs` for scenario「会话内 --foreground 被拒绝」（assert fails for the right reason）
- [ ] 3.20 Implement「会话内 --foreground 被拒绝」behavior per design；run `test_session_foreground_rejected` to pass（会话内 restart 必须完成三段握手 + marker/nonce 协议 + 结果投递宽限，且排程子进程/stdio 生命周期确定）
- [ ] 3.21 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 3.22 Write failing test `test_state_dir_preexisting_or_invalid_fails_closed` in `tests/launcher-restart-handshake.test.mjs` for scenario「状态目录预存在或异常时 fail-closed」（assert fails for the right reason）
- [ ] 3.23 Implement「状态目录预存在或异常时 fail-closed」behavior per design；run `test_state_dir_preexisting_or_invalid_fails_closed` to pass（会话内 restart 必须完成三段握手 + marker/nonce 协议 + 结果投递宽限，且排程子进程/stdio 生命周期确定）
- [ ] 3.24 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 4. D3/D4 编排、expected/epoch、并发与预览（design D4/D5/D6/D8）

- [ ] 4.1 Write failing test `test_success_phase_sequence` in `tests/launcher-restart-orchestration.test.mjs` for scenario「成功编排的阶段序列」（assert fails for the right reason）
- [ ] 4.2 Implement「成功编排的阶段序列」behavior per design；run `test_success_phase_sequence` to pass（会话路径必须复用同一 launcher 编排，并定义 expected 身份、epoch 复验、并发 churn 与旧进程退出证明）
- [ ] 4.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 4.4 Write failing test `test_prepare_failure_keeps_old_host` in `tests/launcher-restart-orchestration.test.mjs` for scenario「准备阶段失败不停止旧 Host」（assert fails for the right reason）
- [ ] 4.5 Implement「准备阶段失败不停止旧 Host」behavior per design；run `test_prepare_failure_keeps_old_host` to pass（会话路径必须复用同一 launcher 编排，并定义 expected 身份、epoch 复验、并发 churn 与旧进程退出证明）
- [ ] 4.6 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 4.7 Write failing test `test_expected_replaced_or_vanished_epoch` in `tests/launcher-restart-orchestration.test.mjs` for scenario「expected 身份被替换或消失」（assert fails for the right reason）
- [ ] 4.8 Implement「expected 身份被替换或消失」behavior per design；run `test_expected_replaced_or_vanished_epoch` to pass（会话路径必须复用同一 launcher 编排，并定义 expected 身份、epoch 复验、并发 churn 与旧进程退出证明）
- [ ] 4.9 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 4.10 Write failing test `test_probe_error_or_multi_listener_no_schedule` in `tests/launcher-restart-orchestration.test.mjs` for scenario「probe 不可归属或多监听者时不排程」（assert fails for the right reason）
- [ ] 4.11 Implement「probe 不可归属或多监听者时不排程」behavior per design；run `test_probe_error_or_multi_listener_no_schedule` to pass（会话路径必须复用同一 launcher 编排，并定义 expected 身份、epoch 复验、并发 churn 与旧进程退出证明）
- [ ] 4.12 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 4.13 Write failing test `test_empty_expected_skips_stop_or_superseded` in `tests/launcher-restart-orchestration.test.mjs` for scenario「排程时端口为空也能安全启动」（assert fails for the right reason）
- [ ] 4.14 Implement「排程时端口为空也能安全启动」behavior per design；run `test_empty_expected_skips_stop_or_superseded` to pass（会话路径必须复用同一 launcher 编排，并定义 expected 身份、epoch 复验、并发 churn 与旧进程退出证明）
- [ ] 4.15 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 4.16 Write failing test `test_session_restart_preview_uses_preview_record_identity` in `tests/launcher-preview.test.mjs` for scenario「预览 home 使用 preview record 身份」（assert fails for the right reason）
- [ ] 4.17 Implement「预览 home 使用 preview record 身份」behavior per design；run `test_session_restart_preview_uses_preview_record_identity` to pass（会话路径必须复用同一 launcher 编排，并定义 expected 身份、epoch 复验、并发 churn 与旧进程退出证明）
- [ ] 4.18 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 4.19 Write failing test `test_concurrent_restart_churn_superseded_history` in `tests/launcher-restart-epoch.test.mjs` for scenario「并发 restart churn 被显式接受并可对账」（assert fails for the right reason）
- [ ] 4.20 Implement「并发 restart churn 被显式接受并可对账」behavior per design；run `test_concurrent_restart_churn_superseded_history` to pass（会话路径必须复用同一 launcher 编排，并定义 expected 身份、epoch 复验、并发 churn 与旧进程退出证明）
- [ ] 4.21 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 4.22 Write failing test `test_handoff_exit_not_proven_no_start` in `tests/launcher-restart-epoch.test.mjs` for scenario「旧进程未退出不启动替代 Host」（assert fails for the right reason）
- [ ] 4.23 Implement「旧进程未退出不启动替代 Host」behavior per design；run `test_handoff_exit_not_proven_no_start` to pass（会话路径必须复用同一 launcher 编排，并定义 expected 身份、epoch 复验、并发 churn 与旧进程退出证明）
- [ ] 4.24 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 4.25 Write failing test `test_replacement_early_exit_failed_start` in `tests/launcher-restart-epoch.test.mjs` for scenario「替代 Host 早退或未就绪」（assert fails for the right reason）
- [ ] 4.26 Implement「替代 Host 早退或未就绪」behavior per design；run `test_replacement_early_exit_failed_start` to pass（会话路径必须复用同一 launcher 编排，并定义 expected 身份、epoch 复验、并发 churn 与旧进程退出证明）
- [ ] 4.27 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 4.28 Write failing test `test_external_session_build_preview_env_parity` in `tests/launcher-restart-epoch.test.mjs` for scenario「两条路径的 build/preview/env 语义一致」（assert fails for the right reason）
- [ ] 4.29 Implement「两条路径的 build/preview/env 语义一致」behavior per design；run `test_external_session_build_preview_env_parity` to pass（会话路径必须复用同一 launcher 编排，并定义 expected 身份、epoch 复验、并发 churn 与旧进程退出证明）
- [ ] 4.30 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 4.31 Write failing test `test_orchestrator_death_after_stop_incomplete_history` in `tests/launcher-restart-epoch.test.mjs` for scenario「orchestrator 在 stop 后死亡」（assert fails for the right reason）
- [ ] 4.32 Implement「orchestrator 在 stop 后死亡」behavior per design；run `test_orchestrator_death_after_stop_incomplete_history` to pass（会话路径必须复用同一 launcher 编排，并定义 expected 身份、epoch 复验、并发 churn 与旧进程退出证明）
- [ ] 4.33 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 5. D7 receipt 与 dsh history（design D7）

- [ ] 5.1 Write failing test `test_history_ready_after_reconnect` in `tests/launcher-restart-receipt.test.mjs` for scenario「成功重启可在重连后验证」（assert fails for the right reason）
- [ ] 5.2 Implement「成功重启可在重连后验证」behavior per design；run `test_history_ready_after_reconnect` to pass（restart 结果必须持久且可对有界查询；receipt 的 SHALL 必须可满足）
- [ ] 5.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 5.4 Write failing test `test_history_failed_start` in `tests/launcher-restart-receipt.test.mjs` for scenario「启动失败可在重连后定位」（assert fails for the right reason）
- [ ] 5.5 Implement「启动失败可在重连后定位」behavior per design；run `test_history_failed_start` to pass（restart 结果必须持久且可对有界查询；receipt 的 SHALL 必须可满足）
- [ ] 5.6 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 5.7 Write failing test `test_refusal_or_unwritable_receipt_exemption` in `tests/launcher-restart-receipt.test.mjs` for scenario「拒绝或持久化不可用路径不要求 receipt」（assert fails for the right reason）
- [ ] 5.8 Implement「拒绝或持久化不可用路径不要求 receipt」behavior per design；run `test_refusal_or_unwritable_receipt_exemption` to pass（restart 结果必须持久且可对有界查询；receipt 的 SHALL 必须可满足）
- [ ] 5.9 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 5.10 Write failing test `test_late_events_stale_run_file_order` in `tests/launcher-restart-receipt.test.mjs` for scenario「迟到事件、陈旧 run 与文件行序」（assert fails for the right reason）
- [ ] 5.11 Implement「迟到事件、陈旧 run 与文件行序」behavior per design；run `test_late_events_stale_run_file_order` to pass（restart 结果必须持久且可对有界查询；receipt 的 SHALL 必须可满足）
- [ ] 5.12 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 5.13 Write failing test `test_in_progress_vs_ended_vs_abandoned` in `tests/launcher-restart-receipt.test.mjs` for scenario「in progress、orchestrator-ended 与 abandoned 区分」（assert fails for the right reason）
- [ ] 5.14 Implement「in progress、orchestrator-ended 与 abandoned 区分」behavior per design；run `test_in_progress_vs_ended_vs_abandoned` to pass（restart 结果必须持久且可对有界查询；receipt 的 SHALL 必须可满足）
- [ ] 5.15 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 5.16 Write failing test `test_probe_unavailable_unknown_incomplete` in `tests/launcher-restart-receipt.test.mjs` for scenario「ownership probe 失败不显示 abandoned」（assert fails for the right reason）
- [ ] 5.17 Implement「ownership probe 失败不显示 abandoned」behavior per design；run `test_probe_unavailable_unknown_incomplete` to pass（restart 结果必须持久且可对有界查询；receipt 的 SHALL 必须可满足）
- [ ] 5.18 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 6. D9 agent 指令真相源（design D9）

- [ ] 6.1 Write failing test `test_generated_agents_contains_restart_tokens` in `tests/restart-instructions.test.mjs` for scenario「生成的 agent 指令包含同意、验证与恢复 tokens」（assert fails for the right reason）
- [ ] 6.2 Implement「生成的 agent 指令包含同意、验证与恢复 tokens」behavior per design；run `test_generated_agents_contains_restart_tokens` to pass（agent 指令真相源必须写清同意规则、断线预期、非断线失败验证与恢复方式）
- [ ] 6.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 6.4 Write failing test `test_skills_and_readme_old_directive_removed` in `tests/restart-instructions.test.mjs` for scenario「skill/README 旧唯一指引与旧句被移除」（assert fails for the right reason）
- [ ] 6.5 Implement「skill/README 旧唯一指引与旧句被移除」behavior per design；run `test_skills_and_readme_old_directive_removed` to pass（agent 指令真相源必须写清同意规则、断线预期、非断线失败验证与恢复方式）
- [ ] 6.6 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 6.7 Write failing test `test_preview_recovery_guidance_present` in `tests/restart-instructions.test.mjs` for scenario「预览恢复指引存在」（assert fails for the right reason）
- [ ] 6.8 Implement「预览恢复指引存在」behavior per design；run `test_preview_recovery_guidance_present` to pass（agent 指令真相源必须写清同意规则、断线预期、非断线失败验证与恢复方式）
- [ ] 6.9 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 7. D6 外部终端契约与增量（design D7/D8）

- [ ] 7.1 Write failing test `test_external_restart_contract_unchanged_no_internal_state` in `tests/launcher-contract.test.mjs` for scenario「外部 restart 契约不回归」（assert fails for the right reason）
- [ ] 7.2 Implement「外部 restart 契约不回归」behavior per design；run `test_external_restart_contract_unchanged_no_internal_state` to pass（外部终端路径的 CLI 契约不得回退；receipt/history 与只读证据探测是明确增量）
- [ ] 7.3 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 7.4 Write failing test `test_external_receipt_failure_does_not_change_cli` in `tests/launcher-restart-receipt.test.mjs` for scenario「外部 receipt 写失败不影响命令」（assert fails for the right reason）
- [ ] 7.5 Implement「外部 receipt 写失败不影响命令」behavior per design；run `test_external_receipt_failure_does_not_change_cli` to pass（外部终端路径的 CLI 契约不得回退；receipt/history 与只读证据探测是明确增量）
- [ ] 7.6 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 7.7 Write failing test `test_history_without_receipt_byte_identical` in `tests/launcher-contract.test.mjs` for scenario「无 receipt 的 history 输出不变」（assert fails for the right reason）
- [ ] 7.8 Implement「无 receipt 的 history 输出不变」behavior per design；run `test_history_without_receipt_byte_identical` to pass（外部终端路径的 CLI 契约不得回退；receipt/history 与只读证据探测是明确增量）
- [ ] 7.9 Refactor；rerun this group's tests + shared contracts, full suite stays green
- [ ] 7.10 Write failing test `test_external_receipt_adds_queryable_history` in `tests/launcher-restart-receipt.test.mjs` for scenario「外部 restart 的 receipt 只增加可查询状态」（assert fails for the right reason）
- [ ] 7.11 Implement「外部 restart 的 receipt 只增加可查询状态」behavior per design；run `test_external_receipt_adds_queryable_history` to pass（外部终端路径的 CLI 契约不得回退；receipt/history 与只读证据探测是明确增量）
- [ ] 7.12 Refactor；rerun this group's tests + shared contracts, full suite stays green

## 8. 真实 systemd 集成证据（强制，可 skip 但须记录原因）

- [ ] 8.1 新建 `tests/platform/linux-restart-detach.test.mjs`，用真实 `systemd-run --user --scope` 与显式 SIGTERM→SIGKILL client 的假 Host range；覆盖 test_launcher_returns_before_host_stop / client-kill 存活 / no-EPIPE / replacement-Host scope 生命周期 / scope 名不匹配 provider 正则
- [ ] 8.2 不可用环境显式 skip 并记录原因；`t.after` 清理 scope；确认 skip 不会被 verify 计为 pass
- [ ] 8.3 与真实实现共用常量/argv，防夹具漂移

## 9. 人工 WSL 端到端（需用户授权，强制证据）

- [ ] 9.1 生产 home 会话内 `dsh restart` 一次：记录返回、断线/未断线、新 Host 端口、startup log、receipt ready、`dsh history` 输出
- [ ] 9.2 预览 home 会话内 restart 一次：不触碰 3080，记录 DSH_PREVIEW/preview.json 恢复路径
- [ ] 9.3 外部终端 `dsh restart`（含 `-b`）一次：确认 CLI 契约与 receipt/history 增量；记录常量实测值（GRACE/HANDOFF/LIVENESS）

## 10. 收尾与验证

- [ ] 10.1 全量测试：`npm test`；受影响 package build/typecheck（如涉及）；`npm run check:artifacts`
- [ ] 10.2 `openspec validate session-safe-dsh-restart --strict`；确认 test-plan 38 行全部 🟢，无遗留 red/skip-as-pass
- [ ] 10.3 写 verify.md：真实 systemd 结果、人工 E2E 证据、常量校准值、cross-platform-launcher 协调/baseline commit、未覆盖边界（macOS/Windows fail-closed 验收）
- [ ] 10.4 归档前确认 `cross-platform-launcher` 的 MODIFIED start/stop 需求已合入/归档（D11）；未满足则保持 unarchived 或按 D11 回退方案获用户批准

## 11. 提交前检查

- [ ] 11.1 只提交源码/测试/文档/指令与 OpenSpec 制品；不提交 receipt/state 生成物、raw session/log 证据、`.launcher-builds` 或临时夹具
- [ ] 11.2 更新 README/AGENTS/skill 后按流程在 main checkout `dsh build` 两次（第二次 no changes），由用户决定何时执行真实重启
