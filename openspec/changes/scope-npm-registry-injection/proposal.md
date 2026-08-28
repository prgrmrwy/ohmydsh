## Why

`bin/dsh` 为了让 autoUpdate 的版本检测与安装走同一个源，`export npm_config_registry` 到整个启动器进程；`npm exec` 拉起 DSH server 时又把解析后的完整配置（含仓库 `.npmrc` 的 `registry` 与 `engine-strict`）物化成 `npm_config_*` 传给子进程。这批变量被 DSH server 继承，再继承给 agent bash，最终污染用户在**任意仓库**执行的 npm/pnpm/rush 命令——环境变量优先级高于所有 `.npmrc`，所以内网镜像用户会在拉取内网包时拿到 npmjs 404。

实测：同一个 `/tmp` 目录下，继承 DSH 环境时 `npm config get registry` 为 `https://registry.npmjs.org/`，清空 `npm_config_*` 后为用户 `~/.npmrc` 的 `https://bnpm.byted.org`。`engine-strict=true` 同样泄漏，会让第三方仓库的 `npm install` 因 `engines` 不匹配而硬失败。

## What Changes

- `bin/dsh` 不再进程级 `export npm_config_registry`；registry 注入收窄为只作用于启动器自身发起的 npm/npx/pnpm 调用（命令前缀形式），不进入启动器的长期进程环境。
- 拉起 DSH server（`start_server` 的前台与后台两条路径）前，剥离整批从 `npm exec` 继承来的 npm 环境变量（`npm_config_*`、`npm_lifecycle_*`、`npm_package_*`、`npm_command`、`npm_execpath`、`npm_node_execpath`），使 agent bash 拿到与用户自开终端一致的 npm 环境。
- 保留逃生门：用户在调用 `dsh` 前**显式**设置的 `npm_config_registry` / `NPM_CONFIG_REGISTRY` 视为用户意图，继续透传进 server 与 agent；被剥离的只有 `npm exec` 隐式烘焙的那批。
- `scripts/lib/dsh-cli.mjs` 的 `installEnv()` 保持既有语义（它本就只作用于单次 `spawnSync`，不泄漏），但需与新的显式覆盖判定保持一致。
- **非破坏性**：autoUpdate 的版本检测与 DSH CLI 安装仍固定走 npmjs，行为不变。

## Capabilities

### New Capabilities
- `launcher-npm-environment`: 启动器如何为自身 npm 操作选择 registry，以及在拉起 DSH server 时对 npm 环境变量的边界与剥离规则，含用户显式覆盖的保留语义。

### Modified Capabilities
<!-- 无。startup-autoupdate 的检测/升级行为不变；本变更只约束注入作用域，不改变「检测与安装同源」这一既有要求。 -->

## Impact

- `bin/dsh`：删除 62-67 行的进程级 export；`start_server` 两处 `npx -y @deepseek-ai/dsh@$VER web` 调用点增加环境剥离；其余自身 npm/npx 调用点改为按调用注入。
- `scripts/lib/dsh-cli.mjs`：`installEnv()` 的显式覆盖判定与启动器统一。
- `tests/`：新增启动器环境边界测试（注入作用域、剥离清单、显式覆盖保留）。
- 运行时影响：DSH server 与全部 agent bash 会话的 npm 环境。已在运行的 server 需重启才能生效。
- 不影响：`~/.npmrc`、仓库 `.npmrc`、`dsh.yaml`、任何已物化的 `~/.dsh` 产物。
