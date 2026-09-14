# B035 宿主门槛与实施分解 Implementation Plan

> **For agentic workers:** Use the existing OpenSpec apply workflow task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. `tasks.md` is the authoritative completion checklist; this file does not replace its acceptance criteria.

**Goal:** 在不复制父历史、不扩大权限的前提下实现同源公共事实、发现和异步询问。

**Architecture:** 先对实际固定 runtime 做可复现实验，明确官方可用接缝和必须窄补丁的边界。Pet 持久化公共事实与工作关联，成员资格始终由当前 Locus 索引及冷读身份派生；保持旧 fork 行为及普通轮盘不变。

**Tech Stack:** TypeScript、Vitest、真实固定 DSH/Cordis 库、Pet SQLite Domain transaction、React owner 管理面。

---

## 当前执行批次：门槛证据，不发布产品能力

已完成基线 1.1 与全量现有测试。当前只添加显式 opt-in 的诊断测试，不把该批次通过算作 G1–G5 发布验收；不会为了推进代码默许 runtime 已满足需求。

### Task A：G1 空 seed / 模型选择 / 冷恢复组合探针

**Files:**
- Create: `packages/dsh-pet/test/independent-runtime-probe.test.ts`
- Evidence: `docs/notes/pet-independent-agent-capability-audit.md`

- [x] 从 `DSH_PET_TEST_RUNTIME` 指定目录验证官方包身份/版本和 compat provenance，缺少显式路径时清晰跳过；不得用 workspace node_modules 偷换被测 runtime。
- [x] 实际注册 spawn provider，调用其 prepareContinuable，核验不返回父 seed；运行真实 child model resolver，确认显式选择行为，fixture 只含合成哨兵。
- [x] 使用真实 Cordis scope/AgentPresets 建临时 preset A/B，child 保存 A，parent live 切为 B；运行实际 `applyChildComposition`，观察当前会取 B 的缺口。不创建真实 session、不联网、不调用模型。
- [x] 以明确的 diagnostic/current-gap 测试名保留该观察，不能倒置期望后声称产品要求通过。未来补丁修复时新增 desired-behavior 断言，并明确两种 runtime 版本结果。

### Task B：G3/G4 队列与效果边界探针

**Files:**
- Create: `packages/dsh-pet/test/inquiry-runtime-probe.test.ts`
- Evidence: `docs/notes/pet-independent-agent-capability-audit.md`

- [x] 同样显式解析固定 runtime；真实 Inbox 搭配仅用于存放合成事件的 Session fixture，不自行实现第二套 inbox。
- [x] 排入 GUI next-step、Inquiry next-turn、Delivery next-turn；断言当前首 claim 含前两条且 Delivery 留队列。这证明 followup 非 steering 但不是排他来源。
- [x] 注册真实 Tools/Cordis scoped guard；用计数器工具验证 deny 在 body 前阻止执行，包括同层工具；不得使用真实文件写、shell、网络或外部 API 作探针副作用。该探针只证明 runtime 的 guard 时序，**不再代表最终 G4 的窄白名单产品策略**；owner 后续已决定目标保留正常工具与既有权限，G4 仅硬禁身份/通信越界并要求正文前重验。
- [x] Promise barrier 暂停 `tools/execute` wrapper，guard preparation 通过后撤权，再 release，观察当前最终 body 不重验 guard 的窗口。把它记为缺口而非门槛成功。

### Task C：执行、审阅与回填

- [x] 两份探针使用下面明确环境运行（当前主检出为 workdir；被测目录是固定自包含依赖根，不是部署 home）：

```sh
DSH_PET_TEST_RUNTIME="$PWD/packages/dsh-pet/compat/subagent/.launcher-builds/eb586fe8ead9f58d0e54a8a2f527c2947acf1c1d685a9e78330716cb81b653d5-58844649-a3be-4ae2-b6c1-aa63ebcacbca" npm run test --workspace=dsh-pet -- test/independent-runtime-probe.test.ts test/inquiry-runtime-probe.test.ts
npm run typecheck --workspace=dsh-pet
openspec validate pet-locus-independent-agent-inquiries --strict
git diff --check
```

