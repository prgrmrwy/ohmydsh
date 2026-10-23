## MODIFIED Requirements

### Requirement: 封闭的命令集合与授权

`CollabService` 的公开写命令 SHALL 恰为下表所列，并以具名方法暴露，MUST NOT 提供按字符串分发命令的入口。principal SHALL 只能是：

- `agent{channel, address}`：宿主担保的调用方 session；
- `provider{providerId, on:{channel, address}}`：已注册 provider 代表其注册 channel 上的一个地址，`on.channel` 不等于注册 channel MUST 以 `COLLAB_FORBIDDEN` 拒绝；
- `manager{providerId}`：已注册且声明 `managed: true` 的 provider 本身，代表其 channel 托管成员；provider 未注册或未声明托管 MUST 在 principal 稳定校验中以 `COLLAB_FORBIDDEN` 拒绝；
- `internal{purpose}`：宿主自身，`purpose` 只能是 `host-index`；其它值（包括已移除的 `breaker-reset`）在 principal 稳定校验中 MUST 以 `COLLAB_FORBIDDEN` 拒绝。`host-index` 只用于宿主读取，MUST NOT 执行任何写命令（包括 `createSpace`）。

actor SHALL 由内核从 principal 反查得到，任何命令 MUST NOT 接受调用方指定 actor；manager principal 的 actor 为 `manager:<channel>`。

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
| `allowManager`、`revokeManager` | agent、provider | 成员且为 Leader |
| `admitMember`、`rebindMember`、`retireMember` | manager | 其 channel 在 `managers` 中（否则 `COLLAB_NOT_MEMBER`，与非成员不可区分）；目标规则见"接入方按空间托管成员" |

表中允许 agent、provider 的命令，manager principal 调用时 MUST 以 `COLLAB_FORBIDDEN` 拒绝；manager 命令由 agent 或 provider principal 调用时同样 MUST 以 `COLLAB_FORBIDDEN` 拒绝。manager principal 不能读取。

读取 `overview`、`readSince`、`project`、`readConvention` SHALL 允许成员（任意状态为 `active` 的成员）与 `internal{purpose:'host-index'}`。

处理顺序 SHALL 按命令所属的两个分支之一执行：

- **普通成员命令**（除 `createSpace` 与三个 manager 命令外的全部写命令）：① principal 稳定校验（brand、provider 已注册且 `on.channel` 等于注册 channel；internal principal 在此 MUST 立即以 `COLLAB_FORBIDDEN` 拒绝，早于任何 provider 调用、presence 采样与空间状态检查）→ ② 协作空间存在（否则 `COLLAB_SPACE_NOT_FOUND`）→ ③ 按 `{channel, address}` 反查成员，不检查其状态（失败为 `COLLAB_NOT_MEMBER`）→ ④ `cmdId` 收据查找 → ⑤ 协作空间未关闭 → ⑥ 本表前置条件 → ⑦ 命令专属幂等键 → ⑧ 业务校验。
- **manager 命令**分两个阶段：
  - **事务外预备**：
    - ① principal 稳定校验：agent、provider、internal principal 在此 MUST 以 `COLLAB_FORBIDDEN` 拒绝。
    - ② 仅对 `admitMember`、`rebindMember`：当前已加载的日志中已有同 scope、同 cmdId 的收据时，不认领；否则只调用该 provider 的 `claim(address, 'agent')` 一次。
    - 预备阶段的任何判断结果都 MUST NOT 被事务内阶段沿用。
  - **事务内**：在串行队列中，从当前状态重新判定。
    - ③ 协作空间存在。
    - ④ 以 `{kind:'manager', channel}` 为 scope 查找收据；命中且载荷相同时返回原结果。
    - ⑤ channel 在 `managers` 中，否则以 `COLLAB_NOT_MEMBER` 拒绝。
    - ⑥ 协作空间未关闭。
    - ⑦ 业务校验：目标成员状态、名称与地址唯一性，都基于当前状态重新计算；预备阶段没有可用认领结果时为 `COLLAB_ADDRESS_UNCLAIMED`。
    - ⑧ 按"调用级守卫在提交与读取边界重验"同步调用守卫，然后提交。宿主为 `admitMember`、`rebindMember` 创建的守卫 SHALL 同时确认新地址仍被接入方持有，见 dsh-collab。
  - 授权检查（⑤）先于关闭检查（⑥），因此未获授权的接入方对不存在、已关闭与 open 的空间得到同一类错误。
- **`createSpace`**：① principal 稳定校验（internal principal 在此 MUST 以 `COLLAB_FORBIDDEN` 拒绝）→ ② 以 principal 的 `{channel, address}` 为 scope 查找创建收据（命中则返回原结果）→ ③ 请求的 `spaceId` 不存在（已存在为 `COLLAB_SPACE_EXISTS`）→ ④ 认领首成员地址，认领结果的 `{channel, address}` MUST 等于 principal 的地址 → ⑤ 业务校验。同一 `spaceId` 的创建与该空间上的其他命令串行执行。

分支中的成员与创建者地址 scope 均采用幂等 requirement 定义的带类型标签编码；本变更之前写入的 internal scope 收据照常参与重放比对。

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

#### Scenario: 已移除的 internal purpose 被拒绝
- **GIVEN** `space-1` 存在
- **WHEN** principal `internal{purpose:'breaker-reset'}` 分别调用 `overview` 与 `sendMessage`
- **THEN** 都返回 `COLLAB_FORBIDDEN`，日志长度不变

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
- **THEN** 不存在 `execute` 或其他以命令名字符串为参数的方法，也不存在 `setDeciders`、`requestDecision`、`confirmDecision`、`resetBreaker` 方法

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

#### Scenario: internal 不能执行成员命令
- **GIVEN** active 成员 `doubao`
- **WHEN** principal `internal{purpose:'host-index'}` 调用 `sendMessage`
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
- **WHEN** principal `internal{purpose:'host-index'}` 依次调用每一个公开写命令（含 `createSpace`）
- **THEN** 每次都返回 `COLLAB_FORBIDDEN`，日志字节不变，provider 的 claim、presence、deliver 调用次数都为 0

