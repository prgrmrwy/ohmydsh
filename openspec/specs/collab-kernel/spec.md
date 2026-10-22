# collab-kernel Specification

## Purpose
为人与 agent 跨边界协作提供不依赖宿主的领域内核，定义协作空间、成员与条目协商、人类决策证据、投递与熔断、原子事件存储及当前状态投影的统一规则，使宿主和通道可通过注入接口接入协作。
## Requirements
### Requirement: 协作内核不依赖任何宿主

`packages/collab-kernel` SHALL 是不依赖 DSH 的独立库：其源码与运行时依赖 MUST NOT 引用任何 `@deepseek-ai/*` 包，MUST NOT 引用 ohmydsh 仓库内其他包或 `scripts/` 路径。宿主能力 SHALL 只经 SPI 注入，持久化 SHALL 只经存储接口注入，principal SHALL 只经内核导出的受信构造函数创建。依赖边界扫描器 SHALL 仅是测试辅助工具，不进入运行时源码或包的公开 exports。

#### Scenario: 依赖图不含宿主包
- **GIVEN** `packages/collab-kernel` 的源码与 `package.json`
- **WHEN** 运行依赖边界检查，扫描全部静态 `import`、`export … from`、`require`、动态 `import()` 说明符与 `dependencies`
- **THEN** 违规列表为空

#### Scenario: 引入宿主依赖时报出违规
- **GIVEN** 测试夹具中一个源文件含 `import '@deepseek-ai/dsh-agent'`
- **WHEN** 依赖边界检查扫描该夹具
- **THEN** 返回恰好一条违规，包含该文件路径与说明符 `@deepseek-ai/dsh-agent`

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

### Requirement: 成员模型与地址唯一

成员 SHALL 表示为 `{name, kind: human|agent, status: invited|active|declined|gone, joinSeq, binding}`，`binding` 为 `{channel, address, supports:{wake, confirm}}`，本期每个成员恰有一个绑定。成员名 SHALL 匹配 `^[a-z][a-z0-9-]{0,31}$`，在协作空间内唯一且不可复用，否则以 `COLLAB_BAD_NAME` / `COLLAB_NAME_TAKEN` 拒绝。`{channel, address}` 在协作空间内 SHALL 唯一且不可复用（包括 `declined`、`gone` 成员占用的地址），冲突 MUST 以 `COLLAB_ADDRESS_TAKEN` 拒绝。

`invite(address, name, kind)` 与 `createSpace` 的首成员 SHALL 都经 provider 认领确定绑定：内核把 `(address, kind)` 交给全部已注册 provider 的 `claim`，只有恰好一个 provider 返回非空结果时才写入成员；无人认领 MUST 以 `COLLAB_ADDRESS_UNCLAIMED` 拒绝；多个认领 MUST 以 `COLLAB_ADDRESS_AMBIGUOUS` 拒绝并返回候选 channel 列表。`createSpace` 由 agent principal 发起时首成员 `kind` MUST 为 `agent`，否则以 `COLLAB_BAD_KIND` 拒绝；由 provider principal 发起时认领的 channel MUST 等于该 provider 的注册 channel。

入站反查 SHALL 按 `{channel, address}` 精确匹配。

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

#### Scenario: provider 按 kind 拒绝认领
- **GIVEN** P1 只认领 `kind:'agent'`，且无其他 provider
- **WHEN** Leader 以 `kind:'human'` 邀请 `a:5`
- **THEN** 返回 `COLLAB_ADDRESS_UNCLAIMED`

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

`createSpace` SHALL 创建协作空间，调用方成为首个 active 成员并持有 Leader 角色。Leader 角色 SHALL 只表示成员管理与关闭权限，不代表业务决定权。

主动转交：`transferLeader(target)` SHALL 由 Leader 直接执行，在同一提交内使目标成为 Leader，无需目标确认。

自动接手：Leader 因 `leave` 离开时，内核 SHALL 在同一提交内把 Leader 交给 `joinSeq` 最小的其他 active 成员，无需其接受；没有其他 active 成员时 SHALL 在同一提交内关闭协作空间。Leader 不能对自己 `markGone`。`gone` 只能由 Leader 的 `markGone` 或本人 `leave` 产生，宿主观测到的在线状态 MUST NOT 改变成员状态。

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
- **WHEN** A 调用 `closeSpace`，随后 A 与 B 读取 `overview`，`internal{purpose:'breaker-reset'}` 调用 `readSince(0)`，再由 B 以新 `cmdId` 调用 `sendMessage`、由 A 以新 `cmdId` 对该空间调用 `createSpace`
- **THEN** 三次读取均成功且日志长度不变；`sendMessage` 返回 `COLLAB_SPACE_CLOSED`；`createSpace` 返回 `COLLAB_SPACE_EXISTS`

### Requirement: 条目状态转换表

条目 SHALL 有 `kind`（`charter|request|other`）、`title`（1–200 字符）、`body`（≤ 64KiB）、`revision`（创建时为 1）、`status`（创建时为 `draft`）、`requiredAcks[]`（创建时指定，须为 active 成员，可为空）、`acks{member: revision}`、`deciders[]`（创建时指定，须为 active 的人类成员，可为空）、`agentEditCount`（创建时为 0），`request` 另有 `assignee`（须为 active 成员）与 `progress`（创建时为 `open`）。违反上述约束的 `createItem` MUST 以 `COLLAB_BAD_ITEM` 拒绝，错误详情指明字段。`reviseItem` SHALL 只能修改 `title`、`body`、`requiredAcks`、`deciders`，同样受上述约束。

条目状态 SHALL 只按下表转换，表外组合 MUST 以表中所列错误拒绝且不写事件：

