## Context

动机见 proposal.md。本节只列影响方案的事实，均于 2026-10-25 读源码或只读实测确认。第 1 轮评审纠正过的事实已按源码改正。

**Magpie 网关**（`yetone/magpie` commit `714ab8e`，CT105 实例）：
- **路由与模型字段**：网关 mux 在 `internal/gateway/gateway.go:676–705`。`GET /v1/models` 的字段由 `modelObject`（约 918 行）产生：`owned_by`、`display_name`、`magpie_label`、`reasoning_levels`、`context_window`、`max_output_tokens`、`modalities`、`native_endpoints`。Codex 模型另有 `service_tiers`，形如 `[{id, name, description}]`（约 1143 行）。`native_endpoints` 可以为空，例如路由组或需要翻译的订阅（`internal/provider/native_endpoints.go`）。目录结果按 key 的权限过滤（`keyAllowed`）。
- **远端访问条件**：远端请求能否进入，取决于 `remoteKeyed() = settings.LAN || OnNetwork()`（`lan.go:105–118`）。也就是说，开启局域网共享不是必要条件；`MAGPIE_ADDR` 监听在非回环地址（如 Docker 的 `0.0.0.0`）同样可以。远端请求都要带启用的 gateway key。
- **卡片可见范围**：不受限的 key 能看到全部卡片。受限的 held key 必须带 Quotas 权限，并且只能看到自己范围内的卡片（`quotas_scope.go:41–50、139–146`）。
- **卡片读取与刷新**：
  - `GET /v1/magpie/quotas/cards` 只返回 Magpie 已缓存的读数，从不访问厂商；Magpie 刚启动时可以返回 `200 data: []`（`remote_quotas.go:43–45、75–122`）。
  - `POST /v1/magpie/quotas/refresh` 带 `?provider=&user=` 时读取单张卡片；省略 user 时读取该 provider 的全部账号；不带参数时读取全部。限流键是请求参数组成的元组 `provider|lower(user)`，刷新全部时就是 `|`，所以它不是按卡片计数。各元组之间互不限流，也不会合并进行中的读取。在限流间隔内，直接返回 200 和当前缓存，不返回 429（`gateway.go:882–915`）。
  - 受限 key 带 Quotas 权限时，刷新全部只遍历已缓存的卡片（`scope.cards(CachedCards)`）。缓存为空时一次也不读，返回 `200 data:[]`；只有不受限的 key 会走 `ReadAllCards`（`gateway.go:904–911`）。
  - 厂商读取失败会写进卡片的 `error`，或回退到带 `asOf` 的旧快照（`subscription_usage.go:896–917`，`quota_last.go`）。
- **卡片字段**：窗口可能带 `unlimited`/`display`，例如 Copilot 的 `{Unlimited: true, Display: "Unlimited"}`，此时 `used` 是零值。`resets.until` 是可选字段（`codex_resets.go:23–28`）。
- **线协议差异**：Responses 请求结构 `rRequest` 没有 `stop` 字段，Magpie 收到也不会转发；Chat 会解析 stop（`responses.go:259–325`，`chat.go:63、93–98`）。Chat 流可能先发 SSE `error`，之后照常发 finish、usage 和 `[DONE]`（`chat.go:1438–1465`）。对外报告的 prompt/input token 数包含缓存部分（`responses.go:1346–1372`，`chat.go:978–982`）。
- **快速档转发**：`service_tier: priority` 经 Responses 和 Chat 转发到 chatgpt.com 或 api.openai.com（`responses.go:1256`，`chat.go:84、466`）。
- **使用重置**：只有 GUI 的 `POST /api/usage/codex-reset`，走 GUI 自己的 web key 或 cookie 认证（`gui/web.go`）。网关端口上没有对应端点。
- **只读实测（用当前 key）**：`/v1/models` 返回 200，共 13 个模型，其中 3 个 Codex 模型带 priority；`/v1/magpie/quotas/cards` 返回 200，共 3 张卡片，codex 卡片带 `resets.count=1`。

