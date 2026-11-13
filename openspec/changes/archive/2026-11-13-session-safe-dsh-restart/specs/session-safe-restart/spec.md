## ADDED Requirements

本 capability 只规定**在 DSH 会话内发起**的 `dsh restart` 的附加行为。外部终端 restart 的同步契约仍由 `startup-autoupdate` 规定，本变更不修改它。

### Requirement: 会话语境判定必须先于任何副作用

`dsh restart`（不含 buildOnly 组合）必须(SHALL)在参数校验与预览 3080 防护之后、任何 probe/autoUpdate/prepare/stop 之前，只用本地只读证据判定是否在 DSH 会话内：Linux 的 `/proc/self/cgroup` 命中 `/dsh-(?:subprocess|terminal)-\d+-[0-9a-f]+\.scope/`（cgroup 证据，读取失败视为未命中）；或任一平台有 `DSH_SHELL=1`、非空 `DSH_SESSION_ID`/`DSH_PTY_SESSION_ID`（标记证据）。都没有时走原同步路径，行为不变。`dsh-restart-*` scope 不得(SHALL NOT)被当作 Host 管理范围；测试用的 `DSH_RESTART_CONTEXT=external` 仅在 `NODE_TEST_CONTEXT` 存在时生效。

#### Scenario: Linux bash 工具或终端 range 判为会话内

- **GIVEN** cgroup 为 `dsh-subprocess-<hostpid>-<hex>.scope` 或 `dsh-terminal-<hostpid>-<hex>.scope`
- **WHEN** 执行 `dsh restart`
- **THEN** 归类为会话内（cgroup 证据），即使会话标记被剥离

#### Scenario: macOS 或无 user systemd 的 Linux 以标记判定

- **GIVEN** 无 Host 管理的 cgroup，环境中有 `DSH_SHELL=1` 或 `DSH_SESSION_ID`
- **WHEN** 执行 `dsh restart`
- **THEN** 归类为会话内（标记证据）

#### Scenario: 外部终端不被误判

- **GIVEN** 无匹配 cgroup、无会话标记
- **WHEN** 执行 `dsh restart`
- **THEN** 走原同步路径，不创建状态目录、不 spawn 编排进程

#### Scenario: 测试 override 不能被普通 agent 环境利用

- **GIVEN** 有会话标记且 `DSH_RESTART_CONTEXT=external`，但没有 `NODE_TEST_CONTEXT`
- **WHEN** 判定会话语境
- **THEN** 仍归类为会话内

### Requirement: 会话内 restart 必须由脱离 Host 管理范围的编排进程执行

Linux 与 macOS 上，会话内 `dsh restart` 不得(SHALL NOT)在调用进程里停止 Host，而必须(SHALL)以 argv 数组（不经 shell）把同一个 launcher 以原始参数 re-exec 成编排进程。cgroup 证据时经 `systemd-run --user --scope --quiet --collect --unit=dsh-restart-<restartId> --` 进入新的 user scope；标记证据时（macOS、PGID fallback 的 Linux）直接 spawn。两种方式都必须(SHALL)使用 `detached:true`、`stdio:'ignore'` 并 `unref()`。编排进程及其启动的替代 Host 的环境必须(SHALL)去掉会话标记（`DSH_SHELL`、`DSH_SESSION_ID`、`DSH_WEB_URL`、`DSH_PTY_SESSION_ID`）与全部 `DSH_RESTART_*`。

#### Scenario: 旧 Host 杀掉调用者所在范围后编排进程存活

- **GIVEN** 调用者位于 Host 管理的 systemd scope（Linux）或其进程组（POSIX fallback）
- **WHEN** 排程返回后，该 scope 被 SIGKILL 或该进程组被杀掉
- **THEN** 编排进程继续运行并完成 restart；Linux 上它所在的 cgroup 是 `dsh-restart-*.scope`，不匹配 Host 管理范围；其环境中没有会话标记

### Requirement: 会话内 restart 必须经带 nonce 的握手在 Host 停止前返回

握手必须(SHALL)经 `$DSH_HOME/state/dsh-restart/<restartId>/` 下带随机 nonce 的文件进行：launcher 独占写 `meta.json` → 编排进程校验后写 `ready` → launcher 写 `go`、打印"已排程/将断开/用 dsh history 查看"并返回 0 → 编排进程看到 `go` 后等待宽限期（默认 3s），再执行与外部 restart 相同的 launcher 流程。

#### Scenario: 命令返回早于 Host 停止

