# startup-autoupdate Specification

## Purpose
DSH 启动/构建入口在每次运行时自动检测 registry 上的最新 DSH 版本;一旦发现更新且仓库工作区干净,阻塞式完成「改 `dsh.yaml` pin 与同族版本 → 重跑 sync 物化 → 自动 commit」后再继续启动,保证日常尽量从最新 DSH 版本开始,同时通过开关、脏工作区跳过与失败即停保留人工控制。
## Requirements
### Requirement: autoUpdate 开关与追踪频道可配置

manifest 顶层 `autoUpdate` 映射必须(SHALL)支持布尔 `enabled` 与字符串 `channel` 两个字段。未配置 `autoUpdate` 时视为启用、`channel` 默认 `latest`;`autoUpdate.enabled: false` 或环境变量 `DSH_SKIP_UPDATE=1` 时必须完全跳过版本检测。`channel` 取 registry 的 dist-tag(`latest` 或 `next`),环境变量 `DSH_UPDATE_CHANNEL` 必须以最高优先级覆盖 manifest 中的 `channel`。

#### Scenario: 默认启用并追踪 latest

- **WHEN** `dsh.yaml` 不含 `autoUpdate` 字段时运行 `dsh`
- **THEN** 启动器执行版本检测,以 registry 的 `latest` dist-tag 为追踪目标

#### Scenario: 显式关闭

- **WHEN** `autoUpdate.enabled: false` 或设定了 `DSH_SKIP_UPDATE=1`
- **THEN** 启动不做任何检测,直接按当前 `dshVersion` 执行

#### Scenario: 频道覆盖

- **WHEN** `DSH_UPDATE_CHANNEL=next dsh` 且 manifest 中 `channel: latest`
- **THEN** 检测以 registry 的 `next` dist-tag 为追踪目标

### Requirement: 启动与构建入口执行版本检测

启用且未跳过时,`dsh`(server 未运行)、`dsh -b`、`dsh build` 三个入口在各自动作前必须(SHALL)查询 registry 目标频道的最新版本并与当前 `dshVersion` 比较。检测失败或离线时必须警告并继续按当前 pin 执行,不得阻塞。start 入口在 server 已运行时(仅打开 UI)不得触发检测。

#### Scenario: 启动前检测

- **WHEN** 运行 `dsh` 且 server 未运行、autoUpdate 启用
- **THEN** 在拉起 server 前完成 registry 最新版本查询与比较

#### Scenario: 已运行时不重复检测

- **WHEN** 运行 `dsh` 且 server 已在运行
- **THEN** 只打开 UI,不执行版本检测

#### Scenario: 离线容错

- **WHEN** registry 查询失败或超时
- **THEN** 打印警告并以当前 `dshVersion` 正常启动,不中断

### Requirement: stop/restart 按端口安全管理 server 与 UI 生命周期

`dsh stop` 与 `dsh restart` SHALL 从目标端口监听者定位 server，在任何终止前核验其 DSH web 入口与参数。不得仅靠进程名、PID 文件、HTTP 响应、版本字符串或某一 npm/npx 固定字符串证明归属。读不到所有者、命令行或进程身份、同端口存在未知监听者时 SHALL 非零拒绝，不得当作端口空闲。查询无监听者时 stop SHALL 幂等成功，不做安装或 registry 查询。每次强制终止前 SHALL 重新读取归属和进程身份，身份变化或端口被他方接管时拒绝进一步发送信号。

POSIX SHALL 先发 SIGTERM，再有界等待和重新核验后升级为强制终止；Windows SHALL 允许核验后的强制终止进程树，并明确提示不保证优雅退出。终止范围 SHALL 仅为已核验的 server 及其从属进程，不得按 Node/Chrome 名称批量结束进程。所有探测和停止 SHALL 有界；失败时非零结束，不报告已停止。

`stop` SHALL NOT 执行 registry 查询、CLI provision 或包依赖计算。`restart` SHALL 在停止健康 Host 前完成替代运行体准备：按 `dsh-runtime-provisioning` 精确 pin 策略解析一次，失败则保留健康 Host；随后停止 server、执行平台 UI 清理、确认端口释放、启动已准备的 Host，并遵守 UI 打开开关。macOS SHALL 保留已安装 PWA 和同 loopback 端口 Chrome 标签清理，且独立于 server 匹配结果及 `web.open` 执行。Windows/Linux SHALL 不批量关闭普通浏览器或标签，输出需手动关闭的提示。无法安全识别 UI 时不得终止未知 UI 进程。

