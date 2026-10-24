## ADDED Requirements

### Requirement: 协作层不可用时台账与待办 fail closed

dsh-collab 服务缺失、`pet-locus` 未能接入或接入句柄失效时，待办登记、请求执行与所有者受理 SHALL 明确返回协作层不可用，子会话的协作工具调用 SHALL 因 Pet 不认领而被拒绝；系统 MUST NOT 写入 Pet 本地替代记录，也 MUST NOT 把不可用呈现为空台账。Delivery、`pet_locus_reply`、`pet_locus_finish`、代际与入口管理 MUST NOT 因此受影响。协作层恢复后 Pet SHALL 重新接入、重建路由投影并补齐空间与 `pet` 成员。

#### Scenario: 协作层缺失时登记失败而回复照常
- **GIVEN** dsh-collab 未加载
- **WHEN** 子会话调用 `pet_locus_track`，随后调用 `pet_locus_reply`
- **THEN** 登记返回协作层不可用且不写任何记录；回复照常发出

#### Scenario: 管理面不把不可用显示为空
- **WHEN** 协作层不可用时所有者打开待办列表
- **THEN** 列表说明协作层不可用，旧版待办仍列出

#### Scenario: 协作层恢复后自动重新可用
- **GIVEN** dsh-collab 曾不可用，期间某 locus 换到第 3 代
- **WHEN** dsh-collab 重新加载，随后第 3 代 child 调用 `pet_locus_track`
- **THEN** 登记成功，条目作者为 `pet`、戳为该 locus；空间成员集合不变

### Requirement: 存量待办只读保留为旧版

本变更之前写入 Pet 本地存储的待办 SHALL 只读保留，不迁入协作空间。管理面 SHALL 将其标为旧版并照常呈现与跳转，MUST NOT 为其提供受理、完成或放弃动作。子会话经协作工具 MUST NOT 读到旧版待办（它不在空间中）。新登记 SHALL 只写入协作空间。

#### Scenario: 旧版待办只在管理面
- **GIVEN** 升级前登记的一条待办，升级后同源另一 child 又登记一条
- **WHEN** 所有者打开管理面；该 child 经 `collab_read` 读取空间
- **THEN** 管理面两条都列出，前者标旧版；`collab_read` 只返回后者；本地 `ledger_item` 行数不变

#### Scenario: 旧版待办只读
- **GIVEN** 升级前登记的一条待处理待办
- **WHEN** 所有者在管理面查看它，并经接口对它发起受理或放弃
- **THEN** 管理面显示旧版标记与跳转、不显示动作；接口请求被拒绝，本地记录与台账都不变

### Requirement: 协作层发给代理的记录按 locus 路由

发给成员 `pet` 的需回复消息与作者为 `pet` 的 request 终态通知，经 dsh-collab 中继 provider 交给 Pet 时，Pet SHALL 按以下顺序确定目标 locus 并登记：(1) 沿 `ref` 链向前追溯，取离本记录最近的带 `locusId` 戳的记录；(2) 正文中恰好出现一个 `locus-<16 位十六进制>` 不透明名且等于本主会话下某个入口的戳时取该入口；(3) 否则登记为无法路由并在管理面可见。Pet MUST NOT 猜测目标。本变更中路由结果只登记，MUST NOT 开启子会话轮次或产生飞书出站。

#### Scenario: 回应消息沿 ref 路由到最近的戳
- **GIVEN** locus A 的记录 Ra（seq 5）、locus B 的记录 Rb（seq 7）；主会话发给 `pet` 的消息 M（seq 9）`ref: 7`，而 Rb 本身 `ref: 5`
- **WHEN** Pet 收到 M 的投递
- **THEN** M 登记为发给 B，不是 A

#### Scenario: 正文点名
- **GIVEN** 主会话发给 `pet` 的消息无 `ref`，正文含 locus B 的不透明名
- **WHEN** Pet 收到投递
- **THEN** 登记为发给 B

#### Scenario: 无法路由不猜
- **GIVEN** 主会话发给 `pet` 的消息无 `ref`、正文无不透明名
- **WHEN** Pet 收到投递；随后任一子会话 `collab_read`
- **THEN** 登记为无法路由，管理面可见；该消息对任何子会话不可见

#### Scenario: 零 active child 时终态仍登记
- **GIVEN** 待办已受理，其 locus 的最后一个 child 已退役
- **WHEN** 主会话把该 request 推进为 `done`
- **THEN** 协作层对 `pet` 的投递成功，Pet 登记该终态属于该 locus（历史），不开启任何轮次

### Requirement: 迁移前后待办行为等价

