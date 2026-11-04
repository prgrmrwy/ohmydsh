## Context

- 上游网关（yetone/magpie main `7785c42`，2026-11-03 读）：`POST /v1/magpie/quotas/codex-reset?user=&credit=`，handler `internal/gateway/gateway.go:1207`。要求 enabled、非只读、不受 budget/models/accounts 限制的 gateway key（否则 401/403）；`?user` 必填；同一账号已有消费在进行时返回 409；内部 20s 超时调 `SpendCodexReset`，错误统一为 502；成功（`code == "reset"`）后再花最多 15s 重读该卡，然后 `200 ResetOutcome{code, windows}`。`UseCodexResetCard` 会先重读该账号的重置列表，指定的 `credit` 不在可用列表时不会改用其它卡。
- 卡片 `resets.each[]` 为 `{until?, window?, id?}`，网关已按到期时间排序（无到期时间的排最后）；`each` 只在条数等于 `count` 时才给（`codexResets`）。
- 参考实现 `dsh-plugin-subscriptions@0.9.12`：`lib/providers/reset-redemption.js`（门槛：周窗口 `usedPercent ≥ 80` 且 `resetsAt` 在未来；票据 60s、一次性；提交前先标「不确定」，抛错则保持锁定）、`lib/client/reset-action.js`（浏览器侧预判文案）、`SubscriptionsSection.js`（折叠块：12px SVG 箭头、gap 6、条目 `paddingLeft: 18`、`minHeight: 28`，按钮紧贴「完整重置」，`<dialog>` 确认框加勾选框）。
- 现有插件：`CardsController`（`src/host/cards.ts`）已对 refresh 做单飞 gate；`GatewayTransport`（`src/host/transport.ts`）用白名单和 query 规则在发出前拒绝。

## Goals / Non-Goals

**Goals:** 在设置页用上一张 Codex 重置卡，安全语义与 subscriptions 一致；默认只用最早到期的那张；全插件同一时刻只允许一个；修正折叠块的对齐。

**Non-Goals:** 修改 Cloudflare/nginx 入口白名单；挑选任意一张重置卡；侧栏入口；门槛可配置；`byWindow` 计划。

## Decisions

1. **新 host 资源 `reset`**（`POST /api/dsh-magpie-connector/reset`），body 二选一：`{action: "prepare", provider: "codex", user}` 或 `{action: "consume", ticket}`；其它形状返回 400。与 cards 分开，是为了让写路径单独审查、单独测试，不混进只读控制器。
   - 备选：复用 `cards` 资源的 POST。放弃，原因是会把不可撤销操作和刷新混在一起，校验分支难读。

2. **新鲜读数来自 `CardsController` 的单卡刷新**。`ResetController` 拿 `CardsController` 的一个内部方法：对 `{provider, user}` 走既有 refresh gate（保持「同一时刻只有一个刷新」的不变量），返回投影后的卡片和 host 内部的 credit 列表 `[{id, until}]`。credit id 不经过 `projectCards` 的浏览器投影，存在 `State.credits`（按 `provider\0user` 索引），浏览器响应只多一个 `resets.redeemable` 布尔值。
   - 备选：准备阶段直接 `GET cards`。放弃，那是网关缓存，不够新鲜；subscriptions 也是强制重读。

3. **门槛函数在 host 内是纯函数**：`eligibility(card, credits, now)` → `{ok, weeklyUsed, credit}` 或 `{code}`。周窗口按名字 `7 days` 识别（网关 `quotaDurationName` 按 `limit_window_seconds` 生成的名字；`codex` 只有这一种周窗口命名）。浏览器侧用同一套规则做预判（只决定按钮禁用与提示），host 不信任它。阈值常量 `80`，两端共用一个常量。

4. **并发模型**（全在 `ResetController` 实例内，跨 generation 保留，host 重启清空）：
   - `ticket?: {id, user, creditId, expiresAt}`：只保存一张；新的 prepare 覆盖旧票据。
   - `busy: boolean`：prepare 进行中或 consume 进行中为真，期间其它 prepare/consume 返回 409 `MAGPIE_RESET_BUSY`。
   - `uncertain: Set<user小写>`：提交前加入；只有拿到「明确结果」（2xx 可解析或 4xx）才移除。
   这样同时满足「同一时刻只有一个」与 subscriptions 的「不确定即锁定」。

