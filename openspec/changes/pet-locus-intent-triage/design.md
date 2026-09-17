## Context

Locus 子会话当前只有一种结局：回复并结算 Delivery。要求干活的请求在只读权限模型下无法执行，回一句"做不了"之后不留痕迹。动机见 proposal。

**已验证的宿主接缝**（任务 1.1–1.4 用真实包类型与真实源码逐条核验，非重述计划；证据见 `test/intent-triage-host-seam.test.ts` 与 `test/intent-triage-domain-contract.test.ts`）：

- `ctx.get('sessionController').inspect(sessionId)` 冷读，官方类型 `Promise<SessionInspection>`。官方文档原话确认了 D3 的核心主张：*"Inspect one attached or persisted Session **without activating its Agent**."* 探测式接入（`typeof !== 'function'` 即降级），缺失时能力不发布。

  **1.1 发现的偏差**：本设计早先把返回形状简化写作 `{ events, meta.cwd }`，这是 `management.ts`/`index.ts` 消费方的**手写窄化断言**，不是官方类型的真实全貌。真实 `SessionInspection`（定义在 `@deepseek-ai/dsh-session-persistence`，`dsh-api-session-controller` 只 `import type` 引用、未重导出）是 `SessionStorageMetadata & { events: readonly SessionEvent[] }`，其中 `meta` 是完整 `SessionHeader`（`version`/`id`/`createdAt`/`cwd?`/`parentSession?`/`isSeeded`/`origin?`/`delegationDepth?` 等），另有 `inheritedEventCount` 字段——两处本设计此前均未提及。实现时只读取 `events` 与 `meta.cwd` 仍然正确（其余字段本 change 不需要），但文档措辞已改为准确描述"窄化读取"而非"完整返回值"。

  **另一处偏差（不阻塞，记录留意）**：`@deepseek-ai/dsh-session-persistence` 实际在运行时可解析（`dsh-api-session-controller` 的传递依赖，被 pnpm 提升），但**未被 `dsh-pet` 的 `package.json` 显式声明**。今天的窄化断言正是绕开这条未声明依赖的原因——若未来任何代码改为 `import type { SessionInspection }` 直接引用，须先把该包提升为显式声明依赖，否则类型检查依赖一条不受 semver 保护的隐式路径。

- **1.2 发现**：`inspect` 是否真的不激活 Agent，是 Cordis service 内部实现，Pet 侧无法在不搭建完整 `dsh-cordis-host-runner` 的前提下直接观测（该基座只存在于 `.launcher-builds`，未纳入本包依赖，搭建代价与本任务想验证的单点不成比例）。转而验证 Pet 自己能保证的那一半：现有 `createLocusSessionDescriber` 消费路径（`management.ts`）里**不存在任何** `followup`/`queuePrompt`/`resolveAgent`/`sendMessage` 调用——结构上没有"顺便唤醒"的路径。新查阅工具须保持同一结构性质：任务 4.2 的测试断言应是"新工具源码不包含任何激活 Agent 的调用"，而非试图从 Pet 侧证明 Cordis 内部行为。
- Pet SQLite 域的唯一 writer 与 additive schema 演进路径：真实历史 14 次版本演进（v1→v2 是唯一非 additive 的例外，因 Skill digest 改名），其余全部遵循"新表和/或可选字段，旧行 zod 校验时用默认值兜底，不改写不清空"。19 个（实测 20 个，`inquiry_results` 此前手数漏计）现有表全部是 `domainTable<string, z.infer<typeof X>>(X)` 同一形状。`inquiries` 表（v11）是最贴近的先例：独立持久实体、有状态机、schema 委托给 `inquiry/ledger.ts` 的纯函数解析，且**故意吞掉真实 zod 错误**（只报通用 `Invalid inquiry record.`），因为详细错误会回显问题原文或身份。`todo_item` 承载可比敏感的字段（`summary`/`evidence`/`requestedBy`），实现时须复用同一"委托纯解析器 + 吞错误"模式，不写成带细粒度字段错误的裸 `z.object`。提议的三个表名 `shared_fact_ledger`/`ledger_item`/`todo_item` 均满足 `UNIT_NAME_RE`（小写 snake_case）且与全部现有表名无冲突。
- **1.3 发现**：scoped tool 装配无需任何新机制。三个新工具与 `pet_context`/`pet_locus_finish` 完全同构——零参数、经 `callerSessionId(exec)` 解析身份、经 `ctx.tools.register()` 在 `registerPetTools` 内注册，而 `registerPetTools` 只从 `installPetScope` 的单一 `scoped.inject(['tools'], ...)` 回调调用。`contextToolAgents` WeakSet 幂等闸门与既有工具共用，无需新增闸门。官方 `tools.register()` 按调用上下文的 scope tag 决定层级，**无 scope 会静默落 global 层**——这是已在本仓库实机复现过的陷阱，既有装配路径已处理，本设计沿用而非另建。`ctx.inject()` 回调异步执行：注册后不得同步断言完成，须显式等待回调真实完成，既有 `Promise.race` + 5s 超时兜底同样直接复用。

