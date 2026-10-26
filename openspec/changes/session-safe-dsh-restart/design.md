## Context

- **基线**：本工作树已 fast-forward 到 `main@da3fefd7`（round 2 时为 `8aeca83d`）。main 已把启动器扩展到预览/隔离路径：`scripts/launcher/preview.mjs`、`main.mjs:47-59,72-78,94-102,132-136,197-201,213`（隔离 home、3180..3279 预览端口、`preview.json` 身份、禁止预览操作 3080）；`args.mjs` 的 `--port` 改为惰性默认值 + `portExplicit`。所有引用以 rebase 后文件为准；实施时若 main 再前进必须重核。
- 当前 restart 流程（`scripts/launcher/main.mjs`）：`autoUpdate` 与 `ensurePrerequisites` 在 `:103-110`；`-b/--build` 在同一段追加 sync build；`buildOnly` 在 `:111` 返回；`restart` 分支在 `:123` 做 `prepare()` → `doStop()`；Host spawn/readiness 在 `:139-195`。stop 证明是"端口空且监听者身份未变"（`process.mjs:161-208`，身份比较见 `process.mjs:72-76` 的 `sameProcessIdentity`：pid+created+argv+executable）。
- 会话内 shell 的宿主范围：普通子进程 `dsh-subprocess-<hostpid>-<hex>.scope`、PTY 终端 `dsh-terminal-<hostpid>-<hex>.scope`（`$COMPAT/dsh-subprocess-local/lib/index.js:48-50,458,486`）。Host SIGTERM → dispose（`$COMPAT/dsh/lib/profile-boot-BZ2ZjNWi.js:12,230,243,249`；其中 `PROCESS_SHUTDOWN_TIMEOUT_MS = 5e3`），provider 的 shutdown 契约是"终止所有 running managed range 与 terminal session 并等待 quiescence"（`$COMPAT/dsh-subprocess-local/README.md:66`），且 Linux direct exit 无独立 deadline、provider quiescence 可能超过 5s（`README.md:149`）。因此会话内启动器在 stop 段被杀，spawn 替代 Host 的代码不会执行。
- 会话标记：`dsh-shell-env` 对每次模型 shell 调用注入 `DSH_HOME`/`DSH_SHELL=1`，agent 调用注入 `DSH_SESSION_ID`（`$COMPAT/dsh-shell-env/README.md:32`）；终端会话注入同样标记（`$COMPAT/dsh-terminal-bash/lib/index.js:941-943`）。保留 built-in 见 `dsh-shell-env/README.md:67,83`；父进程环境可被剥离。
- `$COMPAT` 指锁定运行体的 compat build：`packages/dsh-pet/compat/subagent/.launcher-builds/<fingerprint>/node_modules/@deepseek-ai/`。**评审依据 = 当前运行 build 的 fingerprint**（round 3 时运行体为 `03cc4898…`、round 2 为 `d1fbbf15…`，两代被抽查的 provider 行一致）；DSH 升级/换 fingerprint 必须重新扫描 D1/D3 引用的 provider 行为。
- 2026-10-26 11:35 的用户报告事件：会话内 `node bin/dsh.mjs restart --no-open`（background job）输出停在 prepare；`~/.dsh/dsh-startup.log` 只有 `hostPrerequisites: skipped`（`15:35:04.948Z`）而无本次成功记录；随后外部终端 `dsh restart` 成功记录于 `15:35:37.386Z`。秒级时间（11:35:32/11:35:35）为用户报告，不是日志字段。
- 平台/机制事实：`systemd-run --user --scope` 以自身为父进程执行命令、继承调用方环境、同步等到命令结束；`--scope` 下 `--expand-environment` 默认关闭（man `systemd-run`/`systemd.kill`）。transient service 主进程退出会按 `KillMode=control-group` 清理同 cgroup 残留（`systemd.kill(5)`）。
- 本轮实测（author measurement，范围限定）：launcher 用 `spawn(systemd-run,…,{stdio:'ignore'})+unref()` 时，**外层 launcher 进程**在 ~21ms 内返回；scope 内 node 进程在外层退出后继续运行/写文件/向 `/dev/null` 写日志（无 EPIPE）、结束后 scope 自动 collected。**尚未实测**的是 Host dispose 直接 SIGTERM/SIGKILL 掉 `systemd-run` 客户端后 orchestrator 是否存活——该性质由 D10 的真实 systemd 集成测试固定，人工 WSL E2E 为最终门禁。
- 规范坐标：stop/restart 基础行为由 `startup-autoupdate` 当前需求描述，且正被未归档的 `cross-platform-launcher` 以 MODIFIED delta 改写；本变更不修改该需求，只新增 capability，归档顺序见 D11。

