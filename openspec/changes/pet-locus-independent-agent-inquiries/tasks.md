## 1. 基线与实施前宿主门槛

- [x] 1.1 核对 `pet-unified-locus-collaboration` 的实际实现与拟发布/current specs；记录四份 delta 的新增/替代边界与前置先归档顺序，前置若变化先更新本规划，不清除其未完成任务
  - 证据：`docs/notes/pet-independent-agent-capability-audit.md`。前置 57/64、七项未完成不变；三项 MODIFIED 标题逐字匹配，四份 delta 共 14 ADDED/3 MODIFIED；现有 unified fork 基线与 B035 预期一致。G1–G5 尚未通过，前置五份 delta 必须先合并/归档。
- [ ] 1.2 G1：用真实固定 runtime 验证 spawn continuable 首轮与冷恢复无父历史/摘要、lineage 正确、自身历史保留；记录实际工具/Skill/模型/cwd 和 silent settlement 行为
- [ ] 1.3 G1：核验显式保留创建模型和工作归属的官方接缝，验证 read 真正生效、父 write 不继承；普通目录/ws/sw 分别测试，不静默换模型或扩大根
- [ ] 1.4 G2：验证已加载父新增首个 locus、child 首轮、Pet 恢复与原生加载的 scoped 装配时序；实际工具快照证明无 global 泄漏、无重复 mount、不自动唤醒父
- [ ] 1.5 G3：验证主/子/兄弟的非 steering 队列与独立执行片段；目标忙及原生交互等待时不混入，等询问不占运行槽，独立根并发互问可推进
- [ ] 1.6 G4：核验询问不提升目标既有权限，read 目标仍不能写、write 目标保留正常业务工具与既有权限；每次正文前重验并硬禁飞书回复、普通跨 agent 消息、再次委派及权限/绑定变更，不改变正常业务持久策略
- [ ] 1.7 G5：核验 inbox claim、答案、结果续进与飞书出站可用的持久证明，列出接受/派发/外呼 crash 窗口与 unknown 对账规则
- [ ] 1.8 将 G1–G5 证据与缺口回填 design；若需 Host compatibility 接缝，明确最窄 patch、精确 pin 与测试，发布前验证能力，不能满足则保持不可用而非弱化已确认语义

## 2. 持久公共事实与 caller-bound 协作者列表

本组复用 Pet 状态介质，不创建公共文件夹；先确立公共记录与 caller 关系，再提供公共查询。成员列表仍仅从 Locus 索引派生。

- [ ] 2.1 定义并验证上下文模式、Inquiry/Answer/Dispatch/result-outbox 记录及索引，关联 requester/target/代际/origin/audience/trace/createdAt，不新增独立圈成员真相；createdAt 只用于等待时长与诊断，不作为自动失效期限
- [ ] 2.2 实现符合唯一 writer 与 domain 规则的 schema 版本演进和离线备份/检查路径，旧统一 Locus 模式可证明才标 fork，未知不猜测，不修改旧日志
- [ ] 2.3 实现 caller 身份解析：主会话按 parent 索引，child 按唯一当前反向关联；冷读存在性，live registry 只作运行状态
  - 模块进展：`src/host/collaboration/caller.ts` 已实现纯解析器及跨 await 重验，34 项测试含真实 durable repository 重开/索引损坏；新增 `host-identity.ts` 对接真实 API 形状的冷读适配（20 tests，含 archive 竞态）；caller resolver 与 Host cold identity adapter 已接入 `query.ts`/公共只读 tool 的纯模块测试；生产 Host 尚未开启该 tool，完整装配仍保持未完成。pending switch-notice sibling 不阻断健康 caller，busy revision 变化不冒充身份变化。
- [ ] 2.4 实现最小名单投影与分页：名称/职责入口/关系/模式/可询问状态，不读取历史生成摘要，不输出 owner 全量视图或原始跨群内部信息
- [ ] 2.5 实现稳定目标引用及接受/派发重验，同圈当前代校验、失效/跨圈统一安全拒绝、旧引用不转交新 child
- [ ] 2.6 名单测试覆盖父查子、子查父兄弟、排除自身与临时 subagent、同群异父、群改绑旧话题固定、卸载可恢复、旧 fork/unknown/retired、分页越权与状态竞态

