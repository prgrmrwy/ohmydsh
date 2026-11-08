# pet-locus-collaboration Specification

## Purpose

统一描述研发工作上下文与飞书协作现场的关联：所有入口先取得主会话，再由专属子会话持续服务。覆盖研发先行、project 群先行、群与话题的层级补齐、双向发现、权限及上下文切换，不以旧 QA 或 workspace executor 的实现分类组织产品。

## Requirements

### Requirement: 管理面的会话可用性以持久证据判定

管理面展示工作会话 W、locus 主会话 M 与子会话的可用性时 SHALL 以持久化日志的冷读结果为证据，MUST NOT 以会话当前是否已加载到内存作为存在性判据。已归档 SHALL 优先于可读性判定。宿主不具备冷读能力时 SHALL 省略该事实，MUST NOT 以宿主自身限制推断会话缺失。`not-created` 入口的 `sessionId` 只是预留值，对应会话尚不存在：管理面 MUST NOT 对其冷读，MUST NOT 把它报为「不可用」，SHALL 只在入口状态处显示一次「未创建」，子会话跳转置灰并以「尚未创建」为原因。

同一会话在未发生任何状态变化时，其可用性读数 MUST NOT 因加载与卸载而改变。

#### Scenario: 重启后未加载的会话不得报为不可用
- **WHEN** Host 重启后所有者查看一条 `active` 入口，其 W、M 与子会话尚未被打开
- **THEN** 只要持久化日志可读，三者显示为可用并给出各自标题，不因未加载而报为不可用

#### Scenario: 已归档优先于可读
- **WHEN** 会话已归档但其日志仍可读
- **THEN** 显示为已归档，不显示为普通可用

#### Scenario: 缺少冷读能力不臆测
- **WHEN** 宿主未提供会话冷读能力
- **THEN** 省略可用性事实，不断言会话缺失

#### Scenario: 未创建入口的预留会话不报缺失
- **GIVEN** 入口 `state = not-created`，其预留 `sessionId` 没有任何持久化日志
- **WHEN** 管理面呈现该入口
- **THEN** 该行只显示一次「未创建」；子会话跳转置灰且原因为「尚未创建」；页面不出现「不可用」或「缺失」字样，也不对该预留 `sessionId` 发起冷读

### Requirement: 全部飞书工作统一为子会话常规交互

新模型 SHALL 仅对 mention 自身 bot 的消息触发工作，包括单聊；普通非 mention 内容 MUST NOT 启动推理、总结或自动更新主会话。消息 SHALL 由对应 locus 的同一个长期 child session 持续处理（子会话在入口第一条消息到达时才创建，见"子会话在首条消息到达时创建"），MUST NOT 建立飞书 root executor/Invocation 或 waiting-user 执行分支。

每个 locus SHALL 维护按接受序排列的持久 Delivery 队列，任意时刻至多向 child 投递一个 current Delivery。后续合格消息 SHALL 先进入 backlog，只有 current 进入终态后才可投递下一条未过期消息；MUST NOT 依赖 DSH `next-turn`/`next-step` 的合批顺序推断两个飞书请求或父回复的业务归属。

子会话需要决策时 SHALL 直接向当前飞书入口发问，后续 at 回答 SHALL 在同一子会话继续。歧义回答 SHALL 澄清，不自动解释为授权。模型 turn 结束 MUST NOT 被显示为整个项目完成，也 MUST NOT 单独完成 current Delivery。Host 超时推进 SHALL 继续复用同一个 child session及其历史，MUST NOT 自动重建 session 或更换入口行的 `sessionId`。

子会话的运行体驻留 SHALL NOT 被当作入口可用性的一部分。运行体 MAY 在子会话空闲且 inbox 为空时释放它（这是常态而非故障），因此宿主 MUST 以「按需冷恢复该 durable child」的方式取得其 live session 与策略，MUST NOT 因「当前不在内存中」判定该 child 不可用、把入口置为 `invalid` 或另建 child。宿主 MUST NOT 依赖借出子会话 Session 的兼容能力：需要 live agent 的操作（如就地改沙箱、回读）只在子会话常驻时经 `ctx.agents.get` 进行，否则延后到下一次 `agent/created`；投递经官方 `startContinuable`（首条）与官方 Host prompt 队列（后续，官方负责冷恢复）。

#### Scenario: 普通资料发布
- **WHEN** 成员发送 PRD、Figma、会议资料但未 at bot
- **THEN** 不执行工作；将来被 at 时可按权限按需读取，不宣称已吸收资料

#### Scenario: 决策往返
- **WHEN** 子会话询问方案 A/B，用户随后 at 回复 B
- **THEN** 后续轮次在同一子会话继续，不恢复某个飞书 Invocation

#### Scenario: 多人连续提问
- **WHEN** current Delivery 处理期间又接受两条合格 at
- **THEN** 两条消息按接受序持久进入 backlog，不提前进入 child inbox；current 终结后再逐条投递且各自保持触发消息关联

#### Scenario: 父回复与下一条飞书消息不会合批
- **WHEN** current A 正在等待父会话上下文，同时飞书消息 B 已被接受
- **THEN** B 留在 Pet backlog，父回复只继续同一 child 对 A 的处理；A 终结前 Host 不把 B 投递到 DSH inbox

#### Scenario: 超时不重建会话
- **WHEN** current Delivery 达到 Host deadline 而未完成
- **THEN** Host 终结该 Delivery、尽力中止其当前运行并在同一 child session 上推进下一条，保留该 locus 已积累的 session 历史

#### Scenario: 业务结算后下一条仍为独立轮次
- **GIVEN** current A 已业务结算，但其运行 turn 尚未结束，消息 B 已在 backlog；父回复经 `sendMessage` 只续进 A
- **WHEN** Host 派发 B
- **THEN** B 经官方 Host `queuePrompt` 以 `user` 来源排入独立后续轮次，持久绑定 B 自己的 inbox UUID；不使用 `steer` 并入 A，不把父回复认作 B 的投递证据

### Requirement: 上下文按实际子会话绑定并允许按需问主会话

新建及原地重建（含改绑后重新创建）的子会话 SHALL 使用独立上下文，不复制主会话已完成前缀、进行中轮次或默认父摘要；初始化 SHALL 只包含自身身份、所服务入口、可信工作归属、`accessMode` 和按需询问说明。子会话 SHALL 被明确描述为当前入口的服务者，而非主会话本人。其自身交互 SHALL 持续保存，冷恢复 SHALL 恢复同一 child 历史，不重新播种父上下文。独立历史 MUST NOT 被解释为创建新的工作目录、丢失工具组合或静默更换模型。

系统 SHALL 在创建前核验所用 provider 确实不继承父上下文；无法证明时 SHALL 拒绝创建并如实报告，MUST NOT 静默退回复制父历史的 provider，也 MUST NOT 把拒绝表述为已建立独立 child。原地重建与改绑后新建的子会话 MUST NOT 继承旧子会话的历史，也不迁移协作条目；Host 只在首投前言中说明情况（见「投递 prompt 的首投前言与逐次档位声明」），不提供任何新的读取能力。已有 fork child 不受本条影响：它们不会被本 change 的创建路径重新创建，其历史 MUST NOT 被裁剪或静默改造。

初始化任务书 SHALL 告知子会话在工作根、约束或相关事实不足时，可通过宿主原生消息能力询问 caller-bound 父会话即 locus 主会话，MUST NOT 允许指定其它 parent 或 locus。locus 主会话不知道干活现场的事实时 SHALL 经 dsh-collab 向工作主会话提问，再以 `locus_reply_child` 回复子会话。父会话回复只是对话事实，SHALL NOT 因此成为持久授权。答复只提供上下文事实；路径存在性不等于写授权。

父子或 agent 间的 `agent-message` SHALL 只作为子会话上下文通信，不参与 Delivery 路由选择：它 MUST NOT 建立、修改、替换或撤销 current Delivery 已由 Host 绑定的回复目标。current Delivery 存续时，原始飞书投递 turn 结束后的 `agent-message` SHALL 可唤醒同一 child 继续处理该 current；没有唯一 current 时，`agent-message` MUST NOT 自行产生飞书 finish/wait 能力。GUI/user steer、来源不明的参与者消息与第二个已投递 Delivery仍 SHALL fail closed。

caller-bound `pet_context` SHALL 提供当前 locus、局部项目入口、所属工作区、`accessMode` 与 Host 确认的 current Delivery 状态，不允许模型指定其它目标。后续投递只带必要请求事实和查询引导，MUST NOT 每次重复全部说明。无法确定的事实（如执行根）SHALL 如实报告。系统 MUST NOT 自动汇总或把子会话结论回传工作主会话；官方结算通知送达 locus 主会话是明确例外，且收到通知不等于结论已被采纳为 agreed charter 或已被工作主会话知晓；对实际询问的定向答复不属于自动结算回报。所有者可主动查阅，项目资料 SHALL 按需读取，不自动共享兄弟子会话历史。

工作主会话 SHALL 被表述为工作归属，locus 主会话为可询问的上下文来源，MUST NOT 因其父节点身份宣称已统合所有协作现场的最新认知。用户显式发起的查阅与汇总不属于自动回传；系统 SHALL 区分可发现、可读取与已采纳，缺少历史读取能力或权限时如实说明。当前模型 MUST NOT 宣称已提供 project 级自动知识同步或多人分布式协同。`chat_bindings` 的退休标记路径已删除：带旧标记的群在授权 at 时按 auto 规则从零创建。

#### Scenario: 长父历史不能冒充子身份
- **WHEN** 活跃主会话已有大量 GUI 验收对话并创建新 Q&A child
- **THEN** 新 child 不含这些对话或默认摘要，首轮只以自己的入口身份处理请求，不延续父会话验收任务

#### Scenario: 业务完成只经统一工具提交
- **WHEN** 独立 child 完成一条 current Delivery 的处理
- **THEN** 它只调用 caller-bound `pet_locus_finish`，以 `reply` 提交正文或以 `no-reply` 提交原因；普通 assistant 文本和 turn 正常结束均不完成 Delivery

#### Scenario: 无法证明独立能力时拒绝创建
- **WHEN** 当前 runtime 无法证明所用 provider 不继承父上下文
- **THEN** 创建失败并报告能力不可用，不退回复制父历史的 provider，不把失败表述为已建立独立 child

#### Scenario: 历史不含最新目录
- **WHEN** 子会话自己的上下文及入口所属工作区事实无法确定当前执行根
- **THEN** 可按需询问主会话或请求所有者确认，不猜 cwd，不擅自创建另一个工作目录

#### Scenario: 主会话无法回答
- **WHEN** 补问信息无法取得
- **THEN** 报告未确认，不把请求接受当作已收到答复，不放宽权限

#### Scenario: 跨 turn 父回复继续 current Delivery
- **WHEN** child 在处理唯一 current Delivery 时经原生消息询问父会话，原始飞书 turn 随后结束，父回复再以 `agent-message` 唤醒后续 turn
- **THEN** 该消息只补充 child 上下文，current Delivery 仍保持同一 Host 绑定目标，child 可在后续 turn 调用 `pet_locus_finish`

#### Scenario: 单独的 agent 消息不能获得飞书能力
- **WHEN** child 当前没有唯一 current Delivery 而只收到一条 `agent-message`
- **THEN** 该上下文消息不建立飞书回复目标，`pet_locus_finish` 与 `pet_locus_wait` 均拒绝修改或发送

#### Scenario: GUI 流量仍不能消费 current
- **WHEN** current Delivery 存续期间，同一 child 收到 GUI/user 输入或来源不明的参与者消息
- **THEN** 该执行不能调用 finish/wait 消费 current，系统不得借 current 目标发送混合任务正文

#### Scenario: 新话题上下文
- **WHEN** 群子会话已积累讨论而新话题子会话建立
- **THEN** 新 child 固定主会话归属及项目入口，但不复制主会话或群子会话历史，需要相关事实时定向询问

#### Scenario: 子会话发现不自动成为主会话认知
- **WHEN** QA 子会话产生新发现，而用户未发起主会话查阅或采纳，也没有关联询问
- **THEN** 系统不自动更新工作主会话，不将该发现呈现为工作主会话已知的项目决策；locus 主会话可能收到官方结算通知，但这不构成采纳

#### Scenario: 用户主动查阅受实际能力约束
- **WHEN** 用户要求查阅一个可通过索引发现、但当前无权读取或缺少宿主读取能力的子会话历史
- **THEN** 如实说明限制，不把找到 locus 表述为已读取或已汇总内容

#### Scenario: 冷恢复保留独立历史
- **WHEN** 独立 child 已有自己的多轮对话，Host 重启后恢复
- **THEN** 恢复同一 child 的历史，不插入恢复时的父历史，不更换身份

#### Scenario: 旧 fork child 不受影响
- **GIVEN** 存在继承父前缀的旧 child，指向它的旧模型 locus 行已被离线迁移清除
- **WHEN** Host 启动并处理任意入口的消息
- **THEN** 该 child 的会话历史不被裁剪或改造；没有任何 locus 行引用它，Pet 不向它投递、不 adopt 也不冷恢复它

#### Scenario: 重建后的子会话不继承旧子会话历史
- **GIVEN** 入口 A 的子会话 C0 已有多轮对话，A 因 `invalid` 被原地重建，预留新的 `sessionId` C1
- **WHEN** A 的下一条授权 at 创建 C1
- **THEN** C1 的初始上下文不含 C0 的任何历史；C0 不被冷恢复、不被投递；协作空间中的条目不被复制

### Requirement: 投递与结算关联独立于会话运行状态

每条接受消息 SHALL 有持久 Delivery，至少标识以下各项：入口、`locusId`、`sessionId`、触发 `messageId`、接受顺序、`acceptedAt`、deadline、队列/终态与出站结果。

投递、结算与 caller-bound 工具的实例匹配键 SHALL 为 `(locusId, sessionId)`，MUST NOT 含任何 generation。每次运行身份变化——原地重建、创建失败轮换、首图降级、改绑、M 迁移——都 SHALL 换新的 `sessionId` 且永不复用，因此旧子会话迟到的事件匹配不上：只能结算它自己名下的那条投递，或被拒绝。Delivery 自身的 deliveryId、executionId、inbox UUID、turn 与来源证明保持不变；locus 行的 `revision` 与 Delivery 的 revision 是两道不同的围栏。

IM Delivery 的 `messageId` 是飞书消息标识。文档 Delivery 的 `messageId` 是 `doc:docx:<token>/<comment_id>/<reply_id>`，它同时是持久去重键，MUST NOT 被当作 IM 消息标识使用。

普通消息标识与评论回复标识 MUST NOT 成为长期 locus 身份，但业务回复 MUST 使用 current Delivery 不可变的触发目标：
- IM 群级与话题级回复都 MUST 以触发 `messageId` 做飞书按消息回复；话题回复还 MUST 留在 Host 从入站事件确认的原话题。
- 评论级（划词评论）回复 MUST 追加在触发 `comment_id` 所在的评论下，且该 `comment_id` MUST 与入口 `threadId` 相同。
- 文档级（全文评论）入口的回复 SHALL 以 bot 身份在同一文档新建一条全文评论，开头以结构化提及 @ 持久 Delivery 的发送者（飞书不允许回复全文评论，详见 `pet-locus-doc-comments`）。
- 两者的触发 token 都 MUST 与入口 `chatId` 中的 token 相同。任一不一致，或文档级入口的发送者不是可证明的 open id 时，SHALL 以 `association-unproven` fail closed，不发送。

接受不等于投递，投递不等于完成，模型 `turn/end` 不等于 Delivery 终态。初始化、GUI 私聊、父子补问 MUST NOT 消耗 current。Host SHALL 保证每个 locus 至多一个 current，且完成、超时与重复调用通过原子状态竞争只终结该项一次；迟到调用 MUST NOT 消费后续 Delivery 或已更换 `sessionId` 的新实例上的 Delivery。

业务正文唯一完成入口 SHALL 是 caller-bound `pet_locus_finish`。`reply` 必须携带非空正文；`no-reply` MUST NOT 携带正文且必须记录非空原因。工具 MUST NOT 接受任何 Delivery、chat、message、thread、文档、评论、回复或 target selector。Host SHALL 以实际 caller 解析 `(locusId, sessionId)`（须与入口行当前值一致且 `state = active`），并结合 `accessMode` 与唯一 current 解析不可变目标；不满足时 fail closed。

等待入口 SHALL 是 caller-bound `pet_locus_wait({ waitMinutes, reason? })`。`waitMinutes` SHALL 表示从调用时刻起预计还需等待的正整数分钟，单次不得超过 1440；工具可重复调用，只能延长不能缩短 deadline。初始 deadline SHALL 为 `acceptedAt + 1h`，任何声明后的 deadline MUST NOT 超过同一消息 `acceptedAt + 24h`。Host SHALL 返回实际 deadline、剩余分钟与是否触及硬上限；wait MUST NOT 完成 Delivery或关联父回答。

达到 deadline 的 current SHALL 原子进入 `expired` 并推进；超过 `acceptedAt + 24h` 的 backlog SHALL 在投递前直接过期。Host SHALL 尽力中止过期 current 的运行，但中止成功 MUST NOT 成为撤销回复能力或推进队列的前提；持久状态才是权威。超时 MUST NOT 自动重建 child session。

`reply` SHALL 在发送前原子进入 `finishing` 并固定当前 Delivery。平台明确成功 SHALL 记录 `completed/replied`；明确失败 SHALL 记录 `failed`；请求可能已发出但没有可靠确认 SHALL 记录 `unknown-terminal`。三者均 SHALL 推进队列；`unknown-terminal` MUST NOT 自动重发。`no-reply` SHALL 记录 `completed/no-reply` 后推进，不发送正文。

Host SHALL 维护进行中/完成/失败等控制反馈；反馈失败不阻断工作，也不得冒充业务正文。启动恢复 SHALL 在开放 intake 前过期超时项、把遗留 `finishing` 收敛为 `unknown-terminal`、恢复未过期 current 的 deadline 调度，或在无 current 时幂等投递最早未过期 backlog。无法证明 current 与 child 的 `sessionId` 一致时 SHALL 暂停对应 locus 并诊断，不猜目标、不重放发送、不新建替代身份。

`current` 是物理投递栅栏，仅凭身份即可跨重启保留——但它同时覆盖「已在 child 手中」与「投递尚未交接就随进程终止」两种情形。因此启动恢复 SHALL 额外区分这两者：当且仅当子会话自身日志能证明该 Delivery 的 `inboxMessageId` 从未进入任何 turn、且已不在该子会话的待运行队列中时，该行 SHALL 经正常 claim 栅栏重新投递，MUST NOT 仅挂 deadline 等其过期而静默丢失。证明不成立（仍排队、已被 turn 领取、turn 未闭合、日志为空或无法精确折叠）时 MUST NOT 重放，按既有规则保留或记为人工债。

#### Scenario: 群级引用触发消息
- **WHEN** 群 locus 的 current Delivery 由消息 `om_A` 触发且 child 以 `reply` 完成
- **THEN** Host 使用 bot 身份按消息回复 `om_A`，不得只按 `chatId` 发送普通群消息，也不得引用 backlog 中其它消息

#### Scenario: 话题回复留在原话题
- **WHEN** 话题 locus 的 current Delivery 由该话题内消息 `om_T` 触发且 child 以 `reply` 完成
- **THEN** Host 引用 `om_T` 并使用平台 thread reply 语义把正文留在原话题，不回落到群主时间线

#### Scenario: 文档评论回复回到触发评论
- **GIVEN** 评论级 locus `(doc:docx:D, c2)`，current Delivery 的 `messageId` 为 `doc:docx:D/c2/r4`
- **WHEN** child 以 `reply` 调用 `pet_locus_finish`
- **THEN** Host 以 bot 身份对文档 `D` 的评论 `c2` 追加一条回复，不新开评论、不发往任何群，Delivery 记录 `completed/replied`；文档级入口的答复方式（新全文评论并提及提问者）见 `pet-locus-doc-comments`

#### Scenario: 文档回复目标与入口不符
- **GIVEN** 评论级 locus 入口为 `(doc:docx:D, c2)`，持久 Delivery 的 `messageId` 为 `doc:docx:D/c3/r1` 或 `doc:docx:D2/c2/r1`
- **WHEN** child 以 `reply` 调用 `pet_locus_finish`
- **THEN** Host 不发送，Delivery 不进入 `finishing`，拒绝类别为 `association-unproven`

#### Scenario: 升级需离线迁移并先备份
- **GIVEN** 版本戳为 15 的状态库，DSH 已停止
- **WHEN** 执行 `dsh-pet-migrate-state --yes`
- **THEN** 同目录生成 `state.sqlite.v15.bak-<ms>`，用它打开得到的全部行与迁移前相同（它是独占锁内 checkpoint 之后的完整快照）；版本戳变为当前域版本 20；v15 库没有 `locus_mains`，因此原有 locus 行全部属于旧模型并被清除，按"旧数据经 v20 离线迁移清除并整形"处理；随后当前 Host 能打开存储，原 IM 入口在下一条授权 at 时按 auto 规则从零创建（W → M → 群行及触发入口的话题行）

#### Scenario: 未迁移时当前版本拒绝打开
- **GIVEN** 版本戳为 15 的状态库，且未执行迁移
- **WHEN** 以当前版本（≥16）包启动 Host
- **THEN** 存储以 `version-mismatch` 拒绝打开，诊断给出可直接复制的离线迁移命令

#### Scenario: v15 拒绝打开新版本库
- **GIVEN** 版本戳 ≥16、含有文档 locus 的状态库
- **WHEN** 以 v15 包启动 Host
- **THEN** 存储以 `version-mismatch` 拒绝打开，任何以 `doc:` 为前缀的行都不会被加载；用升级时生成的备份覆盖后，v15 Host 能正常打开存储

#### Scenario: turn 结束不完成请求
- **WHEN** current Delivery 的原始模型 turn 正常结束但 child 未调用 `pet_locus_finish`
- **THEN** Delivery 仍为 current，后续 backlog 不投递，父消息可在后续 turn 继续该请求

#### Scenario: 相对等待受绝对上限约束
- **WHEN** 消息在 10:00 接受，child 在不同时刻反复声明相对等待
- **THEN** Host 可按 `now + waitMinutes` 延长 deadline，但最终 deadline 永不晚于次日 10:00，重复声明不能滚动突破 24 小时

#### Scenario: 超时自动开放下一条
- **WHEN** current A 到达 deadline 且 backlog 中 B 尚未超过自身硬上限
- **THEN** A 原子变为 `expired`，Host 尽力中止 A 的运行并在同一 child session 上把 B 设为 current 后投递

#### Scenario: 完成与超时竞争
- **WHEN** `pet_locus_finish` 与 deadline expiry 并发处理同一 current
- **THEN** 只有一个状态转换成功；失败方不得发送正文、重复终结或作用于下一条 Delivery

#### Scenario: 迟到 finish 不消费下一条
- **WHEN** A 已过期且 B 已成为 current，A 的旧运行随后调用 `pet_locus_finish`
- **THEN** Host 拒绝旧调用，不得将其正文发送到 A 或 B，也不得终结 B

#### Scenario: 发送确认未知不重放
- **WHEN** Host 已发起对 current 触发消息的回复，但无法确认平台是否成功
- **THEN** Delivery 进入 `unknown-terminal` 并推进，启动恢复和正常调度都不自动重发该正文

#### Scenario: Host 重启恢复未过期 current
- **WHEN** Host 重启时发现一个未过期 current 且原 `(locusId, sessionId)` 可精确证明
- **THEN** 恢复同一 current、同一 child session 与 deadline 调度，不把 `turn/end` 当完成，不新建替代 session

#### Scenario: Host 重启处理遗留 finishing
- **WHEN** Host 重启时发现发送结果尚未落账的 `finishing` Delivery
- **THEN** 将其收敛为 `unknown-terminal` 并继续队列，不重放可能已经成功的飞书发送

#### Scenario: 私聊与群消息交错
- **WHEN** GUI 私聊或初始化发生在 current 飞书请求处理期间
- **THEN** 不消费该请求、不产生飞书正文，相关执行不能调用 finish/wait 获得 current 能力

#### Scenario: 旧代际迟到结算
- **GIVEN** 入口行的 `sessionId` 因原地重建或改绑由 S0 换为 S1，S1 名下有 current Delivery D1
- **WHEN** S0 的旧子会话出现迟到 finish
- **THEN** 该调用不能更新或终结 D1；S0 名下若仍有自己未结算的投递，只能结算那一条，否则拒绝，无法安全提交时只诊断

