# Changelog

## 0.7.0 — 2026-11-06

- **Judgement presets.** The Jev questions now come from built-in, named, sourced presets under `src/presets/<id>/rubric.json`, selectable in settings (`preset`, default `reasoning-depth`). `reasoning-depth` is the former `src/rubric.json`, byte for byte, so the default questions and state are unchanged. New opt-in `effort-as-verification` follows Anthropic's "Spending your effort": depth measures the verification, edge-case testing and independent judgement the next work needs, and its state carries a fixed call-path line (`Execution: main conversation.` / `Execution: delegated subtask; …`) that never claims whether anyone reviews. Presets cannot change the effort ladder, offset, cap or sub-model slots; published presets are never edited in place (see [docs/presets](docs/presets/README.md)).
- **One preset per judgement.** Main turns, managed subtasks, `route_subagent` and the settings connection test each capture the preset once when the judgement starts; a settings change mid-judgement only affects later judgements. Bound subtasks and same-turn requests are never re-judged.
- **Binding snapshots record the preset, and no longer vanish under load.** New snapshots carry `preset`. The decision time and preset now live with each session's current main decision instead of a global 200-entry FIFO, which used to drop the whole snapshot for a still-active decision (non-user turns, delayed replies) once other sessions had made 200 judgements.
- **Eval per preset.** `eval/live.mjs --preset <id>` (after `npm run build`) builds the state with the runtime `buildState`, rejects unknown ids before any network call, and records `preset`, `execution` and the resolved `expected` sets; 8 new synthetic cases (18 total, still ≤ 20 calls / $0.10 per run).
- **Settings copy is preset-neutral** ("investment level" instead of "reasoning investment") and the strategy details show the selected preset's title, evidence, source links and rubric.
- **BREAKING (package layout and downgrade visibility).** `src/rubric.json` moved to `src/presets/reasoning-depth/rubric.json`; no migration is needed to upgrade. Downgrading to 0.6.6 ignores `preset` and drops it on the next save; bindings with `snapshot.preset` are skipped by the 0.6.6 strict reader until you upgrade again (the ledger is not rewritten).

## 0.6.6 — 2026-11-04

- **UI and docs decoupled from Magpie.** The settings strategy copy now describes AUTO's provider behavior instead of one gateway (`Magpie` → `AUTO` in the EN/ZH dictionaries), and the READMEs no longer contain a Magpie transport section or Magpie-specific acceptance links. Routing logic never referenced Magpie — a package test enforces that model-family knowledge lives only in `src/strategies/` and that nothing else repeats family ids or prefix matching — so this is a copy/documentation release, not a routing change.
- **Custom model families documented.** Both READMEs gain a "Custom model families" section: the five `FamilyStrategy` fields (`id`, `label`, `modelPrefixes`, `effortStarts`, `childModels`) and their constraints, the registry validation that rejects the whole plugin on conflicts, a worked example, and the build/verify/restart steps. It also states what a new family cannot change: provider, transport, fallback, the four effort levels, the `max` prohibition and the catalog/allowlist gates.
- **Store screenshots regenerated on the current UI.** Both READMEs' demo images (four PNGs) were re-captured on a 0.6.6 build in an isolated host against a loopback mock decision service and a neutral loopback mock model provider (`demo`), in the matching English and Chinese interfaces, so the first screen no longer shows an old gateway provider id. Sources are registered in [docs/SCREENSHOTS.md](docs/SCREENSHOTS.md).
- **Residual gateway-specific history removed.** The Magpie-only live-acceptance report and its script are gone, and the two historical hand-over documents that still described that gateway integration were rewritten with neutral wording; the detailed acceptance facts remain in git history. Third-party routing research that analyses the external Magpie project is unchanged, since it is background research rather than AUTO's own integration.
- **Docs corrected against the implementation.** Fork and other unbound children pass through untouched (only the preview reports fork as unsupported); the interface follows the DSH UI language since 0.6.0 rather than always showing Chinese; family strategies no longer list transport knowledge; the architecture links now point at the current historical reports.

## 0.6.5 — 2026-11-03