- [x] 逐一确认探针是真实导出实现，不是代码字符串测试；收集实际次数/结果，写清“未建立完整 Agent/Session/模型轮次”的证明范围。
- [x] 根据结果细化下个代码批次。G1–G5 任务在没有自身完整放行证据时保持未勾选；任何需要改变产品语义的结果立即回到 owner，而非实现中悄悄删除要求。

## Task D：caller resolver 基础模块（不装配、不启用询问）

**Files:** `packages/dsh-pet/src/host/collaboration/caller.ts`、`packages/dsh-pet/test/collaboration-caller.test.ts`。

复用持久仓储的 `findByChildSessionId` / `getLocusByChild` / `listLociByParent` / `getCurrentLocus`。入口只接 Host 提取的实际 callerSessionId，不接模型指定 parent。先读取关系快照，cold inspect caller 与 parent 的 id/lineage，再同步重读索引与 archive 状态确认没有跨 await 漂移。普通 subagent、退役 child、双重角色与索引矛盾统一拒绝；已建立公共记录且没有 child 的有效 root 可读取公共上下文。结果仅为当前观察的事实，不是 bearer capability，后续派发仍重验。

- [x] 写测试：有效 root/child/同源 sibling；无关普通 root/subagent 拒绝；旧代/歧义/索引不一致拒绝；cold inspect 抛错、id/lineage 不符、归档拒绝；await 中改绑/归档拒绝；同群异父不聚合。
- [x] 运行 `npm run test --workspace=dsh-pet -- test/collaboration-caller.test.ts` 证明模块不存在时失败。
- [x] 实现无副作用 resolver 和窄 ports、只返回身份与代际引用，不返回资料/权限/endpoint/internal history。
- [x] 重跑该测试、typecheck、严格校验、diff；生产装配尚未完成时不勾完整 2.3，留下模块级证据。34 tests GREEN；独立审阅发现 switch notice/busy revision 两项误拒，分别 RED→GREEN 修复，真实 durable 重开与索引损坏测试通过。

## Task E：Host cold identity adapter 与公共事实值模型

**Files:** `host/collaboration/host-identity.ts` / `test/collaboration-host-identity.test.ts`；`host/collaboration/context.ts` / `test/collaboration-context.test.ts`（均相对 packages/dsh-pet）。两者独立开发，不自动装配或改 schema。

- [x] Host adapter 只调用实际 sessionController.inspect 的 `{ meta: { id, parentSession }, events }` 形状，不借助 live Agent 或猜 header。archive 用同步 workspaceRegistry projection，冷读失败/错误 id/异常形状统一 fail closed；list agent 工具不经 owner 全量视图。
- [x] 先写 schema-shape、archive change、错误 meta、无 fallback 的 RED tests，再实现 ports adapter 并接 resolver 的内存/真实 durable 测试；验证不返回或分析事件正文。
- [x] 公共值模型纯函数：首次 parent 空记录 revision0/unknown，owner 可信确认事实 + expectedRevision 完整替换为下一 revision；字段严格有界、未知字段拒绝、深冻结、清空不回填、overflow 拒绝。该 helper 不假装替代真实 owner HTTP 鉴权。
- [x] 公共值模型 RED→GREEN tests 覆盖版本冲突、输入引用后续修改、未确认共享范围、非法输入、清空/来源记录。后续 store 负责事务/审计，当前不写生产介质，2.7/2.8 仍未完成。

## Task F：公共事实 durable store / additive v10

