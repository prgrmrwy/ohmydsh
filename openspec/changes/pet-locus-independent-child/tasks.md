## 0. 实施前诊断（只读，不改 child.ts）——已完成，四点均确认成立

直接核对已部署 Host 的真实配置（`~/.dsh/profiles/web/cordis.yml` → `dsh-base/cordis.patch.yml`），不是猜测：

- [x] 0.1 spawn provider 已在 host plane 注册：`dsh-base/cordis.patch.yml` 的 `subagent-spawn-in-process` 行，`providerName: spawn`，进程级单例，跟随 Pet 常驻，不依赖任何 preset 层
- [x] 0.2 provider 对象形状与能力确认：`dsh-subagent-spawn-in-process/lib/index.js:30` 的 `inheritsParentContext = false`；`getProvider(name)` 即 `this.providers.get(name)`，形状与 `child.ts` 的 `LocusSubagentPort` 假设一致；已有 `independent-runtime-probe.test.ts` 用真实固定 runtime 断言 `evidence.inheritsParentContext === false` 通过
- [x] 0.3 silent settlement 与 provider 选择无关：`dsh-subagent/lib/index.js:2864` 的 `supportsSettlementNotice = true` 是挂在 `Subagent` 服务本身的结构性标记，不属于任何单个 provider，fork/spawn 走该检查结果一致
- [x] 0.4 provider 字符串透传路径干净，无中间默认值覆盖：`child.ts`（`provider: input.provider ?? DEFAULT_CHILD_PROVIDER`）→ `probeLocusChildPorts` 的 `subagentRecord.startContinuable(spec)` → `Subagent.startContinuable(spec)`（`lib/index.js:1034`）→ `establishFresh`（`:1155`）→ `host.prepareContinuable(spec.provider, ...)`（`:1179`）→ `this.providers.get(name)`（`:3220`），全程纯字符串透传
- [x] 0.5 四点全部确认成立，无假设被推翻；设计按原方案继续，不需要调整

## 1. 独立 child 创建 —— 已完成

- [x] 1.1 把 `DEFAULT_CHILD_PROVIDER` 改为零父上下文的 provider，三条创建路径共用同一常量；调用方显式传入的 provider 语义不变
  - 证据：`child.ts:331` 改为 `'spawn'`；三条路径（`startChild`/`runReservedIdleCreate`/重建）共用该常量，未新增并行创建函数
- [x] 1.2 创建前核验 provider 的 `inheritsParentContext === false`，无法证明时返回稳定失败码并拒绝创建，不静默退回 fork
  - 证据：`defaultProviderProvenIndependent()` + `independent-context-unproven` 失败码，接入 `startChild`/`runReservedIdleCreate` 两条路径，仅在 `input.provider === undefined` 时触发；同时修复了 `probeLocusChildPorts()` 未透传 `getProvider` 的真实集成缺口（若不修，生产环境该核验会永远失败）
- [x] 1.3 测试：默认创建/idle 创建/重建都使用独立 provider；能力不可证明时三条路径均 fail closed；显式传 provider 仍可覆盖
  - 证据：`locus-child.test.ts` 新增 8 项（D2 四种 fail-closed 变体含 idle 路径、D1 显式 provider 绕过核验、`getProvider` 透传 3 种子场景），完整 red→green 验证（临时删除核验代码确认新测试失败，diff 字节级恢复）；全文件 38/38 通过

**范围决定（所有者 2026-03-23）**：不引入上下文模式标记（`fork-prefix-v1`/`independent-v1`/`unknown`）及其 schema 持久化。实施时发现要让该字段真正生效，需要把独立性核验结果一路传递穿过 `index.ts`→`dsh-port.ts`→`controller.ts`（6 处调用点）→`controller-persistence-adapter.ts` 才能到达 `buildLocusRecord()`，与"加一个字段"的预期规模不对等；且该字段只是可观测性，不影响独立性本身是否生效。详见 `design.md` D4。原第 2 节（schema 持久化）整节移除，不做新旧模式共存的历史兼容层。