| 当前状态 | `reviseItem` | `ackItem` | `requestDecision` | 合格的 `confirmDecision` |
|---|---|---|---|---|
| `draft` | → `draft`（agent 修改可能升级为 `escalated`） | 记录 ack；`requiredAcks` 非空且全部满足 → `agreed` | 允许 | → `decided` |
| `agreed` | → `draft` | `COLLAB_ITEM_SETTLED` | 允许 | → `decided` |
| `escalated` | `COLLAB_ITEM_ESCALATED` | `COLLAB_ITEM_ESCALATED` | 允许 | → `decided` |
| `decided` | `COLLAB_DECIDED_LOCKED` | `COLLAB_DECIDED_LOCKED` | `COLLAB_DECIDED_LOCKED` | 不可能（无 open 请求） |

`decided` SHALL 是终态，本期没有复议；需要改变已决定内容时，成员 SHALL 新建条目。每次 `reviseItem` SHALL 携带 `expectedRevision`，不等于当前 revision MUST 以 `COLLAB_STALE_REVISION` 拒绝（详情含 `currentRevision`）；生效后 `revision` 加 1、`acks` 清空。`ackItem` SHALL 携带 revision，只接受当前 revision。`request` 的 `progress` 独立于条目状态与 revision（见"request 条目的承接流程"）。

#### Scenario: 全员 ack 后 agreed
- **GIVEN** 条目 `C1` 为 `draft` revision 2，`requiredAcks` 为 `aily`、`doubao`
- **WHEN** 两者都对 revision 2 ack
- **THEN** `C1` 状态为 `agreed`

#### Scenario: 修改使旧 ack 失效
- **GIVEN** `C1` 为 `draft` revision 2，`aily` 已 ack revision 2
- **WHEN** `doubao` 以 `expectedRevision:2` 修改 `C1`
- **THEN** `C1` 为 `draft` revision 3，`acks` 为空对象

#### Scenario: 过期 revision 修改被拒
- **GIVEN** `C2` revision 为 4
- **WHEN** 以 `expectedRevision:3` 修改
- **THEN** 返回 `COLLAB_STALE_REVISION`，`currentRevision` 为 4

#### Scenario: 过期 revision 的 ack 被拒
- **GIVEN** `C1` 为 `draft` revision 3
- **WHEN** `aily` 对 revision 2 ack
- **THEN** 返回 `COLLAB_STALE_REVISION`

#### Scenario: escalated 不能经修改或 ack 离开
- **GIVEN** `C3` 为 `escalated` revision 5
- **WHEN** 人类成员以 `expectedRevision:5` 修改，随后 agent ack revision 5
- **THEN** 两次分别返回 `COLLAB_ITEM_ESCALATED`，`C3` 仍为 `escalated` revision 5

#### Scenario: decided 是终态
- **GIVEN** `C3` 为 `decided`
- **WHEN** 成员依次 ack、修改、发起决策请求
- **THEN** 三次都返回 `COLLAB_DECIDED_LOCKED`，`C3` 不变

#### Scenario: 非法条目字段
- **GIVEN** 人类成员 `pm` 与 agent 成员 `aily`
- **WHEN** 创建 `deciders` 为 `['aily']` 的条目
- **THEN** 返回 `COLLAB_BAD_ITEM`，详情字段为 `deciders`

### Requirement: 消息与状态文本

`sendMessage(to, body, needsReply)` SHALL 要求：`to` 为当前 active 的其他成员（否则 `COLLAB_BAD_RECIPIENT`）；`body` 为字符串，UTF-8 编码后 1 字节至 16 KiB（否则 `COLLAB_BAD_MESSAGE`）；`needsReply` 仅在未提供时缺省为 `false`；提供时 MUST 为布尔值，否则以 `COLLAB_BAD_MESSAGE` 拒绝，不做隐式类型转换。`setStatus(text)` SHALL 只修改调用方自己的状态文本；`text` 为字符串，长度不超过 500 个字符，空字符串表示清空（否则 `COLLAB_BAD_STATUS`）。

#### Scenario: 正常发送消息
- **GIVEN** `aily` 与 `doubao` 均为 active
- **WHEN** `aily` 发送正文 `hi`、未给 `needsReply` 的消息给 `doubao`
- **THEN** 提交含 `message/sent`，`needsReply` 为 `false`

#### Scenario: 收件人不是 active 成员
- **GIVEN** `bob` 为 `invited`
- **WHEN** `aily` 发送消息给 `bob`
- **THEN** 返回 `COLLAB_BAD_RECIPIENT`

#### Scenario: 正文超限
- **GIVEN** `aily` 与 `doubao` 均为 active
- **WHEN** `aily` 发送 16 KiB + 1 字节的正文
- **THEN** 返回 `COLLAB_BAD_MESSAGE`

#### Scenario: needsReply 不做隐式转换
- **GIVEN** `aily` 与 `doubao` 均为 active
- **WHEN** `aily` 分别以 `needsReply:'false'`、`needsReply:null` 发送合法正文给 `doubao`，再省略 `needsReply` 发送一次
- **THEN** 前两次均返回 `COLLAB_BAD_MESSAGE`，日志长度不变且无 `dispatch/intended`；第三次成功且 `needsReply` 为 `false`

#### Scenario: 清空与超长状态
- **GIVEN** `aily` 的状态文本为 `做 C2`
- **WHEN** `aily` 先设置空字符串，再设置 501 个字符
- **THEN** 第一次后状态文本为空；第二次返回 `COLLAB_BAD_STATUS`，状态文本仍为空

### Requirement: request 条目的承接流程

`request` 条目的 `progress` SHALL 只能按 `open → accepted → done`、`open → rejected`、`accepted → rejected` 推进，仅 `assignee` 可推进，且与条目状态与 revision 无关。非法跳转 MUST 以 `COLLAB_BAD_TRANSITION` 拒绝；非承接方推进 MUST 以 `COLLAB_FORBIDDEN` 拒绝。

#### Scenario: 承接方正常推进
- **GIVEN** `R1` 的 `assignee` 为 `doubao`，`progress` 为 `open`
- **WHEN** `doubao` 依次推进为 `accepted`、`done`
- **THEN** `R1.progress` 为 `done`，日志新增两条含 `request/progressed` 的提交

