# Changelog

## 0.1.0 — 2026-08-21

- 首个版本：host 侧 `provider` session-projection 单元 + web client 侧边栏 provider 徽标注入。
- 数据链路：官方 `SessionProjectionMap` 扩展（键 `provider`），折叠日志 `request/header` 事件（最后一次实际请求的 provider/model），持久化缓存 + 列表帧下发，重启不丢、不存 localStorage。
- 渲染：轻量 DOM 注入 + `row-locator` 单一结构模块；不触碰官方 `StateDot`；定位失败安全降级。
- 对应 openspec change `sidebar-session-provider-icon`、backlog B013。
