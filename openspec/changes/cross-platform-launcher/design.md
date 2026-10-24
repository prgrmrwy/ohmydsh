## Context

现有 `bin/dsh` 796 行，混合参数、环境、版本编排、进程和 macOS UI 管理；大部分实质工作已委托 `scripts/*.mjs`。`scripts/lib/dsh-runtime.sh` 用 lsof/ps 核验目标端口。现有 launcher 测试会替换 Bash 源文本，不能原封不动给 Node 用。根测试脚本含 POSIX 内联赋值；CI 仅 Linux/macOS。`repo-layout` 还明确要求 Bash 版本比较，因此本次需要 delta 而非只改实现。

当前 pin 是 DSH 0.2.0-rc.2，Pet 声明长期 Host compatibility runtime。旧升级 change 已在当前分支归档，本次不升级 runtime、不重跑历史验收。上游有 win32 专用包只能证明实现意图，不能替代实际 Windows build/运行证据。当前公开 engines 为 Node >=22/npm >=10；归档升级 design 记录了上游更高 engine 要求，必须区分初始化最低值和实际 pin 的完整运行要求。

已读依据：current `startup-autoupdate`、`launcher-npm-environment`、`host-prerequisites`、`dsh-runtime-provisioning`、`repo-layout`；`docs/architecture/dsh-plugin-integration-pitfalls.md` 的长驻子进程/声明不等于生效规则；`bin/dsh`、runtime helpers、`scripts/lib/dsh-cli.mjs`、`run-bounded.mjs`、bootstrap/install、根 package 和 CI。无相关 launcher ADR。此前对 zx 的口头建议存在过度简化：不假设 `$({shell:false})` 可用，也不把 `npm.cmd` 加上扩展名就当作 Node 可无 Shell 执行的程序。

## Goals / Non-Goals

**Goals:** 同一 `.mjs` + zx 编排、npm bin/link、原生 Windows 与现有 POSIX 命令兼容、安全端口管理；按用户四步迁移并复用测试；纯键值环境文件已获用户确认。

**Non-Goals:** Windows 服务、TUI/任意上游命令扩展、跨平台浏览器标签自动化、修改上游/第三方源码、全仓无关重构、生产部署。仅保留最小兼容 wrappers，不维持两套产品逻辑。

## Decisions

### D1. .mjs + 局部 zx，零依赖 bootstrap 先于依赖加载

新增 `bin/dsh.mjs` 作为 npm bin，shebang 为 node；入口先用 Node 内置能力检查根依赖，再动态 import 编排。无需 TS/tsx/编译、全局 zx，不为了新入口提高 engines。根依赖加入精确 `zx@8.8.5`（实施前复核版本、许可、来源，根 lock 锁定）。不替换已有 js-yaml 等解析依赖。

zx 仅编排固定的平台探测/opener 脚本：POSIX 显式选 bash，Windows 显式 `usePowerShell()` 使用系统 powershell.exe，不要求 pwsh 7；设置 cwd/env/quiet 与超时。不为扩大 zx 使用范围而把 Git 放进 shell。所有携带用户/manifest/路径 argv 的执行均 `spawn/execFile(...,{shell:false})`：Git 用原生 executable，Node/包管理器用真实 JS 入口，taskkill 用 exe 参数数组。固定 zx 脚本仅插值已验证整数或启动器自建 loopback URL；不插值路径/普通 argv、不 raw/eval。PowerShell 5.1 原生参数传递会损坏空串/内嵌引号，不能靠 zx 引用消除，因此必须用 Windows Git argv 用例实测。长驻 Host 直接 spawn，不套 zx 或 shell。

