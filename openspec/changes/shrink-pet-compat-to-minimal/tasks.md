## 1. 冻结基线与目标身份

- [x] 1.1 记录当前 compat 身份到 `checking/baseline-compat-identity.md`：两个 patch 的 SHA-256、launcher fingerprint、`.launcher` 与 profile 两条通道各自的 `dsh_compat`（`replaces`/`upstreamTag`/`upstreamBase`/`patchSha256`）、能力 marker 清单（5 项）
- [x] 1.2 记录升级前 Pet 能力基线：locus 创建、冷恢复、飞书端到端、inquiry fail-closed 状态、Pet 测试套件通过数，作为每批次的回归对照
- [x] 1.3 确认与 `pet-locus-independent-agent-inquiries` 的 single writer 边界：列出共享文件清单，确认该 change 当前无在途编辑

## 2. 部署侧 provenance 校验（先行，独立于批 B）

- [x] 2.1 在 `scripts/sync.mjs` 的 `compatDependencies` 新鲜度判定中加入 `dsh_compat.upstreamBase` 与 patch 身份比对，不一致时 fail closed 并给出明确诊断
- [x] 2.2 为该校验补根测试：名称与路径不变但 `upstreamBase` 不同时必须判定需重新物化
- [x] 2.3 用该校验复现并修复现网漂移（profile 侧 `0.1.2-rc.1-locus-atomic.1` → 与源产物一致），记录修复前后 provenance 到 `checking/deployed-overlay-drift.md`
- [x] 2.4 验证 `sync` 连续两次幂等，第二次不产生变化

## 3. 批 A：移除未启用的 isolateQueuedTurnClaim 负债

- [x] 3.1 确认该 seam 在生产从未启用：记录 `build-launcher.cjs` 的 `overrideRuntimeAgent = false` 与其注释所述 npm arborist 崩溃原因到 `checking/batch-a-unused-seam.md`
- [x] 3.2 从 `settlement-notice.patch` 中移除 `isolateQueuedTurn` / `isolateQueuedTurnClaim` 相关 hunks（`agent-loop/src/inbox.ts`、`agent-loop/src/agent.ts`、`agent/src/runtime-types.ts` 及其测试）
- [x] 3.3 移除 `agent-artifacts/` 构建路径、`overrideRuntimeAgent` 开关及 launcher 中对应的 marker 校验与 Inbox 行为实验
- [x] 3.4 重建 launcher，验证构建成功、`--version` 相符、能力 marker 集合按预期从 5 项缩小
- [x] 3.5 跑 Pet 测试套件与根测试，确认 inquiry 的 fail-closed 行为与 1.2 基线一致

## 4. Spike 环境与静态核验（先于一切运行时核验）

- [x] 4.0 建立隔离核验环境：独立 `DSH_HOME`、独立端口（非 3080）、独立缓存；不触碰现网 Host 与生产 Pet 数据。记录环境身份到 `checking/spike-environment.md`
- [x] 4.a 静态核验（只读，不需运行时）：对照目标版本已发布类型声明逐条确认 `spec.childId`、`toolFilter` 持久化、`composeFrom` bind 语义、`announced` 语义，产出 `checking/spike-static-api-evidence.md`，作为后续运行时核验的预期基准
- [x] 4.b 列出全部待确认事项清单并逐项标记「静态已确认 / 需运行时验证 / 阻塞」，coding 开始前该清单 MUST 无「阻塞」项

## 5. 批 B 核验：storage 自持可行性（准入闸，失败则保留 patch）

- [x] 5.1 在隔离环境证明自持介质的跨表写入全有或全无：部分暂存后失败时，该次全部改动不可见
- [x] 5.2 证明介质独占：第二个进程尝试写入时明确失败且可诊断，不并发写入
- [x] 5.3 证明保证不可得时 fail closed：模拟无法取得原子提交或独占时，写入路径拒绝执行而非降级
- [x] 5.4 证明 `ctx.on('domain/changed')` 对 workspace 域的订阅不受 Pet 介质变更影响
- [x] 5.5 将 5.1–5.4 结果写入 `checking/batch-b-self-hosted-storage.md`；任一项失败则停止批 B 并保留 `storage-atomic.patch`，记录失败证据

## 6. 批 B 实施：storage 自持

> **前置条件（实测修正）**：Pet 的 SQLite 库由运行中的 Host 以
> `PRAGMA locking_mode = EXCLUSIVE` 独占，`node:sqlite` 的 `backup()` 因此拿不到
> 读句柄，报 `ERR_SQLITE_ERROR: "not an error"`。备份与落地切换**必须在停机窗口
> 进行**，这是介质独占的必然推论而非可绕过的步骤。又因本仓库 agent 运行在该 Host
> 内、停机会一并终止执行者，故本批拆成**代码段**（6.1–6.5，不触碰生产库）与
> **落地段**（6.6–6.7，操作者在停机窗口执行）。

