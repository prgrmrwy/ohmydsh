## ADDED Requirements

### Requirement: Locus 三层实体

系统 SHALL 以三层表达一段协作：用户的**干活主会话**（普通一级会话，承担工作归属）←dsh-collab→ Pet 创建的一级 **locus 主会话**（与干活主会话 1:1）→ 每个入口一个 **locus 子会话**（父为 locus 主会话）。`loci` 行的父会话字段 SHALL 指 locus 主会话；干活主会话与 locus 主会话的关系 SHALL 记录在 `locus_mains`（`{workSessionId, locusMainSessionId, generation, status, spaceId}`），同一干活主会话任一时刻至多一个 active 的 locus 主会话。入口寻址（`chatId`/`threadId`、文档入口前缀规则）与本变更前相同。workspace SHALL 与干活主会话一致；locus 主会话 SHALL 建在干活主会话所在 workspace。locus 主会话 SHALL 由 Host 设审批 `never`、沙箱 `read-only`，并以 deny 式 `tools.restrict` 挡掉 `bash`、`write`、`edit` 与委派类工具，保留 Host 层的 `collab_*` 工具；Pet 只对自己创建的 locus 主会话向 dsh-collab 声明 `owns`。

#### Scenario: 同一干活主会话服务多个入口
- **WHEN** 同一干活主会话分别关联开发群与一个话题
- **THEN** 两个入口的子会话都以同一个 locus 主会话为父，`locus_mains` 中该干活主会话只有一条 active 记录

#### Scenario: locus 主会话工具面锁死
- **WHEN** 读取 locus 主会话的已发布工具面与会话设置
- **THEN** 不含 `bash`、`write`、`edit` 与任何委派工具，含 `collab_*`；审批为 `never`，沙箱为 `read-only`

#### Scenario: 干活主会话不得是子会话
- **WHEN** 所有者以一个 subagent 会话为目标执行 `/bind`
- **THEN** 绑定被拒绝，不建立 locus 主会话

### Requirement: 入口建立统一为一条路径

auto、Q&A 与显式绑定 SHALL 走同一建立路径，只在"干活主会话从哪来"上不同：auto（未绑定入口首个授权 at）由 Pet 在 default workspace 新建干活主会话；Q&A 以所有者打开的会话为干活主会话；`/bind` 以所有者指定的普通一级会话为干活主会话。之后 SHALL 一致地：复用该干活主会话的 active locus 主会话，没有则新建 locus 主会话并按\"协作空间由干活主会话与 locus 主会话两个普通成员组成\"建立空间；为入口发布一个子会话状态为 `not-created` 的新代际。建立 MUST NOT 预先创建子会话。显式绑定改变入口来源时 SHALL 如实告知上下文改变。

#### Scenario: auto 建立
- **WHEN** 一个从未关联的群收到所有者的首个 at
- **THEN** Pet 新建干活主会话与 locus 主会话，建立协作空间，入口新代际为 `not-created`，随后按首条消息创建子会话并处理该消息

#### Scenario: 绑定到已有干活主会话复用 locus 主会话
- **GIVEN** 干活主会话 W 已有 active locus 主会话 M
- **WHEN** 所有者把另一个群 `/bind` 到 W
- **THEN** 不新建 locus 主会话，新入口的父为 M

#### Scenario: 建立失败不留半成品
- **WHEN** 新建 locus 主会话成功但建立协作空间失败
- **THEN** 本次建立失败并回执；provisioning 操作按\"provisioning 失败超时后不再阻塞\"处理，补偿器归档未投入使用的 locus 主会话

### Requirement: 子会话在首条消息到达时创建

入口代际处于 `not-created` 时，第一条可投递的 Delivery SHALL 以官方 `startContinuable`（provider `spawn`，`parent` 为 locus 主会话，`prompt` 为该 Delivery 的投递 prompt，`toolFilter` 为不含委派的宽底座）创建子会话，并在 `agent/created` 中安装档位收紧层、设置沙箱并回读；任一步失败 SHALL 令创建失败并回滚。发布 SHALL 在 `agent/created` 回调内完成，而不是等 `startContinuable` 返回（实测其在首轮认领之后才返回）：创建前持久预留子会话身份；回调内依次认领预留、安装组合并回读、发布同一 `childId` 的 marker `tier3`、current 与首轮认领所需的关联（inbox 消息与执行身份），最后完成预留交接；这些步骤 MUST 早于首轮认领。回调内发布之后若创建流程仍被拒绝，Host SHALL 回滚已写入的持久状态（不得留下可服务的 active/current），该 Delivery 按非名额失败结算、代际回到 `not-created`；MUST NOT 以撤销已提交的预留代替补偿。创建失败 SHALL 分两类：运行体名额不足属于可重试失败，该 Delivery SHALL 保持待处理（不结算、不换代、不补偿），名额释放或下一次派发时以同一 Delivery 重试创建，且不超过其 deadline；其它失败（组合核验、provider、首轮回读等）该 Delivery SHALL 以确定性原因结算并回执，代际保持 `not-created`，下一条消息重试创建。后续 Delivery SHALL 经官方 `sendMessage` 投递。系统 MUST NOT 使用空闲创建或借出子会话 Session 的兼容能力。

#### Scenario: 首条消息即首个 prompt
- **WHEN** `not-created` 代际收到第一条 at
- **THEN** 恰调用一次 `startContinuable`，其 `prompt` 为该 Delivery 的投递 prompt；代际转为 active 并带 `tier3`

