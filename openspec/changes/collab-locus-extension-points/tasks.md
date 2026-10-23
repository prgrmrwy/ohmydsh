## 0. 基线与接口约定

- [x] 0.1 在任何修改之前运行 kernel 测试与 typecheck、dsh-collab vitest，记录基线：kernel 38 files / 224 tests 通过、typecheck 0；dsh-collab vitest 6 files / 118 tests 通过（2026-10-23，lean 依赖）
- [x] 0.2 Lead 先提交 kernel 公开类型的接口约定（只改类型，不改行为），作为两组并行的共同依据：
  - `ChannelProvider.managed?`、`supportsMode?`；
  - `principals.manager`；
  - `CommandContext.guard?`、`ReadContext.guard?`；
  - `CollabService.allowManager/revokeManager/admitMember/rebindMember/retireMember` 的签名，方法体暂时 `fail('COLLAB_NOT_IMPLEMENTED')`；
  - `Member.managedBy?/previousBindings?`、`Message.ext?/mode?`、`Item.ext?`、`Delivery.mode?`、`Pointer.mode?`、`SpaceState.managers`；
  - 新错误码列表。

  要求：kernel typecheck 为 0。授权表已含五个新命令、方法是桩，所以 `auth.test.ts` 中枚举授权表的两条测试（全部具名写命令逐项允许与拒绝、`auth-15`）在此刻为红，原因正确（缺少新命令的检查项）；它们归第 1 组在 1.1 中补齐。其余既有测试保持绿。
- [x] 0.3 约定：每组先写的测试必须在实现前失败，且失败原因正确；若某断言已被更早的组满足，允许起始即绿，并在 test-plan 记一句原因，不得为它伪造失败

## 1. 内核：托管成员与授权（kernel 组）

- [x] 1.1 Write failing tests：
  - `managed-01..14`；
  - `managed-leader-01..06`；
  - `auth-m-01`、`auth-m-02`；
  - `idempotency-m-01`；
  - `members-05` 的扩展断言（`previousBindings` 中的地址不可复用）。
- [x] 1.2 Implement：
  - 事件 `manager/allowed`、`manager/revoked`、`member/rebound` 与 reduce；
  - `managers` 推导；
  - 地址唯一检查覆盖 `previousBindings`；
  - `allowManager` 与 `revokeManager`（撤销时同一提交退役托管成员）；
  - manager principal 稳定校验与 actor；
  - manager 两阶段处理：预备阶段只认领一次，有收据时不认领；事务内从当前状态重新判定，授权检查先于关闭检查，未授权返回 `COLLAB_NOT_MEMBER`；
  - receipt scope `{kind:'manager', channel}`；
  - `invite` 与 `createSpace` 的认领排除托管 provider；
  - Leader 自动接手跳过托管成员；
  - `transferLeader` 拒绝托管成员为目标；
  - 托管成员的 `join`、`declineInvite`、`leave` 返回 `COLLAB_FORBIDDEN`；
  - 授权表加入五个命令（`auth-06` 类型测试同步）。
- [x] 1.3 Refactor；kernel 全量测试与 typecheck 保持绿

## 2. 内核：调用级守卫与按绑定采样（kernel 组，依赖 1）

- [x] 2.1 Write failing tests：`guard-01..06`、`binding-m-01..04`
- [x] 2.2 Implement：
  - 守卫：在 `command` 的串行事务内，于最后一个 await 之后、`persist` 或返回收据之前同步调用；在四个读取方法的最后一个 await 之后调用；
  - 守卫返回假或抛错时，以 `COLLAB_CALLER_STALE` 拒绝，空间不进入 `failed`；
  - 托管 channel 与 manager 的调用缺少守卫时，在任何 provider 调用之前以 `COLLAB_FORBIDDEN` 拒绝；
  - presence 样本改为按 `{channel, address}` 记录；`decideDispatch` 只在接收方绑定与样本一致时使用样本，唤醒接收方不一致时以 `COLLAB_BINDING_CHANGED` 零提交拒绝；
  - 总览中绑定与样本不一致的成员显示为 `unknown`。
- [x] 2.3 Refactor；kernel 全量测试保持绿，确认 `presence-sampling`、`topics`、`dispatch` 回归行仍为绿

## 3. 内核：ext 与 mode（kernel 组，可与 2 并行，依赖 0.2）

