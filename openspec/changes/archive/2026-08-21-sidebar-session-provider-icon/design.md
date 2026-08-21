# sidebar-session-provider-icon — Design

## Context

官方侧边栏 session 行没有 per-row slot，因此渲染仍采用轻量 DOM 注入，所有 DOM 假设集中在 `row-locator.ts`。需求口径经实机反馈修订：logo 应表示输入框当前选择，而非只表示最后请求；品牌图必须使用真实下载资产而非手绘近似图。

官方 model-selection 的实现提供恰当数据面：

- `ctx.modelDirectories.directoryFor(sessionId).store.current` 是输入框 selector 与 `/model` 命令共享的状态；
- `current` 类型为 `{ provider, model, reasoningEffort? }`，含义是“下一次 assembled step 的模型选择”；
- `session.selectModel` 成功后 store 同步更新，失败则保留旧选择；
- store 支持 `getSnapshot()` + `subscribe()`，无需拦截 DOM 点击或自行调用 RPC。

## Goals / Non-Goals

**Goals:**
- 当前打开 session 的 icon 随输入框选择成功立即变化，不等待发送消息。
- 冷历史 session 仍可凭持久请求投影显示近似当前品牌，不使用 localStorage。
- 使用下载落盘的真实品牌 SVG，正确区分 DeepSeek、OpenAI/GPT、OpenCode 等。
- 保持 StateDot、时间、菜单、拖拽完全不变。

**Non-Goals:**
- 不为所有历史 session 主动恢复 agent 或逐个调用 `session.models`；这会改变运行状态并产生不必要开销。
- 不影子替换整棵 sidebar。
- 不在浏览器运行时访问外部图标 CDN。

## Decisions

### D1 数据优先级：selector store > last-request projection

客户端维护本进程观察到的 `sessionId → {provider,model}` map：

1. `sessions.list.current` 变化时，解析当前 session 的 `ModelDirectory`；
2. 订阅 `directory.store`，`current` 非空时写入 map 并 reconcile；
3. 首次 `current === null` 时调用官方 `directory.load()`，让输入框和侧栏共享同一加载；
4. session 离开 current 后保留最近观察值；再次切回会重新订阅并刷新；
5. 未观察到 selector 值的历史行回退到 `projectionValues.provider`。

这保证即时切换，同时不批量唤醒历史 agent。host projection 继续折叠 `request/header`，但语义明确为 cold fallback，不再宣称是所有行的主真相源。

### D2 品牌映射：已知 provider route 优先，model 作为未知-route fallback

真实会话 route 抽样确认 `opencode-go/deepseek-v4-flash`：这里品牌应是 OpenCode，而不是 model 名里的 DeepSeek。因此 `brandKeyOf(provider, model)` 先识别已知 route（`opencode-go`、`deepseek-official`、`codex`、`claude`、`grok`），仅当 route 为未知/通用兼容层时再按 model 推断。未知值使用中性首字母。

### D3 资产：固定来源下载落盘，构建时 text loader 内联

- DeepSeek、OpenAI、Anthropic、Grok：`@lobehub/icons-static-svg@1.94.0`（MIT）；
- OpenCode：`anomalyco/opencode@5e75e5e9901f0d178f425bfb47f1bd46cbe78a59` 官方 provider SVG（MIT）。

SVG 文件保存在 `src/client/assets/`；tsdown `loader: { '.svg': 'text' }` 将其编入 `lib/client.js`。不手写 path，不运行时联网。

### D4 渲染边界保持不变

MutationObserver 只维护标题前的独立 badge span；`row-locator.ts` 是唯一 DOM 耦合点。官方 StateDot、时间、菜单、拖拽节点不读写。定位失败静默跳过。

## Risks / Trade-offs

- **只即时观察 current session**：离屏历史 session 如果在别的客户端进程切换但未发送请求，本客户端无法知道；主动逐一恢复/拉取所有历史 agent 成本更高且有副作用，因此接受 projection fallback 的有限陈旧性。
- **第三方品牌资产更新**：资产锁版本/commit，升级显式进行，避免 CDN 漂移。
- **route 命名持续演进**：优先维护已知 route 映射；未知兼容 route 可按 model fallback，仍无法识别则显示中性 fallback，不误冒充。
- **DOM 升级风险**：继续集中在 row-locator，并以不显示作为安全降级。

## Migration / Acceptance

1. build/typecheck/test；确认真实 SVG 被编入 client bundle。
2. sync 到隔离 DSH_HOME，检查 plugin host/client 加载。
3. GUI 验收：选 DeepSeek/GPT/OpenCode 时 icon 正确；不发送消息直接切模型，当前行立即更新；StateDot/时间/菜单/拖拽不变。
4. 用户确认后经受控合入；重启真实 DSH 生效。
