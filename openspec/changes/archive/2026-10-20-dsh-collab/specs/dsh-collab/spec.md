## Purpose

为同一 DSH profile 内不同 workspace 的已有普通会话提供由宿主担保身份的协作入口，将独立协作内核接入会话工具、持久台账与定向唤醒，同时保留原会话的权限、组合和生命周期边界，不以派生子会话或不可信的人类确认替代真实接入。

## ADDED Requirements

### Requirement: 调用身份来自实际执行会话

协作工具 SHALL 从宿主工具执行上下文推导调用会话，以 channel `dsh-session` 与完整 session ID 构造 agent principal。参数 MUST NOT 接受 actor、principal、providerId 或调用者 sessionId；无真实执行会话或不在宿主显式许可名单时 MUST 拒绝且不读写协作数据。许可名单只能由宿主配置提供，默认空，agent工具不能添加或更改；重复/空ID配置须拒绝；暂不可观察的完整ID保持未可接入，不按标题或路径扩权。工具不会授予额外文件权限，也不会改变 preset、cwd 或会话派生关系。

#### Scenario: 跨 workspace 调用仍归属实际会话
- **GIVEN** workspace A/B 的已有普通会话 A/B
- **WHEN** B 调用协作写工具
- **THEN** 事件 actor 对应 B 的成员绑定，不可能归属于 A；B 的 cwd、preset 与父子关系不变

#### Scenario: 参数伪造身份被拒绝
- **WHEN** 工具参数包含 actor、principal 或调用者 sessionId
- **THEN** 参数校验拒绝，内核未收到命令，日志无新增

#### Scenario: 无调用会话不能访问
- **WHEN** 从缺少执行 agent 的上下文调用协作读取或写入
- **THEN** 返回 `COLLAB_CALLER_UNAVAILABLE`，不返回空间存在性或数据

### Requirement: 发现与绑定只使用精确普通会话身份

发现接口 SHALL 仅返回同一 Host 许可名单中、可观察会话的完整 ID 与cwd、可用的已驻留标题（允许缺省）；冷发现只读元数据，不为补标题读取日志正文，不返回会话消息。邀请 SHALL 使用完整 ID，MUST NOT 按前缀、标题或路径猜测目标。provider SHALL 只认领名单内、宿主能验证存在且普通会话入口不拒绝的agent地址；human、名单外、不可核验目标及官方所有权限制的派生会话 MUST 不被认领。不创建目标、不依赖Pet或团队私有索引。名单表示人的明确许可，不宣称已自动排除所有受其它产品管理的一级会话；已知subagent origin/非零delegationDepth仍须拒绝。

#### Scenario: 名单外会话不可访问
- **GIVEN** C是同Host有效普通会话但不在许可名单
- **WHEN** C调用协作工具，或A发现/邀请C
- **THEN** C调用被拒且不泄露台账，A发现结果不含C、邀请不认领；agent不能通过工具修改名单

#### Scenario: 冷会话被发现但不激活
- **GIVEN** 已持久化、当前未加载的普通会话
- **WHEN** 调用发现接口
- **THEN** 返回完整ID和必要元数据，不加载 agent、不入队消息、不读取正文

#### Scenario: 短前缀不能邀请
- **GIVEN** 两个会话 ID 有相同前缀
- **WHEN** Leader 用短前缀邀请
- **THEN** 返回地址未认领，成员和投递意图均不新增

#### Scenario: 不认领人或受管子代理
- **WHEN** 尝试认领 human 地址、不存在ID或官方标记受管subagent的ID
- **THEN** provider返回不认领，不创建会话或绕过宿主所有权错误

### Requirement: 具名工具忠实适配内核

插件 SHALL 提供对应具名内核方法的工具：除 confirmDecision、resetBreaker 外的15个写命令和4个授权读方法，另提供会话发现工具。写命令 SHALL 要求非空 cmdId，创建地址固定为实际调用会话，邀请只接受 agent。MUST NOT 暴露内核实例、任意事件写入、字符串execute分发、内部重置或人类确认工具；错误码和CAS/幂等语义 SHALL 保留；工具错误SHALL保留业务字段和锁instanceId/pid，但不得返回绝对台账路径、原始锁文本、stack或其它本机诊断；完整诊断仅属受信宿主维护面。读取不保存已读游标，不自动ack/join。

#### Scenario: 创建邀请加入与协商闭环
- **WHEN** A创建、邀请B，B自行join，A创建条目且B确认指定revision
- **THEN** 两会话读取同一台账，actor、revision、ack和状态由内核规则决定；邀请本身不授予B读取权