## Goals / Non-Goals

**Goals:**

- 会话内 `dsh restart` 不再因调用者随 Host dispose 被杀而"未尝试启动"：支持平台完成三段握手 + 结果投递宽限后才停止；不支持环境在副作用前 fail-closed。
- 单一口 `dsh restart`，隐式分流；返回 0 只表示"已排程"。
- 会话与外部路径执行**同一套 launcher 代码**（re-exec 内部模式），preview/隔离 home、端口回退、build、passthrough、UI 策略天然一致。
- stop→start 交接有旧进程退出证明、identity epoch 防过期编排；prepare/stop/handoff/start 失败与 orchestrator 死亡都有可诊断终态或 history 状态。
- 持久 receipt + `dsh history` 对账；指令写清同意、断线、非断线失败与恢复。
- 外部终端 CLI 契约与现有 frozen oracle 零回归。

**Non-Goals:**

- 不做常驻 supervisor / systemd service / launchd / Windows 服务 / 开机自启 / 崩溃自恢复（P1）。
- 不承诺 macOS/Windows 会话内重启；不承诺标记被剥离的非 Linux、旧 systemd/PGID fallback 下剥离标记的 Linux 检测（记录残余风险）。
- 不修改端口归属安全逻辑；不改变外部终端 restart 的同步语义/输出。
- 不解决 B014（worktree 隔离 home 与生产目标解耦）；预览 home 内 restart 按同一逻辑复用且不触碰 3080。
- **不实现全局重启互斥锁**：P0 明确接受并发 restart 的 churn（两个并发 restart 可能各自 stop/start，最后启动者胜出）；identity epoch 只拒绝"排程后 Host 已被替换"的过期编排，不承诺 session+session 串行化（D6/RC4 方案 b）。
- 不改变会话内 `dsh stop` 语义；不保证重启不打断进行中的 turn，只保证失败不被误报成功。

## Decisions

### D1. 会话语境判定：证据优先级与插入点

判定发生在**纯参数校验与纯预览防护之后**、任何 probe/autoUpdate/prepare/stop 之前：入口在 `flags.restart && !flags.buildOnly && !official` 时调用 `session-context.mjs`；`parseArgs`（`args.mjs`）与预览 3080/非法端口拒绝（`main.mjs:36,53,55`）先完成，因此无效参数与 `launcher-preview` 的 3080 用例不会触发 capability probe 或 scope。

优先级固定：

1. **Linux/WSL**：读 `/proc/self/cgroup`。读取失败 → 不确定会话内 → fail-closed；命中 `/dsh-(?:subprocess|terminal)-\d+-[0-9a-f]+\.scope/` → 确定会话内（即使标记被剥离）；可读未命中：有保留标记（`DSH_SHELL=1` 或非空 `DSH_SESSION_ID`）→ 冲突 fail-closed；无标记 → 外部。
2. **darwin/win32**：有保留标记 → 会话内（P0 unsupported → fail-closed）；无标记时 SHALL 有界只读父进程链探测（darwin `ps -ww -o ppid,command`，Windows PowerShell CIM），证明 DSH Host（`@deepseek-ai/dsh` `web` 入口）祖先 → 会话内 fail-closed；不可用/无命中 → 外部。
3. 只有无任何会话证据才走外部同步路径。**cgroup 证据只在 provider native ownership 模式存在**；旧 systemd/PGID fallback 或标记被剥离的 Linux 上，cgroup 不命中且无标记会按外部处理（文档化残余风险，proposal non-goal）。伪阳性方向安全。

