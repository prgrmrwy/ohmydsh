## Context

B035 的产品选择已由所有者确认：独立历史；同一个主会话及其有效 Locus children 互相发现、按需询问；圈内无需逐次人工审批但不开放全部历史；定向异步、忙时排队；已有 fork child 保留，空闲时由所有者显式重建。

本 change 以 `pet-unified-locus-collaboration` 为实现与规范前置，不以 superseded 的 `pet-locus-multi-binding` 为基线。当前 `openspec/specs/` 尚有旧 QA 1:1 条文；前置 change 定义了替代边界，其 delta 还要求 fork 前缀、child 自身发现和一条 Delivery 的执行关联。本 change 明确修改这些要求，归档顺序必须是前置再本 change。仅当基线行为、权限与存储已成立才启用本能力；规划文档全部存在不等于宿主能力已核验。

### 已阅读的证据与局限

- `BACKLOG.md` B035：长父历史导致 child 继续 GUI 任务且未调用 `pet_locus_reply` 的真实记录；该案例说明主要诱因，不证明去掉 fork 就能保证每次回复。
- `src/host/locus/context.ts`：首轮前言及后续差量，现只指导向 caller-bound main 询问；普通 `pet_context` 应继续只管自身关联。
- `src/host/locus/management.ts`：owner-facing parent→loci、child→locus 发现，不是可直接开放给模型的名单。
- `src/host/locus/turn-observer.ts`：非 Delivery 的父子/GUI 流量不得消费飞书反馈，mixed 轮次拒发。不能为异步答案一概豁免 agent 消息。
- 当前 manifest pin 的 Host runtime 中 `dsh-subagent-spawn-in-process` 声明 `inheritsParentContext=false`，`prepareContinuable()` 返回空初始化；这是候选接缝，不是 Pet 连续运行验收。
- 同一 runtime 的 `dsh-tool-subagent-control`：`list_agents` 只列调用者子孙；`send_message` 只支持直接父子、工作中可能 steer、响应只是投递确认。不能通过修改 prompt 声称支持兄弟安全问答。
- `docs/notes/dsh-plugin-integration-pitfalls.md`：preset 名称不等于装配、inbox claim 含宿主注入与发布竞态；测试替身必须服从真实接缝。
- `docs/notes/pet-unified-locus-cutover.md` 与 `dsh.yaml`：唯一 SQLite writer、离线版本升级、精确 pin 的 Host compatibility runtime、不自动回退旧执行链。

以上代码路径相对于 `packages/dsh-pet/`，宿主证据取自本会话配置的 launcher runtime 安装产物，不假设 npm 上其他版本等价。

## Goals / Non-Goals

**Goals:**
- 新 child 没有父 transcript 或默认摘要，但有正确身份、必要组合、工作归属和 read 策略。
- 公共工作事实按主会话只维护一份，范围内 agent 自主更新并留痕，父子按需读当前修订；不新建文件夹、不自动传播或采纳。
- 父查自己的 Locus children；child 查父及同源兄弟，按持久关系、实际 caller 和当前代际授权。
- 异步问答不经父模型转述、不 steer、不串飞书回复，支持卸载、重启和确定性失败。
- 询问不新增或转授权限；被问方保留自身正常业务能力，同时封锁飞书回复权、普通跨 agent 消息、再次委派及权限/绑定变更等身份/通信越界。
- 旧 child 不丢历史、不静默重建，原请求完成与正文发送可分别核对。

**Non-Goals:**
- 项目文档内容库、自动摘要/同步/采纳、跨 Host 或 workspace 全局 agent 通讯录；少量同源公共事实及引用在本期范围内。
- 放开全局原生 `list_agents`/`send_message` 到任意 session；普通临时 subagent 管理仍走原生工具。
- B028 自动模型 fallback、B027 通用飞书失败文字、B026/B030 完整 UI 重构。
- 共享文件目录隔离、通用业务编排系统或重建旧飞书 Invocation/waiting-user 链。
- 证明任意自然语言回复都不会披露敏感语义；仅提供受众约束、最小信息原则和诚实风险说明。

