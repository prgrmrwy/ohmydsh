## MODIFIED Requirements

### Requirement: 插件身份与命名

插件的 package/npm 名、Cordis 插件 id、LLM route id 与设置目录 SHALL 统一为 `dsh-magpie-connector`。

每条线路 SHALL 有 host 在创建时生成的随机 id：8 位小写十六进制（来自 `node:crypto` 的随机字节），创建时与现存线路去重；id 只保存在设置中、不在 UI 展示（UI 只显示由数组顺序派生的序号），且 SHALL NOT 从地址、key 或接入方式派生。排序、删除与宿主重启 SHALL NOT 改变剩余线路的 id。

凭据引用 SHALL 由线路 id 决定，而不是由当前序号决定：所有线路 SHALL 使用 `MAGPIE_LINE_<ID>_API_KEY`、`MAGPIE_LINE_<ID>_ACCESS_CLIENT_ID`、`MAGPIE_LINE_<ID>_ACCESS_CLIENT_SECRET`（`<ID>` 为线路 id 的大写形式）。排序、删除与宿主重启 SHALL NOT 改变剩余线路的凭据引用。插件 SHALL NOT 读取旧版固定引用 `MAGPIE_API_KEY`、`MAGPIE_ACCESS_CLIENT_ID`、`MAGPIE_ACCESS_CLIENT_SECRET`，也 SHALL NOT 读取未按线路声明的其它凭据引用。

依赖真实 route id 的其它能力（AUTO 策略、出口守卫豁免列表、侧边栏品牌识别）SHALL 使用 `dsh-magpie-connector`。

#### Scenario: 只注册一个 route

- **GIVEN** 线路 `a1b2c3d4` 的 `MAGPIE_LINE_A1B2C3D4_API_KEY` 已配置
- **WHEN** 插件启动
- **THEN** DSH 的 provider 列表中本插件只注册 `dsh-magpie-connector`，生成时解析该线路的 key

#### Scenario: 凭据引用由稳定 id 绑定

- **GIVEN** 两条线路：id=`a1b2c3d4` 使用 `MAGPIE_LINE_A1B2C3D4_API_KEY`（值 K1），id=`9f0e7d6c` 使用 `MAGPIE_LINE_9F0E7D6C_API_KEY`（值 K2）
- **WHEN** 把 id=`9f0e7d6c` 的线路移到序号 1 并保存，然后分别通过探测 mock 使该线路/另一线路成为唯一可达线路并以之发起生成
- **THEN** 两条线路仍按各自的 id 读取原引用；两个请求的 `Authorization` 分别为 `Bearer K1` 与 `Bearer K2`，没有任何线路改用对方的 key 或旧版固定引用

### Requirement: 网关连接与凭据

插件 SHALL 支持 0–5 条「连接线路」（首次安装为空列表，添加后通常 1 条，最多 5 条；详见 `magpie-line-selection`）。每条线路是一套完整连接配置：带版本段的 `http(s)` API 根地址、该线路的 gateway key、接入方式（见「连接接入方式（AMD4）」）。线路按设置中的数组顺序排列，序号即自动选择优先级，详见 `magpie-line-selection`。所有线路预期指向同一个 Magpie 网关（这是使用假设，插件不机械校验，也不承诺支持多网关语义）。

网关地址 SHALL 是带版本段的 `http(s)` API 根（例如 `http://114.114.114.223:3425/v1`），末尾斜杠会被去掉。地址 SHALL NOT 包含 userinfo、query 或 fragment；已配置的非空地址之间 SHALL NOT 相同，否则拒绝。未完整配置的线路以空字符串地址表示，空地址不参与重复校验。

一条线路是「完整」的，当且仅当：地址非空、该线路 key 可解析、且若接入方式为 Cloudflare Access 则地址为 https 且两项 Access 凭据均可解析。至少一条线路完整时插件视为已配置；否则视为未配置：`dsh-magpie-connector` route 的模型目录为空，生成以 `kind: error` 结束且 failure 消息包含 `MAGPIE_NOT_CONFIGURED`，不向任何网关地址发起请求。未完整的线路 SHALL NOT 参与自动选择。

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

- **GIVEN** 没有任何完整线路
- **WHEN** DSH 列举 `dsh-magpie-connector` 的模型，并以该 route 发起一次生成
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

