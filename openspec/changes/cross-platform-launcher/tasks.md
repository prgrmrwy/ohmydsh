# 跨平台启动器实施任务

2026-10-24 用户已授权 Agent Team 实施并建立 goal；按证据逐项更新完成状态。规范定义 WHAT，design 定义 HOW，test-plan 的具名测试逐一追踪。不得因 CLI 显示 review 文件存在就绕过其内容门禁。verify.md 必须实施后才生成。

## 1. P1 — 等价 Bash 拆分（保持产品入口不变）

- [x] 1.1 在任何依赖操作前 ws promote；恢复根 lock 依赖，重跑完整根基线，记录既有失败和跳过，不在环境不完整时归因迁移回归。
- [x] 1.2 固定现有 CLI 参数/组合优先级、运行体解析、env 来源、日志和副作用顺序；逐项列出已批准新行为，禁止拆分时顺手修复。
- [x] 1.3 先增加负例检验：source 原子模块不得发起 npm、network、Host 或 UI 副作用；确认断言对有副作用 fixture 会失败。
- [x] 1.4 将 Bash 按 args/environment/runtime-server/UI/maintenance 能力拆为少量可 source 文件；bin/dsh 仅装配分发，保留 runtime 安全检查。
- [ ] 1.5 跑现有 launcher/npm/runtime/prerequisite、ShellCheck、根测试；对比拆分前后可观察行为，重构后仍绿。

## 2. P2 — 原子能力与实现无关的契约基线

- [x] 2.1 建立 Node fixture 与 Bash adapter，通过 argv/env/stdout/stderr/退出码/文件/外部调用日志观察，不 regex 替换生产源码。
- [x] 2.2 对既有语义用 mutation/负例证明断言有效，再固定 Bash GREEN；新语义先在旧实现/缺失能力上 RED。记录每个具名测试结果，不以“测试文件不存在”充当所有用例的正确失败原因。
- [x] 2.3 补齐 args、environment、runtime-server、UI、maintenance 每块原子用例；命令矩阵覆盖 build/reset/history/doctor/update/official 路由和组合，保留已有安全断言。
- [x] 2.4 锁定下面各组可移植断言和测试名字；P3 只换执行 adapter，P4 切换前保留 Bash oracle，平台新用例单列。

## 3. P3 — 执行基础与依赖

- [x] 3.1 复核 zx@8.8.5 来源、许可、依赖和当前 API，在 promote 后加入根依赖/lock；不生成 nested lock，不使用全局 zx。
- [x] 3.2 先写 builtin-only npm/npx/pnpm/Corepack resolver 布局与失败测试（无 npm_execpath 的 shim、Node安装根、原生pnpm.exe、JS路径、未知布局诊断）。
- [x] 3.3 实现共享 resolver 与 node+JS/shell:false runner，bootstrap、dsh-cli、bounded provision、compat runner 同源使用；保持工具 pin。
- [x] 3.4 对 3.2 用例 GREEN 后重构；zx 仅编排固定探测/opener，变量 argv 全走原生参数数组，敏感值日志默认关闭。

以下每个组都按 RED→GREEN→重构顺序执行。测试名字严格对应 test-plan；没有实现前不得勾完成。属于旧语义的条目 P2 已建立基线，在此记录 Node adapter 的 RED→GREEN；新语义直接先 RED。

## 4. P3 — 路由与输入配置

