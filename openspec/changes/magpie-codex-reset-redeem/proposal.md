## Why

0.6.x 的用量卡片只能看 Codex 重置卡，不能使用；要用重置卡，还得去 Magpie 自己的 Usage 页。上游（yetone/magpie main `7785c42`，2026-11-03）已应 issue #3850 在网关端口新增消费端点 `POST /v1/magpie/quotas/codex-reset?user=<email>&credit=<id>`（`internal/gateway/gateway.go:940` 注册、`:1207` handler；`internal/provider/codex_resets.go` 的 `UseCodexResetCard`/`ResetOutcome`），并在卡片的 `resets.each[]` 里带上每张重置卡的 `id`。插件可以照 `dsh-plugin-subscriptions` 的 `ResetRedemption` 策略接入：只有周用量足够高才允许用，默认只用最早到期的那张，两段确认，结果不确定时锁住不让重试。

同时，现有重置折叠块的箭头离标题太远，展开后的条目也和标题文字没对齐：箭头盒子 16px 宽加 6px 间距，条目却只缩进 18px。subscriptions 插件用的是 12px 的 SVG 箭头加 6px 间距，配 18px 缩进。

## What Changes

- **使用 Codex 重置卡（新能力，不可撤销）**：
  - 门槛与 subscriptions 一致：该账号刚读到的周窗口（`7 days`）用量 **≥ 80%**，且该窗口的重置时间在未来，才允许使用；不满足时按钮禁用，并用提示说明原因（未达 80%／需要先刷新）。
  - 只用最早到期的那张：只有展开列表里最早到期的那一项带「使用…」按钮；host 在准备阶段自己从刚读到的卡片里挑出最早到期、仍可用的那张，浏览器不能指定别的卡。
  - 同一时刻只允许一个使用：全插件范围内最多只有一张待确认票据、最多一个正在提交的消费；第二个请求直接拒绝。
  - 两段确认：「使用…」→ host 重新读该卡、校验门槛，发出 60 秒有效、一次性的确认票据 → 对话框显示账号、周用量、该卡到期时间和不可撤销警告，必须勾选「我理解将消耗一次额度」才能确认 → host 再读一次、再校验一次，确认票据所选那张仍在，再提交。
  - 结果不确定（网络错误、超时、5xx）时，把该账号锁到 host 重启为止，提示用户先去 Magpie 核对，不自动重试；网关明确拒绝（4xx，含 409「正在使用」）时不锁。
  - 网关回 `ResetOutcome.code` 时按代码显示结果（`reset` 成功并刷新卡片；`nothing_to_reset`、`no_credit`、`already_redeemed` 各有文案）。
- **传输白名单**新增 `POST /magpie/quotas/codex-reset`，query 只允许 `user`、`credit`。
- **投影**：`resets.each[].id` 只留在 host 内部，不出现在发给浏览器的响应里（保持现有「each 只投影 until/window」的浏览器边界）。
- **UI 对齐 subscriptions**：箭头改为 12px SVG（展开时旋转 90°），与标题间距 6px；展开条目缩进 18px，与标题文字左对齐；条目行高 28px 以容纳按钮；按钮紧贴「完整重置」文字。
- 文案 zh/en；版本 0.7.0；README（中/英）、CHANGELOG、`dsh.yaml` 条目说明同步。

**不在本期范围**：
- 自建 Cloudflare/nginx 入口白名单（`home-substore` 的 `ops/magpie-cloudflare/nginx.conf`）放行 `codex-reset`：属于另一个仓库与线上部署，需单独批准；放行前插件会如实显示网关返回的 403/404。
- 让用户挑选非最早到期的重置卡（上游支持 `?credit=` 指定，但本期按用户要求默认只用最早到期的）。
- 侧栏额度卡上的使用入口（只在设置页提供）。
- 门槛百分比做成可配置项。
- GLM Coding 等 `byWindow` 计划的重置（厂商页面使用，网关不提供消费端点）。

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
- `dsh-magpie-connector`：传输白名单新增重置消费端点；用量卡片的重置区不再只读，新增「使用 Codex 重置卡」要求；重置折叠块的对齐规则。

## Impact

- 代码：`packages/dsh-magpie-connector/src/host/transport.ts`（白名单与 query 规则）、`src/host/cards.ts`（投影保留内部 credit id）、新 `src/host/reset.ts`（准备/消费、票据、单飞与不确定锁）、`src/host/routes.ts`（新资源）、`src/client/api.ts`（新资源与更长超时）、`src/client/UsageCard.ts`、`src/client/SettingsPage.ts`（确认对话框）、`src/client/locales.ts`、`src/client/styles.ts`，以及对应测试。
- 安全：首个写 Magpie 账号状态的能力，不可撤销。fail closed：卡片读不到、读数不新、门槛不满足、票据过期/不匹配、所选卡已不在、结果不确定，一律不提交。gateway key 需为完整权限（只读或受限 key 由网关以 401/403 拒绝，插件照实显示，不建议扩大权限）。
- 部署：线上入口经 Cloudflare + nginx 白名单时，放行前该功能不可用（显示网关错误）；不影响生成与读取。
- 兼容性：卡片里没有 `each[].id`（旧网关）时不显示按钮；其它卡片行为不变。
