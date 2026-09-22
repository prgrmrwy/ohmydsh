## Purpose

统一描述研发工作上下文与飞书协作现场的关联：所有入口先取得主会话，再由专属子会话持续服务。覆盖研发先行、project 群先行、群与话题的层级补齐、双向发现、权限及上下文切换，不以旧 QA 或 workspace executor 的实现分类组织产品。

## Requirements

### Requirement: Locus 统一关联主会话子会话与飞书入口

系统 SHALL 以 locus 表达一段持续协作关联，包含飞书入口、workspace 归属、主会话、专属子会话、权限和生命周期。入口 SHALL 以 chat 标识与可选 thread 标识寻址；普通消息标识 MUST NOT 作为长期入口身份。workspace SHALL 与主会话归属一致。一个入口 SHALL 至多有一个活跃 locus，一个活跃 locus SHALL 恰好拥有一个专属子会话；一个主会话 SHALL 可关联多个 locus。系统 MUST NOT 以子会话作为绑定源产生孙辈。

#### Scenario: 同一研发主会话服务多个现场
- **WHEN** 同一主会话分别关联开发群、issue 群和话题
- **THEN** 每个入口拥有独立子会话，全部直属该主会话，不共享执行历史

#### Scenario: 同群话题关联不同主会话
- **WHEN** 两个话题分别显式指定不同主会话
- **THEN** 两个 locus 独立寻址，workspace 各自随主会话，不改变彼此关联

#### Scenario: 子会话不能作为绑定源
- **WHEN** 绑定前缀仅命中一个子会话
- **THEN** 不建立关联，回执与无可用匹配一致

### Requirement: 自动主会话按群建立且只使用 default workspace

系统 SHALL 为协作先行的群在已配置且可用的 default workspace 创建一个群专属自动主会话，并持久复用；不同群 MUST NOT 因 default workspace 相同而共用自动主会话。本期 MUST NOT 应用旧 chat 到 workspace 覆盖路由。default 缺失/不可用时 SHALL 停止创建并诊断，不能选择其它目录。

bot 入群 SHALL 可初始化关联结构，但 MUST NOT 因入群分析历史或执行项目工作；初始化授权无法证明时 MUST NOT 扩大群级提问资格，SHALL 等待 allowlist 的首次 at 补齐。入群事件缺失不影响首次合格 at 的幂等补齐。

#### Scenario: Project 群先行
- **WHEN** bot 经已验证授权进入一个尚无新模型关联的群
- **THEN** 建立 default workspace 下的群级主会话结构，不分析 PRD/会议或自动回复业务内容

#### Scenario: 首次消息补齐
- **WHEN** 无有效入群初始化记录，allowlist 成员首次 at bot
- **THEN** 创建群专属自动主会话和 locus 子会话，再处理该消息

#### Scenario: 重复初始化
- **WHEN** 入群事件重投或同群多次首次请求并发
- **THEN** 仅产生一个群级自动主会话，重复调用复用同一结构

#### Scenario: default 不可用
- **WHEN** 自动创建时 default workspace 无法解析
- **THEN** 不创建主/子会话，不回退其它 workspace，管理面说明原因

### Requirement: 自动主会话创建即具备可辨识身份且不可被当作新会话占用

自动主会话 SHALL 在创建时经常规会话生命周期收到一条开场说明，陈述其 locus 身份（飞书入口 chat、workspace 与执行根）。该主会话 MUST NOT 停留在零轮次形态：宿主把无 `turn/start` 的会话归为 blank，而 blank 会清空标题、隐藏会话标识并使其可被「新建会话」复用。

开场说明 SHALL 明确自身只是上下文陈述而非任务，要求主会话确认知悉后保持待命，MUST NOT 要求或诱导其分析项目、读取文件或给出结论。开场说明 SHALL 说明飞书消息由子会话处理且不会自动回传。

