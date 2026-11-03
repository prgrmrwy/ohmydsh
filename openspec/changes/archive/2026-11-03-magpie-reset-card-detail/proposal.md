## Why

设置页的用量卡片对 Codex 的「重置卡」（rate-limit resets）只显示一行：剩余次数 + 最早一张的过期时间。网关的 `GET /v1/magpie/quotas/cards` 其实还给了每一张重置卡的过期时间（`resets.each[]`），以及按窗口区分的次数（`resets.byWindow`/`fiveHour`/`weekly`，GLM Coding 团队计划用），插件在 host 投影时把这些字段丢掉了。用户因此看不出「哪几张会在什么时候过期、先浪费哪一张」。

同一张卡片上 Codex 只显示一个 `7 days` 窗口，是网关数据本身如此（`/wham/usage` 的 `rate_limit.primary_window`/`secondary_window` 只上报了周窗口），不是插件丢窗口；这次不改窗口展示，也不伪造缺失的窗口。

2026-11-03 实测真实网关（`GET /v1/magpie/quotas/cards`）的 Codex 卡：

```json
{"provider":"codex","plan":"prolite","windows":[{"name":"7 days","used":49,"resetsAt":"…"}],
 "resets":{"count":3,"until":"2026-11-06T23:30:34Z","each":[{"until":"2026-11-06T23:30:34Z"},{"until":"2026-11-30T20:02:48Z"},{"until":"2026-12-01T22:35:39Z"}]}}
```

## What Changes

- host 投影新增 `resets.each[]`（每项 `until`、`window`）与 `resets.byWindow`/`fiveHour`/`weekly`；其余字段投影规则不变（固定字段白名单 + 逐字符串脱敏）。
- 用量卡片的重置区改成与 `dsh-plugin-subscriptions` 一致的折叠列表：摘要行「用量限制重置 · 可用 N 次」（按窗口发放时显示「5 小时 N 次 · 每周 M 次」），展开后逐张列出「完整重置」/窗口 + 「{时间} 到期」，缺到期时间显示「到期时间不可用」，最早一张附相对提示（`N 天后过期` / `N 小时后过期` / `已过期`）。
- 仍然只读：不新增按钮、不调用 Codex 重置端点（`POST /v1/magpie/quotas/codex-reset` 属于另一次改动，涉及不可撤销操作与网关白名单）。
- 文案新增 zh/en 两份；`resetRemaining`/`resetRemainingSuffix` 两个旧 key 由新的摘要 key 取代。
- 版本 0.5.2；README（中/英）与 CHANGELOG 同步；`dsh.yaml` 条目版本与说明同步。

**不在本期范围**：
- Codex 5 小时窗口：网关只上报周窗口时插件无法凭空补上，也不做「缺窗口」推断提示。
- 从 DSH 使用重置卡（写端点、网关 nginx/CF 白名单、二次确认与不可撤销语义）。
- `resetsUsed`（网关切已用过的重置）与卡片上其它未投影字段（`kind`、`balanceSplit`、`from` 等）。

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
- `dsh-magpie-connector`：只读用量卡片的 host 投影字段与重置区展示（逐张过期时间、按窗口次数、相对过期提示）。

## Impact

- 代码：`packages/dsh-magpie-connector/src/host/cards.ts`（`projectCards` 的 resets 投影）、`src/client/UsageCard.ts`（重置区）、`src/client/view-model.ts`（`CardResets`/`CardReset` 与相对过期提示）、`src/client/locales.ts`、`src/client/styles.ts`（如需要），以及对应测试。
- 文档：`packages/dsh-magpie-connector/{README.md,README.zh.md,CHANGELOG.md,package.json}`；`dsh.yaml` 中 `dsh-magpie-connector` 条目。
- 兼容性：纯增量字段；网关不给 `each`/`byWindow` 时退回原行为（`count` + `until`）。不新增请求、不改变读取与刷新语义（仍然只读、只由用户刷新触发）。
- 用户可见：重置区多出每张卡片的过期时间与最早一张的相对提示。
