## MODIFIED Requirements

### Requirement: 入口建立统一为一条路径

auto、Q&A、显式绑定与文档评论 SHALL 走同一建立路径 `provisionChatLocked`，只在“工作主会话从哪来”上不同：auto（未绑定入口首个授权 at）由 Pet 新建 W，工作区为该 at 以 `-w` 指定并唯一匹配的工作区，未指定时为 default workspace（见“首次 at 可用 -w 指定工作区”），新建的 W 是普通会话（见“自动工作主会话是普通会话”）；Q&A 以所有者打开的会话为 W；`/bind` 以所有者指定的普通一级会话为 W。显式 W SHALL 在任何外部创建之前解析。

**从零创建**（该 `chatId` 下没有任何行）无论由哪个入口触发——群首次 at、话题首次 at、群 `/bind`、话题 `/bind`、文档评论——SHALL 得到同一结构：W → M → {群行, 触发入口的话题行（若触发入口是话题）}。建立 SHALL 先复用 W 的 active M，没有则新建 M 并按“协作空间由工作主会话与 locus 主会话两个普通成员组成”建立空间，然后在**一次** `commitProvisioning` 中写入全部行，MUST NOT 分两次提交，MUST NOT 为同一次触发创建第二个 W 或 M。每一行 SHALL 为 `state = not-created`、持有预留的 `sessionId`、`accessMode = read-only`；建立 MUST NOT 预先创建子会话。Q&A 只建群行，且该群行带 `defaultQa`。

**并发**：锁顺序 SHALL 为 `group:<chat>` → `endpoint:<key>` → `main:<W>` lease，lease 从 `ensureLocusMain` 一直持有到 durable commit 或失败补偿结束。因此同群的并发建立被群锁串行，后到者看到已存在的群行并走“群已存在”分支；同一 W 的并发建立由 main lease 保证只建一个 M 和一个协作空间。提交前失败 SHALL 只补偿本操作新建的资源；提交后 finalize 失败沿用现有 committed-operation 恢复。

**群已存在且来源相同**时，新话题 SHALL 在群行的 M 下追加一行，MUST NOT 调用 `ensureLocusMain`，MUST NOT 创建任何外部资源，也不产生 provisioning 操作。

**群已存在而显式 W 与群行的 W 不同**时，无论 `/bind` 发在话题里还是群本体：若群行的 W **可证明已归档**，SHALL 先按“改绑到其他会话”（D6，以当前群行做 fence）把整群改绑到显式 W，再按同一 W 处理本入口，回执写明“已改绑到主会话 <W 标签>（原来源会话已归档）”；显式 W 的校验与普通 `/bind` 相同（子会话、locus 主会话、已归档目标均拒绝）。否则（W 在用或无法证明已归档）SHALL 在加群锁之后、解析 M 之前以 `EXPLICIT_PARENT_CONFLICT` 拒绝，不触碰 Host。回执 SHALL 写明“该群已由 <W 标签> 跟进，不能在这里改绑；原会话归档后可在本入口 /bind 新会话，或在管理面「改绑到其他会话」”，MUST NOT 再使用“请先解除后再绑定”。同一 W 的 `/bind`：入口处于 `stopped` 时重新启用（见“换绑与归档按层处理”），否则幂等返回 reused。

#### Scenario: auto 建立
- **WHEN** 一个从未关联的群收到所有者的首个 at
- **THEN** Pet 新建工作主会话与 locus 主会话，建立协作空间，群行为 `not-created`，随后按首条消息创建子会话并处理该消息

#### Scenario: auto 建立使用 -w 指定的工作区
- **GIVEN** 已注册且目录可用的工作区中恰有一个标题为 `infra-service`
- **WHEN** 一个从未关联的群收到所有者的首个 at：`@bot -w infra-service 排查一下登录超时`
- **THEN** 新建的 W 位于 `infra-service`（cwd 为其路径），而不是 default workspace；其余结构与“auto 建立”相同

#### Scenario: 话题内首次 bind 一次建出群行和话题行
- **GIVEN** 话题群 C 从未建立过任何行；会话 W1 未归档、不是子会话
- **WHEN** 所有者在 C 的话题 T 内发送 `/bind W1`
- **THEN** 恰一次 `commitProvisioning`，写入群行 `C` 与话题行 `(C, T)`，两行都在 W1 的同一个 M 下；`createAutoWorkSession` 调用 0 次；`ensureLocusMain` 调用 1 次；全程只有 1 个 W、1 个 M、1 个协作空间

