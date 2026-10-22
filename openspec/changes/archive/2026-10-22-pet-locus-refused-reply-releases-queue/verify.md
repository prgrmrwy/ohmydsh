# 实施与验收记录（未完成）

## 2026-10-22 本机源码阶段

- 起点：方案提交 cd4a34d4；当前其它功能 HEAD 9532d593。Sonnet 两次启动失败且无改动后，用户选择当前主会话实现；未部署、未重启、未访问现役库或真实飞书。
- 完成：纯 `abandonRefusedDelivery` current→failed/reply-refused + repository 串行原子写；工具拒绝/成功通知；observer 精确轮只读诊断关联；tracker 同轮拒绝/continued 标记；生产入口接到 adapter idle 后 turn-end、原 dispatch lane、finishAndAdvance。
- 技术设计修正：执行对象没有直接 turn；经 token-bound inquiry adapter 获取。不能用“child 唯一 current”替代关联，否则 A 的迟到拒绝会误终结 B。wait 成功保留 continued 到轮结束，覆盖先 wait 后拒绝。

## 实际红绿

1. `locus-refused-delivery` 最小 no-op 桩：`changed false` 对期望 true 的业务断言失败（1失败2通过），实现后3通过。
2. observer `deliveryForTurn` no-op：精确已知 Delivery 关联期望 delivery-1、实际 undefined，失败；实现后53通过，原 reply capability 拒绝不改变。
3. tracker end no-op：failureReason 期望 reply-refused、实际 undefined，失败；实现后通过。
4. repository reopen 测试一度因缺 senderOpenId 失败，补齐 fixture 后47通过；并发同 revision 仅一次成功、B晋升及 reopen 可读。
5. completion 测试直接改 frozen ledger 曾失败，已改成调用真实 completeDelivery，5通过。

## 已跑检查

- Pet `npm run typecheck`：0；初次新增 repository stateRevision 直接赋 optional 值引发 exactOptionalPropertyTypes 错误，已修成条件投影，重跑通过。
- 默认 `npx --no-install vitest run`：197文件通过、3跳过；3504通过、8跳过，exit0（后续又补1个 tracker test及1个编译图 test；最终全量需重跑）。
- 编译图 production：12通过；wiring：4通过；managed-effects：14通过，exit0。wiring 有原先 fixture 重复注册 collaboration tool 的 stderr，测试仍过，不代表完整现役行为已验收。
- 新编译图定向 test `real actor is idle`：1通过（12跳过）。真实 Agents/AgentLoop/ToolRuntime + fake LLM 调 finish，走实际执行 token→adapter、callback→tracker、真实 turn/end→whenIdle，验证无 outbound、A failed/B current。该测试是组合级，不是整个 index 插件+真实 controller/outbound E2E。
- 最新定向：observer53、reply tool17、repository47通过；tracker5通过。
- `openspec validate pet-locus-refused-reply-releases-queue --strict` 与 diff check 通过。

## 第二轮集成验收（01:47–02:00）

- 修正编译图 fixture：`createRequire(require.resolve(...))` 不经过 Vite alias，原先从仓库工具包而非 launcher 工具包获取私有 scope，导致工具注册落全局、重复注册。改为先从显式 launcher 根定位工具包，再读取其 scope。修正后原 wiring 重复注册 stderr 消失。不是现役插件修复。
- 追加实际 `index.ts` 插件挂载测试：真实 Cordis、ToolRuntime、Pet SQLite/domain、AgentLoop marker；actor 是显式 fixture，手工驱动 pre-step/claim/end，验证 idle promise 未释放前不收尾；释放后关联 A 变 failed。纯 GUI、A过期后B晋升、无current、两个current损坏行、active locus失效均不终结正常行。该套不是实际模型/真实 child dispatch。
- 追加真实 repository+observer+controller 集成测试：拒绝 A 后终结并派 B，失败 receipt 故意抛错仍派成功，outboundResult 保持 none。测试最初暴露 tracker 把完整 A record 当 correlation 传到 dispatchNext，附带 deliveryId 导致再次指定 A、B保持 accepted；已修成显式四项 DeliveryCorrelation，重跑通过。证明仅纯 ledger 测试不够。
- observer 新增两个已证明Delivery及 revoke旧轮负例；54通过。工具参数/managed拒绝不通知、成功finish/accepted wait通知均覆盖。
- 最后默认全量：197文件通过、3跳过；3507通过、8跳过，exit0。根 `npm test`：444通过、0失败、2跳过，exit0。
- 编译图 production13、wiring10、managed-effects14通过，exit0；wiring10最后增补了无current/多个current，并增强原 unavailable 用例：必须调用已发布 pet_inquire 且错误为 Inquiry runtime unavailable，不能让 unknown-tool 冒充预期拒绝。
- typecheck、Pet build:host/build:client、root check:artifacts、diff check、OpenSpec strict均通过。构建只是仓库产物，未部署。

## 本地全差异审查

范围：起始 HEAD 9532d593 到当前未提交差异（含新文件），不包含其它模型路由提交。未使用 SSF execution receipt（本 change 未启用 spec-superflow）。

