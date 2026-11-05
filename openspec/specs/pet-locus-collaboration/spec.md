# pet-locus-collaboration Specification

## Purpose

统一描述研发工作上下文与飞书协作现场的关联：所有入口先取得主会话，再由专属子会话持续服务。覆盖研发先行、project 群先行、群与话题的层级补齐、双向发现、权限及上下文切换，不以旧 QA 或 workspace executor 的实现分类组织产品。

## Requirements

### Requirement: 管理面的会话可用性以持久证据判定

管理面展示主/子会话可用性时 SHALL 以持久化日志的冷读结果为证据，MUST NOT 以会话当前是否已加载到内存作为存在性判据。已归档 SHALL 优先于可读性判定。宿主不具备冷读能力时 SHALL 省略该事实，MUST NOT 以宿主自身限制推断会话缺失。

同一会话在未发生任何状态变化时，其可用性读数 MUST NOT 因加载与卸载而改变。

#### Scenario: 重启后未加载的会话不得报为不可用
- **WHEN** Host 重启后所有者查看一条活跃 locus，其主/子会话尚未被打开
- **THEN** 只要持久化日志可读，二者显示为可用并给出各自标题，不因未加载而报为不可用

#### Scenario: 已归档优先于可读
- **WHEN** 会话已归档但其日志仍可读
- **THEN** 显示为已归档，不显示为普通可用

#### Scenario: 缺少冷读能力不臆测
- **WHEN** 宿主未提供会话冷读能力
- **THEN** 省略可用性事实，不断言会话缺失

### Requirement: 全部飞书工作统一为子会话常规交互

新模型 SHALL 仅对 mention 自身 bot 的消息触发工作，包括单聊；普通非 mention 内容 MUST NOT 启动推理、总结或自动更新主会话。消息 SHALL 由对应 locus 的同一个长期 child session 持续处理（子会话在该代第一条消息到达时才创建，见"子会话在首条消息到达时创建"），MUST NOT 建立飞书 root executor/Invocation 或 waiting-user 执行分支。

每个 locus SHALL 维护按接受序排列的持久 Delivery 队列，任意时刻至多向 child 投递一个 current Delivery。后续合格消息 SHALL 先进入 backlog，只有 current 进入终态后才可投递下一条未过期消息；MUST NOT 依赖 DSH `next-turn`/`next-step` 的合批顺序推断两个飞书请求或父回复的业务归属。

子会话需要决策时 SHALL 直接向当前飞书入口发问，后续 at 回答 SHALL 在同一子会话继续。歧义回答 SHALL 澄清，不自动解释为授权。模型 turn 结束 MUST NOT 被显示为整个项目完成，也 MUST NOT 单独完成 current Delivery。Host 超时推进 SHALL 继续复用同一个 child session及其历史，MUST NOT 自动重建 session 或增加 locus generation。

子会话的运行体驻留 SHALL NOT 被当作代际可用性的一部分。运行体 MAY 在子会话空闲且 inbox 为空时释放它（这是常态而非故障），因此宿主 MUST 以「按需冷恢复该 durable child」的方式取得其 live session 与策略，MUST NOT 因「当前不在内存中」判定该 child 不可用、作废代际或另建 child。宿主 MUST NOT 依赖借出子会话 Session 的兼容能力：需要 live agent 的操作（如就地改沙箱、回读）只在子会话常驻时经 `ctx.agents.get` 进行，否则延后到下一次 `agent/created`；投递经官方 `startContinuable`（首条）与官方 Host prompt 队列（后续，官方负责冷恢复）。

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

### Requirement: 默认 read 与 allowlist 授权独立于绑定

所有新建及替换后的 locus SHALL 默认 read，并在接受工作前核验宿主实际文件策略；MUST NOT 仅依赖部署默认或数据库标签。`-s/--scope read|write` SHALL 仅由 allowlist 改变当前 locus 的共享档位，记录人、时间与生效结果；不存在关联时机械拒绝，未知值拒绝。

写档 SHALL 映射为宿主的完全访问模式（`danger-full-access`）：授予 write 即代表该入口的成员共享**整机无边界**的文件写能力。系统 SHALL 在管理面与飞书回执中如实说明这一点，MUST NOT 声称写范围等于某个目录。

更广模式 SHALL 由所有者显式选择，MUST NOT 由系统隐式采用；显式选择 SHALL 可审计（记录操作者、时间、期望值与生效值）。授予前 SHALL 确认该入口空闲；应用失败 MUST NOT 回执成功。宿主拒绝应用该模式、回读模式不符或持久化失败时 SHALL 拒绝提权并维持/回到 read，并给出可行动原因。read 档 MUST NOT 因此放宽任何既有约束。重新建立关联 MUST NOT 继承旧 write。

写档的权威事实 SHALL 是「宿主回读的 live 文件策略恰为完全访问」；它 MUST NOT 依赖任何持久授权标记。上下文锚点（执行根、约束、资料入口）SHALL 只作为上下文事实注入子会话与展示，MUST NOT 门控提权；`unauthorized` 之类的锚点值若存在，MUST NOT 被当作唯一授权真相。

系统 SHALL 提供一个全局写档开关，**当前默认关闭**。关闭期间：新的 write 请求 SHALL 在入口处（飞书控制面与管理面）被直接拒绝并说明真实原因，MUST NOT 先授予再降级；既有 write 记录 SHALL 在下次核验时按 read 生效并继续服务，MUST NOT 使该入口失效或暂停。降级 SHALL 只发生在派生层，durable 记录 SHALL 保留所有者原本的授权意图，使开关恢复后无需重新授予。

关闭的理由 SHALL 被如实说明：多个 locus 子会话共享同一份工作目录，而 write 即完全访问，并发写入尚无协商机制。系统 MUST NOT 把该拒绝表述为宿主故障或可重试的临时失败。管理面的提权控件 SHALL 在关闭期间不可用并就地说明原因，MUST NOT 呈现为可用而在提交时才失败。

提权被拒绝时 SHALL 给出可行动的确定性原因——无论拒绝发生在飞书控制面还是管理面。MUST NOT 以「执行失败，请稍后重试」一类重试提示代替确定性原因：写档已停用、宿主拒绝应用、入口忙、持久化失败都是可判定的稳定事实，重试不会改变结论。

管理面 SHALL 如实呈现每个入口的生效权限与其工作归属；工作根作为**上下文事实**呈现（由工作区事实承载），MUST NOT 被呈现为提权前置条件。

执行根的「所有者确认」界面已退役。理由：ADR-0005 已把该锚点降级为仅上下文事实、不再门控任何权限，而写档又由全局开关默认关闭——该确认既不能改变任何生效行为，其呈现也只能长期停留在「未确认」，成为每个入口上的一句恒真文案。底层能力 SHALL 保留（`confirm-anchor` 动作及其纯函数），使恢复该界面是一次呈现层改动，而非重新推导规则。

该退役 SHALL NOT 被表述为锚点已无意义：锚点仍作为上下文事实注入子会话，子会话 prompt 的 Context anchor 段在未确认时 SHALL 如实呈现「未确认」，MUST NOT 因此暂停或拒绝该入口服务。

#### Scenario: 写父会话创建只读子会话
- **WHEN** 来源主会话当前允许文件写入，新建 locus
- **THEN** 子会话在工作前确认 read，不静默继承 write

#### Scenario: 授予共享 write
- **WHEN** allowlist 在空闲 locus 提权，且宿主接受完全访问模式
- **THEN** 核验 live 模式为完全访问后回执并记录授权；该入口后续成员共享该档位，管理面明确写出"整机无边界、入口成员共享"

#### Scenario: 宿主拒绝完全访问
- **WHEN** 宿主拒绝应用完全访问模式，或回读到的模式不是完全访问
- **THEN** 拒绝提权并维持 read，说明该拒绝是宿主策略所致，不把 prompt 当作解除限制

#### Scenario: 提权不依赖执行根确认
- **WHEN** 所有者在空闲 locus 提权，而该入口从未确认过执行根
- **THEN** 提权照常进行并只受闲置与 mode 核验约束；锚点缺失不构成拒绝理由

#### Scenario: 授权按 live 模式派生
- **WHEN** 所有者已授予 write，且宿主回读的 live 模式为完全访问
- **THEN** 生效 write 并记录授权人、时间与生效结果，不依赖任何已存储的授权标记

#### Scenario: live 模式漂移
- **WHEN** 某入口已授予 write，但宿主回读的模式不再是完全访问
- **THEN** 按既有策略漂移路径暂停该入口并诊断，MUST NOT 静默继续按 write 服务

#### Scenario: 写档开关关闭时拒绝新提权
- **WHEN** 写档开关关闭，allowlist 在空闲 locus 请求 write
- **THEN** 请求在入口处被拒绝并说明是写档已全局停用及其并发写理由，不进入授予流程，也不表述为宿主故障或可重试失败

#### Scenario: 开关关闭时既有 write 降为只读且继续服务
- **WHEN** 某入口此前已授予 write，此后写档开关被关闭
- **THEN** 该入口在下次核验时按 read 生效并继续服务，不被暂停或失效；对外呈现的生效档位是 read，不是记录中的 write

#### Scenario: 降级不改写授权意图
- **WHEN** 某 write 入口因开关关闭而降级，随后开关被重新打开
- **THEN** 该入口恢复按其原有授权记录生效，无需所有者重新授予

#### Scenario: 关闭期间提权控件不可用
- **WHEN** 所有者在开关关闭期间打开管理面
- **THEN** 提权控件不可用并就地说明原因，MUST NOT 呈现为可用而在提交时才失败

