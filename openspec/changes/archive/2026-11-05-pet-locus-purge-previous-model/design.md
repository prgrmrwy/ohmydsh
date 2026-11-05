## Context

持久层 v18 只新增了 `locus_mains` 表，旧行没有改写。判定"旧模型行"的依据是：父会话（`loci.parentSessionId`）在 `locus_mains` 里没有记录。这个判定在代码里分散在两层模型（下称 L2）的多处分支中：

- `index.ts:2056-2061`
- `resolution.ts:315`
- `admission.ts:205-232`
- `serviceability.ts:171`
- `controller.ts`：`previousModelRow` :1820、`establishFromPreviousModelLocked` :1874、`classify` :2310-2333
- `persistence.ts`：`isLegacyLocus` :2971-2979，regeneration 的 `previousModel` :3002/:3090/:3103，`supersededLegacy` :4679-4726
- `controller-persistence-adapter.ts`：:111-114、:355、:413-424
- `reconcile.ts:109-117`
- `tool-tier-mutation.ts:143-146`
- `control.ts:216-217`
- `management.ts:944-948`
- `childComposition` 的 `safe-v1`/`safe-v2` 类型：`aggregate.ts:40/326/377`、`composition.ts:212`、`context.ts:54/545`、`wire.ts:377`

更早一代的 `chat_bindings` 退休机制（下称 L1）是另一条独立的路径，这次保留不动。涉及：`retirement.ts:114-141`、`admission.ts:219-229` 的 `LegacyRetirementProbe`、`controller.rebuildLegacyEndpoint`（:945-980）、`index.ts:2267-2274`，以及 `tools.ts:269`、`context-tool.ts:212` 中的 `source === 'legacy'`。

现有机制里有三点和本次相关：

1. **离线脚本** `scripts/migrate-state-version.mjs`：Host 以 `locking_mode = EXCLUSIVE` 独占数据库，所以迁移必须在停机时由独立的 `node:sqlite` 脚本完成。版本号不匹配时，Pet 会进入 degraded，并提示运行这个脚本（`migration-guidance.ts:12-17`）。
2. **Domain 打开时逐行校验**：`storageDomain.open` 会按 schema 校验每一行，任何一行不合法就抛出带 key 的 `invalid-record`（`index.ts:314`）。抛出后经 degraded 通道报告（`index.ts:255-271`）。
3. **启动对账**：`reconcileStartup`（`persistence.ts:3285`）在开始接收消息之前运行（`index.ts:2766-2793`），失败时 Pet 进入 degraded，并且不再启动 intake。它会按剩余 locus 行重新推导全部索引并写回（`:3319-3325`、`:3662-3668`）。推导时，目标已不存在的 default-qa 指针会被丢弃（`:4810-4813`）。

现网数据（线上库热拷贝）：

| 表 | 总数 | 涉及旧行 | 状态 |
|---|---|---|---|
| `loci` | 76 | 67（旧模型行） | — |
| 投递 | 129 | 107 | 全部终态 |
| 操作 | 875 | 709 | 全部 `committed` / `compensated` |
| 权限审计 | 15 | 3 | — |
| 切换通知 | 0 | — | — |

`ledger_item` 16 条、`inquiries` 8 条引用了旧 locus id，但它们的读取方不会去解引用 loci 行，详见 D5。

## Goals / Non-Goals

**Goals：**
- 用一次可回退（有备份）的离线迁移，删除旧模型 locus 行及其直接附属数据，并保证迁移后的库一定能被 v19 打开。
- v19 只承载三层模型的行，违规时 Pet 未就绪（fail closed）。
- 删除 L2 分支。

**Non-Goals：**
- L1 路径，以及 `chat_bindings`、`invocation_channel`、`ledger_item`、`inquiries` 的数据；
- 字段改名与结构调整（属于 change B+C）；
- 部署、重启、对线上库执行迁移。

## Decisions

### D1 判定依据只有一条：父会话在 `locus_mains` 里有没有记录

旧模型行 = `parentSessionId ∉ locus_mains`，这些行的 id 集合记为 L。`childComposition` 只参与保留行的合规检查（D3），不参与旧行判定。