**明确不依赖**：`pet-locus-independent-agent-inquiries` 的代码、规范与归档顺序。该 change 若被丢弃本设计仍成立；其 `collaboration/` 与 `inquiry/` 模块不在本 change 的读写范围内。

**约束**：不改 `locus/delivery.ts` 状态机、`locus/admission.ts` 防线、`locus/permission-mutation.ts` 权限派生。

## Goals / Non-Goals

**Goals**
- 要求干活的请求留下可追踪、可处置、跨 locus 代际存续的记录。
- 子会话能在不唤醒主会话的前提下查到判定与排查所需的既有事实。
- 同源 locus 之间可共享已登记的结论，而不共享对话历史。
- 台账抽象只固化当前能被验证的那一层，为后续 kind 留出扩展位而不预付设计代价。

**Non-Goals**
- 不提供唤醒主会话或兄弟的提问通道（双向问答属 inquiry 领域）。
- 不做项目级或跨主会话知识库、自动摘要、内容下载与采纳规则。
- 不引入 worktree、写能力或并发执行。
- 不做飞书侧待办通知、双向同步或状态回写。
- 不改变 Delivery 状态机、队列不变量与权限派生。

## Decisions

### D1. 意图判定放在子会话，用权限模型兜底，而不是 Host 分类

**决策**：由子会话在 prompt 指引下自行判定，Host 不做内容分类。

**理由**：Host 侧分类需要理解自然语言意图，规则或分类器都会错，且错了无处申诉。更重要的是——**判定的正确性不需要由判定机制保证**：locus 默认只读，双因子写授权独立于此判定，因此"误判为要干活"最多多一条可关闭的待办，"误判为信息交换"最多让用户再说一次。两种误判都不会越权。

这与仓库既有原则一致：权限边界由 Host 从实际执行上下文派生，不由模型声明决定。

**备选**：Host 关键词规则（脆弱，且会把"帮我看看这个 bug"这类模糊表达硬分到一边）；训练分类器（成本与收益不成比例，且不可解释）。

### D2. 澄清至多一次，失败时倒向登记

**决策**：同一条 current Delivery 至多澄清一次；未获可判定答复即登记待办。

**理由**：代价不对称——噪音待办可一键关闭，跟丢的请求找不回来。限制为一次是为了避免与用户反复往返把 Delivery 顶到 deadline；澄清复用既有回复路径与同一子会话多轮语义，不新建等待状态机。

**备选**：多轮澄清直到明确（可能耗尽 deadline，且用户体验差）；不澄清直接按保守规则归类（模糊请求占比不低，会显著推高噪音或漏记）。

### D3. 只读查阅走冷读，绝不重新进入主会话

**决策**：查阅直接读 `inspect()` 返回的已落盘 events，作为纯数据读取。

**理由**：这是本 change 解决父会话争用的核心——**读父会话历史与让父会话推理是两种操作**，前者是不可变数据读取，可任意并发；后者消耗 turn，必须串行。会话日志 append-only，天然是不可变快照，读它不需要版本管理。actor 体系中的对应物是 Orleans `[ReadOnly]`（只读方法可交错执行）。官方 `SessionController.inspect` 的文档注释是第一方证据：*"Inspect one attached or persisted Session **without activating its Agent**."*（已核验，见 `test/intent-triage-host-seam.test.ts`）——这不是 Pet 侧的推断，是宿主自己声明的语义分工。