#### Scenario: 执行根确认界面已退役
- **WHEN** 所有者打开任一 locus 的详情
- **THEN** 管理面不再呈现执行根行或确认入口——它既不能改变任何生效行为，其呈现也只能长期停留在「未确认」
- **AND** 该入口的工作根仍以工作区事实呈现，退役 MUST NOT 被表述为锚点已无意义

#### Scenario: 冷恢复或降权
- **WHEN** 子会话恢复或空闲时被设置 read
- **THEN** 核验实际策略后才继续派发，策略失败停止服务并诊断

#### Scenario: 提权失败必须给出原因而非重试提示
- **WHEN** 提权被拒绝
- **THEN** 飞书控制面与管理面都返回/显示该确定性原因，不用「请稍后重试」掩盖它

### Requirement: 上下文按实际子会话绑定并允许按需问主会话

新建及显式重建的子会话 SHALL 使用独立上下文，不复制主会话已完成前缀、进行中轮次或默认父摘要；初始化 SHALL 只包含自身身份、所服务入口、可信工作归属、权限、已确认锚点和按需询问说明。子会话 SHALL 被明确描述为当前入口的服务者，而非主会话本人。其自身交互 SHALL 持续保存，冷恢复 SHALL 恢复同一 child 历史，不重新播种父上下文。独立历史 MUST NOT 被解释为创建新的工作目录、丢失工具组合或静默更换模型。

系统 SHALL 在创建前核验所用 provider 确实不继承父上下文；无法证明时 SHALL 拒绝创建并如实报告，MUST NOT 静默退回复制父历史的 provider，也 MUST NOT 把拒绝表述为已建立独立 child。已有 fork child 不受本条影响：它们不会被本 change 的创建路径重新创建，其历史 MUST NOT 被裁剪或静默改造。

初始化任务书 SHALL 告知子会话在工作根、约束或相关事实不足时，可通过宿主原生消息能力询问 caller-bound 父会话即 locus 主会话，MUST NOT 允许指定其它 parent 或 locus。locus 主会话不知道干活现场的事实时 SHALL 经 dsh-collab 向干活主会话提问，再以 `locus_reply_child` 回复子会话。父会话回复只是对话事实，SHALL NOT 因此成为持久授权；锚点仍须由所有者在管理面显式确认后写入。答复只提供上下文事实；路径存在性不等于写授权。

父子或 agent 间的 `agent-message` SHALL 只作为子会话上下文通信，不参与 Delivery 路由选择：它 MUST NOT 建立、修改、替换或撤销 current Delivery 已由 Host 绑定的回复目标。current Delivery 存续时，原始飞书投递 turn 结束后的 `agent-message` SHALL 可唤醒同一 child 继续处理该 current；没有唯一 current 时，`agent-message` MUST NOT 自行产生飞书 finish/wait 能力。GUI/user steer、来源不明的参与者消息与第二个已投递 Delivery仍 SHALL fail closed。

caller-bound `pet_context` SHALL 提供当前 locus、局部项目入口、已确认局部锚点、权限与 Host 确认的 current Delivery 状态，不允许模型指定其它目标。后续投递只带必要请求事实和查询引导，MUST NOT 每次重复全部说明。未知锚点 SHALL 如实报告。系统 MUST NOT 自动汇总或把子会话结论回传干活主会话；官方结算通知送达 locus 主会话是明确例外，且收到通知不等于结论已被采纳为 agreed charter 或已被干活主会话知晓；对实际询问的定向答复不属于自动结算回报。所有者可主动查阅，项目资料 SHALL 按需读取，不自动共享兄弟子会话历史。

干活主会话 SHALL 被表述为工作归属，locus 主会话为可询问的上下文来源，MUST NOT 因其父节点身份宣称已统合所有协作现场的最新认知。用户显式发起的查阅与汇总不属于自动回传；系统 SHALL 区分可发现、可读取与已采纳，缺少历史读取能力或权限时如实说明。当前模型 MUST NOT 宣称已提供 project 级自动知识同步或多人分布式协同。旧 QA/chat 绑定仍遵守前置版本的退役隔离，不因本兼容规则恢复服务。

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
- **WHEN** 子会话自己的上下文及已确认锚点无法确定当前执行根
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
- **THEN** 系统不自动更新干活主会话，不将该发现呈现为干活主会话已知的项目决策；locus 主会话可能收到官方结算通知，但这不构成采纳

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

### Requirement: 投递与结算关联独立于会话运行状态

每条接受消息 SHALL 有持久 Delivery，至少标识以下各项：入口、locus 代际、child session、触发 `messageId`、接受顺序、`acceptedAt`、deadline、队列/终态与出站结果。

IM Delivery 的 `messageId` 是飞书消息标识。文档 Delivery 的 `messageId` 是 `doc:docx:<token>/<comment_id>/<reply_id>`，它同时是持久去重键，MUST NOT 被当作 IM 消息标识使用。

普通消息标识与评论回复标识 MUST NOT 成为长期 locus 身份，但业务回复 MUST 使用 current Delivery 不可变的触发目标：
- IM 群级与话题级回复都 MUST 以触发 `messageId` 做飞书按消息回复；话题回复还 MUST 留在 Host 从入站事件确认的原话题。
- 评论级（划词评论）回复 MUST 追加在触发 `comment_id` 所在的评论下，且该 `comment_id` MUST 与入口 `threadId` 相同。
- 文档级（全文评论）入口的回复 SHALL 以 bot 身份在同一文档新建一条全文评论，开头以结构化提及 @ 持久 Delivery 的发送者（飞书不允许回复全文评论，详见 `pet-locus-doc-comments`）。
- 两者的触发 token 都 MUST 与入口 `chatId` 中的 token 相同。任一不一致，或文档级入口的发送者不是可证明的 open id 时，SHALL 以 `association-unproven` fail closed，不发送。

接受不等于投递，投递不等于完成，模型 `turn/end` 不等于 Delivery 终态。初始化、GUI 私聊、父子补问 MUST NOT 消耗 current。Host SHALL 保证每个 locus 至多一个 current，且完成、超时与重复调用通过原子状态竞争只终结该项一次；迟到调用 MUST NOT 消费后续 Delivery或新代际。

业务正文唯一完成入口 SHALL 是 caller-bound `pet_locus_finish`。`reply` 必须携带非空正文；`no-reply` MUST NOT 携带正文且必须记录非空原因。工具 MUST NOT 接受任何 Delivery、chat、message、thread、文档、评论、回复或 target selector。Host SHALL 以实际 caller、active locus/generation/permission 与唯一 current 解析不可变目标；不满足时 fail closed。

等待入口 SHALL 是 caller-bound `pet_locus_wait({ waitMinutes, reason? })`。`waitMinutes` SHALL 表示从调用时刻起预计还需等待的正整数分钟，单次不得超过 1440；工具可重复调用，只能延长不能缩短 deadline。初始 deadline SHALL 为 `acceptedAt + 1h`，任何声明后的 deadline MUST NOT 超过同一消息 `acceptedAt + 24h`。Host SHALL 返回实际 deadline、剩余分钟与是否触及硬上限；wait MUST NOT 完成 Delivery或关联父回答。

达到 deadline 的 current SHALL 原子进入 `expired` 并推进；超过 `acceptedAt + 24h` 的 backlog SHALL 在投递前直接过期。Host SHALL 尽力中止过期 current 的运行，但中止成功 MUST NOT 成为撤销回复能力或推进队列的前提；持久状态才是权威。超时 MUST NOT 自动重建 child session。

`reply` SHALL 在发送前原子进入 `finishing` 并固定当前 Delivery。平台明确成功 SHALL 记录 `completed/replied`；明确失败 SHALL 记录 `failed`；请求可能已发出但没有可靠确认 SHALL 记录 `unknown-terminal`。三者均 SHALL 推进队列；`unknown-terminal` MUST NOT 自动重发。`no-reply` SHALL 记录 `completed/no-reply` 后推进，不发送正文。

Host SHALL 维护进行中/完成/失败等控制反馈；反馈失败不阻断工作，也不得冒充业务正文。启动恢复 SHALL 在开放 intake 前过期超时项、把遗留 `finishing` 收敛为 `unknown-terminal`、恢复未过期 current 的 deadline 调度，或在无 current 时幂等投递最早未过期 backlog。无法证明 current、child 或 generation 一致时 SHALL 暂停对应 locus 并诊断，不猜目标、不重放发送、不新建替代身份。

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
- **THEN** 同目录生成 `state.sqlite.v15.bak-<ms>`，用它打开得到的全部行与迁移前相同（它是独占锁内 checkpoint 之后的完整快照）；版本戳变为当前域版本 19；v15 库没有 `locus_mains`，因此原有 locus 行全部属于旧模型并被清除，按"旧模型 locus 数据经离线迁移清除"处理；随后当前 Host 能打开存储，原 IM 入口在下一条授权 at 时按 auto 规则建立三层结构

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
- **WHEN** Host 重启时发现一个未过期 current 且原 locus/generation/child 可精确证明
- **THEN** 恢复同一 current、同一 child session 与 deadline 调度，不把 `turn/end` 当完成，不新建替代 session

#### Scenario: Host 重启处理遗留 finishing
- **WHEN** Host 重启时发现发送结果尚未落账的 `finishing` Delivery
- **THEN** 将其收敛为 `unknown-terminal` 并继续队列，不重放可能已经成功的飞书发送

#### Scenario: 私聊与群消息交错
- **WHEN** GUI 私聊或初始化发生在 current 飞书请求处理期间
- **THEN** 不消费该请求、不产生飞书正文，相关执行不能调用 finish/wait 获得 current 能力

#### Scenario: 旧代际迟到结算
- **WHEN** S0 child 在入口切换后出现迟到 finish
- **THEN** 该调用不能更新 S1 或其 current Delivery，无法安全提交时只诊断

