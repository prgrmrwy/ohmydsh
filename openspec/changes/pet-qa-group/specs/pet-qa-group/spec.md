# Pet QA Group Specification (Delta)

## ADDED Requirements

### Requirement: Q&A 动作原子地创建答疑群并 fork 源会话子代理

系统 SHALL 在 Pet 轮盘提供 Host 内置的 Q&A 动作，仅当来源为未归档 DSH session、
channel 已绑定且 bot 可用、且宿主 fork 能力可用时可用；不满足时 SHALL 禁用并
展示可诊断原因。

点击 Q&A 后系统 SHALL 按序完成：① 对源会话 fork 一个 continuable 子代理
（种子为源会话截至最近一个完成 turn 的前缀）；② 以 bot 身份创建仅含本人与
bot 的飞书群；③ 写入 `kind: qa` 的绑定行（记录群 chat_id、child session、
源 session）。任一步失败 SHALL 使整体失败：已建的 child SHALL 被回收，绑定行
MUST NOT 写入；已建群无法回收时 SHALL 向用户明示残留群名。三步全部成功前，
该群的入站消息 SHALL 按非 qa 路径处理。

fork 种子 MUST NOT 包含源会话未完成的 in-flight turn；Q&A 动作入口 SHALL 明示
「以最近完成的一轮为准」。

#### Scenario: 成功创建答疑群
- **WHEN** 用户在一个有完成 turn 的会话来源上点击 Q&A 且三步均成功
- **THEN** 飞书出现仅含本人与 bot 的新群，Pet 记录 qa 绑定，child 以源会话上下文为种子建立

#### Scenario: 建群失败回收 child
- **WHEN** fork 成功但飞书建群调用失败
- **THEN** 系统回收已建 child，不写绑定行，向用户报告失败原因

#### Scenario: 源会话正在执行 turn 时点击
- **WHEN** 用户在源会话一个 turn 尚未完成时点击 Q&A
- **THEN** child 种子截至上一个完成 turn，进行中内容不进种子，动作正常完成

#### Scenario: 依赖不可用时动作禁用
- **WHEN** 宿主缺少 fork provider、会话持久化或 channel 未绑定
- **THEN** Q&A 动作显示为禁用并给出指向性原因，不产生任何副作用

### Requirement: qa 群成员即触发许可且其余防线原样适用

对 `kind: qa` 绑定的群，系统 SHALL 豁免全局发送者 allowlist：任何群成员
mention bot 的消息即可触发。mention 命中自身 open_id、消息 ID 去重、启动水位、
消息类型防线 SHALL 对 qa 群原样适用。非 qa 绑定的准入行为 MUST NOT 因本能力
发生任何变化；被拉入 qa 群 MUST NOT 使发送者获得任何非 qa chat 的触发资格。

系统 SHALL 向 child 的每条投递标注提问者身份，并要求 child 在涉及修改工作区时
先向提问者确认；该要求是行为约束，系统 MUST NOT 将其宣称为能力边界。

#### Scenario: 非 allowlist 群成员触发
- **WHEN** 一个不在全局 allowlist 的用户被拉入 qa 群后 @bot 提问
- **THEN** 消息通过准入并投递给 child，child 带源会话上下文回答

#### Scenario: qa 群成员在其它群触发
- **WHEN** 同一用户在另一个非 qa 绑定的群中 @bot
- **THEN** 该消息按全局 allowlist 判定，不因 qa 群成员身份放行

#### Scenario: qa 群内未 @bot 的消息
- **WHEN** qa 群成员发送未 mention bot 的消息
- **THEN** 消息不触发任何处理

### Requirement: qa child 的工作目录约束是 prompt 级而非沙箱级

源会话受 Worktree Session 绑定时，系统 SHALL 在建群时经该绑定契约解析受管执行
根，持久化于 qa 绑定行，并在 **seed 与每一条提问的 prompt** 中声明：仓库根不是
干活的地方、受管执行目录与任务分支为何、以及所有命令必须显式以该目录为
workdir。系统 MUST NOT 从 `cwd` 推断执行根。

系统 MUST NOT 宣称该约束改变了 child 进程的工作目录：fork 复制父会话的 `cwd`
（Worktree Session 有意将其保留在仓库根），而绑定本身不被继承，因此 child 进程
的默认 `cwd` 仍是主 checkout。

该 prompt 声明 SHALL 被视为 child 得知执行根的**唯一**途径，而非第二重保障：
子代理层不注入任何 Worktree Session 运行时上下文，child 自身的 runtime context
中不存在该绑定。（fork 种子会复制父会话 transcript，其中夹带**父会话的** runtime
context 快照，极易被误读为 child 自己的——真机上两个 child 先后发生过这一误读。）
因此遗留风险 SHALL 按「无第二重提醒」如实声明：某轮遗漏 workdir 即为纯粹的静默
失误，只读无害而写操作会污染主 checkout；MUST NOT 以「已修复」掩盖。

