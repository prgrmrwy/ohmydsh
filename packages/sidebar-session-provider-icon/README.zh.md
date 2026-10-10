# dsh-sidebar-session-provider-icon

[English](README.md) · 简体中文

<!-- problem -->
DSH 的会话列表里每一行看起来都一样，不打开会话就分不清它用的是哪个模型。这个插件在每个会话标题前显示输入框当前选中的模型品牌 logo，切换模型后立刻更新。provider 和 model 不是同一家时（例如 `opencode-go/deepseek-v4-flash`），在 provider logo 的右下角叠一个缩小的 model logo。

![侧边栏效果：同品牌显示单一 logo，聚合 provider 显示主图 + 右下角 model 小图标（浅色 / 深色主题）](docs/screenshot.png)

![示意图：徽标的数据来源，以及 route 如何变成徽标](docs/overview.png)

**安装。** 通过 `dsh.yaml` 管理（条目 `sidebar-session-provider-icon`，`source: local`）：设为 `enabled: true`，运行 `dsh build`，然后重启 DSH。当前行为见规范 [`openspec/specs/sidebar-session-provider-icon`](../../openspec/specs/sidebar-session-provider-icon/spec.md)；设计演进见归档的 change [`sidebar-session-provider-icon`](../../openspec/changes/archive/2026-08-21-sidebar-session-provider-icon/) 和 [`sidebar-provider-icon-composite-model-badge`](../../openspec/changes/archive/2026-10-10-sidebar-provider-icon-composite-model-badge/)。

## 行为

会话显示哪个 logo，按以下顺序取数据：

1. **即时选择（优先）。** 官方 `dsh-client-ui-model-selection` 的 store，读作 `ctx.modelDirectories.directoryFor(sessionId).store.current`。它是输入框选择器与 `/model` 命令共享的唯一 per-session 状态，`session.selectModel` 成功后立即发布 `{ provider, model }`。因此当前打开的会话（包括还没发过消息的空白会话）按输入框的选择显示。
2. **最近一次请求（冷历史 fallback）。** Host 的 `provider` session projection 折叠会话日志中的 `request/header` 事件，所以尚未在本浏览器加载选择器的历史会话，仍会显示它最近一次真实请求的 provider。重启不丢，不使用 `localStorage`。

品牌判断分两个独立维度：provider route 决定**主图**，model id 决定**右下角小图标**。

| 选择 | 显示 |
|---|---|
| `claude/claude-opus-5`、`codex/gpt-6-luna`、`deepseek-official/deepseek-v4-pro`（同品牌） | 单一 Anthropic / OpenAI / DeepSeek logo |
| `opencode-go/deepseek-v4-flash`、`opencode-go/qwen3.8-flash`、`opencode-go/kimi-k2.7-code` | OpenCode 主图，右下角 DeepSeek / Qwen / Kimi |
| `traex/GPT-5.6-Sol[1m]`、`traex/DeepSeek-V4-Flash`、`traex/Gemini-3.1-Pro-Preview` | Trae 主图，右下角 OpenAI / DeepSeek / Gemini |
| `traex/openrouter-3o[1m]`、`traex/Seed-2.1-Pro-0915` | Trae 主图，右下角 OpenRouter / ByteDance |
| 已知 route + 认不出的 model（如 `opencode-go/omen-alpha`） | 只显示 route 品牌，不叠小图标 |
| 未知或通用 route | 按 model 名显示单一 logo；仍匹配不上时显示中性的单字母徽标 |

- **route 优先。** `opencode-go/deepseek-v4-flash` 的主图是 OpenCode；DeepSeek 只会出现在右下角。
- **认不出不冒充。** 查不到厂商的模型不加小图标，也不会用单字母徽标充当小图标。
- **尺寸。** 复合图标的外框和单一 logo 一样是 14×14，行布局不变。右下角是 10px 的品牌图形本身，向右下溢出 4px，没有圆底、描边或内边距——在这个尺度下任何装饰都会挤掉图形需要的像素。
- **悬停提示。** 始终显示精确的 `provider · model`。

