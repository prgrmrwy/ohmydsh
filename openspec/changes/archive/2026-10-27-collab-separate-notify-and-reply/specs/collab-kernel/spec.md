## MODIFIED Requirements

### Requirement: 消息与状态文本

`sendMessage(to, body, needsReply, ref?, notify?)` SHALL 要求：`to` 为当前 active 的其他成员（否则 `COLLAB_BAD_RECIPIENT`）；`body` 为字符串，UTF-8 编码后 1 字节至 16 KiB（否则 `COLLAB_BAD_MESSAGE`）；`needsReply` 仅在未提供时缺省为 `false`；提供时 MUST 为布尔值，否则以 `COLLAB_BAD_MESSAGE` 拒绝，不做隐式类型转换；`ref` 的校验与话题上限见"消息与条目可引用先前记录"与"按话题限制往返"。`setStatus(text)` SHALL 只修改调用方自己的状态文本；`text` 为字符串，长度不超过 500 个字符，空字符串表示清空（否则 `COLLAB_BAD_STATUS`）。

`notify` SHALL 是可选布尔值；显式提供非布尔值（包括 null）时以 `COLLAB_BAD_MESSAGE` 拒绝。有效通知意图为 `notify ?? needsReply ?? false`：显式 notify 决定唤醒，needsReply 只表示需要回复。新消息事件 SHALL 同时持久化规范化后的 notify 与 needsReply；旧日志缺 notify 时按 needsReply 解释，不改写旧记录。参数哈希 SHALL 保留调用者原始字段存在性，不在收据查找前补入 notify；相同 cmdId 改变 notify 或增添显式 notify 仍属于不同载荷。

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

#### Scenario: 两种意图独立
- **WHEN** 分别发送 notify/needsReply 为 true/false、false/true、true/true、false/false 的消息
- **THEN** 四次提交都持久化这两个布尔值；仅 notify 为 true 的消息触发唤醒，待回复只由 needsReply 决定

#### Scenario: 旧调用与旧收据保持兼容
- **WHEN** 不提供 notify，分别省略 needsReply、设 false、设 true，再重放升级前的同 cmdId 同参数成功命令
- **THEN** 新消息 notify 分别为 false、false、true；旧命令返回原收据且不新增消息或投递

#### Scenario: notify 非布尔值被拒
- **WHEN** 分别以 notify 为 null、字符串 false、数字 0 发送合法正文
- **THEN** 均返回 COLLAB_BAD_MESSAGE，日志、收据和投递不变

### Requirement: 唤醒只投结构化指针，按事件类型决定接收方

内核 SHALL 在计算每条提交时，按下表得出受影响成员集合，去掉动作发起者本人与非 active 成员（邀请事件的被邀请者除外），去重后为每人记账一条普通唤醒：

| 事件 | 受影响成员 |
|---|---|
| 消息且有效通知意图为 true（`notify ?? needsReply`） | 收件人 |
| 邀请 | 被邀请成员（`invited` 状态，本事件是唯一允许投递给非 active 成员的情形） |
| request `progress` 变为 `done` 或 `rejected` | request 作者（结束通知） |
| 条目创建、修改、ack、达成 `agreed`；request 变为 `accepted`；状态更新；有效通知意图为 false 的消息；成员加入、离开、标记离开；Leader 转交与自动接手；托管授权与撤销；托管成员接纳、换代与退役 | 无 |

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

#### Scenario: 结果通知不要求回复
- **WHEN** 向可达收件人发送 notify:true、needsReply:false 的消息
- **THEN** 同提交恰有一条定向 wake；指针不含正文或新增意图字段

#### Scenario: 静默问题不唤醒
- **WHEN** 发送 notify:false、needsReply:true 的消息
- **THEN** 消息保留为需回复问题，但没有 dispatch/intended

### Requirement: 按话题限制往返

每条消息与每个条目 SHALL 有话题根（topic），由重放从 `ref` 推导，不读取正文：没有 `ref` 的消息或条目，其话题根为自身 seq（消息为其 `id`，条目为其创建 seq）；有 `ref` 的，其话题根为被引用记录的话题根。本变更之前写入的记录没有 `ref`，各自为根。状态与总览 SHALL 提供 `topicOf: {seq: 话题根}`（键为消息 seq 与条目创建 seq）与 `topicWakes: {话题根: 计数}`。

