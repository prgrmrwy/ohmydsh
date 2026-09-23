## ADDED Requirements

### Requirement: 本地 manifest overlay 追加不可公开定制

仓库可(MAY)存在一个**本地 manifest overlay**:默认路径为仓库根 `dsh.yaml.local`,或由环境变量 `DSH_LOCAL_MANIFEST` 指定的绝对路径(该变量非空白时**取代**默认路径,而非叠加)。该文件必须(SHALL)被版本控制忽略,用于承载不可公开的定制(内网包、内网采集器、含本机绝对路径的片段)。

overlay 的内容结构必须(SHALL)与 `dsh.yaml` 的 `customizations` **同构**:顶层为映射,其 `customizations` 为定制条目列表,每个条目的字段语义、校验规则与公开 manifest 完全一致(含 `note`、`brief`、`enabledEnv`、`hostRuntimeCompatibility` 等)。overlay 条目的审查记录随条目留在该文件内,公开 manifest 不得(SHALL NOT)为其保留任何占位、计数或存在性声明。

overlay 的权限边界必须(SHALL)是**只追加定制条目**:

- overlay 不得(SHALL NOT)声明 `dshVersion`、`autoUpdate`、`web`、`agentInstructions`、`dependencies` 或除 `customizations` 之外的任何顶层字段;出现此类字段时 sync 必须(SHALL)在加载阶段报错并以非零退出码结束,不产生任何物化动作。
- overlay 条目的 `id` 与公开 manifest 中任一条目的 `id` 相同时,sync 必须(SHALL)报错并以非零退出码结束;overlay 不得(SHALL NOT)覆盖、改写或禁用公开 manifest 中的条目。
- overlay 条目之间的 `id` 重复同样必须(SHALL)报错。

overlay 条目必须(SHALL)走与公开条目**完全相同**的校验与安全路径,不得(SHALL NOT)因来源是本地文件而放宽:逐字段类型与命名校验、`source: remote` 的精确版本 pin 要求、`deps` 引用完整性,以及 `hostRuntimeCompatibility` 的运行体版本围栏。该围栏必须(SHALL)在任何 profile 或部署面操作之前完成校验。

合并结果必须(SHALL)是所有消费方的唯一事实来源:物化(sync)、启动清单、插件升级检查与运行体版本围栏必须(SHALL)看到同一份合并后的定制列表,不得(SHALL)出现「已物化但清单不可见」或「已物化但升级检查不覆盖」的分裂状态。

overlay 缺失是**常态而非错误**:文件不存在时 sync 必须(SHALL)静默按公开 manifest 运行,行为与未引入本能力时完全一致。文件存在但无法读取或解析时,必须(SHALL)报错并以非零退出码结束,不得静默跳过。

#### Scenario: overlay 缺失时行为不变
- **WHEN** 仓库不存在 `dsh.yaml.local` 且未设置 `DSH_LOCAL_MANIFEST`
- **THEN** sync 仅按 `dsh.yaml` 物化,不报错、不产生额外输出,结果与未引入 overlay 能力时一致

#### Scenario: overlay 条目被追加物化
- **WHEN** overlay 声明一条启用的定制,其 id 不与公开 manifest 冲突
- **THEN** 该定制按其类型被物化(package 安装 / patch 行合并 / preset·skill 复制),与写在公开 manifest 中的同一条目物化结果不可区分

#### Scenario: overlay 条目出现在启动清单与升级检查
- **WHEN** overlay 声明了一条启用的 remote package 定制
- **THEN** 启动清单列出该定制,且插件升级检查覆盖该定制的版本 pin

#### Scenario: id 与公开 manifest 冲突时拒绝运行
- **WHEN** overlay 条目的 `id` 与 `dsh.yaml` 中某条目的 `id` 相同
- **THEN** sync 在加载阶段报错并以非零退出码结束,指明冲突的 id,不物化任何变更

#### Scenario: overlay 声明顶层字段时拒绝运行
- **WHEN** overlay 声明了 `dshVersion`、`autoUpdate`、`web`、`agentInstructions`、`dependencies` 或其他非 `customizations` 的顶层字段
- **THEN** sync 在加载阶段报错并以非零退出码结束,指明越权字段,不物化任何变更

#### Scenario: overlay 条目不因来源而放宽校验
- **WHEN** overlay 条目缺少必填字段、`source: remote` 缺少精确版本 pin,或其 `hostRuntimeCompatibility` 与当前 `dshVersion` 不符
- **THEN** sync 以与公开 manifest 中同类错误相同的方式报错并以非零退出码结束,且在任何 profile 操作之前发生

#### Scenario: overlay 存在但不可解析时拒绝运行
- **WHEN** overlay 文件存在但无法读取,或不是合法 YAML 映射
- **THEN** sync 报错并以非零退出码结束,不静默跳过该层

#### Scenario: 环境变量指定 overlay 路径
- **WHEN** 设置 `DSH_LOCAL_MANIFEST` 为一个存在的 overlay 绝对路径
- **THEN** sync 读取该路径作为 overlay,且不再读取仓库根的 `dsh.yaml.local`

#### Scenario: 公开 manifest 不承载不可公开定制的痕迹
- **WHEN** 某定制因不可公开而由 overlay 承载
- **THEN** 公开 `dsh.yaml` 中不存在该定制的条目、包名、内部地址或存在性声明

#### Scenario: 含 overlay 时 sync 仍幂等
- **WHEN** 存在 overlay 且仓库与 overlay 均无变更,连续运行 sync 两次
- **THEN** 第二次运行报告无任何变化
