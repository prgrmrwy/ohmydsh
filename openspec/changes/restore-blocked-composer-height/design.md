## Context

官方 0.1.2-rc.1 把 composer 从原生 `<textarea>` 迁移到 Lexical contenteditable。本包不参与该渲染——只调用 `ctx.conversation.blocks.set(id, { reason })`，两版 `ComposerBlock` 契约与 blocked 分支传参逐字一致。

**证据链**（受限出口机器 DevTools 实机取证 + 两版 bundle A/B 比对）：

DOM 现状：

```html
<div contenteditable="false" data-composer-input="true"
     class="uV2eYG_input uV2eYG_inputDisabled"
     data-lexical-editor="true" aria-disabled="true"></div>   ← 空元素，无 <p>
<div aria-hidden="true" class="uV2eYG_placeholder"
     data-composer-placeholder="true">当前出口位于受限地区，已禁用 Claude 发送</div>
```

计算样式 `height: 3.99858px`，盒模型 `956.278 × 0` + `padding-top: 4`：内容高度确为 0。

相关 CSS（0.1.2）：

```css
.uV2eYG_grow        { position:relative }                            /* 不提供高度 */
.uV2eYG_placeholder { position:absolute; inset:4px 8px auto 16px }   /* 脱离文档流 */
.uV2eYG_inputDisabled { color:...; cursor:not-allowed }              /* 不碰布局 */
.uV2eYG_hero .uV2eYG_input { min-height:52px }                       /* 仅 hero 态匹配 */
```

已核实：整个 composer 里含 `min-height` 的规则**只有那条 hero 限定**，非 hero 会话态没有任何兜底。

0.1.1 的撑高机制是隐藏 mirror：

```css
.uV2eYG_mirror { visibility:hidden }        /* 隐藏但占位 */
.uV2eYG_input  { position:absolute; inset:0 }  /* textarea 浮在上层 */
```
```js
children: `${draft}\n`   // 空 draft 时那个 \n 仍保证一行
```

迁移时 mirror 被删除，高度改由 Lexical 产出的 `<p>` 承担；`editable=false` 时不产出 `<p>` → 归零。

**关键澄清**：placeholder 有无与塌陷无关——它在两种状态下都是 `position:absolute`、都不贡献高度。正常态不塌是因为有 `<p>`（`line-height:24px`）。

约束：不得修改 `~/.npm/_npx/**` 下的运行体产物（脱离 manifest 真相源、升级即失效、`dsh build` 不可复现）；不得触碰 fail-closed 语义；本仓库出口为 `allowed`，本地无法复现 blocked 态。

## Goals / Non-Goals

**Goals:**

- 恢复 blocked 态输入区的可见高度，使阻断原因可读。
- 兜底只依赖官方稳定语义锚点，运行体重新构建（哈希类名变化）后仍生效。
- 明确标注为临时补偿并给出可判定的移除条件。

**Non-Goals:**

- 不 patch 官方包、不改官方 JS/CSS 产物。
- 不改判定逻辑、RPC 契约、`blocks.set` 用法、Host 门禁或 fail-closed 语义。
- 不试图复刻 0.1.1 的 mirror 机制（那是官方内部实现，本包无从注入）。
- 不为其他插件（如官方 `ui-model-selection` 的 `routable === false`）的 blocked 态负责——虽然它们走同一分支同样会塌，修复面在官方。

## Decisions

### D1：选择器锚定 `data-*` 语义属性，不用哈希类名

`uV2eYG_` 是构建期哈希，官方任一次重新构建都会变；`.dshg-*` 是本包自有前缀，够不到官方 DOM。

已核实三个稳定锚点在 0.1.2 bundle 中各出现一次，且语义明确：`data-composer-input`（contenteditable 本体）、`data-input-scroll`（滚动容器）、`data-composer-placeholder`（原因文案层）。

选用 `[data-input-scroll]` 作为定位起点，`> div` 命中 `.grow`（结构上是其唯一子元素，见上文 DOM）。

*备选*：用 `:has()` 匹配 `[aria-disabled="true"]` 精确限定 blocked 态。被否——`:has()` 在此无必要（见 D3 的无条件策略），且徒增选择器脆弱性。

### D2：兜底补在内容区父级（`.grow`），不补在 `.input` 自身

若写 `[data-composer-input]{min-height:24px}`，其 specificity 为 (0,1,0)；官方 `.hero .input{min-height:52px}` 为 (0,2,0) —— 官方胜出，hero 态不受影响。看似可行，但语义上是在**和官方争夺同一元素的同一属性**，一旦官方后续给 `.input` 加上非 hero 的 min-height，两条规则会互相干扰且难以察觉。

