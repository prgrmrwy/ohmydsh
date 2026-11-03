# 设计：可配置自动刷新

## D1 设置形状

`sidebarRefreshMinutes?: number` 存于插件 host 设置（与 `sidebarUsage` 同文件）。语义：缺失或非正数为关闭（界面把 `0` 当关闭），默认 `5`；合法范围 `0–1440` 的整数。设置视图始终返回解析后的值（默认 5），客户端不必猜测默认。

## D2 定时器边界

- 只在卡片启用（`sidebarUsage === true`）且 `minutes > 0` 时运行；组件卸载、关闭开关、改间隔都会清理旧定时器。
- 用 `setTimeout` 链而不是 `setInterval`：每次读取完成后再排下一次，避免请求堆叠；`sidebar-api` 的 inflight 合并兜底。
- 页面 `document.visibilityState === 'hidden'` 时到期只重新排期、不读取；恢复可见由既有的 `visibilitychange` 补读一次。
- 自动刷新只调用 `loadCards`（GET），不调用 `refreshCards`（POST `{all:true}`）——它不该替用户强制网关刷新。
- 读取失败保持旧读数，不弹错误、不影响其他功能（与手动刷新区分）。

## D3 设置页控件

「Sidebar usage」面板里、开关下方一行：标签「自动刷新」+ `input[type=number]`（min 0 / max 1440 / step 1）+「分钟」。失焦或回车提交，空值/非法值回退到当前值；`0` 表示关闭，面板文案说明。写入走既有 settings POST，成功后同步客户端 store，侧栏立即换间隔。

## 验收

- 默认 5：不配置时设置页显示 5，侧栏每 5 分钟静默读取一次。
- 关闭：设为 0 后不再自动读取（只有挂载/手动/展开/重新可见）。
- 改间隔：设为 2 后下一次自动读取在 2 分钟后；输入非法值被拒绝或回退。
- 页面隐藏到期不读取；重新可见补一次。
