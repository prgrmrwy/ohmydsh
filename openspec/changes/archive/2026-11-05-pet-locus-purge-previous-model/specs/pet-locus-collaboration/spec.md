## MODIFIED Requirements

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
- **GIVEN** 存在继承父前缀的旧 child，指向它的旧模型 locus 行已被离线迁移清除
- **WHEN** Host 启动并处理任意入口的消息
- **THEN** 该 child 的会话历史不被裁剪或改造；没有任何 locus 行引用它，Pet 不向它投递、不 adopt 也不冷恢复它

### Requirement: Locus 业务出站只能经受管 finish

Locus child 的飞书业务正文与撤回动作 SHALL 以 caller-bound `pet_locus_finish` 的 Host 实现为唯一受管出口；普通 assistant 文本仍不得外发。该出口在各工具档位下的保证强度 SHALL 按档位区分，并 SHALL 如实陈述，MUST NOT 把较弱档位的保证表述为较强档位的保证。

**`safe` 档（默认）**：child 的已发布能力集合 MUST NOT 提供可经 Skill、shell、脚本、CLI、通用 HTTP、子委派或其它执行身份直接发送或撤回飞书消息的路径。该边界 SHALL 由工具/执行 authority 隔离强制执行，MUST NOT 仅依赖 prompt、Skill 省略、命令字符串黑名单、PATH/HOME 隐藏或 read-only 文件沙箱。若当前 pinned runtime 无法证明在保留通用进程执行时隔离飞书凭据与 Lark 网络出口，`safe` 档 SHALL 不提供 `bash`、`pwsh`、`skill`、任意代码执行和可代为执行的子委派能力，只保留受控只读工具与 caller-bound Pet 工具。

**`shell` 档（所有者显式授予，见「Locus 工具档位由所有者显式授予且不重建子会话」）**：child 可执行通用 shell，因而**不存在**执行 authority 层面的出站隔离。此时唯一出口 SHALL 由防误操作 guard 维持：Host SHALL 在该 child 作用域拒绝经 shell 调用 `lark-cli` 发送、回复、编辑、撤回飞书消息的命令，并在拒绝原因中指明改用 `pet_locus_finish`、finish 被拒时报告原因而非绕行。该 guard MUST NOT 在规范、管理面、飞书回执或 prompt 中被表述为安全边界；有意绕过（脚本、HTTP、复制的可执行文件）不在其保证范围内。

**任何档位**：child 的已发布能力集合 MUST NOT 含子委派或可让另一执行身份代为行动的工具（包括 `subagent`、`subagent_fork`、`workflow`、`ralph`、`send_message` 及 agent 控制工具）。该排除 SHALL 由持久组合本身保证，MUST NOT 依赖可在运行中撤除的收紧层。

Locus child SHALL 以 locus 主会话为父、经官方 `startActivation` 创建。父会话 SHALL 是 Pet 自建、挂中性白名单 preset（`locus-base`，不含任何委派行）的 locus 主会话，其 preset MUST NOT 被更改；子会话 SHALL 以独立选择的 `locus-child` preset 启动（`locus-base` 去掉写文件工具），该选择随子会话持久化并在每次冷恢复时重新挂载，不从父会话继承。Host SHALL 在 `agent/created` 以及每次投递前核验 locus 主会话的 preset 为 `locus-base`、子会话的 preset 为 `locus-child`，不符即拒绝创建、恢复或派发。runtime 不再携带每次请求的 `toolFilter`；Host SHALL 在每次发布（含冷恢复）时，于子会话自有作用域以 `tools.restrict` 安装不含委派的工具上限与按档位的收紧层。新建子会话 SHALL 在对应 Locus 行发布 Host 证明的 composition marker `tier3`；持久层只承载 `tier3` marker（从未创建 child 的行没有 marker），见"持久层只承载三层模型的 locus 行"；MUST NOT adopt 或冷恢复任何没有 `tier3` marker 的 child。Host 无法证明所需组合（含收紧层）已安装时 SHALL 拒绝创建、恢复或派发；MUST NOT 以宽底座发布一个未安装收紧层的 `safe` 档 child。Host SHALL 对 `tools.restrict` 与 `tools.guard` 做运行时特性探测，缺失即拒绝发布。防误操作 guard 另拒绝文档入口的评论与文档正文写命令（见 `pet-locus-doc-comments`）。

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
- **GIVEN** 持久层中一条 locus 行的 `childComposition` 为 `safe-v1` 或 `safe-v2`
- **WHEN** Pet 打开持久层
- **THEN** 打开失败，Pet 保持未就绪，诊断包含该行的 key；没有任何入口被路由或投递

