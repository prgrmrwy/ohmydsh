## MODIFIED Requirements

### Requirement: 子会话判定请求意图并据此选择结局

子会话 SHALL 对每条 current Delivery 判定其属于**信息交换**（同步、问询、解释、定位）、**要求干活**（修改代码、修复缺陷）、**仅提示关联**（本 bot 只是被抄送、举例或告知另一方联系人，且没有要求本 bot 行动）还是**确实歧义**，并据此选择当场答复、登记待办、静默结算或澄清。判定 SHALL 由子会话结合请求文本与 Host 提供的结构化 addressing 事实做出；Host MUST NOT 对消息内容做分类，也 MUST NOT 依据关键词、其它 bot mention 或固定句式自动改写判定结果。

权限边界 MUST NOT 依赖该判定：locus 仍默认只读，判定为“要求干活”MUST NOT 使子会话获得任何写能力，判定为其它类别也 MUST NOT 使其获得飞书旁路出站能力。误判的唯一后果是结局选择不当，MUST NOT 导致越权。

信息交换、要求干活和仅提示关联三类确定结局都 SHALL 经既有 `pet_locus_finish` 结算该 Delivery；判定本身 MUST NOT 成为第二个完成入口。仅提示关联 SHALL 使用 `no-reply` 和非空审计原因，MUST NOT 发送业务正文，也 MUST NOT 用 `pet_locus_wait` 将该 Delivery 留在队头。

#### Scenario: 信息交换当场答复
- **WHEN** 子会话判定一条 Delivery 属于信息交换，并已用其只读能力得到答案
- **THEN** 它以 `pet_locus_finish` 的 `reply` 提交答案，不登记待办

#### Scenario: 要求干活登记待办
- **WHEN** 子会话判定一条 Delivery 属于要求干活
- **THEN** 它先登记待办，再以 `pet_locus_finish` 的 `reply` 回执受理事实，MUST NOT 尝试直接修改文件

#### Scenario: 仅提示另一 bot 作为联系人
- **WHEN** 消息同时 at 本 bot 与另一个 bot，但语义只是告诉另一方“有问题可以找本 bot”，没有请求本 bot 回答或执行
- **THEN** 子会话以 `pet_locus_finish(no-reply)` 静默结算并记录 reference-only 原因，队列继续推进

#### Scenario: 多 bot 语义不明确
- **WHEN** 消息同时 mention 多个参与方，且结合结构化 addressing 与文本仍无法确认本 bot 是任务对象还是关联方
- **THEN** 子会话按确实歧义处理，不把“出现其它 bot”本身当成 reference-only

#### Scenario: 误判不产生越权
- **WHEN** 子会话把一条信息交换请求误判为要求干活并尝试写入文件
- **THEN** 写入仍按现行权限模型被拒绝，判定结果 MUST NOT 作为授予写能力的依据

### Requirement: 意图不明时至多澄清一次且不跟丢

子会话无法判定当前 Delivery 属于信息交换、要求干活或仅提示关联时 SHALL 向当前飞书入口发出一次简短澄清。澄清正文 SHALL 通过 caller-bound `pet_locus_finish(reply)` 发送，并 SHALL 终结该 current Delivery、推进队列；普通 assistant 文本 MUST NOT 被当作已经发送的澄清。

用户后续合格的 at/reply SHALL 被接受为新的 Delivery，并在同一长期 child session 及其历史中继续理解；系统 MUST NOT 为此恢复旧 Delivery、重建 child 或允许新回答绕过正常队列。新 Delivery 可依据已保存历史直接分类；同一 Delivery 不得发出第二次澄清。

澄清结算后若用户没有后续消息，系统 MUST NOT 自动登记待办，也 MUST NOT 依赖不存在的 model turn 或 deadline hook 推断用户沉默。只有新的 Delivery 明确表达要求干活，或在该新 Delivery 中仍需按现有规则登记时，才可创建待办。

#### Scenario: 澄清经唯一业务出口发送
- **WHEN** 子会话对 current A 的意图确实无法判定
- **THEN** 它以 `pet_locus_finish(reply)` 发送一次澄清，A 进入已回复终态；普通 assistant turn/end 不承担发送

#### Scenario: 澄清后的回答是新 Delivery
- **WHEN** A 的澄清已结算，用户随后 at 回答“只要你看一下原因”形成 B
- **THEN** B 按正常接受顺序成为新 Delivery，由同一 child 结合自身历史按信息交换处理，不重新打开 A

#### Scenario: 用户不再回答
- **WHEN** 澄清 Delivery 已结算且用户没有发送后续合格消息
- **THEN** 系统不创建待办、不保留 current，也不安排虚构的超时模型轮次

#### Scenario: 新回答仍然歧义
- **WHEN** 后续新 Delivery 结合同一 child 历史仍无法判定意图
- **THEN** 该新 Delivery 可按本要求独立发出至多一次澄清；限制按 Delivery 计数，系统不得在同一 Delivery 内重复追问