#### Scenario: 话题首次 at 同样补出群行
- **GIVEN** 话题群 C 从未建立过任何行
- **WHEN** 所有者在话题 T 内首次 at bot
- **THEN** 恰一次 `commitProvisioning`，写入群行 `C` 与话题行 `(C, T)`，同在新建 W 对应的同一个 M 下；`createAutoWorkSession` 调用 1 次

#### Scenario: 群已存在时话题追加不触碰外部
- **GIVEN** 群 C 的群行已存在，M 为 M1
- **WHEN** 所有者在 C 的新话题 T 内 at bot，或发送 `/bind` 同一个 W
- **THEN** 在 M1 下追加话题行 `(C, T)`；`ensureLocusMain`、`createAutoWorkSession` 调用 0 次，没有新的 provisioning 操作

#### Scenario: 绑定到已有工作主会话复用 locus 主会话
- **GIVEN** 工作主会话 W 已有 active locus 主会话 M
- **WHEN** 所有者把另一个群 `/bind` 到 W
- **THEN** 不新建 locus 主会话，新群行的 `locusMainSessionId` 为 M

#### Scenario: 跨 W 的 bind 被拒绝且不触碰 Host
- **GIVEN** 群 C 的群行属于 W1
- **WHEN** 所有者在 C 的话题内或群本体发送 `/bind W2`（W2 ≠ W1）
- **THEN** 以 `EXPLICIT_PARENT_CONFLICT` 拒绝；`resolveMainParent`、`ensureLocusMain`、`createAutoWorkSession` 调用均为 0 次；持久层无任何写入；回执含“该群已由 <W1 标签> 跟进，不能在这里改绑”并提及管理面「改绑到其他会话」，不含“请先解除后再绑定”

#### Scenario: 同一 W 的 bind 幂等
- **GIVEN** 群 C 的群行属于 W1 且处于 `active`
- **WHEN** 所有者发送 `/bind W1`
- **THEN** 返回 reused，不新建任何会话，入口行的 `sessionId` 与 `revision` 不变

#### Scenario: 同群两个话题同时首次 at
- **GIVEN** 话题群 C 从未建立过任何行
- **WHEN** 话题 T1 与 T2 的首次 at 同时到达
- **THEN** 二者被群锁串行：先到者恰一次 `commitProvisioning` 建出群行与自己的话题行，后到者看到群行并在同一 M 下追加话题行（`ensureLocusMain` 与 `createAutoWorkSession` 合计各 1 次）；最终恰有群行 `C`、`(C, T1)`、`(C, T2)` 三行，1 个 W、1 个 M、1 个协作空间，没有孤立话题行

#### Scenario: 话题 bind 与群首次 at 同时到达（bind 先获得群锁）
- **GIVEN** 话题群 C 从未建立过任何行
- **WHEN** 话题内 `/bind W1` 与群本体的首次 at 同时到达，`/bind` 先获得群锁
- **THEN** `/bind` 建出群行（W1 的 M）与话题行；群本体的 at 随后看到已存在的群行，直接使用它，`createAutoWorkSession` 调用 0 次；没有第二个 W 或 M

#### Scenario: 群首次 at 先于话题 bind 到达
- **GIVEN** 话题群 C 从未建立过任何行
- **WHEN** 群本体的首次 at 先获得群锁（建出 auto W0 与 M0），话题内 `/bind W1` 随后到达
- **THEN** `/bind W1`（W1 ≠ W0）以 `EXPLICIT_PARENT_CONFLICT` 拒绝，不触碰 Host；最终只有 W0 → M0 下的群行，没有 W1 的 M，没有孤立话题行

#### Scenario: 同一 W 的 Q&A 与首次 bind 并发
- **GIVEN** 工作主会话 W 尚无 locus 主会话
- **WHEN** 为 W 打开 Q&A 与把另一个群 `/bind` 到 W 同时发生
- **THEN** main lease 保证二者串行：恰新建 1 个 M 和 1 个协作空间，两个群行都在该 M 下；后到者复用 M，`ensureLocusMain` 对外部的创建合计 1 次

