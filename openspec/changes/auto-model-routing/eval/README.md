# 判档规则评估资产

本目录存放 `TIER_QUESTIONS`（design D4）的回归资产。规则只有一处可调：`rubric.json` 与源码常量逐字相同（spec 场景“规则文本与评估资产一致”），版本号随判档记录保存（design D13）。

| 文件 | 内容 |
|---|---|
| `rubric.json` | 当前规则 `v6` 的 `questions` 原文 |
| `synthetic-tune.json` | 合成调优集 30 条（编写规则时边看结果边改） |
| `synthetic-holdout.json` | 合成验证集 22 条（规则定稿后新写，事先标好期望） |
| `session-derived.json` | 由本机真实回合**改写**的 38 条，含上一轮用户文本与助手回复片段；不含真实会话原文、凭据或地址 |
| `run.mjs` | 零依赖回归脚本，调用真实 OpenRouter（约 $0.00002/次） |

运行：`OPENROUTER_API_KEY=... node run.mjs [--runs 2]`。`exp` 可以列多个可接受档位；`prev`/`prevUser`/`prevAssistant` 模拟上一轮。脚本的 `state()` 与 spec“Jev 判断档位”的格式相同，二者改动须同步。

## 基线（2026-10-22，规则 v6，每条 2 次）

| 集合 | 结果 | 不符合的条目 |
|---|---|---|
| synthetic-tune | 60/60 | — |
| synthetic-holdout | 42/44 | h16（升级 DSH 并修插件兼容性）判 standard，期望 complex |
| session-derived | 62/76 | r05、r23、r26、r27 判 simple；r22 判 escalated；r32、r33 判 complex；另有 1 条两次不一致 |

session-derived 是改写稿：为去掉真实内容，消息与助手片段被缩短，Jev 能看到的上下文比原回合少，所以结果与下文“真实回合标注”不完全相同。它用作**回归基线**：改规则后各集合的符合数不应低于上表；低于时须逐条说明。

## 规则如何得出

1. **问题**：会话 `session-4390e037` 的运维请求在 Opus 5.5 上被设为 `max`。重放旧规则：`escalated` 49–55%。原因是旧 criteria 把 “High-risk, security, data migration” 列为 escalated。
2. **只看难度（v2）**：合成调优集 44/60 → 60/60；验证集 30/44 → 42/44（需在 `state` 给出“上一档的上一级”，否则“重做”在 standard/escalated 间摇摆）。
3. **看上一轮问答（v4）**：本机 493 个真实用户回合按会话顺序重放。只看本轮消息时，48 条“继续/同意/ok”类回合 47 条维持上一档；加入上一轮用户文本（500 字）与助手回复结尾（1200 字，取 400 字时 64 条中 5 条不同），并写明“批准/继续按接下来要做的工作判档”后，“apply”（助手刚说完要实施）判 standard，“继续”（助手说剩下只是改措辞）判 simple。合成集不回退。
4. **用户标注（v6）**：从真实回合挑 64 条典型样本给用户标注。用户改正 3 条：调研并适配生态应为 standard、本地有记忆可直接定位的报错应为 standard、“部分仍有问题”不应升档。v6 只针对这三点改了 simple/standard 定义与追问规则；先试的更宽版本把验证集降到 38/44，已放弃。v6 下 3 条全部判对，64 条中 12 条稳定地由 complex 降为 standard（用户：降档后仍在 medium 及以上即可）。同一规则连跑两次最多 4 条落到相邻档，未见跨两档。

真实回合与标注表只保存在本机 `/tmp`，不进仓库。

## effort 起点出处（2026-10-21/22 抓取）

- Anthropic effort 文档 <https://platform.claude.com/docs/en/build-with-claude/effort>：Opus 5.5 与 Haiku 5.5 默认 medium，其余默认 high；Sonnet 5.5 的 agentic coding 从 medium 开始；Fable 5.1 从 high 开始；xhigh/max 只用于实测有收益的工作，Opus 4.7 的说明写明 max 在多数任务上成本高、收益小且可能想过头。
- Anthropic 成本与能力 <https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence>：Opus 5.5 在 SWE-bench Pro 子集上 low/medium/high/xhigh 分别为 87.4%/92.8%/95.3%/96.7%，每题 $0.11/$0.21/$0.29/$0.74；“低档先跑、失败再用 high 重跑”优于固定 high；编排者派发只在“常规工作且成本长尾”“超过一个上下文窗口”两种情况下更省。
- Anthropic 选型 <https://platform.claude.com/docs/en/about-claude/models/choosing-a-model>：Haiku 用于子 agent 任务，Sonnet 日常编码，Opus 复杂 agentic coding，Opus 在 xhigh/max 仍不够时换 Fable。
- Claude Code 博客 <https://claude.com/blog/claude-model-and-effort-level-in-claude-code>：多数任务用模型默认 effort；把 effort 当整体偏好而非逐任务调整。
- OpenAI reasoning <https://developers.openai.com/api/docs/guides/reasoning>：medium 为 agentic coding 默认，xhigh 需评测证明收益。
- Codex models / subagents <https://developers.openai.com/codex/models>、<https://developers.openai.com/codex/subagents>：多数任务从 gpt-6.1-sol 开始，Luna 用于范围窄的工作；显式设置时 Luna 从 high、Astra 从 low 开始。
