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

2026-10-19 提交前复查：类型检查、compat packaging 及两个结构/CLI 检查、OpenSpec strict validate、tracked-artifacts 和 diff whitespace 检查通过。受管守卫测试为 13 通过、1 失败：最后新增的实际原生所有者集成用例在加载阶段报 `ReferenceError: createRequire is not defined`。这是本 WIP 明确保留的待修问题，不能声称该新增用例已验收。本次未重新运行全量测试。

## 必须继续完成

- 生产入口尚未调用询问组合工厂；只读 owner 接线不是完整 queue consumer 接线。完整 readiness、原生及 Pet 自有受管入口覆盖仍须一起验证。
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
