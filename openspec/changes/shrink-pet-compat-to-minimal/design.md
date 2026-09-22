## Context

见 `proposal.md` 的举证表。本设计只处理"如何安全收敛"，不重述结论。

当前状态（2026-09 实测）：

- `compat/subagent/` 有 2 个 patch、72 hunks、29 个上游源文件、7 个上游包；磁盘约 3.9 GB（两份 1.7 GB 上游克隆 + 561 MB launcher 装机）。
- `hostRuntimeCompatibility: pet-unified-locus-v1` 使**整个**长期 `dsh web` Host 运行在 Pet 私有依赖根上；`scripts/lib/dsh-host-runtime.mjs:57` 硬编码只有 `dsh-pet` 一个合法 owner。
- compatibility 产物经**两条互不相关的通道**落地：subagent/agent overlay 只在 `.launcher`（fingerprint 门禁、自验证），storage overlay 额外经 `compatDependencies` 投影进部署 profile（内容 hash 门禁、无能力复验）。两者新鲜度独立 —— 现网实测 profile 侧仍是 `0.1.2-rc.1-locus-atomic.1`（upstreamBase `a66e4702…`），launcher 侧已是 `0.1.5-rc.2-locus-atomic.2`（`fb2c4b9e…`）。
- Pet 消费宿主 Domain 的 API 面很小：`domain.table()` 60 处、`domain.global` 5 处、`domain.transaction()` 12 处；`@deepseek-ai/dsh-storage-sqlite` 已是 Pet 自有 `dependency`（非 peer）。
- `ctx.on('domain/changed')` 只有 1 处（`src/host/archive.ts:276`），且只监听 **workspace 域**（官方会话归档），与 Pet 自身数据存放位置无关。

关键约束：本 change 与 `pet-locus-independent-agent-inquiries` 共享 `src/host/locus/**` 与 compat 文件，必须 single writer；本 change 只迁移 runtime seam，不改其产品语义与 G1–G5 判据。

## Goals / Non-Goals

**Goals:**

- 把 compat 收敛到唯一经正面证据证明成立的 seam（`settlementNotice`），使跨版本重新推导成本从"一次完整 OpenSpec 大改"降到"确认一处早返回是否仍存在"。
- 在不改变 Pet 对外语义、安全面与持久化数据的前提下完成迁移。
- 消除部署 profile 与源产物之间可静默存在的 provenance 漂移。
- 让"先核验官方 API"从一句规范文字变成有产出物、可检查的步骤。

**Non-Goals:**

- 不删除 `hostRuntimeCompatibility` 机制（仍有一个上游包需改实现）。
- 不重新设计 Pet 产品形态、locus 模型或 inquiry 语义。
- 不追新 DSH 版本，不改 `dshVersion`。
- 不以禁用 Pet 功能换取 patch 减少。
- 不在本 change 内实现上游修复或等待上游回应。

## Decisions

### D1. 分三批独立迁移，每批自带准入与回滚

批次顺序按"证据强度 × 解耦度"排列，任一批失败不阻塞其它批：

1. **批 A — 移除未启用负债**：`isolateQueuedTurnClaim` 相关 patch、`agent-artifacts/` 构建、`overrideRuntimeAgent` 开关。该 seam 因 npm arborist 崩溃从未在生产启用（`build-launcher.cjs:54` 为 `false`），移除不改变任何运行时行为。
2. **批 B — storage 自持**：删 `storage-atomic.patch`（32 hunks / 4 包）与 `compatDependencies`，Pet 在自有介质上提供同等保证。
3. **批 C — 三项误判 seam 退回官方 API**：`spec.childId`、官方 `toolFilter`、官方 `composeFrom`。

批 A 先行是因为它零风险且立即缩小后续批次的构建面。批 B 与批 C 相互独立（一个在 storage 包，一个在 subagent 包），可并行准备但应分别物化、分别验收。

替代方案是一次性重写整个 compat，被拒绝：失败时无法区分是 storage、subagent 还是 launcher 构建导致，正是上一轮 0.1.5 升级付出过的代价。

