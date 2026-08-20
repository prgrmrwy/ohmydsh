## ADDED Requirements

### Requirement: Branch name opens the bound worktree in the local editor
在绑定会话的输入区状态栏中，任务分支名 SHALL 是可点击的；用户点击后，系统 SHALL 使用本机编辑器打开该会话绑定的 managed worktree 目录。打开路径 MUST 来自该会话的持久绑定元数据（`worktreePath`），而不是用户可任意指定的文本。未绑定或已清理的会话 MUST 不提供该打开行为。

#### Scenario: Click the branch name of a bound Session
- **WHEN** 用户点击绑定会话状态栏的任务分支名
- **THEN** 系统 SHALL 请求本机编辑器打开该绑定的 managed worktree 目录

#### Scenario: Opened directory is the bound worktree path
- **WHEN** 系统构造编辑器深链
- **THEN** 打开目标 SHALL 精确等于该会话持久绑定中的 `worktreePath`，且不得退化为仓库根目录或其他路径

#### Scenario: No binding yet
- **WHEN** 会话尚未绑定 worktree（空白会话或没有 lifecycle 状态）
- **THEN** 分支名 SHALL 显示为普通文本且不可点击，不产生任何打开请求

#### Scenario: Cleaned historical Session
- **WHEN** 会话的绑定已经是 cleaned（旧 worktree 已删除）
- **THEN** 系统 SHALL 不尝试打开旧路径，且不提供可点击打开行为

### Requirement: Editor open behavior is configurable
系统 SHALL 允许配置编辑器打开方式；默认 SHALL 使用 `vscode://file/<绝对路径>` deep link 交给本机处理。配置变更 MUST NOT 改变绑定模型、持久格式、wire 或 schema。

#### Scenario: Default deep link
- **WHEN** 用户未自定义打开方式且点击分支名
- **THEN** 系统 SHALL 以 `vscode://file/<worktreePath>` 交给本机打开

#### Scenario: Missing local editor
- **WHEN** 本机没有注册处理 deep link 的编辑器
- **THEN** 系统 SHALL 不静默失败；其行为由操作系统/浏览器对未注册 scheme 的标准处理决定，且不得伪造成功
