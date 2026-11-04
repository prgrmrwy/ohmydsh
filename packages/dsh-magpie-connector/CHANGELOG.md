# Changelog

## 0.6.9 — 2026-11-04

- **月窗口档位。** 档位 checkbox 增加「月窗口（30 days）」：`sidebarWindows` 允许 `monthly`，规范顺序固定为 5 小时 → 周 → 月；识别网关的 `month`、`monthly`、`30 days`、`每月` 写法。勾选后与其它档位一样按行显示，没有该档位时照旧回退，不编造读数。
- 规范「侧边栏显示窗口档位（多选）」、中英 README、dsh.yaml 说明同步；包内 530 个 vitest、typecheck、build 通过。

## 0.6.8 — 2026-11-04

- **窗口档位改多选。** 设置 → Magpie → 侧栏额度把单选下拉换成 checkbox：可同时勾选「5 小时窗口」与「周窗口（7 days）」，写 host 设置 `sidebarWindows`（数组、至少一项、按 `fiveHour`→`weekly` 规范顺序；缺失默认 `["weekly"]`，非法值 400 且设置不变）。0.6.7 的单值 `sidebarWindow`（含 `tightest`）在读取时迁移为数组，之后不再写回旧字段；取消最后一项不会提交，界面提示「至少保留一个档位」。
- **多选时的收起行。** 只勾一个且上游有该档位时保持单行 `Claude (7 days) · 11/20 11:00 · 20%`；勾多个且都存在时，上游名称单独一行，每个窗口一行（窗口名、到期时间、读数）并各带进度条。勾选的档位在该上游都不存在时退回它读数最高的窗口，仍不编造读数。
- **删掉卡头 info icon。** 0.6.7 加的 ⓘ 说明没有实际作用，标题行只留刷新与展开/收起；说明文案留在设置页勾选项下方。
- 规范改为「侧边栏显示窗口档位（多选）」并补 4 个场景，中英 README、dsh.yaml 说明同步；包内 528 个 vitest、typecheck、build 通过。

## 0.6.7 — 2026-11-04

- **侧栏卡片可选窗口档位。** 设置 → Magpie → 侧栏额度新增「卡片显示的窗口」下拉：周窗口（`7 days`，默认）、5 小时窗口、用量最高的窗口，写入 host 设置 `sidebarWindow`（缺失按 `weekly`，非法值返回 400 且设置不变，重启后保持）。每行按所选档位选窗口，网关的 `5 hours`、`5-hour`、`5h`、`五小时` 写法都能识别。
- **没有该档位就显示能显示的。** 所选档位在该上游不存在时，先退到它另一个数字窗口，再退到网关自己的文字读数、「无限」或余额，不编造读数；标题行新增 ⓘ icon（`title` + `aria-label`）说明当前档位与回退规则，回退行的窗口名用 `title` 说明原因。
- 开关说明与档位文案一并润色；规范新增「侧边栏显示窗口档位」，中英 README 同步。
- 回归：`sidebarWindow` 默认/持久化/非法值、档位选择与回退、设置页下拉写入均有用例；包内 526 个 vitest、typecheck、build 通过。

## 0.6.6 — 2026-11-04

- **侧栏收起行补上到期时间。** 每行改成「名称(网关窗口原名) … 到期时间 … 读数」：窗口名紧跟在名称后的括号里（`Claude (7 days)`），右侧在读数之前显示该窗口的重置时间（`11/20 11:00`，当年只给月/日与时间，跨年带年份，完整时间放在 `title`），`7 days` 不再是一个看不出何时恢复的模糊标签。网关没给该窗口 `resetsAt` 时位置留空，不显示占位或推算时间；余额行与读取失败行照旧。
- 空间不足时只有名称省略号截断，到期时间与读数保持可读；规范 `openspec/specs/dsh-magpie-connector` 常驻卡要求、中英 README 与 CHANGELOG 同步。README 截图仍为 0.6.2 的旧行样式，未重截。

## 0.6.5 — 2026-11-04

- **重置卡截图与 README 小节。** 新增 `docs/reset-credits.png` / `docs/reset-credits.en.png`：codex 用量卡片展开「用量限制重置」，最早到期那张带「使用…」，到期时间右对齐、条目与标题文字对齐。中英 README 各加一节「使用一张重置卡／Spending a reset」说明入口与门槛，`screenshots.json` 与 `docs/SCREENSHOTS.md` 同步登记。
- 两张图在隔离 DSH_HOME + 本机 loopback mock 网关上、以 DSF 3 截取 codex 卡片元素（534x219），界面文案与 0.6.4 一致。