## Decisions

### D0. 同源协作上下文：公共事实、协作者发现和问答三层能力

这里的“名单”只指协作者列表；同源协作上下文是逻辑服务，不是文件夹。主会话提供归属，Host 提供可查询的公共事实和成员关系，各 agent 自己保存历史并按需问答。沿用 Pet 的 domain/SQLite 基础设施，不复用已闲置的 `skills/store`，不将普通轮盘 Pet Workspace 变成所有 Locus 的公共执行目录，不引入内容下载器或向量知识库。

```text
                主会话 M（持久工作归属）
                          │
             同源协作上下文（逻辑服务）
       ┌──────────────────┼──────────────────┐
   公共工作事实        协作者列表           异步问答
 范围内自主更新/留痕  locus 索引派生      inquiry/result 关联
       └──────────────────┼──────────────────┘
                   M / A / B 按需使用
        各自：历史、任务、Locus 局部锚点、权限和回复目标
```

**公共记录与范围。** 建议逻辑 `CollaborationContext` 按本 Host 的 durable parentSessionId 唯一定位；当前修订包含工作说明、资料引用、共同约束、revision、confirmedBy/At 和来源；关联空记录的建立事实与内容 confirmed 状态分开。项目文档正文仍在原来的仓库或飞书中，引用只提供入口，不保证可访问。新建表是保存公共事实，不是复制成员清单或增加 Project 实体。

**读取与版本。** 建议新增无目标参数的 scoped `pet_collaboration_context()`，与 `pet_collaborators`、询问工具共享 caller resolver。父查自己的记录；child 经唯一当前 locus 找固定 parent。返回当前完整修订、确认来源和未知项，不返回其它圈内容或审计旧版本。首次说明告知能力即可，公共全文不在 seed 复制、不每轮重注入。下次读取见新版本，不自动 push；旧值进入过的历史无法撤销，清空/撤回只保证未来读取不返回，不以旧 local 字段回填公共字段。

**写入面（所有者修订）。** 公共事实只是同源协作范围内的共享笔记：它不授予文件、外呼、凭据或沙箱能力，也不对用户公开，因此不设人工确认门槛，也不按 Locus read/write 分级。当前范围内的 agent 在处理完自己的工作后自行判断是否提交新修订，写入授权只取决于 Host 从实际 caller 派生的成员资格，与协作者列表同一范围。写入按 expectedRevision CAS，冲突要求重读当前修订后重试；每条修订记录写入者身份、代际、时间与来源，历史保留供纠正与审计。仍然禁止自动提取/合并/采纳：局部锚点、父对话和询问答案不会在没有明确提交时变成公共内容。owner 管理入口是可选的查看/纠正面，不是写入的必要条件。

**生命周期默认。** 无 Locus 的普通主会话不预建记录、不强制填写；首个有效挂载幂等 ensure 空记录，并发唯一，child 授权仍等待 locus 正式发布。创建失败残留空记录无成员授权；既有统一 Locus 升级可幂等补空记录但不推广局部内容。后续挂载使用同一当前记录，重建同 parent 也复用。最后一个 child 退出后保留记录，仍有效主会话能读取公共事实、成员列表为空；复挂不重置公共内容。主会话归档/删除/失效撤销 agent 访问，owner 保留历史，不自动换 parent。源切换后新 child 查新 parent 的记录，旧话题仍按固定 parent 查询，两个圈不合并数据。