- [ ] 4.1 RED：编写/迁移 `test_route_local_and_official_commands`（`tests/launcher-contract.test.mjs`，场景「本地与官方命令分流」），先确认因预期行为不满足而失败。
- [x] 4.2 GREEN：按 spec 与 design 实现「本地与官方命令分流」，使 `test_route_local_and_official_commands` 通过；不改弱 P2 断言。
- [x] 4.3 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_route_local_and_official_commands` 证据并更新 test-plan 状态。
- [ ] 4.4 RED：编写/迁移 `test_invalid_arguments_have_no_effects`（`tests/launcher-contract.test.mjs`，场景「无效参数没有启动副作用」），先确认因预期行为不满足而失败。
- [x] 4.5 GREEN：按 spec 与 design 实现「无效参数没有启动副作用」，使 `test_invalid_arguments_have_no_effects` 通过；不改弱 P2 断言。
- [x] 4.6 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_invalid_arguments_have_no_effects` 证据并更新 test-plan 状态。
- [ ] 4.7 RED：编写/迁移 `test_literal_environment_parity`（`tests/launcher-env-local.test.mjs`，场景「纯键值配置跨平台等价」），先确认因预期行为不满足而失败。
- [x] 4.8 GREEN：按 spec 与 design 实现「纯键值配置跨平台等价」，使 `test_literal_environment_parity` 通过；不改弱 P2 断言。
- [x] 4.9 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_literal_environment_parity` 证据并更新 test-plan 状态。
- [ ] 4.10 RED：编写/迁移 `test_reject_shell_without_secret_leak`（`tests/launcher-env-local.test.mjs`，场景「旧 Shell 语法失败且不泄露值」），先确认因预期行为不满足而失败。
- [x] 4.11 GREEN：按 spec 与 design 实现「旧 Shell 语法失败且不泄露值」，使 `test_reject_shell_without_secret_leak` 通过；不改弱 P2 断言。
- [x] 4.12 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_reject_shell_without_secret_leak` 证据并更新 test-plan 状态。
- [ ] 4.13 RED：编写/迁移 `test_reject_bare_operators_and_whitespace`（`tests/launcher-env-local.test.mjs`，场景「裸值中的命令分隔与空白拒绝」），先确认因预期行为不满足而失败。
- [x] 4.14 GREEN：按 spec 与 design 实现「裸值中的命令分隔与空白拒绝」，使 `test_reject_bare_operators_and_whitespace` 通过；不改弱 P2 断言。
- [x] 4.15 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_reject_bare_operators_and_whitespace` 证据并更新 test-plan 状态。
- [ ] 4.16 RED：编写/迁移 `test_reject_legacy_inline_comment`（`tests/launcher-env-local.test.mjs`，场景「旧行内注释不得变成值」），先确认因预期行为不满足而失败。
- [x] 4.17 GREEN：按 spec 与 design 实现「旧行内注释不得变成值」，使 `test_reject_legacy_inline_comment` 通过；不改弱 P2 断言。
- [x] 4.18 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_reject_legacy_inline_comment` 证据并更新 test-plan 状态。
- [ ] 4.19 RED：编写/迁移 `test_reject_bare_tilde_and_backslash`（`tests/launcher-env-local.test.mjs`，场景「波浪号和裸反斜杠不得被猜测」），先确认因预期行为不满足而失败。
- [x] 4.20 GREEN：按 spec 与 design 实现「波浪号和裸反斜杠不得被猜测」，使 `test_reject_bare_tilde_and_backslash` 通过；不改弱 P2 断言。
- [x] 4.21 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_reject_bare_tilde_and_backslash` 证据并更新 test-plan 状态。
- [ ] 4.22 RED：编写/迁移 `test_decode_double_quotes_preserve_single_quote_backslash`（`tests/launcher-env-local.test.mjs`，场景「双引号反斜杠保持已声明语义」），先确认因预期行为不满足而失败。
- [x] 4.23 GREEN：按 spec 与 design 实现「双引号反斜杠保持已声明语义」，使 `test_decode_double_quotes_preserve_single_quote_backslash` 通过；不改弱 P2 断言。
- [x] 4.24 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_decode_double_quotes_preserve_single_quote_backslash` 证据并更新 test-plan 状态。
- [ ] 4.25 RED：编写/迁移 `test_npm_case_variants_do_not_leak`（`tests/launcher-environment.test.mjs`，场景「npm 隐式环境不进入 Host」），先确认因预期行为不满足而失败。
- [x] 4.26 GREEN：按 spec 与 design 实现「npm 隐式环境不进入 Host」，使 `test_npm_case_variants_do_not_leak` 通过；不改弱 P2 断言。
- [x] 4.27 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_npm_case_variants_do_not_leak` 证据并更新 test-plan 状态。
- [ ] 4.28 RED：编写/迁移 `test_missing_owner_probe_fails_before_effects`（`tests/launcher-lifecycle.test.mjs`，场景「缺归属探测工具时明确拒绝」），先确认因预期行为不满足而失败。
- [x] 4.29 GREEN：按 spec 与 design 实现「缺归属探测工具时明确拒绝」，使 `test_missing_owner_probe_fails_before_effects` 通过；不改弱 P2 断言。
- [x] 4.30 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_missing_owner_probe_fails_before_effects` 证据并更新 test-plan 状态。
- [ ] 4.31 RED：编写/迁移 `test_same_contract_across_bash_and_node`（`tests/launcher-contract.test.mjs`，场景「Bash 与新实现复用契约」），先确认因预期行为不满足而失败。
- [x] 4.32 GREEN：按 spec 与 design 实现「Bash 与新实现复用契约」，使 `test_same_contract_across_bash_and_node` 通过；不改弱 P2 断言。
- [x] 4.33 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_same_contract_across_bash_and_node` 证据并更新 test-plan 状态。
- [ ] 4.34 RED：编写/迁移 `test_strict_and_allowlist_entry_boundary`（`tests/launcher-env-local.test.mjs`，场景「严格启动入口与白名单裸入口边界明确」），先确认因预期行为不满足而失败。
- [x] 4.35 GREEN：按 spec 与 design 实现「严格启动入口与白名单裸入口边界明确」，使 `test_strict_and_allowlist_entry_boundary` 通过；不改弱 P2 断言。
- [x] 4.36 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_strict_and_allowlist_entry_boundary` 证据并更新 test-plan 状态。