#### Scenario: 宿主重启无法证明关联
- **WHEN** 恢复时无法精确证明持久 current 对应原 child 的 `sessionId`
- **THEN** 暂停该 locus intake 并诊断，不猜 FIFO、最近消息或新建替代身份

### Requirement: 管理面的标识以确定性短码表达且名称与短码成对

管理面 SHALL 为每类对象提供由真实标识**确定性派生**的短码，并以该短码作为线索即可复制完整标识。以下每类对象各有一条明确规则：locus、工作会话 W 与 locus 主会话 M 与子会话（同属会话类，靠角色词区分）、群与会话入口、话题、文档入口、评论入口、工作区。文档入口与评论入口的规则：
- 文档入口：源子串取 `chatId` 中 `doc:docx:` 之后的 token，显示标签为 `doc·`，无标题时的名称为 `文档 · <短码>`，名称取 `drive +inspect` 返回的文档标题。
- 评论入口：`comment_id` 是按时间递增的数字，前缀相同的情况很常见，因此源子串取 `threadId`（`comment_id`）的**逆序**字符串，使截取的前缀落在末尾数字上。显示标签为 `cmt·`，无名称时的名称为 `评论 · <短码>`。
- 碰撞时按类别加长，沿用现有规则。
- 不同类别靠显示标签区分，不依赖源子串不同。短码 MUST NOT 被用作任何请求的输入或身份来源，包括「改绑到其他会话」中输入的目标工作会话：该输入 SHALL 是完整 sessionId，管理面 MUST NOT 把短码解析为 sessionId。当平台提供可辨识名称时，管理面 SHALL 优先呈现名称，且名称 SHALL 与短码成对出现——名称单独 MUST NOT 构成身份。平台未提供名称时，管理面 SHALL 只呈现由角色词与短码构成的名称（`入口 · <短码>`、`话题 · <短码>`、`文档 · <短码>`、`评论 · <短码>`），MUST NOT 附加「兜底显示」或「兜底名」一类标记，MUST NOT 猜测平台事实（例如在 chat 类型未知时写成「群」）。原始标识 MUST NOT 作为入口行的主要标识，SHALL 收在可展开的标识区并可复制。

#### Scenario: 同名入口仍可区分

- **WHEN** 同一工作会话下两个入口的平台名称同为「答疑 · DSH」
- **THEN** 两行分别显示名称并各自附带不同的短码，所有者可区分二者

#### Scenario: 名称不可得时不猜测

- **WHEN** 平台未提供该入口的名称，且该 chat 的类型未知
- **THEN** 管理面显示角色词 + 短码（如 `入口 · <短码>`、`话题 · <短码>`），页面不含「兜底」字样，不得显示为「群」或其它未证实的平台事实

#### Scenario: 短码不是身份

- **WHEN** 客户端尝试以短码发起任一 locus 操作，或在「改绑到其他会话」的输入框里填入短码
- **THEN** 前者不被接受；后者按所填字符串原样作为 `workSessionId` 提交，由 Host 拒绝，管理面不做短码到 sessionId 的映射；所有 locus 操作仍以 `locusId` 与 `revision` 栅栏寻址

#### Scenario: 文档入口短码确定且与群可区分
- **GIVEN** 文档入口 `doc:docx:AbCdEf123`，以及群入口 `oc_AbCdEf123`
- **WHEN** 分别多次计算两者的显示短码
- **THEN** 文档入口每次都显示以 `doc·` 开头、源自 `AbCdEf123` 的同一短码；群入口显示以 `oc·` 开头的短码；两者完整显示文本不同

#### Scenario: 多个文档入口短码互不相同
- **GIVEN** 两个文档入口 `doc:docx:AAAA1111` 与 `doc:docx:AAAA2222`
- **WHEN** 管理面同时呈现二者
- **THEN** 两个短码不同，且都不是 `doc:` 这样的公共前缀

#### Scenario: 同前缀的评论入口短码可区分
- **GIVEN** 同一文档下的两个评论入口，`comment_id` 分别为 `7696945640885996815` 与 `7696945648012135660`（前 9 位相同）
- **WHEN** 管理面同时呈现二者
- **THEN** 两个短码分别为 `cmt·5186` 与 `cmt·0665`；两行都不以完整 `comment_id` 作为主要标识

#### Scenario: 文档标题不可得
- **GIVEN** `drive +inspect` 读取文档 `D` 的元数据失败
- **WHEN** 管理面呈现该文档入口
- **THEN** 只显示 `文档 · <短码>`，页面不含「兜底」字样

### Requirement: 管理面提供双向可达且目标不可达时 fail closed

管理面 SHALL 提供两种读法：按工作会话（列出该 W 的全部入口）与按入口（列出该入口及其 W、M 与子会话）。两种读法 SHALL 由同一份管理快照的同源索引产生，同一对象的呈现 MUST NOT 相互矛盾。每个入口行 SHALL 提供跳转到该入口子会话与对应飞书入口的控件；按入口读法 SHALL additionally 提供跳转到 W 与 M 的控件。目标已归档、已失效、尚未创建或不可达时，管理面 MUST NOT 提供可用的跳转，SHALL 就地说明原因。话题入口的跳转 SHALL 指向该话题，无法证明话题身份时 SHALL 退化为所属群并如实说明，MUST NOT 伪造目标。

#### Scenario: 两种读法同源一致

- **WHEN** 所有者先在按工作会话读法查看某 W 的入口，再切到按入口读法查看该入口
- **THEN** 两个方向指向同一个 `locusId`，同一个 W、同一个 M 与同一个子会话 `sessionId`

#### Scenario: 父会话已归档时不可跳转

- **WHEN** 某入口的 W（或 M）已归档
- **THEN** 该行对应的会话跳转不可用并显示「已归档」，不产生一次静默跳到首页的导航

#### Scenario: 话题身份不可证时退化

- **WHEN** 某入口是话题但无法证明其话题标识
- **THEN** 跳转退化为所属群并说明，不伪造话题目标

#### Scenario: 未创建的入口没有子会话可跳转
- **GIVEN** 入口 `state = not-created`
- **WHEN** 所有者查看该行的跳转控件
- **THEN** 「跳到子会话」置灰并显示「尚未创建」；飞书入口跳转与 W、M 跳转按各自可达性照常给出

### Requirement: 默认 Q&A 在管理面只读呈现

管理面 SHALL 以与其它 locus 相同的行渲染并额外标记默认 Q&A 入口，SHALL NOT 将其单独列举为一组重复条目。默认 Q&A 由群行上的 `defaultQa` 标记表达，因此该标记 SHALL 只出现在群行上，MUST NOT 出现在话题行。管理面 MUST NOT 提供创建默认答疑群的入口；当某工作会话 W 尚无默认 Q&A 时，管理面 SHALL 说明其创建路径位于 Pet 轮盘，MUST NOT 就地提供创建控件。

#### Scenario: 默认 Q&A 只做标记

- **WHEN** 某 W 已有一个默认 Q&A 入口
- **THEN** 该入口在其所在群行以标记呈现，页面不重复渲染同一 locus，也不出现创建按钮；该群下的话题行不带此标记

#### Scenario: 尚无默认 Q&A 时说明出处

- **WHEN** 某 W 尚无默认 Q&A 入口
- **THEN** 管理面说明「尚未创建，请在目标会话中通过 Pet 轮盘创建」，不提供就地创建入口

### Requirement: 管理面不提供新建外部资源的入口

管理面 MUST NOT 提供需要手工输入 endpoint 或会话标识的绑定控件，MUST NOT 以裸标识列表作为可执行的创建入口。关联的建立 SHALL 由飞书入站消息（含 allowlist 的 `/bind` 命令）完成。**唯一例外**是群行或文档根行上的「改绑到其他会话」（仅在其 W 已归档时存在）：它 MAY 要求输入目标工作会话的完整 sessionId，且该输入 MUST NOT 出现在话题行、评论行或任何其它控件中；它不创建新的入口或目标 W，目标必须是已存在的普通一级会话，由 Host 校验；Host MAY 为目标 W 建所需的 M 与协作空间。

管理面 SHALL 对既有入口只提供展示、导航，以及三个变更动作：**停止**、**访问模式**、**改绑到其他会话**；MUST NOT 提供绑定、解绑、归档、重建、替换父会话、权限或工具档位分别设置、执行根确认等动作。落到同一持久结果的近义动作 MUST NOT 以多个并列控件呈现：所有者无法据名字区分它们，只会承担误操作风险；若将来某个动作确有不同后果，SHALL 以该后果命名而不是以同义词命名。

#### Scenario: 管理面无绑定控件

- **WHEN** 所有者打开管理面，且未打开任何对话框
- **THEN** 页面不出现需要输入 chat/thread/session/workspace 标识的绑定表单；整个页面唯一能接收 sessionId 输入的位置是「改绑到其他会话」对话框，且该对话框只能从 W 已归档的群行或文档根行打开

#### Scenario: 生命周期动作仍可用

- **GIVEN** 入口所属的 W 可用（未归档）
- **WHEN** 所有者在某入口行展开操作区
- **THEN** 该行只提供「停止」与「访问模式」，没有「改绑到其他会话」（它只在 W 已归档时出现在群行或文档根行上）；不出现解绑、归档、重建、权限、工具档位、确认执行根的控件；Host 拒绝时状态不被乐观改写

#### Scenario: 话题行不接受会话标识输入
- **GIVEN** 某群下有话题行
- **WHEN** 所有者查看该话题行的操作区
- **THEN** 不存在「改绑到其他会话」或任何文本输入控件

### Requirement: 管理面如实呈现全部生命周期状态

管理面 SHALL 逐一呈现入口的全部生命周期状态（`not-created` / `active` / `invalid` / `stopped`，文字分别为「未创建」「活跃」「已失效」「已停止」），MUST NOT 省略其中任一状态、MUST NOT 把未知或非活跃状态显示为空白或伪装成活跃。状态 SHALL 以文字表达，颜色只能作为补充通道。默认筛选 MUST NOT 让某个状态下的关联静默消失。管理面所依据的快照校验 MUST 接受上述四种状态的全集，MUST NOT 因出现 `not-created` 入口而使整个面板加载失败。管理面 MUST NOT 呈现已删除的状态（`provisioning` / `switching` / `retired`）；快照中出现不在四值集合内的状态值时，SHALL 显示为「未知状态」并按非活跃处理。

#### Scenario: 正在建树的入口可见

- **WHEN** 一个入口已建立（群行与话题行已随首次提交落库），但其子会话尚未创建，记录 `state = not-created`
- **THEN** 管理面显示该入口为「未创建」，不显示为空白，也不显示为「活跃」；该入口出现在默认视图中；该入口没有在途投递、不在访问模式变更中时，「停止」与「访问模式」可用

#### Scenario: 非活跃状态不被省略

- **WHEN** 某入口为已停止或已失效
- **THEN** 该状态以文字就地显示，并在被默认筛选排除时以可发现的出口呈现，而不是从页面消失

#### Scenario: 含未创建入口的快照可加载
- **GIVEN** 快照中有一个 `state = not-created` 的群行和一个 `state = not-created` 的话题行
- **WHEN** 管理面加载该快照
- **THEN** 快照校验通过，两行都被渲染并显示「未创建」；面板不进入加载失败状态

#### Scenario: 未知状态值不伪装成活跃
- **GIVEN** 快照中某入口的 `state` 为 `retired`
- **WHEN** 管理面呈现该入口
- **THEN** 该行显示「未知状态」，不显示为「活跃」，也不提供「停止」以外会改变其状态的动作；在默认筛选以及取消勾选任一选项后该行仍然显示，且不计入任何选项的计数（位于已归档 W 之下时计入「已归档」）

### Requirement: 出站业务回复的 @ 引用渲染为平台真实提醒

入站正文把 mention 预渲染成显示名，出站文本消息却必须使用平台标记才成为提醒；系统 SHALL 在发送业务回复前完成这一翻译，使 Agent 写出的引用成为真实提醒，而不是让对方收不到通知的纯文本。

本要求只适用于 IM 入口（`chatId` 不以 `doc:` 开头）。文档入口中，模型写在正文里的 `@` SHALL 按纯文本发送：MUST NOT 读取任何 chat 成员列表，MUST NOT 改写这些 @ 引用，文档投递提示也 MUST NOT 承诺它们会成为提醒。唯一的例外是 Host 自己加的结构化提及：全文评论的答复与回执以一条新全文评论发出，开头的 `mention_user` 指向提问者或命令发送者：业务答复为持久 Delivery 的发送者，控制回执为该命令的发送者（见 `pet-locus-doc-comments`），提示可以如实告诉模型提问者会收到通知。

对 IM 入口，渲染 SHALL 只使用当前 chat 成员列表给出的精确成员映射，且只改写**整词**引用。可解析的引用有两种：**显示名**（`@` 之后紧跟完整显示名，其后为空白、标点或串尾）与**成员的精确 open_id**（`@ou_…`，其后为同类边界）；前者用「显示名 → open_id」映射，后者用「open_id → 显示名」映射，两者都改写为 `<at user_id="ou_…">显示名</at>`。

接受 open_id 引用是必需的，不是便利：Agent 可能只拿到 `ou_…` 而没有显示名（投递提示词在无法解析显示名时就只给出 open_id），此时它写出的 id 会作为纯文本发出——对方收不到通知，且该标识被公开在群里。渲染它既通知到正确的人，也不再公开该标识。

以下情形 MUST 保持原文不改写：正文已包含 `<at ` 标记；同一显示名对应多个成员（歧义）；引用不属于该 chat 成员（未知显示名，或不是本 chat 成员的 open_id）；`@` 之前是词内字符（如邮箱地址）。

成员列表不可读、映射缺失或渲染异常时 SHALL fail-soft：按原文发送，MUST NOT 阻断发送或改变 Delivery 终态。诊断 SHALL 只记录低基数分类与改写次数，MUST NOT 记录姓名、open_id 或正文。

对 IM 入口，注入 SHALL 告知 Agent 群内 @ 人的可行写法，并说明 Host 会渲染整词显示名，使别名与群显示名不同时仍能由 Agent 显式给出标记。

#### Scenario: 唯一命中的整词引用成为真实提醒
- **WHEN** Agent 回复正文含 `@赵鸿珂 看完了`，且该 chat 成员中恰有一人显示名为「赵鸿珂」
- **THEN** 发送的正文该处变为 `<at user_id="ou_…">赵鸿珂</at>`，平台侧产生真实提醒

#### Scenario: 裸 open_id 引用也成为真实提醒
- **WHEN** Agent 回复正文含 `@ou_322ec1d3cd062f04bc2b1f4ba1eff8e9`，且该 open_id 是本 chat 成员
- **THEN** 发送的正文该处变为 `<at user_id="ou_322ec1d3cd062f04bc2b1f4ba1eff8e9">张勇</at>`，平台侧产生真实提醒，且正文不再出现裸 open_id

#### Scenario: 同名歧义不改写
- **WHEN** 该 chat 有两个成员显示名同为「张伟」，正文写 `@张伟 请看`
- **THEN** 正文原样发送，不猜测指向哪一位

#### Scenario: 非成员名字与词内 @ 不改写
- **WHEN** 正文写 `@外部同事` 或 `wang@example.com`
- **THEN** 两者都按原文发送，不尝试跨群解析、不改动邮箱

#### Scenario: 非成员 open_id 不改写
- **WHEN** 正文写 `@ou_stranger_99`，而该 open_id 不是本 chat 成员
- **THEN** 正文原样发送，不跨群解析、不猜测该标识指向谁

#### Scenario: 已是标记形式则不改写
- **WHEN** 正文已含 `<at user_id="ou_…">赵鸿珂</at>`
- **THEN** 该正文整体原样发送，不重复包装

#### Scenario: 成员表不可读时仍能发出
- **WHEN** 群成员列表调用失败或返回无法解析的结果
- **THEN** 回复按原文发送并记录一次低基数诊断，Delivery 终态与发送结果不受影响

#### Scenario: 注入说明平台写法
- **WHEN** Host 渲染一次统一 locus 投递提示与 `pet_locus_finish` 说明
- **THEN** 其中写明群内 @ 人直接写显示名即可、Host 会渲染为真实提醒，并给出别名不一致时用 `<at user_id="ou_…">` 明确指定的写法

#### Scenario: 文档回复不渲染 @
- **GIVEN** 文档入口的 current Delivery，Agent 回复正文中含有 `@张勇 看下`
- **WHEN** Host 发送该回复
- **THEN** 正文原样发送，不含 `<at` 标记；本次发送期间没有调用 chat 成员列表接口

### Requirement: current Delivery capability 拒绝可判定且不削弱来源隔离

系统 SHALL 将 caller-bound finish/wait/track 授权建立在同一份当前执行证明上：实际 caller 的 `(locusId, sessionId)` 必须与入口行当前值一致且 `state = active`，当前执行必须由唯一 current Delivery 发起或由其已证明的 Host/agent-message 连续轮次恢复，且不得含 GUI/user、来源不明参与者、第二个 Delivery 或旧 `sessionId` 的迟到污染。持久层中“存在 current”只是必要条件，MUST NOT 单独授予 capability。

授权拒绝 SHALL 返回机器可判定的稳定原因类别，至少区分：`no-current`、`claim-unbound`、`mixed-source`、`stale-delivery`、`generation-mismatch`、`association-unproven` 与 `capability-unavailable`。对模型的文字可以概括，但诊断 MUST 保留类别以及不含其它入口标识的本地证据；MUST NOT 把所有拒绝折叠成“没有 current”。类别 `generation-mismatch` 沿用原名，自 v20 起表示 caller 的 `sessionId` 与入口行当前 `sessionId` 不符。

claim-before-bind、expiry→promotion、Host 恢复和 next-step/next-turn batching 的修复 MUST 通过补齐/恢复正确证明完成；系统 MUST NOT 通过允许 GUI/user mixed turn、只查数据库 current 或猜测最近 Delivery 来消除拒绝。

#### Scenario: claim 先于 durable bind 后恢复
- **WHEN** current Delivery 的 turn claim 先到达，随后同一 Delivery 完成 durable bind且期间没有其它来源污染
- **THEN** capability 从 `claim-unbound` 收敛为可用，不把暂时未绑定永久记为 mixed

#### Scenario: GUI steer 继续 fail closed
- **WHEN** current Delivery 存续期间同一 child 收到 GUI/user steer
- **THEN** 该执行得到 `mixed-source` 拒绝，不能 finish、wait 或 track 当前 Delivery；系统不得为修复历史误拒而放宽此规则

#### Scenario: 到期晋升后迟到执行可辨别
- **WHEN** A 已到期、B 已晋升 current，而 A 的旧执行调用 finish
- **THEN** 调用以 `stale-delivery` 拒绝，不消费 B，诊断可与“当前根本没有 Delivery”区分

#### Scenario: 冷恢复关联无法证明
- **WHEN** Host 恢复时不能唯一证明 child 的 `sessionId` 和 current Delivery 的关联
- **THEN** capability 以 `association-unproven` 保持不可用并暂停派发，不猜测最近记录

### Requirement: Locus 业务出站只能经受管 finish

Locus child 的飞书业务正文与撤回动作 SHALL 以 caller-bound `pet_locus_finish` 的 Host 实现为唯一受管出口；普通 assistant 文本仍不得外发。该出口在各访问模式下的保证强度 SHALL 按模式区分，并 SHALL 如实陈述，MUST NOT 把较弱模式的保证表述为较强模式的保证。

**`read-only` 模式（默认）**：child 的已发布能力集合 MUST NOT 提供可经 Skill、shell、脚本、CLI、通用 HTTP、子委派或其它执行身份直接发送或撤回飞书消息的路径。该边界 SHALL 由工具/执行 authority 隔离强制执行，MUST NOT 仅依赖 prompt、Skill 省略、命令字符串黑名单、PATH/HOME 隐藏或 read-only 文件沙箱。若当前 pinned runtime 无法证明在保留通用进程执行时隔离飞书凭据与 Lark 网络出口，`read-only` 模式 SHALL 不提供 `bash`、`pwsh`、`skill`、任意代码执行和可代为执行的子委派能力，只保留受控只读工具与 caller-bound Pet 工具。

**`danger-full-access` 模式（allowlist 显式授予，见「Locus 访问模式」）**：child 可执行通用 shell，因而**不存在**执行 authority 层面的出站隔离。此时唯一出口 SHALL 由防误操作 guard 维持：Host SHALL 在该 child 作用域拒绝经 shell 调用 `lark-cli` 发送、回复、编辑、撤回飞书消息的命令，并在拒绝原因中指明改用 `pet_locus_finish`、finish 被拒时报告原因而非绕行。该 guard MUST NOT 在规范、管理面、飞书回执或 prompt 中被表述为安全边界；有意绕过（脚本、HTTP、复制的可执行文件）不在其保证范围内。

**任何模式**：child 的已发布能力集合 MUST NOT 含子委派或可让另一执行身份代为行动的工具（包括 `subagent`、`subagent_fork`、`workflow`、`ralph`、`send_message` 及 agent 控制工具）。该排除 SHALL 由持久组合本身保证，MUST NOT 依赖可在运行中撤除的收紧层。

Locus child SHALL 以 locus 主会话为父、经官方 `startActivation` 创建。父会话 SHALL 是 Pet 自建、挂中性白名单 preset（`locus-base`，不含任何委派行）的 locus 主会话，其 preset MUST NOT 被更改；子会话 SHALL 以独立选择的 `locus-child` preset 启动（`locus-base` 去掉写文件工具），该选择随子会话持久化并在每次冷恢复时重新挂载，不从父会话继承。Host SHALL 在 `agent/created` 以及每次投递前核验子会话的 preset 为 `locus-child`，不符即按“组合失败 B 类”拒绝创建、恢复或派发；locus 主会话的 preset 不是 `locus-base`、被归档或删除，视为 M 不可用，走“换绑与归档按层处理”的整 W 迁移，不属于组合失败。runtime 不再携带每次请求的 `toolFilter`；Host SHALL 在每次发布（含冷恢复）时，于子会话自有作用域以 `tools.restrict` 安装不含委派的工具上限与按入口行 `accessMode` 的收紧层。组合证明只在发布时把关：新建与每次冷恢复，Host SHALL 经 `composeLocusChild` 证明所需组合（含收紧层）已安装并回读核验，不通过即拒绝创建、恢复或派发；持久层 MUST NOT 保存组合标记，MUST NOT 以宽底座发布一个未安装收紧层的 `read-only` child。Host SHALL 对 `tools.restrict` 与 `tools.guard` 做运行时特性探测，缺失即拒绝发布。防误操作 guard 另拒绝文档入口的评论与文档正文写命令（见 `pet-locus-doc-comments`）。

#### Scenario: 受管 finish 正常发送
- **WHEN** 任一 `accessMode` 的 child 对其已证明的 current Delivery 调用 `pet_locus_finish(reply)`
- **THEN** Host 按 durable CAS 和固定触发消息发送一次正文并记录结果

#### Scenario: shell 旁路不可达
- **WHEN** `read-only` 模式的 child 尝试以 `lark-cli`、绝对路径脚本、`msg.py`、Python/Node/curl 或复制后的可执行文件直接调用飞书接口
- **THEN** 已发布执行 authority 不能产生飞书业务消息，且 Delivery 状态不因尝试而改变

#### Scenario: shell 档误用 lark-cli 发送被拦截
- **WHEN** `danger-full-access` 模式的 child 在 finish 被拒后执行 `lark-cli im +messages-send …` 或等价的回复/撤回/编辑命令
- **THEN** 该工具调用在执行前被拒绝，拒绝原因指明使用 `pet_locus_finish` 并报告 finish 的拒绝原因；Delivery 状态不因尝试而改变

#### Scenario: shell 档读取当前群不被拦截
- **WHEN** `danger-full-access` 模式的 child 以 `lark-cli` 读取当前入口群的历史消息
- **THEN** guard 不拒绝该调用

#### Scenario: shell 档的出站保证如实表述
- **WHEN** 所有者在管理面或飞书回执中查看 `danger-full-access` 的说明
- **THEN** 说明写明防误操作 guard 仅防误操作、不是安全边界，MUST NOT 声称业务正文只能经 finish 产生

#### Scenario: 子委派不能洗白权限
- **WHEN** 任一 `accessMode` 的 child 尝试通过 subagent、workflow、Ralph 或 agent message 让另一执行身份代发
- **THEN** 已发布能力集合不含这些工具；业务正文不能由另一执行身份产生