#### Scenario: 主会话 preset 不影响子会话工具面
- **WHEN** 用户的干活主会话运行一个把委派工具注册进 agent 自有层的 preset（如 `standard`）
- **THEN** 子会话的父是 locus 主会话而非干活主会话，其已发布工具面只由 `locus-child` preset、Host 安装的作用域上限与档位收紧层决定，不含委派工具

#### Scenario: 冷恢复不回落到父组合
- **WHEN** Host 重启后首次向一个 `tier3` child 投递
- **THEN** 冷恢复重新挂载子会话持久化的 `locus-child` preset，Host 在发布前安装作用域上限与收紧层并核验；子会话 preset 不是 `locus-child` 或 locus 主会话 preset 不是 `locus-base` 时拒绝派发

#### Scenario: 升级前的 legacy child 不可恢复服务
- **GIVEN** 持久层中一条 `active` locus 行没有 `childComposition`
- **WHEN** Pet 打开持久层
- **THEN** 打开失败，Pet 保持未就绪并给出确定性诊断；该行的 child 不被 adopt 或冷恢复

### Requirement: Locus 工具档位由所有者显式授予且不重建子会话

每个 locus SHALL 具有一个工具档位，取值 `safe` 或 `shell`，与文件权限档（`read`/`write`）正交。所有新建、替换与重建的 locus SHALL 默认 `safe`；新代际与显式重建 MUST NOT 继承上一代的 `shell`。

`safe` 档 SHALL 不含 `bash`/`skill`，其继承工具面等于 `LOCUS_SAFE_TOOL_NAMES`，另加 caller-bound Pet 工具。`shell` 档 SHALL 在 `safe` 档之上开放通用 shell 与 Skill 加载；MUST NOT 开放任何子委派或代为行动的工具（见「Locus 业务出站只能经受管 finish」）。

档位 SHALL 仅由 allowlist 经飞书控制命令（`-t/--tools safe|shell`）或管理面改变；非 allowlist 发送者的档位命令 SHALL 按既有控制命令规则拒绝。档位命令 SHALL 只在接受命令时该入口空闲（无 current Delivery 且子会话未在运行）时受理，忙时 SHALL 确定性拒绝。变更 SHALL 在同一子会话上完成，MUST NOT 重建子会话、增加代际或丢弃子会话历史。子会话常驻时 SHALL 当场应用并回读实际可见工具面：与目标档位不符时 SHALL 回到 `safe` 并拒绝，MUST NOT 回执成功。子会话不常驻时 SHALL 适用"非驻留子会话的权限变更以待应用协议提交"：延迟提交在下一次冷恢复的首个业务工具执行前完成，不因用于唤醒的 Delivery 已成为 current 而拒绝；核验失败恢复原生效值；原值也无法核验时按"Locus 业务出站只能经受管 finish"的总则拒绝发布。变更 SHALL 记录操作者、时间、期望值与生效值。

只有带 `tier3` marker 的 locus 可以服务与切换档位。持久层只接受 `tier3` 标记（从未创建 child 的行没有标记）；其它标记的行由"旧模型 locus 数据经离线迁移清除"处理，不会出现在可加载的持久层中。

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
- **GIVEN** 某群曾是 `safe-v1` 旧模型入口，其 locus 行已被离线迁移清除，此后没有新的授权 at
- **WHEN** allowlist 在该群发送 `-t shell`
- **THEN** 该入口没有 locus，命令按"当前入口不存在或已失效"拒绝；不建立任何结构，不切换档位

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


### Requirement: 投递与结算关联独立于会话运行状态

每条接受消息 SHALL 有持久 Delivery，至少标识以下各项：入口、locus 代际、child session、触发 `messageId`、接受顺序、`acceptedAt`、deadline、队列/终态与出站结果。

IM Delivery 的 `messageId` 是飞书消息标识。文档 Delivery 的 `messageId` 是 `doc:docx:<token>/<comment_id>/<reply_id>`，它同时是持久去重键，MUST NOT 被当作 IM 消息标识使用。