#### Scenario: 相同命令结果未知后重试
- **WHEN** 同一调用会话用相同cmdId和参数重试成功命令
- **THEN** 返回原结果，不产生第二个业务事件或第二次唤醒

#### Scenario: 内部与人类能力不出现在工具面
- **WHEN** 从真实agent工具schema枚举协作工具
- **THEN** 恰好20个具名工具，没有confirm、reset、事件追加或通用execute入口

### Requirement: 投递只传协作指针并使用下一回合语义

普通唤醒 SHALL 只包含内核白名单指针及固定来源说明，不携带条目/消息正文、标题或其它workspace文件。来源 SHALL 明确为插件协作数据而非用户/系统授权。运行中会话通过官方followup进入下一回合；空闲会话可开始新回合。provider成功 SHALL 只表示宿主接受入队，不宣称模型已处理、完成工作或取得用户同意。MUST NOT 用steer打断当前回合或等待模型完成才返回。

#### Scenario: 运行中目标下一回合收到
- **GIVEN** B当前回合被可控模型端点挂起
- **WHEN** A触发B的普通唤醒
- **THEN** 指针不会出现在B当前回合输入，当前回合结束后恰在下一回合输入出现一次，投递无需等待B完成

#### Scenario: 空闲目标收到带来源指针
- **WHEN** 向空闲B投递
- **THEN** B新回合收到插件来源和精确指针；消息没有业务标题/正文，也不冒充用户授权

#### Scenario: 邀请指针不能读取空间
- **WHEN** invited B收到带invited:true的指针并在join前读取
- **THEN** 内核拒绝读取；provider不替B自动join或ack

### Requirement: 冷恢复与presence不伪造可达性

冷投递 SHALL 经官方普通会话恢复入口，使用当前持久化preset投影并实际装配工具，不直接调用低层resume或仅填meta；无历史preset记录时沿用官方默认而不宣称还原历史版本。presence SHALL 不激活冷会话；明确归档或不在许可名单为unreachable，缺少枚举记录/后端不可用/损坏等无法证明的情况为unknown，不能据此markGone。unknown不授予投递权：deliver须重新精确核验名单、目标身份和归档状态，恢复后再核验目标ID与关闭状态。冷恢复可无限等待，MUST NOT 超时判失败或自动重发；关闭后晚返回 MUST 不再followup。

#### Scenario: 冷恢复保留真实工具装配
- **GIVEN** B持久化后从Host卸载，preset含可观察哨兵工具
- **WHEN** 向B投递
- **THEN** B以原完整ID及当前preset投影恢复，真实request/header包含哨兵工具；原sandbox/approval/worktree限制实际仍拒绝越界文件操作，不被发送者或插件放宽，未产生新会话

#### Scenario: presence不触发恢复
- **WHEN** 对冷会话采样presence
- **THEN** 不调用恢复或入队；无法证明在线时返回unknown而非假reachable

#### Scenario: 枚举缺失不能证明删除
- **GIVEN** persistence缺失或枚举略过损坏header，未列出B
- **WHEN** 采样presence或尝试投递
- **THEN** presence为unknown且成员身份不变；deliver精确核验失败则拒绝，不错误创建/恢复另一个ID或向未核验目标发消息

#### Scenario: 关闭时未结束恢复不晚发
- **GIVEN** 冷恢复尚未返回
- **WHEN** provider关闭后恢复返回
- **THEN** 不调用followup，不追加成功完成记录，不重新投递

### Requirement: profile共享台账与生命周期封禁

台账 SHALL 位于活动DSH profile归属的持久状态目录，与workspace和插件部署副本分离；服务身份 SHALL 在该profile内重启稳定。启动 SHALL 重放已有空间但不重投未完成意图。wrapper SHALL 在接纳create/open时即跟踪spaceId，dispose先同步关闭工具/provider准入，再关闭全部已接纳空间，等待在途存储而不等待无限期claim/恢复/投递。关闭后的旧命令或回调 MUST 不跨生命周期写入或发送。

#### Scenario: 两workspace共享并重启重放
- **WHEN** A/B跨workspace写入后重启隔离Host
- **THEN** 空间、成员、收据和serviceId不变，未知投递只列pending，没有自动重发

#### Scenario: 待认领创建也受dispose保护
- **GIVEN** 创建停在provider claim，空间尚未open
- **WHEN** dispose完成后claim返回
- **THEN** 旧创建拒绝，无日志新建或新锁，不阻塞dispose等待外部SPI

