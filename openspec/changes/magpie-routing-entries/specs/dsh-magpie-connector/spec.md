## ADDED Requirements

### Requirement: 路由入口识别
网关目录中 id 以 `group/` 或 `auto/` 开头的条目 SHALL 视为路由入口；`auto/` 与 `group/auto-` 开头的为自动组，其余为自定义组。前缀比较区分大小写（`Group/x` 不是路由入口）。插件 SHALL 只依据 id 前缀识别，SHALL NOT 依据 `display_name`、`magpie_label` 或其它标签文字判断。设置响应中路由入口的模型行 SHALL 带 `routingKind`（`auto` 或 `custom`），普通模型行 SHALL NOT 带该字段。

#### Scenario: 按前缀识别与分类
- **GIVEN** 网关返回 `group/ds`、`group/auto-kimi-k3`、`auto/glm-5`、`opencode-go/x`（`display_name: "Routing group X"`, `magpie_label: "routing group"`）
- **WHEN** 目录同步后读取设置
- **THEN** `group/ds` 的 `routingKind` 为 `custom`，`group/auto-kimi-k3` 与 `auto/glm-5` 为 `auto`，三者在 `provider: "routing"` 组；`opencode-go/x` 没有 `routingKind`，在 `opencode-go` 组

### Requirement: 路由入口原样透传
选择路由入口发起生成时，请求的 `model` SHALL 为网关原始 id；插件 SHALL NOT 把路由入口替换为任一成员模型，SHALL NOT 自行选择账号；默认 effort 按「DSH 侧默认 effort」下发，并按该模型线协议的既有 effort 字段发送。

#### Scenario: 透传 id 与 effort
- **GIVEN** 网关目录中 `group/cheap-first` 的 `native_endpoints` 为 `[]`（因此走 Chat Completions），`reasoning_levels` 为 `["low","high","max"]`；用户为它保存了默认 effort `high`
- **WHEN** 经原版宿主在 `dsh-magpie-connector-routing` 上选择 `group/cheap-first`、不另选 effort，发起一轮生成（宿主按 `reasoning.defaultEffort` 决定本轮 effort）
- **THEN** 网关收到的 `POST /v1/chat/completions` 请求体 `model` 为 `group/cheap-first`，`reasoning_effort` 为 `high`

## MODIFIED Requirements

### Requirement: 按网关归属注册 route

**归属键**：插件 SHALL 把网关目录中的每个模型归入一个归属键。`owned_by` 是不可信的网关数据，SHALL 先校验再使用：
- `owned_by` 为字符串，去首尾空白后长度 1–48，且转小写后匹配 `^[a-z0-9][a-z0-9._-]*$` 时，归属键为其小写形式；
- 其它情况（缺失、非字符串、空、超长、含其它字符）归属键为 `other`；网关原值转小写后恰为 `other` 的模型也归入 `other`。
- 例外：路由入口（见「路由入口识别」）的归属键固定为 `routing`，与其 `owned_by` 无关；其 `owned_by` SHALL NOT 参与归属键计算与归属准入。不是路由入口、但按上述规则归属键或可见性键（`owned_by` 原值，缺失时为 id 首段）会是 `routing` 的普通模型，归属键与可见性键都 SHALL 改为 `other`，使 `routing` 只代表路由入口。

每个归属键对应 route `dsh-magpie-connector-<归属键>`。route 的 `listModels` SHALL 只列出「归属键等于本 route ∩ 可见集」中的模型，模型 id 保持网关原值，SHALL NOT 改写或加前缀。

**显示名**：route 的 `providerInfo().name` SHALL 只由归属键决定，与当前目录内容、模型顺序和原值大小写无关：归属键为 `other` 时为 `Magpie (Other)`，否则为 `Magpie (` + 归属键首字符大写、其余不变 + `)`。例如 `claude`→`Magpie (Claude)`、`codex`→`Magpie (Codex)`、`opencode-go`→`Magpie (Opencode-go)`、`deepseek`→`Magpie (Deepseek)`。因此 route 在启动时、目录为空时和归属下架后都有确定的显示名。

**provider 身份**：宿主要求 adapter 返回的每条模型信息的 `provider` 都等于被请求的 route。插件 SHALL 在 `listModels(route)`、`resolveModel(route, id)` 与 `prepareCall(route, id)` 返回的模型信息中，把 `provider` 设为被请求的 `route`；查找时 SHALL 按模型 id 在当前完整目录中查找，与请求的 route 无关。因此在任一本插件 route 上请求另一归属的模型 id，得到的能力（effort、上下文、输入模态、线协议）与在其所属 route 上请求一致，只有 `provider` 字段不同。目录中不存在的 id SHALL 返回 `{provider: <route>, id, name: id}` 形状的兜底信息。