### D2. 三段握手 + marker/nonce 协议 + 结果投递宽限

launcher（会话内、支持平台）步骤：

1. 生成 `restartId`（`<UTC compact>-<pid>-<rand6>`）与 `nonce`（32 hex）；创建状态目录 `$DSH_HOME/state/dsh-restart/<restartId>/`：逐级 create `$DSH_HOME/state`、`.../dsh-restart` 为 0700（已存在不 chmod），拒绝路径组件中的符号链接；以独占创建 `meta.json`（0600），内容 `{version:1, restartId, nonce, source:"session", port, cwd, expected: {kind:"owned"|"empty", pid?, created?, argv?, executable?, preview?: {pid, created}}, createdAt}`。
2. 预检 receipt 可写与 capability probe（D3）→ 失败写 `failed(schedule)` 尽力而为并 fail-closed。
3. `spawn(systemd-run, ["--user","--scope","--quiet","--collect","--unit=dsh-restart-<id>","--", node, repo/bin/dsh.mjs, ...原始argv], {stdio:'ignore'})` 后 `unref()`。内部协议经环境变量：`DSH_RESTART_ORCHESTRATED=1`、`DSH_RESTART_ID`、`DSH_RESTART_NONCE`、`DSH_RESTART_STATE_DIR`、`DSH_RESTART_RECEIPT`、`DSH_RESTART_CWD`、`DSH_RESTART_GRACE_MS`；expected 只从 `meta.json` 读取（env 不携带身份记录）。
4. 有界等待 `ready`（固定上限 5s）。收到后按固定顺序：追加 `scheduled` receipt（失败 → 写 abort 尽力而为 + `failed(schedule)` + 非零，**不写 go、不打印已排程**）→ 以独占创建 `go`（内容 `{restartId, nonce, phase:"go"}`；写失败走同 abort 路径）→ 打印"已排程/将断开/验证方式" → 返回 0。
5. 未收到 ready：写 abort（尽力而为）+ `failed(schedule, no-ack)`，非零退出。abort 标记内容必须固定为 `{restartId, nonce, phase:"abort", reason}` 并以 `wx` 创建；abort 缺失/截断/nonce 不匹配时由 go-timeout 兜底（Host 不停），不得把非法 abort 当作有效取消。
6. orchestrator 启动后先写 `orchestrator-ready` receipt 与 `ready` 标记（内容 `{restartId, nonce, phase:"ready", pid}`），校验 `meta.json` 与自身 id/nonce 后再执行准备阶段；准备阶段结束后等待 `go`（固定上限 30s）。等待期间轮询 abort；`go` 与 `abort` 同时存在时 **abort 优先**（安全方向）。看到 abort 或 go 超时 → 不停止 Host 退出、不写第二个终态事件；abort 标记写失败时以 go-timeout 兜底（最坏多等 30s，Host 不停）。
7. **结果投递宽限（RC1）**：orchestrator 观察到 `go` 后、调用 `doStop` 前必须等待 `GRACE`（默认 3s；测试注入 clock），让 launcher 的打印/工具结果先出队；`GRACE` 之后才允许 stop。三处"返回时 Host 未停止"的断言必须由该宽限 + launcher 在 go 之后先打印再返回的顺序共同保证；不依赖 prepare 耗时。
8. marker 内容校验：任何一侧读到缺失字段、非法 JSON、restartId/nonce 不匹配或文件被替换（`lstat` 非普通文件）→ fail-closed，不 stop；`wx` 文件被截断（launcher/orchestrator 中途死亡）按非法处理。abort 写失败允许，由 go-timeout + 现有 receipt 兜底。

