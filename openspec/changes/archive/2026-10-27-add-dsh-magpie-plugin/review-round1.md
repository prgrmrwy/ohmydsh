## Review Metadata

- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: cross-model (codex gpt-6.1-sol, fresh context)
- **Tool restrictions**: read-only: view, grep, glob only (+ openspec validate)
- **Artifacts reviewed**: proposal.md, design.md, specs/, relevant source files
- **Artifact hashes**:

```text
f3785068e6ab06ddf18e525dbdb08ca58895f12bdf675940b79e195ec227194f  openspec/changes/add-dsh-magpie-plugin/proposal.md
e159e9e054d3b733009c0c7d251dfe09e8deb391809ad4d5e0c1de98c2f71432  openspec/changes/add-dsh-magpie-plugin/design.md
c5f7bf8b205eae517bef6d3f36592a1a00dd518e6061aec4f7ff5caaffbba2aa  openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie-connector/spec.md
efd37d6b08153ed96254fe13412fdc08c2811a347edc4c475bd1db7675b5ca6f  openspec/changes/add-dsh-magpie-plugin/specs/sidebar-session-provider-icon/spec.md
```

评审对象是规划制品，不是已完成实现。假定单个 DSH Host、可能有多个浏览器连接、长期运行；Magpie 是可重启和换 key 的远端网关，不假定它已经预热用量缓存。已运行 `openspec validate add-dsh-magpie-plugin --strict`，结果为 `Change 'add-dsh-magpie-plugin' is valid`；这不证明接口假设、流协议或安全边界正确。未执行联网、部署、重启、实现测试，也未读取任何凭据文件。Anvil 在此阶段尚无 tasks/test-plan 是正常流程，不列为缺陷。

## Findings

### 🔴 Critical (blocking)

#### C1 — 缓存没有绑定连接身份，换网关/换 key 会继续展示前一个身份的数据