开场说明 SHALL 复用常规用户消息投递路径，MUST NOT 为此特化会话日志结构或手工构造事件。主会话的持久发布 SHALL 依据创建事实，MUST NOT 依赖该开场说明的模型回复；模型不可用时 MUST NOT 阻断 locus 建立。

#### Scenario: 跳转后可证明身份
- **WHEN** 所有者从管理面打开一个刚创建、尚无业务往来的自动主会话
- **THEN** 该会话显示自己的标题与开场身份说明，可据此确认所属 locus、workspace 与执行根，不呈现为「新会话」

#### Scenario: 新建会话不得占用主会话
- **WHEN** 用户在该 default workspace 中点击「新建会话」
- **THEN** 宿主不得把已有 Locus 主会话作为空白会话交付复用，用户输入不进入协作根

#### Scenario: 开场说明不触发工作
- **WHEN** 自动主会话收到开场说明
- **THEN** 它只需确认知悉并保持待命，不分析项目、不读取文件、不产生业务结论

#### Scenario: 模型不可用不阻断建立
- **WHEN** 开场说明因模型不可用而未能得到回复
- **THEN** locus 与子会话仍按创建事实正常发布，该主会话仍不被判为空白会话

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

### Requirement: 群与话题按层级补齐且继承在创建时固定

Locus 树 SHALL 只由飞书入口的**首条合格消息**按需建立。Bot 加入群 MUST NOT 创建主会话、子会话或 locus，也 MUST NOT 产生其它持久后果；群与话题 SHALL 使用同一建树时机，不因入口类型而提前或延后。

话题新建 SHALL 先确保所属群的根结构存在；群无主会话时 SHALL 先创建群自动主会话。新话题默认 SHALL 使用群当前主会话，显式来源优先。群级与话题级子会话 SHALL 是主会话下的兄弟，而非递归父子。已建立话题 SHALL 固定其主会话，不在每次消息时重新继承群来源。

消息无法确定 thread 归属时 MUST NOT 将它冒充群本体投递；失效的明确关联 MUST NOT 当作不存在而自动换来源。

#### Scenario: 入群不产生持久后果
- **WHEN** bot 被拉进任何群，群内尚无人 @ 过 bot
- **THEN** 不创建主会话、子会话或 locus，管理面不出现该入口的关联记录；平台侧的群成员关系仍可直接查询，不依赖本地副本

#### Scenario: 首条合格消息建立整棵树
- **WHEN** 尚无 locus 的群收到第一条 @ bot 的合格消息
- **THEN** 在该次投递中建立主会话、子会话与 active locus，随后正常投递该消息；建立失败时不发布半成品，按既有补偿回收已创建资源

#### Scenario: 群与话题建树时机一致
- **WHEN** 分别向尚无 locus 的群本体与尚无 locus 的话题发送首条合格消息
- **THEN** 两者都在首条消息到达时建树，得到结构等价的归属，不存在一方在入群时已预先建立的差异

#### Scenario: 话题先行
- **WHEN** 第一条合格消息来自尚无群结构的话题
- **THEN** 先建立群主会话，再建立话题子会话，与先群后话题得到等价归属

#### Scenario: 两话题并发首次创建
- **WHEN** 同群两个新话题同时触发
- **THEN** 共用同一个已确保的群主会话，各自持有不同子会话

#### Scenario: 显式话题来源不改变群
- **WHEN** 群默认主会话是 S0，话题显式绑定 S1
- **THEN** 仅该话题使用 S1，其它新话题仍默认 S0

#### Scenario: 话题身份不确定
- **WHEN** 入站事实或解析不足以证明消息属于哪个入口
- **THEN** 停止派发并诊断，不投递给较宽的群本体子会话

### Requirement: Q&A 是默认入口的创建或打开

GUI Q&A SHALL 仅接受未归档主会话，验证 bot、所有者及宿主能力。首次 SHALL 创建该主会话的默认答疑群并指定发起者为群主，建立 read locus 与专属子会话。后续 SHALL 打开该默认入口并标明复用，MUST NOT 因其它群绑定或最近使用时间改变默认对象。创建失败 SHALL 不发布半成品关联，回收未发布资源；无法回收的群 SHALL 明示残留。

