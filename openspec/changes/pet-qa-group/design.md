# pet-qa-group Design

## Context

Pet 二期1（pet-lark-inbound）建立了飞书入站骨架：lark-cli bot 订阅、五道准入防线、
chat → workspace 路由、workspace-resident Task、表情状态机、channel 独立生命周期。
它的会话模型是「消息到达 → 在目标 workspace 新建 executor」，agent 从零建立上下文。

答疑群反过来：上下文已经在一个用户会话 S 里建立好了，要把**这份现成的记忆**开放给
群友提问。因此绑定对象从 workspace 变为「S 的 fork 子代理」，触发者从机器所有者本人
扩展为「本人亲手拉进群的任何人」。

关键既有约束：

- 二期1 准入 fail closed 且静默丢弃（不暴露 bot 背后有 agent）；全局 allowlist 空
  清单 = 不放行任何人。
- `chat_bindings` 是 chat 路由唯一真相；`invocation_channel` 是回复目标唯一授权。
- 表情状态机零模型参与、fail-soft；文字回复归 Agent（二期1 D7 真机否决了系统代发）。
- Pet 域 schema 当前 v4；migration 只加不清。
- pitfalls 文档（`docs/notes/dsh-plugin-integration-pitfalls.md`）：声明与装配是两回
  事；事件结构必须实测。

宿主能力已由真机 spike 全绿钉死（`spike/qa-subagent/FINDINGS.md`，全真实包零 stub，
唯一伪造件是脚本化 LLM adapter）。本设计的每个宿主调用面都直接引用该 spike 的实测
结论，不再有未验证假设。

## Goals / Non-Goals

**Goals:**

- 源会话 S 内点击 Q&A → 原子地完成 fork child + 建飞书群 + 写 qa 绑定，失败即整体
  回收。
- qa 群内任何成员 @bot → 消息作为 child 的独立 turn 排队执行，child 带 S 的完整
  上下文回答/干活并自己回群。
- parent 非驻留（包括 DSH 重启后）时投递路径仍然成立（resume / coldResume）。
- child 以 continuable subagent 形态收纳在 S 名下，用户可在 GUI 展开直接对话。
- 表情反馈、去重、水位、channel 生命周期沿用二期1 机制。

**Non-Goals:**

- `/pet` 会话内通信面（直接进 child 会话对话即可，用户已确认不做）。
- qa 群的重新 fork / 上下文同步动作（用户可在 child 私聊里口头补充进展；backlog）。
- 多群绑定同一 child、群成员级细粒度权限、消息脱敏。
- 非 qa 绑定的任何行为变化（allowlist、default workspace 路由、workspace-resident
  Task 原样保留）。
- 群解散/踢人等群管理操作的自动响应（绑定失效按 fail closed 兜底）。

## Decisions

### D1 Q&A 是 Host 内置动作，不是导入 Skill

点击 Q&A 后要做的三件事——从 S fork child、以 bot 建群、写绑定行——全部依赖
Host 才有的信息与授权（live Agent 对象、Pet repository、LarkClient）。Skill 形态
拿不到 chat_id 回写通道（capability 执行只有 turn 终态，无结构化返回），而造一个
「模型提供 chat_id 的回写工具」直接违反现行 spec 的「MUST NOT 接受模型生成的
chat/thread/user ID」。

替代方案（均否决）：（a）q&a Skill 自己 `im +chat-create`——绑定行无从写起；
（b）Skill 建群 + `pet_bind_chat` 受信工具——扩大模型可调用的写面且违反上述
Requirement。

这不违反「Skill 与 Pet 各自独立」原则（用户确认过该划分）：那条原则防的是
"两等 Skill"——凡是 Skill 必须是普通 Skill，Pet 不得提供适配机制。Q&A 根本
不是能力：它是 channel 基础设施的**出站半边**（二期1 的订阅/准入/路由/表情
同样全是 Host 内置），是"开一条新管道"的开关，开关必须长在管道上。建好管道
后在群里真正干活的仍是 child 继承自源会话的普通能力，基础设施层不抢 Skill
层的活。

