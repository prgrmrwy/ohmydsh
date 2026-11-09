# Changelog

## Unreleased

- **修复并发保存线路或更新备用线路凭据后，尚未完成选线的操作仍使用已删除线路或旧凭据。** 新操作在解析凭据、探测线路前后同时检查连接写入版本与当前 generation；期间发生连接写入或凭据事件时重新读取配置并选线，避免向已删除线路发起后台目录请求。已准备或正在生成的请求仍按捕获身份完成。

## 0.6.11 — 2026-11-09

- **保存线路失败时 500 只说「可能部分更新」，把唯一的可修复信息吃掉（[issue #1](https://github.com/prgrmrwy/dsh-magpie-connector/issues/1)）。** 报告者的 `~/.dsh/.credentials.yaml` 权限是 644；DSH 0.2.2-rc.1 的 `credentials-local` 每次写盘前先做 owner-only 检查（`assertOwnerOnly`），拒绝时抛出的错误带着文件路径与 `run "chmod 600 …"`——正是他最后用来解决问题的信息，但连接器 `updateLines` 的 catch-all 把它换成了通用文案，用户只能自己猜。现在 500 响应在 `MAGPIE_SETTINGS_WRITE_FAILED: …` 后附 `; cause: <底层错误>`：先对已知秘密与本轮尝试写入的值脱敏，再截断到 300 字符（顺序反过来会在截断边界留下秘密前缀）；设置存储自身的写入失败同样受益。另硬化了抛出值本身：非 `Error` 且无法字符串化时不给 cause，仍返回 500（此前会掉进通用处理、把 500 变成 400）。pending 隔离与「完整重试」行为不变，成功路径的响应体不变。
- 顺手修掉 `speed-ui` 里过期的 slot 断言：设置导航图标迁移到官方槽后客户端多注册了 `settings.section.icon`，该用例仍按 3 个注册、按旧下标取速度控件，在 main 上本就失败。
- 包内 540 vitest、typecheck、build、`check:artifacts`、repo 文档治理测试通过。

## 0.6.10 — 2026-11-05

- **修复热载后整个插件客户端 UI 消失（侧栏额度卡、设置页 Magpie 面板、输入框速度栏）。** `apply()` 注册 zh/en 字典时用了 `ctx.effect(() => { registry.register(...); return () => {} })`，空的清理函数从不释放字典；而 `@deepseek-ai/dsh-client-locale` 的 `register` 在同一命名空间已被占用时直接抛错（`locale namespace "settings.magpie" already has locale "zh"`）。页面开着时客户端 bundle 被重建（`dsh build`/HMR 推送新 bundle）会先卸载旧条目、再对新模块重新执行 `apply`，于是第二次 `register` 抛错、条目导入失败，插件注册的全部 slot 一起消失，直到刷新页面才恢复——表现为「侧栏 Magpie 额卡经常展示不出来」。现在这个 effect 返回 `locale.register` 自己的 disposer；本地用与真实服务同契约的假 locale 加了回归测试（重复注册抛错、disposer 删除命名空间），覆盖「卸载后重新 apply」与「卸载后命名空间已释放」。设置页导航图标的同款写法原本就返回了 disposer，未受影响。
- 包内 538 vitest、typecheck、build、`check:artifacts`、repo 文档治理测试通过。

## 0.6.9 — 2026-11-05

- **侧栏额度自动刷新改为真实刷新。** 之前每个 `sidebarRefreshMinutes` 只发一次卡片读取（`GET cards`），但网关的卡片接口按当前语义只返回它上次读到的缓存、不会向上游重读：`GET /v1/magpie/quotas/cards`（`quotaCards`）直接取 `provider.CachedCards`，注释写明 “no vendor asked for it”，只有 `POST /v1/magpie/quotas/refresh` 才让网关重读（同一张卡 30 秒内最多一次）。于是定时器虽然按 spec 在跑，读数和卡片头部的「N 分钟前」却一直不变，表现为「5 分钟自动刷新失效」；Claude 的 5 小时窗口也一直停留在上一次真实读取时的 0%（实测本机网关：`GET cards` 的 Claude `readAt` 停在 2026-11-03T21:33-05:00、`5 hours used=0`，强制刷新后变成 `5 hours used=8%`、`7 days` 20%→33%）。现在自动刷新与卡头刷新按钮走同一路径：按间隔静默发一次全量刷新（`POST cards {all:true}`），由网关重读上游；失败时保留旧读数、不显示错误、不影响其它功能，页面隐藏时到期不刷新、恢复可见后补读一次。事件驱动读取（挂载、展开、页面重新可见）仍走 `GET cards` + 60 秒缓存，默认 5 分钟、`0` 关闭不变。
- 包内 536 vitest、typecheck、build、`check:artifacts`、repo 文档治理测试通过。

## 0.6.8 — 2026-11-05

- **修复独立安装（镜像 CI）下 `owner-persistence` 用例对宿主版本的假设。** `llm/adapters-updated` 监听器异常的处理随 DSH 版本不同：0.2.0 会冒泡成 `INVARIANT`，0.2.1 起宿主自行包含（只 warn、不让监听器否决提交）。用例改为按实际宿主语义分支断言，两种版本下都验证「归属与配置文件不被破坏」，0.6.7 因此在镜像 CI 的 Verify 步失败、npm 未发布；本版只动测试与版本号，用户可见行为与 0.6.7 完全一致。
- 包内 535 vitest、typecheck、build、`check:artifacts`、repo 文档治理测试通过。

## 0.6.7 — 2026-11-05

- **README 演示图按当前界面重截。** `docs/usage.png`/`usage.en.png`/`settings.png`/`settings.en.png` 换成 0.6.7 构建在隔离 DSH_HOME（`ws prepare-preview`，端口 3228）里、对本地 loopback mock Magpie 网关注入合成数据的真实截图：收起卡展示 Claude 的 5 小时/周/月三行与各自到期时间、Codex 91%、OpenCode Go 三档位、DeepSeek 余额和一条读取失败；设置页展示三个档位 checkbox、自动刷新 5 分钟与连接线路。中英各一套，界面语言与 README 语言一致；`docs/SCREENSHOTS.md` 同步登记（usage 为 deviceScaleFactor 3，settings 为 2）。
- 顺手修掉开关说明里过期的「最多 5 行」：0.6.11 起收起正文按 320px 限高，中英文案与代码注释一并改成当前行为。
- **适配上游 DSH 0.2.1 的 `llm/adapters-updated` 语义。** 宿主现在自行包含该事件监听器的异常（只记录告警，不再让监听器否决提交）；旧的「首次注册 INVARIANT 不当作成功」用例改为「注册按提交结果处理」，current spec 同步说明，避免把宿主已包含的监听器异常误判成注册失败。
- 无用户可见行为变化；包内 535 vitest、typecheck、build、`check:artifacts`、repo 文档治理测试通过。

## 0.6.6 — 2026-11-04

**侧栏额度卡：到期时间、窗口档位多选与滚动细节。**

- **收起行显示到期时间。** 每行是「名称 + 窗口名 + 重置时间 + 读数」：单行时窗口名在名称后的括号里（`Claude (7 days)`），右侧显示该窗口的绝对重置时间（当年 `M/D HH:mm`，跨年 `YYYY/M/D HH:mm`，完整时间在 `title`）；网关没给 `resetsAt`（例如还没用量的 5 小时窗口）时显示 `—` 并说明原因，不推算。空间不足时只截断名称，到期时间与读数保持可读。
- **窗口档位可选、可多选。** 设置 → Magpie → 侧栏额度用 checkbox 勾选「5 小时窗口 / 周窗口（7 days）/ 月窗口（30 days）」，写 host 设置 `sidebarWindows`（数组、至少一项、规范顺序 5 小时 → 周 → 月，缺失默认 `["weekly"]`，非法值 400 且设置不变；取消最后一项不提交并提示）。只勾一个且上游有该档位时保持单行；勾多个且都存在时上游名称单独一行、每个窗口一行（窗口名、到期时间、读数）并各带进度条；勾选的档位在该上游都不存在时退回它读数最高的窗口，仍不编造读数。识别网关的 `5 hours`/`5-hour`/`5h`/`五小时`、`month`/`monthly`/`30 days`/`每月` 等写法；本地 0.6.7 曾写下的单值 `sidebarWindow` 读取时迁移为数组。
- **滚动与溢出提示。** 收起正文固定限高 320px（不再按「第 5 行」测量截断），收起正文、展开明细与侧栏浮层都隐藏滚动条但保留滚动；容器溢出时卡片底部保留 16px 提示带，双下箭头只切 `visibility`，滚到底只隐藏箭头、占位不变，卡片不抖动；箭头仍不可点击。
- **样式表改为文档级注入。** 之前整张样式表是挂在组件渲染树里的 `<style>`，重建/重启触发 slot 重挂载或插件模块重载时会连样式一起卸载，侧栏卡变成一串裸文字；现在在 `apply()` 里经 `ctx.effect` 注入 `document.head`（`style[data-dmg-magpie-styles]`，幂等、dispose 时移除），设置页与侧栏卡都不再内联样式。该坑记入 `docs/architecture/dsh-plugin-integration-pitfalls.md` 第 15 条。
- **卡头**只保留刷新与展开/收起（去掉了中途加过的说明 icon）。Claude 卡片没有月窗口是网关只返回 `5 hours`/`7 days`/`7 days · Fable`，插件不补造；没有月配额的上游不会因为勾了月窗口而多出一行。
- 规范 `openspec/specs/dsh-magpie-connector`（常驻卡、显示窗口档位多选、手风琴与溢出提示）及场景、中英 README、dsh.yaml 说明同步；包内 535 vitest、typecheck、build 通过。

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
