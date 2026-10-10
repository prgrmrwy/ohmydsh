## Why

侧边栏 logo 目前只表达一个品牌：已知 provider route 优先，model 仅在 route 未知时兜底。对 `claude/claude-opus-*`、`codex/gpt-*` 这类 provider 与 model 同品牌的选择，一个 logo 已足够；但对 `opencode-go/deepseek-v4-flash`、`opencode-go/minimax-m3`、`traex/GPT-5.6-Sol[1m]` 这类聚合/转售 route，单 logo 会丢掉「实际跑的是谁家的模型」这一信息，只能 hover 看 tooltip。另外 `traex` 当前没有品牌映射，会落到 model fallback 而显示 OpenAI logo，把 provider 身份也表达错了。

## What Changes

- 新增复合 icon：当 provider route 与 model id 分别识别出**不同**的已知品牌时，主图显示 provider 品牌，右下角叠加缩小的 model 品牌子图标；两者同品牌、或 model 品牌无法识别时，仍只显示单一品牌 logo（行为与现在一致）。
- provider route 未知/通用时保持现有行为：只按 model 品牌显示单一 logo，不叠加子图标。
- 新增 Trae 品牌资产（`@lobehub/icons-static-svg@1.94.0` 的 `trae.svg`，与既有资产同一 pin、同一许可），`traex`/`trae` route 映射到 Trae。
- 复合 icon 不改变 badge 在行内占据的位置与宽度，子图标与主图之间有不依赖行背景色的视觉分隔（hover/选中/深浅主题下都可辨认）。
- tooltip 保持 `provider · model` 原样。
- 包版本 0.1.2 → 0.1.3，`dsh.yaml` 条目同步。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `sidebar-session-provider-icon`: 品牌资产要求增加 Trae 并修订「OpenCode route 不被模型名误判」场景以体现复合 icon；新增「provider 与 model 品牌不同时显示复合 icon」要求。

## Impact

- 代码：`packages/sidebar-session-provider-icon/src/client/logos.ts`（品牌判定拆分为 provider 品牌与 model 品牌、复合渲染）、`src/client/assets/`（新增 `trae.svg` 与 README 出处行）、`test/logos.test.ts`。
- `src/client/index.ts` 的 badge 容器与 reconcile 判定无需改变数据来源（复合与否完全由 provider/model 派生）。
- 不改 Host projection、不改数据优先级、不触碰官方 StateDot/时间/菜单/拖拽。
- 无新运行时依赖；浏览器仍不访问外部 CDN。