## 5. P3 — 外部执行与显式入口

- [ ] 5.1 RED：编写/迁移 `test_argv_metacharacters_remain_data`（`tests/launcher-exec.test.mjs`，场景「元字符参数仍是数据」），先确认因预期行为不满足而失败。
- [x] 5.2 GREEN：按 spec 与 design 实现「元字符参数仍是数据」，使 `test_argv_metacharacters_remain_data` 通过；不改弱 P2 断言。
- [x] 5.3 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_argv_metacharacters_remain_data` 证据并更新 test-plan 状态。
- [ ] 5.4 RED：编写/迁移 `test_git_quote_and_empty_config_roundtrip`（`tests/platform/windows-launcher.test.mjs`，场景「Windows Git 保留引号与空参数」），先确认因预期行为不满足而失败。
- [x] 5.5 GREEN：按 spec 与 design 实现「Windows Git 保留引号与空参数」，使 `test_git_quote_and_empty_config_roundtrip` 通过；不改弱 P2 断言。
- [x] 5.6 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_git_quote_and_empty_config_roundtrip` 证据并更新 test-plan 状态。
- [ ] 5.7 RED：编写/迁移 `test_explicit_dsh_bin_forms`（`tests/platform/windows-launcher.test.mjs`，场景「Windows 显式 DSH_BIN 形态可预测」），先确认因预期行为不满足而失败。
- [x] 5.8 GREEN：按 spec 与 design 实现「Windows 显式 DSH_BIN 形态可预测」，使 `test_explicit_dsh_bin_forms` 通过；不改弱 P2 断言。
- [x] 5.9 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_explicit_dsh_bin_forms` 证据并更新 test-plan 状态。

## 6. P3 — Host 生命周期与端口安全

- [ ] 6.1 RED：编写/迁移 `test_detached_host_outlives_launcher`（`tests/launcher-lifecycle.test.mjs`，场景「后台命令退出后 Host 继续运行」），先确认因预期行为不满足而失败。
- [x] 6.2 GREEN：按 spec 与 design 实现「后台命令退出后 Host 继续运行」，使 `test_detached_host_outlives_launcher` 通过；不改弱 P2 断言。
- [x] 6.3 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_detached_host_outlives_launcher` 证据并更新 test-plan 状态。
- [ ] 6.4 RED：编写/迁移 `test_host_survives_real_terminal_close`（`tests/platform/launcher-terminal.test.mjs`，场景「关闭发起终端后后台 Host 存活」），先确认因预期行为不满足而失败。
- [ ] 6.5 GREEN：按 spec 与 design 实现「关闭发起终端后后台 Host 存活」，使 `test_host_survives_real_terminal_close` 通过；不改弱 P2 断言。
- [ ] 6.6 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_host_survives_real_terminal_close` 证据并更新 test-plan 状态。
- [ ] 6.7 RED：编写/迁移 `test_foreign_port_and_early_exit_fail`（`tests/launcher-lifecycle.test.mjs`，场景「端口未知占用或新进程早退」），先确认因预期行为不满足而失败。
- [x] 6.8 GREEN：按 spec 与 design 实现「端口未知占用或新进程早退」，使 `test_foreign_port_and_early_exit_fail` 通过；不改弱 P2 断言。
- [x] 6.9 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_foreign_port_and_early_exit_fail` 证据并更新 test-plan 状态。
- [ ] 6.10 RED：编写/迁移 `test_supported_dsh_argv_stops`（`tests/launcher-process.test.mjs`，场景「npm/npx 升级改变 server argv」），先确认因预期行为不满足而失败。
- [x] 6.11 GREEN：按 spec 与 design 实现「npm/npx 升级改变 server argv」，使 `test_supported_dsh_argv_stops` 通过；不改弱 P2 断言。
- [x] 6.12 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_supported_dsh_argv_stops` 证据并更新 test-plan 状态。
- [ ] 6.13 RED：编写/迁移 `test_foreign_listener_is_untouched`（`tests/launcher-process.test.mjs`，场景「端口被非 DSH 服务占用」），先确认因预期行为不满足而失败。
- [x] 6.14 GREEN：按 spec 与 design 实现「端口被非 DSH 服务占用」，使 `test_foreign_listener_is_untouched` 通过；不改弱 P2 断言。
- [x] 6.15 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_foreign_listener_is_untouched` 证据并更新 test-plan 状态。
- [ ] 6.16 RED：编写/迁移 `test_stop_is_local_only`（`tests/launcher-contract.test.mjs`，场景「stop 不触发运行体解析」），先确认因预期行为不满足而失败。
- [x] 6.17 GREEN：按 spec 与 design 实现「stop 不触发运行体解析」，使 `test_stop_is_local_only` 通过；不改弱 P2 断言。
- [x] 6.18 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_stop_is_local_only` 证据并更新 test-plan 状态。
- [ ] 6.19 RED：编写/迁移 `test_restart_cleans_pwa_and_same_port_tabs`（`tests/platform/darwin-launcher.test.mjs`，场景「restart 清理重复 UI」），先确认因预期行为不满足而失败。
- [ ] 6.20 GREEN：按 spec 与 design 实现「restart 清理重复 UI」，使 `test_restart_cleans_pwa_and_same_port_tabs` 通过；不改弱 P2 断言。
- [ ] 6.21 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_restart_cleans_pwa_and_same_port_tabs` 证据并更新 test-plan 状态。
- [ ] 6.22 RED：编写/迁移 `test_taskkill_only_verified_tree`（`tests/platform/windows-launcher.test.mjs`，场景「Windows 强制停止只影响已核验树」），先确认因预期行为不满足而失败。
- [x] 6.23 GREEN：按 spec 与 design 实现「Windows 强制停止只影响已核验树」，使 `test_taskkill_only_verified_tree` 通过；不改弱 P2 断言。
- [x] 6.24 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_taskkill_only_verified_tree` 证据并更新 test-plan 状态。
- [ ] 6.25 RED：编写/迁移 `test_unknown_or_reused_identity_refuses_signal`（`tests/launcher-process.test.mjs`，场景「探测失败或停止期间身份变化」），先确认因预期行为不满足而失败。
- [x] 6.26 GREEN：按 spec 与 design 实现「探测失败或停止期间身份变化」，使 `test_unknown_or_reused_identity_refuses_signal` 通过；不改弱 P2 断言。
- [x] 6.27 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_unknown_or_reused_identity_refuses_signal` 证据并更新 test-plan 状态。
- [ ] 6.28 RED：编写/迁移 `test_invisible_listener_is_unknown`（`tests/launcher-process.test.mjs`，场景「查询未见监听者但端口可连接」），先确认因预期行为不满足而失败。
- [x] 6.29 GREEN：按 spec 与 design 实现「查询未见监听者但端口可连接」，使 `test_invisible_listener_is_unknown` 通过；不改弱 P2 断言。
- [x] 6.30 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_invisible_listener_is_unknown` 证据并更新 test-plan 状态。
- [ ] 6.31 RED：编写/迁移 `test_failed_replacement_keeps_healthy_host`（`tests/launcher-lifecycle.test.mjs`，场景「替代运行体准备失败保留现役 Host」），先确认因预期行为不满足而失败。
- [x] 6.32 GREEN：按 spec 与 design 实现「替代运行体准备失败保留现役 Host」，使 `test_failed_replacement_keeps_healthy_host` 通过；不改弱 P2 断言。
- [x] 6.33 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_failed_replacement_keeps_healthy_host` 证据并更新 test-plan 状态。
- [ ] 6.34 RED：编写/迁移 `test_non_darwin_stop_preserves_browser`（`tests/launcher-ui.test.mjs`，场景「非 macOS stop 不杀浏览器」），先确认因预期行为不满足而失败。
- [x] 6.35 GREEN：按 spec 与 design 实现「非 macOS stop 不杀浏览器」，使 `test_non_darwin_stop_preserves_browser` 通过；不改弱 P2 断言。
- [x] 6.36 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_non_darwin_stop_preserves_browser` 证据并更新 test-plan 状态。

## 7. P3 — UI 平台适配

- [ ] 7.1 RED：编写/迁移 `test_default_open_happens_once`（`tests/launcher-ui.test.mjs`，场景「缺省自动打开且不重复」），先确认因预期行为不满足而失败。
- [x] 7.2 GREEN：按 spec 与 design 实现「缺省自动打开且不重复」，使 `test_default_open_happens_once` 通过；不改弱 P2 断言。
- [x] 7.3 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_default_open_happens_once` 证据并更新 test-plan 状态。
- [ ] 7.4 RED：编写/迁移 `test_manifest_no_open_for_all_start_paths`（`tests/launcher-ui.test.mjs`，场景「manifest 关闭自动打开」），先确认因预期行为不满足而失败。
- [x] 7.5 GREEN：按 spec 与 design 实现「manifest 关闭自动打开」，使 `test_manifest_no_open_for_all_start_paths` 通过；不改弱 P2 断言。
- [x] 7.6 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_manifest_no_open_for_all_start_paths` 证据并更新 test-plan 状态。
- [ ] 7.7 RED：编写/迁移 `test_no_open_beats_open_and_manifest`（`tests/launcher-ui.test.mjs`，场景「显式参数优先」），先确认因预期行为不满足而失败。
- [x] 7.8 GREEN：按 spec 与 design 实现「显式参数优先」，使 `test_no_open_beats_open_and_manifest` 通过；不改弱 P2 断言。
- [x] 7.9 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_no_open_beats_open_and_manifest` 证据并更新 test-plan 状态。
- [ ] 7.10 RED：编写/迁移 `test_opener_failure_keeps_host_and_prints_url`（`tests/launcher-ui.test.mjs`，场景「opener 不可用仍保留服务」），先确认因预期行为不满足而失败。
- [x] 7.11 GREEN：按 spec 与 design 实现「opener 不可用仍保留服务」，使 `test_opener_failure_keeps_host_and_prints_url` 通过；不改弱 P2 断言。
- [x] 7.12 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_opener_failure_keeps_host_and_prints_url` 证据并更新 test-plan 状态。

## 8. P3 — 零依赖初始化

- [ ] 8.1 RED：编写/迁移 `test_minimum_pass_recommended_difference_warns`（`tests/launcher-bootstrap.test.mjs`，场景「高于最低版本但不等于推荐版本」），先确认因预期行为不满足而失败。
- [x] 8.2 GREEN：按 spec 与 design 实现「高于最低版本但不等于推荐版本」，使 `test_minimum_pass_recommended_difference_warns` 通过；不改弱 P2 断言。
- [x] 8.3 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_minimum_pass_recommended_difference_warns` 证据并更新 test-plan 状态。
- [ ] 8.4 RED：编写/迁移 `test_below_minimum_rejects`（`tests/launcher-bootstrap.test.mjs`，场景「低于最低版本」），先确认因预期行为不满足而失败。
- [x] 8.5 GREEN：按 spec 与 design 实现「低于最低版本」，使 `test_below_minimum_rejects` 通过；不改弱 P2 断言。
- [x] 8.6 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_below_minimum_rejects` 证据并更新 test-plan 状态。
- [ ] 8.7 RED：编写/迁移 `test_missing_toolchain_is_actionable`（`tests/launcher-bootstrap.test.mjs`，场景「工具链缺失」），先确认因预期行为不满足而失败。
- [x] 8.8 GREEN：按 spec 与 design 实现「工具链缺失」，使 `test_missing_toolchain_is_actionable` 通过；不改弱 P2 断言。
- [x] 8.9 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_missing_toolchain_is_actionable` 证据并更新 test-plan 状态。
- [ ] 8.10 RED：编写/迁移 `test_engines_recommendation_and_docs_agree`（`tests/launcher-bootstrap.test.mjs`，场景「最低版本声明保持单一准则」），先确认因预期行为不满足而失败。
- [x] 8.11 GREEN：按 spec 与 design 实现「最低版本声明保持单一准则」，使 `test_engines_recommendation_and_docs_agree` 通过；不改弱 P2 断言。
- [x] 8.12 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_engines_recommendation_and_docs_agree` 证据并更新 test-plan 状态。
- [ ] 8.13 RED：编写/迁移 `test_bootstrap_repeat_and_install_failure`（`tests/launcher-bootstrap.test.mjs`，场景「重复初始化与安装失败」），先确认因预期行为不满足而失败。
- [x] 8.14 GREEN：按 spec 与 design 实现「重复初始化与安装失败」，使 `test_bootstrap_repeat_and_install_failure` 通过；不改弱 P2 断言。
- [x] 8.15 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_bootstrap_repeat_and_install_failure` 证据并更新 test-plan 状态。