- [ ] 2.7 定义 parent 唯一公共记录、当前 revision 与修订审计，复用唯一 writer；实现并发首挂幂等空记录，未知与空已填写分开，不创建文件夹或迁移局部字段
  - 模块进展：`host/collaboration/context.ts`（59 tests）实现严格有界不可变值模型；`context-store.ts` + additive v10 schema 在真实 compat Domain 下通过 7/7（并发 ensure、跨实例 CAS、原子批失败回滚、重开）。待实现：首挂 lifecycle 与写入者留痕字段。
- [ ] 2.8 实现 caller-bound 的公共更新/撤回 CAS 工具：授权只取决于 Host 派生的当前范围成员资格，记录写入者身份/代际/时间/来源；圈外会话、临时 subagent、退役 child 与失效 parent 拒绝，写失败不改当前版本
  - 已具备：原子 CAS/审计存储，以及真实 Connection/WebServer route slice（保留为可选查看/纠正面，生产未挂载）。待实现：scoped 写工具与写入者身份记录。
- [ ] 2.9 实现父子共用的 caller-bound 公共事实查询，返回同一当前原子修订，无关 caller/退役 child 拒绝，禁止旧版查询/局部副本 fallback，不自动下载引用内容
  - 模块进展：`query.ts` + scoped `pet_collaboration_context` 纯能力已实现，44 query/scope tests通过；尚未装配到生产 Agent scope，保持未完成。
- [ ] 2.10 测试公共事实 CAS 冲突、读写竞态、撤回与历史保留、公共/局部来源分离、约束冲突与权限不变、问答答案不自动采纳
- [ ] 2.11 测试最后 child 退出后父仍读公共记录且列表空、同父复挂/重建复用、换父不复制、旧话题固定、父失效拒绝、失败 provisioning 不授予公共访问权

## 3. 独立 child 与 scoped 发现装配

- [ ] 3.1 实现新 child 的独立 continuable 创建，明确并持久化模型/组合/工作归属；所有建群、bind、自动群/话题与替换路径使用同一策略
- [ ] 3.2 实现最小身份前馈与按需查询说明，不复制父历史/默认摘要，不重复注入名单，不强制每请求询问
- [ ] 3.3 实现父子协作工具的分能力 scoped 装配：父有公共事实查询/协作者列表/问答但无 child context/reply；child 保留自身 pet_context 并按需查公共事实，不装 root allowlist
- [ ] 3.4 覆盖已加载父首次关联、冷恢复、原生加载、动态撤销与幂等安装，首轮能力不完整时 fail closed，普通会话无关工具面不变
- [ ] 3.5 测试长父历史与独有标识不进入 child seed，child 自身多轮/询问历史可恢复，父后续配置变化不静默重播种或换模型；回归原生子会话导航与 silent 通知

- [ ] 3.6 验证父子公共查询首轮/冷恢复/原生加载一致、公共全文不复制进 seed、不自动推送新 revision；已无 child 的有效父可重装公共只读能力，询问读取公共记录仍遵守 G4

## 4. 定向异步询问与副作用边界

- [ ] 4.1 实现询问接受工具，Host 派生 caller/origin/audience/trace，问题和用途有界，接受前持久化，响应区分 accepted 与 answered
  - 模块进展：`inquiry/ledger.ts`（83 tests）纯记录/状态机，`ledger-store.ts` + 域 v11 在真实事务内完成接受、幂等与预算计数（opt-in 18/18）。尚缺接受工具本身与 Host 身份装配。
- [ ] 4.2 实现每 agent 非 steering 的持久可运行队列，独立派发询问、飞书原请求和结果续进；busy/原生等待时排队，等待别人的答案不占运行锁
  - 模块进展：`inquiry/scheduler.ts`（26 tests）实现忙时排队不 steering、等待不占运行槽、互问不死锁、混合来源拒派发。**受阻**：运行时 claim 为纯删除，拒绝会丢用户 GUI 输入，需窄接缝后才能真正安全排队。
