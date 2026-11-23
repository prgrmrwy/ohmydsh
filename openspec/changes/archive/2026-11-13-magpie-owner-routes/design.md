## Context

- 原版 DSH 0.2.0-rc.2 的模型目录 `buildModelCatalog`（`node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js:500-548`）为 `ctx.llm.listProviders()` 中每个 route 生成一组，组名取 `providerInfo().name`，再过滤掉空组。选择器、`/model`、current/pending 与 effort 都以 `group.id`（即真实 route）为身份。
- `registerAdapter(providers, adapter)` 允许一个 adapter 实例拥有多个 route（`dsh-llm/lib/index.js:1833-1852`）：`providers` 为空抛 `INVALID_ADAPTER`；`prepareRoutes`（`:1858-1878`）要求 `providerInfo(p).id === p` 且 name 非空，被别人占用的 route 抛 `DUPLICATE_ADAPTER`，此时不改动注册表；句柄 `replace(next)` 原子替换并发 `llm/adapters-updated`，`replace([])` 合法，dispose 后 `replace` 抛 `REGISTRATION_DISPOSED`；`commitRoutes` 提交后若监听器抛 `INVARIANT` 会向上抛，但 route 已经提交（`:1804-1818`、`:1886-1894`）。
- 宿主校验每条 adapter 返回的模型信息：`listModels` 要求 `model.provider === 请求的 route`，否则 `INVALID_CATALOG`（`:2073-2077`）；`normalizeModelInfo` 对 `resolveModel` 和 `prepareCall` 的结果做同样要求，否则 `INVALID_MODEL_INFO`（`:2105-2108`、`:2203-2206`）。现有插件把 `provider` 写死成 `dsh-magpie-connector`（`src/host/catalog.ts:24`、`src/host/adapter.ts:108,113`）。
- 回放：AgentLoop 把 assistant 消息的 `source.provider` 记为请求时的 route（`dsh-agent-loop/lib/index.js:1136`）；宿主 `forAdapter` 只保留同一 adapter 写入的 `replayState`（`dsh-llm/lib/index.js:2242-2256`）；插件 `restoreAssistant` 要求 envelope `response.provider === source.provider`（`adapter.ts:41`），否则退化为外来历史，而 envelope 中的值来自 pi-ai `Model.provider`，现在写死为 `dsh-magpie-connector`（`adapter.ts:22,167`）。pi-ai 判断「同一模型」时比较 `provider/api/model`（`pi-ai/dist/api/transform-messages.js:68`）。
- 设置写入：`cleanSettings` 和 `savePreferences` 都会重建对象，丢弃未知字段（`runtime.ts:100,439`）；后台目录同步不经过 `SettingsController` 的串行队列（`routes.ts:11`、`runtime.ts:235`）。
- 提交前的模型可用性检查：`selectModel`/提交走 `requireModel → modelAvailable`，要求目录里当前就有这个模型（`session-controller/lib/index.js:555,724,901`）；客户端也按目录判断是否可路由（`dsh-client-ui-model-selection/lib/client.js:334`）。
- 实测本机网关 `owned_by`：`claude`、`codex`、`opencode-go`、`deepseek`（2026-10-29）。

## Goals / Non-Goals

**Goals:**
- 原版宿主无需任何扩展即可显示 `Magpie (Claude)`、`Magpie (Codex)`、`Magpie (Opencode-go)`、`Magpie (Deepseek)`、`Magpie (Other)` 分组。
- 重启后、目录同步前，已持久的归属 route 身份即存在（不报 `NO_ADAPTER`）。
- 归属 route 上的多轮对话保留原生推理回放元数据，跨本插件 route 换选同一模型也保留。

**Non-Goals:**
- 兼容旧 route `dsh-magpie-connector`（用户明确不要）。
- 修改 AUTO 策略与出口守卫部署配置（用户另行安排）。
- 同步完成前就让选择器显示已保存的模型（目录不落盘，见 D9）。
- 退役 Pet compat `model-display.patch`（另起 change）。
- 改变可见性 / 默认 effort 的偏好键。

## Decisions

### D1 归属键与 route id
`owned_by` 去空白后 1–48 字符、转小写后匹配 `^[a-z0-9][a-z0-9._-]*$` 才作为归属键，否则归 `other`；route id `dsh-magpie-connector-<key>`。原值 `other` 与缺失并为一组。`owned_by` 是不可信的网关数据：字符集和长度限制保证它进入 route id 时安全（不会出现空格、斜杠、尖括号，长度有界）。
- 备选：保留 AMD2 的 `owned-by:` 命名空间区分真实 `other`。否决：会出现两个同名 `Magpie (Other)` 组。