#### Scenario: 非承接方推进被拒
- **GIVEN** 同上
- **WHEN** `aily` 推进为 `accepted`
- **THEN** 返回 `COLLAB_FORBIDDEN`

#### Scenario: 非法跳转被拒
- **GIVEN** `R1` 为 `open`
- **WHEN** `doubao` 直接推进为 `done`
- **THEN** 返回 `COLLAB_BAD_TRANSITION`

### Requirement: agent 往返超限自动升级为待人决定

`agentEditCount` SHALL 在 agent 成员每次成功 `reviseItem` 时加 1；人类成员的 `reviseItem` 不改变计数；条目进入 `agreed` 时计数归零。agent 的修改使计数大于常量 `ESCALATE_AFTER`（= 3）时，该修改照常生效，同时条目状态 SHALL 变为 `escalated`，并且该提交 MUST NOT 为任何 agent 成员记账唤醒。

#### Scenario: 第 4 次 agent 修改触发升级
- **GIVEN** `C3` 为 `draft` 且 `agentEditCount` 为 3，`requiredAcks` 含 agent `doubao`
- **WHEN** agent `aily` 以当前 revision 修改 `C3`
- **THEN** `C3` 为 `escalated`，`agentEditCount` 为 4，revision 加 1，该提交不含任何对 agent 成员的 `dispatch/intended`

#### Scenario: 人类修改不改变计数
- **GIVEN** `C3` 为 `draft` 且 `agentEditCount` 为 3
- **WHEN** 人类成员修改 `C3`
- **THEN** `C3` 为 `draft`，`agentEditCount` 为 3

#### Scenario: agreed 后计数归零
- **GIVEN** `C4` 为 `draft`，`agentEditCount` 为 2，`requiredAcks` 为 `aily`
- **WHEN** `aily` ack 当前 revision
- **THEN** `C4` 为 `agreed`，`agentEditCount` 为 0

### Requirement: 人类决定只能由带证据的确认产生

成员 SHALL 可对 `draft`、`agreed`、`escalated` 条目调用 `requestDecision(itemId, options[])`（2–8 个不重复、各 1–100 字符的选项字符串，否则 `COLLAB_BAD_OPTIONS`），生成 open 的决策请求，记录条目当前 revision。每个条目同一时刻 SHALL 至多一个 open 的决策请求：新请求 SHALL 在同一提交内把旧请求置为 `superseded`。决定人 SHALL 为条目 `deciders` 中当前 active 的人类成员；`deciders` 为空时为全部 active 的人类成员；结果为空 MUST 以 `COLLAB_NO_DECIDER` 拒绝。

`confirmDecision(requestId, choice, evidence)` SHALL 只接受 provider principal，`evidence` 为 `{actionId, deliveryId}`（均为非空字符串），`choice` 须属于请求的 `options`。除通用处理顺序外，内核 SHALL 在 `cmdId` 收据查找之后、业务校验之前，以 `(providerId, actionId)` 为键查找已处理的确认：命中且 `requestId`、actor、`choice` 均相同时，SHALL 追加一条只含收据、不含领域事件的提交，并返回首次结果；任一不同 MUST 以 `COLLAB_ACTION_CONFLICT` 拒绝。未命中时 SHALL 依次校验，任一失败则以对应错误拒绝：

1. 请求为 open，否则 `COLLAB_DECISION_CLOSED`；
2. actor 属于该请求的决定人，否则 `COLLAB_FORBIDDEN`；
3. 条目 revision 等于请求记录的 revision，否则 `COLLAB_STALE_REVISION`；
4. `deliveryId` 是该请求的确认投递，其投递对象成员等于 actor、记账时持久化的 `providerId` 等于调用方 provider、结果为 `succeeded` 且含 `messageRef`，否则 `COLLAB_DELIVERY_UNKNOWN`。

全部通过后 SHALL 在单条提交中写入 `decision/decided`（含 actor、choice、`providerId`、`actionId`、`deliveryId`、`messageRef`）、请求关闭与条目状态 `decided`。`decided` MUST NOT 经任何其他命令产生。

#### Scenario: 合格确认写入决定
- **GIVEN** `C3` revision 5，决定人为 `pm`；请求 `D1` 对 `pm` 的确认投递 `dv-1` 已由 P1 记为 `succeeded`，`messageRef` 为 `m-1`
- **WHEN** P1 代表 `pm` 调用 `confirmDecision(D1, 'A', {actionId:'e-1', deliveryId:'dv-1'})`
- **THEN** 日志新增恰好一条提交，含 `decision/decided`（actor `pm`、choice `A`、providerId `P1`、actionId `e-1`、messageRef `m-1`）；`C3` 为 `decided`；`D1` 为 closed

#### Scenario: 新请求作废旧请求
- **GIVEN** `C3` 有 open 请求 `D1`
- **WHEN** 成员对 `C3` 发起 `D2`，随后决定人以 `D1` 的有效投递确认 `D1`
- **THEN** `D1` 为 `superseded`；确认返回 `COLLAB_DECISION_CLOSED`；`C3` 不是 `decided`

#### Scenario: 决定后旧请求不能再确认
- **GIVEN** `C3` 由 `pm` 经 `D2` 决定
- **WHEN** 另一决定人以新 actionId 确认 `D2`
- **THEN** 返回 `COLLAB_DECISION_CLOSED`，决定 actor 仍为 `pm`

#### Scenario: 非决定人确认被拒
- **GIVEN** `C3` 决定人仅为 `pm`
- **WHEN** P1 代表人类成员 `qa` 确认 `D1`
- **THEN** 返回 `COLLAB_FORBIDDEN`，`D1` 仍为 open

#### Scenario: 已离开的决定人不能确认
- **GIVEN** `D1` 的决定人为 `pm` 与 `qa`，对 `pm` 的投递 `dv-1` 已 `succeeded`；随后 `pm` 离开
- **WHEN** P1 代表 `pm` 以新 `cmdId` 与新 `actionId` 和 `deliveryId:'dv-1'` 确认 `D1`
- **THEN** 返回 `COLLAB_MEMBER_INACTIVE`，`D1` 仍为 open，日志长度不变

