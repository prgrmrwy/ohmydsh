## ADDED Requirements

### Requirement: Input-area status shows the task branch in one line with a hover title
输入区状态栏在展示已绑定工作会话的任务分支名时，SHALL 以单行渲染并在超出可用宽度时以省略号截断；当用户 hover 该分支名文本时，SHALL 展示完整的 task branch 名称。该展示行为 MUST 不改变绑定模型、生命周期状态或任何持久数据。

#### Scenario: Long branch name stays on one line
- **WHEN** 已绑定会话的任务分支名在状态栏可用宽度内无法完整容纳
- **THEN** 状态栏 SHALL 保持单行布局，超宽部分以省略号显示且不发生换行

#### Scenario: Hover reveals the full branch name
- **WHEN** 用户将指针悬停在状态栏的分支名文本上
- **THEN** 系统 SHALL 展示该分支的完整名称（而非 worktree 路径）

#### Scenario: Short branch name is unaffected
- **WHEN** 任务分支名在可用宽度内可完整容纳
- **THEN** 状态栏 SHALL 完整显示分支名且不添加省略号或截断
