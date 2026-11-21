## Context

- Host 停止时终止其管理的执行范围（`$COMPAT/dsh-subprocess-local/README.md` "Shutdown behavior"：disposal terminates every running managed range and terminal session）。`$COMPAT` 指当前运行体的 compat build：`packages/dsh-pet/compat/subagent/.launcher-builds/<fingerprint>/node_modules/@deepseek-ai/`。
  - Linux native ownership：每个 bash 工具调用、每个终端在 `dsh-subprocess-<hostpid>-<hex>.scope` / `dsh-terminal-<hostpid>-<hex>.scope` 里（`lib/index.js` 的 `unitStem`），Host 通过 systemd 杀整个 scope，`setsid`/`nohup` 都逃不掉。
  - macOS 与旧 systemd 的 Linux：PGID fallback（README "Known Limitations"：macOS always uses that fallback）。Host 杀进程组；终端额外从进程树和终端会话里抓身份。新会话里的进程、且已被 reparent 到 init 的进程不在其中。
- 实测（2026-10-29，systemd 255，WSL2）：`systemd-run --user --scope` 在 v255 上把自身进程移进新 scope 后原地 `exec` 命令，因此不存在独立的"客户端"进程；被 exec 的命令所在的 cgroup 就是新 scope。
- 现有 restart 流程：`main.mjs` 中 probe → autoUpdate/prereq →（restart）prepare → doStop → spawn Host → readiness。

## Goals / Non-Goals

Goals：Linux 与 macOS 的会话内 `dsh restart` 能完成停旧 Host、起新 Host；命令在 Host 停止前返回；任何握手失败都不停 Host；结果可在重连后查到。

Non-Goals：见 proposal 的"收窄范围"。

## Decisions

### D1. 判定

`sessionEvidence({platform, env, readCgroup})`：Linux 先读 cgroup，匹配 `MANAGED_RANGE` → `{kind:'cgroup'}`；再看标记 → `{kind:'marker'}`；否则 `undefined`。

- 不再像原设计那样对"cgroup 不可读"或"标记与 cgroup 冲突"做 fail-closed。原因：在 Linux/macOS 上误判为会话内只是改走异步排程，本身安全；fail-closed 反而让本可完成的重启失败。
- 插入点：`flags.restart && !flags.buildOnly && !orchestrated`，位于 preview 3080 防护、stop/history/doctor 等分支之后，`probe` 之前。
- 测试 seam：进程内用 `options.sessionContext`（`'external'` 或 evidence 对象）；子进程测试用 `DSH_RESTART_CONTEXT=external`，且仅在 `NODE_TEST_CONTEXT` 存在时生效。

### D2. 脱离方式按证据选择

- cgroup 证据意味着 Host 在用 systemd scope 管理，必须换 cgroup：`systemd-run --user --scope --quiet --collect --unit=dsh-restart-<id> -- node bin/dsh.mjs <argv>`。`dsh-restart-*` 不匹配 `MANAGED_RANGE`，所以编排进程不会再把自己判成会话内（它本来也走 orchestrated 分支）。
- 标记证据（macOS、PGID fallback）：`spawn(node, [bin/dsh.mjs, ...argv], {detached:true})`。`detached` 在 POSIX 上调用 `setsid`，进入新会话和新进程组；launcher 返回后编排进程被 reparent 到 init，Host 的进程组/进程树清理都覆盖不到它。
- 两者都 `stdio:'ignore'` + `unref()`，launcher 不会被子进程句柄拖住。
- 拒绝的方案：transient service（主进程退出时按 `KillMode=control-group` 杀掉同 cgroup 里的替代 Host）；Linux native 模式下用 `setsid`（换不掉 cgroup）；launchd job（macOS 上 detached 已足够，不必引入额外机制）。

### D3. 握手