#### Scenario: 投递对象与确认人必须一致
- **GIVEN** `D1` 的决定人为 `pm`、`qa`，都由 P1 承担确认；对 `pm` 的 `dv-1` 为 `succeeded`，对 `qa` 的 `dv-2` 为 `failed`
- **WHEN** P1 代表 `qa` 以 `deliveryId:'dv-1'` 确认 `D1`
- **THEN** 返回 `COLLAB_DELIVERY_UNKNOWN`

#### Scenario: 条目已变更后确认被拒
- **GIVEN** `D1` 记录 `C3` revision 5，此后人类成员把 `C3` 修改为 revision 6
- **WHEN** 决定人确认 `D1`
- **THEN** 返回 `COLLAB_STALE_REVISION`，`C3` 为 `draft`

#### Scenario: 投递失败时不能确认
- **GIVEN** `D1` 的确认投递 `dv-1` 被记为 `failed`
- **WHEN** 决定人以 `deliveryId:'dv-1'` 确认
- **THEN** 返回 `COLLAB_DELIVERY_UNKNOWN`

#### Scenario: 同一点击以新 cmdId 重放
- **GIVEN** `D1` 已由 P1 以 `actionId:'e-1'`、choice `A` 确认
- **WHEN** P1 以新的 `cmdId` 和相同 `actionId`、请求与 choice 再次确认
- **THEN** 返回与首次相同的结果；日志新增一条不含任何领域事件、只含该 `cmdId` 收据的提交

#### Scenario: 同一点击不同内容冲突
- **GIVEN** 同上
- **WHEN** P1 以 `actionId:'e-1'` 提交 choice `B`
- **THEN** 返回 `COLLAB_ACTION_CONFLICT`

#### Scenario: 不同 provider 的相同点击编号互不影响
- **GIVEN** `C5` 的决定人 `pm2` 由 P2 承担确认投递并已 `succeeded`；P1 曾在另一条目上使用 `actionId:'e-1'`
- **WHEN** P2 以 `actionId:'e-1'` 确认 `C5` 的请求
- **THEN** 确认成功，`C5` 为 `decided`

### Requirement: 命令按 cmdId 幂等

每个写命令 SHALL 携带调用方生成的非空 `cmdId`，作用域为 `(spaceId, scope)`。scope SHALL 为带类型标签的结构化值：普通成员为 `{kind:'member', name}`，createSpace 为 `{kind:'create', channel, address}`，internal 为 `{kind:'internal', purpose}`。收据键使用该结构化值的规范化编码，三种 kind 的 scope 永不相等；不得只用 name 或 purpose 字符串作为键。每条成功的公开写命令提交 SHALL 持久化收据 `{cmdId, scope, payloadHash, result}`，`payloadHash` 覆盖规范化后的命令名与全部参数。在通用处理顺序中，收据查找位于"协作空间未关闭"与命令前置条件之前：命中且 `payloadHash` 相同时 SHALL 返回收据中的原结果且不新增提交；`payloadHash` 不同 MUST 以 `COLLAB_CMD_CONFLICT` 拒绝。业务校验失败的命令 MUST NOT 写入收据，同一 `cmdId` 可以重试。

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

#### Scenario: 成员与 internal 的收据互不冲突
- **GIVEN** 存在 active 成员 `breaker-reset` 与 active 成员 `doubao`
- **WHEN** 成员 `breaker-reset` 以 `cmdId:'same-id'` 成功 `setStatus`，随后 `internal{purpose:'breaker-reset'}` 以同一 `cmdId` 对 `doubao` 调用 `resetBreaker`，再各自以相同载荷重放
- **THEN** 两次首调均成功，存在两条独立收据；两次重放各自返回原结果且不新增提交

### Requirement: 事件日志是唯一真源，读取是纯操作

每个协作空间 SHALL 有一条只追加的提交日志，提交只有两种：**公开写命令提交**（含该命令的全部事件与收据）与**投递完成提交**（只含一条 `dispatch/completed`，由服务内部调度器针对已持久化的 `deliveryId` 产生，不带 `cmdId`、scope 或收据）。两种提交共用同一递增 `seq`、行校验、原子写入、内存应用流程与同一协作空间串行队列，同样受 `failed`、`close` 的禁止提交边界约束。所有领域状态 SHALL 由提交重放派生。`readSince(spaceId, seq)` SHALL 是纯读：返回 seq 大于给定值的提交，不改变任何状态；`seq` 须为非负整数，否则以 `COLLAB_BAD_SEQ` 拒绝；大于最大 seq 时返回空列表。内核 MUST NOT 保存成员的已读位置；已读位置由调用方自行保存。

#### Scenario: 增量读取
- **GIVEN** 日志有 seq 1..20
- **WHEN** 调用 `readSince(15)`
- **THEN** 返回 seq 16..20，日志长度不变

#### Scenario: 超前与非法 seq
- **GIVEN** 最大 seq 为 20
- **WHEN** 分别调用 `readSince(25)` 与 `readSince(-1)`
- **THEN** 前者返回空列表，后者返回 `COLLAB_BAD_SEQ`

### Requirement: 存储按命令原子提交，并由排他锁保证单写入方

内核 SHALL 只通过存储接口持久化：`open(spaceId)`、`close(spaceId)`、`breakLock(spaceId, expectedInstanceId)`、`commit(spaceId, record, expectedLastSeq)`、`read(spaceId, fromSeq)`、`list()`。本期 SHALL 提供本地磁盘实现：