## 9. P3 — 裸 manifest 消费兼容

- [ ] 9.1 RED：编写/迁移 `test_bare_sync_overlay_is_idempotent`（`tests/sync-env-local.test.mjs`，场景「裸跑 sync 采用 .env.local 中的 overlay 路径」），先确认因预期行为不满足而失败。
- [x] 9.2 GREEN：按 spec 与 design 实现「裸跑 sync 采用 .env.local 中的 overlay 路径」，使 `test_bare_sync_overlay_is_idempotent` 通过；不改弱 P2 断言。
- [x] 9.3 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_bare_sync_overlay_is_idempotent` 证据并更新 test-plan 状态。
- [ ] 9.4 RED：编写/迁移 `test_caller_even_empty_wins`（`tests/sync-env-local.test.mjs`，场景「调用方显式设置的值优先」），先确认因预期行为不满足而失败。
- [x] 9.5 GREEN：按 spec 与 design 实现「调用方显式设置的值优先」，使 `test_caller_even_empty_wins` 通过；不改弱 P2 断言。
- [x] 9.6 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_caller_even_empty_wins` 证据并更新 test-plan 状态。
- [ ] 9.7 RED：编写/迁移 `test_public_enabled_env_is_applied`（`tests/sync-env-local.test.mjs`，场景「.env.local 中的 enabledEnv 开关生效」），先确认因预期行为不满足而失败。
- [x] 9.8 GREEN：按 spec 与 design 实现「.env.local 中的 enabledEnv 开关生效」，使 `test_public_enabled_env_is_applied` 通过；不改弱 P2 断言。
- [x] 9.9 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_public_enabled_env_is_applied` 证据并更新 test-plan 状态。
- [ ] 9.10 RED：编写/迁移 `test_overlay_enabled_env_is_applied`（`tests/sync-env-local.test.mjs`，场景「overlay 条目声明的 enabledEnv 同样从 .env.local 读取」），先确认因预期行为不满足而失败。
- [x] 9.11 GREEN：按 spec 与 design 实现「overlay 条目声明的 enabledEnv 同样从 .env.local 读取」，使 `test_overlay_enabled_env_is_applied` 通过；不改弱 P2 断言。
- [x] 9.12 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_overlay_enabled_env_is_applied` 证据并更新 test-plan 状态。
- [ ] 9.13 RED：编写/迁移 `test_non_allowlisted_destination_is_ignored`（`tests/sync-env-local.test.mjs`，场景「非白名单变量不被读取」），先确认因预期行为不满足而失败。
- [x] 9.14 GREEN：按 spec 与 design 实现「非白名单变量不被读取」，使 `test_non_allowlisted_destination_is_ignored` 通过；不改弱 P2 断言。
- [x] 9.15 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_non_allowlisted_destination_is_ignored` 证据并更新 test-plan 状态。
- [ ] 9.16 RED：编写/迁移 `test_bad_allowlisted_value_rejects_before_write`（`tests/sync-env-local.test.mjs`，场景「白名单变量含 shell 展开时 sync 拒绝运行」），先确认因预期行为不满足而失败。
- [x] 9.17 GREEN：按 spec 与 design 实现「白名单变量含 shell 展开时 sync 拒绝运行」，使 `test_bad_allowlisted_value_rejects_before_write` 通过；不改弱 P2 断言。
- [x] 9.18 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_bad_allowlisted_value_rejects_before_write` 证据并更新 test-plan 状态。
- [ ] 9.19 RED：编写/迁移 `test_inventory_degrades_without_bad_value`（`tests/sync-env-local.test.mjs`，场景「白名单变量含 shell 展开时启动清单降级」），先确认因预期行为不满足而失败。
- [x] 9.20 GREEN：按 spec 与 design 实现「白名单变量含 shell 展开时启动清单降级」，使 `test_inventory_degrades_without_bad_value` 通过；不改弱 P2 断言。
- [x] 9.21 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_inventory_degrades_without_bad_value` 证据并更新 test-plan 状态。
- [ ] 9.22 RED：编写/迁移 `test_bare_sync_ignores_nonallowlisted_shell`（`tests/sync-env-local.test.mjs`，场景「非白名单行的 shell 语法不影响运行」），先确认因预期行为不满足而失败。
- [x] 9.23 GREEN：按 spec 与 design 实现「非白名单行的 shell 语法不影响运行」，使 `test_bare_sync_ignores_nonallowlisted_shell` 通过；不改弱 P2 断言。
- [x] 9.24 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_bare_sync_ignores_nonallowlisted_shell` 证据并更新 test-plan 状态。