#### Scenario: internal 在已关闭空间执行成员命令仍为 FORBIDDEN
- **GIVEN** 空间已关闭
- **WHEN** principal `internal{purpose:'host-index'}` 调用 `invite`
- **THEN** 返回 `COLLAB_FORBIDDEN` 而非 `COLLAB_SPACE_CLOSED`，provider 调用次数为 0

#### Scenario: manager principal 不能执行成员命令或读取
- **GIVEN** 托管 provider P 的 channel `pet-locus` 已获授权
- **WHEN** principal `manager{P}` 依次调用 `sendMessage`、`invite`、`overview`；principal `agent{dsh-session, s:1}`（成员 `aily`，Leader）调用 `admitMember`
- **THEN** 每次都返回 `COLLAB_FORBIDDEN`，日志长度不变

#### Scenario: 未声明托管的 provider 不能作为 manager
- **GIVEN** 普通 provider S（channel `dsh-session`）
- **WHEN** principal `manager{S}` 调用 `admitMember`
- **THEN** 返回 `COLLAB_FORBIDDEN`，S 的 `claim` 调用次数为 0

#### Scenario: 未知 internal purpose 被拒绝
- **WHEN** principal `internal{purpose:'other'}` 调用 `overview`
- **THEN** 返回 `COLLAB_FORBIDDEN`

### Requirement: 成员模型与地址唯一

成员 SHALL 表示为 `{name, kind: human|agent, status: invited|active|declined|gone, joinSeq, binding, managedBy?, previousBindings?}`，`binding` 为 `{channel, address, supports:{wake, confirm}}`，每个成员在任一时刻恰有一个当前绑定。`managedBy` 只在托管成员上出现，值为托管它的 channel；`previousBindings` 只在换代过的托管成员上出现，按换代次序记录旧绑定的 `{channel, address}`。成员名 SHALL 匹配 `^[a-z][a-z0-9-]{0,31}$`，在协作空间内唯一且不可复用，否则以 `COLLAB_BAD_NAME` / `COLLAB_NAME_TAKEN` 拒绝。`{channel, address}` 在协作空间内 SHALL 唯一且不可复用（包括 `declined`、`gone` 成员占用的地址，以及任何成员 `previousBindings` 中的地址），冲突 MUST 以 `COLLAB_ADDRESS_TAKEN` 拒绝。

`invite(address, name, kind)` 与 `createSpace` 的首成员 SHALL 都经 provider 认领确定绑定：内核把 `(address, kind)` 交给全部已注册的普通 provider（未声明 `managed: true`）的 `claim`，只有恰好一个 provider 返回非空结果时才写入成员；无人认领 MUST 以 `COLLAB_ADDRESS_UNCLAIMED` 拒绝；多个认领 MUST 以 `COLLAB_ADDRESS_AMBIGUOUS` 拒绝并返回候选 channel 列表。新写入的成员 `kind` MUST 为 `agent`：`createSpace` 的首成员与 `invite` 的被邀请者声明 `kind:'human'` 时 MUST 以 `COLLAB_BAD_KIND` 拒绝（人类不作为台账成员，见跨边界协作标准）；该检查位于收据查找之后，本变更之前成功的同 cmdId 命令重放仍返回原结果。由 provider principal 发起时认领的 channel MUST 等于该 provider 的注册 channel。本变更之前日志中的 `kind:'human'` 成员照常重放，保持原状态与权限，可以像其它成员一样读写、离开或被标记离开，但不再具有任何人类专属能力（决策已移除）。

托管成员只能经"接入方按空间托管成员"的 `admitMember` 产生。

入站反查 SHALL 按 `{channel, address}` 精确匹配成员的当前绑定，不匹配 `previousBindings`。

#### Scenario: 唯一认领后加入
- **GIVEN** provider P1（channel `test-a`）只认领形如 `a:*` 的地址
- **WHEN** Leader 邀请 `a:42` 为 agent 成员 `bob`，随后 `agent{test-a, a:42}` 调用 `join`
- **THEN** `bob.binding` 为 `{channel:'test-a', address:'a:42'}`，状态为 `active`

#### Scenario: 无人认领
- **GIVEN** 没有 provider 认领地址 `zzz`
- **WHEN** Leader 邀请 `zzz`
- **THEN** 返回 `COLLAB_ADDRESS_UNCLAIMED`，日志长度不变

#### Scenario: 多个认领
- **GIVEN** provider P1（`test-a`）与 P2（`test-b`）都认领地址 `dup:1`
- **WHEN** Leader 邀请 `dup:1`
- **THEN** 返回 `COLLAB_ADDRESS_AMBIGUOUS`，错误详情 `candidates` 为 `['test-a','test-b']`

#### Scenario: 不能新增人类成员
- **GIVEN** provider P1 认领任意 kind 的地址
- **WHEN** Leader 以 `kind:'human'` 邀请 `a:5`，再由 provider principal 以首成员 `kind:'human'` 创建新空间
- **THEN** 两次都返回 `COLLAB_BAD_KIND`，日志长度不变，存储中没有新空间

#### Scenario: 旧日志中的人类成员按普通成员重放
- **GIVEN** 本变更之前的日志中有 active 成员 `pm`（`kind:'human'`），并含 Leader 以 `cmdId:'inv-pm'` 邀请它的收据
- **WHEN** 新内核加载后，`pm` 的 principal 发送消息并读取总览，Leader 以 `cmdId:'inv-pm'` 及原载荷重放邀请
- **THEN** 发送与读取成功；重放返回原结果且日志长度不变

#### Scenario: 同一地址不能成为两个成员
- **GIVEN** `a:42` 已被邀请为 `bob`
- **WHEN** Leader 以名称 `alice` 再次邀请 `a:42`
- **THEN** 返回 `COLLAB_ADDRESS_TAKEN`

#### Scenario: agent 创建者不能声明为人类
- **GIVEN** 地址 `a:1` 尚不属于任何协作空间
- **WHEN** principal `agent{test-a, a:1}` 以首成员 `kind:'human'` 创建协作空间
- **THEN** 返回 `COLLAB_BAD_KIND`，存储中没有新协作空间