- 每个协作空间一个 jsonl 文件，每条提交恰为一行，以 `\n` 结尾；提交对象 SHALL 只含 JSON 值（对象、数组、字符串、有限数字、布尔、null），值为 `undefined` 的字段在写入前删除；行内 `sha256` 字段 SHALL 为该提交对象去掉 `sha256` 字段后，递归地把每个普通对象的键按 JavaScript 默认字符串排序（UTF-16 码元序）重建、数组保持原次序，再以标准 `JSON.stringify` 无空白序列化所得 UTF-8 字节的十六进制 SHA-256；
- `commit` SHALL 循环写入直至整行字节全部写出，随后 `fsync` 文件；首次创建文件后还 SHALL `fsync` 所在目录；全部完成后才返回成功；
- 加载时：文件末尾不以 `\n` 结尾的残片 SHALL 视为未提交并截断，截断后 `fsync`；任何以 `\n` 结尾的完整行若无法解析或校验不符，MUST 以 `COLLAB_STORE_CORRUPT` 拒绝加载且不修改文件；
- 任何写入、`fsync` 或内存应用失败时，内核 SHALL 把该协作空间置为 `failed`，此后对它的命令 MUST 以 `COLLAB_STORE_FAILED` 拒绝；调用方 SHALL 把该次结果视为未知，并按以下步骤恢复：对该协作空间调用 `close`（`close` 先停止接纳新命令、等待在途存储操作结束，此后该实例对该空间的任何提交 MUST 被拒绝，再删除内容等于本实例 id 的锁）→ `open` 并加载 → 失败的若是公开写命令提交，以相同 `cmdId` 重试，由收据给出确定结果；失败的若是投递完成提交，不重试、不重新投递，以重新加载后的持久日志为准：已有完整的 `dispatch/completed` 则采用该结果，否则该投递保持结果未知并列入 `pendingDeliveries`；
- `open` SHALL 以排他创建锁文件（写入实例 id 与进程 pid）获取写入权，锁已存在 MUST 以 `COLLAB_STORE_LOCKED` 拒绝（错误详情含锁内容），内核 MUST NOT 自行判断锁持有者是否存活或自动接管；`close` 只删除内容等于本实例 id 的锁；`breakLock(spaceId, expectedInstanceId)` SHALL 仅在锁内实例 id 等于 `expectedInstanceId` 时删除锁，否则以 `COLLAB_STORE_LOCKED` 拒绝。宿主 MUST 在调用前证明该 `expectedInstanceId` 对应的持有者已不存在，证明不足 MUST NOT 调用；匹配实例 id 本身不是证明；
- `commit` 时 `expectedLastSeq` 与文件最后一条提交的 seq 不符 MUST 以 `COLLAB_STORE_CONFLICT` 拒绝并把协作空间置为 `failed`。

命令成功响应 MUST 只在提交持久化且内存应用完成之后返回。

#### Scenario: 重启后状态一致
- **GIVEN** 本地磁盘存储上的协作空间经历成员加入、条目修改与决定，实例正常 `close`
- **WHEN** 新实例 `open` 并加载
- **THEN** 新实例的成员、条目与决策状态和原实例深度相等

#### Scenario: 行校验和有固定向量
- **GIVEN** 提交对象 `{"seq":1,"z":"é\n","a":[3,{"y":null,"b":true}],"u":undefined,"n":1.5}`
- **WHEN** 计算行校验和，并把写出的行解析后再次计算
- **THEN** 参与计算的规范化 JSON 恰为 `{"a":[3,{"b":true,"y":null}],"n":1.5,"seq":1,"z":"é\n"}`，两次计算均得到固定 SHA-256 `840fce0f37377ab788320a1479c096dd3eecae5e93795e4fda0be650adf39d9f`（该规范化字符串 UTF-8 字节的摘要）

#### Scenario: 末尾残片被截断
- **GIVEN** 文件有 10 条完整提交，末尾追加了第 11 行的前一半且无换行
- **WHEN** 加载
- **THEN** 加载成功，最大 seq 为 10，文件字节等于原 10 行

#### Scenario: 完整行损坏拒绝加载
- **GIVEN** 最后一行以 `\n` 结尾但校验和与内容不符
- **WHEN** 加载
- **THEN** 返回 `COLLAB_STORE_CORRUPT`，文件字节未改变

#### Scenario: 短写不报告成功
- **GIVEN** 测试替身让每次 `write` 只写出一半字节且不抛错
- **WHEN** 提交一条命令
- **THEN** 命令成功返回，且文件中该行完整、校验通过（写入循环补足了剩余字节）

#### Scenario: 多事件命令不会只落一半
- **GIVEN** 一次合格确认需要写入多个事件
- **WHEN** 测试替身在写出部分字节后抛错
- **THEN** 命令返回 `COLLAB_STORE_FAILED`；`close` 后重新 `open` 加载，这些事件都不存在，`D1` 仍为 open

#### Scenario: fsync 失败后结果交给重试判定
- **GIVEN** 测试替身使 `fsync` 抛错，但整行已写入文件
- **WHEN** 提交 `cmd-5`，随后再提交另一条命令，然后 `close`、`open` 并加载
- **THEN** 前两次都返回 `COLLAB_STORE_FAILED`；重新加载后以 `cmd-5` 重放返回已提交的结果

#### Scenario: failed 后的 close 阻止旧队列继续提交
- **GIVEN** 实例 X 上 `space-1` 已为 `failed`，且有一个已排队的命令
- **WHEN** X 对 `space-1` 调用 `close`，随后实例 Y `open` 并加载 `space-1`
- **THEN** X 的排队命令返回 `COLLAB_STORE_FAILED` 且未写入文件；`close` 完成后锁文件被删除；Y 打开成功

#### Scenario: 已被锁定时拒绝打开
- **GIVEN** 实例 X 已打开 `space-1`
- **WHEN** 实例 Y 打开 `space-1`
- **THEN** Y 返回 `COLLAB_STORE_LOCKED`，锁文件内容仍为 X 的实例 id

#### Scenario: 残留锁不被自动接管
- **GIVEN** `space-1` 的锁文件存在，但没有实例持有它
- **WHEN** 新实例打开 `space-1`
- **THEN** 返回 `COLLAB_STORE_LOCKED`，错误详情包含锁文件路径与其中的实例 id

