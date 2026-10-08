# dsh-cockpit-memex-browse-shim

部署侧唯一耦合点：把 bridge 的端口转发注册给 memex 通用浏览地址扩展。两端源码与依赖互不引用，移除 shim 即解耦。

## 0.2.0 行为与前置

- 要求 bridge 提供 `cockpitBridge.forwards`（正式部署 pin 0.6.1）。不再支持旧 `portForward` / channel register / publish 契约。
- 无顶层 inject；完整 dotted name 单次 `ctx.get()` 读取，支持两端任意加载顺序。
- 使用 `acquire(devicePort, holder)`，按端口单飞；holder 含绑定 随机绑定标识，避免旧绑定的迟到释放影响替换绑定。
- starting/retrying/paused 通过 `onChange` 等待 ready，最长 15 秒。只交付当前 `handle.address.url`，不缓存 URL、不自行重试。打开后保留 holder，避免标签页刚打开隧道就被回收。
- removed 拒绝当前等待；不自动重新申请。下一次显式打开可重新 acquire，包括句柄在两次点击之间被删除的情况。
- 只有结构化 `CockpitForwardsError` 的 `code === 'local-device'` 回落 `http://localhost:<port>`。unavailable（未握手/不在 cockpit iframe）无法证明浏览器与设备同机，和网络/业务失败一样原样上抛；用户仍可直接使用已知设备地址。
- 从未发现 bridge 的 memex-only 部署保持默认本机行为。发现 bridge 后再卸载或替换，取消等待并释放旧句柄；bridge 消失时保留失败关闭 resolver，防止远端地址悄悄回落浏览器 localhost。
- 记忆端卸载或 shim dispose 时注销 resolver。释放包括迟到 acquire，失败有处理；bridge 的页面实例回收提供最终保障。

## 验证

独立 package test/typecheck/build；集成回归使用 memex 真实 registry（未接线默认返回 localhost），而非会隐藏误路由的假 registry。覆盖就绪等待、并发、地址变化、移除、失败分类与服务生命周期。

## 移除与回滚

删除 manifest 条目 → `dsh build` → 重启，两端无需迁移。需要回滚旧 shim 时必须同时回滚 bridge 到提供旧服务的版本；不要把 0.1.1 shim 与 bridge 0.6.1 混用。