#### Scenario: 提交前失败只补偿本操作的资源
- **GIVEN** 从零创建时 `ensureLocusMain` 已成功（新建 M 与协作空间），`commitProvisioning` 提交前失败
- **WHEN** 补偿运行
- **THEN** 持久层没有写入任何群行或话题行；本操作新建的 M 与协作空间被补偿回收；W 若是显式给出的已有会话则不被改动；若 M 是复用的已有 M，则不被归档

#### Scenario: 提交后 finalize 失败走已提交操作恢复
- **GIVEN** `commitProvisioning` 已成功写入群行与话题行，其后的 finalize 步骤失败
- **WHEN** Host 重启或重试恢复
- **THEN** 沿用 committed-operation 恢复完成 finalize；两行保持不变，不重复创建 W、M 或协作空间，没有孤立话题行

#### Scenario: 建立失败不留半成品
- **WHEN** 新建 locus 主会话成功但建立协作空间失败
- **THEN** 本次建立失败并回执；持久层没有写入任何群行或话题行；provisioning 操作按“provisioning 失败超时后不再阻塞”处理，补偿器归档未投入使用的 locus 主会话

### Requirement: 控制命令帮助

`@bot -h`、`@bot --help`、`@bot /help`（及裸 `/help`）SHALL 在 IM 群、话题或文档评论中回复一条控制回执，列出当前可用的控制命令、参数形式与一句话说明，并注明哪些命令仅 allowlist 成员可用。帮助 SHALL 是纯控制命令：不得创建入口、子会话或业务 Delivery，且在已停止的入口上同样可用。回执文本 SHALL 由解析器所用的同一张命令表生成；已弃用的 `/scope`、`/tools` SHALL NOT 出现在其中。帮助与其他控制命令一样仅对 allowlist 发送者可用。

#### Scenario: 查看帮助

- **WHEN** allowlist 成员在入口发送 `@bot -h`
- **THEN** 入口收到一条回执，列出 `/bind`、`/unbind`、`/access` 与工作区选择参数 `-w <工作区名> <工作要求>` 的参数形式与说明，不含 `/scope`、`/tools`
- **AND** 没有任何入口、子会话或 Delivery 被创建

#### Scenario: 帮助与解析器一致

- **WHEN** 解析器的命令表新增或移除一个命令
- **THEN** 帮助回执随之变化，无需另行修改文本

#### Scenario: 已停止的入口仍可查看帮助

- **WHEN** allowlist 成员在已停止的入口发送 `@bot /help`
- **THEN** 回复帮助回执，而不是被当作停止入口拒绝

#### Scenario: 非 allowlist 发送者

- **WHEN** 非 allowlist 成员发送 `@bot -h`
- **THEN** 与其他控制命令一致，被静默拒绝（`control-not-allowed`）

## ADDED Requirements

### Requirement: 首次 at 可用 -w 指定工作区

IM 单聊、群与话题中，at bot 的消息在去掉开头的 mention 之后，若以 `-w <名>`、`--workspace <名>` 或 `--workspace=<名>` 开头，SHALL 被识别为工作区选择：`<名>` 为一个不含空白的词元，其后的全部文字为工作要求。标题含空白的工作区不能用 `-w` 选择（可改用 `/bind`）；帮助中的 `-w` 用法与找不到时的回执 SHALL 写明这一限制。工作区选择不是独立控制命令，而是附在一条工作消息上；它 SHALL 仅对 allowlist 发送者可用，非 allowlist 发送者带此参数的消息与控制命令一样以 `control-not-allowed` 静默拒绝，MUST NOT 当作普通提问投递。缺少名字或缺少工作要求时 SHALL 回执用法，不建立入口、不投递。

名字 SHALL 与 Host 中已注册、且目录状态可用的工作区**标题**做精确比较（区分大小写，不做前缀、模糊或目录名匹配）。恰好一个匹配时，该工作区即本次 auto 建立 W 的工作区。没有匹配或多于一个匹配时 SHALL 失败关闭：回执说明“找不到名为 <名> 的可用工作区”或“有多个工作区名为 <名>”，提示到 Pet 设置查看工作区；回执 MUST NOT 列出本机其它工作区的名称或路径；MUST NOT 创建任何会话或入口行，MUST NOT 投递该消息，MUST NOT 退回 default workspace。

