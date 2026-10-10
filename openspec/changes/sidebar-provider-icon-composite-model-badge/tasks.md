## 1. 品牌资产

- [x] 1.1 下载 `@lobehub/icons-static-svg@1.94.0/icons/trae.svg` 落盘为 `packages/sidebar-session-provider-icon/src/client/assets/trae.svg`，在 `assets/README.md` 增加出处行（URL、pin、MIT、SHA-256）
- [x] 1.2 检查全部已落盘 SVG 是否含 `id=` / `url(#` 引用，记录结论；若有，确定子图实例的 id 后缀改写方案（结论：仅 minimax.svg、openclaw.svg 含内部 id；主图保持原样，子图实例 id 与 url(#) 统一加 `-sub` 后缀）

## 2. 品牌判定拆分

- [x] 2.1 在 `logos.ts` 拆出 `providerBrandOf(provider)` 与 `modelBrandOf(model)`，`brandKeyOf` 改为两者组合且对现有测试语义不变
- [x] 2.2 增加 `trae` 品牌键与 route 规则（`trae` / `traex*` / `trae-ai`，不做子串匹配），model 维度不加 trae
- [x] 2.3 实现 `badgeBrands(provider, model)`：route 已知 → primary=P、secondary=M（M 已知且 ≠ P）；route 未知 → primary=M、无 secondary

## 3. 复合渲染

- [x] 3.1 `sizedSvg` 参数化尺寸；`badgeInnerHTML` 在有 secondary 时输出 14×14 相对定位容器 + 右下角 9px 圆底（`Canvas` 底色 + 1px `currentColor` 混色描边）内嵌 7px 子图，并带 `data-composite`
- [x] 3.2 无 secondary 时输出与 0.1.2 一致的单 logo / 中性首字母 markup
- [x] 3.3 确认 `index.ts` reconcile 无需改动（provider/model 变化即重建），必要时只调整注释

## 4. 测试

- [x] 4.1 `test/logos.test.ts` 增加：`traex/*` 主品牌为 trae；`claude/claude-opus-5`、`codex/gpt-6-luna` 无 secondary；`opencode-go/deepseek-v4-flash`、`opencode-go/minimax-m3`、`traex/GPT-5.6-Sol[1m]`、`traex/DeepSeek-V4-Flash` 的 primary/secondary；`opencode-go/unknown-model` 无 secondary；未知 route 无 secondary
- [x] 4.2 增加 markup 测试：复合时含 `data-composite`、主图 width/height=14、子图 width/height=7、仍不含外部 URL；非复合时不含 `data-composite`
- [x] 4.3 运行包内 `npm run typecheck`、`npm test`、`npm run build`

## 5. 文档与发布

- [x] 5.1 包版本 0.1.2 → 0.1.3；CHANGELOG 增加 0.1.3；README 品牌资产与「品牌判断」段落说明复合 icon 与 Trae
- [x] 5.2 `dsh.yaml` 条目 version 0.1.3，note 补充复合 icon 与 Trae
- [ ] 5.3 运行根 `npm test`、`npm run check:artifacts`；`node scripts/sync.mjs` 连续两次，第二次无变化
- [ ] 5.4 刷新 http://127.0.0.1:3080 实机核对：同品牌行单 logo；opencode-go / traex 行复合 icon；切换模型即时更新；子图标未被行容器裁剪、hover/选中与深浅主题下可辨认；StateDot/时间/菜单位置不变
- [ ] 5.5 `openspec validate sidebar-provider-icon-composite-model-badge --strict` 通过后归档