#### Scenario: 按实例 id 解除残留锁
- **GIVEN** `space-1` 的残留锁内容为实例 `x-1`
- **WHEN** 调用 `breakLock('space-1', 'x-1')`，随后新实例 `open`
- **THEN** 锁被删除，新实例打开成功

#### Scenario: 实例 id 不符不解除
- **GIVEN** `space-1` 的锁内容为实例 `x-2`
- **WHEN** 调用 `breakLock('space-1', 'x-1')`
- **THEN** 返回 `COLLAB_STORE_LOCKED`，锁文件内容仍为 `x-2`

### Requirement: 状态只经命令产生

每个内核实例 SHALL 有 `serviceId`，协作空间创建时 SHALL 记录它（本期只记录，不参与校验，供以后迁移使用）。除 createSpace 外，对不存在的协作空间的任何调用 MUST 以 `COLLAB_SPACE_NOT_FOUND` 拒绝，MUST NOT 隐式创建它。内核 MUST NOT 提供直接写入事件的接口；外部调用引起的状态变化 SHALL 只能经"封闭的命令集合与授权"中列出的命令产生。唯一的内部例外是"投递意图在事务内记账"定义的投递完成提交。

#### Scenario: 不存在的协作空间被拒
- **GIVEN** 本实例不存在 `space-x`
- **WHEN** 任意 principal 对 `space-x` 发送消息
- **THEN** 返回 `COLLAB_SPACE_NOT_FOUND`，存储中不存在 `space-x`

#### Scenario: 公开类型不含事件写入
- **GIVEN** `collab-kernel` 的公开类型声明
- **WHEN** 运行类型层测试（`tsd`/`expectTypeOf`）检查 `CollabService` 的全部方法签名
- **THEN** 没有任何方法的参数类型可接受 `CollabEvent` 或 `CollabEvent[]`

### Requirement: 唤醒只投结构化指针，按事件类型决定接收方

内核 SHALL 在计算每条提交时，按下表得出受影响成员集合，去掉动作发起者本人与非 active 成员（邀请事件的被邀请者除外），去重后为每人记账一条普通唤醒：

| 事件 | 受影响成员 |
|---|---|
| 消息且 `needsReply:true` | 收件人 |
| 条目修改 | 修改后仍在 `requiredAcks` 中的成员 |
| 条目变为 `agreed` | 条目作者 |
| request `progress` 变化 | request 作者 |
| 邀请 | 被邀请成员（`invited` 状态，本事件是唯一允许投递给非 active 成员的情形） |
| Leader 转交 | 新 Leader |
| `decision/decided` | 请求发起方与条目 `requiredAcks` 成员 |
| 条目变为 `escalated` | 无 agent 成员 |
| 状态更新、`needsReply:false` 消息、成员加入 | 无 |

普通唤醒的指针 SHALL 是只含白名单字段的对象 `{spaceId, toSeq, counts:{message, item, decision, member}, from, invited}`，`from` 为发起者成员名，`invited` 仅在邀请唤醒中为 `true`（表示接收方应调用 `join` 或 `declineInvite`），MUST NOT 含消息正文、条目标题或正文。邀请唤醒不改变 `invited` 成员的读写权限。

#### Scenario: 需回复消息叫醒收件人
- **GIVEN** 测试 provider 记录全部 `deliver` 调用
- **WHEN** `aily` 发送 `needsReply:true`、正文为 `SECRET-BODY` 的消息给 `doubao`
- **THEN** 恰有一次对 `doubao` 的 `deliver`；指针的键集合恰为 `spaceId, toSeq, counts, from`；序列化后不含 `SECRET-BODY`

#### Scenario: 状态更新不叫醒
- **GIVEN** 同上
- **WHEN** `aily` 更新状态文本
- **THEN** 无 `deliver` 调用

#### Scenario: 不叫醒自己
- **GIVEN** `aily` 与 `doubao` 都在条目 `C1` 的 `requiredAcks` 中
- **WHEN** `aily` 修改 `C1`
- **THEN** 只有对 `doubao` 的 `deliver`

#### Scenario: 邀请叫醒被邀请者
- **GIVEN** 测试 provider 认领 `a:9` 且支持唤醒
- **WHEN** Leader `aily` 邀请 `a:9` 为 `bob`
- **THEN** 该提交恰含一条对 `bob` 的 `wake` 类 `dispatch/intended`；随后的 `deliver` 指针中 `invited` 为 `true`；`bob` 读取总览仍返回 `COLLAB_MEMBER_INACTIVE`

### Requirement: 投递意图在事务内记账

内核 SHALL 在产生唤醒或决策请求的命令的同一提交中，为每次投递写入 `dispatch/intended`（含 `deliveryId`、成员、类型 `wake|confirm`、相关 `requestId`、承担投递的 `providerId`）。外部 SPI 调用 SHALL 在提交之后、事务之外执行：`wake` 调 `deliver(member, pointer)`，`confirm` 调 `requestConfirmation(member, request, deliveryId)` 并返回 `{messageRef}`。

每次 SPI 调用结束后，内核 SHALL 自行在同一协作空间的串行事务中写入 `dispatch/completed`（actor 为 `system:dispatch`），宿主与 provider 不能直接写入投递结果：SPI 正常返回记为 `succeeded`；抛错或 `confirm` 返回值缺少非空 `messageRef` 记为 `failed`。内核 MUST NOT 为 SPI 调用设置超时，也 MUST NOT 在 SPI 结束前写入结果：冷恢复一个会话可能耗时很久且不可取消，提前判定失败会误拒合法的人类确认。SPI 尚未结束的投递 SHALL 在总览中列为 `inFlightDeliveries`。每个 `deliveryId` SHALL 至多一个结果。协作空间已关闭时 SHALL 不写结果。加载时有 `dispatch/intended` 而无结果的投递 SHALL 视为结果未知：不自动重发，并在总览的 `pendingDeliveries` 中列出。