插件 SHALL NOT 按模型 id 或显示名推测归属，SHALL NOT 输出 `displayGroup` 或其它非官方展示元数据。可见性与默认 effort 偏好 SHALL 继续以既有键（网关 `owned_by` 原值，缺失时为 id 首段；模型 id）保存与匹配；例外是路由入口的可见性键固定为 `routing`，以及上文非路由入口改用 `other`（见「按 provider 分组的模型可见性」）。

#### Scenario: 按 owned_by 分组且不按名字猜测

- **GIVEN** 网关返回 `{id:"claude/claude-opus-5-5", owned_by:"claude"}`、`{id:"custom/claude-looking", display_name:"Claude Looking", owned_by:"codex"}`、`{id:"opencode-go/kimi-k3", owned_by:"opencode-go"}`、`{id:"x/gpt-lookalike"}`（无 owned_by）
- **WHEN** 目录同步后读取原版宿主 `session/modelCatalog`
- **THEN** `groups` 恰含 4 组：id `dsh-magpie-connector-claude` / name `Magpie (Claude)` 含 `claude/claude-opus-5-5`；`-codex` / `Magpie (Codex)` 含 `custom/claude-looking`；`-opencode-go` / `Magpie (Opencode-go)` 含 `opencode-go/kimi-k3`；`-other` / `Magpie (Other)` 含 `x/gpt-lookalike`；`failures` 为空

#### Scenario: 不可信或大小写不同的 owned_by

- **GIVEN** 网关返回 `owned_by` 依次为 `"Claude"`、`"claude"`、`"a b"`、`""`、`"OTHER"`、`"x".repeat(49)`、`"<img src=x>"`、`123` 的八个模型
- **WHEN** 目录同步
- **THEN** 前两个归入 `dsh-magpie-connector-claude`，显示名为 `Magpie (Claude)`，且交换两者在目录中的顺序后显示名不变；其余六个归入 `dsh-magpie-connector-other`；provider 列表中每个本插件 route id 都匹配 `^dsh-magpie-connector-[a-z0-9][a-z0-9._-]{0,47}$`，任何 route 显示名都不含 `<`、空格以外的原始网关字符串

#### Scenario: 返回的 provider 等于被请求的 route

- **GIVEN** 原版宿主 `ctx.llm`（真实 `@deepseek-ai/dsh-llm`）注册了本插件；目录含 `{id:"claude/claude-opus-5-5", owned_by:"claude", reasoning_levels:["low","high"]}` 与 `{id:"codex/gpt-6.1-sol", owned_by:"codex"}`，同步后两个 route 都已注册
- **WHEN** 经宿主直接调用：`listModels("dsh-magpie-connector-claude")`；`resolveModelInfo` 与 `prepareCall` 各以 (`-claude`, `claude/claude-opus-5-5`)、(`-codex`, `claude/claude-opus-5-5`)、(`-claude`, `nope/x`) 调用
- **THEN** 都不抛 `INVALID_CATALOG` / `INVALID_MODEL_INFO`；`listModels` 每个元素的 `provider` 为 `dsh-magpie-connector-claude`；每个 `resolveModelInfo` 结果的 `provider` 与每个 `prepareCall` 结果的 `config.provider` 都等于调用时的 route；两个 route 上解析 `claude/claude-opus-5-5` 的 effort id 都为 `["low","high"]`；`nope/x` 的解析结果为 `{provider: "dsh-magpie-connector-claude", id: "nope/x", name: "nope/x"}`

#### Scenario: 可见性与 effort 在归属 route 上保持

- **GIVEN** 网关模型 `{id:"m/a", owned_by:"Claude"}`、`{id:"m/b", owned_by:"claude"}`；可见性保存了 `{"Claude": ["m/a"], "claude": []}`；`m/a` 保存了默认 effort `high`（且在其 `reasoning_levels` 中）
- **WHEN** 列举 `dsh-magpie-connector-claude`，并解析 `m/a`
- **THEN** 列举结果恰为 `m/a`（`m/b` 被其自身键 `claude` 的空白名单隐藏）；`m/a` 的 `reasoning.defaultEffort` 为 `high`；已保存的可见性对象不变

#### Scenario: other 组内保留各自的可见性键

