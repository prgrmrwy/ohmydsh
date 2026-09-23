## Why

`packages/dsh-pet/compat/` 当前以 **2 个 patch / 72 hunks / 29 个上游源文件 / 7 个上游包** 的规模替换整个长期 `dsh web` Host 运行体（`hostRuntimeCompatibility: pet-unified-locus-v1`），在磁盘上物化为约 3.9 GB 构建状态与两套独立老化的 overlay 机制。

2026-09 的逐条审计（对照 `@deepseek-ai/dsh-subagent@0.1.2-rc.1` 与 `@deepseek-ai/dsh-agent-presets@0.1.2-rc.1` 的**已发布类型声明**，以及 `dsh-v0.1.5-rc.2` 的未打补丁源码）证明：**五项"官方缺失能力"里只有一项成立**，其余四项分别是三次**未经核验的误判**与一次**架构选择失误**。

| 能力 | 当时判断 | 核验结果 | 证据 |
|---|---|---|---|
| 调用方预留 child 身份 | 官方无 → 写 `createIdleContinuable`（~110 行） | **0.1.2 就有** | `continuation.d.ts:71` `readonly childId?: SessionId`，文档逐字写明 "supplying one lets a durable parent record provisioning before child materialization **without a second identity handshake**" |
| `toolFilter` + 冷恢复持久化 | 官方无 → patch | **0.1.2 就有** | `types.d.ts:139` + `descriptor.d.ts:78`（含 `allow`/`deny` 校验） |
| 父改 preset 不波及存活子代 | 官方无 → 写 `contextMode:'independent-v1'` | **0.1.2 就有** | `agent-presets` `index.d.ts:206` "**It is a bind, not a mount**: the child gets that exact instance"，0.1.2 与 0.1.5 文档逐字相同 |
| Storage 原子事务 | 官方无 → patch 4 个包 / 32 hunks | 官方确无，**但可插件级自持** | Pet 仅用 `domain.table()`/`global`/`transaction()` 三个 API；`storage-sqlite` 已是 Pet 自有 `dependency`；`domain/changed` 是**官方**广播（`storage-domain/lib/index.js:286`）且 Pet 只用它监听 **workspace 域** |
| `settlementNotice:'silent'` | 官方无 | **成立，且无零-patch 替代** | 见下 |

`settlementNotice` 的必要性已按四条路径逐一排除替代方案：`notifySettlement` 在父非 idle 时走 `parent.steer(message)`（`continuation-activation.ts:833`），而 `steer` 的官方语义是 "a running driver consumes it **at its next step boundary**" —— locus 的父是**用户正在使用的主会话**（`pet-locus-collaboration` 规范：一个主会话可关联多个 locus），因此每个现场的子代结算都会在主会话最近一个步骤边界插入并打断其工作。

**本 change 的动机不是"删补丁"，而是消除不可辩护的宿主耦合面**：把 compat 收敛到唯一经过正面举证的 seam，使每次 DSH 版本跳变的重新推导成本从"一次完整 OpenSpec 大改"降到"确认一处早返回是否仍然存在"。

同时修复一个**现网正确性缺陷**：部署 profile 的四个 storage overlay 仍停在 `0.1.2-rc.1-locus-atomic.1`（upstreamBase `a66e4702…`），而 launcher 根已是 `0.1.5-rc.2-locus-atomic.2`（`fb2c4b9e…`）。`compatDependencies` 只按名称+路径+内容 hash 判定新鲜度，**不校验 `dsh_compat.upstreamBase`**，而 launcher 对自己那棵树恰恰做了该校验（`build-launcher.cjs:201-215`），因此该漂移可以长期静默存在。

## What Changes

