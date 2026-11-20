## Context

- 产品定位：`packages/dsh-magpie-connector/docs/product-positioning.md`。设置与 picker 消费网关已有的模型和路由入口；建组、策略、账号池留在 Magpie。
- 基线（已归档 `2026-11-13-magpie-owner-routes`，现为主规范）：按网关 `owned_by` 归属键注册 route `dsh-magpie-connector-<key>`；`knownOwners` 持久、上限 32；首次 `registerAdapter` 失败为不可恢复的启动失败（`runtime.ts:162-167`）；`replace` 冲突时撤回本次新增归属。
- 现有代码接缝：`mapCatalog`（`src/host/catalog.ts:46`）为每个模型产出 `provider`（可见性键）与 `owner`（归属键）；`listModels` 按 `owner` 过滤；设置响应的 `groups` 按 `provider` 分组（`src/host/routes.ts:46`），`isVisible` 按 `provider` 查 `visibleModels`。
- 2026-11-20 家庭 Magpie 0.1.4499 实测：自定义组为 `group/<slug>`，短显示名，`owned_by` = 首个成员厂商，给 `reasoning_levels`，不给成员列表；自动组对外为 `auto/<model>`（源码 `internal/provider/group.go:1127,1648`），历史 `group/auto-*` 仍可用。路由组的 effort 可改变实际成员：「便宜优先」`low` → `opencode-go/minimax-m3.1-flash`，`high` → `claude/claude-fable-5-2`（响应头 `X-Magpie-Model`）。
- 第一轮评审（`review-round1.md`，REVISE）与 ponytail 精简审查的结论已并入下述决定。

## Goals / Non-Goals

**Goals:**
- picker 与设置页对路由入口使用同一分类。
- 路由入口有不属于任何厂商的固定位置，不会因成员顺序换组；除已有 32 个其它归属这一罕见情形（见 D3）外，不会因名额消失。
- 尽量复用现有归属与可见性流程，不新增错误状态或降级路径。

**Non-Goals:**
- 在插件里建组、改策略、展示成员或多账号分配方式。
- 侧边栏同一厂商多账号分段（另起 change）。
- 兼容旧会话在厂商 route 下保存的路由组选择（用户已选方案 A）。
- 显示本轮实际成员模型。

## Decisions

### D1 只按 id 前缀识别
`group/` 或 `auto/` 开头即为路由入口；`auto/` 与 `group/auto-` 开头为自动组，其余 `group/` 为自定义组。不读显示名或标签。
- 假设：网关没有名为 `group` 或 `auto` 的普通厂商（id 首段即厂商名）。
- 已知误差：用户把自定义组命名为 `auto-…` 时会被标成自动组；只影响设置页的类型文字。
- 否决：#11 的标签匹配（展示文本随语言和版本变化）；只认 `group/*`（#10，漏掉自动组）。

### D2 `routing` 是映射时决定的归属键与可见性键
`mapCatalog` 对路由入口输出 `provider = "routing"`、`owner = "routing"`。于是：
- picker：`routing` 作为归属键走现有 `knownOwners` 准入、注册、`replace` 失败处理，route 为 `dsh-magpie-connector-routing`，显示名按现有规则为 `Magpie (Routing)`。首个归属即使只有路由入口也会注册（首次安装只有路由组的情形自然覆盖）。
- 被别的 adapter 占用时，表现与任何归属 route 被占用相同（现有启动失败 / 撤回流程），不新增降级路径。
- 设置页：`groups` 自然多出 `provider: "routing"` 一组，`isVisible` 自然按 `routing` 键判断；不需要新的分类代码。
- 路由入口的 `owned_by` 不再出现在归属与可见性计算中，因此不会额外占用厂商名额。
- 不是路由入口、但归属键或可见性键会是 `routing` 的普通模型（`owned_by: routing` 时两者都是；无 owned_by 且 id 首段为 `routing` 时归属键本就是 `other`、可见性键是 `routing`），归属键与可见性键都改为 `other`，使 `routing` 只代表路由入口，设置页「路由组」分区即带 `routingKind` 的行。
- #11 的测试环境若已持久 `routing`，与本设计是同一个键，不产生重复 route。
- 否决：独立保留 route + 降级（第一轮 C1/C2：首次注册失败会拖垮全部 route，降级路径不可达且会在 route 间来回跳）。

