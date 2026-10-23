## ADDED Requirements

### Requirement: 接入方以真实普通会话建立空间并接入自己

句柄 SHALL 提供 `establish(exec, spaceId, cmdId, {name, purpose})`：

1. 按"工具调用者可解析为托管成员"的入口从 `exec` 解析调用者；解析结果不是 `dsh-session` 普通会话时 MUST 以 `COLLAB_CALLER_UNAVAILABLE` 拒绝，不调用内核。
2. 以该调用者执行 `createSpace`，cmdId 为 `<cmdId>:create`，首成员名 `name`，`purpose` 原样传入；`COLLAB_SPACE_EXISTS` 时进入第 3 步而不报错。
3. 以同一调用者执行 `allowManager({channel: 本句柄 channel})`，cmdId 为 `<cmdId>:allow`；channel 已在 `managers` 中视为已满足。
4. 第 2、3 步都成功或已满足时返回 `{spaceId}`；调用者不是该空间的 Leader 时 MUST 返回 `COLLAB_SPACE_UNAVAILABLE`，不泄露空间是否存在。

两步各自带调用级守卫，句柄 dispose 后在途的 `establish` 不再提交。第 2 步成功、第 3 步之前中断时，以同一 cmdId 重试 SHALL 补齐授权。

#### Scenario: 首次建立并授权
- **GIVEN** 普通会话 A 是 Host 当前对象，空间 `pet-locus-x` 不存在
- **WHEN** 句柄以 A 的 exec 调用 `establish(exec, 'pet-locus-x', 'est-1', {name:'main', purpose:'…'})`
- **THEN** 台账依次含 `space/created`（Leader `main`）与 `manager/allowed{pet-locus}`，二者 actor 都是 `main`

#### Scenario: 中断后重试补齐
- **GIVEN** 上一次 `establish` 只完成了 `createSpace`
- **WHEN** 以同一 cmdId 重试
- **THEN** 创建命中收据，授权被提交一次；再重试日志不变

#### Scenario: 托管成员不能建立
- **WHEN** 以解析为托管成员的 child exec 调用 `establish`
- **THEN** 返回 `COLLAB_CALLER_UNAVAILABLE`，内核未收到命令

#### Scenario: 非 Leader 不能借此授权
- **GIVEN** 空间 S 已由 B 建立，A 不是其成员
- **WHEN** 句柄以 A 的 exec 调用 `establish(exec, 'S', …)`
- **THEN** 返回 `COLLAB_SPACE_UNAVAILABLE`，S 的日志不变

## MODIFIED Requirements

### Requirement: 接入方经句柄托管成员

句柄 SHALL 提供 `admit(spaceId, cmdId, {name, address})`、`rebind(spaceId, cmdId, {member, address})` 与 `retire(spaceId, cmdId, {member})`。它们以该中继 provider 的 manager principal 调用内核同名命令，返回内核结果。错误按"错误披露不泄露无权空间"映射。

每次调用 SHALL 携带一个守卫。守卫捕获本句柄的接入代际，只在该代际仍是当前代际时返回真；对 `admit` 与 `rebind`，还要求 adapter 的同步方法 `holds(address)` 对新地址返回真。因此句柄 dispose 后，它发起的、仍在途的托管命令不会提交。

内核以 `COLLAB_CALLER_STALE` 拒绝时，句柄按守卫记录的失败原因映射错误：接入代际已变返回 `COLLAB_CHANNEL_DETACHED`，新地址不再被持有返回 `COLLAB_ADDRESS_UNCLAIMED`。

句柄 SHALL 另提供 `disposeRequest(spaceId, cmdId, {itemId, progress})`，以 manager principal 调用内核 `disposeManagedRequest`，守卫只检查接入代际。句柄 SHALL 提供 `readManaged(spaceId)`：以宿主既有的 `internal{purpose:'host-index'}` 读取该空间全部提交记录，推导状态后要求本句柄 channel 在 `managers` 中，否则与空间不存在、存储失败一样返回 `COLLAB_SPACE_UNAVAILABLE`；返回前检查接入代际，结果为深拷贝。内核读取授权不因此改变。

句柄 MUST NOT 提供 `revokeManager`、`invite`、`markGone`、`transferLeader` 或 `closeSpace`。`allowManager` 只能经 `establish` 以真实普通会话调用者的身份、且只为本句柄 channel 执行（见"接入方以真实普通会话建立空间并接入自己"）；接入方不能凭自身身份授权自己。

#### Scenario: Leader 授权后接入方接纳成员
- **GIVEN** 会话 A 是空间 S 的 Leader，A 以 `collab_space` 的 `allow_manager` 授权 `pet-locus`
- **WHEN** 接入方句柄以 `cmdId:'adm-1'` 接纳 `locus-a`（地址 `loc:1`），再以相同参数重试
- **THEN** 两次返回同一 seq；台账含 `manager/allowed` 与 actor 为 `manager:pet-locus` 的 `member/joined`；无唤醒

#### Scenario: 未授权空间的响应完全一致
- **GIVEN** `pet-locus` 未获下列空间授权：S1 健康、S2 已关闭、S3 被锁、S4 日志损坏、S5 运行期提交失败、S6 不存在
- **WHEN** 句柄对每个空间各调用一次 `admit`
- **THEN** 六个响应序列化后完全相同，都是 `{"error":{"code":"COLLAB_SPACE_UNAVAILABLE"}}`；各空间日志字节都不变

#### Scenario: 旧句柄的在途托管命令不提交
- **GIVEN** 句柄 H1 调用 `admit`，其认领被挂起
- **WHEN** H1 dispose，同 channel 重新 attach 得到 H2，随后释放认领
- **THEN** H1 的 `admit` 返回 `COLLAB_CHANNEL_DETACHED`，日志字节不变；H2 以同一 cmdId 与载荷调用 `admit` 成功

#### Scenario: 认领后、提交前地址被撤回
- **GIVEN** 句柄的 `admit` 已认领 `loc:3`
- **WHEN** 进入事务前 adapter 的 `holds('loc:3')` 变为假
- **THEN** 返回 `COLLAB_ADDRESS_UNCLAIMED`，日志字节不变

#### Scenario: 句柄没有 Leader 能力
- **WHEN** 检查句柄对象的方法集合
- **THEN** 恰含 `admit`、`rebind`、`retire`、`disposeRequest`、`readManaged`、`establish`、`command`、`read`、`registerSessionMode` 与 `dispose`

#### Scenario: 托管读取只对已授权空间可用
- **GIVEN** 空间 S 已授权 `pet-locus`，空间 T 未授权，空间 U 不存在
- **WHEN** 句柄分别调用 `readManaged('S')`、`readManaged('T')`、`readManaged('U')`
- **THEN** S 返回其全部提交记录；T 与 U 的响应序列化后相同，均为 `{"error":{"code":"COLLAB_SPACE_UNAVAILABLE"}}`；各日志字节不变