- **GIVEN** 网关模型 `{id:"p/a", owned_by:"a b"}`（非法归属）与 `{id:"q/b"}`（缺失归属）；可见性保存了 `{"a b": [], "q": ["q/b"]}`
- **WHEN** 列举 `dsh-magpie-connector-other`
- **THEN** 两个模型都归入该 route；列举结果恰为 `q/b`（`p/a` 被其原值键 `a b` 的空白名单隐藏，`q/b` 按 id 首段键 `q` 可见）

#### Scenario: 原版宿主即可看到分组

- **GIVEN** 本仓库依赖中的原版 `@deepseek-ai/dsh-api-session-controller` 0.2.0-rc.2（未打 `model-display.patch`）与上述网关目录
- **WHEN** 用其 `buildModelCatalog` 生成目录
- **THEN** `groups` 中出现 `Magpie (Claude)`、`Magpie (Codex)` 等独立分组；插件 `listModels` / `resolveModel` 的任何返回值都不含 `displayGroup` 键

#### Scenario: 路由入口归入 routing 而不随首个成员换组

- **GIVEN** 网关返回 `{id:"group/cheap-first", display_name:"便宜优先", owned_by:"opencode-go"}`、`{id:"auto/kimi-k3", display_name:"Kimi K3", owned_by:"opencode-go"}`、`{id:"opencode-go/kimi-k3", owned_by:"opencode-go"}`、`{id:"claude/claude-fable-5-2", owned_by:"claude"}`；之后网关把 `group/cheap-first` 的 `owned_by` 改为 `claude` 再同步一次
- **WHEN** 每次同步后读取原版宿主 `session/modelCatalog`
- **THEN** 两次都有组 `dsh-magpie-connector-routing` / `Magpie (Routing)`，恰含 `group/cheap-first` 与 `auto/kimi-k3`；`Magpie (Opencode-go)` 恰含 `opencode-go/kimi-k3`；`Magpie (Claude)` 恰含 `claude/claude-fable-5-2`；显示名为网关 `display_name` 原值，没有附加后缀

#### Scenario: 首次安装只有路由入口

- **GIVEN** 首次安装、`knownOwners` 为空，网关目录只有 `{id:"group/ds", owned_by:"opencode-go"}`
- **WHEN** 首次目录同步
- **THEN** `knownOwners` 为 `["routing"]`；provider 列表中本插件 route 恰为 `dsh-magpie-connector-routing`，其列举含 `group/ds`

#### Scenario: 名为 routing 的普通模型归入 other

- **GIVEN** 网关返回 `{id:"routing/foo", owned_by:"routing"}` 与 `{id:"routing/bar"}`（无 owned_by）
- **WHEN** 目录同步后列举模型并读取设置
- **THEN** 两者都在 `Magpie (Other)` 中，不在 `Magpie (Routing)` 中；设置响应中两者位于 `provider: "other"` 的组，都没有 `routingKind`；`knownOwners` 不含 `routing`

#### Scenario: 旧会话保存的厂商 route 路由入口不再可用

- **GIVEN** 网关目录中 `group/ds` 的 `reasoning_levels` 为 `["low","high","max"]`；升级前某会话保存了 (`dsh-magpie-connector-opencode-go`, `group/ds`)，且 `group/ds` 保存了默认 effort `high`
- **WHEN** 升级后目录同步，宿主对该组合做模型可用性检查，再解析 (`dsh-magpie-connector-routing`, `group/ds`)
- **THEN** 前者不可用（`dsh-magpie-connector-opencode-go` 的列举不含 `group/ds`）；后者可用且 `reasoning.defaultEffort` 仍为 `high`

### Requirement: 归属 route 持久

插件 SHALL 把见过的归属键保存在设置的 `knownOwners`：按准入顺序排列的去重数组（同一次同步中 `routing` 先于其它新归属准入，其余按目录中首次出现顺序），元素满足归属键规则（小写、1–48 字符、`^[a-z0-9][a-z0-9._-]*$`），最多 32 个。

**加载校验**：插件启动时 SHALL 在注册任何 route、解析任何凭据、发起任何网络请求之前校验 `knownOwners`：缺失视为空数组；不是数组、元素不是合法归属键、含重复或超过 32 个时，整个 `knownOwners` 视为空数组（不做部分修复），设置响应 SHALL 报告 `knownOwnersReset: true`，插件 SHALL NOT 为此改写设置文件，直到下一次合法的 `knownOwners` 写入。`knownOwners` 的异常 SHALL NOT 影响线路、凭据与偏好的加载。

