# Jev rule check

[中文](README.zh.md)

`cases.json` holds 10 synthetic tasks (development and holdout splits) with independently written expected capability and depth answers for the rule file `../src/rubric.json`. `live.mjs` sends them to the real OpenRouter decision endpoint with a hard budget (at most 20 calls, $0.10) and writes a local report without task text beyond the synthetic cases. It is a manual, paid check, not part of `npm test`.

The earlier four-tier regression set (`run.mjs`, its 90 cases and `baseline.json`) was removed with the four-tier chain in 0.5.0; use the 0.4.x package if you need it.

## Effort starting points: sources (fetched 2026-10-21/22)

The starting points themselves live in the strategy files `../src/strategies/`.

- Anthropic effort: <https://platform.claude.com/docs/en/build-with-claude/effort> — Opus 5.5 and Haiku 5.5 default to medium, others to high; Sonnet 5.5 agentic coding starts at medium; Fable 5.1 starts at high; xhigh/max only where evals show a gain.
- Anthropic cost and intelligence: <https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence> — Opus 5.5 SWE-bench Pro subset low/medium/high/xhigh 87.4/92.8/95.3/96.7% at $0.11/0.21/0.29/0.74 per task; "low first, rerun failures at high" beats fixed high; delegating to cheaper workers saves only for routine long-tail work or work larger than one context window.
- Anthropic choosing a model: <https://platform.claude.com/docs/en/about-claude/models/choosing-a-model> — Haiku for sub-agent tasks, Sonnet for everyday coding, Opus for complex agentic coding, Fable when Opus at xhigh/max falls short.
- Claude Code blog: <https://claude.com/blog/claude-model-and-effort-level-in-claude-code> — use the model default; treat effort as a general preference.
- OpenAI reasoning: <https://developers.openai.com/api/docs/guides/reasoning> — medium is the agentic coding default; xhigh only with eval evidence.
- Codex models and subagents: <https://developers.openai.com/codex/models>, <https://developers.openai.com/codex/subagents> — start most tasks on gpt-6.1-sol, Luna for narrow work; explicit settings start Luna at high and Astra at low.