## 0.6.4 — 2026-11-04

- **文档修正（无代码变化）。** 中文 README 的「不支持」段还写着「插件不会调用账号管理或重置端点」，与 0.6.3 新增的使用重置卡能力矛盾，现已改为如实描述：用量卡片只读，使用 Codex 重置卡是唯一会写 Magpie 账号状态的操作。中英首屏也一并说清「可以从卡片使用重置卡」。
- npm 包页面只在发新版本时才会更新 README，所以这次单独发一个 patch。

## 0.6.3 — 2026-11-04

- **用上 Codex 重置卡（首个写操作）。** 卡片展开区里最早到期的那一项带「使用…」；周窗口（`7 days`）用量达到 **80%**、且读数新鲜时才可用。host 在准备和提交前各重新读一次该卡并独立校验，不信任浏览器的判断。
- **只用最早到期的那张。** host 从刚读到的 `resets.each[]` 里挑 `until` 最早、仍可用的一张，把它的 `id` 记进票据；浏览器拿不到也指定不了 `id`。提交前那张已不在可用列表时直接拒绝，不会改用别的卡。
- **两段确认 + 全插件单飞。** 「使用…」→ 60 秒一次性票据 → 对话框（账号、周用量、所选卡到期时间、不可撤销警告）→ 必须勾选才能提交。同一时刻只允许一个准备/消费；新的准备会作废旧票据。
- **结果判定。** `reset` 成功并用刷新响应更新卡片；`nothing_to_reset`/`no_credit`/`already_redeemed` 各有文案；4xx（权限不足、409 并发、入口白名单拒绝）说明没花掉，可重来；网络错误/超时/5xx/无法解析一律按「结果不确定」锁定该账号到 host 重启，不自动重试。
- **传输边界。** 白名单新增 `POST /magpie/quotas/codex-reset`，query 只允许且必须带 `user`、`credit`；其它组合在发出前拒绝。
- **UI 对齐 subscriptions。** 重置折叠块的箭头从 16px 字符换成 12px SVG（间距 6px），展开条目缩进 18px 与标题文字对齐，行高 28px，「使用…」紧贴「完整重置」。
- 修复 README（中/英）里 0.5.2 遗留的重复行。规范：`openspec/changes/magpie-codex-reset-redeem/`。
- 部署提示：线上入口（Cloudflare + 自建 nginx 白名单）放行 `codex-reset` 之前，该功能会如实显示网关的 403/404，卡片与生成不受影响；gateway key 需具备完整权限（只读/受限 key 被网关拒绝）。

## 0.6.2 — 2026-11-03

- **Accordion instead of an overlay.** Expanding the sidebar usage card no longer covers the session list: the detail grows in flow inside the same card and the list gives up height from the bottom (the list keeps its top anchor, so rows do not jump). No divider line; the card surface and shadow carry the separation.
- **Header-only interaction.** Only the header row toggles expand/collapse (the refresh button keeps its own action); the card body and the overflow chevron are no longer click targets — the chevron is a passive "more rows" hint.
- **Configurable auto refresh.** New host setting `sidebarRefreshMinutes` (whole minutes, default `5`, `0` = off, range `0–1440`, non-integers/out-of-range rejected with 400) and a matching "Auto refresh" field in Settings → Magpie → Sidebar usage. The card re-reads silently on that interval, paused while the page is hidden and resumed on visibility; it never sends `POST {all:true}`. With `0` the previous event-driven behaviour (mount, manual refresh, expand, page visible) is unchanged.
- **README screenshots.** New sidebar usage card screenshot (`usage.png` / `usage.en.png`) and refreshed Settings screenshots showing the sidebar panel with auto refresh; registered in `docs/SCREENSHOTS.md`.

## 0.6.1 — 2026-11-03

