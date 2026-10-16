## MODIFIED Requirements

### Requirement: Locus 统一关联主会话子会话与飞书入口

系统 SHALL 以 locus 表达一段持续协作关联，包含飞书入口、workspace 归属、主会话、专属子会话、权限和生命周期。入口 SHALL 以根标识 `chatId` 与可选子入口标识 `threadId` 寻址。IM 入口的 `chatId` 是飞书 chat 标识，`threadId` 是话题标识。文档入口的 `chatId` 是带前缀的 `doc:docx:<文档底层 token>`，`threadId` 是划词评论的 `comment_id`（见 `pet-locus-doc-comments`）。入口类别 SHALL 仅由 `chatId` 前缀判定，以 `doc:` 开头即为文档入口，因此两类入口天然落在互不相交的键空间。既有 IM 记录的寻址与存储键 MUST 与本变更前逐字节相同，且不被改写。带 `doc:` 前缀的根标识 MUST NOT 被任何 IM 接口当作 chat 使用。普通消息标识与单条评论回复标识（`reply_id`）MUST NOT 作为长期入口身份。workspace SHALL 与主会话归属一致。一个入口 SHALL 至多有一个活跃 locus，一个活跃 locus SHALL 恰好拥有一个专属子会话；一个主会话 SHALL 可关联多个 locus。系统 MUST NOT 以子会话作为绑定源产生孙辈。

#### Scenario: 同一研发主会话服务多个现场
- **WHEN** 同一主会话分别关联开发群、issue 群和话题
- **THEN** 每个入口拥有独立子会话，全部直属该主会话，不共享执行历史

#### Scenario: 同群话题关联不同主会话
- **WHEN** 两个话题分别显式指定不同主会话
- **THEN** 两个 locus 独立寻址，workspace 各自随主会话，不改变彼此关联

#### Scenario: 子会话不能作为绑定源
- **WHEN** 绑定前缀仅命中一个子会话
- **THEN** 不建立关联，回执与无可用匹配一致

#### Scenario: 既有群入口键不变
- **GIVEN** 升级前持久化的群 locus（chatId `oc_A`）与话题 locus（`oc_A` + thread `omt_T`）
- **WHEN** 升级后加载并计算入口键
- **THEN** 两者被判定为 IM 入口，键分别与升级前完全相同，行字节未被改写

#### Scenario: 文档与群标识不串键
- **GIVEN** 文档 token `X`，以及一个虚构的、字面值同为 `X` 的 chat 标识
- **WHEN** 分别以 `doc:docx:X` 与 `X` 计算入口键、解析授权、比较 Delivery 关联
- **THEN** 两者键不同；以其中一个查询，不会返回另一个的 locus、授权或 Delivery

#### Scenario: 规范化不丢失文档前缀
- **GIVEN** 文档评论级入口 `(doc:docx:D, c2)`
- **WHEN** 依次经过入口规范化、键计算与键反解析
- **THEN** 结果仍为 `(doc:docx:D, c2)`，并被判定为文档入口

### Requirement: 投递与结算关联独立于会话运行状态

每条接受消息 SHALL 有持久 Delivery，至少标识以下各项：入口、locus 代际、child session、触发 `messageId`、接受顺序、`acceptedAt`、deadline、队列/终态与出站结果。

IM Delivery 的 `messageId` 是飞书消息标识。文档 Delivery 的 `messageId` 是 `doc:docx:<token>/<comment_id>/<reply_id>`，它同时是持久去重键，MUST NOT 被当作 IM 消息标识使用。

普通消息标识与评论回复标识 MUST NOT 成为长期 locus 身份，但业务回复 MUST 使用 current Delivery 不可变的触发目标：
- IM 群级与话题级回复都 MUST 以触发 `messageId` 做飞书按消息回复；话题回复还 MUST 留在 Host 从入站事件确认的原话题。
- 文档级与评论级回复都 MUST 追加在触发 `comment_id` 所在的评论下。该评论的 token MUST 与入口 `chatId` 中的 token 相同；评论级入口的 `comment_id` 还 MUST 与入口 `threadId` 相同。不一致时 SHALL 以 `association-unproven` fail closed，不发送。

