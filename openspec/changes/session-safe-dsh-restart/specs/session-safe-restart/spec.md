## ADDED Requirements

本 capability 只规定**会话内发起**的 `dsh restart` 的附加保证。外部终端/同步 restart 的契约仍由 `startup-autoupdate` 的 stop/restart 需求（经进行中的 `cross-platform-launcher` delta 修订）规定；两者冲突时以更严格者为准。**归档顺序为硬约束：本 change MUST NOT 在 `cross-platform-launcher` 的 MODIFIED start/stop 需求合入并归档之前归档**；若依赖长期不满足，只能保持 unarchived 或经用户批准 re-scope（把所需 delta 纳入本 change 并重新评审），不得以"更严格者优先"绕过。

### Requirement: 会话语境判定必须先于任何副作用，优先级确定且覆盖全部 Host 管理的执行范围

`dsh restart` 必须(SHALL)在**纯参数校验与纯预览防护之后、任何 probe/autoUpdate/prepare/stop 副作用之前**，把本次调用归类为「会话内」或「外部终端」。判定必须(SHALL)只使用本地可读证据，必须(SHALL NOT)访问网络或改变系统状态。

判定优先级必须(SHALL)固定为：

1. **Linux/WSL**：读取 `/proc/self/cgroup`。读取失败 → 不确定会话内 → 必须(SHALL) fail-closed；命中 provider 管理范围 `/dsh-(?:subprocess|terminal)-\d+-[0-9a-f]+\.scope/` → 确定会话内（即使保留标记被剥离）；可读但未命中：存在保留标记（`DSH_SHELL=1` 或非空 `DSH_SESSION_ID`）→ 证据冲突 → 必须(SHALL) fail-closed；无任何标记 → 外部终端。
2. **darwin/win32**：存在保留标记 → 确定会话内（P0 unsupported → fail-closed）；无标记时必须(SHALL)尝试有界只读父进程链探测，若证明 DSH Host（`@deepseek-ai/dsh` `web` 入口）祖先 → 会话内 → fail-closed；探测不可用/无命中 → 外部终端。
3. 只有**无任何会话证据**时才允许(SHALL)走外部同步路径。伪阳性方向必须(SHALL)安全（拒绝或改走排程）。

`dsh-subprocess-*` 与 `dsh-terminal-*` 同属 Host dispose 终止的 managed range，两者都必须(SHALL)识别。**cgroup 证据只在 provider native ownership 模式存在**：旧 systemd/PGID fallback 的 Linux 上，若保留标记也被剥离，则无法检测——这属于必须(SHALL)记录在文档与 DSH 升级复核清单中的残余风险，不得(SHALL NOT)声称已覆盖。前缀集合与 `--expand-environment` 未来默认值变化、`systemd.kill` 语义均须在升级复核时重扫。

#### Scenario: Linux 普通子进程 range 判为会话内

- **GIVEN** cgroup 为 `dsh-subprocess-<hostpid>-<hex>.scope` 且环境中 `DSH_SHELL=1`
- **WHEN** 执行 `dsh restart`
- **THEN** 归类为会话内；launcher 在返回前未发送停止信号、未执行 prepare；旧 Host 在命令返回时仍为 `owned`

#### Scenario: 终端 range 且会话标记被剥离仍判为会话内

- **GIVEN** cgroup 为 `dsh-terminal-<hostpid>-<hex>.scope`，`DSH_SHELL`/`DSH_SESSION_ID` 被剥离
- **WHEN** 执行 `dsh restart`
- **THEN** 仍归类为会话内并走排程；绝不进入外部同步路径；receipt 记录 `source=session`

#### Scenario: 标记与可读 cgroup 冲突时 fail-closed

- **GIVEN** Linux cgroup 可读但不在 provider 管理范围，且存在保留会话标记
- **WHEN** 执行 `dsh restart`
- **THEN** 归类为不确定会话内并 fail-closed：非零退出、无 prepare/stop/UI 清理、旧 Host 保持 `owned`，stderr 给外部终端指引

