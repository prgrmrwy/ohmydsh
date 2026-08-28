## ADDED Requirements

### Requirement: sync 自行确保目标 profile 骨架存在

sync 必须(SHALL)在物化任何 package 类定制或执行 reset 之前,确保目标 profile 目录下存在可用的 profile manifest。当该 manifest 不存在时,sync 必须(SHALL)自行将其物化,不得(SHALL NOT)要求用户先以其他方式启动过 DSH,也不得把该前置的缺失表述为 package 物化失败。

profile 骨架的内容必须(SHALL)以所 pin 的 DSH 运行体自身的 profile 模板为真相源。仓库不得(SHALL NOT)保存一份独立的 profile 模板副本,以免运行体升级后二者产生偏差。

该步骤必须(SHALL)幂等:manifest 已存在时不得触碰任何既有文件,不得改写既有 bundle 列表、依赖或用户 patch 层,且必须使该次运行在部署面上表现为空操作。

该步骤必须(SHALL)fail closed:骨架无法物化时,sync 必须报告该失败本身并以非零退出码结束,使首因可见;不得(SHALL NOT)在骨架缺失的情况下继续以"逐个 package 安装失败"的形式暴露次生错误。

#### Scenario: 全新环境首次物化
- **WHEN** 用户在不存在 `$DSH_HOME` profile 骨架的机器上首次运行 sync
- **THEN** sync 按运行体模板物化该 profile 骨架,并在同一次运行内完成 manifest 中全部启用定制的物化,不报告 profile manifest 缺失

#### Scenario: 骨架物化先于 package 安装
- **WHEN** sync 在同一次运行中既需要物化 profile 骨架,又需要安装 package 定制
- **THEN** 骨架物化先于任何 package 安装动作发生,使这些安装在已就绪的 profile 上执行

#### Scenario: 骨架已存在时为空操作
- **WHEN** 目标 profile manifest 已存在且部署面与 manifest 一致
- **THEN** sync 不重新初始化该骨架,不修改其内容,并报告无任何变化

#### Scenario: 全新环境执行 reset
- **WHEN** 用户在不存在 profile 骨架的机器上执行 sync 的 reset 动作
- **THEN** sync 先物化骨架再执行 reset,不报告 profile manifest 缺失

#### Scenario: 骨架无法物化
- **WHEN** profile manifest 缺失且 sync 无法物化骨架(如目标版本运行体不可用)
- **THEN** sync 报告骨架初始化失败并以非零退出码结束,错误信息指明目标 profile 与其目录

### Requirement: sync 按 manifest 承诺核验已部署 package 的完整性

判断某个 package 是否需要重新物化时,sync 不得(SHALL NOT)仅依据元数据(已部署 `package.json` 的 version、源码内容哈希、记录的 install spec)或安装命令的退出码。安装命令的退出码只证明安装动作**执行过**,不证明产物**已到位**。sync 必须(SHALL)核验该 package 的 manifest 所承诺的运行时文件确实存在于部署面,并在缺失时重新物化。该核验必须(SHALL)同等适用于 `local` 与 `remote` 来源,以及首次安装与后续运行。

所核验的文件集合必须(SHALL)由 manifest 自身推导(`main`、`exports`、`dsh.bundle.patch`),并必须(SHALL)保守取值:条件映射按运行时实际选用的条件**首个匹配**解析,不得取所有分支的并集;通配符子路径、`null` 目标、目录目标与 fallback 数组不得产生具体文件要求;类型声明(`types`/`typings`)不属于运行时文件。健康的 package 不得(SHALL NOT)被误判为残缺。

修复必须(SHALL)保证失败后的部署面不劣于修复前:sync 不得(SHALL NOT)在重装成功之前删除既有部署副本,使"残缺"退化为"缺失";若修复过程中需要移除既有副本,必须(SHALL)在失败时将其复原,且不得遗留中间目录。

当某 package 的来源本身无法满足其 manifest(如发布物残缺)时,重装无法收敛。sync 必须(SHALL)以非零退出码报告该情况,并且不得(SHALL NOT)在后续每次运行中重复执行注定失败的安装;当该 package 的身份(版本或 spec)发生变化时,必须(SHALL)重新尝试。

#### Scenario: 部署副本缺失入口文件
- **WHEN** 某已部署 package 的 `package.json` 完好,但其 manifest 承诺的运行时文件缺失(如安装被中断)
- **THEN** sync 报告该部署残缺并重新物化,使缺失文件恢复;而不是报告 `up-to-date`

#### Scenario: 自愈后保持幂等
- **WHEN** 残缺部署已被修复且此后无任何变更
- **THEN** 后续 sync 报告无变化,且不再发起安装

#### Scenario: 健康部署不被误判
- **WHEN** 部署面完整,其中包含仅声明类型条件、通配符子路径或 ESM 专用而仍声明 `require` 分支的 package
- **THEN** sync 不将其判定为残缺,该次运行在部署面上为空操作

#### Scenario: 修复失败不劣化部署面
- **WHEN** 针对残缺 package 的重装因外部原因(如网络中断)失败
- **THEN** sync 以非零退出码报告失败,原有部署副本保持原样而非被删除,且不遗留中间目录

#### Scenario: 来源自身残缺
- **WHEN** 某 package 的来源无法满足其 manifest,重装后仍缺少承诺的文件
- **THEN** sync 以非零退出码报告该 package 无法通过重装修复;在其身份未变化前,后续运行不再重复安装
