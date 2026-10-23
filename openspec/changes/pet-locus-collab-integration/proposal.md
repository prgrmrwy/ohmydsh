## Why

Pet Locus 自己维护共享事实台账与待办（`shared_fact_ledger`、`ledger_item`）以及受理即开工的状态推进。这与 collab-kernel 已有的空间、request 是同一类东西，两套实现平行演进。跨边界协作标准（`packages/dsh-collab/docs/cross-boundary-collaboration-standard.md`）第 7.2 节给出了对照表；上一个 change `collab-locus-extension-points`（2026-10-23 归档）已在协作层做好托管成员与 `ext` 扩展点。现在可以把台账与待办迁到协作层，Pet 只保留入口、生命周期与投递。

## What Changes

- **每个 Locus 主会话一个协作空间**。主会话是 Leader（普通 `dsh-session` 成员）；Locus 子会话由 Pet 以 `pet-locus` channel 托管，使用不透明成员名，换代 `rebind`，退役 `retire`。成员同步是幂等对账，不新增持久表。
- **空间由 Pet 以主会话身份建立并授权**：dsh-collab 句柄新增 `establish(exec, …)`，以 Host 当前持有的主会话对象创建空间，并只为本句柄 channel 执行 `allowManager`（用户 2026-10-23 确认）。
- **共享事实台账迁到协作空间**：存储改为空间日志，同源可读改为空间成员资格。
- **待办改为 request**：子会话登记一条 `assignee` 为主会话的 request，飞书来源与回复去向放进 `ext`，登记不唤醒任何人。
- **人的处置由 Pet 代为记账**：内核新增 manager 命令 `disposeManagedRequest`，只能推进本 channel 托管成员创建的 request，不唤醒任何人。受理与请求执行仍走 Pet 现有的 Host 跟进投递，投递成功后才记 accepted。
- **BREAKING（行为放宽）**：主会话作为 assignee，可以自己推进待办为已受理、已完成或已放弃。
- **存量与降级**：已有本地待办只读保留为旧版；新写入只走协作层。dsh-collab 未加载或 `pet-locus` 未接入时，台账与待办工具 fail closed，Delivery 与回复不受影响。
- **不动**：Delivery、受管 finish、飞书回复权、代际、询问、只读查阅主会话历史、管理面的入口管理。询问迁移另开 change。

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `collab-kernel`：命令表新增 manager 命令 `disposeManagedRequest`；request 承接流程允许托管方代人处置；新提交携带提交时间 `at`。
- `dsh-collab`：句柄新增 `establish`、`disposeRequest`、`readManaged`（经既有 host-index 读取并检查本 channel 授权）；仍不提供其它 Leader 能力。
- `pet-locus-intent-triage`：台账、待办登记、待办生命周期、受理即开工改由协作空间承载；主会话可推进自己承接的待办；新增存量只读与协作层缺失时的降级要求。

## Impact

- **代码**：`packages/collab-kernel/src/{auth,service}`；`packages/dsh-collab/src/integration.ts`；`packages/dsh-pet/src/host/ledger/*`（存储层替换）、`src/index.ts` 装配、`routes.ts` 管理面；新增 Pet 侧 collab adapter。
- **配置**：`dsh.yaml` 中 dsh-collab 增加 `managedChannels: ['pet-locus']`；dsh-pet 以可选 inject 消费 `dshCollab` 服务。
- **存储**：Pet domain 不新增表、不升版本；旧表保留只读。
- **文档**：ADR-0006 补"消费协作内核"注记；跨边界协作标准 7.2 节标注台账与待办已接入。