#### Scenario: 收紧层未安装时不发布
- **WHEN** 入口行的子会话被发布（新建或冷恢复），而 Host 无法同步安装或回读核验其 `accessMode` 对应的收紧层
- **THEN** 按 B 类拒绝发布并给出确定性诊断，MUST NOT 以宽底座发布该 child；冷恢复时入口行不被改写（首次创建时按创建失败规则轮换 `sessionId`）

#### Scenario: 隔离能力无法证明时不发布
- **WHEN** runtime 不能提供按 `accessMode` 收紧的作用域限制（如缺少 `tools.restrict`）
- **THEN** 按 B 类处理：Locus intake/child 能力保持 unavailable 并给出确定性诊断，入口行不被改写，MUST NOT 以字符串过滤或 prompt 警告宣称安全；locus 主会话 preset 核验失败不属于本场景，按 M 不可用处理

#### Scenario: safe-v1 行继续服务
- **GIVEN** 版本戳为 19 的状态库，其中 `active` 的 locus 行带 `childComposition = tier3`（v19 唯一合法的标记，v20 起该字段不存在）
- **WHEN** 以当前版本包启动 Host
- **THEN** 存储以 `version-mismatch` 拒绝打开，Pet 保持未就绪，诊断给出可直接复制的离线迁移命令；没有任何入口被路由或投递

#### Scenario: 主会话 preset 不影响子会话工具面
- **WHEN** 用户的工作主会话运行一个把委派工具注册进 agent 自有层的 preset（如 `standard`）
- **THEN** 子会话的父是 locus 主会话而非工作主会话，其已发布工具面只由 `locus-child` preset、Host 安装的作用域上限与 `accessMode` 收紧层决定，不含委派工具

#### Scenario: 冷恢复不回落到父组合
- **WHEN** Host 重启后首次向一个 `active` 入口的子会话投递
- **THEN** 冷恢复重新挂载子会话持久化的 `locus-child` preset，Host 在发布前安装作用域上限与收紧层并核验；子会话 preset 不是 `locus-child` 时按 B 类拒绝派发；locus 主会话 preset 不是 `locus-base` 时视为 M 不可用，走整 W 迁移，不拒绝于组合

#### Scenario: 升级前的 legacy child 不可恢复服务
- **GIVEN** 一条 `active` 入口行的子会话在冷恢复时 `composeLocusChild` 核验不通过（组合缺失或与 `accessMode` 不符）
- **WHEN** 向该入口投递
- **THEN** 按 B 类拒绝发布，不 adopt 或冷恢复该子会话，该次投递以确定性诊断失败结算，入口行不被改写

### Requirement: Delivery 保留有界结构化 addressing 事实

对合格的群消息，系统 SHALL 在 durable Delivery 中保存有界、顺序化的 normalized addressing projection，至少标识每个 mention occurrence 的 `kind`（`self-bot`、`other-bot`、`human` 或 `unknown`）与可显示名称，并汇总 `selfMentioned` 和 `otherBotCount`。Host 可在内部保存重验所需稳定标识，但注入 child 时 MUST NOT 暴露 app secret、无关 open ID 或原始 transport event。

分类 SHALL 基于入站 mention 结构与 Host 可证明的 chat bot 成员事实；无法证明 bot/human 或 occurrence 顺序时 SHALL 标为 `unknown`，MUST NOT 从压平文本猜测。缺少新字段的旧 Delivery SHALL 保持可读并明确按 addressing unknown 处理，MUST NOT 回填猜测值。

这些事实只供 child 做自然语言意图判断；Host MUST NOT 因出现另一个 bot、某个关键词或 reference-only 猜测而在 durable Delivery 前静默丢弃已经合格的本 bot mention。

#### Scenario: 同时 at 多个 bot
- **WHEN** 一条消息同时 mention 本 bot 和两个可证明的其它 bot
- **THEN** Delivery 保存相应 `self-bot`/`other-bot` addressing 投影并交给 child 判断，不由 Host 自动回复或丢弃

#### Scenario: mention 身份不可证明
- **WHEN** 某 mention 无法由当前 bot 成员事实判定为 bot 或 human
- **THEN** 该 occurrence 以 `unknown` 注入，不从显示文本猜测其类型

#### Scenario: 旧 Delivery 兼容读取
- **WHEN** Host 恢复一个没有 addressing projection 的历史 Delivery
- **THEN** 将 addressing 视为 unknown 并继续既有安全恢复，不伪造 mention 结构

### Requirement: 回复被拒且本轮未续进的 Delivery 收尾为失败

当 current Delivery 的某个执行轮中，`pet_locus_finish` 因 current Delivery capability 授权而被拒绝，且该轮结束时满足以下全部条件，Host SHALL 将该 Delivery 原子收尾为 `failed`，失败原因 `reply-refused`，并推进队列：
- 该 Delivery 仍为 current，未进入任何终态；
- 同一轮内此后没有成功的 `pet_locus_finish`；
- 同一轮内没有成功的 `pet_locus_wait`。

Host MUST 独立证明被拒调用的精确活跃轮关联该 Delivery，MUST NOT 只凭 child 有 current 推断。收尾 MUST NOT 发送或重试业务正文、放宽授权；SHALL 复用失败控制反馈且反馈失败不阻断收尾。终结 SHALL 与 finish/超时原子竞争且至多一次，MUST NOT 消费后续 Delivery 或更换 `sessionId` 后的新实例。

#### Scenario: 回复被拒后本轮结束
- **WHEN** current Delivery A 的执行轮因 GUI 插话等混入而使 `pet_locus_finish` 以 `mixed-source` 或 `claim-unbound` 被拒，child 随后结束该轮且未成功 finish 或 wait
- **THEN** A 在该轮结束时收尾为 `failed/reply-refused`，不发送正文，触发消息得到失败反馈，backlog 中的 B 立即成为 current

#### Scenario: 被拒后同轮改正
- **WHEN** 执行轮中 finish 先被拒，同一轮内随后一次 finish 成功
- **THEN** A 按成功回复终结，不再收尾为 `reply-refused`

#### Scenario: 无关联或迟到旧执行不消费新请求
- **WHEN** 纯 GUI 轮、旧 A 已到期后 B 晋升、或多个 Delivery 导致关联不唯一的执行尝试 finish 被拒
- **THEN** Host 只保留拒绝诊断，不得终结 B 或其它 current

#### Scenario: 被拒后声明继续等待
- **WHEN** 执行轮中 finish 被拒，同一轮内 `pet_locus_wait` 成功（先于或晚于拒绝均可）
- **THEN** 该轮结束时 A 保持 current，由期限或后续可证明续进决定其终态

#### Scenario: 未调用 finish 的普通结束不受影响
- **WHEN** current Delivery 的执行轮正常结束，且该轮未出现任何 finish 授权拒绝
- **THEN** A 仍为 current，后续 backlog 不投递，与既有"turn 结束不完成请求"一致

#### Scenario: 收尾与超时竞争
- **WHEN** A 的收尾与 deadline 过期同时发生
- **THEN** A 只终结一次；未获胜的一方不改变 A、不消费 B

### Requirement: Locus child 具备 caller-bound 的当前入口群只读能力

每个 IM 入口（群或话题）的 active locus 的 child SHALL 能以 caller-bound 只读工具读取**当前入口**的历史消息，并以
**bot 身份**读取（本 change 不引入任何其它身份路径）。文档入口 locus 不装配该工具（见 `pet-locus-doc-comments`）。

读取目标 MUST 只来自调用方 child 已绑定的入口，且 MUST NOT 接受 chat/群/用户或 thread 选择参数：
入口为**话题**时，读取范围 SHALL 为该入口**绑定的话题**及其回复（由 Host 从入口事实推导）；
入口为**群**时读取该群的消息列表。此处排除的是"调用方任意选择其它话题/线程"，**不是**"读取
自己绑定的话题"。未知或多余参数 SHALL 使该调用被拒绝且不发生任何读取，MUST NOT 被静默忽略或
"忽略参数后照读当前入口"。

续读游标 SHALL 由 Host 签名，伪造或篡改的游标不可被接受，游标 MUST NOT 被用于选择读取目标
（游标载荷不加密，第三方分页令牌在编码后可被解码看到）。使用游标时
SHALL 校验其由同一 child（`sessionId`）、同一入口、同一方向与窗口签发；伪造、篡改、跨 child（含重建、改绑后的旧 `sessionId`）、
跨入口或因 Host 进程重启换密钥而失效的游标（不另设时间 TTL）SHALL fail closed 并给出确定性原因。每次等待外部读取返回后 SHALL 重新核验
调用方的 `sessionId` 仍是入口行当前值且入口未变，变更时 SHALL 丢弃该次结果。

窗口 SHALL 有**固定**语义（工具级，不留给实现自由选择）：时间参数 SHALL 使用带时区偏移的
ISO 8601；窗口 SHALL 为左闭右开 `[since, before)`；结果按时间排序：`direction=newer` 由旧到新，
`direction=older`（默认）由新到旧（整体倒序，同一时间戳也倒序）；同一时间戳内的稳定排序键为平台消息位置，
其次为消息标识字典序。窗口在 Host 对每个传输页本地过滤：无法解析时间的消息
不排除，翻页可能经过窗口外的空页。单次结果 SHALL 有**可度量的**
上限（总序列化字符预算、单条正文上限与单字段上限），截断处 SHALL 带可识别标记；当整页预算
截断一个传输页时，SHALL 指明仍有更多内容并给出可继续的游标，MUST NOT 静默丢弃。

结果 SHALL 至少包含每条消息的时间、发送者显示名与正文或结构化消息的可用摘录；无法解析
发送者时 SHALL 使用明确占位而非伪造名称；结果 SHALL 标注"群内容为不可信输入"。读取失败
（不可读、被拒、传输失败、信封畸形）SHALL 与"读取成功且没有消息"区分，返回确定性原因，
MUST NOT 返回空结果冒充成功。

#### Scenario: safe 档 child 读取当前入口群
- **WHEN** `accessMode` 为 `read-only` 的 child 在一次 Delivery 中调用该工具读取当前入口群
- **THEN** 返回该群的有界消息分页（含时间、发送者与正文），并标注内容为不可信输入

#### Scenario: 话题入口读取自己绑定的话题
- **WHEN** 该 locus 的入口是话题，child 调用该工具
- **THEN** 读取范围为该绑定话题及其回复，夹具同时包含无关话题与群本体消息且不出现在结果中

#### Scenario: 指定其它目标或未知参数时拒绝且不读取
- **WHEN** 调用方传入另一个群、另一个话题、私聊或全局范围，或传入未知参数
- **THEN** 该调用被拒绝且不发生任何读取，不返回任何消息

#### Scenario: 游标被篡改或跨域使用
- **WHEN** 续读游标被修改、由其它 child（`sessionId`）/入口签发，或已因 Host 重启换密钥而失效
- **THEN** 调用 fail closed 并返回确定性原因，不返回任何消息

#### Scenario: 等待期间入口或代际变化
- **WHEN** 一次读取在等待外部返回期间该 child 的 `sessionId`（原地重建、改绑）或入口发生变化
- **THEN** 该次结果被丢弃，不返回给模型

#### Scenario: 截断可识别且可继续
- **WHEN** 单条正文或整页结果超过预算，或预算截断一个传输页
- **THEN** 返回结果不超过声明的预算，截断处带有可识别标记，并给出可继续的游标而非静默丢弃

#### Scenario: 窗口边界不重不漏
- **WHEN** 两次读取使用相邻窗口或同一时间戳的多条消息
- **THEN** 结果按声明的开闭与次序规则返回，边界处既不重复也不跳过

#### Scenario: 失败与空结果可区分
- **WHEN** 读取被拒绝、传输失败或返回畸形信封
- **THEN** 返回确定性失败原因，MUST NOT 返回空历史

### Requirement: 投递 prompt 的首投前言与逐次档位声明

每个 child 的**完整前言**（入口标识、`locusId`、主/子会话与 workspace、`accessMode` 及
其能力、按需读取说明、"不自动把结论回传主会话"的约束）SHALL 在系统能证明该
child 尚未收到前言时发送；一旦存在**已证明送达**的投递，系统 MUST NOT 再发送完整前言。

"已证明送达" SHALL 优先使用可获得的最强证据：至少包括该 child 的持久 Delivery 行上"内容已进入
其 inbox"的绑定事实；实现 MAY 使用等价的精确对账证据（例如该 child 自身会话日志证明某条 inbox
消息进入过 turn）来避免重复。MUST NOT 把"已接受""已渲染"或运行期计数当作送达证据。

结果不可判定时（例如队列已接受但持久绑定未提交、回执丢失、进程在绑定前终止）系统 SHALL 视为
**未收到**并在下一次真正投递时携带完整前言。该策略**允许在不可判定情形下重发一次完整前言**；
重复发送的代价已由所有者接受（2026-10-12 决策），因此系统 MUST NOT 因该可能性而暂停投递、
阻塞 intake 或要求所有者重建。反之，若持久绑定已提交而仅控制回执丢失，SHALL 按已送达处理，
MUST NOT 重发。

**后续每次**投递 SHALL 只携带必要请求事实（请求、回复关联、本轮回复目标）并指向 caller-bound
`pet_context` 复核持久事实，但 MUST 声明本次投递时生效的 `accessMode` 能力（`read-only`/`danger-full-access`），
MUST NOT 让 child 只能靠猜测或主动查询才知道自己具备什么读取能力。`accessMode` 事实 SHALL 取自持久入口行（必填，无缺省值），渲染层 MUST NOT 忽略记录中的 `danger-full-access`。

`not-created` 入口首次创建子会话时，若该入口所属群的群行带 `reboundFrom`，完整前言 SHALL 追加：「本群此前由另一个已归档的会话跟进，那段上下文没有迁移；可以用当前入口的历史读取工具读飞书里的讨论，其它背景请向所有者确认。」（IM 入口指 `pet_locus_chat_history`，文档入口指 `pet_locus_doc_context`。）`reboundFrom` MUST NOT 被清除，改绑后该群每次新建子会话都带这段说明。该说明只说明情况，MUST NOT 提供任何新的读取能力；原地重建 MUST NOT 追加任何说明，`invalidReason` 只描述 `invalid` 状态。

#### Scenario: 首次投递收到完整前言
- **WHEN** 一个新建 child 收到第一条真正进入其 inbox 的 Delivery
- **THEN** 渲染出的是携带 `accessMode` 能力的完整前言，而不是"沿用首次投递"的续投变体

#### Scenario: 渲染成功但未入队不消耗首投
- **WHEN** 某条 Delivery 已持久化并被渲染，但在进入 child inbox 之前失败或结果不确定
- **THEN** 下一条真正投递的 Delivery 仍携带完整前言

#### Scenario: backlog 中已有其它已接受投递
- **WHEN** 该 child 还有其它已接受但未证明入队的 Delivery
- **THEN** 本次仍按"尚未收到前言"处理，不以这些未入队投递作为已送达证据

#### Scenario: 队列已接受但持久绑定失败
- **WHEN** 内容可能已进入 child inbox，但持久绑定未提交（进程在绑定前终止或持久化失败）
- **THEN** 该投递不被计为已送达，下一次真正投递携带完整前言（允许重复一次），且投递不因此暂停

#### Scenario: 绑定已提交但控制回执丢失
- **WHEN** 持久绑定已提交，仅控制回执丢失
- **THEN** 该投递计为已送达，后续投递按最小投递渲染，MUST NOT 重发完整前言

#### Scenario: 第二次投递不重复前言但声明档位
- **WHEN** 该 child 已有被证明送达的投递，本次是后续投递
- **THEN** prompt 不重复完整前言，但仍声明入口行当前 `accessMode` 对应的能力并携带本轮回复目标

#### Scenario: 重启后按送达证据决定
- **WHEN** Host 重启或 child 被冷恢复后收到新 Delivery
- **THEN** 存在送达证据时不重发完整前言；无送达证据时按未收到处理并携带完整前言

#### Scenario: 受既有缺陷影响的 child
- **WHEN** 一个既有 child 的投递有送达证据，但它从未收到过完整前言
- **THEN** 系统不自动重发完整前言，但每次投递仍声明当前档位能力；不提供人工重发完整前言的动作

#### Scenario: 改绑后的首次创建携带来历说明
- **GIVEN** 群行带 `reboundFrom = W0`，群行与话题行均为 `not-created`
- **WHEN** 群行与话题行各自收到第一条授权 at 并创建子会话
- **THEN** 两条首投前言都包含「本群此前由另一个已归档的会话跟进，那段上下文没有迁移」，并指向各自入口的历史读取工具；前言没有新增任何工具

#### Scenario: 从零创建的首投前言不含来历说明
- **GIVEN** 入口刚从零创建，群行不带 `reboundFrom`
- **WHEN** 首条授权 at 创建子会话
- **THEN** 首投前言不含任何改绑说明

#### Scenario: 原地重建不追加说明
- **GIVEN** 入口 A 因 `invalid` 被原地重建为 `not-created`，且 A 所在群的群行不带 `reboundFrom`
- **WHEN** A 的下一条授权 at 创建子会话
- **THEN** 首投前言不含任何重建说明或改绑说明

#### Scenario: 改绑说明在后续重建后仍然出现
- **GIVEN** 群行带 `reboundFrom`，其下入口 A 先创建过子会话，随后因 `invalid` 被原地重建
- **WHEN** A 的下一条授权 at 创建新子会话
- **THEN** 首投前言含改绑说明（`reboundFrom` 不清除），不含重建说明

#### Scenario: 文档入口的改绑说明指向文档上下文工具
- **GIVEN** 文档根行带 `reboundFrom`，评论行为 `not-created`
- **WHEN** 评论行创建子会话
- **THEN** 首投前言含改绑说明并指向 `pet_locus_doc_context`，不提及 `pet_locus_chat_history`

### Requirement: 读取守卫的拒绝可诊断且不额外放行

child 的本地读取守卫 SHALL 继续只允许已确认工作区内的路径；本 change MUST NOT 新增任何工作区外
放行。

拒绝 SHALL 返回稳定的机器可读原因，并 SHALL 附带最小可执行指引：被允许的根是什么、需要额外
路径时应由所有者如何确认。该指引只面向模型与本地诊断。

Host 自动发送的飞书正文 MUST NOT 含该诊断；投递提示词 MUST NOT 指示模型把诊断内容转述进业务
正文。受管出站 SHALL 在既有**受管变换**（例如把 `@显示名` 渲染为平台真实提醒）之外不改动模型
提供的正文，MUST NOT 附加任何诊断、路径或允许根信息。模型自行把诊断写入正文不属于 Host 可
保证的范围。

#### Scenario: 工作区外读取被拒且原因稳定
- **WHEN** child 尝试读取已确认工作区之外的路径
- **THEN** 读取被拒绝并返回稳定原因码与被允许根

#### Scenario: 指引可执行
- **WHEN** 模型收到一次守卫拒绝
- **THEN** 拒绝信息包含被允许根与申请额外路径的方式，足以决定下一步

#### Scenario: Host 出站不附加诊断
- **WHEN** 受管出站发送一条纯文本正文
- **THEN** 发送内容与模型提供的正文一致，不附加任何守卫诊断、路径或允许根信息

#### Scenario: 含提及的正文只做既有受管变换
- **WHEN** 模型提供的正文含可唯一解析的 `@显示名`
- **THEN** 出站仅执行既有的提及渲染，不因本 change 改变渲染结果，也不附加诊断或路径

#### Scenario: prompt 不指示模型转述诊断
- **WHEN** Host 渲染投递提示词
- **THEN** 提示词不要求或建议模型把守卫诊断内容写入飞书正文

### Requirement: 未装配的 caller-bound 能力不得以可见但必然失败的形式暴露

只装配了一半的 caller-bound 能力 MUST NOT 以"工具可见、调用必然失败"的形式暴露给 child：当某项
能力在当前 Host 尚未装配（例如协作上下文尚无可用范围）时，其工具 SHALL NOT 出现在 child 的工具面
中；装配完成后 SHALL 可注册并对其授权 caller 正常工作；该判定 SHALL 在 cold restore 后保持一致。

#### Scenario: 能力未装配时不可见
- **WHEN** 当前 Host 没有可供该 caller 使用的协作上下文范围
- **THEN** 该工具不出现在 child 的工具面中，child 不因调用它而得到无法解释的失败

#### Scenario: 装配后可用
- **WHEN** 该能力在当前 Host 已装配且 caller 有合法范围
- **THEN** 工具可注册，授权 caller 调用成功

#### Scenario: 冷恢复后判定一致
- **WHEN** child 被冷恢复
- **THEN** 工具面与该能力当前是否装配一致，不因恢复路径不同而漂移

### Requirement: 启动恢复结算被中断的投递并不阻塞后续消息

Host 重启可能恰好发生在某条 Delivery 已被 child 认领并开始执行 turn 之后。此时该 turn 已随进程消失，
**永远不会有任何执行者结算这条 Delivery**；而它占据该 locus 的 current 位置，会让同入口后续所有消息
只能停留在 backlog。系统 SHALL 在启动恢复时依据持久证据识别这种投递并立即结算，MUST NOT 让后续消息
等待原投递的完整租约。

判定 SHALL 只用**可证明**的证据：该 Delivery 已绑定 `executionId` 与 `inboxMessageId`，且 child 会话
日志中进入过该 inbox 消息的那个 turn 已经结束（存在 `turn/end`）、其结束原因为 `interrupted`。证据
不足或存在歧义时 SHALL fail closed，保持既有等待语义。

结算 SHALL 是终态且**不重发正文**：内容既已进入 child inbox（持久绑定已提交），按既有"送达即送达"的
策略计为已送达；结算表示"承认不会有回复"，MUST NOT 被实现为重试或重发。结算 SHALL 带上可诊断的原因。

被提升（backlog → current）的 Delivery SHALL 获得不小于最小执行租约的执行窗口，且不超过其 24 小时
硬上限，避免出现"被提升即到期"的循环。

#### Scenario: 重启打断进行中的 turn
- **WHEN** 一条 current Delivery 的绑定 turn 在 child 会话日志中被证明以 `interrupted` 结束
- **THEN** 启动恢复以终态结算该 Delivery（非重发、非重试），并让同入口的 backlog 立即可被派发

#### Scenario: 结算后不再占用 current 位置
- **WHEN** 上述被中断的 Delivery 被结算，而同一 locus 已有 backlog 投递
- **THEN** 该 locus 处于"有 backlog、无 current"，后续投递 SHALL 在启动排空时被提升并派发，MUST NOT 继续等待原投递的租约

#### Scenario: 结算原因是可诊断的
- **WHEN** 查看被中断结算的 Delivery 记录
- **THEN** 其终态带有明确说明"turn 被中断、未重发正文"的原因与启动处置标记，而不是笼统的 deadline 过期

#### Scenario: 证据不足时不结算
- **WHEN** 无法证明中断（该 turn 仍处于打开状态、`turn/end` 原因不是 `interrupted`、inbox 绑定与记录不匹配、或会话日志不可读）
- **THEN** 保持既有等待语义：不提前结算、不重派、不做任何推断

#### Scenario: 被提升的投递获得最小执行租约
- **WHEN** 一条 backlog Delivery 在其自身软租约临近或已经过去时被提升为 current
- **THEN** 它的执行租约至少延长到"提升时刻 + 最小执行租约"，且不超过 24 小时硬上限

#### Scenario: 不重发正文
- **WHEN** 被中断结算的 Delivery 内容此前已进入 child inbox
- **THEN** 系统 MUST NOT 把该消息正文再次投递给 child 或用户；仅结算该条 Delivery

### Requirement: Locus 三层实体

系统 SHALL 以三层表达一段协作：用户的**工作主会话**（W，普通一级会话，承担工作归属）←dsh-collab→ Pet 创建的一级 **locus 主会话**（M，与 W 1:1）→ 每个入口一个 **locus 子会话**（父为 M）。`loci` SHALL 一个入口一行，主键为入口身份 `endpointKey(chatId, threadId?)`；入口寻址（`chatId`/`threadId`、文档入口前缀规则）与本变更前相同。

- **群行**（没有 `threadId`）独占 `locusMainSessionId`（M）、`workspaceId`（W 的项目工作区，即项目读取的允许根，不得以 Pet 运行目录替代）以及可选的 `reboundFrom`（改绑前已归档的 W）。
- **话题行**不存这三个字段，需要时按 `chatId` 去群行读取。
- 有话题行就 SHALL 有同 `chatId` 的群行；该约束在单行 schema 之外，由集合校验 `validateLocusSetForStorage` 和每个写入口检查。同一个群（或文档）的全部行因此必在同一个 M 下，且“同群跨 M”的数据在结构上写不出来，不依赖额外校验。

