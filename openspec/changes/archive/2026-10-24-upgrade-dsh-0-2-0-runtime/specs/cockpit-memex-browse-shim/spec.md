## MODIFIED Requirements

### Requirement: 两端缺任一方即整体不生效，且不影响任一方加载

本 package SHALL 在运行时以完整 dotted name 探测 `dshMemex.browseAddress` 与 `cockpitBridge.forwards`，MUST NOT 声明顶层 inject，MUST NOT 阻碍任一端加载。两端 MAY 任意顺序加载。

从未发现 bridge 时 SHALL 保持默认本机行为。已发现 bridge 后，其卸载或替换 SHALL 释放旧绑定的句柄、取消等待；记忆注册点仍在时 SHALL 保留失败关闭的 resolver，MUST NOT 因 bridge 消失而恢复默认 localhost。记忆端卸载或 shim dispose 时 SHALL 注销 resolver。

#### Scenario: 仅安装记忆插件
- **WHEN** 部署中没有 bridge 服务且从未接线
- **THEN** shim SHALL 不产生效果，记忆侧使用默认本机地址

#### Scenario: 仅安装驾驶舱桥接
- **WHEN** 记忆注册点缺席
- **THEN** shim SHALL 不产生效果，bridge 正常加载

#### Scenario: 任一端后加载
- **WHEN** 两端较晚的一端加载
- **THEN** shim SHALL 注册 resolver，使用新 forwards 契约

#### Scenario: 一端卸载后解除接线
- **WHEN** 已接线后记忆端卸载或其 fiber 销毁
- **THEN** shim SHALL 注销 resolver，取消等待并释放旧句柄；bridge 端卸载则解除句柄绑定但保留失败关闭 resolver

#### Scenario: bridge 卸载后拒绝错误本机地址
- **WHEN** 已接线后 bridge 消失
- **THEN** shim SHALL 释放旧句柄，后续打开 SHALL 失败而非返回浏览器 localhost

### Requirement: shim 最薄——只探测与转接

本 package SHALL 只做服务探测、resolver 注册注销及 forwards 必要生命周期适配，MUST NOT 自行重试、缓存 URL 或校验/改写 bridge 交付的地址。它 SHALL 使用 `acquire(devicePort, holder)`，每个端口在当前绑定内单飞并持有句柄直到绑定结束；只有 ready 状态的 `handle.address.url` 可以交付。非 ready 状态 SHALL 通过 onChange 等待，就绪等待 SHALL 有界（15 秒），完成、失败或取消后 SHALL 移除监听与计时器。removed SHALL 拒绝当前打开，MUST NOT 自动重新 acquire；下一次显式打开 MAY 重新申请。

仅结构化 `CockpitForwardsError` 的 `code: local-device` SHALL 回落 memex 默认的 `http://localhost:<port>`。`unavailable`（包括握手尚未完成）及其余错误 SHALL 原样传播；未知错误或消息文本 MUST NOT 作为本机判据。解绑 SHALL 释放全部已持有句柄；异步 acquire 在解绑后才完成时 SHALL 释放迟到句柄并拒绝交付。释放失败 SHALL 被处理而非形成未捕获 rejection，bridge 页面实例回收仍是最终保障。

#### Scenario: 不承载业务逻辑
- **WHEN** 审阅 shim
- **THEN** shim SHALL 只保留必要句柄与等待生命周期，不校验/改写 bridge 地址，不缓存 URL，不承载库业务或自行重试

#### Scenario: 失败原样上抛
- **WHEN** bridge 转接失败且不是结构化 local-device
- **THEN** shim SHALL 原样传播失败，由记忆侧呈现原因

#### Scenario: starting 后 ready
- **WHEN** acquire 返回 starting 句柄，随后 onChange 通知 ready
- **THEN** shim SHALL 等到 ready 后交付当前 address.url，移除等待监听，并保留 holder

#### Scenario: 重建改变地址
- **WHEN** 已持有句柄从 ready 经 retrying 回到 ready 且地址变化，用户再次打开
- **THEN** shim SHALL 读取新地址，不返回旧 URL 缓存

#### Scenario: removed 不自动重新申请
- **WHEN** 等待中的句柄被删除
- **THEN** 当前打开 SHALL 失败且不重新 acquire，只有下一次显式打开才可再次申请

#### Scenario: 本机拒绝与不可用不混淆
- **WHEN** bridge 抛出结构化 local-device，或抛出 unavailable
- **THEN** 仅前者 SHALL 回落本机地址，后者 SHALL 失败

#### Scenario: 生命周期结束回收异步资源
- **WHEN** bridge/registry 替换、卸载或 shim dispose，包括 acquire 尚未完成时
- **THEN** 旧请求 SHALL 不交付地址，等待资源 SHALL 清理，已持有及迟到句柄 SHALL 被释放