- [ ] 4.3 按 G4 已核验接缝实现询问轮既有权限继承与身份/通信硬底线：目标保留正常工具快照和既有权限，未知工具不因询问获得额外许可；飞书回复、普通跨 agent 消息、再次委派及权限/绑定变更确定性拒绝，公共事实更新仍按成员资格与 CAS 授权；无正文前重验能力时名单明确不可询问
  - 决策更新（owner，2026-03-23）：原 `effect-fence.ts` 的窄白名单和对文件写/shell/外部 API/公共事实更新的一刀切硬禁过严，须按上述“先可用、再按实测逐步收紧”边界改造；现有 53 tests 只证明旧策略，不作为新 G4 通过证据。
- [ ] 4.4 实现 caller-bound 答复工具：绑定真实 target 与 inquiry，接收带来源/时效/确认状态的回答，不抓 assistant final、不允许指定新接收者
- [ ] 4.5 实现答案/失败的持久 result outbox，请求方忙时排队，不唤醒无关父，不为 responder 创建飞书 Delivery
- [ ] 4.6 实现 trace 访问路径、深度/数量/并发限制，嵌套与结果续进继承预算，不允许重置 root 绕过；不循环自动重试，时间经过不自动终结
  - 决策更新（owner，2026-03-23）：移除 5 分钟绝对期限；createdAt 仅显示等待时长。长期等待占用每 session 32 条待处理预算，可由实际 caller 显式取消；取消只写持久状态与不含正文的结构化日志，不产生飞书消息/表情/Delivery。深度 3/每根 16/每会话 32 已在台账与存储实现；并发上限属调度器运行槽策略，待实现。
- [ ] 4.7 测试父问子、子问父、兄弟直询、本地 origin、目标忙/冷恢复/不可用、A→B→A 循环、独立根互问、队列溢出、受众伪造；验证 read 目标仍不能写、write 目标可使用自身既有能力但不能飞书代发/再次委派/改变权限或绑定

## 5. 原请求续进、结算与回复隔离

- [ ] 5.1 将 Delivery 执行关联扩展为多个 Host 绑定 segment，询问等待独立于运行槽，不恢复旧飞书 Invocation/waiting-user 模型
- [ ] 5.2 实现唯一 origin 的结果续进授权，重验原 Delivery/询问未取消/child/代际/权限；时间经过不撤销续进资格，一般 agent 消息及 GUI mixed 轮仍拒发，不沿用上一条回复目标
- [ ] 5.3 区分 segment 结算、待答询问、请求终结、正文 sent/unanswered/unknown，定义确定性完成条件和表情/owner 诊断投影；不把中间进度消息当最终答复
- [ ] 5.4 将询问、结果与续进纳入 busy 判定和取消传播；无在途才允许 scope、解绑、改绑与重建，终态后的迟到结果不得复活
- [ ] 5.5 测试 D1 询问后 D2 进入再收到 D1 答复、双方各有飞书请求、GUI 混入、宿主注入、重复/迟到结算、未回复及出站结果未知，证明无串发与无 Host 代答
- [ ] 5.6 仅提供 B027 可消费的安全失败/未回复事实和诊断接缝，保持业务正文唯一由 pet_locus_reply 发送，不顺带实现通用错误文字回执或 B028 模型 fallback

## 6. 恢复、幂等与故障对账

- [ ] 6.1 实现 queued/executing/answered/result-delivered 与失败状态恢复，依据可信 message/turn 对账，未知派发不重放，重启不按停机时长自动终结有效排队项
- [ ] 6.2 覆盖接受落库前后、入队前后、claim 先到、答案落库前后、结果 outbox 发送前后、续进启动前后等 crash 点；证明重复事件不重复执行
- [ ] 6.3 覆盖飞书发送成功但确认丢失的窗口，unknown 明示且不重发，不对外宣称无证据的 exactly-once
- [ ] 6.4 实现 owner 可诊断的等待时长/失败/待核查与明确取消处置，保留关联历史；取消仅记录持久状态与结构化日志，不产生飞书消息或表情；验证不靠重建逃避未知工作处理
- [ ] 6.5 反向削弱代际校验、mixed 防线、trace 预算和去重各一项，确认对应测试失败后恢复，避免测试替身固化错误接缝

