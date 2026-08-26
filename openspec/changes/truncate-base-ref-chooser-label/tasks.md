## 1. 共享单行省略样式

- [x] 1.1 `packages/worktree-session/src/client/controls.tsx`: 在 `controlStyle`（L16）之外新增内部常量（如 `ellipsisStyle`），承载 `boxSizing: 'border-box'`、`display: 'block'`、`whiteSpace: 'nowrap'`、`overflow: 'hidden'`、`textOverflow: 'ellipsis'`，不改动 `controlStyle` 本体（避免波及下拉搜索 `<input>`，见 design 决策 1）
- [x] 1.2 让已绑定状态栏的 `branchStyle`（L81）复用该常量，消除字面量重复，保持现有渲染结果不变（`lineHeight: '24px'`、`padding: '0 8px'` 等既有断言仍成立）

## 2. 创建态 base ref 选择器

- [x] 2.1 base ref 按钮（L100-104）叠加 1.1 的省略样式，使长 ref 名单行截断而非换行撑高输入区
- [x] 2.2 该按钮 `title` 改为动态复合文案：已选中时为 `<完整 ref 名> — Choose the base ref; selection has no Git side effects`，未选中时保留原纯说明文案
- [x] 2.3 下拉候选项 button（L110）叠加单行省略样式并设置 `title={ref.name}`；确认候选点击仍只调用 `setStage({ baseRef })`，不新增任何请求或 Git 副作用
- [x] 2.4 确认下拉搜索 `<input>`（L106，`maxWidth: 'none'`）与 `Worktree` 勾选按钮（L115）样式语义未被本次改动影响

## 3. 测试

- [x] 3.1 `packages/worktree-session/test/controls.test.ts`: 新增创建态渲染用例（`session.blank = true`、stage 带 `refs` 与长 `baseRef`），断言按钮 inline style 含 `white-space:nowrap` / `overflow:hidden` / `text-overflow:ellipsis`，且 `title` 同时含完整 ref 名与原说明文案
- [x] 3.2 新增下拉展开后的候选项用例，断言候选 button 含单行省略样式与 `title="<ref 名>"`
- [x] 3.3 回归既有已绑定状态栏用例（单行省略、`title`、可点击 `role="button"`/`aria-label`）全绿
- [x] 3.4 运行 `npm test`（package 内 `vitest run`）与 `npm run typecheck`

## 4. 文档与规范校验

- [x] 4.1 `worktree-session-architecture.md`（L54 附近描述输入区状态 UI）补充：创建态 base ref 选择器同样单行省略 + hover 完整名
- [x] 4.2 `npx openspec validate truncate-base-ref-chooser-label --type change --strict`
- [x] 4.3 归档前 `npx openspec validate source-workspace-worktree-session --type spec --strict`

## 5. 物化与验收

- [x] 5.1 仓库根 `npm test` 与 `npm run check:artifacts`
- [ ] 5.2 `dsh build`（或 `node scripts/sync.mjs`）物化 client bundle；连续运行第二次确认 sync 幂等无新增变更
- [ ] 5.3 在 DSH Web GUI 刷新后用长分支名（如 `feat/per-model-default-reasoning-effort`）人工核对：输入区单行不换行、hover 可见完整名
