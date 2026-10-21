## MODIFIED Requirements

### Requirement: 封闭的命令集合与授权

`CollabService` 的公开写命令 SHALL 恰为下表所列，并以具名方法暴露，MUST NOT 提供按字符串分发命令的入口。principal SHALL 只能是：

- `agent{channel, address}`：宿主担保的调用方 session；
- `provider{providerId, on:{channel, address}}`：已注册 provider 代表其注册 channel 上的一个地址，`on.channel` 不等于注册 channel MUST 以 `COLLAB_FORBIDDEN` 拒绝；
- `internal{purpose}`：宿主自身，`purpose` 只能是 `breaker-reset` 或 `host-index`；其它值在 principal 稳定校验中 MUST 以 `COLLAB_FORBIDDEN` 拒绝。`host-index` 只用于宿主读取，MUST NOT 执行任何写命令（包括 `createSpace` 与 `resetBreaker`）。

actor SHALL 由内核从 principal 反查得到，任何命令 MUST NOT 接受调用方指定 actor。

| 命令 | 允许的 principal | 前置条件（"成员"＝反查到的 active 成员） |
|---|---|---|
| `createSpace` | agent、provider | 调用方地址不需要已是成员 |
| `invite` | agent、provider | 成员且为 Leader |
| `join`、`declineInvite` | agent、provider | 反查到的成员状态为 `invited`，且就是被操作的成员本人 |
| `leave` | agent、provider | 成员本人 |
| `markGone` | agent、provider | 成员且为 Leader，目标为其他 active 成员 |
| `transferLeader` | agent、provider | 成员且为 Leader，目标为其他 active 成员 |
| `closeSpace` | agent、provider | 成员且为 Leader |
| `createItem`、`reviseItem`、`ackItem`、`sendMessage`、`setStatus` | agent、provider | 成员（另受条目状态转换表约束） |
| `advanceRequest` | agent、provider | 成员且为该 request 的承接方 |
| `requestDecision` | agent、provider | 成员 |
| `confirmDecision` | provider | 成员（当前 active，否则 `COLLAB_MEMBER_INACTIVE`）且 `kind` 为 `human`（否则 `COLLAB_FORBIDDEN`）；其余见"人类决定只能由带证据的确认产生" |
| `resetBreaker` | internal(`breaker-reset`) | 目标为 active 成员 |

读取 `overview`、`readSince`、`project`、`readConvention` SHALL 允许成员（任意状态为 `active` 的成员）与 `internal`（上述两个 purpose 均可）。

处理顺序 SHALL 按命令所属的三个分支之一执行：

- **普通成员命令**（除 `createSpace` 与 internal 命令外的全部写命令）：① principal 稳定校验（brand、provider 已注册且 `on.channel` 等于注册 channel；internal principal 在此 MUST 立即以 `COLLAB_FORBIDDEN` 拒绝，早于任何 provider 调用、presence 采样与空间状态检查）→ ② 协作空间存在（否则 `COLLAB_SPACE_NOT_FOUND`）→ ③ 按 `{channel, address}` 反查成员，不检查其状态（失败为 `COLLAB_NOT_MEMBER`）→ ④ `cmdId` 收据查找 → ⑤ 协作空间未关闭 → ⑥ 本表前置条件 → ⑦ 命令专属幂等键 → ⑧ 业务校验。
- **`createSpace`**：① principal 稳定校验（internal principal 在此 MUST 以 `COLLAB_FORBIDDEN` 拒绝）→ ② 以 principal 的 `{channel, address}` 为 scope 查找创建收据（命中则返回原结果）→ ③ 请求的 `spaceId` 不存在（已存在为 `COLLAB_SPACE_EXISTS`）→ ④ 认领首成员地址，认领结果的 `{channel, address}` MUST 等于 principal 的地址 → ⑤ 业务校验。同一 `spaceId` 的创建与该空间上的其他命令串行执行。
- **internal 命令**（`resetBreaker`）：① principal 稳定校验 → ② 协作空间存在 → ③ 以 `purpose` 为 scope 查找收据 → ④ 协作空间未关闭 → ⑤ `purpose` 与命令匹配（否则 `COLLAB_FORBIDDEN`）→ ⑥ 业务校验。internal 命令不做成员反查，事件的 actor 记为 `internal:<purpose>`。