#### Scenario: API 返回前首轮已能解析身份
- **GIVEN** 替身在 `startContinuable` 返回之前依次触发 `agent/created`、首条 prompt 认领与首个 caller-bound 工具调用
- **WHEN** 首个工具为 `pet_context`
- **THEN** 工具解析到原 Delivery 与本入口；该 Delivery 只投递一次，Host 未再调用 `sendMessage`

#### Scenario: 回调内发布后创建被拒时回滚
- **WHEN** 回调内已发布 marker 与 current，随后创建流程拒绝
- **THEN** 不留下 active 代际或 current；该 Delivery 以确定性原因结算，代际为 `not-created`；下一条 at 可再次创建

#### Scenario: 创建失败不推进代际
- **WHEN** `startContinuable` 因 `agent/created` 回读不符而失败
- **THEN** 该 Delivery 结算为失败并回执原因；代际仍为 `not-created`；下一条 at 再次尝试创建

#### Scenario: 名额不足时保留原请求
- **WHEN** `not-created` 代际的第一条 Delivery 创建时运行体名额已满，随后名额释放
- **THEN** 该 Delivery 在名额满时保持待处理且未回执失败；释放后以同一 Delivery 恰创建一次子会话并投递，用户无需重发

#### Scenario: provider 不能证明独立上下文
- **WHEN** `spawn` provider 不可用或声明继承父上下文
- **THEN** 不调用 `startContinuable`，Delivery 以能力不可用结算

### Requirement: 换绑与归档按层处理

- 干活主会话被归档时，其全部入口 SHALL 停止服务；授权 at SHALL 得到有限次回执，说明来源会话已归档并提示所有者 `/bind` 到新的干活主会话；MUST NOT 自动复活或自动换来源。
- 入口子会话永久不可用（被删除、组合或身份核验失败、非名额原因的冷恢复失败）时 SHALL 在同一 locus 主会话下发布新代际（`not-created`），不影响同一 locus 主会话下的其它入口。
- 冷恢复因运行体名额不足失败时 SHALL 保留原子会话、原代际与原 Delivery，按"子代激活受运行体名额约束时 fail closed"在名额释放后重试，且不超过该 Delivery 的 deadline；MUST NOT 换代。
- locus 主会话不可用（被归档、删除或 preset 核验失败）时 SHALL 为该干活主会话新建 locus 主会话，迁移其名下全部未被所有者停止/退役的入口（每个入口发布 `not-created` 新代际），并建立新协作空间；旧 locus 主会话及其子会话一律不再恢复。迁移结果 SHALL 回执已迁移数与逐条跳过原因。
- 所有者停止/退役的入口 MUST NOT 被上述任一路径复活。

#### Scenario: 干活主会话归档
- **WHEN** 干活主会话 W 被归档后，W 名下某群收到所有者 at
- **THEN** 不投递给子会话，群内收到"来源会话已归档，请 /bind"回执；同一入口的后续 at 在达到次数上限后不再回执

#### Scenario: 子会话不可用只换该入口一代
- **GIVEN** locus 主会话 M 下有入口 A、B
- **WHEN** A 的子会话因组合核验失败（非名额原因）无法冷恢复
- **THEN** A 发布新代际（`not-created`），B 的代际与子会话不变

#### Scenario: 名额不足的冷恢复保留原代际
- **GIVEN** 入口 A 的子会话 C 已被释放，代际为 g
- **WHEN** 下一条 Delivery D 到达时名额已满导致恢复失败，随后名额释放
- **THEN** 名额满时 D 保持待处理、A 仍为代际 g；释放后恢复的是同一子会话 C 并投递 D，没有新代际

#### Scenario: locus 主会话不可用时整体迁移
- **GIVEN** M 下有 active 入口 A 与所有者已停止的入口 C
- **WHEN** M 被归档
- **THEN** 新建 M2，A 迁到 M2 并为 `not-created`；C 不迁移并在回执中说明原因；`locus_mains` 中 M 为非 active、M2 为 active

### Requirement: 旧模型入口按退休规则处理

本变更之前创建的 locus 行（父为用户会话或 Pet standby 主会话、marker 不是 `tier3`）SHALL 不被改写；读取时 SHALL 视为旧模型并退出路由。持久层版本 SHALL 升为 18，升级只新增 `locus_mains` 表。旧模型入口的下一条授权 at SHALL 按\"入口建立统一为一条路径\"的 auto 规则建立三层结构，并在回执中说明旧关联已退休；非授权 at MUST NOT 引发建立。旧模型行的子会话 MUST NOT 被 adopt 或冷恢复。

#### Scenario: 升级只加表
- **WHEN** 对 v17 数据库运行迁移脚本
- **THEN** 数据库版本为 18，新增 `locus_mains` 表，其它表的行逐字节不变

#### Scenario: 旧入口首个授权 at
- **WHEN** 升级后，一个旧模型群入口收到所有者 at
- **THEN** 新建三层结构并处理该消息，回执说明旧关联已退休；旧子会话未被恢复

#### Scenario: 旧入口非授权 at
- **WHEN** 同一旧入口收到非 allowlist 成员的 at
- **THEN** 不建立任何会话，按既有规则处理

### Requirement: provisioning 失败超时后不再阻塞

处于 `failed` 的 provisioning 操作超过 10 分钟后 SHALL 不再阻塞同一 endpoint；下一次针对该 endpoint 的建立请求 SHALL 先在运行期调用与启动对账相同的补偿器清理其 `resourceRefs`，补偿成功后再按无存量入口建立。补偿失败时 SHALL 继续阻塞并记录诊断。该规则 SHALL 对全部 provisioning kind 一致适用。

