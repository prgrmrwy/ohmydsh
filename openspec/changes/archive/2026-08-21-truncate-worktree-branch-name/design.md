## Context

输入区状态栏由 `packages/worktree-session/src/client/controls.tsx` 的 `WorktreeControls` 渲染。绑定后分支名展示在 `controls.tsx` L66 的 span：

```tsx
<span style={{ ...controlStyle, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 8px' }}>
  ⑂ {stage.taskBranch ?? 'worktree'}
</span>
```

`controlStyle`（L12）只有 `height: 26, maxWidth: 190`，未约束文本换行与溢出。外层 container（L65）的 `title={stage.worktreePath}` 让 hover 显示的是 worktree 路径而非分支名。

## Goals / Non-Goals

**Goals:**
- 输入区状态栏分支名单行显示，超宽省略。
- hover 分支名显示完整 task branch。
- 保持现有 `controlStyle` 的尺寸/边框/颜色语义不变。

**Non-Goals:**
- 不改绑定模型、生命周期、路由、持久格式或 schema。
- 不改 lean/mutable、active/cleaned 等其他状态文字。
- 不调整外层 container 的 `title`（worktreePath 仍可用于其他文本 hover 时参考，但分支名自身将覆盖显示其完整名称）。

## Decisions

### 1. 分支名 span 加溢出约束，分支名优先显示

对 L66 分支名 span 追加内联样式：

```ts
whiteSpace: 'nowrap',
overflow: 'hidden',
textOverflow: 'ellipsis',
maxWidth: 190, // 继承 controlStyle.maxWidth，保证省略生效
```

并在同一 span 设置 `title={stage.taskBranch}`。

- **理由**: `textOverflow: ellipsis` 仅在块级/`overflow: hidden` + 固定宽度下生效；`inline-flex` 下需 `nowrap` 防止内部换行。`title` 直接放在分支名 span 上，使 hover 命中文字区域时展示分支名（HTML title 在相同区域下子元素优先于父级，故会覆盖外层 worktreePath）。
- **备选 A**: 把 `title` 放外层 container并改其内容为分支名。→ 拒绝：会丢失 worktree 路径 hover 信息，且 `data-testid` 定位样式依赖外层属性。
- **备选 B**: 使用 `max-width` 单位调整（如 `maxWidth: 'min(190px, 30vw)'`）。→ 作为后续可选项；本次保持 190 与现有视觉一致，减少回归面。

### 2. 保持组件结构与测试钩子不变

- 不新增 DOM 层级，`data-testid="worktree-session-status"`（L65）保持不变。
- 复用现有 `title` 机制，不引入新依赖。

## Risks / Trade-offs

- [`textOverflow` 在个别浏览器对 `inline-flex` 子项表现不一致] → 增加 `display: block` 或保留 inline-flex 但显式 `whiteSpace: nowrap`；本实现采用后者，并依赖 Web 构建后的实际 DOM 验证。
- [子元素 title 覆盖父级 worktreePath 的行为差异] → hover 分支名显示分支名、hover 状态栏其他空白处仍显示 worktree 路径；若产品希望统一，后续可收敛到单一 title。

## Migration Plan

1. 修改 `controls.tsx` 分支名 span。
2. 补 client 单测断言单行与 title 值。
3. `dsh build` 物化 client bundle，重启 Host 生效（本会话仅 build，不自动重启）。
4. 回滚：`git revert` 本 change 文件；无持久数据迁移。

## Open Questions

无。
