## Test Plan

依据：`openspec/changes/session-safe-dsh-restart/` 的 proposal/design（含 D1–D12）与 `specs/session-safe-restart/spec.md`（6 requirements / 38 scenarios）。review.md 的 round-3 `VERDICT: APPROVE_WITH_CHANGES` 已通过 RC1–RC8 复核并翻转为 `CHANGES_APPLIED: yes`。

约定：每行对应**一个新的具名测试**（测试文件可已有，但测试函数必须新建），因此初始状态全部 🔴 red；apply 阶段逐个翻绿，verify 不允许任何行残留 red。真实 systemd 行与人工 WSL E2E 是**强制证据**，不可用环境只能显式 skip 并记录原因，不得计为 pass。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/session-safe-restart/spec.md → 会话语境判定必须先于任何副作用，优先级确定且覆盖全部 Host 管理的执行范围 | Linux 普通子进程 range 判为会话内 | tests/launcher-session-context.test.mjs | test_linux_subprocess_scope_is_session | 🔴 red |
| 同上 | 终端 range 且会话标记被剥离仍判为会话内 | tests/launcher-session-context.test.mjs | test_linux_terminal_scope_without_markers_is_session | 🔴 red |
| 同上 | 标记与可读 cgroup 冲突时 fail-closed | tests/launcher-session-context.test.mjs | test_linux_marker_cgroup_conflict_fails_closed | 🔴 red |
| 同上 | cgroup 不可读或外部路径参数非法 | tests/launcher-session-context.test.mjs | test_unreadable_cgroup_and_invalid_args_have_no_side_effects | 🔴 red |
| 同上 | 非 Linux 有标记或可证祖先时 fail-closed | tests/launcher-session-context.test.mjs | test_non_linux_marker_or_ancestor_fails_closed | 🔴 red |
| 同上 | 外部终端不被误判 | tests/launcher-session-context.test.mjs | test_external_terminal_takes_sync_path | 🔴 red |
| specs/session-safe-restart/spec.md → 会话内 restart 必须完成三段握手 + marker/nonce 协议 + 结果投递宽限，且排程子进程/stdio 生命周期确定 | 支持平台返回前不停止 Host（含 GRACE） | tests/launcher-restart-handshake.test.mjs | test_ready_scheduled_go_grace_before_stop | 🔴 red |
| 同上 | scheduled/go 写失败不停止 Host | tests/launcher-restart-handshake.test.mjs | test_scheduled_or_go_write_failure_aborts_without_stop | 🔴 red |
| 同上 | 排程未 ack 时不宣称成功 | tests/launcher-restart-handshake.test.mjs | test_missing_ready_does_not_claim_scheduled | 🔴 red |
| 同上 | marker 截断或 nonce 不匹配时 fail-closed | tests/launcher-restart-handshake.test.mjs | test_truncated_or_nonce_mismatched_marker_fails_closed | 🔴 red |
| 同上 | 不支持环境 fail-closed 且零副作用 | tests/launcher-restart-handshake.test.mjs | test_unsupported_platform_or_probe_failure_zero_side_effects | 🔴 red |
| 同上 | 恶意/特殊字符路径不破坏排程命令 | tests/launcher-restart-handshake.test.mjs | test_argv_metacharacters_preserved_without_shell | 🔴 red |
| 同上 | 会话内 --foreground 被拒绝 | tests/launcher-restart-handshake.test.mjs | test_session_foreground_rejected | 🔴 red |
| 同上 | 状态目录预存在或异常时 fail-closed | tests/launcher-restart-handshake.test.mjs | test_state_dir_preexisting_or_invalid_fails_closed | 🔴 red |
| specs/session-safe-restart/spec.md → 会话路径必须复用同一 launcher 编排，并定义 expected 身份、epoch 复验、并发 churn 与旧进程退出证明 | 成功编排的阶段序列 | tests/launcher-restart-orchestration.test.mjs | test_success_phase_sequence | 🔴 red |
| 同上 | 准备阶段失败不停止旧 Host | tests/launcher-restart-orchestration.test.mjs | test_prepare_failure_keeps_old_host | 🔴 red |
| 同上 | expected 身份被替换或消失 | tests/launcher-restart-orchestration.test.mjs | test_expected_replaced_or_vanished_epoch | 🔴 red |
| 同上 | probe 不可归属或多监听者时不排程 | tests/launcher-restart-orchestration.test.mjs | test_probe_error_or_multi_listener_no_schedule | 🔴 red |
| 同上 | 排程时端口为空也能安全启动 | tests/launcher-restart-orchestration.test.mjs | test_empty_expected_skips_stop_or_superseded | 🔴 red |
| 同上 | 预览 home 使用 preview record 身份 | tests/launcher-preview.test.mjs | test_session_restart_preview_uses_preview_record_identity | 🔴 red |
| 同上 | 并发 restart churn 被显式接受并可对账 | tests/launcher-restart-epoch.test.mjs | test_concurrent_restart_churn_superseded_history | 🔴 red |
| 同上 | 旧进程未退出不启动替代 Host | tests/launcher-restart-epoch.test.mjs | test_handoff_exit_not_proven_no_start | 🔴 red |
| 同上 | 替代 Host 早退或未就绪 | tests/launcher-restart-epoch.test.mjs | test_replacement_early_exit_failed_start | 🔴 red |
| 同上 | 两条路径的 build/preview/env 语义一致 | tests/launcher-restart-epoch.test.mjs | test_external_session_build_preview_env_parity | 🔴 red |
| 同上 | orchestrator 在 stop 后死亡 | tests/launcher-restart-epoch.test.mjs | test_orchestrator_death_after_stop_incomplete_history | 🔴 red |
| specs/session-safe-restart/spec.md → restart 结果必须持久且可对有界查询；receipt 的 SHALL 必须可满足 | 成功重启可在重连后验证 | tests/launcher-restart-receipt.test.mjs | test_history_ready_after_reconnect | 🔴 red |
| 同上 | 启动失败可在重连后定位 | tests/launcher-restart-receipt.test.mjs | test_history_failed_start | 🔴 red |
| 同上 | 拒绝或持久化不可用路径不要求 receipt | tests/launcher-restart-receipt.test.mjs | test_refusal_or_unwritable_receipt_exemption | 🔴 red |
| 同上 | 迟到事件、陈旧 run 与文件行序 | tests/launcher-restart-receipt.test.mjs | test_late_events_stale_run_file_order | 🔴 red |
| 同上 | in progress、orchestrator-ended 与 abandoned 区分 | tests/launcher-restart-receipt.test.mjs | test_in_progress_vs_ended_vs_abandoned | 🔴 red |
| 同上 | ownership probe 失败不显示 abandoned | tests/launcher-restart-receipt.test.mjs | test_probe_unavailable_unknown_incomplete | 🔴 red |
| specs/session-safe-restart/spec.md → agent 指令真相源必须写清同意规则、断线预期、非断线失败验证与恢复方式 | 生成的 agent 指令包含同意、验证与恢复 tokens | tests/restart-instructions.test.mjs | test_generated_agents_contains_restart_tokens | 🔴 red |
| 同上 | skill/README 旧唯一指引与旧句被移除 | tests/restart-instructions.test.mjs | test_skills_and_readme_old_directive_removed | 🔴 red |
| 同上 | 预览恢复指引存在 | tests/restart-instructions.test.mjs | test_preview_recovery_guidance_present | 🔴 red |
| specs/session-safe-restart/spec.md → 外部终端路径的 CLI 契约不得回退；receipt/history 与只读证据探测是明确增量 | 外部 restart 契约不回归 | tests/launcher-contract.test.mjs | test_external_restart_contract_unchanged_no_internal_state | 🔴 red |
| 同上 | 外部 receipt 写失败不影响命令 | tests/launcher-restart-receipt.test.mjs | test_external_receipt_failure_does_not_change_cli | 🔴 red |
| 同上 | 无 receipt 的 history 输出不变 | tests/launcher-contract.test.mjs | test_history_without_receipt_byte_identical | 🔴 red |
| 同上 | 外部 restart 的 receipt 只增加可查询状态 | tests/launcher-restart-receipt.test.mjs | test_external_receipt_adds_queryable_history | 🔴 red |

