# pet-inquiry-runtime-channel Specification

## Purpose
保证 Pet 同源父子询问从接受到实际执行、持久答复及原工作续进形成可核验的生产闭环，避免工具报告成功却永久等待；同时隔离询问与待办代执行、GUI 输入及飞书回复权，并使所有者能够核对真实进度和不确定结果。

## Requirements

### Requirement: 询问接受必须有可用的端到端处理能力

系统 SHALL 在发布可执行的 `pet_inquire` 之前验证独立执行、持久答案、结果回送及身份/通信守卫均已装配。能力缺失时调用 MUST 明确返回不可用且不新增接受记录，不得承诺稍后答案。能力可用时接受响应 SHALL 只在持久提交成功后返回，并区分 accepted、已派发、已回答与结果已续进；accepted MUST NOT 被描述为目标已收到或处理完成。目标忙但有效可恢复 SHALL 允许有界排队，不以暂未驻留或忙碌冒充能力永久缺失。

#### Scenario: 半通道不得产生新等待
- **WHEN** Host 缺少独立询问执行或持久答案/结果回送能力而 caller 发起询问
- **THEN** 明确拒绝且不新建询问记录、不返回 accepted 或未来答复承诺，公共事实及名单的独立可用能力保持不变

#### Scenario: 接受写入失败
- **WHEN** 身份有效但询问持久提交失败
- **THEN** 返回失败，不派发问题，不声称已排队

### Requirement: 持久询问必须实际派发到精确目标的独立轮次

系统 SHALL 将合法接受的询问按接受顺序送到当前同源目标，使用原持久 session 和当前有效代际。目标未驻留 SHALL 按需恢复；忙碌或等待原生交互时 SHALL 等待可运行边界，不 steer、不抢占。派发前 SHALL 重新校验成员身份与代际，并保留询问与实际目标消息、执行轮次的对应证据。询问和结果轮 MUST NOT 合并 GUI 输入、其它询问或目标自身业务请求；拒绝混合执行 MUST NOT 删除或丢失其它待处理输入。系统 MUST NOT 通过普通 `send_message`、父直接代答或共享待办执行替代询问。

#### Scenario: 空闲父会话收到子询问
- **WHEN** 有效 child 向空闲 parent 发起询问且能力已通过核验
- **THEN** 父在同一持久 session 收到有 inquiry 标识、用途及适用受众的独立问题并开始询问轮，而不是仅在请求方得到 accepted

#### Scenario: 忙碌父会话与 GUI 输入
- **WHEN** 父当前正在处理任务且存在待处理 GUI 输入，子向父询问
- **THEN** 当前任务不被打断，GUI 输入保持可处理，询问仅在证明独立执行的边界启动，不吞掉输入或混用来源

#### Scenario: 父询问可冷恢复的子
- **WHEN** 父向同源有效但未驻留的 child 询问
- **THEN** 恢复同一 child 历史、模型与受限组合，独立处理问题，不创建替代 child 或继承父新的配置

### Requirement: 答案必须持久关联并续进请求方原工作

答复 SHALL 仅由被询问的真实目标对已派发的 inquiry 提交；普通 assistant final 不自动成为答案。系统 SHALL 持久保存答案及其来源、时效、确认状态，并将其作为可关联结果投递给原请求方，不接受自由接收方选择。请求方忙时 SHALL 排队，结果 MUST NOT 打断其在途工作。重复答案与重复结果 MUST NOT 引起重复续进；无答复、明确失败与未知结果 SHALL 分开诊断，不能长期伪装成可自动推进的正常等待。

#### Scenario: 子询问父后取得答案
- **WHEN** 子结束原运行轮次，父在关联询问轮提交答案
- **THEN** 答案持久化，Host 将对应结果送回原子会话并启动关联续进；父不代替子向飞书发正文

#### Scenario: 请求方忙或重复答案
- **WHEN** 答案到达时请求方正在处理另一工作，或同一答案重复提交
- **THEN** 结果等待独立可运行轮次，同一 inquiry 的结果最多推进一次，另一工作不被 steer

#### Scenario: 目标轮结束却没有提交答案
- **WHEN** 目标询问轮已经正常结束但没有显式答案或后续可证明的关联工作
- **THEN** 产生可关联的无答复失败/诊断，不从目标 final 猜答案，也不无限保留 executing 冒充正在处理

