## Review Metadata
- **Review round**: 2
- **Prior round**: Round 1 — REVISE（C1 在途调用失权，M1–M4，S1）
- **Reviewer context**: cross-model (codex gpt-6-astra, fresh context)
- **Tool restrictions**: read-only except review.md
- **Artifacts reviewed**: 本轮重新审阅 proposal（`openspec/changes/collab-locus-extension-points/proposal.md`）、design（`openspec/changes/collab-locus-extension-points/design.md`）、kernel delta（`openspec/changes/collab-locus-extension-points/specs/collab-kernel/spec.md`）、plugin delta（`openspec/changes/collab-locus-extension-points/specs/dsh-collab/spec.md`），并对照 round-1 报告与 rebuttals（`openspec/changes/collab-locus-extension-points/review-round1.md`）。目录中尚无 tasks 工件，本轮不把实施前的任务缺席列为缺陷。
- **Supporting evidence**: 对照当前 kernel spec（`openspec/specs/collab-kernel/spec.md`）、plugin spec（`openspec/specs/dsh-collab/spec.md`） 的相关要求、inquiry spec（`openspec/specs/pet-inquiry-runtime-channel/spec.md#L8-L90`）、协作标准（`packages/dsh-collab/docs/cross-boundary-collaboration-standard.md`）、ADR-0006（`docs/adr/ADR-0006-keep-locus-inside-dsh-pet.md`）、manifest（`dsh.yaml#L95-L110`），以及 origin/ws/collab-pet-locus-collab 调研纪要第 6 节。实现交叉核对包括 kernel service（`packages/collab-kernel/src/service/index.ts`）、SessionAccess（`packages/dsh-collab/src/session-provider.ts`）、status（`packages/dsh-collab/src/status.ts`）、Pet caller（`packages/dsh-pet/src/host/collaboration/caller.ts#L135-L170`）。
- **Validation**: 静态、对抗性计划审查；未运行测试、构建、安装或部署，不声称真实 Host 验收通过。只覆盖本报告；未改 proposal/design/specs 或其他文件。最终开放计数：**1 Critical / 1 Moderate / 0 Suggestions**。

## Round-1 Findings Status

| 原编号 | 本轮状态 | 对 rebuttal 的判定 |
|---|---|---|
| C1 | **partially resolved（部分解决，仍阻断）** | 不接受“已全部修复”：同步 `holds` 已封住“地址变为不持有”的简单竞态，但没有将入口实际 Agent 和 attach 代际带到最终边界；见下方 C1。 |
| M1 | **resolved（已解决）** | **accepted by reviewer** — manager 事务内明确重做收据、授权、closed、目标状态及唯一性判定，并覆盖 revoke、markGone、同 cmdId、地址抢占及零 claim 重放。 |
| M2 | **resolved（已解决）** | **accepted by reviewer** — manager 授权先于 closed，无权错误由插件统一映射；六类空间的响应要求序列化后完全相同。 |
| M3 | **resolved（已解决）** | **accepted by reviewer** — 主调用者 requirement 已引用统一解析，allowlist 明确只约束普通会话，新增托管正向及普通负向场景。 |
| M4 | **resolved（已解决）** | **accepted by reviewer** — Q6 不再承诺成员 outbox 后台自主恢复，区分 manager 重放与真实有效会话重试，失效身份交人工处置，并列出三处崩溃验收。 |
| S1 | **resolved（已解决）** | **accepted by reviewer** — 设计已准确区分 Pet 内部同步快照与公开异步解析，明确未来接入须提供已核验内存投影，不要求本 change 修改 Pet。 |

判定依据分别为 manager 两阶段（`openspec/changes/collab-locus-extension-points/specs/collab-kernel/spec.md#L35-L47`）、manager 并发场景（`openspec/changes/collab-locus-extension-points/specs/collab-kernel/spec.md#L408-L429`）、六类错误等价（`openspec/changes/collab-locus-extension-points/specs/dsh-collab/spec.md#L239-L242`）、统一调用身份（`openspec/changes/collab-locus-extension-points/specs/dsh-collab/spec.md#L3-L38`）、恢复协议（`openspec/changes/collab-locus-extension-points/design.md#L136-L139`） 和 异步解析说明（`openspec/changes/collab-locus-extension-points/design.md#L96-L102`）。接受这些修复不代表其相邻交互已自动通过。

## Findings

### 🔴 Critical (blocking)

#### C1 — 地址仍有效，不代表发起在途调用的执行会话仍有效