**DSH 0.2.0-rc.2 接缝**：
- **注册与代际**：`ctx.llm.registerAdapter([route], adapter)` 返回一个句柄，句柄的 `replace(providers)` 会原子替换并发布 `llm/adapters-updated`（`dsh-llm index.d.ts:186–210、264`）。动态 adapter 应当重写 `prepareCall`，把模型信息和后续 dispatch 绑在同一代上（`index.d.ts:171–181`）。
- **请求要求**：每个发往 provider 的 HTTP 请求都必须带 `attributionHeaders()`。
- **流协议**：`StreamChunk` 规定 usage 在 finish 之前、工具参数保持原始 JSON。`FinishReason` 取值为 `stop | tool-calls | max-tokens | aborted | error`（`types.d.ts:130–151、409–447`）。
- **默认 effort**：`reasoning.defaultEffort` 必须属于 efforts（`types.d.ts:357`）。
- **设置路由与凭据**：设置路由用 `ctx.inject(['connection'])` 后的 `connection.fetch.register(...)` 注册，鉴权由 DSH 的客户端连接负责。凭据用 `ctx.get('credentials')`，接口为 `describe/resolve/set/unset`，范例是 `packages/auto-model-routing/src/settings-host.ts`。
- **全局代理**：`@deepseek-ai/dsh-http-proxy` 会按启动环境把策略 dispatcher（Agent/Pool 加 ProxyAgent）装成 undici 的全局 dispatcher。undici fetch 默认 `redirect: 'follow'`，307 时会连同请求体一起转发；改成 `redirect: 'error'` 后，遇到重定向会以 `TypeError('fetch failed')` 拒绝（cause 为 unexpected redirect），拿不到 3xx 状态码。
- **凭据变更事件**：credentials 在 set、unset 或观察到外部编辑时，会发出 `credentials/reference-updated(ref)`；仅改进程环境变量不会触发事件（`dsh-credentials types.d.ts:69–82`）。凭据契约要求每个操作开始时解析一次（`index.d.ts:121–129`）。
- **usage 口径**：`TokenUsage` 要求未缓存输入与缓存读写互不重叠（`types.d.ts:153–173`）。图片以附件引用形式给出，需要通过附件服务读取字节（`types.d.ts:61–70`）。
- **参考实现的取舍**：subscriptions 的速度栏挂在 `conversation.input.right` 槽位；host 在内存中保存会话选择，选标准时直接删除该条。dsh-magpie-connect 在 `stream` 里重新读取地址，不满足 `prepareCall` 同代契约，因此不照搬。

**本仓约束**：local package 走 `dsh.yaml` 加 `dsh build`。新包要声明 `ohmydsh.docTier`，README 中英两份要满足治理测试对该 tier 的规则（`<!-- problem -->` 段；tier C 要有 `## Removal` 和 `<!-- section: removal -->`）。发布需要同时具备 `prepare` 和 `prepack`（`docs/architecture/dsh-plugin-publishing.md`）。

## Goals / Non-Goals

**Goals:**
- 一个可发布的自研插件，替代 `dsh-magpie-connect` 和 `magpie-display-name-shim`，并能作为日常执行入口：工具往返、取消、超时都可验收。
- 设置页按 provider 分组，包括只读卡片、手动刷新（单卡和全部）、模型可见性、DSH 侧默认 effort。
- Codex 速度切换。
- 本轮授权的逐模型展示组与 AUTO 双 Magpie transport 兼容、主 effort 官方单值同步（AMD3），保持真实 provider/model 不变。

**Non-Goals:**
- 按上游 provider 注册多个真实 route。AMD2 的选择器展示分组不属于这一 non-goal；它须与真实 route 身份分离。
- 使用 Codex 重置卡。
- 账号登录与管理；写入 Magpie 配置。
- 插件级代理；多网关地址自动切换。
- 用量历史、请求统计、`/v1/magpie/route` 实时路由展示。
- `/v1/messages` 直通；图片和视频生成工具。
- 目录持久化缓存；后台定时轮询目录或卡片。
- 改变 AUTO 判档算法/legacy 语义或扩大 allowlist；AMD3 仅同步主请求选定的 effort 到官方选择。home-network-model-guard 改动仍不在范围内。
- 推送独立仓库、发布 npm、提交商店 PR，这些按发布文档另行进行。

## Decisions

### D1 单 route `dsh-magpie`，展示分组与路由身份分离（AMD2）
只注册一个 route，模型 id 保持网关原样。
- **备选**：每个 `owned_by` 一个 route。**否决理由**：Magpie 的 provider 集合是动态的，route 会跟着变化，生命周期和孤儿会话都更复杂；AMD2 用户确认的菜单分组只是展示，不能改变真实 route。
- sidebar-icon 的 `normalizeIdentity` 会先去掉 `dsh-`，所以 `dsh-magpie` 已经能命中现有的 `magpie` 规则。本 change 只给它补 spec 和回归测试，不改源码。

### D2 线协议：复用 pi-ai，按 `native_endpoints` 选择 Responses 或 Chat
- **协议选择**：`native_endpoints` 含 `/v1/responses` 时走 Responses，其余情况（包括为空）走 Chat Completions。Magpie 保证 Chat 可以翻译到任意上游。
- **备选 1**：一律走 Chat。**否决理由**：Magpie 源码注释（`internal/agent/dsh.go:1363–1372`）说明，GPT 在 Chat 下会丢失加密推理（`encrypted_content`），工具调用之间推理无法回传，Codex 的工具回合质量会下降。Magpie 给 DSH 写配置时，也按协议拆成 Chat、Responses、Anthropic 三条 route。
- **备选 2**：Claude 走 `/v1/messages`。**否决理由**：要多维护一套线协议，收益很小。
- **实现方式：不手写线协议，复用 `@earendil-works/pi-ai`（MIT）**。这和 dsh-magpie-connect 0.4.1、官方 `@deepseek-ai/dsh-llm-pi-ai` 的做法一致。用 `createProvider` 把 `openai-completions` 和 `openai-responses` 两个 API 模块挂在同一个 provider 上，pi-ai 按 `model.api` 分派。插件只负责桥接：
  - **输入**：DSH 的 `GenerateOptions` 转成 pi-ai context。图片通过附件服务读取。
  - **输出**：pi-ai 事件转成 DSH `StreamChunk`。
  - **传输**：通过 pi-ai 的 `options.fetch` 注入 D3 的 `gatewayFetch`，直连、拒绝重定向和白名单校验因此对 pi-ai 发出的请求同样生效。
  - **备选**：在包内手写两套线协议。**否决理由**：工作量大，评审第 2、3 轮的 wire 问题大多出在这里（usage 拆分、图片结构、工具配对、response.failed）。pi-ai 0.87.1 已经正确实现了这些：`openai-completions.js:1160–1180` 与 `openai-responses-shared.js:440–450` 的 usage 同时减去缓存读和缓存写；`openai-responses-shared.js:643–655` 中，`response.failed` 不带 error 对象时也会抛错；Chat 默认用 `max_completion_tokens`，图片用 `image_url` 或 `input_image`，工具用 `call_id` 配对，Responses 的 `service_tier` 也会透传。
  - **依赖版本**：依赖 pin 与官方 dsh-llm-pi-ai 相同的 pi-ai 主版本（0.87.x）。spec 中的 wire 场景是对这层桥接的验收：断言实际 wire body 和流块。pi-ai 升级时，这些场景用作回归测试。
