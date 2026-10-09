## Context

Pet 的可信上下文按「当前 Invocation」解析：`resolveTrustedContext`（`src/host/capture.ts`）先按 executor session id 找到 Task，再用 `findCurrentInvocation`（`src/host/repository.ts`）取唯一处于 `running|waiting-user` 的 Invocation；找不到就 fail closed 抛 `NO_CURRENT_INVOCATION`。

而 Invocation 目前只由两条路径创建：

1. `POST /invocations` → `PetCoordinator.accept`（来源会话里的能力手势，browser capture）；
2. `channel/pipeline.ts` → `acceptConversation`（入站渠道消息，不绑定 Skill 的对话式 Invocation）。

Pet root executor 会话本身是一个常驻的普通 DSH session：它的 scoped composition（含 `pet_context`）在每次 Agent 加载时安装并跨 turn 保留，standing instructions 又要求每次调用先读可信上下文。于是**结算后的真人直输消息**落进一个没有任何 Invocation 的轮次：模型被要求调用一个必然失败的工具，而这一轮既没有授权快照、也没有结构性的动作闸门（bash/文件工具完全不校验 Invocation）。

实测证据（2026-10-09，本机）：

| 事实 | 值 |
| --- | --- |
| Task | `task-ecf66b4f-589d-49f4-ab8f-5c0d157d1494`，`status: idle`，未归档 |
| 唯一 Invocation | `inv-2cc835fa-…`，capability `ws`，`status: succeeded` |
| 会话 | `session-26ecffef-…`（Pet Workspace executor） |
| turn 1 | 带 envelope 的能力调用，`ws clean` 被合并证明门拒绝，模型以“请你决定下一步”结束；`turn/end reason=completed` → Invocation 结算，Task 回到 idle |
| turn 2 | 用户直输 `放弃这个分支把`（`user/message` + `source.kind=user` + `rpcId`，无 envelope）→ 模型 3 次调用 `pet_context`，全部 `NO_CURRENT_INVOCATION` → 按 instructions 停手，用户指令未被执行 |

约束与既有不变量：

- `openspec/specs/dsh-pet/spec.md` 的「每次主动调用在发起位置捕获独立快照」要求“用户主动调用能力**或提交新 Pet 请求时**创建 Pet Invocation”；「Pet Agent 获得稳定身份前馈和可信的当前 Invocation 上下文」要求无唯一当前 Invocation 时 fail closed 且返回可诊断错误。
- 归档场景已明确：**结算后的旧 snapshot 不是新的可执行授权**（`TASK_ARCHIVED` 分支与 spec 的“归档 Task 的 executor 再次调用”场景）。
- 每个 Task 同时至多一个 `running|waiting-user` Invocation；`pump` 按串行槽排队。
- qa-child 与 unified locus child 各有自己的组合与授权语义（`isForkChildTaskForm`、locus 反向解析），不在本设计的适用面内。

## Goals / Non-Goals

**Goals:**

- 让 Pet root executor 会话里的**真人直输消息**成为一次合法的会话内直输 Invocation：登记后 `pet_context` 返回从该 Task 固定来源 scope 重新捕获的 snapshot，工作可以继续。
- 不引入新的授权主体、不允许模型改绑目标：目标永远由 Task 记录固定，识别只认客户端提交的真人消息。
- 保持既有串行、结算、重试、归档与面板语义一致；locus/qa-child 与渠道对话式路径行为不变。
- 无法登记时仍然 fail closed，但错误语义可诊断（区分三种情形、不返回任何 snapshot）、并给出继续工作的路径。

**Non-Goals:**

- 不为 locus child / qa-child 登记 Invocation，也不改变它们的工具面。
- 不实现“空闲快照复用”或任何在无 Invocation 时返回旧 snapshot 的行为。
- 不改动渠道对话式 Invocation 的信任来源（显式路由 + 发送者 allowlist）与回复链路。
- 不新增 Pet 私有 Agent composition、不改 `pet_context` 的零参数 caller-bound 契约。
- 不在本 change 引入面板上的“继续此任务”按钮（见 Open Questions）。

