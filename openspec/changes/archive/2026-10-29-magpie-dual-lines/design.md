## Context

`packages/dsh-magpie-connector` 当前以单个 `baseUrl` + 全局 Access 凭据连接一个 Magpie 网关：[settings.ts](../../../packages/dsh-magpie-connector/src/host/settings.ts) 保存 `baseUrl`、可见性、默认 effort 与 `credentialUpdatePending`；[runtime.ts](../../../packages/dsh-magpie-connector/src/host/runtime.ts) 以「规范化地址 + key/Access 凭据指纹」作为连接身份并在变化时换代；[transport.ts](../../../packages/dsh-magpie-connector/src/host/transport.ts) 用 `identity.baseUrl` 做原产地与白名单校验，Access 有值时强制 https；[adapter.ts](../../../packages/dsh-magpie-connector/src/host/adapter.ts) 与 [cards.ts](../../../packages/dsh-magpie-connector/src/host/cards.ts) 直接读 `gen.baseUrl`；设置页 [SettingsPage.ts](../../../packages/dsh-magpie-connector/src/client/SettingsPage.ts) 是一个平铺的连接表单。

会移动的 DSH Host 需要两条到达同一 Magpie 的线路：家里局域网（http、直连、home key）与公网（https、Cloudflare Access、company key）。现状必须手工改地址并可能清空/重填 Access，且每次改地址都换代清空目录与卡片；在家绕 Cloudflare 还会触发 D014 的 125 秒边缘超时（见 [排查记录](../../../packages/dsh-magpie-connector/docs/cloudflare-524-long-requests.md)）与额外的建连时延。

约束：不新增基础设施或依赖（探测用 `node:net`，随机 id 用 `node:crypto`）；不新增后台定时轮询；保留既有 operation 捕获、换代丢弃、脱敏、传输白名单与重试分工等不变量；**本 change 是有意的 BREAKING 升级**：只保留 `lines[]` 一种设置格式，旧 `settings.json` / 旧凭据引用不读取、不迁移，升级后由用户重新配置。测试沿用本机 mock 网关与 undici `MockAgent` 方案。

## Goals / Non-Goals

**Goals:**
- 设置模型升级为**唯一格式**「线路列表」：通常 1 条、上限 5 条（首次安装为空列表，添加第一条后正常使用），每条线路是地址 + key + 接入方式（含 Access）的完整配置，数组顺序即优先级。
- 每次操作开始时按序号自动选择可达线路；单线路零探测、零行为变化。
- 线路 id 为 host 创建的 8 位随机 hex，稳定且与可变字段/序号解耦；所有线路统一使用派生凭据引用。
- 线路切换不闪断模型目录；只清空按 key 作用域变化的卡片；切换后以新线路重同步目录。
- Access 按线路配置、只发往启用线路的 https 地址；明文 http 线路永不携带服务令牌。
- 设置页默认只展开 active 线路，其余折叠；生效线路序号后 4×4 绿色方块为唯一图形化 active 提示；info 图标说明优先级。
- 不读取旧配置/旧凭据；CHANGELOG/README 标注 BREAKING 与重配步骤。
- spec 与实现同步：`dsh-magpie-connector`、`magpie-access-auth` 更新，新增 `magpie-line-selection`；随包发布的文档/截图一并更新。

**Non-Goals:**
- 手动选择 / 强制指定线路（低频排障能力，本期不做；见 D9 的扩展点）。
- 移动旧版单地址配置或旧凭据引用（有意不做：单一格式优先）。
- 改变 Magpie、Cloudflare 或 home-substore 侧任何配置；不实现 D014 的家庭侧 524 保活中继。
- 校验或支持多条线路指向不同网关：同一 Magpie 网关是配置契约（插件无法机械校验），在设置页提示。
- 插件级代理、后台健康检查定时器、探测结果持久化、生成请求换线/重放。
- 修改 DSH 重试策略或生成失败分类；不新增 auto-model-routing delta（切换窗口内 AUTO 的实时性退化以 Risks 记录）。

## Decisions

### D1 线路 = 完整连接配置，数组顺序 = 优先级

设置中的线路是有序数组，每条含稳定随机 id、地址、接入方式（`direct` / `cloudflare`）；序号由数组下标派生。添加线路追加到末尾，上移 / 下移（以及后续可能的拖拽）只重排数组，不改变 id 与凭据引用。上限 5 条，超出 400。