普通消息标识与评论回复标识 MUST NOT 成为长期 locus 身份，但业务回复 MUST 使用 current Delivery 不可变的触发目标：
- IM 群级与话题级回复都 MUST 以触发 `messageId` 做飞书按消息回复；话题回复还 MUST 留在 Host 从入站事件确认的原话题。
- 评论级（划词评论）回复 MUST 追加在触发 `comment_id` 所在的评论下，且该 `comment_id` MUST 与入口 `threadId` 相同。
- 文档级（全文评论）入口的回复 SHALL 以 bot 身份在同一文档新建一条全文评论，开头以结构化提及 @ 持久 Delivery 的发送者（飞书不允许回复全文评论，详见 `pet-locus-doc-comments`）。
- 两者的触发 token 都 MUST 与入口 `chatId` 中的 token 相同。任一不一致，或文档级入口的发送者不是可证明的 open id 时，SHALL 以 `association-unproven` fail closed，不发送。

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
- **GIVEN** 评论级 locus `(doc:docx:D, c2)`，current Delivery 的 `messageId` 为 `doc:docx:D/c2/r4`
- **WHEN** child 以 `reply` 调用 `pet_locus_finish`
- **THEN** Host 以 bot 身份对文档 `D` 的评论 `c2` 追加一条回复，不新开评论、不发往任何群，Delivery 记录 `completed/replied`；文档级入口的答复方式（新全文评论并提及提问者）见 `pet-locus-doc-comments`

#### Scenario: 文档回复目标与入口不符
- **GIVEN** 评论级 locus 入口为 `(doc:docx:D, c2)`，持久 Delivery 的 `messageId` 为 `doc:docx:D/c3/r1` 或 `doc:docx:D2/c2/r1`
- **WHEN** child 以 `reply` 调用 `pet_locus_finish`
- **THEN** Host 不发送，Delivery 不进入 `finishing`，拒绝类别为 `association-unproven`

#### Scenario: 升级需离线迁移并先备份
- **GIVEN** 版本戳为 15 的状态库，DSH 已停止
- **WHEN** 执行 `dsh-pet-migrate-state --yes`
- **THEN** 同目录生成 `state.sqlite.v15.bak-<ms>`，用它打开得到的全部行与迁移前相同（它是独占锁内 checkpoint 之后的完整快照）；版本戳变为当前域版本 19；v15 库没有 `locus_mains`，因此原有 locus 行全部属于旧模型并被清除，按"旧模型 locus 数据经离线迁移清除"处理；随后当前 Host 能打开存储，原 IM 入口在下一条授权 at 时按 auto 规则建立三层结构

#### Scenario: 未迁移时当前版本拒绝打开
- **GIVEN** 版本戳为 15 的状态库，且未执行迁移
- **WHEN** 以当前版本（≥16）包启动 Host
- **THEN** 存储以 `version-mismatch` 拒绝打开，诊断给出可直接复制的离线迁移命令

#### Scenario: v15 拒绝打开新版本库
- **GIVEN** 版本戳 ≥16、含有文档 locus 的状态库
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

## REMOVED Requirements

### Requirement: 旧模型入口按退休规则处理

**Reason**: 旧模型 locus 行（父会话没有 `locus_mains` 配对、组合标记不是 `tier3`）不再以"读取时退休"的方式长期留在持久层，改为由离线迁移一次性清除；运行期不再存在"旧模型入口"这一类状态，相应的退休分支一并删除。

**Migration**: 部署前停止 DSH，运行 `dsh-pet-migrate-state --dry-run` 查看将被清除的旧模型数据，再以 `--yes` 执行（见"旧模型 locus 数据经离线迁移清除"）。清除后，原旧模型入口按"没有 locus 行"处理：下一条授权 at 按 auto 规则建立三层结构，非授权 at 不引发建立；所有者此前停止的旧模型入口不保留停止标记。例外：同一入口若还有更早一代的 `chat_bindings` 退休标记，仍按该标记的既有规则要求所有者显式重建，本变更不改变这条路径。

## ADDED Requirements

### Requirement: 旧模型 locus 数据经离线迁移清除

