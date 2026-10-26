## Why

在 DSH 会话内执行 `dsh restart` 会**停机成功、启动没发生**：bash 工具进程运行在 Host 自己管理的 subprocess range（Linux/WSL 为 `dsh-subprocess-<hostpid>-*.scope`）里，Host 收到 SIGTERM 后按既有契约终止全部 managed range 与 terminal session，执行 restart 的启动器在发出 SIGTERM 后、拉起替代 Host 前被一起杀掉；失败也没有持久记录，调用者与后续会话无法判断结果。2026-10-26 11:35 本机真实发生：会话内 `node bin/dsh.mjs restart` 的输出停在 prepare、`dsh-startup.log` 无本次成功记录，用户从外部终端重新执行才恢复（秒级时间为用户报告）。除了普通 bash 工具（`dsh-subprocess-*`）之外，DSH 终端面板/终端会话由同一 provider 以 `dsh-terminal-*` scope 管理，Host dispose 同样会终止它们；只识别一个前缀会漏掉这条路径。结果是：部署后需要重启时，agent 无法安全地替用户完成（现有 add/remove 插件 skill 只能要求用户外部执行），而误以为已重启又会导致错误验收。

## What Changes

- **会话语境判定（所有平台，优先级固定、插入点固定）**：判定只发生在纯参数/预览 3080 校验之后、任何 probe/autoUpdate/prepare/stop 之前。Linux/WSL：cgroup 不可读 → fail-closed；命中 `dsh-subprocess-*`/`dsh-terminal-*` → 会话内；可读未命中且有保留标记（`DSH_SHELL=1`/`DSH_SESSION_ID`）→ 冲突 fail-closed；无标记 → 外部。darwin/win32：有标记 → 会话内 fail-closed；无标记时有界只读父进程链，证明 DSH Host 祖先 → 会话内 fail-closed；否则外部。只有无任何会话证据才走同步路径；cgroup 证据只在 provider native ownership 模式存在，旧 systemd/PGID fallback + 标记剥离是记录在案的残余风险。
- **三段握手 + marker/nonce + 结果投递宽限**：会话内 launcher 生成 `restartId`+`nonce`，在 `$DSH_HOME/state/dsh-restart/<id>/` 写 `meta.json`（含 expected 身份、cwd、port），以 argv 数组 re-exec 同一启动器到独立 transient scope（`systemd-run --user --scope … -- <node> bin/dsh.mjs <原始argv>`，`stdio:'ignore'`+`unref()`，不拼接 shell）。握手固定为 `ready` → `scheduled` receipt → `go` → 打印/返回；orchestrator 见到 go 后先等 `GRACE`（默认 3s，测试注入 clock）再 stop，保证命令返回早于 Host 停止；scheduled/go 写失败、未 ack、marker 截断/nonce 不匹配、abort 与 go 并存（abort 优先）均向不停止 Host 的安全方向收敛；abort 写失败由 go-timeout 兜底。P0 仅支持 Linux/WSL + capability probe（5s 上限）通过；其余会话语境副作用前 fail-closed。内部协议（`DSH_RESTART_*`）不是安全边界，must 从所有子进程剥离，普通 agent 环境/部分伪造环境 fail-closed 且不 stop。
- **统一编排 + expected/epoch + 并发 churn**：内部 orchestrator 复用同一 launcher 路径（autoUpdate→prereq→（`-b`）build→prepare→stop→start→readiness→UI），preview/隔离 home、端口回退、cwd、passthrough、UI 自动一致。`expected` 用与 `sameProcessIdentity` 可比较的字段存入 meta；定义 owned/empty/probe-error/多监听者/消失/预览（preview.json pid+created、matchesPreview）等状态。stop 前 GRACE 后复验 expected：被替换 → `failed(stop, superseded)` 不发信号；端口空 → 直接 start。**P0 明确接受并发 restart 的 churn**（无全局互斥锁，最后启动者胜出），identity epoch 只拒绝排程后被替换的过期编排；receipt/history 用 run 起始时间 + `superseded`/`stale-pid` 对账，session+session 与 session+external 均有场景。stop 后证明旧进程退出（默认 10s，契约 ≥ Host 5s shutdown grace + provider quiescence 余量，校准写 verify）才启动；prepare/stop/handoff/start 失败与 orchestrator 死亡都有终态或 incomplete 状态。
- **持久 receipt + `dsh history` 对账**：`$DSH_HOME/dsh-restart.log` JSONL（固定 phase 枚举、restartId、expected、旧/新 PID、orchestratorPid、端口、rc/reason；文件 0600，缺失时目录 0700，绝不改既有 home 权限）。会话路径排程前必须可写否则 fail-closed（持久化不可用路径豁免 receipt SHALL）；外部路径 best-effort、不改 CLI 输出/退出码。`dsh history` 有界尾读、按 run 起始时间选最新并只详展它、较早 run 标 superseded/stale-pid、in-progress/liveness/abandoned/probe-unavailable/后续 Host 启动、文件行序为到达顺序、末行截断忽略；无 receipt 时逐字节不变。
- **指令真相源更新**：`instructions/dsh-home.md`（含 rebase 后 `:17` 的"最后由用户决定并执行日常 Host 重启"）、add/remove 插件 skill（当前 `add:31`、`remove:18`）、README 改为：仅用户明确要求才可执行；执行前告知断线；不得当次宣称成功；返回 0 只表示已排程；session 未断开立即 `dsh history` 并按 `failed(preparing|stop)` 报告失败；重连按 receipt/history 验证；Host 未恢复时外部 `dsh`；预览 home 重连后按 `preview.json`/重跑 `dsh`（以 `DSH_PREVIEW` 为准）恢复地址；`dsh stop` 也会断开。旧完整句与 `请用户自己执行` 被移除，机械断言用字节精确锚点。
- **基线/归档约束**：worktree 已 rebase 到 `main@da3fefd7`，设计同步了 main 的预览/隔离启动器变化；实施时 main 再前进需重核。**本 change 不得在 `cross-platform-launcher` 的 MODIFIED start/stop 需求归档前归档**；若依赖长期不满足，只能保持 unarchived 或经用户批准 re-scope（把所需 delta 纳入本 change 并重新评审）。