- **stop**：不支持（第 3 轮评审 M2）。Magpie 对 Codex 这类只支持 Responses 的上游，即使收到 Chat 请求，也会再转成不带 stop 的 Responses，插件无法保证 stop 生效。请求带非空 stop 时，在发请求前报 `MAGPIE_STOP_UNSUPPORTED`。DSH core 中没有调用方会传 stop（2026-10-25 grep 确认），所以实际不会遇到。上一轮的「带 stop 改走 Chat」撤回。**备选**：在插件本地按 stop 串截断输出并中止上游。**否决理由**：要处理跨 chunk 匹配，并且需要中止和不重放的验收，而目前没有任何调用方用到。
- **桥接层的显式归一化（第 3 轮复核 R3-RC-M1）**：只需处理 effort 一处。
  - **未选 effort**：给每个 reasoning 模型设置 `thinkingLevelMap: { off: null, <每个网关档位>: <同名> }`，做法与 connect 的 `thinkingLevelMapFor` 相同。这样 pi-ai 在没有 `reasoningEffort` 时，Responses 不会默认写 `reasoning.effort: "none"`（`openai-responses.js:248–263`；Magpie 收到 `none` 会关闭推理），Chat 也不会写 `reasoning_effort`。显式选 `none` 时，仍然原样发送。
  - **system 不做改写**：pi-ai 把开头的 system 编成 `system` 或 `developer` 角色的消息。Magpie 对 Chat 和 Responses 中的 `system`、`developer` 一视同仁，都并入 System（`chat.go:102`、`responses.go:361`）。所以不需要 `onPayload` 把它移到 `instructions`，也不需要设置 `supportsDeveloperRole`。spec 只约束「不得改写成 user」。
- **请求与响应映射**（由 pi-ai 实现，并经上面的归一化处理；插件负责配置和验收）：
  - 开头的 system 按 pi-ai 的默认编码发送（`system` 或 `developer` 角色），不改写成 user 消息。
  - effort 写入 `reasoning.effort`（Responses）或 `reasoning_effort`（Chat），值直接用网关的档位 id，`none` 也原样写入。connect 中的 `planReasoningEffort` 可以参考。
  - 输出上限：Chat 用 `max_completion_tokens`，Responses 用 `max_output_tokens`。
  - usage：`inputTokens = max(总输入 - cacheRead - cacheWrite, 0)`，没有缓存详情时缓存按 0 计，这部分由 pi-ai 完成。`totalTokens` 由插件自己的 `mapUsage` 推导：未缓存输入大于 0 时取四项之和，否则省略（见下）。不采用官方 dsh-llm-pi-ai 直接透传的做法，原因是 Magpie 透传同协议上游时，`total_tokens` 可能缺失（`gateway.go:3795–3797、4911–4944`；见 `pi_responses_test.go:32–35`），此时 pi-ai 会给出 0（`openai-responses-shared.js:450`）。实现：pi-ai 归一化后，`input + cacheRead + cacheWrite` 就是原始完整输入，因此 `input > 0` 时 `totalTokens = input + cacheRead + cacheWrite + output`；`input === 0` 时省略。这一条就能覆盖缺少完整输入（pi-ai 记为 0）和计数不一致（pi-ai 钳到 0）两种情况，不需要额外钩子。代价是恰好全部命中缓存的合法请求也会省略 total。total 是可选字段，各分项仍然正确，按评审 Re-check 4 的意见只算 Suggestion，可以接受。（Chat 和 Responses 都不采用 pi-ai 的 total。）缓存字段只在大于 0 时输出。
  - 流中出现错误事件即判为 error，之后再收到 `[DONE]` 或完成事件也不改判。
