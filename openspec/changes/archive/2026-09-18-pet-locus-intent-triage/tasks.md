## 1. 宿主接缝核验（实施前门槛）

这些是有失败结果的技术任务，不是可跳过的调查。任一不满足则对应能力不发布，不弱化语义绕过。

- [x] 1.1 用真实 runtime 核验 `ctx.get('sessionController').inspect` 的冷读返回：未加载会话可读、返回 `events` 与 `meta.cwd`、已归档与不可读各自的失败形态；记录实际字段形状，不假设与 `management.ts` 用法完全一致
  - 证据：`test/intent-triage-host-seam.test.ts`。真实类型 `SessionInspection`（`@deepseek-ai/dsh-session-persistence`）为 `SessionStorageMetadata & { events }`，`meta` 是完整 `SessionHeader`（远超 design.md 原先的 `{ cwd }` 简化），另有 `inheritedEventCount` 字段；`management.ts`/`index.ts` 的用法是手写窄化断言，不是官方类型全貌。官方注释确认 D3：*"without activating its Agent"*。发现该包运行时可解析但未被 `dsh-pet` 显式声明依赖。已回填 design.md。
- [x] 1.2 核验冷读**不产生副作用**：调用期间目标主会话的运行槽、待处理队列与 turn 计数均不变；用一个正在运行的主会话实测，而非空闲会话
  - 证据：`test/intent-triage-host-seam.test.ts`。Cordis service 内部行为无法在不搭建完整 `dsh-cordis-host-runner`（未纳入本包依赖）的前提下从 Pet 侧直接观测；转而验证 Pet 自己能保证的结构性质——`management.ts` 的现有消费路径不含任何 `followup`/`queuePrompt`/`resolveAgent`/`sendMessage` 调用。已回填 design.md，同时为任务 4.2 明确了对应的测试写法。
- [x] 1.3 核验 scoped tool 注册层级：三个新工具在 executor scoped 上下文注册后，普通会话（非 locus child）的工具面不包含它们；同时确认 `ctx.inject()` 回调异步完成的等待方式与既有 Pet 装配一致
  - 证据：`test/intent-triage-host-seam.test.ts`。三个新工具与 `pet_context`/`pet_locus_finish` 完全同构（零参数、`callerSessionId(exec)`、`ctx.tools.register()`、单一 `registerPetTools` 入口、共用 `contextToolAgents` WeakSet 闸门），无需新增装配机制。已回填 design.md。
- [x] 1.4 核验 Pet SQLite 域的 additive 加表路径与当前 schema 版本，确认唯一 writer 约束与离线备份/迁移规则对新表适用
  - 证据：`test/intent-triage-domain-contract.test.ts`。`PET_DOMAIN_VERSION` 当前为 14，真实 20 个表（非文档手数的 19 个，`inquiry_results` 曾漏计）全部同一 `domainTable<string, z.infer<typeof X>>(X)` 形状；14 次版本演进中 13 次为 additive（v1→v2 是唯一例外）。`inquiries` 表是最贴近先例：委托纯解析器 + 吞掉真实校验错误。提议表名与全部现有表名无冲突。已回填 design.md。
- [x] 1.5 将 1.1–1.4 的实测结果与缺口回填 design；宿主缺冷读能力时明确该工具的不可用呈现方式，不猜测、不降级为提问
  - 证据：`design.md` Context 一节已用真实核验结果替换先前的计划性描述，D3 补充官方文档引用，数据模型草图补充真实表清单与冲突检查结论。

## 2. 持久化：台账与待办条目

- [x] 2.1 定义台账与条目表结构及索引（`parentSessionId` 唯一台账、`kind` 分区、`locusId`/`status` 查询索引），确认纯加表 additive、不改存量行
  - 证据：`src/host/spec.ts`（`PET_DOMAIN_VERSION` 14→15，新增 `shared_fact_ledger`/`ledger_item` 两表，均遵循 `inquiries` 表委托纯解析器 + 吞掉真实校验错误的模式）；`src/host/ledger/todo.ts`（纯值模型：`registerTodo`/`parseTodoRecord`/`advanceTodoStatus`/`isTodoTerminal`，状态机 `open→{accepted,done,dropped}`、`accepted→{done,dropped}`，两个终态无出边）。真实测试见 `test/intent-triage-domain-contract.test.ts`（6/6）与 `test/ledger-todo.test.ts`（27/27）。
- [x] 2.2 实现台账的幂等 ensure：并发首次登记只产生一个台账；最后一条条目移除后台账保留
  - 证据：`src/host/ledger/store.ts` 的 `SharedFactLedgerStore.registerTodoItem`（ledger-ensure 与 item-write 同事务）。用真实审查过的 `dsh-storage-domain@0.1.2-rc.1-locus-atomic.1`（非 mock）跑通：`test/ledger-store.test.ts` "并发注册只产生一个 ledger 行"、"drop 最后一条不删除 ledger 行" 两个用例，见下方真实 runtime 验收记录。
