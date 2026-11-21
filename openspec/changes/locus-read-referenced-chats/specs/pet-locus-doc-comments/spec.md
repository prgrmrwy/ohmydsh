## MODIFIED Requirements

### Requirement: IM 专属能力在文档入口按明确规则处置

以 chat 成员、消息 id 或群历史为前提的能力 SHALL 只对 IM 入口生效。对 `chatId` 以 `doc:` 开头的入口，SHALL 按以下规则处置，MUST NOT 以文档 token 调用任何 IM 接口：

| 能力 | 文档入口 |
|---|---|
| 当前 Delivery 的媒体读取 | 不调用；投递 prompt 不提及媒体 |
| 群读取能力探测与读群说明 | 不调用、不渲染；改为说明 `pet_locus_doc_context` |
| `pet_locus_chat_history` | 不装配给文档子会话 |
| `pet_locus_message` | 不装配给文档子会话；投递 prompt 不提及它 |
| `pet_locus_linked_message` | 不装配给文档子会话；投递 prompt 不提及它 |
| 触发者显示名 | 以 bot 身份按 open_id 查联系人姓名；失败时只呈现 open_id 且不阻断 |
| 出站 @ 渲染 | 不渲染，按纯文本发送；prompt MUST NOT 承诺 @ 会成为提醒 |
| 待办“跳飞书” | 按 `pet-locus-intent-triage` 的规则跳到 `drive +inspect` 返回的文档 URL；评论级待办旁注评论 id，MUST NOT 伪造评论锚点 |

IM 入口的上述行为 SHALL 保持不变。

#### Scenario: 文档子会话的工具面
- **GIVEN** 一个文档级 locus 子会话（`accessMode` 为 `read-only`）
- **WHEN** 列出其可用工具
- **THEN** 包含 `pet_locus_doc_context`，不包含 `pet_locus_chat_history`、`pet_locus_message` 与 `pet_locus_linked_message`；composition attestation 通过

#### Scenario: 文档 Delivery 不调用 IM 接口
- **GIVEN** 一条文档 Delivery 被接受并投递，随后以 `reply` 完成
- **WHEN** 统计期间 Host 发起的 lark-cli 调用
- **THEN** 没有 `im +messages-mget`、`im +messages-reply`、IM reaction、chat members、chat history，以及 `message_links/query`、`im +threads-messages-list`、raw message read、消息资源下载调用；续读游标不存在于文档入口，因此也不存在续读调用

#### Scenario: 触发者姓名查询失败
- **GIVEN** 联系人查询返回权限错误
- **WHEN** 渲染文档 Delivery 的投递 prompt
- **THEN** prompt 只呈现 open_id，投递照常进行

#### Scenario: 文档待办跳转
- **GIVEN** 评论级入口 `(doc:docx:D, c2)` 上登记的一条待办
- **WHEN** 管理面渲染“跳飞书”
- **THEN** 链接等于 `drive +inspect` 返回的 `url`，旁注评论 id `c2`；链接中不含 IM 消息定位参数

#### Scenario: IM 入口不受影响
- **GIVEN** 一个群 locus 子会话
- **WHEN** 列出其可用工具并完成一次投递
- **THEN** 工具面除 `pet_locus_message` 与 `pet_locus_linked_message`（均仅在 Host 媒体能力可用时装配）外与此前相同，并照常执行群成员显示名解析和出站 @ 渲染