**写入边界**：所有设置写入（线路保存、pending 标记、偏好保存、归属追加）SHALL 经由同一个同步写入函数：以当前内存设置中的已知字段为基底（未知字段如旧版 `baseUrl` 不写回），只覆盖本次修改的字段，原子写盘，保留 `lines`、`visibleModels`、`defaultEfforts`、`credentialUpdatePending`、`knownOwners` 中未修改者。写入函数 SHALL 是同步的（单次调用内不 await），因此任意两次写入不会交错，也不需要跨 await 的锁。线路保存在 await 凭据操作期间若发生归属追加，线路保存的最终写入 SHALL 以写入时刻的内存设置为基底，不得用 await 之前取得的旧快照覆盖 `knownOwners`。任何设置写入或归属追加 SHALL NOT 等待目录同步完成；目录同步 SHALL NOT 等待设置请求完成。

**注册**：
- 启动时 `knownOwners` 非空 → SHALL 立即以其对应 route 集合调用一次 `registerAdapter`；为空 → 不注册，等首个归属出现再注册（宿主拒绝空集合注册）。
- 首次 `registerAdapter` 抛错时（含被其它 adapter 占用而抛 `DUPLICATE_ADAPTER`、以及宿主通知监听器抛 `INVARIANT`），插件 SHALL 视为不可恢复的启动失败：SHALL NOT 重试注册，SHALL NOT 再调用 `registerAdapter` / `replace`，SHALL NOT 改写 `knownOwners`；设置路由照常可用，设置响应 SHALL 报告 `routeRegistrationError`（含宿主错误 code 与首个冲突 route id，不含 key），模型目录同步仍可进行但不发布 route。用户排除冲突后需重启 Host 恢复。设置页 SHALL 在同步状态区域显示该错误与「需重启 Host」的说明，即使目录同步成功也显示。
- 已有句柄后，`replace` 抛 `DUPLICATE_ADAPTER` / `INVALID_ADAPTER` 时宿主未改变 route 集合；`replace` 抛 `INVARIANT` 时宿主已提交新集合。

**归属追加与发布**（目录同步成功、且仍是当前代且未 dispose 时）：
1. 按目录中首次出现顺序收集新归属键，其中 `routing`（见「按网关归属注册 route」）排在本次新归属的最前面，依次准入直至 `knownOwners` 满 32 个；超出者不准入，设置响应报告 `ownerLimitReached: true` 与被拒绝列表。
2. 先提交目录（已注册 route 立即可列举到新目录）。
3. 若有准入的新归属：以「当前 `knownOwners` + 新归属」写入设置。写入失败 → 不扩大 route 集合，设置响应 `lastSyncErrorKind` 为 `settings`，转第 4 步只用原集合发布。
4. 发布：已有句柄时以（写入成功则扩大后、否则原有的）完整集合调用 `replace`；还没有句柄且集合非空、且未处于启动失败状态时调用 `registerAdapter`（失败按上一条「首次 `registerAdapter` 抛错」处理）。目录有变化而 route 集合不变时也 SHALL 调用 `replace`，使已打开的选择器收到 `llm/adapters-updated`。
5. `replace` 抛 `DUPLICATE_ADAPTER` / `INVALID_ADAPTER` → 从 `knownOwners` 撤回本次新增并写回；随后以原集合再 `replace` 一次以发布目录变化。撤回写入失败时，设置响应 SHALL 报告 `lastSyncErrorKind: registration` 与冲突 route id，内存中的 `knownOwners` 仍撤回；下次启动若因该持久归属冲突，按「首次 `registerAdapter` 抛错」处理。`replace` 抛 `INVARIANT` → 视为已提交，不撤回。
- dispose 后（含首次注册之前 dispose），晚到的同步结果 SHALL NOT 写入设置、SHALL NOT 调用 `registerAdapter` / `replace`。
- 归属键从目录中消失时，对应 route SHALL 保留注册（列举为空，宿主隐藏空组），SHALL NOT 从 `knownOwners` 删除。删除线路、切换线路、禁用插件都 SHALL NOT 清空 `knownOwners`。`ownerLimitReached` 只在不再有被拒绝的归属键时清除；清空 `knownOwners` 需用户手动编辑设置文件，README 说明这会使保存在被移除 route 上的选择失效。

**启动可用性边界**：注册 route 只保证 route 身份存在（宿主不报 `NO_ADAPTER`）。目录只在内存中，首次同步完成前该 route 列举为空，宿主的选择器与提交前的模型可用性检查会把已保存的选择视为暂不可用，直到同步完成并发布；这是预期行为，插件 SHALL NOT 为此持久化目录。

#### Scenario: 重启后 route 身份在同步前即存在