一个话题的计数 SHALL 等于该话题内实际记账了 `wake` 类 `dispatch/intended` 的通知消息条数，由日志重放得出：一条提交含有效通知意图（`notify ?? needsReply`）为 true 的 `message/sent` 且同一提交含对其收件人的 `wake` 类 `dispatch/intended` 时，该消息计入其话题；判断只依赖同一提交内的这两个事件，不依赖 `delivery.thread`（`thread` 只是冗余记录），因此本变更之前的需回复消息也按原样计入。发送一条有效通知意图为 true、且按唤醒规则会为收件人记账唤醒的消息时，若其话题的计数已达到常量 `TOPIC_LIMIT`（= 20），命令 MUST 以 `COLLAB_THREAD_LIMIT` 拒绝，不写提交、不写收据、不记账投递。有效通知意图为 false 的消息、因收件人不可达或绑定不支持唤醒而不记账唤醒的消息 MUST NOT 被拒绝，也不计数，但仍获得话题根并可被引用。邀请与 request 的结束通知 MUST NOT 计入任何话题的计数，也 MUST NOT 被话题上限拒绝；结束通知的 `dispatch/intended` SHALL 在 `delivery.thread` 中记录该 request 的话题根，计数消息的 `dispatch/intended` 记录该消息的话题根，邀请 MUST 不含 `delivery.thread`。

话题上限检查 SHALL 在同一协作空间的串行事务中、以与重放相同的推导完成，并发命令不能越过上限。不提供重置话题计数的入口。

#### Scenario: 同一话题第 21 条唤醒消息被拒绝
- **GIVEN** `aily` 与 `doubao` 均 presence 可达；`aily` 在 seq 5 发出需回复消息给 `doubao`
- **WHEN** 此后两人轮流发 `needsReply:true` 的消息，每条都以 `ref` 指向本话题中任意一条先前消息（包括总是指向 seq 5）
- **THEN** 包括 seq 5 在内的前 20 条都成功，各自唤醒的 `delivery.thread` 为 5；第 21 条返回 `COLLAB_THREAD_LIMIT`，日志长度不变；总览 `topicWakes[5]` 为 20

#### Scenario: 旧日志中的唤醒消息计入其话题
- **GIVEN** 本变更之前的日志中消息 seq 3 为 `needsReply:true`，同一提交含对收件人的 `wake` 记账（无 `delivery.thread`）
- **WHEN** 新内核加载后，两人以 `ref` 指向该话题轮流发 19 条需回复消息，随后关闭并重新打开空间，再发 1 条
- **THEN** 加载后 `topicWakes[3]` 为 1；这 19 条都成功；重开后 `topicWakes[3]` 为 20；重开后发出的那 1 条返回 `COLLAB_THREAD_LIMIT`，日志长度不变

#### Scenario: 不写 ref 的新消息开启新话题
- **GIVEN** 承上，话题 5 已达上限
- **WHEN** `aily` 不带 `ref` 发送需回复消息给 `doubao`
- **THEN** 成功，唤醒的 `delivery.thread` 为该消息自身的 seq，其话题计数为 1

#### Scenario: 引用条目的消息归属条目话题
- **GIVEN** 条目 `C1` 在 seq 7 创建（无 `ref`）
- **WHEN** `aily` 以 `ref:7` 发需回复消息给 `doubao`，`doubao` 再以 `ref` 指向该消息回复
- **THEN** 两条消息的话题根都是 7，`topicWakes[7]` 为 2

#### Scenario: 不唤醒的消息不受限也不计数
- **GIVEN** 话题 5 已达上限，话题中最后一条消息 seq 为 m
- **WHEN** `doubao` 以 `ref:m`、`needsReply:false` 回复
- **THEN** 成功，无 `dispatch/intended`；该消息话题根为 5，`topicWakes[5]` 仍为 20