### Requirement: 连接接入方式（AMD4）

设置页 SHALL 按线路持久化接入方式，每条线路只有「直连」和「Cloudflare Access」两项，默认「直连」，接入方式与线路一起保存。选择 Cloudflare Access 时，该线路地址 SHALL 为 https，且 SHALL 保存完整的 Access Client ID / Secret 两项；只配置一项、凭据含非法 header 字符、或该线路地址不是 https 时 SHALL 以 400 拒绝保存且不写入任何凭据。从 Cloudflare Access 切回直连并保存 SHALL 在同一次设置写入中清除该线路的两项 Access 凭据。任一 Access 凭据来自启动环境时，该线路的接入方式 SHALL 只读。

直连线路 SHALL NOT 携带任何 Access 请求头；Access 凭据只允许发往启用 Cloudflare Access 且地址为 https 的线路。Cloudflare Access 线路的两项凭据不可解析（被外部清除或部分缺失）时，该线路 SHALL 视为未完整、不参与自动选择，并在设置页标注缺凭据。来自启动环境的凭据只要可解析即视为完整，仅限制写入。插件 SHALL NOT 自动降级为直连。

#### Scenario: 默认直连，选择 Cloudflare Access 后才出现令牌输入（AMD4）

- **GIVEN** 新线路还没有保存 Access 凭据
- **WHEN** 打开该线路卡片，把接入方式切到 Cloudflare Access 并填写两项后保存
- **THEN** 打开时接入方式为「直连」、页面只有 key 一个密码输入；切换后出现两项输入；保存后该线路接入方式为 cloudflare，且只有该线路的两项 Access 引用被写入（key 引用未被写入）

#### Scenario: 切回直连并保存即清除 Access 凭据（AMD4）

- **GIVEN** 该线路两项 Access 凭据均已保存且可写
- **WHEN** 把接入方式切到「直连」并保存
- **THEN** 页面提示保存后将清除该线路的 Access 凭据；保存后该线路两项 Access 凭据被清除，其它线路不受影响

#### Scenario: Access 线路必须是 https

- **GIVEN** 一条地址为 `http://114.114.114.223:3425/v1` 的线路
- **WHEN** 客户端为该线路提交 Cloudflare Access 接入方式与两项凭据
- **THEN** 响应状态为 400，credentials 服务未被调用，该线路保持原接入方式

#### Scenario: Access 凭据缺失时线路未完整

- **GIVEN** 一条 https 线路接入方式为 cloudflare 但两项 Access 凭据被外部清除，同时另有一条完整线路
- **WHEN** 读取设置并发起操作
- **THEN** 该线路在设置响应中标记为未配置 Access / 未完整且不参与自动选择；插件不把它当直连使用，也不向该线路发送任何不带 Access 的请求

#### Scenario: 环境 Access 线路完整可用但只读

- **GIVEN** 一条 https 线路接入方式为 cloudflare，两项 Access 均来自启动环境（可解析、不可写）
- **WHEN** 以该线路为生效线路发起一次生成，并尝试在设置中保存新的 Access 值
- **THEN** 该线路被视为完整并参与自动选择，请求携带该环境 Access 头；设置写入返回 409 且 Access 引用未被修改

#### Scenario: 直连线路提交 Access 值被拒绝

- **GIVEN** 线路 1 接入方式为 direct
- **WHEN** 客户端提交非空 `accessClientId` / `accessClientSecret`
- **THEN** 响应状态为 400，credentials 服务未被调用，线路 1 配置不变

#### Scenario: 环境 Access 使接入方式只读

- **GIVEN** 线路 1 的 Access 两项来自启动环境
- **WHEN** 客户端尝试把线路 1 的接入方式改为 direct 或重新选择 cloudflare
- **THEN** 响应状态为 409，线路 1 接入方式不变，credentials 服务未被调用

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
- **THEN** DSH 列举 `dsh-magpie-connector` 的模型得到空列表，设置响应中 `lastSyncError` 非空；之后的生成请求只发往 B，不发往 A

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

### Requirement: 只读与传输边界