### D3 名额：总数仍为 32，`routing` 优先准入
上限与加载校验不变（`knownOwners` 至多 32 项）。同一次同步中有多个新归属时，`routing` 排在最前面准入。已有 32 个归属且不含 `routing` 时，`routing` 与其它超额归属一样被拒绝并在 `ownerLimitReached` 中报告；路由入口此时回退列在原 `owned_by` 厂商 route 上（`CatalogModel.fallbackOwner`，`runtime.ownerOf`），原厂商 route 已注册时与升级前一致、不会消失；未注册时不出现在任何 route 上。这只是列举时选 route，不尝试注册新 route，因此不触及首次注册失败的启动规则（第 4 轮，回应 agent-bebop 在 #11 的意见）。
- 否决：在 32 之外为 `routing` 多留 1 个（第二轮评审 S1）。它需要放宽加载校验、修正现有上限计算，回滚到旧版本时 33 项数组还会被整体重置；为 32 个以上厂商这种罕见情形付出的复杂度不值得。

### D4 设置页
- 「路由组」分区即 `provider === "routing"` 的组，排在最前；分区说明一行「在 Magpie 中新建和编辑；这里决定是否在 DSH 显示及默认推理强度」。
- 每行：可见性勾选、名称、类型（自定义 / 自动）、默认 effort 下拉（仅当有 `reasoning_levels`）。类型由 `mapCatalog` 写在目录模型上（`CatalogModel.routingKind`），设置响应构造 `groups` 的各处（`routes.ts:46`、`runtime.ts` 设置视图）都从目录模型取值下发，客户端不重复实现前缀判断。
- 分区沿用现有 `ProviderGroup` 的可见性与「恢复跟随网关列表」逻辑（只删 `routing` 键）。厂商分区中不再出现路由入口；一个厂商只剩路由入口且没有用量卡片时，它的分区随之消失，不残留空面板；有用量卡片时分区保留，只显示卡片。
- 默认 effort 下拉未设置文案：`默认：不指定` / `Default: not set`。已设置时显示档位（现状）。这是用户在审阅视觉稿时提出的文案调整；路由组分区新增了同样的下拉，顺带统一，避免新旧两处文案不一致。

### D5 显示名不加后缀
沿用 `display_name`（缺失取 id）。Routing 分组标题已区分路由入口与普通模型，不再追加 ` · auto`。
- 否决：重名时加后缀。评审指出自动组显示名可能本就不同（#11 作者网关），且加了比较逻辑收益小。

## Risks / Trade-offs

- [旧会话中保存的厂商 route + 路由入口组合失效] → 方案 A，CHANGELOG 写明需重选一次。
- [路由组可见性回到跟随网关] → CHANGELOG 写明。
- [路由组每轮可能由不同成员回答，上一轮的推理回放（如加密推理、thinking 签名）会被发给另一成员] → 插件按模型 id 判断同模型，`group/x` 跨轮视为同一模型。test-plan 中实测：成员切换后的下一轮请求是否被网关接受；若被拒，再决定是否对路由入口关闭原生回放（另行评估，不在本 change 预设）。
- [路由组可能在 Magpie 内部转到 Claude，本机出口守卫识别不出] → 守卫本就不覆盖 Magpie 内部转发，Claude 出口由 Magpie 侧代理负责；与现状一致。AUTO 调高 effort 可能让路由组改走 Claude 成员，属于 Magpie 规则的预期效果。
- [`group/auto-…` 命名的自定义组被标为自动] → 仅类型文字不准。
- [`dsh-magpie-connector-routing` 被别的 adapter 占用] → 与任何归属 route 被占用相同：运行中 `replace` 冲突时撤回本次同步新增的全部归属（同一次同步里的其它新归属也一并撤回，与现有行为一致），路由入口不出现在任何 route 上，`lastSyncErrorKind` 为 `registration`；`routing` 已持久后重启时，首次注册失败按现有规则为启动失败，所有本插件 route 都不可用，需排除冲突后重启 Host。
- [已有 32 个归属且不含 `routing`] → 原厂商 route 已注册时路由入口回退留在该 route，设置响应报告被拒绝的 `routing`；清理 `knownOwners` 后可进入 Routing（现有 README 说明）。

## Migration Plan

1. 发布新版本：首次同步把 `routing` 追加进 `knownOwners` 并注册 route；路由入口移入 Routing。
2. 用户在 Routing 分组重选旧会话中的路由组；如需隐藏路由组，在设置页「路由组」分区重新设置。
3. 回滚：manifest pin 回上一版本。`knownOwners` 仍至多 32 项，旧版照常加载并注册空的 `dsh-magpie-connector-routing`（旧版把路由入口放回各厂商 route，`routing` 组列举为空，宿主隐藏空组）。保存在 `dsh-magpie-connector-routing` 上的选择在旧版不可用，需在原厂商分组重选；`visibleModels.routing` 在旧版无对应组，被忽略；默认 effort 按模型 id 保存，不受影响。

