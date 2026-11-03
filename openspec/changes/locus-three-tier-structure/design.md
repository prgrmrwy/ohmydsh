## Context

- 现状（DSH 0.2.0-rc.2）：locus 子会话由 Pet 经补丁能力 `createIdleContinuable` 空闲创建（`packages/dsh-pet/src/host/locus/child.ts:860-938`），父会话是 auto 时 Pet 自建的 standby 主会话或 `/bind`、Q&A 时用户的工作会话（`controller.ts:1044-1069`、`1693-1745`）；主会话与子会话都挂 `dsh-pet-executor` preset（`aggregate.ts:60,68`），该 preset 含委派工具行（`presets/dsh-pet-executor/agent.cordis.yml:168-205`）。
- 协作：Pet 以 dsh-collab 托管 channel `pet-locus` 接入，每个子会话是托管成员（代理成员 `pet`），靠戳、投影、recipients 隔离兄弟入口（`host/collab/*`）；另有 Pet 自有的 `collaboration_contexts` 表与 inquiry 子系统（`host/collaboration/*`、`host/inquiry/*`，5 张表）。
- 补丁：`compat/subagent/settlement-notice.patch` 提供 `settlementNotice:'silent'`、`createIdleContinuable`、`contextMode:'independent-v1'`、持久 `agentPreset`、`withLiveContinuableChildSession`（借出子会话 Session，5 处消费：`index.ts:2565-2571`、`2582-2590`、`3178-3190`、`channel/locus-controller.ts:1885-1898`、`index.ts:630-642`）。
- 官方事实（rc.2 静态核查，memex `locus-three-tier-rc2-verification-results`）：父 agent 的 `tools.restrict` 不传子会话；`agent/created` 监听器 throw 会回滚创建；`startContinuable` 字段为 prompt/parent/agentOptions/maxDepth/toolFilter/persona，无沙箱/审批/preset/contextMode；`spawn` provider `inheritsParentContext=false`（`dsh-subagent-spawn-in-process/lib/index.js:30`）；一级会话可由插件 `setApprovalPolicy`/`setSandboxMode`；`sessionQuery.observeSession` 可冷读子会话（末尾补合成 `turn/end interrupted`）；Host 层插件的全局工具会被 allow 式过滤掉。
- dsh-collab 接入方句柄（`packages/dsh-collab/src/integration.ts:194-276`）：`command`/`read`/`establish` 只能以 `exec` 解析出的实际调用会话身份执行，`command` 只允许 6 个成员写操作；`admit/rebind/retire/disposeRequest` 以 manager 身份管理托管成员。
- ADR-0007 规定三层只能以自身理由立项，先答四个待决事项并解决 B040、持久层语义迁移两个前置。ADR-0005（write 档）、ADR-0008（shell 档）为 Accepted。

## Goals / Non-Goals

**Goals:**
- 用户工作会话不再被征用为子会话父会话；归档只影响入口，不被父子边劫持。
- Locus 的协作统一到 dsh-collab 普通成员模型，删除 Pet 的平行协作/询问机制。
- 子会话默认只读、按需创建；locus 主会话工具面锁死且可证明。
- 退役 `settlement-notice.patch`，每项语义有官方对应或被结构消除。
- 一并解决 B040 与迁移前置。

**Non-Goals:**
- 跨机 collab；裁剪 dsh-collab 的托管成员 SPI（保留，Pet 不再使用托管成员）；B042 回执文案以外的群内交互改版；locus 提取为独立插件（ADR-0006 维持）。

## Decisions

