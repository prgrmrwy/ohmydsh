## Purpose

提供原生 Windows、macOS、Linux 共用的 ohmydsh 命令安装、编排与诊断能力，在迁移现有 Bash 启动器时保留外部契约，并使配置读取、参数传递和失败处理不依赖使用者的 Shell。

## ADDED Requirements

### Requirement: 一个安装入口提供同一命令面

仓库 SHALL 通过根包 npm bin 暴露 `dsh`，在完成锁定依赖初始化后可用 `npm link` 安装。原生 Windows 的 cmd/PowerShell 不得要求 WSL、Git Bash 或全局 zx。调用目录 SHALL 仍作为用户工作目录，仓库资源 SHALL 相对实际安装入口解析。缺少项目依赖时 SHALL 输出初始化指引并非零结束，不在普通启动中隐式安装根依赖。安装文档 SHALL 区分 `npm ci` 与 link，并说明 PATH、官方同名 bin 冲突、Node 全局前缀和 execution policy；不得为消除冲突强制覆盖无关命令。

#### Scenario: link 后从其他目录调用
- **GIVEN** 隔离前缀中已安装根 bin，仓库路径含空格，用户工作目录不在仓库内
- **WHEN** 在支持平台调用 `dsh --help`
- **THEN** 退出码为 0，输出包含本仓库子命令，且未将用户目录改成仓库或调用另一份官方同名 bin

#### Scenario: 缺少根依赖不自行安装
- **GIVEN** bin 入口可执行但项目依赖不完整
- **WHEN** 用户调用 `dsh build`
- **THEN** 非零退出并提示根初始化命令，不发起 install、不触碰 DSH home

### Requirement: 命令路由与子命令结果跨平台一致

启动器 SHALL 保留默认 start/显式 web、build、`-b`/`--build`、stop、restart、reset、history、doctor/`--check`、plugin-update/`--dry-run`/`--yes`、前台模式、端口和 UI 开关；官方 `plugin`、`--profile`、`--patch`、dump 参数 SHALL 原样转交既有精确 pin CLI。优先级和有效参数组合 SHALL 以迁移前记录的命令表为基线；未知参数、缺少必需参数值、非法端口 SHALL 在任何副作用前非零拒绝，不得死循环或静默启动。被调用命令失败 SHALL 反映为非零退出；既有 doctor 自愈非阻塞规则保持不变。

#### Scenario: 本地与官方命令分流
- **GIVEN** sync、doctor、plugin-update 与官方 CLI 均为记录 argv 的隔离桩
- **WHEN** 分别运行 build、doctor --check、plugin-update --dry-run --yes、plugin --profile web list
- **THEN** 各自仅执行对应命令；参数逐项一致，非零桩退出被传播，官方调用不误拼到 web 后面

#### Scenario: 无效参数没有启动副作用
- **GIVEN** 隔离命令桩可记录全部外部执行
- **WHEN** 分别传入未知参数、孤立 --check、缺值 --port 或超出 1..65535 的端口
- **THEN** 每次调用均有界非零退出、报告参数错误，且没有 build、安装、更新或 server 启动记录

### Requirement: 本地环境配置只接受无执行语义的赋值

启动器读取仓库 `.env.local` 时 SHALL 在任何命令副作用前完整校验为 UTF-8 单行键值配置；文件可缺省。允许空行、整行注释、可选 `export `、合法环境变量名与 `=`、空值和成对引号。裸值 trim 后不得含内部空白、`;&|<>()`、引号、反斜杠或以 `~` 开头；裸值中的 `#` 也拒绝，避免把旧行内注释变为数据。`; & | < > ( ) #` 仅在引用值内为数据。单引号内容字面保留；双引号只解码 `\\` 与 `\"`，其余反斜杠原样保留。单引号值在下一个单引号结束且没有任何转义；双引号值在第一个未被 `\"` 或 `\\` 消耗的双引号结束。结束后只允许空白。所有引用方式内的 `$` 和反引号、引号未闭合、赋值外语句及多行值 SHALL 拒绝并提示行号与迁移说明，不回显值。不执行 Shell 或变量插值。重名键以最后一个为准。除调用者显式 `DSH_BIN` 保持最高优先级及旧 Pet-only `.env.local` DSH_BIN 精确值迁移例外外，合法文件值 SHALL 延续当前覆盖环境行为；registry 来源识别 SHALL 继续遵守 `launcher-npm-environment`。

