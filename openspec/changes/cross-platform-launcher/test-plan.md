## Test Plan

评审门禁：review.md 为 APPROVE_WITH_CHANGES / CHANGES_APPLIED: yes（独立第三次定点复核）。以下是计划账本，不是已实现测试；所有初始状态 red。实现时每行必须留下正确失败原因和后续通过证据。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/cross-platform-launcher/spec.md → 一个安装入口提供同一命令面 | link 后从其他目录调用 | tests/launcher-install.test.mjs | test_link_from_external_cwd | 🟢 Linux 与原生 Windows scratch-prefix cmd/PowerShell shim GREEN（bash-381 + no-Bash batch384） |
| specs/cross-platform-launcher/spec.md → 一个安装入口提供同一命令面 | 缺少根依赖不自行安装 | tests/launcher-install.test.mjs | test_missing_dependencies_do_not_install | 🟢 Linux 与原生 Windows scratch-prefix cmd/PowerShell shim GREEN（bash-381 + no-Bash batch384） |
| specs/cross-platform-launcher/spec.md → 命令路由与子命令结果跨平台一致 | 本地与官方命令分流 | tests/launcher-contract.test.mjs | test_route_local_and_official_commands | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/cross-platform-launcher/spec.md → 命令路由与子命令结果跨平台一致 | 无效参数没有启动副作用 | tests/launcher-contract.test.mjs | test_invalid_arguments_have_no_effects | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/cross-platform-launcher/spec.md → 本地环境配置只接受无执行语义的赋值 | 纯键值配置跨平台等价 | tests/launcher-env-local.test.mjs | test_literal_environment_parity | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/cross-platform-launcher/spec.md → 本地环境配置只接受无执行语义的赋值 | 旧 Shell 语法失败且不泄露值 | tests/launcher-env-local.test.mjs | test_reject_shell_without_secret_leak | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/cross-platform-launcher/spec.md → 本地环境配置只接受无执行语义的赋值 | 裸值中的命令分隔与空白拒绝 | tests/launcher-env-local.test.mjs | test_reject_bare_operators_and_whitespace | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/cross-platform-launcher/spec.md → 本地环境配置只接受无执行语义的赋值 | 旧行内注释不得变成值 | tests/launcher-env-local.test.mjs | test_reject_legacy_inline_comment | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/cross-platform-launcher/spec.md → 本地环境配置只接受无执行语义的赋值 | 波浪号和裸反斜杠不得被猜测 | tests/launcher-env-local.test.mjs | test_reject_bare_tilde_and_backslash | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/cross-platform-launcher/spec.md → 本地环境配置只接受无执行语义的赋值 | 双引号反斜杠保持已声明语义 | tests/launcher-env-local.test.mjs | test_decode_double_quotes_preserve_single_quote_backslash | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/cross-platform-launcher/spec.md → 外部执行保留参数和环境边界 | 元字符参数仍是数据 | tests/launcher-exec.test.mjs | test_argv_metacharacters_remain_data | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/cross-platform-launcher/spec.md → 外部执行保留参数和环境边界 | Windows Git 保留引号与空参数 | tests/platform/windows-launcher.test.mjs | test_git_quote_and_empty_config_roundtrip | 🟢 原生 Win32 GREEN（最终60/60 batch；见 native-windows-evidence） |
| specs/cross-platform-launcher/spec.md → 外部执行保留参数和环境边界 | Windows 显式 DSH_BIN 形态可预测 | tests/launcher-exec.test.mjs | Windows explicit DSH_BIN uses JS or exe and refuses shim before execution | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/cross-platform-launcher/spec.md → 外部执行保留参数和环境边界 | npm 隐式环境不进入 Host | tests/launcher-environment.test.mjs | test_npm_case_variants_do_not_leak | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/cross-platform-launcher/spec.md → 后台启动有界且不把占用端口等同于就绪 | 后台命令退出后 Host 继续运行 | tests/launcher-lifecycle.test.mjs | test_detached_host_outlives_launcher | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/cross-platform-launcher/spec.md → 后台启动有界且不把占用端口等同于就绪 | 关闭发起终端后后台 Host 存活 | tests/platform/launcher-terminal.test.mjs | test_host_survives_real_terminal_close | 🔴 整体未齐：Linux PTY GREEN；Windows人类真实关窗PASS（event2/shell退出/同Host/stop，bash-422）；PseudoConsole自动化不支持仍RED；macOS真实PTY25/25聚焦批次GREEN；桌面终端surface与全套平台汇总待核对 |
| specs/cross-platform-launcher/spec.md → 后台启动有界且不把占用端口等同于就绪 | 缺归属探测工具时明确拒绝 | tests/launcher-lifecycle.test.mjs | test_missing_owner_probe_fails_before_effects | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/cross-platform-launcher/spec.md → 后台启动有界且不把占用端口等同于就绪 | 端口未知占用或新进程早退 | tests/launcher-lifecycle.test.mjs | test_foreign_port_and_early_exit_fail | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/cross-platform-launcher/spec.md → 迁移以同一行为断言和真实平台验收收口 | Bash 与新实现复用契约 | tests/launcher-contract.test.mjs | test_same_contract_across_bash_and_node | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/cross-platform-launcher/spec.md → 迁移以同一行为断言和真实平台验收收口 | Windows 真实链路失败不能以桩通过放行 | tests/launcher-acceptance.test.mjs | test_full_manifest_failure_blocks_support_claim | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/repo-layout/spec.md → 仓库初始化按最低版本准则校验 Node/npm 工具链 | 高于最低版本但不等于推荐版本 | tests/launcher-bootstrap.test.mjs | test_minimum_pass_recommended_difference_warns | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/repo-layout/spec.md → 仓库初始化按最低版本准则校验 Node/npm 工具链 | 低于最低版本 | tests/launcher-bootstrap.test.mjs | test_below_minimum_rejects | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/repo-layout/spec.md → 仓库初始化按最低版本准则校验 Node/npm 工具链 | 工具链缺失 | tests/launcher-bootstrap.test.mjs | test_missing_toolchain_is_actionable | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/repo-layout/spec.md → 仓库初始化按最低版本准则校验 Node/npm 工具链 | 最低版本声明保持单一准则 | tests/launcher-bootstrap.test.mjs | test_engines_recommendation_and_docs_agree | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/repo-layout/spec.md → 仓库初始化按最低版本准则校验 Node/npm 工具链 | 重复初始化与安装失败 | tests/launcher-bootstrap.test.mjs | test_bootstrap_repeat_and_install_failure | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/repo-layout/spec.md → manifest 消费脚本自行读取 .env.local 中决定部署内容的变量 | 裸跑 sync 采用 .env.local 中的 overlay 路径 | tests/sync-env-local.test.mjs | bare sync picks DSH_LOCAL_MANIFEST up from .env.local, idempotently, without echoing it | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/repo-layout/spec.md → manifest 消费脚本自行读取 .env.local 中决定部署内容的变量 | 调用方显式设置的值优先 | tests/sync-env-local.test.mjs | a caller-set value (even empty) wins over .env.local | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/repo-layout/spec.md → manifest 消费脚本自行读取 .env.local 中决定部署内容的变量 | .env.local 中的 enabledEnv 开关生效 | tests/sync-env-local.test.mjs | enabledEnv switches in .env.local apply, for public and overlay entries alike | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/repo-layout/spec.md → manifest 消费脚本自行读取 .env.local 中决定部署内容的变量 | overlay 条目声明的 enabledEnv 同样从 .env.local 读取 | tests/sync-env-local.test.mjs | enabledEnv switches in .env.local apply, for public and overlay entries alike | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/repo-layout/spec.md → manifest 消费脚本自行读取 .env.local 中决定部署内容的变量 | 非白名单变量不被读取 | tests/sync-env-local.test.mjs | variables outside the allow-list are not read | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/repo-layout/spec.md → manifest 消费脚本自行读取 .env.local 中决定部署内容的变量 | 白名单变量含 shell 展开时 sync 拒绝运行 | tests/sync-env-local.test.mjs | an allow-listed value needing shell expansion makes sync refuse without touching DSH_HOME | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/repo-layout/spec.md → manifest 消费脚本自行读取 .env.local 中决定部署内容的变量 | 白名单变量含 shell 展开时启动清单降级 | tests/sync-env-local.test.mjs | the startup listing degrades on the same input | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/repo-layout/spec.md → manifest 消费脚本自行读取 .env.local 中决定部署内容的变量 | 非白名单行的 shell 语法不影响运行 | tests/sync-env-local.test.mjs | shell syntax on lines outside the allow-list is ignored | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/repo-layout/spec.md → manifest 消费脚本自行读取 .env.local 中决定部署内容的变量 | 严格启动入口与白名单裸入口边界明确 | tests/launcher-env-local.test.mjs | test_strict_and_allowlist_entry_boundary | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/startup-autoupdate/spec.md → stop/restart 按端口安全管理 server 与 UI 生命周期 | npm/npx 升级改变 server argv | tests/launcher-process.test.mjs | test_supported_dsh_argv_stops | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/startup-autoupdate/spec.md → stop/restart 按端口安全管理 server 与 UI 生命周期 | 端口被非 DSH 服务占用 | tests/launcher-process.test.mjs | test_foreign_listener_is_untouched | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/startup-autoupdate/spec.md → stop/restart 按端口安全管理 server 与 UI 生命周期 | stop 不触发运行体解析 | tests/launcher-contract.test.mjs | test_stop_is_local_only | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/startup-autoupdate/spec.md → stop/restart 按端口安全管理 server 与 UI 生命周期 | restart 清理重复 UI | tests/platform/darwin-launcher.test.mjs | macOS cleanup sends bounded PWA quit before same-port Chrome tab cleanup | 🔴 macOS 真机 surface 未跑（仅 argv 单测） |
| specs/startup-autoupdate/spec.md → stop/restart 按端口安全管理 server 与 UI 生命周期 | Windows 强制停止只影响已核验树 | tests/platform/windows-launcher.test.mjs | native Windows ownership preserves Unicode spaced entry paths and stops only its fixture | 🟢 原生 Win32 GREEN（最终60/60 batch；见 native-windows-evidence） |
| specs/startup-autoupdate/spec.md → stop/restart 按端口安全管理 server 与 UI 生命周期 | 探测失败或停止期间身份变化 | tests/launcher-process.test.mjs | test_unknown_or_reused_identity_refuses_signal | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/startup-autoupdate/spec.md → stop/restart 按端口安全管理 server 与 UI 生命周期 | 查询未见监听者但端口可连接 | tests/launcher-process.test.mjs | test_invisible_listener_is_unknown | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/startup-autoupdate/spec.md → stop/restart 按端口安全管理 server 与 UI 生命周期 | 替代运行体准备失败保留现役 Host | tests/launcher-lifecycle.test.mjs | test_failed_replacement_keeps_healthy_host | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/startup-autoupdate/spec.md → stop/restart 按端口安全管理 server 与 UI 生命周期 | 非 macOS stop 不杀浏览器 | tests/launcher-ui.test.mjs | test_non_darwin_stop_preserves_browser | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/startup-autoupdate/spec.md → UI 自动打开可由 manifest 关闭 | 缺省自动打开且不重复 | tests/launcher-ui.test.mjs | test_default_open_happens_once | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/startup-autoupdate/spec.md → UI 自动打开可由 manifest 关闭 | manifest 关闭自动打开 | tests/launcher-ui.test.mjs | test_manifest_no_open_for_all_start_paths | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/startup-autoupdate/spec.md → UI 自动打开可由 manifest 关闭 | 显式参数优先 | tests/launcher-ui.test.mjs | test_no_open_beats_open_and_manifest | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |
| specs/startup-autoupdate/spec.md → UI 自动打开可由 manifest 关闭 | opener 不可用仍保留服务 | tests/launcher-ui.test.mjs | test_opener_failure_keeps_host_and_prints_url | 🟢 Linux 完整根回归 GREEN（bash-304，577/575/0/2既有skip） |

