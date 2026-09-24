# DSH 工作环境指引

- 默认省略 `sandbox_permissions`。
- 只有工具真实返回 `[sandbox: file access denied ...]`，且更宽权限能解决时，才原样重试一次；请求最窄权限并提供 `justification`。
- 若返回 `not strictly wider`，移除权限参数再试，不重复升级。
- runtime 显示 approval disabled 时不请求升级；始终遵循最新 runtime context。
- 同类参数错误连续出现时停止重试并报告。
- 当记忆工具可用时，在完成涉及代码修改、架构决策、调试或非平凡问题求解的任务后，主动判断「未来遇到类似情况时，这条会不会改变做法」；若会，调用 `memex_retro` 写一张原子卡片。不要记录常规命令输出、显而易见的事实、临时聊天上下文或任何密钥/凭据；关联已有卡片时在正文中用 `[[slug]]` 并说明关系为何成立。

这是模型工作指导，不授予任何权限，也不替代 runtime 的实际安全边界。
