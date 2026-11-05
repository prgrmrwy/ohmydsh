## Review Metadata

- **Review round**: 3
- **Prior round**: round 2 REVISE (1 critical, 6 moderate)
- **Reviewer context**: cross-model codex gpt-6.1-sol, fresh context, read-only
- **Tool restrictions**: 只读静态核验；唯一写入是完整替换本报告。未运行测试、构建、迁移、模块导入或 Host/GUI 验收；未打开、复制或查询实时数据库；未部署或重启。反例均为源码推演，不冒充执行结果。
- **Artifacts reviewed**: [proposal](<proposal.md>)、[design](<design.md>)、[delta spec](<specs/pet-locus-collaboration/spec.md>)、[round 1](<review-round1.md>)、[round 2 与作者回应](<review-round2.md>)、[current spec](<../../specs/pet-locus-collaboration/spec.md>)、[manifest](<../../../dsh.yaml#L172-L197>)、[ADR-0009](<../../../packages/dsh-pet/docs/adr/ADR-0009-locus-three-tier-structure.md>)；Pet 的迁移脚本、包分发配置、现有构建产物、schema、Domain/atomic adapter、初始化、Locus 集合校验/索引/控制器/权限恢复/组合/退休路径及相关 fixture；ledger/inquiry 读取链；本仓安装的官方 storage-domain/storage 实现。另只读核对已安装包清单、迁移 bin 符号链接及已安装 Zod 版本，未碰状态库。未发现 OpenSpec project 文档。

本变更离线删除两层 Locus 数据，然后删除相应运行期分支。所有者已明确授权第三轮完整评审，也已接受丢弃旧停止标记。本轮不要求恢复脚本端索引算法、JSON archive、运行期跨表写 guard，不扩展到 L1、台账、询问或会话历史迁移。

**结论：核心方案已闭合，可以条件批准；余下是 4 项小且明确的依赖/文档契约修正。** 第二轮的代际断档、合法无 child 历史、默认 Q&A 首建问题都有明确修订。提前修索引所需事务在目标位置已经就绪，导出纯集合校验器也不需要构造 Domain；但“文件已发布”不能代替直接依赖声明，锁内复查仍有零写承诺冲突，合并后的规范还保留两个与目标行为不兼容的保证。

本结论仅适用于本轮读取的 artifact。除落实下列 Required Changes 外，再修改规划内容应重新评审；条件批准不等于已实现或已验证。

## Findings

### 🔴 Critical (blocking)

无新增 Critical。没有发现必须推翻现有精简架构的反例。

### 🟡 Moderate

#### R3-M1：包内导入路径可行，但直接运行依赖没有闭合，不能只凭 `files` 就承诺已安装脚本可运行

- **证据**：[design:89](<design.md#L89>) 以包已发布脚本与 `lib` 支持动态导入。[package:25–37](<../../../packages/dsh-pet/package.json#L25-L37>) 确实包含二者，[构建配置:5–9](<../../../packages/dsh-pet/tsconfig.json#L5-L9>) 也保留所需目录结构。但 [schema:10–18](<../../../packages/dsh-pet/src/host/spec.ts#L10-L18>) 直接运行时导入 `zod`；Pet 的 [dependencies:101–103](<../../../packages/dsh-pet/package.json#L101-L103>) 没声明它，只有 [devDependencies:144](<../../../packages/dsh-pet/package.json#L144>) 声明。官方 [storage-domain:31–37] (node_modules/@deepseek-ai/dsh-storage-domain/package.json#L31-L37) 自己依赖的 Zod 只保证其自身能解析，不保证 Pet 可以借用。
- **具体失败情形**：生产安装省略 devDependencies，依赖采用合法的嵌套/隔离布局，Pet 的上级搜索路径没有 Zod。新 CLI 一导入 schema（或经 Delivery 间接导入）就会 `ERR_MODULE_NOT_FOUND`，尚未分析库就退出。本机恰好有 [已提升的 Zod] (/Users/bytedance/.dsh/profiles/web/node_modules/zod/package.json#L1-L4)，不是独立安装契约的证明；现有 [CLI 测试:7–9、33–36](<../../../packages/dsh-pet/test/migrate-cli.test.ts#L7-L36>) 只从仓库路径启动脚本，容易被开发依赖掩盖。
- **最小修正**：将 Pet 直接使用的 Zod 声明为运行时 dependency，并更新相应锁定信息；D3 写明脚本按自身模块 URL 解析包内文件，而非按 cwd 或 `process.argv[1]` 拼路径。后续验证覆盖生产安装布局、仓库外 cwd 和真正的 bin 链接调用。无需打包第二份校验逻辑，也无需新增 Domain。

#### R3-M2 / R2-M5：锁内复查晚于 checkpoint，晚拒绝仍然违反“拒绝不写任何东西”，且没有明确复读版本戳

- **证据**：[D4:97–100](<design.md#L97-L100>) 的顺序仍是“取锁并 checkpoint → 锁内重新计算 L/复核 D3 → 备份”。[delta:205、210](<specs/pet-locus-collaboration/spec.md#L205-L210>) 则对拒绝作不写入任何东西的保证。原脚本 [181–198](<../../../packages/dsh-pet/scripts/migrate-state-version.mjs#L181-L198>) 明确 checkpoint 会折叠 WAL，且 [133–158](<../../../packages/dsh-pet/scripts/migrate-state-version.mjs#L133-L158>) 的版本读取发生在取锁前；新 D4 只要求复算 L 与 D3，没有把版本纳入复查。
- **具体失败情形**：只读预检通过后、独占锁真正取得前，另一个写者提交了一条 queued Delivery 后释放连接，并留下已提交 WAL。锁内 D3 正确拒绝，但此前 checkpoint 已改主文件并截断 WAL。另一个迁移进程也可能在该窗口把版本升到 19 或更高；仅复算 L/D3 不足以授权继续按旧源版本处理，不能把更新后的未知版本盖回 19。当前 Pet backend 通常用 [delete journal:116–121](<../../../packages/dsh-pet/src/host/storage/backend.ts#L116-L121>)，所以 WAL 不是日常必现；但规划明确支持 checkpoint/WAL，不能依赖“恰好没有 WAL”排除反例。
- **最小修正**：锁内先复读版本戳、表存在性、全部候选数据并重做 D3，成功后才 checkpoint、备份与删除；锁一直保持到提交结束。锁内已是 19 则无语义操作退出，未知/不支持版本拒绝，不继续使用预检的旧版本与 L。把物理零写承诺精确限定到 dry-run、未确认和只读预检拒绝；锁内晚拒绝承诺版本与所有行不变、无备份，明确不把连接/锁的物理副作用当作可回滚语义。补一个预检后注入 queued 行/WAL 的拒绝场景，以及版本在窗口内变化的场景。无需新增文件锁协议或恢复器。

#### R3-M3：delta 漏改当前 v15 升级场景，合并后同时要求“删光旧 locus”和“原 IM locus 照常服务”

- **证据**：未被本 delta 修改的 [current spec:247–250](<../../specs/pet-locus-collaboration/spec.md#L247-L250>) 属于“投递与结算关联独立于会话运行状态”，仍要求 v15 运行当前迁移后原有 IM locus 照常服务。本 delta 仅修改其它三个 requirement（[delta:3、70、132](<specs/pet-locus-collaboration/spec.md#L1-L140>)），同时 [202、210、284–287](<specs/pet-locus-collaboration/spec.md#L202-L287>) 要求 2..18 升到 19，≤17 缺配对表时所有 locus 都属于删除集合。
- **具体反例/不可同时断言的 THEN**：有效、空闲的 v15 IM 库没有配对表。按新设计迁移后原 locus 与直接附属数据被删，不会恢复原 child/current，也不保留原停止语义；下次授权 at 是新建，而不是“原 IM locus 照常服务”。同一测试不能同时断言原关联持续服务与原关联已不存在。旧场景还承诺备份等于调用前主文件字节，新设计在有 WAL 时定义的是 checkpoint 后完整快照，字节 oracle 也应一致。
- **最小修正**：将所属 requirement 纳入 MODIFIED，保留场景原名及其它未改变的结算语义，只替换这条升级场景：备份代表删除前完整状态；旧模型 IM 行按 v19 清除规则处理，保留三层行才继续原身份服务；原旧入口后续按 auto/L1 例外处理。无 WAL 时可以另外断言备份与调用前主文件逐字节相同，不把它推广为 WAL 下的保证。

#### R3-M4：正在修改的组合规范仍描述已退役的父 preset 继承与 `toolFilter`，正常 0.2.1 child 无法满足这些 THEN

- **证据**：[delta:80](<specs/pet-locus-collaboration/spec.md#L80>) 仍要求 child 与 M 的 preset 都为 `locus-base`、冷恢复从父 preset 重建、持久 `toolFilter` 提供宽底座；[119–125](<specs/pet-locus-collaboration/spec.md#L119-L125>) 两个 THEN 复述这一模型。实际 [preset:24–32](<../../../packages/dsh-pet/src/host/locus/preset.ts#L24-L32>) 指定 child 独立、持久的 `locus-child`；[child:61–69](<../../../packages/dsh-pet/src/host/locus/child.ts#L61-L69>) 明确 0.2.1 忽略启动请求的 `toolFilter`，改为发布时 scoped restrict；[composition:561–565](<../../../packages/dsh-pet/src/host/locus/composition.ts#L561-L565>) 对不是 `locus-child` 的 child 直接拒绝。目标运行体也已在 [manifest:5](<../../../dsh.yaml#L5>) pin 为 0.2.1-rc.5。
- **具体失败情形/不可同时断言的 THEN**：正常 child 创建/冷恢复时挂的是 `locus-child`。按本 delta 断言它必须为 `locus-base` 会失败；反过来若为了满足文档真把 child 改成 `locus-base`，现行 attestation 就拒绝发布。这里不是要求增补一种新机制，而是正在修改的 requirement 沿用了升级前的旧事实。
- **最小修正**：同步这一个组合段及对应场景：M 仍固定 `locus-base`；child 独立选择并冷恢复 `locus-child`；持久组合排除委派/文件写工具，发布时 scoped allow/restrict/guard 及回读负责档位和全局层收窄。不再把无效的请求 `toolFilter` 或父 preset 继承写成可断言保证；marker 与本 change 的清除规则不变。

### 📌 Suggestions / 已核实的可行边界

1. **安装路径和 Domain 生命周期不是反对复用的理由。** 已安装迁移 bin 是指向包内脚本的符号链接；默认 Node 会解析入口的真实路径。包内相对 URL 导入不经过 npm 子路径 exports，因此 [exports:9–23](<../../../packages/dsh-pet/package.json#L9-L23>) 没导出 host 子路径并不阻断此方案。不要改用 `import('dsh-pet/lib/host/…')` 或 cwd 路径。这里只要求 R3-M1 的真实运行依赖闭合，不要求对任意非默认 Node 符号链接选项增加适配层。
2. **纯校验导出可行，但“无需 Domain 实例”不等于“零运行时导入”。** [persistence:18、68–81](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L18-L81>) 的 Domain/上下文是类型依赖；当前 [构建产物:17–22] (packages/dsh-pet/lib/host/locus/persistence.js#L17-L22) 也消去了仅用作类型的 `petDomainSpec` 引用。可是 [Delivery:22](<../../../packages/dsh-pet/src/host/locus/delivery.ts#L21-L22>) 运行时引用 schema 常量，所以导入 persistence 仍会经 Delivery 加载 schema，再加载官方 storage-domain/storage/cordis。官方 [defineDomain:61–75] (node_modules/@deepseek-ai/dsh-storage-domain/lib/index.js#L61-L75) 只是检查声明；真正触碰介质的 [open:355–364] (node_modules/@deepseek-ai/dsh-storage-domain/lib/index.js#L355-L364) 不会因 import 自动调用。`normalizeRecord` 和 `assertLocusSet` 都是无 `this` 的 [纯函数:4613–4743](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4613-L4743>)；用它们实现导出函数不需要 Host、backend 或第二个连接。保留 SQL key 信息以复用 [collectLoci:3723–3729](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3723-L3729>) 的 key/id 检查，校验不要顺手重写保留行。
3. **提前修索引在指定位置可执行，不需要提前整段恢复。** [初始化:314–353](<../../../packages/dsh-pet/src/index.ts#L314-L353>) 已完成 Domain open、取得同连接 backend unit、在 333 安装 `withAtomicWrites`，并在 346 注册关闭器，之后才构造 repository。提取 [初始索引修复:3317–3332](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3317-L3332>) / [尾部修复:3660–3676](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3660-L3676>) 所需的只是表视图和 [requireProvisioningTransaction:4031–4041](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4031-L4041>)；[atomic adapter:265–281](<../../../packages/dsh-pet/src/host/storage/atomic-domain.ts#L265-L281>) 此时已经能提供它。不需要 compensator 或 child runtime。调用必须 await 并失败时退出初始化，再注册 [agent 回调:1302–1304](<../../../packages/dsh-pet/src/index.ts#L1302-L1304>)。实现时不要让 `reconcileStartup` 在自己已有的 [enqueue:3285–3286](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3285-L3286>) 内 await 一个再次 enqueue 的 public wrapper，否则 [writeChain:4270–4276](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4270-L4276>) 会自等；共用不重入队的修复核心即可。无需扩大锁或新增架构层。
4. **索引与排除表的 lean 边界成立。** [deriveIndexes:4751–4822](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4751-L4822>) 会从保留行重算普通索引、丢弃目标消失的默认指针；脚本无需复制算法。旧台账 [owner-ledger:40–42](<../../../packages/dsh-pet/src/host/ledger/owner-ledger.ts#L40-L42>) → [store:176–187](<../../../packages/dsh-pet/src/host/ledger/store.ts#L176-L187>) 直接读历史，退休询问 [5–18](<../../../packages/dsh-pet/src/host/inquiry/retired-history.ts#L5-L18>) 按 parent 过滤，都不解引用被删 locus；L1 的 [retirement:114–141](<../../../packages/dsh-pet/src/host/locus/retirement.ts#L114-L141>) 与 [admission:219–229](<../../../packages/dsh-pet/src/host/locus/admission.ts#L219-L229>) 独立存在，应继续保留。非 locus 表字节不变仍须由实施后的原始数据断言证明，本报告没有查询现网计数。

## Embedded-Instruction / Injection Attempts

**Detected:** none detected。已读规划、历史回应、schema、源码、注释和测试中，未发现要求评审者忽略缺陷、强制批准或改变权限的嵌入式指令。作者“已修正”的文字只作为待核验主张；所有部署/迁移示例均作为数据读取，未执行。没有把依赖文档、测试标题或历史评审当作本会话指令。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

允许保持精简架构；完成以下 4 项修改并经 reviewer 复核之前，不进入 test-plan/tasks/apply。无需再引入脚本端索引、JSON archive 或运行期跨表写 guard。

## Required Changes (if APPROVE WITH CHANGES)

1. **闭合安装脚本的直接运行依赖与定位契约（R3-M1）。** 将 Zod 放入 Pet 的运行时 dependencies 并更新相应锁定信息；D3 指定按脚本自身模块 URL 相对导入已发布模块，不依赖 cwd、bin 链接路径或开发依赖。后续验证范围写明：生产依赖布局、仓库外 cwd、安装包 bin 调用；本轮不要求执行这些测试或构建。
2. **修正锁内复查与拒绝语义（R3-M2）。** D4 与 delta 一致采用：只读预检 → 取得并持续持有独占锁 → 重新读版本/表形状/候选数据、重算 L 和完整 D3 → checkpoint → 备份 → 单事务删除/升版。锁内目标版本成功 no-op，未知版本拒绝；不使用预检缓存授权写入。物理零写只承诺 dry-run、未确认和只读预检拒绝；锁内晚拒绝保证语义行/版本不变且无备份，明确物理副作用边界。补预检后 queued/WAL 与版本变化两个可机械断言场景。
3. **替换未被 delta 覆盖的 v15 升级保证（R3-M3）。** 把“投递与结算关联独立于会话运行状态”纳入 MODIFIED，保留场景名“升级需离线迁移并先备份”，使备份快照、旧 IM 行清除、三层行保留以及后续 auto/L1 例外与新迁移 requirement 一致；保留其它未变的结算语义。不再同时承诺旧 locus 被删和旧关联持续服务，也不在 WAL 下承诺备份等于调用前主文件字节。
4. **同步当前运行体的组合描述（R3-M4）。** 修改正在重述的组合段与“主会话 preset 不影响子会话工具面”“冷恢复不回落到父组合”等相关场景：M=`locus-base`、child=`locus-child` 独立持久选择，发布时 scoped 收窄/guard/回读，不依赖 0.2.1 已忽略的启动 `toolFilter`。不改本 change 的 marker、删除判据或安全强度。

CHANGES_APPLIED: yes

## Rebuttals

以下逐项裁定 [round-2 作者回应:116–124](<review-round2.md#L116-L124>)，评的是规划是否解决反例，不宣称新函数已经实现。

| Round-2 条目 | 裁定 | 独立源码复核与边界 |
|---|---|---|
| **R2-C1：交错删除导致代际断档** | **resolved / accepted by reviewer（规划层）** | [D3:84–89](<design.md#L84-L89>) 已要求共享完整 `normalizeRecord`/`assertLocusSet`，而不是再列一份子集；[delta:230–238](<specs/pet-locus-collaboration/spec.md#L230-L238>) 同时固定前缀删除成功与中间代删除拒绝。[源码:4735–4741](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L4735-L4741>) 的确只检查剩余相邻代际连续，不要求最小 generation=1。原 Critical 反例被覆盖；安装依赖是新的 R3-M1，不否定纯校验器可行性。 |
| **R2-M2：无 child 的 stopped/invalid 历史被误拒** | **resolved / accepted by reviewer** | [D6:117](<design.md#L117>) 与 [新增场景:240–243](<specs/pet-locus-collaboration/spec.md#L240-L243>) 不再只允许 not-created 缺 marker。[首建:2167–2181](<../../../packages/dsh-pet/src/host/locus/controller.ts#L2167-L2181>) 没有 marker；[transition:586–617](<../../../packages/dsh-pet/src/host/locus/aggregate.ts#L586-L617>) 允许停止/失效/退休且不伪造 marker；[换 M:3101–3105](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3101-L3105>) 也保留该事实。无需补写 tier3。 |
| **R2-M3：早期 agent/工具读取悬空索引** | **resolved / accepted by reviewer（规划层）** | [D2:72](<design.md#L72>) 改为在注册消费者前 await 修复；源码中 [333→353](<../../../packages/dsh-pet/src/index.ts#L330-L353>) 的事务准备顺序支持这一点。已注册回调确实会走 [pending application:1643–1647](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L1643-L1647>) 读索引，新场景 [245–248](<specs/pet-locus-collaboration/spec.md#L245-L248>) 覆盖该窗口。应按上文避免 enqueue 重入，不必提前 compensator 恢复。 |
| **R2-M4：非法 marker 错误地引导迁移脚本** | **resolved / accepted by reviewer** | [delta:114–117](<specs/pet-locus-collaboration/spec.md#L114-L117>) 已只要求 key 诊断；[D6:117](<design.md#L117>) 区分内容错误和版本不匹配。真实 [Domain:371、419–428] (node_modules/@deepseek-ai/dsh-storage-domain/lib/index.js#L364-L428) 保留 table/key，[guidance:12–17](<../../../packages/dsh-pet/src/host/migration-guidance.ts#L12-L17>) 只识别版本错误，和新文案吻合。 |
| **R2-M5：dry-run/拒绝前 checkpoint** | **partially resolved / 未完全接受** | 首次只读预检前不再 checkpoint，dry-run 的主路径已修正；但锁内二次复查放在 checkpoint 后，晚拒绝仍不满足统一的物理零写承诺，且版本 TOCTOU 没写清。见 R3-M2。 |
| **R2-M6：普通 fixture 也受 enum 收窄影响** | **resolved / accepted by reviewer（影响面规划）** | [D7.10:134–138](<design.md#L134-L138>) 已区分旧行为断言、普通合法 fixture 和原始介质非法输入。实际 [UI fixture:69–72](<../../../packages/dsh-pet/test/fixtures/locus-snapshot.ts#L69-L72>)、[Host fixture:48–64](<../../../packages/dsh-pet/test/support/pet-host-fixture.ts#L48-L64>)、[collab 队列:64–68](<../../../packages/dsh-pet/test/collab-todo-lifecycle.test.ts#L64-L68>)、[adapter helper:21–54](<../../../packages/dsh-pet/test/locus-controller-persistence-adapter.test.ts#L21-L54>) 确实仍有旧 marker，不能按 legacy 字符串删测试；[schema refinement:634–639](<../../../packages/dsh-pet/src/host/spec.ts#L634-L639>) 与 [admission union:123–125](<../../../packages/dsh-pet/src/host/locus/admission.ts#L123-L125>) 也属于相应收窄影响面。新规划已要求保留原测试目的，不要求 fixture 框架。 |
| **R2-M7：首次 Q&A 的无 M 被误当非法数据** | **resolved / accepted by reviewer** | [D7.6:130](<design.md#L130>) 明确无 active main 返回 undefined，只对已有 locus 缺配对抛错；[delta:308–311](<specs/pet-locus-collaboration/spec.md#L308-L311>) 固定首次创建。真实 [controller:854–855、880–883](<../../../packages/dsh-pet/src/host/locus/controller.ts#L849-L883>) 先 find、后 ensure，现有 [adapter:111–114](<../../../packages/dsh-pet/src/host/locus/controller-persistence-adapter.ts#L111-L114>) 的旧 parent 回退可以直接改为空结果，不会堵住首建。 |

**补充接受的取舍**：全库拒绝非终态 Delivery、拒绝非 committed/compensated 操作覆盖没有 locus-id 的发布前工作；[终态集合:624–629](<../../../packages/dsh-pet/src/host/locus/delivery.ts#L624-L629>) 与 D3 列表一致。恢复债可能不能靠停机或等待消失，[D3:93](<design.md#L93>) 已承认需先由可读取旧库的 Host 或所有者处理；[源码:3633–3646](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3633-L3646>) 支持这一边界。不要求在本迁移中自动清债。只在启动查持久配对也可保留：首建 [641–663、824–830](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L641-L830>) 与换 M [3024–3041、3133–3138](<../../../packages/dsh-pet/src/host/locus/persistence.ts#L3024-L3138>) 原本就同事务发布 main/locus，不必把暂存配对视图传入每个写入口。

**未检查/风险**：没有执行任何测试、构建、生产包导入、SQLite 竞态复现或真实 Host 初始化验收；现网行数没有独立复核。后续仍需验证已安装 CLI 的依赖布局与锁内竞态，以及真实 agent 回调先后顺序。数据库备份是删除回退的唯一凭据；恢复它会丢失迁移之后产生的状态。本轮未写记忆卡或其它文件，遵守唯一写入范围。

## Re-check of Required Changes (round 3)

本次仅复核上述四项规划修订及其相关源码，不把待实施承诺当作已实现；唯一 `VERDICT` 行不变。**三项已解决，一项未完全解决，`CHANGES_APPLIED: no` 保持不变。**

1. **R3-M1：已解决（规划层）。** [D3:89](<design.md#L89>) 明确以 `new URL('../lib/...', import.meta.url)` 定位、Zod 移入运行时依赖并更新 lock；[Impact:27–28](<proposal.md#L27-L28>)、[delta:314](<specs/pet-locus-collaboration/spec.md#L314>) 与[生产隔离依赖/仓库外 bin 场景:374–377](<specs/pet-locus-collaboration/spec.md#L374-L377>) 覆盖所需契约；源码仍直接 [import Zod:10–11](<../../../packages/dsh-pet/src/host/spec.ts#L10-L11>)，包确实发布[脚本与 lib:25–37](<../../../packages/dsh-pet/package.json#L25-L37>)，当前 [dependencies:101–103](<../../../packages/dsh-pet/package.json#L101-L103>) / [devDependencies:144](<../../../packages/dsh-pet/package.json#L144>) 尚未实施调整，不据此宣称生产安装已验证。
2. **R3-M2：部分解决，尚未通过。** [D4:97–100](<design.md#L97-L100>)、[delta:313](<specs/pet-locus-collaboration/spec.md#L313>) 已改成取锁后复读版本/表结构/数据、重算 L 与完整 D3，通过后才 checkpoint/备份，并持锁至提交；[queued/WAL 与版本变化场景:364–372](<specs/pet-locus-collaboration/spec.md#L364-L372>) 已补。但 [delta:308](<specs/pet-locus-collaboration/spec.md#L308>) 仍对任一拒绝无条件承诺“不写入任何东西”，[D3:80](<design.md#L80>) 仍笼统说“不改库”，未落实 Required Change 2 要求的物理副作用边界；现有[脚本取锁:181–188](<../../../packages/dsh-pet/scripts/migrate-state-version.mjs#L181-L188>) 与[backend:103–121](<../../../packages/dsh-pet/src/host/storage/backend.ts#L103-L121>) 说明取锁涉及连接与事务，不能把锁内行/版本不变当作所有物理副作用可回滚的保证。
3. **R3-M3：已解决（规划层）。** [delta:190–291](<specs/pet-locus-collaboration/spec.md#L190-L291>) 已将原 requirement 完整纳入 MODIFIED，保留其它投递/结算语义；同名[升级场景:234–237](<specs/pet-locus-collaboration/spec.md#L234-L237>) 改为 checkpoint 后完整快照、v15 无配对表的旧 locus 全删及下一次授权 at 新建，不再保证原关联持续服务或 WAL 下主文件字节相同；引用的[迁移规则与三层行保留场景:303–327](<specs/pet-locus-collaboration/spec.md#L303-L327>)、[L1 例外:432–435](<specs/pet-locus-collaboration/spec.md#L432-L435>) 与新契约一致，现行[脚本:203–206](<../../../packages/dsh-pet/scripts/migrate-state-version.mjs#L203-L206>) 也印证配对表是此前增量创建的结构。
4. **R3-M4：已解决。** [组合正文:80](<specs/pet-locus-collaboration/spec.md#L80>) 与[两个场景:119–125](<specs/pet-locus-collaboration/spec.md#L119-L125>) 已改为 `startActivation`、M=`locus-base`、独立持久 child=`locus-child`、发布时 scoped `tools.restrict`/guard/核验；与实际[创建调用:891–902](<../../../packages/dsh-pet/src/host/locus/child.ts#L891-L902>)、[持久 preset 契约:24–32](<../../../packages/dsh-pet/src/host/locus/preset.ts#L24-L32>)、[作用域上限:1084–1092](<../../../packages/dsh-pet/src/index.ts#L1084-L1092>) 及[父/子 preset 核验:500–565](<../../../packages/dsh-pet/src/host/locus/composition.ts#L500-L565>) 相符，不再依赖无效的请求 `toolFilter` 或父 preset 继承，marker 与删除判据未因该修订改变。

**R3-M2 精确待补内容**：把上述总括拒绝文案收窄为“不写备份、不改变语义行与版本”；明确物理零写仅承诺 `--dry-run`、未确认及只读预检拒绝。锁内晚拒绝仍必须不 checkpoint、不备份且行/版本不变，但连接/取锁可能产生的物理副作用不属于可回滚语义、也不承诺数据库/WAL 文件字节完全不变。无需新增锁协议或恢复机制。

**只读校验**：已实际运行 `openspec validate pet-locus-purge-previous-model --strict`，输出 `Change 'pet-locus-purge-previous-model' is valid`，退出码 0。严格校验通过不消除上述契约缺口。本次没有运行测试、构建、迁移、模块导入或 Host 验收，没有打开、查询或复制实时数据库；仅编辑本报告，未写记忆卡或其它文件。

- **R3-M2 最终复核：第 2 项现已解决（规划层），取代本节此前的“部分解决”及待补结论；四项 Required Changes 均已解决，`CHANGES_APPLIED: yes`。** [delta:308](<specs/pet-locus-collaboration/spec.md#L308>) 与 [D3:80](<design.md#L80>) 均已将物理零写限定为只读预检阶段（含 `--dry-run`、未确认运行）的拒绝，并明确锁内拒绝不 checkpoint、不写备份、不改任何行与版本号，打开连接/取得独占锁的 SQLite 物理副作用不在保证内；与[锁内条款:313](<specs/pet-locus-collaboration/spec.md#L313>)、[D4:97–100](<design.md#L97-L100>) 的复查先于 checkpoint/备份及持锁顺序一致，无矛盾。本次仅复核该剩余缺口，并实际重新运行 `openspec validate pet-locus-purge-previous-model --strict`，输出 `Change 'pet-locus-purge-previous-model' is valid`，退出码 0；唯一 `VERDICT` 行保持不变。未运行测试、构建或迁移，未触及实时数据库，仅修改本报告。