### Requirement: 询问执行和续进不得改变权限或回复归属

询问轮 SHALL 保留目标原有工具与权限上限，不新增权限。Host SHALL 在受管入口（飞书回复/finish/wait、跨 agent 通信、委派、待办执行、权限/绑定变更）拒绝询问轮调用，alias 与异步 wrapper 同样受限。本 capability MUST NOT 宣称隔离 shell/HTTP 等通用工具的内部效果，也 MUST NOT 放宽 Locus child safe composition。

结果续进 SHALL 只在原 Delivery 仍唯一有效、同 child/代际且执行可证明时恢复其回复能力；已终结的 Delivery MUST NOT 被续命或改绑。询问不修改 Delivery deadline 或待办受理策略。

#### Scenario: 询问父不能调用受管通信入口
- **WHEN** 父在子询问轮调用 Host 管理的飞书回复、普通跨 agent 消息、委派、待办请求执行或修改绑定入口
- **THEN** 在受管正文/效果入口前拒绝，异步 wrapper 不绕过检查，答案仅经关联答复返回，父原正常业务策略不被持久修改

#### Scenario: 父原有通用工具不冒充强隔离
- **WHEN** 父在询问轮使用既有策略允许的 shell/Git/查询工具查证答案
- **THEN** 这些能力保留，且产品及诊断明确受管入口限制不覆盖通用工具内部任意外发；不把模型未外发当作 OS/网络隔离证明，不向 safe child 增发此类工具

#### Scenario: 原请求失效后答案迟到
- **WHEN** 原 Delivery 已完成、取消或到期，或请求方已换代，关联答案才到达
- **THEN** 保留答案及明确诊断，不经本询问协议产生飞书出站、表情、替代 Delivery 或新代业务执行，并按结果终结要求关闭本分支、释放待处理额度

#### Scenario: 本地询问保持本地身份
- **WHEN** GUI/父本地工作发起询问并收到结果
- **THEN** 只续进精确本地工作，不取得任何受管飞书回复目标

### Requirement: 全链路继承 Host 派生的原工作与询问链

系统 SHALL 在接受时绑定原工作（DeliveryId 或持久 local workId），并在派发、答案、结果投递与续进中继承同一关联；inquiryId 标识问答分支。locusId 或 session 相同 MUST NOT 被当成同一原工作或单独授权回复；关联 SHALL 由 Host 从执行证据解析，不能由模型选择。

本地 work anchor SHALL 在原轮结束而分支未解决时保持 waiting，结果到达后续进原工作；没有原工作证明 SHALL 在接受前拒绝。询问轮或结果轮中再次 `pet_inquire` SHALL 继承当前链，拒绝访问链内已有成员，并执行深度与待处理上限。

#### Scenario: 同一 locus 的两次业务请求
- **WHEN** 同一 locus 的请求 A 已终态，请求 B 成为 current，A 的答案迟到
- **THEN** 仍按 A 的 DeliveryId 处置，不因 locusId 一致而续进 B，不获取 B 的回复权

#### Scenario: 本地 A 等答案时 B 开始
- **WHEN** 本地 A 已登记询问并结束原轮，另一本地请求 B 开始，随后 A 的答案到达
- **THEN** A 保持独立 workId，结果等待运行槽并续进仍有效的 A；A 已 settled 时只保留，不关联 B

#### Scenario: 嵌套或结果续进不能重置链
- **WHEN** A→B 的询问轮或其结果续进再次发起询问，试图访问已在链内的成员或绕过根数量限制
- **THEN** 真实注册工具按继承的 trace/budget 拒绝，不新建 local 根掩盖链路，并保持原工作关联

### Requirement: 运行槽与生命周期在途必须分别判断

询问或结果轮的执行 admission SHALL 依据真实运行槽占用及原生交互等待，不使用生命周期 busyForLocking/hasWorkInFlight 判定代替。等待答案 SHALL 释放运行槽，仍计入生命周期在途工作；解绑、重建或权限切换继续遵守既有忙时拒绝规则。每 session 仍只运行一个独立片段，不 steer 在途轮次。

#### Scenario: 父子相互等待仍能回答
- **WHEN** parent 与 child 各有未完成原工作，并相互发起不同根询问，原执行轮均已结束且无原生交互等待
- **THEN** 生产 pump 允许两边在各自空闲运行槽处理询问及结果，完成交换；等待期间生命周期仍在途，不把它当作安全重建许可