W 与 M 的关系 SHALL 记录在 `locus_mains`（`{workSessionId, locusMainSessionId, generation, status, spaceId}`），同一 W 任一时刻至多一个 active 的 M；`locus_mains.generation` 在 W 换 M 时递增。W SHALL 留在来源 workspace；M 及其官方子会话 SHALL 建在专用 `DSH Pet` workspace。`locus_mains.workspaceId` 记录 M 的工作区。位于来源工作区（不在 DSH Pet 工作区）的 M 视为不可用，SHALL 在下一条授权消息到来且其下各群都没有 current 投递时，走“换绑与归档按层处理”中的整 W 迁移，不改写旧会话 header、不搬移或删除历史。M SHALL 由 Host 设审批 `never`、沙箱 `read-only`，并以 deny 式 `tools.restrict` 挡掉 `bash`、`write`、`edit` 与委派类工具，保留 Host 层的 `collab_*` 工具；Pet 只对自己创建的 M 向 dsh-collab 声明 `owns`。

#### Scenario: 同一工作主会话服务多个入口
- **WHEN** 同一工作主会话分别关联开发群与该群的一个话题
- **THEN** 两个入口的子会话都以同一个 M 为父；群行持有 `locusMainSessionId`，话题行不含该字段，按 `chatId` 解析得到同一个 M；`locus_mains` 中该工作主会话只有一条 active 记录

#### Scenario: 群行独占 M 与工作区
- **GIVEN** 群 G 有群行与一条话题行
- **WHEN** 读取两行的持久形状
- **THEN** 群行含 `locusMainSessionId` 与 `workspaceId`；话题行不含 `locusMainSessionId`、`workspaceId`、`reboundFrom`；把群行的 `locusMainSessionId` 改为 M2 后，话题行解析出的 M 同为 M2

#### Scenario: 话题行没有群行时集合校验失败
- **GIVEN** 待写入的集合含 `chatId = C` 的话题行，而没有 `chatId = C` 的群行
- **WHEN** 任一写入口提交，或 Host 启动加载持久层
- **THEN** `validateLocusSetForStorage` 拒绝，写入不生效或 Pet 保持未就绪，诊断包含该话题行的 key

#### Scenario: locus 主会话归 DSH Pet，入口仍关联干活项目
- **WHEN** 为 nexus 等来源工作区的工作主会话建立或替换 locus 主会话
- **THEN** 工作主会话留在来源工作区，locus 主会话运行且归属 DSH Pet，标题为 `[locus] <工作主会话名>`（无标题时用工作会话短码），群行 `workspaceId` 仍为来源项目；旧工作区中的 locus 主会话经既有空闲迁移协议替换，历史保留

#### Scenario: locus 主会话工具面锁死
- **WHEN** 读取 locus 主会话的已发布工具面与会话设置
- **THEN** 不含 `bash`、`write`、`edit` 与任何全局委派工具，含 `collab_*`；审批为 `never`，沙箱为 `read-only`

#### Scenario: 插件挂入自有作用域的委派工具在执行时被拒
- **GIVEN** 官方 Agent Team 把 `spawn_teammate`、`team_task_*` 等工具注册进每个普通根会话的自有作用域（`tools.restrict` 无法隐藏自有作用域注册）
- **WHEN** locus 主会话调用其中任一工具
- **THEN** Host 在该 agent 作用域上的执行守卫拒绝，工具体不执行；可见但未受该守卫覆盖的禁用工具仍视为泄漏并拒绝发布

#### Scenario: 工作主会话不得是子会话
- **WHEN** 所有者以一个 subagent 会话为目标执行 `/bind`
- **THEN** 绑定被拒绝，不建立 locus 主会话

### Requirement: 入口建立统一为一条路径

auto、Q&A、显式绑定与文档评论 SHALL 走同一建立路径 `provisionChatLocked`，只在“工作主会话从哪来”上不同：auto（未绑定入口首个授权 at）由 Pet 在 default workspace 新建 W；Q&A 以所有者打开的会话为 W；`/bind` 以所有者指定的普通一级会话为 W。显式 W SHALL 在任何外部创建之前解析。

**从零创建**（该 `chatId` 下没有任何行）无论由哪个入口触发——群首次 at、话题首次 at、群 `/bind`、话题 `/bind`、文档评论——SHALL 得到同一结构：W → M → {群行, 触发入口的话题行（若触发入口是话题）}。建立 SHALL 先复用 W 的 active M，没有则新建 M 并按“协作空间由工作主会话与 locus 主会话两个普通成员组成”建立空间，然后在**一次** `commitProvisioning` 中写入全部行，MUST NOT 分两次提交，MUST NOT 为同一次触发创建第二个 W 或 M。每一行 SHALL 为 `state = not-created`、持有预留的 `sessionId`、`accessMode = read-only`；建立 MUST NOT 预先创建子会话。Q&A 只建群行，且该群行带 `defaultQa`。

**并发**：锁顺序 SHALL 为 `group:<chat>` → `endpoint:<key>` → `main:<W>` lease，lease 从 `ensureLocusMain` 一直持有到 durable commit 或失败补偿结束。因此同群的并发建立被群锁串行，后到者看到已存在的群行并走“群已存在”分支；同一 W 的并发建立由 main lease 保证只建一个 M 和一个协作空间。提交前失败 SHALL 只补偿本操作新建的资源；提交后 finalize 失败沿用现有 committed-operation 恢复。

**群已存在且来源相同**时，新话题 SHALL 在群行的 M 下追加一行，MUST NOT 调用 `ensureLocusMain`，MUST NOT 创建任何外部资源，也不产生 provisioning 操作。

**群已存在而显式 W 与群行的 W 不同**时，无论 `/bind` 发在话题里还是群本体，SHALL 在加群锁之后、解析 M 之前以 `EXPLICIT_PARENT_CONFLICT` 拒绝，不触碰 Host。回执 SHALL 写明“该群已由 <W 标签> 跟进，不能在这里改绑；原会话归档后可在管理面「改绑到其他会话」”，MUST NOT 再使用“请先解除后再绑定”。同一 W 的 `/bind`：入口处于 `stopped` 时重新启用（见“换绑与归档按层处理”），否则幂等返回 reused。

#### Scenario: auto 建立
- **WHEN** 一个从未关联的群收到所有者的首个 at
- **THEN** Pet 新建工作主会话与 locus 主会话，建立协作空间，群行为 `not-created`，随后按首条消息创建子会话并处理该消息

#### Scenario: 话题内首次 bind 一次建出群行和话题行
- **GIVEN** 话题群 C 从未建立过任何行；会话 W1 未归档、不是子会话
- **WHEN** 所有者在 C 的话题 T 内发送 `/bind W1`
- **THEN** 恰一次 `commitProvisioning`，写入群行 `C` 与话题行 `(C, T)`，两行都在 W1 的同一个 M 下；`createAutoWorkSession` 调用 0 次；`ensureLocusMain` 调用 1 次；全程只有 1 个 W、1 个 M、1 个协作空间

#### Scenario: 话题首次 at 同样补出群行
- **GIVEN** 话题群 C 从未建立过任何行
- **WHEN** 所有者在话题 T 内首次 at bot
- **THEN** 恰一次 `commitProvisioning`，写入群行 `C` 与话题行 `(C, T)`，同在新建 W 对应的同一个 M 下；`createAutoWorkSession` 调用 1 次

#### Scenario: 群已存在时话题追加不触碰外部
- **GIVEN** 群 C 的群行已存在，M 为 M1
- **WHEN** 所有者在 C 的新话题 T 内 at bot，或发送 `/bind` 同一个 W
- **THEN** 在 M1 下追加话题行 `(C, T)`；`ensureLocusMain`、`createAutoWorkSession` 调用 0 次，没有新的 provisioning 操作

#### Scenario: 绑定到已有工作主会话复用 locus 主会话
- **GIVEN** 工作主会话 W 已有 active locus 主会话 M
- **WHEN** 所有者把另一个群 `/bind` 到 W
- **THEN** 不新建 locus 主会话，新群行的 `locusMainSessionId` 为 M

#### Scenario: 跨 W 的 bind 被拒绝且不触碰 Host
- **GIVEN** 群 C 的群行属于 W1
- **WHEN** 所有者在 C 的话题内或群本体发送 `/bind W2`（W2 ≠ W1）
- **THEN** 以 `EXPLICIT_PARENT_CONFLICT` 拒绝；`resolveMainParent`、`ensureLocusMain`、`createAutoWorkSession` 调用均为 0 次；持久层无任何写入；回执含“该群已由 <W1 标签> 跟进，不能在这里改绑”并提及管理面「改绑到其他会话」，不含“请先解除后再绑定”

#### Scenario: 同一 W 的 bind 幂等
- **GIVEN** 群 C 的群行属于 W1 且处于 `active`
- **WHEN** 所有者发送 `/bind W1`
- **THEN** 返回 reused，不新建任何会话，入口行的 `sessionId` 与 `revision` 不变

#### Scenario: 同群两个话题同时首次 at
- **GIVEN** 话题群 C 从未建立过任何行
- **WHEN** 话题 T1 与 T2 的首次 at 同时到达
- **THEN** 二者被群锁串行：先到者恰一次 `commitProvisioning` 建出群行与自己的话题行，后到者看到群行并在同一 M 下追加话题行（`ensureLocusMain` 与 `createAutoWorkSession` 合计各 1 次）；最终恰有群行 `C`、`(C, T1)`、`(C, T2)` 三行，1 个 W、1 个 M、1 个协作空间，没有孤立话题行

#### Scenario: 话题 bind 与群首次 at 同时到达（bind 先获得群锁）
- **GIVEN** 话题群 C 从未建立过任何行
- **WHEN** 话题内 `/bind W1` 与群本体的首次 at 同时到达，`/bind` 先获得群锁
- **THEN** `/bind` 建出群行（W1 的 M）与话题行；群本体的 at 随后看到已存在的群行，直接使用它，`createAutoWorkSession` 调用 0 次；没有第二个 W 或 M

#### Scenario: 群首次 at 先于话题 bind 到达
- **GIVEN** 话题群 C 从未建立过任何行
- **WHEN** 群本体的首次 at 先获得群锁（建出 auto W0 与 M0），话题内 `/bind W1` 随后到达
- **THEN** `/bind W1`（W1 ≠ W0）以 `EXPLICIT_PARENT_CONFLICT` 拒绝，不触碰 Host；最终只有 W0 → M0 下的群行，没有 W1 的 M，没有孤立话题行

#### Scenario: 同一 W 的 Q&A 与首次 bind 并发
- **GIVEN** 工作主会话 W 尚无 locus 主会话
- **WHEN** 为 W 打开 Q&A 与把另一个群 `/bind` 到 W 同时发生
- **THEN** main lease 保证二者串行：恰新建 1 个 M 和 1 个协作空间，两个群行都在该 M 下；后到者复用 M，`ensureLocusMain` 对外部的创建合计 1 次

#### Scenario: 提交前失败只补偿本操作的资源
- **GIVEN** 从零创建时 `ensureLocusMain` 已成功（新建 M 与协作空间），`commitProvisioning` 提交前失败
- **WHEN** 补偿运行
- **THEN** 持久层没有写入任何群行或话题行；本操作新建的 M 与协作空间被补偿回收；W 若是显式给出的已有会话则不被改动；若 M 是复用的已有 M，则不被归档

#### Scenario: 提交后 finalize 失败走已提交操作恢复
- **GIVEN** `commitProvisioning` 已成功写入群行与话题行，其后的 finalize 步骤失败
- **WHEN** Host 重启或重试恢复
- **THEN** 沿用 committed-operation 恢复完成 finalize；两行保持不变，不重复创建 W、M 或协作空间，没有孤立话题行

#### Scenario: 建立失败不留半成品
- **WHEN** 新建 locus 主会话成功但建立协作空间失败
- **THEN** 本次建立失败并回执；持久层没有写入任何群行或话题行；provisioning 操作按“provisioning 失败超时后不再阻塞”处理，补偿器归档未投入使用的 locus 主会话

### Requirement: 子会话在首条消息到达时创建

入口行 `state = not-created` 时，第一条可投递的 Delivery SHALL 以官方 `startContinuable`（provider `spawn`，`parent` 为 locus 主会话，`prompt` 为该 Delivery 的投递 prompt，`agentPreset` 为 `locus-child`，MUST NOT 传 `toolFilter`）创建子会话，并在 `agent/created` 中按入口行当前 `accessMode` 安装收紧层、设置沙箱并回读（首次创建同样按行上的值组装，MUST NOT 写死 `read-only`）；任一步失败 SHALL 令创建失败并回滚。发布 SHALL 在 `agent/created` 回调内完成，而不是等 `startContinuable` 返回（实测其在首轮认领之后才返回）：创建前入口行已持有预留的 `sessionId`（预留阶段与已创建阶段共用同一字段）；回调内依次认领预留、安装组合并回读、把入口行 `state` 置为 `active`（`sessionId` 不变，不发布任何组合标记）、发布 current、执行身份以及仅可消费一次的首条 prompt 预留关联，最后完成预留交接；这些步骤 MUST 早于首轮认领。官方首条 inbox UUID 仅在认领时或 API 返回时可知，Host SHALL 在首条业务认领时同步将 UUID 关联到该预留，并在首个 caller-bound 工具体执行前等待该 UUID 的持久绑定完成；MUST NOT 以消息正文猜测关联或再次投递首条消息。回调内发布之后若创建流程仍被拒绝，Host SHALL 回滚已写入的持久状态（不得留下可服务的 active/current），该 Delivery 按非名额失败结算、入口行 `state` 回到 `not-created`；MUST NOT 以撤销已提交的预留代替补偿。创建失败 SHALL 分两类：运行体名额不足且已证明没有调用官方创建，属于可重试失败，该 Delivery SHALL 保持待处理（不结算、不更换 `sessionId`、不补偿），名额释放或下一次派发时以同一 Delivery 与原预留 `sessionId` 重试创建，且不超过其 deadline；其它失败（预 prompt 的图像拒绝除外，见下；可能已消耗该 id：`agent/created` 回读不符、发布后 API 拒绝、组合核验、provider、首图降级等）SHALL 在安全释放后**原子地**预留新的 `sessionId` 并 `revision + 1`，失败的 Delivery 保留旧关联并以确定性原因结算、回执，未注入的 backlog 改指新预留，`state` 与 `accessMode` 保持不变（轮换只换首创身份：`sessionId` 与 `revision + 1`，与「整群重置原语 resetChat」的生命周期重置不同），下一条消息用新 `sessionId` 重试创建；无法证明释放成功时 SHALL 留下恢复债务并拒绝再次创建。后续 Delivery SHALL 经官方 Host prompt 队列能力（`queueHostPrompt` / Host access 的 `queuePrompt`，`delivery:queue`、`source:user`）投递为独立轮次；MUST NOT 用会产生 `steer` / `agent-message` 的 `sendMessage` 代替用户 Delivery。系统 MUST NOT 使用空闲创建或借出子会话 Session 的兼容能力。

首条图片消息的文本降级 SHALL 保持现有语义：仅在官方返回结构化 `MODEL_DOES_NOT_SUPPORT_IMAGES`、原 prompt 含 typed image、且 Host 可证明首条用户 prompt 未被接受或认领时，允许先补偿尚未执行的 child，再以纯文本重试同一 Delivery 一次。该已证明的投递前图片拒绝不按普通创建失败结算，MUST NOT 以旧关联结算该 Delivery：原 Delivery 保持 current 与原身份，其 session 关联随新预留一并更新，deadline 与 FIFO 顺序不变，已持久化的失败 child 身份 MUST NOT 再使用；新的预留 child 身份与未注入 backlog 的关联 SHALL 原子更新（沿用创建失败的轮换：释放后预留新的 `sessionId`，`revision + 1`），且纯文本重试最多一次。无法证明未执行时 MUST NOT 重放。容量拒绝仍保留原预留身份。

#### Scenario: 首条图片不支持时安全降为文本
- **GIVEN** 首次惰性创建已持久化 child，但官方在接受用户 prompt 前返回结构化图片不支持，Host 无用户 claim 或 inbox 绑定
- **WHEN** Host 进行一次文本降级
- **THEN** 同一原 Delivery 在同一入口行以新预留的 `sessionId`（`revision` 加 1）携带文本 prompt 恰执行一次，最多一次文本重试，保留原 deadline 与 backlog 顺序；该 Delivery 的 session 关联随新预留更新，未以旧关联结算（失败结算 0 次）；有已接受或已认领证据时不降级重放

#### Scenario: 首图降级交接使用新快照
- **GIVEN** 图片拒绝发生于回调内已发布 current、执行身份与旧 first-child WAL 之后，但用户 prompt 确未被接受或认领
- **WHEN** 旧 child 补偿成功且原子轮换提交后进行文本尝试
- **THEN** 保留原 Delivery/deadline/FIFO，退出旧 first-prompt 桥和旧 WAL；重新获取 current/locus/child 快照并用新执行身份提交，旧闭包不得绕过 exact-current

#### Scenario: 首图补偿失败保留恢复债务
- **WHEN** 首图降级的旧 child 补偿失败，或在补偿与轮换事务提交附近崩溃
- **THEN** 未完成的状态由持久恢复债务阻止服务，按最后已提交事实恢复；不将原 Delivery 擅自成功结算，不在不确定状态提交文本或重放图片

#### Scenario: 首图降级跨崩溃最多一次文本
- **GIVEN** 文本降级标记已持久化，随后文本提交成功或其接受结果不确定时 Host 重启
- **THEN** 根据原 Delivery 的持久标记与精确投递证据恢复，不因内存标记丢失第三次提交；同一用户请求至多一次文本尝试被接受

#### Scenario: 已接受或认领的图片拒绝不重放
- **WHEN** 有已接受、已认领证据或不能证明官方投递前拒绝时出现图片不支持错误
- **THEN** 不进入文本降级例外，不把 absence 或错误文本当作未执行证明；名额拒绝仍走原 Delivery 与原预留 child 身份的可重试路径

#### Scenario: 首条消息即首个 prompt
- **WHEN** `not-created` 入口收到第一条 at
- **THEN** 恰调用一次 `startContinuable`，其 `prompt` 为该 Delivery 的投递 prompt；入口行 `state` 转为 `active`，`sessionId` 即创建前预留的值

#### Scenario: API 返回前首轮已能解析身份
- **GIVEN** 替身在 `startContinuable` 返回之前依次触发 `agent/created`、首条 prompt 认领与首个 caller-bound 工具调用
- **WHEN** 首个工具为 `pet_context`
- **THEN** 工具解析到原 Delivery 与本入口；该 Delivery 只投递一次，Host 未再次调用 prompt 队列或 `sendMessage`

#### Scenario: 首工具等待持久绑定
- **GIVEN** 首条用户 claim 已同步绑定原 Delivery 的 inbox UUID，但对应持久写入仍处于 pending
- **WHEN** 真实 Host 的 `tools/pre-execute` 收到该子会话 caller-bound 工具调用
- **THEN** 工具体在持久写入成功前不执行；成功后仅执行一次且解析到原 Delivery，不二次投递

#### Scenario: 首轮持久绑定失败拒绝执行
- **GIVEN** 同上，但持久写入被拒绝
- **THEN** 工具体不执行，不自动重投首条 prompt，不使用只有内存关联的事实授权业务出站

#### Scenario: 回调内发布后创建被拒时回滚
- **WHEN** 回调内已把 `state` 置为 `active` 并发布 current，随后创建流程拒绝
- **THEN** 不留下 `active` 状态或 current；该 Delivery 以确定性原因结算，`state` 为 `not-created`，`sessionId` 已轮换为新的预留值、`revision` 加 1；下一条 at 可用新值再次创建

#### Scenario: 创建失败不推进代际
- **GIVEN** `not-created` 入口的预留 `sessionId` 为 C0，backlog 中另有一条 `accepted` 且无 execution、inbox、turn 证据的 Delivery D2
- **WHEN** `startContinuable` 因 `agent/created` 回读不符而失败（非名额失败）
- **THEN** 失败的 Delivery 仍关联 C0 并以确定性原因结算、回执；释放 C0 成功后，入口行原子地预留新的 `sessionId` C1（C1 ≠ C0）、`revision` 加 1、`state` 与 `accessMode` 不变、`locusId` 不变；D2 改指 C1；下一条 at 用 C1 创建；C0 此后不再被复用

#### Scenario: 名额不足时保留原请求
- **WHEN** `not-created` 入口的第一条 Delivery 创建时运行体名额已满，随后名额释放
- **THEN** 该 Delivery 在名额满时保持待处理且未回执失败，入口行的 `sessionId` 与 `revision` 不变；释放后以同一 Delivery 与原预留 `sessionId` 恰创建一次子会话并投递，用户无需重发

#### Scenario: provider 不能证明独立上下文
- **WHEN** `spawn` provider 不可用或声明继承父上下文
- **THEN** 不调用 `startContinuable`，Delivery 以能力不可用结算

#### Scenario: 首次创建按行上的 accessMode 组装
- **GIVEN** `not-created` 入口在创建前被 allowlist 把 `accessMode` 改为 `danger-full-access`
- **WHEN** 第一条授权 at 触发首次创建
- **THEN** `agent/created` 中按 `danger-full-access` 安装组合并回读；回读不符时按创建失败规则处理：该 Delivery 以确定性诊断失败结算，`sessionId` 轮换、`revision` 加 1，`accessMode` 仍为 `danger-full-access`，不以 `read-only` 重试

#### Scenario: 无法证明释放成功时留下恢复债务
- **GIVEN** 非名额创建失败后，对失败 child 的释放无法证明成功
- **WHEN** 同一入口收到下一条 at
- **THEN** 持久层留下恢复债务，入口行不预留新的 `sessionId`，拒绝再次创建；Host 不调用 `startContinuable`

### Requirement: 换绑与归档按层处理

不可用状态 SHALL 按层、按下列规则处理；所有写当前行的操作 SHALL 以 `{expectedLocusId, expectedRevision}` 做 CAS。

- 工作主会话（W）被归档时，其全部入口 SHALL 停止服务，MUST NOT 改写行的 `state`；授权 at SHALL 得到有限次回执，说明来源会话已归档并提示所有者在管理面改绑；MUST NOT 自动复活或自动换来源。
- 子会话组合失败 SHALL 只分两类：
  - **A 类**：子会话丢失，或身份无法证明 → 入口行置为 `invalid`，下一条授权 at SHALL **原地重建**：同一行预留新的 `sessionId`、`state = not-created`、`revision + 1`，`locusId` 不变，未注入的 backlog 改指新 `sessionId`（与创建失败轮换同一机制）；不影响同一 M 下的其它入口。
  - **B 类**：其它任何 `composeLocusChild`、访问策略（含 `accessMode` 回读不符、写开关关闭时遇到 `danger-full-access`）或 runtime 能力失败 → 拒绝发布，本次投递以确定性诊断失败结算，**入口行不改写**；首次创建时的失败按“子会话在首条消息到达时创建”轮换 `sessionId`，`accessMode` 与 `state` 不变。
  - M 不可用 MUST NOT 被当作组合失败，按下面的整 W 迁移处理。