#### Scenario: npm/npx 升级改变 server argv
- **GIVEN** 目标端口的 DSH 入口已被识别
- **WHEN** 监听者使用 `node …/node_modules/.bin/dsh web --port <port>` 或已支持的 `lib/bin.js web --port <port>`
- **THEN** stop/restart 仍能定位并停止该 server，不因旧字符串不匹配而失效

#### Scenario: 端口被非 DSH 服务占用
- **GIVEN** 目标端口存在监听者
- **WHEN** 其 argv 无法证明属于 DSH web
- **THEN** stop/restart 非零退出，不向它或其父子进程发送终止信号

#### Scenario: stop 不触发运行体解析
- **GIVEN** npm、npx、pnpm 与 registry 查询均被记录
- **WHEN** 操作者运行 stop，无论目标 server 是否存在
- **THEN** 安装与元数据查询记录为空，只有本地探测、停止及允许的平台 UI 清理

#### Scenario: restart 清理重复 UI
- **GIVEN** macOS PWA 与同端口 Chrome 标签同时存在，精确 pin 缓存就绪
- **WHEN** 运行 restart
- **THEN** 两种 UI 被清理，旧 Host 停止后启动已准备的运行体，按 web.open 只打开一次 PWA（关闭则零次）

#### Scenario: Windows 强制停止只影响已核验树
- **GIVEN** Windows 目标端口属于可核验的 DSH，另有无关 Node 进程
- **WHEN** 执行 stop
- **THEN** 已核验 Host 树退出、目标端口释放、无关 Node 仍存活，输出含强制停止提示

#### Scenario: 探测失败或停止期间身份变化
- **GIVEN** 平台查询报错，或等待中原 PID 被复用/目标端口被另一进程接管
- **WHEN** stop 准备发送或升级终止信号
- **THEN** 非零拒绝该次终止，不以“没有 server”或“停止成功”掩盖未知结果

#### Scenario: 查询未见监听者但端口可连接
- **GIVEN** 平台监听查询返回无匹配，而 loopback 连接检查成功（例如无权枚举其他用户进程）
- **WHEN** start、stop 或 restart 判断目标端口
- **THEN** 归为未知占用并非零拒绝，不准备新 Host、不终止未知进程

#### Scenario: 替代运行体准备失败保留现役 Host
- **GIVEN** 现役 Host 健康，替代运行体解析桩失败
- **WHEN** 运行 restart
- **THEN** 非零退出，现役 Host 未收到终止信号，没有创建替代 Host

#### Scenario: 非 macOS stop 不杀浏览器
- **GIVEN** Windows 或 Linux 存在普通浏览器窗口，目标端口无监听者
- **WHEN** 执行 stop
- **THEN** 退出码为 0，浏览器仍存活，输出手动关闭 UI 的提示，未调用 macOS 自动化

### Requirement: UI 自动打开可由 manifest 关闭

启动/检测时是否自动打开 UI SHALL 由 manifest 顶层 `web.open` 控制，缺省为打开。前后台官方 `dsh web` SHALL 始终收到 `--no-open`，UI 只由本启动器单点打开一次。`web.open: false` 时冷启动、已运行检测和 restart SHALL 不打开 UI，输出地址及 `dsh --open` 指引。`--no-open` 优先于 `--open`，后者优先于 manifest；标志不重新启用官方 opener。manifest 中 UI 配置解析失败时仍按旧规范的缺省打开处理，但无法获得有效版本等启动前提时不得启动。

macOS SHALL 使用已配置/唯一探测到的 PWA，失败回退默认浏览器；Windows/Linux SHALL 使用系统默认 URL opener，不要求 macOS app 名称或 Git Bash。opener 缺失/失败 SHALL 仅提示手动访问，不使健康 server 停止，不虚报 UI 已打开。stop 的平台 UI 清理不受开关影响。

#### Scenario: 缺省自动打开且不重复
- **GIVEN** manifest 不含 web.open，端口空闲且系统 opener 可用
- **WHEN** 运行一次 dsh
- **THEN** 官方 CLI 收到 --no-open，本启动器就绪后打开一次平台 UI，无第二次官方打开

#### Scenario: manifest 关闭自动打开
- **GIVEN** web.open 为 false
- **WHEN** 冷启动、检测已运行或 restart
- **THEN** opener 调用次数为 0，输出地址和 --open 指引；stop 清理仍遵循平台规则

#### Scenario: 显式参数优先
- **GIVEN** web.open 为 false 或 true
- **WHEN** 分别传入 --open、--no-open、或同时传入二者
- **THEN** --open 单独强制打开，--no-open 单独或并存均零次打开

