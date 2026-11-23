## MODIFIED Requirements

### Requirement: 插件身份与命名

插件的 package/npm 名、Cordis 插件 id 与设置目录 SHALL 统一为 `dsh-magpie-connector`。插件 SHALL 只注册**归属 route** `dsh-magpie-connector-<owner>`，每个网关归属一个（规则见「按网关归属注册 route」）；SHALL NOT 再注册 `dsh-magpie-connector` 这个 LLM route，也 SHALL NOT 提供任何旧 route 的兼容别名。此前保存在 `dsh-magpie-connector` 上的会话与默认选择不再可用，用户需在选择器中重选模型。

每条线路 SHALL 有 host 在创建时生成的随机 id：8 位小写十六进制（来自 `node:crypto` 的随机字节），创建时与现存线路去重；id 只保存在设置中、不在 UI 展示（UI 只显示由数组顺序派生的序号），且 SHALL NOT 从地址、key 或接入方式派生。排序、删除与宿主重启 SHALL NOT 改变剩余线路的 id。

凭据引用 SHALL 由线路 id 决定，而不是由当前序号决定：所有线路 SHALL 使用 `MAGPIE_LINE_<ID>_API_KEY`、`MAGPIE_LINE_<ID>_ACCESS_CLIENT_ID`、`MAGPIE_LINE_<ID>_ACCESS_CLIENT_SECRET`（`<ID>` 为线路 id 的大写形式）。排序、删除与宿主重启 SHALL NOT 改变剩余线路的凭据引用。插件 SHALL NOT 读取旧版固定引用 `MAGPIE_API_KEY`、`MAGPIE_ACCESS_CLIENT_ID`、`MAGPIE_ACCESS_CLIENT_SECRET`，也 SHALL NOT 读取未按线路声明的其它凭据引用。所有本插件 route SHALL 共用同一组线路、凭据与生效线路选择。

依赖真实 route id 的其它能力（AUTO 策略、出口守卫豁免列表、侧边栏品牌识别）如何适配归属 route，由各自的 capability 规定，不属于本 requirement。

#### Scenario: 只注册归属 route

- **GIVEN** 线路 `a1b2c3d4` 的 `MAGPIE_LINE_A1B2C3D4_API_KEY` 已配置，网关目录含 `owned_by` 为 `claude` 与 `codex` 的模型
- **WHEN** 插件启动并完成目录同步
- **THEN** DSH 的 provider 列表中本插件恰好注册 `dsh-magpie-connector-claude`、`dsh-magpie-connector-codex`，不含 `dsh-magpie-connector`；在任一 route 上生成都解析该线路的 key

#### Scenario: 旧 route 选择不再可用

- **GIVEN** 原版 DSH 0.2.0-rc.2 宿主，插件已同步出 `dsh-magpie-connector-codex`，一个会话保存的选择为 provider `dsh-magpie-connector`、model `codex/gpt-6.1-sol`
- **WHEN** 直接调用宿主 `ctx.llm.prepareCall({provider: "dsh-magpie-connector", model: "codex/gpt-6.1-sol"})`，并读取 `session/modelCatalog`
- **THEN** `prepareCall` 以 code `NO_ADAPTER` 拒绝；目录 `groups` 中没有 id 为 `dsh-magpie-connector` 的组；网关 mock 没有收到生成请求

#### Scenario: 凭据引用由稳定 id 绑定

- **GIVEN** 两条线路：id=`a1b2c3d4` 使用 `MAGPIE_LINE_A1B2C3D4_API_KEY`（值 K1），id=`9f0e7d6c` 使用 `MAGPIE_LINE_9F0E7D6C_API_KEY`（值 K2）
- **WHEN** 把 id=`9f0e7d6c` 的线路移到序号 1 并保存，然后分别通过探测 mock 使该线路/另一线路成为唯一可达线路并以之发起生成
- **THEN** 两条线路仍按各自的 id 读取原引用；两个请求的 `Authorization` 分别为 `Bearer K1` 与 `Bearer K2`，没有任何线路改用对方的 key 或旧版固定引用

### Requirement: Codex 速度切换

对网关目录中 `service_tiers` 含 id `priority` 的模型，当前选择的 provider 为任一本插件归属 route 时，输入框右侧 SHALL 显示「速度」选择（标准 / 快速）。

速度状态 SHALL 只在 host 进程内存中保存「选择了快速」的会话集合：默认为标准；选标准时从集合中移除；host 重启后全部恢复为标准。

生成时：会话在快速集合中、且请求模型支持 `priority`，请求体带 `service_tier: "priority"`；其它情况请求体不含 `service_tier` 键。当前模型不支持 `priority`，或当前 provider 不是本插件 route 时，速度控件 SHALL 不显示。设置速度时，`tier` 不是 `standard` 或 `fast` 的请求 SHALL 被拒绝（400）。

#### Scenario: 快速模式请求带 priority（两种协议）
- **GIVEN** 会话 S 设为快速；Responses 模型 `codex/gpt-6.1-sol` 与一个 `native_endpoints` 为空、`service_tiers` 含 `priority` 的 Chat 模型
- **WHEN** S 分别用这两个模型各发送一条消息
- **THEN** `POST /v1/responses` 与 `POST /v1/chat/completions` 的请求体都含 `"service_tier": "priority"`

