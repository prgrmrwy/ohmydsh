## Purpose

定义跨多个 DSH Host 时稳定且无碰撞的 workspace/session 身份、权威投影、命令归属与断线对账，使模型、工具和文件系统始终在所属节点执行。

## ADDED Requirements

### Requirement: 所有节点对象使用可逆版本化联合身份
系统 SHALL 为 This Mac 和每个远端节点的 workspace/session 生成包含不可变 node id、对象种类和原生 id 的可逆版本化联合 ID。联合 ID MUST NOT 包含显示名、SSH alias、hostname 或文件路径；畸形、未知版本、类型不匹配或未知节点的 ID SHALL fail closed，不得回退成本机原生 ID。

#### Scenario: 两节点原生 ID 碰撞
- **WHEN** 两个节点拥有相同原生 session id 或 workspace id
- **THEN** 它们生成不同联合 ID、在列表中同时可见，所有操作严格路由到各自节点

#### Scenario: 节点重命名不改变对象身份
- **WHEN** 用户修改节点显示名或 SSH alias
- **THEN** 既有联合 workspace/session ID 和浏览器持久视图仍可解析到原节点

### Requirement: 联邦投影保留 Node、Workspace 与 Ungrouped 归属
系统 SHALL 发布 `Node → Workspace → Session` 权威投影，并为每个节点独立维护 workspace 顺序、session 记账、归档集合和 Ungrouped 集合。远端路径 SHALL 只作为所属节点的显示与操作参数，中央 MUST NOT 将其解释为本机路径或对其执行本机文件操作。

#### Scenario: 远端多个 workspace 同时展示
- **WHEN** 一个远端 Host 注册了多个 workspace，并有不属于任何 workspace 的 session
- **THEN** 中央在该 Node 下分别展示各 workspace 及该 Node 自己的 Ungrouped 分组，session 归属与远端一致

#### Scenario: 路径同名但节点不同
- **WHEN** 本机和远端都有显示为 `backend` 的 workspace
- **THEN** 两者按 node id 和联合 workspace id 独立存在，不因标题或路径字符串相同而合并

### Requirement: Workspace 和 Session 操作始终路由到所属 Host
系统 SHALL 按联合 ID 的 node 归属路由 workspace list/create/rename/delete/reorder、session list/create/history/prompt/cancel/rename/fork/models/selectModel/updateQueue/attachment/search、archive 与用户交互应答。删除 workspace 只删除所属 Host 的注册记录，MUST NOT 删除目录或 session 日志。中央 MUST NOT 提供跨节点 session 迁移或通过拖拽改写 cwd。

#### Scenario: 在远端 workspace 新建会话
- **WHEN** 用户在某远端 workspace 触发 New Session
- **THEN** 系统在该远端 Host 创建或复用该 workspace 的 blank session，模型和工具均在远端运行

#### Scenario: 中央与远端 GUI 并发操作
- **WHEN** 中央 GUI 与远端原生 GUI 同时打开同一 session
- **THEN** 远端 Host 保持唯一权威，中央按远端响应和事件收敛，不引入联邦独占锁或租约

### Requirement: 远端目录浏览与 Workspace 注册保留节点边界
系统 SHALL 支持从中央浏览指定节点可访问的目录、创建一个子目录并把已有目录注册为该节点 workspace。远端节点 SHALL 使用应用内 browse 流，不调用远端桌面原生选择器；This Mac 可按其 Host capability 使用 native 或 browse。所有目录请求 MUST 显式绑定 node id。

#### Scenario: 选择 VM 目录作为 workspace
- **WHEN** 用户在 Lume VM 节点选择 `/home/user/projects/api` 并确认
- **THEN** list/create/createWorkspace 请求只发送到 Lume VM，成功后该 workspace 出现在该 Node 下

#### Scenario: 中央不映射远端路径
- **WHEN** 远端 workspace 路径在本机不存在或与本机路径同名
- **THEN** 中央仍可操作远端 session，但不创建本机映射、不做文件同步，也不把该路径传给本机工具