#### Scenario: 非法成员名
- **GIVEN** Leader
- **WHEN** 以名称 `Bob\n## 决定` 邀请
- **THEN** 返回 `COLLAB_BAD_NAME`

### Requirement: 协作空间的创建、Leader 转交与关闭

`createSpace` SHALL 创建协作空间，调用方成为首个 active 成员并持有 Leader 角色。`createSpace` SHALL 接受可选的 `purpose`（空间用途说明，字符串，去除首尾空白后 1–200 个字符，不含控制字符，否则以 `COLLAB_BAD_PURPOSE` 拒绝），记录在 `space/created` 中，未提供时该字段不出现；`purpose` 创建后不可修改，总览 SHALL 返回它。Leader 角色 SHALL 只表示成员管理与关闭权限，不代表业务决定权。Leader 变化（主动转交与自动接手）MUST NOT 唤醒任何成员。

主动转交：`transferLeader(target)` SHALL 由 Leader 直接执行，在同一提交内使目标成为 Leader，无需目标确认；目标为托管成员时 MUST 以 `COLLAB_FORBIDDEN` 拒绝。

自动接手：Leader 因 `leave` 离开时，内核 SHALL 在同一提交内把 Leader 交给 `joinSeq` 最小的其他非托管 active 成员，无需其接受；没有这样的成员时 SHALL 在同一提交内关闭协作空间。Leader 不能对自己 `markGone`。`gone` 只能由 Leader 的 `markGone`、本人 `leave`、接入方的 `retireMember` 或 `revokeManager` 产生，宿主观测到的在线状态 MUST NOT 改变成员状态。

关闭后的协作空间 SHALL 只读：除命中历史收据的重放及走独立创建分支的 createSpace 外，任何写命令 MUST 以 `COLLAB_SPACE_CLOSED` 拒绝；`internal` 仍可读取。对已存在空间以新 cmdId 调用 createSpace 返回 `COLLAB_SPACE_EXISTS`，不因业务状态 closed 改为 `COLLAB_SPACE_CLOSED`。

#### Scenario: 创建者成为 Leader
- **GIVEN** provider P1 认领 `a:1` 为 agent
- **WHEN** principal `agent{test-a, a:1}` 以成员名 `aily` 创建协作空间
- **THEN** 日志首条提交含 `space/created` 与 `member/joined(aily)`，`aily` 为 active 且为 Leader

#### Scenario: Leader 直接转交
- **GIVEN** 成员 A（Leader）与 B（active）
- **WHEN** A 调用 `transferLeader(B)`
- **THEN** 提交含 `leader/changed`，B 为 Leader，A 仍为 active

#### Scenario: 不能转交给非 active 成员
- **GIVEN** A 为 Leader，`bob` 为 `invited`
- **WHEN** A 调用 `transferLeader(bob)`
- **THEN** 返回 `COLLAB_FORBIDDEN`，A 仍为 Leader

#### Scenario: Leader 离开后自动接手
- **GIVEN** A（Leader，joinSeq 1）、B（joinSeq 2）、C（joinSeq 3）均 active
- **WHEN** A 离开
- **THEN** 该提交中 B 成为 Leader，C 不变

#### Scenario: 无人可接手时关闭
- **GIVEN** 除 Leader A 外的成员均为 `declined` 或 `gone`
- **WHEN** A 离开
- **THEN** 协作空间为 `closed`；随后以新 cmdId 发起的写命令返回 `COLLAB_SPACE_CLOSED`；`internal` principal 调用 `readSince(0)` 返回全部提交；A 的 principal 读取返回 `COLLAB_MEMBER_INACTIVE`

#### Scenario: 主动关闭后仍可读取
- **GIVEN** A、B 均 active，A 为 Leader
- **WHEN** A 调用 `closeSpace`，随后 A 与 B 读取 `overview`，`internal{purpose:'host-index'}` 调用 `readSince(0)`，再由 B 以新 `cmdId` 调用 `sendMessage`、由 A 以新 `cmdId` 对该空间调用 `createSpace`
- **THEN** 三次读取均成功且日志长度不变；`sendMessage` 返回 `COLLAB_SPACE_CLOSED`；`createSpace` 返回 `COLLAB_SPACE_EXISTS`

#### Scenario: 创建时记录用途
- **WHEN** `aily` 以 `purpose:'仓库 a 与 b 的公共接口'` 创建 `space-1`，再以未提供 `purpose` 创建 `space-2`
- **THEN** `space-1` 总览的 `purpose` 为该字符串；`space-2` 的 `space/created` 事件不含 `purpose` 键

#### Scenario: 非法用途被拒
- **WHEN** 分别以 `purpose:''`、`purpose:'a\nb'`、201 个字符的 `purpose` 创建空间
- **THEN** 每次都返回 `COLLAB_BAD_PURPOSE`，存储中不存在该空间

#### Scenario: Leader 变化不唤醒
- **GIVEN** `aily` 为 Leader，`doubao` 为 active
- **WHEN** `aily` 转交 Leader 给 `doubao`，随后 `doubao` 离开使 Leader 自动交回 `aily`
- **THEN** 两个提交都不含 `dispatch/intended`

### Requirement: 命令按 cmdId 幂等

每个写命令 SHALL 携带调用方生成的非空 `cmdId`，作用域为 `(spaceId, scope)`。scope SHALL 为带类型标签的结构化值：普通成员为 `{kind:'member', name}`（托管成员换代后仍按成员名，因此换代前的收据照常命中），manager 命令为 `{kind:'manager', channel}`，createSpace 为 `{kind:'create', channel, address}`；本变更之前写入的 `{kind:'internal', purpose}` 收据照常保留并参与重放比对。收据键使用该结构化值的规范化编码，不同 kind 的 scope 永不相等；不得只用 name 或 purpose 字符串作为键。每条成功的公开写命令提交 SHALL 持久化收据 `{cmdId, scope, payloadHash, result}`，`payloadHash` 覆盖规范化后的命令名与全部参数。在通用处理顺序中，收据查找位于"协作空间未关闭"与命令前置条件之前：命中且 `payloadHash` 相同时 SHALL 返回收据中的原结果且不新增提交；`payloadHash` 不同 MUST 以 `COLLAB_CMD_CONFLICT` 拒绝。业务校验失败的命令 MUST NOT 写入收据，同一 `cmdId` 可以重试。

