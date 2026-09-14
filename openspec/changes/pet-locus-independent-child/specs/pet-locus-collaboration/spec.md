## Baseline

本 delta 的 MODIFIED 条文完整取自前置 change `pet-unified-locus-collaboration/specs/pet-locus-collaboration/spec.md`。该 capability 尚未进入 current specs；必须先合并前置规范再应用本 delta，禁止倒序归档或将本文件误当全量 spec。

与 `pet-locus-independent-agent-inquiries` 的边界：本 change 只承接「新 child 不复制父历史」一点；不引入上下文模式标记或其持久化/展示（所有者 2026-03-23 明确决定不要，见 `design.md` D4）；公共事实持久层、协作者名单、异步询问与跨轮续进仍归 B035，本文件不对其作出任何条文承诺。两个 change 修改同一条 requirement，归档时必须按实际实现顺序重新对齐，不得把本文件当作 B035 的替代。

## MODIFIED Requirements

### Requirement: 上下文按实际子会话绑定并允许按需问主会话

新建及显式重建的子会话 SHALL 使用独立上下文，不复制主会话已完成前缀、进行中轮次或默认父摘要；初始化 SHALL 只包含自身身份、所服务入口、可信工作归属、权限、已确认锚点和按需询问说明。子会话 SHALL 被明确描述为当前入口的服务者，而非主会话本人。其自身交互 SHALL 持续保存，冷恢复 SHALL 恢复同一 child 历史，不重新播种父上下文。独立历史 MUST NOT 被解释为创建新的工作目录、丢失工具组合或静默更换模型。

系统 SHALL 在创建前核验所用 provider 确实不继承父上下文；无法证明时 SHALL 拒绝创建并如实报告，MUST NOT 静默退回复制父历史的 provider，也 MUST NOT 把拒绝表述为已建立独立 child。

已有 fork child 不受本条影响：它们不会被本 change 的创建路径重新创建，其历史 MUST NOT 被裁剪或静默改造。

初始化任务书 SHALL 告知子会话在工作根、约束或相关事实不足时，可通过宿主原生消息能力询问 caller-bound 主会话，MUST NOT 允许指定其它 parent 或 locus。主会话回复只是对话事实，SHALL NOT 因此成为持久授权；锚点仍须由所有者在管理面显式确认后写入。答复只提供上下文事实；路径存在性不等于写授权。

父子或 agent 间的 `agent-message` SHALL 只作为子会话上下文通信，不参与 Delivery 路由判定：它 MUST NOT 建立、修改、替换或撤销当前 Delivery 已由 Host 绑定的回复目标。当前 turn 没有唯一活跃 Delivery 时，`agent-message` MUST NOT 自行产生飞书回复能力。GUI/user steer、来源不明的参与者消息与第二条 Delivery 仍 SHALL 参与歧义判定并 fail closed。

caller-bound `pet_context` SHALL 提供当前 locus、局部项目入口、已确认局部锚点与权限，不允许模型指定其它目标。后续投递只带必要请求事实和查询引导，MUST NOT 每次重复全部说明。未知锚点 SHALL 如实报告。系统 MUST NOT 自动汇总或把子会话结论回传主会话；对实际询问的定向答复不属于自动结算回报。所有者可主动查阅，项目资料 SHALL 按需读取，不自动共享兄弟子会话历史。

主会话 SHALL 被表述为工作归属与可询问的上下文来源，MUST NOT 因其父节点身份宣称已统合所有协作现场的最新认知。用户显式发起的查阅与汇总不属于自动回传；系统 SHALL 区分可发现、可读取与已采纳，缺少历史读取能力或权限时如实说明。当前模型 MUST NOT 宣称已提供 project 级自动知识同步或多人分布式协同。

旧 QA/chat 绑定仍遵守前置版本的退役隔离，不因本兼容规则恢复服务。

#### Scenario: 长父历史不能冒充子身份
- **WHEN** 活跃主会话已有大量 GUI 验收对话并创建新 Q&A child
- **THEN** 新 child 不含这些对话或默认摘要，首轮只以自己的入口身份处理请求，不延续父会话验收任务

#### Scenario: 业务正文仍只经由入口回复工具发送
- **WHEN** 独立 child 完成一条飞书请求的处理
- **THEN** 业务正文经该 child 的入口回复工具发送，turn 正常结束而未发送正文时如实诊断为未回复，不由宿主代答

#### Scenario: 无法证明独立能力时拒绝创建
- **WHEN** 当前 runtime 无法证明所用 provider 不继承父上下文
- **THEN** 创建失败并报告能力不可用，不退回复制父历史的 provider，不把失败表述为已建立独立 child

#### Scenario: 历史不含最新目录
- **WHEN** 子会话自己的上下文及已确认锚点无法确定当前执行根
- **THEN** 可按需询问主会话或请求所有者确认，不猜 cwd，不擅自创建另一个工作目录

#### Scenario: 主会话无法回答
- **WHEN** 补问信息无法取得
- **THEN** 报告未确认，不把请求接受当作已收到答复，不放宽权限

#### Scenario: 父回复不撤销原 Delivery 回复目标
- **WHEN** child 在处理唯一飞书 Delivery 的当前 turn 内经原生消息询问父会话，父回复以 `agent-message` 进入该 turn
- **THEN** 该消息只补充 child 上下文，不参与 Delivery 路由判定，child 仍可通过 `pet_locus_reply` 使用原 Delivery 的 Host 绑定目标回复飞书

#### Scenario: 单独的 agent 消息不能获得飞书回复能力
- **WHEN** child 当前没有唯一活跃 Delivery 而只收到一条 `agent-message`
- **THEN** 该上下文消息不建立飞书回复目标，`pet_locus_reply` 仍须拒绝发送

#### Scenario: GUI 流量仍使回复目标失效
- **WHEN** 同一 child turn 同时包含飞书 Delivery 与 GUI/user steer、来源不明的参与者消息或第二条 Delivery
- **THEN** 系统继续 fail closed，不得借原 Delivery 目标发送混合任务的正文

#### Scenario: 新话题上下文
- **WHEN** 群子会话已积累讨论而新话题子会话建立
- **THEN** 新 child 固定主会话归属及项目入口，但不复制主会话或群子会话历史，需要相关事实时定向询问

#### Scenario: 子会话发现不自动成为主会话认知
- **WHEN** QA 子会话产生新发现，而用户未发起主会话查阅或采纳，也没有关联询问
- **THEN** 系统不自动更新主会话，不将该发现呈现为主会话已知的项目决策

#### Scenario: 用户主动查阅受实际能力约束
- **WHEN** 用户要求查阅一个可通过索引发现、但当前无权读取或缺少宿主读取能力的子会话历史
- **THEN** 如实说明限制，不把找到 locus 表述为已读取或已汇总内容

#### Scenario: 冷恢复保留独立历史
- **WHEN** 独立 child 已有自己的多轮对话，Host 重启后恢复
- **THEN** 恢复同一 child 的历史，不插入恢复时的父历史，不更换身份

#### Scenario: 旧 fork child 不受影响
- **WHEN** 已有继承父前缀的 child 继续服务其入口
- **THEN** 其历史和行为不被裁剪或静默改造，因为它不会被本 change 的创建路径重新创建