## Coverage Notes

### 强制证据行（非 scenario 行，但 verify 必须记录）

- **真实 systemd 集成（Linux，无 Host）**：`tests/platform/linux-restart-detach.test.mjs`，必须用真实 `systemd-run --user --scope`，并显式 SIGTERM→SIGKILL `systemd-run` 客户端（模拟旧 Host managed range 的 dispose）。至少包含：
  - `test_launcher_returns_before_host_stop`（ready→scheduled→go→print/return；GRACE 到期前 stop 未被调用）
  - `test_orchestrator_survives_client_sigterm_sigkill`（client 被杀后 orchestrator + scope 存活并完成 stop→fake start）
  - `test_no_epipe_after_launcher_exit`（launcher 退出/stdio 关闭后 orchestrator 继续并写 terminal receipt）
  - `test_replacement_host_keeps_scope_active_then_collected`（orchestrator 退出后替代 Host 仍使 scope active，Host 停止后 collected）
  - `test_restart_scope_name_does_not_match_provider_regex`
  - `test_skip_records_reason_and_cleans_scopes`（不可用环境显式 skip + 原因 + `t.after` 清理；skip 不得计 pass）
  - 该文件与 D2 实际实现共用常量/argv（防夹具漂移）。
- **人工 WSL 端到端（需用户授权，真实断开 Host）**：
  - 生产 home：会话内 `dsh restart` 一次 → 记录命令返回、断开/未断开、新 Host 端口、`dsh-startup.log` 新记录、receipt `ready`、`dsh history` 输出。
  - 预览 home：按 D9/预览规则执行一次会话内 restart（不触碰 3080），记录 `DSH_PREVIEW`/`preview.json` 恢复路径。
  - 外部终端 `dsh restart`（含 `-b`）一次 → 记录 CLI 契约与既有 contract 测试一致、receipt/history 增量符合预期。
  - verify 必须写明上述命令、时间、输出与失败时的 recovery；不允许用 mock 代替该行。