- 冷恢复因运行体名额不足失败时 SHALL 保留原 `sessionId`、原 `revision` 与原 Delivery，按“子代激活受运行体名额约束时 fail closed”在名额释放后重试，且不超过该 Delivery 的 deadline；MUST NOT 重建。
- 停止（所有者 `/unbind` 或管理面 `stop`）SHALL 只在入口空闲时受理，有在途投递时以 `LOCUS_BUSY` 拒绝；停止群行 MUST NOT 连带停止话题行。`stopped` 的入口，普通 at MUST NOT 恢复它；在该入口内对**同一个 W** 重新 `/bind` 时，SHALL 原地重置（新预留 `sessionId`、`not-created`、`accessMode = read-only`、`revision + 1`）并重新启用；群行处于 `stopped` 时，同一 W 的 `/bind` 只重启群行，已有话题行不受影响。
- M 不可用（被归档、删除、preset 核验失败，或不在 DSH Pet 工作区）而 W 未归档时，Host SHALL **整 W 一次迁移**。触发：授权 at 到达，或 backlog 派发器在某条 current 结算后推进时（它只来自此前已被接受的授权 at，不会自发发生），发现所在群的 M 不可用且 W 未归档。backlog 派发器 SHALL 在 **claim 之前**核验 M（归档、缺失、preset 错误、不在 Pet 工作区），MUST NOT 沿旧的 catch-return 路径静默结束；M 不可用且 W 未归档时先走本迁移，成功后重读入口与 backlog 的新 `sessionId`，用新关联 claim 并派发。Host SHALL 持 `main:<W>` lease，取该 W 在 `locus_mains` 中**所有配对**（active 与 retired）的 M，经 `parent-loci` 收齐这些 M 下的全部群一起迁移，MUST NOT 只看触发群的 M：
  - 任何一个群有 **current** 投递（包括已交给 runtime 的 `queued` / `running` / `finishing`）：本次不迁移，消息留在 backlog，MUST NOT 先被 claim 成 current；backlog 本身 MUST NOT 阻止迁移，只有 current 阻止。
  - 否则先 `beginProvisioning(kind: 'migrate')`，**永远新建** M1（没有复用已有 M1 的分支）并建立新协作空间，记入该操作的资源；然后在**一个事务**内：该 W 的 active 配对（若有）记为 `retired`、M1 记为 `active`，并对上述收齐的每个群调用「整群重置原语 resetChat」（`{toM: M1}`，`defaultQa` 标记随群行保留；提交在同一个 repository 写回调内完成）；事务内对每一行按 `expectedRevision` CAS，并复查没有 current 投递。任一不满足则整体回滚，只补偿本次尝试新建的 M1 与协作空间，旧配对保持原状态。
  - 不需要持有其它群的群锁，事务内逐行 CAS 保证一致。
  - 已知代价：某个群有 current 时，同一 W 下其它群的新消息排在 backlog，直到该 current 结算后由派发器推进（M 核验在 claim 之前）；不主动唤醒，也没有 backlog 定时器：backlog 只在下一次派发、入站触发或启动恢复时检查硬上限并过期，不承诺到点必有回执。
- 改绑要求 W 已归档、迁移要求 W 未归档，二者互斥。所有者停止的入口 MUST NOT 被上述任一路径复活。

#### Scenario: 工作主会话归档
- **WHEN** 工作主会话 W 被归档后，W 名下某群收到所有者 at
- **THEN** 不投递给子会话，入口行 `state` 不被改写，群内收到“来源会话已归档，请在管理面改绑”回执；同一入口的后续 at 在达到次数上限后不再回执

#### Scenario: 子会话不可用只换该入口一代
- **GIVEN** locus 主会话 M 下有入口 A、B，二者均为 `active`，A 的子会话丢失（A 类），被判 `invalid`
- **WHEN** A 收到下一条授权 at
- **THEN** A 原地重建：新预留的 `sessionId`、`state = not-created`、`revision` 加 1、`locusId` 不变，并以该消息创建子会话；B 的 `sessionId`、`state`、`revision` 全部不变

#### Scenario: 名额不足的冷恢复保留原代际
- **GIVEN** 入口 A 的子会话 C 已被释放，A 的 `sessionId` 为 C、`revision` 为 r
- **WHEN** 下一条 Delivery D 到达时名额已满导致恢复失败，随后名额释放
- **THEN** 名额满时 D 保持待处理、A 仍为 `sessionId = C`、`revision = r`；释放后恢复的是同一子会话 C 并投递 D，没有新的 `sessionId`

#### Scenario: 组合失败的分类处理
- **GIVEN** 入口 A 为 `active`，向其投递时注入下表中的一种故障（`accessMode` 为 `danger-full-access` 的行同时写开关关闭，属于访问策略失败）
- **WHEN** 冷恢复发布子会话
- **THEN** 结果如下表；B 类的每一行，A 的 `state`、`sessionId`、`accessMode`、`revision` 均不变，`startContinuable` 调用 0 次

| 注入的故障 | 类别 | 结果 |
|---|---|---|
| 子会话已丢失 | A | A 置为 `invalid`；下一条授权 at 原地重建 |
| 子会话身份无法证明 | A | 同上 |
| 回读与 `accessMode` 不符 | B | 拒绝发布，投递以确定性诊断失败结算，行不改写 |
| 写开关关闭且 `accessMode = danger-full-access` | B | 同上，诊断说明写档已全局停用 |
| `composeLocusChild` 证明失败 | B | 同上 |
| runtime 缺少 `tools.restrict` | B | 同上，入口能力不可用 |

#### Scenario: locus 主会话不可用时整体迁移
- **GIVEN** W 未归档，M 下群 G1（群行 GA `active`、话题行 GT `active`、话题行 GC `stopped`，GA 带 `defaultQa`）与群 G2（群行 `active`），两群都没有 current 投递，G2 的话题行有一条 `accepted` 的 backlog Delivery（无 execution、inbox、turn 证据）；M 已被归档
- **WHEN** G1 收到授权 at
- **THEN** `beginProvisioning(kind: 'migrate')` 调用 1 次，新建 M1 与协作空间；一个事务内旧 M 的配对为 `retired`、M1 为 `active`；G1 与 G2 都以 `{toM: M1}` 重置：群行 `locusMainSessionId = M1`，GA、GT 与 G2 的非 `stopped` 行获得新预留 `sessionId`、`not-created`、`revision` 加 1，`locusId` 不变，GC 保持 `stopped`、`accessMode = read-only`、`revision` 加 1；GA 的 `defaultQa` 仍在；G2 的 backlog 改指新 `sessionId`；G1 的授权 at 随后创建子会话

#### Scenario: 任何群有 current 投递时不迁移
- **GIVEN** M 不可用，W 未归档；群 G1 无 current，群 G2 的某行有 current 投递
- **WHEN** G1 收到授权 at
- **THEN** 不迁移：`beginProvisioning`、`ensureLocusMain` 调用均为 0 次，旧配对与全部行不变；该消息留在 backlog；G2 的 current 结算后，backlog 派发器在 claim 之前核验 M 并触发迁移

#### Scenario: 无新 at 时结算推进 backlog，先核验 M 并迁移再派发
- **GIVEN** 群 G1 的话题行有 current A 与 `accepted` 的 backlog B（无 execution、inbox、turn 证据），其它群都没有 current；W 未归档；M 按下表不可用而配对仍为 `active`；期间没有任何新的授权 at
- **WHEN** A 终结，backlog 派发器推进
- **THEN** 调用顺序为：核验 M → `beginProvisioning(kind: 'migrate')` 1 次并新建 M1 → 整 W 事务提交 → 重读 B 的新 `sessionId` → claim B；B 在迁移提交之前从未成为 current；B 经新预留 `sessionId` 恰有一次 `startContinuable` 投递，不使用旧 `sessionId`

| 注入的 M 故障 | 结果 |
|---|---|
| M 已归档 | 同上 |
| M 缺失（已删除） | 同上 |
| M 的 preset 不是 `locus-base` | 同上 |
| M 不在 DSH Pet 工作区 | 同上 |

#### Scenario: 无 active 配对时一次触发迁移所有配对下的群
- **GIVEN** W 未归档，`locus_mains` 中 W 没有 active 配对，只有两个 `retired` 配对 M0 与 M0'；群 G1 的群行在 M0 下，群 G2 的群行在 M0' 下，均无 current 投递
- **WHEN** G1 收到授权 at
- **THEN** 收齐 M0 与 M0' 下的全部群；`beginProvisioning(kind: 'migrate')` 1 次，仅新建一个 M1；同一事务内 M1 为 `active`，G1 与 G2 都以 `{toM: M1}` 重置；之后 W 在 `locus_mains` 中只有 M1 一个 active 配对

#### Scenario: 已交给 runtime 的投递同样阻止迁移
- **GIVEN** M 不可用，W 未归档；群 G2 的某行有 `queued`（或 `running` / `finishing`）的 Delivery
- **WHEN** G1 收到授权 at
- **THEN** 不迁移：`beginProvisioning`、`ensureLocusMain` 调用均为 0 次，全部行不变

#### Scenario: 其它群有 current 时 backlog 保持 backlog
- **GIVEN** 同上，但群 G2 的某行有 current C2
- **WHEN** A 终结，backlog 派发器推进
- **THEN** 不迁移：`beginProvisioning`、`ensureLocusMain` 调用均为 0 次；B 保持 `accepted` backlog，未被 claim 成 current，`sessionId` 不变，也没有静默丢失；C2 结算后，派发器在 claim 之前核验 M、迁移，并经新预留 `sessionId` 投递 B 恰一次

#### Scenario: 静默 backlog 只在触发时检查硬上限
- **GIVEN** 群 G2 的 backlog Delivery D 已超过 `acceptedAt + 24h`，该 locus 没有新的派发、入站触发，Host 也没有重启
- **WHEN** 时间流逝
- **THEN** D 仍为 `accepted`，没有过期回执，也不存在 backlog 定时器；下一次派发、入站触发或启动恢复检查时，D 被过期

#### Scenario: 只有 backlog 不阻止迁移
- **GIVEN** M 不可用，各群都没有 current 投递，但 G2 的话题行有两条 `accepted` 的 backlog Delivery（无 execution、inbox、turn 证据）
- **WHEN** G1 收到授权 at
- **THEN** 迁移成功，G2 的两条 Delivery 改指其行的新 `sessionId`

#### Scenario: 两个触发同时到达只建一个 M1
- **GIVEN** M 不可用，群 G1 与 G2 均无 current 投递
- **WHEN** 两个群的授权 at 同时到达
- **THEN** 并发的触发被 `main:<W>` lease 串行：先到者新建 M1 并迁移全部群；后到者持 lease 后看到所在群的 M 已是可用的 M1，不再迁移；`ensureLocusMain` 对外部的创建合计 1 次，同一 W 任一时刻只有 1 个 active M

#### Scenario: M1 再次不可用时重复同一机制
- **GIVEN** 整 W 已迁到 M1，随后 M1 被归档
- **WHEN** 任一群收到授权 at
- **THEN** 新建 M2，同一事务内 M1 的配对为 `retired`、M2 为 `active`，全部群重置到 M2

#### Scenario: 事务内复查发现 current 则整体回滚
- **GIVEN** 迁移已 `beginProvisioning(kind: 'migrate')` 并新建 M1 与协作空间，提交前某群的一行成为 current
- **WHEN** 事务内复查 current，或某行的 `expectedRevision` CAS 失败
- **THEN** 整个事务回滚：旧配对仍为原状态（未被改为 `retired`），全部群行与各行的 `sessionId`、`state`、`revision` 不变；本次尝试新建的 M1 与协作空间被补偿回收；该消息照常排队

#### Scenario: 忙时拒绝停止
- **GIVEN** 入口有一条未终态的 Delivery
- **WHEN** 所有者执行 `/unbind` 或管理面 `stop`
- **THEN** 以 `LOCUS_BUSY` 拒绝，入口行 `state` 与 `revision` 不变；入口空闲后同样的请求被受理，`state = stopped`

#### Scenario: 停止群行不连带停止话题行
- **GIVEN** 群行 G 与话题行 T 均为 `active`，G 空闲
- **WHEN** 停止 G
- **THEN** G 的 `state = stopped`，T 的 `state`、`sessionId`、`revision` 不变

#### Scenario: 停止的入口重新绑定同一 W
- **GIVEN** 话题行 T 为 `stopped`，群行与其它话题行为 `active`，群的 W 为 W1
- **WHEN** 所有者在 T 内发送 `/bind W1`
- **THEN** 只有 T 重置为 `not-created`（新预留 `sessionId`、`accessMode = read-only`、`revision` 加 1、`locusId` 不变）；群行与其它话题行的 `sessionId`、`state`、`revision` 不变；普通 at 在 T 重新启用之前不使 T 恢复

#### Scenario: 停止的群行只重启群行
- **GIVEN** 群行 G 为 `stopped`，话题行 T1 为 `active`、T2 为 `stopped`
- **WHEN** 所有者在群本体发送 `/bind` 同一个 W
- **THEN** 只有 G 重置并重新启用；T1 保持 `active`、T2 保持 `stopped`，二者的 `sessionId` 与 `revision` 不变

### Requirement: provisioning 失败超时后不再阻塞

处于 `failed` 的 provisioning 操作超过 10 分钟后 SHALL 不再阻塞同一 endpoint；下一次针对该 endpoint 的建立请求 SHALL 先在运行期调用与启动对账相同的补偿器清理其 `resourceRefs`，补偿成功后再按无存量入口建立。补偿失败时 SHALL 继续阻塞并记录诊断。该规则 SHALL 对全部 provisioning kind 一致适用。`resourceRefs` 为空（没有任何需要回收的资源）的 `failed` 操作 SHALL 从一开始就不阻塞该 endpoint（实现阶段补充，2026-11-06，真机验收发现）。

#### Scenario: 超时后重试
- **GIVEN** endpoint E 的建立在 t0 失败，已创建的 locus 主会话记在 `resourceRefs`
- **WHEN** t0 + 11 分钟时 E 收到授权 at
- **THEN** 补偿器归档该 locus 主会话，随后建立成功；不需要重启 Host

#### Scenario: 超时前仍阻塞
- **WHEN** t0 + 5 分钟时 E 收到授权 at
- **THEN** 按既有规则拒绝并说明正在恢复，补偿器未被调用

#### Scenario: 补偿失败继续阻塞
- **WHEN** 超时后补偿器抛错
- **THEN** 不建立新入口，诊断记录原始错误，下一次请求再次尝试补偿

#### Scenario: 未创建任何资源的失败不阻塞
- **GIVEN** endpoint E 的改绑在 t0 失败，失败前没有创建任何资源（`resourceRefs` 为空）
- **WHEN** t0 + 1 分钟时所有者再次对 E 发起改绑
- **THEN** 不以 `LOCUS_CONFLICT` 阻塞，旧的 failed 操作被置为 compensated，本次改绑正常进行

### Requirement: 子会话读共识与 locus 主会话工具

子会话 SHALL 获得 caller-bound 只读工具 `locus_context`：Host 经 dsh-collab `actAs(locus 主会话).read` 读取协作空间，只返回 status 为 agreed 的 charter 与本入口登记的待办进度；没有 `ext.pet.entry` 的条目为工作空间级、对全部入口可见，带 `ext.pet.entry` 的条目只对该入口可见（话题入口另可见其所在群的条目；话题行与其群行必在同一 locus 主会话下，故二者共用同一协作空间）。MUST NOT 返回消息、其它入口的条目或成员 statusText。

子会话 SHALL 获得 caller-bound 工具 `locus_ask_parent({question})`：Host 从实际执行 caller 解析其入口行，只在 caller 的 `sessionId` 等于该入口行当前 `sessionId` 且 `state = active` 时，经官方会话投递接口把问题（附入口名与 `entry` 身份）作为下一回合输入投给其父 locus 主会话；工具 MUST NOT 接受任何目标参数，MUST NOT 新建或改变 Delivery，返回仅表示已投递。投递失败 SHALL 返回确定性原因。通用 `send_message` 与 agent 控制工具仍不可用。

locus 主会话 SHALL 获得 `locus_note`（以 `actAs` 创建带本入口 `ext.pet.entry` 的条目；入口须是该 locus 主会话名下的入口）与 `locus_reply_child`（Host 以官方 `subagents.sendMessage` 发给该 locus 主会话名下某入口行当前 `sessionId` 对应的子会话；不是当前 `sessionId` 或入口不属于它时拒绝）。locus 主会话用普通 `collab_*` 工具写的条目一律为工作空间级。

#### Scenario: 按入口过滤
- **GIVEN** 空间中有 agreed charter X（无标记）、入口 A 的 agreed charter Y、入口 B 的待办 T、一条消息
- **WHEN** 入口 A 的子会话调用 `locus_context`
- **THEN** 返回 X 与 Y，不含 T 与消息

#### Scenario: 话题可见所在群条目
- **GIVEN** 群入口 G 有 agreed charter Z，话题入口 H 属于 G
- **WHEN** H 的子会话调用 `locus_context`
- **THEN** 结果包含 Z

#### Scenario: 子会话向父询问并在同一 current 上继续
- **GIVEN** 入口 A 的 current Delivery D 正由子会话处理
- **WHEN** 子会话调用 `locus_ask_parent`，locus 主会话收到问题后以 `locus_reply_child` 回复
- **THEN** locus 主会话恰收到一条带入口 A 身份的问题；子会话以 `agent-message` 收到回复并在后续 turn 对 D 调用 `pet_locus_finish`；D 的回复目标不变，没有新 Delivery

#### Scenario: 旧代子会话不能询问
- **WHEN** `sessionId` 已被替换（原地重建或改绑）的旧子会话调用 `locus_ask_parent`
- **THEN** 返回拒绝，locus 主会话未收到任何投递

#### Scenario: 回复非现行代子会话被拒
- **WHEN** locus 主会话以 `locus_reply_child` 回复一个 `sessionId` 已被替换的入口旧子会话
- **THEN** 返回拒绝，未调用 `subagents.sendMessage`

### Requirement: 受控停机在原生信号前排空自有执行

目标 Host 有有效停机 descriptor 时，受控 stop/restart SHALL 在 SIGTERM 前经既有官方 Connection 鉴权的精确准备接口冻结 Pet 新派发、新建及受管 mutation，等待已进入操作到安全点，再以真实 live locus 主会话身份 await 官方精确自有 children drain 和领域提交。请求 MUST NOT 接受任意 Agent ID 或模型声明的身份；只有持久的 W↔M 配对、入口行当前的 `sessionId` 和官方 catalog 能决定排空对象。只有全部排空与提交完成才 SHALL 返回绑定同 Host PID、bootId、请求 nonce 和期限的 prepared；端口消失、cancel accepted 或 best-effort flush 不构成成功。

停机 descriptor 缺失时，web Host SHALL 按 `launcher-host-lifecycle` 的完整归属核验与告警分支跳过 Pet 排空并继续原生停机，不要求额外的首次维护标志，且 MUST NOT 声称已排空。descriptor 存在但无效、鉴权或排空握手失败时仍 MUST 拒绝停机；非 web profile 的前置维护限制保持有效。该降级只改变缺凭据分支，不放宽已有协议的票据、进程身份或恢复守卫。

#### Scenario: 完成排空和领域提交后才允许停机
- **GIVEN** 原 child 正在执行，下一条消息已为 backlog
- **WHEN** 停机准备冻结入口并排空自有 child
- **THEN** 原生严格关闭和领域提交均完成才应答 prepared；原请求按真实终止结算，后继直到新 Host 或显式 resume 才可派发

#### Scenario: 冻结同时覆盖管理和主子消息
- **WHEN** 停机准备已冻结，新入站、管理 mutation 或主子投递试图开始
- **THEN** 不发生新建或物理派发；已进入操作被等待，读取管理状态仍可用

#### Scenario: 未鉴权或错宿主不能排空
- **WHEN** cookie/Origin 不成立、PID/bootId/nonce 不符，或请求携带 Agent ID 等额外字段
- **THEN** 排空未被调用，无业务或访问模式变更

#### Scenario: 排空失败与超时保留明确维护状态
- **WHEN** 任一关闭/持久化失败或请求超时
- **THEN** 不应答 prepared，不发送停机信号；后台操作未全部 settle 时不得 resume，settle 后只有经鉴权的显式 resume 可恢复派发（不要求原 nonce，避免调用方丢失 nonce 后永久冻结），恢复中旧票据不可复用

#### Scenario: 过期票据与替换宿主不发送信号
- **WHEN** launcher 将要发信号而应答过期、状态不再 prepared、bootId 变化，或完整 pid/created/argv/executable 与握手前不符
- **THEN** 拒绝停止，不能重新采纳替换宿主作为目标

#### Scenario: 无 Pet 组合仍有真实宿主证明
- **GIVEN** 目标实际 Loader 已 ready，完整观察证明不存在 Pet，且没有失败/未展开或未知动态载体，已发布有效停机 descriptor
- **WHEN** launcher 准备停止该 Host
- **THEN** 独立 profile 控制插件按同协议证明无自有执行；当前 manifest 或磁盘 dump 相等不能代替该证明；协议分支失败不得改走缺凭据分支

#### Scenario: 旧 Host 缺凭据停机不计排空成功
- **GIVEN** 旧 web Host 缺少停机 descriptor，完整旧进程归属已核验
- **WHEN** 按该身份停止或重启 Host
- **THEN** 告警后跳过 Pet 排空并继续原生停机，不要求首次维护标志；不得把该次报告为 prepared 或排空成功，也不计作中断恢复验收

### Requirement: 启动恢复证据经官方冷读获取

启动恢复需要子会话日志证据时 SHALL 经 `sessionQuery.observeSession` 读取；冷读在日志末尾补出的合成 `turn/end interrupted` MUST NOT 作为"已中断"证据，只有日志中实际写入的事件才算。`sessionQuery` 不可用或读取失败时 SHALL 视为证据不足，按既有规则保持等待。

#### Scenario: 合成中断不算证据
- **GIVEN** 子会话日志最后一个 turn 未写入 `turn/end`
- **WHEN** 冷读返回的事件末尾带合成 `turn/end {interrupted}`
- **THEN** 启动恢复不把该 Delivery 结算为 `turn-interrupted`

#### Scenario: 冷读服务不可用
- **WHEN** 启动时 `sessionQuery` 未注册
- **THEN** 不结算任何需要日志证据的 Delivery，诊断记录证据不可用

#### Scenario: 不可区分中断保持等待
- **GIVEN** prepared 观察末尾的真实 `interrupted` 事件与官方合成器对前缀生成的事件逐项相同
- **WHEN** 启动恢复检查该 Delivery
- **THEN** 按证据歧义保守等待，不结算为中断、不重发该 Delivery

#### Scenario: 真实中断立即结算推进
- **GIVEN** prepared 观察含可与合成尾部区分的真实 `turn/end interrupted`，其 turn 与 inbox UUID 唯一匹配 current
- **WHEN** 启动恢复检查该 Delivery
- **THEN** 该 Delivery 结算为 `failed/turn-interrupted`，下一条合格 backlog 可立即派发，原 prompt 不重发

#### Scenario: live 中断不剔除
- **GIVEN** live 观察末尾含与合成器产物逐项相同的真实 `turn/end interrupted`
- **WHEN** 启动恢复检查该 Delivery
- **THEN** 保留该 live 事件并据此结算，合成尾部过滤只用于 prepared 观察

### Requirement: Locus 访问模式

每个入口行 SHALL 有且仅有一个必填的 `accessMode`，取值 `read-only` 或 `danger-full-access`，可选 `verifiedAt`、`grantedBy`（`grantedBy` 记录最近一次变更，`verifiedAt` 在下一次组装核验通过时写入）。它同时决定子会话的沙箱与工具面，MUST NOT 再有独立的文件权限档与工具档位，也 MUST NOT 同时保存期望值与生效值：
- `read-only`：沙箱 `read-only`，工具面不含 `bash`、`skill`。
- `danger-full-access`：沙箱 `danger-full-access`，工具面在 `read-only` 之上加 `bash`、`skill`。
- 任何取值 MUST NOT 开放委派工具（见「Locus 业务出站只能经受管 finish」）。

新建、原地重建、改绑或迁移后重置以及 `stopped` 重新启用的入口行，`accessMode` 一律为 `read-only`，MUST NOT 继承旧值；来源工作主会话当前允许写文件也不改变这一点。

飞书侧的变更命令 SHALL 统一为 `/access read|full`（短参 `-a`），只受理 allowlist 的发送者；非 allowlist 发送者按既有控制命令规则拒绝。原 `/scope`、`/tools`、`-s`、`-t` MUST NOT 再改变任何状态，回执 SHALL 提示改用 `/access`。管理面经 `access` 动作变更。

变更 SHALL 只对 `state` 为 `not-created` 或 `active` 的行受理；`stopped` 与 `invalid` 的行 SHALL 以 `INVALID_REQUEST` 拒绝，入口行与 `revision` 不变（这两种行的重新启用或原地重建本来就会把 `accessMode` 重置为 `read-only`）。