#### Scenario: 意图与命令同提交
- **GIVEN** `aily` 发送需回复消息给 `doubao`
- **WHEN** 读取该命令的提交
- **THEN** 同一提交内含 `message/sent` 与一条成员为 `doubao`、类型为 `wake` 的 `dispatch/intended`

#### Scenario: 正常返回记为成功
- **GIVEN** 上一步的 `deliveryId` 为 `dv-1`，测试 provider 的 `deliver` 正常返回
- **WHEN** 等待调度完成
- **THEN** 日志新增一条提交，含 `dispatch/completed`（`deliveryId:'dv-1'`、`outcome:'succeeded'`、actor `system:dispatch`）

#### Scenario: provider 抛错记为失败
- **GIVEN** 测试 provider 的 `deliver` 抛错
- **WHEN** 记账后的调度完成
- **THEN** 日志新增 `dispatch/completed(outcome:'failed')`，原业务提交不受影响

#### Scenario: 确认缺 messageRef 记为失败
- **GIVEN** 测试 provider 的 `requestConfirmation` 返回 `{}`
- **WHEN** 发起决策请求并等待调度完成
- **THEN** 该 `confirm` 投递的结果为 `failed`，以它的 `deliveryId` 确认返回 `COLLAB_DELIVERY_UNKNOWN`

#### Scenario: 慢投递在结束前不写结果
- **GIVEN** 测试 provider 的 `requestConfirmation` 在 60 秒后才返回 `{messageRef:'m-9'}`（假定时器）
- **WHEN** 发起决策请求，推进时间到 30 秒，读取总览；再推进到 60 秒
- **THEN** 30 秒时日志无该投递的 `dispatch/completed`，总览 `inFlightDeliveries` 含它；60 秒后写入一条 `dispatch/completed(outcome:'succeeded')`，此后可用它确认

#### Scenario: 宿主不能写入投递结果
- **GIVEN** `CollabService` 的公开类型声明
- **WHEN** 运行类型层测试
- **THEN** 不存在 `recordDispatch` 或其他可写入投递结果的公开方法

#### Scenario: 重启后未完成投递不重发
- **GIVEN** `dv-2` 有 `dispatch/intended` 而无结果
- **WHEN** 新实例加载
- **THEN** 无 SPI 调用；总览的 `pendingDeliveries` 包含 `dv-2`

#### Scenario: 投递完成提交可持久化与重放且无收据
- **GIVEN** 文件存储上的投递 `dv-1` 已写入 `dispatch/completed(outcome:'succeeded')`
- **WHEN** 读取该提交，随后 `close`、新实例 `open` 并加载
- **THEN** 该提交只含 `dispatch/completed`，不含 `cmdId` 与收据；加载后 `dv-1` 的结果仍为 `succeeded`，`pendingDeliveries` 不含 `dv-1`

#### Scenario: failed 后不写投递完成提交
- **GIVEN** 已记账 `dv-4`，随后存储写入失败使协作空间为 `failed`
- **WHEN** `dv-4` 的 SPI 调用返回
- **THEN** 不写入 `dispatch/completed`；`close` 后重新加载，`dv-4` 出现在 `pendingDeliveries`

#### Scenario: 投递完成提交 fsync 失败后按日志恢复
- **GIVEN** `dv-5` 的 SPI 调用正常返回，测试替身使写入 `dispatch/completed` 时整行写出后 `fsync` 抛错
- **WHEN** 协作空间进入 `failed`，随后 `close`、`open` 并加载
- **THEN** 加载后 `dv-5` 的结果为 `succeeded`，日志中 `dv-5` 恰有一条 `dispatch/completed`；恢复过程中无新的 SPI 调用

### Requirement: 选择绑定与在线状态

本期每个成员只有一个绑定。普通唤醒 SHALL 只在该绑定 `supports.wake` 为真、且记账前对其 `presence` 的采样不为 `unreachable` 时记账，否则不记账，并在总览中把该成员标记为 `unreachable`。`presence` SHALL 在命令进入事务之前采样一次，作为该命令计算的显式输入。决策请求 SHALL 为每位决定人记账一条 `confirm` 投递，仅当其绑定 `supports.confirm` 为真；没有任何可确认的决定人时，请求 SHALL 保持 open 并标记 `awaitingChannel:true`，不记账投递。

#### Scenario: 不可达成员不记账
- **GIVEN** agent 成员 `doubao` 的 presence 采样为 `unreachable`
- **WHEN** `aily` 发送需回复消息给 `doubao`
- **THEN** 该提交不含对 `doubao` 的 `dispatch/intended`，总览中 `doubao` 为 `unreachable`

#### Scenario: 无可确认绑定
- **GIVEN** 决定人 `pm` 的绑定 `supports.confirm` 为假
- **WHEN** 发起决策请求
- **THEN** 请求为 open 且 `awaitingChannel:true`，提交中无 `confirm` 类 `dispatch/intended`

#### Scenario: 每位决定人一条确认投递
- **GIVEN** 决定人 `pm`、`qa` 的绑定都支持确认
- **WHEN** 发起决策请求
- **THEN** 该提交恰含两条 `confirm` 类 `dispatch/intended`，成员分别为 `pm`、`qa`

### Requirement: 按成员计数的熔断

熔断 SHALL 只作用于 `wake` 类投递；`confirm` 类投递不计入、不受限。每个成员的熔断计数 SHALL 等于自其最近一次 `breaker/reset` 以来记账的 `wake` 投递数，由日志重放得出。记账前若计数已达到常量 `BREAKER_LIMIT`（= 6），内核 SHALL 不再为该成员记账 `wake`，并在总览中标记 `paused`。`resetBreaker(member)` 只接受 internal(`breaker-reset`)，写入 `breaker/reset`。`decision/decided` 提交 SHALL 对每个受影响成员（按唤醒表计算后）先写入 `breaker/reset`，再按"选择绑定与在线状态"决定是否记账 `wake`。计数与记账在同一协作空间的串行事务中完成，同一成员的 `wake` 记账数 MUST NOT 超过上限。

