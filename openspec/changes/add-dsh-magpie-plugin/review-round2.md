## Review Metadata

- **Review round**: 2
- **Prior round**: round 1 — VERDICT: REVISE (C1 cache/generation identity, C2 no generation requirement, C3 cold-start dead end; M1–M7; S1–S2)
- **Reviewer context**: cross-model (codex gpt-6.1-sol, fresh context)
- **Tool restrictions**: read-only: view, grep, glob only (+ openspec validate, sha256sum)
- **Artifacts reviewed**: proposal.md, design.md, specs/, review-round1.md, relevant source files
- **Artifact hashes**:

```text
8a2011497617fcccc2296c29f312da467509cf934df4f4161dc4a9f70fce0cbf  openspec/changes/add-dsh-magpie-plugin/proposal.md
6a64b2d85405d77742cf31541ae07cc821e57d49de88044a5f75e8be4d19ca32  openspec/changes/add-dsh-magpie-plugin/design.md
a102218cf271ebe8c655e5b769959a2313065ae5d843716307bf48b4e7126ac8  openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md
0379775028c50c306a52130dde1e1fb6eaf1ee8995d7f1abcdfb6a88ca9f99f7  openspec/changes/add-dsh-magpie-plugin/specs/sidebar-session-provider-icon/spec.md
7ca88942b81aeeed875f3aba45fd8eab40d9c900b9cc2b2982bec5799e19c0fc  openspec/changes/add-dsh-magpie-plugin/review-round1.md
```

本轮完整重读了四份修订制品及一轮报告/作者回应，不是 diff review。负载前提为一个长期运行的 DSH Host、可以有多个浏览器连接、手动刷新和凭据在其它设置入口被更新；不把当前三个账号/13 个模型的实测当成接口保证。用户确认的产品边界不作为 finding。

执行 `openspec validate add-dsh-magpie-plugin --strict` 返回 `Change 'add-dsh-magpie-plugin' is valid`，sha256sum 成功返回上述散列。当前任务没有实现，未运行实现测试；没有联网、部署、重启或读取任何凭据文件。唯一文件写入是本报告。Anvil 此阶段没有 tasks/test-plan 不构成缺陷。

## Prior-Round Resolution

- **C1 — partially**：换身份清缓存和旧代提交栅栏已有明文约束，但 spec 与 design 对已准备/正在执行的请求作出相反决定，外部凭据更新也未闭环；见 R2-C1。
- **C2 — partially**：生成 requirement 已存在，文本、Chat 工具往返、截断、取消已有场景；Responses stop 的事实错误及关键 wire 验收空洞仍在；见 R2-M3、R2-M5。
- **C3 — partially**：unrestricted key 的空缓存可以显式刷新全部；受限且有 Quotas 权限的 key 不能通过该入口初始化空缓存；见 R2-M2。
- **M1 — partially**：200 未更新、error、asOf 的显示语义有改善，但“不做 host single-flight”的依据误读了网关限流；见 R2-M1。
- **M2 — resolved**：同步触发器、失败状态、replace 发布及官方客户端消费链成立；同代并发是另一个未覆盖问题，见 R2-M4。
- **M3 — resolved**：私有 dispatcher、禁止重定向与第二目标零请求场景关闭了原来的外流路径；错误文案仍有小问题，见 R2-S1。
- **M4 — resolved**：删除不必要的 dsh-magpie-other 收紧，保留 dsh-magpie2 边界，源码无需变化。
- **M5 — resolved**：LAN / OnNetwork、held+Quotas、GUI 独立认证均已改正，不再要求用户一律扩大共享。
- **M6 — resolved**：prepare+prepack、docTier C、exports/client/bundle/files 均列入设计；具体发布与治理检查可以交给后续 tasks。
- **M7 — resolved**：unlimited/display 优先级与可选 resets.until 已有要求及边界场景。
- **S1 — resolved**：移除无需求的 60 秒轮询，保留页面读取与用户刷新。
- **S2 — resolved**：只存快速会话集合，标准删除，重建控制器恢复标准已有场景。

## Findings

### 🔴 Critical (blocking)

#### R2-C1 — 代际契约自相矛盾，凭据外部变化还会留下旧身份状态或持续失败

