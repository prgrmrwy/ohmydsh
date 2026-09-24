## 1. 前置核验（写代码前必须完成）

- [ ] 1.1 核验 `qa-created` 来源的 main 是否也带 standby 开场简报：读 `host/locus/controller.ts:730,909` 的 QA 建群路径，确认其 main 是新建还是复用、是否调用 `composeLocusMainBriefing`；结论写回 design.md 的 Open Question 3，不从 `auto` 分支推断（design D4 第 6 条依赖该事实）
- [ ] 1.2 核验 Host 侧能从待办拿到其 locus 的 `mainSource`：确认 `locusRepository` 有按 `parentSessionId` 或 `locusId` 反查 `mainSource` 的既有读法，若无则确定最小新增读取面，不新增持久字段（design D7）
- [ ] 1.3 核验 `ctx.agents.get(sessionId)` 返回的 handle 上 `status` 与 `followup` 的实际可达路径（参考 `index.ts:672` 的 `liveAgentScope` 与 `:1535` 的 executor 投递），确认判忙与投递可在同一处完成
- [ ] 1.4 核验 `ctx.agents.resume` 在 Pet Host 内的既有调用形态（`index.ts:1479`）所需的最小参数，确认冷恢复一个**非 Pet 自建**的主会话不需要 Pet 专属 setup；若需要，记录约束并据此收敛 D5 的"目标可达"判据

## 2. Host：跟进正文组装（纯函数，先于副作用）

- [ ] 2.1 在 `src/host/ledger/` 下新增跟进正文组装纯函数（与 `host/locus/dsh-port.ts:176` 的 `composeLocusMainBriefing` 独立，不复用其文案，理由见 design D4）
- [ ] 2.2 正文包含 design D4 列举的 1–5 项：待办标识、请求人、登记时间、来源入口、证据摘要（明确标注为登记时刻快照）、先读上下文再推进的行动指引、可用查证路径
- [ ] 2.3 正文按 `mainSource` 分支追加 D4 第 6 条：auto（及 1.1 核验为同类的来源）时声明这是所有者发起的真实任务、待命状态到此结束；按 D4 措辞纪律，写成"待命状态结束"而非"解除约束"或"忽略之前的指令"
- [ ] 2.4 为该纯函数写单测：覆盖 auto 分支含待命结束声明、explicit 分支不含、证据被标注为登记时快照、正文不含任何 selector 或飞书出站意味的措辞

## 3. Host：受理即投递

- [ ] 3.1 在 `index.ts:3204` 的 `todoLedger.advance` 处，把 `accept` 分支与 `done`/`drop` 分支分离：后两者维持现有纯状态推进，不触碰投递
- [ ] 3.2 实现 `accept` 的执行次序（design D5）：解析 `parentSessionId` → 判目标可达（未加载则 `resume`）→ `followup` 投递 → 再调 `advanceStatus` 置 `accepted`
- [ ] 3.3 目标不可达（归档/无法恢复/归属不可证明）时拒绝受理，抛出可被路由层映射为就地说明的错误，状态保持 `open`，MUST NOT 猜测替代目标
- [ ] 3.4 投递成功但 `advanceStatus` 失败的残留窗口记结构化日志（design D5 残留窗口），不做自动补偿
- [ ] 3.5 用 `followup` 而非 `steer`/`inject`（design D2）；目标 `running` 时不做任何额外等待或打断，直接依赖 `followup` 的队列语义
- [ ] 3.6 扩展 `host/routes.ts:112` 的 `todoLedger` 依赖面与 `LOCUS_ROUTES.todoAction`（`routes.ts:763`）的返回值，使其携带投递结果事实（已投递 / 已排队 / 不可达），保持 `todoLedger` 整体仍为可选（缺失时 `LOCUS_UNAVAILABLE` 行为不变）

## 4. Host：状态机与不变量