#### Scenario: 归属 route 上显示速度控件
- **GIVEN** 当前选择为 provider `dsh-magpie-connector-codex`、model `codex/gpt-6.1-sol`，该模型 `service_tiers` 含 `priority`
- **WHEN** 渲染输入框
- **THEN** 速度控件在 DOM 中；把选择换成 provider `codex`（本插件以外的 route）的同名模型后，速度控件不在 DOM 中

#### Scenario: 标准模式与其它会话不带字段
- **GIVEN** 会话 A 设为快速，会话 B 从未设置
- **WHEN** B 用 `codex/gpt-6.1-sol` 发送一条消息；然后 A 改回标准，也发送一条
- **THEN** 这两次请求体都不含 `service_tier` 键

#### Scenario: 不支持的模型不显示且不带字段
- **GIVEN** 会话 S 在 Codex 模型上选了快速，随后切换到 `deepseek/deepseek-flash`
- **WHEN** 渲染输入框，然后 S 发送一条消息
- **THEN** 速度控件不在 DOM 中；请求体不含 `service_tier` 键

#### Scenario: host 重启后回到标准
- **GIVEN** 会话 S 设为快速
- **WHEN** 重建速度控制器（模拟 host 重启）后，S 用 `codex/gpt-6.1-sol` 发送一条消息
- **THEN** 请求体不含 `service_tier` 键

#### Scenario: 非法 tier 被拒绝
- **GIVEN** 会话 S 处于标准
- **WHEN** 客户端为 S 设置速度 `turbo`
- **THEN** 响应状态为 400，S 仍为标准

### Requirement: 网关连接与凭据

插件 SHALL 支持 0–5 条「连接线路」（首次安装为空列表，添加后通常 1 条，最多 5 条；详见 `magpie-line-selection`）。每条线路是一套完整连接配置：带版本段的 `http(s)` API 根地址、该线路的 gateway key、接入方式（见「连接接入方式（AMD4）」）。线路按设置中的数组顺序排列，序号即自动选择优先级，详见 `magpie-line-selection`。所有线路预期指向同一个 Magpie 网关（这是使用假设，插件不机械校验，也不承诺支持多网关语义）。

网关地址 SHALL 是带版本段的 `http(s)` API 根（例如 `http://114.114.114.223:3425/v1`），末尾斜杠会被去掉。地址 SHALL NOT 包含 userinfo、query 或 fragment；已配置的非空地址之间 SHALL NOT 相同，否则拒绝。未完整配置的线路以空字符串地址表示，空地址不参与重复校验。

一条线路是「完整」的，当且仅当：地址非空、该线路 key 可解析、且若接入方式为 Cloudflare Access 则地址为 https 且两项 Access 凭据均可解析。至少一条线路完整时插件视为已配置；否则视为未配置：所有已注册的本插件归属 route 的模型目录都为空，在任一归属 route 上生成都以 `kind: error` 结束且 failure 消息包含 `MAGPIE_NOT_CONFIGURED`，不向任何网关地址发起请求。未完整的线路 SHALL NOT 参与自动选择。

持久化设置在加载时 SHALL 做整体校验：线路 id 必须匹配 `^[0-9a-f]{8}$` 且大小写折叠后不重复、线路数 ≤5、每条线路地址合法且非空地址唯一、`accessMode` 合法、pending 条目形状合法。任一条不满足时，插件 SHALL 把整份持久化连接配置视为空（视为未配置）：不向任何地址发起请求、不解析或发送任何线路凭据、不删除旧 settings 内容，并在设置响应标记需要重新配置。

key SHALL 通过 DSH credentials 服务按线路引用存取（引用规则见「插件身份与命名」）。每个操作开始时解析一次生效线路的 key 与该线路的 Access 凭据，同一操作的后续请求复用该值。一个操作指一次目录同步、一次卡片读取或刷新、一次生成（从 `prepareCall` 到流结束），或一次设置读取（设置读取只做线路选择并更新 `activeLineId`，不换代、不同步、不向网关发起 HTTP 请求）。

lines 元素的凭据字段语义 SHALL 为：省略 = 保持该线路现有值；`null` = 清除（仅限可写引用）；字符串 = 写入。整表提交、排序或编辑其它字段时省略凭据 SHALL NOT 清除或改动该线路凭据。

设置响应 SHALL 按线路返回每项凭据的 `configured` / `writable` 状态及其凭据引用名（`refs.key` / `refs.accessClientId` / `refs.accessClientSecret`，不含值）；删除线路时未能清除的凭据 SHALL 在顶层 `retainedCredentials: [{lineId, field}]` 中列出（不含明文，`field` 取 `key` / `accessClientId` / `accessClientSecret`，可包含已删除线路 id）。插件的任何 HTTP 响应、插件设置文件和日志 SHALL NOT 包含任何线路的 key 或 Access 明文。网关返回的任何文本在进入插件的 HTTP 响应或日志之前 SHALL 先脱敏：把所有已配置线路的 key 与 Access 值原文替换为 `[redacted]`。这些文本包括卡片字段、错误原因和生成错误。key 或 Access 凭据来自启动环境（不可写）时，SHALL 拒绝通过插件覆盖或清除该引用。

