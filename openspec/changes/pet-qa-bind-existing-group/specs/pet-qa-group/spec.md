# Pet QA Group Specification (Delta)

## ADDED Requirements

### Requirement: 既有群经 `/bind` 绑定到已存在的会话

系统 SHALL 支持在一个尚无 qa 绑定的群内，通过 `@bot /bind <会话前缀>` 把该群绑定到
一个已存在的 DSH 会话，并 fork 出与 Q&A 动作同形态的 continuable 子代理。命令
SHALL 使用显式动词而非裸 token：绑定后群内正常对话中出现的同形字符串 MUST NOT 被
解释为命令。

`/bind` 命令本身 MUST 仅由全局 allowlist 内的发送者触发。既有群的成员不是被本人
为此目的拉入的，`kind: qa` 豁免 allowlist 所依赖的「成员即可信」前提在此不成立；
非 allowlist 发送者的 `/bind` SHALL 被**静默丢弃**，MUST NOT 回复无权提示——那等于
向未授权者确认 bot 背后存在 agent。

绑定成功后，该群 SHALL 继承 `kind: qa` 的群成员提问权：此后任何群成员 @bot 均可
提问。该继承的信任依据是「所有者显式绑定了这个群」，与 Q&A 场景中「所有者亲手建群」
等价；系统 MUST NOT 因此宣称任何能力边界。

绑定流程 SHALL 复用建群事务除建群外的步骤（fork child → 写 `kind: qa` 绑定行），
失败时同样回收已建 child。绑定行 SHALL 记录该绑定的来源（Pet 建群 / 绑定既有群），
仅用于如实展示——`/bind` 的群 Pet 既非创建者亦非群主，系统 MUST NOT 承诺对其的任何
群管理能力。

绑定成功与失败的回执 SHALL 发送在群内而非私聊发起者：群成员有权知道本群已接入一个
持有某段工作上下文、并能在真实工作区执行命令的 agent。成功回执 SHALL 说明 child 以
源会话**最近一个完成 turn** 为准。

#### Scenario: allowlist 用户在既有群绑定会话
- **WHEN** allowlist 用户在一个无 qa 绑定的群中发送 `@bot /bind <唯一前缀>`
- **THEN** 系统 fork 该会话的子代理、写入 qa 绑定行，并在群内回执说明绑定结果与种子边界

#### Scenario: 非 allowlist 成员尝试绑定
- **WHEN** 一个不在 allowlist 的群成员发送 `@bot /bind <前缀>`
- **THEN** 消息被静默丢弃，不绑定、不回复、不暴露 bot 背后存在 agent

#### Scenario: 绑定后群成员提问
- **WHEN** 绑定完成后，一个不在 allowlist 的群成员 @bot 提问
- **THEN** 该提问按 qa 路径投递给 child，与 Q&A 建群的群行为一致

#### Scenario: 绑定后同形文本不再被当作命令
- **WHEN** 已绑定群中有人 @bot 发送一条恰好含有类似前缀字符串的普通提问
- **THEN** 该消息作为提问投递给 child，MUST NOT 被解释为绑定命令

### Requirement: 会话前缀解析 fail closed 且不泄露

系统 SHALL 以 ≥6 位的会话 id 前缀解析目标会话，长度与界面上展示的短 id 一致，并
SHALL 接受更长前缀以化解重复。匹配范围 SHALL 限于未归档会话。

前缀无匹配与匹配到多个 SHALL 返回**同一句**回执，MUST NOT 透露匹配数量，MUST NOT
透露任何未命中会话的存在或其属性。前缀 MUST 仅用于查找，MUST NOT 作为任何其它
操作的输入。

#### Scenario: 前缀唯一命中
- **WHEN** allowlist 用户提供的前缀恰好命中一个未归档会话
- **THEN** 系统绑定该会话，并在回执中给出其标题供发起者当场核对

#### Scenario: 前缀命中多个会话
- **WHEN** 提供的前缀命中两个及以上未归档会话
- **THEN** 系统不绑定，回执提示未能唯一确定会话、请提供更长前缀，且不透露命中数量

#### Scenario: 前缀无匹配
- **WHEN** 提供的前缀不匹配任何未归档会话
- **THEN** 系统不绑定，回执与命中多个时**完全相同**，使两种情形不可区分