替代方案：固定「主/备」两个槽位（否决：用户要 N 条与序号语义）；以名称 map 保存线路（否决：排序仍需数组）。

### D2 单一设置 schema、随机稳定 id 与凭据引用

```jsonc
{
  "lines": [
    { "id": "a1b2c3d4", "baseUrl": "http://114.114.114.223:3425/v1", "accessMode": "direct" },
    { "id": "9f0e7d6c", "baseUrl": "https://api.prgrmrwy.com/v1", "accessMode": "cloudflare" }
  ],
  "visibleModels": {}, "defaultEfforts": {}
}
```

- **唯一格式**：顶层只有 `lines: LineSettings[]`（可空数组）、偏好与 `credentialUpdatePending`。没有 `baseUrl`、没有 `nextLineId`、没有兼容镜像。
- **随机稳定 id**：host 在创建线路时用 `crypto.randomBytes(4).toString('hex')` 生成 8 位小写 hex，并与现存线路（含 pending 中记录的未提交 id）去重；id 只存 settings，不在 UI 展示（UI 只显示序号）。id SHALL NOT 从地址/key/接入方式派生，排序、删除、宿主重启都不改变剩余线路的 id。测试可注入确定性的 `newId()` seam。
- **加载校验（fail-closed）**：读取持久化设置时整体校验——id 必须匹配 `^[0-9a-f]{8}$` 且大小写折叠后去重、线路数 ≤5、地址合法且非空地址唯一、`accessMode` 合法、pending 形状合法。任一条不满足即把连接配置整体视为空（未配置）：不发起网关请求、不解析/发送线路凭据、不删除旧 settings 内容。
- **凭据引用**：所有线路一律 `MAGPIE_LINE_<ID>_API_KEY` / `MAGPIE_LINE_<ID>_ACCESS_CLIENT_ID` / `MAGPIE_LINE_<ID>_ACCESS_CLIENT_SECRET`（`<ID>` 为大写 id），不存在 `MAGPIE_API_KEY` 特例；排序/删除/重启不改变引用；删除线路后其引用只可能通过 pending 清理被 unset，不再被任何线路读取。
- **旧配置/旧凭据**：`lines` 缺失或非法时视为空配置；`baseUrl`、`MAGPIE_API_KEY`、`MAGPIE_ACCESS_*` 一律不读取、不迁移、不提示保留。升级后用户在设置页重建线路；旧 credential 记录可由用户自行删除。
- 删除线路：先清除该线路可写凭据再提交 lines（见 D3）；env 凭据保留并在顶层 `retainedCredentials` 中列出。

替代方案：顺序数字 id + 持久计数器（否决：与「序号=优先级」产生认知耦合，且需要额外复用规则）；内容哈希 id（否决：改地址/key 会改变 id 并重绑凭据）。

### D3 设置 API 契约（仅 lines）与写入隔离

`GET settings` 返回：`lines: [{id, baseUrl, accessMode, key:{configured,writable}, access:{clientId:{configured,writable},clientSecret:{configured,writable}}, refs:{key,accessClientId,accessClientSecret}, complete, missing?}]`、`activeLineId`（无完整线路时为 null）、`pending: [{lineId, field}]`、`retainedCredentials: [{lineId, field}]`（每次响应按当前 credentials 状态重算：仅包含此前删除时未能清除、当前仍 configured 且不可写的引用）、同步状态、分组、可见性、默认 effort。`resync: true` 表示本次保存后强制一次目录同步（即使生效线路未变；仅提交 `{resync:true}` 也合法）；POST 成功返回与 GET 相同的设置视图。pending 期间设置读取仍可用，但只返回状态，不探测、不换代、不同步。

`POST settings` 只接受：

```jsonc
{
  "lines": [
    { "id": "a1b2c3d4", "baseUrl": "http://...", "accessMode": "direct",
      "key": "secret" | null,
      "accessClientId": "..." | null, "accessClientSecret": "..." | null }
    // 新线路省略 id，由 host 生成随机 id 并在响应返回
  ],
  "resync": true
}
```