删除线路 SHALL 移除该线路的设置；该线路可写的 key / Access 凭据 SHALL 一并清除；来自启动环境的凭据 SHALL 保留并在顶层 `retainedCredentials` 中列出。

#### Scenario: 保存 key 后不回显

- **GIVEN** credentials 服务可写，线路 `a1b2c3d4` 的 `MAGPIE_LINE_A1B2C3D4_API_KEY` 未配置
- **WHEN** 客户端为该线路提交 key `mk-test-123`，然后读取设置
- **THEN** 设置响应中该线路的 key 为 `{configured: true, writable: true}`；该响应体、插件设置文件和插件日志输出中都不出现 `mk-test-123`

#### Scenario: 网关反射的 key 被脱敏

- **GIVEN** 线路 1 的 key 为 `mk-1`，线路 2 的 key 为 `mk-2`；网关 mock 的卡片端点返回 `{data: [{provider: "codex", error: "invalid Bearer mk-1"}], debug: {authorization: "Bearer mk-2"}}`，`/v1/responses` 返回 401 且 body 同时含 `mk-1` 与 `mk-2`
- **WHEN** 读取卡片并基于生效线路发起一次生成
- **THEN** 卡片 HTTP 响应不含 `debug` 字段；卡片 `error` 为 `invalid Bearer [redacted]`；生成的 failure 消息、卡片响应和插件日志中都不出现 `mk-1` 或 `mk-2`

#### Scenario: 环境提供的 key 拒绝修改

- **GIVEN** credentials 服务对生效线路的 key 引用报告 `writable: false`
- **WHEN** 客户端提交新 key 或提交清除 key
- **THEN** 响应状态为 409，credentials 服务的 `set` / `unset` 都未被调用

#### Scenario: 非法设置输入被拒绝

- **GIVEN** 已保存线路 1 地址 `http://114.114.114.223:3425/v1` 与 key，线路 2 地址 `https://api.example.com/v1`
- **WHEN** 客户端分别提交：空串 key、含空白的 key、超过 512 字符的 key、线路地址 `ftp://host/v1`、地址 `http://u:p@host/v1`、地址 `http://host/v1?k=x`、与另一条线路相同的非空地址
- **THEN** 每次响应状态都为 400，credentials 服务未被调用，已保存的线路配置不变

#### Scenario: 未配置时不提供模型且不发请求

- **GIVEN** 没有任何完整线路；`knownOwners` 为 `["claude"]`，因此已注册 `dsh-magpie-connector-claude`
- **WHEN** DSH 列举 `dsh-magpie-connector-claude` 的模型，并以该 route 发起一次生成
- **THEN** 模型列表为空；生成以 `kind: error` 结束，消息包含 `MAGPIE_NOT_CONFIGURED`；所有网关 mock 收到的请求数都为 0

#### Scenario: 手改或损坏的持久设置被整体拒绝

- **GIVEN** settings 文件被手改成包含重复 id（或大写 id、6 条线路、重复非空地址、非法 pending 形状）之一，旧凭据引用仍在 credentials 中
- **WHEN** 插件启动、读取设置并列举模型
- **THEN** 设置响应中 `lines` 为空数组、`activeLineId` 为 null、模型目录为空；网关 mock 收到 0 个请求；旧 settings 文件字节不变，且响应与日志中不出现旧凭据明文

#### Scenario: 请求不混用线路凭据

- **GIVEN** 两条线路都完整，探测 mock 判定线路 1 不可达、线路 2 可达（生效线路为线路 2），线路 2 配置了 Access 凭据
- **WHEN** 基于线路 2 发起一次生成
- **THEN** 请求只发往线路 2 的地址，`Authorization` 使用线路 2 的 key，Access 头使用线路 2 的凭据，且请求中不出现线路 1 的任何凭据值

#### Scenario: 删除线路只清可写凭据

- **GIVEN** 线路 `a1b2c3d4` 完整；线路 `9f0e7d6c` 完整且其 key / Access 可写；线路 `0badf00d` 完整、key 与两项 Access 均来自启动环境（只读），线路 `9f0e7d6c` / `0badf00d` 接入方式为 cloudflare
- **WHEN** 删除线路 `9f0e7d6c` 与线路 `0badf00d`
- **THEN** `9f0e7d6c` 的 key / Access 引用被清除；`0badf00d` 的环境凭据未被 `unset`，设置响应顶层 `retainedCredentials` 恰含 `{lineId:"0badf00d", field:"key"}`、`{lineId:"0badf00d", field:"accessClientId"}`、`{lineId:"0badf00d", field:"accessClientSecret"}`；`a1b2c3d4` 的凭据与配置不变

#### Scenario: 整表重排不丢凭据

- **GIVEN** 两条线路 `a1b2c3d4`（key K1）与 `9f0e7d6c`（key K2，另有一组已保存的 Access 凭据）
- **WHEN** 客户端提交整表 lines 只交换两者顺序、省略全部凭据字段并保存
- **THEN** 两条线路的 key/Access 引用保持 configured 且值不变；随后分别生成时 `Authorization` 仍为 `Bearer K1` / `Bearer K2`，Access 凭据未被清除

### Requirement: 连接身份与代际隔离