**拒绝方案**：transient service（主进程退出按 `systemd.kill(5)` 的 `KillMode=control-group` 清理残留，替身 Host 会被杀；把 Host 再放独立 scope 增加 bootstrap/失败面）；`setsid`/`nohup`/`detached spawn`（换不掉 cgroup）；`--no-block`（只影响 service 启动等待）；显式 `--detach` 旗标（agent 不会发现）。备选"独立 bootstrap 脚本"被 re-exec 取代：复用全部 launcher 语义，无需第二套实现。

### D3. stdio / 进程句柄 / capability probe

- spawn 必须 `stdio:'ignore'`；ready 等待期的 `'exit'` 监听只用于早退判定，握手完成后 `unref()`；测试断言 `runLauncher` 返回后没有未 unref 的 child handle 支撑事件循环。
- orchestrator 在任何输出前把 `log`/`warn` 替换为文件 sink（`$DSH_HOME/dsh.log` append 0600 + receipt）；继承 stdio 是 `/dev/null`，无 EPIPE 面。
- **核心机制证据（RC8）**：真实 systemd 集成行必须显式 SIGTERM 再 SIGKILL `systemd-run` 客户端进程（模拟旧 Host managed range 的 dispose），然后断言 (a) launcher 在写入 go 后、GRACE 到期前返回（因此返回时 Host 尚未 stop），(b) orchestrator 与 scope 在客户端被杀后存活并完成 stop→fake start，(c) launcher 进程退出/stdio 关闭后无 EPIPE 且 orchestrator 完成，(d) 替代 Host 残留进程使 scope 在 orchestrator 退出后仍 active、Host 停止后 collected，(e) 环境不支持显式 skip + 原因记录、`t.after` 清理 scope，(f) `dsh-restart-*` scope 名不匹配 provider 正则（避免误分类），(g) 与 D2 实际实现共用常量/argv。
- capability probe：`systemctl --user show --property=Version` 成功 + 以真实参数集创建一次性 scope（`-- <node> -e 'process.exit(0)'`），bounds 见 D12；失败 fail-closed。probe 不在外部路径运行。

### D4. 内部 orchestrator 模式 = 同一 launcher 代码路径

- `runLauncher` 入口检测 `DSH_RESTART_ORCHESTRATED=1`：要求 `DSH_RESTART_ID`/`NONCE`/`STATE_DIR`/`RECEIPT`/`CWD` 齐全且 `meta.json` 校验通过；缺失/不匹配 → fail-closed 退出（不 stop）。通过后才跳过 D1 分类；安装文件 sink；写 `orchestrator-ready`+ready；执行与外部 restart 相同的 autoUpdate→prereq→（`-b`）build→prepare→doStop→start→readiness→UI/插件输出。
- 差异只允许三处：stop 前 go/abort/GRACE、stop 后旧进程退出证明、内部输出重定向；spec 与此对齐（三处，不是两处）。
- **内部协议不是安全边界**：同用户代码总能伪造环境/文件；测试只要求"普通 agent 环境（仅 `DSH_SHELL`/`DSH_SESSION_ID`，无完整内部变量）不会被误判为 orchestrator"以及"部分/伪造 `DSH_RESTART_*` fail-closed 且不 stop"。`DSH_RESTART_*` 必须从**所有**子进程环境剥离（不只 Host 的 `hostEnv`）：orchestrator 启动前、替代 Host spawn 前、`runScript` 调用前。
- 内部模式不公布在 README/help；不新增命令面。

### D5. 参数与旗标矩阵（rebase 后现状）