#### Scenario: 重放返回原结果
- **GIVEN** 命令 `cmd-1` 已成功提交为 seq 12
- **WHEN** 同一成员以相同 `cmdId` 与载荷重放
- **THEN** 返回结果引用 seq 12，日志长度不变

#### Scenario: 状态已变化的命令仍可重放
- **GIVEN** `bob` 以 `cmdId:'j-1'` 成功 `join`，此时 `bob` 已为 active
- **WHEN** `bob` 以 `j-1` 再次 `join`
- **THEN** 返回首次结果，日志长度不变

#### Scenario: 关闭后的历史重放
- **GIVEN** `cmd-9` 在协作空间关闭前已成功提交
- **WHEN** 关闭后以相同 `cmdId` 与载荷重放
- **THEN** 返回首次结果，而不是 `COLLAB_SPACE_CLOSED`

#### Scenario: 同 cmdId 不同载荷
- **GIVEN** `cmd-1` 已处理
- **WHEN** 同一成员以 `cmd-1` 提交不同内容
- **THEN** 返回 `COLLAB_CMD_CONFLICT`

#### Scenario: 重启后幂等仍成立
- **GIVEN** `cmd-1` 已提交，内核实例正常关闭
- **WHEN** 基于同一存储新建实例并重放 `cmd-1`
- **THEN** 返回原结果，日志长度不变

#### Scenario: 失败命令可以重试
- **GIVEN** `cmd-2` 因 `COLLAB_STALE_REVISION` 失败
- **WHEN** 以 `cmd-2` 和正确的 `expectedRevision` 重试
- **THEN** 成功提交

#### Scenario: 成员与旧 internal 收据互不冲突
- **GIVEN** 本变更之前的日志含一条 scope 为 `{kind:'internal', purpose:'breaker-reset'}`、`cmdId:'same-id'` 的收据，且存在 active 成员 `breaker-reset`
- **WHEN** 成员 `breaker-reset` 以 `cmdId:'same-id'` 调用 `setStatus`，再以相同载荷重放
- **THEN** 首调成功并新增一条成员 scope 收据，旧收据不变；重放返回该结果且不新增提交

#### Scenario: manager 收据与同名成员互不冲突
- **GIVEN** 存在 active 成员名为 `pet-locus`；托管 channel `pet-locus` 已获授权
- **WHEN** 接入方以 `cmdId:'x-1'` 调用 `admitMember`，成员 `pet-locus` 以 `cmdId:'x-1'` 调用 `setStatus`，二者再各自以原载荷重放
- **THEN** 两次首调都成功并各写一条收据；两次重放各自返回自己的结果，日志不新增

#### Scenario: ref 是幂等载荷的一部分
- **GIVEN** `aily` 以 `cmdId:'m-1'`、`ref:5` 成功发送消息
- **WHEN** `aily` 以 `cmdId:'m-1'`、`ref:7` 及相同正文重放
- **THEN** 返回 `COLLAB_CMD_CONFLICT`，日志长度不变，`m-1` 的原收据逐字节不变；随后以 `ref:5` 与原正文重放返回首次结果

### Requirement: 唤醒只投结构化指针，按事件类型决定接收方

内核 SHALL 在计算每条提交时，按下表得出受影响成员集合，去掉动作发起者本人与非 active 成员（邀请事件的被邀请者除外），去重后为每人记账一条普通唤醒：

| 事件 | 受影响成员 |
|---|---|
| 消息且 `needsReply:true` | 收件人 |
| 邀请 | 被邀请成员（`invited` 状态，本事件是唯一允许投递给非 active 成员的情形） |
| request `progress` 变为 `done` 或 `rejected` | request 作者（结束通知） |
| 条目创建、修改、ack、达成 `agreed`；request 变为 `accepted`；状态更新；`needsReply:false` 消息；成员加入、离开、标记离开；Leader 转交与自动接手；托管授权与撤销；托管成员接纳、换代与退役 | 无 |

内核 MUST NOT 写入 `confirm` 类投递；本变更之前日志中的 `confirm` 类投递与 `decision/*` 事件照常重放为只读历史。

普通唤醒的指针 SHALL 是只含白名单字段的对象 `{spaceId, toSeq, counts:{message, item, decision, member}, from, invited, thread, mode}`，`mode` 仅在唤醒来自指定了 `mode` 的消息时出现（见"唤醒可指定投递方式"），`from` 为发起者成员名，`invited` 仅在邀请唤醒中为 `true`（表示接收方应调用 `join` 或 `declineInvite`），`thread` 仅在唤醒来自消息或 request 时出现，值为其话题根 seq（见"按话题限制往返"）；`counts.decision` 恒为 0，保留以兼容指针形状，MUST NOT 含消息正文、条目标题或正文。邀请唤醒不改变 `invited` 成员的读写权限。

#### Scenario: 需回复消息叫醒收件人
- **GIVEN** 测试 provider 记录全部 `deliver` 调用
- **WHEN** `aily` 发送 `needsReply:true`、正文为 `SECRET-BODY` 的消息给 `doubao`
- **THEN** 恰有一次对 `doubao` 的 `deliver`；指针的键集合恰为 `spaceId, toSeq, counts, from, thread`，`thread` 等于该消息自身的 seq；序列化后不含 `SECRET-BODY`

#### Scenario: 状态更新不叫醒
- **GIVEN** 同上
- **WHEN** `aily` 更新状态文本
- **THEN** 无 `deliver` 调用

#### Scenario: 不叫醒自己
- **GIVEN** `aily` 创建承接方为 `aily` 的 request `R1`
- **WHEN** `aily` 推进 `R1` 为 `accepted` 再到 `done`
- **THEN** 无 `deliver` 调用