#### Scenario: 宿主重启无法证明关联
- **WHEN** 恢复时无法精确证明持久 current 对应原 child 与 locus generation
- **THEN** 暂停该 locus intake 并诊断，不猜 FIFO、最近消息或新建替代身份

### Requirement: 管理面按入口聚合且区分代际

所有者管理面 SHALL 以**入口**（一个飞书 endpoint：群或话题）为第一层呈现单位，MUST NOT 以单条 locus 记录为单位平铺。一个入口的当前代 SHALL 占据主行，其历史代际 SHALL 折叠为可展开的「历史 N 代」；折叠 MUST NOT 隐藏事实，展开后各代的状态、时间与其专属子会话 SHALL 仍可完整核对。同一父会话 MUST NOT 被重复渲染为多份；其特征（工作区、可用性）SHALL 只出现一次，该父会话的入口 SHALL 归入其下。话题 locus SHALL 按其 `parentLocusId` 嵌套在所属群级 locus 之下。管理面 SHALL 区分 locus 代际与用于客户端变更检测的快照 generation，MUST NOT 将后者呈现为所有者可见读数。

#### Scenario: 同一入口的多代聚合为一行

- **WHEN** 一个入口经重建产生第 3 代，其前两代仍为已停止与已退役
- **THEN** 管理面以一行呈现该入口，主行是第 3 代，前两代折叠为「历史 2 代」；展开后各代的状态、时间与子会话均可核对

#### Scenario: 同一父会话的多个入口只出现一次父会话

- **WHEN** 一个父会话下关联了两个入口
- **THEN** 该父会话的标题、工作区与可用性只渲染一次，两个入口作为其下的入口行呈现

#### Scenario: 话题嵌套在群级之下

- **WHEN** 某群已有群级 locus，其下新话题建立了继承该群来源的话题 locus
- **THEN** 该话题行嵌套在群级入口行之下，并标明其继承来源

### Requirement: 管理面的标识以确定性短码表达且名称与短码成对

管理面 SHALL 为每类对象提供由真实标识**确定性派生**的短码，并以该短码作为线索即可复制完整标识。以下每类对象各有一条明确规则：locus、父会话与子会话、群与会话入口、话题、文档入口、评论入口、工作区。文档入口与评论入口的规则：
- 文档入口：源子串取 `chatId` 中 `doc:docx:` 之后的 token，显示标签为 `doc·`，兜底名为 `文档 · <短码>`，名称取 `drive +inspect` 返回的文档标题。
- 评论入口：`comment_id` 是按时间递增的数字，前缀相同的情况很常见，因此源子串取 `threadId`（`comment_id`）的**逆序**字符串，使截取的前缀落在末尾数字上。显示标签为 `cmt·`，兜底名为 `评论 · <短码>`。
- 碰撞时按类别加长，沿用现有规则。
- 不同类别靠显示标签区分，不依赖源子串不同。短码 MUST NOT 被用作任何请求的输入或身份来源。当平台提供可辨识名称时，管理面 SHALL 优先呈现名称，且名称 SHALL 与短码成对出现——名称单独 MUST NOT 构成身份。平台未提供名称时，管理面 SHALL 呈现由角色词与短码构成的兜底名，MUST NOT 猜测平台事实（例如在 chat 类型未知时写成「群」）。原始标识 MUST NOT 作为入口行的主要标识，SHALL 收在可展开的标识区并可复制。

#### Scenario: 同名入口仍可区分

- **WHEN** 同一父会话下两个入口的平台名称同为「答疑 · DSH」
- **THEN** 两行分别显示名称并各自附带不同的短码，所有者可区分二者

#### Scenario: 名称不可得时不猜测

- **WHEN** 平台未提供该入口的名称，且该 chat 的类型未知
- **THEN** 管理面显示兜底名（角色词 + 短码）并说明这是兜底显示，不得显示为「群」或其它未证实的平台事实

#### Scenario: 短码不是身份

- **WHEN** 客户端尝试以短码发起任一 locus 操作
- **THEN** 请求不被接受；所有操作仍以完整标识与代际栅栏寻址

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
- **THEN** 显示 `文档 · <短码>`，并标明为兜底名

### Requirement: 管理面提供双向可达且目标不可达时 fail closed

管理面 SHALL 提供两种读法：按父会话（列出该父会话的全部入口）与按入口（列出该入口的当前代及其父会话与子会话）。两种读法 SHALL 由同一份管理快照的同源索引产生，同一对象的呈现 MUST NOT 相互矛盾。每个入口行 SHALL 提供跳转到该入口会话与对应飞书入口的控件；按入口读法 SHALL additionally 提供跳转到父会话的控件。目标已归档、已失效或不可达时，管理面 MUST NOT 提供可用的跳转，SHALL 就地说明原因。话题入口的跳转 SHALL 指向该话题，无法证明话题身份时 SHALL 退化为所属群并如实说明，MUST NOT 伪造目标。

#### Scenario: 两种读法同源一致

- **WHEN** 所有者先在按工作读法查看某父会话的入口，再切到按入口读法查看该入口
- **THEN** 两个方向指向同一个 locus 与同一对父子会话

#### Scenario: 父会话已归档时不可跳转

- **WHEN** 某入口的父会话已归档
- **THEN** 该行的父会话跳转不可用并显示「已归档」，不产生一次静默跳到首页的导航

#### Scenario: 话题身份不可证时退化

- **WHEN** 某入口是话题但无法证明其话题标识
- **THEN** 跳转退化为所属群并说明，不伪造话题目标

### Requirement: 管理面按父会话与入口状态筛选，条件由筛选控件自述

管理面 SHALL 默认只呈现父会话可用、且当前代仍可被服务的关联（`active` / `provisioning` / `switching`）。披露 SHALL 由筛选控件独自承担，MUST NOT 在列表内另加"隐藏出口"行：该行只是重复控件已经表达的条件，且把入口整体下推。筛选控件在收起状态 SHALL 表达当前生效的条件（父会话维度与入口状态维度都要表达），MUST NOT 仅以一个无语义的图标表示；其浮层 SHALL 按桶给出**全量快照**的计数（含当前未勾选的桶），并 SHALL 允许逐桶勾选与一键重置。列表为空时 SHALL 说明可放宽的条件，MUST NOT 让入口读起来像已被删除。筛选 SHALL 只影响呈现，MUST NOT 改变任何持久化状态，也 MUST NOT 被表述为已修改数据。默认隐藏终止态时，管理面 SHALL 让这些入口的**恢复路径**（重建）在显示后位于该行本身，MUST NOT 要求先展开行内折叠区。

#### Scenario: 默认隐藏归档父会话

- **WHEN** 某父会话已归档，其下仍有处于活跃状态的 locus
- **THEN** 默认视图不展开该父会话，也不在列表里追加任何出口行；筛选浮层列出「已归档」及其计数，勾选该桶即显示其入口

#### Scenario: 默认隐藏不再被服务的入口

- **WHEN** 某入口当前代为 `stopped`（Host 此后拒绝该 endpoint 的工作，直到显式重建）
- **THEN** 默认视图不把它呈现为活跃入口；筛选控件的收起态即显示「入口：在服务」，浮层里「已停止 / 已失效」桶给出计数，勾选后该行出现并可直接执行「重建」，无需再展开其它折叠区

#### Scenario: 筛选只影响呈现

- **WHEN** 所有者切换筛选条件
- **THEN** 任何 locus、代际、权限与关联均不发生变化，页面不产生写入

### Requirement: 默认 Q&A 在管理面只读呈现

管理面 SHALL 以与其它 locus 相同的行渲染并额外标记默认 Q&A 入口，SHALL NOT 将其单独列举为一组重复条目。管理面 MUST NOT 提供创建默认答疑群的入口；当某父会话尚无默认 Q&A 时，管理面 SHALL 说明其创建路径位于 Pet 轮盘，MUST NOT 就地提供创建控件。

#### Scenario: 默认 Q&A 只做标记

- **WHEN** 某父会话已有一个默认 Q&A 入口
- **THEN** 该入口在其所在行以标记呈现，页面不重复渲染同一 locus，也不出现创建按钮

#### Scenario: 尚无默认 Q&A 时说明出处

- **WHEN** 某父会话尚无默认 Q&A 入口
- **THEN** 管理面说明「尚未创建，请在目标会话中通过 Pet 轮盘创建」，不提供就地创建入口

### Requirement: 管理面不提供新建外部资源的入口

管理面 MUST NOT 提供需要手工输入 endpoint 或会话标识的绑定控件，MUST NOT 以裸标识列表作为可执行的创建入口。关联的建立 SHALL 由飞书入站消息完成，显式改绑 SHALL 仍由 allowlist 命令完成。管理面 SHALL 保留既有入口的展示、导航与生命周期动作（停止关联、重建、权限与执行根确认）。落到同一持久结果的近义动作 MUST NOT 以多个并列控件呈现：所有者无法据名字区分它们，只会承担误操作风险；若将来某个动作确有不同后果，SHALL 以该后果命名而不是以同义词命名。

#### Scenario: 管理面无绑定控件

- **WHEN** 所有者打开管理面
- **THEN** 页面不出现需要输入 chat/thread/session/workspace 标识的绑定表单

#### Scenario: 生命周期动作仍可用

- **WHEN** 所有者在某空闲入口行展开操作区
- **THEN** 该行提供解绑、归档、停止、重建与权限相关动作，Host 拒绝时状态不被乐观改写

### Requirement: 管理面如实呈现全部生命周期状态

管理面 SHALL 逐一呈现 locus 代际的全部生命周期状态（`provisioning` / `active` / `switching` / `stopped` / `invalid` / `retired`），MUST NOT 省略其中任一状态、MUST NOT 把未知或非活跃状态显示为空白或伪装成活跃。状态 SHALL 以文字表达，颜色只能作为补充通道。默认筛选 MUST NOT 让某个状态下的关联静默消失。