#### Scenario: 超时后重试
- **GIVEN** endpoint E 的建立在 t0 失败，已创建的 locus 主会话记在 `resourceRefs`
- **WHEN** t0 + 11 分钟时 E 收到授权 at
- **THEN** 补偿器归档该 locus 主会话，随后建立成功；不需要重启 Host

#### Scenario: 超时前仍阻塞
- **WHEN** t0 + 5 分钟时 E 收到授权 at
- **THEN** 按既有规则拒绝并说明正在恢复，补偿器未被调用

#### Scenario: 补偿失败继续阻塞
- **WHEN** 超时后补偿器抛错
- **THEN** 不建立新入口，诊断记录原始错误，下一次请求再次尝试补偿

### Requirement: 子会话读共识与 locus 主会话工具

子会话 SHALL 获得 caller-bound 只读工具 `locus_context`：Host 经 dsh-collab `actAs(locus 主会话).read` 读取协作空间，只返回 status 为 agreed 的 charter 与本入口登记的待办进度；没有 `ext.pet.entry` 的条目为工作空间级、对全部入口可见，带 `ext.pet.entry` 的条目只对该入口可见（话题入口另可见其所在群的条目）。MUST NOT 返回消息、其它入口的条目或成员 statusText。

子会话 SHALL 获得 caller-bound 工具 `locus_ask_parent({question})`：Host 从实际执行 caller 解析其入口与现行代，只在 caller 是该入口现行代子会话时，经官方会话投递接口把问题（附入口名与 `entry` 身份）作为下一回合输入投给其父 locus 主会话；工具 MUST NOT 接受任何目标参数，MUST NOT 新建或改变 Delivery，返回仅表示已投递。投递失败 SHALL 返回确定性原因。通用 `send_message` 与 agent 控制工具仍不可用。

locus 主会话 SHALL 获得 `locus_note`（以 `actAs` 创建带本入口 `ext.pet.entry` 的条目；入口须是该 locus 主会话名下的入口）与 `locus_reply_child`（Host 以官方 `subagents.sendMessage` 发给该 locus 主会话名下某入口的现行代子会话；不是现行代或不属于它时拒绝）。locus 主会话用普通 `collab_*` 工具写的条目一律为工作空间级。

#### Scenario: 按入口过滤
- **GIVEN** 空间中有 agreed charter X（无标记）、入口 A 的 agreed charter Y、入口 B 的待办 T、一条消息
- **WHEN** 入口 A 的子会话调用 `locus_context`
- **THEN** 返回 X 与 Y，不含 T 与消息

#### Scenario: 话题可见所在群条目
- **GIVEN** 群入口 G 有 agreed charter Z，话题入口 H 属于 G
- **WHEN** H 的子会话调用 `locus_context`
- **THEN** 结果包含 Z

#### Scenario: 子会话向父询问并在同一 current 上继续
- **GIVEN** 入口 A 的 current Delivery D 正由子会话处理
- **WHEN** 子会话调用 `locus_ask_parent`，locus 主会话收到问题后以 `locus_reply_child` 回复
- **THEN** locus 主会话恰收到一条带入口 A 身份的问题；子会话以 `agent-message` 收到回复并在后续 turn 对 D 调用 `pet_locus_finish`；D 的回复目标不变，没有新 Delivery

#### Scenario: 旧代子会话不能询问
- **WHEN** 已被换代的旧子会话调用 `locus_ask_parent`
- **THEN** 返回拒绝，locus 主会话未收到任何投递

#### Scenario: 回复非现行代子会话被拒
- **WHEN** locus 主会话以 `locus_reply_child` 回复一个已被换代的入口旧子会话
- **THEN** 返回拒绝，未调用 `subagents.sendMessage`

### Requirement: 启动恢复证据经官方冷读获取

启动恢复需要子会话日志证据时 SHALL 经 `sessionQuery.observeSession` 读取；冷读在日志末尾补出的合成 `turn/end interrupted` MUST NOT 作为"已中断"证据，只有日志中实际写入的事件才算。`sessionQuery` 不可用或读取失败时 SHALL 视为证据不足，按既有规则保持等待。

#### Scenario: 合成中断不算证据
- **GIVEN** 子会话日志最后一个 turn 未写入 `turn/end`
- **WHEN** 冷读返回的事件末尾带合成 `turn/end {interrupted}`
- **THEN** 启动恢复不把该 Delivery 结算为 `turn-interrupted`

#### Scenario: 冷读服务不可用
- **WHEN** 启动时 `sessionQuery` 未注册
- **THEN** 不结算任何需要日志证据的 Delivery，诊断记录证据不可用

### Requirement: 非驻留子会话的权限变更以待应用协议提交

所有者变更工具档位或文件权限时，若子会话常驻且空闲，Host SHALL 经 live agent 当场应用并回读，按既有规则回执。若子会话不常驻，Host SHALL：

1. 持久记录该变更为**待应用**（期望值），生效值保持不变；回执 SHALL 说明"已记录，将在子会话下次唤醒时应用并核验，生效前按原设置服务"，MUST NOT 回执为已生效。
2. 在下一次该子会话的 `agent/created`（冷恢复）中先应用期望值并回读：一致则生效值更新为期望值、清除待应用标记，并在该次投递前向所有者回执已生效；不一致则 SHALL 按原生效值完成组合并回读核验、清除待应用标记且不保留期望值，并向所有者回执失败原因；原生效值也无法核验时 SHALL 拒绝发布该子会话（"Locus 业务出站只能经受管 finish"的总则）。
3. 待应用期间 MUST NOT 以期望值服务，管理面与投递 prompt SHALL 只陈述生效值，并标注存在待应用变更。

后到的变更 SHALL 覆盖未应用的期望值。

