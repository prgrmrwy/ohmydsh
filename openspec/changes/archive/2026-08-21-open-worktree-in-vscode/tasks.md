## 1. Client UI interaction

- [x] 1.1 `packages/worktree-session/src/client/controls.tsx`: 绑定状态分支名 span 增加点击打开行为——构造 `vscode://file/<worktreePath>` deep link 并交系统打开；仅在 `lifecycle !== 'cleaned'` 且 `worktreePath !== undefined` 时提供
- [x] 1.2 分支名可点击态加 `role="button"`、`tabIndex={0}` 与 Enter/Space keydown 触发；保留 hover title（完整分支名）+ 单行省略样式
- [x] 1.3 新增内部 `openWorktreeInEditor(path)`（默认 deep link）并将打开方式收敛到配置位（默认 `vscode-deep-link`），`client/index.tsx` 必要时把 config 传给控件

## 2. Tests

- [x] 2.1 `test/controls.test.ts` 新增：点击绑定分支名触发 `vscode://file/<worktreePath>` 深链（含含空格路径的编码）
- [x] 2.2 新增：无绑定/cleaned 时不生成打开请求、分支名不可点击
- [x] 2.3 回归：分支名单行省略 + title 既有断言仍绿

## 3. Docs / build

- [x] 3.1 `packages/worktree-session/README.md` 与 `worktree-session-architecture.html` 补注“分支名点击用本机编辑器打开绑定 worktree（默认 vscode://file deep link，可配置）”
- [x] 3.2 运行 `openspec validate source-workspace-worktree-session --type spec --strict` 与 `openspec validate open-worktree-in-vscode --type change --strict`
- [x] 3.3 `dsh build`/`sync` 物化 client bundle，验证二进制幂等与 `git diff --check`
