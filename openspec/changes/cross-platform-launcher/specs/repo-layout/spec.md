## MODIFIED Requirements

### Requirement: 仓库初始化按最低版本准则校验 Node/npm 工具链

仓库初始化 SHALL 提供无需预装仓库依赖或 Bash 即可执行的 Node 入口，按根 `package.json` 的 engines 最低版本校验 Node/npm。低于最低值 SHALL 拒绝并给出指引，不低于时 SHALL 放行；`.nvmrc` SHALL 继续作为推荐版本单一来源，不匹配仅提示。检查不得依赖尚未安装的 zx/semver，不得为了 `.mjs` 改写人为提高 Node 最低值；真实运行体或依赖更高要求另行按实际约束校验，不伪称较低版本可完成完整 build。

版本比较不再要求 Bash 实现。Windows 的 npm 检查与安装 SHALL 不依赖 Git Bash。锁定安装 SHALL 采用根 lock 的 `npm ci`，与 npm link 命令注册分离；健康依赖重复初始化不重复安装，显式 force 可重装。仓库 SHALL NOT 在 engines 外用 packageManager 等字段声明冲突的精确包管理器版本；不写 nested lock。安装失败 SHALL 非零返回，不继续报告初始化成功或修改全局 bin。

Node 缺失时无法运行 Node 初始化入口，安装文档 SHALL 提供最低版本和安装方式；若保留旧 POSIX wrapper，它 SHALL 在 exec 前对缺 Node 提示，不承担另一份初始化逻辑。

#### Scenario: 高于最低版本但不等于推荐版本
- **GIVEN** 实际 Node/npm 满足最低值但与 .nvmrc 不同
- **WHEN** 执行初始化
- **THEN** 提示推荐值并安装缺失根依赖，退出码为 0

#### Scenario: 低于最低版本
- **GIVEN** Node 或 npm 低于 engines 最低值
- **WHEN** 执行初始化
- **THEN** 非零退出，报告实际版本、最低值与升级指引，未运行 npm ci

#### Scenario: 工具链缺失
- **GIVEN** PATH 中没有 npm，或没有 node
- **WHEN** 分别执行 Node 初始化入口，或检查安装指引/运行保留的 POSIX wrapper
- **THEN** 缺 npm 的初始化非零且给出安装说明；缺 Node 的文档含最低值与下载指引，wrapper 存在时也在非零退出前给出同类提示

#### Scenario: 最低版本声明保持单一准则
- **GIVEN** engines、初始化实现和安装文档均可读取
- **WHEN** 执行一致性检查
- **THEN** 最低版本描述一致，无冲突的精确 packageManager 字段；推荐版本不被当成必须相等值

#### Scenario: 重复初始化与安装失败
- **GIVEN** 一次初始化完成；另一个隔离 fixture 的 npm ci 被设为失败
- **WHEN** 对前者重复初始化，对后者首次初始化
- **THEN** 前者不再安装，后者非零退出且未注册全局 bin或报告成功

### Requirement: manifest 消费脚本自行读取 .env.local 中决定部署内容的变量

sync、插件升级检查/自动升级、启动清单三个 manifest 消费脚本启动时，必须(SHALL)读取所在仓库根目录的 `.env.local`（存在时）。读取只针对**决定部署内容的变量**：`DSH_LOCAL_MANIFEST`，以及合并 overlay 后 manifest 中各定制 `enabledEnv` 声明的变量名。

读取与填充规则：

- 其余变量（含 `DSH_HOME`、`DSH_PROFILE`、`DSH_BIN`）必须(SHALL NOT)不因本要求被读取或设置。
- 调用方环境中已设置的变量（含空字符串）必须(SHALL)优先，不得(SHALL NOT)被 `.env.local` 覆盖。
- `.env.local` 必须(SHALL)按字面值解析，不得(SHALL NOT)执行 shell。
  - 支持 `KEY=VALUE`、`export KEY=VALUE`、单引号字面值、双引号值与 `#` 注释。

白名单变量的值无法按字面值确定时，按以下规则处理。无法确定的情形包括：未加引号或双引号内含 `$` 或反引号、未加引号且以 `~` 开头、引号未闭合。

- sync 与插件升级必须(SHALL)报错并以非零退出码结束。
  - 错误信息指明文件、行号与变量名，不得(SHALL NOT)包含该值。
  - `$DSH_HOME` 不发生任何变化。
