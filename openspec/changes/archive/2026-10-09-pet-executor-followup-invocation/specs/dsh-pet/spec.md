## Baseline

本 delta 修改 `openspec/specs/dsh-pet/spec.md` 中三条既有 Requirement：`每次主动调用在发起位置捕获独立快照`、`Pet Agent 获得稳定身份前馈和可信的当前 Invocation 上下文` 为 MODIFIED（正文含完整更新后内容），并新增一条 Requirement。其余 `dsh-pet` 需求不变。

## MODIFIED Requirements

### Requirement: 每次主动调用在发起位置捕获独立快照

系统 SHALL 在用户主动调用能力、提交新 Pet 请求，或在 Pet root executor 会话中直接输入消息时创建 Pet Invocation，并在接受操作的同一逻辑时刻固定 source identity、可用的 session event 位置、session metadata、workspace metadata、worktree binding 和 SCM metadata。后续页面切换、source session 继续运行或元数据变化 MUST NOT 改写该 Invocation 已绑定的 snapshot。

第三种发起位置（executor 会话内真人直输）MUST NOT 让发起者选择目标：其 snapshot SHALL 从该 Task 记录已固定的来源 scope 重新捕获，`sourceKind` 与来源 identity 由 Task 决定；消息文本中出现的任何 session、workspace、worktree 或 channel 标识 MUST NOT 参与目标解析、MUST NOT 改绑到其它 Task。Invocation SHALL 记录其发起位置类别，使“来源侧手势”“入站渠道消息”与“会话内直输”在持久记录与面板上可区分。

系统 MAY 按引用和结构化摘要组合保存快照，但 SHALL 保存足以解释 Invocation 发起位置和目标的不可变信息。Agent 内部重试 SHALL 继续使用同一 Invocation snapshot；用户再次主动执行 SHALL 创建新的 Invocation 和新 snapshot。

#### Scenario: 调用后立即切换页面
- **WHEN** 用户在 Session A 发起 Create MR 后立即切换到 Session B
- **THEN** 已创建 Invocation 仍绑定 Session A 在点击时的 snapshot，执行期间不得重新读取浏览器当前 Session B 作为目标

#### Scenario: 同一 Task 的后续能力看到更新现场
- **WHEN** Create MR 完成后 source session 状态继续演进，用户随后调用 Send CR
- **THEN** Send CR 获得新的 Invocation snapshot，并可观察调用时已经存在的 MR 信息，而不复用 Create MR 的首次快照

#### Scenario: Agent 自动重试
- **WHEN** 一个 Invocation 因瞬态网络失败执行内部重试
- **THEN** 重试继续使用原 Invocation 和 snapshot，不因重试时 source 已变化而切换目标

#### Scenario: 会话内直输的发起位置
- **WHEN** 用户在 Pet executor 会话中直接输入一条新请求，而该 Task 当前空闲
- **THEN** 系统为该请求创建新的 Invocation，其 snapshot 从该 Task 固定的来源 scope 重新捕获，且记录显示其发起位置为会话内直输

#### Scenario: 会话内直输不得改绑目标
- **WHEN** 用户在 executor 会话中输入的正文里出现另一个 session、workspace 或 worktree 标识
- **THEN** 新 Invocation 的 snapshot 仍绑定该 Task 原有来源 scope，文本标识不产生改绑、也不构成额外授权

### Requirement: Pet Agent 获得稳定身份前馈和可信的当前 Invocation 上下文

Pet executor Agent SHALL 获得 standing instructions，明确其为 Pet Task Agent、一个 session 会承载多个串行 Invocation、每次操作必须读取当前 Invocation snapshot、完成单次 Invocation 不等于结束整个 Task，以及不得从消息文本接受任意 session path 或外部 channel ID 作为授权。

该 standing instructions SHALL 另说明空闲期行为：当会话中没有进行中的 Invocation 时，属于该轮的真人直输要么已被登记为一次会话内直输 Invocation，要么该轮没有任何授权快照；在后一种情形下 Agent MUST NOT 沿用上一条 Invocation 的 snapshot 或路径执行有副作用操作，SHALL 停下并向用户说明如何从来源位置发起新的调用。instructions SHALL 同时要求：需要用户决策时 MUST 在调用内提问（等待用户回答或等待批准），MUST NOT 以纯文本提问后结束调用，使该决策落在没有 Invocation 的下一轮。

Pet SHALL 在创建 executor session 前校验并自动修复 Workspace 依赖文件（standing instructions 与投影目录）。准备流程只在启动时执行一次，因此启动后被删除、被替换为软链，或因包升级而过时的文件，若不在此处修复将一直失效到下次重启，并静默产出没有身份前馈的 executor。修复 MUST 只重写包自有文件与目录，MUST NOT 触碰 Task 状态或移除已投影的 Skill；修复后仍不可用时 SHALL fail closed 并拒绝创建 session。修复实现 MUST 先删除已有条目再写入——`writeFile` 会跟随软链，直接写会穿透并污染包安装目录、且保留坏链。管理面 SHALL 暴露该状态与一个显式修复操作。