1. **实体：`loci` 仍为两层，父 = locus 主会话；新增 `locus_mains` 表记录 `{workSessionId, locusMainSessionId, generation, status, spaceId}`，干活主会话与 locus 主会话 1:1。** 沿用 ADR-0007 撤回论据的结论：数据模型层数不变，现有按父/子查询的判据不需重写。被否：在 `loci` 行加 `workSessionId`——每个入口重复存同一关系，换 locus 主会话时要改写全部入口行。
2. **迁移：新增表（domain v18），旧行不改写，按读取规则解释。** 不带 `locus_mains` 关联的旧 `loci` 行一律视为旧模型，读取时走现有退休路径（`retirement.ts` 依赖 invalid/旧行作为"曾绑定过"证据，ADR-0007 已说明不可删）：入口下次被 @ 时提示所有者 `/bind` 或按 auto 新建三层结构，不自动迁移。这样避开"第一次语义性数据转换"，`migrate-state-version.mjs` 仍只做加表。被否：脚本把旧主会话改写为干活主会话并补建 locus 主会话——需在停机脚本里创建会话，不可行。
3. **子会话惰性创建：首条消息到达时用官方 `startContinuable` 携带该消息的 prompt 创建；入口在此之前为 `not-created`。** 失败分两类：名额不足可重试，原 Delivery 保持待处理并在名额释放时重试；其它失败 Delivery 记失败并回执，入口保持 `not-created`。已实测（[probes/agent-created-probe.md](probes/agent-created-probe.md)）：`agent/created` 先于首轮认领，创建抛错时首轮不执行；但 `startContinuable` 在首轮认领之后才返回，所以 Host MUST 在 `agent/created` 内用预留 `childId` 发布子会话/marker/current 关联（沿用 `prepublication-staging` 的身份桥，但调整持久发布与失败补偿时序：回调内发布后创建被拒须回滚持久状态），不能等返回值。被否：保留 `createIdleContinuable`——补丁存续，且 ADR-0007 理由 1 所述"两阶段建树补偿"在首条 prompt 创建下变为单步。
4. **结算通知改用官方默认（notify）。** locus 主会话是 Pet 自有、锁死工具面的会话，正是子会话结果的受众（ADR-0007 理由 3 取向 B）。不再有"打断用户工作"的前提。
5. **冷恢复按父组合是期望行为。** 官方冷恢复以父会话当前 preset 重建子会话组合；父是 preset 固定的 locus 主会话，且 locus 主会话不允许改 preset（Pet 在 `agent/created` 与每次投递前核验，不符即拒绝服务该入口）。因此 `contextMode:'independent-v1'` 与持久 `agentPreset` 不再需要；上下文独立由 `spawn` provider 的 `inheritsParentContext=false` 保证（Pet 继续用 `getProvider('spawn')` fail-closed 证明，`child.ts:419,444-455`）。换 locus 主会话时，旧代子会话一律作废，不跨父恢复。
6. **借出子会话 Session 的 5 处用途逐一替换：** ① 设沙箱、② 回读：子会话常驻且空闲时经 `ctx.agents.get(child)` 取 live agent 直接设置并回读；不常驻时只持久化期望值，在下一次 `agent/created`（创建或冷恢复）内设置并回读，回读不符时按原生效值完成组合并回执失败，不保留期望值（见 spec"非驻留子会话的权限变更以待应用协议提交"）。已实测 rc.2 冷恢复经过 `agent/created`（`source:'resume'`），监听器失败会令恢复失败（见 probes）。③ 启动恢复证据：`sessionQuery.observeSession` 冷读；冷读末尾的合成 `turn/end interrupted` 不得作为"已中断"证据，只有日志中真实写入的 interrupted 才算（与 `pet-locus-interrupted-delivery-recovery` 的 fail-closed 一致）；`sessionQuery` 不可用时证据不足、保守等待。④ 投递前策略核验：改为核验持久记录的组合证明 + 代际，不读活 Session。⑤ inquiry 物化：随 inquiry 退役删除。
7. **组合：新白名单 preset `locus-base`（名称中性、与 channel 无关、不含任何委派行），locus 主会话与子会话都挂它。** 上限由 preset 决定；locus 主会话再用 deny 式 `tools.restrict` 挡 bash/write/edit/委派（Host 层 collab 工具因此保留，见 rc.2 核查第 7 条），Host 在创建后设审批 `never`、沙箱 `read-only`；子会话用 allow 式 `toolFilter`，Pet 工具挂 own scope。有一条为 preset 写的断言测试：preset 展开后不含委派工具。write/shell 档：preset 与子会话 `toolFilter` 的上限包含 bash/skill，默认 `safe` 档由 Host 安装的可撤销 `tools.restrict` 层挡掉，所有者显式授予时在同一子会话上就地撤掉该层（沿用 `composition.ts:344-405`、`index.ts:1492-1524` 的现有机制，`pet-locus-shell-tier` 已归档行为）；ADR-0005/0008 继续有效。子会话 composition marker 新增 `tier3`，只有带它的行可服务，旧 marker 的行按旧模型退休规则处理。
8. **协作：两个普通成员 + 接入方"代持会话"命令。** 现有句柄只能以 `exec` 的实际调用会话身份写，子会话调用 Pet 工具时 exec 是子会话本身，无法"以 locus 主会话身份代写"；也没有 invite。故 dsh-collab 新增句柄能力 `actAs(sessionId, ...)`：仅当 `sessionId` 是普通一级会话、满足准入条件、且接入方 adapter 新增的 `owns(sessionId)` 返回真（每次在内核提交边界重验）时，以该会话的 `dsh-session` 身份执行封闭操作集合（以 dsh-collab delta 的清单为准：`createSpace`、限本 channel 的 `allowManager`、`invite`、`createItem`、`reviseItem`、`ackItem`、`sendMessage`、`setStatus`、`advanceRequest`、`read`）。Pet 对自己创建过的全部 locus 主会话（含已被替换或归档的历史 main）返回 `owns=true`，使 manager 仍可处置历史空间中由它们登记的待办；`actAs` 另要求会话满足准入（未归档），所以历史 main 不能再以普通成员身份执行命令。Host 用它以 locus 主会话身份建空间、邀请干活主会话（按 memberTrust 代为加入，干活主会话会被唤醒一次）、代写待办（`ext.pet.entry` = 稳定入口身份）。被否：仅加 invite op——仍解决不了"代写"；让子会话成为托管成员——就是要删掉的旧机制。
9. **子会话读共识：`locus_context` 由 Host 经 `actAs(locusMain).read` 读取空间，按入口过滤**：无 `ext.pet.entry` 的 agreed charter 为工作空间级；带标记的只对该入口（话题可见所在群）可见；只返回 agreed charter 与本入口待办进度，不返回消息。locus 主会话写入口级条目用 `locus_note`（Host 打标）；它用普通 collab 工具写的条目一律是工作空间级——这是模型判断造成的误泄口子，与 collab-integration 的"防误泄不防串通"威胁模型一致。`locus_reply_child` 由 Host 调官方 `subagents.sendMessage`，只允许发给该 locus 主会话的现行代子会话。
10. **B040：失败的 provisioning 超过 10 分钟不再阻塞，且在下一次同 endpoint 请求前于运行期调用与启动时相同的补偿器。** 补偿器失败则继续阻塞并记诊断；所有 provisioning kind 一致适用。
11. **退役 inquiry 整体**：子会话问不出的事改为登记待办（由人或干活主会话处理）；locus 主会话需要干活现场信息时经 collab 给干活主会话发消息。`inquiry-isolation.patch`（只服务 inquiry 的排队轮次认领）一并退役；`newinquiry-tools-guard.patch` **保留**——按 compat README，它让"异步执行包装等待期间被撤销的守卫在调用工具体前仍拒绝"，是所有受管工具调用的通用安全保证，不只服务 inquiry；5 张 inquiry 表保留只读（不删表，避免迁移改写），不再写入。
12. **ADR-0009 取代 ADR-0007 的待决部分**，逐条回答：
    - 工作现场需要协作工具吗：需要。它是 dsh-collab 普通成员，`collab_*` 是 Host 层工具，本就可用；不依赖 Pet 的 `eligible()`。
    - 协作主 preset 边界：取向 B（活跃 + 锁死）：白名单 preset + deny restrict + 审批 never + 沙箱 read-only；任何放宽须改 preset 并评审。
    - 双向能力替代：子会话→locus 主会话：caller-bound `locus_ask_parent`（Host 以官方会话投递接口投给父，只能投给现行父）；需要人或干活现场处理的工作登记待办；locus 主会话→子会话：`locus_reply_child`；locus 主会话↔干活主会话：collab 消息。真正知道答案的是干活现场，经 collab 问它，不再让子会话直问。
    - 常驻代价：locus 主会话是普通会话、无闲置驱逐，数量 = 被绑定的干活主会话数（不是群数）；子会话仍是可驱逐的 subagent。实施后在 verify 记录一次实测（会话数、驻留内存）。

