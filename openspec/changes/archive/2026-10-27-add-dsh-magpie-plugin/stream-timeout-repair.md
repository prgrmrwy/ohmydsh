# Stream timeout bounded repair — 2026-10-26

**状态：修复本地通过，待 parent focused review + runtime 验收。不是全 change / 全 goal PASS。** 已复现并修正可达的空结构事件提前切换、或无内容续期的计时边界；没有真实失败请求的 private history / metadata trace，不能把用户历史 SOL 故障 100% 归因于此，也不保证所有真实 high 长上下文请求都会在预算内完成。

## 授权与实际差异

仅改 [adapter:149](<../../../packages/dsh-magpie/src/host/adapter.ts#L149>) 一行、`packages/dsh-magpie/test/stream-timeout-investigation.test.ts`、[design D2 与风险条款](<design.md#L59-L79>)、[生成超时定义及边界 scenarios](<specs/dsh-magpie/spec.md#L169-L251>) 和本报告。保留调查文件名，不 rename、不新建重复测试文件。原调查报告 `stream-timeout-investigation.md` 由 owner051 保留，本修复不覆盖它；该报告记录的是历史观测快照。

生产差异恰为 1 insertion / 1 deletion：

```diff
-        if(event.type!=='start')arm(60000)
+        if((event.type==='text_delta'||event.type==='thinking_delta'||event.type==='toolcall_delta')&&event.delta.length>0)arm(60000)
```

不新增 config/helper，不改 90000 / 60000 常量。事件是 pi 的 discriminated union，只有三个 delta 分支才访问其 string `delta`；不是把所有事件强行假装为 delta。没有改 adapter 的 strict/tool-schema、catch、usage/replay、transport 或 retry 代码。

未写 manifest / lock / central tasks/test-plan/verify/review/implementation ledger、其它源码、旧冻结 review；未 sync、deploy、restart、commit、读取凭据或发真实 Magpie/厂商请求。`npm run build --workspace=dsh-magpie` 只生成本地忽略的 `lib/`，不更新现有 GUI/Host 部署。只有 localhost 随机端口合成 HTTP 测试。

## 契约澄清与 source proof

先更新 [design:79](<design.md#L79>)、[spec:169](<specs/dsh-magpie/spec.md#L169>)，再转契约测试、运行 RED，最后改生产行。原“首事件”明确为：从调用 pi-ai 前的既定 90s 首实际内容预算；只在非空 text/thinking/toolcall delta 后切换或续为 60s idle。headers、generic start、block start/end、空 delta、created/in_progress 和 comments 不缩短、不延长当前预算。工具 name/id 本身不触发 idle；正常无参数工具的 `{}` delta 非空，或最终 block + done 直接结束。

- [dispatch:123–149](<../../../packages/dsh-magpie/src/host/adapter.ts#L123-L149>) 保持一个 watchdog：`arm(90000)` 在 provider.stream 前，timeout 置 timedOut 并 abort；仅 reset 条件改变。
- 实读 pi-ai 0.87.1 `node_modules/@earendil-works/pi-ai/dist/types.d.ts:455–523`：start 与 delta/end 有独立类型；text/thinking start 通常为空，end 是权威最终块；tool start 参数允许 provider-specific。实际 compile/typecheck 验证联合类型收窄。
- Responses parser `node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js:343–382,477–550`：三类 item.added 可以仅发空 start；text/thinking/tool delta 会透出空字符串。created 只更新 responseId；in_progress 没有生成 pi 活动事件。
- 同 parser `552–563,577–621`：arguments.done 可补非空 delta；output_item.done 也可直接发最终 text/thinking/toolcall end 而不先发 delta。修复没有把 end 当续期；新增三类型“final block followed directly by done”证明 t=65s 无 delta 也能正常结束。若只有 end 却不完成，仍受原预算约束。
- 同 parser `496–506` 的 summary_part.done 会产生非空 `\n\n` thinking_delta。批准标准是 **string.length > 0**，不是 trim 后内容或 raw 事件语义；本修复不另造 raw classifier。因此非空 whitespace 仍算 delta 活动，这不是“空字符串”续命保证的例外。
- Chat parser `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:382–451` 已过滤空 text/thinking，但工具 identity-only 能发空 toolcall_delta；共享 adapter 判断同样覆盖它。既有 Chat text idle/cancel、两协议工具与 completion 测试均重跑。
- [pi error:163–171](<../../../packages/dsh-magpie/src/host/adapter.ts#L163-L171>) 仍把真实 producer abort 转为 MAGPIE_STREAM_TIMEOUT；finally 清 timer、abort、释放 key/op。外层 injected iterator throw 的 generic 分类缺口**未修**，仅保留调查对照；不把人为注入的 seam 宣称为真实历史根因。

## TDD 与当前验证

执行目录为仓库根，时间约 2026-10-26 11:26–11:34 -04:00。仅以下本次命令的结果用于 repair GREEN；调查作者历史 **12 observational / full201**（后来13/full202）属于调查证据，不冒充修复通过。

| 步骤 | 实际命令 / 结果 |
|---|---|
| 初次 RED | `npm test --workspace=dsh-magpie -- test/stream-timeout-investigation.test.ts --reporter=verbose`：23 cases，15 fail / 8 pass，exit1。7 个“应到期却未到期”的 case 等待 run 达测试5s上限；未改生产，先补 deadline 后即时 finish assertion，避免把 harness 等待当修复证据。 |
| Assertion RED | 同命令重跑，23 cases，15 assertion fail / 8 pass，exit1，329ms。无 import/syntax/fixture error；三类空 start 在60s已错误 finish、空 delta/晚空 start/已有内容后的空结构在应有90/115s期限仍未 finish，两个真实 loopback 也在60s被截。日志 `/tmp/dsh-magpie-stream-timeout-repair/red-assertions.log`。 |
| 最小生产修复 | 仅上述一行 reset 谓词；不增时限。 |
| Focused GREEN | `npm test --workspace=dsh-magpie -- test/stream-timeout-investigation.test.ts test/generate.test.ts --reporter=verbose`：2 files / **40 passed** = 新契约23 + 既有generate17，0fail/skip，exit0。日志 `/tmp/dsh-magpie-stream-timeout-repair/green-focused.log`。 |
| Full GREEN | `npm test --workspace=dsh-magpie -- --reporter=verbose`：**31 files / 212 passed**，0fail/skip，exit0。日志 `/tmp/dsh-magpie-stream-timeout-repair/green-full.log`；最后只改测试标题 first-event→first-content 后，于11:33:59重跑同一全套仍31/212，日志 `/tmp/dsh-magpie-stream-timeout-repair/green-final.log`。其中原有30files/189保持；调查文件从历史13观测转为23回归，不声称212全是新增测试。 |
| Types | `npm run typecheck --workspace=dsh-magpie`：source + test TypeScript，exit0。 |
| Local build | `npm run build --workspace=dsh-magpie`：exit0。原 tsdown external-deprecated / CommonJS 建议警告，不是新增错误。 |
| Spec / hygiene | `OPENSPEC_TELEMETRY=0 openspec validate add-dsh-magpie-plugin --strict` valid；scoped tracked diff whitespace通过；untracked test/report 的 `git diff --no-index --check /dev/null <file>` 均无输出，status1仅表示非空新增diff，已显式按此语义检查；报告9个相对link均指向tracked repository路径，node_modules/tmp/ignored/untracked来源仅inline code。机械scenario计数76+17+9=102。 |

### 23 timeout cases 的边界映射

- headers 在50s才到仍90s到期；headers/start + created/in_progress/comments 不续原预算。
- reasoning/message/function_call 三类型空 start 各在60s未 finish，65s发对应非空 delta + 最终块 + completed/EOF，正常 stop / tool-calls；同样三个 start 无内容则90s timeout。
- 三类型无 delta、65s仅最终 block + done 立即正常结束。
- 三类型55s非空 delta 把期限设115s；110s空 end/start/delta + comment 不续期，114.999s未结束、115s timeout。
- 80s晚空 start 不延至140s；三类型55s空 delta 不延至115s，均90s timeout。
- 无早空 item 对照65s文本仍成功；producer error12s仍是 GENERATION_FAILED 非 timeout、不重放；人为 iterator throw 的 catch-gap 保留为未修观察。
- **两个 real HTTP / private transport cases**：localhost服务先发送空 reasoning start，55s comment；一个60s未结束、65s发真实 text fixture + stop/EOF成功，另一个89.999s未结束、90s timeout。两者均等待服务端 response close，且清除已完成目录 GET 计数后只记录 **一个 POST /v1/responses**，无自动 replay。fake-wire其它 cases 的 one-call 是 fetch seam 次数，不冒充真实 HTTP。

原 [首事件与空闲超时场景](<specs/dsh-magpie/spec.md#L233-L236>) 保留标题、澄清机械定义，新增三个边界 scenario；中央99行 ledger 尚未在本范围更新，parent 应将总 scenario 数按本增量对账为102，并映射实际英文测试名，不批量 rename。

## 冻结身份变化：旧 review 不伪造一致

旧 [AMD2 frozen review:571–582](<review.md#L571-L582>) 仍是历史准确记录。本轮获授权澄清 timeout 语义与补边界，故 design/spec 两份哈希改变；旧 review 不自动批准这段微修复，parent 将做 focused review，不重复原全 scope 审批。

```text
before design  5e88dbc4371f309e9e5e0772ba16766b124306fdac1c05c34a01ad186767222e
after  design  a97701199d02fd3107c23507d46b1cb473a12954a9c557e8d061ee2d9f61fe61
before spec    b2deb7881c6021f04d0d68453d3d24611b4b8bd1a8cc6d2a5cac06326b882a3e
after  spec    3e13371ca63cb9cc52d6417b366a764f2c00298fca18197c7ecb77758e193193
before adapter 6ff52a96f3608bbb68e23325b137810ceb177ac3cdd893289f4b0e477c31309e
after  adapter 8d9a805c26cc4629ad4e3d7cd3b6b30a98348236e3cea89aaf8f9846a8f4e711
final test     3917197473dac466fe5d26eac56efc5c5063dae77d4d08c75709628b80d96254
```

before / after 只描述本微修复起止字节，不是 HEAD 全仓变更范围；共享工作区已有其它 owners 的 staged/unstaged 修改。本报告不把旧review/hash替换成新值以声称冻结一致。

## Remaining / handoff

1. Parent focused review 本行实现、23契约与新 design/spec；中央ledger/verify由parent统一追加本增量，不覆盖调查报告与历史批准。
2. 现有运行时尚未部署此 timer 修复；本地build不是sync/restart。部署后需依现有授权完成真实GUI与SOL长上下文/工具验收；只能承诺复现序列得到正确90/60边界，不冒称历史故障已根治。
3. 原change的历史2.5 first-RED欠账、16.2真实smoke、16.3最终验收、16.4 GUI/tool等全局gates不在此报告标完成。重复平铺/connect/shim的manifest与已授权sync由lead负责，本修复不碰。
4. 未跑 unchanged Host339/continuation161 或全仓suite；未加长时限、增加raw heartbeat续命/遥测、修injected outer catch、访问真实key/network、commit或重启。所有本会话背景job已收集；没有遗留运行job。

## Parent focused review and deployment receipt

**TIMEOUT_FOCUSED_REVIEW: APPROVE (bounded).** Lead read the one-line reset predicate, original watchdog lifecycle, all three protocol event variants,65s success/90s failure/empty-delta/idle cases and clarified spec. Nonempty delta discrimination is consistent with the new contract, preserves cancellation/no replay and does not use comments to keep a hung request alive. Lead independently ran timeout23 plus existing generate17:40/40 passed. This is local focused review, not a fabricated second independent subagent or a whole-scope reapproval.

Subsequent lead deployment: sync exit0, second sync exit0/no changes; canonical authorized restart recovered an owned process on the same3080 URL (new PID19011 versus12832). Unauthenticated HTTP401 is expected admission behavior, not visual proof. The deployed adapter contains this predicate, SHA256 `700301abd0baf7815f4e907b9e8716c9776ace4693ac07771ef940086d6499a4`. The restart invalidated the managed job handle before collection, so shell exit status is not asserted; new process identity and deployed bytes were checked independently. Legacy connect/shim were separately disabled with explicit user approval, preserving configuration. User refresh/long-turn SOL retry remains pending; earlier handoff items above are historical pre-deployment statements, not current deployment status.