### Requirement: Baseline 与增量事件按可证明的 rc.2 顺序语义对账
系统 SHALL 为每个节点维护 workspace/session baseline 和事件 generation，并仅在 rc.2 提供可比较 `seq`/`asOfSeq` 的 session event/projection 领域使用 higher-seq-wins 水位线。没有跨双流统一序号的 Host workspace/order/status 帧 SHALL 使用新 generation 预缓冲、完整快照覆盖、实体 tombstone 和权威 refresh 收敛，不得伪造全局原子顺序。首次连接只有在核心 baseline 与双事件流就绪后才可进入可写 ready。

#### Scenario: 断线期间远端完成任务
- **WHEN** 中央断线期间远端 session 完成，随后中央重连
- **THEN** 中央从远端历史和状态基线恢复完成结果，不要求本机持续在线

#### Scenario: 旧连接迟到帧
- **WHEN** 新 generation 已激活后旧连接仍送达迟到事件
- **THEN** 系统丢弃旧 generation 事件，不得回滚新 baseline 或重复渲染内容

#### Scenario: List 与订阅窗口发生变更
- **WHEN** workspace/session 在 baseline 调用与新事件流就绪之间被创建、删除或重排
- **THEN** 系统通过先缓冲新 generation 帧、重放到 baseline 并在无序领域触发权威 refresh 收敛，不永久丢失对象或复活已删除对象

#### Scenario: 双流跨域乱序
- **WHEN** mux 的 session seq 帧与 host 的 workspace/status 帧以不同顺序到达
- **THEN** 系统只在各自有证明的领域比较顺序，不用一个流的序号覆盖另一个流，并最终与远端 baseline 一致

### Requirement: 写操作结果未知时不得自动重放
系统 SHALL 跟踪写操作至少为未发送、已发送待响应、已接受、已拒绝和结果未知。连接在请求发出后、响应确认前中断时 SHALL 标记结果未知，MUST NOT 自动重发 prompt、cancel、model selection 或其他变更操作。系统 SHALL 按操作类型只使用唯一可比较的远端证据收敛：prompt 可使用持久 user message 中回显的原始 rpcId；有返回 seq/revision 的操作可使用该证据；没有持久证据或存在歧义的操作 SHALL 无限期保持未知，不得按消息内容猜测。

#### Scenario: Prompt 响应前断线
- **WHEN** `session.prompt` 已写入 carrier 但在收到远端响应前连接断开
- **THEN** UI 显示 outcome unknown，系统不自动再次提交该 prompt

#### Scenario: 重连历史用 rpcId 证明 Prompt 已接受
- **WHEN** 重连后权威 history 的持久 user message source 含结果未知 prompt 的相同 rpcId
- **THEN** 系统把该 prompt 收敛为已接受，并继续展示远端执行状态

#### Scenario: 相同文本和并发客户端不构成证明
- **WHEN** history 出现相同 prompt 文本但 rpcId 不同，或该消息来自远端另一 GUI
- **THEN** 系统不得据此收敛本操作，结果继续保持未知

#### Scenario: Cancel 或模型选择没有持久证据
- **WHEN** cancel 或 model selection 在响应前断线，重连状态无法唯一证明该请求是否执行
- **THEN** 结果保持未知并向用户展示人工判断提示，系统不得自动重发

### Requirement: 订阅凭据、设置和文件仍归节点所有
中央联邦 SHALL 只消费远端已经可用的模型目录和会话能力；MUST NOT 代理远端 Settings、Subscriptions 或 Credentials，MUST NOT 读取或同步 provider token，也 MUST NOT 自动下载、同步或共享 workspace 文件。远端文件路径可以复制或经安全节点绑定接口只读预览，但 V1 SHALL NOT 调用远端 `host.openPath`。

#### Scenario: 远端 Claude 未登录
- **WHEN** 远端 Host 没有可用 Claude 模型
- **THEN** 中央不显示或不可选择 Claude，并提示用户到远端自身环境完成配置，不读取中央凭据补齐

#### Scenario: 点击远端文件路径
- **WHEN** 用户在远端工具结果中操作一个文件路径
- **THEN** 中央可复制路径或使用节点绑定的安全预览，不得用本机应用打开该远端路径或自动下载文件