#### Scenario: 达到上限后暂停
- **GIVEN** `doubao` 计数为 0
- **WHEN** 7 个依次提交的命令都满足叫醒 `doubao` 的条件
- **THEN** 只有前 6 个提交含对 `doubao` 的 `wake` 类 `dispatch/intended`，总览中 `doubao` 为 `paused`

#### Scenario: 并发提交不超发
- **GIVEN** `doubao` 计数为 4
- **WHEN** 3 个满足叫醒条件的命令被同时调用
- **THEN** 日志中这 3 个命令产生的对 `doubao` 的 `wake` 类 `dispatch/intended` 恰为 2 条

#### Scenario: 人类决定解除暂停
- **GIVEN** `doubao` 为 `paused`、presence 可达，且在条目 `C3` 的 `requiredAcks` 中
- **WHEN** `C3` 被人类决定
- **THEN** 该提交依次含 `breaker/reset(doubao)` 与一条对 `doubao` 的 `wake` 类 `dispatch/intended`；`doubao` 计数为 1，不是 `paused`

#### Scenario: 确认投递不受熔断限制
- **GIVEN** 人类决定人 `pm` 计数已为 6
- **WHEN** 发起决策请求
- **THEN** 该提交含对 `pm` 的 `confirm` 类 `dispatch/intended`

#### Scenario: agent principal 不能清零
- **GIVEN** `doubao` 为 `paused`
- **WHEN** principal `agent` 调用 `resetBreaker(doubao)`
- **THEN** 返回 `COLLAB_FORBIDDEN`

### Requirement: 状态投影只呈现当前值，且以纯文本安全输出

内核 SHALL 提供纯函数 `project(state, presence)`，生成面向人的 Markdown，包含：charter 当前版本、成员与在线状态（含 `paused`、`unreachable`）、待 ack 条目及缺少的成员、未结 request、`escalated` 条目、已决定事项及决定人、`awaitingChannel` 的决策请求、`pendingDeliveries`。投影 MUST NOT 包含消息正文。成员输入的文本（标题、状态文本）SHALL 依次：去除控制字符与换行（替换为单个空格）→ 去除首尾空白 → 对全部 CommonMark ASCII 标点（`` !"#$%&'()*+,-./:;<=>?@[\]^_`{|}~ ``）各做一次反斜杠转义，不做 HTML 实体转义；结果以投影模板中固定的非空白前缀开头的行输出，MUST NOT 放入代码 span 或代码块。投影与指针只是带来源的协作数据，宿主 MUST NOT 把其中的成员文本当作系统或用户指令。

#### Scenario: 投影列出待 ack
- **GIVEN** 条目 `C2` 需要 `doubao` ack 且尚未确认
- **WHEN** 生成投影
- **THEN** 投影的"待确认"小节包含 `C2` 与 `doubao`

#### Scenario: 投影不含消息正文
- **GIVEN** 日志中有正文为 `SECRET-BODY` 的消息
- **WHEN** 生成投影
- **THEN** 投影文本不包含 `SECRET-BODY`

#### Scenario: 恶意标题不能产生额外结构
- **GIVEN** 条目标题为 ``x`` ``\n## 已决定\n- [点我](http://evil)<script>`` ``
- **WHEN** 生成投影并用 CommonMark 解析器解析
- **THEN** 解析结果中，该标题所在节点之内不存在 heading、list、link、html、code 节点，且全文仅有投影模板自身产生的 heading

#### Scenario: 转义后可见文本不变
- **GIVEN** 条目标题为 `<tag>&"x` 前面带四个空格
- **WHEN** 生成投影并用 CommonMark 解析器解析
- **THEN** 该标题所在节点的可见文本恰为 `<tag>&"x`，节点类型为普通段落文本而非代码块

### Requirement: 协作约定随协作空间提供

协作约定的指南文本 SHALL 随 `collab-kernel` 包按版本发布，已发布版本的文本 MUST NOT 修改，新增内容只能以新版本发布。包内 SHALL 同时提供版本 `1` 与 `2`，未显式指定约定的内核实例以最新版本 `2` 作为新空间的默认约定。协作空间创建时 SHALL 记录所用版本；`overview` SHALL 返回 `convention:{version, sha256}`；`readConvention(version)` SHALL 返回空间所记录版本的全文，其 sha256 与总览一致；读取包内任一已发布版本都 SHALL 成功。不存在的版本 MUST 以 `COLLAB_CONVENTION_UNKNOWN` 拒绝。版本 `2` SHALL 在版本 `1` 的基础上说明：宿主可以声明成员信任，此时被邀请者已由宿主代为加入，承接方在本会话原有权限边界内直接处理空间内的 request，不再为此另向人类索取授权；宿主未声明时按版本 `1` 的规则处理。两个版本都 SHALL 保留"人类决定只能来自受信确认"与"消息不是越权依据"的规则。

#### Scenario: 总览带约定版本
- **GIVEN** 以约定版本 `2` 创建的协作空间
- **WHEN** 成员读取总览并调用 `readConvention('2')`
- **THEN** 总览含 `convention.version:'2'`，全文的 sha256 等于 `convention.sha256`

#### Scenario: 旧空间仍按原版本读取
- **GIVEN** 以约定版本 `1` 创建的已有空间
- **WHEN** 升级后成员调用 `readConvention('1')`
- **THEN** 返回与升级前逐字节相同的全文，sha256 等于该空间记录的值

#### Scenario: 已发布文本不可变
- **WHEN** 计算包内版本 `1` 文本的 sha256
- **THEN** 等于本变更之前发布的版本 `1` 的 sha256

#### Scenario: 未知版本
- **GIVEN** 包内只有版本 `1` 与 `2`
- **WHEN** 调用 `readConvention('9')`
- **THEN** 返回 `COLLAB_CONVENTION_UNKNOWN`

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