- **超时与重试**（AMD4 取代原 90s/60s 内容预算与建连 429/5xx 有限重试）：对齐 dsh-plugin-subscriptions。一个 300s 空闲看门狗从调用 pi-ai 前启动；包装后的 fetch 在收到响应头和响应体每个 chunk 时重新计时，所以 SSE 事件、comments/心跳都算存活。原设计只认非空 delta，长时间推理（高 effort、网关只发 in_progress/心跳）会在 90s 被误判超时，而错误码 `MAGPIE_STREAM_TIMEOUT`/`MAGPIE_GENERATION_FAILED` 又不在 dsh-llm 默认可重试集合内，所以 DSH 的 `llm-retry` 一次也不会重试——这正是其它机器上频繁看到这两个错误的原因。现在插件声明 `providerRetryPolicy`（10 次、1s→60s、±20%），把失败映射到 `TIMEOUT`/`TRANSPORT`/`SERVER`/`RATE_LIMIT`/`EMPTY_RESPONSE` 等标准码并带 `status`/`providerRetryAfterMs`；插件自身不再重发任何请求，避免与轮次级重试相乘。消息仍保留 `MAGPIE_STREAM_TIMEOUT` 字样便于排查。

### D3 统一传输层：私有直连 dispatcher，拒绝重定向，所有 hop 都校验
插件内只有一个 `gatewayFetch(gen, method, path, init)`：
- 用私有的 `new undici.Agent()` 作为 dispatcher，不使用全局代理；
- 设置 `redirect: 'error'`。遇到重定向时 fetch 会以 `fetch failed` 拒绝，插件识别 cause 后报「网关返回了被禁止的重定向」，不声称知道具体状态码（第 2 轮评审 S1）；
- 请求前断言 `(method, path)` 在白名单内，且 URL 的 origin 等于当前代的 base origin；
- 加上 `Authorization` 和 `attributionHeaders()`；
- 合并调用方传入的 signal 和插件生命周期的 signal。

所有网络请求都只能走这个函数。生成通过 pi-ai 的 `options.fetch` 注入它，其它请求直接调用它。
- **备选**：依赖用户把网关地址加进 `NO_PROXY`。**否决理由**：这是隐式前提，漏配时局域网请求会被静默送进 mihomo。
- **备选**：允许同 origin 的重定向。**否决理由**：Magpie 的 `/v1` 不会重定向；任何 3xx 都意味着异常，要么配置错误，要么是中间设备。

### D4 连接身份与代际（解决 C1 与 R2-C1）
- **操作**：一次目录同步、一次卡片读取或刷新、一次生成（从 `prepareCall` 到流结束），各算一个操作。每个操作开始时，按 credentials 契约解析一次 key，之后在该操作内复用，不在每次 HTTP 请求时重新解析。
- **代际**：`Generation { id, baseUrl, keyFingerprint, catalog, cards, syncPromise, refreshGate, seq, bgAbort }`。`keyFingerprint` 是 key 的 sha256 前 16 位十六进制，只存在内存中，用来判断身份是否变化，不对外输出。
- **何时换代**：满足以下任一条件就换代，换代总是发生在新操作发请求之前。
  - 插件自身保存了新地址，或通过插件 set/unset 了 key；
  - 收到 `credentials/reference-updated`，且 ref 为 `MAGPIE_API_KEY`；
  - 新操作开始时解析出的指纹与当前代不同。这一条是防御性检查，用来兜底 credentials 有效值变了却没有收到事件的情况。注意：宿主的启动环境是不可变快照，改了启动环境变量里的 key 需要重启 DSH 才会生效；外部编辑凭据文件，以 credentials 服务观察到变化并发布为准（第 3 轮评审 S1）。
  - 事件处理先同步让旧的可见状态失效，再异步解析 key 并同步目录，不依赖 `credentials.set` 会等待异步 listener 执行完。
- **换代时做什么**：
  - 中止上一代的后台请求（目录与卡片，即 `bgAbort`）；
  - 清空目录与卡片；
  - 立刻为新身份发起目录同步；
  - 通过 `replace` 发布更新。
- **旧结果丢弃**：所有异步结果提交前都检查 `gen.id === current.id`。
- **生成不受换代影响**：`prepareCall` 解析 key，并把 `{ origin, key, modelCaps, nativeEndpoints, serviceTiers }` 捕获进 `stream` 闭包。`stream` 只使用这些捕获值，信号只用 `options.signal` 和插件 dispose 的信号，不绑定 `bgAbort`。所以换代不会中止已准备或正在进行的生成，它们用旧地址和旧 key 跑完。这是用户确认的语义，也符合 `PreparedAdapterCall` 的「dispatch 不重读动态连接事实」。
  - **备选**：换代时中止进行中的生成。**否决理由**：用户在 2026-10-25 明确选择让生成跑完；中止会打断正在进行的对话，换 key 却不会因此更安全，因为旧 key 在 Magpie 侧本来就还有效，直到管理员禁用它。
- **不落盘**：目录只放内存。**备选**：持久化 `catalog.json`。**否决理由**：唯一收益是 DSH 重启时网关又恰好不可达，选择器里仍有列表，但这时生成本来也会失败；持久化还要按身份隔离并保证原子写，复杂度与收益不成比例（ponytail 第 10 条、评审 C1，第 2 轮已接受）。

