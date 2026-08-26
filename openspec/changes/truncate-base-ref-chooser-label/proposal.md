## Why

已归档的 change `2026-08-21-truncate-worktree-branch-name` 只治好了**已绑定状态栏**的分支名（`controls.tsx` 的 branch span 有 `nowrap/overflow/ellipsis` 与 `title`），而**空白会话的创建态**——base ref 选择器按钮（`controls.tsx:100-104`）——从未做同样处理：它只有 `maxWidth: 190`，没有 `whiteSpace/overflow/textOverflow`，因此 `feat/per-model-default-reasoning-effort` 这类长 ref 名会在按钮内换行，把输入区控件撑成两行、破坏单行布局（用户截图即此现象）。同时该按钮的 `title` 只有静态说明文案，hover 也看不到被截断的完整 ref 名。

## What Changes

- 创建态 base ref 选择器按钮的标签 SHALL 单行渲染，超出可用宽度以省略号截断，不再换行撑高输入区。
- hover 该按钮时 SHALL 能看到当前选中的完整 base ref 名称，并保留原有“选择 base ref 无 Git 副作用”的说明语义（形如 `feat/xxx — Choose the base ref; selection has no Git side effects`）。
- 下拉候选列表中的 ref 名同样按单行省略渲染，并以 `title` 提供完整名称（长 remote ref 在 300px 面板内同样会换行，属同一缺陷类）。
- 纯展示性修复：不改变 base ref 选择语义（选择仍无 Git 副作用）、不改变绑定模型、生命周期、handoff、wire 协议或任何持久数据。

## Capabilities

### New Capabilities

（无新增 capability。）

### Modified Capabilities

- `source-workspace-worktree-session`: 新增一条展示性 Requirement——创建态 base ref 选择器（按钮标签与候选项）SHALL 单行省略展示，且 hover 可见完整 ref 名称。与既有 Requirement “Input-area status shows the task branch in one line with a hover title” 平行，覆盖其未覆盖的创建态控件。

## Impact

- `packages/worktree-session/src/client/controls.tsx`：base ref 按钮补 `boxSizing/whiteSpace/overflow/textOverflow` 与动态 `title`；候选项 button 补单行省略与 `title`。
- `packages/worktree-session/test/controls.test.ts`：新增创建态渲染断言（单行省略样式、`title` 含完整 ref 名、候选项 `title`）。
- 文档：`worktree-session-architecture.md` 若描述输入区控件展示，同步注明创建态也单行省略 + hover 完整名。
- 构建：`dsh build`（`scripts/sync.mjs`）重新物化 client bundle；需验证 sync 幂等。
- DSH 核心、Host 路由、wire schema、持久绑定格式均无改动。