插件 SHALL 把「当前生效线路的身份」作为连接身份：生效线路的稳定 id、地址、接入方式，以及该线路 key 与 Access 凭据的指纹。线路集合、顺序与选择结果属于选择配置，单独变化 SHALL NOT 构成身份变化。插件 SHALL 为每个身份维护一个代际。

身份变化（须换代）的来源：
- 生效线路的连接配置变化：地址、接入方式、该线路 key 或 Access 凭据被保存或从外部改变；
- 收到任一凭据引用的 `credentials/reference-updated` 事件或新操作时解析出的凭据与当前代不同，且该引用映射到当前生效线路。

上述身份变化时，插件 SHALL 先换代再开始新操作：立即使上一代目录、卡片和同步状态对外不可见；不得用上一代数据回退；中止上一代发起的目录/卡片请求；丢弃上一代发起、之后才返回的目录、卡片或刷新响应；换代后立即为新身份同步目录。

生效线路变化（自动选择切换、删除生效线路、排序导致生效线路改变）不是配置编辑，插件 SHALL 按线路切换处理：使上一线路未完成的目录/卡片结果失效（不得提交）；把上一代的目录作为新代的初始缓存保留（模型列表不得变空或闪断，这是「不得回退」的唯一显式例外）；清空上一线路的卡片状态；以新线路重新同步目录，成功时原子替换目录，失败时保留初始缓存并记录 `lastSyncError`，且 `lastSyncAt` 保持上一线路最后成功时间。继承的目录只用于选择器/设置页展示与真实请求的模型 id 解析，SHALL NOT 被标记为同步成功；插件 SHALL 发布一次适配器更新让已打开的选择器继续可用。

非生效线路的变化（编辑、增删、排序但生效线路不变、其凭据被外部改变）SHALL NOT 换代、SHALL NOT 清空目录或卡片、SHALL NOT 触发目录同步，只更新设置。外部凭据事件 SHALL 按「引用 → 线路 id」映射判断：仅当映射到生效线路时按身份变化处理，否则按非生效变化处理；映射不到任何现存线路的引用事件 SHALL 被忽略。

每次生成是一个操作：`prepareCall` SHALL 捕获当时生效线路的地址、该线路 key、该线路 Access 凭据和模型能力，后续 `stream` SHALL 只使用捕获值，不重新解析凭据、不重新读取地址。线路切换或换代 SHALL NOT 中止已准备或正在进行的生成，它们按捕获值跑完；插件 SHALL NOT 为生成请求换线或重放。只有 DSH 传入的 `options.signal` 或插件 dispose 能中止生成。换代之后准备的调用 SHALL 使用新身份。

插件 SHALL NOT 把目录持久化到磁盘：上一次成功的目录只在当前代的内存中保留。

#### Scenario: 换地址后不显示旧目录

- **GIVEN** 生效线路 1 的网关 A 同步成功，有 13 个模型；网关 B 对 `/models` 返回 503
- **WHEN** 客户端把线路 1 的地址改为 B
- **THEN** DSH 列举每个已注册本插件 route 的模型都得到空列表，设置响应中 `lastSyncError` 非空；之后的生成请求只发往 B，不发往 A

#### Scenario: 换 key 后不显示旧卡片

- **GIVEN** 用生效线路 1 的 key K1 读到 3 张卡片；同一线路对 key K2 的卡片请求返回 403
- **WHEN** 客户端把该线路 key 换成 K2，然后读取卡片
- **THEN** 卡片区状态为 `forbidden`，响应中不含任何 K1 时期的卡片

#### Scenario: 旧代晚到的响应被丢弃

- **GIVEN** 生效线路对网关 A 的目录同步已发出但尚未返回
- **WHEN** 客户端把线路地址改为 B，B 同步成功并返回 2 个模型，随后 A 的响应才返回 13 个模型
- **THEN** DSH 列举到的模型恰为 B 的 2 个

#### Scenario: 已准备的调用按捕获值跑完

- **GIVEN** 用生效线路 1 与 key K1 对 `codex/gpt-6.1-sol` 完成了 `prepareCall`
- **WHEN** 客户端把线路 1 地址改为 B、key 改为 K2，然后调用该已准备对象的 `stream`；之后再准备并发起一次新的生成
- **THEN** 第一次请求发往 A，带 `Authorization: Bearer K1`，并以 `stop` 正常结束；第二次请求发往 B，带 K2

#### Scenario: 进行中的生成不被换代中止

- **GIVEN** 一次发往生效线路 1 网关 A 的生成正在输出文本
- **WHEN** 客户端把线路 1 地址改为 B
- **THEN** 该生成继续输出，直到网关 mock 发出完成事件并以 `stop` 结束；B 收到一次 `GET /v1/models`

#### Scenario: 外部改 key 触发换代

- **GIVEN** 用生效线路 1 的 K1 已同步目录并读到 3 张卡片；网关对 K2 的卡片请求返回 403
- **WHEN** 该线路在插件之外把 key 改为 K2，并发出 `credentials/reference-updated`；随后读取卡片
- **THEN** 插件换代并用 K2 发起一次 `GET /v1/models`；卡片响应状态为 `forbidden`，不含 K1 时期的任何卡片

#### Scenario: 未收到事件时新操作发现 key 变化