插件对 Magpie 的每个网络 hop（可达性探测除外，见下）SHALL 只落在当前生效线路地址的同一 origin 上，并且只使用以下方法和路径（相对该线路 API 根）：
- `GET /models`
- `POST /responses`
- `POST /chat/completions`
- `GET /magpie/quotas/cards`
- `POST /magpie/quotas/refresh`

插件 SHALL NOT 跟随 HTTP 重定向：收到 3xx 时以错误结束，不向重定向目标发送任何请求。插件 SHALL NOT 请求 Magpie GUI 的 `/api/*`，SHALL NOT 提供 Magpie 账号的登录、退出、添加或删除，SHALL NOT 修改 Magpie 配置。

Access 请求头 SHALL 只附加到启用 Cloudflare Access 且地址为 https 的生效线路。直连线路与任何明文 http 线路 SHALL NOT 携带 Access 头，也 SHALL NOT 因其它线路配置了 Access 而携带。相应线路的 gateway key 仍按线路使用 bearer 认证。

线路可达性探测是上述网络 hop 约束的唯一例外：它 MAY 连接任一参与自动选择的完整线路的 host:port，SHALL NOT 发送 HTTP 请求、SHALL NOT 携带任何凭据，也不受 origin / 白名单 / 重定向规则约束。

插件发往网关的请求 SHALL 使用插件自己的直连传输，不经过 DSH 按 `HTTP(S)_PROXY` 安装的全局代理 dispatcher。插件 SHALL NOT 提供插件级代理配置。

#### Scenario: 完整流程只触达白名单

- **GIVEN** 生效线路的网关 mock 记录收到的每个请求
- **WHEN** 依次执行：目录同步、一次生成、读取卡片、刷新一张卡片、刷新全部
- **THEN** 记录中的每个 `(method, path)` 都属于上述五项，且没有以 `/api/` 开头的路径

#### Scenario: 重定向不被跟随

- **GIVEN** 生效线路的网关 mock 对 `POST /v1/responses` 返回 307，分别指向另一 origin 的 mock 和同 origin 的 `/api/usage`
- **WHEN** 发起一次生成
- **THEN** 生成以 `kind: error` 结束；另一 origin 的 mock 收到 0 个请求，同 origin 的 `/api/usage` 收到 0 个请求

#### Scenario: 存在全局代理时仍直连

- **GIVEN** 进程的全局 fetch dispatcher 被替换为会记录请求的代理 mock，网关 mock 在本机端口监听
- **WHEN** 插件执行一次目录同步
- **THEN** 网关 mock 收到 `GET /v1/models`，代理 mock 收到的请求数为 0

#### Scenario: 多线路时只触达生效线路 origin

- **GIVEN** 两条线路指向不同 origin，生效线路为线路 2
- **WHEN** 同步目录、发起一次生成、读取卡片
- **THEN** 全部 HTTP 请求只落在线路 2 origin；线路 1 origin 收到 0 个请求

#### Scenario: 明文 http 线路不携带 Access 头

- **GIVEN** 生效线路是地址为 http 的直连线路，另一条 https 线路配置了 Cloudflare Access
- **WHEN** 向生效线路发起卡片读取与生成
- **THEN** 请求中不出现 `CF-Access-Client-Id` / `CF-Access-Client-Secret`，即使 Access 凭据已在另一条线路保存

#### Scenario: 探测只建 TCP 连接不发 HTTP

- **GIVEN** 两条完整线路且探测被记录
- **WHEN** 自动选择触发一次可达性探测
- **THEN** 只能观察到 TCP 连接尝试，没有任何 HTTP 请求，也没有 bearer 或 Access 头

### Requirement: 目录同步与发布

插件 SHALL 在以下时机从网关 `GET /models` 同步目录：插件启动且已配置时、连接身份变化时、生效线路切换后（见「连接身份与代际隔离」）、用户在设置页点「刷新模型列表」时。插件 SHALL NOT 做定时后台目录轮询。每次同步 SHALL 有超时（15 秒），超时视为 `unreachable` 失败。同一代内同一时刻 SHALL 最多只有一个目录同步在进行：进行中又被触发时，复用进行中的那一次，不另发请求。

