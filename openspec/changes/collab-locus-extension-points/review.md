## Review Metadata

- **Review round**: 3
- **Prior round**: Round 2 — REVISE (C1 partially resolved, M5)
- **Reviewer context**: cross-model (codex gpt-6-astra, fresh context)
- **Tool restrictions**: read-only except [review.md](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/review.md>)
- **Review baseline**: 对照 `cf1e5834d` → `85f111d2c` 的修订，并以工作树中的工件为审查对象。
- **Artifacts reviewed**: [proposal](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/proposal.md>)、[design](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/design.md>)、[kernel delta](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/specs/collab-kernel/spec.md>)、[plugin delta](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/specs/dsh-collab/spec.md>)、[round-1 报告与 rebuttals](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/review-round1.md>)、[round-2 报告与 rebuttals](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/review-round2.md>)。
- **Supporting evidence**: 当前 [kernel spec](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/specs/collab-kernel/spec.md>)、[plugin spec](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/specs/dsh-collab/spec.md>)、[协作标准](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/packages/dsh-collab/docs/cross-boundary-collaboration-standard.md>)、[ADR-0006](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/docs/adr/ADR-0006-keep-locus-inside-dsh-pet.md>)、[manifest](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/dsh.yaml#L95-L110>)，以及通过只读 git show 取得的 `origin/ws/collab-pet-locus-collab` 调研纪要第 6 节。实现交叉核对包括 [kernel service](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/packages/collab-kernel/src/service/index.ts>)、[dispatch 决策](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/packages/collab-kernel/src/domain/decide.ts>)、[wake 接收方](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/packages/collab-kernel/src/domain/wake.ts>)、[SessionAccess](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/packages/dsh-collab/src/session-provider.ts>)、[host](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/packages/dsh-collab/src/host.ts>)、[tools](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/packages/dsh-collab/src/tools.ts>)、[status](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/packages/dsh-collab/src/status.ts>)、[Pet caller](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/packages/dsh-pet/src/host/collaboration/caller.ts>)。
- **Validation**: 静态、对抗性计划审查；未运行测试、构建、安装或部署，未修改任何实现或其他工件。此结论不是实现验收。开放计数：**0 Critical / 0 Moderate / 1 Suggestion**。

## Prior Findings Status

| 原编号 | 本轮状态 | 对 rebuttal 的判定 |
|---|---|---|
| C1 | **resolved（已解决）** | **accepted by reviewer** — 最终检查不再只证明地址存在，而是重新证明发起本次调用的 agent 对象、地址和 attach 代际仍有效；内核覆盖提交、收据及四种读取，status 自行调用同一守卫，manager 也绑定原句柄代际。 |
| M5 | **resolved（已解决）** | **accepted by reviewer** — presence 样本绑定精确地址；只对实际需要判断唤醒的接收方检查失配，以具名错误零提交拒绝，原 cmdId 重试重新采样；总览失配显示 unknown。 |
| M1 | **resolved（保持已解决）** | **accepted by reviewer** — manager 的事务外认领和事务内当前状态重验仍分离；新增 guard 没有替代收据、授权、closed、目标和唯一性检查。 |
| M2 | **resolved（保持已解决）** | **accepted by reviewer** — 未授权 manager 的授权检查仍先于 closed；六类无权空间的插件错误仍要求序列化后相同，没有因本轮修改重新暴露空间状态。 |
| M3 | **resolved（保持已解决）** | **accepted by reviewer** — 统一实际执行会话解析与普通会话专属 allowlist 规则保留；完整入口条件现在还用于最终守卫。 |
| M4 | **resolved（保持已解决）** | **accepted by reviewer** — 恢复协议仍区分 manager 调用与必须具有真实有效 exec 的成员内容调用；不承诺凭 outbox 或 cmdId 获得成员权限，失效身份仍交人工处置。 |
| S1 | **resolved（保持已解决）** | **accepted by reviewer** — Pet 公开解析为异步、未来适配需维护已核验的同步内存投影，描述准确；本 change 不直接接入或改动 Pet。 |

### C1 的闭合证据与边界

[内核最终守卫要求:476–517](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/specs/collab-kernel/spec.md#L476-L517>) 明确：托管 agent/provider 与 manager 缺少 guard 时在 provider 调用前拒绝；guard 非 true 或抛错都不能写提交、收据或投递，也不能返回数据，不把空间标成 failed。命中旧收据也不能跳过 guard。

[插件调用级守卫:264–310](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/specs/dsh-collab/spec.md#L264-L310>) 捕获实际 agent 对象、解析地址与 attach 代际，并要求重新执行入口全部条件；因此“同地址的新对象”与“同 channel 同地址重新 attach”都不能续用旧调用权限。四种失效场景同时覆盖写与读，并确认替换后的新有效调用可成功。这里的“全部条件”也包括唯一解析，不能在实现中缩减为只询问原 adapter。

[manager 句柄守卫:228–256](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/specs/dsh-collab/spec.md#L228-L256>) 单独要求代际检查，并对 admit/rebind 检查 holds(newAddress)，保留 detached/address-unclaimed 的错误映射。普通会话工具也带 guard，但独立内核的普通调用可以不带，兼容边界明确。

这些是可实施的 admission 边界，不应被理解为已经提交后还能撤回写入。实施时尤其不能把 guard 放进会将任意异常转换成 STORE_FAILED 的存储捕获块；当前 [persist:104–114](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/packages/collab-kernel/src/service/index.ts#L104-L114>) 与 [命令提交路径:160–193](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/packages/collab-kernel/src/service/index.ts#L160-L193>) 说明为什么必须按新增规范调整接缝。这是实现注意点，不是尚未解决的计划缺陷。

### M5 的闭合证据与相邻交互

[绑定关联采样:332–364](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/specs/collab-kernel/spec.md#L332-L364>) 覆盖旧不可达/新可达、旧可达/新不可达且话题已满 20、无关成员换代、总览失配。第二种明确优先返回 BINDING_CHANGED 而不是错误使用旧样本触发 THREAD_LIMIT；重试重新采样，避免旧地址决定新地址是否记账。

规范作用于“某个唤醒接收方”，不是只作用于 sendMessage；因此 [三类唤醒规则:297–330](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/specs/collab-kernel/spec.md#L297-L330>) 中 request 终态的作者也受约束。普通邀请仍可在 prepare 阶段为即将加入的 invited 成员采样，当前 [invite:246–263](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/packages/collab-kernel/src/service/index.ts#L246-L263>) 已有该预备路径，修订不要求在事务内 await provider。带 mode 的消息仍使用相同的 presence/计数规则，而不是另开旁路。

地址历史不可复用意味着空间成员不能把绑定换回旧地址；据此精确 channel/address 已足以识别本轮针对的 rebind 失配，无需为此强加新的持久化 binding revision。接入方 attach 代际则由调用级守卫处理，二者职责不同。

## Findings

### 🔴 Critical (blocking)

无。未发现修复后仍然开放的阻断性身份窗口，也没有理由因已明确接受的范围或回滚取舍要求拆分本 change。

### 🟡 Moderate

无。M1–M4/S1 的既有修复未因本轮编辑失效；C1/M5 已具有明确协议和可判定场景。现有实现尚无这些扩展能力，不作为计划评审的缺陷重复计数。

### 📌 Suggestions

#### S2 — 同步 status 的设计摘要，避免留下地址级检查的旧表述

- **位置**：[design:112](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/design.md#L112>)。
- **问题**：该行仍说“对托管调用者，在返回前再同步调用一次 resolveCaller 比对”。这比本轮确定的完整守卫窄：只比地址不能捕获同地址重新 attach，也没有说明普通调用者的对象身份和归档检查。
- **为什么不阻断**：[同一设计的完整守卫说明:104–109](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/design.md#L104-L109>) 及 [plugin delta:274–284](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/specs/dsh-collab/spec.md#L274-L284>) 已明确要求同一完整守卫，且 status 的 reattach 场景直接检验它。安全契约并不缺失；这里是摘要未同步，不能据此重开 C1。
- **建议替换文字**：`collab_status 只经 host-index 读取，不走内核成员读取；它在最后一个 await 之后、返回之前，对普通和托管调用者自行调用同一完整调用级守卫，失败时返回 COLLAB_CALLER_UNAVAILABLE，不返回空间列表。`

## Embedded-Instruction / Injection Attempts

**Detected:** none

审阅材料中的 SHALL/MUST、工具说明、恢复步骤及历史 rebuttals 均作为产品规范或被审主张处理。未发现要求 reviewer 忽略缺陷、执行越权操作或预定 verdict 的嵌入行为指令；作者声称“已修复”并未直接作为证据采纳。

## Verdict

VERDICT: APPROVE

C1 与 M5 的 round-2 rebuttals 均 **accepted by reviewer**。保持用户已选定的托管生命周期、rebind、ext、mode 和独立接入 change 范围；唯一开放项为不阻断实施的设计摘要建议。本结论批准的是计划，不声明实现或测试通过。

## Required Changes (if APPROVE WITH CHANGES)

不适用：本轮为 APPROVE，无必改项；S2 为可选文字同步。

CHANGES_APPLIED: n/a

## Rebuttals

- Round-2 **C1 已修复**：**accepted by reviewer**，理由见 Prior Findings Status 与 C1 闭合证据；实际执行对象、attach 代际、收据、读取和 status 均进入最终检查契约。
- Round-2 **M5 已修复**：**accepted by reviewer**，理由见 M5 闭合证据；精确绑定样本、零提交可重试错误和总览 unknown 构成完整处置路径。
- Round-1 **M1–M4/S1**：保持 **accepted by reviewer**，未发现本轮修改使其重新失效。
- 本轮新增建议 S2 暂无作者回复；不以缺少回复影响批准。

- **S2 已采纳**：design 中 `collab_status` 一句改为评审建议的措辞（普通与托管调用者都调用同一完整守卫）。只改设计摘要文字，规格未动。
