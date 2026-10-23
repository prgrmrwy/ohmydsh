## Context

`dsh-magpie-connect@0.4.1` 注册的 route id 是 `dsh-magpie-connect`，模型 id 原样沿用 Magpie 网关目录里的 `<上游provider>/<model>`。本机 cost-meter 台账已有真实记录 `dsh-magpie-connect:claude/claude-haiku-5-5`。

现有判定（`src/client/logos.ts`）：
- `normalizeIdentity` 去掉 npm scope 和 `dsh-`/`dsh_` 前缀，所以 route 会变成 `magpie-connect`。
- `providerBrandOf` 只用 `includes`/`startsWith`/精确名匹配；`magpie-connect` 一条都不命中，返回 `undefined`。
- `badgeBrands`：route 未知时只显示 model 品牌，不叠加子图标。所以网关会话目前与直连会话的图标完全一样。

## Goals / Non-Goals

**Goals:**
- 一眼看出这一轮走的是 Magpie 网关，同时保留实际上游是谁。
- 资产与其它品牌同一标准：官方来源、按 commit pin、记录 SHA-256、随包落盘、运行时不访问外网。

**Non-Goals:**
- 不按 Magpie 网关里的路由组（`group/...`、`auto/...`）推断它最终选中了哪个账号或 provider；这属于网关运行时信息，侧边栏拿不到。
- 不改 Host 侧投影，不改其它 route 的判定。
- 不为其它网关型插件（如其它社区 magpie 适配器）预设 route 名。只认 `magpie`、`magpie-*`，以及规范化后的 `magpie-connect`。

## Decisions

### D1. 资产来源：magpie 官方仓库的 `internal/provider/magpie.svg`
`@lobehub/icons-static-svg` 在 1.94.0（现用 pin）和最新的 1.98.0 里都没有 magpie 图标。magpie 官方仓库（MIT，Copyright (c) 2026 yetone）带有自己的标志 `internal/provider/magpie.svg`，它在 `internal/gui/assets/icons/magpie.svg` 也有一份逐字节相同的副本。按 commit `ba1dc7f975666e50308ef7bf8173c8a8e91c553b` pin，raw URL 下载后 SHA-256 为 `988d2e57b6b87043776521220c82e6f4cdbff0a7d2785ee9416321a918ec0138`，与本地克隆一致。

这个 SVG 根元素没有 `fill`，path 也没有 `fill`。SVG 默认填充黑色，而 magpie 自己的页面是用 CSS `fill: currentColor` 给它上色的。我们的 `sizedSvg` 只往根元素注入 `style="display:block;color:currentColor"`，不注入 `fill`，所以直接用的话，在深色主题里会是一只看不见的黑色剪影。

处理方式：资产文件**逐字节保留**；在渲染时，只对这一个品牌在根元素上注入 `fill="currentColor"`。这与现有「渲染时改根元素属性、不改 path 数据」的约定一致（THIRD-PARTY-NOTICES 的 Rendering notes 已经记录了根元素的 width/height/style 改写），所以只需在那里补一句。备选方案是改写资产文件里的 fill，但那会破坏「逐字节副本 + SHA-256」的可复核性，所以不采用。

### D2. route 规则：`magpie` 精确名、`magpie-*` 前缀
规范化后的 `magpie-connect` 自然落在 `magpie-*` 里，不需要为插件 id 单独写规则。不用 `includes('magpie')`，避免 `not-magpie` 之类的子串误判。这和 Trae 的做法一致：`trae` 是常见子串，所以 Trae 也只按精确名或前缀匹配。规则放在 `providerBrandOf` 里所有包含式规则**之前**。原因是 `magpie-connect` 本身不包含其它品牌的关键词，放前面没有歧义；放前面又能保证以后 route 名里即使混进 `claude`、`openai` 之类，也不会被别的规则抢先命中。

### D3. 网关型 route 的 model 品牌：先上游段，后模型名
`badgeBrands(provider, model)` 中，当 route 品牌属于「网关型」集合（目前只有 `magpie`）且 model 含 `/` 时：先取 `/` 之前的段，用 `providerBrandOf` 判定（这一段本身就是 provider route，如 `claude`、`codex`、`opencode-go`），失败再用 `modelBrandOf` 判定 `/` 之后的部分。

- 用 `providerBrandOf` 判断上游段，是因为 `opencode-go/deepseek-v4-flash` 的服务方是 OpenCode。这与插件「route 优先于 model」的既有原则一致：直连时这个模型本来就显示 OpenCode。
- 只在网关型 route 下启用这种解析，避免改变 `openrouter/...`、`traex/...` 等现有 route 的结果。例如 TraeX 的模型名不含 `/`，OpenCode Zen 的模型名也不按这个约定。
- 上游段识别不出时（如 `auto/`、`group/`、`custom/`），退回按 `/` 之后的模型名判断，这样 `auto/claude-haiku-5.5` 仍显示 Anthropic 子图标；两者都识别不出时只显示 Magpie。

`brandKeyOf` 只返回主品牌，对 Magpie route 也就直接返回 `magpie`，不需要改。

### D4. 复合规则保持不变
子图标仍然只在「上游品牌已知且 ≠ magpie」时出现，尺寸、偏移、`-sub` id 后缀都沿用 0.1.4 之后的规则。

## Risks / Trade-offs

- **[magpie 改标志或改路径]** → 我们按 commit pin，不跟随上游；升级资产时重新核对 URL 和 SHA-256。
- **[magpie 的标志很细，14px 下辨识度可能偏低]** → 只能实测确认；若不可辨认，备选是用 magpie GUI 内其它尺寸的同源资产，不手绘。
- **[其它社区插件用不同的 route id]** → 不在本次范围（Non-Goal）。真正接入时再加精确规则。
- **[上游段恰好叫 `magpie`，如网关嵌套另一个网关]** → 子图标与主图同品牌，按既有规则不叠加，只显示 Magpie 单图，可以接受。