#### Scenario: 正在建树的入口可见

- **WHEN** 一个入口的首条合格消息正在建立其 locus 树，记录处于 `provisioning`
- **THEN** 管理面显示该入口为「准备中」，不显示为空白，也不显示为「活跃」；此期间不提供会破坏在建过程的动作

#### Scenario: 非活跃状态不被省略

- **WHEN** 某入口的当前代为已停止、已失效或已退役
- **THEN** 该状态以文字就地显示，并在被默认筛选排除时以可发现的出口呈现，而不是从页面消失

### Requirement: 出站业务回复的 @ 引用渲染为平台真实提醒

入站正文把 mention 预渲染成显示名，出站文本消息却必须使用平台标记才成为提醒；系统 SHALL 在发送业务回复前完成这一翻译，使 Agent 写出的引用成为真实提醒，而不是让对方收不到通知的纯文本。

本要求只适用于 IM 入口（`chatId` 不以 `doc:` 开头）。文档入口中，模型写在正文里的 `@` SHALL 按纯文本发送：MUST NOT 读取任何 chat 成员列表，MUST NOT 改写这些 @ 引用，文档投递提示也 MUST NOT 承诺它们会成为提醒。唯一的例外是 Host 自己加的结构化提及：全文评论的答复与回执以一条新全文评论发出，开头的 `mention_user` 指向提问者或命令发送者：业务答复为持久 Delivery 的发送者，控制回执为该命令的发送者，`/bind` 换绑警告为发出该 `/bind` 的人（见 `pet-locus-doc-comments`），提示可以如实告诉模型提问者会收到通知。

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

系统 SHALL 将 caller-bound finish/wait/track 授权建立在同一份当前执行证明上：实际 caller 必须对应唯一 active locus/generation/child，当前执行必须由唯一 current Delivery 发起或由其已证明的 Host/agent-message 连续轮次恢复，且不得含 GUI/user、来源不明参与者、第二个 Delivery 或旧代际污染。持久层中“存在 current”只是必要条件，MUST NOT 单独授予 capability。

授权拒绝 SHALL 返回机器可判定的稳定原因类别，至少区分：`no-current`、`claim-unbound`、`mixed-source`、`stale-delivery`、`generation-mismatch`、`association-unproven` 与 `capability-unavailable`。对模型的文字可以概括，但诊断 MUST 保留类别以及不含其它入口标识的本地证据；MUST NOT 把所有拒绝折叠成“没有 current”。

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
- **WHEN** Host 恢复时不能唯一证明 child、locus generation 和 current Delivery 的关联
- **THEN** capability 以 `association-unproven` 保持不可用并暂停派发，不猜测最近记录

### Requirement: Locus 业务出站只能经受管 finish

Locus child 的飞书业务正文与撤回动作 SHALL 以 caller-bound `pet_locus_finish` 的 Host 实现为唯一受管出口；普通 assistant 文本仍不得外发。该出口在各工具档位下的保证强度 SHALL 按档位区分，并 SHALL 如实陈述，MUST NOT 把较弱档位的保证表述为较强档位的保证。

**`safe` 档（默认）**：child 的已发布能力集合 MUST NOT 提供可经 Skill、shell、脚本、CLI、通用 HTTP、子委派或其它执行身份直接发送或撤回飞书消息的路径。该边界 SHALL 由工具/执行 authority 隔离强制执行，MUST NOT 仅依赖 prompt、Skill 省略、命令字符串黑名单、PATH/HOME 隐藏或 read-only 文件沙箱。若当前 pinned runtime 无法证明在保留通用进程执行时隔离飞书凭据与 Lark 网络出口，`safe` 档 SHALL 不提供 `bash`、`pwsh`、`skill`、任意代码执行和可代为执行的子委派能力，只保留受控只读工具与 caller-bound Pet 工具。

**`shell` 档（所有者显式授予，见「Locus 工具档位由所有者显式授予且不重建子会话」）**：child 可执行通用 shell，因而**不存在**执行 authority 层面的出站隔离。此时唯一出口 SHALL 由防误操作 guard 维持：Host SHALL 在该 child 作用域拒绝经 shell 调用 `lark-cli` 发送、回复、编辑、撤回飞书消息的命令，并在拒绝原因中指明改用 `pet_locus_finish`、finish 被拒时报告原因而非绕行。该 guard MUST NOT 在规范、管理面、飞书回执或 prompt 中被表述为安全边界；有意绕过（脚本、HTTP、复制的可执行文件）不在其保证范围内。

**任何档位**：child 的已发布能力集合 MUST NOT 含子委派或可让另一执行身份代为行动的工具（包括 `subagent`、`subagent_fork`、`workflow`、`ralph`、`send_message` 及 agent 控制工具）。该排除 SHALL 由持久组合本身保证，MUST NOT 依赖可在运行中撤除的收紧层。

Locus child SHALL 以 locus 主会话为父、经官方 `startActivation` 创建。父会话 SHALL 是 Pet 自建、挂中性白名单 preset（`locus-base`，不含任何委派行）的 locus 主会话，其 preset MUST NOT 被更改；子会话 SHALL 以独立选择的 `locus-child` preset 启动（`locus-base` 去掉写文件工具），该选择随子会话持久化并在每次冷恢复时重新挂载，不从父会话继承。Host SHALL 在 `agent/created` 以及每次投递前核验 locus 主会话的 preset 为 `locus-base`、子会话的 preset 为 `locus-child`，不符即拒绝创建、恢复或派发。runtime 不再携带每次请求的 `toolFilter`；Host SHALL 在每次发布（含冷恢复）时，于子会话自有作用域以 `tools.restrict` 安装不含委派的工具上限与按档位的收紧层。新建子会话 SHALL 在对应 Locus 行发布 Host 证明的 composition marker `tier3`；持久层只承载 `tier3` marker（从未创建 child 的行没有 marker），见"持久层只承载三层模型的 locus 行"；MUST NOT adopt 或冷恢复任何没有 `tier3` marker 的 child。Host 无法证明所需组合（含收紧层）已安装时 SHALL 拒绝创建、恢复或派发；MUST NOT 以宽底座发布一个未安装收紧层的 `safe` 档 child。Host SHALL 对 `tools.restrict` 与 `tools.guard` 做运行时特性探测，缺失即拒绝发布。防误操作 guard 另拒绝文档入口的评论与文档正文写命令（见 `pet-locus-doc-comments`）。

#### Scenario: 受管 finish 正常发送
- **WHEN** 任一档位的 child 对其已证明的 current Delivery 调用 `pet_locus_finish(reply)`
- **THEN** Host 按 durable CAS 和固定触发消息发送一次正文并记录结果

#### Scenario: shell 旁路不可达
- **WHEN** `safe` 档 child 尝试以 `lark-cli`、绝对路径脚本、`msg.py`、Python/Node/curl 或复制后的可执行文件直接调用飞书接口
- **THEN** 已发布执行 authority 不能产生飞书业务消息，且 Delivery 状态不因尝试而改变

#### Scenario: shell 档误用 lark-cli 发送被拦截
- **WHEN** `shell` 档 child 在 finish 被拒后执行 `lark-cli im +messages-send …` 或等价的回复/撤回/编辑命令
- **THEN** 该工具调用在执行前被拒绝，拒绝原因指明使用 `pet_locus_finish` 并报告 finish 的拒绝原因；Delivery 状态不因尝试而改变

#### Scenario: shell 档读取当前群不被拦截
- **WHEN** `shell` 档 child 以 `lark-cli` 读取当前入口群的历史消息
- **THEN** guard 不拒绝该调用

#### Scenario: shell 档的出站保证如实表述
- **WHEN** 所有者在管理面或飞书回执中查看 `shell` 档说明
- **THEN** 说明写明防误操作 guard 仅防误操作、不是安全边界，MUST NOT 声称业务正文只能经 finish 产生

#### Scenario: 子委派不能洗白权限
- **WHEN** 任一档位的 child 尝试通过 subagent、workflow、Ralph 或 agent message 让另一执行身份代发
- **THEN** 已发布能力集合不含这些工具；业务正文不能由另一执行身份产生

#### Scenario: 收紧层未安装时不发布
- **WHEN** `tier3` child 被发布（新建或冷恢复），而 Host 无法同步安装或回读核验其档位对应的收紧层
- **THEN** 拒绝发布并给出确定性诊断，MUST NOT 以宽底座发布该 child

#### Scenario: 隔离能力无法证明时不发布
- **WHEN** runtime 不能核验 locus 主会话 preset 为 `locus-base`，或不能提供按档位收紧的作用域限制
- **THEN** Locus intake/child 能力保持 unavailable 并给出确定性诊断，MUST NOT 以字符串过滤或 prompt 警告宣称安全

#### Scenario: safe-v1 行继续服务
- **GIVEN** 持久层中一条 locus 行的 `childComposition` 为 `safe-v1` 或 `safe-v2`
- **WHEN** Pet 打开持久层
- **THEN** 打开失败，Pet 保持未就绪，诊断包含该行的 key；没有任何入口被路由或投递

#### Scenario: 主会话 preset 不影响子会话工具面
- **WHEN** 用户的干活主会话运行一个把委派工具注册进 agent 自有层的 preset（如 `standard`）
- **THEN** 子会话的父是 locus 主会话而非干活主会话，其已发布工具面只由 `locus-child` preset、Host 安装的作用域上限与档位收紧层决定，不含委派工具

#### Scenario: 冷恢复不回落到父组合
- **WHEN** Host 重启后首次向一个 `tier3` child 投递
- **THEN** 冷恢复重新挂载子会话持久化的 `locus-child` preset，Host 在发布前安装作用域上限与收紧层并核验；子会话 preset 不是 `locus-child` 或 locus 主会话 preset 不是 `locus-base` 时拒绝派发