- **重置卡改成和 subscriptions 插件一样的折叠列表。** host 现在把网关 `resets.each[]`（每项只保留 `until`/`window`）与 `resets.byWindow`/`fiveHour`/`weekly` 投影给浏览器；卡片上用「用量限制重置 · 可用 N 次」做摘要行，展开后逐张列出「完整重置」/「5 小时」/「每周」和每张的「{时间} 到期」，最早到期那张附相对提示（`N 天后过期` / 不足 24 小时 `N 小时后过期` / 已过期），缺到期时间显示「到期时间不可用」。按窗口发放重置的计划（GLM Coding）摘要显示「5 小时 N 次 · 每周 M 次」。
- 仍然只读：没有新增按钮，也不调用任何重置端点；网关不给 `each`/`byWindow` 时退回原来的「次数 + `until`」显示。
- Codex 卡片只显示一个 `7 days` 窗口是网关数据如此：ChatGPT 的 `/wham/usage` 对当前账号只上报周窗口，插件不会补造 5 小时窗口。
- 规范：`openspec/changes/magpie-reset-card-detail/`。

## 0.6.0 — 2026-11-03

- **Sidebar usage card.** Settings → Magpie gains a 「侧边栏额度 / Sidebar usage」 switch (host setting `sidebarUsage`, default off). When on, the sidebar footer shows a dense card above Settings: one row per upstream with its weekly (`7 days`) window, reading and bar; at most five rows, the rest scroll inside the card, and a double chevron (no divider) appears when more exist. Rows keep the gateway's order, a card with an error shows 「读取失败」 instead of a reading, and the whole card has a single refresh (`{all:true}`).
- **Expands in place.** Clicking the card grows it upward in place: every upstream with every window, reset time, reset chances, balance and the redacted error. The resident card keeps its flow slot, so the session list keeps its height; the expanded layer is an overlay with the same shadow as the resident card, not a layout change. The title row carries one chevron that both expands and collapses.
- **Balance-only accounts.** An upstream with no quota windows but a gateway-reported balance shows that balance (for example `¥42.50`) instead of a bare dash.
- **Collapsed sidebar.** With the sidebar in rail mode only a Magpie icon remains (tooltip 「Magpie 额度」); clicking it opens the same content as a 320px anchored popover.
- **Event-driven reads.** The card reuses `GET /api/dsh-magpie-connector/cards` with a 60s client cache and reads only on mount, manual refresh, expanding, or the page becoming visible again; no timer polling. The settings page is unchanged and keeps per-card refresh.
- No host request/route changes; the only host addition is the persisted `sidebarUsage` flag.

## 0.5.1 — 2026-11-02

- README 中英首屏改用 deviceScaleFactor 3 的静态 PNG（3300x1920 / 2400x2400），替换旧的低分辨率图与 GIF；同时改为 markdown 图片写法，商店详情页可直接渲染。
- 仅文档与图片调整，无代码/行为变更。

## 0.5.0 — 2026-10-31

- 设置页与速度选择器支持界面语言：新增 `settings.magpie` 的 zh/en 字典（`src/client/locales.ts`），通过 `ctx.locale` 注册并在 `apply()` 绑定；文案不再硬编码中文，跟随 DSH 界面语言（英文界面下为英文）。未绑定翻译器时（单测、无 locale 服务的宿主）仍回退到中文，行为不变。
- `dsh.client.inject` 与 peer 依赖补 `@deepseek-ai/dsh-client-locale`。
- 新增字典键集合一致性与中英切换测试（`test/client-locales.test.ts`）。

## 0.4.2

- **Only the checked line is re-measured.** 0.4.1 refreshed the whole latency pass after a line check, so every saved row's reading changed even though only one line was checked. `GET /api/dsh-magpie-connector/latency` now accepts `?line=<id>`: the host probes just that saved line and returns only its reading, and the settings page merges it into that row while every other row keeps its previous value. Unknown or unsaved ids measure nothing. The full pass on panel open and after a successful save is unchanged, and there is still no polling.

## 0.4.1

- **Check refreshes latency.** A completed line check on a **saved** line now also re-runs the settings-page latency measurement (one `GET /api/dsh-magpie-connector/latency` pass), so the signal reading next to that line reflects the same moment as the check instead of the last panel open or save. Unsaved drafts trigger nothing (they have no latency row), the host measurement stays single-flight with its 600 ms deadline, and there is still no polling.

## 0.4.0