- **GIVEN** 用生效线路 1 的 K1 已同步目录；受控的 credentials mock 随后对 `resolve` 返回 K2，且没有发出事件
- **WHEN** 发起一次卡片读取
- **THEN** 插件在发出该卡片请求之前完成换代；卡片请求带 K2，结果提交到新代

#### Scenario: 自动切线路保留目录并清空卡片

- **GIVEN** 生效线路 1 已同步 13 个模型并读到 3 张卡片；随后线路 1 不可达、线路 2 可达
- **WHEN** 触发一次操作
- **THEN** 模型列表仍为 13 个（不清空、不闪断），卡片状态被清空；插件向线路 2 发起 `GET /v1/models`，成功后以线路 2 的结果替换目录

#### Scenario: 编辑非生效线路不换目录

- **GIVEN** 生效线路为线路 1，已有目录与卡片
- **WHEN** 客户端保存线路 2 的地址或 key（线路 1 不变）
- **THEN** 当前目录与卡片保持可见，生效线路仍为线路 1，插件不因这次写入清空目录或发起新的目录同步

#### Scenario: 删除生效线路后换线路并保留目录

- **GIVEN** 生效线路为线路 1，线路 2 完整且可达
- **WHEN** 客户端删除线路 1
- **THEN** 生效线路变为线路 2；线路 1 的卡片被清空，目录作为初始缓存保留并在线路 2 同步成功后替换，目录不闪空

#### Scenario: 非生效线路外部凭据变化不换代

- **GIVEN** 生效线路为线路 `a1b2c3d4`；线路 `9f0e7d6c` 的 key 来自 `MAGPIE_LINE_9F0E7D6C_API_KEY`
- **WHEN** 线路 `9f0e7d6c` 的 key 在插件之外被改变并发出 `credentials/reference-updated`
- **THEN** 插件不换代、不清空目录或卡片、不触发目录同步；后续以线路 `a1b2c3d4` 发起的生成不受影响

#### Scenario: 随机 id 生效线路的外部凭据事件触发换代

- **GIVEN** 生效线路为 id=`9f0e7d6c` 的线路，其 key 为 K1（来自 `MAGPIE_LINE_9F0E7D6C_API_KEY`）
- **WHEN** 该引用在插件之外被改为 K2 并发出 `credentials/reference-updated`
- **THEN** 插件换代，以 K2 发起一次 `GET /v1/models`，旧卡状态清空且 K1 时期的目录不再对外可见

#### Scenario: 切换后同步失败保留继承目录

- **GIVEN** 生效线路从线路 1 切换到线路 2，线路 2 的 `/v1/models` 返回 503，线路 1 目录有 13 个模型
- **WHEN** 切换后的目录同步失败
- **THEN** 模型列表仍为 13 个继承模型、`lastSyncAt` 仍是线路 1 的成功时间、`lastSyncError` 非空；基于该目录发起生成时请求真实发往线路 2 并按其结果成功或失败

### Requirement: 模型目录字段映射
插件 SHALL 按以下规则把网关 `GET /models` 的条目映射为模型；每个模型归入哪个归属 route 见「按网关归属注册 route」，对外返回的模型信息的 `provider` 规则见同一 requirement：
- 模型 id 保持网关返回值原样；
- 显示名取 `display_name`，缺失或为空时取 id；
- effort 档位取 `reasoning_levels`，保持网关给出的顺序和取值；
- 网关给了正安全整数的 `context_window` 时作为上下文窗口下发给 DSH；
- 网关给了正安全整数的 `max_output_tokens` 时作为该模型的**最大输出能力**保留；DSH 的 `defaultMaxTokens` 取「默认请求输出预算」规则的结果，而不是直接取最大输出能力；
- `context_window`、`max_output_tokens` 不是正安全整数时（0、负数、小数、字符串、超出安全整数）视为缺失；
- 仅当 `modalities.input` 包含 `image` 时声明可收图；
- 缺 `id` 的条目丢弃，不影响其它条目。

#### Scenario: 字段映射
- **GIVEN** 网关返回以下 3 个模型：
  - `{id: "claude/claude-haiku-5-5", display_name: "Claude Haiku 5.5", reasoning_levels: ["low","high"], modalities: {input: ["text","image"]}, context_window: 1000000, max_output_tokens: 100}`
  - `{id: "opencode-go/kimi-k3", reasoning_levels: ["max"]}`
  - `{id: "deepseek/deepseek-v4-pro", display_name: "", modalities: {input: ["text"]}}`
- **WHEN** DSH 列举并解析这三个模型
- **THEN** 三者的 `name` 依次为 `Claude Haiku 5.5`、`opencode-go/kimi-k3`、`deepseek/deepseek-v4-pro`；第一个的 effort id 恰为 `["low","high"]`、上下文窗口为 1000000、`defaultMaxTokens` 为 100、声明图片输入；第二个的 effort id 恰为 `["max"]`；第三个不声明图片输入

#### Scenario: 畸形条目被丢弃
- **GIVEN** 网关返回的 `data` 中一个条目缺 `id`，另有 2 个合法条目
- **WHEN** 目录同步
- **THEN** 目录恰含 2 个模型，同步状态为成功

