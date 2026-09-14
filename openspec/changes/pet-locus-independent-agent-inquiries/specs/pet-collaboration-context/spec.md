## ADDED Requirements

### Requirement: 同源协作上下文是公共能力而非文件目录

系统 SHALL 为同一主会话及其当前有效 Locus children 提供同源协作上下文，由公共工作事实、按实际挂载关系派生的协作者列表及 `pet-agent-inquiries` 的定向询问组成。公共事实 SHALL 按 Host 内持久主会话身份只维护一份，包含项目/工作说明、已有资料引用和已确认共同约束；MUST NOT 在每个 Locus 上复制一份成为新的权威数据。

本能力 SHALL 复用 Pet 持久化与 Locus 正反向索引，MUST NOT 为公共上下文创建工作文件夹、复用 Skill store、复制文档正文或新建向量/内容知识库。主会话是工作归属，不是公共事实必须经模型转述的存储位置。各 agent SHALL 保留独立历史、任务、权限及回复关联。

#### Scenario: 两个 child 共用一份公共事实
- **WHEN** 主会话 M 下 A、B 查询共同项目说明
- **THEN** 二者读取 M 对应的同一公共记录及修订号，而非各 Locus 的独立复制品；过程不调用 M 的模型

#### Scenario: 公共资料引用不复制内容
- **WHEN** 所有者登记仓库文档路径或飞书资料链接
- **THEN** 公共记录保存引用与来源信息，不创建公共文件夹或自动下载/复制正文

### Requirement: 公共事实由同源 agent 自主更新并版本化留痕

公共事实是同源协作范围内的共享工作笔记，不是对外公开内容，也不授予任何能力。系统 SHALL 允许该主会话当前有效范围内的 agent（主会话与有效 Locus child）在处理完自身工作后自行判断并提交新修订，MUST NOT 要求逐条人工确认，也 MUST NOT 以 Locus 读写权限作为公共事实写入门槛——公共事实不改变文件、外呼、凭据或沙箱边界。

写入授权 SHALL 仅取决于 Host 从实际 caller 派生的当前范围成员资格，与 `pet-locus-collaboration` 的发现范围一致；圈外会话、普通临时 subagent、已退役 child 及失效主会话 SHALL 被拒绝。模型 MUST NOT 指定另一个主会话作为写入目标。

每条修订 SHALL 记录单调修订号、写入者身份（主会话或具体 Locus child 及其代际）、写入时间和来源说明，更新和撤回使用预期修订的条件提交，避免并发覆盖；字段可为空或未知，未填写 MUST NOT 冒充已确认事实。历史修订 SHALL 保留，供后续纠正与 owner 审计；agent 默认仅查询当前有效修订。

自动提升 SHALL 仍被禁止：局部锚点、父对话、询问答案与模型总结 MUST NOT 在没有 agent 明确提交的情况下成为公共内容。

#### Scenario: 并发更新不覆盖
- **WHEN** 两个同源 agent 以同一旧修订提交不同公共事实
- **THEN** 仅首个条件提交成功，另一请求得到版本冲突并需重读当前修订后重试，不静默覆盖

#### Scenario: 询问答案不自动成为公共事实
- **WHEN** B 向 A 回答了一项设计建议
- **THEN** 答案留在对应询问和参与者历史；只有某个同源 agent 明确提交后才出现新的公共修订

#### Scenario: 圈外请求写公共记录
- **WHEN** 另一主会话树的会话、普通临时 subagent 或已退役 child 尝试写公共记录
- **THEN** Host 拒绝，不因掌握记录标识、处在同 workspace 或具备群 allowlist 资格而放行

#### Scenario: 写入留痕可追溯
- **WHEN** child A 更新了共同约束
- **THEN** 该修订记录 A 的身份、代际与时间，其他成员读取当前修订时可见来源，历史修订保留可供纠正

### Requirement: 公共事实按实际 caller 动态查询且撤回不伪称抹除记忆

系统 SHALL 提供 scoped 的按需公共上下文查询，Host 从实际 session 解析主会话身份或 child 当前唯一有效 Locus 的 parentSessionId，不接受模型指定另一 parent/context。返回 SHALL 包括公共记录身份、当前修订、写入来源、有效内容及未知状态，与协作者列表使用同一关系范围。

首次加载、冷恢复、原生 GUI 加载及旧 fork child 获得能力时 SHALL 使用当前记录，不从首次挂载时的副本恢复公共事实。更新后下一次查询 SHALL 取得最新完整修订；MUST NOT 自动广播、唤醒模型或把全文反复注入各 agent。字段清空或撤回 SHALL 使后续查询不再提供旧值，不回退旧副本；系统 MUST NOT 宣称已从 agent 历史或已经发送的消息中删除过去读到的内容。

