## Baseline

本 delta 的 MODIFIED 条文完整取自前置 change `pet-unified-locus-collaboration/specs/pet-locus-collaboration/spec.md`。该 capability 尚未进入 current specs；必须先合并前置规范再应用本 delta，禁止倒序归档或将本文件误当全量 spec。

与 `pet-locus-independent-agent-inquiries` 的边界：本 change 只承接独立 child、原生问父所需的 locus 级串行 Delivery 与有限租约；不引入上下文模式字段、公共事实、answer store、inquiry outbox、continuation segment 或原生 `send_message` pair。B035 其余范围保持暂停且 fail closed。

## MODIFIED Requirements

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
