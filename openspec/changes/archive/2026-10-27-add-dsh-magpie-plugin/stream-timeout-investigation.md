# SOL `MAGPIE_STREAM_TIMEOUT` 有界调查（无 production 修复）

## 结论与边界

已复现**可达的超时机制**，尚不能把用户那次真实长上下文 / AUTO high 请求唯一归因于它：本轮没有读取真实 conversation、会话 raw 文件、DSH logs、凭据或真实网关。只新增本报告与 [观测测试](<../../../packages/dsh-magpie/test/stream-timeout-investigation.test.ts>)，未改 production、manifest、spec、旧测试、ledger；未 build/sync/restart，未触其他 worker 的部署操作。

核心事实：

1. 新 adapter 的计时对象是 **pi 语义事件**，不是 HTTP headers、原始 SSE 包或首个非空内容。`start` 被排除；空 `thinking_start` / `text_start` / `toolcall_start` 也会启动 60s idle。
2. 合法 wire 序列可以在 t=0 给空 reasoning item，t=65s 才给首个内容；现实现 t=60s 关闭连接。去掉早空项、保持 t=65s 首内容，现实现成功。这是实际可复现的边界，**不是已经证明的规范违例**：若“首事件”本意就是 pi block-start，那么行为符合该定义；若本意是首个实质内容，则需要规范语义澄清后修桥接判断。
3. `response.created` 只写 responseId、`response.in_progress` 不产生 pi 事件；SSE comment 在 SDK 解码层即丢弃。它们不续命不等于 bug：即使上游有心跳，无内容且超过已批准的等待预算也可以合法超时。
4. 90s 是 dispatch 总首等待预算的一部分，含 headers 延迟，不是拿到 headers 后再给 90s。50s headers 延迟 case 于 t=90s 超时。
5. 没有测量证据证明真实 SOL high 长上下文的首事件/首内容一定在 90s 内；设计中的“90s 足够”是判断，不是测量。此前短 low-effort 请求成功也不能填补该证据。

## 契约依据