#### Scenario: 邀请叫醒被邀请者
- **GIVEN** 测试 provider 认领 `a:9` 且支持唤醒
- **WHEN** Leader `aily` 邀请 `a:9` 为 `bob`
- **THEN** 该提交恰含一条对 `bob` 的 `wake` 类 `dispatch/intended`；随后的 `deliver` 指针中 `invited` 为 `true` 且不含 `thread`；`bob` 读取总览仍返回 `COLLAB_MEMBER_INACTIVE`

### Requirement: 选择绑定与在线状态

本期每个成员只有一个绑定。普通唤醒 SHALL 只在该绑定 `supports.wake` 为真、且记账前对其 `presence` 的采样不为 `unreachable` 时记账，否则不记账，并在总览中把该成员标记为 `unreachable`。`presence` SHALL 在命令进入事务之前，按每个成员当时的绑定采样一次，作为该命令计算的显式输入；每个样本 SHALL 关联采样时的精确 `{channel, address}`。事务内 SHALL 只把样本用于绑定与样本一致的成员。命令需要为某个唤醒接收方判断是否记账，而该成员的当前绑定与样本不一致（采样后被换代）时，命令 MUST 以 `COLLAB_BINDING_CHANGED` 拒绝：不写提交、收据或投递，同一 cmdId 可以原样重试，重试时重新采样。内核 MUST NOT 在串行事务内调用 `presence`。总览中绑定与样本不一致的成员 SHALL 显示为 `unknown`。绑定的 `supports.confirm` 字段 SHALL 保留以兼容成员形状，但不再参与任何判断。

#### Scenario: 不可达成员不记账
- **GIVEN** agent 成员 `doubao` 的 presence 采样为 `unreachable`
- **WHEN** `aily` 发送需回复消息给 `doubao`
- **THEN** 该提交不含对 `doubao` 的 `dispatch/intended`，总览中 `doubao` 为 `unreachable`

#### Scenario: 不支持唤醒的绑定不记账
- **GIVEN** 成员 `pm` 的绑定 `supports.wake` 为假
- **WHEN** `aily` 发送需回复消息给 `pm`
- **THEN** 该提交不含对 `pm` 的 `dispatch/intended`，消息照常提交

#### Scenario: 采样后换代的收件人不沿用旧样本
- **GIVEN** 托管成员 `locus-a` 绑定 `loc:old`；`aily` 发需回复消息给它，presence 采样挂起
- **WHEN** 采样得到 `loc:old` 为 `unreachable`；消息入队前接入方把 `locus-a` 换代到 `loc:new`；消息进入事务
- **THEN** 返回 `COLLAB_BINDING_CHANGED`，日志长度不变；`aily` 以同一 cmdId 重试，若 `loc:new` 为 `reachable`，提交含对 `locus-a` 的 `dispatch/intended`，话题计数加 1

#### Scenario: 反方向换代同样不沿用
- **GIVEN** 同上，但 `loc:old` 的样本为 `reachable`，`loc:new` 为 `unreachable`；话题已有 20 条计数消息，消息以 `ref` 指向该话题
- **WHEN** 换代发生在采样之后、事务之前
- **THEN** 返回 `COLLAB_BINDING_CHANGED`（不是 `COLLAB_THREAD_LIMIT`）；同一 cmdId 重试时成功提交、不记账唤醒、话题计数仍为 20

#### Scenario: 与唤醒无关的成员换代不影响命令
- **GIVEN** 托管成员 `locus-b` 在 `aily` 发消息给 `doubao` 的采样之后被换代
- **WHEN** 消息进入事务
- **THEN** 正常提交

#### Scenario: 总览不把旧样本标到新绑定
- **GIVEN** `overview` 采样后、返回前 `locus-a` 被换代
- **WHEN** `overview` 返回
- **THEN** `presence['locus-a']` 为 `unknown`


## ADDED Requirements

### Requirement: 接入方按空间托管成员

provider MAY 声明 `managed: true`，表示它代表一个接入方（例如 Pet Locus）托管成员；未声明的 provider 为普通 provider。托管 provider 的 channel SHALL 匹配 `^[a-z][a-z0-9-]{0,31}$`。

空间状态 SHALL 含 `managers: string[]`，即当前获准托管成员的 channel，由重放推导，旧日志为空数组。

- **`allowManager({channel})`**（Leader）：`channel` 必须是一个已注册托管 provider 的 channel，且当前不在 `managers` 中，否则以 `COLLAB_BAD_CHANNEL` 拒绝。提交写入 `manager/allowed{channel}`。
- **`revokeManager({channel})`**（Leader）：`channel` 必须在 `managers` 中，否则以 `COLLAB_BAD_CHANNEL` 拒绝。同一提交写入 `manager/revoked{channel}`，并为该 channel 托管的每个 active 成员写入 `member/status gone`。

托管 provider 以内核受信构造的 principal `manager{providerId}` 执行下列命令。actor 记为 `manager:<channel>`，它不是成员名，不可能与成员名冲突：

- **`admitMember({name, address})`**
  - 只调用该 provider 的 `claim(address, 'agent')`；结果为空或 channel 不等于其注册 channel 时，以 `COLLAB_ADDRESS_UNCLAIMED` 拒绝。
  - 成员名规则与 `invite` 相同，违反时以 `COLLAB_BAD_NAME` 或 `COLLAB_NAME_TAKEN` 拒绝；地址冲突以 `COLLAB_ADDRESS_TAKEN` 拒绝。
  - 写入 `member/joined`，成员为 `{kind:'agent', status:'active', joinSeq:<本提交 seq>, managedBy:<channel>, binding}`。
- **`rebindMember({member, address})`**
  - 目标须为本 channel 托管的 active 成员：不是本 channel 托管的以 `COLLAB_FORBIDDEN` 拒绝，状态不是 active 的以 `COLLAB_MEMBER_INACTIVE` 拒绝。
  - 新地址的认领与唯一性规则同 `admitMember`。
  - 写入 `member/rebound{name, binding}`。重放时旧绑定追加到 `previousBindings`，成员名、状态、`joinSeq` 与 `statusText` 不变。