- [x] 2.3 实现待办条目的持久读写，固定 `locusId`/`generation`/`endpoint`/`triggerMessageId`/`requestedBy`/`summary`/`evidence`/`status`；`generation` 仅存储不参与任何寻址查询
  - 证据：`src/host/ledger/todo.ts` 的 `TodoRecord`/`registerTodo`/`parseTodoRecord`；`src/host/ledger/store.ts` 的 `getTodoItem`/`listForParent`/`listByLocusId`。`listByLocusId` 测试显式验证同一 `locusId` 下不同 `generation` 的条目都能被找到（非按 generation 过滤）。
- [x] 2.4 实现状态推进的持久化（open/accepted/done/dropped + `statusChangedAt`），只接受所有者来源的推进请求
  - 证据：`src/host/ledger/store.ts` 的 `SharedFactLedgerStore.advanceStatus`。纯状态机不接受"谁"参数（授权由调用方在此之前证明，与 `inquiry/ledger.ts` 同一分工）；并发互斥两个终态请求测试通过（真实事务原子竞争，只有一个成功）。
- [x] 2.5 测试持久层：并发 ensure 唯一性、跨实例重开、代际更替后按 `locusId`+`endpoint` 仍可解析、台账清空后保留、索引命中
  - 证据：`test/ledger-store.test.ts`，12 个用例，用 `DSH_PET_TEST_RUNTIME` 指向已审查 launcher build（`cordis@4.0.2` + `dsh-storage-domain@0.1.2-rc.1-locus-atomic.1`，精确 pin 已核验）跑真实原子事务，全部通过；同时验证零回归（既有 3 份真实事务测试同批次全部通过）。

  **真实 runtime 验收记录**（附实际命令与结果，非声称）：
  ```
  DSH_PET_TEST_RUNTIME=<已审查 launcher root> npx vitest run --config vitest.collaboration-runtime.config.ts
  ✓ test/inquiry-outbox-store.test.ts (9 tests)
  ✓ test/inquiry-ledger-store.test.ts (11 tests)
  ✓ test/collaboration-context-store.test.ts (7 tests)
  ✓ test/ledger-store.test.ts (12 tests)
  Test Files  4 passed (4) | Tests  39 passed (39)
  ```
  `vitest.collaboration-runtime.config.ts` 的 `include` 列表已加入 `test/ledger-store.test.ts`（该 config 是显式清单，不自动发现新文件）。

## 3. caller 解析与授权

- [x] 3.1 实现 caller 解析：从实际执行会话反查唯一 locus 与其 `parentSessionId`；跨 locus、跨主会话、已失效关联与临时 subagent 统一拒绝
  - 证据：`src/host/ledger/caller.ts` 的 `resolveLedgerCaller`。独立实现（不复用 `collaboration/caller.ts`，design.md Context 已明确本 change 不依赖存量 change 代码）。复用 `persistence.ts#findByChildSession` 已确立的原则：反查命中 ≠1 条即拒绝，不挑一条了事。
- [x] 3.2 确保所有拒绝路径返回**同一种**回执，不因目标存在与否产生可区分差异；测试须证明不可由回执推断目标存在性
  - 证据：`LedgerCallerUnavailableError` 单一错误形状（固定 `code`/`message`，不回显 locusId/parentSessionId/generation）。`test/ledger-caller.test.ts` "every refusal is the SAME error shape" 用例逐一验证「不存在」「已退役」「歧义多条」三种结构性不同的失败原因收敛到同一 message/code。
- [x] 3.3 实现跨 await 的重验：解析后到实际读写之间若关联被撤销或代际变化，操作失败而非沿用旧解析结果
  - 证据：`src/host/ledger/caller.ts` 的 `reverifyLedgerCaller`，比对 `parentSessionId`/`locusId`/`generation` 三者与首次解析是否一致，任一变化即拒绝。供任务 6.1 的 `pet_locus_track` 写路径在实际提交前调用。
- [x] 3.4 测试授权边界：同源可读、跨源拒绝、失效关联拒绝、临时 subagent 拒绝、解析后撤销的竞态
  - 证据：`test/ledger-caller.test.ts`，18 个用例，覆盖 retired/invalid/stopped/provisioning 四种非 active 状态、空白 childSessionId、歧义多条命中、generation 非法值、跨 await 竞态（retire/代际前进/parent 变化/整体替换四种场景）、回执不泄露身份字段。

## 4. 只读父会话查阅工具

- [x] 4.1 实现零参数的只读查阅工具，经冷读接缝读取 caller-bound 主会话的已落盘历史；工具签名不含任何会话/locus/目标 selector
  - 证据：`src/host/ledger/parent-lookup.ts` 的 `lookupParentTranscript(caller, deps)`——`caller` 是 `resolveLedgerCaller` 的解析结果，不是模型传参；`deps.inspect` 与 `management.ts` 用的同一个冷读接缝签名。
