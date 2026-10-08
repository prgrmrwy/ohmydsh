## 1. 前置核验（写码前完成，结论回写 design）

- [x] 1.1 核验 Host 能否判定"某主会话是否被 brief 过 standby"：若无直接记录，确认 `mainSource === 'auto'` 是当前唯一等价判据，并在实现注释中写明它是代理指标（design D4）
- [x] 1.2 核验 `ctx.agents.get(sessionId)` 返回句柄上 `status` 与 `followup` 的实际可达路径（参考 `index.ts:672` 的 `liveAgentScope`、`:1535` 的 executor 投递），确认判忙与投递可在同一处完成
- [x] 1.3 核验 `ctx.agents.resume` 冷恢复一个**非 Pet 自建**主会话所需的最小参数（参考 `index.ts:1479`），确认不需要 Pet 专属 setup；若需要，据此收敛 D9 的 `unreachable` 判据
- [x] 1.4 核验新工具在 `composition.ts` 白名单与 `attestLocusComposition` 下的注册方式，确认与 `pet_locus_track`（`composition.ts:54`）同层

## 2. 共享测试脚手架（先于一切实现）

- [x] 2.1 在 `packages/dsh-pet/test/todo-dispatch.test.ts` 建立假 `TodoDispatchPort`，记录 `resolve`/`resume`/`followup` 的**调用序列**（不只是结果）——"投递前被拒"类断言依赖"端口从未被调用"，只看返回值无法区分拒绝时机
- [x] 2.2 建立待办 fixture 工厂，可构造 `open`/`accepted`/`done`/`dropped` 四种状态及含恶意证据的变体

## 3. 执行目标解析（D3）

- [x] 3.1 写失败测试 `dispatch never targets the child nor mutates permission`（test-plan 第 10 行），断言解析结果为主会话且无任何权限档位写入；确认因解析函数不存在而失败
- [x] 3.2 实现执行目标解析纯函数：输入待办已固定的归属事实，输出执行目标；本期唯一规则为"登记方无执行能力 → 转交主会话"，零 selector，不可证明时 fail closed
- [x] 3.3 重构：确认解析不被任何调用方旁路，全量套件保持绿

## 4. 跟进正文组装（D4 + D8）

- [x] 4.1 写失败测试：`body states itemId requester time endpoint and evidence`、`body marks evidence as registration-time snapshot`（test-plan 第 2–3 行）
- [x] 4.2 实现正文组装纯函数（独立于 `composeLocusMainBriefing`，不复用其文案——两者意图相反）
- [x] 4.3 写失败测试：`evidence is final section with no trailing host text`、`evidence section has start marker and no end marker`、`body declares evidence as third-party input`（test-plan 第 4、5、7 行）
- [x] 4.4 实现指令段/证据段结构：证据为正文最后一段、其后无任何 Host 文本、只有起始标记无结束标记、全文至多一个证据段
- [x] 4.5 写失败测试 `forged delimiter stays inside the evidence section`（test-plan 第 6 行），用例覆盖伪造起始标记、Markdown 代码围栏、形似段落结束的文本；**断言对象是"文本仍位于末段内且指令段字节不变"，不是"模型没有照做"**（D8 三层定位）
- [x] 4.6 实现使上述用例通过；`requestedBy` 来自 `senderOpenId`（`track.ts:71`）为平台事实，留在指令段
- [x] 4.7 写失败测试 `briefed main is told standby has ended` 与 `never-briefed main omits the standby-ended sentence`（test-plan 第 8–9 行）
- [x] 4.8 实现待命结束声明的条件分支，判据用 1.1 的结论；措辞写"待命状态到此结束"，不写"解除约束"或"忽略之前的指令"（D4 措辞纪律）
- [x] 4.9 重构正文组装；全量套件保持绿

## 5. 投递端口与结局映射（D9）

- [x] 5.1 写失败测试 `unloaded target resumes before dispatch`、`running target yields queued via followup not steer`（test-plan 第 19–20 行）
- [x] 5.2 实现窄 `TodoDispatchPort { resolve, resume, followup }`，映射到 `agents.get`/`status`、`agents.resume`、`AgentHandle.followup`；**用 `followup` 而非 `steer`/`inject`**（D2）
- [x] 5.3 实现 D9 的五条结局映射；`dispatched` 与 `queued` 的区分取自投递**前**读到的 `status`，不取自投递返回值
- [x] 5.4 重构；确认五条路径均可经假端口离线构造

