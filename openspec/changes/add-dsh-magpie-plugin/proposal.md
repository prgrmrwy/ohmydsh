## Why

DSH 现在通过第三方 `dsh-magpie-connect@0.4.1` 接入家里 CT105 上的 Magpie 网关。它有三个问题：
- 只把模型放进选择器，显示名还要靠 `magpie-display-name-shim` 补；
- 设置页看不到各 provider 的账号和用量，不能按模型配默认 effort，也没有 Codex 的 Fast 开关；
- key 明文 0644 落盘，设置接口还会回显 key。

Magpie 已经通过 gateway key 对外提供了只读的模型目录（含 `owned_by`、`display_name`、`reasoning_levels`、`service_tiers`）和用量卡片（`/v1/magpie/quotas/cards`）。2026-10-25 用当前 key 实测均返回 200。现在可以写一个自研、可发布到插件商店的替代插件，让 Magpie 成为本机唯一的执行入口；WSL 也就不再需要为 Claude 跑全局 usip 代理。

## What Changes

- 新增自研 package `packages/dsh-magpie`（npm 名 `dsh-magpie`，按商店发布规范组织）。它注册**一个** DSH LLM route `dsh-magpie`，并通过 Magpie 的 OpenAI 兼容接口（Responses 或 Chat Completions）完成生成，包括文本、工具调用往返、图片输入、usage、取消与超时。线协议复用 `@earendil-works/pi-ai`（与 dsh-magpie-connect、官方 dsh-llm-pi-ai 相同）。不支持 stop 序列：带 stop 的请求发出前就报错，DSH core 没有调用方会传 stop。换网关地址或 key 时，旧的目录和卡片立即隐藏；进行中的生成按原地址和原 key 跑完。
- 模型目录来自网关 `/v1/models`：显示名直接用网关的 `display_name`，effort 档位用 `reasoning_levels`，并带上上下文窗口、输出上限和图片能力。
- **AMD2（用户已确认，待独立 recheck）**：模型选择菜单按网关 `owned_by` 展示 `Magpie (Claude)`、`Magpie (GPT)` 等分组，下面列具体型号；不能按型号名称猜分组，不能把展示组当成真实 provider。单 route `dsh-magpie` 与网关 model id 保持不变，统一搜索、可见性过滤和 effort 行为不变。本轮用户已额外批准必要宿主扩展：通过 Pet 现有 compat 唯一 owner 的受管 patch 增加逐模型可选 `displayGroup {id,label}`，贯通校验/detach、host catalog、原选择器与 `/model` 展示；不另造 runtime owner、不手改 generated dirs，不伪造多个 provider、不以 DOM 文本 hack 改实际路由。
- **AMD2（同上）**：设置导航自身 `Magpie` 行显示鸟形品牌图标，参考已安装 connect 插件的 SVG；接入方式沿用仓内 marker + 限定 CSS + MutationObserver 生命周期，鸟形采用 connect 同类 `currentColor` CSS mask；唯一匹配与排除 foreign connect marker 是在 Pet/Memex 旧实现之上的增强。不修改旧 connect 行，找不到自身行时静默保留宿主图标，保留第三方许可 notices。
- 设置页按网关 provider（`owned_by`）分组展示卡片，形式参考 subscriptions：
  - 只读展示账号、计划、到期时间，以及各窗口的用量和重置时间；
  - 每张卡片可手动刷新，即请求 Magpie 重新读取；卡片区另有「刷新全部」，用于 Magpie 刚启动、还没有任何卡片的冷启动情况（仅对不受限的 key 有效；受限 key 时空状态会提示需要管理员先在 Magpie 中读取一次）。两者都只由用户手动触发，host 端同一时刻只允许一个刷新；
  - Codex 卡片显示剩余的「用量限制重置」次数和过期时间，只读。