### 额外单测（不替代 scenario 行，建议纳入 apply）

- `go-timeout` 的最终状态用注入 clock 断言（30s 窗口后 Host 仍 owned、无第二个终态、无 stop）。
- 伪造/部分 `DSH_RESTART_*`（缺 nonce/state dir/meta 不匹配）在普通 agent 环境中 fail-closed 且不 stop；普通 agent env（仅 `DSH_SHELL`/`DSH_SESSION_ID`）不能被测试 override 强制 external。
- **hermeticity guard**：从 DSH 会话内跑 launcher 测试套件时，创零 transient scope、零 capability probe（用环境探测 + 调用记录断言）；`NODE_TEST_CONTEXT` 未设置时 `DSH_RESTART_CONTEXT_OVERRIDE` 必须被忽略。
- 状态目录：逐级 0700/symlink/lstat/uid/7 天清理与 PID 复用边界。
- 指令断言使用字节精确锚点（完整旧句、`请用户自己执行`、`dsh-home.md:17` 旧日常重启句）与新 token 列表。
- external 路径：不做 capability probe、不创建 state 目录、不设置内部 env。

### 测试基础设施与 seam

- `runLauncher` 注入：`sessionContext`、`schedule`（fake systemd-run）、`receipt`、`spawn`、`clock`/`sleep`、probe/stop；handshake 测试用隔离 `$DSH_HOME` 与 fake Host/替代 Host 进程。
- `tests/helpers/launcher-fixture.mjs` 与生成的 `node-harness.mjs` 做**最小 seam 扩展**（传入 `sessionContext` 或转发 `NODE_TEST_CONTEXT`+gate env），`tests/launcher-{contract,lifecycle,preview}.test.mjs` 显式传 `external`；该扩展需先与 `cross-platform-launcher` owner 协调，并在本 change verify 记录其 archive-order 依赖与冻结 baseline commit。`tests/fixtures/launcher-bash-baseline/` 不改。
- 常量：READY 5s / GO 30s / PROBE 5s 为契约上限；GRACE 3s、HANDOFF 10s、LIVENESS 120s、STALE 7d、HISTORY_TAIL 200/64KiB 为默认值。测试用注入 clock/常量覆盖，真实 WSL 测量值写入 verify。
- 指令测试：`tests/restart-instructions.test.mjs` 用隔离 `DSH_HOME` 跑 `node scripts/sync.mjs`，断言生成 `AGENTS.md` 与源文件 tokens/旧句；不跑 `dsh build`。
