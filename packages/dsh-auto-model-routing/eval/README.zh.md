# Jev 规则核对

[English](README.md)

`cases.json` 收录 18 条合成任务（分 development 与 holdout），每条都带独立编写的能力与投入预期，用于核对[判档预设](../docs/presets/README.zh.md)。`capability`/`depth` 是所有预设的共同期望；`depthFor` 按预设 id 覆盖 depth 期望；`execution` 取 `main` 或 `delegated`（缺省），决定 state 按主会话首回合还是子任务构造。

`live.mjs` 把它们发送到真实的 OpenRouter 决策接口，带硬性预算（单次运行最多 20 次调用、$0.10），并在本地写出报告，不含合成用例以外的任务文本。它是手动、付费的核对，不属于 `npm test`：

```bash
npm run build                      # live.mjs 复用 lib/ 里的 buildState，保证与运行时发送的 state 一致
node eval/live.mjs --preset effort-as-verification <新结果文件>
```

- `--preset` 缺省为缺省预设 `reasoning-depth`；未知 id 在任何网络请求和创建结果文件之前退出。
- 报告顶层记录 `preset`，每条结果记录 `execution` 与实际用于判命中的 `expected`。
- 一次运行只评一个预设。重放多次检验稳定性会超出单次上限，需要另行授权。

早期四档回归集（`run.mjs`、90 条用例与 `baseline.json`）已在 0.5.0 随四档链路删除；如需使用，请安装 0.4.x 版本的包。

## effort 起点的出处（2026-10-21/22 抓取）

起点数值本身写在策略文件 `../src/strategies/` 中。

- Anthropic effort 文档：<https://platform.claude.com/docs/en/build-with-claude/effort>。Opus 5.5 与 Haiku 5.5 默认 medium，其余默认 high；Sonnet 5.5 做 agentic coding 从 medium 开始；Fable 5.1 从 high 开始；xhigh/max 只用于实测有收益的工作。
- Anthropic 成本与能力：<https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence>。Opus 5.5 在 SWE-bench Pro 子集上 low/medium/high/xhigh 依次为 87.4/92.8/95.3/96.7%，每题 $0.11/0.21/0.29/0.74；“先用低档、失败再用 high 重跑”优于固定 high；派给便宜模型只在“常规工作且成本长尾”或“超过一个上下文窗口”时更省。
- Anthropic 选型：<https://platform.claude.com/docs/en/about-claude/models/choosing-a-model>。Haiku 用于子 agent 任务，Sonnet 用于日常编码，Opus 用于复杂的 agentic coding，Opus 在 xhigh/max 仍不够时换 Fable。
- Claude Code 博客：<https://claude.com/blog/claude-model-and-effort-level-in-claude-code>。多数任务用模型默认 effort，把 effort 当作整体偏好。
- OpenAI reasoning：<https://developers.openai.com/api/docs/guides/reasoning>。agentic coding 默认 medium；xhigh 要有评测证明收益。
- Codex 模型与子 agent：<https://developers.openai.com/codex/models>、<https://developers.openai.com/codex/subagents>。多数任务从 gpt-6.1-sol 开始，Luna 用于范围窄的工作；显式设置时 Luna 从 high、Astra 从 low 开始。
