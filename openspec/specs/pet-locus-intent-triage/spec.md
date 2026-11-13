# pet-locus-intent-triage Specification

## Purpose

子会话按请求意图分流：信息交换当场答复，要求干活则把已查清的结论登记为待办移交所有者，避免只读权限下的改动请求无痕消失。配套一条不唤醒主会话的只读查阅路径（读写分离，缓解父会话争用），以及一本按主会话归属的共享事实台账——主会话与其 locus 之间显式登记的结构化结论，本期唯一条目类型是待办。

## Requirements

### Requirement: 子会话判定请求意图并据此选择结局

子会话 SHALL 对每条 current Delivery 判定其属于**信息交换**（同步、问询、解释、定位）、**要求干活**（修改代码、修复缺陷）、**仅提示关联**（本 bot 只是被抄送、举例或告知另一方联系人，且没有要求本 bot 行动）还是**确实歧义**，并据此选择当场答复、登记待办、静默结算或澄清。判定 SHALL 由子会话结合请求文本与 Host 提供的结构化 addressing 事实做出；Host MUST NOT 对消息内容做分类，也 MUST NOT 依据关键词、其它 bot mention 或固定句式自动改写判定结果。

信息交换 SHALL 先问后查：子会话 SHALL 先以 `locus_ask_parent` 向 locus 主会话询问；只有当 locus 主会话以 `locus_reply_child` 明确答复没有相关记录，或 `locus_ask_parent` 返回失败时，才 SHALL 用自己的只读能力自行查找。等待答复期间 current Delivery 由既有 deadline 规则保留，子会话可按既有规则用 `pet_locus_wait` 延长。本要求 MUST NOT 承诺\"等待超时后自行查找\"：到达 deadline 的 Delivery 按既有规则进入 `expired` 并撤销发送能力，此后子会话即使被唤醒也 MUST NOT 借该 Delivery 回复，迟到的父答复 MUST NOT 消费后续 Delivery——Host 在答复送达前核对答复携带的询问引用仍对应 current Delivery（见 `pet-locus-collaboration`「子会话读共识与 locus 主会话工具」）；送达后才换代的情况是已知局限。只有确实无需项目事实即可回答的问题（如问候、确认收到、对上一条答复的复述）可以不询问直接答复。

答复正文 SHALL 默认用业务口径：第一句给结论，正文保持简短，不复述问题，不写"我已/我先"一类过程叙述；MUST NOT 主动给出文件路径、函数、变量、RPC 或接口名，除非提问人要求实现细节或来源，或这些名字本身就是问题的答案。提问人追问时再补细节。

权限边界 MUST NOT 依赖该判定：locus 仍默认只读，判定为"要求干活"MUST NOT 使子会话获得任何写能力，判定为其它类别也 MUST NOT 使其获得飞书旁路出站能力。误判的唯一后果是结局选择不当，MUST NOT 导致越权。

信息交换、要求干活和仅提示关联三类确定结局都 SHALL 经既有 `pet_locus_finish` 结算该 Delivery；判定本身 MUST NOT 成为第二个完成入口。仅提示关联 SHALL 使用 `no-reply` 和非空审计原因，MUST NOT 发送业务正文，也 MUST NOT 用 `pet_locus_wait` 将该 Delivery 留在队头。

#### Scenario: 信息交换当场答复
- **WHEN** 子会话判定一条 Delivery 属于信息交换，并已得到答案
- **THEN** 它以 `pet_locus_finish` 的 `reply` 提交答案，不登记待办

#### Scenario: 信息交换先问主会话
- **WHEN** 子会话判定一条需要项目事实的 Delivery 属于信息交换
- **THEN** 它在调用任何文件读取或搜索工具之前先调用 `locus_ask_parent`，current Delivery 保持未结算等待答复

#### Scenario: 主会话无记录后自行查找
- **GIVEN** 子会话已就一条信息交换 Delivery 调用 `locus_ask_parent`
- **WHEN** locus 主会话答复"工作会话没有相关记录，请自查"
- **THEN** 子会话才用自己的只读能力查找，并以查到的结论答复；答复不宣称该结论来自工作会话

