# Tier rubric regression

[中文](README.zh.md)

`cases.json` holds 90 cases for the Jev tier rubric in `../src/rubric.json`: 30 synthetic (`t-`), 22 synthetic written after the rubric was drafted (`h-`, also used to choose between drafts, so not an independent holdout) and 38 paraphrased from real local turns (`s-`, previous-turn text included; no real session text, ids, credentials or addresses). `exp` lists the acceptable tiers; `prev`, `prevUser` and `prevAssistant` simulate the previous turn.

`run.mjs` (added with the implementation) imports the rubric and the production `state` builder, asks Jev three times per case and takes the majority. It calls the real OpenRouter endpoint and costs about $0.005 per run.

- Exit 0: every miss is listed in `baseline.json`.
- Exit 1: a case outside `knownMisses` missed (a regression); also prints known misses that now pass.
- Exit 2: a request failed (not counted as a miss).

When a rubric change is intended, rerun, review each changed case, then update `knownMisses` in the same commit.

## Effort starting points: sources (fetched 2026-10-21/22)

- Anthropic effort: <https://platform.claude.com/docs/en/build-with-claude/effort> — Opus 5.5 and Haiku 5.5 default to medium, others to high; Sonnet 5.5 agentic coding starts at medium; Fable 5.1 starts at high; xhigh/max only where evals show a gain.
- Anthropic cost and intelligence: <https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence> — Opus 5.5 SWE-bench Pro subset low/medium/high/xhigh 87.4/92.8/95.3/96.7% at $0.11/0.21/0.29/0.74 per task; "low first, rerun failures at high" beats fixed high; delegating to cheaper workers saves only for routine long-tail work or work larger than one context window.
- Anthropic choosing a model: <https://platform.claude.com/docs/en/about-claude/models/choosing-a-model> — Haiku for sub-agent tasks, Sonnet for everyday coding, Opus for complex agentic coding, Fable when Opus at xhigh/max falls short.
- Claude Code blog: <https://claude.com/blog/claude-model-and-effort-level-in-claude-code> — use the model default; treat effort as a general preference.
- OpenAI reasoning: <https://developers.openai.com/api/docs/guides/reasoning> — medium is the agentic coding default; xhigh only with eval evidence.
- Codex models and subagents: <https://developers.openai.com/codex/models>, <https://developers.openai.com/codex/subagents> — start most tasks on gpt-6.1-sol, Luna for narrow work; explicit settings start Luna at high and Astra at low.