入口已存在（群行已存在）时，工作区选择 SHALL 与群行的 W 所在工作区（按工作区 id）比较：同一工作区时按普通消息投递；不同工作区时 SHALL 拒绝并回执“该群已由 <W 标签> 跟进，-w 不能改绑；可在管理面「改绑到其他会话」”，MUST NOT 投递、MUST NOT 改动任何入口行。话题首次 at 带工作区选择而群行尚不存在时，补出的群行与话题行同属该工作区下新建的 W。该比较 SHALL 以入口建立或复用**之后**实际得到的群行为准，从而同样覆盖并发：同一新群里另一条消息先建出了其它工作区的群行时，带工作区选择的消息按“不同工作区”拒绝，MUST NOT 投递进先建出的 W。入口的 locus 主会话不可用且整 W 迁移因其它 current 投递而延后时，已证明工作区不同的消息 SHALL 回执工作区冲突；其他带工作区选择的消息 SHALL 回执“入口忙，请稍后重试”，MUST NOT 进入该入口的 backlog（无法在此时证明工作区相同）。名字 SHALL 在任何建立操作开始之前解析一次，解析失败时 MUST NOT 产生 provisioning 操作记录。

投递给子会话的正文 SHALL 是原文去掉工作区选择参数（`-w <名>` 及其后紧跟的一个空白）后的结果，其余部分（开头 mention、换行、缩进与其它空白）保持原样，MUST NOT 含 `-w <名>`。处于已停止（retired）状态的入口上，工作区选择与普通消息一样被拒绝。

文档评论入口不识别工作区选择：以 `-w` 开头的评论 SHALL 当作普通提问，原文（含 `-w <名>`）照常投递，不进入控制面，不回执用法；文档仍按 default workspace 建立。

#### Scenario: 唯一匹配时在指定工作区建立并投递去掉参数的正文
- **GIVEN** 工作区标题 `infra-service` 唯一且目录可用；群 C 没有任何入口行
- **WHEN** allowlist 成员在 C 发送 `@bot -w infra-service 看下登录超时`
- **THEN** 在 `infra-service` 新建 W 并建立入口；子会话收到的正文不含 `-w infra-service`，其余与原文一致

#### Scenario: 多行工作要求保留换行
- **WHEN** 首次 at 为 `@bot -w infra-service 复现步骤：` 后接换行与 `1. 登录` 换行 `2. 等待 30s`
- **THEN** 子会话收到的正文保留这两处换行与编号行，只少了 `-w infra-service `

#### Scenario: 三种写法等价
- **WHEN** 分别发送 `@bot --workspace infra-service 看下` 与 `@bot --workspace=infra-service 看下`
- **THEN** 结果与 `@bot -w infra-service 看下` 相同

#### Scenario: 名字只做精确匹配
- **GIVEN** 存在标题为 `infra-service` 的工作区，不存在标题为 `infra` 或 `Infra-Service` 的工作区
- **WHEN** 首次 at 写 `-w infra` 或 `-w Infra-Service`
- **THEN** 回执找不到该工作区；没有创建会话或入口行，没有投递，没有使用 default workspace

#### Scenario: 重名失败关闭
- **GIVEN** 两个可用工作区的标题都是 `app`
- **WHEN** 首次 at 写 `-w app 修一下`
- **THEN** 回执有多个同名工作区；没有创建任何会话或入口行，没有投递

#### Scenario: 目录不可用的工作区不参与匹配
- **GIVEN** 标题为 `legacy` 的工作区目录已缺失
- **WHEN** 首次 at 写 `-w legacy 看下`
- **THEN** 按找不到处理

#### Scenario: 失败回执不泄露其它工作区
- **WHEN** `-w` 找不到匹配
- **THEN** 回执不含任何其它工作区的标题或路径

#### Scenario: 已存在入口且工作区相同
- **GIVEN** 群 C 的群行属于 W1，W1 位于 `infra-service`
- **WHEN** 所有者在 C 或其话题发送 `@bot -w infra-service 再看看`
- **THEN** 按普通消息投递，正文不含 `-w infra-service`；入口行不变

