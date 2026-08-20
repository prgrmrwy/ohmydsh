## 1. Client UI implementation

- [x] 1.1 `packages/worktree-session/src/client/controls.tsx`: 分支名 span（L66）增加 `whiteSpace: 'nowrap'`、`overflow: 'hidden'`、`textOverflow: 'ellipsis'`，并在该 span 上设置 `title={stage.taskBranch}`
- [x] 1.2 确认外层 container 的 `data-testid="worktree-session-status"` 与 `controlStyle` 尺寸语义保持不变

## 2. Tests

- [x] 2.1 新增/更新 client 单测：状态栏分支名 span 的样式包含 nowrap/hidden/ellipsis，且 `title` 等于完整 task branch
- [x] 2.2 回归既有 `client-handoff`/`controls` 相关测试全绿

## 3. Docs / build

- [x] 3.1 `worktree-session-architecture.html`（若描述输入区状态展示）注明分支名单行省略 + hover 完整名
- [x] 3.2 运行 `openspec validate source-workspace-worktree-session --type spec --strict` 与 `openspec validate truncate-worktree-branch-name --type change --strict`
- [x] 3.3 `dsh build` 物化 client bundle，验证 sync 幂等与 `git diff --check`