- **`retireMember({member})`**
  - 目标规则同 `rebindMember`。
  - 写入 `member/status gone`。

托管成员的准入、换代与退役都 MUST NOT 唤醒任何成员，包括被接纳者本人。

台账中的托管成员记录只是行使成员权限的必要条件，不是充分条件：内核只按 principal 的 `{channel, address}` 反查当前绑定，而能构造该 principal 的只有宿主。宿主 MUST 在每次调用时按接入方自己的绑定重新解析调用者（见 dsh-collab"工具调用者可解析为托管成员"）。

#### Scenario: 授权后接纳、换代与退役
- **GIVEN** 托管 provider P（channel `pet-locus`）认领 `loc:*`；Leader `aily` 调用 `allowManager({channel:'pet-locus'})`
- **WHEN** P 以 manager principal 依次调用 `admitMember({name:'locus-7f3a', address:'loc:1'})`、`rebindMember({member:'locus-7f3a', address:'loc:2'})`、`retireMember({member:'locus-7f3a'})`
- **THEN**
  - 四个提交都不含 `dispatch/intended`；
  - 换代后 `locus-7f3a.binding.address` 为 `loc:2`，`previousBindings` 恰为 `[{channel:'pet-locus', address:'loc:1'}]`，`joinSeq` 不变；
  - principal `agent{pet-locus, loc:1}` 发送消息返回 `COLLAB_NOT_MEMBER`；
  - 退役后成员状态为 `gone`；
  - 三个托管命令事件的 actor 都是 `manager:pet-locus`。

#### Scenario: 未授权的接入方与非成员不可区分
- **GIVEN**
  - S1 为 open，`managers` 为空；
  - S2 已关闭，未授权 `pet-locus`；
  - S3 不存在；
  - S4 曾授权 `pet-locus`，后又撤销。
- **WHEN** P 对四个空间分别调用 `admitMember`
- **THEN** S1、S2、S4 返回 `COLLAB_NOT_MEMBER`；S3 返回 `COLLAB_SPACE_NOT_FOUND`（宿主统一映射为不可用，见 dsh-collab）；四个空间的日志长度都不变

#### Scenario: 不能授权普通 provider 或重复授权
- **GIVEN** 已注册普通 provider（channel `dsh-session`）与托管 provider P；`pet-locus` 已被授权
- **WHEN** Leader 分别以 `dsh-session`、`unknown-x`、`pet-locus` 调用 `allowManager`，再以 `other-y` 调用 `revokeManager`
- **THEN** 四次都返回 `COLLAB_BAD_CHANNEL`，日志长度不变

#### Scenario: 非 Leader 不能授权
- **GIVEN** `doubao` 为 active 非 Leader 成员
- **WHEN** `doubao` 调用 `allowManager({channel:'pet-locus'})`
- **THEN** 返回 `COLLAB_FORBIDDEN`

#### Scenario: 撤销同时退役全部托管成员
- **GIVEN** `pet-locus` 已授权，托管成员 `locus-a`、`locus-b` 为 active，`locus-c` 已退役
- **WHEN** Leader 调用 `revokeManager({channel:'pet-locus'})`，随后 P 调用 `admitMember`
- **THEN**
  - 撤销提交恰含 `manager/revoked` 与 `locus-a`、`locus-b` 各一条 `member/status gone`，且不含 `dispatch/intended`；
  - `managers` 为空数组；
  - 之后的 `admitMember` 返回 `COLLAB_NOT_MEMBER`。

#### Scenario: 只能管理本 channel 的成员
- **GIVEN** 托管 provider P（`pet-locus`）与 Q（`other-loc`）都已获授权；`locus-a` 由 P 托管，`doubao` 为普通成员
- **WHEN** Q 对 `locus-a` 调用 `retireMember`，P 对 `doubao` 调用 `rebindMember`
- **THEN** 两次都返回 `COLLAB_FORBIDDEN`，成员状态与绑定不变

#### Scenario: 历史地址不能复用
- **GIVEN** `locus-a` 已从 `loc:1` 换代到 `loc:2`
- **WHEN** P 以 `loc:1` 接纳 `locus-b`，再把 `locus-a` 换代回 `loc:1`
- **THEN** 两次都返回 `COLLAB_ADDRESS_TAKEN`

#### Scenario: 认领挂起期间被撤销
- **GIVEN** P 已调用 `admitMember({name:'locus-a', address:'loc:1'})`，其 `claim` 被可控 Promise 挂起
- **WHEN** Leader 调用 `revokeManager({channel:'pet-locus'})`，随后释放 `claim`
- **THEN** `admitMember` 返回 `COLLAB_NOT_MEMBER`，日志中没有 `locus-a`

#### Scenario: 认领挂起期间目标被标记离开
- **GIVEN** `locus-a` 为 active；P 调用 `rebindMember({member:'locus-a', address:'loc:2'})`，其认领被挂起
- **WHEN** Leader 对 `locus-a` 调用 `markGone`，随后释放认领
- **THEN** `rebindMember` 返回 `COLLAB_MEMBER_INACTIVE`，`locus-a` 的绑定仍为原地址

#### Scenario: 并发的同 cmdId 接纳只提交一次
- **WHEN** P 以同一 `cmdId:'adm-1'` 和相同载荷并发调用两次 `admitMember`，两次认领都挂起后依次释放
- **THEN** 两次返回同一 seq；日志恰有一条 `member/joined(locus-a)`

#### Scenario: 认领期间地址被抢占
- **WHEN** P 以不同 cmdId 并发调用 `admitMember({name:'locus-a', address:'loc:1'})` 与 `admitMember({name:'locus-b', address:'loc:1'})`，先入队者提交后，后者才进入事务
- **THEN** 后者返回 `COLLAB_ADDRESS_TAKEN`

#### Scenario: 收据重放不再认领
- **GIVEN** P 以 `cmdId:'adm-1'` 成功接纳 `locus-a`；此后 P 的 `claim` 一经调用即抛错
- **WHEN** P 以 `adm-1` 与原载荷重放
- **THEN** 返回首次结果，`claim` 调用次数为 0