#### Scenario: 升级前的 legacy child 不可恢复服务
- **GIVEN** 持久层中一条 `active` locus 行没有 `childComposition`
- **WHEN** Pet 打开持久层
- **THEN** 打开失败，Pet 保持未就绪并给出确定性诊断；该行的 child 不被 adopt 或冷恢复

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

Host MUST 独立证明被拒调用的精确活跃轮关联该 Delivery，MUST NOT 只凭 child 有 current 推断。收尾 MUST NOT 发送或重试业务正文、放宽授权；SHALL 复用失败控制反馈且反馈失败不阻断收尾。终结 SHALL 与 finish/超时原子竞争且至多一次，MUST NOT 消费后续 Delivery 或新代际。

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

### Requirement: Locus 工具档位由所有者显式授予且不重建子会话

每个 locus SHALL 具有一个工具档位，取值 `safe` 或 `shell`，与文件权限档（`read`/`write`）正交。所有新建、替换与重建的 locus SHALL 默认 `safe`；新代际与显式重建 MUST NOT 继承上一代的 `shell`。

`safe` 档 SHALL 不含 `bash`/`skill`，其继承工具面等于 `LOCUS_SAFE_TOOL_NAMES`，另加 caller-bound Pet 工具。`shell` 档 SHALL 在 `safe` 档之上开放通用 shell 与 Skill 加载；MUST NOT 开放任何子委派或代为行动的工具（见「Locus 业务出站只能经受管 finish」）。

档位 SHALL 仅由 allowlist 经飞书控制命令（`-t/--tools safe|shell`）或管理面改变；非 allowlist 发送者的档位命令 SHALL 按既有控制命令规则拒绝。档位命令 SHALL 只在接受命令时该入口空闲（无 current Delivery 且子会话未在运行）时受理，忙时 SHALL 确定性拒绝。变更 SHALL 在同一子会话上完成，MUST NOT 重建子会话、增加代际或丢弃子会话历史。子会话常驻时 SHALL 当场应用并回读实际可见工具面：与目标档位不符时 SHALL 回到 `safe` 并拒绝，MUST NOT 回执成功。子会话不常驻时 SHALL 适用"非驻留子会话的权限变更以待应用协议提交"：延迟提交在下一次冷恢复的首个业务工具执行前完成，不因用于唤醒的 Delivery 已成为 current 而拒绝；核验失败恢复原生效值；原值也无法核验时按"Locus 业务出站只能经受管 finish"的总则拒绝发布。变更 SHALL 记录操作者、时间、期望值与生效值。

只有带 `tier3` marker 的 locus 可以服务与切换档位。持久层只接受 `tier3` 标记（从未创建 child 的行没有标记）；其它标记的行由"旧模型 locus 数据经离线迁移清除"处理，不会出现在可加载的持久层中。

`shell` 档生效期间，该入口 SHALL 只接受 allowlist 成员的 at 作为工作请求；非 allowlist 成员的 at SHALL 得到确定性拒绝回执，说明该入口当前为所有者专用。已在 backlog 中、由非 allowlist 成员触发的 Delivery SHALL 在派发前以同一原因结算，MUST NOT 投递给 `shell` 档子会话。切回 `safe` 后 SHALL 恢复既有的群成员提问规则。

子会话每次投递的 prompt SHALL 按当前档位说明可用能力。`shell` 档 SHALL 说明：该档允许以 bot 身份读取当前入口（档位权限），实际可读性以本次实测声明为准；MUST NOT 读取无关群、私聊、全局消息或其它 workspace；业务回复仍经 `pet_locus_finish`。该说明是行为约束而非授权边界。

管理面与飞书回执 SHALL 如实说明 `shell` 档的后果：子会话可在所有者本机执行命令（写入受文件权限档约束，读取与网络不受限），可使用所有者本机的飞书凭据，入口的 allowlist 成员共享该能力，且出站约束仅为防误操作。

#### Scenario: 授予 shell 档
- **WHEN** allowlist 在一个子会话常驻且空闲的 `tier3` locus 发送 `-t shell`
- **THEN** 同一子会话的可见工具面增加 shell 档工具且不含任何委派工具，核验通过后回执并记录授权；子会话 id、代际与历史不变

#### Scenario: 撤回 shell 档
- **WHEN** allowlist 在子会话常驻且空闲的 `shell` 档 locus 发送 `-t safe`
- **THEN** 同一子会话的可见工具面恢复为 safe composition，核验通过后回执并记录

#### Scenario: 忙时拒绝
- **WHEN** 入口存在 current Delivery 或子会话正在运行时收到档位命令
- **THEN** 确定性拒绝并说明需等待空闲，不改变档位

#### Scenario: 核验失败回到 safe
- **WHEN** 子会话常驻时，档位应用后回读的工具面与目标不符
- **THEN** 回到 `safe` 并拒绝，回执给出确定性原因，不回执成功

#### Scenario: safe-v1 入口请求 shell
- **GIVEN** 某群曾是 `safe-v1` 旧模型入口，其 locus 行已被离线迁移清除，此后没有新的授权 at
- **WHEN** allowlist 在该群发送 `-t shell`
- **THEN** 该入口没有 locus，命令按"当前入口不存在或已失效"拒绝；不建立任何结构，不切换档位

#### Scenario: shell 档拒绝普通成员
- **WHEN** `shell` 档入口收到非 allowlist 群成员的 at
- **THEN** 不创建 Delivery 工作，回执说明该入口当前为所有者专用

#### Scenario: 切换前排队的普通成员请求
- **WHEN** 入口在 backlog 中有非 allowlist 成员的 Delivery 时切到 `shell`
- **THEN** 这些 Delivery 在派发前以「入口当前为所有者专用」结算，不投递给子会话

#### Scenario: 冷恢复保持档位
- **WHEN** `shell` 档 `tier3` 子会话被释放后冷恢复
- **THEN** 发布时按持久档位安装收紧层，恢复后的可见工具面与恢复前一致

#### Scenario: 重建不继承 shell
- **WHEN** 一个 `shell` 档入口被显式重建或切换来源产生新代际
- **THEN** 新代际为 `safe` 档

#### Scenario: 非 allowlist 档位命令
- **WHEN** 非 allowlist 群成员发送 `-t shell`
- **THEN** 按控制命令规则拒绝，档位不变

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
SHALL 校验其由同一 child 代际、同一入口、同一方向与窗口签发；伪造、篡改、跨 child/跨代际、
跨入口或因 Host 进程重启换密钥而失效的游标（不另设时间 TTL）SHALL fail closed 并给出确定性原因。每次等待外部读取返回后 SHALL 重新核验
调用方仍是同一 child 代际且入口未变，变更时 SHALL 丢弃该次结果。

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
- **WHEN** `safe` 档 child 在一次 Delivery 中调用该工具读取当前入口群
- **THEN** 返回该群的有界消息分页（含时间、发送者与正文），并标注内容为不可信输入

#### Scenario: 话题入口读取自己绑定的话题
- **WHEN** 该 locus 的入口是话题，child 调用该工具
- **THEN** 读取范围为该绑定话题及其回复，夹具同时包含无关话题与群本体消息且不出现在结果中

#### Scenario: 指定其它目标或未知参数时拒绝且不读取
- **WHEN** 调用方传入另一个群、另一个话题、私聊或全局范围，或传入未知参数
- **THEN** 该调用被拒绝且不发生任何读取，不返回任何消息

#### Scenario: 游标被篡改或跨域使用
- **WHEN** 续读游标被修改、由其它 child/代际/入口签发，或已过期
- **THEN** 调用 fail closed 并返回确定性原因，不返回任何消息

#### Scenario: 等待期间入口或代际变化
- **WHEN** 一次读取在等待外部返回期间该 child 的代际或入口发生变化
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

每个 child 的**完整前言**（入口标识、locus 与代际、主/子会话与 workspace、文件权限、工具档位及
其能力、上下文锚点状态、按需读取说明、"不自动把结论回传主会话"的约束）SHALL 在系统能证明该
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
`pet_context` 复核持久事实，但 MUST 声明本次投递时生效的工具档位能力（`safe`/`shell`），
MUST NOT 让 child 只能靠猜测或主动查询才知道自己具备什么读取能力。档位事实 SHALL 取自持久 locus 记录；
记录缺省档位时视为 `safe`，渲染层 MUST NOT 忽略记录中的 `shell`。

#### Scenario: 首次投递收到完整前言
- **WHEN** 一个新建 child 收到第一条真正进入其 inbox 的 Delivery
- **THEN** 渲染出的是携带档位能力与锚点状态的完整前言，而不是"沿用首次投递"的续投变体

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
- **THEN** prompt 不重复完整前言，但仍声明当前持久档位对应的能力并携带本轮回复目标

#### Scenario: 重启后按送达证据决定
- **WHEN** Host 重启或 child 被冷恢复后收到新 Delivery
- **THEN** 存在送达证据时不重发完整前言；无送达证据时按未收到处理并携带完整前言

#### Scenario: 受既有缺陷影响的 child
- **WHEN** 一个既有 child 的投递有送达证据，但它从未收到过完整前言
- **THEN** 系统不自动重发完整前言，但每次投递仍声明当前档位能力；需要完整前言时由所有者显式重建该 child

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