## 10. P4 — 统一入口与支持声明

- [ ] 10.1 RED：编写/迁移 `test_link_from_external_cwd`（`tests/launcher-install.test.mjs`，场景「link 后从其他目录调用」），先确认因预期行为不满足而失败。
- [x] 10.2 GREEN：按 spec 与 design 实现「link 后从其他目录调用」，使 `test_link_from_external_cwd` 通过；不改弱 P2 断言。Linux595根回归、macOS25聚焦/595根回归、Windows双shim及noBash61批次均已有实际PASS。
- [x] 10.3 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_link_from_external_cwd` 证据并更新 test-plan 状态。既有lock不变/external cwd/隔离prefix/unlink断言保留；历史RED10.1不追补。
- [ ] 10.4 RED：编写/迁移 `test_missing_dependencies_do_not_install`（`tests/launcher-install.test.mjs`，场景「缺少根依赖不自行安装」），先确认因预期行为不满足而失败。
- [x] 10.5 GREEN：按 spec 与 design 实现「缺少根依赖不自行安装」，使 `test_missing_dependencies_do_not_install` 通过；不改弱 P2 断言。
- [x] 10.6 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_missing_dependencies_do_not_install` 证据并更新 test-plan 状态。
- [ ] 10.7 RED：编写/迁移 `test_full_manifest_failure_blocks_support_claim`（`tests/launcher-acceptance.test.mjs`，场景「Windows 真实链路失败不能以桩通过放行」），先确认因预期行为不满足而失败。
- [x] 10.8 GREEN：按 spec 与 design 实现「Windows 真实链路失败不能以桩通过放行」，使 `test_full_manifest_failure_blocks_support_claim` 通过；不改弱 P2 断言。
- [x] 10.9 REFACTOR：整理该能力，重跑所属模块和共享合同；记录 `test_full_manifest_failure_blocks_support_claim` 证据并更新 test-plan 状态。

