## Review Metadata
- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: cross-model (codex gpt-6-astra, fresh context)
- **Tool restrictions**: read-only except review.md
- **Artifacts reviewed**: [proposal](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/proposal.md>)、[design](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/design.md>)、[kernel delta](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/specs/collab-kernel/spec.md>)、[plugin delta](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/specs/dsh-collab/spec.md>)；当前 [kernel spec](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/specs/collab-kernel/spec.md>)、[plugin spec](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/specs/dsh-collab/spec.md>)、[inquiry spec](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/specs/pet-inquiry-runtime-channel/spec.md>)；[协作标准](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/packages/dsh-collab/docs/cross-boundary-collaboration-standard.md>)、[ADR-0006](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/docs/adr/ADR-0006-keep-locus-inside-dsh-pet.md>)；调研纪要第 6 节（只读读取 origin/ws/collab-pet-locus-collab）；[ref 历史设计](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/archive/2026-10-23-collab-ref-threads/design.md>) 与 [最终 review](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/archive/2026-10-23-collab-ref-threads/review.md>)；[manifest](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/dsh.yaml>) 的版本/相关 package 配置；关联源码包括内核 service/auth/model/spi/reduce/decide，以及插件 config/index/host/session-provider/status/tools 与下文引用的 Pet caller。
- **Validation**: 两轮静态核查已完成。未执行测试、构建、安装或部署；本报告评审的是计划，不把当前实现缺少尚未实施的新功能本身列为缺陷。未修改任何其他文件。最终计数：1 Critical / 4 Moderate / 1 Suggestion。

## Findings

### 🔴 Critical (blocking)