内置模块实现共享包管理器 resolver（bootstrap 也用，无 zx 依赖）：Windows npm/npx 优先检查当前 Node 安装目录 `node_modules/npm/bin/{npm,npx}-cli.js`；其次验证存在的 npm_execpath 确为 npm/bin/npm-cli.js，再相对定位 npx；npm bin shim 直接调用 dsh 时通常没有 npm_execpath，不能依赖它。pnpm 优先支持 PATH 的原生 pnpm.exe，其次当前 npm 安装 prefix 下的 pnpm/bin/pnpm.cjs；Corepack 使用已安装 corepack 的 JS CLI（保持 compat builder 的 npm@11.19.0 / pnpm@11.7.0 pin），不得把 corepack.cmd 交给无 shell spawn。每个候选验证 realpath、package 名/入口和可读性，不解析任意 shim 程序。Volta/fnm 等布局不能解析时清晰诊断支持形态，不隐式装工具或 shell fallback。Node 的 CVE-2024-27980 修复会拒绝无 Shell spawn .cmd/.bat，因此 run-bounded/dsh-cli/compat runner 必须接收 `process.execPath,[cliJs,...args]` 或真实 exe，不能只给命令加 .cmd 后缀。通用可观察执行边界保持 run(command,args,{cwd,env,timeout})，不建插件框架。

`node scripts/bootstrap.mjs [--force]` 只依赖内置模块，读取 engines 和 .nvmrc、执行根 npm ci。健康检查至少核对根 lock 中 zx/js-yaml/yaml/semver 和 workspace 构建所需 TypeScript 的实际版本与入口可解析；缺少或不匹配触发 npm ci，不只测目录存在。之后 `npm link` 注册；不让 link 的隐式 install 充当 lock 安装证据。link 验收设置隔离 npm_config_prefix（Windows bin 就是 prefix，POSIX 为 prefix/bin），并检查根 lock 无改动。普通 dsh 调用缺依赖时只诊断。安装不使用 --force 覆盖 bin，不默认执行全局 link 实验于用户 prefix。

### D2. 按能力拆分，保留既有 CLI 子进程接缝

P1 临时 `scripts/launcher/*.sh` 按 args、environment、runtime/server、UI、maintenance（build/doctor/update/history）拆成可 source 原子模块，`bin/dsh` 只装配和分发；`scripts/lib/dsh-runtime.sh` 的安全规则不变。按能力而非逐函数建文件，source 不做安装、启动或网络副作用。

P3 对应 `.mjs` 模块替换；不强制 import 那些目前顶层执行且有副作用的既有 CLI，继续 node+argv 调用，保持现有独立脚本契约。供测试的执行入口可接受小型 effects 对象或 runner，但不得通过生产环境变量让用户替换身份校验。最终删除临时 Bash 产品实现，`bin/dsh` 和旧 bootstrap/install 最多保留薄转发/弃用指引。旧 install 的 DSH_BIN_DIR 如继续支持只由 Node 安装兼容入口处理；文档默认统一 npm link，卸载只删已证明属于当前 checkout 的链接，不动未知文件。

### D3. 命令契约优先于复制缺陷

迁移前固定所有分发/组合优先级表及当前测试输出。兼容命令包括默认/web、build/-b、stop/restart、reset、history、doctor/check、plugin-update/dry-run/yes、foreground/daemon、port/open、host/trusted-host、官方 CLI 路由。前后台、DSH_HOME/PROFILE/BIN、autoUpdate、prerequisite 警告与日志都进入基线。维护分支保留既有时序（restart 准备替代 runtime 在 kill 之前；用户此前口头描述的“先 stop 后 resolve”不是最终要求）。

缺值参数导致无限 shift、前台失败被吞、任意监听者被当 DSH 就绪不是要保留的特性；为这些差异单列 RED 测试与批准变更，P1/P2 不一边拆分一边修正。可移植契约断言不因实现迁移改写，变化只在执行 adapter；Windows 与新语义增加测试，不虚称旧 Bash 能通过这些新用例。

### D4. .env.local 无执行语义，事务式解析