- **GIVEN** `knownOwners` 为 `["claude","codex"]`，网关 `/models` 挂起不响应
- **WHEN** 插件启动，然后在网关返回前经宿主 `listProviders()` 与 `resolveModelInfo("dsh-magpie-connector-claude", "claude/claude-opus-5-5")` 查询
- **THEN** provider 列表中本插件 route 恰为 `dsh-magpie-connector-claude`（name `Magpie (Claude)`）与 `dsh-magpie-connector-codex`（name `Magpie (Codex)`）；解析不抛 `NO_ADAPTER`，返回兜底信息；`listModels` 两个 route 均为空数组

#### Scenario: 首次安装在同步前不注册 route

- **GIVEN** 设置中没有 `knownOwners`，线路已配置，网关 `/models` 挂起不响应
- **WHEN** 插件启动
- **THEN** 插件不抛错，provider 列表中没有任何 id 以 `dsh-magpie-connector` 开头的 route；`GET /api/dsh-magpie-connector/settings` 返回 200

#### Scenario: 首次配置经设置请求同步出归属后注册

- **GIVEN** 首次安装，没有线路，有一个 `llm/adapters-updated` 监听器；网关对 `/models` 返回 `owned_by` 为 `claude` 的模型
- **WHEN** 客户端提交第一条线路（含 key）并带 `resync: true`，在 5 秒内等待该 HTTP 响应
- **THEN** 响应在 5 秒内返回 200；设置文件 `knownOwners` 为 `["claude"]` 且含该线路；监听器收到事件；provider 列表中本插件 route 恰为 `dsh-magpie-connector-claude`

#### Scenario: resync 发现新归属不自锁

- **GIVEN** `knownOwners` 为 `["claude"]`，网关目录新增 `owned_by: "deepseek"` 的模型
- **WHEN** 客户端提交 `{resync: true}`；同时另一次后台目录同步已在等待网关响应
- **THEN** 两者都在 5 秒内完成，HTTP 响应为 200；`knownOwners` 为 `["claude","deepseek"]`（不重复）；provider 列表含 `dsh-magpie-connector-deepseek`

#### Scenario: 新归属被持久并发布

- **GIVEN** `knownOwners` 为 `["claude"]`，有一个 `llm/adapters-updated` 监听器
- **WHEN** 目录同步返回 `owned_by` 为 `claude` 与 `deepseek` 的模型
- **THEN** 设置文件的 `knownOwners` 为 `["claude","deepseek"]`；监听器收到事件；随后 provider 列表含 `dsh-magpie-connector-deepseek`

#### Scenario: 保存 knownOwners 失败时仍发布已有 route 的目录变化

- **GIVEN** `knownOwners` 为 `["claude"]`，`dsh-magpie-connector-claude` 当前列出 `claude/a`；有一个 `llm/adapters-updated` 监听器；设置文件写入会失败
- **WHEN** 目录同步返回 `claude/a`、`claude/b`（owned_by claude）与 `deepseek/x`（owned_by deepseek）；之后写入恢复，再同步一次
- **THEN** 第一次之后：监听器收到事件；原版宿主 `buildModelCatalog` 的 `Magpie (Claude)` 组含 `claude/a`、`claude/b`；provider 列表不含 `dsh-magpie-connector-deepseek`；设置响应 `lastSyncErrorKind` 为 `settings`。第二次之后注册了 `dsh-magpie-connector-deepseek`

#### Scenario: replace 冲突时撤回追加并发布目录

- **GIVEN** `knownOwners` 为 `["claude"]`（已注册）；另一个 adapter 已注册 route `dsh-magpie-connector-deepseek`
- **WHEN** 目录同步返回 `claude/b`（新模型，owned_by claude）与 `deepseek/x`（owned_by deepseek）
- **THEN** 本插件仍只拥有 `dsh-magpie-connector-claude` 且其列举含 `claude/b`；设置文件 `knownOwners` 为 `["claude"]`；设置响应 `lastSyncErrorKind` 为 `registration` 且错误含 `dsh-magpie-connector-deepseek`

#### Scenario: 撤回写入失败时下次启动按启动失败处理

- **GIVEN** 上一场景，但撤回 `knownOwners` 的写入也失败，文件保留 `["claude","deepseek"]`；冲突 adapter 仍在
- **WHEN** 重启插件
- **THEN** 首次 `registerAdapter` 抛 `DUPLICATE_ADAPTER` 后插件不再注册或 replace；provider 列表中本插件没有任何 route；`GET /api/dsh-magpie-connector/settings` 返回 200 且 `routeRegistrationError.code` 为 `DUPLICATE_ADAPTER`、route 为 `dsh-magpie-connector-deepseek`；渲染设置页时同步状态区域显示该错误与需重启 Host 的说明；`knownOwners` 文件字节不变