持久层版本 SHALL 升为 19。离线迁移脚本 SHALL 在 DSH 停止时运行，把版本 2..18 的数据库迁移到 19。旧模型 locus 行指：父会话（`parentSessionId`）在 `locus_mains` 中没有记录的 locus 行；记这些行的 id 集合为 L。

- `--dry-run` SHALL 只读：报告当前版本、目标版本，列出 L 中每一行的 id 与入口，并按表报告将被删除的行数，MUST NOT 写入任何文件。
- 以下任一条件成立时，脚本 SHALL 拒绝迁移（`--dry-run` 也报告为拒绝），以非零码退出并列出违规行。拒绝的写入保证分两种：预检阶段（含 `--dry-run` 与未确认运行）的拒绝不产生任何物理写入；`--yes` 锁内复查的拒绝保证不做 checkpoint、不写备份、不改变任何行与版本号，但取得独占锁、打开连接等 SQLite 自身的物理副作用不在此保证之内：
  - 全库存在状态不在终态集合内的投递；终态集合 SHALL 与 Host 的 `TERMINAL_STATUSES` 相同；
  - 全库存在 phase 不是 `committed` 或 `compensated` 的 locus 操作；
  - 删除 L 之后保留的 locus 集合不满足 v19 加载条件：每条行的父会话在 `locus_mains` 中有记录；`childComposition` 若存在为 `tier3`；`active` 行带 marker；并且整个集合通过 Host 现有的全部集合不变量（包括带 `parentLocusId` 的行其父行被保留、同一入口剩余代际相邻连续、入口与子会话唯一）。脚本 SHALL 与 Host 使用同一份集合校验规则，MUST NOT 另写一份子集。
- 拒绝时 SHALL 说明处理方式：在途工作等其结束；无法自行结束的恢复债（`needs-recovery` 或 `failed` 的操作、停在非终态的投递）须先用当前版本 Host 清理或由所有者人工处理，再运行迁移。
- `--dry-run`、未确认运行与预检拒绝 SHALL 只做只读查询，MUST NOT 做 WAL checkpoint 或产生任何物理写入。`--yes` SHALL 先取得独占锁并持有到事务提交；在锁内重新读取版本戳、表结构与数据并重新执行全部拒绝判定（锁内发现已是 19 时报告无需迁移，发现不支持的版本时拒绝）；锁内拒绝时 SHALL 不做 checkpoint、不写备份、不改变任何行或版本号。锁内判定通过后 SHALL 依次：做 WAL checkpoint；写数据库备份（它是 checkpoint 之后的完整快照）；再在单个事务内完成：版本 ≤17 时补建 `locus_mains` 表；删除 L 中的 locus 行；删除 `locusId ∈ L` 的投递、切换通知与权限审计（按记录中的 `locusId` 字段精确匹配）；删除 `locusId`、`oldLocusId` 或 `newLocusId` ∈ L 的操作；把版本号改为 19。事务失败 SHALL 回滚，版本号与全部行不变，备份保留。
- 脚本 SHALL 按相对自身文件位置的路径导入包内 `lib/` 中 Host 的校验代码，经 `node_modules/.bin` 符号链接、在仓库以外的工作目录调用时同样可用；这些代码的运行时依赖 SHALL 声明为包的运行时依赖。
- 脚本 MUST NOT 修改 `locus_indexes`。Host SHALL 在打开 locus 持久层后、注册任何会读取索引的回调（agent 创建、工具、飞书接收）之前，按剩余 locus 行重新推导并写回索引；指向已删除行的默认 Q&A 指针在推导时被丢弃。启动对账沿用同一推导。
- 脚本 MUST NOT 修改 locus 以外的表：待办台账、询问、`chat_bindings`、`invocation_channel` 等保持逐字节不变。
- 未给出 `--dry-run` 或 `--yes` 时 SHALL 不写入任何东西并说明需要确认；数据库被占用（DSH 未停止）时 SHALL 给出可操作的提示并失败；已是 19 时 SHALL 报告无需迁移并退出 0。

#### Scenario: dry-run 列出将删除的行且不写入
- **GIVEN** 一个 v18 数据库，含 3 条旧模型 locus 行、引用它们的 4 条终态投递，以及 2 条三层 locus 行
- **WHEN** 以 `--dry-run` 运行脚本
- **THEN** 输出包含这 3 条旧模型行的 id，以及 locus 3、投递 4 的计数；数据库文件与 WAL 文件字节不变，没有生成备份文件