#### Scenario: 已存在入口且工作区不同
- **GIVEN** 群 C 的群行属于 W1，W1 位于 `infra-service`
- **WHEN** 所有者发送 `@bot -w web-app 再看看`
- **THEN** 回执“该群已由 <W1 标签> 跟进”；没有投递，没有新建会话，入口行不变

#### Scenario: 话题首次 at 带 -w 让整群归属该工作区
- **GIVEN** 话题群 C 从未建立过任何行
- **WHEN** 所有者在话题 T 内发送 `@bot -w infra-service 看下`
- **THEN** 恰一次 `commitProvisioning` 写入群行 `C` 与话题行 `(C, T)`，同属 `infra-service` 下新建的 W；之后 C 中其它话题的首次 at 复用该 W

#### Scenario: 并发首次 at 时 -w 不被静默吞掉
- **GIVEN** 群 C 从未建立过任何行，default workspace 为 `acme`
- **WHEN** `@bot 看下` 与 `@bot -w infra-service 修一下` 同时到达，前者先拿到群锁并在 `acme` 建出 W0
- **THEN** 后者回执“该群已由 <W0 标签> 跟进”，没有投递进 W0，没有新建会话

#### Scenario: 迁移延后时带 -w 的消息不进 backlog
- **GIVEN** 群 C 属于工作区 A 下的 W，W 的 locus 主会话已不可用，W 名下另一个群有 current 投递
- **WHEN** 所有者在 C 发送 `@bot -w B 修一下`
- **THEN** 回执工作区冲突；该消息没有进入 C 的 backlog，之后也不会投递进 A 下的 W

#### Scenario: 名字打错不产生建立记录
- **WHEN** 首次 at 写 `-w infar 看下` 且没有该标题的工作区
- **THEN** 回执找不到；provisioning 操作记录、会话与入口行均未产生

#### Scenario: 格式错误回执用法
- **WHEN** 所有者发送 `@bot -w`
- **THEN** 回执为 `-w <工作区名> <工作要求>` 的用法说明，而不是“控制命令执行失败”

#### Scenario: 标题含空白的工作区
- **GIVEN** 唯一可用工作区标题为 `my app`
- **WHEN** 首次 at 写 `@bot -w my app 看下`
- **THEN** 按名字 `my` 找不到处理；回执说明不支持含空白的标题，可改用 `/bind`

#### Scenario: 文档评论中的 -w 是普通文字
- **WHEN** allowlist 成员在已授权文档评论 `@bot -w infra-service 看下`
- **THEN** 不进入控制面、不回执用法；原文作为普通提问投递，文档入口仍属 default workspace 下的 W

#### Scenario: 非 allowlist 成员
- **WHEN** 非 allowlist 成员在已授权群发送 `@bot -w infra-service 看下`
- **THEN** 以 `control-not-allowed` 静默拒绝，不投递

#### Scenario: 缺少名字或工作要求
- **WHEN** 所有者发送 `@bot -w` 或 `@bot -w infra-service`
- **THEN** 回执用法 `-w <工作区名> <工作要求>`；不建立入口，不投递

### Requirement: 自动工作主会话是普通会话

Pet 自动新建的工作主会话 W（IM auto 与文档评论 auto）SHALL 以创建时 Host 的默认 agent preset 创建并在 header 中记录该 preset，与所有者在 DSH 中新建会话得到的 preset 一致；MUST NOT 固定使用 Pet 自有的 `dsh-pet-executor`。默认 preset 在创建开始时读取一次，同一次创建的 header 与挂载 SHALL 使用同一值。本要求不改变 locus 主会话（`locus-base`）与 locus 子会话（`locus-child`）的 preset，也不迁移已存在的 W。

#### Scenario: 自动 W 使用 Host 默认 preset
- **GIVEN** Host 当前默认 preset 为 `standard`
- **WHEN** 首个授权 at 触发 auto 建立
- **THEN** 新建 W 的 header 记录 `agentPreset = standard`，并挂载 `standard`；不是 `dsh-pet-executor`

#### Scenario: 子会话工具面不受 W preset 影响
- **GIVEN** 自动 W 运行 `standard`
- **WHEN** 该入口的首条消息创建子会话
- **THEN** 子会话仍以 `locus-child` 创建，父为 locus 主会话，已发布工具面不含委派工具