| 组合 | 行为 |
| --- | --- |
| `restart` | 外部同步；会话语境 D2 排程 |
| `restart -b/--build` | 现状：build 在 restart 前；会话模式中由 orchestrator 在 stop 前执行，失败不停止 Host |
| `build` / `build -b restart` | `buildOnly`，在 restart 前返回（现有 contract 保持） |
| `restart --foreground` | 会话语境 fail-closed；外部不变 |
| `restart --open/--no-open`、`--host/--trusted-host`、`--port` | 原样作为 re-exec argv 转发；preview home 沿用 `portExplicit`/预览端口 |
| `restart --check` | 解析层拒绝（仅 doctor），现状不变 |
| `restart --dry-run/--yes` | 仅 plugin-update 使用；restart 忽略，现状不变 |
| 未知参数/缺值 | 副作用前拒绝（现状） |

### D6. expected 身份、epoch 与并发处置

**expected 记录**：`meta.json` 的 `expected` 使用现有 `sameProcessIdentity` 字段（pid+created+argv+executable），来源：
- 生产 home：分类后（纯读）probe 的 owned listener；若 probe 返回 `empty` → `expected.kind="empty"`（允许从空端口重启，等同于 start）；`probe-error` → fail-closed（无法证明归属/身份，会话路径不排程）；多个 owned listener → fail-closed（无法用单条 identity 表达）。
- 预览 home：`expected` 来自 `preview.json` 的 `{pid, created}`（`preview.mjs:24,28`）；stop 证明使用 `matchesPreview` / `stopPreview` 语义；`readPreview` 失败/mismatch → fail-closed；epoch 比较使用 record 的 pid+created。

**stop 前 epoch 复验**：orchestrator 在 GRACE 后、发信号前重新 probe：
- `expected.kind=owned`：当前单元与 expected 完全一致（`sameProcessIdentity` 或 preview record 匹配）→ 继续；端口空 → 旧 Host 已消失，直接进入 start（不是 superseded）；端口 owned 但身份不同 → `failed(stop, superseded)` 不发信号；probe-error → `failed(stop, unverifiable)` 不发信号。
- `expected.kind=empty`：端口仍空 → 继续 start；端口变为 owned（外部并发启动）→ `failed(stop, superseded)` 不停止它。

**并发处置（RC4 方案 b：显式接受 churn）**：P0 不实现全局互斥；两个并发 restart 可能各自 stop/start，最后启动者胜出，两者的 receipt 都可能是 `ready`。安全边界只保证：(a) epoch 拒绝"排程后身份已被替换"的过期编排；(b) 每个 run 的 receipt 带 `restartId`/PID，history 以 run 起始时间选最新并把较早的终结 run 标注 `superseded`（较早 `ready` 的 newPid 已消失或已被替换时不得显示为当前）；(c) 文档/指令明示 churn 可能，同一时刻多 agent 请求重启应先问用户。session+session 与 session+external 均有 scenario。

**交接证明与失败收敛**：stop 成功后证明旧进程退出；预算默认 10s（D12：≥ Host `PROCESS_SHUTDOWN_TIMEOUT_MS` 5s + provider quiescence 余量，实测记录到 verify）。未证明 → `failed(handoff)`，不启动替代 Host，文档说明该失败在正常 stop 慢时可能发生及恢复方式（外部 `dsh`）。prepare/build 失败 → `failed(preparing)` 不 stop；stop 失败 → `failed(stop)` 如实报告；start 失败 → `failed(start)`+rc；P0 不自动重试。orchestrator stop 后死亡 → receipt 非终态，history 显示 incomplete/abandoned。

### D7. Receipt 与 `dsh history`

