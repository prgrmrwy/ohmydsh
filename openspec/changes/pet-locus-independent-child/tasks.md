## 0. 已完成的独立 child 诊断

- [x] 0.1 核对部署 Host 的 spawn provider 注册、`inheritsParentContext=false`、silent settlement 能力与 provider 字符串透传路径
- [x] 0.2 确认默认 provider 独立性不可证明时必须 fail closed，显式 provider 覆盖保持既有语义
- [x] 0.3 用固定 runtime probe 证明 spawn 初始化为空、没有父 transcript 前缀，且 caller-bound lineage 保持正确

## 1. 已完成的独立 child 实现

- [x] 1.1 将 `DEFAULT_CHILD_PROVIDER` 改为 `spawn`，覆盖普通创建、idle 创建和显式重建的共享默认路径
- [x] 1.2 创建前核验默认 provider 的 `inheritsParentContext === false`，无法证明时返回稳定 `independent-context-unproven` 并拒绝创建
- [x] 1.3 保持显式 provider 覆盖和旧 child 历史不变，不增加 context mode/schema 兼容字段
- [x] 1.4 增加默认创建、idle 创建、重建、显式覆盖及 fail-closed 测试；固定 runtime probe 验证 `isSeeded=false` 与零继承事件

## 2. 已完成的首次回复出口诊断

- [x] 2.1 用真实首轮 claim 序列修复 Host 注入上下文被误判为参与者流量的问题，并保持 GUI/user/未知来源 fail closed
- [x] 2.2 修复 claim 先于 `bindQueued` 的结构性竞态：暂时 unresolved 不置永久 mixed fuse，绑定可证明后恢复原 turn proof
- [x] 2.3 将 `agent-message` 定义并实现为非路由上下文：同 turn 不撤销已有 Delivery，无 Delivery 时也不产生回复能力
- [x] 2.4 增加 observer/reply-tool 回归，覆盖 Delivery claim→agent-message→reply、standalone agent-message、GUI steer、未知来源和第二 Delivery
- [x] 2.5 首次完整本地验证通过：Pet typecheck/test/build、仓库 test/artifact check、diff check 与 OpenSpec strict；首次 `dsh build` 后第二次同步无变化

## 3. 第二次真实验收与设计修正

- [x] 3.1 重启既有 DSH Host 并确认部署产物包含 `agent-message` 分类修复
- [x] 3.2 在真实答疑群复现跨 turn 失败：Delivery turn 问父后结束，父回答在后续 turn 到达，`pet_locus_reply` 因原 Delivery 已结算被拒绝，飞书无正文
- [x] 3.3 解码 child 多帧 zstd 日志并确认精确顺序；记录 `turn/end` 不能等同 Delivery 完成，且 DSH `next-step` 会与下一条 `next-turn` 合批的事实
- [x] 3.4 与所有者确认新边界：每 locus 单 current Delivery、统一 finish、相对 wait、接收起 24 小时硬上限、超时复用同一 child session；`/new` 与 send-message pair 延后

## 4. Delivery 持久状态与原子不变量

- [x] 4.1 为 Delivery 增加 additive 持久字段/状态：接受顺序、current/backlog、deadline、finish outcome 与 outbound result；`PET_DOMAIN_VERSION` 已到 14，未知版本 fail closed（既有 `migrate.test.ts`/`migrate-cli.test.ts` 57/57）
- [x] 4.2 实现每 locus 至多一个 current 的事务不变量，以及 accepted/queued→current、current→finishing/no-reply/expired、finishing→replied/failed/unknown-terminal 的 CAS 转换（`delivery.ts`/`persistence.ts`）；`claimCurrentDeliveryMutation`/`claimCurrentDelivery` 均严格按接受序选取，显式非最旧 `deliveryId` 返回 `not-oldest` 而不越序
- [x] 4.3 保持平台 `messageId` 幂等接受（重复消息返回原不可变记录）；`markDeliveryFinishing`/`completeCurrentDelivery`/`expireCurrentDelivery` 均以 `expectedRevision` CAS，迟到或重复调用只能在原 current 上一次性终结，不能作用于后继 Delivery
- [x] 4.4 增加纯状态机（`locus-delivery.test.ts` 19/19，含显式 FIFO leapfrog 拒绝、CAS 一次性竞争、exact-deadline 边界）与真实持久 repository 测试（`locus-persistence.test.ts` 33/33，含 accepted 绑定后必须变为 `queued`、显式非最旧 durable 拒绝、重复 inbox id fail closed）。未覆盖：多进程/两个 repository 实例并发写入同一 SQLite 文件的显式竞争测试（当前 repository 文档声明为单写者，未验证跨进程 CAS）

