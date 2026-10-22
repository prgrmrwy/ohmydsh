## Context

动机与范围见 [proposal](proposal.md)。这是跨 runtime、持久层、执行证明和管理投影的接线修复，必须有设计；不新增第二套通用协作框架。

### 已查证的基线（2026-10-14，本机 0.2.0-rc.2）

| 证据 | 结论与边界 |
| --- | --- |
| `src/host/inquiry/tools.ts` → `ask.ts` → `ledger-store.ts` | 接受工具等待 `inquiries` 事务后才返回 accepted；这证明代码契约，不等于直接查证了本次数据库行。 |
| `src/index.ts:609–631`、`host/collaboration/assembly.ts:155–163,234–277`；实际部署模块一致 | marker/probe 不可用；构造了 scheduler，但生产未将接受记录接到真实调度；答案 `put` 明确拒绝。 |
| 父 `session-c67ba88b-77c2-47a6-85a0-db295e742dcc`、子 `session-7c515792-de91-44ea-b15a-64ebbb283ea9` 的完整解压日志 | 子 22:13:48 与 22:18:54 两次 accepted（`inquiry-dsharaybdvo`、`inquiry-gysj0ji9q57`）；父 22:06:54 已结束原轮，此后无对应入箱/turn。child 实际没有原生 send_message。 |
| 本机 Host 日志与管理面装配 | Host 为 marker-absent；`createLocusManagementPort` 未传 ownerProjection，UI 有类型和分支但无真实询问快照。 |
| 历史 lumevm 只读成功对照 | 是 track/request_execution→父 followup→父直接回飞书，不是 inquiry 闭环；不能作为本 change 的成功 oracle。后续不修改该机器。 |
| focused 70/70 测试 | 测试包含“不可派发仍接受排队”，因此绿测试固化半通道，不代表端到端可用。 |

SQLite 在现役 Host 下独占锁；本次未绕过锁或读取当前两行。实施前必须用正式 owner 只读快照能力或获准停 Host 后一致介质确认，不能用 immutable 模式、文件复制或工具 accepted 猜当前状态。raw 日志只在临时取证目录，不提交仓库；长期只保留上述轻量可复核摘要和脱敏验收。

### 规范与依赖

- current `pet-locus-collaboration` 已约束独立 child、agent-message 不改回复归属、唯一 current、Delivery deadline 和 fail-closed；本 change 保持这些条文。
- `pet-compat-minimization` 要求精确官方已发布 API 正面举证、插件级优先和受管 provenance，不能因 marker 缺失直接决定加 patch。
- Accepted ADR-0006 保持 locus 在 Pet 内，自持单 writer domain，不提取新 package。
- active `pet-locus-independent-agent-inquiries` 已描述问答产品，但 `pet-agent-inquiries` 尚未是 current spec，tasks 也落后于部分已上线代码。本 change 新增窄 `pet-inquiry-runtime-channel`，实施中只做其 runtime 闭环和真实状态投影；原 change 仍负责公共事实、完整名单/兄弟产品与其归档。后续合并必须对齐交集、明确引用，不能两个 change 重复声明同一新 capability。
- `upgrade-dsh-0-2-0-runtime` 和 `pet-locus-interrupted-delivery-recovery` 共享 runtime/index/locus 文件。开始实现时重读它们，单一执行者串行编辑；回归 silent、idle、independent saved preset、exact child Session、单 writer 与 interrupted recovery。

## Goals / Non-Goals

**Goals:**
- 空闲、忙碌、未驻留 parent/child 均能完成真实父子双向问答；答案回到请求方原工作，不依赖父直接对外回复。
- 持久接受、入箱、claim、答复和结果续进有独立证据；真实 owner 能核对状态而不读取正文。
- 用有界队列与事件驱动 pump，不持锁等模型、不轮询模型；缺能力时诚实拒绝只是安全降级，不算恢复完成。