被否决的备选：按 `childComposition !== 'tier3'` 判定。`not-created` 的三层行没有 marker，会被误判成旧行。

### D2 只删 locus 行和直接引用它的行；索引由 Host 打开后重新推导

删除范围（全部按记录值中的字段精确匹配，不按 key 前缀）：

| 表 | 删除条件 |
|---|---|
| `loci` | id ∈ L |
| `locus_deliveries` | `locusId` ∈ L |
| `locus_switch_notices` | `locusId` ∈ L |
| `locus_permission_audit` | `locusId` ∈ L |
| `locus_operations` | `locusId`、`oldLocusId`、`newLocusId` 任一 ∈ L |

脚本不碰 `locus_indexes`。索引的唯一推导逻辑是 `deriveIndexes`；启动对账本来就会按剩余行重推导并写回，并丢弃指向已删除行的 default-qa 指针（`persistence.ts:3319-3325`、`:4810-4813`）。

但启动对账（`index.ts:2766`）之前，`agent/created`（`index.ts:1302`）已经注册，冷恢复带待应用权限的子会话会经 `resolvePendingApplication` → `getCurrentLocus`（`persistence.ts:1643`）读索引。因此把"按剩余行重推导并写回索引"这一步从 `reconcileStartup` 中抽出为 `LocusRepository.repairDerivedIndexes()`，在构造 locus 持久层之后（`index.ts:353` 一带）、注册任何读索引的回调之前调用一次；`reconcileStartup` 继续调用同一方法。这一步只改派生数据，不需要 compensator，可以安全提前。由 spec 场景「启动早期的冷恢复不读到悬空索引」证明。

被否决的备选：
- 在脚本里过滤或重新推导索引：需要维护两份逻辑，而且第 1 轮已证明过滤结果不等价。
- 写 JSON 存档：数据库备份已经包含存档的全部内容。

### D3 拒绝条件：要求全库没有在途工作，且保留行满足 v19 条件

满足以下任一条件时，脚本拒绝迁移，以非零码退出并列出违规行。预检阶段（`--dry-run`、未确认运行）的拒绝不产生任何物理写入；`--yes` 锁内复查的拒绝不做 checkpoint、不写备份、不改任何行与版本号，只保证语义不变，取锁与打开连接本身的 SQLite 物理副作用不在保证之内（见 D4）：

1. **全库**存在状态不在 `{settled, failed, replied, no-reply, expired, unknown-terminal}` 内的投递。这个集合与 `delivery.ts:624` 的 `TERMINAL_STATUSES` 相同，由测试比对。
2. **全库**存在 phase 不是 `committed` 或 `compensated` 的操作。`failed` 也拒绝，因为它可能带着补偿债。之所以不再判断"是否与 L 相关"：还没发布的 provisioning 操作上没有任何 locus id（`persistence.ts:525-574`），无法判断它属于哪个入口；而离线迁移本来就要求系统处于静止状态。
3. 删除 L 之后，保留集合违反 v19 加载条件。脚本不另写一份子集，而是直接调用 Host 的同一份规则：
   - 逐行用 v19 的 `petLocusRecord` schema 解析（marker 若存在为 `tier3`、`active` 必须带 marker、其余既有形状约束）；
   - 对整个保留集合运行 `normalizeRecord` 与 `assertLocusSet`（`parentLocusId` 父行存在、同一入口代际相邻连续、入口与子会话唯一等）；
   - 每行父会话在 `locus_mains` 中。

   为此 `persistence.ts` 导出一个纯函数 `validateLocusSetForStorage(rows, mainIds)`，包含上面后两项；脚本用 `new URL('../lib/...', import.meta.url)` 相对自身位置动态导入它和 `lib/host/spec.js`（`package.json` `files` 已含 `lib` 与该脚本；经 `.bin` 符号链接调用时 Node 按真实路径解析 `import.meta.url`）。导入只加载模块，不打开 Domain。这些模块在运行时会加载 `zod`（`spec.ts:11`）和 `@deepseek-ai/dsh-storage-domain`；`zod` 目前只在 `devDependencies`，本机能运行只是因为 profile 中恰好有提升安装的副本，所以把 `zod` 移到 `dependencies` 并更新 lock。这同时修正了 Host 自身对它的未声明依赖。脚本放行因此与 Host 能打开等价，不存在"脚本规则是子集"的缝隙。

