## Context

绑定后输入区状态栏由 `packages/worktree-session/src/client/controls.tsx` 渲染（见 proposal.md - Why）。分支名 span 当前是纯展示（`title` + ellipsis）。本次为其增加“点击用本机编辑器打开绑定 worktree”的交互，且不与现存的 `dsh-open-in-vscode` 插件耦合：不新增 host 端点、不 spawn CLI，仅 client 端发起编辑器 deep link。

目标目录来自 `stage.worktreePath`（Host `sessionStatus` 返回的持久绑定 worktreePath），天然满足“打开绑定的 managed root、不可任意指定”。

## Goals / Non-Goals

**Goals:**
- 绑定状态分支名可点击，点击后以编辑器 deep link 打开 `stage.worktreePath`。
- 无绑定/cleaned 时不可点击、无副作用。
- 打开方式默认可配置；默认 `vscode://file/<path>`。
- 最小实现：不改 wire、host、schema、持久格式。

**Non-Goals:**
- 不新增 host RPC/端点。
- 不依赖或复用 `dsh-open-in-vscode`（避免跨插件耦合与归属校验缺失）。
- 不支持除“打开 worktree 目录”外的其它动作。
- 不在本 change 中实现 VS Code CLI 探测或安装检测。

## Decisions

### 1. Client 侧 deep link，而非 host spawn

点击分支名时，client 构造 `vscode://file/<worktreePath>` 并通过浏览器交给系统打开（例如 `window.open(url, '_self')` 或在锚点 href 上触发）。

- **理由**: 最轻量；`vscode://file/<abs>` 被系统/浏览器交给本机 VSCode 打开目录；无需 host 端代码、无跨插件依赖，也让路径始终来自绑定元数据。
- **备选 A（host spawn `code <path>`）**: 需要新增 host 端点 + spawn + 编辑器命令解析，与既存 `dsh-open-in-vscode` 重复；被否决（用户明确要轻量）。
- **备选 B（复用 `openInVscode` remote）**: 代码最少但跨插件耦合、mount 时序敏感、且当场没法校验 worktree 归属；被否决。

### 2. deep link 编码与归约

- worktreePath 是宿主返回的绝对路径，构造 URI 前做一次归约（统一 `/` 与做 URL 编码），保持与 `vscode://file/Users/.../project` 形式一致。
- 路径必须 `startsWith` 用户期望的仓库 worktree 布局前仍以绑定值为准（不自行拼接）；URI 仅由 `stage.worktreePath` 派生。
- **特殊情况**: 该会话 `lifecycle === 'cleaned'` 或 `stage.worktreePath === undefined` 时不渲染可点击（沿用现有 cleaned 文本），不发出打开请求。

### 3. 可配置打开方式

- 将打开动作收敛到一个内部函数（例如 `openWorktreeInEditor(path)`），默认实现产出 `vscode://file/...`。
- 配置位在 client 插件 config 上预留（如 `openWorktree: { type: 'vscode-deep-link' }`），本 change 实现并默认该值；后续可扩展 `code-cli` 等类型而不改交互面。
- 若当前 `ClientContext` 无现成 client-plugin config 通道，则本次以默认实现落地，config 通道通过插件 config 传入 `apply(ctx, config)` 并文档记录（spec 已要求 MUST allow config）。

### 4. 可访问性与视觉

- 分支名变为可点击时增加 `role="button"`、`tabIndex={0}`，键盘 Enter/Space 同样触发，避免仅鼠标可用。
- hover 提示文案补充“点击在编辑器中打开 worktree”（沿用现有内联样式，不改整体胶囊尺寸）。

## Risks / Trade-offs

- [`vscode://file/` 在无 VSCode 或未注册 scheme 的机器上无法打开] → 不伪造成功；交系统/浏览器默认处理（spec 已覆盖）。安装 VSCode 后即生效。
- [deep link 编码细节（空格/非 ASCII）] → 统一编码后再拼接；测试覆盖含空格路径。
- [配置通道若不存在导致“可配置”仅书面] → 已在设计 3 兜底：本次默认实现 + config 参数预留；未落地前文档标注。
- [点击与 hover show title 重叠] → title 保留（hover 显示完整名）；点击独立到 click/keydown 处理。

## Migration Plan

1. 修改 `controls.tsx`：绑定分支名加可点击打开（deep link）+ 可访问性。
2. `client/index.tsx`：如配置传入需要，读取并传给控件。
3. 测试：`controls.test.ts` 断言点击生成 `vscode://file/<worktreePath>`、无绑定不生成、cleaned 不生成。
4. 文档：README/architecture HTML 补注。
5. 构建 `dsh build`、`sync` 幂等、`git diff --check`。
6. 回滚：`git revert` 相关文件；无持久数据变更。

## Open Questions

无（默认 deep-link、可配置位预留、绑定归属校验均在以上决策固定）。
