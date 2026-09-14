## Context

B035 从一个具体故障出发：答疑群 child 由 `fork` 创建、继承父会话 77 轮历史，于是继续扮演 GUI 里的主 agent，把结论写成 assistant 文本而从未调用 `pet_locus_reply`。随后该 change 扩展为完整协作平台（公共事实、协作者发现、异步询问、跨轮续进、G1–G5），57 项任务中仅 2 项完成，反而挡住了「先用起来」。

所有者 2026-03-23 决定收敛。本 change 只做让 Pet Locus 可用的最小改动；B035 保留不动，上下文切换与暂停状态见 `docs/notes/pet-locus-independent-child-handoff.md`。

### 已读的现状证据

- `packages/dsh-pet/src/host/locus/child.ts:303`：`DEFAULT_CHILD_PROVIDER = 'fork'`，由 `:329`、`:718`、`:816` 三条创建路径共用。根因至今未改。
- `packages/dsh-pet/src/host/locus/context.ts:339`：业务正文必须调用 `pet_locus_reply`，Host 从本轮 Delivery 绑定目标。
- `packages/dsh-pet/src/host/locus/context.ts:343`：已指导使用 DSH 原生 `send_message` 询问 caller-bound 主会话，且明确 parent 回复不构成持久授权。
- `packages/dsh-pet/src/host/locus/context.ts:345`：已禁止自动把结论回传主会话。
- `packages/dsh-pet/src/host/spec.ts`：locus 行没有上下文模式字段。
- 固定 runtime 的 `dsh-subagent-spawn-in-process` 声明 `inheritsParentContext=false`，`prepareContinuable()` 返回空初始化。

「可以问父」无需新建能力，前言已接线；本 change 不重写这些条文，只保证它们在独立 child 上真实生效。

## Goals / Non-Goals

**Goals:**
- 新建与显式重建的 child 零父 transcript、零默认父摘要。
- 创建前可失败地核验 provider 确实不继承父上下文。
- 持久化上下文模式，旧 child 不被静默改造。
- 飞书回复出口可靠：能在真实答疑群走通一次问答。

**Non-Goals:**
- 公共事实持久层、协作者名单、异步询问、结果续进、owner projection。
- G3/G4/G5 runtime 门槛。
- 冷恢复时 preset 漂移的修复（见 D3）。
- 旧 fork child 的自动升级。

## Decisions

### D1. 只换 provider 默认值，不新建创建路径

`DEFAULT_CHILD_PROVIDER` 从 `fork` 改为零父上下文的 provider，三条创建路径共用同一常量，因此一处修改即覆盖普通创建、idle 创建与重建。

不新增第二套创建函数：并行路径会让「哪条路创建的 child」成为新的不变量，而现有 reservation/lifecycle 队列语义已经过验收。

调用方仍可显式传 `provider` 覆盖，用于兼容与测试；默认值变更不改变该形参语义。

### D2. 能力核验 fail closed，不静默回退

创建前显式检查 provider 的 `inheritsParentContext === false`。无法证明时返回明确的失败原因，不退回 fork。

理由：静默回退正是原故障的形态——看起来创建成功，实际行为与预期相反。宁可创建失败并可诊断，也不要产生一个自以为是主会话的 child。

失败原因使用稳定机器码，与既有 `settlement-notice-unsupported` 等保持同一风格。

### D3. 冷恢复 preset 漂移是已知且被接受的限制

固定 runtime 的 cold composition 当前无条件重取父 live preset。修复它需要 compat patch、builder、manifest pin 与部署，属于独立的 runtime change。

本期不声称已解决，也不在 spec 中承诺。scenario「冷恢复保留独立历史」只要求恢复同一 child 的历史与身份，不要求冻结创建时的 preset。

这是范围收敛的代价，必须显式记录而不是悄悄放过。

### D4. 上下文模式是 additive 字段，未知不猜测

locus 记录新增可选模式字段，取值 `fork-prefix-v1` / `independent-v1` / `unknown`。

- 新建/重建走独立路径时写 `independent-v1`。
- 既有行不回填、不推断，保持未知。
- 不按创建时间或 provider 默认值反推：那会把「我们改了默认值」误报成「这个 child 当时就是独立的」。

schema 版本按现有 additive 规则演进；不转换、不清除既有行。

### D5. 公共事实本期由「问父」替代

child 缺少背景时通过原生 `send_message` 询问主会话；主会话若需要，再自行询问其它 child。这条链路已在前言接线，且不需要新的持久层或新的授权面。

代价：跨 child 的事实不共享、不版本化，父会话可能成为瓶颈。这是所有者明确接受的本期取舍，不是遗漏。

## Risks / Trade-offs

- [child 失去父背景后答非所问] → 前言已指导按需问父；本期以真实答疑群验收判断是否够用，不预先加共享层。
- [冷恢复 preset 漂移] → D3 显式承认；若实际使用中出现问题，再启动 runtime change。
- [两个 change 修改同一条 requirement] → 归档时按实际实现顺序重新对齐；本 delta 已在 Baseline 中声明边界。
- [默认值变更影响既有调用方] → 调用方仍可显式传 provider；旧 child 记录与行为不变。
- [独立 child 首轮能力不完整] → D2 fail closed，不发布半成品 child。

## Migration Plan

1. 实施并通过 Pet package 的 typecheck 与测试。
2. `dsh build` 物化，验证第二次 sync 幂等（需所有者授权）。
3. 重启 DSH（需所有者确认时机）。
4. 在真实答疑群完成一次验收：提问 → child 独立上下文 → 收到飞书回复。
5. 回填证据，仅勾选真实通过的任务。

既有 locus 与 child 不迁移、不重建。所有者可在空闲时自行显式重建旧 child，本期不提供批量升级。

## Open Questions

- 独立 child 在真实使用中是否频繁需要问父？若是，B035 的公共事实优先级应上调。
- 是否需要在管理面展示上下文模式？本期只要求持久化，展示可延后。
