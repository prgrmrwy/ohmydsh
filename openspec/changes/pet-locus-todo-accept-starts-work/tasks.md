## 1. 前置核验（写码前完成，结论回写 design）

- [ ] 1.1 核验 Host 能否判定"某主会话是否被 brief 过 standby"：若无直接记录，确认 `mainSource === 'auto'` 是当前唯一等价判据，并在实现注释中写明它是代理指标（design D4）
- [ ] 1.2 核验 `ctx.agents.get(sessionId)` 返回句柄上 `status` 与 `followup` 的实际可达路径（参考 `index.ts:672` 的 `liveAgentScope`、`:1535` 的 executor 投递），确认判忙与投递可在同一处完成
- [ ] 1.3 核验 `ctx.agents.resume` 冷恢复一个**非 Pet 自建**主会话所需的最小参数（参考 `index.ts:1479`），确认不需要 Pet 专属 setup；若需要，据此收敛 D9 的 `unreachable` 判据
- [ ] 1.4 核验新工具在 `composition.ts` 白名单与 `attestLocusComposition` 下的注册方式，确认与 `pet_locus_track`（`composition.ts:54`）同层

## 2. 共享测试脚手架（先于一切实现）

- [ ] 2.1 在 `packages/dsh-pet/test/todo-dispatch.test.ts` 建立假 `TodoDispatchPort`，记录 `resolve`/`resume`/`followup` 的**调用序列**（不只是结果）——"投递前被拒"类断言依赖"端口从未被调用"，只看返回值无法区分拒绝时机
- [ ] 2.2 建立待办 fixture 工厂，可构造 `open`/`accepted`/`done`/`dropped` 四种状态及含恶意证据的变体

## 3. 执行目标解析（D3）

- [ ] 3.1 写失败测试 `dispatch never targets the child nor mutates permission`（test-plan 第 10 行），断言解析结果为主会话且无任何权限档位写入；确认因解析函数不存在而失败
- [ ] 3.2 实现执行目标解析纯函数：输入待办已固定的归属事实，输出执行目标；本期唯一规则为"登记方无执行能力 → 转交主会话"，零 selector，不可证明时 fail closed
- [ ] 3.3 重构：确认解析不被任何调用方旁路，全量套件保持绿

## 4. 跟进正文组装（D4 + D8）

- [ ] 4.1 写失败测试：`body states itemId requester time endpoint and evidence`、`body marks evidence as registration-time snapshot`（test-plan 第 2–3 行）
- [ ] 4.2 实现正文组装纯函数（独立于 `composeLocusMainBriefing`，不复用其文案——两者意图相反）
- [ ] 4.3 写失败测试：`evidence is final section with no trailing host text`、`evidence section has start marker and no end marker`、`body declares evidence as third-party input`（test-plan 第 4、5、7 行）
- [ ] 4.4 实现指令段/证据段结构：证据为正文最后一段、其后无任何 Host 文本、只有起始标记无结束标记、全文至多一个证据段
- [ ] 4.5 写失败测试 `forged delimiter stays inside the evidence section`（test-plan 第 6 行），用例覆盖伪造起始标记、Markdown 代码围栏、形似段落结束的文本；**断言对象是"文本仍位于末段内且指令段字节不变"，不是"模型没有照做"**（D8 三层定位）
- [ ] 4.6 实现使上述用例通过；`requestedBy` 来自 `senderOpenId`（`track.ts:71`）为平台事实，留在指令段
- [ ] 4.7 写失败测试 `briefed main is told standby has ended` 与 `never-briefed main omits the standby-ended sentence`（test-plan 第 8–9 行）
- [ ] 4.8 实现待命结束声明的条件分支，判据用 1.1 的结论；措辞写"待命状态到此结束"，不写"解除约束"或"忽略之前的指令"（D4 措辞纪律）
- [ ] 4.9 重构正文组装；全量套件保持绿

## 5. 投递端口与结局映射（D9）

- [ ] 5.1 写失败测试 `unloaded target resumes before dispatch`、`running target yields queued via followup not steer`（test-plan 第 19–20 行）
- [ ] 5.2 实现窄 `TodoDispatchPort { resolve, resume, followup }`，映射到 `agents.get`/`status`、`agents.resume`、`AgentHandle.followup`；**用 `followup` 而非 `steer`/`inject`**（D2）
- [ ] 5.3 实现 D9 的五条结局映射；`dispatched` 与 `queued` 的区分取自投递**前**读到的 `status`，不取自投递返回值
- [ ] 5.4 重构；确认五条路径均可经假端口离线构造

## 6. 受理动作：状态闸门与投递次序（D5）

- [ ] 6.1 写失败测试 `terminal todo rejects accept before the dispatch port is called` 与 `accepted todo rejects a second accept without dispatching`（test-plan 第 13–14 行），断言假端口零调用
- [ ] 6.2 实现**第 0 步前置状态闸门**：投递前读取待办，非 `open` 一律拒绝（design D5 的 blocking 修复，不可省）
- [ ] 6.3 写失败测试 `accept dispatches then advances to accepted`、`unreachable target leaves the todo open`、`accept retry succeeds after a dispatch failure`（test-plan 第 1、11、12 行）
- [ ] 6.4 在 `index.ts:3204` 的 `todoLedger.advance` 中分离 `accept` 分支：闸门 → 解析 → 投递 → **成功后**才 `advanceStatus`；失败不写任何状态，不引入 `accepted → open` 边
- [ ] 6.5 保持 `done`/`drop` 分支为纯状态推进；写失败测试 `done and drop from open never dispatch`（test-plan 第 31 行）
- [ ] 6.6 投递成功但 `advanceStatus` 失败的分支记结构化日志，不自动重投（D5 残留窗口）
- [ ] 6.7 重构；全量套件保持绿

