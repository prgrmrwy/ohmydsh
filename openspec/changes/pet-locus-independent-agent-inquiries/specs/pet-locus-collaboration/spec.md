## Baseline

本 delta 的 MODIFIED 条文完整取自前置 change `pet-unified-locus-collaboration/specs/pet-locus-collaboration/spec.md`。该 capability 尚未进入 current specs；必须先合并前置规范再应用本 delta，禁止倒序归档或将本文件误当全量 spec。此说明不意味着前置实施已经完成。

## MODIFIED Requirements

### Requirement: 关联具备双向发现且不过度披露

系统 SHALL 从入口查当前 locus/主会话/子会话，从主会话列出全部 locus，从子会话找到唯一 locus。正反向结果 SHALL 同源一致并区分历史和活跃代际。所有者管理面 SHALL 展示来源、群/话题、默认 Q&A、权限、工作根和状态。群内回执 MUST NOT 泄露完整 session ID、其它群 ID 或其它 locus 列表。

子会话的 `pet_context` SHALL 仍只返回自身关联。Agent 另经 `pet-agent-inquiries` 定义的 scoped 协作者名单取得自己的主会话与同源当前有效 Locus children 的最小协作信息；主会话 SHALL 经同一能力发现自己的有效 Locus children。名单 MUST NOT 复用 owner 完整管理视图，不因内部可发现而允许向飞书公开兄弟入口名单或取得其完整历史。

#### Scenario: 双向核对
- **WHEN** 所有者从研发主会话查看协作入口，再从某入口打开会话
- **THEN** 两个方向指向同一个 locus 与对应主/子会话

#### Scenario: 子会话反查
- **WHEN** 子会话经 `pet_context` 查询自身关联
- **THEN** 只返回自己的 locus，不因共享 parent 获得所有兄弟入口的公开枚举

#### Scenario: 子会话主动发现协作者
- **WHEN** 有效 child 经 scoped 协作者名单寻找可询问 agent
- **THEN** Host 返回同源圈内最小成员信息，而非 owner 完整管理数据或任意会话清单

### Requirement: 上下文按实际子会话绑定并允许按需问主会话

新建及显式重建的子会话 SHALL 使用独立上下文，不复制主会话已完成前缀、进行中轮次或默认父摘要；初始化 SHALL 只包含自身身份、所服务入口、可信工作归属、权限、已确认锚点和协作能力说明。子会话 SHALL 被明确描述为当前入口的服务者，而非主会话本人。其自身交互与按需获得的答案 SHALL 持续保存，冷恢复 SHALL 恢复同一 child 历史，不重新播种父上下文。独立历史 MUST NOT 被解释为创建新的工作目录、丢失工具组合或静默更换模型。

初始化任务书 SHALL 告知可按需查询 `pet-collaboration-context` 的同源公共事实及协作者列表，并在资料不足时询问主会话或兄弟 child，以补齐工作根、约束或相关工作事实，不要求每条业务请求都询问。公共事实按 parent 只维护一份，由范围内 agent 自主更新并留痕，新 child 挂载和重建不复制公共全文，冷恢复按需取得当前修订；不会自动将本地锚点、父历史或询问答案提升为公共内容。名单及问答 SHALL 遵循 `pet-agent-inquiries` 的授权与关联规则。普通目录/ws/sw 均可，MUST NOT 以新建 worktree 代替共享已有工作现场。答复只提供上下文事实；锚点仍经所有者确认写入，存在性不等于写授权。

caller-bound `pet_context` SHALL 提供当前 locus、局部项目入口、已确认局部锚点与权限，不允许模型指定其它目标。公共说明/资料引用/共同约束 SHALL 由独立 scoped 公共查询提供，MUST NOT 静默覆盖 Locus 的执行根、局部约束、权限或当前回复关联；公共与局部语义冲突时按 `pet-collaboration-context` 明示来源并请求澄清。后续投递只带必要请求事实和查询引导，MUST NOT 每次重复全部名单说明。未知锚点 SHALL 如实报告。系统 MUST NOT 自动汇总或把子会话结论回传主会话；对实际询问的定向答复不属于自动结算回报。所有者可主动查阅，项目资料 SHALL 按需读取，不自动共享兄弟子会话历史。

