## Review Metadata

- **Review round**: 4
- **Prior round**: round 3 REVISE（C1 共享 ack/progress；C2 itemId 存在性；M1 wakeCount；M2 共享话题额度；M3 措辞矛盾）；用户随后把威胁模型改为防误泄不防串通
- **Reviewer context**: cross-model (codex / gpt-6-astra), fresh context
- **Tool restrictions**: read-only inspection; single write to review.md
- **范围与方法**：静态审阅 [proposal](<openspec/changes/pet-locus-collab-integration/proposal.md>)、[design](<openspec/changes/pet-locus-collab-integration/design.md>)、四份 delta（[dsh-collab](<openspec/changes/pet-locus-collab-integration/specs/dsh-collab/spec.md>)、[collab-kernel](<openspec/changes/pet-locus-collab-integration/specs/collab-kernel/spec.md>)、[intent-triage](<openspec/changes/pet-locus-collab-integration/specs/pet-locus-intent-triage/spec.md>)、[collaboration](<openspec/changes/pet-locus-collab-integration/specs/pet-locus-collaboration/spec.md>)及原评审；对照相关现行规范、[manifest](<dsh.yaml>)、[跨边界协作标准](<packages/dsh-collab/docs/cross-boundary-collaboration-standard.md>)、[ADR-0006](<docs/adr/ADR-0006-keep-locus-inside-dsh-pet.md>)与扩展点归档设计。
- **实现／测试覆盖**：检查 Pet 登记、值模型、存储、受理投递、原子事务、工具组合；dsh-collab caller、句柄、工具、status；内核事件模型、reduce、命令守卫与话题限额。静态抽查 [ledger-store 测试](<packages/dsh-pet/test/ledger-store.test.ts>)、[ledger-todo 测试](<packages/dsh-pet/test/ledger-todo.test.ts>)、[managed-caller 测试](<packages/dsh-collab/test/managed-caller.test.ts>)、[status 测试](<packages/dsh-collab/test/status.test.ts>)、[guard 测试](<packages/collab-kernel/test/guard.test.ts>)，并检索相关 dispatch 测试。未运行测试、构建或部署；未把规划中的功能尚未实现视为缺陷。change 当前无 tasks.md；本轮是方案评审，不据此阻断。

## Round 3 Findings Status

