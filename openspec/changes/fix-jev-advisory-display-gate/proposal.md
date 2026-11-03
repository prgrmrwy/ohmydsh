# Proposal

## Why

`jev-workflow-router` 的 advisory 建议在真实使用中从未出现过：2026-10-30 之后 4.6 天没有新增路由记录，全历史仅 2 条 `real-vibe` 记录且 2/2 都是 `needs-review`，真正出现在回复里的建议行是 0 行。

根因不是没接线，也不是 Jev 不可用，而是实现与自身 spec 冲突：当前 spec 的两个场景明确要求 `confidence 0.77 / margin 0.70` 时输出建议、`confidence 0.45 / margin 0.37` 时保持沉默；但 `skills/jev-workflow-router/SKILL.md:96,109` 把显示门槛写成「confidence 与 margin 达到 MCP 的保守默认」，而该默认 `0.85` 是 Jev 对 `top_probability` 的 auto 门槛，并不是 `confidence` 的门槛。于是 Jev 已经判定 `decision: auto` 的结果（实测 `top_probability 0.86`、`margin 0.73`、`confidence 0.79`）仍被静默吞掉并记成 `needs-review`，advisory 在结构上无法产生任何可见输出。

## What Changes

- 把显示门槛改为显式、本地的两个数值：决定该候选的 Jev 结果 `confidence >= 0.50` 且 winner margin `>= 0.50`，不再引用含义不同的 `auto_accept = 0.85`。该口径同时满足 spec 现有两个场景（0.77/0.70 显示、0.45/0.37 沉默）。
- 明确 `mcp__jev__jev_decide` 不返回 margin 字段，因此第二阶段按 `workflowProbabilities` 的最高与次高概率差计算 winner margin；`marginMet` 以该计算值为准。
- 让 recorder 载荷里的 `confidenceMet` / `marginMet` 与新口径一致，使高置信度判断能真正落成 `auto-candidate`，`report` 的建议/实际不一致率不再被系统性清零。
- 在 spec 中把这两个数值门槛写成可验证的 requirement，避免以后再次把 `top_probability` 的 auto 门槛误用到 `confidence`；并给既有「高置信度建议只出现一行」场景补上第二阶段数据，消除它与新门槛的歧义。
- **BREAKING**（面向本机可见行为）：Jev 明确的高置信度判断现在会真的输出一行建议。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `jev-workflow-routing`: advisory 的显示/记录门槛从「MCP 保守默认（实为 top_probability 的 0.85 auto 门槛）」改为显式的 `confidence >= 0.50` 与 `winner margin >= 0.50`，并补上 decide 阶段的 margin 计算口径。

## Impact

- `skills/jev-workflow-router/SKILL.md`：显示规则、`jevCalls`/`requirementChecks` 说明与示例。
- `openspec/specs/jev-workflow-routing/spec.md`：通过 delta 明确数值门槛；既有「高置信度建议只出现一行」场景补全第二阶段数据，语义不变。
- `tests/jev-workflow-router.test.mjs`：只断言 SKILL 文本的新口径（门槛不在 recorder 内计算，不给 recorder 增加无断言力的落库测试）。
- 不改 `recorder.mjs` 的阈值逻辑（它只校验布尔与形状，不重算门槛）；不改 `dsh.yaml`、不新增依赖、不扩大信任面。部署用 `node scripts/sync.mjs`（两次幂等；PATH 上的 `dsh build` 指向主 checkout，不适用于 worktree）。