| 层 | 实现 |
|---|---|
| Host | `src/provider.ts` 注册 `provider` projection（依赖 `sessionProjections` 服务），折叠 `request/header`；只承担冷历史 fallback |
| Client 数据 | 订阅 `ctx.modelDirectories` 的 per-session store；选择器的选择优先于 projection fallback |
| Client DOM | `row-locator.ts` 收拢全部官方行 DOM 知识；`MutationObserver` 在标题前维护独立的 badge `<span>` |
| 品牌图 | `src/client/assets/*.svg`，一次下载并随包打入；`logos.ts` 分别判定 provider 品牌与 model 品牌，不同时渲染复合图标 |

徽标内容只由 `(provider, model)` 决定；`index.ts` 只在这两个值或悬停提示变化时重建徽标。

## 配置

无。插件行没有任何 `config` 字段，也不读取环境变量。

可识别的品牌：

| 维度 | 品牌 |
|---|---|
| provider 与 model | DeepSeek、OpenAI/GPT/Codex、Anthropic/Claude、Grok/xAI、Kimi/Moonshot、GLM（智谱）、MiniMax、Pi、OpenClaw、Hermes Agent（也接受 `hermas` 拼写）、OpenCode、Qwen、腾讯混元（`hy3`、`hy4-*`）、美团 LongCat、小米 MiMo、Gemini/Gemma、NVIDIA（Nemotron）、Meta（Muse Spark、Llama）、蚂蚁（Ling/Ring）、OpenRouter、ByteDance Seed |
| 仅 provider | Trae（`trae`、`trae-ai`、`traex*`；按完整名或前缀匹配，不按子串） |

model 维度覆盖 OpenCode Go / Zen 模型目录里所有能确认厂商的模型族，并覆盖当前 TraeX 目录中的 GPT、DeepSeek、Gemini、OpenRouter 与 ByteDance Seed 系列。

品牌图是固定版本并随包落盘的，不手绘，运行时也不访问 CDN：

- 除 OpenCode 外的所有品牌：`@lobehub/icons-static-svg@1.94.0`，MIT；有彩色版时用彩色版；
- OpenCode：`anomalyco/opencode` commit `5e75e5e9901f0d178f425bfb47f1bd46cbe78a59` 中的官方 provider SVG，MIT。

逐个文件的来源 URL 与 SHA-256 校验值见 [`src/client/assets/README.md`](src/client/assets/README.md)。部分彩色 SVG 内含渐变/裁剪 id；右下角实例会给它们加 `-sub` 后缀，避免同一页面的多份 SVG 串用定义。

新增品牌：把 SVG 放进 `src/client/assets/`，在 assets README 记录来源、版本、许可和 SHA-256，再在 `logos.ts` 的 `providerBrandOf` / `modelBrandOf` 里补规则和测试。

## 边界与安全

- 官方 `StateDot` 不会被替换、移动或隐藏；时间、行菜单和拖拽行为保持官方原样。
- badge 是标题前的独立 `<span>`。DOM 无法可靠定位时，插件静默不显示，不破坏页面。
- 自身不发起网络请求：logo 随 bundle 提供，数据来自 DSH 自己的 store 与会话日志。
- 代码为 MIT 许可（[LICENSE](LICENSE)）。品牌方保留其商标权利；这些标识只用于标明所选的 provider route 和 model，不暗示任何背书。

## 开发

依赖在仓库根目录统一安装；`lib/` 是被 git 忽略的构建产物。在仓库根目录运行：

```sh
npm install
npm run typecheck --workspace dsh-sidebar-session-provider-icon
npm test --workspace dsh-sidebar-session-provider-icon
npm run build --workspace dsh-sidebar-session-provider-icon
```

`dsh build` / sync 也会在安装本 local package 之前按需生成 `lib/`；刷新 Web 页面即可加载新的 client bundle。

vitest 下小 SVG 会被内联成 data URL，属性引号会被改成 `'`。改写 SVG 属性的正则要同时兼容 `"` 和 `'`。
