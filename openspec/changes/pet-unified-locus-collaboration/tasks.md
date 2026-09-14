## 1. 核验宿主适配边界

- [x] 1.1 阅读当前 DSH pin、插件集成陷阱与子会话接缝；以独立样例验证自动主会话初始化、首次 fork、冷恢复，不将旧 README spike 当作验收
- [x] 1.2 验证首轮与原生加载时 scoped context 安装、初始化锚点写回；不替换主会话 preset/Skill，不能满足则报告宿主缺口而非回退旧执行链
- [x] 1.3 验证 read/write 真实效果矩阵：写父创建只读子会话、普通目录、ws 子目录、sw 兄弟目录、冷恢复；定义 unsupported-write 明确拒绝结果，不隐式扩大权限
- [x] 1.4 读取真实 bot 入群和话题消息事件并建立脱敏测试样例；确认初始化授权、thread 寻址与丢字段失败关闭，无法验证入群时支持首次 allowlist at 补齐
  - 样例取自本轮人工验收实际读到的真实事件（`test/fixtures/real-lark-events.ts`）。脱敏规则：每个租户标识的十六进制主体替换为同长度同字母表的合成值，**保留前缀、长度量级与 `om_x` 消息形态**；不含任何消息正文、tenant_key、token 或 app secret。已逐项核查真实 chat/user/thread/app id 均未出现在仓库中
  - 为何必要：既有测试用 `oc_project`、`om_root` 这类手写占位符，虽能通过前缀校验，但长度与真实 id 差一个量级，且从不复现 `om_x…` 形态——这类替身能在实现错误时仍全绿（本轮已three次踩到同类问题，见 pitfalls 第 7 节）
  - 写样例过程本身又暴露一次推断错误：我按记忆写成扁平对象，而真实 bot-added 是 `schema: '2.0'` 信封、事实分置于 `header`/`event`，且消费端收到的是 JSONL **字符串**而非对象。已按真实结构修正，并加一条「扁平对象必须被拒绝」的反向用例
  - 覆盖：群级 mention 端点推导、话题 mention（thread_id 为稳定入口身份，对应 T3-C1 实测）、同一 chat 的群/话题 endpoint key 互异、缺失 thread_id 时 fail closed（T3-C4 因无法向真实租户注入畸形事件而维持 manual，此为其自动化对应物）、真实 V2 信封解析与扁平对象拒绝
  - 验证：削弱 admission 的 fail-closed 判据后对应用例失败、恢复后 6/6 通过；Pet 1669 项与仓库 121 项全绿
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
  - **进行中（2026-09-13）**：本条含两半，前半已完成并修复一处真实缺陷，后半仍有依赖，故**保持未勾除**
  - **已完成的前半：capability 清单核对，发现并修复缺项**。`proposal.md` 的 Capabilities 只列了 4 个能力（`pet-locus-collaboration` / `pet-qa-group` / `pet-lark-channel` / `dsh-pet`），而 `specs/` 下实际有 **5** 个 delta 目录——遗漏 `dsh-runtime-provisioning`。该 delta 承接任务 8.6，对应 `dsh.yaml:97` 的 `hostRuntimeCompatibility`（`kind: pet-unified-locus-v1`，`supportedDshVersion: 0.1.2-rc.1`）版本锁定声明，含两条 ADDED 要求
  - 为何必须修：`openspec validate --strict` 对此**不报错**（校验以 `specs/` 为准，不比对 proposal 叙述），归档以 delta 目录为输入，因此清单缺项不会被任何自动检查拦住；但 proposal 是人类审阅归档范围的入口，缺项会让「本 change 改了运行时选择规则」这一事实在评审时不可见。已补入 Modified Capabilities（`dsh-runtime-provisioning` 在 `openspec/specs/` 下已存在，故归 Modified 而非 New），并注明不变的四条既有要求与本 delta 的作用边界
  - **未完成的后半：仍依赖 10.x**。本条要求「只有所有宿主适配与产品场景验收完成才标记实施完成」。当前 10.1/10.2/10.3/10.5 已判 NOT APPLICABLE 并移交 B027/B028，10.6 已拆分且其（a）半已证；剩余未决项为 10.6(d) 的部署子句（仓库内无部署审计记录可证）。该子句结清前，本条不得勾除
  - 严格校验现状（本次实际执行）：`openspec validate pet-unified-locus-collaboration --strict` 与 `openspec validate pet-locus-independent-agent-inquiries --strict` 均通过，`git diff --check` 通过

## 10. 人工验收发现与收敛待办（2026-09-11）