接受不等于投递，投递不等于完成，模型 `turn/end` 不等于 Delivery 终态。初始化、GUI 私聊、父子补问 MUST NOT 消耗 current。Host SHALL 保证每个 locus 至多一个 current，且完成、超时与重复调用通过原子状态竞争只终结该项一次；迟到调用 MUST NOT 消费后续 Delivery或新代际。

业务正文唯一完成入口 SHALL 是 caller-bound `pet_locus_finish`。`reply` 必须携带非空正文；`no-reply` MUST NOT 携带正文且必须记录非空原因。工具 MUST NOT 接受任何 Delivery、chat、message、thread、文档、评论、回复或 target selector。Host SHALL 以实际 caller、active locus/generation/permission 与唯一 current 解析不可变目标；不满足时 fail closed。

等待入口 SHALL 是 caller-bound `pet_locus_wait({ waitMinutes, reason? })`。`waitMinutes` SHALL 表示从调用时刻起预计还需等待的正整数分钟，单次不得超过 1440；工具可重复调用，只能延长不能缩短 deadline。初始 deadline SHALL 为 `acceptedAt + 1h`，任何声明后的 deadline MUST NOT 超过同一消息 `acceptedAt + 24h`。Host SHALL 返回实际 deadline、剩余分钟与是否触及硬上限；wait MUST NOT 完成 Delivery或关联父回答。

达到 deadline 的 current SHALL 原子进入 `expired` 并推进；超过 `acceptedAt + 24h` 的 backlog SHALL 在投递前直接过期。Host SHALL 尽力中止过期 current 的运行，但中止成功 MUST NOT 成为撤销回复能力或推进队列的前提；持久状态才是权威。超时 MUST NOT 自动重建 child session。

`reply` SHALL 在发送前原子进入 `finishing` 并固定当前 Delivery。平台明确成功 SHALL 记录 `completed/replied`；明确失败 SHALL 记录 `failed`；请求可能已发出但没有可靠确认 SHALL 记录 `unknown-terminal`。三者均 SHALL 推进队列；`unknown-terminal` MUST NOT 自动重发。`no-reply` SHALL 记录 `completed/no-reply` 后推进，不发送正文。

Host SHALL 维护进行中/完成/失败等控制反馈；反馈失败不阻断工作，也不得冒充业务正文。启动恢复 SHALL 在开放 intake 前过期超时项、把遗留 `finishing` 收敛为 `unknown-terminal`、恢复未过期 current 的 deadline 调度，或在无 current 时幂等投递最早未过期 backlog。无法证明 current、child 或 generation 一致时 SHALL 暂停对应 locus 并诊断，不猜目标、不重放发送、不新建替代身份。

`current` 是物理投递栅栏，仅凭身份即可跨重启保留——但它同时覆盖「已在 child 手中」与「投递尚未交接就随进程终止」两种情形。因此启动恢复 SHALL 额外区分这两者：当且仅当子会话自身日志能证明该 Delivery 的 `inboxMessageId` 从未进入任何 turn、且已不在该子会话的待运行队列中时，该行 SHALL 经正常 claim 栅栏重新投递，MUST NOT 仅挂 deadline 等其过期而静默丢失。证明不成立（仍排队、已被 turn 领取、turn 未闭合、日志为空或无法精确折叠）时 MUST NOT 重放，按既有规则保留或记为人工债。

#### Scenario: 群级引用触发消息
- **WHEN** 群 locus 的 current Delivery 由消息 `om_A` 触发且 child 以 `reply` 完成
- **THEN** Host 使用 bot 身份按消息回复 `om_A`，不得只按 `chatId` 发送普通群消息，也不得引用 backlog 中其它消息

