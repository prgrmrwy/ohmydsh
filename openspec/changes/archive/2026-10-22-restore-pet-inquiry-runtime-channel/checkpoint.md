# 实施检查点（已部署本机，已收尾归档）

本文件记录 `restore-pet-inquiry-runtime-channel` 的阶段性进度；通道核心已在本机真机恢复，剩余项见"必须继续完成"。需求为修复本机 `pet_inquire` 接受后未真实派发、无答案回送的问题，不修改远端机器或待办受理语义。

## 已实现及历史验收

- 原子 Domain 写入、版本 17 的答案、handoff、原工作及结果处置协议。
- 独立问题/结果 claim 的 AgentLoop compat；Tools 异步 wrapper 后最终 guard 重验；原生通信/委派工具的所有者标记及精确构建 provenance。
- 实际 AgentLoop、Tools、Domain 配合 fake LLM 的双向问答、无显式答复失败、真实循环拒绝，以及 A→B→C 的正向目标派发。
- 只读 owner 投影已接入生产管理路由，正文不暴露。
- 2026-10-15 的最近完整 Pet 回归为 3213 通过、8 跳过；host/client 类型检查及构建通过。独立编译图的问题链测试 7 项、受管守卫测试当时 13 项通过。
- 根仓回归当时 423 通过、2 跳过、1 失败：README 缺少 ponytail 与 ponytail-skills 的启用项说明，未在本 change 中修改。

以上数字是历史验收，不表示之后提交前所有检查均已重新执行。

2026-10-19 提交前复查（第一次检查点）：受管守卫测试曾为 13 通过、1 失败（测试文件缺 `createRequire` 等导入）。该问题已在第二次检查点修复。

## 第二次检查点（2026-10-19 16:50，生产入口接线）

`src/index.ts` 现在在生产入口构造 `composeProductionInquiry`，并通过 `agent/created` 对每个 agent 先安装受管守卫、再创建 inquiry adapter；缺任一能力均保持 fail closed。`answerStore`、实时 `ready`、`forExecution`、`afterAnswer`、`answerBinding` 已传入协作装配；Pet 自己的 finish/wait/request_execution 注册点已接受管入口。测试夹具 `loadPetHost` 抽到 `test/support/pet-host-fixture.ts`，并新增 `beforePet` 钩子。

本次独立验证（现役 launcher 编译图 `PET_INQUIRY_LAUNCHER=$(readlink -f compat/subagent/.launcher)`）：类型检查 0 错误；接线测试 4/4；询问问答链路 7/7；受管守卫 14/14；默认全量套件 3213 通过、8 跳过、0 失败（181 文件通过）。接线测试证明：无 AgentLoop 时 owner 视图为 unavailable，执行 `pet_inquire` 返回 `Inquiry runtime unavailable` 且 inquiries 表无新行；装入真实 AgentLoop 后为 available；主会话重复发布幂等；未经 `agent/created` 的作用域没有 `pet_inquire`。

已知限制：接线测试没有“守卫先于 adapter”的观察点，该顺序仅由源码审读保证；locus child 重复发布会触发一个与本改动无关的既有重复注册（`pet_collaboration_context`，接线前后行为一致），因此幂等用例用主会话。

## 第三次检查点（2026-10-20，部署与真机）

提交 `71bacb23` 冷恢复解析器、`949e55d8` adapter 随 agent 释放、`cb819705` locus child 不得声称私有本地受众、`0b2910ff` 结果轮凭持久证明恢复原 Delivery 回复权、`a13aa67c` 真实会话重放。独立验证：Pet typecheck 0 错误，默认全量 3302 通过、8 跳过，编译图 production 10、wiring 4、managed-effects 14。

真机（用户 10-20 11:10 启动的旧构建）：两个群各一次 child→main 询问，问题派发、主会话显式回答、结果轮回到 child 全部成功，证明原"accepted 但无 inbox/turn"已修复；最后一步回群均被拒（`finish:mixed-source`），即 `0b2910ff` 修复前行为。重放测试在修复前复现、修复后通过。用户 16:06 重建重启后，普通群回复正常；同群被卡住的 Delivery 会让后续消息排队到软期限（delivery-75 堵到 16:30）。