#### Scenario: 首次 Q&A
- **WHEN** 主会话尚无默认答疑入口且创建成功
- **THEN** 发起者拥有新群，群绑定该主会话的 read 子会话，结果标明新建

#### Scenario: 有多个关联仍打开默认群
- **WHEN** 主会话已有默认 Q&A、另有多个 issue locus，用户再次点击 Q&A
- **THEN** 打开原默认 Q&A，不创建新群、不跳转最近 issue 群

#### Scenario: 默认入口失效
- **WHEN** 默认入口已失效或退役
- **THEN** 如实提示状态并提供重建，不把它当可用复用对象，也不悄悄换成其它绑定

#### Scenario: 创建中途失败
- **WHEN** 子会话或群已创建但关联不能完成
- **THEN** 不发布 active locus，执行补偿并明示不可回收残留

### Requirement: 显式绑定可替换自动关联并警告上下文改变

`-b/--bind <prefix>` 及 `/bind <prefix>` SHALL 只由 allowlist 触发。前缀 SHALL 至少六位，唯一匹配未归档主会话；无匹配/多匹配 SHALL 同一句回执，不暴露其它会话。群名 SHALL 取平台事实，未知留空，不承诺管理不属于自己的群。

尚未建立 locus 的入口收到 `/bind` 时 SHALL 直接以指定主会话建立该入口的 locus，MUST NOT 先建立自动来源再改绑：入群不预建关联，因而不存在需要被替换的自动归属。此时 MUST NOT 发出上下文变更警告——没有发生来源变化。

自动建立或默认继承的 locus 在空闲时 SHALL 允许显式切换到 S1；已显式绑定的不同来源 SHALL 拒绝直接覆盖并指向解除，同源重试 SHALL 幂等。存在运行或已接受待处理消息时 SHALL 拒绝切换并提示稍后。

切换 SHALL 建立新子会话、新代际且默认 read；旧子会话历史保留。当前入口 MUST 明确收到“从 S0 切换到 S1，上下文来源发生变化，旧对话未自动合并”的提示，使用标题或短标识；通知未送达时 MUST NOT 无提示开始新来源工作。已有话题 MUST NOT 自动迁移，新话题 SHALL 默认使用新群主会话。

#### Scenario: 首次绑定一次建对
- **WHEN** bot 已在群内但该入口尚无 locus，allowlist 发送 `/bind S1`
- **THEN** 直接建立以 S1 为主会话的 locus，`mainSource` 记为显式来源，不产生自动 main、不执行改绑、不发送上下文变更警告

#### Scenario: 自动来源显式切换
- **WHEN** 空闲自动 locus S0 收到 allowlist `/bind S1`
- **THEN** 创建 S1 的新 read 子会话并切换，当前入口收到明确的 S0→S1 上下文警告，旧历史不自动合并

#### Scenario: 群切换不迁移旧话题
- **WHEN** 群从 S0 切换到 S1，存在话题 A 且随后新建话题 B
- **THEN** A 继续 S0，B 默认 S1，管理视图如实展示不同来源

#### Scenario: 显式来源被覆盖
- **WHEN** 已显式绑定 S1 的 locus 收到绑定 S2
- **THEN** 拒绝并说明需先解除；同 S1 重试只返回既有结果

#### Scenario: 忙时切换
- **WHEN** 当前子会话有执行中或排队消息时收到改绑
- **THEN** 不强杀、不改来源，提示稍后重试

#### Scenario: 非 allowlist 控制请求
- **WHEN** 群成员不在 allowlist 但发送绑定、解绑或 scope 命令
- **THEN** 静默丢弃，不把命令作为普通问题送给子会话

### Requirement: 全部飞书工作统一为子会话常规交互