- Jev 判断等待上限默认值改为 8000 ms（原 5000 ms）；允许范围仍为 1000–8000 ms，已显式保存的值保持不变。2026-10-30 实测约 1/20 的判断服务端耗时超过 5 s，而一次超时就会让整个会话停用 AUTO。

## 0.6.4 — 2026-11-03

- 主仓目录与 `dsh.yaml` 条目 id 统一为 `dsh-auto-model-routing`，与 npm 包名、镜像仓库一致。
- 包代码、插件 id、设置路径（`$DSH_HOME/plugins/dsh-auto-model-routing/`）、状态目录（`$DSH_HOME/state/auto-model-routing/`）与 RPC 命名不变；仅结构/文档变更，无行为变更。

## 0.6.3 — 2026-11-02

- README 中英首屏改为 markdown 图片写法，商店详情页可直接渲染。
- 仅文档调整，无代码/行为变更。

## 0.6.2 — 2026-11-02

- 修复「key 来自启动环境」提示写死 `OPENROUTER_API_KEY` 的问题：改用当前所选决策服务的凭据名（如 `AUTO_DECISION_CUSTOM_API_KEY`），与设置页显示的「凭据引用」一致。
- 仅提示文案，无行为变更。

## 0.6.1 — 2026-11-02

- 补齐 0.6.0 漏掉的界面文案：内置决策服务名称（OpenRouter / TypeSafe official / Concentrate / Custom System One）与失败分类提示（未配置 key、余额不足、限流等）改走 `t()`，英文界面下不再出现中文。
- 仅客户端文案与字典键变化，无行为变更；未绑定翻译器时仍回退中文。

## 0.6.0 — 2026-11-02

- 客户端界面支持中英双语：新增 `src/client/locales.ts`（`settings.autoModelRouting` 的 zh/en 字典 + 模块级翻译器），composer 的 AUTO 切换、状态面板、决策提示、回复反馈菜单与设置页文案全部改走 `t()`，随 DSH 界面语言渲染。
- client 入口注册字典并绑定 `ctx.locale`；`dsh.client.inject` 与 peer 依赖补 `@deepseek-ai/dsh-client-locale`。
- 未绑定翻译器时回退中文参考集（单测与无 locale 服务的宿主行为不变）；新增字典键集合一致性与中英切换测试。
- 设置导航行的图标适配器按当前语言的标签匹配，不再硬编码中文。

## 0.5.4

- GPT Sol (`gpt-6.1-sol`) now starts at `high` instead of `medium`, one step above the matching Claude start, so its lower/baseline/higher efforts become `medium/high/xhigh` for both the main session and Sol child routes. Luna and Astra are unchanged; automatic routing still never uses `max`. This follows user-reported quality concerns, not a controlled evaluation. Existing bound child routes retain their recorded effort.

## 0.5.3

- Replace both README demo GIFs with representative PNG screenshots (an applied AUTO decision with its distribution; decision service settings with a connection test), because the DSH plugin store does not show GIFs by default. No runtime behavior changes.

## 0.5.2

- README follows the standard plugin layout: demos side by side, then the architecture diagram, then the introduction; a closing section links the ohmydsh source, the MIT license and the issue tracker.
- The release workflow now also creates the GitHub Release for each version and attaches the exact npm tarball. No runtime behavior changes.

## 0.5.1

- Replace both retired four-tier GIFs with high-resolution recordings of the current AUTO interaction, applied decision distribution and settings/strategy UI, using isolated mock services and synthetic tasks.
- Show both demos side by side at the top of the English and Chinese READMEs; remove the obsolete demo disclaimer and folded settings recording. No runtime behavior changes.

## 0.5.0