共享 `scripts/lib/env-local.mjs` 后继的 builtin-only 词法解析器，显式 strictLauncher 与既有 allowlistConsumer 模式；不复制两套解析代码。后者保留 current spec 的 caller 优先、行内注释/转义字面值、忽略非白名单坏行与清单降级规则。strictLauncher 完整校验文件：UTF-8（BOM 可）、LF/CRLF、空行/整行 #、可选 export、合法键和等号。裸值 trim 后内部空白、分隔/重定向 `;&|<>()`、#、引号、反斜杠或开头 ~ 拒绝；要求引用或绝对路径，不把旧 Shell 语法悄悄当新值。引用内分号等为数据；单引号字面保留，双引号只解码 `\\` 与 `\"`，普通反斜杠保留；单引号在下一个单引号处结束，反斜杠不转义任何字符；双引号在第一个未被 `\"` 或 `\\` 消耗的双引号处结束。结束后仅允许空白。strict 模式任何 `$`/反引号（含单引号内）拒绝。错误只报告路径/行号/规则；先完整 parse 再生成 env，无 Shell/变量插值/真实文件写回。迁移示例与参数化测试逐一覆盖 a b、a;b、a&b、a #note、~/x、双引号反斜杠和引号。裸 sync 允许非白名单 Shell 行而 dsh build 拒绝是保留的显式入口差异，不把 launcher 新策略传播到裸脚本。

延续文件覆盖环境的现状，但入口先快照调用者显式 DSH_BIN 并最后恢复；仅忽略文件新引入的旧 Pet launcher 精确路径。显式 registry 的归属按 current spec：直接调用快照 + 文件显式值可证明，npm_command 表明隐式烘焙时保守剥离，文件明确设置的值可单独归因。Windows env 名按不区分大小写归一比较，确保清理后无残留大小写变体。不会将新纯键值限制推广为任意 CLI 参数限制。

### D5. 跨平台归属探测，拒绝 pidfile-only

不新增 pidfile 真相源、不新增 shutdown HTTP API。读取目标 TCP listen 所有者，返回明确的 empty / owned / unknown / probe-error，而不是把子进程非零当空闲。

- macOS/Linux：继续使用 lsof 查询监听 PID，ps 获取 argv、PPID、进程启动标识；保留 lsof 前置要求，在文档中说明 Linux 安装方式，不假装所有 Linux 自带。lsof 无匹配与工具失败要分别判定。
- Windows：使用固定的 powershell.exe `-NoProfile -NonInteractive -EncodedCommand` 脚本，Get-NetTCPConnection 查询目标端口、Get-CimInstance Win32_Process 取 PID/PPID/CreationDate/ExecutablePath/CommandLine，输出带显式状态的 JSON。输入只接受已经验证的整数 port/PID；受限权限、cmdlet 不可用、输出非 JSON、超时均 unknown/probe-error，拒绝 kill，不要求管理员、wmic 或 pwsh。可变 argv 不拼入 PowerShell 源码。

归属匹配真实 DSH 入口路径结构（官方 lib/bin.js 或 .bin/dsh、受管 compat 内相同入口）+ web 子命令 +目标端口；不能只匹配包含 `dsh web` 的命令文本。读取时核实包身份/路径，明确已支持的 npm exec wrapper 仅用于经核验的父进程，不沿整个父链杀终端。解析 Windows argv 必须按其引号规则，而非 split 空格。子进程创建时间/启动标识与实际 executable/argv 用于防 stale PID；每次 kill 前重查相同 PID 身份和端口，预算内端口重绑时拒绝。外部探测无法消除最后查询与系统 kill 之间的极短 TOCTOU，不承诺内核级句柄保证；对同用户恶意进程不建立新的安全边界。

归属枚举无结果仍须 net.connect 失败才判 empty；枚举空而可连接为 unknown，避免 lsof 看不到其他用户的监听者。启动/停止都需要可用 ownership probe；这是对旧 start 仅用 nc 的显式变更，缺工具先 RED 测试，输出平台前置和安装指引，不偷偷安装或仅 connect 放行。

轮询只用 net.connect（就绪/释放可达性）与自有 child 状态，完整 ownership probe 只在 start 初判、候选 ready、每次 kill 前和最终确认等决策点执行，一次 PowerShell 返回监听及 CIM 字段，避免每 0.5s 冷启动 PowerShell。单 probe ≤5s，总 stop 墙钟预算 ≤20s，各阶段共用 deadline，不将多次5s预算简单相加。