分支中的成员、创建者地址及 purpose scope 均采用幂等 requirement 定义的带类型标签编码。

读取不执行上述写命令流水线，不要求 cmdId，也不查找收据或命令专属幂等键。agent/provider 读取依次执行 principal 稳定校验、协作空间存在、按地址反查成员、当前 active 读取授权；internal 读取只执行 principal 稳定校验及协作空间存在，不做写命令 purpose 匹配。读取不因协作空间业务状态 closed 而拒绝；存储 failed 或未打开不因此获得豁免。

反查到的成员状态不满足前置条件 MUST 以 `COLLAB_MEMBER_INACTIVE` 拒绝；其余前置条件不满足 MUST 以本表或对应 requirement 指定的错误拒绝，未指定时为 `COLLAB_FORBIDDEN`。

#### Scenario: 动作记为 principal 反查到的成员
- **GIVEN** active agent 成员 `aily` 绑定 `{test-a, a:1}`
- **WHEN** principal `agent{test-a, a:1}` 发送消息给 `doubao`
- **THEN** 提交中事件 `message/sent` 的 `actor` 为 `aily`

#### Scenario: 首次创建与创建重放
- **GIVEN** provider P1 认领 `a:1` 为 agent，`space-1` 不存在
- **WHEN** principal `agent{test-a, a:1}` 以 `cmdId:'c-1'` 创建 `space-1`，随后以相同 `cmdId` 与载荷再次调用
- **THEN** 第一次成功；第二次返回与第一次相同的结果，日志长度仍为 1

#### Scenario: 重复创建同一协作空间
- **GIVEN** `space-1` 已由 `a:1` 创建
- **WHEN** principal `agent{test-a, a:2}` 以新 `cmdId` 创建 `space-1`
- **THEN** 返回 `COLLAB_SPACE_EXISTS`

#### Scenario: internal 命令不做成员反查
- **GIVEN** `space-1` 中 active 成员 `doubao` 为 `paused`
- **WHEN** principal `internal{purpose:'breaker-reset'}` 调用 `resetBreaker(doubao)`
- **THEN** 成功；提交中 `breaker/reset` 事件的 actor 为 `internal:breaker-reset`

#### Scenario: 不存在的协作空间先于成员反查报错
- **GIVEN** 本实例不存在 `space-x`
- **WHEN** 地址不属于任何成员的 principal `agent{test-a, a:404}` 对 `space-x` 发送消息
- **THEN** 返回 `COLLAB_SPACE_NOT_FOUND`，而不是 `COLLAB_NOT_MEMBER`

#### Scenario: 公开命令与授权表一致
- **GIVEN** `CollabService` 的真实公开类型与授权表，不提供另一份手工维护的命令常量
- **WHEN** 测试从真实类型提取公开可调用成员，去掉四个纯读方法及经逐项核实的非业务生命周期方法，与授权表键比较；随后在类型夹具中增加未登记方法 `unsafeWrite`，授权表保持不变，再运行同一检查
- **THEN** 真实类型的两个集合相等；增加方法的夹具检查失败，报告授权表缺少 `unsafeWrite`，不能因两份清单同时漏改而通过

#### Scenario: 没有按字符串分发的入口
- **GIVEN** `collab-kernel` 的公开类型声明
- **WHEN** 运行类型层测试检查 `CollabService`
- **THEN** 不存在 `execute` 或其他以命令名字符串为参数的方法，也不存在 `setDeciders` 方法

#### Scenario: 非 Leader 邀请被拒
- **GIVEN** Leader 为 `aily`，`doubao` 为 active 非 Leader 成员
- **WHEN** `doubao` 邀请新地址
- **THEN** 返回 `COLLAB_FORBIDDEN`，日志长度不变