- **GIVEN** 支持平台的会话内调用
- **WHEN** 执行 `dsh restart`
- **THEN** 命令以 0 返回，此时编排进程尚未调用 stop；宽限期之后才停止 Host

### Requirement: 握手失败与不支持的组合必须在不停止 Host 的方向收敛

launcher 在上限内（10s）没收到 `ready`、或编排进程提前退出时，必须(SHALL)写 `abort`、记录失败并非零退出，且不停止 Host。编排进程在上限内（30s）没看到 `go`、或看到 `abort`（`abort` 优先于 `go`）时，必须(SHALL)不停止 Host 直接退出。`DSH_RESTART_ORCHESTRATED=1` 但 meta 缺失、nonce 不匹配或命令不是 restart 时，必须(SHALL)报错且不停止 Host；该内部协议不是安全边界，只防误用。会话内 `restart --foreground` 与 Windows 上的会话内 restart 必须(SHALL)在副作用前报错。

#### Scenario: 未 ack 时 Host 不动

- **GIVEN** 编排进程未写 `ready`（启动失败或提前退出）
- **WHEN** launcher 等待 ready
- **THEN** 非零退出，stderr 说明当前 Host 未停止；receipt 记录 `failed`、`failedPhase=schedule`

#### Scenario: 伪造或不完整的 handoff 不会停止 Host

- **GIVEN** 只设了 `DSH_RESTART_ORCHESTRATED=1`、nonce 不匹配，或命令不是 restart
- **WHEN** 运行 launcher
- **THEN** 报错退出，不调用 stop

#### Scenario: abort 优先于 go

- **GIVEN** 状态目录里同时存在有效的 `go` 和 `abort`
- **WHEN** 编排进程检查标记
- **THEN** 不停止 Host，receipt 记录 `failed`、`reason=aborted`、`hostStopped=false`

#### Scenario: Windows 与 --foreground 被拒绝

- **GIVEN** 会话内调用，平台为 win32，或带 `--foreground`
- **WHEN** 执行 `dsh restart`
- **THEN** 在任何 probe/prepare/stop 之前报错

### Requirement: 会话内 restart 结果必须持久化并可经 dsh history 查看

编排进程必须(SHALL)向 `$DSH_HOME/dsh-restart.log` 追加 JSONL 事件（文件 0600）。每个事件带 `restartId`、`ts`、`phase`；phase 依次为 `scheduling`、`orchestrator-ready`、`stopping`、`stopped`、`starting`，并以 `ready` 或 `failed` 结束。`failed` 必须(SHALL)带 `failedPhase` 和 `hostStopped`，说明失败发生时 Host 是否已被停止。编排进程的日志写入 `$DSH_HOME/dsh.log`，行首带 `[restart <restartId>]` 前缀。结束后状态目录必须(SHALL)被删除。

`dsh history` 在原有 startup 输出之后，必须(SHALL)展示 receipt 中最近一次 run 的全部事件；尚无终态时注明"未结束"，并给出外部终端执行 `dsh` 的恢复提示。没有 receipt 时输出不变。

#### Scenario: 成功重启可在重连后验证

- **GIVEN** 一次会话内 restart 成功
- **WHEN** 重连后执行 `dsh history`
- **THEN** 最近一次 run 以 `ready` 结束，阶段序列完整

#### Scenario: 停止之后的失败如实报告

- **GIVEN** Host 已停止后替代 Host 启动失败
- **WHEN** 读取 receipt
- **THEN** 终态为 `failed`，`failedPhase` 是失败时所处的阶段，`hostStopped=true`

### Requirement: agent 指令必须写清会话内重启的同意规则、断线预期与验证方式

`instructions/dsh-home.md`、`skills/add-dsh-plugin/SKILL.md`、`skills/remove-dsh-plugin/SKILL.md` 与 README 必须(SHALL)写明：仅当用户明确要求时 agent 才可在会话内执行 `dsh restart`；执行前告知"本次会话将断开"；返回 0 只表示已排程，不得当次宣称重启成功；重连后用 `dsh history` 按 receipt 验证；会话未断开时立即查看 `dsh history`；Host 未恢复时在外部终端执行 `dsh`；Windows 会话内不支持。旧的"请用户自己执行 dsh restart"指引必须(SHALL)被移除。

#### Scenario: 生成的 agent 指令包含规则

- **WHEN** 在隔离 `DSH_HOME` 下运行 sync
- **THEN** 生成的 `AGENTS.md` 含 `仅当用户明确要求`、`本次会话将断开`、`返回 0 只表示已排程`、`dsh history`，且不含 `请用户自己执行`
