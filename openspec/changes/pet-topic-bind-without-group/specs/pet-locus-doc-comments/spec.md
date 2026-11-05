## MODIFIED Requirements

### Requirement: 文档评论按全文/划词同构映射为文档级与评论级入口

系统 SHALL 把飞书云文档评论映射为 locus 入口，与群/话题同构：
- 文档是根，对应群。全文评论属于文档级入口。
- 每条划词评论是一个子入口，对应话题，以其 `comment_id` 标识。该评论下的所有后续回复属于同一个子入口。

文档入口 SHALL 以带前缀的根标识寻址：文档级为 `chatId = "doc:docx:<token>"`，评论级在此基础上加 `threadId = <comment_id>`。
- `<token>` SHALL 取自事件的 `notice_meta.file_token`，即文档的底层对象 token。知识库中的文档同样以底层 obj token 为根，MUST NOT 以 wiki 节点 token 建立入口。
- 第一期只支持 `file_type=docx`。其它类型的评论事件 SHALL 静默丢弃，并记诊断 `unsupported-file-type`。

全文与划词的判定 SHALL 只依据以 bot 身份按 `comment_id` 查询到的评论事实 `is_whole`：`true` 为文档级，`false` 为评论级。
- 评论查询调用失败（平台错误、超时、输出不可解析）时，SHALL 在进程内重试，最多 2 次，间隔依次为 2 秒、5 秒。平台事件不会重推，不重试的话这条评论就永久丢失。重试不持久化，Host 重启后不续做。停止或停用 channel SHALL 取消尚未完成的重试；channel 停止之后才完成的查询或重试 MUST NOT 接受该事件，也 MUST NOT 回复或打表情。
- 重试用尽仍失败，或查询成功但 `is_whole` 缺失、不是布尔值、结果中没有该 `comment_id` 时，系统 MUST NOT 投递到文档级入口或任何其它入口，SHALL 停止派发并记诊断 `comment-scope-unknown`。
- 该 `comment_id` 已有评论级 locus 时，可直接推定为划词，但仍须取正文。

层级、建树时机与继承 SHALL 与群/话题规则一致：
- 首条合格事件到达时建树，文档内没有评论时不预建任何东西。
- 由普通授权 @ 首次建立评论级入口时，SHALL 先确保文档根结构存在。
- 由该划词评论内的显式 `/bind` 首次建立评论级入口时，SHALL 遵循 `pet-locus-collaboration`「入口建立统一为一条路径」中话题显式绑定的规则：
  - 文档根结构未建立时，只建立该评论级入口，且不带 `parentLocusId`（下称"无父评论"）。MUST NOT 为文档根 auto 建立主会话，也 MUST NOT 修复旧模型文档根。
  - 文档根已按三层模型建立但不可服务时，绑定被拒绝。
- 文档无主会话、且需要 auto 建立文档根时，SHALL 在 default workspace 中创建一个**文档专属**的自动主会话。不同文档 MUST NOT 共用自动主会话。
- 新评论级入口默认使用文档当前的主会话，显式来源优先。已建立的评论级入口固定其主会话；无父评论在文档根之后建立时，也不被改挂。
- 文档级与评论级子会话是同一主会话下的兄弟。

入站时才能得到、又无法从持久标识推出的评论事实，SHALL 在接受 Delivery 时随其持久化，此后不再修改：
- 划词评论的划词原文，以 `docComment.quote` 保存。保存值 SHALL 不超过 2 000 个 UTF-16 码元，截断标记计入上限；超长值 MUST NOT 写入持久层。全文评论不写入该字段。
- 来源、token、`comment_id`、`reply_id` 以及全文/划词的区分 SHALL 从入口 `chatId` 前缀、`threadId` 和 Delivery `messageId` 推导，MUST NOT 另存一份。

投递 prompt 中的划词原文 SHALL 取自持久 Delivery，MUST NOT 取自入站事件。首次投递、排队后投递、Host 重启后再投递，三者渲染出的评论事实 SHALL 相同。

#### Scenario: 全文评论进入文档级入口
- **GIVEN** 文档 `D` 尚无 locus；allowlist 成员在全文评论 `c1` 的根回复 `r1` 中 @bot；查询得到 `is_whole=true`
- **WHEN** 系统处理该事件
- **THEN** 建立入口 `chatId=doc:docx:D` 的文档专属自动主会话、子会话与 active locus；Delivery 的 `messageId` 为 `doc:docx:D/c1/r1`

#### Scenario: 划词评论进入评论级入口
- **GIVEN** 文档 `D` 已有文档级 locus，主会话为 S0；成员在划词评论 `c2` 中 @bot；查询得到 `is_whole=false`、`quote="接口已有"`
- **WHEN** 系统处理该事件
- **THEN** 建立入口 `(doc:docx:D, c2)` 的子会话，主会话为 S0，与文档级子会话为兄弟；投递 prompt 中包含标注为不可信的划词原文 `接口已有`

