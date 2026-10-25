# dsh-sidebar-session-provider-icon

[![dsh.so risk](https://www.dsh.so/badge/dsh-sidebar-session-provider-icon.svg)](https://www.dsh.so/artifact/dsh-sidebar-session-provider-icon/)

[English](README.md) · 简体中文

![侧边栏效果：同品牌显示单一 logo，聚合 provider 显示主图 + 右下角 model 小图标（浅色 / 深色主题）](docs/screenshot.png)

<!-- problem -->
DeepSeek Harness（DSH）的侧边栏里每个会话行看起来都一样，不打开会话就分不清它用的是哪个 provider 和 model。这个插件在每个会话标题前显示 provider + model 图标，取值于输入框当前选中的模型，切换后立刻更新。provider 和 model 不是同一家时（例如 `opencode-go/deepseek-v4-flash`），在 provider logo 的右下角叠一个缩小的 model logo。

**安装。** 需要 DeepSeek Harness `0.2.0-rc.2`、Node.js `>=22.19`。

```sh
# 从 npm 安装：预构建，无需构建授权
dsh plugin --profile web add dsh-sidebar-session-provider-icon

# 或直接从源码安装：本地构建，dsh 请求授权时确认即可
dsh plugin --profile web add prgrmrwy/dsh-sidebar-session-provider-icon
```

重启 DSH 并刷新 Web 页面。除此之外不需要任何东西：无配置项、不访问网络、除安装它的 DSH profile 外不写任何文件。

在 ohmydsh 仓库里，本插件通过 `dsh.yaml` 的条目 `sidebar-session-provider-icon`（`source: local`）接入，因此在该仓库改源码只需 `dsh build` 再重启。当前行为见规范 [`openspec/specs/sidebar-session-provider-icon`](https://github.com/prgrmrwy/ohmydsh/blob/main/openspec/specs/sidebar-session-provider-icon/spec.md)；设计演进见归档的 change [`sidebar-session-provider-icon`](https://github.com/prgrmrwy/ohmydsh/tree/main/openspec/changes/archive/2026-08-21-sidebar-session-provider-icon) 和 [`sidebar-provider-icon-composite-model-badge`](https://github.com/prgrmrwy/ohmydsh/tree/main/openspec/changes/archive/2026-10-10-sidebar-provider-icon-composite-model-badge)。

## 行为

会话显示哪个 logo，按以下顺序取数据：

1. **即时选择（优先，且须可核验）。** 官方 `dsh-client-ui-model-selection` 的 store，读作 `ctx.modelDirectories.directoryFor(sessionId).store.current`。它是输入框选择器与 `/model` 命令共享的唯一 per-session 状态，`session.selectModel` 成功后立即发布 `{ provider, model }`。因此当前打开的会话（包括还没发过消息的空白会话）按输入框的选择显示。该 store 属于客户端 Session scope：每次会话列表 / DOM 信号都会重新解析，运行体给同一个 session 换了新 store（离开会话再回来就会发生）时立即重订阅并重读，身份未变时也重读快照。观测值只在其 session 仍是当前打开会话、且该目录仍可解析期间保留；视图离开或目录不再可解析时即丢弃——不再让客户端无法核验的旧值决定某一行的 logo。
2. **已选模型（持久）。** 官方 `modelSelection` 投影的 `next`，即该 session 下一次请求将使用的选择。它由 Host 维护，也覆盖"已选但尚未发送"的选择，因此离开会话之后该行仍然正确。
3. **最近一次请求（冷历史 fallback）。** Host 的 `provider` session projection 折叠会话日志中的 `request/header` 事件，所以尚未在本浏览器加载选择器的历史会话，仍会显示它最近一次真实请求的 provider。重启不丢，不使用 `localStorage`。

品牌判断分两个独立维度：provider route 决定**主图**，model id 决定**右下角小图标**。

| 选择 | 显示 |
|---|---|
| `claude/claude-opus-5`、`codex/gpt-6-luna`、`deepseek-official/deepseek-v4-pro`（同品牌） | 单一 Anthropic / OpenAI / DeepSeek logo |
| `opencode-go/deepseek-v4-flash`、`opencode-go/qwen3.8-flash`、`opencode-go/kimi-k2.7-code` | OpenCode 主图，右下角 DeepSeek / Qwen / Kimi |
| `traex/GPT-5.6-Sol[1m]`、`traex/DeepSeek-V4-Flash`、`traex/Gemini-3.1-Pro-Preview` | Trae 主图，右下角 OpenAI / DeepSeek / Gemini |
| `traex/openrouter-3o[1m]`、`traex/Seed-2.1-Pro-0915` | Trae 主图，右下角 OpenRouter / ByteDance |
| `dsh-magpie-connect` + `claude/claude-haiku-5-5`、`codex/gpt-6-luna`、`opencode-go/deepseek-v4.1-flash`（Magpie 网关） | Magpie 主图，右下角 Anthropic / OpenAI / DeepSeek |
| 已知 route + 认不出的 model（如 `opencode-go/omen-alpha`） | 只显示 route 品牌，不叠小图标 |
| 未知或通用 route | 按 model 名显示单一 logo；仍匹配不上时显示中性的单字母徽标 |

- **route 优先。** `opencode-go/deepseek-v4.1-flash` 的主图是 OpenCode；DeepSeek 只会出现在右下角。
- **网关下小图标说厂商。** 主图已经表达"走了网关"，所以 `dsh-magpie-connect` 会话的右下角是模型厂商（`opencode-go/deepseek-v4.1-flash` → DeepSeek），不是上游平台。
- **认不出不冒充。** 查不到厂商的模型不加小图标，也不会用单字母徽标充当小图标。
- **尺寸。** 复合图标的外框和单一 logo 一样是 14×14，行布局不变。右下角是 10px 的品牌图形本身，向右下溢出 4px，没有圆底、描边或内边距——在这个尺度下任何装饰都会挤掉图形需要的像素。
- **悬停提示。** 始终显示精确的 `provider · model`。

| 层 | 实现 |
|---|---|
| Host | `src/provider.ts` 注册 `provider` projection（依赖 `sessionProjections` 服务），折叠 `request/header`；只承担冷历史 fallback |
| Client 数据 | `selection-binding.ts` 观测当前打开会话的 `ctx.modelDirectories` store（每次信号重新解析）；`provider-map.ts` 依次取：可核验的即时观测 → 官方 `modelSelection` 选择 → `provider` fallback |
| Client DOM | `row-locator.ts` 收拢全部官方行 DOM 知识：每行按官方 `data-row-key="session:<id>"` 精确定位（标题反查仅作为没有该属性时的 fallback），因此同名会话不会互相串用徽标；`MutationObserver` 在标题前维护独立的 badge `<span>` |
| 品牌图 | `src/client/assets/*.svg`，一次下载并随包打入；`logos.ts` 分别判定 provider 品牌与 model 品牌，不同时渲染复合图标 |

徽标内容只由 `(provider, model)` 决定；`index.ts` 只在这两个值或悬停提示变化时重建徽标。

## 配置

无。插件行没有任何 `config` 字段，也不读取环境变量。

## Provider / model → 图标对应关系

下表列出可识别的 provider route 别名与 model 名称示例，不是固定的模型目录。匹配不区分大小写，并去掉 npm scope 和开头的 `dsh-` / `dsh_`。已知 provider 决定主图；model 品牌已知且不同时决定右下角小图标。`—` 表示该品牌不支持这一维度。精确规则见 [`logos.ts`](src/client/logos.ts)。

| 图标 | 品牌 | Provider route / 别名 | Model 名称 / 系列 |
|---|---|---|---|
| <img src="src/client/assets/deepseek.svg" width="24" height="24" alt="DeepSeek"> | DeepSeek | `deepseek`、`deepseek-official` | `deepseek-*` |
| <img src="src/client/assets/openai.svg" width="24" height="24" alt="OpenAI"> | OpenAI | `openai`、`codex` | `gpt-*`、`codex-*` |
| <img src="src/client/assets/anthropic.svg" width="24" height="24" alt="Anthropic"> | Anthropic | `anthropic`、`claude` | `claude-*`、名称含 `anthropic` |
| <img src="src/client/assets/grok.svg" width="24" height="24" alt="Grok"> | Grok / xAI | `grok`、`xai` | `grok-*` |
| <img src="src/client/assets/kimi.svg" width="24" height="24" alt="Kimi"> | Kimi / Moonshot | `kimi`、`moonshot` | `kimi-*`、`moonshot-*` |
| <img src="src/client/assets/glm.svg" width="24" height="24" alt="GLM"> | GLM / 智谱 | `glm`、`z-ai`、`zai`、`zhipu` | `glm-*` |
| <img src="src/client/assets/minimax.svg" width="24" height="24" alt="MiniMax"> | MiniMax | `minimax` | `minimax-*` |
| <img src="src/client/assets/pi.svg" width="24" height="24" alt="Pi"> | Pi | `pi`、`pi-ai` | `pi`、`pi-*` |
| <img src="src/client/assets/openclaw.svg" width="24" height="24" alt="OpenClaw"> | OpenClaw | 名称含 `openclaw` | 名称含 `openclaw` |
| <img src="src/client/assets/hermes.svg" width="24" height="24" alt="Hermes"> | Hermes Agent | `hermes`、`hermas`、`nousresearch`、`nous` | 名称含 `hermes`、`hermas`、`nousresearch` |
| <img src="src/client/assets/opencode.svg" width="24" height="24" alt="OpenCode"> | OpenCode | `opencode`、`opencode-go`、`opencode-zen` | 名称含 `opencode` |
| <img src="src/client/assets/trae.svg" width="24" height="24" alt="Trae"> | Trae | `trae`、`trae-ai`、`traex*` | — |
| <img src="src/client/assets/magpie.svg" width="24" height="24" alt="Magpie"> | Magpie | `magpie`、`magpie-*`、`dsh-magpie-connect` | —（按下文网关规则） |
| <img src="src/client/assets/qwen.svg" width="24" height="24" alt="Qwen"> | Qwen | `qwen`、`dashscope`、`bailian` | `qwen*`、`qwq*` |
| <img src="src/client/assets/hunyuan.svg" width="24" height="24" alt="Hunyuan"> | 腾讯混元 | `hunyuan`、`tencent` | `hunyuan*`、`hy<数字>*`（如 `hy3`、`hy4-preview`） |
| <img src="src/client/assets/longcat.svg" width="24" height="24" alt="LongCat"> | 美团 LongCat | `longcat`、`meituan` | `longcat-*` |
| <img src="src/client/assets/mimo.svg" width="24" height="24" alt="MiMo"> | 小米 MiMo | `xiaomi`、`mimo` | `mimo-*` |
| <img src="src/client/assets/gemini.svg" width="24" height="24" alt="Gemini"> | Google Gemini | `gemini`、`google`、`google-*` | `gemini-*`、`gemma*` |
| <img src="src/client/assets/nvidia.svg" width="24" height="24" alt="NVIDIA"> | NVIDIA | 名称含 `nvidia` | 名称含 `nemotron` |
| <img src="src/client/assets/meta.svg" width="24" height="24" alt="Meta"> | Meta | `meta`、`meta-ai`、`meta-llama*` | `muse-spark*`、名称含 `llama` |
| <img src="src/client/assets/antgroup.svg" width="24" height="24" alt="Ant Group"> | 蚂蚁集团 | `ant-ling`、`inclusionai`、`antgroup` | `ling-*`、`ring-*` |
| <img src="src/client/assets/openrouter.svg" width="24" height="24" alt="OpenRouter"> | OpenRouter | — | `openrouter-*`（如 TraeX 的 `openrouter-3o[1m]`） |
| <img src="src/client/assets/bytedance.svg" width="24" height="24" alt="ByteDance"> | 字节跳动 | — | `seed-*` |

Trae、Magpie 的 route 按完整名 / 前缀匹配，不按任意子串匹配。OpenRouter、ByteDance **仅支持 model 维度**：provider route 单独叫 `openrouter` 不会因此显示 OpenRouter 图标。

model 维度覆盖 OpenCode Go / Zen 模型目录里所有能确认厂商的模型族，并覆盖当前 TraeX 目录中的 GPT、DeepSeek、Gemini、OpenRouter 与 ByteDance Seed 系列。

网关型 route（Magpie）下，model id 形如 `<上游 provider>/<model>`：右下角小图标先按 `/` 后的模型名识别模型厂商（`opencode-go/deepseek-v4.1-flash` → DeepSeek、`claude/claude-haiku-5-5` → Anthropic），模型名认不出时才退回把 `/` 前的上游段当 provider route 识别（`opencode-go/private-model` → OpenCode）；两段都认不出只显示 Magpie。其它 route 仍按整个 model id 识别。

品牌图是固定版本并随包落盘的，不手绘，运行时也不访问 CDN：

- 除 OpenCode、Magpie 外的所有品牌：`@lobehub/icons-static-svg@1.94.0`，MIT；有彩色版时用彩色版；
- OpenCode：`anomalyco/opencode` commit `5e75e5e9901f0d178f425bfb47f1bd46cbe78a59` 中的官方 provider SVG，MIT；
- Magpie：`yetone/magpie` commit `ba1dc7f975666e50308ef7bf8173c8a8e91c553b` 中的官方标志 `internal/provider/magpie.svg`，MIT。

逐个文件的来源 URL 与 SHA-256 校验值见 [`src/client/assets/README.md`](src/client/assets/README.md)。部分彩色 SVG 内含渐变/裁剪 id；右下角实例会给它们加 `-sub` 后缀，避免同一页面的多份 SVG 串用定义。

新增品牌：把 SVG 放进 `src/client/assets/`，在 assets README 记录来源、版本、许可和 SHA-256，再在 `logos.ts` 的 `providerBrandOf` / `modelBrandOf` 里补规则和测试。

## 边界与安全

- 官方 `StateDot` 不会被替换、移动或隐藏；时间、行菜单和拖拽行为保持官方原样。
- badge 是标题前的独立 `<span>`。DOM 无法可靠定位时，插件静默不显示，不破坏页面。
- 自身不发起网络请求：logo 随 bundle 提供，数据来自 DSH 自己的 store 与会话日志。
- 代码为 MIT 许可（[LICENSE](LICENSE)）。品牌图标来自 MIT 许可的上游；其版权声明、渲染时的确切改动与商标立场见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。品牌方保留其商标权利；这些标识只用于标明所选的 provider route 和 model，不暗示任何背书。

## 开发

`lib/` 是被 git 忽略的构建产物。独立检出时：

```sh
npm install
npm run typecheck
npm test
npm run build
```

在 ohmydsh monorepo 里本包是 workspace 成员：在仓库根目录安装一次，后三条命令加上 `--workspace dsh-sidebar-session-provider-icon`。`dsh build` / sync 也会在安装本 local package 之前按需生成 `lib/`；刷新 Web 页面即可加载新的 client bundle。

vitest 下小 SVG 会被内联成 data URL，属性引号会被改成 `'`。改写 SVG 属性的正则要同时兼容 `"` 和 `'`。