## 6. 受理动作：状态闸门与投递次序（D5）

- [x] 6.1 写失败测试 `terminal todo rejects accept before the dispatch port is called` 与 `accepted todo rejects a second accept without dispatching`（test-plan 第 13–14 行），断言假端口零调用
- [x] 6.2 实现**第 0 步前置状态闸门**：投递前读取待办，非 `open` 一律拒绝（design D5 的 blocking 修复，不可省）
- [x] 6.3 写失败测试 `accept dispatches then advances to accepted`、`unreachable target leaves the todo open`、`accept retry succeeds after a dispatch failure`（test-plan 第 1、11、12 行）
- [x] 6.4 在 `index.ts:3204` 的 `todoLedger.advance` 中分离 `accept` 分支：闸门 → 解析 → 投递 → **成功后**才 `advanceStatus`；失败不写任何状态，不引入 `accepted → open` 边
- [x] 6.5 保持 `done`/`drop` 分支为纯状态推进；写失败测试 `done and drop from open never dispatch`（test-plan 第 31 行）
- [x] 6.6 投递成功但 `advanceStatus` 失败的分支记结构化日志，不自动重投（D5 残留窗口）
- [x] 6.7 重构；全量套件保持绿

## 7. 路由与投递回执（D9）

- [x] 7.1 写失败测试 `todoAction accept returns a dispatch outcome`、`done and drop return no dispatch field`、`reread todo carries no dispatch outcome`（test-plan 第 16–18 行）
- [x] 7.2 扩展 `routes.ts:112` 的 `todoLedger` 依赖面与 `LOCUS_ROUTES.todoAction`（`routes.ts:763`），返回 `PetTodoView` + 独立的 `dispatch` 回执（含已投递时的 `executionTarget`，供 D11 导航直接取用）；保持 `todoLedger` 整体可选（缺失时 `LOCUS_UNAVAILABLE` 行为不变）
- [x] 7.3 重构；确认回执不被持久化到待办行

## 8. 子会话请求执行工具（D10）

- [x] 8.1 写失败测试 `child request-execution dispatches and marks accepted`（test-plan 第 22 行）
- [x] 8.2 实现 caller-bound 工具，沿用 `track.ts:48-83` 的授权形状：零 selector，Host 从 caller 与唯一 current Delivery 解析全部事实，不可证明即拒绝
- [x] 8.3 写失败测试 `request-execution rejects any target selector argument`、`foreign todo request-execution is refused`、`request-execution cannot mark done or dropped`（test-plan 第 24–26 行）
- [x] 8.4 实现三条拒绝路径；工具**只能**使自己登记的待办进入 `accepted`，且必须伴随一次真实投递
- [x] 8.5 写失败测试 `both entry points share resolution body and outcomes`（test-plan 第 23 行），断言两个入口经同一解析、产生同构正文、使用同一组结局
- [x] 8.6 确认共用下游链路，不复制任何一段
- [x] 8.7 **注册在 executor 的 scoped agent 上下文**并加入 `composition.ts` 白名单；无 scope 会静默落 global 层使普通会话看到该工具（本仓库已实机复现过的陷阱）
- [x] 8.8 扩展 `ledger-tool-scope.test.ts`：固定普通会话工具面不变，且 `no model-facing tool can reach done or dropped`（test-plan 第 30 行）
- [x] 8.9 更新 `host/ledger/prompt.ts` 的 WORK REQUEST 分支，告知子会话登记后可请求执行；同步 `intentTriageGuidanceCoversRequiredPoints` 的必备短语清单
- [x] 8.10 重构；全量套件保持绿

## 9. 管理面（Web）