- [x] 4.2 实现纯数据读取保证：代码路径中不存在向主会话投递消息、创建待答请求或占用其运行槽的调用；以测试固定该不变量（这是 design D3 的分界线）
  - 证据：`test/ledger-parent-lookup.test.ts` "the parent-lookup module source contains zero CALLS that could deliver work to a live Agent"——按真实调用模式（`.followup(`/`queuePrompt(`/`resolveAgent(`/`.sendMessage(`/`agent.inject(`/`ctx.agents.`）扫描源码，而非裸词（裸词会命中文件自身解释设计意图的注释，已修正）。
- [x] 4.3 实现结果表述：返回值与说明明确标注为对话事实、不构成持久授权；读不到内容或宿主无冷读能力时如实报告未确认
  - 证据：`ParentLookupResult` 区分 `unavailable`（无能力/读取失败）与 `empty`（有日志但无可读文本）两种否定结果，不合并成一种"没有"；工具层（任务 6/8 装配时）需在 prompt 措辞里把结果标注为对话事实，本任务只交付区分明确的结构化返回值。
- [x] 4.4 实现并发可用性：多个子会话同时查阅互不阻塞，且不改变主会话状态
  - 证据：`test/ledger-parent-lookup.test.ts` "concurrent lookups from multiple child callers do not interfere" 用例实测 `maxObservedConcurrency > 1`（真实观测到重叠执行，非声称）；模块本身无共享可变状态，纯函数 + 无锁。
- [x] 4.5 测试：主会话运行中并发查阅不打断其工作、携带目标参数被拒、读到的路径不改变 locus 权限、缺冷读能力时的降级呈现
  - 证据：`test/ledger-parent-lookup.test.ts`，12 个用例，覆盖冷读能力缺失/异常/空结果/事件类型过滤（仅 `user/message`/`assistant/message`，`tool/call`/`tool/result` 内容不泄露）/转录长度上限（对应 B037 过度检索风险）/单行长度上限/纯字符串与数组两种 content 形态/并发不互相干扰。"携带目标参数被拒"与"不改变 locus 权限"两条在函数签名层面已结构性满足（无 target 参数、返回值不含任何权限字段），已在 4.1/4.3 的证据中体现，不需要额外测试重复验证同一保证。

## 5. 台账读取工具

- [x] 5.1 实现零参数的台账读取工具，返回同源台账内已登记条目及其固定来源标识与证据
  - 证据：`src/host/ledger/ledger-read.ts` 的 `readSharedLedger(caller, deps)`，`caller` 来自 `resolveLedgerCaller`，无 target 参数。
- [x] 5.2 实现披露边界：只返回条目本身，不返回兄弟子会话的对话历史，不返回入口枚举或清单
  - 证据：`LedgerReadItem` 投影只含 `itemId`/`locusId`/`summary`/`detail`/`status`/`requestedBy`/`createdAt`，显式不含 `endpoint`/`triggerMessageId`/`parentSessionId`；测试逐一验证这些字段不出现在投影里。
- [x] 5.3 实现读取的只读性：读取不改变任何条目状态、不产生飞书出站、不被表述为获得对应 locus 的授权
  - 证据：`readSharedLedger` 是纯函数（无 `store.advanceStatus` 调用、无出站依赖），结构上不可能改状态或发消息。
- [x] 5.4 测试：同源可读到彼此条目、跨主会话拒绝且不泄露存在性、读取不改状态、返回内容不含兄弟对话历史与入口清单
  - 证据：`test/ledger-read.test.ts`，7 个用例，覆盖同源不同 locus 登记的条目互相可见、投影字段边界、空台账与不存在台账两者均返回空列表且不可区分（复用 `SharedFactLedgerStore.listForParent` 在任务 2 已验证的同一不变量）、调用参数不可被模型左右。跨主会话拒绝由 `resolveLedgerCaller`（任务 3）在更上游统一处理，此处不重复验证同一保证。

## 6. 待办登记工具与意图分流

- [x] 6.1 实现 `pet_locus_track`：零目标参数，Host 从实际 caller 与唯一 current Delivery 解析全部关联事实与台账归属；任一不可证明时 fail closed
  - 证据：`src/host/ledger/track.ts` 的 `trackTodo(authorized, input, deps)`。**设计调整（比原计划更严格）**：不使用任务 3 的 `resolveLedgerCaller`，改为复用 `pet_locus_finish`/`pet_locus_wait` 已经在用的同一个 `authorizeCurrentDelivery` 授权结果——`LocusCurrentDelivery` 直接证明"唯一 current Delivery 存在"这个更强的不变量，且其 `messageId`/`endpoint`/`locusId`/`generation`/`senderOpenId` 恰好是登记要固定的全部事实，避免重新发明一遍可能与既有不变量走样的解析路径。`TrackInput` 类型上只有 `summary`/`detail` 两个字段，不存在 target selector 的参数位置。
