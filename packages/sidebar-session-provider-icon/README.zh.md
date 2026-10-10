# dsh-sidebar-session-provider-icon

[English](README.md) · 简体中文

<!-- problem -->
DSH 的会话列表里每一行看起来都一样，不打开会话就分不清它用的是哪个模型。这个插件在每个会话标题前显示输入框当前选中的模型品牌 logo，切换模型后立刻更新。

![示意图：侧边栏每个会话行都有一个标识该会话所选模型的徽标](docs/overview.png)

**安装。** 通过 `dsh.yaml` 管理（条目 `sidebar-session-provider-icon`，`source: local`）：设为 `enabled: true`，运行 `dsh build`，然后重启 DSH。Backlog 条目 B013；设计见 OpenSpec change `sidebar-session-provider-icon`。

## 行为

会话显示哪个 logo，按以下顺序取数据：

1. **即时选择（优先）。** 官方 `dsh-client-ui-model-selection` 的 store，读作 `ctx.modelDirectories.directoryFor(sessionId).store.current`。它是输入框选择器与 `/model` 命令共享的唯一 per-session 状态，`session.selectModel` 成功后立即发布 `{ provider, model }`。因此当前打开的会话（包括还没发过消息的空白会话）按输入框的选择显示。
2. **最近一次请求（冷历史 fallback）。** Host 的 `provider` session projection 折叠会话日志中的 `request/header` 事件，所以尚未在本浏览器加载选择器的历史会话，仍会显示它最近一次真实请求的 provider。重启不丢，不使用 `localStorage`。

品牌判断先看 provider route、再看 model：例如真实选择 `opencode-go/deepseek-v4-flash` 显示 OpenCode，而不是 DeepSeek。只有未知或通用 route 才按 model 名回落；都匹配不上时显示中性的单字母徽标。

| 层 | 实现 |
|---|---|
| Host | `src/provider.ts` 注册 `provider` projection（依赖 `sessionProjections` 服务），折叠 `request/header`；只承担冷历史 fallback |
| Client 数据 | 订阅 `ctx.modelDirectories` 的 per-session store；选择器的选择优先于 projection fallback |
| Client DOM | `row-locator.ts` 收拢全部官方行 DOM 知识；`MutationObserver` 在标题前维护独立的 badge `<span>` |
| 品牌图 | `src/client/assets/*.svg`，一次下载并随包打入；`logos.ts` 先匹配已知 provider route，再匹配 model |

## 配置

无。插件行没有任何 `config` 字段，也不读取环境变量。

品牌图是固定版本并随包落盘的，不手绘，运行时也不访问 CDN：

- DeepSeek、OpenAI/GPT、Anthropic、Grok、Kimi、GLM（智谱）、MiniMax、Pi、OpenClaw、Hermes Agent（也接受 `hermas` 拼写）：`@lobehub/icons-static-svg@1.94.0`，MIT。
- OpenCode：`anomalyco/opencode` commit `5e75e5e9901f0d178f425bfb47f1bd46cbe78a59` 中的官方 provider SVG，MIT。

逐个文件的来源 URL 与 SHA-256 校验值见 [`src/client/assets/README.md`](src/client/assets/README.md)。

## 边界与安全

- 官方 `StateDot` 不会被替换、移动或隐藏；时间、行菜单和拖拽行为保持官方原样。
- badge 是标题前的独立 `<span>`。DOM 无法可靠定位时，插件静默不显示，不破坏页面。
- 自身不发起网络请求：logo 随 bundle 提供，数据来自 DSH 自己的 store 与会话日志。
- 代码为 MIT 许可（[LICENSE](LICENSE)）。品牌方保留其商标权利；这些标识只用于标明所选的 provider route，不暗示任何背书。

## 开发

依赖在仓库根目录统一安装；`lib/` 是被 git 忽略的构建产物。在仓库根目录运行：

```sh
npm install
npm run typecheck --workspace dsh-sidebar-session-provider-icon
npm test --workspace dsh-sidebar-session-provider-icon
npm run build --workspace dsh-sidebar-session-provider-icon
```

`dsh build` / sync 也会在安装本 local package 之前按需生成 `lib/`。
