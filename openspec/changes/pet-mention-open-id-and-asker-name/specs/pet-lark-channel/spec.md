## MODIFIED Requirements

### Requirement: 会话内容由 Agent 自取而非预先注入

系统 MUST NOT 把会话历史压平后注入 Invocation prompt。压平会丢失转发、话题、卡片、图片等结构，且把成本花在与问题无关的消息上。注入 SHALL 只包含触发消息本身、触发者身份与会话标识。

当本机 lark-cli 的 bot 身份可用时，注入 SHALL 告知 Agent 可以此身份直接读取飞书内容，并 SHALL 指向 lark-cli 自带的能力文档（列出与精读）而非内联固定命令清单——固定清单会与 CLI 演进脱节。注入 SHALL 要求所有调用显式使用 bot 身份。该可用性 SHALL 在每次创建 Invocation 时实际探测；不可用时系统 SHALL 明确声明该限制，MUST NOT 声称 Agent 具备它当前不具备的能力。

系统 MAY 为识别触发者而读取少量消息，但该读取结果——消息正文与压平后的历史——MUST NOT 作为会话上下文注入 prompt，也 MUST NOT 写入 Pet 持久层。

触发者身份是上一条 SHALL 注入的内容，因此其**显示名**不受上一条限制：系统 SHALL 从当前 chat 的成员列表解析触发者显示名，并 MAY 把它与 open_id 一并写入投递提示词与 Delivery 记录。这是正确性要求而非便利——只给出 `ou_…` 会使 Agent 把该标识当作称呼写进正文，从而既通知不到对方，又把标识公开在群里。解析失败时 SHALL fail-soft：只呈现 open_id，MUST NOT 因此暂停、拒绝或以其它方式改变该投递的结果。

#### Scenario: 触发消息含富文本或转发内容
- **WHEN** 触发消息或其上下文包含转发、话题、卡片或图片等结构化内容
- **THEN** prompt 不含被压平的历史文本，Agent 依据会话与消息标识自行读取原样内容

#### Scenario: 触发者显示名随身份一并注入
- **WHEN** 触发者 open_id 能在当前 chat 的成员列表中解析出显示名
- **THEN** 投递提示词的触发者身份同时呈现显示名与 open_id，Delivery 记录保留该显示名，且 prompt 仍不含任何压平的历史文本

#### Scenario: 成员列表不可读时只呈现 open_id 且不阻断
- **WHEN** 成员列表调用失败、返回无法解析的结果，或触发者不在该 chat 成员列表中
- **THEN** 投递提示词只呈现 open_id，投递照常接受、派发与结算

#### Scenario: bot 身份不可用时不虚报能力
- **WHEN** 创建 Invocation 时本机 lark-cli 的 bot 身份不可用
- **THEN** prompt 明确声明无法读取飞书内容且无法回复，Agent 可如实说明该限制
