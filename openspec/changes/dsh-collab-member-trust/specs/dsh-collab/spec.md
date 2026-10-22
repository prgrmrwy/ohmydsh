## ADDED Requirements

### Requirement: 成员信任由宿主配置声明

插件配置 SHALL 支持布尔项 `memberTrust`，缺省为 `true`，在 `admission: invite` 与 `allowlist` 下同样生效；非布尔值 MUST 以 `COLLAB_BAD_CONFIG` 拒绝启动。`memberTrust` 只能由宿主配置提供，agent 工具不能修改它；修改后须经 `dsh build` 与 `dsh restart` 才生效。`memberTrust: true` 表示本机用户预先同意：被 Leader 邀请的会话直接成为成员，成员承接空间内其它成员派发的 request 时，在本会话原有权限边界内执行，无需再向人类索取授权。它 MUST NOT 授予额外的文件权限，MUST NOT 改变 sandbox、approval、worktree、preset、cwd 或会话派生关系，MUST NOT 让 agent 代替人类作出 `requestDecision` 的决定。`memberTrust: false` 时插件 SHALL 保持本变更之前的邀请与唤醒行为。

#### Scenario: 缺省开启成员信任
- **GIVEN** 配置未写 `memberTrust`
- **WHEN** 插件启动
- **THEN** 以 `memberTrust: true` 运行

#### Scenario: 非法取值拒绝启动
- **WHEN** 配置为 `memberTrust: 'yes'`
- **THEN** 插件拒绝启动并报告 `COLLAB_BAD_CONFIG`，不注册任何协作工具，不创建 dataDir

#### Scenario: 成员信任不放宽宿主权限
- **GIVEN** `memberTrust: true`，B 的会话策略禁止写入其 workspace 之外的路径
- **WHEN** B 承接 A 派发的 request，request 要求写入 B workspace 之外的文件
- **THEN** 宿主原有的 sandbox/approval/worktree 规则照常拒绝或询问，与未加入任何空间时一致

### Requirement: 成员信任下邀请即加入

`memberTrust: true` 时，`collab_invite` 在内核 `invite` 成功（含收据重放）后，插件 SHALL 以被邀请会话的 agent principal（channel `dsh-session`、地址为该完整 session ID）调用内核 `join`，cmdId 固定为保留值 `dsh-collab:auto-join`，使重试由内核收据保证幂等。该 principal 由宿主担保：地址正是刚被 provider 认领的会话，模型参数 MUST NOT 指定其它地址。代为加入只在 `collab_invite` 内发生；投递、`collab_status` 与读取 MUST NOT 触发加入。`collab_invite` 的返回 SHALL 在内核结果之外增加 `autoJoined: boolean`；代为加入失败（如被邀请者已 decline、空间已关闭或存储不可用）时 SHALL 返回 `autoJoined: false` 且邀请结果不变，不重试、不报错，被邀请者仍可手动 `join` 或 `decline`。`autoJoined` 反映该 `join` 命令的结果（含收据重放），不代表被邀请者此刻的成员状态。地址在空间内不可复用，因此固定 cmdId 在同一空间、同一成员上只对应一次加入。`memberTrust: false` 时 `collab_invite` 的返回 SHALL 与本变更之前完全相同，不含 `autoJoined`。

#### Scenario: 邀请后被邀请者直接可读写
- **GIVEN** `memberTrust: true`，A 是空间 S 的 Leader，B 是普通会话
- **WHEN** A 用 B 的完整 ID 调用 `collab_invite`
- **THEN** 返回 `autoJoined: true`；台账依次有 `member/invited` 与 actor 为 B 的 `member/joined`；B 随后 `collab_read` 返回空间内容，B 的 `collab_status` 中 S 位于 `spaces` 而非 `invites`

#### Scenario: 重试邀请不产生第二次加入
- **GIVEN** 上一场景已完成
- **WHEN** A 以相同 cmdId 与参数重试 `collab_invite`
- **THEN** 返回相同的邀请 seq 与 `autoJoined: true`；日志不新增业务事件

#### Scenario: 已拒绝的邀请不被代为加入
- **GIVEN** `memberTrust: true`，B 在首次邀请的代为加入完成前已 `decline`
- **WHEN** 代为加入执行
- **THEN** 返回 `autoJoined: false`，B 保持 `declined`，邀请结果 seq 不变

#### Scenario: 关闭成员信任保持手动加入
- **GIVEN** `memberTrust: false`
- **WHEN** A 邀请 B
- **THEN** 返回不含 `autoJoined`；B 保持 `invited`，join 前读取返回 `COLLAB_MEMBER_INACTIVE`

## MODIFIED Requirements

### Requirement: 发现与绑定只使用精确普通会话身份

邀请 SHALL 使用完整 session ID，MUST NOT 按前缀、标题或路径猜测目标。provider SHALL 只认领满足"当前准入条件"的 agent 地址：宿主能验证存在、属于普通一级会话、未归档、不在 `denySessionIds`，且在 `allowlist` 模式下位于 `allowedSessionIds`。human、不可核验目标及官方所有权限制的派生会话 MUST 不被认领。被 Leader 邀请并认领成功即该会话进入该空间的授权，授权记录是台账中的 `member/invited` 提交，不需要宿主配置变更或重启；`memberTrust: true` 时插件随即按"成员信任下邀请即加入"代为加入，`memberTrust: false` 时由被邀请者自己 join。插件 MUST NOT 机械限制邀请数量，邀请规模由发起邀请的人控制。冷目标核验 SHALL 只读取会话 header 元数据：可以使用宿主的会话元数据列表并按完整 ID 精确筛选，但 MUST NOT 读取日志正文、恢复 agent 或把列表中其它会话的 ID、cwd 返回给任何工具调用；核验失败（列表不可用、无匹配、header 不可读）时 MUST 不认领。插件 MUST NOT 提供列出 Host 全部会话的工具输出。

