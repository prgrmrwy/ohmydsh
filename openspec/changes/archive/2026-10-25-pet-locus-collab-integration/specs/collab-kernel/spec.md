## ADDED Requirements

### Requirement: 接入方代人处置其托管成员的 request

内核 SHALL 提供 manager 命令 `disposeManagedRequest({itemId, progress})`，供接入方代表本机用户处置由其托管成员登记的 request。它按 manager 命令的两阶段流程执行（不认领；事务内依次判定空间存在、收据、授权、关闭、业务校验、守卫），收据 scope 为 `{kind:'manager', channel}`。

业务校验：
- 条目必须存在且 `kind` 为 `request`，否则 `COLLAB_ITEM_NOT_FOUND`（不存在）或 `COLLAB_FORBIDDEN`（非 request）；
- 条目作者必须是由该 channel 托管的成员（`managedBy` 等于该 channel，作者已退役或被 `markGone` 仍算），否则 `COLLAB_FORBIDDEN`；
- 条目状态为 `escalated` 或 `decided` 时分别以 `COLLAB_ITEM_ESCALATED`、`COLLAB_DECIDED_LOCKED` 拒绝；
- 允许的转换为 `open → accepted`、`open → done`、`open → rejected`、`accepted → done`、`accepted → rejected`，其余以 `COLLAB_BAD_TRANSITION` 拒绝。

成功时提交一条 `request/progressed` 事件，actor 为 `manager:<channel>`。该命令 MUST NOT 产生任何 `dispatch/intended`，也不计入任何话题。终态不可逆，因此 assignee 此后的 `advanceRequest` 以 `COLLAB_BAD_TRANSITION` 拒绝。

#### Scenario: 代人受理不唤醒
- **GIVEN** 空间 S 已授权 `pet-locus`；托管成员 `pet` 创建 request `todo-1`（assignee `main`，open）
- **WHEN** manager 以 `cmdId:'acc-1'` 调用 `disposeManagedRequest({itemId:'todo-1', progress:'accepted'})`，再以相同参数重试
- **THEN** 两次返回同一 seq；`todo-1.progress` 为 `accepted`；提交中 actor 为 `manager:pet-locus`，不含 `dispatch/intended`

#### Scenario: 不经受理直接完成
- **GIVEN** 承上但 `todo-1` 为 open
- **WHEN** manager 推进为 `done`
- **THEN** 成功；随后 `main` 调用 `advanceRequest` 推进为 `rejected` 返回 `COLLAB_BAD_TRANSITION`

#### Scenario: 不能处置非托管成员的 request
- **GIVEN** 普通成员 `main` 创建 request `r-2`（assignee `main`）
- **WHEN** manager 调用 `disposeManagedRequest({itemId:'r-2', progress:'done'})`
- **THEN** 返回 `COLLAB_FORBIDDEN`，日志长度不变

#### Scenario: 作者退役后仍可处置
- **GIVEN** `pet` 登记 `todo-3` 后被 `retireMember`
- **WHEN** manager 推进 `todo-3` 为 `rejected`
- **THEN** 成功，不含 `dispatch/intended`

#### Scenario: 未授权空间不可区分
- **GIVEN** 空间 T 未授权 `pet-locus`
- **WHEN** manager 对 T 调用 `disposeManagedRequest`
- **THEN** 返回 `COLLAB_NOT_MEMBER`，与对不存在空间的 `admitMember` 同类

### Requirement: 提交记录携带提交时间

内核 SHALL 为本变更之后写入的每条提交记录（`command` 与 `completion`）写入 `at`：在串行事务内、持久化之前取一次 `ServiceOptions.now()`（缺省 `Date.now`）得到的毫秒整数。`at` SHALL 受提交记录既有校验和覆盖。收据命中的重放 MUST NOT 写入新提交，因此 MUST NOT 产生新的 `at`。读取 SHALL 原样返回 `at`。本变更之前没有 `at` 的提交照常重放，内核 MUST NOT 为其补写时间。

#### Scenario: 新提交带时间且重放不刷新
- **GIVEN** `now` 依次返回 1000、2000
- **WHEN** 成员以 `cmdId:'c-1'` 创建条目，再以相同 cmdId 与载荷重试
- **THEN** 日志只有一条该命令的提交，其 `at` 为 1000；重试返回同一结果，日志长度不变

#### Scenario: 旧日志无时间照常重放
- **GIVEN** 本变更之前写入、提交记录不含 `at` 的日志
- **WHEN** 新内核加载并读取 `readSince(0)`
- **THEN** 加载成功，返回的旧提交不含 `at`；之后的新提交含 `at`

#### Scenario: 篡改时间被识别为损坏
- **GIVEN** 一条带 `at` 的提交
- **WHEN** 离线把该行的 `at` 改为别的值后重新加载
- **THEN** 加载按既有损坏处理失败，不使用被改的时间

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
| `admitMember`、`rebindMember`、`retireMember`、`disposeManagedRequest` | manager | 其 channel 在 `managers` 中（否则 `COLLAB_NOT_MEMBER`，与非成员不可区分）；目标规则见"接入方按空间托管成员" |