变更 SHALL 按下列步骤执行，MUST NOT 写任何持久的操作记录：
1. `acquireAccessChange(locusId)`：作为仓储写队列里的一个短操作，在队列内复查没有任何未终态的 Delivery、且入口不在 `accessChanging` 集合中，然后把 `locusId` 加入集合并返回当时的 `{locusId, revision}`；任一条件不满足则确定性拒绝并说明入口忙。`acceptDelivery`、停止、改绑、迁移与原地重建的提交 SHALL 在各自的队列回调内检查该集合，命中即拒绝（原因：入口正在变更访问模式）。`agent/created` 的发布边界（见「已退役的 locus 子会话不能再运行」第 0 条）同样 SHALL 检查该集合，命中即拒绝本次发布；因此父 M 经 `locus_reply_child` 触发的冷恢复，在 drain→CAS 窗口内不能按旧值发布。MUST NOT 在整个外部操作期间占用写队列。
2. 证明入口 live 空闲：无未终态投递 + turn 边界空闲（沿用现有检查，含 GUI 与 inquiry 的 turn）+ 该子会话 inbox 无待处理输入；任一不满足则以 `LOCUS_BUSY` 拒绝。
3. 子会话常驻时，经 `drainChildren(exactLiveParent, [exactSessionId])` 真正释放它：只释放目标，兄弟不受影响；MUST NOT 以 `adapter.dispose` 代替。目标不在 resident 中时 `drainChildren` 是成功的 no-op，因此 CAS 之前 SHALL 再确认目标 live agent 确实已退出，否则以 `LOCUS_BUSY` 拒绝。释放失败（含 parent 已过期被拒、promise reject）以 `LOCUS_BUSY` 拒绝。
4. 以第 1 步返回的 `{expectedLocusId, expectedRevision}` CAS 写行：`accessMode`、`grantedBy`、`revision + 1`，并清空 `verifiedAt`。
5. 在 `finally` 中把 `locusId` 移出集合。

变更期间 MUST NOT 做 live 应用、回读、回滚，也没有因变更而置为 `invalid` 的分支；任一步失败入口都处于自洽状态：释放失败 → 入口行未改、变更以 `LOCUS_BUSY` 拒绝，但 runtime 可能已释放或部分关闭，回执与诊断 MUST NOT 声称子会话仍在运行；CAS 失败 → 行未变，子会话已释放，下次唤醒按旧行冷恢复。回执 SHALL 一律写明“已更新，下次唤醒时应用并核验；核验失败将拒绝服务”，MUST NOT 回执为已生效；授予时 MUST NOT 当场核验。

核验发生在下一次组装（冷恢复，或首次创建的 `agent/created`）：SHALL 按入口行上的值应用并回读，一致则写入 `verifiedAt`；回读不符属于“组合失败 B 类”（见「换绑与归档按层处理」），拒绝发布，MUST NOT 回退到旧值。首次创建同样按行上的值组装，因为 `not-created` 期间也可以修改。

全局写开关 `LOCUS_WRITE_ENABLED` 关闭时：SHALL 拒绝把 `accessMode` 设为 `danger-full-access`；SHALL 允许改回 `read-only`；已经是 `danger-full-access` 的入口，唤醒组装时 SHALL 拒绝发布（B 类，入口行不改写，诊断说明写档已全局停用）。MUST NOT 静默降级为 `read-only`。

准入：`danger-full-access` 期间，入口 SHALL 只接受 allowlist 成员的 at 作为工作请求；该检查按 `accessMode` 判断，对 `not-created`、`active` 等所有状态生效。非 allowlist 成员的 at SHALL 得到确定性拒绝回执，说明该入口当前为所有者专用；派发前 SHALL 以同一规则复核，不符的 Delivery 以同一原因结算，MUST NOT 投递给 `danger-full-access` 的子会话。改回 `read-only` 后恢复既有的群成员提问规则。

变更 MUST NOT 写权限审计行；`locus_permission_audit` 表声明保留，旧行冻结不动。

#### Scenario: 新建入口默认只读
- **WHEN** 任一方式从零创建入口，或入口被原地重建、改绑或迁移重置、`stopped` 重新启用
- **THEN** 受影响的每一行 `accessMode = read-only`，不继承重建前的 `danger-full-access`

#### Scenario: 来源会话可写时新建入口仍为只读
- **GIVEN** 工作主会话 W 当前允许文件写入
- **WHEN** 以 W 新建入口并创建子会话
- **THEN** 子会话在工作前经回读确认沙箱为 `read-only`，不静默继承 W 的写能力

#### Scenario: 常驻空闲时变更访问模式
- **GIVEN** 子会话常驻，入口没有未终态的 Delivery，live 空闲
- **WHEN** allowlist 发送 `/access full`
- **THEN** `drainChildren(exactLiveParent, [该入口的 sessionId])` 调用 1 次、`adapter.dispose` 调用 0 次，目标 live agent 已确认退出；行 CAS 为 `accessMode = danger-full-access`、写入 `grantedBy`、`revision` 加 1、`verifiedAt` 清空；`accessChanging` 不含该 `locusId`；回执为“已更新，下次唤醒时应用并核验；核验失败将拒绝服务”；没有写入任何持久操作记录，也没有回读调用

#### Scenario: 非驻留时只写行
- **GIVEN** 子会话已被释放，`accessMode = read-only`
- **WHEN** allowlist 发送 `/access full`
- **THEN** `drainChildren` 调用 0 次；行 CAS 为新值，回执同上；随后一条 Delivery 唤醒子会话且回读一致时，以 `danger-full-access` 服务并写入 `verifiedAt`

#### Scenario: 释放失败时行不变
- **GIVEN** 子会话常驻且空闲
- **WHEN** 释放失败
- **THEN** 以 `LOCUS_BUSY` 拒绝并给出确定性原因；入口行 `accessMode`、`revision` 不变；`accessChanging` 不含该 `locusId`；回执不声称子会话仍在运行（runtime 可能已释放或部分关闭）

#### Scenario: 释放后 CAS 失败时下次按旧行冷恢复
- **GIVEN** 子会话已被 `drainChildren` 释放，随后行的 CAS 因 `revision` 已被推进而失败
- **WHEN** 变更结束，下一条 Delivery 到达
- **THEN** 入口行保持旧值；`accessChanging` 不含该 `locusId`；子会话按旧行的 `accessMode` 冷恢复并核验

#### Scenario: 只释放目标子会话
- **GIVEN** 同一 locus 主会话下兄弟子会话 A、B 均常驻，A 的入口空闲
- **WHEN** 对 A 变更访问模式
- **THEN** `drainChildren` 以 `(exactLiveParent, [A 的 sessionId])` 调用 1 次；B 仍常驻，B 的入口行、`sessionId` 与投递均未受影响

#### Scenario: 目标不在 resident 时须确认已退出
- **GIVEN** 目标不在 resident 中，`drainChildren` 成功 no-op
- **WHEN** 对该入口变更访问模式
- **THEN** 目标 live agent 确认不存在时继续 CAS；目标 live agent 仍存在时以 `LOCUS_BUSY` 拒绝，入口行与 `revision` 不变

#### Scenario: parent 已过期时拒绝
- **GIVEN** 传入的 parent 已不是目标的 exact live parent
- **WHEN** 对该入口变更访问模式，`drainChildren` 因 parent 不匹配被拒绝
- **THEN** 以 `LOCUS_BUSY` 拒绝；入口行不变；`accessChanging` 不含该 `locusId`；兄弟子会话不受影响

#### Scenario: drain 抛错但子会话已不存在
- **GIVEN** `drainChildren` 的 promise reject，但目标 live agent 实际已消失
- **WHEN** 对该入口变更访问模式
- **THEN** 以 `LOCUS_BUSY` 拒绝；入口行 `accessMode` 与 `revision` 均不推进；回执与诊断不声称子会话仍在运行；不置 `invalid`、不回滚；下一条 Delivery 按旧行冷恢复

#### Scenario: drain 与 CAS 之间父会话回复不能冷恢复发布
- **GIVEN** `drainChildren` 已完成，行的 CAS 持久提交被暂停，`accessChanging` 含该 `locusId`
- **WHEN** 父 M 经 `locus_reply_child` 向该入口的 `active` 子会话回复，触发冷恢复
- **THEN** `agent/created` 发布因集合命中被拒绝，不按旧模式发布；CAS 完成并移出集合后再次唤醒，按新 `accessMode` 组装并核验恰一次；兄弟子会话不被释放或阻断

#### Scenario: inbox 有待处理输入时拒绝变更
- **GIVEN** 入口没有未终态的 Delivery，也没有运行中的 turn，但子会话 inbox 有待处理输入
- **WHEN** allowlist 请求变更 `accessMode`
- **THEN** 以 `LOCUS_BUSY` 拒绝，`drainChildren` 调用 0 次，行不变，`accessChanging` 不含该 `locusId`

#### Scenario: live 不空闲时拒绝变更
- **GIVEN** 入口没有未终态的 Delivery，但子会话正在运行一个 GUI turn
- **WHEN** allowlist 请求变更 `accessMode`
- **THEN** turn 边界检查以 `LOCUS_BUSY` 拒绝，`drainChildren` 调用 0 次，行不变，`accessChanging` 不含该 `locusId`

#### Scenario: acquire 与到达的 at 在写队列内竞争（acquire 先）
- **GIVEN** 入口空闲
- **WHEN** `acquireAccessChange` 先在写队列内通过并加入集合，随后同一入口的 at 进入 `acceptDelivery`
- **THEN** `acceptDelivery` 在自己的队列回调内看到集合命中而拒绝（原因：入口正在变更访问模式），投递表无新增；变更结束后同样的 at 被接受

#### Scenario: acquire 与到达的 at 在写队列内竞争（at 先）
- **GIVEN** 入口空闲
- **WHEN** `acceptDelivery` 先在写队列内写入投递，随后 `acquireAccessChange` 进入队列
- **THEN** `acquireAccessChange` 复查发现未终态投递而确定性拒绝，集合不含该 `locusId`，行不变

#### Scenario: 入口忙时拒绝变更
- **GIVEN** 入口有一条未终态的 Delivery
- **WHEN** allowlist 请求变更 `accessMode`
- **THEN** 确定性拒绝并说明入口忙，`accessMode` 与 `revision` 不变

#### Scenario: 变更与停止、改绑、迁移、重建互斥
- **GIVEN** `acquireAccessChange` 已通过（集合含该 `locusId`）
- **WHEN** 同一入口收到停止，或其所在群的改绑、迁移，或原地重建的提交
- **THEN** 它们在各自的队列回调内看到集合命中而拒绝，`agent/created` 的发布边界同样因集合命中而拒绝；反过来，若这些操作先提交使 `revision` 推进，则变更的 CAS 以 `LOCUS_CONFLICT` 失败，`accessMode` 不变

#### Scenario: 写开关关闭时拒绝授予
- **GIVEN** `LOCUS_WRITE_ENABLED` 关闭，入口空闲
- **WHEN** allowlist 发送 `/access full`
- **THEN** 在入口处被拒绝，说明写档已全局停用，不进入变更流程，`accessMode` 不变

#### Scenario: 写开关关闭时迁移得到的完全访问入口可改回只读
- **GIVEN** 迁移得到的入口 `accessMode = danger-full-access`，`LOCUS_WRITE_ENABLED` 关闭，入口空闲
- **WHEN** allowlist 发送 `/access read`
- **THEN** 变更被受理，行 CAS 为 `read-only`；此后写开关仍关闭时，`/access full` 仍被拒绝

#### Scenario: 写开关关闭时既有完全访问入口拒绝服务且行不改写
- **GIVEN** 入口行 `accessMode = danger-full-access`，此后 `LOCUS_WRITE_ENABLED` 被关闭
- **WHEN** 下一条 Delivery 唤醒子会话
- **THEN** 组装拒绝发布，该次投递以说明写档已全局停用的诊断失败结算；入口行不变，仍为 `danger-full-access`；没有任何以 `read-only` 服务该 Delivery 的行为

#### Scenario: 完全访问入口拒绝非 allowlist 成员
- **GIVEN** `not-created` 或 `active` 入口的 `accessMode = danger-full-access`
- **WHEN** 非 allowlist 成员 at bot
- **THEN** 不创建 Delivery，回执说明入口当前为所有者专用；改回 `read-only` 后，同一成员的 at 被正常受理

#### Scenario: 旧命令不再改变状态
- **WHEN** allowlist 发送 `/scope write`、`/tools shell`、`-s write` 或 `-t shell`
- **THEN** `accessMode` 与 `revision` 不变，回执提示改用 `/access read|full`

#### Scenario: 变更不写审计行
- **WHEN** 一次访问模式变更成功
- **THEN** `locus_permission_audit` 的行数不变；入口行的 `grantedBy` 反映本次变更

#### Scenario: stopped 与 invalid 的行不受理访问模式变更
- **GIVEN** 入口行 `state = stopped`（或 `state = invalid`），`accessMode = read-only`，`revision = r`
- **WHEN** allowlist 发送 `/access full`，或管理面提交 `access` 动作
- **THEN** 以 `INVALID_REQUEST` 拒绝；入口行的 `state`、`accessMode`、`revision` 不变（仍为 `r`）；`acquireAccessChange` 与 `drainChildren` 调用均为 0 次，`accessChanging` 不含该 `locusId`

### Requirement: 完全访问由 allowlist 显式授予且如实说明

`danger-full-access` SHALL 由所有者显式选择（allowlist 经飞书 `/access full` 或管理面 `access` 动作），MUST NOT 由系统隐式采用；入口行的 `grantedBy` SHALL 记录最近一次变更，系统不再写权限审计行。授予即代表该入口的成员共享**整机无边界**的文件写能力，以及在所有者本机执行命令、使用所有者本机飞书凭据的能力（读取与网络不受限）。系统 SHALL 在管理面与飞书回执中如实说明这一点，MUST NOT 声称写范围等于某个目录，MUST NOT 把出站 guard 表述为安全边界。`read-only` MUST NOT 因此放宽任何既有约束。

授予 MUST NOT 以任何上下文事实（工作根、约束、资料入口）的确认为前置；工作根只作为上下文事实呈现。授予时 MUST NOT 当场核验：变更只写行并回执“已更新，下次唤醒时应用并核验；核验失败将拒绝服务”；回读不符发生在下一次组装，属于“组合失败 B 类”，拒绝发布，入口行不改写。持久化（CAS）失败时 SHALL 拒绝授予并维持原值。

拒绝 SHALL 给出可行动的确定性原因——无论发生在飞书控制面还是管理面——MUST NOT 以“执行失败，请稍后重试”一类提示代替：写档已停用、入口忙、释放失败、持久化失败都是可判定的稳定事实，重试不会改变结论。

系统 SHALL 提供全局写开关 `LOCUS_WRITE_ENABLED`，**当前默认关闭**，关闭的理由是多个 locus 子会话共享同一份工作目录，而 `danger-full-access` 即完全访问，并发写入尚无协商机制。关闭期间，管理面 SHALL 只禁用“完全访问”这一选项并就地说明原因，“只读”仍可选，MUST NOT 把“完全访问”呈现为可用而在提交时才失败；系统 MUST NOT 把拒绝表述为宿主故障或可重试的临时失败。

#### Scenario: 授予完全访问
- **GIVEN** 写开关开启，入口空闲
- **WHEN** allowlist 发送 `/access full`
- **THEN** 行 CAS 为 `danger-full-access` 并写入 `grantedBy`，`verifiedAt` 清空；回执为“已更新，下次唤醒时应用并核验；核验失败将拒绝服务”，并写明“整机无边界、入口成员共享”及 shell 与飞书凭据的后果，管理面同样写明；本次变更没有任何回读调用

#### Scenario: 下次组装回读不符时拒绝发布
- **GIVEN** 入口行已是 `danger-full-access`，子会话已释放
- **WHEN** 下一次组装回读到的模式不是完全访问
- **THEN** 拒绝发布（B 类），该次投递以确定性诊断失败结算，入口行 `accessMode` 与 `revision` 不变，不写 `verifiedAt`；说明该拒绝是宿主策略所致，不把 prompt 当作解除限制

#### Scenario: 授予不依赖上下文确认
- **GIVEN** 入口从未有过任何工作根确认动作
- **WHEN** allowlist 在空闲入口发送 `/access full`
- **THEN** 授予照常进行，只受入口空闲与写开关约束

#### Scenario: 非 allowlist 变更被拒
- **WHEN** 非 allowlist 群成员发送 `/access full`
- **THEN** 按控制命令规则拒绝，`accessMode` 不变

#### Scenario: 关闭期间管理面只禁用完全访问选项
- **GIVEN** 入口空闲，不在 `accessChanging` 中
- **WHEN** 所有者在写开关关闭期间打开管理面
- **THEN** “完全访问”选项不可用并就地说明写档已全局停用的原因；“只读”选项仍可用；点击不可用项不产生请求

#### Scenario: 拒绝必须给出原因而非重试提示
- **WHEN** 授予因写档已停用、入口忙、释放失败或持久化失败而被拒
- **THEN** 飞书控制面与管理面都返回对应的确定性原因，响应中不含“请稍后重试”

### Requirement: 整群重置原语 resetChat

改绑与整 W 迁移 SHALL 共用同一个事务体 `resetChat(chatId, {toM, workspaceId?, reboundFrom?, clearDefaultQa?})`，由调用方在自己的事务内执行；本要求是它的唯一规范，「改绑到其他会话」与「换绑与归档按层处理」只引用它：
- 群行写入 `locusMainSessionId = toM`，以及给出的 `workspaceId`、`reboundFrom`；`clearDefaultQa` 时去掉群行的 `defaultQa` 标记，否则标记随群行保留；
- 同 `chatId` 下每一条非 `stopped` 的行：新预留 `sessionId`、`state = not-created`、`accessMode = read-only`、`revision + 1`；`stopped` 的行（包括 `stopped` 的群行）保持 `stopped`，但 `accessMode` 重置为 `read-only`、`revision + 1`，使旧围栏全部失效；
- **未注入的 backlog 改指新 `sessionId`**，SHALL 在事务内按当时的投递表计算（`acceptDelivery` 不拿群锁，`ensureLocusMain` 的外部创建要几秒，期间新消息可能落在旧 `sessionId` 上）。“未注入”按真实持久形状判定：状态为 `accepted` 且处于 backlog，没有 execution、inbox、turn 证据；已交给 runtime 的 `queued` / `running` / `finishing` MUST NOT 被改指，它们属于 current；
- 事务内复查该群没有 current 投递，有则整体回滚。“current”包括已交给 runtime 的 `queued` / `running` / `finishing` 投递；它们同样阻止改绑与整 W 迁移。

提交 SHALL 在**同一个 repository 写回调**内完成：读取最新行集合与投递表，逐行按 `expectedRevision` CAS，复查 current，再改指 backlog，不绕过现有 guard。

`locusId` MUST NOT 改变。单入口的 `invalid` 原地重建对单行做同样的重置与 backlog 改指。创建失败轮换不是生命周期重置：它只换首创身份（`sessionId`、`revision + 1`，未注入 backlog 改指新预留），**保留 `accessMode` 与 `state`**。

#### Scenario: 重置一个群
- **GIVEN** 群行 G 与话题行 T1 为 `active`、T2 为 `stopped`（`accessMode = danger-full-access`），G 的 `defaultQa` 标记已设置；无 current 投递，T1 有一条 `accepted` 的 backlog Delivery D（无 execution、inbox、turn 证据）
- **WHEN** 调用 `resetChat(C, {toM: M1, clearDefaultQa: false})`
- **THEN** G 的 `locusMainSessionId = M1`；G、T1 各获得新预留的 `sessionId`、`state = not-created`、`accessMode = read-only`、`revision` 加 1；T2 仍为 `stopped`，但 `accessMode = read-only`、`revision` 加 1；三行 `locusId` 不变；G 的 `defaultQa` 仍在；D 改指 T1 的新 `sessionId`

#### Scenario: clearDefaultQa 清除标记
- **GIVEN** G 带 `defaultQa`
- **WHEN** 调用 `resetChat(C, {toM: M1, clearDefaultQa: true})`
- **THEN** G 不再带 `defaultQa`；其余效果同上

#### Scenario: backlog 按事务内的投递表改指
- **GIVEN** `ensureLocusMain` 的外部创建期间，T1 又接受了一条落在旧 `sessionId` 上的新 Delivery D2
- **WHEN** 事务内执行 `resetChat`
- **THEN** D2 与先前的未注入 backlog 一起改指新 `sessionId`；没有任何 `accepted` 且无执行证据的 backlog 投递仍指向旧 `sessionId`

#### Scenario: 已交给 runtime 的投递不被改指
- **GIVEN** 群 C 下一行有 `running`（或 `queued` / `finishing`）的 Delivery R（属于 current），另一行有 `accepted` 的 backlog Delivery D
- **WHEN** 事务内执行 `resetChat`
- **THEN** R 的 `sessionId` 关联在任何时刻都不被改写；事务因存在 current 回滚，D 的指向同样不变

#### Scenario: stopped 群行下仍有 active 话题时整群重置
- **GIVEN** 群行 G 为 `stopped`、`revision = 7`，话题行 T 为 `active`
- **WHEN** 对该群执行 `resetChat`（改绑或迁移）
- **THEN** G 仍为 `stopped`，`locusMainSessionId` 为新 M，`accessMode = read-only`，`revision = 8`；T 重置为 `not-created`；携带 `expectedRevision: 7` 的 `access` 或 `stop` 请求以 `LOCUS_CONFLICT` 拒绝

#### Scenario: 事务内发现 current 则整体回滚
- **GIVEN** 调用方的前置检查之后，群 C 下某行被接受并成为 current
- **WHEN** 事务内复查
- **THEN** 整个事务回滚：群行的 `locusMainSessionId` 与各行的 `sessionId`、`state`、`revision` 均不变，backlog 的指向不变

### Requirement: 改绑到其他会话

Host SHALL 提供 `rebind` 动作：当一个群（或文档）的当前工作主会话 W 已归档时，把该群的全部入口在一个事务内改挂到新的 W1，各入口在新 M 下按首条消息重新创建子会话，**不保留上下文**。本要求只规定 Host 语义；管理面入口见管理面的要求。

请求 SHALL 经通用 `locus-action` 路由发出：`{action: 'rebind', chatId, workSessionId, expectedLocusId, expectedRevision}`，围栏取群行的值。Host SHALL 依次检查，首个不满足者拒绝；拒绝时 MUST NOT 写入任何东西、MUST NOT 调用 `ensureLocusMain`：
1. 群行存在，否则 `LOCUS_NOT_FOUND`；
2. 围栏匹配，否则 `LOCUS_CONFLICT`；
3. 当前 W 已归档，否则 `INVALID_REQUEST`（原因：当前会话仍在服务）；
4. 目标是普通一级会话——未归档、不是子会话、不是任何 locus 主会话——否则 `INVALID_REQUEST`；
5. 同 `chatId` 下没有 current 投递（包括 `queued` / `running` / `finishing`），否则 `LOCUS_BUSY`；backlog MUST NOT 阻止改绑，它会被改指新 `sessionId`。

通过检查后，Host SHALL 在群锁内持 W1 的 main lease 直到发布：先 `beginProvisioning(kind: 'rebind')`；`ensureLocusMain(W1)` 取得 M1，没有就新建，新建的 M1 与协作空间记入该操作的资源；然后调用「整群重置原语 resetChat」，参数 `{toM: M1, workspaceId: W1 的工作区, reboundFrom: 原 W, clearDefaultQa: true}`。提交前任何失败（`LOCUS_BUSY`、CAS 冲突、崩溃）SHALL 按 provisioning 失败补偿，只回收本操作新建的 M1 与协作空间；已有的 M1 MUST NOT 受影响。

改绑 MUST NOT：更换任何行的 `locusId`；归档旧子会话（旧子会话不再被引用，也因「已退役的 locus 子会话不能再运行」而不能再运行，历史保留）；改动旧 M 与旧协作空间；迁移协作条目；向群里发送任何消息；占用 W1 的默认 Q&A。回执只出现在管理面。首次创建子会话时的来历说明见「投递 prompt 的首投前言与逐次档位声明」。

若 W1 已有 active 配对但其 M 不可用（被归档、删除、preset 核验失败或不在 DSH Pet 工作区），Host SHALL 在 `beginProvisioning` 之前先对 W1 执行整 W 迁移（见 M 不可用的迁移要求），再把本群挂到新的 M1 下；W1 的其它群有 current 投递时 SHALL 以 `LOCUS_BUSY` 拒绝改绑且不创建任何资源（实现阶段补充，2026-11-06，真机验收发现）。

#### Scenario: 改绑目标的 locus 主会话已不可用
- **GIVEN** 群 G 的原 W 已归档；目标 W1 的 active 配对 M 已被归档，M 下没有群
- **WHEN** 所有者在管理面把 G 改绑到 W1
- **THEN** W1 先完成整 W 迁移（M 置 retired、新 M1 为 active），G 随后挂到 M1 下，各入口为 `not-created`、`read-only`，`reboundFrom` 为原 W；若 W1 的其它群有 current 投递则以 `LOCUS_BUSY` 拒绝，且不新建 M1
#### Scenario: 改绑成功
- **GIVEN** 群 C 的当前 W0 已归档；群行 `active`、话题行 T1 `active`、话题行 T2 `stopped`，均无 current 投递；W1 已有 active M1
- **WHEN** 以正确的围栏请求 `rebind` 到 W1
- **THEN** `beginProvisioning(kind: 'rebind')` 调用 1 次；`resetChat` 以 `{toM: M1, reboundFrom: W0, clearDefaultQa: true}` 执行：群行 `locusMainSessionId = M1`、`reboundFrom = W0`；群行与 T1 重置，T2 仍为 `stopped`；三行 `locusId` 不变；没有群消息发出