## Decisions

### D1：补第三条发起位置，而不是隐藏工具或返回“空闲快照”

- **选择**：为真人直输登记会话内直输 Invocation。
- **为什么不隐藏 `pet_context`**：scoped surface 按 Agent 加载安装、跨 turn 保留，而空闲是暂时的——下一次 Invocation 派发后同一工具必须就在；同时该工具的错误是模型在空闲窗口里唯一的停止信号，隐藏它反而让模型在无授权状态下继续动手。spec 的“可见性必须与授权边界一致”针对的是**永远不可能成功**的发布（普通会话、child 形态），不是暂时空闲。
- **为什么不返回软性“空闲 payload”**：结算后的 snapshot 已明确不是新授权；返回任何带路径的 payload 都会诱导模型沿用旧目标（实测中模型自己都察觉“用旧快照路径做只读检查是个错误”）。

### D2：识别判据——两个互相独立的证明

必须同时证明：

1. 该消息是**客户端提交的用户消息**：经 executor 会话的 inbox 进入、`source.kind === 'user'` 且携带客户端请求标识（实测 GUI 提交带 `rpcId`；Pet 自己的 `createUserMessage` 不带）。
2. Pet 的派发簿记**不拥有**该消息：不是 Pet 正在派发/刚派发的 envelope，也不是 `coordinator.answer` 的答复。

任一条无法证明即不登记（fail closed，保持现状行为）。宿主注入上下文（时间/记忆提醒等）与渠道投递都不满足第 1 条或第 2 条；locus child / qa-child 在识别前就按 Task 形态排除。

**必须在实施前实测确认（G1）**：DSH 0.2.0-rc.2 上 `agent/inbox/spliced` / `agent/inbox/claimed` 的确切载荷与顺序、`rpcId` 是否随事件到达、是否存在携带客户端请求标识的 Host 注入消息。形状未知时按“不可证明”处理。

### D3：登记时机与竞态

- **首选**：消息入队（inbox splice）时登记——此刻来源类别已知，且通常早于 turn 开始若干百毫秒。
- **推迟**：若该 Task 的串行槽仍被占用（用户在当前 Invocation 运行中输入），不登记，由该消息自己被 claim 的那一轮重试（`agent/inbox/claimed` 精确报告该轮消费了哪条消息，比 `turn/start` 更准）；这样既不抢占当前调用，也不产生第二个 current。
- **确定性兜底**：`pet_context` 解析前先查该会话是否有“登记进行中”的 in-flight 记录，有界等待其完成后重新解析；完成则返回该 Invocation，失败则返回空闲诊断。仅靠事件顺序会留下“模型第一步先于落库”的真实窗口。

### D4：snapshot 从 Task 固定来源重建

由 Task 记录（`sourceKind` / `sourceId` / `scopeKey` / `residentWorkspaceId` / `sourceTitle`）驱动，复用既有 `validateCapture` + `SourceContextRegistry.enrich` 路径，**不读取消息文本里的任何标识**：

| 形态 | 重建来源 |
| --- | --- |
| `session` | 该 source session 的持久 header（title/cwd/asOfSeq）+ 既有 worktree/SCM provider |
| `workspace` | workspace registry 的 id/title/path |
| `none` | 独立来源快照（`independent:web:default`），不伪造 source |
| `chat`（workspace-resident） | 与 `acceptConversation` 同形：chat 来源 + resident workspace id/title + workspace path；**不创建任何渠道回复目标**，因此渠道回复工具因缺少 current Delivery 而保持 fail closed |

来源事实无法重建（workspace 已消失、session 已删除）时不登记，走空闲诊断。重建失败 MUST NOT 退化为“无来源快照”。

### D5：复用串行与结算语义

