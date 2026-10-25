## Context

见 proposal.md — Why。0.1.10 的 `badgeBrands` 只产出 `{ primary, secondary }`：provider route 决定主图，model 维度决定右下角。网关下 `gatewayModelBrandOf` 用「模型名优先、上游段兜底」选出**一个**品牌，因此 `/` 前的中转平台在与模型厂商不同时被丢弃。

行内几何约束（来自官方 `dsh-client-ui-workspace` 的真实 CSS，实测于 0.2.0-rc.2）：

| 元素 | 几何 |
|---|---|
| `.__sessionRow` | `padding-inline-start: 8px`，`gap: 0`，`height: 32px` |
| `.__slot`（官方 StateDot 位） | `width: 16px`，位于 x∈[8,24]；圆点本身 x∈[13,19] |
| badge（本插件插入，`margin-left: 4px`） | 14×14，x∈[28,42] |
| `.__title` | `margin: 0 6px 0 4px` |

即 badge 左侧有 4px 空隙（x∈[24,28]）可直接用于向左溢出，不与 StateDot 重叠。

## Goals / Non-Goals

**Goals**
- 网关会话同时表达 provider / 中转平台 / 模型厂商三层。
- 左下角子图标复用右下角的镜像位置，不改 badge 占位、不放大、不竖排。

**Non-Goals**
- 不支持四层或任意深度链式 provenance；只识别 `<上游provider>/<model>` 这一段的两个维度。
- 不改变直连 route 的两层行为。
- 不改 Host 投影、行定位或 tooltip 格式。

## Decisions

### D1: 左下角承载中转层，与右下角镜像

`right: -4px; bottom: -4px` 的镜像即 `left: -4px; bottom: -4px`。10px 图标占 x∈[24,34]：

- 距 StateDot 圆点（右缘 x=19）留 5px；
- 与右下角图标（x∈[36,46]）留 2px 间隔；
- 不超出 badge 的 14px 占位盒（布局不变），只溢出到行内空隙。

**备选（否决）**：放大 badge 到 18/22px —— 需改行高与标题起点，破坏「不改变行内布局」的既有规范。
**备选（否决）**：右侧竖排两个小图标 —— 上下间隙不足，且会把 badge 视觉重心拉离主图。

### D2: 中转层仅在被显式识别、且与模型层不同时出现

`transit` 来自 `providerBrandOf('/' 前段)`，且仅当 `transit !== modelBrand` 时渲染。这样：

| model id | transit | model | 渲染 |
|---|---|---|---|
| `opencode-go/deepseek-v4.1-flash` | opencode | deepseek | 主 + 左下 opencode + 右下 deepseek |
| `opencode-go/glm-5.3-flash` | opencode | glm | 主 + 左下 opencode + 右下 glm |
| `claude/claude-haiku-5-5` | anthropic | anthropic | 主 + 右下 anthropic（同品牌不重复） |
| `codex/gpt-6-luna` | openai | openai | 主 + 右下 openai |
| `opencode-go/private-model` | opencode | opencode（兜底） | 主 + 右下 opencode |
| `auto/claude-haiku-5.5` | 无 | anthropic | 主 + 右下 anthropic |
| `custom/omen-alpha` | 无 | 无 | 仅主图 |

**备选（否决）**：无条件画左下角。`claude/*`、`codex/*` 会出现两个相同品牌图标，纯噪声。

### D3: 判定层返回第三个字段，渲染层保持单一职责

`BadgeBrands` 扩展为 `{ primary, secondary, transit }`，`badgeBrands` 纯函数可单测；`compositeHTML` 决定是否画左下角。这样三层判定不需要在 DOM 层重复实现，`test/logos.test.ts` 能离线覆盖全部品牌组合。

### D4: 左下角图标沿用同一套裸 glyph 规格

尺寸 10px、无底板/描边/内边距，与右下角一致；内部 id 追加 `-mid` 后缀，避免与 `<defs>` 串联（与既有 `-sub` 机制同因）。

## Risks / Trade-offs

- [三层在 14px 下偏挤] → 实测 1x 下三分之一强的信息仍可辨（主图最大、两角各 10px）；规范要求两侧子图标均为裸 glyph，不用底板占像素。若实际观感仍差，可只调 `SUB_ICON_SIZE` 不改结构。
- [不同主题下左下角对比度] → 与右下角图标使用同一渲染路径与 `currentColor` 处理，铭牌本身不带背景，已在浅/深主题下渲染核对。
- [未来网关出现三段以上 route] → 本设计只覆盖两段；更深的链式 provenance 不在范围，保持显式非目标。

## Migration Plan

1. `logos.ts`：`BadgeBrands` 增加 `transit`；网关分支同时算出中转层与模型层；`compositeHTML` 渲染左下角。
2. 单测覆盖上表全部组合 + 邻居不重叠的几何断言（可选，用 DOM 无关的字符串断言 `left:-4px`）。
3. 版本 0.1.11、CHANGELOG、README 双语、`dsh.yaml` version 与 note。
4. `npm test` / `typecheck` / `build`，`node scripts/sync.mjs` 连续两次（第二次 no changes），浅深主题渲染核对。

回滚：`dsh.yaml` 版本改回 0.1.10 → `dsh build` → 刷新。无持久数据变更。

## Open Questions

（无）