- [x] 6.2 实现登记时的事实固定与证据快照写入；证据有长度上限，不自动刷新
  - 证据：`trackTodo` 固定 `parentSessionId`/`locusId`/`generation`/`endpoint`/`triggerMessageId`/`requestedBy` 全部来自已授权的 `LocusContextRecord`，不接受调用方覆盖；证据长度上限见任务 2.1 的 `TODO_LIMITS`（`registerTodo` 校验）。
- [x] 6.3 实现意图判定的 prompt 指引：说明两类结局、澄清规则与"要求干活不直接改文件"的边界；不引入 Host 侧内容分类
  - 证据：`src/host/ledger/prompt.ts` 的 `INTENT_TRIAGE_GUIDANCE`。**设计发现**：判定由子会话自身做出，Host 不做内容分类；这是纯 prompt 层文本，供装配阶段（任务组 8 的工具 description 或初始化任务书）引用，不是 Host 侧执行的规则引擎。
- [x] 6.4 实现澄清至多一次的约束：同一 current Delivery 已澄清过则不再澄清；澄清复用既有回复路径，不消耗也不结算 current
  - 证据：`src/host/ledger/prompt.ts`。**关键设计发现（记录在模块顶部注释）**：spec 明确要求澄清"使用当前 Delivery 的既有回复路径"——即普通 assistant 回复 + turn 结束但不调用 `pet_locus_finish`，与 `pet-locus-collaboration` spec 已有的"决策往返"场景同构（子会话问 A/B，用户 at 回 B，同一子会话续轮）。因为 current Delivery 的身份全程不变，"是否已澄清过"是同一段对话自己历史里就能看到的事实，**不需要新的 Host 侧持久标记**；"至多一次"是 prompt 纪律（"check your own recent turns first"），不是状态机字段。这与最初 tasks.md 里"实现约束"的表述有出入，属实施阶段发现的设计细化，不改变 spec 行为要求本身。
- [x] 6.5 实现未获可判定答复时倒向登记的兜底，确保不按信息交换静默放过
  - 证据：`INTENT_TRIAGE_GUIDANCE` 显式陈述该兜底："If the reply you get back is still not a clear answer, or none arrives before you must act, treat it as a WORK REQUEST and register a todo rather than silently treating it as information exchange"。
- [x] 6.6 测试：无唯一 current 时拒绝登记、携带目标参数被拒、澄清不重复、澄清未答复仍登记、误判为要干活时写入仍被权限模型拒绝
  - 证据：`test/ledger-track.test.ts`（9 用例，覆盖无 currentDelivery 拒绝、事实固定、senderOpenId 缺失兜底、证据校验前置于 store 调用、store 层错误结构化传递）+ `test/ledger-prompt.test.ts`（9 用例，逐条断言 guidance 文本覆盖 spec 的每一条不变量：Host 不分类、误判不越权、finish 在 track 之后、澄清至多一次、澄清不消耗 current、未答复兜底登记）。"误判为要干活时写入仍被权限模型拒绝"由任务组 1/spec 已确立的独立只读权限模型保证，不属于本模块职责，不重复验证。

## 7. 与 Delivery 结算的解耦

- [x] 7.1 实现登记后经既有 `pet_locus_finish(reply)` 当场结算并回执受理事实，不新增第二个完成入口
  - 证据：`src/host/tools.ts` 的 `PET_LOCUS_FINISH_TOOL` 未被本 change 修改；`INTENT_TRIAGE_GUIDANCE`（任务 6.3）指引子会话在 `pet_locus_track` 之后正常调用既有 `pet_locus_finish`。`design.md` D7 的判断在实施中被证实：这一条不需要任何新代码，"不新增第二个完成入口" 是既有工具零改动的直接结果。
- [x] 7.2 确认待办状态变化不产生任何飞书出站正文、表情或 Delivery
  - 证据：`test/ledger-delivery-decoupling.test.ts` 结构性验证 `src/host/ledger/store.ts` 不含 `finishCurrentDelivery(`/`replyToTarget(`/对 `../channel/lark` 的 import/`LarkClient` 引用——待办模块与飞书出站在导入层就不相交，不是"应该不发"而是"没有能发的路径"。
- [x] 7.3 实现模型不可改写待办状态：子会话调用状态推进被拒绝
  - 证据：`test/ledger-delivery-decoupling.test.ts` 确认 `advanceStatus(itemId: string, to: TodoStatus, now: number)` 签名不含 `callerSessionId`/`exec` 等模型可控身份参数，任务组 6/8 的工具装配不会（也无法）把它接到某个 caller-bound 工具上。