- [x] 3.1 Write failing tests：`ext-01..05`、`mode-01..05`
- [x] 3.2 Implement：
  - `ext` 校验：普通对象、递归只含 JSON 值、按 `canonical` 规范化后不超过 4096 字节；校验位于既有业务校验之后、`ref` 之前；
  - `ext` 持久化与 revise 时原样保留，`changes.ext` 被拒；
  - `mode` 校验：格式、只能与 `needsReply:true` 同用、在事务内同步调用收件人 provider 的 `supportsMode`（抛错视为不支持）；位于 `ref` 之后、话题上限之前；
  - `decideDispatch` 把 `mode` 复制到 delivery 与 pointer；
  - 投影与指针不含 `ext`。
- [x] 3.3 Refactor；kernel 全量测试与 typecheck 保持绿

## 4. dsh-collab：接入方服务与调用者解析（plugin 组，依赖 0.2；内核行为测试依赖 1–3 合入）

- [x] 4.1 Write failing tests：
  - `attach-01..04`、`handle-01..05`、`hcommand-01..05`；
  - `mcaller-01..08`、`caller-m-01`；
  - `tool-m-01`、`status-m-01`、`smode-01..04`；
  - `admit-05` 的改写（未被任何接入方解析的 subagent）。
- [x] 4.2 Implement：
  - `config.ts`：`managedChannels` 校验；
  - 新增 `integration.ts`：中继 provider（每个 channel 一个，`managed: true`）、`attach`/句柄/接入代际、`ctx.provide('dshCollab', …)`；
  - `SessionAccess.caller` 返回 `{channel, address}` 与调用级守卫，守卫捕获 agent 对象、地址与接入代际，并重新执行入口全部条件；
  - `host.context` 接受 channel 与守卫；
  - 工具层错误映射：`COLLAB_CALLER_STALE` → `COLLAB_CALLER_UNAVAILABLE`，`COLLAB_BINDING_CHANGED` 原样返回；
  - 句柄的 `admit`/`rebind`/`retire`/`command`/`read`，按守卫失败原因映射错误；
  - `collab_space` 增加 `allow_manager`/`revoke_manager` 与 `channel` 参数；
  - `collab_status` 按调用者地址匹配成员，托管调用者的 `contacts` 为空，返回前调用守卫；
  - `dsh-session` provider 的 `supportsMode` 与 `registerSessionMode`；带 mode 的投递在全部核验之后交给 handler，不 followup、不降级；
  - 插件 dispose 时先使句柄失效。
- [x] 4.3 Refactor；dsh-collab vitest 与 typecheck 保持绿（typecheck 在完整依赖副本中运行，见 test-plan Coverage Notes）

## 5. 文档与配置

- [x] 5.1 Run：
  - 更新 `packages/dsh-collab/docs/cross-boundary-collaboration-standard.md` 第 8 节状态：三个扩展点已在协作层实现，Locus 接入另开 change；
  - 更新 dsh-collab 与 collab-kernel 的 README（中英）：`managedChannels`、接入服务、托管成员、`ext`、`mode`、新错误码；
  - 更新 `dsh.yaml` 中 dsh-collab 的 note，不超过 600 码点；
  - 确认仓库文档治理测试通过。

## 6. 验证

- [x] 6.1 Run kernel test + typecheck；confirm passes
- [x] 6.2 Run dsh-collab test + typecheck + `test:components`（完整依赖副本）；confirm passes，且真实 header 中协作工具体积 ≤ 4200，记录实测值
- [x] 6.3 Run 根 `npm test`、`npm run check:artifacts`；与基线比较，无新增失败
- [x] 6.4 Run `openspec validate collab-locus-extension-points --strict`；test-plan 所有行 🟢
- [ ] 6.5 Run 真实 Host 验收（`dsh build` 后由用户重启）：
  - 未配置 `managedChannels` 时，既有协作流程不变；
  - 普通会话的 11 个工具 schema 只多出 `collab_space` 的两个 action，体积在预算内；
  - `allow_manager` 对未声明的 channel 返回 `COLLAB_BAD_CHANNEL`；
  - 托管与接入路径只在隔离组件 Host 中，以脚本化 adapter 验收，不接 Pet。

## 实施记录

### 第 1–3 组（kernel，2026-10-23）

命令前缀：`npx vitest run`（workdir `packages/collab-kernel`）。各组的红都是行为断言失败，或调用桩得到 `COLLAB_NOT_IMPLEMENTED`，不是导入或语法错误；每次红运行都报 `Type Errors: no errors`。