**关键实现边界**：读路径 MUST 是纯数据读取。一旦它"顺便问一下主会话"，就退化成写路径，并可能形成调用环（A→B→A 死锁，Orleans 对此有明确警告）。这条是 D3 成立与否的分界线，实现时须有测试固定。

**备选**：向主会话发消息取上下文（正是要消除的争用源）；在 child 创建时预先注入父摘要（违反既有独立上下文要求，且会过时）。

### D4. 台账只承诺归属、授权、命名空间三件事

**决策**：定义台账，但只固化三项承诺；修订语义、生命周期、写入授权交给各 kind 自行定义。

**理由**：**只有一个使用者的抽象通常抽错。** 台账当前只有待办一类条目，无法验证"不同 kind 共用什么"。可确证共用的只有授权边界与命名空间；而修订语义本就不该统一——待办是状态机（待处理→已受理→已完成/已放弃），而将来可能的"共同约束"类条目更接近整体替换的 CAS，强行统一会同时损害两者。

留出 `kind` 分区即可满足"以后能挂别的"，代价接近零；等第二类条目出现且确有更多共用语义时再上提。

**备选**：不做台账只做待办表（以后加第二类要改动，但代价其实不大）；现在就定义完整的通用条目模型（为想象中的未来付设计代价，且大概率抽错）。

### D5. 台账归属按 `parentSessionId`，不按 workspace 或 project

**决策**：台账边界 = 主会话及其当前有效 locus 子会话。

**理由**：这是所有者明确的产品选择——要的是**主会话与其 locus 的共享事实**，不是项目知识库。技术上这也是唯一能复用现有授权结构的边界：locus 正反向索引已提供 `parentSessionId → loci[]` 与 `childSessionId → locusId`，caller 可由实际执行会话反查，无需新增成员关系真相。

按 workspace 或仓库聚合会跨主会话，即跨权限边界，授权模型须重做；显式 project 实体则与 `pet-unified-locus-collaboration` design §7.3「本期不预建 Project/Summary 数据模型」直接冲突。

**备选**：见上，均已否决。

### D6. 待办关联 locus 标识而非实例

**决策**：固定 `locusId` + `endpoint` 用于解析来源与去向；`generation` 只作审计事实，不参与寻址。

**理由**：待办的价值定义就是"比承载它的会话活得久"。locus 代际是**服务能力**的分代（切换来源、显式重建产生新代），而待办追踪的是**事项**，两者生命周期本就不同。`locusId` 稳定唯一、`endpoint` 是平台寻址事实，二者都不随代际变化，足以支撑回跳与回复。

记录 `generation` 是为了让所有者能判断"这条待办登记时是哪一代"，属审计需要；一旦让它参与寻址，代际更替就会使待办失去目标，与设计目标矛盾。

**备选**：挂在 locus 代际下（代际更替即跟丢，否定目标）；挂在 endpoint 下（群解散即失效，仍会跟丢）。

### D7. 待办与 Delivery 解耦，登记后当场结算

**决策**：登记待办后立刻经 `pet_locus_finish(reply)` 结算 Delivery，待办独立存活。

**理由**：这是「turn 结束 ≠ 请求完成」的同一思想再用一次——**回复完成 ≠ 事情做完**。若不结算，Delivery 停在 current，整个入口队列被一件长期事务阻塞，正是要避免的队头阻塞。而回执受理事实又保证用户得到明确反馈，不会以为消息石沉大海。

由此得到两条必须同时成立的表述：待办未完成不表示请求未答复；Delivery 已结算不表示事项已完成。

**备选**：保持 current 直到待办完成（阻塞队列，且 deadline 机制会强行过期它）；用 `no-reply` 结算（用户收不到任何反馈，跟丢风险回归）。

### D8. 待办状态只由所有者推进

**决策**：模型可登记，不可改状态；状态推进只在管理面。