除本变更 MODIFIED 与 ADDED 的要求明确改变的行为外，待办的对外行为 SHALL 与迁移前一致。以下现行要求本变更不修改，其全部场景 SHALL 在协作层承载下照常成立：「管理面呈现待办并提供由固定标识派生的跳转」「受理即开工并向主会话投递带上下文的跟进任务」「受理投递按队列语义接入主会话且不打断在途工作」「子会话可在登记后请求执行且与所有者受理共用同一链路」。

等价 SHALL 由同一组输入分别在迁移前存储与协作层存储上运行来判定。比较对象为：`pet_locus_track` 与 `pet_locus_request_execution` 返回给模型的内容、Host 组装的跟进正文、受理回执的结局与执行目标、管理面视图的字段与动作说明。两次运行 SHALL 使用同一时钟，比较时 SHALL 只归一化条目标识；证据文本与时间 MUST NOT 被归一化。

#### Scenario: 同一流程在新旧存储上输出一致
- **GIVEN** 同一主会话下 child A 登记待办 T1、child B 登记 T2；所有者受理 T1（目标空闲），A 就另一待办请求执行（目标忙），所有者放弃 T2
- **WHEN** 该流程分别在迁移前存储与协作层存储上运行
- **THEN** 两次运行的工具返回、跟进正文、回执结局与执行目标、管理面视图在归一化条目标识后逐字节相同

#### Scenario: 证据边界值在新旧存储上逐字段一致
- **GIVEN** 分别登记以下待办：摘要 300 字符；摘要含换行；详情含换行与引号、反斜杠；详情为空；摘要恰为 512 字符
- **WHEN** 流程在新旧两种存储上各运行一次并受理其中一条
- **THEN** 每条待办的摘要与详情在管理面视图中逐字段相同，跟进正文逐字节相同

#### Scenario: 并发受理在新旧存储上一致
- **GIVEN** 同一待处理待办收到两个独立受理，二者都通过待处理检查且投递都成功，之后才写入状态
- **WHEN** 该流程在新旧两种存储上各运行一次
- **THEN** 两次运行中都恰有一个受理成功、另一个返回"跟进任务已投递，但状态写入失败"，待办最终为已受理

#### Scenario: 失败路径在新旧存储上一致
- **GIVEN** 待办所属主会话已归档；另一条待办已受理
- **WHEN** 分别对二者发起受理，流程在新旧两种存储上各运行一次
- **THEN** 两次运行都在投递前失败、失败原因分类相同、两条待办的状态都不变、不产生投递；失败文本中指引模型调用 `pet_locus_ledger_read` 的句子在协作层存储上替换为指引 `collab_read`，这是本变更唯一允许的文本差异

## MODIFIED Requirements

### Requirement: 共享事实台账按主会话归属并对同源只读开放

系统 SHALL 维护一个按 `parentSessionId` 唯一定位的共享事实台账，承载该主会话与其 locus 之间显式登记的结论。台账 SHALL 由该主会话的 Locus 协作空间承载（collab-kernel 空间，经 dsh-collab 的 `pet-locus` 接入）：空间成员恰为主会话（普通成员，Leader）与代理成员 `pet`（`pet-locus` 托管，代表该主会话下全部 locus 子会话）。协作层 MUST NOT 感知入口、子会话与代际；子会话的身份以附加数据中的 `locusId` 戳表达，由 Pet 从执行会话派生。Pet MUST NOT 另存一份台账条目真相。台账 SHALL 是**主会话与其 locus 的共享事实**，MUST NOT 按 workspace、仓库或显式"项目"实体聚合，MUST NOT 跨主会话合并，也 MUST NOT 被表述为项目级知识库。

台账 SHALL 只承诺三件事，并 MUST NOT 被解释为承诺统一的修订语义、生命周期或写入授权——那些由各类条目各自定义：

1. **归属**：按 `parentSessionId` 唯一定位；空间在主会话已加载且已有 locus 时，由 Pet 以主会话的 Host 当前对象幂等建立、授权 `pet-locus` 并接纳 `pet`；主会话未加载时不为此恢复它，空间建立前子会话的协作工具与登记工具明确返回尚未就绪；最后一条条目进入终态后空间仍保留，locus 全部退役后 `pet` 成员仍在。
2. **授权与可见范围**：主会话可读全部。当前有效 locus 子会话经协作工具读取时，SHALL 只看到主会话写的记录、自己写的记录、以及附加数据指向自己的记录；兄弟子会话写的记录在正常读取中 MUST NOT 可见（星形：需要时由主会话转述）。该隔离的目的是防止子会话误把兄弟的内容带进自己的入口，MUST NOT 被表述为防止两个有意配合的子会话借条目标识是否已占用、序号增量或错误码传递信息；子会话是同一所有者的 agent，不按对手建模。跨源、已失效关联与临时 subagent SHALL 收到统一拒绝，且 MUST NOT 泄露台账或条目是否存在。
3. **命名空间**：条目按 `kind` 分区；本期唯一 kind 是待办；新增 kind MUST NOT 改变既有 kind 的语义、授权或生命周期。

