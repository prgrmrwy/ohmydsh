# Changelog

## 0.1.0 — 2026-08-21

- 首个版本：host 侧 `provider` session-projection 单元 + web client 侧边栏 provider 徽标注入。
- 数据链路：官方 `SessionProjectionMap` 扩展（键 `provider`），折叠日志 `request/header` 事件（最后一次实际请求的 provider/model），持久化缓存 + 列表帧下发，重启不丢、不存 localStorage。
- 渲染：轻量 DOM 注入 + `row-locator` 单一结构模块；不触碰官方 `StateDot`；定位失败安全降级。
- 对应 openspec change `sidebar-session-provider-icon`、backlog B013。

## 0.1.1 — 2026-08-21

### Real-GUI feedback revision

- 当前打开 session 改为订阅官方 `modelDirectories` selector store：输入框切模型成功后无需发送消息即更新 icon；last-request projection 仅作冷历史 fallback。
- 手绘近似 SVG 全部替换为下载落盘的固定品牌资产：DeepSeek 鲸鱼、OpenAI 螺旋、OpenCode、Anthropic、Grok；运行时不访问 CDN。
- 按真实 route 校正映射：`opencode-go/deepseek-v4-flash` 显示 OpenCode，`deepseek-official/deepseek-v4-flash` 才显示 DeepSeek。
- 空白 session 有当前 selector 值时亦显示品牌；继续保持 StateDot/时间/菜单/拖拽原样。

## 0.1.2 — 2026-08-21

- 按真实 GUI 对齐反馈调整图标间距为仅左侧 4px；新增 Kimi、GLM（智谱）、MiniMax、Pi、OpenClaw、Hermes Agent 的固定品牌资产和 route/model 映射；Hermes 同时兼容用户输入的 `hermas` 别名。