启动器严格模式与裸 manifest 脚本的白名单兼容模式 SHALL 共用词法解析器；后者继续遵循 `repo-layout` 的环境优先级、容错与只读白名单，不因本要求对非白名单行做全文件拒绝。文档 SHALL 明示该入口差异。

#### Scenario: 纯键值配置跨平台等价
- **GIVEN** 配置含 CRLF、export、空值、重复键以及带空格和反斜杠的引用值
- **WHEN** 三平台加载该配置并调用记录环境的桩
- **THEN** 得到相同键值；重复键取最后值，调用者显式 DSH_BIN 不被文件覆盖，且未执行 Shell

#### Scenario: 旧 Shell 语法失败且不泄露值
- **GIVEN** 配置在合法赋值后含命令替换、变量展开或独立命令，其中包含秘密哨兵值
- **WHEN** 加载配置
- **THEN** 非零退出，错误仅含文件位置、行号与迁移指引；哨兵值不出现在输出/日志，合法前缀赋值未部分发布，副作用桩未执行

#### Scenario: 裸值中的命令分隔与空白拒绝
- **GIVEN** 配置分别包含 KEY=a b、KEY=a;b、KEY=a&b 或管道/重定向/括号裸值
- **WHEN** 由启动器加载
- **THEN** 每个输入非零拒绝且未执行后续命令；相同元字符放进引号后作为数据传递

#### Scenario: 旧行内注释不得变成值
- **GIVEN** 配置包含 KEY=a #note
- **WHEN** 由启动器加载
- **THEN** 非零拒绝并提示改为单独注释行，不把 #note 写入环境值

#### Scenario: 波浪号和裸反斜杠不得被猜测
- **GIVEN** 配置裸值以 ~/ 开头或含反斜杠
- **WHEN** 由启动器加载
- **THEN** 非零拒绝并提示使用绝对路径与引用，不隐式展开 home 或吞掉反斜杠

#### Scenario: 双引号反斜杠保持已声明语义
- **GIVEN** 双引号值分别含转义反斜杠、转义双引号和普通反斜杠，单引号含 Windows 路径（含以反斜杠结尾的 `'C:\dir\'`）
- **WHEN** 由启动器加载
- **THEN** 双引号仅解码转义反斜杠与双引号，其余保持字面；单引号完全字面，输出不记录原值

### Requirement: 外部执行保留参数和环境边界

命令闭包内的 Node、Git、npm/npx/pnpm 与平台探测 SHALL 保留参数边界、退出码和调用级环境，路径含空格、Unicode 或元字符时不得变成额外命令。可变数据不得通过未转义拼接进入 Shell。前后台 Host 环境剥离、用户显式 registry 与单次 npm registry 注入 SHALL 继续满足 `launcher-npm-environment`，Windows 环境变量名大小写不敏感时也不得泄漏重复变体。库的进程枚举或 kill 结果不得替代 DSH 身份判定。所有携带调用者、manifest 或路径派生 argv 的外部调用 SHALL 使用不经过 Shell 的参数数组；固定平台脚本的插值 SHALL 仅为经验证的整数或启动器构造的 loopback URL，不通过 Shell 传递可变 Git/npm 参数。Windows 显式 DSH_BIN 的 JS 文件 SHALL 用当前 Node 执行，原生 exe SHALL 直接执行；cmd/bat/ps1 或未知不可执行形态 SHALL 在副作用前诊断拒绝，不自动拼接 Shell。POSIX 已有可执行 DSH_BIN 契约保持不变。

#### Scenario: 元字符参数仍是数据
- **GIVEN** 测试路径与参数含空格、中文、引号、美元符、分号、& 和括号（环境文件不参与该参数用例）
- **WHEN** 经执行层调用 Node、Git 和已解析的包管理器测试桩
- **THEN** 桩收到逐项相同的 argv，不生成注入哨兵文件，退出码和 stdout/stderr 可被调用者分别观察

#### Scenario: Windows Git 保留引号与空参数
- **GIVEN** 原生 Windows Git 可执行文件和临时 Git config 文件，不设置 Shell alias
- **WHEN** 通过 git config --file 写入含双引号的值及空值，再用 --null --get 读取
- **THEN** 输出字节分别等于原值加 NUL，包括空值的单个 NUL；无 PowerShell 或 Git Shell alias 重编码