## 2. 回复出口与问父路径回归 —— 已完成

复核确认这一层与阶段 1（provider 选择/独立性核验）完全解耦：`LocusDeliveryContext`/`renderLocusDeliveryPrompt()` 是纯函数，不含 provider 字段，前言内容不依赖 child 是用 fork 还是 spawn 创建的。因此任务性质是回归确认既有覆盖仍然成立，而非新写测试；已有覆盖具体如下。

- [x] 2.1 回归 `pet_locus_reply` 为业务正文唯一出口，turn 结束未发送时仍如实诊断为未回复
  - 证据：`locus-context.test.ts` 第 96/259 行 `pet_locus_reply` 断言、第 91–97 行「回复只能回到上述当前目标」；本 change 未改动 `context.ts`，14/14 回归通过
- [x] 2.2 回归首轮前言仍包含「按需问 caller-bound 主会话」「parent 回复不构成持久授权」「不自动回传结论」三条边界
  - 证据：`locus-context.test.ts:105-144`「does not flatten history」+「does not guess an unconfirmed anchor」两个既有用例，逐字断言 `send_message`、「必须由所有者在管理面显式确认」、「不要自动把本 child 的结论、摘要或状态回传 main session」
- [x] 2.3 测试：独立 child 首轮不含父 transcript 哨兵、lineage 正确、silent settlement 行为不变
  - 证据：`independent-runtime-probe.test.ts` 用固定 runtime 重跑 3/3 通过，`inheritsParentContext === false` 且 `prepared === {}`（spawn provider 从不读父 `snapshotEvents()`）；lineage/silent settlement 由阶段 1 `locus-child.test.ts` 的 `settlementNotice: 'silent'` 断言与 `supportsSettlementNotice` fail-closed 覆盖，与本节共享同一创建路径

## 3. 本地验证 —— 已完成

- [x] 3.1 运行 `npm run typecheck --workspace=dsh-pet`、`npm run test --workspace=dsh-pet`、`npm run build --workspace=dsh-pet`
  - 结果：typecheck 通过；test 131 文件/2315 测试通过，31 skipped（既有 opt-in runtime probe），0 failed；build 的 host/client/runtime-compat 全部成功，仅既有 ESM/CJS 与 tsdown 配置警告，与本次改动无关
- [x] 3.2 运行仓库 `npm test`、`npm run check:artifacts`、`git diff --check`
  - 结果：`npm test` 124 passed/1 skipped/0 failed；`check:artifacts` 通过；`git diff --check` 通过
- [x] 3.3 `openspec validate pet-locus-independent-child --strict`
  - 结果：通过

## 4. 部署与真实验收（需所有者授权）

- [ ] 4.1 确认目标 home 与兼容 runtime，执行 `dsh build` 物化，验证第二次 sync 无变化
- [ ] 4.2 重启 DSH（由所有者确认时机）
- [ ] 4.3 真实答疑群验收：提问后 child 使用独立上下文，且实际收到飞书回复
- [ ] 4.4 验收 child 在锚点不足时经原生 `send_message` 问父，而不是猜测或自行创建工作目录
- [ ] 4.5 验收主会话未被自动灌入 child 结论
- [ ] 4.6 验收旧 fork child 仍正常服务，历史未被裁剪

## 5. 收尾

- [ ] 5.1 回填真实证据到 `docs/notes/pet-locus-independent-child-handoff.md`，只记录实际执行过的命令与结果
- [ ] 5.2 更新 BACKLOG B035 状态，说明本 change 承接范围与 B035 剩余范围的边界
- [ ] 5.3 与 `pet-unified-locus-collaboration`、`pet-locus-independent-agent-inquiries` 对齐归档顺序；两个 change 修改同一条 requirement，按实际实现顺序重新对齐后再归档