现网条件 1、2 的违规数都是 0。

拒绝时的输出须说明处理方式：在途工作等它结束；无法自行结束的恢复债（`needs-recovery`、`failed` 操作、停在非终态的投递，见 `persistence.ts:3633-3646`）须先用当前版本 Host 清理或人工处理，再迁移。停机本身不保证没有这类债。

### D4 脚本执行顺序

1. 预检：只读打开，计算 L，按 D3 检查。`--dry-run` 和未确认运行到这一步为止，打印 L 的 id 和入口清单、各表计数，或拒绝原因；不做 checkpoint，不产生任何物理写入。
2. `--yes`：取独占锁，并一直持有到事务提交。锁内重新读取版本戳、表结构与数据，重新计算 L，完整执行 D3：锁内已是 19 则报告无需迁移、以 0 退出；版本不受支持则拒绝；D3 不通过则拒绝。锁内拒绝时不做 checkpoint、不写备份、不改任何行。
3. 锁内判定通过：做 WAL checkpoint，然后写备份 `state.sqlite.v<N>.bak-<ts>`，它是 checkpoint 之后的完整快照。备份写在任何语义改动之前，包括版本 ≤17 时要做的 DDL。
4. 在单个事务内依次执行：版本 ≤17 时 `CREATE TABLE IF NOT EXISTS locus_mains`（此时它为空，所以 L 就是全部 locus 行）；按 D2 删除；把版本号改为 19。任何错误都回滚。提交后释放锁。

所有检查都在提交前完成，提交之后不再做二次校验。提交后才发现的问题已经无法回滚，所以提交前的 D3 校验就是唯一的检查点。

已是 19 的库直接报告无需迁移，以 0 退出。v19 库的内容如果出错，只可能来自手工改库；这种情况由 D6 的启动诊断报告，处理方式是恢复备份，脚本不提供修复命令。

### D5 不在范围内的表：仍可读取的依据

- `ledger_item`：owner-ledger 的 legacy 列表按 parent 读行并直接投影，不查询 loci（`ledger/owner-ledger.ts:41-42`、`ledger/store.ts:176-187`）。
- 已退休询问：按 `circleParentSessionId` 过滤，不查询 locus（`inquiry/retired-history.ts:5-18`）。
- collab 的 `ext.pet.entry` 是 endpoint 哈希，不是行 id（`ledger/track.ts:65-72`）。
- pending 状态存在 locus 行内，staging、history cursor、media spool 都不落盘，或者在启动时清理。

这些结论由 spec 场景「非 locus 表不受影响且仍可读取」做回归测试。

### D6 v19 的校验放在已有的两个检查点

- `spec.ts`：`childComposition` 的枚举收窄为 `['tier3']`；`superRefine` 增加"`active` 必须带 marker"。从未创建 child 的行（`not-created`，以及它之后变成的 `stopped`/`invalid`/`retired`，见 `aggregate.ts:598-617`）允许没有 marker，不补写伪造的 `tier3`。违规行会让 `storageDomain.open` 抛出带 key 的 `invalid-record`，Pet 经现有 degraded 通道报告。不新增诊断分类，也不提示运行脚本；v19 内容错误的处理方式是恢复备份或人工排查。版本不匹配仍沿用现有的脚本指引。
- `reconcileStartup` 开头增加一项检查：每条 locus 行的父会话都必须在 `locus_mains` 中，违规时抛出包含行 id 的错误，由 `lifecycle.contain` 报为 degraded，并且不启动 intake。这里读取的是已持久化的 `locus_mains`，此时还没有任何事务在暂存新的 main。
- 运行期写入不增加跨表校验。L2 代码删除后，没有任何路径会写出无配对的行；需要配对的读取点（adapter、resolution）查不到配对时直接抛错。