#### Scenario: 确认后清除旧模型数据
- **GIVEN** 同上的 v18 数据库，DSH 已停止
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 版本为 19；3 条旧模型 locus 行及引用它们的投递、审计、操作都不存在；2 条三层 locus 行逐字节不变；`locus_indexes` 逐字节不变；备份文件存在，且用它打开得到的全部行与迁移前相同

#### Scenario: 迁移后的库能打开并完成启动对账
- **GIVEN** 一个旧模型行与三层行共享入口、且存在指向旧模型行的默认 Q&A 指针的 v18 数据库，已以 `--yes` 迁移
- **WHEN** 用 Pet 持久层打开该库并运行启动对账
- **THEN** 打开与对账都成功；对账后的 `endpoint-current`、`parent-loci`、`child-locus`、`default-qa` 索引与按剩余行推导的结果相同，不含任何已删除行的 id

#### Scenario: 删除历史前代后保留行仍可服务与重建
- **GIVEN** 入口 E 的第 1 代是旧模型行、第 2 代是 `invalid` 的三层行，第 3 代是 `not-created` 的三层行；已以 `--yes` 迁移
- **WHEN** 打开持久层，对 E 发布第 4 代
- **THEN** 打开成功；第 2、3 代保留且 `replacesLocusId` 原样保留（可能指向已删除行）；第 4 代发布成功

#### Scenario: 删除中间代际造成断档时拒绝
- **GIVEN** 入口 E 的第 1 代是 `invalid` 的三层行、第 2 代是旧模型行、第 3 代是 `not-created` 的三层行
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 脚本以非零码退出并指出入口 E 的代际断档；数据库不变

#### Scenario: 未创建 child 的历史行可以没有 marker
- **GIVEN** 有配对的三层行中，一条在首条消息前被所有者停止（`stopped`，无 marker），一条在未创建 child 时因 locus 主会话迁移变为 `invalid`（无 marker）
- **WHEN** 以 `--yes` 运行脚本后用 Pet 打开
- **THEN** 迁移成功，两条行逐字节保留，Pet 打开成功

#### Scenario: 启动早期的冷恢复不读到悬空索引
- **GIVEN** 一个已迁移的库，某入口迁移前的 `endpoint-current` 索引指向一条已删除的旧模型行，另有一个保留的三层子会话带待应用权限
- **WHEN** Host 启动，在启动对账完成之前该子会话被冷恢复
- **THEN** 待应用权限按剩余 locus 行解析；不出现指向已删除行的结果，也不留下部分应用的状态

#### Scenario: 非 locus 表不受影响且仍可读取
- **GIVEN** 待办台账、询问、`chat_bindings` 中有引用旧模型 locus 的行
- **WHEN** 以 `--yes` 运行脚本后打开 Pet，并读取所有者待办列表与已退休询问列表
- **THEN** 这些表的全部行逐字节不变；两个列表的读取都成功，返回的条目与迁移前相同

#### Scenario: 切换通知按 locusId 精确删除
- **GIVEN** L 中有 id 为 `locus-a` 的行，另有保留的三层行 `locus-a2`，二者各有一条切换通知
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 只有 `locus-a` 的通知被删除，`locus-a2` 的通知逐字节不变

#### Scenario: 预检通过后出现非终态投递时锁内拒绝
- **GIVEN** 预检通过后、取得独占锁之前，另一个写入者向库中写入一条 `queued` 投递（含 WAL 中尚未 checkpoint 的写入）
- **WHEN** `--yes` 取得锁并在锁内复查
- **THEN** 脚本以非零码退出并指出该投递；没有做 checkpoint、没有备份文件，全部行与版本号不变

#### Scenario: 预检后版本已变化
- **GIVEN** 预检时版本为 18，取得锁之前该库已被迁移到 19
- **WHEN** `--yes` 在锁内复读版本戳
- **THEN** 报告已是目标版本并以 0 退出，不写入任何东西

#### Scenario: 已安装的命令在仓库外可用
- **GIVEN** 按生产方式安装的 dsh-pet 包（依赖不提升到上层目录），当前目录不在仓库内
- **WHEN** 经 `node_modules/.bin/dsh-pet-migrate-state --dry-run --db <测试库>` 调用
- **THEN** 脚本成功加载包内校验代码并输出报告，没有模块解析错误