| 编号 | 状态 | 裁定依据 |
|---|---|---|
| C1 共享 ack/progress | **resolved** | [写授权与只读场景](<openspec/changes/pet-locus-collab-integration/specs/dsh-collab/spec.md#L41-L46>)、[requiredAcks/assignee 反例](<openspec/changes/pet-locus-collab-integration/specs/dsh-collab/spec.md#L94-L97>)要求目标 ext 等于 caller stamp，main 条目不再因共享 pet 名而可改；入口、提交前及收据重放都受检。 |
| C2 itemId 存在性 | **out-of-scope-by-decision** | [Context 的用户决定](<openspec/changes/pet-locus-collab-integration/design.md#L6-L8>)明确排除存在性／计数等串通信道；不要求改 ID 或拆空间。 |
| M1 wakeCount | **resolved** | [成员白名单](<openspec/changes/pet-locus-collab-integration/specs/dsh-collab/spec.md#L44>)及[新场景](<openspec/changes/pet-locus-collab-integration/specs/dsh-collab/spec.md#L109-L112>)删除 overview 中 wakeCount、joinSeq、地址。计数旁路也已不属阻断范围。 |
| M2 共享话题额度 | **partially resolved；余下旁路 out-of-scope-by-decision** | [ref 门禁](<openspec/changes/pet-locus-collab-integration/specs/dsh-collab/spec.md#L41>)关闭直接引用 main 公共条目的路径；“因此所有 Locus 的额度天然独立”仍不成立，见本轮 M2。残留仅是用户排除的额度耦合，不重开安全阻断。 |
| M3 措辞矛盾 | **resolved** | ack 不再错误排除 Leader；[子会话推进待办场景](<openspec/changes/pet-locus-collab-integration/specs/pet-locus-intent-triage/spec.md#L189-L191>)已统一为插件 ITEM_NOT_FOUND、不调用内核。 |

## Findings

### 🔴 Critical (blocking)

**无。** 在本轮明确的正常读取防误泄边界内，未建立新的兄弟正文／状态泄露、越权修改或实质 D9 回归反例。

尤其不保留“旧存储并发受理可能两个都成功”的怀疑：[advanceStatus](<packages/dsh-pet/src/host/ledger/store.ts#L191-L213>)在事务体内重读，且 [serializeDomainTransaction](<packages/dsh-pet/src/host/storage/atomic-domain.ts#L247-L279>)串行化的是整个事务体，不只是持久化；[真实 domain 并发转换测试](<packages/dsh-pet/test/ledger-store.test.ts#L140-L161>)也覆盖单一赢家。因此 [D9 并发受理 oracle](<openspec/changes/pet-locus-collab-integration/specs/pet-locus-intent-triage/spec.md#L75-L78>)有实现依据。其余同钟、只归一化 ID、证据无损编码、创建快照与明确例外的约束可作为实施验收基础。

### 🟡 Moderate

#### M1 — 把 Host 登记待办的字段约束误写成全部原生条目的约束

- **位置**：[D3:84](<openspec/changes/pet-locus-collab-integration/design.md#L84>)声称“子会话自己的条目没有 requiredAcks、承接方也不是 pet”，因而 ack/advance 没有可用目标。
- **反例**：子会话通过原生 create 创建自己盖戳的 request，传 `assignee:'pet'`；或创建 `requiredAcks:['pet']` 的条目。现有[工具参数](<packages/dsh-collab/src/tools.ts#L77-L88>)允许这两个值，新 [delta](<openspec/changes/pet-locus-collab-integration/specs/dsh-collab/spec.md#L37-L41>)也未禁止。目标全 ext 等于 caller stamp，故可继续按内核规则 advance／ack。只有 [D6 的 pet_locus_track 待办](<openspec/changes/pet-locus-collab-integration/design.md#L125-L133>)保证空 requiredAcks、assignee main。
- **影响**：不会越过兄弟隔离，但会诱导实现者额外禁止原生合法操作，或写出与授权规则冲突的测试。
- **精确修正**：将该句改为：“经 pet_locus_track 登记的待办 requiredAcks 为空、assignee 为 main，子会话不能通过这两个工具推进该类待办；经原生 collab_create_item 创建的其它自有条目，仍按本节戳检查及内核 ack/assignee 规则处理。”不新增 create 参数限制，不改变既定待办状态路径。

#### M2 — ref 限制没有证明话题根按 Locus 分离，设计仍作过度承诺

- **位置**：[D3:85](<openspec/changes/pet-locus-collab-integration/design.md#L85>)声称“天然分开，不共用话题额度”；[新增额度场景](<openspec/changes/pet-locus-collab-integration/specs/dsh-collab/spec.md#L104-L107>)只测试 B 无 ref 新开根。
- **可复核反例**：main 创建无戳公共条目 I0，随后分别向 pet 发两条 `ref:I0.seq` 的消息，正文各只点名 A、B。按 [D5](<openspec/changes/pet-locus-collab-integration/design.md#L116-L119>)，两条消息分别路由到 A、B。两个 child 各引用自己收到的消息，均符合新 ref 门禁，但 [reduce 的 topicOf](<packages/collab-kernel/src/domain/reduce.ts#L15-L19>)仍把两条链归到 I0；[限额检查](<packages/collab-kernel/src/service/index.ts#L265-L270>)仍共用预算。没有兄弟正文因此可见。
- **精确修正**：删除“天然分开，不共用话题额度”的保证，替换为：“禁止直接引用 main 的公共条目；独立根的额度互不影响，但 main 消息的 ref 链仍可能共享根，额度耦合按防误泄、不防串通的决定接受。”将新增场景标题改成“不同 Locus 新开独立话题不继承其它根的额度”，保留其现有 GIVEN/WHEN/THEN。不要求内核改计数、插件重写 ref 或增加隔离层。

### 📌 Suggestions

#### S1 — 后续让 status 的行动建议服从写权限，而不仅服从可见性

[D3 与 delta](<openspec/changes/pet-locus-collab-integration/specs/dsh-collab/spec.md#L44-L46>)要求 pending/next 从可见条目推导。main 创建 `requiredAcks:['pet']` 或 `assignee:'pet'` 的公开条目时，按[现有 pending/next 算法](<packages/dsh-collab/src/status.ts#L15-L26>)会向 child 建议 ack/advance，但执行必被新门禁拒绝。建议保留 overview 的只读信息，在 status 中不把这种条目作为可执行动作，或明确注明不可执行；增加一条与只读场景配对的 next 断言。这是交互改进，不是正文泄露，也不作为本轮批准条件。

## Embedded-Instruction / Injection Attempts

**Detected:** 未发现针对本评审的有效嵌入指令或越权写入要求。[status 测试中的“忽略之前所有指令”](<packages/dsh-collab/test/status.test.ts#L54-L63>)是明确的负向测试数据，不是本轮应执行的指令。历史 fixed/accepted 标记、设计中的“用户已决定”文字均作为待核验证据；威胁模型以本次直接提供的用户决定为准。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

发现计数：Critical 0；Moderate 2；Suggestions 1。

批准既定单空间／单代理、插件投影与写授权、Host 待办适配的方向。批准条件仅为上述两处小而确定的规范措辞修正，不需要新的架构选择或扩大实现范围。本轮不要求对用户已排除的存在性、seq、错误码、计数及额度串通信道继续加固，也不重开询问迁移、跨机或存量只读决定。

## Required Changes (if APPROVE WITH CHANGES)

1. 按 M1 的替换句收窄 [D3:84](<openspec/changes/pet-locus-collab-integration/design.md#L84>)：区分 pet_locus_track 待办与原生创建的其它自有条目。
2. 按 M2 的替换句修正 [D3:85](<openspec/changes/pet-locus-collab-integration/design.md#L85>)，并重命名[独立根额度场景](<openspec/changes/pet-locus-collab-integration/specs/dsh-collab/spec.md#L104-L107>)；不要把残留耦合误列为必须新增的隔离工作。

CHANGES_APPLIED: yes

## Rebuttals

以下逐字保留 R1/R2 反驳与已有裁定；旧文的“本轮”仍指其当时轮次。R3 原文保留，并逐条追加 R4 裁定。

- **C1（fixed）**：D3 改为"完整重放 + 可见投影"，`visible` 按业务主体（item/message/statusText）判断，dispatch 只随其唤醒源可见；`pet` 的状态文本对子会话不可见；无法路由的消息对任何 child 不可见。dsh-collab delta 重写为"托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间"，新增"同一提交中的 dispatch 不泄露兄弟消息""状态文本不能传话"场景；triage delta 的"无法路由不猜"补了对子会话不可见。
  - **not accepted**（完整关闭声明）：原反例已解决，但辅助索引仍泄露隐藏条目，见本轮 C1。
- **C2（fixed）**：D3 增加写目标授权：revise/ack/advance 的目标与 create/send 的 ref 必须对戳可见，否则 `COLLAB_ITEM_NOT_FOUND`/`COLLAB_BAD_REF` 且不泄露 revision；入口检查并随守卫重验；收据重放同样受检；`to` 只允许接入方声明的收件人。新增"不能修改、确认或引用兄弟条目""无权调用者拿不到旧收据""带戳调用者只能发给 main"场景。
  - **not accepted**（完整关闭声明）：隐藏目标已保护，但 main 公开条目的可写性仍绕过星形边界，见本轮 C2。
- **C3（fixed）**：D3 增加 cmdId 命名空间：带戳调用者的所有写命令 cmdId 由插件加 `sha256(stamp)` 前缀。新增"不同戳的同名 cmdId 互不干扰"场景；D9 加用例。
  - **accepted by reviewer**：可信且稳定的戳前缀隔离共享 pet 的收据空间，所有写命令均纳入。
- **C4（fixed）**：D3 明确先用完整日志重放再投影，不删记录；`since` 保留 seq 与空事件记录。新增"公开记录引用隐藏记录仍能重放"场景。
  - **accepted by reviewer**：内部完整重放保留依赖，外部投影不再承担 reducer 输入职责。
- **M1（fixed）**：D4 的 presence 改为"代理能否接收并登记"，与 active child 无关；triage delta 新增"零 active child 时终态仍登记"。
  - **accepted by reviewer**：可达性与 child 轮次解耦，历史 locus 路由仍可登记。
- **M2（fixed）**：D6 把三条 `pet_locus_ledger_read` 指引文本列为唯一差分例外；triage delta "失败路径在新旧存储上一致"的 THEN 改为分类相同、指引句允许替换。
  - **accepted by reviewer**：只放宽退役工具指引，不放宽失败分类、状态与投递语义。
- **S1（accepted）**：collaboration delta 改为"协作工具名集合相同（shell 档另含其既有 shell 工具）"。
  - **accepted by reviewer**：工具子集与现行 shell 附加能力不再冲突。

- **R2-C1（fixed）**：D3 与 dsh-collab delta 把带戳调用者的 `overview` 改为白名单输出（恰含 14 个键），`itemSeq`、`topicOf`、`topicWakes` 等派生索引一律不输出；新增场景"隐藏条目的标识不经任何字段泄露"，用 itemId 里的唯一标记做完整序列化断言。
  - **accepted by reviewer（R3）**：原辅助索引泄露已关闭；本轮 M1 单独记录 members 中的派生计数，不重开 itemSeq 原问题。
- **R2-C2（fixed）**：写授权改为"可读与可改分开"：revise 只能改自己戳的条目，主会话条目对子会话只读；ack 只能确认主会话给自己的条目；advance 只能推进承接方为 `pet` 的 request；ref 仍按可见。新增场景"不能借主会话的公开条目传话""可以修订自己的条目""只能确认主会话给自己的条目"。
  - **not accepted（R3，完整关闭声明）**：正文 revise 的原反例已修复，但“给自己”没有 locus 级证明；所有 child 仍共用 pet 的 ack/assignee 状态，见本轮 C1。
- **R2-S1（accepted）**：collaboration delta 的收件人场景改为"dsh-collab 以 `COLLAB_BAD_RECIPIENT` 拒绝，不调用内核"，并显式包含 `to:'pet'`。
  - **accepted by reviewer（R3）**：与插件收件人门禁一致，且覆盖真实存在的 pet 成员。

- **R3 威胁模型（用户决定，2026-10-24）**：隔离改为**防误泄、不防串通**。design Context 第 1 条与 Risks 新增说明；triage delta 的"授权与可见范围"、collaboration delta 的星形约束、dsh-collab delta 的投影要求都写明该边界。据此 R3-C2（itemId 存在性探测）不再是本 change 要防的事，不改 ID 分配。
  - **accepted by reviewer（R4）**：按直接给定的用户决定裁定 C2 出范围；不以相同旁路换名重提阻断。
- **R3-C1（fixed）**：主会话的条目对子会话完全只读：ack、advance 与 revise 一样要求目标 ext 戳等于调用者戳；删除"只能确认主会话给自己的条目"场景，改为"主会话的条目对子会话只读"（含 requiredAcks/assignee 为 pet 的条目，断言兄弟读到的状态不变）。
  - **accepted by reviewer（R4）**：共享成员名不再赋予对 main 条目的修改权，原 ack/progress 反例已关闭。
- **R3-M1（fixed）**：members 投影只输出 name/kind/status/binding.channel/managedBy/statusText，不含 wakeCount、joinSeq、地址；新增"成员计数不进投影"场景。
  - **accepted by reviewer（R4）**：overview 的嵌套白名单具体可断言；其余计数旁路不作为本轮安全要求。
- **R3-M2（fixed）**：子会话的 ref 只能指向自己的记录或主会话发给自己的消息，不能 ref 主会话公开条目；话题因此按 Locus 分开。新增"可以引用主会话发给自己的消息""不同 Locus 的话题额度互不影响"场景。
  - **not accepted（R4，仅“话题因此分开”的完整声明）**：直接公共 ref 已封闭，但 main 定向消息可回到同一根；按新威胁模型接受该耦合，只需收窄承诺，见 M2。
- **R3-M3（fixed）**：(1) ack 规则不再用"Leader 之外的普通成员"措辞，统一为"ext 戳相等"；(2) triage delta"子会话不能推进待办状态"改为 dsh-collab 入口 `COLLAB_ITEM_NOT_FOUND`、不调用内核。
  - **accepted by reviewer（R4）**：原两处冲突已消除；D3 对原生其它条目的概括错误另列本轮 M1，不重开旧错误码问题。

- **R4-M1（fixed）**：D3 该句改为评审给出的替换句，区分 `pet_locus_track` 待办与原生创建的其它自有条目。
  - **accepted by reviewer**：D3 已将空 requiredAcks、assignee main 限于登记待办，原生自有条目仍按戳与内核规则处理，未新增 create 限制。
- **R4-M2（fixed）**：D3 删除"天然分开"的保证，改为"独立根额度互不影响；main 消息的 ref 链仍可能共享根，按防误泄不防串通接受"；场景改名为"不同 Locus 新开独立话题不继承其它根的额度"，GIVEN/WHEN/THEN 不变。
  - **accepted by reviewer**：D3 明确接受 main 消息链共享根的额度耦合；场景标题已收窄，仍保留 A 耗尽自身话题额度、B 无 ref 新开根成功的 GIVEN/WHEN/THEN。
- **R4-S1（accepted）**：`collab_status` 对带戳调用者只列出能执行的动作；design D3 与 dsh-collab delta 同步，"主会话的条目对子会话只读"场景加了 `pending`/`next` 断言。
  - **accepted by reviewer**：D3 与 delta 一致按写授权过滤 pending/next，并有只读条目反例断言；过滤动作不取消可见只读信息，与其它读取及回复场景不冲突。