源会话未绑定 Worktree Session 时，系统 MUST NOT 虚构任何目录约束。

#### Scenario: 绑定 worktree 的源会话建群
- **WHEN** 从一个 Worktree Session 绑定的会话点击 Q&A
- **THEN** 绑定行记录受管执行根与任务分支，seed prompt 声明该目录且标注仓库根不可作为工作区

#### Scenario: 每条提问都重述目录约束
- **WHEN** 该群收到第二条及以后的提问
- **THEN** 每条投递的 prompt 都重述受管执行目录，而不是仅在 seed 中声明一次

#### Scenario: 未绑定 worktree 的源会话
- **WHEN** 源会话没有 Worktree Session 绑定
- **THEN** prompt 不包含目录约束段落，绑定行不记录执行根

### Requirement: qa 触发消息经宿主队列投递 child 且回复由 child 发出

qa 群通过防线的消息 SHALL 由宿主排入 child 的收件队列成为独立 turn，按到达序
执行；系统 MUST NOT 为 qa 投递创建新的 executor session，MUST NOT 经能力
envelope 通道派发。每条投递 SHALL 持久化 channel 关联（chat、触发消息 ID、
发送者、表情 ID），投递被接受 MUST NOT 被视为执行完成。

投递前 parent 会话非驻留时系统 SHALL 先将其唤活；宿主重启后 child SHALL 经
持久化描述符冷恢复继续服务，恢复所需的 LLM provider 不可用时 SHALL fail
closed 并给出指向性诊断，MUST NOT 静默改用其它模型。

文字回复 SHALL 由 child 自行发出且仅发往触发所在群；系统只维护表情状态，
MUST NOT 代发内容。

#### Scenario: 群消息成为 child 独立 turn
- **WHEN** qa 群成员 @bot 提问且 child 空闲
- **THEN** 消息作为 child 的新 turn 执行，child 可见源会话种子与既往全部轮次

#### Scenario: 多人连续提问按序处理
- **WHEN** child 正在处理一条消息时另两名群成员先后 @bot
- **THEN** 两条消息各自立即获得进行中表情，并按到达序依次成为 child 的后续 turn

#### Scenario: 宿主重启后群消息到达
- **WHEN** DSH 重启后 qa 群成员 @bot
- **THEN** 系统唤活 parent、冷恢复 child，消息以完整历史上下文被处理

### Requirement: qa 终态反馈由子代理结算事件驱动

系统 SHALL 观测 child 的 turn 结算事件驱动表情状态机：投递前打进行中表情，
对应 turn 结算后删除进行中表情并按结果打完成或失败表情。表情操作 SHALL
fail-soft：失败仅记诊断，MUST NOT 阻断执行或回复。结算与待反馈行无法匹配时
SHALL 放弃该行表情并记录诊断，MUST NOT 错误地反馈到其它消息上。

#### Scenario: 触发到完成的表情序列
- **WHEN** qa 群消息被投递且对应 turn 成功结算
- **THEN** 触发消息上的进行中表情被移除并出现完成表情

#### Scenario: 投递接受但执行失败
- **WHEN** 消息已入队但对应 turn 以失败结算
- **THEN** 触发消息获得失败表情，系统不将入队成功当作完成

### Requirement: 源会话失效时 qa 绑定 fail closed 且群内明示

源会话归档、删除或无法唤活时，系统 SHALL 将 qa 绑定标记失效：后续群消息
MUST NOT 触发工作。系统 SHALL 以 bot 身份在群内给出绑定失效提示，每个绑定的
失效提示 SHALL 有限次（防刷屏），此后恢复静默。child 及其历史 SHALL 保留可查，
设置页 SHALL 展示失效状态并允许归档该绑定。

#### Scenario: 源会话归档后群消息到达
- **WHEN** 源会话已归档，qa 群成员 @bot
- **THEN** 不触发任何工作，群内收到一次绑定失效提示，后续同类消息静默丢弃

#### Scenario: 失效绑定的历史保留
- **WHEN** 用户在 GUI 查看失效 qa 绑定对应的 child 会话
- **THEN** 既往问答完整可读，设置页展示失效原因并提供归档入口

### Requirement: child 收纳于源会话名下且私聊不产生飞书出站

qa child SHALL 以 continuable 子代理形态收纳在源会话名下（原生折叠列表），
标签可辨识对应答疑群。用户经 GUI 直接向 child 输入 SHALL 作为普通会话对话
处理：MUST NOT 产生 channel 关联、表情或任何飞书出站。

#### Scenario: 在 GUI 展开并私聊 child
- **WHEN** 用户在源会话页面展开子代理列表并向 qa child 发送消息
- **THEN** child 正常应答，该轮不打表情、不向飞书群发送任何内容

#### Scenario: 私聊补充的上下文对群生效
- **WHEN** 用户私聊告知 child 新进展后，群成员再次 @bot
- **THEN** child 处理群消息时可见私聊补充的内容