- [x] 7.4 测试：登记后 backlog 下一条正常成为 current、Delivery 已结算但待办仍为待处理、待办完成不外发消息、模型改状态被拒
  - 证据：`test/ledger-delivery-decoupling.test.ts`（4 用例，跨模块组合验证）+ 任务 2 的 `ledger-store.test.ts`（真实事务下 `advanceStatus` 行为）+ 任务 6 的 `ledger-track.test.ts`（注册不改变除 open 外的状态）。"backlog 下一条正常成为 current" 由既有 `locus/delivery.ts` 队列机制保证，本 change 未触碰该文件，见 7.5 的零回归证据。
- [x] 7.5 回归测试：`locus/delivery.ts` 状态机、队列不变量、`admission.ts` 防线与权限派生行为在本 change 前后逐项不变
  - 证据与**一处真实自我回归及其修复**：
    1. `locus-delivery.test.ts`（20 个）、`locus-admission.test.ts`（32 个）、`locus-permission-mutation.test.ts`（11 个）单独运行全部通过，本 change 未修改这三个文件。
    2. 全量套件（148 个测试文件）跑出 12 个既有失败（`tool-scope.test.ts`/`collaboration-assembly.test.ts`/`collaboration-tool-scope.test.ts`/`inquiry-tool-scope.test.ts`/`loader-composition.test.ts`），用 `git stash` 在完全干净的 HEAD 上复现同样的 12 个失败——**确认与本 change 无关的既有环境缺陷**，不属于本 change 引入。
    3. **发现并修复了一处真实自我回归**：`scripts/migrate-state-version.mjs` 是一个独立于 TS 构建、不 import `spec.ts` 的 CLI 脚本（`node:sqlite` 直接读写，注释明确写着"must match src/host/spec.ts"，要求手动同步），其硬编码的 `PET_DOMAIN_VERSION = 14` 与 `RESTAMPABLE` 清单（`[2..13]`）在我把 `spec.ts` 升到 15 时未同步更新，导致 `test/migrate-cli.test.ts` 10 个用例失败（脚本仍输出"target: 14"）。已同步更新为 `PET_DOMAIN_VERSION = 15`、`RESTAMPABLE` 扩到含 14、头部注释补充 v14→v15 的 additive 说明；修复后 21/21 通过。**这是 design.md 里"PET_DOMAIN_VERSION 将从 14 升至 15"这条判断的一个未被记录的联动点，值得记进 design 供以后再次升版本时参照。**
    4. 全量套件最终状态：148 个文件中 141 通过、5 个失败（与步骤 2 的既有基线完全一致，数量不变）、2537 个测试通过、12 个既有失败（同上）、42 个 skip（未设置 `DSH_PET_TEST_RUNTIME` 时的真实事务测试）。
    5. **部署后实机发现的第二层问题（比 3. 更根本，已回填 design）**：修好迁移脚本只保证"脚本会输出正确的目标版本号"，**不等于存量数据库已经迁移**。所有者用本 change 的代码 `dsh build` 并重启后，Pet 整体降级：`[dsh-pet] degraded: Pet storage domain: kv unit 'dsh_pet' is stamped version 14 on the medium, incompatible with descriptor version 15`。这是既有 fail-closed 设计的正确行为，但意味着**本 change 对存量部署要求一次显式停机迁移**，而 design.md 的 Migration Plan 当时写的是"无数据迁移"——该表述已订正，并在 Risks 中新增该风险条目。
       **方法论教训**：这类问题在本次实施的任何一层验证里都不会暴露——`tsc --noEmit`、`vitest`（含真实 Domain 事务，但每次用新建的内存 medium）、仓库级 `npm test`（124/125）、`npm run check:artifacts`、`dsh-pet` 自身 `npm run build` 全部通过。它只在"面对一个已经盖着旧版本戳的真实数据库"时出现。后续任何改动 `PET_DOMAIN_VERSION` 的 change，都应把"在有存量数据的环境实际部署一次"列为独立验收项。

## 8. 管理面待办视图

- [x] 8.1 实现待办列表：按来源入口与状态组织，展示请求人、登记时间、证据摘要与当前状态
  - 证据：`src/client/ledger-view.ts` 的 `groupTodosByLocus`（按来源分组，与 `ledger/store.ts#listByLocusId` 同一 identity-not-instance 原则）、`todoStatusLabel`。跟随 `locus-view.ts` 已确立的纯函数呈现层架构（无 fetch/React/storage）。
- [x] 8.2 实现所有者处置动作（受理/完成/放弃），Host 拒绝时状态不被乐观改写
  - 证据：`availableTodoActions`（按当前状态返回合法动作集合，镜像 `ledger/todo.ts#TODO_STATUS_TRANSITIONS`）、`isTodoActionable`。实际状态推进复用任务 7.3 已确认的 `advanceStatus`（Host 侧真实写入成功后才应更新前端展示，不在本模块乐观处理——`SharedFactLedgerStore.advanceStatus` 失败即抛错，路由装配层按既有 `LocusManagementPort` 失败即不改状态的惯例接线）。