| 组 | 红运行 | 观察到的红 | 绿 |
|---|---|---|---|
| 1 托管成员与授权 | `test/managed.test.ts test/managed-leader.test.ts test/auth.test.ts test/members.test.ts test/idempotency.test.ts` | 27 failed：<br>• managed-01..14 与附加的重放用例：五个命令是桩，返回 `COLLAB_NOT_IMPLEMENTED`；managed-08..11 的 `expect.poll` 等不到 claim 调用；<br>• managed-leader-01/02：自动接手选中了托管成员（`leader/changed` 而不是 `space/closed`）；<br>• managed-leader-03/04：本应拒绝的 transfer/leave 成功了；<br>• managed-leader-06：邀请 `loc:9` 被托管 provider 认领并成功；<br>• auth：两条授权表枚举与 auth-m-01/02 遇到桩错误，而不是 `COLLAB_FORBIDDEN`；<br>• idempotency-m-01：桩错误；<br>• members-05：`previousBindings` 中的地址仍可邀请 | 全量 40 files / 248 tests；typecheck 0 |
| 2 守卫与按绑定采样 | `test/guard.test.ts test/presence-binding.test.ts` | 10 failed / 1 passed：<br>• guard-01..05：守卫没有被调用，命令或读取成功；<br>• guard-06：守卫调用次数为 0，期望 1；<br>• binding-m-01：成功提交，而不是 `COLLAB_BINDING_CHANGED`；<br>• binding-m-02：得到 `COLLAB_THREAD_LIMIT`，而不是 `COLLAB_BINDING_CHANGED`；<br>• binding-m-04：`presence['locus-a']` 为 `reachable`，期望 `unknown`；<br>• binding-m-03 起始即绿，原因见 test-plan | 全量 42 files / 259 tests |
| 3 ext 与 mode | `test/ext.test.ts test/mode.test.ts` | 7 failed / 3 passed：<br>• ext-01/03 与 mode-01：`ext`、`mode` 没有持久化，值为 `undefined`；<br>• ext-02、mode-02/03：非法输入被接受（resolved）；<br>• mode-05：先暴露了一个夹具错误，request 从 `open` 直接到 `done` 是 `COLLAB_BAD_TRANSITION`，已改为经 `accepted`，断言未削弱；<br>• ext-04、ext-05、mode-04 起始即绿，原因见 test-plan | 全量 44 files / 269 tests；typecheck 0 |

refactor（第 1.3、2.3、3.3 项）：
- `invite` 复用 `checkName`；
- `samplePresence` 返回 `{presence, bindings}`，直接作为 `decideDispatch` 的输入；
- 重构后全量仍为 44 files / 269 tests，typecheck 0；
- `presence-sampling`、`topics`、`dispatch` 回归行均为绿。

测试支撑扩展，不建平行 world：
- `FakeProvider` 增加 `managed`、`holdClaim`/`holdPresence`（可控 Promise，配合 `gate()`）、`presenceBy`（按地址给出 presence）、`presenceCalls` 与 `modes`/`supportsMode`；
- `world`/`worldFrom` 接受额外的 provider；
- 新增 `test/support/managed-world.ts`：托管 provider P（`pet-locus`）与 Q（`other-loc`）、普通 provider S（`dsh-session`），以及 `mgr`/`at` 两种上下文，默认带通过的守卫。

实现中的取舍（均在 spec 允许范围内）：
- 唤醒接收方没有任何样本时，与绑定不一致按同一规则处理，返回 `COLLAB_BINDING_CHANGED`。例如采样之后才接纳的成员。
- 守卫与 `supportsMode` 都以 `=== true` 判定，其它返回值视为失效或不支持；`guard` 不是函数时视同未提供。
- 普通调用带的守卫同样在提交或返回前调用（guard-06 断言调用 1 次）。
- `createSpace` 同样受"托管 channel 必须带守卫"约束；带守卫时因认领排除托管 provider，返回 `COLLAB_ADDRESS_UNCLAIMED`。
- `ext` 中值为 `undefined` 的自有键视为非 JSON，返回 `COLLAB_BAD_EXT`（对应 spec 场景 `{a:undefined}`），不会被静默丢弃。
- `revokeManager` 对已注册、但不在 `managers` 中的托管 channel，同样返回 `COLLAB_BAD_CHANNEL`。