### D5 目录同步时机与发布（解决 M2）
- **触发时机**：插件启动且已配置时、换代时、用户点「刷新模型列表」时。不做后台定时轮询，因为目录很少变化，用户需要时可以手动获取。
- **超时**：每次同步 15s。失败时保留当前代的目录，并记录 `lastSyncError` 与错误分类。
- **同代只有一个进行中的同步**：同代内重复触发时，复用 `gen.syncPromise`，不另发请求（第 2 轮评审 M4）。这样不存在同代的两次同步互相覆盖，也就不需要同步序号。
- **发布**：目录、可见性、默认 effort 任一项生效变化后，调用注册句柄的 `replace(['dsh-magpie'])`，触发 `llm/adapters-updated`。官方选择器据此失效并重读目录，subscriptions 也是这样做的。
- **不再单独提供「测试连接」**：保存地址或 key 会触发同步，同步结果（成功及模型数，或失败分类）就显示在设置页（ponytail 第 2 条）。

### D6 偏好存储
- key 存在 credentials 中，引用 `MAGPIE_API_KEY`。
- 设置文件 `$DSH_HOME/plugins/dsh-magpie/settings.json`，原子写入，权限 0600，内容为：
  - `baseUrl`；
  - `visibleModels`：按 provider 保存，键不存在表示跟随网关模型列表；
  - `defaultEfforts`：模型 id 到 effort 的映射。
- 不迁移 connect 的设置，因为白名单语义不同。用户需要重新填地址、重新选择模型。
- 可见性只校验形状，不与当前目录比对（ponytail 第 8 条）：网关目录抖动时，不应让一次正常的保存失败。

### D7 默认 effort 只在下发时过滤
`resolveModel` 和 `prepareCall` 输出时，只有已保存的值属于当前 `reasoning_levels`，才写入 `defaultEffort`。存储不会被自动清理，网关恢复该档位后自动重新生效。是否已失效由 client 用目录里的 `reasoning_levels` 自行判断，host 不额外返回 `stale` 字段（ponytail 第 9 条）。effort id 原样使用网关取值和顺序。

### D8 卡片：打开时读一次，只在用户点击时刷新（解决 C3、M1、M7、R2-M1、R2-M2、R2-M6）
- **读取与投影**：设置页打开时，host 请求一次 `GET /magpie/quotas/cards`，把每张卡片投影为固定字段，再返回给浏览器。字段集合为：provider、name、icon、user、plan、until、renew、balance、readAt、asOf、error，以及 windows[name、used、resetsAt、unlimited、display] 和 resets[count、until]。所有字符串都经过脱敏：用当前代和进行中操作的 key 原文做字面替换。这是为了保证「key 不出现在插件响应中」这一不变量，不依赖 Magpie 永远不回显 key。第 1 轮时我主张「原样透传」，第 2 轮评审不接受（R2-M6），这里改正。
- **渲染**：client 只渲染上述字段，窗口读数优先级为 `unlimited` > `display` > `used%`，字符串一律作为文本渲染。
- **单卡刷新**：设置路由 `POST cards {provider, user?}`。host 校验 `(provider, user)` 与当前代最近一次读到的某张卡片完全一致，然后转发为带参数的 refresh。这样就不会因为省略 user，把刷新扩大到该 provider 的全部账号。
- **刷新全部**：`POST cards {all: true}`，转发为不带参数的 refresh。两种请求形状互斥。
- **刷新闸门**：每一代同一时刻只允许一个刷新（单卡或全部）发往网关。刷新进行中再来的刷新请求，先做目标校验：如果进行中的刷新覆盖新请求的目标（进行中的是刷新全部，或者是同一张卡），就复用进行中那次的 Promise，这是 subscriptions 的 `inflight` 写法；如果不覆盖（单卡进行中时又来了刷新全部，或者来的是另一张卡），就等进行中的刷新结束（成功或失败都算结束），再重新检查当前代和闸门，然后按自己的目标串行发出。这样不需要 409，也不需要持久队列（Re-check 4 M2）。理由：Magpie 按请求参数组合限流，单卡刷新和刷新全部互不限流，也不会合并进行中的读取，所以 host 必须自己串行（第 2 轮评审 M1）。不设冷却期：刷新本来就只由用户点击触发，Magpie 对同一组参数也有 30s 限流。
- **GET 跟随刷新（第 3 轮评审 M3）**：刷新进行中时到达的卡片读取，会等待这次刷新结束并直接使用刷新结果，不会读到 Magpie 的旧缓存然后抢先提交。没有刷新时，同代内的卡片读取共享同一个进行中的 Promise，做法与 subscriptions 的 `ModelCatalogCache.refresh` 相同。
- **单调序号**：序号属于实际发往网关的请求。取得闸门、确认当前代后，在真正发出请求时分配 `gen.seq++`。复用进行中刷新的请求和跟随刷新的 GET 沿用被复用请求的序号，不另外分配。这样，等待后才发出的刷新不会因为入口时拿到的序号较小，被后到的跟随者压过（Re-check 5 M1）。只有属于当前代、且序号大于已提交序号的 2xx 结果才能提交。400 和请求失败都不推进序号，也不释放其它请求持有的闸门。不做跨浏览器的状态推送。
- **读取时间**：一律取自响应。刷新前后读取时间不变时，显示「未重新读取」。
- **冷启动**：
  - 不受限的 key 点「刷新全部」，会让 Magpie 读取全部卡片。
  - 受限 key 即使带 Quotas 权限，在空缓存时刷新全部也读不到任何卡片（Magpie 714ab8e 的行为）。这时的空状态提示需要管理员先在 Magpie 中读取一次，或者改用不受限的 key。插件不承诺刷新全部一定能产生卡片，也不建议放宽权限。用户本人是管理员，用的是不受限的 key，不受影响。
