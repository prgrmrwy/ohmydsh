# 侧栏额度自动刷新改为真实刷新

## 为什么

0.6.2 的自动刷新每 `sidebarRefreshMinutes` 分钟只发 `GET /api/dsh-magpie-connector/cards`（插件 host 再转成网关的 `GET /v1/magpie/quotas/cards`）。当时假设「读一次卡片就能拿到新读数」，但当前网关（yetone/magpie）对 `GET /v1/magpie/quotas/cards` 的语义是：**只返回它上次读到的缓存卡片，不再问上游**（`internal/gateway/gateway.go` 的 `quotaCards` 直接 `provider.CachedCards`，注释写明 “no vendor asked for it”）；只有 `POST /v1/magpie/quotas/refresh`（`quotaCardsRefresh`）才会让网关重读，同一张卡 30 秒内最多重读一次。

因此定时器虽然按 spec 在跑，读数却永远不变，用户看到的就是「5 分钟自动刷新失效」：

- 实例 A（2026-11-05 本机实测）：Claude 卡片 `readAt=2026-11-03T21:33:02-05:00`，`5 hours` 窗口 `used=0`；对同一张卡执行 `POST /v1/magpie/quotas/refresh?provider=claude&user=…` 后变成 `5 hours used=8%`、`7 days` 从 20% 升到 33%。插件把 `5 hours` 正确映射成 5 小时行，0 只是冻结的旧值，不是解析错误。
- 实例 B：穿过网关发一次真实 Claude 对话请求，卡片 `readAt` 仍不动——普通转发不会顺带刷新卡片缓存。
- 端点重复 `GET` 得到的 `readAt` 完全一致，与网关源码语义吻合。

## 改什么

- 侧栏额度卡的自动刷新从「静默 `GET cards`」改为「静默全量刷新 `POST cards {all:true}`」，与卡头刷新按钮走同一条路径；网关由此真正重读上游。
- 自动刷新仍由 `sidebarRefreshMinutes` 控制（默认 5，`0` 关闭，范围 0–1440），仍然只在卡片启用时运行、页面隐藏时到期不刷新、恢复可见后补读一次。
- 自动刷新失败时保留旧读数、不显示错误、不影响其他功能；下一个间隔重试。
- 事件驱动的读取（挂载、展开、页面重新可见）继续用 `GET cards` + 60 秒 TTL，不额外触发上游读取。

## 代价与边界

- 每个间隔会触发一次网关侧的上游用量读取（网关对每张卡 30 秒节流）；默认 5 分钟，用户可改大或设为 0 关闭。Magpie 自己的 Usage 页也按定时刷新，量级相当。
- 不修改网关、不新增设置、不改 host 资源接口；纯客户端行为变更。
- 不改手动刷新（卡头按钮仍是全量刷新），不改设置页的单卡刷新。

## 不做什么

- 不为「每张卡单独定时刷新」引入新设置或新的 host 通道。
- 不把网关 `GET` 语义变化当作上游 bug 处理；插件必须适配真实语义。
- 不在自动刷新里显示错误或「未重新读取」提示，那仍只属于用户手动刷新。