主会话 SHALL 被表述为工作归属与可询问的上下文来源，MUST NOT 因其父节点身份宣称已统合所有协作现场的最新认知。用户显式发起的查阅与汇总不属于自动回传；系统 SHALL 区分可发现、可读取与已采纳，缺少历史读取能力或权限时如实说明。当前模型 MUST NOT 宣称已提供 project 级自动知识同步或多人分布式协同。

已有统一 Locus fork child SHALL 保留原历史与上下文模式，按下述显式重建要求升级，不裁剪日志，不伪报为独立初始化。旧 QA/chat 绑定仍遵守前置版本的退役隔离，不因本兼容规则恢复服务。

#### Scenario: 子会话发现不自动成为主会话认知
- **WHEN** QA 子会话产生新发现，而用户未发起主会话查阅或采纳，也没有关联询问
- **THEN** 系统不自动更新主会话，不将该发现呈现为主会话已知的项目决策

#### Scenario: 用户主动查阅受实际能力约束
- **WHEN** 用户要求查阅一个可通过索引发现、但当前无权读取或缺少宿主读取能力的子会话历史
- **THEN** 如实说明限制，不把找到 locus 表述为已读取或已汇总内容

#### Scenario: 历史不含最新目录
- **WHEN** 子会话自己的上下文及已确认锚点无法确定当前执行根
- **THEN** 可按需询问主会话或请求所有者确认，不猜 cwd，不擅自创建另一个工作目录

#### Scenario: 主会话无法回答
- **WHEN** 补问信息无法取得
- **THEN** 报告未确认，不把请求接受当作已收到答复，不放宽权限

#### Scenario: 新话题上下文
- **WHEN** 群子会话已积累讨论而新话题子会话建立
- **THEN** 新 child 固定主会话归属及项目入口，但不复制主会话或群子会话历史，需要相关事实时定向询问

#### Scenario: 长父历史不能冒充子身份
- **WHEN** 活跃主会话已有大量 GUI 验收对话并创建新 Q&A child
- **THEN** 新 child 不含这些对话或默认摘要，首轮只以自己的入口身份处理请求，不延续父会话验收任务

#### Scenario: 冷恢复保留独立历史
- **WHEN** 独立 child 已有自己的多轮对话及询问答复，Host 重启后恢复
- **THEN** 恢复同一 child 的历史和创建配置，不插入恢复时的父历史，不换模型或身份

### Requirement: 投递与结算关联独立于会话运行状态

每条接受消息 SHALL 有持久关联，至少标识入口、locus 代际、子会话、消息与执行对应关系。接受不等于完成；初始化、GUI 私聊、父子及兄弟询问 MUST NOT 消耗无关飞书待反馈记录。迟到或重复结算 MUST NOT 反馈到其它消息/新代际，无法证明对应时只诊断。

原 Delivery 发起关联询问后 SHALL 保留请求身份，支持多个执行轮次和一次有界的异步协作过程，不重建飞书 root executor/Invocation/waiting-user 分支。发起轮次结束但仍有待答询问或关联续进时 MUST NOT 仅凭 turn/end 显示请求完成。答复抵达 SHALL 只以 Host 持久询问关联建立原请求的受限续进；不把所有 agent 消息都当作可信回复上下文，不放宽普通 mixed/foreign 流量拒发规则。中间进度正文 MUST NOT 自动终结请求；尚有未决询问但请求方决定提前完成时 SHALL 使用绑定实际原请求的显式完成动作并取消未决分支，MUST NOT 从正文词汇或一次发送调用猜测最终性。