**Non-Goals:**
- 不改 track、request_execution、owner accept、原生 send_message 或三层 Locus 架构，不把询问转成待办。
- 不扩大圈范围、全局注册工具、引入新目录/外部服务/依赖或复制父历史。兄弟策略不重设计；共享实现改动须回归既有同圈校验。
- 不改变 Delivery 的 1h/24h deadline，不永久保活飞书请求，不增加自动降级模型、自动业务回复或人工审批询问。
- 不操作 lumevm/devbox，不因共享源码变化执行远端部署；当前 planning 不授权本机迁移/重启/真实出站。

## Decisions

### D1. 一条 Host 编排接通现有模块，持久数据为权威

现有 caller/ledger/scheduler/outbox/continuation/effect-fence 复用，新增最小生产 orchestration。调度器的内存状态只能是可重建投影，不能成为新真相源。接受事务完成后触发目标 pump，目标自然 turn-end/交互解除与 startup recovery 也触发 pump；每 session 单飞并按持久接受序选下一项。

执行 admission 只看真实运行槽（`occupiesRunSlot`）和原生交互等待，不能用 `hasWorkInFlight`/`busyForLocking` 阻止询问或结果轮。等待答案释放运行槽，但仍计入生命周期在途工作，继续禁止不安全的解绑/重建/权限切换。父子各有未完成原工作且相互询问时，只要运行槽已释放，两边均能回答；真实生产 pump 必须验证这一点，不只验证纯 scheduler。

```text
requester pet_inquire
  → atomic inquiry queued + 精确原工作绑定
  → target pump: 重验身份 / 可运行 / 隔离能力
  → durable dispatch intent（预留 messageId）
  → exact target 独立 next-turn → claim/turn 绑定 executing
  → pet_inquiry_answer → atomic answer + 状态 + result pending
  → requester pump → exact 原工作独立结果轮
  → claim 证据推进 result-delivered → requester 正常继续
```

不采用 `steer`、普通 send_message、同步工具等待或复用 todo dispatch：它们不能同时表达询问身份、非混合执行和答案回到原工作。`Agent.followup` 只证明普通任务能入队，不证明隔离 claim 与 segment 授权。

### D2. 独立轮次在 claim 前证明，能力是全链路 readiness

实施第一步审计精确 pin 的已发布 `.d.ts`/文档与实际 loaded agent/agent-loop/continuation 接缝。优先官方 opt-in 独立执行契约，其次可证明等价的插件级 admission。若两者无法保证 pending next-step 不被合批删除，才按最小 compat 增加真实隔离行为（不是仅 marker），同时记录替换包、源码范围、排除的 API、退役条件和新构建身份。

probe 只在与 Host 同一解析链构建的 throwaway inbox 上运行，验证 head inquiry 被 claim、外国 next-step 保持、普通 turn 未改变。目标询问和请求方结果轮都要使用可证明的隔离边界；默认用户轮行为不改。未通过 probe 或 effect guard 时，拒绝新的接受；名单不伪造 reachable，共享事实独立能力不被一刀切停用。

readiness 同时包括 queue consumer、持久答案/result 和 A 范围内的受管最终效果守卫。单独安装 marker 不放行。旧接受记录不因重新开启 readiness 直接全部进入 pump（D6）。

### D3. 持久答案与派发阶段在现有 domain 版本化

复用 `inquiries` 和 `inquiry_results`；增加最小 answer 记录及 dispatch/result handoff 所需关联。可把 answer 存在 inquiry 同行或新增专表，选择依据是能在同一 domain 事务提交答案、answered 与 result pending，并不破坏既有 parser/去重。选定物理形状前先写 schema 兼容与原子失败测试；任何 reader 形状变化都版本化，不能偷加字段绕过 parse。