台账共享的 SHALL 只是显式登记的结构化条目。它 MUST NOT 成为共享兄弟子会话对话历史或枚举兄弟入口的旁路。

#### Scenario: 兄弟子会话读不到彼此登记的结论
- **WHEN** 同一主会话下的子会话 A 已登记一条带证据的待办，子会话 B 随后经 `collab_read` 读取空间
- **THEN** B 读不到该条目；主会话经 `collab_read` 读到它及其来源戳

#### Scenario: 跨主会话不可读
- **WHEN** 另一主会话下的子会话尝试读取本台账
- **THEN** 请求被统一拒绝，回执不表明该台账是否存在

#### Scenario: 台账不随条目清空而消失
- **WHEN** 台账内最后一条待办被所有者标记完成或放弃
- **THEN** 台账记录保留，后续登记复用同一台账，不重新建立另一份

#### Scenario: 新增条目类型不改既有语义
- **WHEN** 将来引入待办之外的第二类条目
- **THEN** 待办的授权、生命周期与字段语义不因此改变，既有条目无需改写

#### Scenario: 换代后登记照旧归入同一代理
- **WHEN** locus 从第 2 代切换到第 3 代，第 3 代 child 登记待办
- **THEN** 条目作者为 `pet`，附加数据中的 `locusId` 与第 2 代登记的条目相同；空间成员集合不变，第 2 代 child 的协作工具调用被 `COLLAB_CALLER_UNAVAILABLE` 拒绝

#### Scenario: 主会话未加载时不为建空间唤醒它
- **WHEN** 首个 locus 挂到一个未加载的主会话，其 child 随即调用 `collab_status` 与 `pet_locus_track`
- **THEN** 主会话不被恢复；两者都返回协作空间尚未就绪；Delivery 与回复照常

### Requirement: 待办登记固定来源与回复去向且关联标识而非实例

系统 SHALL 提供 caller-bound 的待办登记工具。工具 MUST NOT 接受任何 locus、chat、message、thread 或 target selector；Host SHALL 从实际执行 caller 与其唯一 current Delivery 解析全部关联事实与台账归属，任一不可证明时 fail closed。

待办 SHALL 是 Locus 协作空间中由登记子会话经代理身份创建的 `request` 条目，承接方为主会话，`requiredAcks` 为空，承接方一对一指定、不引入认领；登记 MUST NOT 唤醒任何成员。以下固定事实与 `locusId` 戳 SHALL 存于条目的附加数据，创建后不可改写；证据摘要与详情以无损编码存于条目正文。登记时 SHALL 固定以下事实：`locusId`（稳定标识，用于表达问题来源）、登记时的 `generation`（历史事实，仅供审计，MUST NOT 参与寻址）、`endpoint` 即 `(chatId, threadId?)`（回复去向）、触发 `messageId`（可回跳并可按消息引用回复）与请求人。

待办 SHALL 关联 locus **标识**而非 locus **实例**：代际更替、locus 重建、入口停止服务、主会话归档或群解散 MUST NOT 使待办消失、失效或被静默改写；其来源与去向仍可凭已固定的标识解析。待办归属 SHALL 跟随 `locusId` 与 `endpoint`，MUST NOT 跟随某一代 locus 的存续状态。

登记 SHALL 携带子会话已查明的证据（定位、原因、建议）。证据 SHALL 是登记时刻的快照事实，MUST NOT 自动刷新，也 MUST NOT 被呈现为当前仍然成立的结论。

#### Scenario: 工具不接受目标参数
- **WHEN** 子会话在登记调用中携带 chat、message 或 locus 标识
- **THEN** 调用被拒绝，Host 不采用模型提供的任何标识

#### Scenario: 代际更替后待办仍可解析
- **WHEN** 待办登记于 locus 第 2 代，该入口随后切换来源并产生第 3 代
- **THEN** 待办仍然存在，其来源与去向凭已固定的 `locusId` 与 `endpoint` 解析，登记时的 `generation` 保留为历史事实

#### Scenario: 入口退役不使待办消失
- **WHEN** 待办所属 locus 已被解绑或退役
- **THEN** 待办仍然存在且可被所有者处置，MUST NOT 被自动关闭或删除

#### Scenario: 无唯一 current 时拒绝登记
- **WHEN** 调用发生在没有唯一 current Delivery 的执行中
- **THEN** 登记被拒绝，不创建待办，也不猜测目标