### D2 显示名只由归属键决定
`Magpie (<Key 首字母大写>)`，`other` → `Magpie (Other)`。显示名不取「第一个模型的原值」：启动时和归属下架后目录为空，没有原值可取；`Claude`/`claude` 换序也不应改名。原始网关字符串从不直接进入显示名。按用户要求不保留 `codex`→`GPT` 特例。

### D3 一个 adapter，按请求 route 回填 provider
继续只用一个 `MagpieAdapter`，`registerAdapter([...routes], adapter)`。`providerInfo(p)` 按 D2 返回；`listModels(p)` 按归属过滤；三条返回路径都在克隆后的模型信息上把 `provider` 设成请求的 route，满足宿主的 provider 一致性检查。查找只按模型 id 进行，跨 route 请求得到的能力一致。线路、代际与凭据逻辑不变。
- 备选：每个归属一个 adapter 实例。否决：多实例共享 runtime 没有收益；而且宿主 `forAdapter` 会把另一个实例写入的 replay 剥掉，跨 route 回放会退化。

### D4 回放身份与 route 分离
- **写入**：pi-ai `Model.provider` 和 envelope `response.provider` 固定为传输身份 `dsh-magpie-connector`（现状保持不变），它不是注册的 route。
- **恢复**：校验条件从 `response.provider === source.provider` 改为两条：`source.provider` 是本插件归属 route（正则），且 `response.provider === 传输身份`；`response.model === source.model` 和逐块 hash 校验照旧。恢复出的 pi 消息 provider 用传输身份，所以 pi-ai 在任一本插件 route 上都把它视为同模型。
- **fallback 的 api 判断**：同样改为「来源是本插件 route，且 model id 相同」。
- 已退役 route `dsh-magpie-connector` 作为 `source.provider` 时不匹配正则，按外来历史退化处理，符合「不兼容」的决定。
- 备选：把 pi provider 设成当前 route。否决：跨 route 续聊时 pi-ai 判定为不同模型，丢掉 redacted thinking。

### D5 单一同步写入函数，不加跨 await 的锁
新增同步函数 `runtime.writeSettings(patch)`：以写入时刻的 `store.value`（只取已知字段）为基底，合并 patch，原子写盘，单次调用内不 await。`cleanSettings`、`savePreferences`、pending 标记和归属追加都改走它。
- **为什么不用队列**：第 2 轮评审指出，把 `SettingsController` 的队列下沉到 runtime 会自锁。`{resync:true}` 和线路保存会在队列里 await 目录同步，而同步发现新归属时又要排进同一个队列。Node 是单线程的，同步写入函数天然不会和别的写入交错，所以不需要锁；真正的风险只有「await 之前取的快照在 await 之后被拿来写」。
- **规则**：凡是跨越 await 的写入（线路保存要等凭据 `set`/`unset`），最终写入时都 SHALL 重新读取 `store.value` 作为基底，不得复用 await 之前的快照，这样 await 期间追加的 `knownOwners` 不会被覆盖。`SettingsController` 现有的 HTTP 请求串行队列保留，只用于请求之间的串行；同步路径从不进入这个队列，所以不会自锁。
- 加载时 `knownOwners` 独立校验，失败只重置它自己（D7），不影响 `loadConfig` 对线路的严格校验。