- **位置**：[design D4、D9](</openspec/changes/add-dsh-magpie-plugin/design.md#L55-L60>)；[模型目录 requirement](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie-connector/spec.md#L79-L113>)及[手动刷新卡片 requirement](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie-connector/spec.md#L193-L209>)。
- **问题**：设计只有一个目录缓存，并无 baseUrl/key 变更时的失效、身份隔离或旧请求提交栅栏。具体反例：A 网关成功同步后改成 B，B 返回 503，按当前 SHALL 必须继续列举 A 的模型，却向 B 发送后续会话；同一网关从 owner key 换成 held key，失败保留旧卡片/晚到的 owner 响应也可能让旧账号信息继续可见。即使 B 同步成功，晚返回的 A 同步仍可覆盖它。仅“每请求 resolve key”不能解决跨请求缓存与竞态。
- **证据**：Magpie 目录本身经过 keyAllowed（gateway.go:1079–1083 (`/tmp/magpie-src/internal/gateway/gateway.go#L1079-L1083`)）；卡片经过账号/模型权限过滤（quotas_scope.go:12–25、121–146 (`/tmp/magpie-src/internal/gateway/quotas_scope.go#L12-L25`)）。Magpie 自己明确把远端卡片缓存按 provider 与 key 身份隔离，防止换 key 仍展示旧数据（remote_quotas.go:146–150 (`/tmp/magpie-src/internal/provider/remote_quotas.go#L146-L150`)）。DSH 动态 adapter 还要求 prepareCall 把能力与实际 dispatch 绑定同代（dsh-llm index.d.ts:171–181 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-llm/lib/types/index.d.ts#L171-L181`)）；被参考的 connect 却在 stream 再读地址，不能原样当正确范例（connect index.js:1185–1187 (`/home/prgrmr/.dsh/profiles/web/node_modules/dsh-magpie-connect/lib/index.js#L1185-L1187`)）。
- **建议修法**：将 fallback 明确限制为同一连接身份；baseUrl 或有效 credential 改变时清掉旧目录/卡片可见状态，递增 generation，丢弃旧 generation 的响应与磁盘提交；不得落盘明文 key。prepareCall 捕获同代 endpoint、凭据和能力。补换地址失败、换权限 key、旧响应晚到、prepare 后改地址的场景，明确下一请求与已准备请求各自的行为。

#### C2 — 核心“生成”没有 requirement，D2 的双线协议和 DSH 适配不可验收

- **位置**：[proposal What Changes](</openspec/changes/add-dsh-magpie-plugin/proposal.md#L12-L20>)、[design D2](</openspec/changes/add-dsh-magpie-plugin/design.md#L44-L48>)、[dsh-magpie-connector spec 全部 requirements](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie-connector/spec.md#L5-L272>)。
- **问题**：spec 只有路径白名单、未配置失败、速度字段检查，没有一条要求把有效对话/工具结果传给网关，或把成功响应转换为 DSH 流。D2 的 native_endpoints 分支完全不在 spec 中；一个只发合法路径、带 priority、然后丢掉全部输出的 adapter，仍可满足现有生成相关 THEN。替代执行入口却没有一次可验收的工具往返，是功能缺口，不是测试数量问题。
- **证据**：DSH 的 GenerateOptions 包含 system/messages/tools/stop/signal/sessionId，StreamChunk 规定块索引、tool arguments 原始 JSON、usage 后终止 finish（types.d.ts:409–447、489–530 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-llm/lib/types/types.d.ts#L409-L447`)）；adapter 必须 honor signal，并为 provider 请求加 attributionHeaders（index.d.ts:124–128、183–187 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-llm/lib/types/index.d.ts#L124-L128`)）。Magpie native_endpoints 可能为空（路由组/需要翻译的订阅），并不只存在设计中两种当前样本（native_endpoints.go:5–23 (`/tmp/magpie-src/internal/provider/native_endpoints.go#L5-L23`)）。
- **建议修法**：新增有 happy 与 failure/edge 场景的生成 requirement：Responses 声明命中、仅 Chat、空/未知声明的明确选择；文本与工具调用→工具结果→后续输出的完整往返；effort/none、图片附件读取与不支持图片的失败；usage 与终止原因；取消、首事件/空闲超时、截断不得当成功、重试所有权和已输出后不得自动重放。THEN 断言实际 wire body、输出块与终止码，而非只断言发出请求。无需扩展到 Anthropic 协议。

#### C3 — 用量冷启动为空时没有恢复入口，“只刷新已有单张卡片”形成死路

- **位置**：[只读边界 requirement](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie-connector/spec.md#L53-L64>)、[手动刷新卡片 requirement](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie-connector/spec.md#L193-L204>)、[design D7](</openspec/changes/add-dsh-magpie-plugin/design.md#L75-L78>)。
- **问题**：设计把当前实测的三张卡当成始终存在。Magpie 新进程/新安装可能没有任何用量读数，GET cards 返回空集合且永不问厂商；页面又只给已有卡片刷新按钮。此时轮询多少次都不产生卡片，用户无法从插件完成最初读取。
- **证据**：remote_quotas.go:43–45、75–122 (`/tmp/magpie-src/internal/provider/remote_quotas.go#L43-L45`)明确处理“还没读过”；quotas_remote_test.go:58–69 (`/tmp/magpie-src/internal/gateway/quotas_remote_test.go#L58-L69`)直接证明先读缓存不问厂商，显式 refresh 才读取。网关支持未指定 provider 时读取所有卡片（gateway.go:870–915 (`/tmp/magpie-src/internal/gateway/gateway.go#L870-L915`)），但当前 spec 明确不允许该操作。
- **建议修法**：在规划阶段作出明确选择：增加经过确认、仅用户显式触发的“初始化用量/刷新全部”例外，配合限流并同步修改只读白名单语义；或者保持单卡刷新产品边界，将 Magpie 侧预热写成前置条件，空状态必须给出可操作的管理员指引，不宣称插件可以自行恢复。为 200 data:[] 新增场景，禁止偷偷定时调用 refresh。不能仅给空页加一个没有能力产生卡片的“重试 GET”。

### 🟡 Moderate

#### M1 — 刷新限流是 200 返回旧缓存，不是 429；“成功”不等于重新读过厂商

- **位置**：[design Context、D7](</openspec/changes/add-dsh-magpie-plugin/design.md#L7-L10>)与[手动刷新卡片 requirement](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie-connector/spec.md#L193-L209>)。
- **问题**：当前只测网络/非 2xx 失败，没有真实的限流与厂商失败语义。30 秒内第二次点击可以得到 200、旧 readAt；厂商登录失效也可以得到 200、卡片 error，瞬时 429 甚至会折回旧值与 asOf。若 UI 把 2xx 当成“刷新成功且数据新鲜”，会误报。host 的 single-flight 只合并同时请求，不覆盖连续点击；缺省 provider/user 还可扩大到全部卡片/全部账号。
- **证据**：gateway.go:894–915 (`/tmp/magpie-src/internal/gateway/gateway.go#L894-L915`)按 `provider + '|' + lower(user)` 在读之前记时，不 due 直接 writeCards，无 429；quota_refresh.go:92–99 (`/tmp/magpie-src/internal/provider/quota_refresh.go#L92-L99`)不返回厂商错误；subscription_usage.go:896–917 (`/tmp/magpie-src/internal/provider/subscription_usage.go#L896-L917`)把失败写进 q.Error；quota_last.go:99–119、181–183 (`/tmp/magpie-src/internal/provider/quota_last.go#L99-L119`)可返回带 asOf 的旧快照。
- **建议修法**：明确 transport 成功、卡片 error、未更新/旧快照三种结果，不伪造读取时间。补 30 秒内 200 未变化、200 error、asOf fallback 场景。refreshCard 入参必须绑定当前实际卡片且 provider 非空，按规范化身份单飞；拒绝空 provider、未知 user 和非卡片目标，并断言不会发全量刷新。429 作为普通 HTTP 故障测试可以保留，但不能代表网关自身的刷新限流。

#### M2 — 目录同步时机与设置生效通知没有契约，后台数据变了选择器可永久不变

- **位置**：[design D4–D6、D9](</openspec/changes/add-dsh-magpie-plugin/design.md#L55-L86>)；[模型目录、默认 effort requirements](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie-connector/spec.md#L79-L168>)。
- **问题**：spec 的 WHEN 反复是“目录同步”，却没有谁触发首次同步、保存地址/key 后何时同步、用户如何重新获取目录、何时更新已打开的官方选择器。D7 的 60 秒轮询是 cards，不是 models。实现可以只写缓存/改 adapter 内存，设置页显示成功，但浏览器仍保留旧可见性和默认 effort。
- **证据**：官方客户端目录 ready 后直接复用缓存，需要 refresh/invalidate（client.js:109–112、145–164 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js#L109-L112`)）；connect 为 onInvalidate 专门 emit `llm/adapters-updated`（index.js:1710–1727 (`/home/prgrmr/.dsh/profiles/web/node_modules/dsh-magpie-connect/lib/index.js#L1710-L1727`)），subscriptions 设置默认 effort 后调用 registration handle.replace（index.js:11939–11949 (`/home/prgrmr/.dsh/profiles/web/node_modules/dsh-plugin-subscriptions/lib/index.js#L11939-L11949`)）。
- **建议修法**：选最小同步策略，写清启动/连接变更/显式目录刷新触发器与超时，不必增加无需求的后台轮询。规定可见性、默认 effort 和目录变化发布官方更新通知，补“已打开选择器，无需重启/刷新”的跨层验收，以及失效/取消同步不能覆盖新状态的边界场景。

#### M3 — 路径白名单没有覆盖 HTTP redirect，直连通道能把会话正文带出配置网关

- **位置**：[design D3、D9](</openspec/changes/add-dsh-magpie-plugin/design.md#L50-L53>)；[只读边界、网关请求直连 requirements](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie-connector/spec.md#L53-L77>)。
- **问题**：new Agent 只决定如何连接，不限制跟随重定向。具体反例：`POST /v1/responses` 收到 307 指向另一 origin，默认 fetch 会把完整 prompt/tools/body 原样重发；同 origin 重定向到 `/api/*` 也违反白名单。当前完整流程和 UI 无管理按钮两个场景都不是这种拒绝/异常路径，缺少实际的只读边界 failure/edge 场景。
- **证据**：所装 undici 默认 redirect 为 follow（request.js:897–908 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/undici/lib/web/fetch/request.js#L897-L908`)）；跟随分支和 307 不去掉 body 的行为见index.js:1176–1200、1279–1321 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/undici/lib/web/fetch/index.js#L1176-L1200`)。跨 origin 虽去掉 Authorization，仍会发送正文，不能把“key 未泄漏”等同于“数据未外流”。
- **建议修法**：统一 transport 默认拒绝 redirect（最便宜为 redirect:error），把 allowed origin+path 覆盖到每个实际网络 hop；baseUrl 拒绝 userinfo/query/fragment，避免 secret 通过地址响应/日志旁路出现。补同 origin `/api/*`、跨 origin 307 的失败场景，断言第二目标请求数为 0，日志/响应无 key。这里只评审传输边界，不反对用户确认的直连决定，也不建议禁止合法 LAN/回环网关。

#### M4 — sidebar delta 新增一个未声明的兼容性收紧，且正常新 route 已被现有实现识别

- **位置**：[sidebar delta “dsh-magpie-connector 只按精确名匹配”](</openspec/changes/add-dsh-magpie-plugin/specs/sidebar-session-provider-icon/spec.md#L46-L49>)；[proposal modified capability](</openspec/changes/add-dsh-magpie-plugin/proposal.md#L32-L33>)。
- **问题**：完整原 requirement 及全部原场景已复制，这一点通过；但额外要求 `dsh-magpie-connector-other` 不识别，不只是增加 `dsh-magpie-connector`。现有统一归一化会先剥掉 dsh-，所以它原来按 magpie-* 规则属于 Magpie。为满足新 edge，作者必须改变原有别名/前缀兼容性。反过来精确的 dsh-magpie-connector 今天已能命中，D1 所谓“只需加一个 route 名”并不符合实现。
- **证据**：[logos.ts:49–64](</packages/sidebar-session-provider-icon/src/client/logos.ts#L49-L64>)；当前原 spec 保留 `magpie-` 前缀场景（[spec:106–112](</openspec/specs/sidebar-session-provider-icon/spec.md#L106-L112>)），delta 也保留它。
- **建议修法**：删除无必要的 `dsh-magpie-connector-other` 收紧场景，保留符合现有规则的 `dsh-magpie2` 非匹配 edge；用新精确 route 的正向回归证明当前实现已支持，避免改运行时代码。如果确实要收紧归一化别名，另行明确兼容性变化与全部受影响 route，而不是伪装成扩展识别。

#### M5 — “已由源码确认”的网络鉴权前提写错，不能据此让用户改部署

- **位置**：[design Context](</openspec/changes/add-dsh-magpie-plugin/design.md#L3-L14>)及[proposal Impact](</openspec/changes/add-dsh-magpie-plugin/proposal.md#L39-L42>)。
- **问题**：局域网共享开关并非远端访问的必要条件，MAGPIE_ADDR 监听非回环也满足 remoteKeyed；普通 unrestricted key 不要求另开 Quotas，held key 即使有 Quotas 仍可能因 scope 看不到卡片。另称 Codex reset GUI 路由“只接受本机回环”并非该 commit 的普遍事实：magpie web 可绑定网络地址，GUI API 由独立 web key/cookie 保护。这不改变插件禁止访问 GUI 的已确认边界，但当前诊断会给出错误修复指引。
- **证据**：lan.go:105–118、268–285、489–493 (`/tmp/magpie-src/internal/gateway/lan.go#L105-L118`)；quotas_lan_test.go:63–73 (`/tmp/magpie-src/internal/gateway/quotas_lan_test.go#L63-L73`)明确覆盖未共享、MAGPIE_ADDR 在网络上仍 200；quotas_scope.go:41–50、139–146 (`/tmp/magpie-src/internal/gateway/quotas_scope.go#L41-L50`)；gui/web.go:68–107、240–256 (`/tmp/magpie-src/internal/gui/web.go#L68-L107`)与gui/usage.go:303–328 (`/tmp/magpie-src/internal/gui/usage.go#L303-L328`)。
- **建议修法**：修正接口事实，区分网络 admission、key 有效性、held/Quotas scope 与 GUI 自身认证；保留“不使用 GUI、reset 本次只读”决定。无权读卡时不得一律引导打开更宽的共享或增加权限。无需在本 change 中改任何部署。

#### M6 — 发布形态只要求 prepack，会漏掉仓库明示必需的 prepare

- **位置**：[design D10](</openspec/changes/add-dsh-magpie-plugin/design.md#L88-L94>)与[可独立启用与移除 requirement](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie-connector/spec.md#L256-L272>)。
- **问题**：D10 定义“可发布形态”只列 prepack；若照此实现，npm tarball 可用，但商店/GitHub 源码安装可能没有 lib，插件无法加载。README 场景又把“治理测试通过”当作 Removal 的证明，但当前治理还有 docTier、首屏 problem 标记及 A/B 截图规则，不能只补 Removal 和 tier 表。
- **证据**：[发布文档:358–361](</docs/architecture/dsh-plugin-publishing.md#L358-L361>)明确 prepare/prepack 两个都必需；[治理测试:493–518、548–567](</tests/repo-docs-governance.test.mjs#L493-L518>)有额外要求。
- **建议修法**：在可发布形态中明确 prepare+prepack、dsh.bundle/client/export 与 files 中实际产物；选择 docTier 并满足相应 README 规则。增加 package 元数据的机械检查（含缺 prepare 的负例），而不是本轮提前联网发包/上架。与真正发布的范围隔离可以继续保留。

#### M7 — 卡片白名单丢掉 unlimited/display，会把真实无限额度显示成 0%

- **位置**：[只读用量卡片 requirement](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie-connector/spec.md#L170-L191>)与[design D7 字段过滤](</openspec/changes/add-dsh-magpie-plugin/design.md#L75-L78>)。
- **问题**：规范只保留窗口 name/used/resetsAt，并用 used→百分比作为唯一 happy 样本。Magpie 的窗口可以明确是 Unlimited，此时 used 的 Go 零值仍会序列化成 0。照当前白名单投影后，UI 已无法区分“无限额度”和“有限额度使用 0%”。作为动态 provider 插件，不能只针对当前三张卡的样本固化错误读数。
- **证据**：SubscriptionQuota/QuotaWindow:28–35 (`/tmp/magpie-src/internal/provider/subscription_usage.go#L28-L35`)定义 unlimited/display；Copilot 实际构造:1160–1172 (`/tmp/magpie-src/internal/provider/subscription_usage.go#L1160-L1172`)返回 `Unlimited:true, Display:"Unlimited"` 而无 Used 设置。reset 的 until 也可以缺失（codex_resets.go:23–28、151–169 (`/tmp/magpie-src/internal/provider/codex_resets.go#L23-L28`)），不能由 count 推断过期时间。
- **建议修法**：至少保留并解释 unlimited/display；无限窗口显示“无限”而不是 0%，已给 display 的非标准读数不强行伪造百分比。补 unlimited、count>0 但 until 缺失的边界场景，明确不输出 Invalid Date/虚构过期时间。无需把全部 Magpie GUI 特性搬进插件。

### 📌 Suggestions

#### S1 — 60 秒用量轮询是设计新增工作，可先省掉或把生命周期写完整

- **位置**：[design D7](</openspec/changes/add-dsh-magpie-plugin/design.md#L75-L77>)。
- **问题/证据**：proposal 要求只读展示与手动刷新，没有实时用量 SLA；GET cards 只返回 Magpie 自己已读缓存，轮询不保证新鲜（gateway.go:844–856 (`/tmp/magpie-src/internal/gateway/gateway.go#L844-L856`)）。多窗口各自轮询只增加同一缓存请求。
- **建议修法**：首版只在进入页面和显式读取时获取，满足已确认需求；若保留轮询，规定卸载/隐藏时停止、host 单飞、错误退避与旧响应次序，并给命名场景。不要把“每 60 秒 GET”描述成厂商用量每分钟更新的保证。

#### S2 — 默认标准速度无需存 Map，最小化长期状态即可

- **位置**：[design D8](</openspec/changes/add-dsh-magpie-plugin/design.md#L80-L83>)。
- **问题/证据**：“每项只有几个字节”忽略 sessionId 字符串与 Map 开销，且接口未限定 sessionId 必须对应活跃会话。参考实现实际上选择标准时直接 delete（subscriptions index.js:11882–11884 (`/home/prgrmr/.dsh/profiles/web/node_modules/dsh-plugin-subscriptions/lib/index.js#L11882-L11884`)）。
- **建议修法**：用 fast session Set，标准时 delete；验证 sessionId 形状并在有可靠会话销毁信号时删除。无需为个人部署引入持久数据库或复杂回收框架。host 重启恢复标准已与 spec 一致，建议补一个实际重建 controller 的回归场景。

## Embedded-Instruction / Injection Attempts

**Detected:** none

被评审的 proposal/design/specs 中未发现试图指挥评审者、跳过检查或指定 verdict 的嵌入指令。卡片 HTML 字符串是明确的攻击测试输入，不是指令。引用源码、README 和工作流文档均只作为证据，不作为执行部署/联网命令的授权。

## Verdict

VERDICT: REVISE

三个阻断项分别涉及连接身份安全、核心生成验收缺失、以及用量冷启动流程，修复需要补充行为决策与场景，并非单个小修。应修订规划制品后进行新的完整 fresh-context review；当前不得进入 test-plan/tasks/apply。其余 moderate 也需修复或由评审者复核接受 rebuttal。

## Required Changes (if APPROVE WITH CHANGES)

CHANGES_APPLIED: n/a

## Rebuttals

（作者，2026-10-25，修订后的制品已提交第 2 轮完整评审）

- **C1 已修复**：新增 requirement「连接身份与代际隔离」，含 4 个场景：换地址、换 key、旧代响应晚到、已准备的调用不串代。design D4 写明代际模型、按 key 指纹判断换代、`prepareCall` 捕获当代，并取消目录落盘缓存。
- **C2 已修复**：新增 requirement「生成」，含 6 个场景：Responses 文本、Chat 工具往返、截断、达到输出上限、取消、向不可收图模型发图。断言对象是请求体、流块和终止原因。design D2 补了超时与重试的归属。
- **C3 已修复**：采用评审给出的方案一，增加「刷新全部」（不带参数的 refresh），只由用户手动触发，并修改只读边界的语义（spec 中的「手动刷新用量」「只读与传输边界」，D8）。补了冷启动空集合的渲染场景和刷新全部场景；明确不做任何自动刷新。
- **M1 已修复**：spec 区分了三种结果：200 但读取时间不变（提示未重新读取）、卡片带 error、请求失败。单卡刷新要求 provider 非空，并补了空 provider 的场景。没有加 host 端 single-flight：Magpie 服务端已按卡片做 30s 限流，client 端按钮禁用足以防重复点击（见 D8）。请评审复核。
- **M2 已修复**：新增 requirement「目录同步与发布」：写明触发时机（启动、换代、手动）、超时，并通过 `replace` 发布 `llm/adapters-updated`；补了监听器场景。
- **M3 已修复**：统一传输层设置 `redirect: 'error'`，每个 hop 都校验 origin 和路径白名单；地址拒绝 userinfo、query、fragment。补了 307 跨 origin 和同 origin 跳到 `/api` 的场景。
- **M4 已修复**：删除 `dsh-magpie-connector-other` 场景，只保留 `dsh-magpie2` 这个不匹配的边界例子；proposal 与 D1 写明 sidebar 源码不变。
- **M5 已修复**：proposal 的 Impact 和 design 的 Context 改正了远端访问条件（`LAN || OnNetwork`）、held key 与 Quotas 的关系、GUI 的认证方式；403 时不再一律建议放宽配置（D8）。
- **M6 已修复**：D12 要求 prepare 与 prepack 同时存在，声明 `docTier: C` 并满足 README 规则，另加包元数据自检测试。原「可独立启用与移除」整条 requirement 改为「禁用不删除用户数据」，README 和治理相关内容改由 tasks 验证。
- **M7 已修复**：窗口读数按 `unlimited` > `display` > `used%` 的顺序显示；`resets.until` 可选。补了无限窗口和缺字段时不伪造读数的场景。
- **S1 已采纳**：删除 60s 卡片轮询。
- **S2 已采纳**：速度状态改为只存快速会话的集合，补了 host 重启的场景。
- **作者另行做的精简**（来自同期的 ponytail 过度设计评审，请一并复核）：取消单独的「测试连接」requirement，改为保存即同步；可见性只校验形状；默认 effort 不再返回 `stale` 字段；卡片在 host 端原样透传；设置路由从 9 个 op 合并为 3 个资源路径；删掉了只测 React 或 undici 自身行为的场景（XSS 渲染、直连失败不回退代理），以及跨插件并存的集成场景。
