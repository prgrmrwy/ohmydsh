## 1. 固定基线与责任边界

- [ ] 1.1 重读 current specs、相关 ADR、旧 inquiry change 和 runtime/recovery active changes，记录任务交集、单一修改责任与归档对齐方式；明确用户 A 的受管入口边界不满足旧 change 的完整 G4，不改 current child safe composition、待办受理规则或其它 change 完成状态
- [x] 1.2 核验本机正式 Host、manifest pin、实际解析的 agent/agent-loop/subagent/Pet 产物身份与 marker/probe，保留脱敏证据；禁止远端部署（证据：正式 Host 由 `.launcher-builds/e2aea730…` 启动，native owner verifier 10 项通过；部署 Pet lib 时间与提交逐次核对，见 checkpoint）
- [x] 1.3 用真实模块组合重现“pet_inquire accepted 但目标无 inbox/turn”，把原 70 项通过基线与新增失败回归并列，不依赖模型自报或 todo 成功样本（证据：真实 AgentLoop 编译图 `test/inquiry-production-local.test.ts`；真机故障样本 session-15859f3d / session-88d074e0）

## 2. 独立执行与发布门槛

- [ ] 2.1 审计 0.2.0-rc.2 官方已发布声明/文档的隔离 claim 与受管工具效果守卫接口，按官方→插件级→最小 compat 顺序选取路径；先枚举真实 Host 通信/委派/待办执行/授权入口和 alias，记录具体 API 与行号，不新增任意 shell egress 沙箱
- [x] 2.2 在同一实际解析链下建立 throwaway 行为探针，覆盖 head next-turn 单独 claim、next-step GUI 保留、默认普通轮不变及受管异步 wrapper；先取得失败用例（证据：`test/inquiry-managed-effects.test.ts` 14 项与 compat 探针，现役编译图）
- [x] 2.3 实现并接入经证明的询问/结果独立执行能力；如需 compat，更新受管 patch/provenance/launcher 与精确 pin 验证及退役说明，不仅添加 marker
- [ ] 2.4 将完整 queue consumer、答案/outbox 和 A 边界的受管入口守卫纳入 readiness；缺任何一项时接受前明确拒绝且无新记录，保留公共查询/名单能力，不将 shell 内部效果隔离列为已经满足的保证（部分：缺 AgentLoop/探针/tools 时拒绝且无新行已测；readiness 的受管守卫只核 final-guard 标记，未覆盖全部原生/授权入口）

## 3. 最小持久协议与原子提交

- [x] 3.1 选定版本化 answer 与问题/结果 handoff 形状；记录 Host 关联上下文：circle/locus 为范围、Delivery/local work 为原请求、inquiry/trace 为分支/链，session/generation/message/turn 为身份与执行证据；不建通用 tracing 服务，不复制回复目标真相（协议版本 17；Delivery 关联走 local work → inbox message → Delivery，见 `inquiry-result-proof.ts`）
- [x] 3.2 实现持久答案及 answer/answered/result-pending 同事务提交，覆盖 put-if-absent、重复答复、版本兼容与失败全回滚
- [x] 3.3 增加精确 dispatch intent/claim/turn 与 result intent/claim/segment 记录，验证预留 messageId、claim 早于绑定竞态、queued 答复拒绝和消息去重（证据：handoff-store / runtime 单测；真机 child↔main 两次 intent→claim→回答）
- [ ] 3.4 编写离线版本迁移与旧 inquiry disposition-required 规则，dry-run 不变更、保留旧证据、旧 reader 不静默读取新协议；旧本地工作仅凭唯一消息/turn 证据回填（部分：v15→v17 迁移已由用户在本机执行；旧 inquiry disposition 规则未实现）
- [ ] 3.5 实现结果 retained/refused 与 inquiry 终结的原子/幂等提交；复用适用 cancel/needs-review/unavailable 终态，保留答案、释放本分支预算，不伪造 delivered；事务失败不提前释放、重启投影一致、独立 unknown-terminal 不被抹掉（部分：retained/refused 原子提交有单测；未在真机或崩溃边界验证）

## 4. 生产派发和答案回送

- [x] 4.1 接通 target pump，每 session 单飞、按持久序；执行只看真实运行槽与原生交互等待，不用 lifecycle busy 阻止等待会话回答；自然 turn-end/解除等待触发，不持锁等模型（证据：`inquiry-runtime.test.ts` 单飞/按序；真机 main 收到 child 询问并回答 ×2）
- [ ] 4.2 对 parent 与 continuation-owned child 实现精确恢复和询问入箱；重验同圈/代际，复用原 session/child 模型及组合，不创建替代身份（部分：解析器与 adapter 释放有单测 `71bacb23`/`949e55d8`；真实 child 冷恢复未在运行体验证）
- [x] 4.3 target claim 打开 inquiry segment，继承 Host 关联上下文，注入用途、受众、显式答复与 A 的有限安全边界；绑定执行证据（证据：真机目标轮收到用途/受众并显式回答）
- [x] 4.4 接通 pet_inquiry_answer 到答案/outbox；轮结束无答案/无关联后续工作时生成明确失败，不从 final 猜答案或永久 executing（证据：真机 `pet_inquiry_answer`；无答复失败有真实 AgentLoop 用例）
- [x] 4.5 接通 requester result pump，运行槽占用时排队；重验原工作，actual claim 后原子推进 outbox delivered/inquiry 进度，失败已终态不复活，重复不重复启动（证据：真机答案以 `pet-inquiry-result` 回到 child ×2）

## 5. 权限、原工作与生命周期证明