### D6 注册与发布
- **首次注册失败视为启动失败**：在真实宿主里，`registerAdapter` 先提交 route 再通知；如果监听器抛 `INVARIANT`，句柄不会返回，route 却留在注册表里，插件既无法 replace，也无法通过 dispose 撤销（第 2 轮评审用真实 Cordis 实测）。因此首次 `registerAdapter` 抛出任何错误（`DUPLICATE_ADAPTER`、`INVALID_ADAPTER`、`INVARIANT`）都进入「启动失败」状态：不重试、不再 register/replace、不改写 `knownOwners`，设置页报告 `routeRegistrationError`，需要重启 Host 才能恢复。这是宿主的边界，插件无法做得更好；用显式失败代替假装成功。
- **replace 失败**：`replace` 抛 `DUPLICATE_ADAPTER` / `INVALID_ADAPTER` 时宿主没有改动注册表，插件撤回本次追加并写回，再用原集合 replace 一次，把目录变化发布出去；撤回写入也失败时如实报告，下一次启动由「启动失败」路径兜底。`replace` 抛 `INVARIANT` 时 route 已经提交，句柄仍然有效，视为成功。
- **同步流程**：映射目录 → 计算新归属（截断到 32 个）→ 提交目录 → 若有新归属则 `writeSettings`（失败就不扩大集合，记 `settings`）→ 发布。只要目录有变化就会发布：route 集合不变时也调用 `replace(当前集合)`。这修正了第 2 轮 M1，保证设置写入失败时，已打开的选择器仍能收到已有分组的更新。
- **dispose 与代际**：每次写设置和发布之前都重新检查 `disposed` 与 `isCurrent(gen)`。
- **清理独立**：`index.ts` 的 effect cleanup 改用既有 `createDisposer`（`src/host/dispose.ts`，`Promise.allSettled`），把注册句柄 disposer、runtime.dispose、路由注销作为相互独立的清理项，任何一个抛错（含宿主 `INVARIANT`）都不阻止 runtime 关闭；首次注册 INVARIANT 滞留的 route 是宿主边界，只能靠 Host 重启清除，设置页显示该说明（第 3 轮评审 M1/M2、S1）。

### D7 `knownOwners` 持久与校验
放在 `settings.json`。加载时任一项不合法就把整个数组视为空并标记 `knownOwnersReset`，不做部分修复，也不立刻改写文件，便于用户排查；下一次合法写入时覆盖。上限 32，按目录中首次出现的顺序准入；被拒绝的归属单独报告，不再出现时清除标记。只增不减：下架的 route 留着，宿主会隐藏空组。
- 备选：每次同步按当前目录重算 route。否决：网关临时下架某个上游，该上游的所有会话会立即 `NO_ADAPTER`。
- 备选：不设上限。否决：异常网关可能无限注册 route。

### D8 速度控件
`SpeedSelect` 的 `current.provider === ROUTE` 改为 `isMagpieRoute(provider)`（与 D4 共用正则）。这只控制 UI 显隐；是否发送 `service_tier` 仍由模型的 `serviceTiers` 决定。

### D9 启动可用性边界
持久化 route 只解决身份问题（`NO_ADAPTER`）。目录仍只在内存里，首次同步完成前，宿主的 `modelAvailable` 和选择器会把已保存的选择视为暂不可用，同步发布后自动恢复。不为此持久化目录：现有 spec 明确要求目录不落盘，而落盘目录还涉及 key 轮换和换代隔离，代价远高于这几秒的不可用。

### D10 去掉 `displayGroup`
`mapCatalog` 不再输出 `displayGroup`；`CatalogModel` 新增 `owner`（归属键）。既有 `CatalogModel.provider` 作为可见性键（`owned_by` 原值或 id 首段）保持不变，不迁移已保存的 `visibleModels`。

## Risks / Trade-offs

- [旧会话、默认模型失效] → 用户已明确接受；CHANGELOG / README 写明升级后要重选模型。
- [本机部署后 AUTO 的 Magpie transport 失效，出口守卫不再豁免 Magpie 的 Claude 模型] → 两者都是 fail closed：AUTO 报 provider 不在注册表，守卫按 blocked/unknown 拦截，不会误放行。由用户另行安排的适配解决；部署前要与那边对齐上线顺序。
- [重启后数秒内选择器显示模型暂不可用] → 见 D9，同步完成后自动恢复。
- [`knownOwners` 只增不减，32 个配额可能被异常网关占满] → 被拒绝的归属会报告；README 说明手动清理会让保存在被移除 route 上的选择失效。
- [与 `magpie-dual-lines` 同时修改多个 requirement] → 本 delta 以 dual-lines 的版本为基础书写；归档顺序为 dual-lines 先、本 change 后。
- [Pet compat 宿主仍装着 model-display patch] → 插件不再输出 `displayGroup`，patch 对本插件既无效果也无冲突。

## Migration Plan

1. 发布 0.3.0：首次启动时 `knownOwners` 为空，不注册 LLM route；首次同步后注册归属 route。
2. 旧会话、默认模型需在选择器中重选。
3. 部署：`dsh build` 后重启 Host。回滚：manifest pin 回 0.2.0。0.2.0 的 `SettingsStore` 是浅合并，加载时不会因多出的 `knownOwners` 出错，但它的下一次设置写入会丢掉这个字段；重新升级后首次同步会重建。

## Open Questions

- 本机部署与 AUTO / 出口守卫适配的上线顺序（由用户安排）。