系统 SHALL 以三层表达一段协作：用户的**干活主会话**（普通一级会话，承担工作归属）←dsh-collab→ Pet 创建的一级 **locus 主会话**（与干活主会话 1:1）→ 每个入口一个 **locus 子会话**（父为 locus 主会话）。`loci` 行的父会话字段 SHALL 指 locus 主会话；干活主会话与 locus 主会话的关系 SHALL 记录在 `locus_mains`（`{workSessionId, locusMainSessionId, generation, status, spaceId}`），同一干活主会话任一时刻至多一个 active 的 locus 主会话。入口寻址（`chatId`/`threadId`、文档入口前缀规则）与本变更前相同。干活主会话 SHALL 留在来源 workspace；locus 主会话及其官方子会话 SHALL 建在专用 `DSH Pet` workspace。`locus_mains.workspaceId` 记录 locus 主会话的工作区；`loci.workspaceId` 继续记录绑定的干活项目工作区，供项目读取授权与入口管理使用，不得以 Pet 运行目录替代项目根。已有位于来源工作区的 locus 主会话 SHALL 在入口空闲且下一条授权消息到来时走既有主会话替换流程，不改写旧会话 header、不搬移或删除历史。locus 主会话 SHALL 由 Host 设审批 `never`、沙箱 `read-only`，并以 deny 式 `tools.restrict` 挡掉 `bash`、`write`、`edit` 与委派类工具，保留 Host 层的 `collab_*` 工具；Pet 只对自己创建的 locus 主会话向 dsh-collab 声明 `owns`。

#### Scenario: 同一干活主会话服务多个入口
- **WHEN** 同一干活主会话分别关联开发群与一个话题
- **THEN** 两个入口的子会话都以同一个 locus 主会话为父，`locus_mains` 中该干活主会话只有一条 active 记录

#### Scenario: locus 主会话归 DSH Pet，入口仍关联干活项目
- **WHEN** 为 nexus 等来源工作区的干活主会话建立或替换 locus 主会话
- **THEN** 干活主会话留在来源工作区，locus 主会话运行且归属 DSH Pet，标题为 `[locus] <干活主会话名>`（无标题时用干活会话短码），入口持久工作区仍为来源项目；旧工作区中的 locus 主会话经既有空闲迁移协议替换，历史保留

#### Scenario: locus 主会话工具面锁死
- **WHEN** 读取 locus 主会话的已发布工具面与会话设置
- **THEN** 不含 `bash`、`write`、`edit` 与任何全局委派工具，含 `collab_*`；审批为 `never`，沙箱为 `read-only`

#### Scenario: 插件挂入自有作用域的委派工具在执行时被拒
- **GIVEN** 官方 Agent Team 把 `spawn_teammate`、`team_task_*` 等工具注册进每个普通根会话的自有作用域（`tools.restrict` 无法隐藏自有作用域注册）
- **WHEN** locus 主会话调用其中任一工具
- **THEN** Host 在该 agent 作用域上的执行守卫拒绝，工具体不执行；可见但未受该守卫覆盖的禁用工具仍视为泄漏并拒绝发布

#### Scenario: 干活主会话不得是子会话
- **WHEN** 所有者以一个 subagent 会话为目标执行 `/bind`
- **THEN** 绑定被拒绝，不建立 locus 主会话

### Requirement: 入口建立统一为一条路径

auto、Q&A 与显式绑定 SHALL 走同一建立路径，只在"干活主会话从哪来"上不同：auto（未绑定入口首个授权 at）由 Pet 在 default workspace 新建干活主会话；Q&A 以所有者打开的会话为干活主会话；`/bind` 以所有者指定的普通一级会话为干活主会话。之后 SHALL 一致地：复用该干活主会话的 active locus 主会话，没有则新建 locus 主会话并按\"协作空间由干活主会话与 locus 主会话两个普通成员组成\"建立空间；为入口发布一个子会话状态为 `not-created` 的新代际。建立 MUST NOT 预先创建子会话。显式绑定改变入口来源时 SHALL 如实告知上下文改变。

#### Scenario: auto 建立
- **WHEN** 一个从未关联的群收到所有者的首个 at
- **THEN** Pet 新建干活主会话与 locus 主会话，建立协作空间，入口新代际为 `not-created`，随后按首条消息创建子会话并处理该消息

#### Scenario: 绑定到已有干活主会话复用 locus 主会话
- **GIVEN** 干活主会话 W 已有 active locus 主会话 M
- **WHEN** 所有者把另一个群 `/bind` 到 W
- **THEN** 不新建 locus 主会话，新入口的父为 M

#### Scenario: 建立失败不留半成品
- **WHEN** 新建 locus 主会话成功但建立协作空间失败
- **THEN** 本次建立失败并回执；provisioning 操作按\"provisioning 失败超时后不再阻塞\"处理，补偿器归档未投入使用的 locus 主会话

### Requirement: 子会话在首条消息到达时创建

入口代际处于 `not-created` 时，第一条可投递的 Delivery SHALL 以官方 `startContinuable`（provider `spawn`，`parent` 为 locus 主会话，`prompt` 为该 Delivery 的投递 prompt，`toolFilter` 为不含委派的宽底座）创建子会话，并在 `agent/created` 中安装档位收紧层、设置沙箱并回读；任一步失败 SHALL 令创建失败并回滚。发布 SHALL 在 `agent/created` 回调内完成，而不是等 `startContinuable` 返回（实测其在首轮认领之后才返回）：创建前持久预留子会话身份；回调内依次认领预留、安装组合并回读、发布同一 `childId` 的 marker `tier3`、current、执行身份以及仅可消费一次的首条 prompt 预留关联，最后完成预留交接；这些步骤 MUST 早于首轮认领。官方首条 inbox UUID 仅在认领时或 API 返回时可知，Host SHALL 在首条业务认领时同步将 UUID 关联到该预留，并在首个 caller-bound 工具体执行前等待该 UUID 的持久绑定完成；MUST NOT 以消息正文猜测关联或再次投递首条消息。回调内发布之后若创建流程仍被拒绝，Host SHALL 回滚已写入的持久状态（不得留下可服务的 active/current），该 Delivery 按非名额失败结算、代际回到 `not-created`；MUST NOT 以撤销已提交的预留代替补偿。创建失败 SHALL 分两类：运行体名额不足属于可重试失败，该 Delivery SHALL 保持待处理（不结算、不换代、不补偿），名额释放或下一次派发时以同一 Delivery 重试创建，且不超过其 deadline；其它失败（组合核验、provider、首轮回读等）该 Delivery SHALL 以确定性原因结算并回执，代际保持 `not-created`，下一条消息重试创建。后续 Delivery SHALL 经官方 Host prompt 队列能力（`queueHostPrompt` / Host access 的 `queuePrompt`，`delivery:queue`、`source:user`）投递为独立轮次；MUST NOT 用会产生 `steer` / `agent-message` 的 `sendMessage` 代替用户 Delivery。系统 MUST NOT 使用空闲创建或借出子会话 Session 的兼容能力。

首条图片消息的文本降级 SHALL 保持现有语义：仅在官方返回结构化 `MODEL_DOES_NOT_SUPPORT_IMAGES`、原 prompt 含 typed image、且 Host 可证明首条用户 prompt 未被接受或认领时，允许先补偿尚未执行的 child，再以纯文本重试同一 Delivery 一次。该已证明的投递前图片拒绝不按普通创建失败结算：原 Delivery 的身份、deadline 与 FIFO 顺序不变，已持久化的失败 child 身份 MUST NOT 再使用；新的预留 child 身份与未注入 backlog 的关联 SHALL 原子更新。无法证明未执行时 MUST NOT 重放。容量拒绝仍保留原预留身份。

#### Scenario: 首条图片不支持时安全降为文本
- **GIVEN** 首次惰性创建已持久化 child，但官方在接受用户 prompt 前返回结构化图片不支持，Host 无用户 claim 或 inbox 绑定
- **WHEN** Host 进行一次文本降级
- **THEN** 同一原 Delivery 在同代际以新预留 child 身份携带文本 prompt 恰执行一次，保留原 deadline 与 backlog 顺序；有已接受或已认领证据时不降级重放

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
- **WHEN** `not-created` 代际收到第一条 at
- **THEN** 恰调用一次 `startContinuable`，其 `prompt` 为该 Delivery 的投递 prompt；代际转为 active 并带 `tier3`

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
- **WHEN** 回调内已发布 marker 与 current，随后创建流程拒绝
- **THEN** 不留下 active 代际或 current；该 Delivery 以确定性原因结算，代际为 `not-created`；下一条 at 可再次创建

#### Scenario: 创建失败不推进代际
- **WHEN** `startContinuable` 因 `agent/created` 回读不符而失败
- **THEN** 该 Delivery 结算为失败并回执原因；代际仍为 `not-created`；下一条 at 再次尝试创建

#### Scenario: 名额不足时保留原请求
- **WHEN** `not-created` 代际的第一条 Delivery 创建时运行体名额已满，随后名额释放
- **THEN** 该 Delivery 在名额满时保持待处理且未回执失败；释放后以同一 Delivery 恰创建一次子会话并投递，用户无需重发

#### Scenario: provider 不能证明独立上下文
- **WHEN** `spawn` provider 不可用或声明继承父上下文
- **THEN** 不调用 `startContinuable`，Delivery 以能力不可用结算

### Requirement: 换绑与归档按层处理

- 干活主会话被归档时，其全部入口 SHALL 停止服务；授权 at SHALL 得到有限次回执，说明来源会话已归档并提示所有者 `/bind` 到新的干活主会话；MUST NOT 自动复活或自动换来源。
- 入口子会话永久不可用（被删除、组合或身份核验失败、非名额原因的冷恢复失败）时 SHALL 在同一 locus 主会话下发布新代际（`not-created`），不影响同一 locus 主会话下的其它入口。
- 冷恢复因运行体名额不足失败时 SHALL 保留原子会话、原代际与原 Delivery，按"子代激活受运行体名额约束时 fail closed"在名额释放后重试，且不超过该 Delivery 的 deadline；MUST NOT 换代。
- locus 主会话不可用（被归档、删除或 preset 核验失败）时 SHALL 为该干活主会话新建 locus 主会话，迁移其名下全部未被所有者停止/退役的入口（每个入口发布 `not-created` 新代际），并建立新协作空间；旧 locus 主会话及其子会话一律不再恢复。迁移结果 SHALL 回执已迁移数与逐条跳过原因。
- 所有者停止/退役的入口 MUST NOT 被上述任一路径复活。

