# 实施检查点（未完成、未部署）

本提交保存 `restore-pet-inquiry-runtime-channel` 的阶段性源码、兼容补丁和测试，不代表生产通道已恢复。需求为修复本机 `pet_inquire` 接受后未真实派发、无答案回送的问题，不修改远端机器或待办受理语义。

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

## 必须继续完成

- 询问生产工厂已接入入口，但 `resolveAgent` 只认已加载的 agent；未驻留的 child/父尚不能被冷恢复来接收询问。
- 精确 continuation-owned child 冷恢复、Delivery 来源及 finish/wait 的原回复权证明、运行槽与 lifecycle 在途的分别处理。
- 合法结果轮嵌套与三方完整答案闭环、证据驱动启动恢复、旧协议只读处置、迁移及故障边界验收。
- 原生所有者真实工具与 Pet 策略的直接集成测试已在源码中，须以新编译图验证，不用旧未标记图冒充。
- 完整生产接线、回归、规范对齐完成前，不勾选尚未满足的整项任务、不归档。

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

未切换正式 launcher、迁移正式数据库、重启 Host、推送远端或真实飞书外发。正式部署、历史两条询问处置及其副作用须另行确认。