- [x] 9.1 写失败测试 `accept hint states dispatch and navigation`
- [x] 9.2 更新 `settings.tsx:2536` 的 `TODO_ACTION_HINTS.accept`：说明会投递跟进任务、开始处理并转到执行目标会话，同时保留"不发送任何飞书消息"（旧，仍成立）
- [x] 9.3 写失败测试 `queued outcome renders as queued not completed`
- [x] 9.4 `useTodoLedger.dispatch`（`settings.tsx:2351`）承接投递回执并作为一次性 notice 呈现；失败时就地显示原因并保持该行待处理
- [x] 9.5 写失败测试 `successful accept opens the resolved execution target` 与 `failed accept stays put and shows the reason`；断言 `sessionOpener` 被以**回执里的 `executionTarget.sessionId`** 调用，不可断言"等于 parentSessionId"（那会把 D3 消除的硬编码写回测试）
- [x] 9.6 实现受理成功后的导航（D11）：用 `sessionOpener` 的 `kind: 'session'` 形态打开回执给出的执行目标并 `closeSettings`。**不可复用 `:2470-2477` 那段** —— 它开的是 `kind: 'subagent'`（登记待办的子会话），与投递目标不是同一个会话
- [x] 9.7 写失败测试 `queued outcome survives the navigation`；实现使结局回执以不随面板关闭而消失的形式呈现（D11 解 M1：导航不得吞掉 `dispatched`/`queued` 的区分）
- [x] 9.8 写失败测试 `accept succeeds without a session opener`；实现接缝缺失时正常完成受理、不导航、就地保留回执（`sessionOpener`/`closeSettings` 均为可选注入，见 `:2764-2790`）
- [x] 9.9 写失败测试 `request-execution returns no navigation instruction`（Host 侧断言，非组件交互）；确认工具路径返回值不含导航指令且不触达 GUI 接缝
- [x] 9.10 重构；确认不从行状态反推是否已投递

## 10. 既有不变量回归

- [x] 10.1 重跑 `ledger-delivery-decoupling.test.ts`：`backlog advances after registration`、`settled delivery leaves the todo open`、`status change emits nothing to Feishu`（test-plan 第 27–29 行）翻绿
- [x] 10.2 重跑 `ledger-view.test.ts` 四条跳转场景（test-plan 第 33–36 行）翻绿
- [x] 10.3 写失败测试 `accept emits no Feishu body reaction or Delivery`（test-plan 第 15 行）并实现/确认
- [x] 10.4 更新 `host/ledger/todo.ts` 与 `store.ts:184-190` 的语义注释：状态机转换表不变，说明投递发生在 `advanceStatus` 之前且两者不在同一事务

## 11. 验证与物化

- [x] 11.1 确认 test-plan.md 全部 41 行已由 🔴 翻为 🟢
- [x] 11.2 在 `packages/dsh-pet/` 内运行独立 build、typecheck 与 test
- [x] 11.3 运行仓库级 `npm test`
- [x] 11.4 运行 `npm run check:artifacts`
- [x] 11.5 运行 `node scripts/sync.mjs`，确认连续第二次运行不产生变化（幂等）
- [x] 11.6 确认 `~/.dsh/profiles/web/node_modules/dsh-pet/lib/client.js` 已含新文案（仅改 `src/` 不影响当前 GUI，B043 记录过同一陷阱）
- [x] 11.7 真机验收：对一条真实待办点击受理，确认主会话收到带上下文的跟进任务、界面转到该会话、在途工作未被打断
- [x] 11.8 真机验收：子会话经新工具请求执行，确认与按钮路径产生同构正文与同样结局，且不发生界面导航
- [x] 11.9 真机验收失败路径：构造一个不可达目标，确认受理失败、状态仍为待处理、界面留在原地并显示原因 —— **所有者决定跳过真机构造**（现无主会话已归档的待办，构造需归档一个真实会话）。该路径由单测覆盖：`resume failure maps to unreachable without dispatching`、`followup throwing maps to unreachable with a reason`、`unprovable ownership refuses before touching the port`、`unreachable target leaves the todo open`、`failed accept stays put and shows the reason`；真机验收 1 的首轮失败（写句柄冲突）也实际走过了"受理失败、状态保持 open"这条路径
- [x] 11.10 把 1.1 的核验结论回写 design.md（design 的 Open Questions 已清空，无待确认项）