#### Scenario: 询问失败后自行查找
- **WHEN** `locus_ask_parent` 返回确定性失败原因（例如投递失败）
- **THEN** 子会话直接用自己的只读能力查找并答复，不再等待父答复

#### Scenario: 询问已投递但始终没有答复
- **GIVEN** 子会话已就 Delivery D 调用 `locus_ask_parent` 并投递成功，locus 主会话始终没有答复
- **WHEN** D 到达 deadline
- **THEN** D 按既有规则进入 `expired`，没有业务正文发出，队列推进；此后子会话对 D 调用 `pet_locus_finish` 被拒

#### Scenario: 父答复在 Delivery 过期后才到达
- **GIVEN** D 已 `expired`，同一入口的下一条 Delivery E 已成为 current
- **WHEN** locus 主会话此时才调用 `locus_reply_child` 答复 D 的询问
- **THEN** Host 以"询问已过期"拒收，子会话收不到该答复；D 保持 `expired`，E 保持 current 且未被结算

#### Scenario: 默认业务口径
- **WHEN** 提问人只问某个功能"是什么逻辑"，没有要求实现细节
- **THEN** 答复第一句是结论，正文不含文件路径、函数名、变量名或 RPC 名

#### Scenario: 追问实现细节时补充
- **WHEN** 提问人在后续消息里要求说明具体在哪个文件、哪个接口
- **THEN** 子会话在新的答复中给出文件或接口名

#### Scenario: 要求干活登记待办
- **WHEN** 子会话判定一条 Delivery 属于要求干活
- **THEN** 它先登记待办，再以 `pet_locus_finish` 的 `reply` 回执受理事实，MUST NOT 尝试直接修改文件

#### Scenario: 仅提示另一 bot 作为联系人
- **WHEN** 消息同时 at 本 bot 与另一个 bot，但语义只是告诉另一方"有问题可以找本 bot"，没有请求本 bot 回答或执行
- **THEN** 子会话以 `pet_locus_finish(no-reply)` 静默结算并记录 reference-only 原因，队列继续推进

#### Scenario: 多 bot 语义不明确
- **WHEN** 消息同时 mention 多个参与方，且结合结构化 addressing 与文本仍无法确认本 bot 是任务对象还是关联方
- **THEN** 子会话按确实歧义处理，不把"出现其它 bot"本身当成 reference-only

#### Scenario: 误判不产生越权
- **WHEN** 子会话把一条信息交换请求误判为要求干活并尝试写入文件
- **THEN** 写入仍按现行权限模型被拒绝，判定结果 MUST NOT 作为授予写能力的依据

### Requirement: 意图不明时至多澄清一次且不跟丢

子会话无法判定当前 Delivery 属于信息交换、要求干活或仅提示关联时 SHALL 向当前飞书入口发出一次简短澄清。澄清正文 SHALL 通过 caller-bound `pet_locus_finish(reply)` 发送，并 SHALL 终结该 current Delivery、推进队列；普通 assistant 文本 MUST NOT 被当作已经发送的澄清。

用户后续合格的 at/reply SHALL 被接受为新的 Delivery，并在同一长期 child session 及其历史中继续理解；系统 MUST NOT 为此恢复旧 Delivery、重建 child 或允许新回答绕过正常队列。新 Delivery 可依据已保存历史直接分类；同一 Delivery 不得发出第二次澄清。

澄清结算后若用户没有后续消息，系统 MUST NOT 自动登记待办，也 MUST NOT 依赖不存在的 model turn 或 deadline hook 推断用户沉默。只有新的 Delivery 明确表达要求干活，或在该新 Delivery 中仍需按现有规则登记时，才可创建待办。

#### Scenario: 澄清经唯一业务出口发送
- **WHEN** 子会话对 current A 的意图确实无法判定
- **THEN** 它以 `pet_locus_finish(reply)` 发送一次澄清，A 进入已回复终态；普通 assistant turn/end 不承担发送