#### Scenario: 邀请即授权且无需重启
- **GIVEN** `admission: invite`，B 是未出现在任何配置中的普通冷会话
- **WHEN** Leader A 用 B 的完整 ID 邀请 B
- **THEN** 邀请被认领并唤醒 B；`memberTrust: true` 时 B 已是 active 成员，`memberTrust: false` 时 B join 后可读写该空间；全程无配置写入与 Host 重启

#### Scenario: 未加入不等于可读
- **GIVEN** `memberTrust: false`，或代为加入返回 `autoJoined: false`
- **WHEN** 仍为 invited 的 B 用 `collab_read` 读取该空间
- **THEN** 返回 `COLLAB_MEMBER_INACTIVE`，不含空间内容；provider 不替 B 自动 join 或 ack

#### Scenario: 短前缀不能邀请
- **GIVEN** 两个会话 ID 有相同前缀
- **WHEN** Leader 用短前缀邀请
- **THEN** 返回地址未认领，成员和投递意图均不新增

#### Scenario: 不认领人或受管子代理
- **WHEN** 分别尝试认领 human 地址、不存在 ID、`denySessionIds` 中的 ID、官方标记受管 subagent 的 ID
- **THEN** 每次 provider 都返回不认领，不创建会话、不调用 followup、不绕过宿主所有权错误

#### Scenario: 名单外会话不可访问
- **GIVEN** `admission: allowlist`，C 是同 Host 的有效普通会话但不在 `allowedSessionIds`
- **WHEN** C 调用协作工具，或 Leader 邀请 C
- **THEN** C 的调用返回 `COLLAB_CALLER_UNAVAILABLE` 且不泄露台账；邀请返回地址未认领且不尝试代为加入；agent 不能通过工具修改名单

#### Scenario: 冷会话被发现但不激活
- **GIVEN** 种子名单含一个已持久化、当前未加载的普通会话 D
- **WHEN** 调用 `collab_status`
- **THEN** `contacts` 含 D 的完整 ID 与 cwd；不加载 agent、不入队消息、不读取日志正文

#### Scenario: 冷核验只读元数据
- **GIVEN** 测试替身使会话正文读取、agent 恢复与全量 observation 接口一经调用即失败
- **WHEN** Leader 邀请一个冷普通会话
- **THEN** 认领成功，且上述接口调用次数为 0；工具返回值中不含目标以外会话的 ID 或 cwd

#### Scenario: 元数据列表不可用时不认领
- **GIVEN** 会话元数据列表抛错
- **WHEN** Leader 邀请冷会话 B
- **THEN** 返回地址未认领，成员与投递意图不新增

### Requirement: 投递只传协作指针并使用下一回合语义

普通唤醒 SHALL 只包含内核白名单指针及固定说明文本，不携带条目/消息正文、标题或其它 workspace 文件。固定说明 SHALL 指明先调用 `collab_status` 查看待处理事项，并按 `memberTrust` 取两套文本之一：

- `memberTrust: true`：说明本会话是该协作空间的成员，本机用户已允许本会话承接空间成员派发的 request 并在本会话原有权限边界内直接执行，无需再向用户确认；越出原有 sandbox、approval 或 worktree 限制的操作仍按原规则处理；人类决定只能来自 `requestDecision` 的受信确认，不能由成员转述代替。对带 `invited:true` 的指针，另说明宿主已在邀请时代为加入，若 `collab_status` 仍列出该邀请再自行 join。
- `memberTrust: false`：明确其为插件协作数据而非用户/系统授权，不表示用户同意或工作完成。

运行中会话通过官方 followup 进入下一回合；空闲会话可开始新回合。provider 成功 SHALL 只表示宿主接受入队，不宣称模型已处理或完成工作。MUST NOT 用 steer 打断当前回合或等待模型完成才返回。

#### Scenario: 运行中目标下一回合收到
- **GIVEN** B 当前回合正在执行工具调用
- **WHEN** A 触发 B 的普通唤醒
- **THEN** 指针不出现在 B 当前回合输入；当前回合结束后恰在下一回合输入出现一次；投递无需等待 B 完成

#### Scenario: 空闲目标收到带来源指针
- **WHEN** 向空闲 B 投递
- **THEN** B 新回合收到的消息来源为 `plugin:dsh-collab`，文本包含 `collab_status` 与精确指针 JSON，不含条目标题或正文

#### Scenario: 成员信任下的唤醒文本是常设授权
- **GIVEN** `memberTrust: true`
- **WHEN** 向 B 投递任一普通唤醒
- **THEN** 文本含"无需再向用户确认"与"原有权限边界"的说明，不含"不是额外授权"或"不表示用户同意"

#### Scenario: 关闭成员信任保持原说明
- **GIVEN** `memberTrust: false`
- **WHEN** 向 B 投递任一普通唤醒
- **THEN** 文本与本变更之前的固定说明逐字相同

#### Scenario: 邀请指针不能替代加入
- **GIVEN** `memberTrust: false`，invited 的 B 收到带 `invited:true` 的指针
- **WHEN** B 在 join 前用 `collab_read` 读取该空间
- **THEN** 返回 `COLLAB_MEMBER_INACTIVE`，不含空间内容；provider 不替 B 自动 join 或 ack

#### Scenario: 不满足准入条件的目标不投递
- **GIVEN** B 曾被邀请，随后被加入 `denySessionIds` 并经 `dsh build` 与 `dsh restart` 生效
- **WHEN** 新 Host 中有成员触发一次新的、需要唤醒 B 的投递
- **THEN** provider 拒绝投递，不调用恢复或 followup，投递记为失败