- [~] 10.1 调查 DSH continuable child 的模型选择、持久化、恢复与 owner 可控接缝；形成与“不得静默切换模型或来源”一致的方案，明确是显式切换、Locus 首选模型/有序降级列表，还是宿主能力缺口
  - **NOT APPLICABLE（移交 B028，2026-09-13）**：原任务文本保留在上方不做改写。本条的全部范围（模型选择接缝调查、显式切换 vs 有序降级的方案定型）归属 backlog `B028` Locus 子会话显式模型策略与可审计降级，不在本 change 交付
  - 依据：`openspec/changes/pet-locus-independent-agent-inquiries/proposal.md:36` —「B028 的显式模型切换/降级不在本期，新独立 child 须显式保留经核验的创建模型策略，不能因换 provider 静默换模型」。该行确立 B027/B028 对 B035 出范围，本 change（B035 的前置统一模型）同样不承接
  - 未被移交、仍然成立的约束：本 change 规范中「恢复使用原主/子会话、不得静默切换模型或来源」保持有效且已实现——它是**禁止**条款，不要求存在切换能力；B028 未落地期间的行为是 fail closed（模型不可用即 Delivery `failed`，不换模型重试），已在 T3 断网验收中实测（见 B027 条目 2026-09-12 更新）
  - 归档影响：本条不构成归档阻塞，但 B028 必须在 backlog 中保持未完成状态，不得因本条勾除而丢失
- [~] 10.2 在规范与设计中定义模型不可用的可判定分类、降级适用边界、审计字段、防重复执行、费用/出口策略，以及 network-model-guard fail-closed 不可绕过约束
  - **NOT APPLICABLE（移交 B028，2026-09-13）**：同 10.1，依据 `openspec/changes/pet-locus-independent-agent-inquiries/proposal.md:36`。可判定分类、降级边界、审计字段与费用/出口策略只有在 B028 决定「是否存在降级」之后才有定义对象，先于该决定写入规范会把一个未定方案固化为基线
  - 唯一不移交的子句是 network-model-guard 的 fail-closed 不可绕过：该约束由现有 capability `home-network-model-guard` 独立承载，不依赖本条；本 change 从未引入任何绕过该守卫的路径，B028 实施时须继承此边界
- [~] 10.3 实现 Locus 子会话模型恢复能力及相关 Host/管理面，确保已有失败 Delivery 不被重放、同一 child 上下文连续且任何模型变化对所有者可见
  - **NOT APPLICABLE（移交 B028，2026-09-13）**：实现部分随 10.1/10.2 一并移交，依据同上
  - **但其中两项不变量已在本 change 内独立实现并验收，不随移交流失**：（a）已失败/已结算 Delivery 不被重放——见 10.15 记录（覆盖「已结算/已失败投递不被重放」，其中「重启时未结算 Delivery 不被重放」明确记为未覆盖）；（b）同一 child 上下文连续——T2-C3 重测复用同一 child `session-c9af096f` 且 turn 递增（见 10.7），成员变动后仍连续（见 B029 实测证据）
  - 仅「模型恢复能力」与「模型变化对所有者可见」两项移交 B028
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
- [~] 10.5 定义并实现 Delivery 失败的安全 Host 控制面回执：只回当前 caller-bound 飞书入口，低敏、幂等、可行动，不代发业务正文
  - **NOT APPLICABLE（移交 B027，2026-09-13）**：原任务文本保留在上方不做改写。通用安全失败文字回执归属 backlog `B027` Pet Delivery 失败向原飞书入口返回安全诊断，不在本 change 交付
  - 依据其一：`openspec/changes/pet-locus-independent-agent-inquiries/proposal.md:36` —「B027 负责通用安全失败回执，本 change 定义未回复/询问失败的事实和诊断接缝，不扩展 Host 代发业务正文」
  - 依据其二：`openspec/changes/pet-locus-independent-agent-inquiries/specs/pet-locus-collaboration/spec.md:71` —「通用失败文字回执由独立 B027 承接，本要求不授权 Host 代发业务正文」。该行是后继 change 的规范正文，已把通用回执明确排除在 Host 职责之外；本 change 若就地实现，会与后继基线直接冲突
  - 本 change 已交付且不移交的部分：失败表情 fail-soft、Delivery `failed` 状态不重放、结算与发送结果分离（任务 5.5、10.15）。缺口是「飞书侧只有表情、没有可读诊断」，该缺口在 B027 中已有真实证据（2026-09-12 T3 断网实测）
  - 归档影响：本条不构成归档阻塞；B027 必须在 backlog 中保持未完成状态