开放问题：
- 含 `bigint` 的载荷在计算 `payloadHash`（`canonical` → `JSON.stringify`）时抛原生 `TypeError`，早于业务校验，所以得不到 `COLLAB_BAD_EXT`。这是本变更之前就存在的行为，所有命令都一样。ext-02 未列入 bigint，也没有改哈希路径。

### 第 4 组（plugin，2026-10-23）

命令前缀：`npx vitest run`（workdir `packages/dsh-collab`；`vitest.config.ts` 把 `collab-kernel` 指向 `../collab-kernel/src`，因此始终跑在 kernel 组的实时源码上）。基线 6 files / 118 tests 全绿。

**红。** 先写测试再改源码；第一次运行 33 failed，失败原因都是功能缺失，没有导入或语法错误：
- 29 条（attach-01/03/04、handle-01..05、hcommand-01..05、mcaller-01..08、caller-m-01、tool-m-01、status-m-01、smode-01..04）：`start()` 带 `managedChannels` 时插件以 `COLLAB_BAD_CONFIG`（"Invalid collaboration Host configuration"）拒绝启动，也就没有 `dshCollab` 服务、`allow_manager` action 与中继 provider；
- admit-05：同一原因（改写后的用例挂了一个不认领任何会话的接入方）；
- attach-02 起始即绿：四种非法 `managedChannels` 被旧的"未知配置键"规则拒绝，结论正确但理由不同，实现后由新的逐项校验接管；
- 当时 kernel 组尚未合入，原计划会遇到 `COLLAB_NOT_IMPLEMENTED` 的用例，在配置门处就已失败，没有被当作"原因正确"的证据。实现完成时 kernel 已合入，全部用例直接跑在真实内核行为上。

**绿。** 9 files / 152 tests（新增 `integration.test.ts`、`managed-caller.test.ts`、`session-mode.test.ts` 与 `test/support/integrator.ts`）；kernel 同时为 44 files / 269 tests。

**typecheck。** lean worktree 中 `tsc` 会解析到主 checkout 过期的 kernel `lib`（memex 卡片 `dsh-collab-worktree-typecheck-resolves-main-kernel-lib`），因此用一次性 tsconfig（`extends tsconfig.test.json`，`paths` 把 `collab-kernel` 指向 `../collab-kernel/src/index.ts`，含 `test/support`）运行，exit 0。完整依赖副本中的 `npm run typecheck` 与 `test:components`（含 `tool-06` 的新断言与 4200 体积预算）留给 lead 在第 6 组执行；`tool-06` 行因此仍为 🔴。

**变异核验**（每次只改一处，跑对应文件，然后恢复，并用 `diff -r` 确认源码复原）：

| 变异 | 失败的用例 |
|---|---|
| `collab_status` 返回前不调用守卫 | mcaller-04 |
| 普通会话被接入方认领仍放行 | mcaller-05 |
| 调用者守卫不比较接入代际 | mcaller-03（第 4 种）及其后续调用 |
| 托管命令守卫不检查 `holds` | handle-04 |
| 托管命令守卫不检查接入代际 | handle-03 第二次运行（第一次运行由入口检查拦下，单独不足以发现，故补了该运行） |
| mode handler 缺失时回退 followup | smode-02 |
| 托管调用者仍列出种子联系人 | status-m-01 |
| 排除名单与归档在询问接入方之后才检查 | mcaller-06 |

**refactor 与实现取舍**（均在 spec 范围内）：
- 工具层原先额外拒绝 `ext`/`mode` 键；验证后发现参数白名单本就拒绝 schema 外的键，这是冗余代码，已删除；hcommand-03 仍为绿。
- `SessionAccess.caller` 返回 `{channel, address, guard}`；守卫重新执行同一个 `resolve()`，并要求 channel、地址与接入代际都不变，因此与入口条件不会分叉。普通会话的守卫也比较"不被任何接入方认领"。
- `collab_read`、句柄 `read` 在内核返回后再调用一次守卫：内核已在读取边界调用过它，这里是为了覆盖 JSON 序列化前的最后一步，没有 await，不改变语义。
- 句柄对成员命令另包一层"句柄仍是当前接入"的检查：句柄 dispose 后，即使 adapter 仍解析该会话，经旧句柄发起的调用也返回 `COLLAB_CHANNEL_DETACHED`。
- 托管命令收到 `COLLAB_CALLER_STALE` 时按守卫记录的原因映射：代际变化为 `COLLAB_CHANNEL_DETACHED`，不再持有为 `COLLAB_ADDRESS_UNCLAIMED`；其余错误经 `safeError` 映射，因此未授权、已关闭、不存在、被锁、损坏与提交失败的空间都得到同一个 `COLLAB_SPACE_UNAVAILABLE`（handle-02）。
- 中继 provider 的 `presence` 对非 `reachable|unreachable|unknown` 的返回值按 `unknown` 处理；`deliver` 给接入方的是白名单指针。
- 插件 dispose 时先 `integrations.close()`（全部句柄失效、注销全部 mode、之后 `attach` 返回 `COLLAB_SERVICE_CLOSING`），再移除工具和关闭空间；为此补了 `attach-05`（见 test-plan Coverage Notes）。
- `dshCollab` 用 `ctx.provide` 直接发布，生命周期跟随插件 fiber，不放进 `inject`；测试替身 `world.ts` 的 `provide` 也改为 fiber effect，否则同一 ctx 上重启插件会重复注册（trust-03 首先暴露了这一点）。
- smode-01/02 读取投递结果时，等待异步的 `dispatch/completed` 提交，而不是用固定轮数（参见 memex 卡片 `dsh-collab-tests-separate-model-idle-from-ledger-drain`）。