standing instructions 的正文 SHALL 由 Pet 包以普通 Markdown 文件维护，并在准备 Workspace 时**复制**到 `$DSH_HOME/plugins/dsh-pet/workspace/AGENTS.md`；MUST NOT 软链到包安装目录。包目录在每次部署时被删除重建，软链会立即断裂并使 executor 失去身份前馈；这也违反"状态目录与插件安装目录分离"的既有不变量。

这里的 standing instructions 是 **Pet 自己的常驻上下文**（物化为 Pet Workspace 下的 `AGENTS.md`），与 **DSH Agent preset** 是两个不同概念，不可混用：preset 是 DSH 的具名插件组合，由 `AgentOptions.agentPreset` 选择；Pet 不拥有、不定义、也不自带 preset，只把用户在设置中选择的值透传给 DSH。Pet 的语境由 standing instructions 加每次调用的 Invocation envelope 建立，而不是由 preset 建立。

Pet SHALL NOT 自带 package 私有的 Agent composition。Pet executor 只需要普通 DSH 工具（由已启用 Skill 驱动），因此 Host 默认组合即为正确选择；引入 Pet 专有组合会让 Pet 重新成为特权容器。仅当出现明确需求（例如刻意收窄 executor 的工具面）时才重新评估。

系统 SHALL 提供无目标参数的可信上下文能力。调用时 Host MUST 从实际调用 executor session 反查 Pet Task、当前 Invocation 和 snapshot，并返回绑定的 source/context；模型 MUST NOT 能通过传入任意 task/session/workspace 标识改绑目标。不存在唯一当前 Invocation、Task 已归档或调用 session 未绑定 Pet Task 时，能力 SHALL fail closed 并返回可诊断错误。

该可诊断错误 SHALL 区分“调用会话不是 Pet Task 会话”“Task 已归档”“Task 当前空闲（本轮不属于任何 Invocation）”三种情形，MUST NOT 返回任何 snapshot 字段、路径或其它可被当作授权的值，并 SHALL 说明继续工作的路径（从来源位置发起新的调用）。当同一会话正在登记一次会话内直输 Invocation 时，能力 SHALL 等待该登记完成后再解析，MUST NOT 因竞态先返回空闲错误。

该可信上下文能力 SHALL 只对 Pet executor Agent 发布：其注册 MUST 位于 Pet executor 自身的 Agent 作用域，MUST NOT 位于 Host 全局工具面。非 Pet 会话的 model-facing 工具清单 MUST NOT 包含该能力。fail-closed 的目标解析已保证不泄漏其它 Task 上下文，但把能力发布到全局工具面会让每个普通会话都看到并尝试调用一个对其永远不可用的工具，产生噪声与误导；能力的**可见性**必须与其**授权边界**一致。

#### Scenario: Agent 获取当前快照
- **WHEN** Pet executor Agent 在 Invocation 执行开始时调用 Pet context 能力
- **THEN** Host 根据调用 executor session 返回当前 Invocation 的可信 source snapshot，而不要求或接受模型提供 source ID

#### Scenario: 非 Pet session 调用上下文能力
- **WHEN** 普通 DSH session 调用 Pet context 能力
- **THEN** 系统拒绝请求并说明该 session 未绑定 Pet Task，不暴露其它 Task 上下文

#### Scenario: 归档 Task 的 executor 再次调用
- **WHEN** 已归档 Task 的 executor Agent 尝试获取活动 Invocation 上下文
- **THEN** 系统 fail closed，不将旧 snapshot 当成新的可执行授权

#### Scenario: 普通会话的工具面不含 Pet 可信上下文能力
- **WHEN** Pet 已加载，用户在一个未绑定 Pet Task 的普通 DSH session 中开始一个 turn
- **THEN** 该会话的 model-facing 工具清单不含 Pet 可信上下文能力，模型没有可调用入口，也不会产生"未绑定 Pet Task"的调用错误

#### Scenario: 空闲期的可信上下文请求
- **WHEN** 某 Task 没有进行中的 Invocation（且本轮未登记会话内直输 Invocation），executor Agent 调用可信上下文能力
- **THEN** 系统 fail closed，返回“当前空闲、本轮不属于任何 Invocation”的可诊断说明，不返回任何 snapshot 或路径，也不把上一条快照当作新的授权