#### Scenario: 托管 provider 声明非法 channel
- **GIVEN** 托管 provider 的 channel 为 `Pet Locus`
- **WHEN** Leader 以该字符串调用 `allowManager`
- **THEN** 返回 `COLLAB_BAD_CHANNEL`

#### Scenario: 换代后旧收据仍按成员名命中
- **GIVEN** `locus-a`（地址 `loc:1`）以 `cmdId:'m-1'` 发送消息成功，随后被换代到 `loc:2`
- **WHEN** principal `agent{pet-locus, loc:2}` 以 `m-1` 与原载荷重放
- **THEN** 返回首次结果，日志长度不变

### Requirement: 调用级守卫在提交与读取边界重验

写命令与读取的上下文 SHALL 接受可选的 `guard`：由宿主在调用时创建的同步函数 `() => boolean`。它表示"发起本次操作的那个调用方，此刻是否仍然有效"。内核不解读守卫检查的内容（执行会话对象、接入代际、绑定等由宿主决定），只在下列线性化点同步调用它，检查与其后动作之间 MUST NOT 再有 await：

- **写命令**：串行事务内、该命令最后一个 await 之后，在提交，或返回收据中的原结果之前；
- **读取**：`overview`、`readSince`、`project`、`readConvention` 在最后一个 await 之后、返回数据之前。

守卫返回非 `true` 或抛错时，MUST 以 `COLLAB_CALLER_STALE` 拒绝，不写提交、收据或投递，也不返回空间数据，空间不进入 `failed`。该检查不改变成员状态。

以下调用 MUST 携带守卫，否则以 `COLLAB_FORBIDDEN` 拒绝，早于任何 provider 调用：

- 地址 channel 属于托管 provider 的 agent 或 provider principal；
- manager principal。

其它调用可以不带守卫；不带时行为与本变更之前相同。

#### Scenario: 入口通过后、提交前守卫失效
- **GIVEN** `locus-a`（地址 `loc:1`）为 active 托管成员；presence 采样被可控 Promise 挂起
- **WHEN** `locus-a` 带守卫发送消息；采样挂起期间宿主让该守卫返回假（台账未退役），再释放采样
- **THEN** 返回 `COLLAB_CALLER_STALE`，日志长度不变，无 `dispatch/intended`

#### Scenario: 读取期间守卫失效不返回数据
- **GIVEN** 同上，`overview` 的 presence 采样被挂起
- **WHEN** 守卫变为假后释放采样
- **THEN** `overview` 返回 `COLLAB_CALLER_STALE`

#### Scenario: 守卫失效时连收据也不返回
- **GIVEN** `locus-a` 已以 `cmdId:'m-1'` 成功发送消息
- **WHEN** 以 `m-1`、原载荷和一个返回假的守卫重放
- **THEN** 返回 `COLLAB_CALLER_STALE`；改用返回真的守卫重放时返回首次结果

#### Scenario: 托管 channel 的调用缺少守卫被拒
- **WHEN** principal `agent{pet-locus, loc:1}` 不带守卫发送消息；manager principal 不带守卫调用 `admitMember`
- **THEN** 两次都返回 `COLLAB_FORBIDDEN`，provider 的 `claim` 与 `presence` 调用次数都为 0

#### Scenario: 守卫抛错按失效处理
- **WHEN** 普通成员带一个会抛错的守卫发送消息
- **THEN** 返回 `COLLAB_CALLER_STALE`，空间仍可正常提交其它命令

#### Scenario: 普通成员不带守卫不受影响
- **WHEN** 普通成员不带守卫发送消息并读取总览
- **THEN** 两次都成功

### Requirement: 托管成员不承担 Leader 与自助成员操作

托管成员 MUST NOT 成为 Leader：

- `transferLeader` 的目标是托管成员时，MUST 以 `COLLAB_FORBIDDEN` 拒绝；
- Leader 离开时自动接手 SHALL 只在非托管 active 成员中按 `joinSeq` 选择；没有这样的成员时，SHALL 在同一提交关闭空间。

托管成员调用 `join`、`declineInvite`、`leave` 时 MUST 以 `COLLAB_FORBIDDEN` 拒绝，因为它的进出由接入方决定。Leader 仍 SHALL 可以对托管成员 `markGone`；被标记离开的托管成员不能被换代或复活。

`invite` 与 `createSpace` 的地址认领 SHALL 只询问普通 provider，因此托管 provider 的地址不能以邀请方式加入，托管 channel 上的 principal 也不能创建空间（结果为 `COLLAB_ADDRESS_UNCLAIMED`）。

#### Scenario: Leader 离开时跳过托管成员
- **GIVEN** `aily`（Leader，joinSeq 1）、托管成员 `locus-a`（joinSeq 2）、`doubao`（joinSeq 3），三者都为 active
- **WHEN** `aily` 离开
- **THEN** 该提交中 `doubao` 成为 Leader

#### Scenario: 只剩托管成员时关闭
- **GIVEN** `aily` 为 Leader，其余 active 成员都是托管成员
- **WHEN** `aily` 离开
- **THEN** 该提交含 `space/closed`，托管成员此后的写命令返回 `COLLAB_SPACE_CLOSED`

#### Scenario: 不能转交给托管成员
- **WHEN** Leader 调用 `transferLeader({member:'locus-a'})`
- **THEN** 返回 `COLLAB_FORBIDDEN`，Leader 不变

#### Scenario: 托管成员不能自行离开
- **WHEN** `locus-a` 的 principal 调用 `leave`
- **THEN** 返回 `COLLAB_FORBIDDEN`，`locus-a` 仍为 active

#### Scenario: Leader 可以标记托管成员离开
- **WHEN** Leader 对 `locus-a` 调用 `markGone`，随后 P 对 `locus-a` 调用 `rebindMember`
- **THEN** `locus-a` 为 `gone`；换代返回 `COLLAB_MEMBER_INACTIVE`

