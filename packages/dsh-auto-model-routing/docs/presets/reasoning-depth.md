# 预设 `reasoning-depth`（缺省）

规则文件：[rubric.json](../../src/presets/reasoning-depth/rubric.json)。这是 0.6.6 及更早版本里唯一的 `src/rubric.json`，原样迁移过来，字节完全相同，sha256 与 [routing-oracle-0.4.2.json](../../test/fixtures/routing-oracle-0.4.2.json) 的 `rubricSha256` 一致。不启用任何上下文行，所以选它时发给 Jev 的 `questions` 和 `state` 与之前完全一样。

## 要点

- **capability**（只问子任务）：判断完成任务所需的最低模型能力，不看工作量、风险或重要性。
- **depth**：判断推理投入。`lower` 只用于琐碎的检索、复制或完全给定的机械步骤；`higher` 用于需要格外仔细的多步推理、困难约束协调或精细证明的任务；其余情况，以及证据不足时，都是 `baseline`。工作量和风险本身不提高 depth。

## 来源与证据

- 设计与小样本核对：[Jev 判档验证记录](../jev-policy-v2-validation.md)（2026-10-24），以及 [eval](../../eval/README.md) 中的 10 条合成用例。
- 这些只能说明接口可用、分类结果一致，不能说明实际任务质量更好或成本更低。

## 与 `effort-as-verification` 的差异

| | `reasoning-depth` | `effort-as-verification` |
|---|---|---|
| depth 衡量什么 | 推理难度 | 验证、边界情况测试与自主判断的投入 |
| 有人复核的快速首轮 | 通常是 `baseline` | 可以判 `lower` |
| 边界情况密集的工作（解析器、安全审查、已有代码里的 bug） | 只有推理也难时才是 `higher` | `higher` |
| `Execution` 上下文行 | 不加 | 加 |

## 已知限制

- 判档标准把"难"和"需要多验证"混在一起，安全、并发这类任务可能被判低。
- 历史上曾把有风险但不难的任务判高；现行规则已明确风险不提高 depth。
