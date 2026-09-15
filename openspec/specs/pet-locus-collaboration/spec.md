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

话题新建 SHALL 先确保所属群的根结构存在；群无主会话时 SHALL 先创建群自动主会话。新话题默认 SHALL 使用群当前主会话，显式来源优先。群级与话题级子会话 SHALL 是主会话下的兄弟，而非递归父子。已建立话题 SHALL 固定其主会话，不在每次消息时重新继承群来源。

消息无法确定 thread 归属时 MUST NOT 将它冒充群本体投递；失效的明确关联 MUST NOT 当作不存在而自动换来源。

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

自动建立或默认继承的 locus 在空闲时 SHALL 允许显式切换到 S1；已显式绑定的不同来源 SHALL 拒绝直接覆盖并指向解除，同源重试 SHALL 幂等。存在运行或已接受待处理消息时 SHALL 拒绝切换并提示稍后。

切换 SHALL 建立新子会话、新代际且默认 read；旧子会话历史保留。当前入口 MUST 明确收到“从 S0 切换到 S1，上下文来源发生变化，旧对话未自动合并”的提示，使用标题或短标识；通知未送达时 MUST NOT 无提示开始新来源工作。已有话题 MUST NOT 自动迁移，新话题 SHALL 默认使用新群主会话。

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

所有新建及替换后的 locus SHALL 默认 read，并在接受工作前核验宿主实际文件只读策略；MUST NOT 仅依赖部署默认或数据库标签。`-s/--scope read|write` SHALL 仅由 allowlist 改变当前 locus 的共享档位，记录人、时间与生效结果；不存在关联时机械拒绝，未知值拒绝。

写能力或目标工作根无法被当前宿主策略支持时 SHALL 明确拒绝提权并维持 read，MUST NOT 隐式选择更广模式。忙时变更 SHALL 拒绝并提示稍后；应用失败 MUST NOT 回执成功。read/write MUST NOT 被宣称为外部 API 全部副作用的控制。重新建立关联 MUST NOT 继承旧 write。

#### Scenario: 写父会话创建只读子会话
- **WHEN** 来源主会话当前允许文件写入，新建 locus
- **THEN** 子会话在工作前确认 read，不静默继承 write

#### Scenario: 授予共享 write
- **WHEN** allowlist 在空闲 locus 提权且宿主支持已确认工作根
- **THEN** 核验生效后回执并记录授权；该入口后续成员请求共享该档位

写授权 SHALL 在每次核验时派生，MUST NOT 以持久标记代替。派生 SHALL 同时要求两个独立事实：所有者已显式确认执行根（意图），且 live sandbox 回读的 workspace root 与该根规范化后精确相等（权威）。二者缺一不可：仅有 live root 一致而无所有者确认 SHALL 拒绝；仅有所有者确认而 live root 不一致或缺失 SHALL 拒绝。所有者显式撤销 SHALL 优先于 root 一致。

持久化的锚点确认 MUST NOT 写入可直接满足写授权的标记，因为已存储的授权可能过期并凌驾于 live sandbox 之上。

#### Scenario: 宿主写范围不支持
- **WHEN** 工作根位于当前可写范围之外
- **THEN** 明确说明无法授予该范围，保持 read，不把 prompt 当作解除限制

#### Scenario: 授权按 live root 派生
- **WHEN** 所有者已确认执行根，且 live sandbox 回读的 workspace root 与其规范化后一致
- **THEN** 授予 write 并记录授权人、时间与生效结果，不依赖任何已存储的授权标记

#### Scenario: 仅有 root 一致不足以授权
- **WHEN** live sandbox 的 workspace root 与某路径一致，但所有者从未确认该执行根
- **THEN** 拒绝提权并维持 read，提示需先确认上下文锚点

#### Scenario: 所有者撤销优先
- **WHEN** 所有者已显式撤销该执行根的写授权，而 live root 仍与其一致
- **THEN** 拒绝提权并维持 read

#### Scenario: 冷恢复或降权
- **WHEN** 子会话恢复或空闲时被设置 read
- **THEN** 核验实际策略后才继续派发，策略失败停止服务并诊断

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

归档/解绑 SHALL 停止当前 locus 服务并保留主/子会话历史与飞书资源；忙时拒绝强制退出。主会话失效 SHALL 使相关 locus 失效，有限次明示后停止响应，不自动换来源。退役群 locus 不得级联改变仍有效的话题来源。明确退出的入口 SHALL 保留停止标记，普通 at MUST NOT 自动复活，需所有者显式重新建立；退出回执 SHALL 说明此行为。群级结构整体退出时，已有有效话题继续使用其固定主会话，但新话题 MUST NOT 以自动补齐绕过退出，需先显式重新建立群级结构。

旧版本关联 SHALL 标为不可用且不迁移到新模型，不参与路由或权限恢复；普通 Pet 轮盘数据保持不变。所有者 SHALL 显式重新建立旧入口，不能无提示以 default 新身份接管。用户接受破坏性升级 MUST NOT 被解释为授权删除旧会话、群或历史。

#### Scenario: 退出单个 locus
- **WHEN** 所有者在空闲 locus 解绑或归档
- **THEN** 停止接收该关联消息，历史可查，主会话其它 locus 不受影响

#### Scenario: 来源失效
- **WHEN** 主会话归档、删除或无法恢复
- **THEN** 关联入口有限次提示失效，不自动创建新主会话继续回答

#### Scenario: 升级旧入口
- **WHEN** 升级后旧绑定入口收到消息
- **THEN** 不使用旧执行路径；向有权重建者说明需要重建，未确认前不静默换成自动来源