- 未完整线路以 `baseUrl: ""` 表示；空地址不参与重复校验。`accessMode` 必填枚举。凭据字段三态：省略 = 保持现有值；`null` = 清除（仅限可写引用）；字符串 = 写入。整表提交/排序省略凭据时不得清除或改动该线路凭据。`lines` 数组必须非空（0 条只能来自加载/首次安装；UI 在空态下添加第一条后提交）。
- 写前整体校验：地址格式 / 非空地址唯一、Access 成对且合法且 https、凭据可写性、线路数 ≤5、最后一条不可删；line id 规则：新线路必须省略 id、既有 id 必须引用现存线路、id 不得重复，未知 / 重复 / 新线路带 id 一律 400 零写入；`accessMode=direct` 时提交非空 Access 值 400；Access 来自启动环境时修改接入方式 409（同值重复提交不视为修改）。任一失败零写入。
- **写入隔离 v2**：pending 标记为 `[{lineId, field}]`；任何凭据写入前持久化 pending，全部成功后才提交 lines 与移除标记。删除线路 / 切回直连时先 `unset` 可写凭据，任一失败则不提交变更、返回 `MAGPIE_SETTINGS_WRITE_FAILED` 并保留 pending；重启重建 runtime 时带 pending 拒绝网关操作与同步，但设置读取仍可用并返回 pending / retainedCredentials。**完整重试** = 提交整表 lines：先按三态处理 lines 内字段，再对 pending 中不属于已提交 lines 的 `(lineId, field)` 自动清理（可写引用 unset，env 引用记入 `retainedCredentials`）；全部成功后才清 pending 并恢复操作。新建线路写凭据前把其随机 id 写入 pending；lines 提交失败时该 id 不会分配给未来线路（随机生成），下一次成功提交不含该 id 的整表 lines 时会按 pending 自动 unset 其已写凭据。
- 不提供旧平铺 API（`{baseUrl, key, accessClientId…}`）兼容：客户端与 host 同包发布，直接使用上面的 lines 契约。

### D4 生效线路、自动选择与探测实现

**生效线路定义**：最近一次操作（含设置读取）的选择结果，保存在 host 内存；启动初值为按序号排序的第一条完整线路；无完整线路时 active 为空（`activeLineId: null`，按未配置处理）。设置读取本身执行一次选择（可用缓存，不发 HTTP），只更新内存中的选择与 activeLineId，不换代、不清目录、不触发同步；线路切换的实际效果在下一次需要网关的身份操作开始时应用。

**选择**：完整线路列表按序号；仅 1 条 → 直接使用，不探测；≥2 条 → 按序号探测，跳过负缓存未过期的线路，第一个可达即生效；全部失败/被负缓存标记 → 使用序号 1 的完整线路发起真实请求，错误如实上抛。原始请求失败不由插件换线（见 D8）。

**探测实现**：`node:net`，显式计时器 + `socket.destroy()`，截止 ≤600ms 且覆盖 DNS 解析阶段；IPv6 字面量去方括号；端口取 URL 端口或 http 80 / https 443。

**缓存**：只存在 host 内存。键 = `(lineId, 规范化地址, accessMode, port)`；可达 10s、不可达 15s。线路地址/接入方式保存、线路删除、连接阶段失败、dispose 时失效对应缓存并 abort pending 探测。无后台活动。

替代方案：后台定时健康检查（否决：新增常驻网络活动）；先发真实请求失败后再换线（否决：每次移动先付一次失败/超时）；按网卡/子网判断（否决：WSL/NAT 不可靠）。

### D5 身份、换代与线路切换

`Generation` 增加 `lineId`。身份指纹 = `hash(lineId, baseUrl, accessMode, keyFingerprint, accessFingerprint)`，只算**生效线路**。

每次需要网关的身份操作开始时：

1. 先按 D4 确定生效线路，再解析该线路 key/Access，得到候选身份。
2. 候选身份 ≠ 当前代身份：
   - `lineId` 不同（自动切换、删除生效线路、排序改变生效线路）→ **线路切换**：新建代并继承上一代目录作为初始缓存（含 `lastSyncAt`）、清空卡片、失效旧请求；以新线路同步，成功原子替换，失败保留继承目录并记 `lastSyncError`。
   - `lineId` 相同但地址/接入方式/key/Access 变化（保存或外部事件）→ **身份变化**：新建代、清空目录与卡片、立即同步。
3. 相同 → 复用当前代；不触发同步。

**凭据事件映射**：`credentials/reference-updated` 到达时把引用映射到线路 id（`MAGPIE_LINE_<ID>_*` → `<ID>`；其它引用忽略）。只有映射到当前生效线路才换代；非生效线路只失效设置视图；映射不到现存线路的引用忽略。