### Requirement: 永久结果处置必须原子关闭询问关联

系统 SHALL 在同一 domain 事务内提交永久 retained/refused 的结果及对应询问终结，保留答案/失败/诊断，不伪造 result-delivered。原工作终态、换代或权限明确撤销 SHALL 终结尚开放的该询问分支；执行证据不足 SHALL 保留 needs-review 或适用的未知诊断，不猜成功、不重跑。已终态 inquiry SHALL 保留原终态，所有终态 SHALL 不再占 pending budget；独立未知业务副作用仍遵循已有 unknown-terminal，不因本分支结束宣称整个工作已完成。

成功结果 claim 的 delivered 与 inquiry 进度更新 SHALL 同事务幂等，失败 inquiry 已终态时不复活。内存调度及 lifecycle 关联 SHALL 只按已提交事实释放/重建；事务失败不得提前释放，重复处置不重复续进。显式取消/finish SHALL 同步关闭相关待投分支，保持无新增外发。

#### Scenario: answered 结果因原请求失效被保留
- **WHEN** inquiry 已 answered，而原请求过期导致结果不可续进
- **THEN** 原子保留结果证据并终结 inquiry，释放本分支的待处理额度和忙关联，无模型续进、飞书消息或表情

#### Scenario: 处置事务失败或重复
- **WHEN** 结果终结事务失败，或已提交的终结事件重投
- **THEN** 失败全回滚且不先释放等待；重投幂等，不再次续进、不丢答案，重启投影与已提交状态一致

### Requirement: 重启与历史询问处置依赖精确证据

系统 SHALL 保存询问派发、答案记录、结果投递与续进的阶段及消息/轮次关联。启动恢复 SHALL 以持久行与会话证据对账：只恢复可证明未交接的合法工作；消息仍排队时不重复入箱，已执行且结果不明时标记 needs-review，不盲目再次执行。能力上线前遗留接受记录 SHALL 保留并核对参与者、原工作有效性和是否曾投递，正式首次启动不得仅凭 queued 批量自动执行旧问题；需所有者确认处置，失效请求不恢复回复权。时间经过本身不自动删除询问，原 Delivery 的有效期规则继续适用。

#### Scenario: 问题落库后尚未入箱即重启
- **WHEN** 新协议询问已持久接受且可证明尚未入目标 inbox，Host 重启
- **THEN** 能力核验及身份重验后恢复同一 inquiry 的一次派发，不重新接受成另一个问题

#### Scenario: 交接中断且无法证明消费情况
- **WHEN** 问题或结果可能已交接而持久阶段缺确认，会话证据不足
- **THEN** 标记待核查，不自动重发或重跑模型，不宣称外部 exactly-once

#### Scenario: 目标已开始作答时重启
- **WHEN** 目标已 claim 询问、尚未提交答案时 Host 重启
- **THEN** 对账将询问终结为 needs-review 并生成失败结果，启动恢复把该失败结果送回原请求方一次，使其可明确告知"未问到"；目标模型不重跑

#### Scenario: 修复前旧 accepted 记录
- **WHEN** 能力上线发现旧协议 accepted/queued 询问
- **THEN** 提供只读对账与显式处置选项，不自动执行旧问题、不删除历史，也不拿 accepted 证明已送达

### Requirement: 所有者可以核对询问进度而不混用待办台账

Locus 管理面 SHALL 从真实持久记录提供父子询问状态、创建/等待时间、派发能力、失败或待核查原因；未知快照 SHALL 明示未知，不当作空列表。面板 MUST NOT 展示问题、答案正文或凭据。询问记录 SHALL 与 `pet_locus_track` 创建的共享待办明确区分；询问不自动登记待办或触发受理，原待办执行链保持不变。

#### Scenario: 接受后可核对排队与派发
- **WHEN** 所有者查看一个有在途询问的 Locus
- **THEN** 显示真实 inquiry 标识、阶段与等待时长，派发后能区分已执行与仍排队，而不依赖模型自报

#### Scenario: 待办交接正常不等于询问正常
- **WHEN** 待办请求执行成功但询问处理能力缺失
- **THEN** 管理面分别显示两个事实，不把待办 accepted 或父开始工作计作询问答案已回送