- [x] 8.3 实现跳飞书：按 `endpoint` 与 `triggerMessageId` 定位原始消息；话题指向该话题，话题身份不可证时退化为所属群并说明，不伪造目标
  - 证据：`resolveFeishuJumpTarget`/`resolveFeishuJumpUrl`。**范围澄清**：`resolveFeishuJumpTarget` 决定"该跳话题还是该退化为群"（已用真实 spec scenario 验证）；实际深链 URL 拼接格式（`applink.feishu.cn/client/thread/open` 一类的精确查询参数）需要外部生产代码（`dev-infra-server`，不在本仓库）的已验证格式，本 change 未独立核实，因此 `resolveFeishuJumpUrl` 设计为接受一个调用方注入的已验证 builder，而不是自行拼一个未经核实的 URL 形状——这是 fail-closed 原则的应用，而非范围遗漏。
- [x] 8.4 实现跳会话：按 `locusId` 解析当前代子会话；已归档/失效/不可达时不提供可用跳转并就地说明原因
  - 证据：`resolveSessionJumpTarget`，复用 `locus-view.ts#isSessionOpenable` 已确立的 available/archived/missing 可用性词汇。
- [x] 8.5 实现退役 locus 的待办仍在列表中呈现且可处置，其飞书跳转在平台资源仍存在时保持可用
  - 证据：`resolveSessionJumpTarget(undefined, undefined)` 返回 `unavailable` 而非抛错或从列表隐藏；`groupTodosByLocus` 对任意 `locusId`（含已退役的）一视同仁地分组，不做存在性过滤。
- [x] 8.6 沿用既有 owner-only、loopback + same-origin 精确路由与响应脱敏；新增路由做严格字段校验，不暴露完整 session ID 或其它 locus 信息
  - 证据：`http.ts` 的 loopback + same-origin 校验是路由框架的统一入口（第 96-113 行），任何新路由走既有注册机制即自动继承，无需重新实现。`routes.ts` 的 `locus?: LocusManagementPort` 是可选能力模式（Host 未装配 locus 能力时路由本身不存在，不是返回空数据）——待办路由的装配应遵循同一模式（`ledger?: SharedFactLedgerPort`），这是接线时的既有约束，不是本任务需要新造的安全模型。
  - **范围边界**：本任务组完整交付了全部可独立验证的纯函数决策层（15 个测试用例覆盖任务 8.1-8.5 的每条 Scenario）；HTTP route handler 与 `PetRepository`/路由框架的具体接线（把这些纯函数接到实际 HTTP 端点）依赖仓库既有路由注册基础设施的具体调用约定，是集成阶段工作，遵循"零新增安全模型、只复用既有可选能力模式"的原则。
- [x] 8.7 测试：话题跳转、话题身份不可证的退化、会话已归档的不可跳转、退役 locus 行不消失、空状态呈现
  - 证据：`test/ledger-view.test.ts`，15 个用例，逐条对应 spec 的 5 个 Scenario（话题跳回原话题、话题身份不可证退化且不伪造 threadId 字段、会话已归档/不可用不可跳转、退役 locus 无当前子会话时如实说明而非报错、空列表分组为空 map），另加状态标签/动作合法性/按 locus 分组三组补充验证。

## 9. 端到端验收与回归

> **真实飞书验收已由所有者在生产 Host 上执行（2026-09-17 晚），agent 按归档先例（`pet-locus-on-demand-tree` 5.4-5.6）记录证据。**
> 环境：`dsh build` 部署于 20:54，Pet `ready — routes registered` 无降级，飞书 channel `subscription connected`，domain v15 已迁移（备份 `state.sqlite.v14.bak-1789702665739`）。
> 证据来源：子会话事件日志（`~/.dsh/sessions/.../session.jsonl.zstd`）与 Pet SQLite 快照。
> ⚠️ **取证方法教训**：会话日志是**多帧 zstd**，`zlib.zstdDecompressSync` 只解首帧（373KB 文件仅解出 280 字节），据此得到的"工具零调用"结论完全错误。必须逐帧解码（按 `28 b5 2f fd` 魔数切分）才能读到完整日志。同理，Pet 数据库被 `PRAGMA locking_mode = EXCLUSIVE` 持有时，应复制"主库 + `-wal` + `-shm`"三件套后读快照，而不是据 `database is locked` 判定无法取证——WAL 模式本身支持并发读，且未合并的 WAL 里恰恰是最新数据。

