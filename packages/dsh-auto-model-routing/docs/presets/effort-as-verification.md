# 预设 `effort-as-verification`

规则文件：[rubric.json](../../src/presets/effort-as-verification/rubric.json)。需要在设置页主动选择才会生效，不是缺省预设。启用上下文行 `execution`。

## 来源

[Using Claude Code: Spending your effort](https://claude.dev/blog/spending-your-effort/)（Anthropic，2026-09-25）。数据来自 Anthropic 在 Terminal-Bench 3.0 上对 Opus 5.5 / Fable 5.1 的内部跑分，每题 5 次。这是厂商自己的数据，不代表本项目已经测出收益。

## 文章结论与对应规则

| 文章结论 | 本预设怎么用 |
|---|---|
| effort 调的是自我复查、先复现再修、对照参考实现、模糊测试、比较多种解读这些动作的量 | depth 衡量"下一步需要多少验证、边界情况测试和自主判断"，不衡量推理难度 |
| 提高 effort 能减少"漏掉边界情况"类失败，但修不了"方法选错" | 写明额外 effort 修不了方法选错；方法和领域规则选错的风险归 capability（换更强的模型） |
| 安全、硬件、ML、科学收益大；运维、媒体这类照章办事的工作收益小 | `higher` 列出边界情况密集的领域；规则驱动的运维工作留在 `baseline`；风险本身不提高 depth |
| 有人在旁边迭代时 low 合适 | `lower` 覆盖会有人复核并迭代的快速首轮：头脑风暴、草图、草稿、解释、小而明显的改动 |
| 需求写得越细，各档 effort 的产出越接近 | 规格完整的执行留在 `baseline` |
| max 只用于完全自主的端到端任务 | 不改引擎：仍从模型推荐起点最多偏移一档，AUTO 不会自动选 max |

## `Execution` 行

判档输入的第二行是固定文本，只说明调用路径：

- 主会话：`Execution: main conversation.`
- 受管子任务与 `route_subagent`：`Execution: delegated subtask; the result returns to an orchestrating agent.`

这一行**不能**证明有没有人在逐步复核。主会话里也可能是"自主完成，不用我看"的任务；只有任务文本本身表明会有人复核并迭代时，才偏向快速首轮。插件不会因为调用路径做确定性的 depth 偏移。

## 与 `reasoning-depth` 的差异

见 [reasoning-depth.md](reasoning-depth.md#与-effort-as-verification-的差异)。

## 已知限制

- **没有本项目的真实判档证据**：要等用户授权后，用 `eval/live.mjs --preset effort-as-verification` 跑付费核对。下面的门槛只是参考值，不阻塞使用：在 18 条合成用例上，期望集合命中率不低于 `reasoning-depth` 在原 10 条上的命中率；`risk-not-depth` 和 `spec-feature` 不能判为 `higher`。重放 4 次的稳定性检验超出单次运行的上限，要另行授权。
- **GPT 家族**：文章只覆盖 Claude 模型，GPT 家族共用本预设属于未经验证的外推。
- **缓存**：文章说 Claude Code 调 effort 不破坏 prompt cache，DSH 适配器是否如此仍需实测。