#### Scenario: opener 不可用仍保留服务
- **GIVEN** Host 已就绪而系统 opener 缺失或退出失败
- **WHEN** 启动器尝试打开 UI
- **THEN** Host 仍监听、启动成功，输出手动访问 URL，不输出 UI 打开成功

### Requirement: 语义化版本比较决定是否更新

版本比较必须(SHALL)遵循语义化版本规则,含预发布数字序(`rc.9` < `rc.10`)。当前 `dshVersion` 已是最新时不得做任何改写或重建动作。

#### Scenario: 发现可更新版本

- **WHEN** 目标频道最新版本大于当前 `dshVersion`
- **THEN** 进入自动升级流程(或按脏工作区规则跳过)

#### Scenario: 已是最新

- **WHEN** 目标频道最新版本不大于当前 `dshVersion`
- **THEN** 直接继续原动作,输出不含任何更新事件

### Requirement: 自动升级仅在工作区干净时执行

检测到更新后,启动器必须(SHALL)检查仓库 git 工作区(`git status`)是否包含任何未提交或未跟踪改动。存在改动时必须跳过自动升级,并在输出中说明检测到的新版本、跳过原因与再次触发条件;不得改动 `dsh.yaml`、不得重跑 build、不得提交。

#### Scenario: 工作区干净则升级

- **WHEN** 检测到更新且 `git status` 为空(无未提交/未跟踪改动)
- **THEN** 执行完整自动升级流程后继续启动

#### Scenario: 工作区有改动则跳过并说明

- **WHEN** 检测到更新但 `git status` 存在任何改动
- **THEN** 跳过自动升级,启动/构建正常进行,并在输出中写明「检测到新版本 <X>,仓库有未提交改动已跳过,提交后可自动」

### Requirement: 升级改写 manifest 并联动同族版本

自动升级必须(SHALL)以行级文本方式改写 `dsh.yaml`(保留注释与整体结构):将 `dshVersion` 改为目标版本;对名字匹配 `@deepseek-ai/dsh-*` 且当前 pin 等于旧运行体版本的位置(顶层 `dependencies` 的 spec、`package` 定制条目的 `spec` 与 `version`)一并改写为目标版本。名字不匹配或 pin 与旧运行体不一致的条目不得改动。改写前必须(SHALL)生成 `dsh.yaml.bak` 备份。

#### Scenario: 联动同族依赖

- **WHEN** `dshVersion` 从 `0.1.0-rc.6` 升到 `0.1.0-rc.7`,且顶层存在 `@deepseek-ai/dsh-sdk-protocol@0.1.0-rc.6`
- **THEN** 该依赖的 spec 一并改写为 `@0.1.0-rc.7`,第三方包(如 `dsh-cost-meter@1.5.6`)保持不变

#### Scenario: 保留刻意钉住的旧版

- **WHEN** 某 `@deepseek-ai/dsh-*` 条目的 pin 不等于旧运行体版本(如刻意钉在 `rc.8`)
- **THEN** 该条目不被自动改写

#### Scenario: 备份先行

- **WHEN** 自动升级改写 `dsh.yaml` 前
- **THEN** 已存在内容与改写后一致的 `dsh.yaml.bak`,可用于回滚

### Requirement: 升级后重物化并自动提交

改写后必须(SHALL)重跑 sync 物化定制。sync 失败时,必须(SHALL)从 `dsh.yaml.bak` 恢复 `dsh.yaml`,以错误退出且不启动。sync 成功后,若工作区相对改写前仅含 `dsh.yaml` 一处改动,必须(SHALL)自动 `git commit --no-verify`(跳过 pre-commit 钩子),message 取 `chore(dsh): auto-bump <旧> → <新>`;commit 失败(如缺少 git 身份、签名失败)时必须(SHALL)以错误退出且不启动,并提示手动处理方式。

#### Scenario: build 失败回滚且不启动

- **WHEN** 改写 `dsh.yaml` 后 sync 报错
- **THEN** `dsh.yaml` 从备份恢复,启动器以错误退出,不启动 server

#### Scenario: 成功升级并提交

- **WHEN** 改写后 sync 成功且工作区干净(仅 `dsh.yaml` 变化)
- **THEN** 自动生成 commit `chore(dsh): auto-bump 0.1.0-rc.6 → 0.1.0-rc.7`,随后按原入口继续(start 拉起 server / build 完成)

#### Scenario: commit 失败即停