- **不做的事**：不做定时轮询（评审 S1、ponytail 第 3 条）。403 时只显示 Magpie 返回的原因，经脱敏后展示（评审 M5）。

### D9 速度：只保存快速会话集合
`Set<sessionId>`，选标准时删除该条，不持久化（评审 S2）。会话 id 只校验为非空、长度不超过 256 的字符串。是否注入 `service_tier` 在 `stream` 时判断：会话在集合中，且 `prepareCall` 捕获的模型能力含 `priority`。注入方式：Responses 通过 pi-ai 的 `serviceTier` 选项（pi-ai 会写 `service_tier`）；Chat 通过 pi-ai 的 `onPayload` 钩子在请求体中加入 `service_tier: "priority"`，Magpie 的 Chat 会转发它（`chat.go:84、466`）。

### D10 设置路由按资源合并
在 `/api/dsh-magpie/` 下注册 3 个路径（ponytail 第 7 条）：

| 路径 | GET | POST |
|---|---|---|
| `settings` | 读取地址、key 状态、同步状态、按 provider 分组的目录、可见性、默认 effort | 接受部分修改：`{baseUrl?, key?: string \| null, visibleModels?, defaultEffort?: {model, effort \| null}, resync?: true}` |
| `cards` | 读取卡片（已投影、已脱敏） | `{provider, user?}` 刷新单张（必须与当前卡片一致），`{all: true}` 刷新全部，两者互斥；进行中的刷新覆盖新目标时复用其结果，否则等它结束后按新目标串行发送 |
| `speed` | `?session=` 读取会话速度与支持快速档的模型列表 | `{session, tier}` |

所有入参先经 schema 整体校验，非法输入返回 400，不做部分写入；key 不可写时返回 409；任何响应都不含 key。注册方式、跨 generation 共享和 dispose 顺序沿用 connect 的写法。

### D11 dispose
dispose 时释放 route 注册、设置路由、credentials 事件订阅和私有 Agent，并中止所有进行中的请求，包括生成。不删除 credentials 和设置文件。

### D12 包结构与可发布形态（解决 M6）
`packages/dsh-magpie/` 的布局参照 auto-model-routing：
- `src/host`：adapter、wire（responses、chat）、catalog、generation、cards、settings、speed、transport；
- `src/client`：设置页、速度栏；
- `test/`。

`package.json`：
- `prepare` 和 `prepack` 都执行 build；
- `dsh.bundle.patch`、`dsh.client`、`exports` 齐全；
- `files` 覆盖实际产物；
- `ohmydsh.docTier: "C"`（与 auto-model-routing 一致）。

README 中英两份，含 `<!-- problem -->` 段和 `## Removal` 段。包内提供一个元数据自检测试：断言 prepare、prepack、files、exports 都存在。本 change 不推送仓库，也不发布。

### D13 AMD2 选择器展示分组（本轮已授权受管宿主扩展，待独立 recheck）
- 目标是在具体型号上方显示 `Magpie (Claude)`、`Magpie (GPT)`；组键只取网关 `owned_by`，其中 `claude` 展示 Claude、`codex` 展示 GPT，其它非空 owned_by 原文展示。缺失时显示中性 `Magpie (Other)`，不靠型号名猜测；不改变既有设置页缺 owned_by 的兼容分组或偏好键。
- 展示分组必须是官方选择器的逐模型元数据或官方受管扩展，不是额外 LLM provider。所有选项的真实选择仍为 `{provider:'dsh-magpie', model:<原id>}`；统一搜索同时覆盖展示组标签与型号/id，可见性求交集、effort 与目录 replace 失效保持原契约。
- 已核验原 rc.2 ModelSelect 从 `group.id` 构造 `selection.provider`，没有独立展示组字段，不能用伪 group/provider id 分组。此前暂停待授权只属历史；本轮用户已明确批准扩展，由 Pet 现有 compat 唯一 owner 维护 pinned-source patch、README/provenance、hash/build 与测试，不另造 runtime owner，不手改 `.source`、`.build`、`.launcher*` 等 generated dirs。链路为 adapter 可选 resolved-model `displayGroup {id,label}` → LLM 校验并 detach → host catalog 再 detach → client directory → 原 ModelSelect 展示 buckets；click/keyboard/current/pending/effort 与 `/model` actions 始终取原 provider/model。统一搜索覆盖组 label、型号 name/id；没有 displayGroup 的普通模型沿用原展示。
- Plugin catalog owner 只在 raw owned_by 上映射 displayGroup，claude→Claude、codex→GPT、缺失→Other；不修改既有 CatalogModel.provider fallback、设置分组和偏好键。插件投影测试与宿主真实链测试分别提供证据，不能互相冒充完成。
- 测试必须覆盖 owned_by 与误导性型号名不一致、缺 owned_by、跨组搜索、隐藏模型、选择后的真实路由身份和 effort。不能用本包自制 selector 替身冒充官方端到端通过。