#### Scenario: 邀请不经托管 provider 认领
- **GIVEN** 托管 provider P 认领 `loc:9`，没有普通 provider 认领它
- **WHEN** Leader 邀请 `loc:9`，principal `agent{pet-locus, loc:9}` 创建新空间
- **THEN** 两次都返回 `COLLAB_ADDRESS_UNCLAIMED`，P 的 `claim` 调用次数为 0

### Requirement: 条目与消息可携带接入方附加数据

`createItem` 与 `sendMessage` SHALL 接受可选 `ext`，它必须满足：

- 是普通 JSON 对象，不是数组或 `null`；
- 递归只含 JSON 值（对象、数组、字符串、有限数字、布尔、`null`）；
- 按存储行校验相同的规范化规则序列化后，UTF-8 字节不超过 4096。

不满足时 MUST 以 `COLLAB_BAD_EXT` 拒绝，不写提交、收据或投递。该校验位于既有业务校验之后、`ref` 校验之前。

`ext` 的持久化与修改规则：

- SHALL 原样持久化到 `message/sent.message.ext` 或 `item/created.item.ext`；未提供时该键 MUST 不出现。
- 条目后续事件携带的快照 SHALL 保留创建时的 `ext`；`reviseItem` 的 `changes` 含 `ext` 时，MUST 以 `COLLAB_BAD_ITEM`（字段 `changes`）拒绝。
- `ext` 属于幂等载荷。

内核 MUST NOT 解读 `ext`：它不参与授权、唤醒、话题推导或计数，也 MUST NOT 出现在 `project` 投影与唤醒指针中。`ext` 的来源只由作者成员的绑定 channel 表明。

#### Scenario: 附加数据原样存储并随修改保留
- **WHEN** `aily` 以 `ext:{source:{chat:'oc_1', msg:'om_2'}}` 创建条目 `T1`，再修改 `T1` 的标题
- **THEN** `item/created` 与 `item/revised` 中 `T1.ext` 都深度等于该对象；投影文本不含 `oc_1`

#### Scenario: 非法附加数据被拒
- **WHEN** `aily` 分别以 `ext:[1]`、`ext:null`、`ext:'x'`、`ext:{n:Infinity}`、`ext:{a:undefined}`、规范化后 4097 字节的对象发送消息
- **THEN** 每次都返回 `COLLAB_BAD_EXT`，日志长度不变，无该 cmdId 的收据

#### Scenario: 不能通过修改替换附加数据
- **WHEN** `aily` 以 `changes:{ext:{a:1}}` 修改 `T1`
- **THEN** 返回 `COLLAB_BAD_ITEM`，字段为 `changes`

#### Scenario: 附加数据不进入指针
- **WHEN** `aily` 以 `needsReply:true`、`ext:{secret:'EXT-SECRET'}` 发消息给 `doubao`
- **THEN** 投递给 `doubao` 的指针序列化后不含 `EXT-SECRET` 与 `ext` 键

#### Scenario: 附加数据是幂等载荷的一部分
- **GIVEN** `aily` 以 `cmdId:'e-1'`、`ext:{a:1}` 成功发送消息
- **WHEN** 以 `e-1`、`ext:{a:2}` 和相同正文重放
- **THEN** 返回 `COLLAB_CMD_CONFLICT`

### Requirement: 唤醒可指定投递方式

provider MAY 实现同步方法 `supportsMode(mode): boolean`。`sendMessage` SHALL 接受可选 `mode`，它必须满足：

- 是匹配 `^[a-z][a-z0-9-]{0,31}:[a-z][a-z0-9-]{0,31}$` 的字符串，否则以 `COLLAB_BAD_MODE` 拒绝；
- 只能与 `needsReply:true` 同用，否则以 `COLLAB_BAD_MODE` 拒绝；
- 收件人当前绑定 channel 的 provider 必须实现 `supportsMode` 并返回 `true`，否则以 `COLLAB_MODE_UNSUPPORTED` 拒绝。`supportsMode` 抛错视为不支持。

该校验位于 `ref` 校验之后、话题上限检查之前，在串行事务内同步执行。

`mode` SHALL 持久化到 `message/sent.message.mode`。该消息产生的 `wake` 类 `dispatch/intended` SHALL 记录 `delivery.mode`，指针 SHALL 带 `mode`。邀请、结束通知与未指定 `mode` 的消息，其投递与指针 MUST NOT 含 `mode`。

`mode` 只决定 provider 怎样投递，MUST NOT 改变唤醒接收方、presence 与 `supports.wake` 的判断、话题计数和上限。

#### Scenario: 支持的方式随投递传递
- **GIVEN** `doubao` 的 provider 对 `pet-locus:inquiry` 返回支持
- **WHEN** `aily` 以 `needsReply:true`、`mode:'pet-locus:inquiry'` 发消息给 `doubao`
- **THEN** 提交中 `message.mode` 与 `delivery.mode` 都为该值；`deliver` 收到的指针 `mode` 为该值；该话题计数加 1

#### Scenario: 不支持或非法方式被拒
- **WHEN** `aily` 分别以 provider 不支持的 `x:y`、格式非法的 `inquiry`、`needsReply:false` 加合法 `mode` 发消息
- **THEN** 依次返回 `COLLAB_MODE_UNSUPPORTED`、`COLLAB_BAD_MODE`、`COLLAB_BAD_MODE`，日志长度不变

#### Scenario: supportsMode 抛错视为不支持
- **GIVEN** 收件人 provider 的 `supportsMode` 抛错
- **WHEN** `aily` 带合法 `mode` 发需回复消息
- **THEN** 返回 `COLLAB_MODE_UNSUPPORTED`，空间不进入 `failed`

#### Scenario: 方式不绕过话题上限
- **GIVEN** 话题 5 已有 20 条计数消息
- **WHEN** `aily` 以 `ref:5` 和受支持的 `mode` 发需回复消息
- **THEN** 返回 `COLLAB_THREAD_LIMIT`

#### Scenario: 普通唤醒不带方式
- **WHEN** `aily` 不带 `mode` 发需回复消息，并邀请新成员
- **THEN** 两条 `dispatch/intended` 与对应指针都没有 `mode` 键