派发前预留不可变 messageId，持久 intent 后再交接 inbox；claim 先于后置绑定的竞态靠预留 identity 解析，不靠事后宽豁免。target 真正 claim 后绑定 turn/segment，queued 不接受无请求的答案。答案重复只读首个已提交答案，不从 final 抓正文。目标轮结束无答案且无关联子工作时记录明确无答复失败，结果回到 requester；不无限 executing。

结果投递也预留并持久化 messageId/原工作 identity；delivered 意味着实际进入关联 segment，不是“调用 queue 返回成功”。独占 per-session orchestration 不替代 durable 去重；故障注入验证每个边界。

### D4. 用户确认的 A：受管入口守卫，不承诺任意代码效果隔离

2026-10-15 用户选择 A：target inquiry segment 保留目标原正常工具快照与权限上限，包括目标本来已有的 shell/Git/查询能力；答案仅由关联 `pet_inquiry_answer` 交回请求方。Host 对自己管理的飞书 reply/finish/wait、普通 agent 通信、再次委派、待办请求执行和权限/绑定变更入口执行确定性拒绝，不能让询问消费目标自己的 Delivery 或变成其它工作的执行请求。公共事实更新仍按独立成员资格/CAS 授权，嵌套 `pet_inquire` 按 D4a 的链预算授权。

guard 必须覆盖实际注册的受管工具与 alias，在异步 wrapper 完成后、受管正文/效果入口前重验 caller、generation、segment 关联；受管延迟效果再次检查片段是否仍有效，关闭后不留串轮权限。缺少此受管入口证明仍不发布 inquiry，不能只检查名称或写 prompt。实现前先枚举真实 Host 通信/委派入口，新增入口须纳入同一策略；不改变普通业务轮的权限。

A 的明确限制：不新增 OS、凭据、网络沙箱，不控制已获准 shell/脚本/通用 HTTP 内部的任意效果或已在运行的通用工具正文。此类路径仍受目标已有策略和模型行为约束；禁止借它们代答或扩散执行的指令必须注入，但不得宣称指令能硬性阻断这些路径。测试使用 fake ports/无真实凭据介质验证 shell 仍可用及受管入口被拒，绝不以一次“模型没有外发”证明强隔离。现有 Locus child safe composition 和它的强出站约束不因此放宽，也不向 child 新增 shell；A 主要明确高权限 parent 的剩余风险。

与旧 inquiry active change 的全外发硬底线存在语义差异：本次 A 是当前用户对本机 parent inquiry 的显式取舍。它不满足旧 change 的完整 G4，不能据此勾完旧任务；归档/发布前对齐重叠条文的适用范围与验收，不静默覆盖 current child 的约束。

### D4a. 一份 Host 派生的关联上下文，复用已有标识

- 协作范围使用原 `circleParentSessionId`，child 成员带 `locusId/generation/sessionId`；locusId 便于检索，但不唯一标识某次工作，父本地请求不捏造 locus。
- 原工作引用为 `DeliveryId` 或 `local workId`。本地 workId 复用持久 session 的请求/消息身份，随 session 命名空间唯一；若现有身份不能表达生命周期，仅在现有 domain 增加最小 work anchor，不建通用 tracing 服务。
- `inquiryId` 标识问答分支；既有 `rootInquiryId/depth/visited` 标识询问链。派发与结果预留 messageId，实际 claim 后记录 turn/segment，它们是执行证据，不是原工作身份。

本地 work anchor 在实际本地请求 claim 时由 Host 建立（或复用已证明的持久根），`pet_inquire` 接受事务绑定该根并登记开放分支。原 turn 结束但仍有分支时，work 保持 waiting；每个已到达结果均可独立触发关联结果轮，不等所有分支。继续轮结束且无开放关联时 settled；全部结果仅保留/拒绝、没有可运行续进时原子结束对应 waiting anchor。显式 cancel/finish 同样 settled；新 GUI 请求创建新根，不把 A 重绑到 B。跨重启读取同一根及分支证据，证据缺失为 unknown，不默认最新请求。旧请求仅在能由持久消息/turn 唯一证明时回填，否则不接受新询问。

