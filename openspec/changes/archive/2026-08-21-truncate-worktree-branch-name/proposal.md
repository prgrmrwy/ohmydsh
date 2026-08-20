## Why

输入区 Worktree Session 状态中，任务分支名过长时会在单行内换行，破坏状态栏单行布局；且外层容器 hover 展示的是 worktree 路径而非分支名，用户无法快速查看完整名称。

## What Changes

- 输入区状态栏内的任务分支名显示为单行，超出可用宽度时以省略号（ellipsis）截断，不再换行。
- hover 分支名时展示完整的 task branch 名称（而非 worktree 路径）。
- 仅影响绑定后状态栏的展示；不改变绑定模型、生命周期、路由或任何持久数据。

## Capabilities

### New Capabilities

（无新增 capability。）

### Modified Capabilities

- `source-workspace-worktree-session`: 新增展示性 Requirement——输入区状态栏的分支名 SHALL 单行省略展示且 hover 可查看完整名称。属于“Dependency mode is observable without mutating conversation context”之外的状态展示行为补充。

## Impact

- `packages/worktree-session/src/client/controls.tsx`：分支名 span 增加 `whiteSpace: nowrap`、`overflow: hidden`、`textOverflow: ellipsis`，并设置 `title={stage.taskBranch}`。
- `packages/worktree-session/test/client-handoff.test.ts` 或新增 client 单测：验证状态栏 text 单一且不再换行（DOM style 断言）。
- 文档：`worktree-session-architecture.html` 若描述状态栏展示则同步注明单行省略。
- DSH 核心、Host、wire、持久格式与 schema 均无改动。