- 路径/权限：`$DSH_HOME/dsh-restart.log` append JSONL 0600；状态目录见 D2（逐级 0700、拒绝 symlink 组件、`wx` 独占、0600 文件）。`$DSH_HOME` 已存在时绝不 chmod/放宽（允许 0755）。外部路径 receipt **best-effort**：失败静默（诊断仅 `dsh.log`），不改 CLI 输出/退出码；会话路径排程前必须证明可写，否则 fail-closed。
- **SHALL 可满足性（RC5）**：每次已分类尝试 SHALL **attempt** append；持久化不可用的拒绝路径（会话 fail-closed、外部 best-effort 失败）是**明确豁免**：不得出现 receipt 不算违规，会话路径通过 stderr/非零退出报告。abort marker 同样 best-effort，由 go-timeout 兜底。scenario 的 THEN 按此改写（unwritable home 场景只断言零副作用/非零，不要求 receipt）。
- 事件字段：`{restartId, ts, phase, source, port, oldPid?, newPid?, orchestratorPid?, dshVersion?, home?, rc?, reason?, failedPhase?, expected?}`；phase 固定枚举 `scheduled|orchestrator-ready|preparing|prepared|stopping|stopped|process-exited|starting|ready|failed`；failed 必带 failedPhase ∈ {schedule,preparing,stop,handoff,start}；每 run 最多一个终态（ready/failed，取最早；迟到非终态事件允许）。
- `dsh history`：保持 startup 输出；有 receipt 时尾读（默认 200 行/64KiB，D12）：按 `restartId` 分组、run 起始=组内最早事件、**按起始时间选最新 run 并只详细展示它**；较早 run 的终结事件标注 `superseded`（若其 newPid 已消失/被替换则同时标 `stale-pid`）；最新 run 非终态：orchestratorPid 存活或（年龄 ≤120s 且端口 owned）→ `in progress`；否则端口 owned → `orchestrator ended before stop; Host untouched`；否则 → `incomplete/abandoned` + 外部 `dsh` 恢复；probe 失败 → `unknown/incomplete (probe unavailable)`；端口用 run 事件里的 port；startup log 有更晚成功 → "后续 Host 启动"；**到达顺序只以文件行序为准**（JSONL 时间戳不排序），末行截断忽略，receipt 不可读 → 退化为 startup 输出并注明。无 receipt → 逐字节不变。
- 清理：orchestrator 结束时尽力删自己的目录；launcher 每次排程前有界清理 `dsh-restart-*` 中 7 天前、`orchestratorPid` 不存活且 `lstat` 为普通目录的项；上位目录逐级 create 0700、不跟随 symlink、用 `lstat` 与 uid 校验。

### D8. 替代 Host 环境

- 剥离：`DSH_SHELL`、`DSH_SESSION_ID`、`DSH_WEB_URL`、`DSH_PTY_SESSION_ID`、`DSH_RESTART_*`（从所有子进程环境，不只 Host）。
- 保留：`.env.local`、非 DSH、以及文档化启动/插件配置 `DSH_*`：至少 `DSH_TELEMETRY_DISABLED`（`$COMPAT/dsh/lib/profile-boot-BZ2ZjNWi.js:269`）、`DSH_AGENTS_HOME`、`DSH_BUNDLED_SKILL_DIR`（`$COMPAT/dsh-skill-filesystem/lib/index.js:78,84`）；完整清单按锁定 fingerprint 的文档扫描更新。双向测试。
- 外部路径不应用该过滤。

### D9. 指令真相源（含预览恢复）

- `instructions/dsh-home.md` 在预览验收段后新增"重启与断线"节，并改写现有 `:17` 的"最后由用户决定并执行日常 Host 重启"为与新规则一致的表述（预览验收的"由用户决定"保留，但日常重启规则改为"仅用户明确要求时可执行，会断线，按 receipt 验证"）。内容必须含字面 token：`仅当用户明确要求`、`本次会话将断开`、`不得宣称重启成功`、`返回 0 只表示已排程`、`dsh history`、`未断开`、`failed(preparing|stop)`、`外部终端执行 dsh`、`dsh stop`、`按 receipt 验证`；并说明预览环境重连后如何恢复地址（读 `$DSH_HOME/preview.json` 或重跑 `dsh`，以 `DSH_PREVIEW` 输出为准）。
- add/remove skill 第 4 步（当前 `add:31`、`remove:18`）与 README `[ASK-RESTART]`/`dsh restart` 行同步改写；删除旧指引并调和 README 的"Ask me before restarting"（用户→agent 侧）与新 agent 规则（只在用户明确要求时执行）。
- 机械断言（D10）：两个 skill + README 中完整旧句 `**由用户执行**——重启会中断当前会话,agent 在会话内执行等于自断` 与 `请用户自己执行` 均不存在；新 anchor token 存在；`instructions/dsh-home.md:17` 不含旧的"最后由用户决定并执行日常 Host 重启"原文或含替代 anchor。
- 物化验证：隔离 `DSH_HOME` 下 `node scripts/sync.mjs`（现有 sync-agent-instructions 测试形态），断言生成 `AGENTS.md` 含 tokens 且不含旧指引。

