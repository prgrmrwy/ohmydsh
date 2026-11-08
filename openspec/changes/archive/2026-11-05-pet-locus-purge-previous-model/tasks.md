# Tasks: pet-locus-purge-previous-model

Precheck：review.md 中 `VERDICT: APPROVE_WITH_CHANGES` 且 `CHANGES_APPLIED: yes`。场景与测试的对应关系见 [test-plan.md](test-plan.md)，方案见 [design.md](design.md)。每组做完后运行 `cd packages/dsh-pet && npx vitest run <相关文件>`，最后统一跑一次全套。

## 1. 基线

- [x] 1.1 运行 `npm run typecheck` 和全套 `npm test`，记录基线（通过数、失败数、跳过数），作为后面"没有新增失败或跳过"的对照

## 2. 共享校验与 v19 schema（D3.3、D6）

- [x] 2.1 写失败测试：`validateLocusSetForStorage` 的单元测试，覆盖无配对、非 tier3 marker、active 缺 marker、代际断档、`parentLocusId` 指向缺失行，以及合法的历史前缀删除
- [x] 2.2 在 `persistence.ts` 中导出纯函数 `validateLocusSetForStorage(rows, mainIds)`，内部复用 `normalizeRecord` 与 `assertLocusSet`，再加上配对检查，使 2.1 通过
- [x] 2.3 写失败测试：locus-persistence-v19「safe-v1 行继续服务」「升级前的 legacy child 不可恢复服务」「非 tier3 marker 使 Domain 打开失败」「合规数据正常就绪」。非法行通过原始 SQLite 播种
- [x] 2.4 实现：`spec.ts` 中 `PET_DOMAIN_VERSION = 19`，`childComposition` 枚举收窄为 `tier3`，superRefine 要求 active 行必须有 marker；同步 `aggregate.ts`、`composition.ts`、`context.ts`、`wire.ts` 的类型，使 2.3 通过
- [x] 2.5 写失败测试：「未创建 child 的历史行可以没有 marker」的持久层部分（stopped/invalid 且无 marker 的行可以打开）
- [x] 2.6 实现：放宽 `aggregate.ts:598-617` 一带的约束，使 2.5 通过
- [x] 2.7 重构：版本号固定在旧值的既有测试（migration-guidance、pet-storage-backend、intent-triage-domain-contract）改为 19；带 `safe-v1`/`safe-v2` 或 active 缺 marker 的普通 fixture 改为合法的 tier3 + 配对（D7.10）；相关文件保持绿

## 3. 启动：提前修复索引与配对检查（D2、D6）

- [x] 3.1 写失败测试：「无配对的行使启动对账失败」「启动早期的冷恢复不读到悬空索引」
- [x] 3.2 实现：抽出不可重入的内部方法 `repairDerivedIndexesLocked`；公开的 `repairDerivedIndexes()` 走 enqueue；`reconcileStartup` 在 enqueue 内直接调用内部方法，并在开头检查配对；`index.ts` 在构造持久层之后、注册 `agent/created` 之前调用一次 `repairDerivedIndexes()`
- [x] 3.3 重构：相关文件保持绿

## 4. 迁移脚本（D2–D4）

- [x] 4.1 写失败测试（migrate-cli）：「dry-run 列出将删除的行且不写入」「未确认时不写入」「已是目标版本时无操作」
- [x] 4.2 实现预检：只读查询，不做 checkpoint，计算 L 并输出清单
- [x] 4.3 写失败测试：「存在非终态投递时拒绝」「存在未完成的操作时拒绝」「保留行不满足 v19 条件时拒绝」「删除中间代际造成断档时拒绝」，以及终态集合与 `TERMINAL_STATUSES` 一致
- [x] 4.4 实现 D3 拒绝条件：通过 `new URL('../lib/...', import.meta.url)` 导入 `validateLocusSetForStorage` 和 `petLocusRecord`；拒绝信息中写明恢复债的处理方式
- [x] 4.5 写失败测试：「确认后清除旧模型数据」「切换通知按 locusId 精确删除」「从更早版本迁移时全部 locus 行都是旧模型」「升级需离线迁移并先备份」（改写）「未创建 child 的历史行可以没有 marker」（脚本部分）
- [x] 4.6 实现 `--yes`：持有独占锁直到提交；在锁内复读版本、表形状和数据并重新判定；checkpoint；写备份；在单个事务内补建 `locus_mains`（版本 ≤17 时）、按字段精确删除、改版本号为 19
- [x] 4.7 写失败测试：「预检通过后出现非终态投递时锁内拒绝」「预检后版本已变化」
- [x] 4.8 实现：锁内拒绝时不做 checkpoint、不写备份，确保 4.7 通过
- [x] 4.9 写失败测试：「迁移后的库能打开并完成启动对账」「删除历史前代后保留行仍可服务与重建」「非 locus 表不受影响且仍可读取」（locus-persistence-v19）
- [x] 4.10 实现或修复上一项暴露的问题
- [x] 4.11 写失败测试：「已安装的命令在仓库外可用」（打包后在临时目录生产安装，从仓库外的 cwd 调用 `.bin`）
- [x] 4.12 实现：把 `zod` 移到 `dependencies` 并更新 lock，使 4.11 通过
- [x] 4.13 重构：更新脚本头注释与 `--help`；相关文件保持绿

## 5. 删除 L2 分支（D7）

- [x] 5.1 写失败测试：「safe-v1 入口请求 shell」（locus-control，入口不存在）、「从未建立 locus 主会话的会话首次打开 Q&A」、「chat_bindings 退休标记仍然生效」、「旧 fork child 不受影响」（改写），以及「主会话 preset 不影响子会话工具面」「冷恢复不回落到父组合」（改写为 locus-child）
- [x] 5.2 实现：按 D7.1–D7.9 删除 controller、persistence、serviceability、resolution、admission（只删 L2）、index、adapter、reconcile、tool-tier-mutation、control、management 中的两层模型分支；adapter 区分"没有 M"与"有行但缺配对"；子会话 preset 相关代码按现有 0.2.1 实现核对，规范之外不改行为
- [x] 5.3 删除只断言 L2 行为的测试（`locus-legacy-retire.test.ts` 全部，以及 5.2 中暴露出来的其它测试）；逐条记录文件名与测试名，以及它对应的 REMOVED requirement 或改写场景，供写 verify 用
- [x] 5.4 重构：`npm run typecheck` 通过；相关文件保持绿

## 6. 补齐既有场景的表征测试

- [x] 6.1 写测试「主会话无法回答」「用户主动查阅受实际能力约束」「冷恢复保留独立历史」「重建不继承 shell」。若测试第一次运行就是绿的，先临时反转断言确认它能失败，再恢复
- [x] 6.2 若测试暴露了实现缺口：先停下，按 apply 的 spec drift 规则处理，不擅自修改行为

## 7. 收尾

- [x] 7.1 在 `packages/dsh-pet` 跑 `npm run typecheck` 和全套 `npm test`；在仓库根跑 `npm test` 和 `npm run check:artifacts`。与 1.1 的基线相比，不允许新增失败或跳过
- [x] 7.2 把 test-plan 中每一行的状态更新为 🟢 green
- [x] 7.3 运行 `openspec validate pet-locus-purge-previous-model --strict`
- [x] 7.4 写 verify.md：记录全套测试结果、删除的测试清单和交付状态。不部署，不对线上库执行迁移
