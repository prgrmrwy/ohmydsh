## Context

`pet-locus-intent-triage`（已归档，2026-09-18）建立了共享事实台账与待办：locus 子会话只读，碰到"要求干活"就把已查清的结论登记为待办移交所有者。该 change 的 D8 明确「待办状态只由所有者推进」，管理面给了受理/完成/放弃三个按钮，三者**都只改状态**，均不发飞书、不唤醒任何会话。

真机使用暴露了一个表达与预期的断层：所有者点「受理」后观察到"看起来没有任何变化"，因为**确实没有变化**——除了一个 chip 变色和按钮少一个。所有者的裁定是语义层面的：

> 不需要中间态，我知道了看到就是知道了，只有真开工了才是受理。

这推翻的不是 D8 的**授权模型**（谁能改状态），而是 D8 落地时对 `accepted` 的**语义选择**（这次改状态意味着什么）。原设计把 `accepted` 定义为"已接手、仍可稍后完成或放弃"的可逆中间态；所有者认为"已接手但什么都没做"不承载任何决策，是一次纯成本的点击。

### 当前实现的事实（已核验）

- 状态机在 `host/ledger/todo.ts:56-61`，纯函数无副作用；`advanceStatus`（`host/ledger/store.ts:191`）在事务内重读并写库，同样无副作用。
- 路由 `LOCUS_ROUTES.todoAction`（`host/routes.ts:763`）把 `accept|done|drop` 映射成三个目标状态后直接调 `advance`，返回投影后的单行。
- Host 侧 `todoLedger` 装配在 `index.ts:3204`，`advance` 当前是三行纯映射。
- 前端 `useTodoLedger.dispatch`（`client/settings.tsx:2351`）调完后**整表重读**，不做乐观更新（因为合法性归 Host）。

### DSH 宿主能力（已核验，非注释推断）

