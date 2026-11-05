# 设计：自动刷新触发真实刷新

## D1 定时器走刷新路径，不走读取路径

`SidebarUsage` 的自动刷新 effect 把 `loadCards(api, { force: true })` 换成 `refreshCards(api)`：

- `refreshCards` 发送 `POST /api/dsh-magpie-connector/cards` body `{all:true}`，host 的 `CardsController.refresh` 校验后向网关发 `POST /v1/magpie/quotas/refresh`（无 query，全量），再用响应替换卡片状态。
- 成功时 `setView(result.view)`；失败（非 2xx、网络错误、JSON 解析失败）时不 `setView`、不 `setError`，保留旧读数，下一个间隔自然重试。
- 仍用 `setTimeout` 链，在读到结果前后都不重叠；host 的刷新闸门与 GET 跟随刷新继续兜底并发。

## D2 为什么用全量刷新而不是逐卡单刷

- 卡头刷新按钮本来就是全量刷新，自动刷新复用同一路径，语义与实现都只有一套。
- 全量刷新只有一个 host 请求和一个网关请求，避免每张卡一次串行往返（刷新闸门会串行化，N 张卡最坏要 N 次等待）。
- 网关对受限 key 会把全量刷新收敛到它可见的卡片（`scopeQuotas`），不会替用户读不可见的账号。
- 逐卡单刷需要客户端自己枚举卡片并在自动刷新里维护多请求状态，收益只有「少读一两张卡」，不值得增加状态机。

## D3 失败与可见性

- 失败静默：自动刷新是后台行为，错误只影响本轮读数；保留旧读数比清空或弹错更符合「静默刷新」。
- 页面隐藏（`document.visibilityState !== 'visible'`）时到期只重新排期、不刷新；恢复可见由既有 `visibilitychange` 监听补一次 `GET cards`（60 秒 TTL 内可能被缓存吞掉，属预期）。
- 间隔为 0 或卡片未启用时不注册定时器，行为与 0.6.x 的事件驱动读取一致。

## D4 缓存边界

`sidebar-api` 的 60 秒 TTL 只约束事件驱动的 `loadCards`；`refreshCards` 本来就绕过 TTL 并直接更新模块级缓存，因此自动刷新与手动刷新不会互相污染缓存。

## 验收

- 默认 5 分钟：挂载时 1 次 `GET cards`；5 分钟后 1 次 `POST cards {all:true}`，没有额外 `GET`，读数由刷新响应更新。
- 设为 0：等待 30 分钟只有挂载那 1 次 `GET`，没有 `POST`。
- 页面隐藏：到期不发出 `GET`/`POST`；恢复可见后补 1 次 `GET`。
- 刷新返回 502：读数保持刷新前的值，界面不出现错误提示。
- 卡片未启用：不注册定时器、不请求卡片。