**公共和局部。** `pet_context` 继续是 child 自身现场的查询，包括局部 projectResources/constraints、executionRoot 核验、权限和 Delivery；父不获得它。旧局部字段保留其局部语义，不因为新增公共层自动搬迁或上收。公共与局部以带来源的独立字段/工具呈现，不做隐式覆盖或散列扁平合并；内容冲突影响当前工作时要求 owner 澄清。实际路径/沙箱/回复权限只由当前 Locus/Delivery 校验，公共自然语言不能决定写授权、变更 cwd 或读取外部凭据。公共记录修订无需等待整个圈所有 agent 空闲，因为它仅改变未来查询的事实，不改变正在执行的权限；查询返回原子完整修订，不暴露半更新。询问结果引用某公共结论时应带修订来源，不自动升级成新公共事实。

**为何不复用各 child 锚点作为公共 store。** 那会有 N 份配置漂移，首次 child 成为隐含主副本，还会自动扩大原局部资料的可见范围。选择一份带修订与来源的单一记录，比拷贝历史或先建知识库更符合当前范围。公共资料已足够时可直接按权限读取，无需询问父；未记录的原因、变化或现场判断再问协作者。

### D1. 独立的是对话历史，不是配置和工作归属

优先使用官方 spawn continuable 接缝，建立同一主会话下的持久 child；保留两层树、原生子会话导航、silent 自动结算通知、同一工作现场。新 child 初始化只提供角色、入口、可信锚点与权限、名单/询问说明，不注入父 transcript、压缩前缀、默认父摘要或旧 child 总结。

创建时显式解析并持久化模型、必要组合和执行目录，不依赖 spawn 的部署默认值改变既有选择。首版维持现有创建时的父模型选择语义，但不复制父历史、不继承父 write；模型不可用时明确拒绝，不做 B028 fallback。恢复使用自身持久配置及历史，而不是恢复时重新采样父配置。Skill 来源与官方组合接缝必须核验；不安装 Pet root allowlist，不把 Pet Workspace 身份强加给 child。

替代方案：fork 加“身份切断”无法消除历史行为模式；默认摘要仍是主动灌入且可能泄漏，不符合已确认预期；每轮 spawn 新 agent 会丢失持续现场，也不采用。

### D2. 一份持久关系，两种 caller-bound 名单投影

不新增独立成员表或 Project 实体。名单使用现有 locus/indexes：

```text
caller M（有效主会话） → parent→当前有效 loci → children
caller A（有效 child） → 唯一当前 locus → M → M + 当前有效 siblings（排除 A）
```

先证明 caller 身份与会话 lineage，再投影。群、workspace、标题都不是圈边界；显式 topic 固定于哪个 parent 就属于哪个圈。retired/invalid/旧 QA child 排除；有效统一 Locus 的旧 fork child 可见但明确模式，询问执行能力不能核验则显示不可询问。主会话有效性也须冷读证明，live registry 仅用于运行状态。

建议 scoped 工具名：`pet_collaborators()`、`pet_inquire(targetRef, question, purpose)`、`pet_answer(inquiryRef, answer)`。名称是规划建议，不改原生工具定义。返回稳定引用、名称、责任入口描述、parent/sibling/child 关系、模式、运行状态、可询问/排队/需恢复/未知及原因。责任描述从名称/显式职责元数据产生，未知不编造；不扫描历史自动生成“知道什么”的简介。

引用承载或关联精确 session 与 locus 代际，缺省不向模型暴露原始跨群 chat ID、路径或管理审计。引用不是 bearer 授权，发送和派发都重新验证。旧引用不重定向新代际。大名单分页，页游标绑定 caller/圈，结果不复制到每轮 prompt。

替代方案：parent 转述名单耗费模型且成为单点；广播名单会过时；owner 管理面直通会过度披露；按 workspace 聚合越过已确认范围。

### D3. 父子 scoped 工具装配，不因成员变化开推理轮

公共事实查询、协作者列表和询问能力与 `pet_context` 分离：父只有协作能力，不得到 child 的 Delivery context/reply。以主会话拥有有效 locus/已建立的公共记录，或 child 当前反向关联为安装依据，覆盖已加载父新增首个 locus、child 首轮、Pet 恢复和原生加载；每个新 Agent scope 幂等安装，已加载实例在后续工具快照前更新。有效主会话已建立公共记录但暂无有效 child 时，保留公共查询并返回空成员列表；其它无关联/失效 caller 撤销能力或拒绝。所有调用仍即时重验，公共记录存在不授予已退出 child 权限。

