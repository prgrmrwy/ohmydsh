## Purpose

子会话按请求意图分流：信息交换当场答复，要求干活则把已查清的结论登记为待办移交所有者，避免只读权限下的改动请求无痕消失。配套一条不唤醒主会话的只读查阅路径（读写分离，缓解父会话争用），以及一本按主会话归属的共享事实台账——主会话与其 locus 之间显式登记的结构化结论，本期唯一条目类型是待办。

## Requirements

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

### Requirement: caller-bound 只读父会话查阅不唤醒主会话

系统 SHALL 为子会话提供一个只读工具，用于检索其 caller-bound 主会话**已落盘**的历史，以支持意图判定与问题排查。该路径 SHALL 是纯数据读取：直接读取持久日志，MUST NOT 重新进入主会话、唤醒它、向其投递消息、占用其运行槽或消耗其 turn。多个子会话 SHALL 可并发使用该工具而互不争用。

工具 MUST NOT 接受任何会话、locus 或目标 selector。Host SHALL 从实际执行 caller 解析其唯一主会话；跨 locus、跨主会话、已失效关联与临时 subagent SHALL 收到统一拒绝，且 MUST NOT 泄露目标是否存在。

检索结果 SHALL 被表述为对话事实，MUST NOT 构成持久授权：执行根、权限与工作约束仍只能由所有者在管理面显式确认后写入锚点。读取不到、无相关内容或宿主缺少冷读能力时 SHALL 如实报告未确认，MUST NOT 猜测，MUST NOT 降级为向主会话提问，也 MUST NOT 因此获得提问能力。

#### Scenario: 主会话运行中仍可查阅
- **WHEN** 主会话正在处理所有者的 GUI 工作，两个子会话同时检索其历史
- **THEN** 两次检索都返回结果，主会话的运行不被打断、不排队、不新增待处理消息

#### Scenario: 不接受目标参数
- **WHEN** 子会话在调用中携带另一个会话或 locus 的标识
- **THEN** 调用被拒绝，不按该标识检索，也不透露该目标是否存在

#### Scenario: 读到的路径不等于写授权
- **WHEN** 子会话从主会话历史中读到某条提及可写目录的对话
- **THEN** 该事实不改变当前 locus 权限，提权仍需所有者确认锚点并通过现行派生

#### Scenario: 缺少冷读能力时如实降级
- **WHEN** 宿主未提供会话冷读能力
- **THEN** 该工具以不可用呈现并说明原因，MUST NOT 猜测内容，也 MUST NOT 改为向主会话发问

### Requirement: 共享事实台账按主会话归属并对同源只读开放

系统 SHALL 维护一个按 `parentSessionId` 唯一定位的共享事实台账，承载该主会话与其 locus 之间显式登记的结论。台账 SHALL 是**主会话与其 locus 的共享事实**，MUST NOT 按 workspace、仓库或显式"项目"实体聚合，MUST NOT 跨主会话合并，也 MUST NOT 被表述为项目级知识库。

台账 SHALL 只承诺三件事，并 MUST NOT 被解释为承诺统一的修订语义、生命周期或写入授权——那些由各类条目各自定义：

1. **归属**：按 `parentSessionId` 唯一定位；首次登记幂等建立；最后一条条目被移除后台账仍保留。
2. **授权**：该主会话及其当前有效 locus 子会话可读；跨源、已失效关联与临时 subagent SHALL 收到统一拒绝，且 MUST NOT 泄露台账或条目是否存在。
3. **命名空间**：条目按 `kind` 分区；本期唯一 kind 是待办；新增 kind MUST NOT 改变既有 kind 的语义、授权或生命周期。

台账共享的 SHALL 只是显式登记的结构化条目。它 MUST NOT 成为共享兄弟子会话对话历史或枚举兄弟入口的旁路：读取方只见条目本身及其已固定的来源标识，MUST NOT 据此获得兄弟 locus 的对话历史、入口清单或公开枚举。

#### Scenario: 同源子会话读到彼此登记的结论
- **WHEN** 同一主会话下的子会话 A 已登记一条带证据的待办，子会话 B 随后检索台账
- **THEN** B 读到该条目及其来源标识与证据，但读不到 A 的对话历史，也得不到 A 所属入口之外的入口清单

#### Scenario: 跨主会话不可读
- **WHEN** 另一主会话下的子会话尝试读取本台账
- **THEN** 请求被统一拒绝，回执不表明该台账是否存在

#### Scenario: 台账不随条目清空而消失
- **WHEN** 台账内最后一条待办被所有者标记完成或放弃
- **THEN** 台账记录保留，后续登记复用同一台账，不重新建立另一份

#### Scenario: 新增条目类型不改既有语义
- **WHEN** 将来引入待办之外的第二类条目
- **THEN** 待办的授权、生命周期与字段语义不因此改变，既有条目无需改写

### Requirement: 待办登记固定来源与回复去向且关联标识而非实例

系统 SHALL 提供 caller-bound 的待办登记工具。工具 MUST NOT 接受任何 locus、chat、message、thread 或 target selector；Host SHALL 从实际执行 caller 与其唯一 current Delivery 解析全部关联事实与台账归属，任一不可证明时 fail closed。