推论：轮盘出现第一个「不来自导入 Skill」的动作（方案 α，用户在 α/β 间显式
选定：Q&A 上轮盘与能力并列，而非挪进 Task 面板保持轮盘纯 Skill）。轮盘语义
从「已启用 Skill 列表」变为「快捷入口」，`dsh-pet` 主规范的轮盘 Requirement
相应扩展「内置动作」类别；内置动作不进 Skill allowlist 模型、不产生
`/<skill>` envelope。Q&A 动作仅在来源为未归档 session 时可用。

### D2 建群事务：fork 先行，三步失败即整体回收

顺序：① `startContinuable(fork)` 建 child（spike Q1：需 exact live parent Agent、
`sessionPersistence` 在场；childId 可由 Pet 预分配，延续二期1「预分配 id + 显式
中间状态」的做法）→ ② `im +chat-create --as bot --users <本人 open_id>` 建群 →
③ 写 `chat_bindings` 行（`kind: 'qa'`、`qaChildSessionId`、`qaParentSessionId`）。

fork 放最前：child 建好但群失败时回收成本最低（drainContinuableChildren 释放 +
归档 Task）；反之群建好 fork 失败，就留下一个无人管理的飞书群，只能提示用户手工
解散（bot 无解散群 API 的假设未验证，不承诺）。步骤③失败时同样回收①并明示②的
残留群。三步全部成功前，qa 绑定不存在，入站消息按普通（非 qa）路径处理——即
fail closed。

本人 open_id 来源：`channel_config.allowOpenIds` 首位（二期1 初始即机器所有者）。
Q&A 动作前置校验 channel 已绑定且 bot 可用（`botReady()`），未绑定时动作禁用并
指向设置页。

### D3 qa 准入：群成员即许可，豁免全局 allowlist

qa 绑定行的存在本身就是准入依据：群由 Host 亲手创建，成员只能被群内的人（初始
仅本人）拉入。能在群 G 发言 ⇒ 已被本人信任链拉入 ⇒ 允许触发。admission 检查按
绑定行 `kind` 分流：`qa` 跳过 sender allowlist，其余防线（mention 命中自身
open_id、msg_id TTL 去重、启动水位、消息类型/空内容）原样适用；非 `qa` 行为
完全不变。

替代方案（否决）：把群成员逐个同步进 allowlist——需要轮询成员变更，且把「群
维度信任」错误地提升为「全局信任」（被拉进 qa 群的人不应能触发其它 chat）。

信任口径诚实声明：child 继承 S 的组合，有全量工具；spec 不承诺任何能力边界，
信任来源是「本人显式建群 + 本人亲手拉人」。child prompt 要求涉及修改工作区先向
提问者确认——这是防呆不防坏的行为约束，不是安全边界。

### D4 投递：宿主队列直达 child，不经二期1 envelope/dispatch

qa 群的触发消息经 `queueHostSubagentPrompt(ctx.subagents, liveParent, childId,
content, source, signal)`（`dsh-subagent/internal` 子路径导出；spike Q2 实测：
消息成为 child 独立新 turn，上下文=种子+既往轮次+新消息完整在场）。不复用二期1
的 `acceptConversation`（它创建 root executor 并走 envelope），qa 消息的 prompt
由 channel 层直接渲染（沿用触发者身份注入 + 「只回本会话」硬性要求 + 修改先确认
条款）。

排队语义由 child 的 Agent inbox 承担（FIFO，spike 证实 queue delivery 逐条成
turn），Pet 不再自建 Invocation 串行队列；但每条触发消息仍写 `invocation_channel`
行（复用现有表，invocationId 位置写 qa 投递记录 id）以承载表情状态与回复目标
审计。`source` 用 `{kind:'user'}`（spike 注记：自定义 MessageSource kind 的 GUI
渲染未验证，不引入）。

