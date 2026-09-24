## ADDED Requirements

### Requirement: 独立 Locus 上下文显式替代新子会话的父前缀继承

在前置 `pet-unified-locus-collaboration` 已生效的基础上，系统 SHALL 对新建及所有者显式重建的统一 Locus child 使用 `pet-locus-collaboration` 的独立上下文模式。本条 SHALL 明确替代 `Pet Agent 获得稳定身份前馈和可信的当前 Invocation 上下文` 中“子会话继承主会话已完成可用前缀”的新 child 行为；既有 fork Locus 保留原历史模式，旧 QA/chat 绑定的退役隔离不变。

`Pet executor 的作用域组合在每次加载时存在` 中的 child“继承组合” SHALL 解释为经 DSH 官方接缝获得并持久恢复必要的工具、Skill、模型与工作归属配置，MUST NOT 被解释为必须复制父 transcript。新独立 child SHALL 在首次执行前和每次恢复时具备经核验的组合、caller-bound `pet_context` 与协作能力；不能只填 preset 名字而不装配。Pet MUST NOT 为移除父历史而换成普通轮盘 root executor、施加 Pet root allowlist、替换主会话组合或继承父 write；不得因 spawn 默认值静默改变原定模型或工作目录。

上述规则 SHALL 保留普通轮盘 Task/Invocation/Snapshot、专用 Workspace、standing instructions、Skill allowlist 及 root executor 加载保障。`pet_context` 对主会话仍不因父身份自动开放；主会话获得的是同源公共事实查询、协作者列表与询问能力，而非 child 的 Delivery 回复权限。公共事实复用 Pet 持久化基础设施，不创建公共文件夹，不借用普通轮盘 Workspace 或闲置 Skill store。

#### Scenario: 新 child 无父历史但组合完整
- **WHEN** 从拥有完整工具和 Skill 的主会话建立独立 Locus child
- **THEN** child 没有父对话前缀，却具备经过核验的必要组合和自己的 scoped context，模型与目录选择明确，文件策略为 read

#### Scenario: 普通轮盘不回归
- **WHEN** 用户执行普通 Pet Skill 或恢复其 root executor
- **THEN** 原 Invocation/Snapshot、Skill allowlist 与 scoped 安装流程保持不变，不进入协作者询问队列模型

#### Scenario: 主会话没有 child 回复权
- **WHEN** 有效 Locus 主会话使用协作者名单或收到询问
- **THEN** 可处理本地关联询问，但不因父身份获得 `pet_context` 的 child Delivery 分支或任何飞书出站目标

### Requirement: 主子会话协作工具与可信上下文按能力分别装配

`Pet executor 的作用域组合在每次加载时存在` 中普通主会话与一般子代理不获得 Pet 工具的限制 SHALL 对 `pet-agent-inquiries` 定义的协作能力形成窄例外：有效主会话与有效 Locus child 可获得 scoped 公共事实查询、协作者列表和询问工具，但主会话不因此成为 Pet root executor，也不获得 child 的 `pet_context`。一般非 Locus 子代理与无关会话仍 MUST NOT 获得该协作能力。

系统 SHALL 在首次关联、已加载主会话新增关联、child 首轮、Pet 恢复和原生加载时幂等装配，并在调用和派发时重验有效身份。Pet MUST NOT 通过 global 注册、重复 mount preset 或固定 prompt 名单实现发现。最后一个有效 Locus 退出后，已建立公共记录且仍有效的主会话 SHALL 保留 `pet-collaboration-context` 公共读取能力，协作者列表为空、不可向已退出成员询问；旧工具残留不得授予 child 或圈外会话权限。公共记录及其 owner 审计历史不随最后一次退出删除，主会话失效时 agent 查询仍须拒绝。发现或询问组件失败 SHALL 独立诊断，不阻塞普通 DSH 工作台；不能满足独立 child 必需能力时不得将新 child 发布为可完整服务。

#### Scenario: 首次关联不启动父模型
- **WHEN** 已加载普通主会话取得首个有效 Locus
- **THEN** 在后续模型工具快照前具备协作说明与工具，而不为刷新名单自动创建推理 turn，不改变其 preset 或 Skill

#### Scenario: 冷恢复与原生加载一致
- **WHEN** 有效主/子会话由 Pet 或 DSH 原生路径重新加载
- **THEN** 协作工具在使用前按实际作用域重装并幂等，名单由持久关系重新推导，不靠旧 Agent 内存

#### Scenario: 失效后残留工具拒绝
- **WHEN** 一次有效安装后 Locus 已退出，模型仍尝试通过旧工具引用发送询问
- **THEN** Host 重新校验并拒绝，不把工具曾经可见当成当前授权