#### Scenario: 非法容量值视为缺失
- **GIVEN** 网关返回 5 个模型，id 依次为 `m0`…`m4`，`context_window` 与 `max_output_tokens` 依次同时取 `0`、`-1`、`2.5`、`"1000"`、`9007199254740992`
- **WHEN** 目录映射
- **THEN** 5 个模型都存在，且都不含 `context` 与 `defaultMaxTokens`

### Requirement: 禁用不删除用户数据
在 manifest 中把插件设为 `enabled: false` 并重新 build 后，插件 SHALL NOT 删除 credentials 中任何线路凭据，也 SHALL NOT 删除插件设置文件（含 `knownOwners`）。插件的 dispose 路径 SHALL 只释放 route 注册、设置路由、计时器与连接，不执行任何删除操作。

各清理步骤 SHALL 相互独立执行：注册句柄的 disposer 抛错（例如宿主通知监听器抛 `INVARIANT`）时，runtime 关闭（中止后台请求与进行中的流、置 disposed）、设置路由注销与其它清理 SHALL 仍然执行；所有清理结束后才汇总报告错误，且不产生未处理的 Promise rejection。dispose 之后插件 SHALL NOT 发起网关请求、写入设置或调用 `registerAdapter` / `replace`。

dispose SHALL 移除本插件经有效注册句柄拥有的全部 route，SHALL NOT 触碰其它 adapter 注册的 route（包括同前缀的冲突 route）。唯一例外是首次 `registerAdapter` 已提交 route 却因 `INVARIANT` 未返回句柄（见「归属 route 持久」）：此时插件没有句柄可以撤销，这些 route 会滞留在宿主注册表中直到 Host 重启，插件 SHALL 在设置响应 `routeRegistrationError` 中说明需要重启 Host。

#### Scenario: dispose 不删除数据
- **GIVEN** 已保存 key 与设置文件，插件处于挂载状态
- **WHEN** 卸载插件（dispose）
- **THEN** credentials 服务的 `unset` 未被调用，设置文件仍存在且字节不变，本插件此前经句柄拥有的 route 都已不在 provider 列表中

#### Scenario: dispose 时有进行中的请求
- **GIVEN** 一次目录同步正在进行
- **WHEN** 卸载插件
- **THEN** 该同步被中止，之后它的响应不会写入任何状态，进程中没有未处理的 Promise rejection

#### Scenario: 注册句柄 dispose 抛错时其它清理仍执行
- **GIVEN** 真实 Cordis 与 `@deepseek-ai/dsh-llm`；插件已成功注册 `dsh-magpie-connector-claude`（句柄已返回）；之后添加一个抛 code 为 `INVARIANT` 的 `llm/adapters-updated` 监听器；一次目录同步与一次生成流都在等待网关；另一个 adapter 注册了 `dsh-magpie-connector-zz`
- **WHEN** 卸载插件，随后网关对两者返回数据
- **THEN** 目录同步与生成流的请求都被中止（网关 mock 观察到连接关闭），流以取消或错误结束；卸载后设置文件字节不变，不再调用 `replace`；`dsh-magpie-connector-zz` 仍在 provider 列表中；dispose 以汇总错误结束且进程中没有未处理的 Promise rejection

#### Scenario: 尚未注册任何 route 时 dispose
- **GIVEN** 首次安装、`knownOwners` 为空，首次目录同步正在进行，尚未创建注册句柄
- **WHEN** 卸载插件，随后该同步返回含 `owned_by: "claude"` 的目录
- **THEN** dispose 不抛错；同步结果不提交，不调用 `registerAdapter` 或 `replace`，provider 列表中没有本插件 route，`knownOwners` 未写入，进程中没有未处理的 Promise rejection

### Requirement: 旧格式升级（BREAKING）

插件 SHALL NOT 读取或迁移旧版设置（顶层 `baseUrl`）与旧版固定凭据引用（`MAGPIE_API_KEY`、`MAGPIE_ACCESS_CLIENT_ID`、`MAGPIE_ACCESS_CLIENT_SECRET`），也 SHALL NOT 注册旧 route `dsh-magpie-connector`。当持久化设置缺少合法的 `lines` 数组时，插件 SHALL 以空线路列表启动并视为未配置：`activeLineId` 为 null、不向任何网关地址发起请求。旧设置没有 `knownOwners`，因此此时不注册任何 LLM route：宿主层面对任何本插件 route 的调用都以 `NO_ADAPTER` 拒绝。插件 adapter 本身被直接调用时（单元层入口 `MagpieAdapter.prepareCall` / `stream`）SHALL 以 `MAGPIE_NOT_CONFIGURED` 结束。插件 SHALL NOT 解析旧固定引用、SHALL NOT 在 HTTP 响应或日志中出现旧配置内容或秘密、SHALL NOT 删除旧 settings 文件内容或旧凭据记录（由用户自行清理），并在设置响应中标记需要重新配置。

#### Scenario: 升级后旧配置被忽略且不删除

- **GIVEN** `settings.json` 只有旧版 `baseUrl`、没有 `lines` 与 `knownOwners`；`MAGPIE_API_KEY` 与 `MAGPIE_ACCESS_*` 仍已配置
- **WHEN** 插件启动、读取设置；经宿主 `listProviders()` 查询；直接对 `MagpieAdapter` 以 route `dsh-magpie-connector-claude` 调用 `prepareCall` 并 `stream` 一次
- **THEN** 设置响应 `lines` 为 `[]`、`activeLineId` 为 null；provider 列表中没有任何 id 以 `dsh-magpie-connector` 开头的 route；直接调用的流以 `MAGPIE_NOT_CONFIGURED` 结束；网关 mock 收到 0 个请求；插件未解析旧固定引用（credentials 的 `resolve` 未被这些引用调用）、未调用 `unset`，旧 settings 文件字节不变，响应与日志不含旧地址或旧凭据明文