#### Scenario: 澄清后的回答是新 Delivery
- **WHEN** A 的澄清已结算，用户随后 at 回答“只要你看一下原因”形成 B
- **THEN** B 按正常接受顺序成为新 Delivery，由同一 child 结合自身历史按信息交换处理，不重新打开 A

#### Scenario: 用户不再回答
- **WHEN** 澄清 Delivery 已结算且用户没有发送后续合格消息
- **THEN** 系统不创建待办、不保留 current，也不安排虚构的超时模型轮次

#### Scenario: 新回答仍然歧义
- **WHEN** 后续新 Delivery 结合同一 child 历史仍无法判定意图
- **THEN** 该新 Delivery 可按本要求独立发出至多一次澄清；限制按 Delivery 计数，系统不得在同一 Delivery 内重复追问

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

### Requirement: 管理面呈现待办并提供由固定标识派生的跳转

所有者管理面 SHALL 呈现待办，按来源入口与状态组织，并展示其请求人、登记时间、证据摘要与当前状态。管理面 SHALL 支持所有者受理、标记完成或标记放弃。

管理面 SHALL 使每个动作自述其真实效果：受理 SHALL 自述它会投递跟进任务、开始处理并转到执行目标会话；完成与放弃 SHALL 自述它们只改变记录且为终态。MUST NOT 把会产生投递的动作描述为纯标记。

每条待办 SHALL 提供两个由已固定标识派生的跳转：**跳飞书**按 `endpoint` 与触发 `messageId` 定位原始消息；话题待办指向该话题，无法证明话题身份时 SHALL 退化为所属群并如实说明，MUST NOT 伪造话题目标。**跳飞书**的上述定位规则只适用于 IM 入口（`endpoint.chatId` 不以 `doc:` 开头）。来源为文档入口的待办，**跳飞书** SHALL 打开 Host 以 bot 身份 `drive +inspect` 得到的文档 URL。评论级待办 SHALL 在链接旁注明所属评论 id，MUST NOT 被当作话题处理，也 MUST NOT 伪造评论锚点。文档 URL 无法取得时，MUST NOT 提供可用跳转，SHALL 就地说明原因。**跳会话**按 `locusId` 解析当前代子会话。

管理面 SHALL 沿用既有 fail-closed 规则：目标已归档、已失效或不可达时 MUST NOT 提供可用跳转，SHALL 就地说明原因，MUST NOT 产生一次静默导航。待办所属 locus 已退役 MUST NOT 使该行从列表消失，其飞书跳转在平台资源仍存在时 SHALL 保持可用。

所有者受理成功且已发生投递时，管理面 SHALL 导航到本次**执行目标解析**得出的会话。该目标 SHALL 取自受理操作返回的执行目标事实，MUST NOT 由界面自行推导，也 MUST NOT 与登记这条待办的子会话混为一谈——二者是不同的会话，跟进任务投给前者。

受理失败时 MUST NOT 导航，SHALL 留在原地并说明原因。界面缺少导航能力时，受理 SHALL 照常完成并就地保留回执，MUST NOT 因此把一次已成功的投递表述为失败。子会话经工具请求执行 MUST NOT 触发任何界面导航。

导航 MUST NOT 使所有者失去本次投递结局的区分。成功导航时，系统 SHALL 以不随管理面关闭而消失的形式呈现该结局，使所有者仍可分辨跟进任务是已开始还是排队等待。

#### Scenario: 受理动作自述会开工
- **WHEN** 所有者查看一条待处理待办的受理动作说明
- **THEN** 说明指出该动作会投递跟进任务、开始处理并转到执行目标会话，而非仅改变记录

#### Scenario: 受理成功后转到执行目标会话
- **WHEN** 所有者受理一条待办且投递成功
- **THEN** 界面导航到受理操作返回的执行目标会话，而非登记该待办的子会话

#### Scenario: 导航后仍能分辨投递结局
- **WHEN** 一次受理以排队结局成功并触发导航
- **THEN** 结局以不随管理面关闭而消失的形式呈现，所有者仍可分辨其为排队而非已开始

