## Why

在 DSH 会话内执行 `dsh restart` 会**停机成功、启动没发生**。bash 工具和终端运行在 Host 管理的执行范围里：Linux 是 `dsh-subprocess-<hostpid>-*.scope` / `dsh-terminal-*.scope`，macOS 是 Host 记录的进程组。Host 收到 SIGTERM 后会终止这些范围，执行 restart 的 launcher 在停掉旧 Host 之后、拉起新 Host 之前就被一起杀掉了，失败也没有任何记录。2026-10-26 11:35 本机真实发生过：输出停在 prepare，`dsh-startup.log` 没有这次的成功记录，用户只能从外部终端再执行一次。结果是部署后需要重启时，agent 无法替用户完成，误以为已重启又会导致错误验收。

## What Changes

- **会话语境判定**：restart 在任何副作用之前判定是否在会话内。依据是 Linux 的 Host 管理 cgroup，以及所有平台上的会话标记（`DSH_SHELL=1`、`DSH_SESSION_ID`、`DSH_PTY_SESSION_ID`）。外部终端路径行为不变。
- **脱离 + 握手**：会话内调用把同一 launcher 以原始 argv re-exec 成编排进程。Linux 用 `systemd-run --user --scope` 换到新 cgroup；macOS 和 PGID fallback 的 Linux 用 `detached` spawn，进入新会话和进程组。双方经 `$DSH_HOME/state/dsh-restart/<id>/` 下带 nonce 的 `meta`/`ready`/`go`/`abort` 文件握手。命令先返回"已排程"，编排进程等宽限期（3s）后才走与外部 restart 相同的流程。未 ack、go 超时、abort、handoff 伪造都不会停止 Host。
- **Windows**：会话内 restart 在副作用前拒绝，提示到外部终端执行。外部终端行为不变。
- **receipt + history**：编排进程把各阶段写入 `$DSH_HOME/dsh-restart.log`（JSONL），失败事件带 `failedPhase`、`hostStopped`；`dsh history` 展示最近一次 run。
- **替代 Host 环境**：去掉会话标记和 `DSH_RESTART_*`，避免新 Host 误以为自己处在会话里。
- **指令更新**：`instructions/dsh-home.md`、add/remove 插件 skill、README 改为：仅当用户明确要求才可在会话内重启；执行前告知断线；返回 0 只表示已排程；重连后用 `dsh history` 验证。

### 2026-10-29 收窄范围

原设计（commit `5546687b`，3 轮评审见 `review-round1.md`、`review-round2.md`、`review.md`）只支持 Linux，并包含 capability probe、expected 身份 epoch、旧进程退出证明、并发 churn 对账、history liveness 判定等，共 130 项任务。用户要求"Linux 和 macOS 能正常用、Windows 先不管"，因此改为当前的最小实现。下列内容明确**不做**，相关评审意见视为已由范围调整关闭：

- capability probe：systemd-run 不可用时编排进程起不来，会落到未 ack 分支，效果同样安全。
- expected 身份与 epoch 复验：stop 仍由现有 `stopServer` 的归属校验把关，不会杀非 DSH 进程。
- 旧进程退出证明：沿用现有"端口释放即可启动"的语义。
- 并发 restart 互斥与 superseded 对账、history 的 liveness/abandoned 分类。
- 状态目录的逐级权限与 symlink 校验：与 `$DSH_HOME` 其余文件同一信任边界。

非目标：常驻 supervisor 与开机自启；Windows 会话内重启；不改变外部终端 restart 的语义和输出；不保证重启不打断进行中的 turn，只保证失败不被误报。

## Capabilities

### New Capabilities

- `session-safe-restart`：会话内 `dsh restart` 的判定、脱离与握手、receipt/history、agent 指令规则。

### Modified Capabilities

无。外部 restart 契约仍由 `startup-autoupdate` 规定。

## Impact

- 代码：新增 `scripts/launcher/session-restart.mjs`；`scripts/launcher/main.mjs` 增加分流、编排入口、阶段回调、history 扩展，并在 Host spawn 时剥离会话标记。
- 测试：新增 `tests/launcher-session-restart.test.mjs`（协议单测）、`tests/launcher-session-restart-detach.test.mjs`（真实进程：Linux 用 systemd scope 被 SIGKILL，POSIX 用进程组被杀）；`tests/helpers/launcher-fixture.mjs` 与 `tests/launcher-lifecycle.test.mjs` 显式声明外部语境。
- 文档：`instructions/dsh-home.md`、`skills/{add,remove}-dsh-plugin/SKILL.md`、`README.md`、`README.zh.md`。
- 运行面：不改 `dsh.yaml`，不新增依赖。