#### Scenario: cgroup 不可读或外部路径参数非法

- **GIVEN** Linux `/proc/self/cgroup` 不可读；或用户只传非法参数/触发纯预览 3080 拒绝
- **WHEN** 执行 `dsh restart`
- **THEN** 前者 fail-closed 零副作用；后者按纯参数/预览校验拒绝，二者都不触发 capability probe 或 transient scope

#### Scenario: 非 Linux 有标记或可证祖先时 fail-closed

- **GIVEN** 平台为 darwin/win32：存在保留标记，或无标记但只读父进程链可证明 DSH Host 祖先
- **WHEN** 执行 `dsh restart`
- **THEN** 归类为会话内并因 P0 unsupported fail-closed；旧 Host 未收到信号并保持 `owned`

#### Scenario: 外部终端不被误判

- **GIVEN** Linux cgroup 可读且不命中、无保留标记（或非 Linux 无标记且无 Host 祖先）
- **WHEN** 执行 `dsh restart`
- **THEN** 归类为外部终端，走同步路径

### Requirement: 会话内 restart 必须完成三段握手 + marker/nonce 协议 + 结果投递宽限，且排程子进程/stdio 生命周期确定

会话内路径必须(SHALL)在停止 Host 前把 restart 交给**同一启动器的内部 orchestrator 模式**（re-exec）；该进程必须(SHALL)位于不属于 Host managed range 的独立 transient scope。排程命令必须(SHALL)以 argv 数组构造，可变数据必须(SHALL NOT)拼进 shell 文本。

**三段握手与结果投递宽限**：

- launcher 生成 `restartId` 与 `nonce`，在 `$DSH_HOME/state/dsh-restart/<restartId>/` 以独占创建（`wx`，0600）`meta.json`，内容含 `version`、`restartId`、`nonce`、`source`、`port`、`cwd`、`createdAt` 与 `expected` 记录（身份字段见下一需求）。
- orchestrator 校验内部变量、`meta.json`（id/nonce 匹配、`lstat` 为普通文件）与 receipt 可写后，以独占创建 `ready`（`{restartId, nonce, phase:"ready", pid}`）并写 `orchestrator-ready` receipt。
- launcher 有界等待 ready（固定上限 5s）；收到后固定顺序：追加 `scheduled` receipt → 以独占创建 `go`（`{restartId, nonce, phase:"go"}`）→ 打印 → 返回 0。`scheduled` 或 `go` 写入失败时必须(SHALL)写 abort（尽力而为）+ `failed`（`failedPhase=schedule`）+ 非零退出，且不得(SHALL NOT)打印"已排程"、不得写 go、不得停止 Host。
- orchestrator 见到 `go` 后必须(SHALL)先等待**结果投递宽限** `GRACE`（默认 3s，测试可注入 clock；默认值校准写入 verify，不改契约上限），之后才允许调用 stop；因此"launcher 返回时 Host 尚未被停止"由 `go→GRACE` 与 launcher 在 go 之后先打印再返回的顺序共同保证，不得(SHALL NOT)依赖 prepare 耗时。
- orchestrator 必须在有界时间内（固定上限 30s）等到 go；看到 abort 或 go 超时必须在**不停止 Host** 的情况下退出，且不得(SHALL NOT)写第二个终态事件（每 run 最多一个终态）。`go` 与 `abort` 同时存在时 abort 优先（安全方向）；abort 写失败时以 go-timeout 兜底。abort marker 内容必须固定为 `{restartId, nonce, phase:"abort", reason}` 并以 `wx` 创建；缺失字段、截断或 id/nonce 不匹配的 abort 不得被当作有效取消（由 go-timeout 兜底，Host 不停）。
- marker 内容缺失、非法 JSON、id/nonce 不匹配、非普通文件或被截断时，双方都必须(SHALL) fail-closed（不视作 ready/go/abort 成功），且不得(SHALL NOT)停止 Host。

