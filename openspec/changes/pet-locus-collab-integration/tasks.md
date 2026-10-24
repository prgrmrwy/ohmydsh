## 0. 基线与前置

- [x] 0.1 记录迁移前基线：运行 collab-kernel、dsh-collab、dsh-pet 的 test/typecheck，记下通过数与 skip 数到 `implementation-log.md`。之后每组结束都对比基线，不得出现新失败或新 skip
- [x] 0.2 给 ADR-0006 补"消费 collab-kernel 承载台账与待办"注记（不改 Decision）；在 `pet-locus-independent-agent-inquiries/tasks.md` 记下"兄弟直询与 sibling 名单与本 change 星形模型冲突，需去掉"的依赖，不改其已完成项；`openspec validate --strict` 通过

## 1. 内核：提交时间 `at`

- [x] 1.1 Write failing test: `commit-time-01..03`，确认因缺少 `at` 而失败
- [x] 1.2 Implement: `ServiceOptions.now`；`command` 与 `completion` 提交写入 `at`；重放不写新提交，使 1.1 通过
- [x] 1.3 Refactor；collab-kernel 全套通过。现有快照类测试若只因新字段失败，确认后改夹具不改断言含义；dsh-collab 的 salvage 测试仍通过

## 2. 内核：`disposeManagedRequest`

- [x] 2.1 Write failing test: `dispose-01..05`
- [x] 2.2 Implement: manager 命令与授权表行，使 2.1 通过；`auth-06` 随之通过
- [x] 2.3 Refactor；`auth-*`、`requests-*`、`managed*` 全部保持通过

## 3. dsh-collab：句柄 `establish`、`disposeRequest`、`readManaged`

- [x] 3.1 先验证接缝：以 Host 当前持有、但不在模型轮次内的普通会话 agent 作 exec，`SessionAccess.caller` 能解析且守卫成立；写成测试 `establish-00`。不成立就停下，回到 design D2，按 anvil spec drift 规则重审
- [x] 3.2 Write failing test: `establish-01..04`
- [x] 3.3 Implement: `establish`，使 3.2 通过
- [x] 3.4 Write failing test: `handle-06：托管读取只对已授权空间可用`；把 `handle-05` 的断言改为新方法集合，确认它变红
- [x] 3.5 Implement: `disposeRequest`、`readManaged`，使 3.4 通过
- [x] 3.6 Refactor；dsh-collab 全套通过

## 4. dsh-collab：戳、cmdId 命名空间、写目标授权、可见投影

- [ ] 4.1 Write failing test: `stamp-01..02`（写入带戳且 cmdId 带命名空间、不同戳的同名 cmdId 互不干扰）、`stamp-17..18`（戳在途变化失效、超长或非对象戳视为未解析）
- [ ] 4.2 Implement: `resolveCaller` 返回 `{address, stamp}`；入口捕获戳；守卫比较戳；写入 `ext = stamp`；写命令 cmdId 加 `sha256(stamp)` 前缀，使 4.1 通过
- [ ] 4.3 Write failing test: `stamp-08..12`（不能借公开条目传话、可以修订自己的条目、主会话条目只读、可以引用主会话发给自己的消息、不同 Locus 新开独立话题）、`stamp-14..16`（不能修改确认引用兄弟条目、无权调用者拿不到旧收据、只能发给 main）
- [ ] 4.4 Implement: 写目标授权（revise/ack/advance 目标戳相等；ref 只许自己的记录或 main→自己的消息；`recipients`），入口检查并随守卫重验，收据路径同样受检，使 4.3 通过
- [ ] 4.5 Write failing test: `stamp-03..07`（兄弟条目不可见、公开记录引用隐藏记录仍能重放、同一提交中的 dispatch 不泄露、状态文本不能传话、隐藏条目标识不经任何字段泄露）、`stamp-13`（成员计数不进投影）、`stamp-19`（不提供 visible 时不投影也不做写授权）
- [ ] 4.6 Implement: 完整重放后投影：`overview` 白名单（含 members 字段白名单）、`since` 事件过滤保留 seq/at、`collab_status` 按投影推导且只列可执行动作，使 4.5 通过
- [ ] 4.7 Refactor；dsh-collab 全套通过；工具 schema 体积测试仍在预算内（工具定义不变）；collab-kernel、dsh-collab typecheck/test/build 通过

## 5. Pet：`TodoBackend` 接缝（行为不变）

- [x] 5.1 抽出 `TodoBackend` 接口，`legacy` 实现包装现有 `SharedFactLedgerStore`；`track`/`dispatch`/`routes` 改为依赖接口。纯重构：Pet 全套测试与 0.1 基线一致
- [x] 5.2 把现有 `ledger-*`、`todo-*`、`intent-triage-*` 测试的存储夹具改为对 `TodoBackend` 参数化（此时只有 `legacy`）；断言一行不改；全部通过
- [x] 5.3 Write failing test: `toolface-01..02`（双向核对、子会话反查，断言现行行为）；Implement 无需改动即应通过，确认它们在现行代码上绿

