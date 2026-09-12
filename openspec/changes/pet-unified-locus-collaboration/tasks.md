## 1. 核验宿主适配边界

- [x] 1.1 阅读当前 DSH pin、插件集成陷阱与子会话接缝；以独立样例验证自动主会话初始化、首次 fork、冷恢复，不将旧 README spike 当作验收
- [x] 1.2 验证首轮与原生加载时 scoped context 安装、初始化锚点写回；不替换主会话 preset/Skill，不能满足则报告宿主缺口而非回退旧执行链
- [x] 1.3 验证 read/write 真实效果矩阵：写父创建只读子会话、普通目录、ws 子目录、sw 兄弟目录、冷恢复；定义 unsupported-write 明确拒绝结果，不隐式扩大权限
- [ ] 1.4 读取真实 bot 入群和话题消息事件并建立脱敏测试样例；确认初始化授权、thread 寻址与丢字段失败关闭，无法验证入群时支持首次 allowlist at 补齐
- [x] 1.5 验证子会话执行结算与 Delivery 对应关系，覆盖初始化/私聊/飞书交错；验证并实现不向父自动注入结论的宿主适配，缺能力时停止相关发布

## 2. 统一 locus 持久模型

- [x] 2.1 实现 locus 聚合、endpoint 标准化与代际记录；active 校验主/子会话唯一、workspace 来源一致、权限已核验
- [x] 2.2 实现 endpoint 当前索引、parent→loci、child→locus、parent→默认 Q&A；正反向读写同源同事务
- [x] 2.3 实现群结构 ensure 幂等与群→入口固定锁序，条件提交防止双创建；明确 retired/invalid 与 never-created 区别
- [x] 2.4 实现 Delivery 的消息幂等、执行关联、代际与结算状态，保留内部 Task 为投影时禁止第二生命周期真相
- [x] 2.5 添加仓储测试：并发初始化、代际替换、双向一致性、重复事件、停止标记、不变历史

## 3. 主会话与子会话统一创建

- [x] 3.1 实现自动主会话按群创建、default workspace 校验与来源初始化，不按 workspace 全局共享
- [x] 3.2 实现群/话题层级补齐、显式来源优先、创建时继承后固定；显式话题不改变群默认，执行树拒绝孙辈
- [x] 3.3 实现统一子会话创建/恢复/只读/context 核验与 active 发布；初始化不消费飞书 Delivery
- [x] 3.4 实现 provisioning 的持久操作记录和外部资源补偿，失败方子会话回收与残留群提示
- [x] 3.5 实现 Q&A 默认入口 create-or-open、本人群主、并发点击幂等；issue 绑定不改变默认入口
- [x] 3.6 测试群先行/话题先行/两话题并发结果等价、未知 default 拒绝、既有 locus 不随 default 改变

## 4. 显式控制与来源切换

- [x] 4.1 实现 -b/--bind 与 /bind 前缀解析、至少六位和失败同回执；仅 allowlist，真实群名与短标识
- [x] 4.2 实现自动/继承来源空闲替换为显式来源，同源重试幂等，已有显式不同来源拒绝覆盖，排队/运行时拒绝切换
- [x] 4.3 实现新 read 子会话准备、原子代际切换和旧历史保留；已有话题不迁移，新话题取得新群主会话
- [x] 4.4 实现持久切换通知：明确 S0→S1、上下文来源变化、旧对话未自动合并；通知失败可重试且不无提示派发
- [x] 4.5 实现当前入口 /unbind 与面板归档、忙时拒绝、停止标记、显式重建；群退出不级联旧话题、不允许新话题绕过群停止标记
- [x] 4.6 实现 -s/--scope read|write 的共享权限变更、操作者审计、生效核验与失败诊断；忙时拒绝，重建不继承 write

## 5. Channel 与常规子会话交互