- **位置**：[spec:36–68](<openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L36-L68>)、[design D4:73–81](<openspec/changes/add-dsh-magpie-plugin/design.md#L73-L81>)。
- **问题**：spec 要求 prepareCall 捕获 key 解析结果、后续只用捕获值，换身份后已准备对象仍向 A 发送；design 却在换代时 abort 上一代全部请求，并在 stream 时重解 key、指纹不同就 error。A 的 gen.signal 已 aborted 时，按 D3 合并该 signal 不可能再满足“请求只发往 A”的场景。换 key 后继续用旧 key 与报错也不能同时成立。另一个具体反例：在 DSH 其它凭据入口把 K1 换成 K2，不经插件 set/unset，且没有定时目录同步；D4 仅在下次目录同步前更新 fingerprint。之后每次 prepare 仍捕获 K1 的代，stream 都读到 K2 并提示重试，但重试并不换代。卡片读取反而会用 K2 发请求，仍提交到 K1 的 gen；K1 早发晚到的结果也仍通过 gen.id 检查。原 C1 的权限隔离缺口由此重现。
- **证据**：DSH 的 [PreparedAdapterCall:117–122](<packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-llm/lib/types/index.d.ts#L117-L122>)明确要求 dispatch 不重读动态连接事实；credentials 要求每个 operation 重新解析而不是每个 HTTP hop 都重解，[credentials:121–129](<packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-credentials/lib/types/index.d.ts#L121-L129>)。宿主已有外部修改事件，[credentials types:69–82](<packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-credentials/lib/types/types.d.ts#L69-L82>)；卡片确实按 key 权限过滤，[quotas_scope.go:121–146](</tmp/magpie-src/internal/gateway/quotas_scope.go#L121-L146>)。
- **最小修法**：选定一种一致的旧调用政策，而非同时要求保留与中止。最便宜且贴合 core 的方案是把一次 prepare+dispatch 定为一个 operation，捕获该 operation 解析的 key、地址与能力；换代立即隐藏旧数据，但不把普通换代的取消信号与已准备调用绑定，dispose/用户取消仍中止。若选择安全取消旧调用，则必须同时修改 spec 场景并说明这是明确的失效结果。对 `credentials/reference-updated` 订阅，并在每个新的远端 operation 开始前比较有效身份、换代及清缓存；发现变化后不能只返回“请重试”而不推进状态。补外部 key 变更、prepare 后换 key/地址、进行中换代和旧卡片晚到的场景，断言请求目标、使用的 key 与最终可见数据。内存 fingerprint 不输出的做法本身可接受，64-bit 截断碰撞不是本轮阻断点。

### 🟡 Moderate

#### R2-M1 — 服务端不是“逐卡单飞”；全量与单卡可重复读取，旧响应还能倒退 UI

- **位置**：[design D8:104–107](<openspec/changes/add-dsh-magpie-plugin/design.md#L104-L107>)、[风险:148](<openspec/changes/add-dsh-magpie-plugin/design.md#L148>)、[spec:281–313](<openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L281-L313>)。
- **问题**：“每张卡片各一次并受同一个 30s 限流”“client 禁用按钮足够”的理由不成立。全量请求的限流键是 `|`，单卡是 `codex|user`，省略 user 又是 `codex|`；它们互不排斥，同一个用户在一页点全量、另一页点单卡就能重复访问厂商。相同 tuple 的第二请求也不会加入首个 in-flight：它马上返回旧缓存。具体次序是第一次刷新阻塞，第二请求取得旧缓存但 HTTP 响应晚到；第一次新值先显示，第二次旧值随后按 spec “替换当前显示”又覆盖它。gen.id 不变，代际栅栏无法解决。仅 provider 非空也没有校验单卡目标来自当前卡片：省略一个实际有 user 的卡片身份可变为刷新该 provider 全部账号。
- **证据**：[gateway.go:882–915](</tmp/magpie-src/internal/gateway/gateway.go#L882-L915>)以 query tuple 计时，锁仅保护时间表、不等待厂商结果；全量分支直接 ReadAllCards，不逐卡记时。[quota_refresh.go:52–59、92–97](</tmp/magpie-src/internal/provider/quota_refresh.go#L52-L59>)明确空 user 是该 provider 的所有账号。多窗口各自禁用按钮不是 Host 的串行边界。
- **最小修法**：不要增加复杂分布式机制。一个每代共享的刷新 gate 即可：进行中请求合并或明确拒绝，单卡与全量相互排斥；若要阻止短时间内交替操作重复读，再加 Host 的简单冷却规则，不能谎称 Magpie 已逐卡去重。Host 校验 `{all:true}` 与单卡是互斥 union，并把单卡 provider/user 绑定到本代已读到的完整卡片身份。响应采用单调 operation 序号，旧 GET/refresh 不得覆盖新结果。补两个客户端、全量与单卡重叠、200 旧快照晚到、未知/省略 user 的请求计数断言。保留“用户手动触发刷新全部”本身，不要求删除恢复入口。

#### R2-M2 — held+Quotas key 的空缓存仍不能通过“刷新全部”初始化

- **位置**：[proposal:39](<openspec/changes/add-dsh-magpie-plugin/proposal.md#L39>)、[design:105](<openspec/changes/add-dsh-magpie-plugin/design.md#L105>)、[spec:252–279、295–298](<openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L252-L279>)。
- **问题**：设计声称刷新全部是冷启动恢复入口，同时允许有 Quotas 权限的 held key。Magpie 当前的 scoped 全量分支只遍历已缓存卡片；缓存为 [] 时遍历零次，POST 仍返回 200 data:[]。这不是 HTTP 失败，用户反复点击仍永远没有第一张卡，正是一轮 C3 的死路。也不能把所有 200 空集合都断言为“尚未读取”：没有账号或没有可见目标也可能没有卡片。
- **证据**：[scopeQuotas:41–50](</tmp/magpie-src/internal/gateway/quotas_scope.go#L41-L50>)为 held+Quotas 返回非空 scope；[gateway.go:904–911](</tmp/magpie-src/internal/gateway/gateway.go#L904-L911>)此时只刷新 `scope.cards(provider.CachedCards(...))`，不会进入 unrestricted 的 ReadAllCards。原先成功冷启动样例只证明 unrestricted 路径，不能推广到 scoped key。
- **最小修法**：不要求插件越权或改 Magpie。在前提/空状态中明确：该 commit 下 scoped key 首次用量需要管理员在 Magpie 侧预热；刷新后仍空时显示可操作的管理员指引及“未返回可见用量”，不得承诺按钮必然初始化，也不得建议自动扩大权限。加入 held+Quotas+空缓存 fixture，断言 zero vendor reads 和正确提示；保留 unrestricted 冷启动成功场景。

#### R2-M3 — Responses 不支持所承诺的 stop 序列，写进 body 也不会实现语义

- **位置**：[spec 生成:117–121](<openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L117-L121>)、[design D2:54–59](<openspec/changes/add-dsh-magpie-plugin/design.md#L54-L59>)。
- **问题**：规范无条件要求两种线协议包含并实现 DSH stop，而选 Responses 的条件又只看 native_endpoints。具体请求为 Codex native Responses + stop=["END"]；在 Responses body 填 stop 不会让该版本网关停止于 END，且现有文本 happy mock 完全观察不到它被忽略。这样“包含字段”与 DSH 的生成停止语义不等价。
- **证据**：DSH [GenerateOptions.stop:513–518](<packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-llm/lib/types/types.d.ts#L513-L518>)要求遇到任一序列停止且不输出该串。Magpie [rRequest/parseResponses:259–325](</tmp/magpie-src/internal/gateway/responses.go#L259-L325>)没有 stop 字段，也不设置 Request.Stop；[Responses 输出构造:1238–1269](</tmp/magpie-src/internal/gateway/responses.go#L1238-L1269>)不转发它。相对地，[Chat:63、93–98](</tmp/magpie-src/internal/gateway/chat.go#L63-L98>)会解析 stop。
- **最小修法**：对非空 stop 明确选 Chat（Magpie 能翻译到原上游），并同步修改协议选择规则，是比增加本地跨 chunk 截断器更便宜的做法；或明确不支持并在发请求前给出可识别错误，不能静默忽略。加带 stop 的真实协议 fixture，断言实际端点、body 以及停止串不进入 DSH 文本。无需为此引入第三套协议。

#### R2-M4 — 同一身份两次目录同步可以后发先至，再被旧结果覆盖

- **位置**：[design D4:80、D5:84–87](<openspec/changes/add-dsh-magpie-plugin/design.md#L80-L87>)、[spec 目录同步:70–90](<openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L70-L90>)。
- **问题**：唯一提交检查是 gen.id，但启动同步与手动 resync、两个设置页 resync 都可能在同一代重叠。S1 读取旧目录后延迟，S2 先返回模型被删除/effort 被撤销的新目录，再由 S1 恢复旧模型/能力、发 replace；lastSyncAt 和错误状态也可以倒退。取消上一代请求不涉及这一情况。15s 超时只是时间上界，不是排序规则。
- **证据**：[spec:77–85](<openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L77-L85>)允许启动/保存和显式同步；[design:80](<openspec/changes/add-dsh-magpie-plugin/design.md#L80>)只比较身份代。Magpie 自己的额度缓存也使用读开始序号保护这种竞态，[quota_refresh.go:24–35、167–180](</tmp/magpie-src/internal/provider/quota_refresh.go#L24-L35>)，但它不能替 DSH 的 /models 客户端排序。
- **最小修法**：每代只允许一个目录同步 in-flight 并复用 promise，或递增同步序号、仅最新启动的操作能提交目录/错误/lastSyncAt；明确选其中一种。补同代 S2 成功早到/S1 成功或失败晚到场景，断言最终目录、状态与发布值。15s 可作为保守首版值接受，但加虚拟时钟超时断言，覆盖 startup/manual 路径，不能宣称首事件 90s 就证明目录 15s 一定足够。

#### R2-M5 — “生成”已有框架，但关键 wire 转换仍能错而所有新增场景全绿

- **位置**：[spec:119–162](<openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L119-L162>)、[design D2:58–59](<openspec/changes/add-dsh-magpie-plugin/design.md#L58-L59>)。
- **问题**：本轮不再是“一条生成 requirement 都没有”，因此不沿用 Critical；但当前 THEN 只测一个 Responses high 文本和一个 Chat 工具结果。它没有验收可收图模型实际读取 attachment 并发图、none 的具体 wire 值、90s/60s 看门狗、SSE 内 error/response.failed、Responses 工具往返，也没有 usage 的数值与缓存语义。具体错误实现把 Responses input_tokens=100、cached=60、cache_write=10 直接当 DSH inputTokens=100，额外再填缓存字段，会重复计费/计上下文；它仍满足“一个 usage 块”。只测“不支持收图时拒绝”也不能证明支持收图时确实发了图。手写双线协议且参考 connect 的转换代码时，这些是插件职责，不是重测 undici。
- **证据**：DSH [TokenUsage:153–173](<packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-llm/lib/types/types.d.ts#L153-L173>)要求 uncached input 与 cache 字段互斥；Magpie [responses.go:1346–1372](</tmp/magpie-src/internal/gateway/responses.go#L1346-L1372>)与[chat.go:978–982](</tmp/magpie-src/internal/gateway/chat.go#L978-L982>)对外 prompt/input 含缓存。Magpie Chat 可先发 [SSE error:1438–1449](</tmp/magpie-src/internal/gateway/chat.go#L1438-L1449>)，然后还发 finish/usage/[DONE]（1458–1465）；不能因见到 DONE 就改回成功。DSH 图片是[不可变附件引用:61–70](<packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-llm/lib/types/types.d.ts#L61-L70>)，不是可直接 JSON 透传给 OpenAI 的 URL。connect 的[转换:793–807](</home/prgrmr/.dsh/profiles/web/node_modules/dsh-magpie-connect/lib/index.js#L793-L807>)甚至把 system message 改成 user，不能用“与 connect 相同”证明正确。
- **最小修法**：把实际线协议 fixture 写清，并为上述高风险分支增加机械 THEN；一条表驱动场景可以同时覆盖两协议，不需要每个字段一条 requirement。至少锁定 system/messages/tools/maxTokens/none 的 body、可收图成功及附件读取失败、缓存 usage 正确数值、SSE 错误永不成功、首事件/空闲超时中止且不重放。规范当前的 12 条 dsh-magpie requirements 和 sidebar modified requirement 在标题层面均有 happy+failure/edge；问题是新增生成场景没有覆盖这些实质行为，不能以达到“一条 happy+一条 edge”的最低数量替代转换验收。

#### R2-M6 — Host 原样透传卡片把“key 永不回显”变成不可保证的不变量

- **位置**：[design D8:103、108](<openspec/changes/add-dsh-magpie-plugin/design.md#L103-L108>)、[D10:122](<openspec/changes/add-dsh-magpie-plugin/design.md#L122>)、[spec:12、241–250](<openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L12-L12>)。
- **问题**：配置的网关可以收到 key，但浏览器设置响应与日志是另一条信任边界。D8 不过滤任何字段、403 又原样给原因，与“任何 HTTP 响应不含 key 明文”矛盾。可机械复现的输入是网关 cards 返回 `{data:[{provider:"codex",error:"invalid Bearer mk-test-123"}],debug:{authorization:"Bearer mk-test-123"}}`，其中 mk-test-123 是 mock key；按当前透传设计浏览器会收到它，即使 React 只显示白名单字段、完全不会执行 HTML，也已经泄漏。这不是假定当前 Magpie 正常路径故意泄漏，而是未来字段/错误代理响应会绕开插件自己的保密承诺。
- **证据**：Magpie 的 [SubscriptionQuota:135–139](</tmp/magpie-src/internal/provider/subscription_usage.go#L135-L139>)允许 provider/plugin 原样错误文本；[codexSubscriptionUsage:902–915](</tmp/magpie-src/internal/provider/subscription_usage.go#L902-L915>)把 error.Error 放进卡片。插件明文 key 只发网关不等于允许网关响应任意内容回流前端。现有“保存 key 后不回显”场景只测设置保存，没经过这条入口。
- **最小修法**：在 Host 以最小字段投影响应，且所有外部错误/允许文本经过统一凭据脱敏（至少去掉本次/仍在飞行操作使用的 key 原文，不打印原响应或异常对象）；未知字段不跨设置 API。若坚持 passthrough，就仍需在 Host 建立等价脱敏边界，不能只依赖 UI 不渲染。补卡片、非 2xx 原因、生成错误中的 mock key 反射场景，断言 HTTP 响应与日志均不含它。HTML 一律文本渲染的要求应保留，但它解决的是执行注入，不是秘密回流。

### 📌 Suggestions

#### R2-S1 — redirect:error 可以安全处理 SSE，但不能按当前写法取得 3xx 状态码

- **位置**：[design:24、64、147](<openspec/changes/add-dsh-magpie-plugin/design.md#L61-L71>)。
- **问题/证据**：`redirect: 'error'` 不妨碍合法 200 SSE；无须因此换传输方案。但 undici 会把 redirect 变成 `unexpected redirect` 网络错误，[fetch/index.js:1187–1189](<packages/dsh-pet/compat/subagent/.launcher/node_modules/undici/lib/web/fetch/index.js#L1187-L1189>)，最终 reject TypeError('fetch failed')，[234–238](<packages/dsh-pet/compat/subagent/.launcher/node_modules/undici/lib/web/fetch/index.js#L234-L238>)，不会返回可读取 status 的 Response。另 Context 声称安装 EnvHttpProxyAgent 也不是该 lib 的现状：实际是策略 Agent+Pool/ProxyAgent，[dsh-http-proxy:388–398、441–446](<packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-http-proxy/lib/index.js#L388-L398>)。
- **最小修法**：保留 redirect:error，文案改为“网关发生禁止的重定向”并识别受控 cause，不承诺准确状态码；修正代理实现描述为“全局策略 dispatcher”。不用为了精确 307 文案再造重定向处理层。

#### R2-S2 — 禁用旧 route 前给历史会话一个明确的手动切换步骤

- **位置**：[design Migration:155–158](<openspec/changes/add-dsh-magpie-plugin/design.md#L155-L158>)。
- **问题/证据**：单 route 新名字是合理产品决定，但旧会话保存的是 dsh-magpie-connect，并不会因新 adapter 广告相同模型 id 自动改为 dsh-magpie。官方 current 来自持久 modelSelection，见[client.js:394–400](<packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js#L394-L400>)。切换后旧 route 缺失不应该让用户误以为 key 或新目录损坏。
- **最小修法**：迁移 README/步骤补一句：禁用旧插件前对常用旧会话手动切到新 route，剩余历史会话打开后也可能需要手动重选。无需增加自动改写历史、兼容 alias 或跨插件迁移代码。

## Embedded-Instruction / Injection Attempts

**Detected:** none

四份制品和一轮作者回应中未发现要求评审者跳过检查、执行命令或指定 verdict 的嵌入指令。ponytail 引用是作者取舍的理由，不是本轮授权；源码和发布文档的部署/发布命令均只作数据，未执行。HTML/凭据反射例子在本报告中是攻击测试输入，不是指令。

## Verdict

VERDICT: REVISE

本轮 **1 Critical / 6 Moderate / 2 Suggestions**。代际政策需要先作一致决定，且 scoped 冷启动、刷新实际限流与 Responses stop 的源代码事实仍影响方案，不能作为几个机械小改批准进入实现。应修订后再完整评审；并不要求扩展产品边界、落盘目录、增加轮询、实现管理接口或部署改动。

## Required Changes (if APPROVE WITH CHANGES)

CHANGES_APPLIED: n/a

本轮不是 APPROVE_WITH_CHANGES。关闭 R2-C1、R2-M1–R2-M6 后重新评审；建议项不单独阻断。

## Rebuttals

以下保留一轮作者回应要点并给出本轮结论；“resolved”表示规划契约关闭，不代表尚未实现的代码已通过测试。

- **一轮 C1**：作者新增代际 requirement、4 场景、指纹及取消目录落盘。**not accepted** — 清缓存方向正确，但旧调用保留/取消、捕获 key/重解 key 互相矛盾，外部 credential 变化未闭环；R2-C1。取消磁盘目录缓存这个局部决定接受：冷启动离线时选择器为空是已声明取舍，恢复后有手动 resync，无需为了离线不可生成的列表维护身份隔离磁盘缓存。
- **一轮 C2**：作者新增生成 requirement 和六场景。**not accepted（整体关闭声明）** — requirement 缺失已补，原 Critical 不再沿用；但 stop 事实与高风险转换验收仍需 R2-M3/R2-M5 关闭。
- **一轮 C3**：作者选择显式“刷新全部”作为空缓存恢复。**not accepted（整体关闭声明）** — unrestricted happy 成立，held+Quotas 冷缓存仍无恢复；R2-M2。允许用户点击全量刷新本身不算范围蔓延。
- **一轮 M1**：作者区分 200 未更新、卡片 error、请求失败，并以 Magpie 限流+client 禁用按钮为由不做 host single-flight。**not accepted** — 显示语义部分接受；限流是请求 tuple，不是逐卡，也不是等待同一个进行中刷新，跨页面/单卡与全量重叠仍成立；R2-M1。asOf 旧读数要求保留，但仍需在刷新 fixture 中真正断言。
- **一轮 M2**：作者补启动/换代/手动同步和 replace 发布。**accepted by reviewer — core replace 即使 route 不变也 emit，官方 remote 监听实际调用 catalog.refresh；不是只听到了无人消费的事件。** 同代请求次序另列 R2-M4。
- **一轮 M3**：作者统一 redirect:error、origin/path 白名单、拒绝含凭据地址并补两种 307。**accepted by reviewer — 拒绝重定向可同时阻止 key/body 外流，合法 200 SSE 不受影响。** 诊断细节见非阻断 R2-S1。
- **一轮 M4**：作者删除 dsh-magpie-other 收紧、保留 dsh-magpie2 边界，sidebar 源码不改。**accepted by reviewer — 符合现有 normalizeIdentity→magpie/magpie-* 规则，旧场景保持完整。**
- **一轮 M5**：作者修正网络 admission、held/Quotas、GUI 认证和 403 提示。**accepted by reviewer — 与该 commit 的 lan.go、quotas_scope.go 和 GUI web 认证相符；scoped 初始化是另一处 API 行为，不推翻已修正的 admission 事实。**
- **一轮 M6**：作者补 prepare+prepack、docTier C、元数据自检，把文档验收放到后续 tasks。**accepted by reviewer — 可发布形态的最低入口已明确，真实发布仍在范围外；后续 tasks 须覆盖实际产物存在性而非只检查字段非空。**
- **一轮 M7**：作者加 unlimited/display 及可选 resets.until。**accepted by reviewer — 不再把无限误报 0%，缺 until 不伪造日期；当前字段边界足够，无需照搬 Magpie GUI。**
- **一轮 S1**：删除 60 秒卡片轮询。**accepted by reviewer — 无实时 SLA，页面读取+手动刷新已满足需求并减少请求与生命周期负担。**
- **一轮 S2**：只存快速集合并加 Host 重建场景。**accepted by reviewer — 不保存默认标准项，状态语义与 subscriptions 一致；本轮不要求复杂会话回收框架。**

**作者另行精简的逐项结论：**

1. **取消独立测试连接，保存即同步**：**accepted by reviewer — 同一受控请求即可验证连通性并给同步结果，无需重复探测 API。** 保存混合字段时仍须先整体 schema 校验；这不是允许先写 key 后才发现 body 无效。
2. **可见性只校验形状**：**accepted by reviewer — 输出始终与当前目录求交集，偏好不是权限边界；保留暂时消失的模型不会扩大网关权限。** 无须为目录抖动拒绝正常保存。
3. **去掉 stale 字段**：**accepted by reviewer — 设置响应已有保存值和当前 reasoning_levels，client 能推导失效；Host 仍在下发前过滤。** 不是删除失效处理。
4. **Host 卡片原样透传**：**not accepted** — UI 字段选择和文本转义无法保证 Host HTTP 不泄漏 key；见 R2-M6。不要求复杂通用 DTO 框架，只需最小响应边界。
5. **设置路由合并为三个资源**：**accepted by reviewer — 路由数不构成安全保证，互斥 schema 和先验证后生效即可；R2-M1 要补 all/单卡互斥及目标绑定。**
6. **删除 XSS 渲染场景**：**not accepted（删除全部插件边界验收的理由）** — 卡片字符串仍明确必须按文本渲染，这是好的；但风险来自插件未来使用的组件/错误显示入口，不只是 React 库本身。可把恶意字符串合入 R2-M6 的一个边界 fixture，断言按字面显示、无可执行节点/事件，不必单独建 requirement 或测试 React 内部。
7. **删除“直连失败不回退代理”单独场景**：**accepted by reviewer — 一个私有 dispatcher 且没有 fallback 分支时可以省掉冗余场景；保留全局代理存在时零代理请求的插件级测试。** 如果后续实现新增 catch/fallback，必须重新补该分支的负例。
8. **删除跨插件并存集成场景**：**accepted by reviewer — 两个不同 route、禁用旧插件需用户确认已有迁移说明，不为暂时并存添加运行时代码。** 最低手工迁移指引见 R2-S2；不要求改写历史数据。

**本轮作者回应（2026-10-25；用户已在连续两轮 REVISE 后授权第 3 轮，并选定代际策略为「进行中的生成按原地址和原 key 跑完」）：**

- R2-C1：已修复。采用评审给的最小修法：一个操作开始时解析一次 key，`prepareCall` 捕获地址、key 和模型能力；换代只中止目录和卡片的后台请求，不中止生成。订阅 `credentials/reference-updated`，另外每个新操作开始时比对指纹，发现变化就先换代再发请求，不再出现「请重试」却始终不换代的死循环。spec 新增 3 个场景（按捕获值跑完、进行中不被中止、外部改 key 触发换代），另有 1 个场景覆盖未收到事件的情况；design D4 已重写。
- R2-M1：已修复。host 每代维护一个刷新闸门，单卡刷新与刷新全部互斥，闸门占用时返回 409；单卡请求必须与当前代读到的卡片完全一致，包括 user；读取与刷新都按单调序号提交。补了非法目标、并发、旧响应晚到 3 个场景。
- R2-M2：已修复。空状态改为「Magpie 未返回可见用量」；刷新全部后仍为空时，提示需要管理员先在 Magpie 中读取一次或改用不受限 key，不承诺一定能产生卡片，也不建议扩大权限。新增受限 key 冷启动场景。
- R2-M3：已修复。请求带非空 stop 时一律走 Chat；补了相应场景（Responses 端点收到 0 个请求）。
- R2-M4：已修复。同一代内只允许一个目录同步在进行，重复触发时复用同一个 promise；补了重复触发和 15s 超时（虚拟时钟）两个场景。
- R2-M5：已修复。新增两种协议共用的请求体与 usage 映射场景（system 位置、tools、maxTokens、none、缓存拆分），以及可收图模型成功发图、附件读取失败、流中错误事件、首事件和空闲超时等场景。
- R2-M6：已修复，撤回第 1 轮「原样透传」的精简。host 把卡片投影为固定字段，所有外部文本统一脱敏；新增网关回显 key 的场景，并把 XSS 场景改为按字面渲染的边界场景。
- R2-S1：已采纳。重定向的报错文案不再声称知道状态码；代理实现的描述已改正。
- R2-S2：已采纳。迁移步骤补充：旧会话需手动切换到新 route，README 中写明。