## 5. 串行 dispatcher 与租约调度

- [x] 5.1 intake 改为先持久接受（`acceptDelivery`）；只有通过 `deliveryDispatch.claimCurrent` 成功 CAS 后才物理投递给 child，其余消息保持 `accepted`/`queued` 留在 backlog；生产 `LocusControllerDeps.deliveryDispatch` 为必需依赖，无回退的 eager 兼容路径
- [x] 5.2 已从业务终结移除 `turn/end` 语义：controller `observe()` 对 `completed`/`failed` 事件只记录诊断（`settlement-ignored`），不再调用任何 settle/complete API；唯一终结入口是 `pet_locus_finish` 对应的 `markDeliveryFinishing`/`completeCurrentDelivery`
- [x] 5.3 实现统一幂等 `LocusChannelController.dispatchNext(correlation)`：CAS 声明 current 后按同一 queue/bind/observer 流程物理投递；`finish`（`finishAndAdvance`）、deadline 到期（`scheduleCurrentDelivery` 的定时器）、定义性 queue 拒绝（`definitiveQueueFailure`）与启动恢复均调用同一入口；backlog 声明时用持久 `acceptedAt+24h` 硬上限跳过已过期项
- [x] 5.4 实现持久 deadline 驱动的内存 scheduler（`index.ts` 的 `scheduleCurrentDelivery`）：默认 `acceptedAt+1h`，到期后走 `expireCurrentDelivery` CAS，成功后调用 `finishAndAdvance` 推进；复用同一 child session，不新建/不清历史。**已知缺口**：expiry 路径没有对仍在运行的 Agent turn 做任何 interrupt 尝试（无可用 runtime 中断接缝），只依赖 CAS 撤销 finish 能力，符合 design.md 已记录的风险取舍（"超时 interrupt 不立即停止旧 run"），但不满足"尽力 interrupt"这半句的字面实现
- [x] 5.5 测试覆盖：A current 时 B 只入 backlog 不进 DSH inbox（`locus-controller-races.test.ts`/`locus-settlement-integration.test.ts`）、A 完成后严格按接受序投递 B（`dispatchNext` 专项测试与端到端集成测试）、定义性 refuse 后仍推进 backlog。**未覆盖**：deadline 到期的定时器路径本身（`scheduleCurrentDelivery`/`setTimeout`）没有专项单测，只有其调用的 pure/durable expiry CAS 被测试覆盖；interrupt 失败场景因无 interrupt 实现而无法测试

## 6. 统一 Agent 工具与飞书发送

- [x] 6.1 `pet_locus_finish` 替换 `pet_locus_reply`：`reply`/`no-reply` 互斥 schema（`requireKnownArguments`/参数校验），拒绝任何路由 selector，无兼容别名（`PET_LOCUS_REPLY_TOOL` 已从生产源码整体移除）
- [x] 6.2 实现 `pet_locus_wait({ waitMinutes, reason? })`：正整数分钟、`1..1440`、可重复只延长；durable `waitDelivery`/`waitCurrentDelivery` 按 `min(max(current, now+wait), acceptedAt+24h)` 计算，重复声明不可越过硬上限（`locus-delivery.test.ts` 覆盖）
- [x] 6.3 finish/wait 共用 `resolveAuthorized`：要求唯一 active locus child、`locus.state==='active'`、generation/permission 精确、current 状态与队列位一致，否则 `INVALID_REQUEST`
- [x] 6.4 更新 Delivery prompt（`context.ts`）与 `pet_context`：显式说明 turn/`send_message`/assistant 文本不完成请求，`pet_locus_finish` 二选一语义，`pet_locus_wait` 相对时间与 Host 返回的期限/剩余分钟/是否触顶（`locus-context.test.ts` 14/14）
- [x] 6.5 strict Lark reply adapter（`channel/lark.ts` 的 `replyToTarget`）：群级/话题级均引用触发 `messageId`；话题显式传 `--reply-in-thread`；验证返回 `message_id`/`chat_id`。**已知缺口**：未验证返回的 thread/root 身份（适配器只检查 chat_id 回显，不核对话题归属），真实话题落位仍需人工验收
- [x] 6.6 reply 的 at-most-once 终结：`markDeliveryFinishing` 先 CAS 进入 `finishing`（并固化 `finishOutcome:'reply'` 避免 restart 时 schema 校验失败）；`larkClient.replyToTarget` 成功→`success`，抛出→`unknown`（当前适配器无法可靠区分"确定失败"与"结果未知"，保守全部归为 unknown）；`unknown-terminal`/重启遗留 `finishing` 均不自动重发
- [x] 6.7 工具与发送测试：参数互斥/无 selector（`locus-reply-tool.test.ts`）、错误 caller/no current（`resolveAuthorized` 校验路径）、wait 硬上限（`locus-delivery.test.ts`）、群/话题引用回复（`channel-lark.test.ts` 33/33）。**未覆盖**：重复/迟到 finish 调用的端到端工具层测试（pure/durable 层已覆盖 CAS 竞争，但未从 `pet_locus_finish` 工具入口发起两次并发调用验证）、发送确认丢失的工具层断言（已在 durable 层验证 `unknown-terminal`，未从工具返回值验证 `sent:false`）

