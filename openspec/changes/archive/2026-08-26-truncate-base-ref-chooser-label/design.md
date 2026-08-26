## Context

见 proposal.md - Why。约束来自当前实现现状（已实际阅读 `packages/worktree-session/src/client/controls.tsx`）：

- `controlStyle`（L16）是所有输入区控件共享的基础样式，只有 `height: 26` 与 `maxWidth: 190`，没有任何单行/溢出规则。
- 已绑定状态栏的 branch span（L81）在 `controlStyle` 之上单独叠加了 `boxSizing/display:block/lineHeight/padding/whiteSpace/overflow/textOverflow`，这是上一次 change 的产物；因此“缩略能力”只存在于 `lifecycle !== undefined` 分支。
- 创建态 base ref 按钮（L100-104）只用了 `{ ...controlStyle, padding: '0 8px' }`，长 ref 名在 `maxWidth: 190` 内自然换行 → 按钮变两行、整行输入区被撑高，与截图一致。
- 该按钮的 `title` 是常量说明文案，不含 ref 名；下拉候选 button（L110）也无溢出规则，面板 `width: 300` 下长 remote ref 同样换行。
- 该组件渲染在 `conversation.input.left` slot，样式为内联 `React.CSSProperties`，无 CSS 文件、无 class 系统；测试用 `renderToStaticMarkup` 断言 inline style 字符串（`packages/worktree-session/test/controls.test.ts`）。

## Goals / Non-Goals

**Goals:**

- 单行省略 + hover 完整名的处理从状态栏推广到创建态选择器（按钮与候选项）。
- 保持既有测试断言方式（inline style 字符串断言）可继续覆盖新行为。
- 与已绑定状态栏视觉高度一致，避免两种控件在同一行呈现不同行高。

**Non-Goals:**

- 不引入 CSS 文件、Tailwind 或 design-token class 体系。
- 不改动 `maxWidth` 之外的布局容器策略，不做响应式宽度自适应或 tooltip 组件化（原生 `title` 足够）。
- 不改 base ref 选择的语义、handoff、wire 协议或 Host 侧任何逻辑。

## Decisions

**决策 1：把单行省略规则提升为共享样式，而不是第三次复制。**
新增一个内部常量（如 `ellipsisStyle` 或把规则并入 `controlStyle`），供 branch span、base ref 按钮、候选项复用。备选方案是照抄现有 branch span 的字面量：被否决，因为本缺陷的根因正是“上次只在一个分支加了规则”，复制第三份会让第四个控件继续漏掉。
选择在 `controlStyle` 之外单列常量而非直接改 `controlStyle`：`controlStyle` 也被下拉搜索框 `<input>`（L106，`maxWidth: 'none'`）复用，`input` 不需要 `display: block` / `lineHeight` 这类文本行规则，直接改基础样式会波及无关控件。

**决策 2（最终形态）：完整 ref 名提示用页内弹层（`BaseRefHoverLabel`），不依赖原生 `title`。**
原生 `title` tooltip 在 DSH GUI 中实测不弹出（用户反馈），且无头浏览器无法渲染原生 tooltip、展示不可判定；按钮因此改为 `aria-label`（保留无障碍语义，同时避免双层提示）。弹层在按钮下方 0 间距渲染（`width: max-content`、最多 420px 可换行、`pointer-events: none`、`zIndex: 1001`），文案为“完整 ref 名 — Choose the base ref; selection has no Git side effects”；未选中 ref 时只有纯说明文案。
**互斥选择**：弹层仅在**下拉列表关闭**时渲染（`!open && hovered`）；列表打开时指针需要用于候选 hover/滚动，弹层必须让位。`onMouseEnter/Leave` 挂在按钮自身而非 wrapper——列表是 wrapper 的子元素，指针移入列表不会触发 wrapper 的 `mouseleave`，会导致弹层“僵尸”残留。
**备选方案**：a) 只放 ref 名（丢弃“无 Git 副作用”提示）：否决，该语义在 spec 中有独立保证；b) 保持原生 title + 弹层双保险：否决，会出现双层提示；c) 弹层与列表共存：实测与列表交互冲突，被用户否决。

**决策 3：候选项 `display: block` + `nowrap/hidden/ellipsis` + `title={ref.name}` + hover 高亮。**
候选项已是 `display:block; width:100%`，补溢出三件套与 `title`。鼠标悬停候选项必须有视觉反馈（用户验收确认），`BaseRefOption` 内部维护 hovered 状态，取色 `refOptionBackground(selected, hovered)`：已选中 `#3370ff22` > 悬停 `var(--dsw-alias-interactive-bg-hover, #00000014)`（跟随 DSH 主题）> 透明。备选方案是加宽面板：否决，remote ref 名长度无上界，加宽只是把阈值推高且挤占输入区。

**决策 4：不改 `maxWidth: 190`。**
190px 是既有视觉约定，也已被状态栏使用；本次只让超出部分省略而不是换行。调整宽度属独立的视觉调优，超出本 change 范围。

## Risks / Trade-offs

- [省略后短名与长名视觉无差别，用户可能不知道被截断] → hover 提供完整名；与已绑定状态栏行为一致，用户已有心智模型。
- [原生 `title` 在触摸设备/键盘导航下不可见] → 按钮同时保留可读文本与 `aria` 语义；本 change 是展示性修复，可访问性增强（如 aria-describedby）留待独立 change。
- [`controlStyle` 复用面广，改动可能波及下拉输入框] → 决策 1 已用独立常量隔离；测试对状态栏与候选面板分别断言，回归可见。
- [inline style 断言脆弱（属性顺序/写法变化即失败）] → 沿用既有测试写法，断言单个 CSS 声明子串而非整串 style，保持与现有 `controls.test.ts` 一致。