- **位置**：插件调用者与 holds 规则:250–267（`openspec/changes/collab-locus-extension-points/specs/dsh-collab/spec.md#L250-L267`）、attach/dispose:201–207（`openspec/changes/collab-locus-extension-points/specs/dsh-collab/spec.md#L201-L207`）、内核最终检查:441–454（`openspec/changes/collab-locus-extension-points/specs/collab-kernel/spec.md#L441-L454`）。
- **问题**：入口校验的是 `exec.agent` 的真实对象、Host 当前对象、归档状态及唯一 adapter 解析；最终检查却只剩 `holds(address)`，且中继明确调用**当前** adapter。该布尔值证明“地址仍存在”，不能证明“当初的 Agent 仍能代表它”，也不证明当前 attach 就是接受请求的那个 attach。两种证明不能替换。现有验收仅人为把 holds 设为假，未覆盖 holds 为真但入口身份已失效的情况。
- **具体反例**：
  1. Agent 对象 A 解析为 `pet-locus/loc:1`，发送命令停在 presence。Host 将同 session 的当前 Agent 对象替换为 A′，绑定仍有效。`holds('loc:1')` 理应为真，而旧 A 已不满足入口的“Host 当前对象”条件。释放采样后，按现有规范实现的最终检查仍允许旧调用提交；读取、收据也有同类窗口。
  2. A 的请求挂起，原句柄 dispose，随后同 channel 重新 attach；新 adapter 仍承认 `loc:1`。中继转交新 adapter 的 true，让旧 attach 发起的工作通过。它不需要台账复用历史地址，只需在同一当前绑定上发生 detach/re-attach，因此地址永不复用规则不能防住该 ABA。
- **影响**：失效执行对象或已撤销接入代际的在途工作仍可取得成员权限，违背本轮明确承诺的立即失权。这是 round-1 C1 尚未封闭的安全边界，不是要求可信 adapter 防恶意插件。
- **具体修复**：保留地址级 `holds`，另定义宿主创建、调用方不可伪造的**每次操作有效性 guard**：捕获入口执行 Agent 对象、attach epoch、解析出的 channel/address；在内核最终写 admission、读数据与收据返回边界同步重验完整入口条件及唯一解析结果，并要求 attach epoch 相同。校验与相应动作之间不得再有未保护 await；不能仅在插件 await 内核之后检查，因为写入已经发生。明确内核如何接收此 guard（可信调用上下文/不可伪造令牌等），而非让内核导入 Host。manager 句柄的在途操作同样须在最终 admission 验证其 attach epoch。`collab_status` 使用同一完整 guard，不能只比较地址字符串。
- **所需验收**：入口通过后分别挂起 presence/队列/读取；期间替换 Host Agent、归档执行会话、dispose 后重新 attach 同 channel 同地址；恢复后旧调用不得产生提交/收据/投递或返回空间数据，旧句柄按其 detached 契约拒绝。新有效 Agent/新句柄的独立新调用仍可成功。以真实执行对象身份和 attach epoch 为断言，不能只让测试替身返回 holds=false。

### 🟡 Moderate

#### M5 — rebind 保留成员名，但旧地址的 presence 样本会被用于新地址

- **位置**：rebind 规则:349–352（`openspec/changes/collab-locus-extension-points/specs/collab-kernel/spec.md#L349-L352`）；未被本 delta 替换的 选择绑定与在线状态:591–603（`openspec/specs/collab-kernel/spec.md#L591-L603`）；mode 不改变 presence 与计数:560–570（`openspec/changes/collab-locus-extension-points/specs/collab-kernel/spec.md#L560-L570`）。
- **问题**：基线要求事务前只采样一次，原来绑定不可换，按成员名保存样本可成立；现在绑定可在预备与事务之间被 rebind，而规范没有规定如何检测、处置这种失配。仅重读当前成员与收件人 provider 并不让旧样本自动成为新地址的在线状态。当前实现确实 按 member.name 保存 presence（`packages/collab-kernel/src/service/index.ts#L116-L125`），再在 串行事务中把它交给当前状态的 dispatch 决策（`packages/collab-kernel/src/service/index.ts#L167-L188`）；设计没有要求改变这个关联键。
- **具体反例**：A 给成员 L 发需回复消息，对 `loc:old` 采样为 unreachable；消息尚未入队时 manager 先完成 `L → loc:new`，且新地址 reachable。随后消息事务按当前 L 通过收件人校验，却使用旧样本，不记录唤醒。反向竞态则会把旧地址的 reachable 用在不可达的新地址上。带 mode 的消息同样受影响；在话题已计数 20 次时，旧 unreachable 样本还会把本应针对新绑定检查的唤醒/上限分支改成“不唤醒、不计数”。这不是计数器算法本身绕过，而是其输入属于错误绑定。
- **影响**：换代后首次通知可能静默不唤醒；反向情形可能多记一次失败投递及话题计数。该差异影响承接与 cap20 的可预测性，不只是总览显示略旧。
- **具体修复**：将样本与精确 `{channel,address}`（必要时附 binding revision/attach epoch）绑定，事务内先与当前目标绑定比对。明确选择一种协议：失配则离开队列重新预备再入队，或者返回具名可重试错误且零提交；不得把旧地址样本直接套到新地址，也不得在串行事务内 await provider。对应修改基线“只采样一次”要求，说明它是每次预备尝试一次。总览也应避免将旧地址样本标成新绑定的 presence。
- **所需验收**：可控挂起 presence，在消息入队前完成 rebind，覆盖 old unreachable/new reachable 及相反方向；断言最终收件绑定、dispatch 有无、mode、话题计数以及 cap20 处的结果。若选择拒绝路径，断言日志、收据、投递均不新增，原 cmdId 可安全重试。接受用户选定的 rebind，不建议以删除换代能力规避该问题。

