## ADDED Requirements

### Requirement: 协作空间由干活主会话与 locus 主会话两个普通成员组成

每个干活主会话 SHALL 对应恰一个 active 的 Locus 协作空间（更换 locus 主会话后旧空间保留为历史空间，其待办仍列出并可处置），由 Pet 以 locus 主会话身份经 dsh-collab 句柄 `actAs` 建立：locus 主会话为首成员与 Leader，随后授权 Pet 的接入方 channel 为 manager、邀请干活主会话为普通成员（`memberTrust: true` 时代为加入，干活主会话因此被唤醒一次）。空间成员 SHALL 恰为这两个普通会话；MUST NOT 有代理成员，子会话 MUST NOT 是成员，也 MUST NOT 拥有任何 `collab_*` 工具。条目真相只在协作空间中，Pet MUST NOT 另存。条目可见性 SHALL 由 Pet 侧按 `ext.pet.entry`（稳定入口身份）过滤，只作用于 Pet 工具 `locus_context` 的输出；两个成员经 `collab_*` 读取时看到全部条目。

#### Scenario: 建空间并邀请干活主会话
- **GIVEN** Pet 为干活主会话 W 新建了 locus 主会话 M，`memberTrust: true`
- **WHEN** 第一个入口建立完成
- **THEN** 空间日志依次含 `space/created`（Leader 绑定 `dsh-session:M`）、`manager/allowed{pet-locus}`、`member/invited` 与 `member/joined`（绑定 `dsh-session:W`）；成员集合恰为这两个会话

#### Scenario: 子会话没有协作工具
- **WHEN** 读取任一 locus 子会话的已发布工具面
- **THEN** 不含任何 `collab_*` 工具；子会话以伪造参数调用 `collab_read` 返回工具不存在

#### Scenario: 干活主会话不可邀请时不建入口
- **GIVEN** W 在拒绝名单中
- **WHEN** Pet 尝试为 W 建立空间
- **THEN** 邀请返回 `COLLAB_ADDRESS_UNCLAIMED`，入口建立失败并回执所有者，不留下只有 locus 主会话的空间被当作就绪

### Requirement: 待办由 Host 以 locus 主会话身份代写

子会话登记待办（`pet_locus_track`）时，Host SHALL 从实际执行 caller 与其唯一 current Delivery 解析全部关联事实，并经 `actAs(locus 主会话)` 创建 `request` 条目：承接方为干活主会话，`requiredAcks` 为空，`ext.pet` 固定 `{entry, generation, endpoint, messageId, requester}`（`entry` 为稳定入口身份，`generation` 仅供审计），创建后不可改写；证据以无损编码存于正文。登记 MUST NOT 唤醒任何成员。工具 MUST NOT 接受任何 locus、chat、message、thread 或目标参数；任一事实不可证明时 fail closed。待办 SHALL 关联入口身份而非某一代实例：代际更替、入口停止服务或 locus 主会话更换都 MUST NOT 使其消失或被改写。

#### Scenario: 代写条目的作者与附加数据
- **WHEN** 第 2 代子会话登记一条待办
- **THEN** 空间新增一条 actor 为 locus 主会话成员名、承接方为干活主会话、`ext.pet.entry` 为该入口稳定身份、`ext.pet.generation` 为 2 的 request，提交不含 `dispatch/intended`

#### Scenario: 工具不接受目标参数
- **WHEN** 子会话在登记调用中携带 chat、message 或入口标识
- **THEN** 调用被拒绝，不创建条目

#### Scenario: 无唯一 current 时拒绝
- **WHEN** 调用发生在没有唯一 current Delivery 的执行中
- **THEN** 登记被拒绝，不创建条目

#### Scenario: 更换 locus 主会话后待办仍在
- **GIVEN** 入口 E 在 locus 主会话 M1 下登记了待办 T
- **WHEN** M1 不可用，Pet 为同一干活主会话新建 M2 并迁移入口
- **THEN** T 仍在原空间中且可被所有者处置；E 之后的登记写入 M2 所在的新空间，管理面同时列出两处待办

### Requirement: 所有者处置待办经 manager 代为记账

所有者经管理面受理、完成或放弃待办 SHALL 由 Pet 以 manager 身份经 `disposeManagedRequest` 记账，不唤醒任何成员；受理成功的唯一路径仍是一次成功完成的跟进投递（投递目标为干活主会话）。干活主会话作为承接方 SHALL 可自行推进。终态通知按内核规则发给条目作者 locus 主会话，MUST NOT 开启任何子会话轮次或产生飞书出站。

#### Scenario: 所有者直接了结
- **WHEN** 所有者对一条待处理的待办直接标记已完成
- **THEN** 提交 actor 为 `manager:pet-locus`、不含 `dispatch/intended`，干活主会话没有收到跟进投递

#### Scenario: 干活主会话自行完成
- **GIVEN** 待办已受理
- **WHEN** 干活主会话经 `collab_advance_request` 推进为 `done`
- **THEN** 管理面显示已完成；没有子会话开始新轮次，没有飞书出站

### Requirement: 待办登记后的回复如实且登记失败反馈可执行

child 把工作登记为待办并回复请求人时，其正文 SHALL 与**该待办当前的持久状态**一致：状态仍为未开始
或已转交时，MUST NOT 声称工作已开始、正在执行或即将完成；MUST NOT 把未经确认的目标路径、目录或
接收者表述为事实，不确定时 SHALL 明确说明不确定并请求确认。