nested inquiry 来源必须先解析当前 Host inquiry/result segment，继承原工作、用途受众、parent inquiry 和 visited/budget；目标答复中的再询问从该目标所在链继承，结果续进中的再询问不另起 root。只有确实新的本地/Delivery 工作才可新建询问根；A→B→A 拒绝，多个分支遵守现有根累计/深度/每 session 预算。不在各入口独立运行 local fallback 推断。

接受、dispatch intent、claim、answer、result、受管效果检查和脱敏诊断传递同一关联引用。身份、回复目标与真相由持久原记录解析，不在每张表复制 chat/凭据；模型不选择 work/locus/reply target。result claim 时重验原工作、当前成员与唯一有效 Delivery，作为 `inquiry-result` token 进入现有 finish/wait 路径；一般 agent-message/GUI source 不升级为该 token。

### D4b. 原请求有效期与结果终结同事务收敛

保留 current FIFO/deadline。询问本身不设超时删除，但等待不改变 Delivery 有效期：原 Delivery expired 后答案仍可持久诊断，不再获得回复/业务执行权。每个分支精确关联，不能合批把 A 答案用在 B。

结果永久 `retained/refused` 时，同一 domain 事务保存 outbox 处置及 inquiry 终结：尚为 queued/executing/answered 且原工作已终态、代际失效或权限明确撤销者，复用 `cancel` 到 cancelled；证据不足的 executing/answered 用 `needs-review`，queued 可用 unavailable 加稳定未知原因，不猜已执行。原本已终态的 inquiry 保留该终态。答案、失败和诊断证据保留，不伪造 result-delivered；各终态不再计 pending budget，不留本分支的 busy 关联，但独立未知业务副作用仍遵守已有 unknown-terminal，不能因为本分支关闭就宣称整个工作完成或可安全重建。

成功 result claim 的 outbox delivered 与 inquiry deliver-result 同样原子/幂等，失败结果对应的 inquiry 已终态则保留。取消/业务 finish 同步关闭相关分支及待投结果，不删除正文证据、不新增 Delivery/表情/外发。内存 scheduler/生命周期关联只从已提交记录重建或释放；事务失败不先释放，重复处置不再次推进。

### D5. 询问 owner 快照独立于待办

通过现有 `ownerProjection` 向 Locus 管理视图提供 inquiryId、phase、createdAt、诊断和 Host dispatch readiness；按真实父/child 关联选择，不公开正文或兄弟聊天。未知/读取失败和零条记录不同。复用现有 settings/wire，不建新工作台，也不向 shared_fact_ledger/ledger_item 自动登记询问。

### D6. 旧问题明确处置，新协议可证明恢复

历史两条只作为核对线索，不能凭 accepted 宣称已落库或未执行。上线区分旧记录/新可证明交接协议，通过版本化标识或原有无 handoff-proof 字段事实将旧记录置为 owner disposition required；保留原 status/正文和关联证据，不猜 execution。正式首次启动先停止这些旧项自动 pump。

获准只读对账后，为 owner 列出存在性、阶段、会话消息/turn、当前身份、原请求有效性和最小处置选项。明确许可后，可恢复仍有效且可证明从未派发的那一条、取消重复分支或保留待核查；过期请求不得重新获得飞书回复权。本次两个相似问题不自动按正文去重或选择哪一个执行。

新协议 restart 规则：
- 可证明未入 inbox 的有效 intent：恢复一次交接；
- 已在目标/请求方 inbox：等待原消息，不重复入箱；
- 已 claim：按精确 turn/答案/result 证据收敛，不再跑同一工作；
- 交接可能发生但证明不足：needs-review，不靠重跑修传输。

不承诺外部 exactly-once，保留既有 unknown-terminal。旧程序不得读新介质后猜兼容；缺一致备份时 forward-fix。