#### Scenario: 话题回复留在原话题
- **WHEN** 话题 locus 的 current Delivery 由该话题内消息 `om_T` 触发且 child 以 `reply` 完成
- **THEN** Host 引用 `om_T` 并使用平台 thread reply 语义把正文留在原话题，不回落到群主时间线

#### Scenario: 文档评论回复回到触发评论
- **GIVEN** 文档 `D` 的文档级 locus，current Delivery 的 `messageId` 为 `doc:docx:D/c1/r1`
- **WHEN** child 以 `reply` 调用 `pet_locus_finish`
- **THEN** Host 以 bot 身份对文档 `D` 的评论 `c1` 追加一条回复，不新开评论、不发往任何群，Delivery 记录 `completed/replied`

#### Scenario: 文档回复目标与入口不符
- **GIVEN** 评论级 locus 入口为 `(doc:docx:D, c2)`，持久 Delivery 的 `messageId` 为 `doc:docx:D/c3/r1` 或 `doc:docx:D2/c2/r1`
- **WHEN** child 以 `reply` 调用 `pet_locus_finish`
- **THEN** Host 不发送，Delivery 不进入 `finishing`，拒绝类别为 `association-unproven`

#### Scenario: 升级需离线迁移并先备份
- **GIVEN** 版本戳为 15 的状态库，DSH 已停止
- **WHEN** 执行 `dsh-pet-migrate-state --yes`
- **THEN** 同目录生成 `state.sqlite.v15.bak-<ms>`，内容与迁移前逐字节相同；版本戳变为 16；随后 v16 Host 能打开存储，原有 IM locus 照常服务

#### Scenario: 未迁移时 v16 拒绝打开
- **GIVEN** 版本戳为 15 的状态库，且未执行迁移
- **WHEN** 以 v16 包启动 Host
- **THEN** 存储以 `version-mismatch` 拒绝打开，诊断给出可直接复制的离线迁移命令

#### Scenario: v15 拒绝打开 v16 库
- **GIVEN** 版本戳为 16、含有文档 locus 的状态库
- **WHEN** 以 v15 包启动 Host
- **THEN** 存储以 `version-mismatch` 拒绝打开，任何以 `doc:` 为前缀的行都不会被加载；用升级时生成的备份覆盖后，v15 Host 能正常打开存储

#### Scenario: turn 结束不完成请求
- **WHEN** current Delivery 的原始模型 turn 正常结束但 child 未调用 `pet_locus_finish`
- **THEN** Delivery 仍为 current，后续 backlog 不投递，父消息可在后续 turn 继续该请求

#### Scenario: 相对等待受绝对上限约束
- **WHEN** 消息在 10:00 接受，child 在不同时刻反复声明相对等待
- **THEN** Host 可按 `now + waitMinutes` 延长 deadline，但最终 deadline 永不晚于次日 10:00，重复声明不能滚动突破 24 小时

#### Scenario: 超时自动开放下一条
- **WHEN** current A 到达 deadline 且 backlog 中 B 尚未超过自身硬上限
- **THEN** A 原子变为 `expired`，Host 尽力中止 A 的运行并在同一 child session 上把 B 设为 current 后投递

#### Scenario: 完成与超时竞争
- **WHEN** `pet_locus_finish` 与 deadline expiry 并发处理同一 current
- **THEN** 只有一个状态转换成功；失败方不得发送正文、重复终结或作用于下一条 Delivery

#### Scenario: 迟到 finish 不消费下一条
- **WHEN** A 已过期且 B 已成为 current，A 的旧运行随后调用 `pet_locus_finish`
- **THEN** Host 拒绝旧调用，不得将其正文发送到 A 或 B，也不得终结 B

#### Scenario: 发送确认未知不重放
- **WHEN** Host 已发起对 current 触发消息的回复，但无法确认平台是否成功
- **THEN** Delivery 进入 `unknown-terminal` 并推进，启动恢复和正常调度都不自动重发该正文

