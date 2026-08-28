# launcher-npm-environment Specification

## Purpose

约束 `dsh` 启动器对 npm 环境变量的作用域：启动器为保证「版本检测与安装同源」而选择的 registry 只能作用于它自己发起的 npm 操作，不得随 DSH server 继承进 agent 会话，从而污染用户在其他仓库执行的包管理命令。

## Requirements

### Requirement: registry 注入只作用于启动器自身的 npm 操作

启动器为自身发起的 npm/npx/pnpm 调用选定 registry 时，必须(SHALL)以单次调用为作用域注入，不得(SHALL NOT)将 `npm_config_registry` 导出到启动器自身的进程环境，也不得(SHALL NOT)使其被后续无关子进程继承。仓库 `.npmrc` 中声明的 registry 仍是启动器自身 npm 操作的默认取值来源，`startup-autoupdate` 要求的「版本检测与安装走同一来源」必须(SHALL)继续成立。

#### Scenario: 启动器自身的安装走仓库 registry

- **WHEN** 启动器执行版本检测或安装 DSH CLI
- **THEN** 该次 npm/npx/pnpm 调用使用仓库 `.npmrc` 声明的 registry，与版本检测来源一致

#### Scenario: 注入不进入启动器进程环境

- **WHEN** 启动器完成 registry 选定后继续执行其余启动步骤
- **THEN** 启动器进程自身的环境中不存在由启动器导出的 `npm_config_registry`

### Requirement: 拉起 DSH server 前剥离继承的 npm 环境变量

启动器通过 `npm exec` / `npx` 被拉起时，npm 会把解析后的配置物化为一批 `npm_*` 环境变量。启动器在拉起 DSH server 进程前必须(SHALL)从传给 server 的环境中移除这批由包管理器隐式注入的变量，至少(SHALL)覆盖 `npm_config_*`、`npm_lifecycle_*`、`npm_package_*`、`npm_command`、`npm_execpath`、`npm_node_execpath`。前台与后台两种启动路径必须(SHALL)应用相同的剥离规则。

#### Scenario: agent 会话看到用户级 npm 配置

- **WHEN** 用户 `~/.npmrc` 声明内网 registry，经 `dsh` 启动 server 后在 agent 会话中于仓库外目录执行 `npm config get registry`
- **THEN** 得到用户 `~/.npmrc` 声明的 registry，而非仓库 `.npmrc` 的取值

#### Scenario: engine-strict 不泄漏到无关仓库

- **WHEN** 在 agent 会话中于一个未开启 `engine-strict` 的第三方仓库执行 npm 安装
- **THEN** 不因继承自 DSH 启动链的 `npm_config_engine_strict` 而触发 engines 校验失败

#### Scenario: 前台与后台启动一致

- **WHEN** 分别以前台模式与后台模式启动 server，并在各自的 agent 会话中检查 npm 环境
- **THEN** 两种模式下被剥离的变量集合一致

### Requirement: 用户显式设置的 registry 覆盖必须保留

用户在调用启动器之前于自身 shell 中显式设置的 `npm_config_registry` 或 `NPM_CONFIG_REGISTRY` 表达明确意图，必须(SHALL)被保留并透传给 DSH server 与其 agent 会话，不得(SHALL NOT)被剥离规则移除。启动器必须(SHALL)能区分「用户显式设置」与「`npm exec` 隐式烘焙」两个来源；无法区分时必须(SHALL)保守地按隐式处理并剥离，以免把仓库取值伪装成用户意图。

#### Scenario: 显式覆盖透传

- **WHEN** 用户执行 `npm_config_registry=https://example.test/ dsh` 并在 agent 会话中查询 registry
- **THEN** 得到 `https://example.test/`

#### Scenario: 隐式烘焙值不被误认为用户意图

- **WHEN** 用户未设置任何 registry 环境变量，仅经 `npx` 拉起启动器
- **THEN** `npm exec` 烘焙出的 `npm_config_registry` 被剥离，agent 会话回落到 `.npmrc` 体系