## 7. 跨 turn 来源安全与运行时集成

- [x] 7.1 `LocusTurnCorrelationObserver.currentCapabilityForChild`：原始 Delivery turn 存续期间或 current 存续期间由信任 `agent-message` 唤醒的后续 turn 均可用；`restoreCurrentCapability` 让启动恢复保留的 current 重新具备来源证明
- [x] 7.2 继续拒绝：GUI/user（`isNonRoutingContextClaim`/`sourceKind!=='user'`→foreign/mixed）、来源缺失/未知、standalone agent-message（无 retained current 时 `claim-agent-context` 诊断且不授权）、第二个 Delivery（`mixed` fuse）、非 active child/旧 generation/terminal Delivery（`resolveAuthorized` 校验）
- [x] 7.3 旧 A 的迟到 finish：`loadCurrentDelivery` 精确比对 `deliveryId`/`status==='current'`/`queueState==='current'`，A expired 后旧调用命中 `INVALID_REQUEST`，不能发送到 A/B，不能终结 B（`locus-delivery.test.ts` 的 finish-vs-expiry 一胜竞争覆盖 pure/durable 层；`locus-reply-tool.test.ts` 覆盖工具层拒绝）
- [x] 7.4 使用真实 `createLocusTurnObserver`/`LocusChannelController`（非纯函数替身）的集成测试覆盖：Delivery claim→agent-message 唤醒→原目标 finish（`locus-reply-tool.test.ts`）、Host 首轮注入不被误判为参与者流量、GUI steer 混入不消费 current（`locus-context-repository.test.ts`）、claim 先于 `bindQueued` 的结构性竞态（`locus-settlement-integration.test.ts` 的 end-before-bind 用例，真实延迟超过历史 200ms 轮询窗口）。**未覆盖**：`next-step`/`next-turn` 合批边界的运行时级验证（依赖真实 DSH inbox 语义，本地测试只能模拟claim/end事件顺序，不能证明真实合批行为）

- [x] 7.5 补齐 child→parent 的父侧回复指引（真实验收暴露的阻塞缺陷，非计划内）。上游 `continuableInitialPrompt` 只单向告诉 child「你的 parent id 是 X，用 `send_message` 回结果」；父侧收到的却是裸的 `Agent <id> sent a message:`，既无可回复的 agent id，也无「普通 assistant 文本不会送达」的说明。父用文本作答即**静默失败**：父认为已答复，child 等到租约超时后被迫 `no-reply`。这使本 change「child 不 fork 父历史、缺上下文就问父」的前提不成立，故在 `settlement-notice.patch` 中对称补齐：新增 `parentFacingAgentMessage` 并只用于 `sendToParent`（child→parent），`steer`（parent→child）保持原 `agentMessage` 不变，避免把「回复我」注入父对子的转向消息。已更新 `build.mjs`/`build-launcher.cjs` 记录的 patch sha256 与 `compat/subagent/README.md`；从 pinned commit 全量重建通过（含 descriptor 能力探针）

## 8. 启动恢复与故障窗口

