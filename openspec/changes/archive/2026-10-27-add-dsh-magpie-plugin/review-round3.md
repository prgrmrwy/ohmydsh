## Review Metadata

- **Review round**: 3
- **Prior round**: round 2 — VERDICT: REVISE (R2-C1 generation policy contradiction; R2-M1–M6; R2-S1–S2); round 1 — REVISE
- **Reviewer context**: cross-model (codex gpt-6.1-sol, fresh context)
- **Tool restrictions**: read-only: view, grep, glob only (+ openspec validate, sha256sum)
- **Artifacts reviewed**: proposal.md, design.md, specs/, review-round1.md, review-round2.md, relevant source files
- **Artifact hashes**:

```text
a5ac6bd096f32809856cb466f6fe8f419e15ee9bfc8abd97eb97b4c7bd5a443b  openspec/changes/add-dsh-magpie-plugin/proposal.md
f0fa6caea524b89f5398a33989086631b78693727e82148648d3af307e196bcc  openspec/changes/add-dsh-magpie-plugin/design.md
8389895983a13cec6a6a58fe29b76e591f2997793522594646afe2fe64727d4b  openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md
0379775028c50c306a52130dde1e1fb6eaf1ee8995d7f1abcdfb6a88ca9f99f7  openspec/changes/add-dsh-magpie-plugin/specs/sidebar-session-provider-icon/spec.md
7ca88942b81aeeed875f3aba45fd8eab40d9c900b9cc2b2982bec5799e19c0fc  openspec/changes/add-dsh-magpie-plugin/review-round1.md
b2ca0b6b3a09f519e38ac97c8f33c873e5c2892baf9287e78950aa3f910b2eb7  openspec/changes/add-dsh-magpie-plugin/review-round2.md
```

完整重读了四份制品、前两轮报告及作者回应，并独立追踪 Magpie 714ab8e 和本机 DSH 0.2.0-rc.2 接缝，不是 diff review。负载假定为一个长期运行的 Host、多个设置页/浏览器、并发生成及外部凭据更新。所有者决定的「已准备/进行中生成按捕获的旧地址和旧 key 跑完，换代只中止目录/卡片请求」作为前提接受，不重新要求安全取消。

`openspec validate add-dsh-magpie-plugin --strict` 返回 `Change 'add-dsh-magpie-plugin' is valid`；两次 sha256sum 一致。未运行实现测试、联网、部署或重启，未读取凭据文件。唯一写入是本报告；未写记忆、测试文件或临时占位报告。此阶段没有 tasks/test-plan 不列缺陷。

## Prior-Round Resolution

- **R2-C1 — resolved**：新 spec:48–55 与 design D4 明确捕获/保留生成、后台换代取消、dispose 取消的不同边界，事件订阅和新操作指纹检查关闭原来的永久重试死循环；环境热变更的例子另见 R3-S1。
- **R2-M1 — partially**：单卡完整目标校验、互斥 union、Host 刷新闸门及旧 GET 晚到场景成立；单调序号仍遗漏「刷新先发、缓存 GET 后发」的反方向次序，见 R3-M3。
- **R2-M2 — resolved**：不再把任意空集合判为尚未读取，受限 key 冷启动提示与源码一致，不承诺全量刷新必能初始化。
- **R2-M3 — not resolved**：改走 Chat 仅修复客户端到网关这一跳；Codex/Responses-only 上游仍丢 stop，见 R3-M2。上一轮提出的最便宜修法本身不充分，本轮明确纠正。
- **R2-M4 — resolved**：同代目录同步共享 promise 加 15 秒虚拟时钟场景，已消除该同代覆盖竞态。
- **R2-M5 — partially**：none、system、附件失败、Chat 错误及看门狗有明显改善；缓存写入被重复计数，部分 wire THEN 仍不够机械，见 R3-M1、R3-M4。
- **R2-M6 — resolved**：已撤回原样透传，改固定投影、外部字符串脱敏、401 生成错误反射与字面 HTML 渲染场景；按操作持有 key 的范围接受，不要求永久保存全部历史 key。
- **R2-S1 — partially**：Context 与 D3 已纠正，但风险段仍保留「收到 3xx」的旧文案，见 R3-S2。
- **R2-S2 — resolved**：迁移步骤明确旧 route 不自动迁移，常用旧会话先手动切换，README 同步说明；无需兼容 alias 或改写历史。

## Findings

### 🔴 Critical (blocking)

无。未发现需要推翻单 route、只读网关、私有直连或所有者代际政策的根本缺陷。

### 🟡 Moderate

#### R3-M1 — usage 减了缓存读取却没减缓存写入，规范直接要求重复计数