#### Scenario: Windows 显式 DSH_BIN 形态可预测
- **GIVEN** 显式 DSH_BIN 分别指向 JS 入口、exe、cmd、bat、ps1
- **WHEN** 调用官方转交或 Host 准备
- **THEN** JS 与 exe 用正确执行方式且不 provision；其余类型副作用前非零拒绝并给出改用 JS/exe 的指引

#### Scenario: npm 隐式环境不进入 Host
- **GIVEN** npm exec 环境含大小写变体的 npm 配置与 lifecycle 变量，另有普通用户环境变量
- **WHEN** 分别启动前台与后台 Host 桩
- **THEN** 隐式 npm 变量全部被剥离，普通变量保留，两条路径结果一致，仓库 registry 不污染 Host

### Requirement: 后台启动有界且不把占用端口等同于就绪

默认启动 SHALL 在后台运行并把日志写入既有 DSH home；Host 不依赖启动器存活，关闭发起终端不应终止它。前台模式 SHALL 等待 Host 退出并返回其失败结果。启动前 SHALL 区分目标端口空闲、可证明 DSH 和未知占用；已运行 DSH 不重复 provision 或启动，未知占用非零拒绝。新进程早退或 30 秒内未就绪 SHALL 非零诊断且不打开 UI，不能仅因其他进程抢占端口就报告成功。只回收本次可证明拥有的启动进程，不碰未知占用者。

#### Scenario: 后台命令退出后 Host 继续运行
- **GIVEN** 空闲端口与可识别的隔离 Host 桩
- **WHEN** 默认启动完成且发起启动器已退出
- **THEN** Host 仍存活且监听目标端口，日志在隔离 DSH home，再次 start 不创建第二个 Host 或 provision

#### Scenario: 关闭发起终端后后台 Host 存活
- **GIVEN** 后台 Host 由隔离会话中的终端 shell 发起且启动器已返回
- **WHEN** 关闭该终端会话（不得使用递归 taskkill 模拟关闭终端）
- **THEN** Host 仍监听且无额外可见控制台；仅针对测试拥有的进程做清理

#### Scenario: 缺归属探测工具时明确拒绝
- **GIVEN** POSIX 环境缺 lsof 或 Windows 的归属查询不可用
- **WHEN** 执行 start、stop 或 restart
- **THEN** 在副作用前非零退出并指出该平台探测前提和补齐方式，不隐式安装、不降级为仅凭端口可连接认定 DSH

#### Scenario: 端口未知占用或新进程早退
- **GIVEN** 目标端口由非 DSH 服务占用，或本次 Host 桩启动后立即非零退出
- **WHEN** 发起 start
- **THEN** 启动器在就绪预算内非零退出并区分占用/早退原因，不打开 UI，不终止无关进程

### Requirement: 迁移以同一行为断言和真实平台验收收口

迁移 SHALL 先等价拆分 Bash 原子能力，再补齐与实现无关的行为测试，随后迁移并用同一组可移植断言验证 `.mjs` 版本；新增或修正行为 SHALL 先有失败测试，不得为迁移而删除安全断言。最终产品命令 SHALL 只有一套编排实现，不按平台长期保留 Bash 产品分支。支持声明 SHALL 以原生 Windows、macOS、Linux 的实际测试、根安装、link 与命令生命周期检查为依据；Windows 测试不得依赖 runner 自带 Git Bash 掩盖问题。默认公开 manifest 的完整 build×2、dump 与隔离 Host 启动/停止必须单独验证；无法完成时 SHALL 如实报告兼容缺口，不宣称完整仓库支持。

#### Scenario: Bash 与新实现复用契约
- **GIVEN** 拆分后的 Bash 已通过固定命令及原子能力契约，新实现尚未切换
- **WHEN** 将测试执行适配器改为新实现并跑相同用例
- **THEN** 可移植断言不变且全部通过；平台专属与批准行为变化另有测试，切换后用户命令不调用 Bash 产品逻辑

#### Scenario: Windows 真实链路失败不能以桩通过放行
- **GIVEN** 契约桩测试通过，但原生 Windows 的完整公开 manifest build 或 Host 启动失败
- **WHEN** 评估交付状态
- **THEN** Windows 完整支持验收保持未通过，报告包含失败命令和缺口；不跳过该检查或用 WSL 结果替代
