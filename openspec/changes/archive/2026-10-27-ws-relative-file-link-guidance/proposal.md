## Why

WS 文件绝对链接在聊天端按仓库 cwd 相对化、读取端按 worktree 执行根恢复时，会重复 worktree 前缀。用户选择通过官方上下文与原生相对链接做轻量兼容，不修改官方内部实现。

## What Changes

- 活动 WS 上下文区分工具路径与回复文件链接：工具继续使用 worktree 内绝对路径；回复链接使用 worktree 执行根相对路径。
- 给出原生 Markdown 示例，明确不附加源仓库或 `.worktrees/任务目录` 前缀。
- 通过上下文回归、类型检查与构建验证；历史链接和官方路径解析保持原状。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `source-workspace-worktree-session`: 增加活动 WS 的文件链接输出指引。

## Impact

仅涉及 worktree-session 稳定上下文、相关回归和规范。复用现有官方 systemPrompt.context，不新增 API、依赖、schema 或部署动作。用户授权完成后直接受控合入。
