## MODIFIED Requirements

### Requirement: 子会话判定请求意图并据此选择结局

子会话 SHALL 对每条 current Delivery 判定其属于**信息交换**（同步、问询、解释、定位）、**要求干活**（修改代码、修复缺陷）、**仅提示关联**（本 bot 只是被抄送、举例或告知另一方联系人，且没有要求本 bot 行动）还是**确实歧义**，并据此选择当场答复、登记待办、静默结算或澄清。判定 SHALL 由子会话结合请求文本与 Host 提供的结构化 addressing 事实做出；Host MUST NOT 对消息内容做分类，也 MUST NOT 依据关键词、其它 bot mention 或固定句式自动改写判定结果。

信息交换 SHALL 先问后查：子会话 SHALL 先以 `locus_ask_parent` 向 locus 主会话询问；只有当 locus 主会话以 `locus_reply_child` 明确答复没有相关记录，或 `locus_ask_parent` 返回失败时，才 SHALL 用自己的只读能力自行查找。等待答复期间 current Delivery 由既有 deadline 规则保留，子会话可按既有规则用 `pet_locus_wait` 延长。本要求 MUST NOT 承诺\"等待超时后自行查找\"：到达 deadline 的 Delivery 按既有规则进入 `expired` 并撤销发送能力，此后子会话即使被唤醒也 MUST NOT 借该 Delivery 回复，迟到的父答复 MUST NOT 消费后续 Delivery——Host 在答复送达前核对答复携带的询问引用仍对应 current Delivery（见 `pet-locus-collaboration`「子会话读共识与 locus 主会话工具」）；送达后才换代的情况是已知局限。只有确实无需项目事实即可回答的问题（如问候、确认收到、对上一条答复的复述）可以不询问直接答复。

答复正文 SHALL 默认用业务口径：第一句给结论，正文保持简短，不复述问题，不写"我已/我先"一类过程叙述；MUST NOT 主动给出文件路径、函数、变量、RPC 或接口名，除非提问人要求实现细节或来源，或这些名字本身就是问题的答案。提问人追问时再补细节。

权限边界 MUST NOT 依赖该判定：locus 仍默认只读，判定为"要求干活"MUST NOT 使子会话获得任何写能力，判定为其它类别也 MUST NOT 使其获得飞书旁路出站能力。误判的唯一后果是结局选择不当，MUST NOT 导致越权。

信息交换、要求干活和仅提示关联三类确定结局都 SHALL 经既有 `pet_locus_finish` 结算该 Delivery；判定本身 MUST NOT 成为第二个完成入口。仅提示关联 SHALL 使用 `no-reply` 和非空审计原因，MUST NOT 发送业务正文，也 MUST NOT 用 `pet_locus_wait` 将该 Delivery 留在队头。

#### Scenario: 信息交换当场答复
- **WHEN** 子会话判定一条 Delivery 属于信息交换，并已得到答案
- **THEN** 它以 `pet_locus_finish` 的 `reply` 提交答案，不登记待办

#### Scenario: 信息交换先问主会话
- **WHEN** 子会话判定一条需要项目事实的 Delivery 属于信息交换
- **THEN** 它在调用任何文件读取或搜索工具之前先调用 `locus_ask_parent`，current Delivery 保持未结算等待答复

#### Scenario: 主会话无记录后自行查找
- **GIVEN** 子会话已就一条信息交换 Delivery 调用 `locus_ask_parent`
- **WHEN** locus 主会话答复"工作会话没有相关记录，请自查"
- **THEN** 子会话才用自己的只读能力查找，并以查到的结论答复；答复不宣称该结论来自工作会话

#### Scenario: 询问失败后自行查找
- **WHEN** `locus_ask_parent` 返回确定性失败原因（例如投递失败）
- **THEN** 子会话直接用自己的只读能力查找并答复，不再等待父答复

#### Scenario: 询问已投递但始终没有答复
- **GIVEN** 子会话已就 Delivery D 调用 `locus_ask_parent` 并投递成功，locus 主会话始终没有答复
- **WHEN** D 到达 deadline
- **THEN** D 按既有规则进入 `expired`，没有业务正文发出，队列推进；此后子会话对 D 调用 `pet_locus_finish` 被拒

#### Scenario: 父答复在 Delivery 过期后才到达
- **GIVEN** D 已 `expired`，同一入口的下一条 Delivery E 已成为 current
- **WHEN** locus 主会话此时才调用 `locus_reply_child` 答复 D 的询问
- **THEN** Host 以"询问已过期"拒收，子会话收不到该答复；D 保持 `expired`，E 保持 current 且未被结算

#### Scenario: 默认业务口径
- **WHEN** 提问人只问某个功能"是什么逻辑"，没有要求实现细节
- **THEN** 答复第一句是结论，正文不含文件路径、函数名、变量名或 RPC 名

#### Scenario: 追问实现细节时补充
- **WHEN** 提问人在后续消息里要求说明具体在哪个文件、哪个接口
- **THEN** 子会话在新的答复中给出文件或接口名

#### Scenario: 要求干活登记待办
- **WHEN** 子会话判定一条 Delivery 属于要求干活
- **THEN** 它先登记待办，再以 `pet_locus_finish` 的 `reply` 回执受理事实，MUST NOT 尝试直接修改文件

#### Scenario: 仅提示另一 bot 作为联系人
- **WHEN** 消息同时 at 本 bot 与另一个 bot，但语义只是告诉另一方"有问题可以找本 bot"，没有请求本 bot 回答或执行
- **THEN** 子会话以 `pet_locus_finish(no-reply)` 静默结算并记录 reference-only 原因，队列继续推进

#### Scenario: 多 bot 语义不明确
- **WHEN** 消息同时 mention 多个参与方，且结合结构化 addressing 与文本仍无法确认本 bot 是任务对象还是关联方
- **THEN** 子会话按确实歧义处理，不把"出现其它 bot"本身当成 reference-only

#### Scenario: 误判不产生越权
- **WHEN** 子会话把一条信息交换请求误判为要求干活并尝试写入文件
- **THEN** 写入仍按现行权限模型被拒绝，判定结果 MUST NOT 作为授予写能力的依据