#### Scenario: 旧格式升级后配置线路即恢复

- **GIVEN** 上一场景
- **WHEN** 客户端提交一条新线路（含 key）并 `resync: true`，网关返回 `owned_by: "claude"` 的模型
- **THEN** provider 列表含 `dsh-magpie-connector-claude`；旧 `baseUrl` 字段在设置文件中不再出现；旧固定凭据引用仍未被解析或删除

## ADDED Requirements

### Requirement: 按网关归属注册 route

**归属键**：插件 SHALL 把网关目录中的每个模型归入一个归属键。`owned_by` 是不可信的网关数据，SHALL 先校验再使用：
- `owned_by` 为字符串，去首尾空白后长度 1–48，且转小写后匹配 `^[a-z0-9][a-z0-9._-]*$` 时，归属键为其小写形式；
- 其它情况（缺失、非字符串、空、超长、含其它字符）归属键为 `other`；网关原值转小写后恰为 `other` 的模型也归入 `other`。

每个归属键对应 route `dsh-magpie-connector-<归属键>`。route 的 `listModels` SHALL 只列出「归属键等于本 route ∩ 可见集」中的模型，模型 id 保持网关原值，SHALL NOT 改写或加前缀。

**显示名**：route 的 `providerInfo().name` SHALL 只由归属键决定，与当前目录内容、模型顺序和原值大小写无关：归属键为 `other` 时为 `Magpie (Other)`，否则为 `Magpie (` + 归属键首字符大写、其余不变 + `)`。例如 `claude`→`Magpie (Claude)`、`codex`→`Magpie (Codex)`、`opencode-go`→`Magpie (Opencode-go)`、`deepseek`→`Magpie (Deepseek)`。因此 route 在启动时、目录为空时和归属下架后都有确定的显示名。

**provider 身份**：宿主要求 adapter 返回的每条模型信息的 `provider` 都等于被请求的 route。插件 SHALL 在 `listModels(route)`、`resolveModel(route, id)` 与 `prepareCall(route, id)` 返回的模型信息中，把 `provider` 设为被请求的 `route`；查找时 SHALL 按模型 id 在当前完整目录中查找，与请求的 route 无关。因此在任一本插件 route 上请求另一归属的模型 id，得到的能力（effort、上下文、输入模态、线协议）与在其所属 route 上请求一致，只有 `provider` 字段不同。目录中不存在的 id SHALL 返回 `{provider: <route>, id, name: id}` 形状的兜底信息。

插件 SHALL NOT 按模型 id 或显示名推测归属，SHALL NOT 输出 `displayGroup` 或其它非官方展示元数据。可见性与默认 effort 偏好 SHALL 继续以既有键（网关 `owned_by` 原值，缺失时为 id 首段；模型 id）保存与匹配，本 requirement 不改变它们。

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

### Requirement: 原生回放身份跨 route 稳定

插件写入 assistant 消息 `replayState` 的 pi-ai 回放身份（envelope `response.provider` 与 pi-ai `Model.provider`）SHALL 是与 DSH route 无关的固定传输身份 `dsh-magpie-connector`，SHALL NOT 使用归属 route id。该值只用于 pi-ai 内部判断「同一模型」，SHALL NOT 作为 LLM route 注册。

恢复历史 assistant 消息时，插件 SHALL 在以下条件全部满足时才恢复原生回放元数据（推理签名、加密推理、text/thought signature）：
- 消息的 DSH 来源 `source.provider` 是本插件的归属 route（匹配 `^dsh-magpie-connector-[a-z0-9][a-z0-9._-]{0,47}$`）；
- envelope 的 `kind`、`version`、`response.provider`（等于固定传输身份）、`response.model`（等于 `source.model`）及逐块 hash 校验全部通过（既有规则）。

满足时，恢复后的 pi-ai 消息 provider SHALL 为固定传输身份，使同一模型 id 在任一本插件 route 上续聊都被 pi-ai 视为同模型。来源不是本插件归属 route、或任一校验失败时，SHALL 按既有规则退化为不带签名的普通历史（视为外来模型），不抛错、不中止请求。宿主已按 adapter 归属剥离其它 adapter 写入的 `replayState`，插件 SHALL NOT 绕过该剥离。

#### Scenario: 归属 route 上续聊保留推理元数据

- **GIVEN** 在 `dsh-magpie-connector-codex` 上用 Responses 模型 `codex/gpt-6.1-sol` 完成一轮，网关返回含 `encrypted_content: "opaque-encrypted-reasoning"` 的 reasoning 项与一次工具调用；宿主把该轮记录为 `source.provider = "dsh-magpie-connector-codex"`
- **WHEN** 追加工具结果，在同一 route 上发起下一轮；随后重建 runtime 与 adapter（模拟重启），再发起一轮
- **THEN** 两次后续 `POST /v1/responses` 的 `input` 都含该 reasoning 项且 `encrypted_content` 为 `opaque-encrypted-reasoning`，并含 `function_call` 与对应 `function_call_output`（call_id 一致）

