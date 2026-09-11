## REMOVED Requirements

### Requirement: Q&A 动作原子地创建答疑群并 fork 源会话子代理

**Reason**: QA 不再是独立的 Task/绑定类型；源会话与群的双向 1:1、以归档 qa Task 释放占用的规则与同一主会话关联多个 locus 的统一模型冲突。

**Migration**: 产品入口由 `pet-locus-collaboration` 的默认 Q&A 入口、精确 locus 幂等创建与创建事务要求接替：首次创建默认答疑群，以后打开同一个默认入口，其它群或话题关联不改变该默认值；保留本人群主、失败回收与残留资源明示的安全约束。不读取、转换或继续服务旧 qa 绑定；已有群、session 与历史保留但不因此成为新 locus。

### Requirement: qa 群成员即触发许可且其余防线原样适用

**Reason**: 准入不能继续由 `kind: qa` 分叉决定；新模型按已授权的 locus 及其共享权限档位判定，不继承旧 QA 的触发资格或修改约定。

**Migration**: 由 `pet-locus-collaboration` 的初始化授权、locus 内成员提问权、仅 `@bot` 触发与 read/write 共享档位要求接替。mention、去重、水位、消息类型与身份防线继续适用，资格不外溢到其它入口；新 locus 默认 read，仅 allowlist 可改变该 locus 的 scope，群成员不能自行改变授权边界。旧 qa 行不产生成员豁免。

### Requirement: qa child 的工作目录约束是 prompt 级而非沙箱级

**Reason**: 建群时固定执行根并在每条提问重复整段目录约束不是统一协作上下文模型；仅 prompt 级修改确认也不能代替新 read/write 权限的真实宿主能力核验。

**Migration**: 由 `pet-locus-collaboration` 的主会话工作目录询问、已确认锚点持久化、caller-bound `pet_context` 以及真实权限边界要求接替。执行根仍不得从 `cwd` 猜测，不得把提示词宣称为沙箱；首次及恢复时取得当前 locus 与已确认锚点，不每轮重复整段上下文。不能证明写入目标受授权的宿主适配必须 fail closed，不能隐式采用 unrestricted。旧 qa 绑定内的执行根不自动迁入新 locus。

### Requirement: qa 触发消息经宿主队列投递 child 且回复由 child 发出

**Reason**: QA 与普通 channel 的双执行路径被统一子会话交互取代；旧 qa 投递记录和 qa Task 不再是活跃执行依据。

**Migration**: 由 `pet-locus-collaboration` 的每 locus 专属子会话、持久消息关联、有序独立轮次、主会话唤活与子会话冷恢复要求接替。所有飞书工作不创建专用 root executor 或 Invocation 队列，决策经飞书往返并续进同一子会话；普通文字回复仍由子会话发往当前触发入口，入队不等于完成，缺失恢复能力不得静默换模型。旧 qa 队列不继续消费。

### Requirement: qa 终态反馈由子代理结算事件驱动

**Reason**: 终态反馈不再是 QA 独有状态机，且不能根据已退休的 qa 投递关联更新飞书消息。

**Migration**: 由 `pet-locus-collaboration` 的统一消息关联与子会话结算反馈要求接替：进行中反馈属于具体触发消息，仅匹配其执行轮次的结算才能转为成功或失败；表情失败只记诊断，不影响执行；无法唯一匹配时不反馈到其它消息。子代理结算事件只是实现子会话反馈的宿主接缝，旧 qa 反馈行不重新激活。

### Requirement: 源会话失效时 qa 绑定 fail closed 且群内明示

**Reason**: 主会话失效应作用于其关联的统一 locus，不能继续维护独立 qa 失效状态与归档入口。

**Migration**: 由 `pet-locus-collaboration` 的主会话/locus 失效、有限次群内诊断、停止后续工作与历史保留要求接替。归档、删除、无法唤活或不能证明关联有效时 fail closed，不从 default workspace 另起陌生身份来替代；管理视图提供当前失效原因。旧 qa 绑定仅作不可用历史，不因源会话重新可用而复活。

### Requirement: child 收纳于源会话名下且私聊不产生飞书出站

**Reason**: UI 不再把 QA child 作为独立产品类型；每个群或话题 locus 都由主会话下的专属子会话处理。

**Migration**: 由 `pet-locus-collaboration` 的两层主/子会话执行树、原生子会话收纳、双向发现及本机直接对话边界要求接替。群与话题子会话互为兄弟；GUI 直接对话不建立飞书触发消息关联，不打表情或自动向飞书出站，其内容可成为该子会话后续轮次的上下文。旧 child 与历史仍可查但不自动绑定为新 locus。

### Requirement: 既有群经 `/bind` 绑定到已存在的会话

**Reason**: `/bind` 不再建立 `kind: qa` 行，也不能以旧群/源会话 1:1 占用规则阻止一个主会话服务多个入口；自动关联允许被显式主会话替换。

**Migration**: 由 `pet-locus-collaboration` 的显式群/话题绑定、命令准入、自动关联 S0 到显式主会话 S1 的空闲切换及群内告知要求接替。绑定与 scope 授权分开；切换必须提示上下文来源改变、旧历史未自动合并，既有话题不自动改绑，新话题继承新的群主会话。保留真实群名、来源如实展示、非 allowlist 命令静默、群成员不能改变边界与短标识回执的保护。旧 `/bind` 记录不导入、不作为新版命令的活跃目标。

### Requirement: `/unbind` 仅解除由 `/bind` 建立的绑定

**Reason**: 以归档 qa Task 解除、按 Q&A/既有群来源限制出口、恢复旧 workspace 覆盖或 default root executor 路由的退出规则已不适用于统一 locus。

**Migration**: 由 `pet-locus-collaboration` 的精确当前入口退出、allowlist 控制、忙时拒绝、安全停止后续投递、群/话题层级退出及显式重新建立要求接替。退出不删除群、主/子会话或历史，不恢复旧 workspace/qa 绑定或 Invocation 路由；回执准确说明退出后的可触发行为且不泄露完整 session ID 或其它群 ID。被退休的旧绑定不能被 `/unbind`、普通消息或自动补齐重新激活。

### Requirement: 会话前缀解析 fail closed 且不泄露

**Reason**: 前缀解析仍有必要，但归属于统一显式主会话绑定，不再服务独立 QA 建模。

**Migration**: 由 `pet-locus-collaboration` 的主会话前缀解析及标识最小披露要求接替：至少六位、支持更长前缀、只命中可用未归档主会话，无匹配与多匹配回执一致、不泄露数量或其它会话属性，前缀仅作查找输入。解析成功也不得恢复旧 qa 关联；必须走新 locus 的授权、精确寻址与创建/切换流程。