#### Scenario: 缺少导航能力时受理照常完成
- **WHEN** 一次受理投递成功但界面不具备导航能力
- **THEN** 该受理仍为成功、待办为已受理，回执就地保留，不发生导航

#### Scenario: 受理失败不导航
- **WHEN** 一次受理因目标不可达而失败
- **THEN** 界面留在原地并说明失败原因，不发生任何导航

#### Scenario: 请求执行不触发界面导航
- **WHEN** 子会话经工具请求执行并投递成功
- **THEN** 不产生任何界面导航

#### Scenario: 话题待办跳回原话题
- **WHEN** 所有者点击一条来自话题的待办的飞书跳转
- **THEN** 跳转指向该话题内的原始触发消息

#### Scenario: 话题身份不可证时退化
- **WHEN** 待办来自话题但其话题标识无法证明
- **THEN** 跳转退化为所属群并说明原因，不伪造话题目标

#### Scenario: 会话已归档时不可跳转
- **WHEN** 待办所属 locus 的当前代子会话已归档
- **THEN** 会话跳转不可用并显示原因，飞书跳转不受影响

#### Scenario: 退役 locus 的待办仍在列表中
- **WHEN** 某待办所属 locus 已退役
- **THEN** 该待办仍呈现在列表中并可被处置，其状态如实标明来源已退役

#### Scenario: 文档评论待办跳到文档
- **GIVEN** 待办登记于评论级入口 `(doc:docx:D, c2)`，`drive +inspect` 返回 `url=https://www.feishu.cn/docx/D`
- **WHEN** 管理面渲染该待办的“跳飞书”
- **THEN** 链接为 `https://www.feishu.cn/docx/D`，旁注评论 id `c2`；链接中不含 IM 消息或话题参数，跳转类别不是话题

#### Scenario: 文档 URL 不可得
- **GIVEN** 待办来源为文档入口，`drive +inspect` 调用失败
- **WHEN** 管理面渲染该待办
- **THEN** 不提供可用的“跳飞书”，就地说明原因；“跳会话”不受影响

### Requirement: 受理即开工并向主会话投递带上下文的跟进任务

所有者受理一条待办 SHALL 把状态置为已受理，并向该待办台账所归属的主会话投递一条跟进任务。系统 MUST NOT 提供只改状态而不投递的动作，也 MUST NOT 提供只投递而不改状态的动作。本要求约束的是可供所有者选择的**动作**，不对一次受理执行过程中的中间瞬间下禁令。

系统 SHALL 在投递之前校验该待办当前处于待处理。非待处理的待办收到受理请求时 SHALL 被拒绝，且该拒绝 MUST 发生在投递之前——系统 MUST NOT 先投递再依据状态推进失败来发现该请求不合法。

状态推进 SHALL 发生在投递成功之后。投递未发生或失败时，该待办 SHALL 保持待处理，系统 MUST NOT 先行乐观置为已受理。受理失败 SHALL 就地说明原因，且 MUST NOT 使该待办进入任何需要额外动作才能恢复的状态。

投递成功而状态写入失败时，系统 SHALL 记录结构化日志，MUST NOT 自动重投。该待办仍呈现为待处理，所有者可再次受理；系统 MUST NOT 声称此时已无跟进任务送达。

投递目标 SHALL 由 Host 对该待办执行一次**执行目标解析**得出，其输入只有待办已固定的归属事实。系统 MUST NOT 向所有者或模型开放任何 session、chat、thread 或 target selector；归属不可证明、目标会话已归档或无法恢复时，受理 SHALL 失败且该待办保持待处理，MUST NOT 猜测替代目标。

解析 SHALL 表达「谁登记谁处理，无执行能力则转交」这一规则，而非直接等同于某个固定会话。登记待办的 locus 子会话当前不具备执行能力，因此本规范下解析结果 SHALL 恒为该台账的主会话。系统 MUST NOT 把"转交主会话"表述为待办的固有属性，也 MUST NOT 在解析之外另设寻址路径——受理与子会话请求执行 SHALL 经同一次解析得到目标。