P0 会话内支持范围必须(SHALL)精确为：Linux/WSL 且 capability probe 通过——`systemctl --user show --property=Version` 成功且 `systemd-run --user --scope` 接受与真实排程完全相同的参数集；probe 必须(SHALL)有界（固定上限 5s）且不安装任何东西。非 Linux、user systemd 不可用、probe 失败、`--foreground` 与会话语境组合，均必须(SHALL) fail-closed。

状态目录：`$DSH_HOME/state/dsh-restart/<restartId>/` 逐级以 0700 创建（已存在的 `$DSH_HOME` 不得被 chmod/放宽，允许 0755 等现状）；拒绝路径组件中的符号链接；orchestrator 结束时尽力清理自己的目录；launcher 每次排程前有界清理 7 天前（默认值，校准写入 verify）、`orchestratorPid` 不存活且 `lstat` 为普通目录的旧目录。

排程 spawn 必须(SHALL) `stdio:'ignore'` 并在完成握手后 `unref()`，不得让 child handle 阻止 launcher 返回；orchestrator 必须在任何输出前把 log/warn 重定向到 `$DSH_HOME/dsh.log` 与 receipt，不写继承管道（其继承 stdio 为 `/dev/null`，无 EPIPE 面）。

外部终端调用必须(SHALL)继续同步 restart；矩阵：`-b/--build` 先 build 再 restart（会话模式中由 orchestrator 在 stop 前执行）、`build`/`build -b restart` 保持 `buildOnly` 现状、`--open/--no-open`/`--host/--trusted-host`/`--port` 原样转发（预览 home 沿用 `portExplicit`/预览端口）、`--check` 解析层拒绝、`--dry-run/--yes` 对 restart 忽略（现状）、未知参数副作用前拒绝；只有 `--foreground` 在会话语境被拒绝。

#### Scenario: 支持平台返回前不停止 Host（含 GRACE）

- **GIVEN** Linux/WSL 会话内、probe 通过、旧 Host `owned`、注入可观测的 GRACE
- **WHEN** 执行 `dsh restart`
- **THEN** receipt 先出现 `orchestrator-ready`，launcher 按 `scheduled`→`go`→打印→返回 0 完成；在 GRACE 到期前 stop 未被调用，命令返回时旧 Host 仍 `owned`，随后 orchestrator 才停止它

#### Scenario: scheduled/go 写失败不停止 Host

- **GIVEN** launcher 已收到 ready，但追加 `scheduled` 或写 `go` 失败（磁盘满/权限变化）
- **WHEN** 执行 `dsh restart`
- **THEN** 写 abort（尽力而为）+ `failed`（`failedPhase=schedule`）、非零退出且不打印"已排程"；orchestrator 见 abort 或 go-timeout 后不停止 Host，旧 Host 保持 `owned`

#### Scenario: 排程未 ack 时不宣称成功

- **GIVEN** 支持平台会话内，systemd-run 早退/非零或 orchestrator 未写 ready
- **WHEN** 执行 `dsh restart`
- **THEN** launcher 有界等待后写 abort 与 `failed`（`failedPhase=schedule`）、非零退出且不写 go；旧 Host 保持 `owned`

#### Scenario: marker 截断或 nonce 不匹配时 fail-closed

- **GIVEN** ready/go/abort 文件被截断、被替换为非普通文件，或 `restartId`/`nonce` 与 `meta.json` 不匹配
- **WHEN** launcher 或 orchestrator 读取该 marker
- **THEN** 视为失败并向安全方向收敛：不把 marker 当成功、不停止 Host、记录可诊断原因

#### Scenario: 不支持环境 fail-closed 且零副作用