- [x] 5.1 更新接入层为消息/入群生命周期分流，保留专属 bot profile、凭据零接触与独立 channel 降级
- [x] 5.2 实现所有新飞书消息仅 mention 触发（含单聊）、命令独立鉴权、授权群提问豁免、去重水位类型防线；准入之前不创建协作结构
- [x] 5.3 将所有合格飞书工作投递同一子会话 inbox，移除新飞书 root executor/Invocation/waiting-user 分支，不改普通轮盘队列
- [x] 5.4 实现飞书决策问答的普通消息往返，保留问题关联与歧义澄清，不把 GUI 工具等待误当飞书已送达
- [x] 5.5 实现 Delivery 结算关联与表情 fail-soft、业务正文子会话发送、控制回执 Host 发送；初始化和 GUI 私聊无飞书出站
- [x] 5.6 测试原始事件解析、同群不同 topic、不确定 thread 不串投、迟到结算、重复消息与表情失败

## 6. 工作上下文与恢复

- [x] 6.1 实现任务书按需问主会话执行根、项目资料入口和约束；普通目录/ws/sw 不运行新 worktree，锚点确认与存在性分开
- [x] 6.2 扩展 pet_context 为 caller-bound locus 分支，保留普通轮盘 Invocation/Snapshot；当前消息回复权限不得沿用到 GUI 私聊
- [x] 6.3 实现锚点持久与按需查询，不每轮复制完整目录段落；未知锚点如实报告，禁止模型指定其它目标
- [x] 6.4 实现原 parent/child 冷恢复、provider 不可用诊断、恢复策略对账、原生加载 scoped 工具；保留父 Skill 组合
- [x] 6.5 测试共享主会话不等于兄弟记忆同步、无自动回传、主会话失效有限次提示、普通轮盘能力不回归

## 7. 双向管理与可观测性

- [x] 7.1 实现入口→主/子会话、主会话→全部 locus、子会话→所属 locus 的同源 API 与访问边界
- [x] 7.2 实现默认 Q&A、群/话题层级、来源与切换警告、active/invalid/retired、权限及共享根展示
- [x] 7.3 更新 onboarding 为 default 主会话与统一子会话能力核验，移除群 workspace 覆盖与旧飞书 Invocation UI
- [x] 7.4 实现消息→locus 代际→子会话→执行的诊断链；不记录凭据/整段历史，群回执不枚举其它入口

## 8. 破坏性升级与旧模型退出

- [x] 8.1 实现停旧消费、在途工作处理与一致备份，启用独立新模型版本；不转换旧关联、旧路由和飞书 Invocation
- [x] 8.2 实现旧入口不可用提示与显式重建保护，不无提示以 default 身份接管；保留旧群/session/历史和普通轮盘数据
- [x] 8.3 移除运行中的旧飞书分支与旧设置入口，不全局删除普通 snapshot 仍使用的共享模块
- [x] 8.4 更新部署说明和 breaking-change 文档；演练停止新消费后的版本回滚，不对新数据做有损降维，不自动清理旧资源
- [x] 8.5 将 additive Pet domain 版本升级收敛为显式离线 CLI：Host 只 degraded 并记录可复制命令，人工逐机 stop/dry-run/--yes/start；迁移先备份、锁占用/未知版本 fail closed、重复执行幂等，不转换旧关联
- [x] 8.6 将 Pet Locus 临时宿主能力收敛为 dsh-pet 声明式 Host runtime：只影响长期 web Host，官方 build/plugin/dump-config 保持精确 pin；兼容版本变化 fail closed，builder 共享锁、staging 原子发布、失败保留旧成品，迁移旧 `.env.local` 值但保留人类显式 `DSH_BIN`，完成多机器部署、审计日志与幂等验证

## 9. 整体验收