#### Scenario: 干活主会话归档
- **WHEN** 干活主会话 W 被归档后，W 名下某群收到所有者 at
- **THEN** 不投递给子会话，群内收到"来源会话已归档，请 /bind"回执；同一入口的后续 at 在达到次数上限后不再回执

#### Scenario: 子会话不可用只换该入口一代
- **GIVEN** locus 主会话 M 下有入口 A、B
- **WHEN** A 的子会话因组合核验失败（非名额原因）无法冷恢复
- **THEN** A 发布新代际（`not-created`），B 的代际与子会话不变

#### Scenario: 名额不足的冷恢复保留原代际
- **GIVEN** 入口 A 的子会话 C 已被释放，代际为 g
- **WHEN** 下一条 Delivery D 到达时名额已满导致恢复失败，随后名额释放
- **THEN** 名额满时 D 保持待处理、A 仍为代际 g；释放后恢复的是同一子会话 C 并投递 D，没有新代际

#### Scenario: locus 主会话不可用时整体迁移
- **GIVEN** M 下有 active 入口 A 与所有者已停止的入口 C
- **WHEN** M 被归档
- **THEN** 新建 M2，A 迁到 M2 并为 `not-created`；C 不迁移并在回执中说明原因；`locus_mains` 中 M 为非 active、M2 为 active

### Requirement: provisioning 失败超时后不再阻塞

处于 `failed` 的 provisioning 操作超过 10 分钟后 SHALL 不再阻塞同一 endpoint；下一次针对该 endpoint 的建立请求 SHALL 先在运行期调用与启动对账相同的补偿器清理其 `resourceRefs`，补偿成功后再按无存量入口建立。补偿失败时 SHALL 继续阻塞并记录诊断。该规则 SHALL 对全部 provisioning kind 一致适用。

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

### Requirement: 子会话读共识与 locus 主会话工具

子会话 SHALL 获得 caller-bound 只读工具 `locus_context`：Host 经 dsh-collab `actAs(locus 主会话).read` 读取协作空间，只返回 status 为 agreed 的 charter 与本入口登记的待办进度；没有 `ext.pet.entry` 的条目为工作空间级、对全部入口可见，带 `ext.pet.entry` 的条目只对该入口可见（话题入口另可见其所在群的条目）。MUST NOT 返回消息、其它入口的条目或成员 statusText。

子会话 SHALL 获得 caller-bound 工具 `locus_ask_parent({question})`：Host 从实际执行 caller 解析其入口与现行代，只在 caller 是该入口现行代子会话时，经官方会话投递接口把问题（附入口名与 `entry` 身份）作为下一回合输入投给其父 locus 主会话；工具 MUST NOT 接受任何目标参数，MUST NOT 新建或改变 Delivery，返回仅表示已投递。投递失败 SHALL 返回确定性原因。通用 `send_message` 与 agent 控制工具仍不可用。

locus 主会话 SHALL 获得 `locus_note`（以 `actAs` 创建带本入口 `ext.pet.entry` 的条目；入口须是该 locus 主会话名下的入口）与 `locus_reply_child`（Host 以官方 `subagents.sendMessage` 发给该 locus 主会话名下某入口的现行代子会话；不是现行代或不属于它时拒绝）。locus 主会话用普通 `collab_*` 工具写的条目一律为工作空间级。

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
- **WHEN** 已被换代的旧子会话调用 `locus_ask_parent`
- **THEN** 返回拒绝，locus 主会话未收到任何投递

#### Scenario: 回复非现行代子会话被拒
- **WHEN** locus 主会话以 `locus_reply_child` 回复一个已被换代的入口旧子会话
- **THEN** 返回拒绝，未调用 `subagents.sendMessage`

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

### Requirement: 非驻留子会话的权限变更以待应用协议提交

所有者变更工具档位或文件权限时，若子会话常驻且空闲，Host SHALL 经 live agent 当场应用并回读，按既有规则回执。若子会话不常驻，Host SHALL：

1. 持久记录该变更为**待应用**（期望值），生效值保持不变；回执 SHALL 说明"已记录，将在子会话下次唤醒时应用并核验，生效前按原设置服务"，MUST NOT 回执为已生效。
2. 在下一次该子会话的 `agent/created`（冷恢复）中先应用期望值并回读：一致则生效值更新为期望值、清除待应用标记，并在该次投递前向所有者回执已生效；不一致则 SHALL 按原生效值完成组合并回读核验、清除待应用标记且不保留期望值，并向所有者回执失败原因；原生效值也无法核验时 SHALL 拒绝发布该子会话（"Locus 业务出站只能经受管 finish"的总则）。
3. 待应用期间 MUST NOT 以期望值服务，管理面与投递 prompt SHALL 只陈述生效值，并标注存在待应用变更。

后到的变更 SHALL 覆盖未应用的期望值。

#### Scenario: 非驻留时授予 shell 并在唤醒时生效
- **GIVEN** `tier3` 子会话 C 已被释放，档位 `safe`
- **WHEN** 所有者发送 `-t shell`，随后一条 Delivery 唤醒 C 且回读与 shell 一致
- **THEN** 第一次回执说明待应用；唤醒前管理面显示生效值 `safe`；唤醒时 C 以 shell 档服务，所有者收到已生效回执

#### Scenario: 唤醒时核验失败不留授权
- **GIVEN** 同上，但唤醒时回读与 shell 不一致
- **THEN** C 以 `safe` 档服务该 Delivery；待应用标记与期望值被清除；所有者收到失败回执；之后再次唤醒仍为 `safe`

#### Scenario: 非驻留撤回 shell 核验失败恢复原值
- **GIVEN** `tier3` 子会话 C 档位为 `shell` 且已被释放
- **WHEN** 所有者发送 `-t safe`，下一条 Delivery D 唤醒 C 时 safe 工具面回读不符，而原 shell 工具面回读一致
- **THEN** C 以 `shell` 档服务 D；期望值被清除；所有者收到撤回失败回执；C 的会话 id 与代际不变

#### Scenario: 原值也无法核验时不发布
- **GIVEN** 同上，但原 shell 工具面回读也不符
- **THEN** 拒绝发布 C 并给出确定性诊断，D 不被投递给未经核验的组合

#### Scenario: 常驻空闲时当场生效
- **WHEN** C 常驻且空闲时所有者发送 `-t shell`
- **THEN** 当场应用并回读，回执已生效，不产生待应用记录

### Requirement: 旧模型 locus 数据经离线迁移清除

持久层版本 SHALL 升为 19。离线迁移脚本 SHALL 在 DSH 停止时运行，把版本 2..18 的数据库迁移到 19。旧模型 locus 行指：父会话（`parentSessionId`）在 `locus_mains` 中没有记录的 locus 行；记这些行的 id 集合为 L。

- `--dry-run` SHALL 只读：报告当前版本、目标版本，列出 L 中每一行的 id 与入口，并按表报告将被删除的行数，MUST NOT 写入任何文件。
- 以下任一条件成立时，脚本 SHALL 拒绝迁移（`--dry-run` 也报告为拒绝），以非零码退出并列出违规行。拒绝的写入保证分两种：预检阶段（含 `--dry-run` 与未确认运行）的拒绝不产生任何物理写入；`--yes` 锁内复查的拒绝保证不做 checkpoint、不写备份、不改变任何行与版本号，但取得独占锁、打开连接等 SQLite 自身的物理副作用不在此保证之内：
  - 全库存在状态不在终态集合内的投递；终态集合 SHALL 与 Host 的 `TERMINAL_STATUSES` 相同；
  - 全库存在 phase 不是 `committed` 或 `compensated` 的 locus 操作；
  - 删除 L 之后保留的 locus 集合不满足 v19 加载条件：每条行的父会话在 `locus_mains` 中有记录；`childComposition` 若存在为 `tier3`；`active` 行带 marker；并且整个集合通过 Host 现有的全部集合不变量（包括带 `parentLocusId` 的行其父行被保留、同一入口剩余代际相邻连续、入口与子会话唯一）。脚本 SHALL 与 Host 使用同一份集合校验规则，MUST NOT 另写一份子集。
- 拒绝时 SHALL 说明处理方式：在途工作等其结束；无法自行结束的恢复债（`needs-recovery` 或 `failed` 的操作、停在非终态的投递）须先用当前版本 Host 清理或由所有者人工处理，再运行迁移。
- `--dry-run`、未确认运行与预检拒绝 SHALL 只做只读查询，MUST NOT 做 WAL checkpoint 或产生任何物理写入。`--yes` SHALL 先取得独占锁并持有到事务提交；在锁内重新读取版本戳、表结构与数据并重新执行全部拒绝判定（锁内发现已是 19 时报告无需迁移，发现不支持的版本时拒绝）；锁内拒绝时 SHALL 不做 checkpoint、不写备份、不改变任何行或版本号。锁内判定通过后 SHALL 依次：做 WAL checkpoint；写数据库备份（它是 checkpoint 之后的完整快照）；再在单个事务内完成：版本 ≤17 时补建 `locus_mains` 表；删除 L 中的 locus 行；删除 `locusId ∈ L` 的投递、切换通知与权限审计（按记录中的 `locusId` 字段精确匹配）；删除 `locusId`、`oldLocusId` 或 `newLocusId` ∈ L 的操作；把版本号改为 19。事务失败 SHALL 回滚，版本号与全部行不变，备份保留。
- 脚本 SHALL 按相对自身文件位置的路径导入包内 `lib/` 中 Host 的校验代码，经 `node_modules/.bin` 符号链接、在仓库以外的工作目录调用时同样可用；这些代码的运行时依赖 SHALL 声明为包的运行时依赖。
- 脚本 MUST NOT 修改 `locus_indexes`。Host SHALL 在打开 locus 持久层后、注册任何会读取索引的回调（agent 创建、工具、飞书接收）之前，按剩余 locus 行重新推导并写回索引；指向已删除行的默认 Q&A 指针在推导时被丢弃。启动对账沿用同一推导。
- 脚本 MUST NOT 修改 locus 以外的表：待办台账、询问、`chat_bindings`、`invocation_channel` 等保持逐字节不变。
- 未给出 `--dry-run` 或 `--yes` 时 SHALL 不写入任何东西并说明需要确认；数据库被占用（DSH 未停止）时 SHALL 给出可操作的提示并失败；已是 19 时 SHALL 报告无需迁移并退出 0。