### 实现评审修复（Lead，2026-10-23）

gpt-6-astra 对 f92ab4c79 做只读实现评审，结论 FIX_THEN_SHIP：

- **🔴 `project()` 在 `await overview()` 之后未再调用守卫。** overview 检查通过后到 project 返回前的微任务间隙里，失效的调用者仍能拿到投影。
  - 先加红测 `guard-02b`：守卫第一次检查后用 microtask 失效，原实现照常返回投影。
  - 修复：project 先 `snapshot(ctx)`，`await overview` 之后同步调用守卫，再返回。
- **🟡 不可序列化的 `ext` 以原生异常抛出。** bigint、循环对象、函数在入参快照或 payloadHash 阶段就抛出原生异常，而不是 `COLLAB_BAD_EXT`。
  - 先加红测：`ext-02` 增加 bigint、cycle、function；新增 `ext-02b`，覆盖非法收件人或空标题时先报原有错误、ref 非法时先报 `COLLAB_BAD_EXT`、非成员先报 `COLLAB_NOT_MEMBER`；新增 `guard-04b`（缺守卫时先报 FORBIDDEN），它起始即绿，因为 entry 在快照之前执行。
  - 修复：`cloneInput` 把不可复制或不可序列化的 ext 换成占位值，由 `checkExt` 在原规定位置（既有业务校验之后、ref 之前）报 `COLLAB_BAD_EXT`。我中途尝试过"入口提前拒绝"，评审指出会打乱错误优先级，已撤回。
- **复跑结果：**
  - kernel：44 files / 272 tests，typecheck 0；
  - dsh-collab：vitest 152；
  - 完整依赖副本：typecheck 0，产物测试 2+4，`test:components` 18/18，真实 header 中协作工具 3927 ≤ 4200。

## 5. 文档与配置（完成记录）

- 5.1 已完成：
  - dsh-collab 与 collab-kernel 的 README（中英）新增接入方、托管成员、`ext`/`mode` 与调用级守卫说明；
  - 协作标准第 8 节标注已实现；
  - `dsh.yaml` note 585 码点（不超过 600）。
- 本 change 的 review 文件中，评审者写的绝对路径链接已改成纯文本（内容不变），以通过仓库 markdown 链接检查。

## 6. 验证记录（Lead，2026-10-23）

- 6.1 kernel：44 files / 272 tests 通过，typecheck 0。
- 6.2 dsh-collab：
  - worktree 中 vitest 9 files / 152 tests 通过；
  - 完整依赖副本 `spike/fullcopy` 中 typecheck 0，`npm test` 为 vitest 152 加 build/sync 产物测试 2+4，`test:components` 18/18；
  - 真实 header 中协作工具体积 3927 ≤ 4200（surface-02 与 surface-04 实测值相同）。
- 6.3 根 `npm test`：447 tests，437 pass，8 fail。在基线提交 d9be6f1e3 的临时 worktree 中跑同样的测试，失败的正是同样 8 个（sync / openspec-upgrade / routing 类，lean 依赖环境问题），无新增失败。`npm run check:artifacts` 通过。
- 6.4 `openspec validate collab-locus-extension-points --strict` 通过；test-plan 149 行全部 🟢。
- 6.5 待做：需要 `dsh build` 后由用户重启 Host。
