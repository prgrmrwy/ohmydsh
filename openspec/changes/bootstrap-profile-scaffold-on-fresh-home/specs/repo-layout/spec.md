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
