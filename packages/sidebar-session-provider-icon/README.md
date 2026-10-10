# dsh-sidebar-session-provider-icon

在 DSH Web 侧边栏每个 session 标题前，显示该会话**输入框当前选中模型**的品牌 logo。在模型选择器里切换成功后，logo 立即更新，不需要先发消息。provider 和 model 不是同一家时（例如 `opencode-go/deepseek-v4-flash`、`traex/GPT-5.6-Sol`），主图显示 provider，右下角叠加 model 的品牌小图标。

![侧边栏效果：同品牌为单一 logo，聚合 provider 为主图 + 右下角 model 小图标（浅色 / 深色主题）](docs/screenshot.png)

> 截图为脱敏示意：会话标题、工作区名均为虚构；图标由本包 `logos.ts` 的真实输出渲染，行容器样式仿照官方侧边栏。

- Backlog 条目：[B013](../../BACKLOG.md)
- 当前规范：[`openspec/specs/sidebar-session-provider-icon`](../../openspec/specs/sidebar-session-provider-icon/spec.md)
- 设计历史：[首版](../../openspec/changes/archive/2026-08-21-sidebar-session-provider-icon/)、[复合 icon](../../openspec/changes/archive/2026-10-10-sidebar-provider-icon-composite-model-badge/)

## 显示规则

provider route 决定**主图**，model id 决定**右下角小图标**。两个维度分别判定：

| 选择 | 显示 |
|---|---|
| `claude/claude-opus-5`、`codex/gpt-6-luna`、`deepseek-official/deepseek-v4-pro`（同品牌） | 单一 Anthropic / OpenAI / DeepSeek logo |
| `opencode-go/deepseek-v4-flash`、`opencode-go/qwen3.8-flash`、`opencode-go/kimi-k2.7-code` | OpenCode 主图 + 右下角 DeepSeek / Qwen / Kimi |
| `traex/GPT-5.6-Sol[1m]` | Trae 主图 + 右下角 OpenAI |
| 已知 route + 认不出的 model（如 `opencode-go/omen-alpha`） | 只显示 route 品牌，不叠小图标 |
| 未知/通用 route | 按 model 品牌显示单一 logo；仍认不出则显示中性首字母 |

要点：

- **provider route 优先**：`opencode-go/deepseek-v4-flash` 的主图是 OpenCode，不会因为模型名被误判成 DeepSeek；DeepSeek 只出现在右下角。
- **认不出不冒充**：查不到厂商的模型不加小图标，也不会用首字母充当小图标。
- **尺寸**：复合 icon 外框和单一 logo 一样都是 14×14，行布局不变。小图标是 10px 的品牌图形本身，没有圆底、描边或内边距（在这个尺度下这些装饰会挤掉图形本身的像素），向右下溢出 4px。
- **tooltip**：鼠标悬停始终显示精确的 `provider · model`。

## 支持的品牌

| 维度 | 品牌 |
|---|---|
| provider 与 model | DeepSeek、OpenAI/GPT/Codex、Anthropic/Claude、Grok/xAI、Kimi/Moonshot、GLM/智谱、MiniMax、Pi、OpenClaw、Hermes Agent（兼容 `hermas`）、OpenCode、Qwen、腾讯混元（`hy3`、`hy4-*`）、美团 LongCat、小米 MiMo、Gemini/Gemma、NVIDIA（Nemotron）、Meta（Muse Spark、Llama）、蚂蚁（Ling/Ring） |
| 仅 provider | Trae（`trae` / `trae-ai` / `traex*`，按完整名或前缀匹配） |

model 维度覆盖 OpenCode Go / Zen 模型目录里所有能确认厂商的模型族（样本取自 pi-ai 内置的 `opencode-go.json` / `opencode.json`）。新增品牌时：把 SVG 放进 `src/client/assets/`，在 [assets/README.md](src/client/assets/README.md) 记录来源、pin、许可和 SHA-256，再在 `logos.ts` 的 `providerBrandOf` / `modelBrandOf` 里补规则和测试。

## 数据优先级

1. **即时真相源**：官方 `dsh-client-ui-model-selection` 的 `ctx.modelDirectories.directoryFor(sessionId).store.current`。输入框 selector 和 `/model` 命令共享这份 per-session state，`session.selectModel` 成功后立即发布 `{ provider, model }`。
2. **历史 fallback**：Host 的 `provider` session-projection 折叠日志里的 `request/header`，给还没在本浏览器打开过（selector 未加载）的历史会话提供最近一次实际请求的品牌。重启不丢，不用 localStorage。

所以当前打开的 session（包括还没发消息的空白 session）按输入框选择显示；冷历史 session 在 selector 加载前按最后一次请求显示。

## 架构

| 面 | 实现 |
|---|---|
| Host | `src/provider.ts` 注册 `provider` projection，折叠 `request/header`，只承担冷历史 fallback |
| Client 数据 | 订阅 `ctx.modelDirectories` 的 per-session store；selector 选择优先于 projection fallback |
| Client DOM | `row-locator.ts` 收拢官方行 DOM 知识；`MutationObserver` 只在标题前维护独立 badge span |
| 品牌图 | `src/client/assets/*.svg` 下载后随包落盘；`logos.ts` 分别判定 provider 品牌与 model 品牌，异品牌时渲染复合 icon |

badge 内部结构完全由 `(provider, model)` 派生，`index.ts` 只在这两个值或 tooltip 变化时重建 badge。

## 品牌资产

不手绘 SVG，浏览器运行时也不访问 CDN：

- 除 OpenCode 外的所有品牌：`@lobehub/icons-static-svg@1.94.0`，MIT；有彩色版时优先用彩色版；
- OpenCode：`anomalyco/opencode` commit `5e75e5e9901f0d178f425bfb47f1bd46cbe78a59` 的官方 provider SVG，MIT。

逐个文件的来源与校验值见 [assets/README.md](src/client/assets/README.md)。部分彩色 SVG 内含渐变/裁剪 id；小图标实例里的 id 会统一加 `-sub` 后缀，避免同一页面的多份 SVG 串用定义。

## UI 边界

- **不触碰官方 `StateDot`**：不替换、不移动、不隐藏；
- 时间、行菜单、拖拽行为保持官方原样；
- badge 是标题前的独立 `<span>`；
- DOM 无法可靠定位时静默降级为不显示，不破坏页面。

## 开发

依赖由仓库根 workspace 统一安装，`lib/` 是 gitignored 构建产物：

```sh
# 在仓库根执行
npm install
npm run typecheck --workspace dsh-sidebar-session-provider-icon
npm test --workspace dsh-sidebar-session-provider-icon
npm run build --workspace dsh-sidebar-session-provider-icon
```

直接运行 `dsh build` / sync 时，也会在安装 local package 前按需生成 `lib/`。改完刷新 Web 页面即可看到效果。

注意：vitest 下小 SVG 会被内联成 data URL，属性引号会变成单引号；改写 SVG 属性的正则要同时兼容 `"` 和 `'`。

## License

代码 MIT，见 [LICENSE](LICENSE)。品牌资产库/上游仓库许可见上文；各品牌方保留商标权利，这些标识仅用于标明所选 provider / model，不代表任何背书。