- [x] 6.1 实现窄门面，对外保持 `table()` / `global` / `transaction()` 形状，底层持有自有 SQLite 句柄，使用原生 `BEGIN IMMEDIATE`/`COMMIT` 与 `PRAGMA locking_mode = EXCLUSIVE`
- [x] 6.2 保留四个 store 类的 `supportsTransaction` fail-closed 分支（介质异常时仍应生效），不删除其拒绝路径
- [x] 6.3 删除 `storage-atomic.patch`、`build-storage.mjs`、`.storage-upstream` 克隆逻辑与 `dsh.yaml` 的 `compatDependencies` 条目；移除 2.1 新增的校验代码（机制随之退役）
- [x] 6.4 为门面补单元测试（原子性 / 介质独占 / 保证不可得时 fail closed），并做变异测试证明判别力
- [x] 6.5 跑 Pet 全量与根测试，确认与 1.2 基线一致；确认 `scripts/migrate-state-version.mjs` 的停机迁移约束仍成立且文档同步
- [ ] 6.6 【停机窗口·操作者】备份生产库并校验完整性，记录恢复命令
- [ ] 6.7 【停机窗口·操作者】重启 Host，验证恢复未完成 Task/Invocation，数据与 6.6 备份一致

## 7. 批 C 核验：官方 subagent API 等价性（准入闸，逐项独立）

- [x] 7.1 证明 `startContinuable({ childId })` 在 Pet 的 `prepareContinuable → startContinuable` 链路上真实可用，且返回 `childId` 与传入值相等
- [x] 7.2 证明官方 `toolFilter` 在创建与冷恢复两条路径上都生效，descriptor 往返保持 `allow`/`deny`
- [x] 7.3 证明 `composeFrom` 的 bind 语义在 `dsh-pet-executor` 自定义 preset 下一致：父在 child 存活期间切换 preset，child 组合不变
- [x] 7.4 证明移除 `independent-v1` 后 `attestLocusComposition` 仍能拦截 own 层注册的越界工具（针对历史 `subagent` 穿透事故构造用例）
- [x] 7.5 将 7.1–7.4 结果写入 `checking/batch-c-official-subagent-api.md`；任一项失败则该项保留 patch 并记录失败证据，其余项仍可推进

## 8. 批 C 实施：child 创建路径改用官方 API

- [ ] 8.1 将 locus child 创建从 `createIdleContinuable` 改为官方 `startContinuable` 并传入预留 `childId`；保留"身份不符即拒绝"的既有校验
- [ ] 8.2 改用官方 `toolFilter` 与 descriptor 持久化，移除自建持久化路径
- [ ] 8.3 移除 `contextMode: 'independent-v1'` 及其能力 marker 门禁，改为依赖官方 `composeFrom` bind 语义
- [ ] 8.4 **不改动** `attestLocusComposition` 与 `dsh-pet-executor` preset；提交前 diff 复核确认这两处零改动
- [ ] 8.5 从 `settlement-notice.patch` 移除 7.1–7.3 对应的 hunks，仅保留 settlement 相关改动
- [ ] 8.6 验证创建、冷恢复、父 preset 切换隔离、工具面核验四条路径与 1.2 基线一致

## 9. 收敛 compat 并更新治理记录

- [ ] 9.1 将 `settlement-notice.patch` 收敛为单一改动（`notifySettlement` 早返回，即 silent 形态；`inject` 方案已在 design Open Questions 中排除），仅作用 `@deepseek-ai/dsh-subagent`
- [ ] 9.2 重新固定 patch SHA、upstream base、launcher fingerprint 与能力 marker（缩至 1 项），更新 `compat/subagent/README.md`
- [ ] 9.3 将 `dsh.yaml` 的 `removeWhen` 改为可验证措辞，显式记录"该需求尚未向上游报告；上游不接受外部 PR，唯一通道是 Discussions"
- [ ] 9.4 确认 `hostRuntimeCompatibility` 的 fail-closed、版本精确相等、唯一依赖实例校验全部保留且仍生效
- [ ] 9.5 验证官方一次性 CLI（build / plugin / dump-config）仍使用官方精确 `dshVersion`，不构建 overlay

## 10. 全量回归与验收

- [ ] 10.1 跑 `npm test`、`npm run check:artifacts`、Pet 包 build / typecheck / test 与 collaboration-runtime 套件
- [ ] 10.2 `node scripts/sync.mjs` 连续两次，确认幂等
- [ ] 10.3 启动清单核对：加载行数、无重复 id、compat runtime 身份与 8.2 记录一致
- [ ] 10.4 真实 locus 端到端：飞书入站 → child 创建 → 工作 → 结算，确认父会话进行中轮次未被打断
- [ ] 10.5 多 locus 场景：同一主会话关联多个 locus 先后结算，确认打断次数为零
- [ ] 10.6 回滚演练：验证任一批次可独立回滚，storage 批次先停 writer 再恢复数据备份
- [ ] 10.7 将最终 compat 规模（包数 / patch 数 / hunks / 磁盘）与基线对比写入 `checking/final-compat-footprint.md`

## 11. 上游报告与收尾

- [ ] 11.1 按 `upstream-discussion-draft.md` 复核引用对 `dsh-v0.1.5-rc.2` 仍成立，确认 #5360 当前状态，完成脱敏检查
- [ ] 11.2 经用户确认后发布到上游 Discussions，记录编号与链接
- [ ] 11.3 将 discussion 编号回填到 `proposal.md` Impact 段与 `dsh.yaml` 的 `removeWhen`
- [ ] 11.4 确认 current specs 已反映最终行为后归档本 change