非目标（P0 明确不做）：

- 不改变被归类为外部终端的 `dsh restart` 的同步语义、输出与退出码；允许的增量仅为 best-effort receipt/history 摘要与分类所需的只读探测（cgroup、非 Linux 有界父链查询），以及 cgroup 不可读时的安全检查 fail-closed。
- 不引入常驻 supervisor / systemd service / 开机自启 / 崩溃自恢复（P1）。
- 不重做端口归属与 stop/restart 基础安全逻辑；不解决 B014；预览 home 内 restart 只按同一逻辑复用。
- **不实现全局重启互斥/串行化**：并发 restart 的 churn 被显式接受（见上）；不承诺 macOS/Windows 会话内重启，不承诺标记被剥离的非 Linux/旧 systemd Linux 检测。
- 不改变会话内 `dsh stop` 实现；不保证重启不打断进行中的 turn，只保证失败不会被误报为成功。

## Capabilities

### New Capabilities

- `session-safe-restart`：会话内 `dsh restart` 的来源判定、re-exec 排程与三段握手/marker 协议、与外部一致的 launcher 编排、expected/epoch 与旧进程退出证明、并发 churn 的对账语义、持久 receipt 与 `dsh history`、指令真相源与同意规则。本 capability 只叠加会话内路径的更强保证；外部/同步 restart 契约仍由 `startup-autoupdate`（经 `cross-platform-launcher` 进行中 delta 修订）规定，冲突时以更严格者为准。

### Modified Capabilities

无。刻意不修改 `startup-autoupdate` 的 stop/restart 需求，避免与未归档的 `cross-platform-launcher` MODIFIED delta 冲突；归档顺序为硬约束。

## Impact

- 代码：`scripts/launcher/main.mjs`（分类插入点、内部 orchestrator 模式、log sink、GRACE/go/abort、handoff 证明、expected/epoch、history 扩展）、新增 `scripts/launcher/session-context.mjs`、`scripts/launcher/restart-receipt.mjs`、`scripts/launcher/restart-state.mjs`（meta/marker/nonce）、`scripts/launcher/detach.mjs`（probe+排程）；`bin/dsh.mjs` 不变；`scripts/launcher/process.mjs` 复用；`scripts/launcher/preview.mjs` 只读复用。
- 测试：新增 `tests/launcher-session-context.test.mjs`、`tests/launcher-restart-handshake.test.mjs`、`tests/launcher-restart-receipt.test.mjs`、`tests/launcher-restart-epoch.test.mjs`、`tests/platform/linux-restart-detach.test.mjs`（真实 systemd、显式 kill systemd-run client、不可用 skip+原因）、指令/文档断言；`tests/helpers/launcher-fixture.mjs` 与 `tests/launcher-{contract,lifecycle,preview}.test.mjs` 做**最小 seam 扩展**（经 `cross-platform-launcher` owner 协调并在 verify 记录 archive-order/baseline），新增"DSH 会话内跑 npm test 不创建 transient scope/capability probe"guard。
- 文档与指令：`README.md`、`instructions/dsh-home.md`（main checkout `dsh build` 物化）、`skills/add-dsh-plugin/SKILL.md`、`skills/remove-dsh-plugin/SKILL.md`。
- 运行面：Linux/WSL 需要 user systemd + probe；不改 `dsh.yaml`、不新增第三方依赖、不改变运行体解析、不新增网络/凭据面。
- 验收：单测/fixture 覆盖判定、握手协议、GRACE、expected 状态、epoch、并发对账、receipt/history、env、文档；真实 systemd 集成按 D3 的 (a)-(g)（含 kill client）；一次用户授权 WSL 会话内 restart + 外部 restart 非回归；macOS/Windows 只验收 fail-closed。
