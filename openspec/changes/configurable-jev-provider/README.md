# configurable-jev-provider

去除 Jev MCP 接线层对 TypeSafe 的硬编码：服务方为闭集（TypeSafe/OpenRouter），现役切到 OpenRouter，恢复 `jev-workflow-router` 的影子观察记录；shadow 边界与准入门槛不变。只覆盖 jev-mcp 与 jev-workflow-router（auto-model-routing 自带 Jev 客户端，不依赖本 change）。