#### Scenario: 登记不唤醒主会话
- **WHEN** 子会话登记一条待办
- **THEN** 空间新增一条承接方为主会话、作者为 `pet`、附加数据含该 locus 戳的 request，提交中不含任何唤醒，主会话不开始新轮次

#### Scenario: 主会话修订条目不改变登记证据
- **GIVEN** 子会话登记待办，证据摘要为"错误位于 A"
- **WHEN** 主会话经协作工具把该条目的标题与正文改为"已修复"，随后所有者受理
- **THEN** 管理面与跟进正文中的证据仍为"错误位于 A"

#### Scenario: 时间在重启后保持不变
- **GIVEN** 时钟为 1000 时登记待办，为 5000 时所有者受理
- **WHEN** Host 重启后读取该待办
- **THEN** 登记时间为 1000、状态变更时间为 5000；受理的重试不改变 5000

### Requirement: 待办生命周期与 Delivery 结算解耦

登记待办 MUST NOT 使该 Delivery 长期保持 current。登记完成后，子会话 SHALL 经既有 `pet_locus_finish` 以 `reply` 当场结算并回执受理事实，队列按既有规则前进。

待办自身 SHALL 长期存活，其状态变化 MUST NOT 产生新的飞书出站正文、表情或 Delivery。系统 MUST NOT 把待办的未完成状态表述为对应请求尚未答复，也 MUST NOT 把 Delivery 的已结算表述为该事项已完成。

待办 SHALL 具备可推进的状态，至少区分待处理、已受理、已完成与已放弃；状态变化 SHALL 记录操作时间。状态与 request 进度一一对应：待处理 = `open`、已受理 = `accepted`、已完成 = `done`、已放弃 = `rejected`。状态 SHALL 只经以下路径改变：(a) 所有者经管理面处置，由 Pet 以 `pet-locus` 托管方身份代为记账，不唤醒任何成员；(b) 登记方就其自己登记的待办请求执行并投递成功后，由 Pet 代为记为已受理；(c) 主会话作为承接方自行推进（`open → accepted|rejected`、`accepted → done|rejected`）。终态通知发给作者 `pet`，Pet 按附加数据路由到登记它的 locus 并登记，MUST NOT 因此开启子会话轮次或产生飞书出站。登记方子会话 MUST NOT 自行推进状态。

已受理 SHALL 表示该事项已实际开工。主会话自行受理时它本人就是执行者，不需要投递；除此之外，系统产生该状态的唯一路径 SHALL 是一次成功完成投递的操作，无论其由所有者受理还是由登记方请求执行触发。系统 MUST NOT 把已受理表述为仅完成了一次标记，也 MUST NOT 向所有者或登记方提供任何只改状态而不投递的动作。

系统 MUST NOT 依据一条待办处于已受理来断言其跟进任务确已送达；送达与否由该次受理操作的一次性回执表达，不由行状态反推。据此，来源不明的已受理记录 MUST NOT 破坏任何不变量。

所有者 SHALL 仍可不经受理直接把待处理的待办标记为已完成或已放弃；该直达路径 MUST NOT 触发任何投递。

#### Scenario: 登记后队列继续前进
- **WHEN** 子会话登记待办并结算该 Delivery，backlog 中还有下一条合格消息
- **THEN** 下一条消息按既有规则成为 current 并被投递，不因待办未完成而阻塞

#### Scenario: 回复完成不等于事情做完
- **WHEN** 一条要求干活的请求已回执受理且 Delivery 已结算
- **THEN** 对应待办仍为待处理，系统不把它呈现为已完成

#### Scenario: 待办状态变化不外发
- **WHEN** 所有者在管理面把一条待办标记为已完成
- **THEN** 系统不向原飞书入口发送任何正文或表情

#### Scenario: 子会话不能推进待办状态
- **WHEN** 子会话经 `collab_advance_request` 尝试把一条自己登记的待办标记为已受理、完成或放弃
- **THEN** dsh-collab 在入口以 `COLLAB_ITEM_NOT_FOUND` 拒绝（承接方不是它），不调用内核，状态不变

#### Scenario: 主会话做完后自行标记完成
- **GIVEN** 一条待办经所有者受理已为已受理，主会话完成了跟进工作
- **WHEN** 主会话经 `collab_advance_request` 推进为 `done`
- **THEN** 待办在管理面显示为已完成；终态通知经 Pet 路由登记到登记它的 locus，该 locus 不开启轮次，系统不向飞书发送任何内容

#### Scenario: 不经受理直接了结
- **WHEN** 所有者对一条待处理的待办直接标记已完成或已放弃
- **THEN** 该待办进入对应终态，系统不向任何主会话投递跟进任务，台账提交不含任何唤醒