- **位置**：[spec:160、180–185](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L160-L185>)；[design:68](</openspec/changes/add-dsh-magpie-plugin/design.md#L68>)。
- **问题**：总输入 1000、读缓存 600、写缓存 50，规范要求 `inputTokens:400` 后再加读 600、写 50，输入合计变成 1050。正确未缓存输入为 350。尤其 Claude 经 Chat 走缓存写入时不是理论边界，Magpie 本身已有对应测试。缺缓存详情时也不能用固定比例推断缓存。
- **证据**：DSH TokenUsage:153–173 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-llm/lib/types/types.d.ts#L153-L173`)要求 input/read/write 三者不重叠。Magpie 的 Usage.prompt:426–430 (`/tmp/magpie-src/internal/gateway/ir.go#L426-L430`)明确总输入等于三者之和；Responses:1360–1372 (`/tmp/magpie-src/internal/gateway/responses.go#L1360-L1372`)自身也减读和写；Chat:978–982 (`/tmp/magpie-src/internal/gateway/chat.go#L978-L982`)使用同一总输入口径。Claude Chat 测试:61–66 (`/tmp/magpie-src/internal/gateway/claude_chat_usage_test.go#L61-L66`)实际断言 prompt=6426、cache_write=6416、cache_read=0。
- **最小修法**：design/spec 同步改为 `inputTokens = max(totalInput - cacheRead - cacheWrite, 0)`，明确两协议实际字段为 `input_tokens_details` / `prompt_tokens_details` 中的 `cached_tokens`、`cache_write_tokens`；将该 THEN 的 400 改为 350。补无缓存详情时 total=1000 → input=1000、cache 字段省略或零的明确规则，不伪造缓存。对不一致计数不得生成负 input，亦不得保留一个与分项矛盾的 totalTokens。无需建设通用计费层。

#### R3-M2 — 把带 stop 的 Codex 请求改为 Chat，网关第二跳仍会丢掉 stop

- **位置**：[proposal:12](</openspec/changes/add-dsh-magpie-plugin/proposal.md#L12>)；[design:58–63](</openspec/changes/add-dsh-magpie-plugin/design.md#L58-L63>)；[spec:151、187–190](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L151-L190>)。
- **问题**：`codex/gpt-6.1-sol` + stop=["END"] 到达 Chat 的确会被解析，但 ChatGPT 账号只提供 Responses，网关随后把内部 Request 再构造成 Responses，那里仍没有 stop。模型返回 `aENDb` 时插件按当前设计会全部输出，新场景却只检查第一跳 endpoint/body，仍然全绿。不能把“网关接收 Chat”当作“它能让任何上游实现 stop”。这是上一轮建议没有追完第二跳的评审遗漏，不应归咎作者未照做。
- **证据**：DSH stop:513–518 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-llm/lib/types/types.d.ts#L513-L518`)要求停止串不进入输出。parseChat:83–98 (`/tmp/magpie-src/internal/gateway/chat.go#L83-L98`)保存 stop，但 Codex provider:1015 (`/tmp/magpie-src/internal/provider/account.go#L1015`)只设置 Responses endpoint。attempt:3883–3903 (`/tmp/magpie-src/internal/gateway/gateway.go#L3883-L3903`)选择上游协议，translate:6006–6047 (`/tmp/magpie-src/internal/gateway/gateway.go#L6006-L6047`)解析后进入 translated stream；build:6312–6317 (`/tmp/magpie-src/internal/gateway/gateway.go#L6312-L6317`)在 Responses 分支调用 buildResponses，后者1238–1269 (`/tmp/magpie-src/internal/gateway/responses.go#L1238-L1269`)不写 stop，也没有本地 stop 截断器。native_endpoints 还是转发优化元数据，不是 stop 能力声明。
- **最小修法**：首版最省事且可证明的政策是对非空 stop 在发请求前明确失败，例如 `MAGPIE_STOP_UNSUPPORTED`，并同步 proposal/design/spec；不凭 native_endpoints 推断能端到端执行 stop。常规对话本来不带 stop，保留普通生成与 Fast 不受影响。若产品坚持成功处理 stop，再实现插件侧跨 chunk 截断与上游中止；不能继续写“Chat 一定解决”。验收需断言失败时零网关请求；若选择支持，则必须断言 `aE`/`N`/`Db` 等分片只输出 `a`，正常终止、关闭上游且不重放，而非只测 body 有 stop。

#### R3-M3 — 后发的缓存 GET 可以抢先占序号，丢弃用户刷新出来的新值

- **位置**：[design:125–127](</openspec/changes/add-dsh-magpie-plugin/design.md#L125-L127>)；[spec:361–365、392–395](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L361-L395>)。
- **问题**：现有场景只测 GET 先发、刷新后发。反过来：用户刷新 F(seq=1) 正在等厂商；另一页打开后发 GET G(seq=2)，Magpie 立即返回刷新前缓存 T1，G 提交；F 最后返回新值 T2，却因 seq=1 被丢弃。结果同一代仍显示 T1，用户已经完成的刷新没有效果。刷新闸门只限制 POST，不限制 GET，代际检查也因仍为同一代而无效。
- **证据**：quotaCards:844–856 (`/tmp/magpie-src/internal/gateway/gateway.go#L844-L856`)明确 GET 只读现有缓存；refresh:901–915 (`/tmp/magpie-src/internal/gateway/gateway.go#L901-L915`)等待读取完成后才 writeCards。故请求发起顺序不等于卡片新鲜度顺序。新 spec 允许打开页面发 GET，并要求较小已返回序号一律丢弃，已足够构成该确定性反例。
- **最小修法**：保留一个刷新闸门；刷新在进行时，新卡片 GET 等待该刷新结算，再从结算结果或随后的一次 GET 回答，不让它从旧缓存产生一个更大的提交水位。无需增加全局分布式锁或凭 readAt 猜新旧。补 F 先发/G 后发/G 原本可先返旧缓存的场景，断言最终 T2。明确代际检查与同代序号都须通过；400/409 不是卡片结果，不得推进提交序号、替换卡片或释放另一个请求的 gate。409 的客户端应结束自己的 loading、保留原卡片并允许之后重试；“按钮禁用”指本客户端刷新请求未结算期间，不要求没有通知通道的其它页面预知 Host gate。

#### R3-M4 — wire 验收仍未固定实际字段与 Responses 工具往返，错误编码可通过全部场景

- **位置**：[spec:174–205](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L174-L205>)；[design:64–69](</openspec/changes/add-dsh-magpie-plugin/design.md#L64-L69>)。
- **问题**：Chat 的“最大 token 字段为100”没有字段名，错误的 `maxTokens:100` 也能满足文字。图片只测一个 Chat 模型且只断言含 data URL，使用错误的 Responses/Chat 包装结构仍可通过。Responses 工具往返和 `response.failed` 仍没有自己的可执行 fixture；现有 Chat 工具场景不能证明 Responses 的 `call_id`/`function_call_output` 编码成立。这不是要求穷举 SDK，而是插件自己手写的不同分支尚未被验收锁住。
- **证据**：Magpie cRequest/parseChat:59–87 (`/tmp/magpie-src/internal/gateway/chat.go#L59-L87`)只接受 `max_completion_tokens` / `max_tokens`，不接受 camelCase；chatParts:166–185 (`/tmp/magpie-src/internal/gateway/chat.go#L166-L185`)要求 `{type:"image_url", image_url:{url:...}}`，而 responsesParts:870–883 (`/tmp/magpie-src/internal/gateway/responses.go#L870-L883`)要求 `{type:"input_image", image_url:"..."}`。两者的 data URL 本身均被 imagePart:217–225 (`/tmp/magpie-src/internal/gateway/chat.go#L217-L225`)接受，因此不反对 data URL。Responses 工具输入:378–408 (`/tmp/magpie-src/internal/gateway/responses.go#L378-L408`)区分 `function_call` 与 `function_call_output`、以 call_id 配对；失败事件:1573–1588 (`/tmp/magpie-src/internal/gateway/responses.go#L1573-L1588`)即使没有 error 对象也属于失败。
- **最小修法**：给 Chat 选择一个精确合法字段（例如统一 `max_completion_tokens`）并断言值=100、错误 camelCase 不存在；将发图场景表驱动到两协议，断言上述完整内容结构及字节。补一条 Responses 工具调用→匹配 call_id 的结果→下一次文本的往返，以及 response.failed 无 error 对象后不得成功的 edge。把已有 Fast 场景参数化到两协议，断言 Chat 用 reasoning_effort、两者都带 priority；如果按 R3-M2 拒绝所有 stop，不再要求不存在的 stop→Chat 成功分支。可以扩展现有场景，不新增 requirement、不增加第三套协议或在线测试。

### 📌 Suggestions

#### R3-S1 — “只改环境变量，下次 resolve 就发现”不符合实际 Host 的启动快照

- **位置**：[design:27、89–90](</openspec/changes/add-dsh-magpie-plugin/design.md#L87-L90>)；[spec:89–92](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L89-L92>)。
- **问题**：每操作 resolve 和指纹兜底本身正确，但宿主正常路径的进程环境不是实时可变来源。直接在 mock 里改环境能绿，不证明真实 Host 会热读；外部编辑凭据文件也要等 credentials watcher 发布快照，插件不能保证磁盘刚写完的那个瞬间已识别。
- **证据**：credentials-local:428–430、473–489 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-credentials-local/lib/index.js#L428-L489`)通过 launchEnvironmentOf 解析 inherited；launch-environment:30–52 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-launch-environment/lib/index.js#L30-L52`)将启动变量复制为不可变 Map。文件热更新在 reconcile:723–733 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-credentials-local/lib/index.js#L723-L733`)提交 values 后发事件，事件的 fanOut:135–142 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-credentials/lib/index.js#L135-L142`)不等待异步 listener。
- **最小修法**：把无事件场景改为“credentials.resolve 的有效结果在 mock 中由 K1 变 K2、未发事件”，保留防御性检查；说明启动环境换 key 需重启，文件变化以服务观察/发布为起点。实现时在事件入口先同步失效旧可见状态，再异步 resolve/同步目录；避免仅依赖 async listener 被 credentials.set 等待这一不存在的保证。无需让插件绕过 credentials 读取文件或自行 watch。

#### R3-S2 — 重定向风险段还有一处旧诊断文案

- **位置**：[design:170](</openspec/changes/add-dsh-magpie-plugin/design.md#L170>)。
- **问题/证据**：D3 已写对，但 Risks 仍要求文案“收到 3xx”。undici 1186–1189 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/undici/lib/web/fetch/index.js#L1186-L1189`)把 redirect:error 变为 network error，不能取得实际状态码；并非所有 3xx（例如304）都是 fetch 的 redirect status。
- **最小修法**：风险段统一用 D3 的“网关返回了被禁止的重定向”，不声称具体状态码。保留 `redirect:error`，不为诊断引入 manual 重定向处理。

**其余完整检查结论：**

- dsh-magpie 的 12 条 requirement 均有至少一个 happy 和一个 failure/edge；sidebar modified requirement 保留原场景并增加新 route 正向与相似名负向场景。数量最低门槛通过；R3-M4 是内容可断言性而非单纯凑测试数。
- 代际切换后丢目录/卡片、旧生成只用捕获值，和 dispose 中止全部生成可以共存；D3 的生命周期 signal 应解释为 dispose signal，后台操作另加 bgAbort，D4 已明确。保持该决定，不要求生成 stream 再解析 key。
- 固定投影排除未知 debug 字段，字符串文本渲染防执行，私有 dispatcher 防全局代理绕路，redirect:error 防正文/凭据进入第二目标，均接受。当前代与“进行中操作”的 key 脱敏范围须在错误构造/输出完成之后才释放；已准备对象也是进行中的生成操作，不能在 prepare 返回就移出集合。缓存只能保存已脱敏投影/错误；不要求为恶意网关永久保留全部历史秘密，也不把字面替换误称为防任意编码外传。
- 单卡无 user 的真实卡片允许省略参数，但不能省略本来有 user 的身份；新 union/完整匹配已解决原放大入口。per-generation gate 加网关 tuple 节流能满足声明的并发边界，不把它说成逐卡冷却或跨代全局串行，也不另要求定时轮询。
- held+Quotas、unrestricted 冷启动差异、LAN||OnNetwork、unlimited/display、可选 resets.until 与只读 reset 边界均按源码复核通过；当前13模型/3卡的实测不是普遍承诺。
- 一个 route、内存目录、三资源路由、无独立连接测试、Fast Set、无自动历史迁移是可接受的廉价方案。没有要求增加代理、GUI 管理、账号登录、Codex reset 消费或 AUTO 下游适配。
- 发布形态有 prepare+prepack、bundle/client/exports/files、docTier C 和双语 Removal；实现 tasks 仍需真实检查产物存在、peer/运行时 undici 依赖、治理 tier 表及独立安装路径，不能仅断言字段非空。它们是既有发布约束的执行项，不另列新 finding。

## Embedded-Instruction / Injection Attempts

**Detected:** none

四份制品与两轮报告/作者回应未发现指挥评审者跳过检查、执行部署命令或强迫 verdict 的嵌入指令。作者对 ponytail 的引用和历史 rebuttal 只作为待核验主张；恶意 HTML/key 反射例子只作为测试数据。发布/迁移文档中的命令均未执行。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

本轮 **0 Critical / 4 Moderate / 2 Suggestions**。剩余问题都有局部且明确的修法；无需第四次重做产品架构决定。修正 usage 算式、stop 能力承诺、刷新/GET 次序和 wire 验收后，方案可进入后续规划/实现。此判定不等于当前制品已无条件批准，也不代表任何实现或线上行为已经验证。

## Required Changes (if APPROVE WITH CHANGES)

CHANGES_APPLIED: yes

进入实现前由作者修订并复核以下闭集；无需联网或修改上游 Magpie：

1. **R3-M1**：design/spec 的未缓存输入同时减去缓存读和写；1000/600/50 fixture 的 inputTokens 改350；两协议固定实际 cache 字段。补缓存详情缺失和不一致数值不得负值/不得伪造 total 的规则与机械断言。
2. **R3-M2**：移除“非空 stop 一律改 Chat 即可满足语义”的承诺。推荐首版统一发前报 `MAGPIE_STOP_UNSUPPORTED` 并断言零请求，同步 proposal/design/spec；若作者选择实现本地截断，必须补跨 chunk 停止串、只输出前缀、终止/取消/不重放验收，且不得再依赖网关转换保证。评审不再坚持上一轮不充分的 Chat 建议。
3. **R3-M3**：明确刷新中的新卡片 GET 等刷新结算，不得用旧缓存抢占更大序号；补 F先发/G后发最终T2场景。代际检查与序号检查共同生效；400/409不推进卡片提交水位、不清他人的gate。409返回后本客户端结束loading、保留卡片并能重试，不引入无需求的跨浏览器状态推送。
4. **R3-M4**：固定 Chat 最大 token 字段名；两协议断言实际图片内容形状与字节；补 Responses 工具往返（call_id配对）、response.failed 无 error 对象的失败场景；Fast/effort 断言覆盖两协议。不需要穷举每个 JSON 字段或增加第三线协议。
5. **R3-S1、R3-S2（顺手修正文案）**：无事件 fixture 改为 credentials有效结果变化，不承诺热读启动环境；说明文件变化从credentials已观察发布算起，事件处理不依赖被异步等待。风险段统一重定向诊断。两项不单独阻断，但与以上修订一起完成最便宜。

复核时重跑 strict validate 并重算制品散列；本报告的 CHANGES_APPLIED 保持 no，直到有针对上述修改的独立证据。后续 test-plan/tasks 应保留所有已关闭的一、二轮安全/兼容场景，不因本轮只列局部修改而删除。

## Rebuttals

逐项核对第二轮末尾「本轮作者回应」，以下 resolved 只指规划契约，不指实现通过：

- **R2-C1**：**accepted by reviewer — 捕获旧地址/key跑完与所有者决定、PreparedAdapterCall契约一致，bgAbort和dispose signal已分离，外部事件/新操作均能推进换代。** 环境来源表述按R3-S1校正，不重开生成政策。
- **R2-M1**：**not accepted（完全解决声明）** — union、完整身份和Host gate局部接受；单调序号漏了刷新先发/缓存GET后发，见R3-M3。无需再争论网关tuple是否等于单飞，作者已改正该事实。
- **R2-M2**：**accepted by reviewer — 空状态不再承诺首次读取，明确受限key需要管理员预热，与scope遍历缓存的源码吻合。** 不要求客户端模拟厂商调用计数或改上游测试框架。
- **R2-M3**：**not accepted（完全解决声明）** — 作者落实了上轮建议，但评审建议本身遗漏第二跳；Codex仍翻译成无stop的Responses，R3-M2给出更便宜且真实的显式不支持修法。
- **R2-M4**：**accepted by reviewer — 同代共享promise已使两个同步不再并发，15秒超时与失败保留当前代目录均有断言。** 不要求在已单飞后再加冗余目录序号。
- **R2-M5**：**not accepted（完全解决声明）** — system/none、附件失败、Chat错误、超时与不重放局部接受；写缓存算式有实错，Responses工具/图片与Chat token字段仍不够机械，R3-M1/R3-M4。
- **R2-M6**：**accepted by reviewer — Host固定字段投影并在出设置API/日志前脱敏，401生成错误反射和字面HTML场景关闭原透传漏洞。** 当前代/进行中操作范围作为有限安全承诺接受；不要求无限历史key黑名单。
- **R2-S1**：**accepted by reviewer（主体）— D3不再索取不可得的状态码，全局代理描述已符合策略Agent；仅Risks旧句需R3-S2清理。**
- **R2-S2**：**accepted by reviewer — 禁用旧route前手动迁常用会话、历史会话再选的步骤已明确，无需增加自动迁移功能。**

**本轮作者回应（2026-10-25，按 Required Changes 修订，待评审定向复核）：**

- R3-M1：已修复。spec 生成 requirement 改为 `max(总输入 - cacheRead - cacheWrite, 0)`，并写明两种协议的实际字段名；fixture 的期望值改为 350；新增场景「缺缓存详情与不一致计数」（没有缓存详情时按 1000 计，计数不一致时为 0，不出现负数）。design D2 同步修改。
- R3-M2：已修复，并撤回「带 stop 改走 Chat」。非空 stop 在发请求前报 `MAGPIE_STOP_UNSUPPORTED`，同时断言网关请求数为 0。proposal、design D2、spec 已同步。DSH core 中没有调用方传 stop（grep 确认）。
- R3-M3：已修复。刷新进行中到达的 GET 等刷新结束后取刷新结果；同代内的 GET 共享同一个 Promise；400、409 和请求失败不推进序号，也不释放闸门；客户端收到 409 时结束自己的加载状态，保留原卡片。新增场景「刷新进行中打开的页面得到刷新结果」和「409 不改变卡片与闸门」。design D8 同步修改。
- R3-M4：已修复。Chat 固定使用 `max_completion_tokens`，并断言请求中没有 `maxTokens`；图片场景覆盖两种协议，断言完整结构和字节；新增 Responses 工具往返（`call_id` 配对 `function_call_output`）；`response.failed` 不带 error 对象的情况并入「流中错误事件不当成功」；effort 与 Fast 场景都覆盖两种协议。
- R3-S1：已采纳。无事件场景改为由 credentials mock 返回变化后的有效值；design D4 写明启动环境是快照、修改需要重启；文件变化以 credentials 服务发布为准；事件入口先同步让旧状态失效。
- R3-S2：已采纳。风险段的重定向文案与 D3 统一。
- **作者另行修改（请一并复核是否引入新问题）**：design D2 改为复用 `@earendil-works/pi-ai`（MIT，0.87.x）实现两种线协议，与 dsh-magpie-connect、官方 dsh-llm-pi-ai 的做法相同，插件只做桥接；`gatewayFetch` 通过 pi-ai 的 `options.fetch` 注入，所以直连、拒绝重定向和白名单仍覆盖生成请求。Chat 的 Fast 通过 pi-ai 的 `onPayload` 写入 `service_tier`。依据是 pi-ai 源码：usage 同时减去缓存读和写（openai-completions.js:1160–1180、openai-responses-shared.js:440–450）；`response.failed` 不带 error 也会抛错（openai-responses-shared.js:643–655）；Chat 默认用 `max_completion_tokens`；Responses 透传 `service_tier`。proposal 的 Impact 补上了依赖说明。

## Re-check (round 3 required changes)

定向复核（codex，fresh context，2026-10-25）：仅检查 Required Changes 1–5 及作者新增的 pi-ai 复用，不重开此前接受的产品边界或「prepareCall 捕获旧 key/origin 跑完」政策。本节只判断规划契约，不代表实现测试或线上行为已通过。复核期间检测到 design/spec 被并行补充，以下结论基于重新读取后的最终散列；此前的临时结论不作为本节依据。

### Artifact SHA-256

```text
97baafe417cfbd8072a919de9a37a35b1a413524eb33422c0704377652af65cc  openspec/changes/add-dsh-magpie-plugin/proposal.md
1dd47405631b028e5bb1b375e6520494a969652986e169719891ec0c448d202a  openspec/changes/add-dsh-magpie-plugin/design.md
44e45ebf7f2ef93c88356d329fe7c60521441bf4c7e292fe5b8eebe021ecb346  openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md
0379775028c50c306a52130dde1e1fb6eaf1ee8995d7f1abcdfb6a88ca9f99f7  openspec/changes/add-dsh-magpie-plugin/specs/sidebar-session-provider-icon/spec.md
```

### Required Changes 逐条结论

1. **R3-M1 — not applied（主体已修，但 total 政策需纠正）**：[spec:162、193–204](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L162-L204>) 与 [design:73](</openspec/changes/add-dsh-magpie-plugin/design.md#L73>) 已固定两协议字段、同时减读写、350 fixture、无缓存详情按零和不一致计数钳零，也新增了不透传矛盾 total 的机械断言。但最新修订改为**任何 usage 都禁止 totalTokens**，超出了「不一致时省略」，反而丢弃可得且一致的精确总量。DSH TokenUsage:164–168 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-llm/lib/types/types.d.ts#L164-L168`) 明确要求保留 provider total 或从权威总输入/输出导出，只在 unavailable/inconsistent 时省略。**需修改**：正常 1000 输入、20 输出、缓存 600/50 时保留或导出 `totalTokens:1020`；100 输入却缓存读600的异常 fixture 则省略 total。design/spec 同步，不直接信任 pi-ai 的 total。无需新增计费层。
2. **R3-M2 — applied**：[proposal:12](</openspec/changes/add-dsh-magpie-plugin/proposal.md#L12>)、[design:68](</openspec/changes/add-dsh-magpie-plugin/design.md#L68>)、[spec:153、206–209](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L153-L209>) 已一致拒绝非空 stop；双协议 fixture 明确 `MAGPIE_STOP_UNSUPPORTED` 和零请求，不再把 Chat 第一跳误当成端到端保证。
3. **R3-M3 — applied**：[design:131–133](</openspec/changes/add-dsh-magpie-plugin/design.md#L131-L133>)、[spec:382–386、413–426](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L382-L426>) 已规定 GET 等刷新并复用结果，F先发/G后发最终T2可断言；代际与序号须同时通过，400/409/失败不提交、不释放他人闸门，409结束本客户端loading、保留卡片并允许重试。
4. **R3-M4 — applied（验收契约层面）**：[spec:171–226](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L171-L226>) 固定 Chat `max_completion_tokens:100` 且无 camelCase，双协议图片结构及解码字节、Responses `call_id` 工具往返、无 error 对象的 `response.failed` 均有机械断言；[Fast:445–448](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L445-L448>) 覆盖两协议。pi-ai 默认行为与部分既有 fixture 不同，属于下面新增的桥接问题，不否认这些验收要求已经补上。
5. **R3-S1/S2 — applied**：[spec:89–92](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L89-L92>) 已用有效 credentials mock 变化而非热改启动环境；[design:95–96](</openspec/changes/add-dsh-magpie-plugin/design.md#L95-L96>) 明确启动快照、文件变化以服务观察发布为起点、事件入口同步失效且不等待 async listener；[Risks:178](</openspec/changes/add-dsh-magpie-plugin/design.md#L178>) 重定向诊断已统一，不声称状态码。

### 作者另行修改：pi-ai 复用

**方向可接受，传输与 Fast 主张有源码支持；但存在一个新的 Moderate：默认 wire 映射与现有契约不一致，不能仅写“由 pi-ai 实现”而略过桥接修正。**

- **传输 verified**：本机 pi-ai 为0.87.1（MIT），官方依赖为 `^0.87.1`。两个指定模块分别在 Chat:186、557–562 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js#L557-L562`)、Responses:111、200–205 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js#L200-L205`) 把 `options.fetch` 交给 OpenAI SDK；SDK client:157、486–507 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/openai/client.mjs#L486-L507`) 调用该 fetch，SSE parse:7–14 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/openai/internal/parse.mjs#L7-L14`) 读取同一个 Response，而不是另走网络客户端。所选两个普通 OpenAI 模块没有 WebSocket 路径。因此以**捕获代际**绑定的 fetch 包装器强制私有 dispatcher、`redirect:error`、origin/方法/路径白名单及授权头可以成立；未发现 SDK 绕过它发送生成 HTTP/SSE 的证据。`options.fetch` 的一般类型说明不覆盖 WebSocket，但这里未选择 Codex WebSocket 模块，不据此列风险。
- **Fast/usage/图片/工具/失败 verified**：Chat onPayload:187–197 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js#L187-L197`) 在发送前可原地修改或替换 body，故能加入 `service_tier`；Responses 236–237 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js#L236-L237`) 映射 `serviceTier`。Magpie chat:83–84 (`/tmp/magpie-src/internal/gateway/chat.go#L83-L84`) 会解析 tier/Fast；其 Responses输出:1256 (`/tmp/magpie-src/internal/gateway/responses.go#L1256`) 支持 OpenAI/Codex priority。Chat 默认 token 字段、两协议图片形状、`call_id` 配对、同时减缓存读写以及无 error 的 `response.failed` 抛错均与作者引用相符；但 Responses usage:439–450 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js#L439-L450`) 仍原样保留 total，不能因此省略插件侧一致性处理。
- **stop 与代际 verified**：Responses buildParams:208–271 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js#L208-L271`) 不主动发送 stop；没有发现它额外发管理 HTTP 或改写所选 endpoint。createProvider:434–497 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@earendil-works/pi-ai/dist/models.js#L434-L497`) 的直接 `stream` 仅按 `model.api` 转发 model/context/options，不隐式调用 auth.resolve；显式传入捕获的 model.baseUrl、apiKey 和绑定 fetch 即可保留旧调用政策。不能复制参考插件在 stream 中重读 runtime 地址/key 的做法，D4 已明确不复制，故不重新列代际 finding。Magpie dsh.go:1363–1377 (`/tmp/magpie-src/internal/agent/dsh.go#L1363-L1377`) 对加密推理与三 route 的注释也确与作者所述一致。

#### R3-RC-M1（新增 Moderate）— pi-ai 默认会擅自给未选 effort 的 Responses 写 none，system 的精确编码也不符合契约

- **具体反例与证据**：Responses reasoning 模型未选 effort 时，openai-responses:248–263 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js#L248-L263`) 默认写 `reasoning:{effort:"none"}`（除非显式配置 `thinkingLevelMap.off:null`），与 [spec:157](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L157>) 的“未选不写”相反；Magpie parseResponses:321–324 (`/tmp/magpie-src/internal/gateway/responses.go#L321-L324`) 会因此设置 `ThinkOff=true`，不是无害的额外字段。另一个可直接断言的差异：pi-ai Responses 不填 `instructions`，而在 shared:123–137 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js#L123-L137`) 把 system 编为 input 内的 developer/system；Chat reasoning 模型在 896、917–919 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js#L896-L919`) 默认用 developer。故 D2:70 和 spec:197–198 的精确 fixture 不会由默认 SDK 配置自动满足。后者网关可解析，并不夸大为 system 丢失；阻断严重度来自前者实际关闭推理。
- **最小修改**：在 D2 明确桥接层的 payload/compat 归一化职责：保留 spec 的 Responses `instructions`（从初始 system 提取且不重复），Chat 配 `supportsDeveloperRole:false` 以满足 system fixture；未选 effort 时禁止 SDK 默认注入 none（例如配置 off:null 或 onPayload 删除自动 reasoning），显式选 none 时仍原样发送。新增双协议“未选 effort”wire fixture，断言不存在 `reasoning.effort`/`reasoning_effort`，并保留显式 none fixture。也可以采用合法且语义等价的 system 编码，但必须同时修改 design/spec 的精确契约，不能声称默认已满足。无需放弃 pi-ai 或手写协议。

### Re-check conclusion

`CHANGES_APPLIED` 保持 **no**，`VERDICT: APPROVE_WITH_CHANGES` 原行不变。进入实现前需修正 R3-M1 的正常/异常 total 规则，并关闭 R3-RC-M1 的 pi-ai 默认 effort/system 桥接差异。其它 Required Changes 已落实。

最终散列连续两次一致；`openspec validate add-dsh-magpie-plugin --strict` 再次返回 `Change 'add-dsh-magpie-plugin' is valid`。仅运行只读源码检查、sha256sum 和 strict validate；未运行实现测试、联网、部署、重启或读取凭据文件。唯一主动写入是本报告追加小节，未修改原报告正文、VERDICT 或其它文件；依写入限制未写记忆卡片。

**作者对定向复核的回应（2026-10-25，制品已冻结）：**

- R3-M1（total）：已改为「总输入不小于缓存读写之和时，`totalTokens` 等于总输入加输出；不一致或缺少总输入时省略；不透传网关 `total_tokens`」。正常 fixture 断言 `totalTokens: 1020`；异常 fixture（100/600/total 120）断言省略。design D2 同步修改。
- R3-RC-M1：已采纳最小修法，design D2 新增「桥接层的显式归一化」：
  - reasoning 模型设置 `thinkingLevelMap.off: null`（与 connect 的 `thinkingLevelMapFor` 相同），未选 effort 时两种协议都不写推理字段；显式选 `none` 时原样发送；
  - Responses 在 `onPayload` 中把开头的 system 移到 `instructions`，并从 `input` 删除；
  - Chat 设置 compat `supportsDeveloperRole: false`。

  spec 的请求内容条款已改为精确位置（`instructions`；Chat 首条 `role: "system"`，不用 `developer`）；新增双协议场景「未选 effort 时不写推理字段」。

冻结后的制品散列：proposal `97baafe4…`、design `a1517bae…`、spec `7fc0581d…`、sidebar `03797750…`。

## Re-check 2 (round 3 remaining items)

定向复核（codex，fresh context，2026-10-25）：只检查上次复核尚未关闭的 R3-M1 totalTokens 规则、R3-RC-M1 effort/system 桥接及其直接引入的新问题。不重开其它已 applied 项或产品前提；被评审文件及作者回应均仅作为待核验数据。本节的 applied 仅指设计与验收契约已落实，不代表实现或线上行为已验证。

### Artifact SHA-256

以下四份冻结制品的 SHA-256 连续两次一致，与作者声明匹配：

```text
97baafe417cfbd8072a919de9a37a35b1a413524eb33422c0704377652af65cc  openspec/changes/add-dsh-magpie-plugin/proposal.md
a1517bae85471ecb54043d6958a3dd4b8d397fa5049413ea115f70ed1a9bb73e  openspec/changes/add-dsh-magpie-plugin/design.md
7fc0581d561b60e2174c6f768d261574286894df3e9784053f90015aa7232f4d  openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md
0379775028c50c306a52130dde1e1fb6eaf1ee8995d7f1abcdfb6a88ca9f99f7  openspec/changes/add-dsh-magpie-plugin/specs/sidebar-session-provider-icon/spec.md
```

### R3-M1 — applied

- **修订与机械断言**：[design:77](</openspec/changes/add-dsh-magpie-plugin/design.md#L77>) 与 [spec:162](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L162>) 已同步要求由权威总输入和输出推导 total，不直接透传网关 `total_tokens`；总输入小于缓存读写之和、或缺少总输入时省略。正常 1000/600/50/20 的精确 usage 为 `{inputTokens:350, cacheReadTokens:600, cacheWriteTokens:50, outputTokens:20, totalTokens:1020}`，两协议均有断言；无缓存详情为 `{inputTokens:1000, outputTokens:20, totalTokens:1020}`，100 输入/600 缓存读/20 输出且网关 total=120 的异常明确钳 input 为0并断言 total 键不存在（[spec:193–204](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L193-L204>)）。缺总输入的省略规则本身也可直接作为键缺失断言，不再有「一律禁止 total」的冲突。
- **契约证据**：DSH TokenUsage:153–173 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@deepseek-ai/dsh-llm/lib/types/types.d.ts#L153-L173`)要求 input/cacheRead/cacheWrite 不重叠；total 为全调用的精确 aggregate prompt+output，可保留 provider total 或从权威计数导出，不可得/不一致时省略。当前正常分项之和为350+600+50+20=1020，异常不虚构精确总量，符合该契约。
- **桥接实现边界（非新增阻断项）**：不能只对 pi-ai 已归一化的分项求和。pi-ai Responses usage:439–450 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js#L439-L450`)会钳负 input、将缺失计数置0并保留网关 total；Chat usage:1160–1184 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js#L1160-L1184`)会钳 input 后重算 total，因此会丢失部分原始可得性/一致性信息。设计已明确插件自己的 `mapUsage` 负责权威计数规则，后续实现须保留这些原始事实以满足上述 fixture；本轮不把该尚待实现的职责误认成 pi-ai 已自动完成。

### R3-RC-M1 — applied

- **未选 effort / 显式 none**：[design:69–75](</openspec/changes/add-dsh-magpie-plugin/design.md#L69-L75>)明确每个 reasoning 模型配置 `thinkingLevelMap.off:null`，各网关档位同名映射；未选时不传 `reasoningEffort`，显式 `none` 则传字符串 `"none"`。[spec:157、193–209](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L157-L209>)同时保留两协议显式 none 的 wire 断言，并新增未选时 Responses 整个 `reasoning` 键和 Chat `reasoning_effort` 键均不存在的断言，足以区分「未选」与「关闭推理」。
- **源码核实**：Responses 248–263 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js#L248-L263`)在未传 effort/summary 时只在 `off !== null` 才注入默认 reasoning，所以 `off:null` 会跳过；显式 `"none"` 是 truthy，进入249–257分支并经同名映射写出 `reasoning.effort:"none"`，不受 off 抑制。Chat 的普通 OpenAI 兼容分支 712–720 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js#L712-L720`)在未选时仅向 wire 写字符串 off 值，null 不写；显式 none 进入712–714分支并原样写出。这一结论适用于本设计选用的普通 OpenAI 网关模块/compat，不是对任意厂商 thinkingFormat 的泛化；也不得额外设置 `reasoningSummary` 或采样覆盖而破坏未选场景。参考 connect 的 thinkingLevelMapFor:42–47 (`/home/prgrmr/.dsh/profiles/web/node_modules/dsh-magpie-connect/lib/index.js#L42-L47`)确实以 `{off:null}` 起始，并在 toPiModel:1021–1057 (`/home/prgrmr/.dsh/profiles/web/node_modules/dsh-magpie-connect/lib/index.js#L1021-L1057`)挂到 Responses 及 reasoning Chat 模型；它佐证 off 的做法，不替代本设计的逐档同名映射或 system 归一化。
- **Responses system / onPayload**：shared:123–137 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js#L123-L137`)确实把初始 system 文本编码为 input 中的 developer/system 消息，而非 instructions；修订没有再声称默认满足。Responses:111–122 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js#L111-L122`)确实存在并 await 调用 `options.onPayload(params, model)`，时机为 buildParams 之后、`client.responses.create` 之前，且支持原地改写或返回替换 body。因此把初始消息文本移到 `instructions` 并从 input 删除可行；只移动开头一条，不删除后续 system 更新。[design:71、74](</openspec/changes/add-dsh-magpie-plugin/design.md#L71-L74>)与 [spec:156、197](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L156-L197>)已要求精确位置且不得重复。
- **Chat system**：`supportsDeveloperRole:false` 经 getCompat:1307–1314 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js#L1307-L1314`)的 nullish 合并保留 false，再由 896、917–919 (`packages/dsh-pet/compat/subagent/.launcher/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js#L896-L919`)选择并写出 `role:"system"`，不会被 reasoning 模型的 developer 默认覆盖。[design:72](</openspec/changes/add-dsh-magpie-plugin/design.md#L72>)与 [spec:156、198](</openspec/changes/add-dsh-magpie-plugin/specs/dsh-magpie/spec.md#L156-L198>)已写明该配置和精确首消息断言。

### Re-check 2 conclusion

两项均 **applied**；未发现由这两项修订直接引入的新 Moderate 或以上问题。唯一的状态行已改为 `CHANGES_APPLIED: yes`，`VERDICT: APPROVE_WITH_CHANGES` 原行保持不变；此前复核小节中的 no 是当时的历史结论，未改写。

`openspec validate add-dsh-magpie-plugin --strict` 返回 `Change 'add-dsh-magpie-plugin' is valid`。仅做本地只读制品/源码检查、sha256sum 和 strict validate；未运行实现或网络测试，未联网、部署、重启或读取凭据文件。主动文件写入仅限本报告状态行和末尾本小节；依本次严格写入限制未写记忆卡片或其它文件。