**非生效线路变化**（编辑、增删、排序但生效线路不变）不换代、不清目录/卡片、不触发同步。

**继承目录的权威性**：继承目录用于选择器/设置页展示与模型 id 解析；窗口内生成真实发往当前生效线路，成功/失败如实反映；同步失败时窗口持续到下一次成功（Risks 记录 AUTO 实时性在此期间基于继承目录）。卡片始终随线路切换清空。

**实现改动**：`adapter.dispatch` 与 `cards.send` 使用捕获的 `op.baseUrl` / `op.key`；`gen.baseUrl` 由 `gen.lineId` 替代；`rotate()` 增加 `carry?: { catalog; lastSyncAt? }`；`invalidateCredential(ref)` 按 ref→lineId 映射判断；`src/index.ts` 订阅所有凭据事件并交给该映射。

替代方案：为目录/卡片另加 line-epoch 守卫共享同一代（否决：回归面更大）；每次配置写入都换代（否决：加备用线路会清空目录）。

### D6 Access 按线路、按线路发送与脱敏

- 每条线路持久化 `accessMode: direct | cloudflare`。
- 校验：`cloudflare` 线路地址必须 https、Access 成对合法；否则 400 零写入。cloudflare 线路凭据缺失 → 线路未完整、不参与选择、设置页标注；不自动降级 direct。
- `ConnectionIdentity` 增加 `accessMode` / `lineId`；transport 仅在该线路 `cloudflare` 且 https 时附加 Access，direct/http 线路删除调用方传入的任何 Access 头。
- 脱敏集合 = 所有现存线路解析到的 key + Access（设置 GET 与每次操作刷新）；删除线路后遗留的 env 凭据不再属于已配置线路，不进入脱敏集合，也不会被发送。prepared 操作凭据由 `trackPrepared` 的 WeakRef 集合 + active 引用共同覆盖。

### D7 设置页

- 线路卡片列表；打开时仅展开 `activeLineId` 卡片，其余折叠一行（序号 + 地址 hostname + 展开入口）。卡片根 `data-line-id`、`data-expanded`；0 条时显示空态与「添加线路」入口。
- active 序号后 4×4 px 绿色方块，`aria-label="当前线路"`、`data-active-line="<线路 id>"`（8 位 hex）；非 active 不渲染。
- 「连接」标题旁 info 图标（hover/focus 文案见 spec）；不提供手动强制入口；线路切换不弹提示（不新增 `role=alert/status`、`aria-live`）。
- 添加 / 上移 / 下移 / 删除只在卡片或列表尾部；最后一条删除入口禁用。无叠加的旧「清除 key」入口：key 清空通过线路卡片内留空并保存（或一次性重填）表达，host 的 `key:null` 仅在显式线路提交中可用。
- 不新增轮询；打开页面时 `GET settings`（含选择）→ `GET cards`（一次操作）→ 展示。
- 客户端把 `activeLineId`、`complete`、凭据状态渲染为文本/图标；秘密不回显。

### D8 失败边界：不换线、不重放

- transport 捕获连接阶段错误（`ENOTFOUND` / `EAI_AGAIN` / `ECONNREFUSED` / `ETIMEDOUT` 建连阶段 / `UND_ERR_CONNECT_TIMEOUT`）时标记 `connectionPhase` 并让 runtime 失效该线路探测缓存；错误照常上抛，本次操作失败，**不重试、不换线**。`ECONNRESET` / `UND_ERR_SOCKET` 等无法证明请求未发出的错误不标记。
- HTTP 错误、流中断、鉴权失败一律不换线不重放；生成重试由 DSH `llm-retry` 负责，下一次 attempt 重新选择。
- 逃生口：TCP 可达但服务/凭据坏时请求如实失败；用户可在设置页编辑、调整顺序或删除该线路。

### D9 手动选择（Non-goal）的扩展点

`selectLine(overrides?: { pinnedLineId?: string })` 保留可选参数；设置 schema 不引入 `pinnedLineId`、API 不接受该字段。后续版本加持久化字段 + 设置页低调的模式菜单即可。

### D10 随包发布资产