### D2. 每个 seam 的移除以"官方 API 等价证明"为准入，不以"测试通过"为准入

批 B/C 的每一项在动代码前 MUST 先完成一次**可失败的核验**，产出物写入 `checking/`：

- `spec.childId`：证明 Pet 的 `prepareContinuable → startContinuable` 调用链上该字段真实可用，且传入值与返回 `childId` 相等；类型声明支持不等于该路径无其它约束。
- 官方 `toolFilter`：证明限制在创建与冷恢复两条路径上都生效，且 descriptor 往返保持。
- 官方 `composeFrom`：证明在 `dsh-pet-executor` 这一**自定义 preset** 下 bind 语义一致 —— 父在 child 存活期间切换 preset，child 组合不变。
- storage 自持：证明跨表写入全有或全无、第二个进程无法并发写入、以及失败时 fail closed。

核验失败时该项**保留 patch**并记录失败证据，不得因"测试都过了"推定可移除。这条是对本 change 所针对的原始失误（跳过核验直接写 patch）的直接对冲。

替代方案是先改代码再跑既有测试，被拒绝：既有测试是针对 patch 后行为写的，对"官方 API 是否等价"没有判别力。

### D3. storage 自持保留 Domain 的 API 形状，只替换实现

Pet 内部提供一个窄门面，对外暴露与现用一致的 `table()` / `global` / `transaction()` 形状，底层直接持有 SQLite 句柄并用原生 `BEGIN IMMEDIATE` / `COMMIT` 与 `PRAGMA locking_mode = EXCLUSIVE`。

这样做是因为：四个 store 类共 12 处事务调用与 60 处 `table()` 调用，保持形状可把改动集中在门面一处，store 层与其测试基本不动；同时 `supportsTransaction` 这类能力探测可以保留为恒真，fail-closed 分支不需要删除（它们在介质异常时仍应生效）。

`domain/changed` 对 workspace 域的订阅**完全不动** —— 它是官方广播，与 Pet 自有介质无关。

替代方案是趁机重构 store 层直接用 SQL，被拒绝：把"换实现"和"改设计"混在一次变更里，失败时不可归因。

### D4. `hostRuntimeCompatibility` 保留，但其内容与成本必须可辩护

只要还有一个上游包需改实现，换 Host 依赖根这条链就无法消除；因此本 change 不追求删除该机制，而是让它承载的东西缩到最小：1 个上游包、1 个 patch、1 处改动。

保留后的不变量不放宽：继续 fail closed、继续要求 `supportedDshVersion` 与 `dshVersion` 精确相等、继续验证唯一依赖实例与能力 marker。能力 marker 集合随 seam 收敛而缩小（从 5 个降到 1 个），但 marker 机制本身保留 —— 其存在理由（旧运行体会静默忽略未知选项）未改变。

`removeWhen` 改为可验证措辞，并显式记录"该需求尚未向上游报告；上游不接受外部 PR，唯一通道是 Discussions"。

### D5. 部署侧补 provenance 校验，且该校验独立于批 B 是否完成

`compatDependencies` 的新鲜度判定增加 `dsh_compat.upstreamBase` 与 patch 身份比对，不一致即 fail closed。`build-launcher.cjs:201-215` 已对自己那棵树做同类校验，此处与之对齐。

该校验**先于**批 B 落地：即便 storage 自持最终未通过核验、`compatDependencies` 得以保留，这个静默漂移也必须被堵住。批 B 完成后该机制随之退役，校验代码一并移除。

### D6. 安全护栏与 patch 解耦，迁移时原样保留

`attestLocusComposition`（读 child 真实工具面，不符拒绝发布）与 `dsh-pet-executor` preset（不加载 `skill-filesystem`）是 Pet 自有代码，**不在任何 patch 内**。

历史上 `subagent` 越过 `toolFilter` 的生产事故（`composition.ts:71` 记录）发生在 patch 已上线之后，说明该 patch 并未防住它；实际护栏是上述两者。因此批 C 移除 `independent-v1` 时 MUST NOT 连带调整这两处，退化风险最高的正是"反正 independent-v1 没了，顺手简化 attest"。