- **GIVEN** 会话语境，平台为 darwin/win32 或 Linux 但 capability probe 失败
- **WHEN** 执行 `dsh restart`
- **THEN** 非零退出，未调用 prepare/stop/UI 清理、未写进行中 receipt；stderr 含支持边界与外部终端执行指引

#### Scenario: 恶意/特殊字符路径不破坏排程命令

- **GIVEN** repo 路径、`DSH_HOME` 或透传值包含空格、引号、`$()`、`;` 等元字符
- **WHEN** 会话内执行 `dsh restart`
- **THEN** 传给 systemd-run/orchestrator 的 argv 与输入逐项一致，不产生 shell 展开或额外命令

#### Scenario: 会话内 --foreground 被拒绝

- **GIVEN** 会话语境
- **WHEN** 执行 `dsh restart --foreground`
- **THEN** 在排程前 fail-closed，非零退出并说明会话内无法前台等待

#### Scenario: 状态目录预存在或异常时 fail-closed

- **GIVEN** 状态目录或其 `meta.json` 已存在、含符号链接、权限异常、内容截断或 restartId/nonce 不匹配
- **WHEN** 会话内执行 `dsh restart`
- **THEN** 在排程前 fail-closed，不停止 Host，stderr 指出状态目录问题

### Requirement: 会话路径必须复用同一 launcher 编排，并定义 expected 身份、epoch 复验、并发 churn 与旧进程退出证明

内部 orchestrator 必须(SHALL)执行与外部 restart 相同的 launcher 代码路径（autoUpdate → ensurePrerequisites → `-b` 时 build → prepare → stop → start → 就绪 → UI/插件输出）；差异只允许三处：stop 前的 go/abort/GRACE、stop 后的旧进程退出证明、内部输出重定向。预览/隔离 home、端口回退、passthrough、UI 与 cwd 必须(SHALL)在两种语境下一致。

`meta.json` 的 `expected` 记录必须(SHALL)使用与现有 `sameProcessIdentity` 可比较的字段（pid+created+argv+executable），并按状态定义：

- 生产 home：分类后 probe 得到 owned listener → 记录该身份；probe 返回 `empty` → `expected.kind=empty`（允许从空端口重启）；`probe-error` → 会话路径 fail-closed（不排程）；多个 owned listener → fail-closed（单条身份无法表达）。
- 预览 home：`expected` 必须来自 `preview.json` 的 `{pid, created}`（`preview.mjs`），stop 证明必须使用 `matchesPreview`/`stopPreview` 语义；`readPreview` 失败或记录不匹配 → fail-closed。

stop 前 epoch 复验必须(SHALL)在 GRACE 之后、发信号之前执行：`expected.kind=owned` 时当前 listener 必须与 expected 完全一致才继续；端口空 → 旧 Host 已消失，直接进入 start；身份不同 → `failed(stop, superseded)` 不发信号；probe-error → `failed(stop, unverifiable)` 不发信号。`expected.kind=empty` 时端口仍空 → 继续 start；端口变为 owned（外部并发启动）→ `failed(stop, superseded)` 不停止它。

**并发 churn 明确接受（non-goal）**：P0 不保证全局互斥；两个并发 restart（session+session 或 session+external）可能各自 stop/start，最后启动者胜出，两者都可能写 `ready`。安全保证必须(SHALL)限定为：epoch 拒绝"排程后 Host 已被替换"的过期编排；每个 run 的 receipt 带 `restartId`/PID 用于对账；`dsh history` 以 run 起始时间选最新并把较早的终结 run 标注 `superseded`（其 newPid 已消失/被替换时同时标 `stale-pid`），不得把较早 ready 当当前状态；指令告知并发请求可能 churn、应先询问用户。session+session 与 session+external 都必须(SHALL)有场景与测试。