新模型 SHALL 仅对 mention 自身 bot 的消息触发工作，包括单聊；普通非 mention 内容 MUST NOT 启动推理、总结或自动更新主会话。消息 SHALL 由对应 locus 的同一个长期 child session 持续处理，MUST NOT 建立飞书 root executor/Invocation 或 waiting-user 执行分支。

每个 locus SHALL 维护按接受序排列的持久 Delivery 队列，任意时刻至多向 child 投递一个 current Delivery。后续合格消息 SHALL 先进入 backlog，只有 current 进入终态后才可投递下一条未过期消息；MUST NOT 依赖 DSH `next-turn`/`next-step` 的合批顺序推断两个飞书请求或父回复的业务归属。

子会话需要决策时 SHALL 直接向当前飞书入口发问，后续 at 回答 SHALL 在同一子会话继续。歧义回答 SHALL 澄清，不自动解释为授权。模型 turn 结束 MUST NOT 被显示为整个项目完成，也 MUST NOT 单独完成 current Delivery。Host 超时推进 SHALL 继续复用同一个 child session及其历史，MUST NOT 自动重建 session 或增加 locus generation。

子会话的运行体驻留 SHALL NOT 被当作代际可用性的一部分。运行体 MAY 在子会话空闲且 inbox 为空时释放它（这是常态而非故障），因此宿主 MUST 以「按需冷恢复该 durable child」的方式取得其 live session 与策略，MUST NOT 因「当前不在内存中」判定该 child 不可用、作废代际或另建 child。宿主提供的「读取 exact child session」能力 SHALL 自身完成驻留解析，MUST NOT 要求调用方先证明它已驻留——否则每条消息都会在第二次投递时失败，并表现为一代只服务一条消息。

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

### Requirement: 关联具备双向发现且不过度披露

系统 SHALL 从入口查当前 locus/主会话/子会话，从主会话列出全部 locus，从子会话找到唯一 locus。正反向结果 SHALL 同源一致并区分历史和活跃代际。所有者管理面 SHALL 展示来源、群/话题、默认 Q&A、权限、工作根和状态。群内回执 MUST NOT 泄露完整 session ID、其它群 ID 或其它 locus 列表。

#### Scenario: 双向核对
- **WHEN** 所有者从研发主会话查看协作入口，再从某入口打开会话
- **THEN** 两个方向指向同一个 locus 与对应主/子会话

#### Scenario: 子会话反查
- **WHEN** 子会话查询自身关联
- **THEN** 只返回自己的 locus，不因共享 parent 获得所有兄弟入口的公开枚举

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

初始化任务书 SHALL 告知子会话在工作根、约束或相关事实不足时，可通过宿主原生消息能力询问 caller-bound 主会话，MUST NOT 允许指定其它 parent 或 locus。主会话回复只是对话事实，SHALL NOT 因此成为持久授权；锚点仍须由所有者在管理面显式确认后写入。答复只提供上下文事实；路径存在性不等于写授权。

父子或 agent 间的 `agent-message` SHALL 只作为子会话上下文通信，不参与 Delivery 路由选择：它 MUST NOT 建立、修改、替换或撤销 current Delivery 已由 Host 绑定的回复目标。current Delivery 存续时，原始飞书投递 turn 结束后的 `agent-message` SHALL 可唤醒同一 child 继续处理该 current；没有唯一 current 时，`agent-message` MUST NOT 自行产生飞书 finish/wait 能力。GUI/user steer、来源不明的参与者消息与第二个已投递 Delivery仍 SHALL fail closed。

caller-bound `pet_context` SHALL 提供当前 locus、局部项目入口、已确认局部锚点、权限与 Host 确认的 current Delivery 状态，不允许模型指定其它目标。后续投递只带必要请求事实和查询引导，MUST NOT 每次重复全部说明。未知锚点 SHALL 如实报告。系统 MUST NOT 自动汇总或把子会话结论回传主会话；对实际询问的定向答复不属于自动结算回报。所有者可主动查阅，项目资料 SHALL 按需读取，不自动共享兄弟子会话历史。