POSIX 先 SIGTERM，最多10s后重新核验再强杀。Windows 使用 `execFile('taskkill.exe',['/PID',String(pid),'/T','/F'])`，不依赖 zx kill/ps 内部行为；taskkill 128 只在确认进程/端口确已消失后视作已退出。run-bounded 同样使用 exe+argv 树回收。不能在 leader 消失后仅靠 stale PID tree kill；失去树拥有证明则诊断未知并不误杀复用 PID。

Windows argv 按 MSVCRT/CommandLineToArgvW 的反斜杠-引号规则解析，fixture 包含空串、路径空格和尾反斜杠。显式 DSH_BIN：Windows .js/.mjs/.cjs 用当前 node，.exe 直接，cmd/bat/ps1/其他不支持形态副作用前拒绝；POSIX 原有可执行文件直接执行。DSH_BIN 是单个命令路径而非命令字符串，不拆分内嵌参数；旧 Pet 路径比较在 Windows 分隔符归一且大小写不敏感。显式入口是用户逃生门不做包版本强制替换，但 stop 仍不能跳过目标归属证明。

### D6. 启动、UI 与日志

start 先探测归属：owned 复用、unknown/error 拒绝、empty 才准备 runtime。net.connect 只测可达性，不构成身份。spawn 使用当前 Node、真实 runtime JS 入口和 --no-open；前台等待退出并传播失败，后台 detached+文件日志+unref，禁止 shell 进程夹在 Host 前面。30s 就绪预算中检查自有 child 退出状态与端口 owner；同端口他人抢占不可判成功。超时仅清理已证明本次 spawn 的进程，错误日志给出可操作位置、不包含敏感 env。

Windows 后台明确 `detached:true,windowsHide:true,stdio:['ignore',logFd,logFd]` 后 unref，关闭父进程日志 fd；不留下管道或额外可见 console。验收除 launcher 返回外还包含终端会话关闭存活：POSIX 独立会话 shell 关闭/发 HUP；Windows 控制台拥有者退出（真实会话/终端自动化验收），确认 Host 存活。不得用 taskkill /T 关闭父 shell 冒充“终端关闭”，该命令语义本身是递归杀子树。无 GUI runner 时该一项记录待真机，不写成通过。

macOS 把现有 AppleScript/PWA 查询实现封装到 darwin 适配，保留原 bounded 预算，不杀整个 Chrome；DSH_OPEN_APP 等值只能作为 osascript/open 参数传入，由固定脚本 argv 读取，不插入 AppleScript 源文本；Linux 用 xdg-open，Windows 用固定 PowerShell Start-Process 打开 launcher 构造的 loopback URL；测试确认 --host/--trusted-host 不进入 opener URL。DSH_OPEN_APP 的 macOS 名称在非 macOS 仅告警，使用默认 URL opener。未知/失败 opener 不影响健康 Host，但不虚报打开成功。保留 history（末20行）、startup/prerequisite/autoupdate/UI 日志语义，避免在 quiet 模式下将命令中敏感值输出。

### D7. 验证覆盖真实闭包，不借迁移扩范围

P2 Node test runner 通过 Bash adapter 执行原子能力与真实 CLI，用 Node fixtures 记录 argv/env/files，不依赖替换源码中某一行。P3 同一 suite 切换到 mjs adapter。既有 launcher/npm/runtime tests 必须迁移而非删除。新增 root test driver 用 Node 设置一个真实不存在的隔离 overlay 路径，并枚举测试文件；不能依赖 cmd 的通配符或 POSIX 环境前缀。

传递闭包审查：sync/npm 构建与 scope registry、host-prerequisites、third-party-resources 的 tar/hash、plugin-update、runtime provision + Pet compat builder；搜索 .sh、kill(-pid)、HOME、fileURL/path、chmod/锁/rename/symlink 和测试桩可执行方式。只修从本次命令实际可达且在原生平台证实的阻碍。已启用插件在完整 manifest gate 失败时可以报告缺口，不擅自禁用它以换取通过。