- 当前 `openspec/specs/` 尚无 dsh-magpie current spec；本 change 的 [delta spec:148–169](<specs/dsh-magpie/spec.md#L148-L169>) 规定 90s 首事件、60s 空闲、关闭连接、不重放已输出内容；[Scenario:233–236](<specs/dsh-magpie/spec.md#L233-L236>) 只覆盖“无任何事件”和“文本后静默”，没有定义 headers/start/空块/空 delta。
- [design D2:59–79](<design.md#L59-L79>) 选择 pi-ai 外层看门狗，称参考 connect `withStallTimeout`。这支持 pi 事件层的解释，但没有明确“空结构 start 是否算首事件/活动”。
- [design:209](<design.md#L209>) 的“90s 足够”未附 high 长上下文延迟分布，本调查不据此预设测试应成功，也不建议单纯增大两个常数。

## Source trace（实读）

| 层 | 来源与结论 |
|---|---|
| adapter budget | [adapter:119–146](<../../../packages/dsh-magpie/src/host/adapter.ts#L119-L146>)：context 转换后 `arm(90000)`，之后调用 `provider.stream`；看门狗到期置 `timedOut=true` 并 abort controller。HTTP 429/5xx 建连重试最多 2 次，全部仍在同一预算内；SDK `maxRetries:0`。 |
| adapter activity | [adapter:148–166](<../../../packages/dsh-magpie/src/host/adapter.ts#L148-L166>)：所有非 generic `start` 的 pi event 都 `arm(60000)`，包括空 start、空 delta、end、done/error。block-start 自身会输出给 DSH，但不必有内容。 |
| termination | [adapter:163–171](<../../../packages/dsh-magpie/src/host/adapter.ts#L163-L171>)：pi error 分支读 timedOut，稳定返回 `MAGPIE_STREAM_TIMEOUT`；外层 catch 不用 timedOut 生成 code，只阻止 reason=aborted。finally 清 timer/abort/release。 |
| real transport | [transport:17–31](<../../../packages/dsh-magpie/src/host/transport.ts#L17-L31>)：私有 undici fetch 合并 signal，未实现 raw 活动续命。新 loopback 测试跑了此真实路径，不是全 mock。 |
| pi version / dispatch | `node_modules/@earendil-works/pi-ai/package.json:2–3` = 0.87.1；`dist/models.js:449–459,496` 直接 dispatch 到选定 API 的 stream，无额外原始事件过滤层。 |
| pi headers → start | `node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js:117–129`：await SDK `.withResponse()`（headers 到达），然后 push generic start，再消费 raw Responses 流；因此 start 可先于任何 raw created。 |
| pi empty starts | `node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js:343–382,477–483`：reasoning / message / function_call 的 output_item.added 无论有无摘要/文本/参数，都 createSlot 并 push 对应 start。 |
| pi raw progress | 同 shared 文件 `477–480`：created 只记录 id；`477–655` 完整分支没有 in_progress。reasoning summary/text delta (`484–518`) 不检查非空；output text delta (`520–530`) 同样如此；工具参数 delta (`544–550`) 会 push toolcall_delta。 |
| pi error production | `node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js:146–156`：producer 内异常/abort 被 catch，push terminal pi error；不是直接 throw 给 adapter iterator。 |
| pi event queue | `node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js:35–49,62–75,82–93`：producer 独立 enqueue，async iterator 等待队列；error 被当终止事件，不会把 producer Error 作为 iterator rejection。 |
| SSE comments | `node_modules/openai/core/streaming.mjs:188–211,246–266`：SDK SSEDecoder 丢弃 `:` comment；它不成为 raw JSON event，更不会成为 pi event。 |
| Chat 差异 | `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:197–203,382–423`：headers 后也 push start；空 content 和空 reasoning 字符串不建块、不 push delta（与 Responses 空 item 不同）；`296–330,425–449` 工具可仅凭 index/id/name 先建 toolcall_start，并 push 空 arguments delta。这里只读 trace，没有把 Chat 结论冒充 Responses SOL 测量。 |

### 真实 connect reference 的差异

已实读 `/home/prgrmr/.dsh/profiles/web/node_modules/dsh-magpie-connect/lib/index.js:915–979,1185–1229`，没有读取该插件 settings/key/cache。

- `withStallTimeout` 对每次 `iterator.next()` 做 `Promise.race`；第一次任意 pi event 到达后 `first=false`，**generic start 也算**。因此它不是“每个 raw 包续命”的参考；新 adapter 排除 generic start 比它保留了更长的初始窗口。
- connect 到期自行 yield timeout error，再调用 onTimeout abort；新 adapter 只 abort，等待 pi producer yield error。这是终止结构差异，不证明当前 pi 下会挂住。现在的 fake transport 与真实 loopback 都收到了 pi error 并结束。
- connect 的超时描述叫 upstream events，但实际输入是 provider.stream 的 pi events，不能从命名推断成 raw SSE 活动。

## Fake-wire 相对时间结果

计时单位为 ms，下表按秒显示；t=0 为 fixture dispatch 预算开始。fake transport 保留**真实 src adapter、真实 createProvider、真实 pi Responses parser 与 OpenAI SDK SSE parser**，仅替换 transport fetch 返回的可控 ReadableStream。它不产生真实 HTTP；次数是 fetch seam 调用次数。另有一例真实 loopback HTTP，以私有 transport 验证关闭连接。计时是 fake clock 的可执行测量，不是实际模型推理耗时。

| Case | raw/headers 与 pi 可见边界 | 实测终点 | 次数 / replay |
|---|---|---|---|
| headers 慢 | headers=50；pi start=50；无内容 | timeout=90，不是110/140 | fetch=1，无 |
| raw 心跳但无 pi 内容 | headers/start=0；created=20；in_progress=40/80；每次伴 comment；到期前 pi 只有 start | timeout=90 | fetch=1，无 |
| 空 reasoning item | item.added=0 → thinking_start=0，DSH reasoning block-start，无 delta | timeout=60；计划65的首内容无法到达 | fetch=1，无 |
| 空 message item | item.added=0 → text_start=0，未收到文本 | timeout=60 | fetch=1，无 |
| 空 function_call item | item.added=0，arguments 空 → toolcall_start=0，未收到参数 delta | timeout=60 | fetch=1，无 |
| 无早空项的对照 | headers/start=0，65 时发 created/message/text/terminal 并结束 body | stop=65，text_delta=65 | fetch=1，无 |
| reasoning/text/tool 非空 delta，各一例 | 空 item/start=0；对应内容 delta=55；comment=110 | timeout=115；114.999 未结束 | 各 fetch=1，无 |
| 晚空项（反向边界；source推导，未独立跑完观测断言） | 无内容到80；空 reasoning start=80 | 按arm逻辑deadline=140；不保持绝对90首内容 cap | 不计入已测通过case |
| 空 reasoning delta | start=0；reasoning delta 字符串长度0，t=55 仍 yield thinking_delta | timeout=115 | fetch=1，无 |
| producer stream error | headers/pi start=0；body.error=12 | pi error=12 → `MAGPIE_GENERATION_FAILED`，不是timeout | fetch=1，无 |
| timeout 后 iterator throw（注入） | 人为替换 EventStream iterator；90时 abort，释放注入 gate 后 throw | `MAGPIE_GENERATION_FAILED`，外层catch不采用timedOut code | fetch=1，无；非自然producer路径 |
| **真实 loopback HTTP** | headers与空reasoning start=0；55写comment | 60 时 timeout，服务端 response close 已发生 | 目录GET已先完成且清除计数；生成仅1次 POST `/v1/responses`，无 |

“计划65”是对照 fixture 的合成时间，不是声称已在关闭后的 wire 上收到 delta。早空项测试断言60超时；无早空项测试真实在fake t=65注入内容并取得stop。

## 根因候选与排除

### 已证可达、需要现场安全指标来区分

**A. 空结构 start 提前进入 idle。** 若真实请求首个有效 pi event 是空 thinking_start（或 text/tool start），并且后续 pi event 等待超过60s，则它能直接解释 timeout；尤其是 start 很早、首次实际内容在60–90s之间时。新代码的确允许这个序列；是否应修取决于已批准“首事件”的具体定义，不能擅自把首事件改叫首 token。

**B. 上游合法慢/静默。** 即使 headers、created 或 comment 持续，超过90s没有合格pi事件，或在某pi事件后超过60s无新pi事件，也会按契约结束。不足以断定 socket、网关、模型或插件谁出错。长输入、多工具schema、high推理的延迟未实测，短low成功不排除B。

**C. 空事件过度续命。** 反方向也存在：空 reasoning delta 会续60，80s的空start可把绝对终点延到140。说明当前定义是“事件间空闲”，并非固定首内容deadline；若以后改为进展计时，必须同时覆盖这一面，不能只修60s提前终止。

### 已区分或不足以当本次根因

- **raw packet 不续命**：事实成立，但不是自动 bug。comments 与 in_progress 没有实质输出，不能一律让它们无限续命。
- **post-start producer throw 被错误归类成 timeout**：自然body.error=12走pi error、code=`MAGPIE_GENERATION_FAILED`，不误报timeout。
- **outer catch 分类缺口**：通过强制 iterator rejection 可证明 timeout 已发生后仍返回 generic code。但当前 pi producer 自己catch错误，EventStream只运输事件；没有证明真实请求到得了该throw seam，且缺口方向是“漏报timeout”，不是解释已有 `MAGPIE_STREAM_TIMEOUT` 的原因。
- **插件偷偷重放导致长等待**：所有200-stream timeout合成案例及真实loopback都是1次，无replay；源码的HTTP429/5xx建连重试是独立路径，未在本轮新增测试中模拟，不据此声称真实请求绝无建连重试。
- **请求严格schema400修复/正式部署成功**：本轮不触碰也不核验另一worker负责的live。HTTP200/短工具往返成功不等于长high stream预算已验证，反之不应重复修strict字段。
- **transport abort无效/socket不关**：真实loopback已确认超时后服务端close；不等于证明所有网络条件下abort完成有统一wall-clock上界。

## 最小建议（本轮不实施）

1. **先决定语义而非先延时。** 若lead确认首事件包括所有非generic pi start，则保持90/60，A是预期边界，继续采集B的安全延迟证据。若确认“首个实质输出”，需最小delta明确标准：空start/end/零长度delta是否算进展；工具名称/id出现是否已构成实质工具输出（不能只看arguments长度）。
2. 若后者获批，最小桥接修复是把 `event.type !== 'start'` 改为明确的进展谓词/状态切换；保持90s/60s数值，不改变wire协议、不自动replay。至少保留本轮的空reasoning/message/tool对照、空delta、晚空项及真实socket关闭case，再将观测断言按批准语义转成回归断言。不能现在直接声称这些观测PASS就是修复GREEN。
3. 不建议默认把raw headers/created/in_progress/comment都算进展。若确需区分网络存活与模型进展，在fetch包装的body观测层只维护独立“last raw activity”时间，**不得把其当内容活动无限续60s**；应另有不可被heartbeat清零的首进展/无进展预算。body tap需保持背压、取消与单次消费，不记录字节内容；这比改事件谓词大，不能借调查越权实施。
4. 外层catch若未来确实会收到pi iterator throw，可小范围统一 timedOut 的failure code；这只是防御性一致性建议，不能当成本轮现场根因fix。若要求不依赖producer合作的硬终止，可参考connect的iterator-next race，但仍需处理iterator.return与producer取消，不是“重置每个raw包”问题。

## 要让lead收集的最小安全指标

不需要也不要读真实conversation内容。若已有允许的纯元数据证据，可只提供单次失败请求的：

- 实际provider、model、effort（不是next picker值）；协议Responses/Chat；请求轮次的匿名关联id；可选粗粒度上下文token数/工具数，**不含工具schema/参数/对话文本**。
- monotonic相对时间：dispatch开始、HTTP发出/attempt序号/status、headers到达、首raw事件type、首pi事件type、首非空内容/有效工具身份出现时间、最后raw type/time、最后pi type/time、watchdog触发时间、abort与最终failure code。
- raw仅允许枚举type/comment与delta长度/是否空，不含raw payload、账号、key、headers值、response内容、model reasoning或context。尤其区分 `response.created` / `response.in_progress` / comment / item.added(type) / nonempty delta。

若完全没有失败请求的这些安全指标，本轮可以交付可复现机制与下一次采样清单，不能宣布那条真实timeout会话已经根治；无需为了给本报告补“成功”而再跑真实会话。

## 验证与复现

在仓库根运行（无build）：

```bash
npm --prefix packages/dsh-magpie test -- --run test/stream-timeout-investigation.test.ts
npm --prefix packages/dsh-magpie test
npm --prefix packages/dsh-magpie run typecheck
```

调查作者原始观测case纳入普通suite，无skip、无预设RED失败、无临时config改默认测试。真实loopback只绑定127.0.0.1随机端口，不访问网关或DNS。fixture使用合成key和合成内容，不持久化设置；测试恢复fake clock/spy并dispose runtime/关闭server。

### 本轮验证记录与并发交接（必须保留此限定）

- 初版12个观测case全通过；全suite **31 files / 201 tests PASS**，typecheck PASS。
- 补充50s headers latency后，11:21:39全suite **31 files / 202 tests PASS**（含13个观测case）；typecheck PASS。这是本报告实测表的最后完整GREEN，不是fix GREEN。
- 之后新加的“80s晚空项→140s”观测case尚未获得独立GREEN，故表中明确列为source推导。
- 最终全suite执行期间，获准新建的测试文件被另一owner并发改成23个期待修复行为的回归case（例如空start允许65s内容、90s才timeout）；调查作者未覆盖这些修改。该次suite在production旧行为下 **15 failed / 23**（该文件），其余30文件189条通过，进程exit1。后台job `bash-40`已收集。此RED表示文件已从观测转为修复回归，并非原13条观测失败；lead/fix owner需在其production变更完成后重新验收。
- 最终typecheck exit0；`git diff --check` exit0。调查作者无production变更，也不宣称最终工作区suite GREEN。

最新（并发回归RED）净化suite输出在 `/tmp/dsh-magpie-stream-timeout-suite-sanitized.txt`。不把 `/tmp` 证据当长期源文件、不把现有 `lib` 产物当src测试的完成依据。