caller-bound 待办登记工具（track）因参数、状态或依赖不可用而无法完成时，SHALL 返回**按操作
区分**的可执行下一步：登记失败指出缺什么前置或先做什么；child 经 `locus_context` 读取本入口待办进度，其不可用时 SHALL 与"可用但没有待办"区分；MUST NOT 只返回"不存在/失败/不可用"这类不可执行结果，也 MUST NOT 枚举或
泄露其它 locus、其它 child 或其它待办的标识。

#### Scenario: 登记后回复与待办状态一致
- **WHEN** child 因权限不足把工作登记为待办并在群内回复，而该待办状态为未开始或已转交
- **THEN** 回复如实说明该状态，不声称工作已开始、正在进行或即将完成

#### Scenario: 未确认路径不作为事实
- **WHEN** child 无法读取某个候选目录、只能推测目标位置
- **THEN** 回复把该位置表述为推测并请求确认，MUST NOT 直接给出未确认路径作为落点

#### Scenario: 登记失败给出操作特定指引
- **WHEN** 登记因参数非法、缺少前置（例如没有唯一 current Delivery）或依赖不可用而失败
- **THEN** 返回可执行的操作特定指引（说明缺什么前置或应先做什么），且不枚举或泄露其它待办、其它 locus 的标识

#### Scenario: 待办进度不可读与没有待办可区分
- **WHEN** 协作空间不可用时 child 调用 `locus_context`
- **THEN** 返回可区分的失败原因与下一步，MUST NOT 以空列表呈现为"没有待办"


## MODIFIED Requirements

### Requirement: 待办生命周期与 Delivery 结算解耦

登记待办 MUST NOT 使该 Delivery 长期保持 current。登记完成后，子会话 SHALL 经既有 `pet_locus_finish` 以 `reply` 当场结算并回执受理事实，队列按既有规则前进。

待办自身 SHALL 长期存活，其状态变化 MUST NOT 产生新的飞书出站正文、表情或 Delivery。系统 MUST NOT 把待办的未完成状态表述为对应请求尚未答复，也 MUST NOT 把 Delivery 的已结算表述为该事项已完成。

待办 SHALL 具备可推进的状态，至少区分待处理、已受理、已完成与已放弃；状态变化 SHALL 记录操作时间。状态与 request 进度一一对应：待处理 = `open`、已受理 = `accepted`、已完成 = `done`、已放弃 = `rejected`。状态 SHALL 只经以下路径改变：(a) 所有者经管理面处置，由 Pet 以 `pet-locus` manager 身份代为记账，不唤醒任何成员；(b) 干活主会话作为承接方自行推进（`open → accepted|rejected`、`accepted → done|rejected`）。终态通知按内核规则发给条目作者 locus 主会话，MUST NOT 因此开启子会话轮次或产生飞书出站。登记方子会话 MUST NOT 自行推进状态。

已受理 SHALL 表示该事项已实际开工。主会话自行受理时它本人就是执行者，不需要投递；除此之外，系统产生该状态的唯一路径 SHALL 是所有者受理触发的一次成功完成的投递。系统 MUST NOT 把已受理表述为仅完成了一次标记，也 MUST NOT 向所有者提供任何只改状态而不投递的动作。

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
- **WHEN** 子会话尝试推进一条自己登记的待办
- **THEN** 子会话没有任何可推进待办的工具，状态不变

#### Scenario: 主会话做完后自行标记完成
- **GIVEN** 一条待办经所有者受理已为已受理，干活主会话完成了跟进工作
- **WHEN** 干活主会话经 `collab_advance_request` 推进为 `done`
- **THEN** 待办在管理面显示为已完成；终态通知发给 locus 主会话，子会话不开启轮次，系统不向飞书发送任何内容

#### Scenario: 不经受理直接了结
- **WHEN** 所有者对一条待处理的待办直接标记已完成或已放弃
- **THEN** 该待办进入对应终态，系统不向任何主会话投递跟进任务，台账提交不含任何唤醒

## REMOVED Requirements

### Requirement: 待办登记后的回复如实且待办工具失败反馈可执行
**Reason**: 请求执行工具退役、子会话不再用 `collab_read`，由"待办登记后的回复如实且登记失败反馈可执行"取代。
**Migration**: 无。

### Requirement: caller-bound 只读父会话查阅不唤醒主会话
**Reason**: 子会话的父会话改为 Pet 自有的 locus 主会话，查阅干活现场改由 `locus_context`（共识）与 locus 主会话转问干活主会话承担。
**Migration**: `pet_locus_parent_lookup` 从子会话工具面移除；需要的事实由 `locus_context` 或登记待办获得。

### Requirement: 共享事实台账按主会话归属并对同源只读开放
**Reason**: 代理成员 `pet`、`locusId` 戳与星形可见规则退役，由"协作空间由干活主会话与 locus 主会话两个普通成员组成"取代。
**Migration**: 旧空间保留只读；新空间按新规则建立，旧入口按退休规则重建。

### Requirement: 待办登记固定来源与回复去向且关联标识而非实例
**Reason**: 作者由代理成员改为 locus 主会话，由"待办由 Host 以 locus 主会话身份代写"取代。
**Migration**: 旧条目保留在旧空间，所有者仍可在管理面处置。

### Requirement: 子会话可在登记后请求执行且与所有者受理共用同一链路
**Reason**: 只有人能承接执行；`pet_locus_request_execution` 退役。
**Migration**: 子会话登记后由所有者在管理面受理或由干活主会话自行处理。

### Requirement: 协作层发给代理的记录按 locus 路由
**Reason**: 不再有代理成员。
**Migration**: 无；终态通知发给 locus 主会话。

### Requirement: 迁移前后待办行为等价
**Reason**: 一次性迁移条款，所引用的机制已退役。
**Migration**: 无。