## Risks / Trade-offs

- [高权限父 shell 具有直接外发路径] → 用户 A 接受这类 ambient effects 不受本 inquiry 守卫控制；保留既有策略和明确模型约束，不声称全外发隔离。受管入口守卫仍是发布 gate，child safe composition 不放宽。
- [claim 删除与异步时序吞输入] → 先核验真实 runtime opt-in 和行为探针，覆盖 next-step 与 next-turn 交错，不以 post-claim refusal 冒充安全。
- [domain 与 session inbox 非原子] → 持久预留 identity、阶段对账及 needs-review，明确不能覆盖未知执行为成功。
- [原 Delivery 等待期间到期] → deadline 语义不改，迟到结果只诊断；验收使用新测试请求，不强行恢复历史过期回复权。
- [只隐藏询问被误称修复完成] → done 必须有真实父子答案回送，缺能力拒绝仅为降级保护。
- [相邻 change 规范与 tasks 漂移] → 实施前明确交集/责任和归档顺序，保留其它 change 未完成项，不以本项证明整套 inquiry 产品完成。
- [重启影响正在运行的本会话/入口] → 部署另行确认并检查运行中工作，避免从调用方进程中无告知重启；原机器之外无变更。

## Migration Plan

1. 在源码及临时测试介质完成红灯→接线→回归；正式 Host/home 不变。
2. 输出本机运行时身份、schema 版本、旧询问对账及部署/回滚清单；由用户确认停机、备份、迁移、重启与测试副作用边界。
3. 停本机 writer 后一致备份 Pet 状态和相关会话；版本化迁移，旧记录保留待处置；从仓库 `dsh build` 物化，连续第二次无变化。不手改部署副本。
4. 重启本机原 Host，验证原 3080 GUI 刷新后真实能力和 owner 状态，不起替代 server；先使用新父子本地询问完成闭环，再在独立获准飞书入口验证续进和无串发。
5. 按 owner 选定方案处置旧两条 inquiry；未经确认不自动执行它们。
6. 回滚先停新接收与 writer，保留新介质/日志；只有一致的代码/介质备份可配套回退。若已有新答案/外部结果，不能倒回备份重放；优先 forward-fix 并记录待核查。

## Acceptance oracle

- AC1：真实父子执行（不是替身）中子问题进入父 inquiry turn，父显式答案持久存在，子 exact result turn 收到同一 inquiryId；正向与反向各一例。
- AC2：忙碌父+pending GUI 输入场景，原任务不被 interrupt，GUI 输入不丢，询问与结果单独 claim；父子互等时生产 pump 能推进，生命周期仍报告在途。
- AC3：原 Delivery A 结果有效时只回 A；A 终态/过期或换代后答案不回 B、不通过本协议出站。GUI-origin 无受管飞书回复能力；本地 A 等答案期间 B 开始，结果仍绑定 A。永久拒绝结果原子终结分支、释放额度，事务失败不提前释放。
- AC4：接受/入箱/claim/答案/outbox/续进各边界 crash，证明未交接者恢复、已排队不重复、未知可诊断不重跑。
- AC5：owner 状态与实际持久/session 证据一致；询问不出现在待办表，现行 track/request_execution/owner accept 回归无行为变化。
- AC6：必要能力缺失时无新 accepted；正常能力恢复后确有双向闭环，不能以“拒绝不会卡死”代替交付。
- AC7：A 边界下父原 shell/查询仍可用，实际受管通信/委派/待办执行/授权入口及异步 wrapper 在询问片段中被拒；普通业务轮不变。不以此证明 shell 内部效果隔离，不使用真实飞书出站测试该限制。
- AC8：实际注册工具驱动的 A→B→A 被拒，target/result 中再询问继承同一原工作与根预算；全阶段关联可核对，只有 locus 相同或伪造模型 workId 不能获取回复权。