被否决的备选：在 `assertLocusSet` 的每次写入时检查配对。首次建立入口和迁移到新 M 时，新 main 只存在于同一事务的暂存数据里（`persistence.ts:641-663/766`、`:3024-3041/3115`），每个写入口都得构造"已持久化 + 暂存"的视图。这是第 1 轮评审第 1 项的来源，改动面最大，而它要防的情况在删掉 L2 代码之后已经不存在了。

### D7 L2 删除清单

1. `controller.ts`：`previousModelRow`、`establishFromPreviousModelLocked`、`LEGACY_RETIRED_*`、`classify` 中"缺少配对 → legacy"的分支，以及 `ensureGroup`、`ensureTopic`、`ensureGroupLocked`、`repairEntryLocked` 中对应的分支；删除 `LocusRegenerationCommit.previousModel`。
2. `persistence.ts`：`isLegacyLocus`、regeneration 的 `previousModel`、`supersededLegacy`。
3. `serviceability.ts`：`legacy` 输入和 `previous-model` 处置。
4. `resolution.ts:315` 一带和 `admission.ts:205-232` 中 L2 的 `legacy`。`LegacyRetirementProbe`（L1）保留。
5. `index.ts:2056-2061`：不再返回 `legacy: true`。
6. `controller-persistence-adapter.ts`：:111-114 的 default-QA 旧 parent 回退、:355 的 group 投影回退、:420 的 `previousModel` 投影。区分两种情况：按干活主会话查找（如 `findDefaultQa`）时没有 active locus 主会话，属于"未建立"，返回 `undefined`（`controller.createOrOpenDefaultQa` 在 :855 先查找、:883 才建 M）；已读到一条 locus 行而其父会话缺配对，才抛错。
7. `reconcile.ts:109-117` 中"静默跳过旧 marker"的分支。
8. `tool-tier-mutation.ts:143-146`、`control.ts:216-217`、`management.ts:944-948` 中"已退休，下一条 at 会建立"的分支。
9. `aggregate.ts`、`composition.ts`、`context.ts`、`wire.ts`：类型收窄为 `tier3`。
10. 测试：
    - 断言 L2 行为的测试删除或改写，verify 时逐条列出它们对应的 REMOVED requirement 或改写过的场景；
    - 普通测试 fixture 中带 `safe-v1`/`safe-v2` 或 `active` 缺 marker 的，改为合法的 `tier3` 加真实配对，保留原测试目的；只修已有 helper 和受影响的调用点，不新增 fixture 框架；
    - 非法行被拒的测试从原始介质（直接写 SQLite 或 unknown 输入）播种，不通过类型断言把旧 marker 塞回正常写入路径；
    - L1 相关测试保留，不按 `legacy` 字符串整体删除。

## Risks / Trade-offs

- **数据删除不可逆。** 兜底是备份。回退步骤：停止 DSH，恢复备份，部署旧版本。迁移之后产生的状态会随之丢失。
- **多台机器。** 每台都要先停机再跑脚本。没跑脚本的机器会因为版本不匹配而处于未就绪状态，并提示运行脚本（现有机制）。
- **所有者停过的旧入口会重新可用。** 所有者已确认可以接受。
- **L1 标记仍然有效。** 同时有 `chat_bindings` 标记的入口，仍需要所有者显式重建。这是现状，spec 场景已固定这一行为。
- **spec 场景名。** OpenSpec 的 MODIFIED 要求保留原场景名，所以「safe-v1 行继续服务」「升级前的 legacy child 不可恢复服务」两个名字暂时不变，内容已改。B+C 中再清理。

## Migration Plan

1. 合入并执行 `dsh build` 之后：`dsh stop` → `dsh-pet-migrate-state --dry-run`（核对 L 清单）→ `--yes` → `dsh`。
2. 确认日志中出现 `[dsh-pet] ready`，且管理面只剩三层入口。
3. 回退：停止 DSH，恢复 `.v18.bak-*`，部署上一版本。

## Open Questions

无。