## MODIFIED Requirements

### Requirement: Q&A 动作原子地创建答疑群并 fork 源会话子代理

系统 SHALL 在 Pet 轮盘提供 Host 内置的 Q&A 动作，仅当来源为未归档 DSH session、
channel 已绑定且 bot 可用、且宿主 fork 能力可用时可用；不满足时 SHALL 禁用并
展示可诊断原因。

群与源会话 SHALL 保持**双向 1:1**：一个源会话至多拥有一个活跃答疑群，一个群至多
绑定一个源会话。任一侧已被占用时，新的绑定请求 SHALL 固定失败并说明原因。占用的
判据是对应作用域存在**未归档** Task；归档 qa Task 是解绑的唯一正式手段，系统
MUST NOT 引入第二种解绑概念。绑定行已失效（记录了失效时间）时视为未占用，系统
SHALL 归档其 Task 后继续，MUST NOT 把一个无法应答的死绑定当作占用。

点击 Q&A 时系统 SHALL 先按**源会话**查找活跃 qa Task：命中且其绑定有效时 SHALL
返回既有群并标明属复用，MUST NOT 新建群或新 child。作用域键 MUST 以源会话构成，
MUST NOT 以 chat 构成——群的 chat_id 是本次调用的产物，以它为键的查找永远无法命中
既往群，每次点击都会再建一个。该键 SHALL 与普通 session 作用域相互独立，使同一
会话可同时持有浮层 Task 与答疑群。

未命中复用时系统 SHALL 按序完成：① 对源会话 fork 一个 continuable 子代理
（种子为源会话截至最近一个完成 turn 的前缀）；② 以 bot 身份创建仅含本人与
bot 的飞书群，且 SHALL 显式将**发起者本人**指定为群主——以 bot 身份建群会默认
把群主归于 bot，使群的实际所有者无法改名、拉人、移除成员或解散自己的群；
③ 写入 `kind: qa` 的绑定行（记录群 chat_id、child session、源 session）。任一步失败 SHALL 使整体失败：已建的 child SHALL 被回收，绑定行
MUST NOT 写入；已建群无法回收时 SHALL 向用户明示残留群名。三步全部成功前，
该群的入站消息 SHALL 按非 qa 路径处理。

动作结果 SHALL 区分「新建」与「复用」并如实呈现给用户：两种结果外观相同会使
用户在不知情时反复建群。

#### Scenario: 成功创建答疑群
- **WHEN** 用户在一个有完成 turn 的会话来源上点击 Q&A 且三步均成功
- **THEN** 飞书出现仅含本人与 bot 的新群且**群主是本人**，Pet 记录 qa 绑定，child 以源会话上下文为种子建立

#### Scenario: 同一会话再次点击 Q&A
- **WHEN** 某会话已有活跃答疑群，用户在该会话再次点击 Q&A
- **THEN** 系统返回既有群并标明属复用，不创建新群、不 fork 新 child

#### Scenario: 归档后重新建群
- **WHEN** 用户归档某会话的 qa Task 后再次点击 Q&A
- **THEN** 系统创建新的答疑群，旧群与其 child 历史保留

#### Scenario: 另一会话各自建群
- **WHEN** 另一个源会话点击 Q&A
- **THEN** 它获得自己的答疑群，与前一会话的群互不复用

#### Scenario: 会话侧已被占用时绑定既有群
- **WHEN** 某会话已有活跃答疑群，allowlist 用户在另一个群 `/bind` 该会话
- **THEN** 绑定固定失败并说明该会话已有答疑群，需先归档

#### Scenario: 群侧已被占用时再次绑定
- **WHEN** 某群已绑定会话 A，allowlist 用户在该群 `/bind` 会话 B
- **THEN** 绑定固定失败并说明该群已绑定，需先归档

#### Scenario: 失效绑定不构成占用
- **WHEN** 某群的 qa 绑定已失效，allowlist 用户在该群重新 `/bind` 一个会话
- **THEN** 系统归档失效绑定的 Task 后完成新绑定

#### Scenario: 创建失败不留部分状态
- **WHEN** Q&A 动作的 fork 成功但后续步骤失败
- **THEN** 已建 child 被回收，不写入绑定行