补在父级则完全正交：

```css
[data-input-scroll] > div { min-height: 24px }
```

- 非 hero blocked 态：`.input` 高度 0 → 父级 24px 兜底生效。
- hero 态：`.input` 自带 52px → 父级被撑开，24px 不产生任何影响。
- 正常态：`<p>` 撑起 24px（`line-height`）→ 兜底恰好等高，不改变现状。

即兜底是**下界**而非覆写，任何状态下都不会压缩官方既有高度。

### D3：无条件生效，而非仅限 blocked 态

不用 `:has([aria-disabled="true"])` 之类条件限定。

理由：24px 恰为一行 `line-height`，与正常态 `<p>` 高度一致，所以对未阻断状态是**恒等变换**——加不加都一样。无条件规则更简单、更稳健，且顺带覆盖官方 `ui-model-selection` 的 blocked 态（同一回归的另一触发面），无需为其单独判定。

*代价*：本包的样式对非本包触发的 blocked 态也生效。可接受——修的是同一个官方缺陷，且效果是恢复而非改变官方意图。

### D4：复用现有 `<style>` 注入点，不新增机制

`client/index.ts` 已有一个 `ctx.effect` 注入 `<style data-plugin="dsh-home-network-model-guard">`（承载 `.dshg-*` 设置页样式），随 effect 释放而 `style.remove()`。兜底规则追加进同一张表即可，天然获得与插件生命周期一致的挂载/卸载，`enabled: false` 后 `dsh build` 卸载插件即随之消失（满足仓库「定制可独立启用、禁用、移除」的原则）。

*备选*：新建独立 `<style>` 以便区分职责。被否——两张表生命周期完全相同，拆分只增加代码而无隔离收益；用注释在同一张表内分区即可。

### D5：以注释与文档锁定移除条件

规则块内注明这是对官方 0.1.2-rc.1 回归的补偿，并给出可判定的移除条件：**当官方为非 hero 态的 composer 内容区提供自带最小高度（或恢复等价的 mirror 机制）后，本规则应删除**。同一条件写入 `dsh.yaml` note 与 package README。

这样升级到新运行体时，回归验证有明确的检查点，不会让临时补偿沉淀为永久且无人理解的魔法 CSS。

## Risks / Trade-offs

- **[官方后续修复后本规则成为冗余]** → D5 已写明可判定的移除条件；因是下界规则，即便暂时留存也不会与官方修复冲突（除非官方把内容区最小高度设为 <24px，届时回归验证会发现）。
- **[`[data-input-scroll] > div` 依赖 DOM 结构（scroll 的直接子元素是内容容器）]** → 已在实机 DOM 中确认该父子关系。若官方将来插入中间层，兜底会静默失效（退化为当前的塌陷）——不会造成新的错误显示，且 tasks 中的验收步骤可复检。
- **[本地无法复现 blocked 态]** → 本仓库出口为 `allowed`。测试只能覆盖「注入的 CSS 文本包含预期规则与选择器」，真实渲染验收必须在受限出口机器上人工完成（tasks §4 明确标注，不得以本地测试通过冒充实机验收）。
- **[样式作用于官方 DOM，属跨包影响]** → 限定在 composer 内容区的一条 `min-height` 下界，不改颜色/布局/交互；且随插件卸载消失。相较让用户看不到禁用原因，这个取舍是明确的。

## Migration Plan

1. 在 `client/index.ts` 的样式常量中追加兜底规则块（含移除条件注释）。
2. 补测试：断言注入文本含该选择器与 `min-height`，且**不含** `uV2eYG_` 哈希类名（防止日后有人图省事写死哈希）。
3. package 内 `npm run typecheck` + `npm test`；仓库级 `npm test` + `npm run check:artifacts`。
4. `node scripts/sync.mjs` 物化，连跑第二次确认幂等。
5. 更新 `dsh.yaml` note 与 README，标注临时补偿与移除条件。
6. **实机验收（受限出口机器）**：确认输入区恢复高度、原因文案可读；切换到非 Claude 模型确认恢复正常输入不受影响。

回滚：改动集中在单个 package 的一段 CSS 常量，无状态、无配置格式变更；`git revert` 后 `dsh build` 即可。

## Open Questions

- **上报官方**：0.1.2-rc.1 处于 rc 阶段，适合反馈该回归（官方 `ui-model-selection` 同样受影响）。本 change 不含上报动作，由用户决定。
- **是否值得覆盖 hero 态**：hero 态自带 52px，当前不受影响。若官方将来也移除该规则，需重新评估——D5 的移除条件复检时一并检查。