- [x] schema 复用严格纯值校验：`collaboration_contexts` 当前 parent 行、`collaboration_context_revisions` 不可变完整修订；v10 只 additive。离线脚本支持 v2..v9→10，备份/锁/旧内容保持测试，不实际迁移生产。
- [x] `context-store.ts` 使用 Domain 自身串行 transaction callback 内重读来保证跨 repository 实例 CAS；当前+审计同一原子批，不以补偿写伪装事务。无事务拒写；读取不需要事务能力但验证 key/record。
- [x] 并发 ensure 同 parent 只得 revision0；confirm 前 caller adapter 负责 owner auth，此 store 校验输入和 CAS，不自称 owner鉴权。写请求在首个 await 前 detach，授权 facts 不从模型推断。
- [x] 测试原子失败/并发/重开/跨父/审计清空保留/输入修改。普通依赖无 transaction 时明确跳过真实事务组并测试拒写；opt-in runtime config 指向审查过 compat Domain 执行真实事务组，不添加假 transaction。
- [x] 范围及全量回归、typecheck、strict/artifact检查，原生 v9 打开需要离线迁移不得自动 restamp；完整2.2还含模式迁移，2.7还含首挂 lifecycle，均保持未完成。父复跑 Pet/仓库全量：Pet 1843/13 skip，仓库修锁后 124/1 skip，0 failures；fixed runtime store 7/7；strict/artifact/diff均通过。

## Task G：公共事实写入面（规范修订后）

owner 明确确认已被所有者取消：公共事实是同源范围内的共享笔记，不授予能力、不对用户公开，因此按范围成员资格授权，由 agent 自主提交。

- [x] 值模型/存储改为写入者留痕：`authored` 状态、`authoredBy`/`authoredAt`/`authorLocus`，移除 explicitConfirmation；保留严格校验、CAS、审计与不可变性。RED 78/85 → GREEN；五个 suite 202 passed。
- [x] 新增 caller-bound 写工具：`readForCollaborationCaller` 同一 fence 内解析实际 caller，Host 派生写入者身份与代际，模型不能指定 parent/作者；圈外/退役/失效拒绝。write 9/9，scoped 读写分别注册 2/2。
- [ ] 首挂 lifecycle：有效关联时幂等确保空记录，失败 provisioning 不授予访问；最后 child 退出保留记录。
- [ ] 写工具 RED→GREEN 测试：并发冲突需重读、来源可追溯、清空不回填、圈外拒绝、失效 parent 拒绝、写失败不改当前版本。
- [ ] route slice 降级为可选查看/纠正面，不作为主写入路径；生产挂载条件另行决定。

## 后续批次的文件职责边界

以下是代码归属地图，不是已完成项，也不允许据此跳过 tasks：

| 批次 | 文件职责 | OpenSpec 任务 |
|---|---|---|
| 独立配置/效果接缝 | reviewed compat patch/build fingerprint/markers；固定 runtime desired-behavior tests；不手改部署 lib | 1.2–1.8、3.1/3.5 |
| 身份解析 | `host/collaboration/caller.ts`：实际 caller、冷读身份、当前索引和同源关系；无模型目标参数 | 2.3–2.6 |
| 公共事实 | `host/collaboration/context.ts`、`context-store.ts`：单 parent 版本化事实/owner CAS，`spec.ts` additive schema、显式迁移；不复制局部锚点 | 2.2、2.7–2.11 |
| scoped 装配 | `host/collaboration/tools.ts`、`src/index.ts`：公共查询/列表/问答分能力装配、动态首挂、加载幂等 | 3.2–3.4、3.6 |
| 询问执行 | 独立 inquiry ledger/dispatcher/effect-guard/segment 模块：原请求、排队、预算、答案与终态 fence | 2.1、4.1–4.7、5.1–5.5 |
| 出站与恢复 | `host/tools.ts`/`lark.ts` intent/outcome；扩展 observer/startup recovery，保留 mixed/unknown fail-closed | 5.6、6.1–6.5 |
| owner 管理 | 公共事实最小编辑面、模式/诊断、空闲重建，不重构全部设置页 | 7.1–7.6 |
| 最终验收 | 真实授权工作载体、未决重启、离线备份/迁移、现有 URL 刷新验证、前置归档顺序 | 8.1–8.8 |

后续每个批次在改生产代码前补精确接口及 red→green 测试步骤。不得把本文件的目录布局当作新能力范围或必须大规模重构的指令。主检出不自动 commit；模型配额消耗、真实飞书载体、部署及中断生产 Host 需按任务已有约束核验授权。