- **Line panel polish.** Settings now collapses every configured line by default (it no longer force-expands the active one); clicking a line header toggles it, and the add/remove/reorder actions are always-visible DSH product-icon buttons with accessible names and tooltips. A newly added line still opens for editing and stays open through its first save (including when it was moved before saving) and when a save fails.
- **Line latency.** Opening Settings measures each saved line with a parseable address once (parallel TCP connect time, ≤600ms per line, DNS included, no HTTP and no credentials) and shows a 4-bar signal reading plus the millisecond value; timeouts show 「超时」, failed or older-host responses degrade silently to 「—」. Readings are display-only: they are not persisted, never touch automatic line selection, and are re-measured only on the next panel open or after a successful line save (no polling). New GET-only host resource `GET /api/dsh-magpie-connector/latency`.
- Usage bar fill now has rounded ends matching the track.
- **Check a line before saving it.** Every line card has 「检查线路 / Check line」: it runs one real `GET /models` against the card's current draft (address, access mode, key; empty credentials fall back to that line's saved values) and renders a read-only snapshot — result kind, latency, model count and, when the host has a cached catalog with a sync time, the model ids extra to or missing from that cache. It never writes credentials or settings, never rotates the generation, never selects a line, never registers a route and never touches the probe cache, so it cannot change which line is in use; the snapshot is explicitly compared against the *cached* catalog, never called "same as the current line" (a switch keeps an inherited catalog).
- **Bounded, classified, redacted.** The `line-check` settings API resource admits no write: with a save in progress or a credential write pending it answers `pending`/`busy` without reading saved credentials, a host-memory connection-write version proves no write landed during the credential read, the whole check shares a 5 s budget, only one check runs at a time, and draft credentials are redacted from results, reasons and logs. Failure classification has a fixed precedence (response state before body, transport-blocked redirects included).
- **Quieter saves, honest labels.** Usage cards are cleared only when a save touches the active line's identity (line removed, address/access mode changed, credentials supplied) or the host auto-switches lines; editing or reordering spare lines keeps the cards and their read time. The save result states the resulting line (`已保存 · 当前线路 N` / no active line) with no live region, and a saved-but-incomplete line is labelled `未配置`.
- **Wire contract.** `POST /api/dsh-magpie-connector/line-check` accepts `{id?, baseUrl, accessMode?, key?, accessClientId?, accessClientSecret?}`; shape violations are 400, every other outcome is a 200 result with `kind`. See `openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/` for the specification.

## 0.3.1

- Replace both README demo GIFs with representative PNG screenshots (the model picker grouped by provider; per-provider visibility, default effort and usage cards in Settings), because the DSH plugin store does not show GIFs by default. No runtime behavior changes.

## 0.3.0

**BREAKING:** the single provider route `dsh-magpie-connector` is retired and not aliased. Sessions, the default model and any external configuration saved with that route id no longer resolve; reselect the model after upgrading, and update anything that lists the exact route id (subagent routing, egress allowlists).

- **Grouping on stock DSH.** One real route per gateway `owned_by`: `dsh-magpie-connector-<owner>` (lower-cased, 1–48 chars of `a-z0-9._-`; anything else goes to `-other`). The official picker shows `Magpie (<Owner>)` groups without any Host extension; the `displayGroup` metadata is gone.
- **Route identity.** Every model result carries the requested route as `provider`; lookups are by model id, so capabilities are identical on any plugin route.
- **Replay across routes.** Native reasoning replay uses a fixed transport identity, so encrypted reasoning survives tool turns, restarts and switching between plugin routes; foreign or tampered history degrades to plain history.
- **Remembered owners.** `settings.json` `knownOwners` (max 32, first-seen order) registers routes at start-up before the first sync. Invalid values are reset as a whole (`knownOwnersReset`), over-limit owners are reported (`ownerLimitReached`, `rejectedOwners`), and owners that disappear keep their empty route.
- **Failure handling.** A failed first registration (route owned by another plugin, or a host listener `INVARIANT`) is reported as `routeRegistrationError` in Settings and requires a DSH restart; replace conflicts roll back the new owner and still publish catalog changes. Settings writes go through one synchronous writer, so owner discovery never deadlocks with settings requests or overwrites concurrent line saves.
- **Speed control** shows on any plugin route.

## 0.2.0

**BREAKING:** the settings format changes from a single top-level `baseUrl` to an ordered `lines[]` list, and credentials move to per-line derived refs. Existing `settings.json` files with only `baseUrl` and the legacy fixed refs (`MAGPIE_API_KEY`, `MAGPIE_ACCESS_CLIENT_ID`, `MAGPIE_ACCESS_CLIENT_SECRET`) are **not read, migrated or deleted**; reconfigure the connection in Settings after upgrading. `visibleModels` / `defaultEfforts` are preserved. Back up `settings.json` and the old credential refs before upgrading if you need a rollback path.

