## ADDED Requirements

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