- [~] 10.6 为模型恢复、空白主会话跳转与失败回执补相关测试，运行 Pet typecheck/范围测试/build，并经主仓 dsh build 部署
  - **SPLIT（2026-09-13）**：原任务把三件互不相干的事捆在一条里，整体勾除会虚报两项，整体留空会埋没一项真实成果。逐半分述，原任务文本保留不改写
  - **（a）空白主会话跳转测试 —— 已完成，本次独立复核通过**。这一半是 10.4 的测试面，确实已落地：
    - `packages/dsh-pet/test/locus-dsh-port.test.ts:430` `describe('locus main opening briefing')` 覆盖开场说明本身——`:438` 断言 briefing 含 chatId/workspaceId/workspacePath/label 四项身份事实；`:447` 断言其自述为「只是陈述上下文」「不是任务」「待命」「不会自动回传」；`:459` 断言 briefing 经**常规** `followup` 接缝投递且顺序为 `attach → rename → brief → flush`（即 rename 持久化先于 briefing）；`:505` 断言宿主无 briefing 接缝时主会话仍能创建，不因可选能力缺失而阻塞发布
    - `packages/dsh-pet/test/locus-management.test.ts:386` `describe('locus session describer')` 覆盖 10.4 的第二个缺陷（管理面伪报不可用）——`:398` 未加载但可冷读的会话判为 `available` 而非 `missing`；`:415` 已归档优先于可读性且不调用 inspect；`:429` 不可读判为 `missing`；`:441` 宿主无冷读能力时省略 availability 而不断言缺失；`:453` 可读无标题仍为 `available`；`:463` 同一会话的判定不随加载状态漂移
    - 复核实测：`npx vitest run test/locus-dsh-port.test.ts test/locus-management.test.ts` → 2 files / **41 tests passed**，exit 0
  - **（b）模型恢复测试 —— NOT APPLICABLE，随 10.1–10.3 移交 B028**。被测对象（模型恢复能力）本身已移交且不存在，无法也不应为其补测试
  - **（c）失败回执测试 —— NOT APPLICABLE，随 10.5 移交 B027**。同上，被测对象已移交
  - **（d）部署子句 —— 无法从仓库证明，如实记录为未证实**。本条要求「经主仓 dsh build 部署」，但仓库内不存在任何部署审计记录可供核对：`dsh build` 的产物落在 `~/.dsh` 部署目录而非版本控制内，本仓库也没有留存部署时间戳或指纹的文件。10.12/10.13/10.14 条目中的「已部署」自述是当时的执行记录，**不是可复核的证据**。因此不勾除该子句，也不据自述记为已完成；归档前若需要该保证，应由所有者当场执行 `dsh build` 并另行记录，而不是从现有任务文本追认
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
- [x] 10.13 修复 write 授权无法达成的实现缺口（T6 前置阻塞）
  - 缺口：`policy-verification.ts` 要求锚点同时满足 `authorization === 'authorized'` 且 `provenance` 以 `host:` 开头，但唯一的写入点 `persistence.ts confirmContextAnchor` 硬编码 `authorization: 'unknown'`、`provenance: 'owner:<id>'`。全局无任何代码路径能产生这两个值，因此 `-s write` **在任何情况下都必然被拒**——是 fail closed，但不存在可成功路径
  - 修复：write 授权改为**每次核验时派生**，不再依赖持久标记。要求两个独立事实同时成立——所有者已确认执行根（意图，只有 owner-facing confirm 能写入），且 live sandbox 回读的 workspace root 与之规范化后精确相等（权威，由 Host 构造性派生）。所有者显式 `unauthorized` 作为硬拒绝优先于 root 一致
  - 为何不补一个「授权」写入点：已存储的授权会过期——sandbox root 可能在标记写入后改变，而持久化的「是」会凌驾于 live 真相之上。派生式判定保持新鲜且 fail closed
  - 安全边界不变：仅 root 一致而无所有者确认仍拒绝；仅有确认而 live root 不一致或缺失仍拒绝；canonical 比较仍抵抗符号链接与非规范路径；提权失败仍回滚 live policy 并维持 read
  - 验证：policy-verification 测试重写为派生模型（7 项），削弱守卫后用例失败、恢复后全绿；permission-mutation 拒绝表更新为新模型的五类拒绝场景，替身锚点改为 Host 真实持久化形状；Pet 1651 项与仓库 121 项通过，已部署
- [x] 10.14 修复默认 Q&A 因 tokenStatus 字面量猜错而永不可用（T4 前置阻塞）
  - 缺口：`parseUserIdentity` 要求 `identity.tokenStatus === 'ready'`，而 lark-cli 对可用 token 实际返回 `'valid'`。因同一对象里 `status` 是 `'ready'` 便类推 `tokenStatus` 同值，该闸门永远不可能通过，默认 Q&A 在任何情况下都建不出来——与 10.13 同类：判据要求的值真实系统从不产生
  - 掩盖原因：测试替身同样写了 `tokenStatus: 'ready'`，与错误实现犯同一个错，测试长期全绿
  - 修复：不 pin 该字面量（取值域无文档，pin 任何单值都可能再次锁死），改为依据 `status`（过期时为 `needs_refresh`，承载新鲜度）与 `--verify` 返回的 `verified`，`available` 继续保留。stale 与 unverified 仍 fail closed
  - 验证：替身改为照抄真实响应；新增词表回归（tokenStatus 取 valid/ready/active/undefined 均应通过），恢复旧判据后该用例失败；Pet 1663 项通过。陷阱记入 pitfalls 第 7 节，含识别信号「功能从来没成功过时应优先怀疑判据而非环境」