同步失败时，设置响应 SHALL 给出 `lastSyncError` 和错误分类：`unauthorized`（401）、`forbidden`（403）、`http`（其它非 2xx，附状态码）、`unreachable`（网络错误或超时）。同时 SHALL 保留当前代已有的目录，SHALL NOT 用空目录替换。生效线路切换后的第一次同步成功前，目录以继承缓存展示（见「连接身份与代际隔离」），继承缓存 SHALL NOT 计为一次成功同步。

目录、可见性或默认 effort 任一项生效变化后，插件 SHALL 通过 adapter 注册句柄的 `replace` 发布更新，使 DSH 发出 `llm/adapters-updated`。这样已打开的官方模型选择器无需重启或刷新页面就能拿到新状态。

设置写入带 `resync: true` 时 SHALL 在提交后强制同步一次（即使生效线路未变）；仅提交 `{resync:true}` 亦合法。

#### Scenario: 保存地址后自动同步并发布

- **GIVEN** 已配置 key，网关 mock 对 `/models` 返回 13 个模型，DSH 侧有一个 `llm/adapters-updated` 监听器
- **WHEN** 客户端保存地址
- **THEN** 网关 mock 收到 1 次 `GET /v1/models`；监听器至少收到一次事件；随后列举到 13 个模型

#### Scenario: 同步失败保留当前代目录

- **GIVEN** 当前代已有 13 个模型，网关随后返回 503
- **WHEN** 用户点「刷新模型列表」
- **THEN** 仍列举到那 13 个模型；设置响应 `lastSyncError` 非空、分类为 `http`，`lastSyncAt` 保持上次成功时间

#### Scenario: 同代重复触发只发一次请求

- **GIVEN** 一次目录同步已发出、尚未返回
- **WHEN** 两个设置页先后点击「刷新模型列表」
- **THEN** 网关 mock 只收到 1 次 `GET /v1/models`；三个调用方得到同一个结果

#### Scenario: 同步超时

- **GIVEN** 网关 mock 对 `/models` 不响应，测试使用虚拟时钟
- **WHEN** 用户点「刷新模型列表」，然后时钟前进 15 秒
- **THEN** 同步结束，错误分类为 `unreachable`；当前代已有的目录保持不变

#### Scenario: key 无效的分类

- **GIVEN** 网关 mock 对 `/models` 返回 401
- **WHEN** 用户点「刷新模型列表」
- **THEN** 设置响应中错误分类为 `unauthorized`

## ADDED Requirements

### Requirement: 设置写入的凭据隔离与失败恢复

一次设置写入可能同时改线路数组与多条线路的 key / Access 凭据，而凭据写入不是事务。插件 SHALL 在任何凭据改动前，把本次打算写入的 `(线路 id, 字段)` 列表持久化为 pending 标记；全部凭据与线路配置写入成功后才移除标记。

删除线路、切回直连或清除 Access 时，插件 SHALL 先尝试清除该线路可写凭据；任一凭据清除失败时 SHALL NOT 提交线路/接入方式变更，SHALL 返回错误并保留 pending 标记。带 pending 标记的 runtime 重建后 SHALL 拒绝新的网关操作与目录同步，但设置读取 SHALL 仍可用并返回 `pending: [{lineId, field}]`（不含明文）；该读取 SHALL NOT 探测、换代或同步。

#### Scenario: 删除线路凭据清理失败时不提交删除

- **GIVEN** 线路 2 的 key 可写，credentials 服务对它 `unset` 时抛错
- **WHEN** 客户端删除线路 2
- **THEN** 响应为非 2xx 且含 `MAGPIE_SETTINGS_WRITE_FAILED`；线路 2 仍存在并保持原配置；pending 标记已持久化；重建 runtime 后新的操作被拒绝，显式重试清理成功后才恢复

#### Scenario: 切回直连清 Access 失败时接入方式不变

- **GIVEN** 线路 1 接入方式为 cloudflare，两项 Access 凭据可写，其中一项 `unset` 时抛错
- **WHEN** 客户端把线路 1 切回直连并保存
- **THEN** 响应为非 2xx 且含 `MAGPIE_SETTINGS_WRITE_FAILED`；线路 1 接入方式仍为 cloudflare；pending 标记已持久化，重试成功后接入方式才变为 direct

#### Scenario: 删除线路凭据清理成功后提交删除