#### Scenario: 他人代为加入被拒
- **GIVEN** 地址 `a:9` 已被邀请为成员 `bob`（`invited`），`aily` 为 active
- **WHEN** principal `agent{test-a, a:1}`（成员 `aily`）调用 `join`
- **THEN** 返回 `COLLAB_MEMBER_INACTIVE`，`bob` 仍为 `invited`

#### Scenario: provider 代表其他 channel 被拒
- **GIVEN** provider P1 的注册 channel 为 `test-a`
- **WHEN** P1 以 `on:{channel:'test-b', address:'b:7'}` 发起任意命令
- **THEN** 返回 `COLLAB_FORBIDDEN`

#### Scenario: agent 调用 confirmDecision 被拒
- **GIVEN** 一个 open 的决策请求
- **WHEN** principal `agent{test-a, a:1}` 调用 `confirmDecision`
- **THEN** 返回 `COLLAB_FORBIDDEN`，请求仍为 open，日志长度不变

#### Scenario: internal 不能执行成员命令
- **GIVEN** active 成员 `doubao`
- **WHEN** principal `internal{purpose:'breaker-reset'}` 调用 `sendMessage`
- **THEN** 返回 `COLLAB_FORBIDDEN`，日志长度不变

#### Scenario: gone 成员不能读写
- **GIVEN** 成员 `doubao` 已为 `gone`
- **WHEN** `doubao` 的 principal 依次发送消息、读取总览
- **THEN** 两次都返回 `COLLAB_MEMBER_INACTIVE`

#### Scenario: host-index 可以读取任意空间
- **GIVEN** 空间 S 中没有任何与宿主相关的成员
- **WHEN** principal `internal{purpose:'host-index'}` 调用 `readSince(0)`
- **THEN** 返回 S 的全部提交记录，日志字节不变

#### Scenario: host-index 不能执行任何写命令
- **GIVEN** active 成员 `doubao` 与一个 open 空间
- **WHEN** principal `internal{purpose:'host-index'}` 依次调用每一个公开写命令（含 `createSpace` 与 `resetBreaker`）
- **THEN** 每次都返回 `COLLAB_FORBIDDEN`，日志字节不变，provider 的 claim、presence、deliver 调用次数都为 0

#### Scenario: internal 在已关闭空间执行成员命令仍为 FORBIDDEN
- **GIVEN** 空间已关闭
- **WHEN** principal `internal{purpose:'host-index'}` 调用 `invite`
- **THEN** 返回 `COLLAB_FORBIDDEN` 而非 `COLLAB_SPACE_CLOSED`，provider 调用次数为 0

#### Scenario: 未知 internal purpose 被拒绝
- **WHEN** principal `internal{purpose:'other'}` 调用 `overview`
- **THEN** 返回 `COLLAB_FORBIDDEN`

## ADDED Requirements

### Requirement: 公开纯状态推导函数

内核 SHALL 从公开入口导出纯函数 `reduce(previous, record)`，与内核内部加载、提交时使用的是同一实现：输入上一状态与一条提交记录，返回新状态，不读写存储、不调用 provider、不需要 principal。它不授予任何读取权：调用者必须已经通过合法读取取得提交记录。

#### Scenario: 公开推导与内核状态一致
- **GIVEN** 一个空间经历创建、邀请、加入、statusText 更新、条目修改、ack 与 Leader 转交
- **WHEN** 以 `internal{purpose:'host-index'}` 调用 `readSince(0)`，再用公开 `reduce` 依次折叠全部记录
- **THEN** 所得状态与同一时刻 `overview` 返回的状态在 members、items、leader、status、lastSeq 上深度相等

#### Scenario: 推导不修改输入
- **GIVEN** 一个非空的上一状态与一条成员加入记录
- **WHEN** 调用公开 `reduce`
- **THEN** 调用前后对上一状态与记录各做的深拷贝分别深度相等

#### Scenario: 推导函数不接触外部
- **GIVEN** 存储与 provider 的每个方法都被替换为一经调用即抛错的替身
- **WHEN** 用公开 `reduce` 折叠一组记录
- **THEN** 正常返回状态，替身调用次数为 0