- [ ] 4.1 更新 `host/ledger/todo.ts` 中 `accepted` 的语义注释与 `TODO_STATUS_TRANSITIONS` 附近的文档（状态机转换表本身不变，`accepted: ['done','dropped']` 保持）
- [ ] 4.2 更新 `host/ledger/store.ts:184-190` `advanceStatus` 的文档：说明它仍是纯状态推进，投递由调用方在其之前完成，两者不在同一事务（design D5）
- [ ] 4.3 确认并用测试固定：受理路径不产生任何飞书出站正文、表情或 Delivery（`pet-locus-intent-triage` spec.md:141 的不变量）
- [ ] 4.4 确认并用测试固定：模型仍不能经任何工具改写待办状态（D8 授权分界不变）
- [ ] 4.5 确认并用测试固定：受理路径不改变任何 locus 的生效权限档位，也不向子会话投递——跟进只落在主会话（`pet-locus-collaboration` spec.md:221-231 的默认 read 与全局写档开关不被绕过）

## 5. Web：管理面

- [ ] 5.1 更新 `client/settings.tsx:2536` 的 `TODO_ACTION_HINTS.accept`：同时说明会向主会话投递跟进任务并开始处理（新）与不发送任何飞书消息（旧，仍成立）
- [ ] 5.2 复核 `TODO_ACTION_LABELS.accept` 的「受理」字面是否仍与新语义相符；若改则同步 `client/ledger-view.ts:113` 的状态标签一致性
- [ ] 5.3 `useTodoLedger.dispatch`（`settings.tsx:2351`）承接 3.6 的投递结果，作为一次性 notice 呈现（design D6：不做成从行状态反推的持久标签）
- [ ] 5.4 受理失败时就地显示原因并保持该行仍为待处理，沿用既有"Host 拒绝时状态不被乐观改写"的重读策略
- [ ] 5.5 存量 `accepted` 行：就地说明其无法经受理触发投递（Migration Plan 第 2 点），不让所有者反复点一个必然失败的按钮

## 6. 测试

- [ ] 6.1 扩展 `test/ledger-todo.test.ts`：`accepted` 语义相关的状态机断言与新注释一致
- [ ] 6.2 扩展 `test/ledger-store.test.ts`：`advanceStatus` 仍为纯状态推进，不因本 change 获得副作用
- [ ] 6.3 新增受理投递测试：覆盖 delta spec 的全部 scenario——置状态并投递、正文携带上下文、证据标注为快照、auto 主会话待命状态结束、跟进不投给只读子会话也不提权、目标不可达不置已受理、受理不外发飞书、目标忙碌排队不打断、目标未加载先恢复、已排队不等于已处理、不经受理直接了结不投递
- [ ] 6.4 扩展 `test/locus-routes.test.ts` 或 `test/routes.test.ts`：`todoAction` 路由返回投递结果事实，且 `todoLedger` 缺失时仍 `LOCUS_UNAVAILABLE`
- [ ] 6.5 扩展 `test/ledger-panel-render.test.ts` / `test/client.test.ts`：受理动作 hint 自述会开工；存量 `accepted` 不被呈现为已投递
- [ ] 6.6 确认 `test/ledger-delivery-decoupling.test.ts` 的既有断言未被本 change 破坏（登记与 Delivery 结算解耦仍成立）

## 7. 验证与物化

- [ ] 7.1 运行 `npm test`（仓库级）
- [ ] 7.2 在 `packages/dsh-pet/` 内运行其独立的 build、typecheck 与 test
- [ ] 7.3 运行 `npm run check:artifacts`
- [ ] 7.4 运行 `node scripts/sync.mjs`，并确认连续第二次运行不产生变化（幂等）
- [ ] 7.5 确认 `~/.dsh/profiles/web/node_modules/dsh-pet/lib/client.js` 已包含新文案（仅改 `src/` 不影响当前 GUI，见 B043 记录的同一陷阱）
- [ ] 7.6 真机验收：对一条真实待办点击受理，确认主会话收到带上下文的跟进任务、在途工作未被打断、管理面回执与实际结果一致
- [ ] 7.7 把 1.1 的核验结论与 6.3 的实测结果回写 design.md 的 Open Questions，并就 Open Question 1（存量 accepted 补投递）与 2（受理后是否自动打开目标会话）向所有者确认后定稿