#### Scenario: 存储失败不假成功
- **WHEN** 已接纳提交写入或fsync失败
- **THEN** 返回内核存储错误，后续操作不绕过failed状态；close/open后同cmdId按收据确定结果

### Requirement: 残留锁只在死亡证明后解除

启动 SHALL 不自动解除已有锁；锁冲突 SHALL 显式报告空间与锁身份且不阻止其他未锁空间被使用。恢复只允许受信宿主维护流程在停止该数据目录的其他Host启动/写入后，验证本机旧pid已不存在并再次匹配精确instanceId，再调用breakLock。pid存活、EPERM、pid重用或未知、坏锁内容、身份变化 MUST 保留锁。agent工具 MUST 不提供解锁或强制接管。

#### Scenario: 强退锁被保留直到受信恢复
- **WHEN** 隔离Host被强退后另一个Host打开该空间
- **THEN** 报锁冲突且不自动删除；受信维护在证明旧进程已消失且ID相符后才可恢复日志

#### Scenario: 活进程或未知身份不能解锁
- **WHEN** pid存在、检查权限不足或锁实例ID改变
- **THEN** 恢复拒绝且锁原字节不变，不调用breakLock

#### Scenario: 一个被锁空间不吞掉其他空间
- **WHEN** 启动发现s1锁冲突而s2可正常打开
- **THEN** s1操作显式报告锁错误，s2仍可使用，不把s1伪装不存在或新建空空间

### Requirement: 无人类通道时明确能力缺口

本期session provider SHALL 只绑定agent且不支持confirm；工具 MUST NOT 构造provider人类principal、虚拟人类成员或自动确认。agent-only空间请求决定 SHALL 保留内核COLLAB_NO_DECIDER；已有合法active人类但无可确认绑定的历史状态 SHALL 保留内核awaitingChannel状态，不能宣称已得到人类决定。

#### Scenario: agent-only请求决定明确拒绝
- **WHEN** 仅有agent的空间调用requestDecision
- **THEN** 返回COLLAB_NO_DECIDER且不留下决策请求或假人类成员

#### Scenario: 历史无确认能力保留等待
- **GIVEN** 合法历史空间含active人类但所有决定人confirm能力为false
- **WHEN** 合法成员发起决策请求
- **THEN** 请求保持open且awaitingChannel:true，无确认投递或decided事件

### Requirement: 产物内联当前源码并携带约定资源

插件 SHALL 是独立社区bundle，内联当前collab-kernel源码；部署后不依赖workspace目录或内核lib。构建输入 SHALL 包含内核src目录、package.json以及实际使用配置。约定Markdown SHALL 在最终bundle的实际读取位置可用且与内核版本/摘要一致。测试 MUST 在仓库源码不可达的复制产物上加载插件，不能只断言打包命令成功。

#### Scenario: 源码变化进入独立部署产物
- **WHEN** 内核源码或约定正文变化且lib保持旧字节时重建
- **THEN** 新部署产物体现当前源码/摘要，在无workspace包与源码目录时可加载

#### Scenario: 缺约定资源在验收中失败
- **WHEN** 复制产物漏带实际所需约定资源
- **THEN** 产物加载验收失败而非静默空约定，不把源目录存在当作部署成功证据

### Requirement: 验收不触碰日常会话与部署

真实接缝验收 SHALL 使用独立临时DSH_HOME/profile、合成会话与本地可控模型端点，不访问用户会话日志、密钥或外部模型。插件登记默认disabled；本change实施不启用日常部署、不创建GUI或派生团队。真实Host测试若环境缺失 SHALL 报未验证而非用mock替代通过。禁用/移除 SHALL 关闭实例但保留台账，未来重启可显式恢复。

#### Scenario: 真实隔离Host验证完整接缝
- **WHEN** 在临时profile执行身份、忙闲唤醒、冷恢复，以及发行Host的正常停止、真实dispose预算耗尽和SIGKILL三个独立子验收
- **THEN** 记录真实启动/停止入口、运行体版本/摘要及预算来源；分别证明close锁释放、预算终止残锁和强退残锁，缺少发行入口或真实预算则对应项未验证；日常profile和用户会话文件树不变

#### Scenario: 未执行真实Host实验不能宣称完成
- **WHEN** 仅单元测试通过或真实Host前提缺失
- **THEN** 验收记录对应项未验证且不标绿，不以源码检查/模拟调用次数代替真实请求头、回合和锁的oracle

#### Scenario: 移除保留持久日志
- **WHEN** 关闭插件并移除部署副本
- **THEN** 工具消失、存储句柄关闭，profile持久台账字节不被删除，未触碰workspace文件
