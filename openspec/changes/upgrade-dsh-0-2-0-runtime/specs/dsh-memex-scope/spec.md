## MODIFIED Requirements

### Requirement: 配置经 DSH settings 承载，不自建配置文件

scope 表与绑定集合 SHALL 由所 pin 运行体的官方插件配置机制承载。该机制负责分层解析、外部编辑与校验。在只提供 settings namespace 的运行体上，SHALL 注册为一个 DSH settings namespace；在由 profile 持有插件配置的运行体上，SHALL 作为本插件 loader 行的配置声明，并经官方配置表单读写。无论哪种承载方式，系统都 MUST NOT 自建独立的配置文件与解析器。

配置**缺失**时，系统 SHALL 使用 schema 默认（仅 `personal`，允许自动派生）并正常服务。

**加载时**配置存在但不合法，插件 SHALL 拒绝发布，工具与生命周期接入 MUST NOT 发布。

**运行中**外部编辑产生不合法配置时，系统 SHALL 遵循官方语义：继续使用上一份已验证的 last-good 配置并告警，MUST NOT 静默降级到 schema 默认，因为后者可能把业务内容路由进错误的库。该状态由官方配置机制拒绝提交，不触发工具层配置替换。

承载方式随运行体切换时，用户既有的 scope 表与绑定集合 SHALL 无损迁移到新承载位置。迁移后的生效配置 MUST 与迁移前逐项一致，迁移失败时 MUST NOT 以 schema 默认继续服务。

#### Scenario: 分节缺失时用默认配置
- **WHEN** 承载位置中不存在本插件配置（settings 分节或 loader 行 config）
- **THEN** 系统以「仅 personal + 自动派生」正常服务，不报错

#### Scenario: 启动时配置不合法则不发布工具
- **WHEN** 加载时的配置含重复 scope 名、无法编译的 remote 模式，或绑定引用不存在的 scope
- **THEN** 插件拒绝发布，记忆工具与生命周期接入均不发布，并指出失败的配置项

#### Scenario: 运行中非法编辑保留 last-good
- **WHEN** 工具已发布后，外部把配置编辑成不合法内容
- **THEN** 官方配置机制拒绝该次更新，保留上一份已验证配置并告警；工具继续按 last-good 路由，MUST NOT 使用非法值，也 MUST NOT 退回 schema 默认

#### Scenario: 运行体切换承载方式时配置无损迁移
- **WHEN** 运行体从 settings namespace 承载切换为 profile 持有的插件配置，且用户已有自定义 scope 表与绑定
- **THEN** 切换后的生效配置与切换前逐项一致；工作区路由、主入口与记忆开关的结果不变

#### Scenario: 配置迁移失败时 fail closed
- **WHEN** 迁移过程无法读取或校验原有配置
- **THEN** 插件不发布记忆工具并给出可诊断说明，MUST NOT 以 schema 默认继续服务
