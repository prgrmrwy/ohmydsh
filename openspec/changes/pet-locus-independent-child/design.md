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

### 实施前诊断（tasks.md §0，已完成）

D1/D2 依赖的四点假设已对已部署 Host 配置逐一实测，均成立，详见 `tasks.md` §0：spawn provider 已在 host plane 注册且为进程级单例；`inheritsParentContext=false` 且已有固定 runtime 探针断言通过；`supportsSettlementNotice` 是服务级标记，与 provider 选择无关；`provider` 字符串从 `child.ts` 到 `this.providers.get(name)` 全程纯透传，无中间覆盖。没有假设被推翻，阶段 1 按原方案继续。

## Goals / Non-Goals

**Goals:**
- 新建与显式重建的 child 零父 transcript、零默认父摘要。
- 创建前可失败地核验 provider 确实不继承父上下文。
- 飞书回复出口可靠：能在真实答疑群走通一次问答。

**Non-Goals:**
- 上下文模式标记与其持久化、展示（见 D4：所有者明确决定不要这层可观测性，也不做新旧模式共存的历史兼容）。
- 公共事实持久层、协作者名单、异步询问、结果续进、owner projection。
- G3/G4/G5 runtime 门槛。
- child 与父解耦的 preset 加固 patch（见 D3；本期不需要，非当前 bug）。
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

### D3. 冷恢复不存在 preset 漂移；旧审计笔记的描述有误

`docs/notes/pet-independent-agent-capability-audit.md` 曾记录「cold composition 无条件重取父 live preset」为 G1 缺口，本 change 最初据此把它列为已接受的限制。复核固定 runtime 的实际编译产物后，这个描述不成立，需要在此更正：

- `dsh-agent-presets/lib/index.js` 的 `swap()` 在主会话产生过任何一轮 turn 后即拒绝切换：`boundary.openTurnStartSeq !== null || boundary.lastTurn > 0` 时抛 `agent-preset/locked`。也就是说**主会话一旦开始工作，自己的 preset 选择就被 runtime 锁死**，不存在「父会话切换 preset 后 child 冷恢复被带偏」这个场景。
- child 创建与冷恢复统一走 `composeFrom(childCtx, parentCtx)`：不是复制父创建时刻的一份快照，而是直接绑定到父此刻实际在用的 standing composition。因为父自己不可切换，这个绑定在 Host 不重启期间是稳定的。
- 唯一残留的理论风险是运维操作级别的：Host 重启期间有人直接在磁盘上编辑了该 preset 的 `.cordis.yml` 文件内容（不是切换 id），下次 mount 会读到新一代 composition。但这对父会话自己同样成立，不是 child 独有的问题，也不是「child 该不该用独立上下文」要解决的范畴。

结论：本期不需要为此单独加固，也不依赖旧 change 里记录的那个 compat patch（`compat-implementation-plan.md`）。该 patch 面向的是「即使以后有人改了预设文件，child 也应该继续用自己创建时那份，与父解耦」——这是面向未来的加固项，不是当前 bug 修复，留给后续 runtime change 视需要再做。

旧审计笔记的原始措辞保留不改（作为历史记录），但引用它的结论时以本节复核为准。

### D4. 不引入上下文模式标记（所有者 2026-03-23 明确决定）

最初设计打算给 locus 记录加一个可选模式字段（`fork-prefix-v1` / `independent-v1` / `unknown`），让数据库里能区分新旧两种 child。实施时发现：要让这个字段真正被写入，需要把「独立性是否被证明」这个事实从 `child.ts` 的核验结果，一路向上传递穿过 `index.ts` 的创建入口、`dsh-port.ts` 的 `LocusDshPort` 接口、`controller.ts` 的 6 处 `createChildSession()` 调用点、`controller-persistence-adapter.ts` 的 `projectProvisioningCommit()`，才能到达 `buildLocusRecord()`。这与「只加一个字段」的预期规模明显不对等。

所有者复核后明确决定：**不要这个标记，也不做新旧模式共存的历史兼容层**。理由：

- 它只是可观测性（让人从数据里看出哪些 child 是新方式建的），不影响独立性本身是否生效——D1/D2 已经让新建/重建的 child 真正不再 fork、能力不可证明时真正拒绝创建，这两件事与该字段完全无关。
- 旧 fork child 不会被本 change 的代码路径重新创建，所以它们的行为和历史天然不受影响，不需要用一个字段去"保护"它们不被静默改造。
- 如果后续实际需要区分新旧 child（例如做管理面展示），应作为独立的小 change，届时按需决定接入哪一层，而不是现在预先猜测。

因此本 change 不改 `spec.ts` schema、不改 domain 版本、不改 `controller.ts`/`dsh-port.ts`/`index.ts` 的创建编排链路，只改 `child.ts` 的 provider 默认值与创建前能力核验。

### D5. 公共事实本期由「问父」替代

child 缺少背景时通过原生 `send_message` 询问主会话；主会话若需要，再自行询问其它 child。这条链路已在前言接线，且不需要新的持久层或新的授权面。

代价：跨 child 的事实不共享、不版本化，父会话可能成为瓶颈。这是所有者明确接受的本期取舍，不是遗漏。

## Risks / Trade-offs

- [child 失去父背景后答非所问] → 前言已指导按需问父；本期以真实答疑群验收判断是否够用，不预先加共享层。
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
- 若后续确实需要区分新旧 child（如管理面展示），作为独立 change 再设计接入层，不在本 change 范围内预留。