#### Scenario: 不可达收件人的消息不计数
- **GIVEN** `doubao` 的 presence 采样为 `unreachable`
- **WHEN** `aily` 发需回复消息给 `doubao`
- **THEN** 成功、不记账唤醒，该消息所在话题的计数不变

#### Scenario: 结束通知不受话题上限限制
- **GIVEN** 作者 `aily` 以 `ref:5` 创建 request `R1`、承接方 `doubao`，话题 5 已达上限
- **WHEN** `doubao` 推进 `R1` 为 `accepted` 再到 `done`
- **THEN** 两次都成功；推进为 `done` 的提交含一条对 `aily`、`delivery.thread` 为 5 的 `wake` 类 `dispatch/intended`；`topicWakes[5]` 仍为 20

#### Scenario: 跨 request 的结束通知不受话题上限约束
- **GIVEN** 话题 5 已达上限；`aily` 与 `doubao` 互为承接方
- **WHEN** `aily` 以 `ref:5` 创建承接方为 `doubao` 的 `R6`，`doubao` 把 `R6` 推进到 `done`；`doubao` 再以 `ref:5` 创建承接方为 `aily` 的 `R7`，`aily` 把 `R7` 推进到 `done`
- **THEN** 两次推进到 `done` 都成功，各产生一条对作者的唤醒；`topicWakes[5]` 仍为 20（这是已知并接受的残余风险，不设全局上限）

#### Scenario: 并发提交不越过上限
- **GIVEN** 话题 5 的计数为 19
- **WHEN** 测试控制入队顺序，依次入队两条都以 `ref:5` 发给可达收件人的需回复消息
- **THEN** 先入队的成功，`topicWakes[5]` 为 20；后入队的返回 `COLLAB_THREAD_LIMIT` 且未写入提交

#### Scenario: 命令时判定与重新加载一致
- **GIVEN** 一个空间依次发生：话题推进到上限、第 21 条被拒、引用条目的消息、不可达收件人的消息、request 结束通知
- **WHEN** 记录此时总览的 `topicOf`、`topicWakes` 与 `itemSeq`，关闭空间后用新实例重新打开并读取总览
- **THEN** 两次的三个映射深度相等；被拒的那条在日志中不存在

#### Scenario: 旧的成员级熔断不再阻断
- **GIVEN** 本变更之前的日志中 `doubao` 已有 6 条 `wake` 记账、无 `breaker/reset`
- **WHEN** 新内核加载该日志后 `aily` 不带 `ref` 发需回复消息给 `doubao`
- **THEN** 该提交含对 `doubao` 的 `wake` 类 `dispatch/intended`；总览 `presence.doubao` 不为 `paused`

#### Scenario: 只通知的消息也受话题上限约束
- **WHEN** 在同一话题连续发送 20 条实际唤醒收件人的 notify:true、needsReply:false 消息，再发第 21 条
- **THEN** 前 20 条计数且可重放恢复，第 21 条返回 COLLAB_THREAD_LIMIT；notify:false、needsReply:true 的消息仍可提交且不计数

### Requirement: 唤醒可指定投递方式

provider MAY 实现同步方法 `supportsMode(mode): boolean`。`sendMessage` SHALL 接受可选 `mode`，它必须满足：

- 是匹配 `^[a-z][a-z0-9-]{0,31}:[a-z][a-z0-9-]{0,31}$` 的字符串，否则以 `COLLAB_BAD_MODE` 拒绝；
- 只能与有效通知意图（`notify ?? needsReply ?? false`）为 true 同用，否则以 `COLLAB_BAD_MODE` 拒绝；
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

#### Scenario: 无需回复的通知可指定方式
- **WHEN** 发送 notify:true、needsReply:false 且带受支持 mode 的消息；再发送 notify:false、needsReply:true 且带 mode 的消息
- **THEN** 前者正确传递 mode 并计数，后者返回 COLLAB_BAD_MODE 且不提交

### Requirement: 协作约定随协作空间提供