1. launcher：生成 `restartId`（时间-pid-随机）与 32 hex `nonce`；`mkdir -p` 状态目录（0700），以 `wx` 写 `meta.json`（version、restartId、nonce、home、evidence）；receipt 记 `scheduling`。
2. spawn 编排进程，环境附加 `DSH_RESTART_ORCHESTRATED=1`、`DSH_RESTART_DIR`、`DSH_RESTART_NONCE`（在 caller 原始环境上叠加，让 `.env.local` 由编排进程自己重新加载）。
3. launcher 轮询 `ready`（nonce 匹配），上限 `READY_TIMEOUT_MS=10s`；编排进程 `exit`/`error` 立即失败。失败时写 `abort`，receipt 记 `failed/schedule`，非零返回。
4. 成功：以 `wx` 写 `go` → 打印三行说明 → 返回 0。
5. 编排进程（`runLauncher` 入口看到 `DSH_RESTART_ORCHESTRATED=1`）：先校验命令是 restart，再校验 meta 与 nonce，失败则抛错。以 `wx` 写 `ready`，receipt 记 `orchestrator-ready`。轮询 `go`/`abort`，上限 `GO_TIMEOUT_MS=30s`，abort 优先。看到 go 后等 `GRACE_MS=3s`，再以 `orchestrated:true`、去掉标记的环境、文件日志 sink 和 `onPhase` 回调调用正常 `launch()`。
6. 结束：receipt 记 `ready` 或 `failed`（带 `failedPhase`、`hostStopped`、`rc`/`reason`），`finally` 删除状态目录。

READY 上限从原设计的 5s 放宽到 10s：编排进程冷启动要跑 bootstrap 依赖检查和模块加载，WSL 上可能接近 5s。

### D4. 阶段回调

`launch()` 增加 `onPhase`，默认 no-op：stop 前 `stopping`，stop 后 `stopped`，spawn 替代 Host 前 `starting`（带 port）。外部路径不传 `onPhase`，行为不变。

### D5. 环境

`withoutSessionMarkers` 去掉 `DSH_SHELL`、`DSH_SESSION_ID`、`DSH_WEB_URL`、`DSH_PTY_SESSION_ID` 和 `DSH_RESTART_*`。用在两处：编排进程调用 `launch()` 时的 caller 环境（因此 npm/脚本/Host 环境都干净）；所有路径上 spawn Host 时的 `hostEnv`。外部终端本来就没有这些变量，所以对外部路径无影响。

### D6. Receipt 与 history

`$DSH_HOME/dsh-restart.log`，JSONL，追加写，0600。`restartHistory(home)` 尾读 64KiB，取最后一个 restartId 的全部事件；没有终态时追加提示。`dsh history` 在 startup 输出后打印它，没有 receipt 时输出不变。

## Risks / Trade-offs

- [DSH 升级后 provider 的 scope 前缀或 macOS fallback 语义变化] → 升级时重新核对 `$COMPAT/dsh-subprocess-local` 的 `unitStem` 前缀和 README 的 shutdown/limitations 段；`tests/launcher-session-restart-detach.test.mjs` 会在机制失效时变红。
- [systemd 将来改为 fork 而不是 exec] → scope 内命令仍在新 cgroup，而留在旧 scope 的 systemd-run 客户端被杀不影响它；测试会覆盖。
- [macOS 未在真机验证] → POSIX 进程组测试在 Linux 上覆盖了同一机制；真机 macOS 验收作为后续事项记录在 tasks。
- [标记被剥离、又没有 cgroup 证据] → 会按外部路径同步执行，重现旧问题。属于残余风险，指令要求 agent 不得改写环境去调用。
- [并发 restart] → 不互斥；最后启动者胜出。指令要求多人请求重启时先问用户。
- [停止之后启动失败] → receipt 记 `hostStopped=true`，指令要求在外部终端执行 `dsh` 恢复。

## Migration Plan

1. 合入后 launcher 直接运行仓库源码，没有数据迁移。
2. 指令变更在主 checkout 执行 `dsh build`（第二次应无变更）后物化到 `$DSH_HOME/AGENTS.md`。
3. 回滚：revert 即可；receipt 与状态目录无害。
