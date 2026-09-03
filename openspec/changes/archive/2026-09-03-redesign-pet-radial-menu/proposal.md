## Why

Pet 的悬浮菜单当前是一个矩形列表，与「桌宠」这一形态不符，也没有兑现 `add-dsh-pet` 里「轮盘」的原始意图。实际使用中还暴露出三个具体问题：鼠标从桌宠移向菜单的途中菜单会消失；任务面板堆了三个按钮，其中两个（`Open source`、`Archive`）要么用途不明，要么是高危操作不该出现在悬浮层；`petConfirm` 这道通用二次确认拦不住真正危险的能力，却给每个能力都加了一次点击。

设计草图已多轮迭代定稿（`design-notes/wheel-mockup.html`），几何、时序与交互边界均已在静态原型中验证，可以进入实现。

## What Changes

- 用同心圆环轮盘替换矩形悬浮菜单。以桌宠为中心，环宽 38px、呼吸间隙 20px；内圈 6 个、次圈 8 个、外圈 10 个，上限 24 个能力。
- 轮盘文字沿弧线切向排布，遇到会倒立的角度自动翻转 180°，底部扇区因此完全正立。标签按弧长截断（各圈约 5/6/7 字）。
- Tooltip 仅在能力有描述时出现，格式 `名字: 描述`；名字本身不单独弹提示。
- 展开时序：第 1 圈立即出现，其后每圈延迟 0.08s 渐入。
- 悬停唤起只认中心圆；判定改为按到中心的距离，且半径取**实际渲染的圈数**而非固定三圈。离开圆盘即收起，不设延迟。
- **BREAKING** 移除 `petConfirm`：frontmatter 字段、解析、客户端两段式确认流程，以及示例 Skill 中的声明。能力改为单击直接执行。
- 任务面板简化为一行一个任务，整行可点进入执行会话；移除 `Open source`、`Archive` 与 `Cancel`。
- 设置页在启用 Skill 达到 24 个时阻止继续启用；运行时对超出部分不渲染而非报错。
- 移除来源 chip（`SourceChip`）。

## Capabilities

### New Capabilities

无。本变更不引入新能力，只重塑既有 Pet 能力的呈现与交互。

### Modified Capabilities

- `dsh-pet`: 悬浮菜单的呈现形态、悬停与收起判定、能力调用是否需要二次确认、任务面板可用操作、以及启用 Skill 的数量上限，均为规范级行为变化。

  注：`dsh-pet` 的规范目前仍位于未归档的 `add-dsh-pet` change 中，尚未进入 `openspec/specs/`。本变更的 delta 以该 change 的 spec 为基准撰写。

## Impact

**代码**

- `packages/dsh-pet/src/client/overlay.tsx`：轮盘几何与渲染、悬停判定、任务面板、移除 `SourceChip` 与确认流程。
- `packages/dsh-pet/src/client/styles.ts`：新增扇环与标签样式，移除矩形列表样式。
- `packages/dsh-pet/src/client/settings.tsx`：启用数量上限与提示。
- `packages/dsh-pet/src/host/skill-bundle.ts`：移除 `petConfirm` 字段与解析。
- `packages/dsh-pet/skills/examples/*/SKILL.md`：移除 `petConfirm` 声明。

**行为与兼容性**

- 已声明 `petConfirm: true` 的 Skill（示例中的 `clean-worktree`）将不再要求二次确认。该字段被移除后，frontmatter 中的残留声明会被忽略而非报错，因此不破坏既有 Skill 的加载。
- 破坏性能力的安全性由 Skill 自身在 Pet Task 内负责——`clean-worktree` 本就依赖 `wsClean` 的门禁，Pet 入口处的通用确认既非必要也不充分。
- 任务归档入口从悬浮面板移除后，归档仍可在执行会话中进行，`reconcileArchives` 会实时对账：终态任务自动归档，非终态任务保留并给出诊断，不会把外部归档误当作工作已取消。

**不影响**

- Host 侧的任务/调用模型、可信上下文、Skill 授权边界与投影机制均不变。