主会话 SHALL 被表述为工作归属与可询问的上下文来源，MUST NOT 因其父节点身份宣称已统合所有协作现场的最新认知。用户显式发起的查阅与汇总不属于自动回传；系统 SHALL 区分可发现、可读取与已采纳，缺少历史读取能力或权限时如实说明。当前模型 MUST NOT 宣称已提供 project 级自动知识同步或多人分布式协同。旧 QA/chat 绑定仍遵守前置版本的退役隔离，不因本兼容规则恢复服务。

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

### Requirement: 投递与结算关联独立于会话运行状态

每条接受消息 SHALL 有持久 Delivery，至少标识入口、locus 代际、child session、触发 `messageId`、接受顺序、`acceptedAt`、deadline、队列/终态与出站结果。普通消息标识 MUST NOT 成为长期 locus 身份，但群级和话题级业务回复都 MUST 使用各自 current Delivery 的触发 `messageId` 做飞书按消息回复；话题回复还 MUST 留在 Host 从入站事件确认的原话题。

接受不等于投递，投递不等于完成，模型 `turn/end` 不等于 Delivery 终态。初始化、GUI 私聊、父子补问 MUST NOT 消耗 current。Host SHALL 保证每个 locus 至多一个 current，且完成、超时与重复调用通过原子状态竞争只终结该项一次；迟到调用 MUST NOT 消费后续 Delivery或新代际。

业务正文唯一完成入口 SHALL 是 caller-bound `pet_locus_finish`。`reply` 必须携带非空正文；`no-reply` MUST NOT 携带正文且必须记录非空原因。工具 MUST NOT 接受任何 Delivery、chat、message、thread 或 target selector。Host SHALL 以实际 caller、active locus/generation/permission 与唯一 current 解析不可变目标；不满足时 fail closed。

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

### Requirement: 生命周期退出保留历史且旧关联不兼容

归档/解绑 SHALL 停止当前 locus 服务并保留主/子会话历史与飞书资源；忙时拒绝强制退出。主会话失效 SHALL 使相关 locus **退出服务**：宿主 SHALL 如实明示需要重建、普通 at MUST NOT 自动复活、MUST NOT 自动换来源；「退出服务」的判据 SHALL 由实时读取的归档事实得出，MUST NOT 要求把代际记录改写成停止/失效标记，使所有者恢复该主会话后即恢复服务、无需一次多余的重建。退役群 locus 不得级联改变仍有效的话题来源。明确退出的入口 SHALL 保留停止标记，普通 at MUST NOT 自动复活，需所有者显式重新建立；退出回执 SHALL 说明此行为。群级结构整体退出时，已有有效话题继续使用其固定主会话，但新话题 MUST NOT 以自动补齐绕过退出，需先显式重新建立群级结构。

旧版本关联 SHALL 标为不可用且不迁移到新模型，不参与路由或权限恢复；普通 Pet 轮盘数据保持不变。所有者 SHALL 显式重新建立旧入口，不能无提示以 default 新身份接管。用户接受破坏性升级 MUST NOT 被解释为授权删除旧会话、群或历史。

「普通 at MUST NOT 自动复活」的主语 SHALL 严格限于**所有者明确退出**的入口（`stopped` / `retired`）。宿主自行判定不可用的代际（`invalid`，如重启后子会话重新附着失败、缺少 composition 证明）MUST NOT 与之等同：所有者从未作出退出决定，不存在需要保留的意图。此类入口 SHALL 按「无存量入口」处理，由下一次**已授权**的 at 直接建立新代际；allowlist 门禁不变，普通成员 MUST NOT 借此引导建立。此区分是必需的而非优化：宿主判定失效的入口若被要求显式重建，而该代际记录的主会话恰已归档，重建将必然失败，入口将永久不可达。