CI Linux/macOS/Windows × Node 22.x/24.x 跑根测试（按现有依赖先构建 dsh-openspec）；Bash 临时基线只在 POSIX 跑，最终 cross-platform suite 在 Windows 排除 Git/bin、Git/usr/bin 等 Bash 目录并保留 Git/cmd 的 git.exe，断言 where.exe bash/sh 不可用，cmd/系统 PowerShell 调 npm shim。ShellCheck 保持到 P4 删除临时 Bash 产品模块后才调整。公开 manifest gate 用隔离 DSH_HOME、空 overlay、非生产端口、web.open=false、autoUpdate 跳过，无私有凭据/生产数据：全量 build×2（第二次无变化）、官方 dump、真实 Host ready/stop 和受影响 local package build/typecheck/test。该重 gate 可独立 workflow_dispatch，不以桩矩阵代替其结果。缺可用 Windows runner或网络导致尚未跑完须保留未验收状态。

## Risks / Trade-offs

- [原生 Windows 强杀跳过刷盘和第三方清理] → 用户已接受；警告保留，不新增未经证实的优雅关闭承诺。
- [zx shell 差异及进程枚举隐含依赖] → 显式选择 shell，固定脚本/引用与 argv 测试；归属探测不使用其 ps。
- [Windows 原生依赖或 compat 构建失败] → 真实完整 gate，诊断失败保留；不改第三方源码绕过。
- [旧本地文件含 Shell 表达式] → 用户确认 breaking，完整校验、脱敏错误、文档迁移，绝不读取生产凭据来生成样例。
- [npm link 名称冲突和全局 prefix] → 隔离前缀验收、文档提示；不 --force、不操作用户全局安装。
- [Linux 缺 lsof] → 继续明确前置工具，probe-error 不能退化为空端口。

## Migration Plan

1. P1 等价 Bash 拆分；现有测试绿，记录已知缺陷，不切入口。
2. P2 补原子能力/命令矩阵契约，记录 Bash 基线；新行为先写 RED（可标记待实现，最终不得跳过）。
3. P3 在变更依赖前按 Worktree Session `ws promote`，加入 zx、实现 mjs 和平台适配，逐能力运行同断言。改进程/参数/环境行为必须有对应 RED→GREEN 证据。
4. P4 npm bin/link 一次切换全部平台，删除临时 Bash 产品模块；迁移 bootstrap/install、tests、CI、README。change 完成/归档要求：全部 launcher 合同与已改闭包测试三平台通过（包括终端关闭验收，不可省略）、公开完整 manifest gate 三平台实际运行并记录结果。若完整 gate 的失败来自本次命令闭包，必须修复后通过；若确认为第三方/上游原生平台缺口，记录最小复现、归属和后续 issue，经用户明确接受限缩交付才可归档，不能由 Agent 单方面降低完成标准。无论是否接受限缩，README“完整仓库支持 Windows”都要求完整 gate 全绿。未跑 gate 与未跑真机验收不能当成可接受的失败结果。实现不自动生产部署。
5. 回滚：停止本次拥有的候选 Host，回退入口/代码/根 lock，恢复旧的受管 link；不恢复或覆盖生产数据。env 文件迁移不由脚本改写，使用者保留自己的备份。合入/清理 worktree 仍需后续用户明确批准。

## Open Questions

产品决定已定。实施核验项：包管理器 resolver 约定布局的真实 Windows smoke、compat/native 依赖、最低 engines 与实际 pinned runtime 的交集。DSH_BIN 形态和环境文件规则已在本设计中明确，不留到编码时临场决定。不能满足契约时报告并修订，不默默添加 Git Bash/管理员依赖。Anvil round 1 为 APPROVE_WITH_CHANGES；修订须独立复核 CHANGES_APPLIED 后才生成下游计划。