#### Scenario: 更新后读取同一新版本
- **WHEN** A 曾读到修订 r1，某同源 agent 提交 r2，A 和 B 再次查询
- **THEN** 二者取得完整 r2，不需要重新挂载或唤醒父会话；A 的历史仍可含 r1，但不把它标为当前权威

#### Scenario: 撤回后不回退旧值
- **WHEN** 某同源 agent 撤回某资料引用，child 查询或冷恢复后查询
- **THEN** 当前结果不再包含该引用，不从旧 Locus 字段自动补回；说明历史中的旧值不再是当前公共事实，不声称记忆已擦除

#### Scenario: 圈外或退役 child 查询
- **WHEN** 另一主会话树、普通临时 subagent 或已退役 child 请求公共上下文
- **THEN** Host 拒绝，不因掌握 context 标识或处在同 workspace 放行

### Requirement: 公共上下文随主会话归属持续且挂载不复制

主会话在无 Locus 时 SHALL 可正常工作，不强制公共配置或预先建文件目录。首个有效挂载 SHALL 幂等确保一份空公共记录，内容未确认标未知，不扫描父历史。并发首个挂载只能产生一份记录；未发布/失败的关联 MUST NOT 使 child 获得访问权，残留空记录不构成成员授权。已有统一 Locus 升级时 SHALL 幂等确保空记录，不自动归并局部锚点。

后续有效 child SHALL 通过固定 parent 关系访问同一记录。最后一个 child 退出 SHALL 保留公共事实；仍有效且已建立过公共上下文的主会话 SHALL 可查询/管理该公共上下文，协作者列表为空，不因此创造可询问成员。主会话失效时 SHALL 拒绝 agent 查询与写入并保留历史修订，不自动绑定到另一个主会话。

同 parent 的 child 重建 SHALL 继续引用该公共记录，不复制旧 child 历史或继承 write。入口切换到另一 parent 后 SHALL 改用目标 parent 的公共记录，不迁移原公共内容；既有话题固定 parent 的语义不变。

#### Scenario: 挂载与退出后重新挂载
- **WHEN** M 的 A、B 先后加入再全部退出，随后 C 加入 M
- **THEN** 使用同一公共记录；无 child 期间 M 可读取公共事实且列表为空，C 加入后取得当前修订而非旧 child 历史

#### Scenario: 来源切换不迁移公共内容
- **WHEN** 群当前入口从 M 切换到 N，而已有话题仍固定 M
- **THEN** 新群 child 查询 N 的公共记录，旧话题查询 M 的公共记录，M 的内容不复制到 N

### Requirement: 公共事实与 Locus 局部上下文及权限分别表达

公共记录 SHALL 提供同源工作事实；`pet_context` SHALL 继续提供当前 Locus 的局部锚点、实际执行根与核验结果、权限及当前请求事实。返回 MUST NOT 通过同名字段静默合并或让公共值覆盖局部执行事实。共同约束与局部约束 SHALL 分别带来源呈现；发生影响当前任务的矛盾时 SHALL 明示冲突并请求 owner 澄清，不猜优先级或自动修改任一层。权限和出站目标始终以 Host 的当前 Locus/Delivery 核验为准，文本约束不得替代它们。

公共资料引用只表示可发现，MUST NOT 自动授予外部凭据、资源读取、文件写入、跨群披露或路径切换权限。需要时 agent SHALL 通过既有受授权读取能力访问资料；失败如实说明。公共查询不自动取得文件正文、不成为任意 URL 代理。公共事实更新不改变运行中任务的目录、模型或沙箱策略。

#### Scenario: 公共资料可知但不可读
- **WHEN** 公共记录含某文档链接而当前 agent 没有访问权限
- **THEN** 可见引用但正文读取被既有授权层拒绝，不借用主会话或其它 child 的凭据代读

#### Scenario: 共同与局部约束冲突
- **WHEN** 公共约束与当前 Locus 已确认局部约束矛盾并影响操作
- **THEN** 展示两个来源并请求澄清，不 silently override，也不改变实际执行根或权限

#### Scenario: 局部记录不自动共享
- **WHEN** 升级前多个 Locus 各自已有 projectResources 和 constraints
- **THEN** 原局部内容保留在各自范围，不自动合并到公共记录；某个同源 agent 明确提交后公共层才出现对应事实
