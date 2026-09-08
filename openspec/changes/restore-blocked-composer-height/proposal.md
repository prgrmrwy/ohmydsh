## Why

DSH 运行体升级到 0.1.2-rc.1 后，`home-network-model-guard` 触发 composer block 时，输入框**塌陷成一条几乎不可见的细线**：禁用文案「当前出口位于受限地区，已禁用 Claude 发送」虽然渲染在 DOM 里，但整块输入区高度归零，用户看到的是一个残缺的输入条。

受限机器实机取证（DevTools）确认了完整机制：

```html
<div contenteditable="false" data-composer-input="true"
     class="uV2eYG_input uV2eYG_inputDisabled"
     data-lexical-editor="true" aria-disabled="true"></div>   ← 空元素，无 <p>
<div aria-hidden="true" class="uV2eYG_placeholder" data-composer-placeholder="true">当前出口位于受限地区，已禁用 Claude 发送</div>
```

计算样式 `height: 3.99858px`，盒模型 `956.278 × 0` + `padding-top: 4` —— 内容高度确为 **0**，那 4px 全是 padding。

原因是官方 0.1.2 把 composer 从原生 `<textarea>` 迁移到 Lexical contenteditable 时，**删掉了负责撑高的隐藏 mirror 元素却未补等价兜底**：

| 版本 | 撑高机制 | blocked 态表现 |
|---|---|---|
| 0.1.1-rc.2 | 隐藏 mirror，内容为 `draft + "\n"`，那个换行符保证至少一行；placeholder 是 textarea 原生属性 | 正常显示文案，高度不变 |
| 0.1.2-rc.1 | mirror 已删除；高度全靠 Lexical 产出的 `<p>`；唯一 `min-height` 规则是 `.hero .input{min-height:52px}`（仅首屏居中态匹配） | `editable=false` 时 Lexical 不产出 `<p>` → 高度归零 |

placeholder 本身是 `position:absolute`（脱离文档流），正常态与 blocked 态都不贡献高度——差异只在于正常态有 `<p>` 而 blocked 态没有。

这是**官方回归**，不是本包的缺陷：两版 `ComposerBlock` 契约（`{ reason }`）与 blocked 分支传参（`blocked` + `placeholder`）逐字一致，本包只调用 `ctx.conversation.blocks.set(id, { reason })`，不参与渲染。官方自己的 `ui-model-selection` 在 `routable === false` 时走同一条 blocked 分支，同样会塌——本包只是最容易触发它的使用方。

后果不止于观感：当前 spec 要求「输入框立即变为不可发送」并由客户端 composer block 提前提示用户，而一个塌陷到 4px、看不清文案的输入条实质上损坏了这条 affordance——用户无法得知为何不能发送。

## What Changes

- 在本包客户端注入一条**最小兜底 CSS**，为 blocked 态的 composer 内容区恢复至少一行文本高度，使禁用文案可读、输入条保持完整形状。
- 兜底作用于官方稳定语义锚点（`data-*` 属性），不依赖 `uV2eYG_` 这类构建期哈希类名（升级即变）。
- 兜底补在**内容区父级**而非 `.input` 自身，避免与官方 `.hero .input{min-height:52px}` 发生 specificity 冲突（详见 design D2）。
- 在 `dsh.yaml` note 与 package README 标注：这是对官方 0.1.2-rc.1 回归的**临时补偿**，官方修复后应移除。
- 不改判定逻辑、RPC 契约、`ComposerBlock` 用法或 Host 门禁——本 change 只影响 blocked 态的可见性。

**明确不做**：不 patch 官方包的 CSS 或 JS（脱离 manifest 真相源，且升级即失效）；不改变 fail-closed 语义或任何拒绝行为。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `home-network-model-guard`：为「门禁是 Host 强制边界并由客户端提前提示」补充可验证约束——客户端 composer block 生效时，输入区 SHALL 保持可见且其原因文案 SHALL 可读，不得塌陷至不可辨识；并记录该 affordance 不得依赖运行体版本的渲染细节。属**加强约束**，不放松任何安全保证。

## Impact

- `packages/home-network-model-guard/src/client/index.ts`：现有 `<style>` 注入（当前仅承载 `.dshg-*` 设置页样式）扩展一条 composer 兜底规则。
- `packages/home-network-model-guard/test/`：新增针对兜底 CSS 选择器与 specificity 约束的回归测试。
- `packages/home-network-model-guard/README.md`、`dsh.yaml` note：标注临时补偿与移除条件。
- `openspec/specs/home-network-model-guard/spec.md`：归档时并入需求增补。
- 无新增依赖、无新增外呼、不触碰 Host 半区。
- **验证约束**：本仓库当前出口判定为 `allowed`，无法本地复现 blocked 态；验收须在受限出口机器上完成（详见 tasks §4）。
- 建议同步向官方上报该回归（0.1.2-rc.1 为 rc 阶段）。