设置页与设置 API 变化后需更新：`docs/architecture.{zh,en}.{json,svg}`、`screenshots.json`、`docs/SCREENSHOTS.md`、`docs/internal-api.md`（lines 契约与 ref→lineId 订阅规则）、包 `README.{md,zh.md}`（BREAKING 升级与重配步骤、行为）、`CHANGELOG.md`（0.2.0 BREAKING）、`dsh.yaml` 版本与 note、根 `README.{md,zh.md}` 插件能力描述。旧设置页录屏删除，重录留待人工；验收含 `npm pack` 产物检查。

### D11 测试策略

- 探测：向 runtime 注入探测函数与时钟；不可达线路用未监听端口；IPv6 用 `::1` 监听。
- https + Access：沿用 undici `MockAgent` + `disableNetConnect`。
- 设置页：fake `Api` 使用 lines 形状；断言 `data-line-id` / `data-expanded` / `data-active-line` / info 文案 / 请求体结构。
- 随机 id：断言格式 `[0-9a-f]{8}`、去重、排序/重启后不变；新建线路由 host 分配。测试通过注入确定性 `newId()` seam 固定 id，既有测试夹具统一使用合法 8 位 hex id。
- pending：用可失败 credentials mock 覆盖部分失败与重启恢复。
- 时间：缓存 TTL 与超时用 `vi.useFakeTimers` / `vi.setSystemTime`。
- 既有测试改写：所有单线路 fixture 从 `{baseUrl}` 改为 `{lines:[...]}` + 派生凭据引用；`tasks.md` 按「schema/凭据/随机 id → 按线路 Access → 身份/继承 → 探测/选择 → UI/发布资产」分层，每层独立回归门。

## Risks / Trade-offs

- [BREAKING 升级：旧 settings/旧凭据被忽略，用户必须重配] → CHANGELOG/README 给出一句话升级步骤；插件首次打开即为未配置状态，不静默使用旧字段。
- [不同线路 key 的模型目录可能不一致] → 不假设一致：目录以生效线路为准；切换继承旧目录避免闪断，新线路同步成功后替换。
- [继承目录窗口内 AUTO 的实时能力判定基于旧线路目录] → 窗口通常秒级；同步失败时窗口延长，生成发往当前线路并如实成功/失败。
- [TCP 探测误判（端口通但服务坏）] → 不做自动换线；错误如实上抛，用户可编辑/删除/调整顺序作为逃生口。
- [身份与换代重构回归面大] → 保留 `bgAbort` + `isCurrent` 中止/丢弃机制，只改身份指纹来源与新代目录初值。
- [删除线路误删环境凭据 / 部分失败遗留 orphan] → 只 unset 可写引用；失败不提交变更、pending 重启隔离；env 引用保留并列入 `retainedCredentials`。
- [随机 id 碰撞 / 手改 settings 重复 id] → 创建时与现存（含 pending）id 去重；写入与加载两侧都拒绝未知/重复/非法格式 id（加载时整体视为未配置）。
- [多线路探测叠加时延] → 单线路不探测；正/负缓存 + 最多 5 条线路，首次可达即停。
- [工区仍受 Cloudflare 524] → 本 change 不解决；D014 的家庭侧中继正交推进。

## Migration Plan

1. 版本 0.2.0（`package.json` / `dsh.yaml`），CHANGELOG 标 **BREAKING**：设置格式改为 `lines[]`，凭据引用改为每线路派生；**不自动迁移**。
2. 升级后旧 `settings.json`（只有 `baseUrl`）与旧 credential 引用被忽略；插件显示未配置。
3. 用户在设置页添加线路、填地址与每线路 key/Access，保存后同步目录。
4. 旧的 `MAGPIE_API_KEY` / `MAGPIE_ACCESS_*` 记录不再被读取，可由用户按需从 credentials 删除。
5. 回滚：部署旧版本需要同时恢复旧格式 `settings.json` 与旧凭据引用；没有自动降级路径。
6. 验收：单线路回归（既有测试已改写为 lines 夹具）；双线路在「线路 1 不可达」环境自动落线路 2；在家 smoke 走 LAN；回工区自动回公网；`npm pack` 资产检查。

## Open Questions

- 两把 key 的 `/v1/models` 是否一致尚未实测；不一致时切换线路的模型列表会更新为当前线路视图（本设计接受，不做交集/并集）。
- 探测缓存 TTL（正 10s / 负 15s）与 600ms 截止为初始值，实现后按真机体验微调。
- 设置页是否需要显示「最近一次探测时间 / 是否发生过回退」：本期定为一律不显示（用户要求静默），后续可加 tooltip。