stop 成功后、启动替代 Host 前必须(SHALL)用 expected 身份证明旧进程已退出（不只是端口空），等待必须有界（默认 10s，契约要求 ≥ Host `PROCESS_SHUTDOWN_TIMEOUT_MS` 5s + provider quiescence 余量，校准值写入 verify）；未证明 → `failed(handoff)` 且不启动替代 Host。prepare/build 失败 → `failed(preparing)` 不 stop；stop 失败 → `failed(stop)` 如实报告；start 失败 → `failed(start)`+rc；P0 不自动重试。

替代 Host 的环境必须(SHALL)沿用现有 `hostEnv` 过滤，并只剥离会话身份与内部协议变量（`DSH_SHELL`、`DSH_SESSION_ID`、`DSH_WEB_URL`、`DSH_PTY_SESSION_ID`、`DSH_RESTART_*`；后者必须从所有子进程剥离）；Host 文档化的启动/插件配置类 `DSH_*`（至少 `DSH_TELEMETRY_DISABLED`、`DSH_AGENTS_HOME`、`DSH_BUNDLED_SKILL_DIR`，完整清单按锁定 fingerprint 扫描）必须(SHALL)保留，`.env.local`/非 DSH 环境不变；外部路径不得应用该过滤。

#### Scenario: 成功编排的阶段序列

- **GIVEN** 支持平台会话内，准备成功且旧 Host 在预算内退出
- **WHEN** orchestrator 执行编排
- **THEN** receipt 出现 `preparing`、`prepared`、`stopping`、`stopped`、`process-exited`、`starting`、`ready`；新 Host 监听目标端口，`dsh-startup.log` 新增成功记录

#### Scenario: 准备阶段失败不停止旧 Host

- **GIVEN** 会话内握手成功，但 autoUpdate/build/prerequisite/prepare 之一失败
- **WHEN** orchestrator 执行准备阶段
- **THEN** 旧 Host PID 与端口不变，receipt 写 `failed`（`failedPhase=preparing`），不出现 `stopping`

#### Scenario: expected 身份被替换或消失

- **GIVEN** 排程时 expected=Host X；GRACE 后复验发现端口由身份不同的 Host Y 占用，或端口已空
- **WHEN** orchestrator 到达 stop
- **THEN** 端口为 Y 时写 `failed`（`failedPhase=stop`, reason=superseded）且不发送信号、Y 继续运行；端口空时不标记 superseded，直接进入 start

#### Scenario: probe 不可归属或多监听者时不排程

- **GIVEN** 分类后 probe 返回 `probe-error`，或端口有多个 owned listener
- **WHEN** 会话内执行 `dsh restart`
- **THEN** fail-closed，不创建 scope、不停止 Host，stderr 指出无法证明单一声明身份

#### Scenario: 排程时端口为空也能安全启动

- **GIVEN** 排程时 probe 返回 `empty`（`expected.kind=empty`，例如对空闲端口执行 restart）
- **WHEN** orchestrator 在 GRACE 后复验并执行编排
- **THEN** 端口仍空时跳过 stop 直接启动替代 Host；若此时端口已变为 owned（外部并发启动）→ `failed(stop, superseded)` 且不停止该 Host

#### Scenario: 预览 home 使用 preview record 身份

- **GIVEN** 会话运行在隔离/预览 home，存在有效 `preview.json`
- **WHEN** 会话内执行 `dsh restart`
- **THEN** expected 与 stop 证明使用 preview record 的 pid+created；端口与 3080 防护沿用预览规则；preview record 不可读/不匹配时 fail-closed 不停止 Host

#### Scenario: 并发 restart churn 被显式接受并可对账

- **GIVEN** 两个并发 run（session+session 或 session+external）先后完成 stop/start，均写 `ready`
- **WHEN** 重连后执行 `dsh history`
- **THEN** 输出以 run 起始时间标注最新 run；较早 run 的终结事件标 `superseded`，其 newPid 已消失时标 `stale-pid`，不得显示为当前状态

#### Scenario: 旧进程未退出不启动替代 Host