#### Scenario: 首次注册 INVARIANT 不当作成功

- **GIVEN** 真实 Cordis 与 `@deepseek-ai/dsh-llm`；一个 `llm/adapters-updated` 监听器抛 code 为 `INVARIANT` 的错误；`knownOwners` 为 `["claude"]`
- **WHEN** 插件启动，随后一次目录同步返回新归属 `codex`，然后 dispose 插件 context
- **THEN** 插件启动不抛出到 Cordis；设置响应 `routeRegistrationError.code` 为 `INVARIANT` 且含需重启 Host 的说明；同步后不调用 `registerAdapter` / `replace`（宿主中不出现 `dsh-magpie-connector-codex`），`knownOwners` 仍为 `["claude"]`；dispose 不抛未处理错误，dispose 后宿主中仍有滞留的 `dsh-magpie-connector-claude`（预期，Host 重启前无法撤销），且插件不再发起网关请求、不再写入设置

#### Scenario: 线路保存期间的归属追加不被覆盖

- **GIVEN** `knownOwners` 为 `["claude"]`；一次线路保存已写入 `credentialUpdatePending` 标记并正在等待 credentials `set`
- **WHEN** 此时后台目录同步发现新归属 `deepseek` 并写入；随后凭据写入完成、线路保存写入最终设置；然后再保存一次偏好；最后重建 runtime
- **THEN** 最终设置文件同时含新线路、新偏好与 `knownOwners: ["claude","deepseek"]`，不含 `credentialUpdatePending`；若在凭据写入期间重建 runtime，文件同时保留 `credentialUpdatePending` 与 `knownOwners: ["claude","deepseek"]`

#### Scenario: 非法 knownOwners 被整体重置且不影响连接

- **GIVEN** 设置文件 `knownOwners` 依次为 `"claude"`、`["Claude"]`、`["claude","claude"]`、33 个合法键、`["a b"]` 之一，线路与偏好合法
- **WHEN** 插件启动，读取设置
- **THEN** 启动时不调用 `registerAdapter`；设置响应 `knownOwnersReset` 为 `true`，`lines` 正常返回；设置文件字节在首次同步写入前不变；首次同步成功后 `knownOwners` 被写为合法数组并注册对应 route

#### Scenario: 归属下架后 route 保留

- **GIVEN** `knownOwners` 为 `["claude","deepseek"]`
- **WHEN** 目录同步只返回 `claude` 模型
- **THEN** `dsh-magpie-connector-deepseek` 仍在 provider 列表中（name `Magpie (Deepseek)`）且列举为空；`knownOwners` 不变；模型目录 `groups` 中没有 `Magpie (Deepseek)`

#### Scenario: 归属上限按出现顺序截断

- **GIVEN** `knownOwners` 已有 30 个
- **WHEN** 目录同步按顺序返回新归属 `za`、`zb`、`zc` 的模型；之后网关不再返回 `zc`，再同步一次
- **THEN** 第一次后 `knownOwners` 追加 `za`、`zb` 达到 32 个，注册其 route；不注册 `dsh-magpie-connector-zc`，任何 route 都不列出 `zc` 的模型；设置响应 `ownerLimitReached` 为 `true`、被拒绝列表为 `["zc"]`；第二次后 `ownerLimitReached` 为 `false`

#### Scenario: routing 在同一次同步中优先准入

- **GIVEN** `knownOwners` 已有 31 个且不含 `routing`
- **WHEN** 目录同步按顺序返回新归属 `zz` 的模型和 `group/ds`（`owned_by: "opencode-go"`）
- **THEN** `knownOwners` 的最后一项为 `routing`（前 31 项不变），达到 32 个并注册 `dsh-magpie-connector-routing`，其列举含 `group/ds`；`zz` 不准入，设置响应 `ownerLimitReached` 为 `true`、被拒绝列表为 `["zz"]`

#### Scenario: 首次同步时 routing 排在最前

- **GIVEN** 首次安装、`knownOwners` 为空
- **WHEN** 目录同步按顺序返回 `claude/a`（`owned_by: "claude"`）与 `group/ds`
- **THEN** `knownOwners` 恰为 `["routing","claude"]`

#### Scenario: 名额已满时 routing 被拒绝并报告

