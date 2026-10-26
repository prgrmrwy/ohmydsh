## ADDED Requirements

### Requirement: Worktree reply file links distinguish their base from tool paths

活动 Worktree Session 的稳定模型上下文 SHALL 指引 Agent 对托管执行目录内文件使用相对于该执行目录的 Markdown 回复链接，并说明不附加源仓库绝对路径或 worktree 分配目录前缀。指引 MUST 明确该约定仅用于回复中的文件链接，本地文件与搜索工具仍须使用托管执行目录内绝对路径。该兼容方案 SHALL 通过官方上下文扩展提供，不改写历史回复或替换官方文件打开逻辑。

#### Scenario: Active binding receives distinct path guidance
- **WHEN** 为活动绑定生成稳定模型上下文
- **THEN** 上下文包含执行根相对的 Markdown 文件链接示例，并同时保留工具绝对路径要求

#### Scenario: Inactive binding receives no active file-link guidance
- **WHEN** 绑定已清理、释放或不存在
- **THEN** 系统不为该绑定注入活动 worktree 文件链接指引