#### Scenario: 非驻留时授予 shell 并在唤醒时生效
- **GIVEN** `tier3` 子会话 C 已被释放，档位 `safe`
- **WHEN** 所有者发送 `-t shell`，随后一条 Delivery 唤醒 C 且回读与 shell 一致
- **THEN** 第一次回执说明待应用；唤醒前管理面显示生效值 `safe`；唤醒时 C 以 shell 档服务，所有者收到已生效回执

#### Scenario: 唤醒时核验失败不留授权
- **GIVEN** 同上，但唤醒时回读与 shell 不一致
- **THEN** C 以 `safe` 档服务该 Delivery；待应用标记与期望值被清除；所有者收到失败回执；之后再次唤醒仍为 `safe`

#### Scenario: 非驻留撤回 shell 核验失败恢复原值
- **GIVEN** `tier3` 子会话 C 档位为 `shell` 且已被释放
- **WHEN** 所有者发送 `-t safe`，下一条 Delivery D 唤醒 C 时 safe 工具面回读不符，而原 shell 工具面回读一致
- **THEN** C 以 `shell` 档服务 D；期望值被清除；所有者收到撤回失败回执；C 的会话 id 与代际不变

#### Scenario: 原值也无法核验时不发布
- **GIVEN** 同上，但原 shell 工具面回读也不符
- **THEN** 拒绝发布 C 并给出确定性诊断，D 不被投递给未经核验的组合

#### Scenario: 常驻空闲时当场生效
- **WHEN** C 常驻且空闲时所有者发送 `-t shell`
- **THEN** 当场应用并回读，回执已生效，不产生待应用记录

## MODIFIED Requirements

### Requirement: Locus 业务出站只能经受管 finish

Locus child 的飞书业务正文与撤回动作 SHALL 以 caller-bound `pet_locus_finish` 的 Host 实现为唯一受管出口；普通 assistant 文本仍不得外发。该出口在各工具档位下的保证强度 SHALL 按档位区分，并 SHALL 如实陈述，MUST NOT 把较弱档位的保证表述为较强档位的保证。

**`safe` 档（默认）**：child 的已发布能力集合 MUST NOT 提供可经 Skill、shell、脚本、CLI、通用 HTTP、子委派或其它执行身份直接发送或撤回飞书消息的路径。该边界 SHALL 由工具/执行 authority 隔离强制执行，MUST NOT 仅依赖 prompt、Skill 省略、命令字符串黑名单、PATH/HOME 隐藏或 read-only 文件沙箱。若当前 pinned runtime 无法证明在保留通用进程执行时隔离飞书凭据与 Lark 网络出口，`safe` 档 SHALL 不提供 `bash`、`pwsh`、`skill`、任意代码执行和可代为执行的子委派能力，只保留受控只读工具与 caller-bound Pet 工具。

**`shell` 档（所有者显式授予，见「Locus 工具档位由所有者显式授予且不重建子会话」）**：child 可执行通用 shell，因而**不存在**执行 authority 层面的出站隔离。此时唯一出口 SHALL 由防误操作 guard 维持：Host SHALL 在该 child 作用域拒绝经 shell 调用 `lark-cli` 发送、回复、编辑、撤回飞书消息的命令，并在拒绝原因中指明改用 `pet_locus_finish`、finish 被拒时报告原因而非绕行。该 guard MUST NOT 在规范、管理面、飞书回执或 prompt 中被表述为安全边界；有意绕过（脚本、HTTP、复制的可执行文件）不在其保证范围内。

**任何档位**：child 的已发布能力集合 MUST NOT 含子委派或可让另一执行身份代为行动的工具（包括 `subagent`、`subagent_fork`、`workflow`、`ralph`、`send_message` 及 agent 控制工具）。该排除 SHALL 由持久组合本身保证，MUST NOT 依赖可在运行中撤除的收紧层。

Locus child SHALL 以 locus 主会话为父、经官方 `startContinuable` 创建，冷恢复按官方规则从父会话当前 preset 重建组合。父会话 SHALL 是 Pet 自建、挂中性白名单 preset（`locus-base`，不含任何委派行）的 locus 主会话，其 preset MUST NOT 被更改：Host SHALL 在 locus 主会话与子会话的 `agent/created` 以及每次投递前核验所挂 preset 等于 `locus-base`，不符即拒绝创建、恢复或派发。子会话的 `toolFilter` SHALL 是不含委派的宽底座，Host SHALL 在每次发布（含冷恢复）时同步安装按档位的收紧层。新建子会话 SHALL 在对应 Locus 行发布 Host 证明的 composition marker `tier3`；带其它 marker（`safe-v1`、`safe-v2`）或缺少 marker 的行属于旧模型，SHALL 按"旧模型入口按退休规则处理"退出路由，MUST NOT 被 adopt 或冷恢复。Host 无法证明所需组合（含收紧层）已安装时 SHALL 拒绝创建、恢复或派发；MUST NOT 以宽底座发布一个未安装收紧层的 `safe` 档 child。Host SHALL 对 `tools.restrict` 与 `tools.guard` 做运行时特性探测，缺失即拒绝发布。防误操作 guard 另拒绝文档入口的评论与文档正文写命令（见 `pet-locus-doc-comments`）。

#### Scenario: 受管 finish 正常发送
- **WHEN** 任一档位的 child 对其已证明的 current Delivery 调用 `pet_locus_finish(reply)`
- **THEN** Host 按 durable CAS 和固定触发消息发送一次正文并记录结果

