## Why

Pet Locus 自己维护共享事实台账与待办（`shared_fact_ledger`、`ledger_item`）以及受理即开工的状态推进。这与 collab-kernel 已有的空间、request 是同一类东西，两套实现平行演进。跨边界协作标准第 7.2 节给出了对照表；`collab-locus-extension-points`（2026-10-23 归档）已在协作层做好托管成员与 `ext` 扩展点。本 change 把台账与待办迁到协作层，并让 Locus 子会话直接使用协作工具，Pet 作为一个代理成员按 locusId 路由。目标是 Locus 内部协作与将来的跨机协作同构：同一套空间、request、日志、约定。

## What Changes

- **每个 Locus 主会话一个协作空间，只有两个成员**：主会话（普通 `dsh-session` 成员，Leader）与 `pet`（`pet-locus` 托管的代理成员，代表该主会话下全部 Locus 子会话）。协作层不感知入口、子会话与代际；换代、退役只改 Pet 的绑定表。
- **子会话直接使用原生 `collab_*` 工具**（读、写条目、发消息、状态；不含建空间与成员管理）。调用者解析为代理成员；Pet 的 `resolveCaller` 同时返回一份戳 `{pet:{locusId}}`，dsh-collab 在写入时并入 `ext`、读取时交 Pet 的 `visible` 过滤。子会话只看到自己写的、主会话写的、以及 ext 指向自己的记录；兄弟互不可见（星形：需要时由主会话转述）。
- **空间由 Pet 以主会话身份建立并授权**：dsh-collab 句柄新增 `establish(exec, …)`；建立后接纳一次 `pet`，之后不再增减成员。
- **待办改为 request**：子会话登记一条 `assignee` 为主会话的 request，飞书来源放 `ext`，登记不唤醒任何人。承接方一对一指定，不引入认领。
- **人的处置由 Pet 代为记账**：内核新增 manager 命令 `disposeManagedRequest`，不唤醒任何人。受理与子会话请求执行仍走 Pet 的 Host 跟进投递，投递成功后才记 accepted。
- **协作层 → 代理的收件路由**：发给 `pet` 的需回复消息与待办终态通知经中继 provider 交给 Pet，Pet 按"ref 链上最近的戳 → 正文点名 → 无法路由交管理面"确定目标 Locus 并登记。首期只登记与路由，不唤醒子会话跑独立轮次（留给询问迁移）。
- **内核新增提交时间 `at`**，供待办的登记时间与状态变更时间投影。
- **BREAKING（行为变化）**：(1) 主会话作为 assignee 可自行推进待办；(2) 兄弟子会话不再能读到彼此登记的待办；(3) `pet_locus_ledger_read` 退役，`pet_locus_track` 保留为登记入口（见 design D6）。
- **存量与降级**：已有本地待办只读保留为旧版；dsh-collab 未加载或 `pet-locus` 未接入时，台账与待办 fail closed，Delivery 与回复不受影响。
- **不动**：Delivery、受管 finish、飞书回复权、代际、询问执行、只读查阅主会话历史、管理面入口管理。询问迁移另开 change；跨机空间（成员为两个主会话）另开 change。

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `collab-kernel`：命令表新增 manager 命令 `disposeManagedRequest`；request 承接流程允许托管方代人处置；新提交携带提交时间 `at`。
- `dsh-collab`：接入方 `resolveCaller` 可返回戳，托管调用者写入自动并入 `ext`，读取经接入方过滤；句柄新增 `establish`、`disposeRequest`、`readManaged`；`collab_status` 对托管调用者按过滤后的记录推导待办。
- `pet-locus-intent-triage`：台账、待办登记、待办生命周期、受理即开工改由协作空间承载；主会话可推进自己承接的待办；兄弟不可见；新增存量只读、协作层缺失降级与迁移前后等价要求。
- `pet-locus-collaboration`：子会话工具面加入协作工具；子会话与主会话之间的协作经协作空间；兄弟不直接往来。

## Impact

- **代码**：`packages/collab-kernel/src/{auth,service,model}`；`packages/dsh-collab/src/{integration.ts,session-provider.ts,tools.ts,status.ts}`；`packages/dsh-pet/src/host/ledger/*`（存储层替换）、`locus/composition.ts`（工具面）、`src/index.ts` 装配、`routes.ts` 管理面；新增 Pet 侧 collab 代理（戳、过滤、路由）。
- **配置**：`dsh.yaml` 中 dsh-collab 增加 `managedChannels: ['pet-locus']`；dsh-pet 以可选 inject 消费 `dshCollab`。
- **存储**：Pet domain 不新增表、不升版本；旧表保留只读。
- **文档**：ADR-0006 补"消费协作内核"注记；跨边界协作标准 7.2 节改写为代理成员模型。
- **相关 change**：`pet-locus-independent-agent-inquiries` 的"兄弟直询"与协作者名单中的 `sibling` 关系与本 change 的星形模型冲突，需在该 change 中去掉。