### D10. 测试分层、hermeticity 与真实 systemd 行

- **分类插入点（RC6）**：只在 `flags.restart && !flags.buildOnly && !official`、且纯参数/预览 3080 校验之后、`:103-110` 任何副作用之前运行；expected probe 在分类之后。`tests/launcher-preview.test.mjs` 的 3080 拒绝路径因此不触发分类/probe。
- **seam 可达性**：`runLauncher` 增加 `sessionContext`/`schedule`/`receipt`/`spawn`/`clock` seam；`tests/helpers/launcher-fixture.mjs` 生成的 `node-harness.mjs` 必须把 `sessionContext` 传入 `runLauncher`（或转发 `NODE_TEST_CONTEXT`+gate env），其 env 合成逻辑需最小扩展；`tests/launcher-{contract,lifecycle,preview}.test.mjs` 显式传 `external`。测试门控 `NODE_TEST_CONTEXT` + `DSH_RESTART_TEST_MODE=1` + `DSH_RESTART_CONTEXT_OVERRIDE=external|session|fail`，缺 gate 忽略；guard 测试：普通 agent 环境（仅 `DSH_SHELL`/`DSH_SESSION_ID`）不能被 override 强制 external；另一 guard：从 DSH 会话内跑 `npm test` 的 launcher 套件创建 **零** transient scope、零 capability probe（以环境可用检测 + 调用记录断言）。
- **单测/fixture（in-process）**：D1 顺序矩阵、D2 协议（nonce/meta/ready/go/abort/截断/双标记优先级）、GRACE 注入、abort 单终态、go 写失败、D5 矩阵、D6 expected 四类状态 + preview + epoch + 并发 churn、D7 receipt/history/清理、D8 双向环境、D9 文档断言、常量边界。
- **真实 systemd 集成行**：按 D3 (a)-(g) 执行，显式 kill 客户端；不可用显式 skip + 原因，`t.after` 清理；skip 不得当 pass，verify 记录。
- **端到端（人工、需授权）**：WSL 会话内 restart（生产 home 与预览 home 各一次或至少生产一次 + preview 由 `dsh-preview` 覆盖）、外部 restart 非回归；记录断线/未断线与 receipt/history 输出。
- **不修改** `tests/fixtures/launcher-bash-baseline/` 的现有断言语义；对 `tests/helpers/launcher-fixture.mjs` 做**最小扩展**（新增 seam），需与 `cross-platform-launcher` owner 协调，并在本 change verify 记录其 archive-order 依赖、冻结 baseline commit 与协调结果。

### D11. 归档顺序、跨 change 协调与回退

- 本 change MUST NOT 在 `cross-platform-launcher` 的 MODIFIED start/stop 需求合入/归档前归档；实施/verify 必须记录其状态、baseline commit 与共享文件（`main.mjs`、`launcher-fixture.mjs`）协调结果。
- **回退方案**：若 cpl 长期不归档，经用户明确批准后二选一：(a) 本 change 保持 unarchived 直到依赖就绪；(b) 显式 re-scope，把所需 MODIFIED delta 复制进本 change（需重新 review 该 scope 变更）。不得在未获批准时以"更严格者优先"绕过顺序冲突。
- 不改 `dsh.yaml`、不新增第三方依赖、不改变运行体解析策略。