**主会话被归档**是这两类之外的第三种情形，且 MUST NOT 被归入"宿主判定"：所有者确实作出了决定（归档该会话），只是决定的对象不是本 locus。因此：该入口 SHALL 退出服务并由宿主如实明示需要重建，普通 at MUST NOT 自动复活它，MUST NOT 自动改挂到新建的主会话（这正是「不自动换来源」）；同时宿主 MUST NOT 把 locus 记录改写成所有者退出的标记（`stopped` / `retired`）——那会伪造一个所有者从未作出的、针对本入口的决定。此分类 SHALL 由读取归档事实得出，MUST NOT 落盘成代际状态。

管理面 SHALL 与通道对「本入口是否还能服务」给出一致判断：主会话已归档时，即使 locus 记录仍是 `active`，管理面 SHALL 允许所有者显式重建它（见下条的两条修法），MUST NOT 出现"通道提示去重建、管理面却不提供重建"的死角。

运行体本身 MUST NOT 被归档语义绕过：任何解析主会话的路径 SHALL 在 `get` / `resume` 之前先判定该会话是否已归档，MUST NOT 因"归档会话在运行体中仍可 `resume`"而把它复活并继续服务。此闸门 SHALL NOT 依赖运行体自身的归档校验——`dsh-agent` 与 session controller 都不校验归档，归档只是一份 registry 清单。

「建立新代际」SHALL 严格限于发布一个**新创建**的代际：失效代际的子会话 MUST NOT 被 adopt、冷恢复或复用（其缺少 safe-v1 composition 证明，恢复即继承父 preset），失效行 SHALL 作为历史保留并退出路由。原主会话不可用（归档或缺失）时，恢复 SHALL 按首次建立的方式新建主会话，MUST NOT 因此拒绝服务。管理面的所有者显式重建 MAY 保持不自动新建主会话（以便就地说明需恢复哪个会话），但自动恢复路径 MUST 具备该回退，否则该入口在两条路径下都不可达。话题入口的群级父代际同样失效时，恢复 SHALL 先恢复群级再恢复话题，MUST NOT 因群级问题拒绝话题。

管理面的所有者显式重建 SHALL 同时提供两条互斥的修法，且都不要求先还原归档：**恢复该主会话后重建**（沿用原主会话），或**用一个新的主会话重建**（MUST 由所有者显式选择，MUST NOT 因原主会话归档而默认如此）。两条路径 SHALL 都把来源变化如实告知，MUST NOT 让入口在所有者以为仍挂在原主会话时静默改挂到新主会话。既有「原主会话已归档」的拒绝文案 SHALL 同时给出这两条修法，MUST NOT 只给"先恢复归档"这一条——那只覆盖了所有者不再想要该主会话的情形。

失效诊断 SHALL 保留宿主原始错误信息，MUST NOT 仅以稳定原因码记录——原因码无法区分瞬时重附着竞争与真正不可用的子会话，使失效无法被事后定位。

读不到 live policy（读取失败或读到空值）MUST NOT 被记为 drift：它不构成「存储的授权已不再描述该 child」的证据。但它确实意味着该代际此刻无法服务，因此宿主 SHALL 退休该代际并经建立路径重建一次，用新代际继续服务这条消息，MUST NOT 让入口停在 `active` 却对之后每条消息永久拒答——那等于一个读不到的子会话永久静音整个入口。重建后仍读不到时 SHALL 失败关闭并保留诊断。能力整体缺失（如组合中不存在策略解析能力）属于组合事实而非该 child 的事实，重建无法修复，MUST NOT 因此触发重建。

#### Scenario: 退出单个 locus
- **WHEN** 所有者在空闲 locus 解绑或归档
- **THEN** 停止接收该关联消息，历史可查，主会话其它 locus 不受影响

#### Scenario: 宿主判定失效的入口重新可用
- **WHEN** 某入口当前代被宿主置为 `invalid`（非所有者退出），此后收到 allowlist 成员的普通 at
- **THEN** 按无存量入口建立新代际并正常应答，不要求显式重建、不因原主会话已归档而拒绝；普通成员的同一消息仍按 allowlist 拒绝