**理由**：待办的意义是"移交给人跟进"。若模型能自行标记完成，就回到了"agent 说做完了但没做"的老问题，且无法核实。登记是陈述事实（我收到了这个请求），改状态是处置决定（这件事怎么了），两者信任级别不同。

## 数据模型草图

字段是设计草图，非最终 schema。

```text
shared_fact_ledger
  parentSessionId (PK)        台账归属，唯一
  createdAt

ledger_item
  itemId (PK)
  parentSessionId (FK)        所属台账
  kind                        本期恒为 'todo'；分区键
  createdAt / updatedAt

todo_item (kind='todo' 的条目内容)
  itemId (PK, FK)
  locusId                     来源标识，寻址用
  generation                  登记时代际，仅审计
  chatId / threadId?          回复去向
  triggerMessageId            原始消息，回跳与引用回复
  requestedBy                 请求人
  summary                     一句话归纳
  evidence                    登记时快照：定位/原因/建议
  status                      open | accepted | done | dropped
  statusChangedAt
```

索引：`parentSessionId → items`（台账读取）、`locusId → todos`（按来源聚合）、`status → todos`（管理面筛选）。

纯加表 additive 演进，不改存量行，遵循唯一 writer 与既有离线备份/迁移规则；三个表名均已核验与现存 20 个表（`tasks`/`invocations`/`snapshots`/`runs`/`skill_revisions`/`skill_selections`/`workspace_env`/`channel_config`/`chat_bindings`/`invocation_channel`/`loci`/`locus_indexes`/`locus_deliveries`/`locus_operations`/`locus_switch_notices`/`locus_permission_audit`/`collaboration_contexts`/`collaboration_context_revisions`/`inquiries`/`inquiry_results`）无冲突，`PET_DOMAIN_VERSION` 将从 14 升至 15。zod schema 须委托给纯解析函数并吞掉真实校验错误（复用 `inquiries` 表模式），不写成裸 `z.object`。

**实施中发现的联动点（任务 7.5）**：`PET_DOMAIN_VERSION` 有第二处独立定义——`scripts/migrate-state-version.mjs`，一个不 import `spec.ts` 的独立 CLI 脚本（原因见其注释：SQLite 后端以 `PRAGMA locking_mode = EXCLUSIVE` 打开，脚本需要在 DSH Host 停止时用 `node:sqlite` 直接操作数据库文件，不能依赖 TS 构建产物）。该脚本硬编码了自己的 `PET_DOMAIN_VERSION` 与 `RESTAMPABLE` 版本清单，注释明确要求"must match src/host/spec.ts"但没有自动化保证。**升级 `PET_DOMAIN_VERSION` 时必须同步更新这个脚本**，否则该脚本会继续把数据库 restamp 到旧版本号——`test/migrate-cli.test.ts` 会捕获这个不一致（本 change 实施中已发生并修复：脚本在改动前输出"target: 14"，`RESTAMPABLE` 未含 14，均已同步）。以后任何一次新的 additive 版本升级都应检查这两处定义是否同步。

## 工具面

三个 caller-bound 工具，全部零目标参数，Host 从实际执行会话解析：

| 工具 | 作用 | 拒绝条件 |
|---|---|---|
| 只读父会话查阅 | 读主会话已落盘历史 | 非 locus child、关联失效、宿主无冷读能力 |
| 台账读取 | 读同源已登记条目 | 跨源、关联失效、临时 subagent |
| `pet_locus_track` | 登记待办 | 无唯一 current Delivery、关联不可证明 |

三者均须注册在 **executor 的 scoped agent 上下文**。无 scope 会静默落 global 层，使普通会话看到这些工具——这是已在本仓库实机复现过的陷阱，实施时须有测试固定普通会话工具面不变。

## Risks / Trade-offs

