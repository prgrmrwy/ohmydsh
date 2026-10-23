## 0. 基线与接口约定

- [x] 0.1 在任何修改之前运行 kernel 测试与 typecheck、dsh-collab vitest，记录基线：kernel 38 files / 224 tests 通过、typecheck 0；dsh-collab vitest 6 files / 118 tests 通过（2026-10-23，lean 依赖）
- [ ] 0.2 Lead 先提交 kernel 公开类型的接口约定（只改类型，不改行为），作为两组并行的共同依据：
  - `ChannelProvider.managed?`、`supportsMode?`；
  - `principals.manager`；
  - `CommandContext.guard?`、`ReadContext.guard?`；
  - `CollabService.allowManager/revokeManager/admitMember/rebindMember/retireMember` 的签名，方法体暂时 `fail('COLLAB_NOT_IMPLEMENTED')`；
  - `Member.managedBy?/previousBindings?`、`Message.ext?/mode?`、`Item.ext?`、`Delivery.mode?`、`Pointer.mode?`、`SpaceState.managers`；
  - 新错误码列表。

  要求：kernel typecheck 为 0。授权表已含五个新命令、方法是桩，所以 `auth.test.ts` 中枚举授权表的两条测试（全部具名写命令逐项允许与拒绝、`auth-15`）在此刻为红，原因正确（缺少新命令的检查项）；它们归第 1 组在 1.1 中补齐。其余既有测试保持绿。
- [ ] 0.3 约定：每组先写的测试必须在实现前失败，且失败原因正确；若某断言已被更早的组满足，允许起始即绿，并在 test-plan 记一句原因，不得为它伪造失败

## 1. 内核：托管成员与授权（kernel 组）

- [ ] 1.1 Write failing tests：
  - `managed-01..14`；
  - `managed-leader-01..06`；
  - `auth-m-01`、`auth-m-02`；
  - `idempotency-m-01`；
  - `members-05` 的扩展断言（`previousBindings` 中的地址不可复用）。
- [ ] 1.2 Implement：
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
- [ ] 1.3 Refactor；kernel 全量测试与 typecheck 保持绿

## 2. 内核：调用级守卫与按绑定采样（kernel 组，依赖 1）

- [ ] 2.1 Write failing tests：`guard-01..06`、`binding-m-01..04`
- [ ] 2.2 Implement：
  - 守卫：在 `command` 的串行事务内，于最后一个 await 之后、`persist` 或返回收据之前同步调用；在四个读取方法的最后一个 await 之后调用；
  - 守卫返回假或抛错时，以 `COLLAB_CALLER_STALE` 拒绝，空间不进入 `failed`；
  - 托管 channel 与 manager 的调用缺少守卫时，在任何 provider 调用之前以 `COLLAB_FORBIDDEN` 拒绝；
  - presence 样本改为按 `{channel, address}` 记录；`decideDispatch` 只在接收方绑定与样本一致时使用样本，唤醒接收方不一致时以 `COLLAB_BINDING_CHANGED` 零提交拒绝；
  - 总览中绑定与样本不一致的成员显示为 `unknown`。
- [ ] 2.3 Refactor；kernel 全量测试保持绿，确认 `presence-sampling`、`topics`、`dispatch` 回归行仍为绿

## 3. 内核：ext 与 mode（kernel 组，可与 2 并行，依赖 0.2）

- [ ] 3.1 Write failing tests：`ext-01..05`、`mode-01..05`
- [ ] 3.2 Implement：
  - `ext` 校验：普通对象、递归只含 JSON 值、按 `canonical` 规范化后不超过 4096 字节；校验位于既有业务校验之后、`ref` 之前；
  - `ext` 持久化与 revise 时原样保留，`changes.ext` 被拒；
  - `mode` 校验：格式、只能与 `needsReply:true` 同用、在事务内同步调用收件人 provider 的 `supportsMode`（抛错视为不支持）；位于 `ref` 之后、话题上限之前；
  - `decideDispatch` 把 `mode` 复制到 delivery 与 pointer；
  - 投影与指针不含 `ext`。
- [ ] 3.3 Refactor；kernel 全量测试与 typecheck 保持绿

## 4. dsh-collab：接入方服务与调用者解析（plugin 组，依赖 0.2；内核行为测试依赖 1–3 合入）

- [ ] 4.1 Write failing tests：
  - `attach-01..04`、`handle-01..05`、`hcommand-01..05`；
  - `mcaller-01..08`、`caller-m-01`；
  - `tool-m-01`、`status-m-01`、`smode-01..04`；
  - `admit-05` 的改写（未被任何接入方解析的 subagent）。
- [ ] 4.2 Implement：
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
- [ ] 4.3 Refactor；dsh-collab vitest 与 typecheck 保持绿（typecheck 在完整依赖副本中运行，见 test-plan Coverage Notes）

## 5. 文档与配置

- [ ] 5.1 Run：
  - 更新 `packages/dsh-collab/docs/cross-boundary-collaboration-standard.md` 第 8 节状态：三个扩展点已在协作层实现，Locus 接入另开 change；
  - 更新 dsh-collab 与 collab-kernel 的 README（中英）：`managedChannels`、接入服务、托管成员、`ext`、`mode`、新错误码；
  - 更新 `dsh.yaml` 中 dsh-collab 的 note，不超过 600 码点；
  - 确认仓库文档治理测试通过。

## 6. 验证

- [ ] 6.1 Run kernel test + typecheck；confirm passes
- [ ] 6.2 Run dsh-collab test + typecheck + `test:components`（完整依赖副本）；confirm passes，且真实 header 中协作工具体积 ≤ 4200，记录实测值
- [ ] 6.3 Run 根 `npm test`、`npm run check:artifacts`；与基线比较，无新增失败
- [ ] 6.4 Run `openspec validate collab-locus-extension-points --strict`；test-plan 所有行 🟢
- [ ] 6.5 Run 真实 Host 验收（`dsh build` 后由用户重启）：
  - 未配置 `managedChannels` 时，既有协作流程不变；
  - 普通会话的 11 个工具 schema 只多出 `collab_space` 的两个 action，体积在预算内；
  - `allow_manager` 对未声明的 channel 返回 `COLLAB_BAD_CHANNEL`；
  - 托管与接入路径只在隔离组件 Host 中，以脚本化 adapter 验收，不接 Pet。