- [x] 8.1 `reconcileStartup` 在 intake 开启前运行：`current`/backlog 各自超过 `acceptedAt+24h`（current 另受 `min(deadlineAt, hard)` 约束）→`expired`；遗留 `finishing`→`unknown-terminal` 且不重放发送；未过期 `current` 按精确 locus/generation/child/endpoint 身份保留（不要求开放 turn）；无 current 时 `index.ts` 的启动 dispatch 循环对每个有 backlog 且无 current/无 in-flight legacy 行的 locus 调用一次 `dispatchNext`
- [x] 8.2 恢复只复用持久记录中的同一 child session；`queued`/`running` 只在精确 `deliveryProof`（`executionId`+`turnId`+`state:'running'`）匹配时保留为 `running`（不促成 `current`，避免与同 locus 真实 current 行冲突）；无法证明 locus/generation/child/endpoint 一致时标记 `startupRecoveryDebt` 并阻塞该 locus 的后续 backlog 派发，不新建替代 session、不猜 FIFO
- [ ] 8.3 未实现：accept/current dispatch/bind、finish CAS/飞书调用/结果落账、expiry/interrupt/next dispatch 各崩溃窗口的系统性 fault-injection 测试矩阵。现状：仅有 provisioning 相关的 `failOnWriteNumber` 崩溃窗口测试（`locus-persistence.test.ts`），未针对 Delivery finish/dispatch 路径做等价的中途失败注入
- [ ] 8.4 未做独立验证：重启不重复投递 current（`claimCurrentDeliveryMutation` 的 occupancy 检查理论上防止，但无重启后 double-dispatch 的专项回归）、scheduler 到期与 normal completion 并发只推进一次（两者共用同一 `withLocusDispatchLane`/`enqueueDispatchLane` 串行化，但无显式并发竞争测试证明）

## 9. 文档明确延后项

- [x] 9.1 已在 `docs/notes/pet-locus-independent-child-handoff.md`「2026-03-24 第二轮范围收敛」记录：`/new`/`skip` 只保留为未来同 session 的重清理逃生设计，本期不注册命令，也不预先锁定未超时项和 backlog 的清理范围
- [x] 9.2 已在同一节记录原生 `send_message` pair/correlation 为可选后续 change：只有 runtime 提供不可伪造 metadata/可信接缝时才实现，不以 sender、正文、时间或最近询问猜关联；已记录迟到父消息影响后续 turn 的已知低概率语义风险
- [x] 9.3 已在同一节明确完整 B035 公共事实/inquiry/answer store/result outbox/continuation segment 继续暂停；确认本轮未改动 `host/collaboration/*`、`host/inquiry/*`（仅 `effect-fence.ts` 禁止工具名单同步重命名），不声称满足 G3/G4/G5

## 10. 完整验证、部署与真实验收

