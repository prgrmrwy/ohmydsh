## MODIFIED Requirements

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
