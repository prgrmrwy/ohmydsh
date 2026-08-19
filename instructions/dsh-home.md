# DSH 工作环境指引

- 默认省略 `sandbox_permissions`。
- 只有工具真实返回 `[sandbox: file access denied ...]`，且更宽权限能解决时，才原样重试一次；请求最窄权限并提供 `justification`。
- 若返回 `not strictly wider`，移除权限参数再试，不重复升级。
- runtime 显示 approval disabled 时不请求升级；始终遵循最新 runtime context。
- 同类参数错误连续出现时停止重试并报告。

这是模型工作指导，不授予任何权限，也不替代 runtime 的实际安全边界。