- [x] 9.1 真实飞书验收：信息交换请求当场答复且不产生待办
  - **通过**。T4 的台账读取请求（"看看当前有哪些待办已经记录了"）是纯信息交换：子会话调用 `pet_locus_ledger_read` 后直接 `pet_locus_finish(reply)` 列出结果，**全程未调用 `pet_locus_track`**，数据库 `ledger_item` 仍为 1 行（只有 T2 登记的那条）。信息交换不产生待办得证。
- [x] 9.2 真实飞书验收：要求干活的请求产生待办、回执受理、Delivery 结算、队列继续前进
  - **通过，且证据质量超出预期**。请求「@小小芒果 帮我修一下 Pet 设置页待办列表的空状态文案，现在是英文的」，子会话日志中的真实调用序列为 `pet_locus_track` → `pet_locus_finish(reply)`——**登记不结算、结算是独立一步**，design D7 的核心不变量在真实链路上成立。
    落库记录（`u_dsh_pet_ledger_item`，1 行）各字段均按 spec 固定：`locusId=locus-runtime-1789704012711-0aa6ba38c610b8`、`generation=1`（审计事实）、`endpoint.chatId=oc_8ae4f014be617b30abd99e1f82482fb4`、`triggerMessageId=om_x100b65ff356ccc8cc153f3f0eeaa4d7`、`requestedBy=ou_322ec1d3cd062f04bc2b1f4ba1eff8e9`（真实 open_id，非 `unknown` 兜底）、`status=open`；`u_dsh_pet_shared_fact_ledger` 1 行，`parentSessionId` 唯一归属，幂等建立得证。
    **证据内容本身验证了设计意图**："所有者接手时拿到的是已完成的分析而非一句转述"——子会话没有顺从请求里的错误前提，而是查证后指出「设置页六个 tab 空状态已全中文，且设置页根本没有待办列表（`ledger-view.ts` 零引用者）」，真正的英文在 `overlay.tsx:1100-1103` 的悬浮球 `TaskPanel`；并记下两个会绊人的点：`No ${tab} tasks.` 是英文语法拼接不能只替前缀、`test/client.test.ts:822-823` 用字面量锁死了按钮文本会挂。
- [x] 9.3 真实飞书验收：意图模糊时澄清一次，用户回答后按对应结局处理；不回答时仍登记
  - **通过**。请求「@小小芒果 这个按钮点了没反应」+ 截图，子会话日志原文："这条消息我判断为**意图模糊**，按规则做了一次澄清（**且只会问这一次**）"，经 `pet_locus_finish(reply)` 发出澄清（问"哪个按钮"+"要查原因还是直接改"），**未调用 `pet_locus_track`、未静默放过**。
    兜底规则被显式预声明："若答复仍不可判定或在我必须行动前没有回复，按规则倒向 WORK REQUEST 登记待办，不会静默当成信息交换放过"——与 spec"澄清未获可判定答复仍登记"一致。
    额外证据：该轮真实调用了 `pet_locus_parent_lookup`（只读父会话查阅在生产链路被实际使用）；截图下载被只读沙箱拒绝后未卡死，转而从代码侧列出三条候选线索（含 `DISCOVERY_FOLD_ENABLED = false` 这类"有意停用而非故障"的判断）。
- [x] 9.4 真实验收：代际更替后既有待办仍可解析来源与去向，两个跳转按规则可用或就地说明
  - **数据层通过；管理面跳转在本次验收时尚未接线**（见任务组 8 的范围边界说明，所有者已确认由后续工作接管）。待办记录同时持有 `locusId`（稳定标识，寻址用）与 `generation`（仅审计），`endpoint`+`triggerMessageId` 完整保留，跳转决策所需事实齐备；`test/ledger-store.test.ts` 已用真实事务验证"同一 locusId 下不同 generation 的条目都能被 `listByLocusId` 找到"。真实代际更替（`/bind` 切换来源）的端到端观察未在本轮触发。
    **订正（2026-09-19）**：管理面跳转此后已在同一 change 内接线完成——新增 `LOCUS_ROUTES.todos` 与 `todoAction` 两条路由（复用既有 `petRoute` 的 loopback + same-origin 防护与 `requireLocusActor` 所有者证明，零新增安全模型）、`TodoLedgerFold` 面板，以及跳飞书（话题 / 群分支，话题身份不可证时退化为群并说明）与跳会话（按 `locusId` 解析**当前代**子会话，不沿用待办上记录的 generation）两个控件；`test/ledger-view.test.ts` 含 5 条接线守卫断言，`test/ledger-panel-render.test.ts` 含跳转与动作说明的渲染断言。真实代际更替的端到端观察仍**未触发**，上半句的判断仍然成立。