#### Scenario: shell 旁路不可达
- **WHEN** `safe` 档 child 尝试以 `lark-cli`、绝对路径脚本、`msg.py`、Python/Node/curl 或复制后的可执行文件直接调用飞书接口
- **THEN** 已发布执行 authority 不能产生飞书业务消息，且 Delivery 状态不因尝试而改变

#### Scenario: shell 档误用 lark-cli 发送被拦截
- **WHEN** `shell` 档 child 在 finish 被拒后执行 `lark-cli im +messages-send …` 或等价的回复/撤回/编辑命令
- **THEN** 该工具调用在执行前被拒绝，拒绝原因指明使用 `pet_locus_finish` 并报告 finish 的拒绝原因；Delivery 状态不因尝试而改变

#### Scenario: shell 档读取当前群不被拦截
- **WHEN** `shell` 档 child 以 `lark-cli` 读取当前入口群的历史消息
- **THEN** guard 不拒绝该调用

#### Scenario: shell 档的出站保证如实表述
- **WHEN** 所有者在管理面或飞书回执中查看 `shell` 档说明
- **THEN** 说明写明防误操作 guard 仅防误操作、不是安全边界，MUST NOT 声称业务正文只能经 finish 产生

#### Scenario: 子委派不能洗白权限
- **WHEN** 任一档位的 child 尝试通过 subagent、workflow、Ralph 或 agent message 让另一执行身份代发
- **THEN** 已发布能力集合不含这些工具；业务正文不能由另一执行身份产生

#### Scenario: 收紧层未安装时不发布
- **WHEN** `tier3` child 被发布（新建或冷恢复），而 Host 无法同步安装或回读核验其档位对应的收紧层
- **THEN** 拒绝发布并给出确定性诊断，MUST NOT 以宽底座发布该 child

#### Scenario: 隔离能力无法证明时不发布
- **WHEN** runtime 不能核验 locus 主会话 preset 为 `locus-base`，或不能提供按档位收紧的作用域限制
- **THEN** Locus intake/child 能力保持 unavailable 并给出确定性诊断，MUST NOT 以字符串过滤或 prompt 警告宣称安全

#### Scenario: safe-v1 行继续服务
- **WHEN** 一个既有 active locus 的 child 带 `safe-v1` marker
- **THEN** 该行属于旧模型，按退休规则退出路由；入口下次被授权 at 时提示所有者建立三层结构，不冷恢复该 child

#### Scenario: 主会话 preset 不影响子会话工具面
- **WHEN** 用户的干活主会话运行一个把委派工具注册进 agent 自有层的 preset（如 `standard`）
- **THEN** 子会话的父是 locus 主会话而非干活主会话，其已发布工具面只由 `locus-base`、`toolFilter` 与档位收紧层决定，不含委派工具

#### Scenario: 冷恢复不回落到父组合
- **WHEN** Host 重启后首次向一个 `tier3` child 投递
- **THEN** 官方冷恢复从 locus 主会话的 `locus-base` 重建组合，Host 在发布前安装收紧层并核验；locus 主会话 preset 不是 `locus-base` 时拒绝派发

#### Scenario: 升级前的 legacy child 不可恢复服务
- **WHEN** 一个历史 active locus 的 durable child 没有 Host attested composition marker
- **THEN** 启动恢复或派发前将该 locus 按旧模型退出路由，MUST NOT adopt 或冷恢复该 child

### Requirement: 全部飞书工作统一为子会话常规交互

新模型 SHALL 仅对 mention 自身 bot 的消息触发工作，包括单聊；普通非 mention 内容 MUST NOT 启动推理、总结或自动更新主会话。消息 SHALL 由对应 locus 的同一个长期 child session 持续处理（子会话在该代第一条消息到达时才创建，见"子会话在首条消息到达时创建"），MUST NOT 建立飞书 root executor/Invocation 或 waiting-user 执行分支。

每个 locus SHALL 维护按接受序排列的持久 Delivery 队列，任意时刻至多向 child 投递一个 current Delivery。后续合格消息 SHALL 先进入 backlog，只有 current 进入终态后才可投递下一条未过期消息；MUST NOT 依赖 DSH `next-turn`/`next-step` 的合批顺序推断两个飞书请求或父回复的业务归属。

子会话需要决策时 SHALL 直接向当前飞书入口发问，后续 at 回答 SHALL 在同一子会话继续。歧义回答 SHALL 澄清，不自动解释为授权。模型 turn 结束 MUST NOT 被显示为整个项目完成，也 MUST NOT 单独完成 current Delivery。Host 超时推进 SHALL 继续复用同一个 child session及其历史，MUST NOT 自动重建 session 或增加 locus generation。

子会话的运行体驻留 SHALL NOT 被当作代际可用性的一部分。运行体 MAY 在子会话空闲且 inbox 为空时释放它（这是常态而非故障），因此宿主 MUST 以「按需冷恢复该 durable child」的方式取得其 live session 与策略，MUST NOT 因「当前不在内存中」判定该 child 不可用、作废代际或另建 child。宿主 MUST NOT 依赖借出子会话 Session 的兼容能力：需要 live agent 的操作（如就地改沙箱、回读）只在子会话常驻时经 `ctx.agents.get` 进行，否则延后到下一次 `agent/created`；投递经官方 `startContinuable`（首条）与 `sendMessage`（后续，官方负责冷恢复）。

#### Scenario: 普通资料发布
- **WHEN** 成员发送 PRD、Figma、会议资料但未 at bot
- **THEN** 不执行工作；将来被 at 时可按权限按需读取，不宣称已吸收资料

#### Scenario: 决策往返
- **WHEN** 子会话询问方案 A/B，用户随后 at 回复 B
- **THEN** 后续轮次在同一子会话继续，不恢复某个飞书 Invocation