## 6. Pet：代理（戳、visible、路由、presence、deliver）与空间建立

- [ ] 6.1 Write failing test: `scope-01..06`（兄弟读不到彼此、跨主会话不可读、台账不随条目清空而消失、新增条目类型不改既有语义、换代后登记照旧归入同一代理、主会话未加载时不为建空间唤醒它）
- [ ] 6.2 Write failing test: `routing-01..04`（回应消息沿 ref 路由到最近的戳、正文点名、无法路由不猜、零 active child 时终态仍登记）
- [ ] 6.3 Implement: 可选 inject `dshCollab`、attach `pet-locus`；路由投影；`resolveCaller` 返回地址 `pet:<parent>` 与戳；`visible` 纯函数；`recipients: ['main']`；`presence` 按空间建立；`deliver` 按 D5 路由并登记（不开轮次）；D1 命名；D2 `establish` + 一次 `admit('pet')`，使 6.1、6.2 通过
- [ ] 6.4 Refactor；Pet 全套通过

## 7. Pet：`collab` 实现与子会话工具面

- [ ] 7.1 Write failing test: `track-01..06`（工具不接受目标参数、代际更替后待办仍可解析、入口退役不使待办消失、登记不唤醒主会话、主会话修订条目不改变登记证据、时间在重启后保持不变），在 `collab` 实现上运行；沿用的 `spec: 无唯一 current 时拒绝登记` 保持通过
- [ ] 7.2 Write failing test: `lifecycle-01..06`（登记后队列继续前进、回复完成不等于事情做完、待办状态变化不外发、子会话不能推进待办状态、主会话做完后自行标记完成、不经受理直接了结）
- [ ] 7.3 Write failing test: `toolface-03..04`（子会话的协作工具面、子会话不能向兄弟发消息）
- [ ] 7.4 Implement: `collab` 实现（body 规范 JSON、从 `item/created` 读证据、`at` 投影时间、`<op>-<itemId>-<attemptId>`、`readSince` 游标）；`pet_locus_ledger_read` 退役并把 `dispatch.ts` 三处指引改为 `collab_read`；子会话白名单加入 8 个协作工具，使 7.1–7.3 通过
- [ ] 7.5 把第 5.2 步的参数化夹具加入 `collab` 实现；现有 `ledger-*`、`todo-*`、`intent-triage-*` 测试在两个实现上都通过，断言不改。只在 `collab` 上失败的，先判断是缺陷还是规范已改的行为；后者按 spec drift 规则处理，不得为让测试变绿而改断言
- [ ] 7.6 Refactor；Pet 全套通过

## 8. 迁移前后等价

- [ ] 8.1 Write failing test: `equivalence-01..04`。先在 `collab` 实现里故意注入一处差异（证据正文多一个空格），确认测试能抓到，再撤掉
- [ ] 8.2 Implement: 修正差分暴露出的所有差异，使 8.1 通过
- [ ] 8.3 Refactor；Pet 全套通过

## 9. 降级与存量

- [ ] 9.1 Write failing test: `availability-01..03`、`legacy-01..02`
- [ ] 9.2 Implement: 能力门与服务消失/重现处理；生产装配只用 `collab` 写，`legacy` 只读并在管理面合并展示；管理面标旧版与不可用；无法路由登记面，使 9.1 通过
- [ ] 9.3 Refactor；Pet、collab-kernel、dsh-collab typecheck/test/build 全部通过，与 0.1 基线比没有新失败或新 skip

## 10. 配置、真实验收与收尾

- [ ] 10.1 `dsh.yaml` 中 dsh-collab 增加 `managedChannels: ['pet-locus']` 并更新 note；仓库 `npm test`、`npm run check:artifacts`、`openspec validate pet-locus-collab-integration --strict`、`git diff --check` 通过
- [ ] 10.2 经用户授权部署：`node scripts/sync.mjs` 两次，第二次无变化；重启 Host 后刷新现有 GUI
- [ ] 10.3 真实 Host 验收，记录脱敏证据：升级前已有的待办在管理面标为旧版只读；新空间建立且成员恰为 main 与 pet；子会话经 `collab_status`/`collab_read` 只看到自己与主会话的记录；子会话登记待办不唤醒主会话；所有者受理后主会话收到跟进正文（与升级前一条同类待办的正文结构对照）；所有者直接放弃不唤醒；主会话自行完成后 Pet 登记路由到该 locus；停用 dsh-collab 后登记失败而回复照常，重新启用后恢复；观察主会话是否自行受理 open 待办并记录
- [ ] 10.4 写 `verify.md`（anvil verify：test-plan 全绿、全套通过且无新 skip、评审未过期）；跨边界协作标准 7.2 节改写为代理成员模型；确认 current specs 反映最终行为后归档