- **GIVEN** `knownOwners` 已有 32 个且不含 `routing`
- **WHEN** 目录同步返回 `group/ds`
- **THEN** 不注册 `dsh-magpie-connector-routing`，任何 route 都不列出 `group/ds`；设置响应 `ownerLimitReached` 为 `true`、被拒绝列表为 `["routing"]`

#### Scenario: routing route 被占用时 replace 冲突

- **GIVEN** `knownOwners` 为 `["claude"]`（已注册）；另一个 adapter 已注册 route `dsh-magpie-connector-routing`
- **WHEN** 目录同步返回 `claude/a` 与 `group/ds`
- **THEN** 本插件仍只拥有 `dsh-magpie-connector-claude`，其列举含 `claude/a`；任何 route 都不列出 `group/ds`；设置文件 `knownOwners` 为 `["claude"]`；设置响应 `lastSyncErrorKind` 为 `registration` 且错误含 `dsh-magpie-connector-routing`

### Requirement: 按 provider 分组的模型可见性
设置页 SHALL 按网关模型的 `owned_by` 分组；没有 `owned_by` 的模型，取 id 中第一个 `/` 之前的部分作为分组。路由入口（设置响应中带 `routingKind` 的模型行，见「路由入口识别」）例外：它们 SHALL 只出现在键为 `routing` 的「路由组」分区，该分区排在所有 provider 分区之前；厂商分区不再包含路由入口。一个 provider 只剩路由入口、且没有该 provider 的用量卡片时，SHALL NOT 显示该 provider 的空分区；有用量卡片时照常显示该分区（只含卡片）。

「路由组」分区顶部 SHALL 说明路由组在 Magpie 中新建和编辑；每行显示可见性勾选框、名称、类型（自定义 / 自动，取自设置响应模型行的 `routingKind`）以及（有 `reasoning_levels` 时）默认 effort 下拉。插件 SHALL NOT 提供创建、编辑路由组或展示其成员的控件。

每个分区（含「路由组」）的可见性语义：
- 没有保存过选择：跟随网关模型列表，全部可见；
- 保存过选择（包括空列表）：只显示列表中的模型，之后新上架的模型默认隐藏。

保存过选择的分区 SHALL 提供「恢复跟随网关列表」，该操作只删除本分区自己的键。路由入口的可见性 SHALL 只由 `routing` 键决定，不受其 `owned_by` 对应键的白名单影响。

选择器 SHALL 只提供「网关目录 ∩ 可见集」中的模型。可见性是 DSH 侧本地偏好，SHALL NOT 回写网关。保存时只校验形状（键 → 字符串数组），不与当前目录比对。形状非法时 SHALL 以 400 拒绝。

#### Scenario: 未设置时跟随网关
- **GIVEN** `codex` 组未保存过可见性，网关新增 `codex/gpt-6-nova`
- **WHEN** 目录同步后列举模型
- **THEN** 列表包含 `codex/gpt-6-nova`

#### Scenario: 设置后严格按白名单与目录求交集
- **GIVEN** 以下状态同时成立：
  - `claude` 组保存了可见集 `[claude/claude-opus-5-5, claude/claude-haiku-5-5]`，其中 `claude/claude-haiku-5-5` 已不在网关目录中；
  - 网关新增了 `claude/claude-fable-5-2`；
  - `deepseek` 组保存了可见集 `[]`。
- **WHEN** 列举模型，并读取设置
- **THEN** `claude/` 前缀的模型恰为 `claude/claude-opus-5-5`；不含任何 `deepseek/` 前缀的模型；设置中 `claude/claude-fable-5-2` 为 `visible: false`；可见集记录仍保留 `claude/claude-haiku-5-5`

#### Scenario: 形状非法被拒绝
- **GIVEN** 已保存的可见性为 V
- **WHEN** 客户端提交 `{codex: "codex/gpt-6-luna"}`（值不是数组）
- **THEN** 响应状态为 400，已保存的可见性仍为 V

#### Scenario: 路由组只受 routing 键控制
- **GIVEN** 网关目录含 `{id:"group/ds", owned_by:"opencode-go"}`、`{id:"auto/glm-5", owned_by:"opencode-go"}` 与 `{id:"opencode-go/kimi-k3", owned_by:"opencode-go"}`；可见性保存了 `{"opencode-go": ["opencode-go/kimi-k3"]}`，没有 `routing` 键
- **WHEN** 列举模型并读取设置
- **THEN** `group/ds`、`auto/glm-5` 都可见；设置响应 `groups` 中 `provider: "routing"` 的组恰含这两个模型，其 `routingKind` 依次为 `custom`、`auto`；`opencode-go` 组恰含 `opencode-go/kimi-k3`