- **GIVEN** stop 后端口已空，但 expected 进程身份在 handoff 预算内仍可证明存在
- **WHEN** 到达启动步骤
- **THEN** 不启动替代 Host，receipt 写 `failed`（`failedPhase=handoff`）并以失败终态结束

#### Scenario: 替代 Host 早退或未就绪

- **GIVEN** 旧进程已退出且启动命令已拉起替代 Host
- **WHEN** 替代 Host 早退或就绪预算内未被证明 owned
- **THEN** receipt 写 `failed`（`failedPhase=start`, `rc`=退出码），不出现 `ready`

#### Scenario: 两条路径的 build/preview/env 语义一致

- **GIVEN** 分别以外部与会话语境执行 `dsh restart`、`dsh restart -b`、预览 home 下 `dsh restart`
- **WHEN** 对比调用序列、端口选择与替代 Host 环境
- **THEN** 两条路径都执行 autoUpdate→prerequisites→（`-b`）build→prepare→stop/start；预览端口规则不变且不触碰 3080；替代 Host 仅剥离会话身份/内部变量、保留文档化 `DSH_*`；外部路径环境过滤不变

#### Scenario: orchestrator 在 stop 后死亡

- **GIVEN** receipt 已有 `stopped`、无 `starting`/`ready`，目标端口无 owned Host
- **WHEN** 重连后执行 `dsh history`
- **THEN** 输出把该 run 标为 incomplete/abandoned（最后阶段 + restartId），并给出外部终端执行 `dsh` 的恢复指引

### Requirement: restart 结果必须持久且可对有界查询；receipt 的 SHALL 必须可满足

每一次**已分类的** restart 尝试必须(SHALL) **attempt** 向 `$DSH_HOME/dsh-restart.log` 追加 JSONL 事件（参数解析错误/官方命令转发不属于 restart 尝试）。**持久化不可用的路径明确豁免**：会话路径在排程前证明 receipt 可写，失败则 fail-closed 并通过 stderr/非零退出报告，此时**没有 receipt 不构成违规**；外部路径 receipt 必须(SHALL) best-effort（失败静默、诊断仅写 `$DSH_HOME/dsh.log`，不得改变 CLI 输出/退出码）；abort marker 同样 best-effort，由 go-timeout 兜底，不要求落盘成功。

`$DSH_HOME` 已存在时不得(SHALL NOT)修改其权限（允许 0755 等现状）；缺失时以 0700 创建；receipt 文件以 0600 创建。事件字段：`{restartId, ts, phase, source, port, oldPid?, newPid?, orchestratorPid?, dshVersion?, home?, rc?, reason?, failedPhase?, expected?}`；`phase` 固定枚举 `scheduled|orchestrator-ready|preparing|prepared|stopping|stopped|process-exited|starting|ready|failed`；`failed` 必带 `failedPhase` ∈ {`schedule`,`preparing`,`stop`,`handoff`,`start`} 与 `reason`/`rc`；每 run 最多一个终态（取最早，迟到非终态事件允许）。单行 O_APPEND；损坏行忽略。

`dsh history` 必须(SHALL)保持现有启动记录输出，并在存在 receipt 时按有界尾读（默认 200 行/64KiB，默认值可校准）追加展示：按 `restartId` 分组、run 起始=组内最早事件、按起始时间选最新 run 并只详细展示它；较早 run 的终结事件标注 `superseded`（其 newPid 已消失/被替换时加 `stale-pid`）；最新 run 非终态时：`orchestratorPid` 存活或（年龄 ≤120s（默认，校准值写入 verify）且端口 owned）→ `in progress`；否则端口 owned → `orchestrator ended before stop; Host untouched`；否则 → `incomplete/abandoned` + 外部 `dsh` 恢复；probe 失败 → `unknown/incomplete (probe unavailable)`；端口用 run 事件中的 port；startup log 有更晚成功 → "后续 Host 启动"；**到达顺序只以文件行序为准**（JSONL 时间戳不排序），末行截断忽略，receipt 不可读时退化为 startup 输出并注明。无 receipt 时输出必须(SHALL)逐字节不变。

