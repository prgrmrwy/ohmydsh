# Design

## Context

`skills/jev-workflow-router/SKILL.md:96,109` 用「MCP 的保守默认」写门槛，而该默认 `0.85` 是 classify 的 `auto_accept`（作用于 `top_probability`），不是 `confidence` 的门槛——实测同一次结果 `top_probability 0.86` 对应 `confidence 0.79`。recorder 不重算门槛，`conservativePass` 只校验布尔与形状（`recorder.mjs:393-399`）。动机见 `proposal.md`，行为契约见 `specs/jev-workflow-routing/spec.md`。

## Goals / Non-Goals

**Goals:** 让 advisory 在 Jev 确实明确时真的出一行；门槛显式、可回归。 **Non-Goals:** 不改触发时机、不加宿主钩子、不改 recorder schema/报告、不提高自动化等级、不重写历史记录。

## Decisions

1. **门槛取 `confidence >= 0.50` 且 `margin >= 0.50`，不用 0.85**。spec 既有场景把可见区间夹在 (0.45, 0.77]；0.50 同时等于 Jev 的 `minimum_margin` 默认值。否决「直接用 classify `decision === 'auto'`」：`jev_decide` 不返回该字段，两阶段口径会分裂。
2. **两阶段各自过门槛**，第二阶段不过则整体沉默；`jev_decide` 无 `margin` 字段，按其 `workflowProbabilities` 最大与次高之差计算，未来若返回 `margin` 则优先使用。
3. **`requirementChecks` 同口径**：`confidenceMet = confidence >= 0.50`，`marginMet = 上述 margin >= 0.50`；recorder 代码不变。

## Risks / Trade-offs

- 建议行变多 → 仍是单行、可无视、非阻断。
- 0.50 偏松或偏紧 → 由 spec 锚定；调门槛需再开 change；`report` 的 `needsReviewRate`/错配率是反馈。
- 历史 2 条记录仍为 `needs-review` → 按 spec 保守读取，不重写。

## Migration Plan

改 `SKILL.md` 与测试 → `node scripts/sync.mjs` 两次 →（由用户决定是否重启）真实决策点观察。回滚只需回滚 `SKILL.md`；无数据迁移。