- **WHEN** 自动 commit 因 git 原因失败
- **THEN** 启动器以错误退出、不启动,并在输出中提示手动 commit 或回滚的处置方式

### Requirement: 升级与跳过事件可追溯

启动日志(`dsh history` 读取的 `$DSH_HOME/dsh-startup.log`)必须(SHALL)记录 autoUpdate 事件:成功升级(旧版本 → 新版本、频道)、因工作区脏而跳过(新版本与原因)、离线检测失败。

#### Scenario: 记录升级

- **WHEN** 自动升级完成一次 `0.1.0-rc.6 → 0.1.0-rc.7`
- **THEN** 启动日志新增一行 autoUpdate 事件,含旧版本、新版本与频道

#### Scenario: 记录跳过

- **WHEN** 因工作区脏跳过自动升级
- **THEN** 启动日志新增一行含新版本号与跳过原因的 autoUpdate 事件

### Requirement: 升级链目标版本 CLI 使用前就绪并复用

自动升级链中所有对目标版本 DSH 运行体 CLI 的调用必须(SHALL)在使用前确认其已安装就绪;同一目标版本的多次调用必须(MUST)复用已就绪的实例直接执行,不得为每次调用重新发起安装,也不得让安装动作与任何其他调用并发竞争。显式指定 CLI 路径(DSH_BIN)时,调用必须(SHALL)直接使用该路径并跳过就绪检查。任何一次就绪失败(含首次就绪与复用前实例缺失)必须(MUST)使升级链失败,并沿用既有失败语义(sync 失败 → 从备份回滚 `dsh.yaml`、以错误退出且不启动),不得静默降级为不可预测的安装行为。

#### Scenario: 首次使用先单次就绪

- **WHEN** 升级链需要调用目标版本 CLI,且其尚未安装就绪
- **THEN** 升级链先完成一次针对该目标版本的安装就绪,再继续调用;就绪未完成前不发起针对同一目标的第二次安装尝试

#### Scenario: 已就绪的后续调用直接复用

- **WHEN** 目标版本 CLI 已就绪,且升级链还需多次调用该 CLI
- **THEN** 后续调用直接执行已就绪的实例,不重新发起安装,不产生任何安装锁竞争

#### Scenario: 显式 CLI 路径跳过就绪

- **WHEN** 环境显式指定了 CLI 路径(DSH_BIN)
- **THEN** 调用直接使用该路径,不做安装就绪检查

#### Scenario: 就绪失败保持失败即停

- **WHEN** 目标版本 CLI 无法在升级链内就绪
- **THEN** 升级链判定失败并沿用既有规范:sync 失败、`dsh.yaml` 从 `dsh.yaml.bak` 恢复、以错误退出且不启动


### Requirement: 本机 DSH_TRUSTED_HOSTS 声明额外 Host fence 授权

启动器可(MAY)从环境变量 `DSH_TRUSTED_HOSTS`（含 `.env.local` 注入）读取额外信任的 Web authority，以逗号或空白分隔。启动器必须(SHALL)在前台与后台官方 `dsh web` 启动路径(含 `dsh restart`)上，按声明顺序为每项追加一组 `--trusted-host <值>`，位于启动器强制的 `--no-open` 之后、用户命令行透传参数之前；变量未设置或为空白时不得(SHALL NOT)追加任何 `--trusted-host`。每项必须是 bare `host[:port]`（主机名、IPv4 或带方括号的 IPv6），否则启动器必须报错并非零退出，且必须在 `dsh restart` 停止现有 Host 之前完成该校验。公开 `dsh.yaml` 不得(SHALL NOT)承载具体部署域名。

#### Scenario: 未设置保持纯回环 fence
- **GIVEN** 环境与 `.env.local` 均未设置 `DSH_TRUSTED_HOSTS`
- **WHEN** 启动器冷启动 `dsh web`
- **THEN** 官方 argv 不含 `--trusted-host`

#### Scenario: 声明的条目逐项传入
- **GIVEN** `.env.local` 含 `DSH_TRUSTED_HOSTS=a.example.com,b.example.com:8443`
- **WHEN** 启动器冷启动或 restart
- **THEN** 官方 argv 含 `--trusted-host a.example.com --trusted-host b.example.com:8443`

#### Scenario: 写错时 restart 不停机
- **GIVEN** `DSH_TRUSTED_HOSTS` 含 `https://a.example.com`，且健康 Host 正在运行
- **WHEN** 运行 `dsh restart`
- **THEN** 启动器报 `DSH_TRUSTED_HOSTS` 错误并非零退出，现有 Host 未被停止