安装简短使用说明，不把成员清单写成会话消息，不唤醒父模型。不得 global 注册或为了装工具重复 mount preset。首次工具快照与动态装配的真实时序属于门槛 G2，不能依赖一个未等待的 inject 回调。

### D4. 受限询问服务负责横向通信，父模型不转发

```text
飞书 D → A -- pet_inquire --> Host inquiry ledger → B 的待处理队列
          │                                      │
          │                                   独立询问轮
          │                                      │
          └── 原 D 的关联续进 ← result outbox ← pet_answer
                    │
               pet_locus_reply → D 的原始入口
```

Host 从实际执行来源派生 origin：Feishu Delivery、GUI 本地工作或上级 Inquiry。模型不能传 chat/message ID 选择回复目标，也不能把 Feishu origin 改称 private。`purpose` 是问题用途说明，不是授权事实；最终受众由 origin 绑定，无法证明时写 unknown 并收紧披露。

逻辑持久记录（字段名可随 schema 细化）：
- Inquiry：id、requester/target session 和其 locus/generation 或 main 身份证明、circle parent、question/purpose、origin、audience、trace/parentInquiry/visited、createdAt、状态和原因。创建时间只供等待时长与诊断，不作为自动失效期限。
- Dispatch：inquiryId、实际 inbox message/turn 关联、阶段；区分尚未派发与派发结果未知。
- Answer：inquiryId、实际 answerer、文本和显式来源/确认状态、接受时间；不复制 responder 整段日志。
- Result outbox：答案/失败到请求者的交付、resume work identity、去重键及确认状态。

询问正文/答案仅保存所需内容，按 Pet 状态文件权限保护，不写普通诊断日志，不为审计抓取整个会话。台账不是新的协作关系真相，名单仍来自 locus。

状态草图：`queued → executing → answered → result-delivered`；失败分为 rejected/unavailable/cancelled/needs-review。时间经过不产生终态；长期无答复保持在途并可显式取消。答复内容与传递状态分离，回答不等于请求方已经继续。工具以 Host 调用身份与 inquiryRef 校验 actual target，不接受任意接收方；普通 assistant final 不自动抓取成 answer。

### D5. 排队按可运行轮次调度，不持锁等待答案

目标正运行或处于原生交互等待时，询问排队，不注入为 steering。idle/可恢复时才按持久接受序派发独立询问轮。agent 询问别人后释放当前运行轮次，不保持占用 session 的同步工具调用或锁；有待答询问的业务工作仍属在途，但不阻塞此 agent 处理其他可运行消息或询问。否则 A/B 互有未完成业务时即使无 trace 环也会调度死锁。

同一 agent 一个时间只执行一个已确定来源的工作片段。新飞书请求、询问、询问结果续进不得在同一 turn 混合 claim；运行中到达的普通 GUI/原生 steer 仍走既有 mixed fail-closed，不从 prompt 分类“可信”。答案到达请求方忙时也排队，不 interrupt。原生 GUI 工作无法安全独立排队时，功能返回能力不可用，不在中途替换工作身份。

首版可测试运行预算：每根询问链最多 3 条边、累计 16 次询问、每 session 最多 32 条待处理询问；不设置业务时间期限。Host 自动继承 trace/visited，不允许 inquiry-origin 的新调用伪造 root；当前链访问过的成员拒绝再次访问。超过数量限额提供明确失败，模型不轮询、不自动重试整条链。长期等待继续占用待处理预算并在名单/管理面显示等待时长，可由实际 caller 显式取消；取消只写持久状态及不含正文的结构化日志，不产生飞书消息、表情或 Delivery。独立根的并发互问通过“等答案不占运行槽”保证可推进。选择无自动期限是为了先保证异步协作可用：目标忙、Host 重启或请求方暂时运行中都不应让有效答复被时钟误杀；未来如需收紧应基于实测引入软提醒，而非静默自动终结。

