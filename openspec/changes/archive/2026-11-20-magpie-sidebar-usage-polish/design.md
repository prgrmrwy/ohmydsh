## Context

用户在 0.7.3 上看过隔离预览并确认效果（2026-11-20）：账号名可压缩，plan、到期时间与读数必须完整；Unknown 只在设置页看；额度改用量。

## Decisions

### D1 两行账号布局
多账号组内单窗口账号渲染为 `.dmg-sidebar-account-line`（账号 + plan）与 `.dmg-sidebar-row-line`（窗口名、到期、读数）两行。曾尝试单行内让 plan 不收缩（账号被挤到 0 宽）与 flex-wrap 自动换行（换行位置不稳定），均放弃。多窗口账号沿用原「账号一行 + 每窗口一行」。

### D2 共享窗口名
组内所有行都未失败、恰好一个窗口、窗口名相同且 `fallback` 相同时，窗口名移到组标题；判断在渲染层完成，不改 `sidebarRows`。

### D3 明细隐藏文字读数
展开明细过滤 `textReading` 且非 `unlimited` 的窗口。收起形态的窗口选择不变（文字读数本就不参与回退的数字比较，只在全部窗口都是文字时作为最后一级回退显示）。

### D4 文案
只改侧栏相关键（`sidebarTitle`、`sidebarPanelTitle`、`sidebarToggle`、`sidebarToggleHint`、`sidebarExpand`、`sidebarCollapse`）；requirement 标题中的「额度」保留以免产生 RENAMED。

## Risks / Trade-offs

- 多账号组变高，超出 320px 时卡内滚动（已有溢出提示）。
- 仅有文字读数窗口的卡片在明细中只剩标题与元信息。
- 同时带有限 `used` 与 `display` 的档位窗口会出现在收起行，却不出现在展开明细（Image generation 本身就是 `used:0` + `display`，按用户决定一并隐藏）。
