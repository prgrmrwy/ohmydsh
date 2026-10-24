## Purpose

把 dsh-memex 的浏览地址注册点与驾驶舱侧的端口发布能力接起来，使跨机器部署下卡片浏览可达；它是本仓唯一知道这两者同时存在的地方，移除它即解除耦合，两端均无需改动。

## Requirements

### Requirement: shim 是唯一耦合点，两端互不知晓

本 package SHALL 是本仓唯一同时引用「记忆卡片浏览」与「驾驶舱端口发布」两端的地方。两端 MUST NOT 互相引用对方的 package 名、服务名或产品名，也 MUST NOT 依赖本 package。

移除本 package SHALL 足以解除两端耦合，且 MUST NOT 要求修改任何一端。

#### Scenario: 两端源码互不提及
- **WHEN** 审阅两端插件的源码与依赖声明
- **THEN** 其中 MUST NOT 出现对方的 package 名或服务名，也不出现本 shim 的名字

#### Scenario: 移除 shim 即解耦
- **WHEN** 从部署中移除本 package
- **THEN** 两端各自完整加载并正常工作，记忆卡片浏览回落为本机地址行为，无需修改任一端

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

### Requirement: 跨插件服务读取使用完整 dotted name 的单次读取

本 package 读取任一端的服务时 SHALL 使用完整 dotted name 的单次 inject-free 读取（形如 `ctx.get('a.b')`），MUST NOT 先读父服务再取子属性（形如 `ctx.get('a').b`）。

依据：Cordis 会把注册为 `<service>.<name>` 的点属性重新路由回 context proxy，而 context proxy 强制 `inject`，使这个本应可降级的可选接缝抛出未捕获错误。该失败已在本仓实测记录。

#### Scenario: 以完整名读取
- **WHEN** 审阅本 package 对两端服务的读取方式
- **THEN** 每次读取都使用完整 dotted name 的单次调用，不出现先取父服务再访问子属性的写法

#### Scenario: 缺席读取不抛错
- **WHEN** 某端服务尚未注册时本 package 读取它
- **THEN** 读取返回空值而非抛出未捕获错误，本 package 据此保持未接线
