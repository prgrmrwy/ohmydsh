## Why

绑定 Worktree Session 后，输入区状态栏显示任务分支名，但无法一键跳转到该分支对应的独立 worktree 目录。用户需要手动记路径去 VSCode 打开，体验割裂。目标：点击分支名，直接用本机 VSCode 打开当前绑定的 worktree（managed execution root）。

## What Changes

- 绑定后输入区状态栏的任务分支名变为可点击；点击后用本机编辑器打开该 Session 绑定的 managed worktree 目录。
- 实现采用最轻量路线：client 端以 deep link（默认 `vscode://file/<绝对路径>`）交给操作系统/浏览器拉起本机 VSCode；不新增 host 端点、不 spawn CLI、不依赖 `dsh-open-in-vscode` 插件。
- 打开方式设计为可配置（为后续支持其它编辑器/命令行打开方式留口），第一版默认 `vscode://file/`。
- 安全：打开的路径必须是当前调用 Session 的已绑定 worktreePath（来自 Host 持久 binding 的 `stage.worktreePath`），不是用户可任意填写的文本；无绑定时不可点击。
- 仅影响 client UI 交互；不改绑定模型、持久格式、wire、schema。

## Capabilities

### New Capabilities

（无新增 capability。）

### Modified Capabilities

- `source-workspace-worktree-session`: 新增展示/交互行为 Requirement——绑定后分支名点击打开当前 worktree；无绑定不可点击；打开路径固定来自绑定元数据。

## Impact

- `packages/worktree-session/src/client/index.tsx`：可能需声明 `client/controls` 所需 slot 类型或 UI-primitives；若已有无需改。
- `packages/worktree-session/src/client/controls.tsx`：绑定状态分支名 span 增加点击处理（可访问性 `role="button"`、`tabIndex`、hover 时高亮提示“点击打开”）。
- 打开方式配置：在插件 client config 上暴露 `openWorktree`（如 `{ type: 'vscode-deep-link' }` 默认），后续可扩展。
- 测试：`controls.test.ts` 增加点击调用 deep-link 的断言（mock `window.open` / 捕获 URI）。
- 文档：`worktree-session-architecture.html`（若有交互说明）、`packages/worktree-session/README.md` 补注。
- DSH 核心、Host、schema、持久数据均无改动；`vscode://file/` 深链在装有 VSCode 的本机生效，无 VSCode 时由浏览器/系统提示。