- [x] 9.1 运行 Pet package 的 build/typecheck/tests 与仓库适用检查，记录实际命令；规划阶段不执行部署
- [x] 9.2 验收 design 场景 A/B：研发 Q&A 与 project 群先行最后使用同一子会话执行链，非 at 资料无业务推理
- [x] 9.3 验收场景 C/D：层级顺序稳定、显式 topic 独立、S0→S1 警告可靠、旧 topic S0/新 topic S1，所有新代 read
- [x] 9.4 验收场景 E/F：飞书决策往返、双向发现、恢复、scope 失败、无自动父回报、私聊不串出站
- [x] 9.5 注入创建/切换/通知/权限/恢复各阶段失败，证明不会发布半成品、重复创建、错配结算或静默扩大权限
- [ ] 9.6 严格校验完整 change 并核对新 capability 与旧要求的替代边界；只有所有宿主适配与产品场景验收完成才标记实施完成

## 10. 人工验收发现与收敛待办（2026-09-11）

- [ ] 10.1 调查 DSH continuable child 的模型选择、持久化、恢复与 owner 可控接缝；形成与“不得静默切换模型或来源”一致的方案，明确是显式切换、Locus 首选模型/有序降级列表，还是宿主能力缺口
- [ ] 10.2 在规范与设计中定义模型不可用的可判定分类、降级适用边界、审计字段、防重复执行、费用/出口策略，以及 network-model-guard fail-closed 不可绕过约束
- [ ] 10.3 实现 Locus 子会话模型恢复能力及相关 Host/管理面，确保已有失败 Delivery 不被重放、同一 child 上下文连续且任何模型变化对所有者可见
- [x] 10.4 调查并修复空白自动主会话的导航/身份呈现：它已挂入目标 Workspace，但 0-turn blank session 打开后与“新会话”不可区分；跳转后必须能证明主会话、Workspace 和 Locus 身份，不得伪报可用
  - 根因：主会话以零事件发布。宿主 `blank` 判据是「折叠前缀中无 `turn/start`」，blank 会被 `sessionTitle()` 清空标题渲染成「新会话」、被 `hideChrome` 隐藏会话标识，并且 `connectWorkspace()` 会复用任意 blank 会话——用户点「新建会话」可能被直接交付该 Locus 主会话。实证：真实 T2 主会话 `session-3a7e5b90` 日志仅有 permission/sandbox/approval/title 四条，无任何 `turn/start`
  - 修复：`composeLocusMainBriefing` 在创建时经**常规**会话生命周期（`followup` + 真实 `UserMessage`，与 Pet executor 同一接缝）投递一条开场说明，写明 chat/workspace/执行根，并明确「只是陈述上下文、不是任务、回复了解后 standby」。不特化会话日志、不手工构造事件——主会话就是常规 session
  - 副作用即修复：loop 开轮次时在**任何模型调用之前**写入 `turn/start`，因此即使模型不可用该会话也已脱离 blank 类；locus 发布依据创建事实，不等待模型回复
  - 验证：真实 launcher runtime 实测消息被 `createUserMessage`/`Session.append` 接受、`turn/start` 后 `blank=false`；Pet 1626 测试与仓库 120 测试全绿
  - 第二个独立缺陷（伪报**不可用**）：管理面 `describeSession` 以 `ctx.sessions.get()` 判存在性，而该 API 契约只查「当前已加载到内存」的会话。Host 重启后无人打开过 locus 主/子会话 → 全被判 `missing`，UI 显示「不可用」；且读数随加载/卸载漂移，不能作验收证据。实证：`session-3a7e5b90`/`session-a12149c6` 日志均在磁盘且可读
  - 修复：抽出 `createLocusSessionDescriber`，改以 `sessionController.inspect` 冷读判定，与 `dsh-port.ts` 既有规则（existence 来自 inspect、绝不来自 live registry）同源；已归档优先于可读性；无冷读能力时省略事实而非断言缺失
  - 验证：以真实会话日志实测 —— 主会话 `available` 且带标题、子会话 `available`、不存在者 `missing`；顺带修正两处测试替身（`inspect` 原返回无 events 的假形状，掩盖了真实契约）