#### Scenario: 跨本插件 route 续聊仍视为同模型

- **GIVEN** 上一场景的历史消息（来源 `dsh-magpie-connector-codex`）；`knownOwners` 含 `other`，`dsh-magpie-connector-other` 已注册
- **WHEN** 经宿主 `ctx.llm.prepareCall({provider: "dsh-magpie-connector-other", model: "codex/gpt-6.1-sol"})` 直接调度下一轮（该模型不在 other 组列表中，GUI 不会提供此选择；本场景只验证插件的回放判定）
- **THEN** 请求 `input` 仍含 `encrypted_content` 为 `opaque-encrypted-reasoning` 的 reasoning 项

#### Scenario: 篡改或外来回放退化为普通历史

- **GIVEN** 三条历史 assistant 消息：来源 `dsh-magpie-connector-codex` 但 envelope `response.provider` 被改为 `dsh-magpie-connector-codex`；来源 `dsh-magpie-connector-codex` 但第一块文本被改动（hash 不符）；来源 `dsh-magpie-connector`（已退役 route）且 envelope 合法
- **WHEN** 分别以 `codex/gpt-6.1-sol` 在 `dsh-magpie-connector-codex` 上发起下一轮
- **THEN** 三个请求都发出且不报错；请求中都不含 `encrypted_content`，文本内容按普通历史出现

### Requirement: 归属 route 持久

插件 SHALL 把见过的归属键保存在设置的 `knownOwners`：按首次出现顺序排列的去重数组，元素满足归属键规则（小写、1–48 字符、`^[a-z0-9][a-z0-9._-]*$`），最多 32 个。

**加载校验**：插件启动时 SHALL 在注册任何 route、解析任何凭据、发起任何网络请求之前校验 `knownOwners`：缺失视为空数组；不是数组、元素不是合法归属键、含重复或超过 32 个时，整个 `knownOwners` 视为空数组（不做部分修复），设置响应 SHALL 报告 `knownOwnersReset: true`，插件 SHALL NOT 为此改写设置文件，直到下一次合法的 `knownOwners` 写入。`knownOwners` 的异常 SHALL NOT 影响线路、凭据与偏好的加载。

**写入边界**：所有设置写入（线路保存、pending 标记、偏好保存、归属追加）SHALL 经由同一个同步写入函数：以当前内存设置中的已知字段为基底（未知字段如旧版 `baseUrl` 不写回），只覆盖本次修改的字段，原子写盘，保留 `lines`、`visibleModels`、`defaultEfforts`、`credentialUpdatePending`、`knownOwners` 中未修改者。写入函数 SHALL 是同步的（单次调用内不 await），因此任意两次写入不会交错，也不需要跨 await 的锁。线路保存在 await 凭据操作期间若发生归属追加，线路保存的最终写入 SHALL 以写入时刻的内存设置为基底，不得用 await 之前取得的旧快照覆盖 `knownOwners`。任何设置写入或归属追加 SHALL NOT 等待目录同步完成；目录同步 SHALL NOT 等待设置请求完成。

**注册**：
- 启动时 `knownOwners` 非空 → SHALL 立即以其对应 route 集合调用一次 `registerAdapter`；为空 → 不注册，等首个归属出现再注册（宿主拒绝空集合注册）。
- 首次 `registerAdapter` 抛错时（含被其它 adapter 占用而抛 `DUPLICATE_ADAPTER`、以及宿主通知监听器抛 `INVARIANT`），插件 SHALL 视为不可恢复的启动失败：SHALL NOT 重试注册，SHALL NOT 再调用 `registerAdapter` / `replace`，SHALL NOT 改写 `knownOwners`；设置路由照常可用，设置响应 SHALL 报告 `routeRegistrationError`（含宿主错误 code 与首个冲突 route id，不含 key），模型目录同步仍可进行但不发布 route。用户排除冲突后需重启 Host 恢复。设置页 SHALL 在同步状态区域显示该错误与「需重启 Host」的说明，即使目录同步成功也显示。
- 已有句柄后，`replace` 抛 `DUPLICATE_ADAPTER` / `INVALID_ADAPTER` 时宿主未改变 route 集合；`replace` 抛 `INVARIANT` 时宿主已提交新集合。

**归属追加与发布**（目录同步成功、且仍是当前代且未 dispose 时）：
1. 按目录中首次出现顺序收集新归属键，依次准入直至 `knownOwners` 满 32 个；超出者不准入，设置响应报告 `ownerLimitReached: true` 与被拒绝列表。
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

## REMOVED Requirements

### Requirement: 选择器按网关归属展示分组（AMD2）
**Reason**: 依赖 ohmydsh Pet compat 的 `model-display.patch` 改造五个宿主包，商店用户的原版 DSH 看不到分组，插件也不能独立运行。改用「按网关归属注册 route」在原版宿主上原生分组。
**Migration**: 插件不再输出 `displayGroup`；Pet compat 的 `model-display.patch` 失去使用方，另起 change 退役。不保留旧 route `dsh-magpie-connector`：旧会话与默认选择需用户重选模型。