- **Multiple connection lines.** Settings hold an ordered list of 0–5 lines (empty on first install; normally one), each with its own address, gateway key and access mode (`direct` or Cloudflare Access). Array order is the priority order used for automatic selection; moving lines does not change their identity or credentials.
- **Stable random line ids.** The host generates an 8-hex-character id when a line is created (unique among existing and pending lines); it is stored in settings, never shown in the UI (the UI shows the 1-based position) and never changes when the address, key, order, or another line changes.
- **Per-line credentials.** Every line uses `MAGPIE_LINE_<ID>_API_KEY` / `MAGPIE_LINE_<ID>_ACCESS_CLIENT_ID` / `MAGPIE_LINE_<ID>_ACCESS_CLIENT_SECRET` (uppercase id). Deleting a line clears its writable refs; environment-owned values are reported through `retainedCredentials`. New lines omit `id` in POST bodies and are assigned one by the host.
- **Automatic line selection.** Before each gateway operation the first reachable complete line (priority order) is chosen with a ≤600ms TCP probe (10s positive / 15s negative in-memory cache, no background polling). A single-line setup never probes. If all lines are unreachable the first line carries the real request and the error surfaces as-is.
- **Line switching keeps the catalog.** Switching lines carries the current model catalog over (no empty flash), clears usage cards and re-syncs the new line. Editing a non-active line does not clear the catalog or trigger a sync; editing the active line keeps the identity-change semantics. Generated requests are never replayed or switched: a connection-phase failure only invalidates that line's probe cache.
- **Per-line Cloudflare Access.** Access is enabled per line and sent only to HTTPS lines that enable it; plain-HTTP lines never carry the service token. Switching a line back to Direct clears its saved Access pair on save.
- **Load validation and write safety.** Malformed/duplicate persisted lines or pending records make the whole connection read as unconfigured (no requests, no credential resolution, file untouched). Credential writes are persisted as `(lineId, field)` pending entries before secrets are written; partial failures keep the pending quarantine across restarts and require an explicit complete retry. Removed/new line ids are cleaned through that quarantine.
- **Settings UI.** Line cards with the active line expanded by default, a 4×4 green active marker after its number, an info tooltip explaining priority, add/move/delete controls, an empty state with an add button for first install, and silent switching (no toast/alert).
- **Docs/tests.** README, architecture diagrams, internal API notes and the CHANGELOG document the breaking upgrade and reconfiguration steps; the old settings screenshot was removed pending re-recording.

## 0.1.2

- Default request output budget now reserves context space for DSH compaction: `min(max_output_tokens, max(1, context_window/4, context_window/2 − 65536))`. The gateway's capacity stays the pi-ai model output limit, so the model's real ceiling is unchanged.
  - On a live gateway, `codex/gpt-6-astra` and `codex/gpt-6-luna` (272k window / 128k capacity) move their compaction threshold from 78,464 to 136,000 tokens; `opencode-go/minimax-m3.1-flash` (1M / 512k) from 422,464 to 500,000.
  - An explicit `maxTokens` passes through unchanged; DSH still fills the default when a request omits it.
  - Models with a window below 104,026 tokens are not guaranteed to pass DSH's two compaction checks; they are still mapped with the same formula rather than dropped.

## 0.1.1

- Fix README images on npm: `repository` no longer declares a monorepo `directory`, so relative image links resolve against the standalone repository root.

## 0.1.0

- First release.
- One `dsh-magpie-connector` LLM route for a self-hosted Magpie gateway: model discovery from `GET /models`, Responses or Chat Completions per model, text, tools, images, usage, cancellation and DSH-managed retries.
- Model picker and settings group models and read-only usage cards by the gateway's upstream provider; `owned_by` drives the `Magpie (Claude)` / `Magpie (GPT)` headings while the real route stays single.
- Per-provider model visibility, per-model default effort and a per-session standard/fast switch for models advertising the `priority` service tier; the switch follows model-selection changes immediately instead of waiting for the 3-second poll.
- Optional Cloudflare Access service-token authentication for gateways behind Cloudflare Tunnel + Access; HTTPS only.
- Credentials use DSH credentials (`MAGPIE_API_KEY` and optional Access refs); the key is never written to the settings file or returned by the settings API.