#### Scenario: Host 重启恢复未过期 current
- **WHEN** Host 重启时发现一个未过期 current 且原 locus/generation/child 可精确证明
- **THEN** 恢复同一 current、同一 child session 与 deadline 调度，不把 `turn/end` 当完成，不新建替代 session

#### Scenario: Host 重启处理遗留 finishing
- **WHEN** Host 重启时发现发送结果尚未落账的 `finishing` Delivery
- **THEN** 将其收敛为 `unknown-terminal` 并继续队列，不重放可能已经成功的飞书发送

#### Scenario: 私聊与群消息交错
- **WHEN** GUI 私聊或初始化发生在 current 飞书请求处理期间
- **THEN** 不消费该请求、不产生飞书正文，相关执行不能调用 finish/wait 获得 current 能力

#### Scenario: 旧代际迟到结算
- **WHEN** S0 child 在入口切换后出现迟到 finish
- **THEN** 该调用不能更新 S1 或其 current Delivery，无法安全提交时只诊断

#### Scenario: 宿主重启无法证明关联
- **WHEN** 恢复时无法精确证明持久 current 对应原 child 与 locus generation
- **THEN** 暂停该 locus intake 并诊断，不猜 FIFO、最近消息或新建替代身份


### Requirement: 管理面的标识以确定性短码表达且名称与短码成对

管理面 SHALL 为每类对象提供由真实标识**确定性派生**的短码，并以该短码作为线索即可复制完整标识。以下每类对象各有一条明确规则：locus、父会话与子会话、群与会话入口、话题、文档入口、评论入口、工作区。文档入口与评论入口的规则：
- 文档入口：源子串取 `chatId` 中 `doc:docx:` 之后的 token，显示标签为 `doc·`，兜底名为 `文档 · <短码>`，名称取 `drive +inspect` 返回的文档标题。
- 评论入口：`comment_id` 是按时间递增的数字，前缀相同的情况很常见，因此源子串取 `threadId`（`comment_id`）的**逆序**字符串，使截取的前缀落在末尾数字上。显示标签为 `cmt·`，兜底名为 `评论 · <短码>`。
- 碰撞时按类别加长，沿用现有规则。
- 不同类别靠显示标签区分，不依赖源子串不同。短码 MUST NOT 被用作任何请求的输入或身份来源。当平台提供可辨识名称时，管理面 SHALL 优先呈现名称，且名称 SHALL 与短码成对出现——名称单独 MUST NOT 构成身份。平台未提供名称时，管理面 SHALL 呈现由角色词与短码构成的兜底名，MUST NOT 猜测平台事实（例如在 chat 类型未知时写成「群」）。原始标识 MUST NOT 作为入口行的主要标识，SHALL 收在可展开的标识区并可复制。

#### Scenario: 同名入口仍可区分

- **WHEN** 同一父会话下两个入口的平台名称同为「答疑 · DSH」
- **THEN** 两行分别显示名称并各自附带不同的短码，所有者可区分二者

#### Scenario: 名称不可得时不猜测

- **WHEN** 平台未提供该入口的名称，且该 chat 的类型未知
- **THEN** 管理面显示兜底名（角色词 + 短码）并说明这是兜底显示，不得显示为「群」或其它未证实的平台事实

#### Scenario: 短码不是身份

- **WHEN** 客户端尝试以短码发起任一 locus 操作
- **THEN** 请求不被接受；所有操作仍以完整标识与代际栅栏寻址

#### Scenario: 文档入口短码确定且与群可区分
- **GIVEN** 文档入口 `doc:docx:AbCdEf123`，以及群入口 `oc_AbCdEf123`
- **WHEN** 分别多次计算两者的显示短码
- **THEN** 文档入口每次都显示以 `doc·` 开头、源自 `AbCdEf123` 的同一短码；群入口显示以 `oc·` 开头的短码；两者完整显示文本不同