#### Scenario: 来源失效
- **WHEN** 主会话归档、删除或无法恢复
- **THEN** 关联入口有限次提示失效，不自动创建新主会话继续回答

#### Scenario: 升级旧入口
- **WHEN** 升级后旧绑定入口收到消息
- **THEN** 不使用旧执行路径；向有权重建者说明需要重建，未确认前不静默换成自动来源

显式重建 SHALL 使用被重建入口自身记录的原主会话作为新 parent；管理面 MUST NOT 提供替换 parent 的自由输入（`### Requirement: 管理面不提供新建外部资源的入口`）。归档与真正缺失/删除是两类不同的不可用：前者可逆（会话字节与历史仍在，仅工作区注册表成员关系被隐藏），后者不可逆。显式重建的原 parent 恰好处于归档状态时，拒绝理由 SHALL 指出"已被归档"并说明所有者可通过恢复该会话解除阻塞；MUST NOT 与真正缺失/删除会话使用相同措辞，避免所有者把一个可逆状态误判为死路。

#### Scenario: 显式重建的原 parent 已归档
- **WHEN** 所有者对某入口发起显式重建，其记录的原主会话当前处于已归档状态
- **THEN** 拒绝重建并指出该会话已被归档、需先恢复；所有者恢复该会话后，同一重建请求（parent 不变）SHALL 成功，不要求提供另一个 parent

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

管理面 SHALL 为每类对象提供由真实标识**确定性派生**的短码（locus / 父会话与子会话 / 群与会话入口 / 话题 / 工作区各一条明确规则），并以该短码作为线索即可复制完整标识。短码 MUST NOT 被用作任何请求的输入或身份来源。当平台提供可辨识名称时，管理面 SHALL 优先呈现名称，且名称 SHALL 与短码成对出现——名称单独 MUST NOT 构成身份。平台未提供名称时，管理面 SHALL 呈现由角色词与短码构成的兜底名，MUST NOT 猜测平台事实（例如在 chat 类型未知时写成「群」）。原始标识 MUST NOT 作为入口行的主要标识，SHALL 收在可展开的标识区并可复制。

#### Scenario: 同名入口仍可区分

- **WHEN** 同一父会话下两个入口的平台名称同为「答疑 · DSH」
- **THEN** 两行分别显示名称并各自附带不同的短码，所有者可区分二者

#### Scenario: 名称不可得时不猜测

- **WHEN** 平台未提供该入口的名称，且该 chat 的类型未知
- **THEN** 管理面显示兜底名（角色词 + 短码）并说明这是兜底显示，不得显示为「群」或其它未证实的平台事实

#### Scenario: 短码不是身份

- **WHEN** 客户端尝试以短码发起任一 locus 操作
- **THEN** 请求不被接受；所有操作仍以完整标识与代际栅栏寻址

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

渲染 SHALL 只使用当前 chat 成员列表给出的精确成员映射，且只改写**整词**引用。可解析的引用有两种：**显示名**（`@` 之后紧跟完整显示名，其后为空白、标点或串尾）与**成员的精确 open_id**（`@ou_…`，其后为同类边界）；前者用「显示名 → open_id」映射，后者用「open_id → 显示名」映射，两者都改写为 `<at user_id="ou_…">显示名</at>`。

接受 open_id 引用是必需的，不是便利：Agent 可能只拿到 `ou_…` 而没有显示名（投递提示词在无法解析显示名时就只给出 open_id），此时它写出的 id 会作为纯文本发出——对方收不到通知，且该标识被公开在群里。渲染它既通知到正确的人，也不再公开该标识。

以下情形 MUST 保持原文不改写：正文已包含 `<at ` 标记；同一显示名对应多个成员（歧义）；引用不属于该 chat 成员（未知显示名，或不是本 chat 成员的 open_id）；`@` 之前是词内字符（如邮箱地址）。

