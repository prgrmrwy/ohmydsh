# sidebar-session-provider-icon

## Why

多模型混用后，侧边栏无法一眼看出每个 session 输入框下一次发送将使用哪个模型。初版按“最后一次实际请求”显示且使用手绘简化 SVG；实机反馈表明这会让用户切换输入框模型后仍看到旧 icon，且图形无法准确表达 DeepSeek 鲸鱼、OpenAI 螺旋和 OpenCode 等品牌。

## What Changes

- Web client 直接订阅官方 `dsh-client-ui-model-selection` 的 per-session `ModelDirectory.store.current`；输入框选择成功后，侧边栏对应 session 的 logo 立即更新，无需先发送消息。
- Host `provider` session-projection 保留，但降级为冷历史 fallback：尚未在本浏览器打开/加载选择器的历史 session 仍可用最近一次实际请求推导 logo，重启不丢且不使用 localStorage。
- 品牌映射同时读取 provider + model：已知 provider route 优先（真实路由 `opencode-go/deepseek-v4-flash` 必须显示 OpenCode），未知/兼容 route 才按 model fallback；覆盖 DeepSeek、OpenAI/GPT/Codex、OpenCode、Anthropic/Claude、Grok。
- 不再手绘 SVG：品牌资产从固定版本来源下载并随包落盘，构建时内联，不产生浏览器运行时网络请求。
- **边界不变**：不得替换、移动、隐藏或改写官方任务状态 `StateDot`、时间、菜单与拖拽行为。

## Capabilities

### New Capabilities
- `sidebar-session-provider-icon`: 每行 session 的当前选中模型品牌 logo；选择器即时状态优先，持久最后请求 fallback；轻量 DOM 注入且不触碰官方状态点。

### Modified Capabilities
<!-- 无。 -->

## Impact

- `packages/sidebar-session-provider-icon/` client 新增对 `@deepseek-ai/dsh-client-ui-model-selection` 的 peer/inject 依赖。
- `src/client/assets/` 保存固定来源的品牌 SVG；client bundle 内联，不运行时下载。
- Host projection/协议不变，只改变 client 对两类数据源的优先级。
- DOM 结构依赖仍只存在于 `row-locator.ts`，官方 session 行无 per-row slot 的约束不变。