`parent` 参数必须是 exact live Agent：投递前 `agents.get(parentSessionId)`，miss
则 `agents.resume({resumeSessionId})`（spike Q3：需 sessionPersistence；DSH 重启
后 child 冷恢复由 continuation manager 自动完成，要求 descriptor 快照的 LLM
provider 已注册——恢复失败按 D6 fail closed）。

### D5 终态观测：`subagent/end` 事件驱动表情

二期1 的表情终态挂在 executor 的 turn 终态观测上；qa child 的 turn 由 continuation
manager 驱动，对应的宿主观测点是 `subagent/end` 事件（scope-filtered，带
`stopReason` 与 `lastAssistantMessage`）。收到触发消息 → 打 OnIt（记 reaction_id
进 `invocation_channel`）→ 对应 turn settled → 删 OnIt 打 DONE/失败。沿用二期1 的
fail-soft 原则与「settledAt 显式标记」教训（9.5：不能按队列位置推断待反馈项）。

spike 坑 1 的对策：`queueHostSubagentPrompt` 返回仅代表 inbox 接受，MUST NOT 据此
标记任何完成状态；所有终态仅来自 `subagent/end`。

多条消息在队列中时逐条对应：每条消息一行 `invocation_channel`，turn 结束按到达序
匹配最早未 settled 的行（child inbox 是 FIFO，顺序有保证；若观测到乱序则记
Diagnostics 并放弃该行表情——fail-soft 不阻断）。

### D6 源会话失效：fail closed 且群内明示

S 归档/删除后：Q&A 链路的 parent 无法 resume（或 resume 后 lineage 校验失败）。
此时绑定行标记失效，后续 @bot 不再触发工作。与二期1「静默丢弃」不同，qa 群内
bot 已公开回复过消息，静默只会让群友以为 bot 坏了：Host 以 bot 身份在群内回复
一条固定文案（「绑定的源会话已不可用，请重新发起答疑群」），每绑定至多提示一次
（防刷屏），随后恢复静默。设置页 qa 绑定行展示失效状态，用户可归档。

child 不随 S 失效而销毁：其会话与既往问答仍可在 GUI 查看，只是不再接收群消息。

### D7 持久化：schema v4 → v5，只加不清

```
chat_bindings        + kind: 'workspace' | 'qa'（存量行读作 workspace——zod default）
                     + qaChildSessionId?  + qaParentSessionId?
                     + qaInvalidatedAt?（失效标记，含原因）
tasks                + qa-child 形态：executorSessionId 即 child session id，
                       新 sourceKind 'qa-chat'（与 chat 区分：不同建 Task 路径）
```

`invocation_channel` 复用不改。v5 migration 为 ADDITIVE，参照 v3→v4 先例：不清
任何表，v4 数据加载后行为不变。

qa Task 的作用：给 GUI 面板一个与既有 Task 列表一致的管理位（查看、归档=解除
绑定），并作为 `invocation_channel` 行的挂靠点。它不承载串行队列（D4）。

### D8 GUI：child 收纳零开发，私聊不出站

spike Q4：child 出现在 `listChildren(parentSessionId)`（需 `sessionQuery` 服务），
DSH 自带的 subagent 折叠 UI 直接收纳展示，label 用「答疑群 · <群名>」。用户展开
私聊走 DSH 原生 `prompt()` 路径，不产生 `invocation_channel` 行，因此天然不触发
表情与群回复——这个不对称是特性：私聊是所有者调教 child 的通道。

Pet 新增注入：`subagents`（含 internal 子路径）、`sessionPersistence`、
`sessionQuery`。均按二期1 shellEnv 的教训以可选依赖姿态接入（`ctx.get` /
`ctx.inject` 回调），缺失时 Q&A 动作禁用并给出诊断，不阻断 Pet 其余能力加载。
fork provider 需在部署组合启用；probe 不到时同样禁用动作。

### D9 spike 实测锚点（实现必须遵守）

引自 `spike/qa-subagent/FINDINGS.md`，实现与测试直接以此为准：