## 7. 存量显式重建与最小管理呈现

- [ ] 7.1 在 owner 管理面显示 fork/independent/unknown 模式、可询问状态与询问诊断，不重写 B026/B030 全部信息架构，不公开圈列表到群
- [ ] 7.2 增加明确的空闲重建为独立模式操作与确认摘要；保持 parent/endpoint/defaultQa，创建新 child/代际/read，重新核对锚点，不复制旧历史/摘要
- [ ] 7.3 复用 provisioning 条件发布、补偿与切换通知门禁，失败保留旧当前指针，通知说明独立新上下文与旧历史未合并
- [ ] 7.4 测试新旧模式混合圈、旧 fork 普通服务不变、旧 QA 不复活、并发重建、待答忙时拒绝、defaultQa 指针保持和旧引用失效

- [ ] 7.5 增加按主会话查看公共说明/资料引用/共同约束的最小 owner 面：展示同圈当前及未来成员共享范围、修订/写入者/来源/未知与局部字段区别；owner 可纠正或清空，冲突需重读，不依赖 agent 自报
  - 模块进展：`collaboration/routes.ts` + 真实 Connection/WebServer HTTP tests 55/55 通过；写入主路径改为范围内 agent 自主提交后，此面定位为查看/纠正，挂载条件与呈现字段待随写工具一并确定。
- [ ] 7.6 验证管理面公共更新时已有请求可继续、下次查询取得新修订、无模型自动唤醒；旧局部内容不自动上收，owner 修订审计不开放给 agent

## 8. 验收、部署与规范收尾

- [ ] 8.1 制定独立 oracle 验收记录：父有独有信息而新 child 不知，child 经名单真实询问后取得答案；以 seed/工具事件/持久询问/飞书出站证明，而非模型自报知道或独立
- [ ] 8.2 在经授权的真实工作载体完成父子双向与兄弟询问、双方忙时排队、原请求跨轮答复、GUI 不出站和无自动父汇总验收，保留轻量脱敏证据
- [ ] 8.3 完成真实 runtime 重启含未完成询问/Delivery 的恢复验收与故障注入交叉核对；无法安全覆盖的场景逐项列明，不以空队列重启冒充已验证
- [x] 8.4 运行 Pet package typecheck/test/build、仓库 npm test 与 check:artifacts、git diff --check；记录真实命令与结果
  - 证据：`npm run typecheck --workspace=dsh-pet`；`npm run test --workspace=dsh-pet`（完整 Pet suite 通过）；`npm run build --workspace=dsh-pet`（host/client/runtime-compat build 通过）；`npm test`（仓库 124 passed/1 skipped）；`npm run check:artifacts`；`openspec validate pet-locus-independent-agent-inquiries --strict`；`git diff --check`。
- [ ] 8.5 实际部署时确认目标 home 与兼容 runtime，按既有显式离线迁移/备份流程及主仓 dsh build 物化；验证第二次 sync 幂等，刷新现有 GUI 和真实飞书入口，不起替代 server 冒充更新
- [ ] 8.6 演练停消费后的版本/介质配套回滚与 forward-resume，不降维新数据、不删除历史、不重放未知结果
- [ ] 8.7 完成公共上下文真实验收：某同源 agent 提交 r1、父子读取同一 r1、另一成员更新 r2 后新查询可见且来源可追溯、无自动广播；公共资料足够时不强制问父，未记录事实才询问；无新文件夹、无历史复制、无权限改变
- [ ] 8.8 回填 B035 状态及证据，重核 B027/B028 边界；确认前置 change 已先归档并对齐 current specs，再对本 change 严格校验和归档，不把规划完成当实现完成
