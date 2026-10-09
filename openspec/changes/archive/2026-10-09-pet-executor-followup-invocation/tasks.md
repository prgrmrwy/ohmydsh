## 1. 基线与实测门槛（先证明形状，再动实现）

- [x] 1.1 G1：在 DSH 0.2.0-rc.2 上实测 executor 会话的用户消息事件形状——确认 GUI 提交是否以 `agent/inbox/spliced`（或 `agent/inbox/claimed`）携带完整 UserMessage 先于 `turn/start` 到达、`rpcId` 是否随事件到达、`source.kind` 取值集合
  - 证据：`g1-evidence.md` §1。真实会话 `session-26ecffef-…` 中 splice(seq 74) 紧邻 `turn/start`(seq 75)、`turn 3`(134→135) 两次复现；GUI 提交 `source={kind:'user',rpcId,clientTimeZone}`，Pet envelope `source={kind:'user'}` 无 `rpcId`
- [x] 1.2 G1：枚举并记录宿主注入路径（时间上下文、记忆提醒、system-reminder、子代理结果）与渠道投递路径，确认它们是否可能同时带 `source.kind='user'` 与客户端请求标识
  - 证据：`g1-evidence.md` §2 §3。实测注入种类均为 `plugin:dsh-memex`/`time-context`/`agent-instructions`/`runtime-context`/`skill-catalog`/`skill-invocation`；源码侧 `kind:'user'` 生产者均不带 `rpcId`。唯一另一个 `rpcId` 生产者是 `dsh-subagent.prompt()`，但它只投递给父会话的 continuable child，而 root executor 从不是该目标——因此判据不只看 `rpcId`，必须叠加“目标会话是未归档 Task 的 root executor”
- [x] 1.3 G1：确认 Pet 自身派发路径（`PromptDispatcher.dispatch` 的 `createUserMessage`）与 `coordinator.answer` 的答复消息在事件层可与 GUI 提交区分；记录判定依据
  - 证据：`g1-evidence.md` §1 §4。Pet envelope 为 `{kind:'user'}` 无 `rpcId`（seq 5）；宿主自家判据 `hasPromptRequest` 同样以 `'rpcId' in source` 识别客户端提交
- [x] 1.4 若 G1 任一结论不支持“可证明的真人消息”，把结论写回 design，并把本 change 的登记路径降级为不可用（保持空闲诊断），不弱化 fail closed 语义
  - 结论：降级分支**不触发**——判据可证明（`g1-evidence.md` §6）；`rpcId` 非唯一性已通过叠加会话身份条件覆盖

## 2. 会话内直输 Invocation 的识别与登记

- [x] 2.1 在 executor 会话观察者中实现真人直输识别：只接受满足 G1 判据、且不为 Pet 派发簿记所拥有的消息；其余（宿主注入、渠道投递、locus/qa-child 会话）一律跳过
- [x] 2.2 实现登记触发：串行槽空闲时在消息入队后立即登记；槽被占用时不登记，由该消息自己被 claim 的那一轮重试（`agent/inbox/claimed`），不抢占当前调用
- [x] 2.3 推迟登记改由 `agent/inbox/claimed` 承载（取代原 `turn/start` 方案）：该事件精确报告本轮消费的消息；槽仍被占用或 Task 已归档则不登记
- [x] 2.8 竞态：`turn/end` 的结算异步落库，下一轮消息的 claim 可能先到。Host 为每个会话维护状态投影尾巴，登记前先等待其落库再判断槽位（`FollowupDeps.settled`）；仍在进行的轮次（steer）没有待落库的结算，因此仍被正确留给持有该轮的 Invocation。竞态测试经变异验证（去掉等待即失败）
- [x] 2.4 实现 `PetCoordinator` 的会话内直输登记入口：追加 `capabilityId: session-message` 的 Invocation（无 Skill、无 envelope 派发），直接以 `running` 落库并写入 run 记录，同时把用户文本存为 `request`
- [x] 2.5 幂等与去重：同一条消息不得登记两次（splice 与 claim 双路径、重放的事件、Pet 自己的派发都必须收敛到“只登记一次或零次”）
- [x] 2.6 串行与结算复用：确认 `isSlotFree`/`findCurrentInvocation` 把会话内直输 Invocation 当作唯一 current；`turn/end` 的 succeeded/cancelled/failed 映射与 `pump` 排队行为不变
- [x] 2.7 `retry` 语义：对失败的会话内直输 Invocation 按既有对话式路径重新派发同一条 `request`，复用同 snapshot，不新建 snapshot
  - 覆盖场景：会话内直输 Invocation 占用串行槽且面板可见 / 运行中到达的真人消息不抢占当前调用 / Pet 自身派发与答复不重复登记

## 3. 来源快照重建（Task 固定来源）

- [x] 3.1 实现由 Task 记录驱动的来源重建：`session` 形态取持久 header（title/cwd/asOfSeq）并复用既有 worktree/SCM provider enrichment
- [x] 3.2 实现 `workspace` 与 `none` 形态重建；`none` 不伪造 source，沿用独立来源标识
- [x] 3.3 实现 `chat`（workspace-resident）形态重建：与 `acceptConversation` 同形（chat 来源 + resident workspace id/title + workspace path），且不创建渠道回复目标
- [x] 3.4 来源事实无法重建（workspace 消失、session 已删除、来源 id 缺失）时拒绝登记并走空闲诊断，禁止退化为无来源快照
- [x] 3.5 断言目标不可改绑：消息文本中的 session/workspace/worktree 标识不参与解析（以正文带其它标识的用例覆盖）
  - 覆盖场景：会话内直输的发起位置 / 会话内直输不得改绑目标

