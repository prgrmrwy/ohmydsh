# Proposal

## Why

0.7.3 发布后用户在真实网关上看侧栏用量卡（2026-11-20）：多账号行里窗口名不在组标题上，长 plan（`self_serve_business_prolite`）与账号名争宽导致信息看不全；展开明细中 `Image generation Unknown` 这类网关文字读数对侧栏没有价值；侧栏文案「额度」与 Magpie 官方的「用量」不一致。

## What Changes

- 多账号收起形态：每个账号两行——账号标识（唯一可截断）与完整 `plan` 一行，窗口名、到期时间、读数与进度条一行。
- 组内每个账号显示同一窗口时，窗口名只在组标题显示一次（`Codex (7 days) 4 个账号`）。
- 侧栏展开明细与浮层不再列出网关 `display` 文字读数的窗口；设置页用量卡照旧显示。
- 侧栏相关中文文案「额度」改为「用量」（`Magpie 用量`、「侧边栏用量」等）；重置卡相关的「重置额度」不变。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `dsh-magpie-connector`：侧边栏额度开关（文案）、侧边栏卡片的展开收起（浮层 aria 文案）、侧边栏多账号分段（两行布局与共享窗口名）、侧边栏进度条只对百分比读数绘制（明细隐藏文字读数窗口）。

## Impact

`src/client/SidebarUsage.ts`、`styles.ts`、`locales.ts` 与测试；发版 0.7.4。