- [x] 10.9 修复子会话首条飞书消息永远回不出去：`pet_locus_reply` 报「no exact Feishu Delivery reply target」，但子会话执行完全正常（`turn/end` 为 `completed`、正确调用回复工具）
  - 根因：`agent/inbox/claimed` 对**每条**进入该步的 inbox 消息触发，而 DSH 在**每个会话首轮**注入三条上下文（`agent-instructions` / `plugin` / `skill-catalog`）。turn-observer 查不到它们对应的 Delivery，归入 `unresolved`/`foreign` 并把该轮标记 `mixed`；`currentForChild()` 因 `mixed` 返回 `undefined` → `currentDelivery` 无法解析 → 回复工具 fail closed。故障只在首轮复现，第二条消息起正常
  - 实证：真实子会话 `session-a12149c6` turn 1 的 inbox 含 4 条 `user/message`，仅 `aa7a67df`（`source.kind=user`）是 Delivery，其余三条为宿主注入；同轮 `pet_context` 输出确实缺少 `currentDelivery` 字段
  - 修复：claim 事件携带 `message.source.kind`；`isHostInjectedClaim` 豁免宿主自注入来源（直接忽略，不建轮次、不计入 foreign）。`user` 永不豁免——查不到 Delivery 的 `user` 消息是 GUI 提问或父会话 steer，可能指向其它目标，继续 fail closed；来源缺失同样按参与者流量处理
  - 验证：照抄真实首轮 claim 序列（1 Delivery + 3 注入）写回归测试，移除守卫后 4 条用例失败、恢复后全绿；Pet 1639 测试与仓库 120 测试全绿。陷阱已记入 `docs/notes/dsh-plugin-integration-pitfalls.md` 第 5 节
- [x] 10.10 修复第二层根因（重启验证时 turn 2 仅 1 条消息仍失败）：入队即唤醒 → claim 结构性先于 `bindQueued` 落库 → `handleClaim` 在挂 `unresolved` 的同时把该轮 sticky 置 `mixed`（永不清除）→ `deliveryAvailable` 补救链虽全部成功（绑定/事件/settle 均正确），但 `currentForChild()` 因 `mixed` 永久拒绝 → 每条 Delivery 都回不出去
  - 实证：delivery-2 与 turn 2 完美对应（accepted 03:19:40.879 → queued .897 → started .494，工具调用 03:19:48 时 delivery 正处 running），inbox 仅 1 条消息，仍报同一错误；控制器代码自己注释承认「its claim/end may have arrived before the durable bind」
  - 修复：`mixed` 只由**已证实的污染**置位（同轮第二条 Delivery、lookup 基础设施失败、证实为外部流量）；「暂时查不到」只进 `unresolved`，未决期间由 `unresolved.size !== 0` 照常拒发（安全边界不变），解析证实唯一 Delivery 后授权恢复
  - 验证：新增复现真实时序的回归（claim 先到 → deliveryAvailable 后到 → 授权恢复）+ 三个对照（GUI 混入 / 双 Delivery / lookup 失败 → 永不恢复）；恢复旧 sticky 行为后竞态用例失败、修复后 35/35；Pet 1644 测试全绿。陷阱记入 pitfalls 第 6 节（含「Host stdout 指向 /dev/null，诊断日志未落盘」的教训）
- [ ] 10.5 定义并实现 Delivery 失败的安全 Host 控制面回执：只回当前 caller-bound 飞书入口，低敏、幂等、可行动，不代发业务正文
- [ ] 10.6 为模型恢复、空白主会话跳转与失败回执补相关测试，运行 Pet typecheck/范围测试/build，并经主仓 dsh build 部署
- [x] 10.7 从 checking/T2-C3 原地恢复人工验收：保留首次 Claude restricted 失败事实，验证修复后的同 Locus/child 恢复或显式代际变化，再继续 T3–T8
  - T2-C3 重测 PASS：失败事实完整保留在同一 checkpoint（首次 FAIL + 重测 PASS 并列记录），未以重发掩盖。复用群级 gen 2 locus 与同一 child `session-c9af096f`，Delivery 04:02:47→04:02:55 settled，effective read，child 成功回复且 `pet_locus_reply` 零拒绝
  - T3 全部 4 个 checkpoint PASS：话题 A 建立独立 topic locus 与专属 child；同话题第二条复用同一 locus/代际/child（同 session 内 turn 1→2 递增为硬证据）；群级/话题 A/话题 B 三个不同 child 互为兄弟、全部直属同一主会话、无孙辈；缺失 thread_id 一项按计划维持 manual，以 53 项自动化测试作辅证，不冒充真实异常事件
  - 验收方法修正：改用中性问法（只问事实、不在 prompt 中提示期待结论），避免以被测对象的自述验证其自身行为；所有判定以 Host 持久层为准，子会话自报仅作交叉核对（本轮逐项一致）