读的是实际安装的 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-agent@0.1.5-rc.3` 的 `lib/types/runtime-types.d.ts`：

| API | 声明语义 | 用途 |
|---|---|---|
| `followup(message: UserMessage)` | "Queue an ordinary follow-up turn and wake the driver. The item becomes the **sole ordinary message of its own turn**." | 投递跟进任务 |
| `steer(message)` | "Submit steering for the **nearest step**… a running driver consumes it at its next step boundary." | **不用**（会打断在途工作） |
| `inject(message)` | "Queue model-facing context **without waking** the driver." | **不用**（idle 时永远不醒） |
| `status: AgentStatus` | `idle` ⇄ `running`，每次转换发 `agent/status` | 判忙，用于如实回执 |
| `AgentRegistry.resume(options)`（`index.d.ts:287`） | 载入持久化 session 并 resume | 目标未加载时冷恢复 |

Pet 内已有两处同路径先例，实现应沿用而非另造：`index.ts:1832` 的 locus main `brief`（`createUserMessage` → `followup`），与 `index.ts:1535` 的 executor 投递（同样 `followup`，另加 `whenIdle` 等待）。

### 一个必须处理的非对称：main 有两种来源

`LocusMainSource = 'auto' | 'explicit' | 'qa-created'`（`host/locus/controller.ts:87`）。在 `provisionGroupLocked`（`controller.ts:1025-1070`）里：

- **`explicit`**：所有者 `/bind` 的会话直接成为 main，`selected = parent`。它就是所有者干活的那个会话。
- **`auto`**：走 `dsh.createMainSession`**新建**一个会话，挂 `LOCUS_MAIN_PRESET = 'dsh-pet-executor'`，并立即 `brief` 一段开场白（`host/locus/dsh-port.ts:176-189`），其中逐字写着：

  > 这条消息只是陈述上下文…**不是任务**，也不需要你应答或开始任何工作。
  > 请只回复「了解」或「知道了」，然后**保持待命（standby）**，等待所有者后续的显式指令。

两种情况下"投给 `parentSessionId`"都是正确目标。所有者对这段简报的定性（本 change 讨论中确认）纠正了一处容易犯的误读：

> 自动主会话只是**第一条**不需要干活…需要跟进问题的时候，仍然需要在主 session 下干活。

即那句 standby **描述的是建立时的初始状态，不是对该会话的永久禁令**。把它当成需要"对抗"的冲突是错的；正确做法是在正文里说明待命状态到此结束。措辞差别直接决定投递正文怎么写（D4 第 6 条）。

### 为什么跟进必须落在主会话（根因）

这不是投递目标的任意选择，而是权限模型的直接推论。`openspec/specs/pet-locus-collaboration/spec.md:221-231`：

- 所有新建及替换后的 locus **默认 read**，且接受工作前须核验宿主实际文件策略，MUST NOT 仅依赖数据库标签；
- 存在一个**全局写档开关，当前默认关闭**；关闭期间既有 write 记录在下次核验时按 read 生效；
- 关闭理由 spec 写明：多个 locus 子会话共享同一份工作目录，而 write 即完全访问（ADR-0005：子会话 cwd 固定为父会话 cwd，`workspace-write` 覆盖不到所有者真正在用的 sibling worktrees），并发写入尚无协商机制。

所以子会话不具备写权限是**当前生效的设计状态**，不是配置疏忽——这正是待办机制存在的理由（`pet-locus-intent-triage` spec.md:21：子会话遇到要求干活「MUST NOT 尝试直接修改文件」，只能登记待办移交）。主会话是这棵树里唯一能真正动手的位置，因此**在主会话下干活是跟进待办的本职路径，不是例外**。

推论：本 change MUST NOT 通过提升子会话权限来"就地跟进"。那会绕开全局写档开关所保护的并发写入问题，把一个交互缺口修成一个安全缺口。

## Goals / Non-Goals

**Goals:**

- 让「受理」成为所有者预期的开工动作：一次点击完成状态推进与任务投递。
- 投递自带足够上下文，所有者不必再手工复述待办内容。
- 投递不打断主会话的在途工作。
- 投递结果如实回执，三种结局（已投递/排队中/不可达）可区分。
- 保持 D8 的授权分界不变：模型仍不能改状态。

**Non-Goals:**

- 不引入任何目标选择面。所有者不能选投给谁，Host 从台账归属解析。
- 不改变「完成」「放弃」的纯记账语义，也不新增第四个动作。
- 不让状态变化外发飞书（`pet-locus-intent-triage` spec.md:141 的不变量保持）。
- 不改数据模型、不升 `PET_DOMAIN_VERSION`、不做数据迁移。
- 不新增 compat patch，不扩大任何权限面。
- 不处理 B043（Pet 任务面板英文文案），虽同处 `settings.tsx` 但正交。

## Decisions

### D1. `accepted` 由"标记"改为"开工"，取消中间态

**决策**：`accept` 动作 = 置 `accepted` + 投递跟进任务，两者不可分。不保留"只标记不投递"的入口。

**理由**：所有者的直接裁定。更根本地说，原 `accepted` 违反了"每个动作都该承载一个决策"的原则——"我知道了"不是决策，因为看到列表本身就已经知道了。一个不承载决策的状态只会稀释状态机的信息量：`open` 与旧 `accepted` 对"这件事推进了吗"给出同一个答案（没有）。

**保留的逃生门**：`open → done` 和 `open → dropped` 的直达路径不变，所有者仍可不开工就了结一条待办。这保证取消中间态没有减少所有者的选项，只是删掉了那个不做事的选项。

**备选**：加第四个「开工」按钮，`accepted` 保持原义（所有者明确否决："不需要中间态"）；把投递做成 `accepted` 之后的可选后续动作（等于把一次决策拆成两次点击，问题原样保留）。

### D2. 用 `followup` 而非 `steer` 或 `inject`

**决策**：投递走 `AgentHandle.followup(UserMessage)`。

**理由**：三个 API 的官方语义恰好对应三种不同行为，只有 `followup` 同时满足"不打断在途工作"和"idle 时会真的开始"：

- `steer` 在 running 时**抢占最近的 step**——这正是 `pet-locus-context-is-pull-not-push` 记录的、当初否决推送式派发的原因（"一个 agent 干着活突然被塞进别人的问题，注意力就散了"）。
- `inject` 明确 "without waking the driver"，idle 目标会一直不动，投了等于没投。
- `followup` 声明 "becomes the sole ordinary message of its own turn"，正是"排队，等它忙完自然接上"。

所有者已确认选择排队语义。

**备选**：忙时拒绝并提示稍后再点（多一次手工重试，而"忙"是常态）；忙时 steer（否决，见上）。

### D3. 投递目标从台账归属解析，零 selector

**决策**：目标恒为该待办的 `parentSessionId`，不开放任何 session/chat/thread selector。

**理由**：与 `pet_locus_track` 登记时的纪律一致（spec.md:113：工具不接受任何 selector，Host 从 caller 与 current Delivery 解析全部关联事实，不可证明时 fail closed）。处置端若开放 selector，就出现了一条登记端被明确禁止的寻址路径。且 `parentSessionId` 已经是台账的归属键，本就是唯一正确答案。

### D4. 正文由 Host 组装，不由模型或所有者撰写

**决策**：新增一个纯函数组装跟进正文，与 `composeLocusMainBriefing` 同类但独立。

**理由**：正文承载的全部是 Host 已持有的durable 事实（itemId / requestedBy / createdAt / endpoint / evidence）。让模型撰写等于让它复述自己可能没读过的记录；让所有者撰写则把"不必手工复述"这个目标又还了回去。纯函数也让正文可直接单测。

**不复用 `composeLocusMainBriefing`**：那段文案的目的与本次**恰好相反**（它要求待命并明确说"不是任务"）。共用一个函数会让两种相反意图纠缠在一个模板里。

**正文须陈述**（对应 delta spec 的 scenario）：

1. 这是一条 locus 待办跟进任务，待办标识 `itemId`；
2. 原始请求人、登记时间、来源入口；
3. 登记时的证据摘要，**并标注其为登记时刻快照**（沿用 spec.md:76-78 的"MUST NOT 被呈现为当前仍然成立的结论"）；
4. 行动指引：先读上下文、核对证据是否仍成立，再推进；
5. 可用的查证路径（该 locus 的子会话、原飞书入口）；
6. **auto main 时**：显式声明这是所有者发起的真实任务、待命状态到此结束。

第 6 条是否出现，取决于该 locus 的 `mainSource`，Host 已持有该事实，不需要推断。

措辞纪律：第 6 条应写成"**待命状态结束**"而非"**解除约束**"或"**忽略之前的指令**"。后两种写法暗示两条指令在打架，会诱使模型去推理该听谁；前者陈述的是事实——开场简报描述的初始状态已经过去了。这与所有者对该简报的定性一致（见 Context）。

### D5. 状态与投递的失败次序：先证目标可达，再置状态

**决策**：解析并确认目标可达（必要时先 `resume`）→ 投递 → 置 `accepted`。任一前置步骤失败则拒绝受理，状态保持 `open`。

**理由**：两个副作用不在同一个事务里（一个是 SQLite 写，一个是向 Agent 投消息），无法原子。因此必须选一个安全的失败方向：

- 先置状态再投递：投递失败留下一条"已受理但无人跟进"的记录，而它在 UI 上看起来一切正常——这是最坏的失败模式，它**把丢失伪装成成功**。
- 先投递再置状态：写库失败留下一条"已投递但仍显示待处理"的记录。所有者再点一次会造成重复投递，但重复的跟进任务是可见的、可判断的噪音，不是静默丢失。

选后者。这与仓库既有的 fail-closed 纪律一致（AGENTS.md：身份或状态无法证明时应拒绝破坏性操作），也与 `advanceStatus` 已有的"事务内重读"取向一致。

**残留窗口**：投递成功但写库失败的窗口无法消除，只能让它偏向可见。实施时该分支须记结构化日志。

### D6. 存量 `accepted` 行不被冒充为已投递

**决策**：管理面 MUST NOT 声称存量 `accepted` 的跟进任务已投递。

**理由**：本 change 不加字段（D7），因此无法从一行 `accepted` 记录区分"旧语义标记的"与"新语义投递过的"。既然分不清，就不能断言。这是"不确定时不编造"的直接应用——与 spec.md:174 的"话题身份不可证时退化并如实说明"同一条纪律。

实现上最简单的忠实做法：受理动作的成功回执是**一次性的 notice**（本次操作的结果），而不是从行状态反推的持久标签。行状态只说"已受理"，不说"已投递"。

### D7. 不新增持久字段

**决策**：不给 `todo_item` 加 `dispatchedAt` / `dispatchTargetSessionId` 之类的字段。

**理由**：`PET_DOMAIN_VERSION` 一旦变动，存量部署会 fail-closed 降级到**全部路由不注册**（不只是新功能不可用），这是 `pet-locus-intent-triage` design.md 的 Migration Plan 里被实机证伪过一次的代价（14→15 那次，日志 `kv unit 'dsh_pet' is stamped version 14 … incompatible with descriptor version 15`），且需要停机迁移。为一个能用 D6 方式忠实表达的展示需求付这个代价不划算。

此外 `private-descriptor-fields-silently-lost-on-official-rebuild-paths` 的教训同向：优先选择不新增持久字段的等价改法。

**若将来确需**（例如要做"重新投递"或投递审计），应单独立项并把"在有存量数据的环境实际部署一次"列为验收项。

## Risks / Trade-offs

- **[auto main 仍按开场简报的初始状态待命]** → D4 第 6 条在正文里声明待命状态到此结束；实施时须有测试固定 auto 分支正文包含该声明。若不处理，表现为"受理了但主会话回了个『了解』就不动"——一种新的"看起来没变化"，正是本 change 要消灭的体验。
- **[投递成功但写库失败]** → D5 已把失败方向选为可见（重复投递优于静默丢失），但窗口无法消除。须记结构化日志；不做自动补偿（补偿需要判定"上一次投递是否到达"，而这正是 D7 决定不持久化的事实）。
- **[重复受理造成重复投递]** → 状态机已保证 `accepted → accepted` 非法（`todo.ts:58` 的 `accepted: ['done','dropped']`），所以正常路径下受理只可能成功一次。仅 D5 残留窗口会导致重复，属可见噪音。
- **[主会话长期忙碌，跟进任务排队很久]** → `followup` 的队列语义即如此，所有者已确认接受。管理面须如实显示"已排队"而非"处理中"（delta spec 已固定该 scenario）。不引入超时或提醒机制——那会把一件简单事做成调度器。
- **[所有者误以为投递会回飞书]** → 按钮 hint 须同时说明两件事：会向主会话投递跟进任务（新），且不发送任何飞书消息（旧，仍然成立）。现有 hint 只说了后者。
- **[跟进任务把主会话推向它无权做的事]** → 不构成提权：主会话的工具面由其自身 preset 决定，投递一条消息不改变 `LOCUS_SAFE_TOOL_FILTER` 或 `attestLocusComposition` 的既有约束。auto main 挂 `dsh-pet-executor`，其能力边界与本 change 无关；若该 preset 不足以完成某类待办，那是既有事实，不由本 change 引入。

## Migration Plan

无数据迁移：不加表、不加字段、不改 `PET_DOMAIN_VERSION`（D7）。

部署即生效，行为变化对存量数据的影响仅限语义层面：

1. 存量 `open` 行：下次受理走新语义，符合预期。
2. 存量 `accepted` 行：按 D6 不被冒充为已投递。所有者若想让它真正开工，可在实现中保留的路径是——**无**，因为 `accepted → accepted` 非法。这是已知限制：**存量 accepted 行无法经受理触发投递**，所有者需手工去主会话交代，或直接 `done`/`drop` 后由子会话重新登记。实施时须在管理面就地说明，不可让所有者反复点一个必然失败的按钮。
3. 回滚：改动全在 Host 与 Web 代码层，回滚即恢复旧语义，无残留数据结构。

按仓库约定，改动后须 `dsh build`（或 `node scripts/sync.mjs`）物化，并确认 `~/.dsh/profiles/web/node_modules/dsh-pet/lib/client.js` 已更新——仅改 `src/` 不影响当前 GUI（B043 条目记录过同一陷阱）。

## Open Questions

1. **存量 `accepted` 行的处置**（Migration Plan 第 2 点）：就地说明即可，还是值得为其提供一个一次性的"补投递"路径？后者需要一个 `accepted → accepted` 的例外或一个独立动作，会把 D1 的干净语义撕开一个口子。倾向于只做说明，待所有者确认。
2. **投递后是否自动打开目标会话**：所有者在澄清中提到"应该是带着上下文的"，指的是正文内容；是否还要顺带把 GUI 导航到该主会话未明确。管理面已有 `sessionOpener` 接缝（`settings.tsx:2470`），加上成本很低，但会让一次点击产生两个副作用。待确认。
3. **`qa-created` 来源的 main**：`LocusMainSource` 的第三种值，其开场简报是否同样声明待命，实施前须核验 `ensureDefaultQa` 路径（`host/locus/controller.ts:730,909`），不从 `auto` 推断。