#### Scenario: 多人连续提问
- **WHEN** current Delivery 处理期间又接受两条合格 at
- **THEN** 两条消息按接受序持久进入 backlog，不提前进入 child inbox；current 终结后再逐条投递且各自保持触发消息关联

#### Scenario: 父回复与下一条飞书消息不会合批
- **WHEN** current A 正在等待父会话上下文，同时飞书消息 B 已被接受
- **THEN** B 留在 Pet backlog，父回复只继续同一 child 对 A 的处理；A 终结前 Host 不把 B 投递到 DSH inbox

#### Scenario: 超时不重建会话
- **WHEN** current Delivery 达到 Host deadline 而未完成
- **THEN** Host 终结该 Delivery、尽力中止其当前运行并在同一 child session 上推进下一条，保留该 locus 已积累的 session 历史

### Requirement: 上下文按实际子会话绑定并允许按需问主会话

新建及显式重建的子会话 SHALL 使用独立上下文，不复制主会话已完成前缀、进行中轮次或默认父摘要；初始化 SHALL 只包含自身身份、所服务入口、可信工作归属、权限、已确认锚点和按需询问说明。子会话 SHALL 被明确描述为当前入口的服务者，而非主会话本人。其自身交互 SHALL 持续保存，冷恢复 SHALL 恢复同一 child 历史，不重新播种父上下文。独立历史 MUST NOT 被解释为创建新的工作目录、丢失工具组合或静默更换模型。

系统 SHALL 在创建前核验所用 provider 确实不继承父上下文；无法证明时 SHALL 拒绝创建并如实报告，MUST NOT 静默退回复制父历史的 provider，也 MUST NOT 把拒绝表述为已建立独立 child。已有 fork child 不受本条影响：它们不会被本 change 的创建路径重新创建，其历史 MUST NOT 被裁剪或静默改造。

初始化任务书 SHALL 告知子会话在工作根、约束或相关事实不足时，可通过宿主原生消息能力询问 caller-bound 父会话即 locus 主会话，MUST NOT 允许指定其它 parent 或 locus。locus 主会话不知道干活现场的事实时 SHALL 经 dsh-collab 向干活主会话提问，再以 `locus_reply_child` 回复子会话。父会话回复只是对话事实，SHALL NOT 因此成为持久授权；锚点仍须由所有者在管理面显式确认后写入。答复只提供上下文事实；路径存在性不等于写授权。

父子或 agent 间的 `agent-message` SHALL 只作为子会话上下文通信，不参与 Delivery 路由选择：它 MUST NOT 建立、修改、替换或撤销 current Delivery 已由 Host 绑定的回复目标。current Delivery 存续时，原始飞书投递 turn 结束后的 `agent-message` SHALL 可唤醒同一 child 继续处理该 current；没有唯一 current 时，`agent-message` MUST NOT 自行产生飞书 finish/wait 能力。GUI/user steer、来源不明的参与者消息与第二个已投递 Delivery仍 SHALL fail closed。

caller-bound `pet_context` SHALL 提供当前 locus、局部项目入口、已确认局部锚点、权限与 Host 确认的 current Delivery 状态，不允许模型指定其它目标。后续投递只带必要请求事实和查询引导，MUST NOT 每次重复全部说明。未知锚点 SHALL 如实报告。系统 MUST NOT 自动汇总或把子会话结论回传干活主会话；官方结算通知送达 locus 主会话是明确例外，且收到通知不等于结论已被采纳为 agreed charter 或已被干活主会话知晓；对实际询问的定向答复不属于自动结算回报。所有者可主动查阅，项目资料 SHALL 按需读取，不自动共享兄弟子会话历史。

干活主会话 SHALL 被表述为工作归属，locus 主会话为可询问的上下文来源，MUST NOT 因其父节点身份宣称已统合所有协作现场的最新认知。用户显式发起的查阅与汇总不属于自动回传；系统 SHALL 区分可发现、可读取与已采纳，缺少历史读取能力或权限时如实说明。当前模型 MUST NOT 宣称已提供 project 级自动知识同步或多人分布式协同。旧 QA/chat 绑定仍遵守前置版本的退役隔离，不因本兼容规则恢复服务。

#### Scenario: 长父历史不能冒充子身份
- **WHEN** 活跃主会话已有大量 GUI 验收对话并创建新 Q&A child
- **THEN** 新 child 不含这些对话或默认摘要，首轮只以自己的入口身份处理请求，不延续父会话验收任务

#### Scenario: 业务完成只经统一工具提交
- **WHEN** 独立 child 完成一条 current Delivery 的处理
- **THEN** 它只调用 caller-bound `pet_locus_finish`，以 `reply` 提交正文或以 `no-reply` 提交原因；普通 assistant 文本和 turn 正常结束均不完成 Delivery

#### Scenario: 无法证明独立能力时拒绝创建
- **WHEN** 当前 runtime 无法证明所用 provider 不继承父上下文
- **THEN** 创建失败并报告能力不可用，不退回复制父历史的 provider，不把失败表述为已建立独立 child

#### Scenario: 历史不含最新目录
- **WHEN** 子会话自己的上下文及已确认锚点无法确定当前执行根
- **THEN** 可按需询问主会话或请求所有者确认，不猜 cwd，不擅自创建另一个工作目录

#### Scenario: 主会话无法回答
- **WHEN** 补问信息无法取得
- **THEN** 报告未确认，不把请求接受当作已收到答复，不放宽权限