#### Scenario: 多个文档入口短码互不相同
- **GIVEN** 两个文档入口 `doc:docx:AAAA1111` 与 `doc:docx:AAAA2222`
- **WHEN** 管理面同时呈现二者
- **THEN** 两个短码不同，且都不是 `doc:` 这样的公共前缀

#### Scenario: 同前缀的评论入口短码可区分
- **GIVEN** 同一文档下的两个评论入口，`comment_id` 分别为 `7696945640885996815` 与 `7696945648012135660`（前 9 位相同）
- **WHEN** 管理面同时呈现二者
- **THEN** 两个短码分别为 `cmt·5186` 与 `cmt·0665`；两行都不以完整 `comment_id` 作为主要标识

#### Scenario: 文档标题不可得
- **GIVEN** `drive +inspect` 读取文档 `D` 的元数据失败
- **WHEN** 管理面呈现该文档入口
- **THEN** 显示 `文档 · <短码>`，并标明为兜底名

### Requirement: 自动主会话按群建立且只使用 default workspace

系统 SHALL 为协作先行的群或文档，在已配置且可用的 default workspace 中创建一个该群或该文档专属的自动主会话，并持久复用。不同群、不同文档，或群与文档之间，MUST NOT 因 default workspace 相同而共用自动主会话。文档根由带前缀的 `chatId`（`doc:docx:<token>`）标识。本期 MUST NOT 应用旧 chat 到 workspace 覆盖路由。default 缺失/不可用时 SHALL 停止创建并诊断，不能选择其它目录。

bot 入群 MUST NOT 产生任何持久后果：不建主会话、不建子会话、不写 locus 记录，也不分析历史或执行项目工作。关联结构 SHALL 由 allowlist 成员的首个合格 @ 按需建立，并在同一次准入中投递该消息。这与已归档的 `pet-locus-on-demand-tree` 决定以及当前实现一致；此前这里写的是“入群可初始化”，与之不符，本 change 一并修正。

#### Scenario: 入群不产生持久后果
- **WHEN** bot 被拉进一个尚无关联的群
- **THEN** 不产生群级标记、主会话、子会话或 locus 记录，直到该群出现首个合格 @

#### Scenario: 首次消息补齐
- **WHEN** 该群尚无关联，allowlist 成员首次 @bot
- **THEN** 创建群专属自动主会话和 locus 子会话，再处理该消息

#### Scenario: 重复初始化
- **WHEN** 同群多个首次请求并发到达
- **THEN** 仅产生一个群级自动主会话，重复调用复用同一结构

#### Scenario: default 不可用
- **WHEN** 自动创建时 default workspace 无法解析
- **THEN** 不创建主/子会话，不回退其它 workspace，管理面说明原因

#### Scenario: 文档首次评论建立文档专属主会话
- **GIVEN** 文档 `D1`、`D2` 和群 `oc_G` 都还没有 locus，default workspace 可用
- **WHEN** allowlist 成员先后在 `D1` 的评论、`D2` 的评论和 `oc_G` 中首次 @bot
- **THEN** 产生三个互不相同的自动主会话，分别归属 `doc:docx:D1`、`doc:docx:D2`、`oc_G`

### Requirement: 出站业务回复的 @ 引用渲染为平台真实提醒

入站正文把 mention 预渲染成显示名，出站文本消息却必须使用平台标记才成为提醒；系统 SHALL 在发送业务回复前完成这一翻译，使 Agent 写出的引用成为真实提醒，而不是让对方收不到通知的纯文本。

本要求只适用于 IM 入口（`chatId` 不以 `doc:` 开头）。文档入口的业务回复与控制回执 SHALL 按纯文本发送，MUST NOT 读取任何 chat 成员列表，也 MUST NOT 改写 @ 引用；文档投递提示 MUST NOT 承诺 @ 会成为提醒。

