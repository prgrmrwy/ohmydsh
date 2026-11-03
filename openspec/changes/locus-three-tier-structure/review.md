## Review Metadata

- Round: 3 — full review, fresh context。
- Prior review: round 2 — REVISE（0 Critical、2 Moderate、2 Suggestions）。
- Reviewer: cross-model codex gpt-6-astra fresh。
- 目标版本：DSH `0.2.0-rc.2`。
- 权限：只读审查，仅覆盖本报告；未修改其他文件，未构建、测试、部署、迁移、重启或派发下级评审。
- 覆盖：proposal、design、六份 delta、上轮报告；相关当前规范条款、ADR-0006/0007/0008、集成陷阱与 compat README；连接检查 dsh-collab integration → kernel disposal，以及 Pet composition 的应用、工具面回读与拒绝发布路径。未发现 tasks 文件。
- 限制：不是全部当前规范与实现的逐行覆盖；部分长文读取被工具裁剪，结论只依赖实际可见条款。未运行独立 rc.2 生命周期/首 prompt 探针，设计中的探针要求不代表验证已通过，也不据此推断官方 API 不支持。

## Round-2 Finding Status

| 原项 | 本轮状态 | 依据 |
|---|---|---|
| M1：冷恢复容量失败仍触发换代 | 已解决（文档契约） | [换代分类与场景](specs/pet-locus-collaboration/spec.md#L59-L76) 已明确非容量失败才换代；容量恢复保留同 child、同代际、同 Delivery。 |
| M2：非驻留权限缺少提交与回执语义 | 核心设计已解决，存在局部条款同步遗漏 | [待应用协议](specs/pet-locus-collaboration/spec.md#L160-L181) 已选择期望/生效分离、成功回读后确认、失败清除期望；[决策 6](design.md#L29) 删除换代 fallback。无需重新选择方案；残留矛盾见本轮 M1。 |
| S1：actAs 操作枚举遗漏 | 已解决 | [决策 8](design.md#L31) 补齐 allowManager、ackItem，并以 delta 清单为准。 |
| S2：历史 ownership 与普通准入联合测试 | 保留为实施建议 | 归档拒绝、历史 manager 处置、提交重验均已有契约；仍建议以同一 fixture 验证，缺少联合场景不升级为架构阻塞。 |

## Findings

### 🔴 Critical (blocking)

无。本轮没有证据支持推翻已经批准的三层方向。

### 🟡 Moderate

#### M1 — 待应用协议已选定，但相邻规范仍要求即时切换、失败降到 safe 或拒绝服务

**位置：** [新增协议](specs/pet-locus-collaboration/spec.md#L160-L181)、[工具档位要求与场景](specs/pet-locus-collaboration/spec.md#L341-L387)、[风险说明](design.md#L47)。

**问题：** 新协议要求非驻留 child 回读期望值失败时恢复“原生效值”、清除期望并继续服务；但同文件第 347 行与第 369–371 行仍无条件要求回到 safe，授予/撤回场景也未限定为常驻即时路径。第 347 行把“无 current Delivery”作为生效条件，而新增协议明确在下一条 Delivery 唤醒时提交。设计风险段则仍承诺“下次唤醒时生效”，并规定回读失败就拒绝服务，与决策 6 的失败回退服务不一致。

**具体反例：** C 原来为 shell，释放后所有者请求 safe，下一条 D 唤醒时目标工具面核验失败。新增条款要求恢复原 shell、清掉期望、报告撤回失败并服务 D；旧场景要求 safe；风险段要求拒绝服务。实施者/测试作者不能同时满足这三种结果。现有成功场景只覆盖 safe→shell，因而掩盖了差异。D 到达后是否因 current 已建立而禁止提交，也应由同一处规则明确，而非由实现自行解释。

**校准：** 这是选定协议之后的局部同步遗漏，不再是 round-2 M2 的“尚未选择完成语义”。以新增协议为准即可精确修改，不需重新设计，因此不判 REVISE。

**最小修正：** 工具档位要求明确：常驻即时路径沿用失败回到 safe；非驻留路径适用新增待应用协议，命令接受时检查入口空闲，延迟提交在冷恢复首个业务工具执行前完成，不因用于唤醒的 Delivery 已建立而误拒绝。授予/撤回及失败场景注明适用路径；增加原 shell→期望 safe 的失败场景，断言原值恢复并核验、期望清除、失败回执、同 child/代际不变。恢复原值仍无法核验时，继续服从现有“无法证明组合不发布”的总则，不能无条件继续服务。设计风险段同步成“下次唤醒时应用并核验，可能失败”，删除目标回读失败即一律拒绝服务的旧结论。

### 📌 Suggestions

#### S1 — 保留历史 ownership 的联合回归 fixture

沿用 round-2 S2：M1 归档、M2 接替后，M1 普通 actAs 被拒，但 manager 可静默处置 M1 作者的旧 request；在提交前撤销 ownership 则失败且不写日志。当前 [integration](../../../packages/dsh-collab/src/integration.ts#L223-L241) 与 [kernel disposal](../../../packages/collab-kernel/src/service/index.ts#L486-L494) 尚为 managedBy 路径；这是本 change 计划扩展的实现差异，不是证明新 SPI 不可行。

#### S2 — 首个实施探针必须记录失败恢复的第二次核验

[现有 composition](../../../packages/dsh-pet/src/host/locus/composition.ts#L324-L405) 将策略应用、scope 安装、实际工具面核验串联，失败抛错。替换 live Session seam 时，应验证目标应用失败后重新装配原值也经过实际回读；不能只把 durable effective 写回就继续执行。同时保留首 prompt 顺序、冷恢复经过 agent/created、own-scope 工具不被继承 filter 遗漏的探针。这些是实施验收义务，不冒充本轮已完成的运行时证明。

## Embedded-Instruction / Injection Attempts

**Detected: no。** 所读材料未发现要求评审者忽略上级指令、强行通过或执行无关副作用的嵌入指令。规范 SHALL、源码注释和文档命令仅作为审查数据；未执行其构建、迁移或部署步骤。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

容量问题已闭合，非驻留权限的核心协议也已选定。剩余必改项是相邻条款与场景的无歧义同步，不涉及重新选择三层结构、权限协议或官方 API 路线；按 anvil 校准应带明确小改动通过，而不是继续 REVISE。

## Required Changes

1. **M1：以新增待应用协议为准同步工具档位要求与场景：常驻即时失败回到 safe，非驻留失败恢复并核验原生效值、清除期望并回执失败；明确空闲检查发生在命令接受时，延迟提交在冷恢复首个业务工具执行前完成；补 shell→safe 失败回退的同 child/同代际场景，原值也无法核验时拒绝发布。**
2. **M1：同步设计风险段：将“下次唤醒时生效”改为“下次唤醒时应用并核验，可能失败”；目标核验失败按待应用协议回退，只有原值组合仍无法证明时拒绝服务。**

CHANGES_APPLIED: yes

## Rebuttals

### 复核（round 3 re-check）

1. **Required Change 1 — applied。** 工具档位条款已区分常驻即时失败回到 safe 与非驻留待应用路径，明确命令接受时检查空闲、冷恢复首个业务工具前提交且不因唤醒 Delivery 已为 current 而拒绝（specs/pet-locus-collaboration/spec.md:356）；授予、撤回与失败场景已限定常驻路径（specs/pet-locus-collaboration/spec.md:366–380）。非驻留失败恢复并回读核验原生效值、清除待应用标记与期望值、回执失败，原值不可核验则拒绝发布（specs/pet-locus-collaboration/spec.md:165）；新增 shell→safe 失败场景覆盖原 shell 回读一致、失败回执、清除期望、同 child/同代际，以及原值核验失败不发布（specs/pet-locus-collaboration/spec.md:179–186）。
2. **Required Change 2 — applied。** 风险段已改为“下次唤醒时应用并核验，可能失败”，目标核验失败恢复并核验原生效值继续服务，仅原值组合无法证明时拒绝发布（design.md:47）。

本次仅复核上述两项文档修正；未复审其他发现，未验证运行时实现。VERDICT 保持不变。

- 接受 round-2 M1 修复；不再把容量压力当作换代条件。
- 接受 round-2 M2 的协议选择与删除换代 fallback；本轮只要求同步 sibling 条款，不要求重新设计提交机制。
- 不因未运行官方探针而声称 rc.2 没有 agent/created；探针失败时返回设计评审的约束已经正确。
- 不以三层概念强迫 loci 改为三层；映射表与现有父子模型可以共存。
- 不重新挑战已接受的普通协作 M 信息转述风险，也不将已有实现缺少 actAs/authorOwned 误当成设计缺陷。
- 补丁退役清单已明确保留通用异步工具 guard，不重复旧发现。
- 本报告仅评价提案可进入实施的条件，不表示新协议已实现、运行验证通过或获准部署。