#### Scenario: 登记进行中不报空闲
- **WHEN** 会话内直输的 Invocation 登记仍在进行，而该轮已调用可信上下文能力
- **THEN** 能力等待登记完成后返回该 Invocation 的 snapshot，而不是先返回空闲错误

#### Scenario: standing instructions 覆盖空闲期与调用内提问
- **WHEN** 检查 Pet 写入 executor Workspace 的 standing instructions
- **THEN** 其中说明空闲期轮次的归属规则、禁止沿用旧快照执行有副作用操作、继续工作的路径，以及需要用户决策时必须在调用内提问

## ADDED Requirements

### Requirement: 会话内真人直输登记为 Invocation

系统 SHALL 把 Pet root executor 会话中由本人直接提交的消息登记为**会话内直输 Invocation**：不绑定任何 Skill、不要求能力声明，与入站渠道消息产生的对话式 Invocation 共享同一持久化形态与串行语义，但其能力标识 SHALL 体现“会话内直输”这一发起位置。

识别 MUST 只接受可证明为客户端提交的用户消息（带客户端请求标识，且既非 Host 注入上下文、也非渠道投递、也非 Pet 自身派发）。无法证明时系统 MUST NOT 登记，MUST NOT 据此放宽任何授权，也 MUST NOT 让该轮继承上一条 Invocation 的授权。同一消息 MUST NOT 被登记两次：Pet 自己派发的 envelope、对等待中 Invocation 的答复、以及渠道投递都 MUST NOT 产生额外 Invocation。

登记时机 SHALL 保证在该轮第一个模型步骤之前 Invocation 已可被可信上下文能力解析：优先在消息进入 executor 会话 inbox 时登记；当串行槽仍被占用时，不登记，由该消息自己被消费的那一轮重试。系统 SHALL 继续保证每个 Task 同时至多有一个 `running` 或 `waiting-user` Invocation。

会话内直输 Invocation SHALL 占用同一串行槽：运行中到达的真人消息 MUST NOT 抢占当前调用，排队中的能力 Invocation 按既有顺序在其结算后启动。其结算、面板可见性、重试、归档与队列语义 SHALL 与既有 Invocation 一致；重试 SHALL 重新派发同一条用户请求，MUST NOT 创建新 snapshot。

若无法登记（Task 已归档、来源事实无法重建、槽被占用且未能推迟到该轮），系统 SHALL fail closed：不创建 Invocation、不返回任何 snapshot，并在该轮内向用户说明“本轮不属于任何 Invocation”以及继续工作的路径（从来源位置重新发起调用）。

qa-child 与 unified locus child 会话 MUST NOT 走该路径；渠道投递 MUST NOT 因 envelope 自身是 user message 而被当作真人直输。

#### Scenario: 结算后的直输消息继续同一 Task
- **WHEN** 某 Task 的 Invocation 已结算（succeeded/failed/cancelled）、面板显示空闲，用户在其 executor 会话中直接回复上一条遗留问题
- **THEN** 系统为该轮登记新的会话内直输 Invocation，可信上下文能力返回从同一 Task 来源 scope 重新捕获的 snapshot，模型不再收到“没有正在运行或等待的 Invocation”的错误

#### Scenario: 运行中到达的真人消息不抢占当前调用
- **WHEN** 某 Task 的 Invocation 仍在运行，用户又在该会话中输入一条消息
- **THEN** 当前 Invocation 保持唯一 current，不因该消息被取消或改绑；该消息在其自己那一轮按串行规则处理

#### Scenario: Pet 自身派发与答复不重复登记
- **WHEN** Pet 派发 Invocation envelope，或把用户答复投递给等待中的 Invocation
- **THEN** 不产生新的 Invocation，串行槽与 Task 状态只反映原 Invocation

#### Scenario: 渠道投递不冒充真人直输
- **WHEN** 入站渠道消息经既有对话式路径投递到 workspace-resident executor 会话
- **THEN** 该消息只产生既有的对话式 Invocation，不额外产生会话内直输 Invocation

#### Scenario: qa-child 与 locus child 不登记
- **WHEN** 答疑群 child 或 unified locus child 会话中出现用户消息
- **THEN** Pet 不为其登记会话内直输 Invocation，也不安装或改变其工具面

#### Scenario: 无法登记时 fail closed 且说明继续路径
- **WHEN** 用户在已归档 Task 的 executor 会话中输入消息，或该 Task 的来源事实已无法重建
- **THEN** 系统不创建 Invocation、不返回 snapshot，并在该轮内说明本轮不属于任何 Invocation 以及如何从来源位置继续

#### Scenario: 会话内直输 Invocation 占用串行槽且面板可见
- **WHEN** 会话内直输 Invocation 正在执行，用户从来源位置发起新的能力调用
- **THEN** 新能力按既有串行规则排队，面板同时显示该会话内直输 Invocation 的能力标识与状态