#### Scenario: 重启后再投递排队中的划词评论
- **GIVEN** 入口 `(doc:docx:D, c2)` 的子会话正忙；`c2` 下新的触发回复 `r5`（划词原文 `接口已有`）被接受为排队中的 Delivery；随后 Host 重启
- **WHEN** 前一个 Delivery 结算，`r5` 轮到投递
- **THEN** 投递 prompt 写明这是划词评论，并包含标注为不可信的划词原文 `接口已有`；评论类型（划词）、划词原文、触发回复正文、发送者，四项与未重启时首次投递渲染的完全相同；投递过程不发起任何评论查询

#### Scenario: 划词评论下的后续回复留在同一入口
- **GIVEN** 入口 `(doc:docx:D, c2)` 已存在
- **WHEN** 有人在 `c2` 下回复并 @bot（`notice_type=add_reply`，新 `reply_id` 为 `r9`）
- **THEN** 该事件投递给 `(doc:docx:D, c2)` 的子会话，Delivery `messageId=doc:docx:D/c2/r9`，不新建入口

#### Scenario: 划词评论先于文档级
- **GIVEN** 文档 `D` 尚无任何 locus
- **WHEN** 第一条合格事件来自划词评论 `c2`
- **THEN** 先为文档根 `doc:docx:D` 建立文档专属的自动主会话，再建立 `(doc:docx:D, c2)` 子会话。此时 `(doc:docx:D, c2)` 的主会话就是该文档根的主会话；之后文档级入口首次建立时，它的主会话也是同一个会话 id

#### Scenario: 知识库文档以底层 token 为根
- **GIVEN** 知识库节点 `wikN` 背后的 docx obj token 为 `docO`；评论事件给出 `file_token=docO`、`file_type=docx`
- **WHEN** 系统建立入口
- **THEN** 入口根为 `doc:docx:docO`，不存在任何以 `wikN` 为根的入口

#### Scenario: 评论查询一次失败后重试成功
- **GIVEN** 评论 `c1` 的第一次查询超时，2 秒后的重试返回 `is_whole=true`
- **WHEN** 系统处理该事件
- **THEN** 该事件按全文评论投递，诊断中没有 `comment-scope-unknown`

#### Scenario: 评论查询重试期间停用 channel
- **GIVEN** 评论 `c1` 的第一次查询失败，正在等待 2 秒后的重试
- **WHEN** 用户停用 channel，之后原本的重试时刻到达
- **THEN** 不再发起重试；即使有在途查询返回成功，也不产生 Delivery，不回复，不打表情

#### Scenario: 无法判定全文或划词
- **GIVEN** 评论查询连续 3 次（首次加 2 次重试）返回错误或超时；或查询成功，但结果中缺少该 `comment_id` 或 `is_whole`
- **WHEN** 系统处理该事件
- **THEN** 不建立也不投递任何入口，不打表情、不回复，诊断记 `comment-scope-unknown`

#### Scenario: 非 docx 评论
- **GIVEN** 评论事件的 `notice_meta.file_type=sheet`
- **WHEN** 系统处理该事件
- **THEN** 静默丢弃，诊断记 `unsupported-file-type`，不调用评论查询


#### Scenario: 划词评论内首次显式绑定不建文档根
- **GIVEN** 文档 `D` 尚无任何 locus；用户会话 S1 未归档且不是子会话
- **WHEN** allowlist 成员在划词评论 `c5` 中发送 `@bot /bind <S1 前缀>`
- **THEN** `createMainSession` 调用 0 次；建立 `(doc:docx:D, c5)` 的 `not-created` 代际，父为 S1 的 locus 主会话，不带 `parentLocusId`；`doc:docx:D` 没有任何 locus 行

#### Scenario: 无父评论之后全文评论首个 at 走 auto
- **GIVEN** `(doc:docx:D, c5)` 是 S1 的无父评论，`doc:docx:D` 没有 locus 行
- **WHEN** allowlist 成员在全文评论中首次 @bot
- **THEN** 为 `doc:docx:D` 建立文档专属自动主会话与文档级入口；`(doc:docx:D, c5)` 的代际 id、父会话与代际号不变

#### Scenario: 文档根已停止时划词显式绑定被拒
- **GIVEN** `doc:docx:D` 的三层文档级 locus 已被所有者停止
- **WHEN** allowlist 成员在新划词评论 `c6` 中 `/bind S1`
- **THEN** 绑定被拒绝，不新建任何 locus 行或会话