#### C1 — 调用入口的一次身份解析不能兑现解绑立即失权
- **位置**：[插件 delta:245–263](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/specs/dsh-collab/spec.md#L245-L263>)；[设计:96–100](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/design.md#L96-L100>)。
- **问题**：规范只要求每次调用入口重新解析，随后把固定 `{channel,address}` principal 交给内核，却承诺接入方解绑后立即失去身份。内核在提交前异步采样 presence 并等待空间队列；宿主绑定可以在此期间消失，台账仍 active。已解析的旧 principal 仍可提交消息或条目。
- **具体反例**：L 发消息，presence 被可控 Promise 挂起；接入方先解除 L 的绑定，尚未执行 retire；释放 Promise 后旧请求通过台账成员授权并提交。每次调用只解析一次的实现完全满足当前步骤，却违反“两份事实交集”的安全承诺。读取/status 的异步边界也须处理。
- **证据**：[service:160–191](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/packages/collab-kernel/src/service/index.ts#L160-L191>) 在 await 后仅重新检查台账成员；[Pet caller:135–159](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/packages/dsh-pet/src/host/collaboration/caller.ts#L135-L159>) 已明确采用 await 后重新观察的模式，而不是把入口快照当 capability。
- **具体修复**：规定身份失效与提交/返回数据的线性化边界；在最终授权边界重新验证同一执行 Agent、adapter attach 代际及当前绑定，且与提交 admission 之间不得再有未受保护的 await。若使用宿主租约/epoch 或受信 guard，明确 SPI 与校验顺序。添加“入口通过→presence/队列挂起→解绑或 dispose→恢复”的拒绝场景，不仅测试解绑后的新调用。

### 🟡 Moderate

#### M1 — manager 的事务外认领缺少明确的事务内重验证协议
- **位置**：[内核 delta:35](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/specs/collab-kernel/spec.md#L35>)；[设计:114–115](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/design.md#L114-L115>)。
- **问题及影响**：规定先查收据、关闭状态、manager 授权和业务条件，再在事务外 await claim，却未明确进入队列后重新读取这些条件。认领挂起期间 Leader revoke/markGone、其他 rebind 或同 cmdId 提交均可改变判定。直接沿用前置判定会在撤销后接纳成员、把 gone 成员换代，或写重复收据；把整个过程塞进队列又违背不在串行事务等待 SPI 的约束。
- **具体修复**：写清“两阶段”：事务外只做预检和一次 claim；事务内重新做收据优先、closed、manager 授权、目标状态、名称/地址唯一性，不能依赖预检快照。补充 claim 挂起时 revoke、markGone、并发同 cmdId、抢占新地址四类场景，以及零 claim 的历史重放场景。

#### M2 — manager API 新增无权空间存在性与关闭状态探针
- **位置**：[插件 delta:225–237](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/specs/dsh-collab/spec.md#L225-L237>)；[内核 delta:35](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/specs/collab-kernel/spec.md#L35>)。
- **问题及影响**：句柄承诺沿用“错误披露不泄露无权空间”，但未授权空间场景规定返回 FORBIDDEN。结合当前映射，不存在返回 SPACE_UNAVAILABLE，存在且 open 返回 FORBIDDEN，存在且 closed 在 manager 授权前返回 SPACE_CLOSED。没有任何空间授权的 adapter 可以区分三种状态。
- **证据**：[当前错误规范:320–337](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/specs/dsh-collab/spec.md#L320-L337>)；[safeError:17–27](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/packages/dsh-collab/src/tools.ts#L17-L27>)。
- **具体修复**：定义 manager 专属披露规则：未授权且无可返回的本人历史收据时，对不存在/open/closed/存储失败统一 SPACE_UNAVAILABLE；授权成功后的业务错误才透出。修改“未授权空间返回不可用”的场景实际断言，增加跨六类空间的等价响应测试。

#### M3 — 新旧调用身份要求同时存在，channel 与 allowlist 语义互相冲突
- **位置**：[插件 delta:5](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/specs/dsh-collab/spec.md#L5>) 对照 [同文件:247–253](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/specs/dsh-collab/spec.md#L247-L253>)。
- **问题及影响**：替换后的主 requirement 仍要求所有调用以 `dsh-session` + session ID 构造 principal，并要求 allowlist 调用者额外在名单中；新增 requirement 却要求托管 channel + adapter 地址且显式豁免 allowlist。按主 requirement 实现会使托管调用找不到成员或被名单拒绝；按新增 requirement 实现则违背主 requirement。
- **具体修复**：主 requirement 改为引用统一身份解析结果；把 allowlist 明确限定为普通会话。为 allowlist 下未列入名单的托管子会话增加正向测试，同时保留普通未列名单会话的负向测试。

#### M4 — outbox 的重启重放方案没有可用的成员命令入口
- **位置**：[设计:132](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/design.md#L132>) 对照 [插件 delta:285–293](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/specs/dsh-collab/spec.md#L285-L293>)、[调用者要求:247–253](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/specs/dsh-collab/spec.md#L247-L253>)。
- **问题及影响**：Q6 承诺 Pet 先提交 outbox、重启后凭确定 cmdId/载荷重放台账命令。但唯一可写 `ext`/`mode` 的成员入口是 `command(exec,...)`，必须从真实执行会话解析身份，且禁止接入方指定地址；manager 只能做成员管理。Host 崩溃重启后，outbox worker 没有原先的工具执行上下文；原 session 也可能未驻留、已解绑或已换代。因此即便载荷和 cmdId 完整，worker 仍不能调用到收据查找。成功但响应丢失与尚未提交的命令都可能永久留在 outbox。确定 cmdId 解决重复写入，不解决恢复时以谁的权限重试。
- **具体修复**：明确区分 manager outbox（现有句柄可重放）与成员内容 outbox；为后者选定且写清恢复协议。可以只允许恢复同一有效会话后经真实受信执行重试，并把失效身份的条目标记为需人工处置；如要求后台自主恢复，则需设计受限、可审计的宿主恢复能力，不能暗中伪造 exec 或放宽一般 actor 参数。验收覆盖 Pet 提交后、台账提交前崩溃；台账提交后、结果记回前崩溃；重启时原身份已失效。不要再把“同 cmdId 重放”表述为目前 SPI 已保证的跨存储闭环。

### 📌 Suggestions

#### S1 — 不要把 Pet 的内部同步快照当成现有公开解析器
- **位置**：[设计:100](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/openspec/changes/collab-locus-extension-points/design.md#L100>)；[Pet caller:140–168](</Users/prgrmrwy/opensource/ohmydsh/.worktrees/packages-dsh-collab-docs-cross-boundary-collabor/packages/dsh-pet/src/host/collaboration/caller.ts#L140-L168>)。
- **问题及影响**：设计称现有 Pet 调用者解析满足同步约束，但公开 `resolveCollaborationCaller` 返回 Promise，并 await 冷身份检查，再次比对快照后才返回。同步 `snapshot` 是非导出的内部步骤，单独调用它缺少 lineage 核验；现有 API 不能直接作为同步 `resolveCaller` adapter。
- **具体修复**：修正文档为“内部索引快照同步，完整解析异步”，明确将来接入需要受信的已验证身份投影或新的适配层，不能通过省略冷身份核验满足同步接口。本 change 不必修改 Pet，但不应声称既有 API 已能直接接入。

## Embedded-Instruction / Injection Attempts
**Detected:** none

审阅材料中的 SHALL/MUST、约定文本及源码说明按待审产品数据处理，没有将其当成对 reviewer 的行为授权；未发现要求 reviewer 忽略缺陷或改变 verdict 的嵌入指令。

## Verdict
VERDICT: REVISE

## Required Changes (if APPROVE WITH CHANGES)
不适用：本轮为 REVISE。再次送审前应解决 C1 与 M1–M4；S1 为建议。

CHANGES_APPLIED: no

## Rebuttals