#### Scenario: 成功重启可在重连后验证

- **GIVEN** 一次会话内 restart 以 `ready` 结束且新 Host owned
- **WHEN** 重连后执行 `dsh history`
- **THEN** 输出包含该 `restartId` 的 `ready`、新 PID、端口，并与 `dsh-startup.log` 最近成功记录一致

#### Scenario: 启动失败可在重连后定位

- **GIVEN** 一次 restart 在 start 阶段失败
- **WHEN** 执行 `dsh history`
- **THEN** 输出包含 `failed`、`failedPhase=start`、退出码/原因，且不出现 `ready`

#### Scenario: 拒绝或持久化不可用路径不要求 receipt

- **GIVEN** 会话语境因平台不支持 fail-closed；或 `$DSH_HOME` 不可写导致排程前 fail-closed
- **WHEN** 执行 `dsh restart` 与随后的 `dsh history`
- **THEN** 命令非零退出、零副作用、stderr 可操作；无 receipt 不算违规；若有 `failed(schedule)` 记录则显示 `source=session`；`dsh-startup.log` 原有记录不被改写

#### Scenario: 迟到事件、陈旧 run 与文件行序

- **GIVEN** run A 的 orchestrator 迟到写入失败事件而 run B 已成功；或存在更晚的外部 Host 启动记录；或 receipt 末行被截断
- **WHEN** 执行 `dsh history`
- **THEN** 按 run 起始时间选择最新 run B 并只详展它；A 的事件标 `superseded`；更晚的 Host 启动标"后续 Host 启动"；截断末行被忽略且不使命令失败

#### Scenario: in progress、orchestrator-ended 与 abandoned 区分

- **GIVEN** 最新 run 无终态：orchestratorPid 存活或年龄 ≤120s 且端口 owned；或端口 owned 但 PID 不存在；或端口无 owned Host 且 PID 不存在
- **WHEN** 分别执行 `dsh history`
- **THEN** 依次显示 `in progress`、`orchestrator ended before stop; Host untouched`、`incomplete/abandoned`（后者附外部终端 `dsh` 恢复指引）

#### Scenario: ownership probe 失败不显示 abandoned

- **GIVEN** 最新 run 无终态且 lsof/ps 或 Windows CIM 查询失败
- **WHEN** 执行 `dsh history`
- **THEN** 显示 `unknown/incomplete (probe unavailable)`，不显示 abandoned/失败结论

### Requirement: agent 指令真相源必须写清同意规则、断线预期、非断线失败验证与恢复方式

环境级指令 `instructions/dsh-home.md`（经 sync 物化为 `$DSH_HOME/AGENTS.md`）、add/remove 插件 skill 与 README 必须(SHALL)包含以下**字面 token 或等价精确短语**（测试按字面断言）：`仅当用户明确要求`、`本次会话将断开`、`不得宣称重启成功`、`返回 0 只表示已排程`、`dsh history`、`未断开`、`failed(preparing|stop)`、`外部终端执行 dsh`、`dsh stop`、`按 receipt 验证`。内容必须(SHALL)说明：agent 不得自行发起重启；执行前告知断线；不得当次宣称成功；session 未断开时立即用 `dsh history` 检查并按 `failed(preparing|stop)` 报告失败（Host 未停、无需外部恢复）；重连后按 history/receipt 验证；Host 未恢复时外部终端 `dsh`；预览 home 重连后如何恢复地址（读 `$DSH_HOME/preview.json` 或重跑 `dsh`，以 `DSH_PREVIEW` 输出为准）。