## 7. 路由与投递回执（D9）

- [ ] 7.1 写失败测试 `todoAction accept returns a dispatch outcome`、`done and drop return no dispatch field`、`reread todo carries no dispatch outcome`（test-plan 第 16–18 行）
- [ ] 7.2 扩展 `routes.ts:112` 的 `todoLedger` 依赖面与 `LOCUS_ROUTES.todoAction`（`routes.ts:763`），返回 `PetTodoView` + 独立的 `dispatch` 回执；保持 `todoLedger` 整体可选（缺失时 `LOCUS_UNAVAILABLE` 行为不变）
- [ ] 7.3 重构；确认回执不被持久化到待办行

## 8. 子会话请求执行工具（D10）

- [ ] 8.1 写失败测试 `child request-execution dispatches and marks accepted`（test-plan 第 22 行）
- [ ] 8.2 实现 caller-bound 工具，沿用 `track.ts:48-83` 的授权形状：零 selector，Host 从 caller 与唯一 current Delivery 解析全部事实，不可证明即拒绝
- [ ] 8.3 写失败测试 `request-execution rejects any target selector argument`、`foreign todo request-execution is refused`、`request-execution cannot mark done or dropped`（test-plan 第 24–26 行）
- [ ] 8.4 实现三条拒绝路径；工具**只能**使自己登记的待办进入 `accepted`，且必须伴随一次真实投递
- [ ] 8.5 写失败测试 `both entry points share resolution body and outcomes`（test-plan 第 23 行），断言两个入口经同一解析、产生同构正文、使用同一组结局
- [ ] 8.6 确认共用下游链路，不复制任何一段
- [ ] 8.7 **注册在 executor 的 scoped agent 上下文**并加入 `composition.ts` 白名单；无 scope 会静默落 global 层使普通会话看到该工具（本仓库已实机复现过的陷阱）
- [ ] 8.8 扩展 `ledger-tool-scope.test.ts`：固定普通会话工具面不变，且 `no model-facing tool can reach done or dropped`（test-plan 第 30 行）
- [ ] 8.9 更新 `host/ledger/prompt.ts` 的 WORK REQUEST 分支，告知子会话登记后可请求执行；同步 `intentTriageGuidanceCoversRequiredPoints` 的必备短语清单
- [ ] 8.10 重构；全量套件保持绿

## 9. 管理面（Web）

- [ ] 9.1 写失败测试 `accept hint states it dispatches to the main session`（test-plan 第 32 行）
- [ ] 9.2 更新 `settings.tsx:2536` 的 `TODO_ACTION_HINTS.accept`：同时说明会向主会话投递跟进任务（新）与不发送任何飞书消息（旧，仍成立）
- [ ] 9.3 写失败测试 `queued outcome renders as queued not completed`（test-plan 第 21 行）
- [ ] 9.4 `useTodoLedger.dispatch`（`settings.tsx:2351`）承接投递回执并作为一次性 notice 呈现；失败时就地显示原因并保持该行待处理
- [ ] 9.5 重构；确认不从行状态反推是否已投递

## 10. 既有不变量回归

- [ ] 10.1 重跑 `ledger-delivery-decoupling.test.ts`：`backlog advances after registration`、`settled delivery leaves the todo open`、`status change emits nothing to Feishu`（test-plan 第 27–29 行）翻绿
- [ ] 10.2 重跑 `ledger-view.test.ts` 四条跳转场景（test-plan 第 33–36 行）翻绿
- [ ] 10.3 写失败测试 `accept emits no Feishu body reaction or Delivery`（test-plan 第 15 行）并实现/确认
- [ ] 10.4 更新 `host/ledger/todo.ts` 与 `store.ts:184-190` 的语义注释：状态机转换表不变，说明投递发生在 `advanceStatus` 之前且两者不在同一事务

## 11. 验证与物化

- [ ] 11.1 确认 test-plan.md 全部 36 行已由 🔴 翻为 🟢
- [ ] 11.2 在 `packages/dsh-pet/` 内运行独立 build、typecheck 与 test
- [ ] 11.3 运行仓库级 `npm test`
- [ ] 11.4 运行 `npm run check:artifacts`
- [ ] 11.5 运行 `node scripts/sync.mjs`，确认连续第二次运行不产生变化（幂等）
- [ ] 11.6 确认 `~/.dsh/profiles/web/node_modules/dsh-pet/lib/client.js` 已含新文案（仅改 `src/` 不影响当前 GUI，B043 记录过同一陷阱）
- [ ] 11.7 真机验收：对一条真实待办点击受理，确认主会话收到带上下文的跟进任务、在途工作未被打断、回执与实际结果一致
- [ ] 11.8 真机验收：子会话经新工具请求执行，确认与按钮路径产生同构正文与同样结局
- [ ] 11.9 把 1.1 的核验结论回写 design.md，并就剩余 Open Question（受理后是否自动打开目标会话）向所有者确认后定稿