- 会话内直输 Invocation 直接以 `running` 落库（该轮已在执行，不存在 `queued`→dispatch），并写入 run 记录（`startedAt`），使面板、`retry`、`isSlotFree` 语义保持一致。
- 由于用户消息本身就是该轮输入，Pet **不派发 envelope**；但把用户文本存为 `request`，使 `retry` 能按既有对话式路径重新派发同一条请求（同 snapshot，不新建）。
- 结算沿用 `session/event` 观察者：`turn/end` 的 completed/aborted/其它 reason 分别映射 succeeded/cancelled/failed，然后 `pump` 启动排队中的下一个 Invocation。
- 面板新增能力标识 `session-message`（展示为“会话内直输”），与渠道的 `lark-message` 区分。

### D6：fail closed 语义与 standing instructions

- 保留 `NO_CURRENT_INVOCATION` 作为空闲码，但错误文本必须区分「不是 Pet Task 会话」「Task 已归档」「Task 当前空闲（本轮不属于任何 Invocation）」三种情形，**不携带任何 snapshot/路径**，并说明继续路径（从来源位置发起新调用）。
- `executor-instructions.md` 增加三条：空闲期轮次的归属规则（本轮无授权快照、禁止沿用旧快照执行有副作用操作、告知用户如何继续）；已被登记为本轮 Invocation 时以 `pet_context` 返回的新 invocation id 为准；需要用户决策时**在调用内**提问（`ask_user_question` / 等待批准），不得纯文本提问后结束调用。

## Risks / Trade-offs

- **[误把宿主注入/渠道投递登记成真人直输]** → 两个独立证明 + G1 实测；形状未知按不可证明处理，宁可不登记。
- **[会话内直输 Invocation 占用串行槽，延后排队的能力调用]** → 会话本来同一时刻只能跑一轮，占槽比“账面上空闲、实际在跑用户对话”更诚实；面板可见，排队工作在该轮结算后按序启动。
- **[模型诱导用户回话从而获得新授权]** → 决定权在人；目标由 Task 固定、无法改绑，与用户回来源会话点一次能力等价，未新增任何主体或凭据面。作为已接受的风险记录在案。
- **[resident(chat) 会话把普通项目工作记成 Pet 工作]** → snapshot 与渠道对话式同形、不创建回复目标；若实际使用中噪音过大，再由后续 change 收窄到专用 Pet executor。以真实 resident 会话验收。
- **[长会话频繁直输产生大量 Invocation]** → 每条记录很小（无 envelope、不复制 transcript），面板按时间排列；可接受。
- **[`pet_context` 等待登记造成额外延迟]** → 仅在有 in-flight 登记时等待，且有界超时；超时后回到空闲诊断，不阻塞其它解析。

## Migration Plan

1. **无破坏性 schema 变更**：新增的发起位置类别以数据形式记录（新增能力标识；如需字段则 additive 且对旧行为默认值），既有 Task/Invocation/快照不变。
2. **实施顺序**：先落 G1 实测结论，再实现识别 + 登记 + 快照重建，最后补 `pet_context` 空闲诊断/等待、instructions 与面板显示。
3. **部署**：`dsh build`（`node scripts/sync.mjs`）物化 → 重启 DSH → 在真实场景验收：结算一次 Invocation 后在 executor 会话直输消息，确认新 Invocation 落库、`pet_context` 成功、面板显示 `session-message`、`turn/end` 结算正常。
4. **回滚**：回退代码即可——直输消息回到空闲诊断行为；期间新增的记录只是历史数据，不影响旧 Task 的读取与归档。

## Open Questions

- **Q1（G1）**：GUI 提交是否总以 `agent/inbox/spliced` 携带完整 UserMessage（含 `rpcId`）先于 `turn/start` 到达？
- **Q2（G1）**：是否存在携带客户端请求标识的 Host 注入消息（若存在，需要额外的来源白名单而非仅凭 `rpcId`）？
- **Q3**：resident(chat) 形态下，普通项目会话工作是否仍应登记为 Pet Invocation？本设计选择登记并保持与渠道同形，验收后如判定噪音过大再收窄。
- **Q4**：是否需要一个显式 UI 入口（面板“继续此任务”）？本 change 不做，留待观察直输路径是否已足够。
- **Q5**：会话内直输 Invocation 在面板上是否用用户文本首行做标题？属展示细节，实施时定。
