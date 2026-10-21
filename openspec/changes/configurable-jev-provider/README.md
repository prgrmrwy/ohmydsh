# configurable-jev-provider

去除 Jev 接线层对 TypeSafe 的硬编码，provider/凭据可配置为闭集（TypeSafe/OpenRouter/Cloudflare/Vercel），并以 spike 验证 HTTP 451 下的替代 provider；只覆盖 jev-mcp 与 jev-workflow-router（auto-model-routing 自带 Jev 客户端，不依赖本 change）。