## 11. P4 — 闭包接线、一次切换与三平台验收

- [x] 11.1 在同套合同通过后声明根 npm bin，保留最薄旧入口转发或弃用指引，移除临时 Bash 产品逻辑；先完成统一实现再切全部平台，禁止长期双轨。
- [ ] 11.2 审查并迁移命令真实闭包：sync、doctor、third-party-resources、plugin/update、runtime provision、Pet compat；先为每个实证阻碍补 RED，再修正确平台调用，重构回绿。上游缺口不能擅自 patch/禁用来换绿。
- [x] 11.3 把根 test/test:tap 改为 Node driver 的 env 隔离与测试枚举；保留所有回归，按平台选择 platform suite，不以 skip 计完成。
- [ ] 11.4 以隔离 npm prefix 验证 ci→link→跨cwd调用→unlink，检查根 lock 无变化；Windows 实跑 cmd/PowerShell shim，原始 PATH 无 Bash/sh，Git cmd 仍可用。
- [x] 11.5 更新 README 双语安装/环境迁移/DSH_BIN/强杀/lsof/Node前缀/冲突/执行策略指引；同步 facade 的命令发现测试，不保留读 Bash case arm 的陈旧断言。
- [x] 11.6 CI 增 Windows/Linux/macOS × Node22/24，先按需 build dsh-openspec；ShellCheck 仅在删除产品 Bash 后调整为检查残留 wrapper。
- [ ] 11.7 执行三平台具名测试与终端关闭实测；公开 manifest 使用隔离 home/空overlay/端口，build两次、第二次无变化、dump、真实Host ready/stop。未跑的门禁保留红。
- [ ] 11.8 复跑根完整测试、受影响包 build/typecheck/test、artifact、strict change 校验和 diff check。定位当前 tsc/根基线缺失与既有跳过项，verify 不得隐藏；需要外部桥接前提的集成用例在隔离环境补齐。
- [ ] 11.9 机械核对47条 test-plan与测试存在/名字/绿状态、review哈希与场景覆盖；按 Anvil instructions verify 生成真实 verify.md，不为凑齐7/7创建占位。
- [ ] 11.10 若完整gate仅剩已证明外部平台缺口，报告最小复现并等用户明确接受限缩；不自动归档、不在README宣称完整Windows支持。全部验收成功后才申请收尾；不擅自生产build/restart/合入/清理worktree。