主会话 SHALL 是跟进待办的执行位置。登记待办的子会话按既有权限模型默认只读且不得直接修改文件，因此跟进 MUST NOT 被投递给子会话或以提升子会话权限的方式完成。系统 MUST NOT 因跟进需要而改变任何 locus 的生效权限档位。

投递正文 SHALL 由 Host 组装，MUST NOT 由模型或所有者自由撰写。正文 SHALL 至少陈述：这是一条 locus 待办的跟进任务、该待办的标识、原始请求人、登记时间、来源入口、登记时的证据摘要，以及"先读取上下文再推进"的行动指引。正文 SHALL 如实标注证据为登记时刻的快照而非当前结论。

投递正文 SHALL 把登记证据置于结构上可识别的不可信位置。证据文本由子会话依据第三方消息撰写，因此 SHALL 只出现在正文的**最后一段**，其后 MUST NOT 再出现任何由 Host 生成的文本；全文 SHALL 至多有一个这样的证据段，且该段 MUST NOT 设置结束定界符。请求人标识由平台提供而非用户自由撰写，不受此限。

正文 SHALL 在证据段之前声明该段来自第三方输入、仅供参考。该声明是降低误读的缓解措施，MUST NOT 被表述为对模型行为的保证；本规范据此 MUST NOT 对模型是否遵从该声明设定可验收条件。系统 MUST NOT 以关键词过滤或模式匹配替代上述结构约束。

注入成功的后果上限 SHALL 由接收该投递的主会话自身的能力与权限决定，而非由 locus 子会话的权限档位决定。本要求 MUST NOT 被理解为访问控制；系统 MUST NOT 因已实施该结构约束而放宽任何既有权限约束，也 MUST NOT 把子会话的只读档位表述为主会话的后果边界。

当主会话在建立时收到过声明其保持待命的开场简报时，该声明描述的是建立时的初始状态，MUST NOT 被表述为对该会话的永久禁令。投递正文 SHALL 显式说明本次是所有者发起的真实任务、待命状态到此结束，使模型不必自行判断两条先后到达的指令孰先孰后。未收到过此类简报的主会话，正文 MUST NOT 包含该声明——它会暗示一个从未存在的约束。

受理的投递是系统内部的跟进，MUST NOT 产生任何飞书出站正文、表情或 Delivery。

#### Scenario: 受理同时置状态并投递
- **WHEN** 所有者在管理面受理一条待处理的待办
- **THEN** 该待办变为已受理，且其主会话收到一条由 Host 组装的跟进任务

#### Scenario: 投递正文携带待办上下文
- **WHEN** Host 为一次受理组装跟进正文
- **THEN** 正文包含该待办的标识、请求人、登记时间、来源入口与登记时证据摘要，并指引先读取上下文再推进

#### Scenario: 证据如实标注为登记时快照
- **WHEN** 跟进正文引用登记时收集的证据
- **THEN** 正文说明该证据是登记时刻的事实，不呈现为当前仍然成立的结论

#### Scenario: 证据位于正文末段之后无 Host 文本
- **WHEN** Host 为一次受理组装跟进正文
- **THEN** 证据文本出现在正文的最后一段，其后不再出现任何由 Host 生成的文本

#### Scenario: 证据段不设结束定界符
- **WHEN** Host 组装的跟进正文包含证据段
- **THEN** 该段只有起始标记而没有结束标记，且全文至多有一个证据段

#### Scenario: 伪造定界符不能使后续文本脱离证据段
- **WHEN** 一条待办的证据文本中含有与正文起始标记相同的字符串、Markdown 代码围栏或形似段落结束的内容
- **THEN** 该文本仍全部位于正文末段之内，正文的指令段内容不因其出现而改变

#### Scenario: 正文声明证据来自第三方
- **WHEN** 跟进正文包含证据段
- **THEN** 正文在该段之前声明其来自第三方输入、仅供参考

#### Scenario: 收到过待命简报的主会话被告知待命结束
- **WHEN** 待办的主会话在建立时收到过声明其保持待命的开场简报
- **THEN** 跟进正文显式说明这是所有者发起的真实任务且待命状态到此结束