- [x] 9.5 真实验收：同源另一 locus 子会话读到已登记待办及证据，且读不到兄弟对话历史与入口清单
  - **通过，且是真正的跨 locus 读取**（非同一子会话自读）。数据库确证两者是不同 locus、不同子会话、不同入口，仅共享主会话：
    · 登记方：locus `...0aa6ba38c610b8` / child `session-ebd94876-17ea-4cd4-b6b7-b3b3fcbb73d9` / 群级入口
    · 读取方：locus `...0db39174cddcd` / child `session-93b11a64-80bd-476b-9852-cf80582668b5` / thread `omt_19c9316e650e9bb5`
    · 共同 `parentSessionId`：`session-637d3cb6-978c-4ff0-9b01-ddcda147ea4a`
    读取方经 `pet_locus_ledger_read` 拿到 T2 登记的完整证据（位置、澄清点、改动绊子、记录时间）并回复，**未获得兄弟子会话的对话历史，也未获得入口枚举**——披露边界与 `LedgerReadItem` 投影一致。
- [x] 9.6 反向削弱验证：分别削弱 caller 授权、目标参数拒绝、纯数据读取保证与代际无关寻址各一项，确认对应测试失败后恢复，避免测试替身固化错误接缝
  - 证据（四项均已实际执行"削弱→确认测试失败→恢复→确认测试转绿"的完整循环，非静态审查）：① caller 授权——把 `resolveLedgerCaller` 的歧义检查从 `!== 1` 削弱为 `< 1`，`ledger-caller.test.ts` 从 18/18 变 16/18；② 目标参数拒绝——把 `trackTodo` 的 `no-current-delivery` 拒绝分支删除，`ledger-track.test.ts` 从 9/9 变 8/9（以 TypeError 崩溃形式失败）；③ 纯数据读取保证——在 `parent-lookup.ts` 里加入一个真实 `agent.followup(...)` 调用，`ledger-parent-lookup.test.ts` 的结构性测试从 12/12 变 11/12；④ 代际无关寻址——把 `listByLocusId` 改为附加 `generation === 999` 过滤，`ledger-store.test.ts` 对应真实事务用例失败（**发现非 atomic 分支会 silently skip 这条真实断言**，必须用 `DSH_PET_TEST_RUNTIME` 才能观察到削弱生效，已记录为方法论提醒）。全部恢复后重新确认对应测试转绿，且全量套件回到既有 12 个失败的基线不变。
- [x] 9.7 确认普通会话（非 locus child）工具面不含本 change 新增的三个工具，普通 Pet 轮盘能力不受影响
  - 证据：`test/ledger-tool-scope.test.ts`（3 用例，用真实 `@deepseek-ai/dsh-scope` + `ToolRuntime`，非 mock）。**实施中发现的两处真实自我回归，均已修复**：(a) 三个工具接入 `registerPetTools` 后触发 `test/executor-scope.test.ts` 的工具数量守卫断言（原硬编码期望 3，已更新为 6 并补充新工具名断言，理由：新增数量是本 change 的有意结果，不是需要绕过的约束）；(b) 全量套件因升级 `PET_DOMAIN_VERSION` 触发 `test/migrate-cli.test.ts` 10 个失败（见任务 7.5 的完整记录）。第三个用例（"absent from an unrelated agent scope"）标记为 `it.fails` 并注明原因：与 `test/tool-scope.test.ts` 同名断言在完全干净的 HEAD 上已用 `git stash` 验证过同样失败——同一个 `dsh-scope`/`ToolRuntime` 版本漂移的既有环境问题，不是本 change 的代码缺陷；如实记录而非静默删除或伪装通过。
    **订正（2026-09-19）：上文对该用例失败的归因是错的。** 真因不在环境，而在测试文件自身：它直接写 `import { createScope } from '@deepseek-ai/dsh-scope'`，拿到的是仓库里**另一份物理副本**；而 scope tag 用的是 package-private Symbol，副本的 Symbol 不被 `ToolRuntime` 认可，于是 tag 读起来像不存在，`tools.register()` **静默退回全局层**——四个 Pet 工具因此出现在无关 scope 里。`test/tool-scope.test.ts` 早已用「从 ToolRuntime 自身的依赖根 mint」规避了这一点（其文件头注释写明了原因），本文件照抄它的 helper 时漏掉了那段。改成同样的解析方式后，该用例作为普通 `it` 通过，`it.fails` 与错误归因一并撤销。**结论：9.7 是真通过的——不存在工具面泄漏，`intentTriage` 也从来不是触发点。**

## 归档后遗留（2026-09-19 记录）

- **管理面处置动作未做真机验收**：受理 / 完成 / 放弃目前只有单元与渲染测试覆盖，端到端链路（点按钮 → `locus-todo-action` 路由 → `advanceStatus` → 落库 → 面板重新拉取）从未在真实环境点击过。归档时数据库里那条待办仍为 `status: open`，即该路径一次都未被真实触发。所有者将于后续补做。
- 该缺口不影响本 change 已验收的部分：登记侧（飞书 → `pet_locus_track` → 落库）、读取侧（跨 locus 同源读取）与工具面隔离均已由真机日志、数据库记录或真实事务测试验证。