必须(SHALL)移除旧的唯一指引：两个 skill 与 README 中不得再出现完整旧句 `**由用户执行**——重启会中断当前会话,agent 在会话内执行等于自断`，也不得出现 `请用户自己执行`；`instructions/dsh-home.md` 现有 `:17` 的"最后由用户决定并执行日常 Host 重启"必须(SHALL)改写为新规则（保留预览验收的"由用户决定"语义但改掉日常重启规则）。物化必须(SHALL)由隔离 `node scripts/sync.mjs` 的测试覆盖。

#### Scenario: 生成的 agent 指令包含同意、验证与恢复 tokens

- **GIVEN** 更新后的 `instructions/dsh-home.md` 与隔离 `DSH_HOME`
- **WHEN** 运行 `node scripts/sync.mjs` 并读取生成的 `AGENTS.md`
- **THEN** 文本包含上列 tokens（含 `未断开` 与 `failed(preparing|stop)`），且 `:17` 旧日常重启原文不存在或已替换为含新 anchor 的表述

#### Scenario: skill/README 旧唯一指引与旧句被移除

- **GIVEN** 更新后的两个 skill 与 README
- **WHEN** 运行指令/文档一致性测试
- **THEN** 两个 skill 与 README 中完整旧句与 `请用户自己执行` 均不存在；新增同意/验证 tokens 存在；README 的 `[ASK-RESTART]` 与 `dsh restart` 行已与新规则一致

#### Scenario: 预览恢复指引存在

- **GIVEN** 生成的 agent 指令
- **WHEN** 阅读重启与断线节
- **THEN** 包含预览 home 重连后的地址恢复方式（`preview.json` 或重跑 `dsh`，以 `DSH_PREVIEW` 为准）

### Requirement: 外部终端路径的 CLI 契约不得回退；receipt/history 与只读证据探测是明确增量

对**被归类为外部终端**的调用，`dsh restart` 的 CLI 契约必须(SHALL)保持不变：stdout/stderr 语义、退出码、autoUpdate→prerequisites→（`-b`）build→prepare→stop→start 的调用顺序与现有 contract 测试一致；会话专用的内部变量、state 目录与 orchestrator 不得(SHALL NOT)出现在外部路径中。允许的明确增量必须(SHALL)仅为：best-effort receipt 文件写入与 `dsh history` 追加摘要；以及分类所需的只读证据探测（读 cgroup；非 Linux 无标记时的有界父进程链只读查询）。外部路径的 receipt 写失败不得(SHALL NOT)改变命令输出/退出码。无 receipt 时 `dsh history` 输出必须(SHALL)与变更前逐字节一致；存在 receipt 时只允许追加 restart 摘要、不改变原有 startup 行。注意：Linux cgroup 不可读时即使"无会话标记"也按会话证据不确定 fail-closed（这是安全检查，不是同步路径回归）。

#### Scenario: 外部 restart 契约不回归

- **GIVEN** 被归类为外部终端的调用，隔离 home 与端口
- **WHEN** 执行 `dsh restart`（含 `-b`）
- **THEN** 现有 contract 测试断言的命令顺序与 stdout 关键行保持；不创建会话排程状态、不做 capability probe、不设置内部 orchestrator 变量

#### Scenario: 外部 receipt 写失败不影响命令

- **GIVEN** `$DSH_HOME` 只读或磁盘失败，被归类为外部终端
- **WHEN** receipt 追加失败
- **THEN** 命令仍按现状完成并按现状输出/退出；不得因 receipt 失败改成非零或改变 stderr 契约

#### Scenario: 无 receipt 的 history 输出不变

- **GIVEN** 隔离 `DSH_HOME` 中只有 `dsh-startup.log`、没有 `dsh-restart.log`
- **WHEN** 执行 `dsh history`
- **THEN** 输出与变更前实现逐字节一致

#### Scenario: 外部 restart 的 receipt 只增加可查询状态

- **GIVEN** 外部终端 restart 成功
- **WHEN** 执行 `dsh history`
- **THEN** 除原有启动记录外新增该 run 的 `source=external`、`ready` 与 PID/端口摘要，命令输出与退出码不变