### D6. 信息询问与业务执行权限分开

圈内自动批准的是联系资格，不是把 B 的权限或私人上下文转授给 A，也不是把 A 的请求变成新的授权。询问轮继承 B 当前正常业务的工具快照和既有权限上限：read B 仍不能写；本来具有 write 或外部工具资格的 B，可为形成答案执行其正常策略允许的必要操作。首版不再维护一份窄小的“只读安全工具白名单”，也不按工具名称一刀切禁用文件写、shell 或外部 API；这些调用继续由 B 的既有文件策略、沙箱、凭据与工具授权约束。公共事实更新同样继续按圈内成员资格和 CAS 规则授权，而不是因询问轮额外禁用。自然语言请求是否值得执行仍属模型判断，不能宣称这是完备的代执行沙箱。

询问轮仍有不可覆盖的身份/通信硬底线：禁止使用 B 的 `pet_locus_reply` 或任何飞书出站目标；禁止普通跨 agent 消息和再次委派来扩散执行；禁止权限、scope、Locus 绑定或代际变更。每个工具正文前重新核验实际 B、当前代际和本询问 segment 仍有效，不能把 preparation 时的结果当长期 token；关闭或撤销后拒绝尚未进入正文的调用。该限制不改变 B 正常业务的持久档位，也不在 A 询问期间临时降权。

这是 **G4 发布门槛**，但门槛聚焦于“询问不提权、身份/通信不串用”，不再试图证明所有业务副作用都被询问轮禁绝。若现有 runtime 无法在正文前重验或封锁上述硬底线，必须给出窄接缝方案与证据。原生父子 send_message 不作为可绕过本询问协议的 fallback；普通模型原生消息不产生 inquiry 授权、答案关联或 Delivery 回复权。本 change 不宣称封锁整机任意代码的全部通信行为。未来若实测发现某类工具风险，可基于工具效果逐步收紧；扩大圈范围、身份/通信能力或凭询问提权仍须重新确认。

### D7. Delivery 是原请求锚点，turn 是执行片段

现有“一轮结算对应投递”的链路扩展为 `Delivery → 多个经 Host 关联的 execution segment`，不引入飞书 root executor、Pet Invocation 或 waiting-user 运行机器。

每个 segment 的可信来源只可能是：原始 Delivery、独立询问、受控询问结果续进、GUI/其它。询问等待只是 Delivery 上的未决关联，不占 session 运行锁。`pet_locus_reply` 仍只接受正文，由 Host 从本 segment 的唯一有效 origin 解析精确 Delivery；一般 parent/sibling 消息绝不自动升级为 continuation。

结果 outbox 续进需重验原 Delivery 尚未终结、requester 仍是同 locus/代际的当前 child、询问匹配、询问未取消且执行权限仍有效；时间经过本身不撤销续进资格。若不满足，保留诊断，不改绑到最近 Delivery，不创建新代工作。结果未知不恢复已失效回复权。

分离三个事实：执行 segment 已结束、请求仍有未决关联、正文发送结果。第一轮结束但有待答 inquiry 不显示 completed；无 pending/queued segment 时仍未发正文则标 `unanswered` 诊断，失败按失败呈现，发送状态未知按待核查呈现。完成表情不应冒充“已答复”；展示与表情映射须有回归测试。请求方决定已能回答并完成原请求时，未完成询问分支取消，迟到答复不再唤醒或追加飞书消息。中间“正在查询”消息不自动终结请求。完成判定不解析正文词汇：无未决询问时沿用 segment 终结加发送事实；仍有未决询问但请求方认为已可完成时，须通过 caller-bound 的显式工作完成控制动作关闭原请求并取消分支，不能从一次 `pet_locus_reply(text)` 猜测最终性。该内部控制动作不接受另一个 Delivery ID，也不代发正文；具体工具/API 名称在 G3/G5 后确定。询问结果续进必须继承原 trace 的累计预算与已访问路径，不能通过先等结果再重新发问无限重置根预算。