对 IM 入口，渲染 SHALL 只使用当前 chat 成员列表给出的精确成员映射，且只改写**整词**引用。可解析的引用有两种：**显示名**（`@` 之后紧跟完整显示名，其后为空白、标点或串尾）与**成员的精确 open_id**（`@ou_…`，其后为同类边界）；前者用「显示名 → open_id」映射，后者用「open_id → 显示名」映射，两者都改写为 `<at user_id="ou_…">显示名</at>`。

接受 open_id 引用是必需的，不是便利：Agent 可能只拿到 `ou_…` 而没有显示名（投递提示词在无法解析显示名时就只给出 open_id），此时它写出的 id 会作为纯文本发出——对方收不到通知，且该标识被公开在群里。渲染它既通知到正确的人，也不再公开该标识。

以下情形 MUST 保持原文不改写：正文已包含 `<at ` 标记；同一显示名对应多个成员（歧义）；引用不属于该 chat 成员（未知显示名，或不是本 chat 成员的 open_id）；`@` 之前是词内字符（如邮箱地址）。

成员列表不可读、映射缺失或渲染异常时 SHALL fail-soft：按原文发送，MUST NOT 阻断发送或改变 Delivery 终态。诊断 SHALL 只记录低基数分类与改写次数，MUST NOT 记录姓名、open_id 或正文。

对 IM 入口，注入 SHALL 告知 Agent 群内 @ 人的可行写法，并说明 Host 会渲染整词显示名，使别名与群显示名不同时仍能由 Agent 显式给出标记。

#### Scenario: 唯一命中的整词引用成为真实提醒
- **WHEN** Agent 回复正文含 `@赵鸿珂 看完了`，且该 chat 成员中恰有一人显示名为「赵鸿珂」
- **THEN** 发送的正文该处变为 `<at user_id="ou_…">赵鸿珂</at>`，平台侧产生真实提醒

#### Scenario: 裸 open_id 引用也成为真实提醒
- **WHEN** Agent 回复正文含 `@ou_322ec1d3cd062f04bc2b1f4ba1eff8e9`，且该 open_id 是本 chat 成员
- **THEN** 发送的正文该处变为 `<at user_id="ou_322ec1d3cd062f04bc2b1f4ba1eff8e9">张勇</at>`，平台侧产生真实提醒，且正文不再出现裸 open_id

#### Scenario: 同名歧义不改写
- **WHEN** 该 chat 有两个成员显示名同为「张伟」，正文写 `@张伟 请看`
- **THEN** 正文原样发送，不猜测指向哪一位

#### Scenario: 非成员名字与词内 @ 不改写
- **WHEN** 正文写 `@外部同事` 或 `wang@example.com`
- **THEN** 两者都按原文发送，不尝试跨群解析、不改动邮箱

#### Scenario: 非成员 open_id 不改写
- **WHEN** 正文写 `@ou_stranger_99`，而该 open_id 不是本 chat 成员
- **THEN** 正文原样发送，不跨群解析、不猜测该标识指向谁

#### Scenario: 已是标记形式则不改写
- **WHEN** 正文已含 `<at user_id="ou_…">赵鸿珂</at>`
- **THEN** 该正文整体原样发送，不重复包装

#### Scenario: 成员表不可读时仍能发出
- **WHEN** 群成员列表调用失败或返回无法解析的结果
- **THEN** 回复按原文发送并记录一次低基数诊断，Delivery 终态与发送结果不受影响

#### Scenario: 注入说明平台写法
- **WHEN** Host 渲染一次统一 locus 投递提示与 `pet_locus_finish` 说明
- **THEN** 其中写明群内 @ 人直接写显示名即可、Host 会渲染为真实提醒，并给出别名不一致时用 `<at user_id="ou_…">` 明确指定的写法

#### Scenario: 文档回复不渲染 @
- **GIVEN** 文档入口的 current Delivery，Agent 回复正文中含有 `@张勇 看下`
- **WHEN** Host 发送该回复
- **THEN** 正文原样发送，不含 `<at` 标记；本次发送期间没有调用 chat 成员列表接口