### D14 AMD2 设置导航鸟形图标（待独立 recheck）
- `settings.section` 当前没有官方 icon 字段。实物 connect 0.4.1 `lib/client.js:168–236` 也是 marker + `currentColor` CSS mask + MutationObserver/dispose，不是 SVG DOM replacement；Pet 用 emoji 伪元素，Memex 用 mask，均按 label 循环匹配且不检查唯一性。本插件复用这种受限生命周期方式，并增强唯一匹配/foreign-marker 排除；不把增强误称为 Pet/Memex 已有保证。
- 仅在 `[role="dialog"] nav button` 中精确匹配本插件当前 label `Magpie`，添加私有 `data-dsh-magpie-settings-nav` marker；若重复匹配无法唯一证明自身行，则不标记。旧 connect 的中文 label `Magpie 网关` 不匹配；英文也为 `Magpie` 时两个行同名，无法唯一定位则不标记任何行。两种情况下均不改旧 connect 的 SVG/属性。
- 即使只有一个英文 `Magpie` 行，若已带 connect 的 `data-dsh-magpie-nav-icon`，也不认领；无 document/body/head 时 no-op。当前源码已包含这些保护，不在本轮规划中覆盖或重复实现。
- CSS 仅作用于该 marker：隐藏自身行 fallback SVG，用本地鸟形 SVG mask 和 `background-color:currentColor` 显示 16px 图标，不依赖外网资源、不写颜色常量、不改变 label/click/焦点行为。SVG 来源和 MIT notice 追加至本包 THIRD-PARTY-NOTICES，既有 notices 不变。
- apply 安装一次样式与 observer，支持设置对话框晚挂载/重建；dispose 断开 observer、移除所有自身 marker 和样式。找不到自身行、缺 document/body 时静默不修改页面。不观察自身写入的 attributes，以免自触发循环。

### D15 AUTO transport 兼容与 actual/next effort 纯显示（AMD2 历史，显示部分由 D16 废止）
- **事实**：`policy-host.ts` 的主 pre-step/request 不按 provider 过滤；新旧 Magpie 的真实 mock adapter 与 request-header 都收到 high。官方 modelSelection 投影保留 pending medium，因此 lastUsed=high、next=medium，selectModel 调用数为0。主 wire 调查证明执行已生效，不证明选择器显示已修复。current auto-model-routing spec:22–34 明确禁止新默认策略为同步显示调用会保存全局 defaults 的 selectModel；legacy:36 起仅限显式回滚，保持原语义。
- **兼容选择**：只扩展 AUTO 的4个源码面（policy-v2 的 POLICY_PROVIDERS/magpieProvider、policy-store、settings-host、subagent-tool）及5份回归测试。新旧 transport 共用分类但不互为 alias；目录、允许列表、持久记录、实际请求仍核对精确 provider + 完整 model ID，保留实时能力、effort cap 与父 captured allowlist。未知能力家族仍须显式模型，不自动把 Magpie 切为本地 claude/codex，不扩大 allowlist。
- **显示选择**：同一 Pet compat owner 在 ModelDirectory 只透出官方已有 lastUsed；当 lastUsed 与 next 的 provider/model 相同且 effort 不同时，在 trigger 和 root effort 行展示“实际 High · 下次 Medium”（英文对应文案亦区分 actual/next）。current/pending/check、effort menu 选中态与提交继续取 next。不同 provider/model、没有 actual 或 effort 相同时沿用普通展示，不凭名称推断请求，不写 selection/projection/global defaults。
- **备选否决**：调用 selectModel 会污染全局默认且覆盖用户 pending intent；把 current 改成 lastUsed 会改变下一次选择与提交；另建 runtime owner 或改 generated dirs 会破坏现有受管构建/provenance边界。
- **验证边界**：兼容套件作者报告 RED45(39pass/6fail)→GREEN45、最终31files/220tests与typecheck通过；显示接缝、宿主产物/build/hash及GUI由各自owner交证，不以兼容套件或主wire调查代验。