## Risks / Trade-offs

- [干活主会话被邀请时唤醒一次] → 用户已接受；唤醒只是 collab 指针。
- [locus 主会话被模型用 collab 工具写出入口级内容造成跨入口可见] → 威胁模型只防误泄；`locus_note` 是唯一打标路径。
- [`actAs` 是新的身份代持能力] → 仅对 adapter `owns()` 声明且为普通一级会话的地址，操作集合封闭，guard 在提交边界重验；`managedChannels` 本就由所有者配置。
- [旧入口不自动迁移] → 所有者需对每个旧入口 `/bind` 或等首个 @ 走 auto；管理面列出待迁移入口。
- [子会话不常驻时改档位或权限要等下次唤醒才应用] → 回执如实说明"已记录，下次唤醒时应用并核验，可能失败"；目标核验失败时恢复并核验原生效值继续服务，只有原值组合也无法证明时才拒绝发布。
- [冷读证据不足导致启动恢复更保守] → 宁可等待也不误结算，与现有 fail-closed 一致。

## Migration Plan

1. 先归档三个在途 Pet change（其 spec 作为本 change 的基线）。
2. dsh-collab：新增 `actAs` 与 adapter `owns`（不影响现有句柄）。
3. Pet：新 preset、`locus_mains` 表与 v18、惰性创建、组合、collab 改造、新工具、B040、启动恢复证据替换；退役代理成员/戳、collaboration、inquiry 写路径。
4. 移除 `settlement-notice.patch` 与 `inquiry-isolation.patch`；**保留** `newinquiry-tools-guard.patch` 及其运行图与测试；更新 compat README 与 `dsh.yaml` 说明。
5. 停 Host 运行 `migrate-state-version.mjs`（v17→v18 只加表），`dsh build` 两次确认幂等。
回滚：恢复迁移脚本备份并回退构建；v18 新表对旧版本不可见，旧行未改写。

## Open Questions

- 新 preset 的确切工具清单在实施的第一个任务中由断言测试固定（不含委派是硬约束）。
- 常驻代价的实测数字在 verify 中补。
