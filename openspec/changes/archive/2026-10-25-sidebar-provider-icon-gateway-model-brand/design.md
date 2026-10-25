## Context

见 proposal.md — Why。当前实现（0.1.9）的网关解析位于 `src/client/logos.ts` 的 `gatewayModelBrandOf`：遇到 `/` 就先用 `providerBrandOf(上游段)`，命中即返回；只有上游段不是品牌时才看 `/` 后的模型名。真实路线 `opencode-go/deepseek-v4.1-flash` 因此得到 `opencode`，而主图已经是 Magpie，于是小图标复述了平台层、丢掉了厂商层。

约束：
- 网关的 model id 由上游网关决定，形状是 `<上游provider>/<model>`，两段都可能不是品牌（`custom/omen-alpha`、`auto/`、`group/`）。
- 直连 route 的判定（`opencode-go/deepseek-v4.1-flash` → OpenCode 主图 + DeepSeek 小图）已被用户长期使用，不能改。
- 小图标是唯一显示 model 品牌的位置，主图必须继续表达「是否走网关」。

## Goals / Non-Goals

**Goals**
- 网关会话的小图标表达模型厂商（DeepSeek/Anthropic/OpenAI…），而不是分发平台。
- 模型名认不出时仍有兜底：上游段 → 无子图标。
- 直连 route 行为零变化。

**Non-Goals**
- 不改主图规则、不改复合 icon 的尺寸/布局/无底板样式。
- 不引入新的品牌资产或新 route（OpenCode 资产保留，直连 route 仍在用）。
- 不改 Host 侧投影、网络、凭据、行定位。

## Decisions

### D1: 网关下改为「模型名优先、上游段兜底」

`gatewayModelBrandOf` 顺序反转为 `modelBrandOf(斜杠后) ?? providerBrandOf(斜杠前)`。

理由：主图已表达平台/网关身份，小图唯一职责是 model 厂商；上游段是分发平台，和主图同层，重复占用小图标就是丢失信息。原顺序保留的是「OpenCode 这层身份」，但该层在直连 route 下由主图表达、在网关下又与被替换的 Magpie 主图语义重叠，收益低于丢失厂商。

**备选（否决）**：三段式「Magpie + OpenCode + DeepSeek」。14px 内再叠第三个 glyph 无法辨认，且必然破坏「不改变行内布局」的现有约束。

**备选（否决）**：网关下只显示 Magpie。丢失 model 信息，会话行重新变得不可区分，违背插件 Purpose。

### D2: 兜底顺序为「模型名 → 上游段 → 无」

只反转两段优先级，不删任何一段。这样 `auto/claude-haiku-5.5`（模型名可认）、`custom/gemini-3.5-flash`（模型名可认）、`opencode-go/private-model`（模型名不可认 → 上游段 OpenCode）都仍有确定性结果。

### D3: 只对 `GATEWAY_BRANDS` 生效

`badgeBrands` 里已用 `route !== undefined && GATEWAY_BRANDS.has(route)` 把网关解析隔离在 Magpie。本次只改该分支内部顺序，直连 route 继续走 `modelBrandOf(整个 model id)`，无需其它判断。

### D4: 资产与命名不变

OpenCode 资产、`providerBrandOf('opencode-go')` 映射都保留——直连 route 仍需要它们，且 `opencode-go/private-model` 兜底也用得上。

## Risks / Trade-offs

- [网关下不再显示「经 OpenCode 中转」这一层] → 该信息仍可由 tooltip（精确 `provider · model`）看到；且用户明确要的是厂商。
- [上游段与模型名分属不同厂商时（如 `traex/deepseek-v4-flash`）反转后显示 DeepSeek 而非 Trae] → 这是期望结果：小图表达模型厂商。
- [模型名恰好含平台词（如未来的 `opencode-xxx` 模型）] → `modelBrandOf` 先匹配厂商词，`opencode` 只在 model id 含 `opencode` 时命中，与既有直连判定一致，不新增歧义。
- [已归档 change `2026-10-23-sidebar-provider-icon-magpie-route` 的验收记录与本次相反] → 归档是历史证据；当前规范以本次 MODIFIED 后的 `openspec/specs/` 为准，CHANGELOG 里保留两版记录并说明反转原因。

## Migration Plan

1. 改 `logos.ts`（仅 `gatewayModelBrandOf` 内部顺序）。
2. 改单测预期：`dsh-magpie-connect / opencode-go/deepseek-v4.1-flash` → `{ primary: 'magpie', secondary: 'deepseek' }`；新增上游段兜底用例。
3. 版本 0.1.10，更新 CHANGELOG / README 双语 / `dsh.yaml` version 与 note。
4. `npm test`、`typecheck`、`dsh build`，第二次 sync 无变化；重启 DSH 后刷新页面核对真实 Magpie 会话。

回滚：`dsh.yaml` 版本改回 0.1.9 → `dsh build` → 重启。无持久数据变更，无需清理。

## Open Questions

（无）