出站成功必须来自飞书响应事实，外呼成功但记录丢失的 crash 窗口必须保持 unknown。没有平台幂等证明不承诺外部 exactly-once，不重发未知出站，不重跑已派发但结果不明的执行。本 change 记录无回复事实并提供 owner 诊断；通用安全错误文字回执独立交给 B027，绝不复制 transcript 代答。

### D8. 恢复、停止与旧代升级

所有询问队列、答案与结果 outbox 持久化，接受后返回成功之前完成写入。写入与外部 inbox 的原子性不能假定；用阶段记录和宿主 messageId/claim 证据对账。仅证明未派发者可恢复派发，已派发未知置 needs-review；重启不根据停机时长自动终结仍有效的排队项。结果续进同样防重，不能用多次模型执行修复传输不确定。

待答 inquiry、排队/执行 segment 和待交付结果均纳入相关 locus 的 busy 判定，保护解绑、来源切换、scope 和模式重建。系统不以时间自动终结仍有效的询问；达到待处理数量上限时拒绝新询问，并提示实际 caller 显式取消旧分支。原有中断/取消操作须传播取消关联，取消仅记录持久状态和结构化原因码，不产生飞书出站或表情；明确由 owner 对未知结果作处置，不能通过重建绕过对账。意外归档/失效立即撤销后续授权，保留历史诊断。

模式标记建议为 `fork-prefix-v1` 与 `independent-v1`，缺证据为 unknown。已有统一 Locus 的 fork child 不自动转换；可经相同名单/询问门槛参与，能力不支持时保持原业务但标询问不可用。旧 QA/chat 绑定仍退休隔离，绝不因“保留旧模式”而恢复旧链。

空闲重建复用现有 provisioning/代际切换事务：同 parent、endpoint、defaultQa 角色；新 child/read/独立模式；旧代退休、原索引条件更新。重核工作锚点但不继承 write、不复制旧摘要。通知明确“新独立上下文，旧对话未合并”；发送前通知门禁沿用旧流程。失败保留原指针并补偿未发布资源。

## Risks / Trade-offs

- [问答次数与模型成本增加] → 只在缺信息时询问；名单不生成摘要；深度/数量/待处理预算明确，不强制每轮查问。
- [父忙导致上下文获取延迟] → 排队及等待时长可感知、可以问合适兄弟、可显式取消，不用自动期限误杀有效答复，也不把父设为必经中转。
- [同圈名称或回答泄漏跨群信息] → 最小名单、受众绑定、不自动公开名单；内容分享约束是模型语义边界，不能承诺绝对不泄漏。
- [高权限目标被当作代理] → 询问不提升请求方或目标权限，硬禁飞书代发、普通跨 agent 消息、再次委派及权限/绑定变更；目标其它操作仍受其正常业务权限约束，并以实测风险逐步收紧。
- [等待询问死锁] → 区分运行锁与在途业务；等待时释放运行槽，trace 防环加全局有界预算。
- [新旧上下文模式共存] → 明确 mode 与 capability，逐个显式重建，不声称旧历史已独立化。
- [多轮 Delivery 关联引入串发] → 独立 segment、caller-bound origin、重验代际、mixed 仍拒发；以交错与 crash 故障测试作为准入条件。
- [前置 change 未归档导致 spec 漂移] → tasks 首项核对依赖与完整替代标题；前置先归档，不倒序覆盖或自动清掉前置未完成项。

## Migration Plan

