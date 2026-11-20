# Proposal

## Why

Magpie 的路由组（自定义组 `group/…`、自动发现组 `auto/…`）是网关的一类重要入口：用户选一个策略，由 Magpie 决定模型、厂商和账号。插件目前按网关 `owned_by` 把它们放进某个厂商分组，而网关给路由组填的是**第一个成员的厂商**（2026-11-20 实测家庭 Magpie 0.1.4499：「便宜优先」「ds」都显示在 `Magpie (Opencode-go)` 下）。跨厂商的组因此被错误归类，成员顺序一变还会换组。

社区 PR [#10](https://github.com/prgrmrwy/dsh-magpie-connector/pull/10)（设置页路由组分区）与 [#11](https://github.com/prgrmrwy/dsh-magpie-connector/pull/11)（picker 路由分组）分别从两个界面提出了这个问题，但识别口径不一致，评审还发现了回归：丢失「恢复跟随网关列表」入口、owner 满额时路由组消失。本 change（已有 32 个其它归属的罕见情形除外，见 design D3）按[产品定位](../../../packages/dsh-magpie-connector/docs/product-positioning.md)把两者整合为一套行为：插件呈现并透传 Magpie 已有的入口，建组和策略留在 Magpie。

## What Changes

- **picker**：id 以 `group/` 或 `auto/` 开头的条目归为路由入口，统一列在 `Magpie (Routing)` 分组（route `dsh-magpie-connector-routing`）；普通模型仍按厂商分组。只按 id 前缀识别，不看显示名或标签。
- **`routing` 走现有归属流程**：它是一个特殊的归属键，进入 `knownOwners`，沿用已有的注册、持久、失败处理与 32 个上限，同一次同步中优先准入。路由入口的 `owned_by` 不再计入归属。
- **设置页**：新增「路由组」分区，与 picker 同一分类；分区有自己的可见性键 `routing` 和「恢复跟随网关列表」。网关给出 `reasoning_levels` 时提供默认推理强度。
- **文案**：默认 effort 下拉的未设置文案改为「默认：不指定」（英文 `Default: not set`）。
- **BREAKING（选择）**：此前在厂商 route 下保存的路由组选择（如 `dsh-magpie-connector-opencode-go / group/ds`）升级后不可用，需在 Routing 分组重选一次；按模型 id 保存的默认 effort 不受影响。
- **BREAKING（偏好）**：此前写在厂商白名单里的路由组可见性不再生效，路由组回到跟随网关。

不在本 change：侧边栏同一厂商多账号的分段展示（另起 change）；显示本轮实际成员模型。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `dsh-magpie-connector`：按网关归属注册 route（路由入口改归 `routing`）、归属 route 持久（`routing` 优先准入）、按 provider 分组的模型可见性（路由组分区与 `routing` 键）、DSH 侧默认 effort（未设置文案）；新增路由入口识别与透传。

## Impact

- 代码：`packages/dsh-magpie-connector/src/host/catalog.ts`（分类与归属键）、`src/host/runtime.ts`（归属准入与上限）、`src/host/routes.ts` 与设置响应（向客户端下发入口类型，客户端不重复实现分类）、`src/client/SettingsPage.ts`、`view-model.ts`、`locales.ts`；对应测试；README（中英文能力说明）、CHANGELOG（两项 BREAKING）、`docs/SCREENSHOTS.md` 与选择器/设置截图。
- 出口守卫与 AUTO：不需要改。守卫只把 claude/anthropic 开头的 provider 或模型 id 视为 Claude，`group/…`、`auto/…` 不受影响；AUTO 不依赖 route 注册。
- 社区：整合 PR 合并后关闭 #10、#11，保留可用提交与 `Co-authored-by` 署名。