### D12. 常量：契约上限 vs 可校准默认值（RC7）

| 常量 | 性质 | 值/规则 |
| --- | --- | --- |
| `READY_TIMEOUT` | 契约上限（SHALL NOT 超过） | 5s |
| `GO_TIMEOUT` | 契约上限 | 30s |
| `PROBE_TIMEOUT` | 契约上限 | 5s |
| `GRACE` | 可校准默认值（SHALL ≥0；实测写入 verify） | 3s |
| `HANDOFF_EXIT_TIMEOUT` | 默认值（SHALL ≥ Host `PROCESS_SHUTDOWN_TIMEOUT_MS` 5s + 余量；实测写入 verify） | 10s |
| `LIVENESS_WINDOW` | 默认值 | 120s |
| `STALE_STATE_DIR` | 默认值 | 7d |
| `HISTORY_TAIL` | 默认值 | 200 行 / 64KiB |

spec 只把前三个写成固定上限，其余写成"默认值，实施时校准并记录到 verify；调整默认值不改契约语义"。这消除"固定 SHALL 常量 vs 可校准"的矛盾。

## Risks / Trade-offs

- [provider 前缀/`--expand-environment` 默认值/`systemd.kill` 语义随 DSH 升级变化] → fingerprint 级升级清单（D1/D3/D11），两代 build 抽查；升级复核记录。
- [标记被剥离的非 Linux、旧 systemd/PGID fallback Linux 无法检测] → 记录残余风险 + 升级清单 + 指令禁止包装；P1 supervisor 消除。
- [re-exec 内部协议可被同用户伪造] → 不是安全边界；required 变量齐全+meta 校验否则不 stop；普通 agent env guard test；所有子进程剥离 `DSH_RESTART_*`。
- [并发 restart churn] → 明示接受；identity epoch 拒绝过期编排；receipt/history superseded/stale-pid 标注；指令要求并发请求先问用户。
- [Host 正常 shutdown 慢于 HANDOFF 默认 10s] → 默认 ≥5s+余量并真机校准；失败为安全终态 + 恢复指引；不在正常路径静默重试。
- [Stop 后启动失败仍 down] → 终态可查 + 外部 `dsh` 恢复；措辞不宣称不会 down。
- [状态目录/receipt 本地信任边界] → 逐级 0700、拒绝 symlink、`wx`、uid/lstat 校验、预存在 fail-closed。
- [真实 systemd 测试环境不可用] → 显式 skip+原因、verify 不计 pass；人工 WSL E2E 最终门禁。
- [与 cpl 共享文件/冻结 oracle] → 最小扩展 helper + 协调记录 + 归档顺序 + 回退方案（D11）。
- [launcher 在 ready/scheduled/go 之间被杀] → 不写 go 则 go-timeout 兜底（Host 不停）；abort 写失败仍安全；单终态规则保证 history 可判。
- [迟到/孤儿事件污染 history] → run 起始选择 + 文件行序 + superseded/stale-pid + 有界尾读。

## Migration Plan

1. 代码合入无数据迁移；launcher 直接跑仓库源码。首次部署前运行中的旧 Host 仍是旧 launcher，需一次用户决定的外部 `dsh restart` 后新能力生效。
2. 指令变更在 main checkout 执行 `dsh build`（两次，第二次 no changes）物化 `$DSH_HOME/AGENTS.md`。
3. 回滚：revert；外部路径未变；receipt/state 无害；指令随 build 恢复。
4. 归档顺序与回退见 D11。

## Open Questions

- GRACE/HANDOFF/LIVENESS 等默认值需 WSL 实测校准并写入 verify（D12；不变更契约上限）。
- `dsh history` 是否加 `--restart` 过滤：P0 以默认并列展示 + 只详展最新 run 解决，不新增命令面。
- macOS launchd / Windows Job breakaway / P1 supervisor：后续 change。
- 会话内 `dsh stop` 是否脱离：只在指令说明，P0 不改。