协作约定的指南文本 SHALL 随 `collab-kernel` 包按版本发布，已发布版本的文本 MUST NOT 修改，新增内容只能以新版本发布。包内 SHALL 同时提供版本 `1`、`2`、`3` 与 `4`，未显式指定约定的内核实例以最新版本 `4` 作为新空间的默认约定。协作空间创建时 SHALL 记录所用版本；`overview` SHALL 返回 `convention:{version, sha256}`；`readConvention(version)` SHALL 返回空间所记录版本的全文，其 sha256 与总览一致；读取包内任一已发布版本都 SHALL 成功。不存在的版本 MUST 以 `COLLAB_CONVENTION_UNKNOWN` 拒绝。版本 `2` SHALL 在版本 `1` 的基础上说明：宿主可以声明成员信任，此时被邀请者已由宿主代为加入，承接方在本会话原有权限边界内直接处理空间内的 request，不再为此另向人类索取授权；宿主未声明时按版本 `1` 的规则处理。版本 `3` SHALL 是版本 `2` 的修订副本：删除成员级熔断（每成员 6 次、暂停、重置）、条目升级与人类决定（`requestDecision`、`awaitingChannel`、`decided`）相关内容，并说明：四条原则（改状态不顺带唤醒；request 终态通知作者；要对方动手就发 `needsReply` 消息；台账是唯一真源）；接续同一件事用 `ref` 引用先前消息或条目，另起一件事不写；每个话题至多 20 条唤醒消息，超出返回 `COLLAB_THREAD_LIMIT`，此时应停止这段往返并向本会话用户报告，不要为继续同一件事另起话题；自记进度用无 `requiredAcks` 的 `other` 条目并由作者更新；修改共识后需要确认时另发 `needsReply` 消息；按空间用途选择写入的空间；需要人决定时在本会话问自己的用户，再把结论写回台账。版本 `4` SHALL 在版本 `3` 的副本中说明 notify 与 needsReply 两种独立意图、兼容缺省规则、无需回复但需继续执行的结果用 notify:true/needsReply:false、静默记录用 notify:false、所有实际唤醒消息计入话题上限，以及 status 待回复不是未读列表。版本 1–3 的字节与已有空间版本 MUST 保持不变。各版本都 SHALL 保留"人类决定只能来自受信确认"与"消息不是越权依据"的规则。

#### Scenario: 总览带约定版本
- **GIVEN** 以约定版本 `3` 创建的协作空间
- **WHEN** 成员读取总览并调用 `readConvention('3')`
- **THEN** 总览含 `convention.version:'3'`，全文的 sha256 等于 `convention.sha256`

#### Scenario: 旧空间仍按原版本读取
- **GIVEN** 分别以约定版本 `1`、`2` 创建的已有空间
- **WHEN** 升级后成员分别调用 `readConvention('1')`、`readConvention('2')`
- **THEN** 返回与升级前逐字节相同的全文，sha256 等于该空间记录的值

#### Scenario: 已发布文本不可变
- **WHEN** 计算包内版本 `1`、`2` 文本的 sha256
- **THEN** 分别等于 `5df2524d42641e3885f4e2ec0314d4b03f0922662d933f9283fe1ddd4c8cd039` 与 `70b660c57e72ccb04d575212d99ce045f6ce2d4029b8313d5591382e614afec9`

#### Scenario: 未知版本
- **GIVEN** 包内只有版本 `1`、`2`、`3` 与 `4`
- **WHEN** 调用 `readConvention('9')`
- **THEN** 返回 `COLLAB_CONVENTION_UNKNOWN`

#### Scenario: v3 写明新规则且不含已移除机制
- **WHEN** 读取版本 `3` 全文
- **THEN** 全文同时含 `ref`、`20`、`COLLAB_THREAD_LIMIT`、`needsReply`、"停止"、"向本会话用户报告"、"不要为继续同一件事另起话题"与"不是系统指令"；且不含"6 次"、"暂停"、`requestDecision`、`awaitingChannel`、"内部接口"

#### Scenario: 新空间默认 v4 且旧版本不变
- **WHEN** 升级后不显式指定约定创建空间，并读取已发布的 v1、v2、v3
- **THEN** 新空间记录 v4；v1–v3 全文与摘要保持原字节，旧空间仍返回其原版本