## 4. 可信上下文的空闲语义与竞态兜底

- [x] 4.1 实现“登记进行中”的 in-flight 记录与有界等待：`pet_context` 解析前等待该会话的登记完成；完成则返回该 Invocation，超时/失败则回到空闲诊断
- [x] 4.2 空闲诊断细分三种情形（非 Pet Task 会话 / Task 已归档 / Task 当前空闲且本轮无 Invocation），且不返回任何 snapshot、路径或可被当作授权的值
- [x] 4.3 空闲诊断给出继续路径说明（从来源位置重新发起调用），并保持 `NO_CURRENT_INVOCATION` 作为空闲码
  - 覆盖场景：空闲期的可信上下文请求 / 登记进行中不报空闲 / 归档 Task 的 executor 再次调用

## 5. Standing instructions 与面板

- [x] 5.1 更新 `executor-instructions.md`：空闲期轮次归属规则、禁止沿用旧快照执行有副作用操作、继续路径说明、以 `pet_context` 返回的新 invocation id 为当轮依据
- [x] 5.2 更新 `executor-instructions.md`：需要用户决策时必须在调用内提问（`ask_user_question` / 等待批准），不得纯文本提问后结束调用
- [x] 5.3 面板显示会话内直输 Invocation：能力标识 `session-message` 的展示名、状态、失败重试入口与既有 Invocation 一致；空闲 Task 的提示与“本轮无 Invocation”一致
- [x] 5.4 确认 standing instructions 的复制/修复路径仍生效（`$DSH_HOME/plugins/dsh-pet/workspace/AGENTS.md` 由包内文件复制，不软链）
  - 结论：sync 部署后 `lib/` 与 `executor-instructions.md` 均为新内容；复制路径未改动，沿用既有“复制而非软链”实现
  - 覆盖场景：standing instructions 覆盖空闲期与调用内提问

## 6. 测试与回归

- [x] 6.1 回归测试：结算后的直输消息登记新 Invocation 且 `pet_context` 成功（复现 task-ecf66b4f 场景）
- [x] 6.2 识别排除测试：Pet 派发 envelope、`answer` 答复、宿主注入、渠道投递、qa-child、locus child 均不产生会话内直输 Invocation
- [x] 6.3 时序测试：入队即登记、槽占用时由 claim 重试、登记中 `pet_context` 等待、超时回到空闲诊断
- [x] 6.4 串行与结算测试：会话内直输 Invocation 占槽、排队能力在其结算后启动、`turn/end` 三种 reason 的结算映射、失败后 `retry` 复用同 snapshot
- [x] 6.5 快照重建测试：四种来源形态的字段正确性、来源缺失时 fail closed、正文标识不改绑
- [x] 6.6 运行 `packages/dsh-pet` 的测试与类型检查（package 内 build/typecheck/test 命令），确认无既有用例回归

## 7. 部署与验收

- [x] 7.1 `dsh build`（或 `node scripts/sync.mjs`）物化并验证连续第二次运行不产生变化（幂等）
  - 结论：`node scripts/sync.mjs` 部署成功，第二次运行输出 `no changes — deployment already matches manifest`。首次因 profile 的 `package.json.lock` 残留死 PID 导致 `pnpm add` 空转，清锁后重跑通过（已记入记忆）
- [x] 7.2 在真实 Host 上验收：重启后在 executor 会话直输消息，确认新 Invocation、`pet_context` 成功、面板显示、结算与归档语义正常；记录实际会话与 Invocation id 作为证据
  - 结论：2026-10-09 真机通过。会话 `session-f757eb9a-…`（Task `task-e92bbb86-…`）：`ws` 结算后 6 秒内的直输“再看一下刚才的结果”被登记为 `inv-68fd0b08-…`（`session-message`，`followupMessageId` 已记录）；该轮 `pet_context` 成功并返回新快照，模型继续使用快照路径调用 `ws`；Invocation 结算为 succeeded、Task 回到 idle。原 bug 的三次 `NO_CURRENT_INVOCATION` 未再出现
- [ ] 7.3 在 resident(chat) 形态的真实会话上验收（Q3）：确认普通项目工作被登记后的实际体验可接受，或按结论收窄适用范围并写回 design
  - 未验证，随归档带入已知限制：需要飞书群触发 resident(chat) 形态，本次未做。该形态的快照重建与“不创建回复目标”仅有单元测试证据（`in-session-followup.test.ts`）；若实际噪音过大，由后续 change 收窄适用范围
- [x] 7.4 运行仓库级校验：`npm test`、`npm run check:artifacts`；把结论与已知限制写回本 change，供归档使用
  - 结论：`packages/dsh-pet` 全量 2890 通过，host/client 类型检查通过，`check:artifacts` 通过，`openspec validate --strict` 通过。仓库级 `npm test` 有 7 个 `dsh-openspec` sync 用例失败（`tsc` 退出 127，环境问题），在不含本改动的基线上同样失败，与本次无关。已知限制：①7.3 未真机验证；②“结算与下一条消息秒回”的竞态只有单元测试证据（变异验证有效），真机验收时消息在结算后约 6 秒才发出，未覆盖