#### Scenario: 存在非终态投递时拒绝
- **GIVEN** 库中任意一条投递处于 `queued`
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 脚本以非零码退出并指出该投递及处理方式；版本号与全部行不变，没有写入备份

#### Scenario: 存在未完成的操作时拒绝
- **GIVEN** 库中一条 locus 操作处于 `provisioning`，且没有任何 locus id 字段
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 脚本以非零码退出并指出该操作；数据库不变

#### Scenario: 保留行不满足 v19 条件时拒绝
- **GIVEN** 一条有配对但 `childComposition` 为 `safe-v2` 的 locus 行；或一条有配对、`active` 但没有 marker 的行；或一条保留的话题行，其 `parentLocusId` 指向 L 中的行
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 脚本以非零码退出并指出违规行；数据库不变

#### Scenario: 未确认时不写入
- **WHEN** 不带 `--dry-run` 和 `--yes` 运行脚本
- **THEN** 脚本以非零退出码结束，数据库不变，没有备份文件

#### Scenario: 已是目标版本时无操作
- **GIVEN** 已迁移到 19 的数据库
- **WHEN** 再次以 `--yes` 运行脚本
- **THEN** 报告已是目标版本并以 0 退出，不写入任何东西

#### Scenario: 从更早版本迁移时全部 locus 行都是旧模型
- **GIVEN** 一个 v17 数据库，含 2 条 locus 行，没有 `locus_mains` 表
- **WHEN** 以 `--yes` 运行脚本
- **THEN** 备份写在任何改动之前；版本为 19，`locus_mains` 表存在且为空，两条 locus 行都被删除

### Requirement: 持久层只承载三层模型的 locus 行

v19 持久层的 locus 行 SHALL 满足：`childComposition` 若存在则为 `tier3`；`active` 行带 `childComposition`；从未创建 child 的行（含其后被停止、失效或退役的）可以没有 `childComposition`。这两条由持久行 schema 逐行校验，不满足时 Domain 打开失败。另外，每一条 locus 行的父会话 SHALL 在 `locus_mains` 中有记录，由 Host 启动对账在接收任何飞书消息之前检查。任一条件不满足时，Pet SHALL 保持未就绪，诊断中包含违规记录的 key 或 id，MUST NOT 跳过违规行继续服务。代码中按旧模型退休、重建或展示旧模型入口的分支 SHALL 被删除。某个干活主会话从未建立 locus 主会话时，按它查找入口（如默认 Q&A）SHALL 返回"未建立"而不是报错；只有已读到 locus 行而其父会话缺少配对时才是非法数据。基于 `chat_bindings` 的退休标记路径不属于旧模型 locus 行，保持不变。

#### Scenario: 合规数据正常就绪
- **GIVEN** 持久层只含满足上述条件的 locus 行
- **WHEN** Pet 启动
- **THEN** Pet 就绪，管理路由注册，所有入口按既有规则服务

#### Scenario: 非 tier3 marker 使 Domain 打开失败
- **GIVEN** v19 持久层中一条 locus 行的 `childComposition` 为 `safe-v2`
- **WHEN** Pet 启动
- **THEN** Pet 未就绪，诊断包含该行的 key；不注册管理路由，不接收飞书消息

#### Scenario: 无配对的行使启动对账失败
- **GIVEN** v19 持久层中一条 `tier3` 行的父会话不在 `locus_mains` 中
- **WHEN** Pet 启动
- **THEN** 启动对账失败，Pet 未就绪，诊断包含该行 id；不接收飞书消息

#### Scenario: 从未建立 locus 主会话的会话首次打开 Q&A
- **GIVEN** 干活主会话 W 没有任何 locus 主会话
- **WHEN** 所有者为 W 打开默认 Q&A
- **THEN** 查找默认 Q&A 返回未建立，随后正常新建 locus 主会话与 Q&A 群

#### Scenario: chat_bindings 退休标记仍然生效
- **GIVEN** 某群没有 locus 行，但有一条 `chat_bindings` 旧标记
- **WHEN** 该群收到所有者授权 at
- **THEN** 按既有退休标记规则要求所有者显式重建，不自动建立三层结构