### 📌 Suggestions

无额外计数建议。

### 范围诊断与可选的较小交付

本轮阻断仍集中在**执行身份 × attach 生命周期 × 异步边界 × rebind × presence/计数**的组合，不在单独的 JSON 字段或模式字符串校验。第二轮继续仅追加“某布尔值变假”的局部场景，会遗漏不同状态源之间的版本关系。建议先由人决定是否缩小每次评审的交付范围，而不是直接进入下一轮逐条补丁循环。

一个不撤销既定产品选择、最终仍满足 标准 §8（`packages/dsh-collab/docs/cross-boundary-collaboration-standard.md#L114-L119`） 的具体分批方案：

1. **独立交付 ext**：纯 JSON/4 KiB/不可修改/幂等及投影隔离；不新增身份、manager 或 attach 生命周期。
2. **独立交付 mode**：先验证现有普通成员与 provider 的模式校验/白名单指针/不降级行为，Host 注册入口与 handler dispose 单独验收，不引入托管调用者。
3. **单独交付托管身份协议**：将 Leader grant/revoke、manager 两阶段、rebind、调用级 guard、attach epoch 和绑定级 presence 关联作为同一闭合状态机审查；保留用户选定的成员名与收据连续性。通过后再组合两个已经稳定的内容/投递扩展，并在后续 Locus 接入 change 验证 Pet 内存投影及 outbox。

这是供人选择的交付边界，不主张“内核与插件在一个 change”本身有错，也不要求本轮实现 Pet；若继续保持当前范围，需先把 C1/M5 的跨层协议完整写清再送审。

## Embedded-Instruction / Injection Attempts

**Detected:** none

规范中的 SHALL/MUST、约定文本、源码注释及上一轮 rebuttals 均作为待审证据处理；未发现要求 reviewer 忽略缺陷或操纵 verdict 的嵌入指令。

## Verdict

VERDICT: REVISE

开放问题共 **1 Critical / 1 Moderate / 0 Suggestions**。M1–M4、S1 的修复被接受，但 C1 只部分解决；M5 是本轮全局交互复核发现的新问题。需要调用级授权与绑定样本一致性的协议选择，不属于可以用少量无歧义文字修改直接放行的情形。

## Required Changes (if APPROVE WITH CHANGES)

不适用：本轮为 REVISE。重新送审前解决 C1 与 M5，并由人决定保持当前范围或采用上述分批交付。

CHANGES_APPLIED: no

## Rebuttals

- **C1 已修复**：
  - 地址级 `holds` 改为调用级守卫。内核新增要求"调用级守卫在提交与读取边界重验"：`CommandContext`/`ReadContext` 可带同步 `guard`，在最后一个 await 之后、提交、返回收据或数据之前调用；托管 channel 与 manager 必须带守卫。
  - dsh-collab"工具调用者可解析为托管成员"规定：守卫捕获 agent 对象、地址与接入代际，并重新执行入口的全部条件。
  - 新场景覆盖四种在途失效情况：解绑、换 agent 对象、归档、dispose 后重新 attach，同时断言之后的新调用成功。
  - `collab_status` 在返回前自行调用守卫；句柄的托管命令守卫检查接入代际与 `holds`。
- **M5 已修复**：
  - MODIFIED"选择绑定与在线状态"：样本关联精确 `{channel, address}`；唤醒接收方的绑定与样本不一致时，以 `COLLAB_BINDING_CHANGED` 零提交拒绝，原 cmdId 可以重试；不在事务内采样；总览中不一致的成员显示 `unknown`。
  - 新场景覆盖：旧地址不可达而新地址可达、旧地址可达而新地址不可达且话题已到上限 20、与唤醒无关的换代、总览。