## D8 follow-up mapping (2026-10-25; focused implementation reviewed, not whole-change acceptance)

| Requirement | Scenario | Test File | Test Name | State |
|---|---|---|---|---|
| Host builder 使用精确脚本策略和可恢复发布 | 未审查脚本版本拒绝 | tests/compat-launcher-policy.test.mjs | exact policy rejects blanket grants and unknown scripts | 🟢 Linux20/20/native19/19 focused batch; pinned npm offline unknown/no-sentinel vs hostile npmrc; focused final review PASS (real Host separate) |
| Host builder 使用精确脚本策略和可恢复发布 | Windows 发布失败恢复旧链接 | tests/compat-launcher-publish.test.mjs | publication rollback preserves targets and refuses unknown entities | 🟢 Linux20/20/native19/19 focused batch; per-stage failures, ownership/residuals, POSIX backup/atomic restore, no GC; final review PASS |
| Host builder 使用精确脚本策略和可恢复发布 | 启动方跨发布保持同一物理运行体 | tests/dsh-host-runtime.test.mjs | prepared Host pins physical generation under shared lock | 🟢 Linux20/20/native19/19 focused batch incl real default prepare final-read competitor, four outcomes, physical entry after switch; early-release mutation RED; final review PASS |

## Coverage Notes