登记时 SHALL 固定以下事实：`locusId`（稳定标识，用于表达问题来源）、登记时的 `generation`（历史事实，仅供审计，MUST NOT 参与寻址）、`endpoint` 即 `(chatId, threadId?)`（回复去向）、触发 `messageId`（可回跳并可按消息引用回复）与请求人。

待办 SHALL 关联 locus **标识**而非 locus **实例**：代际更替、locus 重建、入口停止服务、主会话归档或群解散 MUST NOT 使待办消失、失效或被静默改写；其来源与去向仍可凭已固定的标识解析。待办归属 SHALL 跟随 `locusId` 与 `endpoint`，MUST NOT 跟随某一代 locus 的存续状态。

登记 SHALL 携带子会话已查明的证据（定位、原因、建议）。证据 SHALL 是登记时刻的快照事实，MUST NOT 自动刷新，也 MUST NOT 被呈现为当前仍然成立的结论。

#### Scenario: 工具不接受目标参数
- **WHEN** 子会话在登记调用中携带 chat、message 或 locus 标识
- **THEN** 调用被拒绝，Host 不采用模型提供的任何标识

#### Scenario: 代际更替后待办仍可解析
- **WHEN** 待办登记于 locus 第 2 代，该入口随后切换来源并产生第 3 代
- **THEN** 待办仍然存在，其来源与去向凭已固定的 `locusId` 与 `endpoint` 解析，登记时的 `generation` 保留为历史事实

#### Scenario: 入口退役不使待办消失
- **WHEN** 待办所属 locus 已被解绑或退役
- **THEN** 待办仍然存在且可被所有者处置，MUST NOT 被自动关闭或删除

#### Scenario: 无唯一 current 时拒绝登记
- **WHEN** 调用发生在没有唯一 current Delivery 的执行中
- **THEN** 登记被拒绝，不创建待办，也不猜测目标

### Requirement: 待办生命周期与 Delivery 结算解耦

登记待办 MUST NOT 使该 Delivery 长期保持 current。登记完成后，子会话 SHALL 经既有 `pet_locus_finish` 以 `reply` 当场结算并回执受理事实，队列按既有规则前进。

待办自身 SHALL 长期存活，其状态变化 MUST NOT 产生新的飞书出站正文、表情或 Delivery。系统 MUST NOT 把待办的未完成状态表述为对应请求尚未答复，也 MUST NOT 把 Delivery 的已结算表述为该事项已完成。

待办 SHALL 具备可由所有者推进的状态，至少区分待处理、已受理、已完成与已放弃；状态变化 SHALL 记录操作时间，MUST NOT 由模型自行改写。

#### Scenario: 登记后队列继续前进
- **WHEN** 子会话登记待办并结算该 Delivery，backlog 中还有下一条合格消息
- **THEN** 下一条消息按既有规则成为 current 并被投递，不因待办未完成而阻塞

#### Scenario: 回复完成不等于事情做完
- **WHEN** 一条要求干活的请求已回执受理且 Delivery 已结算
- **THEN** 对应待办仍为待处理，系统不把它呈现为已完成

#### Scenario: 待办状态变化不外发
- **WHEN** 所有者在管理面把一条待办标记为已完成
- **THEN** 系统不向原飞书入口发送任何正文或表情

#### Scenario: 模型不能改写待办状态
- **WHEN** 子会话尝试把一条已登记待办标记为完成
- **THEN** 请求被拒绝，状态仅可由所有者经管理面推进

### Requirement: 管理面呈现待办并提供由固定标识派生的跳转

所有者管理面 SHALL 呈现待办，按来源入口与状态组织，并展示其请求人、登记时间、证据摘要与当前状态。管理面 SHALL 支持所有者标记受理、完成或放弃。

每条待办 SHALL 提供两个由已固定标识派生的跳转：**跳飞书**按 `endpoint` 与触发 `messageId` 定位原始消息；话题待办指向该话题，无法证明话题身份时 SHALL 退化为所属群并如实说明，MUST NOT 伪造话题目标。**跳会话**按 `locusId` 解析当前代子会话。

管理面 SHALL 沿用既有 fail-closed 规则：目标已归档、已失效或不可达时 MUST NOT 提供可用跳转，SHALL 就地说明原因，MUST NOT 产生一次静默导航。待办所属 locus 已退役 MUST NOT 使该行从列表消失，其飞书跳转在平台资源仍存在时 SHALL 保持可用。

#### Scenario: 话题待办跳回原话题
- **WHEN** 所有者点击一条来自话题的待办的飞书跳转
- **THEN** 跳转指向该话题内的原始触发消息

#### Scenario: 话题身份不可证时退化
- **WHEN** 待办来自话题但其话题标识无法证明
- **THEN** 跳转退化为所属群并说明原因，不伪造话题目标

#### Scenario: 会话已归档时不可跳转
- **WHEN** 待办所属 locus 的当前代子会话已归档
- **THEN** 会话跳转不可用并显示原因，飞书跳转不受影响

#### Scenario: 退役 locus 的待办仍在列表中
- **WHEN** 某待办所属 locus 已退役
- **THEN** 该待办仍呈现在列表中并可被处置，其状态如实标明来源已退役
