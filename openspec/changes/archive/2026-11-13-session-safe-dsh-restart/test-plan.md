## Test Plan

依据：收窄后的 `specs/session-safe-restart/spec.md`（6 requirements / 13 scenarios）。

| Requirement | Scenario | Test File | Test Name |
|-------------|----------|-----------|-----------|
| 会话语境判定必须先于任何副作用 | Linux bash 工具或终端 range 判为会话内 | tests/launcher-session-restart.test.mjs | session evidence: Host-managed cgroup ranges, then markers |
| 同上 | macOS 或无 user systemd 的 Linux 以标记判定 | 同上 | 同上 |
| 同上 | 外部终端不被误判 | 同上 | 同上；以及 launcher-contract / launcher-lifecycle 的外部 restart 用例 |
| 同上 | 测试 override 不能被普通 agent 环境利用 | 同上 | the external test override needs node --test and cannot hide a real agent env otherwise |
| 会话内 restart 必须经带 nonce 的握手在 Host 停止前返回 | 命令返回早于 Host 停止 | 同上 | schedule returns before the Host stops; orchestrator runs the restart with a clean env |
| 会话内 restart 必须由脱离 Host 管理范围的编排进程执行 | 旧 Host 杀掉调用者所在范围后编排进程存活 | tests/launcher-session-restart-detach.test.mjs | Linux: orchestrator survives SIGKILL of the Host-managed scope …；POSIX fallback …: orchestrator survives a process-group kill |
| 握手失败与不支持的组合必须在不停止 Host 的方向收敛 | 未 ack 时 Host 不动 | tests/launcher-session-restart.test.mjs | no ack: …；an orchestrator that dies early fails fast … |
| 同上 | 伪造或不完整的 handoff 不会停止 Host | 同上 | a forged or partial handoff never runs the restart；runLauncher: an orchestrated env only accepts restart |
| 同上 | abort 优先于 go | 同上 | abort wins over go and the Host stays up |
| 同上 | Windows 与 --foreground 被拒绝 | 同上 | runLauncher: session restart schedules before any probe, update or stop |
| 会话内 restart 结果必须持久化并可经 dsh history 查看 | 成功重启可在重连后验证 | 同上 | schedule returns before the Host stops …（receipt 序列与 restartHistory） |
| 同上 | 停止之后的失败如实报告 | 同上 | a failure after stop is reported as such |
| agent 指令必须写清会话内重启的同意规则、断线预期与验证方式 | 生成的 agent 指令包含规则 | tests/sync-agent-instructions.test.mjs | session restart rules are materialized |

人工验收：tasks 第 4 组。进程内测试一律用 stub 的 `probe`/`stop` 和不可能命中真实服务的 `DSH_PORT`，不得触碰真实 3080 Host。