- 原子终结仅 current，经 correlation/revision；新B/新代际、重复end/竞争CAS不消费；busy沿用既有终结投影，无schema/version更改。
- Diagnostic association 与 currentCapability 独立，未修改任何授权分支；目标 inquiry managed拒绝在工具进入前，不通知业务收尾。execution active/scope与精确轮关联不足时不处理。
- 等待标记保留到end，两个顺序均测试；结束/actor释放清理标记。现有 process crash 退回deadline，不自动恢复拒绝标记。
- 新增日志仅稳定原因码；业务正文发送路径无新增调用。
- 反馈经原 controller try/catch，失败不阻塞队列；推进传纯correlation避免捕获selector。

## 本机部署（2026-10-22 02:03，实现提交 0c5f87dc）

- `dsh build` exit0，日志含 `local package dsh-pet content changed, reinstalling atomically`；第二次 exit0，`no changes — deployment already matches manifest`。
- 部署副本 `~/.dsh/profiles/web/node_modules/dsh-pet/lib/host/locus/refused-reply.js` 与仓库构建 sha256 相同。
- perl 双 fork + setsid 脱离进程组后调用官方 `dsh restart --no-open`：runner PPID=1；restart-exit=0；旧 PID 8757 已退出，新 PID 75075 监听 127.0.0.1:3080，未鉴权请求 401（正常）。
- 新启动日志：`inquiry-reconcile ok`（全 0）、`inquiry-startup-recovery`（全 0）、`ready — routes registered`、飞书订阅 `connected`；本次启动后无 degraded 行。

## 现役真机（2026-10-22 15:15–15:20，测试群 Pet Locus shell-tier test group 1）

用户不允许以其用户身份发飞书消息，触发消息均由用户本人手动发送。

- 15:15 首轮：两条都被回复"入口已停止服务"——原主会话 session-1baf0786 已在 archivedSessionIds；属既有退役规则，与本修复无关。
- 用户以新主会话接替后（主 session-f506ed42，child session-d8d01e4c，safe 档）：A/B 均正常回复「收到A」「收到B」并加 DONE 表情。证明部署后正常 finish/队列路径未受影响。safe 档无 bash，sleep 未执行。
- 15:19 第二轮尝试构造被拒：监视脚本在 A2 新 turn 开始时经 Host API `session/prompt mode=steer` 插入 GUI 消息，Host 返回 `session/agent-busy: is owned by subagent routing`，GUI 插话未进入。因此 A2 未混入来源，A2/B2 正常各自回复（child 日志 turn3/turn4 finish 均"已提交当前飞书请求"），本次启动后无 `authorization refused` 也无 `reply-refused` 日志。
- 结论：现役 Host 的 locus child 由 subagent 路由独占，官方 GUI/API steer 无法向其插话；在现役环境用外部手段稳定制造"回复被拒"不可行（除非有真实 GUI 混入以外的自然拒绝）。被拒收尾路径的证据仍限于本地编译图/插件/集成测试。

- 更正：上面"API steer 被拒"只适用于 child 冷启动时的 `/api session/prompt`；用户在 GUI 中打开该 child 后，输入框可正常发送（15:32 的「hi」作为 `user` 来源进入 turn5）。

## 现役真机：被拒收尾全链路（2026-10-22 15:34–15:36）

用户手动在群里发 A3、B3，并在 A3 处理中于 GUI child 页面用 cmd+enter（steer）插话「插话」；随后又以排队方式发「插画2」。child `session-d8d01e4c`：

- turn6：spliced A3 投递（user, next-turn）→ spliced「插话」（user，next-turn 后转 next-step）混入同轮 → `pet_context`、`pet_collaborators` → `pet_locus_finish {reply,"收到A3"}` 返回授权拒绝文本（工具结果标记 ok，内容为拒绝；模型据此判断被拒）→ turn6 completed。
- Host 日志依次：`locus authorization refused: finish:claim-unbound` → `locus turn: turn-ended` → **`locus delivery released: reply-refused`**。GUI 插话不对应任何 Delivery，按设计保持 unresolved，因此原因是 claim-unbound 而非 mixed-source；两者同为 current capability 拒绝，均触发收尾。
- turn7：B3 投递立即进入，`pet_locus_finish {reply,"收到B3"}` 成功。turn8：排队的「插画2」作为独立 GUI 轮处理，无 finish、无回群。
- 飞书群（bot 读取）：A3 无任何正文回复，触发消息 reaction 为 **CRY**（失败反馈）；B3 回复「收到B3」，reaction **DONE**。
- 对照 delta 场景"回复被拒后本轮结束"：A 收尾为 failed/reply-refused、不发正文、失败反馈、B 立即成为 current 并完成——全部满足。场景文字据此由仅 `mixed-source` 扩为 `mixed-source` 或 `claim-unbound`。

## 仍未完成

- restore-pet-inquiry-runtime-channel 的其它未完项不在本 change 范围。
- 限制：真实模型actor组合、完整插件fixture、真实controller集成分成三套，并非一个完整真实Host+Feishu E2E。不得把本地通过称为上线验收。
- restore-pet-inquiry-runtime-channel 的其它未完项（managed entry覆盖、result crash恢复、三方闭环等）未纳入此次修复，仍未完成。
