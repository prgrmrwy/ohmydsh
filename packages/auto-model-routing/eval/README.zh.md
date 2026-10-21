# 判档规则回归

[English](README.md)

`cases.json` 收录 90 条用例，用于检验 `../src/rubric.json` 中的 Jev 判档规则：30 条合成样本（`t-`）；22 条在规则成稿后编写的合成样本（`h-`，也参与过草稿间的取舍，所以不算独立留出集）；38 条由本机真实回合改写的样本（`s-`，带上一轮文本，不含真实会话原文、会话 id、凭据或地址）。`exp` 列出可接受的档位，`prev`、`prevUser`、`prevAssistant` 模拟上一轮。

`run.mjs`（随实现一起编写）导入规则与生产环境的 `state` 构造函数，每条用例请求 Jev 三次取多数。它调用真实的 OpenRouter 接口，每跑一次约花 $0.005。

- 退出 0：所有未命中都在 `baseline.json` 里。
- 退出 1：`knownMisses` 之外有用例未命中（回归）；同时列出已从未命中变为命中的条目。
- 退出 2：有请求失败（不计为未命中）。

有意修改规则时，重跑一次，逐条检查结果变化的用例，再在同一个提交里更新 `knownMisses`。

## effort 起点的出处（2026-10-21/22 抓取）

- Anthropic effort 文档：<https://platform.claude.com/docs/en/build-with-claude/effort>。Opus 5.5 与 Haiku 5.5 默认 medium，其余默认 high；Sonnet 5.5 做 agentic coding 从 medium 开始；Fable 5.1 从 high 开始；xhigh/max 只用于实测有收益的工作。
- Anthropic 成本与能力：<https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence>。Opus 5.5 在 SWE-bench Pro 子集上 low/medium/high/xhigh 依次为 87.4/92.8/95.3/96.7%，每题 $0.11/0.21/0.29/0.74；“先用低档、失败再用 high 重跑”优于固定 high；派给便宜模型只在“常规工作且成本长尾”或“超过一个上下文窗口”时更省。
- Anthropic 选型：<https://platform.claude.com/docs/en/about-claude/models/choosing-a-model>。Haiku 用于子 agent 任务，Sonnet 用于日常编码，Opus 用于复杂的 agentic coding，Opus 在 xhigh/max 仍不够时换 Fable。
- Claude Code 博客：<https://claude.com/blog/claude-model-and-effort-level-in-claude-code>。多数任务用模型默认 effort，把 effort 当作整体偏好。
- OpenAI reasoning：<https://developers.openai.com/api/docs/guides/reasoning>。agentic coding 默认 medium；xhigh 要有评测证明收益。
- Codex 模型与子 agent：<https://developers.openai.com/codex/models>、<https://developers.openai.com/codex/subagents>。多数任务从 gpt-6.1-sol 开始，Luna 用于范围窄的工作；显式设置时 Luna 从 high、Astra 从 low 开始。
