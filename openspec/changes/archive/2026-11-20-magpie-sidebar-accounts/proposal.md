# Proposal

## Why

同一厂商在 Magpie 里有多个账号时（2026-11-20 用户实测：4 张 Codex 卡片，两个 `self_serve_business_prolite`、两个 `free`），侧边栏额度卡每张卡都显示成同名的 `Codex (7 days)` / `Codex (30 days)`，展开后也只有重复的 `Codex` 标题，分不清是哪个账号。这是 `magpie-routing-entries` 讨论中已确认、但移出该 change 的需求。

同时侧边栏对网关给出文字读数的窗口（例：Codex 卡的 `{name: "Image generation", used: 0, display: "Unknown"}`）仍画一条 0% 进度条，像是「用了 0%」。设置页的用量卡早已只在读数为百分比时画进度条（`UsageCard.ts` `WindowRow`），侧边栏没有对齐。

## What Changes

- **侧边栏多账号分段**：同一 `provider` 在本次卡片结果中有两张及以上卡片时，收起与展开形态都只显示一次厂商名并附账号数，每张卡片前加账号标识（`user`，没有时「账号 N」；附 `plan`）。窗口行、到期时间、读数、进度条的渲染规则不变；单账号厂商保持原样。同一厂商的卡片归到该厂商在网关结果中首次出现的位置。
- **进度条只对百分比读数绘制**：读数显示为「无限」或网关 `display` 文本时，侧边栏不画进度条，也不把该窗口当作数字读数参与回退选择。与设置页一致。
- 不展示多账号分配方式（网关不提供），不改设置页、卡片数据投影、刷新与重置卡逻辑。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `dsh-magpie-connector`：侧边栏常驻额度卡（排序与多账号分段）；新增侧边栏多账号分段、侧边栏进度条只对百分比读数绘制两条 requirement。

## Impact

- 代码：`packages/dsh-magpie-connector/src/client/sidebar-view.ts`、`SidebarUsage.ts`、`locales.ts`、`styles.ts`；对应测试。
- 发版：0.7.2；README 侧栏额度卡描述、CHANGELOG、`dsh.yaml` 版本。
- 隐私：账号标识来自网关卡片 `user`（常为邮箱），会常驻显示在侧边栏；设置页已显示同一字段，侧栏开关默认关闭。
