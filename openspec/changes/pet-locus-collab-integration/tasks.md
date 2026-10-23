## 0. 基线

- [ ] 0.1 记录迁移前基线：运行 collab-kernel、dsh-collab、dsh-pet 的 test/typecheck，记下通过数与 skip 数到 `implementation-log.md`。之后每组结束都对比这个基线，不得出现新失败或新 skip
- [ ] 0.2 给 ADR-0006 补"消费 collab-kernel 承载台账与待办"注记（不改 Decision）；`openspec validate --strict` 通过

## 1. 内核：提交时间 `at`

- [ ] 1.1 Write failing test: `commit-time-01..03`（新提交带时间且重放不刷新、旧日志无时间照常重放、篡改时间被识别为损坏），确认因缺少 `at` 而失败
- [ ] 1.2 Implement: `ServiceOptions.now`；`command` 与 `completion` 提交写入 `at`，重放不写新提交，使 1.1 通过
- [ ] 1.3 Refactor；collab-kernel 全套通过，现有快照类测试（`log`、`store`、`file-store`、`command-snapshot`）若因新字段失败，先确认失败原因只是新字段，再改夹具，不改断言含义；dsh-collab 的 salvage 测试仍通过

## 2. 内核：`disposeManagedRequest`

- [ ] 2.1 Write failing test: `dispose-01..05`（代人受理不唤醒、不经受理直接完成、不能处置非托管成员的 request、作者退役后仍可处置、未授权空间不可区分）
- [ ] 2.2 Implement: manager 命令与授权表行，使 2.1 通过；`auth-06` 随之通过
- [ ] 2.3 Refactor；`auth-*`、`requests-*`、`managed*` 全部保持通过

## 3. dsh-collab：句柄 `establish`

- [ ] 3.1 先验证接缝：以 Host 当前持有、但不在模型轮次内的普通会话 agent 作 exec，`SessionAccess.caller` 能解析且守卫成立；写成测试 `establish-00` 放进 `establish.test.ts`。不成立就停下，回到 design D2，按 anvil spec drift 规则重审
- [ ] 3.2 Write failing test: `establish-01..04`（首次建立并授权、中断后重试补齐、托管成员不能建立、非 Leader 不能借此授权）
- [ ] 3.3 Implement: `establish`，使 3.2 通过
- [ ] 3.4 Refactor；dsh-collab 全套通过

## 4. dsh-collab：`disposeRequest` 与 `readManaged`

- [ ] 4.1 Write failing test: `handle-06：托管读取只对已授权空间可用`；把 `handle-05` 的断言改为新方法集合，确认它变红
- [ ] 4.2 Implement: `disposeRequest`、`readManaged`（经 host-index，检查本 channel 授权，返回前查接入代际），使 4.1 通过
- [ ] 4.3 Refactor；`handle-01..05` 通过；collab-kernel、dsh-collab typecheck/test/build 通过

## 5. Pet：`TodoBackend` 接缝（行为不变）

- [ ] 5.1 抽出 `TodoBackend` 接口，`legacy` 实现包装现有 `SharedFactLedgerStore`；`track`/`dispatch`/`ledger-read`/`routes` 改为依赖接口。这是纯重构：Pet 全套测试与 0.1 基线一致
- [ ] 5.2 把现有 `ledger-*`、`todo-*`、`intent-triage-*` 测试的存储夹具改为对 `TodoBackend` 参数化（此时只有 `legacy`）；断言一行不改；全部通过

## 6. Pet：成员投影、adapter 与对账

- [ ] 6.1 Write failing test: `scope-01..07`（同源可读、跨主会话不可读、台账不随条目清空而消失、新增条目类型不改既有语义、换代后仍是同一成员、权限切换期间协作层重接不移除成员、主会话未加载时不为建空间唤醒它）
- [ ] 6.2 Implement: 可选 inject `dshCollab`、attach `pet-locus`；调用集合与保留集合；adapter（presence 恒 `unreachable`、deliver 抛错）；D1 命名；D2 建立时机；对账（确定性 cmdId，只 retire 不在保留集合中的成员），使 6.1 通过
- [ ] 6.3 Refactor；Pet 全套通过

## 7. Pet：`collab` 实现

- [ ] 7.1 Write failing test: `track-01..07`（工具不接受目标参数、代际更替后待办仍可解析、入口退役不使待办消失、无唯一 current 时拒绝登记、主会话修订条目不改变登记证据、时间在重启后保持不变、登记不唤醒主会话），在 `collab` 实现上运行
- [ ] 7.2 Write failing test: `lifecycle-01..06`（登记后队列继续前进、回复完成不等于事情做完、待办状态变化不外发、子会话不能推进待办状态、主会话做完后自行标记完成、不经受理直接了结）
- [ ] 7.3 Implement: `collab` 实现（body 规范 JSON、从 `item/created` 读证据、`at` 投影时间、`<op>-<itemId>-<attemptId>`），使 7.1、7.2 通过
- [ ] 7.4 把第 5.2 步的参数化夹具加入 `collab` 实现；现有 `ledger-*`、`todo-*`、`intent-triage-*` 测试在两个实现上都通过，断言不改。哪条只在 `collab` 上失败，先判断是缺陷还是规范已改的行为；后者按 spec drift 规则处理，不得为让测试变绿而改断言
- [ ] 7.5 Refactor；Pet 全套通过

## 8. 迁移前后等价

- [ ] 8.1 Write failing test: `equivalence-01..04`（同一流程在新旧存储上输出一致、证据边界值逐字段一致、并发受理一致、失败路径一致）。先在 `collab` 实现里故意注入一处差异（例如证据正文多一个空格），确认测试能抓到，再撤掉
- [ ] 8.2 Implement: 修正差分暴露出的所有差异，使 8.1 通过
- [ ] 8.3 Refactor；Pet 全套通过

## 9. 降级与存量

- [ ] 9.1 Write failing test: `availability-01..03`（协作层缺失时登记失败而回复照常、管理面不把不可用显示为空、协作层恢复后自动重新可用）与 `legacy-01..02`（旧版待办仍可读到、旧版待办只读）
- [ ] 9.2 Implement: 能力门与服务消失/重现处理；生产装配只用 `collab` 写，`legacy` 只读并合并展示；管理面标旧版与不可用，使 9.1 通过
- [ ] 9.3 Refactor；Pet、collab-kernel、dsh-collab typecheck/test/build 全部通过，与 0.1 基线比没有新失败或新 skip

## 10. 配置、真实验收与收尾

- [ ] 10.1 `dsh.yaml` 中 dsh-collab 增加 `managedChannels: ['pet-locus']` 并更新 note；仓库 `npm test`、`npm run check:artifacts`、`openspec validate pet-locus-collab-integration --strict`、`git diff --check` 通过
- [ ] 10.2 经用户授权部署：`node scripts/sync.mjs` 两次，第二次无变化；重启 Host 后刷新现有 GUI
- [ ] 10.3 真实 Host 验收，记录脱敏证据：升级前已有的待办在管理面标为旧版、只读；新空间建立；子会话登记待办不唤醒主会话；所有者受理后主会话收到跟进正文（与升级前一条同类待办的正文结构对照）；所有者直接放弃不唤醒；主会话自行完成；停用 dsh-collab 后登记失败而回复照常，重新启用后恢复
- [ ] 10.4 写 `verify.md`（anvil verify：test-plan 全绿、全套通过且无新 skip、评审未过期）；跨边界协作标准 7.2 节标注台账与待办已接入；确认 current specs 反映最终行为后归档
