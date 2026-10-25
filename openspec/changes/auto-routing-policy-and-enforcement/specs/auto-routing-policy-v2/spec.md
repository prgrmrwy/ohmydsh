## Purpose

为显式启用的 AUTO 试验策略定义职责、独立资源判断与真实执行边界。主 Agent 保留组织与验收权，Jev 按已定义策略判断，AUTO 必须区分推荐与实际生效，避免将默认继承误称为异构路由成功。

## ADDED Requirements

### Requirement: 策略隔离与主模型不变
系统 SHALL 在根会话为 AUTO 时默认运行新策略，缺省与已有未指定 policy 的配置均无需额外启用。设置 SHALL 不显示策略版本选择，旧四档配置 SHALL 保留但只在显式 `policy: legacy` 回滚时使用。MANUAL SHALL 不发生新判档或自动改写；已有会话模式不变。主会话 provider/model MUST NOT 被新策略修改。

#### Scenario: 默认与手动模式隔离
- **WHEN** 显式配置 legacy 回滚，或根会话为 MANUAL
- **THEN** 新策略判档调用数为零，原模式及回滚行为不变

#### Scenario: 已有 AUTO 无需额外启用
- **WHEN** 配置没有 policy 字段且现有根会话为 AUTO
- **THEN** 使用新策略且保留原会话模式、旧映射配置；设置不展示版本开关

#### Scenario: 主会话提高投入
- **WHEN** AUTO 主会话启用试验策略并被判断需要更高投入
- **THEN** 仅在受支持范围内调整 effort，provider/model 不变且同回合稳定

### Requirement: 设置可查看实际策略
设置 SHALL 提供只读“查看决策策略”入口，展示能力与深度判据、模型映射及执行边界。英文判据与能力槽 SHALL 直接复用执行源，不维护第二份规则。展开或折叠 MUST NOT 保存设置、发起模型调用或恢复版本选择。

#### Scenario: 用户展开策略
- **WHEN** 用户在自动模型路由设置展开“查看决策策略”
- **THEN** 可查看当前规则与模型槽，保存按钮状态不因查看而改变

### Requirement: 独立判断能力与投入
系统 SHALL 将子任务能力需求与 effort 投入作为独立维度。明确执行任务 SHALL 以匹配能力模型的推荐 effort 为基线，不因选择轻量模型自动降 effort。主请求与子请求 SHALL 使用各自的问题定义；任务规模或风险 MUST NOT 单独决定推理深度。

#### Scenario: 大量可验证的明确执行
- **WHEN** 子任务是规则明确、有确定测试的批量修改且不存在额外推理难点
- **THEN** 策略允许选择轻量能力槽与推荐 effort，不因文件多自动选择强模型，也不因轻量自动降 effort

#### Scenario: 信息不足
- **WHEN** 子任务缺少可判断的目标或范围
- **THEN** 返回 needs-context，要求补充描述，不默认派发最弱模型

### Requirement: 显式约束优先
系统 SHALL 保留用户或 lead 显式指定的模型和 effort，只判断未指定维度；二者都指定时 SHALL 只校验而不调用 Jev。不可用的指定值 SHALL 返回可见错误，不静默换模型或降 effort。

#### Scenario: 完全指定配置
- **WHEN** 用户显式指定有效模型与 effort
- **THEN** 判档调用数为零，执行配置保持指定值

### Requirement: 创建路径支持与实际应用
系统 SHALL 分别报告普通 subagent、fork、teammate 的路由支持状态。只有具备精确关联、正式配置入口和实际请求匹配证据时 SHALL 报告 applied；推荐输出 MUST NOT 被当作应用成功。不支持路径 SHALL 可见报告 unsupported，并指导暂停或经用户选择沿用继承，不声称存在未经验证的强制拦截。

#### Scenario: 无参数且无正式接入点
- **WHEN** 创建路径未暴露选模参数，宿主亦无已验证的配置入口
- **THEN** 路由结果为 unsupported，不显示 applied，告知用户可选继承或受支持路径

#### Scenario: 并发创建
- **WHEN** 两个不同任务并发获得不同配置并创建子会话
- **THEN** 每个实际子请求匹配自己的决策，配置不串用；无法证明关联时不应用该决策

#### Scenario: 长驻成员收到新消息
- **WHEN** 已创建 teammate 收到后续任务或消息
- **THEN** 不仅因消息到达自动切换其模型

### Requirement: 失败与验收边界
系统 SHALL 将 Jev 判断错误、配置错误与模型执行失败分开呈现；主会话 Jev 失败沿用可见停用契约，子路由失败 SHALL 暂停该派发并显示原因，不静默回退且不改变根会话模式。任务验收与升级 SHALL 由主 Agent 根据执行证据发起，不以初始分类判定任务成功，不将网络故障当作能力不足。

#### Scenario: 子判断服务失败
- **WHEN** 子任务判断服务失败
- **THEN** 返回可见错误并要求暂停派发，不选择替代模型，不悄悄转为继承，根会话模式不变

### Requirement: 网关 transport 与能力家族分离
系统 SHALL 支持已配置 Magpie transport 的精确 provider/model，MUST NOT 将网关 route 伪装为本地 Claude/codex 或静默回退到其它 transport。自动能力槽仅适用于已定义家族，未知模型可在显式约束与目录支持下使用；缺少推荐 effort 元数据时 SHALL 停止而非猜测。旧策略行为 SHALL 不变。

#### Scenario: Magpie 家族内自动选择
- **WHEN** 父 route 为 `dsh-magpie-connect` / `codex/gpt-6.1-sol`，子任务需要 bounded + baseline
- **THEN** 在允许列表与目录支持时选用同 transport 的 `codex/gpt-6-luna`，不得调用本地 codex 或 OpenRouter 执行模型

#### Scenario: Magpie 未定义能力家族
- **WHEN** 无显式子模型且父模型属于未定义自动能力槽的家族
- **THEN** 明确报告 unsupported，不按模型名称、排列或显示名猜档；显式可用模型及 effort 仍可校验使用

### Requirement: 分层验证与观测
系统 SHALL 分别验证策略质量、Jev 忠实度、实际接入正确性。路由记录 SHALL 区分推荐与实际配置及策略版本；MUST NOT 保存凭据或原始会话作为路由遥测。真实对照 SHALL 包含验收与重试开销，缺失成本不得记作零。

#### Scenario: 推荐与执行不匹配
- **WHEN** 推荐 model/effort 与实际子请求不同
- **THEN** 结果不得计为接入成功，并报告不匹配；Jev 判断正确不能覆盖该失败
