## Purpose

统一描述研发工作上下文与飞书协作现场的关联：所有入口先取得主会话，再由专属子会话持续服务。覆盖研发先行、project 群先行、群与话题的层级补齐、双向发现、权限及上下文切换，不以旧 QA 或 workspace executor 的实现分类组织产品。

## ADDED Requirements

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

新模型 SHALL 仅对 mention 自身 bot 的消息触发工作，包括单聊；普通非 mention 内容 MUST NOT 启动推理、总结或自动更新主会话。消息 SHALL 通过同一子会话的有序持续交互处理，MUST NOT 建立飞书 root executor/Invocation 或 waiting-user 执行分支。

子会话需要决策时 SHALL 直接向当前飞书入口发问，后续 at 回答 SHALL 在同一子会话继续。歧义回答 SHALL 澄清，不自动解释为授权。轮次结束 MUST NOT 被显示为整个项目完成。

#### Scenario: 普通资料发布
- **WHEN** 成员发送 PRD、Figma、会议资料但未 at bot
- **THEN** 不执行工作；将来被 at 时可按权限按需读取，不宣称已吸收资料

#### Scenario: 决策往返
- **WHEN** 子会话询问方案 A/B，用户随后 at 回复 B
- **THEN** 后续轮次在同一子会话继续，不恢复某个飞书 Invocation

#### Scenario: 多人连续提问
- **WHEN** 子会话处理消息时又有两条合格 at
- **THEN** 按接受序排队，各自保持消息关联，不新建执行会话

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

#### Scenario: 宿主写范围不支持
- **WHEN** 工作根位于当前可写范围之外
- **THEN** 明确说明无法授予该范围，保持 read，不把 prompt 当作解除限制

#### Scenario: 冷恢复或降权
- **WHEN** 子会话恢复或空闲时被设置 read
- **THEN** 核验实际策略后才继续派发，策略失败停止服务并诊断

### Requirement: 上下文按实际子会话绑定并允许按需问主会话

子会话 SHALL 继承主会话可用的已完成前缀，不宣称实时同步。初始化任务书 SHALL 允许按需询问主会话当前工作根与约束，经确认记录锚点；普通目录/ws/sw 均可，MUST NOT 以新建 worktree 代替共享已有工作现场。

caller-bound context SHALL 提供当前 locus、项目入口、已确认锚点与权限，不允许模型指定其它目标。后续投递只带必要请求事实和查询引导，MUST NOT 每次重复全部目录说明。未知锚点 SHALL 如实报告，不把路径存在当授权。系统 MUST NOT 自动汇总或把子会话结论回传主会话；所有者可主动查阅。项目资料 SHALL 按需读取，不自动共享兄弟子会话历史。

主会话 SHALL 被表述为初始上下文来源与工作归属，MUST NOT 因其父节点身份宣称已统合所有协作现场的最新认知。用户显式发起的查阅与汇总不属于自动回传；系统 SHALL 区分可发现、可读取与已采纳，缺少历史读取能力或权限时如实说明。当前模型 MUST NOT 宣称已提供 project 级自动知识同步或多人分布式协同。

#### Scenario: 子会话发现不自动成为主会话认知
- **WHEN** QA 子会话产生新发现，而用户未发起主会话查阅或采纳
- **THEN** 系统不自动更新主会话，不将该发现呈现为主会话已知的项目决策

#### Scenario: 用户主动查阅受实际能力约束
- **WHEN** 用户要求查阅一个可通过索引发现、但当前无权读取或缺少宿主读取能力的子会话历史
- **THEN** 如实说明限制，不把找到 locus 表述为已读取或已汇总内容

#### Scenario: 历史不含最新目录
- **WHEN** 子会话无法从继承前缀确定当前执行根
- **THEN** 可问主会话或请求所有者确认，不猜 cwd，不擅自创建另一个工作目录

#### Scenario: 主会话无法回答
- **WHEN** 补问信息无法取得
- **THEN** 报告未确认，不把请求接受当作已收到答复，不放宽权限

#### Scenario: 新话题上下文
- **WHEN** 群子会话已积累讨论而新话题子会话建立
- **THEN** 新话题继承主会话和项目入口，不宣称自动继承群子会话全部对话

### Requirement: 投递与结算关联独立于会话运行状态

每条接受消息 SHALL 有持久关联，至少标识入口、locus 代际、子会话、消息与执行对应关系。接受不等于完成；初始化、GUI 私聊、父子补问 MUST NOT 消耗飞书待反馈记录。迟到或重复结算 MUST NOT 反馈到其它消息/新代际，无法证明对应时只诊断。

Host SHALL 维护进行中/完成/失败表情，表情失败不阻断工作。文字 SHALL 由子会话使用 bot 身份回到当前入口，Host 不重复代发正文；控制回执不受此限制。GUI 私聊 SHALL 保留上下文但不产生飞书出站。恢复 SHALL 使用原主/子会话，不静默切换模型或来源。

#### Scenario: 私聊与群消息交错
- **WHEN** GUI 私聊或初始化先于一个待处理飞书请求结算
- **THEN** 不消费该请求的反馈，私聊不产生飞书回复

#### Scenario: 旧代际迟到结算
- **WHEN** S0 子会话在入口切换后出现迟到结算
- **THEN** 只能关联 S0 原 Delivery，不更新 S1 的消息

#### Scenario: 宿主重启
- **WHEN** 合格消息需要恢复子会话
- **THEN** 恢复原主/子会话并核验上下文与权限，provider 不可用明确失败，不另建替代身份

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