1. `startContinuable`/queue 返回 ≠ turn 完成 ≠ 已落盘；终态只信 `subagent/end`。
2. 宿主退出路径确保 `sessions.flush`（Pet stopping 时 flush 相关会话）。
3. 会话日志事件形状不统一：`user/message` 顶层即 message，`assistant/message` 是
   `{message, turn, step}` 包裹；解析处必须用真实样本测试。
4. child turn 号延续 parent 种子计数，不从 1 开始；断言勿假设。
5. 冷恢复读 descriptor 快照的 provider/model；Pet 启动顺序须保证 LLM provider
   注册先于首次 qa 投递（实践上由 DSH 组合保证，Pet 侧在恢复失败时给出指向性
   诊断即可）。
6. fork 种子截到最后一个完成 `turn/end`，in-flight turn 不进种子；Q&A 动作入口
   明示「以最近完成的一轮为准」。
7. child 工具组成继承自 `applyChildComposition`——真机验收必须对照 S 本体验证
   child 工具数量（pitfalls #1 的「声明≠装配」在此形态同样适用）。

## Risks / Trade-offs

- [群友触发 → child 在真实工作区有全量能力] → 信任前移到「本人亲手拉人」；spec
  诚实声明不承诺边界；prompt 要求修改先确认（行为约束，非安全边界）；触发面
  仅限本人创建的 qa 群。
- [群消息构成提示注入面，且注入者不再限于本人] → 与上一条同口径：拉人即授信。
  child prompt 标注消息来源身份；`invocation_channel` 留全量审计。
- [child 上下文停在建群时刻，S 的后续进展不可见] → 有意取舍（连续性 > 新鲜度，
  用户已确认）；所有者可经 child 私聊口头同步；重新 fork 留 backlog。
- [队列积压（多人连续 @bot）] → child inbox FIFO 天然排队，每条消息 OnIt 先行
  确认收到；个人场景不设上限；Diagnostics 展示待处理数。
- [表情行匹配依赖 FIFO 顺序假设] → 乱序时 fail-soft 放弃该行表情并记 Diagnostics，
  不影响执行与回复。
- [建群成功但后续步骤失败留下残留群] → D2 顺序把该窗口压到步骤②③之间；失败
  文案明示残留群名，指导手工解散。
- [lark-cli `+chat-create` 契约漂移] → 建群调用集中在 LarkClient 单点封装并测试；
  失败即事务整体失败，无部分状态。
- [coldResume 依赖 provider 注册时序] → 恢复失败 fail closed + 指向性诊断
  （D9.5），不静默换模型（沿用二期1「不回退到另一个模型」原则）。

## Migration Plan

1. sqlite v4 → v5 随插件升级自动执行（只加字段/形态，可安全回退到 v4 读取；
   `kind` 缺省读作 workspace）。
2. Q&A 动作依赖探测（subagents/fork provider/sessionPersistence/sessionQuery/
   channel 已绑定）不满足时动作禁用并显示原因；存量非 qa 链路不受任何影响。
3. 回滚 = 归档 qa Task/绑定（child 停止接收群消息，群与 child 会话保留）或
   `dsh.yaml` 禁用 Pet；新字段数据保留。

## Open Questions

- qa 群名的默认拼法（「答疑 · <S 标题截断>」？）与 child label 拼法——实现时定，
  不影响结构。
- 失效提示文案与「至多一次」的判定粒度（每绑定 vs 每失效原因）——实现时定。
- ~~`+chat-create` 后 bot 是否自动成为群主、能否解散群~~ → **已解答（真机 +
  帮助文本）**：不传 `--owner` 时群主默认为 **bot**（帮助文本明写 "defaults to
  bot"）。这不是可接受的默认——群主是权限而非称谓，只有群主能改名、拉人踢人、
  解散与转让，等于让 agent 代管用户自己的群。已改为显式把发起者本人指定为群主
  （见 tasks 9.3，真机确认新建群群主为本人）。解散能力仍未验证，但本设计不依赖
  它：绑定失效走 fail closed，残留群由用户手工处理。