#### Scenario: 目标 W 尚无 locus 主会话
- **GIVEN** 同上，但 W1 没有 M
- **WHEN** 请求 `rebind` 到 W1
- **THEN** 新建 M1 并随该 provisioning 操作一起建立协作空间；全部行都在 M1 下；旧 M 与旧协作空间不被改动

#### Scenario: 默认 Q&A 标记被清除且不占用 W1 的默认位
- **GIVEN** 群 C 的群行带 `defaultQa`；W1 的 M1 下另有群 C2 的群行带 `defaultQa`（或没有）
- **WHEN** 改绑成功
- **THEN** C 的群行不再带 `defaultQa`；C2 的标记保持不变（若 M1 下原本没有标记，则仍然没有）

#### Scenario: 存在 backlog 时改绑并改指
- **GIVEN** 当前 W 已归档，群 C 下话题行 T1 有两条 `accepted` 的 backlog Delivery（无 execution、inbox、turn 证据），没有 current
- **WHEN** 请求 `rebind`
- **THEN** 改绑成功，两条 Delivery 改指 T1 的新 `sessionId`

#### Scenario: 改绑被拒绝的各种情形
- **GIVEN** 下表各行对应的前置状态（W1 为请求中的目标）
- **WHEN** 分别请求 `rebind`
- **THEN** 每行都得到表中的错误码；持久层无写入，`ensureLocusMain` 调用 0 次，`beginProvisioning` 调用 0 次

| 前置状态 | 错误码 |
|---|---|
| 请求的 `chatId` 没有群行 | `LOCUS_NOT_FOUND` |
| `expectedRevision` 已过期 | `LOCUS_CONFLICT` |
| 当前 W 未归档 | `INVALID_REQUEST` |
| 目标已归档 | `INVALID_REQUEST` |
| 目标是子会话 | `INVALID_REQUEST` |
| 目标是某个 locus 主会话 | `INVALID_REQUEST` |
| 群 C 下某行有 current 投递 | `LOCUS_BUSY` |

#### Scenario: 提交前出现 current 时回滚并只补偿本操作的资源
- **GIVEN** 通过全部检查并新建了 M1 与协作空间后、事务提交前，群 C 下某行成为 current
- **WHEN** `resetChat` 在事务内复查 current
- **THEN** 以 `LOCUS_BUSY` 回滚，群行与各行均未改变；本操作新建的 M1 与协作空间被补偿回收

#### Scenario: 已有 M1 在失败时不受影响
- **GIVEN** W1 已有 active M1 与协作空间，改绑在提交前因 CAS 冲突失败
- **WHEN** provisioning 失败补偿运行
- **THEN** M1 与其协作空间未被归档或改动

#### Scenario: 新建 M1 后进程崩溃
- **GIVEN** 改绑已新建 M1 与协作空间并记入该操作的资源，进程在事务提交前终止
- **WHEN** Host 重启并运行 provisioning 补偿
- **THEN** 补偿器回收该操作新建的 M1 与协作空间；群行与各行保持改绑前的值；重新请求 `rebind` 可再次成功

### Requirement: 已退役的 locus 子会话不能再运行

一个入口一行之后，被替换掉的旧子会话（改绑、迁移、原地重建、创建失败轮换、首图降级、迁移归并，以及 v19 清除留下的）不再被任何行引用。`agent/created` 时 Host SHALL 做**一次** `child-locus` 查找，按顺序判定：
0. 入口在 `accessChanging` 中，或有阻断的首次创建恢复债（publishing / compensating / needs-recovery）→ 拒绝发布；新的正常首创自身的 live publication 不算遗留债；
1. 找到 `active` 行且 `sessionId` 匹配 → 按该行组装；
2. 找到 `not-created` 行，且与 staged 预留的 `(sessionId, M, revision)` 精确匹配 → claim 一次，进入首次创建；
3. agent 的持久 preset 为 `locus-child`，但上两条都不满足 → 拒绝发布，诊断为“已退役的 locus 子会话不可再运行”；会话历史仍可查看；
4. preset 不是 `locus-child` → 普通会话（W、worker 等），放行，MUST NOT 受影响。

现有的 durable lookup 对非 `active` 行直接抛错，MUST 改为上述判定，否则 staged 的首次创建到不了 claim；同时 MUST 保留其对首次创建恢复债的拒绝（第 0 条），不得因改写而丢掉该门禁，也不增加查找次数。

#### Scenario: 首次创建经 staged 精确匹配 claim 一次
- **GIVEN** 入口行 `not-created`，预留 `sessionId = C1`，staged 预留为 `(C1, M, r)`，与行精确匹配
- **WHEN** `agent/created` 触发
- **THEN** 判定为第 2 条：claim 一次并进入首次创建；不被判为已退役，其自身的 live publication 不被判为遗留恢复债

#### Scenario: 首图降级轮换后的首次创建
- **GIVEN** 首图降级使入口行 `sessionId` 由 C0 轮换为 C1、`revision` 加 1，staged 预留更新为 `(C1, M, r+1)`
- **WHEN** 纯文本重试的 `agent/created` 触发
- **THEN** 按新的 `(C1, M, r+1)` 精确匹配并 claim 一次，不被恢复债门禁拒绝；C0 此后不再匹配

#### Scenario: 被替换的旧子会话冷恢复被拒绝
- **GIVEN** 入口 A 的 `sessionId` 因改绑、迁移、原地重建、创建失败轮换或迁移归并由 C0 换为 C1
- **WHEN** C0 被冷恢复，或所有者在 GUI 中重新打开它
- **THEN** 拒绝发布，诊断含“已退役的 locus 子会话不可再运行”；C0 的历史仍可查看；C1 不受影响

#### Scenario: 存在首次创建恢复债时冷恢复与父回复都被拒绝
- **GIVEN** 入口行 `active`、`sessionId = C1` 不变，但持久层留有 `needs-recovery` 的首次创建恢复债，没有 staged 预留
- **WHEN** C1 被冷恢复，或父 M 经 `locus_reply_child` 回复触发冷恢复
- **THEN** 两条路径都在第 0 条拒绝发布；恢复债由既有恢复协议完成之前，不按第 1 条组装

#### Scenario: 访问模式变更期间发布被拒绝
- **GIVEN** 入口在 `accessChanging` 中，`active` 行 `sessionId` 匹配
- **WHEN** `agent/created` 触发
- **THEN** 判定为第 0 条，拒绝发布；移出集合后同一子会话可按第 1 条组装

#### Scenario: 普通会话不受影响
- **WHEN** preset 不是 `locus-child` 的 W 或 worker 被创建或恢复
- **THEN** 判定为第 4 条，放行；其创建与恢复不因没有 locus 行而被拒绝

### Requirement: 持久层 v20 只承载同构的 locus 入口行

持久层版本 SHALL 为 20。`loci` SHALL 一个入口一行，主键为 `endpointKey(chatId, threadId?)`，行形状如下：
- 两类行都有：`locusId`（实例 id，只在入口从零创建时生成，原地重建与改绑都不换）、`sessionId`（预留阶段与已创建阶段共用一个值；每次运行身份变化都换新值，且永不复用）、`state`（`not-created` / `active` / `invalid` / `stopped`）、`accessMode`、必填的 `revision`（同一入口单调递增，原地重建与改绑都不归零）、`createdAt`、`updatedAt`，以及可选的 `stoppedAt`、`invalidReason`、`verifiedAt`、`grantedBy`。
- 仅群行：`locusMainSessionId`、`workspaceId`、可选 `reboundFrom`，以及可选的布尔 `defaultQa`（标记该群是其 M 的默认 Q&A 群）。

`generation`、`replacesLocusId`、`parentSessionId`、`parentLocusId`、`source`、`childSessionId`、`reservedChildSessionId`、`childComposition`、`busy`、`contextAnchor`、`permission`、`toolTier`、`retiredAt` 不再存在，MUST NOT 被读取或写入；`revision` MUST NOT 有 optional 回退。

集合 SHALL 满足：每个话题行有同 `chatId` 的群行；`locusId` 唯一；`sessionId` 在全部行中唯一；话题行不含群行专属字段；同一 M 下至多一个群行带 `defaultQa`。该约束由 `validateLocusSetForStorage` 与每个写入口检查，行 schema 不满足时 Domain 打开失败。另外每条群行的 `locusMainSessionId` SHALL 在 `locus_mains` 中有记录，由 Host 启动对账在接收任何飞书消息之前检查。任一条件不满足时，Pet SHALL 保持未就绪，诊断中包含违规记录的 key 或 id，MUST NOT 跳过违规行继续服务。某个工作主会话从未建立 locus 主会话时，按它查找入口（如默认 Q&A）SHALL 返回“未建立”而不是报错；只有已读到群行而其 M 缺少配对时才是非法数据。

索引 SHALL 只有：`child-locus`（键为 `sessionId`，用于按 caller 查找）与 `parent-loci`（M → 群行的入口键）。不再有 `endpoint-current` 与持久的 `default-qa` 索引，也 MUST NOT 新增 `locus-id` 索引：按 `locusId` 查找 SHALL 直接扫表。所有索引都由 `repairDerivedIndexes` 按行推导，且在注册任何读取索引的回调（agent 创建、工具、飞书接收）之前完成。默认 Q&A 的查找路径 SHALL 为：W 的 active M → `parent-loci` → 带 `defaultQa` 的群行。locus 侧 MUST NOT 读取 `chat_bindings` 与 `invocation_channel`（两表的声明保留只读，供 Pet 其它旧子系统使用）。

#### Scenario: 合规数据正常就绪
- **GIVEN** 持久层只含满足上述条件的入口行
- **WHEN** Pet 启动
- **THEN** Pet 就绪，管理路由注册，所有入口按既有规则服务

#### Scenario: 话题行没有群行使 Domain 打开失败
- **GIVEN** 持久层中一条话题行没有同 `chatId` 的群行
- **WHEN** Pet 启动
- **THEN** Pet 未就绪，诊断包含该话题行的 key；不注册管理路由，不接收飞书消息

#### Scenario: 群行的 M 无配对使启动对账失败
- **GIVEN** 一条群行的 `locusMainSessionId` 不在 `locus_mains` 中
- **WHEN** Pet 启动
- **THEN** 启动对账失败，Pet 未就绪，诊断包含该行 key；不接收飞书消息

#### Scenario: 重复 sessionId 被拒绝
- **GIVEN** 待写入集合中两个不同入口行持有同一个 `sessionId`
- **WHEN** 任一写入口提交
- **THEN** 集合校验拒绝，写入不生效

#### Scenario: 全部索引按行重建
- **GIVEN** `parent-loci`、`child-locus` 与行不一致或缺失
- **WHEN** Host 启动并运行 `repairDerivedIndexes`
- **THEN** 两个索引与按行推导的结果相同；不存在 `endpoint-current`、`default-qa` 与 `locus-id` 索引；`getLocus(locusId)` 对每一行都能找到

#### Scenario: 默认 Q&A 经标记查找
- **GIVEN** W 的 active M 下，群行 G 带 `defaultQa`，另一群行 G2 不带
- **WHEN** 所有者为 W 打开默认 Q&A
- **THEN** 查找路径 W → active M → `parent-loci` → 带标记的群行，返回 G；没有读取任何持久的 `default-qa` 索引

#### Scenario: 同一 M 下两个默认 Q&A 标记被拒绝
- **GIVEN** 待写入集合中同一 M 下两个群行都带 `defaultQa`
- **WHEN** 任一写入口提交，或 Host 启动加载
- **THEN** `validateLocusSetForStorage` 拒绝，写入不生效或 Pet 保持未就绪，诊断包含两个违规行的 key

#### Scenario: 从未建立 locus 主会话的会话首次打开 Q&A
- **GIVEN** 工作主会话 W 没有任何 locus 主会话
- **WHEN** 所有者为 W 打开默认 Q&A
- **THEN** 查找默认 Q&A 返回未建立，随后正常新建 locus 主会话与只含群行的 Q&A 群，该群行带 `defaultQa`

#### Scenario: chat_bindings 旧标记不再被 locus 读取
- **GIVEN** 某群没有 locus 行，但有一条 `chat_bindings` 旧标记
- **WHEN** 该群收到所有者授权 at
- **THEN** 按 auto 规则从零创建；locus 侧对 `chat_bindings` 的读取为 0 次；`chat_bindings` 表的行逐字节不变

### Requirement: 旧数据经 v20 离线迁移清除并整形

离线迁移脚本 SHALL 在 DSH 停止时运行，把版本 2..19 的数据库迁移到 20，沿用 v19 的框架：只读预检 → 持锁复查 → 备份 → 单事务。源版本低于 19 时，SHALL 先按 v19 规则清除旧模型 locus 行（父会话在 `locus_mains` 中没有记录的行，记 id 集合为 L），以及 `locusId ∈ L` 的投递、切换通知、权限审计和 `locusId`、`oldLocusId` 或 `newLocusId ∈ L` 的操作（版本 ≤17 先补建 `locus_mains` 表），再执行 v20 整形。旧形状（v19 行）的预检 SHALL 用脚本内的旧形状分析，最后才用 v20 的 `validateLocusSetForStorage` 校验整形结果；MUST NOT 用同一个新函数冒充两个版本的证明。

**拒绝条件**：以下任一成立时脚本 SHALL 拒绝迁移（`--dry-run` 也报告为拒绝），以非零码退出并列出违规行。预检阶段（含 `--dry-run` 与未确认运行）的拒绝不产生任何物理写入；`--yes` 锁内复查的拒绝保证不做 checkpoint、不写备份、不改变任何行与版本号。
- 全库存在状态不在 Host `TERMINAL_STATUSES` 内的投递；
- 全库存在 phase 不是 `committed` 或 `compensated` 的 locus 操作；
- 清除之后保留的集合不满足 v19 加载条件（按旧形状分析判定）；
- 话题行没有同 `chatId` 的群行；
- 存在 `switching` 或 `provisioning` 状态的行；
- 存在 `inherited` 来源的群行。

**归并而非拒绝**：话题行的 M 与其群行不一致（v19 允许）时，脚本 SHALL 把话题行的 M 以群行为准，并让该话题行原地重建（新预留 `sessionId`、`not-created`、`accessMode = read-only`；`stopped` 保持 `stopped`）。`--dry-run` SHALL 逐条列出被归并的话题行及其原 M，由所有者核对后再 `--yes`；旧子会话仍留在原 M 下，且因「已退役的 locus 子会话不能再运行」不能再运行。

**同 W 跨配对群归并**：v19 合法地允许“同一 W 的唯一 active 配对已存在，而某些群的最新群行仍挂在该 W 的其它 `retired` 配对上”（旧的 M 迁移会跳过忙或已停止的群）。脚本 SHALL 在 `defaultQa` 映射**之前**把这些群统一改挂到该 W 的唯一 active M：群行 `locusMainSessionId` 改为该 M，该群的非 `stopped` 入口按「整群重置原语 resetChat」规则重置，`stopped` 入口（含 `stopped` 的群行）保持 `stopped`，但 `accessMode` 重置为 `read-only`、`revision + 1`。`--dry-run` SHALL 逐条列出被归并的群及其原配对，并写明上下文损失（被重置入口的旧子会话上下文不迁移）。同 W 没有任何 active 配对时 MUST NOT 归并，留给运行期的整 W 迁移。MUST NOT 以放宽运行期“每个 W 至多一个 active M”的校验代替归并。

**整形**（同一持锁事务内）：
- `loci`：每个入口取最新一代，改写成 v20 形状，主键换成入口键，原 `id` 作为 `locusId`；`retired` 改为 `stopped`，`stoppedAt = retiredAt ?? stoppedAt ?? updatedAt`；`sessionId = childSessionId ?? reservedChildSessionId`，两者都没有时（v19 合法的、从未创建也无预留的非 active 行）生成新的预留 `sessionId`（`session-<uuid>`），`state`、`locusId` 与时间字段不变；仅当 `permission.effective = write` 且 `toolTier.effective = shell` 时 `accessMode = danger-full-access`，其余一律 `read-only`；`revision` 取当前值（缺失视为 0）；历史代删除。
- `locus_deliveries`：全部保留，去掉 `generation`，`childSessionId` 改名为 `sessionId`。
- `locus_indexes`：全部删除（v20 的所有索引都可推导）。v19 的 `default-qa` 指针改写为群行的 `defaultQa` 标记：取 `locusIds[0]` 找到原行（可能是同入口的旧代），映射到该入口保留下来的最新行；该行必须是群行，否则清除该指针。MUST NOT 解析或比较索引键里的 M。同一 M 下映射出多个标记（含归并之后）时，SHALL 清除其中全部标记并逐条列出，MUST NOT 择一保留。每个被清除的指针 SHALL 在 `--dry-run` 中逐条列出，MUST NOT 静默。
- `locus_switch_notices` 与 `locus_operations`：清空。
- `locus_permission_audit`：**不改动**，旧行冻结（仅源版本 <19 时按 v19 规则清除 `locusId ∈ L` 的行）。
- 提交前 SHALL 用 v20 的 `validateLocusSetForStorage` 校验整个结果集合；不通过则回滚。
- MUST NOT 修改 locus 以外的表：待办台账、询问、`chat_bindings`、`invocation_channel` 以及 `ledger_item`（含其 `generation`，该字段在解析器中改为可缺省，写入方不再写）保持逐字节不变。

**执行保证**：`--dry-run`、未确认运行与预检拒绝只做只读查询，MUST NOT 做 WAL checkpoint 或写文件。`--yes` SHALL 先取得独占锁并持有到事务提交，锁内重新读取版本戳、表结构与数据并重新执行全部拒绝判定（锁内发现已是 20 时报告无需迁移，发现不支持的版本时拒绝）；通过后依次：WAL checkpoint；写数据库备份（checkpoint 之后的完整快照）；单事务完成清除与整形并把版本号改为 20。事务失败 SHALL 回滚，版本号与全部行不变，备份保留。未给出 `--dry-run` 或 `--yes` 时 SHALL 不写入任何东西并说明需要确认；数据库被占用（DSH 未停止）时给出可操作的提示并失败；已是 20 时报告无需迁移并退出 0。脚本 SHALL 按相对自身文件位置的路径导入包内 `lib/` 中 Host 的校验代码，经 `node_modules/.bin` 符号链接、在仓库以外的工作目录调用时同样可用；部署自检（self-check）SHALL 实际导入 v20 整形与旧形状预检用到的全部模块。拒绝时 SHALL 说明处理方式：在途工作等其结束；无法自行结束的恢复债须先用当前版本 Host 清理或由所有者人工处理，再运行迁移。

#### Scenario: dry-run 只读并列出归并
- **GIVEN** 一个 v19 数据库，含 `oc_bb0e` 型数据：群行在 M0 下，话题行在 M1 下
- **WHEN** 以 `--dry-run` 运行脚本
- **THEN** 输出列出该话题行及其原 M（M1）与归并后的 M0；数据库文件与 WAL 文件字节不变，没有生成备份文件

#### Scenario: 确认后整形 locus 行
- **GIVEN** v19 数据库中入口 E 有 3 代：前两代 `retired`，最新一代 `active`，`childSessionId = S3`，`permission.effective = write`、`toolTier.effective = shell`、`revision = 5`；DSH 已停止
- **WHEN** 以 `--yes` 运行脚本
- **THEN** E 只剩一行，主键为入口键，`locusId` 为最新一代的原 `id`，`sessionId = S3`，`state = active`，`accessMode = danger-full-access`，`revision = 5`；前两代不存在；备份文件存在，用它打开得到的全部行与迁移前相同；版本为 20

#### Scenario: accessMode 只在写加 shell 时为完全访问
- **GIVEN** 三条行：`write`+`safe`、`read`+`shell`、`read`+`safe`
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 三条行的 `accessMode` 全部为 `read-only`

#### Scenario: retired 改为 stopped 并保留停止时间
- **GIVEN** 入口最新一代 `retired`，`retiredAt = t1`；另一条 `stopped`，无 `stoppedAt`，`updatedAt = t2`
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 两条行均为 `state = stopped`，`stoppedAt` 分别为 `t1` 与 `t2`

#### Scenario: 没有任何会话 id 的非 active 行得到新的预留 sessionId
- **GIVEN** v19 中 `stopped`、`invalid` 和 `not-created` 各一条行，三行既无 `childSessionId` 也无 `reservedChildSessionId`；另有一个 v18 库中同样形状的 `stopped` 行（经 v19 清除后保留）
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 每行都得到各不相同的新 `sessionId`（形如 `session-<uuid>`），`state`、`locusId`、`createdAt`、`updatedAt` 不变；整形结果通过 `validateLocusSetForStorage`

#### Scenario: 话题与群的 M 不一致时归并并原地重建
- **GIVEN** 话题行 `(C, T)` 为 `active`、挂在 M1 下，其群行 `C` 挂在 M0 下；另一话题行为 `stopped` 且同样挂在 M1 下
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 迁移成功；两条话题行不再含 M，解析得 M0；`active` 的话题行新预留 `sessionId`、`state = not-created`、`accessMode = read-only`；`stopped` 的保持 `stopped`；M1 下的旧子会话未被改动

#### Scenario: 同 W 跨配对群被归并到唯一 active M
- **GIVEN** v19 库，所有 Delivery 均为终态；W 的唯一 active 配对为 M1；普通群 G 的群行在 M1 下；默认 Q&A 群 Q 的群行、其 `active` 话题行 QT、`stopped` 话题行 QS 挂在 W 的 `retired` 配对 M0 下，默认 Q&A 指针指向 Q
- **WHEN** 先 `--dry-run` 再 `--yes`
- **THEN** `--dry-run` 列出 Q 及其原配对 M0、目标 M1，并写明上下文损失，数据库字节不变；`--yes` 之后 Q 的群行 `locusMainSessionId = M1`；Q 与 QT 获得新预留 `sessionId`、`not-created`、`read-only`、`revision` 加 1；QS 保持 `stopped`、`read-only`、`revision` 加 1；三行 `locusId` 不变；G 不变；Q 的群行带 `defaultQa`；整形结果通过 `validateLocusSetForStorage`

#### Scenario: 归并后默认 Q&A 可发现且不外部建群
- **GIVEN** 上一场景迁移后的库，Pet 已启动
- **WHEN** 所有者为 W 打开默认 Q&A，随后在 Q 与 G 中各发一条授权 at
- **THEN** 默认 Q&A 查找（W → active M1 → `parent-loci` → 带 `defaultQa` 的群行）返回原 Q，外部创建群的调用为 0 次；Q 与 G 的 at 都不触发新建 M、`ensureLocusMain` 的外部创建或配对冲突；Host 重启后同样成立

#### Scenario: 同 W 没有 active 配对时不归并
- **GIVEN** 群 G1、G2 的群行分别挂在同一 W 的 `retired` 配对下，W 没有任何 active 配对
- **WHEN** 先 `--dry-run` 再 `--yes`
- **THEN** 迁移成功，两个群行的 `locusMainSessionId` 保持原值；`--dry-run` 说明这些群不归并，留给运行期的整 W 迁移

#### Scenario: 归并后出现多个默认 Q&A 候选时全部清除（含 stopped 群行）
- **GIVEN** 归并后同一 M 下有两个群行都被 `default-qa` 指针映射为候选，其中一个是 `stopped` 的群行
- **WHEN** 先 `--dry-run` 再 `--yes`
- **THEN** `--dry-run` 逐条列出这两个候选；`--yes` 之后该 M 下没有群行带 `defaultQa`

#### Scenario: 全部投递保留并改名
- **GIVEN** 库中有终态投递，带 `generation` 与 `childSessionId`
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 投递行数不变，每行不再有 `generation`，`childSessionId` 的值出现在 `sessionId` 字段

#### Scenario: default-qa 指针按表改写为群行标记
- **GIVEN** `locus_indexes` 中有 `endpoint-current`、`parent-loci`、`child-locus` 与若干 `default-qa` 指针，各自的 `locusIds[0]`、索引键与原行状态如下表
- **WHEN** 先 `--dry-run` 再 `--yes`
- **THEN** 结果如下表；`--dry-run` 输出逐条列出所有被清除的指针及原因；`--yes` 之后 `locus_indexes` 为空，每个 M 下至多一个群行带 `defaultQa`（上表最后一行的 M 下为零个），整形结果通过 `validateLocusSetForStorage`