2026-10-21 11:10 真机验证：「Pet Locus shell-tier test」群重建后，child 经 `pet_inquire` 问主会话，主会话 `pet_inquiry_answer` 显式回答，结果轮 `pet_locus_finish` 成功回群（inquiry-dg0kbtt6tlq）。

## 必须继续完成

- 启动恢复执行器：今天重启日志 `recoverable=2` 只对账未续进（6.1/6.2）。
- 真实 child 冷恢复运行体验证（4.2）；readiness 覆盖全部受管入口（2.4/5.3）。
- 旧两条询问显式处置（6.4/8.5）；设置页展示（6.3）；完整 C→B→A 闭环（5.2）。
- 回群失败时不应静默占住队列（候选新增项，未立项）。
- 完成前不归档；根 npm test、check:artifacts、strict validate 待重跑。

## 可复现验证

先运行 compat 的独立构建，再从 Pet 包目录设置 `PET_INQUIRY_LAUNCHER` 为该编译图的 launcher 目录：

```sh
node packages/dsh-pet/compat/subagent/build-launcher.cjs --isolated-output /absolute/new-or-empty-directory
# 以下命令在 packages/dsh-pet 目录执行
PET_INQUIRY_LAUNCHER=/absolute/output/launcher npx --no-install vitest run --config vitest.inquiry-production.config.ts --testTimeout 12000
PET_INQUIRY_LAUNCHER=/absolute/output/launcher npx --no-install vitest run --config vitest.inquiry-managed-effects.config.ts
npm run typecheck
npm run build:host && npm run build:client
npx --no-install vitest run
```

编译图和构建产物不提交。临时探针、迭代反馈和原始会话证据不纳入本检查点提交。

## 安全与部署边界

A 边界只硬守 Host 管理的入口，不承诺 shell/脚本/HTTP 内部任意效果隔离。保留 parent 正常工具及 child 现行 safe composition。

本机 v15→v17 迁移与 10-20 两次重建重启均由用户执行；未推送远端，未操作 lumevm/devbox。历史两条询问已于 10-21 按所有者决定取消（tasks 8.5）。

## 收尾（2026-10-22，按 ponytail 评审缩小范围）

- 冷恢复：`resume-model.ts` 让冷恢复的主会话与待办执行会话沿用会话自身 modelSelection（pending → lastUsed → Host 默认），不再被切到用户最新选的模型；编译图用例用真实 jsonl 持久化驱逐请求方后由答案触发冷恢复并续进，变异（禁用冷恢复）使其失败。
- 重启中断：目标已 claim 未答复时重启，对账生成的 needs-review 失败结果因无结果 handoff 被规划器判为不一致、永远卡住。`recovery.ts` 新增"结果尚未预留"分支交还请求方；编译图用例修复前失败、修复后请求方恰好收到一次、目标不重跑；规划器单测含换人与未就绪分支。
- 删除死代码：`scheduler`/`continuation`/`effect-fence`/`disposition-store` 四模块与 `outbox.ts` 续进校验/进度视图，及其测试（生产无引用）。
- 验证：Pet typecheck 0；默认全量 195 文件 / 3356 通过 8 跳过；编译图 production 15、wiring 10、managed 14 全过；根 npm test 445 通过 0 失败 2 跳过；check:artifacts、diff --check、strict validate 通过。
- 部署：`dsh build` 第一次重装 dsh-pet、第二次 no changes；部署 `resume-model.js`/`recovery.js` 与仓库构建同哈希，死模块已不在部署目录。脱离进程组 `dsh restart --no-open` exit 0，旧 PID 57632 退出、新 PID 89964 监听；启动日志 reconcile/startup-recovery 全 0、ready、订阅 connected、无 degraded。
- 未做（见 tasks 删线项）：审计记录、三层逐层回传、各边界逐一崩溃证明等，评审判定为过度设计或已有覆盖。冷恢复与重启中断两项均为编译图证据，未在真机复现。
