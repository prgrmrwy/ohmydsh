## Why

Phase 1 已证明 Jev shadow 调用和聚合报告可用，但 Phase 2 必须区分真实使用与 synthetic fixture，并测量 p50/p95 latency；当前 recorder 不保存 provenance，并把缺失 latency 留为永久 unavailable。即使未来积累到 100 条记录，准入仍无法证明这些记录来自真实使用或满足延迟门槛，因此必须先修复测量合同，同时继续保持 shadow-only。

## What Changes

- 将 recorder 升级为新的版本化记录 schema，增加有界枚举 `sampleProvenance`，并把 latency 表达为明确的 measured/unavailable 状态，而不是以 `0` 兼作占位。
- 为既有 schema-v1 记录提供保守兼容读取：缺失维度保持 `unknown`/`unavailable`，不猜测来源或延迟，也不改写历史文件。
- 扩展 aggregate report，按 provenance 输出覆盖，并让所有 Phase 2 强制门槛由机器可判定的 pass/fail/unavailable 结果组成；任一 unknown/unavailable 继续阻止准入。
- 在 router skill 中规定如何标注 `real-vibe`/`synthetic-fixture`，以及如何在调用点用单调时钟测量完整 shadow call latency；这些字段不发送给 Jev，且不保存原文。
- 删除语言分类和中英文样本门槛；报告不采集、推断或按语言拆分请求。
- 保留 Phase 1 shadow-only、用户/既有 change 权威、失败回退、隐私边界和显式 Phase 2 批准要求；本 change 不启用 advisory 或自动路由。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `jev-workflow-routing`: 使已经登记的 Phase 2 数据集与质量门槛可被安全采集和机械评估，同时兼容现有本地记录且不扩大 Jev 输入面。

## Impact

- `skills/jev-workflow-router/SKILL.md`：补充有界测量字段和调用点计时规则。
- `skills/jev-workflow-router/recorder.mjs`：记录 schema 迁移、兼容读取、报告维度和 admission 判定。
- `tests/jev-workflow-router*.test.mjs`：覆盖 v1 兼容、隐私、provenance/latency coverage 与不可准入条件。
- 本地 `$DSH_HOME/state/jev-workflow-router/records.v1.jsonl`：只读兼容，不原地迁移或回填未知事实；后续记录采用新 schema。
- 不增加依赖，不改变 Jev MCP/Anvil/spec-superflow pins，不创建自定义 OpenSpec schema。