- [x] 10.15 完成 checking 全部 8 条 trail 的人工验收：27/27 checkpoint 通过
  - T1 Host/Channel 基线、T2 入群初始化与准入、T3 群与话题精确寻址、T4 默认 Q&A 与双向发现、T5 显式绑定与来源切换、T6 读写权限与 caller-bound context、T7 Delivery 往返与私聊隔离、T8 退出重建与冷恢复
  - 验收期间发现并修复 7 处真实缺陷：空白主会话（10.4）、管理面伪报不可用（10.4）、宿主注入上下文污染回复授权（10.9）、入队即唤醒导致 sticky-mixed（10.10）、write 授权无可达路径（10.13）、子会话 GUI 不可用（B032）、默认 Q&A 因 tokenStatus 字面量猜错而永不可用（10.14）
  - 方法论修正：验收载体由「造靶子再打靶子」改为融入真实开发流程（10.11）；问法由提示结论改为中性只问事实，判定一律以 Host 持久层与文件系统为准，子会话自报仅作交叉核对
  - **未覆盖项（如实记录，不含糊）**：T8-C2 的「未完成 Delivery 未被重放」子项未验证——重启时未结算 Delivery 为 0，制造该场景需在投递执行中途强杀 Host，风险不可控。已覆盖的是「已结算/已失败投递不被重放」，两者相关但不等同
- [x] 10.8 收敛验收期 UX backlog B026–B028、B030–B034；验收完成后统一评估，不在修复期间扩散非阻塞视觉优化
  - 本条要求的是**收敛评估**（逐条定去向并如实记录），不是「全部实现」——后半句「不在修复期间扩散非阻塞视觉优化」正是反对就地实现。评估已完成，八条去向如下，全部已回写 `BACKLOG.md`
  - **已完成（2 条，本次逐条复核源码，非采信条目自述）**：
    - `B031` 投递 prompt 头过长且逐条重复 → 已实现。证据：`packages/dsh-pet/src/host/locus/context.ts:245` 注释与实现确立「routing preamble is sent ONCE per child」，`:258` 的 `subsequent` 选项省略一次性前言，`:352` 为已收到前言的 child 渲染后续投递
    - `B032` 子会话在 GUI 侧不可用 → 两处缺陷均已修复。证据：标题——`packages/dsh-pet/src/index.ts:1224` 在 child 创建后显式 `ctx.sessionTitle.rename(childSession, input.label)`，best-effort 且失败只记日志（`:1213–1222` 注释说明为何不回滚）；打开路径——`packages/dsh-pet/src/client/index.tsx:360` 走 `ctx.sessions.openSubagent(...)`，`:348` 注释记录官方契约拒绝裸 session 地址
  - **移交相邻 backlog（2 条）**：`B027` ← 本清单 10.5；`B028` ← 本清单 10.1/10.2/10.3。依据见各条目所引 `pet-locus-independent-agent-inquiries` proposal 与 spec 行号。两条**仍为未完成**，移出本 change 不等于关闭
  - **确认仍未实现，本期不做（4 条，逐条复核源码确认缺口真实存在）**：
    - `B026` 管理面可辨识性与「第 N 代」说明 → 未实现。`settings.tsx` 中无任何代际概念说明或名称优先呈现的实现
    - `B030` 管理面按入口聚合 → 未实现。`settings.tsx` 中搜不到聚合/折叠/分层结构，仍为平铺
    - `B033` 设置页不应提供按主会话创建默认 Q&A 的入口 → 未实现。缺口仍在原位：`packages/dsh-pet/src/client/settings.tsx:1168` 的 `defaultQa.length === 0 && parentIds.length > 0` 分支仍按裸 session id 渲染创建按钮（`:1178`），条目卡片上的「创建/打开默认 Q&A（此主会话）」按钮亦仍在（`:1160–1162`）
    - `B034` 面板与操作回执重叠 → 未实现。`packages/dsh-pet/src/client/styles.ts:185` `.dshpet-panel{bottom:78px}` 与 `:189` `.dshpet-panel-receipt{bottom:48px}` 仍是两个互不感知的硬编码定位，根因未动
  - 这四条均为**非阻塞 UX**，不影响协作模型正确性或安全边界，按本条后半句的约束不在本 change 实现；已在 `BACKLOG.md` 各自条目记录当前真实状态与上述证据