- **Breaking — one AUTO strategy.** The opt-in legacy four-tier chain is removed: the tier router and its rubric, the per-family `mainEfforts` / `childRoutes` mappings and their settings tabs, the reply-bar tier menu and `label` parameter, `judgements.jsonl` writes, `scripts/label-report.mjs` and the `eval/run.mjs` baseline. Default AUTO behavior (main effort, child capability routing, exact-child binding, Magpie transports, caps, allowlists, fork refusal) is unchanged.
- **Breaking — no strategy versions.** The `policy` setting and the `policyVersion` / `mappingVersion` / `rubricVersion` markers are gone, as is the `version` field on child records and feedback events and the usage report's `schema`. New feedback snapshots record the strategy family (`strategy`). The rule file is now `rubric.json` (same bytes).
- **Family strategies.** Everything about the Claude and GPT families (supported main models, transport prefixes, effort starting points, capability slots, accepted providers) lives in `src/strategies/`; a new family is one strategy file plus registration. The registry rejects conflicting strategies at load.
- **Old data stays readable.** Retired `policy`, `mainEfforts` and `childRoutes` keys are ignored, listed as `deprecated` and removed on the next settings save; submitting them is rejected. Child records written by 0.4.x restore without a version check (only the three known historical keys are tolerated, then dropped). Old feedback rows and events stay readable; the usage report keeps them in their original historical group. `judgements.jsonl` is kept read-only for the report.
- **Rollback.** Pin the published 0.4.2 package: in `dsh.yaml`, set this entry to `source: remote`, `spec: dsh-auto-model-routing@0.4.2`, `version: 0.4.2`, run `dsh build` and restart the Host. Data boundary: child records rewritten by 0.5.0 and feedback rows written by 0.5.0 are not readable by 0.4.2 (fail closed; recreate those child sessions), and settings saved under 0.5.0 no longer contain the retired mapping keys. Back up `state/auto-model-routing/` and the plugin `config.json` before upgrading if you may roll back.
- The Jev decision deadline now defaults to 5000 ms (was 3000 ms) and can be set up to 8000 ms (was 4500 ms); an explicitly saved value is kept. The `route_subagent` tool deadline is 10 s so it outlasts the longest decision.
- The package build now clears `lib/` before compiling, so deleted or renamed modules never ship from a stale output directory.

## 0.4.2

- AUTO now handles Claude and GPT model families only: selecting any other main model switches the session to MANUAL instead of failing the turn in the effort mapper.
- Support the renamed `dsh-magpie-connector` Magpie route as an exact policy transport (replacing `dsh-magpie`); `dsh-magpie-connect` remains supported.
- Fix the missing feedback entry on turns whose request configuration did not change: the main decision is marked applied from the effective request header instead of waiting for a new one.
- Record two implicit feedback facts as separate ledger events keyed by session and decision: reply exposure and a later switch to MANUAL. No message text is stored; routing is unchanged.
- The usage report adds a mutually exclusive implicit-signal breakdown per comparison group, with a fixed caveat that implicit no-objection is not the same as appropriate.
- Sync the AUTO-selected effort through the official selection and simplify the picker display.

## 0.4.1

- Add the on-demand `auto-model-routing-report` skill and read-only `lib/usage-report.js`: joins policy-v2 decisions to actual per-call usage by message ID, grouped by version × model × depth, with coverage gaps, sample thresholds and fixed caveats. Observational only; never writes, spawns or uses the network, and never prints message text, paths or session IDs.

## 0.4.0

- Upgrade AUTO by default: keep the main model fixed, independently judge child capability and reasoning investment, and enforce exact fresh-child bindings with persisted replay. Preserve explicit legacy rollback and MANUAL behavior.
- Add TypeSafe, Concentrate and custom System One decision services with separate credentials, preset model menus and explicit public-sample connection testing.
- Expose executable strategy details, candidate distributions, normalized Choice certainty and actual application status; no task-quality or savings claims.
- Restore per-reply allocation feedback with immutable evaluation snapshots, request-event correlation, timestamped change/cancel events and legacy-record compatibility.
- Refresh bilingual user documentation; label earlier GIFs as legacy mock-host demonstrations. Fork and real-provider teammate acceptance remain unsupported/unverified as documented.


- Accept the DSH 0.2 host's React 18.3.1 as well as React 19 in the runtime peer declaration; client builds continue to use the host's shared React instance.

## 0.3.0

- Publish as a standalone DSH bundle with the companion `subagent-model-routing` skill included.
- Replace the separate ohmydsh skill customization with a package-owned filesystem skill provider. Skill and tools now enable/disable together.
- Add npm/Git installation instructions, demo GIFs, licensing and OIDC release automation.
- Keep the existing tier rubric, effort mappings, default MANUAL mode, credentials and stored state unchanged.
