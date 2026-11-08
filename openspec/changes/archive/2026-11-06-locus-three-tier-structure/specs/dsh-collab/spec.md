## ADDED Requirements

### Requirement: 接入方以其拥有的普通会话身份执行封闭命令

接入方 adapter SHALL 可选提供 `owns(sessionId): boolean`（同步）。句柄 SHALL 提供 `actAs(sessionId, spaceId, cmdId, op)`，以 `{channel:'dsh-session', address:sessionId}` 作为调用者执行命令，前提是以下条件**全部**成立，否则 MUST 以 `COLLAB_CALLER_UNAVAILABLE` 拒绝且内核不收到命令：

1. 句柄仍为当前接入；
2. `sessionId` 是满足"发现与绑定只使用精确普通会话身份"准入条件的普通一级会话（未归档、不在拒绝名单、allowlist 模式下在名单内、非 subagent）；
3. adapter 提供 `owns` 且 `owns(sessionId)` 返回 `true`（抛错视为 `false`）。

上述条件 SHALL 作为调用级守卫，在内核最终提交与收据返回边界同步重验。`op.op` SHALL 只能是 `createSpace`、`allowManager`（`channel` 只能是本句柄的 channel）、`invite`、`createItem`、`reviseItem`、`ackItem`、`sendMessage`、`setStatus`、`advanceRequest`、`read`（`view` 为 `overview` 或 `since`），其余 MUST 以 `COLLAB_BAD_ARGUMENTS` 拒绝；`createSpace` 的首成员地址固定为 `sessionId`，`invite` 认领仍走现有 provider 认领且在 `memberTrust: true` 时按"成员信任下邀请即加入"代为加入；`createItem`、`sendMessage` SHALL 原样传递 `ext`，`sendMessage` 的 `mode` 规则同 `command`。错误 SHALL 经 `safeError`。`actAs` 不改变 `command`、`read`、`establish` 的现有语义。句柄的 `disposeRequest` SHALL 把 adapter 的 `owns` 作为内核 `authorOwned` 判定传入（未提供 `owns` 时不传）。

#### Scenario: 以拥有的会话建空间、邀请并代写
- **GIVEN** adapter 的 `owns` 只对普通会话 M 返回真；普通会话 W 满足准入；`memberTrust: true`
- **WHEN** 句柄依次 `actAs(M,'sp','c1',{op:'createSpace', input:{name:'locus'}})`、`actAs(M,'sp','c2',{op:'invite', input:{name:'work', address:W}})`、`actAs(M,'sp','c3',{op:'createItem', input:{itemId:'todo-1', kind:'request', assignee:'work', title:'t', body:'b', requiredAcks:[], ext:{pet:{entry:'e1'}}}})`
- **THEN** 日志含 `space/created`（Leader `locus`，绑定 `dsh-session:M`）、`member/invited(work)`、`member/joined(work)` 与 actor 为 `locus`、`ext` 原样的 `item/created`

#### Scenario: 未拥有、子会话或已归档时拒绝
- **WHEN** 分别以 `owns` 返回假的普通会话、一个 subagent 会话（即使 `owns` 返回真）、一个已归档且 `owns` 返回真的会话调用 `actAs(..., {op:'sendMessage', ...})`
- **THEN** 三次都返回 `COLLAB_CALLER_UNAVAILABLE`，日志长度不变

#### Scenario: 提交前失去拥有关系
- **GIVEN** `actAs(M, ...)` 已通过入口检查，内核在提交前等待
- **WHEN** 等待期间 `owns(M)` 变为假，内核到达提交边界
- **THEN** 返回 `COLLAB_CALLER_UNAVAILABLE`，日志长度不变

#### Scenario: 封闭操作集合
- **WHEN** 以 `channel` 为其它 channel 的 `op:'allowManager'`、`op:'markGone'`、`op:'closeSpace'` 调用 `actAs`
- **THEN** 都返回 `COLLAB_BAD_ARGUMENTS`，内核未收到命令

#### Scenario: 未提供 owns 的接入方
- **GIVEN** adapter 不提供 `owns`
- **WHEN** 调用 `actAs`
- **THEN** 返回 `COLLAB_CALLER_UNAVAILABLE`
