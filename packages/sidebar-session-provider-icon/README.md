# dsh-sidebar-session-provider-icon

在 DSH Web 侧边栏的每个 session 行标题前显示该会话**当前在用的 provider** 的动态 logo（codex / claude / grok / deepseek 等官方图标），随会话实际切换 provider 实时更新，重启后依然准确，且不干扰官方任务状态点。

Backlog 条目：[B013](../../BACKLOG.md)。设计与取舍见 openspec change `sidebar-session-provider-icon`。

## 背景

接入订阅制 provider（codex / claude / grok）并与 DeepSeek 混用后，侧边栏大量历史会话各自用了哪个 provider 只能点进会话才看得到。官方 `dsh-client-ui-workspace` 的 session 行**没有 per-row slot**（rc.7 / master rc.8 均无），因此本插件采用「host 侧官方投影通道 + 客户端轻量 DOM 注入」路线，侵入性最低、可维护。

## 架构

| 面 | 实现 |
|---|---|
| Host | 注册 `provider` session-projection 单元（`src/provider.ts`），折叠日志 `request/header` 事件 → 每次会话最后一次实际请求的 `{ provider, model }`，走官方 `SessionProjectionMap` 通道（持久化缓存 + 列表帧 `projectionValues`）下发客户端 |
| Client | `src/client/row-locator.ts` 收拢全部官方行 DOM 结构知识（suffix 匹配 `sessionRow`/`title`，标题反查 id）；`src/client/provider-map.ts` 由列表快照推导 `sessionId → provider`；`src/client/logos.ts` 出 logo 内联 SVG；`src/client/index.ts` 用 `MutationObserver` + `sessions.list` 订阅保持徽标同步 |
| Wire | `cordis.patch.yml` host 行 + `dsh.client` web 声明 |

## 行为约定

- provider 基准 = 该会话**最后一次实际发送的 assistant 请求**的 provider/model（`request/header` 只在路由变化时 append，故折叠最新一条即真相源）。
- 空白 / 无请求会话不显示徽标；无 provider 值时不渲染（零占位跳动）。
- **不触碰官方 `StateDot`**：徽标是插入标题前的独立 `<span>`，状态点/时间/行菜单/拖拽全部保持官方原样，只读。
- 升级安全：行结构一旦变化导致无法可靠定位，静默降级为不显示徽标，绝不误插 / 报错。

## 安装（由总配置管理）

1. `dsh.yaml` 已含本定制（`source: local`），此处仅记录口:
   `node scripts/sync.mjs` → `dsh build` → 重启 DSH。
2. 回滚：删 `dsh.yaml` 中本条目 → `sync` + `dsh build` → 重启。

## 开发

```sh
npm install            # 安装 dev 依赖
npm run typecheck      # host + client 类型检查
npm test               # host 折叠单测 + client 定位器单测
npm run build          # host(tsc) + client(tsdown) → lib/
```

## License

MIT，见 [LICENSE](LICENSE)。Provider logo 为各自官方品牌图形的简化内联 SVG（供应商保留其品牌权利；本项目按"无需考虑版权"的展示用途内置）。
