# Changelog

## 0.1.0 — 2026-08-21

- 首个版本：host 侧 `provider` session-projection 单元 + web client 侧边栏 provider 徽标注入。
- 数据链路：官方 `SessionProjectionMap` 扩展（键 `provider`），折叠日志 `request/header` 事件（最后一次实际请求的 provider/model），持久化缓存 + 列表帧下发，重启不丢、不存 localStorage。
- 渲染：轻量 DOM 注入 + `row-locator` 单一结构模块；不触碰官方 `StateDot`；定位失败安全降级。
- 对应 openspec change `sidebar-session-provider-icon`。

## 0.1.1 — 2026-08-21

### Real-GUI feedback revision

- 当前打开 session 改为订阅官方 `modelDirectories` selector store：输入框切模型成功后无需发送消息即更新 icon；last-request projection 仅作冷历史 fallback。
- 手绘近似 SVG 全部替换为下载落盘的固定品牌资产：DeepSeek 鲸鱼、OpenAI 螺旋、OpenCode、Anthropic、Grok；运行时不访问 CDN。
- 按真实 route 校正映射：`opencode-go/deepseek-v4-flash` 显示 OpenCode，`deepseek-official/deepseek-v4-flash` 才显示 DeepSeek。
- 空白 session 有当前 selector 值时亦显示品牌；继续保持 StateDot/时间/菜单/拖拽原样。

## 0.1.2 — 2026-08-21

- 按真实 GUI 对齐反馈调整图标间距为仅左侧 4px；新增 Kimi、GLM（智谱）、MiniMax、Pi、OpenClaw、Hermes Agent 的固定品牌资产和 route/model 映射；Hermes 同时兼容用户输入的 `hermas` 别名。

## 0.1.3 — 2026-10-10

- 复合 icon：provider route 与 model id 分别识别出**不同**已知品牌时，主图为 provider 品牌、右下角叠加 7px model 品牌子图标（9px 圆底 + 淡描边，`Canvas` 底色随深浅主题）；同品牌、model 不可识别或 route 未知时仍为单一 logo。外框保持 14×14，行布局不变；tooltip 不变。
- 新增 Trae 品牌资产（`@lobehub/icons-static-svg@1.94.0`，MIT），`trae` / `traex*` / `trae-ai` route 映射到 Trae；此前 `traex/GPT-*` 经 model fallback 误显示 OpenAI。
- 子图标内 SVG 的内部 id 与 `url(#…)` 引用加后缀，避免与同页其它副本串用定义。
- 对应 openspec change `sidebar-provider-icon-composite-model-badge`。

## 0.1.4 — 2026-10-10

### Real-GUI feedback revision

- 子图标去掉圆底、描边与内边距，改为裸 glyph，尺寸 7px → 10px，向右下溢出 4px；14×14 外框不变，行布局不变。
- 按 OpenCode Go / Zen 模型目录补齐 model 品牌：Qwen、混元（`hy3` / `hy4-*`）、LongCat、小米 MiMo、Gemini、NVIDIA（Nemotron）、Meta（Muse Spark / Llama）、蚂蚁（Ling/Ring）。对应 provider route（`qwen-token-plan*`、`xiaomi-token-plan*`、`google`、`nvidia`、`ant-ling` 等）同样映射。资产均为 `@lobehub/icons-static-svg@1.94.0`（MIT）。
- 目录中没有可识别厂商的模型（如 `omen-alpha`、`big-pickle`）仍只显示 OpenCode 单 logo。