- **退回三项误判 seam，改用官方既有 API**：以 `startContinuable({ childId })` 取代 `createIdleContinuable`；以官方 `toolFilter` + descriptor 持久化取代自建持久化；以官方 `composeFrom` 的 bind 语义取代 `contextMode:'independent-v1'`。
- **Storage 改为插件级自持**：Pet 在 `$DSH_HOME/plugins/dsh-pet/` 自持 SQLite 句柄并用原生 `BEGIN IMMEDIATE`/`COMMIT` 与 `PRAGMA locking_mode = EXCLUSIVE` 提供同等的全有或全无与介质独占保证；删除 `storage-atomic.patch`（32 hunks / 4 个上游包）与 `dsh.yaml` 的 `compatDependencies` 条目。`domain/changed` 对 workspace 域的订阅保持不变。
- **保留唯一经举证的 seam**：`settlement-notice.patch` 收敛为对 `notifySettlement` 的单一早返回（或等价的"父非 idle 时改用 `inject` 而非 `steer`"），仅作用 `@deepseek-ai/dsh-subagent` 一个上游包。
- **移除已禁用的净负债**：`isolateQueuedTurnClaim` 相关 patch、`agent-artifacts/` 构建与 `overrideRuntimeAgent` 开关一并删除（当前 `build-launcher.cjs:54` 已为 `false`，因 npm arborist 崩溃从未启用）。
- **`compatDependencies` 校验补强**：部署侧按 `dsh_compat.upstreamBase` 与源产物比对，不一致时 fail closed；与 launcher 既有校验对齐。若 storage 自持完成，该机制随之退役。
- **`removeWhen` 改为可验证措辞**：明确记录"该需求尚未向上游报告；上游不接受外部 PR，唯一通道是 Discussions"，不再表述为存在自动到期日的承诺。
- **新增 compat 准入规则**：写入 compat patch 前必须出示"官方 API 不支持"的**正面证据**（引用具体 `.d.ts` 行号或文档段落）；搜索无结果不构成证据。
- **NON-BREAKING（用户可见行为）**：Pet unified locus 的对外语义、安全面与持久化数据保持不变。`attestLocusComposition` 与 `dsh-pet-executor` preset **必须原样保留** —— 它们（而非任何 patch）才是 `subagent` 越过 `toolFilter` 那次生产事故的实际护栏。

## Capabilities

### New Capabilities

- `pet-compat-minimization`：compat patch 的准入举证标准、最小 seam 判定、退役条件与部署侧 overlay 新鲜度校验。

### Modified Capabilities

- `dsh-runtime-provisioning`：compatibility runtime 增加"最小性"与"正面举证"要求；补充部署 overlay 与源产物的 provenance 一致性校验，使跨版本族重新证明的范围与成本可界定。
- `dsh-pet`：Pet 持久化由宿主 `storage-domain` 事务改为插件自持介质，保持同等原子性与独占语义；locus child 创建改用官方 subagent API 表达同一不变量。

## Impact

- **代码**：`packages/dsh-pet/compat/subagent/`（删 `storage-atomic.patch`、收敛 `settlement-notice.patch`、删 `build-storage.mjs` 与 agent-artifacts 构建路径）、`packages/dsh-pet/src/host/locus/child.ts`（创建路径与能力 marker 门禁）、四个 store 类的事务门面、`scripts/sync.mjs` 的 `compatDependencies` 校验、`dsh.yaml`。
- **不变量**：`hostRuntimeCompatibility` 机制**保留**（仍有一个上游包需改实现），继续 fail closed、继续要求 `supportedDshVersion` 与 `dshVersion` 精确相等。Pet 的 SQLite 数据文件位置、域名 `dsh_pet` 与离线迁移规则不变。
- **数据与安全**：storage 自持涉及介质所有权变更，实施前按既有规则做一致性备份；`PRAGMA locking_mode = EXCLUSIVE` 导致的"必须停机迁移"约束继续成立（`scripts/migrate-state-version.mjs`）。不放宽任何 fail-closed 门禁。
- **上游**：`settlementNotice` 需求将首次向上游 Discussions 报告（上游 Issues 已关闭、不收外部 PR）。已知相关线索为 #5360（方向相反：要求在 `running→waiting` 时**增加**父可见通知），本需求为父非 idle 时**避免 steer 打断**，两者同属 settlement 投递策略，应在该线索基础上单独提出。
- **并行 change**：与 `pet-locus-independent-agent-inquiries` 共享 `src/host/locus/**` 与 compat 文件，必须 single writer；本 change 只迁移 runtime seam，不改其产品语义与 G1–G5 判据。该 change 的 `proposal.md` 原本即要求"所需 Host 接缝**先做可失败核验**"，本 change 是对该前置步骤的补做。
- **非目标**：不重新设计 Pet 产品形态；不删除 `hostRuntimeCompatibility` 机制；不追新 DSH 版本；不以禁用 Pet 功能换取 patch 减少。