#### Scenario: 未收到待命简报的主会话不被告知解除
- **WHEN** 待办的主会话在建立时从未收到声明待命的开场简报
- **THEN** 跟进正文不包含待命状态结束的声明

#### Scenario: 跟进不投给只读子会话也不提权
- **WHEN** 所有者受理一条由只读子会话登记的待办
- **THEN** 跟进任务被投递至主会话，系统不投递给子会话，也不改变任何 locus 的生效权限档位

#### Scenario: 目标不可达时不置已受理
- **WHEN** 待办所属主会话已归档或无法恢复
- **THEN** 受理失败并就地说明原因，该待办的状态仍为待处理

#### Scenario: 投递失败后可以重新受理
- **WHEN** 一次受理因投递失败而未改变状态
- **THEN** 该待办仍为待处理并可被再次受理，不因上次失败而进入需要额外动作才能恢复的状态

#### Scenario: 已受理的待办不能再次受理
- **WHEN** 所有者对一条已受理的待办再次发起受理
- **THEN** 该请求被拒绝，不产生第二次投递

#### Scenario: 终态待办的受理请求在投递前被拒
- **WHEN** 一个过期的界面或重放的请求对一条已完成或已放弃的待办发起受理
- **THEN** 该请求被拒绝且未发生任何投递，主会话不收到跟进任务

#### Scenario: 受理不外发飞书
- **WHEN** 所有者受理一条待办并完成投递
- **THEN** 系统不向原飞书入口发送任何正文或表情

### Requirement: 受理投递按队列语义接入主会话且不打断在途工作

投递 SHALL 作为一个独立的普通轮次进入目标主会话。目标会话正在执行其它工作时，投递 SHALL 排队等待其当前轮次自然结束，MUST NOT 打断、抢占或改写在途工作的当前步。目标会话未加载时，系统 SHALL 先恢复该会话再投递，MUST NOT 因未加载而拒绝受理。

受理操作 SHALL 返回本次投递的结果事实，至少区分已投递、目标忙碌且已排队、目标不可达三种结局，不可达时并附失败原因。已发生投递时该结果 SHALL 同时携带本次解析出的执行目标，使调用方无需自行推导即可定位该会话。该结果 SHALL 是本次操作的一次性回执，MUST NOT 被持久化到待办自身，也 MUST NOT 由待办的行状态反推。不产生投递的动作 MUST NOT 返回投递结果。

管理面 SHALL 如实区分并呈现这三种结局。系统 MUST NOT 把已排队表述为已开始处理，也 MUST NOT 把已投递表述为该事项已完成。

#### Scenario: 受理返回投递结果事实
- **WHEN** 所有者受理一条待办
- **THEN** 该操作返回本次投递的结局，取值区分已投递、已排队与不可达，不可达时附失败原因

#### Scenario: 不投递的动作不返回投递结果
- **WHEN** 所有者把一条待办标记为已完成或已放弃
- **THEN** 该操作不返回任何投递结果

#### Scenario: 投递结果不写入待办
- **WHEN** 一次受理成功投递后管理面重新读取待办
- **THEN** 待办自身不携带投递结果，系统不从其行状态推断是否已投递

#### Scenario: 目标忙碌时排队不打断
- **WHEN** 受理投递时目标主会话正在执行其它轮次
- **THEN** 该跟进任务排队等待当前轮次结束，在途工作不被打断，管理面说明已排队

#### Scenario: 目标未加载时先恢复
- **WHEN** 受理投递时目标主会话未加载
- **THEN** 系统先恢复该会话再投递，受理不因未加载而失败

#### Scenario: 已排队不等于已处理
- **WHEN** 一条待办已受理且其跟进任务仍在目标会话队列中
- **THEN** 管理面呈现为已投递/排队中，不呈现为已完成

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

#### Scenario: 所有者受理投递失败不记为已受理
- **GIVEN** 一条待办为待处理（`open`）
- **WHEN** 所有者受理时，向干活主会话的跟进投递失败
- **THEN** 待办保持 `open`，不写入 `accepted`，返回投递失败原因；所有者可再次受理

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