5. **结果分类**：在 `transport.request` 返回响应之后：`2xx` 且 JSON 中 `code` 为字符串 → 明确结果；`4xx` → 明确失败（网关在 handler 里拒绝，或入口白名单拒绝，都发生在花掉重置卡之前）；其它（抛错、5xx、2xx 但不可解析）→ 不确定。消费成功后调一次单卡刷新更新卡片（网关已重读过，这一步只是拿到新投影），刷新失败不影响「成功」结论。
   - host 对网关的消费请求超时 45s（网关 20s 消费 + 15s 重读，再留余量）；浏览器 `api.ts` 对 `reset` 资源 consume 用 60s 超时（默认 30s 不够）。

6. **传输白名单**：`allowed` 加 `POST /magpie/quotas/codex-reset`；query 规则改为按路径列出允许的 key 集合与必需 key（refresh：`provider|user` 可选；codex-reset：`user`、`credit` 都必需且只有这两个）。

7. **UI**：
   - 箭头从字符 `▸`（16px 盒）换成 12×12 SVG `m6 3 5 5-5 5`，`gap: 6px`；`.dmg-reset-items` 保持 `padding-left: 18px`，于是条目与标题文字对齐。
   - 条目 `min-height: 28px; align-items: center`；左侧 `inline-flex` 放「完整重置」+ 按钮（gap 8，按钮高 22、`padding: 0 7px`），右侧到期时间右对齐。
   - 按钮用 `aria-disabled` 加 `title` 提示，而不是用 `disabled`：禁用时仍能悬停看到原因（与 subscriptions 相同）；点击时若被阻止只显示原因，不发请求。
   - 确认框：`<dialog open>` 放在自绘遮罩里（不用 `showModal`：jsdom 26 没有实现它，选中档 DOM 也让页面对 shell 的 modal 服务零依赖），内容为账号、周用量百分比、到期时间、警告、勾选框、取消/确认。确认按钮在未勾选或进行中时 `disabled`。结果写在该卡片重置区底部的 `role="status"` 行。
   - 结果文案按 `code` 映射；4xx 显示脱敏后的网关错误；不确定显示固定警告。

## Risks / Trade-offs

- [入口白名单未放行] 线上 `api.prgrmrwy.com` 的 nginx 只放行固定接口 → 准备阶段可以成功（刷新在白名单内），消费时得到 403/404，被归为「明确失败、未消耗」。这个判断是对的：nginx 在上游之前就拒绝了。界面如实显示错误。部署前需在 home-substore 另行放行 `POST /v1/magpie/quotas/codex-reset?user=&credit=`。
- [key 权限] 插件线路 key 若只读或受限，网关返回 401/403 → 显示原因，不建议扩大权限（与现有卡片文案原则一致）。
- [周窗口命名漂移] 网关若改名（如 `1 week`），门槛会一直判为「需刷新」→ fail closed（不能用，但不会误用）；测试固定 `7 days`。
- [不确定锁跨重启丢失] 与 subscriptions 相同，锁只在内存；提示文案要求先去 Magpie 核对、不要靠重启绕过。网关自己还有 409 并发保护作为第二道。
- [`each` 不全] 网关只在 `each` 条数等于 `count` 时给 `each`；否则没有 id → 不显示按钮（fail closed）。

## Migration Plan

纯增量：版本 0.6.3（按默认 patch 规则；0.7.0 是发版号误判，已从 npm 撤回），`dsh build` 部署，重启 Host 生效。回滚：`dsh.yaml` 中改回 0.6.2 的源码提交或 `enabled:false`。网关是旧版本（没有 `each[].id`）时不出现按钮。

## Open Questions

- 无阻塞问题。门槛 80% 与 subscriptions 保持一致；需要改阈值时另开 change。