- **GIVEN** 线路 2 的 key 与 Access 均可写，pending 为空
- **WHEN** 客户端删除线路 2
- **THEN** 响应 2xx；线路 2 从 `lines` 移除，其凭据引用被清除，响应 `pending` 为空；下一次网关操作不被拒绝

### Requirement: pending 恢复与完整重试

「完整重试」SHALL 指提交整表 lines：host 先按 D3 的凭据三态处理 lines 内的字段，再对 pending 中**不属于已提交 lines** 的 `(lineId, field)` 自动清理——可写引用执行 `unset`，来自启动环境的引用记为 `retainedCredentials`；只有全部凭据写入、清理与 lines 提交都成功后才清空 pending 并恢复网关操作与同步。清理失败时 lines 不提交、pending 保留、响应为 `MAGPIE_SETTINGS_WRITE_FAILED`。新建线路写凭据前 SHALL 把其随机 id 持久化到 pending；lines 提交失败时其已写入的派生凭据在下一次成功提交的不含该 id 的整表 lines 中被自动 unset（随机 id 不会分配给未来线路）。pending 标记 SHALL 可包含已删除或未提交线路的 id。

#### Scenario: 重启后设置读取仍可用并返回 pending

- **GIVEN** 上一次写入把 pending 持久化为 `[{lineId: "9f0e7d6c", field: "key"}]`，随后 runtime 重建
- **WHEN** 客户端读取设置
- **THEN** 响应 2xx 且含 `pending: [{lineId: "9f0e7d6c", field: "key"}]`（无明文）；该次读取不探测、不换代、不发 HTTP、不更新选择（`activeLineId` 保持该次读取前的内存值，可为 null）；网关操作仍被拒绝

#### Scenario: 完整重试清空 pending 后恢复

- **GIVEN** pending 为 `[{lineId: "9f0e7d6c", field: "key"}]` 且线路 `9f0e7d6c` 仍存在
- **WHEN** 客户端提交整表 lines 并对该字段提交 `null`，全部写入成功
- **THEN** 响应 `pending` 为空；线路 2 的 key 已清除；之后的网关操作恢复正常

#### Scenario: 新建线路提交失败后按 pending 清理 orphan

- **GIVEN** 新增线路获得随机 id `9f0e7d6c` 并写入了派生 key，但 lines 提交失败
- **WHEN** runtime 重启后读取设置（pending 含该 id），随后提交一份不包含 `9f0e7d6c` 的整表 lines 并成功
- **THEN** 响应 `pending` 为空，`9f0e7d6c` 的派生 key 已被 `unset`（若来自启动环境则列入 `retainedCredentials`）；之后新增线路获得不同的随机 id，不会读取该残留凭据

### Requirement: 旧格式升级（BREAKING）

插件 SHALL NOT 读取或迁移旧版设置（顶层 `baseUrl`）与旧版固定凭据引用（`MAGPIE_API_KEY`、`MAGPIE_ACCESS_CLIENT_ID`、`MAGPIE_ACCESS_CLIENT_SECRET`）。当持久化设置缺少合法的 `lines` 数组时，插件 SHALL 以空线路列表启动并视为未配置：目录为空、`activeLineId` 为 null、生成以 `MAGPIE_NOT_CONFIGURED` 结束、不向任何网关地址发起请求；SHALL NOT 解析旧固定引用、SHALL NOT 在 HTTP 响应或日志中出现旧配置内容或秘密。插件 SHALL NOT 删除旧 settings 文件内容或旧凭据记录（由用户自行清理），并在设置响应中标记需要重新配置。

#### Scenario: 升级后旧配置被忽略且不删除

- **GIVEN** `settings.json` 只有旧版 `baseUrl`、没有 `lines`；`MAGPIE_API_KEY` 与 `MAGPIE_ACCESS_*` 仍已配置
- **WHEN** 插件启动、读取设置、列举模型并发起一次生成
- **THEN** 设置响应 `lines` 为 `[]`、`activeLineId` 为 null；模型列表为空；生成以 `MAGPIE_NOT_CONFIGURED` 结束；网关 mock 收到 0 个请求；插件未解析旧固定引用（credentials 的 `resolve` 未被这些引用调用）、未调用 `unset`，旧 settings 文件字节不变，响应与日志不含旧地址或旧凭据明文