1. 实施开始先确认前置实现/规范基线；任何变动重新对齐本 delta。归档必须先发布前置 current specs。
2. 在隔离环境完成 G1–G5 和 failure matrix；新能力缺失时显式不可用，保持现有普通轮盘和旧 fork Locus 行为，不全局扩权。
3. 计划介质变更时先确认 descriptor 版本、唯一 writer 与允许的离线迁移范围。按现有 stop/dry-run/backup/explicit-confirm/start 流程，只增加公共事实/修订审计与询问状态/模式事实，不自动归并局部 projectResources/constraints，不修改旧 transcript，不把未知模式猜成独立。
4. 实际部署另按 apply 阶段确认目标 home/runtime，依 manifest 精确 pin 构建，连续第二次 sync 无变化；若需宿主 patch，沿用 compatibility provenance/原子发布/版本不匹配拒绝规则。
5. 新建入口以独立模式发布；已有入口显示原模式。所有者逐个空闲时显式重建并验证通知、defaultQa、权限、原历史保留。
6. 回滚先停新询问与飞书消费、处理或标记在途工作，保存新介质及会话日志，再恢复与旧程序配套备份。不得让旧程序读新询问介质并猜测兼容，不重放新版本已经消费的工作，不降维删除新代历史；无一致备份时停止并 forward-fix。

## Open Questions / 实施前能力门槛

产品决策已明确；以下是技术可失败核验，不是让实现者自行选择不同产品语义。

实施调查与基线证据见 `docs/notes/pet-independent-agent-capability-audit.md`：1.1 已核对，G1–G5 尚未通过。固定 runtime 的 spawn 空 seed 已有源码依据，但 cold composition 当前无条件重取父 live preset；独立模式须恢复 child 保存的 preset 选择（不额外要求锁住所有插件/Skill 文件字节）。G3 可复用 next-turn 加 Pet dispatcher/pre-step fail-closed，不能把 next-turn 当作排他 claim。G4 已有 scoped monotonic guard/execute 接缝，须验证异步 wrapper 后的最终效果边界。这些是原语义内的窄实现缺口，不以换 provider 或仅增加 prompt 规避。

| 门槛 | 核验内容 | 放行证据 | 不满足时 |
|---|---|---|---|
| G1 独立 child | spawn continuable 的 lineage、工具/Skill、模型、cwd/read、silent 通知、冷恢复 | 真实 runtime 首轮与冷恢复日志；父有独有历史哨兵而 child seed 不含；实际读写核验 | 不发布新独立 child，不退回 fork 冒称独立 |
| G2 scoped 协作上下文 | 父已加载新增首个 locus、child 首轮、原生加载；公共查询/成员列表同源鉴权、无 child 父的公共读取、失效调用 | 实际工具快照、无关会话不见、装配不唤醒父；父子读同一 revision，公共写入需 owner CAS | 报接缝缺口，不 global 注册或回退局部副本 |
| G3 非 steer 问答 | main/child/兄弟 busy 时排队、释放运行槽、跨轮 origin | 两个真实业务和询问交错，日志明确不同 segment、原目标回复无串线 | 需要窄 Host 队列接缝，不拿原生 steering 代替 |
| G4 权限与身份/通信边界 | 询问不提权；目标保留正常工具与既有权限；每次正文前重验；飞书回复、普通跨 agent 消息、再次委派、权限/绑定变更硬禁 | read 目标仍无法写；write 目标可做既有策略允许的操作；硬禁能力均被确定性拒绝；正常业务策略不变 | 不发布询问；不得用 prompt 冒充硬边界 |
| G5 持久结果与出站 | inbox claim/答案/续进/取消/外呼 crash 窗口 | 故障注入证明不重复执行/错发；时间经过不失效；不确定如实 needs-review/unknown | 不声称 exactly-once，不靠重跑掩盖 |

参数默认值、工具字段命名、具体 runtime seam 属可调整实现细节，变更须同步测试与设计；改变圈范围、自动分享/代执行权限、旧 child 升级策略或工作完成语义则必须回到所有者确认。