- **[意图误判产生噪音待办]** → 权限模型保证误判不越权；管理面提供一键放弃；澄清机制降低模糊请求的误判率。接受噪音优于接受跟丢。
- **[只读查阅退化成提问路径]** → 实现上禁止任何向主会话投递的调用；测试须证明主会话运行槽与待处理队列在查阅期间不变。这是 D3 的分界线，须有专门测试。
- **[查阅结果被误当授权]** → 工具返回值与 prompt 都明确标注为对话事实；锚点写入仍只走所有者确认路径，与既有派生逻辑不相交。
- **[台账抽象抽错]** → 只承诺三件可验证的事，其余留给 kind；第二类条目出现时再上提共用语义，届时既有条目无需改写。
- **[跨 locus 读取扩大检索面]** → 台账只暴露结构化条目，不暴露对话历史与入口枚举；B037 记录的过度检索问题源于开放式历史检索，本设计不引入该面。
- **[证据快照过时]** → 明确标注为登记时刻事实，不自动刷新；所有者接手时自行核对。不做自动刷新是因为刷新需要重新执行排查，成本与收益不成比例。
- **[宿主缺冷读能力]** → 查阅工具以不可用呈现并说明原因，其余能力不受影响；不猜测、不降级为提问。
- **[存量部署升级后 Pet 整体降级]** → `PET_DOMAIN_VERSION` 14→15 使存量数据库版本戳与 descriptor 不符，Pet fail closed 降级、全部路由不注册（不只是新功能不可用）。缓解：见下方 Migration Plan 的停机迁移步骤。**这类风险只在真实存量环境暴露**——`tsc --noEmit`、`vitest`（含真实 Domain 事务，但用的是每次新建的内存 medium）、仓库级 `npm test` 与 `check:artifacts` 全绿也不会发现它，因为它们都不面对一个「已经盖着旧版本戳的真实数据库」。任何后续改动 `PET_DOMAIN_VERSION` 的 change 都应把「在有存量数据的环境实际部署一次」列为验收项，而不是只依赖测试套件。

## Migration Plan

表结构是纯增量（additive），不改写任何存量行；但 **`PET_DOMAIN_VERSION` 从 14 升至 15，因此存量部署必须执行一次显式的离线迁移**，且该迁移**要求停机**。

> ⚠️ 本节早先写作「纯增量，无破坏性变更，**无数据迁移**」，这是错的，已在实机部署时被证伪：Pet 在 `storageDomain.open` 检测到 medium 仍盖着 v14 的版本戳与 descriptor v15 不符，按既有 fail-closed 设计降级，日志为
> `[dsh-pet] degraded: Pet storage domain: kv unit 'dsh_pet' is stamped version 14 on the medium, incompatible with descriptor version 15`。
> 这是正确行为而非缺陷——但「代码正确」不等于「存量数据库已迁移」，本节此前混淆了这两件事。

**存量部署的升级步骤**（必须按序，且 2–3 步必须在 DSH 停止时执行）：

1. `dsh build`：物化新代码（此步不动数据库）。
2. `dsh stop` → `dsh-pet-migrate-state --dry-run`：确认识别到 `14 → 15`。数据库被 Host 以 `PRAGMA locking_mode = EXCLUSIVE` 独占持有，脚本在 DSH 运行时会正确 fail closed 拒绝（`✗ Pet database is locked`），不会半途写入。
3. `dsh-pet-migrate-state --yes`：脚本先备份为 `state.sqlite.v14.bak-<时间戳>` 再改戳，v14→v15 只改 `units.version`，不转换、不清空、不重写任何行。
4. `dsh`：重启后 Pet 正常加载，两张新表由存储后端在下次 open 时创建。

**全新部署**无需任何迁移：首次 open 直接按 v15 建库。

**回滚**：移除工具注册与视图即可回到旧行为；已登记待办作为历史数据保留，不自动删除。注意版本戳一旦升到 15 就不会自动降回 14，回滚代码时若需同时回退数据库版本，应从第 3 步产生的备份恢复，而不是手工改戳。

## Open Questions

- 证据字段的结构化程度：自由文本，还是约定的定位/原因/建议三段？本期倾向自由文本加长度上限，待真实使用后再判断是否需要结构化。
- 待办是否需要所有者手动新建（而非仅由子会话登记）？当前不做，但管理面布局应为其留位。
- 同一请求被多个子会话重复登记时的去重：本期不做自动去重，靠管理面按来源聚合让所有者自行判断。