#### Scenario: 只有路由组时仍能恢复跟随网关
- **GIVEN** 网关目录只有 `group/solo`（无用量卡片）；用户取消再勾选 `group/solo`，保存了 `{"routing": ["group/solo"]}` 与 `{"claude": []}`
- **WHEN** 网关新增 `group/new`，渲染设置页，点击「路由组」分区的「恢复跟随网关列表」，再列举模型
- **THEN** 点击前 `group/new` 隐藏且分区显示「恢复跟随网关列表」；点击后 `visibleModels` 不含 `routing` 键而 `claude` 键不变，列举结果含 `group/solo` 与 `group/new`

#### Scenario: provider 只剩路由入口时不留空分区
- **GIVEN** 网关目录只有 `{id:"group/ds", owned_by:"opencode-go"}` 与 `{id:"claude/claude-fable-5-2", owned_by:"claude"}`，没有 `opencode-go` 的用量卡片
- **WHEN** 渲染设置页
- **THEN** 分区依次为「路由组」与 `claude`；没有 `data-provider="opencode-go"` 的分区

#### Scenario: provider 只剩路由入口但有用量卡片时保留分区
- **GIVEN** 网关目录只有 `{id:"group/ds", owned_by:"opencode-go"}`；用量卡片端点返回一张 `provider: "opencode-go"` 的卡片
- **WHEN** 渲染设置页
- **THEN** 存在 `data-provider="opencode-go"` 的分区，其中有该用量卡片而没有模型行；`group/ds` 只出现在「路由组」分区

#### Scenario: 路由组分区说明与无编辑控件
- **GIVEN** 网关目录含 `group/ds`
- **WHEN** 渲染设置页
- **THEN** 「路由组」分区含说明文本（中文界面为「在 Magpie 中新建和编辑路由组；这里决定是否在 DSH 显示及默认推理强度」）；该分区内的控件只有可见性勾选框、默认 effort 下拉与「恢复跟随网关列表」按钮

### Requirement: DSH 侧默认 effort
用户 SHALL 能为每个 `reasoning_levels` 非空的模型设置或清除一个默认 effort。默认 effort 保存在 DSH 侧，作为该模型的 `reasoning.defaultEffort` 下发给 DSH。

设置时，取值 SHALL 属于该模型当前的 `reasoning_levels`，否则以 400 拒绝。已保存的值因网关目录变化而不再属于当前档位时，SHALL NOT 下发，但存储中保留该值；网关恢复该档位后，SHALL 重新下发。没有设置默认值的模型，SHALL NOT 下发 `defaultEffort`。设置页的默认 effort 下拉在未设置时 SHALL 显示「默认：不指定」（英文 `Default: not set`），已设置时显示所选档位。路由入口与普通模型适用同一规则。

#### Scenario: 设置与清除
- **GIVEN** `codex/gpt-6.1-sol` 的 `reasoning_levels` 含 `high`
- **WHEN** 客户端把其默认 effort 设为 `high`，解析一次模型信息；然后清除，再解析一次
- **THEN** 第一次 `reasoning.defaultEffort` 为 `high`；第二次没有 `reasoning.defaultEffort`

#### Scenario: 拒绝非法档位
- **GIVEN** `opencode-go/kimi-k3` 的 `reasoning_levels` 为 `["max"]`
- **WHEN** 客户端把其默认 effort 设为 `low`
- **THEN** 响应状态为 400，已保存的默认值不变

#### Scenario: 档位失效时不下发，恢复后重新下发
- **GIVEN** 已保存 `codex/gpt-6-astra` 的默认值 `ultra`
- **WHEN** 网关目录中该模型的 `reasoning_levels` 先变为不含 `ultra`，之后又恢复含 `ultra`，每次变化后各解析一次
- **THEN** 第一次没有 `reasoning.defaultEffort`；第二次为 `ultra`

#### Scenario: 下拉文案与路由入口
- **GIVEN** `group/cheap-first` 的 `reasoning_levels` 为 `["low","high","max"]` 且未设置默认值；`claude/claude-fable-5-2` 的 `reasoning_levels` 为 `["low","high"]` 且设置了 `high`；界面语言为中文
- **WHEN** 渲染设置页，然后把 `group/cheap-first` 设为 `high` 并解析一次模型信息
- **THEN** 渲染时 `group/cheap-first` 的下拉显示「默认：不指定」，`claude/claude-fable-5-2` 的下拉显示 `high`；设置后 `group/cheap-first` 的 `reasoning.defaultEffort` 为 `high`
