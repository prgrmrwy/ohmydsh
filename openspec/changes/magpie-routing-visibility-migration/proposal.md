# Proposal

## Why

0.7 起路由入口改用 `routing` 可见性键，0.7 之前写在厂商键里的路由入口显示/隐藏选择不再生效，路由组悄悄回到跟随网关（#10 作者 abworks-dev 在 0.7.3 上实测 7 个 id 受影响）。同时 0.7.4 的紧凑用量卡中，长 plan（`self_serve_business_prolite`）与账号名挤在同一行，账号名被截得几乎看不出（用户 2026-11-20 反馈）。

## What Changes

- 首次目录同步时，把 0.7 之前保存在厂商键下的路由入口可见性一次性迁移到 `routing` 键（按旧规则计算可见集合，并从厂商键移除这些 id）。已有 `routing` 键时不动。会话中保存的模型选择插件无法迁移，README 补升级说明。
- 侧栏多账号紧凑形态：账号单独一行，第二行为 plan、窗口名、到期时间与读数（只有账号可截断，其余完整，放不下时到期与读数换行）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `dsh-magpie-connector`：按 provider 分组的模型可见性（一次性迁移）、侧边栏多账号分段（紧凑行布局）。

## Impact

`src/host/{catalog,visibility,runtime}.ts`、`src/client/{SidebarUsage,styles}.ts` 与测试；README、CHANGELOG。迁移思路来自 abworks-dev（#10），提交带 `Co-authored-by`。
