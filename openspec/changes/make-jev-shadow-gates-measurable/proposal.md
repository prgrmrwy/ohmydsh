## Why

Phase 1 已证明 Jev shadow 调用和聚合报告可用，但 Phase 2 的预登记准入门槛包含语言覆盖、真实/合成样本 provenance 与 p50/p95 latency；当前 recorder 不保存前两者，并把缺失 latency 留为永久 unavailable。即使未来积累到 100 条真实记录，准入仍在机械上不可达，因此必须先修复测量合同，同时继续保持 shadow-only。

## What Changes

- 将 recorder 升级为新的版本化记录 schema，增加有界枚举 `language`、`sampleProvenance`，并把 latency 表达为明确的 measured/unavailable 状态，而不是以 `0` 兼作占位。
- 为既有 schema-v1 记录提供保守兼容读取：缺失维度保持 `unknown`/`unavailable`，不猜测语言、来源或延迟，也不改写历史文件。
- 扩展 aggregate report，按语言和 provenance 输出覆盖，并让所有 Phase 2 强制门槛由机器可判定的 pass/fail/unavailable 结果组成；任一 unknown/unavailable 继续阻止准入。
- 在 router skill 中规定如何从当前请求的确定性元数据标注 `zh`/`en`/`mixed`/`unknown` 和 `real-vibe`/`synthetic-fixture`，以及如何在调用点用单调时钟测量完整 shadow call latency；这些字段不发送给 Jev，且不保存原文。
- 保留 Phase 1 shadow-only、用户/既有 change 权威、失败回退、隐私边界和显式 Phase 2 批准要求；本 change 不启用 advisory 或自动路由。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `jev-workflow-routing`: 使已经登记的 Phase 2 数据集与质量门槛可被安全采集和机械评估，同时兼容现有本地记录且不扩大 Jev 输入面。

## Impact

- `skills/jev-workflow-router/SKILL.md`：补充有界测量字段和调用点计时规则。
- `skills/jev-workflow-router/recorder.mjs`：记录 schema 迁移、兼容读取、报告维度和 admission 判定。
- `tests/jev-workflow-router*.test.mjs`：覆盖 v1 兼容、隐私、枚举归一化、语言/provenance/latency coverage 与不可准入条件。
- 本地 `$DSH_HOME/state/jev-workflow-router/records.v1.jsonl`：只读兼容，不原地迁移或回填未知事实；后续记录采用新 schema。
- 不增加依赖，不改变 Jev MCP/Anvil/spec-superflow pins，不创建自定义 OpenSpec schema。
