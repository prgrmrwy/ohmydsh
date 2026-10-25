## Why
AUTO 只支持OpenRouter且新策略丢失置信度和决策提示，用户无法切服务或感知实际判断。
## What Changes
- 保持现有OpenRouter默认，新增TypeSafe、Concentrate、兼容System One自定义入口与独立凭据。
- 恢复主/子维度置信度、耗时、服务模型及推荐/应用状态的tooltip/toast；缺值不编造。
- 不跨服务自动回退；测试连接仅用户显式操作，固定公开样例。
## Capabilities
### New Capabilities
- `auto-decision-services-feedback`: 决策服务配置、安全边界与可感知反馈。
## Impact
仅auto-model-routing及测试/文档；不修改旧MCP provider change、不改实际执行入口、不发布。用户2026-10-25授权继续实施并沿用本地部署验收授权。