- [x] 10.1 `npm run typecheck --workspace=dsh-pet` 通过；`npm run build --workspace=dsh-pet` 通过（含 `build:host`/`build:client`）；Pet 全量 `npx vitest run`：2333 passed、31 skipped、11 failed——11 项失败经 `git stash` 与干净 HEAD 逐条比对，与本 change 引入的代码改动无关，是先于本 change 已存在的 `dsh-scope`/`ToolRuntime` 工具可见性基础设施缺陷（影响 `collaboration-assembly.test.ts`/`collaboration-tool-scope.test.ts`/`inquiry-tool-scope.test.ts`/`tool-scope.test.ts` 中与本 change 无关的用例），未在本 change 范围内修复
- [x] 10.2 仓库 `npm test`：124 passed、1 skipped、0 failed；`npm run check:artifacts` 通过；`git diff --check` 通过；`openspec validate pet-locus-independent-child --strict` 通过
- [x] 10.3 `dsh build` 与 Host 重启已由所有者执行多轮。最后一次（2026-09-15 04:32:51）因 `settlement-notice.patch` 变更使 fingerprint 失效而全量重建 compat 链，启动日志 `fingerprint=a6b04505…`（原 `84bb545f…`），Pet 正常 `ready — routes registered`、无 `degraded`，`/dsh-pet/api/locus` 返回 401（鉴权墙）而非 404。**过程中暴露并修复两个真实缺陷**：(a) `expired` 行禁止携带 `outboundResult`，但 `acceptDelivery` 接受时即写入 `'none'`，导致任一 Delivery 过期后下次重启 domain 校验失败、Pet 整体降级且路由消失；(b) `waitDelivery` 把「请求期限已被现有租约覆盖」误判为 `deadline-expired`，使租约前半程内正常的延长请求必然失败。两者均已修复并各配反向验证过的回归测试
- [x] 10.4 真实群验收通过（`delivery-13`，2026-09-15 04:33:59，群 `oc_b1fa0f02…`）：独立 child 跨 turn 问父后经 `pet_locus_finish(reply)` 回复原 `@bot` 消息，终态 `status=replied`、`finishOutcome=reply`、`outboundResult=success`、`revision=3`（claim→finishing→replied 完整 CAS 链）。主会话未被自动灌入 child 结论。**此项一度因第三个缺陷无法通过**：DSH 原生只给 child 注入 `continuableInitialPrompt`（「用 `send_message` 回父」），父侧仅收到裸的 `Agent <id> sent a message:`，既无可回复的 agent id 也无「普通 assistant 文本不会送达」的说明，父用文本作答即静默失败、child 等到租约超时后被迫 `no-reply`（`delivery-10`/`delivery-11` 的 `outboundDiagnostic` 即为此证据）。已在 compat patch 中对称补齐（见 7.5），补齐后父侧自带指引，链路在无人工提示下自愈
- [x] 10.5 真实话题验收通过（`delivery-14`，2026-09-15 05:29:35，群 `oc_591324b6…` 话题 `omt_19cd829b840f5bee`）：终态 `replied`/`reply`/`success`，`endpoint.threadId`、`replyTarget.threadId`、`feedbackTarget.threadId` 三处一致，`turnId=session-19b894b4…#3` 证明话题持有独立于群的自己的 child。所有者确认回复落在话题内、群主时间线无泄漏；`im +chat-messages-list` 仅返回 5 条主时间线消息且不含该回复，`im +threads-messages-list` 显示该回复在话题内紧随触发消息。**验收标准更正**：原文要求「引用该 Delivery 的触发消息」，但平台数据显示话题内全部 7 条消息（user 与 app 皆然）的 `parent_id`/`root_id` 均为 `null`——话题内消息靠 `thread_id` 归属，飞书不建立逐条引用链，故「无引用」是平台特性而非缺陷，话题场景的正确判据是「同 thread 内紧随触发消息」
- [x] 10.6a 真实串行队列验收通过（`delivery-15`/`delivery-16`，2026-09-15 05:33:43 同秒到达同一 locus）：A 被 claim 为 `current`（`queueState=current`，有 `inboxMessageId`/`turnId`/`executionId`），B 停在 `accepted`（`queueState=backlog`，三项均为 `null`，完全未进入 child inbox）。A 于 05:34:23 finish，**B 的 `queuedAt=05:34:24`——比自身 `acceptedAt` 晚 41 秒且恰在 A finish 后 1 秒**，精确证明 B 是被 current 栅栏挡住、由 `dispatchNext` 在 A 终结后主动唤醒，而非自然排队延迟。两条复用同一 child session（`session-a380ee7b`，turn `#14`/`#16`），终态均 `replied`/`reply`/`success` 且 `queueState=null`；所有者确认飞书侧两条回复顺序与发送顺序一致
- [ ] 10.6b 未验收：`pet_locus_wait` 延长且不突破 `acceptedAt+24h`。难点是该效果在飞书界面不可见（只能查 durable `deadlineAt`/`revision`），且难以稳定构造 child 主动调用 wait 的真实场景；pure/durable 层已有测试覆盖含硬上限与 `deadline-already-sufficient`
- [ ] 10.6c 未验收：到期自动推进且不更换 child session。默认租约 1 小时且**代码中无任何可调短的环境变量或配置项**（`DEFAULT_DELIVERY_LEASE_MS`/`MAX_DELIVERY_LEASE_MS` 均为写死常量，`src/` 内唯一使用 `process.env` 之处是 `paths.ts` 的路径解析），所有者已确认不为验收临时改代码，故需真实等待 1 小时
- [ ] 10.7 回填 handoff/BACKLOG 的实际命令与证据，并与 `pet-unified-locus-collaboration`、`pet-locus-independent-agent-inquiries` 对齐归档顺序