- [x] 10.11 修正验收形态：T6/T7 原设计为「造靶子再打靶子」（新建 `.pet-locus-acceptance/` 目录写 canary 文件、以及为触发决策往返而硬造提问），验的是可由单测覆盖的写系统调用穿透性，而非真实协作模型是否可用
  - 改为融入真实开发流程：T6 用 nexus 仓库真实的 README 防腐任务承载 read 拒写 / 授权 write / 降权立即生效三个判据，判定仍以文件系统与 `git diff` 为准而非模型自述；T7 的澄清往返改由真实无法自行判定的点触发（README 对 `rush init-vitest` 生成物的描述，其真相源不在仓库内）
  - 额外覆盖到靶子式设计无法验证的能力：子会话能否读懂真实仓库、改动是否正确且范围最小、diff 是否干净
  - 隔离与可还原：nexus 工作树切至一次性分支 `pet-locus-acceptance`（基线 `973e272dfe`），验收变更可随时 `git checkout` 还原，不污染 master
- [x] 10.12 验收发现 Locus 子会话在 GUI 侧完全不可用（记为 B032，未修复）：
  - 标题被投递样板覆盖——子会话唯一 `session/title` 为 `"## 当前 unified locus 投递（caller-"`、`source: fallback`，因 Pet 创建 child 后未显式 rename，标题由兜底生成器取首条消息（约 1950 字符的投递头）开头。主会话创建路径有 rename，子会话漏了，属对称性缺失；与 B031 同源
  - 打开方式不符合官方 subagent 契约——Pet `openSession()` 调 `ctx.sessions.open(sessionId)`，而官方 `validateAddress` 对 `origin=subagent` 刻意拒绝普通 session 地址（`session/agent-busy`，非 DSH bug）。正确入口为 `ctx.sessions.openSubagent({ parentSessionId, childSessionId, mode })`，Pet 侧三项事实齐备（locus 有 parent/child，descriptor 有 `mode: continuable`）
  - 影响：T7-C3 曾标记 blocked 而非 failed（原设计前提「能打开 child 并在其中发消息」当时不成立）
  - **已修复并原地恢复（2026-09-13）**：创建 child 后显式 `ctx.sessionTitle.rename(session, input.label)`，best-effort（child 已 durably 创建且 locus 身份已记录，命名失败不回滚可用 child，只记日志）；打开路径引入 `PetSessionTarget` 判别联合，子会话走 `openSubagent({ parentSessionId, childSessionId, mode: 'continuable' })`，parent 缺失时拒绝导航而非回退裸 id。新增两条回归（移除 subagent 分支后失败）+ 命名接线断言；Pet 1647 项通过，已部署
  - T7-C3 重测 PASS：GUI 私聊产生本地 turn 9，飞书 Delivery 保持 14 条未变，`pet_locus_reply` 调用数保持 8 次未变。同时交叉验证 10.10 的授权修复未放宽错边界
  - 遗留：标题修复只对**新建** child 生效，存量三个 child 标题不变；T6 中依赖从管理面打开 child 的步骤现已可用
- [ ] 10.8 收敛验收期 UX backlog B026–B028；验收完成后统一评估，不在修复期间扩散非阻塞视觉优化