- 每个 provider 可设置模型可见性，语义与 subscriptions 相同：不设置就跟随网关目录；一旦选择过，新上架的模型默认隐藏。
- 每个模型可设置**默认 effort**，存在 DSH 侧，必须是该模型支持的档位之一。
- 对网关声明了 `service_tiers` 的模型，输入框右侧提供「速度」切换（标准 / 快速），按会话保存；选快速时请求带 `service_tier: priority`。
- API key 存在 DSH credentials 服务（`MAGPIE_API_KEY`）里，所有接口都不回显 key。网关地址和偏好存在插件自己的设置文件里。
- 插件只读：不调用 Magpie GUI 的 `/api/*`，不提供登录、退出或账号管理。登录与出站代理仍由 Magpie 管理员在 Magpie 侧配置。
- 不提供插件级代理配置。请求直连所配置的网关地址；局域网和 Tailscale 子网路由用的是同一个地址。
- `sidebar-session-provider-icon` 要能把新 route `dsh-magpie` 识别为 Magpie 网关品牌。现有实现会先去掉 `dsh-` 前缀再匹配，已经能识别；本 change 只补 spec 与回归测试，不改运行时代码。
- 在 `dsh.yaml` 中新增 `dsh-magpie` 条目。新插件稳定后，把 `dsh-magpie-connect` 和 `magpie-display-name-shim` 设为 `enabled: false`。这两个条目不在本 change 中删除。

## Capabilities

### New Capabilities
- `dsh-magpie`：Magpie 网关 provider 插件，覆盖连接与凭据、模型目录与可见性、默认 effort、按 provider 分组的只读用量卡片、Codex 速度切换，以及只读和直连的边界。

### Modified Capabilities
- `auto-model-routing`：为当前默认策略新增双 Magpie transport 兼容与 actual/next effort 纯显示契约；不改 current specs，不把 legacy 的 selectModel 同步语义搬到新默认策略。
- `sidebar-session-provider-icon`：在 Magpie 品牌的 route 名单中明确列出 `dsh-magpie`，并为它补一个正向回归场景。原有前缀规则不变。

## Impact

- 依赖：`@earendil-works/pi-ai`（MIT，0.87.x）、`undici`（私有直连 dispatcher）。
- 代码：新增 `packages/dsh-magpie/`，包括 host 半区（LLM adapter、目录与用量同步、设置路由）和 web 半区（设置页、速度切换）。另外给 `packages/sidebar-session-provider-icon` 增加回归测试（源码不变）。
- 宿主：复用 `packages/dsh-pet/compat/subagent/` 的 pinned-source 受管 patch/build/provenance/hash 与测试 owner，覆盖模型展示组和 actual/next effort；plugin catalog owner 仅从 raw owned_by 输出 displayGroup，不改变 CatalogModel.provider fallback 或设置偏好键。宿主测试/构建由其 owner 提供证据，本轮规划 reconcile 不代跑或代宣称通过。
- 配置：`dsh.yaml` 新增条目；两个 README 的 Plugins 段要加上；新包要声明 `ohmydsh.docTier`，并满足 `tests/repo-docs-governance.test.mjs` 对该 tier 的 README 规则。
- 外部依赖：Magpie 网关端点 `/v1/models`、`/v1/responses`、`/v1/chat/completions`、`/v1/magpie/quotas/cards`、`POST /v1/magpie/quotas/refresh`。前提：网关允许远端访问（打开了局域网共享，或 `MAGPIE_ADDR` 监听在非回环地址，CT105 属于后一种）；key 为启用状态，并且 key 本身有权读取卡片（不受限的 key 天然可以；受限的 held key 需要 Quotas 权限，而且只看得到自己范围内的卡片）。2026-10-25 已用当前 key 实测通过。
- AUTO（本轮用户明确批准“纳入本轮，继续完成”）：新默认策略兼容 `dsh-magpie` 与旧 `dsh-magpie-connect` 精确 transport，保留完整 model ID、实时能力/effort cap、父 captured allowlist，不扩大允许列表、不改 legacy 语义。主 request 原本不按 provider 过滤，实测 mock adapter/request-header 已为 high，而官方投影可保留 lastUsed high / next medium；这不是“新 route 暂不判档”，也不是显示已修复。经 Pet compat 仅透出已有 lastUsed，在同 provider/model 的 effort 不同时显示“实际 High · 下次 Medium”；pending/check/提交仍按 next，不调用会保存全局默认值的 selectModel，MANUAL 请求不变。
- 仍在本 change 之外：`home-network-model-guard` 的停用与网络代理运维；不得借本轮兼容/显示修改它们。
- 网络运维（本 change 之外）：Magpie 稳定后，可以移除 Ken-WSL 的 usip TUN。
- 后续：在 DSH 里「使用 Codex 重置卡」，需要 Magpie 在网关端口新增端点。目前只有 Magpie GUI 的 `POST /api/usage/codex-reset`，它走 GUI 自己的认证，插件按边界不使用。本 change 只做只读展示。
