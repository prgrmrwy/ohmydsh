## 1. 判定逻辑

- [x] 1.1 `src/client/logos.ts`：`BadgeBrands` 增加 `transit: BrandKey | undefined`；网关分支同时产出中转层（`providerBrandOf('/' 前段)`）与模型层（`gatewayModelBrandOf`），非网关 route 的 `transit` 恒为 `undefined`。验证：`npm run typecheck` 通过，非网关用例的既有断言不需修改。
- [x] 1.2 仅当 `transit !== undefined && transit !== secondary` 时保留中转层，避免 `claude/*`、`codex/*` 出现同品牌重复图标。验证：`badgeBrands('dsh-magpie-connect','claude/claude-haiku-5-5').transit` 为 `undefined`。

## 2. 渲染

- [x] 2.1 `compositeHTML` 支持左下角卫星图标：`left: -4px; bottom: -4px`，10px 裸 glyph，内部 id 后缀 `-mid`；主图与右下角逻辑不变。验证：`badgeInnerHTML('dsh-magpie-connect','opencode-go/deepseek-v4.1-flash')` 同时含 `data-sub-brand="deepseek"` 与左下角标记。
- [x] 2.2 确认行内几何未被破坏：badge 外框仍 14×14，左下角只用行内 4px 空隙（x∈[24,28]）溢出，不与官方 StateDot 重叠。验证：渲染后测 rect，左下角图标左缘 ≥ 24 且 StateDot 右缘 = 19。

## 3. 测试

- [x] 3.1 `test/logos.test.ts` 覆盖三层组合：`opencode-go/deepseek-v4.1-flash` → transit opencode + secondary deepseek；`opencode-go/glm-5.3-flash` → opencode + glm。验证：`npm test` 通过。
- [x] 3.2 覆盖不出现第三层的组合：`claude/claude-haiku-5-5`、`codex/gpt-6-luna`（同品牌）、`opencode-go/private-model`（兜底同品牌）、`auto/claude-haiku-5.5`、`group/deepseek-v4-flash`、`custom/omen-alpha`（无中转层）。验证：`transit` 均 `undefined`。
- [x] 3.3 直连 route 回归：`opencode-go/deepseek-v4.1-flash`、`traex/GPT-5.6-Sol[1m]` 的 `transit` 为 `undefined`，渲染与 0.1.10 一致。验证：既有断言不改仍通过。

## 4. 文档与版本

- [x] 4.1 `package.json` 0.1.10 → 0.1.11；`CHANGELOG.md` 新增 0.1.11 段说明三层渲染、何时不出现第三层、以及左下角几何依据。验证：读出版本 0.1.11。
- [x] 4.2 `README.md` / `README.zh.md`：映射表补三层示例，复合 icon 说明改为「最多三层：主图 + 左下中转 + 右下厂商」。验证：grep 到三层描述。
- [x] 4.3 `dsh.yaml`：`version` → 0.1.11，note 补「网关下三层（主图+左下中转+右下厂商）」，码点仍 ≤600。验证：governance 测试通过。

## 5. 构建与部署

- [x] 5.1 包内 `npm test`、`npm run typecheck`、`npm run build`；仓库 `npm test`、`npm run check:artifacts`。验证：退出码 0（既有 markdown-link 失败除外，需确认非本次引入）。
- [x] 5.2 `node scripts/sync.mjs` 部署，第二次无变更。验证：第二次输出 no changes。
- [x] 5.3 浅色/深色主题渲染核对三层与两层对照，确认左下角与 StateDot 不重叠、三层可辨。验证：截图。
- [x] 5.4 核对运行时已加载新 bundle（比对 `/plugins/events` 的 rev 与磁盘 rev），刷新页面确认；无需重启进程。验证：rev 一致且 bundle 含新逻辑。
- [x] 5.5 合入主规范并归档 change；提交并推送。

## 实施记录（2026-10-25）

- 2.2 几何实测（headless Chrome，官方行 CSS + 生产 badge 标记）：`slot` x∈[8,24]、StateDot 圆点 x∈[13,19]、badge x∈[28,42]；左下角中转图标 10px 落在 x∈[24,34]，与圆点**间隔 5.0px**；右下角模型图标 x∈[36,46]，两者间隔 2px；两层与三层 badge 的占位宽度都量得 **14.0px**，行布局不变。
- 3.x 测试 57 → 59 条。`BadgeBrands` 增加 `transit` 字段使既有 `toEqual` 断言需要同步补 `transit: undefined`（12 处），这不是行为回归而是接口扩展；新增「三层渲染」「无第三层时不出现 `data-transit-brand`」两条用例。
- 3.x 一处断言修正：magpie.svg 的 `viewBox` 在 Vite 内联形式下使用单引号（`viewBox='0 0 44 44'`），断言改为同时接受两种引号，与既有的引号兼容注释一致。
- 5.3 浅色/深色主题各渲染一次，覆盖 `opencode-go/deepseek-v4.1-flash`（三层）、`glm`、`kimi`、`claude`（两层）、`private-model`（兜底两层）、`auto/claude`（两层）、直连 `opencode-go`（两层）七种组合，三层与两层对照清晰。
- 5.4 无需重启：`/plugins/events` 的 `rev=692097f23aac` 与磁盘 `lib/client.js` 的 mtime/ctime/size 计算出的 rev 一致；`curl` 该 rev 的 bundle 含 `gatewayTransitBrandOf`、`data-transit-brand`、`-via`，确认宿主已在用 0.1.11。
- 5.1 仓库 `npm test` 596/596 全绿（上一轮出现的既有 markdown-link 失败已随 origin/main 的清理提交消失），`check:artifacts` 通过；包内 59/59、typecheck、build 通过。
- 4.3 `dsh.yaml` note 需同时容纳四层 change 与三层说明，首次试写 610 码点超限，精简至 598 后 governance 30/30 通过。
