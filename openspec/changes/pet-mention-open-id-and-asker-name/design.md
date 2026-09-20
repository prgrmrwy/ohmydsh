## Context

上一个 change（`pet-locus-delivery-safety-hardening`）的真机验收里发现：Locus child 会在回复开头写出裸 open_id
（`@ou_322ec1d3cd062f04bc2b1f4ba1eff8e9 你好…`）。它是纯文本——对方收不到通知，且该标识被公开在群里。

排查出两层原因：

1. **统一 locus 投递路径从不解析人类发送者的显示名。** 提示词里只有 `sender：ou_…`，而提示词同时要求
   「群内 @ 人直接写 `@显示名`」。模型没有名字可写，就用了它唯一拿到的东西。旧 pipeline 有这一步
   （`pipeline.ts` 从聊天历史取 `trigger.senderName`），统一路径没有；Pet 自己缓存的 `knownNames` 也没接进投递。
2. **出站渲染兜不住裸标识。** `renderMentions` 只按成员显示名整词匹配，`@ou_…` 匹配不到任何成员，
   于是 `no-unique-match` 原样发出。

修复已随该 change 发布（提交 `353b2c7`），但没有 delta spec：它落在该 change 声明的范围之外，
且与两条既有要求存在字面张力。本设计记录这些决策，作为规范澄清的依据。

## Goals / Non-Goals

**Goals**

- 出站回复在任何情况下都不把裸成员标识作为纯文本发出。
- 触发者身份在投递提示词里可读，使 Agent 能自然地称呼对方。
- 把上面两条要求之间的关系写清楚，使后续实现与审查有唯一真相源。

**Non-Goals**

- 不引入联系人 scope 或跨群身份解析：解析只用当前 chat 的成员列表。
- 不改变 mention 的全部既有保守规则（歧义不改写、已是标记不改写、词内 `@` 不改写、fail-soft）。
- 不触碰 `pet-locus-delivery-safety-hardening` 已发布的投递安全语义。

## Decisions

### 1. 渲染接受「成员精确 open_id」，与显示名并列

`renderMentions` 原先只有一个索引（显示名 → open_id）。新增 open_id → 显示名索引，对 `@ou_…` 形式的整词引用
同样改写为 `<at user_id="ou_…">显示名</at>`。

**为什么不能只修提示词**：模型完全可能从别处拿到 open_id（`pet_context` 输出、会话历史、错误信息）再写出来。
只补提示词挡不住这条路径，而兜底渲染对**任何来源**的裸标识都成立。

**为什么仍然安全**：渲染只在标识**属于当前 chat 成员列表**时发生，与显示名路径用的是同一份权威来源；
不属于则保持原文。不跨群解析、不猜测、歧义（同名多成员）依旧不改写。

### 2. `open_id → 显示名` 用独立索引，而不是复用显示名索引

两个方向的索引用途不同，且有效性条件不同：显示名可能一对多（歧义 → 不可用），open_id 天然一对一。
所以分开构建，各自只做自己那侧的校验。实现中这体现为 `membersByOpenId` 与 `uniqueMembers` 两个函数。

### 3. 触发者显示名随身份注入，并写入 Delivery 记录

投递前用 `resolveMemberName(chatId, openId)` 解析显示名，填入 `senderName`（Delivery 记录新增的可选字段），
提示词据此渲染为 `sender：张勇 ou_…`。解析复用 `lark.ts` 已有的 `memberList`
（`+chat-members-list --member-types user`，带短 TTL 缓存），不新增调用类型。

**与 `会话内容由 Agent 自取而非预先注入` 的关系**：该要求禁止的是把**压平的历史/消息读取结果**注入 prompt 或落库，
而它本身 SHALL 注入「触发消息本身、**触发者身份**与会话标识」。显示名属于触发者身份，因此不在禁止之列。
这一区分原本只隐含在两张要求的措辞里，本 change 把它写成明文。

**为什么是正确性要求而非便利**：只给出 `ou_…` 会促使 Agent 把标识当作称呼写进正文。第 1 条决策保证了
即使如此也能渲染成真实提醒，但行文仍是「以标识称呼人」，且渲染多依赖一次成员表读取能否成功。
注入显示名让正常路径就不产生这个问题。

### 4. 两条改动都 fail-soft

成员列表不可读、映射缺失、渲染异常时：提示词只呈现 open_id，回复按原文发送，投递照常接受、派发与结算。
诊断保持低基数（分类 + 次数），MUST NOT 记录姓名、open_id 或正文。

## Risks / Trade-offs

- **多一次成员表读取**：投递前解析显示名会触发一次 `+chat-members-list`。该调用已被 mention 渲染使用并带 TTL 缓存，
  所以是复用而非新增调用类型；读取失败不影响投递。
- **显示名进入持久层**：`senderName` 写入 Delivery 记录。它与既有的 `knownNames` 展示缓存同性质（人可读的展示值，
  不是授权依据）；准入与授权仍只比较 open_id。
- **渲染面略宽**：接受 open_id 引用意味着被改写的输入多了一类。约束是「必须精确命中当前 chat 成员的 open_id」，
  未命中即不改写，因此不会把任意字符串包成提醒。

## Migration Plan

无持久化格式迁移：`senderName` 是可选字段，缺少它的历史 Delivery 读作「无显示名」，提示词只呈现 open_id，
与本次改动前的行为一致。无需回填。

## Open Questions

无。
