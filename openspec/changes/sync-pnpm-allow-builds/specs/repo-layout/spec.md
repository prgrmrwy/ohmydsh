## ADDED Requirements

### Requirement: profile 构建脚本授权由 manifest 声明并由 sync 物化

manifest 可(MAY)在顶层声明 `pnpmAllowBuilds`：依赖名到布尔值的映射，表示是否允许该依赖在 profile 安装时执行构建脚本。sync 必须(SHALL)在加载阶段校验该字段：必须是映射，键为非空字符串，值必须是 `true` 或 `false`；任何不合规都必须在 `$DSH_HOME` 发生任何变化之前报错并以非零退出码结束，错误信息指明 `pnpmAllowBuilds` 与出错的键。

sync 必须(SHALL)在任何插件安装或移除动作之前，把每个声明的决定写入目标 profile `pnpm-workspace.yaml` 的 `allowBuilds` 段。该文件中的其它内容，以及 manifest 未声明、sync 也未曾写入过的 `allowBuilds` 条目，必须(SHALL)原样保留。部署值与声明一致时不得改写文件，该次运行在此项上必须为空操作。

sync 必须(SHALL)在部署账本中记录自己写入的条目及其值。当某个条目不再由 manifest 声明时，若其部署值仍等于账本记录值，sync 必须(SHALL)移除该条目；若部署值已被改动，sync 必须(SHALL)保留它并报告漂移，不得删除。

写入之后、任何安装之前，若 `allowBuilds` 中仍存在值不是布尔的条目（如 pnpm 写入的 `set this to true or false` 占位符），sync 必须(SHALL)报错并以非零退出码结束：错误信息一次性列出全部未决定的依赖名，指明 profile 中该文件的路径，并要求先审查这些依赖的安装脚本、再在 `dsh.yaml` 的 `pnpmAllowBuilds` 中声明决定。此时 sync 不得(SHALL NOT)执行任何插件安装。

某次插件安装或移除失败后，若该 profile 的 `allowBuilds` 中出现了新的未决定条目，sync 必须(SHALL)停止本次运行中剩余的全部插件安装与移除，并以非零退出码结束，报告与上一段相同形式的首因错误，不得(SHALL NOT)继续逐个报告次生安装失败。

sync 不得(SHALL NOT)把任何未在 manifest 中声明的依赖自动设为 `true` 或 `false`。

#### Scenario: 全新 profile 首次物化声明的授权
- **GIVEN** manifest 声明 `pnpmAllowBuilds: { protobufjs: false }`，目标 profile 的 `pnpm-workspace.yaml` 不含 `allowBuilds`
- **WHEN** 运行 sync
- **THEN** 在任何插件安装之前，该文件的 `allowBuilds` 含 `protobufjs: false`，文件其它内容保持不变

#### Scenario: 声明与部署一致时为空操作
- **GIVEN** profile 的 `allowBuilds` 已与 manifest 声明完全一致
- **WHEN** 运行 sync
- **THEN** `pnpm-workspace.yaml` 与运行前逐字节相同，sync 不就此项报告变化

#### Scenario: 用户自行添加的条目被保留
- **GIVEN** profile 的 `allowBuilds` 含 manifest 未声明、账本也无记录的条目 `foo: true`
- **WHEN** 运行 sync
- **THEN** `foo: true` 保持原样

#### Scenario: 从 manifest 删除的条目被撤销
- **GIVEN** 上一次 sync 写入了 `protobufjs: false` 并记入账本，之后该条目从 manifest 删除，部署值未被改动
- **WHEN** 运行 sync
- **THEN** `allowBuilds` 中不再含 `protobufjs`

#### Scenario: 被手动改动的已删除条目被保留
- **GIVEN** 上一次 sync 写入了 `protobufjs: false`，之后用户手动将其改为 `true`，并从 manifest 删除该条目
- **WHEN** 运行 sync
- **THEN** `protobufjs: true` 保持原样，sync 报告该条目的漂移

#### Scenario: 存在未决定条目时在安装前拒绝运行
- **GIVEN** profile 的 `allowBuilds` 含 `'@google/genai': set this to true or false`，manifest 未声明 `@google/genai`
- **WHEN** 运行 sync
- **THEN** sync 以非零退出码结束，错误信息包含 `@google/genai`、该 `pnpm-workspace.yaml` 的路径与 `pnpmAllowBuilds`，profile `package.json` 与运行前逐字节相同

#### Scenario: manifest 声明消解了占位符
- **GIVEN** profile 的 `allowBuilds` 含 `protobufjs: set this to true or false`，manifest 声明 `protobufjs: false`
- **WHEN** 运行 sync
- **THEN** 占位符被替换为 `false`，sync 继续执行插件安装，不因该条目报错

#### Scenario: 安装中途出现新的未决定条目
- **GIVEN** 某个待安装插件引入了一个带构建脚本、未被声明的依赖，其后还有其它待安装插件
- **WHEN** 运行 sync，该插件安装失败且 pnpm 写入了该依赖的占位符
- **THEN** sync 不再尝试其余插件的安装，以非零退出码结束，错误信息指明该依赖名与 `pnpmAllowBuilds`

#### Scenario: 非法声明在任何变更前被拒绝
- **GIVEN** manifest 声明 `pnpmAllowBuilds: { protobufjs: 'no' }`
- **WHEN** 运行 sync
- **THEN** sync 在加载阶段以非零退出码结束，错误信息指明 `pnpmAllowBuilds` 与 `protobufjs`，`$DSH_HOME` 无任何变化