#### Scenario: dry-run 列出将删除的行且不写入
- **GIVEN** 一个 v18 数据库，含 3 条旧模型 locus 行、引用它们的 4 条终态投递，以及 2 条三层 locus 行
- **WHEN** 以 `--dry-run` 运行脚本
- **THEN** 输出包含这 3 条旧模型行的 id，以及 locus 3、投递 4 的计数；数据库文件与 WAL 文件字节不变，没有生成备份文件

#### Scenario: 确认后清除旧模型数据
- **GIVEN** 同上的 v18 数据库，DSH 已停止
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 版本为 19；3 条旧模型 locus 行及引用它们的投递、审计、操作都不存在；2 条三层 locus 行逐字节不变；`locus_indexes` 逐字节不变；备份文件存在，且用它打开得到的全部行与迁移前相同

#### Scenario: 迁移后的库能打开并完成启动对账
- **GIVEN** 一个旧模型行与三层行共享入口、且存在指向旧模型行的默认 Q&A 指针的 v18 数据库，已以 `--yes` 迁移
- **WHEN** 用 Pet 持久层打开该库并运行启动对账
- **THEN** 打开与对账都成功；对账后的 `endpoint-current`、`parent-loci`、`child-locus`、`default-qa` 索引与按剩余行推导的结果相同，不含任何已删除行的 id

#### Scenario: 删除历史前代后保留行仍可服务与重建
- **GIVEN** 入口 E 的第 1 代是旧模型行、第 2 代是 `invalid` 的三层行，第 3 代是 `not-created` 的三层行；已以 `--yes` 迁移
- **WHEN** 打开持久层，对 E 发布第 4 代
- **THEN** 打开成功；第 2、3 代保留且 `replacesLocusId` 原样保留（可能指向已删除行）；第 4 代发布成功

#### Scenario: 删除中间代际造成断档时拒绝
- **GIVEN** 入口 E 的第 1 代是 `invalid` 的三层行、第 2 代是旧模型行、第 3 代是 `not-created` 的三层行
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 脚本以非零码退出并指出入口 E 的代际断档；数据库不变

#### Scenario: 未创建 child 的历史行可以没有 marker
- **GIVEN** 有配对的三层行中，一条在首条消息前被所有者停止（`stopped`，无 marker），一条在未创建 child 时因 locus 主会话迁移变为 `invalid`（无 marker）
- **WHEN** 以 `--yes` 运行脚本后用 Pet 打开
- **THEN** 迁移成功，两条行逐字节保留，Pet 打开成功

#### Scenario: 启动早期的冷恢复不读到悬空索引
- **GIVEN** 一个已迁移的库，某入口迁移前的 `endpoint-current` 索引指向一条已删除的旧模型行，另有一个保留的三层子会话带待应用权限
- **WHEN** Host 启动，在启动对账完成之前该子会话被冷恢复
- **THEN** 待应用权限按剩余 locus 行解析；不出现指向已删除行的结果，也不留下部分应用的状态

#### Scenario: 非 locus 表不受影响且仍可读取
- **GIVEN** 待办台账、询问、`chat_bindings` 中有引用旧模型 locus 的行
- **WHEN** 以 `--yes` 运行脚本后打开 Pet，并读取所有者待办列表与已退休询问列表
- **THEN** 这些表的全部行逐字节不变；两个列表的读取都成功，返回的条目与迁移前相同

#### Scenario: 切换通知按 locusId 精确删除
- **GIVEN** L 中有 id 为 `locus-a` 的行，另有保留的三层行 `locus-a2`，二者各有一条切换通知
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 只有 `locus-a` 的通知被删除，`locus-a2` 的通知逐字节不变

#### Scenario: 预检通过后出现非终态投递时锁内拒绝
- **GIVEN** 预检通过后、取得独占锁之前，另一个写入者向库中写入一条 `queued` 投递（含 WAL 中尚未 checkpoint 的写入）
- **WHEN** `--yes` 取得锁并在锁内复查
- **THEN** 脚本以非零码退出并指出该投递；没有做 checkpoint、没有备份文件，全部行与版本号不变

#### Scenario: 预检后版本已变化
- **GIVEN** 预检时版本为 18，取得锁之前该库已被迁移到 19
- **WHEN** `--yes` 在锁内复读版本戳
- **THEN** 报告已是目标版本并以 0 退出，不写入任何东西

#### Scenario: 已安装的命令在仓库外可用
- **GIVEN** 按生产方式安装的 dsh-pet 包（依赖不提升到上层目录），当前目录不在仓库内
- **WHEN** 经 `node_modules/.bin/dsh-pet-migrate-state --dry-run --db <测试库>` 调用
- **THEN** 脚本成功加载包内校验代码并输出报告，没有模块解析错误

#### Scenario: 存在非终态投递时拒绝
- **GIVEN** 库中任意一条投递处于 `queued`
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 脚本以非零码退出并指出该投递及处理方式；版本号与全部行不变，没有写入备份

#### Scenario: 存在未完成的操作时拒绝
- **GIVEN** 库中一条 locus 操作处于 `provisioning`，且没有任何 locus id 字段
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 脚本以非零码退出并指出该操作；数据库不变

#### Scenario: 保留行不满足 v19 条件时拒绝
- **GIVEN** 一条有配对但 `childComposition` 为 `safe-v2` 的 locus 行；或一条有配对、`active` 但没有 marker 的行；或一条保留的话题行，其 `parentLocusId` 指向 L 中的行
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 脚本以非零码退出并指出违规行；数据库不变

#### Scenario: 未确认时不写入
- **WHEN** 不带 `--dry-run` 和 `--yes` 运行脚本
- **THEN** 脚本以非零退出码结束，数据库不变，没有备份文件

#### Scenario: 已是目标版本时无操作
- **GIVEN** 已迁移到 19 的数据库
- **WHEN** 再次以 `--yes` 运行脚本
- **THEN** 报告已是目标版本并以 0 退出，不写入任何东西

#### Scenario: 从更早版本迁移时全部 locus 行都是旧模型
- **GIVEN** 一个 v17 数据库，含 2 条 locus 行，没有 `locus_mains` 表
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 备份写在任何改动之前；版本为 19，`locus_mains` 表存在且为空，两条 locus 行都被删除

### Requirement: 持久层只承载三层模型的 locus 行

v19 持久层的 locus 行 SHALL 满足：`childComposition` 若存在则为 `tier3`；`active` 行带 `childComposition`；从未创建 child 的行（含其后被停止、失效或退役的）可以没有 `childComposition`。这两条由持久行 schema 逐行校验，不满足时 Domain 打开失败。另外，每一条 locus 行的父会话 SHALL 在 `locus_mains` 中有记录，由 Host 启动对账在接收任何飞书消息之前检查。任一条件不满足时，Pet SHALL 保持未就绪，诊断中包含违规记录的 key 或 id，MUST NOT 跳过违规行继续服务。代码中按旧模型退休、重建或展示旧模型入口的分支 SHALL 被删除。某个干活主会话从未建立 locus 主会话时，按它查找入口（如默认 Q&A）SHALL 返回"未建立"而不是报错；只有已读到 locus 行而其父会话缺少配对时才是非法数据。基于 `chat_bindings` 的退休标记路径不属于旧模型 locus 行，保持不变。

#### Scenario: 合规数据正常就绪
- **GIVEN** 持久层只含满足上述条件的 locus 行
- **WHEN** Pet 启动
- **THEN** Pet 就绪，管理路由注册，所有入口按既有规则服务

#### Scenario: 非 tier3 marker 使 Domain 打开失败
- **GIVEN** v19 持久层中一条 locus 行的 `childComposition` 为 `safe-v2`
- **WHEN** Pet 启动
- **THEN** Pet 未就绪，诊断包含该行的 key；不注册管理路由，不接收飞书消息

#### Scenario: 无配对的行使启动对账失败
- **GIVEN** v19 持久层中一条 `tier3` 行的父会话不在 `locus_mains` 中
- **WHEN** Pet 启动
- **THEN** 启动对账失败，Pet 未就绪，诊断包含该行 id；不接收飞书消息

#### Scenario: 从未建立 locus 主会话的会话首次打开 Q&A
- **GIVEN** 干活主会话 W 没有任何 locus 主会话
- **WHEN** 所有者为 W 打开默认 Q&A
- **THEN** 查找默认 Q&A 返回未建立，随后正常新建 locus 主会话与 Q&A 群

#### Scenario: chat_bindings 退休标记仍然生效
- **GIVEN** 某群没有 locus 行，但有一条 `chat_bindings` 旧标记
- **WHEN** 该群收到所有者授权 at
- **THEN** 按既有退休标记规则要求所有者显式重建，不自动建立三层结构