- [ ] 5.1 从持久 session 请求/消息身份建立 local work anchor，覆盖 claim→waiting→continuation→settled、显式 cancel/finish 与 restart；多分支每个结果独立可续进，全部仅保留/拒绝时关闭 waiting anchor；未知拒绝，不取最新任务；飞书继续用原 Delivery/locus/child/generation（部分：local work anchor 已用于 Delivery 关联；cancel/finish/restart 的完整生命周期未验证）
- [ ] 5.2 在 target/result segment 中优先继承 origin、原工作、受众及 parentInquiryId/trace；真实工具 A→B→A 拒绝，续进不能新建根绕过累计/深度/待处理预算（部分：A→B→C 目标派发与循环拒绝已测；完整 C→B→A 答案闭环未测）
- [ ] 5.3 接入 A 的受管入口守卫，覆盖实际工具/alias、异步 wrapper 与延迟受管效果的最终重验；拒绝飞书回复、普通 agent 通信、委派、待办请求执行及权限/绑定变更，关闭后无串轮权限（部分：守卫已接入并有 14 项编译图测试；readiness 未核全部入口，见 2.4）
- [ ] 5.4 用 fake ports/无真实凭据介质验证父原 shell/Git/查询保留、普通业务轮不变、child safe composition 不放宽；明确通用工具内部效果只受已有策略/模型约束，不以 prompt 或一次未外发证明强隔离
- [x] 5.5 将 result 证明接到既有 finish/wait，只有原唯一有效 Delivery 可继续；GUI/local、终态/到期/换代与后续 B 不得取得 A 的受管回复权（证据：`0b2910ff` + 重放 `a13aa67c`；2026-10-21 11:10 真机 child b6de0b00 问主会话 1baf0786，结果轮 `pet_locus_finish` 回群成功）
- [ ] 5.6 等答案释放运行槽但保持 lifecycle 在途；cancel/finish 及永久结果处置按提交事实收敛分支，保持 deadline/FIFO，不新增 Delivery/表情/外发

## 6. 重启对账与可见状态

- [ ] 6.1 新协议 startup recovery：可证明未交接者恢复、已有 inbox 不重复、已 claim 按证据收敛、未知 needs-review；先 readiness/成员重验
- [ ] 6.2 覆盖接受、intent、入箱、claim、答案事务、outbox 交接、result claim 与终结事务各边界 crash/重投，不重复模型工作或吞输入
- [ ] 6.3 接通 ownerProjection/wire/settings，展示真实标识/阶段/等待/能力/原因；空/未知/读取失败不同，不泄露正文或混入待办，不将 A 展示为完整外发隔离（部分：只读 owner 投影已接生产路由；设置页未展示）
- [ ] 6.4 旧记录只读对账及显式处置，首次上线不 pump 旧 queued；覆盖重复旧问题、归属失效、Delivery 到期，不按正文自动去重

## 7. 完整验证与局部回归

- [x] 7.1 真实 pinned runtime 加测试介质验证 child→parent→child 与 parent→child→parent；各阶段同 inquiry/原工作引用，全链路关联不能仅凭 locusId（AC1/AC6/AC8）（证据：真实 AgentLoop 双向用例；2026-10-21 真机 child→parent→child 全链路同一 inquiry-dg0kbtt6tlq，Delivery 回复成功）
- [ ] 7.2 生产 pump 验证父 busy+GUI、requester busy、冷恢复、独立 claim、父子不同根互等可推进，生命周期仍在途（AC2）
- [ ] 7.3 验证同 locus 的 A/B、本地 A/B、终态/过期/换代迟到答案、GUI 无受管回复能力及无答案失败；结果处置释放预算/忙关联，事务失败/重投/crash 不泄漏（AC3/AC4）
- [ ] 7.4 真实注册工具验证 nested/result trace 继承与循环/预算拒绝；受管入口/alias/wrapper 撤销前后失败测试、父 shell 保留与 child composition 回归（AC7/AC8）
- [ ] 7.5 owner 快照与存储/session 一致、询问不创建待办；回归 track/request_execution/owner accept、同圈/兄弟、silent、idle、saved preset、exact child Session、单 writer 和 interrupted recovery（AC5）
- [ ] 7.6 运行 Pet typecheck/full tests/build、compat focused tests、根 npm test/check:artifacts、git diff --check 与 strict validate，记录真实命令和限制（部分：2026-10-20 Pet typecheck 0 错误、默认全量 3302 通过、编译图 10/4/14；根 npm test、check:artifacts、strict validate 未重跑）

## 8. 本机部署、旧询问处置与收尾

- [ ] 8.1 向用户呈现本机停机/备份/迁移/重启/回滚与在途影响，取得操作和副作用边界；不操作 lumevm/devbox，A 决策不授权真实外发
- [ ] 8.2 获准 owner 只读路由或停 writer 后一致介质核对历史两条存在性、状态、消息/turn 与原工作有效性；不绕锁、不把 accepted 当数据库证明
- [x] 8.3 获准后迁移与 dsh build 物化，连续第二次无变化；启动原 Host、核对 provenance、刷新原 3080 GUI，不起替代 server（用户 2026-10-20 16:06 重建并重启本机 Host，部署 Pet 已含 `0b2910ff`）
- [ ] 8.4 本机获准测试会话用真实模型完成双向问答并核对持久证据；飞书续进仅在另行明确入口/发送边界内验证，不实际发送来测试 shell 剩余风险
- [ ] 8.5 用户选择后处置旧两条（恢复合法未派发项、取消或保留待核查），过期不恢复回复权，不批量执行旧工作
- [ ] 8.6 记录脱敏验收、A 有限保证及回滚边界；对齐旧 inquiry change 重叠条文/归档顺序，不宣称完整 G4 或其全部完成；规范同步和无远端变更确认后再归档