- 启动清单必须(SHALL)忽略该值，在标准错误输出说明原因，并以退出码 0 结束。

来源提示：sync 每采用一个来自 `.env.local` 的值，必须(SHALL)在输出中注明变量名与来源为 `.env.local`，不得(SHALL NOT)打印该值。

#### Scenario: 裸跑 sync 采用 .env.local 中的 overlay 路径
- **GIVEN** 仓库根 `.env.local` 含 `export DSH_LOCAL_MANIFEST=<R>/dsh.yaml`，该 overlay 声明启用的定制 `q`，调用方环境未设置 `DSH_LOCAL_MANIFEST`
- **WHEN** 直接运行 `node scripts/sync.mjs`
- **THEN** `q` 被物化，输出包含 `DSH_LOCAL_MANIFEST` 与 `.env.local`，且不包含 `<R>`
- **AND** 连续第二次运行不产生变化

#### Scenario: 调用方显式设置的值优先
- **GIVEN** `.env.local` 设置 `DSH_LOCAL_MANIFEST=<R>/dsh.yaml`，调用方环境设置 `DSH_LOCAL_MANIFEST=`（空字符串）
- **WHEN** 运行 sync
- **THEN** 不加载 `<R>` 下的 overlay

#### Scenario: .env.local 中的 enabledEnv 开关生效
- **GIVEN** 某定制 `enabled: false` 且声明 `enabledEnv: DSH_XXX`，`.env.local` 含 `DSH_XXX=1`，调用方环境未设置 `DSH_XXX`
- **WHEN** 直接运行 sync
- **THEN** 该定制按启用物化

#### Scenario: overlay 条目声明的 enabledEnv 同样从 .env.local 读取
- **GIVEN** `.env.local` 设置 `DSH_LOCAL_MANIFEST` 指向的 overlay 中某条目 `enabled: false` 且声明 `enabledEnv: DSH_YYY`，`.env.local` 含 `DSH_YYY=1`
- **WHEN** 直接运行 sync
- **THEN** 该 overlay 条目按启用物化

#### Scenario: 非白名单变量不被读取
- **GIVEN** `.env.local` 含 `DSH_HOME=/elsewhere`，调用方环境设置了另一个 `DSH_HOME`
- **WHEN** 运行 sync
- **THEN** 部署目标仍是调用方的 `DSH_HOME`，`/elsewhere` 下不产生任何文件

#### Scenario: 白名单变量含 shell 展开时 sync 拒绝运行
- **GIVEN** `.env.local` 含 `DSH_LOCAL_MANIFEST=$HOME/private/dsh.yaml`，调用方环境未设置该变量
- **WHEN** 运行 sync
- **THEN** sync 以非零退出码结束，错误信息包含 `.env.local`、行号与 `DSH_LOCAL_MANIFEST`，`$DSH_HOME` 下文件树不变

#### Scenario: 白名单变量含 shell 展开时启动清单降级
- **GIVEN** 同上的 `.env.local`
- **WHEN** 运行启动清单
- **THEN** 清单以退出码 0 结束，不列出 overlay 条目，标准错误输出包含 `DSH_LOCAL_MANIFEST`

#### Scenario: 非白名单行的 shell 语法不影响运行
- **GIVEN** `.env.local` 含 `DSH_OPEN_APP="$HOME/Applications/X.app"` 与 `DSH_LOCAL_MANIFEST='<R>/dsh.yaml'`
- **WHEN** 运行 sync
- **THEN** sync 成功，并按 `<R>/dsh.yaml` 加载 overlay

启动器与上述裸 manifest 消费脚本 SHALL 共用内置模块可加载的词法解析器，但采用显式的严格/白名单兼容模式。启动器严格校验全文件；裸脚本保持本要求的白名单、调用者优先和宽容非白名单行语义，不执行任何 Shell。文档 SHALL 明确同一个含非白名单 Shell 表达式的文件可以被裸 sync 接受而被 dsh build 拒绝，不能用“统一解析”静默扩大裸脚本读取范围。

#### Scenario: 严格启动入口与白名单裸入口边界明确
- **GIVEN** 文件包含非法非白名单 Shell 行与合法部署白名单值
- **WHEN** 分别调用 dsh build 与裸 node scripts/sync.mjs
- **THEN** 前者副作用前拒绝；后者按白名单正常执行且不应用非法行，共享解析模块不改变各入口覆盖优先级