#### Scenario: 跨 turn 父回复继续 current Delivery
- **WHEN** child 在处理唯一 current Delivery 时经原生消息询问父会话，原始飞书 turn 随后结束，父回复再以 `agent-message` 唤醒后续 turn
- **THEN** 该消息只补充 child 上下文，current Delivery 仍保持同一 Host 绑定目标，child 可在后续 turn 调用 `pet_locus_finish`

#### Scenario: 单独的 agent 消息不能获得飞书能力
- **WHEN** child 当前没有唯一 current Delivery 而只收到一条 `agent-message`
- **THEN** 该上下文消息不建立飞书回复目标，`pet_locus_finish` 与 `pet_locus_wait` 均拒绝修改或发送

#### Scenario: GUI 流量仍不能消费 current
- **WHEN** current Delivery 存续期间，同一 child 收到 GUI/user 输入或来源不明的参与者消息
- **THEN** 该执行不能调用 finish/wait 消费 current，系统不得借 current 目标发送混合任务正文

#### Scenario: 新话题上下文
- **WHEN** 群子会话已积累讨论而新话题子会话建立
- **THEN** 新 child 固定主会话归属及项目入口，但不复制主会话或群子会话历史，需要相关事实时定向询问

#### Scenario: 子会话发现不自动成为主会话认知
- **WHEN** QA 子会话产生新发现，而用户未发起主会话查阅或采纳，也没有关联询问
- **THEN** 系统不自动更新干活主会话，不将该发现呈现为干活主会话已知的项目决策；locus 主会话可能收到官方结算通知，但这不构成采纳

#### Scenario: 用户主动查阅受实际能力约束
- **WHEN** 用户要求查阅一个可通过索引发现、但当前无权读取或缺少宿主读取能力的子会话历史
- **THEN** 如实说明限制，不把找到 locus 表述为已读取或已汇总内容

#### Scenario: 冷恢复保留独立历史
- **WHEN** 独立 child 已有自己的多轮对话，Host 重启后恢复
- **THEN** 恢复同一 child 的历史，不插入恢复时的父历史，不更换身份

#### Scenario: 旧 fork child 不受影响
- **WHEN** 存在本变更前继承父前缀的旧 child
- **THEN** 其历史保留不被裁剪或改造；它所在的旧模型入口按退休规则退出路由，不再服务

### Requirement: Locus 工具档位由所有者显式授予且不重建子会话

每个 locus SHALL 具有一个工具档位，取值 `safe` 或 `shell`，与文件权限档（`read`/`write`）正交。所有新建、替换与重建的 locus SHALL 默认 `safe`；新代际与显式重建 MUST NOT 继承上一代的 `shell`。

`safe` 档 SHALL 不含 `bash`/`skill`，其继承工具面等于 `LOCUS_SAFE_TOOL_NAMES`，另加 caller-bound Pet 工具。`shell` 档 SHALL 在 `safe` 档之上开放通用 shell 与 Skill 加载；MUST NOT 开放任何子委派或代为行动的工具（见「Locus 业务出站只能经受管 finish」）。

档位 SHALL 仅由 allowlist 经飞书控制命令（`-t/--tools safe|shell`）或管理面改变；非 allowlist 发送者的档位命令 SHALL 按既有控制命令规则拒绝。档位命令 SHALL 只在接受命令时该入口空闲（无 current Delivery 且子会话未在运行）时受理，忙时 SHALL 确定性拒绝。变更 SHALL 在同一子会话上完成，MUST NOT 重建子会话、增加代际或丢弃子会话历史。子会话常驻时 SHALL 当场应用并回读实际可见工具面：与目标档位不符时 SHALL 回到 `safe` 并拒绝，MUST NOT 回执成功。子会话不常驻时 SHALL 适用"非驻留子会话的权限变更以待应用协议提交"：延迟提交在下一次冷恢复的首个业务工具执行前完成，不因用于唤醒的 Delivery 已成为 current 而拒绝；核验失败恢复原生效值；原值也无法核验时按"Locus 业务出站只能经受管 finish"的总则拒绝发布。变更 SHALL 记录操作者、时间、期望值与生效值。

只有带 `tier3` marker 的 locus 可以服务与切换档位；其它 marker 的行属于旧模型，按"旧模型入口按退休规则处理"退出路由。

`shell` 档生效期间，该入口 SHALL 只接受 allowlist 成员的 at 作为工作请求；非 allowlist 成员的 at SHALL 得到确定性拒绝回执，说明该入口当前为所有者专用。已在 backlog 中、由非 allowlist 成员触发的 Delivery SHALL 在派发前以同一原因结算，MUST NOT 投递给 `shell` 档子会话。切回 `safe` 后 SHALL 恢复既有的群成员提问规则。

子会话每次投递的 prompt SHALL 按当前档位说明可用能力。`shell` 档 SHALL 说明：该档允许以 bot 身份读取当前入口（档位权限），实际可读性以本次实测声明为准；MUST NOT 读取无关群、私聊、全局消息或其它 workspace；业务回复仍经 `pet_locus_finish`。该说明是行为约束而非授权边界。

管理面与飞书回执 SHALL 如实说明 `shell` 档的后果：子会话可在所有者本机执行命令（写入受文件权限档约束，读取与网络不受限），可使用所有者本机的飞书凭据，入口的 allowlist 成员共享该能力，且出站约束仅为防误操作。

#### Scenario: 授予 shell 档
- **WHEN** allowlist 在一个子会话常驻且空闲的 `tier3` locus 发送 `-t shell`
- **THEN** 同一子会话的可见工具面增加 shell 档工具且不含任何委派工具，核验通过后回执并记录授权；子会话 id、代际与历史不变

