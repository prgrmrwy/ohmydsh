## Context

见 proposal.md - Why。当前实现：`src/client/logos.ts` 的 `brandKeyOf(provider, model)` 一个函数里先扫 route、再扫 model，返回单个 `BrandKey`；`badgeInnerHTML` 把对应 SVG 改写为 14×14 后整体塞进 badge span。`src/client/index.ts` 只按 `dataset.provider/model/title` 三元组判断 badge 是否需要重建，因此 badge 内部结构完全由 `(provider, model)` 派生，可自由变成复合结构而无需改 reconcile。

真实数据（本机近期 session 日志中的 provider/model 组合）：同品牌 `claude/claude-*`、`codex/gpt-*`、`deepseek-official/deepseek-*`；异品牌 `opencode-go/deepseek-v4-flash(-vision-exp)`、`opencode-go/minimax-m3`、`traex/GPT-5.6-Sol[1m]`、`traex/DeepSeek-V4-Flash`。`traex` 现在无映射，经 model fallback 显示 OpenAI——provider 身份错。

## Goals / Non-Goals

**Goals:**
- 把品牌判定拆为两个独立维度：provider 品牌（只看 route）与 model 品牌（只看 model id）。
- 复合与否、子图标为何者，均为 `(provider, model)` 的纯函数，可单测。
- 复合 icon 占位与单 logo 完全相同（14×14），不影响行布局。

**Non-Goals:**
- 不为 model 维度做「家族/版本」细分（如 Claude Opus vs Sonnet），只到品牌。
- 不改 Host projection、数据优先级与 row-locator。
- 不引入 provider 名到品牌的用户可配置映射表（后续如需再单独提）。

## Decisions

### D1. 两个维度的判定函数
`providerBrandOf(provider)` 只扫 route 规则；`modelBrandOf(model)` 只扫 model 规则（现有 `brandKeyOf` 后半段原样迁移）。`brandKeyOf` 保留为兼容 API：`providerBrandOf(p) ?? modelBrandOf(m)`，现有测试语义不变。新增 `badgeBrands(p, m) → { primary?: BrandKey, secondary?: BrandKey }`：
- route 已知：`primary = P`，`secondary = M`（仅当 M 已知且 ≠ P）。
- route 未知：`primary = M`，无 secondary（route 未知时没有「另一个品牌」可表达）。

注意 model 规则中的 `opencode`/`openclaw`/`hermes` 关键字保持原样；`traex/GPT-*` 走 `gpt` 规则得到 openai，`DeepSeek-V4-Flash` 经 `normalizeIdentity` 小写化后命中 deepseek。

备选：在 `brandKeyOf` 里返回元组。否决——会破坏 home-network-model-guard 等文档中引用的「双字段单品牌」语义参照，且拆分后两个维度各自更易测。

### D2. Trae 映射与资产
route 规则在 `opencode` 之后加入 `route === 'trae' || route.startsWith('traex') || route === 'trae-ai'`（精确/前缀匹配，避免 `trae` 子串误命中如 `extraeval` 之类的名字）。资产取 `@lobehub/icons-static-svg@1.94.0/icons/trae.svg`（单色 `currentColor`，与 OpenAI/Anthropic 同类），落盘 `assets/trae.svg`，在 `assets/README.md` 记录 URL、pin、MIT 与 SHA-256。不在 model 维度加 trae 规则（Trae 不是模型厂商）。

### D3. 复合渲染结构
badge 内部生成：
```
<span style="position:relative;display:block;width:14px;height:14px">
  <svg 14×14 …主图…/>
  <span style="position:absolute;right:-3px;bottom:-3px;width:9px;height:9px;
               border-radius:50%;background:<底色>;box-shadow:0 0 0 1px <描边>;
               display:flex;align-items:center;justify-content:center">
    <svg 7×7 …子图…/>
  </span>
</span>
```
- 子图标外圈用一个小圆底 + 1px 描边作分隔。底色用 `Canvas`（CSS system color，随 `color-scheme` 自动适配深浅主题），描边用 `color-mix(in srgb, currentColor 25%, transparent)`；不依赖 DSH 内部 CSS 变量名（官方主题包未导出稳定的 sidebar 背景变量，绑定会随升级漂移）。行 hover/选中背景变化时，带底色的小圆仍可辨认。
- 外层负偏移 `-3px` 让子图标溢出主图右下角，但外层容器仍为 14×14，badge 的 `line-height:0` 与 `flex:none` 不变，因此行内占位不变（满足「不改变布局」）；溢出部分 `overflow` 默认 visible，不会被 badge 裁剪。需在真实 GUI 确认官方行容器未 `overflow:hidden` 裁掉 3px 溢出；若被裁则把偏移收到 `-1px` 并把主图缩到 13px。
- `sizedSvg` 参数化尺寸（`sizedSvg(svg, size)`），主图 14、子图 7。
- 彩色 SVG（deepseek-color 等）内部有固定 id 时，同一页面多份内联可能 id 冲突；现有单 logo 已同样内联多份且实机无问题，复合只是同一行再多一份，风险不变。实现时检查已落盘 SVG 是否含 `id=`/`url(#`，若有则在子图实例中加后缀改写。

备选：主图与子图左右并排。否决——会改变 badge 宽度、推挤标题，违反现有「不影响行内 UI」精神，也不是用户要的形态。

### D4. reconcile 不变
`index.ts` 仍以 `provider/model/title` 判断是否重建，复合结构由 `badgeInnerHTML` 一次性生成；无需新增 dataset 字段。为便于测试与 DOM 调试，复合时在内层容器加 `data-composite=""`。

## Risks / Trade-offs

- [官方行容器裁剪溢出的子图标] → 真实 GUI 验收时截图核对；按 D3 的降级偏移调整。
- [7px 子图标过小，细节多的品牌（Hermes/OpenClaw 彩色）难辨] → 只追求「能区分是谁家」，tooltip 仍给出精确 model；必要时子图升到 8px 并同步调整偏移。
- [model 规则误识别，如 `glm` 子串出现在无关 model 名] → 现状同样存在（model fallback）；复合只在 provider 已知时才额外显示，误识别影响是多一个子图标而不会替换主品牌。
- [`Canvas` system color 与 DSH 自定义皮肤（skin-center）背景不一致] → 小圆底本来就是为与行背景分离；描边保证在接近色背景下仍有边界。

## Migration Plan

纯前端呈现变化。包版本 0.1.3，`dsh.yaml` 条目版本与 note 同步，`node scripts/sync.mjs` 物化（连续两次第二次无变化），刷新 Web 页面生效。回滚：把 `dsh.yaml` 版本/源码回退到 0.1.2 后重新 sync。
