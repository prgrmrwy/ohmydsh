## Why

三层模型上线（持久层 v18）时，旧的两层模型 locus 行没有迁移，而是留在持久层里，读取时再判定为"旧模型"并退休（spec「旧模型入口按退休规则处理」）。结果是同一批字段带着两种含义（`parentSessionId` 在旧行里指干活主会话，在三层行里指 locus 主会话；`childComposition` 有 `safe-v1`/`safe-v2`/`tier3` 三种），代码里也保留了一整套旧模型分支：`previousModelRow`、`establishFromPreviousModelLocked`、`serviceability` 的 `previous-model` 处置、`resolution`/`admission` 的 legacy 判定、`assertLocusSet` 的 `supersededLegacy`。这些分支增加了后续字段重整（change B+C）的复杂度，前两轮 `pet-topic-bind-without-group` 评审中也有多条阻断项来自它们。

现网数据（2026-11-05 线上库热拷贝）：`loci` 共 76 行，其中旧模型 67 行（含 1 个所有者停止的旧 Q&A 群）；引用它们的投递 107 条全部为终态，provisioning 操作 709 条全部为 committed。所有者已确认旧模型数据不需要保留，包括那个停止标记。

## What Changes

- **BREAKING（数据）**：持久层版本 18 → 19。离线迁移脚本 `dsh-pet-migrate-state` 在 DSH 停止时删除旧模型 locus 行（父会话在 `locus_mains` 中没有记录的行），以及引用它们的投递、切换通知、权限审计和 provisioning 操作。删除前写数据库备份；`--dry-run` 列出将删除的行。索引不由脚本处理，Host 打开 locus 持久层后、注册读索引的回调之前，按剩余行重新推导。
- 全库存在非终态投递或未完成的操作，或者删除后保留的行不满足 v19 加载条件时，脚本拒绝迁移。脚本放行就意味着 Host 能打开。
- v19 只承载三层模型的行：组合标记只能是 `tier3`、`active` 行必须有标记（持久行 schema 逐行校验）；父会话必须有配对（启动对账检查）。任一不满足时 Pet 保持未就绪。
- 删除代码中的旧模型分支，`childComposition` 类型收窄为 `tier3`。
- 清除后原旧模型入口按"没有 locus 行"处理：下一条授权 at 按 auto 建立，所有者停止过的旧入口不再保留停止标记。例外：同时有 `chat_bindings` 旧标记的入口，仍按该标记的既有规则要求所有者显式重建。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `pet-locus-collaboration`：删除「旧模型入口按退休规则处理」；新增「旧模型 locus 数据经离线迁移清除」「持久层只承载三层模型的 locus 行」；修改「上下文按实际子会话绑定并允许按需问主会话」「Locus 业务出站只能经受管 finish」「Locus 工具档位由所有者显式授予且不重建子会话」「投递与结算关联独立于会话运行状态」中引用旧模型或已过时的场景与语句。

## Impact

- 脚本：`packages/dsh-pet/scripts/migrate-state-version.mjs`（v19 目标、锁内复查、清除逻辑；复用包内 `lib/` 的 Host 校验）。
- 依赖：`zod` 由 `devDependencies` 移到 `dependencies`（Host 运行时本就需要它，此前未声明）。
- 规范同步：子会话 preset 契约按当前 0.2.1 运行体改为独立的 `locus-child`（只改文档）。
- 持久层：`src/host/spec.ts`（`PET_DOMAIN_VERSION = 19`、`childComposition` 枚举收窄、`active` 必须带标记）、`src/host/locus/persistence.ts`（导出供脚本复用的集合校验函数；抽出 `repairDerivedIndexes` 提前到注册回调之前；启动对账检查配对；删除 `isLegacyLocus`、`supersededLegacy` 与 regeneration 的 `previousModel` 支持）。
- 控制面与路由：`controller.ts`、`serviceability.ts`、`resolution.ts`、`admission.ts`（只删两层模型判定，`chat_bindings` 退休探针保留）、`controller-persistence-adapter.ts`、`reconcile.ts`、`tool-tier-mutation.ts`、`control.ts`、`management.ts`、`aggregate.ts`、`composition.ts`、`context.ts`、`wire.ts`、`index.ts`。
- 部署：必须先 `dsh stop`，再运行迁移脚本，再启动；多台机器各自执行。版本号变化后，未迁移的数据库会使 Pet 未就绪（现有机制）。
- 不包含：待办台账 `ledger_item`（16 条引用旧 locus）、询问 `inquiries`（8 条）、更早一代的 `chat_bindings`（7）与 `invocation_channel`（21），以及基于 `chat_bindings` 的 legacy 退休标记路径（`retirement.ts`、`rebuildLegacyEndpoint`）。它们属于其它子系统，有独立读取方，本 change 只保证这些表逐字节不变、读取不出错，后续另开 change 处理。
- 不部署、不重启、不对线上库执行迁移；这些由所有者在实现合入后另行确认。