## 12. Windows 实测后的已批准修订

- [x] 12.1 D8/spec/proposal/test-plan 一致性针对复评；原评审不覆盖修订。checking/windows-d8-planning-review.md followup APPROVE，三项规划缺口已闭合。
- [x] 12.2 精确脚本策略、strict拒绝未知、环境逃逸剥离和缓存策略核验 RED→GREEN；不授予新增 true。实现/独立最终复评先在无新增true下完成；随后用户另行明确批准3个精确版本才加入，详见checking/native-runtime-script-review.md。
- [x] 12.3 Windows备份/发布/失败恢复、未知实体拒绝、保留generation RED→GREEN，POSIX原子替换不回退。实测next/active身份替换和POSIX恢复失败回归；独立最终复评PASS；Linux20/20、原生Windows19/19（不枚举POSIX-only）。
- [x] 12.4 Host调用方共享锁覆盖后续读取、返回真实generation、并发/失败释放锁 RED→GREEN。实default prepare/supervisor/双层builder/fingerprint读取竞争者，4类结果finally与物理入口换指针后可执行；提前释放mutation RED，独立最终复评PASS。
- [x] 12.5 完整回归与原生无副作用发布测试；新增脚本执行另行确认后才重跑真实Host。root593/591/0/2既有skip，native19/19；用户单独批准3个精确版本后bash-354真实Host63120启动/同PID存活/stop通过；全change验收仍FAIL。

## Evidence reconciliation (2026-10-24)

GREEN/REFACTOR checks above mean the mapped implementation/unit contracts pass in the stated available environment; they do not waive11.7 or imply all platforms passed. Historical RED tasks remain unchecked wherever a distinct expected-failure receipt was not captured. Current Linux/macOS whole-root each595/593pass/0fail/2existing skips; standalone exact MCP bridge now2/2pass0skip (round11), not a rewrite of root counts. Windows noBash61/61+7/7lifecycle and safety20/20; actual user-assisted window-close event2/shell-exit/sameHostPASS. Mac realPTY25-focusedPASS and isolated fullbuild×2/nochange/doctor/dump/HostPASS. Earlier snapshots remain in reports; actual external cockpit/PWA/tab interaction unrun, ShellCheck unavailable, final review/task reconciliation outstanding. Round11 mapping audit50/50 file/exact-name links (47original+3D8), install/gate tests4/4, artifact/diff/strictPASS. No claims of whole-change acceptance or fabricated historical RED.
