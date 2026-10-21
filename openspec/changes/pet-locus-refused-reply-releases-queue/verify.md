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

## 仍未完成

- 未提交实现，未 `dsh build` 物化、未重启、未现役真机（失败表情/实际飞书B回复）；任务4.2/4.3不能勾。
- 当前spec仍是已批准delta，尚未合入main/归档；任务4.4保留。
- 限制：真实模型actor组合、完整插件fixture、真实controller集成分成三套，并非一个完整真实Host+Feishu E2E。不得把本地通过称为上线验收。
- restore-pet-inquiry-runtime-channel 的其它未完项（managed entry覆盖、result crash恢复、三方闭环等）未纳入此次修复，仍未完成。