- 47/47 场景覆盖；每行 requirement + scenario 二元组唯一。已有回归的语义先复用，不重复创建同义测试；若使用旧测试名，实施时先更新本账本的精确名称，不能让映射虚悬。所有行均为可执行行为，不用 N/A 掩盖平台验收。
- P1 等价拆分由当前 84 个相关基线测试及额外24个 manifest/facade 测试保护。P2 的同语义用例先证明断言能抓住破坏（可用 fixture/mutation 负例使断言红，再恢复），然后固定 Bash 行为；新行为先在旧实现或未实现模块上 RED。不得为了纯重构 TDD 故意让生产行为变坏。
- P3 同一 runner/fixtures/断言切到 Node adapter，Bash 和 Node 仅执行适配器不同；禁止替换源文本某一行或降低安全断言。新严格 env、错误参数、退出码等差异在账本中单列，不能伪称旧 Bash 已绿。
- Windows/darwin/终端测试置于 tests/platform/，由相应平台显式执行，不在其他平台以 skip 伪装覆盖；所有支持平台汇总必须有对应 GREEN。终端测试必须真实关闭隔离会话，自动化不可用时仍 red，不能换成递归 taskkill 父树。
- tests/launcher-acceptance.test.mjs 测试验收报告判定器，输入失败/缺失证据必须拒绝支持声明；它不代替真实完整 build gate。P4 另执行三平台公开 manifest build×2、dump、Host ready/stop；记录精确 commit、Node/npm、平台、命令与结果。
- Test isolation: 独立 DSH_HOME/端口、临时 prefix、空 overlay、合成 secrets；cleanup 只回收 fixture 拥有的进程/路径。环境 parser 测试不能读真实 .env.local。
- tests/launcher-bootstrap.test.mjs 对缺 Node 用文档检查及保留 wrapper 的隔离 PATH 子进程；Node 本体缺失不能通过 Node 程序自行报告，不能伪造这一前提。
- 补充回归（映射下限以外）：无源码副作用 source/import、foreground 非零退出、reset 不改 manifest、history 末20行、autoUpdate/offline/dirty/rollback、doctor 非阻塞与只读、npm/Corepack resolver 布局、bounded timeout树清理、Windows argv 反斜杠、opener host不注入、显式 registry来源、DSH_PROFILE 与 runtime compat pin。
- 实施前完整根基线尚需在 promote/恢复依赖后重跑。checking/planning-baseline.md 已记录当前缺 tsc 与未 stage archive 对 git-ls-files 治理测试的影响；不把这些失败静默忽略。
- apply 时依次更新每行 red→green；verify 需要全部映射真实存在、完整测试结果与三平台证据，不生成空 verify 占位来凑 artifact completion。

## Implementation mapping reconciliation

Exact names above now reference retained tests where their existing assertions already cover the scenario. The enabledEnv test covers public and overlay in one test (two requirement/scenario rows intentionally share that single exact test). Node process identities map to the new Node suite, not the historical Bash oracle. macOS argv contract does not prove a real PWA/tab surface was cleaned; that row remains red until native surface acceptance. Terminal-close remains red until an actual controlling-terminal/console-close harness executes.