| 指针情形 | 结果 |
|---|---|
| `locusIds[0]` 是入口 E 的最新一代，E 是群行 | E 的群行带 `defaultQa` |
| `locusIds[0]` 是入口 E 的旧代 `L3`，E 的最新一代 `L9` 是群行 | `L9` 对应的群行带 `defaultQa` |
| 索引键被截断，或与 `value.key` 不一致，其余同第一行 | 同第一行，不因键而被清除，也不比较键中的 M |
| `locusIds[0]` 找不到原行（悬空） | 无标记，dry-run 列出 |
| `locusIds[0]` 的最新一代是话题行 | 无标记，dry-run 列出 |
| 两个或更多指针映射到同一 M 下的不同群行（损坏数据，或同 W 跨配对群归并之后的多个候选，候选中包括 `stopped` 群行上的标记） | 这些指针全部被清除，该 M 下没有群行带标记，dry-run 逐条列出 |

#### Scenario: 切换通知与操作被清空，权限审计不变
- **GIVEN** 库中有切换通知、已结束的操作，以及 v19 中入口 E 的若干权限审计行（`locusId` 不在 L 中）
- **WHEN** 以 `--yes` 运行脚本
- **THEN** `locus_switch_notices` 与 `locus_operations` 为空；`locus_permission_audit` 的全部行逐字节不变

#### Scenario: 非 locus 表逐字节不变
- **GIVEN** 待办台账、询问、`chat_bindings`、`ledger_item`（含带 `generation` 的行）
- **WHEN** 以 `--yes` 运行脚本后打开 Pet，并读取所有者待办列表与已退休询问列表
- **THEN** 这些表的全部行逐字节不变；两个列表读取成功，条目与迁移前相同

#### Scenario: 话题行没有群行时拒绝
- **GIVEN** 一条话题行，其 `chatId` 下没有群行
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 脚本以非零码退出并指出该话题行；数据库不变，没有备份

#### Scenario: switching、provisioning 与 inherited 行时拒绝
- **GIVEN** 分别存在 `switching` 行、`provisioning` 行、`inherited` 来源的群行
- **WHEN** 对每种情形以 `--yes` 运行脚本
- **THEN** 每次都以非零码退出并指出违规行；数据库不变，没有备份

#### Scenario: 存在非终态投递时拒绝
- **GIVEN** 库中任意一条投递处于 `queued`
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 脚本以非零码退出并指出该投递及处理方式；版本号与全部行不变，没有写入备份

#### Scenario: 存在未完成的操作时拒绝
- **GIVEN** 库中一条 locus 操作处于 `provisioning`，且没有任何 locus id 字段
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 脚本以非零码退出并指出该操作；数据库不变

#### Scenario: 预检通过后出现非终态投递时锁内拒绝
- **GIVEN** 预检通过后、取得独占锁之前，另一个写入者向库中写入一条 `queued` 投递（含 WAL 中尚未 checkpoint 的写入）
- **WHEN** `--yes` 取得锁并在锁内复查
- **THEN** 脚本以非零码退出并指出该投递；没有做 checkpoint、没有备份文件，全部行与版本号不变

#### Scenario: 旧形状预检与最终校验分离
- **GIVEN** v19 行集合在 v19 规则下合法，但含 v20 校验不接受的形状（如话题行与群行的 M 不一致）
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 旧形状预检按 v19 规则放行（M 不一致走归并）；`validateLocusSetForStorage` 只作用于整形后的 v20 结果集合，结果通过

#### Scenario: 整形结果校验失败时回滚
- **GIVEN** 整形后的结果集合不满足 v20 的 `validateLocusSetForStorage`
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 事务回滚，版本号与全部行不变，备份文件保留

#### Scenario: 从 v18 迁移时先清除旧模型行
- **GIVEN** 一个 v18 数据库，含 3 条旧模型 locus 行（父会话不在 `locus_mains`）、引用它们的 4 条终态投递，以及 2 条三层 locus 行
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 3 条旧模型行及引用它们的投递、审计、操作不存在；2 条三层行被整形为 v20 形状；版本为 20；备份写在任何改动之前

#### Scenario: 从更早版本迁移时全部 locus 行都是旧模型
- **GIVEN** 一个 v17 数据库，含 2 条 locus 行，没有 `locus_mains` 表
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 备份写在任何改动之前；版本为 20，`locus_mains` 表存在且为空，两条 locus 行都被删除

#### Scenario: 预检后版本已变化
- **GIVEN** 预检时版本为 19，取得锁之前该库已被迁移到 20
- **WHEN** `--yes` 在锁内复读版本戳
- **THEN** 报告已是目标版本并以 0 退出，不写入任何东西

#### Scenario: 未确认时不写入
- **WHEN** 不带 `--dry-run` 和 `--yes` 运行脚本
- **THEN** 脚本以非零退出码结束，数据库不变，没有备份文件

#### Scenario: 已是目标版本时无操作
- **GIVEN** 已迁移到 20 的数据库
- **WHEN** 再次以 `--yes` 运行脚本
- **THEN** 报告已是目标版本并以 0 退出，不写入任何东西

#### Scenario: 已安装的命令在仓库外可用
- **GIVEN** 按生产方式安装的 dsh-pet 包（依赖不提升到上层目录），当前目录不在仓库内
- **WHEN** 经 `node_modules/.bin/dsh-pet-migrate-state --dry-run --db <测试库>` 调用
- **THEN** 脚本成功加载包内校验代码并输出报告，没有模块解析错误

#### Scenario: 自检导入全部整形与预检模块
- **GIVEN** 部署自检（self-check）运行
- **WHEN** 它加载迁移脚本依赖的 v20 整形模块与旧形状预检模块
- **THEN** 每个模块都被实际导入；任一模块缺失或无法导入时自检以非零码失败

### Requirement: 管理面按工作会话分组且每个入口一行

所有者管理面 SHALL 按**工作会话 W** 分组呈现，MUST NOT 以单条 locus 记录平铺，也 MUST NOT 按 locus 主会话 M 分组。每个 W 组 SHALL 只渲染一次 W 的标题、短码、工作区与可用性（`work`），并带出与之一一对应的 M（`locusMain`）；同一 W MUST NOT 被重复渲染为多份。W 下的群行或文档根行（无 `threadId` 的入口）是入口主行；话题行或评论行（带 `threadId` 的入口）SHALL 按 `chatId` 嵌套在同 `chatId` 的群行之下。

**每个入口恰好一行**：入口原地重建或改绑后 `locusId` 不变而 `revision` 递增，仍是同一行；管理面 MUST NOT 出现「历史 N 代」或任何折叠的历史行，MUST NOT 呈现 `generation`、`contextAnchor`、`permission`、`toolTier`、`childComposition`。每行 SHALL 以文字呈现状态，并把 `accessMode` 作为**单一值**呈现（「只读」或「完全访问」）：管理面 MUST NOT 把它拆成两个读数，也 MUST NOT 另显示「待应用」或与存储值不同的「生效值」。`danger-full-access` 的说明 SHALL 沿用既有披露：整机无边界、入口成员共享。「投递中」标记 SHALL 由投递表（该入口是否存在非终态的 current Delivery）推出，MUST NOT 依赖行上的 `busy` 字段。群行带 `reboundFrom` 时 SHALL 显示「改绑自」及原 W 的名称与短码。`revision` 仅作为变更请求的围栏，MUST NOT 呈现为所有者可见读数；用于客户端变更检测的快照 generation 同样 MUST NOT 呈现。

#### Scenario: 同一工作会话的多个群只出现一次 W
- **WHEN** 一个 W 下有群 `oc_A` 与文档根 `doc:docx:D`
- **THEN** 该 W 的标题、工作区与可用性只渲染一次，两个入口作为其下的群行呈现；其 M 作为该 W 的 locus 主会话只出现一次

#### Scenario: 话题按 chatId 嵌套在群行之下
- **WHEN** 群 `oc_A` 的群行之下有两个话题行，且另一个群 `oc_B` 也有一个话题行
- **THEN** 前两个话题行嵌套在 `oc_A` 群行之下，第三个嵌套在 `oc_B` 群行之下；没有任何话题行脱离其群行单独出现

#### Scenario: 原地重建后仍是一行
- **GIVEN** 某入口经 `invalid` 原地重建，`locusId` 不变，`revision` 由 3 变为 4，`state = not-created`
- **WHEN** 管理面呈现该入口
- **THEN** 该入口只有一行；页面不出现「历史」「代」字样或可展开的历史区

#### Scenario: 访问模式以单值呈现
- **GIVEN** 入口 A 的 `accessMode = read-only`，入口 B 的 `accessMode = danger-full-access`
- **WHEN** 管理面呈现两行
- **THEN** A 显示「只读」，B 显示「完全访问」并附「整机无边界、入口成员共享」；两行都不出现单独的「文件权限」「工具档位」「待应用」读数

#### Scenario: 投递中由投递表推出
- **GIVEN** 话题行 T 存在一条非终态的 current Delivery，群行 G 没有
- **WHEN** 管理面呈现二者
- **THEN** T 显示「投递中」，G 不显示；T 的 Delivery 进入终态后重新加载快照，T 的「投递中」消失

#### Scenario: 改绑后的群行显示来源
- **GIVEN** 群行带 `reboundFrom = <原 W>`
- **WHEN** 管理面呈现该群行
- **THEN** 该行显示「改绑自」及原 W 的名称与短码；没有 `reboundFrom` 的群行不显示此项

### Requirement: 管理面按工作会话与入口状态筛选，条件由筛选控件自述

管理面的状态筛选 SHALL 恰有三个平铺选项：「在服务」（默认勾选）、「已停止 / 已失效」（默认不勾选）、「已归档」（默认不勾选）。「在服务」对应 `not-created` 与 `active` 入口，`not-created` 入口 MUST 在默认视图中可见；「已停止 / 已失效」对应 `stopped` 与 `invalid` 入口。工作会话 W 已归档的入口，无论其自身状态，SHALL 只计入「已归档」，不计入其它两个选项；因此 W 已归档的组默认隐藏，勾选「已归档」后才显示，并在其群行或文档根行上写明「来源会话已归档，可改绑」，「改绑到其他会话」按钮随之出现。已归档的 W 仍 SHALL 显示其标题。`state` 不在四值集合内的入口（显示为「未知状态」）SHALL 在任何筛选下都显示，且不计入任何选项；唯一例外是它位于已归档 W 之下时，计入「已归档」。各选项的计数之和 SHALL 等于入口总数（不含上述未知状态例外）。披露 SHALL 由筛选控件独自承担，MUST NOT 在列表内另加"隐藏出口"行：该行只是重复控件已经表达的条件，且把入口整体下推。筛选控件在收起状态 SHALL 表达当前生效的条件，MUST NOT 仅以一个无语义的图标表示；其浮层 SHALL 按桶给出**全量快照**的计数（含当前未勾选的桶），并 SHALL 允许逐桶勾选与一键重置。列表为空时 SHALL 说明可放宽的条件，MUST NOT 让入口读起来像已被删除。筛选 SHALL 只影响呈现，MUST NOT 改变任何持久化状态，也 MUST NOT 被表述为已修改数据。

管理面不提供「重建」或「重新启用」动作：被显示出来的 `invalid` 行 SHALL 就地写明「下一条授权 @ 时自动重建」，`stopped` 行 SHALL 就地写明「在该入口对同一来源会话重新 `/bind` 可重新启用」。群行因状态被隐藏、其下仍有可见的话题行时，该群行 SHALL 作为容器保留并以文字标明其状态，MUST NOT 让可见话题行失去所属群。群行或文档根行上的「改绑到其他会话」 SHALL 直接位于该行上，MUST NOT 要求先展开折叠区或打开菜单。

#### Scenario: W 已归档的组默认隐藏，勾选「已归档」后显示并提示可改绑
- **GIVEN** 某 W 已归档，其下群行为 `active` 或 `not-created`；筛选浮层恰有「在服务」「已停止 / 已失效」「已归档」三个选项，默认只勾选「在服务」
- **WHEN** 所有者以默认筛选打开管理面，随后勾选「已归档」
- **THEN** 默认视图不显示该 W 组；勾选后显示该 W 组，仍带有该 W 的标题，群行上写明「来源会话已归档，可改绑」，并直接带有「改绑到其他会话」按钮；该组入口只计入「已归档」，三个选项的计数之和等于入口总数

#### Scenario: 停止已归档 W 的群行后被默认隐藏
- **GIVEN** 某 W 已归档，其群行为 `stopped`，群行下没有其它仍在服务的话题行
- **WHEN** 所有者以默认筛选，或勾选「已停止 / 已失效」后，打开管理面
- **THEN** 两种筛选下都不显示该组；只勾选「已归档」时显示，群行状态为「已停止」

#### Scenario: 默认隐藏已停止与已失效的入口
- **WHEN** 某入口为 `stopped` 或 `invalid`
- **THEN** 默认视图不把它呈现为活跃入口；筛选控件的收起态显示「入口：在服务」，浮层里「已停止 / 已失效」桶给出计数；勾选后该行出现，`invalid` 行显示「下一条授权 @ 时自动重建」，`stopped` 行显示「在该入口对同一来源会话重新 /bind 可重新启用」，且这两行都没有「重建」按钮

#### Scenario: 未创建入口默认可见
- **GIVEN** W 可用，其群行与话题行都是 `not-created`
- **WHEN** 所有者以默认筛选打开管理面
- **THEN** 两行都出现在默认视图中并显示「未创建」；浮层中「在服务」桶的计数包含它们

#### Scenario: 已停止群行下仍有活跃话题
- **GIVEN** 群行 `stopped`，其下话题行 `active`
- **WHEN** 所有者以默认筛选打开管理面
- **THEN** 话题行仍可见，且嵌套在以文字标明「已停止」的群行容器之下；不出现无群行的孤立话题行

#### Scenario: 筛选只影响呈现
- **WHEN** 所有者切换筛选条件
- **THEN** 任何 locus、状态、访问模式与关联均不发生变化，页面不产生写入

#### Scenario: 筛选后为空时说明可放宽的条件
- **GIVEN** 全部入口都是 `stopped`
- **WHEN** 所有者以默认筛选打开管理面
- **THEN** 列表区显示空态，并写明可放宽的条件（勾选「已停止 / 已失效」），不呈现为入口已被删除

### Requirement: 管理面的变更动作只有停止、访问模式与改绑，且以 locusId 加 revision 为围栏

管理面发起的每个变更请求 SHALL 经通用 `locus-action` 路由，并携带 `expectedLocusId` 与 `expectedRevision` 作为唯一围栏；MUST NOT 携带 `expectedGeneration` 或 `expectedUpdatedAt`。动作集合 SHALL 仅为 `stop`、`access`、`rebind`，外加只读的 `view` / `defaultQa` / `todos`；MUST NOT 提交 `bind`、`unbind`、`archive`、`scope`、`tools`、`confirm-anchor`、`rebuild`、`replace-parent`。围栏不匹配时 Host 拒绝，管理面 SHALL 提示刷新并 MUST NOT 乐观改写显示。

`access` 动作提交目标 `accessMode`（`read-only` / `danger-full-access`）。全局写开关关闭期间，选择 `danger-full-access` 的控件 SHALL 不可用并就地说明原因，MUST NOT 呈现为可用而在提交时才失败；“只读”仍可选（含已是完全访问的入口改回只读）。变更成功时，管理面 SHALL 如实显示回执「已更新，下次唤醒时应用并核验；核验失败将拒绝服务」（不论子会话是否常驻），MUST NOT 声称已应用；Host 拒绝时 SHALL 显示其确定性原因，MUST NOT 以「请稍后重试」代替。`not-created` 入口同样允许修改 `accessMode`。入口处于「投递中」（由投递表推出）时，访问模式控件与「停止」SHALL 都不可用并就地写明原因（「该入口正在投递，待其结束后再修改访问模式」「该入口正在投递，待其结束后再停止」），点击 MUST NOT 产生请求。置灰只是便利，Host 对忙入口的访问模式变更与停止仍确定性拒绝（仅空闲时受理）。

#### Scenario: 停止请求以 locusId 与 revision 为围栏
- **GIVEN** 入口行 `locusId = L1`、`revision = 5`
- **WHEN** 所有者确认「停止」
- **THEN** 提交的请求体含 `action: 'stop'`、`expectedLocusId: 'L1'`、`expectedRevision: 5`，且不含 `expectedGeneration` 与 `expectedUpdatedAt`

#### Scenario: 修改访问模式提交目标值
- **GIVEN** 入口 `accessMode = read-only`，全局写开关已开启
- **WHEN** 所有者选择「完全访问」并确认
- **THEN** 请求体含 `action: 'access'`、`accessMode: 'danger-full-access'` 与同一入口的 `expectedLocusId`、`expectedRevision`

#### Scenario: 回执不声称已应用
- **GIVEN** Host 接受了访问模式变更（子会话常驻与否均同）
- **WHEN** 管理面显示回执
- **THEN** 回执为「已更新，下次唤醒时应用并核验；核验失败将拒绝服务」；入口行的 `accessMode` 显示为新值，不另加「待应用」标记

#### Scenario: 写开关关闭时完全访问不可选
- **GIVEN** 全局写开关关闭，入口空闲且不在访问模式变更中
- **WHEN** 所有者查看某入口的访问模式控件
- **THEN** 「完全访问」选项置灰，旁边显示原因文字（全局写开关已关闭）；点击置灰项不产生任何请求；「只读」选项仍可选，选择后请求被提交

#### Scenario: 投递中时访问模式与停止都置灰
- **GIVEN** 入口存在非终态的 current Delivery（显示「投递中」）
- **WHEN** 所有者查看该行的操作区
- **THEN** 访问模式控件与「停止」都置灰并分别写明原因，点击不产生请求；该入口空闲后两者恢复可用

#### Scenario: 围栏过期时拒绝而不乐观改写
- **GIVEN** 管理面持有的 `revision = 5`，Host 上该入口已是 `revision = 6`
- **WHEN** 所有者确认「停止」，Host 因围栏过期拒绝
- **THEN** 管理面显示「入口已变化，请刷新后重试」，该行仍显示变更前的状态，不改写为「已停止」

### Requirement: 管理面提供「改绑到其他会话」，仅在原 W 已归档且无 current 投递时可用

管理面 SHALL **仅在**群行或文档根行所属的 W 已归档时，在该行上直接提供「改绑到其他会话」（不在折叠区或菜单内），该行同时写明「来源会话已归档，可改绑」。W 可用或无法证明已归档（含无冷读能力）时，该行 MUST NOT 出现按钮、原因行或输入框。控件 MUST NOT 在话题行或评论行提供。所有者 SHALL 输入目标工作会话的完整 sessionId；提交的请求体 SHALL 为 `{action: 'rebind', chatId, workSessionId, expectedLocusId, expectedRevision}`，其中 `expectedLocusId` 与 `expectedRevision` 取自该**群行**。

控件出现后，SHALL 仅在该 `chatId` 下任一入口有 current 投递时置灰，并就地写明原因「该群有入口正在投递，待其结束后再改绑」，点击置灰控件 MUST NOT 产生请求。

改绑控件只因 current 投递置灰，而「投递中」徽标与停止、访问模式的置灰按“任一非终态投递”判定；这一差异是有意的，因为改绑的 `resetChat` 会把 backlog 改指新 `sessionId`，而停止与访问模式变更不处理 backlog。

提交前的确认 SHALL 说明后果：各入口在新会话下按首条消息重新创建子会话，**不保留上下文**；不迁移协作条目，不归档旧子会话，不向群里发通知。输入为空时提交 SHALL 不可用；输入原样（去除首尾空白）作为 `workSessionId` 提交。置灰只是便利，Host 的检查才是权威：Host 拒绝（具体情形与错误码见「改绑到其他会话」）时，管理面 SHALL 显示其确定性原因，保留输入，MUST NOT 乐观改写显示。成功后回执 SHALL 只出现在管理面，并标明新 W；重新加载的快照中，该群所有非 `stopped` 入口显示为「未创建」与「只读」，`stopped` 入口保持「已停止」，群行显示「改绑自」原 W。

#### Scenario: 原 W 已归档时提交改绑
- **GIVEN** 已勾选「已归档」；群行 `chatId = oc_A`、`locusId = L1`、`revision = 4`，其 W 已归档，该群下没有 current 投递
- **WHEN** 所有者在群行上点击「改绑到其他会话」，输入 `S_NEW` 并确认
- **THEN** 提交的请求体为 `{action: 'rebind', chatId: 'oc_A', workSessionId: 'S_NEW', expectedLocusId: 'L1', expectedRevision: 4}`；成功后管理面显示回执并标明新 W，且刷新后该群出现在新 W 组下，群行显示「改绑自」原 W

#### Scenario: 改绑后各入口重置而停止的保持停止
- **GIVEN** 改绑前群行与话题 T1 为 `active`（`danger-full-access`），话题 T2 为 `stopped`
- **WHEN** 改绑成功并重新加载快照
- **THEN** 群行与 T1 显示「未创建」「只读」，T2 显示「已停止」；三行的 `locusId` 均未变化

#### Scenario: 原 W 未归档时不显示改绑控件
- **GIVEN** 群行所属 W 可用且未归档
- **WHEN** 所有者查看该群行
- **THEN** 该行没有「改绑到其他会话」按钮、没有原因文字、没有输入框，也不显示「来源会话已归档，可改绑」；不产生任何请求

#### Scenario: 无法证明归档时同样不显示改绑控件
- **GIVEN** 宿主无冷读能力，W 的可用性读数被省略
- **WHEN** 所有者查看该群行
- **THEN** 该行同样没有按钮、原因文字与输入框，也不显示「来源会话已归档，可改绑」，不因无法证明而放行

#### Scenario: 有入口在投递时置灰
- **GIVEN** 已勾选「已归档」；其 W 已归档，但同 `chatId` 下某话题行存在 current 投递
- **WHEN** 所有者查看群行
- **THEN** 「改绑到其他会话」置灰并显示「该群有入口正在投递，待其结束后再改绑」；群行仍显示「来源会话已归档，可改绑」

#### Scenario: 话题行与评论行没有改绑控件
- **WHEN** 所有者查看任一话题行或评论行的操作区
- **THEN** 不出现「改绑到其他会话」

#### Scenario: Host 拒绝目标时不乐观改写
- **GIVEN** 其 W 已归档，所有者输入的目标是另一个 locus 主会话的 sessionId
- **WHEN** Host 拒绝该请求
- **THEN** 管理面显示 Host 返回的确定性原因，输入框保留所填内容，群行仍显示在原 W 组下、改绑前的状态

#### Scenario: 空输入不可提交
- **WHEN** 改绑对话框的输入为空或只有空白
- **THEN** 「确认」按钮置灰，点击不产生请求

### Requirement: 控制命令帮助

`@bot -h`、`@bot --help`、`@bot /help`（及裸 `/help`）SHALL 在 IM 群、话题或文档评论中回复一条控制回执，列出当前可用的控制命令、参数形式与一句话说明，并注明哪些命令仅 allowlist 成员可用。帮助 SHALL 是纯控制命令：不得创建入口、子会话或业务 Delivery，且在已停止的入口上同样可用。回执文本 SHALL 由解析器所用的同一张命令表生成；已弃用的 `/scope`、`/tools` SHALL NOT 出现在其中。帮助与其他控制命令一样仅对 allowlist 发送者可用。

#### Scenario: 查看帮助

- **WHEN** allowlist 成员在入口发送 `@bot -h`
- **THEN** 入口收到一条回执，列出 `/bind`、`/unbind`、`/access` 的参数形式与说明，不含 `/scope`、`/tools`
- **AND** 没有任何入口、子会话或 Delivery 被创建

#### Scenario: 帮助与解析器一致

- **WHEN** 解析器的命令表新增或移除一个命令
- **THEN** 帮助回执随之变化，无需另行修改文本

#### Scenario: 已停止的入口仍可查看帮助

- **WHEN** allowlist 成员在已停止的入口发送 `@bot /help`
- **THEN** 回复帮助回执，而不是被当作停止入口拒绝

#### Scenario: 非 allowlist 发送者

- **WHEN** 非 allowlist 成员发送 `@bot -h`
- **THEN** 与其他控制命令一致，被静默拒绝（`control-not-allowed`）