#### Scenario: 撤回 shell 档
- **WHEN** allowlist 在子会话常驻且空闲的 `shell` 档 locus 发送 `-t safe`
- **THEN** 同一子会话的可见工具面恢复为 safe composition，核验通过后回执并记录

#### Scenario: 忙时拒绝
- **WHEN** 入口存在 current Delivery 或子会话正在运行时收到档位命令
- **THEN** 确定性拒绝并说明需等待空闲，不改变档位

#### Scenario: 核验失败回到 safe
- **WHEN** 子会话常驻时，档位应用后回读的工具面与目标不符
- **THEN** 回到 `safe` 并拒绝，回执给出确定性原因，不回执成功

#### Scenario: safe-v1 入口请求 shell
- **WHEN** allowlist 对一个仅带 `safe-v1` marker 的旧模型入口发送 `-t shell`
- **THEN** 不切换档位、不恢复旧子会话；回执说明旧关联已退休，下一条授权 at 将建立三层结构

#### Scenario: shell 档拒绝普通成员
- **WHEN** `shell` 档入口收到非 allowlist 群成员的 at
- **THEN** 不创建 Delivery 工作，回执说明该入口当前为所有者专用

#### Scenario: 切换前排队的普通成员请求
- **WHEN** 入口在 backlog 中有非 allowlist 成员的 Delivery 时切到 `shell`
- **THEN** 这些 Delivery 在派发前以「入口当前为所有者专用」结算，不投递给子会话

#### Scenario: 冷恢复保持档位
- **WHEN** `shell` 档 `tier3` 子会话被释放后冷恢复
- **THEN** 发布时按持久档位安装收紧层，恢复后的可见工具面与恢复前一致

#### Scenario: 重建不继承 shell
- **WHEN** 一个 `shell` 档入口被显式重建或切换来源产生新代际
- **THEN** 新代际为 `safe` 档

#### Scenario: 非 allowlist 档位命令
- **WHEN** 非 allowlist 群成员发送 `-t shell`
- **THEN** 按控制命令规则拒绝，档位不变

## REMOVED Requirements

### Requirement: Locus 统一关联主会话子会话与飞书入口
**Reason**: 三层结构改写了入口、主会话与子会话的实体关系，由本 change 新增的三层实体、入口建立、换绑与归档要求取代。
**Migration**: 旧模型 locus 行不改写，按"旧模型入口按退休规则处理"退出路由；所有者对入口 `/bind` 或等首个授权 at 建立三层结构。

### Requirement: 自动主会话按群建立且只使用 default workspace
**Reason**: 三层结构改写了入口、主会话与子会话的实体关系，由本 change 新增的三层实体、入口建立、换绑与归档要求取代。
**Migration**: 旧模型 locus 行不改写，按"旧模型入口按退休规则处理"退出路由；所有者对入口 `/bind` 或等首个授权 at 建立三层结构。

### Requirement: 自动主会话创建即具备可辨识身份且不可被当作新会话占用
**Reason**: 三层结构改写了入口、主会话与子会话的实体关系，由本 change 新增的三层实体、入口建立、换绑与归档要求取代。
**Migration**: 旧模型 locus 行不改写，按"旧模型入口按退休规则处理"退出路由；所有者对入口 `/bind` 或等首个授权 at 建立三层结构。

### Requirement: 群与话题按层级补齐且继承在创建时固定
**Reason**: 三层结构改写了入口、主会话与子会话的实体关系，由本 change 新增的三层实体、入口建立、换绑与归档要求取代。
**Migration**: 旧模型 locus 行不改写，按"旧模型入口按退休规则处理"退出路由；所有者对入口 `/bind` 或等首个授权 at 建立三层结构。

### Requirement: Q&A 是默认入口的创建或打开
**Reason**: 三层结构改写了入口、主会话与子会话的实体关系，由本 change 新增的三层实体、入口建立、换绑与归档要求取代。
**Migration**: 旧模型 locus 行不改写，按"旧模型入口按退休规则处理"退出路由；所有者对入口 `/bind` 或等首个授权 at 建立三层结构。

### Requirement: 显式绑定可替换自动关联并警告上下文改变
**Reason**: 三层结构改写了入口、主会话与子会话的实体关系，由本 change 新增的三层实体、入口建立、换绑与归档要求取代。
**Migration**: 旧模型 locus 行不改写，按"旧模型入口按退休规则处理"退出路由；所有者对入口 `/bind` 或等首个授权 at 建立三层结构。

### Requirement: 关联具备双向发现且不过度披露
**Reason**: 代理成员 `pet` 与子会话的 `collab_*` 工具退役，由 `pet-locus-intent-triage` 的"协作空间由干活主会话与 locus 主会话两个普通成员组成"与本 spec 的"子会话读共识与 locus 主会话工具"取代。
**Migration**: 旧模型 locus 行不改写，按"旧模型入口按退休规则处理"退出路由；所有者对入口 `/bind` 或等首个授权 at 建立三层结构。

### Requirement: 生命周期退出保留历史且旧关联不兼容
**Reason**: 三层结构改写了入口、主会话与子会话的实体关系，由本 change 新增的三层实体、入口建立、换绑与归档要求取代。
**Migration**: 旧模型 locus 行不改写，按"旧模型入口按退休规则处理"退出路由；所有者对入口 `/bind` 或等首个授权 at 建立三层结构。

### Requirement: 代理协作消息以通知意图登记
**Reason**: 不再有代理成员。
**Migration**: 旧模型 locus 行不改写，按"旧模型入口按退休规则处理"退出路由；所有者对入口 `/bind` 或等首个授权 at 建立三层结构。
