## MODIFIED Requirements

### Requirement: 运行体迁移的审计面必须覆盖宿主与客户端两个半区
运行体主版本迁移前的调研必须(SHALL)同时审计**宿主(host)半区与客户端(client)半区**的 API 破坏面,并对每个受影响的自研包分别给出两个半区的改动量结论。审计面不得(SHALL NOT)因某个被移除的运行体包"看起来只属于客户端"而被缩小到单一半区——包的归属不能推断出破坏面的归属。

调研结论必须(SHALL)在**声明"改动量可接受"之前**,以受影响包的实际构建结果验证;仅凭类型声明或依赖清单推导出的结论不构成(SHALL NOT constitute)充分证据。对于仓库内全部声明 `@deepseek-ai/dsh-*` runtime dependency、devDependency 或 peerDependency 的 local package，迁移验收 SHALL 覆盖其实际 build、typecheck、test 与运行时接线；只修改版本范围或 lockfile 不构成兼容证据。

#### Scenario: 被移除的包归属某一半区
- **WHEN** 某运行体包在新版本族中被移除,且该包按命名或用途归属客户端半区
- **THEN** 调研 SHALL 仍然审计宿主半区的破坏面,MUST NOT 以该包的归属为由跳过宿主侧审计

#### Scenario: 改动量结论未经构建验证
- **WHEN** 调研得出"仅需修改声明、无需改写调用形态"一类结论
- **THEN** 该结论 SHALL 在受影响包实际构建通过后才被视为成立,MUST NOT 仅凭类型声明推导即进入执行阶段

#### Scenario: 审计发现的破坏面超出预估
- **WHEN** 执行中出现调研未覆盖的破坏点
- **THEN** 系统 SHALL 停止执行并将该破坏点补记为调研产出,MUST NOT 在未更新调研结论的情况下继续推进

#### Scenario: local package 仅改写运行体范围
- **WHEN** local package 的运行体声明已改到目标版本族但其 build、typecheck、test 或实际接线尚未验证
- **THEN** 该 package SHALL 保持未通过迁移验收，MUST NOT 因依赖解析成功而视为兼容

### Requirement: 依赖项在新版本族上无法装载时必须并入同一迁移批次
当某个已 pin 的第三方定制在**目标运行体上无法装载**(例如导入了新版本族已移除的符号,导致组合期失败而非功能降级)时,系统必须(SHALL)将该定制的升级识别为运行体迁移的**必要前置**并纳入同一批次,而不是(SHALL NOT)保留为迁移之后的可选步骤。

批次划分依据是**能否装载**,而非该升级本身是否带来新功能:一个「仅为收益」的升级与一个「不升就起不来」的升级,在批次语义上不同。对于客户端定制，manifest inject 图、发布物 bundle 的真实 import/require 以及运行后的功能激活 SHALL 分别验证；stale inject 声明本身不得被误判为致命加载失败，而 bundle 执行失败或静默不激活均不得被忽略。目标版本没有兼容发布物且现有 pin 无法通过上述验证时，该定制 MUST 在运行体批次中显式禁用。

#### Scenario: 既有 pin 在新运行体上组合期失败
- **WHEN** 某第三方定制的现有 pin 在目标运行体上导致组合/加载失败
- **THEN** 该定制的兼容版本升级 SHALL 与运行体变更同批提交,MUST NOT 被排到迁移验收之后

#### Scenario: 升级次序假设被实测推翻
- **WHEN** 设计阶段假定某升级可以后置,而实测证明它是装载前置
- **THEN** 系统 SHALL 更新该设计决策并记录推翻它的证据,MUST NOT 在不修订决策的情况下按新次序执行

#### Scenario: inject 声明滞后但 bundle 可执行
- **WHEN** 客户端定制声明了目标运行体不存在的 inject id，但实际 bundle 的全部 import/require 可解析且功能在隔离实例中实际激活
- **THEN** 系统 MAY 将其记录为声明滞后风险，MUST NOT 仅凭该 inject id 判定 loader 致命失败

#### Scenario: 客户端插件静默不激活
- **WHEN** 客户端定制安装成功且无报错，但目标功能未在隔离实例中出现或不可用
- **THEN** 该定制 SHALL 判定为不兼容，并在运行体批次中升级、修订或显式禁用

## ADDED Requirements

### Requirement: 历史 Session 格式迁移必须用真实数据证明
当目标运行体引入新的 Session 持久格式或迁移链时，系统 SHALL 使用来自当前运行体的真实历史 Session **备份副本**验证相邻格式迁移、恢复写入与 Host 重启后的数据保真。首次打开副本 MAY 发布新 generation，不得把它描述为无副作用只读操作；验证 SHALL 证明旧 generation 保留、新 generation 原子发布、lease 排他、中断后的 generation 选择，并覆盖 Session 身份与标题、workspace/cwd、父子 lineage、模型/provider、assistant 内容、tool call/result 以及迁移后继续提交。

系统 MUST 先对被测持久数据创建可恢复备份并确保候选不打开原始生产源；迁移失败、字段丢失、来源格式不受支持或写所有权无法证明时 SHALL fail closed。仓库不得自行批量改名、重写或覆盖上游 Session 日志来规避官方迁移器。

#### Scenario: 旧 Session 副本迁移并继续写入
- **WHEN** 隔离目标运行体打开一个当前生产版本创建的真实旧 Session 备份副本并恢复执行
- **THEN** 系统 SHALL 通过官方相邻迁移链原子发布 current generation、保留旧 generation 和规定字段，并允许在同一 Session 中继续提交且重启后仍一致

#### Scenario: 迁移无法证明数据保真
- **WHEN** 任一真实样本迁移失败、关键字段丢失或重启后结果不一致
- **THEN** 运行体迁移 SHALL 停止，生产数据不得交给该候选运行体写入

#### Scenario: 操作者尝试手工改写旧日志
- **WHEN** 升级方案试图通过批量改名、格式 restamp 或覆盖旧源文件绕过官方迁移链
- **THEN** 该方案 SHALL 被拒绝，MUST NOT 作为迁移验收证据