### D16 AMD3 官方 effort 同步与单值选择器（2026-10-26，新授权）
- 用户明确废止 D15 的“不调用 selectModel/不写全局 defaults”限制及 actual/next 双值需求；D15 的精确 transport、能力/cap/allowlist 与 child 恢复不变量继续生效。current AUTO spec:23/34 仍是旧发布契约，本 change delta 覆盖新授权范围，暂不做 current-spec sync。
- 默认 policy-v2 在主 `agent/request` 的 `await next()` 与能力解析/模式复核之后得到最终 effort；与官方合成值不同时，复用 index 内 sessionController 生命周期接缝，等待 `selectModel({sessionId,provider:config.provider,model:config.model,reasoningEffort})`，不修改 provider/model。官方 commands.selectModel 验证后 selectForNextRequest，并后台 saveSelection 全局 defaults（rc.2 published types/commands.js:145–168）。不能自行写 defaults 文件或引入第二套 value helper。
- 官方同步异常或 writer 尚不可用时记录 logger warning，保留官方原请求 effort，避免选择器与实际请求再次分裂，也不将目标 effort 标为 applied；相同官方 effort 不调用，MANUAL/无支持/child 不同步。writer 随 controller 注入/卸载而更新，缺失不得静默视为成功；legacy 路径保持原状。真实 AgentLoop 回归证明同次请求同步顺序与无递归。已进入官方 selectModel 的调用不支持取消；切 MANUAL 阻止后续 AUTO 请求，不事后恢复旧值或覆盖用户后来的手选。
- 删除 patch 中 ModelDirectory.lastUsed 透出、actualAndNext locale/caption 及其独有 helper；trigger/root/menu 使用原官方 effortLabel/current 语义。保留 displayGroup 校验/detach、bucket tuple keys、统一 search、click/keyboard 精确真实 identity 和 `/model`。不手改 generated dirs；更新 patch SHA pin，后续正式图须重建五包与 aggregate codec 并重新核对 fingerprint。
- 测试先按新 delta 写 RED：同次真实请求 adapter/header 与官方选择/全局 defaults 一致；同步错误可见且请求不丢；相同 effort、MANUAL、child 零额外同步；单值 trigger/root/effort 与已有分组搜索精确选择回归。此增量待独立 recheck，旧 AMD2 APPROVE 不借用。

## Risks / Trade-offs

- **[pi-ai 升级改变 wire 行为]** → pin 主版本，spec 中的 wire 场景作为回归测试。
- **[Magpie 接口字段漂移，没有版本承诺]** → 宽松解析：缺字段时省略，未知字段忽略，畸形条目丢弃。用 fixture 测试锁定当前形态，升级 Magpie 后跑一次真实只读冒烟。
- **[卡片 403]** → 卡片区单独显示错误，模型和生成不受影响。
- **[DSH 重启时网关不可达，选择器为空]** → 这是有意的取舍（D4）。生成本来也会失败；网关恢复后，用户手动「刷新模型列表」即可，或者等下次启动。
- **[经 Chat 使用 Claude 时，部分能力被网关翻译掉]** → 与 connect 现状相同，不是回退。
- **[拒绝重定向，若 Magpie 前面挂了会重定向的反向代理就会失败]** → 地址直接填 Magpie 的 `/v1`。错误信息为「网关返回了被禁止的重定向」，与 D3 一致，不声称具体状态码。
- **[刷新全部在多账号时放大厂商读取]** → 只由用户点击触发；host 闸门保证同一时刻只有一个刷新；Magpie 对同一请求元组有 30s 限流。
- **[受限 key 冷启动时用量为空]** → 空状态给出管理员操作指引。这是 Magpie 当前版本的行为，插件不绕过。
- **[换 key 后，进行中的生成仍用旧 key 跑完]** → 这是有意的取舍，用户已确认。旧 key 是否失效由 Magpie 管理员决定。
- **[两个 Magpie 插件并存期间，选择器里有两个分组]** → 过渡期可以接受。稳定后禁用旧插件。
- **[AUTO 官方选择同步失败]** → D16 等待官方接口并记录告警，不吞掉失败；保留官方原 effort，使请求与选择保持一致，不静默换模型或停用 AUTO。
- **[外出走 Tailscale 时经 DERP 中继，延迟变高]** → 首实际内容前保留既定 90s 预算，空结构事件不提前切为 60s；该边界不保证任意真实上游延迟都能在预算内完成。

## Migration Plan

1. 实现后在 `dsh.yaml` 增加 `dsh-magpie`（local，`enabled: true`），运行 `dsh build`，再运行一次确认没有变化，然后重启 DSH。
2. 在设置页填地址和 key，选择要显示的模型、设置默认 effort，与 connect 并行试用：日常对话、工具调用、取消、Codex 快速档。
3. 稳定后，先把常用的旧会话手动切换到 `dsh-magpie` route（旧会话保存的是 `dsh-magpie-connect`，不会自动迁移），再把 `dsh-magpie-connect`、`magpie-display-name-shim` 设为 `enabled: false`，运行 `dsh build` 并重启。这一步需要用户确认。之后打开其余历史会话时，可能需要手动重选模型。README 的迁移段要写明这一点（第 2 轮评审 S2）。
4. 回滚：把 `dsh-magpie` 设为 `enabled: false`，运行 `dsh build` 并重启；connect 一直保留可用。credentials 和设置文件都保留。

## Open Questions

原官方接缝缺失已经核实，所需 Pet compat 受管扩展已获本轮授权，不再作为待用户授权的最终 block。AMD3 官方同步与单值显示待本轮证据、独立 recheck 与真实 GUI 验收；未完成不算通过。以下仍属后续事项：Magpie 上游是否在网关端口提供「使用 Codex 重置」的端点；Ken-WSL 是否移除 usip TUN（属网络运维）。