Host SHALL 维护进行中/完成/失败表情，表情失败不阻断工作；同时区分运行结算、正文发送成功、未回复和发送结果未知。可证明请求结束却未发送正文时 SHALL 提供未回复诊断，不显示为已答复，不复制 assistant 最后正文代发，也不盲目重跑模型。发送结果未知 SHALL 待核查，不自动重发。通用失败文字回执由独立 B027 承接，本要求不授权 Host 代发业务正文。

文字 SHALL 由子会话使用 bot 身份经 `pet_locus_reply` 回到当前请求的入口，Host 不重复代发正文；控制回执不受此限制。GUI 私聊 SHALL 保留上下文但不产生飞书出站。询问答复本身 MUST NOT 为被询问方创建飞书 Delivery。恢复 SHALL 使用原主/子会话，不静默切换模型或来源。

#### Scenario: 私聊与群消息交错
- **WHEN** GUI 私聊或初始化先于一个待处理飞书请求结算
- **THEN** 不消费该请求的反馈，私聊不产生飞书回复

#### Scenario: 旧代际迟到结算
- **WHEN** S0 子会话在入口切换后出现迟到结算
- **THEN** 只能关联 S0 原 Delivery，不更新 S1 的消息

#### Scenario: 宿主重启
- **WHEN** 合格消息需要恢复子会话
- **THEN** 恢复原主/子会话并核验上下文与权限，provider 不可用明确失败，不另建替代身份

#### Scenario: 两个请求之间收到旧询问答复
- **WHEN** A 为 D1 询问后处理 D2，D1 的答复随后到达
- **THEN** 结果排队为 D1 的关联续进，不 steer D2，不使用 D2 的飞书回复目标

#### Scenario: 正常结算但未发送
- **WHEN** 请求所有执行与询问均已终结但没有可证明成功的 `pet_locus_reply`
- **THEN** 展示未回复或发送结果未知的诊断，不把 turn 正常结束标为已答复，不重放或代发正文

## ADDED Requirements

### Requirement: 独立上下文升级必须显式重建且保留旧代

管理面 SHALL 区分当前统一 Locus 的旧 fork 上下文模式与新独立模式；未知创建来源 SHALL 如实标未知，不猜成独立模式。已有 fork child 的历史和正常服务 SHALL 保留，不自动切换 provider、裁剪父前缀或批量重建。有效旧 fork child 仍属于同源名单，名单 SHALL 明示其上下文模式；其询问能力须满足同样的副作用、身份和受众边界，不能满足时保留普通服务但标记询问不可用。

所有者 SHALL 能在无执行中、排队、待答询问或关联续进时显式重建当前入口为新独立 child。重建 SHALL 保持原主会话、入口与默认 Q&A 角色，以新代际、新 child、默认 read 发布；旧代历史保留，新代不复制旧 transcript 或自动摘要。已确认工作锚点只有重新核对仍适用后才能作为初始事实使用，MUST NOT 继承旧 write。忙时 SHALL 拒绝；发布失败保留旧有效关联，未发布 child 按既有补偿规则回收；新代生效需按既有来源切换通知规则清晰说明身份与上下文重置。

#### Scenario: 升级不改旧 child
- **WHEN** 已有 fork 模式 Locus 安装新版本
- **THEN** 旧 child 继续保留原上下文和历史，管理面明示旧模式，不自动改造成独立 child

#### Scenario: 空闲时显式重建
- **WHEN** 所有者确认把空闲 fork Locus 重建为独立模式
- **THEN** 同一入口切到新 child 和新代际，主会话和默认 Q&A 角色不变、权限为 read，旧历史保留且不注入新 child

#### Scenario: 失败与在途保护
- **WHEN** 重建遇到在途询问，或新 child 准备失败
- **THEN** 在途时拒绝重建；准备失败不切换当前指针，不终止旧服务或删除历史