成员列表不可读、映射缺失或渲染异常时 SHALL fail-soft：按原文发送，MUST NOT 阻断发送或改变 Delivery 终态。诊断 SHALL 只记录低基数分类与改写次数，MUST NOT 记录姓名、open_id 或正文。

注入 SHALL 告知 Agent 群内 @ 人的可行写法，并说明 Host 会渲染整词显示名，使别名与群显示名不同时仍能由 Agent 显式给出标记。

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

Locus child 的飞书业务正文与撤回动作 SHALL 只能由 caller-bound `pet_locus_finish` 的 Host 实现产生。child 的已发布能力集合 MUST NOT 提供可经 Skill、shell、脚本、CLI、通用 HTTP、子委派或其它执行身份直接发送或撤回飞书消息的路径；普通 assistant 文本仍不得外发。

该边界 SHALL 由工具/执行 authority 隔离强制执行，MUST NOT 仅依赖 prompt、Skill 省略、命令字符串黑名单、PATH/HOME 隐藏或 read-only 文件沙箱。若当前 pinned runtime 无法证明在保留通用进程执行时隔离飞书凭据与 Lark 网络出口，发布的 Locus safe composition SHALL 移除 `bash`、`pwsh`、任意代码执行和可代为执行的子委派能力，只保留受控只读工具与 caller-bound Pet 工具。

Locus child 创建和冷恢复 SHALL 使用同一份持久、不可由 parent/user preset 漂移的 safe composition。每个成功完成 independent marker 与精确 durable toolFilter 装配的新建/重建 child，SHALL 在对应 Locus 行发布 Host 证明的 `safe-v1` composition marker；该 marker 只能在 child 创建成功返回后、active locus 发布时写入。缺少 marker 的旧行仍 SHALL 可被 schema/persistence 读取，但 startup reconciliation SHALL 将其置为 invalid，resolution、adoption 与 dispatch SHALL 在任何 parent/child cold resume 之前拒绝；非 `safe-v1` 值亦同。Host 无法证明该 composition 已安装时 SHALL 拒绝创建、恢复或派发；MUST NOT 静默回退到继承父 preset 的 child。任何为满足本条所需的 DSH compatibility seam SHALL 针对 manifest 中的精确 pin 做运行时探针并 fail closed。

#### Scenario: 受管 finish 正常发送
- **WHEN** safe child 对其已证明的 current Delivery 调用 `pet_locus_finish(reply)`
- **THEN** Host 按 durable CAS 和固定触发消息发送一次正文并记录结果

#### Scenario: shell 旁路不可达
- **WHEN** child 尝试以 `lark-cli`、绝对路径脚本、`msg.py`、Python/Node/curl 或复制后的可执行文件直接调用飞书接口
- **THEN** 已发布执行 authority 不能产生飞书业务消息，且 Delivery 状态不因尝试而改变

#### Scenario: 子委派不能洗白权限
- **WHEN** child 尝试通过 subagent、workflow、Ralph 或 agent message 让另一执行身份代发
- **THEN** safe composition 不提供该旁路，或接收方同样无飞书出站 authority；业务正文仍只能由原 current 的 finish 产生

#### Scenario: 隔离能力无法证明时不发布
- **WHEN** runtime 既不能持久固定无进程执行的 safe composition，也不能提供隔离凭据与 Lark egress 的独立 execution world
- **THEN** Locus intake/child 能力保持 unavailable 并给出确定性诊断，MUST NOT 以字符串过滤或 prompt 警告宣称安全

#### Scenario: 升级前的 legacy child 不可恢复服务
- **WHEN** 一个历史 active locus 的 durable child 没有 Host attested safe-composition marker
- **THEN** 启动恢复或派发前将该 locus 标记为不可服务并要求显式重建，MUST NOT adopt 或冷恢复该 child 后继承父 preset

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