规范层面已把该要求固化为 `dsh-pet` 的"child 实际工具面必须发布前核验"场景。

## Risks / Trade-offs

- **[核验结论基于源码阅读，未经运行时证实]** → D2 把每项核验列为动代码前的准入，失败即保留该 patch；不允许以源码阅读结论直接跳到实现。
- **[storage 自持涉及介质所有权变更，失败可能损坏 Pet 数据]** → 实施前按既有规则做一致性备份并校验；`PRAGMA locking_mode = EXCLUSIVE` 导致的"必须停机迁移"约束继续成立（`scripts/migrate-state-version.mjs`）；回滚先停 writer 再恢复数据与代码。
- **[移除 `independent-v1` 时连带削弱安全护栏]** → D6 明确 `attestLocusComposition` 与 executor preset 不在改动范围；规范层面已固化该核验要求，删除它会使 spec 失败。
- **[批 C 移除的三项之间存在隐式耦合]** → 三项同属 child 创建路径，作为一批物化但各自独立核验；任一核验失败则该项保留，其余仍可推进。
- **[与并行 inquiry change 的文件冲突]** → 共享区域 single writer；本 change 只动 runtime seam，不改 inquiry 产品语义与任务状态；合入前 rebase 后复跑 Pet 全量。
- **[`settlementNotice` 长期自持无到期日]** → 接受，并在 `removeWhen` 中如实记录；同时首次向上游报告该需求，把"从未报告"这一事实消除。
- **[收敛后 compat 仍保留，读者可能误以为可以随手加回 seam]** → 新增 `pet-compat-minimization` 能力，把准入举证标准写进规范，使新增 seam 需要显式证据而非默认允许。

## Migration Plan

1. 冻结基线：记录当前 compat 身份（两个 patch SHA、launcher fingerprint、两条通道各自的产物 provenance）与 Pet 能力矩阵。
2. 落地 D5 的部署侧 provenance 校验，先修复现网已存在的 storage overlay 漂移。
3. 批 A：移除未启用的 `isolateQueuedTurnClaim` seam 与 agent-artifacts 构建路径；验证 launcher 仍能构建、能力 marker 集合按预期缩小。
4. 批 B：完成 storage 自持核验 → 数据一致性备份 → 切换介质门面 → 删 patch 与 `compatDependencies` → 验证原子性、独占性与 fail-closed，以及 workspace `domain/changed` 订阅未受影响。
5. 批 C：完成三项官方 API 核验 → 改 child 创建路径 → 删对应 patch hunks → 验证创建、冷恢复、父 preset 切换隔离，以及 `attestLocusComposition` 行为未变。
6. 收敛 compat：`settlement-notice.patch` 只保留一处改动，重新固定 provenance，更新能力 marker 与 `removeWhen`。
7. 全量回归：Pet 测试套件、根测试、`sync` 两次幂等、启动清单、真实 locus 端到端。
8. 向上游 Discussions 报告 `settlementNotice` 需求，回填编号到 `proposal.md` 与 `dsh.yaml`。
9. 回滚：任一批失败则恢复该批的 patch 与产物；涉及 storage 介质时先停 writer 再恢复数据备份，不让新旧实现共享同一介质。

## Open Questions

无。

`settlementNotice` 的形态已定为**早返回不发（silent）**。曾考虑改为"父非 idle 时用 `inject` 替代 `steer`"，已排除：`inject` 与 `steer` 的唯一差别是 `wakeup` 标志（`agent-loop/src/agent.ts:141-148`，两者目标边界同为 `next-step`），因此 `inject` 只消除额外唤醒，消息仍会在最近一个 step 边界进入父正在进行的轮次。本 change 要求的是父的进行中工作完全不受影响，`inject` 不满足。

两者改动上游源码的性质与 compat 链条代价相同（见 D4），故选择语义上真正满足要求的那个，而非表面改动更小的那个。