表中允许 agent、provider 的命令，manager principal 调用时 MUST 以 `COLLAB_FORBIDDEN` 拒绝；manager 命令由 agent 或 provider principal 调用时同样 MUST 以 `COLLAB_FORBIDDEN` 拒绝。manager principal 不能读取。

读取 `overview`、`readSince`、`project`、`readConvention` SHALL 允许成员（任意状态为 `active` 的成员）与 `internal{purpose:'host-index'}`。

处理顺序 SHALL 按命令所属的两个分支之一执行：

- **普通成员命令**（除 `createSpace` 与三个 manager 命令外的全部写命令）：① principal 稳定校验（brand、provider 已注册且 `on.channel` 等于注册 channel；internal principal 在此 MUST 立即以 `COLLAB_FORBIDDEN` 拒绝，早于任何 provider 调用、presence 采样与空间状态检查）→ ② 协作空间存在（否则 `COLLAB_SPACE_NOT_FOUND`）→ ③ 按 `{channel, address}` 反查成员，不检查其状态（失败为 `COLLAB_NOT_MEMBER`）→ ④ `cmdId` 收据查找 → ⑤ 协作空间未关闭 → ⑥ 本表前置条件 → ⑦ 命令专属幂等键 → ⑧ 业务校验。
- **manager 命令**分两个阶段：
  - **事务外预备**：
    - ① principal 稳定校验：agent、provider、internal principal 在此 MUST 以 `COLLAB_FORBIDDEN` 拒绝。
    - ② 仅对 `admitMember`、`rebindMember`（`retireMember`、`disposeManagedRequest` 不认领）：当前已加载的日志中已有同 scope、同 cmdId 的收据时，不认领；否则只调用该 provider 的 `claim(address, 'agent')` 一次。
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

### Requirement: request 条目的承接流程

`request` 条目的 `progress` SHALL 只能按 `open → accepted → done`、`open → rejected`、`accepted → rejected` 推进，由 `assignee` 经 `advanceRequest` 推进；另外，托管该 request 作者的接入方可经 `disposeManagedRequest` 代人处置（见"接入方代人处置其托管成员的 request"）。`advanceRequest` 仅 `assignee` 可调用，且与条目状态与 revision 无关。非法跳转 MUST 以 `COLLAB_BAD_TRANSITION` 拒绝；非承接方推进 MUST 以 `COLLAB_FORBIDDEN` 拒绝。条目状态为 `escalated` 或 `decided`（只可能来自旧日志）的 request MUST NOT 被推进，分别以 `COLLAB_ITEM_ESCALATED`、`COLLAB_DECIDED_LOCKED` 拒绝；该检查位于收据查找之后。经 `advanceRequest` 推进为 `accepted` MUST NOT 唤醒任何成员；经 `advanceRequest` 推进为终态 `done` 或 `rejected` SHALL 唤醒 request 的作者（结束通知；作者即承接方本人时不唤醒）。终态不可逆，因此每个 request 至多产生一次结束通知。

#### Scenario: 承接方正常推进
- **GIVEN** `R1` 的 `assignee` 为 `doubao`，`progress` 为 `open`
- **WHEN** `doubao` 依次推进为 `accepted`、`done`
- **THEN** `R1.progress` 为 `done`，日志新增两条含 `request/progressed` 的提交；推进为 `accepted` 的提交不含 `dispatch/intended`，推进为 `done` 的提交恰含一条对作者 `aily` 的 `wake` 类 `dispatch/intended`

#### Scenario: 非承接方推进被拒
- **GIVEN** 同上
- **WHEN** `aily` 推进为 `accepted`
- **THEN** 返回 `COLLAB_FORBIDDEN`

#### Scenario: 非法跳转被拒
- **GIVEN** `R1` 为 `open`
- **WHEN** `doubao` 直接推进为 `done`
- **THEN** 返回 `COLLAB_BAD_TRANSITION`

#### Scenario: 拒绝也通知作者
- **GIVEN** 作者 `aily` 的 `R2` 承接方为 `doubao`，`progress` 为 `open`
- **WHEN** `doubao` 推进为 `rejected`
- **THEN** 该提交恰含一条对 `aily` 的 `wake` 类 `dispatch/intended`

#### Scenario: 自己给自己的 request 不唤醒
- **GIVEN** `aily` 创建承接方为 `aily` 的 `R3`
- **WHEN** `aily` 推进为 `accepted` 再到 `done`
- **THEN** 两个提交都不含 `dispatch/intended`

#### Scenario: 旧日志中锁定的 request 不能推进
- **GIVEN** 本变更之前的日志中 request `R4` 状态为 `decided`、`R5` 状态为 `escalated`，二者 `progress` 都为 `open`、承接方为 `doubao`
- **WHEN** 新内核加载后 `doubao` 分别推进二者为 `accepted`
- **THEN** 分别返回 `COLLAB_DECIDED_LOCKED` 与 `COLLAB_ITEM_ESCALATED`，日志长度不变，无 `dispatch/intended`
